import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { auditar, contextoActual, gestor } from '../../common/contexto/contexto-peticion';
import { RegistrarGastoDto, ResolverGastoDto } from './dto/gastos.dto';

const CAMPOS = `g.gasto_id AS id, g.viaje_id AS "viajeId", g.categoria, g.descripcion,
                g.monto, g.fecha, g.comprobante, g.pagado_por AS "pagadoPor",
                g.reembolsable, g.estado,
                g.registrado_por AS "registradoPor", g.aprobado_por AS "aprobadoPor",
                g.aprobado_en AS "aprobadoEn", g.motivo_resolucion AS "motivoResolucion",
                ur.nombre AS "registrante", v.codigo_viaje AS "codigoViaje"`;

const DESDE = `FROM gastos_viaje g
                 JOIN viajes v ON v.viaje_id = g.viaje_id
                 JOIN usuarios ur ON ur.usuario_id = g.registrado_por`;

/**
 * Un viaje cerrado o cancelado ya no admite gastos nuevos.
 *
 * La regla 12 del §11 dice que no se paga una liquidación sin el viaje cerrado;
 * si después del cierre siguieran entrando gastos, la liquidación pagada dejaría
 * de cuadrar con el viaje que liquidó. Corregir uno posterior es una decisión
 * consciente —la regla 15 pide que quede auditada— y no un apunte más.
 */
const TERMINADOS = new Set(['cerrado', 'cancelado']);

@Injectable()
export class GastosService {
  async obtener(id: string) {
    const [fila] = await gestor().query(
      `SELECT ${CAMPOS} ${DESDE} WHERE g.gasto_id = $1`, [id]);
    if (!fila) throw new NotFoundException('Gasto no encontrado');
    return fila;
  }

  async listarDeViaje(viajeId: string) {
    return gestor().query(
      `SELECT ${CAMPOS} ${DESDE} WHERE g.viaje_id = $1 ORDER BY g.fecha, g.gasto_id`, [viajeId]);
  }

  async pendientes() {
    return gestor().query(
      `SELECT ${CAMPOS} ${DESDE} WHERE g.estado = 'pendiente' ORDER BY g.fecha, g.gasto_id`);
  }

  /**
   * El total aprobado de un viaje, separando quién puso el dinero.
   *
   * Los rechazados y los pendientes NO suman: un total que incluya lo que nadie
   * ha aprobado es un número que parece un costo y no lo es todavía. Y el
   * reembolsable va aparte porque es lo que la empresa DEBE al conductor, no lo
   * que le costó el viaje: sumarlos daría un costo inflado y una deuda perdida.
   */
  async totales(viajeId: string) {
    const [fila] = await gestor().query(
      `SELECT
         coalesce(sum(monto) FILTER (WHERE estado = 'aprobado'), 0) AS "totalAprobado",
         coalesce(sum(monto) FILTER (WHERE estado = 'aprobado' AND reembolsable), 0)
           AS "reembolsableAlConductor",
         coalesce(sum(monto) FILTER (WHERE estado = 'pendiente'), 0) AS "totalPendiente",
         count(*) FILTER (WHERE estado = 'pendiente') AS "cuantosPendientes"
       FROM gastos_viaje WHERE viaje_id = $1`, [viajeId]);
    return fila;
  }

  async registrar(viajeId: string, dto: RegistrarGastoDto) {
    const ctx = contextoActual();
    const [viaje] = await gestor().query(
      `SELECT estado FROM viajes WHERE viaje_id = $1`, [viajeId]);
    if (!viaje) throw new NotFoundException('Viaje no encontrado');
    if (TERMINADOS.has(viaje.estado))
      throw new ConflictException(
        `El viaje está "${viaje.estado}": un gasto posterior al cierre se corrige, no se añade`);

    if (dto.pagadoPor === 'empresa' && dto.reembolsable)
      throw new BadRequestException(
        'Lo que pagó la empresa no se reembolsa: se estaría pagando dos veces');

    const [creado] = await gestor().query(
      `INSERT INTO gastos_viaje
         (empresa_id, viaje_id, categoria, descripcion, monto, fecha, comprobante,
          pagado_por, reembolsable, registrado_por)
       VALUES ($1,$2,$3,$4,$5,coalesce($6::date, current_date),$7,$8,$9,$10)
       RETURNING gasto_id`,
      [ctx.empresaId, viajeId, dto.categoria, dto.descripcion, dto.monto,
       dto.fecha ?? null, dto.comprobante ?? null, dto.pagadoPor,
       dto.reembolsable ?? false, ctx.usuarioId]);

    auditar({
      entidad: 'gastos_viaje', entidadId: String(creado.gasto_id),
      valorNuevo: { viajeId, ...dto, estado: 'pendiente' },
    });
    return this.obtener(String(creado.gasto_id));
  }

  /**
   * Aprobar o rechazar.
   *
   * QUIEN LO REGISTRA NO LO APRUEBA, y va además del permiso: si el conductor
   * que pone el peaje pudiera aprobárselo, «gasto aprobado» no significaría
   * nada y la liquidación del §10.6 estaría sumando lo que él decidió cobrarse.
   * Es el mismo criterio de `viajes:autorizar`, `entregas:aprobar` y
   * `solicitudesruta:resolver`.
   */
  async resolver(id: string, dto: ResolverGastoDto) {
    const ctx = contextoActual();
    const antes = await this.obtener(id);

    if (antes.estado !== 'pendiente')
      throw new ConflictException(`Ese gasto ya está "${antes.estado}"`);
    if (String(antes.registradoPor) === String(ctx.usuarioId))
      throw new ConflictException(
        'Quien registró el gasto no puede aprobarlo: tiene que hacerlo otra persona');
    if (!dto?.motivo)
      throw new BadRequestException('Resolver un gasto exige un motivo');

    await gestor().query(
      `UPDATE gastos_viaje
          SET estado = $2, aprobado_por = $3, aprobado_en = now(),
              motivo_resolucion = $4, actualizado_en = now()
        WHERE gasto_id = $1`, [id, dto.estado, ctx.usuarioId, dto.motivo]);

    auditar({
      entidad: 'gastos_viaje', entidadId: String(id), motivo: dto.motivo,
      valorAnterior: { estado: 'pendiente', monto: antes.monto },
      valorNuevo: { estado: dto.estado, aprobadoPor: ctx.usuarioId },
    });
    return this.obtener(id);
  }
}
