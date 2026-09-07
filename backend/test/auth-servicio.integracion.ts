import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { authenticator } from 'otplib';
import type Redis from 'ioredis';

import { AppModule } from '../src/app.module';
import { REDIS } from '../src/modules/auth/tokens.service';
import { AuthService } from '../src/modules/auth/auth.service';
import { CifradoService } from '../src/modules/auth/cifrado.service';
import { conexionDueño, conexionRedis, sembrarEmpresa, borrarEmpresa, darPermisos } from './apoyo/aplicacion';

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
  await (modulo?.get(REDIS))?.quit().catch(() => undefined);
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
    const inexistente = await auth.login({ correo: 'nadie@ejemplo.test', clave: 'loquesea1' })
      .catch(e => e);
    const claveMala = await auth.login({ correo: CORREO, clave: 'claveequivocada' })
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
      await auth.login({ correo, clave: 'claveequivocada' }).catch(() => undefined);
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
    await auth.login({ correo: 'fantasma@ejemplo.test', clave: 'loquesea1' }).catch(() => undefined);
    const [f] = await fallos();
    expect(f.motivo).toBe('correo_desconocido');
    expect(f.usuario_id).toBeNull();
  });

  it('clave incorrecta · con empresa y usuario, porque el correo sí resolvió', async () => {
    await auth.login({ correo: CORREO, clave: 'claveequivocada' }).catch(() => undefined);
    const [f] = await fallos();
    expect(f.motivo).toBe('clave_incorrecta');
    expect(String(f.usuario_id)).toBe(usuario.id);
  });

  it('usuario suspendido · y responde 403, no 401', async () => {
    // Distinguirlo aquí SÍ es correcto: quien llega hasta este punto ya
    // demostró saber la clave, así que no se le está revelando nada.
    await dueño.query(`UPDATE usuarios SET estado='suspendido' WHERE usuario_id=$1`, [usuario.id]);
    const e = await auth.login({ correo: CORREO, clave: usuario.clave }).catch(x => x);
    expect(e.getStatus()).toBe(403);
    const [f] = await fallos();
    expect(f.motivo).toBe('usuario_suspendido');
  });

  it('MFA ausente · con la clave correcta pero sin código', async () => {
    await activarMfa();
    const e = await auth.login({ correo: CORREO, clave: usuario.clave }).catch(x => x);
    expect(e.message).toBe('Se requiere el código MFA');
    const [f] = await fallos();
    expect(f.motivo).toBe('mfa_ausente');
  });

  it('MFA incorrecto · el código no cuadra', async () => {
    await activarMfa();
    const e = await auth.login(
      { correo: CORREO, clave: usuario.clave, codigoTotp: '000000' }).catch(x => x);
    expect(e.message).toBe('Código MFA incorrecto');
    const [f] = await fallos();
    expect(f.motivo).toBe('mfa_incorrecto');
  });

  it('MFA habilitado sin secreto · es un fallo de configuración, no del que entra', async () => {
    await dueño.query(`UPDATE usuarios SET mfa_habilitado=true, mfa_secreto=NULL WHERE usuario_id=$1`,
      [usuario.id]);
    const e = await auth.login(
      { correo: CORREO, clave: usuario.clave, codigoTotp: '123456' }).catch(x => x);
    expect(e.getStatus()).toBe(403);
    const [f] = await fallos();
    expect(f.motivo).toBe('mfa_sin_secreto');
  });
});

describe('el camino que SÍ entra', () => {
  it('emite los dos tokens y no deja rastro de fallo', async () => {
    const sesion = await auth.login({ correo: CORREO, clave: usuario.clave });
    expect(sesion).toHaveProperty('accessToken');
    expect(sesion).toHaveProperty('refreshToken');
    expect((sesion as { usuario: { correo: string } }).usuario.correo).toBe(CORREO);
    expect(await fallos()).toHaveLength(0);
  });

  it('con MFA habilitado y el código bueno, entra', async () => {
    const secreto = await activarMfa();
    const sesion = await auth.login({
      correo: CORREO, clave: usuario.clave, codigoTotp: authenticator.generate(secreto),
    });
    expect(sesion).toHaveProperty('accessToken');
    expect(await fallos()).toHaveLength(0);
  });

  it('deja el acceso en la auditoría, con su IP', async () => {
    await dueño.query(`DELETE FROM auditoria WHERE empresa_id = $1`, [empresa]);
    await auth.login({ correo: CORREO, clave: usuario.clave }, '203.0.113.9');
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

/* ─────────────────────── el refresco de sesión ───────────────────────
 *
 * Es la mitad del sistema de sesiones y no tenía ninguna prueba: 15 minutos de
 * token de acceso significan que el refresco corre cada cuarto de hora, y es
 * donde muerden de verdad el cierre de sesión, la revocación de un dispositivo
 * y la exigencia de MFA sobrevenida. Si alguna de esas dejara de morder, el
 * síntoma sería que una sesión revocada sigue funcionando — sin ningún error.
 */

/** Entra de verdad y devuelve la sesión completa. */
async function sesionAbierta(dispositivo?: string) {
  await dueño.query(`UPDATE usuarios SET mfa_habilitado=false, mfa_secreto=NULL, estado='activo'
                      WHERE usuario_id = $1`, [usuario.id]);
  return (await auth.login(
    { correo: CORREO, clave: usuario.clave, ...(dispositivo ? { dispositivo } : {}) },
  )) as { accessToken: string; refreshToken: string };
}

describe('refrescar · lo que rechaza', () => {
  it('un token que no es un JWT', async () => {
    await expect(auth.refrescar('no.es.un.token'))
      .rejects.toThrow(/Token de refresco inválido o vencido/);
  });

  it('un token de ACCESO usado como refresco', async () => {
    // Los dos son JWT válidos y del mismo emisor. Lo único que los separa es el
    // campo `tipo` y el secreto con que se firman: si esta comprobación se
    // cayera, un token de acceso robado se podría estirar indefinidamente.
    const s = await sesionAbierta();
    await expect(auth.refrescar(s.accessToken))
      .rejects.toThrow(/Token de refresco inválido o vencido|no sirve para refrescar/);
  });

  it('un refresco que ya se cerró sesión', async () => {
    // La firma sigue siendo auténtica: lo que dice que ya no vale es Redis.
    const s = await sesionAbierta();
    await auth.cerrarSesion(s.refreshToken);
    await expect(auth.refrescar(s.refreshToken))
      .rejects.toThrow(/Sesión revocada/);
  });

  it('un usuario suspendido DESPUÉS de entrar', async () => {
    // El token sigue vivo y firmado; la suspensión tiene que morder aquí o el
    // usuario seguiría operando hasta que venciera el refresco: siete días.
    const s = await sesionAbierta();
    await dueño.query(`UPDATE usuarios SET estado='suspendido' WHERE usuario_id=$1`, [usuario.id]);
    await expect(auth.refrescar(s.refreshToken)).rejects.toThrow(/Usuario no disponible/);
  });

  it('y al rechazarlo, revoca el refresco: no se puede reintentar', async () => {
    const s = await sesionAbierta();
    await dueño.query(`UPDATE usuarios SET estado='suspendido' WHERE usuario_id=$1`, [usuario.id]);
    await auth.refrescar(s.refreshToken).catch(() => undefined);
    await dueño.query(`UPDATE usuarios SET estado='activo' WHERE usuario_id=$1`, [usuario.id]);
    // Aunque se rehabilite al usuario, ese refresco ya está quemado.
    await expect(auth.refrescar(s.refreshToken)).rejects.toThrow(/Sesión revocada/);
  });

  it('un rol que EMPIEZA a exigir MFA corta el refresco', async () => {
    // §7, y no es redundante con el login: entre entrar y refrescar le pueden
    // asignar al usuario un rol que exige TOTP. Sin esta comprobación
    // refrescaría hacia una sesión completa sin haberse inscrito nunca.
    const rolId = await darPermisos(dueño, {
      empresa, usuarioId: usuario.id, nombreRol: `Exige MFA ${Date.now()}`,
      codigos: ['empresas:leer'], exigeMfa: false });
    const s = await sesionAbierta();
    await dueño.query(`UPDATE roles SET exige_mfa = true WHERE rol_id = $1`, [rolId]);

    await expect(auth.refrescar(s.refreshToken))
      .rejects.toThrow(/exige segundo factor. Inicia sesión de nuevo/);

    await dueño.query(`DELETE FROM usuarios_roles WHERE rol_id = $1`, [rolId]);
    await dueño.query(`DELETE FROM roles_permisos WHERE rol_id = $1`, [rolId]);
    await dueño.query(`DELETE FROM roles WHERE rol_id = $1`, [rolId]);
  }, 30_000);

  it('un dispositivo revocado corta el refresco', async () => {
    const s = await sesionAbierta('equipo-de-pruebas');
    await dueño.query(
      `UPDATE dispositivos SET revocado_en = now() WHERE usuario_id = $1 AND identificador = $2`,
      [usuario.id, 'equipo-de-pruebas']);
    await expect(auth.refrescar(s.refreshToken)).rejects.toThrow(/Dispositivo revocado/);
  }, 30_000);
});

describe('refrescar · lo que hace cuando acepta', () => {
  it('emite una sesión nueva', async () => {
    const s = await sesionAbierta();
    const nueva = await auth.refrescar(s.refreshToken);
    expect(nueva.accessToken).toBeTruthy();
    expect(nueva.refreshToken).toBeTruthy();
    expect(nueva.refreshToken).not.toBe(s.refreshToken);
  });

  it('ROTA: el refresco usado deja de valer en el acto', async () => {
    // Es lo que hace que un refresco robado sirva UNA vez, y que ese uso
    // delate a alguien: el siguiente que lo intente —el ladrón o el legítimo—
    // se encuentra la sesión revocada.
    const s = await sesionAbierta();
    await auth.refrescar(s.refreshToken);
    await expect(auth.refrescar(s.refreshToken)).rejects.toThrow(/Sesión revocada/);
  });

  it('la sesión nueva sí se puede volver a refrescar', async () => {
    const s = await sesionAbierta();
    const segunda = await auth.refrescar(s.refreshToken);
    const tercera = await auth.refrescar(segunda.refreshToken);
    expect(tercera.accessToken).toBeTruthy();
  });
});

describe('cerrar sesión', () => {
  it('mata el refresco', async () => {
    const s = await sesionAbierta();
    await auth.cerrarSesion(s.refreshToken);
    await expect(auth.refrescar(s.refreshToken)).rejects.toThrow(/Sesión revocada/);
  });

  it('con un token ya vencido o basura NO falla', async () => {
    // Cerrar sesión con algo que ya no vale es el resultado deseado: pedirle al
    // usuario que arregle su token para poder salir sería absurdo.
    await expect(auth.cerrarSesion('no.es.un.token')).resolves.toBeUndefined();
    await expect(auth.cerrarSesion('')).resolves.toBeUndefined();
  });
});

describe('el dispositivo se registra al entrar', () => {
  it('queda guardado con su identificador y su nombre', async () => {
    await dueño.query(`DELETE FROM dispositivos WHERE usuario_id = $1`, [usuario.id]);
    await auth.login({
      correo: CORREO, clave: usuario.clave,
      dispositivo: 'tableta-1', dispositivoNombre: 'Tableta del despachador',
    });
    const [d] = await dueño.query(
      `SELECT identificador, nombre FROM dispositivos WHERE usuario_id = $1`, [usuario.id]);
    expect(d.identificador).toBe('tableta-1');
    expect(d.nombre).toBe('Tableta del despachador');
  }, 30_000);

  it('entrar dos veces con el mismo equipo no crea dos filas', async () => {
    // Es un upsert por (usuario, identificador). Sin él, cada inicio de sesión
    // añadiría un «dispositivo» y la pantalla de revocación sería inservible.
    await dueño.query(`DELETE FROM dispositivos WHERE usuario_id = $1`, [usuario.id]);
    for (let i = 0; i < 3; i++) {
      await auth.login({ correo: CORREO, clave: usuario.clave, dispositivo: 'tableta-1' });
    }
    const [{ n }] = await dueño.query(
      `SELECT count(*)::int AS n FROM dispositivos WHERE usuario_id = $1`, [usuario.id]);
    expect(n).toBe(1);
  }, 30_000);

  it('entrar con un dispositivo REVOCADO se rechaza', async () => {
    await dueño.query(`DELETE FROM dispositivos WHERE usuario_id = $1`, [usuario.id]);
    await auth.login({ correo: CORREO, clave: usuario.clave, dispositivo: 'robado' });
    await dueño.query(
      `UPDATE dispositivos SET revocado_en = now() WHERE usuario_id=$1 AND identificador='robado'`,
      [usuario.id]);
    await expect(auth.login(
      { correo: CORREO, clave: usuario.clave, dispositivo: 'robado' }))
      .rejects.toThrow(/dispositivo fue revocado/);
  }, 30_000);
});
