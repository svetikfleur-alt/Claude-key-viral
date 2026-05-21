# start-platform.ps1
# Builds the TypeScript project and starts the hybrid media platform.
# The platform HTTP server + dashboard runs on http://127.0.0.1:3333
# The MCP stdio server also starts (for Claude Desktop integration).

param(
    [int]$Port = 3333
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot

Write-Host ""
Write-Host "  ⬡  Hybrid Media Platform" -ForegroundColor Cyan
Write-Host "  Building TypeScript..." -ForegroundColor Gray

Set-Location $Root
npm run build

if ($LASTEXITCODE -ne 0) {
    Write-Host "  Build failed. Fix TypeScript errors and retry." -ForegroundColor Red
    exit 1
}

Write-Host "  Build complete." -ForegroundColor Green
Write-Host ""
Write-Host "  Starting platform on http://127.0.0.1:$Port" -ForegroundColor Cyan
Write-Host "  Dashboard:  http://127.0.0.1:$Port" -ForegroundColor White
Write-Host "  API:        http://127.0.0.1:$Port/api" -ForegroundColor White
Write-Host "  MCP server: stdio (for Claude Desktop)" -ForegroundColor White
Write-Host ""
Write-Host "  Press Ctrl+C to stop." -ForegroundColor Gray
Write-Host ""

$env:PLATFORM_PORT = $Port
node dist/index.js
