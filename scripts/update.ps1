<#
.SYNOPSIS
    Pull, build, restart, and verify the production WebOptions service.

.DESCRIPTION
    Refuses a dirty checkout and database migration changes. The running
    service stays up until the pull and build both succeed. Use -SkipPull and
    -SkipRestart to validate the build without changing Git or the service.

.EXAMPLE
    npm run update
.EXAMPLE
    ./scripts/update.ps1 -SkipPull -SkipRestart
#>
[CmdletBinding()]
param(
    [string] $TaskName = 'WebOptions',
    [int] $Port = 5057,
    [switch] $SkipPull,
    [switch] $SkipRestart,
    [switch] $MigrationsApplied
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
$ReadyUrl = "http://127.0.0.1:$Port/readyz"
$RunDir = Join-Path $Root '.run'
$PendingMigrationFile = Join-Path $RunDir 'pending-migration-commit'

function Assert-NativeSuccess([string] $Action) {
    if ($LASTEXITCODE -ne 0) {
        throw "$Action failed with exit code $LASTEXITCODE."
    }
}

function Get-ListenerPid {
    $connection = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
    if ($connection) { return [int] $connection.OwningProcess }
    return $null
}

function Wait-Ready([int] $TimeoutSeconds = 60) {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $result = Invoke-RestMethod -Uri $ReadyUrl -TimeoutSec 3
            if ($result.status -eq 'ok' -and $result.database -eq 'ok') {
                return $true
            }
        }
        catch {
            Start-Sleep -Milliseconds 500
        }
    }
    return $false
}

Push-Location $Root
try {
    Write-Host 'Updating WebOptions...' -ForegroundColor Cyan

    $before = (& git rev-parse HEAD).Trim()
    Assert-NativeSuccess 'Reading the current commit'

    if (-not $SkipPull) {
        $dirty = @(& git status --porcelain --untracked-files=normal)
        Assert-NativeSuccess 'Checking the working tree'
        if ($dirty.Count -gt 0) {
            throw 'The working tree has local changes. Commit, stash, or remove them before updating.'
        }

        & git pull --ff-only
        Assert-NativeSuccess 'git pull --ff-only'
    }

    $after = (& git rev-parse HEAD).Trim()
    Assert-NativeSuccess 'Reading the updated commit'
    $changed = if ($before -eq $after) { @() } else { @(& git diff --name-only "$before..$after") }
    Assert-NativeSuccess 'Reading the pulled changes'

    if ($changed -match '^database/migrations/') {
        New-Item -ItemType Directory -Path $RunDir -Force | Out-Null
        Set-Content -Path $PendingMigrationFile -Value $after -Encoding ascii
    }

    if ((Test-Path $PendingMigrationFile) -and -not $MigrationsApplied) {
        throw 'This update contains database migrations. Review and run them with operator credentials, then rerun scripts/update.ps1 with -MigrationsApplied.'
    }

    $lockChanged = $changed -contains 'package-lock.json'
    if ($lockChanged -or -not (Test-Path (Join-Path $Root 'node_modules'))) {
        Write-Host 'Installing locked dependencies...'
        & npm.cmd ci
        Assert-NativeSuccess 'npm ci'
    }

    Write-Host 'Building shared, backend, and frontend...'
    & npm.cmd run build
    Assert-NativeSuccess 'npm run build'

    if ($SkipRestart) {
        Write-Host "Build verified at commit $($after.Substring(0, 7)); restart skipped." -ForegroundColor Green
        return
    }

    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if (-not $task) {
        throw "Scheduled task $TaskName is not registered. Run scripts/install-task.ps1 first."
    }

    $listenerPid = Get-ListenerPid
    if ($listenerPid) {
        Write-Host "Stopping listener on port $Port (pid $listenerPid)..."
        Stop-Process -Id $listenerPid -Force
        Wait-Process -Id $listenerPid -Timeout 15 -ErrorAction SilentlyContinue
    }

    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Start-ScheduledTask -TaskName $TaskName
    Write-Host "Waiting for $ReadyUrl..."

    if (-not (Wait-Ready)) {
        throw "WebOptions did not become ready within 60 seconds. Check .run/weboptions.log."
    }

    Remove-Item $PendingMigrationFile -Force -ErrorAction SilentlyContinue
    Write-Host "Deployed commit $($after.Substring(0, 7)); database is ready." -ForegroundColor Green
}
finally {
    Pop-Location
}