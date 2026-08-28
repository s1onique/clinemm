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
proj_identity_values = set()
for rec in pi:
    if isinstance(rec.get("projection"), dict):
        proj_keys.update(rec["projection"].keys())
        for k, v in rec["projection"].items():
            if k in ("id", "sessionId", "session_id", "taskId", "task_id") and v is not None:
                proj_identity_values.add(str(v))
print(f"  session projection keys: {sorted(proj_keys)[:8]}")
print(f"  captured session identities: {sorted(proj_identity_values)}")

# Tightened P1 invariant: the fixture session uses ONLY `session_id`
# (no `sessionId`/`taskId` aliases), so the projection MUST contain
# `session_id` with value `snake-only-A`. If the projection allowlist
# still drops snake_case fields, this assertion fires.
assert "session_id" in proj_keys, \
    f"P1 defect: projection missing 'session_id'. keys={sorted(proj_keys)}"
assert "snake-only-A" in proj_identity_values, \
    f"P1 defect: 'snake-only-A' missing from projected identities. got={sorted(proj_identity_values)}"
# And the projection must NOT have phantom aliases the fixture never set:
proj_session_keys = proj_keys & {"session_id", "sessionId", "taskId", "task_id", "id"}
assert proj_session_keys <= {"session_id"}, \
    f"fixture only sets session_id; projection contained extra aliases: {proj_session_keys}"
print("  P1 closed (snake_case projection proven, no phantom aliases)")
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
      f"ARTIFACT_STATUS={fs['ARTIFACT_STATUS']} "
      f"RUNTIME_IDENTITY_BOUND={fs.get('RUNTIME_IDENTITY_BOUND')}")
assert_eq(fs["CAPTURE_ID"], capture_id, "CAPTURE_ID mismatch")
assert_eq(int(fs["NEW_EVENTS"]), 2, "expected 2 new events (pair B)")
assert_eq(fs["SPECIMEN_BINDING"], "PASS", "SPECIMEN_BINDING")
assert_eq(fs["ARTIFACT_STATUS"], "PASS", "ARTIFACT_STATUS")
assert_eq(fs.get("RUNTIME_IDENTITY_BOUND"), "YES", "RUNTIME_IDENTITY_BOUND")
print("  CAPTURE_ID bound (begin == finish)")
print("  P0.2: NEW_EVENTS=2 (pair B)")
print("  P0.3: SPECIMEN_BINDING=PASS (identity join succeeded)")
print("  P0 closure: RUNTIME_IDENTITY_BOUND=YES (snake_case identity joined)")

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
      f"runtimeIdentityBound={binding['runtimeIdentityBound']} "
      f"approvalTransactionBound={binding['approvalTransactionBound']} "
      f"qualifyingTransactionCount={binding['qualifyingTransactionCount']}")
print(f"  delta={len(delta_lines)} before={len(before_lines)} after={len(after_lines)} "
      f"discriminator_items={len(discriminator['items'])}")

assert_eq(binding["schema"], "cline-approval-specimen-binding/v1", "binding schema")
assert_eq(binding["artifactStatus"], "PASS", "artifactStatus")
assert_eq(binding["specimenBinding"], "PASS", "specimenBinding")
assert binding["sessionBindingAvailable"] is True
assert binding["eventDeltaBound"] is True
assert binding["runtimeIdentityBound"] is True
assert binding["approvalTransactionBound"] is True, \
    "approvalTransactionBound must be True (exactly one qualifying transaction in happy fixture)"
assert_eq(binding["qualifyingTransactionCount"], 1, "qualifyingTransactionCount")
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
print("  P0 verified: identity join (session_id=snake-only-A) succeeded")

# The discriminator must carry the snake_case sessionId for every delta
# event. This is the per-event identity that the runtimeIdentityBound
# check joined against the captured projection.
disc_session_ids = {item.get("sessionId") for item in discriminator["items"]}
print(f"  discriminator sessionIds={sorted(disc_session_ids)}")
assert_eq(disc_session_ids, {"snake-only-A"},
          "discriminator sessionId (every event must carry snake_case identity)")
print("  P1 verified: discriminator sessionId populated from snake_case event field")

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
        "captured_session_identities": sorted(proj_identity_values),
    },
    "step2_finish": {
        "binding": binding,
        "delta_lines": len(delta_lines),
        "before_lines": len(before_lines),
        "after_lines": len(after_lines),
        "discriminator_items": len(discriminator["items"]),
        "delta_correlation_ids": sorted(delta_corr_ids),
        "discriminator_session_ids": sorted(disc_session_ids),
        "runtime_identity_bound": binding["runtimeIdentityBound"],
        "approval_transaction_bound": binding["approvalTransactionBound"],
        "qualifying_transaction_count": binding["qualifyingTransactionCount"],
        "P0_closure": "identity_join(snake_case session_id=snake-only-A) succeeded",
        "P1_closure": "snake_case projection proven (fixture session uses session_id only)",
        "P0x_closure": "exactly_one_qualifying_transaction(corr-B) identified human action",
    },
    "step3_report": {
        "report_json_bytes": report_json.stat().st_size,
        "report_txt_bytes": report_txt.stat().st_size,
        "binding_agrees_with_json": True,
    },
}
matrix_path = resolved_dir / "hermetic-verification-matrix.json"
matrix_path.write_text(json.dumps(matrix, indent=2) + "\n")
print(f"\nMatrix: {matrix_path}")
