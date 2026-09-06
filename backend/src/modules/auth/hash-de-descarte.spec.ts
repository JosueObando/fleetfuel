import { compare } from 'bcryptjs';
import { HASH_DE_DESCARTE } from './hash-de-descarte';
import { COSTO_BCRYPT } from '../../common/costo-bcrypt';

/*
 * El hash de descarte es lo único que impide que el login diga, por el tiempo
 * de respuesta, qué correos están registrados. Ha fallado dos veces y de dos
 * formas distintas, y las dos veces el código se leía correcto:
 *
 *   · era una cadena inventada que bcrypt rechaza al parsear → 0,15 ms
 *   · era válida pero de coste 10 frente a los 12 reales     → 4x más rápido
 *
 * Ninguna de las dos rompía nada visible. Estas pruebas son la red.
 */

describe('el hash de descarte', () => {
  it('es un bcrypt de verdad, no una cadena con pinta de serlo', () => {
    // `$2a$` o `$2b$`, coste de dos dígitos, y 53 caracteres de sal+hash.
    expect(HASH_DE_DESCARTE).toMatch(/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/);
  });

  it('cuesta LO MISMO que los hashes reales', () => {
    // Es la comprobación que faltaba. Un descarte de coste 10 contra usuarios
    // de coste 12 responde en la cuarta parte de tiempo, y esa diferencia es
    // el oráculo que todo esto existe para cerrar.
    const coste = Number(HASH_DE_DESCARTE.split('$')[2]);
    expect(coste).toBe(COSTO_BCRYPT);
  });

  it('compararse contra él cuesta trabajo de verdad', () => {
    // La prueba directa del efecto, no de la forma: si mañana bcrypt aprendiera
    // a descartar algo de este hash sin trabajar, el formato seguiría bien y
    // esto fallaría.
    const t = process.hrtime.bigint();
    return compare('una clave cualquiera', HASH_DE_DESCARTE).then(igual => {
      const ms = Number(process.hrtime.bigint() - t) / 1e6;
      expect(igual).toBe(false);
      expect(ms).toBeGreaterThan(50);
    });
  }, 20_000);

  it('nadie conoce su preimagen', () => {
    // Se genera de bytes aleatorios en cada arranque. Si fuera una constante
    // escrita en el código, alguien podría enviar esa clave y obtener `true`
    // del `compare` — que no autentica a nadie, pero convierte el camino del
    // correo inexistente en uno distinguible por su comportamiento.
    return expect(compare('descarte', HASH_DE_DESCARTE)).resolves.toBe(false);
  }, 20_000);
});
