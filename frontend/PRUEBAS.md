# Pruebas del frontend

```bash
npm run comprobar  # lo mismo que hace CI: tipos + contraste + cobertura
npm test           # una pasada
npm run test:watch # mientras se desarrolla
npm run test:cov   # con cobertura y umbral
```

**`npm test` no comprueba los tipos.** `next/jest` aplica el mismo transformador
SWC que el build, que los BORRA sin mirarlos: una prueba con un error de tipos
pasa en verde aquí y tumba el trabajo de CI, que sí ejecuta `tsc --noEmit`. Ya
ocurrió dos veces —la última con cuatro objetos a los que les faltaba una
propiedad obligatoria—, y las dos veces el síntoma fue el mismo: local en verde,
CI en rojo. Para eso está `npm run comprobar`: hace los mismos tres pasos que
CI y en el mismo orden, así que «pasan las pruebas» significa lo mismo aquí que
allí.

Se eligió SWC, aun con ese coste, porque configurar `ts-jest` a mano habría
creado una segunda forma de compilar, y las dos se desincronizan.

El entorno es **jsdom** y no node: lo que se prueba aquí —`localStorage`,
`fetch`, el DOM— sólo existe en un navegador, y es justo lo que falla distinto.

## Qué está cubierto hoy

| | Qué fija |
|---|---|
| `src/api/cliente.ts` | El token, la clave de idempotencia de cada POST, y qué hace con cada código de error |
| `catalogos/Catalogo.tsx` | La pantalla que comparten los cinco catálogos: esqueletos, vacío, error, alta, edición y baja |
| Las cinco páginas de catálogo | Que cada una monte SU definición y no la del vecino |
| `catalogos/cisternas` | La suma de compartimentos en vivo, el tope de doce y el filtro de vehículos; al **editar**, que la capacidad no baje de lo que suman y que «cargada» o «en viaje» no se declaren desde el catálogo |
| `operacion/ordenes` | Que la estación dependa del cliente, y los motivos obligatorios; editar la programación sólo donde la API dice `admiteEdicion`, con la ventana en **hora local** |
| `operacion/viajes` | Que **autorizar** sea una acción aparte del §7, no una transición más; y que un viaje en marcha deje anotar el **odómetro** mandando sólo el odómetro |
| `operacion/planificador` | §15.3: la semana en `?desde=`, una fila por cisterna —también las libres—, cada bloque LEÍDO entero por quien no lo ve, y como conflictos sólo lo que la exclusión del §5.1 no ve: sin cisterna, sin conductor, sin fin y retrasado. Los «solapes» no, porque la base ya los impide |
| `despacho` (URL) | Que el viaje abierto viva en `?viaje=ID` —recargar y compartir vuelven al mismo sitio—, que nunca se autoseleccione, y que la respuesta tardía del viaje anterior no pise al actual |
| `pruebas/router.ts` | No es una prueba: un `next/navigation` que SÍ navega. Con un `replace` de mentira, una pantalla que escribiera la URL y nunca la leyera pasaría |
| `operacion/viajes/fechas` | Que «Fin previsto» sea el ÚLTIMO día ocupado: con el fin como medianoche, un viaje de un día tenía el periodo vacío y no reservaba nada |
| `api/cambios` | Lo que manda un PATCH: sólo lo que cambió, vaciar es `null`, y la hora local de un `datetime-local` vuelve al mismo instante |
| `operacion/despacho` | Toda la Fase 1C: qué momento abre cada estado del §8.2, y que la pantalla **no deje declarar un precinto intacto** |
| `operacion/informes` | Los cuatro informes del §14, el estado en la URL, y que la cadena del volumen **calcule y nombre el descuadre** en vez de dejar la resta a quien mira |
| `api/cliente` (almacén) | Que la instantánea de sesión devuelva la MISMA referencia mientras no cambie —requisito de `useSyncExternalStore`— y que un cierre en otra pestaña avise |
| `app/entrar` | La puerta de MFA sin inscribir, la **inscripción del segundo factor**, y que un 200 no baste para entrar |
| `componentes/ShellApp` (estrecho) | §7: por debajo de 1024 la navegación es un CAJÓN —abre con «Menú», cierra con Escape, con «Cerrar» o con el telón, el foco entra y vuelve a quien lo abrió, lo de detrás queda `inert`, y se cierra solo al ensanchar—; por debajo de 768, barra inferior de cuatro accesos y «Más». Lo visual lo mide la sonda, que desde ese día también mide controles cortados y el cajón ABIERTO |
| `componentes/PuertaDeSesion` | La puerta, sola. Vivía dentro de `ShellApp` y por eso no protegía `/tablero` |
| `administracion/Usuarios` | Que el MFA de cada cuenta sea **visible**, y que suspender exija un motivo antes de salir del navegador (§21) |
| `administracion/Roles` | El recuento «N de M permisos» —la cifra que habría delatado el incidente del Administrador de 11 sobre 48— y que guardar mande el conjunto ENTERO, porque es un PUT |
| `api/cliente` (refresco) | Que un 401 refresque y **reintente** en vez de echar a la calle, con UNA sola llamada de refresco aunque caduquen cinco peticiones a la vez |
| `app/page.tsx` | Que la raíz lleve a la aplicación y **nunca** a la maqueta |
| `componentes/TablaDesplazable` | Que la caja con scroll sea **alcanzable por teclado** — lo visual lo mide la sonda, en un navegador de verdad |
| `administracion/Auditoria` | Que dos JSON se lean como **qué cambió** —incluido el campo que desaparece— y que la pantalla no ofrezca nada que escriba |
| `administracion/Dispositivos` | Que revocar exija motivo y diga **cuántas sesiones cortó**, que es la diferencia entre «lo hice» y «funcionó» |
| `despacho/SeccionSolicitudes` | §2C: el historial de cambios de ruta del viaje dice quién pidió, quién autorizó y POR QUÉ; se lee, no se resuelve, y un 403 no deja aviso |
| `despacho/SeccionBitacora` | Que la integridad de la cadena se **pueda ver**, y que anular añada una corrección en vez de parecer que borra (§7.15) |
| `catalogos/AvisoLicencias` | Que una licencia **vencida** no se confunda con una por vencer, que es lo único que la API no separa (§6.6) |
| `operacion/alertas` | §22: que **reconocer** y **resolver** sean dos gestos —lo visto no pasa por arreglado—, que cerrar exija motivo, que «evaluar» diga cuántas encontró, y que el `detalle` JSONB se lea con nombres y unidades |
| `operacion/solicitudes` | §2C: que **quien pide no resuelve** ni siquiera vea el gesto, que aprobar y rechazar exijan motivo, y que una bandeja vieja que contesta tarde no resucite lo ya resuelto |
| `operacion/gastos` | §7.17: los pendientes de TODOS los viajes con cuántos y por cuánto, un gasto **sin comprobante** señalado antes de aprobarlo, y que quien lo registró no pueda aprobárselo |
| `operacion/liquidaciones` | §7.18: tres pestañas en la URL que son los tres actos —cada una ofrece sólo el que toca—, quien calculó no aprueba, y la referencia del pago con el mínimo del DTO |
| `api/usuario-actual` | Quién mira, para las tres reglas de separación (solicitudes, gastos, liquidaciones): nulo durante la hidratación, y nulo es «no ofrecer» |
| `tablero/Tablero.tsx` | Que todo el estado de la vista viva en la URL |
| 14 componentes | Sus decisiones de accesibilidad: qué se anuncia, qué se oculta, qué se nombra |

La regla que atraviesa todo: **se prueba la conducta visible, no la
implementación.** Un rediseño que cambie colores o clases no rompe nada; uno
que borre el texto «porque el color ya lo dice» sí — y ese es el cambio que se
cuela en una revisión visual, porque en pantalla se ve perfecto.

## El umbral

| | al empezar | componentes | despacho (1C) | informes (§14) | administración | §21 y bitácora | Jest 30 | mutaciones | bandejas | ediciones | URL de despacho | planificador | shell móvil | umbral |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Sentencias | 7,24 % | 92,00 % | 93,24 % | 93,71 % | 94,48 % | 94,62 % | 94,65 % | 95,58 % | 95,58 % | 95,86 % | 95,90 % | 96,15 % | **96,27 %** | 96 |
| Ramas | 6,75 % | 81,17 % | 81,40 % | 81,51 % | 81,91 % | 82,48 % | 83,28 % | 88,44 % | 89,33 % | 89,88 % | 90,14 % | 90,56 % | **90,62 %** | 90 |
| Funciones | 4,65 % | 82,42 % | 85,34 % | 86,76 % | 88,58 % | 89,17 % | 89,19 % | 90,13 % | 90,66 % | 91,57 % | 91,63 % | 92,15 % | **92,35 %** | 92 |
| Líneas | 7,44 % | 93,33 % | 94,56 % | 95,40 % | 96,11 % | 96,12 % | 96,14 % | 96,77 % | 96,56 % | 96,69 % | 96,72 % | 96,95 % | **97,03 %** | 97 |

**Las cuatro pasan el 80 % que pide la disciplina.**

**La columna «ediciones»** (2026-09-14) da pantalla a los tres `PATCH` que la
auditoría encontró sin ella: cisternas, órdenes y viajes. Hasta entonces no se
podía corregir ninguna de las tres sin darla de baja o cancelarla. Todas mandan
sólo lo que cambió (`api/cambios.ts`), y no es por ahorrar bytes: `PATCH
/viajes/:id` responde 409 a un viaje en marcha si el cuerpo trae la cisterna,
aunque sea la misma, así que reenviar el formulario entero hacía imposible
anotar el odómetro. 60 pruebas nuevas y 60 mutaciones; las que sobrevivieron
eran condiciones que no podían cambiar el resultado y se quitaron.

**Las pruebas corren en hora de Panamá** (`process.env.TZ` en
`jest.config.mjs`). La máquina y CI están en UTC, donde hora local y UTC
coinciden y cualquier conversión que las confunda pasa en verde. Cambiar `TZ`
dentro de una prueba NO funciona: el `process.env` del sandbox es una copia. Lo
delató una mutación que «murió» sobre una prueba que ya estaba roja.

**La columna «Jest 30» no tiene pruebas nuevas** (2026-09-13). Se actualizó Jest
de 29 a 30 porque trae jsdom 26, y en jsdom 20 `getComputedStyle` costaba ~2 ms
por llamada **sin una sola hoja de estilos**: cada `getByRole` con `name` pedía
cientos y tardaba 744 ms en el tablero. La suite bajó de 48,5 s a 27,5 s sin
tocar una prueba. Las ramas suben 0,8 puntos porque el istanbul nuevo las
cuenta distinto, no porque se cubra más; el trinquete sube igual, porque
protege contra retrocesos medidos CON ESTE instrumento.

**La suite volvió a pasar de 30 s** (33,5 s el 2026-09-14, con 734 pruebas) y
se bajó a **~28,5 s** sin quitar una sola. Lo que se midió antes de tocar nada:

- Los ficheros suman ~89 s de CPU con 3 workers en 4 núcleos; poner 4 workers
  NO ayuda (35 s): la máquina la comparten los tres entornos y hay swap en zram.
  En esta máquina el tiempo de pared es ruidoso: medir tres veces.
- Perfil de Despacho: 27 % render de React, **15 % teclear**, 12 %
  `getComputedStyle` (visibilidad de `getByRole` y la comprobación de
  `pointer-events` de user-event).

Dos cambios. `pointerEventsCheck: 0` en `pruebas/preparar.ts`, que aquí nunca
podía fallar (explicado allí). Y **`rellenar()`** (`pruebas/rellenar.ts`): clic
y pegar, para las 108 llamadas que rellenaban un formulario para mirar el
cuerpo enviado. `usuario.type` se queda donde lo probado es el teclado
(`Campo.spec.tsx`), en las fechas y con teclas especiales; `rellenar` se niega
en esos casos en vez de dar un verde dudoso, y `src/rellenar.spec.tsx` fija que
el valor final es el mismo que tecleando. Verificado por mutación sobre una
muestra de seis ficheros convertidos: todas cazadas salvo una que **ya
sobrevivía antes** —«resolver exige un motivo» escribía `'ok  '`, cuatro
caracteres, así que nunca comprobó el `trim()`—, arreglada con `'ok   '`.

**La columna «mutaciones»** (2026-09-13) cierra las ramas de los doce ficheros
que quedaban por debajo del 80 %. Cada prueba nueva se dio por buena sólo
después de ROMPER a propósito la línea que dice proteger y verla en rojo: 38
mutaciones, todas cazadas. Dos sobrevivieron al primer intento —las de la
carrera entre informes, ver abajo— y la prueba se rehízo.

Lo que encontró, que la cobertura sola no decía:

- **«Los opcionales vacíos no viajan» no protegía nada contra perderlos.** Las
  tres pantallas con formulario (órdenes, viajes, cisternas) la tenían, y
  ninguna la contraria. Borrar la línea que manda un campo —la cisterna de un
  viaje, el certificado de calibración— dejaba esa prueba en verde: se
  comprobó con ocho mutaciones, y las ocho sobrevivían. Una prueba negativa
  necesita su positiva.
- **Ocultar una casilla no borra su estado.** Pasar el pago a «empresa»
  escondía «reembolsable», pero seguía a `true` por debajo; la prueba miraba
  la casilla, no el cuerpo que se manda.
- **Dos pruebas prometían más que su nombre**: «ponen encabezados reales»
  buscaba texto, y seguía en verde con el `<h2>` cambiado por un `<div>`.
- **Una guarda inalcanzable se quitó**: `if (!revocando) return` en
  `Dispositivos` sólo contentaba a TypeScript. El dispositivo llega ahora como
  argumento.

**La trampa nueva, quinta de la familia:** para comprobar que una respuesta
TARDÍA no cambia lo que ya se ve, `waitFor(() => getByText(...))` no sirve: lo
encuentra al instante, antes de que React aplique la actualización, y pasa con
la protección quitada. Hay que resolver la promesa dentro de `act` y afirmar
después.

**La columna «bandejas»** (2026-09-13) son las pantallas de alertas y de
solicitudes de ruta, escritas en orden TDD y verificadas con 38 mutaciones más.
Las líneas bajan dos décimas y el trinquete de líneas sigue en 96: son más
sentencias nuevas, no menos cubiertas.

**El fallo que la cobertura no podía ver:** `alertas.detalle` es JSONB, y la
primera versión de las pruebas lo simulaba como TEXTO —una suposición sobre el
contrato, no el contrato—. Pantalla y pruebas estaban de acuerdo entre sí y en
verde, y en producción habría salido «[object Object]» en cada alerta. Lo
encontró leer la migración para decidir qué ramas eran alcanzables. **Los datos
de una prueba de pantalla se copian de la API o del esquema, no se imaginan.**

La última columna la fija una prueba, no la buena voluntad: `umbral.spec.ts`
compara esta tabla con `jest.config.mjs` y falla si divergen. Ya hizo su trabajo
la primera vez que se subió el umbral después de escribirla: el commit no podía
cerrarse sin tocar también esta tabla. Se escribió el
2026-09-12, cuando este documento se quedó atrás por **tercera** vez —las dos
primeras fueron `backend/test/COBERTURA.md`—. Subir el umbral y anotarlo son dos
actos, y al segundo no lo obligaba nadie.

## Qué queda fuera de la medida, a propósito

`src/app/kit/**`, el kit del sistema de diseño. Es el «equivalente a Storybook»
del plan: una ruta que MUESTRA los componentes en sus estados. Cubrirla mediría
que el escaparate se renderiza, no que los componentes funcionen — y eso ya se
prueba en cada componente. Misma razón por la que el backend deja fuera los DTO
y las entidades.

## E2E

Aparte, en `e2e/`. Son recorridos con Playwright contra la aplicación en marcha,
no pruebas de componente:

```bash
node e2e/recorrido.mjs        # criterio de salida de 1A, desde la interfaz
node e2e/recorrido-1b.mjs     # orden → plan de carga → viaje
node e2e/recorrido-1c.mjs     # carga → entrega → gasto → liquidación → informes
node e2e/recorrido-admin.mjs  # la puerta, usuarios y roles, y el cierre de sesión
node e2e/sonda-responsive.mjs # las 16 pantallas en los 5 anchos del spec
```

**Están en CI** desde el 2026-09-12 (trabajo `e2e`): levanta Postgres, Redis, la
API compilada y la interfaz construida, y los corre. Para eso hubo que hacerlos
autosuficientes —inscriben el TOTP por la API y crean sus propios datos—, porque
en desarrollo funcionaban sólo por los datos acumulados.

Localmente necesitan las librerías de sistema de Chromium:
`sudo npx playwright install-deps chromium`.

**Y necesitan un `.next` limpio.** Un build incremental sobre artefactos viejos
deja chunks huérfanos que responden 404 sin que nada lo diga: el componente
cliente no hidrata, la puerta de sesión no llega a correr y **la aplicación se
sirve entera sin pedir credenciales**. Pasó el 2026-09-12 y costó media hora
buscar el fallo en el código que acababa de cambiar. Ante cualquier síntoma raro
en un recorrido: `rm -rf .next && npm run build`.

## El estilo, que ya es una puerta (2026-09-12)

`npm run lint` entra en CI y en `githooks/pre-commit`. Estuvo fuera mientras el
frontend arrastró **13 errores** anteriores a que hubiera puerta ninguna;
añadirlo antes habría dejado `main` en rojo por algo que ningún commit rompía, y
de ahí sale siempre la misma salida: quitar el paso.

Los 13 se cerraron **sin silenciar nada que fuera cierto**, y la distinción es
el contenido de este apartado:

| | Cuántos | Qué se hizo |
|---|---|---|
| `set-state-in-effect` **reales** | 4 | Se arreglaron. El `setState` era síncrono de verdad |
| `set-state-in-effect` **falsos** | 5 | El `setState` va tras un `await`. El patrón, copiado cinco veces, vive en `useCargaInicial` |
| `no-explicit-any` | 3 | El mismo `type Fila` copiado. Hoy en `src/api/tipos.ts`, con la excepción declarada UNA vez y explicada |
| `require()` | 1 | Pasó a `import` en la preparación de las pruebas |

**Los cuatro reales valían el arreglo por sí solos**, aparte del lint:

- `if (!clienteId) { setEstaciones([]); return; }` y sus dos hermanos vaciaban
  una lista con un render de más. Al derivarla —guardando el dato CON el
  identificador al que pertenece— desapareció además una clase de fallo que
  nadie había reportado: enseñar los compartimentos de la cisterna anterior, o
  las líneas del viaje anterior, durante el rato que tarda la petición nueva.
- `if (leerSesion()) setListo(true)` en el shell copiaba `localStorage` a un
  estado. Ahora se lee con `useSyncExternalStore`, y con eso **cerrar sesión en
  una pestaña echa a las demás** y un 401 devuelve a la entrada sin esperar a
  que alguien navegue.

### Lo que ese cambio enseñó sobre estas pruebas

La reescritura del shell tenía un fallo: durante la hidratación React devuelve a
propósito la instantánea DEL SERVIDOR —siempre nula—, y el efecto que redirige
corría en ese primer commit. Resultado: todo el mundo a `/entrar`, con la sesión
intacta en el almacén.

**Las ocho pruebas del shell pasaban antes y después.** jsdom no hidrata, así
que ninguna prueba de componente puede distinguir «la instantánea del servidor»
de «la real». Lo cazó el recorrido de navegador en el primer intento.

Es el argumento más claro que hay en este repositorio para mantener los tres
niveles: 363 pruebas de componente no cubren una clase entera de fallo que un
solo recorrido detecta.

### Y la auditoría del 2026-09-12 lo repitió

La raíz del dominio redirigía a `/tablero` —el boceto de UX-2, con seis envíos
inventados, **sin puerta de sesión**— y se servía así en producción. Ninguna de
las 293 pruebas lo veía: `Tablero.spec.tsx` prueba la maqueta y pasa. Ningún
recorrido lo veía tampoco, porque los tres hacían `goto('/entrar')` directo.

**La ruta que nadie prueba es la que todo el mundo escribe en la barra.** De ahí
`recorrido-admin.mjs`, cuyo primer paso es entrar por `/`.
