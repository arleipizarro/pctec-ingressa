#!/usr/bin/env bash
set -euo pipefail

DEST="${1:-/app/pctec-ingressa}"

if [ -e "$DEST" ] && [ "$(find "$DEST" -mindepth 1 -maxdepth 1 2>/dev/null | head -1)" ]; then
  echo "ERRO: destino já existe e não está vazio: $DEST" >&2
  exit 1
fi

mkdir -p "$DEST"
cp -a "$(dirname "$0")/../." "$DEST/"
rm -f "$DEST/scripts/install.sh"

echo "PCTEC Ingressa instalado em: $DEST"
find "$DEST" -maxdepth 3 -type f | sort
