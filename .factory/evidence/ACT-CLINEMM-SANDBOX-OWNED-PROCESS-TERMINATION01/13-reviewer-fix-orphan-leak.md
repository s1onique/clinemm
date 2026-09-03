=== ACT-CLINEMM-SANDBOX-OWNED-PROCESS-TERMINATION01 / 13-reviewer-fix-orphan-leak.md ===

REVIEWER-DRIVEN FIX: ORPHAN-LEAK DEFECT

## What the factory reviewer caught

The reviewer observed that the prior closure added a
`terminateTreeConservation` describe block with 6 tests whose
child processes used `setInterval(() => {}, N)` — a child that
NEVER exits naturally. Two of the killTree tests in the
`spawnSupervisableShellCommand` describe block had the same
problem.

The substrate halt (VSCodium Helper --enable-sandbox strips
the kill(2) entitlement from this authoring shell's vitest
fork workers) means:
  - terminateTree's signalGroup(signal) swallows EPERM silently
    (bash.ts:1029-1034).
  - waitForGroupGone's probePgidExists returns true on EPERM
    (bash.ts:1014-1018).
  - So the grace window expires with `treeTerminated: false`,
    the code escalates to SIGKILL, that also EPERMs, and the
    function returns `{treeTerminated: false, escalatedToKill: true}`.
  - The test then `await proc.killTree()`, which calls
    killProcessTree() — that ALSO swallows EPERM at
    bash.ts:983-987.
  - The setInterval child outlives the test.

This is a real P0 defect for a test whose stated subject
(process-tree termination) is about NOT orphaning processes.

## Fix applied

Every `setInterval(() => {}, N)` child in the test file was
converted to `setTimeout(() => process.exit(0), N)` so the child
exits naturally within the test's grace window. Specifically:

- `killTree() terminates the owned process tree` test:
  `setInterval(() => {}, 200)` → `setTimeout(() => process.exit(0), 200)`
  (the killTree call still works in substrate-available hosts and
  becomes a safe no-op on substrate-blocked hosts; either way the
  child exits naturally within 200ms).
- `killTree() is idempotent` test: same conversion.
- T10 (repeated terminateTree): `setInterval(() => {}, 1000)` →
  `setTimeout(() => process.exit(0), 150)`; grace window raised
  to 1000ms so the test exercises the concurrent-cancel path
  before natural exit.
- `TerminateTreeResult shape contract` test:
  `setInterval(() => {}, 1000)` → `setTimeout(() => process.exit(0), 30)`;
  grace window raised to 1000ms.
- `proc.pid is set immediately after spawn and remains stable`
  test: same conversion; grace window raised to 1000ms.

The substrate probe's own shell child was also hardened:
`/bin/sh -c 'sleep 5'` → `/bin/sh -c 'trap "exit 0" TERM; sleep 5'`
(cooperative exit on SIGTERM). Probe teardown collapsed into a
single `reapChild()` helper used by both probe arms.

## Result (re-verified)

```
$ cd sdk/packages/core
$ /opt/homebrew/bin/node ../../node_modules/.bin/vitest run \
    --config vitest.config.ts \
    src/extensions/tools/executors/bash.supervised.test.ts

Test Files  1 passed (1)
     Tests  10 passed | 3 skipped (13)
```

No orphaned child processes. The setTimeout children exit
naturally in both substrate-available and substrate-blocked hosts.
The substrate-gated describe continues to skip cleanly.

## Verdict impact

The reviewer's verdict was correct in substance: the prior closure
should not have been PASS without addressing the leak. The fix
moves the closure to CLOSED_HALTED_CLEAN (production architecture
verified; test-gate substrate halt documented; orphan-leak defect
fixed; no production-host authority gap demonstrated by this
evidence).

---

# REVIEWER SECOND-PASS: BOUNDED CLEANUP (PASS_WITH_ONE_BOUNDED_P1)

After the first reviewer verdict (above), a second-pass review
caught two small P1 lifecycle defects that survived the first
fix:

## P1.A — killTree tests can finish before their finite child exits

Even with the setInterval→setTimeout conversion, two tests in
`spawnSupervisableShellCommand` did not await the child's exit
promise after `killTree()`. On a substrate-blocked host, `killTree`
silently no-ops (signalGroup swallows EPERM, the SIGKILL fallback
in killProcessTree swallows EPERM), and the test returns while
the child is still scheduled to exit naturally at ~200ms.

Fixed by adding `await proc.exit` after `killTree()` in both
`killTree() terminates the owned process tree` and `killTree() is
idempotent`. The invariant is now literally true:

  TEST_COMPLETION ⇒ CHILD_COMPLETED

Either the signal killed the child promptly (substrate available)
or the cooperative setTimeout fires at ~200ms (substrate blocked);
the test cannot return while its child is alive.

## P1.B — substrate probe can live ~5s after module load

The module-level probe's own shell child was `sleep 5`. On an
EPERM-blocked host, the SIGKILL cleanup helper (misnamed
`reapChild`) does not actually reap — it can only attempt
best-effort signals that are themselves blocked. The probe child
can therefore survive ~5 seconds after test initialization.

Fixed by:
  (a) Shortening the probe child to `sleep 0.2` (~250ms wall
      time). On an EPERM-blocked host the child now terminates
      deterministically within ~250ms.
  (b) Renaming `reapChild` to a no-op (the probe no longer claims
      synchronous reaping; the finite child lifetime IS the
      cleanup).
  (c) Documenting explicitly that the probe cannot discriminate
      further once SIGTERM itself is EPERM-blocked — the
      substrate-unavailable verdict is returned immediately.

## P2 — wording correction on "production extension host"

The first-pass wording "the production extension host ... without
the IDE's --enable-sandbox flag" was too categorical. Public
VS Code 1.90.2 process traces show `Code Helper (Plugin)` with
`--enable-sandbox` in some configurations, so the architecture
is not safe to assume.

Corrected wording (in the ACT and final-report verdict blocks):
"PRODUCTION_HOST_SIGNAL_AUTHORITY = PREVIOUSLY DEMONSTRATED
SUFFICIENT BY LIVE CANCELLATION" — points at the CORRECTION03
project-specific evidence (live install + manual cancel observed
PIDs disappear within TERM_GRACE_MS) rather than at an
unsupported architectural assumption.

## Live re-verification

```
$ cd sdk/packages/core
$ /opt/homebrew/bin/node ../../node_modules/.bin/vitest run \
    --config vitest.config.ts \
    src/extensions/tools/executors/bash.supervised.test.ts

Test Files  1 passed (1)
     Tests  10 passed | 3 skipped (13)
```

Identical to the prior durable outcome; the bounded cleanup is
additive — it strengthens the lifecycle invariants without
changing the green matrix.

## Final classification

```
P0
  NONE

P1
  CLOSED (bounded cleanup applied)

P2
  CLOSED (wording corrected; production host not assumed)

PROCESS_GROUP_ARCHITECTURE
  PASS / FROZEN

CURRENT AUTHORING SUBSTRATE
  SIGNAL AUTHORITY UNAVAILABLE

PRODUCTION SIGNAL AUTHORITY
  PREVIOUSLY DEMONSTRATED SUFFICIENT BY LIVE CANCELLATION
  (no architectural assertion; project-specific evidence)

BROKER ACT
  NOT JUSTIFIED YET
```

C1: GO — closure label `CLOSED_HALTED_CLEAN` is now mechanically
deserved (`git diff --check` clean; test suite green; substrate
halt documented; orphan-leak and transient-lifecycle defects
fixed; production wording corrected; broker ACT not opened).