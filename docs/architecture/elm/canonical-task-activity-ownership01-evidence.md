# ACT-CLINEMM-CANONICAL-TASK-ACTIVITY-OWNERSHIP01 — HALTED / REJECTED REPAIR

> **DISPOSITION**: `HALT_TASK_LIFETIME_NOT_ACTIVITY_AUTHORITY`. Production-side revert completed; this document is preserved as the historical record of the rejected attempt. **Do NOT treat as spec**.
>
> **Useful recon preserved for the successor ACT** (`ACT-CLINEMM-TASK-INTERACTION-OWNERSHIP-PROJECTION01`): the LIVE symptom, the granularity analysis, the `hostInteraction.awaitingFollowup` reserved-but-unwired selector signature, the `ActiveSession.lastInteractiveTurnFinishReason` field, and the CLTC01 P0 reviewer-rejected precedent for the same abstraction mistake. See the board row for the full disposition narrative.


---

## Everything below this point is historical record of the rejected attempt

> **Not current architecture. Not desired behavior.**
>
> The body of this document records the rejected `isTaskActive() → awaiting_followup` repair in detail so the next ACT does not repeat the same conceptual mistake. Do **not** lift any of the rejected production shapes (the `isTaskActive()` accessor, the `task-ownership` provenance kind, the `taskIsActive → awaiting_followup` rule, the `selectTaskHeaderPresentation` rule 0) into new code. The successor ACT `ACT-CLINEMM-TASK-INTERACTION-OWNERSHIP-PROJECTION01` starts from a clean HEAD and seeks the working-vs-waiting discriminator via host-interaction recon, not telemetry/message heuristics.

## Symptom (LIVE capture)

Fresh PTAD capture at taskId=1787361823207_6ta7a, epoch=3:

| stateVersion | toolCalls | runtimeStatus | shadowStatus | legacyPhase | taskHeaderPresentation.phase |
|--------------|-----------|---------------|--------------|-------------|------------------------------|
| 8552         | 186       | idle          | idle         | idle        | idle                         |
| 8825         | 187       | idle          | idle         | idle        | idle                         |
| 8860         | 188       | idle          | idle         | idle        | idle                         |
| 8865         | 189       | idle          | idle         | idle        | idle                         |
| 8892         | 190       | idle          | idle         | idle        | idle                         |
| 8895         | ?         | idle          | idle         | idle        | idle                         |

Throughout the capture window, the webview tail shows live `api_req_started`, `command partial`, `text partial`, `tool partial`, `tool complete`, `api_req_started`. The user-visible TaskHeader label rendered "Idle" / live:false.

## Classification

**CASE_T1_WRONG_GRANULARITY_SOURCE** — the three phase authorities at this instant agree correctly at their respective granularities, but NONE spans the entire visible task lifetime:

| Authority | Granularity | Goes idle between substeps? | Survives async activity? |
|-----------|-------------|----------------------------|--------------------------|
| `AgentRuntime.snapshot().status` | per-iteration | YES | NO |
| `LocalRuntimeHost.session.status` | per-user-turn | NO | YES (across iterations within a runTurn) |
| `turnStateTracker.currentPhase` | per-user-turn | NO | YES (mirrors `session.status`) |
| `taskTelemetry.currentTaskId` | per-task | NO | YES |
| `taskTelemetry.endedAt` | per-task-terminal-freeze | NO | YES |
| **`isTaskActive()` = `currentTaskId !== undefined && endedAt === undefined`** | **per-task-ownership** | **NO** | **YES** |

The LIVE capture landed in the gap where the legacy tracker is momentarily `idle` (after `markTurnIdle` has run for the previous turn's `completeInteractiveTurn`, before the next `pending_prompt_submitted` re-arms `streaming`). No existing authority spanned that gap.

## Root cause

The existing `TaskTelemetryTracker` (apps/vscode/src/sdk/task-telemetry-tracker.ts) IS the existing task-level anchor: `currentTaskId !== undefined && endedAt === undefined`. It survives every user-turn / agent-iteration boundary and freezes only on a terminal-phase owner transition. But no consumer was reading it as a phase authority — the TaskHeader projection only consulted `turnStateTracker.currentPhase` (per-user-turn) and the canonical shadow (per-agent-iteration).

## Repair (bounded)

Three production files + one interface widening:

1. **apps/vscode/src/sdk/task-telemetry-tracker.ts** — added `isTaskActive()` accessor.
2. **apps/vscode/src/sdk/task-state-shadow-arbiter-mapper.ts** — extended `selectTaskHeaderPresentation` with a new required input `taskIsActive: boolean` and added rule 0 (TASK-OWNERSHIP BRIDGE) before the existing four rules.
3. **apps/vscode/src/sdk/SdkController.ts** — plumbed `taskIsActive: this.taskTelemetry.isTaskActive()` through `getStateToPostToWebview()`.
4. **apps/vscode/src/shared/ExtensionMessage.ts** — widened `TaskHeaderPresentationProjection.source` enum from `"shadow" | "host" | "legacy"` to `"shadow" | "host" | "legacy" | "task-ownership"`.

### Rule 0 (TASK-OWNERSHIP BRIDGE)

```ts
if (
    input.taskIsActive === true &&
    input.currentLegacyPhase === "idle" &&
    (input.canonicalShadowPhase === undefined || input.canonicalShadowPhase === "idle")
) {
    return {
        phase: "awaiting_followup",
        source: "task-ownership",
        seq: input.seq,
    }
}
```

The narrow predicate is intentional:

- `taskIsActive === true` — the visible task is still anchored on the host.
- `currentLegacyPhase === "idle"` — the legacy tracker is in its momentary gap.
- `(canonicalShadowPhase === undefined || canonicalShadowPhase === "idle")` — no fresher shadow observation has authority.

Any shadow phase other than "idle" (e.g. "streaming" from a delayed event arriving through the canonical seam) MUST take precedence — the shadow is the more granular authority when it has fresh observation.

### Source provenance

`source: "task-ownership"` is a new host-owned provenance kind parallel to `"host"` / `"shadow"` / `"legacy"`. Consumers MAY use this for diagnostics but the user-visible label is `awaiting_followup` (the truthful "task is alive, user can respond" projection — the elapsed clock keeps ticking per the existing CORRECTION01 contract for awaiting_followup).

## Reproduction (RED)

Production chronology captured in `task-header-canonical-task-activity-ownership.cta01.test.ts`:

```
1. SdkController.initTask → taskTelemetry.startTask(B, persistedTs)
   → taskIsActive === true
2. sdk-session-event-coordinator.handleSessionEvent("pending_prompt_submitted")
   → setTurnPhase("streaming") → currentLegacyPhase === "streaming"
3. AgentRuntime emits turn_started → model_stream_started (N times)
4. AgentRuntime emits run_finished with finishReason="awaiting_followup"
5. sdk-session-event-coordinator.handleSessionEvent(turn-complete)
   → setTurnPhase("awaiting_followup") → currentLegacyPhase === "awaiting_followup"
   → taskTelemetry.observeTurnPhase("awaiting_followup") (no-op on endedAt)
6. ASYNC TAIL: LocalRuntimeHost.completeInteractiveTurn → markTurnIdle
   → setTurnPhase("idle") on the next state-post → currentLegacyPhase === "idle"
7. AT THIS INSTANT (the LIVE-T1 gap):
   - AgentRuntime.snapshot().status === "idle" (no active runtime instance)
   - canonicalShadow.status === "idle" (arbiter fallback)
   - currentLegacyPhase === "idle"  (markTurnIdle has run)
   - BUT taskTelemetry.currentTaskId === "B" AND endedAt === undefined
   - AND stateVersion is advancing (next post happens)
   - AND toolCalls is incrementing (recordToolStarted callback fires async)
   - AND the user has NOT explicitly cleared the task
```

CTA09 drives step 7's exact inputs and asserts the TaskHeader projection reports `awaiting_followup + task-ownership`. CTA11 pins the RED shape (without rule 0, the absence-fallback returns `idle + legacy`).

## RED → GREEN → Ablation

```
Rule 0 present:
  CTA01..CTA15 — 15 pass, 0 fail

Rule 0 commented out (NEED/ABLATION):
  CTA01, CTA02, CTA09 — 3 fail (exact predicted RED set)
  CTA03..CTA08, CTA10..CTA15 — 12 pass
```

The 3 RED tests are exactly the ones that depend on rule 0; the 12 GREEN tests are exactly the ones that don't. Ablation signature is clean.

## Witness matrix

| Test | Input | Output (rule 0 present) | Output (rule 0 absent) |
|------|-------|------------------------|------------------------|
| CTA01 | taskIsActive=true, legacy=idle, shadow=undefined | phase=awaiting_followup, source=task-ownership | phase=idle, source=legacy |
| CTA02 | taskIsActive=true, legacy=idle, shadow=idle | phase=awaiting_followup, source=task-ownership | phase=idle, source=legacy |
| CTA03 | taskIsActive=true, legacy=idle, shadow=streaming | phase=streaming, source=shadow | phase=streaming, source=shadow |
| CTA04 | taskIsActive=true, legacy=streaming | phase=streaming, source=legacy | phase=streaming, source=legacy |
| CTA05 | taskIsActive=true, legacy=compacting | phase=compacting, source=host | phase=compacting, source=host |
| CTA06 | taskIsActive=true, legacy=awaiting_followup | phase=awaiting_followup, source=host | phase=awaiting_followup, source=host |
| CTA07 | taskIsActive=false, legacy=idle | phase=idle, source=legacy | phase=idle, source=legacy |
| CTA08 | taskIsActive=false, legacy=compacting | phase=compacting, source=host | phase=compacting, source=host |
| CTA09 | LIVE-CASE_T1 reproduction | phase=awaiting_followup, source=task-ownership | phase=idle, source=legacy |
| CTA10 | endedAt stamped (taskIsActive=false), legacy=completed | phase=completed, source=legacy | phase=completed, source=legacy |
| CTA11 | taskIsActive=false (RED shape pinned) | phase=idle, source=legacy | phase=idle, source=legacy |
| CTA12 | positive control A (genuinely active) | phase=streaming, source=legacy | phase=streaming, source=legacy |
| CTA13 | positive control B (genuine follow-up) | phase=awaiting_followup, source=host | phase=awaiting_followup, source=host |
| CTA14 | positive control C (genuine terminal) | phase=completed, source=legacy | phase=completed, source=legacy |
| CTA15 | positive control D (genuine no-task) | phase=idle, source=legacy | phase=idle, source=legacy |

## Conservation

| ACT | Tests | Pre-ACT | Post-ACT | Delta |
|-----|-------|---------|----------|-------|
| THCP01..THCP10 (existing three-source precedence) | `task-state-shadow-task-header-presentation.thcp01.test.ts` | 11 PASS | 11 PASS | 0 |
| TCCC01-B1 awaiting_followup host-override | `task-completion-continuation-coherence.tccc01.test.ts` | 5 PASS | 5 PASS | 0 |
| CLTCC01..CLTCC13 compaction-restore host-override | `sdk-compaction-coordinator.legacy-turnstate-coherence.cltcc*.test.ts` | 13 PASS | 13 PASS | 0 |
| LAC01 active non-idle + telemetry co-pinning | `task-header-live-activity-coherence.lac01.test.ts` | 1 PASS | 1 PASS | 0 |
| AOC02 publication-fencing | `application-ownership-control-coherence.aoc02.c24-c-bridge.test.ts` | 4 PASS | 4 PASS | 0 |
| AOPC02 publication fidelity | `application-ownership-projection-coherence.aopc02*.c24-c-bridge.test.ts` | 5 PASS | 5 PASS | 0 |
| Real-local-to-shadow-bridge | `real-local-to-shadow-bridge.c24-c-correction01.test.ts` | 7 PASS | 7 PASS | 0 |
| TaskTelemetryTracker | `task-telemetry-tracker.test.ts` | 43 PASS | 43 PASS | 0 |

## Quality gates (green)

| Gate | Pre-ACT | Post-ACT | Delta |
|------|---------|----------|-------|
| apps/vscode vitest | 1989 PASS | 2004 PASS | +15 |
| apps/vscode bun:unit | 1076 PASS | 1076 PASS | 0 |
| typecheck | 0 diagnostics | 0 diagnostics | 0 |
| lint | PASS | PASS | 0 |
| ablation (rule 0 commented out) | n/a | 3 RED / 12 GREEN | as expected |

## Files changed

- `apps/vscode/src/sdk/task-telemetry-tracker.ts` — +56 lines (`isTaskActive()` + JSDoc)
- `apps/vscode/src/sdk/task-state-shadow-arbiter-mapper.ts` — +32 lines (rule 0 + interface widening)
- `apps/vscode/src/sdk/SdkController.ts` — +19 lines (plumbing + JSDoc)
- `apps/vscode/src/shared/ExtensionMessage.ts` — +6 lines (enum widening + JSDoc)
- `apps/vscode/src/sdk/__tests__/task-header-canonical-task-activity-ownership.cta01.test.ts` — new (354 lines, 15 tests)
- `apps/vscode/src/sdk/__tests__/task-state-shadow-task-header-presentation.thcp01.test.ts` — `taskIsActive: false` default in `inputs()` helper (conservation)
- `apps/vscode/src/sdk/__tests__/task-completion-continuation-coherence.tccc01.test.ts` — helper widened + `taskIsActive` plumbing
- `apps/vscode/src/sdk/__tests__/task-header-live-activity-coherence.lac01.test.ts` — harness helper threads `taskTelemetry.isTaskActive()`
- `apps/vscode/src/sdk/__tests__/application-ownership-projection-coherence.aopc02.c24-c-bridge.test.ts` — local type widened
- `apps/vscode/src/sdk/__tests__/application-ownership-projection-coherence.aopc02-phase-a-correction03.c24-c-bridge.test.ts` — `taskIsActive: false` plumbing
- `apps/vscode/src/sdk/__tests__/sdk-compaction-coordinator.task-header-projection.thcp11.test.ts` — `taskIsActive: false` plumbing
- `.factory/epic-board.md` — this row

## Verdict

**PASS_TASK_LEVEL_ACTIVITY_OWNERSHIP_REPAIRED**.
