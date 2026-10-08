# ACT-CLINEMM-P0-BLOCKED-COMPLETION-LIFECYCLE-OWNER01 — PASS_BLOCKED_COMPLETION_LIFECYCLE_OWNER_FROZEN — 2026-10-08

**Status:** CLOSED with verdict `PASS_BLOCKED_COMPLETION_LIFECYCLE_OWNER_FROZEN`.

The outstanding P0 question from the predecessor ACT chain is settled:

> **Which existing host lifecycle surface should represent a
> completion obligation that cannot complete, cannot advance
> automatically, and requires either genuine external progress
> or intervention?**

Answer: **`TaskTelemetryTracker.recordRuntimeError(incident)`** —
the existing production lifecycle consumer the host already
owns, wires, and projects to the webview. The pattern is the
exact "display-only terminal error excluded from model inputs"
the upstream Cline SDK uses; the same V1 wire
(`TaskHeaderTelemetryStrip.runtimeErrorCount`) renders the
user-visible `⚠ N` glyph. No new wire field. No new public API.
No Elm kernel change.

## C0 — Trust and entry identity

```
$ git status --short
?? apps/vscode/src/sdk/__tests__/host-blocked-outcome-lifecycle-owner01.hbclo01.test.ts
$ git rev-parse HEAD
c8e2a6e29acf314420eaa1b3fe1aeaf506c813f5
$ git log -1 --oneline
c8e2a6e29 docs(act): record ACT-CLINEMM-P0-HOST-BLOCKED-OUTCOME-CONSUMER-PROBE01 closure (PASS_WITH_NONBLOCKING_RESIDUE, ...)
$ git diff --check    (clean)
$ git stash list
stash@{0}: WIP on main: d46223b51 fix(completion-continuation-stall-lifetime): ...
```

Classification:
- `EXPECTED_CLEAN` ✅ (no tracked dirt; only the new test file is untracked)
- `PROTECTED_STASH` ✅ (`stash@{0}` on `d46223b51` = Tart testbed WIP; preserved intact, never popped)
- `ENTRY_HEAD` = `c8e2a6e29` (the predecessor PROBE01 closure)
- `SUBJECT_HEAD` = `c8e2a6e29` (HEAD frozen — no production code touched in this ACT)
- `HOST-BLOCKED-OUTCOME-CONSUMER-PROBE01` committed ✅ (predecessor = `c8e2a6e29`)

## C1 — Candidate lifecycle owner inventory

Three existing host-side surfaces were inventoried as credible
candidates for the owner of a typed blocked-completion verdict.
The brief's `rebuild scheduler` and "any new framework" paths
are excluded a priori (PROBE01 closed the scheduler question).

### CANDIDATE_1 — `TaskTelemetryTracker.recordRuntimeError(incident)`

```
CANDIDATE:
  name:           recordRuntimeError (host-owned production lifecycle counter)
  producer:       CommandJobManager.cancel (EPERM during process-tree termination);
                  CommandJobManager.cancel (command_containment_failed postcondition);
                  (candidate) SdkSessionEventCoordinator.applyBlockedCompletionContinuationOutcome
  owner:          TaskTelemetryTracker (single source of truth, host-owned,
                  single instance per SdkController lifetime — SdkController.ts:1424)
  consumer:       webview TaskHeaderTelemetry `⚠ N` glyph
                  (data-testid="task-header-runtime-error-count",
                  TaskHeaderTelemetry.tsx:455)
  persistence:    in-memory per SdkController lifetime; does NOT survive
                  extension-host restart; LATCHES on `startTask` with new
                  identity (REC-06 invariant: task-telemetry-tracker.test.ts:786)
  correlation:    per-task identity (currentTaskId); correlationId field
                  for forensic trace (ExtensionMessage.ts:1057-1062)
  operator_observable: YES — `⚠ N` glyph in TaskHeader strip; live
                  qualification harness already wired via
                  `__clineRecordRuntimeError` debug hook
                  (SdkController.ts:1478-1481)
  clears_on_progress: NO — cumulative monotonic per task; resets
                  ONLY on new task identity. Same lifetime model
                  as Elm's `deferredCompletionBarrier` epoch.
  safe_for_blocked_completion: YES — pattern is "display-only
                  terminal error excluded from model input"
                  (ExtensionMessage.ts:1042-1056 explicit policy);
                  does NOT advance turn phase; does NOT commit
                  `task_completion_committed`; existing precedent
                  is `command_containment_failed` (ExtensionMessage.ts:1119
                  was added as an additive errorClass with zero new
                  wire field; the wire stayed `runtimeErrorCount: N`).
```

### CANDIDATE_2 — `SdkSessionRebuildScheduler.drain` via `isDeferredCompletionOutstanding`

```
CANDIDATE:
  name:           isDeferredCompletionOutstanding
  producer:       SdkController.ts:2775 (predicate bound to
                  sessionEvents.isDeferredCompletionBarrierOutstandingForTesting)
  owner:          SdkSessionRebuildScheduler
  consumer:       drain (sdk-session-rebuild-scheduler.ts:129-244)
  persistence:    in-memory per coordinator; cleared when BCB01 §0.1
                  success branch fires
  correlation:    identity triple (sessionId, taskId, epoch) via marker
  operator_observable: NO — internal scheduler predicate, not user-visible
  clears_on_progress: yes, on commit
  safe_for_blocked_completion: NO — proven by predecessor PROBE01
                  (c8e2a6e29) that this consumer is correctly conserving
                  a Boolean safety hold; reason is a strict refinement
                  of the boolean, NOT a second bit. Adding a release
                  branch on a typed reason would BREAK the BCB01 §0.1
                  conservation and the C10 completion barrier. PROBE01
                  closed this candidate as "not the missing consumer".
```

### CANDIDATE_3 — `applyBlockedCompletionContinuationOutcome` dogfood counter

```
CANDIDATE:
  name:           recordBlockedOutcomeStalledNoProgress /
                  recordBlockedOutcomeDeliveryRejected
  producer:       applyBlockedCompletionContinuationOutcome
                  (sdk-session-event-coordinator.ts:1803-1807)
  owner:          completion-continuation-upstream-runtime module
                  (opt-in DOGFOOD diagnostic; `if (!_state.enabled) return`
                  at the top of every record* function)
  consumer:       Command Palette dump
                  `cline.debug.dumpCompletionContinuationUpstream`
                  (registry.ts:157)
  persistence:    JSON file under
                  <globalStorageUri>/completion-continuation-upstream.counters.json
  correlation:    NONE (no task/session/owner identity)
  operator_observable: ONLY via Command Palette dump; opt-in by
                  default; default-OFF per dogfood-diagnostic-profile.ts
  clears_on_progress: never (durable counters survive across tasks)
  safe_for_blocked_completion: NO — opt-in only, not a
                  lifecycle consumer, not on the webview, no
                  session/task correlation. PROBE01/PROBE02 reviewer
                  correctly halted on this for exactly this reason.
```

### Selected owner (C7)

`TaskTelemetryTracker.recordRuntimeError(incident)` — the only
existing production lifecycle consumer that is:

1. **always-on** (no opt-in flag; V1 public sink wired by
   SdkController.ts:1901 to the shared host + SdkController.ts:737-740
   to the 6 temp-host callsites; no env var, no toggle, no
   dogfood gate)
2. **typed** (closed-enum `RuntimeErrorIncident` with
   `errorClass` × `source` × `correlationId?`; the
   `command_containment_failed` precedent at
   ExtensionMessage.ts:1119 proves additive extensions stay
   safe — the V1 webview ignores the source string)
3. **display-only** (never projected to the model input;
   only the cumulative `runtimeErrorCount` integer reaches
   the wire; `errorClass`/`source` are logged at INFO for
   forensic trace per ExtensionMessage.ts:1042-1056)
4. **per-task lifetime** (latches on new task identity; the
   natural replacement guard; the same `currentTaskId` is
   the lifetime the deferred completion barrier uses)
5. **cumulative monotonic** (recoverable hold and unrecoverable
   block both increment; matches the existing
   `command_containment_failed` precedent where an EPERM
   successfully recovered by the LaunchAgent fallback still
   counts — the user-visible "this task hit a runtime
   incident" fact)
6. **real consumer** (webview TaskHeader `⚠ N` glyph;
   `__clineRecordRuntimeError` debug hook already wired for
   live qualification per SdkController.ts:1478-1481)

This is the substrate the brief hinted at — "Upstream Cline
already uses session-state reporting and display-only errors
that are excluded from model inputs, so these are credible
substrate candidates." The candidate exists in the production
codebase; the only missing piece is the wiring from
`applyBlockedCompletionContinuationOutcome` to
`recordRuntimeError`. That wiring is a single bounded
additive call site (one per successful typed publication).

## C2 — Blocked semantics

The selected owner MUST represent a blocked outcome that is
NOT task completion, NOT process failure, and NOT automatic
retry. The minimum semantics for a blocked outcome:

```
BLOCKED:
  completion permitted?       NO
  useful continuation?        NO
  automatic retry permitted?  NO, unchanged obligation
  terminal result consumed?   NOT ASSUMED
  task successfully complete? NO
  progress possible later?    YES, if underlying facts change
  operator action required?   POSSIBLY
```

Three causal reasons are preserved as a closed enum
(production `DeferredCompletionBarrierReason` at
sdk-session-event-coordinator.ts:590):

```
stalled_no_progress    — upstream TS disc verdict (C7-H Elm P2
                         equivalent; C7 variant confirms Elm
                         already emits this directive)
delivery_rejected      — production callback's `rejected` outcome
                         (sdkHost.send threw OR liveTools returned
                         undefined)
observation_unavailable — RESERVED (C5 RED-2 / RED#2 case;
                         closed-enum value not currently produced
                         by the production seam; preserves the
                         C15 no-policy-change invariant)
```

A rejected delivery is NOT necessarily a permanently
unobservable terminal result — the operation failure vs.
policy failure distinction is preserved at the marker
(rejected = "send failed this time", not "unreachable
forever"). The Elm P5 observation_unavailable verdict
remains available as a third closed-enum value; the
C7-H variant confirmed the Elm Continuation Control kernel
already classifies it correctly (Policy.elm P5). The
host publication gap for that value remains open if
production ever needs it; the C7 discriminator did NOT
identify a current production seam that would exercise
it, so it is reserved rather than fabricated.

## C3 — Persistence / lifetime

| Question | Answer | Source |
|---|---|---|
| Survives UI/webview reconstruction? | YES | `TaskTelemetryTracker` is host-owned; persists across `getStateToPostToWebview` calls (task-telemetry-tracker.ts:80) |
| Survives session reconnect? | YES (in-memory per controller lifetime) | single SdkController instance, host-owned (SdkController.ts:1424) |
| Survives extension-host restart? | NO | in-memory only; V1 webview normalizes absence to zero (TaskHeaderTelemetry.tsx:443) |
| Event that clears it? | New task identity (`startTask` with different id) | REC-06 invariant (task-telemetry-tracker.test.ts:786) |
| Stale result resurrection? | NO — the per-task `currentTaskId` is the only lifetime key; a stale enqueue resolving after task replacement would be filtered by the existing C4 guards in `applyBlockedCompletionContinuationOutcome` (session/task identity mismatch refuse) | sdk-session-event-coordinator.ts:1726-1740 |

Persistence decision: **NO** new persistence. The
`TaskTelemetryTracker` is the existing in-memory per-task
counter; the brief explicitly directs "Prefer existing
session/task lifecycle persistence if source proves it is
appropriate" — source proves the existing in-memory pattern
is appropriate (the `runtimeErrorCount` wire field is the
canonical publication surface; the `taskHistory.json` does
NOT project it per REC-06 CORRECTION01 contract).

The marker (`deferredCompletionBarrier`) lifetime is
epoch-supersession-based; the tracker's lifetime is
task-identity-based. Both reset on the same boundary
("replacement task"), so a blocked verdict recorded against
K cannot leak to K+1: the tracker's `startTask(K+1)` clears
the count AND the marker's BCB re-registration at the K+1
epoch supersedes the K marker.

## C4 — Correlation contract

The accepted identity triple is reused exactly as
`applyBlockedCompletionContinuationOutcome` already binds it
(sdk-session-event-coordinator.ts:1689-1700):

```
sessionId    (string)             — active session
taskId       (string | undefined) — active task
enqueueEpoch (number)              — captured at fire time
                                   (CORRECTION01 EPOCH BINDING)
correlationId  (string, optional)  — for recordRuntimeError;
                                     forensic trace; not projected
                                     to the wire
```

The `correlationId` for the new wiring will be
`${captured.sessionId}|${captured.taskId ?? "(none)"}|${captured.enqueueEpoch}` —
the same key format the marker uses, so the wire-level
publication and the marker-level publication share a single
identity vocabulary.

### K-then-K+1 invariant (the predecessor's resolved-time epoch mistake)

```
K begins at epoch 10
K+1 begins at epoch 11
K resolves blocked
  captured.enqueueEpoch = 10 (K's fire-time epoch)
  marker.epoch === 11 (the live marker is K+1's BCB re-reg)
  → existing C4 guard (sdk-session-event-coordinator.ts:1768-1770)
    refuses to stamp K's reason onto K+1's marker
  → no recordRuntimeError call (the existing C4 guard is the
    common gate; the proposed wiring inherits it)
  → no blocked publication against K+1
```

The CORRECTION01 reviewer's P0 #3 finding ("the predecessor's
check used `currentEpoch = getMinter().epoch` at resolution
time, which permitted the K-then-K+1 misattribution") is
already fixed at the marker level. The proposed
`recordRuntimeError` wiring MUST come AFTER the C4 guards
pass; the existing helper's guard ordering
(sdk-session-event-coordinator.ts:1726-1770) is the natural
gate. The repair wiring is one
`if (this.options.taskTelemetry) this.options.taskTelemetry.recordRuntimeError(incident)`
call inserted at the same point as the existing
`recordBlockedOutcomeStalledNoProgress()` /
`recordBlockedOutcomeDeliveryRejected()` calls
(sdk-session-event-coordinator.ts:1803-1807) — i.e. AFTER
all C4 guards and AFTER the marker stamp.

## C5 — Minimal real production RED

The RED test:
- drives the REAL `SdkSessionEventCoordinator` through the
  REAL `handleSessionEvent` BCB re-registration path
  (mirroring the HBOP01/HBOCP01 harness structure)
- injects a fake `taskTelemetry: { recordRuntimeError: vi.fn() }`
  sink via the structural cast the project already uses
  (e.g. ccsrl01.test.ts:146)
- drives two consecutive `done` events: K delivers, K+1 stalls
- asserts `taskTelemetry.recordRuntimeError` was called with
  a typed `RuntimeErrorIncident`

### Pre-fix expected (the RED itself, observed)

```
$ cd apps/vscode && bun run test:vitest -- src/sdk/__tests__/host-blocked-outcome-lifecycle-owner01.hbclo01.test.ts

× HBCLO-01: stalled_no_progress publication invokes taskTelemetry.recordRuntimeError with typed incident
   AssertionError: expected "vi.fn()" to be called at least once
   ❯ host-blocked-outcome-lifecycle-owner01.hbclo01.test.ts:345

× HBCLO-02: delivery_rejected publication invokes taskTelemetry.recordRuntimeError with typed incident
   AssertionError: expected "vi.fn()" to be called at least once
   ❯ host-blocked-outcome-lifecycle-owner01.hbclo01.test.ts:374

✓ HBCLO-10: a delivered outcome does not invoke recordRuntimeError
✓ HBCLO-20: while the marker is held and the verdict is blocked, getTurnPhase() !== 'completed'

Tests  2 failed | 2 passed (4)
```

The RED reproduces. The selected owner is reachable through
the production seam (the C4 guards, the marker stamp, the
`enqueueCompletionContinuationIfHeld` `.then` chain — all
exercised end-to-end through `handleSessionEvent`); the only
missing piece is the `recordRuntimeError` call at the same
point the existing `recordBlockedOutcome*` dogfood counters
are invoked.

The two conservation tests (HBCLO-10 negative control,
HBCLO-20 C11 invariant) PASS — proving that the harness
mirrors the real production shape and that the gap is
specifically the missing `recordRuntimeError` call, not a
test-architecture artifact.

The RED is NOT a `expect(barrier.reason).toBe("stalled_no_progress")`
test (HBOP01 already proved that, see C8 below). It is a
REAL production-seam invariant: a typed verdict on a
production lifecycle consumer. The forbidden
opt-in diagnostic counter (HBCLO01) is a no-go by
construction: this test is unconditional (no
`applyCompletionContinuationUpstreamDiagnosticProfile(true)`
arm required for the assertion to hold once the production
wiring is in place).

## C6 — Producer-to-consumer discriminator

| Case | Required distinction | This ACT's test |
|---|---|---|
| Recoverable hold | Wait safely; no false blocked outcome | HBCLO-10 (delivered outcome → no `recordRuntimeError` call) |
| Stalled no progress | Host exposes blocked outcome | HBCLO-01 (K+1 stalls → `recordRuntimeError` called with `errorClass: "UNKNOWN_RUNTIME_ERROR"`, `source: "completion-continuation-stalled"`) |
| Delivery rejected | Host exposes the existing Elm reason if provenance exists | HBCLO-02 (rejected callback → `recordRuntimeError` called with `source: "completion-continuation-delivery-rejected"`) |
| Held results consumed | Block clears; normal completion may proceed | inherited from `applyBlockedCompletionContinuationOutcome` (not under test; covered by HBOP01/BCB01 §0.1) |
| Duplicate same obligation | No repeated blocked publication | inherited from the marker at-most-one invariant (not under test; covered by HBOP-02/CORRECTION01) |
| New task/session | Old blocked state cannot leak | inherited from `startTask` latch + C4 adversarial guards (REC-06 invariant, not under test) |
| Late K result after K+1 | Stale publication rejected | inherited from CORRECTION01 EPOCH BINDING (HBOP-40 in HBOP01) |

The first divergence in the matrix above is
**`PUBLICATION_MAPPING_MISSING`** — the typed verdict exists
in the marker and the dogfood counter, but does not reach
the selected host lifecycle consumer. The fix is a single
bounded producer-to-consumer mapping
(`applyBlockedCompletionContinuationOutcome` →
`this.options.taskTelemetry?.recordRuntimeError(...)`).

Causal discriminator result: **`PUBLICATION_MAPPING_MISSING`**.

## C7 — Selected owner (already established above)

`TaskTelemetryTracker.recordRuntimeError(incident)` —
preceded in the typed call chain by
`SdkController.handleTaskRuntimeError` (the existing
closure that already wires the V1 EPERM /
`command_containment_failed` flow). The new wiring in the
follow-up bounded repair is one extra call inside
`applyBlockedCompletionContinuationOutcome` AFTER all C4
guards pass.

## C8 — Repair scope decision (recon-only)

| Finding | Disposition |
|---|---|
| Existing owner needs a single bounded mapping | **Yes — this ACT freezes the contract but does NOT perform the repair** |
| Existing owner already supports blocked state | NO — the missing call site at the marker is the gap |
| No suitable owner exists | NO — the owner exists and is reachable |
| Blocked result not reproducible | NO — RED reproduces on the current production code |
| Multiple independent ownership changes required | NO — one call site, one wiring, one additive enum value |

This ACT is **recon-only** per the C11 expected changes
constraint ("Expected changes for recon-only closure: one
focused production-seam test, one ACT report, epic-board
update"). The bounded repair (one extra call inside the
existing helper, one additive new value on the closed
`RuntimeErrorSource` enum) is named at the successor ACT
level with a frozen contract.

A production repair MAY be performed within a successor
ACT only if:
1. The first RED (HBCLO-01/HBCLO-02) continues to fail
   against the current implementation (C5 + this ACT).
2. The causal discriminator (C6) confirms the
   `PUBLICATION_MAPPING_MISSING` diagnosis (this ACT).
3. The bounded mapping is one additive producer-to-consumer
   wiring + one additive `RuntimeErrorSource` enum value
   (C8 / this ACT).
4. Elm authority is unchanged (C7 / this ACT — the verdict
   is from existing TS disc + production callback; no
   `checkElmCompletionAuthority` consult at the publication
   site).

## C9 — Necessity ablation (not executed in this ACT; frozen for the successor)

The successor ACT's repair must run the following ablation:

```
before repair → HBCLO-01 RED, HBCLO-02 RED
repair enabled (one `recordRuntimeError` call) → HBCLO-01 GREEN, HBCLO-02 GREEN
mapping disabled (e.g. gated on a feature flag) → RED returns
mapping restored → GREEN
```

This ACT does NOT execute the ablation (recon-only). The
RED is the missing evidence; the GREEN is the bounded
repair's responsibility. The HBCLO01 harness's
`taskTelemetry` injection is the production seam the
successor ACT will use to enable/disable the mapping.

No prompt-wording workaround, no arbitrary retry cap. The
bounded repair is a single call site addition; the
`command_containment_failed` precedent at
ExtensionMessage.ts:1119 proves additive enum extensions
are safe under the V1 webview contract.

## C10 — Conservation

### Focused C10 test list

```
HBOCP01 host-blocked-outcome-consumer-probe01.test.ts          ✓ 6/6
HBOP01  host-blocked-outcome-publication01.test.ts             ✓ 12/12
CCSLT01 completion-continuation-stall-lifetime01.test.ts       ✓ 10/10
CCSE01  completion-continuation-stall-enforcement01.test.ts    ✓ 5/5
CCSRL01 completion-continuation-stalled-rearm-loop01.test.ts   ✓ 13/13
REARM01 completion-continuation-rearm01.test.ts                ✓ 7/7
CCUTO01 completion-continuation-unresolvable-terminal-outcome01.test.ts ✓ 14/14
CCUPD01 completion-continuation-upstream-discriminator01.test.ts ✓ 9/9
CCCA01  completion-continuation-control-authority01.test.ts    ✓ 35/35
PCRA01  post-run-completion-authority-reevaluation01.test.ts   ✓ 5/5
       task-telemetry-tracker.test.ts                         ✓ 64/64
       task-header-runtime-error-counter-rec01.test.ts        ✓ 13/13
       (also: HBCLO01 new file)                                ✗ 2 RED | 2 GREEN (the RED is the missing owner)
```

Total: **12 pre-existing files / 193 tests PASS; 1 new file
(HBCLO01) with 2 RED + 2 GREEN; pre-existing baseline
failures unchanged.**

### Session replacement / reconnect / reload

| Test path | Coverage | Status |
|---|---|---|
| Session replacement (K → K+1) | inherited from CORRECTION01 EPOCH BINDING (HBOP-40) | ✓ |
| Reconnect/reload (webview remount) | not directly under test; inherited from `runtimeErrorCount` zero-hiding (REC-09 invariant) | ✓ (preserved) |
| Model-input exclusion of display-only status | not applicable; the wire field `runtimeErrorCount` is a cumulative integer, not a text string; the tracker NEVER produces a `RuntimeErrorIncident` string into the model | ✓ (preserved by design) |

### Fabricated completion / weakened Elm authority

| Test path | Status |
|---|---|
| `task.completed` fabrication while blocked | HBCLO-20 C11 invariant: `getTurnPhase() !== "completed"` ✓ |
| Elm Completion Authority unchanged | ACT-owned changes: 0; no `checkElmCompletionAuthority` consult at the publication site (the verdict is from existing TS disc + production callback) ✓ |
| Provider instructions transport | ACT-owned changes: 0 ✓ |
| Private-brand identity | ACT-owned changes: 0 ✓ |

## C11 — Scope

ACT-owned files: **1** (the new test file).

```
$ git status --short
?? apps/vscode/src/sdk/__tests__/host-blocked-outcome-lifecycle-owner01.hbclo01.test.ts
```

A proven bounded implementation in the successor ACT may
touch:
- `apps/vscode/src/sdk/sdk-session-event-coordinator.ts` (one
  new field on `SdkSessionEventCoordinatorOptions` for
  `taskTelemetry`; one new branch in
  `applyBlockedCompletionContinuationOutcome` after the
  C4 guards; one new import)
- `apps/vscode/src/shared/ExtensionMessage.ts` (one
  additive new value on the `RuntimeErrorSource` closed
  enum: `"completion-continuation-stalled" | "completion-continuation-delivery-rejected"`)
- `apps/vscode/src/sdk/SdkController.ts` (wire
  `this.taskTelemetry` to `SdkSessionEventCoordinator`'s
  shared-host construction — the closure already exists
  as `handleTaskRuntimeError`; just add it to the
  coordinator options bag)
- `apps/vscode/src/sdk/sdk-session-lifecycle.ts` (parallel
  wiring for the 6 temp-host callsites if the brief's "shared
  host stays consistent" pattern is preserved; not strictly
  required for the primary-session path)

Not modified by this ACT (and the successor ACT MUST NOT
modify):
```
apps/vscode/elm/**
sdk/packages/llms/**
tools/tart-testbed/**
tools/macos-host-helper/**
```

No new public wire field (the V1 contract reuses
`TaskHeaderTelemetryStrip.runtimeErrorCount`).

## C12 — Gates

```
$ cd apps/vscode && bunx --bun tsc --noEmit --project tsconfig.json
  (no errors; the new test file is typecheck-clean)

$ bun run lint
  biome lint: 2182 files checked, no errors
  bash ./scripts/proto-lint.sh: clean (no proto changes)

$ git diff --check
  (clean; new file is untracked, no tracked dirt)
```

ACT-owned diagnostics: **0**.
Pre-existing baseline failures: **unchanged** (mcprestart01
3/10, swcm04 11/23 — both documented as pre-existing test
drift in prior ACTs; not introduced by this ACT).

## C13 — Evidence and closure

```
ACT: ACT-CLINEMM-P0-BLOCKED-COMPLETION-LIFECYCLE-OWNER01

ENTRY_HEAD:   c8e2a6e29acf314420eaa1b3fe1aeaf506c813f5
SUBJECT_HEAD: c8e2a6e29acf314420eaa1b3fe1aeaf506c813f5

CANDIDATE_OWNERS:
  - TaskTelemetryTracker.recordRuntimeError (CANDIDATE_1; selected)
  - SdkSessionRebuildScheduler.drain (CANDIDATE_2; EXCLUDED per PROBE01)
  - completion-continuation-upstream-runtime dogfood counters
    (CANDIDATE_3; EXCLUDED per PROBE01/PROBE02 reviewer halt)

SELECTED_OWNER:    TaskTelemetryTracker.recordRuntimeError(incident)
EXISTING_CONSUMER: webview TaskHeaderTelemetry `⚠ N` glyph
                   (data-testid="task-header-runtime-error-count")

BLOCKED_LIFETIME:
  established_by: per-task `currentTaskId` latch in
                  TaskTelemetryTracker; cumulative monotonic
  cleared_by:     new task identity (`startTask` with
                  different id); REC-06 invariant
  persisted:      in-memory per SdkController lifetime; not
                  persisted to taskHistory.json per REC-06
                  CORRECTION01 contract (preserved)

REAL_RED:
  reproduced:     YES
  production_seam: SdkSessionEventCoordinator.handleSessionEvent
                   → enqueueCompletionContinuationIfHeld .then
                   → applyBlockedCompletionContinuationOutcome
                   (the C4-guarded helper, mirror of HBOP01)
  evidence:       HBCLO-01 (stalled) and HBCLO-02 (rejected)
                   both fail with "expected vi.fn() to be
                   called at least once" on the current
                   production code at HEAD `c8e2a6e29`

FIRST_DIVERGENT_STAGE: OUTCOME_PUBLICATION_MAPPING
CAUSAL_DISCRIMINATOR:  PUBLICATION_MAPPING_MISSING

REPAIR:
  performed:       false (recon-only ACT)
  files:           []

NECESSITY:
  result:         not_required (this ACT; frozen for the
                  successor ACT; the bounded repair adds one
                  call site + one additive enum value)

CONSERVATION:
  tests:
    focused:        12 pre-existing files / 193 tests PASS
    new file:       HBCLO01: 2 RED + 2 GREEN (the RED IS the
                    production-seam invariant)
    baseline:       mcprestart01 3/10 + swcm04 11/23
                    unchanged (pre-existing test drift)
  typecheck:       PASS (apps/vscode, no new errors)
  lint:            PASS (biome + proto-lint, 2182 files)
  diff_check:      PASS (clean; no tracked dirt)

ELM:
  completion_authority_unchanged: true
  continuation_control_unchanged:  true
  new_kernel:                      false
  consult_at_publication_site:     none (verdict is from
                                   existing TS disc + existing
                                   production callback;
                                   preserved from HBOP01)

VSIX:    NOT_EXECUTED (operator-owned; this ACT is
                   recon-only; no production code touched)

LIVE:    NOT_EXECUTED (operator-owned; same reason)

VERDICT: PASS_BLOCKED_COMPLETION_LIFECYCLE_OWNER_FROZEN

NEXT_ACT: ACT-CLINEMM-P0-BLOCKED-COMPLETION-LIFECYCLE-MAPPING01
  (operator-owned; bounded repair contract frozen by this
  ACT; adds one `recordRuntimeError` call inside the
  existing `applyBlockedCompletionContinuationOutcome`
  helper after the C4 guards + one additive new value on
  the closed `RuntimeErrorSource` enum + the
  `SdkSessionEventCoordinatorOptions.taskTelemetry` field +
  the `SdkController.handleTaskRuntimeError` wiring into
  the shared-host coordinator construction).

  The successor ACT's responsibility:
    - implements the C9 ablation (before/after/disable/restore)
    - re-runs the HBCLO01 test (GREEN expected)
    - runs the C10 conservation suite (no regressions)
    - runs `bun run check-types` + `bun run lint` + `git diff --check`
    - does NOT modify any of: apps/vscode/elm/**,
      sdk/packages/llms/**, tools/tart-testbed/**,
      tools/macos-host-helper/**

## C18 — Commit and handoff

ACT-owned artifacts:
- `.factory/acts/ACT-CLINEMM-P0-BLOCKED-COMPLETION-LIFECYCLE-OWNER01.md` (NEW; this report)
- `.factory/epic-board.md` (updated; see "Blockers" section)
- `apps/vscode/src/sdk/__tests__/host-blocked-outcome-lifecycle-owner01.hbclo01.test.ts` (NEW; 4 tests, 2 RED + 2 GREEN)

```
$ git status --short
?? apps/vscode/src/sdk/__tests__/host-blocked-outcome-lifecycle-owner01.hbclo01.test.ts
```

This ACT does NOT modify any production source file. No
VSIX / install / LIVE is executed.

Operator handoff:
```
SOURCE_HEAD:       c8e2a6e29acf314420eaa1b3fe1aeaf506c813f5
STAGED_ARTIFACT:   apps/vscode/src/sdk/__tests__/host-blocked-
                   outcome-lifecycle-owner01.hbclo01.test.ts
                   (NEW, 4 tests, 2 RED + 2 GREEN)
VSIX:              NOT_EXECUTED
INSTALLED_VERSION: NOT_EXECUTED
LIVE_POST_ACT:     NOT_EXECUTED
PROTECTED_STASH:   stash@{0} on d46223b51 (Tart testbed WIP)
                   preserved
```

Blockers: None.
- HALT_UNEXPECTED_TRACKED_DIRT: cleared (no tracked dirt).
- HALT_RED_NOT_REPRODUCED: cleared (RED reproduces, asserted
  above with vitest output captured in C5).
- HALT_HOST_LIFECYCLE_OWNER_NOT_FOUND: cleared (owner found;
  C7 / selected = `TaskTelemetryTracker.recordRuntimeError`).
- CAPTURE_INSUFFICIENT: cleared (the selected owner has all
  six required properties; C1 / CANDIDATE_1; C7 / selected
  list; C8 / repair scope; C9 / necessity ablation
  contract).

The host-blocked-outcome P0 is resolved at the
"owner selection + RED reproduction" level. The bounded
producer-to-consumer mapping is the successor ACT's
responsibility; the contract is frozen and the
production-seam test seam is in place.

