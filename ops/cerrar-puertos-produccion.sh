#!/usr/bin/env bash
#
# Cierra los puertos de produccion (3200 frontend, 4200 API) a todo el mundo
# menos al proxy inverso. Hay que correrlo como root.
#
#   sudo ./ops/cerrar-puertos-produccion.sh            # aplicar
#   sudo ./ops/cerrar-puertos-produccion.sh --revisar  # solo mirar
#   sudo ./ops/cerrar-puertos-produccion.sh --quitar   # deshacer
#
# POR QUE NO ES `ufw deny 4200`
#
# Porque no funciona, y encima lo parece. Docker mete sus reglas de DNAT en
# PREROUTING y el trafico hacia un contenedor sigue el camino FORWARD, mientras
# ufw trabaja en INPUT: el puerto seguiria abierto a toda la LAN y `ufw status`
# diria que esta denegado. El enganche que Docker respeta es la cadena
# DOCKER-USER, que consulta antes que las suyas justo para esto.
#
# Y ahi hay un segundo detalle: en DOCKER-USER el DNAT YA ocurrio, asi que el
# puerto de destino del paquete es el del CONTENEDOR (4100, 3000), no el
# publicado (4200, 3200). Por eso se empareja con `conntrack --ctorigdstport`,
# que mira el destino ORIGINAL de la conexion. Con `--dport 4200` la regla no
# casaria con nada y volveriamos a la seguridad de mentira.
#
# QUE NO TOCA
#
# Nada mas. No activa ufw, no cambia politicas por defecto y no roza los
# puertos de desarrollo (3100, 4100, 5433, 6380) ni la consola del 8000, que se
# usan desde la LAN. El radio de la explosion son dos puertos.
#
# El trafico que nace en ESTA maquina no pasa por FORWARD, asi que las pruebas
# locales (curl a localhost:4200, el nginx de prueba en red host) siguen
# funcionando. Esto solo afecta a quien llega de fuera.

set -euo pipefail

PROXY=10.0.0.19
PUERTOS=(3200 4200)
ETIQUETA="fleetfuel-prod"

[[ $EUID -eq 0 ]] || { echo "Hay que correrlo como root: sudo $0 $*" >&2; exit 1; }

iptables -n -L DOCKER-USER >/dev/null 2>&1 || {
  echo "ERROR: no existe la cadena DOCKER-USER. ¿Esta Docker corriendo?" >&2
  exit 1
}

revisar() {
  echo "Reglas DOCKER-USER en vigor:"
  iptables -n -L DOCKER-USER --line-numbers | sed 's/^/  /'
  echo
  for p in "${PUERTOS[@]}"; do
    if iptables -C DOCKER-USER -p tcp -m conntrack --ctorigdstport "$p" \
         ! -s "$PROXY" -j DROP -m comment --comment "$ETIQUETA" 2>/dev/null; then
      echo "  puerto $p: CERRADO salvo para $PROXY"
    else
      echo "  puerto $p: ABIERTO a toda la LAN"
    fi
  done
}

case "${1:-}" in
  --revisar) revisar; exit 0 ;;
  --quitar)
    for p in "${PUERTOS[@]}"; do
      while iptables -C DOCKER-USER -p tcp -m conntrack --ctorigdstport "$p" \
              ! -s "$PROXY" -j DROP -m comment --comment "$ETIQUETA" 2>/dev/null; do
        iptables -D DOCKER-USER -p tcp -m conntrack --ctorigdstport "$p" \
          ! -s "$PROXY" -j DROP -m comment --comment "$ETIQUETA"
        echo "quitada la regla del puerto $p"
      done
    done
    revisar; exit 0 ;;
esac

for p in "${PUERTOS[@]}"; do
  # -C primero: el script se puede correr dos veces sin duplicar reglas.
  if iptables -C DOCKER-USER -p tcp -m conntrack --ctorigdstport "$p" \
       ! -s "$PROXY" -j DROP -m comment --comment "$ETIQUETA" 2>/dev/null; then
    echo "puerto $p: la regla ya estaba"
  else
    # -I y no -A: DOCKER-USER termina en un RETURN que devuelve el paquete a
    # las reglas permisivas de Docker. Una regla anadida al final nunca se
    # llegaria a evaluar.
    iptables -I DOCKER-USER 1 -p tcp -m conntrack --ctorigdstport "$p" \
      ! -s "$PROXY" -j DROP -m comment --comment "$ETIQUETA"
    echo "puerto $p: cerrado salvo para $PROXY"
  fi
done

echo
revisar
echo
echo "OJO: iptables NO sobrevive a un reinicio. Para que persista:"
echo "  sudo cp ops/fleetfuel-cortafuegos.service /etc/systemd/system/"
echo "  sudo systemctl daemon-reload && sudo systemctl enable --now fleetfuel-cortafuegos"
echo
echo "Comprobacion REAL, desde OTRA maquina de la LAN (no desde esta):"
echo "  curl -m 5 http://10.0.0.193:4200/api/salud    # debe agotar el tiempo"
