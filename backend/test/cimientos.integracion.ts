import 'reflect-metadata';
import { config as cargarEnv } from 'dotenv';
import { DataSource } from 'typeorm';
import { join } from 'path';

cargarEnv({ path: join(__dirname, '../../.env') });

/**
 * Las cuatro garantías de la Fase 0 contra un Postgres real.
 *
 * Ninguna se puede probar con un doble ni con sqlite: RLS, unicidad bajo
 * concurrencia y los permisos de tabla son comportamiento del motor. Un mock
 * que los simule sólo prueba que el mock hace lo que le pedimos.
 *
 * Se usan dos conexiones a propósito: DUEÑO para preparar el escenario (que
 * necesita evadir la RLS) y APLICACIÓN para ejercitarla.
 */

const comun = {
  type: 'postgres' as const,
  host: process.env.DATABASE_HOST || 'localhost',
  port: parseInt(process.env.DATABASE_PORT || '5433', 10),
  database: process.env.DATABASE_NAME || 'fleetfuel_db',
};

const dueño = new DataSource({
  ...comun,
  username: process.env.DATABASE_USER || 'fleetfuel_owner',
  password: process.env.DATABASE_PASSWORD || 'cambiar_en_produccion',
});

const app = new DataSource({
  ...comun,
  username: process.env.DATABASE_APP_USER || 'fleetfuel_app',
  password: process.env.DATABASE_APP_PASSWORD || 'cambiar_en_produccion_app',
});

let empresaA: string;
let empresaB: string;

/** Ejecuta como la aplicación, con el contexto de empresa fijado igual que el
 *  interceptor: SET LOCAL dentro de una transacción. */
async function comoEmpresa<T = any[]>(empresaId: string | null, fn: (q: any) => Promise<T>): Promise<T> {
  const runner = app.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    if (empresaId !== null) {
      await runner.query(`SELECT set_config('app.empresa_id', $1, true)`, [empresaId]);
    }
    return await fn(runner);
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    await runner.release();
  }
}

beforeAll(async () => {
  await dueño.initialize();
  await app.initialize();

  const [a] = await dueño.query(
    `INSERT INTO empresas (nombre, ruc) VALUES ('Operadora A','TEST-A')
     ON CONFLICT (ruc) DO UPDATE SET nombre = EXCLUDED.nombre RETURNING empresa_id`);
  const [b] = await dueño.query(
    `INSERT INTO empresas (nombre, ruc) VALUES ('Operadora B','TEST-B')
     ON CONFLICT (ruc) DO UPDATE SET nombre = EXCLUDED.nombre RETURNING empresa_id`);
  empresaA = String(a.empresa_id);
  empresaB = String(b.empresa_id);

  for (const [empresa, correo] of [[empresaA, 'ana@a.test'], [empresaB, 'beto@b.test']] as const) {
    await dueño.query(
      `INSERT INTO usuarios (empresa_id, nombre, correo, hash_clave)
       VALUES ($1,$2,$3,'x')
       ON CONFLICT (empresa_id, correo) WHERE eliminado_en IS NULL DO NOTHING`,
      [empresa, correo.split('@')[0], correo]);
  }
});

afterAll(async () => {
  await dueño.query(`DELETE FROM usuarios WHERE correo IN ('ana@a.test','beto@b.test')`);
  await dueño.query(`DELETE FROM empresas WHERE ruc IN ('TEST-A','TEST-B')`);
  await app.destroy();
  await dueño.destroy();
});

describe('ADR 003 · aislamiento por empresa', () => {
  it('cada empresa ve sólo sus usuarios', async () => {
    const deA = await comoEmpresa<any[]>(empresaA, (q) => q.query(`SELECT correo FROM usuarios`));
    const deB = await comoEmpresa<any[]>(empresaB, (q) => q.query(`SELECT correo FROM usuarios`));
    expect(deA.map((u: any) => u.correo)).toContain('ana@a.test');
    expect(deA.map((u: any) => u.correo)).not.toContain('beto@b.test');
    expect(deB.map((u: any) => u.correo)).toContain('beto@b.test');
    expect(deB.map((u: any) => u.correo)).not.toContain('ana@a.test');
  });

  it('sin contexto no se ve nada: falla cerrado, no abierto', async () => {
    // Es LA propiedad que hace segura la RLS. Si un descuido deja una consulta
    // fuera del interceptor, debe devolver cero filas — nunca todas.
    const filas = await comoEmpresa(null, (q) => q.query(`SELECT correo FROM usuarios`));
    expect(filas).toHaveLength(0);
  });

  it('no se puede insertar en otra empresa aunque se indique su id', async () => {
    await expect(
      comoEmpresa(empresaA, (q) =>
        q.query(`INSERT INTO usuarios (empresa_id, nombre, correo, hash_clave)
                 VALUES ($1,'Intruso','intruso@b.test','x')`, [empresaB])),
    ).rejects.toThrow(/row-level security/i);
  });

  it('la aplicación no tiene BYPASSRLS', async () => {
    const [rol] = await app.query(
      `SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user`);
    expect(rol.rolbypassrls).toBe(false);
    expect(rol.rolsuper).toBe(false);
  });
});

describe('§21 · la bitácora es append-only', () => {
  it('la aplicación puede insertar', async () => {
    const filas = await comoEmpresa(empresaA, (q) =>
      q.query(`INSERT INTO auditoria (empresa_id, accion, entidad) VALUES ($1,'POST','prueba')
               RETURNING auditoria_id`, [empresaA]));
    expect(filas).toHaveLength(1);
  });

  it('la aplicación NO puede editar lo ya registrado', async () => {
    await expect(
      comoEmpresa(empresaA, (q) => q.query(`UPDATE auditoria SET accion = 'alterado'`)),
    ).rejects.toThrow(/permission denied/i);
  });

  it('la aplicación NO puede borrar registros críticos (regla 14)', async () => {
    await expect(
      comoEmpresa(empresaA, (q) => q.query(`DELETE FROM auditoria`)),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      comoEmpresa(empresaA, (q) => q.query(`DELETE FROM usuarios`)),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe('ADR 004 · idempotencia', () => {
  it('la misma clave no se puede consumir dos veces en la misma empresa', async () => {
    await expect(comoEmpresa(empresaA, async (q) => {
      const sql = `INSERT INTO claves_idempotencia (empresa_id, clave, huella, expira_en)
                   VALUES ($1,'clave-de-prueba-1', repeat('a',64), now() + interval '1 hour')`;
      await q.query(sql, [empresaA]);
      await q.query(sql, [empresaA]);
    })).rejects.toThrow(/uq_idempotencia_empresa_clave|duplicate key/i);
  });

  it('dos empresas pueden usar la misma clave sin chocar', async () => {
    // Las claves las genera el cliente; que la operadora A queme una clave no
    // puede impedirle a B usar la suya.
    await comoEmpresa(empresaA, (q) =>
      q.query(`INSERT INTO claves_idempotencia (empresa_id, clave, huella, expira_en)
               VALUES ($1,'clave-compartida', repeat('b',64), now() + interval '1 hour')`, [empresaA]));
    await expect(comoEmpresa(empresaB, (q) =>
      q.query(`INSERT INTO claves_idempotencia (empresa_id, clave, huella, expira_en)
               VALUES ($1,'clave-compartida', repeat('b',64), now() + interval '1 hour')`, [empresaB])),
    ).resolves.toBeDefined();
  });
});

describe('login sin aflojar la RLS', () => {
  it('la función resuelve el correo aunque la tabla esté oculta', async () => {
    const filas = await comoEmpresa<any[]>(null, (q) =>
      q.query(`SELECT * FROM fn_login_resolver('ana@a.test')`));
    expect(filas).toHaveLength(1);
    expect(String(filas[0].empresa_id)).toBe(empresaA);
  });

  it('devuelve vacío para un correo inexistente, no un error', async () => {
    const filas = await comoEmpresa(null, (q) =>
      q.query(`SELECT * FROM fn_login_resolver('nadie@ninguna.test')`));
    expect(filas).toHaveLength(0);
  });

  it('la aplicación no puede leer usuarios por fuera de la función', async () => {
    const filas = await comoEmpresa(null, (q) =>
      q.query(`SELECT correo FROM usuarios WHERE correo = 'ana@a.test'`));
    expect(filas).toHaveLength(0);
  });
});
