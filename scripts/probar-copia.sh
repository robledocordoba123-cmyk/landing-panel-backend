#!/usr/bin/env bash
# Una copia que nunca se ha restaurado no es una copia. Esta prueba hace el ciclo
# completo en una base aparte y compara el resultado con el original.
# Uso: BD_URL=postgresql://.../base scripts/probar-copia.sh
set -euo pipefail

: "${BD_URL:?Falta BD_URL}"
origen="$(printf '%s' "$BD_URL" | sed -E 's/([?&])schema=[^&]*&?/\1/; s/[?&]$//')"
nombre="prueba_restauracion"
destino="${origen%/*}/$nombre"
carpeta="$(mktemp -d)"
archivo="$carpeta/copia.dump.gpg"
export CLAVE_COPIA="clave-solo-para-esta-prueba"

limpiar() {
  psql "$origen" -q -c "DROP DATABASE IF EXISTS $nombre" || true
  rm -rf "$carpeta"
}
trap limpiar EXIT

# Lo que debe sobrevivir: los datos y las reglas que protegen la agenda y la bitácora.
resumen() {
  psql "$1" -At -c "SELECT
    (SELECT count(*) FROM \"Cita\"), (SELECT count(*) FROM \"Cliente\"), (SELECT count(*) FROM \"Bitacora\"),
    (SELECT count(*) FROM pg_constraint WHERE conname = 'cita_sin_cruces'),
    (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgrelid = '\"Bitacora\"'::regclass),
    (SELECT count(*) FROM \"_prisma_migrations\")"
}

psql "$origen" -q -c "DROP DATABASE IF EXISTS $nombre" -c "CREATE DATABASE $nombre"
BD_URL="$origen" scripts/copia-seguridad.sh "$archivo"

if grep -aq "cita_sin_cruces" "$archivo"; then
  echo "FALLÓ: el archivo no está cifrado." >&2
  exit 1
fi
if CLAVE_COPIA="clave-equivocada" BD_DESTINO_URL="$destino" scripts/restaurar-copia.sh "$archivo" 2>/dev/null; then
  echo "FALLÓ: se restauró con una clave equivocada." >&2
  exit 1
fi

BD_DESTINO_URL="$destino" scripts/restaurar-copia.sh "$archivo"

if BD_DESTINO_URL="$destino" scripts/restaurar-copia.sh "$archivo" 2>/dev/null; then
  echo "FALLÓ: la restauración pisó una base con datos." >&2
  exit 1
fi

antes="$(resumen "$origen")"
despues="$(resumen "$destino")"
echo "Original:   $antes"
echo "Restaurada: $despues"
if [ "$antes" != "$despues" ]; then
  echo "FALLÓ: la copia restaurada no coincide." >&2
  exit 1
fi
echo "La copia se restauró completa."
