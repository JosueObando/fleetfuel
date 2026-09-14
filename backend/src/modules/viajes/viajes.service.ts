import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { auditar, contextoActual, gestor } from '../../common/contexto/contexto-peticion';
import {
  CrearViajeDto, ActualizarViajeDto, CambiarEstadoViajeDto, AsignarOrdenDto, LineaPlanDto,
} from './dto/viajes.dto';
import { FLUJO_VIAJE, EN_MARCHA, PLANIFICABLE, SIN_SALIR_SQL } from './estados';
import { ordenesDelViaje, sincronizarEstadoDeOrdenes } from '../ordenes/estado-derivado';
import { ADMITEN_VIAJE } from '../ordenes/estados';

const CAMPOS = `v.viaje_id AS id, v.codigo_viaje AS "codigoViaje", v.tipo_viaje AS "tipoViaje",
                v.cabezal_id AS "cabezalId", v.cisterna_id AS "cisternaId",
                v.conductor_id AS "conductorId", cd.nombre_completo AS conductor,
                v.conductor_auxiliar_id AS "conductorAuxiliarId",
                v.fecha_programada AS "fechaProgramada", v.fecha_inicio AS "fechaInicio",
                v.fecha_fin AS "fechaFin", v.estado, v.motivo_cancelacion AS "motivoCancelacion",
                v.autorizado_por AS "autorizadoPor", v.odometro_inicial AS "odometroInicial",
                v.odometro_final AS "odometroFinal", v.kilometros_gps AS "kilometrosGps",
                v.ruta_planificada AS "rutaPlanificada",
                ARRAY(SELECT e.nombre FROM viaje_ordenes vo
                        JOIN ordenes_abastecimiento o ON o.orden_id = vo.orden_id
                        JOIN estaciones_servicio e ON e.estacion_id = o.estacion_id
                       WHERE vo.viaje_id = v.viaje_id ORDER BY vo.secuencia_entrega) AS destinos,
                (v.fecha_programada < now() AND v.estado IN (${SIN_SALIR_SQL})) AS retrasado`;

/** La ventana de tiempo que pide el planificador: los dos extremos o ninguno. */
export interface Ventana { desde?: string; hasta?: string }

function ventanaValida(v?: Ventana): { desde: string; hasta: string } | null {
  if (!v || (v.desde === undefined && v.hasta === undefined)) return null;
  const desde = Date.parse(v.desde ?? ''), hasta = Date.parse(v.hasta ?? '');
  /* Se normaliza a ISO aquí: lo que llega al `::timestamptz` ya es una fecha
     que Postgres entiende, y un texto raro es un 400 y no un 500 del cast. */
  if (Number.isNaN(desde) || Number.isNaN(hasta))
    throw new BadRequestException('La ventana necesita fechas válidas');
  if (hasta <= desde) throw new BadRequestException('La ventana termina antes de empezar');
  return { desde: new Date(desde).toISOString(), hasta: new Date(hasta).toISOString() };
}

const DESDE = `FROM viajes v LEFT JOIN conductores cd ON cd.conductor_id = v.conductor_id`;

/**
 * Lo que la base rechaza de un viaje, traducido a algo que se puede corregir.
 *
 * Un choque con la exclusión de §5.1 llega como 23P01: «esa cisterna ya está
 * ocupada a esa hora» es una regla de negocio perfectamente normal, no un 500.
 *
 * Las otras tres tampoco las puede ver el servicio mirando sólo la petición:
 * una edición trae UN campo y el resto está guardado. El odómetro final se
 * compara con el inicial ya anotado; el fin previsto, con la hora a la que el
 * viaje empieza a ocupar —la programada o, ya arrancado, la real—. Anterior, ni
 * siquiera se puede construir el `tstzrange` del periodo (22000); IGUAL, el
 * rango sale vacío y no reservaría nada (`ck_viajes_periodo_no_vacio`).
 */
function traducirRestricciones(e: unknown, codigoViaje?: string): never {
  const { code: codigo, constraint: restriccion = '', message: mensaje = '' } =
    (e ?? {}) as { code?: string; constraint?: string; message?: string };
  if (codigo === '23P01') {
    const quien = restriccion.includes('conductor') ? 'El conductor' : 'La cisterna';
    throw new ConflictException(`${quien} ya tiene otro viaje que se superpone en esas fechas`);
  }
  if (restriccion === 'ck_viajes_odometro')
    throw new BadRequestException('El odómetro final no puede ser menor que el inicial');
  /* No se mira `ck_viajes_fechas`: la columna generada `periodo` se calcula
     ANTES que los CHECK, así que un fin invertido revienta siempre en el 22000. */
  if ((codigo === '22000' && mensaje.includes('range lower bound'))
      || restriccion === 'ck_viajes_periodo_no_vacio')
    throw new BadRequestException('El fin previsto tiene que ser posterior al inicio del viaje');
  if (restriccion === 'uq_viajes_empresa_codigo')
    throw new ConflictException(`Ya existe un viaje con el código ${codigoViaje}`);
  throw e as Error;
}

@Injectable()
export class ViajesService {
  async listar(estado?: string, ventana?: Ventana) {
    const v = ventanaValida(ventana);
    /* «Ocupa algo de la ventana» con la misma cuenta que `periodo`: desde la
       salida real o la programada, hasta el fin EXCLUIDO; sin fin, sin límite. */
    const filas = await gestor().query(
      `SELECT ${CAMPOS} ${DESDE}
        WHERE ($1::text IS NULL OR v.estado = $1)
          AND ($2::timestamptz IS NULL
               OR (coalesce(v.fecha_inicio, v.fecha_programada) < $3::timestamptz
                   AND coalesce(v.fecha_fin, 'infinity') > $2::timestamptz))
        ORDER BY v.fecha_programada DESC`, [estado ?? null, v?.desde ?? null, v?.hasta ?? null]);
    return filas.map((f: { estado: string }) => ({
      ...f, transicionesPosibles: FLUJO_VIAJE[f.estado] ?? [],
    }));
  }

  async obtener(id: string) {
    const [viaje] = await gestor().query(`SELECT ${CAMPOS} ${DESDE} WHERE v.viaje_id = $1`, [id]);
    if (!viaje) throw new NotFoundException('Viaje no encontrado');

    viaje.ordenes = await gestor().query(
      `SELECT vo.viaje_orden_id AS id, vo.orden_id AS "ordenId", vo.secuencia_entrega AS secuencia,
              vo.estado, vo.hora_estimada AS "horaEstimada", vo.hora_real AS "horaReal",
              e.nombre AS estacion
         FROM viaje_ordenes vo
         JOIN ordenes_abastecimiento o ON o.orden_id = vo.orden_id
         JOIN estaciones_servicio e ON e.estacion_id = o.estacion_id
        WHERE vo.viaje_id = $1 ORDER BY vo.secuencia_entrega`, [id]);

    viaje.planCarga = await gestor().query(
      `SELECT pc.plan_carga_id AS id, pc.compartimento_id AS "compartimentoId",
              cc.numero AS compartimento, cc.capacidad_calibrada AS "capacidadCalibrada",
              pc.detalle_orden_id AS "detalleOrdenId", pc.producto_id AS "productoId",
              p.nombre AS producto, pc.volumen_planificado AS "volumenPlanificado", pc.estado
         FROM plan_carga pc
         JOIN compartimentos_cisterna cc ON cc.compartimento_id = pc.compartimento_id
         JOIN productos_combustible p ON p.producto_id = pc.producto_id
        WHERE pc.viaje_id = $1 ORDER BY cc.numero`, [id]);

    viaje.transicionesPosibles = FLUJO_VIAJE[viaje.estado] ?? [];
    /** Cisterna, conductor y fecha sólo se cambian antes de salir. */
    viaje.admiteReplanificacion = !EN_MARCHA.has(viaje.estado);
    return viaje;
  }

  async crear(dto: CrearViajeDto) {
    const ctx = contextoActual();
    try {
      const [creado] = await gestor().query(
        `INSERT INTO viajes
           (empresa_id, codigo_viaje, tipo_viaje, cabezal_id, cisterna_id, conductor_id,
            conductor_auxiliar_id, origen_id, terminal_carga_id, fecha_programada,
            fecha_fin, ruta_planificada)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING viaje_id AS id`,
        [ctx.empresaId, dto.codigoViaje, dto.tipoViaje ?? 'simple', dto.cabezalId ?? null,
         dto.cisternaId ?? null, dto.conductorId ?? null, dto.conductorAuxiliarId ?? null,
         dto.origenId ?? null, dto.terminalCargaId ?? null, dto.fechaProgramada,
         dto.fechaFin ?? null, dto.rutaPlanificada ?? null]);
      const completo = await this.obtener(creado.id);
      auditar({ entidad: 'viajes', entidadId: String(creado.id), valorNuevo: completo });
      return completo;
    } catch (e) { traducirRestricciones(e, dto.codigoViaje); }
  }

  async actualizar(id: string, dto: ActualizarViajeDto) {
    const antes = await this.obtener(id);
    /* Un viaje autorizado ya no se replanifica: cambiarle la cisterna o el
       conductor cuando el camión va camino de la terminal deja el papel y la
       realidad contando cosas distintas. */
    if (!antes.admiteReplanificacion && (dto.cisternaId || dto.conductorId || dto.fechaProgramada))
      throw new ConflictException(
        `El viaje está "${antes.estado}": ya no admite cambios de asignación ni de fecha`);

    /* La cisterna no se toca mientras haya plan de carga.
       El plan apunta a COMPARTIMENTOS, y los compartimentos son de una cisterna
       concreta: cambiarla —o quitarla— deja líneas que hablan de un tanque que
       ya no es el del viaje. `autorizar` lo cazaba tres pasos después, que
       impide que el viaje salga pero no impide que el estado incoherente
       exista. Se rechaza en el origen: para cambiar de cisterna, primero se
       vacía el plan.

       `dto.cisternaId !== undefined` y no `dto.cisternaId`: el nulo explícito
       —que `@IsOptional()` deja pasar— es justamente el caso que se colaba. */
    if (dto.cisternaId !== undefined
        && String(dto.cisternaId ?? '') !== String(antes.cisternaId ?? '')
        && antes.planCarga.length > 0) {
      throw new ConflictException(
        'El viaje tiene plan de carga sobre los compartimentos de su cisterna actual: ' +
        'vacía el plan antes de cambiarla o quitarla');
    }

    const columnas: Record<string, unknown> = {
      codigo_viaje: dto.codigoViaje, tipo_viaje: dto.tipoViaje, cabezal_id: dto.cabezalId,
      cisterna_id: dto.cisternaId, conductor_id: dto.conductorId,
      conductor_auxiliar_id: dto.conductorAuxiliarId, origen_id: dto.origenId,
      terminal_carga_id: dto.terminalCargaId, fecha_programada: dto.fechaProgramada,
      fecha_fin: dto.fechaFin, ruta_planificada: dto.rutaPlanificada,
      odometro_inicial: dto.odometroInicial, odometro_final: dto.odometroFinal,
      kilometros_gps: dto.kilometrosGps,
    };
    const presentes = Object.entries(columnas).filter(([, v]) => v !== undefined);
    if (!presentes.length) return antes;

    try {
      await gestor().query(
        `UPDATE viajes SET ${presentes.map(([c], i) => `${c} = $${i + 2}`).join(', ')},
                actualizado_en = now() WHERE viaje_id = $1`,
        [id, ...presentes.map(([, v]) => v)]);
    } catch (e) { traducirRestricciones(e, dto.codigoViaje); }

    const despues = await this.obtener(id);
    auditar({ entidad: 'viajes', entidadId: String(id), valorAnterior: antes, valorNuevo: despues });
    return despues;
  }

  async cambiarEstado(id: string, dto: CambiarEstadoViajeDto) {
    const antes = await this.obtener(id);
    const permitidas = FLUJO_VIAJE[antes.estado] ?? [];
    if (!permitidas.includes(dto.estado))
      throw new ConflictException(
        permitidas.length === 0
          ? `"${antes.estado}" es un estado final: el viaje ya no cambia`
          : `No se puede pasar de "${antes.estado}" a "${dto.estado}". Posibles: ${permitidas.join(', ')}`);

    if (dto.estado === 'cancelado' && !dto.motivo)
      throw new BadRequestException('Cancelar un viaje exige indicar el motivo');

    /* Un viaje no sale sin plan de carga: sería un camión yendo a la terminal
       sin saber qué recoger ni para quién. */
    if (dto.estado === 'desplazamiento_terminal' && antes.planCarga.length === 0)
      throw new ConflictException('El viaje no tiene plan de carga');

    // Las marcas de tiempo las pone el sistema al cruzar el estado, no el
    // cliente: una fecha de inicio escrita a mano se puede falsear.
    const marca =
      dto.estado === 'desplazamiento_terminal' ? ', fecha_inicio = coalesce(fecha_inicio, now())'
      : dto.estado === 'cerrado' ? ', fecha_cierre = now(), fecha_fin = coalesce(fecha_fin, now())'
      : '';

    /* Traducido como en `crear` y `actualizar`, y aquí hace MÁS falta que allí.
       `periodo` es `tstzrange(coalesce(fecha_inicio, fecha_programada), fecha_fin)`,
       así que estampar `fecha_inicio = now()` estira el periodo desde este
       momento hasta el fin previsto: un viaje programado para dentro de unos
       meses que arranca hoy pasa a ocupar todo lo que hay en medio y choca con
       cualquier otro viaje abierto de esa cisterna. Es el único de los tres
       caminos donde el periodo cambia sin que nadie toque una fecha, y era el
       único sin traducir — así que la situación de negocio más corriente de
       todas, «esa cisterna ya está ocupada», salía como un 500 con el nombre de
       una restricción dentro. */
    try {
      await gestor().query(
        `UPDATE viajes SET estado = $2, motivo_cancelacion = coalesce($3, motivo_cancelacion),
                actualizado_en = now()${marca}
          WHERE viaje_id = $1`, [id, dto.estado, dto.motivo ?? null]);
    } catch (e) { traducirRestricciones(e); }

    // El momento del viaje mueve el de sus órdenes (§8.1 ↔ §8.2).
    await sincronizarEstadoDeOrdenes(await ordenesDelViaje(id));

    auditar({
      entidad: 'viajes', entidadId: String(id),
      valorAnterior: { estado: antes.estado },
      valorNuevo: { estado: dto.estado, motivo: dto.motivo ?? null },
    });
    return this.obtener(id);
  }

  /**
   * Autorización (§8.2) — acción con permiso propio: `viajes:autorizar`.
   *
   * Quien planifica no autoriza. Es el control que separa armar un viaje de
   * dejarlo salir, y la razón por la que el Planificador de flota no tiene
   * este permiso aunque sea quien crea los viajes.
   */
  async autorizar(id: string) {
    const ctx = contextoActual();
    const antes = await this.obtener(id);
    if (antes.estado !== 'programado')
      throw new ConflictException(`Solo se autoriza un viaje "programado"; este está "${antes.estado}"`);
    if (antes.planCarga.length === 0)
      throw new ConflictException('El viaje no tiene plan de carga');
    if (!antes.cisternaId || !antes.conductorId)
      throw new ConflictException('El viaje necesita cisterna y conductor asignados');

    // Regla 13 · «Los documentos vencidos bloquearán la asignación.»
    //
    // Se comprueba AQUÍ y no al asignar, porque §5 le da al Despachador
    // «autoriza salida y verifica documentos» y porque una licencia puede
    // caducar entre el día que se planifica el viaje y el día que sale: mirar
    // sólo al asignar dejaría salir en marzo un viaje armado en enero con una
    // licencia que venció en febrero.
    await documentosAlDia(antes.conductorId, antes.cisternaId);

    await gestor().query(
      `UPDATE viajes SET estado = 'autorizado', autorizado_por = $2, actualizado_en = now()
        WHERE viaje_id = $1`, [id, ctx.usuarioId]);
    auditar({
      entidad: 'viajes', entidadId: String(id),
      valorAnterior: { estado: 'programado' },
      valorNuevo: { estado: 'autorizado', autorizadoPor: ctx.usuarioId },
    });
    return this.obtener(id);
  }

  // ── Órdenes del viaje ─────────────────────────────────────────────────────
  async asignarOrden(viajeId: string, dto: AsignarOrdenDto) {
    const ctx = contextoActual();
    const viaje = await this.obtener(viajeId);
    if (!PLANIFICABLE.has(viaje.estado))
      throw new ConflictException(`El viaje está "${viaje.estado}": ya no admite órdenes nuevas`);

    const [orden] = await gestor().query(
      `SELECT estado FROM ordenes_abastecimiento
        WHERE orden_id = $1 AND eliminado_en IS NULL`, [dto.ordenId]);
    if (!orden) throw new BadRequestException('La orden indicada no existe');
    if (!ADMITEN_VIAJE.includes(orden.estado))
      throw new ConflictException(
        `Una orden "${orden.estado}" no se puede asignar a un viaje; debe estar validada`);

    try {
      await gestor().query(
        `INSERT INTO viaje_ordenes (empresa_id, viaje_id, orden_id, secuencia_entrega, hora_estimada)
         VALUES ($1,$2,$3,$4,$5)`,
        [ctx.empresaId, viajeId, dto.ordenId, dto.secuenciaEntrega, dto.horaEstimada ?? null]);
    } catch (e) {
      if ((e as { code?: string }).code === '23505')
        throw new ConflictException('Esa orden ya está en el viaje, o esa secuencia ya está ocupada');
      throw e;
    }
    auditar({ entidad: 'viaje_ordenes', entidadId: String(viajeId), valorNuevo: { ...dto } });
    // §9 etapa 2: con el viaje creado y la orden dentro, «la orden pasa a Planificada».
    await sincronizarEstadoDeOrdenes([dto.ordenId]);
    return this.obtener(viajeId);
  }

  // ── Plan de carga ─────────────────────────────────────────────────────────
  /**
   * Asignar volumen de una línea de orden a un compartimento.
   *
   * Es el «motor de cálculo» del §16: cuatro reglas que ninguna restricción de
   * columna puede expresar sola, porque todas comparan filas de tablas
   * distintas.
   */
  async agregarLineaPlan(viajeId: string, dto: LineaPlanDto) {
    const ctx = contextoActual();
    const viaje = await this.obtener(viajeId);
    if (!PLANIFICABLE.has(viaje.estado))
      throw new ConflictException(`El viaje está "${viaje.estado}": el plan de carga ya está cerrado`);
    if (!viaje.cisternaId) throw new ConflictException('El viaje no tiene cisterna asignada');

    // 1 · El compartimento tiene que ser de LA cisterna de este viaje.
    const [comp] = await gestor().query(
      `SELECT cisterna_id, capacidad_calibrada, producto_permitido
         FROM compartimentos_cisterna WHERE compartimento_id = $1`, [dto.compartimentoId]);
    if (!comp) throw new BadRequestException('El compartimento indicado no existe');
    if (String(comp.cisterna_id) !== String(viaje.cisternaId))
      throw new BadRequestException('Ese compartimento no pertenece a la cisterna del viaje');

    // 2 · La línea de orden tiene que ser de una orden asignada a este viaje.
    const [detalle] = await gestor().query(
      `SELECT d.detalle_orden_id, d.producto_id, d.volumen_solicitado, d.volumen_planificado
         FROM detalles_orden d
         JOIN viaje_ordenes vo ON vo.orden_id = d.orden_id AND vo.viaje_id = $2
        WHERE d.detalle_orden_id = $1`, [dto.detalleOrdenId, viajeId]);
    if (!detalle) throw new BadRequestException(
      'Esa línea de orden no pertenece a ninguna orden asignada a este viaje');

    // 3 · No cabe más de lo que el compartimento tiene calibrado.
    if (dto.volumenPlanificado > Number(comp.capacidad_calibrada))
      throw new BadRequestException(
        `El compartimento admite ${comp.capacidad_calibrada} y se intentan cargar ${dto.volumenPlanificado}`);

    // 4 · No se planifica más de lo que la orden pidió.
    const yaPlanificado = Number(detalle.volumen_planificado);
    const restante = Number(detalle.volumen_solicitado) - yaPlanificado;
    if (dto.volumenPlanificado > restante)
      throw new BadRequestException(
        `A esa línea le quedan ${restante} por planificar y se intentan asignar ${dto.volumenPlanificado}`);

    // El producto permitido del compartimento, cuando está declarado, manda:
    // mezclar productos en un tanque contamina la carga.
    if (comp.producto_permitido && String(comp.producto_permitido) !== String(detalle.producto_id))
      throw new BadRequestException('Ese compartimento no admite el producto de esa línea');

    try {
      await gestor().query(
        `INSERT INTO plan_carga
           (empresa_id, viaje_id, compartimento_id, detalle_orden_id, producto_id,
            volumen_planificado, terminal_carga)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [ctx.empresaId, viajeId, dto.compartimentoId, dto.detalleOrdenId,
         detalle.producto_id, dto.volumenPlanificado, dto.terminalCarga ?? null]);
    } catch (e) {
      if ((e as { code?: string }).code === '23505')
        throw new ConflictException('Ese compartimento ya tiene carga asignada en este viaje');
      throw e;
    }

    // El acumulado de la línea se actualiza aquí y no se recalcula al leer:
    // es lo que la regla 4 consulta en la siguiente asignación.
    //
    // Se escribe `volumen_planificado + $2` y NO un total precalculado a
    // propósito: en READ COMMITTED, una segunda petición que espere el cerrojo
    // de esta fila reevalúa la suma sobre la versión ya confirmada. Es lo que
    // hace que `ck_detalles_planificado_cabe` vea el total verdadero y cierre
    // la carrera que la regla 4, por sí sola, no puede cerrar.
    try {
      await gestor().query(
        `UPDATE detalles_orden
            SET volumen_planificado = volumen_planificado + $2, actualizado_en = now()
          WHERE detalle_orden_id = $1`, [dto.detalleOrdenId, dto.volumenPlanificado]);
    } catch (e) {
      // La cota de la base saltando aquí sólo puede significar una cosa: otra
      // petición planificó parte de esta misma línea entre que la regla 4 leyó
      // el acumulado y este UPDATE lo escribió. Es un conflicto de negocio
      // perfectamente normal, y sin esta traducción sería un 500 —el mismo
      // motivo por el que `traducirRestricciones` existe para el 23P01—.
      if ((e as { constraint?: string }).constraint === 'ck_detalles_planificado_cabe')
        throw new ConflictException(
          'Otra planificación ocupó ese volumen mientras se guardaba esta; vuelva a consultar lo que queda por planificar');
      throw e;
    }

    auditar({ entidad: 'plan_carga', entidadId: String(viajeId), valorNuevo: { ...dto } });
    return this.obtener(viajeId);
  }

  async quitarLineaPlan(viajeId: string, planId: string) {
    const viaje = await this.obtener(viajeId);
    if (!PLANIFICABLE.has(viaje.estado))
      throw new ConflictException(`El viaje está "${viaje.estado}": el plan de carga ya está cerrado`);

    const [linea] = await gestor().query(
      `SELECT detalle_orden_id, volumen_planificado FROM plan_carga
        WHERE plan_carga_id = $1 AND viaje_id = $2`, [planId, viajeId]);
    if (!linea) throw new NotFoundException('Esa línea no está en el plan de carga del viaje');

    await gestor().query(`DELETE FROM plan_carga WHERE plan_carga_id = $1`, [planId]);
    // Devolver el volumen a la línea de orden: si no, quedaría planificado
    // para siempre y la orden parecería cubierta sin estarlo.
    await gestor().query(
      `UPDATE detalles_orden
          SET volumen_planificado = volumen_planificado - $2, actualizado_en = now()
        WHERE detalle_orden_id = $1`, [linea.detalle_orden_id, linea.volumen_planificado]);

    auditar({ entidad: 'plan_carga', entidadId: String(planId), valorAnterior: linea });
    return this.obtener(viajeId);
  }
}

/**
 * Regla 13 · Los documentos que tienen que estar vigentes para que un viaje
 * salga a la calle.
 *
 * DOS DECISIONES QUE NO SE DEDUCEN DEL CÓDIGO
 *
 * **El corte es `fecha < current_date`, el mismo que usa la alerta
 * `licencia_por_vencer`.** Un documento vence al final de su día, no al
 * principio, así que el que caduca hoy todavía vale. Que el bloqueo y el aviso
 * compartan el corte es lo que evita que el sistema avise de algo que no
 * bloquea, o bloquee algo de lo que nunca avisó — y esa contradicción es
 * exactamente la forma en que un despachador deja de creerse las alertas.
 *
 * **Sin fecha declarada no se bloquea.** Bloquear por un dato que nadie
 * capturó convertiría la regla en un freno a la carga de datos, y el primer
 * atajo de quien tenga prisa sería inventarse una fecha — con lo que el campo
 * pasaría a contener ruido y la regla dejaría de proteger nada. Lo que falta
 * es un hueco de catálogo, y se ve en `GET /conductores/licencias-por-vencer`.
 */
async function documentosAlDia(conductorId: string, cisternaId: string): Promise<void> {
  const [doc] = await gestor().query(
    `SELECT c.fecha_vencimiento_licencia < current_date AS "licenciaVencida",
            c.nombre_completo AS "conductor",
            ci.fecha_proxima_calibracion < current_date AS "calibracionVencida"
       FROM conductores c
       CROSS JOIN cisternas ci
      WHERE c.conductor_id = $1 AND ci.cisterna_id = $2`, [conductorId, cisternaId]);
  if (!doc) return;

  if (doc.licenciaVencida)
    throw new ConflictException(
      `La licencia de ${doc.conductor} está vencida: no puede salir a ruta (regla 13)`);
  if (doc.calibracionVencida)
    throw new ConflictException(
      'La calibración de la cisterna está vencida: no puede certificar el volumen que ' +
      'transporta (regla 13)');
}
