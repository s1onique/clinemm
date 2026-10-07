#!/usr/bin/env bash
# build-elm.sh
#
# Compile the completion-continuation-control Elm kernel to JS.
# Pure bash. The compiler is resolved by the shared
# `scripts/elm_toolchain.sh` resolver (one toolchain authority across
# all three kernels).
#
# ACT-CLINEMM-ELMIZE-P1-COMPLETION-CONTINUATION-CONTROL-AUTHORITY02:
#   * Mirrors completion-authority/scripts/build-elm.sh and
#     task-header-orchestration/scripts/build-elm.sh exactly in
#     shape (resolver + cd "${HERE}" + elm make + sidecars).
#   * The Elm 0.19.2 compiler is no longer vendored at $HERE/vendor/elm
#     (see `vendor/.gitignore`). The build pipeline supplies it via
#     `${ELM_BIN}` or via the shared resolver's
#     `${HERE}/vendor/elm` fallback.
#
# ACT-CLINEMM-ELMIZE-P1-TOOLCHAIN-RESOLVER01:
#   * Sources `scripts/elm_toolchain.sh` for a single shared compiler
#     resolution contract across all three Elm kernels. The resolver
#     pins 0.19.2 and refuses any other.
#   * The pinned `${ELM_BIN}` is supplied by the canonical dogfood
#     builder (`scripts/build_dogfood_vsix_lib.py:build_elm_kernel`)
#     so the exact-HEAD worktree has nothing to vendor: the compiler
#     is a toolchain input, not source.
#   * `cd "${HERE}"` enters the Elm project root BEFORE invoking
#     `elm make` so the compiler walks up from its working directory
#     to find `${HERE}/elm.json` (Elm does not resolve the manifest
#     from the absolute `Main.elm` path).
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
#
# macOS chest volume limitation: on macOS, the bundled host
# elm install (e.g. `/run/current-system/sw/bin/elm`) may sit on a
# restricted `chest` filesystem where the lock file in
# $ELM_HOME/0.19.2/packages/ is not writeable by the resolved
# binary. The dogfood orchestrator pre-populates `/tmp/elm-home/`
# (a writable volume) with the same packages cache, and we fall
# back to it here. Operators may override with the env var.
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

echo "[build-elm] compiling Main.elm -> vendor/completion-continuation-control.js (elm ${ELM_VERSION} via ${ELM})"
"${ELM}" make "${HERE}/src/Main.elm" --output="${HERE}/vendor/completion-continuation-control.js"

# Sidecar format is `<lowercase-hex-sha256>\n` — the SHA ONLY, no
# path. The dogfood orchestrator reads the sidecar with `.strip()` and
# compares it byte-for-byte against `compute_sha256(staged_js)`; on
# macOS `shasum -a 256` defaults to `<sha>  <path>\n`, which would
# trip the SHA-sidecar mismatch guard. `awk '{print $1}'` collapses
# either shape to the bare hash so the sidecar is portable across
# BSD/macOS and Linux.
emit_sha() {
    local f="$1"
    shasum -a 256 "${f}" | awk '{print $1}' > "${f}.sha256"
}

emit_sha "${HERE}/vendor/completion-continuation-control.js"
emit_sha "${HERE}/src/Main.elm"
emit_sha "${HERE}/src/Policy.elm"
emit_sha "${HERE}/src/Domain.elm"
emit_sha "${HERE}/src/Codec.elm"
emit_sha "${HERE}/elm.json"

echo "[build-elm] done:"
echo "   elm version                            -> ${ELM_VERSION}"
echo "   elm compiler path                      -> ${ELM}"
echo "   elm compiler sha256                    -> ${ELM_BIN_SHA256:-<unreadable>}"
echo "   completion-continuation-control.js     -> $(cat "${HERE}/vendor/completion-continuation-control.js.sha256")"
echo "   Main.elm                               -> $(cat "${HERE}/src/Main.elm.sha256")"
echo "   Policy.elm                             -> $(cat "${HERE}/src/Policy.elm.sha256")"
echo "   Domain.elm                             -> $(cat "${HERE}/src/Domain.elm.sha256")"
echo "   Codec.elm                              -> $(cat "${HERE}/src/Codec.elm.sha256")"
echo "   elm.json                               -> $(cat "${HERE}/elm.json.sha256")"