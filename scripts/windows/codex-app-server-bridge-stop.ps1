param(
  [string]$RepoRoot = "",
  [string]$StateDir = "",
  [string]$AgentName = ""
)

$ErrorActionPreference = "Stop"

function Resolve-PreferredAgentName {
  param([string]$RequestedName)

  if (-not [string]::IsNullOrWhiteSpace($RequestedName)) {
    return $RequestedName.Trim()
  }

  foreach ($envName in @("TAP_AGENT_NAME", "CODEX_TAP_AGENT_NAME")) {
    $candidate = [Environment]::GetEnvironmentVariable($envName)
    if (-not [string]::IsNullOrWhiteSpace($candidate)) {
      return $candidate.Trim()
    }
  }

  return ""
}

function Get-StateDirNameFragment {
  param([string]$AgentNameValue)

  if ([string]::IsNullOrWhiteSpace($AgentNameValue)) {
    return ""
  }

  $normalized = $AgentNameValue.Trim() -replace '[<>:"/\\|?*\x00-\x1F]', "-"
  $normalized = $normalized.Trim().TrimEnd(".")
  if ([string]::IsNullOrWhiteSpace($normalized)) {
    return "agent"
  }

  return $normalized
}

function Get-DefaultStateDir {
  param(
    [string]$ResolvedRepoRoot,
    [string]$PreferredAgentName
  )

  $baseName = ".tmp\codex-app-server-bridge"
  $fragment = Get-StateDirNameFragment -AgentNameValue $PreferredAgentName
  if (-not [string]::IsNullOrWhiteSpace($fragment)) {
    $baseName = "$baseName-$fragment"
  }

  return (Join-Path $ResolvedRepoRoot $baseName)
}

function Resolve-RepoRoot {
  param([string]$ExplicitRepoRoot)

  if (-not [string]::IsNullOrWhiteSpace($ExplicitRepoRoot)) {
    return (Resolve-Path $ExplicitRepoRoot).Path
  }

  if ($PSScriptRoot) {
    return (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
  }

  return (Get-Location).Path
}

function Resolve-StateDir {
  param(
    [string]$ResolvedRepoRoot,
    [string]$ExplicitStateDir,
    [string]$PreferredAgentName
  )

  $target = if (-not [string]::IsNullOrWhiteSpace($ExplicitStateDir)) {
    $ExplicitStateDir
  } else {
    Get-DefaultStateDir -ResolvedRepoRoot $ResolvedRepoRoot -PreferredAgentName $PreferredAgentName
  }

  if (Test-Path $target) {
    return (Resolve-Path $target).Path
  }

  return $target
}

function Get-BridgeMetaPath {
  param([string]$ResolvedStateDir)

  return (Join-Path $ResolvedStateDir "bridge-daemon.json")
}

$resolvedRepoRoot = Resolve-RepoRoot -ExplicitRepoRoot $RepoRoot
$preferredAgentName = Resolve-PreferredAgentName -RequestedName $AgentName
$resolvedStateDir = Resolve-StateDir `
  -ResolvedRepoRoot $resolvedRepoRoot `
  -ExplicitStateDir $StateDir `
  -PreferredAgentName $preferredAgentName
$metaPath = Get-BridgeMetaPath -ResolvedStateDir $resolvedStateDir

if (-not (Test-Path $metaPath)) {
  Write-Host "bridge not running"
  exit 0
}

$meta = Get-Content -Path $metaPath -Encoding utf8 | ConvertFrom-Json
$proc = Get-Process -Id $meta.pid -ErrorAction SilentlyContinue
if ($proc) {
  Stop-Process -Id $meta.pid -Force -ErrorAction SilentlyContinue
  Write-Host ("stopped bridge pid {0}" -f $meta.pid) -ForegroundColor Green
} else {
  Write-Host "bridge process already stopped" -ForegroundColor Yellow
}

foreach ($fileName in @("bridge-daemon.json", "heartbeat.json")) {
  $path = Join-Path $resolvedStateDir $fileName
  if (Test-Path $path) {
    Remove-Item -Path $path -Force -ErrorAction SilentlyContinue
  }
}
