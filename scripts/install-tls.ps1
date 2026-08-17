<#
.SYNOPSIS
    Put TLS in front of the weboptions API with a Caddy reverse proxy.

.DESCRIPTION
    weboptions itself stays plain HTTP on 5057 (unchanged). This installs Caddy
    as a second, minimal process that terminates TLS on 5443 and reverse-proxies
    to 127.0.0.1:5057, using a locally-trusted self-signed cert (`tls internal`).
    No code changes to the Node app; no cert renewal to babysit.

    Downloads the Caddy binary from GitHub releases if it is not already present,
    writes scripts\Caddyfile, and registers a hidden logon task (WebOptionsTLS)
    the same way install-task.ps1 registers WebOptions itself.

    Re-running this is safe. It overwrites the existing task and Caddyfile.

.EXAMPLE
    ./scripts/install-tls.ps1
.EXAMPLE
    ./scripts/install-tls.ps1 -HttpsPort 8443 -Start
#>
[CmdletBinding()]
param(
    [int] $HttpsPort = 5443,
    [int] $UpstreamPort = 5057,
    [switch] $Start
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not ([Security.Principal.WindowsPrincipal]$identity).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this from an elevated shell. Installing the trusted local CA and registering a task both need it.'
}

$Root = Split-Path -Parent $PSScriptRoot
$ToolsDir = Join-Path $Root 'scripts\caddy'
$CaddyExe = Join-Path $ToolsDir 'caddy.exe'
$CaddyfilePath = Join-Path $Root 'scripts\Caddyfile'
$HiddenLauncher = Join-Path $Root 'scripts\start-hidden-command.vbs'
$RunDir = Join-Path $Root '.run'
$LogFile = Join-Path $RunDir 'caddy.log'

if (-not (Test-Path $RunDir)) {
    New-Item -ItemType Directory -Path $RunDir | Out-Null
}
if (-not (Test-Path $HiddenLauncher)) {
    throw "Missing $HiddenLauncher."
}

# A running caddy.exe holds its own log file open exclusively on Windows, which
# blocks this script's own Write-Log from appending to the same file. Stop any
# existing instance before touching $LogFile at all, not just before the final
# restart: a stale process would otherwise also keep running the old config
# while this script rewrites the Caddyfile underneath it.
# @(...) forces an array even for a single match: Get-Process returns a bare
# Process object (no .Count) when exactly one process matches, which throws
# under Set-StrictMode.
$existingCaddy = @(Get-Process -Name 'caddy' -ErrorAction SilentlyContinue)
if ($existingCaddy.Count -gt 0) {
    Write-Host "stopping $($existingCaddy.Count) existing caddy.exe process(es) before continuing"
    $existingCaddy | ForEach-Object { Stop-Process -Id $_.Id -Force }
    Start-Sleep -Seconds 1
}

function Write-Log {
    param([Parameter(Mandatory)] [string] $Message)
    "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message" | Tee-Object -FilePath $LogFile -Append
}

# --- 1. Get the caddy binary --------------------------------------------------
if (-not (Test-Path $CaddyExe)) {
    Write-Log "caddy.exe not found at $CaddyExe, downloading"
    if (-not (Test-Path $ToolsDir)) {
        New-Item -ItemType Directory -Path $ToolsDir | Out-Null
    }

    $release = $null
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        try {
            $release = Invoke-RestMethod -Uri 'https://api.github.com/repos/caddyserver/caddy/releases/latest' `
                -Headers @{ 'User-Agent' = 'weboptions-install-tls' } -TimeoutSec 20
            break
        }
        catch {
            Write-Log "release lookup attempt $attempt failed: $($_.Exception.Message)"
            Start-Sleep -Seconds 5
        }
    }
    if (-not $release) {
        throw 'Could not reach GitHub to resolve the latest Caddy release after 3 attempts.'
    }

    $asset = $release.assets | Where-Object { $_.name -match 'windows_amd64\.zip$' } | Select-Object -First 1
    if (-not $asset) {
        throw "No windows_amd64.zip asset found in release $($release.tag_name)."
    }

    $zipPath = Join-Path $ToolsDir $asset.name
    Write-Log "downloading $($asset.browser_download_url)"
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zipPath -TimeoutSec 60

    Expand-Archive -Path $zipPath -DestinationPath $ToolsDir -Force
    Remove-Item $zipPath -Force

    if (-not (Test-Path $CaddyExe)) {
        throw "Extraction did not produce $CaddyExe."
    }
    Write-Log "installed caddy $($release.tag_name) at $CaddyExe"
}
else {
    Write-Log "caddy.exe already present at $CaddyExe, skipping download"
}

# --- 2. Figure out which IP to bind -------------------------------------------
# Match weboptions' own convention: bind the machine's LAN IPv4, not 0.0.0.0
# or 127.0.0.1, so it is reachable from other devices on the home network.
$lanIp = (Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -like '192.168.*' -and $_.PrefixOrigin -ne 'WellKnown' } |
    Select-Object -First 1 -ExpandProperty IPAddress)
if (-not $lanIp) {
    throw 'Could not determine this machine''s LAN IPv4 address (expected a 192.168.x.x address).'
}
Write-Log "binding TLS listener to $lanIp`:$HttpsPort"

# --- 3. Write the Caddyfile ----------------------------------------------------
$caddyfileContent = @"
{
    admin localhost:2019
}

$($lanIp):$($HttpsPort) {
    tls internal
    reverse_proxy 127.0.0.1:$UpstreamPort
    log {
        output file $($LogFile -replace '\\','/') {
            roll_size 10mb
            roll_keep 5
        }
    }
}
"@
Set-Content -Path $CaddyfilePath -Value $caddyfileContent -Encoding utf8
Write-Log "wrote $CaddyfilePath"

# --- 4. Trust the local CA once, interactively, so browsers stop warning -----
Write-Log "run once, interactively, to install the local CA into the Windows trust store: & `"$CaddyExe`" trust --config `"$CaddyfilePath`""

# --- 5. Register the hidden logon task ----------------------------------------
$TaskName = 'WebOptionsTLS'
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "replacing the existing $TaskName task"
}

$wscript = Join-Path $env:SystemRoot 'System32\wscript.exe'
$argument = "`"$HiddenLauncher`" `"$CaddyExe`" run --config `"$CaddyfilePath`" --adapter caddyfile"

$action = New-ScheduledTaskAction -Execute $wscript -Argument $argument -WorkingDirectory $ToolsDir
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity.Name
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 0 `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId $identity.Name -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Settings $settings -Principal $principal -Force | Out-Null

$task = Get-ScheduledTask -TaskName $TaskName
Write-Host "registered $TaskName as $($task.Principal.UserId), logon type $($task.Principal.LogonType)"
Write-Host "  runs: $wscript $argument"

if ($Start) {
    # Already stopped near the top of the script, before $LogFile was first
    # touched, so no need to repeat that here.
    Start-ScheduledTask -TaskName $TaskName
    Start-Sleep -Seconds 2
    Write-Host "started $TaskName. Check https://$($lanIp):$HttpsPort/healthz in a few seconds (self-signed cert warning is expected until 'caddy trust' is run)."
}
else {
    Write-Host "not started. Run: Start-ScheduledTask -TaskName $TaskName"
}

Write-Host ''
Write-Host 'One-time manual step (interactive session, not this task):'
Write-Host "  & `"$CaddyExe`" trust --config `"$CaddyfilePath`""
Write-Host 'This installs the local CA into the Windows trust store so browsers on this machine stop warning.'
Write-Host 'Other devices on the LAN will still see a self-signed warning unless that CA is exported and imported there too.'
