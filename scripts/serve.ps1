<#
.SYNOPSIS
    Run the weboptions server in production: one process, API and app together.

.DESCRIPTION
    Unlike scripts/weboptions.ps1, this starts nothing in the background and runs
    no Vite. It sets the credentials and the web root, then hands off to node in
    the foreground, so Task Scheduler can treat the process as the task itself.

    Everything it prints also lands in .run/weboptions.log.

.EXAMPLE
    ./scripts/serve.ps1
.EXAMPLE
    ./scripts/serve.ps1 -Port 5099
#>
[CmdletBinding()]
param(
    [int] $Port = 5057
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
$RunDir = Join-Path $Root '.run'
$LogFile = Join-Path $RunDir 'weboptions.log'
$Entry = Join-Path $Root 'backend\dist\server.js'
$WebRoot = Join-Path $Root 'frontend\dist'
$PasswordFile = Join-Path $Root '.secrets\weboptions_ro.password'

if (-not (Test-Path $RunDir)) {
    New-Item -ItemType Directory -Path $RunDir | Out-Null
}

function Write-Log {
    param([Parameter(Mandatory)] [string] $Message)
    "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message" | Tee-Object -FilePath $LogFile -Append
}

# Under Task Scheduler there is no console and no window, so anything that throws
# before node starts leaves no trace anywhere. Report into the log instead.
try {
    if (-not (Test-Path $Entry)) {
        throw "Missing $Entry. Run 'npm run build' first."
    }
    if (-not (Test-Path (Join-Path $WebRoot 'index.html'))) {
        throw "Missing $WebRoot\index.html. Run 'npm run build' first."
    }
    if (-not (Test-Path $PasswordFile)) {
        throw "Missing $PasswordFile. Run 'npm run create-readonly-user -- --confirm' first."
    }

    $nodeCommand = Get-Command node -CommandType Application -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if (-not $nodeCommand) {
        # A per-user Node install is invisible to SYSTEM, so this works by hand
        # and then fails at every boot.
        throw 'node is not on PATH for this account. Install Node machine-wide, or give the task an absolute path to node.'
    }
    $node = $nodeCommand.Source
}
catch {
    Write-Log "did not start: $($_.Exception.Message)"
    Write-Log "  account: $([Security.Principal.WindowsIdentity]::GetCurrent().Name)"
    Write-Log "  path: $env:PATH"
    exit 1
}

$env:DB_SERVER = 'sqlgkhw25ijhyzzy.database.windows.net'
$env:DB_NAME = 'webportfolio'
$env:DB_USER = 'weboptions_ro'
$env:DB_PASSWORD = (Get-Content $PasswordFile -Raw).Trim()
$env:WEBOPTIONS_WEB_ROOT = $WebRoot
$env:NODE_ENV = 'production'
$env:PORT = $Port
# Week boundaries are machine-local, so an unpinned box shows the wrong week.
$env:TZ = 'America/Los_Angeles'

Write-Log "starting weboptions on port $Port using $node"

$exit = 1
try {
    & $node $Entry 2>&1 | Tee-Object -FilePath $LogFile -Append
    $exit = $LASTEXITCODE
}
catch {
    Write-Log "stopped: $($_.Exception.Message)"
}
finally {
    # The child already holds its own copy. Leaving these set is what makes the
    # operator tools connect read-only later, and makes the dev server refuse to
    # start because it inherits a web root it should never have.
    Remove-Item Env:DB_SERVER, Env:DB_NAME, Env:DB_USER, Env:DB_PASSWORD, `
        Env:WEBOPTIONS_WEB_ROOT, Env:NODE_ENV, Env:PORT, Env:TZ -ErrorAction SilentlyContinue
}

Write-Log "weboptions exited with $exit"
exit $exit
