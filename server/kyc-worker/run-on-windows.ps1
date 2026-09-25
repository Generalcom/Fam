# Runs the Family Circle identity-check worker on this Windows PC with Docker Desktop.
#
# Run it in PowerShell:
#   powershell -ExecutionPolicy Bypass -File .\run-on-windows.ps1
#
# The first time it asks for your Supabase details and saves them in %USERPROFILE%\kyc-worker\kyc.env (readable only
# by you). Run it again at any time to update to the newest image; it keeps your settings.
# Options:
#   -Reconfigure   ask for the Supabase details again
#   -Build         build the image from this folder instead of downloading it from GitHub
#   -Stop          stop and remove the worker

param(
    [switch]$Reconfigure,
    [switch]$Build,
    [switch]$Stop
)

# Docker writes normal progress to stderr, which Windows PowerShell 5.1 would treat as a failure under 'Stop',
# so failures are checked with $LASTEXITCODE instead.
$ErrorActionPreference = 'Continue'
$Image = 'ghcr.io/generalcom/fam-kyc-worker:latest'
$LocalImage = 'kyc-worker:local'
$Name = 'kyc-worker'
$ConfigDir = Join-Path $env:USERPROFILE 'kyc-worker'
$EnvFile = Join-Path $ConfigDir 'kyc.env'

function Say($text, $color = 'Cyan') { Write-Host "`n==> $text" -ForegroundColor $color }
function Fail($text) { Write-Host "`nERROR: $text" -ForegroundColor Red; exit 1 }

# ---------- Docker ----------
Say 'Checking Docker'
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Fail "Docker is not installed. Install Docker Desktop from https://www.docker.com/products/docker-desktop/, start it once, then run this script again."
}
docker info *> $null
if ($LASTEXITCODE -ne 0) {
    $desktop = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
    if (Test-Path $desktop) {
        Write-Host 'Starting Docker Desktop...'
        Start-Process $desktop
        for ($i = 0; $i -lt 60; $i++) {
            Start-Sleep -Seconds 3
            docker info *> $null
            if ($LASTEXITCODE -eq 0) { break }
        }
    }
    docker info *> $null
    if ($LASTEXITCODE -ne 0) { Fail 'Docker Desktop is not running. Start it, wait until it says "Engine running", then run this script again.' }
}
Write-Host 'Docker is running.'

if ($Stop) {
    docker rm -f $Name *> $null
    Say "The worker is stopped and removed. Your settings are kept in $EnvFile" 'Green'
    exit 0
}

# ---------- Settings ----------
if ($Reconfigure -or -not (Test-Path $EnvFile)) {
    Say 'Supabase settings (Supabase > Project Settings > API)'
    do {
        $url = (Read-Host 'Project URL (https://xxxx.supabase.co)').Trim().TrimEnd('/')
    } until ($url -match '^https://\S+$')
    $secure = Read-Host 'service_role key (hidden while you type)' -AsSecureString
    $key = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)).Trim()
    if ($key.Length -lt 40) { Fail 'That does not look like a service_role key. Copy the whole "service_role" secret.' }

    Write-Host "`nWhen a check fails, should the person be rejected automatically (they see why and retake the photos),"
    Write-Host 'or should it wait for you to review it in Supabase? Waiting is safer while the checks are new.'
    $review = Read-Host 'Wait for your review on failures? [Y/n]'
    $reviewFailures = if ($review -match '^[nN]') { 'false' } else { 'true' }

    New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null
    @(
        "SUPABASE_URL=$url",
        "SUPABASE_SERVICE_ROLE_KEY=$key",
        "REVIEW_FAILURES=$reviewFailures",
        'POLL_SECONDS=30'
    ) | Set-Content -Path $EnvFile -Encoding ascii

    # Only you (and SYSTEM / Administrators) can read the file with the key in it.
    icacls $EnvFile /inheritance:r /grant:r "${env:USERDOMAIN}\${env:USERNAME}:(R,W)" '*S-1-5-18:(F)' '*S-1-5-32-544:(F)' | Out-Null

    # Check the key works before starting anything.
    Say 'Checking the Supabase details'
    try {
        $headers = @{ apikey = $key; Authorization = "Bearer $key" }
        Invoke-RestMethod -ErrorAction Stop -Uri "$url/rest/v1/kyc_submissions?select=user_id&limit=1" -Headers $headers -TimeoutSec 20 | Out-Null
        Write-Host 'Connected. The kyc_submissions table is there.'
    } catch {
        $code = $_.Exception.Response.StatusCode.value__
        if ($code -eq 401 -or $code -eq 403) { Fail 'Supabase refused the key. Make sure you copied the service_role key, then run with -Reconfigure.' }
        if ($code -eq 404 -or "$_" -match 'kyc_submissions') { Fail 'The kyc_submissions table is missing. Run supabase/enrolment.sql in the Supabase SQL editor first.' }
        Fail "Could not reach Supabase: $_"
    }
} else {
    Write-Host "Using saved settings from $EnvFile (run with -Reconfigure to change them)."
}

# ---------- Image ----------
if ($Build) {
    Say 'Building the image from this folder (takes a few minutes the first time)'
    docker build -t $LocalImage $PSScriptRoot
    if ($LASTEXITCODE -ne 0) { Fail 'The build failed. See the messages above.' }
    $useImage = $LocalImage
} else {
    Say "Downloading the newest image ($Image)"
    docker pull $Image
    if ($LASTEXITCODE -ne 0) {
        Write-Host "`nGitHub needs you to log in because the image is private." -ForegroundColor Yellow
        Write-Host 'Create a token at https://github.com/settings/tokens/new with only "read:packages" ticked.'
        $user = Read-Host 'GitHub username'
        $tokenSecure = Read-Host 'Token (hidden)' -AsSecureString
        $token = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($tokenSecure))
        $token | docker login ghcr.io -u $user --password-stdin
        if ($LASTEXITCODE -ne 0) { Fail 'GitHub login failed. Check the username and token.' }
        docker pull $Image
        if ($LASTEXITCODE -ne 0) { Fail 'Still could not download the image. You can build it yourself instead: run this script with -Build from the server\kyc-worker folder of the repo.' }
    }
    $useImage = $Image
}

# ---------- Run ----------
Say 'Starting the worker'
docker rm -f $Name *> $null
docker run -d --name $Name --restart unless-stopped --env-file $EnvFile $useImage | Out-Null
if ($LASTEXITCODE -ne 0) { Fail 'The worker did not start. See the messages above.' }

Start-Sleep -Seconds 8
$state = docker inspect -f '{{.State.Status}}' $Name
if ($state -ne 'running') {
    docker logs $Name
    Fail 'The worker stopped straight away. The log above says why.'
}
docker logs $Name

# ---------- Keep it running ----------
Say 'Keeping it running'
Write-Host 'The worker restarts by itself whenever Docker Desktop starts. Make sure Docker Desktop starts with Windows:'
Write-Host 'Docker Desktop > Settings > General > "Start Docker Desktop when you sign in".' -ForegroundColor Yellow
$sleep = Read-Host 'Stop this PC going to sleep while it is plugged in, so checks keep running? [Y/n]'
if ($sleep -notmatch '^[nN]') {
    powercfg /change standby-timeout-ac 0
    powercfg /change hibernate-timeout-ac 0
    Write-Host 'Sleep is off while plugged in. (Undo in Settings > System > Power.)'
}

Say 'Done. The worker checks new submissions every 30 seconds.' 'Green'
Write-Host @"
  Watch it:        docker logs -f $Name
  Update it:       run this script again
  Change settings: run this script with -Reconfigure
  Stop it:         run this script with -Stop
"@
