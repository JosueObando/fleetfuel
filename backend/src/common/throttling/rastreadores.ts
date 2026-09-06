import { createHash } from 'crypto';

/**
 * Los dos frenos del login, y por qué son dos.
 *
 * Contar sólo por IP no vale: si la oficina sale por NAT, todos los usuarios
 * comparten una dirección, y un límite estricto por IP deja fuera a la oficina
 * entera en cuanto unos cuantos se equivocan de clave a la misma hora. Contar
 * sólo por cuenta tampoco: quien barre muchas cuentas con una clave común
 * («spraying») no llega al límite de ninguna.
 *
 * Así que se cuentan las dos cosas:
 *
 * - `login-cuenta`, estricto, por (IP, cuenta). Es el que ataja el caso que
 *   motiva todo esto: quien ya acertó la clave y recorre los 10⁶ códigos TOTP
 *   va siempre contra UNA cuenta. Como la IP entra en la clave, el vecino de
 *   NAT no gasta el cupo de nadie más.
 * - `login-ip`, holgado, por IP. La red de seguridad del barrido, que al
 *   repartirse entre muchas cuentas se le escapa al primero.
 */
export const FRENO_CUENTA = 'login-cuenta';
export const FRENO_IP = 'login-ip';

/**
 * El correo entra en la clave de Redis como huella, no en claro: un `KEYS *`
 * no tiene por qué devolver la lista de quién intentó entrar hoy.
 *
 * En minúsculas porque si no, `Admin@…` y `admin@…` serían dos cupos y bastaría
 * alternar mayúsculas para tener intentos infinitos.
 *
 * Y tolera cualquier cosa porque **los guards corren antes que el
 * ValidationPipe**: aquí el cuerpo es lo que mandó el cliente, sin validar. Un
 * `correo` que sea un objeto, un número o nada tiene que caer en un cupo, no
 * reventar el guard — si revienta, la petición ni siquiera se cuenta.
 */
export function huellaDeCorreo(correo: unknown): string {
  if (typeof correo !== 'string' || correo.trim() === '') return 'sin-correo';
  return createHash('sha256')
    .update(correo.trim().toLowerCase())
    .digest('hex')
    .slice(0, 16);
}

type PeticionMinima = { ip?: string; body?: unknown };

function direccion(req: PeticionMinima): string {
  return req.ip ?? 'sin-ip';
}

function correoDelCuerpo(req: PeticionMinima): unknown {
  return req.body && typeof req.body === 'object'
    ? (req.body as Record<string, unknown>).correo
    : undefined;
}

export function rastreadorPorCuenta(req: PeticionMinima): string {
  return `${direccion(req)}|${huellaDeCorreo(correoDelCuerpo(req))}`;
}

export function rastreadorPorIp(req: PeticionMinima): string {
  return direccion(req);
}
