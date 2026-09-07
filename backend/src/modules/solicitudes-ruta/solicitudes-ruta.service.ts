import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { auditar, contextoActual, gestor } from '../../common/contexto/contexto-peticion';
import { PedirCambioRutaDto, ResolverCambioRutaDto } from './dto/solicitudes-ruta.dto';

const CAMPOS = `s.solicitud_id AS id, s.viaje_id AS "viajeId", s.tipo, s.motivo, s.estado,
                s.solicitada_por AS "solicitadaPor", s.solicitada_en AS "solicitadaEn",
                s.resuelta_por AS "resueltaPor", s.resuelta_en AS "resueltaEn",
                s.motivo_resolucion AS "motivoResolucion",
                up.nombre AS "solicitante", ur.nombre AS "resolvedor",
                v.codigo_viaje AS "codigoViaje"`;

const DESDE = `FROM solicitudes_ruta s
                 JOIN viajes v ON v.viaje_id = s.viaje_id
                 JOIN usuarios up ON up.usuario_id = s.solicitada_por
                 LEFT JOIN usuarios ur ON ur.usuario_id = s.resuelta_por`;

/**
 * Estados en los que pedir un cambio de ruta significa algo.
 *
 * Antes de salir, la ruta se replanifica editando el viaje y no hace falta que
 * nadie apruebe nada: usar este flujo ahí sería pedir permiso para algo que ya
 * se puede hacer. Después de terminar, no hay ruta que cambiar.
 */
const EN_RUTA = new Set([
  'autorizado', 'desplazamiento_terminal', 'espera_carga', 'cargando', 'cargado',
  'transito_estacion', 'descargando', 'retornando',
]);
const TERMINADOS = new Set(['cerrado', 'cancelado', 'pendiente_liquidacion']);

@Injectable()
export class SolicitudesRutaService {
  async obtener(id: string) {
    const [fila] = await gestor().query(
      `SELECT ${CAMPOS} ${DESDE} WHERE s.solicitud_id = $1`, [id]);
    if (!fila) throw new NotFoundException('Solicitud no encontrada');
    return fila;
  }

  async listarDeViaje(viajeId: string) {
    return gestor().query(
      `SELECT ${CAMPOS} ${DESDE} WHERE s.viaje_id = $1 ORDER BY s.solicitud_id DESC`, [viajeId]);
  }

  /** Lo que mira un despachador: lo que espera una decisión suya. */
  async pendientes() {
    return gestor().query(
      `SELECT ${CAMPOS} ${DESDE} WHERE s.estado = 'pendiente' ORDER BY s.solicitada_en`);
  }

  async pedir(viajeId: string, dto: PedirCambioRutaDto) {
    const ctx = contextoActual();
    const [viaje] = await gestor().query(
      `SELECT estado FROM viajes WHERE viaje_id = $1`, [viajeId]);
    if (!viaje) throw new NotFoundException('Viaje no encontrado');

    if (TERMINADOS.has(viaje.estado))
      throw new ConflictException(
        `El viaje ya terminó (está "${viaje.estado}"): no hay ruta que cambiar`);
    if (!EN_RUTA.has(viaje.estado))
      throw new ConflictException(
        `El viaje todavía no ha salido (está "${viaje.estado}"): la ruta se cambia editándolo, ` +
        'sin pedir permiso a nadie');

    const [creada] = await gestor().query(
      `INSERT INTO solicitudes_ruta (empresa_id, viaje_id, tipo, motivo, solicitada_por)
       VALUES ($1,$2,$3,$4,$5) RETURNING solicitud_id`,
      [ctx.empresaId, viajeId, dto.tipo, dto.motivo, ctx.usuarioId]);

    auditar({
      entidad: 'solicitudes_ruta', entidadId: String(creada.solicitud_id),
      motivo: dto.motivo, valorNuevo: { viajeId, tipo: dto.tipo, estado: 'pendiente' },
    });
    return this.obtener(String(creada.solicitud_id));
  }

  /**
   * Aprobar o rechazar.
   *
   * QUIEN PIDE NO RESUELVE, y es la regla que convierte esto en un control en
   * vez de un formulario: sin ella, «solicitud de cambio de ruta» es el
   * conductor autorizándose el desvío y la traza que queda no prueba nada. Es
   * el mismo criterio que separa `viajes:crear` de `viajes:autorizar` y
   * `entregas:crear` de `entregas:aprobar`, por el §7.
   *
   * Va además del permiso `solicitudesruta:resolver`: el permiso dice qué
   * PUEDE hacer un rol, y esto dice qué no puede hacer una PERSONA con su
   * propia solicitud. Un despachador que pide un desvío sigue sin poder
   * aprobárselo, aunque su rol resuelva los de los demás.
   */
  async resolver(id: string, dto: ResolverCambioRutaDto) {
    const ctx = contextoActual();
    const antes = await this.obtener(id);

    if (antes.estado !== 'pendiente')
      throw new ConflictException(`Esa solicitud ya está "${antes.estado}"`);
    if (String(antes.solicitadaPor) === String(ctx.usuarioId))
      throw new ConflictException(
        'Quien la pidió no puede resolverla: tiene que hacerlo otra persona');
    if (!dto?.motivo)
      throw new BadRequestException('Resolver una solicitud exige un motivo');
    if (dto.estado !== 'aprobada' && dto.estado !== 'rechazada')
      throw new BadRequestException('Una resolución sólo puede ser «aprobada» o «rechazada»');

    await gestor().query(
      `UPDATE solicitudes_ruta
          SET estado = $2, resuelta_por = $3, resuelta_en = now(),
              motivo_resolucion = $4, actualizado_en = now()
        WHERE solicitud_id = $1`, [id, dto.estado, ctx.usuarioId, dto.motivo]);

    auditar({
      entidad: 'solicitudes_ruta', entidadId: String(id), motivo: dto.motivo,
      valorAnterior: { estado: 'pendiente' },
      valorNuevo: { estado: dto.estado, resueltaPor: ctx.usuarioId },
    });
    return this.obtener(id);
  }
}
