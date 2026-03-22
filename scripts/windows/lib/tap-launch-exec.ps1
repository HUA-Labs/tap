function Write-TextArtifactFile {
  param(
    [string]$TargetPath,
    [string]$Content
  )

  $dir = Split-Path -Parent $TargetPath
  if (-not (Test-Path $dir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
  }
  Set-Content -Path $TargetPath -Value $Content -Encoding utf8
}

function Invoke-Preparation {
  param(
    [string]$ResolvedRepoRoot,
    $LaunchSpec,
    [string]$RequestedMission,
    [string]$RequestedMissionPath,
    [string]$RequestedWorktree,
    [string]$RequestedRuntime,
    [string]$RequestedModel,
    [string]$RequestedAppServerUrl,
    [bool]$RequestedAppServerUrlWasExplicit,
    [string[]]$AgentNames,
    [string]$PromptOverride,
    [bool]$UseChannels
  )

  if (-not $LaunchSpec.worktree.exists) {
    $bash = Get-Command bash -ErrorAction SilentlyContinue
    if (-not $bash) {
      throw "bash is required to bootstrap a new worktree."
    }
    $setupScript = Join-Path $ResolvedRepoRoot "scripts\tap-setup.sh"
    & $bash.Source $setupScript (Convert-ToPosixDrivePath -PathValue $LaunchSpec.worktree.path) $LaunchSpec.mission.branch "main"
    if ($LASTEXITCODE -ne 0) {
      throw "tap-setup.sh failed while preparing the worktree."
    }
  }

  $tapConfig = Get-TapConfig -ResolvedRepoRoot $ResolvedRepoRoot
  switch ($LaunchSpec.runtime) {
    "claude" {
      $settingsDir = Split-Path -Parent $LaunchSpec.artifacts.settingsLocalPath
      if (-not (Test-Path $settingsDir)) {
        New-Item -ItemType Directory -Path $settingsDir -Force | Out-Null
      }
      if (Test-Path $LaunchSpec.artifacts.settingsTemplatePath) {
        Copy-Item -Path $LaunchSpec.artifacts.settingsTemplatePath -Destination $LaunchSpec.artifacts.settingsLocalPath -Force
        & git -c ("safe.directory={0}" -f ($LaunchSpec.worktree.path.Replace("\", "/"))) -C $LaunchSpec.worktree.path update-index --skip-worktree .claude/settings.local.json 2>$null
      }

      $mcp = Get-McpConfigState -ResolvedRepoRoot $ResolvedRepoRoot -WorktreePath $LaunchSpec.worktree.path -CommsDir $tapConfig.CommsDir
      Write-TextArtifactFile -TargetPath $mcp.TargetPath -Content $mcp.DesiredContent
    }
    "codex" {
      # Codex runtime uses launcher-managed app-server startup at launch time.
    }
    "gemini" {
      $geminiSettings = Get-GeminiSettingsState -ResolvedRepoRoot $ResolvedRepoRoot -WorktreePath $LaunchSpec.worktree.path -CommsDir $tapConfig.CommsDir -Model $RequestedModel
      Write-TextArtifactFile -TargetPath $geminiSettings.TargetPath -Content $geminiSettings.DesiredContent
    }
    default {
      throw "Prepare backend not implemented for runtime: $($LaunchSpec.runtime)"
    }
  }

  return (Get-LaunchSpec `
    -ResolvedRepoRoot $ResolvedRepoRoot `
    -RequestedMission $RequestedMission `
    -RequestedMissionPath $RequestedMissionPath `
    -RequestedWorktree $RequestedWorktree `
    -RequestedRuntime $RequestedRuntime `
    -RequestedModel $RequestedModel `
    -RequestedAppServerUrl $RequestedAppServerUrl `
    -RequestedAppServerUrlWasExplicit $RequestedAppServerUrlWasExplicit `
    -AgentNames $AgentNames `
    -PromptOverride $PromptOverride `
    -UseChannels $UseChannels `
    -LaunchMode "prepared")
}

function Get-PowerShellExecutable {
  foreach ($candidate in @("pwsh.exe", "powershell.exe")) {
    $command = Get-Command $candidate -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
  }
  throw "No PowerShell executable was found."
}

function ConvertTo-SingleQuotedLiteral {
  param([string]$Value)

  if ($null -eq $Value) { return "''" }
  return "'" + $Value.Replace("'", "''") + "'"
}

function ConvertTo-EncodedCommand {
  param([string]$ScriptText)
  return [Convert]::ToBase64String([System.Text.Encoding]::Unicode.GetBytes($ScriptText))
}

function Start-LaunchSession {
  param($LaunchSpec)

  $pwsh = Get-PowerShellExecutable
  $argLiterals = @($LaunchSpec.args | ForEach-Object { ConvertTo-SingleQuotedLiteral -Value $_ })
  $scriptLines = @(
    ('$env:TAP_RUNTIME = {0}' -f (ConvertTo-SingleQuotedLiteral -Value $LaunchSpec.env.TAP_RUNTIME)),
    ('$env:TAP_MISSION_ID = {0}' -f (ConvertTo-SingleQuotedLiteral -Value $LaunchSpec.env.TAP_MISSION_ID)),
    ('$env:TAP_MISSION_PATH = {0}' -f (ConvertTo-SingleQuotedLiteral -Value $LaunchSpec.env.TAP_MISSION_PATH)),
    ('$env:TAP_WORKTREE_PATH = {0}' -f (ConvertTo-SingleQuotedLiteral -Value $LaunchSpec.env.TAP_WORKTREE_PATH)),
    ('$env:TAP_COMMS_DIR = {0}' -f (ConvertTo-SingleQuotedLiteral -Value $LaunchSpec.env.TAP_COMMS_DIR)),
    ('Set-Location -Path {0}' -f (ConvertTo-SingleQuotedLiteral -Value $LaunchSpec.cwd)),
    ('$launchArgs = @({0})' -f ($argLiterals -join ", ")),
    ('$prompt = {0}' -f (ConvertTo-SingleQuotedLiteral -Value $LaunchSpec.prompt)),
    'Write-Host "tap session launch"',
    ('Write-Host ("  runtime: {0}" -f {1})' -f '{0}', (ConvertTo-SingleQuotedLiteral -Value $LaunchSpec.runtime)),
    ('Write-Host ("  mission: {0}" -f {1})' -f '{0}', (ConvertTo-SingleQuotedLiteral -Value $(if ($LaunchSpec.mission.id) { $LaunchSpec.mission.id } else { $LaunchSpec.mission.slug }))),
    ('Write-Host ("  worktree: {0}" -f {1})' -f '{0}', (ConvertTo-SingleQuotedLiteral -Value $LaunchSpec.cwd))
  )
  if ($LaunchSpec.env.TAP_MISSION_BRANCH) {
    $scriptLines = @(
      ('$env:TAP_MISSION_BRANCH = {0}' -f (ConvertTo-SingleQuotedLiteral -Value $LaunchSpec.env.TAP_MISSION_BRANCH))
    ) + $scriptLines
  }
  if ($LaunchSpec.env.TAP_APP_SERVER_URL) {
    $scriptLines = @(
      ('$env:TAP_APP_SERVER_URL = {0}' -f (ConvertTo-SingleQuotedLiteral -Value $LaunchSpec.env.TAP_APP_SERVER_URL))
    ) + $scriptLines
  }

  switch ($LaunchSpec.runtime) {
    "claude" {
      $scriptLines += @(
        ('& {0} @launchArgs $prompt' -f (ConvertTo-SingleQuotedLiteral -Value $LaunchSpec.command))
      )
    }
    "codex" {
      $codexCommandLiteral = ConvertTo-SingleQuotedLiteral -Value $LaunchSpec.command
      $codexWorkingDirectoryLiteral = ConvertTo-SingleQuotedLiteral -Value $LaunchSpec.cwd
      $bridgeStartPath = $LaunchSpec.runtimeConfig.codex.bridgeStartScriptPath
      $remoteUrl = $LaunchSpec.runtimeConfig.codex.appServerUrl
      $remoteUrlSource = $LaunchSpec.runtimeConfig.codex.appServerUrlSource
      $scriptLines += @(
        ('$codexCommandPath = {0}' -f $codexCommandLiteral),
        ('$codexWorkingDirectory = {0}' -f $codexWorkingDirectoryLiteral),
        ('$remoteUrl = {0}' -f (ConvertTo-SingleQuotedLiteral -Value $remoteUrl)),
        ('$remoteUrlSource = {0}' -f (ConvertTo-SingleQuotedLiteral -Value $remoteUrlSource)),
        ('$bridgeStartPath = {0}' -f (ConvertTo-SingleQuotedLiteral -Value $bridgeStartPath)),
        '$testAppServer = {',
        '  param(',
        '    [string]$HostName,',
        '    [int]$Port,',
        '    [int]$TimeoutMs = 750',
        '  )',
        '  $tcp = New-Object System.Net.Sockets.TcpClient',
        '  try {',
        '    $async = $tcp.BeginConnect($HostName, $Port, $null, $null)',
        '    $connected = $async.AsyncWaitHandle.WaitOne($TimeoutMs, $false)',
        '    if ($connected -and $tcp.Connected) {',
        '      $tcp.EndConnect($async)',
        '      return $true',
        '    }',
        '  } catch {',
        '  } finally {',
        '    $tcp.Close()',
        '  }',
        '  return $false',
        '}',
        '$appServerReachable = $false',
        'if ($remoteUrl -match "^wss?://([^:/]+):(\d+)$") {',
        '  $scheme = $remoteUrl.Split("://")[0]',
        '  $hostName = $matches[1]',
        '  $port = [int]$matches[2]',
        '  $appServerReachable = (& $testAppServer $hostName $port 750)',
        '} else {',
        '  throw ("Unsupported App Server URL: {0}" -f $remoteUrl)',
        '}',
        '$isLoopbackHost = $hostName -in @("127.0.0.1", "localhost")',
        '$findOpenPort = {',
        '  param(',
        '    [string]$HostName,',
        '    [int]$StartingPort,',
        '    [int]$Attempts = 20',
        '  )',
        '  if ($HostName -notin @("127.0.0.1", "localhost")) {',
        '    throw ("Cannot allocate an isolated App Server port for non-local host: {0}" -f $HostName)',
        '  }',
        '  for ($candidatePort = $StartingPort; $candidatePort -lt ($StartingPort + $Attempts); $candidatePort++) {',
        '    $listener = $null',
        '    try {',
        '      $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $candidatePort)',
        '      $listener.Start()',
        '      return $candidatePort',
        '    } catch {',
        '    } finally {',
        '      if ($listener) { $listener.Stop() }',
        '    }',
        '  }',
        '  throw ("No free App Server port found near {0}:{1}" -f $HostName, $StartingPort)',
        '}',
        '$launcherManagedAppServer = $null',
        '$launchRemoteUrl = $remoteUrl',
        'if ($appServerReachable -and $isLoopbackHost -and $remoteUrlSource -eq "explicit") {',
        '  throw ("Explicit App Server URL is already in use: {0}. Choose another -AppServerUrl." -f $remoteUrl)',
        '}',
        'if ($appServerReachable -and $isLoopbackHost) {',
        '  $isolatedPort = (& $findOpenPort $hostName ($port + 1) 20)',
        '  $launchRemoteUrl = ("{0}://{1}:{2}" -f $scheme, $hostName, $isolatedPort)',
        '  $port = $isolatedPort',
        '  $appServerReachable = $false',
        '  Write-Host ("  app-server: existing listener detected at {0}; starting isolated launcher-managed process at {1}" -f $remoteUrl, $launchRemoteUrl)',
        '} elseif ($appServerReachable) {',
        '  Write-Host ("  app-server: reusing existing non-local listener at {0}" -f $remoteUrl)',
        '}',
        '$effectiveLaunchArgs = @($launchArgs)',
        '$remoteIndex = [Array]::IndexOf($effectiveLaunchArgs, "--remote")',
        'if ($remoteIndex -ge 0 -and ($remoteIndex + 1) -lt $effectiveLaunchArgs.Count) {',
        '  $effectiveLaunchArgs[$remoteIndex + 1] = $launchRemoteUrl',
        '}',
        'if (-not $appServerReachable) {',
        '  Write-Host ("  app-server: starting launcher-managed process at {0}" -f $launchRemoteUrl)',
        '  $appServerArgs = @("app-server", "--listen", $launchRemoteUrl)',
        '  $launcherManagedAppServer = Start-Process -FilePath $codexCommandPath -ArgumentList $appServerArgs -WorkingDirectory $codexWorkingDirectory -WindowStyle Hidden -PassThru',
        '  $deadline = (Get-Date).AddSeconds(10)',
        '  do {',
        '    Start-Sleep -Milliseconds 250',
        '    $appServerReachable = (& $testAppServer $hostName $port 750)',
        '  } until ($appServerReachable -or (Get-Date) -ge $deadline)',
        '  if (-not $appServerReachable) {',
        '    throw ("Launcher-managed App Server did not become reachable at {0}" -f $launchRemoteUrl)',
        '  }',
        '}',
        'Write-Host ""',
        'Write-Host "After the session picks a name, start the bridge with:"',
        'Write-Host ("  powershell -NoProfile -ExecutionPolicy Bypass -File {0} -AgentName ""<chosen-name>"" -AppServerUrl {1} -MessageLookbackMinutes 1" -f $bridgeStartPath, $launchRemoteUrl)',
        'Write-Host ""',
        'try {',
        '  & $codexCommandPath @effectiveLaunchArgs $prompt',
        '} finally {',
        '  if ($launcherManagedAppServer) {',
        '    Stop-Process -Id $launcherManagedAppServer.Id -ErrorAction SilentlyContinue',
        '  }',
        '}'
      )
    }
    "gemini" {
      $scriptLines += @(
        'Write-Host ""',
        'Write-Host "Paste this prompt into Gemini after it starts:"',
        '$prompt -split "`n" | ForEach-Object { Write-Host $_ }',
        'Write-Host ""',
        ('& {0} @launchArgs' -f (ConvertTo-SingleQuotedLiteral -Value $LaunchSpec.command))
      )
    }
    default {
      throw "Launch backend not implemented for runtime: $($LaunchSpec.runtime)"
    }
  }

  $encoded = ConvertTo-EncodedCommand -ScriptText ($scriptLines -join "`n")
  Start-Process -FilePath $pwsh -WorkingDirectory $LaunchSpec.cwd -ArgumentList @("-NoExit", "-EncodedCommand", $encoded) | Out-Null
}
