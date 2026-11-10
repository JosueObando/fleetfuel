/*
 * Recorrido de la puerta y la administración, por la INTERFAZ.
 *
 * Cubre lo que la auditoría TDD del 2026-09-12 encontró vacío: la raíz del
 * dominio, la puerta de sesión sobre el boceto del tablero, y las pantallas de
 * usuarios y roles —cuya API existía desde la Fase 0.3 sin que nada la
 * llamara—.
 *
 * POR QUÉ ESTO TIENE QUE SER UN RECORRIDO DE NAVEGADOR
 *
 * Los dos fallos que corrige NO LOS VE NINGUNA PRUEBA DE COMPONENTE:
 *
 *   · `/` redirigía al tablero, un boceto con datos inventados servido SIN
 *     SESIÓN. `Tablero.spec.tsx` probaba la maqueta y pasaba; los tres
 *     recorridos existentes hacen `goto('/entrar')` directo y nunca visitan la
 *     raíz. La ruta que nadie prueba es la que todo el mundo escribe.
 *   · la puerta de sesión vive en un efecto que sólo corre en el cliente, y
 *     jsdom no hidrata: ya costó un recorrido en rojo una vez.
 *
 * Requiere las librerías de Chromium (ver e2e/README.md).
 * Uso:  node e2e/recorrido-admin.mjs
 */
import { chromium } from '@playwright/test';
import { entorno, totp, asegurarSegundoFactor } from './entorno.mjs';

const env = entorno();
const API = env.E2E_API ?? 'http://localhost:4100/api';
const APP = env.E2E_APP ?? 'http://localhost:3100';
const CORREO = env.SEED_ADMIN_CORREO ?? 'admin@fleetfuel.jop.lat';

const SECRETO = await asegurarSegundoFactor({
  api: API, correo: CORREO, clave: env.SEED_ADMIN_CLAVE,
  secretoConocido: env.E2E_TOTP_SECRETO,
});

const nav = await chromium.launch();
const pag = await nav.newPage({ viewport: { width: 1600, height: 1000 } });
const fallos = [];

/*
 * Se vigilan las RESPUESTAS, no la consola — igual que el recorrido de 1C.
 *
 * Este recorrido abre un viaje en la pantalla de despacho, y ahí
 * `GET /liquidaciones/viaje/:id` responde **404 mientras el viaje no está
 * liquidado**, que es el caso normal: la pantalla lo trata como «todavía no hay
 * liquidación» y no como un error.
 *
 * El navegador escribe «Failed to load resource» por cada uno sin decir de qué
 * petición habla, así que filtrar por ese texto sería filtrar a ciegas —taparía
 * también un 500 de verdad—. Se ignora esa línea concreta y se compara cada
 * respuesta con una lista de lo esperado; todo lo demás sigue siendo fatal.
 */
const ESPERADAS = [
  { patron: /\/api\/liquidaciones\/viaje\//, estado: 404 },
];

pag.on('pageerror', e => fallos.push('error de página: ' + e.message));
pag.on('console', m => {
  if (m.type() !== 'error') return;
  if (/Failed to load resource/.test(m.text())) return;
  fallos.push('consola: ' + m.text());
});
pag.on('response', r => {
  if (r.status() < 400) return;
  if (ESPERADAS.some(e => e.patron.test(r.url()) && e.estado === r.status())) return;
  fallos.push(`respuesta ${r.status()} en ${r.url()}`);
});

const paso = async (n, fn) => {
  try { const r = await fn(); console.log('  ✅', n, r ? `— ${r}` : ''); }
  catch (e) { console.log('  ❌', n, '\n     ', String(e).split('\n')[0]); throw e; }
};

console.log('\n── 1 · La puerta, sin sesión ──');

await paso('la RAÍZ no enseña la maqueta: manda a entrar', async () => {
  await pag.goto(`${APP}/`, { waitUntil: 'networkidle' });
  await pag.waitForURL('**/entrar', { timeout: 15000 });
  const texto = await pag.locator('body').innerText();
  if (/SD-48\d\d-PTY/.test(texto)) throw new Error('la raíz sigue enseñando envíos inventados');
  return pag.url().replace(APP, '');
});

await paso('el tablero tampoco se sirve sin sesión', async () => {
  await pag.goto(`${APP}/tablero`, { waitUntil: 'networkidle' });
  await pag.waitForURL('**/entrar', { timeout: 15000 });
  return 'redirigido a /entrar';
});

console.log('\n── 2 · Entrar ──');

await paso('entrar en el sistema', async () => {
  await pag.goto(`${APP}/entrar`, { waitUntil: 'networkidle' });
  await pag.getByLabel('Correo').fill(CORREO);
  await pag.getByLabel('Contraseña').fill(env.SEED_ADMIN_CLAVE);
  await pag.getByLabel('Código de verificación').fill(totp(SECRETO));
  await pag.getByRole('button', { name: 'Entrar' }).click();
  await pag.waitForURL('**/operacion/ordenes', { timeout: 15000 });
});

console.log('\n── 3 · Administración ──');

await paso('el menú tiene la sección, que antes no existía', async () => {
  const nav = pag.getByRole('navigation', { name: /Navegación principal/ });
  await nav.getByRole('button', { name: /^Usuarios/ }).waitFor({ timeout: 10000 });
  await nav.getByRole('button', { name: /Roles y permisos/ }).waitFor({ timeout: 10000 });
});

await paso('usuarios lista contra la API de verdad', async () => {
  await pag.getByRole('button', { name: /^Usuarios/ }).click();
  await pag.waitForURL('**/administracion/usuarios', { timeout: 15000 });
  const filas = pag.locator('tbody tr');
  await filas.first().waitFor({ timeout: 15000 });
  const n = await filas.count();
  if (n === 0) throw new Error('la tabla de usuarios llegó vacía');
  return `${n} usuario(s)`;
});

await paso('cada cuenta dice si tiene segundo factor', async () => {
  const texto = await pag.locator('tbody').innerText();
  if (!/Con MFA|Sin MFA/.test(texto)) throw new Error('la columna de MFA no se pintó');
  return /Sin MFA/.test(texto) ? 'hay alguna SIN MFA — §21' : 'todas con MFA';
});

await paso('el alta pide una clave y explica cuál vale', async () => {
  await pag.getByRole('button', { name: /Nuevo usuario/ }).click();
  await pag.getByLabel('Clave').waitFor({ timeout: 10000 });
  const ayuda = await pag.getByText(/12 caracteres/).innerText();
  await pag.getByRole('button', { name: /^Cancelar$/ }).click();
  return ayuda.slice(0, 48) + '…';
});

await paso('roles enseña el recuento que delató el incidente', async () => {
  await pag.getByRole('button', { name: /Roles y permisos/ }).click();
  await pag.waitForURL('**/administracion/roles', { timeout: 15000 });
  const tarjeta = pag.locator('button[aria-expanded]').filter({ hasText: 'permisos' }).first();
  await tarjeta.waitFor({ timeout: 15000 });
  const texto = await tarjeta.innerText();
  const m = texto.match(/(\d+) de (\d+) permisos/);
  if (!m) throw new Error(`ninguna tarjeta enseña el recuento: «${texto}»`);
  return `${m[0]} en «${texto.split('\n')[0]}»`;
});

await paso('abrir un rol enseña sus permisos agrupados por módulo', async () => {
  await pag.locator('button[aria-expanded]').filter({ hasText: 'permisos' }).first().click();
  const grupos = pag.locator('fieldset');
  await grupos.first().waitFor({ timeout: 10000 });
  const n = await grupos.count();
  const casillas = await pag.locator('input[type="checkbox"]').count();
  if (n === 0 || casillas === 0) throw new Error('el editor de permisos salió vacío');
  return `${n} módulo(s), ${casillas} permiso(s)`;
});

await paso('la auditoría traduce los JSON a «qué cambió»', async () => {
  await pag.getByRole('button', { name: /Auditoría/ }).click();
  await pag.waitForURL('**/administracion/auditoria', { timeout: 15000 });
  const filas = pag.locator('tbody tr');
  await filas.first().waitFor({ timeout: 15000 });
  const texto = await pag.locator('tbody').innerText();
  /* La flecha es la prueba de que el diff se calculó: un volcado de JSON no la
     tiene. Puede no haber ningún cambio con «anterior» en la base, así que no
     se exige — lo que sí se exige es que haya movimientos. */
  const n = await filas.count();
  return `${n} movimiento(s)${texto.includes('→') ? ', con cambios traducidos' : ''}`;
});

await paso('y no ofrece nada que escriba en ella', async () => {
  for (const b of await pag.locator('table button').all()) {
    const t = (await b.innerText()).toLowerCase();
    if (/borrar|eliminar|editar|anular/.test(t)) {
      throw new Error(`la auditoría ofrece «${t}», y es de sólo lectura`);
    }
  }
});

await paso('dispositivos lista y distingue el revocado del activo', async () => {
  await pag.getByRole('button', { name: /Dispositivos/ }).click();
  await pag.waitForURL('**/administracion/dispositivos', { timeout: 15000 });
  /* Puede no haber ninguno —sin app del conductor (2A) nadie registra un
     aparato—, y en ese caso la pantalla lo DICE en vez de quedarse en blanco.
     Las dos salidas son correctas; lo que no lo sería es una tabla vacía muda. */
  const tabla = pag.locator('tbody tr');
  const vacio = pag.getByText(/Ningún dispositivo/i);
  await Promise.race([
    tabla.first().waitFor({ timeout: 15000 }),
    vacio.waitFor({ timeout: 15000 }),
  ]);
  const n = await tabla.count();
  return n === 0 ? 'ninguno todavía, y lo dice' : `${n} dispositivo(s)`;
});

console.log('\n── 4 · Fase 1: lo que estaba sin pantalla ──');

await paso('el aviso de licencias llama al endpoint que nadie llamaba', async () => {
  const espera = pag.waitForResponse(r =>
    r.url().includes('/conductores/licencias-por-vencer'), { timeout: 15000 });
  await pag.getByRole('button', { name: /^Conductores/ }).click();
  await pag.waitForURL('**/catalogos/conductores', { timeout: 15000 });
  const respuesta = await espera;
  if (respuesta.status() !== 200) {
    throw new Error(`respondió ${respuesta.status()} — es el endpoint que daba 400 sin ?dias=`);
  }
  const resumen = pag.getByRole('status', { name: /licencias/i });
  await resumen.waitFor({ timeout: 10000 });
  return (await resumen.innerText()).slice(0, 70);
});

await paso('el horizonte de 90 días se consulta al servidor, no se filtra aquí', async () => {
  const espera = pag.waitForResponse(r =>
    r.url().includes('licencias-por-vencer') && r.url().includes('dias=90'), { timeout: 15000 });
  await pag.getByRole('button', { name: /90 días/ }).click();
  await espera;
});

await paso('la bitácora del viaje se ve, y dice si la cadena está íntegra', async () => {
  await pag.getByRole('button', { name: /Despacho y cierre/ }).click();
  await pag.waitForURL('**/operacion/despacho', { timeout: 15000 });
  const viaje = pag.locator('[aria-pressed]').first();
  await viaje.waitFor({ timeout: 15000 });
  await viaje.click();

  const integridad = pag.getByRole('status', { name: /integridad/i });
  await integridad.waitFor({ timeout: 15000 });
  const texto = await integridad.innerText();
  /* «No se pudo comprobar» también es un resultado honesto —permiso o API
     caída—; lo que NO puede pasar es que la sección no exista. */
  if (/ROTA/i.test(texto)) throw new Error(`cadena rota: ${texto}`);
  return texto.replace(/\s+/g, ' ').slice(0, 70);
});

await paso('y NO ofrece borrar un evento: anular añade una corrección', async () => {
  for (const b of await pag.locator('table button').all()) {
    const t = (await b.innerText()).toLowerCase();
    if (/borrar|eliminar/.test(t)) {
      throw new Error(`la bitácora ofrece «${t}», y el §7.15 no borra: corrige`);
    }
  }
});

console.log('\n── 5 · El boceto, ya con sesión ──');

await paso('el tablero se declara boceto en vez de aparentar datos reales', async () => {
  await pag.goto(`${APP}/tablero`, { waitUntil: 'networkidle' });
  const aviso = pag.getByRole('note', { name: /boceto/i });
  await aviso.waitFor({ timeout: 15000 });
  return (await aviso.innerText()).replace(/\s+/g, ' ').slice(0, 60) + '…';
});

console.log('\n── 6 · Salir ──');

await paso('cerrar sesión revoca el refresco en el SERVIDOR', async () => {
  /* Se vigila la petición, no el resultado visible: borrar `localStorage` y
     revocar en Redis se ven exactamente igual desde la pantalla, y durante
     meses sólo pasaba lo primero. */
  const espera = pag.waitForRequest(r =>
    r.url().includes('/auth/cerrar-sesion') && r.method() === 'POST', { timeout: 15000 });
  await pag.goto(`${APP}/operacion/ordenes`, { waitUntil: 'networkidle' });
  await pag.getByRole('button', { name: /Cerrar sesión/ }).click();
  await espera;
  await pag.waitForURL('**/entrar', { timeout: 15000 });
});

await pag.screenshot({ path: 'e2e/ultimo-recorrido-admin.png' });
await nav.close();

if (fallos.length) {
  console.log('\n❌ el navegador reportó errores:');
  for (const f of fallos) console.log('   ·', f);
  process.exit(1);
}
console.log('\n✅ recorrido de administración completo\n');
