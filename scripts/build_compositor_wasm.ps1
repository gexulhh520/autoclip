$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Out = Join-Path $Root "frontend/src/wasm/compositor/pkg"
if (-not (Get-Command wasm-pack -ErrorAction SilentlyContinue)) {
  Write-Error "wasm-pack not found. Install: cargo install wasm-pack"
}
wasm-pack build (Join-Path $Root "rust/compositor-wasm") --target web --out-dir $Out --release
Write-Host "WASM compositor built -> $Out"
