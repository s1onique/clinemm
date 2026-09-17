# Source seam trace — ACT-CLINEMM-RUNTIME-TASK-HEADER-PROJECTION-COHERENCE-REPAIR01

> Purpose: mechanically identify the FIRST production boundary that
> permits one `ExtensionState` publication to carry both
> `turnState.phase = "streaming"` and
> `taskHeaderPresentation.phase = "idle"`.

## 1. The publication seam (load-bearing)

`apps/vscode/src/sdk/SdkController.ts:3718` — `getStateToPostToWebview()`.
Within that method, the two fields are emitted back-to-back inside the
same `state` object (so they share the same publication identity):

```text
  state = {
    ...,
    turnState: this.turnStateTracker.get(),                           // L3882
    taskTelemetry: this.taskTelemetry.get(),                         // L3909
    thinkingPresentation: selectThinkingPresentation({...}),         // L3962
    taskHeaderPresentation: selectTaskHeaderPresentation({...}),     // L3996
    ...,
  }
```

So both `turnState.phase` and `taskHeaderPresentation.phase` are
derived at the same instant, from the same in-process state. The
contradiction therefore cannot come from "two different times" — it
must come from **two different authorities** disagreeing on the same
instant.

## 2. Authority A: `turnState.phase` (the webview button / composer authority)

Path: `apps/vscode/src/sdk/turn-state-tracker.ts` → `TurnStateTracker`.
Backed by a `MessageIdMinter` so each `set()` advances `seq`.

Key properties:

- `phase` is the LIVE phase the backend knows about.
- `seq` monotonically advances on every `set()`.
- Every transition is **explicit**: production code calls
  `turnStateTracker.set(phase, anchorTs, writerId)`. The
  `SdkTaskControlCoordinator.showTaskWithId()` derives the phase from
  the appended resume-ask (the upstream precedent for the
  "task-control is authoritative" property).
- The webview's button set / composer lockout / follow-up routing
  consume `turnState.phase` directly. This is the **authoritative UI
  phase** per the upstream precedent quoted in the ACT body
  (`sdk-task-control-coordinator.ts:280-291`).

## 3. Authority B: `taskHeaderPresentation.phase` (the TaskHeader label authority)

Composed by `selectTaskHeaderPresentation()` in
`apps/vscode/src/sdk/task-state-shadow-arbiter-mapper.ts:435-474`.
The selector's frozen three-source precedence is:

```text
  1. if currentLegacyPhase === "compacting"        → phase="compacting", source="host"
  2. if currentLegacyPhase === "awaiting_followup" → phase="awaiting_followup", source="host"
  3. if canonicalShadowPhase !== undefined         → phase=canonicalShadowPhase, source="shadow"
  4. else                                          → phase=currentLegacyPhase, source="legacy"
```

Inputs are sampled at the call site (SdkController.ts:3996):

```text
  canonicalShadowPhase: this.getLocalShadowPhase()         // taskStateShadowWiring?.getLastObservedShadowPhase()
  currentLegacyPhase:   this.turnStateTracker.currentPhase
  seq:                  this.turnStateTracker.get().seq
```

`getLocalShadowPhase()` is the LAST `turnPhase` projection the
canonical `@cline/agents` `TaskStateShadow` observed. The shadow
advances only when a runtime event lands in `observeRuntimeEvent()`
(producer-side, async). The legacy tracker advances synchronously on
every `set()`. **The two carry unrelated sequences.**

## 4. The DEFECT — exact source-tree walk

```text
  T₀: turnState.phase = "idle",     canonicalShadowPhase = "idle"
       (no events yet; both authorities agree; coherent)

  T₁: A runtime event lands. The shadow observes it.
       canonicalShadowPhase becomes "streaming".
       turnState.phase ALSO advances to "streaming" via setTurnPhase().
       Both authorities agree. → coherent publication.

  T₂: turnState.phase remains "streaming" (no explicit
       transition yet — e.g. assistant text streaming in progress).
       canonicalShadowPhase also remains "streaming".

  T₃: NO further runtime events. Both authorities stay
       "streaming". → coherent publication.

  T₄: User / scheduler / a tool-result transitions the task to
       a different lifecycle state. turnState.phase advances
       to "completed" / "error" / "resumable" via setTurnPhase().
       BUT: the shadow does NOT receive a corresponding
       `observeRuntimeEvent` because the shadow only listens to
       the canonical transport and the lifecycle event comes
       from the host (not the runtime). canonicalShadowPhase
       stays at the LAST shadow-observed value, which can be
       "idle" (from T₀) or "streaming" (from T₁).

  T₅: Next publication lands. The selector's branch-3 fires:

         canonicalShadowPhase !== undefined && !== "compacting" && !== "awaiting_followup"
            → returns { phase: canonicalShadowPhase, source: "shadow" }

       If canonicalShadowPhase === "idle" (stale, from T₀), the
       publication carries:

           turnState.phase              = "completed"   (real)
           taskHeaderPresentation.phase = "idle"        (stale shadow)

       If canonicalShadowPhase === "streaming" (from T₁) but
       turnState.phase is "completed" (set at T₄), the
       publication carries:

           turnState.phase              = "completed"   (real)
           taskHeaderPresentation.phase = "streaming"   (stale shadow)

       And the reverse direction also occurs:
       turnState.phase="streaming" (real) +
       taskHeaderPresentation.phase="idle" (stale shadow).

  That is exactly the captured LIVE contradiction at
  publicationId 15 and 17 of taskId 1788189447617_rw5zx.
```

## 5. Source-recon questions (from ACT body §1)

- **A.** `turnState.phase` is stored at
  `apps/vscode/src/sdk/turn-state-tracker.ts:23` and mutated by
  `set()` / `setWithWriter()` (line 70/95).
- **B.** `taskHeaderPresentation.phase` is *derived* per
  publication by `selectTaskHeaderPresentation()`
  (`task-state-shadow-arbiter-mapper.ts:435-474`). It is not
  "stored" anywhere — it is recomputed on every
  `getStateToPostToWebview()` call.
- **C.** The task-header mapper does NOT consume `TurnState`
  directly. It consumes `currentLegacyPhase` (just the phase
  string, no seq) and `canonicalShadowPhase` (just the phase
  string, no seq). The mapper has no access to either authority's
  generation/seq.
- **D.** Authority B (the task-header mapper) consumes the canonical
  shadow phase (`getLocalShadowPhase()` →
  `taskStateShadowWiring.getLastObservedShadowPhase()` →
  `TaskState.projectTurnState(model).turnPhase`) and the legacy
  phase (`turnStateTracker.currentPhase`).
- **E.** **YES — TurnState and task-header projection are updated
  INDEPENDENTLY.** TurnState advances on every explicit
  `setTurnPhase()` call (synchronous, host-driven). The canonical
  shadow advances on every runtime event the shadow wiring
  observes (asynchronous, runtime-driven, can lag the legacy
  tracker by an unbounded number of events).
- **F.** TurnState carries a generation (`seq` from
  `MessageIdMinter`). The canonical shadow carries
  `lastObservedShadowSeq` internally — but the mapper
  `selectTaskHeaderPresentation` **does not consult** that seq;
  it only reads the phase string. The projection stamped into the
  publication uses the **legacy** `TurnStateTracker.seq` — so the
  webview's stale-push fence can detect cross-epoch staleness but
  NOT cross-authority skew on the same epoch.
- **G.** **YES — the snapshot builder is combining current
  TurnState (real, seq N) + stale shadow projection (from a
  prior-generation event) at the same publication.**
- **H.** There is NO explicit contract permitting the lag; there
  is also NO contract prohibiting it. The selector's branch-3
  treats the shadow as authoritative whenever it is defined, with
  no staleness check, no generation comparison, no last-observed
  timestamp comparison.
- **I.** **The first function that has enough information to
  prevent the contradiction is
  `selectTaskHeaderPresentation()`** at
  `task-state-shadow-arbiter-mapper.ts:435-474`. The caller
  (`SdkController.getStateToPostToWebview()`, line 3996) already
  has both `currentLegacyPhase` and `canonicalShadowPhase` and
  `seq` in scope; adding a shadow-side seq (or a "shadow
  observed since legacy advanced" comparison) is one extra
  parameter at the call site and one extra branch in the
  selector.

## 6. Causal classification (preview — locked at Phase 4)

**CASE_D — INDEPENDENT AUTHORITY GENERATION SKEW.**

TurnState (`turnStateTracker`) and task-header projection (the
shadow consumed by `selectTaskHeaderPresentation`) are each
individually valid but carry unrelated generation/sequence
identifiers. They are composed at publication time without any
coherence enforcement (no generation comparison, no
shadow-staleness threshold, no "shadow must be newer than the
legacy transition that overtook it" rule).

Both `selectTaskHeaderPresentation` and its sibling
`selectThinkingPresentation` are affected.

## 7. RED plan

A new test in
`apps/vscode/src/sdk/__tests__/task-state-shadow-task-header-presentation.thcp01.test.ts`
(naming: `THCP11`):

1. Set `currentLegacyPhase = "streaming"`,
   `canonicalShadowPhase = "idle"`, `seq = 5` (the
   contradiction).
2. Assert the projection's `phase` MUST NOT be `"idle"`.

A parallel test for `selectThinkingPresentation` confirms
that the `source` field reflects the skew (the `modelStreaming`
field there is just `currentLegacyPhase === "streaming"` in the
legacy branch, so the same contradiction is not directly
possible for that projection; but the `source` should reflect
the skew when the shadow is stale).

## 8. Repair plan (preview — locked at Phase 6)

Add **one** input parameter to both selectors — the shadow's
last-observation sequence (or the legacy phase's sequence at the
moment the shadow was last advanced; whichever is simpler to
expose). When the shadow is older than the most-recent legacy
transition, the legacy phase wins. This preserves the
"canonical shadow is authoritative when fresh" property while
forbidding the "stale shadow overrides fresh legacy transition"
behaviour that is producing the LIVE contradiction.
