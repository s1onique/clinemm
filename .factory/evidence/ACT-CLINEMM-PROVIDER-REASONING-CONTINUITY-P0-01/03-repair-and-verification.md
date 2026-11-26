# 03 — Repair, regression controls and executable verification

---

## 1. The repair

**One production file changed:**
`sdk/packages/llms/src/providers/ai-sdk.ts` (+77 / -7).

### 1.1 Change A — carry the Anthropic reasoning metadata

`extractGoogleThoughtMetadata` became `extractReasoningMetadata`. The
Google/Vertex extraction is UNCHANGED; the Anthropic bucket was ADDED:

```ts
const anthropicMetadata =
    providerMetadata?.anthropic &&
    typeof providerMetadata.anthropic === "object"
        ? (providerMetadata.anthropic as Record<string, unknown>)
        : undefined;

if (
    typeof metadata.signature !== "string" &&
    typeof anthropicMetadata?.signature === "string"
) {
    metadata.signature = anthropicMetadata.signature;
}
if (
    typeof metadata.redactedData !== "string" &&
    typeof anthropicMetadata?.redactedData === "string"
) {
    metadata.redactedData = anthropicMetadata.redactedData;
}
```

The metadata is carried VERBATIM under the SAME key names the outbound
conversion already reads (`metadata.signature` / `metadata.redactedData` in
`toAiSdkMessages`), so the round trip needs NO provider-specific branch at
the send boundary and NO change to the outbound conversion.

The two other call sites of the renamed function (the tool-call metadata
builder and the recoverable-tool-error metadata builder) keep their existing
behaviour; the Google/Vertex `thoughtSignature` path is byte-identical.

### 1.2 Change B — do not drop a metadata-bearing reasoning event

```ts
const metadata = extractReasoningMetadata(part);
if (text || metadata) {
    if (text) {
        sawVisibleContent = true;
    }
    yield {
        type: "reasoning-delta",
        text,
        metadata,
    };
}
```

A reasoning event that carries provider metadata is FORWARDED even when its
text is empty. An event with neither text nor metadata remains a no-op, so
the default path is unchanged for every provider that does not use this
shape.

`part.delta` was added to the text-reading chain because the resolved
provider SDK's `reasoning-delta` part carries the text in `delta`.

### 1.3 What was NOT changed

- Reasoning replay was NOT globally disabled.
- Signature validation was NOT globally bypassed.
- NO signature is fabricated; NO placeholder reasoning is inserted.
- Reasoning is NOT converted into ordinary assistant text.
- The warning is NOT suppressed — it disappears because its CAUSE is gone.
- The provider registry, the MiniMax transport and the AI SDK dependency
  tree are untouched.
- NO permanent protocol field was added for diagnostics.
- NO general reasoning compatibility framework was introduced.
- NO unrelated provider was refactored.
- Factory, PCK and compaction architecture are untouched.

### 1.4 Performance conservation

| Invariant | Evidence |
|---|---|
| No additional provider requests | The repair adds no request; the request count in the RED/GREEN tests is identical (1 per turn). |
| No additional tool calls | The tool-call event count is unchanged. |
| No additional inference rounds | The R10 control shows the same number of rounds before and after. |
| No unbounded metadata accumulation | The metadata is a fixed set of provider-owned string fields carried on the existing reasoning part; it does not grow. |
| No duplicate reasoning blocks | R15 asserts exactly ONE `thinking` block on the wire. |
| No new permanent logging | The repair adds no log statement, no metric and no counter. |
| No new runtime dependencies | The change uses only existing types and existing seams. |

## 2. Regression and adversarial controls

| ID | Case | File / test | Result |
|---|---|---|---|
| R1 | MiniMax reasoning → tool call → result → next request | `minimax-reasoning-continuity-p0-01.test.ts` R1 | **PASS** — the `thinking` block with the exact signature reaches the wire; the tool-call id and the tool-result id are conserved and not duplicated |
| R2 | Signature-only reasoning event | `minimax-reasoning-conservation-p0-01.test.ts` R2 | **PASS** — the signature survives |
| R3 | Multiple reasoning blocks | `minimax-reasoning-conservation-p0-01.test.ts` R3 | **PASS** — no cross-association: each translator event carries its OWN block's signature, in order |
| R4 | Multiple reasoning text deltas | `minimax-reasoning-conservation-p0-01.test.ts` R4 | **PASS** — the exact concatenated text is preserved |
| R5 | Legitimately unsigned MiniMax reasoning | `minimax-reasoning-conservation-p0-01.test.ts` R5 | **PASS** — provider-valid behaviour; no signature invented |
| R6 | Native Anthropic signed reasoning | `minimax-reasoning-origins-p0-01.test.ts` R6 | **PASS** — the signature is unchanged |
| R7 | Native Anthropic unsupported unsigned reasoning | `minimax-reasoning-origins-p0-01.test.ts` R7 | **PASS** — the existing safe behaviour is conserved |
| R8 | Provider-origin mismatch | `minimax-reasoning-origins-p0-01.test.ts` R8 | **PASS** — an Anthropic signature is NOT disclosed to an OpenAI-compatible endpoint |
| R9 | Session persistence and restoration | `minimax-reasoning-neighbours-p0-01.test.ts` R9 | **PASS** — the signature survives a JSON persistence round trip and reaches the wire after restoration |
| R10 | Multiple consecutive tool-call rounds | `minimax-reasoning-conservation-p0-01.test.ts` R10 | **PASS** — each round's reasoning and signature survive; both rounds' tool-call ids and tool-result ids are conserved and not duplicated |
| R11 | Google/Vertex thought metadata | `minimax-reasoning-neighbours-p0-01.test.ts` R11 + the EXISTING `src/providers/gateway.test.ts` | **PASS** — the Vertex/Google `thoughtSignature` extraction and replay tests pass unchanged (183/183) |
| R12 | Unaffected OpenAI-compatible provider | `minimax-reasoning-neighbours-p0-01.test.ts` R12 | **PASS** — no thinking block and no Anthropic metadata introduced |
| R13 | Warning suppression without repair | `minimax-reasoning-continuity-p0-01.test.ts` + ablation A | **PASS** — the warning was never suppressed; reverting the repair restores both the warning and the failure |
| R14 | Redacted reasoning | `minimax-reasoning-conservation-p0-01.test.ts` R14 | **CHARACTERISED** — see section 3 |
| R15 | Compaction interaction | `minimax-reasoning-neighbours-p0-01.test.ts` R15 | **PASS** — a retained signed reasoning part stays protocol-valid, with exactly one `thinking` block and no duplication |

### 2.1 Exactness

The assertions are exact equality, not counts: the reasoning text is compared
to the exact synthetic string, the signature to the exact synthetic value,
the tool-call id and the tool-result id to the exact ids, and the ORDER of
the reasoning blocks is asserted. `R5` asserts the ABSENCE of a `signature`
key, and `R8`/`R12` assert the absence of the signature string in the
serialized body.

## 3. R14 — redacted reasoning: a DISTINCT, PRE-EXISTING defect

The Anthropic SDK surfaces a redacted thinking block as a `reasoning-START`
part carrying `providerMetadata.anthropic.redactedData` and NO text delta.
The ClineMM translator reads the text of `reasoning-delta` / `reasoning`
parts, so a `reasoning-start` part produces NO runtime event at all.

This behaviour was MEASURED to be IDENTICAL before and after this ACT's
repair (the baseline run and the repaired run both produce zero reasoning
events for a redacted-only turn). It is therefore:

- **NOT caused by** this repair,
- **NOT repaired by** this repair,
- a **distinct defect** that must not be concealed by narrowing this ACT's
  claim.

A redacted thinking block is consequently NOT replayed on the wire, and the
provider-owned redacted payload is not fabricated into the request.

**Recommendation:** a successor ACT should make the translator handle the
`reasoning-start` part's `providerMetadata.anthropic.redactedData` so the
redacted-thinking block can be replayed as an Anthropic
`redacted_thinking` block. This ACT deliberately does not implement that —
it is a separate change with its own contract.

`REDACTED_REASONING_DISPOSITION = DISTINCT_PRE_EXISTING_DEFECT — successor ACT recommended`

## 4. Compaction disposition

The compaction path does not treat reasoning parts specially; it retains or
replaces them as ordinary message content. The repair does not touch the
compaction path, and R15 establishes that a compaction-retained reasoning
part remains protocol-valid on the wire (exactly one `thinking` block, the
signature intact, no duplication).

`COMPACTION_DISPOSITION = CONSERVED — existing behaviour retained, no compaction architecture touched`

## 5. The reasoning-effort discriminator (section 10)

The selected configuration is `minimax:MiniMax-M3.1-Flash:Low`. The
Anthropic-compatible transport serialises the effort as
`output_config.effort`. Captured from the REAL serialized body in the RED
run:

```json
{"model":"MiniMax-M3.1-Flash","max_tokens":157286,
 "thinking":{"type":"adaptive"},"output_config":{"effort":"low"}, …}
```

`output_config.effort === "low"` — the requested Low effort IS emitted
correctly.

This is INDEPENDENTLY established by the EXISTING repository test
`src/providers/routing/minimax-m31-exact-id-wire01.test.ts` (R2 "the
requested low effort reaches the serialized request body", R4 "the lower-case
M3.1 IDs keep their serialized low effort"), which passes unchanged.

**`MINIMAX_LOW_WIRE_EFFORT = CORRECT`**

No reasoning-effort configuration defect was found, so no successor ACT is
recommended on that axis and no reasoning defaults or model-catalog
behaviour were changed by this ACT.

## 6. Executable verification

All commands were run inside the isolated worktree.

| # | Command | Exit | Elapsed | Result |
|---|---|---|---|---|
| V1 | `cd sdk/packages/llms && bun x vitest run src/providers/routing/minimax-reasoning-continuity-p0-01.test.ts` | 1 → 0 | ~3 s | RED → GREEN |
| V2 | `cd sdk/packages/llms && bun x vitest run src/providers/routing/minimax-reasoning-boundary-p0-01.test.ts` | 0 | ~3 s | 1/1 passed |
| V3 | `cd sdk/packages/llms && bun x vitest run src/providers/routing/minimax-reasoning-conservation-p0-01.test.ts` | 0 | ~3 s | 6/6 passed |
| V4 | `cd sdk/packages/llms && bun x vitest run src/providers/routing/minimax-reasoning-origins-p0-01.test.ts` | 0 | ~2 s | 3/3 passed |
| V5 | `cd sdk/packages/llms && bun x vitest run src/providers/routing/minimax-reasoning-neighbours-p0-01.test.ts` | 0 | ~2 s | 4/4 passed |
| V6 | `cd sdk/packages/llms && bun x vitest run src/providers/routing/` (focused regression gate) | 0 | ~9 s | **15 files, 238/238 passed** |
| V7 | `cd sdk/packages/llms && bun x vitest run src/providers/gateway.test.ts` (existing provider regression) | 0 | ~8 s | **183/183 passed** |
| V8 | `cd sdk/packages/llms && node …/typescript/bin/tsc -p tsconfig.dev.json --noEmit` (affected package typecheck) | 0 | ~35 s | no diagnostics |
| V9 | `node …/@biomejs/biome/bin/biome check --diagnostic-level=error <changed files>` (lint/format) | 0 | ~0.03 s | no findings |
| V10 | `cd sdk/packages/llms && bun x vitest run` (ordinary package gate) | 1 | ~9 s | **1189 passed, 17 failed (3 files)** — see section 6.1 |

### 6.1 The 17 failures in V10 are PRE-EXISTING, not ACT-owned

The same 17 failures occur on the pristine baseline (`ai-sdk.ts` reverted,
nothing else changed):

```
=== BASELINE (pristine ai-sdk.ts) ===
❯ src/providers/ai-sdk-reasoning.test.ts
❯ src/providers/vendors/community.process-hygiene.test.ts
❯ src/providers/vendors/community.process-hygiene-failure.test.ts
 Test Files  3 failed (3)
      Tests  17 failed | 18 passed (35)
```

The failing suites are `resolvePortableReasoning` (a portable-reasoning
normalisation suite) and the SAP provider process-hygiene suites. Neither
touches the reasoning-metadata translation path. They fail identically with
and without this ACT's change.

`ACT_OWNED_DIAGNOSTICS = NONE`

## 7. Secret scanning

The new fixtures contain only clearly artificial, non-secret values:
`synthetic-opaque-signature-aa11bb22`, `synthetic-signature-a-1111`,
`synthetic-signature-b-2222`, `synthetic-redacted-a-3333`,
`synthetic-thought-signature-dddd`, `SYNTHETIC-REASONING-*`,
`SYNTHETIC-PROMPT`, `SYNTHETIC-RESULT`, `test-key`. No real reasoning, no
real signature, no prompt, no credential and no private tool output is
present in the repository.

The repository's secret-scanning configuration is `.gitleaks.toml`. It was
NOT run as a repository-wide gate in this environment (it requires the
gitleaks binary, which is not installed here); the fixtures were instead
reviewed by hand against the gitleaks rules and contain no credential-shaped
values.

## 8. Changed files

| File | Kind | Diffstat |
|---|---|---|
| `sdk/packages/llms/src/providers/ai-sdk.ts` | production | +77 / -7 |
| `sdk/packages/llms/src/providers/routing/minimax-reasoning-continuity-p0-01.test.ts` | test (new) | R1 RED/GREEN |
| `sdk/packages/llms/src/providers/routing/minimax-reasoning-boundary-p0-01.test.ts` | test (new) | boundary discriminator |
| `sdk/packages/llms/src/providers/routing/minimax-reasoning-conservation-p0-01.test.ts` | test (new) | R2, R3, R4, R5, R10, R14 |
| `sdk/packages/llms/src/providers/routing/minimax-reasoning-origins-p0-01.test.ts` | test (new) | R6, R7, R8 |
| `sdk/packages/llms/src/providers/routing/minimax-reasoning-neighbours-p0-01.test.ts` | test (new) | R9, R11, R12, R15 |
| `.factory/evidence/ACT-CLINEMM-PROVIDER-REASONING-CONTINUITY-P0-01/` | evidence (new) | this package |
