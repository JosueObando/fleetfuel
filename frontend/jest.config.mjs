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

/* Las pruebas corren en la zona de quien usa el sistema, no en la de la
   máquina. Desarrollo y CI están en UTC, donde hora local y UTC coinciden, y
   ahí cualquier conversión que confunda las dos pasa en verde. Tiene que
   fijarse AQUÍ, antes de que arranquen los workers: dentro de una prueba,
   `process.env` es una copia y cambiar TZ no llega al motor. */
process.env.TZ = 'America/Panama';

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
    // Trinquete: siempre justo por debajo de lo medido, nunca al revés.
    // Subido CUATRO veces el 2026-09-12: despacho
    // (93,24 / 81,40 / 85,34 / 94,56), informes (93,71 / 81,51 / 86,76 / 95,40),
    // administración (94,48 / 81,91 / 88,58 / 96,11) y la segunda tanda —
    // bitácora del viaje, licencias, auditoría y dispositivos —
    // (94,62 / 82,48 / 89,17 / 96,12). Y con Jest 30 (2026-09-13), que mide las
    // ramas distinto: (94,65 / 83,28 / 89,19 / 96,14). Y tras las pruebas
    // verificadas por mutación: (95,58 / 88,44 / 90,13 / 96,77). Con las bandejas
    // de alertas y solicitudes: (95,58 / 89,33 / 90,66 / 96,56). Con las ediciones de
    // cisternas, órdenes y viajes: (95,86 / 89,88 / 91,57 / 96,69). Con el viaje de
    // despacho en la URL: (95,90 / 90,14 / 91,63 / 96,72). Ver PRUEBAS.md.
    global: { statements: 95, branches: 90, functions: 91, lines: 96 },
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
