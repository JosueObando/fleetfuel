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
  '/operacion/panel',
  '/operacion/ordenes', '/operacion/viajes', '/operacion/planificador', '/operacion/despacho',
  '/operacion/informes', '/operacion/alertas', '/operacion/solicitudes',
  '/operacion/gastos', '/operacion/liquidaciones',
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

    /* 3. **La navegación se pisa a sí misma.** El menú lateral es lo único que
       crece en VERTICAL con cada sección nueva, y las dos medidas de arriba
       sólo miran el ancho. El 2026-09-13, al pasar de 14 a 16 destinos, el
       pie con «Cerrar sesión» se pintó ENCIMA de «Auditoría» a 900 px de alto:
       `.navegacion` tenía `flex: 1` y `min-height: 0`, se encogía por debajo
       de su contenido y lo dejaba desbordar sobre lo que venía después. Se ve
       en una captura y no en ninguna prueba: jsdom no calcula layout. */
    const pisados = await pag.evaluate(() => {
      const nav = document.querySelector('nav[aria-label="Navegación principal"]');
      if (!nav) return [];
      const piezas = [...nav.querySelectorAll('button, h2, [role="toolbar"]')]
        .filter(el => !el.closest('[role="toolbar"]') || el.getAttribute('role') === 'toolbar')
        .map(el => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 0 && r.height > 0);
      const nombre = el => (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 24);
      const choques = [];
      for (let i = 0; i < piezas.length; i++) {
        for (let j = i + 1; j < piezas.length; j++) {
          const a = piezas[i].r, b = piezas[j].r;
          const alto = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          const ancho = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          // Más de 2 px en las dos direcciones: un borde compartido no es un choque.
          if (alto > 2 && ancho > 2) choques.push(`«${nombre(piezas[i].el)}» pisa «${nombre(piezas[j].el)}»`);
        }
      }
      return choques;
    });
    if (pisados.length) {
      marcas.push(`❌ ${bp.nombre}: la navegación se solapa · ${pisados.slice(0, 3).join(', ')}`);
      fallos.push(`${ruta} @ ${bp.nombre} · navegación solapada`);
    }

    /* 4. **Controles cortados.** La medida 2 sólo mira `table, img, pre`, y el
       2026-09-14 una CAPTURA a 360 px enseñó el menú lateral asomando cortado
       y el botón «Nueva cisterna» partido por el borde, en todas las pantallas,
       con esta sonda en ✅. Un botón del que se ve la mitad no es un problema
       de estética: la otra mitad —a veces la entera— no se puede pulsar.

       Se mira cada control VISIBLE contra sus ancestros: si uno con
       `overflow-x: auto|scroll` lo contiene, se alcanza desplazando; si uno con
       `hidden` —o la propia ventana— lo deja fuera, está perdido. */
    const cortados = await pag.evaluate(() => {
      const malos = [];
      for (const el of document.querySelectorAll('button, a[href], input, select, textarea')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (getComputedStyle(el).visibility === 'hidden') continue;   // cajón cerrado
        let izquierda = 0, derecha = window.innerWidth, alcanzable = false;
        for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
          const ox = getComputedStyle(p).overflowX;
          if (ox === 'visible') continue;
          const c = p.getBoundingClientRect();
          if (ox === 'auto' || ox === 'scroll') {
            // Una caja que desplaza en horizontal y de verdad puede hacerlo.
            if (p.scrollWidth > p.clientWidth + 1) { alcanzable = true; break; }
          }
          izquierda = Math.max(izquierda, c.left);
          derecha = Math.min(derecha, c.right);
        }
        /* El control cabe, pero su TEXTO no: la etiqueta se corta dentro del
           botón. Con `title` o `aria-label` el nombre entero sigue a mano (los
           bloques del planificador); sin ellos, lo cortado no está en ningún sitio.

           NO cuentan, porque son deliberados:
             · el texto de 1 px para lectores de pantalla (`.solo-lectores`);
             · el truncado con `text-overflow: ellipsis` —el «…» avisa de que
               hay más, y el spec lo pide para nombres largos (§ handoff,
               «truncados verificados con datos máximos»)—. */
        const nombreCompleto = el.hasAttribute('title') || el.hasAttribute('aria-label');
        const textoCortado = [el, ...el.querySelectorAll('*')].some(n => {
          if (n.clientWidth <= 1 || n.textContent.trim() === '') return false;
          const e = getComputedStyle(n);
          return n.scrollWidth > n.clientWidth + 1 && e.overflowX !== 'visible'
            && e.textOverflow !== 'ellipsis' && e.clipPath === 'none';
        });
        if (textoCortado && !nombreCompleto) {
          malos.push(`«${(el.textContent || '').trim().slice(0, 24)}» con el texto cortado`);
          continue;
        }
        if (alcanzable) continue;
        if (r.left < izquierda - 2 || r.right > derecha + 2) {
          const nombre = (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 24);
          malos.push(`«${nombre}» ${Math.round(r.left)}–${Math.round(r.right)} fuera de ${Math.round(izquierda)}–${Math.round(derecha)}`);
        }
      }
      return malos;
    });
    if (cortados.length) {
      marcas.push(`❌ ${bp.nombre}: ${cortados.length} control(es) cortado(s) · ${cortados.slice(0, 3).join(', ')}`);
      fallos.push(`${ruta} @ ${bp.nombre} · controles cortados`);
    }

    /* 5. **El cajón, ABIERTO.** Por debajo de 1024 la navegación es un cajón,
       y todo lo anterior la mide cerrada (`visibility: hidden`). El
       2026-09-14 una captura con el cajón abierto enseñó las etiquetas
       cortadas por la izquierda: la cabecera del cajón era más ancha que él,
       el cajón desplazaba en horizontal y llevar el foco a «Cerrar el menú» lo
       corría. Se abre, se mide que no desplace ni corte, y se cierra con Escape. */
    if (bp.w < 1024 && ruta !== '/tablero') {
      const abridor = bp.w < 768
        ? pag.getByRole('navigation', { name: 'Accesos rápidos' }).getByRole('button', { name: 'Más' })
        : pag.getByRole('button', { name: 'Abrir el menú' });
      await abridor.click();
      await pag.waitForTimeout(300);
      const cajon = await pag.evaluate(() => {
        const nav = document.querySelector('nav[aria-label="Navegación principal"]');
        const malos = [];
        if (nav.scrollWidth > nav.clientWidth + 1) malos.push(`desplaza ${nav.scrollWidth - nav.clientWidth}px en horizontal`);
        const n = nav.getBoundingClientRect();
        for (const el of nav.querySelectorAll('button')) {
          const r = el.getBoundingClientRect();
          if (r.width === 0) continue;
          if (r.left < n.left - 1 || r.right > n.right + 1) {
            malos.push(`«${(el.getAttribute('aria-label') || el.textContent).trim().slice(0, 20)}» fuera del cajón`);
          }
        }
        return malos;
      });
      if (cajon.length) {
        marcas.push(`❌ ${bp.nombre}: el cajón abierto · ${cajon.slice(0, 3).join(', ')}`);
        fallos.push(`${ruta} @ ${bp.nombre} · cajón abierto roto`);
      }
      await pag.keyboard.press('Escape');
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
console.log('✅ ninguna pantalla desplaza la ventana, recorta contenido ni solapa la navegación, en los 5 anchos');
