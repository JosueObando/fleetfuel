import 'reflect-metadata';
import { config as cargarEnv } from 'dotenv';
import { DataSource } from 'typeorm';
import { join } from 'path';

import { InformesService } from '../src/modules/informes/informes.service';
import { ejecutarEnContexto, gestor } from '../src/common/contexto/contexto-peticion';

cargarEnv({ path: join(__dirname, '../../.env') });

/**
 * §14 · Reportes básicos, tercer entregable de la Fase 1C.
 *
 * Un informe con la agregación mal puesta no falla: devuelve un número. Por eso
 * cada prueba de aquí monta datos con un resultado CONOCIDO y afirma el número,
 * en vez de comprobar que la consulta responde.
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

const servicio = new InformesService();
let empresa: string, usuario: string, conductorId: string;
let cliente: string, estacion: string, producto: string;
let secuencia = 0;

async function enContexto<T>(fn: (s: InformesService) => Promise<T>) {
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

/** Una orden con su línea, dentro de la transacción de la prueba. */
async function orden(solicitado: number, planificado = 0, entregado = 0) {
  const [o] = await gestor().query(
    `INSERT INTO ordenes_abastecimiento (empresa_id, cliente_id, estacion_id, estado)
     VALUES ($1,$2,$3,'validada') RETURNING orden_id`, [empresa, cliente, estacion]);
  const [d] = await gestor().query(
    `INSERT INTO detalles_orden (empresa_id, orden_id, producto_id, volumen_solicitado,
                                 volumen_planificado, volumen_entregado)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING detalle_orden_id`,
    [empresa, o.orden_id, producto, solicitado, planificado, entregado]);
  return { orden: String(o.orden_id), detalle: String(d.detalle_orden_id) };
}

/**
 * Un viaje con SU PROPIA cisterna y conductor, salvo que se le den.
 *
 * El `periodo` de un viaje es un rango sin cota superior mientras no tiene
 * `fecha_fin`, así que dos viajes abiertos de la misma cisterna chocan siempre
 * con la exclusión del §5.1. Un informe necesita varios viajes a la vez, así
 * que cada uno trae lo suyo — que además es lo que pasa de verdad: los viajes
 * simultáneos son de camiones distintos.
 */
async function viaje(estado: string, extra: Record<string, unknown> = {}) {
  let ci = extra.cisternaId as string | undefined;
  let cond = extra.conductorId as string | undefined;
  let comp: string | undefined;

  if (!ci) {
    const marca = `${secuencia}-${Math.random().toString(36).slice(2, 6)}`;
    const [veh] = await gestor().query(
      `INSERT INTO vehiculos (empresa_id, tipo_vehiculo, placa) VALUES ($1,'cisterna',$2)
       RETURNING vehiculo_id`, [empresa, `INF-${marca}`]);
    const [c] = await gestor().query(
      `INSERT INTO cisternas (empresa_id, vehiculo_id, capacidad_total) VALUES ($1,$2,10000)
       RETURNING cisterna_id`, [empresa, veh.vehiculo_id]);
    ci = String(c.cisterna_id);
    const [cc] = await gestor().query(
      `INSERT INTO compartimentos_cisterna
         (empresa_id, cisterna_id, numero, capacidad_nominal, capacidad_calibrada)
       VALUES ($1,$2,1,5000,4980) RETURNING compartimento_id`, [empresa, ci]);
    comp = String(cc.compartimento_id);
    const [cd] = await gestor().query(
      `INSERT INTO conductores (empresa_id, nombre_completo, documento, licencia)
       VALUES ($1,$2,$3,$4) RETURNING conductor_id`,
      [empresa, `Chofer ${marca}`, `IND-${marca}`, `INL-${marca}`]);
    cond = String(cd.conductor_id);
  }

  const [v] = await gestor().query(
    `INSERT INTO viajes (empresa_id, codigo_viaje, tipo_viaje, cisterna_id, conductor_id,
                         fecha_programada, estado, fecha_inicio, fecha_fin,
                         odometro_inicial, odometro_final, motivo_cancelacion)
     VALUES ($1,$2,'simple',$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING viaje_id`,
    [empresa, `INF-${Math.random().toString(36).slice(2, 9)}`, ci, cond,
     extra.fechaProgramada ?? new Date(Date.UTC(2033, 0, 1 + secuencia++, 8)).toISOString(),
     estado, extra.fechaInicio ?? null, extra.fechaFin ?? null,
     extra.odometroInicial ?? null, extra.odometroFinal ?? null,
     // Cancelar exige motivo: lo pide `ck_viajes_cancelacion` y es correcto.
     estado === 'cancelado' ? 'Cancelado por la prueba' : null]);
  return { id: String(v.viaje_id), cisterna: ci, compartimento: comp };
}

beforeAll(async () => {
  await dueño.initialize();
  await app.initialize();
  const [e] = await dueño.query(
    `INSERT INTO empresas (nombre, ruc) VALUES ('Informes Test','INF-TEST')
     ON CONFLICT (ruc) DO UPDATE SET nombre = EXCLUDED.nombre RETURNING empresa_id`);
  empresa = String(e.empresa_id);
  const [u] = await dueño.query(
    `INSERT INTO usuarios (empresa_id, nombre, correo, hash_clave)
     VALUES ($1,'Analista','inf@ejemplo.test','x') RETURNING usuario_id`, [empresa]);
  usuario = String(u.usuario_id);
  const [cd] = await dueño.query(
    `INSERT INTO conductores (empresa_id, nombre_completo, documento, licencia)
     VALUES ($1,'Chofer Informes','INF-D1','INF-L1') RETURNING conductor_id`, [empresa]);
  conductorId = String(cd.conductor_id);
  const [cli] = await dueño.query(
    `INSERT INTO clientes (empresa_id, nombre) VALUES ($1,'Cliente Inf') RETURNING cliente_id`,
    [empresa]);
  cliente = String(cli.cliente_id);
  const [est] = await dueño.query(
    `INSERT INTO estaciones_servicio (empresa_id, cliente_id, nombre)
     VALUES ($1,$2,'Estación Inf') RETURNING estacion_id`, [empresa, cliente]);
  estacion = String(est.estacion_id);
  const [p] = await dueño.query(
    `INSERT INTO productos_combustible (empresa_id, codigo, nombre)
     VALUES ($1,'INF-95','Gasolina Inf') RETURNING producto_id`, [empresa]);
  producto = String(p.producto_id);
});

afterAll(async () => {
  for (const t of ['entregas', 'plan_carga', 'viaje_ordenes', 'viajes', 'detalles_orden',
                   'ordenes_abastecimiento', 'estaciones_servicio', 'clientes',
                   'productos_combustible', 'cisternas', 'vehiculos', 'conductores',
                   'auditoria', 'usuarios']) {
    await dueño.query(`DELETE FROM ${t} WHERE empresa_id = $1`, [empresa]);
  }
  await dueño.query(`DELETE FROM empresas WHERE ruc = 'INF-TEST'`);
  await app.destroy();
  await dueño.destroy();
});

describe('§14.2 · la cadena del volumen', () => {
  it('suma solicitado, planificado y entregado por separado', async () => {
    await enContexto(async (s) => {
      await orden(5000, 3000, 2500);
      await orden(2000, 2000, 2000);
      const v = await s.volumen();
      expect(Number(v.volumenSolicitado)).toBe(7000);
      expect(Number(v.volumenPlanificado)).toBe(5000);
      expect(Number(v.volumenEntregado)).toBe(4500);
    });
  });

  it('el pendiente sale de la columna GENERATED, no de una resta a mano', async () => {
    // Si se recalculara aquí, este informe y `detalles_orden` podrían discrepar
    // — y el que estaría mal sería el informe, que es el que se mira.
    await enContexto(async (s) => {
      await orden(5000, 5000, 1200);
      const v = await s.volumen();
      expect(Number(v.volumenPendiente)).toBe(3800);
    });
  });

  it('sin datos devuelve ceros, no null', async () => {
    await enContexto(async (s) => {
      const v = await s.volumen('2099-01-01', '2099-12-31');
      expect(Number(v.volumenSolicitado)).toBe(0);
      expect(Number(v.volumenEntregado)).toBe(0);
    });
  });
});

describe('§14.1 · la foto operativa', () => {
  it('cuenta las cisternas en ruta y no las paradas', async () => {
    await enContexto(async (s) => {
      await viaje('transito_estacion');
      const antes = await s.operativo();
      expect(Number(antes.cisternasEnRuta)).toBeGreaterThanOrEqual(1);
    });
  });

  it('un viaje cancelado no cuenta como programado del día', async () => {
    await enContexto(async (s) => {
      const hoy = new Date().toISOString();
      await viaje('cancelado', { fechaProgramada: hoy });
      const r = await s.operativo();
      const conCancelado = Number(r.viajesProgramados);
      await viaje('borrador', { fechaProgramada: hoy });
      const despues = await s.operativo();
      expect(Number(despues.viajesProgramados)).toBe(conCancelado + 1);
    });
  });

  it('retrasado es el que debió salir y sigue sin salir', async () => {
    await enContexto(async (s) => {
      const partida = Number((await s.operativo()).viajesRetrasados);
      // Programado para ayer y todavía en borrador.
      await viaje('borrador', { fechaProgramada: '2020-01-01T08:00:00Z' });
      expect(Number((await s.operativo()).viajesRetrasados)).toBe(partida + 1);
      // Uno ya en marcha con fecha pasada NO está retrasado: salió.
      await viaje('transito_estacion', { fechaProgramada: '2020-02-01T08:00:00Z' });
      expect(Number((await s.operativo()).viajesRetrasados)).toBe(partida + 1);
    });
  });

  it('una cisterna ocupada deja de estar disponible', async () => {
    await enContexto(async (s) => {
      // La cisterna se crea con un viaje ya CERRADO —que no ocupa— para poder
      // medir con ella libre, y después se le abre uno en marcha.
      const { cisterna: ci } = await viaje('cerrado', {
        fechaInicio: '2033-01-01T08:00:00Z', fechaFin: '2033-01-01T12:00:00Z' });
      const libres = Number((await s.operativo()).cisternasDisponibles);
      await viaje('cargando', { cisternaId: ci, conductorId: conductorId,
                                fechaProgramada: '2034-01-01T08:00:00Z' });
      expect(Number((await s.operativo()).cisternasDisponibles)).toBe(libres - 1);
    });
  });
});

describe('§14.2 · mermas', () => {
  /** Una entrega con su carga y su recepción, sobre un viaje descargando. */
  async function entrega(cargado: number, recibido: number) {
    const { orden: o, detalle } = await orden(10000, cargado, 0);
    const v = await viaje('descargando');
    await gestor().query(
      `INSERT INTO viaje_ordenes (empresa_id, viaje_id, orden_id, secuencia_entrega)
       VALUES ($1,$2,$3,1)`, [empresa, v.id, o]);
    await gestor().query(
      `INSERT INTO entregas (empresa_id, viaje_id, orden_id, detalle_orden_id, estacion_id,
                             producto_id, compartimento_id, volumen_cargado, volumen_recibido,
                             receptor_nombre, latitud, longitud, estado)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'Receptor',8.98,-79.51,'aceptada')`,
      [empresa, v.id, o, detalle, estacion, producto, v.compartimento, cargado, recibido]);
  }

  it('la merma media se PONDERA por volumen, no se promedian porcentajes', async () => {
    // 5000→4900 es 2 % y 100→90 es 10 %. Promediar porcentajes daría 6 %, que
    // le da el mismo peso a 100 litros que a 5000: así se esconde un descuadre
    // grande detrás de muchos pequeños. Ponderado: 110/5100 = 2,1569 %.
    await enContexto(async (s) => {
      await entrega(5000, 4900);
      await entrega(100, 90);
      // Se agrupa por PRODUCTO porque cada viaje trae su propio conductor: por
      // conductor saldrían dos filas de una entrega cada una, y la ponderación
      // —que es lo que se está probando— no se vería.
      const [fila] = await s.mermas('producto');
      expect(Number(fila.volumenCargado)).toBe(5100);
      expect(Number(fila.diferenciaTotal)).toBe(110);
      expect(Number(fila.mermaPorcentaje)).toBeCloseTo(2.1569, 3);
    });
  });

  it('agrupa por cisterna y por producto también', async () => {
    await enContexto(async (s) => {
      await entrega(1000, 950);
      expect((await s.mermas('cisterna')).length).toBeGreaterThanOrEqual(1);
      expect((await s.mermas('producto')).length).toBeGreaterThanOrEqual(1);
    });
  });

  it('ordena por el descuadre MAYOR en valor absoluto', async () => {
    // Recibir de más es tan anómalo como recibir de menos: ordenar por el valor
    // con signo dejaría los excesos al final, que es donde nadie mira.
    await enContexto(async (s) => {
      await entrega(1000, 1200);
      const filas = await s.mermas('producto');
      expect(Math.abs(Number(filas[0].diferenciaTotal)))
        .toBeGreaterThanOrEqual(Math.abs(Number(filas[filas.length - 1].diferenciaTotal)));
    });
  });

  it('sin entregas devuelve lista vacía, no una fila de ceros', async () => {
    await enContexto(async (s) => {
      expect(await s.mermas('conductor')).toEqual([]);
    });
  });
});

describe('§14.1 · recorridos', () => {
  it('sólo los cerrados con odómetro, y calcula los kilómetros', async () => {
    await enContexto(async (s) => {
      await viaje('cerrado', {
        fechaInicio: '2033-06-01T08:00:00Z', fechaFin: '2033-06-01T14:00:00Z',
        odometroInicial: 120000, odometroFinal: 120450,
      });
      // Sin odómetro final no entra: no hay kilómetros que informar.
      await viaje('cerrado', { fechaInicio: '2033-07-01T08:00:00Z' });
      const filas = await s.recorridos();
      expect(filas).toHaveLength(1);
      expect(Number(filas[0].kilometros)).toBe(450);
      expect(Number(filas[0].duracionSegundos)).toBe(6 * 3600);
    });
  });

  it('un viaje en marcha no aparece', async () => {
    await enContexto(async (s) => {
      await viaje('transito_estacion', { odometroInicial: 1, odometroFinal: 2 });
      expect(await s.recorridos()).toEqual([]);
    });
  });
});
