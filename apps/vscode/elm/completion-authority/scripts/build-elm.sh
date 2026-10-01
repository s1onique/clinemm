#!/usr/bin/env bash
# build-elm.sh
#
# Compile the Elm kernel to JS using the SYSTEM `elm` (Elm 0.19.2
# on PATH). Pure bash. No Python. No vendored compiler. No
# project-local ELM_HOME / registry.dat staging.
#
# ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-SHADOW01-CORRECTION02:
#   * The CORRECTION01 vendored-0.19.1 + .elm-home/0.19.1/packages/
#     registry.dat bootstrap is REMOVED. Elm 0.19.2 is the supported
#     toolchain (matches the homebrew `elm` formula and the official
#     Elm installer).
#   * This script now requires `elm` on PATH and exits with a clear
#     HALT message if it is missing.
#   * `vendor/elm` and `vendor/elm.sha256` are retained as historical
#     evidence (the CORRECTION01 binary) and are NOT consulted by the
#     build.
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
ELM="$(command -v elm 2>/dev/null || true)"

if [[ -z "${ELM}" || ! -x "${ELM}" ]]; then
    echo "HALT_ELM_COMPILER_NOT_ON_PATH" >&2
    echo "fatal: \`elm\` not found on PATH" >&2
    echo "       install Elm 0.19.2 (e.g. \`brew install elm\`) and re-run" >&2
    exit 1
fi

# Sanity-check the Elm version. We pin to 0.19.2; elm-test and
# elm-explorations/test >= 2.0.0 are compatible per the elm-test 0.19.2
# compatibility note.
ELM_VERSION="$("${ELM}" --version 2>/dev/null || true)"
if [[ "${ELM_VERSION}" != "0.19.2" ]]; then
    echo "HALT_ELM_VERSION_MISMATCH" >&2
    echo "fatal: expected elm 0.19.2, got ${ELM_VERSION}" >&2
    exit 2
fi

mkdir -p "${HERE}/vendor"

# CORRECTION05: enter the Elm project root so `elm make` resolves
# `${HERE}/elm.json`. Do this BEFORE invoking the compiler; the
# absolute `Main.elm` path does not substitute for the manifest
# being in the compiler's working directory.
cd "${HERE}"

echo "[build-elm] compiling Main.elm -> vendor/completion-authority.js (elm ${ELM_VERSION})"
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
echo "   elm version          -> ${ELM_VERSION}"
echo "   completion-authority.js -> $(cat "${HERE}/vendor/completion-authority.js.sha256")"
echo "   Main.elm               -> $(cat "${HERE}/src/Main.elm.sha256")"
echo "   Authority.elm          -> $(cat "${HERE}/src/Authority.elm.sha256")"
echo "   Domain.elm             -> $(cat "${HERE}/src/Domain.elm.sha256")"
echo "   Codec.elm              -> $(cat "${HERE}/src/Codec.elm.sha256")"
echo "   elm.json               -> $(cat "${HERE}/elm.json.sha256")"