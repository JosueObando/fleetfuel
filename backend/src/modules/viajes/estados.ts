/**
 * Máquina de estados del viaje (§8.2).
 *
 * El flujo es casi lineal por naturaleza: un camión no puede estar
 * descargando antes de cargar. Las únicas ramas son hacia atrás dentro de la
 * planificación (mientras nadie se ha movido) y hacia `cancelado`.
 */
export const FLUJO_VIAJE: Record<string, string[]> = {
  borrador:                ['programado', 'cancelado'],
  programado:              ['autorizado', 'borrador', 'cancelado'],
  // La autorización es la frontera: a partir de aquí el viaje sale a la calle
  // y ya no se vuelve a la planificación, solo se cancela.
  autorizado:              ['desplazamiento_terminal', 'cancelado'],
  desplazamiento_terminal: ['espera_carga', 'cancelado'],
  espera_carga:            ['cargando', 'cancelado'],
  cargando:                ['cargado', 'cancelado'],
  cargado:                 ['transito_estacion'],
  transito_estacion:       ['descargando'],
  descargando:             ['retornando', 'pendiente_liquidacion'],
  retornando:              ['pendiente_liquidacion'],
  pendiente_liquidacion:   ['cerrado'],
  cerrado:                 [],
  cancelado:               [],
};

/** A partir de aquí el viaje ya salió: no admite cambios de planificación. */
export const EN_MARCHA = new Set([
  'autorizado', 'desplazamiento_terminal', 'espera_carga', 'cargando', 'cargado',
  'transito_estacion', 'descargando', 'retornando', 'pendiente_liquidacion', 'cerrado',
]);

/** Estados en los que el plan de carga todavía se puede tocar. */
export const PLANIFICABLE = new Set(['borrador', 'programado']);
