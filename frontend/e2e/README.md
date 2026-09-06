# Recorrido de extremo a extremo

`node e2e/recorrido.mjs` entra por la pantalla de login y da de alta un
cliente, un conductor, un vehículo y una cisterna con dos compartimentos,
**desde la interfaz**. Es el criterio de salida de 1A: verificarlo con `curl`
prueba el servidor, no la pantalla.

Necesita el frontend en el 3100 y la API en el 4100.

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
interfaz construida, y corre los dos recorridos. Es el único sitio donde se
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
3. **El freno del login.** Dos recorridos inician sesión varias veces cada uno;
   con el límite de producción (5 por minuto y cuenta) un reintento del trabajo
   se topa con un 429 que no tiene nada que ver con lo que se prueba. Se afloja
   SÓLO en ese trabajo de CI; su comportamiento se prueba en
   `api.integracion.ts`, que sí comprueba que corta a la sexta.

El secreto TOTP que inscribe el primer recorrido queda en `e2e/.secreto-totp`
(ignorado por git) para que el segundo pueda entrar: los dos corren seguidos
contra la misma base.

Verificado en local contra una base creada desde cero: los dos recorridos, 14
pasos, sin errores de consola.

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
