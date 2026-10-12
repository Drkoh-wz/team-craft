<#
.SYNOPSIS
  Install (or remove) team-flowise in DSH Desktop, without knowing anything about
  app.asar.

.DESCRIPTION
  DSH Desktop has no `dsh` command on PATH: it carries the harness inside its own
  bundle and owns the profile, so the official route is its plugin panel. This
  script drives that same bundled harness directly, from outside the app, for the
  case where the plugin is not listed yet.

  Two things it exists to get right, because both are easy to get wrong by hand:

    * `lib/bin.js` lives INSIDE `app.asar`. Plain `node` cannot load it -- the
      command has to go through the app's own binary in Node mode. A hand-written
      command that calls `node` fails with MODULE_NOT_FOUND, and it looks like the
      plugin's fault.
    * Desktop owns the profile while it is running. Installing underneath a live
      app invites its own maintenance to reconcile the change away, so this stops
      and tells you to quit it first.

.PARAMETER Action
  install (default), uninstall, or check.

.PARAMETER Spec
  What to install. Defaults to this project's prebuilt release package, which the
  script DOWNLOADS and then installs from the local file: an https tarball-URL
  dependency fails on pnpm 10 once its store holds that URL, and a git spec needs
  git-over-https to github.com, which not every network has. A local .tgz path,
  `name@version` or any other spec pnpm accepts is passed through untouched.

.PARAMETER Profile
  The dsh profile to install into. Default: web.

.PARAMETER DshHome
  The Harness home Desktop uses. Default: %APPDATA%\dsh-desktop\harness

.PARAMETER DesktopRoot
  The DSH Desktop install directory. Detected from the running app or the usual
  locations when omitted.

.PARAMETER Force
  Proceed even though DSH Desktop is running.

.PARAMETER DryRun
  Print exactly what would run, touch nothing.

.EXAMPLE
  .\scripts\install-desktop.ps1
.EXAMPLE
  .\scripts\install-desktop.ps1 -Action uninstall
.EXAMPLE
  .\scripts\install-desktop.ps1 -DesktopRoot "<your DSH Desktop folder>"
.EXAMPLE
  .\scripts\install-desktop.ps1 -Spec "https://example.com/plugin.tgz" -DryRun
#>
[CmdletBinding()]
param(
  [ValidateSet('install', 'uninstall', 'check')]
  [string] $Action = 'install',

  [string] $Spec,

  [string] $Profile = 'web',

  [string] $DshHome = (Join-Path $env:APPDATA 'dsh-desktop\harness'),

  [string] $DesktopRoot,

  [switch] $Force,
  [switch] $DryRun
)

$ErrorActionPreference = 'Stop'

if ($env:OS -ne 'Windows_NT') {
  throw 'This script is for the Windows build of DSH Desktop. On macOS or Linux, use the same three-file command shape from the README with your install directory.'
}

$DEFAULT_SPEC = 'https://github.com/Drkoh-wz/team-craft/releases/latest/download/team-flowise.tgz'
$PACKAGE_ID = '@local/team-flowise'
if (-not $Spec) { $Spec = $DEFAULT_SPEC }

function Write-Step($text) { Write-Host "  $text" }
function Write-Fail($text) { Write-Host "  $text" -ForegroundColor Red }

# ---------------------------------------------------------------- find the app
function Resolve-DesktopRoot {
  param([string] $Given)

  $candidates = New-Object System.Collections.Generic.List[string]
  if ($Given) { $candidates.Add($Given) }

  # The running app knows where it lives; that beats guessing.
  $proc = Get-Process -Name 'DSH Desktop' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($proc -and $proc.Path) { $candidates.Add((Split-Path -Parent $proc.Path)) }

  foreach ($base in @($env:LOCALAPPDATA, $env:ProgramFiles, ${env:ProgramFiles(x86)})) {
    if ($base) { $candidates.Add((Join-Path $base 'Programs\DSH Desktop')); $candidates.Add((Join-Path $base 'DSH Desktop')) }
  }

  foreach ($dir in $candidates) {
    if (-not $dir) { continue }
    if (Test-Path (Join-Path $dir 'DSH Desktop.exe')) { return (Resolve-Path $dir).Path }
  }
  return $null
}

Write-Host ''
Write-Host "team-flowise -> DSH Desktop ($Action)" -ForegroundColor Cyan

$root = Resolve-DesktopRoot -Given $DesktopRoot
if (-not $root) {
  Write-Fail 'Could not find the DSH Desktop install directory.'
  Write-Step 'Pass it explicitly, for example:'
  Write-Step '  .\scripts\install-desktop.ps1 -DesktopRoot "<your DSH Desktop folder>"'
  exit 2
}

$exe = Join-Path $root 'DSH Desktop.exe'
$entry = Join-Path $root 'resources\harness-node-entry.mjs'
$asarBin = Join-Path $root 'resources\app.asar\node_modules\@deepseek-ai\dsh\lib\bin.js'

Write-Step "app          : $root"
foreach ($pair in @(@('launcher', $exe), @('harness entry', $entry))) {
  if (-not (Test-Path $pair[1])) {
    Write-Fail "$($pair[0]) is missing: $($pair[1])"
    Write-Step 'This does not look like a DSH Desktop install; pass -DesktopRoot.'
    exit 2
  }
}
# Test-Path cannot see inside app.asar, so this one is deliberately not checked
# for existence -- reaching it at run time is the check, and the app is what can
# reach it.
Write-Step "harness bin  : resources\app.asar\...\dsh\lib\bin.js (inside the archive)"

# ------------------------------------------------------- refuse to race the app
$running = @(Get-Process -Name 'DSH Desktop' -ErrorAction SilentlyContinue)
if ($running.Count -gt 0 -and -not $Force) {
  Write-Fail "DSH Desktop is running (pid $($running[0].Id))."
  Write-Step 'Quit it completely first: it owns the profile, and its own profile'
  Write-Step 'maintenance can reconcile this change away while it is up.'
  Write-Step 'Re-run with -Force if you know what you are doing.'
  exit 3
}

$harnessHome = if (Test-Path $DshHome) { (Resolve-Path $DshHome).Path } else { $DshHome }
if (-not (Test-Path $harnessHome)) {
  Write-Fail "Harness home does not exist: $harnessHome"
  Write-Step 'DSH Desktop creates it on first launch. Launch the app once, quit it, retry.'
  exit 2
}
$profileDir = Join-Path $harnessHome "profiles\$Profile"
if (-not (Test-Path $profileDir)) {
  Write-Fail "Profile '$Profile' does not exist under that home: $profileDir"
  Write-Step "Available: " + ((Get-ChildItem (Join-Path $harnessHome 'profiles') -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -notlike '.*' } | Select-Object -ExpandProperty Name) -join ', ')
  exit 2
}
Write-Step "harness home : $harnessHome"
Write-Step "profile      : $Profile"

# ------------------------------------------------------------------ build argv
# An https .tgz spec is DOWNLOADED first and installed from the local path. Two
# measured reasons, both of which bit this project:
#   * pnpm fails permanently on a tarball-URL dependency once its store holds that
#     URL (ERR_PNPM_MISSING_TARBALL_INTEGRITY, no recovery by deleting the lockfile);
#   * a git spec needs git over https to github.com, which is not always reachable
#     from every network -- it falls back to ssh and dies on host key verification.
# A plain HTTPS download is the step that kept working in both cases.
$downloaded = $null
if (-not $DryRun -and $Action -eq 'install' -and $Spec -match '^https?://') {
  $downloaded = Join-Path ([IO.Path]::GetTempPath()) ("team-flowise-" + [Guid]::NewGuid().ToString('N').Substring(0, 8) + ".tgz")
  Write-Step "downloading  : $Spec"
  try {
    $prevProgress = $ProgressPreference
    $ProgressPreference = 'SilentlyContinue'
    Invoke-WebRequest -Uri $Spec -OutFile $downloaded -UseBasicParsing
    $ProgressPreference = $prevProgress
  } catch {
    Write-Fail "download failed: $($_.Exception.Message)"
    Write-Step 'A plain HTTPS fetch of the release asset is the step this script'
    Write-Step 'relies on; if it cannot reach GitHub, download the file by hand and'
    Write-Step 'pass its path: -Spec "<path to team-flowise.tgz>"'
    exit 4
  }
  $size = (Get-Item $downloaded).Length
  Write-Step "downloaded   : $size bytes -> $downloaded"
  Write-Step 'installing from the local path, so pnpm never resolves a URL'
  $Spec = $downloaded
}

$pluginArgs = switch ($Action) {
  'install' { @('plugin', '--profile', $Profile, 'add', $Spec) }
  'uninstall' { @('plugin', '--profile', $Profile, 'remove', $PACKAGE_ID) }
  'check' { @('--profile', $Profile, '--dump-config') }
}
$full = @($entry, $asarBin) + $pluginArgs

if ($Action -ne 'check') { Write-Step "spec         : $Spec" }

# `dsh plugin` forwards to pnpm, which has to be on PATH for the child. Desktop
# ships one; use it when the shell cannot find another.
$pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
if (-not $pnpm) {
  $shipped = Join-Path $harnessHome '.desktop-bin\pnpm.cmd'
  if (Test-Path $shipped) {
    $env:PATH = (Split-Path -Parent $shipped) + ';' + $env:PATH
    Write-Step "pnpm         : $shipped (from the app's own .desktop-bin)"
  } else {
    Write-Step 'pnpm         : not found -- the install will fail; install pnpm or start Desktop once so it provisions its own.'
  }
} else {
  Write-Step "pnpm         : $($pnpm.Source)"
}

$env:DSH_HOME = $harnessHome
$env:ELECTRON_RUN_AS_NODE = '1'

if ($DryRun) {
  Write-Host ''
  Write-Host 'Dry run. This is what would run:' -ForegroundColor Yellow
  if ($Action -eq 'install' -and $Spec -match '^https?://') {
    Write-Host "  (1) download $Spec to a temp file, then (2) install from that path:"
  }
  Write-Host "  `$env:DSH_HOME = '$harnessHome'"
  Write-Host '  $env:ELECTRON_RUN_AS_NODE = 1'
  Write-Host ('  & "{0}" `' -f $exe)
  foreach ($a in $full) { Write-Host ('      "{0}" `' -f $a) }
  exit 0
}

Write-Host ''
Write-Step 'running...'

# The harness writes its whole log to stderr, and under Windows PowerShell 5.1 a
# native command's stderr is an ErrorRecord -- with $ErrorActionPreference='Stop'
# that turns a normal, informative run into a terminating error, loses
# $LASTEXITCODE (so a failure could exit 0) and hides the very output that says why.
# So: run it with the policy relaxed, stream everything to the user, and treat a
# missing exit code as failure rather than success.
$previousPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
  & $exe @full 2>&1 | ForEach-Object { Write-Host "  $_" }
  $code = $LASTEXITCODE
} finally {
  $ErrorActionPreference = $previousPreference
}
if ($null -eq $code) { $code = 1 }
if ($downloaded -ne $null) { Remove-Item $downloaded -Force -ErrorAction SilentlyContinue }

Write-Host ''
if ($code -eq 0) {
  Write-Host "  ok (exit 0)" -ForegroundColor Green
  if ($Action -eq 'install') {
    Write-Step 'Now start DSH Desktop. Verify, in this order:'
    Write-Step '  1. a new session tool list shows the seven team_* tools'
    Write-Step '  2. Settings has a team-flowise section'
    Write-Step '  3. the right sidebar has the progress tab this plugin adds'
    Write-Step ''
    Write-Step 'pnpm prints a block of "missing peer" lines for the @deepseek-ai/*'
    Write-Step 'packages. That is expected, not a failure: the harness supplies those'
    Write-Step 'itself at import time, and the package deliberately vendors none of'
    Write-Step 'them. Nothing is missing from your install.'
    Write-Step 'The port is picked per launch and a tokenless local request is'
    Write-Step 'answered 401, so do not use curl to check on Desktop.'
  } elseif ($Action -eq 'uninstall') {
    Write-Step 'Start DSH Desktop again; the plugin is gone from the composed tree.'
  }
} else {
  Write-Fail "the harness exited $code -- its output above says why."
  Write-Step 'The usual causes: pnpm missing, no network, or a rejected spec.'
  Write-Step "If it mentions a version exemption, the plugin declares @deepseek-ai/dsh-*"
  Write-Step "peers that do not include this harness; the message names the exact"
  Write-Step 'allow-version command that grants one.'
  # Measured on pnpm 10: an https tarball URL dependency fails permanently once the
  # store holds that URL -- "its lockfile entry has no integrity field" -- and
  # deleting the lockfile does not recover it. git specs and local files are
  # unaffected. Worth naming, because the symptom looks like corruption and the
  # obvious remedy does nothing.
  Write-Step ''
  Write-Step 'A spec of the form https://.../something.tgz is a known trap on pnpm 10:'
  Write-Step 'once its store holds that URL the install fails with'
  Write-Step 'ERR_PNPM_MISSING_TARBALL_INTEGRITY and stays failed. Use the git spec'
  Write-Step '(the default) or a local .tgz path instead.'
}
exit $code
