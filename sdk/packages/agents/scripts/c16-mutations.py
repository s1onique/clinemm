#!/usr/bin/env python3
"""
C1.6 mutation campaign — 12 surgical mutations against the
production source, each with APPLIED / KILLED / REVERTED
/ CLEAN evidence.

Run from the repo root:

    bun sdk/packages/agents/scripts/c16-mutations.py

Each mutation is a precise text replacement in
`sdk/packages/agents/src/agent-runtime.ts`. After every
mutation we run the targeted killer test, then revert via
the backup.

CORRECTION01:
    M6, M8, M10 originally MISSED because the
    mutations OR the killer tests were wrong (not
    redundant defenses). This rewrite fixes:
      M6: genuine typed-outcome → coarse-isError
          boundary regression, killer = real
          host-DENY parallel test (P3)
      M8: same suspension-disable mutation, but
          killer = P1 with the new event-atomicity
          assertion (exactly one armed→terminating
          event in the batch)
      M10: same run-start reset removal, but
          killer = same-runtime second run WITHOUT
          restore (the C1.4 lifecycle bug that
          motivated the run-start reset)
"""
from __future__ import annotations

import re
import subprocess
from pathlib import Path

# Repo-relative root: <-packages<-agents<-scripts<-mutations.py
ROOT = Path(__file__).resolve().parents[4]
SOURCE = ROOT / "sdk/packages/agents/src/agent-runtime.ts"
BACKUP = Path("/tmp/c16-mut-backup.ts")

REPORT: list[tuple] = []


def sh(cmd: str, **kwargs) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, shell=True, capture_output=True, text=True, cwd=ROOT, **kwargs)


def run_killer(name: str) -> str:
    """Run a vitest test by name and return PASS/FAIL/UNKNOWN."""
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
    SOURCE.write_text(BACKUP.read_text())


def run_mutation(
    mid: str,
    change_desc: str,
    old: str,
    new: str,
    killer_test: str,
) -> None:
    if not BACKUP.exists():
        BACKUP.write_text(SOURCE.read_text())
    revert()  # ensure clean start
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
    REPORT.append(
        (
            mid,
            change_desc,
            "APPLIED",
            killer_test,
            fail_count,
            pass_count,
            status,
            revert_status,
        )
    )


# ============================================================================
# M1 — bypass exact pre-exec gate (C1.3)
# The pre-exec gate is `isAttemptBlockedByRecovery` which
# checks `isExactBlockedIdentity`. Making that branch
# always false lets every same-path proposal execute,
# so the 4th same-path fs_read proposal runs the executor
# instead of being intercepted. Q1 expects calls=3.
# ============================================================================
run_mutation(
    "M1",
    "Bypass exact pre-exec gate: isAttemptBlockedByRecovery always returns false",
    "if (this.recoveryTracker.isExactBlockedIdentity(attemptIdentity)) {\n\t\t\treturn true;\n\t\t}",
    "if (false as boolean) {\n\t\t\treturn true;\n\t\t}",
    "Q1: X→ENOENT×3",
)

# ============================================================================
# M2 — remove terminal model-stream latch
# Without the throwing exit, `model.stream` would be
# called repeatedly after the latch is `terminating`,
# producing unbounded provider requests.
# ============================================================================
run_mutation(
    "M2",
    "Remove terminal model-stream latch: skip the throwing exit",
    'if (this.recoverySecondStage.kind === "terminating") {\n\t\t\tthrow new ControlledStopError("bounded_recovery_exhausted");\n\t\t}',
    '/* M2: model-stream latch removed */\n\t\tif (false as boolean) {\n\t\t\tthrow new ControlledStopError("bounded_recovery_exhausted");\n\t\t}',
    "Q3: opaque fresh inputs",
)

# ============================================================================
# M3 — remove Trigger B family-exhaustion arm
# Without the family-blocked arm, fresh-input ENOENTs
# never arm via Trigger B. Q5 (true registry miss)
# would fall through to Trigger D, terminating at 7
# requests instead of 4.
# ============================================================================
run_mutation(
    "M3",
    "Remove Trigger B family-exhaustion arm",
    'if (\n\t\t\tthis.recoverySecondStage.kind === "idle" &&\n\t\t\tthis.recoveryTracker\n\t\t\t\t.getBlockedFamilies()\n\t\t\t\t.includes(this.familyControlDiagnostic(familyIdentity))\n\t\t) {\n\t\t\tthis.recoverySecondStage = {\n\t\t\t\tkind: "armed",\n\t\t\t\ttrigger: "family_exhausted",\n\t\t\t};\n\t\t}',
    "/* M3: Trigger B arm removed */",
    "Q5: 12 fresh ghost",
)

# ============================================================================
# M4 — remove Trigger D episode-exhaustion arm (opaque path)
# Without the episode ceiling, opaque failures never arm
# via Trigger D. Q3 (all-distinct opaque) would NOT
# terminate; the model would be asked > 7 times.
# ============================================================================
run_mutation(
    "M4",
    "Remove Trigger D episode-exhaustion arm (opaque path)",
    '\t\t\tif (this.recoverySecondStage.kind === "idle") {\n\t\t\t\tthis.recoveryEpisodeFailures += 1;\n\t\t\t\tif (\n\t\t\t\t\tthis.recoveryEpisodeFailures >=\n\t\t\t\t\tthis.recoveryPolicy.maxRecoveryEpisodeFailures\n\t\t\t\t) {\n\t\t\t\t\tthis.recoverySecondStage = {\n\t\t\t\t\t\tkind: "armed",\n\t\t\t\t\t\ttrigger: "episode_exhausted",\n\t\t\t\t\t};\n\t\t\t\t}\n\t\t\t}',
    '\t\t\tif (false as boolean) {\n\t\t\t\t/* M4: Trigger D episode ceiling removed */\n\t\t\t}',
    "Q3: opaque fresh inputs",
)

# ============================================================================
# M5 — collapse opaque failures into shared family
# Anti-false-merge: every opaque failure must keep its
# distinct exact key. Using a constant key merges all
# distinct opaque failures into a single family, which
# Q3 doesn't expect. Q3 expects 7 requests / 7 calls /
# 6 episodeFailures; merging would change the count.
# ============================================================================
run_mutation(
    "M5",
    "Collapse opaque failures into shared 'unknown' family",
    "const key = attemptIdentity.controlKey;",
    'const key = "unknown-family-key-m5";',
    "Q3: opaque fresh inputs",
)

# ============================================================================
# M6 — restore legacy isError-based classification
# The C1.3 anti-pattern: a coarse `result.isError === true`
# check conflated `failure / recoverable` with
# `control_plane / host_policy_denied`. Replace the
# typed `classifyToolRuntimeOutcome` with a stub that
# returns `failure` whenever `result.isError` is true.
# P3 (real host-DENY through the approval seam) must
# fail because the host-DENY's result carries
# `isError: true` and the stub misclassifies it.
# ============================================================================
run_mutation(
    "M6",
    "Restore legacy isError-based classification (C1.3 anti-pattern)",
    '\t\tconst runtimeOutcome: ToolRuntimeOutcome =\n\t\t\tclassifyToolRuntimeOutcome(classificationInput);',
    '\t\tconst _typed: ToolRuntimeOutcome =\n\t\t\tclassifyToolRuntimeOutcome(classificationInput);\n\t\tconst runtimeOutcome: ToolRuntimeOutcome =\n\t\t\tresult && result.isError\n\t\t\t\t? {\n\t\t\t\t\t\tkind: "failure",\n\t\t\t\t\t\ttoolName: prepared.toolCall.toolName,\n\t\t\t\t\t\ttoolCallId: prepared.toolCall.toolCallId,\n\t\t\t\t\t\tfailureClass: "tool_execution_error",\n\t\t\t\t\t\tstableCode: { kind: "unknown", message: "mutation-m6" },\n\t\t\t\t\t\tfamilyConfidence: "fallback",\n\t\t\t\t\t\tfamilyEligible: false,\n\t\t\t\t\t}\n\t\t\t\t: _typed;  /* M6: legacy isError stub */',
    "P3: real requestToolApproval",
)

# ============================================================================
# M7 — remove parallel batch reconciliation
# Drop the post-batch `if (batchStartKind === armed &&`
# block so a parallel batch with an already-armed latch
# never flips to terminating. P2 (success-first in
# parallel batch with armed latch) must fail.
# ============================================================================
run_mutation(
    "M7",
    "Remove parallel batch reconciliation: never flip latch to terminating from batch",
    '\t\t\t\tif (\n\t\t\t\t\tbatchStartKind === "armed" &&\n\t\t\t\t\tthis.recoverySecondStage.kind !== "terminating" &&\n\t\t\t\t\tthis.batchContainsTypedFailure(this.pendingBatchOutcomes)\n\t\t\t\t) {',
    '\t\t\t\tif (false as boolean &&\n\t\t\t\t\tbatchStartKind === "armed" &&\n\t\t\t\t\tthis.recoverySecondStage.kind !== "terminating" &&\n\t\t\t\t\tthis.batchContainsTypedFailure(this.pendingBatchOutcomes)\n\t\t\t\t) {',
    "P2: success finishing first",
)

# ============================================================================
# M8 — emit per-tool parallel recovery transients
# Drop the suspension: per-tool mutations during
# `Promise.all` would emit intermediate recovery events
# that depend on completion order. P1 with the
# atomicity assertion (exactly one in-batch recovery
# event) must fail because sibling successes would
# emit `armed→idle` resets mid-batch.
# ============================================================================
run_mutation(
    "M8",
    "Emit per-tool parallel recovery transients (drop suspension)",
    "\t\t\tthis.recoveryEmissionSuspended = true;",
    "\t\t\tthis.recoveryEmissionSuspended = false; /* M8: suspension removed */",
    "P1: failure finishing first",
)

# ============================================================================
# M9 — expose raw control key
# Add a fake API-token sentinel to the projected
# recovery snapshot. The privacy test scans the
# recovery surface for the `FAKE-API-TOKEN-...` sentinel
# string and asserts it MUST NOT appear.
# ============================================================================
run_mutation(
    "M9",
    "Expose raw control key in recovery snapshot",
    "trackerSnapshot: this.recoveryTracker.snapshot(),",
    'trackerSnapshot: { ...this.recoveryTracker.snapshot(), currentFailureKey: "FAKE-API-TOKEN-DO-NOT-USE-X9Y8Z7W6V5U4T3" } as unknown as Parameters<typeof this.recoveryTracker.snapshot>[0],',
    "privacy: raw control",
)

# ============================================================================
# M10 — drop run-start reset
# Without `resetRecoveryEpisode()` at the start of
# `run()`, the second run on the same AgentRuntime
# inherits the first run's `terminating` state. The
# killer is the same-runtime second run WITHOUT
# `restore()` between runs — the lifecycle invariant
# that motivated the run-start reset in C1.4.
# ============================================================================
run_mutation(
    "M10",
    "Drop run-start reset: omit resetRecoveryEpisode() at start of run()",
    "\t\tconst recoveryBeforeReset = this.snapshotRecoveryState();\n\t\tthis.resetRecoveryEpisode();",
    "\t\tconst recoveryBeforeReset = this.snapshotRecoveryState();\n\t\t/* M10: run-start reset removed */",
    "(no restore)",
)

# ============================================================================
# M11 — drop restore reset event
# Comment out the synchronous listener loop in
# `restore()`. The upstream-compat test asserts that
# restoring into a fresh state fires a recovery
# event visible to subscribers; without the loop the
# event never fires.
# ============================================================================
run_mutation(
    "M11",
    "Drop restore reset event: no synchronous listener invocation in restore()",
    '\t\t\tfor (const listener of this.listeners) {\n\t\t\t\ttry {\n\t\t\t\t\tlistener(event as unknown as Parameters<AgentEventListener>[0]);\n\t\t\t\t} catch {\n\t\t\t\t\t// Observation must not become control — same C1.5\n\t\t\t\t\t// invariant as the async emit path.\n\t\t\t\t}\n\t\t\t}',
    '\t\t\t/* M11: restore listener loop removed */',
    "C15_RESTORE_UPSTREAM_COMPAT",
)

# ============================================================================
# M12 — make restore async again
# `restore()` was synchronous in C1.5 for upstream
# parity. Reintroducing async breaks the
# `restore()` returns void contract.
# ============================================================================
run_mutation(
    "M12",
    "Make restore async again",
    "restore(messages: readonly AgentMessage[]): void {",
    "async restore(messages: readonly AgentMessage[]): Promise<void> {",
    "C15_RESTORE_UPSTREAM_COMPAT",
)


# ============================================================================
# Report
# ============================================================================
print()
print("=" * 80)
print("C1.6 MUTATION CAMPAIGN — ACTUAL RESULTS (CORRECTION01)")
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
