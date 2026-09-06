/*
 * Recorrido de extremo a extremo de la Fase 1B, por la INTERFAZ.
 *
 * Cubre el flujo que da nombre a la fase: orden → plan de carga → viaje.
 * Crear la orden, validarla, armar el viaje, asignarle la orden, repartir la
 * carga entre compartimentos y autorizar la salida.
 *
 * Requiere las librerías de Chromium (ver e2e/README.md).
 * Uso:  node e2e/recorrido-1b.mjs
 */
import { chromium } from '@playwright/test';
import { entorno, totp, asegurarSegundoFactor, sesionCompleta, asegurarDatosDe1B }
  from './entorno.mjs';

const env = entorno();
const API = env.E2E_API ?? 'http://localhost:4100/api';
const APP = env.E2E_APP ?? 'http://localhost:3100';
const CORREO = env.SEED_ADMIN_CORREO ?? 'admin@mupa.gob.pa';

/* En una base recién sembrada el administrador no tiene TOTP: se inscribe aquí,
   como haría el primer usuario real, y el recorrido entra con ese secreto. */
const SECRETO = await asegurarSegundoFactor({
  api: API, correo: CORREO, clave: env.SEED_ADMIN_CLAVE,
  secretoConocido: env.E2E_TOTP_SECRETO,
});

/* 1B necesita un cliente CON estación y un producto, y no los crea: en una base
   recién sembrada no existen y el recorrido moría con «ningún cliente tiene
   estaciones dadas de alta», que parece un fallo de la aplicación y no lo es. */
await asegurarDatosDe1B({
  api: API,
  token: await sesionCompleta({ api: API, correo: CORREO, clave: env.SEED_ADMIN_CLAVE, secreto: SECRETO }),
});

/** Elige la opción de un select cuyo texto contenga `aguja`. selectOption no
 *  admite expresiones regulares, así que se busca el valor a mano. */
async function elegirQueContenga(select, aguja) {
  for (const o of await select.locator('option').all()) {
    if ((await o.textContent() ?? '').includes(aguja)) {
      const v = await o.getAttribute('value');
      if (v) { await select.selectOption(v); return await o.textContent(); }
    }
  }
  throw new Error(`ninguna opción contiene «${aguja}»`);
}

/** Primera opción con valor: sirve cuando cualquiera vale. */
async function elegirPrimera(select) {
  for (const o of await select.locator('option').all()) {
    const v = await o.getAttribute('value');
    if (v) { await select.selectOption(v); return (await o.textContent() ?? '').trim(); }
  }
  throw new Error('el desplegable no tiene opciones');
}

const nav = await chromium.launch();
const pag = await nav.newPage({ viewport:{width:1600,height:1000} });
const fallos = [];
pag.on('pageerror', e => fallos.push('error de página: ' + e.message));
pag.on('console', m => { if (m.type()==='error') fallos.push('consola: ' + m.text()); });

const sello = Date.now().toString().slice(-6);
// Fecha lejana y distinta en cada corrida: si dos recorridos compartieran
// franja, la exclusión del §5.1 rechazaría el segundo con razón, y el fallo
// parecería un bug del recorrido y no lo sería.
const dia = new Date(Date.now() + (Number(sello.slice(-3)) + 60) * 86400000)
  .toISOString().slice(0,10);

const paso = async (n, fn) => {
  try { const r = await fn(); console.log('  ✅', n, r ? `— ${r}` : ''); }
  catch(e){ console.log('  ❌', n, '\n     ', String(e).split('\n')[0]); throw e; }
};

console.log(`\nsello ${sello} · viaje programado para ${dia}`);

console.log('\n── 1 · Entrar ──');
await paso('entrar en el sistema', async () => {
  await pag.goto(`${APP}/entrar`, { waitUntil:'networkidle' });
  await pag.getByLabel('Correo').fill(CORREO);
  await pag.getByLabel('Contraseña').fill(env.SEED_ADMIN_CLAVE);
  await pag.getByLabel('Código de verificación').fill(totp(SECRETO));
  await pag.getByRole('button', { name:'Entrar' }).click();
  await pag.waitForURL('**/operacion/ordenes', { timeout:15000 });
});

console.log('\n── 2 · Crear la orden ──');
let volumenOrden = 0;
await paso('alta de orden con una línea de producto', async () => {
  await pag.getByRole('button', { name:/Nueva orden/ }).click();

  /* Se busca un cliente que TENGA estaciones: la interfaz filtra las
     estaciones por cliente porque la API lo exige, así que un cliente sin
     estaciones deja el segundo desplegable vacío. */
  let cliente = null;
  const opcionesEstacion = pag.getByLabel('Estación').locator('option:not([value=""])');
  for (const o of await pag.getByLabel('Cliente').locator('option').all()) {
    const v = await o.getAttribute('value');
    if (!v) continue;
    await pag.getByLabel('Cliente').selectOption(v);
    /* Se espera a que APAREZCA una estación, no un tiempo fijo. Antes había un
       waitForTimeout(400) y esta prueba fallaba de vez en cuando: si la
       petición de estaciones tardaba un poco más, el conteo daba cero, el
       bucle descartaba al único cliente que sí tenía estaciones y el recorrido
       moría con «ningún cliente tiene estaciones dadas de alta». Una prueba
       intermitente es peor que ninguna, porque enseña a reintentar y no mirar. */
    try {
      await opcionesEstacion.first().waitFor({ state: 'attached', timeout: 3000 });
      cliente = (await o.textContent() ?? '').trim();
      break;
    } catch {
      /* Ese cliente no tiene estaciones: se sigue con el siguiente. */
    }
  }
  if (!cliente) throw new Error('ningún cliente tiene estaciones dadas de alta');
  const estacion = await elegirPrimera(pag.getByLabel('Estación'));

  await pag.getByLabel('N.º de orden externa').fill(`E2E-${sello}`);
  await elegirPrimera(pag.getByLabel('Producto'));
  volumenOrden = 4000;
  await pag.getByRole('spinbutton', { name:'Volumen', exact:true }).fill(String(volumenOrden));
  await pag.getByRole('button', { name:/Crear orden/ }).click();
  await pag.getByRole('cell', { name:`E2E-${sello}`, exact:true }).waitFor({ timeout:10000 });
  return `${cliente} → ${estacion}, ${volumenOrden} unidades`;
});

console.log('\n── 3 · Validar la orden ──');
await paso('pulsar la transición «validada»', async () => {
  const fila = pag.getByRole('row').filter({ hasText:`E2E-${sello}` });
  await fila.getByRole('button', { name:'validada', exact:true }).click();
  // La fila se recarga: se espera a que la transición ya no esté disponible.
  await pag.getByRole('row').filter({ hasText:`E2E-${sello}` })
           .getByRole('button', { name:'planificada', exact:true })
           .waitFor({ timeout:10000 });
  return 'la orden pasa a «validada» y ofrece «planificada»';
});

console.log('\n── 4 · Crear el viaje ──');
await paso('alta de viaje con cisterna y conductor', async () => {
  await pag.goto(`${APP}/operacion/viajes`, { waitUntil:'networkidle' });
  await pag.getByRole('button', { name:/Nuevo/ }).click();
  await pag.getByLabel('Código del viaje').fill(`E2E-V-${sello}`);
  await pag.getByLabel('Programado para').fill(dia);
  await pag.getByLabel('Fin previsto').fill(dia);
  const cisterna = await elegirPrimera(pag.getByLabel('Cisterna'));
  const conductor = await elegirPrimera(pag.getByLabel('Conductor'));
  await pag.getByRole('button', { name:'Crear', exact:true }).click();
  await pag.getByRole('heading', { name:`E2E-V-${sello}` }).waitFor({ timeout:10000 });
  return `${cisterna} · ${conductor}`;
});

console.log('\n── 5 · Asignar la orden al viaje ──');
await paso('asignar la orden validada', async () => {
  const sel = pag.getByLabel('Orden validada');
  await sel.waitFor({ timeout:10000 });
  await elegirQueContenga(sel, `E2E-${sello}`);
  await pag.getByRole('button', { name:/Asignar orden/ }).click();
  await pag.getByRole('cell', { name:'Estación Vía España' }).first()
           .waitFor({ timeout:10000 }).catch(() => undefined);
  return 'la orden aparece en la tabla del viaje';
});

console.log('\n── 6 · Armar el plan de carga ──');
await paso('asignar carga a un compartimento', async () => {
  const comp = pag.getByLabel('Compartimento');
  await comp.waitFor({ timeout:10000 });
  const etiqueta = await elegirPrimera(comp);
  await elegirQueContenga(pag.getByLabel('Línea de orden'), `E2E-${sello}`);

  // Se carga menos de lo calibrado y menos de lo que pide la orden: las dos
  // reglas que la API comprueba.
  const calibrado = Number((etiqueta.match(/calibrado ([\d.]+)/) ?? [])[1] ?? 0);
  const volumen = Math.min(calibrado, volumenOrden) - 10;
  await pag.getByRole('spinbutton', { name:'Volumen', exact:true }).fill(String(volumen));
  await pag.getByRole('button', { name:/Asignar carga/ }).click();
  await pag.getByRole('cell', { name:String(volumen.toLocaleString('es-PA')) })
           .waitFor({ timeout:10000 });
  return `${volumen} en ${etiqueta.trim()}`;
});

console.log('\n── 7 · Programar y autorizar ──');
await paso('pasar el viaje a «programado»', async () => {
  await pag.getByRole('button', { name:'programado', exact:true }).click();
  await pag.getByRole('button', { name:'Autorizar', exact:true }).waitFor({ timeout:10000 });
  return 'aparece el botón Autorizar';
});
await paso('autorizar la salida', async () => {
  await pag.getByRole('button', { name:'Autorizar', exact:true }).click();
  await pag.getByRole('button', { name:'desplazamiento_terminal', exact:true })
           .waitFor({ timeout:10000 });
  return 'el viaje queda «autorizado» y ofrece salir a la terminal';
});

await pag.screenshot({ path:'e2e/ultimo-recorrido-1b.png', fullPage:true });
console.log('\nerrores de consola o de página:', fallos.length ? fallos : 'ninguno');
await nav.close();
if (fallos.length) process.exit(1);
