import 'reflect-metadata';
import { config as cargarEnv } from 'dotenv';
import { DataSource } from 'typeorm';
import { join } from 'path';

import { LiquidacionesService } from '../src/modules/liquidaciones/liquidaciones.service';
import { ejecutarEnContexto, gestor } from '../src/common/contexto/contexto-peticion';

cargarEnv({ path: join(__dirname, '../../.env') });

/**
 * §7.18 y §10.7 · Liquidación del conductor.
 *
 * El quinto entregable de 1C. La fórmula del pago combinado está escrita literal
 * en el §10.7 y es lo que se prueba aquí con números conocidos; lo que NO entra
 * es la variación de tarifa por ruta, horario o feriado, que es un motor de
 * tarifas de la Fase 3.
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

const servicio = new LiquidacionesService();
let empresa: string, contable: string, jefe: string, tesoreria: string;
let conductorId: string, cliente: string, estacion: string, producto: string;
let secuencia = 0;

async function como<T>(usuarioId: string, fn: (s: LiquidacionesService) => Promise<T>) {
  const runner = app.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await runner.query(`SELECT set_config('app.empresa_id', $1, true)`, [empresa]);
    return await ejecutarEnContexto(
      { empresaId: empresa, usuarioId, manager: runner.manager, cambios: [] },
      () => fn(servicio),
    );
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    await runner.release();
  }
}

const otroUsuario = <T>(usuarioId: string, fn: () => Promise<T>) =>
  ejecutarEnContexto({ empresaId: empresa, usuarioId, manager: gestor(), cambios: [] }, fn);

/** Un viaje CERRADO con su propia cisterna, y odómetro si se pide. */
async function viajeCerrado(opciones: {
  km?: number | null; estado?: string;
} = {}) {
  const marca = `${secuencia++}-${Math.random().toString(36).slice(2, 6)}`;
  const [veh] = await gestor().query(
    `INSERT INTO vehiculos (empresa_id, tipo_vehiculo, placa) VALUES ($1,'cisterna',$2)
     RETURNING vehiculo_id`, [empresa, `LIQ-${marca}`]);
  const [c] = await gestor().query(
    `INSERT INTO cisternas (empresa_id, vehiculo_id, capacidad_total) VALUES ($1,$2,10000)
     RETURNING cisterna_id`, [empresa, veh.vehiculo_id]);
  const [cc] = await gestor().query(
    `INSERT INTO compartimentos_cisterna
       (empresa_id, cisterna_id, numero, capacidad_nominal, capacidad_calibrada)
     VALUES ($1,$2,1,5000,4980) RETURNING compartimento_id`, [empresa, c.cisterna_id]);
  const km = opciones.km === undefined ? 300 : opciones.km;
  /* Diez horas de viaje y no cero: un viaje cerrado que empieza y termina en el
     mismo instante tiene el periodo VACÍO, que `ck_viajes_periodo_no_vacio`
     rechaza — no reservaría ni la cisterna ni el conductor. Cada viaje cae en
     su propio día (`secuencia`), así que no se pisan entre ellos. */
  const [v] = await gestor().query(
    `INSERT INTO viajes (empresa_id, codigo_viaje, tipo_viaje, cisterna_id, conductor_id,
                         fecha_programada, estado, fecha_inicio, fecha_fin,
                         odometro_inicial, odometro_final)
     VALUES ($1,$2,'simple',$3,$4,$5,$6,$5,$5::timestamptz + interval '10 hours',$7,$8) RETURNING viaje_id`,
    [empresa, `LIQ-${marca}`, c.cisterna_id, conductorId,
     new Date(Date.UTC(2035, 0, 1 + secuencia, 8)).toISOString(),
     opciones.estado ?? 'cerrado',
     km === null ? null : 100000, km === null ? null : 100000 + km]);
  return { id: String(v.viaje_id), compartimento: String(cc.compartimento_id) };
}

/** Una entrega aceptada (o del estado que se pida) sobre ese viaje. */
async function entrega(viajeId: string, compartimento: string, estado = 'aceptada') {
  const [o] = await gestor().query(
    `INSERT INTO ordenes_abastecimiento (empresa_id, cliente_id, estacion_id, estado)
     VALUES ($1,$2,$3,'en_transito') RETURNING orden_id`, [empresa, cliente, estacion]);
  const [d] = await gestor().query(
    `INSERT INTO detalles_orden (empresa_id, orden_id, producto_id, volumen_solicitado)
     VALUES ($1,$2,$3,5000) RETURNING detalle_orden_id`, [empresa, o.orden_id, producto]);
  await gestor().query(
    `INSERT INTO entregas (empresa_id, viaje_id, orden_id, detalle_orden_id, estacion_id,
                           producto_id, compartimento_id, volumen_cargado, volumen_recibido,
                           receptor_nombre, latitud, longitud, estado)
     VALUES ($1,$2,$3,$4,$5,$6,$7,1000,1000,'Receptor',8.98,-79.51,$8)`,
    [empresa, viajeId, o.orden_id, d.detalle_orden_id, estacion, producto, compartimento, estado]);
}

/** Un gasto ya aprobado del viaje. */
async function gastoAprobado(viajeId: string, monto: number, reembolsable: boolean) {
  await gestor().query(
    `INSERT INTO gastos_viaje (empresa_id, viaje_id, categoria, descripcion, monto,
                               pagado_por, reembolsable, estado, registrado_por,
                               aprobado_por, aprobado_en)
     VALUES ($1,$2,'peaje','Gasto de prueba',$3,$4,$5,'aprobado',$6,$7,now())`,
    [empresa, viajeId, monto, reembolsable ? 'conductor' : 'empresa', reembolsable,
     contable, jefe]);
}

beforeAll(async () => {
  await dueño.initialize();
  await app.initialize();
  const [e] = await dueño.query(
    `INSERT INTO empresas (nombre, ruc) VALUES ('Liquidaciones Test','LIQ-TEST')
     ON CONFLICT (ruc) DO UPDATE SET nombre = EXCLUDED.nombre RETURNING empresa_id`);
  empresa = String(e.empresa_id);
  for (const [nombre, correo, destino] of [
    ['Contable', 'liq-cont@ejemplo.test', 'contable'],
    ['Jefe', 'liq-jefe@ejemplo.test', 'jefe'],
    ['Tesorería', 'liq-teso@ejemplo.test', 'tesoreria'],
  ]) {
    const [u] = await dueño.query(
      `INSERT INTO usuarios (empresa_id, nombre, correo, hash_clave)
       VALUES ($1,$2,$3,'x') RETURNING usuario_id`, [empresa, nombre, correo]);
    if (destino === 'contable') contable = String(u.usuario_id);
    if (destino === 'jefe') jefe = String(u.usuario_id);
    if (destino === 'tesoreria') tesoreria = String(u.usuario_id);
  }
  // Tarifas del §10.7: base 50, 0,25 por km, 8 por entrega.
  const [cd] = await dueño.query(
    `INSERT INTO conductores (empresa_id, nombre_completo, documento, licencia,
                              tarifa_base, tarifa_km, tarifa_entrega)
     VALUES ($1,'Chofer Liq','LIQ-D1','LIQ-L1',50,0.25,8) RETURNING conductor_id`, [empresa]);
  conductorId = String(cd.conductor_id);
  const [cli] = await dueño.query(
    `INSERT INTO clientes (empresa_id, nombre) VALUES ($1,'Cliente Liq') RETURNING cliente_id`,
    [empresa]);
  cliente = String(cli.cliente_id);
  const [est] = await dueño.query(
    `INSERT INTO estaciones_servicio (empresa_id, cliente_id, nombre)
     VALUES ($1,$2,'Estación Liq') RETURNING estacion_id`, [empresa, cliente]);
  estacion = String(est.estacion_id);
  const [p] = await dueño.query(
    `INSERT INTO productos_combustible (empresa_id, codigo, nombre)
     VALUES ($1,'LIQ-95','Gasolina Liq') RETURNING producto_id`, [empresa]);
  producto = String(p.producto_id);
});

afterAll(async () => {
  for (const t of ['liquidaciones_conductor', 'gastos_viaje', 'entregas', 'viajes',
                   'detalles_orden', 'ordenes_abastecimiento', 'estaciones_servicio',
                   'clientes', 'productos_combustible', 'compartimentos_cisterna',
                   'cisternas', 'vehiculos', 'conductores', 'auditoria', 'usuarios']) {
    await dueño.query(`DELETE FROM ${t} WHERE empresa_id = $1`, [empresa]);
  }
  await dueño.query(`DELETE FROM empresas WHERE ruc = 'LIQ-TEST'`);
  await app.destroy();
  await dueño.destroy();
});

describe('calcular · la fórmula del §10.7 con números conocidos', () => {
  it('base + kilómetros + entregas, cada sumando por separado', async () => {
    // 300 km × 0,25 = 75 · 2 entregas × 8 = 16 · base 50 → total 141.
    await como(contable, async (s) => {
      const v = await viajeCerrado({ km: 300 });
      await entrega(v.id, v.compartimento);
      await entrega(v.id, v.compartimento);
      const l = await s.calcular(v.id, {});
      expect(Number(l.tarifaBase)).toBe(50);
      expect(Number(l.pagoKilometros)).toBe(75);
      expect(Number(l.pagoEntregas)).toBe(16);
      expect(Number(l.totalPagar)).toBe(141);
    });
  });

  it('sólo cuenta las entregas ACEPTADAS', async () => {
    // Pagar por una rechazada o pendiente es pagar por trabajo que nadie dio
    // todavía por bueno.
    await como(contable, async (s) => {
      const v = await viajeCerrado({ km: 0 });
      await entrega(v.id, v.compartimento, 'aceptada');
      await entrega(v.id, v.compartimento, 'pendiente');
      await entrega(v.id, v.compartimento, 'rechazada');
      const l = await s.calcular(v.id, {});
      expect(l.entregasContadas).toBe(1);
      expect(Number(l.pagoEntregas)).toBe(8);
    });
  });

  it('los reembolsos se DERIVAN de los gastos aprobados y reembolsables', async () => {
    // No se teclean: si se pudieran escribir, la liquidación reembolsaría un
    // importe que no corresponde a ningún gasto, y los dos apuntes parecerían
    // correctos por separado.
    await como(contable, async (s) => {
      const v = await viajeCerrado({ km: 0 });
      await gastoAprobado(v.id, 30, true);   // del conductor, se le devuelve
      await gastoAprobado(v.id, 200, false); // lo pagó la empresa, no se devuelve
      const l = await s.calcular(v.id, {});
      expect(Number(l.reembolsos)).toBe(30);
      expect(Number(l.totalPagar)).toBe(80); // 50 de base + 30
    });
  });

  it('un gasto reembolsable NO aprobado no se reembolsa', async () => {
    await como(contable, async (s) => {
      const v = await viajeCerrado({ km: 0 });
      await gestor().query(
        `INSERT INTO gastos_viaje (empresa_id, viaje_id, categoria, descripcion, monto,
                                   pagado_por, reembolsable, registrado_por)
         VALUES ($1,$2,'peaje','Sin aprobar',99,'conductor',true,$3)`,
        [empresa, v.id, contable]);
      const l = await s.calcular(v.id, {});
      expect(Number(l.reembolsos)).toBe(0);
    });
  });

  it('las penalizaciones RESTAN', async () => {
    await como(contable, async (s) => {
      const v = await viajeCerrado({ km: 400 });
      const l = await s.calcular(v.id, {
        viaticos: 25, bonificaciones: 10, penalizaciones: 40,
        motivoAjustes: 'Viáticos de ruta, bono por puntualidad, multa de tránsito',
      });
      // 50 + 100 + 0 + 0 + 25 + 10 − 40 = 145
      expect(Number(l.totalPagar)).toBe(145);
    });
  });

  it('un ajuste a mano sin motivo se rechaza', async () => {
    await como(contable, async (s) => {
      const v = await viajeCerrado();
      await expect(s.calcular(v.id, { bonificaciones: 100 }))
        .rejects.toThrow(/motivo/i);
    });
  });

  it('guarda con qué tarifas se calculó, para poder explicarlo después', async () => {
    // Una liquidación que se recalcula al leerla deja de ser un documento: si
    // mañana cambia la tarifa del conductor, «¿por qué le pagamos esto?» tiene
    // que seguir teniendo respuesta.
    await como(contable, async (s) => {
      const v = await viajeCerrado({ km: 200 });
      const l = await s.calcular(v.id, {});
      expect(Number(l.tarifaKmUsada)).toBe(0.25);
      expect(Number(l.tarifaEntregaUsada)).toBe(8);
      expect(Number(l.kilometros)).toBe(200);
    });
  });
});

describe('calcular · lo que no se liquida', () => {
  it('regla 12 · un viaje que no está cerrado no se liquida', async () => {
    await como(contable, async (s) => {
      const v = await viajeCerrado({ estado: 'retornando' });
      await expect(s.calcular(v.id, {})).rejects.toThrow(/sólo se liquida un viaje cerrado/);
    });
  });

  it('un viaje se liquida UNA vez', async () => {
    // Dos liquidaciones del mismo viaje es pagarlo dos veces, y el segundo
    // apunte se ve tan legítimo como el primero.
    await como(contable, async (s) => {
      const v = await viajeCerrado();
      await s.calcular(v.id, {});
      await expect(s.calcular(v.id, {}))
        .rejects.toThrow(/ya está liquidado/);
    });
  });

  it('sin odómetro no se pagan kilómetros, pero sí lo demás', async () => {
    await como(contable, async (s) => {
      const v = await viajeCerrado({ km: null });
      const l = await s.calcular(v.id, {});
      expect(l.kilometros).toBeNull();
      expect(Number(l.pagoKilometros)).toBe(0);
      expect(Number(l.totalPagar)).toBe(50);
    });
  });

  it('un viaje sin conductor no tiene a quién liquidar', async () => {
    await como(contable, async (s) => {
      const v = await viajeCerrado();
      await gestor().query(
        `UPDATE viajes SET conductor_id = NULL WHERE viaje_id = $1`, [v.id]);
      await expect(s.calcular(v.id, {})).rejects.toThrow(/no hay a quién liquidar/);
    });
  });

  it('un odómetro que retrocede no llega ni a existir', async () => {
    // Sin esta garantía el pago por kilómetros restaría del total y el número
    // final seguiría pareciendo razonable. Vive en `ck_viajes_odometro` —la
    // regla 10 del §11— y no en el servicio: comprobarlo también aquí sería
    // código que ninguna prueba puede alcanzar, o sea código que nadie sabrá si
    // sigue funcionando.
    await como(contable, async () => {
      const v = await viajeCerrado({ km: 100 });
      await expect(gestor().query(
        `UPDATE viajes SET odometro_final = odometro_inicial - 50 WHERE viaje_id = $1`,
        [v.id])).rejects.toThrow(/ck_viajes_odometro/);
    });
  });

  it('un viaje que no existe da 404', async () => {
    await como(contable, async (s) => {
      await expect(s.calcular('999999999', {})).rejects.toThrow(/no encontrado/i);
    });
  });
});

describe('aprobar y pagar · tres actos y tres personas', () => {
  it('quien la calculó no la aprueba', async () => {
    await como(contable, async (s) => {
      const v = await viajeCerrado();
      const l = await s.calcular(v.id, {});
      await expect(s.aprobar(String(l.id), {}))
        .rejects.toThrow(/no puede aprobarla/);
    });
  });

  it('otra persona sí, y queda quién y cuándo', async () => {
    await como(contable, async (s) => {
      const v = await viajeCerrado();
      const l = await s.calcular(v.id, {});
      const a = await otroUsuario(jefe, () => servicio.aprobar(String(l.id), {}));
      expect(a.estado).toBe('aprobada');
      expect(String(a.aprobadaPor)).toBe(jefe);
      expect(a.fechaAprobacion).not.toBeNull();
    });
  });

  it('no se paga lo que nadie ha aprobado', async () => {
    await como(contable, async (s) => {
      const v = await viajeCerrado();
      const l = await s.calcular(v.id, {});
      await expect(otroUsuario(tesoreria,
        () => servicio.pagar(String(l.id), { referenciaPago: 'TRF-001' })))
        .rejects.toThrow(/primero tiene que aprobarla/);
    });
  });

  it('pagar exige referencia: un pago sin comprobante no se rastrea', async () => {
    await como(contable, async (s) => {
      const v = await viajeCerrado();
      const l = await s.calcular(v.id, {});
      await otroUsuario(jefe, () => servicio.aprobar(String(l.id), {}));
      await expect(otroUsuario(tesoreria, () => servicio.pagar(String(l.id), {} as never)))
        .rejects.toThrow(/referencia/i);
    });
  });

  it('el recorrido completo deja las tres firmas y las dos fechas', async () => {
    await como(contable, async (s) => {
      const v = await viajeCerrado({ km: 100 });
      const l = await s.calcular(v.id, {});
      await otroUsuario(jefe, () => servicio.aprobar(String(l.id), {}));
      const pagada = await otroUsuario(tesoreria,
        () => servicio.pagar(String(l.id), { referenciaPago: 'TRF-2035-0001' }));

      expect(pagada.estado).toBe('pagada');
      expect(String(pagada.calculadaPor)).toBe(contable);
      expect(String(pagada.aprobadaPor)).toBe(jefe);
      expect(String(pagada.pagadaPor)).toBe(tesoreria);
      expect(pagada.fechaAprobacion).not.toBeNull();
      expect(pagada.fechaPago).not.toBeNull();
      expect(pagada.referenciaPago).toBe('TRF-2035-0001');
    });
  });

  it('una ya aprobada no se vuelve a aprobar', async () => {
    await como(contable, async (s) => {
      const v = await viajeCerrado();
      const l = await s.calcular(v.id, {});
      await otroUsuario(jefe, () => servicio.aprobar(String(l.id), {}));
      await expect(otroUsuario(tesoreria, () => servicio.aprobar(String(l.id), {})))
        .rejects.toThrow(/ya está "aprobada"/);
    });
  });

  it('una pagada no se vuelve a pagar', async () => {
    await como(contable, async (s) => {
      const v = await viajeCerrado();
      const l = await s.calcular(v.id, {});
      await otroUsuario(jefe, () => servicio.aprobar(String(l.id), {}));
      const pagar = () => otroUsuario(tesoreria,
        () => servicio.pagar(String(l.id), { referenciaPago: 'TRF-002' }));
      await pagar();
      await expect(pagar()).rejects.toThrow(/ya está pagada/);
    });
  });
});

describe('el total no se puede escribir a mano', () => {
  it('escribirlo directamente se rechaza', async () => {
    // Cierra la vía de aprobar un total que no sale de sus propios sumandos.
    // Va en su propia prueba porque un fallo de sentencia aborta la transacción
    // entera —comportamiento correcto de Postgres— y lo que venga detrás moriría
    // con «current transaction is aborted» en vez de con lo suyo.
    await como(contable, async (s) => {
      const v = await viajeCerrado({ km: 100 });
      const l = await s.calcular(v.id, {});
      expect(Number(l.totalPagar)).toBe(75); // 50 de base + 100 km × 0,25
      await expect(gestor().query(
        `UPDATE liquidaciones_conductor SET total_pagar = 99999 WHERE liquidacion_id = $1`,
        [l.id])).rejects.toThrow();
    });
  });

  it('cambiar un sumando SÍ lo mueve, que es la otra mitad de la garantía', async () => {
    await como(contable, async (s) => {
      const v = await viajeCerrado({ km: 100 });
      const l = await s.calcular(v.id, {});
      await gestor().query(
        `UPDATE liquidaciones_conductor SET bonificaciones = 25,
                motivo_ajustes = 'Bono de prueba' WHERE liquidacion_id = $1`, [l.id]);
      expect(Number((await s.obtener(String(l.id))).totalPagar)).toBe(100);
    });
  });
});

describe('listar', () => {
  it('por estado y por viaje', async () => {
    await como(contable, async (s) => {
      const v = await viajeCerrado();
      const l = await s.calcular(v.id, {});
      expect((await s.listar('pendiente')).length).toBeGreaterThanOrEqual(1);
      expect(String((await s.deViaje(v.id)).id)).toBe(String(l.id));
    });
  });

  it('un viaje sin liquidar lo dice', async () => {
    await como(contable, async (s) => {
      const v = await viajeCerrado();
      await expect(s.deViaje(v.id)).rejects.toThrow(/todavía no está liquidado/);
    });
  });
});
