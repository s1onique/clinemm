#!/usr/bin/env python3
"""ACT-CLINEMM-APPROVAL-SPECIMEN-CAPTURE-TOOL01-CORRECTION01

Zero-event-with-attachment control (T05 + T06 + Z1).

Fixture: capture.attach.v1 is present in the after-phase
diagnostics, but no approval entry/terminal events were emitted
during the capture window. This is the exact case where the
previous classifier would have returned CAPTURE_INSUFFICIENT
without saying WHY.

Expected:

  - runtimeIdentityBound = True
  - approvalTransactionBound = False
  - instrumentationAttachmentBound = True
  - zeroEventClassification = "Z1_CONFIRMED_NO_APPROVAL_PATH_EXECUTED"
  - deltaSize = 0 (only the attach event appears, and the
    attach event IS counted in the delta but does NOT count
    as an approval entry/terminal)
  - specimenBinding = CAPTURE_INSUFFICIENT (no transaction
    was observed; classification is the load-bearing claim)
"""
import json
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
TOOL = str(REPO / "tools" / "factory" / "capture-approval-specimen.py")
FIXTURE = REPO / ".factory" / "evidence" / ".hermetic-fixture"
BEFORE_ROOT = FIXTURE / "before-zero"
AFTER_ROOT = FIXTURE / "after-zero"


def run(args):
    return subprocess.run(args, capture_output=True, text=True, cwd=str(REPO))


def parse_kv(stdout):
    out = {}
    for line in stdout.splitlines():
        if "=" in line and not line.startswith("#"):
            k, _, v = line.partition("=")
            out[k.strip()] = v.strip()
    return out


def assert_eq(actual, expected, msg):
    assert actual == expected, f"{msg}: expected {expected!r}, got {actual!r}"


# begin
print("=== STEP 1: begin (zero) ===")
r = run([
    "python3", TOOL, "begin",
    "--act", "ACT-CLINEMM-HERMETIC-ZERO",
    "--data-dir", str(BEFORE_ROOT),
    "--recent-minutes", "60",
])
if r.returncode != 0:
    sys.stderr.write(r.stderr)
    sys.exit(1)
print(r.stdout)

kv = parse_kv(r.stdout)
capture_id = kv["CAPTURE_ID"]
resolved_dir = REPO / ".factory" / "evidence" / "ACT-CLINEMM-HERMETIC-ZERO" / "captures" / capture_id / "resolved"

# finish
print("=== STEP 2: finish (zero) ===")
r = run([
    "python3", TOOL, "finish",
    "--act", "ACT-CLINEMM-HERMETIC-ZERO",
    "--capture-id", capture_id,
    "--data-dir", str(AFTER_ROOT),
    "--recent-minutes", "60",
])
if r.returncode != 0:
    sys.stderr.write(r.stderr)
    sys.exit(1)
print(r.stdout)

kv = parse_kv(r.stdout)
print(f"  INSTRUMENTATION_ATTACHMENT_BOUND={kv.get('INSTRUMENTATION_ATTACHMENT_BOUND')}")
print(f"  ZERO_EVENT_CLASSIFICATION={kv.get('ZERO_EVENT_CLASSIFICATION')}")
print(f"  SPECIMEN_BINDING={kv.get('SPECIMEN_BINDING')}")
print(f"  RUNTIME_IDENTITY_BOUND={kv.get('RUNTIME_IDENTITY_BOUND')}")
print(f"  APPROVAL_TRANSACTION_BOUND={kv.get('APPROVAL_TRANSACTION_BOUND')}")
print(f"  NEW_EVENTS={kv.get('NEW_EVENTS')}")

# T05/T06: with attachment and zero approval events, classify as Z1.
assert_eq(kv["INSTRUMENTATION_ATTACHMENT_BOUND"], "YES",
          "T05: attachment must be bound")
assert_eq(kv["ZERO_EVENT_CLASSIFICATION"], "Z1_CONFIRMED_NO_APPROVAL_PATH_EXECUTED",
          "T05: zero-event classification must be Z1 when attachment + no approval events")
assert_eq(kv["RUNTIME_IDENTITY_BOUND"], "YES",
          "T05: runtime identity bound (session join)")
assert_eq(kv["APPROVAL_TRANSACTION_BOUND"], "NO",
          "T05: no approval transaction was bound (zero events)")
assert_eq(kv["QUALIFYING_TRANSACTIONS"], "0",
          "T05: zero qualifying transactions")
# NEW_EVENTS counts the attachment marker + any approval events;
# here the attach event appears in the delta.
assert int(kv["NEW_EVENTS"]) >= 1, "T05: at least one new event (the attach marker)"

binding = json.loads((resolved_dir / "binding.json").read_text())
assert_eq(binding["attachmentProjection"]["runtimeInstanceId"],
          "01HEXY_FIXTURE_ZERO",
          "T05: attachment projection populated")

# T06: a zero-event capture WITHOUT attachment must classify as
# CAPTURE_INSUFFICIENT (NOT Z1). We re-use the existing
# verify-negative fixture for this case (no attach, no events).
# Assert here: even with our attach present, the binding must
# still report CAPTURE_INSUFFICIENT because no real transaction
# was bound — Z1 is the diagnostic claim, CAPTURE_INSUFFICIENT
# is the binding verdict.
assert_eq(binding["specimenBinding"], "CAPTURE_INSUFFICIENT",
          "T05: specimenBinding stays CAPTURE_INSUFFICIENT when zero events")

matrix = {
    "fixture_root": str(FIXTURE),
    "T05_zero_event_with_attachment": kv["ZERO_EVENT_CLASSIFICATION"] == "Z1_CONFIRMED_NO_APPROVAL_PATH_EXECUTED",
    "T06_zero_event_no_attachment": None,  # covered by existing verify-negative.py
    "binding_attachment_bound": kv["INSTRUMENTATION_ATTACHMENT_BOUND"],
    "zero_event_classification": kv["ZERO_EVENT_CLASSIFICATION"],
    "specimen_binding": kv["SPECIMEN_BINDING"],
    "approval_transaction_bound": kv["APPROVAL_TRANSACTION_BOUND"],
    "runtime_identity_bound": kv["RUNTIME_IDENTITY_BOUND"],
    "new_events": kv["NEW_EVENTS"],
}
matrix_path = resolved_dir / "hermetic-zero-matrix.json"
matrix_path.write_text(json.dumps(matrix, indent=2) + "\n")
print(f"\nMatrix: {matrix_path}")
print("verify-zero.py: PASS")
