/*
 * Recorrido de extremo a extremo por la INTERFAZ — criterio de salida de 1A.
 *
 * El §26 lo pide literalmente: «un operador da de alta una cisterna con sus
 * compartimentos, un conductor y un cliente DESDE LA UI, y la auditoría
 * registra las tres altas». Verificarlo con curl contra la API no cumple ese
 * criterio: prueba el servidor, no la pantalla.
 *
 * Requiere las librerías de sistema de Chromium:
 *     sudo npx playwright install-deps chromium
 * Sin privilegios, se pueden extraer los .deb a un directorio propio y
 * apuntar LD_LIBRARY_PATH ahí (ver e2e/README.md).
 *
 * Uso:  node e2e/recorrido.mjs
 */
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';

const env = Object.fromEntries(readFileSync('../.env','utf8').split('\n')
  .filter(l=>l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')).trim(), l.slice(l.indexOf('=')+1).trim()]));

function totp(secreto){
  const clave = Buffer.from(secreto.replace(/=+$/,'').split('').reduce((b,c)=>
    b + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c).toString(2).padStart(5,'0'),'')
    .match(/.{8}/g).map(b=>parseInt(b,2)));
  const cont = Buffer.alloc(8); cont.writeBigUInt64BE(BigInt(Math.floor(Date.now()/1000/30)));
  const h = crypto.createHmac('sha1', clave).update(cont).digest();
  const o = h[h.length-1] & 0x0f;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6,'0');
}

const nav = await chromium.launch();
const pag = await nav.newPage({ viewport:{width:1440,height:900} });
const fallos = [];
pag.on('pageerror', e => fallos.push('error de página: ' + e.message));
pag.on('console', m => { if (m.type()==='error') fallos.push('consola: ' + m.text()); });

const sello = Date.now().toString().slice(-6);
const paso = async (n, fn) => { try { await fn(); console.log('  ✅', n); } catch(e){ console.log('  ❌', n, '\n     ', String(e).split('\n')[0]); throw e; } };

console.log('\n── 1 · Entrar ──');
await paso('carga la pantalla de entrada', async () => {
  await pag.goto('http://localhost:3100/entrar', { waitUntil:'networkidle' });
});
await paso('rellenar y enviar el formulario', async () => {
  await pag.getByLabel('Correo').fill('admin@mupa.gob.pa');
  await pag.getByLabel('Contraseña').fill(env.SEED_ADMIN_CLAVE);
  await pag.getByLabel('Código de verificación').fill(totp('E45TSC3SDQSGOW2U'));
  await pag.getByRole('button', { name:'Entrar' }).click();
  await pag.waitForURL('**/operacion/ordenes', { timeout: 15000 });
});
console.log('     → llegó a', new URL(pag.url()).pathname);

console.log('\n── 2 · Alta de cliente ──');
await paso('crear cliente desde la UI', async () => {
  await pag.goto('http://localhost:3100/catalogos/clientes', { waitUntil:'networkidle' });
  await pag.getByRole('button', { name:/Nuevo cliente/ }).click();
  await pag.getByLabel('Nombre comercial').fill(`Cliente UI ${sello}`);
  await pag.getByLabel('RUC').fill(`RUC-UI-${sello}`);
  await pag.getByLabel('Persona de contacto').fill('Ana Gómez');
  await pag.getByRole('button', { name:/Crear cliente/ }).click();
  await pag.getByRole('cell', { name:`Cliente UI ${sello}`, exact:true }).waitFor({ timeout:10000 });
});

console.log('\n── 3 · Alta de conductor ──');
await paso('crear conductor desde la UI', async () => {
  await pag.goto('http://localhost:3100/catalogos/conductores', { waitUntil:'networkidle' });
  await pag.getByRole('button', { name:/Nuevo conductor/ }).click();
  await pag.getByLabel('Nombre completo').fill(`Chofer UI ${sello}`);
  await pag.getByLabel('Documento').fill(`DOC-UI-${sello}`);
  await pag.getByRole('textbox', { name:'Licencia', exact:true }).fill(`LIC-UI-${sello}`);
  await pag.getByRole('button', { name:/Crear conductor/ }).click();
  await pag.getByRole('cell', { name:`Chofer UI ${sello}`, exact:true }).waitFor({ timeout:10000 });
});

console.log('\n── 4 · Alta de vehículo ──');
await paso('crear vehículo tipo cisterna', async () => {
  await pag.goto('http://localhost:3100/catalogos/vehiculos', { waitUntil:'networkidle' });
  await pag.getByRole('button', { name:/Nuevo vehículo/ }).click();
  await pag.getByLabel('Tipo').selectOption('cisterna');
  await pag.getByLabel('Placa').fill(`UI-${sello}`);
  await pag.getByLabel('Marca').fill('Kenworth');
  await pag.getByRole('button', { name:/Crear vehículo/ }).click();
  await pag.getByRole('cell', { name:`UI-${sello}`, exact:true }).waitFor({ timeout:10000 });
});

console.log('\n── 5 · Alta de cisterna con compartimentos ──');
await paso('crear cisterna con 2 compartimentos', async () => {
  await pag.goto('http://localhost:3100/catalogos/cisternas', { waitUntil:'networkidle' });
  await pag.getByRole('button', { name:/Nueva cisterna/ }).click();
  // selectOption no acepta expresiones regulares: se busca la opción cuyo
  // texto contiene la placa y se selecciona por su valor.
  const opciones = await pag.getByLabel('Vehículo').locator('option').all();
  let valorVehiculo = null;
  for (const o of opciones) {
    if ((await o.textContent() ?? '').includes(`UI-${sello}`)) valorVehiculo = await o.getAttribute('value');
  }
  if (!valorVehiculo) throw new Error(`el vehículo UI-${sello} no aparece en el desplegable`);
  await pag.getByLabel('Vehículo').selectOption(valorVehiculo);
  await pag.getByLabel('Capacidad total').fill('9000');
  await pag.getByRole('spinbutton', { name:'N.º', exact:true }).first().fill('1');
  await pag.getByRole('spinbutton', { name:'Nominal', exact:true }).first().fill('4500');
  await pag.getByRole('spinbutton', { name:'Calibrada', exact:true }).first().fill('4480');
  await pag.getByRole('button', { name:/Añadir compartimento/ }).click();
  await pag.getByRole('spinbutton', { name:'N.º', exact:true }).nth(1).fill('2');
  await pag.getByRole('spinbutton', { name:'Nominal', exact:true }).nth(1).fill('4500');
  await pag.getByRole('spinbutton', { name:'Calibrada', exact:true }).nth(1).fill('4475');
  await pag.getByRole('button', { name:/Crear cisterna/ }).click();
  await pag.getByRole('cell', { name:`UI-${sello}`, exact:true }).waitFor({ timeout:10000 });
});

await pag.screenshot({ path:'e2e/ultimo-recorrido.png', fullPage:true });
console.log('\nsello usado:', sello);
console.log('errores de consola o de página:', fallos.length ? fallos : 'ninguno');
await nav.close();

// Salida distinta de cero si el navegador reportó algo: un recorrido que
// «pasa» mientras la consola escupe errores no está pasando.
if (fallos.length) process.exit(1);
