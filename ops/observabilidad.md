# Observabilidad

Autoalojada, en esta misma máquina. Se eligió **Grafana + Loki + Prometheus**
sobre Sentry + Better Stack porque los registros llevan correos, IPs y cuerpos
de error, y mandarlos a un tercero es una decisión que este sistema no necesita
tomar. Cuesta unos **400 MB** de RAM.

```bash
cd /home/app/fleetfuel
sg docker -c "docker compose -f docker-compose.observabilidad.yml \
  --env-file .env.observabilidad up -d"
```

**Grafana: <http://10.0.0.193:3400>** · usuario y clave en `.env.observabilidad`.

Es el **único puerto publicado** del stack. Loki y Prometheus sólo se alcanzan
por la red interna: publicar un Loki sin autenticación es abrir a la LAN todos
los registros del sistema. Grafana no pasa por el proxy inverso ni está en
internet — es una consola de administración, no un sitio.

## Qué recoge

| Pieza | Qué aporta |
|---|---|
| **Promtail** | Los registros de **todos** los contenedores, por descubrimiento de Docker. Uno nuevo aparece solo. |
| **Loki** | Los guarda 30 días y los deja consultar. |
| **Prometheus** | Métricas de la máquina cada 30 s, 30 días o 2 GB. |
| **node-exporter** | CPU, memoria, disco y carga del anfitrión. |

El panel **FleetFuel · visión general** viene aprovisionado por fichero, no
creado a mano: un panel hecho en la interfaz vive sólo en el volumen de Grafana
y se pierde al recrear el contenedor.

## El registro de peticiones

Cada petición HTTP produce una línea JSON. Antes no producía ninguna: había 214
líneas de log en producción, todas de arranque.

```json
{"ts":"…","nivel":"aviso","tipo":"peticion","idPeticion":"…","metodo":"POST",
 "ruta":"/api/auth/login","consulta":[],"estado":401,"ms":33.2,"ip":"10.0.0.193"}
```

- **`idPeticion`** vuelve al cliente en la cabecera `X-Request-Id`. Es lo que
  pega una queja concreta («me dio error a las 10:03») con su línea, sin
  buscar por hora.
- **El cuerpo no se registra nunca.** `POST /auth/login` lleva la clave y el
  código TOTP en el suyo.
- De la cadena de consulta van sólo las **claves**, no los valores.
- Lo genera un *middleware*, no un interceptor: si un guard rechaza —el 401 del
  JWT, el 429 del freno— la excepción sube y el interceptor no llega a correr.
  Justo el tráfico que más interesa sería el único invisible.

## Consultas que se usan de verdad

```logql
# Todo lo que ha ido mal en producción
{tipo="peticion", nivel="error", entorno="fleetfuel-prod"}

# Seguir una petición concreta por su id
{tipo="peticion"} | json | idPeticion="4094c602-…"

# ¿Está alguien atacando el login? Un 429 significa que el freno mordió
{tipo="peticion"} | json | ruta="/api/auth/login" | estado=429

# Las rutas más lentas de la última hora
topk(10, quantile_over_time(0.95, {tipo="peticion"} | json | unwrap ms [1h]) by (ruta))
```

**Sólo `contenedor`, `entorno`, `servicio`, `nivel` y `tipo` son etiquetas.**
`ruta`, `estado`, `ms` e `idPeticion` viven dentro del JSON y se filtran al
consultar. Loki guarda una serie por combinación de etiquetas: etiquetar por
`ruta` parece cómodo y lo revienta, porque con IDs en la URL las rutas son
infinitas.

## Lo que este stack NO da

**Memoria y CPU por contenedor.** cAdvisor es incompatible con el Docker de
esta máquina: busca la capa de escritura de cada contenedor en el layout del
driver `overlay2` y Docker 29 usa el del snapshotter, así que falla al *crear*
el contenedor —no al medirlo— y ni `--disable_metrics` ni `DOCKER_API_VERSION`
lo esquivan. Se probó con v0.49.1 y con v0.52.1.

El resultado no era «sin datos», que se nota, sino métricas correctas
etiquetadas `/system.slice/docker-<sha256>.scope`: paneles que pintan algo y no
dicen nada. Por eso se quitó en vez de dejarlo.

Se pierde el «cuál de los contenedores»; no se pierde el «cuánta memoria queda
en la máquina», que es la pregunta que de verdad importa aquí. Para el «cuál»,
`docker stats` sigue respondiendo en el momento. Revisar cuando cAdvisor
soporte el snapshotter de Docker.

**Un canal por donde te lleguen las alertas.** Ver más abajo.

## Si el disco empieza a crecer

Los dos guardan 30 días. Prometheus además tiene tope duro de 2 GB. Loki no
tiene tope de tamaño, sólo de tiempo:

```bash
sg docker -c "docker system df -v" | grep obs_
```

Para acortar la retención, `limits_config.retention_period` en
`ops/observabilidad/loki.yml`. **`compactor.retention_enabled` tiene que seguir
en `true`**: sin eso la retención marca pero no borra, y el disco se llena
meses después de dar el asunto por resuelto.

## Alertas

Ocho reglas, aprovisionadas por fichero en
`ops/observabilidad/grafana/alertas/reglas.yml`. Se evalúan cada minuto; lo que
evita el ruido no es el intervalo sino la **espera** de cada una: una alerta que
salta con un pico de un minuto se aprende a ignorar, y una alerta que se ignora
no es una alerta.

| Alerta | Salta cuando | Espera |
|---|---|---|
| **Producción no responde** | la sonda contra `fleetfuel.jop.lat` falla | 3 min |
| **Un entorno interno no responde** | desarrollo o prueba caídos | 5 min |
| **El certificado TLS caduca pronto** | quedan menos de 21 días | 1 h |
| **El respaldo no termina bien** | más de 26 h del último verificado | 10 min |
| **El disco raíz se está llenando** | por encima del 85 % | 15 min |
| **Queda poca memoria** | menos del 10 % disponible | 15 min |
| **5xx en producción** | más de 5 en 10 minutos | 5 min |
| **El freno del login está mordiendo** | más de 20 respuestas 429 en 10 minutos | 5 min |

Cada una lleva en su descripción el comando concreto por donde empezar a mirar.

### Las tres decisiones que no son obvias

**Las sondas van desde fuera, por la misma URL que usa un usuario.** Recorren la
cadena entera —DNS, proxy, TLS, cortafuegos, aplicación— y por eso ven lo que
ningún healthcheck interno ve: la mañana del 2026-09-06 el backend estaba sano y
el sitio colgado, porque la regla del cortafuegos se comía las respuestas del
proxy. Un healthcheck que pregunta «¿estoy vivo?» habría dicho que sí.

Producción se sondea **sólo** por su URL pública. Sus puertos 4200/3200 están
cerrados a todo lo que no sea el proxy, así que sondearlos directo daría un
fallo permanente y falso.

**El respaldo afirma su éxito; no se busca la ausencia de un error.** Vigilar un
trabajo por lotes buscando que no aparezca un error en los registros falla en
tres casos que parecen iguales: que el trabajo falle, que el timer esté parado y
que la máquina estuviera caída a esa hora. Por eso `respaldo-postgres.sh`
escribe `fleetfuel_respaldo_ultimo_exito_timestamp` en
`~/respaldos/metricas/respaldo.prom`, que node-exporter publica por su colector
*textfile*. La alerta pregunta «¿cuánto hace del último respaldo **bueno**?» —
una afirmación positiva, que sólo puede envejecer. Se escribe con `mv` porque
node-exporter lee ese directorio en cada raspado y un fichero a medio escribir
daría una métrica truncada.

**«Sin datos» es alerta en dos reglas, no silencio.** En «Producción no
responde» y en «El respaldo no termina bien», que Prometheus deje de recibir la
métrica no significa que todo vaya bien: significa que no lo sabemos. Y «no lo
sabemos» sobre si el sitio está en pie no puede pasar por «bien». En las demás,
sin datos se trata como normal para no despertar a nadie porque un raspado se
saltó.

### Por dónde salen: ntfy autoalojado

**<http://10.0.0.193:3450>**, tema en `NTFY_TEMA` de `.env.observabilidad`.

Se suscribe uno desde el navegador o desde la app de ntfy (Android/iOS) apuntando
a ese servidor y ese tema. Los mensajes se guardan 72 h, así que un móvil apagado
los recibe al volver: una alerta de madrugada no se pierde.

Se eligió autoalojado por lo mismo que la observabilidad entera —el texto de una
alerta dice qué sistema es y qué le pasa— y porque los tipos de contacto nativos
de Grafana que llegan a un móvil (Telegram, Discord, Slack, Pushover) son todos
de terceros, y el de correo necesita un SMTP que este sistema no tiene.

**El servidor no pide credenciales.** Es aceptable porque sólo está en la LAN y
el tema lleva un sufijo aleatorio. Si algún día se publica por el proxy, hay que
activar `auth-file` y `auth-default-access: deny-all` en `ntfy.yml`.

### Las treinta líneas que hay en medio

`ops/observabilidad/aviso/` traduce el aviso de Grafana a una notificación
legible. Existe porque **Grafana no deja dar forma al cuerpo de un webhook**:
manda siempre su JSON completo, y ntfy toma el cuerpo tal cual. Conectados
directamente, al móvil llegaba esto —medido antes de escribir el traductor—:

    {"receiver":"ntfy","status":"firing","alerts":[{"status":"firing",…

Ahora llega un título, un cuerpo de una a cinco líneas y una prioridad: **5 para
las críticas** —suena aunque el móvil esté en silencio—, 3 para los avisos y 2
para las resoluciones, que nunca despiertan a nadie.

Si ntfy falla, el traductor responde error a Grafana para que reintente y quede
en SU registro. Una alerta que no sale no puede desaparecer en silencio, que es
justo lo que este canal existe para impedir.

**Publica con el tema dentro de un cuerpo JSON**, no con las cabeceras
`Title`/`Priority`/`Tags` que ntfy también acepta. La primera versión usaba las
cabeceras y seis de las ocho alertas que había entonces llegaban con el título roto:

    «Producci<?>n no responde»

Los valores de cabecera HTTP no son UTF-8: Node los emite como bytes latin-1,
ntfy los lee como UTF-8 y sustituye lo que no puede descodificar. Lo peor no es
el destrozo sino que **ntfy respondía 200**, así que Grafana daba el envío por
bueno y no había nada que mirar en ningún registro; sólo se veía en la pantalla
del móvil. El cuerpo sí es UTF-8 por definición.

Se encontró porque la alerta que se usó para probar el canal —«Un entorno
interno no responde»— es una de las dos únicas sin tilde. Una prueba que pasa
por el único caso sano no prueba nada, así que antes de darlo por bueno se
mandó un título con tildes a propósito.

### Cómo se prueba todo esto

    node --test ops/observabilidad/aviso/servidor.test.mjs ops/observabilidad/reglas.test.mjs

24 pruebas, sin dependencias —el runner que trae Node— y en menos de medio
segundo. Corren en CI en el trabajo `observabilidad`, con un trinquete de
cobertura del 90 % de líneas y 85 % de ramas sobre lo medido (98 % y 92 %).

Hasta el 2026-09-06 `ops/` era el único código del repositorio fuera de todo
informe de cobertura: 690 líneas cuyo 0 % no aparecía en ningún porcentaje y por
tanto no se echaba de menos. El traductor se desplegó sin una sola prueba y con
el fallo del UTF-8 dentro.

Las de `servidor.test.mjs` cubren lo que sólo ocurre cuando algo va mal, que es
donde vive el traductor entero: resolución, grupos de más de cinco, alertas sin
`summary`, cuerpos que no son JSON, y ntfy devolviendo error —donde lo que se
afirma es que el traductor responde 502 y NO 204, para que Grafana reintente en
vez de dar el aviso por entregado.

`reglas.test.mjs` ata las reglas al traductor: que sigan siendo nueve —añadir
una hace fallar la prueba a propósito, que es el aviso de que hay una alerta que
nadie ha mirado—, que toda `severidad` declarada
sea una que sepa leer, que ninguna regla se quede sin `summary` ni
`description`, que los títulos reales con tilde sobrevivan el viaje, y que el
punto de contacto siga apuntando al traductor y no directo a ntfy.

**Una severidad que el traductor no reconoce escala a crítica**, no cae a aviso.
Ante una etiqueta ilegible los dos errores no cuestan lo mismo: escalar de más
molesta una vez; escalar de menos silencia una caída.

### Agrupación

Se agrupa por `alertname` y `severidad`, con 30 s de espera, 5 min entre avisos
del mismo grupo y 4 h antes de repetir algo que sigue igual. Repetir cada minuto
es cómo se consigue que alguien silencie el canal — y un canal silenciado es
peor que no tenerlo, porque parece que está.
