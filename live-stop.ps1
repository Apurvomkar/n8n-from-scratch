<# Suspend the live site on Render (layerup.host). #>
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$keyFile = Join-Path $root 'data\render-api-key.txt'
$serviceId = 'srv-dc2o51brjlhs73da5veg'

if (-not (Test-Path $keyFile)) { throw "Missing $keyFile" }
$key = (Get-Content $keyFile -Raw).Trim()

try {
  Invoke-RestMethod -Method Post `
    -Uri "https://api.render.com/v1/services/$serviceId/suspend" `
    -Headers @{ Authorization = "Bearer $key"; Accept = 'application/json' } | Out-Null
  Write-Host 'Live site suspended: https://layerup.host will stop responding.'
} catch {
  Write-Host "Could not suspend: $($_.Exception.Message)"
  exit 1
}
