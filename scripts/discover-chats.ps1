<#
.SYNOPSIS
  Read-only scan that locates where AI coding tools store their chat / session
  logs on Windows, and reports the on-disk FORMAT (not the private content).

.DESCRIPTION
  Covers VS Code-family editors (VS Code, Insiders, VSCodium, Cursor, Windsurf,
  Antigravity, Devin, Trae, Positron, ...) plus home-directory stores used by
  Claude Code, Codeium/Windsurf, etc.

  PRIVACY: the script only prints structural info — directory names, file
  counts, file sizes, and the top-level JSON KEYS / record "type" values of a
  few sample lines. It does NOT print prompt text, code, or message bodies.
  Still, review the generated report file before sharing it.

.NOTES
  Nothing is modified. Output is written to a report file and the console.
#>

$ErrorActionPreference = 'SilentlyContinue'

$report = [System.Collections.Generic.List[string]]::new()
function Out-Line([string]$text = '') {
  $report.Add($text) | Out-Null
  Write-Host $text
}

# Keywords that hint a folder belongs to an AI chat / assistant.
$keywords = @(
  'copilot','chat','claude','anthropic','cascade','codeium','windsurf',
  'antigravity','google','gemini','devin','cognition','assistant','llm',
  'gpt','openai','session','interactive','aichat','continue','cline','roo'
)
function Test-Interesting([string]$name) {
  foreach ($k in $keywords) { if ($name -match [regex]::Escape($k)) { return $true } }
  return $false
}

# Print the schema of a JSONL file: union of top-level keys + sample "type"/"role".
function Show-JsonlSchema([string]$path, [int]$maxLines = 8) {
  Out-Line "      sample schema of: $([System.IO.Path]::GetFileName($path))"
  $keys = [System.Collections.Generic.HashSet[string]]::new()
  $types = [System.Collections.Generic.HashSet[string]]::new()
  $i = 0
  foreach ($line in [System.IO.File]::ReadLines($path)) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    if ($i -ge $maxLines) { break }
    $i++
    try {
      $obj = $line | ConvertFrom-Json
      foreach ($p in $obj.PSObject.Properties.Name) { [void]$keys.Add($p) }
      foreach ($f in @('type','role','kind','event','name')) {
        if ($obj.PSObject.Properties.Name -contains $f -and $obj.$f) {
          [void]$types.Add("$f=$($obj.$f)")
        }
      }
    } catch { }
  }
  Out-Line "        top-level keys: $((($keys) | Sort-Object) -join ', ')"
  if ($types.Count) { Out-Line "        record markers: $((($types) | Sort-Object) -join ' | ')" }
}

# Print the top-level keys of a single JSON file.
function Show-JsonKeys([string]$path) {
  try {
    $obj = Get-Content -Raw -LiteralPath $path | ConvertFrom-Json
    $names = $obj.PSObject.Properties.Name | Sort-Object
    Out-Line "      $([System.IO.Path]::GetFileName($path)) keys: $($names -join ', ')"
  } catch { }
}

# Summarize a directory: counts of .jsonl/.json, presence of SQLite state.vscdb,
# and a schema sample from the newest .jsonl.
function Show-DirSample([string]$dir, [int]$depth = 4) {
  $jsonl = Get-ChildItem -LiteralPath $dir -Recurse -Depth $depth -Filter *.jsonl -File 2>$null
  $json  = Get-ChildItem -LiteralPath $dir -Recurse -Depth $depth -Filter *.json  -File 2>$null
  $vscdb = Get-ChildItem -LiteralPath $dir -Recurse -Depth $depth -Filter *.vscdb -File 2>$null
  $sqlite = Get-ChildItem -LiteralPath $dir -Recurse -Depth $depth -Include *.db,*.sqlite,*.sqlite3 -File 2>$null
  Out-Line "      .jsonl files: $($jsonl.Count)   .json files: $($json.Count)   state.vscdb/SQLite: $(@($vscdb).Count + @($sqlite).Count)"
  if ($vscdb -or $sqlite) {
    Out-Line "      NOTE: SQLite store present (Cursor-style) - chat is inside a DB, not plain files."
  }
  $newest = $jsonl | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($newest) { Show-JsonlSchema $newest.FullName }
  elseif ($json) {
    $nj = $json | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    Show-JsonKeys $nj.FullName
  }
}

Out-Line "================================================================"
Out-Line " AI chat / session storage scan  ($(Get-Date -Format s))"
Out-Line " machine: $env:COMPUTERNAME   user: $env:USERNAME"
Out-Line "================================================================"

# ---------------------------------------------------------------------------
# 1) VS Code-family editors under %APPDATA% and %LOCALAPPDATA%
# ---------------------------------------------------------------------------
$bases = @($env:APPDATA, $env:LOCALAPPDATA) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique

Out-Line ''
Out-Line '### VS Code-family editors (workspaceStorage / globalStorage) ###'
foreach ($base in $bases) {
  $products = Get-ChildItem -LiteralPath $base -Directory 2>$null |
    Where-Object { Test-Path (Join-Path $_.FullName 'User\workspaceStorage') }
  foreach ($prod in $products) {
    Out-Line ''
    Out-Line "PRODUCT: $($prod.Name)"
    Out-Line "  path: $($prod.FullName)"

    $ws = Join-Path $prod.FullName 'User\workspaceStorage'
    $wsDirs = Get-ChildItem -LiteralPath $ws -Directory 2>$null
    Out-Line "  workspaceStorage: $($wsDirs.Count) workspace(s)"

    # Aggregate per-workspace extension folders (these reveal which extension wrote data).
    $extCounts = @{}
    foreach ($w in $wsDirs) {
      foreach ($sub in (Get-ChildItem -LiteralPath $w.FullName -Directory 2>$null)) {
        if (-not $extCounts.ContainsKey($sub.Name)) { $extCounts[$sub.Name] = 0 }
        $extCounts[$sub.Name]++
      }
    }
    $hits = $extCounts.Keys | Where-Object { Test-Interesting $_ } | Sort-Object
    if ($hits) {
      Out-Line "  chat-related extension data in workspaceStorage:"
      foreach ($h in $hits) {
        Out-Line "    - $h  (in $($extCounts[$h]) workspace(s))"
        $example = $wsDirs | Where-Object { Test-Path (Join-Path $_.FullName $h) } | Select-Object -First 1
        if ($example) { Show-DirSample (Join-Path $example.FullName $h) }
      }
    } else {
      Out-Line "  (no obviously chat-related extension folders in workspaceStorage)"
    }

    # globalStorage often holds account-wide chat history.
    $gs = Join-Path $prod.FullName 'User\globalStorage'
    if (Test-Path $gs) {
      $gHits = Get-ChildItem -LiteralPath $gs -Directory 2>$null | Where-Object { Test-Interesting $_.Name }
      foreach ($g in $gHits) {
        Out-Line "  globalStorage hit: $($g.Name)"
        Show-DirSample $g.FullName
      }
    }
  }
}

# ---------------------------------------------------------------------------
# 2) Home-directory stores (Claude Code, Codeium, Windsurf, Devin, ...)
# ---------------------------------------------------------------------------
Out-Line ''
Out-Line '### Home-directory / CLI stores ###'
$homeCandidates = @(
  @{ Name = 'Claude Code';      Path = (Join-Path $env:USERPROFILE '.claude') },
  @{ Name = 'Claude Code(proj)';Path = (Join-Path $env:USERPROFILE '.claude\projects') },
  @{ Name = 'Codeium';          Path = (Join-Path $env:USERPROFILE '.codeium') },
  @{ Name = 'Windsurf(home)';   Path = (Join-Path $env:USERPROFILE '.windsurf') },
  @{ Name = 'Antigravity(home)';Path = (Join-Path $env:USERPROFILE '.antigravity') },
  @{ Name = 'Devin(home)';      Path = (Join-Path $env:USERPROFILE '.devin') },
  @{ Name = 'Cognition(home)';  Path = (Join-Path $env:USERPROFILE '.cognition') },
  @{ Name = 'Continue';         Path = (Join-Path $env:USERPROFILE '.continue') },
  @{ Name = 'Cline';            Path = (Join-Path $env:USERPROFILE '.cline') },
  @{ Name = 'Claude Desktop';   Path = (Join-Path $env:APPDATA 'Claude') },
  @{ Name = 'Antigravity(app)'; Path = (Join-Path $env:APPDATA 'Antigravity') },
  @{ Name = 'Devin(app)';       Path = (Join-Path $env:APPDATA 'Devin') }
)
foreach ($c in $homeCandidates) {
  if (Test-Path $c.Path) {
    Out-Line ''
    Out-Line "FOUND: $($c.Name)"
    Out-Line "  path: $($c.Path)"
    Show-DirSample $c.Path
  }
}

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
$out = Join-Path ([Environment]::GetFolderPath('Desktop')) 'ai-chat-storage-scan.txt'
try {
  $report | Set-Content -LiteralPath $out -Encoding UTF8
  Out-Line ''
  Out-Line "================================================================"
  Out-Line "Report saved to: $out"
  Out-Line "Review it, then paste its contents back."
  Out-Line "================================================================"
} catch {
  Write-Host "Could not write report file: $_"
}
