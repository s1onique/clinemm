# 02 — RED reproduction, boundary matrix and causal necessity

**Evidence classification:** `SYNTHETIC_REAL_PRODUCTION_SEAM`
**RED:** `REPRODUCED`
**LOSS_BOUNDARY:** `IDENTIFIED`
**CAUSAL_NECESSITY:** `PROVEN`

---

## 1. The production chain

```
Provider response bytes (Anthropic SSE)
  → @ai-sdk/anthropic stream parts          (ai@7.0.159 / @ai-sdk/anthropic@4.0.94)
  → ClineMM AI SDK translator               (sdk/packages/llms/src/providers/ai-sdk.ts)
  → AgentModelEvent "reasoning-delta"
  → AgentRuntime assistant-part accumulation (sdk/packages/agents/src/agent-runtime.ts)
  → session persistence (agent-message-codec.ts)
  → context assembly / outbound conversion (toAiSdkMessages, ai-sdk.ts)
  → AI SDK prompt
  → @ai-sdk/anthropic serializer            (convert-to-anthropic-prompt.ts)
  → ACTUAL HTTP REQUEST BODY
```

## 2. The contract the provider actually uses

The Anthropic Messages streaming contract delivers a thinking block's
SIGNATURE as a SEPARATE event with no text:

```
content_block_start   { type: "thinking" }
content_block_delta   { type: "thinking_delta", delta: { thinking: "…" } }
content_block_delta   { type: "signature_delta", delta: { signature: "…" } }
content_block_stop
```

The resolved SDK converts the signature event into a `reasoning-delta` whose
`delta` is the EMPTY STRING, with the signature in
`providerMetadata.anthropic.signature`
(`@ai-sdk/anthropic@4.0.94/src/anthropic-language-model.ts:2907-2923`).

## 3. The defect

Two independent facts in the ClineMM translator
(`sdk/packages/llms/src/providers/ai-sdk.ts`):

1. The reasoning branch was guarded by `if (text) { … }`, so a
   metadata-bearing reasoning event with EMPTY text was **dropped entirely**.
2. The metadata extractor read ONLY the Google/Vertex buckets
   (`providerMetadata.google` / `providerMetadata.vertex`); it never read
   `providerMetadata.anthropic`.

Consequence: the provider's thinking signature never reached the accumulated
reasoning part. The next request therefore serialized the reasoning WITHOUT a
signature, and the Anthropic serializer emitted
`unsupported reasoning metadata` and **dropped the reasoning block from the
request entirely**.

## 4. The RED (primary, MiniMax)

`RED_SUBJECT_HEAD` = `1d45a8d845eca27bce311949a08fca7868f211cd` (the pristine
`ai-sdk.ts`).

**File:** `sdk/packages/llms/src/providers/routing/minimax-reasoning-continuity-p0-01.test.ts`

**Command**

```
cd sdk/packages/llms && bun x vitest run src/providers/routing/minimax-reasoning-continuity-p0-01.test.ts
```

**Exit code:** `1`

**Observed output (verbatim, trimmed)**

```
(node:30713) Warning: AI SDK Warning (minimax / MiniMax-M3.1-Flash): unsupported reasoning metadata
 ❯ src/providers/routing/minimax-reasoning-continuity-p0-01.test.ts (1 test | 1 failed)
   × R1: replays provider-required reasoning WITH its signature in the next request 410ms

AssertionError: the follow-up request carried no Anthropic thinking block: expected undefined to be defined
 ❯ src/providers/routing/minimax-reasoning-continuity-p0-01.test.ts:303:5

 Test Files  1 failed (1)
      Tests  1 failed (1)
```

The warning string emitted by the reproduction is byte-identical to the
`codium-lab` observation, including the provider id and the model id.

**Expected invariant:** the provider-required reasoning, WITH its signature,
reaches the next outbound request.

**Actual observed behaviour:** the follow-up request contained NO Anthropic
`thinking` block at all. The reasoning was silently lost on the wire.

**Failure class:** `REQUIRED_REASONING_OMITTED` and
`REQUIRED_SIGNATURE_OMITTED`.

### 4.1 How the RED exercises the real seam

- The REAL `createGateway` is used.
- The REAL `@ai-sdk/anthropic` adapter is used — MiniMax is served by the
  native Anthropic transport.
- The ONLY replacement is the external network boundary: an injected `fetch`
  that returns RAW Anthropic-protocol SSE bytes (`message_start`,
  `content_block_start`, `content_block_delta` with `thinking_delta`,
  `content_block_delta` with `signature_delta`, `content_block_stop`,
  `message_delta`, `message_stop`).
- The follow-up request is built by the runtime's OWN accumulation semantics
  and is serialized by the REAL provider SDK.
- The assertions are made against the ACTUAL SERIALIZED OUTBOUND HTTP
  REQUEST BODY captured at the transport boundary.

No reasoning part is hand-constructed, no history is manually rebuilt, and
the assertion is not a warning count.

## 5. Boundary matrix (measured)

`src/providers/routing/minimax-reasoning-boundary-p0-01.test.ts` observes each
boundary. Measured report (pre-repair):

| Boundary | Expected | Observed | Disposition |
|---|---|---|---|
| Raw response | Contract-valid reasoning | `thinking_delta` + SEPARATE `signature_delta` | PASS |
| SDK stream | Required information present | `reasoning-delta` count **2**; signature-bearing **1**; empty-`delta` signature-bearing **1** | PASS |
| Translator | Required information preserved | `reasoning-delta` count **1**; events carrying the Anthropic signature **0** | **FAIL — LOSS** |
| Runtime accumulation | Correct block association | Inherits the translator's loss (`agent-runtime.ts:3155` copies `event.metadata ?? part.metadata`) | NOT EXECUTED (upstream of the loss) |
| Persistence | Faithful representation | Codec already round-trips `metadata.signature` (`agent-message-codec.ts:324-332`) | NOT EXECUTED (upstream of the loss) |
| Outbound conversion | Provider-valid representation | `toAiSdkMessages` reads `metadata.signature` — but it was never populated | NOT EXECUTED (upstream of the loss) |
| HTTP request | Required replay | No `thinking` block; `unsupported reasoning metadata` emitted | **FAIL** |

**LOSS_BOUNDARY = IDENTIFIED** — the translator
(`sdk/packages/llms/src/providers/ai-sdk.ts`).

Boundaries marked NOT EXECUTED are upstream of the loss and were not
populated with inferred success.

## 6. Causal necessity — ablation

All ablations were performed inside the isolated worktree and reverted
afterwards.

| # | Ablation | Result |
|---|---|---|
| A | Revert the whole production change | RED restored — `AI SDK Warning (minimax / MiniMax-M3.1-Flash): unsupported reasoning metadata`, 5 test failures |
| B | Keep the Anthropic metadata extraction, restore the `if (text)` guard | RED restored — same warning, same assertion failure |
| C | Forward the empty-text event, remove ONLY the Anthropic metadata extraction | RED restored — same warning, same assertion failure |

B and C are **independent** ablations: each removes exactly one of the two
halves of the correction and each is sufficient to restore the failure.

**CAUSAL_NECESSITY = PROVEN**

## 7. The native-Anthropic discriminator (section 6.2)

The upstream defect shape was exercised independently through the native
Anthropic route (`providerId: "anthropic"`), with the same
`reasoning-start` → `reasoning-delta`(text) → `reasoning-delta`(signature,
empty text) → `reasoning-end` → completion event sequence:

- `src/providers/routing/minimax-reasoning-origins-p0-01.test.ts` R6: the
  native Anthropic signature reaches the wire **unchanged**.
- R7: native Anthropic UNSIGNED reasoning keeps the existing safe behaviour
  (the block is dropped by the provider's own serializer; no signature is
  fabricated).

`ANTHROPIC_RED = REPRODUCED` (same root cause, same seam).

## 8. The legitimate-unsigned discriminator (section 6.3)

`src/providers/routing/minimax-reasoning-conservation-p0-01.test.ts` R5
exercises a MiniMax thinking block with NO signature event:

- The reasoning is NOT replayed as a `thinking` block (the Anthropic
  serializer rejects an unsigned thinking block by contract).
- NO signature is invented: the serialized body contains no `signature` key.

The absence of a signature is therefore NOT treated as a defect when the
provider contract does not require one.

`UNSIGNED_REASONING_HANDLING = VERIFIED`

## 9. Upstream applicability

| Upstream artefact | Disposition |
|---|---|
| cline#15541 (Anthropic: signature delivered in metadata-bearing events with empty reasoning deltas) | **PARTIALLY_PRESENT** — the defect SHAPE is present in our source (the translator drops empty-text metadata-bearing reasoning events), and the mechanism is the same. |
| cline#15552 (the upstream fix for that shape) | **ABSENT** in our source: no Anthropic-signature extraction existed in the translator, and empty-text reasoning events were dropped. |
| Hermes reports (MiniMax-specific reasoning-replay/signature incompatibility) | **NOT_APPLICABLE as a workaround import** — the defect here is reproduced entirely inside our own translator against the resolved SDK; no external harness-specific workaround was imported. |
| MiniMax interleaved-thinking documentation | **CONSISTENT** with the reproduced contract: MiniMax M3.1 is served over the Anthropic-compatible transport, so its thinking signature is an Anthropic thinking-block signature and must be replayed as one. |

A native Anthropic signature-preservation fix is **not** automatically a
MiniMax fix — in this repository it becomes one only because MiniMax is
served by the same native Anthropic transport. That was established
locally, from the provider identity in section 4 of `01-entry-and-isolation.md`,
and demonstrated on the wire.
