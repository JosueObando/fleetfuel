import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // El informe de cobertura es código GENERADO por istanbul: linterlo sólo
    // produce avisos sobre ficheros que nadie edita.
    "coverage/**",
  ]),

  {
    /*
     * El guion bajo declara «este argumento existe por la FORMA de la función,
     * no porque haga falta»: un doble de `fetch` tiene que aceptar `(url,
     * init)` aunque sólo mire uno, y renombrarlos no es opcional. La convención
     * ya se usaba en el código; aquí simplemente se le dice a la herramienta,
     * que es lo que faltaba para que `npm run lint` pudiera entrar en CI sin
     * avisos que nadie va a arreglar porque no hay nada que arreglar.
     */
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
      }],
    },
  },
]);

export default eslintConfig;
