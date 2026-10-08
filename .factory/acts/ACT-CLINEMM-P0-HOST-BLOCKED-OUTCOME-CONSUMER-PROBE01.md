# ACT-CLINEMM-P0-HOST-BLOCKED-OUTCOME-CONSUMER-PROBE01

## C0 — Trust and entry identity

```
$ git status --short   (clean)
$ git rev-parse HEAD
9538ebd133b4ce4b75d29bca2bf04a531d378ed4
$ git log -1 --oneline
9538ebd13 fix(sdk): host blocked-outcome publication, CORRECTION01 state-integrity only
$ git diff --check     (clean)
$ git stash list
stash@{0}: WIP on main: d46223b51 fix(completion-continuation-stall-lifetime): separate REARM lifetime from STALL lifetime at BCB re-registration
```

Classification:
- `EXPECTED_CLEAN` ✅
- `PROTECTED_STASH` ✅ (stash@{0} on d46223b51 = Tart testbed work; preserved intact, never popped)

No `stash pop`, no `reset`, no automatic cleanup.

## C1 — Production scheduler ownership boundary

```
MARKER:
  writer:       SdkSessionEventCoordinator (private field, line 616)
                DeferredCompletionBarrier { sessionId, taskId, epoch, deferredAt, reason? }
  lifetime:     BCB01 §0.1 conservation predicates register on
                submit_and_exit; cleared when all four conservation
                checks pass; bounded single-key (at-most-one)
  reasons:      undefined (recoverable hold)
                "stalled_no_progress"     (BCB01 + K+1 disc verdict)
                "delivery_rejected"       (sdkHost.send rejected)
                "observation_unavailable" (reserved enum value)
  clear_sites:  BCB01 §0.1 success branch
                C4 active-session lookup (line 786-798 area)
                epoch supersession (identity triple)
                test-only setDeferredCompletionBarrierForTesting(undefined)

SCHEDULER:
  drain_symbol:           private drainIfIdle() and inner drain()
                          closure (sdk-session-rebuild-scheduler.ts:129-244)
  consumer_symbol:        isDeferredCompletionOutstanding() at line 125
                          -> this.deferredOutstandingPredicate()
  required_behavior:      stop checking the pending map when true;
                          await sessionBecameIdle() / request() /
                          runExclusive(); re-queue unexecuted snapshot
                          entries via suffix slice
  deferred_predicate:     () => boolean
  predicate_source:       SdkController.ts:2775 binds
                          () => this.sessionEvents
                              .isDeferredCompletionBarrierOutstandingForTesting()
                          which is a PURE `!== undefined` check on the
                          private marker field (line 629-631)
  result_type:            boolean
  state_owner:            SdkSessionEventCoordinator (the marker)

CONSUMERS:
  - SdkSessionRebuildScheduler.isDeferredCompletionOutstanding
    reads_marker_existence: TRUE
    reads_marker_reason:     FALSE
    observable_effect:       drain held, re-queue unexecuted
                             snapshot suffix
  - SdkSessionEventCoordinator.getDeferredCompletionBarrierForTesting
    reads_marker_existence: TRUE (returns the marker triple)
    reads_marker_reason:     TRUE (returns reason field)
    observable_effect:       TEST-ONLY accessor (per its own docstring)
  - recordBlockedOutcomeStalledNoProgress /
    recordBlockedOutcomeDeliveryRejected
    reads_marker_existence: indirect (only fired from the helper
                            that stamps the marker)
    reads_marker_reason:     N/A — these ARE the reason-recording fns
    observable_effect:       dogfood counter increment (opt-in
                             diagnostic, not a lifecycle consumer)

COMPLETION_PATH:
  writer:            SdkSessionEventCoordinator.handleSessionEvent
                     BCB01 §0.1 (submit_and_exit register path)
  elm_authority_gate: Elm kernel consult at C10 (L982, L2000-2075)
                     decoupled from marker reason stamp
  commit_effect:     when ALL conservation checks pass, marker
                     cleared, then completion commit fires
```

## C2-C3 — Frozen comparable states

The probe drives the actual `SdkSessionRebuildScheduler.drain` with
the production-shape predicate. Three otherwise identical states
were exercised, differing ONLY in the `reason` field:

| State | Barrier epoch | Barrier reason | Predicate returns |
|-------|---------------|----------------|-------------------|
| A — Recoverable | 0 | `undefined` | `true` |
| B — Stalled | 0 | `"stalled_no_progress"` | `true` |
| C — Rejected | 0 | `"delivery_rejected"` | `true` |

The scheduler's required contract is to hold drain in states A, B,
and C (none authorize rebuilding or task completion). State D
(barrier absent) authorizes drain; state E (genuine progress — marker
cleared by the existing BCB01 seam) authorizes drain.

The scheduler's safety invariants (CORRECTION04 suffix-slice
conservation; the C10 barrier predicate; the BCB01 §0.1 hold) are
unchanged in all three states.

## C4 — Executable production-consumer probe

Test file:
`apps/vscode/src/sdk/__tests__/host-blocked-outcome-consumer-probe01.hbocp01.test.ts`
(NEW, 6 tests, 6/6 GREEN, vitest native)

| Test | Setup | Observed scheduler effect |
|------|-------|---------------------------|
| HBOCP-01 | barrier + `reason=undefined` | `rebuild` not invoked; observer recorded `outstanding=true, reason=undefined` |
| HBOCP-02 | barrier + `reason="stalled_no_progress"` | `rebuild` not invoked; observer recorded `outstanding=true, reason="stalled_no_progress"` |
| HBOCP-03 | barrier + `reason="delivery_rejected"` | `rebuild` not invoked; observer recorded `outstanding=true, reason="delivery_rejected"` |
| HBOCP-04 | barrier + `reason="stalled_no_progress"` → remove via test seam → `deferredCompletionSettled` | `rebuild` invoked exactly once; barrier absent; no fabrication. **Narrowed conservation claim:** the probe proves the scheduler releases when the barrier is absent, NOT the causal path from real held-result consumption to barrier removal (the latter is the BCB01 §0.1 success branch, exercised by HBOP-30 / PCRA01 / mcprestart01). |
| HBOCP-05 | Real producer chain: K delivers, K+1 stalls | marker carries `reason="stalled_no_progress"`; `rebuild` not invoked; observer recorded `outstanding=true, reason="stalled_no_progress"` |
| HBOCP-06 | Three states in sequence: recoverable / stalled / rejected | All three return `outstanding=true` at the production wiring's predicate; the `reason` field is a strict refinement of the boolean |

Test command:
```
cd apps/vscode && bunx vitest run \
  src/sdk/__tests__/host-blocked-outcome-consumer-probe01.hbocp01.test.ts
# 6 passed (6) — all probes GREEN
```

## C5 — Real producer→consumer probe

PROBE-05 drives the full producer chain:
```
real completion event
  → SdkSessionEventCoordinator.handleSessionEvent (done)
  → BCB re-registration → deferredCompletionBarrier marker
  → enqueueCompletionContinuationIfHeld (K+1)
  → TS stall disc returns "stalled_no_progress"
  → .then((outcome) => applyBlockedCompletionContinuationOutcome(...))
  → DeferredCompletionBarrier.reason = "stalled_no_progress"
  → recordBlockedOutcomeStalledNoProgress() (opt-in dogfood counter)
  → SdkSessionRebuildScheduler.drain predicate
     () => isDeferredCompletionBarrierOutstandingForTesting()
     returns TRUE (the marker exists, regardless of reason)
  → drain held, no rebuild
```

## C6 — Host lifecycle consumer inventory

| Candidate | Status | Evidence |
|-----------|--------|----------|
| Runtime/session status projection | MISSING | No projection reads `barrier.reason`. `getStateToPostToWebview()` does not include the marker. |
| Existing task-state publication | EXISTING_BUT_BOOLEAN_ONLY | `setTurnPhase` does not consult `barrier.reason`. The Elm kernel consults policy but not host-marker reason. |
| Existing host callback/result | N/A | The Promise is the callback result; no host caller re-reads the typed verdict. |
| Existing operator diagnostic | DIAGNOSTIC_ONLY | `recordBlockedOutcomeStalledNoProgress` / `recordBlockedOutcomeDeliveryRejected` are opt-in dogfood counters. The only consumer is `getCompletionContinuationUpstreamCounters()`. |
| Rebuild scheduler | EXISTING_BUT_BOOLEAN_ONLY | CONFIRMED by PROBE-01..04 and the source read at `SdkController.ts:2775` / `sdk-session-event-coordinator.ts:629-631`. |

A diagnostic counter is not a lifecycle consumer. A test accessor is
not a production consumer. A log statement is not an actionable
blocked-state transition.

## C7 — Causal discriminator

| Hypothesis | Verdict | Evidence |
|------------|---------|----------|
| H1: scheduler should act differently on blocked reason under the current contract | NOT SUPPORTED | PROBE-01..03 establish that `reason=undefined` and `reason="stalled_no_progress"` produce the same `true` at the predicate and the same drain-held effect. The scheduler has no reason-aware branch in its source, and existing conservation requirements (BCB01 §0.1, C10 completion barrier, CORRECTION04 suffix-slice) do not authorize one. This is a *narrow* exclusion: the probe does not establish that no conceivable scheduler behavior could legitimately distinguish those reasons in the future. It establishes only that under the current contract, no reason-differentiation is required. |
| H2: scheduler correctly holds both states under the current contract | SUPPORTED | PROBE-01..03: drain held for all three reason states. PROBE-04 (narrowed conservation claim): barrier absence releases drain. The BCB01 §0.1 safety invariant and the suffix-slice CORRECTION04 conservation are unchanged. |
| H3: blocked state already consumed elsewhere | PARTIALLY | The dogfood diagnostic counters (`blockedOutcomeStalledNoProgress` / `blockedOutcomeDeliveryRejected`) increment from the helper. They are opt-in, not a lifecycle consumer. The test accessor reads the reason but is test-only. |
| H4: no host lifecycle consumer exists | SUPPORTED | Source search confirmed no production code path inspects `barrier.reason`. The only production-shaped predicate at the scheduler binding is a pure boolean (`!== undefined`). |

**Reviewer qualification (C-line, post-closure review):** H1 is "not supported by the current scheduler contract," not "universally disproven." A future contract change that authorizes reason-aware drain release would need a separate RED, a source-backed invariant, and a bounded mapping. The probe in this ACT establishes only the narrow conclusion `SCHEDULER_REASON_DIFFERENTIATION_NOT_REQUIRED_BY_CURRENT_CONTRACT`, which is sufficient to close the probe.

## C8 — RED decision

No RED is required. The probe established that:
- The scheduler's contract is to hold the drain in all three reason states.
- The scheduler's actual behavior matches this contract.
- No source-backed invariant is violated under the current contract.

A RED that required the scheduler to release on a blocked reason
would break the BCB01 §0.1 conservation and the C10 completion barrier
conservation. Such a RED is FORBIDDEN per C9. Per the C-line
qualification, this is a narrow conclusion (current contract) not a
universal one (no conceivable reason-aware behavior could ever be
justified) — but it is sufficient to close the probe.

The missing "host lifecycle consumer" is documented in C6 but is
NOT something this ACT was chartered to fabricate. C9 requires a
source-backed invariant violation, RED reproduction, and bounded
mapping. None of these are present.

## C9 — Bounded repair authorization

A bounded repair is NOT authorized:
1. Real consumer identified: NO (only the diagnostic counters and test accessor)
2. Source-backed invariant violated: NO (PROBE-01..03 establish scheduler conservation under the current contract; PROBE-04 confirms release on barrier absence via the test seam)
3. RED reproduces: NO (no violated contract under the current scheduler)
4. Bounded mapping correction: N/A
5. Existing completion safety intact: YES, and must remain so

Per C16: "Scheduler correctly treats both barriers as holds" →
`PASS_SCHEDULER_BOOLEAN_CONSERVATION`. The ACT also says "Do not
label PASS_SCHEDULER_BOOLEAN_CONSERVATION as closure of the host
blocked-outcome P0. It only excludes the scheduler from being the
incorrect consumer."

The remaining host-blocked-outcome consumer gap is documented as a
recon finding, NOT closed.

## C10 — Necessity ablation

N/A — no repair is being performed.

## C11 — Preserved accepted state-integrity work

Confirmed: my ACT-owned test file makes no changes to:
- enqueue-epoch binding
- session/task identity triple check
- existing-marker requirement
- typed reason mapping (stamped by the existing private helper)
- STALL fingerprint lifetime
- REARM dedupe lifetime
- existing Elm Completion Authority
- existing Elm Continuation Control

`git diff --check` is clean. `git status --short` shows only
`?? apps/vscode/src/sdk/__tests__/host-blocked-outcome-consumer-probe01.hbocp01.test.ts`.

## C12 — Focused conservation

Test command:
```
cd apps/vscode && bunx vitest run \
  src/sdk/__tests__/host-blocked-outcome-consumer-probe01.hbocp01.test.ts \
  src/sdk/__tests__/host-blocked-outcome-publication01.hbop01.test.ts \
  src/sdk/sdk-session-rebuild-scheduler.test.ts \
  src/sdk/__tests__/completion-continuation-stall-lifetime01.ccslt01.test.ts \
  src/sdk/__tests__/completion-continuation-stall-enforcement01.ccse01.test.ts \
  src/sdk/__tests__/completion-continuation-stalled-rearm-loop01.ccsrl01.test.ts \
  src/sdk/__tests__/completion-continuation-unresolvable-terminal-outcome01.ccuto01.test.ts \
  src/sdk/__tests__/completion-continuation-upstream-discriminator01.ccupd01.test.ts \
  src/sdk/__tests__/completion-continuation-control-authority01.ccca01.test.ts \
  src/sdk/__tests__/post-run-completion-authority-reevaluation01.pcra01.test.ts
# 10 test files, 116 / 116 tests GREEN
```

Pre-existing baseline failures (NOT introduced by this ACT, NOT
ACT-owned per C12):
- `mcp-tool-restart-deferred-completion-barrier.mcprestart01.test.ts`:
  RED-01, AFTER-SETTLE-03, IDENTITY-06 fail (3 / 10).
- `continuation-pathological-corpus01.swcm04.test.ts`:
  multiple sub-cases fail (11 / 23). These are pre-existing test
  drift documented in prior ACTs.

## C13 — Canonical gates

| Gate | Result |
|------|--------|
| `bunx tsc --noEmit` (apps/vscode) | PASS — no errors in new test file; protos regenerated cleanly |
| `bunx biome lint ... new test file` | PASS — no diagnostics |
| `git diff --check` | PASS (clean) |
| `git status --short` | Only the new test file (untracked); no tracked dirt |

The full `bun run check-types` pipeline (protos + tsc + compat +
webview-ui) runs without new errors introduced by this ACT. The
test file is the only new artifact.

## C14 — Evidence classification

| Evidence | Classification |
|----------|----------------|
| PROBE-01..04 scheduler drain behavior | SYNTHETIC_REAL (real scheduler + real coordinator + production-shape predicate) |
| PROBE-05 real producer chain | REAL_PRODUCTION_SEAM (real handleSessionEvent → real BCB re-registration → real enqueueIfHeld → real stall disc → real .then → real helper) |
| PROBE-06 bit-identical predicate across three reason states | STRUCTURAL (source-level read of the production wiring) |
| Source-derived scheduler contract | STRUCTURAL |
| Diagnostic counter existence | STRUCTURAL (source read) |
| Hypothesized operator behavior | INFERRED (no operator was consulted) |
| Installed runtime observation | NOT_EXECUTED |

## C15 — Scope

Test changes:
```
apps/vscode/src/sdk/__tests__/host-blocked-outcome-consumer-probe01.hbocp01.test.ts
```

No production files modified:
```
git diff --check   (clean)
git status --short
?? apps/vscode/src/sdk/__tests__/host-blocked-outcome-consumer-probe01.hbocp01.test.ts
```

No changes under:
```
apps/vscode/elm/**
sdk/packages/llms/**
tools/tart-testbed/**
tools/macos-host-helper/**
```

Protected stash `stash@{0}` on `d46223b51` is intact.

## C16 — Decision matrix

| Finding | Verdict |
|---------|---------|
| Scheduler should distinguish reasons; RED proves violation | NOT_FOUND (no RED; PROBE-01..04 refute) |
| Scheduler correctly treats both barriers as holds | `PASS_SCHEDULER_BOOLEAN_CONSERVATION` ← This ACT |
| Another production consumer exists | PARTIALLY: diagnostic counters and test accessor only (no actionable lifecycle consumer) |
| No host lifecycle consumer exists | `CAPTURE_INSUFFICIENT` for the host-blocked-outcome P0 (the gap is real but unchartered) |
| RED does not reproduce against a source-proven invariant | N/A — no RED, no invariant violated |
| Consumer repair would require protocol redesign | Halt with minimal missing contract — see C17 |

## C17 — Required report

```
ACT: ACT-CLINEMM-P0-HOST-BLOCKED-OUTCOME-CONSUMER-PROBE01

ENTRY_HEAD: 9538ebd133b4ce4b75d29bca2bf04a531d378ed4
SUBJECT_HEAD: 9538ebd133b4ce4b75d29bca2bf04a531d378ed4

MARKER:
  writer: SdkSessionEventCoordinator (private field, line 616)
  lifetime: BCB01 §0.1 register on submit_and_exit; clear on
            commit; bounded single-key
  reasons: undefined, "stalled_no_progress", "delivery_rejected",
           "observation_unavailable" (reserved)

SCHEDULER:
  drain_symbol: SdkSessionRebuildScheduler.drainIfIdle (line 129-244)
  consumer_symbol: isDeferredCompletionOutstanding (line 125) ->
    this.deferredOutstandingPredicate() (boolean only)
  required_behavior: hold drain in all three reason states; release
    on barrier absence (PROBE-04 — necessary but not sufficient;
    see review note above)
  observed_recoverable_hold: drain held, observer recorded
    outstanding=true reason=undefined
  observed_stalled_hold: drain held, observer recorded
    outstanding=true reason="stalled_no_progress"
  observed_delivery_rejected: drain held, observer recorded
    outstanding=true reason="delivery_rejected"

PRODUCER_TO_CONSUMER:
  exercised: true
  evidence: PROBE-05 — K delivers, K+1 stalls; marker carries
    reason="stalled_no_progress"; scheduler predicate returns true
    (boolean only); drain held; observer records the reason

HOST_LIFECYCLE_CONSUMER:
  symbol: NONE (only diagnostic counters and test accessor)
  effect: NONE (no production code path inspects barrier.reason)

DISCRIMINATOR:
  H1: NOT SUPPORTED under the current scheduler contract
      (PROBE-01..03 establish scheduler sees identical boolean
      for all three reason states; no reason-aware branch in
      source; conservation requirements do not authorize one).
      Narrow conclusion: SCHEDULER_REASON_DIFFERENTIATION_NOT_
      REQUIRED_BY_CURRENT_CONTRACT.
  H2: SUPPORTED under the current contract
      (drain held for all three; barrier absence releases via
      the test seam)
  H3: PARTIALLY (diagnostic counters exist but are opt-in dogfood
      only, not actionable lifecycle)
  H4: SUPPORTED (no production code path inspects barrier.reason)

RED:
  reproduced: not_required
  assertion: N/A
  evidence: PROBE-01..03 establish scheduler safety conservation
            under the current contract; PROBE-04 confirms
            barrier-absence release via the test seam; no
            source-backed invariant is violated

REPAIR:
  performed: false
  files: none

NECESSITY:
  result: not_required

CONSERVATION:
  focused_tests: 10 files / 116 tests GREEN
                 (pre-existing baseline failures in mcprestart01
                  and swcm04 NOT introduced by this ACT, isolated)
  typecheck: PASS (apps/vscode)
  lint: PASS (biome; new test file clean)
  diff_check: PASS (git diff --check clean; git status only
                  shows the new test file)

ELM:
  modified: false
  additional_kernel: false

VSIX: NOT_EXECUTED
LIVE: NOT_EXECUTED

VERDICT: PASS_SCHEDULER_BOOLEAN_CONSERVATION +
         SCHEDULER_REASON_DIFFERENTIATION_NOT_REQUIRED_BY_
         CURRENT_CONTRACT (narrow H1 conclusion) +
         CAPTURE_INSUFFICIENT for the host-blocked-outcome P0
         (the missing actionable consumer is documented but not
          closed by this ACT)

NEXT_ACT: a successor ACT to identify a real, operator-actionable
          host lifecycle surface (e.g. the existing session
          status or error channel) is possible but NOT chartered
          by this ACT. The successor must:
          1. STOP designing new classification logic. The Elm
             Continuation Control kernel already classifies the
             blocked outcome (P2/P5); the host gap is publication,
             not classification.
          2. Name the proposed owner (e.g. an existing
             status-projection surface, a bounded gRPC state field,
             or a new opt-in operator prompt) and prove via source
             reading that the owner is the right place.
          3. Examine existing patterns where the SDK distinguishes
             persisted display-only failures from model-bound
             messages as a possible existing-consumer precedent —
             WITHOUT assuming it is the correct solution.
          4. Show via RED that a real invariant is violated WITHOUT
             the new consumer.
          5. Bound the new consumer to the existing completion
             conservation (no fourth Elm kernel, no new retry
             mechanism, no new protocol field unless LIVE evidence
             demands it).
```

## C18 — Commit and handoff

The ACT-owned artifact (one new test file) is staged-ready:
```
?? apps/vscode/src/sdk/__tests__/host-blocked-outcome-consumer-probe01.hbocp01.test.ts
```

This ACT does not modify any production source file. The commit
finalizes the recon probe and discards no protected state.

Operator handoff:
```
SOURCE_HEAD:       9538ebd133b4ce4b75d29bca2bf04a531d378ed4
STAGED_ARTIFACT:   apps/vscode/src/sdk/__tests__/host-blocked-
                   outcome-consumer-probe01.hbocp01.test.ts
                   (NEW, 6 tests, all GREEN)
VSIX:              NOT_EXECUTED
INSTALLED_VERSION: NOT_EXECUTED
LIVE_POST_ACT:     NOT_EXECUTED
PROTECTED_STASH:   stash@{0} on d46223b51 (Tart testbed WIP)
                   preserved
```

No further ACTs are blocked by this one. The host-blocked-outcome
P0 remains at the boundary identified in this ACT's recon: a
missing actionable lifecycle consumer. A successor ACT MAY be
chartered by an operator to add one, but no such charter exists
at this HEAD.
