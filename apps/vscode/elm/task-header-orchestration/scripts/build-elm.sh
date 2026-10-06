#!/usr/bin/env bash
# build-elm.sh
#
# Compile the TaskHeader-orchestration Elm kernel to JS using the
# vendored `elm` 0.19.2 binary at $HERE/vendor/elm. Pure bash. No
# Python. No project-local ELM_HOME / registry.dat staging.
#
# ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION01 (C9):
#   * Mirrors `apps/vscode/elm/completion-authority/scripts/build-elm.sh`
#     verbatim so the build authority pattern is identical across both
#     kernels.
#   * Uses the vendored elm 0.19.2 (the homebrew formula and the
#     official installer). The vendor directory is part of the tracked
#     tree and is the build authority — no second implementation.
#   * `cd "${HERE}"` enters the Elm project root BEFORE invoking
#     `elm make` so the compiler walks up from its working directory
#     to find `${HERE}/elm.json` (Elm does not resolve the manifest
#     from the absolute `Main.elm` path).
#   * Emits both `.js` and `.js.sha256` sidecars so the build
#     orchestrator can verify the produced bytes against the sidecar
#     hash.
#
# The kernel (Orchestration, Domain, Codec) is exposed via Main.elm's
# Platform.worker entrypoint. `elm make` bundles the whole module
# graph including Orchestration, Domain, and Codec.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Pin ELM_HOME so the build is hermetic against any host
# elm version drift (matches `completion-authority/scripts/build-elm.sh`
# convention). The vendored elm 0.19.2 + ELM_HOME=~/.elm with the
# pre-populated packages cache gives a hermetic compile.
#
# macOS chest volume limitation: on macOS, the bundled host
# elm install (e.g. `/run/current-system/sw/bin/elm`) may sit on a
# restricted `chest` filesystem where the lock file in
# $ELM_HOME/0.19.2/packages/ is not writeable by the vendored
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

# Use the vendored elm 0.19.2 binary (same authority as the
# completion-authority kernel). We pin the vendor binary so the build
# is hermetic against any host elm version drift.
ELM="${HERE}/vendor/elm"

if [[ ! -x "${ELM}" ]]; then
    echo "HALT_TASK_HEADER_ELM_KERNEL_NOT_VENDORED" >&2
    echo "fatal: vendored elm binary not found at ${ELM}" >&2
    echo "       is apps/vscode/elm/task-header-orchestration/vendor/elm tracked?" >&2
    exit 1
fi

# Sanity-check the vendored Elm version. We pin to 0.19.2.
ELM_VERSION="$("${ELM}" --version 2>/dev/null || true)"
if [[ "${ELM_VERSION}" != "0.19.2" ]]; then
    echo "HALT_TASK_HEADER_ELM_VERSION_MISMATCH" >&2
    echo "fatal: expected vendored elm 0.19.2, got ${ELM_VERSION}" >&2
    exit 2
fi

# ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION01 (C9 ELM-PROJECT-CWD):
# enter the Elm project root so `elm make` resolves `${HERE}/elm.json`.
# The absolute `Main.elm` path does not substitute for the manifest
# being in the compiler's working directory.
cd "${HERE}"

mkdir -p "${HERE}/vendor"

echo "[build-elm] compiling Main.elm -> vendor/task-header-orchestration.js (elm ${ELM_VERSION})"
"${ELM}" make "${HERE}/src/Main.elm" --output="${HERE}/vendor/task-header-orchestration.js"

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

emit_sha "${HERE}/vendor/task-header-orchestration.js"
emit_sha "${HERE}/src/Main.elm"
emit_sha "${HERE}/src/Orchestration.elm"
emit_sha "${HERE}/src/Domain.elm"
emit_sha "${HERE}/src/Codec.elm"
emit_sha "${HERE}/elm.json"

echo "[build-elm] done:"
echo "   elm version                   -> ${ELM_VERSION}"
echo "   task-header-orchestration.js  -> $(cat "${HERE}/vendor/task-header-orchestration.js.sha256")"
echo "   Main.elm                      -> $(cat "${HERE}/src/Main.elm.sha256")"
echo "   Orchestration.elm             -> $(cat "${HERE}/src/Orchestration.elm.sha256")"
echo "   Domain.elm                    -> $(cat "${HERE}/src/Domain.elm.sha256")"
echo "   Codec.elm                     -> $(cat "${HERE}/src/Codec.elm.sha256")"
echo "   elm.json                      -> $(cat "${HERE}/elm.json.sha256")"