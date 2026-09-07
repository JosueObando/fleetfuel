import 'reflect-metadata';
import { config as cargarEnv } from 'dotenv';
import { DataSource } from 'typeorm';
import { join } from 'path';

import { AlertasService, UMBRALES } from '../src/modules/alertas/alertas.service';
import { GeocercasService } from '../src/modules/alertas/geocercas.service';
import { ejecutarEnContexto, gestor } from '../src/common/contexto/contexto-peticion';

cargarEnv({ path: join(__dirname, '../../.env') });

/**
 * §22 · Geocercas y alertas automáticas.
 *
 * Lo que se prueba no es que las alertas se creen: es que **no se dupliquen**.
 * Una alerta que reaparece en cada evaluación es ruido, y el ruido se ignora —
 * que es la forma más común de que un sistema de alertas deje de servir sin que
 * nadie lo apague.
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

const alertas = new AlertasService();
const geocercas = new GeocercasService();
let empresa: string, usuario: string, cliente: string, estacion: string;
let secuencia = 0;

async function enContexto<T>(fn: () => Promise<T>) {
  const runner = app.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await runner.query(`SELECT set_config('app.empresa_id', $1, true)`, [empresa]);
    return await ejecutarEnContexto(
      { empresaId: empresa, usuarioId: usuario, manager: runner.manager, cambios: [] }, fn);
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    await runner.release();
  }
}

async function viaje(estado = 'transito_estacion') {
  const marca = `${secuencia++}-${Math.random().toString(36).slice(2, 6)}`;
  const [veh] = await gestor().query(
    `INSERT INTO vehiculos (empresa_id, tipo_vehiculo, placa) VALUES ($1,'cisterna',$2)
     RETURNING vehiculo_id`, [empresa, `ALE-${marca}`]);
  const [c] = await gestor().query(
    `INSERT INTO cisternas (empresa_id, vehiculo_id, capacidad_total) VALUES ($1,$2,10000)
     RETURNING cisterna_id`, [empresa, veh.vehiculo_id]);
  const [cd] = await gestor().query(
    `INSERT INTO conductores (empresa_id, nombre_completo, documento, licencia)
     VALUES ($1,$2,$3,$4) RETURNING conductor_id`,
    [empresa, `Chofer ${marca}`, `AD-${marca}`, `AL-${marca}`]);
  const [v] = await gestor().query(
    `INSERT INTO viajes (empresa_id, codigo_viaje, tipo_viaje, cisterna_id, conductor_id,
                         fecha_programada, estado)
     VALUES ($1,$2,'simple',$3,$4,$5,$6) RETURNING viaje_id`,
    [empresa, `ALE-${marca}`, c.cisterna_id, cd.conductor_id,
     new Date(Date.UTC(2039, 0, 1 + secuencia, 8)).toISOString(), estado]);
  return { viaje: String(v.viaje_id), vehiculo: String(veh.vehiculo_id),
           conductor: String(cd.conductor_id) };
}

async function posicion(viajeId: string, vehiculoId: string, opciones: {
  velocidad?: number; segundosAtras?: number; lat?: number; lng?: number;
} = {}) {
  const cuando = new Date(Date.now() - (opciones.segundosAtras ?? 5) * 1000).toISOString();
  await gestor().query(`SELECT fn_asegurar_particion_gps($1::timestamptz)`, [cuando]);
  await gestor().query(
    `INSERT INTO posiciones_gps (empresa_id, viaje_id, vehiculo_id, fecha_hora, ubicacion,
                                 velocidad)
     VALUES ($1,$2,$3,$4, ST_SetSRID(ST_MakePoint($6,$5),4326)::geography, $7)`,
    [empresa, viajeId, vehiculoId, cuando,
     opciones.lat ?? 8.98, opciones.lng ?? -79.53, opciones.velocidad ?? 50]);
}

const TERMINAL = { latitud: 8.9450, longitud: -79.5600 };

beforeAll(async () => {
  await dueño.initialize();
  await app.initialize();
  const [e] = await dueño.query(
    `INSERT INTO empresas (nombre, ruc) VALUES ('Alertas Test','ALE-TEST')
     ON CONFLICT (ruc) DO UPDATE SET nombre = EXCLUDED.nombre RETURNING empresa_id`);
  empresa = String(e.empresa_id);
  const [u] = await dueño.query(
    `INSERT INTO usuarios (empresa_id, nombre, correo, hash_clave)
     VALUES ($1,'Supervisor','ale@ejemplo.test','x') RETURNING usuario_id`, [empresa]);
  usuario = String(u.usuario_id);
  const [cli] = await dueño.query(
    `INSERT INTO clientes (empresa_id, nombre) VALUES ($1,'Cliente Ale') RETURNING cliente_id`,
    [empresa]);
  cliente = String(cli.cliente_id);
  const [est] = await dueño.query(
    `INSERT INTO estaciones_servicio (empresa_id, cliente_id, nombre)
     VALUES ($1,$2,'Estacion Ale') RETURNING estacion_id`, [empresa, cliente]);
  estacion = String(est.estacion_id);
});

afterAll(async () => {
  await dueño.query(`DELETE FROM posiciones_gps WHERE empresa_id = $1`, [empresa]);
  for (const t of ['alertas', 'geocercas', 'viajes', 'cisternas', 'vehiculos', 'conductores',
                   'estaciones_servicio', 'clientes', 'auditoria', 'usuarios']) {
    await dueño.query(`DELETE FROM ${t} WHERE empresa_id = $1`, [empresa]);
  }
  await dueño.query(`DELETE FROM empresas WHERE ruc = 'ALE-TEST'`);
  await app.destroy();
  await dueño.destroy();
});

describe('geocercas · el círculo que se guarda como polígono', () => {
  it('un radio en metros es un radio de verdad, no grados', async () => {
    // `ST_Buffer` sobre `geography` trabaja en metros sobre el elipsoide. Con
    // grados, el mismo número mide distinto según la latitud, y cerca del
    // ecuador el error pasa desapercibido justo lo suficiente para colarse.
    await enContexto(async () => {
      const g = await geocercas.crear({
        nombre: `Terminal ${secuencia}`, tipo: 'terminal', ...TERMINAL, radioM: 500,
      });
      // Área de un círculo de 500 m: π·500² ≈ 785 398 m².
      expect(Number(g.areaM2)).toBeGreaterThan(770_000);
      expect(Number(g.areaM2)).toBeLessThan(800_000);
    });
  });

  it('dice qué geocercas contienen un punto, y cuáles no', async () => {
    await enContexto(async () => {
      await geocercas.crear({
        nombre: `Terminal contiene ${secuencia}`, tipo: 'terminal', ...TERMINAL, radioM: 1000,
      });
      // El centro: dentro.
      expect(await geocercas.contienenA(TERMINAL.latitud, TERMINAL.longitud))
        .toHaveLength(1);
      // A 5 km: fuera.
      expect(await geocercas.contienenA(TERMINAL.latitud + 0.05, TERMINAL.longitud))
        .toHaveLength(0);
    });
  });

  it('un nombre repetido se rechaza', async () => {
    await enContexto(async () => {
      const nombre = `Repetida ${secuencia}`;
      await geocercas.crear({ nombre, tipo: 'taller', ...TERMINAL, radioM: 100 });
      await expect(geocercas.crear({ nombre, tipo: 'taller', ...TERMINAL, radioM: 100 }))
        .rejects.toThrow(/Ya existe una geocerca/);
    });
  });

  it('una estación que no existe se rechaza', async () => {
    await enContexto(async () => {
      await expect(geocercas.crear({
        nombre: `Mala ${secuencia}`, tipo: 'estacion', estacionId: '999999999',
        ...TERMINAL, radioM: 100,
      })).rejects.toThrow(/estacion indicada no existe/);
    });
  });

  it('dice dónde está un viaje según su última posición', async () => {
    await enContexto(async () => {
      const { viaje: v, vehiculo } = await viaje();
      await geocercas.crear({
        nombre: `Zona ${secuencia}`, tipo: 'estacion', estacionId: estacion,
        ...TERMINAL, radioM: 800,
      });
      await posicion(v, vehiculo, { lat: TERMINAL.latitud, lng: TERMINAL.longitud });
      const donde = await geocercas.dondeEsta(v);
      expect(donde.dentroDe).toHaveLength(1);
    });
  });

  it('un viaje sin posiciones no está en ninguna parte, y lo dice sin reventar', async () => {
    await enContexto(async () => {
      const { viaje: v } = await viaje();
      expect(await geocercas.dondeEsta(v)).toEqual({ fechaHora: null, dentroDe: [] });
    });
  });
});

describe('§22 · las reglas encuentran lo que tienen que encontrar', () => {
  it('exceso de velocidad, una alerta POR VIAJE y no por lectura', async () => {
    // Cien muestras a 95 km/h son un hecho, no cien. Una alerta por muestra
    // sería ruido puro y la lista dejaría de mirarse.
    await enContexto(async () => {
      const { viaje: v, vehiculo } = await viaje();
      for (let i = 0; i < 5; i++) {
        await posicion(v, vehiculo, { velocidad: UMBRALES.velocidadMaximaKmh + 10, segundosAtras: 10 + i });
      }
      await alertas.evaluar();
      const abiertas = (await alertas.listar()).filter(
        (a: { tipo: string; viajeId: string }) => a.tipo === 'exceso_velocidad' && String(a.viajeId) === v);
      expect(abiertas).toHaveLength(1);
      expect(abiertas[0].severidad).toBe('alta');
      expect(Number(abiertas[0].detalle.lecturas)).toBe(5);
    });
  });

  it('pérdida de GPS: el que nunca mandó nada y el que dejó de mandar', async () => {
    await enContexto(async () => {
      const mudo = await viaje();
      const callado = await viaje();
      await posicion(callado.viaje, callado.vehiculo, { segundosAtras: UMBRALES.segundosSinGps + 100 });

      await alertas.evaluar();
      const perdidas = (await alertas.listar()).filter(
        (a: { tipo: string }) => a.tipo === 'perdida_gps');
      const ids = perdidas.map((a: { viajeId: string }) => String(a.viajeId));
      expect(ids).toContain(mudo.viaje);
      expect(ids).toContain(callado.viaje);
      // El que nunca mandó nada se distingue en el título.
      const delMudo = perdidas.find((a: { viajeId: string }) => String(a.viajeId) === mudo.viaje);
      expect(delMudo.titulo).toMatch(/nunca ha enviado/);
    });
  });

  it('un viaje con GPS reciente NO genera alerta', async () => {
    await enContexto(async () => {
      const { viaje: v, vehiculo } = await viaje();
      await posicion(v, vehiculo, { segundosAtras: 5, velocidad: 40 });
      await alertas.evaluar();
      const suyas = (await alertas.listar()).filter(
        (a: { viajeId: string }) => String(a.viajeId) === v);
      expect(suyas).toHaveLength(0);
    });
  });

  it('licencia vencida es crítica; por vencer es media', async () => {
    // La regla 13 del §11 dice que los documentos vencidos BLOQUEAN la
    // asignación. Avisar 30 días antes evita que el bloqueo llegue por sorpresa
    // la mañana de un despacho.
    await enContexto(async () => {
      const { conductor } = await viaje();
      await gestor().query(
        `UPDATE conductores SET fecha_vencimiento_licencia = current_date - 5
          WHERE conductor_id = $1`, [conductor]);
      await alertas.evaluar();
      const [a] = (await alertas.listar()).filter(
        (x: { tipo: string; entidadId: string }) =>
          x.tipo === 'licencia_por_vencer' && String(x.entidadId) === conductor);
      expect(a.severidad).toBe('critica');
      expect(a.titulo).toMatch(/VENCIDA/);
    });
  });
});

describe('§22 · las reglas que miran más allá del GPS', () => {
  /** Una orden con su línea, una entrega y un gasto, colgando de un viaje. */
  async function entregaCon(viajeId: string, opciones: {
    sello?: string; estado?: string; recibido?: number;
  } = {}) {
    const [o] = await gestor().query(
      `INSERT INTO ordenes_abastecimiento (empresa_id, cliente_id, estacion_id, estado)
       VALUES ($1,$2,$3,'en_transito') RETURNING orden_id`, [empresa, cliente, estacion]);
    const [p] = await gestor().query(
      `INSERT INTO productos_combustible (empresa_id, codigo, nombre)
       VALUES ($1,$2,'Producto') RETURNING producto_id`, [empresa, `AP-${secuencia++}`]);
    const [d] = await gestor().query(
      `INSERT INTO detalles_orden (empresa_id, orden_id, producto_id, volumen_solicitado)
       VALUES ($1,$2,$3,5000) RETURNING detalle_orden_id`, [empresa, o.orden_id, p.producto_id]);
    const [v] = await gestor().query(
      `SELECT cisterna_id FROM viajes WHERE viaje_id = $1`, [viajeId]);
    const [cc] = await gestor().query(
      `INSERT INTO compartimentos_cisterna
         (empresa_id, cisterna_id, numero, capacidad_nominal, capacidad_calibrada)
       VALUES ($1,$2,1,5000,4980) RETURNING compartimento_id`, [empresa, v.cisterna_id]);
    const [e] = await gestor().query(
      `INSERT INTO entregas (empresa_id, viaje_id, orden_id, detalle_orden_id, estacion_id,
                             producto_id, compartimento_id, volumen_cargado, volumen_recibido,
                             receptor_nombre, latitud, longitud, estado, estado_sello,
                             sello_recibido)
       VALUES ($1,$2,$3,$4,$5,$6,$7,3000,$8,'Receptor',8.98,-79.51,$9,$10,'SELLO-1')
       RETURNING entrega_id`,
      [empresa, viajeId, o.orden_id, d.detalle_orden_id, estacion, p.producto_id,
       cc.compartimento_id, opciones.recibido ?? 3000, opciones.estado ?? 'aceptada',
       opciones.sello ?? null]);
    return String(e.entrega_id);
  }

  it('un sello roto es CRÍTICO: es la señal más directa de manipulación', async () => {
    // La regla 18 del §11: todo sello se verifica en la entrega.
    await enContexto(async () => {
      const { viaje: v } = await viaje();
      const e = await entregaCon(v, { sello: 'roto' });
      await alertas.evaluar();
      const [a] = (await alertas.listar()).filter(
        (x: { tipo: string; entidadId: string }) =>
          x.tipo === 'sello_inconsistente' && String(x.entidadId) === e);
      expect(a.severidad).toBe('critica');
    });
  });

  it('una entrega pendiente de aprobación es una diferencia de volumen', async () => {
    await enContexto(async () => {
      const { viaje: v } = await viaje();
      const e = await entregaCon(v, { estado: 'pendiente', recibido: 2700 });
      await alertas.evaluar();
      const [a] = (await alertas.listar()).filter(
        (x: { tipo: string; entidadId: string }) =>
          x.tipo === 'diferencia_volumen' && String(x.entidadId) === e);
      expect(a.severidad).toBe('alta');
      expect(Number(a.detalle.diferencia)).toBe(300);
    });
  });

  it('un viaje que lleva una semana pendiente de liquidación', async () => {
    await enContexto(async () => {
      const { viaje: v } = await viaje('pendiente_liquidacion');
      await gestor().query(
        `UPDATE viajes SET fecha_programada = now() - interval '20 days' WHERE viaje_id = $1`,
        [v]);
      await alertas.evaluar();
      const suyas = (await alertas.listar()).filter(
        (x: { tipo: string; viajeId: string }) =>
          x.tipo === 'viaje_sin_cerrar' && String(x.viajeId) === v);
      expect(suyas).toHaveLength(1);
    });
  });

  it('un viaje cerrado hace días y sin liquidar', async () => {
    await enContexto(async () => {
      const { viaje: v } = await viaje('cerrado');
      // Las tres fechas a la vez: `periodo` es un rango GENERATED y un fin
      // anterior al inicio no es un viaje raro, es un rango imposible.
      await gestor().query(
        `UPDATE viajes SET fecha_programada = now() - interval '25 days',
                fecha_inicio = now() - interval '25 days',
                fecha_fin = now() - interval '20 days'
          WHERE viaje_id = $1`, [v]);
      await alertas.evaluar();
      const suyas = (await alertas.listar()).filter(
        (x: { tipo: string; viajeId: string }) =>
          x.tipo === 'liquidacion_pendiente' && String(x.viajeId) === v);
      expect(suyas).toHaveLength(1);
    });
  });

  it('un gasto reembolsable aprobado sin comprobante', async () => {
    // Reembolsar sin papel es exactamente lo que una auditoría no puede seguir.
    await enContexto(async () => {
      const { viaje: v } = await viaje();
      const [g] = await gestor().query(
        `INSERT INTO gastos_viaje (empresa_id, viaje_id, categoria, descripcion, monto,
                                   pagado_por, reembolsable, estado, registrado_por,
                                   aprobado_por, aprobado_en)
         VALUES ($1,$2,'peaje','Sin papel',45,'conductor',true,'aprobado',$3,$3,now())
         RETURNING gasto_id`, [empresa, v, usuario]);
      await alertas.evaluar();
      const [a] = (await alertas.listar()).filter(
        (x: { tipo: string; entidadId: string }) =>
          x.tipo === 'gasto_sin_comprobante' && String(x.entidadId) === String(g.gasto_id));
      expect(Number(a.detalle.monto)).toBe(45);
    });
  });

  it('una licencia POR vencer avisa en media, no en crítica', async () => {
    // Los 30 días de aviso son lo que evita que el bloqueo de la regla 13
    // llegue por sorpresa la mañana de un despacho.
    await enContexto(async () => {
      const { conductor } = await viaje();
      await gestor().query(
        `UPDATE conductores SET fecha_vencimiento_licencia = current_date + 10
          WHERE conductor_id = $1`, [conductor]);
      await alertas.evaluar();
      const [a] = (await alertas.listar()).filter(
        (x: { tipo: string; entidadId: string }) =>
          x.tipo === 'licencia_por_vencer' && String(x.entidadId) === conductor);
      expect(a.severidad).toBe('media');
      expect(a.titulo).toMatch(/por vencer/);
    });
  });
});

describe('la deduplicación, que es lo que separa una alerta del ruido', () => {
  it('evaluar tres veces deja UNA alerta, no tres', async () => {
    await enContexto(async () => {
      const { viaje: v, vehiculo } = await viaje();
      await posicion(v, vehiculo, { velocidad: 150 });

      const primera = await alertas.evaluar();
      const segunda = await alertas.evaluar();
      const tercera = await alertas.evaluar();

      expect(primera.nuevas).toBeGreaterThan(0);
      expect(segunda.nuevas).toBe(0);
      expect(tercera.nuevas).toBe(0);
      expect(segunda.yaAbiertas).toBe(segunda.evaluadas);

      const suyas = (await alertas.listar()).filter(
        (a: { tipo: string; viajeId: string }) =>
          a.tipo === 'exceso_velocidad' && String(a.viajeId) === v);
      expect(suyas).toHaveLength(1);
    });
  });

  it('resuelta y vuelta a ocurrir: se abre otra, que es lo que se quiere', async () => {
    await enContexto(async () => {
      const { viaje: v, vehiculo } = await viaje();
      await posicion(v, vehiculo, { velocidad: 150 });
      await alertas.evaluar();

      const [a] = (await alertas.listar()).filter(
        (x: { tipo: string; viajeId: string }) =>
          x.tipo === 'exceso_velocidad' && String(x.viajeId) === v);
      await alertas.resolver(String(a.id), { motivo: 'Hablado con el conductor' });

      const r = await alertas.evaluar();
      expect(r.nuevas).toBeGreaterThan(0);
      const todas = (await alertas.listar('todas')).filter(
        (x: { tipo: string; viajeId: string }) =>
          x.tipo === 'exceso_velocidad' && String(x.viajeId) === v);
      expect(todas).toHaveLength(2);
    });
  });

  it('una alerta resuelta ya no se resuelve otra vez', async () => {
    await enContexto(async () => {
      const { viaje: v, vehiculo } = await viaje();
      await posicion(v, vehiculo, { velocidad: 150 });
      await alertas.evaluar();
      const [a] = (await alertas.listar()).filter(
        (x: { viajeId: string }) => String(x.viajeId) === v);
      await alertas.resolver(String(a.id), { motivo: 'Primera vez' });
      await expect(alertas.resolver(String(a.id), { motivo: 'Segunda vez' }))
        .rejects.toThrow(/ya esta resuelta/);
    });
  });

  it('reconocer deja constancia de quién, y no se reconoce dos veces', async () => {
    await enContexto(async () => {
      const { viaje: v, vehiculo } = await viaje();
      await posicion(v, vehiculo, { velocidad: 150 });
      await alertas.evaluar();
      const [a] = (await alertas.listar()).filter(
        (x: { viajeId: string }) => String(x.viajeId) === v);

      const r = await alertas.reconocer(String(a.id));
      expect(r.estado).toBe('reconocida');
      expect(String(r.reconocidaPor)).toBe(usuario);
      await expect(alertas.reconocer(String(a.id))).rejects.toThrow(/ya esta/);
    });
  });

  it('una reconocida NO se vuelve a crear: sigue viva', async () => {
    // El índice de deduplicación es parcial sobre las NO resueltas, así que
    // reconocer no reabre nada. Si lo hiciera, atender una alerta la duplicaría.
    await enContexto(async () => {
      const { viaje: v, vehiculo } = await viaje();
      await posicion(v, vehiculo, { velocidad: 150 });
      await alertas.evaluar();
      const [a] = (await alertas.listar()).filter(
        (x: { viajeId: string }) => String(x.viajeId) === v);
      await alertas.reconocer(String(a.id));

      const r = await alertas.evaluar();
      expect(r.nuevas).toBe(0);
    });
  });

  it('una alerta que no existe da 404', async () => {
    await enContexto(async () => {
      await expect(alertas.obtener('999999999')).rejects.toThrow(/no encontrada/i);
    });
  });
});
