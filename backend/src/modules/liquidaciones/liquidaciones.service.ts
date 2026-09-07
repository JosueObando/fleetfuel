import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { auditar, contextoActual, gestor } from '../../common/contexto/contexto-peticion';
import {
  CalcularLiquidacionDto, AprobarLiquidacionDto, PagarLiquidacionDto,
} from './dto/liquidaciones.dto';

const CAMPOS = `l.liquidacion_id AS id, l.viaje_id AS "viajeId", l.conductor_id AS "conductorId",
                l.tarifa_base AS "tarifaBase", l.pago_kilometros AS "pagoKilometros",
                l.pago_entregas AS "pagoEntregas", l.reembolsos, l.viaticos,
                l.bonificaciones, l.penalizaciones, l.motivo_ajustes AS "motivoAjustes",
                l.total_pagar AS "totalPagar", l.kilometros,
                l.entregas_contadas AS "entregasContadas",
                l.tarifa_km_usada AS "tarifaKmUsada",
                l.tarifa_entrega_usada AS "tarifaEntregaUsada",
                l.estado, l.calculada_por AS "calculadaPor",
                l.aprobada_por AS "aprobadaPor", l.fecha_aprobacion AS "fechaAprobacion",
                l.pagada_por AS "pagadaPor", l.fecha_pago AS "fechaPago",
                l.referencia_pago AS "referenciaPago",
                cd.nombre_completo AS conductor, v.codigo_viaje AS "codigoViaje"`;

const DESDE = `FROM liquidaciones_conductor l
                 JOIN viajes v ON v.viaje_id = l.viaje_id
                 JOIN conductores cd ON cd.conductor_id = l.conductor_id`;

@Injectable()
export class LiquidacionesService {
  async obtener(id: string) {
    const [fila] = await gestor().query(
      `SELECT ${CAMPOS} ${DESDE} WHERE l.liquidacion_id = $1`, [id]);
    if (!fila) throw new NotFoundException('Liquidación no encontrada');
    return fila;
  }

  async listar(estado?: string) {
    return gestor().query(
      `SELECT ${CAMPOS} ${DESDE}
        WHERE ($1::text IS NULL OR l.estado = $1)
        ORDER BY l.liquidacion_id DESC`, [estado ?? null]);
  }

  async deViaje(viajeId: string) {
    const [fila] = await gestor().query(
      `SELECT ${CAMPOS} ${DESDE} WHERE l.viaje_id = $1`, [viajeId]);
    if (!fila) throw new NotFoundException('Ese viaje todavía no está liquidado');
    return fila;
  }

  /**
   * Calcular la liquidación de un viaje (§10.7, pago combinado).
   *
   * Los tres sumandos derivados se leen del viaje EN ESTE MOMENTO y se guardan
   * junto al resultado —kilómetros, entregas contadas y las tarifas usadas— para
   * poder explicar el número después sin recalcularlo contra un viaje que ya
   * cambió. Una liquidación que se recalcula al leerla deja de ser un documento
   * y pasa a ser una consulta, y entonces «¿por qué le pagamos esto?» no tiene
   * respuesta estable.
   */
  async calcular(viajeId: string, dto: CalcularLiquidacionDto) {
    const ctx = contextoActual();

    const [viaje] = await gestor().query(
      `SELECT v.viaje_id, v.estado, v.conductor_id,
              v.odometro_inicial, v.odometro_final,
              cd.tarifa_base, cd.tarifa_km, cd.tarifa_entrega
         FROM viajes v
         LEFT JOIN conductores cd ON cd.conductor_id = v.conductor_id
        WHERE v.viaje_id = $1`, [viajeId]);
    if (!viaje) throw new NotFoundException('Viaje no encontrado');

    // Regla 12 del §11: no se paga una liquidación sin que el viaje esté
    // cerrado. Se comprueba al CALCULAR y no sólo al pagar, porque una
    // liquidación calculada a mitad de viaje ya lleva números que van a cambiar.
    if (viaje.estado !== 'cerrado')
      throw new ConflictException(
        `El viaje está "${viaje.estado}": sólo se liquida un viaje cerrado (regla 12)`);
    if (!viaje.conductor_id)
      throw new ConflictException('El viaje no tiene conductor: no hay a quién liquidar');

    const ajustes = {
      viaticos: dto?.viaticos ?? 0,
      bonificaciones: dto?.bonificaciones ?? 0,
      penalizaciones: dto?.penalizaciones ?? 0,
    };
    const hayAjustes = Object.values(ajustes).some((v) => v > 0);
    if (hayAjustes && !dto?.motivoAjustes)
      throw new BadRequestException(
        'Los viáticos, bonificaciones y penalizaciones exigen un motivo escrito');

    // ── Los tres derivados ─────────────────────────────────────────────────
    // No se comprueba que sean positivos: la regla 10 del §11 —«el odómetro
    // final debe ser mayor o igual al inicial»— ya vive en `ck_viajes_odometro`,
    // así que un viaje con el odómetro al revés no llega a existir. Repetirlo
    // aquí sería código que ninguna prueba puede alcanzar, y por tanto código
    // que nadie sabrá si sigue funcionando.
    const kilometros = viaje.odometro_final != null && viaje.odometro_inicial != null
      ? Number(viaje.odometro_final) - Number(viaje.odometro_inicial)
      : null;

    const [{ entregas }] = await gestor().query(
      // Sólo las ACEPTADAS: pagar por una entrega rechazada o pendiente de
      // aprobación es pagar por trabajo que todavía nadie dio por bueno.
      `SELECT count(*)::int AS entregas FROM entregas
        WHERE viaje_id = $1 AND estado = 'aceptada'`, [viajeId]);

    const [{ reembolsos }] = await gestor().query(
      // Se DERIVA de los gastos, no se teclea: si se pudiera escribir a mano,
      // la liquidación podría reembolsar un importe que no corresponde a
      // ningún gasto aprobado, y ambos apuntes parecerían correctos.
      `SELECT coalesce(sum(monto), 0) AS reembolsos FROM gastos_viaje
        WHERE viaje_id = $1 AND estado = 'aprobado' AND reembolsable`, [viajeId]);

    const tarifaKm = Number(viaje.tarifa_km ?? 0);
    const tarifaEntrega = Number(viaje.tarifa_entrega ?? 0);
    const pagoKilometros = kilometros != null ? kilometros * tarifaKm : 0;
    const pagoEntregas = entregas * tarifaEntrega;

    let creada;
    try {
      [creada] = await gestor().query(
        `INSERT INTO liquidaciones_conductor
           (empresa_id, viaje_id, conductor_id, tarifa_base, pago_kilometros, pago_entregas,
            reembolsos, viaticos, bonificaciones, penalizaciones, motivo_ajustes,
            kilometros, entregas_contadas, tarifa_km_usada, tarifa_entrega_usada,
            calculada_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         RETURNING liquidacion_id`,
        [ctx.empresaId, viajeId, viaje.conductor_id, Number(viaje.tarifa_base ?? 0),
         pagoKilometros, pagoEntregas, Number(reembolsos),
         ajustes.viaticos, ajustes.bonificaciones, ajustes.penalizaciones,
         dto?.motivoAjustes ?? null, kilometros, entregas, tarifaKm, tarifaEntrega,
         ctx.usuarioId]);
    } catch (e) {
      if ((e as { constraint?: string }).constraint === 'uq_liq_viaje')
        throw new ConflictException(
          'Ese viaje ya está liquidado: liquidarlo dos veces sería pagarlo dos veces');
      throw e;
    }

    auditar({
      entidad: 'liquidaciones_conductor', entidadId: String(creada.liquidacion_id),
      motivo: dto?.motivoAjustes,
      valorNuevo: { viajeId, kilometros, entregas, reembolsos: Number(reembolsos), ...ajustes },
    });
    return this.obtener(String(creada.liquidacion_id));
  }

  /**
   * Aprobar el importe.
   *
   * Quien la calculó no la aprueba: si la misma persona pusiera los ajustes a
   * mano y firmara el total, «liquidación aprobada» no diría nada más que
   * «alguien escribió un número».
   */
  async aprobar(id: string, dto: AprobarLiquidacionDto) {
    const ctx = contextoActual();
    const antes = await this.obtener(id);
    if (antes.estado !== 'pendiente')
      throw new ConflictException(`Esa liquidación ya está "${antes.estado}"`);
    if (String(antes.calculadaPor) === String(ctx.usuarioId))
      throw new ConflictException(
        'Quien calculó la liquidación no puede aprobarla: tiene que hacerlo otra persona');

    await gestor().query(
      `UPDATE liquidaciones_conductor
          SET estado = 'aprobada', aprobada_por = $2, fecha_aprobacion = now(),
              actualizado_en = now()
        WHERE liquidacion_id = $1`, [id, ctx.usuarioId]);

    auditar({
      entidad: 'liquidaciones_conductor', entidadId: String(id), motivo: dto?.observaciones,
      valorAnterior: { estado: 'pendiente' },
      valorNuevo: { estado: 'aprobada', aprobadaPor: ctx.usuarioId, total: antes.totalPagar },
    });
    return this.obtener(id);
  }

  /**
   * Registrar el pago.
   *
   * Acto distinto de aprobar, y con su propio permiso: el §7.18 les da fechas
   * separadas justamente porque firmar el importe y mover el dinero son dos
   * cosas. Y sólo se paga lo aprobado, nunca lo pendiente.
   */
  async pagar(id: string, dto: PagarLiquidacionDto) {
    const ctx = contextoActual();
    const antes = await this.obtener(id);
    if (antes.estado === 'pagada')
      throw new ConflictException('Esa liquidación ya está pagada');
    if (antes.estado !== 'aprobada')
      throw new ConflictException(
        `No se paga una liquidación "${antes.estado}": primero tiene que aprobarla alguien`);
    if (!dto?.referenciaPago)
      throw new BadRequestException('Un pago sin referencia no se puede rastrear');

    await gestor().query(
      `UPDATE liquidaciones_conductor
          SET estado = 'pagada', pagada_por = $2, fecha_pago = now(),
              referencia_pago = $3, actualizado_en = now()
        WHERE liquidacion_id = $1`, [id, ctx.usuarioId, dto.referenciaPago]);

    auditar({
      entidad: 'liquidaciones_conductor', entidadId: String(id), motivo: dto.referenciaPago,
      valorAnterior: { estado: 'aprobada' },
      valorNuevo: { estado: 'pagada', pagadaPor: ctx.usuarioId, total: antes.totalPagar },
    });
    return this.obtener(id);
  }
}
