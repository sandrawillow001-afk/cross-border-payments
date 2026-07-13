<#
.SYNOPSIS
    Full monorepo build script for Windows PowerShell.

.DESCRIPTION
    Build order:
      1. Rust Soroban contracts  → target\wasm32-unknown-unknown\release\*.wasm
      2. SDK (TypeScript)        → sdk\dist\
      3. CLI (TypeScript)        → cli\dist\
      4. UI  (Next.js)           → ui\.next\

    The SDK must be compiled before the CLI because the CLI workspace may
    resolve the SDK from sdk\dist — the CLI build therefore requires sdk\dist
    to exist first.

.PARAMETER TsOnly
    Skip the Rust contract build; only compile TypeScript packages.

.PARAMETER ContractsOnly
    Compile Rust contracts only; skip all TypeScript builds.

.PARAMETER TypeCheck
    Run tsc --noEmit on all TypeScript packages. Does not emit any files.

.EXAMPLE
    .\scripts\build.ps1
    .\scripts\build.ps1 -TsOnly
    .\scripts\build.ps1 -ContractsOnly
    .\scripts\build.ps1 -TypeCheck
#>

[CmdletBinding()]
param(
    [switch]$TsOnly,
    [switch]$ContractsOnly,
    [switch]$TypeCheck
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

# ── Helpers ───────────────────────────────────────────────────────────────────
function Step  { param($msg) Write-Host "`n▶ $msg" -ForegroundColor Cyan }
function Ok    { param($msg) Write-Host "✔ $msg"  -ForegroundColor Green }
function Warn  { param($msg) Write-Host "⚠ $msg"  -ForegroundColor Yellow }
function Die   { param($msg) Write-Error "✘ $msg"; exit 1 }

function Require {
    param($cmd, $hint)
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        Die "$cmd not found. $hint"
    }
}

# ── Tool checks ───────────────────────────────────────────────────────────────
if (-not $TsOnly) {
    Require 'cargo'  'Install Rust: https://rustup.rs'
    Require 'rustup' 'Install Rust: https://rustup.rs'
}

if (-not $ContractsOnly) {
    Require 'node' 'Install Node.js >=18: https://nodejs.org'
    Require 'npm'  'Install Node.js >=18: https://nodejs.org'

    $nodeMajor = [int](node -e "process.stdout.write(String(process.versions.node.split('.')[0]))")
    if ($nodeMajor -lt 18) { Die "Node.js >=18 required (found $nodeMajor)" }
}

# ── 1. Rust Soroban contracts ─────────────────────────────────────────────────
if (-not $TsOnly -and -not $TypeCheck) {
    Step "Building Soroban contracts (wasm32-unknown-unknown)"

    $installedTargets = rustup target list --installed
    if ($installedTargets -notcontains 'wasm32-unknown-unknown') {
        Step "Adding wasm32-unknown-unknown target"
        rustup target add wasm32-unknown-unknown
    }

    cargo build --release --target wasm32-unknown-unknown
    Ok "Contracts built → target\wasm32-unknown-unknown\release\*.wasm"

    Get-ChildItem "target\wasm32-unknown-unknown\release\*.wasm" -ErrorAction SilentlyContinue |
        ForEach-Object { "  $([math]::Round($_.Length / 1KB, 1)) KB  $($_.FullName)" | Write-Host }
}

if ($ContractsOnly) { Ok "Contract-only build complete."; exit 0 }

# ── 2. Install npm workspaces ─────────────────────────────────────────────────
if (-not $TypeCheck) {
    Step "Installing npm workspace dependencies"
    npm install --workspaces --include-workspace-root
    Ok "Dependencies installed"
}

# ── 3. SDK ────────────────────────────────────────────────────────────────────
Step "Building SDK (sdk/)"
if ($TypeCheck) {
    npx tsc --noEmit --project sdk/tsconfig.json
    Ok "SDK type-check passed"
} else {
    npm run build --workspace=sdk
    Ok "SDK built → sdk\dist\"
}

# ── 4. CLI ────────────────────────────────────────────────────────────────────
Step "Building CLI (cli/)"
if ($TypeCheck) {
    npx tsc --noEmit --project cli/tsconfig.json
    Ok "CLI type-check passed"
} else {
    npm run build --workspace=cli
    Ok "CLI built → cli\dist\"
}

# ── 5. UI ─────────────────────────────────────────────────────────────────────
Step "Building UI (ui/)"
if ($TypeCheck) {
    npm run type-check --workspace=ui
    Ok "UI type-check passed"
} else {
    npm run build --workspace=ui
    Ok "UI built → ui\.next\"
}

# ── Done ──────────────────────────────────────────────────────────────────────
Write-Host ""
if ($TypeCheck) {
    Ok "All type-checks passed."
} else {
    Ok "Full build complete."
    Write-Host ""
    Write-Host "  Artifacts:"
    Write-Host "    Contracts  →  target\wasm32-unknown-unknown\release\"
    Write-Host "    SDK        →  sdk\dist\"
    Write-Host "    CLI        →  cli\dist\   (entry: cli\dist\index.js)"
    Write-Host "    UI         →  ui\.next\"
    Write-Host ""
    Write-Host "  Run the CLI:"
    Write-Host "    node cli\dist\index.js --help"
    Write-Host ""
    Write-Host "  Deploy contracts:"
    Write-Host "    See docs\deployment.md"
}
