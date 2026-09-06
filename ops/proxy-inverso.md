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
| Domain Names | `10.0.0.19` | Sirve tal cual, sin DNS: el navegador manda `Host: 10.0.0.19` y NPM lo usa como `server_name`. Cuando haya dominio interno, se añade aquí. |
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

### Pestaña «SSL» — pendiente

Let's Encrypt **no es posible hoy**: `10.0.0.19` es una IP privada sin dominio
público, y la validación de LE exige un nombre resoluble desde Internet. Queda
abierto: o un dominio interno con certificado propio de la Alcaldía, o un
certificado autofirmado (que hace que cada navegador muestre un aviso).

Mientras no haya TLS, las credenciales viajan en claro por la LAN municipal.
Es una limitación conocida, no un descuido.

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

Se cierra con un cortafuegos que solo deje pasar al proxy. Requiere `sudo`, así
que lo tiene que correr una persona:

    sudo ufw allow from 10.0.0.19 to any port 3200 proto tcp comment 'FleetFuel prod frontend <- NPM'
    sudo ufw allow from 10.0.0.19 to any port 4200 proto tcp comment 'FleetFuel prod API <- NPM'
    sudo ufw deny 3200/tcp
    sudo ufw deny 4200/tcp

> Antes de activar `ufw` por primera vez en esta máquina: **permitir SSH**
> (`sudo ufw allow 22/tcp`). Activarlo sin esa regla deja la máquina
> inaccesible. Y ojo con no cerrar los puertos de desarrollo (3100, 4100,
> 5433), que se usan desde la propia máquina.

## Cómo se comprueba

Con el nginx de prueba, sin tocar NPM:

    sg docker -c "docker run -d --name fleetfuel_proxy_prueba --network host \
      -v /home/app/fleetfuel/ops/nginx-fleetfuel.conf:/etc/nginx/conf.d/default.conf:ro \
      nginx:alpine"

    curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8081/entrar   # 200
    curl -s http://localhost:8081/api/salud                                 # {"estado":"ok",...}

Contra NPM ya configurado, lo mismo sobre `http://10.0.0.19`.

## Lo que no he verificado

No tengo credenciales de NPM, así que **la configuración de la interfaz de
10.0.0.19 no está aplicada ni probada**: lo de arriba es la especificación de
lo que hay que crear. Lo que sí está probado de extremo a extremo es el
enrutado —con el nginx desechable— y el comportamiento del backend.
