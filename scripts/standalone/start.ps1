$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $root

$envFile = Join-Path $root '.env'
$venvPython = Join-Path $root '.venv\Scripts\python.exe'
$frontend = Join-Path $root 'apps\designer\dist\index.html'

function Set-CompatiblePythonHome([string]$VenvRoot) {
    $configPath = Join-Path $VenvRoot 'pyvenv.cfg'
    if (-not (Test-Path -LiteralPath $configPath)) { return }
    $config = [IO.File]::ReadAllText($configPath)
    $homeMatch = [regex]::Match($config, '(?m)^home\s*=\s*(.+)$')
    if (-not $homeMatch.Success) { return }
    $configuredHome = $homeMatch.Groups[1].Value.Trim()
    if (Test-Path -LiteralPath (Join-Path $configuredHome 'Lib\os.py')) { return }
    $versionMatch = [regex]::Match($config, '(?m)^version\s*=\s*(\d+)\.(\d+)')
    if (-not $versionMatch.Success) { return }
    $folderName = 'Python' + $versionMatch.Groups[1].Value + $versionMatch.Groups[2].Value
    $fallbackHome = Join-Path $env:LOCALAPPDATA ('Programs\Python\' + $folderName)
    if (Test-Path -LiteralPath (Join-Path $fallbackHome 'Lib\os.py')) {
        $env:PYTHONHOME = $fallbackHome
    }
}

if (-not (Test-Path -LiteralPath $envFile)) {
    throw 'Missing .env. Run .\scripts\standalone\setup.ps1 first.'
}
if (-not (Test-Path -LiteralPath $venvPython)) {
    throw 'Missing Python virtual environment. Run .\scripts\standalone\setup.ps1 first.'
}
if (-not (Test-Path -LiteralPath $frontend)) {
    throw 'The frontend is not built. Run corepack pnpm build first.'
}

Set-CompatiblePythonHome (Join-Path $root '.venv')
& $venvPython -m uvicorn app:app --app-dir backend --host 127.0.0.1 --port 8001
