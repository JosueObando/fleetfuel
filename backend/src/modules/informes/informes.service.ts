import { Injectable } from '@nestjs/common';
import { EN_RUTA_SQL, SIN_SALIR_SQL } from '../viajes/estados';
import { gestor } from '../../common/contexto/contexto-peticion';

/**
 * §14 · Reportes básicos, tercer entregable de la Fase 1C.
 *
 * QUÉ SE INCLUYE Y POR QUÉ ESTOS
 *
 * Los del §14.1 y §14.2 que se DERIVAN de datos que ya existen: viajes,
 * órdenes, plan de carga y entregas. No hay ninguna decisión de negocio nueva
 * aquí — cada número es una suma de columnas que ya tienen dueño, y por eso se
 * puede construir antes de la compuerta 🏁.
 *
 * Los del §14.3 (costo por kilómetro, rentabilidad por viaje) NO están, y no es
 * olvido: dependen de las liquidaciones y de la Fase 3, que es donde vive el
 * motor de costos. Un «costo por viaje» calculado hoy sólo sumaría gastos y
 * dejaría fuera depreciación, combustible del cabezal y mantenimiento — un
 * número que parece la respuesta y no lo es.
 *
 * TODO SALE DE UNA CONSULTA, NO DE JAVASCRIPT
 *
 * Agregar en el servicio obligaría a traerse las filas y sumar en memoria, que
 * es lento y además se desvía: dos informes que cuentan «entregado» sumando en
 * sitios distintos acaban dando números distintos. La RLS aplica igual dentro
 * de las agregaciones, así que cada empresa ve las suyas sin que nadie lo pida.
 */
/** La zona de la operación. Hoy una sola empresa y un solo país (§4). */
const ZONA = 'America/Panama';

/** Una orden en estos estados ya no está activa: de aquí no se sale (§8.1). */
const ORDEN_TERMINAL_SQL = `'cerrada', 'rechazada', 'cancelada'`;

@Injectable()
export class InformesService {
  /** §14.1 · La foto operativa de un día: qué hay programado y en qué estado. */
  async operativo(fecha?: string) {
    const [fila] = await gestor().query(
      `WITH dia AS (SELECT coalesce($1::date, current_date) AS d)
       SELECT
         (SELECT count(*) FROM viajes, dia
           WHERE fecha_programada::date = dia.d AND estado <> 'cancelado')
           AS "viajesProgramados",
         (SELECT count(*) FROM viajes
           WHERE estado IN (${EN_RUTA_SQL}))
           AS "cisternasEnRuta",
         (SELECT count(*) FROM cisternas c
           WHERE c.eliminado_en IS NULL
             AND NOT EXISTS (SELECT 1 FROM viajes v
                              WHERE v.cisterna_id = c.cisterna_id
                                AND v.estado NOT IN ('cerrado','cancelado')))
           AS "cisternasDisponibles",
         (SELECT count(*) FROM ordenes_abastecimiento
           WHERE eliminado_en IS NULL
             AND estado IN ('recibida','validada','planificada','asignada'))
           AS "ordenesPendientes",
         (SELECT count(*) FROM ordenes_abastecimiento
           WHERE eliminado_en IS NULL AND estado IN ('entregada','conciliada','cerrada'))
           AS "ordenesEntregadas",
         (SELECT count(*) FROM ordenes_abastecimiento
           WHERE eliminado_en IS NULL AND estado = 'entrega_parcial')
           AS "entregasParciales",
         -- Retrasado es el que debió salir y sigue sin salir. Se mide contra
         -- fecha_programada y no contra una promesa al cliente, que es dato de
         -- la orden y puede ser otra cosa.
         (SELECT count(*) FROM viajes
           WHERE fecha_programada < now()
             AND estado IN (${SIN_SALIR_SQL}))
           AS "viajesRetrasados"
       FROM dia`, [fecha ?? null]);
    return fila;
  }

  /**
   * §14.2 · La cadena del volumen: solicitado → planificado → entregado.
   *
   * Es el informe que hace visible el descuadre que el §7 llama el riesgo de
   * este negocio. Los tres números salen de sitios distintos —la orden, el plan
   * de carga y las entregas— y que no cuadren es exactamente la señal.
   */
  async volumen(desde?: string, hasta?: string) {
    const [fila] = await gestor().query(
      `SELECT
         coalesce(sum(d.volumen_solicitado), 0)  AS "volumenSolicitado",
         coalesce(sum(d.volumen_planificado), 0) AS "volumenPlanificado",
         coalesce(sum(d.volumen_entregado), 0)   AS "volumenEntregado",
         coalesce(sum(d.volumen_pendiente), 0)   AS "volumenPendiente"
       FROM detalles_orden d
       JOIN ordenes_abastecimiento o ON o.orden_id = d.orden_id
      WHERE o.eliminado_en IS NULL
        AND ($1::date IS NULL OR o.creado_en::date >= $1::date)
        AND ($2::date IS NULL OR o.creado_en::date <= $2::date)`,
      [desde ?? null, hasta ?? null]);
    return fila;
  }

  /**
   * §14.2 · Mermas por conductor, por cisterna y por producto.
   *
   * Se agrupa por los tres porque un descuadre repetido dice cosas distintas
   * según dónde se repita: el mismo conductor apunta a una persona, la misma
   * cisterna a un tanque o a un medidor, y el mismo producto a una propiedad
   * física. Dar sólo el total los mezclaría y no señalaría a ninguno.
   */
  async mermas(agruparPor: 'conductor' | 'cisterna' | 'producto' = 'conductor') {
    const AGRUPACION = {
      conductor: { col: 'cd.nombre_completo', join: 'JOIN conductores cd ON cd.conductor_id = v.conductor_id' },
      cisterna:  { col: 'ci.cisterna_id::text', join: 'JOIN cisternas ci ON ci.cisterna_id = v.cisterna_id' },
      producto:  { col: 'p.nombre', join: 'JOIN productos_combustible p ON p.producto_id = e.producto_id' },
    }[agruparPor];

    return gestor().query(
      `SELECT ${AGRUPACION.col} AS grupo,
              count(*) AS entregas,
              coalesce(sum(e.volumen_cargado), 0)  AS "volumenCargado",
              coalesce(sum(e.volumen_recibido), 0) AS "volumenRecibido",
              coalesce(sum(e.diferencia_volumen), 0) AS "diferenciaTotal",
              -- La merma media se pondera por volumen y NO se promedian los
              -- porcentajes: promediar porcentajes le da el mismo peso a una
              -- entrega de 50 litros que a una de 5000, que es como un
              -- descuadre grande se esconde detrás de muchos pequeños.
              CASE WHEN sum(e.volumen_cargado) > 0
                   THEN round(sum(e.diferencia_volumen) / sum(e.volumen_cargado) * 100, 4)
                   ELSE 0 END AS "mermaPorcentaje",
              count(*) FILTER (WHERE e.estado = 'pendiente') AS "pendientesDeAprobar"
         FROM entregas e
         JOIN viajes v ON v.viaje_id = e.viaje_id
         ${AGRUPACION.join}
        GROUP BY 1
        ORDER BY abs(coalesce(sum(e.diferencia_volumen), 0)) DESC`);
  }

  /** §14.1 · Kilómetros y tiempos por viaje cerrado, con su odómetro. */
  async recorridos(limite = 100) {
    return gestor().query(
      `SELECT v.viaje_id AS id, v.codigo_viaje AS "codigoViaje",
              cd.nombre_completo AS conductor,
              v.odometro_inicial AS "odometroInicial", v.odometro_final AS "odometroFinal",
              (v.odometro_final - v.odometro_inicial) AS kilometros,
              v.kilometros_gps AS "kilometrosGps",
              v.fecha_inicio AS "fechaInicio", v.fecha_fin AS "fechaFin",
              extract(epoch FROM (v.fecha_fin - v.fecha_inicio)) AS "duracionSegundos"
         FROM viajes v
         LEFT JOIN conductores cd ON cd.conductor_id = v.conductor_id
        WHERE v.estado = 'cerrado' AND v.odometro_final IS NOT NULL
        ORDER BY v.fecha_fin DESC NULLS LAST
        LIMIT least($1::int, 500)`, [limite]);
  }

  /**
   * §15.1 · Las tarjetas superiores del dashboard ejecutivo.
   *
   * EL DÍA ES EL DE PANAMÁ
   *
   * La base corre en UTC. Con `current_date` o `::date` a secas, una descarga a
   * las 22:00 de Panamá cuenta para el día siguiente, y a partir de las siete
   * de la tarde el panel enseñaría un día casi vacío. Los instantes
   * (`timestamptz`) se pasan a la hora local antes de truncar; `gastos_viaje.fecha`
   * ya es un `date` de calendario y se compara tal cual.
   *
   * LO QUE NO ESTÁ
   *
   * El «margen promedio» del §15.1. Necesita ingreso y costo completo —combustible
   * del cabezal, mantenimiento, depreciación—, que son la Fase 3. Por lo mismo
   * `gastosDelDia` se llama así y no «costos»: son los gastos de viaje
   * registrados, no el costo del día.
   *
   * KILÓMETROS: DOS MEDIDAS, NO UNA MEZCLA
   *
   * Los del GPS son los recorridos DE VERDAD ese día (tramos entre posiciones
   * consecutivas de cada unidad). Sin la app del conductor (2A) casi no llega
   * GPS, así que también va el odómetro de los viajes que cerraron ese día.
   * Sumarlos sería contar dos veces; se dan aparte y la pantalla dice cuál enseña.
   */
  async ejecutivo(fecha?: string, ahora: Date = new Date()) {
    const [fila] = await gestor().query(
      `WITH dia AS (
         -- «ahora» llega de fuera y no es now() para que «hoy» se pueda
         -- probar a las 21:00 de Panamá, que es cuando UTC ya va por mañana.
         SELECT coalesce($1::date, ($2::timestamptz AT TIME ZONE '${ZONA}')::date) AS d
       ),
       tramos AS (
         SELECT p.vehiculo_id,
                ST_Distance(p.ubicacion,
                  lag(p.ubicacion) OVER (PARTITION BY p.vehiculo_id ORDER BY p.fecha_hora)) AS m
           FROM posiciones_gps p, dia
          -- El rango sobre la columna, y no truncar la columna, para que la poda
          -- de particiones por mes siga funcionando.
          WHERE p.fecha_hora >= (dia.d::timestamp AT TIME ZONE '${ZONA}')
            AND p.fecha_hora <  ((dia.d + 1)::timestamp AT TIME ZONE '${ZONA}')
       )
       SELECT
         to_char(dia.d, 'YYYY-MM-DD') AS fecha,
         (SELECT count(*) FROM ordenes_abastecimiento
           WHERE eliminado_en IS NULL AND estado NOT IN (${ORDEN_TERMINAL_SQL}))
           AS "ordenesActivas",
         (SELECT count(*) FROM viajes WHERE estado IN (${EN_RUTA_SQL}))
           AS "viajesEnCurso",
         (SELECT coalesce(sum(volumen_recibido), 0) FROM entregas
           WHERE estado <> 'rechazada'
             AND (fecha_descarga AT TIME ZONE '${ZONA}')::date = dia.d)
           AS "volumenEntregado",
         (SELECT coalesce(round((sum(m) / 1000)::numeric, 3), 0) FROM tramos)
           AS "kilometrosGps",
         (SELECT count(DISTINCT vehiculo_id) FROM tramos) AS "unidadesConGps",
         -- Por fecha_cierre y NO por fecha_fin: fuera de «cerrado» el fin es
         -- el PREVISTO, y al cerrar se conserva si ya estaba puesto. Contar por
         -- él pondría los kilómetros en el día planificado, no en el real.
         (SELECT coalesce(sum(odometro_final - odometro_inicial), 0) FROM viajes
           WHERE odometro_final IS NOT NULL
             AND (fecha_cierre AT TIME ZONE '${ZONA}')::date = dia.d)
           AS "kilometrosOdometro",
         (SELECT coalesce(sum(monto), 0) FROM gastos_viaje
           WHERE fecha = dia.d AND estado <> 'rechazado')
           AS "gastosDelDia",
         (SELECT count(*) FROM gastos_viaje
           WHERE fecha = dia.d AND estado = 'pendiente')
           AS "gastosPorAprobar",
         (SELECT count(DISTINCT conductor_id) FROM liquidaciones_conductor
           WHERE estado <> 'pagada')
           AS "conductoresPendientesPago",
         (SELECT coalesce(sum(total_pagar), 0) FROM liquidaciones_conductor
           WHERE estado <> 'pagada')
           AS "montoPendientePago",
         (SELECT count(*) FROM alertas WHERE severidad = 'critica' AND estado <> 'resuelta')
           AS "alertasCriticas",
         (SELECT count(*) FROM alertas WHERE severidad = 'alta' AND estado <> 'resuelta')
           AS "alertasAltas"
       FROM dia`, [fecha ?? null, ahora.toISOString()]);
    return fila;
  }
}
