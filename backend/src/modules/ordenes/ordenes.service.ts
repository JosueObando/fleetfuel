import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { auditar, contextoActual, gestor } from '../../common/contexto/contexto-peticion';
import { CrearOrdenDto, ActualizarOrdenDto, CambiarEstadoOrdenDto } from './dto/ordenes.dto';
import { ADMITEN_EDICION, ADMITEN_VIAJE, FLUJO_ORDEN, EXIGEN_MOTIVO } from './estados';

const CAMPOS = `o.orden_id AS id, o.numero_orden_externa AS "numeroOrdenExterna",
                o.cliente_id AS "clienteId", c.nombre AS cliente,
                o.estacion_id AS "estacionId", e.nombre AS estacion,
                o.fecha_orden AS "fechaOrden", o.fecha_requerida AS "fechaRequerida",
                o.ventana_inicio AS "ventanaInicio", o.ventana_fin AS "ventanaFin",
                o.prioridad, o.estado, o.volumen_total AS "volumenTotal",
                o.observaciones, o.fuente`;

const DESDE = `FROM ordenes_abastecimiento o
                 JOIN clientes c ON c.cliente_id = o.cliente_id
                 JOIN estaciones_servicio e ON e.estacion_id = o.estacion_id`;

/* `ck_ordenes_ventana` compara los dos extremos de la fila guardada: al editar
   uno solo, el otro no viene en la petición. La regla sigue en el motor; aquí
   sólo se cambia el 500 con el nombre de la restricción por algo corregible. */
function traducirVentana(e: unknown): never {
  if ((e as { constraint?: string }).constraint === 'ck_ordenes_ventana')
    throw new BadRequestException('La ventana de entrega termina antes de empezar');
  throw e;
}

@Injectable()
export class OrdenesService {
  /* La lista incluye las transiciones posibles de cada fila. Sin eso, la
     interfaz tendría que pedir el detalle de cada orden solo para saber qué
     botones pintar —una petición por fila— o duplicar la máquina de estados
     en el cliente, que es peor: dos copias que divergen en cuanto cambie el
     flujo. Se calcula aquí, donde vive la única definición. */
  async listar(estado?: string, soloAsignables = false) {
    /* `soloAsignables`: las que se pueden meter en un viaje —con la misma lista
       de estados que `asignarOrden`— y que aún tienen volumen por planificar.
       Una planificada ENTERA no tiene nada más que llevar. */
    const filas = await gestor().query(
      `SELECT ${CAMPOS} ${DESDE}
        WHERE o.eliminado_en IS NULL AND ($1::text IS NULL OR o.estado = $1)
          AND (NOT $2::boolean OR (o.estado = ANY($3::text[])
               AND EXISTS (SELECT 1 FROM detalles_orden d
                            WHERE d.orden_id = o.orden_id AND d.volumen_planificado < d.volumen_solicitado)))
        ORDER BY o.fecha_requerida NULLS LAST, o.orden_id DESC`, [estado ?? null, soloAsignables, ADMITEN_VIAJE]);
    return filas.map((f: { estado: string }) => ({
      ...f, transicionesPosibles: FLUJO_ORDEN[f.estado] ?? [],
      admiteEdicion: ADMITEN_EDICION.has(f.estado),
    }));
  }

  async obtener(id: string) {
    const [orden] = await gestor().query(
      `SELECT ${CAMPOS} ${DESDE} WHERE o.orden_id = $1 AND o.eliminado_en IS NULL`, [id]);
    if (!orden) throw new NotFoundException('Orden no encontrada');
    orden.detalles = await gestor().query(
      `SELECT d.detalle_orden_id AS id, d.producto_id AS "productoId", p.nombre AS producto,
              d.volumen_solicitado AS "volumenSolicitado", d.volumen_planificado AS "volumenPlanificado",
              d.volumen_entregado AS "volumenEntregado", d.volumen_pendiente AS "volumenPendiente",
              d.tolerancia, d.estado
         FROM detalles_orden d JOIN productos_combustible p ON p.producto_id = d.producto_id
        WHERE d.orden_id = $1 ORDER BY d.detalle_orden_id`, [id]);
    /* Transiciones legales y si admite edición: la interfaz no tiene que
       replicar ninguna de las dos reglas. */
    orden.transicionesPosibles = FLUJO_ORDEN[orden.estado] ?? [];
    orden.admiteEdicion = ADMITEN_EDICION.has(orden.estado);
    return orden;
  }

  async crear(dto: CrearOrdenDto) {
    const ctx = contextoActual();
    await this.estacionDeCliente(dto.estacionId, dto.clienteId);

    const productos = dto.detalles.map(d => d.productoId);
    if (new Set(productos).size !== productos.length)
      throw new BadRequestException('Hay productos repetidos en la orden');

    const volumenTotal = dto.detalles.reduce((t, d) => t + d.volumenSolicitado, 0);

    const [creada] = await gestor().query(
      `INSERT INTO ordenes_abastecimiento
         (empresa_id, numero_orden_externa, cliente_id, estacion_id, fecha_requerida,
          ventana_inicio, ventana_fin, prioridad, fuente, observaciones, volumen_total, creado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING orden_id AS id`,
      [ctx.empresaId, dto.numeroOrdenExterna ?? null, dto.clienteId, dto.estacionId,
       dto.fechaRequerida ?? null, dto.ventanaInicio ?? null, dto.ventanaFin ?? null,
       dto.prioridad ?? 'normal', dto.fuente ?? 'manual', dto.observaciones ?? null,
       volumenTotal, ctx.usuarioId]).catch(traducirVentana);

    for (const d of dto.detalles) {
      await gestor().query(
        `INSERT INTO detalles_orden (empresa_id, orden_id, producto_id, volumen_solicitado, tolerancia)
         VALUES ($1,$2,$3,$4,$5)`,
        [ctx.empresaId, creada.id, d.productoId, d.volumenSolicitado, d.tolerancia ?? 0]);
    }

    const completa = await this.obtener(creada.id);
    auditar({ entidad: 'ordenes_abastecimiento', entidadId: String(creada.id), valorNuevo: completa });
    return completa;
  }

  async actualizar(id: string, dto: ActualizarOrdenDto) {
    const antes = await this.obtener(id);
    if (!antes.admiteEdicion)
      throw new ConflictException(
        `Una orden en estado "${antes.estado}" ya no admite cambios de programación`);

    const columnas: Record<string, unknown> = {
      fecha_requerida: dto.fechaRequerida, ventana_inicio: dto.ventanaInicio,
      ventana_fin: dto.ventanaFin, prioridad: dto.prioridad, observaciones: dto.observaciones,
    };
    const presentes = Object.entries(columnas).filter(([, v]) => v !== undefined);
    if (!presentes.length) return antes;

    await gestor().query(
      `UPDATE ordenes_abastecimiento
          SET ${presentes.map(([c], i) => `${c} = $${i + 2}`).join(', ')}, actualizado_en = now()
        WHERE orden_id = $1`, [id, ...presentes.map(([, v]) => v)]).catch(traducirVentana);
    const despues = await this.obtener(id);
    auditar({ entidad: 'ordenes_abastecimiento', entidadId: String(id), valorAnterior: antes, valorNuevo: despues });
    return despues;
  }

  /**
   * Transición de estado (§8.1).
   *
   * El estado NO se cambia por PATCH junto a los demás campos: es una acción
   * de negocio con reglas propias y su propio permiso. Mezclarla con la
   * edición dejaría saltar el flujo con un `{"estado":"cerrada"}`.
   */
  async cambiarEstado(id: string, dto: CambiarEstadoOrdenDto) {
    const antes = await this.obtener(id);
    const permitidas = FLUJO_ORDEN[antes.estado] ?? [];

    if (!permitidas.includes(dto.estado)) {
      throw new ConflictException(
        permitidas.length === 0
          ? `"${antes.estado}" es un estado final: la orden ya no cambia`
          : `No se puede pasar de "${antes.estado}" a "${dto.estado}". Posibles: ${permitidas.join(', ')}`);
    }
    if (EXIGEN_MOTIVO.has(dto.estado) && !dto.motivo)
      throw new BadRequestException(`Pasar a "${dto.estado}" exige indicar el motivo`);

    await gestor().query(
      `UPDATE ordenes_abastecimiento
          SET estado = $2,
              observaciones = coalesce($3, observaciones),
              actualizado_en = now()
        WHERE orden_id = $1`, [id, dto.estado, dto.motivo ?? null]);

    const despues = await this.obtener(id);
    auditar({
      entidad: 'ordenes_abastecimiento', entidadId: String(id),
      valorAnterior: { estado: antes.estado },
      valorNuevo: { estado: dto.estado, motivo: dto.motivo ?? null },
    });
    return despues;
  }

  /* La estación tiene que ser del cliente de la orden: entregar en una
     estación de otro cliente es un error de captura que después nadie
     entiende al conciliar. */
  private async estacionDeCliente(estacionId: string, clienteId: string) {
    const [e] = await gestor().query(
      `SELECT cliente_id FROM estaciones_servicio
        WHERE estacion_id = $1 AND eliminado_en IS NULL`, [estacionId]);
    if (!e) throw new BadRequestException('La estación indicada no existe');
    if (String(e.cliente_id) !== String(clienteId))
      throw new BadRequestException('La estación no pertenece al cliente indicado');
  }
}
