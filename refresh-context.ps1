# refresh-context.ps1  -  centex-crm-book
#
#     cd C:\dev\centex-crm-book
#     .\refresh-context.ps1
#
# Collects the files a fresh chat session needs into one folder, ready to drag
# into Project knowledge. Copies only - it changes nothing in the repo.
#
# ============================================================================
# WHY THIS FILE IS PURE ASCII
# ============================================================================
# The first version used em-dashes and a warning glyph. PowerShell 5.1 reads a
# .ps1 as ANSI unless the file carries a UTF-8 BOM, and a downloaded file has
# none - so every non-ASCII character arrived mangled and the parser gave up at
# line 122. Nothing non-ASCII belongs in a script that will be downloaded.
#
# It also used double backticks for markdown code spans. A backtick is
# PowerShell's escape character, so those were escape sequences rather than
# text. Where the manifest needs one it comes from $bt below.
#
# ============================================================================
# WHY THIS EXISTS AT ALL
# ============================================================================
# Project knowledge is a snapshot from whenever it was last uploaded. The CRM
# Project carried an AuthGate.jsx that predated v3.83 and was missing a working
# function; regenerating that file from the stale copy would have silently
# deleted it from the repo. It was caught by looking, not by anything
# systematic.
#
# So: refresh before a session, not during one. The manifest records WHAT was
# uploaded and at WHICH COMMIT, so the next session can tell whether what it is
# reading is current.

$ErrorActionPreference = "Stop"

# Markdown code-span backtick, built rather than typed, for the reason above.
$bt = [char]0x60

$repo = "C:\dev\centex-crm-book"
$out  = Join-Path $repo "context-upload"

if (-not (Test-Path (Join-Path $repo "package.json"))) {
  Write-Host "That does not look like the book repo - no package.json at $repo" -ForegroundColor Red
  return
}

Set-Location $repo

# Cleared first, so a file deleted from the repo does not linger here and get
# re-uploaded as if it still existed.
if (Test-Path $out) { Remove-Item $out -Recurse -Force }
New-Item -ItemType Directory -Force -Path $out | Out-Null

# ---------------------------------------------------------------------------
# What a session actually needs.
# ---------------------------------------------------------------------------
# PREFIXED "book-" on the way out. If this repo ever shares a Project with the
# CRM, App.jsx and HANDOVER.md collide by name and nothing would say which is
# which - and the two differ in ways that matter (LF vs CRLF, two gates vs
# three, jsdom vs node).
$files = @(
  @{ src = "HANDOVER.md";                    as = "book-HANDOVER.md" },
  @{ src = "src\lib\contract.js";            as = "book-contract.js" },

  @{ src = "src\App.jsx";                    as = "book-App.jsx" },
  @{ src = "src\main.jsx";                   as = "book-main.jsx" },
  @{ src = "src\lib\supabase.js";            as = "book-supabase.js" },
  @{ src = "src\lib\listings.js";            as = "book-listings.js" },
  @{ src = "src\lib\dates.js";               as = "book-dates.js" },
  @{ src = "src\lib\request.js";             as = "book-request.js" },
  @{ src = "src\lib\meta.js";                as = "book-meta.js" },
  @{ src = "src\pages\Listings.jsx";         as = "book-Listings.jsx" },
  @{ src = "src\pages\Camper.jsx";           as = "book-Camper.jsx" },
  @{ src = "src\pages\Requested.jsx";        as = "book-Requested.jsx" },
  @{ src = "src\components\States.jsx";      as = "book-States.jsx" },
  @{ src = "src\components\DatePicker.jsx";  as = "book-DatePicker.jsx" },
  @{ src = "src\components\RequestForm.jsx"; as = "book-RequestForm.jsx" },
  @{ src = "src\theme.css";                  as = "book-theme.css" },

  # The harness. A session that does not know these exist will propose things
  # that fail preship. .mjs is renamed to .txt because some upload paths reject
  # the extension, the same way .ts downloads are blocked.
  @{ src = "scripts\contract.mjs";           as = "book-contract-script.txt" },
  @{ src = "scripts\conformance.mjs";        as = "book-conformance-script.txt" },
  @{ src = "scripts\check-bundle.mjs";       as = "book-check-bundle-script.txt" },
  @{ src = "vite.config.js";                 as = "book-vite.config.js" },
  @{ src = "vitest.config.js";               as = "book-vitest.config.js" },
  @{ src = "eslint.config.js";               as = "book-eslint.config.js" },
  @{ src = "index.html";                     as = "book-index.html" },
  @{ src = "public\_redirects";              as = "book-netlify-redirects.txt" },
  @{ src = "public\robots.txt";              as = "book-robots.txt" }
)

$copied  = @()
$missing = @()

foreach ($f in $files) {
  $src = Join-Path $repo $f.src
  if (Test-Path $src) {
    Copy-Item $src (Join-Path $out $f.as) -Force
    $copied += [PSCustomObject]@{
      Uploaded = $f.as
      RepoPath = $f.src
      Lines    = (Get-Content $src).Count
    }
  } else {
    $missing += $f.src
  }
}

# ---------------------------------------------------------------------------
# The manifest. This is what makes the upload trustworthy.
# ---------------------------------------------------------------------------
$pkg    = Get-Content (Join-Path $repo "package.json") -Raw | ConvertFrom-Json
$commit = (git rev-parse --short HEAD 2>$null)
$branch = (git rev-parse --abbrev-ref HEAD 2>$null)
$dirty  = (git status --porcelain 2>$null)
$testFiles = Get-ChildItem "$repo\src" -Filter "*.test.js*" | ForEach-Object { "src/" + $_.Name }

$supaUrl = "unknown - no .env"
if (Test-Path "$repo\.env") {
  $line = (Get-Content "$repo\.env" | Select-String 'VITE_SUPABASE_URL')
  if ($line) { $supaUrl = ($line.Line -split '=', 2)[1] }
}

$treeState = "clean"
if ($dirty) { $treeState = "**DIRTY** - uncommitted changes, so these files may not match the commit" }

$m = New-Object System.Collections.Generic.List[string]
$m.Add("# centex-crm-book - context manifest")
$m.Add("")
$m.Add("Generated " + (Get-Date -Format 'yyyy-MM-dd HH:mm') + " local by refresh-context.ps1.")
$m.Add("")
$m.Add("**Everything in this upload was current as of the commit below.** If a session")
$m.Add("is reading one of these files and the repo has since moved on, this is how it")
$m.Add("finds out.")
$m.Add("")
$m.Add("| | |")
$m.Add("|---|---|")
$m.Add("| Version | " + $bt + "b" + $pkg.version + $bt + " (package.json - injected into the site header at build) |")
$m.Add("| Branch | " + $bt + $branch + $bt + " |")
$m.Add("| Commit | " + $bt + $commit + $bt + " |")
$m.Add("| Working tree | " + $treeState + " |")
$m.Add("| Repo | " + $bt + "C:\dev\centex-crm-book" + $bt + " |")
$m.Add("| Deployed | https://book.centexrvrentals.com/ (origin decided at build by scripts/site-origin.mjs) |")
$m.Add("| Supabase | " + $bt + $supaUrl + $bt + " |")
$m.Add("")
$m.Add("## Everything is prefixed book-")
$m.Add("")
$m.Add("So it cannot be confused with the CRM repo's files, which have the same names")
$m.Add("and different rules.")
$m.Add("")
$m.Add("**This repo: LF line endings, two gates, jsdom, bN.N versions.**")
$m.Add("**The CRM: CRLF, three gates, node, N.NN versions.**")
$m.Add("")
$m.Add("## Files in this upload")
$m.Add("")
$m.Add("| Uploaded as | Repo path | Lines |")
$m.Add("|---|---|---|")
foreach ($c in $copied) {
  $m.Add("| " + $bt + $c.Uploaded + $bt + " | " + $bt + $c.RepoPath + $bt + " | " + $c.Lines + " |")
}
$m.Add("")
$m.Add("## NOT uploaded - ask for these by name if a release needs one")
$m.Add("")
$m.Add("### Test files (" + $testFiles.Count + ")")
$m.Add("")
foreach ($t in $testFiles) { $m.Add("- " + $bt + $t + $bt) }
$m.Add("")
$m.Add("### Deliberately excluded")
$m.Add("")
$m.Add("- .env - the anon key is public by design, but a credentials file does not belong in a document store")
$m.Add("- node_modules, dist, package-lock.json")
$m.Add("")
$m.Add("## Gates in this repo")
$m.Add("")
$m.Add("    npm run preship      eslint src/ scripts/ && vitest run     (offline, fast)")
$m.Add("    npm run build        sitemap -> vite build -> check-bundle  (verifies its own output)")
$m.Add("    npm run contract     five live views + the Edge Function    (needs network)")
$m.Add("    npm run conformance  this repo's date rules vs the live     (needs network)")
$m.Add("                         request-booking dryRun")
$m.Add("")
$m.Add("contract and conformance are NOT in preship, deliberately: a gate that fails")
$m.Add("when the wifi drops is a gate people learn to ignore. Both are required steps")
$m.Add("in every delivery script.")
$m.Add("")
if ($missing) {
  $m.Add("## EXPECTED BUT NOT FOUND")
  $m.Add("")
  $m.Add("These are in this script's list and not in the repo. Either the script is")
  $m.Add("stale or something has moved - worth resolving before trusting the upload.")
  $m.Add("")
  foreach ($x in $missing) { $m.Add("- " + $bt + $x + $bt) }
  $m.Add("")
}

# UTF8 without BOM, so the markdown uploads cleanly.
[IO.File]::WriteAllLines((Join-Path $out "book-CONTEXT-MANIFEST.md"), $m, (New-Object System.Text.UTF8Encoding($false)))

# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "Collected $($copied.Count) files into:" -ForegroundColor Green
Write-Host "  $out" -ForegroundColor Green
Write-Host ""
if ($missing) {
  Write-Host "MISSING - in this script's list but not in the repo:" -ForegroundColor Yellow
  foreach ($x in $missing) { Write-Host "  $x" -ForegroundColor Yellow }
  Write-Host "  (recorded in the manifest too)" -ForegroundColor Yellow
  Write-Host ""
}
if ($dirty) {
  Write-Host "WORKING TREE IS DIRTY. These files include uncommitted changes, so" -ForegroundColor Yellow
  Write-Host "they do not match commit $commit. Commit first if that matters." -ForegroundColor Yellow
  Write-Host ""
}
Write-Host "Next:" -ForegroundColor Cyan
Write-Host "  1. Open the folder in Explorer:  $out" -ForegroundColor Gray
Write-Host "  2. In the Guest Booking Project, DELETE the existing knowledge files" -ForegroundColor Gray
Write-Host "     FIRST. A stale file left behind is worse than a missing one," -ForegroundColor Gray
Write-Host "     because it reads as current." -ForegroundColor Gray
Write-Host "  3. Drag everything in this folder into Project knowledge." -ForegroundColor Gray
Write-Host ""
Write-Host "Run this again before any session where the repo has moved on." -ForegroundColor Cyan
