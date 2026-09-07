import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { auditar, contextoActual, gestor } from '../../common/contexto/contexto-peticion';
import { RegistrarEventoDto, AnularEventoDto } from './dto/eventos.dto';

const CAMPOS = `e.evento_id AS id, e.viaje_id AS "viajeId", e.tipo_evento AS "tipoEvento",
                e.fecha_hora AS "fechaHora", e.latitud, e.longitud, e.velocidad, e.odometro,
                e.usuario_id AS "usuarioId", e.dispositivo_id AS "dispositivoId",
                e.origen_dato AS "origenDato", e.observacion, e.evidencia,
                e.anula_evento_id AS "anulaEventoId",
                e.hash_anterior AS "hashAnterior", e.hash_evento AS "hashEvento",
                e.id_cliente AS "idCliente",
                e.creado_en AS "creadoEn"`;

/**
 * El separador de los campos dentro del hash.
 *
 * Es el separador de unidad de ASCII, y no una coma o un guion, porque no puede
 * aparecer dentro de una observacion escrita por una persona. Con un separador
 * que si pudiera aparecer, dos eventos distintos podrian producir la misma
 * cadena moviendo texto de un campo al siguiente — y por tanto el mismo hash.
 */
const SEP = '\u001f';

/**
 * El hash de un evento.
 *
 * Incluye el del anterior: asi el hash no dice solo «esta fila no cambio» sino
 * «esta fila no cambio Y viene exactamente despues de aquella». Un hash por
 * fila suelto no detecta que se borro una del medio ni que se reordenaron, que
 * es la mitad de lo que interesa vigilar en una traza.
 */
export function calcularHash(partes: {
  viajeId: string; tipoEvento: string; fechaHora: string;
  latitud?: number | null; longitud?: number | null; odometro?: number | null;
  usuarioId?: string | null; observacion?: string | null;
  anulaEventoId?: string | null; hashAnterior: string | null;
}): string {
  const cadena = [
    partes.viajeId, partes.tipoEvento, partes.fechaHora,
    partes.latitud ?? '', partes.longitud ?? '', partes.odometro ?? '',
    partes.usuarioId ?? '', partes.observacion ?? '', partes.anulaEventoId ?? '',
    // El primero de la cadena no tiene anterior, y se marca en vez de dejarse
    // vacio: si no, un evento con `hash_anterior` borrado a mano pasaria por
    // genesis y la cadena validaria desde el.
    partes.hashAnterior ?? 'GENESIS',
  ].join(SEP);
  return createHash('sha256').update(cadena, 'utf8').digest('hex');
}

@Injectable()
export class EventosService {
  async listarDeViaje(viajeId: string) {
    return gestor().query(
      `SELECT ${CAMPOS} FROM eventos_viaje e
        WHERE e.viaje_id = $1 ORDER BY e.evento_id`, [viajeId]);
  }

  async obtener(id: string) {
    const [fila] = await gestor().query(
      `SELECT ${CAMPOS} FROM eventos_viaje e WHERE e.evento_id = $1`, [id]);
    if (!fila) throw new NotFoundException('Evento no encontrado');
    return fila;
  }

  /**
   * @param idCliente identificador generado por el DISPOSITIVO, cuando el
   * evento viene de la cola de salida de la app (2A). Es lo que permite
   * reconocer un reintento; los eventos creados desde la web no lo traen.
   */
  async registrar(viajeId: string, dto: RegistrarEventoDto, idCliente?: string) {
    const [viaje] = await gestor().query(
      `SELECT viaje_id FROM viajes WHERE viaje_id = $1`, [viajeId]);
    if (!viaje) throw new NotFoundException('Viaje no encontrado');

    if ((dto.latitud == null) !== (dto.longitud == null))
      throw new BadRequestException(
        'La geolocalizacion va en pareja: media coordenada no ubica nada');

    return this.insertar(viajeId, {
      tipoEvento: dto.tipoEvento, origenDato: dto.origenDato,
      fechaHora: dto.fechaHora ?? new Date().toISOString(),
      latitud: dto.latitud, longitud: dto.longitud, velocidad: dto.velocidad,
      odometro: dto.odometro, dispositivoId: dto.dispositivoId,
      observacion: dto.observacion, evidencia: dto.evidencia, idCliente,
    });
  }

  /**
   * Anular un evento (§7.15): NO se borra, se le anade una correccion.
   *
   * El anulado se queda en la traza y la correccion apunta a el. Una traza en
   * la que las cosas desaparecen no es una traza — y aqui, ademas, borrar
   * romperia la cadena de hashes de todo lo que vino despues.
   */
  async anular(eventoId: string, dto: AnularEventoDto) {
    const objetivo = await this.obtener(eventoId);
    if (objetivo.tipoEvento === 'correccion')
      throw new ConflictException('Una correccion no se anula: se corrige con otra');

    const [ya] = await gestor().query(
      `SELECT evento_id FROM eventos_viaje WHERE anula_evento_id = $1`, [eventoId]);
    if (ya) throw new ConflictException('Ese evento ya fue anulado');
    if (!dto?.motivo) throw new BadRequestException('Anular un evento exige un motivo');

    return this.insertar(String(objetivo.viajeId), {
      tipoEvento: 'correccion', origenDato: 'web',
      fechaHora: new Date().toISOString(),
      observacion: dto.motivo, anulaEventoId: eventoId,
    });
  }

  /**
   * Recorrer la cadena y decir si alguien la toco.
   *
   * Sin esto el hash seria decoracion: un campo que nadie comprueba no prueba
   * nada. Devuelve el primer eslabon roto, que es donde empieza a no poderse
   * confiar en la traza — lo anterior a el sigue valiendo.
   */
  async verificarIntegridad(viajeId: string) {
    const eventos = await this.listarDeViaje(viajeId);
    let esperado: string | null = null;

    for (const e of eventos) {
      const propio = calcularHash({
        viajeId: String(e.viajeId), tipoEvento: e.tipoEvento,
        fechaHora: new Date(e.fechaHora).toISOString(),
        latitud: e.latitud == null ? null : Number(e.latitud),
        longitud: e.longitud == null ? null : Number(e.longitud),
        odometro: e.odometro == null ? null : Number(e.odometro),
        usuarioId: e.usuarioId == null ? null : String(e.usuarioId),
        observacion: e.observacion,
        anulaEventoId: e.anulaEventoId == null ? null : String(e.anulaEventoId),
        hashAnterior: esperado,
      });
      if (e.hashAnterior !== esperado || e.hashEvento !== propio) {
        return { integra: false, eventos: eventos.length, rotoEn: String(e.id) };
      }
      esperado = e.hashEvento;
    }
    return { integra: true, eventos: eventos.length, rotoEn: null };
  }

  /** El INSERT con el eslabon calculado. */
  private async insertar(viajeId: string, datos: Record<string, unknown>) {
    const ctx = contextoActual();

    const [ultimo] = await gestor().query(
      `SELECT hash_evento FROM eventos_viaje
        WHERE viaje_id = $1 ORDER BY evento_id DESC LIMIT 1`, [viajeId]);
    const hashAnterior: string | null = ultimo?.hash_evento ?? null;

    const hashEvento = calcularHash({
      viajeId, tipoEvento: datos.tipoEvento as string,
      fechaHora: datos.fechaHora as string,
      latitud: (datos.latitud as number | undefined) ?? null,
      longitud: (datos.longitud as number | undefined) ?? null,
      odometro: (datos.odometro as number | undefined) ?? null,
      usuarioId: ctx.usuarioId,
      observacion: (datos.observacion as string | undefined) ?? null,
      anulaEventoId: (datos.anulaEventoId as string | undefined) ?? null,
      hashAnterior,
    });

    let creado;
    try {
      [creado] = await gestor().query(
        `INSERT INTO eventos_viaje
           (empresa_id, viaje_id, tipo_evento, fecha_hora, latitud, longitud, velocidad,
            odometro, usuario_id, dispositivo_id, origen_dato, observacion, evidencia,
            anula_evento_id, hash_anterior, hash_evento, id_cliente)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         RETURNING evento_id`,
        [ctx.empresaId, viajeId, datos.tipoEvento, datos.fechaHora,
         datos.latitud ?? null, datos.longitud ?? null, datos.velocidad ?? null,
         datos.odometro ?? null, ctx.usuarioId, datos.dispositivoId ?? null,
         datos.origenDato, datos.observacion ?? null, datos.evidencia ?? null,
         datos.anulaEventoId ?? null, hashAnterior, hashEvento,
         datos.idCliente ?? null]);
    } catch (e) {
      const restriccion = (e as { constraint?: string })?.constraint ?? '';
      if (restriccion === 'uq_eventos_encadenado')
        throw new ConflictException(
          'Otro evento se encadeno primero en este viaje; vuelva a intentarlo');
      if (restriccion === 'uq_eventos_id_cliente')
        throw new ConflictException('Ese elemento de la cola ya se sincronizo');
      if (restriccion === 'uq_eventos_hash')
        throw new ConflictException('Ese evento ya esta registrado, identico y en el mismo punto');
      throw e;
    }

    auditar({
      entidad: 'eventos_viaje', entidadId: String(creado.evento_id),
      motivo: datos.anulaEventoId ? (datos.observacion as string) : undefined,
      valorNuevo: { viajeId, tipo: datos.tipoEvento, origen: datos.origenDato },
    });
    return this.obtener(String(creado.evento_id));
  }
}
