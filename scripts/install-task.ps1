<#
.SYNOPSIS
    Register the WebOptions boot task so the server runs with no visible window.

.DESCRIPTION
    Registering this by hand is what lets the settings drift. The one that
    matters is the logon type: an Interactive principal runs the launcher on your
    desktop, so a PowerShell window opens at boot and stays open for as long as
    the server runs. S4U runs it as you in a session with no desktop, so nothing
    is ever drawn.

    Re-running this is safe. It overwrites the existing task.

.EXAMPLE
    ./scripts/install-task.ps1
.EXAMPLE
    ./scripts/install-task.ps1 -Start
#>
[CmdletBinding()]
param(
    [string] $TaskName = 'WebOptions',
    [int] $Port = 5057,
    [switch] $Start
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not ([Security.Principal.WindowsPrincipal]$identity).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this from an elevated shell. Registering a task for another logon type needs it.'
}

$Root = Split-Path -Parent $PSScriptRoot
$Launcher = Join-Path $Root 'scripts\serve.ps1'
if (-not (Test-Path $Launcher)) {
    throw "Missing $Launcher."
}

# Both of these may be per-user installs, so the task needs absolute paths.
$pwshCommand = Get-Command pwsh -CommandType Application -ErrorAction SilentlyContinue |
    Select-Object -First 1
if (-not $pwshCommand) {
    throw 'pwsh is not on PATH for this account.'
}

$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "replacing the existing $TaskName task (logon type was $($existing.Principal.LogonType))"
}

$argument = "-NoProfile -NonInteractive -WindowStyle Hidden -File `"$Launcher`""
if ($Port -ne 5057) {
    $argument += " -Port $Port"
}

$action = New-ScheduledTaskAction -Execute $pwshCommand.Source -Argument $argument -WorkingDirectory $Root
$trigger = New-ScheduledTaskTrigger -AtStartup
# The default execution time limit kills the task after 3 days, which reads as a
# random unexplained outage.
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 0
$principal = New-ScheduledTaskPrincipal -UserId $identity.Name -LogonType S4U -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Settings $settings -Principal $principal -Force | Out-Null

$task = Get-ScheduledTask -TaskName $TaskName
Write-Host "registered $TaskName as $($task.Principal.UserId), logon type $($task.Principal.LogonType)"
Write-Host "  runs: $($pwshCommand.Source) $argument"

if ($Start) {
    Start-ScheduledTask -TaskName $TaskName
    Write-Host "started $TaskName. Check http://localhost:$Port/readyz in a few seconds."
}
else {
    Write-Host "not started. Run: Start-ScheduledTask -TaskName $TaskName"
}
