#!/usr/bin/env bash
#
# Respaldo de la base de FleetFuel: vuelca, VERIFICA restaurando de verdad,
# rota y envía a un equipo de la red MUPA.
#
# La verificación no es opcional ni decorativa: un respaldo que nunca se probó
# es una suposición, no un respaldo. Aquí cada dump se restaura en una base
# desechable antes de darse por bueno; si no restaura, el archivo se descarta
# y el script falla ruidosamente.
#
# Uso:  respaldo-postgres.sh            # respaldo normal
#       respaldo-postgres.sh --probar   # sin rotar ni enviar, para ensayar

set -Eeuo pipefail

# ── Configuración ────────────────────────────────────────────────────────────
CONTENEDOR="${CONTENEDOR:-fleetfuel_db}"
BASE="${BASE:-fleetfuel_db}"
USUARIO="${USUARIO:-fleetfuel_owner}"
DESTINO="${DESTINO:-/home/app/respaldos}"

RETENCION_DIARIOS="${RETENCION_DIARIOS:-7}"
RETENCION_SEMANALES="${RETENCION_SEMANALES:-4}"
# Directorio de metricas para el colector textfile de node-exporter. Es como se
# vigila un trabajo POR LOTES: en vez de buscar la ausencia de un error en los
# registros, el propio trabajo AFIRMA su exito escribiendo cuando termino bien.
# La diferencia importa: la ausencia de un error tambien se produce cuando el
# timer esta apagado, cuando la maquina estuvo caida o cuando alguien rompio el
# envio de registros — y en los tres casos parece que todo va bien.
METRICAS="${METRICAS:-/home/app/respaldos/metricas}"

# Equipo de la red MUPA al que se envía la copia. Vacío = solo respaldo local,
# que NO protege contra la pérdida de esta máquina: hay un solo disco físico.
REMOTO_DESTINO="${REMOTO_DESTINO:-}"     # p.ej. respaldos@10.0.0.50:/srv/fleetfuel
REMOTO_LLAVE="${REMOTO_LLAVE:-$HOME/.ssh/id_ed25519_respaldos}"

MARCA="$(date +%Y%m%d-%H%M%S)"
DIA_SEMANA="$(date +%u)"          # 7 = domingo, el que se promueve a semanal
ARCHIVO="$DESTINO/diarios/fleetfuel-$MARCA.dump"
# Se vuelca a un parcial y solo se renombra al nombre definitivo tras verificar.
# Si no, un volcado fallido deja un archivo de 0 bytes que la rotación contaría
# como copia válida: tras varios días fallando quedarían respaldos vacíos y los
# buenos ya rotados. El nombre lleva punto inicial para que `ls *.dump` no lo vea.
PARCIAL="$DESTINO/diarios/.parcial-$MARCA.dump"

# ── Registro ─────────────────────────────────────────────────────────────────
log()   { printf '%s  %s\n' "$(date +'%F %T')" "$*"; }
fatal() { log "ERROR: $*"; return 1; }

# `sg docker` porque la pertenencia al grupo puede no estar activa en la sesión.
docker_ex() { sg docker -c "docker $*"; }

# ── Limpieza ─────────────────────────────────────────────────────────────────
# La base de verificación se registra en una variable de alcance global y se
# borra en un trap EXIT: así se limpia salga el script como salga —éxito, fallo
# o interrupción— y sin depender del alcance de ninguna función.
BASE_PRUEBA=""
soltar_base_prueba() {
    [[ -n "$BASE_PRUEBA" ]] || return 0
    docker_ex "exec $CONTENEDOR dropdb -U $USUARIO --if-exists $BASE_PRUEBA" >/dev/null 2>&1 || true
    BASE_PRUEBA=""
}

# El trap de salida borra las dos cosas: la base desechable y el parcial. Un
# parcial que sobreviva significa que el respaldo no llegó a verificarse, así
# que no debe quedar en disco pareciendo una copia.
limpiar() {
    rm -f "${PARCIAL:-}"
    soltar_base_prueba
}
trap limpiar EXIT

# ── Manejo de fallos ─────────────────────────────────────────────────────────
# TODO(josue): implementar. Ver la nota al final del archivo.
notificar_fallo() {
    local paso="$1" codigo="$2"
    :
}

trap 'notificar_fallo "${PASO_ACTUAL:-desconocido}" "$?"' ERR

# ── 1 · Volcado ──────────────────────────────────────────────────────────────
volcar() {
    PASO_ACTUAL="volcado"
    mkdir -p "$DESTINO/diarios" "$DESTINO/semanales"

    # -Fc: formato propio, comprimido y restaurable selectivamente con
    # pg_restore. Un .sql plano no permitiría restaurar una sola tabla.
    log "Volcando $BASE desde $CONTENEDOR…"
    docker_ex "exec $CONTENEDOR pg_dump -U $USUARIO -d $BASE -Fc" > "$PARCIAL"

    [[ -s "$PARCIAL" ]] || fatal "el volcado quedó vacío"
    log "Volcado: $(du -h "$PARCIAL" | cut -f1)"
}

# ── 2 · Verificación: restaurar de verdad ────────────────────────────────────
verificar() {
    PASO_ACTUAL="verificación"
    BASE_PRUEBA="verificacion_respaldo_$$"

    log "Verificando: restaurando en la base desechable $BASE_PRUEBA…"
    docker_ex "exec $CONTENEDOR createdb -U $USUARIO $BASE_PRUEBA"

    if ! docker_ex "exec -i $CONTENEDOR pg_restore -U $USUARIO -d $BASE_PRUEBA --no-owner" < "$PARCIAL" 2>/tmp/pg_restore_err; then
        log "Detalle: $(head -5 /tmp/pg_restore_err)"
        fatal "el respaldo NO restaura — parcial descartado"
    fi

    # Restaurar sin error no basta: un dump de una base vacía también
    # "restaura". Se comprueba que las tablas llegaron de verdad.
    local tablas
    tablas=$(docker_ex "exec $CONTENEDOR psql -U $USUARIO -d $BASE_PRUEBA -t -A -c \
        \"SELECT count(*) FROM information_schema.tables WHERE table_schema='public'\"")

    if (( tablas < 5 )); then
        fatal "restauró solo $tablas tablas — se esperaban al menos 5; parcial descartado"
    fi

    soltar_base_prueba

    # `mv` dentro del mismo sistema de archivos es atómico: el archivo aparece
    # con su nombre definitivo entero o no aparece. Nunca a medias.
    mv "$PARCIAL" "$ARCHIVO"
    PARCIAL=""
    log "Verificado: $tablas tablas restauradas · $ARCHIVO"
}

# ── 3 · Rotación ─────────────────────────────────────────────────────────────
rotar() {
    PASO_ACTUAL="rotación"

    # El respaldo del domingo se promueve a semanal antes de que la rotación
    # diaria lo alcance, para conservar profundidad de más de una semana.
    if [[ "$DIA_SEMANA" == "7" ]]; then
        cp "$ARCHIVO" "$DESTINO/semanales/fleetfuel-semanal-$MARCA.dump"
        log "Promovido a semanal"
    fi

    podar() {
        local dir="$1" conservar="$2" borrados=0
        # shellcheck disable=SC2012
        while IFS= read -r viejo; do
            # `borrados=$((...))` y no `((borrados++))`: el segundo devuelve
            # estado 1 cuando la variable vale 0 —el valor ANTES de incrementar—
            # y con `set -e` eso aborta el script en la primera poda.
            rm -f "$viejo"; borrados=$((borrados + 1))
        done < <(ls -1t "$dir"/*.dump 2>/dev/null | tail -n +$((conservar + 1)))
        (( borrados > 0 )) && log "Podados $borrados de $(basename "$dir")"
        return 0
    }

    podar "$DESTINO/diarios"   "$RETENCION_DIARIOS"
    podar "$DESTINO/semanales" "$RETENCION_SEMANALES"
}

# ── 4 · Envío al equipo remoto ───────────────────────────────────────────────
enviar() {
    PASO_ACTUAL="envío remoto"

    if [[ -z "$REMOTO_DESTINO" ]]; then
        log "AVISO: sin destino remoto configurado. La copia vive en el MISMO"
        log "AVISO: disco que la base — no protege contra pérdida del equipo."
        return 0
    fi

    log "Enviando a $REMOTO_DESTINO…"
    rsync -az --delete \
          -e "ssh -i $REMOTO_LLAVE -o StrictHostKeyChecking=yes -o BatchMode=yes" \
          "$DESTINO/" "$REMOTO_DESTINO/" \
        || fatal "no se pudo enviar al equipo remoto"
    log "Enviado"
}

# ── Métrica de vigilancia ────────────────────────────────────────────────────
# Se escribe con `mv` y no directamente: node-exporter lee este directorio cada
# vez que le raspan, y un fichero a medio escribir le daria una metrica truncada.
# `mv` dentro del mismo sistema de ficheros es atomico.
publicar_metrica() {
    local exito="$1"
    mkdir -p "$METRICAS" || return 0
    local tmp; tmp="$(mktemp "$METRICAS/.respaldo.XXXXXX")" || return 0
    {
        echo "# HELP fleetfuel_respaldo_ultimo_intento_timestamp Ultimo intento de respaldo (epoch)."
        echo "# TYPE fleetfuel_respaldo_ultimo_intento_timestamp gauge"
        echo "fleetfuel_respaldo_ultimo_intento_timestamp $(date +%s)"
        echo "# HELP fleetfuel_respaldo_ultimo_exito_timestamp Ultimo respaldo VERIFICADO por restauracion (epoch)."
        echo "# TYPE fleetfuel_respaldo_ultimo_exito_timestamp gauge"
        if [[ "$exito" == "1" ]]; then
            echo "fleetfuel_respaldo_ultimo_exito_timestamp $(date +%s)"
        else
            # Se conserva el valor anterior: si este intento fallo, lo que hay
            # que saber es cuanto hace del ultimo BUENO, no que hubo un fallo.
            grep -h '^fleetfuel_respaldo_ultimo_exito_timestamp ' "$METRICAS/respaldo.prom" 2>/dev/null \
                || echo "fleetfuel_respaldo_ultimo_exito_timestamp 0"
        fi
        echo "# HELP fleetfuel_respaldo_exito Si el ultimo intento termino bien."
        echo "# TYPE fleetfuel_respaldo_exito gauge"
        echo "fleetfuel_respaldo_exito $exito"
    } > "$tmp"
    chmod 644 "$tmp"
    mv -f "$tmp" "$METRICAS/respaldo.prom"
}

# ── Orquestación ─────────────────────────────────────────────────────────────
main() {
    log "═══ Respaldo FleetFuel ═══"
    volcar
    verificar

    if [[ "${1:-}" == "--probar" ]]; then
        log "Modo prueba: no se rota ni se envía"
        log "═══ Prueba correcta ═══"
        return 0
    fi

    rotar
    enviar
    publicar_metrica 1
    log "═══ Respaldo correcto ═══"
}

# Si algo falla, la metrica tambien tiene que reflejarlo: un respaldo que se
# rompe y no lo cuenta es identico a uno que nunca se intento.
if main "$@"; then
    exit 0
else
    codigo=$?
    publicar_metrica 0
    exit "$codigo"
fi
