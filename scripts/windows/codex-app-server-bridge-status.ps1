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
  Write-Host ("  state: {0}" -f $resolvedStateDir)
  exit 0
}

$meta = Get-Content -Path $metaPath -Encoding utf8 | ConvertFrom-Json
$proc = Get-Process -Id $meta.pid -ErrorAction SilentlyContinue
$heartbeatPath = Join-Path $resolvedStateDir "heartbeat.json"
$heartbeat = if (Test-Path $heartbeatPath) {
  Get-Content -Path $heartbeatPath -Encoding utf8 | ConvertFrom-Json
} else {
  $null
}
$threadPath = Join-Path $resolvedStateDir "thread.json"
$thread = if (Test-Path $threadPath) {
  Get-Content -Path $threadPath -Encoding utf8 | ConvertFrom-Json
} else {
  $null
}
$lastDispatchPath = Join-Path $resolvedStateDir "last-dispatch.json"
$lastDispatch = if (Test-Path $lastDispatchPath) {
  Get-Content -Path $lastDispatchPath -Encoding utf8 | ConvertFrom-Json
} else {
  $null
}
$processedDir = Join-Path $resolvedStateDir "processed"
$processedCount = @(Get-ChildItem -Path $processedDir -Filter *.done -File -ErrorAction SilentlyContinue).Count

$status = if ($proc) { "running" } else { "stopped" }
Write-Host ("bridge status: {0}" -f $status) -ForegroundColor $(if ($proc) { "Green" } else { "Yellow" })
Write-Host ("  pid:       {0}" -f $meta.pid)
Write-Host ("  agent:     {0}" -f $meta.agentName)
Write-Host ("  started:   {0}" -f $meta.startedAt)
Write-Host ("  state:     {0}" -f $resolvedStateDir)
Write-Host ("  appserver: {0}" -f $meta.appServerUrl)
Write-Host ("  busy-mode: {0}" -f $meta.busyMode)
Write-Host ("  poll:      {0}s" -f $meta.pollSeconds)
Write-Host ("  reconnect: {0}s" -f $meta.reconnectSeconds)
if ($meta.processExistingMessages) {
  Write-Host "  lookback:  existing messages"
} else {
  Write-Host ("  lookback:  {0} minute(s)" -f $meta.messageLookbackMinutes)
}
Write-Host ("  processed: {0}" -f $processedCount)
if ($heartbeat) {
  $updatedAt = [DateTime]::Parse($heartbeat.updatedAt)
  $lag = [Math]::Round(([DateTime]::UtcNow - $updatedAt.ToUniversalTime()).TotalSeconds, 1)
  Write-Host ("  heartbeat: {0} ({1}s ago)" -f $heartbeat.updatedAt, $lag)
  Write-Host ("  connected: {0}" -f $heartbeat.connected)
  Write-Host ("  thread:    {0}" -f $heartbeat.threadId)
  Write-Host ("  turn:      {0}" -f $heartbeat.activeTurnId)
  Write-Host ("  last turn: {0}" -f $heartbeat.lastTurnStatus)
  Write-Host ("  notify:    {0}" -f $heartbeat.lastNotificationMethod)
  if ($heartbeat.lastError) {
    Write-Host ("  error:     {0}" -f $heartbeat.lastError) -ForegroundColor Yellow
  }
} elseif ($thread) {
  Write-Host ("  thread:    {0}" -f $thread.threadId)
}
if ($lastDispatch) {
  Write-Host ("  request:   {0}" -f $lastDispatch.requestName)
  Write-Host ("  dispatch:  {0}" -f $lastDispatch.dispatchMode)
  Write-Host ("  from:      {0}" -f $lastDispatch.sender)
  Write-Host ("  sent:      {0}" -f $lastDispatch.dispatchedAt)
}
Write-Host ("  stdout:    {0}" -f $meta.stdout)
Write-Host ("  stderr:    {0}" -f $meta.stderr)
