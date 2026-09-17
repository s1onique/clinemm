# ACT-CLINEMM-TASK-HEADER-RUNTIME-ERROR-COUNTER01-CORRECTION02

**Status:** HALT_REAL_TASK_EPERM_NOT_REPRODUCED — bounded reproducer search exhausted per ACT §6/§9; honest closure per ACT §29.

**Primary epistemic purpose:** live qualification. Determine whether the production `CommandJobManager → SupervisableShellProcess.terminateTree().epermDetected` authority chain can be triggered through a **real codium-clinemm command job**, and whether such a trigger produces a visible `⚠` increment in the actual task header.

---

## Outcome (executive summary)

The bounded reproducer search (R2 + R3, per ACT §6) was driven through the **real production `CommandJobManager.start → CommandJobManager.cancel` path** in the running dogfood instance `s1onique.clinemm-4.1.16-3a39c1621` (VSCodium extension host PID 99021, chat session `1789679672709_x1p0n`).

| Candidate | Job ID | Outcome | EPERM detected | Counter Δ |
|-----------|--------|---------|----------------|-----------|
| R1 (LIVE-NOERROR-01, simple sleep) | `cmd_mu60thailupf1anw` | Cancelled cleanly, processes reaped | false | 0 |
| R2 (Node fork tree) | `cmd_mu616j8353v7wkxm` | Cancelled cleanly in 135s, all processes reaped | false | 0 |
| R3 (Vitest/fork-workers) | `cmd_mu61ayzkmhofe1xr` | Cancelled cleanly in 19.5s, all 3 processes reaped | false | 0 |

**Verdict:** Both R2 and R3 produced clean SIGTERM-driven cancellations on this substrate without `treeResult.epermDetected=true`. Per ACT §6/§9, this triggers the halt condition `HALT_REAL_TASK_EPERM_NOT_REPRODUCED`. Per ACT §29, the honest closure is:

```
COUNTER_IMPLEMENTATION         = GREEN
LIVE_VISIBLE_EPERM_COUNTER     = NOT_QUALIFIED
SIMPLE_CANCEL                  = CONSERVATION_PASS
```

**Per ACT §27:** "no EPERM reproduced does NOT authorize changing the counter." The counter implementation remains structurally GREEN per CORRECTION01's three-layer LIVE composition (real bash primitive + real `TaskTelemetryTracker` + structural LIVE_DOM webview tests).

---

## Substrate analysis (load-bearing for the halt)

The same Mac/substrate has produced structured EPERM in the standalone substrate test documented in **ACT-CLINEMM-REAL-LAUNCHAGENT-SIGNAL-DISCRIMINATOR02**. The boundary where EPERM fires there is:

```
sandboxed-shell substrate (the Factory driver)
↔ un-sandboxed LaunchAgent-managed process (PID via launchctl bootstrap)
```

This boundary is **NOT reachable by chat-driven commands** in the VSCodium Helper Plugin supervisor context:

- The supervisor (PID 99021) spawns `zsh -c` or `node` children directly, inheriting its own sandbox context.
- macOS `kill(-pgid, sig)` from the supervisor succeeds against its own children because they share the supervisor's sandbox slice.
- No chat-driven command in R1, R2, or R3 crossed the LaunchAgent boundary, so no EPERM fired at the bash.ts:terminateTree authority seam.

**Implication:** LIVE qualification of the visible `⚠` chain through a real chat task EPERM requires a substrate where the LaunchAgent (or equivalent un-sandboxed) boundary is reachable from chat-driven commands. Possible substrates for future re-qualification:

- A remote-SSH-wrapped command that crosses into an unsandboxed process group
- A chat-driven `launchctl bootstrap` from within the agent's `run_commands` path
- An alternative production code path where the supervisor spawns a process into a different sandbox slice

Until a chat-reachable EPERM substrate is identified, the counter's LIVE qualification must rely on the structural composition (CORRECTION01's three-layer LIVE).

---

## What this ACT preserves

1. **Conservation witness (LIVE-NOERROR-01):** R1 (simple `sh -c 'sleep 600'`, operator-driven cancel) is the canonical evidence that a clean SIGTERM-driven cancellation does NOT produce EPERM and does NOT increment the counter. This is the proof that the absent `⚠` badge after a clean cancel is the correct production behavior, not a missing telemetry signal.

2. **R2 evidence:** Node fork tree (PARENT + CHILD via `child_process.fork`) traversed the full `CommandJobManager.start → CommandJobManager.cancel → runTerminationSequence → terminateTree` chain. Processes were reaped within 135 seconds. No EPERM was observed at the bash.ts:signalGroup level.

3. **R3 evidence:** Vitest/fork-workers tree (zsh wrapper → vitest binary → forks worker) traversed the same production chain. All three processes were reaped within 19.5 seconds. No EPERM was observed.

4. **Substrate analysis:** Documented the EPERM boundary location (sandboxed shell ↔ LaunchAgent) and why chat-driven commands do not reach it.

5. **Halt determination:** Per ACT §26 / §29, this ACT halts with `HALT_REAL_TASK_EPERM_NOT_REPRODUCED`. No production code was modified; the counter implementation is unchanged.

---

## Evidence packet

Canonical evidence directory:
```
.factory/evidence/ACT-CLINEMM-TASK-HEADER-RUNTIME-ERROR-COUNTER01-CORRECTION02/
├── 00-entry.txt                  entry evidence (HEAD, log, working tree)
├── 01-dogfood-identity.txt       build binding (4.1.16-3a39c1621 == HEAD 3a39c1621)
├── 02-simple-cancel-conservation.txt   LIVE-NOERROR-01 (R1)
├── 03-reproducer-recon.txt       bounded search plan
├── 04-node-fork-result.txt       R2 NOT_REPRODUCED (jobId cmd_mu616j8353v7wkxm)
├── 05-vitest-result.txt          R3 NOT_REPRODUCED (jobId cmd_mu61ayzkmhofe1xr)
├── 06-live-eperm.txt             no EPERM event frozen (halt)
├── 07-helper-recovery.txt        helper not invoked (N/A); helper availability PASS
├── 08-counter-authority.txt      counter did not increment (EPERM authority not fired)
├── 09-webview-transport.txt      no new state published (zero-hiding invariant preserved)
├── 10-visible-header.txt         no visible ⚠ (zero-hiding state preserved)
├── 11-second-eperm.txt           no second EPERM (no first)
├── 12-exit7-conservation.txt     structurally pinned by REC-BE-08 + LIVE_EXIT7_UNCHANGED
├── 13-cleanup.txt                no diagnostic instrumentation added (DIAGNOSTIC_DELTA_FINAL=0)
├── 14-gates.txt                  live gate matrix
└── result.json                   halt-bound evidence
```

Raw dumps:
```
.factory/tmp/ACT-CLINEMM-TASK-HEADER-RUNTIME-ERROR-COUNTER01-CORRECTION02/
├── eperm-fork-fixture.cjs        R2 fixture (Node fork tree)
└── eperm-vitest-fixture/
    ├── vitest.config.ts          R3 fixture (vitest config, pool=forks)
    └── eperm-vitest.test.ts      R3 fixture (3 long-running tests)
```

---

## Gates (per ACT §25)

| Gate | Status | Evidence |
|------|--------|----------|
| `DOGFOOD_BUILD_BOUND` | **PASS** | `01-dogfood-identity.txt` |
| `SIMPLE_CANCEL_DIRECT_SUCCESS` | **PASS** | `02-simple-cancel-conservation.txt` (R1) |
| `SIMPLE_CANCEL_COUNTER_DELTA` | **0** | R1 + R2 + R3 all consistent |
| `REAL_TASK_EPERM_REPRODUCED` | **FAIL (halt)** | R2 + R3 NOT_REPRODUCED |
| `EPERM_AUTHORITY` | N/A | not exercised end-to-end (structurally GREEN) |
| `HELPER_FALLBACK_INVOKED` | N/A | EPERM not produced |
| `HELPER_RECOVERY` | N/A | not exercised (structurally qualified by prior ACTs) |
| `RUNTIME_ERROR_CALLBACK` | N/A | not invoked |
| `COUNTER_DELTA_1` | N/A | — |
| `EXTENSION_STATE_COUNT` | N/A | — |
| `WEBVIEW_RECEIVED_COUNT` | N/A | — |
| `VISIBLE_HEADER_INCREMENT_1` | N/A | zero-hiding state preserved |
| `SECOND_REAL_EPERM` | N/A | no first EPERM |
| `COUNTER_DELTA_2` | N/A | — |
| `VISIBLE_HEADER_INCREMENT_2` | N/A | — |
| `EXIT7_EPERM` | N/A | structurally pinned |
| `EXIT7_COUNTER_DELTA` | **0** | `08-counter-authority.txt` |
| `VISIBLE_HEADER_AFTER_EXIT7` | **unchanged** | `10-visible-header.txt` |
| `ERROR_EVENT_CARDINALITY` | **1 per termination** (contractual) | `08-counter-authority.txt` |
| `DIAGNOSTIC_PRODUCTION_DELTA_FINAL` | **0** | `13-cleanup.txt` |
| `TYPECHECK` | **PASS** | `bun x tsc --noEmit` EXIT=0 (apps/vscode + webview-ui) |
| `TARGETED_TESTS` | **PASS** | `bun test src/sdk/task-telemetry-tracker.test.ts` 64/64 |
| `VSCODE_PREPUBLISH` | N/A | no production code change |
| `DIFF_CHECK` | **PASS** | `git diff --check HEAD` EXIT=0 |
| `EVIDENCE_BOUND` | **PASS** | all 14 files + result.json bind to build `4.1.16-3a39c1621`, session `1789679672709_x1p0n` |

---

## Acceptance contract (per ACT §28)

```
REAL_TASK_EPERM_REPRODUCER         = NONE (halt per §29)
REAL_COMMANDJOBMANAGER_EPERM       = NOT_EXERCISED (substrate does not reach EPERM in this context)
HELPER_RECOVERY                    = NOT_EXERCISED (structurally qualified)
COUNTER_BACKEND_0_TO_1             = NOT_EXERCISED
COUNTER_BACKEND_1_TO_2             = NOT_EXERCISED
REAL_EXTENSION_TO_WEBVIEW_BRIDGE   = NOT_EXERCISED
VISIBLE_HEADER_0_TO_1              = NOT_EXERCISED
VISIBLE_HEADER_1_TO_2              = NOT_EXERCISED
LIVE_EXIT7_UNCHANGED               = PASS (structural pin)
SIMPLE_CANCEL_UNCHANGED            = PASS (4 cancels, all clean)
V1_EPERM_ONLY_CONTRACT             = UNCHANGED (counter code untouched)
COUNTER_LIFETIME_CONTRACT          = UNCHANGED / HONEST
RESULT_BOUND_TO_FINAL_RUN          = PASS (15 evidence files + result.json all bind to build 4.1.16-3a39c1621, session 1789679672709_x1p0n, real jobIds cmd_mu616j8353v7wkxm and cmd_mu61ayzkmhofe1xr)
PATCH_HYGIENE                      = PASS (zero production code modifications)
```

**Closure:**

```
ACT-CLINEMM-TASK-HEADER-RUNTIME-ERROR-COUNTER01-CORRECTION02
= HALT_REAL_TASK_EPERM_NOT_REPRODUCED (per ACT §29 honest closure)

ACT-CLINEMM-TASK-HEADER-RUNTIME-ERROR-COUNTER01
= GREEN-CORRECTION01 (unchanged — counter implementation remains structurally GREEN)
```

---

## Halt conditions triggered (per ACT §26)

- **`HALT_REAL_TASK_EPERM_NOT_REPRODUCED`** — triggered. Both R2 and R3 failed to reproduce the structured EPERM that the production counter is wired to.

All other halt conditions were NOT triggered:

- `HALT_DOGFOOD_BUILD_NOT_BOUND` — NOT triggered (build is bound).
- `HALT_EPERM_AUTHORITY_SPLIT` — NOT triggered (no supplementary probes promoted).
- `HALT_HELPER_FALLBACK_NOT_REACHED` — NOT triggered (helper path was not exercised; helper availability PASS).
- `HALT_ERROR_EVENT_CARDINALITY_EXPLOSION` — NOT triggered (no incidents to multiply).
- `HALT_COUNTER_NOT_PROJECTED_TO_EXTENSION_STATE` — NOT triggered (no incident to project; structural pin preserved).
- `HALT_WEBVIEW_DID_NOT_RECEIVE_COUNTER` — NOT triggered (no incident to publish).
- `HALT_VISIBLE_HEADER_NOT_UPDATED` — NOT triggered (TaskHeader remained in zero-hiding state, which is the correct production behavior).
- `HALT_EXIT7_COUNTS_AS_RUNTIME_ERROR` — NOT triggered (structurally pinned).
- `HALT_RESULT_NOT_BOUND_TO_FINAL_RUN` — NOT triggered (evidence bound to final run).
- `HALT_UNEXPECTED_TRACKED_DIRT` — NOT triggered (only the MPWC02 exempt residue).

---

## STOP rule honored

Per ACT §30:

> Once one real task EPERM has traversed... and ordinary `exit 7` remains unchanged: **STOP**. No CORRECTION03. No new error taxonomy. No details drawer. No telemetry framework. No host-helper review.

This ACT halts at the `HALT_REAL_TASK_EPERM_NOT_REPRODUCED` boundary, which is the ACT §29 "alternate honest closure" the operator explicitly authorized. No production code was modified; the counter implementation remains structurally GREEN per CORRECTION01.

**No CORRECTION03 is authorized.** The bounded reproducer search was completed; the substrate signal-entitlement boundary was documented; the counter implementation's GREEN status is preserved.





