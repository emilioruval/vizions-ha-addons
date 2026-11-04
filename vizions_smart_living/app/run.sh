#!/bin/sh
# Mantiene vivo el agente: si se cae, lo vuelve a arrancar a los 5 s.
# Opciones inválidas (salida 2) o la orden de detenerse de Home Assistant (0) lo terminan.
app="${SL_APP:-/app}"
hijo=""
trap 'if [ -n "$hijo" ]; then kill -TERM "$hijo" 2>/dev/null; wait "$hijo"; fi; exit 0' TERM INT
while true; do
  node "$app/scripts/agente-addon.mjs" &
  hijo=$!
  wait "$hijo"
  codigo=$?
  hijo=""
  if [ "$codigo" -eq 0 ] || [ "$codigo" -eq 2 ]; then exit "$codigo"; fi
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) {\"evento\":\"reinicio\",\"salida\":$codigo}"
  sleep "${SL_ESPERA_REINICIO:-5}"
done
