import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/*
 * El umbral de cobertura y la tabla que lo documenta, atados.
 *
 * POR QUÉ EXISTE ESTA PRUEBA
 *
 * Este mismo fichero de documentación —`test/COBERTURA.md`— se quedó atrás DOS
 * veces: la segunda, cuatro commits diciendo 90 cuando el trinquete ya iba por
 * 91, y con un aviso escrito dentro advirtiendo de que eso ya había pasado una
 * vez. Que ocurriera con el aviso puesto dice que el fallo no es el descuido:
 * **subir el umbral y anotarlo son dos actos, y al segundo no lo obliga nadie.**
 *
 * A la tercera —2026-09-12, esta vez en `frontend/PRUEBAS.md`— se escribió la
 * prueba en el frontend (`src/umbral.spec.ts`) y quedó anotado que faltaba la
 * del backend, que es donde empezó el problema. Esta es.
 *
 * QUÉ ATA, Y QUÉ NO
 *
 * La última columna de la tabla contra `coverageThreshold`. No comprueba la
 * prosa —nada puede—, pero sí lo único que tiene una respuesta correcta
 * verificable, que es justo lo que se desincroniza.
 *
 * NO NECESITA INFRAESTRUCTURA. Es una de las poquísimas pruebas de este
 * repositorio que corre sin Postgres ni Redis: sólo lee dos ficheros.
 */

const aqui = __dirname;

function umbralesDeLaConfig(): Record<string, number> {
  const config = JSON.parse(
    readFileSync(join(aqui, 'jest.cobertura.json'), 'utf8')) as {
      coverageThreshold?: { global?: Record<string, number> };
    };
  const global = config.coverageThreshold?.global;
  if (!global) throw new Error('jest.cobertura.json no declara coverageThreshold.global');
  return global;
}

/** La última columna de la tabla del trinquete. */
function umbralesDelDocumento(): Record<string, number> {
  const doc = readFileSync(join(aqui, 'COBERTURA.md'), 'utf8');
  /* Por líneas y no con una expresión regular sobre todo el fichero: la tabla
     está escrita a mano y se le añade una columna cada vez que sube la
     cobertura, así que lo único estable es el principio de la fila. */
  const fila = (etiqueta: string) => {
    const linea = doc.split('\n').find(l => l.startsWith(`| ${etiqueta} |`));
    if (!linea) throw new Error(`COBERTURA.md no tiene fila «${etiqueta}» en la tabla del umbral`);
    const celdas = linea.split('|').map(c => c.trim()).filter(Boolean);
    return Number(celdas[celdas.length - 1]);
  };
  return {
    statements: fila('Sentencias'),
    branches: fila('Ramas'),
    functions: fila('Funciones'),
    lines: fila('Líneas'),
  };
}

describe('el trinquete documentado', () => {
  it('la tabla de COBERTURA.md dice el mismo umbral que jest.cobertura.json', () => {
    expect(umbralesDelDocumento()).toEqual(umbralesDeLaConfig());
  });

  it('y los cuatro umbrales pasan el 80 % que pide la disciplina', () => {
    // El trinquete sube; lo que no puede es bajar del suelo sin que nadie lo
    // note. Si algún día hay que bajarlo, esto obliga a tomar la decisión a la
    // vista en vez de editar un número.
    for (const [metrica, valor] of Object.entries(umbralesDeLaConfig())) {
      expect({ metrica, sobre80: valor >= 80 }).toEqual({ metrica, sobre80: true });
    }
  });
});
