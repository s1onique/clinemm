#!/usr/bin/env python3
"""
RSMT01 mutation campaign — 5 surgical mutations against the
production source, each with APPLIED / KILLED / REVERTED
/ CLEAN evidence.

Run from the repo root:

    bun sdk/packages/agents/scripts/c17-mutations.py

Each mutation is a precise text replacement in
`sdk/packages/agents/src/agent-runtime.ts`. After every
mutation we run the targeted killer test, then revert
via the backup.

Mutations:
  M1: drop the for-await finally clearing →
      RSM12 (failed run: ZERO_EXECUTION) fails
  M2: drop the post-batch pendingToolCalls clearing →
      RSM10 (abort during approval) fails
  M3: drop the requestToolApproval finally clearing →
      RSM10 (abort during approval) fails
  M4: drop the modelStreaming raise before the
      for-await → RSM02 (stream begins) fails
  M5: drop the run-start execution flag reset →
      RSM14b (next-run freshness without restore) fails
"""
from __future__ import annotations

import re
import subprocess
from pathlib import Path

# Repo-relative root: <-packages<-agents<-scripts<-mutations.py
ROOT = Path(__file__).resolve().parents[4]
SOURCE = ROOT / "sdk/packages/agents/src/agent-runtime.ts"
BACKUP = Path("/tmp/c17-mut-backup.ts")

REPORT = []


def sh(cmd: str, **kwargs):
    return subprocess.run(cmd, shell=True, capture_output=True, text=True, cwd=ROOT, **kwargs)


def run_killer(name: str) -> str:
    r = sh(f"bun run -F @cline/agents test -t '{name}' 2>&1")
    out = r.stdout + r.stderr
    last_test_line = ""
    for line in out.splitlines():
        if "Tests" in line:
            last_test_line = line
    if not last_test_line:
        return "UNKNOWN"
    m = re.search(r"(\d+)\s*failed", last_test_line)
    if m:
        return "FAIL" if int(m.group(1)) >= 1 else "PASS"
    if "passed" in last_test_line:
        return "PASS"
    return "UNKNOWN"


def apply(old: str, new: str) -> bool:
    src = SOURCE.read_text()
    if old not in src:
        return False
    SOURCE.write_text(src.replace(old, new, 1))
    return True


def revert() -> None:
    if not BACKUP.exists():
        return
    SOURCE.write_text(BACKUP.read_text())


def run_mutation(mid: str, change_desc: str, old: str, new: str, killer_test: str) -> None:
    if not BACKUP.exists():
        BACKUP.write_text(SOURCE.read_text())
    revert()
    applied = apply(old, new)
    if not applied:
        REPORT.append((mid, change_desc, "NOT_APPLIED", killer_test, "-", "-", "-", "-"))
        return
    result = run_killer(killer_test)
    fail_count = 1 if result == "FAIL" else 0
    pass_count = 0 if result == "FAIL" else 1
    status = "KILLED" if result == "FAIL" else ("MISSED" if result == "PASS" else "UNKNOWN")
    revert()
    revert_status = "REVERTED_CLEAN"
    if SOURCE.read_text() != BACKUP.read_text():
        revert_status = "REVERT_FAILED"
    REPORT.append((mid, change_desc, "APPLIED", killer_test, fail_count, pass_count, status, revert_status))


# ----------------------------------------------------------------------------
# M1 — drop the for-await finally clearing. The I1 invariant
# requires terminal lifecycle ⇒ all flags false. Without the
# finally, modelStreaming stays true after the stream settles,
# so RSM12 (failed run: ZERO_EXECUTION) fails.
# ----------------------------------------------------------------------------
run_mutation(
    "M1",
    "Drop the for-await finally clearing: modelStreaming stays true after the stream settles",
    "\t\t} finally {\n\t\t\t// RSMT01: clear modelStreaming on every exit path\n\t\t\t// (normal completion, abort, throw). Restores\n\t\t\t// the I1 invariant for any terminal lifecycle\n\t\t\t// that follows this turn.\n\t\t\tthis.state.executionModelStreaming = false;\n\t\t}",
    "\t\t} finally {\n\t\t\t/* M1: stream-finally clearing removed */\n\t\t}",
    "RSM12",
)

# ----------------------------------------------------------------------------
# M2 — drop the post-batch pendingToolCalls clearing. The
# tooling flag derives from pendingToolCalls.length > 0, so
# without the clearing the IDs persist and tooling stays true
# after the batch ends. RSM10 (abort during approval) catches
# the stale tooling after abort.
# ----------------------------------------------------------------------------
run_mutation(
    "M2",
    "Drop pendingToolCalls clearing in parallel batch: stale tools count as in-flight",
    "\t\t\t\tconst toolMessages = await this.executeToolCalls(toolCalls);\n\t\t\t\tthis.state.pendingToolCalls = [];",
    "\t\t\t\tconst toolMessages = await this.executeToolCalls(toolCalls);\n\t\t\t\t/* M2: pendingToolCalls clearing removed */",
    "RSM10",
)

# ----------------------------------------------------------------------------
# M3 — drop the requestToolApproval finally clearing. The
# I2 invariant requires awaitingApproval ⇒ status === "running".
# Without the finally, awaitingApproval stays true after the
# decision is observed. RSM10 (abort during approval) catches
# the stale approval flag after abort.
# ----------------------------------------------------------------------------
run_mutation(
    "M3",
    "Forget to clear awaitingApproval after decision: drop the finally in requestToolApproval",
    "\t\t} finally {\n\t\t\tthis.state.executionAwaitingApproval = false;\n\t\t}",
    "\t\t} /* M3: finally removed */",
    "RSM10",
)

# ----------------------------------------------------------------------------
# M4 — drop the modelStreaming raise before the for-await.
# Without the raise, observers subscribing to snapshot()
# mid-stream see modelStreaming=false while the for-await is
# actually parked. RSM02 catches this.
# ----------------------------------------------------------------------------
run_mutation(
    "M4",
    "Skip the modelStreaming raise before the for-await: events observe stale state",
    "\t\tthis.state.executionModelStreaming = true;\n\t\ttry {\n\t\tfor await (const event of stream) {",
    "\t\ttry {\n\t\tfor await (const event of stream) { /* M4: raise removed */",
    "RSM02",
)

# ----------------------------------------------------------------------------
# M5 — drop the run-start execution flag reset. The C1.4
# lifecycle invariant requires the run-start to clear
# recovery state; RSMT01 extends that to the execution
# flags. RSM14b (next-run freshness without restore) is the
# natural killer — the original RSM14 calls restore()
# between runs, which masks the run-start reset.
# ----------------------------------------------------------------------------
run_mutation(
    "M5",
    "Drop the run-start execution-flag reset: prior run flags leak across run boundary",
    "// leak across the run boundary. Pinned by RSM14.\n\t\tthis.state.executionModelStreaming = false;\n\t\tthis.state.executionAwaitingApproval = false;",
    "// leak across the run boundary. Pinned by RSM14.\n\t\t/* M5: run-start reset removed */",
    "RSM14b",
)


# ----------------------------------------------------------------------------
# Report
# ----------------------------------------------------------------------------
print()
print("=" * 80)
print("RSMT01 MUTATION CAMPAIGN — ACTUAL RESULTS")
print("=" * 80)
print(f"{'ID':<5} {'APPLIED':<11} {'KILLER':<42} {'FAIL':<5} {'STATUS':<14} {'REVERT':<14}")
print("-" * 95)
for row in REPORT:
    mid, desc, applied, killer, fail_count, pass_count, status, revert_status = row
    killer_disp = killer if applied == "NOT_APPLIED" else killer[:40]
    print(
        f"{mid:<5} {applied:<11} {killer_disp:<42} {str(fail_count):<5} "
        f"{status:<14} {revert_status:<14}"
    )
print()
kill_count = sum(1 for r in REPORT if r[6] == "KILLED")
missed = sum(1 for r in REPORT if r[6] == "MISSED")
na = sum(1 for r in REPORT if r[2] == "NOT_APPLIED")
applied = sum(1 for r in REPORT if r[2] == "APPLIED")
print(f"TOTAL: {len(REPORT)}, APPLIED: {applied}, KILLED: {kill_count}, MISSED: {missed}, NOT_APPLIED: {na}")
print()

# Cleanup
BACKUP.unlink(missing_ok=True)
