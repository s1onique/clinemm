#!/usr/bin/env python3
"""Cross-session split negative (fifth-cycle P0 closure).

TWO captured sessions (A and B). After the begin phase we add a single
correlation group corr-X where the entry is owned by session=A and the
terminal is owned by session=B. Both sessions are captured, so Axis 1
holds (RUNTIME_IDENTITY_BOUND=True), but the transaction itself is
incoherent: a single approval cannot truthfully span two runtimes.

Pre-fifth-cycle this case produced `APPROVAL_TRANSACTION_BOUND=True`
(because the old "all sessionIds joined some captured projection" check
treated the {A, B} group as coherent). After the bounded fix:
  - runtimeIdentityBound       = True  (events genuinely belong to
                                       captured sessions)
  - approvalTransactionBound   = False (transaction is incoherent)
  - specimenBinding            = CAPTURE_INSUFFICIENT
  - qualifyingTransactionCount = 0

This complements verify-ambiguity.py — between them they prove the
two-axis model survives both *too many* transactions and *transactions
that span sessions*.
"""
import json, sys, subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
TOOL = str(REPO / "tools/factory/capture-approval-specimen.py")
FIXTURE = REPO / ".factory" / "evidence" / ".hermetic-fixture"
BEFORE_ROOT = FIXTURE / "before-split"
AFTER_ROOT = FIXTURE / "after-split"


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


print("=== STEP S1: begin (BEFORE_ROOT — empty log, sessions=A and B captured) ===")


print("=== STEP S1: begin (BEFORE_ROOT — empty log, sessions=A and B captured) ===")
r = run(["python3", TOOL, "begin",
         "--act", "ACT-CLINEMM-HERMETIC-SPLIT",
         "--data-dir", str(BEFORE_ROOT),
         "--recent-minutes", "60"])
print(r.stdout)
if r.returncode != 0:
    sys.stderr.write(r.stderr); sys.exit(1)
s_capture_id = parse_kv(r.stdout)["CAPTURE_ID"]
print(f"  CAPTURE_ID={s_capture_id}")

print("\n=== STEP S2: finish (AFTER_ROOT — corr-X: entry.session=A, terminal.session=B) ===")
r = run(["python3", TOOL, "finish",
         "--act", "ACT-CLINEMM-HERMETIC-SPLIT",
         "--capture-id", s_capture_id,
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

# Invariants (fifth-cycle reviewer contract):
#   - 2 new events (entry + terminal on corr-X)
#   - 0 qualifying transactions (the {entry: A, terminal: B} group is incoherent)
#   - specimenBinding = CAPTURE_INSUFFICIENT
#   - runtimeIdentityBound = YES    (events DO belong to captured sessions)
#   - approvalTransactionBound = NO  (transaction is incoherent)
assert_eq(int(kv["NEW_EVENTS"]), 2, "NEW_EVENTS")
assert_eq(int(kv["QUALIFYING_TRANSACTIONS"]), 0, "QUALIFYING_TRANSACTIONS")
assert_eq(kv["SPECIMEN_BINDING"], "CAPTURE_INSUFFICIENT", "SPECIMEN_BINDING")
assert_eq(kv["ARTIFACT_STATUS"], "PASS", "ARTIFACT_STATUS")
assert_eq(kv["RUNTIME_IDENTITY_BOUND"], "YES",
          "RUNTIME_IDENTITY_BOUND (both A and B are captured — session ownership IS proved)")
assert_eq(kv["APPROVAL_TRANSACTION_BOUND"], "NO",
          "APPROVAL_TRANSACTION_BOUND (transaction span is incoherent)")
print("  P0 closure verified: cross-session transaction is incoherent even when both sessions are captured")
print("  two-axis semantics preserved: axis-1 YES, axis-2 NO")

s_resolved = REPO / ".factory/evidence/ACT-CLINEMM-HERMETIC-SPLIT/captures" / s_capture_id / "resolved"
s_binding = json.loads((s_resolved / "binding.json").read_text())
assert_eq(s_binding["specimenBinding"], "CAPTURE_INSUFFICIENT", "binding specimenBinding")
assert_eq(s_binding["runtimeIdentityBound"], True, "binding runtimeIdentityBound")
assert_eq(s_binding["approvalTransactionBound"], False, "binding approvalTransactionBound")
assert_eq(s_binding["qualifyingTransactionCount"], 0, "binding qualifyingTransactionCount")
assert_eq(s_binding["sessionBindingAvailable"], True, "binding sessionBindingAvailable")

# Discriminator must show BOTH captured session identities + corr-X.
disc = json.loads((s_resolved / "approval-discriminator.json").read_text())
disc_session_ids = sorted({item.get("sessionId") for item in disc["items"] if item.get("sessionId")})
print(f"  discriminator sessionIds={disc_session_ids}")
assert_eq(disc_session_ids, ["session-A", "session-B"],
          "discriminator must show BOTH captured session identities (the cross-session split was real)")
assert disc["items"][0]["correlationId"] == "corr-X", "discriminator preserves correlation group"
print("  both captured-session identities observed in events (axis-1 proof was genuine)")

matrix = {
    "capture_id": s_capture_id,
    "fixture_root": str(FIXTURE),
    "ARTIFACT_STATUS": kv["ARTIFACT_STATUS"],
    "SPECIMEN_BINDING": kv["SPECIMEN_BINDING"],
    "RUNTIME_IDENTITY_BOUND": kv["RUNTIME_IDENTITY_BOUND"],
    "APPROVAL_TRANSACTION_BOUND": kv["APPROVAL_TRANSACTION_BOUND"],
    "QUALIFYING_TRANSACTIONS": int(kv["QUALIFYING_TRANSACTIONS"]),
    "NEW_EVENTS": int(kv["NEW_EVENTS"]),
    "DISCRIMINATOR_ITEMS": int(kv["DISCRIMINATOR_ITEMS"]),
    "discriminator_session_ids": disc_session_ids,
    "discriminator_correlation_ids": sorted(
        {item.get("correlationId") for item in disc["items"] if item.get("correlationId")}
    ),
    "P0_closure_verified": "cross_session_transaction_incoherent_with_captured_sessions",
}
matrix_path = s_resolved / "hermetic-verification-matrix-split.json"
matrix_path.write_text(json.dumps(matrix, indent=2) + "\n")
print(f"\nSplit matrix: {matrix_path}")