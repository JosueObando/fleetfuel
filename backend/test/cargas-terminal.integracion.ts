import 'reflect-metadata';
import { config as cargarEnv } from 'dotenv';
import { DataSource } from 'typeorm';
import { join } from 'path';

import { CargasService } from '../src/modules/cargas/cargas.service';
import { EntregasService } from '../src/modules/entregas/entregas.service';
import { ejecutarEnContexto, gestor } from '../src/common/contexto/contexto-peticion';

cargarEnv({ path: join(__dirname, '../../.env') });

/**
 * §7.13 `cargas_terminal` — la Etapa 5 del §9 y la primera mitad de la regla 18.
 *
 * LO QUE ESTE FICHERO EXISTE PARA PROBAR
 *
 * Que el sello tenga un ORIGEN. Hasta el 2026-09-12 el número de sello aparecía
 * por primera vez en la entrega, escrito por quien la registraba, y su
 * `estado_sello` lo elegía esa misma persona entre 'intacto', 'roto' e
 * 'inconsistente'. La regla 18 pide que el sello «quede asociado a una carga y
 * se verifique en la entrega», y sólo existía la verificación — contra nada.
 *
 * Las pruebas se escriben desde el PRD (§7.13 para los campos, §9 Etapa 5 para
 * el momento, y las reglas 4, 5, 17, 18 y 19 del §11 para el comportamiento) y
 * no desde la tabla del código, por el mismo criterio que la máquina de estados
 * de viajes: derivarlas de la implementación sólo confirmaría que el código
 * hace lo que hace.
 *
 * El servicio se ejercita de verdad contra Postgres, en una transacción por
 * prueba que termina en ROLLBACK.
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

const cargas = new CargasService();
const entregas = new EntregasService();

let secuenciaViaje = 0;
let ultimoViaje: string | null = null;
/** Cada carga estrena sello: la regla 18 lo exige único por empresa. */
let secuenciaSello = 0;

let empresa: string, usuario: string, cisterna: string, compartimento: string;
let compartimentoAjeno: string, conductor: string, producto: string;
let cliente: string, estacion: string, orden: string, detalleOrden: string;

async function enContexto<T>(fn: () => Promise<T>): Promise<T> {
  const runner = app.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await runner.query(`SELECT set_config('app.empresa_id', $1, true)`, [empresa]);
    return await ejecutarEnContexto(
      { empresaId: empresa, usuarioId: usuario, manager: runner.manager, cambios: [] },
      fn,
    );
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    await runner.release();
    ultimoViaje = null;
  }
}

/**
 * Un viaje CARGANDO, con su orden asignada y su plan de carga.
 *
 * `cargando` y no `descargando` como en las entregas: la Etapa 5 del §9 pone la
 * carga en terminal justo ahí, y el viaje pasa a `cargado` después.
 */
async function viajeCargando(planificado = 3000): Promise<string> {
  // El `periodo` del viaje no tiene cota superior mientras no hay `fecha_fin`,
  // así que la cisterna sigue ocupada y el siguiente viaje chocaría con la
  // exclusión del §5.1. Se cierra el anterior, que es lo que pasa de verdad.
  if (ultimoViaje) {
    await gestor().query(
      `UPDATE viajes SET estado = 'cerrado', fecha_fin = fecha_programada + interval '4 hours'
        WHERE viaje_id = $1 AND estado <> 'cerrado'`, [ultimoViaje]);
  }
  const [v] = await gestor().query(
    `INSERT INTO viajes (empresa_id, codigo_viaje, tipo_viaje, cisterna_id, conductor_id,
                         fecha_programada, estado)
     VALUES ($1,$2,'simple',$3,$4,$5,'cargando') RETURNING viaje_id`,
    [empresa, `CAR-${Math.random().toString(36).slice(2, 9)}`, cisterna, conductor,
     new Date(Date.UTC(2030, 0, 1 + secuenciaViaje++, 8)).toISOString()]);
  const viaje = String(v.viaje_id);
  await gestor().query(
    `INSERT INTO viaje_ordenes (empresa_id, viaje_id, orden_id, secuencia_entrega)
     VALUES ($1,$2,$3,1)`, [empresa, viaje, orden]);
  await gestor().query(
    `INSERT INTO plan_carga (empresa_id, viaje_id, compartimento_id, detalle_orden_id,
                             producto_id, volumen_planificado)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [empresa, viaje, compartimento, detalleOrden, producto, planificado]);
  await gestor().query(
    `UPDATE detalles_orden SET volumen_planificado = $2 WHERE detalle_orden_id = $1`,
    [detalleOrden, planificado]);
  ultimoViaje = viaje;
  return viaje;
}

/** Lo mínimo que una carga necesita para ser válida. */
const cargaBase = (extra: Record<string, unknown> = {}) => ({
  compartimentoId: compartimento,
  detalleOrdenId: detalleOrden,
  volumenCargado: 3000,
  numeroSello: `SELLO-${secuenciaSello++}`,
  operadorTerminal: 'Luis Operador',
  latitud: 9.3547,
  longitud: -79.9003,
  ...extra,
});

const entregaBase = (extra: Record<string, unknown> = {}) => ({
  detalleOrdenId: detalleOrden,
  compartimentoId: compartimento,
  volumenRecibido: 3000,
  receptorNombre: 'Ana Receptora',
  latitud: 8.9824,
  longitud: -79.5199,
  ...extra,
});

/** Lleva el viaje de `cargando` a `descargando` sin pasar por el servicio. */
async function aDescargando(viaje: string): Promise<void> {
  await gestor().query(`UPDATE viajes SET estado = 'descargando' WHERE viaje_id = $1`, [viaje]);
}

beforeAll(async () => {
  await dueño.initialize();
  await app.initialize();

  const [e] = await dueño.query(
    `INSERT INTO empresas (nombre, ruc) VALUES ('Cargas Test','CAR-TEST')
     ON CONFLICT (ruc) DO UPDATE SET nombre = EXCLUDED.nombre RETURNING empresa_id`);
  empresa = String(e.empresa_id);

  const [u] = await dueño.query(
    `INSERT INTO usuarios (empresa_id, nombre, correo, hash_clave)
     VALUES ($1,'Operador','car-test@ejemplo.test','x') RETURNING usuario_id`, [empresa]);
  usuario = String(u.usuario_id);

  const [veh] = await dueño.query(
    `INSERT INTO vehiculos (empresa_id, tipo_vehiculo, placa) VALUES ($1,'cisterna','CAR-1')
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
  const [cc2] = await dueño.query(
    `INSERT INTO compartimentos_cisterna
       (empresa_id, cisterna_id, numero, capacidad_nominal, capacidad_calibrada)
     VALUES ($1,$2,2,5000,4980) RETURNING compartimento_id`, [empresa, cisterna]);
  compartimentoAjeno = String(cc2.compartimento_id);

  const [cd] = await dueño.query(
    `INSERT INTO conductores (empresa_id, nombre_completo, documento, licencia)
     VALUES ($1,'Chofer Car','CAR-D1','CAR-L1') RETURNING conductor_id`, [empresa]);
  conductor = String(cd.conductor_id);

  const [cli] = await dueño.query(
    `INSERT INTO clientes (empresa_id, nombre) VALUES ($1,'Cliente Car') RETURNING cliente_id`,
    [empresa]);
  cliente = String(cli.cliente_id);
  const [est] = await dueño.query(
    `INSERT INTO estaciones_servicio (empresa_id, cliente_id, nombre)
     VALUES ($1,$2,'Estación Car') RETURNING estacion_id`, [empresa, cliente]);
  estacion = String(est.estacion_id);
  const [p] = await dueño.query(
    `INSERT INTO productos_combustible (empresa_id, codigo, nombre, tolerancia_merma)
     VALUES ($1,'CAR-95','Gasolina 95', 0.5) RETURNING producto_id`, [empresa]);
  producto = String(p.producto_id);
  const [o] = await dueño.query(
    `INSERT INTO ordenes_abastecimiento (empresa_id, cliente_id, estacion_id, estado)
     VALUES ($1,$2,$3,'en_transito') RETURNING orden_id`, [empresa, cliente, estacion]);
  orden = String(o.orden_id);
  const [d] = await dueño.query(
    `INSERT INTO detalles_orden (empresa_id, orden_id, producto_id, volumen_solicitado, tolerancia)
     VALUES ($1,$2,$3,5000,1.0) RETURNING detalle_orden_id`, [empresa, o.orden_id, producto]);
  detalleOrden = String(d.detalle_orden_id);
});

afterAll(async () => {
  for (const t of ['entregas', 'cargas_terminal', 'plan_carga', 'viaje_ordenes', 'viajes',
                   'detalles_orden', 'ordenes_abastecimiento', 'estaciones_servicio', 'clientes',
                   'compartimentos_cisterna', 'productos_combustible', 'cisternas',
                   'vehiculos', 'conductores', 'auditoria', 'usuarios']) {
    await dueño.query(`DELETE FROM ${t} WHERE empresa_id = $1`, [empresa]);
  }
  await dueño.query(`DELETE FROM empresas WHERE ruc = 'CAR-TEST'`);
  await app.destroy();
  await dueño.destroy();
});

describe('registrar · §9 Etapa 5, la carga se registra CUANDO el camión carga', () => {
  it('un viaje que todavía no llegó a la terminal no admite carga', async () => {
    await enContexto(async () => {
      const viaje = await viajeCargando();
      await gestor().query(
        `UPDATE viajes SET estado = 'desplazamiento_terminal' WHERE viaje_id = $1`, [viaje]);
      await expect(cargas.registrar(viaje, cargaBase()))
        .rejects.toThrow(/sólo se registra la carga mientras el viaje carga/);
    });
  });

  it('un viaje que ya descarga tampoco: esa etapa ya pasó', async () => {
    await enContexto(async () => {
      const viaje = await viajeCargando();
      await aDescargando(viaje);
      await expect(cargas.registrar(viaje, cargaBase()))
        .rejects.toThrow(/sólo se registra la carga mientras el viaje carga/);
    });
  });

  it('un viaje inexistente se rechaza antes de mirar nada más', async () => {
    await enContexto(async () => {
      await expect(cargas.registrar('999999999', cargaBase()))
        .rejects.toThrow(/Viaje no encontrado/);
    });
  });
});

describe('registrar · regla 17, toda carga se relaciona con un compartimento', () => {
  it('un compartimento sin esa línea en el plan de carga se rechaza', async () => {
    await enContexto(async () => {
      const viaje = await viajeCargando();
      await expect(cargas.registrar(viaje, cargaBase({ compartimentoId: compartimentoAjeno })))
        .rejects.toThrow(/no lleva carga planificada de esa línea/);
    });
  });

  it('una línea de orden que no está en el viaje se rechaza', async () => {
    await enContexto(async () => {
      const viaje = await viajeCargando();
      await expect(cargas.registrar(viaje, cargaBase({ detalleOrdenId: '999999999' })))
        .rejects.toThrow(/no lleva carga planificada de esa línea/);
    });
  });
});

describe('registrar · reglas 4 y 19, la capacidad calibrada es el techo', () => {
  it('cargar más de lo calibrado en el compartimento se rechaza', async () => {
    // Calibrado a 4980. La regla 4 del §11 es explícita: «No se puede superar
    // la capacidad calibrada de un compartimento». El nominal (5000) no manda:
    // lo que se puede facturar es lo que la calibración certifica.
    await enContexto(async () => {
      const viaje = await viajeCargando();
      await expect(cargas.registrar(viaje, cargaBase({ volumenCargado: 4981 })))
        .rejects.toThrow(/capacidad calibrada/);
    });
  });

  it('cargar exactamente lo calibrado se acepta', async () => {
    await enContexto(async () => {
      const viaje = await viajeCargando(4980);
      const carga = await cargas.registrar(viaje, cargaBase({ volumenCargado: 4980 })) as
        { volumenCargado: string };
      expect(Number(carga.volumenCargado)).toBe(4980);
    });
  });
});

describe('registrar · regla 5, un compartimento lleva UNA carga por viaje', () => {
  it('registrar dos veces el mismo compartimento en el mismo viaje se rechaza', async () => {
    await enContexto(async () => {
      const viaje = await viajeCargando();
      await cargas.registrar(viaje, cargaBase());
      await expect(cargas.registrar(viaje, cargaBase()))
        .rejects.toThrow(/ya tiene una carga registrada en este viaje/);
    });
  });
});

describe('registrar · regla 18, el sello identifica UNA carga', () => {
  it('repetir un número de sello se rechaza', async () => {
    await enContexto(async () => {
      const viaje = await viajeCargando();
      await cargas.registrar(viaje, cargaBase({ numeroSello: 'SELLO-REPETIDO' }));

      const otro = await viajeCargando();
      await expect(cargas.registrar(otro, cargaBase({ numeroSello: 'SELLO-REPETIDO' })))
        .rejects.toThrow(/sello .* ya está registrado/);
    });
  });
});

describe('registrar · lo que la carga toma del plan y lo que toma de quien la captura', () => {
  it('el volumen programado sale del plan de carga, no del cuerpo de la petición', async () => {
    // Si viniera en el DTO, quien captura podría declarar un programado a
    // medida de lo que cargó y la diferencia contra el plan sería siempre cero.
    await enContexto(async () => {
      const viaje = await viajeCargando(3200);
      const carga = await cargas.registrar(viaje, cargaBase({ volumenCargado: 3100 })) as
        { volumenProgramado: string; diferenciaProgramado: string };
      expect(Number(carga.volumenProgramado)).toBe(3200);
      expect(Number(carga.diferenciaProgramado)).toBe(-100);
    });
  });

  it('nace pendiente de validación: confirmar no es dar por bueno', async () => {
    await enContexto(async () => {
      const viaje = await viajeCargando();
      const carga = await cargas.registrar(viaje, cargaBase()) as { estadoValidacion: string };
      expect(carga.estadoValidacion).toBe('pendiente');
    });
  });

  it('los medidores van en pareja', async () => {
    await enContexto(async () => {
      const viaje = await viajeCargando();
      await expect(cargas.registrar(viaje, cargaBase({ medidorInicial: 100 })))
        .rejects.toThrow(/van en pareja/);
    });
  });

  it('un medidor que retrocede es un dato mal capturado', async () => {
    await enContexto(async () => {
      const viaje = await viajeCargando();
      await expect(
        cargas.registrar(viaje, cargaBase({ medidorInicial: 500, medidorFinal: 400 })))
        .rejects.toThrow(/no puede ser menor que el inicial/);
    });
  });

  it('con los dos medidores, la carga los guarda', async () => {
    await enContexto(async () => {
      const viaje = await viajeCargando();
      const carga = await cargas.registrar(
        viaje, cargaBase({ medidorInicial: 1000, medidorFinal: 4000 })) as
        { medidorInicial: string; medidorFinal: string };
      expect(Number(carga.medidorInicial)).toBe(1000);
      expect(Number(carga.medidorFinal)).toBe(4000);
    });
  });
});

/*
 * Las ramas de reserva: las que sólo corren cuando algo va mal.
 *
 * El DTO ya rechaza estos valores con `class-validator`, así que por HTTP no se
 * llega aquí. Pero el servicio es llamable sin pasar por el ValidationPipe —lo
 * hacen estas mismas pruebas, y lo hará cualquier proceso interno que se
 * escriba mañana—, y entonces quien contesta es la base. Sin traducción, un 500
 * con el nombre de una restricción dentro: correcto y no le dice nada a nadie.
 */
describe('las restricciones de la base, traducidas al idioma del negocio', () => {
  it('una coordenada imposible se explica, no revienta', async () => {
    await enContexto(async () => {
      const viaje = await viajeCargando();
      await expect(cargas.registrar(viaje, cargaBase({ latitud: 999 })))
        .rejects.toThrow(/no es una coordenada válida/);
    });
  });

  it('una densidad de cero no es «sin dato»: es un dato falso', async () => {
    await enContexto(async () => {
      const viaje = await viajeCargando();
      await expect(cargas.registrar(viaje, cargaBase({ densidad: 0 })))
        .rejects.toThrow(/valor físico mayor que cero/);
    });
  });

  it('una carga no puede terminar antes de empezar', async () => {
    await enContexto(async () => {
      const viaje = await viajeCargando();
      await expect(cargas.registrar(viaje, cargaBase({
        fechaInicio: '2030-03-01T10:00:00Z', fechaFin: '2030-03-01T09:00:00Z',
      }))).rejects.toThrow(/antes de empezar/);
    });
  });

  it('un error que el traductor no conoce sube tal cual y no se traga', async () => {
    // `operador_terminal` es NOT NULL y el servicio lo pasa sin mirar. La
    // violación no lleva `constraint`, así que cae al `throw e` final. Lo que
    // se prueba es justamente eso: que el último caso RELANCE en vez de
    // devolver algo inventado. Un traductor que se come lo que no entiende es
    // peor que no tenerlo — convierte un fallo desconocido en silencio.
    await enContexto(async () => {
      const viaje = await viajeCargando();
      const sinOperador = cargaBase();
      delete (sinOperador as Record<string, unknown>).operadorTerminal;
      await expect(cargas.registrar(viaje, sinOperador as never))
        .rejects.toThrow(/operador_terminal/);
    });
  });
});

describe('validar · quien confirma el volumen no es quien lo da por bueno', () => {
  it('validar deja constancia de quién y cuándo', async () => {
    await enContexto(async () => {
      const viaje = await viajeCargando();
      const carga = await cargas.registrar(viaje, cargaBase()) as { id: string };
      const validada = await cargas.validar(String(carga.id), {}) as
        { estadoValidacion: string; validadaPor: string; fechaValidacion: string };
      expect(validada.estadoValidacion).toBe('validada');
      expect(String(validada.validadaPor)).toBe(usuario);
      expect(validada.fechaValidacion).not.toBeNull();
    });
  });

  it('rechazar sin motivo no se puede', async () => {
    await enContexto(async () => {
      const viaje = await viajeCargando();
      const carga = await cargas.registrar(viaje, cargaBase()) as { id: string };
      await expect(cargas.rechazar(String(carga.id), {}))
        .rejects.toThrow(/exige un motivo/);
    });
  });

  it('rechazar con motivo lo guarda', async () => {
    await enContexto(async () => {
      const viaje = await viajeCargando();
      const carga = await cargas.registrar(viaje, cargaBase()) as { id: string };
      const rechazada = await cargas.rechazar(
        String(carga.id), { motivo: 'El sello del acta no coincide con el físico' }) as
        { estadoValidacion: string; motivoValidacion: string };
      expect(rechazada.estadoValidacion).toBe('rechazada');
      expect(rechazada.motivoValidacion).toMatch(/no coincide/);
    });
  });

  it('una carga ya validada no se vuelve a validar', async () => {
    await enContexto(async () => {
      const viaje = await viajeCargando();
      const carga = await cargas.registrar(viaje, cargaBase()) as { id: string };
      await cargas.validar(String(carga.id), {});
      await expect(cargas.validar(String(carga.id), {}))
        .rejects.toThrow(/no está pendiente/);
    });
  });

  it('una carga que no existe no se valida', async () => {
    await enContexto(async () => {
      await expect(cargas.validar('999999999', {})).rejects.toThrow(/Carga no encontrada/);
    });
  });
});

describe('leer', () => {
  it('las cargas de un viaje se listan', async () => {
    await enContexto(async () => {
      const viaje = await viajeCargando();
      await cargas.registrar(viaje, cargaBase());
      const lista = await cargas.listarDeViaje(viaje) as unknown[];
      expect(lista).toHaveLength(1);
    });
  });

  it('una carga que no existe da 404', async () => {
    await enContexto(async () => {
      await expect(cargas.obtener('999999999')).rejects.toThrow(/Carga no encontrada/);
    });
  });
});

/* ───────────────────────────────────────────────────────────────────────────
 * REGLA 18, LA SEGUNDA MITAD
 *
 * «Todo sello debe quedar asociado a una carga y VERIFICARSE EN LA ENTREGA.»
 *
 * Aquí es donde el módulo justifica existir: la entrega deja de creerse lo que
 * le dicen del sello y lo compara contra el que salió de la terminal.
 * ─────────────────────────────────────────────────────────────────────────── */
describe('la entrega verifica el sello contra la carga', () => {
  it('no se puede entregar de un compartimento que nunca se cargó', async () => {
    await enContexto(async () => {
      const viaje = await viajeCargando();
      await aDescargando(viaje);
      await expect(entregas.registrar(viaje, entregaBase()))
        .rejects.toThrow(/no tiene una carga registrada en terminal/);
    });
  });

  it('el volumen cargado de la entrega sale de la carga REAL, no del plan', async () => {
    // El plan decía 3000 y la terminal echó 2900. La merma del §10.5 es
    // «cargado − recibido», y «cargado» es lo que salió, no lo que se pensaba
    // sacar. Con el plan como referencia, 100 litros que nunca subieron al
    // camión se contaban como merma del conductor.
    await enContexto(async () => {
      const viaje = await viajeCargando(3000);
      const carga = await cargas.registrar(viaje, cargaBase({ volumenCargado: 2900 })) as
        { numeroSello: string };
      await aDescargando(viaje);

      const entrega = await entregas.registrar(viaje, entregaBase({
        volumenRecibido: 2900, selloRecibido: carga.numeroSello, estadoSello: 'intacto',
      })) as { volumenCargado: string; porcentajeMerma: string; estado: string };

      expect(Number(entrega.volumenCargado)).toBe(2900);
      expect(Number(entrega.porcentajeMerma)).toBe(0);
      expect(entrega.estado).toBe('aceptada');
    });
  });

  it('un sello que coincide se acepta como intacto', async () => {
    await enContexto(async () => {
      const viaje = await viajeCargando();
      const carga = await cargas.registrar(viaje, cargaBase()) as { numeroSello: string };
      await aDescargando(viaje);

      const entrega = await entregas.registrar(viaje, entregaBase({
        selloRecibido: carga.numeroSello,
      })) as { estadoSello: string; estado: string };

      expect(entrega.estadoSello).toBe('intacto');
      expect(entrega.estado).toBe('aceptada');
    });
  });

  it('un sello que NO coincide queda inconsistente aunque lo declaren intacto', async () => {
    // El corazón del módulo. Antes, `estadoSello` era un campo libre del DTO:
    // quien capturaba la entrega ponía el número Y lo calificaba. Un control en
    // el que el mismo actor aporta el dato y su veredicto no controla nada.
    await enContexto(async () => {
      const viaje = await viajeCargando();
      await cargas.registrar(viaje, cargaBase({ numeroSello: 'SELLO-ORIGEN' }));
      await aDescargando(viaje);

      const entrega = await entregas.registrar(viaje, entregaBase({
        selloRecibido: 'SELLO-OTRO', estadoSello: 'intacto',
      })) as { estadoSello: string; estado: string; requiereAprobacion: boolean };

      expect(entrega.estadoSello).toBe('inconsistente');
      // Y arrastra a la entrega a aprobación: el volumen puede cuadrar al
      // litro y el sello seguir diciendo que la carga se abrió por el camino.
      expect(entrega.estado).toBe('pendiente');
      expect(entrega.requiereAprobacion).toBe(true);
    });
  });

  it('no declarar sello con una carga que sí lo tiene es inconsistente', async () => {
    // Omitirlo no puede ser la vía de escape barata: si lo fuera, el camino
    // para que el sello no cuadre nunca sería no escribirlo.
    await enContexto(async () => {
      const viaje = await viajeCargando();
      await cargas.registrar(viaje, cargaBase());
      await aDescargando(viaje);

      const entrega = await entregas.registrar(viaje, entregaBase()) as
        { estadoSello: string; estado: string };

      expect(entrega.estadoSello).toBe('inconsistente');
      expect(entrega.estado).toBe('pendiente');
    });
  });

  it('quien recibe SÍ puede declarar el sello roto con el número correcto', async () => {
    // Un sello roto es un hecho físico que sólo ve quien está delante del
    // camión. El sistema decide la COINCIDENCIA; la integridad física la
    // observa una persona, y esa sigue siendo suya.
    await enContexto(async () => {
      const viaje = await viajeCargando();
      const carga = await cargas.registrar(viaje, cargaBase()) as { numeroSello: string };
      await aDescargando(viaje);

      const entrega = await entregas.registrar(viaje, entregaBase({
        selloRecibido: carga.numeroSello, estadoSello: 'roto',
      })) as { estadoSello: string; estado: string };

      expect(entrega.estadoSello).toBe('roto');
      expect(entrega.estado).toBe('pendiente');
    });
  });

  it('la entrega guarda a qué carga corresponde', async () => {
    await enContexto(async () => {
      const viaje = await viajeCargando();
      const carga = await cargas.registrar(viaje, cargaBase()) as
        { id: string; numeroSello: string };
      await aDescargando(viaje);

      const entrega = await entregas.registrar(viaje, entregaBase({
        selloRecibido: carga.numeroSello,
      })) as { cargaId: string };

      expect(String(entrega.cargaId)).toBe(String(carga.id));
    });
  });
});
