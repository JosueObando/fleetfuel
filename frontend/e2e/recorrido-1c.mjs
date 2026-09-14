/*
 * Recorrido de extremo a extremo de la Fase 1C, por la INTERFAZ.
 *
 * El criterio de salida de 1C, literal: «un viaje real recorre orden → carga →
 * entrega → liquidación y cuadra contra la conciliación de volúmenes».
 *
 * El §26 cierra una fase verificándola DESDE LA INTERFAZ y no por API — así se
 * cerró 1A—, y hasta el 2026-09-12 esto no se podía hacer: 1C existía sólo en
 * el backend, sin ni una pantalla. Con `/operacion/despacho` ya se puede.
 *
 * Es autosuficiente: crea su propia orden, su viaje y su plan de carga, porque
 * en CI la base nace vacía. Empalma con lo que hace `recorrido-1b.mjs` y sigue
 * desde donde aquél lo deja.
 *
 * Requiere las librerías de Chromium (ver e2e/README.md).
 * Uso:  node e2e/recorrido-1c.mjs
 */
import { chromium } from '@playwright/test';
import { entorno, totp, asegurarSegundoFactor, sesionCompleta, asegurarDatosDe1B }
  from './entorno.mjs';

const env = entorno();
const API = env.E2E_API ?? 'http://localhost:4100/api';
const APP = env.E2E_APP ?? 'http://localhost:3100';
const CORREO = env.SEED_ADMIN_CORREO ?? 'admin@fleetfuel.jop.lat';

const SECRETO = await asegurarSegundoFactor({
  api: API, correo: CORREO, clave: env.SEED_ADMIN_CLAVE,
  secretoConocido: env.E2E_TOTP_SECRETO,
});
await asegurarDatosDe1B({
  api: API,
  token: await sesionCompleta({ api: API, correo: CORREO, clave: env.SEED_ADMIN_CLAVE, secreto: SECRETO }),
});

async function elegirPrimera(select) {
  for (const o of await select.locator('option').all()) {
    const v = await o.getAttribute('value');
    if (v) { await select.selectOption(v); return (await o.textContent() ?? '').trim(); }
  }
  throw new Error('el desplegable no tiene opciones');
}

/*
 * Elige la opción cuyo texto contenga `aguja`, ESPERANDO a que aparezca.
 *
 * Mirar una sola vez no vale: los desplegables de esta pantalla se llenan con
 * peticiones que salen después de pintar el `select`, así que el elemento ya
 * está en el DOM y sus opciones todavía no. Sin la espera el recorrido falla
 * de vez en cuando —y sólo en las máquinas rápidas, que llegan antes—, que es
 * la clase de prueba intermitente que enseña a reintentar en vez de mirar.
 */
async function elegirQueContenga(select, aguja, ms = 15000) {
  const limite = Date.now() + ms;
  for (;;) {
    for (const o of await select.locator('option').all()) {
      if ((await o.textContent() ?? '').includes(aguja)) {
        const v = await o.getAttribute('value');
        if (v) { await select.selectOption(v); return await o.textContent(); }
      }
    }
    if (Date.now() > limite) throw new Error(`ninguna opción contiene «${aguja}»`);
    await new Promise(r => setTimeout(r, 250));
  }
}

const nav = await chromium.launch();
const pag = await nav.newPage({ viewport: { width: 1600, height: 1000 } });
const fallos = [];
pag.on('pageerror', e => fallos.push('error de página: ' + e.message));

/*
 * ESTE RECORRIDO VIGILA LAS RESPUESTAS, NO EL TEXTO DE LA CONSOLA.
 *
 * Los otros dos tratan cualquier error de consola como un fallo, y les basta
 * porque nunca provocan un 4xx. Aquí sí, y a propósito:
 *
 *   · `GET /liquidaciones/viaje/:id` responde **404 mientras el viaje no está
 *     liquidado**, que es el caso normal durante casi todo el recorrido. La
 *     pantalla lo trata como «todavía no hay liquidación» y no como un error.
 *   · El **409** al aprobar el propio gasto es la separación del §7 funcionando:
 *     es lo que el paso 7 comprueba.
 *
 * El navegador escribe «Failed to load resource» en la consola por cada uno,
 * sin decir de qué petición habla. Filtrar por ese texto sería filtrar a ciegas
 * —taparía también un 500 de verdad—, así que se ignora esa línea y se vigilan
 * las RESPUESTAS con una lista de lo que se espera. Todo lo demás sigue siendo
 * fatal, incluido cualquier 5xx.
 */
const ESPERADAS = [
  { patron: /\/api\/liquidaciones\/viaje\//, estado: 404 },
  { patron: /\/api\/gastos\//,                estado: 409 },
];
pag.on('console', m => {
  if (m.type() !== 'error') return;
  if (/Failed to load resource/.test(m.text())) return;
  fallos.push('consola: ' + m.text());
});
pag.on('response', r => {
  if (r.status() < 400) return;
  const esperada = ESPERADAS.some(e => e.patron.test(r.url()) && e.estado === r.status());
  if (!esperada) fallos.push(`respuesta ${r.status()} en ${r.url()}`);
});

const sello = Date.now().toString().slice(-6);
/*
 * Mañana, y no dentro de un año.
 *
 * `viajes.periodo` es `tstzrange(coalesce(fecha_inicio, fecha_programada),
 * fecha_fin)` y pasar a `desplazamiento_terminal` estampa `fecha_inicio =
 * now()`: un viaje programado para dentro de un año que arranca HOY pasa a
 * ocupar los doce meses de en medio. Con una fecha cercana el periodo es el que
 * el viaje de verdad ocupa.
 *
 * (Esa es la mitad del arreglo. La otra es que este recorrido estrena su propia
 * cisterna y su propio conductor, más abajo: reutilizar los sembrados hacía que
 * la segunda corrida chocara con la primera, y con razón.)
 */
const dia = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

const NUMERO_SELLO = `S1C-${sello}`;

/*
 * El aviso de la aplicación, distinguido del anunciador de rutas de Next.
 *
 * Next monta un `<div role="alert" id="__next-route-announcer__">` VACÍO en
 * cada página para anunciar los cambios de ruta a los lectores de pantalla. Es
 * correcto que exista y que tenga ese rol, así que `getByRole('alert')` a secas
 * encuentra siempre dos. Se filtra por «que tenga texto», que es exactamente lo
 * que distingue un aviso de verdad del hueco que espera uno.
 */
const avisoDePantalla = () => pag.getByRole('alert').filter({ hasText: /\S/ }).first();

const paso = async (n, fn) => {
  try { const r = await fn(); console.log('  ✅', n, r ? `— ${r}` : ''); }
  catch (e) { console.log('  ❌', n, '\n     ', String(e).split('\n')[0]); throw e; }
};

/**
 * Pulsa una transición del §8.2 en la propia pantalla de despacho.
 *
 * Se espera a que el botón DESAPAREZCA, y no a que aparezca el texto del estado
 * nuevo. Parece lo mismo y no lo es: el botón de la transición se llama igual
 * que el estado al que lleva, así que esperar «ese texto» se cumplía al
 * instante contra el botón que todavía no se había pulsado, y el recorrido
 * seguía antes de que la pantalla se hubiera recargado.
 *
 * Que desaparezca es la señal correcta porque `FLUJO_VIAJE` no tiene ninguna
 * transición de un estado a sí mismo: una vez en X, X ya no se ofrece.
 */
async function avanzar(estado) {
  const boton = pag.getByRole('button', { name: estado, exact: true });
  await boton.click();
  try {
    await boton.waitFor({ state: 'detached', timeout: 20000 });
  } catch {
    // El error de la espera no aporta nada: lo que hay que contar es lo que
    // la pantalla dice, y para eso está el aviso.
    const aviso = await avisoDePantalla().textContent().catch(() => null);
    throw new Error(`no se pudo pasar a «${estado}»${aviso ? ` — la pantalla dice: ${aviso}` : ' (sin aviso en pantalla)'}`);
  }
}

console.log(`\nsello ${sello} · viaje programado para ${dia} · precinto ${NUMERO_SELLO}`);

console.log('\n── 1 · Entrar ──');
await paso('entrar en el sistema', async () => {
  await pag.goto(`${APP}/entrar`, { waitUntil: 'networkidle' });
  await pag.getByLabel('Correo').fill(CORREO);
  await pag.getByLabel('Contraseña').fill(env.SEED_ADMIN_CLAVE);
  await pag.getByLabel('Código de verificación').fill(totp(SECRETO));
  await pag.getByRole('button', { name: 'Entrar' }).click();
  await pag.waitForURL('**/operacion/ordenes', { timeout: 15000 });
});

console.log('\n── 2 · La flota de este recorrido ──');
const PLACA = `P1C-${sello}`;
const CHOFER = `Chofer 1C ${sello}`;

await paso('dar de alta el vehículo, el conductor y la cisterna', async () => {
  await pag.goto(`${APP}/catalogos/vehiculos`, { waitUntil: 'networkidle' });
  await pag.getByRole('button', { name: 'Nuevo vehículo' }).click();
  await pag.getByLabel('Tipo').selectOption('cisterna');
  await pag.getByLabel('Placa').fill(PLACA);
  await pag.getByRole('button', { name: 'Crear vehículo' }).click();
  await pag.getByRole('cell', { name: PLACA, exact: true }).waitFor({ timeout: 15000 });

  await pag.goto(`${APP}/catalogos/conductores`, { waitUntil: 'networkidle' });
  await pag.getByRole('button', { name: 'Nuevo conductor' }).click();
  await pag.getByLabel('Nombre completo').fill(CHOFER);
  await pag.getByLabel('Documento').fill(`D1C-${sello}`);
  /* Por ROL y no por etiqueta: «Vence la licencia» también contiene
     «Licencia», y `getByLabel` exacto tampoco sirve porque el texto de la
     etiqueta lleva el asterisco de obligatorio. El nombre ACCESIBLE sí es
     limpio: el asterisco es `aria-hidden`, que es justo para lo que está. */
  await pag.getByRole('textbox', { name: 'Licencia', exact: true }).fill(`L1C-${sello}`);
  // Regla 13: con la licencia caducada el viaje no se autoriza, y el recorrido
  // moriría en el paso siguiente sin decir por qué.
  await pag.getByLabel('Vence la licencia').fill('2035-12-31');
  await pag.getByRole('button', { name: 'Crear conductor' }).click();
  await pag.getByRole('cell', { name: CHOFER, exact: true }).waitFor({ timeout: 15000 });

  await pag.goto(`${APP}/catalogos/cisternas`, { waitUntil: 'networkidle' });
  await pag.getByRole('button', { name: 'Nueva cisterna' }).click();
  await elegirQueContenga(pag.getByLabel('Vehículo'), PLACA);
  await pag.getByLabel('Capacidad total').fill('10000');
  await pag.getByLabel('Nominal').fill('5000');
  await pag.getByLabel('Calibrada').fill('4980');
  await pag.getByRole('button', { name: 'Crear cisterna' }).click();
  await pag.getByRole('cell', { name: PLACA, exact: true }).waitFor({ timeout: 15000 });

  return `${PLACA} · ${CHOFER}`;
});

console.log('\n── 3 · La orden y el viaje (lo que 1B ya sabía hacer) ──');
let volumenPlan = 0;
await paso('crear la orden y validarla', async () => {
  // El paso anterior dejó el navegador en catálogos.
  await pag.goto(`${APP}/operacion/ordenes`, { waitUntil: 'networkidle' });
  await pag.getByRole('button', { name: /Nueva orden/ }).click();

  let cliente = null;
  /* Se espera a que el desplegable TENGA clientes antes de recorrerlo. Sin esto
     el bucle encuentra la lista vacía —la petición todavía va en camino—, no
     entra ni una vez y el recorrido acusa de «ningún cliente tiene estaciones»
     a una base que sí las tiene. */
  await pag.getByLabel('Cliente').locator('option:not([value=""])').first()
           .waitFor({ state: 'attached', timeout: 15000 });
  const opcionesEstacion = pag.getByLabel('Estación').locator('option:not([value=""])');
  for (const o of await pag.getByLabel('Cliente').locator('option').all()) {
    const v = await o.getAttribute('value');
    if (!v) continue;
    await pag.getByLabel('Cliente').selectOption(v);
    try {
      await opcionesEstacion.first().waitFor({ state: 'attached', timeout: 3000 });
      cliente = (await o.textContent() ?? '').trim();
      break;
    } catch { /* ese cliente no tiene estaciones */ }
  }
  if (!cliente) throw new Error('ningún cliente tiene estaciones dadas de alta');
  await elegirPrimera(pag.getByLabel('Estación'));

  await pag.getByLabel('N.º de orden externa').fill(`E2E1C-${sello}`);
  await elegirPrimera(pag.getByLabel('Producto'));
  await pag.getByRole('spinbutton', { name: 'Volumen', exact: true }).fill('4000');
  await pag.getByRole('button', { name: /Crear orden/ }).click();
  await pag.getByRole('cell', { name: `E2E1C-${sello}`, exact: true }).waitFor({ timeout: 10000 });

  const fila = pag.getByRole('row').filter({ hasText: `E2E1C-${sello}` });
  await fila.getByRole('button', { name: 'validada', exact: true }).click();
  await pag.getByRole('row').filter({ hasText: `E2E1C-${sello}` })
           .getByRole('button', { name: 'planificada', exact: true }).waitFor({ timeout: 10000 });
  return `${cliente}, 4000 unidades`;
});

await paso('armar el viaje con su plan de carga y autorizarlo', async () => {
  await pag.goto(`${APP}/operacion/viajes`, { waitUntil: 'networkidle' });
  await pag.getByRole('button', { name: /Nuevo/ }).click();
  await pag.getByLabel('Código del viaje').fill(`E2E-1C-${sello}`);
  await pag.getByLabel('Programado para').fill(dia);
  await pag.getByLabel('Fin previsto').fill(dia);
  await elegirQueContenga(pag.getByLabel('Cisterna'), PLACA);
  await elegirQueContenga(pag.getByLabel('Conductor'), CHOFER);
  await pag.getByRole('button', { name: 'Crear', exact: true }).click();
  await pag.getByRole('heading', { name: `E2E-1C-${sello}` }).waitFor({ timeout: 10000 });

  const selOrden = pag.getByLabel('Orden por asignar');
  await selOrden.waitFor({ timeout: 10000 });
  await elegirQueContenga(selOrden, `E2E1C-${sello}`);
  await pag.getByRole('button', { name: /Asignar orden/ }).click();

  const comp = pag.getByLabel('Compartimento');
  await comp.waitFor({ timeout: 10000 });
  const etiqueta = await elegirPrimera(comp);
  await elegirQueContenga(pag.getByLabel('Línea de orden'), `E2E1C-${sello}`);
  const calibrado = Number((etiqueta.match(/calibrado ([\d.]+)/) ?? [])[1] ?? 0);
  volumenPlan = Math.min(calibrado, 4000) - 10;
  await pag.getByRole('spinbutton', { name: 'Volumen', exact: true }).fill(String(volumenPlan));
  await pag.getByRole('button', { name: /Asignar carga/ }).click();
  await pag.getByRole('cell', { name: volumenPlan.toLocaleString('es-PA') }).waitFor({ timeout: 10000 });

  await pag.getByRole('button', { name: 'programado', exact: true }).click();
  await pag.getByRole('button', { name: 'Autorizar', exact: true }).click();
  await pag.getByRole('button', { name: 'desplazamiento_terminal', exact: true })
           .waitFor({ timeout: 10000 });
  return `${volumenPlan} planificados, viaje autorizado`;
});

console.log('\n── 4 · Despacho: llevar el camión hasta la terminal ──');
await paso('abrir el viaje en despacho y llegar a «cargando»', async () => {
  await pag.goto(`${APP}/operacion/despacho`, { waitUntil: 'networkidle' });
  await pag.getByText(`E2E-1C-${sello}`).first().click();
  await pag.getByRole('heading', { name: `E2E-1C-${sello}` }).waitFor({ timeout: 15000 });
  for (const e of ['desplazamiento_terminal', 'espera_carga', 'cargando']) await avanzar(e);
  return 'el viaje está en la terminal';
});

console.log('\n── 5 · La carga en terminal (§7.13) ──');
let volumenCargado = 0;
await paso('registrar el volumen y el precinto', async () => {
  await pag.getByLabel('Compartimento del plan').waitFor({ timeout: 15000 });
  await elegirPrimera(pag.getByLabel('Compartimento del plan'));

  // Se echan 10 menos de lo planificado: los medidores de una terminal no dan
  // redondo, y que la merma se mida contra ESTO —y no contra el plan— es lo
  // que este recorrido existe para comprobar.
  volumenCargado = volumenPlan - 10;
  await pag.getByLabel('Volumen cargado').fill(String(volumenCargado));
  await pag.getByLabel('Número de sello').fill(NUMERO_SELLO);
  await pag.getByLabel('Operador de la terminal').fill('Operador E2E');
  await pag.getByLabel('Latitud').fill('9.3547');
  await pag.getByLabel('Longitud').fill('-79.9003');
  await pag.getByRole('button', { name: 'Registrar carga', exact: true }).click();

  // `exact` porque la celda de acciones también nombra el sello: sus botones
  // se llaman «Validar la carga del sello S1C-…» para que un lector de
  // pantalla los distinga en una tabla de varias filas.
  await pag.getByRole('cell', { name: NUMERO_SELLO, exact: true }).waitFor({ timeout: 15000 });
  return `${volumenCargado} con el precinto ${NUMERO_SELLO}`;
});

await paso('validar la carga (acto aparte, permiso aparte)', async () => {
  await pag.getByRole('button', { name: /^Validar/ }).first().click();
  await pag.getByRole('cell', { name: 'validada', exact: true }).waitFor({ timeout: 15000 });
  return 'la carga queda validada';
});

console.log('\n── 6 · A la estación, y la entrega (§7.14 + regla 18) ──');
await paso('llevar el viaje hasta «descargando»', async () => {
  for (const e of ['cargado', 'transito_estacion', 'descargando']) await avanzar(e);
  return 'el camión está descargando';
});

await paso('la pantalla enseña contra qué precinto hay que comparar', async () => {
  const aviso = pag.getByText(/Salió de la terminal con/);
  await aviso.waitFor({ timeout: 15000 });
  const texto = await aviso.textContent();
  if (!texto.includes(NUMERO_SELLO)) {
    throw new Error(`el aviso no nombra el precinto de la carga: «${texto}»`);
  }
  return texto.trim();
});

await paso('registrar la entrega con el precinto correcto', async () => {
  // Se recibe EXACTAMENTE lo cargado: merma cero, así que la entrega entra
  // aceptada sin depender de la tolerancia que tenga el producto sembrado.
  await pag.getByLabel('Volumen recibido').fill(String(volumenCargado));
  await pag.getByLabel('Sello leído en la estación').fill(NUMERO_SELLO);
  await pag.getByLabel('Quién recibe').fill('Encargada E2E');
  await pag.getByLabel('Latitud').fill('8.9824');
  await pag.getByLabel('Longitud').fill('-79.5199');
  await pag.getByRole('button', { name: 'Registrar entrega', exact: true }).click();

  // «intacto» lo escribe el SERVIDOR tras comparar, no la pantalla: aquí es
  // donde se comprueba que la regla 18 funciona de punta a punta.
  await pag.getByRole('cell', { name: 'intacto', exact: true }).waitFor({ timeout: 15000 });
  await pag.getByRole('cell', { name: 'aceptada', exact: true }).waitFor({ timeout: 15000 });
  return 'el sistema la da por intacta y la acepta: 0 de merma';
});

console.log('\n── 7 · Un gasto del camino (§7.17) ──');
await paso('registrar un peaje reembolsable', async () => {
  await pag.getByLabel('Categoría').selectOption('peaje');
  await pag.getByLabel('Descripción del gasto').fill(`Peajes del recorrido ${sello}`);
  await pag.getByLabel('Monto').fill('18.75');
  await pag.getByRole('button', { name: 'Registrar gasto', exact: true }).click();
  await pag.getByRole('cell', { name: `Peajes del recorrido ${sello}` }).waitFor({ timeout: 15000 });
  return '18.75 pendientes de aprobación';
});

await paso('y NO poder aprobarlo uno mismo: la separación se ve en pantalla', async () => {
  // §7: quien registra un gasto no lo aprueba. Este recorrido entra con un solo
  // usuario, así que el 409 es la respuesta CORRECTA — y lo que se comprueba
  // aquí es que llegue a la pantalla en vez de morir en la consola.
  await pag.getByLabel(/^Motivo para el gasto/).fill('Intento de aprobación por quien lo registró');
  await pag.getByRole('button', { name: 'Aprobar gasto', exact: true }).click();
  const aviso = avisoDePantalla();
  await aviso.waitFor({ timeout: 15000 });
  const texto = (await aviso.textContent() ?? '').trim();
  if (!/gasto/i.test(texto)) throw new Error(`el aviso no habla del gasto: «${texto}»`);
  return texto;
});

console.log('\n── 8 · Cerrar y liquidar (§7.18 y §15.5) ──');
await paso('cerrar el viaje', async () => {
  for (const e of ['retornando', 'pendiente_liquidacion', 'cerrado']) await avanzar(e);
  return 'viaje cerrado';
});

await paso('calcular la liquidación y ver el panel del §15.5', async () => {
  await pag.getByRole('button', { name: 'Calcular liquidación', exact: true })
           .click({ timeout: 15000 });
  const panel = pag.locator('section[aria-label="Liquidación del viaje"]');
  await panel.getByRole('button', { name: 'Aprobar liquidación', exact: true })
             .waitFor({ timeout: 15000 });

  for (const bloque of ['Kilómetros', 'Volúmenes', 'Mermas', 'Pago al conductor', 'Aprobaciones']) {
    await panel.getByText(bloque, { exact: true }).waitFor({ timeout: 5000 });
  }
  return 'la liquidación existe y el panel muestra sus bloques';
});

await paso('la conciliación cuadra: lo entregado es lo que salió', async () => {
  const panel = pag.locator('section[aria-label="Liquidación del viaje"]');
  const esperado = `${volumenCargado.toLocaleString('es-PA')} de ${volumenCargado.toLocaleString('es-PA')}`;
  const texto = await panel.textContent();
  if (!texto.includes(esperado)) {
    throw new Error(`el bloque de volúmenes no dice «${esperado}»`);
  }
  return esperado;
});

console.log('\n── 9 · Los informes del §14 leen lo que acaba de pasar ──');
await paso('el informe de volumen refleja la entrega recién registrada', async () => {
  // Cierra el círculo: el §14.2 se calcula sobre `detalles_orden`, que las
  // entregas mueven. Si el informe no viera este viaje, la cadena estaría rota
  // en algún eslabón intermedio y ninguna prueba de módulo lo notaría.
  await pag.goto(`${APP}/operacion/informes?informe=volumen`, { waitUntil: 'networkidle' });
  const entregado = pag.getByText('Entregado').locator('..');
  await entregado.waitFor({ timeout: 15000 });
  const texto = (await entregado.textContent() ?? '');
  if (/^\D*0\D*$/.test(texto)) throw new Error(`el informe no ve nada entregado: «${texto}»`);
  return texto.replace(/\s+/g, ' ').trim();
});

await paso('el operativo responde y enseña sus indicadores', async () => {
  await pag.goto(`${APP}/operacion/informes`, { waitUntil: 'networkidle' });
  await pag.getByText('Viajes programados').waitFor({ timeout: 15000 });
  await pag.getByText('Viajes retrasados').waitFor({ timeout: 5000 });
  return 'la foto del día se pinta';
});

await pag.screenshot({ path: 'e2e/ultimo-recorrido-1c.png', fullPage: true });
console.log('\nerrores de consola o de página:', fallos.length ? fallos : 'ninguno');
await nav.close();
if (fallos.length) process.exit(1);
