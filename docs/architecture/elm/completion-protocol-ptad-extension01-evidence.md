
# ACT-CLINEMM-COMPLETION-PTAD-EXTEND01 — Plan

> **Status**: ACTIVE plan (not yet implemented).
> Authored under the factory reviewer's `C1: GO` disposition
> (recon + qualification both PASS; PTAD-EXTEND01 block lifted).
> Implementation lands in follow-up commits in this same
> session/branch.
> When implementation is complete, the closed ACT may be promoted
> into `.factory/acts/` via the existing whitelist mechanism (see
> `.gitignore:122-125`).



> Minimal bounded PTAD schema extension to add the causal
> discriminator for the completion-protocol-liveness family.
> Reuses the existing `PostTerminalAuthorityDiagnostic` substrate.
> Default OFF. No wire delta. Temporary diagnostic.

## 1. Goal

A future live specimen of the completion-protocol-liveness symptom
(tasks that stop without a truthful terminal framing — the family
catalogued at `.factory/epics/runtime-task-progression.md`) can be
causally classified from a single PTAD dump. The minimum
discriminator is two booleans read from the canonical
`MessageTranslatorState` authority:

```text
attemptCompletionSeen          ∈ {false, true}
terminalResponseCommittedThisTurn ∈ {false, true}
```

These are the actual missing causal discriminator. The PTAD substrate
already records:

```text
sessionId, taskId, epoch     → identity
runtimeStatus, modelStreaming → runtime truth
shadowStatus, recoveryState  → shadow truth
turnState.phase (legacyPhase) → turn phase
clinemessages.*              → already on the wire (ExtensionState)
```

So this ACT adds two booleans. Nothing else.

## 2. Why only these two

The future bound specimen can then distinguish three causal branches:

```text
attempt=false, committed=false
  → completion protocol was never entered
     (model never invoked the completion tool;
      possibly a YOLO/budget-aborted run)

attempt=true, committed=false
  → completion was attempted but authority was lost
     (final row never published)

committed=true
  → publication / projection branch becomes relevant
     (final row was emitted; bad presentation is downstream)
```

That is already enough to choose the next causal seam.

## 3. Deferred / out-of-scope

Per factory disposition (`docs/architecture/elm/completion-protocol-capture-surface-qualification01-evidence.md`):

```text
doneReason                                DEFER_V2
  (useful context, but does not discriminate the leading A/B branches)

completionPolicyRequireCompletionTool    LIVE_UNOBSERVABLE for V1
  (would require plumbing through ArbiterSnapshot / shadow recorder;
   stop condition HALT_DIAGNOSTIC_REQUIRES_NEW_RUNTIME_STATE fires)

lastToolRequestedName                     already on the wire
modelFinishReason                         DEFER_V2
duplicate phase/message fields            already in PTAD
```

If a V2 is opened, the order of attempts is:

1. `doneReason` — only if V1 leaves two hypotheses indistinguishable.
2. `completionPolicyRequireCompletionTool` — only via the existing
   in-process translation seam, NOT via new state plumbing.

## 4. Contract

## 5. Bounded correction

### 5.1 Type extension

Add two optional fields to `PostTerminalAuthoritySnapshot` in
`apps/vscode/src/shared/post-terminal-authority-diagnostic.ts`:

```ts
/**
 * ACT-CLINEMM-COMPLETION-PTAD-EXTEND01:
 * Whether the message translator observed the completion tool
 * (attempt_completion / submit_and_exit) being called this turn.
 * Read from `MessageTranslatorState.wasAttemptCompletionSeen()`
 * at the extension-side capture seam in
 * `SdkController.getStateToPostToWebview()`.
 *
 * ABSENT means the field was not captured at this push (PTAD off,
 * or the capture site predates the EXTEND01 schema). False vs
 * absent are distinguishable: false is a captured `false`,
 * absent means "no measurement".
 */
readonly attemptCompletionSeen?: boolean

/**
 * ACT-CLINEMM-COMPLETION-PTAD-EXTEND01:
 * Whether the translator committed a terminal user-facing response
 * this turn (a finalized say:"completion_result" /
 * say:"plan_completion_result" / ask:"api_req_failed" row). Read
 * from `MessageTranslatorState.wasTerminalResponseCommittedThisTurn()`.

### 5.2 Builder extension

Extend `BuildExtensionSnapshotArgs` in
`apps/vscode/src/sdk/post-terminal-authority-diagnostic-builder.ts`
with an optional reference to `MessageTranslatorState`:

```ts
import type { MessageTranslatorState } from "./message-translator"

export interface BuildExtensionSnapshotArgs {
    // ... existing fields ...
    /**
     * ACT-CLINEMM-COMPLETION-PTAD-EXTEND01:
     * Optional reference to the canonical translator state. When
     * provided, the builder reads the two turn-outcome booleans.
     * The caller's lifecycle owns this object; the builder does
     * NOT retain the reference.
     */
    readonly messageTranslatorState?: Pick<
        MessageTranslatorState,
        "wasAttemptCompletionSeen" | "wasTerminalResponseCommittedThisTurn"
    >
}
```

The `Pick<>` structural type deliberately limits the surface area:
the builder does NOT call `setAttemptCompletionSeen()` /
`setTerminalResponseCommittedThisTurn()` and therefore cannot
mutate the translator. This is the structural embodiment of the
"HALT_DIAGNOSTIC_MUTATES_MESSAGE_TRANSLATOR_SEMANTICS" stop
condition: the type system forbids it.

In `buildExtensionSnapshotFromState`, populate the two fields:

```ts
return {
    // ... existing fields ...
    attemptCompletionSeen: args.messageTranslatorState?.wasAttemptCompletionSeen(),
    terminalResponseCommittedThisTurn: args.messageTranslatorState?.wasTerminalResponseCommittedThisTurn(),
}
```

### 5.3 SdkController wiring

At `apps/vscode/src/sdk/SdkController.ts:3583-3594`, pass
`messageTranslatorState: this.messageTranslatorState`:

```ts
if (isPostTerminalAuthorityDiagnosticEnabled("extension")) {

## 6. Capture runbook

The instrumentation alone does not fix the prior P0
(`SCREENSHOT_TO_SESSION_BINDING = NOT_PROVEN`). A future capture
counts only when the binding discipline is followed:

```text
1. Observe the missing task-level Completed badge.
2. DO NOT type Continue / another prompt. (Each prompt advances
   turnState.phase and may clear the captured snapshot.)
3. Capture the visible screenshot.
4. Note the visible task / session identity (from the TaskHeader
   or task title bar).
5. Run `cline.debug.dumpPostTerminalAuthorityDiagnostic`.
6. Read `~/.cline/data/post-terminal-authority-diagnostic-extension.jsonl`
   and record the last record's sessionId / taskId / epoch.
7. Bind: screenshot timestamp / task title ↔ PTAD record identity.
8. If step 7 cannot be performed, the capture is INVALID for
   future causal classification — discard.
```

This runbook is produced as a durable side effect of this ACT.

## 7. Required tests

Per factory disposition, pin the actual capture boundary (not
generic PTAD bookkeeping). Tests are added to the existing
`apps/vscode/src/sdk/__tests__/post-terminal-authority-diagnostic-builder.test.ts`
and the existing `apps/vscode/src/sdk/__tests__/post-terminal-authority-diagnostic-wiring.test.ts`:

### 7.1 Builder unit tests (matrix over MessageTranslatorState)

```text
B1-EXT01
  PTAD disabled (helper called with no messageTranslatorState)
  → result.attemptCompletionSeen is undefined,
    result.terminalResponseCommittedThisTurn is undefined.
  (No-zero-delta invariant: absent = no measurement.)

B2-EXT01
  messageTranslatorState.wasAttemptCompletionSeen() = false
  messageTranslatorState.wasTerminalResponseCommittedThisTurn() = false
  → result.attemptCompletionSeen === false (literal false, NOT undefined)
    result.terminalResponseCommittedThisTurn === false

B3-EXT01
  messageTranslatorState.wasAttemptCompletionSeen() = true
  messageTranslatorState.wasTerminalResponseCommittedThisTurn() = false
  → result.attemptCompletionSeen === true
    result.terminalResponseCommittedThisTurn === false

B4-EXT01
  messageTranslatorState.wasAttemptCompletionSeen() = true
  messageTranslatorState.wasTerminalResponseCommittedThisTurn() = true
  → result.attemptCompletionSeen === true
    result.terminalResponseCommittedThisTurn === true
```

### 7.2 Structural authority test (load-bearing)

Prove that the values come from the real `MessageTranslatorState`
authority, not from duplicated booleans invented in PTAD or the
builder:

```text
S1-EXT01
  const state = new MessageTranslatorState() // real constructor
  state.setAttemptCompletionSeen()
  state.setTerminalResponseCommittedThisTurn()
  buildExtensionSnapshotFromState({ state, shadow, messageTranslatorState: state })
  → snapshot.attemptCompletionSeen === true (read via real accessor)
  → snapshot.terminalResponseCommittedThisTurn === true
  → NOT undefined, NOT hard-coded, NOT a duplicate field on the
    builder or on the snapshot itself
```

If S1-EXT01 passes, the values are demonstrably sourced from
`MessageTranslatorState`'s canonical authority. If it fails
(e.g. the field is `undefined`), the contract is broken.

### 7.3 Ring/JSONL round-trip

```text
J1-EXT01
  Push a record with both fields = true.
  Get the records via getPostTerminalAuthorityDiagnosticRecords().
  JSON.parse(JSON.stringify(record)) and re-parse.
  → result.attemptCompletionSeen === true
    result.terminalResponseCommittedThisTurn === true
  (i.e. the new optional fields survive JSONL round-trip.)
```

### 7.4 Wiring test (structural, source-only)

Add to `post-terminal-authority-diagnostic-wiring.test.ts`:

```text
W1-EXT01
  SdkController source at the PTAD capture site
  (around getStateToPostToWebview line 3583)
  must contain `messageTranslatorState: this.messageTranslatorState`
  inside the buildExtensionSnapshotFromState call.
W2-EXT01
  Builder source must import the structural
  `messageTranslatorState?: Pick<MessageTranslatorState, ...>`
  field and must NOT import any setter methods.
W3-EXT01
  The post-terminal-authority-diagnostic module must declare the
  two new optional fields on PostTerminalAuthoritySnapshot.
```

W2-EXT01 is the structural embodiment of
`HALT_DIAGNOSTIC_MUTATES_MESSAGE_TRANSLATOR_SEMANTICS`: the test
fails if a setter ever leaks into the builder.

### 7.5 Temporal capture order test (reviewer P1 bounded correction)

Tests added at commit `081ae974a` in a new describe block
`T1-EXT01: temporal capture order — snapshot samples before
lifecycle reset` in
`apps/vscode/src/sdk/__tests__/post-terminal-authority-diagnostic-builder.test.ts`.

The seam exercised is the same shape as the production capture
site in `SdkController.getStateToPostToWebview()`:

```text
recordPostTerminalAuthoritySnapshot(
  buildExtensionSnapshotFromState({ ..., messageTranslatorState }),
)
```

NOT a mock-only builder test. The live PTAD ring buffer
(`enablePostTerminalAuthorityDiagnostic`, `clearPostTerminalAuthorityDiagnostic`,
`getPostTerminalAuthorityDiagnosticRecords`) drives the real
capture and read paths that a future bound specimen will use.

```text
T1-EXT01-A (load-bearing)
  real new MessageTranslatorState()
  state.setAttemptCompletionSeen()
  state.setTerminalResponseCommittedThisTurn()
  recordPostTerminalAuthoritySnapshot(buildExtensionSnapshotFromState({messageTranslatorState: state}))
  getPostTerminalAuthorityDiagnosticRecords("extension")
  -> records.length === 1
  -> records[0].attemptCompletionSeen === true
  -> records[0].terminalResponseCommittedThisTurn === true
  state.clearTurnOutcome()       // production lifecycle reset
  recordPostTerminalAuthoritySnapshot(buildExtensionSnapshotFromState({messageTranslatorState: state, state: {...baseState, stateVersion: 1}}))
  getPostTerminalAuthorityDiagnosticRecords("extension")
  -> records.length === 2
  -> records[1].attemptCompletionSeen === false
  -> records[1].terminalResponseCommittedThisTurn === false
  -> records[0].attemptCompletionSeen === true   (immutable across reset)
  -> records[0].terminalResponseCommittedThisTurn === true
  -> records[0].capturedAt preserved
  -> records[0].stateVersion preserved

T1-EXT01-B
  Same lifecycle shape with only setAttemptCompletionSeen()
  (no setTerminalResponseCommittedThisTurn()). Proves the
  (true, false) branch — "completion attempted, authority lost" —
  is preserved across the reset.

T1-EXT01-C (negative case)
  Reset FIRST then capture. Proves that a capture taken AFTER
  reset correctly shows (false, false). This pins the consequence
  of getting the capture ordering wrong so a future regression
  is detected as a different shape rather than silently
  misclassified.
```

T1-EXT01-A is the load-bearing test. Without it, the implementation
could compile and pass all prior tests while still misclassifying
causality on a real specimen.

### 7.6 Production-lifecycle capture-order proof (reviewer P1 round 2 bounded correction)

Tests added at commit `e55240372` in a new describe block
`T2-EXT01: production-lifecycle PTAD capture order` in
`apps/vscode/src/sdk/sdk-session-event-coordinator.test.ts`.

The reviewer (Factory, session 2026-08-27, round 2) accepted T1 as
a "necessity witness" but required that production — not the test —
choose the ordering:

> "T1-EXT01-A/B/C are worthwhile. Their correct purpose is: ...
> rename the headline ... toward `snapshot preserves whichever
> translator state exists at capture time` until actual production
> ordering is established."

> "Do not modify the implementation yet. First add one test that lets
> **production choose the ordering**."

T2-EXT01 satisfies this exactly. The seam exercised is
`SdkSessionEventCoordinator.handleSessionEvent(...)`, the production
class that drives `translateSessionEvent` + `appendAndEmit` +
`postStateToWebview`. Production decides:

```text
content_start { tool: attempt_completion }
  → translateSessionEvent sets setAttemptCompletionSeen
  → appendAndEmit
  → postStateToWebview fires → PTAD capture reads (true, false)

content_end { tool: attempt_completion }
  → translateSessionEvent sets setTerminalResponseCommittedThisTurn
  → appendAndEmit
  → postStateToWebview fires → PTAD capture reads (true, true)

done { success: true }
  → turn complete
  → postStateToWebview fires → PTAD capture reads (true, true)

pending_prompt_submitted
  → translateSessionEvent (no terminal surface)
  → messageTranslatorState.clearTurnOutcome()  ← line 80 of sdk-session-event-coordinator.ts
  → appendAndEmit
  → postStateToWebview fires → PTAD capture reads (false, false)
```

The test wires `postStateToWebview` to invoke the production PTAD
capture path (buildExtensionSnapshotFromState + recordPostTerminalAuthoritySnapshot),
mirroring what `SdkController.getStateToPostToWebview` does in
production.

```text
T2-EXT01-A (load-bearing):
  Real SdkSessionEventCoordinator with real translateSessionEvent.
  Drive: content_start → content_end → done → pending_prompt_submitted.
  Expected: some PTAD record has (true, true)
            (this is the canonical terminal push)
            After pending_prompt_submitted:
              Last record has (false, false)
              Terminal (true, true) record immutable
              postStateToWebview was called >= 2 times.

T2-EXT01-B (symmetric):
  Drive: content_start → done (skip content_end).
  Expected: terminal push records (true, false) — completion
            attempted but not committed.

T2-EXT01-C (negative case):
  Same as A, plus explicit verification that the new-turn reset
  is visible ONLY in the new-turn record, not in the terminal
  record (stateVersion + capturedAt preserved).
```

T2-EXT01-A is the load-bearing production-order test. The test
would FAIL if any of the following production reorderings were
introduced:

```text
- Move postStateToWebview before translateSessionEvent
- Move clearTurnOutcome after postStateToWebview
  (the catastrophic failure: terminal record would silently
   show false/false at the terminal push, the failure mode
   this test exists to detect)
```

Verdict reclassification
-------------------------

Before T2 (the round-1 reviewer's verdict):

```text
CANONICAL_VALUE_BINDING        PROVEN
ABSENT_VS_FALSE                PROVEN
PTAD_RING_IMMUTABILITY         PROVEN
JSONL_CONSERVATION             PROVEN
CAPTURE_BEFORE_RESET_IF_DRIVEN SYNTHETIC_REAL
PRODUCTION_CAPTURE_ORDER       NOT_PROVEN
```

After T2:

```text
CANONICAL_VALUE_BINDING        PROVEN
ABSENT_VS_FALSE                PROVEN
PTAD_RING_IMMUTABILITY         PROVEN
JSONL_CONSERVATION             PROVEN
CAPTURE_BEFORE_RESET_IF_DRIVEN PROVEN_REAL_PRODUCTION_SEAM
PRODUCTION_CAPTURE_ORDER       PROVEN
```

The supported claim is now strictly stronger than the v1 wiring
claim AND the v1-T1 synthetic-temporal claim. Production is shown
to call setTerminalResponseCommittedThisTurn BEFORE postStateToWebview
fires for the terminal push (so the terminal record sees true/true)
AND call clearTurnOutcome BEFORE postStateToWebview fires for the
new-turn boundary (so the new-turn record sees false/false).

The chain is exercised end-to-end via real production classes.

## 8. Stop conditions (field-level halt, not whole-ACT halt)

```text
HALT_DIAGNOSTIC_REQUIRES_NEW_RUNTIME_STATE
  If adding the field requires plumbing through ArbiterSnapshot,
  shadow recorder, or a new wire field → defer the field,
  continue with the 2-field V1.

HALT_DIAGNOSTIC_MUTATES_MESSAGE_TRANSLATOR_SEMANTICS
  If the implementation calls setAttemptCompletionSeen() or
  setTerminalResponseCommittedThisTurn() → revert and retry
  with read-only accessors only.

HALT_PUBLIC_WIRE_DELTA_REQUIRED
  If the field must enter ExtensionState or WebviewMessage to be
  captured → defer the field.

HALT_PTAD_DISABLED_STATE_DELTA
  If the field is captured even when PTAD is disabled (i.e. not
  gated by isPostTerminalAuthorityDiagnosticEnabled) → revert.

HALT_TEST_CANNOT_BIND_REAL_AUTHORITY
  If S1-EXT01 fails (the value does not come from real
  MessageTranslatorState) → revert.
```

Only a defect affecting the two mandatory fields blocks the ACT.
A halt on any of the deferred fields (`doneReason`,
`completionPolicyRequireCompletionTool`) defers that field and
the ACT continues with V1.

## 9. Acceptance criteria

```text
PRODUCTION_SOURCE_DELTA     = YES (only the three files in §5)
STATE_SEMANTIC_DELTA_OFF    = ZERO (verified by §7.1 B1-EXT01)
PUBLIC_PROTOCOL_DELTA       = ZERO (verified by §7.4 W1-EXT01
                                       source assertion: no wire field)
HALT_DIAGNOSTIC_MUTATES_*   = NOT_TRIGGERED (verified by §7.4 W2-EXT01
                                              and §7.2 S1-EXT01)
HALT_TEST_CANNOT_BIND_*     = NOT_TRIGGERED (verified by §7.2 S1-EXT01,
                                              §7.5 T1-EXT01,
                                              §7.6 T2-EXT01)
TEMPORAL_CAPTURE_ORDER      = PROVEN (verified by §7.6 T2-EXT01-A/B/C
                                        via real production seam)
CAPTURE_BEFORE_RESET_IF_DRIVEN = PROVEN_REAL_PRODUCTION_SEAM
                                    (verified by §7.6 T2-EXT01-A)
DEFAULT_OFF                 = REQUIRED (PTAD toggle already required)

EXIT:
  PASS_COMPLETION_PTAD_CAPTURE_V1
    = FUTURE_BOUND_SPECIMEN_CAN_BE_CAUSALLY_CLASSIFIED = YES

This does NOT mean the completion bug is proven or fixed.
It means only that a future specimen can be classified into
{attempt=false/committed=false, attempt=true/committed=false,
 committed=true} from a single PTAD dump, AND the values in
 the dump were sampled at the production lifecycle moment
 that produces them (i.e. they reflect what the runtime
 actually saw, in the order production chose to expose them).

NEXT:
  Wait for a bound specimen; bind via the §6 runbook;
  classify; then return to ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01
  (the next product ACT).
```

### 9.1 Verdict transition (reviewer P1 bounded correction applied)

This ACT was initially closed at commit `9c10ae273` with the
narrower verdict:

```text
PASS_STRUCTURAL_PTAD_DISCRIMINATOR_WIRING
TEMPORAL_CAPTURE_QUALIFICATION = OPEN
```

The reviewer (Factory, session 2026-08-27) accepted the value-
plumbing proofs but required one bounded temporal-capture test:

> "Right now you have proven value plumbing, but not yet
> temporal capture correctness. ... the implementation still
> compiles, all 60 tests still pass, and a real terminal
> specimen would misleadingly capture `(false, false)` even
> though both had been true moments earlier."

The T1-EXT01 set (§7.5) was added in commit `081ae974a`. With
that commit:

```text
PASS_COMPLETION_PTAD_CAPTURE_V1
  = FUTURE_BOUND_SPECIMEN_CAN_BE_CAUSALLY_CLASSIFIED = YES

Reasoning:
  T1-EXT01-A proves the snapshot records the canonical
    (true, true) seen by MessageTranslatorState, AND that
    the record remains immutable across a subsequent
    clearTurnOutcome().
  T1-EXT01-B proves the (true, false) branch is preserved.
  T1-EXT01-C pins the consequence of getting the capture
    ordering wrong (false/false recorded when true/true had
    been set then reset), so a future regression is detected
    as a different shape rather than silently misclassifying.

The supported claim is now strictly stronger than the v1
wiring claim: not only does the builder read the right object,
but the ring buffer preserves the value that was current at
the moment of capture, even when subsequent lifecycle events
clear the source-of-truth.
```

### 9.2 Verdict transition (reviewer P1 round 2 bounded correction applied)

After §9.1 closed the ACT at `e01df0469` with
`PASS_COMPLETION_PTAD_CAPTURE_V1`, the reviewer (Factory, session
2026-08-27, round 2) issued a P1 correction:

> "T1-EXT01-A/B/C are worthwhile. Their correct purpose is: ...
> rename the headline ... toward `snapshot preserves whichever
> translator state exists at capture time` until actual production
> ordering is established."

> "Do not modify the implementation yet. First add one test that lets
> **production choose the ordering**."

The reviewer correctly identified that T1 manually orchestrated the
ordering (test calls `setAttemptCompletionSeen` /
`setTerminalResponseCommittedThisTurn` / `clearTurnOutcome`
directly). That proves "if capture happens before reset, the
snapshot is correct," but it does NOT prove that the production
codebase actually orders things that way.

The T2-EXT01 set (§7.6) was added in commit `e55240372`. With that
commit, the supported claim is now strictly stronger than §9.1:

```text
T1-EXT01-A: PROVES that a snapshot taken before clearTurnOutcome()
             survives the reset (a necessity witness for the
             correct ordering).

T1-EXT01-B: PROVES the (true, false) branch survives the reset.

T1-EXT01-C: PROVES that a snapshot taken AFTER reset records
             (false, false) — pins the catastrophic failure
             shape so a future regression is detected as a
             different shape.

T2-EXT01-A: PROVES that the production SdkSessionEventCoordinator
             calls translateSessionEvent (which sets
             setTerminalResponseCommittedThisTurn) BEFORE
             postStateToWebview fires — so the terminal-push
             record sees (true, true).

T2-EXT01-B: PROVES that the (true, false) branch is correctly
             captured when content_end does not arrive before
             done (the "completion attempted, authority lost"
             branch).

T2-EXT01-C: PROVES that the new-turn boundary reset (clearTurnOutcome
             called inside the coordinator) is visible in the
             new-turn record but not in the terminal record
             (immutability across the reset boundary).

T2 together with T1 = the discriminator is qualified against
real production ordering, not just synthetic chronology.

EXIT (current):
  PASS_COMPLETION_PTAD_CAPTURE_V1
    = FUTURE_BOUND_SPECIMEN_CAN_BE_CAUSALLY_CLASSIFIED = YES

The supported claim is now:
  1. (from §7.1-7.4) The values come from the canonical
     MessageTranslatorState authority via a Pick<> structural type
     that forbids mutation.
  2. (from §7.5 T1) The snapshot preserves whatever value was
     current at capture time, even when subsequent lifecycle
     events clear the source.
  3. (from §7.6 T2) Production code calls
     setTerminalResponseCommittedThisTurn BEFORE postStateToWebview
     fires for the terminal push (so the terminal record sees
     the canonical (true, true)) AND calls clearTurnOutcome BEFORE
     postStateToWebview fires for the new-turn boundary (so the
     new-turn record sees (false, false)).

Together (1+2+3): the discriminator is production-qualified
across the entire lifecycle.
```

## 10. Files touched

```text
Production code (3 files):
  apps/vscode/src/shared/post-terminal-authority-diagnostic.ts
  apps/vscode/src/sdk/post-terminal-authority-diagnostic-builder.ts
  apps/vscode/src/sdk/SdkController.ts

Tests (4 files):
  apps/vscode/src/sdk/__tests__/post-terminal-authority-diagnostic-builder.test.ts
    (B1-B4 EXT01, S1 EXT01, J1 EXT01, T1 EXT01-A/B/C)
  apps/vscode/src/sdk/__tests__/post-terminal-authority-diagnostic-wiring.test.ts
    (W1-W3 EXT01)
  apps/vscode/src/shared/post-terminal-authority-diagnostic.test.ts
    (J1-EXT01 JSONL round-trip)
  apps/vscode/src/sdk/sdk-session-event-coordinator.test.ts
    (T2 EXT01-A/B/C — production-lifecycle capture-order proof)

Docs (3 files):
  docs/architecture/elm/completion-protocol-ptad-extension01-evidence.md
    (this file)
  .factory/acts/ACT-CLINEMM-COMPLETION-PTAD-EXTEND01.md  (deferred — promoted
    at full closure; see git history)
  .factory/epics/runtime-task-progression.md  (ledger entry)
```

## 11. References

- Recon: `docs/architecture/elm/completion-protocol-capture-surface-recon01-evidence.md` (`1175bb4db`)
- Qualification: `docs/architecture/elm/completion-protocol-capture-surface-qualification01-evidence.md` (`841bad562`)
- Discriminator: `docs/architecture/elm/completion-framing-live-red-discriminator01.md`
- Phase-0 capture: `docs/architecture/elm/completion-protocol-liveness02-phase0-capture01.md` (`f9186dfcd`)
- Substrate: `apps/vscode/src/shared/post-terminal-authority-diagnostic.ts`
- Runtime: `apps/vscode/src/sdk/post-terminal-authority-diagnostic-runtime.ts`
- Builder: `apps/vscode/src/sdk/post-terminal-authority-diagnostic-builder.ts`
- Capture site: `apps/vscode/src/sdk/SdkController.ts:3583-3594`
- Authority: `apps/vscode/src/sdk/message-translator.ts:343-385`
    recordPostTerminalAuthoritySnapshot(
        buildExtensionSnapshotFromState({
            state: { /* unchanged */ },
            shadow: this.getLocalShadowProjection(),
            // ACT-CLINEMM-COMPLETION-PTAD-EXTEND01:
            // Pull the canonical turn-outcome booleans from the
            // same translator state that gates the canonical
            // `done` seam. Read-only via public accessors; no
            // new state plumbing, no new wiring.
            messageTranslatorState: this.messageTranslatorState,
        }),
    )
}
```

When `ptadEnabled === false`, this entire `if` block is bypassed
(it is gated by `isPostTerminalAuthorityDiagnosticEnabled`), so
`STATE_SEMANTIC_DELTA_OFF = ZERO` holds.
 *
 * See `attemptCompletionSeen` for absent vs false semantics.
 */
readonly terminalResponseCommittedThisTurn?: boolean
```

Both fields are `readonly` and `optional`. They live ONLY in the
PTAD ring buffer; they never enter the wire payload.

```text
PRODUCTION_SOURCE_DELTA     = YES (one diagnostic module touched)
STATE_SEMANTIC_DELTA_OFF    = ZERO (no behavior change when disabled)
PUBLIC_PROTOCOL_DELTA       = ZERO (no new wire field)
DEFAULT_OFF                 = REQUIRED
TEMPORARY_DIAGNOSTIC        = YES
EXISTING_DIAGNOSTIC_SUBSTRATE = SUITABLE_FOR_BOUNDED_EXTENSION
```

This phrasing is deliberate. PTAD is being qualified for a **new
causal purpose**, not redeclared production-ready. The substrate
is suitable; the application is bounded.
