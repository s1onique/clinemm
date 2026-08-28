#!/usr/bin/env python3
"""Conservation negative: same fixture but NO new event after begin -> CAPTURE_INSUFFICIENT."""
import json, sys, subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
TOOL = str(REPO / "tools/factory/capture-approval-specimen.py")
FIXTURE = REPO / ".factory" / "evidence" / ".hermetic-fixture"
BEFORE_ROOT = FIXTURE / "before"


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


print("=== STEP N1: begin (BEFORE_ROOT) ===")
r = run(["python3", TOOL, "begin",
         "--act", "ACT-CLINEMM-HERMETIC-FIXTURE-NEGATIVE",
         "--data-dir", str(BEFORE_ROOT),
         "--recent-minutes", "60"])
print(r.stdout)
if r.returncode != 0:
    sys.stderr.write(r.stderr)
    sys.exit(1)

neg_capture_id = parse_kv(r.stdout)["CAPTURE_ID"]
print(f"  CAPTURE_ID={neg_capture_id}")

print("\n=== STEP N2: finish (SAME BEFORE_ROOT — no new event) ===")
r = run(["python3", TOOL, "finish",
         "--act", "ACT-CLINEMM-HERMETIC-FIXTURE-NEGATIVE",
         "--capture-id", neg_capture_id,
         "--data-dir", str(BEFORE_ROOT),
         "--recent-minutes", "60"])
print(r.stdout)
if r.returncode != 0:
    sys.stderr.write(r.stderr)
    sys.exit(1)

ns = parse_kv(r.stdout)
print(f"  ARTIFACT_STATUS={ns['ARTIFACT_STATUS']}")
print(f"  SPECIMEN_BINDING={ns['SPECIMEN_BINDING']}")
print(f"  NEW_EVENTS={ns['NEW_EVENTS']}")
assert_eq(ns["ARTIFACT_STATUS"], "PASS", "artifactStatus (file was generated)")
assert_eq(ns["SPECIMEN_BINDING"], "CAPTURE_INSUFFICIENT", "SPECIMEN_BINDING")
assert_eq(int(ns["NEW_EVENTS"]), 0, "NEW_EVENTS should be 0")
print("  Conservation negative PASSED")

neg_resolved_dir = REPO / ".factory/evidence/ACT-CLINEMM-HERMETIC-FIXTURE-NEGATIVE/captures" / neg_capture_id / "resolved"
neg_disc = json.loads((neg_resolved_dir / "approval-discriminator.json").read_text())
assert_eq(len(neg_disc["items"]), 0, "discriminator should be empty when no new event")
print(f"  discriminator.items={len(neg_disc['items'])} (empty as expected)")

neg_binding = json.loads((neg_resolved_dir / "binding.json").read_text())
assert_eq(neg_binding["artifactStatus"], "PASS", "neg binding artifactStatus")
assert_eq(neg_binding["specimenBinding"], "CAPTURE_INSUFFICIENT", "neg binding specimenBinding")
print(f"  neg binding: artifactStatus=PASS, specimenBinding=CAPTURE_INSUFFICIENT")

neg_matrix = {
    "capture_id": neg_capture_id,
    "fixture_root": str(FIXTURE),
    "ARTIFACT_STATUS": ns["ARTIFACT_STATUS"],
    "SPECIMEN_BINDING": ns["SPECIMEN_BINDING"],
    "NEW_EVENTS": int(ns["NEW_EVENTS"]),
    "DISCRIMINATOR_ITEMS": len(neg_disc["items"]),
}
neg_matrix_path = neg_resolved_dir / "hermetic-verification-matrix-negative.json"
neg_matrix_path.write_text(json.dumps(neg_matrix, indent=2) + "\n")
print(f"\nNegative matrix: {neg_matrix_path}")
