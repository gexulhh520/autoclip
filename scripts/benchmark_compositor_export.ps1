# Compositor 导出性能基线 — Windows 入口
param(
    [ValidateSet("render", "encode", "mux", "e2e", "all")]
    [string]$Mode = "all",
    [switch]$Full
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$BenchmarkFull = if ($Full) { "1" } else { "0" }

function Run-Render {
    Write-Host "== benchmark: renderer =="
    Push-Location (Join-Path $Root "frontend")
    $env:COMPOSITOR_BENCHMARK = "1"
    npm test -- --run src/editor/compositor/compositorExportBench.test.ts
    if ($BenchmarkFull -eq "1") {
        npm test -- --run src/editor/compositor/compositorExportBench.test.ts -t "perf-30s"
    }
    Pop-Location
}

function Run-Encode {
    Write-Host "== benchmark: encoder =="
    if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
        Write-Host "SKIP: cargo not available"
        return
    }
    $frames = if ($BenchmarkFull -eq "1") { "900" } else { "120" }
    Push-Location (Join-Path $Root "rust")
    $env:COMPOSITOR_BENCHMARK = "1"
    $env:BENCHMARK_FRAMES = $frames
    cargo test -p autoclip-export export_bench -- --nocapture
    Pop-Location
}

function Run-Mux {
    Write-Host "== benchmark: mux =="
    if ($BenchmarkFull -eq "1") {
        $env:COMPOSITOR_BENCHMARK = "1"
        $env:BENCHMARK_FULL = "1"
        python -m pytest backend/tests/test_compositor_export_perf.py::test_mux_baseline_30s_optional -q -s
    } else {
        python -m pytest backend/tests/test_compositor_export_perf.py::test_mux_baseline_minimal_duration -q -s
    }
}

function Run-E2E {
    Write-Host "== benchmark: mux E2E =="
    python -m pytest backend/tests/test_compositor_mux_integration.py -q
    if (Get-Command cargo -ErrorAction SilentlyContinue) {
        Push-Location (Join-Path $Root "rust")
        cargo test -p autoclip-export export_smoke_encodes -- --nocapture
        Pop-Location
    }
}

Push-Location $Root
switch ($Mode) {
    "render" { Run-Render }
    "encode" { Run-Encode }
    "mux" { Run-Mux }
    "e2e" { Run-E2E }
    "all" {
        Run-Render
        Run-Encode
        Run-Mux
        Run-E2E
    }
}
Pop-Location

Write-Host "BENCHMARK_DONE mode=$Mode full=$BenchmarkFull"
