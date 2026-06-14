#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON_BIN="${PYTHON_BIN:-python3}"

cd "${ROOT_DIR}"

echo "== compositor smoke: Rust golden =="
if command -v cargo >/dev/null 2>&1; then
  (cd rust && cargo test -p autoclip-compositor golden_ --quiet)
else
  echo "SKIP: cargo not available"
fi

echo "== compositor smoke: frontend vitest =="
(cd frontend && npm test -- --run \
  src/editor/compositor/compositorGolden.test.ts \
  src/editor/compositor/softwareRendererGolden.test.ts \
  src/editor/compositor/compositorExportSmoke.test.ts \
  src/editor/compositor/templateCaptionOpenCut.test.ts \
  src/editor/effects/effects.test.ts)

echo "== compositor smoke: backend pytest =="
"${PYTHON_BIN}" -m pytest \
  backend/tests/test_compositor_golden.py \
  backend/tests/test_compositor_export_smoke.py \
  -q

echo "COMPOSITOR_SMOKE=ok"
