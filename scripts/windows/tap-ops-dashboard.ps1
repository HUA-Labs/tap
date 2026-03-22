param(
  [string]$RepoRoot = "",
  [string]$AgentName = "",
  [string]$AppStateDir = "",
  [string]$ReviewStateDir = "",
  [string]$AppServerUrl = "",
  [int]$RefreshSeconds = 3,
  [int]$RecentInboxCount = 8,
  [switch]$Watch,
  [switch]$Json,
  [switch]$NoClear
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

function Get-AppDefaultStateDir {
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

function Get-AppStateDirCandidates {
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

function Resolve-AppStateDirSelection {
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

  $candidates = Get-AppStateDirCandidates -ResolvedRepoRoot $ResolvedRepoRoot
  if (-not [string]::IsNullOrWhiteSpace($PreferredAgentName)) {
    $preferredDefault = Get-AppDefaultStateDir `
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

  $baseDefault = Get-AppDefaultStateDir -ResolvedRepoRoot $ResolvedRepoRoot -PreferredAgentName ""
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

function Resolve-ReviewStateDir {
  param(
    [string]$ResolvedRepoRoot,
    [string]$ExplicitStateDir
  )

  $target = if (-not [string]::IsNullOrWhiteSpace($ExplicitStateDir)) {
    $ExplicitStateDir
  } else {
    Join-Path $ResolvedRepoRoot ".tmp\codex-review-bridge"
  }

  if (Test-Path $target) {
    return (Resolve-Path $target).Path
  }

  return $target
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

function Read-JsonFile {
  param([string]$Path)

  if (-not (Test-Path $Path)) {
    return $null
  }

  try {
    return Get-Content -Path $Path -Encoding utf8 | ConvertFrom-Json
  } catch {
    return $null
  }
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

function Get-FreshThreshold {
  param(
    $Meta,
    [int]$DefaultSeconds = 20
  )

  if ($Meta -and $Meta.pollSeconds) {
    return [Math]::Max(15, ([int]$Meta.pollSeconds * 2) + 5)
  }

  return $DefaultSeconds
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
      Name          = $item.Name
      Sender        = $route.Sender
      Recipient     = $route.Recipient
      Subject       = $route.Subject
      LastWriteTime = $item.LastWriteTime
    }

    if ($results.Count -ge $Count) {
      break
    }
  }

  return $results
}

function Get-ProcessState {
  param($Meta)

  if (-not $Meta -or -not $Meta.pid) {
    return [pscustomobject]@{
      Running = $false
      Process = $null
    }
  }

  $proc = Get-Process -Id $Meta.pid -ErrorAction SilentlyContinue
  return [pscustomobject]@{
    Running = [bool]$proc
    Process = $proc
  }
}

function Get-ReviewActiveWorkers {
  param(
    [string]$ResolvedStateDir,
    [int]$Count = 5
  )

  $activeDir = Join-Path $ResolvedStateDir "active"
  if (-not (Test-Path $activeDir)) {
    return @()
  }

  $markers = @(
    Get-ChildItem -Path $activeDir -File -Filter "*.json" -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending
  )

  $results = @()
  foreach ($marker in $markers) {
    $meta = Read-JsonFile -Path $marker.FullName
    if (-not $meta) {
      continue
    }

    $workerProc = if ($meta.pid) {
      Get-Process -Id $meta.pid -ErrorAction SilentlyContinue
    } else {
      $null
    }

    $results += [pscustomobject]@{
      Marker    = $marker.Name
      Label     = $meta.label
      Kind      = $meta.kind
      Pid       = $meta.pid
      Running   = [bool]$workerProc
      StartedAt = $meta.startedAt
      Request   = $meta.requestFile
      Stdout    = $meta.stdout
      Stderr    = $meta.stderr
    }

    if ($results.Count -ge $Count) {
      break
    }
  }

  return $results
}

function Get-ProcessedCount {
  param([string]$ResolvedStateDir)

  $processedDir = Join-Path $ResolvedStateDir "processed"
  return @(Get-ChildItem -Path $processedDir -File -Filter "*.done" -ErrorAction SilentlyContinue).Count
}

function Get-EffectiveAgentName {
  param(
    [string]$PreferredAgentName,
    [string]$AppStateDir
  )

  if (-not [string]::IsNullOrWhiteSpace($PreferredAgentName)) {
    return $PreferredAgentName
  }

  $stateAgent = Get-AgentNameFromStateDir -CandidatePath $AppStateDir
  if (-not [string]::IsNullOrWhiteSpace($stateAgent)) {
    return $stateAgent
  }

  return ""
}

function Get-Snapshot {
  param(
    [string]$ResolvedRepoRoot,
    [string]$RequestedAgentName,
    [string]$ExplicitAppStateDir,
    [string]$ExplicitReviewStateDir,
    [string]$RequestedAppServerUrl,
    [int]$InboxLimit
  )

  $preferredAgentName = Resolve-PreferredAgentName -RequestedName $RequestedAgentName
  $appStateSelection = Resolve-AppStateDirSelection `
    -ResolvedRepoRoot $ResolvedRepoRoot `
    -ExplicitStateDir $ExplicitAppStateDir `
    -PreferredAgentName $preferredAgentName
  $resolvedAppStateDir = $appStateSelection.Path
  $resolvedReviewStateDir = Resolve-ReviewStateDir -ResolvedRepoRoot $ResolvedRepoRoot -ExplicitStateDir $ExplicitReviewStateDir
  $resolvedCommsDir = Resolve-CommsDir -ResolvedRepoRoot $ResolvedRepoRoot
  $effectiveAgentName = Get-EffectiveAgentName -PreferredAgentName $preferredAgentName -AppStateDir $resolvedAppStateDir

  $appMeta = Read-JsonFile -Path (Join-Path $resolvedAppStateDir "bridge-daemon.json")
  $appHeartbeat = Read-JsonFile -Path (Join-Path $resolvedAppStateDir "heartbeat.json")
  $appThread = Read-JsonFile -Path (Join-Path $resolvedAppStateDir "thread.json")
  $appLastDispatch = Read-JsonFile -Path (Join-Path $resolvedAppStateDir "last-dispatch.json")
  $appProcess = Get-ProcessState -Meta $appMeta
  $appHeartbeatLag = Get-DateLagSeconds -IsoDate $appHeartbeat.updatedAt
  $appHeartbeatFresh = $false
  if ($null -ne $appHeartbeatLag) {
    $appHeartbeatFresh = $appHeartbeatLag -le (Get-FreshThreshold -Meta $appMeta)
  }

  $reviewMeta = Read-JsonFile -Path (Join-Path $resolvedReviewStateDir "bridge-daemon.json")
  $reviewHeartbeat = Read-JsonFile -Path (Join-Path $resolvedReviewStateDir "heartbeat.json")
  $reviewProcess = Get-ProcessState -Meta $reviewMeta
  $reviewHeartbeatLag = Get-DateLagSeconds -IsoDate $reviewHeartbeat.updatedAt
  $reviewHeartbeatFresh = $false
  if ($null -ne $reviewHeartbeatLag) {
    $reviewHeartbeatFresh = $reviewHeartbeatLag -le (Get-FreshThreshold -Meta $reviewMeta)
  }
  $reviewActiveWorkers = @(Get-ReviewActiveWorkers -ResolvedStateDir $resolvedReviewStateDir -Count 5)
  $reviewProcessedCount = Get-ProcessedCount -ResolvedStateDir $resolvedReviewStateDir

  if ([string]::IsNullOrWhiteSpace($effectiveAgentName) -and $appMeta -and -not [string]::IsNullOrWhiteSpace($appMeta.agentName)) {
    $effectiveAgentName = [string]$appMeta.agentName
  }

  $appServer = Resolve-AppServerUrl -RequestedUrl $RequestedAppServerUrl -Meta $appMeta -Heartbeat $appHeartbeat
  $appServerProbe = Test-AppServerTcp -Url $appServer.Url
  $recentInboxItems = @(Get-RecentInboxItems -CommsDir $resolvedCommsDir -AgentNameValue $effectiveAgentName -Count $InboxLimit)

  $warnings = New-Object System.Collections.Generic.List[string]
  if (-not $resolvedCommsDir -or -not (Test-Path $resolvedCommsDir)) {
    $warnings.Add("comms directory could not be resolved")
  }
  if ([string]::IsNullOrWhiteSpace($effectiveAgentName)) {
    $warnings.Add("agent name could not be resolved")
  }
  if (-not $appProcess.Running) {
    $warnings.Add("app bridge is not running")
  } elseif (-not $appHeartbeatFresh) {
    $warnings.Add("app bridge heartbeat is stale")
  }
  if ($appHeartbeat -and $appHeartbeat.consecutiveFailureCount -gt 0) {
    $warnings.Add("app bridge has $($appHeartbeat.consecutiveFailureCount) consecutive failure(s)")
  }
  if ($appMeta -and [string]$appMeta.appServerUrl -match ":4500($|/)") {
    $warnings.Add("app bridge is still pointed at port 4500; 4501 is the current default")
  }
  if (-not $appServerProbe.Ok) {
    $warnings.Add("app server TCP probe failed")
  }
  if (-not $reviewProcess.Running) {
    $warnings.Add("review bridge is not running")
  } elseif (-not $reviewHeartbeatFresh) {
    $warnings.Add("review bridge heartbeat is stale")
  }
  foreach ($worker in $reviewActiveWorkers) {
    if (-not $worker.Running) {
      $warnings.Add("review worker marker remains but pid $($worker.Pid) is not running")
    }
  }

  return [pscustomobject]@{
    generatedAt = (Get-Date).ToString("o")
    repoRoot = $ResolvedRepoRoot
    agentName = $effectiveAgentName
    commsDir = $resolvedCommsDir
    appServer = [pscustomobject]@{
      url = $appServer.Url
      source = $appServer.Source
      tcp = $appServerProbe
    }
    appBridge = [pscustomobject]@{
      stateDir = $resolvedAppStateDir
      stateSource = $appStateSelection.Reason
      candidates = @($appStateSelection.Candidates | ForEach-Object {
        $candidateAgent = Get-AgentNameFromStateDir -CandidatePath $_.FullName
        if ([string]::IsNullOrWhiteSpace($candidateAgent)) {
          $_.Name
        } else {
          "{0} [{1}]" -f $_.Name, $candidateAgent
        }
      })
      meta = $appMeta
      running = $appProcess.Running
      heartbeat = $appHeartbeat
      heartbeatLagSeconds = $appHeartbeatLag
      heartbeatFresh = $appHeartbeatFresh
      thread = $appThread
      lastDispatch = $appLastDispatch
    }
    reviewBridge = [pscustomobject]@{
      stateDir = $resolvedReviewStateDir
      meta = $reviewMeta
      running = $reviewProcess.Running
      heartbeat = $reviewHeartbeat
      heartbeatLagSeconds = $reviewHeartbeatLag
      heartbeatFresh = $reviewHeartbeatFresh
      activeWorkers = @($reviewActiveWorkers)
      processedCount = $reviewProcessedCount
    }
    inbox = [pscustomobject]@{
      recent = @($recentInboxItems)
    }
    warnings = @($warnings)
  }
}

function Write-Section {
  param([string]$Title)

  Write-Host ""
  Write-Host $Title -ForegroundColor White
}

function Write-KeyValue {
  param(
    [string]$Label,
    [string]$Value
  )

  Write-Host ("  {0,-12} {1}" -f "${Label}:", $Value)
}

function Get-StatusLabel {
  param([bool]$Value)

  if ($Value) {
    return "RUNNING"
  }

  return "STOPPED"
}

function Get-StatusColor {
  param([bool]$Value)

  if ($Value) {
    return "Green"
  }

  return "Yellow"
}

function Format-Lag {
  param(
    [string]$IsoDate,
    $LagSeconds
  )

  if ([string]::IsNullOrWhiteSpace($IsoDate)) {
    return "(missing)"
  }

  if ($null -eq $LagSeconds) {
    return $IsoDate
  }

  return "{0} ({1}s ago)" -f $IsoDate, $LagSeconds
}

function Render-Snapshot {
  param(
    $Snapshot,
    [int]$RefreshSeconds,
    [switch]$WatchMode,
    [switch]$SkipClear
  )

  if (-not $SkipClear) {
    Clear-Host
  }

  Write-Host "tap ops dashboard" -ForegroundColor White
  Write-KeyValue "time" $Snapshot.generatedAt
  Write-KeyValue "repo" $Snapshot.repoRoot
  Write-KeyValue "agent" $(if ($Snapshot.agentName) { $Snapshot.agentName } else { "(unresolved)" })
  Write-KeyValue "comms" $(if ($Snapshot.commsDir) { $Snapshot.commsDir } else { "(unresolved)" })
  Write-KeyValue "appserver" ("{0} ({1})" -f $Snapshot.appServer.url, $Snapshot.appServer.source)
  if ($WatchMode) {
    Write-KeyValue "refresh" ("{0}s  |  Ctrl+C to exit" -f $RefreshSeconds)
  }

  Write-Section "App Bridge"
  Write-Host ("  status:       {0}" -f (Get-StatusLabel -Value $Snapshot.appBridge.running)) -ForegroundColor (Get-StatusColor -Value $Snapshot.appBridge.running)
  Write-KeyValue "state" $Snapshot.appBridge.stateDir
  Write-KeyValue "state-src" $Snapshot.appBridge.stateSource
  if ($Snapshot.appBridge.candidates.Count -gt 1) {
    Write-KeyValue "candidates" ($Snapshot.appBridge.candidates -join ", ")
  }
  if ($Snapshot.appBridge.meta) {
    Write-KeyValue "pid" ([string]$Snapshot.appBridge.meta.pid)
    Write-KeyValue "started" ([string]$Snapshot.appBridge.meta.startedAt)
    Write-KeyValue "busy-mode" ([string]$Snapshot.appBridge.meta.busyMode)
  }
  Write-KeyValue "heartbeat" (Format-Lag -IsoDate $Snapshot.appBridge.heartbeat.updatedAt -LagSeconds $Snapshot.appBridge.heartbeatLagSeconds)
  if ($Snapshot.appBridge.heartbeat) {
    Write-KeyValue "connected" ([string]$Snapshot.appBridge.heartbeat.connected)
    Write-KeyValue "thread" ([string]$Snapshot.appBridge.heartbeat.threadId)
    Write-KeyValue "turn" ([string]$Snapshot.appBridge.heartbeat.activeTurnId)
    Write-KeyValue "last-turn" ([string]$Snapshot.appBridge.heartbeat.lastTurnStatus)
    Write-KeyValue "notify" ([string]$Snapshot.appBridge.heartbeat.lastNotificationMethod)
    Write-KeyValue "last-ok" (Format-Lag -IsoDate $Snapshot.appBridge.heartbeat.lastSuccessfulAppServerAt -LagSeconds (Get-DateLagSeconds -IsoDate $Snapshot.appBridge.heartbeat.lastSuccessfulAppServerAt))
    Write-KeyValue "last-ok-op" ([string]$Snapshot.appBridge.heartbeat.lastSuccessfulAppServerMethod)
    Write-KeyValue "fail-count" ([string]$Snapshot.appBridge.heartbeat.consecutiveFailureCount)
    if ($Snapshot.appBridge.heartbeat.lastError) {
      Write-KeyValue "last-error" ([string]$Snapshot.appBridge.heartbeat.lastError)
    }
  } elseif ($Snapshot.appBridge.thread -and $Snapshot.appBridge.thread.threadId) {
    Write-KeyValue "thread" ([string]$Snapshot.appBridge.thread.threadId)
  }
  if ($Snapshot.appBridge.lastDispatch) {
    Write-KeyValue "request" ([string]$Snapshot.appBridge.lastDispatch.requestName)
    Write-KeyValue "dispatch" ("{0} | from {1} | {2}" -f $Snapshot.appBridge.lastDispatch.dispatchMode, $Snapshot.appBridge.lastDispatch.sender, $Snapshot.appBridge.lastDispatch.dispatchedAt)
  }
  if ($Snapshot.appBridge.meta) {
    Write-KeyValue "stdout" ([string]$Snapshot.appBridge.meta.stdout)
    Write-KeyValue "stderr" ([string]$Snapshot.appBridge.meta.stderr)
  }
  if ($Snapshot.appServer.tcp.Ok) {
    Write-KeyValue "tcp" ("reachable: {0}:{1}" -f $Snapshot.appServer.tcp.Host, $Snapshot.appServer.tcp.Port)
  } else {
    Write-KeyValue "tcp" ("failed: {0}" -f $Snapshot.appServer.tcp.Error)
  }

  Write-Section "Review Bridge"
  Write-Host ("  status:       {0}" -f (Get-StatusLabel -Value $Snapshot.reviewBridge.running)) -ForegroundColor (Get-StatusColor -Value $Snapshot.reviewBridge.running)
  Write-KeyValue "state" $Snapshot.reviewBridge.stateDir
  if ($Snapshot.reviewBridge.meta) {
    Write-KeyValue "pid" ([string]$Snapshot.reviewBridge.meta.pid)
    Write-KeyValue "started" ([string]$Snapshot.reviewBridge.meta.startedAt)
    Write-KeyValue "agent" ([string]$Snapshot.reviewBridge.meta.agentName)
  }
  Write-KeyValue "heartbeat" (Format-Lag -IsoDate $Snapshot.reviewBridge.heartbeat.updatedAt -LagSeconds $Snapshot.reviewBridge.heartbeatLagSeconds)
  Write-KeyValue "processed" ([string]$Snapshot.reviewBridge.processedCount)
  Write-KeyValue "active" ([string]$Snapshot.reviewBridge.activeWorkers.Count)
  if ($Snapshot.reviewBridge.meta) {
    Write-KeyValue "stdout" ([string]$Snapshot.reviewBridge.meta.stdout)
    Write-KeyValue "stderr" ([string]$Snapshot.reviewBridge.meta.stderr)
  }
  if ($Snapshot.reviewBridge.activeWorkers.Count -gt 0) {
    foreach ($worker in $Snapshot.reviewBridge.activeWorkers | Select-Object -First 3) {
      $workerStatus = if ($worker.Running) { "alive" } else { "stale" }
      Write-Host ("    {0} | pid {1} | {2}" -f $worker.Label, $worker.Pid, $workerStatus) -ForegroundColor DarkGray
      if ($worker.Request) {
        Write-Host ("      {0}" -f $worker.Request) -ForegroundColor DarkGray
      }
    }
  }

  Write-Section "Recent Inbox"
  if ($Snapshot.inbox.recent.Count -eq 0) {
    Write-Host "  none" -ForegroundColor DarkGray
  } else {
    foreach ($item in $Snapshot.inbox.recent) {
      Write-Host ("  {0:yyyy-MM-dd HH:mm:ss} | {1} -> {2} | {3}" -f $item.LastWriteTime, $item.Sender, $item.Recipient, $item.Subject)
    }
  }

  Write-Section "Warnings"
  if ($Snapshot.warnings.Count -eq 0) {
    Write-Host "  [OK] no immediate warnings" -ForegroundColor Green
  } else {
    foreach ($warning in $Snapshot.warnings) {
      Write-Host ("  [WARN] {0}" -f $warning) -ForegroundColor Yellow
    }
  }
}

$resolvedRepoRoot = Resolve-RepoRoot -ExplicitRepoRoot $RepoRoot

if ($Json) {
  $snapshot = Get-Snapshot `
    -ResolvedRepoRoot $resolvedRepoRoot `
    -RequestedAgentName $AgentName `
    -ExplicitAppStateDir $AppStateDir `
    -ExplicitReviewStateDir $ReviewStateDir `
    -RequestedAppServerUrl $AppServerUrl `
    -InboxLimit $RecentInboxCount
  $snapshot | ConvertTo-Json -Depth 8
  exit 0
}

do {
  $snapshot = Get-Snapshot `
    -ResolvedRepoRoot $resolvedRepoRoot `
    -RequestedAgentName $AgentName `
    -ExplicitAppStateDir $AppStateDir `
    -ExplicitReviewStateDir $ReviewStateDir `
    -RequestedAppServerUrl $AppServerUrl `
    -InboxLimit $RecentInboxCount
  Render-Snapshot -Snapshot $snapshot -RefreshSeconds $RefreshSeconds -WatchMode:$Watch -SkipClear:$NoClear

  if (-not $Watch) {
    break
  }

  Start-Sleep -Seconds $RefreshSeconds
} while ($true)
