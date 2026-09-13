import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/*
 * El umbral de cobertura y la tabla que lo documenta, atados.
 *
 * POR QUÉ EXISTE ESTA PRUEBA
 *
 * Subir el umbral y anotarlo son DOS ACTOS, y al segundo no lo obliga nadie.
 * `backend/test/COBERTURA.md` se quedó atrás dos veces —la segunda, cuatro
 * commits diciendo 90 cuando el trinquete ya iba por 91—, y el propio fichero
 * llevaba escrito un aviso de que eso ya había pasado una vez. Un aviso no es
 * un mecanismo.
 *
 * El criterio anotado entonces fue: «si aparece una tercera vez, escribir la
 * prueba antes que nada». Apareció el 2026-09-12, aquí: `PRUEBAS.md` afirmaba
 * que los recorridos de navegador NO estaban en CI cuando llevaban días en el
 * trabajo `e2e`. Así que esto es esa prueba.
 *
 * QUÉ ATA, Y QUÉ NO
 *
 * Ata la última columna de la tabla con `coverageThreshold`. No comprueba la
 * prosa —nada puede—, pero sí lo único que tiene una respuesta correcta
 * verificable, que es justo lo que se desincroniza.
 */

const raiz = join(__dirname, '..');

function umbralesDeLaConfig(): Record<string, number> {
  const config = readFileSync(join(raiz, 'jest.config.mjs'), 'utf8');
  const bloque = config.match(/global:\s*\{([^}]*)\}/);
  if (!bloque) throw new Error('no se encontró `global: { … }` en jest.config.mjs');
  return Object.fromEntries(
    [...bloque[1].matchAll(/(\w+):\s*(\d+)/g)].map(m => [m[1], Number(m[2])]));
}

/** La última columna de la tabla del apartado «El umbral». */
function umbralesDelDocumento(): Record<string, number> {
  const doc = readFileSync(join(raiz, 'PRUEBAS.md'), 'utf8');
  /* Por líneas y no con una expresión regular: la tabla está escrita a mano y
     una regex sobre Markdown se rompe con un espacio de más, que es justo el
     tipo de cambio que alguien hará aquí sin pensarlo. */
  const fila = (etiqueta: string) => {
    const linea = doc.split('\n').find(l => l.startsWith(`| ${etiqueta} |`));
    if (!linea) throw new Error(`PRUEBAS.md no tiene fila «${etiqueta}» en la tabla del umbral`);
    const celdas = linea.split('|').map(c => c.trim()).filter(Boolean);
    return Number(celdas.at(-1));
  };
  return {
    statements: fila('Sentencias'),
    branches:   fila('Ramas'),
    functions:  fila('Funciones'),
    lines:      fila('Líneas'),
  };
}

it('la tabla de PRUEBAS.md dice el mismo umbral que jest.config.mjs', () => {
  expect(umbralesDelDocumento()).toEqual(umbralesDeLaConfig());
});

it('y los cuatro umbrales pasan el 80 % que pide la disciplina', () => {
  // El trinquete sube; lo que no puede es bajar del suelo de la disciplina sin
  // que alguien lo note. Si algún día hay que bajarlo, esta prueba obliga a
  // tomar la decisión a la vista en vez de editar un número.
  for (const [metrica, valor] of Object.entries(umbralesDeLaConfig())) {
    expect({ metrica, valor }).toEqual({ metrica, valor: expect.any(Number) });
    expect(valor).toBeGreaterThanOrEqual(80);
  }
});
