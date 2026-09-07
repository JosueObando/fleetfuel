import 'reflect-metadata';
import { config as cargarEnv } from 'dotenv';
import { DataSource } from 'typeorm';
import { join } from 'path';

import { EntregasService } from '../src/modules/entregas/entregas.service';
import { ejecutarEnContexto, gestor } from '../src/common/contexto/contexto-peticion';

cargarEnv({ path: join(__dirname, '../../.env') });

/**
 * Las reglas de la entrega en estación (§7.14, §10.4, §10.5 y las reglas 7, 8,
 * 9 y 20 del §11).
 *
 * Es el eslabón que cierra `orden → plan de carga → viaje → entrega`, y trae la
 * conciliación de volúmenes del §17. NO trae liquidaciones: ésas esperan a la
 * compuerta 🏁, que existe sobre todo por ellas.
 *
 * Igual que en viajes, se ejercita el servicio de verdad contra Postgres, en
 * una transacción por prueba que termina en ROLLBACK.
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

const servicio = new EntregasService();
let secuenciaViaje = 0;
/** El último viaje creado, para poder cerrarlo antes de abrir otro. */
let ultimoViaje: string | null = null;

/** Azúcar para leer las dos aserciones de la regla 9 de un vistazo. */
const e_pendiente = (e: { estado: string; requiereAprobacion: boolean }) =>
  e.estado === 'pendiente' && e.requiereAprobacion;

let empresa: string, usuario: string, cisterna: string, compartimento: string;
let compartimentoAjeno: string, conductor: string, producto: string;
let cliente: string, estacion: string, orden: string, detalleOrden: string;

async function enServicio<T>(fn: (s: EntregasService) => Promise<T>): Promise<T> {
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
    // El ROLLBACK se lleva los viajes, así que el rastro tiene que morir con
    // ellos: si no, la prueba siguiente intentaría cerrar un id que ya no está.
    ultimoViaje = null;
  }
}

/**
 * Un viaje descargando, con su orden asignada y su plan de carga.
 *
 * Se arma con el gestor de la PETICIÓN y no con la conexión de dueño: montarlo
 * desde fuera de la transacción y limpiarlo después bloqueaba el `DELETE FROM
 * viajes` contra las filas que la transacción abierta seguía referenciando —un
 * INSERT en `plan_carga` toma un `FOR KEY SHARE` sobre el viaje—. Dentro de la
 * transacción no hay dos conexiones que puedan esperarse, y el ROLLBACK se
 * lleva todo sin necesidad de limpiar nada.
 */
async function viajeDescargando(planificado = 3000): Promise<string> {
  // El `periodo` de un viaje es un rango SIN cota superior mientras no tiene
  // `fecha_fin`, así que su cisterna y su conductor siguen ocupados para
  // siempre y un segundo viaje choca con la exclusión del §5.1. Se cierra el
  // anterior —que es lo que pasa de verdad cuando el camión vuelve— en vez de
  // aflojar la restricción, que es correcta.
  if (ultimoViaje) {
    await gestor().query(
      `UPDATE viajes SET estado = 'cerrado', fecha_fin = fecha_programada + interval '4 hours'
        WHERE viaje_id = $1 AND estado <> 'cerrado'`, [ultimoViaje]);
  }
  const [v] = await gestor().query(
    `INSERT INTO viajes (empresa_id, codigo_viaje, tipo_viaje, cisterna_id, conductor_id,
                         fecha_programada, estado)
     VALUES ($1,$2,'simple',$3,$4,$5,'descargando') RETURNING viaje_id`,
    [empresa, `ENT-${Math.random().toString(36).slice(2, 9)}`, cisterna, conductor,
     // Fecha distinta en cada llamada: dos viajes de la misma cisterna que se
     // superpongan chocan con la restricción de exclusión del §5.1, que es
     // correcta y no se toca desde aquí.
     new Date(Date.UTC(2029, 0, 1 + secuenciaViaje++, 8)).toISOString()]);
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

/** Lo mínimo que una entrega necesita para ser válida. */
const entregaBase = (extra: Record<string, unknown> = {}) => ({
  detalleOrdenId: detalleOrden,
  compartimentoId: compartimento,
  volumenRecibido: 3000,
  receptorNombre: 'Ana Receptora',
  latitud: 8.9824,
  longitud: -79.5199,
  ...extra,
});

beforeAll(async () => {
  await dueño.initialize();
  await app.initialize();

  const [e] = await dueño.query(
    `INSERT INTO empresas (nombre, ruc) VALUES ('Entregas Test','ENT-TEST')
     ON CONFLICT (ruc) DO UPDATE SET nombre = EXCLUDED.nombre RETURNING empresa_id`);
  empresa = String(e.empresa_id);

  const [u] = await dueño.query(
    `INSERT INTO usuarios (empresa_id, nombre, correo, hash_clave)
     VALUES ($1,'Supervisor','ent-test@ejemplo.test','x') RETURNING usuario_id`, [empresa]);
  usuario = String(u.usuario_id);

  const [veh] = await dueño.query(
    `INSERT INTO vehiculos (empresa_id, tipo_vehiculo, placa) VALUES ($1,'cisterna','ENT-1')
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
     VALUES ($1,'Chofer Ent','ENT-D1','ENT-L1') RETURNING conductor_id`, [empresa]);
  conductor = String(cd.conductor_id);

  const [cli] = await dueño.query(
    `INSERT INTO clientes (empresa_id, nombre) VALUES ($1,'Cliente Ent') RETURNING cliente_id`,
    [empresa]);
  cliente = String(cli.cliente_id);
  const [est] = await dueño.query(
    `INSERT INTO estaciones_servicio (empresa_id, cliente_id, nombre)
     VALUES ($1,$2,'Estación Ent') RETURNING estacion_id`, [empresa, cliente]);
  estacion = String(est.estacion_id);
  const [p] = await dueño.query(
    `INSERT INTO productos_combustible (empresa_id, codigo, nombre, tolerancia_merma)
     VALUES ($1,'ENT-95','Gasolina 95', 0.5) RETURNING producto_id`, [empresa]);
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
  for (const t of ['entregas', 'plan_carga', 'viaje_ordenes', 'viajes','detalles_orden', 'ordenes_abastecimiento', 'estaciones_servicio', 'clientes',
                   'compartimentos_cisterna', 'productos_combustible', 'cisternas',
                   'vehiculos', 'conductores', 'auditoria', 'usuarios']) {
    await dueño.query(`DELETE FROM ${t} WHERE empresa_id = $1`, [empresa]);
  }
  await dueño.query(`DELETE FROM empresas WHERE ruc = 'ENT-TEST'`);
  await app.destroy();
  await dueño.destroy();
});

describe('registrar · regla 7, toda entrega va contra una orden DE ESTE VIAJE', () => {
  it('una línea de orden que no está en el viaje se rechaza', async () => {
    await enServicio(async (s) => {
      const viaje = await viajeDescargando();
      await expect(s.registrar(viaje, entregaBase({ detalleOrdenId: '999999999' })))
        .rejects.toThrow(/no pertenece a ninguna orden asignada a este viaje/);
    });
  });

  it('un compartimento sin carga planificada de esa línea se rechaza', async () => {
    // Regla 17: toda carga se relaciona con un compartimento. Entregar desde
    // uno que nunca llevó ese producto es combustible que no salió de ahí.
    await enServicio(async (s) => {
      const viaje = await viajeDescargando();
      await expect(s.registrar(viaje, entregaBase({ compartimentoId: compartimentoAjeno })))
        .rejects.toThrow(/no lleva carga de esa línea/);
    });
  });

  it('sólo se entrega con el viaje descargando', async () => {
    await enServicio(async (s) => {
      const viaje = await viajeDescargando();
      await gestor().query(`UPDATE viajes SET estado = 'cargado' WHERE viaje_id = $1`, [viaje]);
      await expect(s.registrar(viaje, entregaBase()))
        .rejects.toThrow(/está "cargado"/);
    });
  });
});

describe('registrar · regla 20, la entrega parcial mueve el volumen pendiente', () => {
  it('lo entregado se acumula en la línea y el pendiente baja solo', async () => {
    await enServicio(async (s) => {
      const viaje = await viajeDescargando();
      await s.registrar(viaje, entregaBase({ volumenRecibido: 1200 }));
      const d = await s.lineaDeOrden(detalleOrden);
      expect(Number(d.volumenEntregado)).toBe(1200);
      // `volumen_pendiente` es GENERATED: nadie lo escribe, y por eso no puede
      // discrepar de lo entregado.
      expect(Number(d.volumenPendiente)).toBe(3800);
    });
  });

  it('dos entregas parciales suman', async () => {
    await enServicio(async (s) => {
      const viaje = await viajeDescargando();
      await s.registrar(viaje, entregaBase({ volumenRecibido: 1000 }));
      await s.registrar(viaje, entregaBase({ volumenRecibido: 800 }));
      const d = await s.lineaDeOrden(detalleOrden);
      expect(Number(d.volumenEntregado)).toBe(1800);
    });
  });

  it('recibir MÁS de lo cargado se registra, y queda pendiente de aprobación', async () => {
    // Decisión deliberada, y es la que más importa de este módulo: NO se
    // bloquea. Los medidores de la terminal y de la estación no coinciden
    // nunca al litro, y rechazar la lectura obliga a quien captura a redondear
    // hasta que el sistema la acepte. Eso no evita el descuadre: lo BORRA, y
    // justo el descuadre es la señal de fraude de volumen que el §7 dice que es
    // el riesgo principal de este negocio.
    //
    // Así que se acepta, se calcula la merma negativa, y la regla 9 la manda a
    // aprobación de otro rol. Lo que sí es un tope duro es el de la regla 20,
    // que vive en la base: no se puede entregar más de lo que la orden pidió.
    await enServicio(async (s) => {
      const viaje = await viajeDescargando(3000);
      const e = await s.registrar(viaje, entregaBase({ volumenRecibido: 3060 }));
      expect(Number(e.diferenciaVolumen)).toBe(-60);
      expect(Number(e.porcentajeMerma)).toBeCloseTo(-2, 4);
      expect(e.estado).toBe('pendiente');
      expect(e.requiereAprobacion).toBe(true);
    });
  });

  it('la base impide dejar el pendiente en negativo, venga por donde venga', async () => {
    // La cota vive en la base y no sólo en el servicio, por lo mismo que
    // `ck_detalles_planificado_cabe`: un pendiente negativo haría que la orden
    // pareciera deber volumen que ya se entregó.
    await enServicio(async (s) => {
      const { gestor } = await import('../src/common/contexto/contexto-peticion');
      await expect(gestor().query(
        `UPDATE detalles_orden SET volumen_entregado = 6000 WHERE detalle_orden_id = $1`,
        [detalleOrden])).rejects.toThrow(/ck_detalles_entregado_cabe/);
      void s;
    });
  });
});

describe('registrar · §10.4 y §10.5, los volúmenes y la merma', () => {
  it('calcula la diferencia y el porcentaje de merma, y no deja escribirlos', async () => {
    await enServicio(async (s) => {
      const viaje = await viajeDescargando(3000);
      const e = await s.registrar(viaje, entregaBase({ volumenRecibido: 2985 }));
      expect(Number(e.volumenCargado)).toBe(3000);
      expect(Number(e.diferenciaVolumen)).toBe(15);
      expect(Number(e.porcentajeMerma)).toBeCloseTo(0.5, 4);
    });
  });

  it('§10.4 · con medidores, el volumen descargado sale de la resta', async () => {
    await enServicio(async (s) => {
      const viaje = await viajeDescargando(3000);
      const e = await s.registrar(viaje, entregaBase({
        volumenRecibido: 2990, medidorInicial: 10_000, medidorFinal: 12_990,
      }));
      expect(Number(e.volumenDescargado)).toBe(2990);
    });
  });

  it('un medidor que retrocede es un dato mal capturado', async () => {
    await enServicio(async (s) => {
      const viaje = await viajeDescargando(3000);
      await expect(s.registrar(viaje, entregaBase({
        medidorInicial: 12_990, medidorFinal: 10_000,
      }))).rejects.toThrow(/medidor final/i);
    });
  });
});

describe('registrar · regla 9, la diferencia fuera de tolerancia necesita aprobación', () => {
  it('dentro de tolerancia la entrega queda aceptada sola', async () => {
    // La línea tolera 1,0 % y la merma es del 0,5 %.
    await enServicio(async (s) => {
      const viaje = await viajeDescargando(3000);
      const e = await s.registrar(viaje, entregaBase({ volumenRecibido: 2985 }));
      expect(e.estado).toBe('aceptada');
      expect(e.requiereAprobacion).toBe(false);
    });
  });

  it('fuera de tolerancia queda PENDIENTE, no aceptada', async () => {
    await enServicio(async (s) => {
      const viaje = await viajeDescargando(3000);
      const e = await s.registrar(viaje, entregaBase({ volumenRecibido: 2900 }));
      expect(Number(e.porcentajeMerma)).toBeCloseTo(3.3333, 3);
      expect(e.estado).toBe('pendiente');
      expect(e.requiereAprobacion).toBe(true);
    });
  });

  it('la tolerancia se mide en VALOR ABSOLUTO, no sólo por el lado de la merma', async () => {
    // Mirar sólo el lado positivo dejaría pasar en silencio la mitad exacta de
    // los descuadres: recibir de más es tan anómalo como recibir de menos, y en
    // un negocio cuyo riesgo es el fraude de volumen, la mitad que se ignora es
    // la que conviene usar.
    // Dos viajes y no una entrega borrada: el rol de aplicación no tiene DELETE
    // sobre `entregas`, y eso es la regla 14 —«los registros críticos no podrán
    // eliminarse físicamente»— haciendo su trabajo. Una prueba no es motivo
    // para aflojarla.
    await enServicio(async (s) => {
      const menos = await s.registrar(await viajeDescargando(1000),
        entregaBase({ volumenRecibido: 950 }));
      expect(Number(menos.porcentajeMerma)).toBeCloseTo(5, 4);
      expect(e_pendiente(menos)).toBe(true);

      const mas = await s.registrar(await viajeDescargando(1000),
        entregaBase({ volumenRecibido: 1050 }));
      expect(Number(mas.porcentajeMerma)).toBeCloseTo(-5, 4);
      expect(e_pendiente(mas)).toBe(true);
    });
  });

  it('exactamente en el límite de tolerancia se acepta: la cota no es estricta', async () => {
    // 1,0 % de 3000 son 30 litros exactos.
    await enServicio(async (s) => {
      const viaje = await viajeDescargando(3000);
      const e = await s.registrar(viaje, entregaBase({ volumenRecibido: 2970 }));
      expect(Number(e.porcentajeMerma)).toBeCloseTo(1, 4);
      expect(e.estado).toBe('aceptada');
    });
  });

  it('aprobar deja constancia de QUIÉN y CUÁNDO', async () => {
    await enServicio(async (s) => {
      const viaje = await viajeDescargando(3000);
      const e = await s.registrar(viaje, entregaBase({ volumenRecibido: 2900 }));
      const aprobada = await s.aprobar(String(e.id), { motivo: 'Merma verificada en terminal' });
      expect(aprobada.estado).toBe('aceptada');
      expect(String(aprobada.aprobadaPor)).toBe(usuario);
      expect(aprobada.aprobadaEn).not.toBeNull();
      expect(aprobada.motivoAprobacion).toBe('Merma verificada en terminal');
    });
  });

  it('aprobar exige motivo: una diferencia perdonada sin razón no es auditable', async () => {
    await enServicio(async (s) => {
      const viaje = await viajeDescargando(3000);
      const e = await s.registrar(viaje, entregaBase({ volumenRecibido: 2900 }));
      await expect(s.aprobar(String(e.id), {} as never)).rejects.toThrow(/motivo/i);
    });
  });

  it('una entrega que ya estaba aceptada no se vuelve a aprobar', async () => {
    await enServicio(async (s) => {
      const viaje = await viajeDescargando(3000);
      const e = await s.registrar(viaje, entregaBase({ volumenRecibido: 2985 }));
      await expect(s.aprobar(String(e.id), { motivo: 'da igual' }))
        .rejects.toThrow(/no está pendiente/);
    });
  });
});

describe('regla 8 · sin geolocalización no hay entrega', () => {
  it('la base la exige, no sólo el DTO', async () => {
    await enServicio(async () => {
      const { gestor } = await import('../src/common/contexto/contexto-peticion');
      await expect(gestor().query(
        `INSERT INTO entregas (empresa_id, viaje_id, orden_id, detalle_orden_id, estacion_id,
                               producto_id, compartimento_id, volumen_cargado, volumen_recibido,
                               receptor_nombre, latitud, longitud)
         VALUES ($1,1,1,1,1,1,1,100,100,'X',NULL,NULL)`, [empresa]))
        .rejects.toThrow(/latitud/);
    });
  });

  it('una coordenada imposible se rechaza', async () => {
    await enServicio(async (s) => {
      const viaje = await viajeDescargando();
      await expect(s.registrar(viaje, entregaBase({ latitud: 120 })))
        .rejects.toThrow();
    });
  });
});

describe('listar y obtener', () => {
  it('las entregas del viaje salen con sus volúmenes', async () => {
    await enServicio(async (s) => {
      const viaje = await viajeDescargando(3000);
      await s.registrar(viaje, entregaBase({ volumenRecibido: 1500 }));
      await s.registrar(viaje, entregaBase({ volumenRecibido: 1000 }));
      const lista = await s.listarDeViaje(viaje);
      expect(lista).toHaveLength(2);
      expect(lista.map((e: { volumenRecibido: string }) => Number(e.volumenRecibido)))
        .toEqual([1500, 1000]);
    });
  });

  it('una entrega que no existe da 404', async () => {
    await enServicio(async (s) => {
      await expect(s.obtener('999999999')).rejects.toThrow(/no encontrada/i);
    });
  });
});

describe('rechazar · la estación no acepta la carga', () => {
  it('devuelve el volumen a la línea, igual que quitar una línea de plan', async () => {
    // Sin la devolución, el volumen quedaría entregado para siempre y la orden
    // parecería cubierta sin estarlo. Es exactamente el fallo que
    // `quitarLineaPlan` tenía sin que ninguna prueba lo viera, y por eso ésta
    // se escribe a la vez que el método y no después.
    await enServicio(async (s) => {
      const viaje = await viajeDescargando(3000);
      const e = await s.registrar(viaje, entregaBase({ volumenRecibido: 2800 }));
      expect(Number((await s.lineaDeOrden(detalleOrden)).volumenEntregado)).toBe(2800);

      const rechazada = await s.rechazar(String(e.id), { motivo: 'Sello roto a la llegada' });
      expect(rechazada.estado).toBe('rechazada');
      const linea = await s.lineaDeOrden(detalleOrden);
      expect(Number(linea.volumenEntregado)).toBe(0);
      expect(Number(linea.volumenPendiente)).toBe(5000);
    });
  });

  it('deja constancia de quién rechazó y por qué', async () => {
    await enServicio(async (s) => {
      const viaje = await viajeDescargando(3000);
      const e = await s.registrar(viaje, entregaBase({ volumenRecibido: 2800 }));
      const r = await s.rechazar(String(e.id), { motivo: 'Producto contaminado' });
      expect(String(r.aprobadaPor)).toBe(usuario);
      expect(r.motivoAprobacion).toBe('Producto contaminado');
    });
  });

  it('una entrega ya aceptada no se rechaza', async () => {
    await enServicio(async (s) => {
      const viaje = await viajeDescargando(3000);
      const e = await s.registrar(viaje, entregaBase({ volumenRecibido: 2985 }));
      await expect(s.rechazar(String(e.id), { motivo: 'tarde' }))
        .rejects.toThrow(/no está pendiente/);
    });
  });

  it('la línea vuelve a «parcial» si quedaba otra entrega viva', async () => {
    await enServicio(async (s) => {
      const viaje = await viajeDescargando(3000);
      await s.registrar(viaje, entregaBase({ volumenRecibido: 1000 }));
      const mala = await s.registrar(viaje, entregaBase({ volumenRecibido: 900 }));
      await s.rechazar(String(mala.id), { motivo: 'Medidor descalibrado' });
      const linea = await s.lineaDeOrden(detalleOrden);
      expect(Number(linea.volumenEntregado)).toBe(1000);
      expect(linea.estado).toBe('parcial');
    });
  });
});

describe('los caminos de error que sólo se ven forzándolos', () => {
  it('media lectura de medidor no permite calcular nada', async () => {
    await enServicio(async (s) => {
      const viaje = await viajeDescargando(3000);
      await expect(s.registrar(viaje, entregaBase({ medidorInicial: 100 })))
        .rejects.toThrow(/van en pareja/);
      await expect(s.registrar(viaje, entregaBase({ medidorFinal: 100 })))
        .rejects.toThrow(/van en pareja/);
    });
  });

  it('la cota de la regla 20 llega como conflicto legible, no como error de base', async () => {
    // Entregar por encima de lo que la orden pidió choca con
    // `ck_detalles_entregado_cabe`. Sin traducción saldría un 500 con el nombre
    // de una restricción dentro, que no le dice nada a quien está capturando.
    await enServicio(async (s) => {
      const viaje = await viajeDescargando(4500);
      await s.registrar(viaje, entregaBase({ volumenRecibido: 4500 }));
      const otro = await viajeDescargando(1000);
      await expect(s.registrar(otro, entregaBase({ volumenRecibido: 1000 })))
        .rejects.toThrow(/más volumen entregado del que pidió/);
    });
  });

  it('acepta y guarda todos los campos opcionales del §7.14', async () => {
    await enServicio(async (s) => {
      const viaje = await viajeDescargando(3000);
      const e = await s.registrar(viaje, entregaBase({
        volumenRecibido: 2985,
        medidorInicial: 5000, medidorFinal: 7985,
        selloRecibido: 'SELLO-778', estadoSello: 'intacto',
        receptorDocumento: '8-888-8888', firmaDigital: 'base64:xxxx',
        fechaLlegada: '2029-06-01T09:30:00Z',
        documentoEntrega: 'GUIA-2029-0001',
        observaciones: 'Descarga sin incidencias',
      }));
      expect(e.selloRecibido).toBe('SELLO-778');
      expect(e.estadoSello).toBe('intacto');
      expect(e.receptorDocumento).toBe('8-888-8888');
      expect(e.documentoEntrega).toBe('GUIA-2029-0001');
      expect(e.observaciones).toBe('Descarga sin incidencias');
      expect(e.fechaLlegada).not.toBeNull();
      expect(Number(e.volumenDescargado)).toBe(2985);
    });
  });

  it('sin tolerancia en la línea manda la del PRODUCTO', async () => {
    // La línea es más específica —un cliente puede negociar la suya— pero
    // cuando nadie la declara se cae a la del combustible, que es una propiedad
    // física y no una condición comercial. Aquí: producto al 0,5 %.
    await enServicio(async (s) => {
      const { gestor } = await import('../src/common/contexto/contexto-peticion');
      await gestor().query(
        `UPDATE detalles_orden SET tolerancia = 0 WHERE detalle_orden_id = $1`, [detalleOrden]);
      const viaje = await viajeDescargando(3000);
      // 0,4 % de merma: pasa el 0,5 % del producto.
      const dentro = await s.registrar(viaje, entregaBase({ volumenRecibido: 2988 }));
      expect(dentro.estado).toBe('aceptada');
    });
  });

  it('con la tolerancia del producto, el 1 % que la línea permitía ya NO pasa', async () => {
    await enServicio(async (s) => {
      const { gestor } = await import('../src/common/contexto/contexto-peticion');
      await gestor().query(
        `UPDATE detalles_orden SET tolerancia = 0 WHERE detalle_orden_id = $1`, [detalleOrden]);
      const viaje = await viajeDescargando(3000);
      const fuera = await s.registrar(viaje, entregaBase({ volumenRecibido: 2970 }));
      expect(fuera.estado).toBe('pendiente');
    });
  });

  it('un viaje que no existe da 404 y no un error de base', async () => {
    await enServicio(async (s) => {
      await expect(s.registrar('999999999', entregaBase()))
        .rejects.toThrow(/Viaje no encontrado/);
    });
  });
});
