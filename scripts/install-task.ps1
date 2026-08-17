<#
.SYNOPSIS
    Register the WebOptions boot task so the server runs with no visible window.

.DESCRIPTION
    Registering this by hand is what lets the settings drift. The one that
    matters is the launcher: wscript creates no console and detaches the hidden
    PowerShell process from the short-lived Task Scheduler logon action.

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
$HiddenLauncher = Join-Path $Root 'scripts\start-hidden.vbs'
if (-not (Test-Path $HiddenLauncher)) {
    throw "Missing $HiddenLauncher."
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

$wscript = Join-Path $env:SystemRoot 'System32\wscript.exe'
$argument = "`"$HiddenLauncher`" `"$($pwshCommand.Source)`" `"$Launcher`""
if ($Port -ne 5057) {
    $argument += " $Port"
}

$action = New-ScheduledTaskAction -Execute $wscript -Argument $argument -WorkingDirectory $Root
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity.Name
# The default execution time limit kills the task after 3 days, which reads as a
# random unexplained outage.
# RestartCount/RestartInterval are mostly cosmetic here: the hidden VBS launcher
# detaches the real process and always reports success, so Task Scheduler never
# sees a failure to restart. serve.ps1 has its own retry loop for that. Set them
# anyway so Task Scheduler's own history/UI stays consistent with webportfolio's
# task and in case the launcher ever starts reporting real exit codes.
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId $identity.Name -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Settings $settings -Principal $principal -Force | Out-Null

$task = Get-ScheduledTask -TaskName $TaskName
Write-Host "registered $TaskName as $($task.Principal.UserId), logon type $($task.Principal.LogonType)"
Write-Host "  runs: $wscript $argument"

if ($Start) {
    Start-ScheduledTask -TaskName $TaskName
    Write-Host "started $TaskName. Check http://localhost:$Port/readyz in a few seconds."
}
else {
    Write-Host "not started. Run: Start-ScheduledTask -TaskName $TaskName"
}
