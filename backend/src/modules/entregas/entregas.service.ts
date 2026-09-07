import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { auditar, contextoActual, gestor } from '../../common/contexto/contexto-peticion';
import { RegistrarEntregaDto, AprobarEntregaDto, RechazarEntregaDto } from './dto/entregas.dto';

const CAMPOS = `e.entrega_id AS id, e.viaje_id AS "viajeId", e.orden_id AS "ordenId",
                e.detalle_orden_id AS "detalleOrdenId", e.estacion_id AS "estacionId",
                e.producto_id AS "productoId", e.compartimento_id AS "compartimentoId",
                e.volumen_cargado AS "volumenCargado",
                e.volumen_descargado AS "volumenDescargado",
                e.volumen_recibido AS "volumenRecibido",
                e.diferencia_volumen AS "diferenciaVolumen",
                e.porcentaje_merma AS "porcentajeMerma",
                e.medidor_inicial AS "medidorInicial", e.medidor_final AS "medidorFinal",
                e.sello_recibido AS "selloRecibido", e.estado_sello AS "estadoSello",
                e.receptor_nombre AS "receptorNombre", e.receptor_documento AS "receptorDocumento",
                e.latitud, e.longitud, e.fecha_llegada AS "fechaLlegada",
                e.fecha_descarga AS "fechaDescarga", e.documento_entrega AS "documentoEntrega",
                e.observaciones, e.estado,
                e.aprobada_por AS "aprobadaPor", e.aprobada_en AS "aprobadaEn",
                e.motivo_aprobacion AS "motivoAprobacion"`;

/**
 * El viaje sólo admite entregas mientras descarga.
 *
 * Un viaje con varias paradas se queda en `descargando` durante todas: el §8.2
 * no vuelve de `descargando` a `transito_estacion`, así que el estado describe
 * la fase de reparto entera y no una parada concreta.
 */
const ENTREGABLE = new Set(['descargando']);

@Injectable()
export class EntregasService {
  /** La línea de orden con sus acumulados, para poder afirmarlos. */
  async lineaDeOrden(detalleOrdenId: string) {
    const [fila] = await gestor().query(
      `SELECT detalle_orden_id AS id, volumen_solicitado AS "volumenSolicitado",
              volumen_planificado AS "volumenPlanificado",
              volumen_entregado AS "volumenEntregado",
              volumen_pendiente AS "volumenPendiente", tolerancia, estado
         FROM detalles_orden WHERE detalle_orden_id = $1`, [detalleOrdenId]);
    if (!fila) throw new NotFoundException('Línea de orden no encontrada');
    return fila;
  }

  async listarDeViaje(viajeId: string) {
    return gestor().query(
      `SELECT ${CAMPOS} FROM entregas e WHERE e.viaje_id = $1 ORDER BY e.entrega_id`, [viajeId]);
  }

  async obtener(id: string) {
    const [fila] = await gestor().query(
      `SELECT ${CAMPOS} FROM entregas e WHERE e.entrega_id = $1`, [id]);
    if (!fila) throw new NotFoundException('Entrega no encontrada');
    return { ...fila, requiereAprobacion: fila.estado === 'pendiente' };
  }

  /**
   * Registrar una entrega en estación.
   *
   * Las cuatro reglas que ninguna restricción de columna puede expresar sola,
   * porque todas comparan filas de tablas distintas — la misma forma que el
   * motor de cálculo del plan de carga.
   */
  async registrar(viajeId: string, dto: RegistrarEntregaDto) {
    const ctx = contextoActual();

    const [viaje] = await gestor().query(
      `SELECT estado FROM viajes WHERE viaje_id = $1`, [viajeId]);
    if (!viaje) throw new NotFoundException('Viaje no encontrado');
    if (!ENTREGABLE.has(viaje.estado))
      throw new ConflictException(
        `El viaje está "${viaje.estado}": sólo se registran entregas mientras descarga`);

    // 1 · Regla 7 · La línea tiene que ser de una orden asignada a ESTE viaje.
    const [detalle] = await gestor().query(
      `SELECT d.detalle_orden_id, d.orden_id, d.producto_id, d.tolerancia,
              d.volumen_solicitado, d.volumen_entregado,
              o.estacion_id, p.tolerancia_merma
         FROM detalles_orden d
         JOIN viaje_ordenes vo ON vo.orden_id = d.orden_id AND vo.viaje_id = $2
         JOIN ordenes_abastecimiento o ON o.orden_id = d.orden_id
         JOIN productos_combustible p ON p.producto_id = d.producto_id
        WHERE d.detalle_orden_id = $1`, [dto.detalleOrdenId, viajeId]);
    if (!detalle) throw new BadRequestException(
      'Esa línea de orden no pertenece a ninguna orden asignada a este viaje');

    // 2 · Regla 17 · Sólo se entrega desde el compartimento que llevó esa carga.
    const [carga] = await gestor().query(
      `SELECT volumen_planificado FROM plan_carga
        WHERE viaje_id = $1 AND compartimento_id = $2 AND detalle_orden_id = $3`,
      [viajeId, dto.compartimentoId, dto.detalleOrdenId]);
    if (!carga) throw new BadRequestException(
      'Ese compartimento no lleva carga de esa línea en este viaje');

    // 3 · §10.4 · Si vienen medidores, el volumen descargado sale de la resta.
    const volumenDescargado = medido(dto);

    // 4 · Regla 9 · La diferencia contra lo CARGADO decide si hace falta que
    //     alguien más la apruebe. Se compara en valor absoluto: recibir de más
    //     es tan anómalo como recibir de menos, y sólo mirar un lado dejaría
    //     pasar la mitad de los descuadres.
    const volumenCargado = Number(carga.volumen_planificado);
    const tolerancia = toleranciaDe(detalle);
    const merma = volumenCargado > 0
      ? ((volumenCargado - dto.volumenRecibido) / volumenCargado) * 100
      : 0;
    const dentro = Math.abs(merma) <= tolerancia;

    let creada;
    try {
      [creada] = await gestor().query(
        `INSERT INTO entregas
           (empresa_id, viaje_id, orden_id, detalle_orden_id, estacion_id, producto_id,
            compartimento_id, volumen_cargado, volumen_descargado, volumen_recibido,
            medidor_inicial, medidor_final, sello_recibido, estado_sello,
            receptor_nombre, receptor_documento, firma_digital, latitud, longitud,
            fecha_llegada, documento_entrega, observaciones, estado)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
         RETURNING ${CAMPOS.replace(/e\./g, '')}`,
        [ctx.empresaId, viajeId, detalle.orden_id, dto.detalleOrdenId, detalle.estacion_id,
         detalle.producto_id, dto.compartimentoId, volumenCargado, volumenDescargado,
         dto.volumenRecibido, dto.medidorInicial ?? null, dto.medidorFinal ?? null,
         dto.selloRecibido ?? null, dto.estadoSello ?? null, dto.receptorNombre,
         dto.receptorDocumento ?? null, dto.firmaDigital ?? null, dto.latitud, dto.longitud,
         dto.fechaLlegada ?? null, dto.documentoEntrega ?? null, dto.observaciones ?? null,
         dentro ? 'aceptada' : 'pendiente']);
    } catch (e) {
      traducir(e);
    }

    // 5 · Regla 20 · «Las entregas parciales deben actualizar automáticamente
    //     el volumen pendiente». Se suma el acumulado y `volumen_pendiente`,
    //     que es GENERATED, se mueve solo. La cota superior la impone
    //     `ck_detalles_entregado_cabe`: sin ella el pendiente quedaría negativo
    //     y la orden parecería deber volumen que ya se entregó.
    try {
      await gestor().query(
        `UPDATE detalles_orden
            SET volumen_entregado = volumen_entregado + $2,
                estado = CASE WHEN volumen_entregado + $2 >= volumen_solicitado
                              THEN 'completo' ELSE 'parcial' END,
                actualizado_en = now()
          WHERE detalle_orden_id = $1`, [dto.detalleOrdenId, dto.volumenRecibido]);
    } catch (e) {
      traducir(e);
    }

    auditar({
      entidad: 'entregas', entidadId: String(creada.id),
      valorNuevo: { ...dto, volumenCargado, porcentajeMerma: merma, estado: creada.estado },
    });
    return this.obtener(String(creada.id));
  }

  /** Regla 9 · Aceptar una diferencia fuera de tolerancia, con constancia. */
  async aprobar(id: string, dto: AprobarEntregaDto) {
    const ctx = contextoActual();
    const antes = await this.obtener(id);
    if (antes.estado !== 'pendiente')
      throw new ConflictException(`La entrega no está pendiente: está "${antes.estado}"`);
    if (!dto?.motivo) throw new BadRequestException('Aprobar una diferencia exige un motivo');

    await gestor().query(
      `UPDATE entregas
          SET estado = 'aceptada', aprobada_por = $2, aprobada_en = now(),
              motivo_aprobacion = $3, actualizado_en = now()
        WHERE entrega_id = $1`, [id, ctx.usuarioId, dto.motivo]);

    const despues = await this.obtener(id);
    auditar({
      entidad: 'entregas', entidadId: String(id), motivo: dto.motivo,
      valorAnterior: { estado: antes.estado },
      valorNuevo: { estado: 'aceptada', aprobadaPor: ctx.usuarioId },
    });
    return despues;
  }

  /** El otro final posible: la estación no acepta la carga. */
  async rechazar(id: string, dto: RechazarEntregaDto) {
    const ctx = contextoActual();
    const antes = await this.obtener(id);
    if (antes.estado !== 'pendiente')
      throw new ConflictException(`La entrega no está pendiente: está "${antes.estado}"`);

    // Se devuelve el volumen a la línea: si no, quedaría entregado para siempre
    // y la orden parecería cubierta sin estarlo. Es la misma devolución que
    // `quitarLineaPlan`, y por el mismo motivo.
    await gestor().query(
      `UPDATE detalles_orden
          SET volumen_entregado = volumen_entregado - $2,
              estado = CASE WHEN volumen_entregado - $2 <= 0 THEN 'pendiente' ELSE 'parcial' END,
              actualizado_en = now()
        WHERE detalle_orden_id = $1`, [antes.detalleOrdenId, antes.volumenRecibido]);
    await gestor().query(
      `UPDATE entregas
          SET estado = 'rechazada', aprobada_por = $2, aprobada_en = now(),
              motivo_aprobacion = $3, actualizado_en = now()
        WHERE entrega_id = $1`, [id, ctx.usuarioId, dto.motivo]);

    auditar({
      entidad: 'entregas', entidadId: String(id), motivo: dto.motivo,
      valorAnterior: { estado: antes.estado, volumenRecibido: antes.volumenRecibido },
      valorNuevo: { estado: 'rechazada' },
    });
    return this.obtener(id);
  }
}

/**
 * §10.4 · «Volumen medido = lectura final − lectura inicial».
 *
 * Media lectura no permite calcular nada, así que o vienen las dos o ninguna.
 */
function medido(dto: RegistrarEntregaDto): number | null {
  const { medidorInicial: ini, medidorFinal: fin } = dto;
  if (ini == null && fin == null) return null;
  if (ini == null || fin == null)
    throw new BadRequestException('Los medidores van en pareja: falta la lectura inicial o la final');
  if (fin < ini)
    throw new BadRequestException(
      `El medidor final (${fin}) no puede ser menor que el inicial (${ini})`);
  return fin - ini;
}

/**
 * La tolerancia que manda es la de la LÍNEA cuando está declarada, y la del
 * producto si no.
 *
 * La línea es más específica: un cliente puede negociar una tolerancia distinta
 * para un pedido concreto. Cuando nadie la declara —el 0 por omisión de la
 * columna— se cae a la del producto, que es una propiedad física del
 * combustible y no una condición comercial.
 */
function toleranciaDe(detalle: { tolerancia?: string; tolerancia_merma?: string }): number {
  const linea = Number(detalle.tolerancia ?? 0);
  return linea > 0 ? linea : Number(detalle.tolerancia_merma ?? 0);
}

/** Las restricciones de la base que son reglas de negocio, en su idioma. */
function traducir(e: unknown): never {
  const restriccion = (e as { constraint?: string })?.constraint ?? '';
  if (restriccion === 'ck_detalles_entregado_cabe')
    throw new ConflictException(
      'Esa entrega dejaría la orden con más volumen entregado del que pidió');
  if (restriccion === 'ck_entregas_geo')
    throw new BadRequestException('La geolocalización de la entrega no es una coordenada válida');
  if (restriccion === 'ck_entregas_medidores')
    throw new BadRequestException('El medidor final no puede ser menor que el inicial');
  throw e as Error;
}
