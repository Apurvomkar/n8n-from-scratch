<# Show the live site's status on Render. #>
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$keyFile = Join-Path $root 'data\render-api-key.txt'
$serviceId = 'srv-dc2o51brjlhs73da5veg'

if (-not (Test-Path $keyFile)) { throw "Missing $keyFile" }
$key = (Get-Content $keyFile -Raw).Trim()

try {
  $service = Invoke-RestMethod -Method Get `
    -Uri "https://api.render.com/v1/services/$serviceId" `
    -Headers @{ Authorization = "Bearer $key"; Accept = 'application/json' }
  $value = [string]$service.suspended
  $status = if ($value -eq 'not_suspended') { 'running' } else { 'suspended' }
  Write-Host 'Live site: https://layerup.host'
  Write-Host "Status: $status"
  Write-Host "Service: $serviceId"
} catch {
  Write-Host "Could not check status: $($_.Exception.Message)"
  exit 1
}
