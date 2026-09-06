import { hashSync } from 'bcryptjs';
import { randomBytes } from 'crypto';
import { COSTO_BCRYPT } from '../../common/costo-bcrypt';

/**
 * Hash contra el que se compara cuando el correo NO existe.
 *
 * Existe para que ese camino cueste lo mismo que el bueno y el tiempo de
 * respuesta no diga quién está registrado. Para que sirva tiene que cumplir
 * DOS condiciones, y las dos han fallado ya:
 *
 *   1. Ser un bcrypt VÁLIDO. Antes era la cadena inventada
 *      `$2a$10$invalidinvalid…`, que bcrypt rechaza al parsear sin hacer ni
 *      una ronda: 0,15 ms contra 85 ms. La llamada a `compare` estaba, y la
 *      protección no.
 *   2. Tener el MISMO coste que los hashes reales. Con coste 10 frente a los
 *      12 de `usuarios.service.ts`, el camino del correo inexistente seguía
 *      siendo tres veces más rápido. Por eso el coste sale de una constante
 *      compartida y no de un número escrito aquí.
 *
 * Se genera al arrancar sobre bytes aleatorios: válido por construcción, sin
 * preimagen conocida, y cuesta un bcrypt una sola vez en la vida del proceso.
 */
export const HASH_DE_DESCARTE = hashSync(randomBytes(32).toString('hex'), COSTO_BCRYPT);
