[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $ReleasePath,
    [Parameter(Mandatory)] [string] $SettingsPath,
    [string] $NodePath = 'C:\Program Files\nodejs\node.exe'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$release = (Resolve-Path -LiteralPath $ReleasePath).Path
$settingsFile = (Resolve-Path -LiteralPath $SettingsPath).Path
$repo = Split-Path -Parent $PSScriptRoot
foreach ($directory in @($release, $repo)) {
    if ($settingsFile.StartsWith($directory.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw 'SettingsPath must be outside the release and repository. Protect its ACL for LOCAL SERVICE and administrators.'
    }
}
if (-not [IO.Path]::IsPathFullyQualified($NodePath) -or -not (Test-Path -LiteralPath $NodePath -PathType Leaf)) {
    throw 'NodePath must be an absolute machine-wide node.exe path readable by LOCAL SERVICE.'
}
$entry = Join-Path $release 'backend\dist\server.js'
$webRoot = Join-Path $release 'frontend\dist'
foreach ($file in @($entry, (Join-Path $webRoot 'index.html'))) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Missing built release file: $file" }
}

$settings = Get-Content -LiteralPath $settingsFile -Raw | ConvertFrom-Json -AsHashtable
if ($settings.Environment -isnot [System.Collections.IDictionary]) {
    throw 'Settings JSON must contain an Environment dictionary.'
}
$environment = $settings.Environment
foreach ($name in @('DB_SERVER', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'WEBPORTFOLIO_API_URL', 'WEBPORTFOLIO_SERVICE_KEY', 'WEBOPTIONS_ALLOWED_ORIGINS')) {
    if ($environment[$name] -isnot [string] -or [string]::IsNullOrWhiteSpace($environment[$name])) {
        throw "Settings Environment requires $name."
    }
}
if ($environment['WEBOPTIONS_AUTH_MODE'] -ne 'access') {
    throw 'Deployment settings must explicitly select WEBOPTIONS_AUTH_MODE=access.'
}
$allowedNames = @(
    'DB_SERVER', 'DB_NAME', 'DB_USER', 'DB_PASSWORD',
    'WEBPORTFOLIO_API_URL', 'WEBPORTFOLIO_SERVICE_KEY',
    'WEBOPTIONS_AUTH_MODE', 'WEBOPTIONS_ALLOWED_ORIGINS'
    'PGPASSFILE', 'WEBOPTIONS_HISTORY_PYTHON', 'WEBOPTIONS_HISTORY_COLLECTOR_ROOT'
)
foreach ($name in $environment.Keys) {
    if ($name -notin $allowedNames -or $environment[$name] -isnot [string]) {
        throw "Unsupported deployment environment setting: $name"
    }
}
$environment['HOST'] = '127.0.0.1'
$environment['PORT'] = '18797'
$environment['NODE_ENV'] = 'production'
$environment['TZ'] = 'America/Los_Angeles'
$environment['WEBOPTIONS_WEB_ROOT'] = $webRoot
$previous = @{}
$exitCode = 1
try {
    foreach ($name in $environment.Keys) {
        $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
        [Environment]::SetEnvironmentVariable($name, $environment[$name], 'Process')
    }
    # Foreground execution lets the boot task own node's lifetime and exit code.
    & $NodePath $entry
    $exitCode = $LASTEXITCODE
}
finally {
    foreach ($name in $previous.Keys) {
        [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process')
    }
}
exit $exitCode
