# SEMANTIC-CONTRACT RECON of `tokensBefore` (2026-09-02 second review)

> **Status:** code-trace DONE. No real-trace evidence yet.
>
> **Origin:** factory causal reviewer (2026-09-02 second review)
> issued `HALT_ROOT_CAUSE_NOT_ISOLATED` on the previous turn's
> CASE_B.MANUAL_PROJECTION claim. Their critique was correct:
> - The structural asymmetry (manual `apiMessages = canonical`
>   vs. auto `apiMessages = prepareProviderMessagesForApi(canonical)`)
>   is real and durable.
> - But this does NOT by itself prove manual compaction "passes the
>   wrong input." The producer documents `tokensBefore` as "size of
>   what was supplied to compaction," which is a legitimate semantic
>   quantity for the manual intent ("summarize the full canonical
>   transcript").
> - Whether the upstream value is "wrong" depends on what the
>   **consumers** claim it means — which is a semantic-contract
>   question, not a structural-asymmetry question.
>
> **Reviewer's directive:** "Bind `tokensBefore` producer/consumer
> semantic contract. Do R1-R3 NOT yet. Classify as S1 / S2 / S3."
## Producer contract

### Docstring — telemetry schema

`sdk/packages/core/src/services/telemetry/core-events.ts:773`:

```ts
/** Full-request token estimates, in the same units as the trigger and limit. */
tokensBefore: number;
tokensAfter: number;
```

Both the `CaptureCompactionExecutedProperties` (line 776) and
`CaptureCompactionSkippedProperties` (line 816) carry the same
docstring. **The producer's documented contract is "full-request
token estimate, in the same units as the trigger and limit."**

This means:
- `tokensBefore` is an estimate of the **full request** (system
  prompt + messages + tools) that the strategy saw.
- It is on the **same scale as the trigger** (which is
  `maxInputTokens * COMPACTION_TRIGGER_RATIO`, an absolute number
  of provider-context tokens).
- The trigger's scale is set by the model's `contextWindow` /
  `maxInputTokens` — it represents the provider's input budget, not
  the canonical history size.

### All production writes of `tokensBefore`

| File:line | Mode | What it computes | Scale |
|-----------|------|------------------|-------|
| `sdk/packages/core/src/extensions/context/compaction.ts:579` | `manual`/`auto`/`overflow_recovery` `completed` (notice) | `requestInputTokens` = full-request estimate | full-request |
| `sdk/packages/core/src/extensions/context/compaction.ts:592` | `manual`/`auto`/`overflow_recovery` `completed` (telemetry) | `requestInputTokens` | full-request |
| `sdk/packages/core/src/extensions/context/compaction.ts:643` | `manual`/`auto`/`overflow_recovery` `skipped` (telemetry) | `requestInputTokens` | full-request |
| `sdk/packages/core/src/extensions/context/basic-compaction.ts:693` | basic-strategy internal log | `beforeTokens = getTotalTokens(originalMessages)` | **messages-only** (no system/tools) |

The basic-strategy log value (`getTotalTokens(originalMessages)`) is
different from the other three (`requestInputTokens`). However, it
is only written to the strategy's own logger — it does NOT flow
into the `say: "compaction"` JSON, telemetry events, or UI. So it
has no UI consumer. (Documented here for completeness; not a
contract violation because no consumer reads it.)

### Producer intent — what was supplied

For AUTO compaction (`sdk/packages/core/src/runtime/orchestration/session-runtime-orchestrator.ts:1149`):
```ts
const apiMessages = await this.prepareProviderMessagesForApi(messages);
```
- `apiMessages` = `prepareProviderMessagesForApi(canonical)`
- This goes through `buildForApi` and registered `messageBuilder`
  plugins — the **same pipeline as the next provider-bound request**.
- For AUTO, `tokensBefore` ≈ what the provider will see next.

For MANUAL compaction CLI (`apps/cli/src/runtime/interactive/compaction.ts:99-100`):
```ts
apiMessages: input.messages,  // canonical full transcript
```
- Comment at lines 86-88 (above) makes the design intent explicit:
  > "Manual compaction intentionally summarizes the full canonical
  > transcript instead of reusing a prior sidecar summary, which
  > avoids summary-of-summary drift across repeated `/compact`
  > calls."

For MANUAL compaction VSCode (`apps/vscode/src/sdk/sdk-compaction.ts:101-102`):
```ts
apiMessages: input.messages,  // canonical full transcript
```
- Same pattern. Reads from `sdkHost.readMessages(sessionId)` which
  returns the canonical transcript.

**Both manual entry points have the SAME design intent: summarize
the canonical full transcript.** The producer contract per the
intent: `tokensBefore = estimate(input actually summarized)`. This
is **S1 (MATERIAL_BEING_COMPACTED)** for the producer.

### Compactor's internal use of `tokensBefore`

`tokensBefore` is also written to internal log events
(`config.logger?.debug`, `config.logger?.log`) as a diagnostic.
These do not feed any consumer contract.

The compactor's THRESHOLD check (`sdk/packages/core/src/extensions/context/compaction.ts:335`):
```ts
const shouldCompact = requestInputTokens >= requestTriggerTokens;
...
if (effectiveMode === "auto" && !shouldCompact) {
  return undefined;
}
```
The threshold only applies to **auto** mode. Manual mode bypasses
the threshold check (manual always proceeds once invoked). So the
threshold/budget consumer concern is bounded to AUTO, where
`apiMessages = prepareProviderMessagesForApi(canonical)` — same
scale as the trigger and limit. **No S2 contract violation via the
threshold path.**

## Consumer contracts

### UI rescaling — `getApiMetrics.ts`

`apps/vscode/src/shared/getApiMetrics.ts:80-93` (docstring for `getLastApiReqTotalTokens`):

> "A completed compaction divider that postdates the last request
> rescales that request's total by the compaction's
> tokensAfter/tokensBefore ratio, so the context-window bar updates
> immediately instead of waiting for the next request to run. The
> ratio is used rather than tokensAfter itself because the
> compaction counters are the SDK's estimate (chars/4-class), a
> different scale from the provider-reported usage that normally
> drives this value — substituting the estimate would make the bar
> visibly re-snap when the next request's real usage lands. **Both
> counters come from the same estimator, so their ratio is
> scale-free.** Multiple compactions since the last request compound.
> The ratio is deliberately not clamped to 1: compacting a small
> conversation can grow the context (the summary outweighs the
> original messages), and the header must move in the same direction
> as the divider row (e.g. "1k → 1.3k tokens") rather than silently
> show the stale value."

`apps/vscode/src/shared/getApiMetrics.ts:165-167` (docstring for `getLastApiReqContextInputTokens`):

> "The same compaction-ratio rescaling semantics as
> {@link getLastApiReqTotalTokens} apply: completed compaction
> dividers that postdate the last request rescale the context-input
> count by the same `tokensAfter / tokensBefore` ratio so the
> header tracks the divider without waiting for the next request
> to run."

**The consumer (UI rescaling) makes two implicit assumptions:**

1. **The ratio is scale-free.** The ratio between `tokensAfter` and
   `tokensBefore` should be on the SAME scale as the last
   `api_req_started.tokensIn`. The docstring says this holds because
   both compaction counters come from the same estimator.
2. **The ratio describes what happened to the working context.**
   That is, `tokensBefore/tokensAfter` describes the change in
   active provider-bound context. This assumption is implicit; the
   docstring never states it explicitly.

The consumer ASSUMES the producer's `tokensBefore` describes the
working context — i.e., the consumer assumes the producer's contract
is S2.

### UI rendering — `ContextWindow.tsx`

`apps/vscode/webview-ui/src/components/chat/task-header/ContextWindow.tsx:175`:

```tsx
<span className="cursor-pointer text-sm" title="Current tokens used in this request">
  {formatTokenNumber(tokenData.used)}
</span>
```

**The UI explicitly labels the rendered value as "Current tokens
used in this request"** — i.e., active model context. This is the
S2 contract at the rendering layer: the value the user sees is
supposed to describe the model's current input occupancy.

`ChatView.tsx:114-121` provides the same contract:

> "the provider-independent semantic quantity that should drive the
> TaskHeader context-window occupancy bar. Distinct from
> `lastApiReqTotalTokens`, which sums input + output + cache
> activity and is suitable only for cost / activity telemetry, not
> for the bar."

So the contract is firmly **S2 (ACTIVE_PROVIDER_CONTEXT)** at the
UI rendering layer.

### CLI divider rendering — `compaction-status.ts`

`apps/cli/src/tui/utils/compaction-status.ts:80-92`:

```ts
const parts: string[] = [
  entry.compactionMode === "manual"
    ? "Context compacted (manual)"
    : ...
];
if (
  typeof entry.tokensBefore === "number" &&
  typeof entry.tokensAfter === "number"
) {
  parts.push(
    `${formatTokenCount(entry.tokensBefore)} → ${formatTokenCount(entry.tokensAfter)} tokens`,
  );
}
```

The CLI divider label says "Context compacted (manual)" — neutral.
The number is presented as a BEFORE→AFTER divider, not as "current
context" or "active model input." **No S2 contract claim at the CLI
divider rendering layer.** It is neutral display.

### Persisted compaction artifact schema

`sdk/packages/core/src/session/models/session-compaction.ts:25-34`:

```ts
export const SessionCompactionStateSchema = z.object({
  version: z.literal(1),
  updated_at: z.string().datetime(),
  conversation_id: z.string().min(1).optional(),
  source_message_count: z.number().int().nonnegative(),
  source_prefix_hash: z.string().min(1).optional(),
  source_last_message_key: z.string().min(1).optional(),
  messages: z.array(MessageWithMetadataSchema),
  system_prompt: z.string().optional(),
});
```

**The persisted schema has NO `tokensBefore` field.** It only
stores the compacted messages + projection metadata. Token counters
live ONLY in the transient `say: "compaction"` JSON stream and
telemetry events.

This is significant: there is no persisted source-of-truth for
`tokensBefore` semantics. The wire contract is defined only by the
ephemeral JSON stream + telemetry schema + producer/consumer
docstrings.

### Telemetry consumers — `core-events.ts`

Telemetry events `task.compaction_executed` and
`task.compaction_skipped` carry `tokensBefore`. The docstring at
line 773 says "Full-request token estimates, in the same units as
the trigger and limit" — i.e., the telemetry contract matches the
producer contract: S1.

Telemetry is not a "consumer" in the live-UI sense — it is internal
analytics. The telemetry schema should NOT be expected to align
with the UI contract.

### Threshold/budget consumers

The ONLY threshold/budget consumer of `tokensBefore` is the compactor
itself, at `compaction.ts:335`:
```ts
const shouldCompact = requestInputTokens >= requestTriggerTokens;
```

But this check only runs for **auto** mode (gated by line 362:
`if (effectiveMode === "auto" && !shouldCompact) return undefined;`).
For manual mode, the threshold is bypassed.

For auto mode, `apiMessages = prepareProviderMessagesForApi(canonical)`
— same scale as the trigger. So the threshold comparison is on the
S2 scale (active provider context), not S1.

**Threshold/budget consumer concern: bounded to auto mode; S2-aligned.**

## Existing tests asserting semantics

| File:line | Asserts |
|-----------|---------|
| `sdk/packages/core/src/extensions/context/compaction.test.ts:4447` | `expect(props.tokensBefore).toBe(requestInputTokens)` — producer contract |
| `sdk/packages/core/src/extensions/context/compaction.test.ts:4193-4198` | `tokensBefore` and `tokensAfter` are numbers; `tokensSaved = tokensBefore - tokensAfter` |
| `apps/vscode/src/shared/__tests__/getApiMetrics.test.ts` | `tokensBefore`/`tokensAfter` ratio is multiplied to `lastRequestInput`. **No test distinguishes manual vs auto mode for rescaling.** |

The existing test suite is INCONSISTENT with the consumer's
implicit S2 assumption for MANUAL mode: the same rescaling formula
is applied regardless of `mode: "manual"` or `mode: "auto"`. This
gap is itself part of the S3 issue.

## Causal split (S1 / S2 / S3)

### S1 — MATERIAL_BEING_COMPACTED

- **Producer contract:** `tokensBefore = estimate(input actually
  summarized)`. Documented at core-events.ts:773 ("what was supplied
  to compaction").
- **For manual compaction:** canonical H is the correct input to
  summarize (per the explicit "intentionally summarizes the full
  canonical transcript" comment).
- **For auto compaction:** provider-projected W is the correct input.
- **Different modes legitimately measure different objects.**
- **UI contract claim:** "Current tokens used in this request"
  (ContextWindow.tsx:175) is IMPLICIT but never directly tested.
- **Defect (if any):** SEMANTIC_LABEL / PRESENTATION. The UI displays
  a number labeled "current context" that for manual compaction
  describes canonical H, not active W. The user reasonably interprets
  it as W because the title says "current context."

### S2 — ACTIVE_PROVIDER_CONTEXT

- **Producer contract:** `tokensBefore = estimate(provider-bound
  working context)`. Required for the UI rescaling to make sense.
- **For manual compaction:** canonical H ≠ W. Producer is wrong
  structurally.
- **For auto compaction:** provider-projected W ≈ W. Producer is right.
- **Defect:** manual compaction entry points (CLI + VSCode SDK
  bridge) MUST pass `apiMessages = prepareProviderMessagesForApi(canonical)`
  instead of `apiMessages = canonical`. But this would BREAK the
  explicit "intentionally summarizes the full canonical transcript"
  invariant — manual compaction would no longer be able to
  summarize the canonical history because `buildForApi` would have
  applied truncation/sidecar logic before the compactor sees it.

### S3 — OVERLOADED_FIELD

- **Producer contract (S1):** `tokensBefore` = "what was supplied
  to compaction" (documented).
- **Consumer contract (S2):** UI treats `tokensBefore` as "active
  provider context" (implicit; rendered with "Current tokens used
  in this request" title).
- **Both contracts are "correct" within their own layer.**
- **Defect:** AMBIGUOUS_WIRE_CONTRACT. The producer doesn't tag
  the field with its semantic kind; the consumer doesn't know
  which scale the producer used.
- **Repair:** split/tag the metric (e.g., add a `kind` field
  distinguishing "input_to_compaction" vs "active_provider_context")
  rather than silently normalizing one producer to another.

## Current best classification: S3 (with strong S1 lean)

The producer's contract is **S1 (MATERIAL_BEING_COMPACTED)**, and
the documentation explicitly says so. The consumer's contract is
**S2 (ACTIVE_PROVIDER_CONTEXT)**, and the rendering explicitly says
so. The producer-side evidence (manual compaction intentionally
summarizes canonical) is consistent with S1, NOT S2.

The **S2 hypothesis** ("manual compaction passes the wrong input")
would require:
- (a) The producer to claim its contract is S2 (it doesn't —
  docstring says S1).
- (b) The architecture to disallow canonical-H inputs to manual
  compaction (it doesn't — manual mode is the path for "summarize
  the full canonical transcript").
- (c) The S1 contract to be invalid (it isn't — the producer
  documents exactly what it computes).

The **S3 hypothesis** is the actual classification: the wire
contract is overloaded, and the consumer assumes the producer's
contract matches its own. Both contracts are valid; the gap is in
the wire.

## Repair options (for S3, NOT S2)

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| **(a) Tag the field** | Producer emits `tokensBefore` + `tokensBeforeKind` ("input_to_compaction" / "active_provider_context"). Consumer uses ratio only when kind matches its assumed scale. | Preserves both contracts; explicit; small wire change; producer docstring unchanged in spirit. | Requires touching the producer (adds `kind` field to schema and JSON) and the consumer (read the kind). |
| **(b) Split into two fields** | Producer emits `compactionInputTokensBefore` AND `activeContextTokensBefore` as distinct fields. UI uses only `activeContextTokensBefore`. | Explicit; no implicit contract; clean separation. | Producer must compute both; redundant writes; bigger schema change. |
| **(c) Producer-side harmonization** (RETRACTED) | For manual compaction, producer computes `tokensBefore = estimate(buildForApi(canonical))`. | Symmetry with auto path. | **Breaks the explicit full-canonical manual-compaction invariant.** The reviewer correctly flagged this as an unsafe premise. |
| **(d) Consumer-side reconciliation** | UI reads `tokensBefore`/`tokensAfter` ONLY when it can prove the producer used the working-context scale (e.g., only for auto mode). For manual mode, UI displays a neutral "compacted; X → Y tokens" divider WITHOUT rescaling `tokensIn`. | Preserves producer contract; UI stops assuming scale. | Loses the "bar updates immediately" benefit for manual compactions. |

The most likely correct repair is **option (a) Tag the field** —
the producer documents its contract, the consumer documents its
contract, and a `kind` field lets each layer verify the wire.
Option (d) Consumer-side reconciliation is a partial alternative
that is less invasive but loses the manual-mode rescaling benefit.

## What this DOES NOT establish

- It does NOT establish that the operator's intuition about
  "I wasn't carrying 1M tokens of active context" is wrong. The
  intuition is consistent with S1: the canonical transcript
  character count is 1M; the model may not have actually carried
  1M. Both can be true.
- It does NOT establish that the rescaling produces a
  provider-accurate `tokensIn`-equivalent for manual compaction.
  For manual mode the rescaling applies a ratio measured on H to
  a `tokensIn` measured on W — these are different scales, so
  the rescaled value can be wildly off.
- It does NOT establish whether `getLastApiReqContextInputTokens`
  should ignore the rescaling for manual mode (option d) or
  require a tagged field (option a). Either is plausible.

## Defect ownership map (current best understanding)

| Layer | Path | Contract | Defect? |
|-------|------|----------|---------|
| Producer (auto) | `session-runtime-orchestrator.ts:1149` | S1 (input to compaction = provider-bound) | CONSISTENT (auto path passes `prepareProviderMessagesForApi(canonical)`) |
| Producer (manual CLI) | `apps/cli/.../compaction.ts:99-100` | S1 (input to compaction = canonical) | CONSISTENT with S1 contract |
| Producer (manual VSCode) | `apps/vscode/.../sdk-compaction.ts:101-102` | S1 (input to compaction = canonical) | CONSISTENT with S1 contract |
| Consumer (UI rescaling) | `apps/vscode/src/shared/getApiMetrics.ts:174-225` | S2 (active provider context) | **GAP: assumes S2; producer documents S1** |
| Consumer (CLI divider) | `apps/cli/src/tui/utils/compaction-status.ts:80-92` | Neutral display | CONSISTENT |
| Telemetry | `sdk/packages/core/src/services/telemetry/core-events.ts:773,816` | S1 (matches producer docstring) | CONSISTENT with producer |
| Threshold check | `compaction.ts:335,362` | S2 (only for auto mode) | CONSISTENT (only auto path applies it) |

**The defect is in the WIRE between producer and UI rescaling.**
The producer documents S1; the consumer assumes S2; the wire does
not tag which scale is in use.

## Reclassification of previous turn

| Previous claim | Reclassification |
|----------------|------------------|
| `MANUAL_AUTO_INPUT_ASYMMETRY = PROVEN_STRUCTURAL` | **CORRECT; durable.** |
| `MANUAL_WRONG_INPUT_PROJECTION = WRONG_INPUT_PROJECTION` (case R0'.B) | **RETRACT_PENDING_SEMANTIC_BIND.** The asymmetry is real but its semantic interpretation is S3 (ambiguous wire contract), not S2 (wrong input). The producer contract per the docstring is S1, which is consistent with the manual intent. |
| `CASE_B.MANUAL_PROJECTION = PROVEN_ROOT_CAUSE_ISOLATED` | **PREMATURE / RETRACT.** Reclassification: pending S3 wire-tag (option a) or S3 wire-split (option b) or S3 consumer-reconciliation (option d). |
| `Repair01: pass prepareProviderMessagesForApi(canonical) for manual compaction` | **UNSAFE PREMISE.** This would break the explicit full-canonical manual-compaction invariant. The reviewer correctly flagged this. |
| `ROOT_CAUSE = manual compaction entry points (CLI:99-100, VSCode SDK bridge:101-102)` | **REFINED.** The two entry points have a structural asymmetry, but the actual defect is the AMBIGUOUS_WIRE_CONTRACT between the producer (S1) and the UI rescaling consumer (S2). The two entry points are NOT the defect; they correctly implement the producer's S1 contract per the design intent. |

## What changed vs commit 9083ecd56

The previous turn's source-recon found the structural asymmetry and
jumped to "manual compaction passes the wrong input." That jump was
unwarranted. The producer documents its S1 contract explicitly; the
manual entry points correctly implement S1 per the explicit design
intent ("intentionally summarizes the full canonical transcript").

The actual defect is **wire-contract ambiguity (S3)**: the
producer doesn't tag its field with a `kind`, and the consumer
assumes the field is on the working-context scale. Resolution
requires a **producer tag OR a consumer reconciliation OR a
producer/consumer schema split**, NOT a manual-entry-point change.

## Production delta since opening: 0

No production code changed. Test diff unchanged from commit 2916fb9fd
(R0-A green witness, R0-B/C removed). New evidence: this file.
