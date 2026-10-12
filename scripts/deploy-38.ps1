[CmdletBinding()]
param(
    [string]$DeployHost = 'ai-server',
    [switch]$SkipTests,
    [switch]$AllowDirty,
    [switch]$AllowNonMain,
    [switch]$SyncProjectData
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Invoke-Native {
    param(
        [Parameter(Mandatory = $true)][string]$Command,
        [Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments
    )

    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed ($LASTEXITCODE): $Command $($Arguments -join ' ')"
    }
}

function Get-GitValue {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)

    $value = & git @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Git command failed: git $($Arguments -join ' ')"
    }
    return ($value | Out-String).Trim()
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$remoteRoot = '/home/jiao/lvgl-designer'
$releaseId = $null
$tempRoot = $null
$remoteHelper = $null
$remoteDataHelper = $null
$remoteDataTool = $null

Push-Location $repoRoot
try {
    $status = Get-GitValue @('status', '--porcelain')
    if (-not $AllowDirty -and $status) {
        throw 'Working tree is not clean. Commit or stash changes before deployment, or explicitly use -AllowDirty.'
    }

    $branch = Get-GitValue @('branch', '--show-current')
    if (-not $AllowNonMain -and $branch -ne 'main') {
        throw "Current branch is '$branch'. Merge into main first, or explicitly use -AllowNonMain."
    }

    if (-not $AllowDirty -and -not $AllowNonMain) {
        Invoke-Native git 'fetch' 'origin' 'main'
        $head = Get-GitValue @('rev-parse', 'HEAD')
        $remoteHead = Get-GitValue @('rev-parse', 'origin/main')
        if ($head -ne $remoteHead) {
            throw 'Local HEAD does not match origin/main. Pull or push the merged commit before deployment.'
        }
    }

    if (-not $SkipTests) {
        Invoke-Native corepack 'pnpm' '-r' 'test'
        $python = Join-Path $repoRoot '.venv\Scripts\python.exe'
        if (-not (Test-Path -LiteralPath $python)) {
            throw "Python environment not found: $python"
        }
        Invoke-Native $python '-m' 'pytest' 'backend/tests' '-q'
    }

    Invoke-Native corepack 'pnpm' '-r' 'build'

    $shortSha = Get-GitValue @('rev-parse', '--short=12', 'HEAD')
    $releaseId = "$(Get-Date -Format 'yyyyMMdd-HHmmss')-$shortSha"
    $tempRoot = Join-Path ([IO.Path]::GetTempPath()) "lvgl-deploy-$releaseId-$PID"
    $archive = Join-Path $tempRoot "lvgl-$releaseId.tar.gz"
    New-Item -ItemType Directory -Path $tempRoot | Out-Null

    Invoke-Native tar.exe '-czf' $archive `
        '--exclude=*/__pycache__' `
        '--exclude=*/.pytest_cache' `
        '--exclude=*.pyc' `
        '-C' $repoRoot `
        'apps/designer/dist' `
        'apps/build-worker/dist' `
        'apps/preview-host/dist' `
        'backend'

    $remoteArchive = "$remoteRoot/.deploy-staging/incoming-lvgl-$releaseId.tar.gz"
    $remoteHelper = "$remoteRoot/.deploy-staging/apply-lvgl-$releaseId.sh"
    $helper = Join-Path $PSScriptRoot 'deploy\remote-apply-lvgl.sh'

    Invoke-Native ssh $DeployHost "mkdir -p '$remoteRoot/.deploy-staging' '$remoteRoot/.deploy-backups'"
    Invoke-Native scp $archive "${DeployHost}:$remoteArchive"
    Invoke-Native scp $helper "${DeployHost}:$remoteHelper"
    Invoke-Native ssh $DeployHost "bash '$remoteHelper' '$remoteArchive' '$releaseId' '$shortSha'"
    Invoke-Native ssh $DeployHost "rm -f '$remoteHelper'"
    $remoteHelper = $null

    if ($SyncProjectData) {
        $python = Join-Path $repoRoot '.venv\Scripts\python.exe'
        if (-not (Test-Path -LiteralPath $python)) {
            throw "Python environment not found: $python"
        }
        $localDataRoot = Join-Path $repoRoot 'lvgl_data'
        $dataExportRoot = Join-Path $tempRoot 'lvgl-data'
        $dataArchive = Join-Path $tempRoot "lvgl-data-$releaseId.tar.gz"
        $dataTool = Join-Path $PSScriptRoot 'deploy\sync-lvgl-data.py'
        $dataHelper = Join-Path $PSScriptRoot 'deploy\remote-sync-lvgl-data.sh'
        Invoke-Native $python $dataTool 'export' $localDataRoot $dataExportRoot
        Invoke-Native tar.exe '-czf' $dataArchive '-C' $dataExportRoot '.'

        $remoteDataArchive = "$remoteRoot/.deploy-staging/incoming-lvgl-data-$releaseId.tar.gz"
        $remoteDataHelper = "$remoteRoot/.deploy-staging/sync-lvgl-data-$releaseId.sh"
        $remoteDataTool = "$remoteRoot/.deploy-staging/sync-lvgl-data-$releaseId.py"
        Invoke-Native scp $dataArchive "${DeployHost}:$remoteDataArchive"
        Invoke-Native scp $dataHelper "${DeployHost}:$remoteDataHelper"
        Invoke-Native scp $dataTool "${DeployHost}:$remoteDataTool"
        Invoke-Native ssh $DeployHost "bash '$remoteDataHelper' '$remoteDataArchive' '$releaseId' '$remoteDataTool'"
        Invoke-Native ssh $DeployHost "rm -f '$remoteDataHelper'"
        $remoteDataHelper = $null
        $remoteDataTool = $null
    }

    Write-Host "LVGL Designer deployed successfully: $releaseId" -ForegroundColor Green
    if ($SyncProjectData) {
        Write-Host 'Project data and assets were merged into the remote deployment.' -ForegroundColor Green
    }
    Write-Host 'URL: http://192.168.1.38:8003/lvgl-designer/'
}
finally {
    Pop-Location
    if ($tempRoot -and (Test-Path -LiteralPath $tempRoot)) {
        Remove-Item -LiteralPath $tempRoot -Recurse -Force
    }
    if ($remoteHelper) {
        Write-Warning "Remote helper was retained for diagnostics: $remoteHelper"
    }
    if ($remoteDataHelper) {
        Write-Warning "Remote data helper was retained for diagnostics: $remoteDataHelper"
    }
    if ($remoteDataTool) {
        Write-Warning "Remote data tool was retained for diagnostics: $remoteDataTool"
    }
}
