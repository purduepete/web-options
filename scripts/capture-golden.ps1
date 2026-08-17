<#
.SYNOPSIS
    Captures golden JSON from the legacy Flask server so the Node backend can be
    checked against it.

.DESCRIPTION
    Runs server/server.py on an alternate port, records the raw bytes of every
    JSON API response, and shuts it down. The fixtures this writes are the
    reference the parity gate compares against, and they stay in the repo after
    the Flask code is deleted.

    The API key is read straight from server/secrets.ini and never printed.

.EXAMPLE
    pwsh scripts/capture-golden.ps1
#>
#requires -Version 7
[CmdletBinding()]
param(
    # 5057 belongs to the Node backend, so the capture uses its own port.
    [int]$Port = 5099,
    [string]$OutDir
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$serverDir = Join-Path $repoRoot 'server'
$secretsPath = Join-Path $serverDir 'secrets.ini'
if (-not $OutDir) {
    $OutDir = Join-Path $repoRoot 'backend\test\fixtures\golden'
}

if (-not (Test-Path $secretsPath)) {
    throw "Missing $secretsPath. Copy secrets.example.ini and set api_key."
}

$match = Select-String -Path $secretsPath -Pattern '^\s*api_key\s*=\s*(\S+)' | Select-Object -First 1
if (-not $match) {
    throw "No api_key found in $secretsPath."
}
$apiKey = $match.Matches[0].Groups[1].Value
$headers = @{ 'X-API-Key' = $apiKey }
$base = "http://127.0.0.1:$Port"

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$stdout = Join-Path $env:TEMP 'weboptions-golden-out.log'
$stderr = Join-Path $env:TEMP 'weboptions-golden-err.log'

Write-Host "Starting the Flask server on port $Port..."
$proc = Start-Process -FilePath 'python' -ArgumentList 'server.py' `
    -WorkingDirectory $serverDir -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput $stdout -RedirectStandardError $stderr `
    -Environment @{ WEBOPTIONS_PORT = "$Port"; WEBOPTIONS_BIND_HOST = '127.0.0.1' }

function Save-Endpoint {
    param([string]$Path, [string]$Name)
    $response = Invoke-WebRequest -Uri "$base$Path" -Headers $headers -UseBasicParsing
    $target = Join-Path $OutDir "$Name.json"
    # Raw content, not a re-serialised object, so key order survives.
    [System.IO.File]::WriteAllText($target, $response.Content)
    Write-Host "  $Name.json  <-  $Path"
    return $response.Content | ConvertFrom-Json
}

try {
    $ready = $false
    foreach ($attempt in 1..40) {
        Start-Sleep -Milliseconds 500
        if ($proc.HasExited) {
            throw "The server exited early. stderr: $(Get-Content $stderr -Raw)"
        }
        try {
            Invoke-WebRequest -Uri "$base/api/health" -Headers $headers -UseBasicParsing | Out-Null
            $ready = $true
            break
        }
        catch {
            continue
        }
    }
    if (-not $ready) {
        throw "The server never answered on $base. stderr: $(Get-Content $stderr -Raw)"
    }

    Write-Host 'Capturing:'
    Save-Endpoint -Path '/api/health' -Name 'health' | Out-Null
    $earliest = Save-Endpoint -Path '/api/earliest-week' -Name 'earliest-week'
    Save-Endpoint -Path '/api/calendars' -Name 'calendars' | Out-Null

    # No week param, so this one records the default-to-current-week behaviour.
    $current = Save-Endpoint -Path '/api/week-signals' -Name 'week-default'

    # Pinned weeks, so the fixtures stay comparable as the calendar moves on.
    $currentMonday = [datetime]::Parse($current.weekStart)
    $priorMonday = $currentMonday.AddDays(-7).ToString('yyyy-MM-dd')
    $earliestMonday = $earliest.weekStart

    Save-Endpoint -Path "/api/week-signals?week=$($current.weekStart)" -Name 'week-current' | Out-Null
    Save-Endpoint -Path "/api/week-signals?week=$priorMonday" -Name 'week-prior' | Out-Null
    if ($earliestMonday) {
        Save-Endpoint -Path "/api/week-signals?week=$earliestMonday" -Name 'week-earliest' | Out-Null
    }

    $manifest = [ordered]@{
        capturedAt     = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ss')
        source         = 'server/server.py (Flask)'
        volatileFields = @('generatedAt')
        weeks          = [ordered]@{
            'week-current'  = $current.weekStart
            'week-prior'    = $priorMonday
            'week-earliest' = $earliestMonday
        }
    }
    $manifestPath = Join-Path $OutDir 'manifest.json'
    $manifest | ConvertTo-Json -Depth 5 | Set-Content -Path $manifestPath -Encoding utf8
    Write-Host "  manifest.json"
    Write-Host "`nWrote fixtures to $OutDir"
}
finally {
    if ($proc -and -not $proc.HasExited) {
        Write-Host 'Stopping the Flask server...'
        Stop-Process -Id $proc.Id -Force
    }
}
