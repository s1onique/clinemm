# ACT-CLINEMM-ELMIZE-P1-BLOCKED-OUTCOME-CLASSIFICATION01 — PASS_NO_ELM_MIGRATION_NEEDED_HOST_OUTCOME_GAP — 2026-10-08

**Status:** CLOSED at the C1–C8 recon gates. **No production code change warranted.
No new Elm kernel authorized.** The pure semantic decision the brief asks about
("when completion is forbidden and no useful continuation can make progress,
what authoritative outcome does the host produce, and who consumes it?") is
ALREADY OWNED by the existing Continuation Control Elm kernel
(`Policy.elm` P2 / P5). The observable seam that the LIVE specimen lacks
is a HOST PUBLICATION GAP, not a pure policy gap. Creating a fourth Elm
kernel here would re-introduce the `HALT_DUAL_BLOCKED_OUTCOME_AUTHORITY`
defect the brief explicitly forbids.

Per ACT §C14 / C17: "If the missing functionality is merely host
publication, stop this Elm ACT with:
`PASS_NO_ELM_MIGRATION_NEEDED_HOST_OUTCOME_GAP`. Then freeze a separate
P0 host repair." That is the verdict of this ACT.

The previous ACT
(`ACT-CLINEMM-ELMIZE-P1-COMPLETION-BARRIER-CONSERVATION01`) named this
exact successor: "After this seam, I'd consider Elmizing the pure
blocked-outcome classification, provided a subsequent recon establishes
that it is not already covered by Completion Authority or Continuation
Control." That recon has now run; the answer is: it is already covered
by Continuation Control.

## C1 — Inventory of existing outcome authorities (recon)

### COMPLETION_AUTHORITY
```
producer:        apps/vscode/elm/completion-authority/src/Authority.elm
caller:          apps/vscode/src/sdk/sdk-session-event-coordinator.ts:826
                 `checkElmCompletionAuthority(writerId)` (consumed twice:
                 L1156 in reevaluateDeferredCompletionBarrier,
                 L2142 in handleSessionEvent C10 path)
decision:        AuthorizeTaskCompletion | AuthorizeContinuation | HoldCompletion(reason)
effect:          reevaluate path: when kind !== "authorize", suppresses
                 `enqueueCompletionContinuationIfHeld` callback.
                 C10 path: when kind !== "authorize", registers a
                 `deferredCompletionBarrier` marker and suppresses the
                 `setTurnPhase("completed", ...)` commit effect.
                 Legacy silent default-Authorize fallback REMOVED in
                 ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-DEFAULT01-REMOVE-LEGACY-TS-AUTHORITY.
```

### CONTINUATION_AUTHORITY (Continuation Control)
```
producer:        apps/vscode/elm/completion-continuation-control/src/Policy.elm
caller:          apps/vscode/src/sdk/completion-continuation-control-elm.ts
                 `pickContinuationDirectiveForPublication(input)` at L635
                 (consumed by `buildSdkControllerEnqueueCompletionContinuation`
                 factory in `SdkController.ts:842-984`)
decision:        ObserveThenRetry | RetryCompletion | WaitForHost
                 | FailClosed(reason)
                 FailureReason: ObservationUnavailable | RetryUnavailable
                 | StalledNoProgress | SessionMismatch | TaskMismatch
                 | AlreadyCommitted | MalformedFacts
                 (closed enum, Domain.elm L65-86; frozen wire contract)
effect:          directive is fed into `formatCompletionContinuationPrompt`
                 to render a bounded fail-closed footer for the next
                 model turn, OR into `renderContinuationDirectiveFooter`
                 (background-notify-coordinator.ts:307-361) to mark the
                 control in a CCARD-stage record.
                 StalledNoProgress directive (P2): the model sees the
                 "fail_closed / no progress" footer instead of a fresh
                 continuation prompt. The scheduler is already told to
                 stop re-enqueuing (recordStalledNoProgress at upstream
                 runtime:427-432 + fingerprint discriminator at
                 sdk-session-event-coordinator.ts:1404-1421).
```

### STALL_CLASSIFIER
```
producer:        apps/vscode/src/sdk/completion-continuation-upstream-runtime.ts
                 `recordStalledNoProgress` at L427-432
state_owner:     same file, `State.counters.stalledNoProgress` at L165
                 + `lastCompletionContinuationHeldSetSorted` /
                 `lastCompletionContinuationControlFingerprint` /
                 `lastCompletionContinuationSessionEpoch` on the
                 coordinator (sdk-session-event-coordinator.ts:1401-1477)
caller:          enqueueCompletionContinuationIfHeld
                 sdk-session-event-coordinator.ts:1314-1497
decision:        (pure-TS projection) the fingerprint discriminator
                 returns the discriminated-union member
                 `{ kind: "stalled_no_progress" }` when the prior
                 held set is identical to or a pure superset of the
                 new one (C17 superset-aware STALL snapshot).
effect:          the enqueue is suppressed; the counter is bumped;
                 the producer-side member is RETURNED to the caller
                 but currently NOT surfaced to any typed host
                 consumer.
```

### BLOCKED_OUTCOME  ← the seam this ACT investigates
```
producer:        sdk-session-event-coordinator.ts:1314-1497
                 `enqueueCompletionContinuationIfHeld` returns a
                 discriminated union of 7 members:
                   { kind: "delivered",      heldJobIds, continuationSessionEpoch }
                   { kind: "rejected",       heldJobIds, continuationSessionEpoch }
                   { kind: "session_gone" }
                   { kind: "no_held_job_ids", heldJobIds }
                   { kind: "not_held" }
                   { kind: "already_sent",   continuationSessionEpoch }
                   { kind: "no_callback" }
                   { kind: "stalled_no_progress" }
owner:           NONE (the kind is produced and returned to the
                 `void ... .then(...)` microtask, but only the
                 `delivered` branch and the `no_held_job_ids` branch
                 are logged at both call sites:
                 - L1080-1098 reevaluateDeferredCompletionBarrier →
                   logs ONLY delivered
                 - L2102-2120 handleSessionEvent C10 path →
                   logs ONLY delivered
                 Every other union member is silently discarded.)
consumer:        NONE (the only observable state surface for the
                 "stalled" path is the `stalledNoProgress` counter
                 exposed via
                 `getCompletionContinuationUpstreamCounters` →
                 `dumpExtensionSideCompletionContinuationUpstreamCounters`
                 in completion-continuation-upstream-runtime-host.ts:73-82,
                 which is a diagnostic dump, not a typed production
                 contract.)
lifecycle:       there is no host-side projection of the union
                 member to a typed "blocked" status, phase, CCARD
                 stage, setTurnPhase call, or any other observable
                 production seam.
```

## C2 — Reconstructed LIVE failure (preserved)

```
session/task:        1791413688644_o729w
terminal_committed:  154
heldJobIds:          7
submit_and_exit_seen: 2
continuation_scheduled: 1
continuation_started: 1
stalledNoProgress:   0        ← exactly the gap: even though the
                                 LIVE specimen ran the scheduler
                                 path twice (K, K+1), the counter
                                 for stalledNoProgress was 0
                                 because the predecessor fix had
                                 not landed
task_completion_committed: 0
```

The important sequence:

```
submit K
   ↓
continuation scheduled and delivered
   ↓
host/model reports observation impossible
   ↓
submit K+1
   ↓
completion not committed
   ↓
no further continuation in captured interval
   ↓
no authoritative blocked outcome observed
```

Frozen as `LIVE_COMPLETION_OUTCOME_MISSING`. This proves non-convergence
in the captured run. It does not independently prove Elm emitted the
wrong directive — in fact, the live Elm kernel
(`Policy.elm` P5, fixed before this ACT) already returns
`FailClosed(observation_unavailable)` for the LIVE specimen's fact
shape (`unconsumedCount > 0`, `canObserveHeldResults = false`). CCUTO-13
in the existing suite exercises that real production kernel and pins
this directive (see C6 below).

## C3 — First missing transition (the actual cause)

Tracing producer → consumer for the LIVE specimen's fact shape
(`unconsumedCount = 7`, `canObserveHeldResults = false`,
`canRetryCompletion = false`, `sessionMatches = true`,
`taskMatches = true`, `alreadyCommitted = false`):

| Stage                  | Question                                                    | Status |
| ---------------------- | ----------------------------------------------------------- | ------ |
| Host facts             | Are held IDs and counts coherent?                           | yes    |
| Completion Authority   | Is completion authorized, held, or failed?                  | yes    |
| Continuation Control   | Does Elm select useful continuation or fail closed?         | yes    |
| Host effect mapper     | Is `fail_closed` interpreted as an actual host result?      | yes    |
| Scheduler              | Is another continuation queued despite failure?             | yes    |
| Completion commit      | Can task completion be falsely authorized?                  | yes    |
| Outcome consumer       | Can any caller observe that automatic progress has stopped? | NO     |

The first missing observable transition is the LAST ROW: the
`enqueueCompletionContinuationIfHeld` discriminated-union return
value is **silently discarded** at both call sites. The
`{ kind: "stalled_no_progress" }` member, the
`{ kind: "rejected" }` member, and the
`{ kind: "session_gone" }` member are all dropped without being
projected onto any typed surface.

This is a HOST PUBLICATION GAP. The pure policy (which class of
"automatic progress has stopped" applies to a given fact set) is
ALREADY Elm-owned. The host simply does not surface the kernel's
already-typed verdict.

## C4 — Semantic domain (no new domain needed)

The `BlockedOutcomeFacts` the brief illustrates is mostly already
present in the production snapshot — every required fact is already
collected by the host scheduler and fed to the Continuation Control
Elm kernel via `CompletionContinuationControlFactsJson`:

```ts
interface CompletionContinuationControlFactsJson {
  unconsumedCount: number           // heldObligation
  observation: { observeHeldResults: boolean; retryCompletion: boolean }
  completion:  { observeHeldResults: boolean; retryCompletion: boolean }
  stalledNoProgress: boolean        // the LIVE defect detector
  sessionMatches: boolean
  taskMatches: boolean
  alreadyCommitted: boolean
}
```

The Elm kernel returns a `ContinuationDirective` whose
`tag === "fail_closed"` member carries a typed
`FailureReason` enum with seven closed values (one of which is
`StalledNoProgress`, another is `ObservationUnavailable` — exactly
the two semantic classes the brief asks about). The mapping
Facts → Directive is a pure, total, deterministic function
implemented in `Policy.elm`. There is nothing to add.

## C5 — Disposition of the "fourth kernel" question

Per the C5 candidate table:

| Situation                                             | Candidate host action                               | Existing kernel coverage |
| ----------------------------------------------------- | --------------------------------------------------- | ----------------------- |
| Completion authorized and conservation clear          | Permit existing completion path                     | yes Completion Authority  |
| Held results observable                               | Allow existing observation continuation             | yes Continuation Control  |
| Completion held, useful work still running            | Await legitimate progress                           | yes Completion Authority (hold) + Continuation Control (ObserveThenRetry) |
| Completion held, observation unavailable              | Bounded blocked outcome                             | yes Continuation Control P5 → `FailClosed(ObservationUnavailable)` |
| Continuation already classified `stalled_no_progress` | Suppress unchanged retry and expose blocked outcome | yes Continuation Control P2 → `FailClosed(StalledNoProgress)` (enqueue side) + STALL classifier suppresses the next enqueue |
| Missing required facts                                | Fail closed without fabricating completion          | yes Continuation Control P0 → `FailClosed(MalformedFacts)` |

Verdict: **disposition A/B** — every cell in the table is already
covered by the existing two Elm kernels plus the host-side STALL
classifier. No new pure policy exists.

## C6 — Real production RED (pre-fix evidence, frozen)

A RED is reproducible against the existing test corpus without any
new test, because the test suite already exercises the exact fact
set the brief describes and the production Elm kernel returns the
right directive.

`apps/vscode/src/sdk/__tests__/completion-continuation-unresolvable-terminal-outcome01.ccuto01.test.ts:999-1080` (CCUTO-13):

```ts
it("CCUTO-13: LIVE specimen facts => real kernel emits fail_closed(observation_unavailable)", async () => {
  // 7 held IDs, no observation tool, no retry tool
  const directive = await pickContinuationDirectiveForPublication({
    unconsumedCount: 7,
    capabilities: { canObserveHeldResults: false, canRetryCompletion: false },
    stalledNoProgress: false,
    sessionMatches: true,
    taskMatches: true,
    alreadyCommitted: false,
  })
  expect(directive.tag).toBe("fail_closed")
  expect(directive.tag === "fail_closed" ? directive.failureReason : "not_fail_closed")
    .toBe("observation_unavailable")
})
```

This test is GREEN on HEAD (`9e7906a95`). It drives the REAL
production `pickContinuationDirectiveForPublication` → compiled
`completion-continuation-control.js` → `decodeDirective` path with
the LIVE specimen's fact set and asserts the typed directive.

Causal-discriminator pre-fix defect: there is no production seam
where the `{ kind: "stalled_no_progress" }` member of the
`enqueueCompletionContinuationIfHeld` discriminated union is
surfaced to any typed host consumer. CCUTO-01 itself documents
this gap at L818-836:

> SCOPE BOUNDARY (per Factory review): These tests assert
> `COMPLETION_FABRICATION_PREVENTED`, NOT an observable `blocked`
> / `stalled_no_progress` / `requires_operator` host-owned
> outcome. The broader "host-owned blocked outcome" contract
> remains on the epic board and is NOT proven by these tests.

The `requires_operator` symbol appears ZERO times in production
code (search across `apps/vscode/src` + `apps/vscode/elm` returns
exactly one hit, in the CCUTO-01 comment that introduced the
name). It is not a typed seam. The factory's wording in the
predecessor ACT was speculative forward-look, not an existing
contract.

## C7 — Causal discriminator (H variant)

| Variant | Difference                           | Expected discriminator                  | Result on HEAD |
| ------- | ------------------------------------ | --------------------------------------- | -------------- |
| A       | Held=7, observation unavailable      | Blocked                                 | Elm emits `FailClosed(ObservationUnavailable)` YES; host does NOT publish a typed "blocked" outcome to any consumer NO |
| B       | Same held set, observation available | Useful continuation                     | Elm emits `ObserveThenRetry` YES; host delivers the continuation prompt YES |
| C       | Held genuinely consumed              | Completion can become eligible          | Elm emits `AuthorizeTaskCompletion` YES (via held count drop); commit fires via `setTurnPhase("completed", …)` gated by `checkElmCompletionAuthority` YES |
| D       | Same held set, new submit attempt    | No synthetic progress                   | STALL classifier discriminator at sdk-session-event-coordinator.ts:1404-1421 returns `{ kind: "stalled_no_progress" }` YES; the next enqueue is suppressed YES; BUT the `{ kind: "stalled_no_progress" }` member is not surfaced to any typed consumer NO |
| E       | New held result genuinely arrives    | Reevaluate without assuming consumption | reevaluateDeferredCompletionBarrier enters with new held set; the superset-aware STALL discriminator (CCSRL01) treats it as progress and releases the dedupe YES |
| F       | Different task/session               | No blocked-state leakage                | `marker.taskId !== taskId` clears the marker (sdk-session-event-coordinator.ts:918-921); new coordinator instance has fresh STALL fingerprint and held set YES |
| G       | Elm kernel offline                   | Fail closed                             | `invokeElmKernel` returns `{ kind: "kernel_offline" }` → `pickContinuationDirectiveForPublication` returns `failClosedMalformedFacts()` (completion-continuation-control-elm.ts:588-617, 626-633, 653-658) YES |
| **H**   | **Elm already emits correct directive; host lacks outcome publication** | **RED persists** | **CONFIRMED: the gap is host-side publication, NOT Elm policy** |

The H variant is the decisive discriminator. Elm already produces
the correct `FailClosed(StalledNoProgress)` /
`FailClosed(ObservationUnavailable)` directive. The host lacks a
typed seam that surfaces this verdict to any operator-visible
consumer.

## C8 — Necessity / ablation

A new Elm kernel is **NOT** necessary:

- **Before repair:** Elm emits `FailClosed(StalledNoProgress)` and
  `FailClosed(ObservationUnavailable)` correctly. Host has no typed
  surface for "blocked outcome". Test CCUTO-13 (real production
  kernel, LIVE specimen facts) is GREEN.
- **With proposed Elm kernel:** the new kernel would either
  duplicate the existing `Policy.elm` decision (forbidden: dual
  authority hazard) or compute something the existing kernel does
  not (impossible: every fact in `BlockedOutcomeFacts` is already
  in `CompletionContinuationControlFactsJson` and every verdict
  is already in `ContinuationDirective`).
- **Ablate the proposed kernel:** there is nothing to ablate; the
  Elm decision already exists in `Policy.elm`.
- **Restore the existing kernel:** trivially preserved (no change).

A fourth kernel would re-introduce exactly the defect the brief
forbids: `HALT_DUAL_BLOCKED_OUTCOME_AUTHORITY`.

## C9 — Host lifecycle ownership

The host must own the following temporal facts; the existing code
already collects them, and this ACT does not propose to add any
new ones:

```
session identity         → sdk-session-event-coordinator.ts (this.sessionId)
task identity            → this.options.getTask?.()?.taskId
held observation lifecycle → this.options.getUnconsumedOwnedTerminalJobIds
stall fingerprint         → this.lastCompletionContinuationControlFingerprint
rearm epoch               → this.lastCompletionContinuationSessionEpoch
pending prompt state      → this.options.getPendingPromptCount
delivery state            → this.options.enqueueCompletionContinuation
task completion commit    → this.options.setTurnPhase("completed", …)
```

The MISSING host ownership piece (which is the substrate for the
successor P0 host repair) is: a typed seam that projects the
`enqueueCompletionContinuationIfHeld` discriminated-union member
onto a host lifecycle surface. Examples of acceptable shapes
(successor ACT will choose one):

1. a CCARD stage, e.g. `continuation_blocked`, with a closed
   `blockedReason` field;
2. a new `setTurnPhase` phase, e.g. `"awaiting_operator"`, that
   the webview can render as a named state;
3. an explicit `publishBlockedOutcome` callback on
   `SdkSessionEventCoordinatorOptions` that the
   `enqueueCompletionContinuationIfHeld` `.then(...)` calls for
   non-`delivered` members.

The Elm kernels do NOT need any new fields to support any of
these: every required fact is already in
`CompletionContinuationControlFactsJson` and every verdict is
already in `ContinuationDirective`.

## C10 — Prevent duplicate authority

The C10 candidate state would be:

```
Completion Authority Elm      → may completion commit?
Continuation Control Elm      → what continuation directive?
Blocked Classification Elm    → ??? (would duplicate C2)
TS host blocked policy         → ??? (would duplicate C10)
```

The factory brief explicitly forbids this. The current state
preserves dual coverage cleanly:

```
Completion Authority Elm      → may completion commit?        (Authorize | HoldCompletion | Failure)
Continuation Control Elm      → what continuation directive?  (ObserveThenRetry | RetryCompletion | WaitForHost | FailClosed(reason))
TS host effect mapper         → render directive / advance lifecycle (no semantic decision)
STALL classifier (TS)         → suppress unchanged retry     (scheduler-only fact, no semantic decision)
```

No duplicate authority exists. The missing piece is a typed
publication seam, not a fourth decision owner.

## C11 — Conservation matrix (all 11 invariants preserved)

| Contract                           | Status on HEAD | Notes |
| ---------------------------------- | -------------- | ----- |
| `submit_and_exit` success          | yes            | completion commits at most once per session; setTurnPhase("completed", …) gated by checkElmCompletionAuthority at L1156 + L2142 |
| Count=0, IDs>0                     | yes            | `heldObligation = count > 0 || jobIds.length > 0` at sdk-session-event-coordinator.ts:1037-1038 (CCUTO01 CORRECTION01 count/list repair) |
| Count>0, IDs=[]                    | yes            | same disjunct; `enqueueCompletionContinuationIfHeld` returns `{ kind: "no_held_job_ids" }` at L1455 and the run reaches steady state |
| Held observations available        | yes            | `ObserveThenRetry` directive (Policy.elm P4) renders the bounded continuation prompt |
| Observation capability unavailable | yes            | `FailClosed(ObservationUnavailable)` (P5) renders the bounded fail-closed footer; prompt never instructs unavailable tools (CCUTO-10 invariant) |
| STALL unchanged                    | yes            | `recordStalledNoProgress` + the superset-aware fingerprint discriminator at L1404-1421 |
| Real progress                      | yes            | `isStrictSupersetOf` check at L1422-1435 releases the dedupe |
| New task/session                   | yes            | `marker.taskId !== taskId` clears the marker at L918-921; new coordinator instance has fresh STALL state |
| Elm kernel offline                 | yes            | `pickContinuationDirectiveForPublication` returns `failClosedMalformedFacts()` (completion-continuation-control-elm.ts:626-633, 653-658) |
| Privileged continuation            | yes            | existing trusted-instructions transport at `runtimeControlDirective` |
| User/tool forgery                  | yes            | private WeakSet identity for non-forgeable brand (commit `6e384d484`); provider/private-brand invariant unchanged |

## C12 — Tests (reuse, no new test framework)

Focused suites verified GREEN on HEAD:

```
CCUTO01 (real production Elm kernel)        yes 14 tests (CCUTO-01..14)
CCSLT01 (stall lifetime)                    yes
CCSRL01 (stalled rearm loop)                yes
CCSE01  (stall enforcement)                 yes
REARM01 (rearm loop)                        yes
CCCA01  (continuation control authority)    yes
Plus: completion-continuation-control-elm-* (correspondence, capability,
         conservation, namespace, malformed, production-wiring)
Plus: completion-authority-elm-* (real-provider, shadow, source-stage,
         historical-replay, trace-capture-extension)
```

`bunx vitest run <6 focused files>` returns **84/84 tests PASSED**
on HEAD `9e7906a95` (EPERM/Timeout messages in the tail are vitest
worker-cleanup noise, not test failures; the run reports
`Test Files  6 passed (6)`).

No new test file is required. The existing CCUTO-13 already
exercises the real production Elm kernel on the LIVE specimen's
fact set and asserts the correct directive.

## C13 — Scope control

No production files modified. The predecessor ACT
(`COMPLETION-BARRIER-CONSERVATION01`) was a recon-only closure
with the same shape; this ACT follows the same pattern.

Explicit non-goals honored:

- No TaskHeader redesign.
- No myc changes.
- No Tart changes.
- No generic runtime FSM framework.
- No protocol redesign.
- No arbitrary retry cap.
- No prompt wording workaround.
- **No fourth Elm kernel without evidence** — evidence shows
  no fourth kernel is needed.
- No speculative diagnostic infrastructure.

## C14 — Implementation gate (final classification)

```
BLOCKED_OUTCOME_OWNER:    missing
PURE_POLICY_GAP:          no       (Policy.elm P2 + P5 + STALL classifier
                                    already cover the entire C5 table)
HOST_PUBLICATION_GAP:     yes      (the discriminated-union return value
                                    of enqueueCompletionContinuationIfHeld
                                    is silently discarded at both call
                                    sites; no typed seam projects the
                                    non-"delivered" members to a host
                                    consumer)
EXISTING_ELM_REUSABLE:    continuation_control   (Policy.elm already
                                                 returns the typed
                                                 FailClosed directive
                                                 with closed enum reason)
REAL_RED:                 not_reproduced  (the "blocked outcome"
                                          production seam does not
                                          exist as a typed contract;
                                          any test would invent the
                                          seam it claims to exercise,
                                          which is the exact
                                          fabrication hazard the
                                          brief warns against.
                                          C6 evidence: CCUTO-13
                                          GREEN on the real
                                          production kernel + LIVE
                                          specimen facts.
                                          The H variant of the C7
                                          discriminator confirms
                                          Elm already emits the
                                          correct directive.)
RECOMMENDED_CHANGE:       no_change (for this Elm ACT)
                          host_mapping (for the successor P0
                                        host repair ACT, which
                                        this ACT charters)
```

## C15 — Gates

- `git status --short`: clean (no unprotected tracked dirt)
- `git rev-parse HEAD`: `9e7906a9568d48c3e4460aa55bd5ed34febd2bdc`
- `git diff --check`: empty output
- `git diff -- apps/vscode/elm/`: EMPTY (no Elm change)
- `cd apps/vscode && bun run check-types`: PASS (exit 0)
- Focused test suites: 6 files / 84 tests PASSED
- Predecessor ACT (`COMPLETION-BARRIER-CONSERVATION01`) invariants:
  - protected stash `stash@{0}` on `d46223b51` preserved
  - count/list repair `4f5a03c20` + P1 amendment `84a4f18a5` preserved

## C16 — Commit and artifact handoff

This is a recon-only closure. No production code change is made;
the durable change is this artifact and the epic-board update. The
operator owns the VSIX build / install / LIVE qualification stages.

## C17 — Verdict

```
PASS_NO_ELM_MIGRATION_NEEDED_HOST_OUTCOME_GAP
```

Evidence outcome: "Existing Elm policy sufficient; host publication
missing" (C17 table, line 7). The pure policy is already Elm-owned
under `continuation_control`. The host-owned publication gap
(typed seam for non-`delivered` members of
`enqueueCompletionContinuationIfHeld`'s discriminated union) is
chartered as a separate P0 host repair ACT, NOT as an Elm
migration.

The factory's `Recommendation` C1 hypothesis is **validated, not
just falsified**: `FailClosed(ObservationUnavailable)` and
`FailClosed(StalledNoProgress)` already express the correct pure
policy, and the host lacks a durable, observable blocked-outcome
transition. The repair is a bounded host-side mapping, not a new
Elm kernel.

## C18 — Required closure artifact (final)

```
COMPLETION_ELM:
  existing authority preserved
    apps/vscode/elm/completion-authority/
    (semantic: may completion commit?)
    consult sites: sdk-session-event-coordinator.ts:1156 (reevaluate),
                   :2142 (C10 path)
    decision surface: Authorize | HoldCompletion(reason) | Failure
    legacy silent default-Authorize fallback: REMOVED
    (ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-DEFAULT01-REMOVE-LEGACY-TS-AUTHORITY)

CONTINUATION_ELM:
  existing authority preserved
    apps/vscode/elm/completion-continuation-control/
    (semantic: what continuation directive is appropriate?)
    consult sites: pickContinuationDirectiveForPublication()
                   (completion-continuation-control-elm.ts:635),
                   consumed via buildSdkControllerEnqueueCompletionContinuation
                   (SdkController.ts:842-984)
    decision surface: ObserveThenRetry | RetryCompletion | WaitForHost
                       | FailClosed(reason)
    closed reason enum (Domain.elm L65-86):
      ObservationUnavailable | RetryUnavailable | StalledNoProgress
      | SessionMismatch | TaskMismatch | AlreadyCommitted
      | MalformedFacts
    Policy.elm P2 (StalledNoProgress) and P5 (ObservationUnavailable)
    already express the blocked-outcome classification the LIVE
    specimen needs.

BLOCKED_OUTCOME:
  producer: enqueueCompletionContinuationIfHeld
            (sdk-session-event-coordinator.ts:1314-1497)
            discriminated union has a { kind: "stalled_no_progress" }
            member; also { kind: "rejected" }, { kind: "session_gone" },
            { kind: "no_held_job_ids" }, { kind: "not_held" },
            { kind: "already_sent" }, { kind: "no_callback" }
  owner:    NONE (the union member is returned to the
                  void ... .then(...) but only the `delivered`
                  branch and the `no_held_job_ids` branch are
                  logged at both call sites)
  consumer: NONE (no typed production seam)
            the only observable is the `stalledNoProgress` counter
            exposed via
            getCompletionContinuationUpstreamCounters →
            dumpExtensionSideCompletionContinuationUpstreamCounters
            (completion-continuation-upstream-runtime-host.ts:73-82),
            which is a diagnostic dump, not a typed contract

FIRST_DIVERGENT_BOUNDARY:
  enqueueCompletionContinuationIfHeld discriminated-union return
  value → both call sites (L1080-1098 reevaluate and
  L2102-2120 C10 path) only log the `delivered` branch; every
  other union member is silently discarded. This is the
  "outcome consumer" stage in the C3 trace table.

REAL_RED:
  not_reproduced as a typed seam test (the seam does not exist
  in production; any test would invent the seam it claims to
  exercise, which is the fabrication hazard the brief warns
  about).
  reproduced at the C5/C6 layer: CCUTO-13 exercises the real
  production Elm kernel on the LIVE specimen's fact set and
  asserts `tag: "fail_closed"`, `failureReason:
  "observation_unavailable"` (Policy.elm P5). CCUTO-13 is GREEN
  on HEAD `9e7906a95` (84/84 tests across 6 focused files).
  The C7-H variant confirms: Elm already emits the correct
  directive; the gap is host publication.

ELMIZATION_DECISION:
  no_change. No fourth Elm kernel authorized. No extension of
  either existing kernel authorized. The factory brief's
  candidate "BlockedOutcomeFacts" semantic domain is already
  covered by CompletionContinuationControlFactsJson +
  ContinuationDirective in the existing Continuation Control
  kernel.

NEXT_ACT:
  ACT-CLINEMM-P0-HOST-BLOCKED-OUTCOME-PUBLICATION01 (provisional)
  — charter a bounded P0 host repair that projects the
  enqueueCompletionContinuationIfHeld discriminated-union member
  to a typed host surface (CCARD stage, new setTurnPhase phase,
  or explicit publishBlockedOutcome callback). C5 candidate
  table is the contract; the test seam must be a real production
  seam, not a fabricated test channel. The H variant of the C7
  discriminator (Elm already emits the correct directive; host
  publication missing) is the causal pin.

  Explicit non-goals for the successor ACT:
  - No Elm source changes
  - No new Elm kernel
  - No extension of either existing kernel
  - No new test framework
  - No protocol redesign
  - No TaskHeader / myc / Tart changes
  - No provider-specific string matching
  - No fourth decision owner
```

## Source-of-truth evidence (frozen)

```
HEAD                                    9e7906a9568d48c3e4460aa55bd5ed34febd2bdc
Predecessor ACT                         COMPLETION-BARRIER-CONSERVATION01
Predecessor verdict                     PASS_NO_ELM_MIGRATION_NEEDED
Live specimen (CCUTO01)                 session/task 1791413688644_o729w
Producer seam                           sdk-session-event-coordinator.ts:1314-1497
                                        (enqueueCompletionContinuationIfHeld)
Consumer call sites                     :1080-1098 (reevaluate path)
                                        :2102-2120 (C10 handleSessionEvent)
Existing Elm policy coverage            Policy.elm P2 (StalledNoProgress)
                                        Policy.elm P5 (ObservationUnavailable)
CCUTO-13 GREEN                          ccuto01.test.ts:999-1080
                                        real production kernel + LIVE
                                        specimen facts
Focused test sweep                      6 files / 84 tests PASSED on HEAD
Stash preservation                      stash@{0} on d46223b51 PRESERVED
Count/list repair + amendment           4f5a03c20 + 84a4f18a5 PRESERVED
git status                              clean
git diff -- apps/vscode/elm/            EMPTY
VSIX                                    NOT_EXECUTED (operator owns)
LIVE_POST_FIX                           NOT_EXECUTED (operator owns)
```

## Required report block

```
SOURCE_HEAD: 9e7906a9568d48c3e4460aa55bd5ed34febd2bdc
PRODUCTION_SEAM: apps/vscode/src/sdk/sdk-session-event-coordinator.ts:1314-1497
                 (enqueueCompletionContinuationIfHeld) →
                 call sites :1080-1098, :2102-2120
PURE_POLICY_GAP: no
HOST_OUTCOME_OWNER: NONE
RED: not_reproduced at the typed-seam layer (the seam does not
     exist as a production contract; CCUTO-13 GREEN on real
     production kernel + LIVE specimen facts at the pure-policy
     layer)
NECESSITY: not_required (for Elm changes)
CONSERVATION: 11/11 invariants preserved on HEAD; focused suites
              84/84 tests PASSED
ELM_MIGRATION: not_needed
VSIX: NOT_EXECUTED
LIVE_POST_FIX: NOT_EXECUTED
```
