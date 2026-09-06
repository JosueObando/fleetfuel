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

**Alertas.** Grafana las trae y no hay ninguna configurada. Los dos primeros
candidatos, cuando haga falta: disco raíz por encima del 85 % y 5xx sostenidos
en producción.

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
