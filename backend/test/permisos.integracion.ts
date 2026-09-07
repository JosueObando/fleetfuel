import 'reflect-metadata';
import { config as cargarEnv } from 'dotenv';
import { DataSource } from 'typeorm';
import { join } from 'path';

import { REPARTO, aplicarReparto } from '../src/database/reparto-permisos';

cargarEnv({ path: join(__dirname, '../../.env') });

/**
 * El reparto de permisos, contra la lista real de la base.
 *
 * Existe por un fallo concreto: el reparto estaba escrito en tres ficheros y
 * las migraciones lo aplicaban buscando el rol POR NOMBRE. En una base nueva
 * las migraciones corren antes que la semilla, el rol todavía no existe, el
 * `INSERT … SELECT` no encuentra nada y **no falla**. Producción llevaba días
 * levantada con un Administrador de 11 permisos sobre 48: no podía leer un
 * cliente. Nadie lo vio porque todas las comprobaciones iban por `/api/salud` y
 * `/auth/login`, que no tocan permisos.
 */

const dueño = new DataSource({
  type: 'postgres',
  host: process.env.DATABASE_HOST || 'localhost',
  port: parseInt(process.env.DATABASE_PORT || '5433', 10),
  database: process.env.DATABASE_NAME || 'fleetfuel_db',
  username: process.env.DATABASE_USER || 'fleetfuel_owner',
  password: process.env.DATABASE_PASSWORD || 'cambiar_en_produccion',
});

let empresa: string;
let catalogo: string[];
/** Lo que acaba teniendo cada rol de la empresa de prueba, tras el reparto. */
let concedidos: Map<string, Set<string>>;

beforeAll(async () => {
  await dueño.initialize();
  catalogo = (await dueño.query(`SELECT codigo FROM permisos ORDER BY codigo`))
    .map((f: { codigo: string }) => f.codigo);

  const [e] = await dueño.query(
    `INSERT INTO empresas (nombre, ruc) VALUES ('Permisos Test','PERM-TEST')
     ON CONFLICT (ruc) DO UPDATE SET nombre = EXCLUDED.nombre RETURNING empresa_id`);
  empresa = String(e.empresa_id);

  const roles = new Map<string, string>();
  for (const nombre of Object.keys(REPARTO)) {
    const [r] = await dueño.query(
      `INSERT INTO roles (empresa_id, nombre) VALUES ($1,$2)
       ON CONFLICT (empresa_id, nombre) DO UPDATE SET nombre = EXCLUDED.nombre
       RETURNING rol_id`, [empresa, nombre]);
    roles.set(nombre, String(r.rol_id));
  }
  await aplicarReparto((sql, params) => dueño.query(sql, params), roles);

  const filas = await dueño.query(
    `SELECT r.nombre AS rol, p.codigo FROM roles r
       JOIN roles_permisos rp ON rp.rol_id = r.rol_id
       JOIN permisos p ON p.permiso_id = rp.permiso_id
      WHERE r.empresa_id = $1`, [empresa]);
  concedidos = new Map();
  for (const f of filas as Array<{ rol: string; codigo: string }>) {
    if (!concedidos.has(f.rol)) concedidos.set(f.rol, new Set());
    concedidos.get(f.rol)!.add(f.codigo);
  }
});

afterAll(async () => {
  await dueño.query(`DELETE FROM roles_permisos WHERE rol_id IN
                       (SELECT rol_id FROM roles WHERE empresa_id = $1)`, [empresa]);
  await dueño.query(`DELETE FROM roles WHERE empresa_id = $1`, [empresa]);
  await dueño.query(`DELETE FROM empresas WHERE ruc = 'PERM-TEST'`);
  await dueño.destroy();
});

describe('el reparto y el catálogo de permisos se corresponden', () => {
  it('ningún código del reparto está mal escrito', () => {
    // Un código con una errata no falla: el `INSERT … SELECT … WHERE codigo=$2`
    // no encuentra la fila y no concede nada, en silencio. Es exactamente la
    // forma del fallo que este fichero existe para impedir.
    const enElCatalogo = new Set(catalogo);
    const inventados = [...new Set(Object.values(REPARTO).flat())]
      .filter(c => !enElCatalogo.has(c)).sort();
    expect(inventados).toEqual([]);
  });

  it('ningún permiso del catálogo queda sin dueño', () => {
    // Un permiso que nadie tiene es una funcionalidad inalcanzable: el endpoint
    // existe, responde 403 a todo el mundo, y nadie sabe por qué.
    const concedidosTodos = new Set(Object.values(REPARTO).flat());
    expect(catalogo.filter(c => !concedidosTodos.has(c))).toEqual([]);
  });
});

describe('lo que acaba en la base tras aplicar el reparto', () => {
  it('el Administrador tiene TODOS los permisos', () => {
    // Es la comprobación que en producción habría fallado: tenía 11 de 48.
    expect([...(concedidos.get('Administrador') ?? [])].sort()).toEqual(catalogo);
  });

  it('cada rol recibe exactamente lo que el reparto declara', () => {
    for (const [rol, codigos] of Object.entries(REPARTO)) {
      const esperado = [...new Set(codigos)].sort();
      const real = [...(concedidos.get(rol) ?? [])].sort();
      expect({ rol, real }).toEqual({ rol, real: esperado });
    }
  });

  it('aplicarlo dos veces no cambia nada', () => {
    // Se corre en cada siembra; si no fuera idempotente, duplicaría filas o
    // fallaría, y la siembra dejaría de poder repetirse.
    return expect((async () => {
      const roles = new Map<string, string>();
      for (const nombre of Object.keys(REPARTO)) {
        const [r] = await dueño.query(
          `SELECT rol_id FROM roles WHERE empresa_id=$1 AND nombre=$2`, [empresa, nombre]);
        roles.set(nombre, String(r.rol_id));
      }
      await aplicarReparto((sql, p) => dueño.query(sql, p), roles);
      const [{ n }] = await dueño.query(
        `SELECT count(*)::int AS n FROM roles_permisos rp
           JOIN roles r ON r.rol_id = rp.rol_id WHERE r.empresa_id = $1`, [empresa]);
      return n;
    })()).resolves.toBe(
      [...concedidos.values()].reduce((t, s) => t + s.size, 0));
  });

  it('avisa si el reparto nombra un rol que no existe', async () => {
    // Las migraciones se callaban en ese caso, y ese silencio es lo que costó
    // días de producción a medias.
    await expect(aplicarReparto(() => Promise.resolve(undefined), new Map()))
      .rejects.toThrow(/nombra un rol que no existe/);
  });
});

describe('las separaciones del §7 siguen en pie', () => {
  it('el Auditor no puede modificar nada', () => {
    // Si pudiera escribir dejaría de ser independiente de lo que audita.
    const suyos = [...(concedidos.get('Auditor') ?? [])];
    expect(suyos.filter(c => !c.endsWith(':leer'))).toEqual([]);
  });

  it('quien planifica el viaje NO lo autoriza', () => {
    // Es el control antifraude que separa armar un viaje de dejarlo salir.
    const planificador = concedidos.get('Planificador de flota') ?? new Set();
    expect(planificador.has('viajes:crear')).toBe(true);
    expect(planificador.has('viajes:autorizar')).toBe(false);
  });

  it('el DESPACHADOR sí autoriza: es lo que el §5 dice que hace', () => {
    // El PRD lo describe como «Autoriza salida y verifica documentos» y el rol
    // no tenía el permiso: la descripción y el reparto se contradecían. Se
    // corrigió el reparto —decisión del 2026-09-06— porque es lo que refuerza
    // la separación: el Planificador arma el viaje, el Despachador lo deja
    // salir, y ninguno hace las dos cosas.
    const despachador = concedidos.get('Despachador') ?? new Set();
    expect(despachador.has('viajes:autorizar')).toBe(true);
    expect(despachador.has('viajes:crear')).toBe(false);
  });

  it('nadie puede crear un viaje Y autorizarlo, salvo el Administrador', () => {
    // El Administrador es la excepción declarada: administra la empresa entera.
    // Cualquier OTRO rol que reúna las dos cosas rompe el control del §7 sin
    // que nada más lo señale.
    const infractores = [...concedidos.entries()]
      .filter(([rol]) => rol !== 'Administrador')
      .filter(([, p]) => p.has('viajes:crear') && p.has('viajes:autorizar'))
      .map(([rol]) => rol);
    expect(infractores).toEqual([]);
  });

  it('el Conductor y el Cliente externo sólo leen lo suyo', () => {
    for (const rol of ['Conductor', 'Cliente externo']) {
      const suyos = [...(concedidos.get(rol) ?? [])];
      expect(suyos.filter(c => !c.endsWith(':leer'))).toEqual([]);
      expect(suyos.length).toBeLessThanOrEqual(2);
    }
  });
});
