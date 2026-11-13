<#
server.ps1 - run this project's Docker Compose stack.
Made from the Topia `stack` skill template. Pair: server.sh (macOS/Linux).

  .\server.ps1 start   [service...]                start (or apply config changes)
  .\server.ps1 build   [service...] [-NoCache]     rebuild images, then recreate
  .\server.ps1 restart [service...]                restart containers as they are
  .\server.ps1 stop    [service...]                stop; no service = take the stack down
  .\server.ps1 logs    [service...] [-Since 10m] [-Tail 200] [-Follow]
  .\server.ps1 status                              containers, health, health URL
  .\server.ps1 prune   [-Volumes]                  free disk; volumes only when asked
  .\server.ps1 env                                 .env vs .env.example, keys only

Add -DryRun to print the docker commands without running them.
Works with Windows PowerShell 5.1 and PowerShell 7 (Windows, macOS, Linux).
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [string]$Command = 'help',
  [Parameter(Position = 1, ValueFromRemainingArguments = $true)]
  [string[]]$Services = @(),
  [string]$Since = '',
  [int]$Tail = 0,
  [switch]$Follow,
  [switch]$NoCache,
  [switch]$Pull,
  [switch]$Volumes,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$Services = @($Services | Where-Object { $_ })

# ---- Settings. Environment variables override these. ------------------------
function Get-Setting([string]$Name, [string]$Default) {
  $value = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrEmpty($value)) { return $Default }
  return $value
}
$ProjectName  = Get-Setting 'STACK_PROJECT' ''         # empty = Compose default (folder name)
$ComposeFiles = Get-Setting 'STACK_COMPOSE_FILES' ''   # space-separated; empty = Compose auto-detect
$Profiles     = Get-Setting 'STACK_PROFILES' ''        # space-separated Compose profiles to enable
$Root         = Get-Setting 'STACK_ROOT' '.'           # compose folder, relative to this script
$HealthUrl    = Get-Setting 'STACK_HEALTH_URL' ''      # e.g. http://127.0.0.1:8080/health
$LogTail      = [int](Get-Setting 'STACK_LOG_TAIL' '200')
$Docker       = Get-Setting 'STACK_DOCKER' 'docker'
if ((Get-Setting 'STACK_DRY_RUN' '0') -eq '1') { $DryRun = [switch]$true }
# -----------------------------------------------------------------------------

if ([System.IO.Path]::IsPathRooted($Root)) { Set-Location -LiteralPath $Root }
else { Set-Location -LiteralPath (Join-Path $PSScriptRoot $Root) }

function Write-Note([string]$Text) { [Console]::Error.WriteLine($Text) }

function Stop-Script([string]$Text, [int]$Code = 1) {
  Write-Note "server.ps1: $Text"
  exit $Code
}

function Show-Usage {
  $lines = Get-Content -LiteralPath $PSCommandPath -TotalCount 15 | Select-Object -Skip 1
  $lines | ForEach-Object { Write-Output $_ }
}

function Invoke-Step([string[]]$CommandLine) {
  if ($DryRun) {
    Write-Output ($CommandLine -join ' ')
    return
  }
  Write-Note ('+ ' + ($CommandLine -join ' '))
  $exe = $CommandLine[0]
  $rest = @()
  if ($CommandLine.Count -gt 1) { $rest = $CommandLine[1..($CommandLine.Count - 1)] }
  & $exe @rest
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

function Invoke-Compose([string[]]$Arguments) {
  $cmd = @($Docker, 'compose')
  if ($ProjectName) { $cmd += @('-p', $ProjectName) }
  foreach ($f in ($ComposeFiles -split '\s+' | Where-Object { $_ })) { $cmd += @('-f', $f) }
  foreach ($p in ($Profiles -split '\s+' | Where-Object { $_ })) { $cmd += @('--profile', $p) }
  Invoke-Step ($cmd + $Arguments)
}

function Assert-ComposeFile {
  $files = @($ComposeFiles -split '\s+' | Where-Object { $_ })
  if ($files.Count -gt 0) {
    foreach ($f in $files) { if (-not (Test-Path -LiteralPath $f -PathType Leaf)) { Stop-Script "compose file not found: $f" 3 } }
    return
  }
  foreach ($f in @('compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml')) {
    if (Test-Path -LiteralPath $f -PathType Leaf) { return }
  }
  Stop-Script "no compose file here ($((Get-Location).Path))" 3
}

# KEY names from a dotenv file. Values are never returned or printed.
function Get-EnvKeys([string]$Path) {
  $keys = New-Object System.Collections.Generic.List[string]
  foreach ($line in [System.IO.File]::ReadAllLines((Resolve-Path -LiteralPath $Path).Path)) {
    if ($line -match '^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=') {
      if (-not $keys.Contains($Matches[1])) { $keys.Add($Matches[1]) }
    }
  }
  return ,$keys
}

function Test-EnvKeys {
  $example = $null
  foreach ($f in @('.env.example', '.env.sample', '.env.template')) {
    if (Test-Path -LiteralPath $f -PathType Leaf) { $example = $f; break }
  }
  if (-not $example) { return }
  if (-not (Test-Path -LiteralPath '.env' -PathType Leaf)) {
    Write-Note "warning: .env is missing. Copy $example to .env and fill in the values."
    return
  }
  $have = Get-EnvKeys '.env'
  $missing = @((Get-EnvKeys $example) | Where-Object { -not $have.Contains($_) })
  if ($missing.Count -gt 0) { Write-Note ("warning: keys in $example but not in .env: " + ($missing -join ' ')) }
  else { Write-Note "env: every key in $example is in .env" }
}

function Invoke-Start {
  Test-EnvKeys
  Invoke-Compose (@('up', '-d', '--remove-orphans') + $Services)
}

function Invoke-Build {
  $opts = @()
  if ($NoCache) { $opts += '--no-cache' }
  if ($Pull) { $opts += '--pull' }
  Test-EnvKeys
  if ($Services.Count -gt 0) {
    # One service: rebuild it and recreate only it, not its dependencies.
    Invoke-Compose (@('build') + $opts + $Services)
    Invoke-Compose (@('up', '-d', '--no-deps') + $Services)
  } else {
    Invoke-Compose (@('build') + $opts)
    Invoke-Compose @('up', '-d', '--remove-orphans')
  }
}

function Invoke-Restart {
  # restart keeps the old container config. After editing compose or .env, use start.
  Invoke-Compose (@('restart') + $Services)
}

function Invoke-Stop {
  if ($Services.Count -gt 0) { Invoke-Compose (@('stop') + $Services) }
  else { Invoke-Compose @('down', '--remove-orphans') }
}

function Invoke-Logs {
  $n = $LogTail
  if ($Tail -gt 0) { $n = $Tail }
  $logArgs = @('logs', '--tail', "$n")
  if ($Since) { $logArgs += @('--since', $Since) }
  if ($Follow) { $logArgs += '--follow' }
  Invoke-Compose ($logArgs + $Services)
}

function Invoke-Status {
  Invoke-Compose @('ps', '--all')
  if (-not $HealthUrl) { return }
  if ($DryRun) { Write-Output "GET $HealthUrl"; return }
  try {
    $response = Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
    Write-Note "health: $HealthUrl -> HTTP $($response.StatusCode)"
  } catch {
    Write-Note "health: $HealthUrl -> failed ($($_.Exception.Message))"
    exit 1
  }
}

function Invoke-Prune {
  # Safe by default: dangling images and old build cache. Data volumes stay.
  Invoke-Step @($Docker, 'image', 'prune', '-f')
  Invoke-Step @($Docker, 'builder', 'prune', '-f', '--filter', 'until=24h')
  if (-not $Volumes) { return }
  $name = $ProjectName
  if (-not $name) { $name = Split-Path -Leaf (Get-Location).Path }
  Write-Note "This deletes the named volumes of project '$name'. Their data is gone for good."
  Invoke-Compose @('config', '--volumes')
  $answer = Get-Setting 'STACK_CONFIRM' ''
  if (-not $answer -and [Environment]::UserInteractive -and -not [Console]::IsInputRedirected) {
    $answer = Read-Host "Type the project name ($name) to delete these volumes"
  }
  if ($answer -ne $name) { Stop-Script 'volumes kept (confirmation did not match)' 5 }
  Invoke-Compose @('down', '--volumes', '--remove-orphans')
}

switch ($Command) {
  { $_ -in @('help', '-h', '--help') } { Show-Usage; exit 0 }
  'env' { Test-EnvKeys; exit 0 }
  { $_ -in @('start', 'build', 'restart', 'stop', 'logs', 'status', 'prune') } { break }
  default {
    Write-Note "server.ps1: unknown command '$Command'"
    Show-Usage | ForEach-Object { Write-Note $_ }
    exit 2
  }
}

Assert-ComposeFile
switch ($Command) {
  'start' { Invoke-Start }
  'build' { Invoke-Build }
  'restart' { Invoke-Restart }
  'stop' { Invoke-Stop }
  'logs' { Invoke-Logs }
  'status' { Invoke-Status }
  'prune' { Invoke-Prune }
}
exit 0
