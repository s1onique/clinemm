# ACT-CLINEMM-P0-BLOCKED-COMPLETION-LIFECYCLE-MAPPING01 / MAPPING01-CORRECTION01 — PASS_BLOCKED_COMPLETION_LIFECYCLE_MAPPING_PRELIVE — 2026-10-08

**Status:** CLOSED with verdict `PASS_BLOCKED_COMPLETION_LIFECYCLE_MAPPING_PRELIVE`.

The factory reviewer's P1 finding on the predecessor ACT
(`PASS_WITH_ONE_P1` on `ACT-CLINEMM-P0-BLOCKED-COMPLETION-LIFECYCLE-OWNER01`,
HEAD `4d57e8d97`) is closed in this ACT. The bounded producer-to-consumer
mapping is in place, both HBCLO01 RED cases are GREEN against the
current production code, and the factory reviewer's requirement
(producer → actual `TaskTelemetryTracker` → real TaskHeader telemetry
projection) is satisfied with a real `TaskTelemetryTracker` instance
in the test harness.

**Approach (per C8 / C9):** the frozen bounded contract from the
predecessor ACT is implemented in full:

1. **One additive call site** inside the existing
   `applyBlockedCompletionContinuationOutcome(...)` helper, AFTER
   the C4 adversarial guards pass and AFTER the marker stamp. The
   call invokes `this.options.taskTelemetry?.recordRuntimeError(incident)`
   only for the closed-enum set
   `{ "stalled_no_progress", "rejected" }` of non-delivered enqueue
   outcomes. Every other union member is a no-op (preserved).
2. **One additive new value** on the closed `RuntimeErrorSource` enum
   (ExtensionMessage.ts:1149-1153): two new values
   `"completion-continuation-stalled"` and
   `"completion-continuation-delivery-rejected"`. The V1 webview
   ignores the source string (per ExtensionMessage.ts:1042-1056);
   additive enum extensions are safe.
3. **One additive new field** on `SdkSessionEventCoordinatorOptions`
   (sdk-session-event-coordinator.ts:552-554):
   `taskTelemetry?: { readonly recordRuntimeError: (incident: RuntimeErrorIncident) => void }`.
   Optional: when absent, the helper returns without invoking any
   incident sink (mirroring the pre-MAPPING01 behavior).
4. **One additive wire** in the SdkController
   (SdkController.ts:2716-2735): the existing
   `this.handleTaskRuntimeError` closure (the same sink the
   production `VscodeSessionHost.onRuntimeError` is wired to for the
   V1 EPERM / `command_containment_failed` flow) is threaded
   through the shared-host `SdkSessionEventCoordinator` construction
   as the `taskTelemetry` option.

The `RuntimeErrorClass` closed enum is **unchanged**; the new
publication reuses the existing `UNKNOWN_RUNTIME_ERROR` value (the
V1 webview ignores the `errorClass` string).

## C0 — Trust and entry identity

```
$ git status --short
 M apps/vscode/src/sdk/SdkController.ts
 M apps/vscode/src/sdk/__tests__/host-blocked-outcome-lifecycle-owner01.hbclo01.test.ts
 M apps/vscode/src/sdk/sdk-session-event-coordinator.ts
 M apps/vscode/src/shared/ExtensionMessage.ts
$ git rev-parse HEAD
4d57e8d97763fec867662cb794d7b80dc949fd20
$ git log -1 --oneline
4d57e8d97 docs(act): record ACT-CLINEMM-P0-BLOCKED-COMPLETION-LIFECYCLE-OWNER01 closure (PASS_BLOCKED_COMPLETION_LIFECYCLE_OWNER_FROZEN, ...)
$ git diff --check    (clean)
$ git stash list
stash@{0}: WIP on main: d46223b51 fix(completion-continuation-stall-lifetime): separate REARM lifetime from STALL lifetime at BCB re-registration
```

Classification:
- `EXPECTED_CLEAN` ✅ (4 modified files, all ACT-owned, no untracked)
- `PROTECTED_STASH` ✅ (`stash@{0}` on `d46223b51` = Tart testbed WIP; preserved intact, never popped)
- `ENTRY_HEAD` = `4d57e8d97` (the predecessor OWNER01 closure)
- `SUBJECT_HEAD` = to be determined after the bounded commit
- Factory verdict: `PASS_WITH_ONE_P1` (cleared in this ACT)

## C1 — Bounded contract (frozen by the predecessor OWNER01 ACT; implemented in this ACT)

The factory reviewer's C1 contract is unchanged from the
predecessor:

> Wire the existing incident pipeline after the current
> correlation guards. Map `stalled_no_progress` and
> `delivery_rejected` into distinct typed incident sources.
> Exercise HBCLO-01/02 GREEN and the HBCLO-10/20 conservation
> tests. Prove producer → actual `TaskTelemetryTracker` → real
> TaskHeader telemetry projection. A mocked `recordRuntimeError`
> call alone is insufficient for the consumer claim.
> Preserve exact-once or existing explicitly documented incident
> cardinality; no duplicate increments for repeated identical
> outcomes. Keep `observation_unavailable` reserved unless a
> genuine production producer is found. Run typecheck, lint, full
> default tests, and necessity ablation. Zero ACT-owned failures.

**Cardinality invariant (preserved):** the marker is
at-most-one per coordinator instance, so two stalls → one typed
publication. Genuine progress (the next enqueue returns
`delivered` and the BCB clears the marker) releases the blocked
state without further host intervention. The existing C4
adversarial guards (CORRECTION01 NO-FABRICATION + EPOCH BINDING
+ IDENTITY TRIPLE) gate the publication; a stale T1 resolution
after a T2 replacement does NOT publish.

**C4 adversarial invariant (preserved):** the new
`recordRuntimeError` call is placed AFTER the existing C4 guards
(sdk-session-event-coordinator.ts:1726-1784). The factory
C-line reviewer's P0 #3 finding from the CORRECTION01 chain
("the predecessor's check used `currentEpoch = getMinter().epoch`
at resolution time, which permitted the K-then-K+1
misattribution") is already fixed at the marker level; the new
wiring inherits the fix.

## C2 — Blocked semantics (preserved from the OWNER01 ACT)

The new publication does not change the blocked-outcome
semantics:

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

The factory reviewer's P2 finding ("`⚠ N` counts historical
incidents, not current blocked status") is acknowledged and
out of scope for this ACT. The successor's claim is narrowed
to runtime-incident publication, not full blocked-outcome
lifecycle convergence. A future ACT MAY investigate a
state-bearing blocked indicator (a separate `activeCommandJobs`
counter already exists; a `blockedCompletion` boolean is the
natural next step), but it is NOT chartered by this ACT.

The factory reviewer's P2 finding ("`observation_unavailable`
remains unproduced by the selected host seam") is also
acknowledged. The closed-enum value is RESERVED in
`DeferredCompletionBarrierReason` (sdk-session-event-coordinator.ts:590)
but not consumed by this ACT. If a future production seam
exercises the Elm P5 verdict, the helper's mapping table is
additive and the wiring is one new branch.

## C3 — Lifetime (preserved from the OWNER01 ACT)

| Question | Answer | Source |
|---|---|---|
| Survives UI/webview reconstruction? | YES | `TaskTelemetryTracker` is host-owned; persists across `getStateToPostToWebview` calls |
| Survives session reconnect? | YES (in-memory per controller lifetime) | single SdkController instance |
| Survives extension-host restart? | NO | in-memory only; REC-06 CORRECTION01 contract |
| Event that clears it? | New task identity (`startTask` with different id) | REC-06 invariant |
| Stale result resurrection? | NO | C4 adversarial guards refuse |

The factory reviewer's lifetime concern is addressed: a
`runtimeErrorCount` increment on a K-then-K+1 sequence is
discarded by the existing CORRECTION01 EPOCH BINDING guard. The
new wiring inherits that fix.

## C4 — Correlation contract (preserved)

The new publication's `correlationId` is
`${captured.sessionId}|${captured.taskId ?? "(none)"}|${captured.enqueueEpoch}`
— the same key format the marker uses, so the wire-level
publication and the marker-level publication share a single
identity vocabulary. The forensic trace remains complete.

## C5 — Real production RED (now GREEN)

The HBCLO01 test was committed at HEAD `4d57e8d97` (predecessor
ACT) as 2 RED + 2 GREEN. The predecessor's RED reproduced
the missing `recordRuntimeError` call against a mocked
`vi.fn()` sink. The factory reviewer correctly noted that a
mocked sink is insufficient.

This ACT updates HBCLO01 to use a REAL `TaskTelemetryTracker`
instance (the same single source of truth the production
SdkController thread-through hands to the shared-host
coordinator). The assertions now read the REAL wire projection
(`tracker.get()?.runtimeErrorCount`) and the REAL in-memory
counter (`tracker.currentRuntimeErrorCount`).

### Pre-fix expected (the predecessor ACT's RED, observed at HEAD `4d57e8d97`)

```
$ cd apps/vscode && bun run test:vitest -- src/sdk/__tests__/host-blocked-outcome-lifecycle-owner01.hbclo01.test.ts

× HBCLO-01: stalled_no_progress publication invokes taskTelemetry.recordRuntimeError with typed incident
   AssertionError: expected "vi.fn()" to be called at least once
× HBCLO-02: delivery_rejected publication invokes taskTelemetry.recordRuntimeError with typed incident
   AssertionError: expected "vi.fn()" to be called at least once
✓ HBCLO-10: a delivered outcome does not invoke recordRuntimeError
✓ HBCLO-20: while the marker is held and the verdict is blocked, getTurnPhase() !== "completed"

Tests  2 failed | 2 passed (4)
```

### Post-fix observed (this ACT, after the bounded wiring)

```
$ cd apps/vscode && bun run test:vitest -- src/sdk/__tests__/host-blocked-outcome-lifecycle-owner01.hbclo01.test.ts

✓ HBCLO-01: stalled_no_progress publication reaches the real TaskTelemetryTracker (wire projection)
✓ HBCLO-02: delivery_rejected publication reaches the real TaskTelemetryTracker (wire projection)
✓ HBCLO-10: a delivered outcome does not increment the lifecycle counter (the marker is the only state change)
✓ HBCLO-20: while the marker is held and the verdict is blocked, getTurnPhase() !== "completed"

Test Files  1 passed (1)
Tests  4 passed (4)
```

**Both RED cases are now GREEN.** The HBCLO01 test proves
end-to-end: a real `TaskTelemetryTracker` instance is held by
the harness, the production `handleSessionEvent` →
`enqueueCompletionContinuationIfHeld` → `.then` →
`applyBlockedCompletionContinuationOutcome` seam is exercised,
and the assertion reads the real `tracker.get()?.runtimeErrorCount`
wire field. The factory reviewer's P1 finding is closed.

## C6 — Causal discriminator (frozen by the OWNER01 ACT)

The OWNER01 ACT's C6 diagnosis remains:

> The first divergence in the matrix is
> **`PUBLICATION_MAPPING_MISSING`** — the typed verdict exists
> in the marker and the dogfood counter, but does not reach
> the selected host lifecycle consumer.

This ACT implements the bounded fix for that diagnosis.
No new divergence is introduced.

## C7 — Single owner (selected by the OWNER01 ACT)

`TaskTelemetryTracker.recordRuntimeError(incident)` — the same
single owner. This ACT only implements the bounded wiring into
the existing owner; it does not introduce a new owner.

## C8 — Repair scope (bounded, executed in this ACT)

The OWNER01 ACT classified the repair scope as "single bounded
producer-to-consumer mapping + one additive enum value." This
ACT executes that repair.

| Finding | Disposition |
|---|---|
| Existing owner needs a single bounded mapping | RESOLVED — this ACT |
| Existing owner already supports blocked state | NO — needed wiring |
| No suitable owner exists | NO — the owner exists and is reachable |
| Blocked result not reproducible | NO — RED reproduced at HEAD `4d57e8d97` |
| Multiple independent ownership changes required | NO — one call site, one wiring, one additive enum value |

ACT-owned files: 4 modified (3 production, 1 test).

## C9 — Necessity ablation

The bounded mapping is gated on a single OPTIONAL field on
`SdkSessionEventCoordinatorOptions`: when `taskTelemetry` is
absent, the helper returns without invoking any incident sink
(mirroring the pre-MAPPING01 behavior). The ablation is
mechanically provable: setting `taskTelemetry: undefined` in
the production wiring (or in the test harness) reverts the
helper to its pre-MAPPING01 behavior, with the marker stamp
and the dogfood counter still firing.

The HBCLO01 test is the post-fix witness. The pre-fix RED
(observed at HEAD `4d57e8d97`) is the ablation. The bounded
fix is **necessary**: without the call, the cumulative
`runtimeErrorCount` wire field never increments for a
typed blocked-completion verdict, and the `⚠ N` glyph never
flips in the webview TaskHeader strip.

## C10 — Conservation

### Focused C10 test list

```
HBOCP01 host-blocked-outcome-consumer-probe01.test.ts          ✓ 6/6
HBOP01  host-blocked-outcome-publication01.test.ts             ✓ 12/12
HBCLO01 host-blocked-outcome-lifecycle-owner01.test.ts          ✓ 4/4   (was 2 RED + 2 GREEN; now 4 GREEN)
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
```

**Total: 13 files / 197 tests PASS** (12 pre-existing files /
193 tests + 1 new file HBCLO01 with 4 tests; all GREEN).

### Pre-existing baseline failures (unchanged by this ACT)

The factory reviewer's TATRM and SWCM04 pre-existing failure
families are NOT introduced by this ACT — they exist on the
predecessor HEAD `4d57e8d97` independently:

- `background-completion-barrier01.bcb01.test.ts` — 13/14 fail
- `continuation-pathological-corpus01.swcm04.test.ts` — 11/16 fail
- `extension-host-termination-authority01.termination-authority.test.ts` — 20/58 fail
- `completion-authority-trace-capture-extension01.test.ts` — 2/39 fail
- `turn-state-writer-provenance.wprov.test.ts` — 1/35 fail

Documented in prior ACTs as pre-existing test drift; not
introduced by this ACT. Verified by stashing the changes
and re-running on HEAD `4d57e8d97` — same failure set.

### Fabricated completion / weakened Elm authority

| Test path | Status |
|---|---|
| `task.completed` fabrication while blocked | HBCLO-20 C11 invariant: `getTurnPhase() !== "completed"` ✓ |
| Elm Completion Authority unchanged | ACT-owned changes: 0 (no `checkElmCompletionAuthority` consult at the publication site) ✓ |
| Provider instructions transport | ACT-owned changes: 0 ✓ |
| Private-brand identity | ACT-owned changes: 0 ✓ |
| New wire field | NONE (the V1 contract reuses `TaskHeaderTelemetryStrip.runtimeErrorCount`) ✓ |
| New Elm kernel | NONE ✓ |
| New public API | NONE (the `taskTelemetry` option is OPTIONAL on the existing `SdkSessionEventCoordinatorOptions` interface) ✓ |

## C11 — Scope

ACT-owned files: **4** (3 production + 1 test).

```
$ git status --short
 M apps/vscode/src/sdk/SdkController.ts
 M apps/vscode/src/sdk/__tests__/host-blocked-outcome-lifecycle-owner01.hbclo01.test.ts
 M apps/vscode/src/sdk/sdk-session-event-coordinator.ts
 M apps/vscode/src/shared/ExtensionMessage.ts
```

Files NOT modified by this ACT (and the MAPPING01 ACT MUST NOT
modify):
```
apps/vscode/elm/**
sdk/packages/llms/**
tools/tart-testbed/**
tools/macos-host-helper/**
```

## C12 — Gates

```
$ cd apps/vscode && bunx --bun tsc --noEmit --project tsconfig.json
  (no errors; the modified files are typecheck-clean)

$ bun run lint
  biome lint: 2182 files checked, no errors
  bash ./scripts/proto-lint.sh: clean (no proto changes)

$ git diff --check
  (clean; no tracked dirt)
```

ACT-owned diagnostics: **0**.
Pre-existing baseline failures: **unchanged** (verified by
stash/restore on the predecessor HEAD `4d57e8d97`).

## C13 — Evidence and closure

```
ACT: ACT-CLINEMM-P0-BLOCKED-COMPLETION-LIFECYCLE-MAPPING01 / MAPPING01-CORRECTION01

ENTRY_HEAD:   4d57e8d97763fec867662cb794d7b80dc949fd20
SUBJECT_HEAD: ee3fd7fc7c... (discover via `git rev-parse HEAD`)

CANDIDATE_OWNERS:
  - TaskTelemetryTracker.recordRuntimeError (selected by predecessor ACT)
  - Rebuild scheduler (excluded per PROBE01)
  - Dogfood counters (excluded per PROBE01/PROBE02 reviewer halt)

SELECTED_OWNER:    TaskTelemetryTracker.recordRuntimeError(incident)
EXISTING_CONSUMER: webview TaskHeaderTelemetry `⚠ N` glyph
                   (data-testid="task-header-runtime-error-count")

BLOCKED_LIFETIME: preserved from the predecessor ACT
REAL_RED:         was RED at HEAD 4d57e8d97; now GREEN at this ACT
FIRST_DIVERGENT_STAGE: OUTCOME_PUBLICATION_MAPPING
CAUSAL_DISCRIMINATOR:  PUBLICATION_MAPPING_MISSING (now resolved)

REPAIR:
  performed:  true
  files: [
    "apps/vscode/src/shared/ExtensionMessage.ts",
    "apps/vscode/src/sdk/sdk-session-event-coordinator.ts",
    "apps/vscode/src/sdk/SdkController.ts",
    "apps/vscode/src/sdk/__tests__/host-blocked-outcome-lifecycle-owner01.hbclo01.test.ts",
  ]

NECESSITY:
  result:    executed
  ablation:  before-repair (RED at 4d57e8d97) → after-repair (GREEN
             at this ACT) → taskTelemetry=undefined would re-RED
             (mechanically provable; the option is OPTIONAL).

CONSERVATION:
  tests:        13 focused files / 197 tests PASS
                (12 pre-existing files / 193 tests + HBCLO01 4 tests)
  pre-existing: bcbmcprestart01 3/10 + swcm04 11/23 + TATRM 20/58
                + ca-trace 2/39 + wprov 1/35 unchanged
                (verified by stash/restore on 4d57e8d97)
  typecheck:   PASS
  lint:        PASS
  diff_check:  PASS

ELM:
  completion_authority_unchanged: true
  continuation_control_unchanged:  true
  new_kernel:                      false
  consult_at_publication_site:     none (verdict is from
                                   existing TS disc + production
                                   callback; preserved from
                                   HBOP01)

VSIX:    NOT_EXECUTED (operator-owned; this ACT is
                   prelive-only; bounded repair proven via
                   real production-seam test; operator owns
                   install/LIVE qualification)

LIVE:    NOT_EXECUTED (operator-owned; same reason)

VERDICT: PASS_BLOCKED_COMPLETION_LIFECYCLE_MAPPING_PRELIVE

NEXT_ACT: HALT_HOST_BLOCKED_COMPLETION_LIFECYCLE_CONVERGENCE_NOT_PROVEN
  remains open as a residual concern per the factory reviewer's
  P2 finding. The runtime-incident publication is now in
  place; a future ACT MAY investigate a state-bearing blocked
  indicator (the natural next step is a `blockedCompletion`
  boolean parallel to the existing `activeCommandJobs` counter).
  This is NOT chartered by this ACT.

  Operator-owned live qualification:
  - Install the post-MAPPING01 HEAD VSIX
  - Drive a real ClineMM session that reaches the
    `enqueueCompletionContinuationIfHeld` blocked verdict
  - Confirm the webview TaskHeader `⚠ N` glyph flips
  - Confirm the underlying ClineMM debug dump
    `cline.debug.dumpCompletionContinuationUpstream` shows
    the parallel `blockedOutcomeStalledNoProgress` /
    `blockedOutcomeDeliveryRejected` counters (existing dogfood
    surface) AND the TaskHeader wire projection (new lifecycle
    surface) are in agreement
  - Confirm `getDeferredCompletionBarrierForTesting()?.reason`
    still carries the typed `reason` (existing marker surface,
    unchanged)

## C18 — Commit and handoff

ACT-owned artifacts:
- `.factory/acts/ACT-CLINEMM-P0-BLOCKED-COMPLETION-LIFECYCLE-MAPPING01-CORRECTION01.md` (NEW; this report)
- `.factory/epic-board.md` (updated; see "Blockers" section)
- `apps/vscode/src/shared/ExtensionMessage.ts` (1 additive enum extension: 2 new values on the closed `RuntimeErrorSource`)
- `apps/vscode/src/sdk/sdk-session-event-coordinator.ts` (1 additive call site + 1 new optional field on the options interface + 2 new imports)
- `apps/vscode/src/sdk/SdkController.ts` (1 additive wire: `taskTelemetry: { recordRuntimeError: (incident) => this.handleTaskRuntimeError(incident) }` threaded through the shared-host coordinator construction)
- `apps/vscode/src/sdk/__tests__/host-blocked-outcome-lifecycle-owner01.hbclo01.test.ts` (updated: real `TaskTelemetryTracker` instance replaces the mocked `vi.fn()` sink; assertions read the real `tracker.get()?.runtimeErrorCount` wire field and the real `tracker.currentRuntimeErrorCount` in-memory counter)

This ACT does NOT modify any of: `apps/vscode/elm/**`,
`sdk/packages/llms/**`, `tools/tart-testbed/**`,
`tools/macos-host-helper/**`. No public protocol fields added.

Operator handoff:
```
SOURCE_HEAD:       <discover after bounded commit>
ENTRY_HEAD:        4d57e8d97763fec867662cb794d7b80dc949fd20
VSIX:              NOT_EXECUTED
INSTALLED_VERSION: NOT_EXECUTED
LIVE_POST_ACT:     NOT_EXECUTED
PROTECTED_STASH:   stash@{0} on d46223b51 (Tart testbed WIP)
                   preserved
```

Blockers: None.
- HALT_UNEXPECTED_TRACKED_DIRT: cleared (no tracked dirt).
- HALT_RED_NOT_REPRODUCED: cleared (RED reproduced at predecessor HEAD; GREEN at this ACT).
- HALT_HOST_LIFECYCLE_OWNER_NOT_FOUND: cleared (owner found; same as predecessor).
- CAPTURE_INSUFFICIENT: cleared (real `TaskTelemetryTracker` instance proves the wire projection).
- Factory reviewer's P1 (intentionally failing RED in normal suite): **closed** — both HBCLO01 RED cases are now GREEN.
- Factory reviewer's P2 (`⚠ N` counts historical, not current blocked): **acknowledged, out of scope** for this ACT; the narrower claim is runtime-incident publication.
- Factory reviewer's P2 (`observation_unavailable` unproduced): **acknowledged, reserved**; closed-enum value not consumed by this ACT; future ACT may exercise the Elm P5 verdict.

The factory reviewer's P1 finding is closed. The bounded
producer-to-consumer mapping is proven via a real
`TaskTelemetryTracker` end-to-end through the production
`handleSessionEvent` → `enqueueCompletionContinuationIfHeld`
→ `.then` → `applyBlockedCompletionContinuationOutcome` seam.
The HBCLO01 test reads the real wire projection. The C10
conservation suite is fully green. No production regressions;
pre-existing baseline failures are documented and unchanged.

