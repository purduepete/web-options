[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$ReleasePath,
    [Parameter(Mandatory)][string]$PythonPath,
    [Parameter(Mandatory)][string]$ConfigPath,
    [ValidateSet('tick', 'watchdog', 'status', 'dryrun')][string]$Action = 'tick'
)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath $ReleasePath).Path
$config = (Resolve-Path -LiteralPath $ConfigPath).Path
if ($config.StartsWith($root.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Collector credentials must be outside the release.'
}
if (-not [IO.Path]::IsPathFullyQualified($PythonPath) -or -not (Test-Path -LiteralPath $PythonPath)) {
    throw 'An absolute collector virtual-environment PythonPath is required.'
}
$logDirectory = Join-Path (Split-Path -Parent (Split-Path -Parent $config)) 'logs'
$log = Join-Path $logDirectory "collector-$Action.log"
$env:PYTHONUNBUFFERED = '1'
Push-Location $root
try {
    & $PythonPath -m collector $Action --config $config *>> $log
    $code = $LASTEXITCODE
}
finally {
    Pop-Location
}
exit $code
