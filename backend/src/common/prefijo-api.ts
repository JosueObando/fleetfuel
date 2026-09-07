/**
 * El prefijo global de la API, en UN solo sitio.
 *
 * Vive aquí y no como literal en `main.ts` porque hay un segundo sitio que
 * necesita conocerlo: `entidadDeRuta`, en el interceptor de auditoría, tiene
 * que saltárselo para nombrar el recurso. Cuando el literal estaba sólo en
 * `main.ts`, ese segundo sitio lo deducía de la cadena tomando el primer tramo
 * —y el primer tramo ES el prefijo—, así que la bitácora habría dicho
 * `entidad = 'api'` para todas las rutas del sistema sin excepción.
 *
 * Un literal duplicado a ojo entre dos ficheros que no se citan es la forma de
 * que eso vuelva a pasar el día que el prefijo cambie.
 */
export const PREFIJO_API = 'api';
