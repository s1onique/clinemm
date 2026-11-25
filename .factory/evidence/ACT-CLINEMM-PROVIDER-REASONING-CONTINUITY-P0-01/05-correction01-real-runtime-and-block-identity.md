# 05 — CORRECTION01: the real-runtime seam, reasoning-block identity and the origin boundary

**ACT:** `ACT-CLINEMM-PROVIDER-REASONING-CONTINUITY-P0-01-CORRECTION01`
**Verdict:** `GO_PROVIDER_REASONING_REPAIR_INTEGRATION`

---

## 1. Why the previous evidence was insufficient

The predecessor's principal regression built the assistant history with a
TEST-LOCAL accumulator (`assistantTurnFromEvents()` /
`assistantTurn()`). That accumulator appended adjacent reasoning text and
REPLACED the metadata, so it could only ever observe a merged block. The
predecessor's claim that "only the external network boundary was replaced"
was therefore incorrect: the runtime accumulation was replaced too.

This correction replaces that seam with the REAL production
`AgentRuntime`.

## 2. The real-runtime seam

**File:** `sdk/packages/agents/src/provider-reasoning-continuity-runtime.test.ts`

```
synthetic Anthropic-protocol SSE bytes
  -> the RESOLVED @ai-sdk/anthropic adapter
  -> the REAL ClineMM translator (@cline/llms)
  -> the REAL AgentRuntime accumulation (@cline/agents)
  -> a REAL deterministic test tool, executed by the runtime
  -> the REAL follow-up request construction
  -> the REAL provider serializer
  -> the CAPTURED outbound HTTP request
```

The runtime is constructed with the REAL gateway's model:

```typescript
const gateway = createGateway({ providerConfigs: [{ providerId: "anthropic",
    apiKey: "test-key", baseUrl: ANTHROPIC_BASE_URL, fetch: fetchImpl }] });
const runtime = createAgentRuntime({
    model: gateway.createAgentModel({ providerId: "anthropic", modelId: MODEL_ID }),
    tools: [makeTool(executions)],
    requestToolApproval: () => ({ approved: true }),
    telemetry: telemetryMock(),
});
```

No assistant history and no tool-result message is assembled by the test.
The runtime builds them.

### 2.1 Enabling infrastructure

The published `@cline/llms` / `@cline/agents` / `@cline/shared` entry points
at `dist/`, which is not built in a source checkout. Two vitest configs
gained the SAME source alias mechanism `sdk/packages/llms/vitest.config.ts`
already used for `@cline/shared`:

- `sdk/packages/agents/vitest.config.ts`
- `sdk/packages/core/vitest.config.ts`

This is test infrastructure only; it changes no production behaviour.

## 3. P0-1 — the substituted runtime seam is closed

**Result: `REAL_RUNTIME_SEAM = VERIFIED`, `REAL_TOOL_CONTINUATION = VERIFIED`,
`REAL_RUNTIME_RED = REPRODUCED` (on the baseline), `REAL_RUNTIME_GREEN = PASS`**

| Case | Assertion |
|---|---|
| RT1 | The follow-up request contains EXACTLY the original reasoning, the original signature, the original tool call and the original tool result |
| RT2 | TWO signed thinking blocks stay DISTINCT, in order, each with its OWN signature |
| RT3 | An EMPTY signed thinking block is conserved (no placeholder text) |
| RT4 | The Anthropic reasoning metadata does NOT reach tool-call records |
| RT5 | The MiniMax signed reasoning is replayed and Low stays Low on every request |
| RT6 | TWO MiniMax signed thinking blocks stay DISTINCT, each with its OWN signature |
| RT8 | A native-Anthropic signature does NOT cross into a MiniMax-origin request |

RT1's assertion is exact equality on the outbound blocks:

```typescript
expect(assistant).toEqual([
    { type: "thinking", thinking: REASONING_A, signature: SIGNATURE_A },
    { type: "tool_use", id: TOOL_CALL_ID, name: TOOL_NAME, input: {} },
]);
```

No invented fallback tool-call identifier is used: the runtime's own
`tool-call-delta` id is asserted against the wire, and the runtime's own
tool execution is counted (`expect(executions).toEqual([TOOL_NAME])`).

### 3.1 The baseline RED (the new witness against the pristine production)

Running the new witness against the pristine production code (the
predecessor's production repair retained, the block-identity correction
reverted) produced exactly three failures — the three cases that the
correction addresses:

```
FAIL src/provider-reasoning-continuity-runtime.test.ts > ... > RT2: keeps TWO signed
     thinking blocks distinct, in order, each with its OWN signature
FAIL src/provider-reasoning-continuity-runtime.test.ts > ... > RT6: keeps TWO MiniMax
     signed thinking blocks distinct, each with its OWN signature
FAIL src/provider-reasoning-continuity-runtime.test.ts > ... > RT8: a native Anthropic
     signature does not cross into a MiniMax-origin request
```

This was measured by running the whole `@cline/agents` suite on the pristine
production code and on the corrected code and comparing the FAILURE
IDENTITIES (not the aggregate counts):

```
=== AGENTS: new failures introduced by the correction (in corrected, not in baseline) ===
(none)
=== FIXED by the correction (in baseline, not in corrected) ===
src/provider-reasoning-continuity-runtime.test.ts > ... > RT2: ...
src/provider-reasoning-continuity-runtime.test.ts > ... > RT6: ...
src/provider-reasoning-continuity-runtime.test.ts > ... > RT8: ...
```

**ZERO new failures; the three witness cases move RED -> GREEN.**

## 4. P0-2 — reasoning block identity

**Result: `BLOCK_IDENTITY_RED = REPRODUCED`,
`BLOCK_IDENTITY_LOSS_BOUNDARY = IDENTIFIED`,
`BLOCK_IDENTITY_NECESSITY = PROVEN`, `BLOCK_IDENTITY_GREEN = PASS`,
`MULTI_BLOCK_PRODUCTION_DEFECT = REPRODUCED`**

### 4.1 The RED, through the REAL runtime

```
AssertionError: expected [ { type: 'thinking', …(2) } ] to deeply equal
                 [ { type: 'thinking', …(2) }, …(1) ]

-  { "signature": "synthetic-opaque-signature-aa11bb22",
-   "thinking": "SYNTHETIC-REASONING-A",
-   "type": "thinking" },
   { "signature": "synthetic-opaque-signature-cc33dd44",
-   "thinking": "SYNTHETIC-REASONING-B",
+   "thinking": "SYNTHETIC-REASONING-ASYNTHETIC-REASONING-B",
    "type": "thinking" },
```

Two independently signed thinking blocks were MERGED, and only the LAST
signature survived.

### 4.2 The loss boundary (measured)

| Boundary | Expected | Observed | Disposition |
|---|---|---|---|
| Raw response | 2 distinct signed thinking blocks + a tool call | 2 `thinking` content blocks, each with its own `signature_delta` | PASS |
| SDK stream | distinct block identity per reasoning part | `reasoning-delta` parts carry `id` ("0", "1") = the provider content-block index | PASS |
| Translator | the block identity survives | the `id` was DROPPED: the translator emitted `reasoning-delta` with only `text` + `metadata` | **FAIL — THE LOSS** |
| Runtime accumulation | one reasoning part per provider block | every reasoning delta merged into the trailing part | FAIL (inherited) |
| Outbound conversion | one `thinking` block per reasoning part | one merged `thinking` block carrying one signature | FAIL (inherited) |
| HTTP request | 2 distinct `thinking` blocks | 1 merged block, 1 signature | **FAIL** |

**`BLOCK_IDENTITY_LOSS_BOUNDARY` = the translator's reasoning branch
(`sdk/packages/llms/src/providers/ai-sdk.ts`), which did not propagate the
AI SDK's reasoning-part identifier.**

### 4.3 The bounded repair

Three changes, all using EXISTING mechanisms:

1. **`sdk/packages/shared/src/agent.ts`** — the transient
   `AgentModelEvent["reasoning-delta"]` gains an OPTIONAL `blockId`. It is
   a stream-event field, NOT a persistent schema field and NOT a new event
   protocol.

2. **`sdk/packages/llms/src/providers/ai-sdk.ts`** — the translator forwards
   the AI SDK's existing reasoning-part id (`part.id`, the provider's
   content-block index) as `blockId`.

3. **`sdk/packages/agents/src/agent-runtime.ts`** — the runtime starts a
   NEW reasoning part when the block identity changes. The identity is
   tracked in a local variable, deliberately OUTSIDE the reasoning part's
   metadata bag (that bag is provider-owned and must not receive a
   ClineMM-internal field).

When `blockId` is absent the previous merge behaviour is kept, so a provider
that does not expose block identity is unaffected.

### 4.4 Necessity (ablation)

**Ablation D** — the runtime ignores `blockId` (the predecessor's translator
repair retained):

```
✓ RT1: replays the provider's signed reasoning, tool call and tool result ...
× RT2: keeps TWO signed thinking blocks distinct, in order, each with its OWN signature
✓ ... (all other cases GREEN)
```

RED restored. **`BLOCK_IDENTITY_NECESSITY = PROVEN`**

## 5. The same-adapter provider-origin boundary (a newly reachable P0)

**Result: `SAME_ADAPTER_ORIGIN_CONSERVATION = PASS`**

### 5.1 The RED

The native Anthropic endpoint's opaque signature was replayed to the MiniMax
endpoint, which uses the SAME Anthropic adapter:

```json
{"role":"assistant","content":[
  {"type":"thinking","thinking":"SYNTHETIC-REASONING-A",
   "signature":"synthetic-opaque-signature-aa11bb22"},
  {"type":"tool_use","id":"toolu_synthetic_0001", ...}]}
```

The adapter cannot distinguish the two endpoints, so the request construction
must. This is a **confidentiality / trust-boundary violation**: one
endpoint's opaque provider metadata is disclosed to another.

### 5.2 The bounded repair

- The issuing provider is recorded WITH the opaque payload when it is
  extracted (`extractReasoningMetadata(part, request.providerId)`), under a
  ClineMM-owned key `__clineReasoningOrigin`.
- The outbound conversion (`toAiSdkMessages`) withholds the opaque payload
  when the recorded origin differs from the request's provider. The
  reasoning TEXT is preserved — it is not opaque.
- When the origin is UNKNOWN, the payload is replayed: absence of origin
  information is not evidence of a cross-origin replay, and dropping it
  would silently lose a provider-required signature.
- The key is READ ONLY by the outbound conversion and is never forwarded:
  the witness asserts `expect(JSON.stringify(calls[1])).not.toContain("__clineReasoningOrigin")`.

### 5.3 Necessity (ablation)

**Ablation E** — the origin boundary is disabled:

```
✓ RT1 ... ✓ RT2 ... ✓ RT3 ... ✓ RT4 ... ✓ RT5 ... ✓ RT6
× RT8: a native Anthropic signature does not cross into a MiniMax-origin request
```

RED restored, everything else GREEN. **Necessary.**

## 6. A2 — the tool-call metadata scope is conserved

**Result: `TOOL_CALL_METADATA_SCOPE = CONSERVED`,
`RECOVERABLE_TOOL_ERROR_METADATA_SCOPE = CONSERVED`**

The predecessor's repair broadened `extractGoogleThoughtMetadata()` into
`extractReasoningMetadata()` and then called the BROADENED extractor from
the tool-call path and the recoverable-tool-error path. That broadening is
not necessary for the demonstrated reasoning defect.

This correction splits the extractor:

| Function | Scope | Used by |
|---|---|---|
| `extractGoogleThoughtMetadata()` | Google/Vertex `thoughtSignature` ONLY (the ORIGINAL scope) | the tool-call path, the recoverable-tool-error path |
| `extractReasoningMetadata()` | the Anthropic `signature` / `redactedData` PLUS the composed Google/Vertex scope | the REASONING path ONLY |

The Google/Vertex extraction is COMPOSED into the reasoning extractor rather
than re-implemented, so the two cannot drift apart.

`RT4` asserts the conservation on the wire: the `tool_use` block carries no
reasoning metadata.

## 7. A3 — empty signed thinking conservation

**Result: `EMPTY_SIGNED_REASONING_CONSERVATION = PASS`**

An empty signed thinking block is CONTRACT-VALID: the Anthropic Messages
schema types `thinking` as `z.string()` (empty allowed) and the signature
arrives through the separate `signature_delta` event.

RT3 asserts, through the real runtime:

```typescript
expect(thinking).toEqual([
    { type: "thinking", thinking: "", signature: SIGNATURE_A },
]);
expect(executions).toEqual([TOOL_NAME]);   // no extra tool executions
expect(calls).toHaveLength(2);             // no extra inference rounds
```

- the block is NOT discarded for having empty text,
- NO placeholder text is fabricated (`thinking` is exactly `""`),
- the signature is NOT associated with another reasoning block,
- no extra tool execution and no extra inference round.

## 8. A4 — the reasoning-effort investigation is closed

**Result: `MINIMAX_LOW_BASELINE_WIRE_EFFORT = CORRECT`,
`MINIMAX_LOW_EFFORT_REPAIR_REQUIRED = NO`,
`MINIMAX_LOW_EFFORT_PRODUCTION_DELTA = NONE`,
`MINIMAX_LOW_RUNTIME_WIRE_CONSERVATION = PASS`,
`HISTORICAL_INSTALLED_UI_TO_WIRE_CORRELATION = UNKNOWN`**

RT5 asserts, on EVERY captured MiniMax request of the real-runtime
continuation:

```typescript
for (const body of calls) {
    expect(body.output_config).toMatchObject({ effort: "low" });
}
```

No model catalog, default, reasoning budget or effort mapping was
modified.

`HISTORICAL_INSTALLED_UI_TO_WIRE_CORRELATION = UNKNOWN` — no genuine
installed-build evidence is available, and no paid inference was initiated
to manufacture it.

## 9. The corrected conservation oracles

### R3 — exact ordered equality

The gateway-level R3 case previously asserted
`expect(thinking.length).toBeGreaterThanOrEqual(1)` plus signature
membership. That oracle ACCEPTED a merged block — the defect itself. When
it was replaced with exact ordered equality it FAILED, which is how the
gap was confirmed.

Because a gateway-level case cannot reach the PRODUCTION accumulation, the
case was **consolidated into the real-runtime witness** (RT2 / RT6), which
asserts the same invariant at the real seam. The gateway-level R3 case was
removed rather than duplicated.

The corrected oracle rejects: a merged A+B block carrying signature B, a
merged A+B block carrying signature A, swapped signatures, a missing block,
a duplicate block and a reordered pair.

### R9 — the production codec and the production restore

The predecessor's R9 used a generic JSON round trip, which is NOT session
restoration. It was removed and replaced by:

**File:** `sdk/packages/core/src/runtime/config/provider-reasoning-session-restore.test.ts`

```
agentMessageToMessageWithMetadata  (the PRODUCTION persistence codec)
messagesToAgentMessages            (the PRODUCTION restoration codec)
AgentRuntime.restore(messages)     (the PRODUCTION restore)
```

followed by a REAL runtime continuation, so the restored signature is
observed on the actual outbound HTTP request.

**Result: `PRODUCTION_CODEC_ROUNDTRIP = PASS`, `SESSION_RESTORE = PASS`**

### R15 — compaction

The predecessor's R15 exercised a retained part, not the production
compaction path. The claim is now narrowed explicitly:

```
RETAINED_PART_SERIALIZATION = PASS
PRODUCTION_COMPACTION        = NOT_EXECUTED
```

The production compaction retention seam lives in `@cline/core`'s context
extension, which is a separate subsystem and is deliberately NOT rewritten
or driven by this ACT.

## 10. The MiniMax contract clarification

The MiniMax Create Message API documents thinking content blocks, thinking
signatures, separate `signature_delta` streaming events, and preservation of
signatures in subsequent requests. The MiniMax tool-use guide requires
preserving complete assistant content.

```
MINIMAX_SIGNED_CONTRACT   = VERIFIED
MINIMAX_UNSIGNED_CONTRACT = UNESTABLISHED
```

R5 (the llms-level case) is kept as an **SDK-behaviour characterization**,
NOT a provider-contract qualification: it records that the Anthropic
serializer drops an unsigned thinking block, and that ClineMM fabricates no
signature to replace it. It does NOT establish that unsigned MiniMax
reasoning may be dropped.

## 11. The redacted-thinking disposition is unchanged

```
REDACTED_REASONING_DISPOSITION = DISTINCT_PRE_EXISTING_DEFECT
  (successor ACT recommended: ACT-CLINEMM-PROVIDER-REDACTED-REASONING-REPLAY-01)
```

The block-identity correction does NOT cover the redacted-thinking path: a
redacted block arrives as a `reasoning-start` part with no text delta, so it
still produces no runtime event. It is NOT silently claimed as supported.

## 12. Executable verification

All commands were run in the isolated worktree
`.worktrees/act-pr-p0-01`.

| # | Command | Exit | Result |
|---|---|---|---|
| V1 | `cd sdk/packages/agents && bun x vitest run src/provider-reasoning-continuity-runtime.test.ts` | 0 | **7/7 passed** |
| V2 | `cd sdk/packages/core && bun x vitest run src/runtime/config/provider-reasoning-session-restore.test.ts src/runtime/config/agent-message-codec.test.ts` | 0 | **11/11 passed** |
| V3 | `cd sdk/packages/llms && bun x vitest run src/providers/routing/` | 0 | **15 files, 236/236 passed** |
| V4 | `cd sdk/packages/llms && bun x vitest run src/providers/gateway.test.ts src/providers/ai-sdk.test.ts src/providers/ai-sdk.tool-calls.test.ts src/providers/ai-sdk-transport-continuation.test.ts` | 0 | **4 files, 245/245 passed** |
| V5 | `cd sdk/packages/agents && bun x vitest run` (ordinary package gate) | 1 | 44 failed / 569 passed — **0 NEW** vs the 47-failure baseline; the 3 witness cases moved RED -> GREEN |
| V6 | `cd sdk/packages/llms && bun x vitest run` (ordinary package gate) | 1 | 15 failed / 1189 passed — the **same 15 identities** as the pristine baseline |
| V7 | `cd sdk/packages/core && bun x vitest run src/runtime/config/` | 0 | 4 files, 36/36 passed |
| V8 | `node …/tsc -p tsconfig.dev.json --noEmit` in `shared` / `llms` / `agents` / `core` | — | llms clean; agents/core: **ZERO NEW diagnostics** vs baseline (diff of sorted diagnostic sets is empty) |
| V9 | `node …/@biomejs/biome/bin/biome check --diagnostic-level=error <changed files>` | 0 | no findings |

### 12.1 The remaining baseline failures

The `@cline/llms` ordinary gate fails on **15** tests in
`src/providers/ai-sdk-reasoning.test.ts` (`resolvePortableReasoning`). The
SAME 15 test identities fail on the pristine baseline (verified by
reverting the production files and re-running). They are PRE-EXISTING and
ACT-owned by neither.

The `@cline/agents` ordinary gate fails on **44** tests across 11 files on
the corrected source and on **47** across the same files on the pristine
baseline. The failure-IDENTITY comparison shows:

- **zero** failures present in the corrected run but absent from the
  baseline,
- **three** failures present in the baseline but absent from the corrected
  run — the three new witness cases RT2 / RT6 / RT8.

`ACT_OWNED_DIAGNOSTICS = NONE`

### 12.2 Secret scanning

The gitleaks binary is NOT installed in this environment, so the
repository's secret-scanning gate was **NOT EXECUTED**. The fixtures were
reviewed by hand: every value is clearly artificial and non-secret
(`synthetic-opaque-signature-aa11bb22`, `synthetic-opaque-signature-cc33dd44`,
`SYNTHETIC-REASONING-A`, `SYNTHETIC-PROMPT`, `SYNTHETIC-TOOL-RESULT-OK`,
`test-key`). No reasoning content, prompt, credential, request header or
private tool output is present.

## 13. The bounded production correction

```
git diff 1d45a8d845eca27bce311949a08fca7868f211cd HEAD \
  -- sdk/packages/llms/src/providers/ai-sdk.ts
```

| File | Change |
|---|---|
| `sdk/packages/llms/src/providers/ai-sdk.ts` | predecessor's signature extraction + metadata-only forwarding (PRESERVED); the Anthropic extraction is confined to the REASONING path (A2); the provider's reasoning block id is propagated (P0-2); the opaque payload's ORIGIN is recorded and checked at the outbound boundary (the origin violation) |
| `sdk/packages/agents/src/agent-runtime.ts` | a new reasoning part starts when the provider's reasoning block identity changes (P0-2) |
| `sdk/packages/shared/src/agent.ts` | the transient `reasoning-delta` event gains an optional `blockId` (P0-2) |
| `sdk/packages/agents/vitest.config.ts` | source aliases for `@cline/llms` / `@cline/shared` (test infrastructure) |
| `sdk/packages/core/vitest.config.ts` | source aliases for `@cline/agents` / `@cline/llms` / `@cline/shared` (test infrastructure) |

No provider registry, transport, model catalog, reasoning default, effort
mapping, compaction or PCK subsystem was modified. No new runtime
dependency was introduced.
