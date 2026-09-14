import '@testing-library/jest-dom';
import { webcrypto } from 'node:crypto';

/*
 * jsdom no trae `crypto.randomUUID`, y el cliente de API lo usa para la clave
 * de idempotencia de cada POST. Sin esto las pruebas fallarían por una carencia
 * del entorno de pruebas y no por el código, que es la peor clase de fallo
 * rojo: parece un error real durante un buen rato.
 *
 * El `import` es estático y no un `require()` dentro del `if`: traer el módulo
 * de Node siempre no cuesta nada medible en un fichero que corre una vez por
 * suite, y un `require()` en un proyecto de módulos ES es una segunda forma de
 * importar que sólo existía aquí.
 */
if (!globalThis.crypto?.randomUUID) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

/*
 * user-event sin pausas entre teclas ni hover previo al clic.
 *
 * La suite pasó de 29 a 32 s al entrar las bandejas de alertas y solicitudes,
 * por encima de los 30 que pide la disciplina. Medido: lo que queda caro no es
 * jsdom (eso lo arregló Jest 30) sino ESCRIBIR — unos 16 ms por carácter entre
 * user-event y el re-render — y las dos suites que más escriben marcan el
 * tiempo de pared. Con estos dos valores la suite vuelve a 28,6 s.
 *
 * No se pierde nada que se esté comprobando:
 *   · `delay: null` quita el `setTimeout` entre tecla y tecla; los eventos de
 *     cada tecla siguen disparándose todos y en orden.
 *   · `skipHover` no dispara `pointerover`/`mouseenter` antes del clic, y ni
 *     el código ni las pruebas escuchan un solo evento de hover (comprobado con
 *     grep el 2026-09-13). Si alguno llega a hacerlo, esa prueba pasa
 *     `userEvent.setup({ skipHover: false })` y aquí no hay que tocar nada.
 *
 *   · `pointerEventsCheck: 0` (2026-09-14) quita la comprobación de que el
 *     elemento no tenga `pointer-events: none` calculado. Aquí NUNCA puede
 *     fallar: `next/jest` sustituye los `.module.css` por un proxy de nombres
 *     de clase, así que a jsdom no llega ningún estilo y ese valor siempre es
 *     el por omisión. Costaba un `getComputedStyle` por ancestro en cada clic.
 *     Lo que el `.cargando { pointer-events: none }` del kit protege en el
 *     navegador, en las pruebas lo protege el `disabled` que lo acompaña.
 *
 * Vive aquí y no en cada fichero para que una prueba nueva lo herede sin
 * saberlo: veinte `userEvent.setup()` copiados son veinte sitios donde olvidarlo.
 */
jest.mock('@testing-library/user-event', () => {
  const real = jest.requireActual('@testing-library/user-event');
  const base = real.default ?? real;
  const setup = (opciones: Record<string, unknown> = {}) =>
    base.setup({ delay: null, skipHover: true, pointerEventsCheck: 0, ...opciones });
  return { __esModule: true, ...real, default: { ...base, setup } };
});
