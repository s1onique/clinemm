# E7.1 — Local Webview Shadow-Projection Cutover Plan

**ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-WEBVIEW-SHADOW-PROJECTION-CUTOVER01**

This is the E7.1-C2 contract freeze. It pins the single presentation
// selector and the cutover surface that the production code MUST
follow, without inventing an API the existing architecture lacks.

---

## 1. Single presentation authority

```ts
// apps/vscode/src/sdk/task-state-shadow-arbiter-mapper.ts (frozen)

export interface ThinkingPresentationInputs {
    readonly canonicalShadow: ArbiterSnapshot | undefined
    readonly currentLegacyPhase: TurnPhase
    readonly seq: number
}

export function selectThinkingPresentation(
    input: ThinkingPresentationInputs,
): ThinkingPresentationProjection {
    if (input.canonicalShadow) {
        return {
            modelStreaming: input.canonicalShadow.execution.modelStreaming,
            source: "shadow",
            seq: input.seq,
        }
    }
    return {
        modelStreaming: input.currentLegacyPhase === "streaming",
        source: "legacy",
        seq: input.seq,
    }
}
```

This is the ONLY producer of the `thinkingPresentation` field that the
webview reads. The webview MUST NOT reconstruct Thinking from message
prose anywhere — the predecessor ACTs removed every such fallback.

The selector is intentionally NOT on the `TurnStateTracker` legacy
authority and is NOT a wrapper over `TurnPhase`. It accepts a
canonical `ArbiterSnapshot` OR a legacy `TurnPhase`, never both —
the two-source rule is enforced by the body shape, not by an
assertion.

## 2. Frozen invariant (the two-source rule)

```text
LOCAL + qualified shadow available:
    Thinking = canonicalShadow.execution.modelStreaming
    source   = "shadow"

Canonical/shadow unavailable:
    Thinking = currentLegacyPhase === "streaming"
    source   = "legacy"

HUB:
    byte-/behavior-equivalent legacy behavior.

REMOTE:
    byte-/behavior-equivalent legacy behavior.
```

The "canonical unavailable" absence state collapses per CONTRACT_2 in
`task-state-shadow-arbiter-mapper.ts` §1.2 — Hub/Remote hosts that omit
`runtimeSnapshot()` AND Local sessions with no active AgentRuntime
instance yet both produce `canonicalShadow = undefined`, both fall
through to the legacy branch.

## 3. Thinking specifically

The TaskState model already froze:

```text
projectThinking(model) ≡ model.activity.modelStreaming
```

E7.1 does NOT invent another independent definition such as:

```text
- last assistant message is reasoning
- request still open
- terminal flag absent
- message prose contains ...
```

The four production consumers (C1..C3 above; C4 is the TaskHeader
state label and explicitly OUT OF SCOPE) all compute
`isThinking = modelStreaming` from the same canonical projection.
There is one definition of Thinking, frozen in
`ArbiterSnapshot.execution.modelStreaming`.

## 4. Wire shape

```ts
// apps/vscode/src/shared/ExtensionMessage.ts (frozen)

export interface ThinkingPresentationProjection {
    modelStreaming: boolean
    source: "shadow" | "legacy"
    seq: number
}

interface ExtensionState {
    // ...
    turnState?: TurnState
    thinkingPresentation?: ThinkingPresentationProjection
    // ...
}
```

The wire field is `thinkingPresentation?: ThinkingPresentationProjection`,
optional (legacy transports may omit it; the consumer falls back to
the legacy `turnState.phase` gate).

## 5. Production consumer seams (changed)

```text
ChatRow.tsx:881-921
  case "reasoning"
  - const messageTailStreaming = message.partial === true
  - const canonicalModelStreaming =
      thinkingPresentation?.modelStreaming ??
      (turnState?.phase === "streaming")
  + const isReasoningStreaming = messageTailStreaming && canonicalModelStreaming
  Reads:  turnState (legacy), thinkingPresentation (canonical)

RequestStartRow.tsx:194-326
  - const turnStateIsStreaming = turnState?.phase === "streaming"
  + const canonicalModelStreaming =
      thinkingPresentation?.modelStreaming ?? turnStateIsStreaming
  Reads:  turnState (legacy), thinkingPresentation (canonical)

useThinkingLoaderRow.ts:62-101
  + if (thinkingPresentation) {
  +   if (!thinkingPresentation.modelStreaming) return false
  +   // completion_result anti-flicker guard (shared with legacy path)
  +   if (...) return false
  +   // canonical modelStreaming: show Thinking until a visible content row
  +   if (groupedMessages.length === 0 || !lastVisibleMessage) return true
  +   if (lastVisibleRow && isToolGroup(lastVisibleRow)) return true
  +   return lastVisibleMessage.partial !== true
  + }
  Reads:  turnState (legacy fallback), thinkingPresentation (canonical)

TaskHeaderTelemetry.tsx (NOT MIGRATED — disposition row C4)
  Reads:  turnState (legacy, full-phase vocabulary)
  Rationale: the TaskHeader state label is multi-phase ("Working" /
  "Approval" / "Complete" / "Error" / "Paused" / "Waiting") — not
  pure Thinking. Migrating it requires a richer TurnPhase-shaped
  projection that is explicitly out of scope for E7.1.
```

## 6. Production consumer seams (unchanged)

```text
useExtensionState().turnState    ← retained for non-thinking
  concepts (button set, composer lockout, follow-up routing).
  NOT removed; NOT replaced.

TurnStateTracker.set(...)        ← retained. E8 owns writer retirement.

ExtensionStateContext reducer    ← retained. The thinkingPresentation
  field flows through unmodified (no merge, no transform — the field
  is authoritative).
```

## 7. Hub/Remote conservation

The two absence states collapse per CONTRACT_2. The Hub/Remote
consumer delta is:

```text
extension → webview payload
  before E7.1: turnState: tracker.get()
  after  E7.1: turnState: tracker.get()            [unchanged]
                thinkingPresentation: selectThinkingPresentation({
                    canonicalShadow: undefined,    [Hub/Remote hosts]
                    currentLegacyPhase: tracker.currentPhase,
                    seq: tracker.get().seq,
                })
                              == {
                                  modelStreaming: tracker.currentPhase === "streaming",
                                  source: "legacy",
                                  seq: tracker.get().seq,
                              }

webview consumer (ChatRow, RequestStartRow, useThinkingLoaderRow)
  before E7.1: reads turnState.phase
  after  E7.1: reads thinkingPresentation?.modelStreaming ??
               turnState.phase === "streaming"
              When thinkingPresentation is present (always on E7.1+
              controllers), the projection is consulted first.
              When thinkingPresentation is absent (legacy transports),
              the legacy gate is consulted.

  Visible behavior on Hub/Remote:
    thinkingPresentation.modelStreaming =
        currentLegacyPhase === "streaming"
    is identical to the pre-E7.1 expression
        turnState.phase === "streaming"
    → byte-/behavior-equivalent. No observable delta.
```

## 8. Effect / authority conservation

```text
EFFECT_EXECUTION_ENABLED       = false  (unchanged)
LEGACY_WRITERS_RETIRED        = false  (unchanged)
TurnStateTracker.set removal  = forbidden  (E8 owns)
SdtController.cancelTask      = unchanged
SdtController.initTask        = unchanged
SdkTaskStartCoordinator       = unchanged
reinitExistingTaskFromId      = unchanged

REDUCER_SEMANTIC_DELTA         = 0     (thinkingPresentation field
                                         is a new payload addition,
                                         not a reducer semantic change)
TASK_EFFECT_EXECUTION_DELTA   = 0     (read-only projection)
HUB_CONSUMER_DELTA             = 0     (byte-equivalent)
REMOTE_CONSUMER_DELTA          = 0     (byte-equivalent)
PROTOCOL_SEMANTIC_DELTA        = 0     (new optional wire field
                                         only; legacy transports
                                         that omit it continue to
                                         work via the fallback)
```

## 9. Risk envelope

The change is a new optional wire field + a presentation selector
that prefers the new field when present. The fallback to the legacy
field ensures backward compatibility. The four consumers are
rendering components only — no control flow, no task effect, no
authority decision. The risk envelope is "two lines per consumer +
one new field + one new selector + tests", all of which is below
the "do not introduce protocol semantic delta" threshold when read
as a transport change.

The only forward-compatibility concern is the `ExtensionMessage`
type: any external proto schema serializer that reads the wire
type MUST be updated to accept the new optional field. The
proto-conversion path is unaffected because the field is purely
additive and the optional type allows omission.
