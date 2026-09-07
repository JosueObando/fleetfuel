import { Injectable, NotFoundException } from '@nestjs/common';
import { gestor } from '../../common/contexto/contexto-peticion';
import { contextoActual } from '../../common/contexto/contexto-peticion';
import { LotePosicionesDto } from './dto/gps.dto';

/**
 * Cuanto puede tardar una posicion en llegar antes de considerar que la
 * telemetria esta CAIDA.
 *
 * El spec de UX pide una marca `stale` para pintar el banner de telemetria
 * caida. 90 s son dieciocho ciclos de la cadencia de 5 s: suficiente para no
 * parpadear en cada tunel, y poco para que el despachador no mire un punto
 * quieto creyendo que el camion esta parado cuando lo que se cayo es el equipo.
 */
const SEGUNDOS_PARA_OBSOLETA = 90;

@Injectable()
export class GpsService {
  /**
   * Ingerir un lote de posiciones.
   *
   * Va en UNA sentencia con `unnest` y no en un bucle de INSERT: a cadencia de
   * 5 s por vehiculo, un bucle serian cientos de idas y vueltas al motor por
   * peticion, y el coste no esta en escribir sino en el viaje.
   *
   * Las particiones se aseguran ANTES, una por cada mes distinto que traiga el
   * lote —normalmente uno, dos si la reconexion cruza fin de mes—.
   */
  async ingerir(lote: LotePosicionesDto) {
    const ctx = contextoActual();

    const [vehiculo] = await gestor().query(
      `SELECT vehiculo_id FROM vehiculos WHERE vehiculo_id = $1 AND eliminado_en IS NULL`,
      [lote.vehiculoId]);
    if (!vehiculo) throw new NotFoundException('Vehiculo no encontrado');

    if (lote.viajeId) {
      const [viaje] = await gestor().query(
        `SELECT viaje_id FROM viajes WHERE viaje_id = $1`, [lote.viajeId]);
      if (!viaje) throw new NotFoundException('Viaje no encontrado');
    }

    const meses = new Set(lote.posiciones.map((p) => p.fechaHora.slice(0, 7)));
    for (const mes of meses) {
      await gestor().query(`SELECT fn_asegurar_particion_gps($1::timestamptz)`, [`${mes}-01`]);
    }

    const filas = lote.posiciones;
    await gestor().query(
      `INSERT INTO posiciones_gps
         (empresa_id, viaje_id, vehiculo_id, dispositivo_id, fecha_hora, ubicacion,
          velocidad, rumbo, altitud, precision_m, origen)
       SELECT $1, $2, $3, d.dispositivo_id,
              f.fecha_hora,
              ST_SetSRID(ST_MakePoint(f.lng, f.lat), 4326)::geography,
              f.velocidad, f.rumbo, f.altitud, f.precision_m, f.origen
         FROM unnest(
                $4::timestamptz[], $5::float8[], $6::float8[], $7::numeric[],
                $8::numeric[], $9::numeric[], $10::numeric[], $11::text[], $12::bigint[]
              ) AS f(fecha_hora, lat, lng, velocidad, rumbo, altitud, precision_m,
                     origen, dispositivo_id)
         LEFT JOIN dispositivos d ON d.dispositivo_id = f.dispositivo_id`,
      [ctx.empresaId, lote.viajeId ?? null, lote.vehiculoId,
       filas.map((p) => p.fechaHora),
       filas.map((p) => p.latitud),
       filas.map((p) => p.longitud),
       filas.map((p) => p.velocidad ?? null),
       filas.map((p) => p.rumbo ?? null),
       filas.map((p) => p.altitud ?? null),
       filas.map((p) => p.precisionM ?? null),
       filas.map((p) => p.origen ?? 'gps'),
       filas.map((p) => p.dispositivoId ?? null)]);

    return { ingeridas: filas.length, particiones: [...meses] };
  }

  /**
   * La ultima posicion de un viaje, con la marca `stale` que el spec pide.
   *
   * `stale` se calcula al leer y no se guarda: una marca almacenada estaria
   * obsoleta en cuanto pasara el tiempo, y hacerla verdad exigiria un proceso
   * que recorriera las filas para envejecerlas — que es justo el proceso que se
   * cae y deja el banner apagado con la telemetria caida.
   */
  async ultimaDe(viajeId: string) {
    const [fila] = await gestor().query(
      `SELECT posicion_id AS id, fecha_hora AS "fechaHora",
              ST_Y(ubicacion::geometry) AS latitud,
              ST_X(ubicacion::geometry) AS longitud,
              velocidad, rumbo, altitud, precision_m AS "precisionM", origen,
              extract(epoch FROM (now() - fecha_hora))::int AS "antiguedadSegundos",
              (now() - fecha_hora) > interval '${SEGUNDOS_PARA_OBSOLETA} seconds' AS stale
         FROM posiciones_gps
        WHERE viaje_id = $1
        ORDER BY fecha_hora DESC
        LIMIT 1`, [viajeId]);
    // Sin posiciones tambien es informacion, y la de peor noticia: no hay nada
    // que pintar. Se devuelve `stale: true` en vez de null para que el panel no
    // tenga que distinguir dos formas de «no hay senal».
    return fila ?? { id: null, stale: true, antiguedadSegundos: null, fechaHora: null };
  }

  /** El recorrido, para pintar la polilinea del mapa. */
  async recorridoDe(viajeId: string, limite = 1000) {
    return gestor().query(
      `SELECT fecha_hora AS "fechaHora",
              ST_Y(ubicacion::geometry) AS latitud,
              ST_X(ubicacion::geometry) AS longitud,
              velocidad
         FROM posiciones_gps
        WHERE viaje_id = $1
        ORDER BY fecha_hora
        LIMIT least($2::int, 5000)`, [viajeId, limite]);
  }

  /**
   * §10.1 · Kilometros GPS: la suma de las distancias entre posiciones
   * consecutivas, y la diferencia contra el odometro.
   *
   * Se calcula en PostGIS y no en JavaScript por lo mismo que la ubicacion es
   * `geography`: el haversine escrito a mano tiene una version por cada sitio
   * que lo necesita, y todas dan resultados ligeramente distintos.
   */
  async kilometrosDe(viajeId: string) {
    const [fila] = await gestor().query(
      `WITH consecutivas AS (
         SELECT ubicacion,
                lag(ubicacion) OVER (ORDER BY fecha_hora) AS anterior
           FROM posiciones_gps WHERE viaje_id = $1
       )
       SELECT coalesce(sum(ST_Distance(ubicacion, anterior)), 0) / 1000 AS "kilometrosGps",
              count(*) FILTER (WHERE anterior IS NOT NULL) AS tramos
         FROM consecutivas`, [viajeId]);

    const [viaje] = await gestor().query(
      `SELECT odometro_inicial, odometro_final FROM viajes WHERE viaje_id = $1`, [viajeId]);
    if (!viaje) throw new NotFoundException('Viaje no encontrado');

    const kmOdometro = viaje.odometro_final != null && viaje.odometro_inicial != null
      ? Number(viaje.odometro_final) - Number(viaje.odometro_inicial)
      : null;
    const kmGps = Number(fila.kilometrosGps);

    return {
      kilometrosGps: Math.round(kmGps * 1000) / 1000,
      kilometrosOdometro: kmOdometro,
      // §10.1: si la diferencia supera una tolerancia, el viaje genera alerta.
      // Aqui se devuelve el numero; quien decide que es demasiado es el §22.
      diferencia: kmOdometro == null ? null : Math.round(Math.abs(kmOdometro - kmGps) * 1000) / 1000,
      tramos: Number(fila.tramos),
    };
  }

  /** Lo que el panel necesita de un vistazo para toda la flota en marcha. */
  async flotaEnRuta() {
    return gestor().query(
      `SELECT DISTINCT ON (v.viaje_id)
              v.viaje_id AS "viajeId", v.codigo_viaje AS "codigoViaje", v.estado,
              cd.nombre_completo AS conductor,
              p.fecha_hora AS "fechaHora",
              ST_Y(p.ubicacion::geometry) AS latitud,
              ST_X(p.ubicacion::geometry) AS longitud,
              p.velocidad,
              (p.fecha_hora IS NULL
               OR (now() - p.fecha_hora) > interval '${SEGUNDOS_PARA_OBSOLETA} seconds') AS stale
         FROM viajes v
         LEFT JOIN conductores cd ON cd.conductor_id = v.conductor_id
         LEFT JOIN posiciones_gps p ON p.viaje_id = v.viaje_id
        WHERE v.estado IN ('autorizado','desplazamiento_terminal','espera_carga','cargando',
                           'cargado','transito_estacion','descargando','retornando')
        ORDER BY v.viaje_id, p.fecha_hora DESC NULLS LAST`);
  }
}
