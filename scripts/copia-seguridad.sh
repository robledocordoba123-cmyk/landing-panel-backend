#!/usr/bin/env bash
# Saca una copia de la base de datos y la cifra con AES-256. El archivo cifrado es
# seguro de guardar fuera: sin CLAVE_COPIA nadie puede leerlo.
# Uso: BD_URL=... CLAVE_COPIA=... scripts/copia-seguridad.sh [archivo-de-salida]
set -euo pipefail

: "${BD_URL:?Falta BD_URL}"
: "${CLAVE_COPIA:?Falta CLAVE_COPIA}"

archivo="${1:-huellitas-$(date -u +%Y%m%d-%H%M%S).dump.gpg}"
# "schema" es una opción de Prisma; pg_dump no la conoce y fallaría.
url="$(printf '%s' "$BD_URL" | sed -E 's/([?&])schema=[^&]*&?/\1/; s/[?&]$//')"

# --no-owner y --no-privileges: la copia se puede restaurar en un servidor nuevo,
# aunque ahí los usuarios sean otros.
pg_dump --format=custom --no-owner --no-privileges --dbname="$url" \
  | gpg --batch --yes --quiet --symmetric --cipher-algo AES256 --pinentry-mode loopback \
      --passphrase-fd 3 --output "$archivo" 3<<<"$CLAVE_COPIA"

# Un archivo casi vacío significa que la copia no sirve.
if [ "$(wc -c < "$archivo")" -lt 1024 ]; then
  echo "La copia salió demasiado pequeña: revisa la conexión." >&2
  exit 1
fi
echo "Copia lista: $archivo"
