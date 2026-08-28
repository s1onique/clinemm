#!/usr/bin/env python3
"""Run begin -> mutate -> finish -> report on the hermetic fixture and assert invariants."""
import json, sys, subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
TOOL = str(REPO / "tools/factory/capture-approval-specimen.py")
FIXTURE = REPO / ".factory" / "evidence" / ".hermetic-fixture"
BEFORE_ROOT = FIXTURE / "before"
AFTER_ROOT = FIXTURE / "after"


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


# STEP 1: begin (scan BEFORE_ROOT only)
print("=== STEP 1: begin ===")
r = run(["python3", TOOL, "begin",
         "--act", "ACT-CLINEMM-HERMETIC-FIXTURE",
         "--data-dir", str(BEFORE_ROOT),
         "--recent-minutes", "60"])
print(r.stdout)
if r.returncode != 0:
    sys.stderr.write(r.stderr)
    sys.exit(1)

kv = parse_kv(r.stdout)
capture_id = kv["CAPTURE_ID"]
print(f"CAPTURE_ID={capture_id}")

cap_root = REPO / ".factory/evidence/ACT-CLINEMM-HERMETIC-FIXTURE/captures" / capture_id
pending_dir = cap_root / "pending"
resolved_dir = cap_root / "resolved"

print("\n=== STEP 1 VERIFY (pending) ===")
ps = json.loads((pending_dir / "approval-summary.json").read_text())
pi = json.loads((pending_dir / "session-metadata/index.json").read_text())
pfp_lines = [
    l for l in (pending_dir / "approval-event-fingerprints.jsonl").read_text().splitlines()
    if l.strip()
]
pm = json.loads((pending_dir / "manifest.json").read_text())
print(f"  schema={pm['schema']} approvalEventCount={ps['approvalEventCount']} "
      f"sessionCandidateCount={ps['sessionCandidateCount']} fingerprints={len(pfp_lines)}")
assert_eq(pm["schema"], "cline-approval-specimen-capture/v2", "schema")
assert ps["sessionCandidateCount"] > 0, "P1 invariant: session not detected"
assert len(pfp_lines) > 0, "P0.2 invariant: no fingerprints frozen"
assert_eq(ps["approvalEventCount"], len(pfp_lines), "event count != fingerprint count")
assert_eq(ps["approvalEventCount"], 2, "begin should see exactly pair A (2 events)")

proj_keys = set()
for rec in pi:
    if isinstance(rec.get("projection"), dict):
        proj_keys.update(rec["projection"].keys())
print(f"  session projection keys: {sorted(proj_keys)[:8]}")
assert proj_keys & {"session_id", "sessionId", "taskId", "id"}, \
    f"projection missing identity keys: {proj_keys}"
print("  P1 closed (session_id/sessionId/taskId aliased)")
print("  P0.2 frozen (fingerprints written)")


# STEP 2: finish (scan AFTER_ROOT which contains A+B)
print("\n=== STEP 2: finish (BEFORE_ROOT -> AFTER_ROOT) ===")
r = run(["python3", TOOL, "finish",
         "--act", "ACT-CLINEMM-HERMETIC-FIXTURE",
         "--capture-id", capture_id,
         "--data-dir", str(AFTER_ROOT),
         "--recent-minutes", "60"])
print(r.stdout)
if r.returncode != 0:
    sys.stderr.write(r.stderr)
    sys.exit(1)

fs = parse_kv(r.stdout)
print(f"finish summary: NEW_EVENTS={fs['NEW_EVENTS']} "
      f"DISCRIMINATOR_ITEMS={fs['DISCRIMINATOR_ITEMS']} "
      f"SPECIMEN_BINDING={fs['SPECIMEN_BINDING']} "
      f"ARTIFACT_STATUS={fs['ARTIFACT_STATUS']}")
assert_eq(fs["CAPTURE_ID"], capture_id, "CAPTURE_ID mismatch")
assert_eq(int(fs["NEW_EVENTS"]), 2, "expected 2 new events (pair B)")
assert_eq(fs["SPECIMEN_BINDING"], "PASS", "SPECIMEN_BINDING")
assert_eq(fs["ARTIFACT_STATUS"], "PASS", "ARTIFACT_STATUS")
print("  CAPTURE_ID bound (begin == finish)")
print("  P0.2: NEW_EVENTS=2 (pair B)")
print("  P0.3: SPECIMEN_BINDING=PASS")

# STEP 2 VERIFY (resolved artifacts)
print("\n=== STEP 2 VERIFY (resolved artifacts) ===")
binding = json.loads((resolved_dir / "binding.json").read_text())
delta_lines = [l for l in (resolved_dir / "approval-events-delta.jsonl").read_text().splitlines() if l.strip()]
before_lines = [l for l in (resolved_dir / "approval-events-before.jsonl").read_text().splitlines() if l.strip()]
after_lines = [l for l in (resolved_dir / "approval-events-after.jsonl").read_text().splitlines() if l.strip()]
discriminator = json.loads((resolved_dir / "approval-discriminator.json").read_text())
print(f"  schema={binding['schema']} artifactStatus={binding['artifactStatus']} "
      f"specimenBinding={binding['specimenBinding']} "
      f"sessionBindingAvailable={binding['sessionBindingAvailable']} "
      f"runtimeIdentityBound={binding['runtimeIdentityBound']}")
print(f"  delta={len(delta_lines)} before={len(before_lines)} after={len(after_lines)} "
      f"discriminator_items={len(discriminator['items'])}")

assert_eq(binding["schema"], "cline-approval-specimen-binding/v1", "binding schema")
assert_eq(binding["artifactStatus"], "PASS", "artifactStatus")
assert_eq(binding["specimenBinding"], "PASS", "specimenBinding")
assert binding["sessionBindingAvailable"] is True
assert binding["eventDeltaBound"] is True
assert binding["runtimeIdentityBound"] is True
assert_eq(len(delta_lines), 2, "delta should be pair B (2 events)")
assert_eq(len(before_lines), 2, "before should be pair A (2 events)")
assert_eq(len(after_lines), 4, "after should be A+B (4 events)")
assert_eq(len(discriminator["items"]), 2, "discriminator items")

delta_corr_ids = set()
for line in delta_lines:
    e = json.loads(line)
    inner = e.get("event", {})
    delta_corr_ids.add(inner.get("correlationId"))
print(f"  delta correlationIds={sorted(delta_corr_ids)}")
assert_eq(delta_corr_ids, {"corr-B"}, "delta should contain only pair B")
print("  P0.2 verified: BEFORE=A(2), AFTER=A+B(4), DELTA=B only(2)")
print("  P0.3 verified: artifactStatus=PASS, specimenBinding=PASS")

required = ("toolName", "correlationId", "sessionId",
           "policyAutoApprove", "shouldAutoApproveTool",
           "approvalEntryObserved", "approvalTerminalObserved", "source")
for item in discriminator["items"]:
    for f in required:
        assert f in item, f"discriminator missing field {f}"
print("  discriminator schema: all required fields present")


# STEP 3: report
print("\n=== STEP 3: report ===")
r = run(["python3", TOOL, "report",
         "--act", "ACT-CLINEMM-HERMETIC-FIXTURE",
         "--capture-id", capture_id])
print(r.stdout)
if r.returncode != 0:
    sys.stderr.write(r.stderr)
    sys.exit(1)

report_json = resolved_dir / "report.json"
report_txt = resolved_dir / "report.txt"
assert report_json.exists()
assert report_txt.exists()
print(f"  report.json={report_json.stat().st_size}B  report.txt={report_txt.stat().st_size}B")

report_json_content = json.loads(report_json.read_text())
assert_eq(report_json_content["binding"], binding, "report.json binding != binding.json")
print("  stdout agrees with binding.json")

matrix = {
    "fixture_root": str(FIXTURE),
    "step1_begin": {
        "schema": pm["schema"],
        "approvalEventCount": ps["approvalEventCount"],
        "sessionCandidateCount": ps["sessionCandidateCount"],
        "fingerprintCount": len(pfp_lines),
        "sessionProjectionKeys": sorted(proj_keys),
    },
    "step2_finish": {
        "binding": binding,
        "delta_lines": len(delta_lines),
        "before_lines": len(before_lines),
        "after_lines": len(after_lines),
        "discriminator_items": len(discriminator["items"]),
        "delta_correlation_ids": sorted(delta_corr_ids),
    },
    "step3_report": {
        "report_json_bytes": report_json.stat().st_size,
        "report_txt_bytes": report_txt.stat().st_size,
        "binding_agrees_with_json": True,
    },
}
matrix_path = resolved_dir / "hermetic-verification-matrix.json"
matrix_path.write_text(json.dumps(matrix, indent=2))
print(f"\nMatrix: {matrix_path}")
