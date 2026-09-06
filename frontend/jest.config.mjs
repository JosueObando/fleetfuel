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
  // El alias `@/` del tsconfig se declara aquí a mano: `next/jest` lo deduce de
  // `compilerOptions.paths`, pero este tsconfig no fija `baseUrl` y sin él no
  // llega a generarlo. El síntoma es «Cannot find module '@/…'» sólo dentro de
  // `jest.mock(...)`, porque el código de producción sí lo resuelve por otra vía.
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  // Trinquete, no meta. El frontend arrancó con CERO pruebas y un umbral del
  // 7 %; hoy pasa el 80 % que pide la disciplina. Se sube cada vez que la
  // cobertura sube, nunca al revés. Ver PRUEBAS.md.
  coverageThreshold: {
    global: { statements: 84, branches: 76, functions: 68, lines: 85 },
  },
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/app/**/layout.tsx',
    // El kit del sistema de diseño es el «equivalente a Storybook» del plan:
    // una ruta que MUESTRA los 24 componentes en sus estados. Cubrirla mediría
    // que el escaparate se renderiza, no que los componentes funcionen — y eso
    // ya se prueba en cada componente. Misma razón por la que el backend deja
    // fuera los DTO y las entidades.
    '!src/app/kit/**',
    '!src/**/*.module.css',
  ],
});
