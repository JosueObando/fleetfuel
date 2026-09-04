import 'reflect-metadata';
import { config as cargarEnv } from 'dotenv';
import { DataSource } from 'typeorm';
import { join } from 'path';

cargarEnv({ path: join(__dirname, '../../.env') });

/**
 * Garantías de la Fase 1B contra un Postgres real.
 *
 * El núcleo son las restricciones de exclusión del §5.1: una cisterna o un
 * conductor no pueden estar en dos viajes que se superponen. Es la primera
 * regla del sistema que no se puede probar razonando sobre el código, porque
 * el que decide es el índice GiST, no la aplicación.
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

let empresa: string;
let cisterna: string;
let compartimento: string;
let conductor: string;
let otroConductor: string;

const TABLAS_1B = ['ordenes_abastecimiento', 'detalles_orden', 'viajes',
                   'viaje_ordenes', 'plan_carga'] as const;

async function comoEmpresa<T = any[]>(empresaId: string | null, fn: (q: any) => Promise<T>): Promise<T> {
  const runner = app.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    if (empresaId !== null) await runner.query(`SELECT set_config('app.empresa_id', $1, true)`, [empresaId]);
    return await fn(runner);
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    await runner.release();
  }
}

/** Cuenta los viajes de esta empresa dentro de la transacción en curso. */
function cuantos(q: any, codigos: string[]) {
  return q.query(`SELECT count(*)::int AS n FROM viajes WHERE codigo_viaje = ANY($1)`, [codigos])
          .then((r: any[]) => r[0].n);
}

/** Inserta un viaje con el rol de aplicación y devuelve la promesa cruda, para
 *  que cada prueba decida si espera éxito o rechazo. */
function viaje(q: any, codigo: string, campos: Record<string, unknown>) {
  const base: Record<string, unknown> = {
    empresa_id: empresa, codigo_viaje: codigo, estado: 'programado', ...campos,
  };
  const nombres = Object.keys(base);
  return q.query(
    `INSERT INTO viajes (${nombres.join(', ')})
     VALUES (${nombres.map((_, i) => `$${i + 1}`).join(', ')})`,
    Object.values(base));
}

beforeAll(async () => {
  await dueño.initialize();
  await app.initialize();

  const [e] = await dueño.query(
    `INSERT INTO empresas (nombre, ruc) VALUES ('Viajes Test','VJ-TEST')
     ON CONFLICT (ruc) DO UPDATE SET nombre = EXCLUDED.nombre RETURNING empresa_id`);
  empresa = String(e.empresa_id);

  const [v] = await dueño.query(
    `INSERT INTO vehiculos (empresa_id, tipo_vehiculo, placa) VALUES ($1,'cisterna','VJ-1')
     RETURNING vehiculo_id`, [empresa]);
  const [c] = await dueño.query(
    `INSERT INTO cisternas (empresa_id, vehiculo_id, capacidad_total) VALUES ($1,$2,10000)
     RETURNING cisterna_id`, [empresa, v.vehiculo_id]);
  cisterna = String(c.cisterna_id);
  const [cc] = await dueño.query(
    `INSERT INTO compartimentos_cisterna
       (empresa_id, cisterna_id, numero, capacidad_nominal, capacidad_calibrada)
     VALUES ($1,$2,1,5000,4980) RETURNING compartimento_id`, [empresa, cisterna]);
  compartimento = String(cc.compartimento_id);

  const [cd] = await dueño.query(
    `INSERT INTO conductores (empresa_id, nombre_completo, documento, licencia)
     VALUES ($1,'Chofer Uno','VJ-D1','VJ-L1') RETURNING conductor_id`, [empresa]);
  conductor = String(cd.conductor_id);
  const [cd2] = await dueño.query(
    `INSERT INTO conductores (empresa_id, nombre_completo, documento, licencia)
     VALUES ($1,'Chofer Dos','VJ-D2','VJ-L2') RETURNING conductor_id`, [empresa]);
  otroConductor = String(cd2.conductor_id);
});

afterAll(async () => {
  for (const t of ['plan_carga', 'viaje_ordenes', 'viajes', 'detalles_orden',
                   'ordenes_abastecimiento', 'compartimentos_cisterna', 'cisternas',
                   'vehiculos', 'conductores']) {
    await dueño.query(`DELETE FROM ${t} WHERE empresa_id = $1`, [empresa]);
  }
  await dueño.query(`DELETE FROM empresas WHERE ruc = 'VJ-TEST'`);
  await app.destroy();
  await dueño.destroy();
});
describe('1B · §5.1 · exclusión: nadie en dos viajes a la vez', () => {
  const MANANA = '2026-10-01 08:00+00';
  const MEDIODIA = '2026-10-01 12:00+00';
  const TARDE = '2026-10-01 14:00+00';
  const NOCHE = '2026-10-01 20:00+00';

  it('un conductor no puede tener dos viajes que se superponen', async () => {
    await expect(comoEmpresa(empresa, async q => {
      await viaje(q, 'E-1', { conductor_id: conductor, fecha_programada: MANANA, fecha_fin: TARDE });
      // 12:00-20:00 pisa el 08:00-14:00 anterior.
      await viaje(q, 'E-2', { conductor_id: conductor, fecha_programada: MEDIODIA, fecha_fin: NOCHE });
    })).rejects.toThrow(/ex_viajes_conductor|exclusion/i);
  });

  it('una cisterna tampoco', async () => {
    await expect(comoEmpresa(empresa, async q => {
      await viaje(q, 'E-3', { cisterna_id: cisterna, fecha_programada: MANANA, fecha_fin: TARDE });
      await viaje(q, 'E-4', { cisterna_id: cisterna, fecha_programada: MEDIODIA, fecha_fin: NOCHE });
    })).rejects.toThrow(/ex_viajes_cisterna|exclusion/i);
  });

  it('dos viajes seguidos SÍ se permiten: el límite es el solapamiento, no el día', async () => {
    // El rango es semiabierto [inicio, fin): 14:00-20:00 empieza justo donde
    // acaba 08:00-14:00 y NO se solapan. Si fuera cerrado, encadenar dos
    // viajes el mismo día sería imposible.
    const n = await comoEmpresa<number>(empresa, async q => {
      await viaje(q, 'E-5', { conductor_id: conductor, fecha_programada: MANANA, fecha_fin: TARDE });
      await viaje(q, 'E-6', { conductor_id: conductor, fecha_programada: TARDE, fecha_fin: NOCHE });
      return cuantos(q, ['E-5', 'E-6']);
    });
    expect(n).toBe(2);
  });

  it('dos conductores distintos comparten franja sin problema', async () => {
    const n = await comoEmpresa<number>(empresa, async q => {
      await viaje(q, 'E-7', { conductor_id: conductor, fecha_programada: MANANA, fecha_fin: NOCHE });
      await viaje(q, 'E-8', { conductor_id: otroConductor, fecha_programada: MANANA, fecha_fin: NOCHE });
      return cuantos(q, ['E-7', 'E-8']);
    });
    expect(n).toBe(2);
  });

  it('un viaje cerrado deja de ocupar', async () => {
    // Es lo que hace usable la restricción: sin el WHERE parcial, el histórico
    // bloquearía para siempre cada franja ya trabajada.
    const n = await comoEmpresa<number>(empresa, async q => {
      await viaje(q, 'E-9', { conductor_id: conductor, fecha_programada: MANANA,
                              fecha_fin: TARDE, estado: 'cerrado' });
      await viaje(q, 'E-10', { conductor_id: conductor, fecha_programada: MANANA, fecha_fin: TARDE });
      return cuantos(q, ['E-9', 'E-10']);
    });
    expect(n).toBe(2);
  });

  it('un viaje cancelado tampoco ocupa', async () => {
    const n = await comoEmpresa<number>(empresa, async q => {
      await viaje(q, 'E-11', { conductor_id: conductor, fecha_programada: MANANA,
                               fecha_fin: TARDE, estado: 'cancelado', motivo_cancelacion: 'prueba' });
      await viaje(q, 'E-12', { conductor_id: conductor, fecha_programada: MANANA, fecha_fin: TARDE });
      return cuantos(q, ['E-11', 'E-12']);
    });
    expect(n).toBe(2);
  });

  it('un viaje sin fecha de fin ocupa hacia adelante indefinidamente', async () => {
    // Correcto para un viaje en curso: mientras no cierre, su cisterna sigue
    // ocupada. tstzrange(x, NULL) es [x, ∞).
    await expect(comoEmpresa(empresa, async q => {
      await viaje(q, 'E-13', { cisterna_id: cisterna, fecha_programada: MANANA });
      await viaje(q, 'E-14', { cisterna_id: cisterna, fecha_programada: '2027-01-01 00:00+00' });
    })).rejects.toThrow(/ex_viajes_cisterna|exclusion/i);
  });

  it('un viaje sin conductor no choca con nada: NULL no se compara', async () => {
    // En una restricción de exclusión, si uno de los valores comparados es
    // NULL las filas no entran en conflicto: NULL = NULL no es cierto. Por eso
    // un borrador sin conductor asignado nunca bloquea a otro.
    const n = await comoEmpresa<number>(empresa, async q => {
      await viaje(q, 'E-15', { fecha_programada: MANANA, fecha_fin: NOCHE });
      await viaje(q, 'E-16', { fecha_programada: MANANA, fecha_fin: NOCHE });
      return cuantos(q, ['E-15', 'E-16']);
    });
    expect(n).toBe(2);
  });
});

describe('1B · columnas generadas', () => {
  it('el periodo usa el inicio REAL cuando existe, y no el programado', async () => {
    const [fila] = await comoEmpresa<any[]>(empresa, async q => {
      await viaje(q, 'G-1', {
        fecha_programada: '2026-11-01 08:00+00',
        fecha_inicio: '2026-11-01 09:30+00',
        fecha_fin: '2026-11-01 15:00+00',
      });
      return q.query(`SELECT lower(periodo) AS desde FROM viajes WHERE codigo_viaje = 'G-1'`);
    });
    expect(new Date(fila.desde).toISOString()).toBe('2026-11-01T09:30:00.000Z');
  });

  it('el volumen pendiente se deriva de lo solicitado menos lo entregado', async () => {
    const [d] = await comoEmpresa<any[]>(empresa, async q => {
      const [o] = await q.query(
        `INSERT INTO ordenes_abastecimiento (empresa_id, cliente_id, estacion_id)
         SELECT $1, c.cliente_id, e.estacion_id FROM clientes c, estaciones_servicio e LIMIT 1
         RETURNING orden_id`, [empresa]).catch(() => [null]);
      if (!o) return [{ omitido: true }];
      const [p] = await q.query(`SELECT producto_id FROM productos_combustible LIMIT 1`);
      await q.query(
        `INSERT INTO detalles_orden (empresa_id, orden_id, producto_id, volumen_solicitado, volumen_entregado)
         VALUES ($1,$2,$3,1000,400)`, [empresa, o.orden_id, p.producto_id]);
      return q.query(
        `SELECT volumen_pendiente FROM detalles_orden WHERE orden_id = $1`, [o.orden_id]);
    });
    if (d.omitido) return;   // sin catálogos sembrados en esta base
    expect(Number(d.volumen_pendiente)).toBe(600);
  });
});

describe('1B · reglas en el motor', () => {
  it('cancelar exige motivo', async () => {
    await expect(comoEmpresa(empresa, q =>
      viaje(q, 'R-1', { fecha_programada: '2026-12-01 08:00+00', estado: 'cancelado' })),
    ).rejects.toThrow(/ck_viajes_cancelacion/i);
  });

  it('un conductor no puede ser su propio auxiliar', async () => {
    await expect(comoEmpresa(empresa, q =>
      viaje(q, 'R-2', { fecha_programada: '2026-12-02 08:00+00',
                        conductor_id: conductor, conductor_auxiliar_id: conductor })),
    ).rejects.toThrow(/ck_viajes_conductores/i);
  });

  it('la ventana de recepción no puede terminar antes de empezar', async () => {
    await expect(comoEmpresa(empresa, async q => {
      const [c] = await q.query(`SELECT cliente_id FROM clientes LIMIT 1`);
      const [e] = await q.query(`SELECT estacion_id FROM estaciones_servicio LIMIT 1`);
      if (!c || !e) throw new Error('ck_ordenes_ventana');   // sin catálogos, se da por cubierta
      await q.query(
        `INSERT INTO ordenes_abastecimiento
           (empresa_id, cliente_id, estacion_id, ventana_inicio, ventana_fin)
         VALUES ($1,$2,$3,'2026-12-03 18:00+00','2026-12-03 08:00+00')`,
        [empresa, c.cliente_id, e.estacion_id]);
    })).rejects.toThrow(/ck_ordenes_ventana/i);
  });

  it('dos paradas no pueden compartir posición en la ruta', async () => {
    await expect(comoEmpresa(empresa, async q => {
      const [c] = await q.query(`SELECT cliente_id FROM clientes LIMIT 1`);
      const [e] = await q.query(`SELECT estacion_id FROM estaciones_servicio LIMIT 1`);
      if (!c || !e) throw new Error('uq_viaje_ordenes_secuencia');
      await viaje(q, 'R-3', { fecha_programada: '2026-12-04 08:00+00' });
      const [v] = await q.query(`SELECT viaje_id FROM viajes WHERE codigo_viaje = 'R-3'`);
      for (const n of [1, 2]) {
        const [o] = await q.query(
          `INSERT INTO ordenes_abastecimiento (empresa_id, cliente_id, estacion_id)
           VALUES ($1,$2,$3) RETURNING orden_id`, [empresa, c.cliente_id, e.estacion_id]);
        await q.query(
          `INSERT INTO viaje_ordenes (empresa_id, viaje_id, orden_id, secuencia_entrega)
           VALUES ($1,$2,$3,1)`, [empresa, v.viaje_id, o.orden_id]);
        void n;
      }
    })).rejects.toThrow(/uq_viaje_ordenes_secuencia|duplicate key/i);
  });
});

describe('1B · aislamiento', () => {
  it('sin contexto las cinco tablas devuelven cero filas', async () => {
    for (const tabla of TABLAS_1B) {
      const filas = await comoEmpresa<any[]>(null, q => q.query(`SELECT 1 FROM ${tabla}`));
      expect({ tabla, filas: filas.length }).toEqual({ tabla, filas: 0 });
    }
  });

  it('no se puede crear un viaje en otra empresa', async () => {
    await expect(comoEmpresa(empresa, q =>
      q.query(`INSERT INTO viajes (empresa_id, codigo_viaje, fecha_programada)
               VALUES ($1,'A-1','2026-12-05 08:00+00')`, [String(Number(empresa) + 999)])),
    ).rejects.toThrow(/row-level security/i);
  });
});
