import 'reflect-metadata';
import { config as cargarEnv } from 'dotenv';
import { DataSource } from 'typeorm';
import { join } from 'path';

import { ViajesService } from '../src/modules/viajes/viajes.service';
import { ejecutarEnContexto } from '../src/common/contexto/contexto-peticion';

cargarEnv({ path: join(__dirname, '../../.env') });

/**
 * Las reglas de `ViajesService` que la base de datos NO PUEDE hacer cumplir.
 *
 * `viajes` tiene seis restricciones CHECK y cero triggers, y una CHECK no ve el
 * valor anterior de la fila: puede exigir que el estado sea uno de los válidos,
 * nunca que la TRANSICIÓN lo sea. Todo lo que se prueba aquí vive únicamente en
 * el servicio, sin nada debajo que lo repita.
 *
 * Se ejercita el servicio de verdad —no un doble— contra un Postgres real, con
 * `ejecutarEnContexto` y un `EntityManager` transaccional. Un doble del gestor
 * sólo probaría que el doble devuelve lo que le pedimos; aquí el UPDATE ocurre,
 * la RLS se aplica y las restricciones de exclusión del §5.1 muerden igual que
 * en producción.
 *
 * Cada prueba corre en su propia transacción y termina con ROLLBACK, así que no
 * se pisan entre ellas ni dejan rastro.
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

const servicio = new ViajesService();

let empresa: string, usuario: string, cisterna: string, compartimento: string;
let conductor: string, detalleOrden: string, producto: string, orden: string;

/** Corre `fn` como lo haría una petición real: con contexto de empresa, un
 *  manager transaccional y RLS activa. Deshace todo al terminar. */
async function enServicio<T>(fn: (s: ViajesService) => Promise<T>): Promise<T> {
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

/** Un viaje listo para operar: con cisterna, conductor y plan de carga. */
async function viajeCompleto(s: ViajesService, estado = 'borrador') {
  const v = await s.crear({
    codigoViaje: `SRV-${Math.random().toString(36).slice(2, 9)}`,
    tipoViaje: 'simple',
    cisternaId: cisterna,
    conductorId: conductor,
    fechaProgramada: '2027-03-01T08:00:00Z',
  } as never);
  // El plan de carga sólo admite líneas de órdenes YA asignadas al viaje: una
  // línea que apunte a una orden ajena sería carga sin destinatario.
  await s.asignarOrden(String(v.id), { ordenId: orden, secuenciaEntrega: 1 } as never);
  await s.agregarLineaPlan(String(v.id), {
    compartimentoId: compartimento, detalleOrdenId: detalleOrden, volumenPlanificado: 1000,
  } as never);
  if (estado !== 'borrador') await forzarEstado(String(v.id), estado);
  return String(v.id);
}

/** Coloca el viaje en un estado concreto sin pasar por la máquina de estados,
 *  para poder probar QUÉ pasa desde ahí sin depender de todo el camino. */
async function forzarEstado(id: string, estado: string) {
  const { gestor } = await import('../src/common/contexto/contexto-peticion');
  await gestor().query(`UPDATE viajes SET estado = $2 WHERE viaje_id = $1`, [id, estado]);
}

beforeAll(async () => {
  await dueño.initialize();
  await app.initialize();

  const [e] = await dueño.query(
    `INSERT INTO empresas (nombre, ruc) VALUES ('Servicio Viajes Test','SRV-TEST')
     ON CONFLICT (ruc) DO UPDATE SET nombre = EXCLUDED.nombre RETURNING empresa_id`);
  empresa = String(e.empresa_id);

  const [u] = await dueño.query(
    `INSERT INTO usuarios (empresa_id, nombre, correo, hash_clave)
     VALUES ($1,'Despachador','srv-test@ejemplo.test','x') RETURNING usuario_id`, [empresa]);
  usuario = String(u.usuario_id);

  const [veh] = await dueño.query(
    `INSERT INTO vehiculos (empresa_id, tipo_vehiculo, placa) VALUES ($1,'cisterna','SRV-1')
     RETURNING vehiculo_id`, [empresa]);
  const [c] = await dueño.query(
    `INSERT INTO cisternas (empresa_id, vehiculo_id, capacidad_total) VALUES ($1,$2,10000)
     RETURNING cisterna_id`, [empresa, veh.vehiculo_id]);
  cisterna = String(c.cisterna_id);
  const [cc] = await dueño.query(
    `INSERT INTO compartimentos_cisterna
       (empresa_id, cisterna_id, numero, capacidad_nominal, capacidad_calibrada)
     VALUES ($1,$2,1,5000,4980) RETURNING compartimento_id`, [empresa, cisterna]);
  compartimento = String(cc.compartimento_id);

  const [cd] = await dueño.query(
    `INSERT INTO conductores (empresa_id, nombre_completo, documento, licencia)
     VALUES ($1,'Chofer Srv','SRV-D1','SRV-L1') RETURNING conductor_id`, [empresa]);
  conductor = String(cd.conductor_id);

  const [cli] = await dueño.query(
    `INSERT INTO clientes (empresa_id, nombre) VALUES ($1,'Cliente Srv') RETURNING cliente_id`, [empresa]);
  const [est] = await dueño.query(
    `INSERT INTO estaciones_servicio (empresa_id, cliente_id, nombre)
     VALUES ($1,$2,'Estación Srv') RETURNING estacion_id`, [empresa, cli.cliente_id]);
  const [p] = await dueño.query(
    `INSERT INTO productos_combustible (empresa_id, codigo, nombre)
     VALUES ($1,'SRV-95','Gasolina 95') RETURNING producto_id`, [empresa]);
  producto = String(p.producto_id);
  const [o] = await dueño.query(
    `INSERT INTO ordenes_abastecimiento (empresa_id, cliente_id, estacion_id, estado)
     VALUES ($1,$2,$3,'validada') RETURNING orden_id`, [empresa, cli.cliente_id, est.estacion_id]);
  orden = String(o.orden_id);
  const [d] = await dueño.query(
    `INSERT INTO detalles_orden (empresa_id, orden_id, producto_id, volumen_solicitado)
     VALUES ($1,$2,$3,5000) RETURNING detalle_orden_id`, [empresa, o.orden_id, producto]);
  detalleOrden = String(d.detalle_orden_id);
});

afterAll(async () => {
  for (const t of ['plan_carga', 'viaje_ordenes', 'viajes', 'detalles_orden',
                   'ordenes_abastecimiento', 'estaciones_servicio', 'clientes',
                   'productos_combustible', 'compartimentos_cisterna', 'cisternas',
                   'vehiculos', 'conductores', 'auditoria', 'usuarios']) {
    await dueño.query(`DELETE FROM ${t} WHERE empresa_id = $1`, [empresa]);
  }
  await dueño.query(`DELETE FROM empresas WHERE ruc = 'SRV-TEST'`);
  await app.destroy();
  await dueño.destroy();
});

describe('cambiarEstado · la máquina que la base no puede vigilar', () => {
  it('rechaza un salto que no está en el flujo', async () => {
    await enServicio(async s => {
      const id = await viajeCompleto(s);
      // borrador → cargando se salta media operación: el camión estaría
      // cargando sin haber sido autorizado ni haber llegado a la terminal.
      await expect(s.cambiarEstado(id, { estado: 'cargando' } as never))
        .rejects.toThrow(/No se puede pasar de "borrador" a "cargando"/);
    });
  });

  it('el mensaje del rechazo dice cuáles SÍ se puede, no sólo que no', async () => {
    // Un «no se puede» a secas obliga a leer el código para saber qué hacer.
    await enServicio(async s => {
      const id = await viajeCompleto(s);
      await expect(s.cambiarEstado(id, { estado: 'cargando' } as never))
        .rejects.toThrow(/Posibles: programado, cancelado/);
    });
  });

  it('desde un estado final no se sale, y lo dice como tal', async () => {
    await enServicio(async s => {
      const id = await viajeCompleto(s, 'cerrado');
      await expect(s.cambiarEstado(id, { estado: 'programado' } as never))
        .rejects.toThrow(/"cerrado" es un estado final/);
    });
  });

  it('cancelar sin motivo se rechaza', async () => {
    // El motivo es lo único que queda para entender, meses después, por qué un
    // viaje no ocurrió.
    await enServicio(async s => {
      const id = await viajeCompleto(s);
      await expect(s.cambiarEstado(id, { estado: 'cancelado' } as never))
        .rejects.toThrow(/exige indicar el motivo/);
    });
  });

  it('cancelar con motivo se acepta y el motivo queda guardado', async () => {
    await enServicio(async s => {
      const id = await viajeCompleto(s);
      const v = await s.cambiarEstado(id, { estado: 'cancelado', motivo: 'Avería del cabezal' } as never);
      expect(v.estado).toBe('cancelado');
      expect(v.motivoCancelacion).toBe('Avería del cabezal');
    });
  });

  it('no deja salir a la terminal sin plan de carga', async () => {
    // Sería un camión yendo a cargar sin saber qué recoger ni para quién.
    await enServicio(async s => {
      const v = await s.crear({
        codigoViaje: `SRV-SINPLAN-${Math.random().toString(36).slice(2, 7)}`,
        tipoViaje: 'simple', cisternaId: cisterna, conductorId: conductor,
        fechaProgramada: '2027-04-01T08:00:00Z',
      } as never);
      await forzarEstado(String(v.id), 'autorizado');
      await expect(s.cambiarEstado(String(v.id), { estado: 'desplazamiento_terminal' } as never))
        .rejects.toThrow(/no tiene plan de carga/);
    });
  });

  it('la hora de salida la pone el SISTEMA, no quien llama', async () => {
    // Una fecha de inicio que viniera del cliente se puede falsear, y de ella
    // cuelgan los cálculos de duración y de retraso.
    await enServicio(async s => {
      const id = await viajeCompleto(s, 'autorizado');
      const antes = await s.obtener(id);
      expect(antes.fechaInicio).toBeNull();

      const despues = await s.cambiarEstado(id, { estado: 'desplazamiento_terminal' } as never);
      expect(despues.fechaInicio).not.toBeNull();
      expect(Math.abs(Date.now() - new Date(despues.fechaInicio).getTime())).toBeLessThan(60_000);
    });
  });
});

describe('actualizar · un viaje en marcha ya no se replanifica', () => {
  it('rechaza cambiar la cisterna cuando el camión ya salió', async () => {
    await enServicio(async s => {
      const id = await viajeCompleto(s, 'transito_estacion');
      await expect(s.actualizar(id, { cisternaId: cisterna } as never))
        .rejects.toThrow(/ya no admite cambios de asignación ni de fecha/);
    });
  });

  it('rechaza también el conductor y la fecha, no sólo la cisterna', async () => {
    await enServicio(async s => {
      const id = await viajeCompleto(s, 'cargando');
      await expect(s.actualizar(id, { conductorId: conductor } as never)).rejects.toThrow(/ya no admite/);
      await expect(s.actualizar(id, { fechaProgramada: '2027-05-01T08:00:00Z' } as never))
        .rejects.toThrow(/ya no admite/);
    });
  });

  it('SÍ deja registrar el odómetro con el viaje en marcha', async () => {
    // El límite es la replanificación, no toda edición: el odómetro final se
    // captura justamente cuando el viaje ya terminó de rodar.
    await enServicio(async s => {
      const id = await viajeCompleto(s, 'pendiente_liquidacion');
      const v = await s.actualizar(id, { odometroFinal: 123456 } as never);
      expect(Number(v.odometroFinal)).toBe(123456);
    });
  });

  it('en planificación se puede cambiar todo', async () => {
    await enServicio(async s => {
      const id = await viajeCompleto(s, 'programado');
      const v = await s.actualizar(id, { fechaProgramada: '2027-06-01T08:00:00Z' } as never);
      expect(new Date(v.fechaProgramada).getUTCMonth()).toBe(5);
    });
  });
});

describe('autorizar · la separación entre quien planifica y quien deja salir', () => {
  it('sólo desde `programado`', async () => {
    await enServicio(async s => {
      const id = await viajeCompleto(s);   // queda en borrador
      await expect(s.autorizar(id)).rejects.toThrow(/Solo se autoriza un viaje "programado"/);
    });
  });

  it('exige plan de carga', async () => {
    await enServicio(async s => {
      const v = await s.crear({
        codigoViaje: `SRV-AUT-${Math.random().toString(36).slice(2, 7)}`,
        tipoViaje: 'simple', cisternaId: cisterna, conductorId: conductor,
        fechaProgramada: '2027-07-01T08:00:00Z',
      } as never);
      await forzarEstado(String(v.id), 'programado');
      await expect(s.autorizar(String(v.id))).rejects.toThrow(/no tiene plan de carga/);
    });
  });

  it('exige conductor asignado', async () => {
    await enServicio(async s => {
      const id = await viajeCompleto(s, 'programado');
      await s.actualizar(id, { conductorId: null } as never);
      await expect(s.autorizar(id)).rejects.toThrow(/necesita cisterna y conductor/);
    });
  });

  it('NO se puede quitar la cisterna a un viaje que ya tiene plan de carga', async () => {
    // `actualizar` aceptaba `cisternaId: null` —`@IsOptional()` de
    // class-validator deja pasar el nulo explícito— y lo escribía. El viaje se
    // quedaba con líneas de plan apuntando a compartimentos de una cisterna que
    // ya no era suya: un estado incoherente que sólo se cazaba tres pasos
    // después, al autorizar.
    //
    // Se rechaza en el origen. Quitar la cisterna exige vaciar el plan primero,
    // que es la única forma de que las dos cosas sigan diciendo lo mismo.
    await enServicio(async s => {
      const id = await viajeCompleto(s, 'programado');
      await expect(s.actualizar(id, { cisternaId: null } as never))
        .rejects.toThrow(/plan de carga/i);

      const intacto = await s.obtener(id);
      expect(intacto.cisternaId).not.toBeNull();
    });
  });

  it('sin plan de carga, quitar la cisterna sí se permite', async () => {
    // El límite es la incoherencia, no la edición: un viaje en planificación al
    // que todavía no se le ha asignado carga puede cambiar de idea.
    await enServicio(async s => {
      const v = await s.crear({
        codigoViaje: `SRV-LIBRE-${Math.random().toString(36).slice(2, 7)}`,
        tipoViaje: 'simple', cisternaId: cisterna, conductorId: conductor,
        fechaProgramada: '2027-11-01T08:00:00Z',
      } as never);
      const sinCisterna = await s.actualizar(String(v.id), { cisternaId: null } as never);
      expect(sinCisterna.cisternaId).toBeNull();
    });
  });

  it('deja constancia de QUIÉN autorizó', async () => {
    // Es el control del §8.2: quien planifica no autoriza. Sin el nombre
    // guardado, el control existe en los permisos y desaparece en la traza.
    await enServicio(async s => {
      const id = await viajeCompleto(s, 'programado');
      const v = await s.autorizar(id);
      expect(v.estado).toBe('autorizado');
      expect(String(v.autorizadoPor)).toBe(usuario);
    });
  });
});

describe('el solapamiento del §5.1 llega como error de negocio, no como 500', () => {
  it('traduce el 23P01 de Postgres a un conflicto legible', async () => {
    // Sin esta traducción, «esa cisterna ya está ocupada» —que es una respuesta
    // normal del negocio— le llegaría a la interfaz como un error interno.
    await enServicio(async s => {
      await s.crear({
        codigoViaje: `SRV-OC1-${Math.random().toString(36).slice(2, 7)}`,
        tipoViaje: 'simple', cisternaId: cisterna,
        fechaProgramada: '2027-09-01T08:00:00Z', fechaFin: '2027-09-01T18:00:00Z',
      } as never);
      await expect(s.crear({
        codigoViaje: `SRV-OC2-${Math.random().toString(36).slice(2, 7)}`,
        tipoViaje: 'simple', cisternaId: cisterna,
        fechaProgramada: '2027-09-01T12:00:00Z', fechaFin: '2027-09-01T20:00:00Z',
      } as never)).rejects.toThrow(/La cisterna ya tiene otro viaje que se superpone/);
    });
  });

  it('distingue si el que choca es el conductor', async () => {
    await enServicio(async s => {
      await s.crear({
        codigoViaje: `SRV-OC3-${Math.random().toString(36).slice(2, 7)}`,
        tipoViaje: 'simple', conductorId: conductor,
        fechaProgramada: '2027-10-01T08:00:00Z', fechaFin: '2027-10-01T18:00:00Z',
      } as never);
      await expect(s.crear({
        codigoViaje: `SRV-OC4-${Math.random().toString(36).slice(2, 7)}`,
        tipoViaje: 'simple', conductorId: conductor,
        fechaProgramada: '2027-10-01T12:00:00Z', fechaFin: '2027-10-01T20:00:00Z',
      } as never)).rejects.toThrow(/El conductor ya tiene otro viaje que se superpone/);
    });
  });
});

describe('los estados viven en DOS sitios y tienen que decir lo mismo', () => {
  it('la máquina de estados y la restricción CHECK de la base coinciden exactamente', async () => {
    // FLUJO_VIAJE está en TypeScript y `ck_viajes_estado` en la migración.
    // Nada los mantiene sincronizados. Si alguien añade un estado al código y
    // olvida la migración, el UPDATE revienta con un error de restricción en
    // producción —no en desarrollo, donde nadie llega a ese estado—; y al
    // revés, un estado que sólo existe en la base es un camino muerto que la
    // aplicación nunca podrá recorrer.
    const { FLUJO_VIAJE } = await import('../src/modules/viajes/estados');

    const [{ def }] = await dueño.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'ck_viajes_estado'`);
    const enLaBase = [...String(def).matchAll(/'([a-z_]+)'::character varying/g)]
      .map(m => m[1]).sort();

    expect(Object.keys(FLUJO_VIAJE).sort()).toEqual(enLaBase);
  });
});
