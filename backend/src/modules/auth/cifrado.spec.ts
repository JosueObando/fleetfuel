import { ConfigService } from '@nestjs/config';
import { CifradoService } from './cifrado.service';

/*
 * El cifrado de los secretos TOTP.
 *
 * Dos propiedades, y las dos fallan en silencio si se rompen:
 *
 *   1. En producción NO se arranca con el secreto de ejemplo. Si esa
 *      comprobación desapareciera, el sistema levantaría igual y los secretos
 *      MFA quedarían cifrados con una llave que está escrita en el repositorio.
 *   2. Un secreto manipulado en la base FALLA al descifrar. Con AES-CBC
 *      produciría basura, y esa basura se usaría como semilla TOTP: los códigos
 *      dejarían de cuadrar y parecería un problema del reloj del móvil.
 */

const config = (valores: Record<string, string>) =>
  ({ get: (k: string) => valores[k] }) as unknown as ConfigService;

const SECRETO_REAL = 'un-secreto-de-verdad-largo-y-aleatorio-123456';

describe('la puerta de arranque', () => {
  it('se niega a arrancar en producción con el secreto de ejemplo', () => {
    expect(() => new CifradoService(
      config({ env: 'production', 'jwt.secret': 'cambiar_este_secreto_en_produccion' })))
      .toThrow(/JWT_SECRET sigue con el valor de ejemplo/);
  });

  it('arranca en producción con un secreto propio', () => {
    expect(() => new CifradoService(
      config({ env: 'production', 'jwt.secret': SECRETO_REAL }))).not.toThrow();
  });

  it('en desarrollo deja pasar el de ejemplo', () => {
    // Sería insoportable exigir un secreto propio para levantar el entorno
    // local; el riesgo que se vigila es el de producción.
    expect(() => new CifradoService(
      config({ env: 'development', 'jwt.secret': 'cambiar_este_secreto_en_produccion' })))
      .not.toThrow();
  });

  it('sin secreto configurado tampoco revienta al construir', () => {
    expect(() => new CifradoService(config({}))).not.toThrow();
  });
});

describe('cifrar y descifrar', () => {
  const servicio = new CifradoService(config({ env: 'test', 'jwt.secret': SECRETO_REAL }));

  it('lo que se cifra se recupera igual', () => {
    const secreto = 'JBSWY3DPEHPK3PXP';
    expect(servicio.descifrar(servicio.cifrar(secreto))).toBe(secreto);
  });

  it('el mismo texto cifrado dos veces NO da lo mismo', () => {
    // Cada cifrado lleva su propio vector de inicialización. Si dos secretos
    // iguales produjeran el mismo sobre, quien mirase la tabla sabría qué
    // usuarios comparten secreto — y con uno solo tendría todos.
    const a = servicio.cifrar('JBSWY3DPEHPK3PXP');
    const b = servicio.cifrar('JBSWY3DPEHPK3PXP');
    expect(a).not.toBe(b);
    expect(servicio.descifrar(a)).toBe(servicio.descifrar(b));
  });

  it('el secreto no aparece en claro dentro del sobre', () => {
    const secreto = 'JBSWY3DPEHPK3PXP';
    expect(servicio.cifrar(secreto)).not.toContain(secreto);
  });

  it('un sobre MANIPULADO falla, no devuelve basura', () => {
    // Es la razón de usar GCM y no CBC: GCM autentica el texto cifrado. Con CBC
    // esto devolvería bytes cualesquiera que se usarían como semilla TOTP, y el
    // fallo se manifestaría como «los códigos no cuadran» — indistinguible de un
    // reloj desajustado, y muy difícil de rastrear hasta aquí.
    const sobre = servicio.cifrar('JBSWY3DPEHPK3PXP');
    const partes = sobre.split(':');
    const manipulado = [...partes.slice(0, -1), 'ff'.repeat(16)].join(':');
    expect(() => servicio.descifrar(manipulado)).toThrow();
  });

  it('un sobre con otra llave no se puede abrir', () => {
    const otro = new CifradoService(config({ env: 'test', 'jwt.secret': 'otra-llave-distinta-987' }));
    expect(() => otro.descifrar(servicio.cifrar('JBSWY3DPEHPK3PXP'))).toThrow();
  });

  it('basura que no tiene forma de sobre falla limpio', () => {
    for (const basura of ['', 'no-es-un-sobre', 'a:b', ':::']) {
      expect(() => servicio.descifrar(basura)).toThrow();
    }
  });
});
