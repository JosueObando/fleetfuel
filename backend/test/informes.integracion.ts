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
  for (const t of ['alertas', 'posiciones_gps', 'liquidaciones_conductor', 'gastos_viaje',
                   'entregas', 'plan_carga', 'viaje_ordenes', 'viajes', 'detalles_orden',
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

/**
 * §15.1 · Dashboard ejecutivo: las ocho tarjetas superiores.
 *
 * Siete salen de aquí; el «margen promedio» no, porque necesita ingreso y costo
 * completo, que son del motor de la Fase 3 (ver el comentario del servicio).
 *
 * Lo que más protege este bloque es EL DÍA. «Del día» es el día de Panamá, no
 * el de UTC: la base corre en UTC, y una descarga a las 22:00 de un lunes en
 * Panamá es un martes para `current_date`. Sin la zona explícita el panel de las
 * siete de la tarde ya estaría enseñando el día siguiente, casi vacío.
 */
describe('§15.1 · dashboard ejecutivo', () => {
  const DIA = '2033-03-15';
  /** Un instante del DIA en hora de Panamá (UTC−5, sin horario de verano). */
  const aLas = (hhmm: string, dia = DIA) => new Date(`${dia}T${hhmm}:00-05:00`).toISOString();

  async function vehiculoDe(cisterna: string) {
    const [f] = await gestor().query(
      `SELECT vehiculo_id FROM cisternas WHERE cisterna_id = $1`, [cisterna]);
    return String(f.vehiculo_id);
  }

  async function posicion(vehiculo: string, viajeId: string | null, cuando: string,
                          lat: number, lng: number) {
    await gestor().query(`SELECT fn_asegurar_particion_gps($1::timestamptz)`, [cuando]);
    await gestor().query(
      `INSERT INTO posiciones_gps (empresa_id, viaje_id, vehiculo_id, fecha_hora, ubicacion)
       VALUES ($1,$2,$3,$4, ST_SetSRID(ST_MakePoint($6,$5),4326)::geography)`,
      [empresa, viajeId, vehiculo, cuando, lat, lng]);
  }

  async function gasto(viajeId: string, monto: number, estado: string, fecha = DIA) {
    const resuelto = estado !== 'pendiente';
    await gestor().query(
      `INSERT INTO gastos_viaje (empresa_id, viaje_id, categoria, descripcion, monto, fecha,
                                 pagado_por, estado, registrado_por, aprobado_por, aprobado_en)
       VALUES ($1,$2,'peaje','Peaje de prueba',$3,$4,'empresa',$5,$6,$7,$8)`,
      [empresa, viajeId, monto, fecha, estado, usuario,
       resuelto ? usuario : null, resuelto ? new Date().toISOString() : null]);
  }

  async function liquidacion(estado: 'pendiente' | 'aprobada' | 'pagada', tarifa: number,
                             conductor?: string) {
    // Periodo CERRADO y distinto en cada llamada: dos viajes abiertos del mismo
    // conductor chocarían con la exclusión del §5.1.
    const n = secuencia++;
    const v = await viaje('pendiente_liquidacion', {
      fechaInicio: aLas('06:00', `2034-01-${String(n % 28 + 1).padStart(2, '0')}`),
      fechaFin: aLas('18:00', `2034-01-${String(n % 28 + 1).padStart(2, '0')}`) });
    // `viaje()` estrena conductor con su cisterna: el repetido se pone después.
    if (conductor) {
      await gestor().query(`UPDATE viajes SET conductor_id = $1 WHERE viaje_id = $2`,
        [conductor, v.id]);
    }
    const [cd] = await gestor().query(
      `SELECT conductor_id FROM viajes WHERE viaje_id = $1`, [v.id]);
    const aprobada = estado !== 'pendiente';
    const pagada = estado === 'pagada';
    await gestor().query(
      `INSERT INTO liquidaciones_conductor
         (empresa_id, viaje_id, conductor_id, tarifa_base, estado, calculada_por,
          aprobada_por, fecha_aprobacion, pagada_por, fecha_pago, referencia_pago)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [empresa, v.id, cd.conductor_id, tarifa, estado, usuario,
       aprobada ? usuario : null, aprobada ? new Date().toISOString() : null,
       pagada ? usuario : null, pagada ? new Date().toISOString() : null,
       pagada ? 'TRF-1' : null]);
    return String(cd.conductor_id);
  }

  async function alerta(severidad: string, estado = 'abierta') {
    await gestor().query(
      `INSERT INTO alertas (empresa_id, tipo, severidad, titulo, entidad, clave_dedup,
                            estado, resuelta_en)
       VALUES ($1,'prueba',$2,'Alerta de prueba','viajes',$3,$4,$5)`,
      [empresa, severidad, `ejecutivo:${secuencia++}:${Math.random()}`, estado,
       estado === 'resuelta' ? new Date().toISOString() : null]);
  }

  it('sin datos devuelve ceros, no null', async () => {
    await enContexto(async (s) => {
      const r = await s.ejecutivo(DIA);
      for (const clave of ['ordenesActivas', 'viajesEnCurso', 'volumenEntregado',
        'kilometrosGps', 'unidadesConGps', 'kilometrosOdometro', 'gastosDelDia',
        'gastosPorAprobar', 'conductoresPendientesPago', 'montoPendientePago',
        'alertasCriticas', 'alertasAltas']) {
        expect(r[clave]).not.toBeNull();
        expect(Number(r[clave])).toBe(0);
      }
      expect(r.fecha).toBe(DIA);
    });
  });

  it('órdenes activas: todo lo que no llegó a un estado terminal ni se dio de baja', async () => {
    await enContexto(async (s) => {
      for (const estado of ['recibida', 'validada', 'asignada', 'suspendida', 'entrega_parcial']) {
        const { orden: o } = await orden(1000);
        await gestor().query(
          `UPDATE ordenes_abastecimiento SET estado = $1 WHERE orden_id = $2`, [estado, o]);
      }
      for (const estado of ['cerrada', 'cancelada', 'rechazada']) {
        const { orden: o } = await orden(1000);
        await gestor().query(
          `UPDATE ordenes_abastecimiento SET estado = $1 WHERE orden_id = $2`, [estado, o]);
      }
      const { orden: baja } = await orden(1000);
      await gestor().query(
        `UPDATE ordenes_abastecimiento SET eliminado_en = now() WHERE orden_id = $1`, [baja]);

      expect(Number((await s.ejecutivo(DIA)).ordenesActivas)).toBe(5);
    });
  });

  it('viajes en curso: los que salieron y no han vuelto, ni antes ni después', async () => {
    await enContexto(async (s) => {
      await viaje('desplazamiento_terminal');
      await viaje('transito_estacion');
      await viaje('retornando');
      // Autorizado todavía no ha salido; pendiente de liquidar ya volvió.
      await viaje('autorizado');
      await viaje('pendiente_liquidacion');
      await viaje('cerrado', { fechaInicio: aLas('08:00'), fechaFin: aLas('12:00') });
      expect(Number((await s.ejecutivo(DIA)).viajesEnCurso)).toBe(3);
    });
  });

  describe('volumen entregado del día', () => {
    async function entregaEl(cuando: string, recibido: number, estado = 'aceptada') {
      const { orden: o, detalle } = await orden(10000, 5000, 0);
      const v = await viaje('descargando');
      await gestor().query(
        `INSERT INTO viaje_ordenes (empresa_id, viaje_id, orden_id, secuencia_entrega)
         VALUES ($1,$2,$3,1)`, [empresa, v.id, o]);
      await gestor().query(
        `INSERT INTO entregas (empresa_id, viaje_id, orden_id, detalle_orden_id, estacion_id,
                               producto_id, compartimento_id, volumen_cargado, volumen_recibido,
                               receptor_nombre, latitud, longitud, estado, fecha_descarga)
         VALUES ($1,$2,$3,$4,$5,$6,$7,5000,$8,'Receptor',8.98,-79.51,$9,$10)`,
        [empresa, v.id, o, detalle, estacion, producto, v.compartimento, recibido, estado, cuando]);
    }

    it('suma lo recibido y deja fuera lo rechazado', async () => {
      await enContexto(async (s) => {
        await entregaEl(aLas('09:00'), 4000);
        await entregaEl(aLas('11:00'), 900, 'parcial');
        await entregaEl(aLas('13:00'), 4990, 'rechazada');
        expect(Number((await s.ejecutivo(DIA)).volumenEntregado)).toBe(4900);
      });
    });

    it('cuenta el día de PANAMÁ: las 22:00 locales son el día siguiente en UTC', async () => {
      await enContexto(async (s) => {
        await entregaEl(aLas('22:00'), 3000);          // 03:00 UTC del 16
        await entregaEl(aLas('23:30', '2033-03-14'), 7); // 04:30 UTC del 15: es del 14
        expect(Number((await s.ejecutivo(DIA)).volumenEntregado)).toBe(3000);
        expect(Number((await s.ejecutivo('2033-03-16')).volumenEntregado)).toBe(0);
      });
    });
  });

  describe('kilómetros del día', () => {
    it('GPS: suma los tramos de cada unidad sin unir los de dos unidades distintas', async () => {
      await enContexto(async (s) => {
        const a = await viaje('transito_estacion');
        const b = await viaje('transito_estacion');
        const va = await vehiculoDe(a.cisterna);
        const vb = await vehiculoDe(b.cisterna);
        // Unidad A: dos tramos de 0,01° de latitud (~1,106 km cada uno).
        await posicion(va, a.id, aLas('08:00'), 9.00, -79.50);
        await posicion(va, a.id, aLas('08:10'), 9.01, -79.50);
        await posicion(va, a.id, aLas('08:20'), 9.02, -79.50);
        // Unidad B, muy lejos: si se encadenara con A saldrían cientos de km.
        await posicion(vb, b.id, aLas('08:05'), 7.00, -80.00);
        await posicion(vb, b.id, aLas('08:15'), 7.01, -80.00);
        // 23:00 en Panamá ya es el día siguiente en UTC, y sigue siendo del DIA.
        await posicion(vb, b.id, aLas('23:00'), 7.02, -80.00);
        // Del día anterior: no cuenta.
        await posicion(va, a.id, aLas('23:00', '2033-03-14'), 8.00, -79.50);

        const r = await s.ejecutivo(DIA);
        expect(Number(r.kilometrosGps)).toBeCloseTo(4 * 1.106, 1);
        expect(Number(r.unidadesConGps)).toBe(2);
      });
    });

    it('odómetro: el de los viajes que CERRARON ese día, por su cierre real', async () => {
      // Sin la app del conductor (Fase 2A) casi no llega GPS, y una tarjeta que
      // dice 0 todos los días no informa de nada. El odómetro es la otra medida
      // que el §10.1 reconoce, y la API la da aparte para que la pantalla diga
      // cuál está enseñando.
      const cerrar = (id: string, cuando: string) => gestor().query(
        `UPDATE viajes SET fecha_cierre = $1 WHERE viaje_id = $2`, [cuando, id]);
      await enContexto(async (s) => {
        // Cerrado el DIA, aunque su fin PREVISTO fuera el día anterior.
        const a = await viaje('cerrado', { fechaInicio: aLas('06:00', '2033-03-14'),
                                           fechaFin: aLas('14:00', '2033-03-14'),
                                           odometroInicial: 1000, odometroFinal: 1320 });
        await cerrar(a.id, aLas('10:00'));
        // Cerrado a las 21:30 del día anterior en Panamá, que son las 02:30 UTC
        // del DIA: sin la zona se colaría.
        const b = await viaje('cerrado', { fechaInicio: aLas('06:00', '2033-03-14'),
                                           fechaFin: aLas('20:00', '2033-03-14'),
                                           odometroInicial: 1000, odometroFinal: 1500 });
        await cerrar(b.id, aLas('21:30', '2033-03-14'));
        // Con fin previsto el DIA y odómetro, pero sin cerrar: no cuenta.
        await viaje('pendiente_liquidacion', { fechaInicio: aLas('06:00'),
                                               fechaFin: aLas('18:00'),
                                               odometroInicial: 1000, odometroFinal: 1077 });
        expect(Number((await s.ejecutivo(DIA)).kilometrosOdometro)).toBe(320);
      });
    });
  });

  it('gastos del día: aprobados y por aprobar, sin los rechazados ni otros días', async () => {
    await enContexto(async (s) => {
      const v = await viaje('transito_estacion');
      await gasto(v.id, 25.5, 'aprobado');
      await gasto(v.id, 14.5, 'pendiente');
      await gasto(v.id, 100, 'rechazado');
      await gasto(v.id, 70, 'aprobado', '2033-03-14');
      await gasto(v.id, 9, 'pendiente', '2033-03-14');
      const r = await s.ejecutivo(DIA);
      expect(Number(r.gastosDelDia)).toBe(40);
      expect(Number(r.gastosPorAprobar)).toBe(1);
    });
  });

  it('conductores pendientes de pago: personas distintas, no liquidaciones', async () => {
    await enContexto(async (s) => {
      const repetido = await liquidacion('pendiente', 100);
      await liquidacion('aprobada', 50, repetido);
      await liquidacion('aprobada', 30);
      await liquidacion('pagada', 999);
      const r = await s.ejecutivo(DIA);
      expect(Number(r.conductoresPendientesPago)).toBe(2);
      expect(Number(r.montoPendientePago)).toBe(180);
    });
  });

  it('alertas: críticas y altas sin resolver, cada una por su lado', async () => {
    await enContexto(async (s) => {
      await alerta('critica');
      await alerta('critica', 'reconocida');
      await alerta('critica', 'resuelta');
      await alerta('alta');
      await alerta('alta', 'resuelta');
      await alerta('media');
      const r = await s.ejecutivo(DIA);
      expect(Number(r.alertasCriticas)).toBe(2);
      expect(Number(r.alertasAltas)).toBe(1);
    });
  });

  it('sin fecha usa HOY en Panamá, también cuando en UTC ya es mañana', async () => {
    await enContexto(async (s) => {
      // 21:00 del 15 en Panamá = 02:00 UTC del 16.
      const r = await s.ejecutivo(undefined, new Date('2033-03-16T02:00:00Z'));
      expect(r.fecha).toBe(DIA);
    });
  });
});
