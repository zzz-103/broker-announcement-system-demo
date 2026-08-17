[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^\d+\.\d+\.\d+$')]
    [string]$Version,

    [switch]$Force,

    [Parameter(Mandatory = $true)]
    [string]$DeployDir,

    [string]$ReleaseBranch = 'master'
)

$ErrorActionPreference = 'Stop'
$SourceDir = Split-Path -Parent $PSScriptRoot
$BackendDockerfile = Join-Path $SourceDir 'backend.Dockerfile'
$BackendDockerfileFallback = Join-Path $SourceDir 'backend.Dockerfile.fallback'
$FrontendDockerfile = Join-Path $SourceDir 'frontend.Dockerfile'
$FrontendDockerfileFallback = Join-Path $SourceDir 'frontend.Dockerfile.fallback'
$PackageJson = Join-Path $SourceDir 'frontend\package.json'
$ComposeFile = Join-Path $DeployDir 'docker-compose.yml'
$EnvFile = Join-Path $DeployDir '.env'
$ReleaseDir = Join-Path $DeployDir 'deploy\releases'
$Timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$Registry = '172.16.96.238:5000'
$BackendImage = "$Registry/broker-backend:v$Version"
$FrontendImage = "$Registry/broker-frontend:v$Version"
$DeploymentStarted = $false
$RollbackAttempted = $false
$RollbackSucceeded = $false
$PreviousVersion = $null
$GitSha = $null
$PublicBaseUrl = 'http://localhost:8080'
$BuildKitProbeTimeoutSeconds = 45
$BuildKitBuildTimeoutSeconds = 900
$FallbackBuildTimeoutSeconds = 1800

function Assert-LastExitCode {
    param([string]$Step)

    if ($LASTEXITCODE -ne 0) {
        throw "$Step failed. Exit code: $LASTEXITCODE"
    }
}

function ConvertTo-ProcessArgument {
    param([AllowEmptyString()][string]$Value)

    if ($null -eq $Value -or $Value.Length -eq 0) { return '""' }
    if ($Value -notmatch '[\s"]') { return $Value }
    return '"' + $Value.Replace('"', '\"') + '"'
}

function Invoke-DockerWithTimeout {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments,

        [Parameter(Mandatory = $true)]
        [int]$TimeoutSeconds
    )

    $argumentString = ($Arguments | ForEach-Object { ConvertTo-ProcessArgument $_ }) -join ' '
    $process = Start-Process -FilePath 'docker' -ArgumentList $argumentString -NoNewWindow -PassThru
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
        Write-Warning "Docker command timed out after ${TimeoutSeconds}s: docker $argumentString"
        try { $process.Kill($true) }
        catch { $process.Kill() }
        $process.WaitForExit()
        return [pscustomobject]@{ ExitCode = -124; TimedOut = $true }
    }

    return [pscustomobject]@{ ExitCode = $process.ExitCode; TimedOut = $false }
}

function Invoke-ReleaseImageBuild {
    param(
        [string]$Image,
        [string]$Dockerfile,
        [string]$FallbackDockerfile,
        [string[]]$BuildArguments = @()
    )

    $buildxReady = $true
    try {
        $buildxVersion = Invoke-DockerWithTimeout -Arguments @('buildx', 'version') -TimeoutSeconds $BuildKitProbeTimeoutSeconds
        if ($buildxVersion.TimedOut -or $buildxVersion.ExitCode -ne 0) { $buildxReady = $false }
        if ($buildxReady) {
            $buildxBootstrap = Invoke-DockerWithTimeout -Arguments @('buildx', 'inspect', '--bootstrap') -TimeoutSeconds $BuildKitProbeTimeoutSeconds
            if ($buildxBootstrap.TimedOut -or $buildxBootstrap.ExitCode -ne 0) { $buildxReady = $false }
        }
    }
    catch {
        Write-Warning "Unable to probe BuildKit/buildx: $($_.Exception.Message)"
        $buildxReady = $false
    }

    if ($buildxReady) {
        Write-Host "Building $Image with BuildKit/buildx cache"
        $buildxArguments = @('buildx', 'build', '--platform', 'linux/amd64', '--load', '--network', 'host') + $BuildArguments + @('-f', $Dockerfile, '-t', $Image, $SourceDir)
        $buildxBuild = Invoke-DockerWithTimeout -Arguments $buildxArguments -TimeoutSeconds $BuildKitBuildTimeoutSeconds
        if (-not $buildxBuild.TimedOut -and $buildxBuild.ExitCode -eq 0) { return }
        Write-Warning "BuildKit build failed or timed out for $Image; retrying with the compatibility Dockerfile."
    }
    else {
        Write-Warning "BuildKit/buildx is unavailable; using the compatibility Dockerfile for $Image."
    }

    $fallbackArguments = @('build', '--platform', 'linux/amd64') + $BuildArguments + @('-f', $FallbackDockerfile, '-t', $Image, $SourceDir)
    $fallbackBuild = Invoke-DockerWithTimeout -Arguments $fallbackArguments -TimeoutSeconds $FallbackBuildTimeoutSeconds
    if ($fallbackBuild.TimedOut) { throw "Fallback Docker build timed out: $Image" }
    if ($fallbackBuild.ExitCode -ne 0) { throw "Fallback Docker build failed: $Image (exit code $($fallbackBuild.ExitCode))" }
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
        $SourceDir, $DeployDir, $BackendDockerfile, $BackendDockerfileFallback, $FrontendDockerfile, $FrontendDockerfileFallback, $PackageJson, $ComposeFile, $EnvFile,
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
        foreach ($requiredService in @('backend-api', 'backend-scheduler', 'frontend')) {
            if ($composeServices -notcontains $requiredService) {
                throw "Required Compose service not found: $requiredService"
            }
        }
        # PowerShell treats -match/-notmatch on an array as a filtering
        # operation. Capture the rendered Compose config as one string so a
        # non-matching line cannot make this validation fail.
        $composeConfig = docker compose config | Out-String
        Assert-LastExitCode 'Read Docker Compose mounts'
        if (
            $composeConfig -notmatch 'app-watch-data' -or
            $composeConfig -notmatch '/app/backend/data/broker_app_watch'
        ) {
            throw 'Production Compose must mount runtime/app-watch-data at /app/backend/data/broker_app_watch.'
        }
    }
    finally { Pop-Location }

    Invoke-ReleaseImageBuild -Image $BackendImage -Dockerfile $BackendDockerfile -FallbackDockerfile $BackendDockerfileFallback -BuildArguments @(
        '--label', "org.opencontainers.image.version=$Version",
        '--label', "org.opencontainers.image.revision=$GitSha"
    )
    docker run --rm --entrypoint python $BackendImage -c "import backend.broker_app_watch.cli; print('broker app watch import ok')"
    Assert-LastExitCode 'Validate broker app watch image import'
    Invoke-ReleaseImageBuild -Image $FrontendImage -Dockerfile $FrontendDockerfile -FallbackDockerfile $FrontendDockerfileFallback -BuildArguments @(
        '--build-arg', "APP_VERSION=$Version",
        '--build-arg', "GIT_SHA=$GitSha",
        '--label', "org.opencontainers.image.version=$Version",
        '--label', "org.opencontainers.image.revision=$GitSha"
    )
    foreach ($image in @($BackendImage, $FrontendImage)) {
        $architecture = (docker image inspect $image --format '{{.Architecture}}').Trim()
        Assert-LastExitCode "Inspect image architecture: $image"
        if ($architecture -ne 'amd64') { throw "Image $image has architecture '$architecture', expected 'amd64'." }
    }

    Set-EnvValue -Path $EnvFile -Key 'BROKER_VERSION' -Value $Version
    $DeploymentStarted = $true
    Push-Location $DeployDir
    try {
        docker compose up -d --force-recreate --pull never backend-api backend-scheduler frontend
        Assert-LastExitCode 'Recreate release containers'
        docker compose ps
    }
    finally { Pop-Location }
    if (-not (Test-DeploymentHealth)) { throw 'New version failed public health validation.' }

    Write-ReleaseRecord -Result 'succeeded' -Message 'Public API and homepage health checks passed.'
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
            try { docker compose up -d --force-recreate --pull never backend-api backend-scheduler frontend; Assert-LastExitCode 'Recreate rollback containers' }
            finally { Pop-Location }
            $RollbackSucceeded = Test-DeploymentHealth
            if (-not $RollbackSucceeded) { throw 'Rollback containers did not pass public health validation.' }
        }
        catch { $failureMessage = "$failureMessage Rollback failed: $($_.Exception.Message)" }
    }
    Write-ReleaseRecord -Result 'failed' -Message $failureMessage
    throw $failureMessage
}
