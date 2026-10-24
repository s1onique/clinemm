# 03 — RED / clean-control results

Suite: `apps/vscode/src/sdk/__tests__/containment-failure-c10-authority01.cfc10a01.test.ts`
(NEW, 984 lines, 18 tests). Evidence class: **SYNTHETIC_REAL**.

Command (this environment has no executable `bunx`; use `bun x`):

    export PATH="$HOME/.bun/bin:$PATH"
    cd apps/vscode
    bun x vitest run --config vitest.config.ts \
      src/sdk/__tests__/containment-failure-c10-authority01.cfc10a01.test.ts

Result:

    ✓ src/sdk/__tests__/containment-failure-c10-authority01.cfc10a01.test.ts (18 tests) 153ms
    Test Files  1 passed (1)
         Tests  18 passed (18)

(The suite CHARACTERIZES the current production behaviour. Every case
states the expected observation-vs-containment relationship as an explicit
assertion, so a behaviour change surfaces as a reviewable diff rather than
being silently absorbed.)

## RED-01 — Unknown is not clean

| Case | Assertion | Result |
|---|---|---|
| RED-01-A | a `postcondition: "alive"` terminal classifies as `containment_failed`; the active map is empty | PASS |
| RED-01-B | `unknown` and `eperm` postconditions are ALSO `containment_failed` | PASS |
| RED-01-C | the active-map cardinality is 0 for BOTH the clean path (`cancelled`) and the failure path (`containment_failed`) — identical cardinal fact, different containment truth | PASS |
| RED-01-D | after the REAL bounded-FIFO eviction (`maxTerminalJobs: 1`), `manager.status(evictedJobId)` returns `unknown_job`, yet the host projection STILL says `containment_failed` — the manager miss does not and cannot revoke the containment verdict | PASS |

## RED-02 — Observation versus containment

| Case | Manager lookup | Receipt lookup | BCB count before -> after | Retained class | Containment postcondition | Result |
|---|---|---|---|---|---|---|
| RED-02-A (receipt PRESENT) | MISS | `resolved` (`observation: "evicted_receipt"`, `state: "containment_failed"`) | 1 -> 0 | `containment_failed` | UNCHANGED (never proven gone) | PASS |
| RED-02-B (receipt ABSENT) | MISS | `not_present` -> truthful `unknown_job` error | 1 -> 1 (NOT drained) | `containment_failed` | UNCHANGED | PASS |
| RED-02-C (Path C') | HIT (terminal snapshot present) | n/a | 1 -> 0 | `containment_failed` | UNCHANGED | PASS |

RED-02-B is the load-bearing "missing manager snapshot with no matching
receipt is NOT a successfully observed terminal fact" case: the tool
returns `ok: false, error: "unknown_job: ..."` and the obligation stays
held.

## RED-03 — C10 authority discriminator

| Case | Setup | C10 commits | Result |
|---|---|---|---|
| RED-03-A | containment failed, observation UNCONSUMED | 0 | PASS (BCB holds) |
| **RED-03-B (THE WITNESS)** | containment failed, observation CONSUMED | **1** | **PASS — the C10 commit is AUTHORIZED over an UNRESOLVED containment failure** |
| RED-03-C (CLEAN CONTROL) | containment PROVEN `gone`, observation CONSUMED | 1 | PASS — **identical** C10 outcome to RED-03-B |
| RED-03-D (ELM CONTROL) | containment failed, observation consumed, Elm HOLD | 0 | PASS — Elm remains the final gate |
| RED-03-E (STRUCTURAL) | source assertion | — | PASS — the C10 barrier block and the BCB re-evaluation block contain NO `getBackgroundCommandJobStates` / `getBackgroundCommandJobOwners` consult, while the Q5 path DOES and fails closed |

## RED-04 — Foreign owner and stale epoch

| Case | Assertion | Result |
|---|---|---|
| RED-04-A | a FOREIGN owner's `containment_failed` entry does not block this task's C10 | PASS |
| RED-04-B | a FOREIGN owner can READ the terminal fact (the manager's terminal map is process-level, not owner-scoped) but CANNOT drain the owner's obligation (the BCB validates the owner triple) — and this task's completion stays HELD | PASS |
| RED-04-C | an epoch bump does not grant a completion and does not turn a stale receipt into cleanup evidence; the obligation still holds and the containment class is unchanged | PASS |

## RED-05 — The receipt channel is itself `gone`-gated

| Case | Assertion | Result |
|---|---|---|
| RED-05-A | the production receipt channel (`recordTerminalReceiptFromLifecycle`) returns `{ kind: "ignored" }` for `command_job_containment_failed`, and accepts `command_job_terminal_committed`. Because the manager emits `command_job_terminal_committed` ONLY on the `gone` path, **a containment-failed job can never leave a compact receipt.** | PASS |

## RED-06 — Causal ablation matrix

Each row changes EXACTLY ONE fact. `committed` = number of C10 commits.

| # | postcondition | observation consumed | receipt present | retained class | BCB count | C10 committed |
|---|---|---|---|---|---|---|
| 1 | `alive` (FAILED) | no | no | `containment_failed` | 1 | **0** |
| 2 | `alive` (FAILED) | **yes** | no | `containment_failed` | 0 | **1** |
| 3 | `gone` (PROVEN) | no | no | `cancelled` | 1 | **0** |
| 4 | `gone` (PROVEN) | **yes** | no | `cancelled` | 0 | **1** |

**The discriminator:** rows 1->2 and 3->4 differ ONLY in observation
consumption, and the C10 outcome flips in BOTH pairs. Rows 2 and 4 have
IDENTICAL C10 outcomes (`committed = 1`) despite DIFFERENT containment
truth. RED-06-B additionally shows the receipt's PRESENCE does not move
the C10 outcome (held in both cases) — only the DRAIN does.

## Baseline regression state (important)

At PRISTINE ENTRY_HEAD (the new suite stashed away), the BCB/PPCA
conservation suites are ALREADY RED:

    bun x vitest run --config vitest.config.ts \
      src/sdk/__tests__/background-completion-barrier01.bcb01.test.ts \
      src/sdk/__tests__/background-completion-barrier01-correction01.bcb01-c.test.ts \
      src/sdk/__tests__/background-completion-barrier01-correction02.bcb01-c2.test.ts \
      src/sdk/__tests__/background-completion-barrier01-correction03.bcb01-c3.test.ts \
      src/sdk/__tests__/background-completion-barrier01-correction04.bcb01-c4.test.ts \
      src/sdk/__tests__/post-consumption-completion-authority01.pcca01.test.ts

    Test Files  6 failed (6)
         Tests  30 failed | 12 passed (42)

ROOT CAUSE (harness/optionality defect, NOT the containment issue):
`ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-DEFAULT01-REMOVE-LEGACY-TS-AUTHORITY`
made `getElmCompletionAuthorityDecision` a REQUIRED option
(`sdk-session-event-coordinator.ts:633`, no default). The older BCB/PPCA
harnesses were never updated to inject it, so the call throws inside
`checkElmCompletionAuthority`'s try/catch, which returns false
(fail-closed) and suppresses the C10 commit. Newer suites (e.g.
`c9c10cdap01`, `c9c10scr01`, `bcapt01`) DO inject it.

Consequence for this ACT: these suites are NOT usable as a conservation
gate until their harness is repaired. They are NOT evidence for or
against the containment question. The NEW CFC10A01 suite injects the Elm
decision explicitly and is green.
