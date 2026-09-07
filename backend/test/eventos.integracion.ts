import 'reflect-metadata';
import { config as cargarEnv } from 'dotenv';
import { DataSource } from 'typeorm';
import { join } from 'path';

import { EventosService, calcularHash } from '../src/modules/eventos/eventos.service';
import { ejecutarEnContexto, gestor } from '../src/common/contexto/contexto-peticion';

cargarEnv({ path: join(__dirname, '../../.env') });

/**
 * §7.15 · La base de la trazabilidad.
 *
 * Dos cosas se prueban aquí y ninguna es «el CRUD funciona»: que la traza sea
 * APPEND-ONLY —anular es añadir, no quitar— y que la cadena de hashes SIRVA,
 * o sea que detecte de verdad una manipulación. Un hash que nadie comprueba es
 * un campo decorativo.
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

const servicio = new EventosService();
let empresa: string, usuario: string, conductorId: string;
let secuencia = 0;

async function enContexto<T>(fn: (s: EventosService) => Promise<T>) {
  const runner = app.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await runner.query(`SELECT set_config('app.empresa_id', $1, true)`, [empresa]);
    return await ejecutarEnContexto(
      { empresaId: empresa, usuarioId: usuario, manager: runner.manager, cambios: [] },
      () => fn(servicio),
    );
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    await runner.release();
  }
}

async function viaje(): Promise<string> {
  const marca = `${secuencia++}-${Math.random().toString(36).slice(2, 6)}`;
  const [veh] = await gestor().query(
    `INSERT INTO vehiculos (empresa_id, tipo_vehiculo, placa) VALUES ($1,'cisterna',$2)
     RETURNING vehiculo_id`, [empresa, `EVT-${marca}`]);
  const [c] = await gestor().query(
    `INSERT INTO cisternas (empresa_id, vehiculo_id, capacidad_total) VALUES ($1,$2,10000)
     RETURNING cisterna_id`, [empresa, veh.vehiculo_id]);
  const [v] = await gestor().query(
    `INSERT INTO viajes (empresa_id, codigo_viaje, tipo_viaje, cisterna_id, conductor_id,
                         fecha_programada, estado)
     VALUES ($1,$2,'simple',$3,$4,$5,'transito_estacion') RETURNING viaje_id`,
    [empresa, `EVT-${marca}`, c.cisterna_id, conductorId,
     new Date(Date.UTC(2036, 0, 1 + secuencia, 8)).toISOString()]);
  return String(v.viaje_id);
}

const evento = (extra: Record<string, unknown> = {}) => ({
  tipoEvento: 'salida', origenDato: 'movil',
  latitud: 8.9824, longitud: -79.5199, ...extra,
});

beforeAll(async () => {
  await dueño.initialize();
  await app.initialize();
  const [e] = await dueño.query(
    `INSERT INTO empresas (nombre, ruc) VALUES ('Eventos Test','EVT-TEST')
     ON CONFLICT (ruc) DO UPDATE SET nombre = EXCLUDED.nombre RETURNING empresa_id`);
  empresa = String(e.empresa_id);
  const [u] = await dueño.query(
    `INSERT INTO usuarios (empresa_id, nombre, correo, hash_clave)
     VALUES ($1,'Operador','evt@ejemplo.test','x') RETURNING usuario_id`, [empresa]);
  usuario = String(u.usuario_id);
  const [cd] = await dueño.query(
    `INSERT INTO conductores (empresa_id, nombre_completo, documento, licencia)
     VALUES ($1,'Chofer Evt','EVT-D1','EVT-L1') RETURNING conductor_id`, [empresa]);
  conductorId = String(cd.conductor_id);
});

afterAll(async () => {
  for (const t of ['eventos_viaje', 'viajes', 'cisternas', 'vehiculos', 'conductores',
                   'auditoria', 'usuarios']) {
    await dueño.query(`DELETE FROM ${t} WHERE empresa_id = $1`, [empresa]);
  }
  await dueño.query(`DELETE FROM empresas WHERE ruc = 'EVT-TEST'`);
  await app.destroy();
  await dueño.destroy();
});

describe('registrar · los seis tipos del §7.15', () => {
  it('acepta los seis y los cinco orígenes', async () => {
    await enContexto(async (s) => {
      const v = await viaje();
      for (const tipoEvento of ['salida', 'llegada', 'carga', 'parada', 'entrega', 'incidente']) {
        const e = await s.registrar(v, evento({ tipoEvento }));
        expect(e.tipoEvento).toBe(tipoEvento);
      }
      for (const origenDato of ['gps', 'movil', 'web', 'sensor', 'api']) {
        const e = await s.registrar(v, evento({ origenDato, observacion: origenDato }));
        expect(e.origenDato).toBe(origenDato);
      }
    });
  });

  it('un tipo o un origen inventados se rechazan', async () => {
    await enContexto(async (s) => {
      const v = await viaje();
      await expect(s.registrar(v, evento({ tipoEvento: 'despegue' }) as never)).rejects.toThrow();
      await expect(s.registrar(v, evento({ origenDato: 'paloma' }) as never)).rejects.toThrow();
    });
  });

  it('media coordenada no ubica nada', async () => {
    await enContexto(async (s) => {
      const v = await viaje();
      await expect(s.registrar(v, evento({ longitud: undefined }) as never))
        .rejects.toThrow(/en pareja/);
    });
  });

  it('la hora la puede traer el cliente: 2A registra sin cobertura', async () => {
    // El momento del evento y el de su llegada al servidor son distintos por
    // diseño. Si se pusiera `now()` al insertar, la traza diría cuándo se
    // sincronizó y no cuándo pasó.
    await enContexto(async (s) => {
      const v = await viaje();
      // Una hora PASADA: es el caso real —el móvil lo registró sin cobertura y
      // sincronizó más tarde—, y es donde se ve que `fecha_hora` y `creado_en`
      // son dos cosas distintas.
      const cuando = '2026-03-01T14:25:00.000Z';
      const e = await s.registrar(v, evento({ fechaHora: cuando }));
      expect(new Date(e.fechaHora).toISOString()).toBe(cuando);
      expect(new Date(e.creadoEn).getTime()).toBeGreaterThan(new Date(cuando).getTime());
    });
  });

  it('un viaje que no existe da 404', async () => {
    await enContexto(async (s) => {
      await expect(s.registrar('999999999', evento() as never)).rejects.toThrow(/no encontrado/i);
    });
  });
});

describe('la cadena de hashes', () => {
  it('el primero es génesis y cada uno apunta al anterior', async () => {
    await enContexto(async (s) => {
      const v = await viaje();
      const a = await s.registrar(v, evento({ observacion: 'primero' }));
      const b = await s.registrar(v, evento({ tipoEvento: 'parada', observacion: 'segundo' }));
      expect(a.hashAnterior).toBeNull();
      expect(b.hashAnterior).toBe(a.hashEvento);
      expect(a.hashEvento).toHaveLength(64);
    });
  });

  it('una traza intacta se verifica', async () => {
    await enContexto(async (s) => {
      const v = await viaje();
      for (const o of ['uno', 'dos', 'tres']) {
        await s.registrar(v, evento({ observacion: o }));
      }
      expect(await s.verificarIntegridad(v)).toEqual({ integra: true, eventos: 3, rotoEn: null });
    });
  });

  it('CAZA una observación cambiada a mano, y dice en cuál', async () => {
    // La prueba que hace que el hash valga algo. Se escribe con el rol DUEÑO
    // porque el de aplicación no tiene UPDATE sobre esta tabla — que es
    // precisamente la primera barrera.
    const v = await (async () => {
      const runner = app.createQueryRunner();
      await runner.connect(); await runner.startTransaction();
      await runner.query(`SELECT set_config('app.empresa_id', $1, true)`, [empresa]);
      const id = await ejecutarEnContexto(
        { empresaId: empresa, usuarioId: usuario, manager: runner.manager, cambios: [] },
        async () => {
          const viajeId = await viaje();
          for (const o of ['uno', 'dos', 'tres']) {
            await servicio.registrar(viajeId, evento({ observacion: o }));
          }
          return viajeId;
        });
      await runner.commitTransaction(); await runner.release();
      return id;
    })();

    try {
      const [segundo] = await dueño.query(
        `SELECT evento_id FROM eventos_viaje WHERE viaje_id = $1 ORDER BY evento_id OFFSET 1 LIMIT 1`,
        [v]);
      await dueño.query(
        `UPDATE eventos_viaje SET observacion = 'MANIPULADO' WHERE evento_id = $1`,
        [segundo.evento_id]);

      const r = await enContexto((s) => s.verificarIntegridad(v));
      expect(r.integra).toBe(false);
      expect(r.rotoEn).toBe(String(segundo.evento_id));
    } finally {
      await dueño.query(`DELETE FROM eventos_viaje WHERE viaje_id = $1`, [v]);
      await dueño.query(`DELETE FROM viajes WHERE viaje_id = $1`, [v]);
    }
  });

  it('el rol de aplicación NO puede reescribir un evento', async () => {
    // La primera barrera, antes que el hash: si se pudiera reescribir, la
    // cadena entera se podría recalcular y no probaría nada.
    await enContexto(async (s) => {
      const v = await viaje();
      const e = await s.registrar(v, evento());
      await expect(gestor().query(
        `UPDATE eventos_viaje SET observacion = 'x' WHERE evento_id = $1`, [e.id]))
        .rejects.toThrow(/permission denied/i);
    });
  });

  it('dos eventos no pueden encadenarse del mismo anterior', async () => {
    // Sin esta restricción una carrera bifurcaría la cadena en dos ramas, las
    // dos con hashes válidos, y la verificación no vería nada raro.
    await enContexto(async (s) => {
      const v = await viaje();
      const a = await s.registrar(v, evento());
      const b = await s.registrar(v, evento({ tipoEvento: 'parada' }));
      await expect(gestor().query(
        `INSERT INTO eventos_viaje (empresa_id, viaje_id, tipo_evento, origen_dato,
                                    hash_anterior, hash_evento)
         VALUES ($1,$2,'parada','web',$3,$4)`,
        [empresa, v, b.hashAnterior, 'f'.repeat(64)]))
        .rejects.toThrow(/uq_eventos_encadenado/);
      void a;
    });
  });

  it('tampoco DOS GÉNESIS: la raíz es donde menos se notaría', async () => {
    // Postgres considera por omisión que dos NULL son distintos, así que sin
    // `NULLS NOT DISTINCT` el primer evento quedaba fuera de la protección y
    // dos primeros simultáneos podían coexistir. Esta prueba es la que lo
    // encontró: intentaba bifurcar y lo conseguía.
    await enContexto(async (s) => {
      const v = await viaje();
      await s.registrar(v, evento());
      await expect(gestor().query(
        `INSERT INTO eventos_viaje (empresa_id, viaje_id, tipo_evento, origen_dato,
                                    hash_anterior, hash_evento)
         VALUES ($1,$2,'parada','web',NULL,$3)`,
        [empresa, v, 'e'.repeat(64)]))
        .rejects.toThrow(/uq_eventos_encadenado/);
    });
  });

  it('el hash cambia si cambia cualquier parte', () => {
    const base = {
      viajeId: '1', tipoEvento: 'salida', fechaHora: '2036-01-01T00:00:00.000Z',
      hashAnterior: null,
    };
    const h = calcularHash(base);
    expect(calcularHash({ ...base, tipoEvento: 'llegada' })).not.toBe(h);
    expect(calcularHash({ ...base, observacion: 'algo' })).not.toBe(h);
    expect(calcularHash({ ...base, hashAnterior: 'a'.repeat(64) })).not.toBe(h);
  });

  it('el separador impide que mover texto entre campos dé el mismo hash', () => {
    // Con una coma por separador, («ab», «c») y («a», «bc») producirían la
    // misma cadena. El separador de unidad no puede aparecer dentro del texto.
    const base = { viajeId: '1', tipoEvento: 'salida', fechaHora: 'T', hashAnterior: null };
    expect(calcularHash({ ...base, observacion: 'ab', usuarioId: 'c' }))
      .not.toBe(calcularHash({ ...base, observacion: 'a', usuarioId: 'bc' }));
  });
});

describe('anular · se corrige añadiendo, nunca quitando', () => {
  it('la anulación es un evento nuevo que apunta al anulado', async () => {
    await enContexto(async (s) => {
      const v = await viaje();
      const original = await s.registrar(v, evento({ observacion: 'odómetro mal tecleado' }));
      const correccion = await s.anular(String(original.id),
        { motivo: 'Odómetro capturado con un dígito de más' });

      expect(correccion.tipoEvento).toBe('correccion');
      expect(String(correccion.anulaEventoId)).toBe(String(original.id));
      // Y el original SIGUE ahí: una traza en la que las cosas desaparecen no
      // es una traza.
      expect(await s.listarDeViaje(v)).toHaveLength(2);
      expect(String((await s.obtener(String(original.id))).id)).toBe(String(original.id));
    });
  });

  it('la cadena sigue íntegra después de anular', async () => {
    await enContexto(async (s) => {
      const v = await viaje();
      const e = await s.registrar(v, evento());
      await s.anular(String(e.id), { motivo: 'Duplicado por reintento de la app' });
      expect((await s.verificarIntegridad(v)).integra).toBe(true);
    });
  });

  it('anular exige motivo, y lo repite la base', async () => {
    await enContexto(async (s) => {
      const v = await viaje();
      const e = await s.registrar(v, evento());
      await expect(s.anular(String(e.id), {} as never)).rejects.toThrow(/motivo/i);
      await expect(gestor().query(
        `INSERT INTO eventos_viaje (empresa_id, viaje_id, tipo_evento, origen_dato,
                                    anula_evento_id, hash_evento)
         VALUES ($1,$2,'correccion','web',$3,$4)`,
        [empresa, v, e.id, 'a'.repeat(64)]))
        .rejects.toThrow(/ck_eventos_correccion/);
    });
  });

  it('no se anula dos veces', async () => {
    await enContexto(async (s) => {
      const v = await viaje();
      const e = await s.registrar(v, evento());
      await s.anular(String(e.id), { motivo: 'Primera anulación' });
      await expect(s.anular(String(e.id), { motivo: 'Segunda anulación' }))
        .rejects.toThrow(/ya fue anulado/);
    });
  });

  it('una corrección no se anula: se corrige con otra', async () => {
    await enContexto(async (s) => {
      const v = await viaje();
      const e = await s.registrar(v, evento());
      const c = await s.anular(String(e.id), { motivo: 'Motivo suficiente' });
      await expect(s.anular(String(c.id), { motivo: 'Anular la anulación' }))
        .rejects.toThrow(/se corrige con otra/);
    });
  });

  it('un evento que no existe da 404', async () => {
    await enContexto(async (s) => {
      await expect(s.anular('999999999', { motivo: 'Da igual' }))
        .rejects.toThrow(/no encontrado/i);
    });
  });
});
