# start_local.ps1 — Cloudmaker Agent Intercom local startup script
# Usage: .\start_local.ps1

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Cloudmaker Agent Intercom — Local Start" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# ── 1. Check for .env file ──────────────────────────────────────────
$envFile = Join-Path $ScriptDir ".env"
if (Test-Path $envFile) {
    Write-Host "[OK] .env file found at $envFile" -ForegroundColor Green
} else {
    Write-Host "[WARN] No .env file found at $envFile" -ForegroundColor Yellow
    Write-Host "       The server will start with default/fallback config." -ForegroundColor Yellow
    Write-Host "       Create a .env with at least INTERCOM_API_KEY for auth." -ForegroundColor Yellow
    Write-Host ""
}

# ── 2. Check PM2 is installed ───────────────────────────────────────
$pm2Cmd = Get-Command pm2 -ErrorAction SilentlyContinue
if (-not $pm2Cmd) {
    Write-Host "[ERROR] pm2 is not installed or not in PATH." -ForegroundColor Red
    Write-Host "        Install with: npm install -g pm2" -ForegroundColor Red
    exit 1
}

# ── 3. Kill any existing PM2 processes for our apps ─────────────────
Write-Host "[INFO] Stopping any existing Intercom PM2 processes..." -ForegroundColor Yellow

$appNames = @("intercom", "ag-worker", "neo-worker", "miyagi-worker", "github-receipt-writer")
foreach ($app in $appNames) {
    # pm2 delete returns non-zero if the app doesn't exist; suppress errors
    pm2 delete $app 2>$null | Out-Null
}
Write-Host "[OK] Old processes cleaned up." -ForegroundColor Green

# ── 4. Start PM2 with ecosystem config ──────────────────────────────
$ecosystemFile = Join-Path $ScriptDir "ecosystem.config.js"
if (-not (Test-Path $ecosystemFile)) {
    Write-Host "[ERROR] ecosystem.config.js not found at $ecosystemFile" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "[INFO] Starting PM2 with ecosystem.config.js ..." -ForegroundColor Cyan
pm2 start $ecosystemFile
Write-Host ""

# ── 5. Show PM2 list ────────────────────────────────────────────────
Write-Host "[INFO] Current PM2 process list:" -ForegroundColor Cyan
pm2 list
Write-Host ""

# ── 6. Tail logs (last 20 lines) ────────────────────────────────────
Write-Host "[INFO] Tailing last 20 lines of PM2 logs:" -ForegroundColor Cyan
pm2 logs --lines 20 --nostream
Write-Host ""

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Startup complete.                     " -ForegroundColor Cyan
Write-Host "  Health check: http://localhost:4444/health" -ForegroundColor Green
Write-Host "  Smoke test:   node test_local_spine.js" -ForegroundColor Green
Write-Host "  Live logs:    pm2 logs                " -ForegroundColor Green
Write-Host "  Stop all:     pm2 stop ecosystem.config.js" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
