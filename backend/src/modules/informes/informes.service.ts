import { Injectable } from '@nestjs/common';
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
           WHERE estado IN ('desplazamiento_terminal','espera_carga','cargando','cargado',
                            'transito_estacion','descargando','retornando'))
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
             AND estado IN ('borrador','programado','autorizado'))
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
}
