#!/usr/bin/env bash
# build-elm.sh
#
# Compile the deferred-completion-barrier Elm kernel to JS.
# Pure bash. The compiler is resolved by the shared
# `scripts/elm_toolchain.sh` resolver (one toolchain authority
# across all five kernels).
#
# ACT-CLINEMM-ELM-SEAM08-DEFERRED-COMPLETION-BARRIER-AUTHORITY-MIGRATION:
#   * Mirrors completion-continuation-control/scripts/build-elm.sh,
#     task-header-orchestration/scripts/build-elm.sh, and
#     background-notify-authority/scripts/build-elm.sh exactly in
#     shape (resolver + cd "${HERE}" + elm make + sidecars).
#   * The Elm 0.19.2 compiler is no longer vendored at
#     ${HERE}/vendor/elm (see `vendor/.gitignore`).
#   * Emits both `.js` and `.js.sha256` sidecars so the build
#     orchestrator can verify the produced bytes against the
#     sidecar hash.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Path: this script lives at apps/vscode/elm/<kernel>/scripts/build-elm.sh
# (so HERE = apps/vscode/elm/<kernel>). The shared resolver lives at
# the REPO ROOT scripts/elm_toolchain.sh — four `..` segments up
# (kernel -> elm -> vscode -> apps -> repo root).
# shellcheck source=scripts/elm_toolchain.sh
source "${HERE}/../../../../scripts/elm_toolchain.sh"

# Pin ELM_HOME so the build is hermetic against any host
# elm version drift (matches the other kernels' convention).
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

echo "[build-elm] compiling Main.elm -> vendor/deferred-completion-barrier.js (elm ${ELM_VERSION} via ${ELM})"
"${ELM}" make "${HERE}/src/Main.elm" --output="${HERE}/vendor/deferred-completion-barrier.js"

# Sidecar format is `<lowercase-hex-sha256>\n` — the SHA ONLY,
# no path. The dogfood orchestrator reads the sidecar with
# `.strip()` and compares it byte-for-byte against
# `compute_sha256(staged_js)`.
emit_sha() {
    local f="$1"
    shasum -a 256 "${f}" | awk '{print $1}' > "${f}.sha256"
}

emit_sha "${HERE}/vendor/deferred-completion-barrier.js"
emit_sha "${HERE}/src/Main.elm"
emit_sha "${HERE}/src/Policy.elm"
emit_sha "${HERE}/src/Domain.elm"
emit_sha "${HERE}/src/Codec.elm"
emit_sha "${HERE}/elm.json"

echo "[build-elm] done:"
echo "   elm version                            -> ${ELM_VERSION}"
echo "   elm compiler path                      -> ${ELM}"
echo "   elm compiler sha256                    -> ${ELM_BIN_SHA256:-<unreadable>}"
echo "   deferred-completion-barrier.js         -> $(cat "${HERE}/vendor/deferred-completion-barrier.js.sha256")"
echo "   Main.elm                               -> $(cat "${HERE}/src/Main.elm.sha256")"
echo "   Policy.elm                             -> $(cat "${HERE}/src/Policy.elm.sha256")"
echo "   Domain.elm                             -> $(cat "${HERE}/src/Domain.elm.sha256")"
echo "   Codec.elm                              -> $(cat "${HERE}/src/Codec.elm.sha256")"
echo "   elm.json                               -> $(cat "${HERE}/elm.json.sha256")"
