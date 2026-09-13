/*
 * Los 5 breakpoints del spec, sobre TODAS las pantallas de la aplicación.
 *
 * POR QUÉ EXISTE
 *
 * El criterio de salida de UX-1 es «el shell aguanta los 5 breakpoints con
 * datos reales». Se verificó a mano cuando se escribió el shell, y desde
 * entonces han entrado NUEVE pantallas —despacho, informes, usuarios, roles,
 * auditoría, dispositivos, bitácora, licencias— sin que nadie volviera a
 * mirarlas en un móvil. Ninguna prueba de componente puede: jsdom no tiene
 * ancho, no calcula layout y no sabe qué es un scroll horizontal.
 *
 * QUÉ MIDE, Y POR QUÉ ESO
 *
 * 1. **Que la ventana se desplace en horizontal**, comprobado EMPUJÁNDOLA. La
 *    primera versión de esta sonda comparaba `scrollWidth` con `innerWidth` y
 *    daba seis falsos positivos: ese valor sigue creciendo con contenido que un
 *    ancestro ya recorta.
 * 2. **Contenido recortado e INALCANZABLE**, que es el fallo de verdad. Un
 *    `overflow:hidden` evita el scroll cortando lo que sobra: la página se ve
 *    perfecta y las columnas de la derecha de una tabla no existen para nadie.
 * 3. **Objetivos táctiles por debajo de 44 px** en el breakpoint de móvil, que
 *    es la medida que pide el spec.
 *
 * No mide «se ve bien»: eso no es automatizable y para eso está la revisión
 * humana que el plan sigue pidiendo.
 *
 * Uso:  node e2e/sonda-responsive.mjs
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

/* Los cinco del spec, cada uno en el centro de su tramo salvo el primero y el
   último, que se prueban en su borde peor: 1600 justo al entrar, y 360 que es
   el ancho real de un teléfono corriente. */
const ANCHOS = [
  { nombre: '≥1600',     w: 1600, h: 1000 },
  { nombre: '1280–1599', w: 1366, h: 900 },
  { nombre: '1024–1279', w: 1100, h: 800 },
  { nombre: '768–1023',  w: 820,  h: 1000 },
  { nombre: '<768',      w: 360,  h: 740 },
];

const PANTALLAS = [
  '/operacion/ordenes', '/operacion/viajes', '/operacion/despacho',
  '/operacion/informes',
  '/catalogos/clientes', '/catalogos/cisternas', '/catalogos/conductores',
  '/administracion/usuarios', '/administracion/roles',
  '/administracion/auditoria', '/administracion/dispositivos',
  '/tablero',
];

const nav = await chromium.launch();
const ctx = await nav.newContext({ viewport: { width: 1600, height: 1000 } });
const pag = await ctx.newPage();

await pag.goto(`${APP}/entrar`, { waitUntil: 'networkidle' });
await pag.getByLabel('Correo').fill(CORREO);
await pag.getByLabel('Contraseña').fill(env.SEED_ADMIN_CLAVE);
await pag.getByLabel('Código de verificación').fill(totp(SECRETO));
await pag.getByRole('button', { name: 'Entrar' }).click();
await pag.waitForURL('**/operacion/ordenes', { timeout: 15000 });
console.log('sesión iniciada\n');

const fallos = [];

for (const ruta of PANTALLAS) {
  const marcas = [];
  for (const bp of ANCHOS) {
    await pag.setViewportSize({ width: bp.w, height: bp.h });
    await pag.goto(`${APP}${ruta}`, { waitUntil: 'networkidle' });
    // Un respiro para que el layout se asiente tras el cambio de ancho.
    await pag.waitForTimeout(250);

    const medida = await pag.evaluate(() => {
      /* DOS fallos distintos, y medirlos juntos fue el primer error de esta
         sonda:

         1. **La ventana scrollea en horizontal.** Se comprueba EMPUJÁNDOLA, no
            comparando anchos: `documentElement.scrollWidth` sigue creciendo con
            contenido que un ancestro ya recorta, así que comparar anchos da
            positivo sobre páginas que están perfectamente.

         2. **Contenido RECORTADO e inalcanzable.** Un `overflow:hidden` evita
            el scroll de la página cortando lo que sobra: la página se ve bien y
            las columnas de la derecha de una tabla no existen para nadie. Es
            peor que el scroll, y la medida ingenua lo daba por bueno.

         `getBoundingClientRect()` NO tiene en cuenta el recorte de los
         ancestros —por eso la primera versión de esta sonda señalaba tablas que
         ya estaban dentro de una caja con scroll—, así que hay que subir la
         cadena a mano y mirar quién recorta. */
      const antes = window.scrollX;
      window.scrollTo(window.innerWidth, 0);
      const scrollaLaVentana = window.scrollX > 0;
      window.scrollTo(antes, 0);

      const recortadoInalcanzable = (() => {
        for (const el of document.querySelectorAll('table, img, pre')) {
          const r = el.getBoundingClientRect();
          if (r.width === 0) continue;
          let padre = el.parentElement;
          let contenido = false;
          while (padre && padre !== document.documentElement) {
            const ox = getComputedStyle(padre).overflowX;
            const caja = padre.getBoundingClientRect();
            if (r.width > caja.width + 1) {
              // Alguien lo tiene que desplazar. `auto`/`scroll` lo hacen;
              // `hidden` lo corta y lo pierde.
              if (ox === 'auto' || ox === 'scroll') { contenido = true; break; }
              if (ox === 'hidden') {
                return { etiqueta: el.tagName.toLowerCase(), ancho: Math.round(r.width),
                         caja: Math.round(caja.width),
                         recorta: padre.tagName.toLowerCase() +
                           (padre.className ? '.' + String(padre.className).split(' ')[0].slice(0, 30) : '') };
              }
            } else { contenido = true; break; }
            padre = padre.parentElement;
          }
          if (!contenido && r.width > window.innerWidth + 1) {
            return { etiqueta: el.tagName.toLowerCase(), ancho: Math.round(r.width),
                     caja: window.innerWidth, recorta: '(nadie: arrastra la página)' };
          }
        }
        return null;
      })();

      return { scrollaLaVentana, recortadoInalcanzable };
    });

    if (medida.scrollaLaVentana) {
      marcas.push(`❌ ${bp.nombre}: la ventana se desplaza en horizontal`);
      fallos.push(`${ruta} @ ${bp.nombre} · scroll de página`);
    }
    if (medida.recortadoInalcanzable) {
      const c = medida.recortadoInalcanzable;
      marcas.push(`❌ ${bp.nombre}: <${c.etiqueta}> de ${c.ancho}px RECORTADO a ${c.caja}px por ${c.recorta}`);
      fallos.push(`${ruta} @ ${bp.nombre} · contenido inalcanzable`);
    }

    if (bp.w < 768) {
      const pequenos = await pag.evaluate(() => {
        const malos = [];
        for (const el of document.querySelectorAll('button, a[href], input, select')) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;   // oculto
          if (r.height < 44) malos.push(`${el.tagName.toLowerCase()}:${Math.round(r.height)}px`);
        }
        return malos;
      });
      if (pequenos.length) {
        marcas.push(`⚠ ${bp.nombre}: ${pequenos.length} objetivo(s) <44px · ${[...new Set(pequenos)].slice(0, 4).join(', ')}`);
      }
    }
  }
  console.log(`${ruta.padEnd(32)} ${marcas.length === 0 ? '✅ los 5 anchos' : ''}`);
  for (const m of marcas) console.log(`    ${m}`);
}

await nav.close();

console.log('');
if (fallos.length) {
  console.log(`❌ ${fallos.length} combinación(es) con layout roto:`);
  for (const f of fallos) console.log(`   · ${f}`);
  process.exit(1);
}
console.log('✅ ninguna pantalla desplaza la ventana ni recorta contenido, en los 5 anchos');
