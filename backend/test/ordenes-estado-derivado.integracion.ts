import 'reflect-metadata';
import { config as cargarEnv } from 'dotenv';
import { DataSource } from 'typeorm';
import { join } from 'path';

import { ViajesService } from '../src/modules/viajes/viajes.service';
import { OrdenesService } from '../src/modules/ordenes/ordenes.service';
import { FLUJO_VIAJE } from '../src/modules/viajes/estados';
import { sincronizarEstadoDeOrdenes } from '../src/modules/ordenes/estado-derivado';
import { ejecutarEnContexto, gestor, type Contexto } from '../src/common/contexto/contexto-peticion';

cargarEnv({ path: join(__dirname, '../../.env') });

/**
 * El estado de la orden (§8.1) sigue a su viaje (§8.2) y a sus entregas.
 *
 * Hasta el 2026-09-14 no lo seguía: las únicas escrituras del estado de una
 * orden eran manuales, y en desarrollo había diez órdenes «validada» dentro de
 * viajes CERRADOS. Reprogramables, re-asignables a otro viaje y contadas como
 * pendientes en el informe operativo.
 *
 * LA REGLA, SACADA DEL PRD Y NO DEL CÓDIGO
 *
 *   · §9 etapa 2: al crear el viaje con la orden, «la orden pasa a Planificada».
 *   · §9 etapa 7 y regla 20: con la entrega, «Entregada o Entrega parcial».
 *   · Entre medias, el momento del viaje activo MÁS AVANZADO que la lleva (una
 *     orden se puede dividir en varios viajes, §6.2).
 *   · Sin viaje activo —cancelado, o terminado sin entregarla— vuelve a
 *     «Validada»: el producto no llegó y hay que planificarla otra vez.
 *   · Los estados que decide una PERSONA no se tocan nunca: rechazada,
 *     cancelada, suspendida, con incidencia, conciliada, cerrada. Ni «recibida»,
 *     que todavía no se ha validado.
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

const viajes = new ViajesService();
const ordenes = new OrdenesService();
let empresa: string, usuario: string, cliente: string, estacion: string, producto: string, diesel: string;
let ctx: Contexto;

async function enContexto<T>(fn: () => Promise<T>): Promise<T> {
  const runner = app.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await runner.query(`SELECT set_config('app.empresa_id', $1, true)`, [empresa]);
    ctx = { empresaId: empresa, usuarioId: usuario, manager: runner.manager, cambios: [] };
    return await ejecutarEnContexto(ctx, fn);
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    await runner.release();
  }
}

const aleatorio = () => Math.random().toString(36).slice(2, 9);

/** Una orden con una línea de 3000, en el estado que se pida. */
async function orden(estado = 'validada'): Promise<string> {
  const [o] = await gestor().query(
    `INSERT INTO ordenes_abastecimiento (empresa_id, cliente_id, estacion_id, estado)
     VALUES ($1,$2,$3,$4) RETURNING orden_id`, [empresa, cliente, estacion, estado]);
  await gestor().query(
    `INSERT INTO detalles_orden (empresa_id, orden_id, producto_id, volumen_solicitado) VALUES ($1,$2,$3,3000)`,
    [empresa, o.orden_id, producto]);
  return String(o.orden_id);
}

/** Un viaje en el estado dado que lleva esas órdenes. Sin cisterna ni conductor:
 *  aquí no se prueba la exclusión, y así los viajes no chocan entre sí. */
async function viajeCon(estado: string, ...ordenIds: string[]): Promise<string> {
  const [v] = await gestor().query(
    `INSERT INTO viajes (empresa_id, codigo_viaje, fecha_programada, estado, motivo_cancelacion)
     VALUES ($1,$2,'2031-01-01T08:00:00Z',$3,$4) RETURNING viaje_id`,
    [empresa, `DER-${aleatorio()}`, estado, estado === 'cancelado' ? 'prueba' : null]);
  let secuencia = 1;
  for (const o of ordenIds) {
    await gestor().query(
      `INSERT INTO viaje_ordenes (empresa_id, viaje_id, orden_id, secuencia_entrega) VALUES ($1,$2,$3,$4)`,
      [empresa, v.viaje_id, o, secuencia++]);
  }
  return String(v.viaje_id);
}

const entregar = (ordenId: string, volumen: number) => gestor().query(
  `UPDATE detalles_orden SET volumen_entregado = $2 WHERE orden_id = $1`, [ordenId, volumen]);

const estadoDe = async (ordenId: string) =>
  (await gestor().query(`SELECT estado FROM ordenes_abastecimiento WHERE orden_id = $1`, [ordenId]))[0].estado;

beforeAll(async () => {
  await dueño.initialize();
  await app.initialize();
  const [e] = await dueño.query(
    `INSERT INTO empresas (nombre, ruc) VALUES ('Estado Derivado Test','DER-TEST')
     ON CONFLICT (ruc) DO UPDATE SET nombre = EXCLUDED.nombre RETURNING empresa_id`);
  empresa = String(e.empresa_id);
  const [u] = await dueño.query(
    `INSERT INTO usuarios (empresa_id, nombre, correo, hash_clave)
     VALUES ($1,'Planificador','der-test@ejemplo.test','x') RETURNING usuario_id`, [empresa]);
  usuario = String(u.usuario_id);
  const [c] = await dueño.query(
    `INSERT INTO clientes (empresa_id, nombre) VALUES ($1,'Cliente Der') RETURNING cliente_id`, [empresa]);
  cliente = String(c.cliente_id);
  const [s] = await dueño.query(
    `INSERT INTO estaciones_servicio (empresa_id, cliente_id, nombre) VALUES ($1,$2,'Estación Der')
     RETURNING estacion_id`, [empresa, cliente]);
  estacion = String(s.estacion_id);
  const [p] = await dueño.query(
    `INSERT INTO productos_combustible (empresa_id, codigo, nombre) VALUES ($1,'DER-95','Gasolina 95')
     RETURNING producto_id`, [empresa]);
  producto = String(p.producto_id);
  const [d] = await dueño.query(
    `INSERT INTO productos_combustible (empresa_id, codigo, nombre) VALUES ($1,'DER-DSL','Diésel')
     RETURNING producto_id`, [empresa]);
  diesel = String(d.producto_id);
});

afterAll(async () => {
  for (const t of ['viaje_ordenes', 'viajes', 'detalles_orden', 'ordenes_abastecimiento',
                   'estaciones_servicio', 'clientes', 'productos_combustible', 'auditoria', 'usuarios']) {
    await dueño.query(`DELETE FROM ${t} WHERE empresa_id = $1`, [empresa]);
  }
  await dueño.query(`DELETE FROM empresas WHERE ruc = 'DER-TEST'`);
  await app.destroy();
  await dueño.destroy();
});

describe('el momento del viaje decide el estado de la orden', () => {
  /* La tabla ENTERA: cada estado del §8.2. Un estado de viaje nuevo que nadie
     añada aquí hace fallar la prueba de abajo, en vez de dejar órdenes con el
     estado que tuvieran por casualidad. */
  const TABLA: Record<string, string> = {
    borrador: 'planificada', programado: 'planificada',
    autorizado: 'asignada', desplazamiento_terminal: 'asignada', espera_carga: 'asignada',
    cargando: 'en_carga', cargado: 'cargada',
    transito_estacion: 'en_transito', descargando: 'en_transito',
    // Terminó, o se canceló, sin entregarla: el producto no llegó.
    retornando: 'validada', pendiente_liquidacion: 'validada', cerrado: 'validada', cancelado: 'validada',
  };

  it('la tabla cubre TODOS los estados del viaje', () => {
    expect(Object.keys(TABLA).sort()).toEqual(Object.keys(FLUJO_VIAJE).sort());
  });

  it.each(Object.entries(TABLA))('viaje %s → orden %s', async (estadoViaje, esperado) => {
    await enContexto(async () => {
      const o = await orden('planificada');
      await viajeCon(estadoViaje, o);
      await sincronizarEstadoDeOrdenes([o]);
      expect(await estadoDe(o)).toBe(esperado);
    });
  });

  it('dividida en dos viajes, manda el MÁS AVANZADO', async () => {
    await enContexto(async () => {
      const o = await orden();
      await viajeCon('borrador', o);
      await viajeCon('cargando', o);
      await sincronizarEstadoDeOrdenes([o]);
      expect(await estadoDe(o)).toBe('en_carga');
    });
  });

  it('un viaje cancelado no cuenta: manda el que sigue vivo', async () => {
    await enContexto(async () => {
      const o = await orden();
      await viajeCon('cargado', o);
      await viajeCon('cancelado', o);
      await sincronizarEstadoDeOrdenes([o]);
      expect(await estadoDe(o)).toBe('cargada');
    });
  });
});

describe('las entregas mandan sobre el viaje (§9 etapa 7, regla 20)', () => {
  it('todo lo solicitado entregado → entregada, esté el viaje donde esté', async () => {
    await enContexto(async () => {
      const o = await orden();
      await viajeCon('descargando', o);
      await entregar(o, 3000);
      await sincronizarEstadoDeOrdenes([o]);
      expect(await estadoDe(o)).toBe('entregada');
    });
  });

  it('una parte entregada → entrega parcial, aunque otro viaje siga cargando el resto', async () => {
    await enContexto(async () => {
      const o = await orden();
      await viajeCon('cerrado', o);
      await viajeCon('cargando', o);
      await entregar(o, 1200);
      await sincronizarEstadoDeOrdenes([o]);
      expect(await estadoDe(o)).toBe('entrega_parcial');
    });
  });

  it('con varias líneas, entregada exige TODAS completas', async () => {
    await enContexto(async () => {
      const o = await orden();
      await gestor().query(
        `INSERT INTO detalles_orden (empresa_id, orden_id, producto_id, volumen_solicitado) VALUES ($1,$2,$3,1000)`,
        [empresa, o, diesel]);
      await viajeCon('descargando', o);
      await gestor().query(
        `UPDATE detalles_orden SET volumen_entregado = volumen_solicitado WHERE orden_id = $1 AND producto_id = $2`,
        [o, producto]);
      await sincronizarEstadoDeOrdenes([o]);
      expect(await estadoDe(o)).toBe('entrega_parcial');
    });
  });
});

describe('lo que NO se toca', () => {
  it.each(['rechazada', 'cancelada', 'suspendida', 'con_incidencia', 'conciliada', 'cerrada'])(
    'una orden %s sigue así aunque su viaje avance: la decidió una persona', async estado => {
      await enContexto(async () => {
        const o = await orden(estado);
        await viajeCon('cargando', o);
        await entregar(o, 3000);
        await sincronizarEstadoDeOrdenes([o]);
        expect(await estadoDe(o)).toBe(estado);
      });
    });

  it('una orden «recibida» sin viaje sigue recibida: no se da por validada sola', async () => {
    await enContexto(async () => {
      const o = await orden('recibida');
      await sincronizarEstadoDeOrdenes([o]);
      expect(await estadoDe(o)).toBe('recibida');
    });
  });

  it('una validada sin ningún viaje sigue validada', async () => {
    await enContexto(async () => {
      const o = await orden('validada');
      await sincronizarEstadoDeOrdenes([o]);
      expect(await estadoDe(o)).toBe('validada');
    });
  });
});

describe('cada cambio queda auditado (regla 15), y sólo los cambios', () => {
  it('el cambio lleva el antes, el después y por qué', async () => {
    await enContexto(async () => {
      const o = await orden('validada');
      await viajeCon('cargando', o);
      await sincronizarEstadoDeOrdenes([o]);
      expect(ctx.cambios).toContainEqual({
        entidad: 'ordenes_abastecimiento', entidadId: o,
        valorAnterior: { estado: 'validada' }, valorNuevo: { estado: 'en_carga' },
        motivo: 'Sincronizado con el estado de su viaje y sus entregas',
      });
    });
  });

  it('sincronizar dos veces no audita dos veces', async () => {
    await enContexto(async () => {
      const o = await orden('validada');
      await viajeCon('cargando', o);
      await sincronizarEstadoDeOrdenes([o]);
      await sincronizarEstadoDeOrdenes([o]);
      expect(ctx.cambios.filter(c => c.entidad === 'ordenes_abastecimiento')).toHaveLength(1);
    });
  });
});

describe('los servicios sincronizan solos', () => {
  it('asignar la orden a un viaje la deja planificada (§9 etapa 2)', async () => {
    await enContexto(async () => {
      const o = await orden('validada');
      const v = await viajes.crear({ codigoViaje: `ASG-${aleatorio()}`, fechaProgramada: '2031-02-01T08:00:00Z' });
      await viajes.asignarOrden(String(v.id), { ordenId: o, secuenciaEntrega: 1 });
      expect(await estadoDe(o)).toBe('planificada');
    });
  });

  it('cancelar el viaje la devuelve a validada, lista para otro', async () => {
    await enContexto(async () => {
      const o = await orden('validada');
      const v = await viajes.crear({ codigoViaje: `CAN-${aleatorio()}`, fechaProgramada: '2031-02-01T08:00:00Z' });
      await viajes.asignarOrden(String(v.id), { ordenId: o, secuenciaEntrega: 1 });
      // Primero tiene que haberse PLANIFICADO: si no, «vuelve a validada» se
      // cumpliría sin que nada hubiera cambiado nunca.
      expect(await estadoDe(o)).toBe('planificada');
      await viajes.cambiarEstado(String(v.id), { estado: 'cancelado', motivo: 'Cliente pospuso' });
      expect(await estadoDe(o)).toBe('validada');
    });
  });

  /* Lo que protege `admiteEdicion` («una orden que ya salió a la calle no se
     reprograma editando campos»): con el estado sincronizado lo dice el propio
     estado, sin mirar los viajes a mano — que es lo que se hacía el 2026-09-14
     por la mañana, y que dejaba sin poder corregir una orden de un viaje
     cancelado, ya libre para planificarse otra vez. */
  it('en cuanto va en un viaje, la orden queda planificada y ya no se edita', async () => {
    await enContexto(async () => {
      const o = await orden('validada');
      const v = await viajes.crear({ codigoViaje: `EDI-${aleatorio()}`, fechaProgramada: '2031-02-01T08:00:00Z' });
      await viajes.asignarOrden(String(v.id), { ordenId: o, secuenciaEntrega: 1 });
      expect((await ordenes.obtener(o)).admiteEdicion).toBe(false);
      await expect(ordenes.actualizar(o, { prioridad: 'alta' })).rejects.toThrow(/ya no admite cambios/);
    });
  });

  it('si su viaje se cancela, vuelve a validada y SÍ se puede corregir', async () => {
    await enContexto(async () => {
      const o = await orden('validada');
      const v = await viajes.crear({ codigoViaje: `EDI-${aleatorio()}`, fechaProgramada: '2031-02-01T08:00:00Z' });
      await viajes.asignarOrden(String(v.id), { ordenId: o, secuenciaEntrega: 1 });
      await viajes.cambiarEstado(String(v.id), { estado: 'cancelado', motivo: 'Cliente pospuso' });
      expect((await ordenes.obtener(o)).admiteEdicion).toBe(true);
      expect((await ordenes.actualizar(o, { prioridad: 'alta' })).prioridad).toBe('alta');
    });
  });
});
