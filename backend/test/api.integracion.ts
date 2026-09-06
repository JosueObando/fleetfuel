import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { randomUUID } from 'crypto';
import type Redis from 'ioredis';

import { AppModule } from '../src/app.module';
import { REDIS } from '../src/modules/auth/tokens.service';
import {
  conexionDueño, sembrarEmpresa, borrarEmpresa, darPermisos, limpiarFreno,
} from './apoyo/aplicacion';

/**
 * La aplicación entera, por HTTP.
 *
 * Es la capa que faltaba. Las pruebas de integración que ya existían van
 * directas a Postgres, así que no pasan por NADA de lo que decide una petición
 * real: ni los guards globales (JWT, inscripción MFA, permisos), ni el
 * interceptor que abre la transacción y fija `app.empresa_id`, ni el de
 * idempotencia, ni el de auditoría, ni el freno del login, ni el
 * `ValidationPipe`. Son la mitad del sistema y se estaban ejercitando sólo a
 * mano con `curl`.
 *
 * Se arranca el AppModule real contra Postgres y Redis reales. `main.ts` no se
 * ejecuta en pruebas, así que aquí se replica lo que él configura —prefijo
 * global y ValidationPipe—; si eso se desincroniza, estas pruebas dejarían de
 * parecerse a producción, y por eso está escrito junto.
 */

const RUC = 'API-TEST';
const CORREO = 'api-prueba@ejemplo.test';
const CLAVE = 'ClaveDePrueba123';

let app: INestApplication;
let modulo: TestingModule;
let dueño: DataSource;
let redis: Redis;
let empresa: string;
let usuario: { id: string; correo: string; clave: string };
let token: string;

const api = () => request(app.getHttpServer());
/** Cada POST necesita su clave de idempotencia (ADR 004). */
const nuevaClave = () => randomUUID();

beforeAll(async () => {
  dueño = conexionDueño();
  await dueño.initialize();
  ({ empresa, usuario } = await sembrarEmpresa(dueño, { ruc: RUC, correo: CORREO, clave: CLAVE }));
  await darPermisos(dueño, { empresa, usuarioId: usuario.id });   // todos

  modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = modulo.createNestApplication<NestExpressApplication>();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.init();

  redis = modulo.get(REDIS);
  await limpiarFreno(redis);

  const r = await api().post('/api/auth/login').send({ correo: CORREO, clave: CLAVE }).expect(200);
  token = r.body.accessToken;
}, 60_000);

afterAll(async () => {
  await redis?.quit().catch(() => undefined);
  await app?.close();
  await dueño.query(`DELETE FROM intentos_login WHERE correo LIKE '%@ejemplo.test'`);
  await borrarEmpresa(dueño, empresa, RUC);
  await dueño.destroy();
});

// El freno cuenta por (IP, cuenta) y por IP, y todas las peticiones salen de la
// misma dirección: sin esto, a partir de la sexta petición fallida las pruebas
// siguientes reciben 429 por culpa de las anteriores.
beforeEach(() => limpiarFreno(redis));

describe('sin credenciales no se pasa', () => {
  it('un endpoint protegido responde 401 sin token', async () => {
    await api().get('/api/clientes').expect(401);
  });

  it('un token inventado no vale', async () => {
    await api().get('/api/clientes').set('Authorization', 'Bearer no.es.un.token').expect(401);
  });

  it('el endpoint de salud SÍ es público', async () => {
    // Si dejara de serlo, todos los healthcheck del compose empezarían a fallar
    // y los contenedores entrarían en bucle de reinicio.
    const r = await api().get('/api/salud').expect(200);
    expect(r.body.estado).toBe('ok');
  });

  it('con token válido se entra', async () => {
    await api().get('/api/clientes').set('Authorization', `Bearer ${token}`).expect(200);
  });
});

describe('los permisos se comprueban de verdad, no sólo se declaran', () => {
  it('un usuario sin el permiso recibe 403, no 401', async () => {
    // 401 es «no sé quién eres»; 403 es «sé quién eres y no puedes». Confundirlos
    // manda al usuario a iniciar sesión otra vez para resolver algo que iniciar
    // sesión no resuelve.
    const otro = await sembrarEmpresa(dueño, {
      ruc: 'API-SINPERM', correo: 'sinpermiso@ejemplo.test', clave: CLAVE });
    await darPermisos(dueño, {
      empresa: otro.empresa, usuarioId: otro.usuario.id, codigos: ['clientes:leer'] });

    const login = await api().post('/api/auth/login')
      .send({ correo: 'sinpermiso@ejemplo.test', clave: CLAVE }).expect(200);
    const suToken = login.body.accessToken;

    await api().get('/api/clientes').set('Authorization', `Bearer ${suToken}`).expect(200);
    await api().post('/api/clientes')
      .set('Authorization', `Bearer ${suToken}`)
      .set('Idempotency-Key', nuevaClave())
      .send({ nombre: 'No debería crearse' })
      .expect(403);

    await borrarEmpresa(dueño, otro.empresa, 'API-SINPERM');
  });
});

describe('la validación de entrada corta antes que nada', () => {
  it('rechaza un cuerpo con campos que no existen', async () => {
    // `forbidNonWhitelisted`: un campo de más suele ser un cliente
    // desactualizado o alguien tanteando, y en ambos casos es mejor decirlo.
    const r = await api().post('/api/clientes')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', nuevaClave())
      .send({ nombre: 'Cliente', campoInventado: 'x' })
      .expect(400);
    expect(JSON.stringify(r.body)).toMatch(/campoInventado/);
  });

  it('rechaza un correo mal formado en el login', async () => {
    await api().post('/api/auth/login').send({ correo: 'no-es-correo', clave: 'loquesea1' }).expect(400);
  });
});

describe('idempotencia (ADR 004)', () => {
  it('un POST sin Idempotency-Key se rechaza con 422 y dice qué falta', async () => {
    // Sin la clave, un reintento por timeout crea el registro dos veces y nadie
    // se entera hasta que aparecen dos clientes iguales.
    //
    // El código es 422 y no 400, por decisión del interceptor. Como el 422 se
    // usa TAMBIÉN para «reusaste una clave con otro cuerpo», el estado por sí
    // solo no distingue los dos casos: lo único que los separa es el mensaje.
    // Por eso se fija aquí — si algún día los mensajes convergen, un cliente no
    // podrá saber si le falta una cabecera o si su clave está quemada.
    const r = await api().post('/api/clientes')
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre: 'Sin clave' })
      .expect(422);
    expect(r.body.message).toMatch(/Falta la cabecera Idempotency-Key/);
  });

  it('una clave demasiado corta tampoco vale', async () => {
    // El mínimo de 8 evita que alguien mande "1" y colisione con otro cliente.
    await api().post('/api/clientes')
      .set('Authorization', `Bearer ${token}`).set('Idempotency-Key', 'abc')
      .send({ nombre: 'Clave corta' })
      .expect(422);
  });

  it('repetir la MISMA clave con el mismo cuerpo devuelve la misma respuesta y no duplica', async () => {
    const clave = nuevaClave();
    const cuerpo = { nombre: `Cliente idempotente ${Date.now()}` };

    const primera = await api().post('/api/clientes')
      .set('Authorization', `Bearer ${token}`).set('Idempotency-Key', clave).send(cuerpo).expect(201);
    const segunda = await api().post('/api/clientes')
      .set('Authorization', `Bearer ${token}`).set('Idempotency-Key', clave).send(cuerpo);

    expect(segunda.body.id).toBe(primera.body.id);
    const [{ n }] = await dueño.query(
      `SELECT count(*)::int AS n FROM clientes WHERE nombre = $1`, [cuerpo.nombre]);
    expect(n).toBe(1);
  });

  it('la MISMA clave con OTRO cuerpo se rechaza, no responde lo del otro', async () => {
    // Es el peor caso que evita la huella: reutilizar una clave con un cuerpo
    // distinto y recibir la respuesta de una operación que no era la tuya.
    const clave = nuevaClave();
    await api().post('/api/clientes')
      .set('Authorization', `Bearer ${token}`).set('Idempotency-Key', clave)
      .send({ nombre: `Cliente A ${Date.now()}` }).expect(201);

    const r = await api().post('/api/clientes')
      .set('Authorization', `Bearer ${token}`).set('Idempotency-Key', clave)
      .send({ nombre: `Cliente B ${Date.now()}` });
    expect(r.status).toBe(422);
    // El otro 422. Mismo código, motivo distinto: aquí la clave SÍ vino.
    expect(r.body.message).not.toMatch(/Falta la cabecera/);
  });
});

describe('el freno del login, por HTTP', () => {
  it('corta a la sexta contra la misma cuenta y devuelve Retry-After', async () => {
    const correo = 'frenado@ejemplo.test';
    const codigos: number[] = [];
    for (let i = 0; i < 7; i++) {
      const r = await api().post('/api/auth/login').send({ correo, clave: 'claveequivocada' });
      codigos.push(r.status);
    }
    expect(codigos.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(codigos[5]).toBe(429);

    const ultima = await api().post('/api/auth/login').send({ correo, clave: 'claveequivocada' });
    expect(ultima.headers['retry-after-login-cuenta']).toBeDefined();
  });

  it('frenar una cuenta NO frena a la de al lado', async () => {
    // La propiedad que motiva que el freno cuente por (IP, cuenta): si contara
    // sólo por IP, una oficina detrás de NAT se bloquearía entera.
    for (let i = 0; i < 6; i++) {
      await api().post('/api/auth/login').send({ correo: 'ana@ejemplo.test', clave: 'claveequivocada' });
    }
    const beto = await api().post('/api/auth/login')
      .send({ correo: 'beto@ejemplo.test', clave: 'claveequivocada' });
    expect(beto.status).toBe(401);
  });
});

describe('aislamiento entre empresas, por HTTP', () => {
  it('el token de una empresa no ve los datos de otra', async () => {
    // La RLS lo garantiza en la base; esto comprueba que el contexto llega
    // hasta ella. Si el interceptor dejara de fijar `app.empresa_id`, la
    // consulta devolvería cero filas en vez de las de otro — pero si fijara la
    // empresa EQUIVOCADA, devolvería las ajenas sin ningún error.
    const nombre = `Cliente reservado ${Date.now()}`;
    await api().post('/api/clientes')
      .set('Authorization', `Bearer ${token}`).set('Idempotency-Key', nuevaClave())
      .send({ nombre }).expect(201);

    const otro = await sembrarEmpresa(dueño, {
      ruc: 'API-OTRA', correo: 'otra@ejemplo.test', clave: CLAVE });
    await darPermisos(dueño, { empresa: otro.empresa, usuarioId: otro.usuario.id });
    const login = await api().post('/api/auth/login')
      .send({ correo: 'otra@ejemplo.test', clave: CLAVE }).expect(200);

    const suyos = await api().get('/api/clientes')
      .set('Authorization', `Bearer ${login.body.accessToken}`).expect(200);
    expect(JSON.stringify(suyos.body)).not.toContain(nombre);

    await borrarEmpresa(dueño, otro.empresa, 'API-OTRA');
  });
});

describe('la auditoría se escribe sola', () => {
  it('un alta por HTTP queda registrada con autor y ruta', async () => {
    const nombre = `Cliente auditado ${Date.now()}`;
    const r = await api().post('/api/clientes')
      .set('Authorization', `Bearer ${token}`).set('Idempotency-Key', nuevaClave())
      .send({ nombre }).expect(201);

    const [a] = await dueño.query(
      `SELECT accion, entidad, usuario_id, ruta FROM auditoria
        WHERE empresa_id = $1 AND entidad_id = $2 ORDER BY auditoria_id DESC LIMIT 1`,
      [empresa, String(r.body.id)]);
    expect(a).toBeDefined();
    expect(a.entidad).toBe('clientes');
    expect(String(a.usuario_id)).toBe(usuario.id);
  });
});

describe('la API contesta con la misma forma en las tres operaciones', () => {
  it('POST, PATCH y DELETE devuelven un OBJETO, no un array de uno', async () => {
    // Regresión. TypeORM devuelve `[filas]` en un INSERT … RETURNING pero
    // `[[filas], contador]` en un UPDATE … RETURNING, así que el mismo
    // `const [x] = await query(...)` que acierta en el alta capturaba el ARRAY
    // en la edición y en la baja. Resultado medido: POST respondía
    // `{"id":"288",…}` y PATCH y DELETE `[{"id":"288",…}]`.
    //
    // No rompía nada visible —el frontend descarta esos valores y recarga la
    // lista— pero la API contestaba con dos formas para la misma entidad, y la
    // auditoría guardaba el array como `valor_nuevo` en una tabla append-only
    // que después no se puede corregir.
    const alta = await api().post('/api/clientes')
      .set('Authorization', `Bearer ${token}`).set('Idempotency-Key', nuevaClave())
      .send({ nombre: `Forma ${Date.now()}` }).expect(201);
    expect(Array.isArray(alta.body)).toBe(false);

    const edicion = await api().patch(`/api/clientes/${alta.body.id}`)
      .set('Authorization', `Bearer ${token}`).send({ nombre: 'Forma editada' }).expect(200);
    expect(Array.isArray(edicion.body)).toBe(false);
    expect(edicion.body.nombre).toBe('Forma editada');

    const baja = await api().delete(`/api/clientes/${alta.body.id}`)
      .set('Authorization', `Bearer ${token}`).expect(200);
    expect(Array.isArray(baja.body)).toBe(false);
    expect(baja.body.estado).toBe('inactivo');
  });

  it('la auditoría guarda un OBJETO en valor_nuevo, no un array', async () => {
    const alta = await api().post('/api/clientes')
      .set('Authorization', `Bearer ${token}`).set('Idempotency-Key', nuevaClave())
      .send({ nombre: `Auditada ${Date.now()}` }).expect(201);
    await api().patch(`/api/clientes/${alta.body.id}`)
      .set('Authorization', `Bearer ${token}`).send({ nombre: 'Auditada y editada' }).expect(200);

    const [a] = await dueño.query(
      `SELECT jsonb_typeof(valor_nuevo) AS tipo FROM auditoria
        WHERE empresa_id = $1 AND entidad_id = $2 ORDER BY auditoria_id DESC LIMIT 1`,
      [empresa, String(alta.body.id)]);
    expect(a.tipo).toBe('object');
  });
});

describe('dar de baja libera el identificador, y no con un 500', () => {
  it('el RUC de un cliente dado de baja se puede volver a registrar', async () => {
    // Regresión de un desajuste entre el código y el esquema: los servicios
    // comprobaban la unicidad con `eliminado_en IS NULL` —su intención era que
    // la baja liberase el RUC— y los índices no llevaban esa condición, porque
    // en PostgreSQL una UNIQUE constraint no puede ser parcial y estos estaban
    // declarados como constraint. El servicio dejaba pasar el alta y el INSERT
    // chocaba después; como nadie traduce el 23505 en los catálogos, el usuario
    // recibía **500 «Internal server error»**.
    const ruc = `RUC-${Date.now()}`;
    const alta = await api().post('/api/clientes')
      .set('Authorization', `Bearer ${token}`).set('Idempotency-Key', nuevaClave())
      .send({ nombre: 'Original', ruc }).expect(201);
    await api().delete(`/api/clientes/${alta.body.id}`)
      .set('Authorization', `Bearer ${token}`).expect(200);

    const reintento = await api().post('/api/clientes')
      .set('Authorization', `Bearer ${token}`).set('Idempotency-Key', nuevaClave())
      .send({ nombre: 'Reintento tras la baja', ruc });
    expect(reintento.status).toBe(201);
  });

  it('pero con el cliente VIVO sigue dando 409, no 500', async () => {
    // El otro lado de la misma regla: liberar el identificador al dar de baja
    // no puede convertirse en «ya no se comprueba nada».
    const ruc = `RUC-${Date.now()}-vivo`;
    await api().post('/api/clientes')
      .set('Authorization', `Bearer ${token}`).set('Idempotency-Key', nuevaClave())
      .send({ nombre: 'Vivo', ruc }).expect(201);
    const choque = await api().post('/api/clientes')
      .set('Authorization', `Bearer ${token}`).set('Idempotency-Key', nuevaClave())
      .send({ nombre: 'Duplicado', ruc });
    expect(choque.status).toBe(409);
  });
});
