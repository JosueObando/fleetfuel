import '@testing-library/jest-dom';

/*
 * jsdom no trae `crypto.randomUUID`, y el cliente de API lo usa para la clave
 * de idempotencia de cada POST. Sin esto las pruebas fallarían por una carencia
 * del entorno de pruebas y no por el código, que es la peor clase de fallo
 * rojo: parece un error real durante un buen rato.
 */
if (!globalThis.crypto?.randomUUID) {
  const { webcrypto } = require('node:crypto');
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}
