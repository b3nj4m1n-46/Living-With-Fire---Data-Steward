# Start DoltgreSQL and Next.js admin portal together
# Usage: .\start-dev.ps1

$root = $PSScriptRoot

# Start DoltgreSQL in background
$doltExe = (Get-Command doltgres -ErrorAction SilentlyContinue).Source
if (-not $doltExe) { $doltExe = "$env:USERPROFILE\bin\doltgres.exe" }
if (-not (Test-Path $doltExe)) {
    Write-Host "ERROR: doltgres not found. Install from https://github.com/dolthub/doltgresql/releases" -ForegroundColor Red
    exit 1
}
$dolt = Start-Process $doltExe -ArgumentList "--config","$root\lwf-staging\config.yaml" -WorkingDirectory "$root\lwf-staging" -PassThru
Write-Host "DoltgreSQL started (PID $($dolt.Id)) on port 5433"

# Give Dolt a moment to bind the port
Start-Sleep -Seconds 2

# Start Next.js dev server in foreground
Write-Host "Starting admin portal on http://localhost:3000 ..."
Set-Location "$root\admin"
try {
    npm run dev
} finally {
    # When you Ctrl+C the dev server, also stop DoltgreSQL
    Write-Host "Stopping DoltgreSQL..."
    Stop-Process -Id $dolt.Id -ErrorAction SilentlyContinue
}
