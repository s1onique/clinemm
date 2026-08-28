#!/usr/bin/env python3
"""Transaction-ambiguity negative: captured session=A, two complete
approval transactions (corr-B AND corr-C) appear in the delta, both
with session_id=session-A.

Pre-fourth-cycle classify_binding() would have returned PASS because
session ownership was proved. After the transaction-uniqueness fix:
  - runtimeIdentityBound       = True  (both transactions join A)
  - approvalTransactionBound   = False (two concurrent transactions)
  - specimenBinding            = CAPTURE_INSUFFICIENT
  - qualifyingTransactionCount = 2
"""
import json, sys, subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
TOOL = str(REPO / "tools/factory/capture-approval-specimen.py")
FIXTURE = REPO / ".factory" / "evidence" / ".hermetic-fixture"
BEFORE_ROOT = FIXTURE / "before-ambiguity"
AFTER_ROOT = FIXTURE / "after-ambiguity"


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


print("=== STEP A1: begin (BEFORE_ROOT — empty log, session=A captured) ===")
r = run(["python3", TOOL, "begin",
         "--act", "ACT-CLINEMM-HERMETIC-AMBIGUITY",
         "--data-dir", str(BEFORE_ROOT),
         "--recent-minutes", "60"])
print(r.stdout)
if r.returncode != 0:
    sys.stderr.write(r.stderr); sys.exit(1)
a_capture_id = parse_kv(r.stdout)["CAPTURE_ID"]
print(f"  CAPTURE_ID={a_capture_id}")

print("\n=== STEP A2: finish (AFTER_ROOT — 2 transactions, both session=A) ===")
r = run(["python3", TOOL, "finish",
         "--act", "ACT-CLINEMM-HERMETIC-AMBIGUITY",
         "--capture-id", a_capture_id,
         "--data-dir", str(AFTER_ROOT),
         "--recent-minutes", "60"])
print(r.stdout)
if r.returncode != 0:
    sys.stderr.write(r.stderr); sys.exit(1)

kv = parse_kv(r.stdout)
print(f"  NEW_EVENTS={kv['NEW_EVENTS']} "
      f"DISCRIMINATOR_ITEMS={kv['DISCRIMINATOR_ITEMS']} "
      f"QUALIFYING_TRANSACTIONS={kv['QUALIFYING_TRANSACTIONS']} "
      f"SPECIMEN_BINDING={kv['SPECIMEN_BINDING']} "
      f"RUNTIME_IDENTITY_BOUND={kv.get('RUNTIME_IDENTITY_BOUND')} "
      f"APPROVAL_TRANSACTION_BOUND={kv.get('APPROVAL_TRANSACTION_BOUND')}")

# Invariants (fourth-cycle reviewer contract):
#   - 4 new events (entry+terminal x2 transactions)
#   - 2 qualifying transactions (corr-B + corr-C both with entry+terminal)
#   - specimenBinding = CAPTURE_INSUFFICIENT (ambiguous human action)
#   - runtimeIdentityBound = YES    (session ownership WAS proved)
#   - approvalTransactionBound = NO (transaction selection ambiguous)
assert_eq(int(kv["NEW_EVENTS"]), 4, "NEW_EVENTS")
assert_eq(int(kv["QUALIFYING_TRANSACTIONS"]), 2, "QUALIFYING_TRANSACTIONS")
assert_eq(kv["SPECIMEN_BINDING"], "CAPTURE_INSUFFICIENT", "SPECIMEN_BINDING")
assert_eq(kv["ARTIFACT_STATUS"], "PASS", "ARTIFACT_STATUS")
assert_eq(kv["RUNTIME_IDENTITY_BOUND"], "YES", "runtime identity proved (session owns the events)")
assert_eq(kv["APPROVAL_TRANSACTION_BOUND"], "NO", "approval transaction selection ambiguous")
print("  P0 closure verified: ambiguity demotes transaction axis only")
print("  session ownership preserved (don't demote real session binding on transaction ambiguity)")

a_resolved = REPO / ".factory/evidence/ACT-CLINEMM-HERMETIC-AMBIGUITY/captures" / a_capture_id / "resolved"
a_binding = json.loads((a_resolved / "binding.json").read_text())
assert_eq(a_binding["specimenBinding"], "CAPTURE_INSUFFICIENT", "binding specimenBinding")
assert_eq(a_binding["runtimeIdentityBound"], True, "binding runtimeIdentityBound preserved")
assert_eq(a_binding["approvalTransactionBound"], False, "binding approvalTransactionBound demoted")
assert_eq(a_binding["qualifyingTransactionCount"], 2, "binding qualifyingTransactionCount")
assert_eq(a_binding["sessionBindingAvailable"], True, "binding sessionBindingAvailable")

# Discriminator must show both correlation groups.
disc = json.loads((a_resolved / "approval-discriminator.json").read_text())
disc_corr = {item.get("correlationId") for item in disc["items"] if item.get("correlationId")}
print(f"  discriminator correlationIds: {sorted(disc_corr)}")
assert_eq(disc_corr, {"corr-B", "corr-C"}, "discriminator must show both transactions")
print("  both transactions present in discriminator (the classifier's input was real concurrency)")

matrix = {
    "capture_id": a_capture_id,
    "fixture_root": str(FIXTURE),
    "ARTIFACT_STATUS": kv["ARTIFACT_STATUS"],
    "SPECIMEN_BINDING": kv["SPECIMEN_BINDING"],
    "RUNTIME_IDENTITY_BOUND": kv["RUNTIME_IDENTITY_BOUND"],
    "APPROVAL_TRANSACTION_BOUND": kv["APPROVAL_TRANSACTION_BOUND"],
    "QUALIFYING_TRANSACTIONS": int(kv["QUALIFYING_TRANSACTIONS"]),
    "NEW_EVENTS": int(kv["NEW_EVENTS"]),
    "DISCRIMINATOR_ITEMS": int(kv["DISCRIMINATOR_ITEMS"]),
    "discriminator_correlation_ids": sorted(disc_corr),
    "P0_closure_verified": "transaction_ambiguity_demoted_while_session_ownership_preserved",
}
matrix_path = a_resolved / "hermetic-verification-matrix-ambiguity.json"
matrix_path.write_text(json.dumps(matrix, indent=2) + "\n")
print(f"\nAmbiguity matrix: {matrix_path}")