[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^\d+\.\d+\.\d+$')]
    [string]$Version,

    [switch]$Force,

    [string]$DeployDir = 'D:\broker-system',

    [string]$ReleaseBranch = 'master'
)

$ErrorActionPreference = 'Stop'
$SourceDir = Split-Path -Parent $PSScriptRoot
$BackendDockerfile = Join-Path $SourceDir 'backend.Dockerfile'
$FrontendDockerfile = Join-Path $SourceDir 'frontend.Dockerfile'
$PackageJson = Join-Path $SourceDir 'frontend\package.json'
$ComposeFile = Join-Path $DeployDir 'docker-compose.yml'
$EnvFile = Join-Path $DeployDir '.env'
$ReleaseDir = Join-Path $DeployDir 'deploy\releases'
$Timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$BackendImage = "broker-backend:$Version"
$FrontendImage = "broker-frontend:$Version"
$DeploymentStarted = $false
$RollbackAttempted = $false
$RollbackSucceeded = $false
$PreviousVersion = $null
$GitSha = $null
$PublicBaseUrl = 'http://localhost:8080'

function Assert-LastExitCode {
    param([string]$Step)

    if ($LASTEXITCODE -ne 0) {
        throw "$Step failed. Exit code: $LASTEXITCODE"
    }
}

function Get-EnvValue {
    param([string]$Path, [string]$Key)

    $match = [regex]::Match(
        [System.IO.File]::ReadAllText($Path),
        "(?m)^$([regex]::Escape($Key))=(.*)$"
    )

    if ($match.Success) { return $match.Groups[1].Value.Trim() }
    return $null
}

function Set-EnvValue {
    param([string]$Path, [string]$Key, [string]$Value)

    $content = [System.IO.File]::ReadAllText($Path)
    $pattern = "(?m)^$([regex]::Escape($Key))=.*$"
    $newLine = "$Key=$Value"
    if ($content -match $pattern) {
        $content = [regex]::Replace($content, $pattern, $newLine)
    }
    else {
        if ($content -and -not $content.EndsWith("`n")) { $content += "`r`n" }
        $content += "$newLine`r`n"
    }

    $replacementId = [guid]::NewGuid().ToString('N')
    $temporaryPath = "$Path.$replacementId.tmp"
    $backupPath = "$Path.$replacementId.bak"
    [System.IO.File]::WriteAllText($temporaryPath, $content, (New-Object System.Text.UTF8Encoding($false)))
    try {
        [System.IO.File]::Replace($temporaryPath, $Path, $backupPath)
        Remove-Item -LiteralPath $backupPath -Force -ErrorAction SilentlyContinue
    }
    catch {
        if (Test-Path $temporaryPath) { Remove-Item -LiteralPath $temporaryPath -Force }
        if (Test-Path $backupPath) { Remove-Item -LiteralPath $backupPath -Force }
        throw
    }
}

function Wait-ForHttpSuccess {
    param([string]$Uri, [int]$Attempts = 30)

    for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
        try {
            $response = Invoke-WebRequest -Uri $Uri -TimeoutSec 5 -UseBasicParsing
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400) { return $true }
        }
        catch { Write-Host "Waiting for $Uri ($attempt/$Attempts)" }
        Start-Sleep -Seconds 2
    }
    return $false
}

function Test-DeploymentHealth {
    if (-not (Wait-ForHttpSuccess -Uri "$PublicBaseUrl/api/health")) { return $false }
    if (-not (Wait-ForHttpSuccess -Uri "$PublicBaseUrl/")) { return $false }

    try {
        $cacheBuster = [uri]::EscapeDataString($GitSha)
        $versionResponse = Invoke-RestMethod `
            -Uri "$PublicBaseUrl/version.json?release=$cacheBuster" `
            -TimeoutSec 10 `
            -Headers @{ 'Cache-Control' = 'no-cache, no-store' }
        if ($versionResponse.version -ne $Version -or $versionResponse.git_sha -ne $GitSha) {
            Write-Warning "Public frontend version mismatch at $PublicBaseUrl. Expected $Version ($GitSha), got $($versionResponse.version) ($($versionResponse.git_sha))."
            return $false
        }
    }
    catch {
        Write-Warning "Unable to verify public frontend version at $PublicBaseUrl/version.json: $($_.Exception.Message)"
        return $false
    }
    return $true
}

function Write-ReleaseRecord {
    param([string]$Result, [string]$Message)

    New-Item -ItemType Directory -Force -Path $ReleaseDir | Out-Null
    $record = [ordered]@{
        version = $Version
        git_sha = $GitSha
        previous_version = $PreviousVersion
        started_at = $script:ReleaseStartedAt.ToString('o')
        finished_at = (Get-Date).ToString('o')
        result = $Result
        rollback_attempted = $RollbackAttempted
        rollback_succeeded = $RollbackSucceeded
        message = $Message
    }
    [System.IO.File]::WriteAllText(
        (Join-Path $ReleaseDir "$Timestamp-$Version.json"),
        ($record | ConvertTo-Json -Depth 3),
        (New-Object System.Text.UTF8Encoding($false))
    )
}

$ReleaseStartedAt = Get-Date

try {
    foreach ($command in @('git', 'docker')) {
        if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { throw "Required command not found: $command" }
    }
    foreach ($path in @(
        $SourceDir, $DeployDir, $BackendDockerfile, $FrontendDockerfile, $PackageJson, $ComposeFile, $EnvFile,
        (Join-Path $DeployDir 'runtime\config\llm_api_config.json'),
        (Join-Path $DeployDir 'runtime\config\user_qualification.csv')
    )) {
        if (-not (Test-Path -LiteralPath $path)) { throw "Required path not found: $path" }
    }
    foreach ($directory in @(
        (Join-Path $DeployDir 'runtime\data'),
        (Join-Path $DeployDir 'runtime\scraper-output'),
        (Join-Path $DeployDir 'runtime\app-watch-data'),
        $ReleaseDir
    )) {
        New-Item -ItemType Directory -Force -Path $directory | Out-Null
    }
    $configuredPublicUrl = Get-EnvValue -Path $EnvFile -Key 'BROKER_PUBLIC_URL'
    if ($configuredPublicUrl) { $PublicBaseUrl = $configuredPublicUrl.TrimEnd('/') }

    $currentBranch = (git -C $SourceDir branch --show-current).Trim()
    Assert-LastExitCode 'Read current Git branch'
    if ($currentBranch -ne $ReleaseBranch) { throw "Release branch must be '$ReleaseBranch'; current branch is '$currentBranch'." }
    $sourceStatus = git -C $SourceDir status --porcelain
    Assert-LastExitCode 'Check source working tree'
    if ($sourceStatus) { throw 'Source repository has uncommitted or untracked changes.' }
    git -C $SourceDir fetch origin $ReleaseBranch --quiet
    Assert-LastExitCode 'Fetch release branch'
    $GitSha = (git -C $SourceDir rev-parse HEAD).Trim()
    Assert-LastExitCode 'Read source commit'
    $remoteSha = (git -C $SourceDir rev-parse "origin/$ReleaseBranch").Trim()
    Assert-LastExitCode 'Read remote release commit'
    if ($GitSha -ne $remoteSha) { throw "HEAD is not synchronized with origin/$ReleaseBranch. Run git pull --ff-only first." }

    $package = Get-Content -Raw $PackageJson | ConvertFrom-Json
    if ($package.version -ne $Version) { throw "frontend/package.json version is $($package.version), expected $Version." }
    $PreviousVersion = Get-EnvValue -Path $EnvFile -Key 'BROKER_VERSION'
    if (-not $PreviousVersion) { throw 'BROKER_VERSION is missing from the deployment .env file.' }
    if ($PreviousVersion -eq $Version -and -not $Force) { throw "Version $Version is already deployed. Use -Force to recreate it intentionally." }

    Push-Location $DeployDir
    try {
        docker compose config --quiet
        Assert-LastExitCode 'Validate Docker Compose configuration'
        $composeServices = @(docker compose config --services)
        Assert-LastExitCode 'Read Docker Compose services'
        foreach ($requiredService in @('backend-api', 'backend-scheduler', 'frontend', 'gateway')) {
            if ($composeServices -notcontains $requiredService) {
                throw "Required Compose service not found: $requiredService"
            }
        }
        # PowerShell treats -match/-notmatch on an array as a filtering
        # operation. Capture the rendered Compose config as one string so a
        # non-matching line cannot make this validation fail.
        $composeConfig = docker compose config | Out-String
        Assert-LastExitCode 'Read Docker Compose mounts'
        if ($composeConfig -notmatch 'app-watch-data') {
            throw 'Production Compose must mount runtime/app-watch-data into backend-api.'
        }
    }
    finally { Pop-Location }

    Write-Host "Building $BackendImage from $GitSha"
    docker build --label "org.opencontainers.image.version=$Version" --label "org.opencontainers.image.revision=$GitSha" -f $BackendDockerfile -t $BackendImage $SourceDir
    Assert-LastExitCode 'Build backend image'
    docker run --rm --entrypoint /app/broker-app-watch/.venv/bin/python $BackendImage -c "import broker_app_watch; print('broker-app-watch import ok')"
    Assert-LastExitCode 'Validate broker-app-watch image import'
    Write-Host "Building $FrontendImage from $GitSha"
    docker build --build-arg "APP_VERSION=$Version" --build-arg "GIT_SHA=$GitSha" --label "org.opencontainers.image.version=$Version" --label "org.opencontainers.image.revision=$GitSha" -f $FrontendDockerfile -t $FrontendImage $SourceDir
    Assert-LastExitCode 'Build frontend image'

    New-Item -ItemType Directory -Force -Path $ReleaseDir | Out-Null
    Copy-Item -LiteralPath $EnvFile -Destination (Join-Path $ReleaseDir ".env.before-$Timestamp.bak") -Force
    Set-EnvValue -Path $EnvFile -Key 'BROKER_VERSION' -Value $Version
    $DeploymentStarted = $true
    Push-Location $DeployDir
    try {
        docker compose up -d --force-recreate --pull never backend-api backend-scheduler frontend gateway
        Assert-LastExitCode 'Recreate release containers'
        docker compose ps
    }
    finally { Pop-Location }
    if (-not (Test-DeploymentHealth)) { throw 'New version failed gateway health validation.' }

    Write-ReleaseRecord -Result 'succeeded' -Message 'Gateway API and homepage health checks passed.'
    Write-Host "Version $Version deployed successfully. Open: $PublicBaseUrl"
}
catch {
    $failureMessage = $_.Exception.Message
    if ($DeploymentStarted -and $PreviousVersion) {
        $RollbackAttempted = $true
        Write-Warning "Deployment failed. Restoring version $PreviousVersion."
        try {
            Set-EnvValue -Path $EnvFile -Key 'BROKER_VERSION' -Value $PreviousVersion
            Push-Location $DeployDir
            try { docker compose up -d --force-recreate --pull never backend-api backend-scheduler frontend gateway; Assert-LastExitCode 'Recreate rollback containers' }
            finally { Pop-Location }
            $RollbackSucceeded = Test-DeploymentHealth
            if (-not $RollbackSucceeded) { throw 'Rollback containers did not pass gateway health validation.' }
        }
        catch { $failureMessage = "$failureMessage Rollback failed: $($_.Exception.Message)" }
    }
    Write-ReleaseRecord -Result 'failed' -Message $failureMessage
    throw $failureMessage
}
