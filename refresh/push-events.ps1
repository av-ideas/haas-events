# Pushes refresh/events.json to Supabase and prunes old events.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File refresh\push-events.ps1
# Reads SUPABASE_URL and SUPABASE_SECRET_KEY from refresh\.env (never committed).
param(
  [string]$File = (Join-Path $PSScriptRoot 'events.json'),
  [int]$PruneDays = 45,
  [switch]$AllowMassDelete   # skip the safety check below after confirming the removals are intended
)
$ErrorActionPreference = 'Stop'

$envFile = Join-Path $PSScriptRoot '.env'
if (-not (Test-Path $envFile)) { throw "Missing $envFile. Copy .env.example to .env and fill it in." }
foreach ($line in Get-Content $envFile) {
  if ($line -match '^\s*([A-Z_]+)\s*=\s*(.*?)\s*$') { Set-Item "env:$($Matches[1])" ($Matches[2].Trim('"', "'")) }
}
$url = $env:SUPABASE_URL.TrimEnd('/')
$key = $env:SUPABASE_SECRET_KEY
if (-not $url -or -not $key) { throw 'SUPABASE_URL and SUPABASE_SECRET_KEY must be set in refresh\.env' }

$headers = @{ apikey = $key }
# Legacy service_role keys are JWTs and also go in Authorization; new sb_secret_ keys go in apikey only.
if ($key.StartsWith('eyJ')) { $headers.Authorization = "Bearer $key" }

function Invoke-Supabase([string]$Method, [string]$Path, $Body, [string]$Prefer) {
  $h = $headers.Clone()
  if ($Prefer) { $h.Prefer = $Prefer }
  # PowerShell 5.1 sends a "Mozilla/5.0 ..." User-Agent, which Supabase treats as a browser and refuses for secret keys.
  $params = @{ Method = $Method; Uri = "$url/rest/v1/$Path"; Headers = $h; UserAgent = 'professional-events-tracker-refresh/1.0'; UseBasicParsing = $true }
  if ($null -ne $Body) {
    $params.ContentType = 'application/json; charset=utf-8'
    $params.Body = [Text.Encoding]::UTF8.GetBytes($Body)
  }
  Invoke-RestMethod @params
}

$doc = Get-Content $File -Raw -Encoding UTF8 | ConvertFrom-Json
$columns = 'id','title','starts_at','ends_at','all_day','location','region','format','description','url',
           'source','source_detail','category','audience','cost','rsvp_required','rsvp_deadline','tags'
$now = (Get-Date).ToUniversalTime().ToString('o')

# PostgREST bulk upserts need every row to have the same keys, so normalize.
$rows = foreach ($e in @($doc.events)) {
  if (-not $e.id -or -not $e.title -or -not $e.starts_at -or -not $e.source) {
    Write-Warning "Skipping event missing id/title/starts_at/source: $($e.title)"; continue
  }
  $r = [ordered]@{}
  foreach ($c in $columns) { $r[$c] = $e.$c }
  $r.all_day = [bool]$e.all_day
  $r.rsvp_required = [bool]$e.rsvp_required
  $r.tags = @(if ($e.tags) { $e.tags } else { @() })
  $r.updated_at = $now
  [pscustomobject]$r
}
$rows = @($rows)

if ($rows.Count -gt 0) {
  $json = $rows | ConvertTo-Json -Depth 6 -Compress
  if ($rows.Count -eq 1) { $json = "[$json]" }   # PowerShell 5.1 unwraps single-item arrays
  Invoke-Supabase POST 'events?on_conflict=id' $json 'resolution=merge-duplicates,return=minimal' | Out-Null
}

# The file is the source of truth for upcoming events: delete any in the database that the refresh dropped.
# Events that already ended stay (the site's "Past" view) until the prune below.
$since = (Get-Date).ToUniversalTime().AddDays(-1).ToString('yyyy-MM-ddTHH:mm:ssZ')
$keep = @{}; foreach ($r in $rows) { $keep[$r.id] = $true }
# Windows PowerShell returns a JSON array as one pipeline object; ForEach-Object unrolls it.
$live = Invoke-Supabase GET "events?select=id&starts_at=gte.$since" $null $null | ForEach-Object { $_ }
$dropped = @($live | Where-Object { $_.id -and -not $keep.ContainsKey($_.id) })
if ($dropped.Count -gt 0 -and $rows.Count -eq 0) {
  throw 'Refusing to delete every upcoming event: events.json has no events. Check the refresh output.'
}
$liveCount = @($live).Count
if (-not $AllowMassDelete -and $dropped.Count -gt 5 -and $dropped.Count -gt [math]::Floor($liveCount / 3)) {
  throw ("Refusing to remove $($dropped.Count) of $liveCount upcoming events in one push. That usually means the refresh " +
         "lost the existing feed. Check events.json; if the removals are intended, rerun with -AllowMassDelete.")
}
foreach ($r in $dropped) {
  Invoke-Supabase DELETE ("events?id=eq." + [Uri]::EscapeDataString($r.id)) $null 'return=minimal' | Out-Null
  Write-Host "Removed from database (no longer in events.json): $($r.id)"
}
# Prune events that started long ago (their RSVPs go with them).
$cutoff = (Get-Date).ToUniversalTime().AddDays(-$PruneDays).ToString('yyyy-MM-ddTHH:mm:ssZ')
Invoke-Supabase DELETE "events?starts_at=lt.$cutoff" $null 'return=minimal' | Out-Null

# Remove events the refresh explicitly marked as cancelled.
foreach ($id in @($doc.removed_ids)) {
  if ($id) { Invoke-Supabase DELETE ("events?id=eq." + [Uri]::EscapeDataString($id)) $null 'return=minimal' | Out-Null }
}

$counts = @{}
foreach ($r in $rows) { $counts[$r.source] = 1 + [int]$counts[$r.source] }
$meta = [ordered]@{
  id = 1
  refreshed_at = $now
  summary = if ($doc.summary) { [string]$doc.summary } else { "$($rows.Count) events" }
  counts = $counts
} | ConvertTo-Json -Depth 4 -Compress
Invoke-Supabase POST 'feed_meta?on_conflict=id' $meta 'resolution=merge-duplicates,return=minimal' | Out-Null

Write-Host "Pushed $($rows.Count) events; pruned events before $cutoff."
