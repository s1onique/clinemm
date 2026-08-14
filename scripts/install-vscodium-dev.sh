#!/usr/bin/env bash
# install-vscodium-dev.sh
# --------------------------------------------------------------------------------------
# ACT-CLINEMM-VSCODIUM-DOGFOOD-PACKAGE01 — local ClineMM packaging + VSCodium install helper.
#
# Builds the current ClineMM tree (SDK + VSCode bundle), packages a distinct VSIX, and
# installs it into the user's primary VSCodium instance for daily dogfood. Side-by-side
# with the upstream saoudrizwan.claude-dev is preserved (rollback) — this script does NOT
# uninstall stock Cline automatically.
#
# NO publication. NO marketplace/Open VSX upload. NO credentials. NO Leamas invocation.
#
# Usage:
#   scripts/install-vscodium-dev.sh                 # full build + install
#   scripts/install-vscodium-dev.sh --skip-build    # install existing VSIX
#   scripts/install-vscodium-dev.sh --no-install    # build only, no codium install
#   scripts/install-vscodium-dev.sh --codium /path/to/codium  # override codium binary
# --------------------------------------------------------------------------------------
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VSCODE_DIR="$REPO_ROOT/apps/vscode"
DIST_DIR="$VSCODE_DIR/dist"

VSIX_NAME_DEFAULT="clinemm-$(jq -r '.version' "$VSCODE_DIR/package.json").vsix"
VSIX_PATH="$DIST_DIR/$VSIX_NAME_DEFAULT"

SKIP_BUILD=0
NO_INSTALL=0
CODIUM_BIN="codium"

usage() {
  cat <<USAGE
Usage: $0 [--skip-build] [--no-install] [--codium PATH] [--vsix-name NAME]

Options:
  --skip-build       Install the existing VSIX without rebuilding.
  --no-install       Build only; do not install into VSCodium.
  --codium PATH      Path to the codium (or code) binary (default: "codium").
  --vsix-name NAME   Override the produced VSIX filename (default: $VSIX_NAME_DEFAULT).
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-build) SKIP_BUILD=1; shift ;;
    --no-install) NO_INSTALL=1; shift ;;
    --codium) CODIUM_BIN="$2"; shift 2 ;;
    --vsix-name) VSIX_PATH="$DIST_DIR/$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 2 ;;
  esac
done

say()  { printf '\033[1;34m[install-vscodium-dev]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[install-vscodium-dev]\033[0m %s\n' "$*" >&2; }
fail() { printf '\033[1;31m[install-vscodium-dev]\033[0m %s\n' "$*" >&2; exit 1; }

cd "$REPO_ROOT"

# --- preflight: clean worktree -----------------------------------------------------
say "preflight: checking worktree state"
if ! git status --porcelain | grep -q .; then
  say "worktree clean ✓"
else
  fail "worktree has local changes — commit/stash before packaging"
fi

HEAD="$(git rev-parse HEAD)"
TREE="$(git rev-parse HEAD^{tree})"
say "HEAD=$HEAD"
say "TREE=$TREE"

# --- SDK build (idempotent) -------------------------------------------------------
if [[ $SKIP_BUILD -eq 0 ]]; then
  say "build:sdk — ensuring @cline/{shared,llms,agents,core,sdk,ui} dist/ is current"
  bun run build:sdk

  say "build:package — protos + check-types + webview build + lint + esbuild --production"
  ( cd "$VSCODE_DIR" && bun run package )

  say "package:vsix — bundling $VSIX_PATH"
  rm -f "$VSIX_PATH"
  ( cd "$VSCODE_DIR" \
    && bunx vsce package --no-dependencies --allow-package-secrets sendgrid --out "$VSIX_PATH" )
else
  if [[ ! -f "$VSIX_PATH" ]]; then
    fail "--skip-build requested but $VSIX_PATH does not exist; run without --skip-build first"
  fi
  say "skip-build: reusing existing $VSIX_PATH"
fi

# --- verify VSIX metadata ---------------------------------------------------------
say "verify: VSIX metadata"
EXPECTED_DISPLAY_NAME="$(jq -r '.displayName' "$VSCODE_DIR/package.json")"
EXPECTED_PUBLISHER="$(jq -r '.publisher' "$VSCODE_DIR/package.json")"
EXPECTED_NAME="$(jq -r '.name' "$VSCODE_DIR/package.json")"
EXPECTED_VERSION="$(jq -r '.version' "$VSCODE_DIR/package.json")"

MANIFEST_DISPLAY_NAME="$(unzip -p "$VSIX_PATH" extension.vsixmanifest \
  | sed -n 's:.*<DisplayName>\(.*\)</DisplayName>.*:\1:p')"
MANIFEST_IDENTITY="$(unzip -p "$VSIX_PATH" extension.vsixmanifest \
  | sed -n 's:.*<Identity[^>]*Id="\([^"]*\)"[^>]*Version="\([^"]*\)"[^>]*Publisher="\([^"]*\)".*:\1@\2 by \3:p')"

say "expected: displayName='$EXPECTED_DISPLAY_NAME' id=$EXPECTED_PUBLISHER.$EXPECTED_NAME@$EXPECTED_VERSION"
say "manifest: displayName='$MANIFEST_DISPLAY_NAME' $MANIFEST_IDENTITY"

if [[ "$MANIFEST_DISPLAY_NAME" != "$EXPECTED_DISPLAY_NAME" ]]; then
  fail "VSIX displayName '$MANIFEST_DISPLAY_NAME' does not match manifest '$EXPECTED_DISPLAY_NAME'"
fi
if [[ "$EXPECTED_PUBLISHER" == "saoudrizwan" || "$EXPECTED_NAME" == "claude-dev" ]]; then
  fail "VSIX identity still matches upstream stock Cline — refusing to install (publisher=$EXPECTED_PUBLISHER name=$EXPECTED_NAME)"
fi

VSIX_BYTES="$(wc -c < "$VSIX_PATH" | tr -d ' ')"
VSIX_SHA256="$(shasum -a 256 "$VSIX_PATH" | awk '{print $1}')"
say "VSIX: $VSIX_PATH"
say "VSIX_BYTES=$VSIX_BYTES"
say "VSIX_SHA256=$VSIX_SHA256"

# --- install into VSCodium --------------------------------------------------------
if [[ $NO_INSTALL -eq 1 ]]; then
  say "--no-install: skipping VSCodium install (VSIX is at $VSIX_PATH)"
  exit 0
fi

if ! command -v "$CODIUM_BIN" >/dev/null 2>&1; then
  fail "codium binary '$CODIUM_BIN' not found in PATH (override with --codium /full/path)"
fi

say "install: $CODIUM_BIN --install-extension $VSIX_PATH --force"
"$CODIUM_BIN" --install-extension "$VSIX_PATH" --force

say "verify: installed extensions"
INSTALLED="$("$CODIUM_BIN" --list-extensions --show-versions 2>/dev/null || true)"
if echo "$INSTALLED" | grep -q "$EXPECTED_PUBLISHER.$EXPECTED_NAME@$EXPECTED_VERSION"; then
  say "installed ✓: $EXPECTED_PUBLISHER.$EXPECTED_NAME@$EXPECTED_VERSION"
else
  fail "install verification failed — '$CODIUM_BIN --list-extensions --show-versions' does not include $EXPECTED_PUBLISHER.$EXPECTED_NAME@$EXPECTED_VERSION"
fi

if echo "$INSTALLED" | grep -q "saoudrizwan.claude-dev"; then
  say "stock Cline still installed (rollback): $(echo "$INSTALLED" | grep saoudrizwan.claude-dev | head -1)"
fi

cat <<DONE

──────────────────────────────────────────────────────────────────────
ClineMM dogfood VSIX ready.

  Path:    $VSIX_PATH
  Bytes:   $VSIX_BYTES
  SHA256:  $VSIX_SHA256
  Id:      $EXPECTED_PUBLISHER.$EXPECTED_NAME@$EXPECTED_VERSION
  Display: $EXPECTED_DISPLAY_NAME

Next steps (manual):
  1. Open/reload VSCodium.
  2. Confirm the ClineMM activity-bar icon appears (not stock Cline).
  3. Sign in to your LLM provider.
  4. Run a bounded canary task:
     "Inspect this repository and report the current branch, HEAD commit,
      and whether the working tree is clean. Do not modify files."
  5. Run one small write task on a disposable scratch file to verify edits,
     diffs, and checkpoints.

Do NOT uninstall saoudrizwan.claude-dev until the canary passes — it stays
available as an immediate rollback.
──────────────────────────────────────────────────────────────────────
DONE
