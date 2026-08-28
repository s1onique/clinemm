#!/usr/bin/env python3
"""Identity-mismatch negative: session-A captured, new event's sessionId=session-B.

Pre-correction classify_binding() would have returned PASS here because
counts alone satisfy the predicate (1 candidate, 2 new events). After the
P0 fix, classify_binding() must perform the actual identity join and
return CAPTURE_INSUFFICIENT because no delta event carries session-A.
"""
import json, sys, subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
TOOL = str(REPO / "tools/factory/capture-approval-specimen.py")
FIXTURE = REPO / ".factory" / "evidence" / ".hermetic-fixture"
BEFORE_ROOT = FIXTURE / "before-mismatch"
AFTER_ROOT = FIXTURE / "after-mismatch"


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


print("=== STEP M1: begin (BEFORE_ROOT — only session-A + corr-A) ===")
r = run(["python3", TOOL, "begin",
         "--act", "ACT-CLINEMM-HERMETIC-MISMATCH",
         "--data-dir", str(BEFORE_ROOT),
         "--recent-minutes", "60"])
print(r.stdout)
if r.returncode != 0:
    sys.stderr.write(r.stderr); sys.exit(1)
m_capture_id = parse_kv(r.stdout)["CAPTURE_ID"]
print(f"  CAPTURE_ID={m_capture_id}")

print("\n=== STEP M2: finish (AFTER_ROOT — adds corr-B with sessionId=session-B) ===")
r = run(["python3", TOOL, "finish",
         "--act", "ACT-CLINEMM-HERMETIC-MISMATCH",
         "--capture-id", m_capture_id,
         "--data-dir", str(AFTER_ROOT),
         "--recent-minutes", "60"])
print(r.stdout)
if r.returncode != 0:
    sys.stderr.write(r.stderr); sys.exit(1)

ms = parse_kv(r.stdout)
print(f"  NEW_EVENTS={ms['NEW_EVENTS']} "
      f"DISCRIMINATOR_ITEMS={ms['DISCRIMINATOR_ITEMS']} "
      f"SPECIMEN_BINDING={ms['SPECIMEN_BINDING']} "
      f"ARTIFACT_STATUS={ms['ARTIFACT_STATUS']} "
      f"RUNTIME_IDENTITY_BOUND={ms.get('RUNTIME_IDENTITY_BOUND')}")

# Pre-correction bug: counts satisfied the predicate -> PASS (wrong).
# Post-correction invariant: identity join refuses -> CAPTURE_INSUFFICIENT.
assert_eq(ms["ARTIFACT_STATUS"], "PASS", "artifactStatus (file generated)")
assert_eq(ms["SPECIMEN_BINDING"], "CAPTURE_INSUFFICIENT", "SPECIMEN_BINDING")
assert int(ms["NEW_EVENTS"]) >= 2, "new events should be >= 2 (the B pair)"
assert_eq(ms.get("RUNTIME_IDENTITY_BOUND"), "NO", "runtime identity bound must be NO")
print("  P0 closure verified: identity join refused mismatched session-B event")
print("  Conservation artifact-vs-binding separation preserved")

m_resolved_dir = REPO / ".factory/evidence/ACT-CLINEMM-HERMETIC-MISMATCH/captures" / m_capture_id / "resolved"
m_binding = json.loads((m_resolved_dir / "binding.json").read_text())
assert_eq(m_binding["specimenBinding"], "CAPTURE_INSUFFICIENT", "mismatch binding specimenBinding")
assert_eq(m_binding["runtimeIdentityBound"], False, "mismatch runtimeIdentityBound derived from proof")
assert_eq(m_binding["sessionBindingAvailable"], True, "mismatch sessionBindingAvailable")

# Show that the projection identities set does NOT contain session-B,
# proving the join attempted but failed.
session_index = json.loads((m_resolved_dir / "session-metadata" / "index.json").read_text())
identities = set()
for rec in session_index:
    proj = rec.get("projection") or {}
    if isinstance(proj, dict):
        for k, v in proj.items():
            if k in ("id", "sessionId", "session_id", "taskId", "task_id") and v is not None:
                identities.add(str(v))
print(f"  captured session identities: {sorted(identities)}")
assert "session-A" in identities, "session-A must be in the captured identities set"
assert "session-B" not in identities, "session-B must NOT be in the captured identities set"
print("  identity set mismatch confirmed: captured={session-A}, delta-claimed={session-B}")

matrix = {
    "capture_id": m_capture_id,
    "fixture_root": str(FIXTURE),
    "ARTIFACT_STATUS": ms["ARTIFACT_STATUS"],
    "SPECIMEN_BINDING": ms["SPECIMEN_BINDING"],
    "RUNTIME_IDENTITY_BOUND": ms.get("RUNTIME_IDENTITY_BOUND"),
    "NEW_EVENTS": int(ms["NEW_EVENTS"]),
    "DISCRIMINATOR_ITEMS": int(ms["DISCRIMINATOR_ITEMS"]),
    "captured_session_identities": sorted(identities),
    "P0_closure_verified": True,
}
matrix_path = m_resolved_dir / "hermetic-verification-matrix-mismatch.json"
matrix_path.write_text(json.dumps(matrix, indent=2) + "\n")
print(f"\nMismatch matrix: {matrix_path}")