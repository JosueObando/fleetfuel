import 'reflect-metadata';
import { config as cargarEnv } from 'dotenv';
import { DataSource } from 'typeorm';
import { join } from 'path';

import { GpsService } from '../src/modules/gps/gps.service';
import { ejecutarEnContexto, gestor } from '../src/common/contexto/contexto-peticion';

cargarEnv({ path: join(__dirname, '../../.env') });

/**
 * Fase 2B · Telemetría.
 *
 * Lo que se prueba con números conocidos son las dos cosas que un informe puede
 * dar mal sin fallar: la DISTANCIA recorrida y la marca de telemetría OBSOLETA.
 * Ambas se calculan en la base a propósito, y aquí se comprueba contra valores
 * reales del mapa.
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

const servicio = new GpsService();
let empresa: string, usuario: string;
let secuencia = 0;

async function enContexto<T>(fn: (s: GpsService) => Promise<T>) {
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

async function viaje(estado = 'transito_estacion', odometros?: [number, number]) {
  const marca = `${secuencia++}-${Math.random().toString(36).slice(2, 6)}`;
  const [veh] = await gestor().query(
    `INSERT INTO vehiculos (empresa_id, tipo_vehiculo, placa) VALUES ($1,'cisterna',$2)
     RETURNING vehiculo_id`, [empresa, `GPS-${marca}`]);
  const [c] = await gestor().query(
    `INSERT INTO cisternas (empresa_id, vehiculo_id, capacidad_total) VALUES ($1,$2,10000)
     RETURNING cisterna_id`, [empresa, veh.vehiculo_id]);
  // Conductor propio: la exclusión del §5.1 impide que dos viajes abiertos
  // compartan conductor, y un panel de flota necesita varios a la vez — que es
  // además lo que pasa de verdad.
  const [cd] = await gestor().query(
    `INSERT INTO conductores (empresa_id, nombre_completo, documento, licencia)
     VALUES ($1,$2,$3,$4) RETURNING conductor_id`,
    [empresa, `Chofer ${marca}`, `GD-${marca}`, `GL-${marca}`]);
  const [v] = await gestor().query(
    `INSERT INTO viajes (empresa_id, codigo_viaje, tipo_viaje, cisterna_id, conductor_id,
                         fecha_programada, estado, odometro_inicial, odometro_final)
     VALUES ($1,$2,'simple',$3,$4,$5,$6,$7,$8) RETURNING viaje_id`,
    [empresa, `GPS-${marca}`, c.cisterna_id, cd.conductor_id,
     new Date(Date.UTC(2038, 0, 1 + secuencia, 8)).toISOString(), estado,
     odometros?.[0] ?? null, odometros?.[1] ?? null]);
  return { viaje: String(v.viaje_id), vehiculo: String(veh.vehiculo_id) };
}

/** Dos puntos de la ciudad de Panamá separados por una distancia conocida. */
const CINTA_COSTERA = { latitud: 8.9750, longitud: -79.5300 };
const CASCO_VIEJO = { latitud: 8.9520, longitud: -79.5350 };

const hace = (segundos: number) => new Date(Date.now() - segundos * 1000).toISOString();

beforeAll(async () => {
  await dueño.initialize();
  await app.initialize();
  const [e] = await dueño.query(
    `INSERT INTO empresas (nombre, ruc) VALUES ('GPS Test','GPS-TEST')
     ON CONFLICT (ruc) DO UPDATE SET nombre = EXCLUDED.nombre RETURNING empresa_id`);
  empresa = String(e.empresa_id);
  const [u] = await dueño.query(
    `INSERT INTO usuarios (empresa_id, nombre, correo, hash_clave)
     VALUES ($1,'Operador','gps@ejemplo.test','x') RETURNING usuario_id`, [empresa]);
  usuario = String(u.usuario_id);
});

afterAll(async () => {
  await dueño.query(`DELETE FROM posiciones_gps WHERE empresa_id = $1`, [empresa]);
  for (const t of ['viajes', 'cisternas', 'vehiculos', 'conductores', 'auditoria', 'usuarios']) {
    await dueño.query(`DELETE FROM ${t} WHERE empresa_id = $1`, [empresa]);
  }
  await dueño.query(`DELETE FROM empresas WHERE ruc = 'GPS-TEST'`);
  await app.destroy();
  await dueño.destroy();
});

describe('ingerir · el lote de telemetría', () => {
  it('entra entero y en una sola sentencia', async () => {
    await enContexto(async (s) => {
      const { viaje: v, vehiculo } = await viaje();
      const posiciones = Array.from({ length: 20 }, (_, i) => ({
        fechaHora: hace(100 - i * 5),
        latitud: 8.98 + i * 0.001, longitud: -79.53, velocidad: 40 + i,
      }));
      const r = await s.ingerir({ vehiculoId: vehiculo, viajeId: v, posiciones });
      expect(r.ingeridas).toBe(20);
      expect(await s.recorridoDe(v)).toHaveLength(20);
    });
  });

  it('un vehículo o un viaje que no existen dan 404', async () => {
    await enContexto(async (s) => {
      const { vehiculo } = await viaje();
      const p = [{ fechaHora: hace(10), latitud: 8.98, longitud: -79.53 }];
      await expect(s.ingerir({ vehiculoId: '999999999', posiciones: p }))
        .rejects.toThrow(/Vehiculo no encontrado/);
      await expect(s.ingerir({ vehiculoId: vehiculo, viajeId: '999999999', posiciones: p }))
        .rejects.toThrow(/Viaje no encontrado/);
    });
  });

  it('crea sola la partición del mes que haga falta', async () => {
    // La alternativa era una tarea programada, y esa falla en silencio: nadie
    // se entera hasta que la ingesta rechaza posiciones el día 1 a las 00:00.
    await enContexto(async (s) => {
      const { viaje: v, vehiculo } = await viaje();
      const dentroDeUnAno = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
      const r = await s.ingerir({ vehiculoId: vehiculo, viajeId: v, posiciones: [
        { fechaHora: dentroDeUnAno, latitud: 8.98, longitud: -79.53 },
      ] });
      expect(r.ingeridas).toBe(1);

      const esperada = `posiciones_gps_${dentroDeUnAno.slice(0, 7).replace('-', '_')}`;
      const [existe] = await gestor().query(
        `SELECT to_regclass($1) IS NOT NULL AS hay`, [esperada]);
      expect(existe.hay).toBe(true);
    });
  });

  it('una posición no se puede reescribir: es la medida de un instante', async () => {
    await enContexto(async (s) => {
      const { viaje: v, vehiculo } = await viaje();
      await s.ingerir({ vehiculoId: vehiculo, viajeId: v, posiciones: [
        { fechaHora: hace(10), latitud: 8.98, longitud: -79.53 },
      ] });
      await expect(gestor().query(
        `UPDATE posiciones_gps SET velocidad = 999 WHERE viaje_id = $1`, [v]))
        .rejects.toThrow(/permission denied/i);
    });
  });
});

describe('la marca de telemetría OBSOLETA', () => {
  it('una posición reciente NO está obsoleta', async () => {
    await enContexto(async (s) => {
      const { viaje: v, vehiculo } = await viaje();
      await s.ingerir({ vehiculoId: vehiculo, viajeId: v, posiciones: [
        { fechaHora: hace(5), latitud: 8.98, longitud: -79.53, velocidad: 60 },
      ] });
      const u = await s.ultimaDe(v);
      expect(u.stale).toBe(false);
      expect(Number(u.antiguedadSegundos)).toBeLessThan(20);
      expect(Number(u.velocidad)).toBe(60);
    });
  });

  it('pasados 90 segundos SÍ lo está', async () => {
    await enContexto(async (s) => {
      const { viaje: v, vehiculo } = await viaje();
      await s.ingerir({ vehiculoId: vehiculo, viajeId: v, posiciones: [
        { fechaHora: hace(200), latitud: 8.98, longitud: -79.53 },
      ] });
      expect((await s.ultimaDe(v)).stale).toBe(true);
    });
  });

  it('sin ninguna posición también dice obsoleta, no null', async () => {
    // Es la peor noticia y hay que darla: si devolviera null, el panel tendría
    // que distinguir dos formas de «no hay señal» y una de las dos se olvidaría.
    await enContexto(async (s) => {
      const { viaje: v } = await viaje();
      const u = await s.ultimaDe(v);
      expect(u.stale).toBe(true);
      expect(u.fechaHora).toBeNull();
    });
  });

  it('devuelve la ÚLTIMA, no la primera', async () => {
    await enContexto(async (s) => {
      const { viaje: v, vehiculo } = await viaje();
      await s.ingerir({ vehiculoId: vehiculo, viajeId: v, posiciones: [
        { fechaHora: hace(60), latitud: 8.90, longitud: -79.50, velocidad: 10 },
        { fechaHora: hace(5), latitud: 8.98, longitud: -79.53, velocidad: 80 },
      ] });
      expect(Number((await s.ultimaDe(v)).velocidad)).toBe(80);
    });
  });
});

describe('§10.1 · kilómetros GPS', () => {
  it('suma las distancias entre posiciones consecutivas', async () => {
    // Dos puntos de la ciudad de Panamá a ~2,57 km en línea recta. Se comprueba
    // contra el mapa real y no contra lo que devuelva el código.
    await enContexto(async (s) => {
      const { viaje: v, vehiculo } = await viaje();
      await s.ingerir({ vehiculoId: vehiculo, viajeId: v, posiciones: [
        { fechaHora: hace(120), ...CINTA_COSTERA },
        { fechaHora: hace(60), ...CASCO_VIEJO },
      ] });
      const r = await s.kilometrosDe(v);
      expect(r.kilometrosGps).toBeGreaterThan(2.5);
      expect(r.kilometrosGps).toBeLessThan(2.7);
      expect(r.tramos).toBe(1);
    });
  });

  it('ida y vuelta suma el doble: es recorrido, no desplazamiento', async () => {
    // La distinción que un cálculo mal hecho pierde: quien va y vuelve recorrió
    // el doble aunque acabe donde empezó.
    await enContexto(async (s) => {
      const { viaje: v, vehiculo } = await viaje();
      await s.ingerir({ vehiculoId: vehiculo, viajeId: v, posiciones: [
        { fechaHora: hace(180), ...CINTA_COSTERA },
        { fechaHora: hace(120), ...CASCO_VIEJO },
        { fechaHora: hace(60), ...CINTA_COSTERA },
      ] });
      const r = await s.kilometrosDe(v);
      expect(r.kilometrosGps).toBeGreaterThan(5.0);
      expect(r.kilometrosGps).toBeLessThan(5.4);
      expect(r.tramos).toBe(2);
    });
  });

  it('compara contra el odómetro y da la diferencia', async () => {
    await enContexto(async (s) => {
      const { viaje: v, vehiculo } = await viaje('cerrado', [100000, 100010]);
      await s.ingerir({ vehiculoId: vehiculo, viajeId: v, posiciones: [
        { fechaHora: hace(120), ...CINTA_COSTERA },
        { fechaHora: hace(60), ...CASCO_VIEJO },
      ] });
      const r = await s.kilometrosDe(v);
      expect(r.kilometrosOdometro).toBe(10);
      // 10 del odómetro contra ~2,57 del GPS: la diferencia es la señal.
      expect(r.diferencia).toBeGreaterThan(7.3);
      expect(r.diferencia).toBeLessThan(7.5);
    });
  });

  it('sin posiciones da cero, y sin odómetro da null en la diferencia', async () => {
    await enContexto(async (s) => {
      const { viaje: v } = await viaje();
      const r = await s.kilometrosDe(v);
      expect(r.kilometrosGps).toBe(0);
      expect(r.kilometrosOdometro).toBeNull();
      expect(r.diferencia).toBeNull();
    });
  });

  it('un viaje que no existe da 404', async () => {
    await enContexto(async (s) => {
      await expect(s.kilometrosDe('999999999')).rejects.toThrow(/no encontrado/i);
    });
  });
});

describe('la flota en ruta, que es lo que abre el panel', () => {
  it('trae un viaje por fila con su última posición', async () => {
    await enContexto(async (s) => {
      const a = await viaje('transito_estacion');
      const b = await viaje('cargando');
      await s.ingerir({ vehiculoId: a.vehiculo, viajeId: a.viaje, posiciones: [
        { fechaHora: hace(200), latitud: 8.90, longitud: -79.50 },
        { fechaHora: hace(5), latitud: 8.98, longitud: -79.53, velocidad: 55 },
      ] });

      const flota = await s.flotaEnRuta();
      const deA = flota.find((f: { viajeId: string }) => String(f.viajeId) === a.viaje);
      const deB = flota.find((f: { viajeId: string }) => String(f.viajeId) === b.viaje);

      expect(Number(deA.velocidad)).toBe(55);
      expect(deA.stale).toBe(false);
      // El que nunca mandó nada sale igualmente, marcado: un camión sin señal
      // es exactamente el que hay que ver en el panel.
      expect(deB.stale).toBe(true);
      expect(deB.latitud).toBeNull();
    });
  });

  it('un viaje cerrado ya no está en ruta', async () => {
    await enContexto(async (s) => {
      const { viaje: v } = await viaje('cerrado');
      const flota = await s.flotaEnRuta();
      expect(flota.map((f: { viajeId: string }) => String(f.viajeId))).not.toContain(v);
    });
  });
});
