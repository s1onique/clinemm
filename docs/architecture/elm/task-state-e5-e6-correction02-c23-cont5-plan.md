# C2.3-CONT.5 plan — stale activity, synthetic C04, awaiting follow-up qualification

```
ACT =
ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.3-CONT.5

ENTRY_HEAD = 7a20e0a03 (CONT.4-CORRECTION01 evidence + wording addendum)
EXIT_HEAD  = <this commit's tip>

PROTECTED_STASHES = 141372c52 (FORENSIC), 371752f71 (CONTEXT)

CONT_5_AUTHORIZED = true (per CONT.4-CORRECTION01 evidence)
EXPECTED_PRODUCTION_SEMANTIC_DELTA = 0  (qualification ACT)
```

## 1. Mission

CONT.5 is the qualification ACT for the post-terminal / post-cancel /
reconstructed-authority / awaiting-followup invariants that the
stateful workload matrix pinned conceptually but did not exercise on
the canonical Local path. CONT.4-CORRECTION01 already authorized
CONT.5. This ACT must:

1. Pin W13, W14, W15, W16 on the canonical Local path (the same
   harness used for CONT.4 / C9.x), each with hard gates.
2. Verify production semantic delta remains 0 — no reducer,
   comparator, coordinator, recorder, SdkController, emit*, proto,
   harness, or public-API change.
3. Re-run the gate-defect necessity probe to prove the four
   witnesses' assertions are not merely correlated with green tests.

## 2. W13 — stale activity after completion

### 2.1 Trace

```
task_requested(task-W13)
canonical run-started(snapIdle)
canonical execEvent(idle->streaming)
  shadowPhase = streaming; legacyPhase = streaming;
  model_stream_started TaskMsg produced
canonical execEvent(streaming->tooling)
  shadowPhase = streaming; tooling=true; activeToolCallIds=[tc1]
canonical tool-started(snapTooling, "tc1")
canonical execEvent(tooling->idle)
  shadowPhase = streaming (legacy); shadow modelStream=false
  model_stream_finished TaskMsg produced; tooling=false (tool-finished
  not yet observed but tooling clears on no pendingToolCalls)
canonical run-finished(snapIdleAgain)  status="completed"
  shadowPhase = completed; legacyPhase = completed (set-legacy-phase)
  task_completed observation; lifecycle=completed

// LATE ACTIVITY (must NOT reactivate):
canonical execEvent(idle->streaming)
  -> shadow adapter emits model_stream_started TaskMsg
  -> reducer IGNORED_STALE (lifecycle=completed)
  -> shadow lifecycle stays "completed"
canonical tool-started(snapIdle, "tc-late")
  -> shadow adapter would emit tool_started TaskMsg
  -> reducer IGNORED_STALE (lifecycle=completed)
  -> activeToolCallIds stays []
canonical execEvent(streaming->awaitingApproval)
  -> shadow adapter emits approval_requested TaskMsg
  -> reducer IGNORED_STALE (lifecycle=completed)
  -> awaitingApproval stays false
```

### 2.2 Hard gates

```
lifecycle.kind              === "completed"
activity.modelStreaming     === false
activity.activeToolCallIds  === []
activity.awaitingApproval   === false
D10_UNKNOWN                 === 0
invariantViolations         === 0
observerErrors              === 0
evidenceGaps                === 0
fallbackReconstructedApplied === 0

records with event "task_completed"            === 1
records with event "model_stream_started" (late) === 0 from APPLY
records with event "tool_started" (late)        === 0 from APPLY
records with event "approval_requested" (late) === 0 from APPLY
```

### 2.3 What this proves

The reducer's I01 ("terminal_no_activity") and I02 ("active_not_idle")
invariants are enforced at the canonical observation boundary under
real canonical events, not just at the unit level. A late
`execution-state-changed` that flips `modelStreaming=false->true`
after a completed run cannot revive the lifecycle.

## 3. W14 — stale activity after cancellation / resumable

### 3.1 Trace

```
task_requested(task-W14)
canonical run-started(snapIdle)
canonical execEvent(idle->streaming)
host-task cancelled
  lifecycle=cancelled; projectTurnState(cancelled)=resumable
  shadowPhase = resumable; legacyPhase = streaming (still)

canonical tool-started(snapStreaming, "tc1")
  -> reducer: tool_started on lifecycle=cancelled IGNORED_STALE
  -> activeToolCallIds stays []
canonical execEvent(streaming->awaitingApproval)
  -> shadow adapter emits approval_requested
  -> reducer IGNORED_STALE (cancelled)
  -> awaitingApproval stays false
canonical execEvent(awaitingApproval->idle)
  -> approval_resolved TaskMsg produced
  -> reducer IGNORED_STALE
```

### 3.2 Hard gates

```
lifecycle.kind              === "cancelled"
activity.modelStreaming     === false
activity.activeToolCallIds  === []
activity.awaitingApproval   === false
D10_UNKNOWN                 === 0
invariantViolations         === 0
observerErrors              === 0
evidenceGaps                === 0
fallbackReconstructedApplied === 0

records with event "task_cancelled" === 1
```

### 3.3 What this proves

A late tool-started / approval_requested / model-stream event after
host-cancellation cannot resurrect the lifecycle. The only way to
leave `cancelled` is the deliberate `same_task_continued` (CONT.3 /
CONT.4 path), not random late activity.

## 4. W15 — synthetic C04 under Option A

### 4.1 Background (per CONT.0-CORRECTION01)

The legacy C04 bug shape was a reconstructed event that mutated the
shadow model. CONT.0-CORRECTION01 closed that bug by changing the
authority resolver so that under LocalRuntimeHost
(`canonicalAvailable === true`), reconstructed events are
**DIAGNOSTIC_ONLY** and never mutate the shadow.

### 4.2 Trace

```
task_requested(task-W15)
canonical run-started(snapIdle)       (sets activeRunId = run-W15)
canonical execEvent(idle->streaming)  (model_stream_started)
canonical run-finished(snapStreaming) (status="completed"; task_completed APPLY)
  -> shadow lifecycle = completed

// RECONSTRUCTED LEGACY ENVELOPE arrives after completion.
// Under Option A (LocalRuntimeHost, canonicalAvailable=true),
// reconstructed events are DIAGNOSTIC_ONLY.
legacy: agentEvent(done)               (arrives AFTER canonical completion)
  -> reverse-translator produces a run-finished reconstructed event
  -> coordinator.observe({ kind: "runtime-reconstructed", ... })
  -> authority resolver: canonicalAvailable=true
  -> DIAGNOSTIC_ONLY
  -> shadow.lifecycle stays "completed"

// Another reconstructed event: an out-of-order legacy agentEvent
// arrives with run-started for a NEW conversationId
// (simulating a stale reconstructed envelope after a fresh reset).
// This must also be DIAGNOSTIC_ONLY.
legacy: agentEvent(iterationStart conversationId="c-late")
  -> reverse-translator produces run-started(reconstructed)
  -> coordinator.observe DIAGNOSTIC_ONLY (canonicalAvailable=true)
  -> shadow.lifecycle stays "completed"
  -> activeRunId stays "run-W15" (canonicalRunIdRef untouched)
```

### 4.3 Hard gates

```
counts.observationsDiagnosticByOrigin.RUNTIME_RECONSTRUCTED === 2
counts.observationsSuppressedByOrigin.RUNTIME_RECONSTRUCTED === 0
counts.fallbackReconstructedApplied                          === 0
lifecycle.kind                                              === "completed"
D10_UNKNOWN                                                 === 0
invariantViolations                                         === 0
observerErrors                                              === 0
evidenceGaps                                                === 0

C04_SYNTHETIC_CANONICAL_AUTHORITY = PASS
C04_REAL_CAPTURE                  = NOT_YET   (belongs to C2.5)
```

### 4.4 What this proves

The C04 bug shape (reconstructed event mutating shadow) is closed
at the authority resolver. The synthetic reconstructed events do
not flip the shadow lifecycle, do not increment
`fallbackReconstructedApplied`, and increment the diagnostic
counter instead.

## 5. W16 — awaiting follow-up

### 5.1 Background

`awaiting_followup` is a host-only phase. The runtime cannot
generate it; only the legacy `TurnStateTracker` can read it into the
comparator's view. The D08_FOLLOWUP_EXTERNAL divergence class is
the only path the comparator classifies when `awaiting_followup`
appears on either side.

The reviewer's spec requires proving that **no reconstructed Local
runtime observation becomes authoritative merely because the host
state says follow-up is pending**.

### 5.2 Trace

```
task_requested(task-W16)
canonical run-started(snapIdle)
canonical execEvent(idle->streaming)
canonical execEvent(streaming->idle)
canonical run-finished(snapIdle)
  task_completed APPLY
  lifecycle = completed

// Host (legacy TurnStateTracker) flips to awaiting_followup after
// the user submits a follow-up question while the task is in its
// terminal state.
set-legacy-phase: awaiting_followup

// RUNTIME_RECONSTRUCTED envelope arrives.
legacy: agentEvent(content_start "text" "follow-up question?")
  -> reverse-translator: text-delta (or empty for the legacy envelope)
  -> coordinator.observe RUNTIME_RECONSTRUCTED
  -> under LocalRuntimeHost: DIAGNOSTIC_ONLY
  -> shadow.lifecycle stays "completed"

// Another reconstructed envelope.
legacy: agentEvent(done reason="completed")
  -> reverse-translator produces run-finished reconstructed
  -> DIAGNOSTIC_ONLY (canonicalAvailable=true)
  -> no shadow mutation
```

### 5.3 Hard gates

```
counts.observationsDiagnosticByOrigin.RUNTIME_RECONSTRUCTED >= 2
counts.observationsSuppressedByOrigin.RUNTIME_RECONSTRUCTED === 0
counts.fallbackReconstructedApplied                          === 0

Any D08_FOLLOWUP_EXTERNAL record (if any) MUST be from HOST_TASK origin
  (not from RUNTIME_RECONSTRUCTED)

lifecycle.kind === "completed"
D10_UNKNOWN    === 0
invariantViolations === 0
observerErrors      === 0
evidenceGaps        === 0

D08_FOLLOWUP_EXTERNAL_ORIGIN_GUARD = PASS
```

### 5.4 What this proves

The host's `awaiting_followup` projection cannot be flipped or
overridden by a reconstructed runtime observation. Any D08
divergence is sourced from host ingress, not from
runtime-reconstructed.

## 6. Commit decomposition

```
CONT5-C1  docs(elm): CONT.5 plan (this file)
CONT5-C2  test(elm): W13 stale activity after completion
CONT5-C3  test(elm): W14 stale activity after cancellation/resumable
CONT5-C4  test(elm): W15 synthetic C04 under Option A
CONT5-C5  test(elm): W16 awaiting follow-up
CONT5-C6  docs(elm): CONT.5 evidence + final board
```

Each commit is independent; if any W13–W16 fails, the ACT halts at
that point per H1 below.

## 7. Halt conditions

```
H1  W13, W14, W15, or W16 fails its hard gate   = HALT
H2  Production semantic delta > 0               = HALT
    (any reducer, comparator, coordinator,
    recorder, SdkController, emit*, proto,
    harness, or public-API change)
H3  Protected stashes change                     = HALT
H4  Typecheck regressions                        = HALT
H5  C9.x regression                             = HALT (CONT.4 fix
    still in force)
H6  W11/W12.x regression                        = HALT
H7  Fixture weakens after observing failure     = HALT
H8  Test counts increase without a corresponding
    commit decomposition note                   = HALT (scope creep)
H9  Stale C2.0 baseline tests change             = HALT (out of scope
    for CONT.5)
```

## 8. Gate-defect necessity probe

After all four W13–W16 tests pass, run an uncommitted mutation that
disables the corresponding invariant (e.g. for W13, replace
`IGNORED_STALE` for completed lifecycle with `VALID`; for W15, flip
the `canonicalAvailable` branch to `FALLBACK_APPLY`). Each probe
must show:

```
W13 FAIL  (lifecycle would resurrect)
W14 FAIL  (lifecycle would resurrect)
W15 FAIL  (fallbackReconstructedApplied would increment)
W16 FAIL  (or D08 would be from RUNTIME_RECONSTRUCTED origin)
```

Restore. All PASS. Probe must NOT leave a production commit with a
weakened invariant.

## 9. Exit gate

```
W13 PASS
W14 PASS
W15 PASS
W16 PASS

D10_UNKNOWN          = 0
invariantViolations  = 0
observerErrors       = 0
evidenceGaps         = 0
fallbackReconstructedApplied = 0

NEW_TS_ERRORS        = 0
git diff --check     = PASS
PROTECTED STASHES    = intact
production files touched = NONE (qualification ACT)
```

then:

```
VERDICT = PASS_STATEFUL_WORKLOAD_QUALIFICATION_C2_3_CONT_5

CONT_6_AUTHORIZED = true
C2_4_AUTHORIZED   = false
E7_AUTHORIZED     = false

NEXT = ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-
       CORRECTION02-C2.3-CONT.6-W06-REPLAY-BOUNDED-3X-WITNESS
```
