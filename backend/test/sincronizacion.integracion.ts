import 'reflect-metadata';
import { config as cargarEnv } from 'dotenv';
import { DataSource } from 'typeorm';
import { join } from 'path';
import { randomUUID } from 'node:crypto';

import { SincronizacionService } from '../src/modules/sincronizacion/sincronizacion.service';
import { EventosService } from '../src/modules/eventos/eventos.service';
import { ejecutarEnContexto, gestor } from '../src/common/contexto/contexto-peticion';

cargarEnv({ path: join(__dirname, '../../.env') });

/**
 * Fase 2A · El drenaje de la cola de salida del móvil.
 *
 * Lo que se prueba no es «el lote entra»: es que entre BIEN cuando el lote
 * viene mal. Un reintento que repite lo ya enviado, un elemento inválido en
 * medio, y el orden de la cadena de hashes cuando uno se cae.
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

const eventos = new EventosService();
const servicio = new SincronizacionService(eventos);
let empresa: string, usuario: string, conductorId: string;
let secuencia = 0;

async function enContexto<T>(fn: (s: SincronizacionService) => Promise<T>) {
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

async function viaje(estado = 'transito_estacion'): Promise<string> {
  const marca = `${secuencia++}-${Math.random().toString(36).slice(2, 6)}`;
  const [veh] = await gestor().query(
    `INSERT INTO vehiculos (empresa_id, tipo_vehiculo, placa) VALUES ($1,'cisterna',$2)
     RETURNING vehiculo_id`, [empresa, `SYN-${marca}`]);
  const [c] = await gestor().query(
    `INSERT INTO cisternas (empresa_id, vehiculo_id, capacidad_total) VALUES ($1,$2,10000)
     RETURNING cisterna_id`, [empresa, veh.vehiculo_id]);
  const [v] = await gestor().query(
    `INSERT INTO viajes (empresa_id, codigo_viaje, tipo_viaje, cisterna_id, conductor_id,
                         fecha_programada, estado)
     VALUES ($1,$2,'simple',$3,$4,$5,$6) RETURNING viaje_id`,
    [empresa, `SYN-${marca}`, c.cisterna_id, conductorId,
     new Date(Date.UTC(2037, 0, 1 + secuencia, 8)).toISOString(), estado]);
  return String(v.viaje_id);
}

/** Un elemento de la cola, como lo mandaría el móvil. */
const enCola = (viajeId: string, extra: Record<string, unknown> = {}) => ({
  idCliente: randomUUID(), viajeId,
  tipoEvento: 'parada', origenDato: 'movil',
  latitud: 8.9824, longitud: -79.5199, ...extra,
});

beforeAll(async () => {
  await dueño.initialize();
  await app.initialize();
  const [e] = await dueño.query(
    `INSERT INTO empresas (nombre, ruc) VALUES ('Sincronizacion Test','SYN-TEST')
     ON CONFLICT (ruc) DO UPDATE SET nombre = EXCLUDED.nombre RETURNING empresa_id`);
  empresa = String(e.empresa_id);
  const [u] = await dueño.query(
    `INSERT INTO usuarios (empresa_id, nombre, correo, hash_clave)
     VALUES ($1,'Conductor','syn@ejemplo.test','x') RETURNING usuario_id`, [empresa]);
  usuario = String(u.usuario_id);
  const [cd] = await dueño.query(
    `INSERT INTO conductores (empresa_id, nombre_completo, documento, licencia)
     VALUES ($1,'Chofer Syn','SYN-D1','SYN-L1') RETURNING conductor_id`, [empresa]);
  conductorId = String(cd.conductor_id);
});

afterAll(async () => {
  for (const t of ['eventos_viaje', 'viajes', 'cisternas', 'vehiculos', 'conductores',
                   'auditoria', 'usuarios']) {
    await dueño.query(`DELETE FROM ${t} WHERE empresa_id = $1`, [empresa]);
  }
  await dueño.query(`DELETE FROM empresas WHERE ruc = 'SYN-TEST'`);
  await app.destroy();
  await dueño.destroy();
});

describe('drenar · la jornada normal', () => {
  it('un lote entero entra y queda encadenado en orden', async () => {
    await enContexto(async (s) => {
      const v = await viaje();
      const cola = [
        enCola(v, { tipoEvento: 'salida', observacion: 'uno' }),
        enCola(v, { tipoEvento: 'parada', observacion: 'dos' }),
        enCola(v, { tipoEvento: 'llegada', observacion: 'tres' }),
      ];
      const r = await s.drenarEventos({ eventos: cola });
      expect(r).toMatchObject({ recibidos: 3, creados: 3, duplicados: 0, rechazados: 0 });

      const traza = await eventos.listarDeViaje(v);
      expect(traza.map((e: { observacion: string }) => e.observacion))
        .toEqual(['uno', 'dos', 'tres']);
      expect((await eventos.verificarIntegridad(v)).integra).toBe(true);
    });
  });

  it('guarda el id del dispositivo en cada evento', async () => {
    await enContexto(async (s) => {
      const v = await viaje();
      const uno = enCola(v);
      await s.drenarEventos({ eventos: [uno] });
      const [e] = await eventos.listarDeViaje(v);
      expect(e.idCliente).toBe(uno.idCliente);
    });
  });
});

describe('drenar · el reintento, que es el caso que justifica todo esto', () => {
  it('reenviar lo mismo NO duplica: se marca duplicado y se devuelve el id', async () => {
    // La respuesta se perdió por el camino y la app no supo si aterrizó.
    await enContexto(async (s) => {
      const v = await viaje();
      const cola = [enCola(v, { observacion: 'uno' }), enCola(v, { observacion: 'dos' })];

      const primera = await s.drenarEventos({ eventos: cola });
      const segunda = await s.drenarEventos({ eventos: cola });

      expect(segunda).toMatchObject({ recibidos: 2, creados: 0, duplicados: 2, rechazados: 0 });
      expect(segunda.resultados.map((r) => r.eventoId))
        .toEqual(primera.resultados.map((r) => r.eventoId));
      expect(await eventos.listarDeViaje(v)).toHaveLength(2);
    });
  });

  it('el reintento REAL: lo no confirmado más lo nuevo, en el mismo lote', async () => {
    // Una cola no reenvía la misma petición: trae lo que no confirmó MÁS lo que
    // se acumuló mientras tanto. Es un lote distinto que repite parte del
    // anterior, y por eso la idempotencia tiene que ser por elemento y no por
    // petición.
    await enContexto(async (s) => {
      const v = await viaje();
      const viejos = [enCola(v, { observacion: 'uno' }), enCola(v, { observacion: 'dos' })];
      await s.drenarEventos({ eventos: viejos });

      const nuevos = [enCola(v, { observacion: 'tres' }), enCola(v, { observacion: 'cuatro' })];
      const r = await s.drenarEventos({ eventos: [...viejos, ...nuevos] });

      expect(r).toMatchObject({ recibidos: 4, creados: 2, duplicados: 2, rechazados: 0 });
      expect(await eventos.listarDeViaje(v)).toHaveLength(4);
      expect((await eventos.verificarIntegridad(v)).integra).toBe(true);
    });
  });
});

describe('drenar · éxito parcial, que es lo que impide que la cola se atasque', () => {
  it('un elemento inválido NO se lleva por delante a los demás', async () => {
    // Sin savepoints, la sentencia fallida abortaría la transacción entera y
    // los que ya habían entrado se perderían. Y rechazar el lote completo
    // dejaría la cola atascada para siempre: reintentaría, volvería a fallar
    // por lo mismo, y lo bueno de detrás no entraría nunca.
    await enContexto(async (s) => {
      const v = await viaje();
      const r = await s.drenarEventos({ eventos: [
        enCola(v, { observacion: 'antes' }),
        enCola('999999999', { observacion: 'viaje que no existe' }),
        enCola(v, { observacion: 'despues' }),
      ] });

      expect(r).toMatchObject({ recibidos: 3, creados: 2, rechazados: 1 });
      expect(r.resultados[1].estado).toBe('rechazado');
      expect(r.resultados[1].error).toMatch(/no encontrado/i);

      const traza = await eventos.listarDeViaje(v);
      expect(traza.map((e: { observacion: string }) => e.observacion))
        .toEqual(['antes', 'despues']);
    });
  });

  it('la cadena de hashes sigue íntegra pese al rechazado del medio', async () => {
    // Los siguientes se encadenan al último que SÍ entró, que es lo que el
    // viaje realmente tiene.
    await enContexto(async (s) => {
      const v = await viaje();
      await s.drenarEventos({ eventos: [
        enCola(v, { observacion: 'a' }),
        enCola(v, { latitud: 8.98, longitud: undefined, observacion: 'media coordenada' }),
        enCola(v, { observacion: 'b' }),
      ] });
      expect((await eventos.verificarIntegridad(v)).integra).toBe(true);
      expect(await eventos.listarDeViaje(v)).toHaveLength(2);
    });
  });

  it('el error viaja al dispositivo, para que pueda decidir', async () => {
    // Sin el motivo, la app sólo puede reintentar para siempre algo que nunca
    // va a entrar.
    await enContexto(async (s) => {
      const v = await viaje();
      const r = await s.drenarEventos({ eventos: [
        enCola(v, { tipoEvento: 'salida', latitud: 8.98, longitud: undefined }),
      ] });
      expect(r.resultados[0].estado).toBe('rechazado');
      expect(r.resultados[0].error).toMatch(/pareja/);
      expect(r.resultados[0].idCliente).toBeDefined();
    });
  });

  it('un lote entero de inválidos no revienta ni deja la transacción rota', async () => {
    await enContexto(async (s) => {
      const r = await s.drenarEventos({ eventos: [
        enCola('999999999'), enCola('999999998'), enCola('999999997'),
      ] });
      expect(r).toMatchObject({ recibidos: 3, creados: 0, rechazados: 3 });
      // Y la transacción sigue viva: se puede seguir consultando.
      const v = await viaje();
      expect(await eventos.listarDeViaje(v)).toEqual([]);
    });
  });
});

describe('drenar · el orden importa', () => {
  it('se aplican en el orden en que la app los encoló, no por fecha', async () => {
    // La cadena de hashes es una secuencia. Reordenar por `fechaHora` sería
    // tentador y estaría mal: dos eventos del mismo segundo, o un reloj de
    // móvil desajustado, cambiarían el orden de la traza respecto a lo que el
    // conductor vivió.
    await enContexto(async (s) => {
      const v = await viaje();
      await s.drenarEventos({ eventos: [
        enCola(v, { observacion: 'primero', fechaHora: '2037-06-01T12:00:00.000Z' }),
        enCola(v, { observacion: 'segundo', fechaHora: '2037-06-01T08:00:00.000Z' }),
      ] });
      const traza = await eventos.listarDeViaje(v);
      expect(traza.map((e: { observacion: string }) => e.observacion))
        .toEqual(['primero', 'segundo']);
    });
  });
});
