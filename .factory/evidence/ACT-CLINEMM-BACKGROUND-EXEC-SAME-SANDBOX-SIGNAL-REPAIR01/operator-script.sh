#!/bin/bash
# =============================================================================
# ACT-CLINEMM-BACKGROUND-EXEC-SAME-SANDBOX-SIGNAL-REPAIR01
# QUARANTINED — UNSAFE / NON-AUTHORITATIVE — DO NOT RUN
#
# The 2026-11-05 Factory review rejected this procedure with
# HALT_UNSAFE_OPERATOR_QUALIFICATION.  The original implementation was
# unsafe because it:
#
#   1. ran the production GREEN fixture from an ordinary Terminal instead of
#      the installed ClineMM Background Exec path;
#   2. quit VSCodium application-wide, risking unrelated PolyC/MTS/dogfood
#      instances;
#   3. launched an unbounded detached process and a foreign target outside
#      the repaired sandbox;
#   4. used an indiscriminate pid kill without a fresh identity check; and
#   5. accumulated gate failures instead of failing closed before spawning.
#
# The replacement is:
#   operator-qualification.sh
#
# It is a bounded, staged procedure.  It never quits VSCodium globally, never
# uses a broad process-count heuristic, and never creates an unbounded child.
# Its production GREEN is issued from the installed ClineMM Background Exec
# path and correlated to the Seatbelt observer JSONL.
#
# Exit status: 127 if invoked.  This file is retained only as a tombstone so
# the rejected artifact cannot be mistaken for the authoritative procedure.
# =============================================================================
echo "HALT_UNSAFE_OPERATOR_QUALIFICATION: this script is quarantined and must not be run." >&2
echo "Use operator-qualification.sh and QUALIFICATION-RUNBOOK.md instead." >&2
exit 127
