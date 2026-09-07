# La puerta de cobertura

`npm run test:cobertura` corre **las unitarias y las de integración juntas** y
mide una sola vez. Es el número honesto del proyecto.

## Por qué el umbral no es 80

Al ponerlo, la base estaba en 63 %. Un umbral de 80 rompería CI en el commit
siguiente, y lo que pasa entonces no es que alguien escriba pruebas: es que
alguien baja el número, o añade `--passWithNoTests`, o quita el paso. El umbral
muere y se lleva por delante la costumbre.

Así que es un **trinquete**: se puso justo por debajo de lo que ya había.

| | al ponerlo | catálogos | administración | superficie API | plan de carga | reserva | cierre | umbral |
|---|---|---|---|---|---|---|---|---|
| Sentencias | 63,47 % | 74,36 % | 89,41 % | 94,27 % | 96,30 % | 97,35 % | **97,92 %** | 97 |
| Ramas | 42,52 % | 60,24 % | 71,95 % | 80,00 % | 84,50 % | 87,97 % | **89,38 %** | 89 |
| Funciones | 46,48 % | 59,66 % | 79,67 % | 98,68 % | 98,71 % | 100 % | **100 %** | 99 |
| Líneas | 66,18 % | 77,55 % | 92,10 % | 95,35 % | 97,43 % | 98,55 % | **98,89 %** | 98 |

El trinquete ha subido ocho veces, que es exactamente para lo que está.

El umbral de funciones se deja en **99 con 100 medido**, y no en 100: la regla de
este fichero es ponerlo justo por debajo de lo que hay, y un 100 convertiría
cualquier función nueva sin prueba en un CI roto antes de que nadie pueda
escribirla. El trinquete frena la erosión, no prohíbe escribir.
**Las cuatro métricas pasan ya el 80 % que pide la disciplina.**

> Aviso para quien lea esta tabla como registro: **una de esas seis subidas no
> se anotó aquí.** Entre la columna «superficie de la API» y la de «plan de
> carga», el umbral del fichero pasó de 93/79/97/94 a 95/83/98/96 y esta tabla
> siguió diciendo lo anterior. Se detectó auditando la suite el 2026-09-06. La
> columna que falta no se reconstruye —no hay medida guardada de ese día— y se
> deja dicho en vez de inventarla. Si el documento que gobierna cuándo se sube
> el umbral se queda atrás, la regla se erosiona sin que nadie la derogue.

La ronda «cierre» atacó lo que quedaba nombrado en la auditoría, y dos de sus
tres piezas son del mismo tipo: **caminos que sólo existen fuera de la máquina
de pruebas.**

- **La versión que anuncia `/api/salud`.** `npm_package_version` sólo existe si
  el proceso lo lanzó npm. Jest lo lanza; la imagen de producción arranca con
  `node dist/main.js` y no. O sea que la rama que lee `package.json` era la
  única que corre EN PRODUCCIÓN y la única sin probar. Romperla no habría dado
  rojo en CI: habría salido como `"version": "desconocida"` en el chequeo de
  salud, que nadie mira hasta que hace falta.
- **El recorte del `user-agent`.** Ninguna prueba de integración lo tocaba
  porque supertest manda agentes cortos; el caso real es el bot con una cadena
  de cientos de caracteres, que es justo el tráfico que uno va a mirar.
- **`UsuarioActual` en una ruta pública**, donde `request.user` no existe y sin
  el `?.` habría un 500 en una ruta que ni siquiera pide sesión.

Y se cerró el agujero estructural: `api-superficie.integracion.ts` decía en su
cabecera que recorría «las 64 rutas» y recorría 41. Ahora recorre el CRUD de los
cinco catálogos que faltaba y **termina exigiéndolo**: le pregunta a Express qué
rutas tiene registradas y falla si alguna no pasó por su ayudante `ruta()`.
Comprobado dejando una fuera a propósito: la prueba cae y la nombra. Lleva
además una guarda contra volverse vacía —exige ver más de 50 rutas—, porque el
día que Nest cambie dónde guarda esa pila, una lista vacía pasaría el filtro sin
comprobar nada.

La ronda «ramas de reserva» no salió de perseguir el porcentaje —ya estaba en
96 %— sino de preguntarle a cada comentario del código si alguien afirmaba lo
que promete. Salieron tres, las tres con la misma forma: **el camino que sólo
corre cuando algo va mal, cuando alguien se olvida o sólo en producción, era el
que no tenía prueba.**

1. **La reserva del interceptor de auditoría** —la que corre si un servicio no
   llamó a `auditar()`, y que la §4 justifica porque «tarde o temprano falta un
   registro»— escribía `entidad = 'api'` para TODA ruta del sistema:
   `setGlobalPrefix('api')` hace que el primer tramo sea siempre el prefijo.
   Latente, no activo —los doce módulos con mutaciones sí auditan, y la base no
   tenía ni una fila con `'api'`—, pero rota justo para el día en que sirviera.
2. **`configurarProxyDeConfianza`** no se ejercitaba: el fichero de pruebas
   montaba Express repitiendo su `app.set` a mano. Cambiar la lista por `true`
   —lo que el propio código prohíbe, y que deja falsificar la IP de la bitácora
   y esquivar el freno por IP del login— dejaba **373 pruebas en verde**. El
   arreglo no fue añadir pruebas sino quitar la duplicación: ahora pasan por la
   función de producción.
3. **Vaciar un campo con `null` en los catálogos**, que es el motivo declarado
   de no usar `coalesce`, no lo afirmaba nadie. Estaba probada la mitad
   conservadora —el PATCH vacío— y no la que justifica el diseño.

Las tres se validaron por mutación: con los tres fallos inyectados a la vez
caen 12 pruebas, y cada grupo lo caza el suyo.

La subida de «plan de carga» salió de auditar el acumulado
`detalles_orden.volumen_planificado`: lo escriben dos métodos y lo lee la regla
4 del §16, y **ninguna prueba afirmaba su valor**. Las diez de
`agregarLineaPlan` eran todas casos de rechazo, y el cuerpo de
`quitarLineaPlan` no llegaba a ejecutarse en ninguna —su única prueba aceptaba
`[200, 409]` sobre un viaje ya autorizado, donde el guard responde 409 siempre
y el resto del método nunca corre—. Se midió cuán ciego era el hueco cambiando
el `-` de la devolución por un `+`: **58 pruebas verdes con el fallo dentro**.
Al escribirlas apareció además una carrera que ninguna de las dos capas
cerraba, y de ahí sale `ck_detalles_planificado_cabe`.

Lo que cerró las funciones fue `api-superficie.integracion.ts`, que recorre las
64 rutas: las de servicio no tocan los controladores, así que sus métodos
figuraban sin cubrir aunque la lógica de debajo estuviera probada. Y lo que
cerró las ramas fue probar los VALORES POR DEFECTO de `configuration.ts` —cada
`||` es una decisión sobre qué pasa cuando falta una variable, que es el
escenario de un despliegue nuevo—.

**La regla de uso: cuando la cobertura suba, súbelo.** Nunca al revés. Bajarlo
para que pase un commit es exactamente el fallo que el trinquete existe para
impedir, y si algún día hay que hacerlo, que sea una decisión escrita y no un
`-1` en un fichero.

## Por qué antes decía 9 %

`test:cov` medía sólo `--config test/jest.unit.json`, y las pruebas de
integración iban aparte. Peor: esas pruebas no tenían `collectCoverageFrom`, así
que Jest sólo instrumentaba los ficheros que ellas importaban —siete sentencias
en total— y su informe decía **100 %**. Dos números, los dos ciertos y los dos
inútiles: uno demasiado bajo porque le faltaba media suite, otro perfecto porque
medía casi nada.

## Qué queda fuera de la medida a propósito

Los DTO y las entidades. Son declaraciones con decoradores: cubrirlos sube el
porcentaje sin comprobar ni una regla, que es la forma más rápida de convertir
la cobertura en un número que no significa nada. También quedan fuera las
migraciones y las semillas, que se verifican ejecutándolas (`migration:revert`
en CI), no midiéndolas.
