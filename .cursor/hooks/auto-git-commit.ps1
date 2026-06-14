# Agent 会话结束时：若有未提交的源码变更，自动创建兜底 commit。
# 不 push；不提交 data/、数据库、缓存与构建产物。

$ErrorActionPreference = 'SilentlyContinue'

$root = git rev-parse --show-toplevel 2>$null
if (-not $root) { exit 0 }
Set-Location $root

$porcelain = git status --porcelain 2>$null
if (-not $porcelain) { exit 0 }

$stagePaths = @(
    'backend',
    'frontend',
    'src-tauri',
    'scripts',
    '.cursor',
    'CLAUDE.md',
    'DESIGN.md',
    'HANDOFF.md',
    'ROADMAP.md',
    'README.md',
    'package.json',
    'package-lock.json'
)

foreach ($path in $stagePaths) {
    if (Test-Path $path) {
        git add -A -- $path 2>$null
    }
}

git add -u -- backend frontend src-tauri scripts .cursor 2>$null

git reset HEAD -- data 2>$null
git reset HEAD -- frontend/dist 2>$null
git reset HEAD -- frontend/node_modules 2>$null
git reset HEAD -- node_modules 2>$null

$staged = @(git diff --cached --name-only 2>$null)
if ($staged.Count -eq 0) { exit 0 }

$timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm'
$summary = ($staged | Select-Object -First 5) -join ', '
if ($staged.Count -gt 5) { $summary += ', ...' }

$message = @"
chore: auto-commit after agent session ($timestamp)

Files: $summary
"@

git commit -m $message 2>$null
exit 0
