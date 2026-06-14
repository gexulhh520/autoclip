#!/usr/bin/env bash
# Compositor 导出性能基线 — renderer (vitest) + encoder (cargo) + mux (pytest)
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON_BIN="${PYTHON_BIN:-python3}"
MODE="${1:-all}"
BENCHMARK_FULL="${BENCHMARK_FULL:-0}"

cd "${ROOT_DIR}"

run_render() {
  echo "== benchmark: renderer =="
  cd frontend
  COMPOSITOR_BENCHMARK=1 npm test -- --run src/editor/compositor/compositorExportBench.test.ts
  if [[ "${BENCHMARK_FULL}" == "1" ]]; then
    COMPOSITOR_BENCHMARK=1 npm test -- --run src/editor/compositor/compositorExportBench.test.ts -t "perf-30s"
  fi
  cd "${ROOT_DIR}"
}

run_encode() {
  echo "== benchmark: encoder =="
  if ! command -v cargo >/dev/null 2>&1; then
    echo "SKIP: cargo not available"
    return 0
  fi
  local frames=120
  if [[ "${BENCHMARK_FULL}" == "1" ]]; then
    frames=900
  fi
  (cd rust && COMPOSITOR_BENCHMARK=1 BENCHMARK_FRAMES="${frames}" cargo test -p autoclip-export export_bench -- --nocapture)
}

run_mux() {
  echo "== benchmark: mux =="
  if [[ "${BENCHMARK_FULL}" == "1" ]]; then
    COMPOSITOR_BENCHMARK=1 BENCHMARK_FULL=1 "${PYTHON_BIN}" -m pytest backend/tests/test_compositor_export_perf.py::test_mux_baseline_30s_optional -q -s
  else
    "${PYTHON_BIN}" -m pytest backend/tests/test_compositor_export_perf.py::test_mux_baseline_minimal_duration -q -s
  fi
}

run_e2e() {
  echo "== benchmark: mux E2E =="
  "${PYTHON_BIN}" -m pytest backend/tests/test_compositor_mux_integration.py -q
  if command -v cargo >/dev/null 2>&1; then
    (cd rust && cargo test -p autoclip-export export_smoke_encodes -- --nocapture)
  fi
}

case "${MODE}" in
  render) run_render ;;
  encode) run_encode ;;
  mux) run_mux ;;
  e2e) run_e2e ;;
  all)
    run_render
    run_encode
    run_mux
    run_e2e
    ;;
  *)
    echo "usage: $0 [render|encode|mux|e2e|all]"
    exit 1
    ;;
esac

echo "BENCHMARK_DONE mode=${MODE} full=${BENCHMARK_FULL}"
