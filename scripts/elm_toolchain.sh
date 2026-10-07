#!/usr/bin/env bash
# elm_toolchain.sh
#
# Shared Elm compiler resolver for every kernel `build-elm.sh`.
#
# ACT-CLINEMM-ELMIZE-P1-TOOLCHAIN-RESOLVER01 (P1 — bounded
# build/toolchain contract defect).
#
# Contract
# --------
# Source this file from a `build-elm.sh` (or any other Elm build
# authority script) and use the emitted variables to invoke the
# compiler. The resolver pins Elm `0.19.2` (matches
# `vendor/elm.version` and the official installer / homebrew formula)
# and refuses to run with any other version — fail closed.
#
# Resolver precedence (first non-empty wins):
#
#   1. `${ELM_BIN}` — explicit override. The canonical dogfood
#      builder (`scripts/build_dogfood_vsix_lib.py:build_elm_kernel`)
#      resolves a pinned compiler path on the build host and passes
#      it in via the environment. This is the only branch the
#      canonical dogfood build trusts.
#
#   2. `${HERE}/vendor/elm` (if `HERE` is set and the file is
#      executable). One canonical existing repo-local compiler,
#      available for one-shot dev builds that never go through the
#      orchestrator. Tracked kernels (e.g. task-header-orchestration)
#      carry this in the repo; the orchestrator ignores this branch.
#
#   3. `command -v elm` — exact-version system elm. The host's
#      `/opt/homebrew/bin/elm 0.19.2` satisfies this; the Nix-system
#      `/run/current-system/sw/bin/elm 0.19.1` does NOT.
#
#   4. Fail closed with a structured `HALT_ELM_TOOLCHAIN_UNRESOLVED`
#      message and the next-step remediation hints.
#
# Emitted variables
# ----------------
#   ELM             absolute path to the resolved compiler
#   ELM_VERSION     version reported by `${ELM} --version`
#   ELM_BIN_SHA256  sha256 of the compiler binary itself (empty if
#                   the chosen binary cannot be hashed, e.g. on a
#                   network mount without read permission — the
#                   orchestrator treats an empty SHA as a soft
#                   warning, not a fail-closed trigger).
#
# Source contract
# ---------------
# Source as (relative path varies by caller's location):
#   source "${SCRIPT_DIR}/../../scripts/elm_toolchain.sh"
# OR, when the caller lives next to scripts/elm_toolchain.sh:
#   source "${BASH_SOURCE[0]%/*}/elm_toolchain.sh"
#
# Either way, the caller MUST set `${HERE}` to the Elm project root
# before sourcing if it wants branch (2) to be considered. `build-elm.sh`
# already does this (`HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"`).

# ---------------------------------------------------------------------------
# Pinned version
# ---------------------------------------------------------------------------
# The exact version the build authority enforces. Matches:
#   - vendor/elm.version            : "0.19.2"
#   - vendor/elm.sha256             : decompressed-binary SHA
#   - /opt/homebrew/bin/elm --version (operator-installed homebrew)
#   - the official Elm installer at https://guide.elm-lang.org/install/elm.json
ELM_REQUIRED_VERSION="0.19.2"

# ---------------------------------------------------------------------------
# Resolver
# ---------------------------------------------------------------------------
_elm_toolchain_resolve() {
    local explicit_env="${ELM_BIN:-}"

    # Branch 1: explicit ELM_BIN override (orchestrator-supplied).
    if [[ -n "${explicit_env}" && -x "${explicit_env}" ]]; then
        printf '%s\n' "${explicit_env}"
        return 0
    fi

    # Branch 2: canonical existing repo-local compiler (one-shot dev).
    if [[ -n "${HERE:-}" && -x "${HERE}/vendor/elm" ]]; then
        printf '%s\n' "${HERE}/vendor/elm"
        return 0
    fi

    # Branch 3: exact-version system elm.
    local candidate
    candidate="$(command -v elm 2>/dev/null || true)"
    if [[ -n "${candidate}" && -x "${candidate}" ]]; then
        printf '%s\n' "${candidate}"
        return 0
    fi

    return 1
}

_elm_toolchain_set_vars() {
    local resolved
    if ! resolved="$(_elm_toolchain_resolve)"; then
        echo "HALT_ELM_TOOLCHAIN_UNRESOLVED" >&2
        echo "fatal: could not locate an Elm ${ELM_REQUIRED_VERSION} compiler." >&2
        echo "" >&2
        echo "  Tried (in precedence order):" >&2
        if [[ -n "${ELM_BIN:-}" ]]; then
            echo "    1. ELM_BIN=${ELM_BIN}  (not executable)" >&2
        else
            echo "    1. ELM_BIN            (unset)" >&2
        fi
        if [[ -n "${HERE:-}" ]]; then
            echo "    2. ${HERE}/vendor/elm (not present / not executable)" >&2
        else
            echo "    2. \$HERE/vendor/elm  (\$HERE unset)" >&2
        fi
        echo "    3. system elm         (\`command -v elm\` returned nothing)" >&2
        echo "" >&2
        echo "  Remediation:" >&2
        echo "    - Install Elm ${ELM_REQUIRED_VERSION} via \`brew install elm\` or" >&2
        echo "      the official installer at https://guide.elm-lang.org/install/" >&2
        echo "    - OR set ELM_BIN=/absolute/path/to/elm-${ELM_REQUIRED_VERSION} in" >&2
        echo "      the build environment." >&2
        return 1
    fi

    ELM="${resolved}"
    # Sanity-check version. We pin to exactly ${ELM_REQUIRED_VERSION}.
    local reported
    reported="$("${ELM}" --version 2>/dev/null || true)"
    if [[ "${reported}" != "${ELM_REQUIRED_VERSION}" ]]; then
        echo "HALT_ELM_TOOLCHAIN_VERSION_MISMATCH" >&2
        echo "fatal: expected elm ${ELM_REQUIRED_VERSION}, got ${reported}" >&2
        echo "       resolved compiler path: ${ELM}" >&2
        echo "       pin via ELM_BIN=/absolute/path/to/elm-${ELM_REQUIRED_VERSION}" >&2
        return 2
    fi
    ELM_VERSION="${reported}"

    # Compute the compiler binary SHA. Empty string if we cannot read
    # the file (e.g. ACL-blocked network mount). The orchestrator
    # treats an empty SHA as a soft warning, not a fail-closed
    # trigger — the version check is already fail-closed.
    if [[ -r "${ELM}" ]]; then
        ELM_BIN_SHA256="$(shasum -a 256 "${ELM}" 2>/dev/null | awk '{print $1}' || true)"
    else
        ELM_BIN_SHA256=""
    fi
    export ELM ELM_VERSION ELM_BIN_SHA256
}

_elm_toolchain_set_vars