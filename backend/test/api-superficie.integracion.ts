import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { authenticator } from 'otplib';
import type Redis from 'ioredis';

import { AppModule } from '../src/app.module';
import { REDIS, TokensService } from '../src/modules/auth/tokens.service';
import {
  conexionDueño, sembrarEmpresa, borrarEmpresa, darPermisos, limpiarFreno,
} from './apoyo/aplicacion';

/**
 * Recorrido por TODA la superficie de la API.
 *
 * No comprueba reglas de negocio —eso está en las pruebas de cada servicio—
 * sino que TODAS las rutas existan, respondan y no revienten. Es lo que atrapa
 * lo que ninguna prueba de servicio puede ver:
 *
 *   · una ruta que deja de registrarse al mover un controlador de módulo
 *   · un `@Permisos()` mal escrito, que convierte un endpoint en inalcanzable
 *   · un 500 en un camino que nadie recorre a menudo
 *
 * Los tres se ven idénticos desde el servicio, que sigue funcionando
 * perfectamente mientras nadie puede llegar a él.
 *
 * «TODAS» se hace cumplir, no se promete: el último bloque del fichero
 * enumera las rutas que Express tiene registradas y exige que ninguna se haya
 * quedado sin recorrer. La cabecera decía «las 64 rutas» cuando visitaba 41, y
 * nada lo señalaba porque la afirmación estaba en un comentario.
 */

const RUC = 'SUP-TEST';
const CORREO = 'superficie@ejemplo.test';
const CLAVE = 'ClaveDePrueba123';

let app: INestApplication, modulo: TestingModule, dueño: DataSource, redis: Redis;
let empresa: string, usuarioId: string, token: string;

const api = () => request(app.getHttpServer());
const cab = () => ({ Authorization: `Bearer ${token}` });
const cabPost = () => ({ ...cab(), 'Idempotency-Key': randomUUID() });
const sello = () => Date.now().toString().slice(-8) + Math.floor(Math.random() * 99);

/** Lo que este fichero ha recorrido de verdad, para poder exigir al final que
 *  no se haya quedado ninguna ruta fuera. Se llena sola: quien añade un
 *  `ruta(...)` no tiene que acordarse de nada. */
const visitadas = new Set<string>();

/** Ejercita una ruta y comprueba que responde con algo esperado. */
async function ruta(
  descripcion: string,
  peticion: request.Test,
  aceptables: number[],
): Promise<request.Response> {
  visitadas.add(descripcion);
  const r = await peticion;
  // Un 5xx se señala aparte: significa que la ruta existe y revienta, que es
  // distinto de que responda un código de negocio inesperado.
  expect({ descripcion, revienta: r.status >= 500, detalle: r.status >= 500 ? r.body : undefined })
    .toEqual({ descripcion, revienta: false, detalle: undefined });
  if (!aceptables.includes(r.status)) {
    throw new Error(`${descripcion}: esperaba ${aceptables.join('|')}, respondió ${r.status} ` +
                    `${JSON.stringify(r.body).slice(0, 160)}`);
  }
  return r;
}

beforeAll(async () => {
  dueño = conexionDueño();
  await dueño.initialize();
  const s = await sembrarEmpresa(dueño, { ruc: RUC, correo: CORREO, clave: CLAVE });
  empresa = s.empresa; usuarioId = s.usuario.id;
  await darPermisos(dueño, { empresa, usuarioId });

  modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = modulo.createNestApplication<NestExpressApplication>();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.init();
  redis = modulo.get(REDIS);
  await limpiarFreno(redis);

  const login = await api().post('/api/auth/login').send({ correo: CORREO, clave: CLAVE }).expect(200);
  token = login.body.accessToken;
}, 90_000);

afterAll(async () => {
  await redis?.quit().catch(() => undefined);
  await app?.close();
  await dueño.query(`DELETE FROM intentos_login WHERE correo LIKE '%@ejemplo.test'`);
  await borrarEmpresa(dueño, empresa, RUC);
  await dueño.destroy();
});

beforeEach(() => limpiarFreno(redis));

describe('salud y autenticación', () => {
  it('GET /salud responde sin credenciales', async () => {
    const r = await ruta('GET /salud', api().get('/api/salud'), [200]);
    expect(r.body.estado).toBe('ok');
  });

  it('GET /auth/yo devuelve quién soy', async () => {
    const r = await ruta('GET /auth/yo', api().get('/api/auth/yo').set(cab()), [200]);
    expect(r.body.correo).toBe(CORREO);
  });

  it('POST /auth/refrescar y POST /auth/cerrar-sesion', async () => {
    const login = await api().post('/api/auth/login').send({ correo: CORREO, clave: CLAVE }).expect(200);
    const refrescada = await ruta('POST /auth/refrescar',
      api().post('/api/auth/refrescar').send({ refreshToken: login.body.refreshToken }), [200]);
    await ruta('POST /auth/cerrar-sesion',
      api().post('/api/auth/cerrar-sesion').send({ refreshToken: refrescada.body.refreshToken }), [204]);
  }, 30_000);

  it('POST /auth/mfa/iniciar y /confirmar', async () => {
    const iniciado = await ruta('POST /auth/mfa/iniciar',
      api().post('/api/auth/mfa/iniciar').set(cab()), [200]);
    expect(iniciado.body.secreto).toBeTruthy();
    await ruta('POST /auth/mfa/confirmar',
      api().post('/api/auth/mfa/confirmar').set(cab())
        .send({ codigoTotp: authenticator.generate(iniciado.body.secreto) }), [200]);
    // Se deshace: si el usuario queda con MFA, los logins siguientes fallan.
    await dueño.query(
      `UPDATE usuarios SET mfa_habilitado=false, mfa_secreto=NULL WHERE usuario_id=$1`, [usuarioId]);
  }, 30_000);
});

describe('los seis catálogos, ruta por ruta', () => {
  it('recorre alta, lista, detalle, edición y baja de cada uno', async () => {
    const s = sello();
    const cliente = (await ruta('POST /clientes',
      api().post('/api/clientes').set(cabPost()).send({ nombre: `Cliente ${s}` }), [201])).body;
    const vehiculo = (await ruta('POST /vehiculos',
      api().post('/api/vehiculos').set(cabPost())
        .send({ tipoVehiculo: 'cisterna', placa: `SP-${s}` }), [201])).body;

    const casos: Array<[nombre: string, ruta: string, alta: object, parche: object]> = [
      ['clientes', '/api/clientes', { nombre: `Otro ${s}` }, { contacto: 'Ana' }],
      ['vehiculos', '/api/vehiculos', { tipoVehiculo: 'cabezal', placa: `SQ-${s}` }, { marca: 'Volvo' }],
      ['productos', '/api/productos', { codigo: `SP-${s}`, nombre: 'Gasolina' }, { nombre: 'Gasolina 95' }],
      ['conductores', '/api/conductores',
        { nombreCompleto: 'Chofer Superficie', documento: `SD-${s}`, licencia: `SL-${s}` },
        { telefono: '6000-0000' }],
      ['estaciones', '/api/estaciones',
        { clienteId: String(cliente.id), nombre: `Estación ${s}` }, { provincia: 'Panamá' }],
    ];

    for (const [nombre, r, alta, parche] of casos) {
      const creado = (await ruta(`POST ${r}`, api().post(r).set(cabPost()).send(alta), [201])).body;
      await ruta(`GET ${r}`, api().get(r).set(cab()), [200]);
      await ruta(`GET ${r}/:id`, api().get(`${r}/${creado.id}`).set(cab()), [200]);
      await ruta(`PATCH ${r}/:id`, api().patch(`${r}/${creado.id}`).set(cab()).send(parche), [200]);
      await ruta(`DELETE ${r}/:id`, api().delete(`${r}/${creado.id}`).set(cab()), [200]);
      expect({ nombre, recorrido: true }).toEqual({ nombre, recorrido: true });
    }

    // Cisternas va aparte: lleva compartimentos anidados.
    const cisterna = (await ruta('POST /cisternas',
      api().post('/api/cisternas').set(cabPost()).send({
        vehiculoId: String(vehiculo.id), capacidadTotal: 9000,
        compartimentos: [{ numero: 1, capacidadNominal: 4000, capacidadCalibrada: 3980 }],
      }), [201])).body;
    await ruta('GET /cisternas', api().get('/api/cisternas').set(cab()), [200]);
    await ruta('GET /cisternas/:id', api().get(`/api/cisternas/${cisterna.id}`).set(cab()), [200]);
    await ruta('GET /cisternas/:id/compartimentos',
      api().get(`/api/cisternas/${cisterna.id}/compartimentos`).set(cab()), [200]);
    await ruta('PATCH /cisternas/:id',
      api().patch(`/api/cisternas/${cisterna.id}`).set(cab()).send({ material: 'acero' }), [200]);
    await ruta('DELETE /cisternas/:id',
      api().delete(`/api/cisternas/${cisterna.id}`).set(cab()), [200]);
  }, 120_000);

  it('GET /conductores/licencias-por-vencer', async () => {
    // Ruta literal que convive con `/conductores/:id`: si se declararan en el
    // orden equivocado, «licencias-por-vencer» se leería como un id y esto
    // devolvería 404 en vez de la lista.
    const r = await ruta('GET /conductores/licencias-por-vencer',
      api().get('/api/conductores/licencias-por-vencer').set(cab()), [200]);
    expect(Array.isArray(r.body)).toBe(true);
  }, 30_000);
});

describe('órdenes y viajes, ruta por ruta', () => {
  it('recorre el flujo entero por HTTP', async () => {
    const s = sello();
    const cliente = (await api().post('/api/clientes').set(cabPost())
      .send({ nombre: `Cliente flujo ${s}` }).expect(201)).body;
    const estacion = (await api().post('/api/estaciones').set(cabPost())
      .send({ clienteId: String(cliente.id), nombre: `Estación flujo ${s}` }).expect(201)).body;
    const producto = (await api().post('/api/productos').set(cabPost())
      .send({ codigo: `FL-${s}`, nombre: 'Diésel' }).expect(201)).body;
    const vehiculo = (await api().post('/api/vehiculos').set(cabPost())
      .send({ tipoVehiculo: 'cisterna', placa: `FL-${s}` }).expect(201)).body;
    const cisterna = (await api().post('/api/cisternas').set(cabPost()).send({
      vehiculoId: String(vehiculo.id), capacidadTotal: 10000,
      compartimentos: [{ numero: 1, capacidadNominal: 5000, capacidadCalibrada: 4980 }],
    }).expect(201)).body;
    const conductor = (await api().post('/api/conductores').set(cabPost())
      .send({ nombreCompleto: 'Chofer flujo', documento: `FD-${s}`, licencia: `FL-${s}` })
      .expect(201)).body;

    const orden = (await ruta('POST /ordenes', api().post('/api/ordenes').set(cabPost()).send({
      clienteId: String(cliente.id), estacionId: String(estacion.id),
      detalles: [{ productoId: String(producto.id), volumenSolicitado: 4000 }],
    }), [201])).body;

    await ruta('GET /ordenes', api().get('/api/ordenes').set(cab()), [200]);
    await ruta('GET /ordenes/:id', api().get(`/api/ordenes/${orden.id}`).set(cab()), [200]);
    await ruta('PATCH /ordenes/:id',
      api().patch(`/api/ordenes/${orden.id}`).set(cab()).send({ prioridad: 'alta' }), [200]);
    await ruta('PATCH /ordenes/:id/estado',
      api().patch(`/api/ordenes/${orden.id}/estado`).set(cab()).send({ estado: 'validada' }), [200]);

    const viaje = (await ruta('POST /viajes', api().post('/api/viajes').set(cabPost()).send({
      codigoViaje: `SUP-${s}`, tipoViaje: 'simple',
      cisternaId: String(cisterna.id), conductorId: String(conductor.id),
      fechaProgramada: '2028-01-15T08:00:00Z',
    }), [201])).body;

    await ruta('GET /viajes', api().get('/api/viajes').set(cab()), [200]);
    await ruta('GET /viajes/:id', api().get(`/api/viajes/${viaje.id}`).set(cab()), [200]);
    await ruta('PATCH /viajes/:id',
      api().patch(`/api/viajes/${viaje.id}`).set(cab()).send({ rutaPlanificada: 'Vía Centenario' }), [200]);
    await ruta('POST /viajes/:id/ordenes',
      api().post(`/api/viajes/${viaje.id}/ordenes`).set(cabPost())
        .send({ ordenId: String(orden.id), secuenciaEntrega: 1 }), [201]);

    const detalle = (await api().get(`/api/ordenes/${orden.id}`).set(cab()).expect(200)).body;
    const plan = (await ruta('POST /viajes/:id/plan-carga',
      api().post(`/api/viajes/${viaje.id}/plan-carga`).set(cabPost()).send({
        compartimentoId: String(cisterna.compartimentos[0].id),
        detalleOrdenId: String(detalle.detalles[0].id),
        volumenPlanificado: 3000,
      }), [201])).body;

    await ruta('PATCH /viajes/:id/estado',
      api().patch(`/api/viajes/${viaje.id}/estado`).set(cab()).send({ estado: 'programado' }), [200]);
    await ruta('POST /viajes/:id/autorizar',
      api().post(`/api/viajes/${viaje.id}/autorizar`).set(cabPost()).send({}), [200, 201]);

    // Con el viaje autorizado el plan ya no se toca: la baja de una línea tiene
    // que rechazarse, y esa es su ruta igualmente.
    //
    // Aceptaba `[200, 409]`, y ahí se escondía un hueco: desde un viaje
    // autorizado el guard responde 409 SIEMPRE, así que el 200 era inalcanzable
    // y el cuerpo de `quitarLineaPlan` —el que devuelve el volumen al
    // acumulado— no se ejecutaba en ninguna prueba del repositorio, mientras la
    // ruta figuraba cubierta. Un rango de estados aceptados es una aserción que
    // se cumple sola: aquí sólo cabe una respuesta, y es la que se exige.
    // El camino que SÍ borra se prueba en `viajes-servicio.integracion.ts`.
    await ruta('DELETE /viajes/:id/plan-carga/:planId',
      api().delete(`/api/viajes/${viaje.id}/plan-carga/${plan.id ?? 1}`).set(cab()), [409]);
  }, 180_000);
});

describe('un identificador con basura no puede ser un 500', () => {
  /*
   * Todos los ids del sistema son BIGINT y ningún `:id` de ningún controlador
   * los valida: llegan a Postgres tal cual. Un id como «abc» produce
   * `invalid input syntax for type bigint`, que sale como 500.
   *
   * Importa por dos motivos, y el segundo no es evidente. El primero es que un
   * error del cliente devuelto como error del servidor miente sobre de quién es
   * la culpa. El segundo es que ff-errores-5xx vigila la tasa de 5xx de
   * producción: cualquiera que pida rutas con ids inventados —un rastreador,
   * un enlace roto— dispara la alerta. Un canal que suena por basura ajena es
   * un canal que se acaba silenciando.
   */
  it.each([
    ['clientes', '/api/clientes/abc'],
    ['estaciones', '/api/estaciones/abc'],
    ['productos', '/api/productos/abc'],
    ['vehiculos', '/api/vehiculos/abc'],
    ['cisternas', '/api/cisternas/abc'],
    ['conductores', '/api/conductores/abc'],
    ['ordenes', '/api/ordenes/abc'],
    ['viajes', '/api/viajes/abc'],
  ])('GET de %s con un id que no es un número responde 4xx, no 5xx', async (_n, url) => {
    const r = await api().get(url).set(cab());
    expect(r.status).toBeLessThan(500);
  });

  it('tampoco por el cuerpo: un id de compartimento con basura no es un 500', async () => {
    const r = await api().post('/api/viajes/1/plan-carga').set(cabPost())
      .send({ compartimentoId: 'abc', detalleOrdenId: 'abc', volumenPlanificado: 10 });
    expect(r.status).toBeLessThan(500);
  });
});

describe('administración, ruta por ruta', () => {
  it('usuarios, roles, permisos, dispositivos, auditoría y empresa', async () => {
    const s = sello();
    await ruta('GET /permisos', api().get('/api/permisos').set(cab()), [200]);
    await ruta('GET /roles', api().get('/api/roles').set(cab()), [200]);

    const rol = (await ruta('POST /roles', api().post('/api/roles').set(cabPost())
      .send({ nombre: `Rol superficie ${s}`, descripcion: 'De prueba' }), [201])).body;
    await ruta('PUT /roles/:id/permisos',
      api().put(`/api/roles/${rol.id}/permisos`).set(cab())
        .send({ permisos: ['clientes:leer', 'viajes:leer'] }), [200]);

    // OJO: `roles` va por NOMBRE, no por id — a diferencia de todos los demás
    // campos de referencia de esta API (`clienteId`, `vehiculoId`,
    // `productoId`…), que van por id. Es una inconsistencia del contrato que
    // conviene tener fijada: pasarle el id devuelve 404 «Algún rol indicado no
    // existe», que se lee como si el rol no estuviera.
    const usuario = (await ruta('POST /usuarios', api().post('/api/usuarios').set(cabPost()).send({
      nombre: 'Usuario superficie', correo: `sup${s}@ejemplo.test`,
      clave: 'ClaveDePrueba123', roles: [rol.nombre],
    }), [201])).body;

    await ruta('POST /usuarios con el ID del rol falla, va por nombre',
      api().post('/api/usuarios').set(cabPost()).send({
        nombre: 'No debería crearse', correo: `nop${s}@ejemplo.test`,
        clave: 'ClaveDePrueba123', roles: [String(rol.id)],
      }), [404]);
    await ruta('GET /usuarios', api().get('/api/usuarios').set(cab()), [200]);
    await ruta('PATCH /usuarios/:id/suspender',
      api().patch(`/api/usuarios/${usuario.id}/suspender`).set(cab())
        .send({ motivo: 'Alta de prueba, se suspende al terminar' }), [200]);

    await ruta('GET /dispositivos', api().get('/api/dispositivos').set(cab()), [200]);
    const [d] = await dueño.query(
      `INSERT INTO dispositivos (empresa_id, usuario_id, identificador, nombre)
       VALUES ($1,$2,$3,'Equipo superficie') RETURNING dispositivo_id`,
      [empresa, usuarioId, `sup-${s}`]);
    // Con una sesión abierta de verdad: al revocar tiene que quedar cortada.
    // Es la comprobación de que el interceptor ejecuta los efectos posteriores
    // al commit — el servicio ya no corta Redis por su cuenta.
    const tokens = modulo.get(TokensService);
    const jti = await tokens.registrar({
      usuarioId, empresaId: empresa, dispositivoId: String(d.dispositivo_id) });
    expect(await tokens.vigente(jti)).toBe(true);

    const revocado = await ruta('PATCH /dispositivos/:id/revocar',
      api().patch(`/api/dispositivos/${d.dispositivo_id}/revocar`).set(cab())
        .send({ motivo: 'Baja de prueba del recorrido' }), [200]);
    expect(revocado.body.sesionesCortadas).toBe(1);
    expect(await tokens.vigente(jti)).toBe(false);

    await ruta('GET /auditoria', api().get('/api/auditoria').set(cab()), [200]);
    await ruta('GET /empresa', api().get('/api/empresa').set(cab()), [200]);
  }, 120_000);
});

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * El CRUD de los catálogos, que era lo que faltaba por recorrer.
 *
 * Cinco recursos con las mismas cinco rutas cada uno. Se hacen en bucle y no a
 * mano porque son idénticos: escribirlos veinte veces invita a que el sexto
 * catálogo se añada sin ellos.
 *
 * Cada uno crea su propio registro y lo borra: así el DELETE se puede exigir
 * en 200 seco, sin el `[200, 409]` que aceptaría cualquier cosa. Un rango de
 * estados aceptados es una aserción que se cumple sola.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe('los seis catálogos, ruta por ruta', () => {
  const CATALOGOS: Array<{
    nombre: string;
    cuerpo: () => Promise<Record<string, unknown>> | Record<string, unknown>;
    edicion: Record<string, unknown>;
  }> = [
    { nombre: 'clientes', edicion: { telefono: '507-9999' },
      cuerpo: () => ({ nombre: `Cliente ${sello()}` }) },
    { nombre: 'vehiculos', edicion: { marca: 'Volvo' },
      cuerpo: () => ({ tipoVehiculo: 'cabezal', placa: `SUP-${sello()}` }) },
    { nombre: 'conductores', edicion: { telefono: '507-8888' },
      cuerpo: () => ({
        nombreCompleto: `Chofer ${sello()}`, documento: `DOC-${sello()}`,
        licencia: `LIC-${sello()}`,
      }) },
    { nombre: 'productos', edicion: { colorIdentificacion: 'verde' },
      cuerpo: () => ({ codigo: `SUP-${sello()}`, nombre: `Producto ${sello()}` }) },
    { nombre: 'estaciones', edicion: { provincia: 'Panamá' },
      cuerpo: async () => {
        // Una estación cuelga de un cliente: se crea uno suyo para que el
        // borrado del final no dependa de nada de otra prueba.
        const cliente = await api().post('/api/clientes').set(cabPost())
          .send({ nombre: `Cliente est ${sello()}` }).expect(201);
        return { clienteId: String(cliente.body.id), nombre: `Estación ${sello()}` };
      } },
  ];

  for (const c of CATALOGOS) {
    it(`${c.nombre} · listar, obtener, crear, actualizar y desactivar`, async () => {
      const creado = (await ruta(`POST /${c.nombre}`,
        api().post(`/api/${c.nombre}`).set(cabPost()).send(await c.cuerpo()), [201])).body;

      const lista = await ruta(`GET /${c.nombre}`, api().get(`/api/${c.nombre}`).set(cab()), [200]);
      expect(Array.isArray(lista.body)).toBe(true);

      const uno = await ruta(`GET /${c.nombre}/:id`,
        api().get(`/api/${c.nombre}/${creado.id}`).set(cab()), [200]);
      expect(String(uno.body.id)).toBe(String(creado.id));

      await ruta(`PATCH /${c.nombre}/:id`,
        api().patch(`/api/${c.nombre}/${creado.id}`).set(cab()).send(c.edicion), [200]);

      await ruta(`DELETE /${c.nombre}/:id`,
        api().delete(`/api/${c.nombre}/${creado.id}`).set(cab()), [200]);

      // Dado de baja significa que deja de estar: si siguiera apareciendo, la
      // baja lógica no lo sería.
      await api().get(`/api/${c.nombre}/${creado.id}`).set(cab()).expect(404);
    }, 60_000);
  }
});

/*
 * Las entregas de la Fase 1C. Van al final porque necesitan el viaje entero
 * armado: orden validada, asignada, plan de carga y el viaje descargando.
 */
describe('entregas · el eslabón que cierra orden → carga → viaje → entrega', () => {
  it('registrar, leer, y aprobar una diferencia fuera de tolerancia', async () => {
    const { viaje, detalle, cisterna } = await viajeHasta('descargando', sello());

    // 2850 de 3000 son un 5 % de merma sobre una tolerancia del 1 %: entra
    // pendiente, que es lo que la regla 9 pide.
    const entrega = (await ruta('POST /entregas/viaje/:viajeId',
      api().post(`/api/entregas/viaje/${viaje.id}`).set(cabPost()).send({
        detalleOrdenId: String(detalle.id),
        compartimentoId: String(cisterna.compartimentos[0].id),
        volumenRecibido: 2850, receptorNombre: 'Ana Receptora',
        latitud: 8.9824, longitud: -79.5199,
      }), [201])).body;
    expect(entrega.estado).toBe('pendiente');

    await ruta('GET /entregas/:id',
      api().get(`/api/entregas/${entrega.id}`).set(cab()), [200]);
    const lista = await ruta('GET /entregas/viaje/:viajeId',
      api().get(`/api/entregas/viaje/${viaje.id}`).set(cab()), [200]);
    expect(lista.body).toHaveLength(1);

    const aprobada = await ruta('POST /entregas/:id/aprobar',
      api().post(`/api/entregas/${entrega.id}/aprobar`).set(cabPost())
        .send({ motivo: 'Merma verificada contra el medidor de la terminal' }), [200, 201]);
    expect(aprobada.body.estado).toBe('aceptada');

    // Una ya aprobada no se rechaza: la ruta existe y responde con su conflicto.
    await ruta('POST /entregas/:id/rechazar',
      api().post(`/api/entregas/${entrega.id}/rechazar`).set(cabPost())
        .send({ motivo: 'Ya estaba aceptada, esto tiene que dar conflicto' }), [409]);
  }, 180_000);
});


/**
 * Arma por HTTP un viaje completo y lo lleva hasta `estado`.
 *
 * Cliente, estación, producto, vehículo, cisterna, conductor, orden validada,
 * viaje, orden asignada y plan de carga: son diez altas y ninguna se puede
 * saltar, porque `autorizar` exige plan de carga y conductor. Estaba escrito
 * dos veces —una por recorrido— y la segunda copia se equivocó justo aquí: se
 * saltó el plan de carga, `autorizar` devolvió 409 y el viaje se quedó en
 * `programado`.
 */
async function viajeHasta(estado: string, marca: string) {
  const cliente = (await api().post('/api/clientes').set(cabPost())
    .send({ nombre: `Cliente ${marca}` }).expect(201)).body;
  const estacion = (await api().post('/api/estaciones').set(cabPost())
    .send({ clienteId: String(cliente.id), nombre: `Estación ${marca}` }).expect(201)).body;
  const producto = (await api().post('/api/productos').set(cabPost())
    .send({ codigo: `X-${marca}`, nombre: `Combustible ${marca}` }).expect(201)).body;
  const vehiculo = (await api().post('/api/vehiculos').set(cabPost())
    .send({ tipoVehiculo: 'cisterna', placa: `X-${marca}` }).expect(201)).body;
  const cisterna = (await api().post('/api/cisternas').set(cabPost()).send({
    vehiculoId: String(vehiculo.id), capacidadTotal: 10000,
    compartimentos: [{ numero: 1, capacidadNominal: 5000, capacidadCalibrada: 4980 }],
  }).expect(201)).body;
  const conductor = (await api().post('/api/conductores').set(cabPost()).send({
    nombreCompleto: `Chofer ${marca}`, documento: `D-${marca}`, licencia: `L-${marca}`,
  }).expect(201)).body;

  const orden = (await api().post('/api/ordenes').set(cabPost()).send({
    clienteId: String(cliente.id), estacionId: String(estacion.id),
    detalles: [{ productoId: String(producto.id), volumenSolicitado: 4000, tolerancia: 1 }],
  }).expect(201)).body;
  await api().patch(`/api/ordenes/${orden.id}/estado`).set(cab())
    .send({ estado: 'validada' }).expect(200);

  const viaje = (await api().post('/api/viajes').set(cabPost()).send({
    codigoViaje: `X-${marca}`, tipoViaje: 'simple', cisternaId: String(cisterna.id),
    conductorId: String(conductor.id), fechaProgramada: '2031-05-01T08:00:00Z',
  }).expect(201)).body;
  await api().post(`/api/viajes/${viaje.id}/ordenes`).set(cabPost())
    .send({ ordenId: String(orden.id), secuenciaEntrega: 1 }).expect(201);

  const detalle = (await api().get(`/api/ordenes/${orden.id}`).set(cab()).expect(200))
    .body.detalles[0];
  await api().post(`/api/viajes/${viaje.id}/plan-carga`).set(cabPost()).send({
    compartimentoId: String(cisterna.compartimentos[0].id),
    detalleOrdenId: String(detalle.id), volumenPlanificado: 3000,
  }).expect(201);

  // Por la máquina de estados, sin atajos por SQL: es el único camino que un
  // operador tiene, y recorrerlo comprueba de paso que el §8.2 llega hasta ahí.
  await api().patch(`/api/viajes/${viaje.id}/estado`).set(cab())
    .send({ estado: 'programado' }).expect(200);
  if (estado === 'programado') return { viaje, detalle, cisterna };

  await api().post(`/api/viajes/${viaje.id}/autorizar`).set(cabPost()).send({}).expect(201);
  const CAMINO = ['desplazamiento_terminal', 'espera_carga', 'cargando', 'cargado',
                  'transito_estacion', 'descargando'];
  for (const paso of CAMINO) {
    await api().patch(`/api/viajes/${viaje.id}/estado`).set(cab())
      .send({ estado: paso }).expect(200);
    if (paso === estado) break;
  }
  return { viaje, detalle, cisterna };
}

/*
 * §2C · Solicitudes de cambio de ruta.
 *
 * Ojo al detalle que este recorrido NO puede probar: que quien pide no
 * resuelve. Aquí sólo hay un usuario, así que resolver su propia solicitud
 * devuelve 409 — y eso es justamente lo que se exige, porque es la respuesta
 * correcta. La ruta feliz de la resolución vive en
 * `solicitudes-ruta.integracion.ts`, que sí puede cambiar de actor.
 */
describe('solicitudes de cambio de ruta · las cinco rutas del §2C', () => {
  it('pedir, listar, leer y toparse con la separación al resolver', async () => {
    const { viaje } = await viajeHasta('transito_estacion', sello());

    const solicitud = (await ruta('POST /solicitudes-ruta/viaje/:viajeId',
      api().post(`/api/solicitudes-ruta/viaje/${viaje.id}`).set(cabPost())
        .send({ tipo: 'desvio', motivo: 'Vía Centenario cerrada por accidente' }), [201])).body;
    expect(solicitud.estado).toBe('pendiente');

    await ruta('GET /solicitudes-ruta/:id',
      api().get(`/api/solicitudes-ruta/${solicitud.id}`).set(cab()), [200]);
    const delViaje = await ruta('GET /solicitudes-ruta/viaje/:viajeId',
      api().get(`/api/solicitudes-ruta/viaje/${viaje.id}`).set(cab()), [200]);
    expect(delViaje.body).toHaveLength(1);

    const pendientes = await ruta('GET /solicitudes-ruta/pendientes',
      api().get('/api/solicitudes-ruta/pendientes').set(cab()), [200]);
    expect(pendientes.body.map((p: { id: string }) => String(p.id)))
      .toContain(String(solicitud.id));

    // 409 y no 200: este token es el de quien la pidió.
    await ruta('PATCH /solicitudes-ruta/:id',
      api().patch(`/api/solicitudes-ruta/${solicitud.id}`).set(cab())
        .send({ estado: 'aprobada', motivo: 'Intento de aprobarme a mí mismo' }), [409]);
  }, 120_000);
});

/*
 * §7.17 · Gastos de viaje. Igual que con las solicitudes, aquí sólo hay un
 * usuario: aprobar el propio gasto devuelve 409, que es la respuesta correcta y
 * la que se exige. La ruta feliz vive en `gastos.integracion.ts`.
 */
describe('gastos de viaje · las seis rutas del §7.17', () => {
  it('registrar, listar, totales y toparse con la separación al aprobar', async () => {
    const { viaje } = await viajeHasta('transito_estacion', sello());

    const gasto = (await ruta('POST /gastos/viaje/:viajeId',
      api().post(`/api/gastos/viaje/${viaje.id}`).set(cabPost()).send({
        categoria: 'peaje', descripcion: 'Peaje de la Vía Panamericana',
        monto: 12.5, pagadoPor: 'conductor', reembolsable: true,
      }), [201])).body;
    expect(gasto.estado).toBe('pendiente');

    await ruta('GET /gastos/:id', api().get(`/api/gastos/${gasto.id}`).set(cab()), [200]);
    const delViaje = await ruta('GET /gastos/viaje/:viajeId',
      api().get(`/api/gastos/viaje/${viaje.id}`).set(cab()), [200]);
    expect(delViaje.body).toHaveLength(1);

    const pendientes = await ruta('GET /gastos/pendientes',
      api().get('/api/gastos/pendientes').set(cab()), [200]);
    expect(pendientes.body.map((g: { id: string }) => String(g.id))).toContain(String(gasto.id));

    // Antes de aprobar nada, el total aprobado es 0 y lo pendiente son 12,50.
    const totales = await ruta('GET /gastos/viaje/:viajeId/totales',
      api().get(`/api/gastos/viaje/${viaje.id}/totales`).set(cab()), [200]);
    expect(Number(totales.body.totalAprobado)).toBe(0);
    expect(Number(totales.body.totalPendiente)).toBe(12.5);

    // 409: este token es el de quien lo registró.
    await ruta('PATCH /gastos/:id',
      api().patch(`/api/gastos/${gasto.id}`).set(cab())
        .send({ estado: 'aprobado', motivo: 'Intento de aprobarme a mí mismo' }), [409]);
  }, 120_000);
});

/*
 * §14 · Informes. Sólo lectura y agregados: aquí se comprueba que las cuatro
 * rutas existen, responden y no revientan. Que los NÚMEROS sean los correctos
 * se prueba en `informes.integracion.ts`, con datos de resultado conocido.
 */
describe('informes · las cuatro rutas del §14', () => {
  it('operativo, volumen, mermas y recorridos', async () => {
    const operativo = await ruta('GET /informes/operativo',
      api().get('/api/informes/operativo').set(cab()), [200]);
    expect(operativo.body).toHaveProperty('viajesProgramados');

    const volumen = await ruta('GET /informes/volumen',
      api().get('/api/informes/volumen').set(cab()), [200]);
    expect(volumen.body).toHaveProperty('volumenPendiente');

    const mermas = await ruta('GET /informes/mermas',
      api().get('/api/informes/mermas?agruparPor=producto').set(cab()), [200]);
    expect(Array.isArray(mermas.body)).toBe(true);

    // Una agrupación inventada NO puede ser un 500: se normaliza a la de por
    // omisión, porque el mapa de agrupación no tiene esa clave y buscarla a
    // ciegas reventaría con un TypeError.
    const inventada = await api().get('/api/informes/mermas?agruparPor=luna').set(cab());
    expect(inventada.status).toBe(200);

    const recorridos = await ruta('GET /informes/recorridos',
      api().get('/api/informes/recorridos?limite=5').set(cab()), [200]);
    expect(Array.isArray(recorridos.body)).toBe(true);
  }, 60_000);
});

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * Que no se quede ninguna ruta fuera, y que eso lo diga una prueba.
 *
 * Hasta aquí, «recorre toda la superficie» era una afirmación en un comentario:
 * decía 64 y recorría 41, y nadie podía notarlo. Y el umbral de cobertura de
 * funciones tolera tres sin cubrir, así que un controlador nuevo con dos o tres
 * rutas sin probar pasaba CI sin decir una palabra.
 *
 * Esto lo cierra por el otro lado: se le pregunta a Express qué rutas tiene
 * registradas de verdad —no a un listado escrito a mano, que se desactualiza
 * igual que el comentario— y se exige que todas hayan pasado por `ruta()`.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe('la superficie declarada y la recorrida coinciden', () => {
  /** Las rutas que Express tiene montadas, en el mismo formato que `ruta()`. */
  function declaradas(): string[] {
    const express = app.getHttpAdapter().getInstance() as {
      _router?: { stack: unknown[] }; router?: { stack: unknown[] };
    };
    const pila = (express._router ?? express.router)?.stack ?? [];
    const salida: string[] = [];
    for (const capa of pila as Array<{ route?: { path: string; methods: Record<string, boolean> } }>) {
      if (!capa.route) continue;
      const camino = capa.route.path.replace(/^\/api/, '');
      for (const [metodo, activo] of Object.entries(capa.route.methods)) {
        if (activo && metodo !== '_all') salida.push(`${metodo.toUpperCase()} ${camino}`);
      }
    }
    return [...new Set(salida)].sort();
  }

  /**
   * Rutas que este fichero NO recorre porque su sitio natural es otro, con el
   * fichero donde viven. No es una lista de perdonadas: es una lista de
   * remitidas, y cada entrada dice adónde.
   */
  const EN_OTRO_FICHERO = new Map<string, string>([
    ['POST /auth/login', 'api.integracion.ts y freno-login.integracion.ts: aquí se usa para obtener el token, no se prueba'],
  ]);

  it('toda ruta registrada se ha recorrido en alguna prueba', () => {
    const todas = declaradas();
    // Sin esto la prueba se vuelve VACÍA en silencio el día que Nest o Express
    // cambien dónde guardan la pila de rutas: `declaradas()` devolvería [], el
    // filtro no encontraría nada que reprochar y el verde no significaría nada.
    // El número exacto no importa; que sean muchas, sí.
    expect(todas.length).toBeGreaterThan(50);

    const faltan = todas.filter((r) => !visitadas.has(r) && !EN_OTRO_FICHERO.has(r));
    expect(faltan).toEqual([]);
  });

  it('la lista de remitidas no acumula rutas que ya no existen', () => {
    // Una excepción que sobrevive a su ruta es cómo una lista así se pudre.
    const vivas = new Set(declaradas());
    expect([...EN_OTRO_FICHERO.keys()].filter((r) => !vivas.has(r))).toEqual([]);
  });
});
