#!/usr/bin/env bash
# Restaura una copia cifrada en una base de datos VACÍA. No usa --clean a propósito:
# si el destino ya tiene tablas, falla en vez de pisar datos.
# Uso: BD_DESTINO_URL=... CLAVE_COPIA=... scripts/restaurar-copia.sh archivo.dump.gpg
set -euo pipefail

: "${BD_DESTINO_URL:?Falta BD_DESTINO_URL}"
: "${CLAVE_COPIA:?Falta CLAVE_COPIA}"
archivo="${1:?Indica el archivo de la copia}"

url="$(printf '%s' "$BD_DESTINO_URL" | sed -E 's/([?&])schema=[^&]*&?/\1/; s/[?&]$//')"

gpg --batch --yes --quiet --decrypt --pinentry-mode loopback --passphrase-fd 3 "$archivo" 3<<<"$CLAVE_COPIA" \
  | pg_restore --no-owner --no-privileges --exit-on-error --dbname="$url"

echo "Copia restaurada."
