/**
 * El coste de bcrypt, en UN solo sitio.
 *
 * Estaba repetido en tres: `usuarios.service.ts` (12), la semilla (12 escrito a
 * mano) y el hash de descarte del login (10). Esa última divergencia era una
 * fuga real: comparar contra un hash de coste 10 tarda una cuarta parte que
 * hacerlo contra uno de coste 12, así que el camino del correo INEXISTENTE
 * respondía en ~133 ms y el del correo real en ~395 ms. Medido en producción.
 * Tres veces más rápido sigue siendo un cronómetro que dice qué correos
 * existen — mucho menos escandaloso que las 550 veces de antes, y suficiente.
 *
 * Subir este número endurece las claves y hace más lento el login: es un
 * intercambio deliberado, no un detalle. Y hay que subirlo AQUÍ, para que el
 * descarte suba con él.
 */
export const COSTO_BCRYPT = 12;
