param(
  [string]$RepoRoot = "",
  [string]$Mission = "",
  [string]$MissionPath = "",
  [ValidateSet("claude", "codex", "gemini")]
  [string]$Runtime = "claude",
  [string]$Worktree = "",
  [string]$Model = "",
  [string]$AppServerUrl = "ws://127.0.0.1:4501",
  [string[]]$ExistingAgentNames = @(),
  [string]$InitialPrompt = "",
  [switch]$NoChannels,
  [switch]$Prepare,
  [switch]$Launch,
  [switch]$Json
)

$ErrorActionPreference = "Stop"

$modulePaths = @(
  (Join-Path $PSScriptRoot "lib\tap-launch-common.ps1"),
  (Join-Path $PSScriptRoot "lib\tap-launch-mission.ps1"),
  (Join-Path $PSScriptRoot "lib\tap-launch-runtime.ps1"),
  (Join-Path $PSScriptRoot "lib\tap-launch-exec.ps1")
)

foreach ($modulePath in $modulePaths) {
  if (-not (Test-Path $modulePath)) {
    throw "Required TAP launcher module not found: $modulePath"
  }
}

. $modulePaths[0]
. $modulePaths[1]
. $modulePaths[2]
. $modulePaths[3]

$resolvedRepoRoot = Resolve-RepoRoot -ExplicitRepoRoot $RepoRoot
$useChannels = -not $NoChannels
$normalizedExistingAgentNames = Normalize-AgentNameList -Names $ExistingAgentNames
$hasExplicitAppServerUrl = $PSBoundParameters.ContainsKey("AppServerUrl")
$launchMode = if ($Launch) { "launch" } elseif ($Prepare) { "prepare" } else { "spec" }

$launchSpec = Get-LaunchSpec `
  -ResolvedRepoRoot $resolvedRepoRoot `
  -RequestedMission $Mission `
  -RequestedMissionPath $MissionPath `
  -RequestedWorktree $Worktree `
  -RequestedRuntime $Runtime `
  -RequestedModel $Model `
  -RequestedAppServerUrl $AppServerUrl `
  -RequestedAppServerUrlWasExplicit $hasExplicitAppServerUrl `
  -AgentNames $normalizedExistingAgentNames `
  -PromptOverride $InitialPrompt `
  -UseChannels $useChannels `
  -LaunchMode $launchMode

if ($Prepare) {
  $launchSpec = Invoke-Preparation `
    -ResolvedRepoRoot $resolvedRepoRoot `
    -LaunchSpec $launchSpec `
    -RequestedMission $Mission `
    -RequestedMissionPath $MissionPath `
    -RequestedWorktree $Worktree `
    -RequestedRuntime $Runtime `
    -RequestedModel $Model `
    -RequestedAppServerUrl $AppServerUrl `
    -RequestedAppServerUrlWasExplicit $hasExplicitAppServerUrl `
    -AgentNames $normalizedExistingAgentNames `
    -PromptOverride $InitialPrompt `
    -UseChannels $useChannels
}

if ($Launch) {
  if (-not $launchSpec.prelaunch.ready -and -not $Prepare) {
    throw "Launch blocked: prelaunch requirements are not ready. Re-run with -Prepare or inspect -Json output."
  }
  Start-LaunchSession -LaunchSpec $launchSpec
}

if ($Json) {
  $launchSpec | ConvertTo-Json -Depth 8
  exit 0
}

Write-Host "tap session launch spec"
Write-Host ("  runtime:  {0}" -f $launchSpec.runtime)
Write-Host ("  mission:  {0}" -f $(if ($launchSpec.mission.id) { $launchSpec.mission.id } else { $launchSpec.mission.slug }))
Write-Host ("  worktree: {0}" -f $launchSpec.worktree.path)
Write-Host ("  ready:    {0}" -f $launchSpec.prelaunch.ready)
Write-Host ("  command:  {0} {1}" -f $launchSpec.command, ($launchSpec.args -join " "))
if ($Launch) {
  Write-Host "  launched: true"
}
