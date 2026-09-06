import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import crypto from 'node:crypto';

/*
 * Preparación común de los dos recorridos.
 *
 * Existe para que se puedan correr en CI, donde no hay `.env` y donde la base
 * nace vacía: el administrador recién sembrado NO tiene el segundo factor
 * inscrito, así que un login normal devuelve la sesión de inscripción del §7 y
 * el recorrido se queda en la puerta.
 *
 * En vez de amañar la base con SQL, se hace lo que haría el primer usuario
 * real: inscribir el TOTP por la API y seguir. De regalo, eso convierte el
 * arranque del recorrido en una prueba del camino de inscripción, que es
 * literalmente el primer paso de cualquiera que estrene el sistema.
 */

/*
 * Dónde se recuerda el secreto que este mismo recorrido inscribió.
 *
 * Hace falta porque los dos recorridos corren SEGUIDOS contra la misma base: el
 * primero inscribe el segundo factor y el segundo se lo encuentra ya puesto sin
 * conocer su secreto. Sin esta caché, encadenarlos falla — y encadenarlos es
 * exactamente lo que hace CI.
 */
const CACHE = join(new URL('.', import.meta.url).pathname, '.secreto-totp');

/** Variables: primero las del proceso —CI—, y si no el `.env` del repositorio. */
export function entorno() {
  const delFichero = existsSync('../.env')
    ? Object.fromEntries(readFileSync('../.env', 'utf8').split('\n')
        .filter(l => l.includes('=') && !l.trim().startsWith('#'))
        .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]))
    : {};
  return { ...delFichero, ...process.env };
}

/** Código TOTP de seis dígitos a partir del secreto en base32. */
export function totp(secreto) {
  const clave = Buffer.from(secreto.replace(/=+$/, '').split('').reduce((b, c) =>
    b + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c).toString(2).padStart(5, '0'), '')
    .match(/.{8}/g).map(b => parseInt(b, 2)));
  const cont = Buffer.alloc(8);
  cont.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000 / 30)));
  const h = crypto.createHmac('sha1', clave).update(cont).digest();
  const o = h[h.length - 1] & 0x0f;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
}

/**
 * Devuelve un secreto TOTP con el que se pueda entrar por la interfaz.
 *
 * Si la cuenta ya lo tiene inscrito —el caso de desarrollo— se usa el conocido
 * (`E2E_TOTP_SECRETO`). Si no —el caso de una base recién sembrada— se inscribe
 * aquí mismo y se devuelve el que acaba de generar el servidor.
 */
export async function asegurarSegundoFactor({ api, correo, clave, secretoConocido }) {
  const entrar = (cuerpo) => fetch(`${api}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ correo, clave, ...cuerpo }),
  }).then(async r => ({ estado: r.status, cuerpo: await r.json().catch(() => null) }));

  const primera = await entrar({});

  /* Tres respuestas posibles, y las tres son normales:
   *
   *   401 «Se requiere el código MFA»  → ya está inscrito (el caso de
   *                                      desarrollo). Se usa el conocido.
   *   200 con `debeInscribirMfa`       → base recién sembrada: hay que
   *                                      inscribirlo, y es lo que se hace abajo.
   *   200 a secas                      → el rol no exige segundo factor.
   */
  if (primera.estado === 401 && /código MFA/i.test(primera.cuerpo?.message ?? '')) {
    const recordado = existsSync(CACHE) ? readFileSync(CACHE, 'utf8').trim() : '';
    const secreto = secretoConocido || recordado;
    if (!secreto) {
      throw new Error('La cuenta ya tiene TOTP inscrito y no se conoce su secreto. ' +
                      'Define E2E_TOTP_SECRETO o borra e2e/.secreto-totp.');
    }
    return secreto;
  }
  if (primera.estado !== 200) {
    throw new Error(`No se pudo entrar como ${correo}: ${primera.estado} ` +
                    `${JSON.stringify(primera.cuerpo)?.slice(0, 120)}`);
  }
  if (!primera.cuerpo.debeInscribirMfa) return secretoConocido;

  const cabeceras = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${primera.cuerpo.accessToken}`,
  };
  const iniciado = await fetch(`${api}/auth/mfa/iniciar`, { method: 'POST', headers: cabeceras })
    .then(r => r.json());
  if (!iniciado?.secreto) throw new Error('mfa/iniciar no devolvió secreto');

  const confirmado = await fetch(`${api}/auth/mfa/confirmar`, {
    method: 'POST', headers: cabeceras,
    body: JSON.stringify({ codigoTotp: totp(iniciado.secreto) }),
  });
  if (!confirmado.ok) throw new Error(`mfa/confirmar respondió ${confirmado.status}`);

  // Se recuerda para el recorrido siguiente, que encontrará la cuenta ya
  // inscrita y no tendría cómo saber el secreto.
  try { writeFileSync(CACHE, iniciado.secreto); } catch { /* sin permiso de escritura, da igual */ }
  console.log('  ℹ segundo factor inscrito para el recorrido');
  return iniciado.secreto;
}

/** Sesión completa (con TOTP) para poder preparar datos por la API. */
export async function sesionCompleta({ api, correo, clave, secreto }) {
  const r = await fetch(`${api}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ correo, clave, ...(secreto ? { codigoTotp: totp(secreto) } : {}) }),
  });
  const cuerpo = await r.json();
  if (!cuerpo.accessToken) throw new Error(`login para preparar datos: ${r.status}`);
  return cuerpo.accessToken;
}

/**
 * Deja en la base lo que el recorrido de 1B NECESITA y no crea: un cliente con
 * estación, y un producto.
 *
 * El recorrido de 1B daba por hecho que existían. En desarrollo existían —de
 * sesiones anteriores— y en una base recién sembrada no, así que fallaba con
 * «ningún cliente tiene estaciones dadas de alta» y parecía un fallo de la
 * aplicación. Una prueba que depende de datos que no crea no es reproducible:
 * pasa o falla según lo que quedara de la vez anterior.
 *
 * Los datos se preparan por la API, no por la interfaz: lo que 1B viene a
 * probar es el flujo orden → plan de carga → viaje, no volver a dar de alta
 * catálogos, que ya cubre 1A.
 */
export async function asegurarDatosDe1B({ api, token }) {
  const cab = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  const clave = () => crypto.randomUUID();
  const pedir = async (metodo, ruta, cuerpo) => {
    const r = await fetch(`${api}${ruta}`, {
      method: metodo, headers: { ...cab, ...(metodo === 'POST' ? { 'Idempotency-Key': clave() } : {}) },
      ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}),
    });
    if (!r.ok) throw new Error(`${metodo} ${ruta} → ${r.status} ${(await r.text()).slice(0, 140)}`);
    return r.json();
  };

  const estaciones = await pedir('GET', '/estaciones');
  if (!estaciones.length) {
    const clientes = await pedir('GET', '/clientes');
    const cliente = clientes[0] ?? await pedir('POST', '/clientes', { nombre: 'Cliente del recorrido' });
    await pedir('POST', '/estaciones',
      { clienteId: String(cliente.id), nombre: 'Estación del recorrido' });
    console.log('  ℹ estación creada para el recorrido');
  }

  const productos = await pedir('GET', '/productos');
  if (!productos.length) {
    await pedir('POST', '/productos', { codigo: 'E2E-95', nombre: 'Gasolina 95' });
    console.log('  ℹ producto creado para el recorrido');
  }
}
