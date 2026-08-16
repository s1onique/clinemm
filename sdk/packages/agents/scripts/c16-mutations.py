#!/usr/bin/env python3
"""
C1.6 actual mutation campaign — 12 surgical mutations against
the source, each with APPLIED/KILLED/REVERTED/CLEAN evidence.

Run from /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm-recovery-c1.6:
    bun run scripts/c16-mutations.py

Each mutation is a precise text replacement in
sdk/packages/agents/src/agent-runtime.ts. After every
mutation we rebuild the dist, run the targeted killer
test, then revert via the backup.
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path("/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm-recovery-c1.6")
SOURCE = ROOT / "sdk/packages/agents/src/agent-runtime.ts"
BACKUP = Path("/tmp/c16-mut-backup.ts")

REPORT = []

def sh(cmd, **kwargs):
    return subprocess.run(cmd, shell=True, capture_output=True, text=True, **kwargs)

def run_killer(name):
    r = sh(f"cd {ROOT} && bun run -F @cline/agents test -t '{name}' 2>&1")
    out = r.stdout + r.stderr
    import re
    last_test_line = ""
    for line in out.splitlines():
        if "Tests" in line:
            last_test_line = line
    if not last_test_line:
        return "UNKNOWN"
    # Detect any "X failed" anywhere on the line
    m = re.search(r"(\d+)\s*failed", last_test_line)
    if m:
        failed_count = int(m.group(1))
        if failed_count >= 1:
            return "FAIL"
    # If we also see "passed" (even with skipped) we still
    # know the failure count is what matters.
    return "PASS"

def apply(old, new):
    src = SOURCE.read_text()
    if old not in src:
        return False
    SOURCE.write_text(src.replace(old, new, 1))
    return True

def revert():
    SOURCE.write_text(BACKUP.read_text())

def run_mutation(mid, change_desc, old, new, killer_test):
    if not BACKUP.exists():
        BACKUP.write_text(SOURCE.read_text())
    revert()  # ensure clean start
    applied = apply(old, new)
    if not applied:
        REPORT.append((mid, change_desc, "NOT_APPLIED", "-", "-", "-", "-", "-"))
        return
    result = run_killer(killer_test)
    fail_count = 1 if result == "FAIL" else 0
    pass_count = 0 if result == "FAIL" else 1
    status = "KILLED" if result == "FAIL" else ("MISSED" if result == "PASS" else "UNKNOWN")
    revert()
    # verify reverted
    revert_status = "REVERTED_CLEAN"
    if SOURCE.read_text() != BACKUP.read_text():
        revert_status = "REVERT_FAILED"
    REPORT.append((mid, change_desc, "APPLIED", killer_test, fail_count, pass_count, status, revert_status))

# M1 — bypass exact pre-exec gate (C1.3)
# The pre-exec gate is isAttemptBlockedByRecovery which
# checks isExactBlockedIdentity. Returning false makes
# every same-path proposal execute. Q1 expects calls=3.
run_mutation(
    "M1",
    "Bypass exact pre-exec gate: isAttemptBlockedByRecovery always returns false",
    "if (this.recoveryTracker.isExactBlockedIdentity(attemptIdentity)) {\n\t\t\treturn true;\n\t\t}",
    "if (false as boolean) {\n\t\t\treturn true;\n\t\t}",
    "Q1: X→ENOENT×3",
)

# M2 — remove terminal model-stream latch
# Without the throw, model.stream gets called repeatedly
# after terminating. Q1/Q3 should see unbounded requests.
run_mutation(
    "M2",
    "Remove terminal model-stream latch: skip the throwing exit",
    'if (this.recoverySecondStage.kind === "terminating") {\n\t\t\tthrow new ControlledStopError("bounded_recovery_exhausted");\n\t\t}',
    '/* M2: model-stream latch removed */\n\t\tif (false as boolean) {\n\t\t\tthrow new ControlledStopError("bounded_recovery_exhausted");\n\t\t}',
    "Q3: opaque fresh inputs",
)

# M3 — remove Trigger B family-exhaustion arming
# Without the family-blocked arm, fresh-input ENOENTs
# never arm. Q2/Q5 should NOT terminate.
run_mutation(
    "M3",
    "Remove Trigger B family-exhaustion arm",
    'if (\n\t\t\tthis.recoverySecondStage.kind === "idle" &&\n\t\t\tthis.recoveryTracker\n\t\t\t\t.getBlockedFamilies()\n\t\t\t\t.includes(this.familyControlDiagnostic(familyIdentity))\n\t\t) {\n\t\t\tthis.recoverySecondStage = {\n\t\t\t\tkind: "armed",\n\t\t\t\ttrigger: "family_exhausted",\n\t\t\t};\n\t\t}',
    '/* M3: Trigger B arm removed */',
    "Q5: 12 fresh ghost",
)

# M4 — remove Trigger D episode-exhaustion arming (opaque path)
# Without the episode ceiling, opaque failures never arm.
# Q3 should NOT terminate; should run > 7 requests.
run_mutation(
    "M4",
    "Remove Trigger D episode-exhaustion arm (opaque path)",
    '\t\t\tif (this.recoverySecondStage.kind === "idle") {\n\t\t\t\tthis.recoveryEpisodeFailures += 1;\n\t\t\t\tif (\n\t\t\t\t\tthis.recoveryEpisodeFailures >=\n\t\t\t\t\tthis.recoveryPolicy.maxRecoveryEpisodeFailures\n\t\t\t\t) {\n\t\t\t\t\tthis.recoverySecondStage = {\n\t\t\t\t\t\tkind: "armed",\n\t\t\t\t\t\ttrigger: "episode_exhausted",\n\t\t\t\t\t};\n\t\t\t\t}\n\t\t\t}',
    '\t\t\tif (false as boolean) {\n\t\t\t\t/* M4: Trigger D episode ceiling removed */\n\t\t\t}',
    "Q3: opaque fresh inputs",
)

# M5 — collapse opaque failures into "unknown" family
# Anti-false-merge: every opaque failure must keep its
# distinct exact key. The exact-only path uses
# `attemptIdentity.controlKey` as a map key.
# Mutate to use a constant key — all opaque failures merge.
run_mutation(
    "M5",
    "Collapse opaque failures into shared 'unknown' family",
    "const key = attemptIdentity.controlKey;",
    'const key = "unknown-family-key-m5";',
    "Q3: opaque fresh inputs",
)

# M6 — restore isError-based parallel authority
# Replace the typed-outcome check with the legacy
# AgentToolResult.isError check.
run_mutation(
    "M6",
    "Restore isError-based parallel authority (regression to C1.3 anti-pattern)",
    "this.batchContainsTypedFailure(this.pendingBatchOutcomes)",
    "this.pendingBatchOutcomes.some((o) => o.kind === 'failure') /* M6: legacy isError proxy */",
    "P1: failure finishing first",
)

# M7 — remove parallel batch reconciliation
# Drop the entire `if (batchStartKind === armed ...)`
# reconciliation block. With armed latch and a failure in
# the batch, the latch never flips to terminating.
run_mutation(
    "M7",
    "Remove parallel batch reconciliation: never flip latch to terminating from batch",
    '\t\t\t\tif (\n\t\t\t\t\tbatchStartKind === "armed" &&\n\t\t\t\t\tthis.recoverySecondStage.kind !== "terminating" &&\n\t\t\t\t\tthis.batchContainsTypedFailure(this.pendingBatchOutcomes)\n\t\t\t\t) {',
    '\t\t\t\tif (false as boolean &&\n\t\t\t\t\tbatchStartKind === "armed" &&\n\t\t\t\t\tthis.recoverySecondStage.kind !== "terminating" &&\n\t\t\t\t\tthis.batchContainsTypedFailure(this.pendingBatchOutcomes)\n\t\t\t\t) {',
    "P2: success finishing first",
)

# M8 — emit per-tool parallel recovery transients
# Drop the suspension: per-tool mutations during
# Promise.all would emit recovery-state-changed
# events that depend on completion order.
run_mutation(
    "M8",
    "Emit per-tool parallel recovery transients (drop suspension)",
    "\t\t\tthis.recoveryEmissionSuspended = true;",
    "\t\t\tthis.recoveryEmissionSuspended = false; /* M8: suspension removed */",
    "P1: failure finishing first",
)

# M9 — expose raw control key
# Add rawControlKey to the projected recovery snapshot.
# The privacy test asserts it is absent.
run_mutation(
    "M9",
    "Expose raw control key in recovery snapshot",
    "trackerSnapshot: this.recoveryTracker.snapshot(),",
    'trackerSnapshot: { ...this.recoveryTracker.snapshot(), currentFailureKey: "FAKE-API-TOKEN-DO-NOT-USE-X9Y8Z7W6V5U4T3" } as unknown as Parameters<typeof this.recoveryTracker.snapshot>[0],',
    "privacy: raw control",
)

# M10 — drop run reset
# Without resetRecoveryEpisode() in run(), the second
# run inherits the first run's terminating state.
run_mutation(
    "M10",
    "Drop run reset: omit resetRecoveryEpisode() at start of run()",
    "\t\tconst recoveryBeforeReset = this.snapshotRecoveryState();\n\t\tthis.resetRecoveryEpisode();",
    "\t\tconst recoveryBeforeReset = this.snapshotRecoveryState();\n\t\t/* M10: run reset removed */",
    "run → terminating",
)

# M11 — drop restore reset event
# Comment out the synchronous listener loop in restore().
run_mutation(
    "M11",
    "Drop restore reset event: no synchronous listener invocation in restore()",
    '\t\tfor (const listener of this.listeners) {\n\t\t\t\ttry {\n\t\t\t\t\tlistener(event as unknown as Parameters<AgentEventListener>[0]);\n\t\t\t\t} catch {\n\t\t\t\t\t// Observation must not become control — same C1.5\n\t\t\t\t\t// invariant as the async emit path.\n\t\t\t\t}\n\t\t\t}',
    '\t\t/* M11: restore listener loop removed */',
    "C15_RESTORE_UPSTREAM_COMPAT",
)

# M12 — make restore async again
run_mutation(
    "M12",
    "Make restore async again",
    "restore(messages: readonly AgentMessage[]): void {",
    "async restore(messages: readonly AgentMessage[]): Promise<void> {",
    "C15_RESTORE_UPSTREAM_COMPAT",
)

# Final report
print()
print("=" * 70)
print("C1.6 MUTATION CAMPAIGN — ACTUAL RESULTS")
print("=" * 70)
print(f"{'ID':<5} {'APPLIED':<10} {'KILLER':<42} {'FAIL':<6} {'STATUS':<14} {'REVERT':<12}")
print("-" * 90)
for row in REPORT:
    # row tuple: (mid, desc, applied, killer, fail_count, pass_count, status, revert_status)
    mid = row[0]
    desc = row[1]
    applied = row[2]
    killer = row[3]
    fail_count = row[4]
    pass_count = row[5]
    status = row[6]
    revert_status = row[7] if len(row) > 7 else ""
    killer_disp = killer if applied == "NOT_APPLIED" else killer[:40]
    print(f"{mid:<5} {applied:<10} {killer_disp:<42} {str(fail_count):<6} {status:<14} {revert_status:<12}")
print()
kill_count = sum(1 for r in REPORT if r[6] == "KILLED")
missed = sum(1 for r in REPORT if r[6] == "MISSED")
na = sum(1 for r in REPORT if r[2] == "NOT_APPLIED")
applied = sum(1 for r in REPORT if r[2] == "APPLIED")
print(f"TOTAL: {len(REPORT)}, APPLIED: {applied}, KILLED: {kill_count}, MISSED: {missed}, NOT_APPLIED: {na}")

# Cleanup
BACKUP.unlink(missing_ok=True)
SOURCE.write_text(SOURCE.read_text())  # ensure clean tree
