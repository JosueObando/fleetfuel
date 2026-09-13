import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { hash } from 'bcryptjs';
import type Redis from 'ioredis';

import { AppModule } from '../src/app.module';
import { REDIS } from '../src/modules/auth/tokens.service';
import { COSTO_BCRYPT } from '../src/common/costo-bcrypt';
import {
  conexionDueño, sembrarEmpresa, borrarEmpresa, darPermisos, limpiarFreno,
} from './apoyo/aplicacion';

/**
 * EL CRITERIO DE SALIDA DE LA FASE 1C, RECORRIDO ENTERO.
 *
 * Lo que el plan pide literalmente: «un viaje real recorre orden → carga →
 * entrega → liquidación y cuadra contra la conciliación de volúmenes, con la
 * merma dentro de tolerancia y la diferencia justificada en auditoría».
 *
 * POR QUÉ NO ES UN E2E DE NAVEGADOR
 *
 * Porque no puede serlo todavía: al 2026-09-12 el frontend tiene pantallas para
 * los seis catálogos, órdenes y viajes, y NINGUNA para entregas, gastos,
 * liquidaciones ni cargas. 1C está cerrada en el backend y no existe en la
 * interfaz. Los dos recorridos de `frontend/e2e` llegan hasta donde hay
 * pantallas, y este fichero cubre el resto por HTTP — que es la capa donde 1C
 * de verdad vive hoy.
 *
 * POR QUÉ NO LO CUBRE `api-superficie`
 *
 * Aquél recorre las rutas UNA A UNA para que ninguna quede sin visitar, y arma
 * un viaje nuevo para cada bloque. Éste recorre UN SOLO viaje de punta a punta y
 * comprueba que los números se encadenan: que lo planificado sale de lo pedido,
 * lo cargado de lo planificado, lo entregado de lo cargado y lo liquidado del
 * viaje entero. Un módulo puede estar bien y la cadena estar rota — es
 * exactamente lo que pasaba con el sello antes del §7.13.
 *
 * DOS USUARIOS, Y NO UNO
 *
 * Las separaciones de responsabilidad del §7 (quien registra un gasto no lo
 * aprueba, quien calcula una liquidación no la firma) sólo se pueden recorrer
 * con dos personas. Con una sola, el recorrido tendría que celebrar los 409 en
 * vez de completar el flujo.
 */

const RUC = '1C-TEST';
const CAPTURADOR = 'captura-1c@ejemplo.test';
const SUPERVISOR = 'supervisa-1c@ejemplo.test';
const CLAVE = 'ClaveDePrueba123';

let app: INestApplication, modulo: TestingModule, dueño: DataSource, redis: Redis;
let empresa: string;
let tokenCaptura: string, tokenSupervisa: string;

const api = () => request(app.getHttpServer());
const marca = Date.now().toString().slice(-8);

/** Cabeceras de quien captura: registra la operación del día. */
const cap = () => ({ Authorization: `Bearer ${tokenCaptura}` });
const capPost = () => ({ ...cap(), 'Idempotency-Key': randomUUID() });
/** Cabeceras de quien supervisa: aprueba lo que otro capturó. */
const sup = () => ({ Authorization: `Bearer ${tokenSupervisa}` });
const supPost = () => ({ ...sup(), 'Idempotency-Key': randomUUID() });

const num = (v: unknown) => Number(v);

beforeAll(async () => {
  dueño = conexionDueño();
  await dueño.initialize();

  const s = await sembrarEmpresa(dueño, { ruc: RUC, correo: CAPTURADOR, clave: CLAVE });
  empresa = s.empresa;
  await darPermisos(dueño, { empresa, usuarioId: s.usuario.id, nombreRol: 'Captura 1C' });

  const [u2] = await dueño.query(
    `INSERT INTO usuarios (empresa_id, nombre, correo, hash_clave, estado)
     VALUES ($1,'Supervisor 1C',$2,$3,'activo') RETURNING usuario_id`,
    [empresa, SUPERVISOR, await hash(CLAVE, COSTO_BCRYPT)]);
  await darPermisos(dueño, {
    empresa, usuarioId: String(u2.usuario_id), nombreRol: 'Supervisión 1C',
  });

  modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = modulo.createNestApplication<NestExpressApplication>();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.init();
  redis = modulo.get(REDIS);
  await limpiarFreno(redis);

  tokenCaptura = (await api().post('/api/auth/login')
    .send({ correo: CAPTURADOR, clave: CLAVE }).expect(200)).body.accessToken;
  await limpiarFreno(redis);
  tokenSupervisa = (await api().post('/api/auth/login')
    .send({ correo: SUPERVISOR, clave: CLAVE }).expect(200)).body.accessToken;
}, 120_000);

afterAll(async () => {
  await redis?.quit().catch(() => undefined);
  await app?.close();
  await dueño.query(`DELETE FROM intentos_login WHERE correo LIKE '%@ejemplo.test'`);
  await borrarEmpresa(dueño, empresa, RUC);
  await dueño.destroy();
});

describe('§26 · criterio de salida de 1C — un viaje de punta a punta que cuadra', () => {
  it('orden → plan → carga → entrega → gasto → liquidación, y los números se encadenan',
    async () => {
      await limpiarFreno(redis);

      // ── 1 · Los catálogos que el viaje necesita ───────────────────────────
      const cliente = (await api().post('/api/clientes').set(capPost())
        .send({ nombre: `Distribuidora ${marca}` }).expect(201)).body;
      const estacion = (await api().post('/api/estaciones').set(capPost())
        .send({ clienteId: String(cliente.id), nombre: `Estación ${marca}` }).expect(201)).body;
      const producto = (await api().post('/api/productos').set(capPost())
        .send({ codigo: `D-${marca}`, nombre: 'Diésel', toleranciaMerma: 0.5 })
        .expect(201)).body;
      const vehiculo = (await api().post('/api/vehiculos').set(capPost())
        .send({ tipoVehiculo: 'cisterna', placa: `P-${marca}` }).expect(201)).body;

      // Dos compartimentos: una orden de 6 000 no cabe en uno solo, y partirla
      // es lo que hace que la conciliación tenga más de un eslabón que cuadrar.
      const cisterna = (await api().post('/api/cisternas').set(capPost()).send({
        vehiculoId: String(vehiculo.id), capacidadTotal: 10000,
        compartimentos: [
          { numero: 1, capacidadNominal: 5000, capacidadCalibrada: 4980 },
          { numero: 2, capacidadNominal: 5000, capacidadCalibrada: 4980 },
        ],
      }).expect(201)).body;
      const [compA, compB] = cisterna.compartimentos;

      const conductor = (await api().post('/api/conductores').set(capPost()).send({
        nombreCompleto: `Chofer ${marca}`, documento: `DOC-${marca}`, licencia: `LIC-${marca}`,
        // Regla 13: con la licencia vigente el viaje puede autorizarse. Que esté
        // declarada y al día es parte del recorrido, no un detalle del fixture.
        fechaVencimientoLicencia: '2032-12-31',
      }).expect(201)).body;

      // ── 2 · La orden, con su tolerancia negociada ─────────────────────────
      const orden = (await api().post('/api/ordenes').set(capPost()).send({
        clienteId: String(cliente.id), estacionId: String(estacion.id),
        detalles: [{ productoId: String(producto.id), volumenSolicitado: 6000, tolerancia: 1 }],
      }).expect(201)).body;
      await api().patch(`/api/ordenes/${orden.id}/estado`).set(cap())
        .send({ estado: 'validada' }).expect(200);
      const detalle = (await api().get(`/api/ordenes/${orden.id}`).set(cap()).expect(200))
        .body.detalles[0];

      // ── 3 · El viaje y su plan de carga: 3 000 + 3 000 = lo pedido ────────
      const viaje = (await api().post('/api/viajes').set(capPost()).send({
        codigoViaje: `V1C-${marca}`, tipoViaje: 'simple',
        cisternaId: String(cisterna.id), conductorId: String(conductor.id),
        fechaProgramada: '2032-04-01T06:00:00Z',
      }).expect(201)).body;
      await api().post(`/api/viajes/${viaje.id}/ordenes`).set(capPost())
        .send({ ordenId: String(orden.id), secuenciaEntrega: 1 }).expect(201);

      for (const comp of [compA, compB]) {
        await api().post(`/api/viajes/${viaje.id}/plan-carga`).set(capPost()).send({
          compartimentoId: String(comp.id), detalleOrdenId: String(detalle.id),
          volumenPlanificado: 3000,
        }).expect(201);
      }

      // Primer eslabón: lo planificado sale de lo pedido y lo cubre entero.
      const trasPlan = (await api().get(`/api/ordenes/${orden.id}`).set(cap()).expect(200))
        .body.detalles[0];
      expect(num(trasPlan.volumenPlanificado)).toBe(6000);
      expect(num(trasPlan.volumenSolicitado)).toBe(6000);

      // ── 4 · Autorizar y salir a la calle ──────────────────────────────────
      await api().patch(`/api/viajes/${viaje.id}/estado`).set(cap())
        .send({ estado: 'programado' }).expect(200);
      await api().post(`/api/viajes/${viaje.id}/autorizar`).set(capPost()).send({}).expect(201);

      for (const estado of ['desplazamiento_terminal', 'espera_carga', 'cargando']) {
        await api().patch(`/api/viajes/${viaje.id}/estado`).set(cap())
          .send({ estado }).expect(200);
      }

      // ── 5 · La carga en terminal (§7.13) ──────────────────────────────────
      //
      // Los medidores de la terminal no dan redondo: 2 990 y 3 010 contra los
      // 3 000 planificados de cada compartimento. Esa diferencia es real y no
      // se corrige — es lo que hace que la merma de la entrega se mida contra
      // lo que SALIÓ y no contra lo que se pensaba sacar.
      const cargas = [];
      for (const [i, comp] of [compA, compB].entries()) {
        const volumen = i === 0 ? 2990 : 3010;
        cargas.push((await api().post(`/api/cargas/viaje/${viaje.id}`).set(capPost()).send({
          compartimentoId: String(comp.id), detalleOrdenId: String(detalle.id),
          volumenCargado: volumen, numeroSello: `S-${marca}-${i}`,
          operadorTerminal: 'Operador de terminal', temperatura: 29.5, densidad: 0.832,
          latitud: 9.3547, longitud: -79.9003,
        }).expect(201)).body);
      }
      expect(cargas.map(c => num(c.volumenCargado)).reduce((a, b) => a + b)).toBe(6000);

      // Quien valida no es quien confirmó: el supervisor da por buenas las dos.
      for (const carga of cargas) {
        const v = await api().post(`/api/cargas/${carga.id}/validar`).set(supPost())
          .send({}).expect(201);
        expect(v.body.estadoValidacion).toBe('validada');
      }

      // ── 6 · A la estación ─────────────────────────────────────────────────
      for (const estado of ['cargado', 'transito_estacion', 'descargando']) {
        await api().patch(`/api/viajes/${viaje.id}/estado`).set(cap())
          .send({ estado }).expect(200);
      }

      // ── 7 · Las entregas, con sus sellos verificados ──────────────────────
      //
      // 2 985 de 2 990 y 3 000 de 3 010: mermas del 0,167 % y del 0,332 %,
      // las dos por debajo del 1 % que la línea negoció. Entran aceptadas sin
      // que nadie tenga que perdonarlas, que es lo que la regla 9 pide.
      const entregas = [];
      for (const [i, comp] of [compA, compB].entries()) {
        const recibido = i === 0 ? 2985 : 3000;
        entregas.push((await api().post(`/api/entregas/viaje/${viaje.id}`).set(capPost()).send({
          detalleOrdenId: String(detalle.id), compartimentoId: String(comp.id),
          volumenRecibido: recibido, receptorNombre: 'Encargada de la estación',
          selloRecibido: `S-${marca}-${i}`,
          latitud: 8.9824, longitud: -79.5199,
        }).expect(201)).body);
      }

      // La conciliación del §17, eslabón por eslabón.
      for (const [i, e] of entregas.entries()) {
        expect(e.estadoSello).toBe('intacto');
        expect(e.estado).toBe('aceptada');
        // El cargado de la entrega es el de la CARGA, no el del plan.
        expect(num(e.volumenCargado)).toBe(num(cargas[i].volumenCargado));
        expect(Math.abs(num(e.porcentajeMerma))).toBeLessThanOrEqual(1);
        expect(String(e.cargaId)).toBe(String(cargas[i].id));
      }

      // Regla 20: lo entregado mueve el pendiente de la orden, solo.
      const trasEntregar = (await api().get(`/api/ordenes/${orden.id}`).set(cap()).expect(200))
        .body.detalles[0];
      expect(num(trasEntregar.volumenEntregado)).toBe(5985);
      expect(num(trasEntregar.volumenPendiente)).toBe(15);

      // ── 8 · Un gasto del camino, aprobado por otra mano ───────────────────
      const gasto = (await api().post(`/api/gastos/viaje/${viaje.id}`).set(capPost()).send({
        categoria: 'peaje', descripcion: 'Peajes de la Panamericana',
        monto: 18.75, pagadoPor: 'conductor', reembolsable: true,
      }).expect(201)).body;
      expect(gasto.estado).toBe('pendiente');

      // Resolver un gasto exige motivo escrito: la §21 pide poder reconstruir
      // por qué se aceptó, igual que con la merma de una entrega.
      await api().patch(`/api/gastos/${gasto.id}`).set(sup())
        .send({ estado: 'aprobado', motivo: 'Peajes verificados contra los recibos' })
        .expect(200);
      const totales = (await api().get(`/api/gastos/viaje/${viaje.id}/totales`)
        .set(cap()).expect(200)).body;
      expect(num(totales.totalAprobado)).toBe(18.75);
      expect(num(totales.totalPendiente)).toBe(0);

      // ── 9 · Cerrar el viaje y liquidar ────────────────────────────────────
      for (const estado of ['retornando', 'pendiente_liquidacion', 'cerrado']) {
        await api().patch(`/api/viajes/${viaje.id}/estado`).set(cap())
          .send({ estado }).expect(200);
      }

      const liq = (await api().post(`/api/liquidaciones/viaje/${viaje.id}`).set(capPost())
        .send({}).expect(201)).body;
      expect(liq.estado).toBe('pendiente');
      // §10.7: el reembolso del gasto aprobado entra en lo que se le paga.
      expect(num(liq.reembolsos)).toBe(18.75);
      expect(num(liq.entregasContadas)).toBe(2);

      // Calcular, firmar y pagar son tres actos: el que la calculó no la firma.
      const aprobada = (await api().post(`/api/liquidaciones/${liq.id}/aprobar`)
        .set(supPost()).send({}).expect(201)).body;
      expect(aprobada.estado).toBe('aprobada');

      const pagada = (await api().post(`/api/liquidaciones/${liq.id}/pagar`).set(capPost())
        .send({ referenciaPago: `TRF-${marca}` }).expect(201)).body;
      expect(pagada.estado).toBe('pagada');

      // ── 10 · «La diferencia justificada en auditoría» ─────────────────────
      //
      // El criterio de salida no pide sólo que el viaje cuadre: pide poder
      // reconstruirlo después. Se comprueba contra la tabla y no contra el
      // endpoint porque lo que importa es que el rastro EXISTA, no que se pueda
      // consultar — un rastro que se escribe a medias se ve igual desde la API.
      const rastro = await dueño.query(
        `SELECT entidad, count(*)::int AS n FROM auditoria
          WHERE empresa_id = $1 GROUP BY entidad`, [empresa]);
      const porEntidad = Object.fromEntries(
        rastro.map((r: { entidad: string; n: number }) => [r.entidad, r.n]));

      for (const entidad of ['viajes', 'cargas_terminal', 'entregas',
                             'gastos_viaje', 'liquidaciones_conductor']) {
        expect(porEntidad[entidad]).toBeGreaterThan(0);
      }
    }, 240_000);
});
