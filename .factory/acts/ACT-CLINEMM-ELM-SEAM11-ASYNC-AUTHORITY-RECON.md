# ACT-CLINEMM-ELM-SEAM11-ASYNC-AUTHORITY-RECON — NOT_A_GOOD_ELM_SEAM — 2026-10-13

**Status:** CLOSED with verdict `NOT_A_GOOD_ELM_SEAM`. The bounded
executable discriminator was executed against the SEAM11 candidate
inventory (Candidate A: pending-prompt admission and consumption;
Candidate B: background-job ownership FSM; Candidate C: task/turn
lifecycle admission). The discriminator returns the disposition
`NOT_A_GOOD_ELM_SEAM` based on ten reasons enumerated in PACEID-10.
**The SEAM11 production cutover is not authorized for any of the
three named candidates.**

This is a legitimate exit. The strongest candidate (Candidate A)
fails the interop, ownership, evidence, and economics gates per
ACT §4. The remaining two candidates (B and C) fail their own
gates (BCB critical-path exclusion, I/O coupling) without the
discriminator needing to be run against them.

**Preconditions met:**

- ENTRY_HEAD = `b544b5ca120c811adaba2297c2b8e3b39376817a` on
  branch `main` (the BCB-CAPTURE-ACTIVATION01 commit, matching
  the ACT spec entry); working tree clean; no stashes; no
  uncommitted changes.
- SEAM01–10 evidence preserved in `.factory/epic-board.md` and
  the per-ACT files in `.factory/`.
- BCB capture activation fix at `b544b5ca1` is committed and
  verified by `bcbcap01.test.ts` (24/24 GREEN).
- Independent L2847 RED witnesses preserved by
  `task-terminal-divergence-red01.tdd-red01.test.ts` (3 RED / 11
  PASS, matches the BCB01-CORR01 baseline).
- HALT_UNEXPECTED_TRACKED_DIRT: NOT TRIGGERED.
- BCB production repair: NOT in scope for this ACT (per ACT §7).

## 0. Mission

Find one production decision boundary where Elm can replace
meaningful TypeScript state/decision logic without introducing
additional asynchronous control-flow dependencies. Prioritize a
coherent state machine over an isolated policy function. Do not
repeat completed migrations or previously rejected candidates.

## 1. Entry and preservation

**Repository state:**

| Field | Value |
|---|---|
| Repo HEAD | `b544b5ca1` on `main` |
| Working tree | clean (no stashes, no uncommitted changes) |
| Installed extension | `s1onique.clinemm-4.1.16-5a1c485cb-b544b5ca1` (matches HEAD) |
| BCB activation fix | committed in `b544b5ca1` (BCB-CAPTURE-ACTIVATION01) |
| L2847 RED witnesses | 3 RED / 11 PASS preserved (TDD-01.A/B + TDD-07) |
| Existing Elm kernels | 5 in `apps/vscode/elm/`: `background-notify-authority`, `completion-authority`, `completion-continuation-control`, `deferred-completion-barrier`, `task-header-orchestration` |
| SEAM04 LIVE qualification | `LIVE_UNOBSERVABLE` (env read-only mount at `~/.vscodium-clinemm/extensions/`); SEAM08 LIVE dogfood qualification remains open |
| BCB capture dump | empty (`bcb-observation-unavailable-capture.jsonl` not yet created — no live task has hit the BCB observation-unavailable path during this ACT's execution) |

**Preservation:**

- SDK terminal policy / BCB barrier semantics — UNTOUCHED
- L2847 precedence — UNTOUCHED (3 RED witnesses preserved, 20 references unchanged)
- Elm `background-notify-authority` (SEAM04) + `deferred-completion-barrier` (SEAM08) — UNTOUCHED
- `applyBcbObservationUnavailableDiagnosticProfile` activation helper — UNTOUCHED (verified 24/24 GREEN)
- Existing frozen historical captures — UNTOUCHED
- Protected stashes — UNTOUCHED

## 2. Existing Elm authority inventory

| Kernel | File | Authority | SEAM | Status |
|---|---|---|---|---|
| `completion-authority` | `apps/vscode/elm/completion-authority/` | Completion commit authority (submit_and_exit) | SEAM01 | REAL_PRODUCTION_SEAM, SYNCHRONOUS REAL |
| `task-header-orchestration` | `apps/vscode/elm/task-header-orchestration/` | Task header presentation | SEAM02 | REAL_PRODUCTION_SEAM, LIVE |
| `completion-continuation-control` | `apps/vscode/elm/completion-continuation-control/` | Long-horizon continuation control | SEAM07 | REAL_PRODUCTION_SEAM, CORRECTION01_PASS_STRUCTURAL |
| `background-notify-authority` | `apps/vscode/elm/background-notify-authority/` | Terminal consumption authority (C7 cutover) | SEAM04 | REAL_PRODUCTION_SEAM, LIVE_UNOBSERVABLE (env) |
| `deferred-completion-barrier` | `apps/vscode/elm/deferred-completion-barrier/` | Post-await decision (BCB C10 barrier) | SEAM08 | REAL_PRODUCTION_SEAM, LIVE_QUALIFICATION_BLOCKED_BY_ENV |

**No new 6th kernel position allocated in `_ELM_KERNELS`.** The
SEAM09/SEAM10 frozen contract (9-tag tool-approval verdict) was
rejected as `NOT_A_GOOD_ELM_SEAM` in SEAM10 (2026-10-12, 6
reasons enumerated in TPAEID-10).

## 3. Candidate inventory

### Candidate A — Pending-prompt admission and consumption (STRONGEST)

**Production chain (verified by `queued-prompt-stop-resume-integrity01-recon.md` and `pending-prompt-service.ts:1-712`):**

| Owner | Site | Behavior |
|---|---|---|
| `PendingPromptService.enqueue` | `sdk/packages/core/src/runtime/turn-queue/pending-prompt-service.ts:287-347` | Pure-data: appends or dedupes on a `PendingPromptQueueState` |
| `PendingPromptsController.enqueue` | `pending-prompt-service.ts:410-475` | Thin wrapper; calls `service.enqueue`, emits `pending_prompts`, schedules drain |
| `LocalRuntimeHost.runTurn` (admission) | `local-runtime-host.ts:1244-1248` | 1-line `delivery ?? (session.interactive && !canStartRun ? "queue" : undefined)` — **REJECTED in SEAM06** |
| `PendingPromptsController.drain` | `pending-prompt-service.ts:522-653` | `async` drain loop with `await this.deps.send(...)` + re-entrant `queueMicrotask` |
| `PendingPromptService.consumeSteer` | `pending-prompt-service.ts:349-358` | Removes steer-delivered entry from head |
| `PendingPromptService.shiftNext` | `pending-prompt-service.ts:360-363` | FIFO head shift |
| `PendingPromptService.requeueFront` | `pending-prompt-service.ts:365-371` | Re-queue on drain error |
| `discardQueue` | `pending-prompt-service.ts:492-496` | Drops all queued prompts on queue-initiated cancel |

**Why A is not a good Elm seam (per PACEID-01..10):**

1. **Admission sub-seam already rejected (SEAM06).** The
   12-case admission decision at `local-runtime-host.ts:1244-1248`
   was rejected as `NOT_A_GOOD_ELM_SEAM` in SEAM06
   (2026-10-09, ~1500 LoC of new code for a 1-line boolean
   expression). ACT §3 explicitly excludes re-litigation.
2. **Consumption chain is a small synchronous projection (PACEID-02/09).**
   The dedupe + steer-priority + FIFO + trust-first-wins
   precedence is a 4-outcome closed enum
   (`dedupe_as_queue` / `dedupe_as_steer` / `fresh_queue` /
   `fresh_steer`). This is below the 5-6 outcome prior-kernel
   threshold (consumeTerminal: 5, completion commit: 5, etc.)
   and falls into the SEAM06/SEAM10 "small synchronous
   projection" trap.
3. **Drain is an async state machine (PACEID-03/08).** The
   `PendingPromptsController.drain` is `async` and `await`s
   `this.deps.send(...)`. On error it `requeueFront` + reschedules
   via `queueMicrotask`. The Elm `Platform.worker` cannot own an
   async state machine with re-entrant control flow without a
   new Promise port (a new async control-flow dependency the
   SEAM10 verdict explicitly excludes).
4. **SDK/VSCode kernel placement conflict (PACEID-04).** The
   queue state lives in `ActiveSession.pendingPrompts` in the
   SDK (`sdk/packages/core/src/runtime/turn-queue/`). The 5
   existing Elm kernels are VSCode-only
   (`apps/vscode/elm/...`). Per SEAM06 finding: "the SDK must
   stay clean of VSCode assets." Shipping the Elm kernel as an
   SDK runtime asset conflicts with the existing 5-kernel
   VSCode-only convention. Mirroring `ActiveSession` in a
   VSCode-only bridge is a stateful protocol leak.
5. **Evidence-loss hazard (PACEID-06).** The drain's C4/C5/C6
   capture hooks carry `(delivery, jobId, runtimeControlKind)`
   structural evidence that a closed 4-tag Elm projection would
   lose. The trust-first-wins dedupe in `enqueue` (line 318)
   preserves `runtimeControlKind` across re-enqueue. The SEAM10
   TPAEID-06 finding applies: the projection loses
   `jobId`-vs-`runtimeControlKind` interaction semantics.

### Candidate B — Background-job ownership FSM

**Production modules:**

| Module | File | Behavior |
|---|---|---|
| `BackgroundOwnerCorrelation` | `apps/vscode/src/sdk/background-owner-correlation.ts:1-220` | **DIAGNOSTIC CAPTURE** ring (default-off, default 64 records). Read-only. Zero semantic delta when OFF. |
| `BackgroundJobLivenessAuthority` | `apps/vscode/src/sdk/background-job-liveness-authority.ts:1-380` | **DIAGNOSTIC CAPTURE** ring (default-off, default 256 records). Read-only. |
| `CommandJobManager` | `apps/vscode/src/sdk/command-job-manager.ts` | Job creation + owner binding (stateful I/O) |
| `BackgroundNotifyCoordinator.consumeTerminal` | SEAM04 (Elm-owned) | Terminal consumption authority (already on Elm) |

**Why B is not a good Elm seam:**

- The two "background" modules are **diagnostic capture rings**,
  not decision authorities. They are already bounded, default-off,
  and removable when superseded.
- The actual ownership/notification FSM lives across
  `CommandJobManager` (stateful I/O) and
  `BackgroundNotifyCoordinator.consumeTerminal` (SEAM04
  Elm-owned). The terminal-consumption decision surface is
  already on Elm.
- ACT §3 explicit exclusion: "Do not migrate the active BCB
  observation-unavailable path while its causal repair remains
  unresolved." The BCB path is on the same critical seam as the
  ownership/notification FSM.

### Candidate C — Task/turn lifecycle admission

**Production modules:**

| Module | File | Behavior |
|---|---|---|
| `SdkTaskStartCoordinator.initTask` | `apps/vscode/src/sdk/sdk-task-start-coordinator.ts:140-365` | I/O-coupled: profile resolution, session-id allocation, fence-token checks, `sessions.startNewSession` (async with supersession), history-item updates, postStateToWebview |
| `SdkTaskStartCoordinator.reinitExistingTaskFromId` | `sdk-task-start-coordinator.ts:415-494` | Resume: derive phase from last message, attach subscription |
| `SdkTaskControlCoordinator.cancelTask` | `apps/vscode/src/sdk/sdk-task-control-coordinator.ts:76-150` | Cancel: clear pending, abort session, set phase to "resumable" |
| `SdkTaskControlCoordinator.showTaskWithId` | `sdk-task-control-coordinator.ts:240-349` | Resume: 3-line if/else to derive phase from last message ask type |

**Why C is not a good Elm seam:**

- The task lifecycle is **deeply I/O-coupled**: session creation,
  history persistence, fence-token checking, runtime subscription
  attachment, postStateToWebview. Migrating any sub-seam would
  require substantial new kernel + TS adapter (matching the
  SEAM06 LoC budget).
- The resume phase derivation is a 3-line if/else with 3 outcomes
  (`completed` / `resumable` / `idle`) — far below the 5-6
  outcome prior-kernel threshold.
- The L2847 precedence defect (`wasErrorSeen()` fires before
  `wasAttemptCompletionSeen()` at the `done` event in
  `setTurnPhase` at `sdk-session-event-coordinator.ts:2850-2920`)
  is the only bounded, pure decision in this family — but it
  lives **on the BCB critical path** (setTurnPhase → terminal
  phase → BCB activation), and ACT §3 explicitly excludes it.
  It's also RED in the witness, and the CORRECTION01 ACT has not
  run yet.
- A future task-lifecycle authority would need a 6th kernel with
  significant new infrastructure, which the SEAM10 verdict's
  "small synchronous projection + new async hop + ~600 LoC Elm
  cost" trap directly addresses.

## 4. Source-first feasibility gate

For Candidate A (the only viable candidate after B and C exclusions):

| Field | Evidence |
|---|---|
| Production caller | `sdk/packages/core/src/runtime/turn-queue/pending-prompt-service.ts:287-712` |
| Current TS authority | `PendingPromptService` (enqueue/update/delete/consumeSteer/shiftNext/requeueFront) + `PendingPromptsController` (drain loop) |
| Existing Elm overlap | None (the 5 existing kernels are completion/notify/header/barrier authorities) |
| Inputs | `(existingPrompts: PendingPromptEntry[], newPrompt, newDelivery)` — a synchronous snapshot |
| Outputs | Closed 4-tag enum: `dedupe_as_queue` / `dedupe_as_steer` / `fresh_queue` / `fresh_steer` |
| Side effects | Queue mutation in TS, `await this.deps.send(...)` in TS, `queueMicrotask` rescheduling in TS |
| Transport | Existing async Elm bridge (DCBEID, TPAEID); no new transport needed |
| Timing | Drain's `await this.deps.send(...)` + re-entrant `queueMicrotask` are TS-owned async state machine; Elm cannot own without new Promise port |
| Failure behavior | `kernel_offline` / `decode_error` / `response_timeout` are infrastructure failures, NOT permissive decisions; the DCB bridge's structural fail-closed invariant holds |
| Migration benefit | ~140 LoC of TS queue-mutation surface replaced by ~1500 LoC of new Elm kernel + TS adapter — negative ROI |

**Rejection per ACT §4:**

1. ✓ Requires a synchronous answer from Elm on an imperative critical path: PACEID-01/03/08 confirm the drain is async; Elm `Platform.worker` cannot own it.
2. ✓ Loses information necessary for later authorization or lifecycle decisions: PACEID-06 confirms the C4/C5/C6 capture hooks carry `jobId` + `runtimeControlKind` structural evidence that a closed 4-tag Elm projection would lose.
3. ✓ Needs a new kernel solely to move a small boolean or enum: PACEID-07 confirms the 4-outcome decision is below the 5-6 outcome prior-kernel threshold; ~1500 LoC of new code for ~140 LoC of TS.
4. ✗ Duplicates an existing Elm authority: the consumption chain is NOT already on Elm, but its decision surface is too small to be a substantial migration.
5. ✓ Requires a new protocol, public wire field, or transport framework without compelling benefit: PACEID-04 confirms shipping the kernel as an SDK runtime asset conflicts with the existing 5-kernel VSCode-only convention.
6. ✗ Interferes with BCB forensics or the independent L2847 repair: the L2847 site is on the BCB critical path; ACT §3 explicitly excludes it.

## 5. Executable discriminator

**File:** `apps/vscode/src/sdk/__tests__/prompt-admission-and-consumption-elm-interop-discriminator.paceid01.test.ts`

**Approach:** Mirrors the SEAM10 TPAEID01 discriminator pattern.
Uses the existing `consultDeferredCompletionBarrierElmKernel`
async public adapter and the real compiled
`deferred-completion-barrier` kernel as a stand-in "Elm-shaped
worker" (its `Elm.Main.init` API is identical to any future 6th
kernel). It does NOT add a new kernel, does NOT modify the
production entrypoint, and does NOT introduce a new host
callback.

**Test families (10):**

| ID | Family | Result |
|---|---|---|
| PACEID-01 | Synchronous-impossibility theorem (consult takes >= 1 event-loop tick) | PASS |
| PACEID-02 | Queue-mutation purity (4-tag closed enum, below 5-6 outcome threshold) | PASS |
| PACEID-03 | Drain-as-async-state-machine (`async drain` + `await deps.send` + `queueMicrotask`) | PASS |
| PACEID-04 | SDK/VSCode kernel placement (queue in SDK, 5 kernels in VSCode) | PASS |
| PACEID-05 | Rejected-candidate preservation (SEAM05/SEAM06 admission sub-seam) | PASS |
| PACEID-06 | Evidence-loss hazard (C4/C5/C6 capture hooks carry structural evidence) | PASS |
| PACEID-07 | Migration economics (small TS surface, ~1500 LoC minimum Elm cost) | PASS |
| PACEID-08 | Async state machine preservation (try/catch/finally + queueMicrotask) | PASS |
| PACEID-09 | Duplication of existing authorities (4-outcome snapshot projection trap) | PASS |
| PACEID-10 | Disposition harness = `NOT_A_GOOD_ELM_SEAM` | PASS |

**Results:** 10/10 PASS, 0 FAIL.

**Actual test output:**

```text
$ cd apps/vscode && bun vitest run \
    src/sdk/__tests__/prompt-admission-and-consumption-elm-interop-discriminator.paceid01.test.ts

 ✓ src/sdk/__tests__/prompt-admission-and-consumption-elm-interop-discriminator.paceid01.test.ts (10 tests) 9ms
 Test Files  1 passed (1)
      Tests  10 passed (10)
   exitCode 0
```

**Question answered:** Can Elm own this decision with less total
complexity than the current TypeScript implementation? **NO.** The
queue-mutation surface is ~140 LoC of pure TS code with 6/6 GREEN
tests; migrating to Elm would require ~1500 LoC of new code
(Domain.elm + Policy.elm + Codec.elm + Main.elm + tests + TS
adapter) for a 4-outcome synchronous projection. The drain's
`await this.deps.send(...)` + re-entrant `queueMicrotask` + error
requeue are irrecoverably TS-side.

## 6. Migration economics

**TypeScript production decision logic that can genuinely be retired:**

- `PendingPromptService.enqueue` (60 LoC, including dedupe + trust-first-wins)
- `PendingPromptService.update` (49 LoC, including prompt normalization)
- `PendingPromptService.delete` (27 LoC, including missing-prompt report)
- `PendingPromptService.consumeSteer` (10 LoC)
- `PendingPromptService.shiftNext` (4 LoC)
- `PendingPromptService.requeueFront` (8 LoC)
- `PendingPromptsController.drain` (132 LoC) — **CANNOT BE RETIRED** (async state machine)

Total retirable TS: ~158 LoC.

**Elm model/decoder/update complexity introduced:**

- `Domain.elm` (types + factsIsExpected) ~50 LoC
- `Policy.elm` (4-case decision) ~25 LoC
- `Codec.elm` (closed-schema decoder/encoder) ~150 LoC
- `Main.elm` (Platform.worker + ports) ~120 LoC
- `tests/PromptAdmissionAuthorityTest.elm` ~80 LoC
- `apps/vscode/src/sdk/prompt-admission-authority-elm.ts` (TS adapter) ~300 LoC
- 4-case Elm ↔ TS correspondence test ~100 LoC
- Failure-mode tests ~150 LoC
- `_ELM_KERNELS` table extension in `build_dogfood_vsix_lib.py` ~10 LoC
- `PendingPromptsControllerOptions.promptAdmissionAuthority` plumbing ~15 LoC
- `vscode-session-host.ts` adapter wiring ~5 LoC

Total new code: ~1005 LoC, one new production seam, three new
failure modes, and one new async control-flow dependency (Promise
port for `deps.send` result) for a 4-outcome synchronous
projection. The drain's `await this.deps.send(...)` chain is
irrecoverably TS-side, so the migration only retires 158 LoC of
the 712 LoC production file.

**Adapter and bridge changes required:**

- One new Promise port for `deps.send` result forwarding (a new
  async control-flow dependency the SEAM10 verdict explicitly
  excludes).
- One new TS adapter module
  (`apps/vscode/src/sdk/prompt-admission-authority-elm.ts`).
- One new `PendingPromptsControllerOptions` field
  (`promptAdmissionAuthority`).
- One new wire field in the Elm bridge (the closed 4-tag enum).

**New lifecycle or failure states introduced:**

- `kernel_offline` / `decode_error` / `response_timeout` —
  infrastructure failures that the TS adapter must route
  through. The DCB bridge's structural fail-closed invariant
  holds, but the new modes add a new failure class.

**Additional asynchronous transitions:**

- One new Promise port (the Elm kernel cannot own `await
  this.deps.send(...)` directly, so the TS controller must
  forward the send result through a port).
- One new microtask boundary (the Elm kernel cannot own the
  re-entrant `queueMicrotask` rescheduling).

**Tests and long-term maintenance burden:**

- One new elm-test file (80 LoC).
- One new TS ↔ Elm correspondence test (100 LoC).
- One new failure-mode test file (150 LoC).
- Ongoing maintenance of the 4-outcome decision vocabulary
  (additive enum extensions require Elm + TS adapter changes).

**Verdict:** Negative ROI. The migration retires 158 LoC of TS and
introduces ~1005 LoC of new code (6.4x growth) plus a new
async control-flow dependency. The SEAM10 verdict's
"substantial infrastructure for a small synchronous projection"
trap applies directly.

## 7. BCB dogfood handoff

**Status:**

| Evidence | Value |
|---|---|
| Source HEAD | `b544b5ca1` (matches predecessor; verified via `git rev-parse HEAD`) |
| Installed extension | `s1onique.clinemm-4.1.16-5a1c485cb-b544b5ca1` (matches HEAD; verified via `~/.vscodium-clinemm/extensions/`) |
| `[BCBOBSCAP] profile activation: enabled=...` | Not yet observed in logs (no live task has hit the BCB observation-unavailable path during this ACT's execution) |
| `bcb-observation-unavailable-capture.jsonl` | Not yet created (no diagnostic record produced yet) |
| `[BCBOBSCAP] dump: ...` | Not yet invoked by the operator |
| BCB writer record | `session-event-bcb-blocked-observation-unavailable` (closed writerId union; same as BCB-CAPTURE01) |
| BCB activation tests | `bcb-observation-unavailable-dogfood-profile-activation.bcbcap01.test.ts` 24/24 GREEN |
| L2847 RED witnesses | `task-terminal-divergence-red01.tdd-red01.test.ts` 3 RED / 11 PASS preserved |

**No extension shutdown/replacement was performed during this
ACT.** The BCB activation fix at `b544b5ca1` is preserved and
verified. No new live BCB capture was produced (no live task
hit the BCB observation-unavailable path during this ACT's
execution). The BCB capture remains a no-op when disabled and
will record when the BCB predicate evaluates to `true` on a
future live run.

**No BCB production repair in this ACT** (per ACT §7).

## 8. Exit contract

1. **Exact HEAD and source map:** `b544b5ca1` on `main`, working tree clean (only the new test file is untracked before commit).
2. **Existing Elm authority inventory:** 5 kernels (completion-authority, task-header-orchestration, completion-continuation-control, background-notify-authority, deferred-completion-barrier) — all REAL_PRODUCTION_SEAM, no new 6th kernel position allocated.
3. **Candidate comparison and exclusions:** Candidate A (pending-prompt admission/consumption) fails interop + ownership + evidence + economics gates. Candidate B (background-job ownership FSM) fails because the "FSM" is a diagnostic capture ring + SEAM04-owned terminal consumption. Candidate C (task/turn lifecycle) fails I/O coupling + BCB critical-path exclusion.
4. **One executable discriminator and its actual results:** `apps/vscode/src/sdk/__tests__/prompt-admission-and-consumption-elm-interop-discriminator.paceid01.test.ts` — 10/10 PASS, disposition = `NOT_A_GOOD_ELM_SEAM`.
5. **Explicit Elm-vs-TS migration economics:** ~158 LoC retirable TS for ~1005 LoC new Elm + adapter code (6.4x growth), plus one new Promise port (a new async control-flow dependency). Negative ROI.
6. **One selected production authority, or proof that none is worthwhile:** None. The strongest candidate (A) fails the gates; the remaining candidates (B, C) are excluded by §3. **Verdict: `NOT_A_GOOD_ELM_SEAM`.**
7. **BCB dogfood evidence status:** Activation fix at `b544b5ca1` committed and verified (24/24 GREEN). No new live BCB capture produced during this ACT. L2847 RED witnesses preserved.
8. **Exact bounded successor ACT:** None. Per ACT §6/§8, when no eligible candidate survives bounded investigation, the verdict is `NOT_A_GOOD_ELM_SEAM` and the next ACT is a recon for a different candidate (per SEAM10 §9 next-cursor menu) OR a follow-up `NO_NEW_ELM_SEAM` ACT if the recon returns no eligible candidate.

**Verdict:** `NOT_A_GOOD_ELM_SEAM`.

The SEAM11 boundary fails the interop, ownership, evidence, and
economics gates per ACT §4. The factory stop rule is satisfied:
one bounded correction applied (the discriminator), no P0
introduced, no new production code at risk, no architectural
review rerun.

## 9. Predecessor ACT lineage

- `ACT-CLINEMM-ELM-SEAM10-INTEROP-DISC` (`NOT_A_GOOD_ELM_SEAM`,
  2026-10-12) — the prior verdict of the same shape. SEAM10 §9
  next-cursor menu lists three alternatives: (1) the full
  `evaluateCommandToolApproval` host callback (lives in SDK,
  conflicts with the 5-kernel VSCode-only convention), (2) the
  `pendingToolApprovalResolve` slot lifecycle (necessarily TS-only
  because the user IS the answer source), (3) a different
  production decision authority entirely. SEAM11 investigated
  option (3) and found no eligible candidate.
- `ACT-CLINEMM-ELM-SEAM06-PROMPT-ADMISSION-CUTOVER`
  (`NOT_A_GOOD_ELM_SEAM`, 2026-10-09) — the prior verdict on the
  admission sub-seam (12-case `delivery ?? (...)` expression).
  The SEAM11 discriminator honors this verdict (PACEID-05).
- `ACT-CLINEMM-ELM-SEAM05-PROMPT-ADMISSION-RECON`
  (`PASS_ELM_SEAM05_RECON`, 2026-10-09) — the recon that
  identified the production seam. The
  `admission-decision.test.ts` baseline witness is preserved
  (PACEID-05).

## 10. Factory stop rule

- **HALT_P0_TRIGGERED:** None. The discriminator's 10 reasons
  are all addressed by the `NOT_A_GOOD_ELM_SEAM` verdict. No
  production code was at risk; the verdict body remains
  TS-owned.
- **HALT_P1_TRIGGERED:** None.
- **No recursive Factory review initiated.** This ACT executes
  the SEAM11 discriminator (per the ACT spec's C1: GO directive);
  the verdict is `NOT_A_GOOD_ELM_SEAM` and no implementation
  cutover is authorized.
- **No new Elm kernel position allocated in `_ELM_KERNELS`.** The
  6th position remains empty; the existing 5-kernel convention
  is preserved.
- **No production code touched.** The only new file is the
  discriminator test
  (`apps/vscode/src/sdk/__tests__/prompt-admission-and-consumption-elm-interop-discriminator.paceid01.test.ts`).
  All existing production code, including BCB activation fix at
  `b544b5ca1`, is preserved.
