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
