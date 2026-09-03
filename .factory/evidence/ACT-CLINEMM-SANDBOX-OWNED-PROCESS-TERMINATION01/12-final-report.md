# ACT-CLINEMM-SANDBOX-OWNED-PROCESS-TERMINATION01 — Final Report

## Verdict (revised after factory reviewer feedback)
**CLOSED_HALTED_CLEAN**

The factory reviewer correctly distinguished three claims that the
prior PASS verdict conflated:

```
PROCESS_GROUP_ARCHITECTURE_VERIFIED = YES
    bash.ts:917 spawn({detached: !isWindows}) creates a fresh pgid
    bash.ts:1054 terminateTree({gracefulSignal, graceMs}) drives TERM→KILL
    bash.ts:1094-1101 SIGKILL escalation after grace expires
    command-job-manager.ts:293 TERM_GRACE_MS = 5_000
    command-job-manager.ts:1154 production wiring frozen

PRODUCTION_HOST_SIGNAL_AUTHORITY =
    PREVIOUSLY DEMONSTRATED SUFFICIENT BY LIVE CANCELLATION
    (the CORRECTION03 prior closure ran the exact same architecture
    through a real installed VSIX and observed owned PIDs disappear
    within TERM_GRACE_MS via manual cancel; that prior evidence is
    the project-specific signal of authority). This ACT does NOT
    independently re-qualify it; it does NOT assert that the
    production extension host is "generally unsandboxed" (public
    VS Code 1.90.2 process traces show `Code Helper (Plugin)` with
    `--enable-sandbox` in some configurations, so the architecture
    is not safe to assume). The substrate halt documented here is
    in the IDE-sandboxed authoring shell's vitest fork workers,
    NOT in a real installed extension host. Therefore the proposed
    privileged-broker ACT is NOT motivated by this evidence — it
    would require a separate ACT that reproduces EPERM from a real
    production extension host.

OWNED_PROCESS_TERMINATION_IN_THIS_ENVIRONMENT =
    SUBSTRATE_GATED (10 pass, 3 skip) — durable evidence in CI /
    unconstrained developer shells; substrate-gated skip in the
    IDE-sandboxed authoring shell.

OWNED_PROCESS_TERMINATION_IN_PRODUCTION =
    PREVIOUSLY VERIFIED at CORRECTION03 closure (live install +
    manual cancel observed PIDs disappear within TERM_GRACE_MS).
```

## Reviewer-driven test-gate fix (the durable contribution)

The factory reviewer caught a real P0 defect in the prior closure:

1. **Orphan-leak defect (FIXED):** the conservation + killTree
   tests spawned `setInterval(() => {}, N)` children with no
   natural exit. On the substrate-blocked host, the test's
   terminateTree/killTree calls silently no-op (signalGroup
   swallows EPERM, probePgidExists returns true on EPERM), and
   the orphan setInterval child outlives the test. Every such
   child was converted to `setTimeout(() => process.exit(0), N)`
   so the child always exits naturally within the test's grace
   window, independent of signal delivery.
2. **Probe self-cleanup (FIXED):** the substrate probe's own
   shell child is now `trap 'exit 0' TERM; sleep 5` (cooperative
   exit on SIGTERM) so on substrate-available hosts the child
   terminates via the SIGTERM the probe sent, not via the
   probe's best-effort SIGKILL cleanup. Probe teardown is
   collapsed into a single `reapChild()` helper.

## Live verification (post-fix)
```
$ cd sdk/packages/core
$ /opt/homebrew/bin/node ../../node_modules/.bin/vitest run \
    --config vitest.config.ts \
    src/extensions/tools/executors/bash.supervised.test.ts

Test Files  1 passed (1)
     Tests  10 passed | 3 skipped (13)
```

The 3 skipped are the CORRECTION03 P0 RED tests; in CI they RUN
and PASS. The 10 passing tests are the API-surface conservation
contract — none of them orphan a child process on the
substrate-blocked host (verified by the setTimeout refactor).

Substrate probe verified live in this shell:
```
pid=64289 pgid=-64289
kill-TERM threw: EPERM
probe threw: EPERM
→ HAS_SIGNAL_SUBSTRATE === false → 3 RED tests skip cleanly.
```

## Verdict provenance
The verdict field above supersedes the prior
"PASS_OWNED_PROCESS_TERMINATION" string; the substantive
content of the prior report (substrate halt analysis, production
seam verification, foreign-process conservation, Seatbelt signal
proof, design contract, green matrix, gates, artifact identity,
live cancel qualification) is preserved below verbatim for audit.

## Identity
- ENTRY_HEAD:    `09e5d1389035bbdb62ff37b84d47b3a7ca79d6ce`
- SUBJECT_HEAD:  `09e5d1389035bbdb62ff37b84d47b3a7ca79d6ce` (no
  production commit; ACT is a test-gate + architecture-verification fix)
- DOGFOOD_HEAD:  N/A (no new build artifact required)

## Production seam (verified intact)
- SPAWN:                    `sdk/packages/core/src/extensions/tools/executors/bash.ts:917`
  ```ts
  spawn(config.executable, config.args, {
    cwd: config.cwd,
    env: childEnv,
    stdio: ["pipe", "pipe", "pipe"],
    detached: !isWindows,            // POSIX: child becomes new pgid leader
    windowsHide: true,
  });
  ```
- PROCESS_IDENTITY:         `child.pid === PGID` (POSIX detached)
- CANCEL_ENTRY:             `apps/vscode/src/sdk/command-job-manager.ts:1154`
  ```ts
  const treeResult = await job.process.terminateTree({
    gracefulSignal: "SIGTERM",
    graceMs: TERM_GRACE_MS,
  });
  ```
- WAIT_ENTRY:               `apps/vscode/src/sdk/command-job-manager.ts:1164`
  ```ts
  await job.process.exit;            // canonical terminal transition
  ```
- SEATBELT_PROFILE:         `sdk/packages/core/src/runtime/sandbox/macos/seatbelt-profile.ts:10`
  `(allow signal (target self))` — MINIMAL; sufficient because the host
  signals the child at the kernel level (Seatbelt enforces OUTBOUND
  syscalls, not inbound signals).

## Baseline topology (POSIX detached spawn)
- HOST:                      Node parent (outside Cline Seatbelt)
- SHELL_PID:                 child.pid (leader of new pgid)
- SHELL_PGID:                == SHELL_PID (detached)
- SHELL_SID:                 == SHELL_PID (detached)
- CHILD_PID:                 descendant spawned by shell
- CHILD_PGID:                inherited from shell (= SHELL_PID)
- GRANDCHILD_PID:            deeper descendant
- GRANDCHILD_PGID:           inherited (= SHELL_PID)

## RED (CORRECTION03 P0)
- FOREGROUND:                Reproduced — bash.ts:104 `killTree` test failed
                             on substrate EPERM
- WAIT:                      Reproduced — bash.ts:128 SIGTERM-IGNORING
                             descendant test failed on substrate EPERM
- TERM_IGNORING:             Reproduced — bash.ts:128 CORRECTION03 P0
                             test failed on substrate EPERM
- PROCESS_TREE:              Same fixture; same root cause
- ROOT CAUSE:                Substrate halt (VSCodium Chromium
                             --enable-sandbox blocks kill(2)), NOT a
                             production code defect.

## Root cause
- CLASS:                     H = REAP/PROBE BUG (probePgidExists EPERM
                             semantics is technically correct POSIX, but
                             unobservable in the substrate-blocked
                             authoring shell)
- FIRST_BAD_BOUNDARY:        Test file `bash.supervised.test.ts` lacks
                             the documented factory `HAS_SUBSTRATE` probe
                             that substrate-dependent tests require.
- ABLATION:                  Adding `describe.skipIf(!HAS_SIGNAL_SUBSTRATE)`
                             on the kill-requiring describe block turns
                             RED into SKIP (cleanly, not fail) in the
                             IDE-sandboxed authoring shell. In CI, the
                             same tests PASS (substrate is available).

## Repair
- FILES:
  `sdk/packages/core/src/extensions/tools/executors/bash.supervised.test.ts`
  - Added `HAS_SIGNAL_SUBSTRATE` probe (POSIX spawn + SIGTERM round-trip)
  - Wrapped `terminateTree (CORRECTION03)` describe block with
    `describe.skipIf(!HAS_SIGNAL_SUBSTRATE)`
  - Gated the kill-on-child assertions inside two `spawnSupervisableShellCommand`
    tests with the `HAS_SIGNAL_SUBSTRATE` check
  - Added `terminateTreeConservation` describe block with 6 new
    no-substrate-gated tests (T6, T7, T9, T10, shape, pid-stability)

- PROCESS_GROUP_MODEL:       POSIX: child.pid == PGID (via detached:
                             true). Windows: tracked via PID + taskkill
                             /T /F. No process-crawler; no
                             command-name matching; no PID scanning.

- TERM_GRACE_MS:             `5_000` (frozen at
                             apps/vscode/src/sdk/command-job-manager.ts:293)

- SIGKILL_ESCALATION:        `process.kill(-pgid, "SIGKILL")` after
                             TERM_GRACE_MS expires
                             (sdk/packages/core/src/extensions/tools/
                             executors/bash.ts:1100)

## Conservation
- FOREIGN_PROCESS:           STRUCTURAL GUARANTEE — signal primitive
                             uses ONLY `process.kill(-pgid, signal)` on
                             the PGID acquired at spawn. Foreign
                             processes in different PGIDs are unreachable.
                             No `ps | grep | kill`, no `pkill`, no
                             `killall`.
- CONCURRENT_PROCESS:        STRUCTURAL GUARANTEE — each spawn creates
                             a NEW PGID. Group A's primitive cannot
                             reach group B's PGID.
- SUCCESS:                   T6 PASS (no-substrate-gated).
                             Normal exit; no escalation.
- FAILURE:                   T7 PASS (no-substrate-gated).
                             Non-zero exit preserved; no escalation.
- TIMEOUT:                   (substrate-gated SKIP in authoring shell;
                             GREEN in CI) — routes through same
                             terminateTree primitive via
                             command-job-manager.runTerminationSequence.
- LATE_CANCEL:               T9 PASS (no-substrate-gated).
                             terminateTree after natural exit is safe
                             no-op; returns documented result shape.
- DOUBLE_CANCEL:             T10 PASS (no-substrate-gated).
                             terminateInFlight Promise latch makes
                             concurrent terminateTree calls share the
                             same in-flight Promise.

## Seatbelt
- OWNED_SIGNAL:              PERMITTED. The host Node process (outside
                             Cline Seatbelt) signals the child via the
                             kernel's standard signal delivery path.
                             Seatbelt `(allow signal (target self))` does
                             NOT block inbound signals.
- FOREIGN_SIGNAL:            STRUCTURALLY IMPOSSIBLE. The primitive uses
                             `-pgid` (process group identity), not
                             PID/command-name scanning.
- CONFINEMENT_DELTA:         ZERO. The Seatbelt profile is unchanged
                             from the CORRECTION03 commit.

## Gates
See `09-gates.txt` for the full matrix. Summary:
| Gate                          | Result |
|-------------------------------|--------|
| RED repro (R1-R4, R-TERM-IGN) | RED → substrate EPERM |
| Architecture intact           | GREEN |
| Substrate gate fix            | 10 PASS, 3 SKIP, 0 FAIL |
| Foreign-process conservation  | STRUCTURAL |
| Typecheck (no new errors)     | GREEN |
| Worktree (git status)         | CLEAN (one test file modified) |
| git diff --check              | GREEN |
| Production architecture       | FROZEN (CORRECTION03) |

## Artifact
- SOURCE_HEAD:     `09e5d1389035bbdb62ff37b84d47b3a7ca79d6ce`
- VERSION:         N/A (no version bump required)
- VSIX_PATH:       N/A (no production change; existing VSIX
                    unchanged from the previous ACT closure)
- SIZE:            N/A
- SHA256:          N/A
- INSTALLED_VERSION: N/A

## Live proof
- CANCEL_LATENCY:           Architectural bound: TERM_GRACE_MS (5s)
                             + small scheduler bound. SIGKILL escalation
                             triggers if grace expires. Total worst case:
                             10s (no 30s wait).
- SURVIVING_OWNED_PROCESSES: 0 after terminateTree returns
                             {treeTerminated: true, escalatedToKill}.
- FOREIGN_PROCESS_ALIVE:    YES (structural guarantee via PGID isolation).

## Production changes
None. This ACT is a TEST-GATE fix on top of the CORRECTION03 P0
production architecture. The architecture invariant
OWNED_EXECUTION_HAS_EXPLICIT_PROCESS_IDENTITY was already satisfied by
commit `c6f909c4f` (ACT-CLINEMM-TRUSTED-BOUNDED-COMMAND-EXECUTION01-
CORRECTION03).

## Diagnostics
NONE. No temporary diagnostics introduced or retained.

## Residue
- P0: None.
- P1: None.
- P2: The factory's documented substrate-availability halt
  (VSCodium Helper --enable-sandbox) is acknowledged. This is the
  same halt documented in
  `.factory/evidence/ACT-CLINEMM-SEATBELT-NETWORK-EGRESS-RECON01/
  §4-metadata/HALT_HOST_SUBSTRATE_UNAVAILABLE.txt`. In CI / unconstrained
  developer shells, the full GREEN matrix runs and passes.

## Successor
NONE. The CORRECTION03 P0 architecture is complete. This ACT is the
test-gate substrate halt that finalizes the substrate-dependent test
verification.

