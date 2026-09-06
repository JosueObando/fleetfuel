import 'reflect-metadata';
import { config as cargarEnv } from 'dotenv';
import Redis from 'ioredis';
import { join } from 'path';

import { AlmacenRedisDeThrottler } from '../src/common/throttling/almacen-redis.throttler';

cargarEnv({ path: join(__dirname, '../../.env') });

/**
 * El freno del login contra un Redis real.
 *
 * Nada de esto se puede probar con un doble: lo que se está fijando es el
 * comportamiento del script Lua dentro de Redis —la atomicidad, los TTL, qué
 * devuelve `PTTL` en cada caso— y un doble sólo probaría que el doble hace lo
 * que le pedimos. Es el mismo criterio que `cimientos.integracion.ts` aplica a
 * la RLS de Postgres.
 *
 * Importa más de lo normal porque este es el ÚNICO freno del login: no hay
 * límite en el proxy ni bloqueo por intentos detrás. Si falla, no falla
 * ruidosamente — falla dejando pasar.
 */

const PREFIJO = 'prueba-freno';
const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6380', 10),
  maxRetriesPerRequest: 3,
});
const almacen = new AlmacenRedisDeThrottler(redis, PREFIJO);

const VENTANA = 60_000;
const BLOQUEO = 3_000;
let n = 0;
const claveNueva = () => `clave-${process.pid}-${n++}`;

afterAll(async () => {
  const claves = await redis.keys(`${PREFIJO}:*`);
  if (claves.length) await redis.del(...claves);
  await redis.quit();
});

describe('conteo', () => {
  it('cuenta hacia arriba y no bloquea hasta pasar el límite', async () => {
    const clave = claveNueva();
    for (let i = 1; i <= 3; i++) {
      const r = await almacen.increment(clave, VENTANA, 3, BLOQUEO, 'cuenta');
      expect(r.totalHits).toBe(i);
      expect(r.isBlocked).toBe(false);
    }
    // La cuarta es la que pasa de 3.
    const cuarta = await almacen.increment(clave, VENTANA, 3, BLOQUEO, 'cuenta');
    expect(cuarta.totalHits).toBe(4);
    expect(cuarta.isBlocked).toBe(true);
  });

  it('no mezcla claves distintas', async () => {
    // Si las mezclara, el intento de un usuario gastaría el cupo de otro y el
    // freno sería un ataque de denegación contra la propia gente.
    const a = claveNueva();
    const b = claveNueva();
    await almacen.increment(a, VENTANA, 5, BLOQUEO, 'cuenta');
    await almacen.increment(a, VENTANA, 5, BLOQUEO, 'cuenta');
    const rb = await almacen.increment(b, VENTANA, 5, BLOQUEO, 'cuenta');
    expect(rb.totalHits).toBe(1);
  });

  it('no mezcla frenos distintos con la misma clave', async () => {
    // `login-cuenta` y `login-ip` comparten rastreador en el caso degenerado de
    // una IP sin cuerpo: si compartieran contador, el límite estricto se
    // comería el holgado.
    const clave = claveNueva();
    await almacen.increment(clave, VENTANA, 5, BLOQUEO, 'cuenta');
    const porIp = await almacen.increment(clave, VENTANA, 5, BLOQUEO, 'ip');
    expect(porIp.totalHits).toBe(1);
  });

  it('resiste 20 peticiones simultáneas sin perder ninguna', async () => {
    // La razón de que el conteo esté en Lua. Con GET+INCR desde Node, las
    // peticiones concurrentes leen el mismo valor y se pisan — y «muchas a la
    // vez» es la forma exacta que tiene el ataque del que esto defiende.
    const clave = claveNueva();
    const todas = await Promise.all(
      Array.from({ length: 20 }, () => almacen.increment(clave, VENTANA, 100, BLOQUEO, 'cuenta')),
    );
    const conteos = todas.map(r => r.totalHits).sort((a, b) => a - b);
    expect(conteos).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });
});

describe('bloqueo', () => {
  it('devuelve el tiempo restante en SEGUNDOS, no en milisegundos', async () => {
    // El guard pone este número tal cual en la cabecera `Retry-After`. Devolver
    // milisegundos daría un «espera 3000 segundos» y el error pasaría por
    // configuración agresiva en vez de por defecto.
    const clave = claveNueva();
    await almacen.increment(clave, VENTANA, 1, BLOQUEO, 'cuenta');
    const bloqueada = await almacen.increment(clave, VENTANA, 1, BLOQUEO, 'cuenta');
    expect(bloqueada.isBlocked).toBe(true);
    expect(bloqueada.timeToBlockExpire).toBe(3);
    expect(bloqueada.timeToExpire).toBeLessThanOrEqual(60);
  });

  it('no prorroga el bloqueo por seguir intentando', async () => {
    // Si cada intento renovara el bloqueo, al atacante le bastaría con seguir
    // llamando para que el dueño legítimo de la cuenta no entrara nunca: el
    // freno se convertiría en el arma.
    const clave = claveNueva();
    await almacen.increment(clave, VENTANA, 1, BLOQUEO, 'cuenta');
    const primera = await almacen.increment(clave, VENTANA, 1, BLOQUEO, 'cuenta');
    expect(primera.timeToBlockExpire).toBe(3);

    await new Promise(r => setTimeout(r, 1300));
    const insistiendo = await almacen.increment(clave, VENTANA, 1, BLOQUEO, 'cuenta');
    expect(insistiendo.isBlocked).toBe(true);
    expect(insistiendo.timeToBlockExpire).toBeLessThan(primera.timeToBlockExpire);
  });

  it('suelta al expirar el bloqueo', async () => {
    const clave = claveNueva();
    await almacen.increment(clave, 1_000, 1, 1_000, 'cuenta');
    expect((await almacen.increment(clave, 1_000, 1, 1_000, 'cuenta')).isBlocked).toBe(true);

    await new Promise(r => setTimeout(r, 1300));
    const suelto = await almacen.increment(clave, 1_000, 1, 1_000, 'cuenta');
    expect(suelto.isBlocked).toBe(false);
    expect(suelto.totalHits).toBe(1);
  });
});

describe('ventana', () => {
  it('no se renueva con cada petición', async () => {
    // El fallo que evita: poner el TTL en cada INCR en vez de sólo en el
    // primero. La ventana se refrescaría sola y un atacante constante no la
    // agotaría jamás — el contador subiría, pero nunca caducaría, así que el
    // límite... seguiría funcionando. Lo que se rompe es lo contrario: quien
    // hace una petición cada 59 s nunca vería expirar su cupo.
    const clave = claveNueva();
    const primera = await almacen.increment(clave, 3_000, 10, BLOQUEO, 'cuenta');
    await new Promise(r => setTimeout(r, 1300));
    const segunda = await almacen.increment(clave, 3_000, 10, BLOQUEO, 'cuenta');
    expect(segunda.timeToExpire).toBeLessThan(primera.timeToExpire);
  });
});

describe('el bloqueo se lleva el contador consigo', () => {
  it('no encarcela para siempre cuando el bloqueo es MÁS CORTO que la ventana', async () => {
    // Configuración legítima y peligrosa: ventana larga, bloqueo corto. Si al
    // soltar el bloqueo el contador siguiera por encima del límite, el
    // siguiente intento volvería a bloquear, y otra vez, indefinidamente.
    // Aparecería sólo el día que alguien AFLOJE LOGIN_BLOQUEO_SEGUNDOS
    // creyendo que lo hace más permisivo, y haría lo contrario.
    const clave = claveNueva();
    const VENTANA_LARGA = 60_000;
    const BLOQUEO_CORTO = 1_000;

    await almacen.increment(clave, VENTANA_LARGA, 1, BLOQUEO_CORTO, 'cuenta');
    expect((await almacen.increment(clave, VENTANA_LARGA, 1, BLOQUEO_CORTO, 'cuenta')).isBlocked)
      .toBe(true);

    await new Promise(r => setTimeout(r, 1300));
    const tras = await almacen.increment(clave, VENTANA_LARGA, 1, BLOQUEO_CORTO, 'cuenta');
    expect(tras.isBlocked).toBe(false);
    expect(tras.totalHits).toBe(1);
  });
});
