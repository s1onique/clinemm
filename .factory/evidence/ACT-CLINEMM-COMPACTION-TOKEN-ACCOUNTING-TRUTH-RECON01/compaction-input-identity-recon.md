# R0' — COMPACTION INPUT IDENTITY RECON (2026-09-02)

> **Status:** source-recon DONE in this turn. Real-trace specimen
> (HOST_REQUIRED) is sequenced after the recon closes.
>
> **Origin:** factory causal reviewer (2026-09-02 second reordering)
> pivoted away from the UI projection (R0-A witness only) after a new
> LIVE specimen — "Context compacted (manual) · 1M → 72.9k tokens ·
> 1234 → 86 messages" — challenged the upstream denominator itself.
> Operator intuition: the model was not actually carrying ~1M tokens
> of active context.

## The new LIVE specimen

```
Context compacted (manual) · 1M → 72.9k tokens · 1234 → 86 messages
```

The 1M denominator is the upstream value the TaskHeader rescaling reads.
If 1M is the wrong object — e.g., the canonical transcript rather than
the working context — then the UI symptom (7.1k after compaction, or
~9.7k in another specimen) follows from the wrong denominator, not
from the rescaling arithmetic.

## Source recon — manual compaction bridges

### CLI (`/compact`)

`apps/cli/src/runtime/interactive/compaction.ts:99-100` (manual invocation):

```ts
const result = await compact({
  agentId: "cli",
  conversationId: input.sessionId,
  parentAgentId: null,
  iteration: 0,
  messages:    input.messages,
  apiMessages: input.messages,   // <-- SAME as canonical
  abortSignal: input.abortSignal ?? new AbortController().signal,
  systemPrompt: "",
  tools: [],
  ...
})
```

Comment at lines 86-88 (above) makes the design intent explicit:

> "Manual compaction intentionally summarizes the full canonical transcript
> instead of reusing a prior sidecar summary, which avoids summary-of-
> summary drift across repeated `/compact` calls."

So the INTENT is correct — manual compaction should always work on the
full canonical history. But the CONSEQUENCE is that `tokensBefore` (the
size of what was compacted) measures the canonical transcript, not the
working context the model was carrying.

### VSCode (`compactTask()`)

`apps/vscode/src/sdk/sdk-compaction.ts:101-102` (the SDK compaction
bridge for VSCode):

```ts
const result = await compact({
  agentId: "cline-vscode",
  conversationId: input.sessionId,
  parentAgentId: null,
  iteration: 0,
  messages:    input.messages,
  apiMessages: input.messages,   // <-- SAME as canonical
  abortSignal: new AbortController().signal,
  systemPrompt: "",
  tools: [],
  ...
})
```

Same pattern: `apiMessages === messages === canonical`. The
SdkCompactionCoordinator that calls this passes the canonical
transcript it read via `sdkHost.readMessages(sessionId)` at
`sdk-compaction-coordinator.ts:317`.
## Source recon — auto compaction (CONSISTENT path)

`sdk/packages/core/src/runtime/orchestration/session-runtime-orchestrator.ts:1149`:

```ts
const messages = agentMessagesToMessagesWithMetadata(context.messages);
const apiMessages = await this.prepareProviderMessagesForApi(messages);
const result = await prepareTurn({
  agentId: context.agentId,
  conversationId: ...,
  iteration: context.iteration,
  messages,                 // canonical
  apiMessages,              // provider-bound (≠ canonical)
  abortSignal: ...,
  systemPrompt: context.systemPrompt ?? "",
  tools,
  model: ...,
});
```

`prepareProviderMessagesForApi` (line 1192) runs the message through:

```ts
private async prepareProviderMessagesForApi(
  messages: MessageWithMetadata[],
): Promise<MessageWithMetadata[]> {
  let providerMessages = messages;
  const messageBuilders =
    this.contributionRegistry.getRegistrySnapshot().messageBuilder;
  for (const builder of messageBuilders) {
    providerMessages = await builder.build(providerMessages);
  }
  return this.messageBuilder.buildForApi(providerMessages);
}
```

So `apiMessages` for AUTO compaction goes through `buildForApi` and any
registered `messageBuilder` plugins — i.e., the SAME pipeline that
constructs the next provider-bound request (called via
`prepareMessagesForModelRequest` at line 1183).

**Auto compaction is CONSISTENT.** Manual compaction is NOT.

## Source recon — strategy function (where tokensBefore is computed)

`sdk/packages/core/src/extensions/context/compaction.ts:309`:

```ts
const requestInputTokens = estimateRequestInputTokens({
  systemPrompt: context.systemPrompt,
  messages:     context.apiMessages,
  tools:        context.tools,
});
```

This value feeds `tokensBefore` in the compaction metadata. The
estimator is `sdk/packages/shared/src/llms/tokens.ts`:

```ts
export const CHARS_PER_TOKEN = 3;
export function estimateTokens(chars: number): number {
  return Math.max(1, Math.ceil(chars / CHARS_PER_TOKEN));
}
export function estimateRequestInputTokens(request: TokenEstimatedRequest): number {
  ...
  serialized = JSON.stringify({
    systemPrompt: request.systemPrompt,
    messages: request.messages,
    tools: request.tools,
  });
  ...
  return estimateTokens(serialized.length);
}
```

Character-blind estimator with `CHARS_PER_TOKEN = 3`. NO payload-
specific bias. **For ClineMM the 1234-message transcript × ~3 chars/
token ≈ 1M is fully consistent with the local estimator.**

So `tokensBefore ≈ 1M` is the canonical-transcript character count,
NOT the working-context character count. The UI displays it as if it
described the working context the model was carrying.

## Causal split (R0'.A / R0'.B / R0'.C)

### R0'.A — SAME PAYLOAD

`compaction receives M (the working context)` ↔ `next-model working
context before compaction would also be M`. Then
`tokensBefore = estimate(M)` is correct.

→ Applies to AUTO compaction in current code.
→ The 1M case would be a real working-context size.
→ Operator intuition misleading.

### R0'.B — WRONG PROJECTION

`canonical history = H ≠ W = actual model-facing working set`.
`compaction computes tokensBefore = estimate(H)` but UI labels it as
describing `W`.

→ Applies to MANUAL compaction in current code.
→ Operator intuition correct.
→ ROOT_CAUSE_LIKELY at:
  - `apps/cli/src/runtime/interactive/compaction.ts:99-100`
  - `apps/vscode/src/sdk/sdk-compaction.ts:101-102`

### R0'.C — SAME PAYLOAD, BAD ESTIMATOR

`M` is genuinely the model-facing payload but `provider-normalized
input for M ≪ estimate(M)`. Estimator over-counts.

→ Separate code path: `sdk/packages/shared/src/llms/tokens.ts`.
→ Can be ruled in/out only with a real-provider run.

## What this does NOT do

- It does NOT establish that the operator's intuition is correct.
  Source-recon alone confirms the structural asymmetry (manual path
  passes canonical as `apiMessages`; auto path does not). The actual
  semantic defect (operator intuition: `tokensBefore` is wrong by an
  order of magnitude for that specific session) requires a real-trace
  specimen to prove.
- It does NOT decide whether `estimate(canonical)` for a 1234-message
  transcript is correct or whether the real provider's working context
  is smaller. Both are possible.
- It does NOT change production code. This ACT remains read-only.

## What's needed next (HOST_REQUIRED)

A real-trace specimen with:

- (a) A session that has undergone manual `/compact` with a known
  canonical transcript size (e.g., 1234 messages).
- (b) The next provider-bound request's payload, captured before
  send (via `messageBuilder.buildForApi` output).
- (c) The provider's reported `tokensIn` for that request.
- (d) Comparison: `E_before (estimate(canonical))` vs `W_before
  (estimate(buildForApi(canonical)))` vs `P_before (provider tokensIn)`.

If `E_before ≈ W_before ≈ P_before`, the asymmetry is benign
(R0'.A applies, calibration question still open).
If `E_before ≫ W_before ≈ P_before`, R0'.B is proven
(manual compaction is the bug; auto is fine).

## Defect ownership map (current best understanding)

| Path                    | `apiMessages`                          | Defect?             |
|-------------------------|----------------------------------------|---------------------|
| AUTO compaction (orchestrator) | `prepareProviderMessagesForApi(canonical)` (≠ canonical) | CONSISTENT (R0'.A) |
| MANUAL compaction (CLI)  | `canonical` (= `messages`)             | **R0'.B candidate** |
| MANUAL compaction (VSCode SDK bridge) | `canonical` (= `messages`)    | **R0'.B candidate** |

The TaskHeader / shared-metrics layer is NOT at fault for this defect.
It correctly consumes what `tokensBefore` says. The defect lives in
the SDK entry-point bridges that hand canonical to the strategy as
`apiMessages`.

## Classification status

- `CASE_B.MANUAL_PROJECTION` (new) — candidate at the two manual
  entry points. Source-recon bound. Awaits real-trace proof.
- `CASE_B.UI` (R0-A path) — RETIRED 2026-09-02 second reordering
  (R0-B oracle was unfounded).
- `CASE_B.HYBRID` — RETIRED 2026-09-02.

## Downstream repair ACT (named but NOT opened from this ACT)

`ACT-CLINEMM-COMPACTION-INPUT-IDENTITY-REPAIR01` — separate scope,
separate review. Will:

1. Decide whether to:
   - (a) Compute `apiMessages` for manual compaction as
     `prepareProviderMessagesForApi(canonical)` (parity with AUTO
     path; breaks the "summarize full canonical" intent).
   - (b) Compute `tokensBefore` differently for manual compaction
     so the value describes the working context (e.g., the most
     recent `buildForApi` projection cached at compaction time).
   - (c) Tag the manual-compaction `tokensBefore` value with a
     different semantic label so the UI knows it describes canonical
     size, not working-context size.

2. Real-trace proof that the chosen fix produces the three-way
   equality `E_before ≈ W_before ≈ P_before` on a real provider run.

3. Update the TaskHeader to render `tokensBefore` consistently with
   the chosen semantic label.
