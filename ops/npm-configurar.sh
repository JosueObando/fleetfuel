#!/usr/bin/env bash
#
# Crea en el Nginx Proxy Manager de 10.0.0.19 el host de FleetFuel con la
# topologia de UN SOLO ORIGEN: "/" al frontend y "/api" al backend.
#
#   ./ops/npm-configurar.sh                      # pide el correo y la clave
#   NPM_USUARIO=... NPM_CLAVE=... ./ops/npm-configurar.sh
#   ./ops/npm-configurar.sh --revisar            # solo listar lo que ya hay
#
# Hace por API lo mismo que se haria a mano en http://10.0.0.19:81. La clave se
# lee sin eco y no se escribe en ningun sitio: ni en disco, ni en el historial
# —por eso se pide en vez de pasarla como argumento—.
#
# ORDEN IMPORTANTE. El limit_req del login usa una zona declarada en contexto
# http, que la API de NPM no expone: hay que crearla A MANO en el CT, ANTES de
# crear el host. Si se crea el host primero, nginx no conoce la zona, la
# configuracion es invalida y el reload FALLA. Los demas hosts siguen sirviendo
# con lo que ya tienen en memoria... hasta que alguien reinicie el contenedor:
# entonces nginx no arranca y se caen TODOS.
#
# Si no hay acceso al CT para crear la zona, usar SIN_LIMITE=1: crea el host sin
# el freno del login, que es seguro de aplicar, y el limite se anade despues.
#
#   SIN_LIMITE=1 ./ops/npm-configurar.sh

set -euo pipefail

NPM=http://10.0.0.19:81

# fleetfuel.jop.lat y no la IP pelada: jop.lat es un dominio real en Cloudflare
# y ya tiene un comodin *.jop.lat de Let's Encrypt instalado en este NPM, asi
# que este nombre YA resuelve y YA esta cubierto. Cero DNS, cero emision, y las
# credenciales dejan de viajar en claro por la LAN.
#
# (El reto HTTP-01 no serviria aqui —LE no puede alcanzar una IP privada—, pero
# el certificado existente se emitio por DNS-01, que solo mira un TXT en el DNS
# y nunca se conecta al servidor.)
DOMINIO=${DOMINIO:-fleetfuel.jop.lat}
APP=10.0.0.193
PUERTO_FRONTEND=3200
PUERTO_API=4200

command -v jq >/dev/null || { echo "Hace falta jq: sudo apt install jq" >&2; exit 1; }

# Vacio = sin limit_req. Es el valor SEGURO por defecto para un NPM donde la
# zona todavia no se ha declarado.
if [[ ${1:-} == --quitar-limite || ${1:-} == --revisar ]]; then
  LIMITE=""
elif [[ ${SIN_LIMITE:-} == 1 ]]; then
  LIMITE=""
  echo "SIN_LIMITE=1: el host se crea sin el freno del login."
  echo "  Recuerda anadirlo despues, cuando la zona exista."
else
  LIMITE=$'limit_req zone=login burst=10 nodelay;\nlimit_req_status 429;'
  echo "El host llevara limit_req, que necesita la zona 'login' declarada DENTRO"
  echo "del CT 10.0.0.19. NO en esta maquina: aqui esos comandos no hacen nada."
  echo
  echo "  ssh root@10.0.0.19  ->  grep -r limit_req_zone /data/nginx/custom/"
  echo
  echo "Si no la has creado ALLI, corta con Ctrl-C y usa SIN_LIMITE=1."
  echo "Si sigues sin la zona, el host se creara pero NPM no podra cargarlo."
  echo
  read -rp "Confirmas que la zona existe en 10.0.0.19? [s/N] " r
  [[ $r == [sS] ]] || { echo "Cancelado."; exit 1; }
fi

leer_credenciales() {
  : "${NPM_USUARIO:=}" "${NPM_CLAVE:=}"
  [[ -n $NPM_USUARIO ]] || read -rp "Correo de NPM: " NPM_USUARIO
  [[ -n $NPM_CLAVE ]] || { read -rsp "Clave de NPM: " NPM_CLAVE; echo; }
}

autenticar() {
  local r
  r=$(curl -sS -X POST "$NPM/api/tokens" -H 'Content-Type: application/json' \
        -d "$(jq -nc --arg i "$NPM_USUARIO" --arg s "$NPM_CLAVE" \
              '{identity:$i, secret:$s}')")
  TOKEN=$(jq -r '.token // empty' <<<"$r")
  [[ -n $TOKEN ]] || { echo "No autenticado: $r" >&2; exit 1; }
}

api() { curl -sS -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' "$@"; }

leer_credenciales
autenticar

# Repara un host que se creo con limit_req antes de que la zona existiera:
# le quita el advanced_config, con lo que la configuracion vuelve a ser valida
# y NPM la carga. No borra el host ni toca nada mas.
if [[ ${1:-} == --quitar-limite ]]; then
  H=$(api "$NPM/api/nginx/proxy-hosts" | jq -c --arg d "$DOMINIO" \
        'map(select(.domain_names|index($d)))|.[0] // empty')
  [[ -n $H ]] || { echo "No hay ningun host para $DOMINIO." >&2; exit 1; }
  ID=$(jq -r '.id' <<<"$H")

  # Se reenvia el objeto entero sin los campos de solo lectura, con el
  # advanced_config de cada location vaciado.
  # `b` normaliza los booleanos: NPM los guarda como tinyint y, segun version,
  # puede devolverlos como 0/1. El esquema del PUT espera booleanos, asi que
  # reenviar el 1 tal cual se llevaria un 400 por un detalle invisible.
  NUEVO=$(jq -c 'def b: if type=="number" then . != 0 else . end;
  {
    domain_names, forward_scheme, forward_host, forward_port,
    access_list_id, certificate_id,
    caching_enabled:         (.caching_enabled|b),
    block_exploits:          (.block_exploits|b),
    allow_websocket_upgrade: (.allow_websocket_upgrade|b),
    ssl_forced:              (.ssl_forced|b),
    http2_support:           (.http2_support|b),
    hsts_enabled:            (.hsts_enabled|b),
    hsts_subdomains:         (.hsts_subdomains|b),
    advanced_config: "",
    locations: [ .locations[] | .advanced_config = "" ],
    meta
  }' <<<"$H")

  R=$(api -X PUT "$NPM/api/nginx/proxy-hosts/$ID" -d "$NUEVO")
  jq -e '.id' >/dev/null <<<"$R" \
    || { echo "No se pudo actualizar: $R" >&2; exit 1; }
  echo "Host $ID ($DOMINIO): limit_req retirado. NPM deberia cargarlo ya."
  echo "Comprueba:  curl -s https://$DOMINIO/api/salud"
  exit 0
fi

if [[ ${1:-} == --revisar ]]; then
  echo "Hosts que ya existen en NPM:"
  api "$NPM/api/nginx/proxy-hosts" \
    | jq -r '.[] | "  id=\(.id)  \(.domain_names|join(","))  ->  \(.forward_host):\(.forward_port)  locations=\(.locations|length)  ssl=\(if .certificate_id > 0 then "si" else "no" end)"'
  echo
  echo "Certificados disponibles:"
  api "$NPM/api/nginx/certificates" \
    | jq -r '.[] | "  id=\(.id)  \(.domain_names|join(","))  vence \(.expires_on)"'
  exit 0
fi

# Busca un certificado que cubra el dominio: o lo nombra exacto, o es un
# comodin del padre. Sin esto habria que copiar el id a mano y el paso mas
# facil de olvidar seria justo el que deja el trafico sin cifrar.
PADRE=${DOMINIO#*.}
CERT=$(api "$NPM/api/nginx/certificates" | jq -r --arg d "$DOMINIO" --arg p "$PADRE" '
  map(select(
    (.domain_names | index($d)) != null or
    (.domain_names | map(select(startswith("*."))) | map(.[2:]) | index($p)) != null
  )) | .[0].id // 0')

if [[ $CERT == 0 ]]; then
  echo "AVISO: ningun certificado cubre $DOMINIO. Se crea SIN TLS." >&2
  echo "       Las credenciales viajarian en claro. Revisa --revisar." >&2
  SSL=false
else
  echo "Certificado encontrado (id=$CERT): se activa TLS y se fuerza HTTPS."
  SSL=true
fi

# Si ya existe un host para este dominio, no se duplica: NPM lo aceptaria y
# nginx se quedaria con uno de los dos server_name repetidos, sin decir cual.
EXISTE=$(api "$NPM/api/nginx/proxy-hosts" \
  | jq -r --arg d "$DOMINIO" 'map(select(.domain_names|index($d)))|.[0].id // empty')
[[ -z $EXISTE ]] || {
  echo "Ya hay un host para '$DOMINIO' (id=$EXISTE). Revisalo o borralo antes." >&2
  exit 1
}

CUERPO=$(jq -nc \
  --arg d "$DOMINIO" --arg h "$APP" \
  --argjson pf "$PUERTO_FRONTEND" --argjson pa "$PUERTO_API" \
  --argjson cert "$CERT" --argjson ssl "$SSL" --arg lim "$LIMITE" '{
  domain_names: [$d],
  forward_scheme: "http",
  forward_host: $h,
  forward_port: $pf,

  # DESACTIVADO a proposito. Las respuestas son datos por empresa: una cacheada
  # y servida a otra operadora es una fuga que el RLS de Postgres no puede
  # impedir, porque la consulta nunca llega a la base de datos.
  caching_enabled: false,

  block_exploits: true,
  # Hoy no hay ninguno, pero la Fase 2 trae chat y seguimiento en vivo. Sin
  # esto nginx corta el Upgrade y la conexion se cae en silencio.
  allow_websocket_upgrade: true,

  access_list_id: 0,
  certificate_id: $cert,
  # ssl_forced redirige http -> https. Sin esto el puerto 80 seguiria sirviendo
  # la aplicacion en claro y bastaria teclear la direccion sin "s".
  ssl_forced: $ssl,
  http2_support: $ssl,

  # HSTS queda APAGADO a proposito. Le diria al navegador "para este nombre,
  # solo https, durante meses", y esa orden se queda pegada en el cliente: si
  # el certificado caduca o hay que depurar en claro, no hay forma de volver
  # atras desde el servidor. Se enciende cuando esto lleve tiempo estable.
  hsts_enabled: false,
  hsts_subdomains: false,
  advanced_config: "",
  meta: { letsencrypt_agree: false, dns_challenge: false },

  # La location que hace que "/api" signifique algo. Sin ruta en el destino:
  # el backend usa setGlobalPrefix("api") y espera recibir el prefijo incluido.
  locations: [{
    path: "/api",
    forward_scheme: "http",
    forward_host: $h,
    forward_port: $pa,
    advanced_config: $lim
  }]
}')

RESP=$(api -X POST "$NPM/api/nginx/proxy-hosts" -d "$CUERPO")
ID=$(jq -r '.id // empty' <<<"$RESP")
[[ -n $ID ]] || { echo "No se pudo crear: $RESP" >&2; exit 1; }
echo "Host creado en NPM: id=$ID  $DOMINIO -> $APP:$PUERTO_FRONTEND  (+ /api -> :$PUERTO_API)"

cat <<FIN

FALTA UN PASO A MANO, DENTRO DEL CT 10.0.0.19 — no en esta maquina, donde
estos comandos solo dan "No such file or directory":

  ssh root@10.0.0.19
  echo 'limit_req_zone \$binary_remote_addr zone=login:10m rate=10r/m;' \\
    >> /data/nginx/custom/http_top.conf
  docker ps                               # ver el nombre real del contenedor
  docker restart <ese-nombre>

Hasta que la zona exista, NPM no puede cargar este host. Si prefieres dejarlo
para luego:  ./ops/npm-configurar.sh --quitar-limite

Comprobacion:
  curl -s https://$DOMINIO/api/salud                        # {"estado":"ok",...}
  curl -s -o /dev/null -w '%{http_code}\\n' https://$DOMINIO/entrar   # 200
  curl -s -o /dev/null -w '%{http_code}\\n' http://$DOMINIO/entrar    # 301 a https
FIN
