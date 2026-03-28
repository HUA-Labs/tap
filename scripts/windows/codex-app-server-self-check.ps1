param(
  [string]$RepoRoot = "",
  [string]$StateDir = "",
  [string]$AgentName = "",
  [string]$AppServerUrl = "",
  [int]$RecentInboxCount = 5
)

$ErrorActionPreference = "Stop"

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
    return (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
  }

  return (Get-Location).Path
}

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

function Get-StateDirCandidates {
  param([string]$ResolvedRepoRoot)

  $tmpRoot = Join-Path $ResolvedRepoRoot ".tmp"
  if (-not (Test-Path $tmpRoot)) {
    return @()
  }

  return @(
    Get-ChildItem -Path $tmpRoot -Directory -Filter "codex-app-server-bridge*" -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending
  )
}

function Get-AgentNameFromStateDir {
  param([string]$CandidatePath)

  $agentFile = Join-Path $CandidatePath "agent-name.txt"
  if (-not (Test-Path $agentFile)) {
    return ""
  }

  try {
    return (Get-Content -Path $agentFile -Encoding utf8 -Raw).Trim()
  } catch {
    return ""
  }
}

function Resolve-StateDirSelection {
  param(
    [string]$ResolvedRepoRoot,
    [string]$ExplicitStateDir,
    [string]$PreferredAgentName
  )

  if (-not [string]::IsNullOrWhiteSpace($ExplicitStateDir)) {
    $resolved = if (Test-Path $ExplicitStateDir) {
      (Resolve-Path $ExplicitStateDir).Path
    } else {
      $ExplicitStateDir
    }

    return [pscustomobject]@{
      Path       = $resolved
      Reason     = "explicit"
      Candidates = @()
    }
  }

  $candidates = Get-StateDirCandidates -ResolvedRepoRoot $ResolvedRepoRoot
  if (-not [string]::IsNullOrWhiteSpace($PreferredAgentName)) {
    $preferredDefault = Get-DefaultStateDir `
      -ResolvedRepoRoot $ResolvedRepoRoot `
      -PreferredAgentName $PreferredAgentName
    if (Test-Path $preferredDefault) {
      return [pscustomobject]@{
        Path       = (Resolve-Path $preferredDefault).Path
        Reason     = "agent-default"
        Candidates = $candidates
      }
    }

    foreach ($candidate in $candidates) {
      $candidateAgent = Get-AgentNameFromStateDir -CandidatePath $candidate.FullName
      if ($candidateAgent -eq $PreferredAgentName) {
        return [pscustomobject]@{
          Path       = $candidate.FullName
          Reason     = "agent-match"
          Candidates = $candidates
        }
      }
    }

    return [pscustomobject]@{
      Path       = $preferredDefault
      Reason     = "agent-default-missing"
      Candidates = $candidates
    }
  }

  $baseDefault = Get-DefaultStateDir -ResolvedRepoRoot $ResolvedRepoRoot -PreferredAgentName ""
  if (Test-Path $baseDefault) {
    return [pscustomobject]@{
      Path       = (Resolve-Path $baseDefault).Path
      Reason     = "base-default"
      Candidates = $candidates
    }
  }

  if ($candidates.Count -gt 0) {
    return [pscustomobject]@{
      Path       = $candidates[0].FullName
      Reason     = if ($candidates.Count -eq 1) { "single-candidate" } else { "newest-candidate" }
      Candidates = $candidates
    }
  }

  return [pscustomobject]@{
    Path       = $baseDefault
    Reason     = "base-default-missing"
    Candidates = @()
  }
}

function Resolve-CommsDir {
  param([string]$ResolvedRepoRoot)

  $tapConfigPath = Join-Path $ResolvedRepoRoot ".tap-config"
  if (-not (Test-Path $tapConfigPath)) {
    return $null
  }

  $configText = Get-Content -Path $tapConfigPath -Encoding utf8 -Raw
  $match = [regex]::Match($configText, '^TAP_COMMS_DIR="?(.*?)"?$', [System.Text.RegularExpressions.RegexOptions]::Multiline)
  if (-not $match.Success) {
    return $null
  }

  $resolved = Resolve-Path (Convert-TapPath $match.Groups[1].Value) -ErrorAction SilentlyContinue
  if ($resolved) {
    return $resolved.Path
  }

  return (Convert-TapPath $match.Groups[1].Value)
}

function Get-InboxRoute {
  param([string]$FileName)

  $stem = [System.IO.Path]::GetFileNameWithoutExtension($FileName)
  $parts = $stem -split "-"
  $offset = 0
  if ($parts.Count -gt 0 -and $parts[0] -match '^\d{8}$') {
    $offset = 1
  }

  $sender = if ($parts.Count -gt $offset) { $parts[$offset] } else { "" }
  $recipient = if ($parts.Count -gt ($offset + 1)) { $parts[$offset + 1] } else { "" }
  $subject = if ($parts.Count -gt ($offset + 2)) { ($parts[($offset + 2)..($parts.Count - 1)] -join "-") } else { "" }

  return [pscustomobject]@{
    Sender    = $sender
    Recipient = $recipient
    Subject   = $subject
  }
}

function Recipient-MatchesAgent {
  param(
    [string]$Recipient,
    [string]$AgentNameValue
  )

  if ([string]::IsNullOrWhiteSpace($AgentNameValue)) {
    return $true
  }

  return $Recipient -eq $AgentNameValue -or $Recipient -eq "전체" -or $Recipient -eq "all"
}

function Get-RecentInboxItems {
  param(
    [string]$CommsDir,
    [string]$AgentNameValue,
    [int]$Count
  )

  if ([string]::IsNullOrWhiteSpace($CommsDir)) {
    return @()
  }

  $inboxDir = Join-Path $CommsDir "inbox"
  if (-not (Test-Path $inboxDir)) {
    return @()
  }

  $items = @(
    Get-ChildItem -Path $inboxDir -File -Filter "*.md" -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending
  )

  $results = @()
  foreach ($item in $items) {
    $route = Get-InboxRoute -FileName $item.Name
    if (-not (Recipient-MatchesAgent -Recipient $route.Recipient -AgentNameValue $AgentNameValue) -and $route.Sender -ne $AgentNameValue) {
      continue
    }

    $results += [pscustomobject]@{
      Name         = $item.Name
      Sender       = $route.Sender
      Recipient    = $route.Recipient
      Subject      = $route.Subject
      LastWriteTime = $item.LastWriteTime
    }

    if ($results.Count -ge $Count) {
      break
    }
  }

  return $results
}

function Resolve-AppServerUrl {
  param(
    [string]$RequestedUrl,
    $Meta,
    $Heartbeat
  )

  if (-not [string]::IsNullOrWhiteSpace($RequestedUrl)) {
    return [pscustomobject]@{ Url = $RequestedUrl; Source = "argument" }
  }

  if ($Meta -and -not [string]::IsNullOrWhiteSpace($Meta.appServerUrl)) {
    return [pscustomobject]@{ Url = [string]$Meta.appServerUrl; Source = "bridge-meta" }
  }

  if ($Heartbeat -and -not [string]::IsNullOrWhiteSpace($Heartbeat.appServerUrl)) {
    return [pscustomobject]@{ Url = [string]$Heartbeat.appServerUrl; Source = "heartbeat" }
  }

  return [pscustomobject]@{ Url = "ws://127.0.0.1:4501"; Source = "default" }
}

function Test-AppServerTcp {
  param([string]$Url)

  try {
    $uri = [Uri]$Url
    $port = if ($uri.Port -gt 0) {
      $uri.Port
    } elseif ($uri.Scheme -eq "wss") {
      443
    } else {
      80
    }

    $client = New-Object System.Net.Sockets.TcpClient
    $async = $client.BeginConnect($uri.Host, $port, $null, $null)
    $connected = $async.AsyncWaitHandle.WaitOne(1500, $false)
    if (-not $connected) {
      $client.Close()
      return [pscustomobject]@{
        Ok    = $false
        Host  = $uri.Host
        Port  = $port
        Error = "timeout"
      }
    }

    $client.EndConnect($async)
    $client.Close()
    return [pscustomobject]@{
      Ok    = $true
      Host  = $uri.Host
      Port  = $port
      Error = $null
    }
  } catch {
    return [pscustomobject]@{
      Ok    = $false
      Host  = ""
      Port  = 0
      Error = $_.Exception.Message
    }
  }
}

function Write-Check {
  param(
    [ValidateSet("ok", "warn", "fail", "info")]
    [string]$Level,
    [string]$Message
  )

  $color = switch ($Level) {
    "ok" { "Green" }
    "warn" { "Yellow" }
    "fail" { "Red" }
    default { "Cyan" }
  }

  Write-Host ("[{0}] {1}" -f $Level.ToUpperInvariant(), $Message) -ForegroundColor $color
}

function Get-DateLagSeconds {
  param([string]$IsoDate)

  if ([string]::IsNullOrWhiteSpace($IsoDate)) {
    return $null
  }

  try {
    $updatedAt = [DateTime]::Parse($IsoDate)
    return [Math]::Round(([DateTime]::UtcNow - $updatedAt.ToUniversalTime()).TotalSeconds, 1)
  } catch {
    return $null
  }
}

$resolvedRepoRoot = Resolve-RepoRoot -ExplicitRepoRoot $RepoRoot
$preferredAgentName = Resolve-PreferredAgentName -RequestedName $AgentName
$stateSelection = Resolve-StateDirSelection `
  -ResolvedRepoRoot $resolvedRepoRoot `
  -ExplicitStateDir $StateDir `
  -PreferredAgentName $preferredAgentName
$resolvedStateDir = $stateSelection.Path
$resolvedCommsDir = Resolve-CommsDir -ResolvedRepoRoot $resolvedRepoRoot

$agentFilePath = Join-Path $resolvedStateDir "agent-name.txt"
$stateAgentName = if (Test-Path $agentFilePath) {
  try {
    (Get-Content -Path $agentFilePath -Encoding utf8 -Raw).Trim()
  } catch {
    ""
  }
} else {
  ""
}
$effectiveAgentName = if (-not [string]::IsNullOrWhiteSpace($preferredAgentName)) {
  $preferredAgentName
} elseif (-not [string]::IsNullOrWhiteSpace($stateAgentName)) {
  $stateAgentName
} else {
  ""
}

$metaPath = Join-Path $resolvedStateDir "bridge-daemon.json"
$heartbeatPath = Join-Path $resolvedStateDir "heartbeat.json"
$threadPath = Join-Path $resolvedStateDir "thread.json"
$lastDispatchPath = Join-Path $resolvedStateDir "last-dispatch.json"
$processedDir = Join-Path $resolvedStateDir "processed"
$logsDir = Join-Path $resolvedStateDir "logs"

$meta = if (Test-Path $metaPath) {
  Get-Content -Path $metaPath -Encoding utf8 | ConvertFrom-Json
} else {
  $null
}
$heartbeat = if (Test-Path $heartbeatPath) {
  Get-Content -Path $heartbeatPath -Encoding utf8 | ConvertFrom-Json
} else {
  $null
}
$thread = if (Test-Path $threadPath) {
  Get-Content -Path $threadPath -Encoding utf8 | ConvertFrom-Json
} else {
  $null
}
$lastDispatch = if (Test-Path $lastDispatchPath) {
  Get-Content -Path $lastDispatchPath -Encoding utf8 | ConvertFrom-Json
} else {
  $null
}
$proc = if ($meta) {
  Get-Process -Id $meta.pid -ErrorAction SilentlyContinue
} else {
  $null
}
$processedCount = @(Get-ChildItem -Path $processedDir -File -Filter "*.done" -ErrorAction SilentlyContinue).Count
$latestLogs = @(
  Get-ChildItem -Path $logsDir -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 2
)

$appServer = Resolve-AppServerUrl -RequestedUrl $AppServerUrl -Meta $meta -Heartbeat $heartbeat
$appServerProbe = Test-AppServerTcp -Url $appServer.Url
$recentInboxItems = Get-RecentInboxItems `
  -CommsDir $resolvedCommsDir `
  -AgentNameValue $effectiveAgentName `
  -Count $RecentInboxCount

Write-Host "codex app-server self-check" -ForegroundColor White
Write-Host ("  repo:      {0}" -f $resolvedRepoRoot)
Write-Host ("  agent:     {0}" -f $(if ($effectiveAgentName) { $effectiveAgentName } else { "(unresolved)" }))
Write-Host ("  state:     {0}" -f $resolvedStateDir)
Write-Host ("  state-src: {0}" -f $stateSelection.Reason)
Write-Host ("  comms:     {0}" -f $(if ($resolvedCommsDir) { $resolvedCommsDir } else { "(unresolved)" }))
Write-Host ("  appserver: {0} ({1})" -f $appServer.Url, $appServer.Source)

if ($stateSelection.Candidates.Count -gt 1) {
  $candidateSummary = $stateSelection.Candidates |
    ForEach-Object {
      $candidateAgent = Get-AgentNameFromStateDir -CandidatePath $_.FullName
      if ([string]::IsNullOrWhiteSpace($candidateAgent)) {
        $_.Name
      } else {
        "{0} [{1}]" -f $_.Name, $candidateAgent
      }
    }
  Write-Host ("  candidates: {0}" -f ($candidateSummary -join ", "))
}

Write-Host ""

Write-Check -Level "ok" -Message ("repo root resolved: {0}" -f $resolvedRepoRoot)

if ($resolvedCommsDir -and (Test-Path $resolvedCommsDir)) {
  Write-Check -Level "ok" -Message ("comms dir resolved: {0}" -f $resolvedCommsDir)
} else {
  Write-Check -Level "fail" -Message ".tap-config / TAP_COMMS_DIR could not be resolved"
}

if (-not [string]::IsNullOrWhiteSpace($effectiveAgentName)) {
  Write-Check -Level "ok" -Message ("agent name resolved: {0}" -f $effectiveAgentName)
} else {
  Write-Check -Level "warn" -Message "agent name could not be resolved from args/env/state"
}

if (Test-Path $resolvedStateDir) {
  Write-Check -Level "ok" -Message ("state dir exists: {0}" -f $resolvedStateDir)
} else {
  Write-Check -Level "warn" -Message ("state dir missing: {0}" -f $resolvedStateDir)
}

if ($meta) {
  if ($proc) {
    Write-Check -Level "ok" -Message ("bridge process alive: pid {0}" -f $meta.pid)
  } else {
    Write-Check -Level "warn" -Message ("bridge metadata exists but pid {0} is not running" -f $meta.pid)
  }
} else {
  Write-Check -Level "warn" -Message "bridge metadata file is missing"
}

if ($heartbeat) {
  $lagSeconds = Get-DateLagSeconds -IsoDate $heartbeat.updatedAt
  $lagSuffix = if ($null -ne $lagSeconds) { " ({0}s ago)" -f $lagSeconds } else { "" }
  $threshold = if ($meta -and $meta.pollSeconds) {
    [Math]::Max(15, ([int]$meta.pollSeconds * 2) + 5)
  } else {
    20
  }

  if ($null -ne $lagSeconds -and $lagSeconds -le $threshold) {
    Write-Check -Level "ok" -Message ("heartbeat fresh: {0}{1}" -f $heartbeat.updatedAt, $lagSuffix)
  } else {
    Write-Check -Level "warn" -Message ("heartbeat stale: {0}{1}" -f $heartbeat.updatedAt, $lagSuffix)
  }

  if ($heartbeat.threadId) {
    Write-Check -Level "info" -Message ("thread: {0}" -f $heartbeat.threadId)
  }
  if ($heartbeat.activeTurnId) {
    Write-Check -Level "info" -Message ("active turn: {0}" -f $heartbeat.activeTurnId)
  }
  if ($heartbeat.lastError) {
    Write-Check -Level "warn" -Message ("last app-server error: {0}" -f $heartbeat.lastError)
  }
} else {
  Write-Check -Level "warn" -Message "heartbeat file is missing"
}

if ($appServerProbe.Ok) {
  Write-Check -Level "ok" -Message ("app-server TCP reachable: {0}:{1}" -f $appServerProbe.Host, $appServerProbe.Port)
} else {
  Write-Check -Level "warn" -Message ("app-server TCP probe failed: {0}" -f $appServerProbe.Error)
}

if ($thread -and $thread.threadId) {
  Write-Check -Level "info" -Message ("saved thread state: {0}" -f $thread.threadId)
} else {
  Write-Check -Level "info" -Message "saved thread state: none"
}

if ($lastDispatch) {
  Write-Check -Level "info" -Message (
    "last dispatch: {0} | {1} | from {2} | {3}" -f `
      $lastDispatch.requestName, `
      $lastDispatch.dispatchMode, `
      $lastDispatch.sender, `
      $lastDispatch.dispatchedAt
  )
} else {
  Write-Check -Level "info" -Message "last dispatch: none"
}

Write-Check -Level "info" -Message ("processed markers: {0}" -f $processedCount)

if ($recentInboxItems.Count -gt 0) {
  Write-Check -Level "info" -Message ("recent inbox items involving this agent: {0}" -f $recentInboxItems.Count)
  foreach ($item in $recentInboxItems) {
    Write-Host ("    {0:yyyy-MM-dd HH:mm:ss} | {1} -> {2} | {3}" -f $item.LastWriteTime, $item.Sender, $item.Recipient, $item.Subject)
  }
} else {
  Write-Check -Level "info" -Message "recent inbox items involving this agent: none"
}

if ($latestLogs.Count -gt 0) {
  $logSummary = $latestLogs | ForEach-Object { "{0} ({1:yyyy-MM-dd HH:mm:ss})" -f $_.Name, $_.LastWriteTime }
  Write-Check -Level "info" -Message ("latest logs: {0}" -f ($logSummary -join ", "))
} else {
  Write-Check -Level "info" -Message "latest logs: none"
}

Write-Check -Level "info" -Message "limit: this script cannot verify visible rendering inside the live TUI"
