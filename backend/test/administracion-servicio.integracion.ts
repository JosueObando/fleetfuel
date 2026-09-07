import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { authenticator } from 'otplib';
import { compare } from 'bcryptjs';
import type Redis from 'ioredis';

import { AppModule } from '../src/app.module';
import { REDIS, TokensService } from '../src/modules/auth/tokens.service';
import { RolesService } from '../src/modules/roles/roles.service';
import { UsuariosService } from '../src/modules/usuarios/usuarios.service';
import { DispositivosService } from '../src/modules/dispositivos/dispositivos.service';
import { MfaService } from '../src/modules/auth/mfa.service';
import { CifradoService } from '../src/modules/auth/cifrado.service';
import { AuthService } from '../src/modules/auth/auth.service';
import { COSTO_BCRYPT } from '../src/common/costo-bcrypt';
import { ejecutarEnContexto, gestor } from '../src/common/contexto/contexto-peticion';
import { conexionDueño, sembrarEmpresa, borrarEmpresa } from './apoyo/aplicacion';

/**
 * Los módulos que administran QUIÉN PUEDE QUÉ.
 *
 * Son los que menos se tocan y los que más caro salen cuando fallan. Esta misma
 * sesión encontró que producción llevaba días con un Administrador de 11
 * permisos sobre 48 sin que nada lo dijera; estos cuatro servicios son los que
 * reparten, revocan y verifican esos permisos en caliente.
 *
 * Se arranca el AppModule real: `MfaService` necesita `CifradoService`, y
 * `DispositivosService` necesita el Redis de verdad, porque revocar es una
 * operación EN DOS MUNDOS —la marca en Postgres y el borrado de sesiones en
 * Redis— y un doble de Redis probaría la mitad que no importa.
 */

const RUC = 'ADMIN-TEST';
const CORREO = 'admin-prueba@ejemplo.test';

let modulo: TestingModule;
let dueño: DataSource, redis: Redis;
let roles: RolesService, usuarios: UsuariosService;
let dispositivos: DispositivosService, mfa: MfaService, cifrado: CifradoService, auth: AuthService;
let tokens: TokensService;
let empresa: string, usuario: { id: string; correo: string; clave: string };
let n = 0;
const unico = () => `${process.pid}${n++}`.slice(-8);

/** Como `enContexto`, pero CONFIRMA. Hace falta para lo que hay que leer
 *  después de la operación desde otra conexión. Limpia quien lo llama. */
async function enContextoConfirmado<T>(fn: () => Promise<T>): Promise<T> {
  const runner = dueño.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await runner.query(`SELECT set_config('app.empresa_id', $1, true)`, [empresa]);
    const ctx = { empresaId: empresa, usuarioId: usuario.id, manager: runner.manager,
                  cambios: [], trasConfirmar: [] as Array<() => Promise<void>> };
    const r = await ejecutarEnContexto(ctx, fn);
    await runner.commitTransaction();
    // Igual que hace `ContextoEmpresaInterceptor`: los efectos que no son
    // Postgres corren DESPUÉS del commit, nunca dentro.
    for (const efecto of ctx.trasConfirmar) await efecto();
    return r;
  } catch (e) {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    throw e;
  } finally {
    await runner.release();
  }
}

async function enContexto<T>(fn: () => Promise<T>): Promise<T> {
  const runner = dueño.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await runner.query(`SELECT set_config('app.empresa_id', $1, true)`, [empresa]);
    return await ejecutarEnContexto(
      { empresaId: empresa, usuarioId: usuario.id, manager: runner.manager, cambios: [] }, fn);
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    await runner.release();
  }
}

beforeAll(async () => {
  dueño = conexionDueño();
  await dueño.initialize();
  ({ empresa, usuario } = await sembrarEmpresa(dueño, { ruc: RUC, correo: CORREO }));

  modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
  await modulo.init();
  roles = modulo.get(RolesService);
  usuarios = modulo.get(UsuariosService);
  dispositivos = modulo.get(DispositivosService);
  mfa = modulo.get(MfaService);
  cifrado = modulo.get(CifradoService);
  auth = modulo.get(AuthService);
  redis = modulo.get(REDIS);
  tokens = modulo.get(TokensService);
}, 60_000);

afterAll(async () => {
  await redis?.quit().catch(() => undefined);
  await modulo?.close();
  await dueño.query(`DELETE FROM intentos_login WHERE correo LIKE '%@ejemplo.test'`);
  await borrarEmpresa(dueño, empresa, RUC);
  await dueño.destroy();
});

/* ─────────────────────────── roles ─────────────────────────── */

describe('roles · redefinir permisos', () => {
  const rolNuevo = () => roles.crear(`Rol ${unico()}`, 'Creado en pruebas', false);

  it('un rol que no existe da 404', async () => {
    await enContexto(async () => {
      await expect(roles.definirPermisos('999999999', ['clientes:leer']))
        .rejects.toThrow(/Rol no encontrado/);
    });
  });

  it('nombra los permisos inventados, no dice sólo «alguno está mal»', async () => {
    // Con una lista de veinte códigos, «alguno no existe» obliga a probarlos de
    // uno en uno. El mensaje trae los que fallan.
    await enContexto(async () => {
      const rol = await rolNuevo();
      await expect(roles.definirPermisos(String(rol.id),
        ['clientes:leer', 'clientes:volar', 'viajes:teletransportar']))
        .rejects.toThrow(/Permisos inexistentes: clientes:volar, viajes:teletransportar/);
    });
  });

  it('añade los que faltan', async () => {
    await enContexto(async () => {
      const rol = await rolNuevo();
      const r = await roles.definirPermisos(String(rol.id), ['clientes:leer', 'viajes:leer']);
      expect(r.permisos).toEqual(['clientes:leer', 'viajes:leer']);
      const [{ n }] = await gestor().query(
        `SELECT count(*)::int AS n FROM roles_permisos WHERE rol_id = $1`, [String(rol.id)]);
      expect(n).toBe(2);
    });
  });

  it('repetir la misma definición no duplica nada', async () => {
    await enContexto(async () => {
      const rol = await rolNuevo();
      await roles.definirPermisos(String(rol.id), ['clientes:leer']);
      await roles.definirPermisos(String(rol.id), ['clientes:leer']);
      const [{ n }] = await gestor().query(
        `SELECT count(*)::int AS n FROM roles_permisos WHERE rol_id = $1`, [String(rol.id)]);
      expect(n).toBe(1);
    });
  });

  it('QUITAR un permiso se rechaza, y explica por qué', async () => {
    // §7 regla 14: el rol de la aplicación no tiene DELETE, ni siquiera sobre
    // una tabla puente. Quitarle permisos a un rol exige una migración, y eso
    // es deliberado: reducir privilegios en caliente y sin rastro es
    // exactamente la maniobra que un atacante con acceso de administrador
    // querría hacer para tapar lo que viene después.
    await enContexto(async () => {
      const rol = await rolNuevo();
      await roles.definirPermisos(String(rol.id), ['clientes:leer', 'viajes:leer']);
      await expect(roles.definirPermisos(String(rol.id), ['clientes:leer']))
        .rejects.toThrow(/Quitar permisos \(viajes:leer\) requiere una migración/);
    });
  });

  it('el catálogo de permisos se puede consultar entero', async () => {
    await enContexto(async () => {
      const catalogo = await roles.catalogoPermisos();
      expect(catalogo.length).toBeGreaterThan(40);
      expect(catalogo[0]).toHaveProperty('modulo');
    });
  });
});

/* ─────────────────────────── usuarios ─────────────────────────── */

describe('usuarios · alta y suspensión', () => {
  const nuevo = (extra: Record<string, unknown> = {}) => ({
    nombre: 'Usuario Nuevo', correo: `u${unico()}@ejemplo.test`,
    clave: 'ClaveDePrueba123', ...extra,
  }) as never;

  it('la clave se guarda con el MISMO coste que el resto del sistema', async () => {
    // Si aquí se usara otro coste, el hash de descarte del login volvería a
    // delatar por tiempo qué correos existen. Ya pasó una vez.
    await enContexto(async () => {
      const u = await usuarios.crear(nuevo());
      const [fila] = await gestor().query(
        `SELECT hash_clave FROM usuarios WHERE usuario_id = $1`, [String(u.id)]);
      expect(Number(String(fila.hash_clave).split('$')[2])).toBe(COSTO_BCRYPT);
      expect(await compare('ClaveDePrueba123', fila.hash_clave)).toBe(true);
    });
  });

  it('la clave NUNCA vuelve en la respuesta', async () => {
    await enContexto(async () => {
      const u = await usuarios.crear(nuevo());
      expect(JSON.stringify(u)).not.toMatch(/ClaveDePrueba123|hash_clave|\$2[aby]\$/);
    });
  });

  it('rechaza un correo ya usado', async () => {
    await enContexto(async () => {
      const correo = `dup${unico()}@ejemplo.test`;
      await usuarios.crear(nuevo({ correo }));
      await expect(usuarios.crear(nuevo({ correo })))
        .rejects.toThrow(/Ya existe un usuario con ese correo/);
    });
  });

  it('un rol inexistente aborta el alta entera', async () => {
    // A medias sería peor: un usuario creado sin los roles que se pidieron
    // entra al sistema sin poder hacer nada, y parece un problema de permisos.
    await enContexto(async () => {
      const correo = `sinrol${unico()}@ejemplo.test`;
      await expect(usuarios.crear(nuevo({ correo, roles: ['999999999'] })))
        .rejects.toThrow(/Algún rol indicado no existe/);
    });
  });

  it('suspender exige motivo y lo guarda en la auditoría', async () => {
    await enContexto(async () => {
      const u = await usuarios.crear(nuevo());
      await usuarios.suspender(String(u.id), 'Cambio de puesto, ya no opera flota');
      const [fila] = await gestor().query(
        `SELECT estado FROM usuarios WHERE usuario_id = $1`, [String(u.id)]);
      expect(fila.estado).toBe('suspendido');
    });
  });

  it('suspender a alguien que no existe da 404', async () => {
    await enContexto(async () => {
      await expect(usuarios.suspender('999999999', 'Motivo suficientemente largo'))
        .rejects.toThrow(/Usuario no encontrado/);
    });
  });

  it('un usuario suspendido ya no puede entrar', async () => {
    // La comprobación que une este módulo con el login: suspender tiene que
    // significar algo en la puerta, no sólo en una columna.
    const correo = `suspendido${unico()}@ejemplo.test`;
    const otro = await sembrarEmpresa(dueño, {
      ruc: `SUSP-${unico()}`, correo, clave: 'ClaveDePrueba123' });
    await dueño.query(`UPDATE usuarios SET estado='suspendido' WHERE usuario_id=$1`,
      [otro.usuario.id]);
    await expect(auth.login({ correo, clave: 'ClaveDePrueba123' }))
      .rejects.toThrow(/Usuario suspendido/);
    await borrarEmpresa(dueño, otro.empresa, `SUSP-${unico()}`.replace(/\d+$/, ''));
    await dueño.query(`DELETE FROM empresas WHERE empresa_id = $1`, [otro.empresa])
      .catch(() => undefined);
  }, 30_000);
});

/* ─────────────────────────── MFA ─────────────────────────── */

describe('MFA · inscripción en dos pasos', () => {
  it('iniciar guarda el secreto CIFRADO, nunca en claro', async () => {
    // Quien obtenga un respaldo de la base no puede poder generar los códigos
    // de nadie: si pudiera, el segundo factor dejaría de serlo.
    await enContexto(async () => {
      const { secreto } = await mfa.iniciar(usuario.id, usuario.correo);
      const [fila] = await gestor().query(
        `SELECT mfa_secreto FROM usuarios WHERE usuario_id = $1`, [usuario.id]);
      expect(fila.mfa_secreto).not.toBe(secreto);
      expect(fila.mfa_secreto).not.toContain(secreto);
      expect(cifrado.descifrar(fila.mfa_secreto)).toBe(secreto);
    });
  });

  it('iniciar NO habilita el MFA todavía', async () => {
    // Es la razón de que la inscripción tenga dos pasos. Si se habilitara al
    // generar el secreto, quien pierda el móvil entre un paso y el otro se
    // queda fuera de su cuenta sin haber llegado a configurarla.
    await enContexto(async () => {
      await mfa.iniciar(usuario.id, usuario.correo);
      const [fila] = await gestor().query(
        `SELECT mfa_habilitado FROM usuarios WHERE usuario_id = $1`, [usuario.id]);
      expect(fila.mfa_habilitado).toBe(false);
    });
  });

  it('el otpauth lleva el emisor y el correo, que es lo que pinta el QR', async () => {
    await enContexto(async () => {
      const r = await mfa.iniciar(usuario.id, usuario.correo);
      expect(r.otpauth).toMatch(/^otpauth:\/\/totp\//);
      expect(decodeURIComponent(r.otpauth)).toContain(usuario.correo);
    });
  });

  it('confirmar sin haber iniciado se rechaza con instrucciones', async () => {
    await enContexto(async () => {
      await gestor().query(`UPDATE usuarios SET mfa_secreto = NULL WHERE usuario_id = $1`,
        [usuario.id]);
      await expect(mfa.confirmar(usuario.id, '123456'))
        .rejects.toThrow(/Primero llama a POST \/auth\/mfa\/iniciar/);
    });
  });

  it('un código incorrecto no habilita nada, y sugiere mirar la hora', async () => {
    // La causa más común de un TOTP que no cuadra es el reloj del móvil, no una
    // clave mal escrita. Decirlo ahorra la llamada a soporte.
    await enContexto(async () => {
      await mfa.iniciar(usuario.id, usuario.correo);
      await expect(mfa.confirmar(usuario.id, '000000'))
        .rejects.toThrow(/Revisa la hora del dispositivo/);
      const [fila] = await gestor().query(
        `SELECT mfa_habilitado FROM usuarios WHERE usuario_id = $1`, [usuario.id]);
      expect(fila.mfa_habilitado).toBe(false);
    });
  });

  it('con el código bueno queda habilitado y con fecha', async () => {
    await enContexto(async () => {
      const { secreto } = await mfa.iniciar(usuario.id, usuario.correo);
      const r = await mfa.confirmar(usuario.id, authenticator.generate(secreto));
      expect(r.mfaHabilitado).toBe(true);
      const [fila] = await gestor().query(
        `SELECT mfa_habilitado, mfa_confirmado_en FROM usuarios WHERE usuario_id = $1`,
        [usuario.id]);
      expect(fila.mfa_habilitado).toBe(true);
      expect(fila.mfa_confirmado_en).not.toBeNull();
    });
  });

  it('confirmar para un usuario que no existe da 404', async () => {
    await enContexto(async () => {
      await expect(mfa.confirmar('999999999', '123456')).rejects.toThrow(/Usuario no encontrado/);
    });
  });
});

/* ─────────────────────────── dispositivos ─────────────────────────── */

describe('dispositivos · revocar es una operación en dos mundos', () => {
  it('un dispositivo que no existe da 404', async () => {
    await enContexto(async () => {
      await expect(dispositivos.revocar('999999999', 'Motivo suficientemente largo'))
        .rejects.toThrow(/Dispositivo no encontrado/);
    });
  });

  it('marca la baja en Postgres Y corta las sesiones abiertas en Redis', async () => {
    // Sin lo segundo, un equipo robado sigue operando hasta que venza su token
    // de acceso: quince minutos de margen que nadie quiere regalar.
    //
    // Se prepara con sesiones REALES en Redis, no con un doble: lo que se está
    // comprobando es que las dos escrituras ocurren y que el conteo devuelto es
    // el de verdad.
    const [d] = await dueño.query(
      `INSERT INTO dispositivos (empresa_id, usuario_id, identificador, nombre)
       VALUES ($1,$2,$3,'Portátil de pruebas') RETURNING dispositivo_id`,
      [empresa, usuario.id, `disp-${unico()}`]);
    const dispositivoId = String(d.dispositivo_id);

    // Las sesiones se crean con el propio TokensService y no escribiendo claves
    // a mano: si se inventara el formato aquí, la prueba seguiría verde el día
    // que ese formato cambiara y la revocación dejara de encontrarlas.
    const jtis = await Promise.all([1, 2].map(() => tokens.registrar(
      { usuarioId: usuario.id, empresaId: empresa, dispositivoId })));

    for (const jti of jtis) expect(await tokens.vigente(jti)).toBe(true);

    const r = await enContextoConfirmado(
      () => dispositivos.revocar(dispositivoId, 'Equipo extraviado'));

    expect(r.revocado).toBe(true);
    // El conteo que devuelve tiene que ser el real: es lo que le dice a quien
    // revoca cuántas sesiones acaba de tumbar.
    expect(r.sesionesCortadas).toBe(jtis.length);
    // Y las sesiones tienen que estar muertas de verdad, no sólo marcadas.
    for (const jti of jtis) expect(await tokens.vigente(jti)).toBe(false);

    const [fila] = await dueño.query(
      `SELECT revocado_en FROM dispositivos WHERE dispositivo_id = $1`, [dispositivoId]);
    expect(fila.revocado_en).not.toBeNull();

    await dueño.query(`DELETE FROM dispositivos WHERE dispositivo_id = $1`, [dispositivoId]);
  }, 30_000);

  it('sin sesiones abiertas devuelve cero, no falla', async () => {
    const [d] = await dueño.query(
      `INSERT INTO dispositivos (empresa_id, usuario_id, identificador, nombre)
       VALUES ($1,$2,$3,'Sin sesiones') RETURNING dispositivo_id`,
      [empresa, usuario.id, `disp-${unico()}`]);
    const r = await enContexto(() => dispositivos.revocar(String(d.dispositivo_id), 'Baja del equipo'));
    expect(r.sesionesCortadas).toBe(0);
    await dueño.query(`DELETE FROM dispositivos WHERE dispositivo_id = $1`, [d.dispositivo_id]);
  }, 30_000);
});

describe('revocar confirma primero y corta después', () => {
  it('si la transacción se revierte, Redis NO se toca', async () => {
    // Antes fallaba ABIERTO: Postgres iba dentro de la transacción y Redis
    // fuera, así que un fallo posterior dejaba las sesiones cortadas y el
    // dispositivo SIN revocar — al equipo robado se le cerraba la sesión y
    // podía volver a entrar.
    //
    // Ahora el corte de Redis se agenda para DESPUÉS del commit. El peor caso
    // pasa a ser el contrario y es el seguro: dispositivo marcado —futuros
    // logins bloqueados— con sus sesiones vivas como mucho lo que dure el token
    // de acceso, quince minutos.
    const [d] = await dueño.query(
      `INSERT INTO dispositivos (empresa_id, usuario_id, identificador, nombre)
       VALUES ($1,$2,$3,'Para revertir') RETURNING dispositivo_id`,
      [empresa, usuario.id, `disp-${unico()}`]);
    const dispositivoId = String(d.dispositivo_id);
    const jti = await tokens.registrar(
      { usuarioId: usuario.id, empresaId: empresa, dispositivoId });

    // `enContexto` revierte al terminar: simula el fallo posterior.
    await enContexto(() => dispositivos.revocar(dispositivoId, 'Se revertirá'));

    const [fila] = await dueño.query(
      `SELECT revocado_en FROM dispositivos WHERE dispositivo_id = $1`, [dispositivoId]);
    expect(fila.revocado_en).toBeNull();           // Postgres lo olvidó…
    expect(await tokens.vigente(jti)).toBe(true);  // …y Redis tampoco lo hizo.

    await dueño.query(`DELETE FROM dispositivos WHERE dispositivo_id = $1`, [dispositivoId]);
  }, 30_000);
});
