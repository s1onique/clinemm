#!/usr/bin/env bash
# build-elm.sh
#
# Compile the completion-authority Elm kernel to JS.
# Pure bash. The compiler is resolved by the shared
# `scripts/elm_toolchain.sh` resolver (one toolchain authority across
# all three kernels).
#
# ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-SHADOW01-CORRECTION02:
#   * The CORRECTION01 vendored-0.19.1 + .elm-home/0.19.1/packages/
#     registry.dat bootstrap is REMOVED. Elm 0.19.2 is the supported
#     toolchain (matches the homebrew `elm` formula and the official
#     Elm installer).
#   * `vendor/elm` and `vendor/elm.sha256` are retained as historical
#     evidence (the CORRECTION01 binary) and are NOT consulted by the
#     build — the dogfood build always passes `${ELM_BIN}` so the
#     worktree's vendor copy is informational.
#
# ACT-CLINEMM-ELMIZE-P1-TOOLCHAIN-RESOLVER01:
#   * Sources `scripts/elm_toolchain.sh` so the resolver contract is
#     identical to the other two kernels.
#
# ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-SHADOW02-CORRECTION05
# (ELM-PROJECT-CWD). `HERE` is the Elm project root
# (``apps/vscode/elm/completion-authority``); ``elm.json`` lives at
# ``${HERE}/elm.json`` and Elm looks it up by walking up from the
# compiler's *working directory*, not from the absolute path passed
# to ``elm make``. The dogfood orchestrator invokes this script with
# ``cwd=stage_apps_vscode`` (the parent of ``elm/``), so without an
# explicit ``cd "${HERE}"`` Elm would run from
# ``apps/vscode``, never find ``elm.json``, and abort with
# ``-- NO elm.json FILE --``. We therefore enter ``HERE`` before
# invoking ``elm make``; this also makes the script self-contained
# (any caller cwd works).
#
# The kernel (Authority, Domain, Codec) is exposed via Main.elm's
# Platform.worker entrypoint. `elm make` bundles the whole module
# graph including Authority and Domain.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Resolve the Elm compiler via the shared toolchain authority. The
# resolver pins 0.19.2 and prefers:
#   1. ${ELM_BIN} (explicit, orchestrator-supplied)
#   2. ${HERE}/vendor/elm (one-shot dev / tracked fallback)
#   3. system `elm` on PATH (exact-version check guards drift)
# It exports ELM, ELM_VERSION, ELM_BIN_SHA256 on success and halts
# closed with a structured HALT_* message on failure.
#
# Path: this script lives at apps/vscode/elm/<kernel>/scripts/build-elm.sh
# (so HERE = apps/vscode/elm/<kernel>). The shared resolver lives at the
# REPO ROOT scripts/elm_toolchain.sh — four `..` segments up
# (kernel -> elm -> vscode -> apps -> repo root).
# shellcheck source=scripts/elm_toolchain.sh
source "${HERE}/../../../../scripts/elm_toolchain.sh"

mkdir -p "${HERE}/vendor"

# CORRECTION05: enter the Elm project root so `elm make` resolves
# `${HERE}/elm.json`. Do this BEFORE invoking the compiler; the
# absolute `Main.elm` path does not substitute for the manifest
# being in the compiler's working directory.
cd "${HERE}"

echo "[build-elm] compiling Main.elm -> vendor/completion-authority.js (elm ${ELM_VERSION} via ${ELM})"
"${ELM}" make "${HERE}/src/Main.elm" --output="${HERE}/vendor/completion-authority.js"

# Sidecar format is `<lowercase-hex-sha256>\n` — the SHA ONLY, no
# path. The dogfood orchestrator (`stage_elm_kernel_runtime_asset`
# in scripts/build_dogfood_vsix_lib.py) reads the sidecar with
# `.strip()` and compares it byte-for-byte against
# `compute_sha256(staged_js)`; on macOS `shasum -a 256` defaults
# to `<sha>  <path>\n`, which would trip the SHA-sidecar mismatch
# guard. `awk '{print $1}'` collapses either shape to the bare
# hash so the sidecar is portable across BSD/macOS and Linux.
emit_sha() {
    local f="$1"
    shasum -a 256 "${f}" | awk '{print $1}' > "${f}.sha256"
}

emit_sha "${HERE}/vendor/completion-authority.js"
emit_sha "${HERE}/src/Main.elm"
emit_sha "${HERE}/src/Authority.elm"
emit_sha "${HERE}/src/Domain.elm"
emit_sha "${HERE}/src/Codec.elm"
emit_sha "${HERE}/elm.json"

echo "[build-elm] done:"
echo "   elm version             -> ${ELM_VERSION}"
echo "   elm compiler path       -> ${ELM}"
echo "   elm compiler sha256     -> ${ELM_BIN_SHA256:-<unreadable>}"
echo "   completion-authority.js -> $(cat "${HERE}/vendor/completion-authority.js.sha256")"
echo "   Main.elm               -> $(cat "${HERE}/src/Main.elm.sha256")"
echo "   Authority.elm          -> $(cat "${HERE}/src/Authority.elm.sha256")"
echo "   Domain.elm             -> $(cat "${HERE}/src/Domain.elm.sha256")"
echo "   Codec.elm              -> $(cat "${HERE}/src/Codec.elm.sha256")"
echo "   elm.json               -> $(cat "${HERE}/elm.json.sha256")"