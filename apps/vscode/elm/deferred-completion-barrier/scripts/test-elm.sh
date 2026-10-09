#!/usr/bin/env bash
# test-elm.sh
#
# Run elm-test for the deferred-completion-barrier kernel.
# Tests live in tests/ and use elm-explorations/test.
#
# ACT-CLINEMM-ELM-SEAM08-DEFERRED-COMPLETION-BARRIER-AUTHORITY-MIGRATION:
# Mirrors completion-continuation-control/scripts/test-elm.sh,
# task-header-orchestration/scripts/test-elm.sh, and
# background-notify-authority/scripts/test-elm.sh exactly.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

ELM="$(command -v elm 2>/dev/null || true)"
ELM_TEST="$(command -v elm-test 2>/dev/null || true)"

if [[ -z "${ELM}" || ! -x "${ELM}" ]]; then
    echo "HALT_ELM_COMPILER_NOT_ON_PATH" >&2
    echo "fatal: \`elm\` not found on PATH" >&2
    echo "       install Elm 0.19.2 (e.g. \`brew install elm\`) and re-run" >&2
    exit 1
fi

if [[ -z "${ELM_TEST}" || ! -x "${ELM_TEST}" ]]; then
    echo "HALT_ELM_TEST_NOT_ON_PATH" >&2
    echo "fatal: \`elm-test\` not found on PATH" >&2
    echo "       install elm-test 0.19.2 (e.g. \`brew install elm-test\` or" >&2
    echo "       \`npm install -g elm-test@0.19.2-0\`) and re-run" >&2
    exit 2
fi

cd "${HERE}"
exec "${ELM_TEST}" "tests/DeferredCompletionBarrierTest.elm"
