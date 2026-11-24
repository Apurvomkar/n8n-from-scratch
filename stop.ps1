<#
  Stop the local web page (API + React editor).

    .\stop.ps1
#>
$ErrorActionPreference = 'SilentlyContinue'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$stateFile = Join-Path $root 'data\web-state.json'
$pids = @()

if (Test-Path $stateFile) {
  $state = Get-Content $stateFile -Raw | ConvertFrom-Json
  $pids += @($state.apiPid, $state.uiPid)
}

foreach ($port in @(3000, 5173)) {
  $pids += Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique
}

$pids = @($pids | Where-Object { $_ } | Select-Object -Unique)
$stopped = @()
foreach ($processId in $pids) {
  if (Get-Process -Id $processId -ErrorAction SilentlyContinue) {
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    $stopped += $processId
  }
}

if (Test-Path $stateFile) { Remove-Item $stateFile -Force }

if ($stopped.Count -gt 0) {
  Write-Host "Stopped PIDs: $($stopped -join ', ')"
} else {
  Write-Host 'Nothing running.'
}
