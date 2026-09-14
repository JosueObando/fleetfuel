import 'reflect-metadata';
import { config as cargarEnv } from 'dotenv';
import { DataSource } from 'typeorm';
import { BadRequestException } from '@nestjs/common';
import { join } from 'path';

import { OrdenesService } from '../src/modules/ordenes/ordenes.service';
import { ejecutarEnContexto, gestor } from '../src/common/contexto/contexto-peticion';

cargarEnv({ path: join(__dirname, '../../.env') });

/**
 * Las reglas de `OrdenesService` que no tienen respaldo en la base.
 *
 * Igual que en viajes: la CHECK de `estado` sólo comprueba que el valor sea uno
 * de los válidos, nunca que la transición desde el anterior lo sea. Y las
 * validaciones de coherencia —que la estación sea del cliente, que no se repita
 * un producto— no las hace ninguna restricción: viven en el servicio.
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

const servicio = new OrdenesService();

let empresa: string, usuario: string, cliente: string, otroCliente: string;
let estacion: string, estacionAjena: string, producto: string, otroProducto: string;

async function enServicio<T>(fn: (s: OrdenesService) => Promise<T>): Promise<T> {
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

const ordenBase = (extra: Record<string, unknown> = {}) => ({
  clienteId: cliente,
  estacionId: estacion,
  detalles: [{ productoId: producto, volumenSolicitado: 3000 }],
  ...extra,
}) as never;

beforeAll(async () => {
  await dueño.initialize();
  await app.initialize();

  const [e] = await dueño.query(
    `INSERT INTO empresas (nombre, ruc) VALUES ('Ordenes Test','ORD-TEST')
     ON CONFLICT (ruc) DO UPDATE SET nombre = EXCLUDED.nombre RETURNING empresa_id`);
  empresa = String(e.empresa_id);

  const [u] = await dueño.query(
    `INSERT INTO usuarios (empresa_id, nombre, correo, hash_clave)
     VALUES ($1,'Planificador','ord-test@ejemplo.test','x') RETURNING usuario_id`, [empresa]);
  usuario = String(u.usuario_id);

  const [c1] = await dueño.query(
    `INSERT INTO clientes (empresa_id, nombre) VALUES ($1,'Cliente Uno') RETURNING cliente_id`, [empresa]);
  cliente = String(c1.cliente_id);
  const [c2] = await dueño.query(
    `INSERT INTO clientes (empresa_id, nombre) VALUES ($1,'Cliente Dos') RETURNING cliente_id`, [empresa]);
  otroCliente = String(c2.cliente_id);

  const [s1] = await dueño.query(
    `INSERT INTO estaciones_servicio (empresa_id, cliente_id, nombre)
     VALUES ($1,$2,'Estación del Uno') RETURNING estacion_id`, [empresa, cliente]);
  estacion = String(s1.estacion_id);
  const [s2] = await dueño.query(
    `INSERT INTO estaciones_servicio (empresa_id, cliente_id, nombre)
     VALUES ($1,$2,'Estación del Dos') RETURNING estacion_id`, [empresa, otroCliente]);
  estacionAjena = String(s2.estacion_id);

  const [p1] = await dueño.query(
    `INSERT INTO productos_combustible (empresa_id, codigo, nombre)
     VALUES ($1,'ORD-95','Gasolina 95') RETURNING producto_id`, [empresa]);
  producto = String(p1.producto_id);
  const [p2] = await dueño.query(
    `INSERT INTO productos_combustible (empresa_id, codigo, nombre)
     VALUES ($1,'ORD-DSL','Diésel') RETURNING producto_id`, [empresa]);
  otroProducto = String(p2.producto_id);
});

afterAll(async () => {
  for (const t of ['plan_carga', 'viaje_ordenes', 'viajes', 'detalles_orden',
                   'ordenes_abastecimiento', 'estaciones_servicio', 'clientes',
                   'productos_combustible', 'auditoria', 'usuarios']) {
    await dueño.query(`DELETE FROM ${t} WHERE empresa_id = $1`, [empresa]);
  }
  await dueño.query(`DELETE FROM empresas WHERE ruc = 'ORD-TEST'`);
  await app.destroy();
  await dueño.destroy();
});

describe('crear · coherencia que ninguna restricción comprueba', () => {
  it('rechaza una estación que no es del cliente', async () => {
    // Sin esto se puede pedir combustible «para el cliente A, entregado en la
    // gasolinera de B». Ninguna clave foránea lo impide: las dos existen.
    await enServicio(async s => {
      await expect(s.crear(ordenBase({ estacionId: estacionAjena })))
        .rejects.toThrow(/no pertenece al cliente indicado/);
    });
  });

  it('rechaza una estación que no existe', async () => {
    await enServicio(async s => {
      await expect(s.crear(ordenBase({ estacionId: '999999999' })))
        .rejects.toThrow(/La estación indicada no existe/);
    });
  });

  it('rechaza el mismo producto dos veces en la misma orden', async () => {
    // Dos líneas del mismo producto se suman mal en el plan de carga y
    // producen una diferencia de volumen que después nadie sabe explicar.
    await enServicio(async s => {
      await expect(s.crear(ordenBase({
        detalles: [
          { productoId: producto, volumenSolicitado: 1000 },
          { productoId: producto, volumenSolicitado: 2000 },
        ],
      }))).rejects.toThrow(/productos repetidos/);
    });
  });

  it('acepta productos distintos y suma el volumen total', async () => {
    await enServicio(async s => {
      const o = await s.crear(ordenBase({
        detalles: [
          { productoId: producto, volumenSolicitado: 1000 },
          { productoId: otroProducto, volumenSolicitado: 2500 },
        ],
      }));
      expect(Number(o.volumenTotal)).toBe(3500);
      expect(o.detalles).toHaveLength(2);
    });
  });

  it('nace «recibida», como dice el §9', async () => {
    await enServicio(async s => {
      const o = await s.crear(ordenBase());
      expect(o.estado).toBe('recibida');
    });
  });
});

describe('cambiarEstado · el flujo del §8.1', () => {
  it('rechaza un salto que no está en el flujo', async () => {
    await enServicio(async s => {
      const o = await s.crear(ordenBase());
      await expect(s.cambiarEstado(String(o.id), { estado: 'entregada' }))
        .rejects.toThrow(/No se puede pasar de "recibida" a "entregada"/);
    });
  });

  it('los estados que sacan la orden del flujo exigen motivo', async () => {
    // Rechazar, cancelar, suspender o marcar incidencia son decisiones que
    // alguien tendrá que justificar después; el momento de escribirlo es ahora.
    await enServicio(async s => {
      const o = await s.crear(ordenBase());
      for (const estado of ['rechazada', 'cancelada', 'suspendida']) {
        await expect(s.cambiarEstado(String(o.id), { estado }))
          .rejects.toThrow(new RegExp(`Pasar a "${estado}" exige indicar el motivo`));
      }
    });
  });

  it('con motivo, sí deja y lo guarda', async () => {
    await enServicio(async s => {
      const o = await s.crear(ordenBase());
      const r = await s.cambiarEstado(String(o.id),
        { estado: 'rechazada', motivo: 'La estación está en obra' });
      expect(r.estado).toBe('rechazada');
    });
  });

  it('avanzar por el camino normal NO pide motivo', async () => {
    await enServicio(async s => {
      const o = await s.crear(ordenBase());
      const v = await s.cambiarEstado(String(o.id), { estado: 'validada' });
      expect(v.estado).toBe('validada');
    });
  });

  it('de un estado terminal no se sale', async () => {
    await enServicio(async s => {
      const o = await s.crear(ordenBase());
      await s.cambiarEstado(String(o.id), { estado: 'cancelada', motivo: 'Duplicada' });
      await expect(s.cambiarEstado(String(o.id), { estado: 'validada' }))
        .rejects.toThrow(/es un estado final|No se puede pasar/);
    });
  });
});

describe('actualizar · una orden que ya salió no se reprograma editando', () => {
  it('deja editar mientras está recibida o validada', async () => {
    await enServicio(async s => {
      const o = await s.crear(ordenBase());
      const editada = await s.actualizar(String(o.id), { prioridad: 'alta' });
      expect(editada.prioridad).toBe('alta');
    });
  });

  it('rechaza editar una vez planificada', async () => {
    // Sus viajes ya están armados sobre esos datos: mover la ventana de entrega
    // por detrás dejaría el viaje y la orden contando cosas distintas.
    await enServicio(async s => {
      const o = await s.crear(ordenBase());
      await s.cambiarEstado(String(o.id), { estado: 'validada' });
      await s.cambiarEstado(String(o.id), { estado: 'planificada' });
      await expect(s.actualizar(String(o.id), { prioridad: 'alta' }))
        .rejects.toThrow(/ya no admite cambios de programación/);
    });
  });

  it('la lista y el detalle dicen si la orden ADMITE edición, calculado aquí', async () => {
    // Igual que `transicionesPosibles`: sin esto la interfaz copiaría la lista
    // de estados editables, y la copia diverge el día que cambie la regla.
    await enServicio(async s => {
      const o = await s.crear(ordenBase());
      const deLaLista = async () =>
        (await s.listar()).find((f: { id: unknown }) => String(f.id) === String(o.id));
      expect((await deLaLista()).admiteEdicion).toBe(true);
      expect((await s.obtener(String(o.id))).admiteEdicion).toBe(true);

      await s.cambiarEstado(String(o.id), { estado: 'validada' });
      await s.cambiarEstado(String(o.id), { estado: 'planificada' });
      expect((await deLaLista()).admiteEdicion).toBe(false);
      expect((await s.obtener(String(o.id))).admiteEdicion).toBe(false);
    });
  });

  /* El estado de la orden NO avanza solo cuando su viaje avanza: en desarrollo
     había diez órdenes «validada» dentro de viajes CERRADOS. Mirar sólo el
     estado dejaba reprogramar una entrega que ya ocurrió. Lo que la regla
     protege —«sus viajes ya están armados sobre esos datos»— se mira en el
     viaje: una vez autorizado, ya no se planifica. */
  const enViaje = async (ordenId: string, estadoViaje: string) => {
    const [v] = await gestor().query(
      `INSERT INTO viajes (empresa_id, codigo_viaje, fecha_programada, estado, motivo_cancelacion)
       VALUES ($1, $2, '2027-01-01T08:00:00Z', $3, $4) RETURNING viaje_id`,
      [empresa, `ORD-V-${Math.random().toString(36).slice(2, 9)}`, estadoViaje,
       estadoViaje === 'cancelado' ? 'prueba' : null]);
    await gestor().query(
      `INSERT INTO viaje_ordenes (empresa_id, viaje_id, orden_id, secuencia_entrega) VALUES ($1,$2,$3,1)`,
      [empresa, v.viaje_id, ordenId]);
  };

  it.each(['autorizado', 'cerrado'])('en un viaje %s ya no admite edición, aunque siga «validada»', async estadoViaje => {
    await enServicio(async s => {
      const o = await s.crear(ordenBase());
      await s.cambiarEstado(String(o.id), { estado: 'validada' });
      await enViaje(String(o.id), estadoViaje);

      const detalle = await s.obtener(String(o.id));
      expect(detalle.admiteEdicion).toBe(false);
      const deLaLista = (await s.listar()).find((f: { id: unknown }) => String(f.id) === String(o.id));
      expect(deLaLista.admiteEdicion).toBe(false);
      // El paso intermedio de la consulta no forma parte de la respuesta.
      expect(detalle).not.toHaveProperty('enViajeQueSalio');
      expect(deLaLista).not.toHaveProperty('enViajeQueSalio');
      await expect(s.actualizar(String(o.id), { prioridad: 'alta' }))
        .rejects.toThrow('La orden va en un viaje que ya salió: no admite cambios de programación');
    });
  });

  it.each(['borrador', 'programado', 'cancelado'])('en un viaje %s todavía se corrige', async estadoViaje => {
    // Mientras el viaje se planifica, ajustar la orden es justo lo que se hace;
    // un viaje cancelado ya no la lleva a ningún sitio.
    await enServicio(async s => {
      const o = await s.crear(ordenBase());
      await s.cambiarEstado(String(o.id), { estado: 'validada' });
      await enViaje(String(o.id), estadoViaje);

      expect((await s.obtener(String(o.id))).admiteEdicion).toBe(true);
      expect((await s.actualizar(String(o.id), { prioridad: 'alta' })).prioridad).toBe('alta');
    });
  });

  it('una suspendida SÍ se puede corregir: es de lo que se vuelve', async () => {
    await enServicio(async s => {
      const o = await s.crear(ordenBase());
      await s.cambiarEstado(String(o.id), { estado: 'suspendida', motivo: 'Falta documento' });
      const editada = await s.actualizar(String(o.id), { observaciones: 'Documento recibido' });
      expect(editada.observaciones).toBe('Documento recibido');
    });
  });
});

describe('la ventana de entrega no termina antes de empezar', () => {
  /* `ck_ordenes_ventana` la decide el motor sobre la fila ENTERA. Se fija que
     llegue como 400 legible: la pantalla de edición cambia un extremo de la
     ventana y el otro ya está guardado, así que la petición sola no lo delata. */
  it('al crear, una ventana invertida es un 400 que dice qué corregir', async () => {
    await enServicio(async s => {
      const intento = s.crear(ordenBase({
        ventanaInicio: '2026-10-01T14:00:00Z', ventanaFin: '2026-10-01T08:00:00Z' }));
      await expect(intento).rejects.toBeInstanceOf(BadRequestException);
      await expect(intento).rejects.toThrow('La ventana de entrega termina antes de empezar');
    });
  });

  it('al editar SÓLO el fin, se compara con el inicio ya guardado', async () => {
    await enServicio(async s => {
      const o = await s.crear(ordenBase({
        ventanaInicio: '2026-10-01T08:00:00Z', ventanaFin: '2026-10-01T14:00:00Z' }));
      const intento = s.actualizar(String(o.id), { ventanaFin: '2026-10-01T06:00:00Z' });
      await expect(intento).rejects.toBeInstanceOf(BadRequestException);
      await expect(intento).rejects.toThrow('La ventana de entrega termina antes de empezar');
    });
  });
});

describe('los estados viven en DOS sitios y tienen que decir lo mismo', () => {
  it('el flujo del código y la CHECK de la base coinciden', async () => {
    const { FLUJO_ORDEN } = await import('../src/modules/ordenes/estados');
    const [{ def }] = await dueño.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'ck_ordenes_estado'`);
    const enLaBase = [...String(def).matchAll(/'([a-z_]+)'::character varying/g)].map(m => m[1]).sort();
    expect(Object.keys(FLUJO_ORDEN).sort()).toEqual(enLaBase);
  });
});
