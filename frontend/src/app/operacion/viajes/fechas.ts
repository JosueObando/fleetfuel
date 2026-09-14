/**
 * Los días de un viaje, como los escribe una persona y como los guarda la API.
 *
 * La API guarda instantes y el periodo de ocupación es `[inicio, fin)`, con el
 * fin EXCLUIDO. La pantalla pide días. Ver `fechas.spec.ts` para por qué el día
 * de fin no puede mandarse como su medianoche.
 *
 * Los días son UTC, el convenio que el alta ya usaba y que la lista pinta
 * recortando el ISO: cambiarlo sólo aquí partiría los viajes en dos formatos.
 */

const UN_DIA = 24 * 60 * 60 * 1000;

/** 'AAAA-MM-DD' → el instante en que el viaje empieza a ocupar. */
export const inicioDelDia = (dia: string) => new Date(dia).toISOString();

/** 'AAAA-MM-DD' → el primer instante que YA no ocupa: el día elegido queda dentro. */
export const finDelDia = (dia: string) => new Date(new Date(dia).getTime() + UN_DIA).toISOString();

/** El fin guardado → el último día que el viaje ocupa. */
export function diaDeFin(fin: unknown): string {
  if (fin === null || fin === undefined) return '';
  return new Date(new Date(String(fin)).getTime() - 1).toISOString().slice(0, 10);
}
