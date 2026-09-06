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
 * sino que las 64 rutas existan, respondan y no revienten. Es lo que atrapa lo
 * que ninguna prueba de servicio puede ver:
 *
 *   · una ruta que deja de registrarse al mover un controlador de módulo
 *   · un `@Permisos()` mal escrito, que convierte un endpoint en inalcanzable
 *   · un 500 en un camino que nadie recorre a menudo
 *
 * Los tres se ven idénticos desde el servicio, que sigue funcionando
 * perfectamente mientras nadie puede llegar a él.
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

/** Ejercita una ruta y comprueba que responde con algo esperado. */
async function ruta(
  descripcion: string,
  peticion: request.Test,
  aceptables: number[],
): Promise<request.Response> {
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
    await ruta('DELETE /viajes/:id/plan-carga/:planId',
      api().delete(`/api/viajes/${viaje.id}/plan-carga/${plan.id ?? 1}`).set(cab()), [200, 409]);
  }, 180_000);
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
