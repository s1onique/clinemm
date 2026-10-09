#!/usr/bin/env bash
# build-elm.sh
#
# Compile the background-notify-authority Elm kernel to JS.
# Pure bash. The compiler is resolved by the shared
# `scripts/elm_toolchain.sh` resolver (one toolchain authority across
# all four kernels).
#
# ACT-CLINEMM-ELM-SEAM03-BACKGROUND-NOTIFY-AUTHORITY:
#   * Mirrors completion-continuation-control/scripts/build-elm.sh
#     and task-header-orchestration/scripts/build-elm.sh exactly in
#     shape (resolver + cd "${HERE}" + elm make + sidecars).
#   * The Elm 0.19.2 compiler is no longer vendored at $HERE/vendor/elm
#     (see `vendor/.gitignore`). The build pipeline supplies it via
#     `${ELM_BIN}` or via the shared resolver's
#     `${HERE}/vendor/elm` fallback.
#   * Emits both `.js` and `.js.sha256` sidecars so the build
#     orchestrator can verify the produced bytes against the sidecar
#     hash.

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

# Pin ELM_HOME so the build is hermetic against any host
# elm version drift (matches the other two kernels' convention).
if [[ -z "${ELM_HOME:-}" ]]; then
    if [[ -d "${HOME}/.elm/0.19.2/packages" && -w "${HOME}/.elm/0.19.2/packages" ]]; then
        export ELM_HOME="${HOME}/.elm"
    elif [[ -d "/tmp/elm-home/0.19.2/packages" ]]; then
        export ELM_HOME="/tmp/elm-home"
    else
        export ELM_HOME="${HOME}/.elm"
    fi
fi

cd "${HERE}"

mkdir -p "${HERE}/vendor"

echo "[build-elm] compiling Main.elm -> vendor/background-notify-authority.js (elm ${ELM_VERSION} via ${ELM})"
"${ELM}" make "${HERE}/src/Main.elm" --output="${HERE}/vendor/background-notify-authority.js"

# Sidecar format is `<lowercase-hex-sha256>\n` — the SHA ONLY, no
# path. The dogfood orchestrator reads the sidecar with `.strip()` and
# compares it byte-for-byte against `compute_sha256(staged_js)`.
emit_sha() {
    local f="$1"
    shasum -a 256 "${f}" | awk '{print $1}' > "${f}.sha256"
}

emit_sha "${HERE}/vendor/background-notify-authority.js"
emit_sha "${HERE}/src/Main.elm"
emit_sha "${HERE}/src/Policy.elm"
emit_sha "${HERE}/src/Domain.elm"
emit_sha "${HERE}/src/Codec.elm"
emit_sha "${HERE}/elm.json"

echo "[build-elm] done:"
echo "   elm version                            -> ${ELM_VERSION}"
echo "   elm compiler path                      -> ${ELM}"
echo "   elm compiler sha256                    -> ${ELM_BIN_SHA256:-<unreadable>}"
echo "   background-notify-authority.js         -> $(cat "${HERE}/vendor/background-notify-authority.js.sha256")"
echo "   Main.elm                               -> $(cat "${HERE}/src/Main.elm.sha256")"
echo "   Policy.elm                             -> $(cat "${HERE}/src/Policy.elm.sha256")"
echo "   Domain.elm                             -> $(cat "${HERE}/src/Domain.elm.sha256")"
echo "   Codec.elm                              -> $(cat "${HERE}/src/Codec.elm.sha256")"
echo "   elm.json                               -> $(cat "${HERE}/elm.json.sha256")"
