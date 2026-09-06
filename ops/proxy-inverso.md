# Proxy inverso de FleetFuel Control

**Decisión (2026-09-06): un solo origen.** El frontend en `/` y la API en
`/api` bajo el mismo nombre de host.

El proxy es el **Nginx Proxy Manager** que ya corre en `10.0.0.19` (openresty;
su interfaz de administración está en `http://10.0.0.19:81`). Este documento
dice qué hay que configurar allí; `nginx-fleetfuel.conf`, al lado, es la misma
configuración en nginx puro y sirve para probarla sin tocar NPM.

## Por qué un solo origen y no `app.*` + `api.*`

`NEXT_PUBLIC_API_URL` **se hornea en el bundle del navegador** en tiempo de
compilación: no es una variable del servidor, viaja dentro del JavaScript que
descarga cada usuario. Mientras valía `http://10.0.0.193:4200/api`, poner un
proxy delante del frontend habría sido decorativo — el navegador seguiría
llamando al puerto 4200 directamente, y la clave y el código MFA viajarían en
claro por la LAN, sin TLS y sin pasar por ningún límite de peticiones.

Ahora vale `/api`, relativa. Consecuencias:

- El navegador nunca conoce el 4200. Todo entra por el proxy.
- No hay CORS: es el mismo origen, así que tampoco hay `preflight` OPTIONS en
  los `PATCH` y `DELETE`.
- El bundle deja de llevar una IP dentro: el mismo build sirve para
  `10.0.0.19`, para un dominio futuro o para `localhost`, sin recompilar.

**Cambiarla exige reconstruir la imagen del frontend**, no basta con reiniciar:

    sg docker -c "docker compose -f docker-compose.produccion.yml \
      --env-file .env.produccion build frontend && \
      docker compose -f docker-compose.produccion.yml \
      --env-file .env.produccion up -d frontend"

## Qué crear en NPM

`http://10.0.0.19:81` → **Hosts → Proxy Hosts → Add Proxy Host**

### Pestaña «Details»

| Campo | Valor | Por qué |
|---|---|---|
| Domain Names | `fleetfuel.jop.lat` | Ya resuelve: `jop.lat` está en Cloudflare con un comodín `*.jop.lat` apuntando a 10.0.0.19. No hay que crear ningún registro. |
| Scheme | `http` | El tramo proxy→aplicación va por la LAN sin cifrar; el TLS termina en NPM. |
| Forward Hostname / IP | `10.0.0.193` | |
| Forward Port | `3200` | El **frontend**. La API entra por Custom Location. |
| Cache Assets | **DESACTIVADO** | Ver el aviso de abajo. |
| Block Common Exploits | activado | |
| Websockets Support | activado | Hoy no hay ninguno, pero la Fase 2 trae chat y seguimiento en vivo. |

> ⚠ **`Cache Assets` no se activa nunca sobre la API.** Las respuestas son
> datos por empresa. Una respuesta cacheada servida a otra operadora es una
> fuga entre empresas que el RLS de Postgres **no puede impedir**, porque la
> consulta nunca llega a la base de datos.

### Pestaña «Custom locations»

Una sola, y es la que hace que `/api` signifique algo:

| Campo | Valor |
|---|---|
| location | `/api` |
| Scheme | `http` |
| Forward Hostname / IP | `10.0.0.193` |
| Forward Port | `4200` |

> El backend usa `setGlobalPrefix('api')`, así que **espera recibir el `/api`
> incluido**. NPM genera un `proxy_pass` sin ruta, que conserva el URI
> completo, y eso es lo correcto. Si alguien lo cambiara a
> `proxy_pass http://10.0.0.193:4200/`, nginx recortaría el prefijo, el backend
> recibiría `/salud` en vez de `/api/salud` y **todo** devolvería 404.
>
> Comprobación: `curl http://10.0.0.19/api/salud` tiene que devolver el JSON
> con `"estado":"ok"`, no un 404.

### Pestaña «SSL» — resuelta

**Hay un comodín `*.jop.lat` de Let's Encrypt ya instalado en este NPM**, válido
del 10 de agosto al 8 de noviembre de 2026, y `https://proxy.jop.lat` responde
con la cadena verificada. `fleetfuel.jop.lat` queda cubierto por el comodín sin
emitir nada.

> Yo mismo había dado Let's Encrypt por imposible aquí, razonando que una IP
> privada no es alcanzable desde Internet. Eso solo vale para el reto
> **HTTP-01**, donde LE se conecta al servidor. El comodín se emitió por
> **DNS-01**, que únicamente comprueba un registro TXT contra los servidores
> autoritativos y nunca visita la máquina: a LE le da igual que el registro A
> apunte a 10.0.0.19.

Se selecciona ese certificado y se activa **Force SSL** (redirige `http` a
`https`; sin eso el puerto 80 seguiría sirviendo en claro) y **HTTP/2**.

**HSTS queda apagado a propósito.** Le diría al navegador «para este nombre,
solo https, durante meses», y esa orden se queda pegada en el cliente: si el
certificado caduca o hay que depurar en claro, no se puede deshacer desde el
servidor. Se enciende cuando esto lleve tiempo estable.

## La IP real en la auditoría

Ya está resuelto en el backend y **verificado**:

- `.env.produccion` → `PROXIES_DE_CONFIANZA=10.0.0.19`
- El arranque lo confirma en el log: *«Proxies de confianza: 10.0.0.19 — se
  leerá X-Forwarded-For de ellos»*.
- `backend/src/config/proxy-de-confianza.spec.ts` fija el comportamiento, y en
  particular que un socket `::ffff:10.0.0.19` (que es como Node entrega las
  IPv4, mapeadas en IPv6) sí coincide con el `10.0.0.19` de la lista.

Nunca se pone `trust proxy: true`: con eso, cualquier cliente podría falsificar
su propia IP en la auditoría con una cabecera inventada, que es peor que no
registrarla.

**Si algún día el proxy cambia de máquina, hay que actualizar esa variable.**
El síntoma de olvidarlo es silencioso: todo funciona y la auditoría registra la
IP del proxy en cada inicio de sesión.

## La puerta trasera que sigue abierta

Hoy `3200` y `4200` escuchan en `0.0.0.0`, porque el proxy vive en otra máquina
y tiene que alcanzarlos. Eso significa que **cualquiera en la LAN puede llamar
a la API directamente** por el 4200 y saltarse el proxy entero: sin TLS y sin
el límite de peticiones.

Se cierra con `ops/cerrar-puertos-produccion.sh`, que requiere `sudo` y por
tanto lo corre una persona:

    sudo ./ops/cerrar-puertos-produccion.sh --revisar   # mirar antes
    sudo ./ops/cerrar-puertos-produccion.sh             # aplicar
    sudo ./ops/cerrar-puertos-produccion.sh --quitar    # deshacer

> ⚠ **`sudo ufw deny 4200` no sirve, y encima lo parece.** Docker mete sus
> reglas de DNAT en `PREROUTING` y el tráfico hacia un contenedor va por
> `FORWARD`, mientras ufw trabaja en `INPUT`: el puerto seguiría abierto a toda
> la LAN mientras `ufw status` dice que está denegado. El enganche que Docker
> respeta es la cadena `DOCKER-USER`.
>
> Y dentro de `DOCKER-USER` el DNAT **ya ocurrió**, así que el puerto de
> destino del paquete es el del contenedor (4100), no el publicado (4200). Por
> eso el script empareja con `conntrack --ctorigdstport`, que mira el destino
> original de la conexión; con `--dport 4200` la regla no casaría con nada.

El script no activa ufw, no cambia políticas por defecto y no toca los puertos
de desarrollo (3100, 4100, 5433, 6380) ni la consola del 8000, que se usan
desde la LAN. Afecta exactamente a dos puertos, y es reversible.

**iptables no sobrevive a un reinicio.** Para que persista:

    sudo cp ops/fleetfuel-cortafuegos.service /etc/systemd/system/
    sudo systemctl daemon-reload
    sudo systemctl enable --now fleetfuel-cortafuegos

La comprobación real hay que hacerla **desde otra máquina de la LAN**, no desde
esta: el tráfico que nace aquí no pasa por `FORWARD` y no se ve afectado.

    curl -m 5 http://10.0.0.193:4200/api/salud    # debe agotar el tiempo

## Cómo se comprueba

Con el nginx de prueba, sin tocar NPM:

    sg docker -c "docker run -d --name fleetfuel_proxy_prueba --network host \
      -v /home/app/fleetfuel/ops/nginx-fleetfuel.conf:/etc/nginx/conf.d/default.conf:ro \
      nginx:alpine"

    curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8081/entrar   # 200
    curl -s http://localhost:8081/api/salud                                 # {"estado":"ok",...}

Contra NPM ya configurado, sobre `https://fleetfuel.jop.lat`. Y que el puerto
80 redirija: `curl -sI http://fleetfuel.jop.lat/entrar` debe dar `301`.

## El límite del login

`rate=10r/m`, `burst=30 nodelay`, respuesta `429`. Ráfaga generosa y ritmo
corto, porque el pico legítimo (entrar, teclear mal el TOTP que rota cada 30
segundos, reintentar, recargar — y varios usuarios tras un mismo NAT contados
como **una** dirección) tiene forma de ráfaga, mientras que el ataque tiene
forma de ritmo sostenido.

Con pocos usuarios, `burst=30` sobra: bajarlo a 10 no molestaría a nadie y
regalaría menos intentos. Pendiente de decidir.

Importa porque `POST /auth/login` lleva **los dos factores** en el mismo
cuerpo, y no hay nada más detrás: ni `@nestjs/throttler`, ni bloqueo por
intentos, ni marca de código ya usado en el `authenticator.check` de otplib.

Probado: 40 peticiones seguidas dan 32 pasos y 429 el resto, sin afectar a
`/api/salud` ni a `/entrar`. Si 30 se queda corto en el pico real, se sube el
**burst**, no el rate.

`/auth/refrescar` queda fuera a propósito: cada sesión lo llama cada 15
minutos, un límite ahí no para a nadie y expulsaría a la gente a media jornada.

## Automatizado

`ops/npm-configurar.sh` hace por la API de NPM lo mismo que la tabla de arriba
a mano, sin duplicar el host si ya existe. Pide las credenciales sin eco y no
las guarda. El `limit_req_zone` sigue siendo manual —va en contexto http y la
API de NPM no lo expone—; el propio script imprime el comando al terminar.

## Lo que no he verificado

No tengo credenciales de NPM, así que **la configuración de la interfaz de
10.0.0.19 no está aplicada ni probada**: lo de arriba es la especificación de
lo que hay que crear. Lo que sí está probado de extremo a extremo es el
enrutado —con el nginx desechable— y el comportamiento del backend.
