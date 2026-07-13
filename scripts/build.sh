#!/usr/bin/env bash
# =============================================================================
# build.sh — Full monorepo build script
#
# Build order:
#   1. Rust Soroban contracts  → target/wasm32-unknown-unknown/release/*.wasm
#   2. SDK (TypeScript)        → sdk/dist/
#   3. CLI (TypeScript)        → cli/dist/
#   4. UI  (Next.js)           → ui/.next/
#
# The SDK must be compiled before the CLI because the CLI's node_modules may
# symlink to the SDK workspace package — the CLI's build therefore requires
# sdk/dist to exist first.
#
# Usage:
#   ./scripts/build.sh                 # full build (contracts + all TS)
#   ./scripts/build.sh --ts-only       # skip Rust, build TS packages only
#   ./scripts/build.sh --contracts-only # compile Rust contracts only
#   ./scripts/build.sh --type-check    # type-check all TS packages, no emit
# =============================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# ── Colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RESET='\033[0m'

step()  { echo -e "\n${CYAN}▶ $*${RESET}"; }
ok()    { echo -e "${GREEN}✔ $*${RESET}"; }
warn()  { echo -e "${YELLOW}⚠ $*${RESET}"; }
die()   { echo -e "${RED}✘ $*${RESET}" >&2; exit 1; }

# ── Argument parsing ─────────────────────────────────────────────────────────
TS_ONLY=false
CONTRACTS_ONLY=false
TYPE_CHECK=false

for arg in "$@"; do
  case "$arg" in
    --ts-only)         TS_ONLY=true ;;
    --contracts-only)  CONTRACTS_ONLY=true ;;
    --type-check)      TYPE_CHECK=true ;;
    *) die "Unknown argument: $arg" ;;
  esac
done

# ── Tool checks ───────────────────────────────────────────────────────────────
if ! $TS_ONLY; then
  command -v cargo >/dev/null 2>&1 || die "cargo not found. Install Rust: https://rustup.rs"
  command -v rustup >/dev/null 2>&1 || die "rustup not found."
fi

if ! $CONTRACTS_ONLY; then
  command -v node >/dev/null 2>&1 || die "node not found. Install Node.js >=18: https://nodejs.org"
  command -v npm  >/dev/null 2>&1 || die "npm not found."

  NODE_MAJOR=$(node -e "process.stdout.write(String(process.versions.node.split('.')[0]))")
  (( NODE_MAJOR >= 18 )) || die "Node.js >=18 required (found $NODE_MAJOR)"
fi

# ── 1. Rust Soroban contracts ─────────────────────────────────────────────────
if ! $TS_ONLY && ! $TYPE_CHECK; then
  step "Building Soroban contracts (wasm32-unknown-unknown)"

  # Ensure the wasm target is installed
  if ! rustup target list --installed | grep -q "wasm32-unknown-unknown"; then
    step "Adding wasm32-unknown-unknown target"
    rustup target add wasm32-unknown-unknown
  fi

  cargo build --release --target wasm32-unknown-unknown
  ok "Contracts built → target/wasm32-unknown-unknown/release/*.wasm"

  # Print wasm sizes for quick sanity check
  for wasm in target/wasm32-unknown-unknown/release/*.wasm; do
    [[ -f "$wasm" ]] && echo "  $(du -sh "$wasm" | cut -f1)  $wasm"
  done
fi

$CONTRACTS_ONLY && { ok "Contract-only build complete."; exit 0; }

# ── 2. Install npm workspaces ─────────────────────────────────────────────────
if ! $TYPE_CHECK; then
  step "Installing npm workspace dependencies"
  npm install --workspaces --include-workspace-root
  ok "Dependencies installed"
fi

# ── 3. SDK ────────────────────────────────────────────────────────────────────
step "Building SDK (sdk/)"
if $TYPE_CHECK; then
  npx tsc --noEmit --project sdk/tsconfig.json
  ok "SDK type-check passed"
else
  npm run build --workspace=sdk
  ok "SDK built → sdk/dist/"
fi

# ── 4. CLI ────────────────────────────────────────────────────────────────────
step "Building CLI (cli/)"
if $TYPE_CHECK; then
  npx tsc --noEmit --project cli/tsconfig.json
  ok "CLI type-check passed"
else
  npm run build --workspace=cli
  ok "CLI built → cli/dist/"
fi

# ── 5. UI ─────────────────────────────────────────────────────────────────────
step "Building UI (ui/)"
if $TYPE_CHECK; then
  npm run type-check --workspace=ui
  ok "UI type-check passed"
else
  npm run build --workspace=ui
  ok "UI built → ui/.next/"
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
if $TYPE_CHECK; then
  ok "All type-checks passed."
else
  ok "Full build complete."
  echo ""
  echo "  Artifacts:"
  echo "    Contracts  →  target/wasm32-unknown-unknown/release/"
  echo "    SDK        →  sdk/dist/"
  echo "    CLI        →  cli/dist/   (binary: cli/dist/index.js)"
  echo "    UI         →  ui/.next/"
  echo ""
  echo "  Run the CLI:"
  echo "    node cli/dist/index.js --help"
  echo ""
  echo "  Deploy contracts:"
  echo "    See docs/deployment.md"
fi
