/**
 * Devuelve la primera fila de un `RETURNING`, venga en la forma que venga.
 *
 * TypeORM no devuelve lo mismo según la sentencia, y la diferencia no está
 * documentada en ningún sitio evidente:
 *
 *   INSERT … RETURNING  →  [ {fila} ]
 *   UPDATE … RETURNING  →  [ [ {fila} ], 1 ]      ← filas Y número de afectadas
 *   DELETE … RETURNING  →  [ [ {fila} ], 1 ]
 *
 * Así que el `const [x] = await query(...)` que funciona para un INSERT, en un
 * UPDATE captura el ARRAY de filas en vez de la fila. Y no falla: devuelve un
 * array de uno, que se puede pasar por ahí sin que nada proteste hasta que
 * alguien lee una propiedad y le sale `undefined`.
 *
 * Lo que produjo: `PATCH` y `DELETE` de los catálogos respondían
 * `[{...}]` mientras `POST` respondía `{...}` —la API contestaba con dos formas
 * distintas para la misma entidad— y la auditoría guardaba ese array como
 * `valor_nuevo`, en una tabla que es append-only y no se puede corregir después.
 *
 * Se normaliza aquí, en un solo sitio, en vez de recordar la diferencia en cada
 * servicio.
 */
export function unaFila<T = Record<string, unknown>>(resultado: unknown): T {
  const filas = Array.isArray(resultado) && Array.isArray(resultado[0])
    ? (resultado[0] as T[])
    : (resultado as T[]);
  return filas?.[0];
}
