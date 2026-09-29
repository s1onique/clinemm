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

echo "[build-elm] compiling Main.elm -> vendor/completion-authority.js (elm ${ELM_VERSION})"
"${ELM}" make "${HERE}/src/Main.elm" --output="${HERE}/vendor/completion-authority.js"

shasum -a 256 "${HERE}/vendor/completion-authority.js" > "${HERE}/vendor/completion-authority.js.sha256"
shasum -a 256 "${HERE}/src/Main.elm" > "${HERE}/src/Main.elm.sha256"
shasum -a 256 "${HERE}/src/Authority.elm" > "${HERE}/src/Authority.elm.sha256"
shasum -a 256 "${HERE}/src/Domain.elm" > "${HERE}/src/Domain.elm.sha256"
shasum -a 256 "${HERE}/src/Codec.elm" > "${HERE}/src/Codec.elm.sha256"
shasum -a 256 "${HERE}/elm.json" > "${HERE}/elm.json.sha256"

echo "[build-elm] done:"
echo "   elm version          -> ${ELM_VERSION}"
echo "   completion-authority.js -> $(cat "${HERE}/vendor/completion-authority.js.sha256")"
echo "   Main.elm               -> $(cat "${HERE}/src/Main.elm.sha256")"
echo "   Authority.elm          -> $(cat "${HERE}/src/Authority.elm.sha256")"
echo "   Domain.elm             -> $(cat "${HERE}/src/Domain.elm.sha256")"
echo "   Codec.elm              -> $(cat "${HERE}/src/Codec.elm.sha256")"
echo "   elm.json               -> $(cat "${HERE}/elm.json.sha256")"