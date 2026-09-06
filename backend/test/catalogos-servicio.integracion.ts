import 'reflect-metadata';
import { config as cargarEnv } from 'dotenv';
import { DataSource } from 'typeorm';
import { join } from 'path';

import { ClientesService } from '../src/modules/clientes/clientes.service';
import { VehiculosService } from '../src/modules/vehiculos/vehiculos.service';
import { CisternasService } from '../src/modules/cisternas/cisternas.service';
import { ConductoresService } from '../src/modules/conductores/conductores.service';
import { EstacionesService } from '../src/modules/estaciones/estaciones.service';
import { ProductosService } from '../src/modules/productos/productos.service';
import { ejecutarEnContexto, gestor } from '../src/common/contexto/contexto-peticion';

cargarEnv({ path: join(__dirname, '../../.env') });

/**
 * Los seis catálogos de la Fase 1A, en su capa de servicio.
 *
 * `catalogos.integracion.ts` ya cubre lo que decide el MOTOR: aislamiento por
 * RLS, unicidad de placa, capacidad calibrada ≤ nominal, rango de la tolerancia
 * y que ningún catálogo admita DELETE. Aquí va lo otro: las reglas que sólo
 * existen en TypeScript y de las que no hay ninguna restricción que las repita.
 *
 * Son, casi todas, reglas de INTEGRIDAD REFERENCIAL BLANDA: cosas que la base
 * permitiría encantada —dar de baja un vehículo que está en un viaje, borrar un
 * producto que unos compartimentos declaran— y que dejan el sistema coherente
 * por dentro y falso por fuera.
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

const clientes = new ClientesService();
const vehiculos = new VehiculosService();
const cisternas = new CisternasService();
const conductores = new ConductoresService();
const estaciones = new EstacionesService();
const productos = new ProductosService();

let empresa: string, usuario: string;
let n = 0;
/** Sufijo único por prueba: los catálogos exigen códigos y placas irrepetibles. */
const unico = () => `${process.pid}${n++}`.slice(-8);

async function enContexto<T>(fn: () => Promise<T>): Promise<T> {
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

/** Pone una columna a mano, para llegar a estados que el servicio no expone. */
const forzar = (tabla: string, columna: string, id: string, valor: unknown, pk: string) =>
  gestor().query(`UPDATE ${tabla} SET ${columna} = $2 WHERE ${pk} = $1`, [id, valor]);

const cisternaCon = (vehiculoId: string, compartimentos: unknown[], capacidadTotal = 10000) =>
  ({ vehiculoId, capacidadTotal, compartimentos }) as never;
const compartimento = (numero: number, nominal: number, calibrada = nominal - 20) =>
  ({ numero, capacidadNominal: nominal, capacidadCalibrada: calibrada });

beforeAll(async () => {
  await dueño.initialize();
  await app.initialize();
  const [e] = await dueño.query(
    `INSERT INTO empresas (nombre, ruc) VALUES ('Catalogos Test','CAT-TEST')
     ON CONFLICT (ruc) DO UPDATE SET nombre = EXCLUDED.nombre RETURNING empresa_id`);
  empresa = String(e.empresa_id);
  const [u] = await dueño.query(
    `INSERT INTO usuarios (empresa_id, nombre, correo, hash_clave)
     VALUES ($1,'Operador','cat-test@ejemplo.test','x') RETURNING usuario_id`, [empresa]);
  usuario = String(u.usuario_id);
});

afterAll(async () => {
  for (const t of ['plan_carga', 'viaje_ordenes', 'viajes', 'detalles_orden',
                   'ordenes_abastecimiento', 'estaciones_servicio', 'clientes',
                   'productos_combustible', 'compartimentos_cisterna', 'cisternas',
                   'vehiculos', 'conductores', 'auditoria', 'usuarios']) {
    await dueño.query(`DELETE FROM ${t} WHERE empresa_id = $1`, [empresa]);
  }
  await dueño.query(`DELETE FROM empresas WHERE ruc = 'CAT-TEST'`);
  await app.destroy();
  await dueño.destroy();
});

describe('clientes · unicidad del RUC', () => {
  it('rechaza repetir el RUC dentro de la misma empresa', async () => {
    await enContexto(async () => {
      const ruc = `R-${unico()}`;
      await clientes.crear({ nombre: 'Uno', ruc } as never);
      await expect(clientes.crear({ nombre: 'Dos', ruc } as never))
        .rejects.toThrow(/Ya existe un cliente con ese RUC/);
    });
  });

  it('un cliente DADO DE BAJA libera su RUC', async () => {
    // `eliminado_en IS NULL` en la comprobación. Es deliberado: si un RUC
    // quedara reservado para siempre, dar de baja un cliente por error lo
    // dejaría imposible de volver a registrar, y la única salida sería tocar
    // la base a mano.
    await enContexto(async () => {
      const ruc = `R-${unico()}`;
      const c = await clientes.crear({ nombre: 'Original', ruc } as never);
      await clientes.desactivar(String(c.id));
      const reusado = await clientes.crear({ nombre: 'Nuevo con el mismo RUC', ruc } as never);
      expect(reusado.ruc).toBe(ruc);
    });
  });

  it('actualizar un cliente no choca consigo mismo', async () => {
    // Sin el `except`, guardar el formulario sin cambiar el RUC daría
    // «ya existe un cliente con ese RUC» señalando al propio cliente.
    await enContexto(async () => {
      const ruc = `R-${unico()}`;
      const c = await clientes.crear({ nombre: 'Uno', ruc } as never);
      const editado = await clientes.actualizar(String(c.id), { ruc, nombre: 'Uno corregido' } as never);
      expect(editado.nombre).toBe('Uno corregido');
    });
  });

  it('sin RUC no se comprueba nada: es opcional', async () => {
    await enContexto(async () => {
      await clientes.crear({ nombre: 'Sin RUC A' } as never);
      const b = await clientes.crear({ nombre: 'Sin RUC B' } as never);
      expect(b.id).toBeDefined();
    });
  });
});

describe('vehículos · de qué no se puede dar de baja', () => {
  it('no se da de baja un vehículo que está en viaje', async () => {
    // Dejaría un viaje en curso apuntando a una unidad que el sistema considera
    // retirada. La base no lo impide: `estado_operativo` es sólo una cadena.
    await enContexto(async () => {
      const v = await vehiculos.crear({ tipoVehiculo: 'cabezal', placa: `P-${unico()}` } as never);
      await forzar('vehiculos', 'estado_operativo', String(v.id), 'en_viaje', 'vehiculo_id');
      await expect(vehiculos.desactivar(String(v.id)))
        .rejects.toThrow(/está en viaje; no se puede dar de baja/);
    });
  });

  it('no se da de baja un vehículo que sostiene una cisterna', async () => {
    // La cisterna quedaría colgando de un vehículo retirado. El orden importa
    // y el mensaje lo dice: primero la cisterna.
    await enContexto(async () => {
      const v = await vehiculos.crear({ tipoVehiculo: 'cisterna', placa: `P-${unico()}` } as never);
      await cisternas.crear(cisternaCon(String(v.id), [compartimento(1, 5000)]));
      await expect(vehiculos.desactivar(String(v.id)))
        .rejects.toThrow(/tiene una cisterna asociada; da de baja la cisterna primero/);
    });
  });

  it('quitada la cisterna, el vehículo ya se puede retirar', async () => {
    await enContexto(async () => {
      const v = await vehiculos.crear({ tipoVehiculo: 'cisterna', placa: `P-${unico()}` } as never);
      const c = await cisternas.crear(cisternaCon(String(v.id), [compartimento(1, 5000)]));
      await cisternas.desactivar(String(c.id));
      const baja = await vehiculos.desactivar(String(v.id));
      expect(baja.estadoOperativo).toBe('bloqueado');
    });
  });

  it('una placa dada de baja se puede volver a usar', async () => {
    await enContexto(async () => {
      const placa = `P-${unico()}`;
      const v = await vehiculos.crear({ tipoVehiculo: 'cabezal', placa } as never);
      await vehiculos.desactivar(String(v.id));
      const nuevo = await vehiculos.crear({ tipoVehiculo: 'cabezal', placa } as never);
      expect(nuevo.placa).toBe(placa);
    });
  });
});

describe('cisternas · la aritmética de los compartimentos', () => {
  it('los compartimentos no pueden sumar más que la capacidad total', async () => {
    // Una cisterna que dice tener 10.000 y suma 12.000 en compartimentos
    // planifica cargas que no caben, y el error aparece en la terminal.
    await enContexto(async () => {
      const v = await vehiculos.crear({ tipoVehiculo: 'cisterna', placa: `P-${unico()}` } as never);
      await expect(cisternas.crear(
        cisternaCon(String(v.id), [compartimento(1, 6000), compartimento(2, 6000)], 10000)))
        .rejects.toThrow(/suman|capacidad/i);
    });
  });

  it('sumar exactamente la capacidad total SÍ vale', async () => {
    // El límite es «más que», no «igual que»: una cisterna llena hasta el borde
    // de su capacidad declarada es lo normal, no un error.
    await enContexto(async () => {
      const v = await vehiculos.crear({ tipoVehiculo: 'cisterna', placa: `P-${unico()}` } as never);
      const c = await cisternas.crear(
        cisternaCon(String(v.id), [compartimento(1, 5000), compartimento(2, 5000)], 10000));
      expect(c.compartimentos).toHaveLength(2);
    });
  });

  it('rechaza dos compartimentos con el mismo número', async () => {
    // El número es cómo se identifica el compartimento en la terminal y en el
    // plan de carga. Repetido, «el 2» deja de significar algo.
    await enContexto(async () => {
      const v = await vehiculos.crear({ tipoVehiculo: 'cisterna', placa: `P-${unico()}` } as never);
      await expect(cisternas.crear(
        cisternaCon(String(v.id), [compartimento(1, 3000), compartimento(1, 3000)])))
        .rejects.toThrow(/números de compartimento repetidos/);
    });
  });

  it('bajar la capacidad total por debajo de lo que ya suman se rechaza', async () => {
    // La misma regla, por el otro lado: no se puede encoger la cisterna
    // dejando dentro compartimentos que ya no caben.
    await enContexto(async () => {
      const v = await vehiculos.crear({ tipoVehiculo: 'cisterna', placa: `P-${unico()}` } as never);
      const c = await cisternas.crear(
        cisternaCon(String(v.id), [compartimento(1, 5000), compartimento(2, 4000)], 10000));
      await expect(cisternas.actualizar(String(c.id), { capacidadTotal: 8000 } as never))
        .rejects.toThrow(/suman 9000, más que la capacidad total propuesta \(8000\)/);
    });
  });
});

describe('cisternas · sobre qué vehículo se pueden montar', () => {
  it('un cabezal no puede llevar cisterna', async () => {
    // El cabezal es la unidad tractora: la cisterna va detrás. Registrarla
    // sobre un cabezal es un error de captura que después descuadra la flota.
    await enContexto(async () => {
      const v = await vehiculos.crear({ tipoVehiculo: 'cabezal', placa: `P-${unico()}` } as never);
      await expect(cisternas.crear(cisternaCon(String(v.id), [compartimento(1, 5000)])))
        .rejects.toThrow();
    });
  });

  it('un vehículo no admite dos cisternas', async () => {
    await enContexto(async () => {
      const v = await vehiculos.crear({ tipoVehiculo: 'cisterna', placa: `P-${unico()}` } as never);
      await cisternas.crear(cisternaCon(String(v.id), [compartimento(1, 5000)]));
      await expect(cisternas.crear(cisternaCon(String(v.id), [compartimento(1, 4000)])))
        .rejects.toThrow(/ya tiene una cisterna registrada/);
    });
  });

  it('un vehículo inexistente se rechaza con 400, no con un 500 de clave foránea', async () => {
    await enContexto(async () => {
      await expect(cisternas.crear(cisternaCon('999999999', [compartimento(1, 5000)])))
        .rejects.toThrow(/El vehículo indicado no existe/);
    });
  });
});

describe('cisternas · de qué estado no se retira', () => {
  it.each(['cargada', 'en_viaje'])('no se da de baja una cisterna %s', async estado => {
    // Con producto dentro o rodando: retirarla del catálogo deja el volumen
    // cargado sin dueño en el sistema.
    await enContexto(async () => {
      const v = await vehiculos.crear({ tipoVehiculo: 'cisterna', placa: `P-${unico()}` } as never);
      const c = await cisternas.crear(cisternaCon(String(v.id), [compartimento(1, 5000)]));
      await forzar('cisternas', 'estado', String(c.id), estado, 'cisterna_id');
      await expect(cisternas.desactivar(String(c.id)))
        .rejects.toThrow(new RegExp(`está ${estado}; no se puede dar de baja`));
    });
  });

  it('disponible sí se retira, y queda en mantenimiento', async () => {
    await enContexto(async () => {
      const v = await vehiculos.crear({ tipoVehiculo: 'cisterna', placa: `P-${unico()}` } as never);
      const c = await cisternas.crear(cisternaCon(String(v.id), [compartimento(1, 5000)]));
      await cisternas.desactivar(String(c.id));
      const [fila] = await gestor().query(
        `SELECT estado FROM cisternas WHERE cisterna_id = $1`, [String(c.id)]);
      expect(fila.estado).toBe('mantenimiento');
    });
  });
});

describe('conductores · documento y licencia son cosas distintas', () => {
  it('el mensaje dice CUÁL de los dos choca', async () => {
    // Un «ya existe un conductor con esos datos» obliga a adivinar cuál de los
    // dos campos corregir.
    await enContexto(async () => {
      const doc = `D-${unico()}`, lic = `L-${unico()}`;
      await conductores.crear({ nombreCompleto: 'Chofer Uno', documento: doc, licencia: lic } as never);

      await expect(conductores.crear(
        { nombreCompleto: 'Chofer Dos', documento: doc, licencia: `L-${unico()}` } as never))
        .rejects.toThrow(/con ese documento/);

      await expect(conductores.crear(
        { nombreCompleto: 'Chofer Tres', documento: `D-${unico()}`, licencia: lic } as never))
        .rejects.toThrow(/con esa licencia/);
    });
  });

  it('no se da de baja un conductor que está en viaje', async () => {
    await enContexto(async () => {
      const c = await conductores.crear({
        nombreCompleto: 'Chofer En Ruta', documento: `D-${unico()}`, licencia: `L-${unico()}`,
      } as never);
      await forzar('conductores', 'estado', String(c.id), 'en_viaje', 'conductor_id');
      await expect(conductores.desactivar(String(c.id)))
        .rejects.toThrow(/está en viaje; no se puede dar de baja/);
    });
  });

  it('al darlo de baja queda suspendido, no borrado', async () => {
    // La baja es lógica en los siete catálogos: los viajes históricos siguen
    // apuntando a este conductor y tienen que poder leer su nombre.
    await enContexto(async () => {
      const c = await conductores.crear({
        nombreCompleto: 'Chofer Saliente', documento: `D-${unico()}`, licencia: `L-${unico()}`,
      } as never);
      const baja = await conductores.desactivar(String(c.id));
      expect(baja.estado).toBe('suspendido');
      const [fila] = await gestor().query(
        `SELECT nombre_completo FROM conductores WHERE conductor_id = $1`, [String(c.id)]);
      expect(fila.nombre_completo).toBe('Chofer Saliente');
    });
  });
});

describe('estaciones · coordenadas y pertenencia', () => {
  it('latitud sin longitud se rechaza', async () => {
    // Media coordenada no ubica nada, y guardada a medias haría que el mapa
    // pintara la estación en el meridiano cero.
    await enContexto(async () => {
      const c = await clientes.crear({ nombre: `Cliente ${unico()}` } as never);
      await expect(estaciones.crear(
        { clienteId: String(c.id), nombre: 'Media coordenada', latitud: 8.98 } as never))
        .rejects.toThrow(/Latitud y longitud deben ir juntas/);
    });
  });

  it('longitud sin latitud tampoco', async () => {
    await enContexto(async () => {
      const c = await clientes.crear({ nombre: `Cliente ${unico()}` } as never);
      await expect(estaciones.crear(
        { clienteId: String(c.id), nombre: 'La otra mitad', longitud: -79.52 } as never))
        .rejects.toThrow(/Latitud y longitud deben ir juntas/);
    });
  });

  it('las dos juntas se aceptan', async () => {
    await enContexto(async () => {
      const c = await clientes.crear({ nombre: `Cliente ${unico()}` } as never);
      const e = await estaciones.crear({
        clienteId: String(c.id), nombre: 'Con coordenadas', latitud: 8.98, longitud: -79.52,
      } as never);
      expect(e.id).toBeDefined();
    });
  });

  it('ninguna de las dos también vale: son opcionales', async () => {
    await enContexto(async () => {
      const c = await clientes.crear({ nombre: `Cliente ${unico()}` } as never);
      const e = await estaciones.crear({ clienteId: String(c.id), nombre: 'Sin ubicar' } as never);
      expect(e.id).toBeDefined();
    });
  });

  it('un cliente inexistente da 400 con explicación, no un 500 de clave foránea', async () => {
    await enContexto(async () => {
      await expect(estaciones.crear({ clienteId: '999999999', nombre: 'Huérfana' } as never))
        .rejects.toThrow(/El cliente indicado no existe/);
    });
  });
});

describe('productos · no se retira lo que está en uso', () => {
  it('rechaza dar de baja un producto declarado en un compartimento', async () => {
    // Los compartimentos que lo declaran permitido quedarían apuntando a un
    // catálogo muerto, y el plan de carga de 1B validaría contra algo que ya
    // no existe. Ninguna clave foránea lo impide: la fila sigue ahí, sólo
    // marcada como eliminada.
    await enContexto(async () => {
      const p = await productos.crear({ codigo: `C-${unico()}`, nombre: 'Gasolina 95' } as never);
      const v = await vehiculos.crear({ tipoVehiculo: 'cisterna', placa: `P-${unico()}` } as never);
      await cisternas.crear(cisternaCon(String(v.id),
        [{ ...compartimento(1, 5000), productoPermitido: String(p.id) }]));

      await expect(productos.desactivar(String(p.id)))
        .rejects.toThrow(/asignado a compartimentos; quítalo de ellos antes/);
    });
  });

  it('un producto que nadie declara sí se retira', async () => {
    await enContexto(async () => {
      const p = await productos.crear({ codigo: `C-${unico()}`, nombre: 'Sin usar' } as never);
      const baja = await productos.desactivar(String(p.id));
      expect(baja.estado).toBe('inactivo');
    });
  });

  it('rechaza repetir el código', async () => {
    await enContexto(async () => {
      const codigo = `C-${unico()}`;
      await productos.crear({ codigo, nombre: 'Primero' } as never);
      await expect(productos.crear({ codigo, nombre: 'Segundo' } as never))
        .rejects.toThrow(/Ya existe un producto con ese código/);
    });
  });
});
