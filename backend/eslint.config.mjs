import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

/**
 * ESLint del backend.
 *
 * El backend no tenía NINGUNO —ni configuración, ni dependencia, ni script—
 * mientras el frontend sí. Se detectó midiendo el backend contra la lista del
 * skill de TDD, cuyo gancho de pre-commit es `<test> && <lint>`: faltaba la
 * mitad del gancho antes de que hubiera gancho.
 *
 * Se elige la variante CON TIPOS (`recommendedTypeChecked`). Las reglas sin
 * tipos encuentran erratas; las que leen el tipo encuentran la clase de fallo
 * que este proyecto ya ha pagado dos veces: una promesa sin `await` que se
 * pierde en silencio, o un `catch` que trata como objeto lo que llegó como
 * texto. Cuestan unos segundos más y este backend es pequeño.
 */
export default defineConfig([
  globalIgnores(['dist/**', 'coverage/**', 'node_modules/**', 'eslint.config.mjs']),
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      /* Nest declara dependencias como parámetros del constructor y TypeORM
         necesita los decoradores: el `any` de las firmas de terceros no es
         nuestro y avisar de él en cada línea entrena a ignorar el aviso. */
      '@typescript-eslint/no-explicit-any': 'off',
      /* Las consultas de TypeORM devuelven `any` por diseño; marcar cada
         acceso a una fila sería ruido sobre el 90 % de los servicios. */
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      /* Las dos que SÍ se quedan, y son el motivo de usar la variante con
         tipos: una promesa sin `await` aquí no es un aviso de estilo, es un
         INSERT que no llegó a ocurrir dentro de la transacción de la petición
         y una auditoría que afirma un cambio que se perdió. */
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/require-await': 'error',
      /* Un `_` delante declara que el parámetro sobra a propósito: es la
         firma que impone Nest, no un descuido. `ignoreRestSiblings` deja pasar
         `const { emp, ...resto } = carga`, que es cómo se QUITA una clave: la
         variable no se usa porque su función es no estar en el resto. */
      '@typescript-eslint/no-unused-vars': [
        'error', { argsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      /* Este backend escribe su registro como UNA línea JSON por petición a
         stdout, y Promtail la analiza como tal. Un `console.log` suelto mete
         texto sin formato en medio de ese flujo y rompe el análisis sin que
         nada falle. Las semillas son un guión de consola y llevan su
         `eslint-disable` explícito. */
      'no-console': 'error',
    },
  },
  {
    // En las pruebas los dobles se construyen con aserciones deliberadas
    // (`as never`, `as unknown as X`) para que el doble encaje sin arrastrar
    // toda la interfaz real. Exigir ahí la misma pureza que en producción
    // empuja a escribir dobles más grandes, no pruebas mejores.
    files: ['**/*.spec.ts', 'test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },
]);
