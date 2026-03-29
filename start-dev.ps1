# Start DoltgreSQL and Next.js admin portal together
# Usage: .\start-dev.ps1
# Ctrl+C kills everything (doltgres + all node child processes)

$root = $PSScriptRoot

function Stop-AllDevProcesses {
    Write-Host "`nStopping all dev processes..." -ForegroundColor Yellow

    # Kill doltgres
    if ($script:dolt -and -not $script:dolt.HasExited) {
        Write-Host "  Stopping DoltgreSQL (PID $($script:dolt.Id))..."
        Stop-Process -Id $script:dolt.Id -Force -ErrorAction SilentlyContinue
    }

    # Kill the Next.js process tree (npm + node children)
    if ($script:nextProc -and -not $script:nextProc.HasExited) {
        $parentPid = $script:nextProc.Id
        Write-Host "  Stopping Next.js process tree (PID $parentPid)..."
        # Kill all child processes first, then the parent
        Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $parentPid } | ForEach-Object {
            Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        }
        Stop-Process -Id $parentPid -Force -ErrorAction SilentlyContinue
    }

    # Catch any orphaned node processes on port 3000
    $portUsers = netstat -ano 2>$null | Select-String ":3000\s" | ForEach-Object {
        ($_ -split '\s+')[-1]
    } | Where-Object { $_ -match '^\d+$' } | Sort-Object -Unique
    foreach ($pid in $portUsers) {
        if ($pid -ne "0") {
            Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
        }
    }

    Write-Host "All dev processes stopped." -ForegroundColor Green
}

# Handle Ctrl+C
[Console]::TreatControlCAsInput = $false
$null = Register-EngineEvent -SourceIdentifier PowerShell.Exiting -Action { Stop-AllDevProcesses }

# Start DoltgreSQL in background
$doltExe = (Get-Command doltgres -ErrorAction SilentlyContinue).Source
if (-not $doltExe) { $doltExe = "$env:USERPROFILE\bin\doltgres.exe" }
if (-not (Test-Path $doltExe)) {
    Write-Host "ERROR: doltgres not found. Install from https://github.com/dolthub/doltgresql/releases" -ForegroundColor Red
    exit 1
}
$script:dolt = Start-Process $doltExe -ArgumentList "--config","$root\lwf-staging\config.yaml" -WorkingDirectory "$root\lwf-staging" -PassThru
Write-Host "DoltgreSQL started (PID $($script:dolt.Id)) on port 5433"

# Give Dolt a moment to bind the port
Start-Sleep -Seconds 2

# Start Next.js dev server as a tracked process (not foreground npm)
Write-Host "Starting admin portal on http://localhost:3000 ..."
$script:nextProc = Start-Process "npm" -ArgumentList "run","dev" -WorkingDirectory "$root\admin" -PassThru -NoNewWindow

try {
    # Wait for the Next.js process — Ctrl+C breaks out of this
    $script:nextProc.WaitForExit()
} finally {
    Stop-AllDevProcesses
}
