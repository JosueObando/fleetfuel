import 'reflect-metadata';
import { config as cargarEnv } from 'dotenv';
import { DataSource } from 'typeorm';
import { join } from 'path';

import { GastosService } from '../src/modules/gastos/gastos.service';
import { ejecutarEnContexto, gestor } from '../src/common/contexto/contexto-peticion';

cargarEnv({ path: join(__dirname, '../../.env') });

/**
 * §7.17 · Gastos de viaje.
 *
 * Segundo entregable de la Fase 1C. Se construye antes de la compuerta 🏁
 * porque el PRD lo fija entero —once campos, cinco categorías, y el §5 dice
 * quién lo captura— mientras que las liquidaciones, que son lo que la compuerta
 * protege, siguen esperando.
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

const servicio = new GastosService();
let empresa: string, conductor: string, supervisor: string;
let cisterna: string, conductorId: string;
let secuencia = 0, ultimoViaje: string | null = null;

async function como<T>(usuarioId: string, fn: (s: GastosService) => Promise<T>) {
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
    ultimoViaje = null;
  }
}

async function viaje(estado = 'retornando'): Promise<string> {
  if (ultimoViaje) {
    await gestor().query(
      `UPDATE viajes SET estado='cerrado', fecha_fin = fecha_programada + interval '4 hours'
        WHERE viaje_id = $1`, [ultimoViaje]);
  }
  const [v] = await gestor().query(
    `INSERT INTO viajes (empresa_id, codigo_viaje, tipo_viaje, cisterna_id, conductor_id,
                         fecha_programada, estado)
     VALUES ($1,$2,'simple',$3,$4,$5,$6) RETURNING viaje_id`,
    [empresa, `GAS-${Math.random().toString(36).slice(2, 9)}`, cisterna, conductorId,
     new Date(Date.UTC(2032, 0, 1 + secuencia++, 8)).toISOString(), estado]);
  ultimoViaje = String(v.viaje_id);
  return ultimoViaje;
}

const gasto = (extra: Record<string, unknown> = {}) => ({
  categoria: 'peaje', descripcion: 'Peaje de la Vía Panamericana',
  monto: 12.5, pagadoPor: 'conductor', reembolsable: true, ...extra,
});

/** Aprueba o rechaza como el supervisor, dentro de la misma transacción. */
const resolverComoSupervisor = (id: string, estado: string, motivo: string) =>
  ejecutarEnContexto(
    { empresaId: empresa, usuarioId: supervisor, manager: gestor(), cambios: [] },
    () => servicio.resolver(id, { estado, motivo }),
  );

beforeAll(async () => {
  await dueño.initialize();
  await app.initialize();
  const [e] = await dueño.query(
    `INSERT INTO empresas (nombre, ruc) VALUES ('Gastos Test','GAS-TEST')
     ON CONFLICT (ruc) DO UPDATE SET nombre = EXCLUDED.nombre RETURNING empresa_id`);
  empresa = String(e.empresa_id);
  const [u1] = await dueño.query(
    `INSERT INTO usuarios (empresa_id, nombre, correo, hash_clave)
     VALUES ($1,'Conductor','gas-cond@ejemplo.test','x') RETURNING usuario_id`, [empresa]);
  conductor = String(u1.usuario_id);
  const [u2] = await dueño.query(
    `INSERT INTO usuarios (empresa_id, nombre, correo, hash_clave)
     VALUES ($1,'Supervisor','gas-sup@ejemplo.test','x') RETURNING usuario_id`, [empresa]);
  supervisor = String(u2.usuario_id);
  const [veh] = await dueño.query(
    `INSERT INTO vehiculos (empresa_id, tipo_vehiculo, placa) VALUES ($1,'cisterna','GAS-1')
     RETURNING vehiculo_id`, [empresa]);
  const [c] = await dueño.query(
    `INSERT INTO cisternas (empresa_id, vehiculo_id, capacidad_total) VALUES ($1,$2,10000)
     RETURNING cisterna_id`, [empresa, veh.vehiculo_id]);
  cisterna = String(c.cisterna_id);
  const [cd] = await dueño.query(
    `INSERT INTO conductores (empresa_id, nombre_completo, documento, licencia)
     VALUES ($1,'Chofer Gas','GAS-D1','GAS-L1') RETURNING conductor_id`, [empresa]);
  conductorId = String(cd.conductor_id);
});

afterAll(async () => {
  for (const t of ['gastos_viaje', 'viajes', 'cisternas', 'vehiculos', 'conductores',
                   'auditoria', 'usuarios']) {
    await dueño.query(`DELETE FROM ${t} WHERE empresa_id = $1`, [empresa]);
  }
  await dueño.query(`DELETE FROM empresas WHERE ruc = 'GAS-TEST'`);
  await app.destroy();
  await dueño.destroy();
});

describe('registrar · las cinco categorías del §7.17 y nada más', () => {
  it('acepta las cinco', async () => {
    await como(conductor, async (s) => {
      for (const categoria of ['peaje', 'viatico', 'reparacion', 'estacionamiento', 'otro']) {
        const g = await s.registrar(await viaje(), gasto({ categoria }));
        expect(g.categoria).toBe(categoria);
        expect(g.estado).toBe('pendiente');
      }
    });
  });

  it('rechaza una categoría inventada', async () => {
    await como(conductor, async (s) => {
      await expect(s.registrar(await viaje(), gasto({ categoria: 'propina' }) as never))
        .rejects.toThrow();
    });
  });

  it('nace pendiente y con quién lo registró', async () => {
    await como(conductor, async (s) => {
      const g = await s.registrar(await viaje(), gasto());
      expect(g.estado).toBe('pendiente');
      expect(String(g.registradoPor)).toBe(conductor);
      expect(g.aprobadoPor).toBeNull();
    });
  });

  it('un gasto de cero no es un gasto', async () => {
    await como(conductor, async (s) => {
      await expect(s.registrar(await viaje(), gasto({ monto: 0 }) as never)).rejects.toThrow();
    });
  });

  it('después del cierre se corrige, no se añade', async () => {
    // Regla 12: no se paga una liquidación sin el viaje cerrado. Si tras cerrar
    // siguieran entrando gastos, lo ya liquidado dejaría de cuadrar.
    await como(conductor, async (s) => {
      await expect(s.registrar(await viaje('cerrado'), gasto() as never))
        .rejects.toThrow(/posterior al cierre/);
    });
  });

  it('un viaje que no existe da 404', async () => {
    await como(conductor, async (s) => {
      await expect(s.registrar('999999999', gasto() as never)).rejects.toThrow(/no encontrado/i);
    });
  });
});

describe('lo que pagó la empresa NO se reembolsa', () => {
  it('el servicio lo rechaza con su razón', async () => {
    // Pagarlo dos veces: los dos apuntes son correctos por separado, y por eso
    // ninguna revisión de importes lo encuentra.
    await como(conductor, async (s) => {
      await expect(s.registrar(await viaje(),
        gasto({ pagadoPor: 'empresa', reembolsable: true }) as never))
        .rejects.toThrow(/se estaría pagando dos veces/);
    });
  });

  it('y la base también, venga por donde venga', async () => {
    await como(conductor, async () => {
      const v = await viaje();
      await expect(gestor().query(
        `INSERT INTO gastos_viaje (empresa_id, viaje_id, categoria, descripcion, monto,
                                   pagado_por, reembolsable, registrado_por)
         VALUES ($1,$2,'peaje','Colado por SQL',10,'empresa',true,$3)`,
        [empresa, v, conductor])).rejects.toThrow(/ck_gastos_reembolso/);
    });
  });

  it('pagado por la empresa y sin reembolso sí vale', async () => {
    await como(conductor, async (s) => {
      const g = await s.registrar(await viaje(),
        gasto({ pagadoPor: 'empresa', reembolsable: false }));
      expect(g.pagadoPor).toBe('empresa');
      expect(g.reembolsable).toBe(false);
    });
  });
});

describe('resolver · quien lo registra no lo aprueba', () => {
  it('el mismo usuario no puede aprobarse su gasto', async () => {
    await como(conductor, async (s) => {
      const g = await s.registrar(await viaje(), gasto());
      await expect(s.resolver(String(g.id), { estado: 'aprobado', motivo: 'me lo apruebo' }))
        .rejects.toThrow(/no puede aprobarlo/);
    });
  });

  it('otro sí, y queda quién, cuándo y por qué', async () => {
    await como(conductor, async (s) => {
      const g = await s.registrar(await viaje(), gasto());
      const r = await resolverComoSupervisor(String(g.id), 'aprobado', 'Comprobante verificado');
      expect(r.estado).toBe('aprobado');
      expect(String(r.aprobadoPor)).toBe(supervisor);
      expect(r.aprobadoEn).not.toBeNull();
      expect(r.motivoResolucion).toBe('Comprobante verificado');
    });
  });

  it('rechazar exige motivo', async () => {
    await como(conductor, async (s) => {
      const g = await s.registrar(await viaje(), gasto());
      await expect(ejecutarEnContexto(
        { empresaId: empresa, usuarioId: supervisor, manager: gestor(), cambios: [] },
        () => servicio.resolver(String(g.id), { estado: 'rechazado' } as never),
      )).rejects.toThrow(/motivo/i);
    });
  });

  it('lo ya resuelto no se vuelve a resolver', async () => {
    await como(conductor, async (s) => {
      const g = await s.registrar(await viaje(), gasto());
      await resolverComoSupervisor(String(g.id), 'rechazado', 'Sin comprobante');
      await expect(resolverComoSupervisor(String(g.id), 'aprobado', 'Ahora sí'))
        .rejects.toThrow(/ya está/);
    });
  });
});

describe('totales · lo que de verdad costó el viaje', () => {
  it('sólo suma lo APROBADO', async () => {
    // Un total que incluya lo que nadie aprobó es un número que parece un costo
    // y todavía no lo es.
    await como(conductor, async (s) => {
      const v = await viaje();
      const a = await s.registrar(v, gasto({ monto: 100, reembolsable: false }));
      await s.registrar(v, gasto({ monto: 55, reembolsable: false }));
      await resolverComoSupervisor(String(a.id), 'aprobado', 'Verificado');

      const t = await s.totales(v);
      expect(Number(t.totalAprobado)).toBe(100);
      expect(Number(t.totalPendiente)).toBe(55);
      expect(Number(t.cuantosPendientes)).toBe(1);
    });
  });

  it('un gasto rechazado no cuenta en ningún total', async () => {
    await como(conductor, async (s) => {
      const v = await viaje();
      const g = await s.registrar(v, gasto({ monto: 80, reembolsable: false }));
      await resolverComoSupervisor(String(g.id), 'rechazado', 'Duplicado');
      const t = await s.totales(v);
      expect(Number(t.totalAprobado)).toBe(0);
      expect(Number(t.totalPendiente)).toBe(0);
    });
  });

  it('lo reembolsable va APARTE: es deuda con el conductor, no costo del viaje', async () => {
    // Sumarlos daría un costo inflado y una deuda perdida. Es el número del que
    // la liquidación del §10.6 va a tirar, así que conviene que signifique una
    // sola cosa desde el principio.
    await como(conductor, async (s) => {
      const v = await viaje();
      const empresaPago = await s.registrar(v,
        gasto({ monto: 200, pagadoPor: 'empresa', reembolsable: false }));
      const conductorPuso = await s.registrar(v,
        gasto({ monto: 30, pagadoPor: 'conductor', reembolsable: true }));
      await resolverComoSupervisor(String(empresaPago.id), 'aprobado', 'Factura al día');
      await resolverComoSupervisor(String(conductorPuso.id), 'aprobado', 'Con recibo');

      const t = await s.totales(v);
      expect(Number(t.totalAprobado)).toBe(230);
      expect(Number(t.reembolsableAlConductor)).toBe(30);
    });
  });

  it('un viaje sin gastos da ceros y no null', async () => {
    // Un `null` aquí obligaría a cada consumidor a acordarse; y el que se
    // olvide pintará «NaN» en un informe financiero.
    await como(conductor, async (s) => {
      const t = await s.totales(await viaje());
      expect(Number(t.totalAprobado)).toBe(0);
      expect(Number(t.reembolsableAlConductor)).toBe(0);
      expect(Number(t.cuantosPendientes)).toBe(0);
    });
  });
});

describe('listar', () => {
  it('los del viaje y los pendientes de la empresa', async () => {
    await como(conductor, async (s) => {
      const v = await viaje();
      await s.registrar(v, gasto({ monto: 10 }));
      await s.registrar(v, gasto({ monto: 20, categoria: 'viatico' }));
      expect(await s.listarDeViaje(v)).toHaveLength(2);
      expect((await s.pendientes()).length).toBeGreaterThanOrEqual(2);
    });
  });

  it('uno que no existe da 404', async () => {
    await como(conductor, async (s) => {
      await expect(s.obtener('999999999')).rejects.toThrow(/no encontrado/i);
    });
  });
});
