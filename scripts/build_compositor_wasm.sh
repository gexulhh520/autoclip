#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/frontend/src/wasm/compositor/pkg"
if ! command -v wasm-pack >/dev/null 2>&1; then
  echo "wasm-pack not found. Install: cargo install wasm-pack"
  exit 1
fi
wasm-pack build "$ROOT/rust/compositor-wasm" --target web --out-dir "$OUT" --release
echo "WASM compositor built -> $OUT"
