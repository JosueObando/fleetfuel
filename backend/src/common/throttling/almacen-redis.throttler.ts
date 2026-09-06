import type { Redis } from 'ioredis';
import type { ThrottlerStorage } from '@nestjs/throttler';

// El paquete no reexporta `ThrottlerStorageRecord` desde su raíz: sólo vive en
// `dist/throttler-storage-record.interface`. Se deriva del propio contrato en
// vez de importarlo por ruta profunda, que es lo primero que se rompe al subir
// de versión.
type RegistroDeFreno = Awaited<ReturnType<ThrottlerStorage['increment']>>;

/**
 * Cuenta las peticiones en Redis, no en memoria.
 *
 * `@nestjs/throttler` trae un almacenamiento por defecto que vive en un `Map`
 * del proceso. Aquí no sirve, y por una razón concreta: este es el ÚNICO freno
 * que tiene el login —no hay bloqueo por intentos ni límite en el proxy—, así
 * que un contador que muere con el proceso es un freno que cualquier reinicio
 * borra. Y el compose levanta el backend con `restart: unless-stopped`, o sea
 * que reinicia solo. Redis ya está delante: es donde viven las revocaciones de
 * refresco, sobrevive al despliegue y valdría igual si algún día hubiera más
 * de una réplica.
 *
 * El conteo va en Lua y no en tres llamadas desde Node a propósito. Un
 * `GET` + `INCR` + `EXPIRE` deja huecos entre llamada y llamada por los que
 * pasan peticiones concurrentes, y «muchas peticiones a la vez» no es un caso
 * raro aquí: es la forma exacta que tiene el ataque del que defiende esto.
 * Redis ejecuta un script Lua de un tirón, sin intercalar otros comandos.
 *
 * La ventana es fija, no deslizante: el contador expira entero al cumplirse
 * `ventanaMs` en vez de ir soltando peticiones una a una. En el borde deja
 * pasar hasta el doble del límite (el final de una ventana y el principio de
 * la siguiente). Para frenar fuerza bruta da igual —un atacante ganaría unos
 * pocos intentos cada varios minutos— y a cambio el estado es un entero con
 * TTL en vez de una lista de marcas de tiempo por clave.
 */
const GUION = `
local clavePeticiones = KEYS[1]
local claveBloqueo    = KEYS[2]
local ventanaMs       = tonumber(ARGV[1])
local limite          = tonumber(ARGV[2])
local bloqueoMs       = tonumber(ARGV[3])

-- Si ya esta bloqueado no se cuenta ni se prorroga el bloqueo. Prorrogarlo con
-- cada intento convertiria el freno en una carcel que el propio atacante
-- mantiene cerrada sobre la victima: le bastaria seguir llamando para que el
-- dueño legitimo de la cuenta no pudiera entrar nunca.
local restaBloqueo = redis.call('PTTL', claveBloqueo)
if restaBloqueo > 0 then
  local peticiones = tonumber(redis.call('GET', clavePeticiones)) or 0
  local restaVentana = redis.call('PTTL', clavePeticiones)
  if restaVentana < 0 then restaVentana = 0 end
  return {peticiones, restaVentana, 1, restaBloqueo}
end

local peticiones = redis.call('INCR', clavePeticiones)
-- El TTL se pone solo con la primera: si se pusiera en cada una, la ventana se
-- renovaria sola y un atacante constante no la agotaria jamas.
if peticiones == 1 then
  redis.call('PEXPIRE', clavePeticiones, ventanaMs)
end
local restaVentana = redis.call('PTTL', clavePeticiones)
-- -1 = clave sin TTL. No deberia pasar, pero una clave eterna seria un freno
-- que no se suelta nunca: se le pone ventana y sigue.
if restaVentana < 0 then
  redis.call('PEXPIRE', clavePeticiones, ventanaMs)
  restaVentana = ventanaMs
end

if peticiones > limite then
  redis.call('SET', claveBloqueo, 1, 'PX', bloqueoMs)
  -- El contador vence CUANDO vence el bloqueo, no antes ni despues. Si el
  -- bloqueo fuera mas corto que la ventana —configuracion perfectamente
  -- posible— al soltarlo el contador seguiria por encima del limite: el
  -- siguiente intento volveria a pasarse y a bloquear, y otra vez, para
  -- siempre. Una carcel permanente que aparece solo el dia que alguien AFLOJA
  -- el bloqueo creyendo que lo hace mas permisivo.
  redis.call('PEXPIRE', clavePeticiones, bloqueoMs)
  return {peticiones, bloqueoMs, 1, bloqueoMs}
end

return {peticiones, restaVentana, 0, 0}
`;

export class AlmacenRedisDeThrottler implements ThrottlerStorage {
  constructor(
    private readonly redis: Redis,
    private readonly prefijo = 'freno',
  ) {}

  async increment(
    clave: string, ventanaMs: number, limite: number,
    bloqueoMs: number, nombre: string,
  ): Promise<RegistroDeFreno> {
    const base = `${this.prefijo}:${nombre}:${clave}`;

    const [peticiones, restaVentanaMs, bloqueado, restaBloqueoMs] =
      (await this.redis.eval(
        GUION, 2,
        `${base}:n`, `${base}:bloqueo`,
        ventanaMs, limite, bloqueoMs,
      )) as [number, number, number, number];

    // El guard espera SEGUNDOS aquí, aunque reciba milisegundos en `ttl` y
    // `blockDuration`. Es asimétrico y no está documentado; se comprobó contra
    // la implementación en memoria del propio paquete, que devuelve
    // `Math.ceil(ms / 1000)`. Devolver milisegundos daría una cabecera
    // `Retry-After` de 300000 «segundos».
    return {
      totalHits: peticiones,
      timeToExpire: Math.ceil(restaVentanaMs / 1000),
      isBlocked: bloqueado === 1,
      timeToBlockExpire: Math.ceil(restaBloqueoMs / 1000),
    };
  }
}
