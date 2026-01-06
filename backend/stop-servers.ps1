# Script to stop Node.js dev servers
Write-Host "Finding Node.js processes related to this project..." -ForegroundColor Yellow

# Get all node processes
$nodeProcesses = Get-Process | Where-Object { $_.ProcessName -eq "node" }

if ($nodeProcesses.Count -eq 0) {
    Write-Host "No Node.js processes found." -ForegroundColor Green
    exit 0
}

Write-Host "`nFound $($nodeProcesses.Count) Node.js process(es):" -ForegroundColor Cyan
$nodeProcesses | ForEach-Object {
    $cmdLine = (Get-CimInstance Win32_Process -Filter "ProcessId = $($_.Id)").CommandLine
    Write-Host "  PID: $($_.Id) - $cmdLine" -ForegroundColor Gray
}

Write-Host "`nStopping Node.js processes..." -ForegroundColor Yellow
$nodeProcesses | Stop-Process -Force

Write-Host "`nAll Node.js processes stopped. You can now run 'npx prisma generate'" -ForegroundColor Green
Write-Host "Wait 2-3 seconds before running prisma generate..." -ForegroundColor Yellow
Start-Sleep -Seconds 2













