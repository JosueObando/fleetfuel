import 'reflect-metadata';
import { config as cargarEnv } from 'dotenv';
import { DataSource } from 'typeorm';
import { join } from 'path';

cargarEnv({ path: join(__dirname, '../../.env') });

/**
 * Garantías de la Fase 1A contra un Postgres real.
 *
 * Lo que se prueba aquí es de motor, no de aplicación: aislamiento por RLS,
 * unicidad compuesta por empresa, restricciones CHECK y privilegios de tabla.
 * Un doble no puede probar ninguna: sólo probaría que el doble hace lo que le
 * pedimos.
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

const TABLAS_1A = ['clientes', 'estaciones_servicio', 'productos_combustible', 'vehiculos',
                   'cisternas', 'compartimentos_cisterna', 'conductores'] as const;

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
    // Siempre rollback: cada prueba deja la base como la encontró, así que el
    // orden entre ellas no importa y ninguna depende del rastro de otra.
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    await runner.release();
  }
}

beforeAll(async () => {
  await dueño.initialize();
  await app.initialize();

  const [a] = await dueño.query(
    `INSERT INTO empresas (nombre, ruc) VALUES ('Catalogos A','CAT-A')
     ON CONFLICT (ruc) DO UPDATE SET nombre = EXCLUDED.nombre RETURNING empresa_id`);
  const [b] = await dueño.query(
    `INSERT INTO empresas (nombre, ruc) VALUES ('Catalogos B','CAT-B')
     ON CONFLICT (ruc) DO UPDATE SET nombre = EXCLUDED.nombre RETURNING empresa_id`);
  empresaA = String(a.empresa_id);
  empresaB = String(b.empresa_id);

  for (const [empresa, nombre] of [[empresaA, 'Cliente de A'], [empresaB, 'Cliente de B']] as const) {
    await dueño.query(
      `INSERT INTO clientes (empresa_id, nombre, ruc) VALUES ($1, $2, $3)`,
      [empresa, nombre, `RUC-${nombre.slice(-1)}`]);
  }

  // Una fila en cada uno de los siete catálogos, CONFIRMADA (con el dueño, no
  // dentro de una transacción que revierte). Sin esto, la prueba de «sin
  // contexto no se ve nada» pasaría en vacío sobre una base limpia como la de
  // CI: diría «cero filas» sobre cero filas, que no prueba absolutamente nada.
  const [cli] = await dueño.query(
    `SELECT cliente_id FROM clientes WHERE empresa_id = $1 LIMIT 1`, [empresaA]);
  await dueño.query(
    `INSERT INTO estaciones_servicio (empresa_id, cliente_id, nombre) VALUES ($1,$2,'Sembrada')`,
    [empresaA, cli.cliente_id]);
  await dueño.query(
    `INSERT INTO productos_combustible (empresa_id, codigo, nombre) VALUES ($1,'SEM','Sembrado')`, [empresaA]);
  const [veh] = await dueño.query(
    `INSERT INTO vehiculos (empresa_id, tipo_vehiculo, placa) VALUES ($1,'cisterna','SEM-1')
     RETURNING vehiculo_id`, [empresaA]);
  const [cis] = await dueño.query(
    `INSERT INTO cisternas (empresa_id, vehiculo_id, capacidad_total) VALUES ($1,$2,9000)
     RETURNING cisterna_id`, [empresaA, veh.vehiculo_id]);
  await dueño.query(
    `INSERT INTO compartimentos_cisterna
       (empresa_id, cisterna_id, numero, capacidad_nominal, capacidad_calibrada)
     VALUES ($1,$2,1,3000,2990)`, [empresaA, cis.cisterna_id]);
  await dueño.query(
    `INSERT INTO conductores (empresa_id, nombre_completo, documento, licencia)
     VALUES ($1,'Sembrado','DOC-SEM','LIC-SEM')`, [empresaA]);
});

afterAll(async () => {
  // CASCADE porque los compartimentos cuelgan de las cisternas: sin él, el
  // borrado de empresas fallaría por clave foránea.
  for (const t of ['compartimentos_cisterna', 'cisternas', 'vehiculos', 'conductores',
                   'estaciones_servicio', 'productos_combustible', 'clientes']) {
    await dueño.query(`DELETE FROM ${t} WHERE empresa_id IN ($1, $2)`, [empresaA, empresaB]);
  }
  await dueño.query(`DELETE FROM empresas WHERE ruc IN ('CAT-A','CAT-B')`);
  await app.destroy();
  await dueño.destroy();
});

describe('1A · aislamiento de los catálogos', () => {
  it('cada empresa ve sólo sus clientes', async () => {
    const deA = await comoEmpresa<any[]>(empresaA, q => q.query(`SELECT nombre FROM clientes`));
    const deB = await comoEmpresa<any[]>(empresaB, q => q.query(`SELECT nombre FROM clientes`));
    expect(deA.map(c => c.nombre)).toEqual(['Cliente de A']);
    expect(deB.map(c => c.nombre)).toEqual(['Cliente de B']);
  });

  it('sin contexto los siete catálogos devuelven cero filas', async () => {
    // La propiedad que hace segura la RLS: una consulta que se escape del
    // interceptor debe devolver nada, nunca todo.
    for (const tabla of TABLAS_1A) {
      // Control: con contexto SÍ hay filas. Sin este control, la comprobación
      // de abajo pasaría en vacío sobre una tabla vacía.
      const conContexto = await comoEmpresa<any[]>(empresaA, q => q.query(`SELECT 1 FROM ${tabla}`));
      expect({ tabla, hayFilas: conContexto.length > 0 }).toEqual({ tabla, hayFilas: true });

      const sinContexto = await comoEmpresa<any[]>(null, q => q.query(`SELECT 1 FROM ${tabla}`));
      expect({ tabla, filas: sinContexto.length }).toEqual({ tabla, filas: 0 });
    }
  });

  it('no se puede insertar en otra empresa aunque se indique su id', async () => {
    await expect(
      comoEmpresa(empresaA, q =>
        q.query(`INSERT INTO clientes (empresa_id, nombre) VALUES ($1, 'Intruso')`, [empresaB])),
    ).rejects.toThrow(/row-level security/i);
  });
});

describe('1A · unicidad compuesta por empresa', () => {
  it('dos empresas distintas pueden registrar el mismo RUC', async () => {
    // No es un detalle de modelado: con unicidad global, una operadora podría
    // deducir la cartera de otra por el error de clave duplicada.
    const runner = dueño.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      await runner.query(
        `INSERT INTO clientes (empresa_id, nombre, ruc) VALUES ($1,'Compartido','RUC-COMUN')`, [empresaA]);
      await expect(runner.query(
        `INSERT INTO clientes (empresa_id, nombre, ruc) VALUES ($1,'Compartido','RUC-COMUN')`, [empresaB]),
      ).resolves.toBeDefined();
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  });

  it('la misma empresa no puede repetir placa', async () => {
    await expect(comoEmpresa(empresaA, async q => {
      await q.query(`INSERT INTO vehiculos (empresa_id, tipo_vehiculo, placa) VALUES ($1,'cisterna','DUP-1')`, [empresaA]);
      await q.query(`INSERT INTO vehiculos (empresa_id, tipo_vehiculo, placa) VALUES ($1,'cisterna','DUP-1')`, [empresaA]);
    })).rejects.toThrow(/uq_vehiculos_empresa_placa|duplicate key/i);
  });
});

describe('1A · reglas en el motor, no sólo en la aplicación', () => {
  it('la capacidad calibrada no puede superar la nominal', async () => {
    await expect(comoEmpresa(empresaA, async q => {
      const [v] = await q.query(
        `INSERT INTO vehiculos (empresa_id, tipo_vehiculo, placa) VALUES ($1,'cisterna','CHK-1')
         RETURNING vehiculo_id`, [empresaA]);
      const [c] = await q.query(
        `INSERT INTO cisternas (empresa_id, vehiculo_id, capacidad_total) VALUES ($1,$2,9000)
         RETURNING cisterna_id`, [empresaA, v.vehiculo_id]);
      // Calibrada 200 > nominal 100: lo rechaza el CHECK, no el servicio.
      await q.query(
        `INSERT INTO compartimentos_cisterna
           (empresa_id, cisterna_id, numero, capacidad_nominal, capacidad_calibrada)
         VALUES ($1,$2,1,100,200)`, [empresaA, c.cisterna_id]);
    })).rejects.toThrow(/ck_compartimentos_capacidades/i);
  });

  it('la tolerancia de merma vive entre 0 y 100', async () => {
    await expect(comoEmpresa(empresaA, q =>
      q.query(`INSERT INTO productos_combustible (empresa_id, codigo, nombre, tolerancia_merma)
               VALUES ($1,'MERMA','X',150)`, [empresaA]),
    )).rejects.toThrow(/ck_productos_merma/i);
  });

  it('la próxima calibración no puede ser anterior a la última', async () => {
    await expect(comoEmpresa(empresaA, async q => {
      const [v] = await q.query(
        `INSERT INTO vehiculos (empresa_id, tipo_vehiculo, placa) VALUES ($1,'cisterna','CHK-2')
         RETURNING vehiculo_id`, [empresaA]);
      await q.query(
        `INSERT INTO cisternas (empresa_id, vehiculo_id, capacidad_total,
                                fecha_calibracion, fecha_proxima_calibracion)
         VALUES ($1,$2,9000,'2026-06-01','2026-01-01')`, [empresaA, v.vehiculo_id]);
    })).rejects.toThrow(/ck_cisternas_calibracion/i);
  });

  it('un vehículo no admite dos cisternas vivas', async () => {
    await expect(comoEmpresa(empresaA, async q => {
      const [v] = await q.query(
        `INSERT INTO vehiculos (empresa_id, tipo_vehiculo, placa) VALUES ($1,'cisterna','CHK-3')
         RETURNING vehiculo_id`, [empresaA]);
      for (let i = 0; i < 2; i++) {
        await q.query(`INSERT INTO cisternas (empresa_id, vehiculo_id, capacidad_total)
                       VALUES ($1,$2,9000)`, [empresaA, v.vehiculo_id]);
      }
    })).rejects.toThrow(/uq_cisternas_vehiculo_viva|duplicate key/i);
  });
});

describe('1A · privilegios del rol de aplicación (regla 14)', () => {
  it('no puede borrar de ningún catálogo: la baja es lógica', async () => {
    for (const tabla of ['clientes', 'estaciones_servicio', 'productos_combustible',
                         'vehiculos', 'cisternas', 'conductores']) {
      await expect(
        comoEmpresa(empresaA, q => q.query(`DELETE FROM ${tabla} WHERE 1=0`)),
      ).rejects.toThrow(/permission denied/i);
    }
  });
});
