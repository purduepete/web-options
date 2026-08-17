<#
.SYNOPSIS
    Start, stop, restart or inspect the weboptions dev servers.

.DESCRIPTION
    Runs the API (port 5057) and the Vite dev server (port 5173) as detached
    background processes, so this terminal stays free. Vite proxies /api to the
    API, so the app is served from http://localhost:5173 alone.

    By default the API connects as weboptions_ro, the SELECT-only login the
    deployed service uses, reading its password from .secrets. Pass -Operator to
    connect with the webportfolio config.ini credentials instead — only needed
    when running the migration or key-management tools against a live server.

.EXAMPLE
    ./scripts/weboptions.ps1 start
.EXAMPLE
    ./scripts/weboptions.ps1 stop
.EXAMPLE
    ./scripts/weboptions.ps1 status
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet('start', 'stop', 'restart', 'status')]
    [string] $Action = 'start',

    [switch] $Operator,

    [switch] $ApiOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
$RunDir = Join-Path $Root '.run'
$OperatorConfig = 'C:\Files\Dev\main\webportfolio\config\config.ini'

$Services = [ordered]@{
    api = @{ Name = 'api'; Port = 5057; Script = 'dev:backend'; Probe = 'http://127.0.0.1:5057/healthz' }
    web = @{ Name = 'web'; Port = 5173; Script = 'dev:frontend'; Probe = 'http://127.0.0.1:5173/' }
}

function Get-PidFile([string] $Name) { Join-Path $RunDir "$Name.pid" }
function Get-LogFile([string] $Name) { Join-Path $RunDir "$Name.log" }

function Get-ListenerPid([int] $Port) {
    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
    if ($conn) { return $conn.OwningProcess }
    return $null
}

function Get-RunningPid([hashtable] $Service) {
    # The port is the source of truth; the pid file only records who we launched,
    # and npm hands off to a child, so the listener is rarely the pid we stored.
    $listener = Get-ListenerPid $Service.Port
    if ($listener) { return [int] $listener }

    $pidFile = Get-PidFile $Service.Name
    if (Test-Path $pidFile) {
        $stored = [int] (Get-Content $pidFile -Raw).Trim()
        if (Get-Process -Id $stored -ErrorAction SilentlyContinue) { return $stored }
    }
    return $null
}

function Stop-Tree([int] $ProcessId) {
    # npm spawns tsx/vite as grandchildren, so the whole tree has to go.
    & taskkill.exe /PID $ProcessId /T /F 2>&1 | Out-Null
}

function Wait-Ready([string] $Url, [int] $TimeoutSeconds = 45) {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3 | Out-Null
            return $true
        }
        catch {
            # Any HTTP answer means it is listening; a 401 from an authed route counts.
            # A refused connection throws HttpRequestException, which carries no Response.
            $response = $_.Exception.PSObject.Properties['Response']
            if ($response -and $response.Value) { return $true }
            Start-Sleep -Milliseconds 500
        }
    }
    return $false
}

function Set-BackendCredentials {
    # Vite serves the app in dev. A WEBOPTIONS_WEB_ROOT left over from a production
    # run makes the backend refuse to start, and a relative one resolves against
    # backend/ rather than the repo root, which reads as a nonsense path.
    Remove-Item Env:WEBOPTIONS_WEB_ROOT -ErrorAction SilentlyContinue

    if ($Operator) {
        if (-not (Test-Path $OperatorConfig)) {
            throw "Operator mode needs $OperatorConfig, which is not on this machine."
        }
        $env:WEBPORTFOLIO_CONFIG_PATH = $OperatorConfig
        Write-Host '  credentials: operator (webportfolio config.ini)' -ForegroundColor Yellow
        return
    }

    $passwordFile = Join-Path $Root '.secrets\weboptions_ro.password'
    if (-not (Test-Path $passwordFile)) {
        throw "Missing $passwordFile. Run 'npm run create-readonly-user -- --confirm' first, or pass -Operator."
    }

    $env:DB_SERVER = 'sqlgkhw25ijhyzzy.database.windows.net'
    $env:DB_NAME = 'webportfolio'
    $env:DB_USER = 'weboptions_ro'
    $env:DB_PASSWORD = (Get-Content $passwordFile -Raw).Trim()
    Write-Host '  credentials: weboptions_ro (read-only)' -ForegroundColor DarkGray
}

function Clear-BackendCredentials {
    # Launched processes already hold their own copy. Leaving these set in the
    # calling session is what makes the operator tools refuse to run later.
    Remove-Item Env:DB_SERVER, Env:DB_NAME, Env:DB_USER, Env:DB_PASSWORD, Env:WEBPORTFOLIO_CONFIG_PATH `
        -ErrorAction SilentlyContinue
}

function Start-Service([hashtable] $Service) {
    $existing = Get-RunningPid $Service
    if ($existing) {
        Write-Host "  $($Service.Name) already listening on $($Service.Port) (pid $existing)" -ForegroundColor DarkGray
        return
    }

    $blocker = Get-ListenerPid $Service.Port
    if ($blocker) {
        $name = (Get-Process -Id $blocker -ErrorAction SilentlyContinue).ProcessName
        throw "Port $($Service.Port) is held by $name (pid $blocker). The Flask prototype uses 5057 too — stop it first."
    }

    $log = Get-LogFile $Service.Name
    $proc = Start-Process -FilePath 'npm.cmd' `
        -ArgumentList 'run', $Service.Script `
        -WorkingDirectory $Root `
        -WindowStyle Hidden `
        -RedirectStandardOutput $log `
        -RedirectStandardError "$log.err" `
        -PassThru
    Set-Content -Path (Get-PidFile $Service.Name) -Value $proc.Id -Encoding ascii
    Write-Host "  $($Service.Name) starting (pid $($proc.Id)), log $log"
}

function Invoke-Start {
    New-Item -ItemType Directory -Path $RunDir -Force | Out-Null
    Write-Host 'Starting weboptions...' -ForegroundColor Cyan

    try {
        Set-BackendCredentials
        Start-Service $Services.api
    }
    finally {
        Clear-BackendCredentials
    }

    if (-not $ApiOnly) { Start-Service $Services.web }

    $failed = $false
    foreach ($service in $Services.Values) {
        if ($ApiOnly -and $service.Name -eq 'web') { continue }
        if (Wait-Ready $service.Probe) {
            Write-Host "  $($service.Name) ready on $($service.Port)" -ForegroundColor Green
        }
        else {
            $failed = $true
            Write-Host "  $($service.Name) did not answer on $($service.Port)" -ForegroundColor Red
            Write-Host "  --- tail of $(Get-LogFile $service.Name) ---" -ForegroundColor Red
            Get-Content (Get-LogFile $service.Name) -Tail 15 -ErrorAction SilentlyContinue
            Get-Content "$(Get-LogFile $service.Name).err" -Tail 15 -ErrorAction SilentlyContinue
        }
    }

    if ($failed) { exit 1 }
    Write-Host ''
    Write-Host '  Open http://localhost:5173' -ForegroundColor Cyan
}

function Invoke-Stop {
    Write-Host 'Stopping weboptions...' -ForegroundColor Cyan
    foreach ($service in $Services.Values) {
        $running = Get-RunningPid $service
        if ($running) {
            Stop-Tree $running
            Write-Host "  $($service.Name) stopped (pid $running)"
        }
        else {
            Write-Host "  $($service.Name) was not running" -ForegroundColor DarkGray
        }

        $pidFile = Get-PidFile $service.Name
        if (Test-Path $pidFile) {
            $stored = [int] (Get-Content $pidFile -Raw).Trim()
            if (Get-Process -Id $stored -ErrorAction SilentlyContinue) { Stop-Tree $stored }
            Remove-Item $pidFile -Force
        }
    }
}

function Invoke-Status {
    foreach ($service in $Services.Values) {
        $running = Get-RunningPid $service
        if ($running) {
            Write-Host "  $($service.Name)  running  port $($service.Port)  pid $running" -ForegroundColor Green
        }
        else {
            Write-Host "  $($service.Name)  stopped  port $($service.Port)" -ForegroundColor DarkGray
        }
    }
}

switch ($Action) {
    'start' { Invoke-Start }
    'stop' { Invoke-Stop }
    'restart' { Invoke-Stop; Start-Sleep -Seconds 1; Invoke-Start }
    'status' { Invoke-Status }
}
