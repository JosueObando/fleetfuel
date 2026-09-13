import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Los títulos de alerta YA GUARDADOS, con tildes.
 *
 * El 2026-09-13 la bandeja de alertas enseñó por primera vez lo que el backend
 * generaba desde el 07-09, y los títulos iban sin tildes: «El viaje V-1 esta en
 * marcha y nunca ha enviado posicion». El servicio ya los escribe bien, pero eso
 * sólo arregla las alertas NUEVAS: la deduplicación mantiene viva la que ya
 * existe —una licencia puede estar meses abierta—, así que sin esto la bandeja
 * seguiría enseñando el texto viejo durante semanas con el código corregido.
 *
 * Se reemplaza la FRASE ANCLADA y no palabras sueltas: el resto del título lleva
 * un código de viaje o un nombre de conductor, que son datos de otra persona y
 * pueden contener «esta» o «mas» con todo derecho.
 *
 * Las cuatro frases son las únicas que cambiaron. «Licencia VENCIDA…», «Sello…»,
 * «Exceso de velocidad…» y el resto ya estaban bien escritas.
 */

/* Cada frase con su ancla: `^` si abre el título, `$` si lo cierra. Ninguna
   lleva metacaracteres de expresión regular, así que el texto es su patrón. */
const FRASES: Array<{ viejo: string; nuevo: string; ancla: 'inicio' | 'fin' }> = [
  { viejo: 'Sin senal GPS en el viaje ', nuevo: 'Sin señal GPS en el viaje ', ancla: 'inicio' },
  { viejo: ' esta en marcha y nunca ha enviado posicion', nuevo: ' está en marcha y nunca ha enviado posición', ancla: 'fin' },
  { viejo: ' lleva mas de una semana sin cerrar', nuevo: ' lleva más de una semana sin cerrar', ancla: 'fin' },
  { viejo: ' esta cerrado y sin liquidar', nuevo: ' está cerrado y sin liquidar', ancla: 'fin' },
];

const patron = (texto: string, ancla: 'inicio' | 'fin') =>
  ancla === 'inicio' ? `^${texto}` : `${texto}$`;

async function reemplazar(q: QueryRunner, de: string, a: string, ancla: 'inicio' | 'fin') {
  await q.query(
    `UPDATE alertas SET titulo = regexp_replace(titulo, $1, $2) WHERE titulo ~ $1`,
    [patron(de, ancla), a]);
}

export class TildesEnTitulosDeAlertas1804000000000 implements MigrationInterface {
  name = 'TildesEnTitulosDeAlertas1804000000000';

  public async up(q: QueryRunner): Promise<void> {
    for (const f of FRASES) await reemplazar(q, f.viejo, f.nuevo, f.ancla);
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const f of FRASES) await reemplazar(q, f.nuevo, f.viejo, f.ancla);
  }
}
