[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$ReleasePath,
    [Parameter(Mandatory)][string]$PythonPath,
    [Parameter(Mandatory)][string]$ConfigPath,
    [string]$PowerShellPath = 'C:\ProgramData\SolutionDeploy\runtime\powershell\7\pwsh.exe',
    [string]$CollectorAccessModulePath = 'C:\ProgramData\SolutionDeploy\control\framework\src\CollectorAccess.psm1',
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
if (-not (Test-Path -LiteralPath $CollectorAccessModulePath -PathType Leaf)) {
    throw "Shared collector access helper missing: $CollectorAccessModulePath. Install SolutionDeploy control framework or specify -CollectorAccessModulePath."
}
Import-Module $CollectorAccessModulePath -Force
$logs = Join-Path (Split-Path -Parent (Split-Path -Parent $ReleasePath)) 'shared\logs'
$writeDirectories = @($logs)
if ($config.notification_state_file) { $writeDirectories += Split-Path -Parent $config.notification_state_file }
$access = Invoke-CollectorAccessPreflight -ReleasePath $ReleasePath -PythonPath $PythonPath -ConfigPath $ConfigPath `
    -PowerShellPath $PowerShellPath -WritableDirectories ($writeDirectories | Sort-Object -Unique)
if (-not $access.Success -or $access.Sid -ne 'S-1-5-19') { throw 'Collector access preflight failed; tasks unchanged.' }
Write-Host "Collector access verified; original ACLs: $($access.AclSnapshot)"
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
$pwsh = $PowerShellPath
$principal = New-ScheduledTaskPrincipal -UserId 'NT AUTHORITY\LOCAL SERVICE' -LogonType ServiceAccount
foreach ($kind in @('tick', 'watchdog', 'audit')) {
    $taskName = switch ($kind) {
        'tick' { 'SolutionDeploy-web-options-collector' }
        'watchdog' { 'SolutionDeploy-web-options-collector-watchdog' }
        'audit' { 'SolutionDeploy-web-options-daily-audit' }
    }
    $arguments = "-NoProfile -File `"$launcher`" -ReleasePath `"$ReleasePath`" -PythonPath `"$PythonPath`" -ConfigPath `"$ConfigPath`" -Action $kind"
    $action = New-ScheduledTaskAction -Execute $pwsh -Argument $arguments -WorkingDirectory $ReleasePath
    $boot = New-ScheduledTaskTrigger -AtStartup
    $repeat = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
    $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable `
        -ExecutionTimeLimit (New-TimeSpan -Minutes 4) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    $triggers = @($boot, $repeat)
    if ($kind -eq 'audit') {
        $triggers = @(New-ScheduledTaskTrigger -Daily -At '13:30')
        $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable `
            -ExecutionTimeLimit (New-TimeSpan -Minutes 15) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    }
    Register-ScheduledTask -TaskPath '\JimlerTech\' -TaskName $taskName -Action $action `
        -Trigger $triggers -Settings $settings -Principal $principal -Force | Out-Null
    if ($EnableCollection) {
        Enable-ScheduledTask -TaskPath '\JimlerTech\' -TaskName $taskName | Out-Null
    }
    else {
        Disable-ScheduledTask -TaskPath '\JimlerTech\' -TaskName $taskName | Out-Null
    }
    Write-Host "$taskName registered; enabled=$([bool]$EnableCollection); account=LOCAL SERVICE"
}
