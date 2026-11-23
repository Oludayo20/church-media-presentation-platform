#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
SRC="$DIR/src"
if ! command -v dot >/dev/null 2>&1; then
  echo "error: install graphviz (brew install graphviz)" >&2
  exit 1
fi
for dot in "$SRC"/*.dot; do
  base="$(basename "$dot" .dot)"
  echo "rendering $base"
  dot -Tpng "$dot" -o "$SRC/${base}.png"
done
echo "done — previews in src/"
