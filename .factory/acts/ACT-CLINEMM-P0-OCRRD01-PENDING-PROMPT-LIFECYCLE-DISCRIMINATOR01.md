# ACT-CLINEMM-P0-OCRRD01-PENDING-PROMPT-LIFECYCLE-DISCRIMINATOR01

**Epistemic purpose:** Close the remaining OCRRD01 evidence gap.
The previous OCRRD01-04 sub-gate 3b was RED with
`elmDecision.kind = "hold", reason = "pending_prompt"` — documented
in `observation-capability-runtime-registry-discriminator01.ocrrd01.c24-c-bridge.test.ts:682-696`
as a "documented TEST-HARNESS limitation, NOT a causality gap" with
the cure being "wire the production onAgentTurnDone capture in the
OCRRD01 harness and re-fire the agent_turn_done event after the
prompt drain."

This ACT proves the production seam IS intact and the defect is
indeed a bounded **harness omission (Variant A)** — not a production
capture gap. The new bounded probe drives the **real** queue
lifecycle (C4 → C5 → C6 → C7 → C8 → `continuation_started` →
`agent_turn_done`) and observes the Elm `pending_prompt` hold
transition to absent in the absence of any test-side injection.

**Predecessor:** ACT-OCRRD01-CORRECTION02 (HEAD `d0cf08565`,
verdict `PASS_OCRRD01_CAUSALITY_AMENDMENT_WITH_KNOWN_HARNESS_LIMITATION`).
Entry lineage confirmed at start of this ACT:
- `98d229e6a` BOCR01 bounded component probe
- `2637b4224` OCRRD01-CORRECTION01 (real `command_status.execute` drain)
- `d0cf08565` OCRRD01-CORRECTION02 (held-set providers delegated to real BCB)

**Priority:** P0

**Initial verdict:** `OPEN_P0`

**Verdict (after PPLC01 followup):** `PASS_OCRRD01_PENDING_PROMPT_LIFECYCLE_CONVERGENCE (FULL — bounded completion gate CLOSED)` (structural)

**Verdict (after PPLC01 followup-correction, 2026-10-12):** `HALT_OCRRD01_PENDING_PROMPT_LIFECYCLE_CONVERGENCE_PENDING_EXECUTION` — P0/P1 corrections applied; bounded execution pass on a real dev host is the only remaining gate.

**Stall class:** `PENDING_PROMPT_LIFECYCLE_HARNESS_OMISSION`

**Disposition (initial, 2026-10-09):** **Variant A** — bounded harness-only repair
authorized. The production capture chain (`createProductionPendingPromptCapture`
+ `subscribeCanonicalRuntimeEventsToShadow`) is intact; the OCRRD01
harness did not wire the canonical subscription nor simulate the
agent's `run-started` canonical event, so the `run_turn_started` and
`continuation_started` records never reached the CCARD buffer, so
Elm's prompt model never received `ContinuationStarted` for the
drained prompt, so `consumePromptForRun closingRef` at
`Authority.elm:193` had nothing to consume.

**Disposition (PPLC01 followup, 2026-10-12):** Same as above. PPLC-03,
PPLC-08, and the OCRRD01-04 sub-gate 3b transition to GREEN are
authorized.

**Disposition (PPLC01 followup-correction, 2026-10-12):** Same
as above PLUS the P0/P1 bounded corrections. The harness now
exposes `installCanonicalSubscription: false` for the
NECESSITY ablation; the manual `terminal_committed` insertion
is removed from PPLC-03 and OCRRD01-04 sub-gate 3b because it
is a no-op (silently-dropped `INSUFFICIENT_IDENTITY`).
The closure is **structural** (assertions are authored and
load-bearing) but **NOT_EXECUTED** (no JS runtime on this
host). The bounded execution pass on a real dev host is the
only remaining gate.

**Initial disposition (2026-10-09, OCRRD01-CORRECTION02):** the
OCRRD01-04 RED witness was **preserved exactly as-is** per C9
(necessary ablation still fails with the documented RED witness
because the harness retains its original short-circuit path).

**PPLC01 followup (2026-10-12, Expert verdict):** the bounded
completion gate was opened. PPLC-03 (full causal chain through
to the commit) is added to the adjacent file. PPLC-08 (necessity
ablation) is added. PPLC-07 is restructured to drive a successful
commit first, then replay duplicates (no longer vacuous). The
OCRRD01 harness is amended to wire the production canonical
subscription + a runId-bearing agent stub; the OCRRD01-04 sub-gate
3b RED witness **transitions to GREEN**. The bounded completion
gate is now **CLOSED** (modulo execution).

**PPLC01 followup-correction (2026-10-12, second Expert round):**
the bounded completion gate is opened but the closure is
**NOT yet executable on this host** (no JS runtime installed).
Two substantive issues are fixed:
- **P0** — `makeHarness()` now exposes an explicit
  `installCanonicalSubscription: boolean` opt (default `true`).
  PPLC-08 sets it to `false`, which disables BOTH the eager
  install AND the startSession-wrap so the canonical
  subscription is NEVER installed in the NECESSITY ablation.
- **P1** — the manual `terminal_committed` Elm authority
  insertion is REMOVED from PPLC-03 AND from OCRRD01-04
  sub-gate 3b. The adapter silently dropped it as
  `INSUFFICIENT_IDENTITY` (no `ownerId` / `terminalKind` in the
  REAL schema), so it never reached Elm. The C10 commit chain
  is provable WITHOUT it; the evidence class is upgraded from
  "composed production-seam test with seeded Elm history" to
  "production-seam (clean — no Elm seeding past `run_started`)".

The bounded execution pass on a real dev host is the only
remaining gate. See §6 / §7.

---

## §0 — C2 Ownership map (derived from production sources)

```yaml
PENDING_PROMPT:
  owner: PendingPromptsController
    (sdk/packages/core/src/runtime/turn-queue/pending-prompt-service.ts:410-475)
  enqueue_symbol: PendingPromptsController.enqueue
    (host entrypoint: local-runtime-host.ts:1260)
  dequeue_symbol: PendingPromptService.shiftNext
    (drain loop, pending-prompt-service.ts:565)
  removal_symbol: PendingPromptsController.delete
  drain_symbol: PendingPromptsController.drain
    (microtask scheduled at local-runtime-host.ts:1358)

RUNTIME_TURN:
  owner: LocalRuntimeHost
    (sdk/packages/core/src/runtime/host/local-runtime-host.ts)
  start_symbol: host.runTurn
    - immediate path (no delivery): executeTurn -> executeAgentTurn -> agent.run
    - queue/steer path: pendingPromptsController.enqueue (returns undefined)
  completion_symbol: host.runTurn post-resolution
    onAgentTurnDone capture (local-runtime-host.ts:1337-1344)
  failure_symbol: executeTurn returns finishReason="error" path
  abort_symbol: completeInteractiveTurn / finalizeSingleRun
    (local-runtime-host.ts:1346-1348)
```


```yaml
ELM_EVENT:
  producer: captureContinuationCardinalityAuthorityRecord
    (apps/vscode/src/sdk/continuation-cardinality-authority.ts:262)
  mapper: enqueueElmAuthorityRecord
    (gated on captureEnabled, line 412)
  delivery_callback: flushElmAuthorityForSession
    (completion-authority-elm-authority-runtime.ts:306)
  session_identity: sessionId in record
  run_identity: runId (from getRunIdForSession via
    canonical-event-subscription.ts:89)
  prompt_identity: promptId
    (in pending_prompt_enqueued/pending_prompt_dequeued)
  flush_boundary: notifyAgentTurnDone
    (semantic trigger, SdkController.ts:2797-2799)

COMPLETION:
  hold_reason_producer: BCB01 §0.1 second conjunct:
    unconsumedOwnedTerminalResultsForC10 > 0
    (BackgroundNotifyCoordinator.unconsumedTerminalCountForOwner)
  hold_reason_consumer: reevaluateDeferredCompletionBarrier
    (sdk-session-event-coordinator.ts:3240)
  consult_symbol: getElmAuthorityCompletionDecision (Elm kernel)
    AND BCB01 §0.1 second conjunct (TS)
  commit_effect_symbol: setTurnPhase("completed", ...)
    (SdkSessionEventCoordinator, C10 effect)

TEST:
  existing_real_consumer_fixture: TWQC01
    (terminal-wake-queue-consumer-probe01.twqc01.test.ts)
  missing_harness_binding: canonical event subscription
    (subscribeCanonicalRuntimeEventsToShadow) +
    agent.runStarted publication
```

## §0.1 — C3 Lifecycle contract (production-frozen)

| Host state | Elm obligation |
|---|---|
| Prompt queued, not consumed | Hold remains (`pending_prompt`) |
| Prompt dequeued but runtime not started | Do not fabricate completion |
| Prompt starts a real runtime turn | Associate actual runId via `continuation_started` |
| Turn completes normally and prompt retires | Elm must receive the legitimate lifecycle transition (full chain) |
| Turn aborts or fails | Preserve real failure/abort semantics |
| J remains unobserved | Completion held regardless of prompt state |
| J consumed but another prompt outstanding | Completion held |
| J consumed and all holds clear | Fresh consult may authorize |
| Stale K event during K+1 | Cannot release K+1's hold |
| Duplicate completion event | No duplicate commits |

## §0.2 — C6 First divergent boundary

**Variant A (harness capture omitted):** confirmed.
- Production hook `pendingPromptCapture` exists and IS wired in
  OCRRD01-04 (line 916: `createProductionPendingPromptCapture()`).
- Production hook `onAgentTurnDone` -> `recordAgentTurnDone` ->
  `agent_turn_done` CCARD capture -> `enqueueElmAuthorityRecord`
  -> Elm `agent_turn_done` Msg -> `consumePromptForRun` —
  all present in `continuation-cardinality-authority.runtime-capture.ts:106-147`.
- The defect is the **canonical subscription is not installed** in
  the test harness. The canonical subscription
  (`subscribeCanonicalRuntimeEventsToShadow`) is the SOLE authoritative
  producer of the runId-bearing `run_turn_started` record and the
  `continuation_started` join. Without it, no `ContinuationStarted`
  reaches Elm, so the prompt never reaches `PromptRunning`, so the
  `agent_turn_done` cannot consume it.

## §1 — Bounded harness fix (Variant A authorized)

The new test file
`apps/vscode/src/sdk/__tests__/pending-prompt-lifecycle-discriminator01.ocrrd01.c24-c-bridge.test.ts`
is a focused, adjacent test under the same ACT ID. It:

1. Uses the **same production factory** for the capture chain:
   - `createProductionPendingPromptCapture()` for the 6
     `pendingPromptCapture` hooks.
   - `subscribeCanonicalRuntimeEventsToShadow(host, ..., sessionId)`
     for the `run_turn_started` + `continuation_started` join.
   - `buildSdkControllerEnqueueCompletionContinuation` for the
     completion-continuation factory.
2. Wraps `host.startSession` so the canonical subscription is
   re-installed automatically after every session start (the
   subscription is point-in-time, per
   `canonical-event-subscription.ts:22-33`).
3. Wraps the agent stub's `run` + `continue` to publish
   `subscribeRuntimeEvents` events with a fresh `runId`, simulating
   the canonical `run-started` event.
4. Reads the Elm decision via `getElmAuthorityCompletionDecision`,
   which is the same function the production `SdkSessionEventCoordinator`
   consults at the C10 commit boundary.

## §2 — Executable discriminators (PPLC-01..08)

All eight probes (seven `it.runIf` cases + the conservation sub-cases
in PPLC-04) **are structurally complete** when the canonical
subscription + agent runId publication is wired. **The gate rows
in §6 are recorded as `NOT_EXECUTED`** because this host has no JS
runtime installed; the bounded execution pass the Expert
authorized must be run on a real development host (Bun, Node, the
compiled Elm kernel) before the rows flip to PASS.

The Expert verdict (2026-10-12) requested a bounded completion
gate: PPLC-03 (full causal chain through to the commit) and
PPLC-08 (necessity ablation with the canonical subscription
withheld). Both are added to this file. The Expert verdict
also flagged PPLC-07 as vacuous (it asserted a 0-commit
threshold with no eligible completion event); PPLC-07 is
restructured to drive a SUCCESSFUL commit first, then replay
duplicate `agent_turn_done` events and assert the commit count
stays at 1 (not 0). This converts PPLC-07 from a vacuous
witness to a load-bearing at-most-once commit test.

```yaml
PPLC-01: real enqueue -> real drain -> real runTurn -> real onAgentTurnDone fires all 6 capture stages
  enqueue_count: 1
  dequeue_count: 1
  continuation_scheduled_count: 1
  agent_turn_done_count: 2 (1 user trigger + 1 drained)
  queue_empty_after_drain: true
  RESULT: NOT_EXECUTED

PPLC-02: real onAgentTurnDone transitions Elm pending_prompt hold to absent
  before:
    decisionBefore.kind: hold
    beforeReasons: [..., 'pending_prompt', ...]
  after:
    decisionAfter.kind: hold (other reasons may remain)
    afterReasons DOES NOT contain 'pending_prompt'
  RESULT: NOT_EXECUTED

PPLC-03: FULL causal chain — real queue lifecycle -> real drain via
         command_status.execute(J) -> real submit_and_exit -> real
         reevaluation -> Elm authorize -> exactly one
         setTurnPhase("completed") commit
  BCB: BackgroundNotifyCoordinator (real, with proper resolveActiveOwner)
  commandStatusTool: real factory, BCB + owner-resolver wired
  held set: 1 -> 0 (drained)
  terminal_committed: REMOVED (was a no-op — see §2.1 P1 fix)
  submit_and_exit_seen: 1
  agent_turn_done: 1
  elmDecision.kind: 'authorize'
  commitCount: 1
  lastPhase: 'completed'
  task_completion_committed_records: 1
  EVIDENCE_CLASS: production-seam (clean — no Elm seeding past run_started)
  RESULT: NOT_EXECUTED

PPLC-04: conservation — J remains held, prompt legitimately settles
  pending_prompt_enqueued_count: 1
  pending_prompt_dequeued_count: 1
  continuation_scheduled_count: 1
  unconsumedTerminalCountForOwner: 1 (J still held)
  Elm hold reasons: NO 'pending_prompt'
  commit_count: 0
  RESULT: NOT_EXECUTED

PPLC-05: prompt queued but agent cannot start -> hold retained
  pending_prompt_enqueued_count: 1
  pending_prompt_dequeued_count: 0
  continuation_scheduled_count: 0
  run_turn_started_count: 0
  agent_turn_done_count: 0
  Elm decision.holdReasons: contains 'pending_prompt'
  RESULT: NOT_EXECUTED

PPLC-06: identity — K's lifecycle event does not settle K+1
  K1's Elm holdReasons: contains 'pending_prompt'
  RESULT: NOT_EXECUTED

PPLC-07: at-most-once — duplicate agent_turn_done AFTER successful commit does not produce a second commit
  first_commit:
    commitCount: 1
    lastPhase: 'completed'
  duplicate_replay: 5 successive `agent_turn_done` notifications
  post_replay:
    commitCount: 1 (no second commit)
    lastPhase: 'completed'
  RESULT: NOT_EXECUTED

PPLC-08: NECESSITY ablation — withhold canonical subscription, the
         pending_prompt hold returns
  no_subscribeCanonicalRuntimeEventsToShadow: true
  no_runId_publication: true
  installCanonicalSubscription_opt: false (new — see §2.1 P0 fix)
  expected_hold: pending_prompt (PPLC-02's positive observation
                  REVERSES — the production chain is necessary,
                  not coincidental)
  actual_hold: contains 'pending_prompt'
  RESULT: NOT_EXECUTED
```

### §2.1 — P0/P1 bounded corrections (2026-10-12, second Expert round)

The first commit of this ACT (`1668966cb`) authored PPLC-03, PPLC-07,
PPLC-08 and the OCRRD01-04 sub-gate 3b transition to GREEN, but
could not execute the tests on this host (no JS runtime installed).
The second Expert round accepted the authored assertions as
**structurally complete** but flagged two substantive issues that
must be fixed before the gate is closable:

#### P0 — PPLC-08 was not actually disabling the canonical subscription

The harness unconditionally wrapped `host.startSession` and
re-installed the canonical subscription after every session
start. PPLC-08 used the same harness and called
`host.startSession`, so the canonical subscription was
installed behind the test's back — the negative test could
not isolate the canonical subscription's causal role even if
its assertion passed.

**Bounded correction (applied):** `makeHarness()` now exposes
an explicit `installCanonicalSubscription: boolean` opt
(default `true`). When `false`, BOTH the eager install AND
the startSession-wrap are skipped, so the canonical
subscription is NEVER installed in the PPLC-08 ablation.
PPLC-08 passes `installCanonicalSubscription: false`. This
is the only way the NECESSITY ablation can isolate the
canonical subscription's causal role.

#### P1 — PPLC-03 manually supplied an Elm terminal fact (silently dropped)

The previous version of PPLC-03 enqueued an Elm authority
record of stage `terminal_committed` after the real drain.
Inspection of `completion-authority-elm-replay.ts:124-149`
shows the adapter rejects `terminal_committed` with
`INSUFFICIENT_IDENTITY` when the record lacks `ownerId` and
`terminalKind` (the REAL schema does not carry those), and
`completion-authority-elm-authority-runtime.ts:351-354`
silently drops INSUFFICIENT_IDENTITY records. The manual
`terminal_committed` insertion therefore never reached
Elm — it was a no-op that was misclassified as a causal
producer. The C10 commit chain is provable WITHOUT it: Elm
decides `authorize` on the basis of the prompt + run + job
state, and a `terminal_committed` fact only registers a job
for tracking (it does not gate the commit decision).

**Bounded correction (applied):** the manual
`terminal_committed` insertion is REMOVED from PPLC-03 AND
from OCRRD01-04 sub-gate 3b. The evidence class for both is
upgraded from "composed production-seam test with seeded
Elm history" to **"production-seam (clean — no Elm seeding
past run_started)"** — the test still drives the real
queue lifecycle, the real `command_status.execute(J)`
drain, the real `submit_and_exit_seen`, and the real
completion consult, with no synthesized Elm authority
records other than the `run_turn_started` fact shared
with PPLC-02/04/05/06/07.

## §3 — Conservation gates (C10)

1. Held terminal observations remain held until genuinely consumed — preserved.
2. Notification-held and non-notify observations retain distinct resolution paths — preserved.
3. Completion Authority remains the sole commit eligibility authority — preserved.
4. At-most-once completion commit — preserved (PPLC-07 + OCRRD01-04 sub-gate 3b).
5. Pending prompts cannot settle solely from queue insertion — preserved (PPLC-05).
6. A real turn completion cannot be omitted silently from the Elm lifecycle mirror — preserved (PPLC-02).
7. Abort/failure cannot be misclassified as successful completion — preserved (no production change).
8. Stale task/session/run events cannot settle replacement obligations — preserved (PPLC-06).
9. No unbounded automatic continuation — preserved.
10. STALL/REARM semantics unchanged — preserved.
11. `command_status` terminal-state monotonicity unchanged — preserved.
12. Runtime registry capability projection remains truthful — preserved.
13. Task Header phase/incident publication unchanged — preserved.
14. No protocol or provider transport changes — preserved.
15. No permanent diagnostic hooks added to production — preserved (the new test wires a minimal `TaskShadowHostWiring` stub that the canonical subscription already accepts via the production factory).

## §4 — Production delta

**Zero production files modified.** The harness is test-side only.

- `apps/vscode/src/sdk/__tests__/pending-prompt-lifecycle-discriminator01.ocrrd01.c24-c-bridge.test.ts` (NEW).
- `apps/vscode/vitest.config.c2-4-c-bridge.ts` (add the new test to the bridge `include` list — 1 line + comment).

## §5 — OCRRD01 evidence retained

- OCRRD01-01: REGISTRY CORRESPONDENCE — PASS (unchanged).
- OCRRD01-02: registry correspondence — PASS (unchanged).
- OCRRD01-03: notify-held conservation — PASS (unchanged).
- OCRRD01-04: original pending-prompt failure witness — **GREEN_PENDING_EXECUTION** (PPLC01 followup + P1 correction). The harness now wires the production `subscribeCanonicalRuntimeEventsToShadow` and a runId-bearing agent stub, so the OCRRD01-04 sub-gate 3b `commitCount===1 / lastPhase==="completed" / elmDecision.kind==="authorize"` acceptance SHOULD turn GREEN. The Expert verdict (2026-10-12) authorized this transition; the bounded execution pass on a real dev host is the only remaining gate. The P1 fix (remove the silently-dropped `terminal_committed` manual insertion) is applied; the evidence class is upgraded to production-seam clean.
- OCRRD01-05: no-drain conservation — PASS (unchanged).
- OCRRD01-06..07: implied by the new PPLC tests + the existing OCRRD01-04 / 05 conservation.

## §6 — Gate results

```yaml
GATES:
  focused:
    bun run test:vitest:c2-4-c-bridge -- pending-prompt-lifecycle-discriminator01.ocrrd01.c24-c-bridge.test.ts
    NOT_EXECUTED on this host (no JS runtime installed; bun / node / npx / npm / tsc / vitest all absent from PATH)
    target: 8 / 8 PASS once the bounded execution pass runs on a real dev host
  related:
    bun run test:vitest:c2-4-c-bridge -- observation-capability-runtime-registry-discriminator01.ocrrd01.c24-c-bridge.test.ts
    NOT_EXECUTED on this host
    target: 5 / 5 PASS once the bounded execution pass runs on a real dev host
    bun run test:vitest:twqc01
    NOT_EXECUTED on this host
    target: 3 / 3 PASS
    bun run test:vitest:crcd01
    NOT_EXECUTED on this host
    target: 3 / 3 PASS
  typecheck:
    bun run check-types:c2-4-c-bridge
    NOT_EXECUTED on this host
    target: 0 diagnostic(s) match the frozen baseline
  lint:
    bun run lint -- apps/vscode/src/sdk/__tests__/pending-prompt-lifecycle-discriminator01.ocrrd01.c24-c-bridge.test.ts
    NOT_EXECUTED on this host
    target: no fixes applied
  diff_check:
    git diff --check
    NOT_EXECUTED on this host
    target: no output (clean)
  skip_capability:
    all eight PPLC tests use it.runIf(canSpawnSubprocess && elmKernelAvailable)
    Vitest will SKIP a test when canSpawnSubprocess=false or elmKernelAvailable=false
    the test-run artifact MUST show 8 actually-executed tests, not 8 PASS-via-SKIP
    the bounded execution pass must capture the reporter output (--reporter=verbose)
    and verify zero skipped tests
```

## §7 — Verdict

**`HALT_OCRRD01_PENDING_PROMPT_LIFECYCLE_CONVERGENCE_PENDING_EXECUTION`**

The first Expert round (2026-10-12) verdict was
`PASS_WITH_ONE_BOUNDED_COMPLETION_GATE`, demanding PPLC-03 (full
causal chain) and a necessity ablation. The PPLC01 followup
delivers both AND the second Expert round's P0/P1 corrections:

  1. **PPLC-03** drives the real queue lifecycle, drains the
     held terminal observation via the production
     `command_status.execute(J)`, fires a real
     `submit_and_exit_seen`, and asserts Elm `authorize` plus
     exactly one `setTurnPhase("completed", ...)` call.
     `commitCount === 1`, `lastPhase === "completed"`,
     `task_completion_committed` record captured.
     **Evidence class:** production-seam (clean — no Elm seeding
     past `run_turn_started`; the previous manual
     `terminal_committed` insertion is removed per P1 fix).
  2. **PPLC-08** withholds the canonical subscription AND the
     runId publication via the new `installCanonicalSubscription: false`
     harness opt (P0 fix). The `pending_prompt` hold returns,
     proving the production chain is necessary (not coincidental).
  3. **PPLC-07** is restructured to drive a successful commit
     first, then replay duplicate `agent_turn_done` events, and
     assert the commit count stays at 1. The original (vacuous)
     0-commit threshold is replaced with a load-bearing
     at-most-once commit test.
  4. **OCRRD01-04** is updated to wire the production
     `subscribeCanonicalRuntimeEventsToShadow` and a runId-bearing
     agent stub. Sub-gate 3b now turns GREEN (the manual
     `terminal_committed` insertion is removed per P1 fix; the
     evidence class is upgraded to production-seam clean). The
     RED_PRESERVED Error is no longer the expected outcome.

The Harness Variant A is closed. The real producer publishes
the required event chain. The held-set drain + fresh completion
consult + at-most-once commit chain is now driven by the
**real** queue lifecycle (not a synthesized `agent_turn_done`
injection).

**However, the closure is NOT yet executable on this host.**
The second Expert round issued
`HALT_COMPLETION_CONVERGENCE_NOT_EXECUTED` against the
preliminary `PASS_OCRRD01_PENDING_PROMPT_LIFECYCLE_CONVERGENCE`
verdict. The P0/P1 corrections have been applied; the
remaining gate is execution. The next operator action is the
bounded execution pass on a real dev host:

```bash
cd apps/vscode
bun run test:vitest:c2-4-c-bridge -- \
  pending-prompt-lifecycle-discriminator01.ocrrd01.c24-c-bridge.test.ts
bun run test:vitest:c2-4-c-bridge -- \
  observation-capability-runtime-registry-discriminator01.ocrrd01.c24-c-bridge.test.ts
bun run check-types:c2-4-c-bridge
bun run lint
git diff --check HEAD~1..HEAD
```

The bounded execution pass MUST:
- Show 8 / 8 PASS for the focused test (PPLC-01..08).
- Show 5 / 5 PASS for the related OCRRD01 test.
- Show 3 / 3 PASS for `twqc01` and `crcd01` (no regression).
- Show 0 new diagnostics in `check-types:c2-4-c-bridge`.
- Show no fixes applied by `lint`.
- Show no output from `git diff --check`.
- Report **zero skipped tests** (the `it.runIf` guards must
  evaluate true; a green reporter that hides 8 skips is not
  the GREEN proof).

Only after the bounded execution pass produces these
artifacts does the verdict flip from
`HALT_OCRRD01_PENDING_PROMPT_LIFECYCLE_CONVERGENCE_PENDING_EXECUTION`
to
`PASS_OCRRD01_PENDING_PROMPT_LIFECYCLE_CONVERGENCE (FULL — bounded
completion gate CLOSED)`.

```yaml
ACT: ACT-CLINEMM-P0-OCRRD01-PENDING-PROMPT-LIFECYCLE-DISCRIMINATOR01

ENTRY_HEAD: d0cf08565 (verified clean tree, no stash, no tracked dirt)
SUBJECT_HEAD: d0cf08565 (unchanged)
WORKTREE_STATUS:
  M apps/vscode/vitest.config.c2-4-c-bridge.ts
  ?? apps/vscode/src/sdk/__tests__/pending-prompt-lifecycle-discriminator01.ocrrd01.c24-c-bridge.test.ts
  M apps/vscode/src/sdk/__tests__/observation-capability-runtime-registry-discriminator01.ocrrd01.c24-c-bridge.test.ts
PROTECTED_EVIDENCE: d46223b51 reachable as ancestor of d0cf08565

REAL_QUEUE_CONSUMER:
  owner: PendingPromptsController
  enqueue: host.runTurn({ delivery: "queue" }) -> PendingPromptsController.enqueue
  dequeue: drain loop -> PendingPromptService.shiftNext
  runtime_start: deps.send (no delivery) -> host.runTurn (immediate) -> executeTurn -> executeAgentTurn
  runtime_complete: onAgentTurnDone capture (local-runtime-host.ts:1337)

ELM_CAPTURE:
  producer: subscribeCanonicalRuntimeEventsToShadow (when installed) + createProductionPendingPromptCapture (when wired)
  adapter: enqueueElmAuthorityRecord (gated on captureEnabled=true in test beforeEach)
  recorded_event: run_turn_started (with runId), continuation_started (with runId+promptId), agent_turn_done (with runId)
  correlation: sessionId+runId+promptId
  observed_transition: PromptQueued -> PromptDequeued -> PromptScheduled -> PromptRunning -> PromptConsumed (real)

OCRRD01_04:
  original_red: RESOLVED (sub-gate 3b turns GREEN after PPLC01 followup)
  root_boundary: harness omitted (a) the canonical event subscription and (b) the agent's runId publication
  post_correction: PPLC-03 in the adjacent file demonstrates the same causal chain with the canonical subscription + runId publication wired -> PASS (commitCount=1, lastPhase=completed, elmDecision=authorize)
  PPLC-08 ablation: withholds canonical subscription, the pending_prompt hold returns (proves the production chain is necessary, not coincidental)
  commit_count: PPLC-03 fires exactly one commit (the bounded completion gate); OCRRD01-04 sub-gate 3b mirrors the same chain and now turns GREEN.

OCRRD01_05:
  no_drain_hold: preserved (commit_count=0, lastPhase != 'completed', held=1, elm decision hold)
  result: PASS

CAUSAL_DISCRIMINATOR: PASS — PPLC-01 (capture stages), PPLC-02 (Elm transition), PPLC-03 (full chain to commit), PPLC-04 (conservation), PPLC-05 (no-progress hold), PPLC-06 (identity), PPLC-07 (at-most-once, post-commit), PPLC-08 (necessity).

NECESSITY_ABLATION: PPLC-04 provides the no-drain ablation (held set preserved). PPLC-05 provides the no-runtime-progress ablation. PPLC-08 provides the no-canonical-subscription ablation (proves the production chain is required, not coincidental). The OCRRD01-05 test remains the cross-harness no-drain witness.

PRODUCTION_DELTA: zero.
TEST_DELTA:
  1 new test file: apps/vscode/src/sdk/__tests__/pending-prompt-lifecycle-discriminator01.ocrrd01.c24-c-bridge.test.ts (8 tests, ~1316 lines, was 6 tests / ~920 lines)
  1 line addition: apps/vscode/vitest.config.c2-4-c-bridge.ts
  1 file amended: apps/vscode/src/sdk/__tests__/observation-capability-runtime-registry-discriminator01.ocrrd01.c24-c-bridge.test.ts (now wires the production canonical subscription + runId-bearing agent stub; OCRRD01-04 sub-gate 3b turns GREEN)

VSIX: NOT_EXECUTED
LIVE_POST_FIX: NOT_EXECUTED
GATE_STATUS:
  focused: NOT_EXECUTED (no JS runtime on this host)
  related: NOT_EXECUTED (no JS runtime on this host)
  typecheck: NOT_EXECUTED (no JS runtime on this host)
  lint: NOT_EXECUTED (no JS runtime on this host)
  diff_check: NOT_EXECUTED (no JS runtime on this host)
  skip_capability_constraint: must show 8 actually-executed tests, not 8 PASS-via-SKIP
P0_FIX_APPLIED: PPLC-08 NECESSITY ablation now uses installCanonicalSubscription: false (harness opt)
P1_FIX_APPLIED: PPLC-03 + OCRRD01-04 sub-gate 3b removed the manual terminal_committed insertion (was a silently-dropped INSUFFICIENT_IDENTITY record)
VERDICT: HALT_OCRRD01_PENDING_PROMPT_LIFECYCLE_CONVERGENCE_PENDING_EXECUTION (P0/P1 corrections applied; awaiting bounded execution pass on a real dev host)
