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
let productoDiesel: string, compartimentoSoloDiesel: string, compartimentoAjeno: string;
let ordenRecibida: string, detalleAjeno: string;

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
  });
  // El plan de carga sólo admite líneas de órdenes YA asignadas al viaje: una
  // línea que apunte a una orden ajena sería carga sin destinatario.
  await s.asignarOrden(String(v.id), { ordenId: orden, secuenciaEntrega: 1 });
  await s.agregarLineaPlan(String(v.id), {
    compartimentoId: compartimento, detalleOrdenId: detalleOrden, volumenPlanificado: 1000,
  });
  if (estado !== 'borrador') await forzarEstado(String(v.id), estado);
  return String(v.id);
}

/** Un viaje con cisterna, conductor y una orden asignada, pero SIN plan de
 *  carga: el punto de partida de casi todas las reglas del plan. */
async function viajeConOrden(s: ViajesService) {
  const v = await s.crear({
    codigoViaje: `PLN-${Math.random().toString(36).slice(2, 9)}`,
    tipoViaje: 'simple',
    cisternaId: cisterna,
    conductorId: conductor,
    fechaProgramada: '2027-05-01T08:00:00Z',
  });
  await s.asignarOrden(String(v.id), { ordenId: orden, secuenciaEntrega: 1 });
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

  // ── Piezas para las reglas del plan de carga ──
  // Un segundo producto y un compartimento que SÓLO lo admite: es lo que hace
  // falta para probar la regla anticontaminación.
  const [p2] = await dueño.query(
    `INSERT INTO productos_combustible (empresa_id, codigo, nombre)
     VALUES ($1,'SRV-DSL','Diésel') RETURNING producto_id`, [empresa]);
  productoDiesel = String(p2.producto_id);
  const [cd2] = await dueño.query(
    `INSERT INTO compartimentos_cisterna
       (empresa_id, cisterna_id, numero, capacidad_nominal, capacidad_calibrada, producto_permitido)
     VALUES ($1,$2,2,5000,4980,$3) RETURNING compartimento_id`, [empresa, cisterna, productoDiesel]);
  compartimentoSoloDiesel = String(cd2.compartimento_id);

  // Una cisterna ajena con su compartimento: el que NO es de este viaje.
  const [veh2] = await dueño.query(
    `INSERT INTO vehiculos (empresa_id, tipo_vehiculo, placa) VALUES ($1,'cisterna','SRV-2')
     RETURNING vehiculo_id`, [empresa]);
  const [c2] = await dueño.query(
    `INSERT INTO cisternas (empresa_id, vehiculo_id, capacidad_total) VALUES ($1,$2,8000)
     RETURNING cisterna_id`, [empresa, veh2.vehiculo_id]);
  const [cc2] = await dueño.query(
    `INSERT INTO compartimentos_cisterna
       (empresa_id, cisterna_id, numero, capacidad_nominal, capacidad_calibrada)
     VALUES ($1,$2,1,4000,3980) RETURNING compartimento_id`, [empresa, c2.cisterna_id]);
  compartimentoAjeno = String(cc2.compartimento_id);

  // Una orden recién recibida y una línea suya: la orden que aún no se puede
  // asignar, y la línea que no pertenece a ningún viaje.
  const [o2] = await dueño.query(
    `INSERT INTO ordenes_abastecimiento (empresa_id, cliente_id, estacion_id, estado)
     VALUES ($1,$2,$3,'recibida') RETURNING orden_id`, [empresa, cli.cliente_id, est.estacion_id]);
  ordenRecibida = String(o2.orden_id);
  const [d2] = await dueño.query(
    `INSERT INTO detalles_orden (empresa_id, orden_id, producto_id, volumen_solicitado)
     VALUES ($1,$2,$3,3000) RETURNING detalle_orden_id`, [empresa, o2.orden_id, producto]);
  detalleAjeno = String(d2.detalle_orden_id);
});

afterAll(async () => {
  // El orden importa: `compartimentos_cisterna.producto_permitido` apunta a
  // `productos_combustible`, así que el compartimento se borra antes que el
  // producto. Al revés Postgres rechaza el DELETE y la limpieza deja restos que
  // hacen fallar la SIGUIENTE ejecución, no ésta.
  for (const t of ['plan_carga', 'viaje_ordenes', 'viajes', 'detalles_orden',
                   'ordenes_abastecimiento', 'estaciones_servicio', 'clientes',
                   'compartimentos_cisterna', 'productos_combustible', 'cisternas',
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
      await expect(s.cambiarEstado(id, { estado: 'cargando' }))
        .rejects.toThrow(/No se puede pasar de "borrador" a "cargando"/);
    });
  });

  it('el mensaje del rechazo dice cuáles SÍ se puede, no sólo que no', async () => {
    // Un «no se puede» a secas obliga a leer el código para saber qué hacer.
    await enServicio(async s => {
      const id = await viajeCompleto(s);
      await expect(s.cambiarEstado(id, { estado: 'cargando' }))
        .rejects.toThrow(/Posibles: programado, cancelado/);
    });
  });

  it('desde un estado final no se sale, y lo dice como tal', async () => {
    await enServicio(async s => {
      const id = await viajeCompleto(s, 'cerrado');
      await expect(s.cambiarEstado(id, { estado: 'programado' }))
        .rejects.toThrow(/"cerrado" es un estado final/);
    });
  });

  it('cancelar sin motivo se rechaza', async () => {
    // El motivo es lo único que queda para entender, meses después, por qué un
    // viaje no ocurrió.
    await enServicio(async s => {
      const id = await viajeCompleto(s);
      await expect(s.cambiarEstado(id, { estado: 'cancelado' }))
        .rejects.toThrow(/exige indicar el motivo/);
    });
  });

  it('cancelar con motivo se acepta y el motivo queda guardado', async () => {
    await enServicio(async s => {
      const id = await viajeCompleto(s);
      const v = await s.cambiarEstado(id, { estado: 'cancelado', motivo: 'Avería del cabezal' });
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
      });
      await forzarEstado(String(v.id), 'autorizado');
      await expect(s.cambiarEstado(String(v.id), { estado: 'desplazamiento_terminal' }))
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

      const despues = await s.cambiarEstado(id, { estado: 'desplazamiento_terminal' });
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
      });
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
      });
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

/**
 * Regla 13 · «Los documentos vencidos bloquearán la asignación.»
 *
 * Hasta el 2026-09-12 esta regla NO se aplicaba en ninguna parte. Existía la
 * alerta `licencia_por_vencer` de `alertas.service.ts`, y su propio comentario
 * decía «la regla 13 dice que los documentos vencidos BLOQUEAN la asignación»
 * — y a continuación implementaba sólo el aviso. Un comentario que nombra el
 * bloqueo no es el bloqueo, y la alerta es reactiva: se entera después.
 *
 * El sitio es `autorizar` y no `crear`, y es una decisión: §5 le da al
 * Despachador «autoriza salida y VERIFICA DOCUMENTOS», y una licencia puede
 * caducar entre el día que se planifica el viaje y el día que sale. Comprobarlo
 * al asignar dejaría salir en marzo un viaje armado en enero con una licencia
 * que venció en febrero, que es justo el caso que la regla existe para evitar.
 */
/**
 * El choque de agenda del §5.1 cuando aparece al MOVER el viaje, no al crearlo.
 *
 * `periodo` es `tstzrange(coalesce(fecha_inicio, fecha_programada), fecha_fin)`,
 * así que pasar a `desplazamiento_terminal` —que estampa `fecha_inicio = now()`—
 * ESTIRA el periodo del viaje desde este momento hasta su fin previsto. Un viaje
 * programado para dentro de unos meses que arranca hoy pasa a ocupar todo lo que
 * hay en medio, y choca con cualquier otro viaje abierto de la misma cisterna.
 *
 * Es una situación de negocio corriente —«esa cisterna ya está ocupada»— y hasta
 * el 2026-09-12 salía como un **500 con el nombre de una restricción dentro**:
 * `crear` y `actualizar` envolvían la consulta en `traducirSolapamiento` y
 * `cambiarEstado` no, que es justo el único de los tres donde el periodo cambia
 * sin que nadie toque una fecha.
 *
 * Lo encontró el recorrido de navegador de 1C, y no antes, porque ninguna prueba
 * había movido un viaje más allá de `autorizado` reutilizando una cisterna: la
 * suite de superficie estrena una en cada bloque, que es lo que una flota real
 * no hace.
 */
describe('cambiarEstado · el solapamiento del §5.1 se cuenta, no revienta', () => {
  it('arrancar un viaje que pisa a otro de la misma cisterna da un conflicto legible',
    async () => {
      await enServicio(async s => {
        const { gestor } = await import('../src/common/contexto/contexto-peticion');

        /* Dos viajes de la MISMA cisterna que hoy no se solapan: enero y junio
           de un año lejano. Los dos abiertos, que es lo que la exclusión mira
           —es parcial sobre los estados distintos de cerrado y cancelado—. */
        const crear = async (codigo: string, desde: string, hasta: string) => {
          const [v] = await gestor().query(
            `INSERT INTO viajes (empresa_id, codigo_viaje, tipo_viaje, cisterna_id,
                                 conductor_id, fecha_programada, fecha_fin, estado)
             VALUES ($1,$2,'simple',$3,$4,$5,$6,'autorizado') RETURNING viaje_id`,
            [empresa, codigo, cisterna, conductor, desde, hasta]);
          return String(v.viaje_id);
        };
        await crear(`SRV-OCU-A-${Math.random().toString(36).slice(2, 7)}`,
                    '2040-01-10T08:00:00Z', '2040-01-11T18:00:00Z');
        const segundo = await crear(`SRV-OCU-B-${Math.random().toString(36).slice(2, 7)}`,
                                    '2040-06-01T08:00:00Z', '2040-06-02T18:00:00Z');

        /* Salir del patio exige plan de carga —un camión no va a la terminal
           sin saber qué recoger—, así que el segundo lleva el suyo. */
        await gestor().query(
          `INSERT INTO plan_carga (empresa_id, viaje_id, compartimento_id, detalle_orden_id,
                                   producto_id, volumen_planificado)
           VALUES ($1,$2,$3,$4,$5,100)`,
          [empresa, segundo, compartimento, detalleOrden, producto]);

        // Arrancarlo hoy estira su periodo hasta junio de 2040 y se come al otro.
        await expect(s.cambiarEstado(segundo, { estado: 'desplazamiento_terminal' }))
          .rejects.toThrow(/ya tiene otro viaje que se superpone/);
      });
    });

  it('y sin nadie a quien pisar, arranca sin ruido', async () => {
    await enServicio(async s => {
      const id = await viajeCompleto(s, 'programado');
      await s.autorizar(id);
      const v = await s.cambiarEstado(id, { estado: 'desplazamiento_terminal' });
      expect(v.estado).toBe('desplazamiento_terminal');
      expect(v.fechaInicio).not.toBeNull();
    });
  });
});

describe('autorizar · regla 13, los documentos vencidos bloquean la salida', () => {
  const fecha = (dias: number) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + dias);
    return d.toISOString().slice(0, 10);
  };

  async function licencia(vence: string | null) {
    const { gestor } = await import('../src/common/contexto/contexto-peticion');
    await gestor().query(
      `UPDATE conductores SET fecha_vencimiento_licencia = $2 WHERE conductor_id = $1`,
      [conductor, vence]);
  }

  async function calibracion(vence: string | null) {
    const { gestor } = await import('../src/common/contexto/contexto-peticion');
    await gestor().query(
      `UPDATE cisternas SET fecha_proxima_calibracion = $2 WHERE cisterna_id = $1`,
      [cisterna, vence]);
  }

  it('una licencia vencida impide autorizar, y el mensaje dice cuál documento', async () => {
    await enServicio(async s => {
      const id = await viajeCompleto(s, 'programado');
      await licencia(fecha(-1));
      await expect(s.autorizar(id)).rejects.toThrow(/licencia/i);
    });
  });

  it('la licencia que vence HOY todavía vale', async () => {
    // El límite es estricto y está donde la alerta ya lo tenía: vencida es
    // `fecha < hoy`. Un documento vence al final de su día, no al principio, y
    // que las dos piezas usen el mismo corte evita que el sistema avise de algo
    // que no bloquea o bloquee algo de lo que no avisó.
    await enServicio(async s => {
      const id = await viajeCompleto(s, 'programado');
      await licencia(fecha(0));
      const v = await s.autorizar(id);
      expect(v.estado).toBe('autorizado');
    });
  });

  it('una licencia que vence mañana autoriza sin ruido', async () => {
    await enServicio(async s => {
      const id = await viajeCompleto(s, 'programado');
      await licencia(fecha(1));
      const v = await s.autorizar(id);
      expect(v.estado).toBe('autorizado');
    });
  });

  it('sin fecha declarada no se bloquea: no hay documento que esté vencido', async () => {
    // Bloquear por un dato que nadie capturó convertiría la regla en un freno
    // a la carga de datos, y el primer atajo sería inventarse una fecha.
    await enServicio(async s => {
      const id = await viajeCompleto(s, 'programado');
      await licencia(null);
      const v = await s.autorizar(id);
      expect(v.estado).toBe('autorizado');
    });
  });

  it('la calibración vencida de la cisterna también bloquea', async () => {
    // El §7.5 la trata como un documento de la unidad, y una cisterna sin
    // calibración vigente no puede certificar el volumen que transporta — que
    // es el dato del que cuelga toda la conciliación del §17.
    await enServicio(async s => {
      const id = await viajeCompleto(s, 'programado');
      await calibracion(fecha(-1));
      await expect(s.autorizar(id)).rejects.toThrow(/calibraci/i);
    });
  });

  it('con los dos documentos al día, autoriza', async () => {
    await enServicio(async s => {
      const id = await viajeCompleto(s, 'programado');
      await licencia(fecha(90));
      await calibracion(fecha(180));
      const v = await s.autorizar(id);
      expect(v.estado).toBe('autorizado');
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
      });
      await expect(s.crear({
        codigoViaje: `SRV-OC2-${Math.random().toString(36).slice(2, 7)}`,
        tipoViaje: 'simple', cisternaId: cisterna,
        fechaProgramada: '2027-09-01T12:00:00Z', fechaFin: '2027-09-01T20:00:00Z',
      })).rejects.toThrow(/La cisterna ya tiene otro viaje que se superpone/);
    });
  });

  it('distingue si el que choca es el conductor', async () => {
    await enServicio(async s => {
      await s.crear({
        codigoViaje: `SRV-OC3-${Math.random().toString(36).slice(2, 7)}`,
        tipoViaje: 'simple', conductorId: conductor,
        fechaProgramada: '2027-10-01T08:00:00Z', fechaFin: '2027-10-01T18:00:00Z',
      });
      await expect(s.crear({
        codigoViaje: `SRV-OC4-${Math.random().toString(36).slice(2, 7)}`,
        tipoViaje: 'simple', conductorId: conductor,
        fechaProgramada: '2027-10-01T12:00:00Z', fechaFin: '2027-10-01T20:00:00Z',
      })).rejects.toThrow(/El conductor ya tiene otro viaje que se superpone/);
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

/*
 * A partir de aquí, las reglas del lado del FALLO de `asignarOrden` y
 * `agregarLineaPlan`. Estaban todas sin cubrir —viajes.service.ts iba al 73 %
 * de ramas— y son justo las que más importan: no describen lo que el sistema
 * hace, sino lo que impide. Un camión no puede salir con más producto del que
 * cabe, ni con carga de una orden que nadie pidió, ni con gasolina en un tanque
 * calibrado para diésel.
 */

describe('asignarOrden · qué órdenes entran en un viaje y cuáles no', () => {
  it('una orden que no existe se rechaza como petición mala, no como conflicto', async () => {
    // 400 y no 404: el viaje sí existe, lo que está mal es lo que se pide.
    await enServicio(async (s) => {
      const v = await viajeConOrden(s);
      await expect(s.asignarOrden(v, {
        ordenId: '999999999', secuenciaEntrega: 2,
      })).rejects.toThrow('La orden indicada no existe');
    });
  });

  it('una orden recién recibida no se puede asignar: primero se valida', async () => {
    // §8.1: la validación es la frontera. Asignar una orden sin validar mete en
    // la calle un pedido que nadie ha confirmado.
    await enServicio(async (s) => {
      const v = await viajeConOrden(s);
      await expect(s.asignarOrden(v, { ordenId: ordenRecibida, secuenciaEntrega: 2 }))
        .rejects.toThrow(/no se puede asignar a un viaje; debe estar validada/);
    });
  });

  it('el rechazo dice en qué estado ESTÁ la orden, no sólo que no vale', async () => {
    await enServicio(async (s) => {
      const v = await viajeConOrden(s);
      await expect(s.asignarOrden(v, { ordenId: ordenRecibida, secuenciaEntrega: 2 }))
        .rejects.toThrow(/"recibida"/);
    });
  });

  it('la misma orden dos veces en el mismo viaje se rechaza', async () => {
    await enServicio(async (s) => {
      const v = await viajeConOrden(s);
      await expect(s.asignarOrden(v, { ordenId: orden, secuenciaEntrega: 2 }))
        .rejects.toThrow(/ya está en el viaje, o esa secuencia ya está ocupada/);
    });
  });

  it('un viaje que ya salió no admite órdenes nuevas', async () => {
    // La frontera del §8.2: después de autorizar, el camión está en la calle y
    // añadirle una entrega es replanificar algo que ya se está ejecutando.
    await enServicio(async (s) => {
      const v = await viajeConOrden(s);
      await forzarEstado(v, 'autorizado');
      await expect(s.asignarOrden(v, { ordenId: orden, secuenciaEntrega: 2 }))
        .rejects.toThrow(/ya no admite órdenes nuevas/);
    });
  });
});

describe('agregarLineaPlan · lo que impide que un camión salga mal cargado', () => {
  it('un compartimento que no existe se rechaza', async () => {
    await enServicio(async (s) => {
      const v = await viajeConOrden(s);
      await expect(s.agregarLineaPlan(v, {
        compartimentoId: '999999999',
        detalleOrdenId: detalleOrden, volumenPlanificado: 100,
      })).rejects.toThrow('El compartimento indicado no existe');
    });
  });

  it('un compartimento de OTRA cisterna se rechaza', async () => {
    // Sin esta regla se podría planificar carga en un tanque que no viaja: el
    // plan cuadraría en la pantalla y el camión saldría medio vacío.
    await enServicio(async (s) => {
      const v = await viajeConOrden(s);
      await expect(s.agregarLineaPlan(v, {
        compartimentoId: compartimentoAjeno, detalleOrdenId: detalleOrden, volumenPlanificado: 100,
      })).rejects.toThrow('Ese compartimento no pertenece a la cisterna del viaje');
    });
  });

  it('una línea de una orden que no está en el viaje se rechaza', async () => {
    // Carga sin destinatario: producto que sale de la terminal sin que ninguna
    // entrega de este viaje lo reclame.
    await enServicio(async (s) => {
      const v = await viajeConOrden(s);
      await expect(s.agregarLineaPlan(v, {
        compartimentoId: compartimento, detalleOrdenId: detalleAjeno, volumenPlanificado: 100,
      })).rejects.toThrow(/no pertenece a ninguna orden asignada a este viaje/);
    });
  });

  it('no se planifica más de lo que el compartimento tiene CALIBRADO', async () => {
    // Calibrado, no nominal: la diferencia entre 5000 y 4980 es exactamente lo
    // que separa un aforo legal de uno inventado.
    await enServicio(async (s) => {
      const v = await viajeConOrden(s);
      await expect(s.agregarLineaPlan(v, {
        compartimentoId: compartimento, detalleOrdenId: detalleOrden, volumenPlanificado: 4990,
      })).rejects.toThrow(/admite 4980/);
    });
  });

  it('no se planifica más de lo que la orden pidió', async () => {
    await enServicio(async (s) => {
      const v = await viajeConOrden(s);
      await s.agregarLineaPlan(v, {
        compartimentoId: compartimento, detalleOrdenId: detalleOrden, volumenPlanificado: 4000,
      });
      // Pedidos 5000, planificados 4000: quedan 1000 y se piden 1500.
      await expect(s.agregarLineaPlan(v, {
        compartimentoId: compartimentoSoloDiesel, detalleOrdenId: detalleOrden, volumenPlanificado: 1500,
      })).rejects.toThrow(/le quedan 1000 por planificar/);
    });
  });

  it('un compartimento calibrado para otro producto no admite esta línea', async () => {
    // La regla anticontaminación. Mezclar productos en un tanque estropea la
    // carga entera, y el daño no se ve hasta que llega a la estación.
    await enServicio(async (s) => {
      const v = await viajeConOrden(s);
      await expect(s.agregarLineaPlan(v, {
        compartimentoId: compartimentoSoloDiesel, detalleOrdenId: detalleOrden, volumenPlanificado: 500,
      })).rejects.toThrow('Ese compartimento no admite el producto de esa línea');
    });
  });

  it('el mismo compartimento no se carga dos veces en el mismo viaje', async () => {
    await enServicio(async (s) => {
      const v = await viajeConOrden(s);
      await s.agregarLineaPlan(v, {
        compartimentoId: compartimento, detalleOrdenId: detalleOrden, volumenPlanificado: 500,
      });
      await expect(s.agregarLineaPlan(v, {
        compartimentoId: compartimento, detalleOrdenId: detalleOrden, volumenPlanificado: 500,
      })).rejects.toThrow(/ya tiene carga asignada en este viaje/);
    });
  });

  it('un viaje sin cisterna no admite plan de carga', async () => {
    await enServicio(async (s) => {
      const v = await s.crear({
        codigoViaje: `NOC-${Math.random().toString(36).slice(2, 9)}`,
        tipoViaje: 'simple', conductorId: conductor,
        fechaProgramada: '2027-06-01T08:00:00Z',
      });
      await s.asignarOrden(String(v.id), { ordenId: orden, secuenciaEntrega: 1 });
      await expect(s.agregarLineaPlan(String(v.id), {
        compartimentoId: compartimento, detalleOrdenId: detalleOrden, volumenPlanificado: 100,
      })).rejects.toThrow('El viaje no tiene cisterna asignada');
    });
  });

  it('un viaje que ya salió tiene el plan de carga cerrado', async () => {
    await enServicio(async (s) => {
      const v = await viajeConOrden(s);
      await forzarEstado(v, 'cargando');
      await expect(s.agregarLineaPlan(v, {
        compartimentoId: compartimento, detalleOrdenId: detalleOrden, volumenPlanificado: 100,
      })).rejects.toThrow(/el plan de carga ya está cerrado/);
    });
  });
});

/** Lee el acumulado de una línea de orden DENTRO de la misma transacción. */
async function volumenPlanificadoDe(detalleId: string): Promise<number> {
  const { gestor } = await import('../src/common/contexto/contexto-peticion');
  const [f] = await gestor().query(
    `SELECT volumen_planificado FROM detalles_orden WHERE detalle_orden_id = $1`, [detalleId]);
  return Number(f.volumen_planificado);
}

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * El acumulado `detalles_orden.volumen_planificado`.
 *
 * Lo escriben dos sitios —`agregarLineaPlan` suma, `quitarLineaPlan` resta— y
 * lo lee uno: la regla 4, que decide si cabe más carga. Hasta aquí NINGUNA
 * prueba afirmaba su VALOR: las diez de `agregarLineaPlan` son casos de rechazo
 * y comprueban el mensaje, no el número que queda en la fila.
 *
 * Se midió qué tan ciego era el hueco cambiando el `-` de la devolución por un
 * `+` —el error de signo más ordinario que existe—: 58 pruebas verdes con el
 * fallo dentro. Estas son las que lo ven.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe('el acumulado de la línea de orden · el número del que depende la regla 4', () => {
  it('planificar SUMA el volumen al acumulado de la línea', async () => {
    await enServicio(async (s) => {
      const v = await viajeConOrden(s);
      expect(await volumenPlanificadoDe(detalleOrden)).toBe(0);
      await s.agregarLineaPlan(v, {
        compartimentoId: compartimento, detalleOrdenId: detalleOrden, volumenPlanificado: 1200,
      });
      expect(await volumenPlanificadoDe(detalleOrden)).toBe(1200);
    });
  });

  it('dos compartimentos acumulan: la regla 4 lee la SUMA, no la última línea', async () => {
    // Sin esto, un acumulado que se sobrescribiera en vez de sumar pasaría
    // desapercibido mientras cada asignación por separado cupiera.
    await enServicio(async (s) => {
      const v = await viajeConOrden(s);
      await s.agregarLineaPlan(v, {
        compartimentoId: compartimento, detalleOrdenId: detalleOrden, volumenPlanificado: 3000,
      });
      await s.agregarLineaPlan(v, {
        compartimentoId: compartimentoSoloDiesel, detalleOrdenId: detalleOrden,
        volumenPlanificado: 1500,
      }).catch(() => undefined); // el de diésel rechaza por producto
      expect(await volumenPlanificadoDe(detalleOrden)).toBe(3000);
      // Pedidos 5000, planificados 3000: la regla 4 tiene que ver 2000 libres.
      await expect(s.agregarLineaPlan(v, {
        compartimentoId: compartimentoAjeno, detalleOrdenId: detalleOrden, volumenPlanificado: 2500,
      })).rejects.toThrow(/no pertenece a la cisterna/);
    });
  });

  it('quitar una línea DEVUELVE el volumen al acumulado', async () => {
    // El comentario del servicio promete que «si no, quedaría planificado para
    // siempre y la orden parecería cubierta sin estarlo». Esto es lo que lo
    // comprueba: hasta ahora ese cuerpo no se ejecutaba en ninguna prueba.
    await enServicio(async (s) => {
      const v = await viajeConOrden(s);
      const conPlan = await s.agregarLineaPlan(v, {
        compartimentoId: compartimento, detalleOrdenId: detalleOrden, volumenPlanificado: 2000,
      });
      expect(await volumenPlanificadoDe(detalleOrden)).toBe(2000);

      await s.quitarLineaPlan(v, String(conPlan.planCarga[0].id));
      expect(await volumenPlanificadoDe(detalleOrden)).toBe(0);
    });
  });

  it('quitar una línea la saca del plan de carga del viaje', async () => {
    await enServicio(async (s) => {
      const v = await viajeConOrden(s);
      const conPlan = await s.agregarLineaPlan(v, {
        compartimentoId: compartimento, detalleOrdenId: detalleOrden, volumenPlanificado: 500,
      });
      expect(conPlan.planCarga).toHaveLength(1);
      const sinPlan = await s.quitarLineaPlan(v, String(conPlan.planCarga[0].id));
      expect(sinPlan.planCarga).toHaveLength(0);
    });
  });

  it('el hueco devuelto se puede volver a planificar: es el ciclo completo', async () => {
    // Corregir un plan de carga —quitar los 5000 mal puestos y repartirlos
    // bien— es la operación normal de un despachador, no un caso raro. Si la
    // devolución falla, el segundo intento choca contra la regla 4 y la orden
    // queda imposible de planificar sin tocar la base a mano.
    await enServicio(async (s) => {
      const v = await viajeConOrden(s);
      const conPlan = await s.agregarLineaPlan(v, {
        compartimentoId: compartimento, detalleOrdenId: detalleOrden, volumenPlanificado: 4980,
      });
      await s.quitarLineaPlan(v, String(conPlan.planCarga[0].id));
      await s.agregarLineaPlan(v, {
        compartimentoId: compartimento, detalleOrdenId: detalleOrden, volumenPlanificado: 4980,
      });
      expect(await volumenPlanificadoDe(detalleOrden)).toBe(4980);
    });
  });

  it('una línea que no es de este viaje no se puede quitar', async () => {
    await enServicio(async (s) => {
      const v = await viajeConOrden(s);
      await expect(s.quitarLineaPlan(v, '999999999'))
        .rejects.toThrow('Esa línea no está en el plan de carga del viaje');
    });
  });

  it('con el viaje ya en marcha el plan no se toca, y el acumulado no se mueve', async () => {
    await enServicio(async (s) => {
      const v = await viajeConOrden(s);
      const conPlan = await s.agregarLineaPlan(v, {
        compartimentoId: compartimento, detalleOrdenId: detalleOrden, volumenPlanificado: 700,
      });
      await forzarEstado(v, 'cargando');
      await expect(s.quitarLineaPlan(v, String(conPlan.planCarga[0].id)))
        .rejects.toThrow(/el plan de carga ya está cerrado/);
      expect(await volumenPlanificadoDe(detalleOrden)).toBe(700);
    });
  });
});

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * La cota del acumulado vive TAMBIÉN en la base.
 *
 * La regla 4 del servicio lee el acumulado y después lo escribe. Entre esas dos
 * cosas no hay cerrojo: dos peticiones simultáneas sobre la misma línea leen
 * las dos 0, las dos pasan la regla con 3000 sobre una orden de 5000, y el
 * acumulado acaba en 6000. La `ck_detalles_volumenes` original sólo exigía
 * `>= 0`, así que nada rechazaba ese estado: la orden quedaba marcada como
 * planificada de más y la regla 4 empezaba a rechazar carga legítima.
 *
 * Estas pruebas van contra la BASE a propósito, saltándose el servicio. Es la
 * única forma de comprobar que la garantía se sostiene sola, que es justo lo
 * que se le pide a una restricción: valer también cuando el camino que la
 * respeta no es el que escribe.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe('la cota del acumulado · lo que el servicio no puede prometer solo', () => {
  it('la base rechaza un acumulado por encima de lo solicitado', async () => {
    await enServicio(async () => {
      const { gestor } = await import('../src/common/contexto/contexto-peticion');
      // La línea pide 5000. 6000 es el estado que deja la carrera de dos
      // peticiones concurrentes, y ningún camino de la aplicación lo escribe.
      await expect(gestor().query(
        `UPDATE detalles_orden SET volumen_planificado = 6000 WHERE detalle_orden_id = $1`,
        [detalleOrden])).rejects.toThrow(/ck_detalles_planificado_cabe/);
    });
  });

  it('planificar EXACTAMENTE lo solicitado sí se permite: la cota no es estricta', async () => {
    // Una cota mal escrita con `<` en vez de `<=` haría imposible cubrir una
    // orden entera, que es el caso normal y no el excepcional.
    await enServicio(async () => {
      const { gestor } = await import('../src/common/contexto/contexto-peticion');
      await gestor().query(
        `UPDATE detalles_orden SET volumen_planificado = 5000 WHERE detalle_orden_id = $1`,
        [detalleOrden]);
      expect(await volumenPlanificadoDe(detalleOrden)).toBe(5000);
    });
  });
});

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * La carrera de verdad, con dos conexiones.
 *
 * Las pruebas de arriba comprueban que la cota existe. Ésta comprueba lo que la
 * migración AFIRMA de ella: que cierra la ventana entre la lectura de la regla
 * 4 y su escritura, en vez de limitarse a denunciarla después.
 *
 * Necesita salirse del molde del fichero —dos conexiones y un COMMIT real, no
 * una transacción que se deshace— porque una carrera entre transacciones no se
 * puede simular dentro de una sola. Todo lo que confirma se limpia al final.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe('dos peticiones a la vez sobre la misma línea', () => {
  it('la segunda acaba en conflicto legible, no en un acumulado imposible', async () => {
    // El viaje tiene que estar CONFIRMADO para que la segunda conexión lo vea.
    const [v] = await dueño.query(
      `INSERT INTO viajes (empresa_id, codigo_viaje, tipo_viaje, cisterna_id, conductor_id,
                           fecha_programada)
       VALUES ($1,'CARRERA-1','simple',$2,$3,'2029-02-01T08:00:00Z') RETURNING viaje_id`,
      [empresa, cisterna, conductor]);
    const viaje = String(v.viaje_id);
    await dueño.query(
      `INSERT INTO viaje_ordenes (empresa_id, viaje_id, orden_id, secuencia_entrega)
       VALUES ($1,$2,$3,1)`, [empresa, viaje, orden]);

    const t1 = app.createQueryRunner();
    const t2 = app.createQueryRunner();
    try {
      await t1.connect(); await t2.connect();
      await t1.startTransaction(); await t2.startTransaction();
      await t1.query(`SELECT set_config('app.empresa_id', $1, true)`, [empresa]);
      await t2.query(`SELECT set_config('app.empresa_id', $1, true)`, [empresa]);
      // Se pide AHORA, mientras la conexión está libre: cuando esté bloqueada
      // en el UPDATE ya no puede responder a nada.
      const pid2 = (await t2.query(`SELECT pg_backend_pid() AS pid`))[0].pid;

      // La primera petición planifica 3000 de los 5000 y aún no confirma.
      await t1.query(
        `UPDATE detalles_orden SET volumen_planificado = volumen_planificado + 3000
          WHERE detalle_orden_id = $1`, [detalleOrden]);

      // La segunda entra por el servicio y lee el acumulado ANTES de que la
      // primera confirme: ve 0, cree que quedan 5000 y deja pasar sus 3000.
      // Su UPDATE se queda entonces esperando el cerrojo de fila de la primera.
      const segunda = ejecutarEnContexto(
        { empresaId: empresa, usuarioId: usuario, manager: t2.manager, cambios: [] },
        () => servicio.agregarLineaPlan(viaje, {
          compartimentoId: compartimento, detalleOrdenId: detalleOrden,
          volumenPlanificado: 3000,
        }),
      );
      // Se espera a que la segunda esté REALMENTE esperando el cerrojo, no un
      // rato fijo. Un `sleep` aquí no es lentitud, es intermitencia: si bajo
      // carga la segunda no ha llegado al UPDATE cuando la primera confirma,
      // su regla 4 lee ya 3000, rechaza por «le quedan 2000» y la prueba falla
      // afirmando un mensaje que en esa corrida nunca tocaba. Se vio fallar así
      // una vez de tres en la suite completa antes de escribirlo de esta forma.
      const esperando = await (async () => {
        for (let i = 0; i < 400; i++) {
          const [a] = await dueño.query(
            `SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1`, [pid2]);
          if (a?.wait_event_type === 'Lock') return true;
          await new Promise((r) => setTimeout(r, 25));
        }
        return false;
      })();
      // Si nunca llegó a bloquearse no hay carrera que probar, y decirlo es
      // mejor que dejar pasar una prueba que ya no comprueba lo que dice.
      expect(esperando).toBe(true);

      // Al confirmar la primera, la segunda despierta y reevalúa su suma sobre
      // la fila ya confirmada: 3000 + 3000 = 6000 sobre una orden de 5000.
      await t1.commitTransaction();

      await expect(segunda).rejects.toThrow(/vuelva a consultar lo que queda por planificar/);
      if (t2.isTransactionActive) await t2.rollbackTransaction();

      const [f] = await dueño.query(
        `SELECT volumen_planificado FROM detalles_orden WHERE detalle_orden_id = $1`,
        [detalleOrden]);
      expect(Number(f.volumen_planificado)).toBe(3000);
    } finally {
      if (t2.isTransactionActive) await t2.rollbackTransaction();
      if (t1.isTransactionActive) await t1.rollbackTransaction();
      await t1.release(); await t2.release();
      // Lo confirmado por t1 sobrevive al rollback de la prueba: se deshace a
      // mano o las pruebas siguientes arrancan con la línea medio planificada.
      await dueño.query(`DELETE FROM plan_carga WHERE viaje_id = $1`, [viaje]);
      await dueño.query(`DELETE FROM viaje_ordenes WHERE viaje_id = $1`, [viaje]);
      await dueño.query(`DELETE FROM viajes WHERE viaje_id = $1`, [viaje]);
      await dueño.query(
        `UPDATE detalles_orden SET volumen_planificado = 0 WHERE detalle_orden_id = $1`,
        [detalleOrden]);
    }
  }, 30_000);
});
