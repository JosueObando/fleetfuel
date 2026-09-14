/**
 * Máquina de estados de la orden (§8.1).
 *
 * Se declara como datos y no como cadena de `if`: así la transición válida se
 * puede consultar, mostrar en la interfaz y probar, en vez de estar repartida
 * por el servicio. Y añadir un estado no obliga a releer el flujo entero.
 */
export const FLUJO_ORDEN: Record<string, string[]> = {
  recibida:        ['validada', 'rechazada', 'cancelada', 'suspendida'],
  validada:        ['planificada', 'cancelada', 'suspendida', 'con_incidencia'],
  planificada:     ['asignada', 'validada', 'cancelada', 'con_incidencia'],
  asignada:        ['en_carga', 'planificada', 'cancelada', 'con_incidencia'],
  en_carga:        ['cargada', 'con_incidencia'],
  cargada:         ['en_transito', 'con_incidencia'],
  en_transito:     ['entrega_parcial', 'entregada', 'con_incidencia'],
  entrega_parcial: ['entregada', 'conciliada', 'con_incidencia'],
  entregada:       ['conciliada', 'con_incidencia'],
  conciliada:      ['cerrada'],
  // Terminales: de aquí no se sale. Reabrir una orden cerrada borraría el
  // sentido de «cerrada» para la conciliación y para la auditoría.
  cerrada:         [],
  rechazada:       [],
  cancelada:       [],
  suspendida:      ['validada', 'cancelada'],
  con_incidencia:  ['validada', 'planificada', 'cancelada'],
};

/** Estados que exigen justificación escrita. */
export const EXIGEN_MOTIVO = new Set(['rechazada', 'cancelada', 'suspendida', 'con_incidencia']);

/**
 * Estados en los que la orden todavía admite cambios de programación. Una que
 * ya salió a la calle no se reprograma editando campos: sus viajes ya están
 * armados sobre esos datos. Se cancela y se rehace.
 */
export const ADMITEN_EDICION = new Set(['recibida', 'validada', 'suspendida']);
