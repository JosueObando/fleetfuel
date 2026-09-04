/*
 * Único punto por el que el frontend habla con la API.
 *
 * Ninguna pantalla llama a `fetch` directamente: si lo hicieran, cada una
 * tendría que acordarse del token, de la clave de idempotencia y de cómo se
 * ve un error del servidor — y la que se olvidara fallaría de forma distinta
 * a las demás.
 */

// El navegador corre en la máquina de quien mira, no en el servidor: aquí
// `localhost` sería el equipo del usuario, no la API.
export const BASE =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://10.0.0.193:4100/api';

const CLAVE_SESION = 'fleetfuel.sesion';

export interface Sesion {
  accessToken: string;
  refreshToken?: string;
  usuario: { id: string; nombre: string; correo: string; roles: string[] };
}

export function leerSesion(): Sesion | null {
  if (typeof window === 'undefined') return null;
  try {
    const crudo = window.localStorage.getItem(CLAVE_SESION);
    return crudo ? (JSON.parse(crudo) as Sesion) : null;
  } catch {
    // Ventana privada, almacenamiento bloqueado o JSON corrupto: se trata
    // como «no hay sesión», que es el estado seguro.
    return null;
  }
}

export function guardarSesion(s: Sesion | null) {
  try {
    if (s) window.localStorage.setItem(CLAVE_SESION, JSON.stringify(s));
    else window.localStorage.removeItem(CLAVE_SESION);
  } catch { /* sin almacenamiento la sesión dura lo que la pestaña */ }
}

export class ErrorApi extends Error {
  constructor(readonly estado: number, mensaje: string) { super(mensaje); }
}

/** Extrae el mensaje del cuerpo de error de Nest, que a veces es un array. */
function mensajeDe(cuerpo: unknown, estado: number): string {
  const m = (cuerpo as { message?: unknown })?.message;
  if (Array.isArray(m)) return m.join('. ');
  if (typeof m === 'string') return m;
  return `Error ${estado}`;
}

async function pedir<T>(ruta: string, init: RequestInit = {}): Promise<T> {
  const sesion = leerSesion();
  const cabeceras = new Headers(init.headers);
  cabeceras.set('Content-Type', 'application/json');
  if (sesion) cabeceras.set('Authorization', `Bearer ${sesion.accessToken}`);

  // Idempotencia obligatoria en todo POST (ADR 004). Se genera aquí y no en
  // cada pantalla: una pantalla que se olvidara recibiría un 422 opaco.
  if ((init.method ?? 'GET').toUpperCase() === 'POST') {
    cabeceras.set('Idempotency-Key', crypto.randomUUID());
  }

  const respuesta = await fetch(`${BASE}${ruta}`, { ...init, headers: cabeceras });

  if (respuesta.status === 204) return undefined as T;
  const cuerpo = await respuesta.json().catch(() => null);

  if (!respuesta.ok) {
    // El token vive 15 minutos. Un 401 casi siempre es eso, no una credencial
    // mala: se limpia la sesión para que la aplicación pida entrar de nuevo
    // en vez de quedarse mostrando errores.
    if (respuesta.status === 401) guardarSesion(null);
    throw new ErrorApi(respuesta.status, mensajeDe(cuerpo, respuesta.status));
  }
  return cuerpo as T;
}

export const api = {
  listar:  <T>(ruta: string) => pedir<T[]>(ruta),
  obtener: <T>(ruta: string) => pedir<T>(ruta),
  crear:   <T>(ruta: string, datos: unknown) =>
             pedir<T>(ruta, { method: 'POST', body: JSON.stringify(datos) }),
  actualizar: <T>(ruta: string, datos: unknown) =>
             pedir<T>(ruta, { method: 'PATCH', body: JSON.stringify(datos) }),
  desactivar: <T>(ruta: string) => pedir<T>(ruta, { method: 'DELETE' }),
};

export async function entrar(correo: string, clave: string, codigoTotp?: string) {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ correo, clave, ...(codigoTotp ? { codigoTotp } : {}) }),
  });
  const cuerpo = await r.json().catch(() => null);
  if (!r.ok) throw new ErrorApi(r.status, mensajeDe(cuerpo, r.status));
  return cuerpo as Sesion & { debeInscribirMfa?: boolean };
}
