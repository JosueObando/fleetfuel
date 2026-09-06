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

## No están en CI, y qué costaría meterlos

Nada del entorno lo impide ya —en GitHub Actions basta
`npx playwright install --with-deps chromium`—. Lo que falta es levantar la
aplicación entera dentro del trabajo de CI: frontend, API, Postgres y Redis. Es
un trabajo nuevo del workflow, no una línea más en el existente.

Mientras tanto son verificación manual: se corren al cerrar una fase y su
resultado vive en el plan de construcción, no en un check verde.

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
