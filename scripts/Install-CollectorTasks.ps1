[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$ReleasePath,
    [Parameter(Mandatory)][string]$PythonPath,
    [Parameter(Mandatory)][string]$ConfigPath,
    [string]$AdminPassFile,
    [string]$SecretsDirectory,
    [switch]$EnableCollection
)
$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not ([Security.Principal.WindowsPrincipal]$identity).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run the task installer elevated on the collector host.'
}
$launcher = Join-Path (Resolve-Path -LiteralPath $ReleasePath).Path 'scripts\Start-Collector.ps1'
foreach ($file in @($launcher, $PythonPath, $ConfigPath)) {
    if (-not [IO.Path]::IsPathFullyQualified($file) -or -not (Test-Path -LiteralPath $file)) {
        throw 'Release, interpreter and config paths must exist and be absolute.'
    }
}
$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
if ($EnableCollection -and $config.enabled -ne $true) {
    throw 'Broker compatibility must be approved in the protected configuration before activation.'
}
if ($EnableCollection) {
    if (-not $AdminPassFile -or -not $SecretsDirectory) {
        throw 'Activation requires administrator-run database isolation probes in this installer invocation.'
    }
    Push-Location $ReleasePath
    try {
        & $PythonPath -m collector.verify_database --admin-passfile $AdminPassFile --secrets $SecretsDirectory
        if ($LASTEXITCODE -ne 0) { throw 'Database isolation failed; collector tasks were not activated.' }
    }
    finally { Pop-Location }
}
$pwsh = (Get-Command pwsh.exe -CommandType Application | Select-Object -First 1).Source
$principal = New-ScheduledTaskPrincipal -UserId 'NT AUTHORITY\LOCAL SERVICE' -LogonType ServiceAccount
foreach ($kind in @('tick', 'watchdog')) {
    $taskName = if ($kind -eq 'tick') { 'SolutionDeploy-web-options-collector' } else { 'SolutionDeploy-web-options-collector-watchdog' }
    $arguments = "-NoProfile -File `"$launcher`" -ReleasePath `"$ReleasePath`" -PythonPath `"$PythonPath`" -ConfigPath `"$ConfigPath`" -Action $kind"
    $action = New-ScheduledTaskAction -Execute $pwsh -Argument $arguments -WorkingDirectory $ReleasePath
    $boot = New-ScheduledTaskTrigger -AtStartup
    $repeat = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
    $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable `
        -ExecutionTimeLimit (New-TimeSpan -Minutes 4) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    Register-ScheduledTask -TaskPath '\JimlerTech\' -TaskName $taskName -Action $action `
        -Trigger @($boot, $repeat) -Settings $settings -Principal $principal -Force | Out-Null
    if ($EnableCollection) {
        Enable-ScheduledTask -TaskPath '\JimlerTech\' -TaskName $taskName | Out-Null
    }
    else {
        Disable-ScheduledTask -TaskPath '\JimlerTech\' -TaskName $taskName | Out-Null
    }
    Write-Host "$taskName registered; enabled=$([bool]$EnableCollection); account=LOCAL SERVICE"
}
