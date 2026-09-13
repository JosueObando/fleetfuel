/*
 * Los tipos que comparten las pantallas de operación y catálogos.
 *
 * `Fila` estaba copiado como `type Fila = Record<string, any>` en cuatro
 * ficheros, y con él cuatro errores de `no-explicit-any`. Vive aquí una sola
 * vez, con la excepción declarada UNA vez y explicada:
 *
 * La API devuelve formas anchas y distintas por endpoint —un viaje trae sus
 * órdenes y su plan de carga anidados; una carga, once campos planos—.
 * Declararlas a mano crearía una segunda definición del contrato, en otro
 * repositorio que el backend no compila, y se desincronizaría sin que nada lo
 * avisara: el día que el backend renombre un campo, TypeScript seguiría
 * diciendo que todo está bien. Un `any` honesto en la frontera es más sincero
 * que un tipo que miente.
 *
 * Lo que sí está tipado es lo que se ENVÍA, que es donde un error tiene
 * consecuencias: los DTO los valida `class-validator` en el servidor y las
 * pruebas de cada pantalla fijan la forma exacta de cada cuerpo.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Fila = Record<string, any>;

/** Ejecuta una llamada a la API, refresca lo que haga falta y cuenta el error. */
export type Accion = (fn: () => Promise<unknown>) => Promise<void>;
