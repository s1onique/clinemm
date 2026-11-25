# ACT-CLINEMM-COMPACTION-ATOMIC-SUMMARY-INSTALLATION-REPAIR-01

## 02 — Completion-status ownership recon (§4)

The production path, in order, with the point at which each signal is
present or lost.

### 2.1 THE PATH

```text
Provider response
  -> provider adapter            (sdk/packages/llms/src/providers/ai-sdk.ts,
                                  sdk/packages/llms/src/providers/compat.ts)
    -> gateway stream            (AgentModelEvent { type: "finish", reason })
      -> summary generation      (sdk/packages/core/src/extensions/context/summary-generation.ts)
        -> compaction acceptance (sdk/packages/core/src/extensions/context/agentic-compaction.ts)
          -> compaction state installation
                                             (sdk/packages/core/src/extensions/context/compaction.ts)
            -> persistence      (sdk/packages/core/src/runtime/host/local-runtime-host.ts)
              -> resumed provider projection
                                             (sdk/packages/core/src/session/models/session-compaction.ts)
```

### 2.2 WHERE EACH SIGNAL EXISTS, AND WHERE IT IS LOST

| Signal | Exists at | Lost at |
| --- | --- | --- |
| **Provider finish reason** (raw) | The provider's wire value, e.g. `finish_reason: "length"` | Normalized by `mapFinishReason()` (`ai-sdk.ts:1034-1050`) into the gateway's `AgentModelFinishReason` union. The RAW value is not carried further. |
| **Normalized finish reason** | `AgentModelEvent { type: "finish", reason: "max-tokens" }` | Mapped by `toApiStreamChunk()` (`compat.ts:645-657`) into `done.incompleteReason`. The gateway's `reason` union is not carried into the `ApiStream` contract. |
| **`incompleteReason`** | `ApiStreamDoneChunk.incompleteReason` (`sdk/packages/llms/src/providers/stream.ts:119-129`) | **NOT lost.** `generateSummary()` collects it and returns it in `SummaryGenerationResult.incompleteReason`. **This was the point where the signal was present but UNUSED.** |
| **`failed`** | `SummaryGenerationResult.failed`, set from `!chunk.success` | **NOT lost**, and likewise **UNUSED** before this ACT. |
| **Completion event observed** | The `done` chunk's arrival | **WAS LOST.** `generateSummary()` did not record WHETHER the completion event arrived, so "the stream ended normally" and "the stream ended without its completion event" were indistinguishable. This ACT added `completed`. |
| **Cancellation** | `options.signal` in `generateSummary()`; `context.abortSignal` in the compaction seam | **NOT lost at the summarizer**, but see §2.5: `runAgenticCompaction()` does not pass the compaction's abort signal to `generateSummary()`. |
| **Transport errors** | The `done` chunk's `error` field | **NOT lost.** `generateSummary()` throws `new Error(chunk.error)`. |
| **Empty output** | `SummaryGenerationResult.text` | **NOT lost.** `runAgenticCompaction()` already refused it (skip + warn with a `likelyCause`). |
| **Successful completion** | The absence of the negative signals | **NOT lost**, but indistinguishable from "no completion event". |

### 2.3 THE OPENAI-COMPATIBLE `finish_reason: "length"` MAPPING — CONFIRMED

The production dependency DOES map it. The chain, verified against the
source and exercised by a test that drives the REAL gateway and the REAL
adapter with a deterministic SSE substitute
(`sdk/packages/llms/src/providers/providers.finish-reason-length.test.ts`):

```text
finish_reason "length"                              (the provider's wire value)
  -> mapFinishReason()        ai-sdk.ts:1041-1042  -> "max-tokens"
    -> AgentModelEvent        (the gateway event)  -> { type: "finish", reason: "max-tokens" }
      -> toApiStreamChunk()    compat.ts:645-657    -> { type: "done", success: true,
                                                        incompleteReason: "max_tokens" }
        -> generateSummary()   summary-generation  -> SummaryGenerationResult.incompleteReason
          -> the acceptance decision
```

`"length"` -> `"max-tokens"` is asserted by the existing gateway suite
(`sdk/packages/llms/src/providers/gateway.test.ts:352,379`).
`"max-tokens"` -> `incompleteReason: "max_tokens"` is asserted by this ACT's
new adapter witness.

**No adapter propagation change was necessary.** The mapping was already
correct.

### 2.4 NOT EVERY PROVIDER EMITS `incompleteReason`

This is recorded explicitly, because the acceptance contract must not assume
otherwise:

- `incompleteReason` is populated ONLY by providers that REPORT it. The
  gateway's `AgentModelFinishReason` union has a member for it, and the
  adapter only sets it for `max-tokens` and `content-filter`.
- A provider that silently truncates without reporting is **NOT** covered.
  The predecessor's §4.5 confidence boundary said the same thing, and this
  ACT preserves it: the contract refuses **KNOWN**-incomplete candidates.
- Successful termination is **NOT inferred** from non-empty text, and it is
  **NOT inferred** from the absence of a negative signal.

### 2.5 THE CANCELLATION GAP (PRE-EXISTING, CONSERVED)

`runAgenticCompaction()` calls `generateSummary()` **without** the
compaction's abort signal — at ENTRY_HEAD and after this ACT:

```ts
const summaryResult = await generateSummary({
    providerConfig: summarizerProviderConfig,
    systemPrompt: "Summarize the provided coding session ...",
    request: summaryRequest,
});   // <- no `signal`
```

A cancellation signalled at the COMPACTION level therefore does not
interrupt the summarizer transport; the summarizer's own completion decides
the outcome. This ACT **conserves** that behaviour (the acceptance contract
does not alter the cancellation path), and the suite records it as such.

A cancellation **inside** the transport is a different case and is handled
by the existing contract: the error propagates, and the compaction seam
re-throws it rather than falling back to basic compaction.

### 2.6 THE UNKNOWN / UNAVAILABLE CLASSIFICATION

Where the completion status is genuinely unavailable, it is classified as
`legacy_completion_status_unavailable` — the LEGACY shape, which the
existing contract already tolerated and which stays installable. It is
**NOT** confused with `premature_stream_termination`, which is a stream that
ENDED WITHOUT its completion event and is NOT installable.

### 2.7 THE FIVE CLASSIFICATIONS

| Classification | Meaning | Installable |
| --- | --- | --- |
| `known_complete` | The transport reported a normal completion and no negative terminal signal. | YES |
| `known_incomplete` | The transport reported that the response was incomplete. | **NO** |
| `known_failed` | The transport reported a failure (or the generation was cancelled). | **NO** |
| `premature_stream_termination` | The stream ended WITHOUT the completion event the transport contract requires. | **NO** |
| `legacy_completion_status_unavailable` | The stream ended normally but carried no finish-reason metadata. | YES (legacy conserved) |

These are SEMANTIC classifications. They are **not** a new public enum and
they are not persisted as one.

### 2.8 THE ORDER OF AUTHORITY

```text
1. CANCELLATION wins over everything.
2. A KNOWN negative terminal signal (incomplete / failed) wins over the
   success flag AND over non-empty text.      <- the conflicting-signal rule
3. An EMPTY or whitespace-only output is not a summary.
4. A stream that ended WITHOUT its completion event is a premature
   termination.
5. A stream that ended normally with NO finish-reason metadata is the
   LEGACY shape and stays installable.
```
