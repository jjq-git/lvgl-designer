$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $root

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

if (-not (Test-Path -LiteralPath '.env')) {
    $bytes = New-Object byte[] 24
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $rng.GetBytes($bytes)
    }
    finally {
        $rng.Dispose()
    }
    $password = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', 'A').Replace('/', 'B')
    $templatePath = Join-Path $root '.env.example'
    $template = [IO.File]::ReadAllText($templatePath, [Text.Encoding]::UTF8)
    $template = $template.Replace('change-me-before-first-start', $password)
    [IO.File]::WriteAllText((Join-Path $root '.env'), $template, (New-Object Text.UTF8Encoding($false)))
    Write-Host "Created administrator: admin / $password" -ForegroundColor Yellow
    Write-Host 'Save this password. You can change it after the first login.' -ForegroundColor Yellow
}

& corepack pnpm install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { throw "pnpm install failed with exit code $LASTEXITCODE" }

& corepack pnpm build
if ($LASTEXITCODE -ne 0) { throw "pnpm build failed with exit code $LASTEXITCODE" }

$venvPython = Join-Path $root '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $venvPython)) {
    $pyLauncher = Get-Command py.exe -ErrorAction SilentlyContinue
    if ($null -ne $pyLauncher) {
        & $pyLauncher.Source -3 -m venv .venv
    }
    else {
        $python = Get-Command python.exe -ErrorAction Stop
        & $python.Source -m venv .venv
    }
    if ($LASTEXITCODE -ne 0) { throw "Python venv creation failed with exit code $LASTEXITCODE" }
}

Set-CompatiblePythonHome (Join-Path $root '.venv')
& $venvPython -m pip install -r backend\requirements.txt
if ($LASTEXITCODE -ne 0) { throw "pip install failed with exit code $LASTEXITCODE" }

Write-Host 'Setup complete. Run .\scripts\standalone\start.ps1 to start the server.' -ForegroundColor Green
