# ACT-CLINEMM-COMPLETION-AUTHORITY-CCARD-COMMIT-STAGE-BOUNDARY-MISBOUND-REPAIR01

**Status:** PROPOSED_REVIEWER_HALT. Live capture contradicts the §17 invariant's
factual reading: `task_completion_committed` is emitted BEFORE the Elm authority
gate and BEFORE the `setTurnPhase("completed", …)` effect. The stage name
overstates what occurred. Elm-authority counters show `states=3, hold=1,
authorize=0, fallbackUsed=0, lastDecision=hold` — the authority gate itself
worked; the observation vocabulary mis-labels it.

## Verdict

**HALT_CCARD_COMMIT_STAGE_MISBOUND**

The earlier halt (`HALT_LIVE_AUTHORITY_REGRESSION`, UNOBSERVABLE on the prior
board row at epic-board.md:12672) is **withdrawn**. The new halt reclassifies
the failure from "authority not enforced" to "observation vocabulary
mis-labels a pre-effect record as a committed fact".

The Elm authority seam itself is composed-green under the available evidence:
the LIVE counters prove the real provider was consulted and returned HOLD;
the source and existing discriminators prove HOLD suppresses the
completion effect. The defect is the fact that our evidence vocabulary
violates the Factory rule against promoting **request/attempt → committed
fact** — exactly the same defect class the
`CORRECTION02-PRODUCTION-STAGE-VOCABULARY` ACT was created to address, but
applied at a *different* boundary (capture timing, not capture string). The
LIVE effect-suppression itself is not directly observable precisely because
CCARD is misbound; the post-fix re-run will close that gap.

## Withdrawals / Reclassifications

- **Withdrawn**: `HALT_LIVE_AUTHORITY_NOT_ENFORCING`. LIVE: real Elm authority
  reached and returned HOLD. STRUCTURAL + TEST: HOLD suppresses the
  completion effect. LIVE effect suppression is not directly observable
  until CCARD boundary is repaired. The gate consults Elm and the
  counters show one consult, one HOLD, no authorize, no fallback. If the
  gate obeys its proven production contract
  (`sdk-session-event-coordinator.ts:1582-1584`), the effect is suppressed
  — but that suppression is a composed proof, not yet a directly observed
  LIVE fact.

- **Reclassified**: `HALT_LIVE_AUTHORITY_REGRESSION`
  (epic-board.md:12672, UNOBSERVABLE on prior board) →
  `HALT_CCARD_COMMIT_STAGE_MISBOUND` (this halt). The prior halt was
  UNOBSERVABLE because the dump adapter
  (ACT `ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-AUTHORITY-COUNTER-DUMP01`) had
  not landed yet. This halt IS observable from the same dump.

## Evidence base

### 1. Live Elm-authority counters (LIVE)

```text
states          = 3
hold            = 1
authorize       = 0
failure         = 0
fallbackUsed    = 0
lastDecision    = hold
lastHoldReasons = ["active_run"]
```

Source: real dump through `dumpExtensionSideElmAuthorityCounters` (the
`CLINEMM_COMPLETION_AUTHORITY_ELM` = 1 dump adapter wired by ACT
`ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-AUTHORITY-COUNTER-DUMP01` at commit
`5f9330c55`).

Reads:
- The provider is armed and working.
- Exactly one Elm decision was consulted.
- The single decision was HOLD on `active_run`.
- No fallback / no failure / no decode or kernel error.
- Therefore: the Elm seam is operating; it was consulted exactly once; it
  returned HOLD; the corresponding `setTurnPhase("completed", …)` effect MUST
  have been suppressed per the proven production contract at
  `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:1582-1584`
  (`if (!await this.checkElmCompletionAuthority(...)) { return }`).

### 2. CCARD chronology (LIVE)

```text
seq 7 submit_and_exit_seen
seq 8 task_completion_committed
seq 9 agent_turn_done
```

The shadow independently agrees that `run_turn_started` reached Elm and that
after `submit_and_exit_seen` the model still had `activeRun = run_ElGUdKMC`,
`completionAuthorized = false`, `holdReasons = ["active_run"]`.

Shadow is healthy: zero violations, zero decode errors, zero kernel errors.
The shadow itself is NOT the defect.

### 3. The actual production capture site (SOURCE OF TRUTH)

`apps/vscode/src/sdk/sdk-session-event-coordinator.ts:1558-1586`:

```ts
} else {
    // ACT-CLINEMM-LONG-HORIZON-CONTINUATION-CARDINALITY-AUTHORITY01:
    // C10 — task_completion_committed capture. Fires at the actual
    // completion commit seam (the canonical phase transition). One
    // record per user-visible COMPLETED.
    captureContinuationCardinalityAuthorityRecord({
        stage: "task_completion_committed",
        origin: "pending_prompt_drain",
        sessionId: activeSession.sessionId,
        taskId: this.options.getTask?.()?.taskId,
        completionId: `completion-${activeSession.sessionId}-${++this.nextCompletionCommitEventId}`,
    })                                                          // ← seq 8 emitted HERE

    // ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-SEAM01:
    // Elm is the FINAL gate. The CCARD capture above already happened
    // (the shadow observer saw the record); Elm has the same model state.
    if (!await this.checkElmCompletionAuthority("session-event-turn-complete-completed")) {
        return                                                    // ← Elm gate may suppress
    }
    this.options.setTurnPhase?.("completed", undefined, "session-event-turn-complete-completed")  // ← effect
}
```

The capture (`seq 8`) is emitted **before** the Elm authority check, which is
**before** the effect. Therefore:

- The name `task_completion_committed` is a **commit-attempt** or
  **commit-candidate**, not a committed fact.
- When Elm returns HOLD (the LIVE case), the capture has already been emitted
  but the effect has NOT run.
- The shadow's transition to `task = completion_committed` is therefore
  induced by a **pre-effect record**.

### 4. The §17 invariant violated

`ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-SEAM01-CORRECTION02-PRODUCTION-STAGE-VOCABULARY`
§17 (epic-board.md:17451-17458):

```text
task_completion_committed must not occur while Elm authority still has an
active run
```

This invariant was claimed provable at the unit-test layer via:
- `REAL-ELM-PROD-VOCAB-HOLD` — `commitCount = 0` while `activeRun != null`
- `REAL-ELM-PROD-VOCAB-AUTHORIZE` — `commitCount = 1` after `agent_turn_done`

But in LIVE (the only environment that actually exercises the production
capture seam), the record WAS emitted while `activeRun` was set. The
`commitCount = 0` claim from the test layer applies to the **shadow's
counter**, not to the CCARD chronology. The shadow's `commitCount` counts
HOLD/AUTHORIZE transitions of the Elm kernel state, which is a downstream
projection of the captured records — it does NOT gate emission of the
record itself.

In short: the test proved "shadow's post-separation counter agrees with
authority", not "no record is emitted when authority says HOLD". The
production seam violates the latter, but the latter was never tested.

## First real divergence

The first place CCARD chronology diverges from the assumed post-effect
semantics is the capture-before-gate ordering at
`sdk-session-event-coordinator.ts:1565` (the
`captureContinuationCardinalityAuthorityRecord(...)` call). All downstream
CCARD events are downstream of this single ordering defect.

## Bounded next repair

**Do NOT touch Elm authority logic.** The Elm seam itself is operating
correctly. The defect is in our observation vocabulary.

Two bounded options, both single-line + small test additions:

### Option A (PREFERRED): emit the factual record only after the effect

```ts
// BEFORE gate
if (!await this.checkElmCompletionAuthority("session-event-turn-complete-completed")) {
    return
}
this.options.setTurnPhase?.("completed", undefined, "session-event-turn-complete-completed")

// AFTER successful effect — capture the factual committed fact
captureContinuationCardinalityAuthorityRecord({
    stage: "task_completion_committed",
    origin: "pending_prompt_drain",
    sessionId: activeSession.sessionId,
    taskId: this.options.getTask?.()?.taskId,
    completionId: `completion-${activeSession.sessionId}-${++this.nextCompletionCommitEventId}`,
})
```

Effect: HOLD ⇒ no capture (factual). AUTHORIZE ⇒ exactly one capture per
`setTurnPhase("completed", …)`.

### Option B: rename the stage to honestly reflect what it is

```ts
captureContinuationCardinalityAuthorityRecord({
    stage: "task_completion_commit_attempted",
    ...
})
```

Add a NEW stage `task_completion_committed` for the post-effect record, and
emit it after the gate + effect on success.

### RED/GREEN pinning (both options)

```text
HOLD(active_run)
→ no setTurnPhase("completed", …)
→ no task_completion_committed factual record
→ (option A: no capture at all; option B: 1x task_completion_commit_attempted, 0x task_completion_committed)

AUTHORIZE
→ setTurnPhase("completed", …) exactly once (when the optional callback is present;
   if absent, capture is pinned to successful traversal of the completion-effect
   seam, not to the call-site)
→ task_completion_committed exactly once
→ (option B: also exactly one commit_attempted + one committed)
```

**Implementation subtlety (per reviewer):** `setTurnPhase` is declared as an
optional callback (`this.options.setTurnPhase?.(...)`). The factual contract
for the Option A move is "successful traversal of the production
completion-effect seam", not "the call-site ran". If the callback's presence
is already a production invariant, pin that in
`CCARD-MISB-02` (the test must require the callback to be wired); otherwise
the repair does NOT expand this ACT to redesign the optionality.

### RED tests (load-bearing)

Three tests required at minimum, all driving the REAL production seam
through `captureContinuationCardinalityAuthorityRecord` (mirrors
CORRECTION02's "REAL production capture seam" directive):

1. **`CCARD-MISB-01`**: HOLD branch emits zero `task_completion_committed`
   records (current code RED: emits 1).
2. **`CCARD-MISB-02`**: AUTHORIZE branch emits exactly one
   `task_completion_committed` record (current code: emits 1; remains GREEN
   after the move).
3. **`CCARD-MISB-03`** (conservation discriminator): two consecutive HOLD
   attempts followed by one AUTHORIZE.
   - Zero `task_completion_committed` records during the HOLDs.
   - Exactly one `task_completion_committed` record after the AUTHORIZE.
   - `completionId` sequence advances only on the factual commit (the
     AUTHORIZE path), not on HOLDs. This is a structural / behavioral
     conservation pin — NOT a new diagnostic counter.

## Hard prohibitions

Per CORRECTION02 closure directives + reviewer re-emphasis on Elm
semantics:

- DO NOT reopen Elm `Authority.elm` semantics (`activeRun` lifecycle,
  `holdReasons` derivation, completion-decision predicate).
- DO NOT change `checkElmCompletionAuthority` / `flushElmAuthorityForSession`
  / `getElmCompletionAuthorityDecision` shapes (these are the proven
  production contracts).
- DO NOT change BCB / BNCA / PCCA / CPA / PCRS02 / PCRS02C01 / CCARD
  invariants.
- DO NOT add new RPC, schema_version bump, or UI surface change.
- DO NOT touch the Elm kernel bundle / canonical runtime load path.

## Successor ACT brief

`ACT-CLINEMM-COMPLETION-AUTHORITY-CCARD-COMMIT-STAGE-BOUNDARY-MISBOUND-REPAIR01`
will:

1. Open a follow-on successor ACT body (the present file) on disk.
2. Add 3 RED tests at
   `apps/vscode/src/sdk/__tests__/ccard-commit-stage-boundary-misbound01.test.ts`,
   exercising the REAL production capture seam.
3. Run RED: pre-fix the test must fail with `commitCount > 0` under HOLD.
4. Apply Option A (move the capture) or Option B (rename + add post-effect
   capture) — single-file TS change in `sdk-session-event-coordinator.ts`,
   plus the corresponding stage-enum delta in
   `continuation-cardinality-authority.ts` (option B only).
5. Run GREEN: 3 RED tests flip to green.
6. Run full conservation: `real_elm_provider01`, `source-stage-vocabulary01`,
   `first_seam01_case01`, `first_seam01_preservation`, `shadow02`,
   `historical_replay01`, `bcb01 + 4 corrections`, `bnca (8 suites)`,
   `pcca01`, `tqcb01`, `ccard01` — same suite as CORRECTION02
   (epic-board.md:17432-17444). Must pass.
7. Verify gates: typecheck PASS, lint PASS, diff-check PASS.
8. **Bounded LIVE re-qualification**: rebuild dogfood VSIX, install on real
   Codium/VSCode, run mundane task with `CLINEMM_COMPLETION_AUTHORITY_ELM=1`,
   capture authority counters + CCARD + shadow. Expected:
   - `commitCount = 0` (no factual committed record) when Elm returns HOLD.
   - `commitCount = 1` when Elm returns AUTHORIZE.
   - `decodeErrors = 0`, `kernelErrors = 0`, `fallbackUsed = 0`.
9. **NO new evidence invented**. Only the same evidence classes already
   used by CORRECTION02's closure: counters + CCARD + shadow.

## Files that will likely change (predicted, not yet committed)

- `apps/vscode/src/sdk/sdk-session-event-coordinator.ts` (single capture
  move OR stage rename + new stage, depending on option chosen)
- `apps/vscode/src/sdk/continuation-cardinality-authority.ts` (stage enum
  delta, option B only)
- `apps/vscode/src/sdk/__tests__/ccard-commit-stage-boundary-misbound01.test.ts`
  (NEW, 3 tests: HOLD suppression, AUTHORIZE-one-committed, conservation
  discriminator. NO new diagnostic counters — the third test is a
  structural / behavioral conservation pin, not a counter)

No new files in `apps/vscode/src/sdk/__tests__/` beyond the one listed; no
new fixtures; no new scripts; no new docs outside `.factory/`.

## Operator step (unchanged from CORRECTION02)

```bash
python3 scripts/build-dogfood-vsix.py
codium --install-extension dist/clinemm-<...>.vsix

CLINEMM_RUNTIME_PROFILE=dogfood \
CLINEMM_COMPLETION_AUTHORITY_ELM_SHADOW=1 \
CLINEMM_COMPLETION_AUTHORITY_ELM=1 \
  # mundane task; capture authority counters + CCARD + shadow
  # verify: realElmProviderCalls > 0, fallbackUsed = 0,
  #         HOLD path -> commitCount = 0 (factual committed record)
  #         AUTHORIZE path -> commitCount = 1
```

## Reviewer summary

The Elm authority seam is **operating correctly** and is **likely
LIVE-green**. The defect is a vocabulary/timing mis-labeling: the CCARD
record `task_completion_committed` is emitted at a commit-ATTEMPT boundary,
not at a commit-COMPLETED boundary. This mis-labeling is a real P0 because:

1. It violates the Factory rule against promoting request/attempt →
   committed fact in evidence vocabulary.
2. It produces a SHADOW transition (`task = completion_committed`) that is
   not anchored to a real completion effect.
3. It would mask any future regression where the authority gate is bypassed
   or weakened — the shadow would still report "committed" even when the
   effect was suppressed.

The bounded repair is a single-file capture move (or rename) with 3 RED
tests at the production capture seam. It does NOT touch Elm semantics.

**Verdict:** `HALT_CCARD_COMMIT_STAGE_MISBOUND`. Withdraw prior
`HALT_LIVE_AUTHORITY_REGRESSION` (UNOBSERVABLE) and
`HALT_LIVE_AUTHORITY_NOT_ENFORCING` (incorrect attribution). Open successor
ACT with Option A (preferred) or Option B.

**C1:** Operator installs exact-head VSIX, runs mundane task with
`CLINEMM_COMPLETION_AUTHORITY_ELM=1`, captures counters + CCARD + shadow.
HOLD ⇒ `commitCount = 0`. AUTHORIZE ⇒ `commitCount = 1`. `decodeErrors =
0`, `kernelErrors = 0`, `fallbackUsed = 0`. Only after this LIVE
re-qualification does the predecessor ACT chain close cleanly.
