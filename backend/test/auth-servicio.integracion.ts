import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { authenticator } from 'otplib';
import type Redis from 'ioredis';

import { AppModule } from '../src/app.module';
import { REDIS } from '../src/modules/auth/tokens.service';
import { AuthService } from '../src/modules/auth/auth.service';
import { CifradoService } from '../src/modules/auth/cifrado.service';
import { conexionDueño, conexionRedis, sembrarEmpresa, borrarEmpresa } from './apoyo/aplicacion';

/**
 * Los cinco caminos de `AuthService.login`, contra la aplicación real.
 *
 * Hasta ahora este servicio —383 líneas, el que decide quién entra— no tenía
 * ninguna prueba. Se comprobó a mano con `curl` el día que se tocó, y esa
 * comprobación no se repite sola mañana.
 *
 * Lo que se fija aquí no es sólo «devuelve 401 cuando toca». Son las tres
 * propiedades de seguridad que se pueden romper sin que nada falle:
 *
 *   1. El mensaje es el MISMO para «ese correo no existe» y «la clave está
 *      mal». Distinguirlos convierte el login en un directorio de correos.
 *   2. El tiempo de respuesta también es parecido, porque un correo que
 *      responde en 2 ms y otro en 80 ms dicen lo mismo que el mensaje.
 *   3. Cada fallo deja rastro con su motivo REAL, que es lo contrario de lo
 *      que se le dice al de fuera.
 */

const RUC = 'AUTH-TEST';
const CORREO = 'auth-prueba@ejemplo.test';

let modulo: TestingModule;
let auth: AuthService;
let cifrado: CifradoService;
let dueño: DataSource;
let redis: Redis;
let empresa: string;
let usuario: { id: string; correo: string; clave: string };

// `beforeEach` vacía la tabla, así que aquí basta con leerla entera: cada
// prueba ve exactamente lo que ella misma provocó.
const fallos = () => dueño.query(
  `SELECT motivo, correo, usuario_id FROM intentos_login ORDER BY intento_id DESC`);

beforeAll(async () => {
  dueño = conexionDueño();
  await dueño.initialize();
  redis = conexionRedis();

  ({ empresa, usuario } = await sembrarEmpresa(dueño, { ruc: RUC, correo: CORREO }));

  modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
  await modulo.init();
  auth = modulo.get(AuthService);
  cifrado = modulo.get(CifradoService);
}, 60_000);

afterAll(async () => {
  // El cliente de Redis lo crea una factoría, no un proveedor con ciclo de
  // vida, así que `modulo.close()` no lo cierra y el proceso de Jest se queda
  // colgado al terminar. Taparlo con `--forceExit` habría escondido esto.
  await (modulo?.get(REDIS) as Redis | undefined)?.quit().catch(() => undefined);
  await modulo?.close();
  await dueño.query(`DELETE FROM intentos_login WHERE correo LIKE '%@ejemplo.test'`);
  await borrarEmpresa(dueño, empresa, RUC);
  await dueño.destroy();
  await redis.quit();
});

beforeEach(async () => {
  await dueño.query(`DELETE FROM intentos_login`);
  await dueño.query(`UPDATE usuarios SET estado='activo', mfa_habilitado=false, mfa_secreto=NULL
                      WHERE usuario_id = $1`, [usuario.id]);
});

describe('el login no puede ser un directorio de correos', () => {
  it('da el MISMO mensaje si el correo no existe y si la clave está mal', async () => {
    const inexistente = await auth.login({ correo: 'nadie@ejemplo.test', clave: 'loquesea1' } as never)
      .catch(e => e);
    const claveMala = await auth.login({ correo: CORREO, clave: 'claveequivocada' } as never)
      .catch(e => e);

    expect(inexistente.message).toBe('Credenciales inválidas');
    expect(claveMala.message).toBe(inexistente.message);
    expect(claveMala.getStatus()).toBe(inexistente.getStatus());
  });

  it('tarda parecido en los dos casos', async () => {
    // El camino del correo inexistente compara contra un hash de descarte a
    // propósito. Ha fallado dos veces: primero porque la constante no era un
    // bcrypt válido (0,15 ms contra 85), después porque era de coste 10 frente
    // a los 12 reales (tres veces más rápido, medido en producción). Las dos
    // veces el código se leía correcto.
    //
    // Se promedian tres medidas porque una sola es ruido; el margen de 3x es
    // holgado a propósito, porque lo que se vigila es que la protección SIGA
    // ahí, no cronometrar con precisión.
    const cronometrar = async (correo: string) => {
      const t = process.hrtime.bigint();
      await auth.login({ correo, clave: 'claveequivocada' } as never).catch(() => undefined);
      return Number(process.hrtime.bigint() - t) / 1e6;
    };
    // El freno vive en el guard del controlador, no en el servicio, así que
    // repetir el mismo correo aquí no lo activa.
    const media = async (correo: string) => {
      const tomas: number[] = [];
      for (let i = 0; i < 3; i++) tomas.push(await cronometrar(correo));
      return tomas.reduce((a, b) => a + b) / tomas.length;
    };

    const sinUsuario = await media('nadie@ejemplo.test');
    const conUsuario = await media(CORREO);

    // Los dos hacen trabajo de bcrypt de verdad...
    expect(sinUsuario).toBeGreaterThan(50);
    expect(conUsuario).toBeGreaterThan(50);
    // ...y ninguno delata al otro por ser mucho más rápido.
    const razon = Math.max(sinUsuario, conUsuario) / Math.min(sinUsuario, conUsuario);
    expect(razon).toBeLessThan(3);
  }, 60_000);
});

describe('los cinco caminos dejan su motivo real', () => {
  it('correo desconocido · sin empresa ni usuario, que es la información', async () => {
    await auth.login({ correo: 'fantasma@ejemplo.test', clave: 'loquesea1' } as never).catch(() => undefined);
    const [f] = await fallos();
    expect(f.motivo).toBe('correo_desconocido');
    expect(f.usuario_id).toBeNull();
  });

  it('clave incorrecta · con empresa y usuario, porque el correo sí resolvió', async () => {
    await auth.login({ correo: CORREO, clave: 'claveequivocada' } as never).catch(() => undefined);
    const [f] = await fallos();
    expect(f.motivo).toBe('clave_incorrecta');
    expect(String(f.usuario_id)).toBe(usuario.id);
  });

  it('usuario suspendido · y responde 403, no 401', async () => {
    // Distinguirlo aquí SÍ es correcto: quien llega hasta este punto ya
    // demostró saber la clave, así que no se le está revelando nada.
    await dueño.query(`UPDATE usuarios SET estado='suspendido' WHERE usuario_id=$1`, [usuario.id]);
    const e = await auth.login({ correo: CORREO, clave: usuario.clave } as never).catch(x => x);
    expect(e.getStatus()).toBe(403);
    const [f] = await fallos();
    expect(f.motivo).toBe('usuario_suspendido');
  });

  it('MFA ausente · con la clave correcta pero sin código', async () => {
    await activarMfa();
    const e = await auth.login({ correo: CORREO, clave: usuario.clave } as never).catch(x => x);
    expect(e.message).toBe('Se requiere el código MFA');
    const [f] = await fallos();
    expect(f.motivo).toBe('mfa_ausente');
  });

  it('MFA incorrecto · el código no cuadra', async () => {
    await activarMfa();
    const e = await auth.login(
      { correo: CORREO, clave: usuario.clave, codigoTotp: '000000' } as never).catch(x => x);
    expect(e.message).toBe('Código MFA incorrecto');
    const [f] = await fallos();
    expect(f.motivo).toBe('mfa_incorrecto');
  });

  it('MFA habilitado sin secreto · es un fallo de configuración, no del que entra', async () => {
    await dueño.query(`UPDATE usuarios SET mfa_habilitado=true, mfa_secreto=NULL WHERE usuario_id=$1`,
      [usuario.id]);
    const e = await auth.login(
      { correo: CORREO, clave: usuario.clave, codigoTotp: '123456' } as never).catch(x => x);
    expect(e.getStatus()).toBe(403);
    const [f] = await fallos();
    expect(f.motivo).toBe('mfa_sin_secreto');
  });
});

describe('el camino que SÍ entra', () => {
  it('emite los dos tokens y no deja rastro de fallo', async () => {
    const sesion = await auth.login({ correo: CORREO, clave: usuario.clave } as never);
    expect(sesion).toHaveProperty('accessToken');
    expect(sesion).toHaveProperty('refreshToken');
    expect((sesion as { usuario: { correo: string } }).usuario.correo).toBe(CORREO);
    expect(await fallos()).toHaveLength(0);
  });

  it('con MFA habilitado y el código bueno, entra', async () => {
    const secreto = await activarMfa();
    const sesion = await auth.login({
      correo: CORREO, clave: usuario.clave, codigoTotp: authenticator.generate(secreto),
    } as never);
    expect(sesion).toHaveProperty('accessToken');
    expect(await fallos()).toHaveLength(0);
  });

  it('deja el acceso en la auditoría, con su IP', async () => {
    await dueño.query(`DELETE FROM auditoria WHERE empresa_id = $1`, [empresa]);
    await auth.login({ correo: CORREO, clave: usuario.clave } as never, '203.0.113.9');
    const [a] = await dueño.query(
      `SELECT accion, ruta, host(ip) AS ip FROM auditoria WHERE empresa_id=$1 ORDER BY auditoria_id DESC`,
      [empresa]);
    expect(a.accion).toBe('login');
    expect(a.ruta).toBe('POST /auth/login');
    expect(a.ip).toBe('203.0.113.9');
  });
});

/** Habilita TOTP para el usuario y devuelve el secreto en claro. */
async function activarMfa(): Promise<string> {
  const secreto = authenticator.generateSecret();
  await dueño.query(
    `UPDATE usuarios SET mfa_habilitado=true, mfa_secreto=$2 WHERE usuario_id=$1`,
    [usuario.id, cifrado.cifrar(secreto)]);
  return secreto;
}
