function Parse-SimpleFrontMatter {
  param([string]$Content)

  $normalized = Normalize-MarkdownText -Value $Content
  if (-not $normalized.StartsWith("---`n")) {
    return [pscustomobject]@{ Values = @{}; Body = $normalized }
  }

  $lines = $normalized -split "`n"
  $values = @{}
  $currentKey = ""
  $bodyStart = -1

  for ($i = 1; $i -lt $lines.Count; $i++) {
    $line = $lines[$i]
    if ($line.Trim() -eq "---") {
      $bodyStart = $i + 1
      break
    }
    if ($line -match '^(?<key>[A-Za-z0-9_-]+):\s*(?<value>.*)$') {
      $currentKey = $matches["key"]
      $value = Normalize-FrontMatterValue -Value $matches["value"]
      $values[$currentKey] = if ($null -eq $value) { @() } else { $value }
      continue
    }
    $itemMatch = [regex]::Match($line, '^\s*-\s+(?<item>.+)$')
    if ($itemMatch.Success -and -not [string]::IsNullOrWhiteSpace($currentKey)) {
      $existing = @($values[$currentKey])
      $values[$currentKey] = @($existing) + @(Normalize-FrontMatterValue -Value $itemMatch.Groups["item"].Value)
    }
  }

  $body = if ($bodyStart -ge 0 -and $bodyStart -lt $lines.Count) {
    ($lines[$bodyStart..($lines.Count - 1)] -join "`n").Trim()
  } else {
    $normalized
  }

  return [pscustomobject]@{ Values = $values; Body = $body }
}

function Get-MarkdownSectionBody {
  param(
    [string]$Content,
    [string]$Heading
  )

  $pattern = "(?ms)^##\s+$([regex]::Escape($Heading))\s*`n(?<body>.*?)(?=^##\s+|\z)"
  $match = [regex]::Match((Normalize-MarkdownText -Value $Content), $pattern)
  if ($match.Success) {
    return $match.Groups["body"].Value.Trim()
  }
  return ""
}

function Get-FirstMarkdownHeading {
  param([string]$Content)

  $match = [regex]::Match((Normalize-MarkdownText -Value $Content), '(?m)^#\s+(?<title>.+)$')
  if ($match.Success) {
    return $match.Groups["title"].Value.Trim()
  }
  return ""
}

function Get-BulletMetadataValue {
  param(
    [string]$SectionBody,
    [string]$Key
  )

  $match = [regex]::Match($SectionBody, ('(?mi)^\s*-\s*{0}:\s*(?<value>.+)$' -f [regex]::Escape($Key)))
  if ($match.Success) {
    return $match.Groups["value"].Value.Trim().Trim([char]39, [char]34, [char]96)
  }
  return ""
}

function Get-MarkdownListItems {
  param([string]$SectionBody)

  $items = New-Object System.Collections.Generic.List[string]
  foreach ($line in ($SectionBody -split "`n")) {
    $itemMatch = [regex]::Match($line, '^\s*-\s+(?<item>.+)$')
    if ($itemMatch.Success) {
      $items.Add($itemMatch.Groups["item"].Value.Trim())
    }
  }
  return $items.ToArray()
}

function Normalize-MissionStatus {
  param([string]$StatusValue)

  if ([string]::IsNullOrWhiteSpace($StatusValue)) {
    return ""
  }

  $normalized = $StatusValue.ToLowerInvariant()
  foreach ($candidate in @("planned", "active", "completed", "blocked", "paused", "complete")) {
    if ($normalized.Contains($candidate)) {
      return $(if ($candidate -eq "complete") { "completed" } else { $candidate })
    }
  }

  return $StatusValue.Trim()
}

function Get-MissionsIndex {
  param([string]$ResolvedRepoRoot)

  $missionsFile = Join-Path $ResolvedRepoRoot "docs\missions\MISSIONS.md"
  if (-not (Test-Path $missionsFile)) {
    return @()
  }

  $rows = New-Object System.Collections.Generic.List[object]
  foreach ($line in (Get-Content -Path $missionsFile -Encoding utf8)) {
    if (-not $line.Trim().StartsWith("|")) { continue }
    $parts = @($line.Split("|") | ForEach-Object { $_.Trim() })
    if ($parts.Count -lt 6) { continue }

    $id = $parts[1]
    if (-not ($id -match '^M\d+')) { continue }

    $missionCell = $parts[2]
    $linkMatch = [regex]::Match($missionCell, '\[(?<title>.+?)\]\((?<path>\./[^)]+)\)')
    $title = if ($linkMatch.Success) { $linkMatch.Groups["title"].Value } else { ($missionCell -replace '~~', '').Trim() }
    $relativePath = if ($linkMatch.Success) {
      (Join-Path "docs/missions" $linkMatch.Groups["path"].Value.TrimStart(".","/")).Replace("\", "/")
    } else {
      ""
    }

    $rows.Add([pscustomobject]@{
      Id           = $id
      Title        = $title
      RelativePath = $relativePath
      Branch       = $parts[3].Trim([char]96, [char]39, [char]34)
      Status       = Normalize-MissionStatus -StatusValue $parts[4]
      Owner        = $parts[5]
    })
  }

  return $rows.ToArray()
}

function Find-MissionFileByFrontMatterId {
  param(
    [string]$MissionsDir,
    [string]$MissionId
  )

  if ([string]::IsNullOrWhiteSpace($MissionId) -or -not (Test-Path $MissionsDir)) {
    return $null
  }

  foreach ($file in (Get-ChildItem -Path $MissionsDir -File -Filter "*.md" -ErrorAction SilentlyContinue)) {
    $raw = Get-Content -Path $file.FullName -Encoding utf8 -Raw
    $front = Parse-SimpleFrontMatter -Content $raw
    if ($front.Values.ContainsKey("id") -and [string]$front.Values["id"] -eq $MissionId) {
      return $file.FullName
    }
  }

  return $null
}

function Resolve-MissionReference {
  param(
    [string]$ResolvedRepoRoot,
    $TapConfig,
    [string]$RequestedMission,
    [string]$RequestedMissionPath
  )

  $index = @(Get-MissionsIndex -ResolvedRepoRoot $ResolvedRepoRoot)
  if ([string]::IsNullOrWhiteSpace($RequestedMission) -and [string]::IsNullOrWhiteSpace($RequestedMissionPath)) {
    throw "Mission or MissionPath is required."
  }

  $resolvedPath = ""
  $row = $null

  if (-not [string]::IsNullOrWhiteSpace($RequestedMissionPath)) {
    $candidate = Convert-TapPath -PathValue $RequestedMissionPath -BasePath $ResolvedRepoRoot
    if (-not [System.IO.Path]::IsPathRooted($candidate)) { $candidate = Join-Path $ResolvedRepoRoot $candidate }
    if (-not (Test-Path $candidate) -and -not $candidate.EndsWith(".md")) { $candidate = "$candidate.md" }
    if (-not (Test-Path $candidate)) { throw "Mission file not found: $RequestedMissionPath" }
    $resolvedPath = (Resolve-Path $candidate).Path
  } elseif ($RequestedMission -match '^M\d+$') {
    $row = $index | Where-Object { $_.Id -eq $RequestedMission } | Select-Object -First 1
    if ($row) {
      if ([string]::IsNullOrWhiteSpace($row.RelativePath)) { throw "Mission $RequestedMission does not link to a mission file." }
      $resolvedPath = (Resolve-Path (Join-Path $ResolvedRepoRoot $row.RelativePath)).Path
    } else {
      $frontMatterMatch = Find-MissionFileByFrontMatterId -MissionsDir $TapConfig.MissionsDir -MissionId $RequestedMission
      if (-not $frontMatterMatch) { throw "Mission id not found in MISSIONS.md or mission frontmatter: $RequestedMission" }
      $resolvedPath = (Resolve-Path $frontMatterMatch).Path
    }
  } else {
    $slug = $RequestedMission.Trim().TrimStart(".","/","\")
    if (-not $slug.EndsWith(".md")) { $slug = "$slug.md" }
    $candidate = Join-Path $TapConfig.MissionsDir $slug
    if (-not (Test-Path $candidate)) { throw "Mission reference could not be resolved: $RequestedMission" }
    $resolvedPath = (Resolve-Path $candidate).Path
  }

  if (-not $row) {
    $relativePath = (Get-RelativePath -BasePath $ResolvedRepoRoot -TargetPath $resolvedPath).Replace("\", "/")
    $row = $index | Where-Object { $_.RelativePath.Replace("\", "/") -eq $relativePath } | Select-Object -First 1
  }

  return [pscustomobject]@{ ResolvedPath = $resolvedPath; Row = $row }
}

function Get-MissionMetadata {
  param(
    [string]$ResolvedRepoRoot,
    [string]$MissionFilePath,
    $IndexRow
  )

  $content = Get-Content -Path $MissionFilePath -Encoding utf8 -Raw
  $front = Parse-SimpleFrontMatter -Content $content
  $body = $front.Body

  $statusSection = Get-MarkdownSectionBody -Content $body -Heading "Status"
  $scopeSection = Get-MarkdownSectionBody -Content $body -Heading "Scope"
  $prereqSection = Get-MarkdownSectionBody -Content $body -Heading "Prerequisites"

  $branch = if ($front.Values.ContainsKey("branch")) { [string]$front.Values["branch"] } else { Get-BulletMetadataValue -SectionBody $statusSection -Key "branch" }
  if ([string]::IsNullOrWhiteSpace($branch) -and $IndexRow) { $branch = $IndexRow.Branch }

  $status = if ($front.Values.ContainsKey("status")) { [string]$front.Values["status"] } else { Get-BulletMetadataValue -SectionBody $statusSection -Key "status" }
  if ([string]::IsNullOrWhiteSpace($status) -and $IndexRow) { $status = $IndexRow.Status }

  $owner = if ($front.Values.ContainsKey("owner")) { [string]$front.Values["owner"] } else { Get-BulletMetadataValue -SectionBody $statusSection -Key "owner" }
  if ([string]::IsNullOrWhiteSpace($owner) -and $IndexRow) { $owner = $IndexRow.Owner }

  return [pscustomobject]@{
    Id             = if ($front.Values.ContainsKey("id")) { [string]$front.Values["id"] } elseif ($IndexRow) { $IndexRow.Id } else { "" }
    Title          = if ($front.Values.ContainsKey("title")) { [string]$front.Values["title"] } elseif ($IndexRow) { $IndexRow.Title } else { Get-FirstMarkdownHeading -Content $body }
    Path           = $MissionFilePath
    RelativePath   = (Get-RelativePath -BasePath $ResolvedRepoRoot -TargetPath $MissionFilePath).Replace("\", "/")
    Slug           = [System.IO.Path]::GetFileNameWithoutExtension($MissionFilePath)
    Branch         = $branch
    Status         = Normalize-MissionStatus -StatusValue $status
    Owner          = $owner
    Goal           = Get-MarkdownSectionBody -Content $body -Heading "Goal"
    Scope          = @(if ($front.Values.ContainsKey("scope")) { @($front.Values["scope"]) } else { Get-MarkdownListItems -SectionBody $scopeSection })
    Prerequisites  = @(if ($front.Values.ContainsKey("prerequisites")) { @($front.Values["prerequisites"]) } else { Get-MarkdownListItems -SectionBody $prereqSection })
    HasFrontMatter = ($front.Values.Count -gt 0)
  }
}

function Get-GitWorktreeMap {
  param([string]$ResolvedRepoRoot)

  $output = & git -c ("safe.directory={0}" -f ($ResolvedRepoRoot.Replace("\", "/"))) -C $ResolvedRepoRoot worktree list --porcelain 2>$null
  if ($LASTEXITCODE -ne 0) { return @{} }

  $map = @{}
  $currentPath = ""
  foreach ($line in $output) {
    if ($line -match '^worktree\s+(?<path>.+)$') { $currentPath = $matches["path"]; continue }
    if ($line -match '^branch\s+refs/heads/(?<branch>.+)$') { $map[$matches["branch"]] = $currentPath; continue }
    if ([string]::IsNullOrWhiteSpace($line)) { $currentPath = "" }
  }
  return $map
}

function Resolve-WorktreeSelection {
  param(
    [string]$ResolvedRepoRoot,
    $TapConfig,
    $MissionMetadata,
    [string]$RequestedWorktree
  )

  $branch = $MissionMetadata.Branch
  $map = Get-GitWorktreeMap -ResolvedRepoRoot $ResolvedRepoRoot

  if (-not [string]::IsNullOrWhiteSpace($RequestedWorktree)) {
    $candidate = Convert-TapPath -PathValue $RequestedWorktree -BasePath $ResolvedRepoRoot
    $path = if (Test-Path $candidate) { (Resolve-Path $candidate).Path } else { $candidate }
    return [pscustomobject]@{ Path = $path; Source = "explicit"; Exists = (Test-Path $path); Branch = $branch }
  }

  if (-not [string]::IsNullOrWhiteSpace($branch) -and $map.ContainsKey($branch)) {
    return [pscustomobject]@{ Path = $map[$branch]; Source = "git-worktree"; Exists = $true; Branch = $branch }
  }

  if ($branch -eq "main") {
    return [pscustomobject]@{ Path = $ResolvedRepoRoot; Source = "repo-root"; Exists = $true; Branch = $branch }
  }

  $fragment = $branch -replace '[\\/]', '-' -replace '[^A-Za-z0-9._-]', '-'
  $path = Join-Path $TapConfig.WorktreeBase ("wt-{0}" -f $fragment)
  return [pscustomobject]@{ Path = $path; Source = "derived"; Exists = (Test-Path $path); Branch = $branch }
}
