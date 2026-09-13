import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/*
 * Los mensajes que ve una PERSONA se escriben en español con tildes.
 *
 * POR QUÉ EXISTE
 *
 * El 2026-09-13 la bandeja de alertas enseñó por primera vez los títulos que el
 * backend llevaba generando desde el 07-09: «El viaje V-1 esta en marcha y nunca
 * ha enviado posicion». Los módulos escritos aquel día —alertas, geocercas,
 * eventos, GPS, sincronización— iban enteros sin tildes, mientras el resto del
 * backend sí las lleva. Nadie lo vio en una semana porque nadie los LEÍA: sólo
 * los veía quien consultaba la base o la respuesta cruda de la API.
 *
 * Es de las poquísimas pruebas del backend que no necesita Postgres ni Redis:
 * sólo lee ficheros, igual que `umbral.spec.ts`.
 *
 * QUÉ MIRA, Y POR QUÉ NO MÁS
 *
 * Sólo lo que llega a una pantalla: el texto de las excepciones HTTP, los
 * `message:` de los validadores y los `titulo:` de las alertas. Los
 * comentarios quedan fuera a propósito: no los lee nadie que use el sistema.
 *
 * Y sólo palabras INEQUÍVOCAS. «esta» sin tilde es correcta en «en esta
 * empresa», así que no se busca sola; «ya esta» no lo es nunca. Una lista que
 * diera falsos positivos se acabaría silenciando, que es la forma más rápida de
 * que una guarda deje de guardar.
 */

const RAIZ = join(__dirname, '..', 'src');

const SIN_TILDE: Array<[RegExp, string]> = [
  [/\bsenal\b/i, 'señal'], [/\bposicion\b/i, 'posición'], [/\bestacion\b/i, 'estación'],
  [/\bvehiculo\b/i, 'vehículo'], [/\bgeolocalizacion\b/i, 'geolocalización'],
  [/\bcorreccion\b/i, 'corrección'], [/\bsincronizacion\b/i, 'sincronización'],
  [/\bsincronizo\b/i, 'sincronizó'], [/\bencadeno\b/i, 'encadenó'],
  [/\bidentico\b/i, 'idéntico'], [/\bvacio\b/i, 'vacío'], [/\btelemetria\b/i, 'telemetría'],
  [/\bmaximo\b/i, 'máximo'], [/\bminimo\b/i, 'mínimo'], [/\bliquidacion\b/i, 'liquidación'],
  [/\bcodigo\b/i, 'código'], [/\bnumero\b/i, 'número'], [/\bsesion\b/i, 'sesión'],
  [/\boperacion\b/i, 'operación'], [/\bubicacion\b/i, 'ubicación'], [/\btelefono\b/i, 'teléfono'],
  [/\bcategoria\b/i, 'categoría'], [/\bvalido\b/i, 'válido'], [/\binvalido\b/i, 'inválido'],
  [/\bya esta\b/i, 'ya está'], [/\besta (en|cerrad|registrad|resuelt|abiert|vencid)/i, 'está'],
  [/\bmas de\b/i, 'más de'], [/\btodavia\b/i, 'todavía'], [/\bsegun\b/i, 'según'],
];

/** Texto de las cadenas que llegan a una persona, con el fichero y la línea. */
function mensajesVisibles(): Array<{ donde: string; texto: string }> {
  const encontrados: Array<{ donde: string; texto: string }> = [];
  const recorrer = (dir: string) => {
    for (const nombre of readdirSync(dir)) {
      const ruta = join(dir, nombre);
      if (statSync(ruta).isDirectory()) { recorrer(ruta); continue; }
      if (!nombre.endsWith('.ts') || nombre.endsWith('.spec.ts')) continue;
      const lineas = readFileSync(ruta, 'utf8').split('\n');
      lineas.forEach((linea, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(linea)) return;
        /* Una excepción, un validador o un título abren el mensaje; la cadena
           puede empezar en esa línea o en las dos siguientes. */
        if (!/(Exception\(|message:|titulo:)/.test(linea)) return;
        const tramo = lineas.slice(i, i + 3).join(' ');
        for (const m of tramo.matchAll(/'([^'\n]*)'|`([^`\n]*)`/g)) {
          const texto = m[1] ?? m[2];
          if (/\s/.test(texto)) {
            encontrados.push({ donde: `${relative(RAIZ, ruta)}:${i + 1}`, texto });
          }
        }
      });
    }
  };
  recorrer(RAIZ);
  return encontrados;
}

describe('los mensajes que ve una persona llevan tildes', () => {
  it('la guarda encuentra mensajes: una que no mirara nada pasaría siempre', () => {
    // Si el recorrido dejara de encontrar cadenas —otra carpeta, otro patrón—
    // la prueba de abajo seguiría en verde sin mirar nada.
    expect(mensajesVisibles().length).toBeGreaterThan(50);
  });

  it('ningún mensaje visible lleva una palabra sin su tilde', () => {
    const faltas = mensajesVisibles().flatMap(({ donde, texto }) =>
      SIN_TILDE.filter(([patron]) => patron.test(texto))
        .map(([, bien]) => `${donde} · «${texto}» → ${bien}`));
    // Sin repetidos: la ventana de tres líneas ve dos veces un mensaje partido.
    expect([...new Set(faltas.map(f => f.replace(/:\d+ · /, ' · ')))]).toEqual([]);
  });
});
