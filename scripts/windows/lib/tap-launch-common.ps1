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

function Convert-TapPath {
  param(
    [string]$PathValue,
    [string]$BasePath = ""
  )

  if ([string]::IsNullOrWhiteSpace($PathValue)) {
    return $PathValue
  }

  $trimmed = $PathValue.Trim().Trim([char]39, [char]34, [char]96)
  if ($trimmed -match "^[A-Za-z]:\\") {
    return $trimmed
  }

  if ($trimmed -match "^/([A-Za-z])/(.*)$") {
    return "{0}:\{1}" -f $matches[1].ToUpperInvariant(), $matches[2].Replace("/", "\")
  }

  if (-not [string]::IsNullOrWhiteSpace($BasePath)) {
    return (Join-Path $BasePath $trimmed)
  }

  return $trimmed
}

function Convert-ToPosixDrivePath {
  param([string]$PathValue)

  if ($PathValue -match "^([A-Za-z]):\\(.*)$") {
    return "/{0}/{1}" -f $matches[1].ToLowerInvariant(), $matches[2].Replace("\", "/")
  }

  return $PathValue.Replace("\", "/")
}

function Convert-ToForwardSlashPath {
  param([string]$PathValue)

  if ([string]::IsNullOrWhiteSpace($PathValue)) {
    return $PathValue
  }

  return $PathValue.Replace("\", "/")
}

function Get-RelativePath {
  param(
    [string]$BasePath,
    [string]$TargetPath
  )

  $baseFull = (Resolve-Path $BasePath).Path
  $targetFull = (Resolve-Path $TargetPath).Path
  if (-not $baseFull.EndsWith("\")) {
    $baseFull = "$baseFull\"
  }

  $baseUri = New-Object System.Uri($baseFull)
  $targetUri = New-Object System.Uri($targetFull)
  return ([System.Uri]::UnescapeDataString($baseUri.MakeRelativeUri($targetUri).ToString())).Replace("/", "\")
}

function Get-TapConfig {
  param([string]$ResolvedRepoRoot)

  $tapConfigPath = Join-Path $ResolvedRepoRoot ".tap-config"
  $result = @{
    Path         = $tapConfigPath
    CommsDir     = ""
    MissionsDir  = Join-Path $ResolvedRepoRoot "docs\missions"
    WorktreeBase = [System.IO.Path]::GetDirectoryName($ResolvedRepoRoot)
  }

  if (-not (Test-Path $tapConfigPath)) {
    return [pscustomobject]$result
  }

  $configText = Get-Content -Path $tapConfigPath -Encoding utf8 -Raw
  foreach ($key in @("TAP_COMMS_DIR", "TAP_MISSIONS_DIR", "TAP_WORKTREE_BASE")) {
    $match = [regex]::Match($configText, ("^{0}=""?(.*?)""?$" -f [regex]::Escape($key)), [System.Text.RegularExpressions.RegexOptions]::Multiline)
    if (-not $match.Success) { continue }
    switch ($key) {
      "TAP_COMMS_DIR" { $result.CommsDir = Convert-TapPath -PathValue $match.Groups[1].Value -BasePath $ResolvedRepoRoot }
      "TAP_MISSIONS_DIR" { $result.MissionsDir = Convert-TapPath -PathValue $match.Groups[1].Value -BasePath $ResolvedRepoRoot }
      "TAP_WORKTREE_BASE" { $result.WorktreeBase = Convert-TapPath -PathValue $match.Groups[1].Value -BasePath $ResolvedRepoRoot }
    }
  }

  return [pscustomobject]$result
}

function Normalize-AgentNameList {
  param([string[]]$Names)

  $result = New-Object System.Collections.Generic.List[string]
  foreach ($entry in @($Names)) {
    foreach ($part in (($entry -split ",") | ForEach-Object { $_.Trim() })) {
      if (-not [string]::IsNullOrWhiteSpace($part)) {
        $result.Add($part)
      }
    }
  }
  return $result.ToArray()
}

function Normalize-MarkdownText {
  param([string]$Value)

  if ([string]::IsNullOrWhiteSpace($Value)) {
    return ""
  }

  return ($Value -replace '\r\n?', "`n").Trim()
}

function Normalize-FrontMatterValue {
  param([string]$Value)

  $trimmed = $Value.Trim().Trim([char]39, [char]34, [char]96)
  if ([string]::IsNullOrWhiteSpace($trimmed)) {
    return $null
  }
  if ($trimmed -in @("null", "~")) {
    return $null
  }
  return $trimmed
}
