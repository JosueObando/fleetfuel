/*
 * Ejecutor de pruebas del frontend.
 *
 * `next/jest` es la vía oficial: aplica el mismo transformador SWC que usa el
 * build, así que las pruebas compilan el código EXACTAMENTE igual que
 * producción —JSX, alias de rutas, CSS Modules—. Configurar ts-jest a mano
 * habría creado una segunda forma de compilar, y las dos se desincronizan.
 */
import nextJest from 'next/jest.js';

const crearConfig = nextJest({ dir: './' });

export default crearConfig({
  // jsdom y no node: aquí se prueban cosas que sólo existen en un navegador
  // —localStorage, fetch, el DOM—, y son justo las que fallan distinto.
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/pruebas/preparar.ts'],
  testMatch: ['<rootDir>/src/**/*.spec.ts', '<rootDir>/src/**/*.spec.tsx'],
  // Trinquete, no meta. El frontend arrancó con CERO pruebas; estos números
  // son ridículos como objetivo y valen como suelo: impiden que las tres
  // suites que existen se borren o se dejen pudrir sin que CI diga nada.
  // Cuando suba, súbelo. Ver PRUEBAS.md.
  coverageThreshold: {
    global: { statements: 7, branches: 6, functions: 4, lines: 7 },
  },
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/app/**/layout.tsx',
    '!src/**/*.module.css',
  ],
});
