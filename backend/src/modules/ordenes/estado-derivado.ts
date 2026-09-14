import { auditar, gestor } from '../../common/contexto/contexto-peticion';
import { filasDe } from '../../common/una-fila';

/**
 * El estado de una orden (§8.1) sigue a su viaje (§8.2) y a sus entregas.
 *
 * Hasta el 2026-09-14 no lo seguía: las únicas escrituras del estado eran
 * manuales, y había órdenes «validada» dentro de viajes CERRADOS —editables,
 * re-asignables y contadas como pendientes—. Ver
 * `test/ordenes-estado-derivado.integracion.ts` para la regla y de dónde sale.
 *
 * Esto NO pasa por `FLUJO_ORDEN`: esa máquina es la de las transiciones que
 * pide una persona, paso a paso. Aquí el estado se DEDUCE de hechos —qué viaje
 * la lleva y cuánto se entregó—, y los hechos pueden saltar pasos (una orden
 * asignada a un viaje que ya va cargando).
 */

/** Estados que el sistema mueve. Los demás los decide una persona y no se tocan. */
const AUTOMATICOS = ['validada', 'planificada', 'asignada', 'en_carga', 'cargada',
                     'en_transito', 'entrega_parcial', 'entregada'];

/**
 * Qué momento de la orden corresponde a cada estado de un viaje que la lleva.
 * `null`: ese viaje ya no la lleva a ninguna parte —terminó o se canceló sin
 * entregarla—, así que no cuenta. En el orden de la lista, de menos a más
 * avanzado: si la llevan varios viajes (§6.2), manda el más avanzado.
 */
const MOMENTOS = ['planificada', 'asignada', 'en_carga', 'cargada', 'en_transito'] as const;
export const MOMENTO_DE_LA_ORDEN: Record<string, (typeof MOMENTOS)[number] | null> = {
  borrador: 'planificada', programado: 'planificada',
  autorizado: 'asignada', desplazamiento_terminal: 'asignada', espera_carga: 'asignada',
  cargando: 'en_carga', cargado: 'cargada',
  transito_estacion: 'en_transito', descargando: 'en_transito',
  retornando: null, pendiente_liquidacion: null, cerrado: null, cancelado: null,
};

const lista = (xs: readonly string[]) => xs.map(x => `'${x}'`).join(', ');
const RANGO = Object.entries(MOMENTO_DE_LA_ORDEN)
  .filter(([, m]) => m !== null)
  .map(([viaje, m]) => `WHEN '${viaje}' THEN ${MOMENTOS.indexOf(m!)}`).join(' ');
const MOMENTO_POR_RANGO = MOMENTOS.map((m, i) => `WHEN ${i} THEN '${m}'`).join(' ');

/**
 * Recalcula el estado de las órdenes dadas y guarda —y audita— sólo lo que
 * cambió. Se llama tras cada hecho que lo mueve: asignar la orden a un viaje,
 * cambiar el estado del viaje, registrar o rechazar una entrega.
 */
export async function sincronizarEstadoDeOrdenes(ordenIds: Array<string | number>): Promise<void> {
  if (ordenIds.length === 0) return;
  const cambios = filasDe<{ id: string; antes: string; nuevo: string }>(await gestor().query(
    `WITH deducido AS (
       SELECT o.orden_id, o.estado AS antes,
              CASE
                -- §9 etapa 7 y regla 20: las entregas mandan sobre el viaje.
                WHEN l.completas THEN 'entregada'
                WHEN l.algo      THEN 'entrega_parcial'
                -- Si no, el viaje vivo más avanzado; sin ninguno, a planificar otra vez.
                ELSE coalesce((
                  SELECT CASE max(CASE v.estado ${RANGO} END) ${MOMENTO_POR_RANGO} END
                    FROM viaje_ordenes vo JOIN viajes v ON v.viaje_id = vo.viaje_id
                   WHERE vo.orden_id = o.orden_id), 'validada')
              END AS nuevo
         FROM ordenes_abastecimiento o
         CROSS JOIN LATERAL (
           SELECT bool_and(d.volumen_entregado >= d.volumen_solicitado) AS completas,
                  bool_or(d.volumen_entregado > 0) AS algo
             FROM detalles_orden d WHERE d.orden_id = o.orden_id) l
        WHERE o.orden_id = ANY($1::bigint[]) AND o.estado IN (${lista(AUTOMATICOS)}))
     UPDATE ordenes_abastecimiento o
        SET estado = d.nuevo, actualizado_en = now()
       FROM deducido d
      WHERE o.orden_id = d.orden_id AND d.nuevo <> d.antes
     RETURNING o.orden_id AS id, d.antes, d.nuevo`,
    [ordenIds.map(String)]));

  for (const c of cambios) {
    auditar({
      entidad: 'ordenes_abastecimiento', entidadId: String(c.id),
      valorAnterior: { estado: c.antes }, valorNuevo: { estado: c.nuevo },
      motivo: 'Sincronizado con el estado de su viaje y sus entregas',
    });
  }
}

/** Las órdenes de un viaje, para sincronizarlas cuando el viaje cambia. */
export async function ordenesDelViaje(viajeId: string): Promise<string[]> {
  const filas: Array<{ orden_id: string }> = await gestor().query(
    `SELECT orden_id FROM viaje_ordenes WHERE viaje_id = $1`, [viajeId]);
  return filas.map(f => String(f.orden_id));
}
