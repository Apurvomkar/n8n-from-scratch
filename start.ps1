<#
  Start the local web page (API + React editor).

    .\start.ps1

  URLs: editor http://localhost:5173  |  API http://localhost:3000
  Logs: logs\api.log, logs\api.err.log, logs\ui.log, logs\ui.err.log
#>
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$logDir = Join-Path $root 'logs'
$stateDir = Join-Path $root 'data'
$stateFile = Join-Path $stateDir 'web-state.json'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
New-Item -ItemType Directory -Path $stateDir -Force | Out-Null

function Get-PortPid([int]$port) {
  $owners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique
  if ($owners) { return @($owners)[0] }
  return $null
}

$running = @(3000, 5173 | ForEach-Object { Get-PortPid $_ } | Where-Object { $_ })
if ($running.Count -gt 0) {
  Write-Host "Already running (PIDs: $($running -join ', ')). Use .\stop.ps1 first."
  exit 0
}

$node = (Get-Command node).Source

Start-Process -FilePath $node `
  -ArgumentList @('node_modules/tsx/dist/cli.mjs', 'src/server/index.ts') `
  -WorkingDirectory $root -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $logDir 'api.log') `
  -RedirectStandardError (Join-Path $logDir 'api.err.log') | Out-Null

Start-Process -FilePath $node `
  -ArgumentList @('node_modules/vite/bin/vite.js') `
  -WorkingDirectory (Join-Path $root 'ui') -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $logDir 'ui.log') `
  -RedirectStandardError (Join-Path $logDir 'ui.err.log') | Out-Null

# Wait until both ports answer so the recorded PIDs are the real listeners.
$apiPid = $null
$uiPid = $null
for ($i = 0; $i -lt 30; $i += 1) {
  Start-Sleep -Milliseconds 500
  $apiPid = Get-PortPid 3000
  $uiPid = Get-PortPid 5173
  if ($apiPid -and $uiPid) { break }
}

@{
  startedAt = (Get-Date).ToString('o')
  apiPid = $apiPid
  uiPid = $uiPid
} | ConvertTo-Json | Set-Content -Path $stateFile -Encoding UTF8

if (-not ($apiPid -and $uiPid)) {
  Write-Host 'Started, but one service did not open its port. Check logs\ directory.'
  exit 1
}

Write-Host 'Web page running:'
Write-Host '  Editor: http://localhost:5173'
Write-Host "  API:    http://localhost:3000"
Write-Host "  PIDs:   $apiPid, $uiPid"
