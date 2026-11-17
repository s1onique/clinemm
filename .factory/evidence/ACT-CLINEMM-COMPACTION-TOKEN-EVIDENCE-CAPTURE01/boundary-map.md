# ACT-CLINEMM-COMPACTION-TOKEN-EVIDENCE-CAPTURE01 — Boundary Map

**Source HEAD (discovered):** `f39ffb732a03a4e755c179c7202b65b7d2c1491f`
**Branch:** `main` · **Remote:** `origin git@github.com:s1onique/clinemm.git`
**Production estimator changes:** NOT AUTHORIZED · **Strata modifications:** NOT AUTHORIZED

---

## 1. The four identities and where each is minted

The ACT's central requirement is an AUTHORITATIVE join between a compaction
decision, the request that decision measured, the provider dispatch of that
request, and the provider-reported usage. Four distinct identities are
needed, and they are minted at four distinct seams.

| Identity | Minted at | Scope | Carried on |
|---|---|---|---|
| `preparationRequestId` | `AgentRuntime.prepareModelRequest()` — `createUID("req")` | ONE prepared request | `PreparedModelRequest.preparationRequestId` |
| `decisionId` | compaction decision seam | ONE eligibility decision | decision record payload |
| `modelRequestId` | `AgentRuntime.streamPreparedRequest()` — `createUID("model_request", 21)` | ONE provider ATTEMPT | request `options.metadata` + trace identity |
| `runId` | `AgentRuntime.run()` — `createUID("run")` | ONE run | trace identity |

### The relationship

```
one preparationRequestId  ->  one prepared request
one prepared request      ->  N provider attempts (retries)
one prepared request      ->  M compaction decisions (a re-compaction attempt
                              inside the same iteration gets a new decisionId
                              but the SAME preparationRequestId)
```

**The invariant the ACT requires:** a provider retry must NOT appear as a
new compaction decision. It is guaranteed because the preparation identity
is bound to the PREPARED REQUEST, and the attempt identity is minted per
ATTEMPT.

---

## 2. The PRE-ACT gap (RED)

Before this ACT the compaction decision seam could not reach the request
identity. The source said so explicitly
(`sdk/packages/core/src/extensions/context/compaction.ts`, pre-ACT):

> The `modelRequestId` is NOT available here: it is minted in
> `streamPreparedRequest`, AFTER this seam returns. The decision therefore
> carries its OWN stable identity — `(sessionId, iteration,
> decisionOrdinal)` — and the provider-dispatch join is established later,
> at the seam that owns the request id.

Consequence: the decision -> dispatch -> usage join was
`INFERRED_CHRONOLOGICAL_PAIRING`, not authoritative. PARITY01 recorded this
explicitly as hypothesis **H5** ("request-correlation error — NOT EXCLUDED
as the primary cause").

**Two distinct gaps were closed:**

| Gap | Pre-ACT | Post-ACT |
|---|---|---|
| **Identity** | decision minted its own id; no link to the request it measured | `preparationRequestId` forwarded verbatim from the runtime's early `req_` id |
| **Content** | the decision record carried metadata only; the exact pre-compaction candidate was unreconstructable | opt-in PRIVATE candidate capture at the decision boundary, BEFORE compaction |

---

## 3. The production seams (post-ACT)

### 3.1 Preparation — `sdk/packages/agents/src/agent-runtime.ts`

```
prepareModelRequest()
  |- modelRequestId = createUID("req")            <- the PREPARATION identity
  |- prepareTurnForModelRequest(request, { preparationRequestId: modelRequestId })
       |- context.preparationRequestId  ->  host prepareTurn pipeline
            |- compaction decision seam
  |- return { request, startedAt, preparationRequestId: modelRequestId }
```

The identity is carried on the `PreparedModelRequest` object, NOT on the
runtime instance: a prepared request may be issued N times, and a runtime
field would let a later preparation silently overwrite an earlier request's
identity.

### 3.2 Decision — `sdk/packages/core/src/extensions/context/compaction.ts`

```
createContextCompactionPrepareTurn(...)(context)
  |- estimateRequestInputTokens(...)                <- the production estimator
  |- shouldCompact = requestInputTokens >= requestTriggerTokens
  |- if (decisionObservationArmed):
  |    decisionOrdinal++ ; decisionId = session#iteration#ordinal
  |    observeCompactionTrace(sink, "diagnostics", {
  |        sessionId, iteration, providerId, modelId,
  |        preparationRequestId: context.preparationRequestId,  <- FORWARDED
  |    }, {
  |        requestInputTokens, apiMessageTokens, requestOverheadTokens,
  |        requestTriggerTokens, rawMaxInputTokens, maxInputTokens,
  |        underestimateFactor, shouldCompact, compactionInitiated,
  |        compactionMode, compactionStrategy,
  |        decisionId, decisionOrdinal,
  |        preparationRequestId,          <- FORWARDED
  |        decisionJoinAuthority,         <- AUTHORITATIVE | UNAVAILABLE
  |    })
  |- captureCompactionDecisionCandidate(...)        <- PRIVATE capture, BEFORE compaction
  |- if (auto && !shouldCompact) return undefined
```

`decisionJoinAuthority` is `AUTHORITATIVE` only when the preparation id was
actually forwarded. It is never reported as authoritative when the id is
absent.

**The decision-versus-execution distinction is preserved.** An eligibility
check is a POINT observation on the `compaction_decision` boundary; only an
INITIATED compaction opens the `compaction` span. The ACT did not change
this.

### 3.3 Dispatch — `sdk/packages/agents/src/agent-runtime.ts`

```
prepareModelRequest()
  |- (after compaction, after every beforeModel transform, after budget enforcement)
  |- activeDispatchRecord = isProviderDispatchRecordRequired(sink)   <- PRODUCER GUARD
  |      ? buildProviderDispatchRecord(request)                     <- SYNCHRONOUS
  |      : undefined                                                <- NO WORK AT ALL
  |- observeProviderReady(request)

buildProviderDispatchRecord(request) -> {
  modelId, providerFamily,
  estimatedFinalInputTokens,          <- the SAME production estimator
  providerVisibleMessageCount,
  toolSchemaCount,
  finalProjectionFingerprint,         <- sha256 of the canonical projection
  finalProjectionRepresentation,      <- AGENT_MODEL_REQUEST_FINAL_PROJECTION
  finalProjectionRepresentationVersion,
  finalProjectionFingerprintProducer,
}
```

**The producer guard (bounded correction, P0-2).** Building the dispatch
record re-projects the provider-visible messages, re-runs the token
estimator, canonicalizes the projection and computes a synchronous SHA-256.
That work must not happen when NOBODY is listening: an ordinary request in
a public profile must not pay for a measurement no consumer reads.
`isProviderDispatchRecordRequired(sink)` (in `@cline/shared`) asks whether
any consumer of the dispatch record exists — the `onRequestPrepared`,
`onProviderRequestSubmitted` and `onProviderRequestCompleted` channels.
When none exists, the record is **not built at all**; the projection and
hash work never executes. The gate is real, not a blanket disablement: with
one of those channels present, the record IS built.

The fingerprint is computed at the PROVIDER-READY seam because that is the
only point at which the request content is final. It is a CONTENT
fingerprint of the CLIENT-side representation; it is **not** a claim of
byte-identical provider-wire content, because the provider adapter may still
transform the request after this point. The representation and producer are
recorded precisely so that no consumer can mistake one for the other.

The computation is **SYNCHRONOUS** by design. An asynchronous WebCrypto
digest would introduce a suspension point on the request-preparation path,
which the production retry-backoff tests drive with fake timers; that
suspension hangs the suite and, more importantly, would change the timing
of the real provider dispatch. A dependency-free FIPS 180-4 SHA-256 is used
instead, and is witnessed against `node:crypto` at every block boundary.

### 3.5 Export — `sdk/packages/core/src/observability/latency/latency-sink.ts`

The metadata-only "Cline Debug: Dump Latency Trace" output is the
SHAREABLE artifact, and it must carry the join. Two production details
make that true (bounded correction, P0-4):

1. **The observation identity is projected onto the metadata bag.** The
   authoritative `preparationRequestId` and `modelRequestId` live on the
   OBSERVATION (`ModelBehaviorTraceObservation`), not on
   `observation.payload`. An adapter that forwards only the payload silently
   DROPS the join key. `withObservationCorrelation(observation)` moves them
   onto the metadata bag; the payload's own value wins when both carry the
   same field.

2. **The finite metadata ALLOWLIST carries the new fields.**
   `LATENCY_METADATA_ALLOWLIST` now includes `preparationRequestId`,
   `modelRequestId`, `decisionId`, `decisionJoinAuthority`,
   `estimatedFinalInputTokens`, `finalProjectionFingerprint` (plus its
   representation/version/producer), `providerFamily`,
   `providerVisibleMessageCount` and `toolSchemaCount`. The allowlist is
   still the privacy boundary — only identifiers, counts, digests and
   classifications pass — and the export-path witness asserts that no
   request CONTENT reaches the serialized trace.

The complete production path is therefore
`AgentRuntime -> LatencyTraceSink -> sanitized trace JSON`, and the export
carries the EXACT preparation identity shared by the decision, the
submission and the completion, with a DISTINCT attempt identity per
provider attempt.

### 3.4 Completion — `sdk/packages/agents/src/agent-runtime.ts`

```
modelRequestFinishPayload = {
  finishReason,
  usageAvailable: metrics !== undefined,
  ...(metrics ? { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens } : {}),
  ...activeDispatchRecord,     <- the SAME projection the dispatch described
}
```

**Cache semantics (unchanged, and pinned by a witness):** `inputTokens` is
the COMPLETE prompt; `cacheReadTokens` is a SUBSET of it. The cached amount
is reported ALONGSIDE the total and is never added into it.

**Missing usage:** when the provider reported no usage, `usageAvailable` is
`false` and the token fields are ABSENT — never zero. A missing usage is
UNAVAILABLE, not "the provider said zero".

---

## 4. The retry taxonomy (observed, and material to the measurement)

The runtime has TWO retry levels, and they behave differently with respect
to the preparation identity. This was established by direct observation at
the production seam, not by assumption.

| Level | Site | Re-prepares? | Preparation identity |
|---|---|---|---|
| REQUEST-level | `retryTruncatedTurnWithCompaction` -> `issuePreparedRequest(prepared)` | NO | SAME |
| TURN-level | `generateAssistantMessageWithProviderRetry` -> `generateAssistantMessage` | YES | NEW |

The REQUEST-level retry re-issues an already-prepared request (the
transcript has not changed between a 429 and its retry, so recompacting
would only repeat the compaction's notices, telemetry and summarizer call).
That is the case the ACT cares about: a provider retry must not appear as a
new compaction decision.

The TURN-level retry re-runs the whole preparation. A NEW preparation
identity is correct there, because the compaction policy really did run
again and really did make a new decision.

**Observation worth recording (not changed by this ACT):** the
REQUEST-level retry is currently reachable only for a provider failure that
surfaces as a `finish` event with `reason: "error"` AND leaves the turn
with no tool calls. A provider failure that throws out of `model.stream()`
propagates past `withProviderErrorRetry`, because the wrapper classifies a
RETURNED turn, not a thrown error. This is PRE-EXISTING production
behaviour; the ACT records it and does not change it (the ACT does not
authorize a compaction-logic or retry-logic change).

---

## 5. The private candidate capture

`sdk/packages/core/src/runtime/observability/compaction-candidate-capture.ts`

| Property | Contract |
|---|---|
| Opt-in | `CLINE_PRIVATE_COMPACTION_CANDIDATE_CAPTURE=1` — SEPARATE from the shareable trace opt-in — **AND** `CLINEMM_RUNTIME_PROFILE=dogfood` — the established closed-runtime dogfood identity (exact-match, fail-closed). Both are REQUIRED. |
| Location | `<CLINE_DATA_DIR>/private/compaction-candidates/` (or `<CLINE_DIR>/data/private/compaction-candidates/`) — outside every diagnostics export. **NO `~/.cline/data` fallback**: with no explicit storage root the capture is NOT armed at all. |
| Permissions | directory `0700`, files `0600` (POSIX). `chmod` is applied explicitly to the directory and to every written file, because `mkdir`/`writeFile` `mode` only applies to newly created entries. |
| Bounds | 12 candidates; 8 MiB per candidate; 64 MiB total. Enforced **ON THE WRITE**: an oversized candidate is REJECTED BEFORE ANY BYTE IS WRITTEN and reported as a metadata-only rejection receipt. |
| Disk accounting | The store tracks the files it owns; the reported byte/count totals are the ACTUAL on-disk totals. Superseded files are REMOVED, so the retention cap bounds the directory, not just the in-memory state. |
| Truncation / rejection | EXPLICIT: `snapshotComplete:false` + `truncationReason`; a truncated or rejected candidate is ineligible for exact counting |
| Immutability | `record()` deep-copies and freezes the candidate BEFORE the first asynchronous boundary, so a later mutation of the live request objects cannot change what the "exact" snapshot represents. |
| Retention | ONE immediately preceding non-compacting control + the compaction candidates |
| Removal | `CompactionCandidateCaptureStore.remove()` |
| Content | NEVER printed to a terminal, NEVER in an export or incident bundle, NEVER in Git |
| Options | ALLOWLIST-filtered at the producer AND at the write boundary (defence in depth) |
| Failures | swallowed; the runtime's behaviour is unchanged |

**The capture happens at the decision boundary, BEFORE compaction**, so the
already-prepared inputs are exactly the inputs the decision measured. The
stateful `MessageBuilder` is NEVER called again. The captured objects are
not mutated.

**Representation:** `CLIENT_DECISION_CANDIDATE_EXACT`. It is explicitly NOT
`SERVER_FORMATTED_PROMPT_EXACT` — the provider still applies its own chat
template and tokenization to it.
