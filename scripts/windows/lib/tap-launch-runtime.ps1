function Get-SettingsArtifactState {
  param(
    [string]$ResolvedRepoRoot,
    [string]$WorktreePath
  )

  $templatePath = Join-Path $ResolvedRepoRoot ".claude\settings.local.json"
  $targetPath = Join-Path $WorktreePath ".claude\settings.local.json"
  $exists = Test-Path $targetPath
  $ready = $false
  if ($exists) {
    $content = Get-Content -Path $targetPath -Encoding utf8 -Raw
    $ready = $content.Contains('"Write"') -and $content.Contains('"Agent"')
  }
  return [pscustomobject]@{ TemplatePath = $templatePath; TargetPath = $targetPath; Exists = $exists; Ready = $ready }
}

function Get-McpConfigState {
  param(
    [string]$ResolvedRepoRoot,
    [string]$WorktreePath,
    [string]$CommsDir
  )

  $targetPath = Join-Path $WorktreePath ".mcp.json"
  $repoScriptPath = Join-Path $ResolvedRepoRoot "packages\tap-plugin\channels\tap-comms.ts"
  $desired = @{
    mcpServers = @{
      "tap-comms" = @{
        command = "bun"
        args = @((Convert-ToForwardSlashPath -PathValue $repoScriptPath))
        env = @{
          TAP_COMMS_DIR = (Convert-ToForwardSlashPath -PathValue $CommsDir)
          TAP_AGENT_NAME = "unnamed"
        }
      }
    }
  } | ConvertTo-Json -Depth 8

  return [pscustomobject]@{
    TargetPath = $targetPath
    Exists = (Test-Path $targetPath)
    DesiredContent = $desired
    ServerNames = @("tap-comms")
  }
}

function Get-RuntimeCommandState {
  param([string]$CommandName)

  $command = Get-Command $CommandName -ErrorAction SilentlyContinue | Select-Object -First 1
  return [pscustomobject]@{
    Name   = $CommandName
    Exists = ($null -ne $command)
    Path   = $(if ($command) { $command.Source } else { $null })
  }
}

function Test-WebSocketAppServerUrl {
  param([string]$Url)

  $match = [regex]::Match($Url, '^wss?://(?<host>[^:/]+):(?<port>\d+)$')
  return [pscustomobject]@{
    IsValid = $match.Success
    Host    = $(if ($match.Success) { $match.Groups["host"].Value } else { $null })
    Port    = $(if ($match.Success) { [int]$match.Groups["port"].Value } else { $null })
  }
}

function Get-StablePortOffset {
  param(
    [string]$Seed,
    [int]$Modulo = 20
  )

  if ([string]::IsNullOrWhiteSpace($Seed) -or $Modulo -le 1) {
    return 0
  }

  $sum = 0
  foreach ($char in $Seed.ToCharArray()) {
    $sum = ($sum + [int][char]$char) % 2147483647
  }

  return ($sum % $Modulo)
}

function Find-AvailableLoopbackPort {
  param(
    [int]$StartingPort,
    [int]$Attempts = 20
  )

  for ($candidatePort = $StartingPort; $candidatePort -lt ($StartingPort + $Attempts); $candidatePort++) {
    $listener = $null
    try {
      $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $candidatePort)
      $listener.Start()
      return $candidatePort
    } catch {
    } finally {
      if ($listener) {
        $listener.Stop()
      }
    }
  }

  throw "No free loopback port found in range starting at $StartingPort."
}

function Resolve-CodexAppServerBinding {
  param(
    [string]$RequestedUrl,
    [bool]$WasExplicit,
    [string]$WorktreePath,
    [int]$SearchWindow = 20
  )

  $parsed = Test-WebSocketAppServerUrl -Url $RequestedUrl
  if (-not $parsed.IsValid) {
    return [pscustomobject]@{
      Url          = $RequestedUrl
      RequestedUrl = $RequestedUrl
      PreferredUrl = $null
      Host         = $null
      Port         = $null
      Source       = $(if ($WasExplicit) { "explicit-invalid" } else { "default-invalid" })
    }
  }

  if ($WasExplicit) {
    return [pscustomobject]@{
      Url          = $RequestedUrl
      RequestedUrl = $RequestedUrl
      PreferredUrl = $RequestedUrl
      Host         = $parsed.Host
      Port         = $parsed.Port
      Source       = "explicit"
    }
  }

  if ($parsed.Host -notin @("127.0.0.1", "localhost")) {
    return [pscustomobject]@{
      Url          = $RequestedUrl
      RequestedUrl = $RequestedUrl
      PreferredUrl = $RequestedUrl
      Host         = $parsed.Host
      Port         = $parsed.Port
      Source       = "default-nonlocal"
    }
  }

  $scheme = if ($RequestedUrl.StartsWith("wss://")) { "wss" } else { "ws" }
  $offset = Get-StablePortOffset -Seed $WorktreePath -Modulo $SearchWindow
  $preferredPort = $parsed.Port + $offset
  $resolvedPort = Find-AvailableLoopbackPort -StartingPort $preferredPort -Attempts $SearchWindow
  $resolvedUrl = "{0}://{1}:{2}" -f $scheme, $parsed.Host, $resolvedPort
  $preferredUrl = "{0}://{1}:{2}" -f $scheme, $parsed.Host, $preferredPort

  return [pscustomobject]@{
    Url          = $resolvedUrl
    RequestedUrl = $RequestedUrl
    PreferredUrl = $preferredUrl
    Host         = $parsed.Host
    Port         = $resolvedPort
    Source       = "auto-isolated"
  }
}

function Get-GeminiSettingsState {
  param(
    [string]$ResolvedRepoRoot,
    [string]$WorktreePath,
    [string]$CommsDir,
    [int]$PollingIntervalSeconds = 5,
    [string]$Model = ""
  )

  $targetPath = Join-Path $WorktreePath ".gemini\settings.json"
  $repoScriptPath = Join-Path $ResolvedRepoRoot "packages\tap-plugin\channels\tap-comms.ts"
  $desired = @{
    mcpServers = @{
      "tap-comms" = @{
        command = "bun"
        args = @((Convert-ToForwardSlashPath -PathValue $repoScriptPath))
        env = @{
          TAP_COMMS_DIR = (Convert-ToForwardSlashPath -PathValue $CommsDir)
          TAP_AGENT_NAME = "unnamed"
        }
      }
    }
    tap = @{
      pollingIntervalSeconds = $PollingIntervalSeconds
      runtime = "gemini"
      promptInjection = "manual-paste"
    }
  }
  if (-not [string]::IsNullOrWhiteSpace($Model)) {
    $desired.tap.model = $Model
  }

  return [pscustomobject]@{
    TargetPath = $targetPath
    Exists = (Test-Path $targetPath)
    DesiredContent = ($desired | ConvertTo-Json -Depth 8)
    ServerNames = @("tap-comms")
    PollingIntervalSeconds = $PollingIntervalSeconds
  }
}

function Get-CodexPromptText {
  param(
    [string]$BasePrompt
  )

  if ([string]::IsNullOrWhiteSpace($BasePrompt)) {
    return "Read the mission and stay within scope. Before starting work, pick a unique agent name, tell the user the chosen name explicitly, and wait for the bridge to be started."
  }

  $rewritten = $BasePrompt.Replace(
    "Before starting work, pick an agent name, call tap_set_name, and check the tap inbox.",
    "Before starting work, pick a unique agent name, tell the user the chosen name explicitly, and wait for the bridge to be started."
  )

  return $rewritten
}

function Get-InitialPromptText {
  param(
    $MissionMetadata,
    [string[]]$AgentNames,
    [string]$PromptOverride
  )

  $displayId = if ($MissionMetadata.Id) { $MissionMetadata.Id } else { $MissionMetadata.Slug }
  $parts = @(
    ("Read `{0}` and start mission {1}." -f $MissionMetadata.RelativePath, $displayId),
    $(if ($MissionMetadata.Branch) { "Work on branch `"$($MissionMetadata.Branch)`" and stay within the documented scope." } else { "Stay within the documented mission scope." }),
    "Before starting work, pick an agent name, call tap_set_name, and check the tap inbox."
  )
  if ($AgentNames.Count -gt 0) {
    $parts += "Do not reuse these active names: $($AgentNames -join ', ')."
  }
  if (-not [string]::IsNullOrWhiteSpace($PromptOverride)) {
    $parts += $PromptOverride.Trim()
  }
  return ($parts -join " ")
}

function Get-LaunchSpec {
  param(
    [string]$ResolvedRepoRoot,
    [string]$RequestedMission,
    [string]$RequestedMissionPath,
    [string]$RequestedWorktree,
    [string]$RequestedRuntime,
    [string]$RequestedModel,
    [string]$RequestedAppServerUrl,
    [bool]$RequestedAppServerUrlWasExplicit,
    [string[]]$AgentNames,
    [string]$PromptOverride,
    [bool]$UseChannels,
    [string]$LaunchMode
  )

  $tapConfig = Get-TapConfig -ResolvedRepoRoot $ResolvedRepoRoot
  $missionRef = Resolve-MissionReference -ResolvedRepoRoot $ResolvedRepoRoot -TapConfig $tapConfig -RequestedMission $RequestedMission -RequestedMissionPath $RequestedMissionPath
  $mission = Get-MissionMetadata -ResolvedRepoRoot $ResolvedRepoRoot -MissionFilePath $missionRef.ResolvedPath -IndexRow $missionRef.Row
  $worktree = Resolve-WorktreeSelection -ResolvedRepoRoot $ResolvedRepoRoot -TapConfig $tapConfig -MissionMetadata $mission -RequestedWorktree $RequestedWorktree
  $settings = Get-SettingsArtifactState -ResolvedRepoRoot $ResolvedRepoRoot -WorktreePath $worktree.Path
  $mcp = Get-McpConfigState -ResolvedRepoRoot $ResolvedRepoRoot -WorktreePath $worktree.Path -CommsDir $tapConfig.CommsDir
  $geminiSettings = Get-GeminiSettingsState -ResolvedRepoRoot $ResolvedRepoRoot -WorktreePath $worktree.Path -CommsDir $tapConfig.CommsDir -Model $RequestedModel
  $codexAppServerBinding = Resolve-CodexAppServerBinding `
    -RequestedUrl $RequestedAppServerUrl `
    -WasExplicit $RequestedAppServerUrlWasExplicit `
    -WorktreePath $worktree.Path
  $appServerUrlState = Test-WebSocketAppServerUrl -Url $codexAppServerBinding.Url

  $steps = @()
  $steps += [pscustomobject]@{
    id = "worktree"
    status = $(if ($worktree.Exists) { "ready" } else { "required" })
    details = $(if ($worktree.Exists) { $worktree.Path } else { "Create worktree at $($worktree.Path)" })
    command = $(if ($worktree.Exists) { $null } else { "bash `"$((Join-Path $ResolvedRepoRoot 'scripts\tap-setup.sh'))`" `"$((Convert-ToPosixDrivePath -PathValue $worktree.Path))`" `"$($mission.Branch)`" main" })
  }

  $warnings = @()
  if ([string]::IsNullOrWhiteSpace($mission.Branch)) { $warnings += "Mission branch could not be resolved." }
  $commsDirReady = (-not [string]::IsNullOrWhiteSpace($tapConfig.CommsDir)) -and (Test-Path $tapConfig.CommsDir)
  $steps += [pscustomobject]@{
    id = "tap-comms-dir"
    status = $(if ($commsDirReady) { "ready" } else { "required" })
    details = $(if ($commsDirReady) {
      $tapConfig.CommsDir
    } elseif ([string]::IsNullOrWhiteSpace($tapConfig.CommsDir)) {
      "Set TAP_COMMS_DIR in $($tapConfig.Path)"
    } else {
      "Create tap comms directory at $($tapConfig.CommsDir)"
    })
    command = $(if ($commsDirReady) {
      $null
    } elseif ([string]::IsNullOrWhiteSpace($tapConfig.CommsDir)) {
      'Set TAP_COMMS_DIR="<absolute-path-to-hua-comms>" in "{0}"' -f $tapConfig.Path
    } else {
      'New-Item -ItemType Directory -Path "{0}" -Force' -f $tapConfig.CommsDir
    })
  }

  if ($RequestedRuntime -notin @("claude", "codex", "gemini")) {
    throw "Runtime adapter not implemented yet: $RequestedRuntime"
  }

  $runtimeCommandName = switch ($RequestedRuntime) {
    "claude" { "claude" }
    "codex" { "codex.cmd" }
    "gemini" { "gemini.cmd" }
  }
  $runtimeCommand = Get-RuntimeCommandState -CommandName $runtimeCommandName
  $steps += [pscustomobject]@{
    id = "runtime-cli"
    status = $(if ($runtimeCommand.Exists) { "ready" } else { "required" })
    details = $(if ($runtimeCommand.Exists) { $runtimeCommand.Path } else { "Command not found: $runtimeCommandName" })
    command = $(if ($runtimeCommand.Exists) { $null } else { "Install or add $runtimeCommandName to PATH." })
  }

  $prompt = Get-InitialPromptText -MissionMetadata $mission -AgentNames $AgentNames -PromptOverride $PromptOverride
  $args = New-Object System.Collections.Generic.List[string]
  $command = ""
  $runtimeConfig = $null
  $artifacts = $null
  $postLaunchChecklist = @(
    "Read the mission file and confirm scope before editing.",
    "Pick a unique agent name and call tap_set_name.",
    "Check the tap inbox for messages addressed to your name or all.",
    "Keep commits, PRs, and tap-comms messages tagged with your chosen name."
  )

  switch ($RequestedRuntime) {
    "claude" {
      $steps += [pscustomobject]@{
        id = "settings"
        status = $(if ($settings.Ready) { "ready" } else { "required" })
        details = $settings.TargetPath
        command = $(if ($settings.Ready) {
          $null
        } else {
          'Copy-Item "{0}" "{1}" -Force; git -c safe.directory="{2}" -C "{3}" update-index --skip-worktree .claude/settings.local.json' -f `
            $settings.TemplatePath, `
            $settings.TargetPath, `
            ($worktree.Path.Replace("\", "/")), `
            $worktree.Path
        })
      }
      $steps += [pscustomobject]@{
        id = "mcp-config"
        status = $(if ($mcp.Exists) { "ready" } else { "required" })
        details = $mcp.TargetPath
        command = $(if ($mcp.Exists) { $null } else { 'Write launcher-managed tap-comms MCP config to "{0}"' -f $mcp.TargetPath })
      }
      if (-not (Test-Path $settings.TemplatePath)) { $warnings += "Root settings.local.json template is missing." }
      $command = "claude"
      if ($UseChannels) {
        $args.Add("--dangerously-load-development-channels")
        foreach ($server in $mcp.ServerNames) { $args.Add("server:$server") }
      }
      if (-not [string]::IsNullOrWhiteSpace($RequestedModel)) {
        $args.Add("--model")
        $args.Add($RequestedModel)
      }
      $args.Add("--name")
      $args.Add($(if ($mission.Id) { "tap $($mission.Id)" } else { "tap $($mission.Slug)" }))
      $runtimeConfig = [pscustomobject]@{
        claude = [pscustomobject]@{
          channelsFlag = $UseChannels
          mcpServers = @($mcp.ServerNames)
          mcpConfigPath = $mcp.TargetPath
          settingsLocalPath = $settings.TargetPath
          settingsTemplatePath = $settings.TemplatePath
          runtimeCommandPath = $(if ($runtimeCommand.Exists) { $runtimeCommand.Path } else { $null })
          existingAgentNames = [string[]]@($AgentNames)
          initialPrompt = $prompt
          model = $(if ($RequestedModel) { $RequestedModel } else { $null })
        }
      }
      $artifacts = [pscustomobject]@{
        commsDir = $(if ($tapConfig.CommsDir) { $tapConfig.CommsDir } else { $null })
        mcpConfigPath = $mcp.TargetPath
        settingsLocalPath = $settings.TargetPath
        settingsTemplatePath = $settings.TemplatePath
        runtimeCommandPath = $(if ($runtimeCommand.Exists) { $runtimeCommand.Path } else { $null })
        tapConfigPath = $tapConfig.Path
      }
    }
    "codex" {
      $bridgeStartScript = Join-Path $ResolvedRepoRoot "scripts\codex-app-server-bridge-start.ps1"
      $bridgeStatusScript = Join-Path $ResolvedRepoRoot "scripts\codex-app-server-bridge-status.ps1"
      $bridgeStopScript = Join-Path $ResolvedRepoRoot "scripts\codex-app-server-bridge-stop.ps1"
      $bridgeScripts = @($bridgeStartScript, $bridgeStatusScript, $bridgeStopScript)
      $missingBridgeScripts = @($bridgeScripts | Where-Object { -not (Test-Path $_) })
      $resolvedAppServerUrl = $codexAppServerBinding.Url
      $codexPrompt = Get-CodexPromptText -BasePrompt $prompt

      $steps += [pscustomobject]@{
        id = "codex-app-server-url"
        status = $(if ($appServerUrlState.IsValid) { "ready" } else { "required" })
        details = $(if ($appServerUrlState.IsValid) {
          "{0} ({1})" -f $resolvedAppServerUrl, $codexAppServerBinding.Source
        } else {
          $resolvedAppServerUrl
        })
        command = $(if ($appServerUrlState.IsValid) {
          $null
        } else {
          'Use -AppServerUrl "ws://127.0.0.1:4501" or another ws://host:port value.'
        })
      }
      $steps += [pscustomobject]@{
        id = "codex-bridge-scripts"
        status = $(if ($missingBridgeScripts.Count -eq 0) { "ready" } else { "required" })
        details = $(if ($missingBridgeScripts.Count -eq 0) { $bridgeStartScript } else { "Missing bridge scripts: $($missingBridgeScripts -join ', ')" })
        command = $(if ($missingBridgeScripts.Count -eq 0) { $null } else { "Restore the missing codex bridge script files." })
      }

      $command = "codex.cmd"
      $args.Add("--enable")
      $args.Add("tui_app_server")
      $args.Add("--remote")
      $args.Add($resolvedAppServerUrl)
      $args.Add("--cd")
      $args.Add($worktree.Path)
      if (-not [string]::IsNullOrWhiteSpace($RequestedModel)) {
        $args.Add("--model")
        $args.Add($RequestedModel)
      }

      $prompt = $codexPrompt
      $runtimeConfig = [pscustomobject]@{
        codex = [pscustomobject]@{
          launchMode = "remote-tui"
          appServerUrl = $resolvedAppServerUrl
          requestedAppServerUrl = $RequestedAppServerUrl
          appServerUrlSource = $codexAppServerBinding.Source
          preferredAppServerUrl = $codexAppServerBinding.PreferredUrl
          appServerFeature = "tui_app_server"
          bridgeStartScriptPath = $bridgeStartScript
          bridgeStatusScriptPath = $bridgeStatusScript
          bridgeStopScriptPath = $bridgeStopScript
          runtimeCommandPath = $(if ($runtimeCommand.Exists) { $runtimeCommand.Path } else { $null })
          existingAgentNames = [string[]]@($AgentNames)
          initialPrompt = $codexPrompt
          model = $(if ($RequestedModel) { $RequestedModel } else { $null })
          permissionsMode = "inherit-cli-default"
        }
      }
      $artifacts = [pscustomobject]@{
        commsDir = $(if ($tapConfig.CommsDir) { $tapConfig.CommsDir } else { $null })
        bridgeStartScriptPath = $bridgeStartScript
        bridgeStatusScriptPath = $bridgeStatusScript
        bridgeStopScriptPath = $bridgeStopScript
        runtimeCommandPath = $(if ($runtimeCommand.Exists) { $runtimeCommand.Path } else { $null })
        appServerUrl = $resolvedAppServerUrl
        tapConfigPath = $tapConfig.Path
      }
      $postLaunchChecklist = @(
        "Read the mission file and confirm scope before editing.",
        "Ask the session to pick a unique agent name and print it explicitly.",
        ('After the name is chosen, start the bridge: powershell -NoProfile -ExecutionPolicy Bypass -File "{0}" -AgentName "<chosen-name>" -AppServerUrl "{1}" -MessageLookbackMinutes 1' -f $bridgeStartScript, $resolvedAppServerUrl),
        ('Verify the bridge: powershell -NoProfile -ExecutionPolicy Bypass -File "{0}" -AgentName "<chosen-name>"' -f $bridgeStatusScript),
        "Keep commits, PRs, and tap-comms messages tagged with the chosen name."
      )
    }
    "gemini" {
      $steps += [pscustomobject]@{
        id = "gemini-settings"
        status = $(if ($geminiSettings.Exists) { "ready" } else { "required" })
        details = $geminiSettings.TargetPath
        command = $(if ($geminiSettings.Exists) { $null } else { 'Write launcher-managed Gemini settings to "{0}"' -f $geminiSettings.TargetPath })
      }
      $command = "gemini.cmd"
      if (-not [string]::IsNullOrWhiteSpace($RequestedModel)) {
        $args.Add("-m")
        $args.Add($RequestedModel)
      }
      $runtimeConfig = [pscustomobject]@{
        gemini = [pscustomobject]@{
          mcpServers = @($geminiSettings.ServerNames)
          settingsPath = $geminiSettings.TargetPath
          pollingIntervalSeconds = $geminiSettings.PollingIntervalSeconds
          initialPromptMode = "manual-paste"
          fakeIdePort = $null
          runtimeCommandPath = $(if ($runtimeCommand.Exists) { $runtimeCommand.Path } else { $null })
          existingAgentNames = [string[]]@($AgentNames)
          initialPrompt = $prompt
          model = $(if ($RequestedModel) { $RequestedModel } else { $null })
        }
      }
      $artifacts = [pscustomobject]@{
        commsDir = $(if ($tapConfig.CommsDir) { $tapConfig.CommsDir } else { $null })
        geminiSettingsPath = $geminiSettings.TargetPath
        runtimeCommandPath = $(if ($runtimeCommand.Exists) { $runtimeCommand.Path } else { $null })
        tapConfigPath = $tapConfig.Path
      }
    }
  }

  return [pscustomobject]@{
    schemaVersion = "tap.launch.v1"
    generatedAt = (Get-Date).ToString("o")
    runtime = $RequestedRuntime
    launchMode = $LaunchMode
    agentName = $null
    repoRoot = $ResolvedRepoRoot
    mission = [pscustomobject]@{
      id = $(if ($mission.Id) { $mission.Id } else { $null })
      title = $mission.Title
      path = $mission.Path
      relativePath = $mission.RelativePath
      slug = $mission.Slug
      branch = $(if ($mission.Branch) { $mission.Branch } else { $null })
      status = $(if ($mission.Status) { $mission.Status } else { $null })
      owner = $(if ($mission.Owner) { $mission.Owner } else { $null })
      goal = $(if ($mission.Goal) { $mission.Goal } else { $null })
      scope = @($mission.Scope)
      prerequisites = @($mission.Prerequisites)
      metadataSource = [pscustomobject]@{
        branch = $(if ($mission.HasFrontMatter) { "frontmatter-or-status" } elseif ($missionRef.Row) { "status-or-index" } else { "status-section" })
        id = $(if ($missionRef.Row) { "missions-index" } elseif ($mission.HasFrontMatter -and $mission.Id) { "frontmatter" } else { "derived" })
      }
    }
    worktree = [pscustomobject]@{
      path = $worktree.Path
      source = $worktree.Source
      exists = $worktree.Exists
      branch = $(if ($worktree.Branch) { $worktree.Branch } else { $null })
    }
    cwd = $worktree.Path
    appServerUrl = $(if ($RequestedRuntime -eq "codex") { $codexAppServerBinding.Url } else { $null })
    command = $command
    args = @($args)
    prompt = $prompt
    env = [pscustomobject]@{
      TAP_RUNTIME = $RequestedRuntime
      TAP_MISSION_ID = $mission.Id
      TAP_MISSION_PATH = $mission.RelativePath
      TAP_WORKTREE_PATH = $worktree.Path
      TAP_MISSION_BRANCH = $mission.Branch
      TAP_COMMS_DIR = $(if ($tapConfig.CommsDir) { $tapConfig.CommsDir } else { $null })
      TAP_APP_SERVER_URL = $(if ($RequestedRuntime -eq "codex") { $codexAppServerBinding.Url } else { $null })
    }
    runtimeConfig = $runtimeConfig
    artifacts = $artifacts
    prelaunch = [pscustomobject]@{
      ready = ((@($steps | Where-Object { $_.status -eq "required" }).Count -eq 0) -and ($warnings.Count -eq 0))
      steps = @($steps)
      warnings = @($warnings)
    }
    postLaunchChecklist = @($postLaunchChecklist)
    backend = [pscustomobject]@{
      recommended = "start-process"
      supported = @("start-process")
    }
  }
}
