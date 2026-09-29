#!/usr/bin/env bash
# test-elm.sh
#
# Run elm-test for the completion-authority kernel. Tests live in
# tests/ and use elm-explorations/test.
#
# ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-SHADOW01-CORRECTION02:
#   * CORRECTION01 used a vendored elm-test at $vendor/elm-test with a
#     project-local ELM_HOME. That bootstrap path is REMOVED.
#   * elm-test on macOS is a Node shim that delegates to the system
#     `elm` for the actual compile/run. We require `elm` (>= 0.19.2)
#     and `elm-test` (>= 0.19.2) on PATH; no project-local ELM_HOME.
#   * elm-test needs network access on first invocation to populate
#     the standard elm package cache under ~/.elm. Operators without
#     network access must run elm-test once with network enabled; the
#     cache is then persistent.
#
# Verified locally (CORRECTION02 evidence):
#   elm 0.19.2 (homebrew)        -> elm make src/Main.elm -> vendor/completion-authority.js (exit 0)
#   elm-test 0.19.2-0 (homebrew) -> elm-test tests/CompletionAuthorityTest.elm
#                                  -> TEST RUN PASSED (20/20, 0 FAILED)

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
exec "${ELM_TEST}" "tests/CompletionAuthorityTest.elm"