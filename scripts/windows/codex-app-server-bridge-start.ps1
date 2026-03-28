param(
  [string]$RepoRoot = "",
  [string]$CommsDir = "",
  [string]$AgentName = "",
  [string]$StateDir = "",
  [string]$AppServerUrl = "ws://127.0.0.1:4501",
  [ValidateSet("wait", "steer")]
  [string]$BusyMode = "steer",
  [int]$PollSeconds = 5,
  [int]$ReconnectSeconds = 5,
  [int]$MessageLookbackMinutes = 10,
  [string]$ThreadId = "",
  [switch]$ProcessExistingMessages,
  [switch]$Ephemeral,
  [switch]$Restart
)

$ErrorActionPreference = "Stop"
$script:DefaultAgent = -join ([char[]](0xC628))

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

function Convert-TapPath {
  param([string]$PathValue)

  if ([string]::IsNullOrWhiteSpace($PathValue)) {
    return $PathValue
  }

  $trimmed = $PathValue.Trim().Trim([char]39, [char]34, [char]96)
  if ($trimmed -match "^[A-Za-z]:\\") {
    return $trimmed
  }

  if ($trimmed -match "^/([A-Za-z])/(.*)$") {
    $drive = $matches[1].ToUpperInvariant()
    $rest = $matches[2].Replace("/", "\")
    return "${drive}:\$rest"
  }

  return $trimmed
}

function Resolve-RepoRoot {
  param([string]$ExplicitRepoRoot)

  if (-not [string]::IsNullOrWhiteSpace($ExplicitRepoRoot)) {
    return (Resolve-Path $ExplicitRepoRoot).Path
  }

  if ($PSScriptRoot) {
    return (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
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

  if (-not (Test-Path $target)) {
    New-Item -ItemType Directory -Path $target -Force | Out-Null
  }

  foreach ($child in @("logs", "processed")) {
    $path = Join-Path $target $child
    if (-not (Test-Path $path)) {
      New-Item -ItemType Directory -Path $path -Force | Out-Null
    }
  }

  return (Resolve-Path $target).Path
}

function Resolve-AgentName {
  param(
    [string]$RequestedName,
    [string]$ResolvedStateDir
  )

  if (-not [string]::IsNullOrWhiteSpace($RequestedName)) {
    return $RequestedName.Trim()
  }

  foreach ($envName in @("TAP_AGENT_NAME", "CODEX_TAP_AGENT_NAME")) {
    $candidate = [Environment]::GetEnvironmentVariable($envName)
    if (-not [string]::IsNullOrWhiteSpace($candidate)) {
      return $candidate.Trim()
    }
  }

  $agentFile = Join-Path $ResolvedStateDir "agent-name.txt"
  if (Test-Path $agentFile) {
    $candidate = Get-Content -Path $agentFile -Encoding utf8 -Raw -ErrorAction SilentlyContinue
    if (-not [string]::IsNullOrWhiteSpace($candidate)) {
      return $candidate.Trim()
    }
  }

  return $script:DefaultAgent
}

function Get-NodePath {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if ($node) {
    return $node.Source
  }

  throw "node executable not found in PATH"
}

function Get-BridgeMetaPath {
  param([string]$ResolvedStateDir)

  return (Join-Path $ResolvedStateDir "bridge-daemon.json")
}

function Get-LiveBridgeMeta {
  param([string]$MetaPath)

  if (-not (Test-Path $MetaPath)) {
    return $null
  }

  try {
    $meta = Get-Content -Path $MetaPath -Encoding utf8 | ConvertFrom-Json
    $proc = Get-Process -Id $meta.pid -ErrorAction SilentlyContinue
    if ($proc) {
      return $meta
    }
  } catch {
  }

  return $null
}

function Wait-ForProcessExit {
  param(
    [int]$ProcessId,
    [int]$TimeoutSeconds = 10
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    $proc = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if (-not $proc) {
      return $true
    }
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $deadline)

  return -not (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)
}

$resolvedRepoRoot = Resolve-RepoRoot -ExplicitRepoRoot $RepoRoot
$preferredAgentName = Resolve-PreferredAgentName -RequestedName $AgentName
$resolvedStateDir = Resolve-StateDir `
  -ResolvedRepoRoot $resolvedRepoRoot `
  -ExplicitStateDir $StateDir `
  -PreferredAgentName $preferredAgentName
$AgentName = Resolve-AgentName -RequestedName $AgentName -ResolvedStateDir $resolvedStateDir
$metaPath = Get-BridgeMetaPath -ResolvedStateDir $resolvedStateDir
$runningMeta = Get-LiveBridgeMeta -MetaPath $metaPath

if ($runningMeta -and -not $Restart) {
  Write-Host "bridge already running" -ForegroundColor Yellow
  Write-Host ("  pid:     {0}" -f $runningMeta.pid)
  Write-Host ("  started: {0}" -f $runningMeta.startedAt)
  Write-Host ("  state:   {0}" -f $resolvedStateDir)
  exit 0
}

if ($runningMeta -and $Restart) {
  Stop-Process -Id $runningMeta.pid -Force -ErrorAction SilentlyContinue
  if (-not (Wait-ForProcessExit -ProcessId $runningMeta.pid -TimeoutSeconds 10)) {
    throw ("Timed out waiting for bridge pid {0} to exit" -f $runningMeta.pid)
  }
}

$bridgeScript = Join-Path $resolvedRepoRoot "bridges\codex-app-server-bridge.ts"
if (-not (Test-Path $bridgeScript)) {
  throw "Bridge script not found: $bridgeScript"
}

$agentFile = Join-Path $resolvedStateDir "agent-name.txt"
Set-Content -Path $agentFile -Value $AgentName -Encoding utf8

$nodePath = Get-NodePath
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$stdoutPath = Join-Path (Join-Path $resolvedStateDir "logs") ("bridge-daemon-{0}.stdout.log" -f $stamp)
$stderrPath = Join-Path (Join-Path $resolvedStateDir "logs") ("bridge-daemon-{0}.stderr.log" -f $stamp)

$args = @(
  "--experimental-strip-types",
  $bridgeScript,
  "--repo-root",
  $resolvedRepoRoot,
  "--agent-name",
  $AgentName,
  "--state-dir",
  $resolvedStateDir,
  "--app-server-url",
  $AppServerUrl,
  "--busy-mode",
  $BusyMode,
  "--poll-seconds",
  $PollSeconds,
  "--reconnect-seconds",
  $ReconnectSeconds
)

if (-not [string]::IsNullOrWhiteSpace($CommsDir)) {
  $args += @("--comms-dir", (Convert-TapPath $CommsDir))
}

if ($ProcessExistingMessages) {
  $args += "--process-existing-messages"
} elseif ($MessageLookbackMinutes -gt 0) {
  $args += @("--message-lookback-minutes", $MessageLookbackMinutes)
}

if (-not [string]::IsNullOrWhiteSpace($ThreadId)) {
  $args += @("--thread-id", $ThreadId)
}

if ($Ephemeral) {
  $args += "--ephemeral"
}

$proc = Start-Process `
  -FilePath $nodePath `
  -ArgumentList $args `
  -WorkingDirectory $resolvedRepoRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput $stdoutPath `
  -RedirectStandardError $stderrPath `
  -PassThru

$lookbackValue = if ($ProcessExistingMessages) { -1 } else { $MessageLookbackMinutes }

$payload = [pscustomobject]@{
  pid = $proc.Id
  startedAt = (Get-Date).ToString("o")
  repoRoot = $resolvedRepoRoot
  commsDir = $CommsDir
  agentName = $AgentName
  stateDir = $resolvedStateDir
  appServerUrl = $AppServerUrl
  busyMode = $BusyMode
  pollSeconds = $PollSeconds
  reconnectSeconds = $ReconnectSeconds
  messageLookbackMinutes = $lookbackValue
  processExistingMessages = [bool]$ProcessExistingMessages
  threadId = $ThreadId
  ephemeral = [bool]$Ephemeral
  stdout = $stdoutPath
  stderr = $stderrPath
  node = $nodePath
}
$payload | ConvertTo-Json -Depth 4 | Set-Content -Path $metaPath -Encoding utf8

Write-Host "bridge started" -ForegroundColor Green
Write-Host ("  pid:       {0}" -f $proc.Id)
Write-Host ("  agent:     {0}" -f $AgentName)
Write-Host ("  appserver: {0}" -f $AppServerUrl)
Write-Host ("  state:     {0}" -f $resolvedStateDir)
Write-Host ("  stdout:    {0}" -f $stdoutPath)
Write-Host ("  stderr:    {0}" -f $stderrPath)
