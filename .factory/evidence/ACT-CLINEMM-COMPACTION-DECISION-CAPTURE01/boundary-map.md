# ACT-CLINEMM-COMPACTION-DECISION-CAPTURE01 — Boundary Map

Source-backed map of the actual seams that produce, evaluate, execute and
dispatch an automatic compaction. Every row names the file and the symbol
that OWNS the boundary.

## 1. The seam table

| # | Seam | Owner (file:symbol) | What happens there | Identity available | Prior to this ACT |
|---|---|---|---|---|---|
| 1 | **Canonical history** | `session-runtime-orchestrator.ts:agentMessagesToMessagesWithMetadata` (`prepareTurn` adapter, :1774) | The agent's canonical message list is converted to the runtime's message shape | `sessionId`, `iteration` | unchanged |
| 2 | **API-safe projection** | `session-runtime-orchestrator.ts:prepareProviderMessagesForApi` (:1846-1856) | Extension message builders run, then `MessageBuilder.buildForApi` produces the provider-visible projection | `sessionId`, `iteration` | unchanged |
| 3 | **DECISION (eligibility evaluation)** | `compaction.ts:createContextCompactionPrepareTurn` (:385-539) | The production resolver computes `requestInputTokens`, `apiMessageTokens`, `requestOverheadTokens`, `rawMaxInputTokens`, `actualPreviousInputTokens`, `underestimateFactor`, `maxInputTokens`, `requestTriggerTokens`, `shouldCompact`; then publishes the diagnostics observation | `sessionId`, `iteration`; **NO `modelRequestId`** | **GAP 1+2** (see §3) |
| 4 | **Decision observation** | `compaction.ts:observeCompactionTrace(..., "diagnostics", ...)` (:519-539) → `ModelBehaviorTraceSink.onCompactionDiagnostics` | The already-computed production values are published to the existing diagnostic channel | payload fields | **GAP 2** (subset only) |
| 5 | **EXECUTION start** | `latency-sink.ts:onCompactionDiagnostics` → `tracer.enter("compaction", ...)` | A compaction execution span opens — ONLY when `compactionInitiated === true` | `sessionId`, `iteration` | correct (Round C correction) |
| 6 | **EXECUTION end** | `latency-sink.ts:onCompactionCompleted` → `tracer.exit("compaction", ...)` | The span closes with the OBSERVED terminal outcome (`completed` / `failed` / `cancelled`) | `sessionId`, `iteration` | correct |
| 7 | **Provider-ready** | `agent-runtime.ts:observeProviderReady` (:2852) | The FINAL provider-bound representation is reported — after compaction, after every `beforeModel` hook, after the final budget check | `sessionId`, `iteration` | unchanged |
| 8 | **`modelRequestId` mint** | `agent-runtime.ts:streamPreparedRequest` (:2915) | `this.modelRequestId = createUID("model_request", 21)` | `modelRequestId` | unchanged |

## 2. The correlation problem (source-backed)

`modelRequestId` is minted at **step 8** — in `streamPreparedRequest`, AFTER
`prepareModelRequest` has already returned, and therefore AFTER the
compaction decision at **step 3**.

> `sdk/packages/agents/src/agent-runtime.ts:2783` — `request = await this.prepareTurnForModelRequest(request, options);`
> `sdk/packages/agents/src/agent-runtime.ts:2915` — `this.modelRequestId = createUID("model_request", 21);`

The compaction decision therefore CANNOT carry a `modelRequestId`. The
identities that DO exist at the decision seam are:

* `sessionId` — the owning SDK session (`compaction.ts:config.sessionId`).
* `iteration` — the originating runtime iteration (`compaction.ts:context.iteration`),
  incremented at `agent-runtime.ts:1866`.
* `conversationId` — the conversation.

`(sessionId, iteration)` alone does NOT uniquely identify a decision: two
eligibility evaluations can occur within the SAME iteration (a re-compaction
attempt after a failed summarizer call, or an overflow-recovery retry). This
ACT therefore adds a per-session monotonic **decision ordinal**, giving the
stable identity `(sessionId, iteration, decisionOrdinal)`.

### The three objects that must never be conflated

| Object | Meaning | Where it lives |
|---|---|---|
| **Decision request** | The candidate CONSIDERED for compaction | `requestInputTokens` at step 3 — never submitted |
| **Submitted request** | The FINAL payload after compaction and subsequent transforms | `provider_ready` / `provider_submitted` at steps 7 and 9 |
| **Previous provider usage** | Tokens from an EARLIER request | `actualPreviousInputTokens` at step 3 — from `context.previousRequestInputTokens` |

The `actualPreviousInputTokens` value is the provider-reported usage of a
PREVIOUS request. It is NOT the current candidate's usage: the candidate is
never submitted, so no provider ever reported it.

## 3. The two gaps this ACT closed

### GAP 1 — a no-op eligibility check was invisible

`latency-sink.ts:onCompactionDiagnostics` returned EARLY when
`compactionInitiated === false`:

```ts
const initiated = observation.payload.compactionInitiated;
if (initiated === false) {
    // A no-op eligibility CHECK: observed, but not a span.
    return;
}
```

The comment says "observed", but nothing was recorded — the trace contained
NO record of a decision that did NOT compact. That is exactly the evidence
needed to explain why a compaction did not happen.

**Repair:** every eligibility evaluation is now recorded as a POINT
OBSERVATION on the dedicated `compaction_decision` boundary. A point
observation opens NO span and manufactures NO duration. The `compaction`
boundary remains exclusively the EXECUTION boundary.

### GAP 2 — the published payload carried only a subset

The production resolver computed every required value, but only these reached
the diagnostic payload:

`mode`, `strategy`, `requestInputTokens`, `maxInputTokens`,
`requestTriggerTokens`, `userContextCeiling`, `shouldCompact`,
`compactionInitiated`, `inputBudgetSource`, `effectiveMaxInputTokens`,
`usedFallbackBudget`.

The calibration step was INVISIBLE: `rawMaxInputTokens`,
`actualPreviousInputTokens` and `underestimateFactor` never reached the
diagnostic, so the captured `maxInputTokens` could not be verified against

## 4. The invariants this ACT preserves

* Every eligibility check generates AT MOST ONE decision observation.
* A FALSE eligibility result creates NO compaction execution span.
* An INITIATED compaction opens exactly ONE execution span, closed by its
  actual completion/failure/cancellation.
* No synthetic execution duration is manufactured.
* A missing terminal observation leaves the span explicitly OPEN (reported
  as an integrity failure), never a fabricated successful completion.
* The `compaction_decision` point observation is never reported as an
  unavailable measurement — it WAS observed.
* With diagnostics OFF: no collector is allocated, the decision ordinal
  never advances, no persistent record is written, no asynchronous task is
  created, and the compaction decision, request projection and state are
  unchanged.

## 5. What is NOT claimed

* This ACT does NOT claim that any historical compaction was justified.
  The ten Round C compactions predate this capture; their decision-time
  values were never recorded and remain `UNAVAILABLE_FROM_TRACE`.
* This ACT does NOT claim that the estimator is accurate. An internally
  correct decision may still rest on an inaccurate token estimate.
* This ACT does NOT change the trigger ratio, the estimator, the retention
  policy, the model configuration or the summarizer.

the captured inputs. `apiMessageTokens`, `requestOverheadTokens`,
`messageCount`, `apiMessageCount` and `apiMessagesJsonChars` were also
absent.

**Repair:** the production resolver's OWN already-computed values are now
published. NOTHING is recomputed inside the tracer.

| 9 | **Provider dispatch** | `agent-runtime.ts:openTaskLifecycleStream` → `ModelBehaviorTraceSink.onProviderRequestSubmitted` | The provider request is ACTUALLY submitted; this is the anchor for every provider-side timer | `modelRequestId`, `sessionId`, `iteration` | unchanged |
