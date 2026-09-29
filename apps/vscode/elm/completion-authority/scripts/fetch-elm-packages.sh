#!/usr/bin/env bash
# fetch-elm-packages.sh
#
# HISTORICAL / DISABLED — DO NOT USE.
#
# ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-SHADOW01-CORRECTION02:
#   This script staged Elm 0.19.1 package source trees into a
#   project-local ELM_HOME so that `elm make` could compile offline
#   with a vendored 0.19.1 compiler. CORRECTION01's contract was that
#   the project would still need a genuine `registry.dat` (Elm's
#   binary index of every published package) sourced from a real
#   Elm 0.19.1 run that had reached package.elm-lang.org.
#
#   CORRECTION02 removed that entire bootstrap path:
#     * elm.json is now pinned to 0.19.2 (matches the homebrew
#       `elm` formula and the official Elm installer).
#     * scripts/build-elm.sh and scripts/test-elm.sh invoke the
#       SYSTEM `elm` and `elm-test`, not the vendored 0.19.1 binary.
#     * No project-local ELM_HOME is consulted.
#
#   This file is retained as historical evidence only. It is no longer
#   wired into the build. Running it has no effect on the build.

set -euo pipefail

echo "fetch-elm-packages.sh is DISABLED by ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-SHADOW01-CORRECTION02." >&2
echo "See scripts/build-elm.sh and scripts/test-elm.sh for the current toolchain contract." >&2
exit 0