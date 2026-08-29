#!/usr/bin/env python3
"""ACT-CLINEMM-APPROVAL-SPECIMEN-CAPTURE-TOOL01-CORRECTION01

Positive control for the attachment marker.

Fixture: capture.attach.v1 record + one complete approval
transaction (entry + terminal) in the same captured session.
Expected:

  - instrumentationAttachmentBound = True
  - attachmentProjection.runtimeInstanceId is populated
  - attachmentProjection.clineVersion = "4.1.10"
  - attachmentProjection.repoHead = "snake-only-A-fixture"
  - attachmentProjection.emittedAt is populated
  - zeroEventClassification = "N/A"  (real transaction observed)
  - approvalTransactionBound = True
  - runtimeIdentityBound = True
  - qualifyingTransactionCount = 1
  - sessionBindingAvailable = True
"""
import json
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
TOOL = str(REPO / "tools" / "factory" / "capture-approval-specimen.py")
FIXTURE = REPO / ".factory" / "evidence" / ".hermetic-fixture"
BEFORE_ROOT = FIXTURE / "before-attach"
AFTER_ROOT = FIXTURE / "after-attach"


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


# STEP 1: begin
print("=== STEP 1: begin (attach) ===")
r = run([
    "python3", TOOL, "begin",
    "--act", "ACT-CLINEMM-HERMETIC-ATTACH",
    "--data-dir", str(BEFORE_ROOT),
    "--recent-minutes", "60",
])
print(r.stdout)
if r.returncode != 0:
    sys.stderr.write(r.stderr)
    sys.exit(1)

kv = parse_kv(r.stdout)
capture_id = kv["CAPTURE_ID"]

cap_root = REPO / ".factory" / "evidence" / "ACT-CLINEMM-HERMETIC-ATTACH" / "captures" / capture_id
pending_dir = cap_root / "pending"
resolved_dir = cap_root / "resolved"

# STEP 2: finish
print("=== STEP 2: finish (attach) ===")
r = run([
    "python3", TOOL, "finish",
    "--act", "ACT-CLINEMM-HERMETIC-ATTACH",
    "--capture-id", capture_id,
    "--data-dir", str(AFTER_ROOT),
    "--recent-minutes", "60",
])
print(r.stdout)
if r.returncode != 0:
    sys.stderr.write(r.stderr)
    sys.exit(1)

kv = parse_kv(r.stdout)
print(f"  INSTRUMENTATION_ATTACHMENT_BOUND={kv.get('INSTRUMENTATION_ATTACHMENT_BOUND')}")
print(f"  ZERO_EVENT_CLASSIFICATION={kv.get('ZERO_EVENT_CLASSIFICATION')}")
print(f"  SPECIMEN_BINDING={kv.get('SPECIMEN_BINDING')}")
print(f"  RUNTIME_IDENTITY_BOUND={kv.get('RUNTIME_IDENTITY_BOUND')}")
print(f"  APPROVAL_TRANSACTION_BOUND={kv.get('APPROVAL_TRANSACTION_BOUND')}")
print(f"  RUNTIME_SOURCE_DRIFT={kv.get('RUNTIME_SOURCE_DRIFT')}")

assert_eq(kv["INSTRUMENTATION_ATTACHMENT_BOUND"], "YES",
          "T01: attachment marker must be bound when capture.attach.v1 is present")
assert_eq(kv["ZERO_EVENT_CLASSIFICATION"], "N/A",
          "T01: zero-event classifier must return N/A when a real transaction is observed")
assert_eq(kv["SPECIMEN_BINDING"], "PASS",
          "T01: specimenBinding must be PASS for one transaction")
assert_eq(kv["RUNTIME_IDENTITY_BOUND"], "YES",
          "T01: runtime identity bound (session join)")
assert_eq(kv["APPROVAL_TRANSACTION_BOUND"], "YES",
          "T01: approval transaction bound (one tx)")
assert_eq(kv["RUNTIME_SOURCE_DRIFT"], "NO",
          "T01: no runtime source drift (begin and finish HEAD match)")
assert_eq(kv["QUALIFYING_TRANSACTIONS"], "1",
          "T01: exactly one qualifying transaction")

binding = json.loads((resolved_dir / "binding.json").read_text())
ap = binding["attachmentProjection"]
print(f"  attachmentProjection={ap}")
assert_eq(ap["runtimeInstanceId"], "01HEXY_FIXTURE_RUNTIME",
          "T01: attachment runtimeInstanceId")
assert_eq(ap["clineVersion"], "4.1.10",
          "T01: attachment clineVersion")
assert_eq(ap["repoHead"], "snake-only-A-fixture",
          "T01: attachment repoHead")
assert ap["emittedAt"] != "UNAVAILABLE", "T01: emittedAt populated"

ri = binding["runtimeIdentityProjection"]
assert ri["repoHead"] != "UNAVAILABLE", "T01: runtimeIdentityProjection.repoHead"
assert ri["repoTree"] != "UNAVAILABLE", "T01: runtimeIdentityProjection.repoTree"

drift = json.loads((resolved_dir / "runtime-identity-drift.json").read_text())
assert_eq(drift["drift"]["drift"], False, "T01: drift.drift must be false")

# T11/T12: pre-existing legacy capture still parses AND still
# reports CAPTURE_INSUFFICIENT (no retroactive upgrade).
old = (REPO / ".factory" / "evidence" / "ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01"
       / "captures" / "20260829T060942Z-349b48f1" / "resolved" / "binding.json")
old_binding = json.loads(old.read_text())
assert_eq(old_binding["specimenBinding"], "CAPTURE_INSUFFICIENT",
          "T12: pre-correction specimen MUST remain CAPTURE_INSUFFICIENT")
assert_eq(old_binding["runtimeIdentityBound"], False,
          "T12: pre-correction specimen MUST keep runtimeIdentityBound=False")
print("  T11/T12 verified: legacy specimen still parses, still CAPTURE_INSUFFICIENT")

# STEP 3: report
print("=== STEP 3: report (attach) ===")
r = run([
    "python3", TOOL, "report",
    "--act", "ACT-CLINEMM-HERMETIC-ATTACH",
    "--capture-id", capture_id,
])
print(r.stdout)
if r.returncode != 0:
    sys.stderr.write(r.stderr)
    sys.exit(1)

matrix = {
    "fixture_root": str(FIXTURE),
    "T01_attachment_marker_bound": kv["INSTRUMENTATION_ATTACHMENT_BOUND"] == "YES",
    "T02_runtime_identity_bound": binding["runtimeIdentityBound"],
    "T11_legacy_capture_readable": True,
    "T12_pre_correction_insufficient_preserved": True,
    "binding_attachment_bound": kv["INSTRUMENTATION_ATTACHMENT_BOUND"],
    "zero_event_classification": kv["ZERO_EVENT_CLASSIFICATION"],
    "specimen_binding": kv["SPECIMEN_BINDING"],
    "qualifying_transactions": kv["QUALIFYING_TRANSACTIONS"],
    "runtime_source_drift": kv["RUNTIME_SOURCE_DRIFT"],
    "attachment_projection_runtimeInstanceId": ap["runtimeInstanceId"],
    "attachment_projection_clineVersion": ap["clineVersion"],
    "attachment_projection_repoHead": ap["repoHead"],
}
matrix_path = resolved_dir / "hermetic-attachment-matrix.json"
matrix_path.write_text(json.dumps(matrix, indent=2) + "\n")
print(f"\nMatrix: {matrix_path}")
print("verify-attach.py: PASS")
