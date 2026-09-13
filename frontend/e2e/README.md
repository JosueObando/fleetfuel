# Recorridos de extremo a extremo

Los cuatro necesitan el frontend en el 3100 y la API en el 4100.

| | Qué recorre | Criterio de salida |
|---|---|---|
| `recorrido-admin.mjs` | La raíz sin sesión, la puerta sobre el boceto, usuarios, roles, auditoría, dispositivos, licencias, bitácora y el cierre de sesión | **§5, §21, §6.6 y §7.15** |
| `recorrido.mjs` | Alta de cliente, conductor, vehículo y cisterna con dos compartimentos | **1A** |
| `recorrido-1b.mjs` | Orden → validación → viaje → plan de carga → autorización | **1B** |
| `recorrido-1c.mjs` | Carga en terminal → entrega con precinto verificado → gasto → liquidación → informes del §14 | **1C** |
| `sonda-responsive.mjs` | Las 12 pantallas en los 5 anchos del spec | **UX-1** |

## La sonda de breakpoints, y el error que cometió primero

El criterio de salida de UX-1 es «el shell aguanta los 5 breakpoints con datos
reales». Se verificó a mano al escribir el shell, y desde entonces entraron
**nueve pantallas** sin que nadie volviera a mirarlas en un móvil. Ninguna
prueba de componente puede: jsdom no tiene ancho, no calcula layout y no sabe
qué es un scroll horizontal.

**La primera versión medía mal, y conviene saber por qué.** Comparaba
`documentElement.scrollWidth` con `innerWidth` y usaba `getBoundingClientRect()`
para señalar al culpable. Las dos cosas están mal:

- `scrollWidth` sigue creciendo con contenido que un ancestro ya recorta, así
  que daba positivo sobre páginas correctas;
- `getBoundingClientRect()` **no tiene en cuenta el recorte de los ancestros**,
  así que señalaba tablas que ya estaban dentro de una caja con scroll.

Se notó porque el arreglo no cambió ni un número. Ahora mide dos cosas
distintas, que son dos fallos distintos:

1. **Que la ventana se desplace**, comprobado EMPUJÁNDOLA (`window.scrollTo`).
2. **Contenido recortado e inalcanzable** — un `overflow:hidden` evita el scroll
   cortando lo que sobra: la página se ve perfecta y las columnas de la derecha
   de una tabla no existen para nadie. Es peor que el scroll.

No mide «se ve bien»: eso no es automatizable, y para eso sigue pendiente la
revisión humana que pide el plan.

## El de la puerta, y por qué entra por `/`

Es el único que visita la raíz del dominio. Los otros tres hacen
`goto('/entrar')` directo, y por eso ninguno vio durante meses que `/` redirigía
al boceto de UX-2 —seis envíos inventados, sin `ShellApp` y **sin pedir
sesión**—, servido así en producción. Las 293 pruebas de componente de entonces
tampoco: `Tablero.spec.tsx` prueba la maqueta, y pasa.

**La ruta que nadie prueba es la que todo el mundo escribe en la barra.**

También vigila la PETICIÓN de cierre de sesión, no su efecto visible: borrar
`localStorage` y revocar el refresco en Redis se ven exactamente igual desde la
pantalla, y durante meses sólo pasaba lo primero. Por la misma razón comprueba
que `/conductores/licencias-por-vencer` responda **200**: es el endpoint que
durante meses devolvía 400 en su uso normal, y una pantalla que enseña «ninguna
licencia vence» se ve idéntica tanto si no hay ninguna como si la consulta
falló.

Como el de 1C, vigila las RESPUESTAS y no el texto de la consola: abre un viaje
en despacho, y ahí `GET /liquidaciones/viaje/:id` responde 404 mientras el viaje
no está liquidado — el caso normal.

## Un `.next` sucio se disfraza de bug de aplicación

Un build incremental sobre artefactos viejos deja chunks huérfanos que responden
404 sin que nada lo diga. El componente cliente no hidrata, la puerta de sesión
no llega a correr y **la aplicación se sirve entera sin pedir credenciales** —
con la pantalla congelada en «Comprobando la sesión…».

Pasó el 2026-09-12 y se buscó media hora en el código recién cambiado. Ante
cualquier síntoma raro: `rm -rf .next && npm run build` antes de sospechar del
código.

Verificarlo con `curl` prueba el servidor, no la pantalla: el §26 cierra una
fase **desde la interfaz**.

## El de 1C, y por qué estrena flota

`recorrido-1c.mjs` da de alta SU vehículo, SU cisterna y SU conductor antes de
empezar. No es ceremonia: `viajes.periodo` es
`tstzrange(coalesce(fecha_inicio, fecha_programada), fecha_fin)`, y pasar a
`desplazamiento_terminal` estampa `fecha_inicio = now()`. Reutilizando la
cisterna sembrada, la segunda corrida choca con la primera contra la exclusión
del §5.1 — **con razón**, porque de verdad se solapan.

Ese choque destapó un fallo real: `cambiarEstado` era el único de los tres
caminos que tocan el periodo sin envolver la consulta en `traducirSolapamiento`,
así que «esa cisterna ya está ocupada» —la situación de negocio más corriente
que hay— salía como un **500 con el nombre de una restricción dentro**. Está
arreglado y con prueba en `viajes-servicio.integracion.ts`.

Y por la misma razón el viaje se programa para **mañana** y no para dentro de un
año: arrancarlo hoy estiraría su periodo por todos los meses de en medio.

## Este recorrido vigila las RESPUESTAS, no la consola

Los otros dos tratan cualquier error de consola como un fallo, y les basta
porque nunca provocan un 4xx. El de 1C sí, y a propósito: `GET
/liquidaciones/viaje/:id` responde 404 mientras el viaje no está liquidado —el
caso normal durante casi todo el recorrido— y el 409 al aprobar el propio gasto
es la separación del §7 funcionando, que es lo que un paso comprueba.

El navegador escribe «Failed to load resource» por cada uno sin decir de qué
petición habla, así que filtrar por ese texto sería filtrar a ciegas: taparía
también un 500 de verdad. Se ignora esa línea concreta y se vigilan las
respuestas con una lista de lo esperado; todo lo demás sigue siendo fatal.

## Librerías de Chromium

Con privilegios:

    sudo npx playwright install-deps chromium

Sin ellos —el caso de esta máquina de desarrollo— se extraen los paquetes a un
directorio propio:

    mkdir -p /tmp/libs && cd /tmp/libs
    apt-get download libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
      libasound2t64 libatk1.0-0t64 libatk-bridge2.0-0t64 libatspi2.0-0t64 \
      libcups2t64 libgbm1
    for f in *.deb; do dpkg -x "$f" raiz; done
    export LD_LIBRARY_PATH=/tmp/libs/raiz/usr/lib/x86_64-linux-gnu

`apt-get download` y `dpkg -x` no necesitan root.

**Al 2026-09-06 esto ya está resuelto en esta máquina:** `chromium.launch()`
arranca sin preparar nada, así que los dos recorridos se corren tal cual. La
sección de arriba se queda para una máquina nueva.

## Sí están en CI (2026-09-06)

Trabajo `e2e` del workflow: levanta Postgres, Redis, la API compilada y la
interfaz construida, y corre los tres recorridos (el de 1C desde el
2026-09-12). Es el único sitio donde se
comprueba lo que el §26 pide literalmente —«un operador da de alta … DESDE LA
UI»— y el único que recorre la cadena entera: navegador → Next → API → Postgres.

**Los recorridos se bastan solos.** Meterlos en CI obligó a arreglar tres cosas
que en desarrollo no se notaban porque la base llevaba meses acumulando datos:

1. **El segundo factor.** En una base recién sembrada el administrador NO lo
   tiene inscrito, así que un login normal devuelve la sesión de inscripción del
   §7 y el recorrido se queda en la puerta. Ahora lo inscribe por la API antes
   de entrar, igual que haría el primer usuario real — y de paso eso convierte
   el arranque en una prueba del camino de inscripción.
2. **Los datos que 1B daba por hechos.** Necesita un cliente CON estación y un
   producto, y no los creaba: en desarrollo existían de sesiones anteriores. Una
   prueba que depende de datos que no crea no es reproducible — pasa o falla
   según lo que quedara de la vez anterior. Ahora los prepara por la API.
3. **El freno del login.** Los recorridos inician sesión varias veces cada uno;
   con el límite de producción (5 por minuto y cuenta) un reintento del trabajo
   se topa con un 429 que no tiene nada que ver con lo que se prueba. Se afloja
   SÓLO en ese trabajo de CI; su comportamiento se prueba en
   `api.integracion.ts`, que sí comprueba que corta a la sexta.

El secreto TOTP que inscribe el primer recorrido queda en `e2e/.secreto-totp`
(ignorado por git) para que el segundo pueda entrar: los dos corren seguidos
contra la misma base.

Verificado en local: los tres recorridos, sin errores de consola. El de 1C son
**diecisiete pasos** y termina cerrando el círculo: comprueba que la
conciliación cuadra —lo entregado es exactamente lo que salió de la terminal—,
que el panel del §15.5 muestra sus bloques, y que el informe de volumen del
§14.2 VE la entrega que el propio recorrido acaba de registrar. Ese último
paso es el que detectaría una cadena rota en un eslabón intermedio, que
ninguna prueba de módulo puede notar.

## Nada de esperas por tiempo

Un `waitForTimeout(400)` en `recorrido-1b.mjs` hizo que el recorrido fallara de
vez en cuando: si la petición de estaciones tardaba un poco más, el bucle
descartaba al único cliente que sí tenía estaciones y moría con «ningún cliente
tiene estaciones dadas de alta». Se cambió por esperar a que la opción APAREZCA.

Una prueba intermitente es peor que ninguna: enseña a reintentar y a no mirar.

## Sobre los selectores

Se usan roles y etiquetas, no clases CSS: un recorrido atado a
`.Catalogo-module__xyz` se rompe con cada recompilación y no comprueba nada
sobre la accesibilidad. Los campos numéricos son `spinbutton`, no `textbox`.

Un detalle que apareció al escribirlo: `getByRole('cell', {name})` encontraba
dos celdas por fila, porque los botones de acción llevan el nombre del
registro en texto para lectores de pantalla. Eso es correcto —sin él, seis
botones «Editar» serían indistinguibles— y por eso el recorrido usa
`exact:true`.

## El fallo que sólo un recorrido de navegador podía ver

Al reescribir la puerta de sesión con `useSyncExternalStore` (2026-09-12), el
efecto que redirige miraba el valor del render. Durante la hidratación React
devuelve a propósito la instantánea DEL SERVIDOR —siempre nula, que es lo que
evita el desajuste—, y los efectos corren en ese primer commit: resultado, todo
el mundo a `/entrar` con la sesión intacta en el almacén.

**Las ocho pruebas del shell pasaban antes y después.** jsdom no hidrata, así que
ninguna prueba de componente puede distinguir una instantánea de la otra. Estos
recorridos lo cazaron en el primer intento.
