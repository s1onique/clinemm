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
>
> **Second review (2026-09-02):** PASS_WITH_ONE_P1_FIX.
> Reviewer notes two P1 overclaims that this turn corrects:
> - "S1 proven by telemetry docstring" — overclaimed. The telemetry
>   docstring ("Full-request token estimates, in the same units as
>   the trigger and limit") establishes a UNIT/SCALE contract, NOT a
>   payload-identity contract. The accurate statement is:
>   `tokensBefore = estimate(systemPrompt + apiMessages + tools)` for
>   the request object supplied to the compaction strategy. The
>   semantic content of that request is determined by the caller —
>   manual compaction passes canonical full transcript H, auto
>   compaction passes provider-projected W. The producer's contract
>   is a *transformation* on whatever payload was supplied, not a
>   *semantic label*.
> - "S3 = CURRENT_BEST_CLASSIFICATION" / "ROOT_CAUSE_ISOLATED =
>   AMBIGUOUS_WIRE_CONTRACT" — overclaimed. S3 is CANDIDATE (plausible
>   but unproven); ROOT_CAUSE = NOT_ISOLATED. The missing necessity
>   proof is whether the manual-mode ratio `tokensAfter/tokensBefore`
>   actually tracks the ratio in the provider-working-context space
>   (or in actual provider-normalized observation). That requires a
>   real-trace ratio discriminator, not another scaffolding pass.
>
> **Third review (2026-09-02):** PASS_WITH_ONE_P1_FIX.
> Reviewer notes one P1 causal flaw in the proposed live
> discriminator, plus a wording overclaim, that this turn corrects:
> - `P_after/P_before` is NOT a valid causal compaction oracle.
>   Between the compaction event and the next provider request,
>   intervening assistant/user/tool traffic can change the input;
>   comparing actual provider traffic before/after manufactures
>   exactly the ratio mismatch we're trying to interpret causally.
>   Fix: primary discriminator is `manual_ratio = H_after/H_before`
>   vs `provider_projection_ratio = W_after/W_before`, both
>   captured deterministically around the SAME manual-compaction
>   event with `prepareProviderMessagesForApi` applied to
>   pre/post compaction canonical snapshots. P observations become
>   LIVE_PROVIDER_QUALIFICATION (conservation check), not the causal
>   oracle.
> - "Ratio invariance → S1-LABEL-ONLY is the verdict" was overclaimed.
>   Ratio invariance only eliminates the *ratio-transfer defect*.
>   It does NOT by itself prove that the only remaining issue is
>   labeling — R1-R3 are still deferred. Right framing: ratio
>   invariance → `S3_RATIO_TRANSFER_NOT_REPRODUCED` → presentation
>   residue remains plausible → proceed to remaining ACT stop
>   conditions.
>
> **Fourth review (2026-09-02):** HALT_WRONG_POST_COMPACTION_PROJECTION.
> Reviewer flagged a P0 load-bearing seam error in the third-review
> corrected discriminator: `W_after = prepareProviderMessagesForApi(
> postCompactCanonicalSnapshot)` was wrong because canonical session
> history is intentionally append-only / full-fidelity, and the
> post-compaction active working context lives **separately** as a
> compaction artifact (`${sessionId}.compaction.json` per
> `sdk/ARCHITECTURE.md:497`). The function `prepareProviderMessagesForApi`
> is a second-stage transformation that does NOT consult the
> compaction artifact. So `W_after ≈ W_before` would be the
> deterministic outcome even when the active working context has
> shrunk dramatically — manufacturing a false S3 PROVEN. Fix: bind
> W to the **real production turn-preparation seam**:
> `prepareTurn = createCompactionStateAwarePrepareTurn({compact,
> getState, saveState})` (compaction.ts:672-712), which reads
> `activeSession.compactionState` and projects it against canonical
> via `projectSessionCompactionState` (`session-compaction.ts:161-193`).
> Then drive that seam twice against identical canonical state,
> with exactly one manual compaction applied between captures. The
> recon variable is renamed to **WORKING_CONTEXT_RATIO** to reflect
> what `prepareTurn` actually produces (the working-context
> projection, not the final provider-bound request — that requires
> an additional buildForApi + safety normalization pass). See
> `working-context-seam-recon.md` for the full binding.
## Producer contract

### Producer's transformation contract (calibrated 2026-09-02 second review)

The producer's actual contract is a **transformation** on the
request object supplied to the compaction strategy:

```text
tokensBefore = estimate(systemPrompt + apiMessages + tools)
```

where `apiMessages` is whatever the caller passed:
- Manual compaction passes `apiMessages = canonical full transcript`
  (apps/cli/src/runtime/interactive/compaction.ts:99-100,
  apps/vscode/src/sdk/sdk-compaction.ts:101-102; design intent
  "intentionally summarizes the full canonical transcript").
- Auto compaction passes `apiMessages = prepareProviderMessagesForApi(canonical)`
  (sdk/packages/core/src/runtime/orchestration/session-runtime-orchestrator.ts:1149).

This is a transformation contract, NOT a payload-identity contract.
The transformation produces the same numeric estimator output for
both callers; the semantic content of the input differs by caller.

### Docstring — telemetry schema (provides UNIT/SCALE contract only)

`sdk/packages/core/src/services/telemetry/core-events.ts:773`:

```ts
/** Full-request token estimates, in the same units as the trigger and limit. */
tokensBefore: number;
tokensAfter: number;
```

Both the `CaptureCompactionExecutedProperties` (line 776) and
`CaptureCompactionSkippedProperties` (line 816) carry the same
docstring. **This docstring establishes a UNIT/SCALE contract — that
`tokensBefore` is expressed in estimated input-token units consistent
with the trigger's units. It does NOT establish a payload-identity
contract (i.e., it does NOT say that `tokensBefore` measures a
specific semantic object).**

What this means:
- `tokensBefore` is on the same numeric scale as the trigger
  (`maxInputTokens * COMPACTION_TRIGGER_RATIO`).
- The trigger's scale is set by the model's `contextWindow` /
  `maxInputTokens` — i.e., an absolute number of provider-context
  tokens.
- This is a calibration invariant: the *same estimator* produces
  `tokensBefore` and `triggerTokens`, so their **ratio** is
  scale-free within the estimator's space.

What this does NOT mean:
- It does NOT prove that `tokensBefore` measures the active
  provider context, the canonical history, or any specific
  semantic object. That depends entirely on the caller's `apiMessages`.

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
the canonical full transcript.** The producer's transformation
contract on that input: `tokensBefore = estimate(input actually
summarized)`. The producer does NOT semantically label this as
"material being compacted" — it computes whatever estimator output
the supplied request produces. Whether the result USEFULLY
represents "material being compacted" depends on whether the caller
wanted that semantic, and whether downstream consumers agree.

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

## Current best classification: S3 (CANDIDATE, NOT ISOLATED) — calibrated 2026-09-02 second review

**S3 is PLAUSIBLE but UNPROVEN.** The recon above establishes the
necessary *textual* ingredients for the S3 hypothesis — producer's
transformation contract is documented; UI consumer implicitly
assumes the result is on a specific semantic scale; the wire
between them does not carry a `kind` discriminator. But the
necessary *causal* proof — that the manual-mode ratio
`tokensAfter/tokensBefore` actually fails to track the
provider-working-context shrink — has NOT been established. That
requires a real-trace ratio discriminator (see "Next discriminator"
below).

The **S2 hypothesis** ("manual compaction passes the wrong input")
would require:
- (a) The producer to claim its contract is S2 (it doesn't —
  docstring establishes UNIT/SCALE only, not payload-identity).
- (b) The architecture to disallow canonical-H inputs to manual
  compaction (it doesn't — manual mode is the path for "summarize
  the full canonical transcript").
- (c) The producer's transformation contract to be invalid (it
  isn't — it correctly estimates whatever request it was supplied).

The **S1 hypothesis** ("producer is correct, UI label is wrong")
would require:
- (d) The UI's rescaling to be wrong on the SAME numbers (it
  isn't — the docstring explicitly says the ratio is scale-free).
- (e) The UI's title attribute to be misleading for ALL modes
  (it might be — but for AUTO mode the producer and consumer
  happen to agree on scale).

The **S3 hypothesis** is plausible because:
- (f) The wire does not tag which semantic scale `tokensBefore`
  is on.
- (g) For MANUAL mode, producer's caller passes canonical H, but
  consumer applies ratio to provider-bound `tokensIn`.
- (h) Whether the **manual-mode ratio** (canonical-space) tracks
  the **provider-space shrink** is exactly the empirical question
  that is unresolved.

If (h) is FALSE (the manual-mode ratio tracks provider-space
shrink), then S1-label-only (presentation residue only) is the
verdict. If (h) is TRUE, S3 is proven and repair options (a), (b),
or (d) become necessary.

## Next discriminator (the one bounded test that matters) — CALIBRATED 2026-09-02 fourth-review HALT_WRONG_POST_COMPACTION_PROJECTION

**Reviewer's fourth-review P0:** the previous turn's
`prepareProviderMessagesForApi(postCompactCanonicalSnapshot)`
formula was wrong. That function is a **second-stage**
transformation that does NOT consult the compaction artifact.
Canonical session history is intentionally append-only / full-
fidelity, and the post-compaction active working context lives
**separately** as a compaction artifact
(`${sessionId}.compaction.json` per `sdk/ARCHITECTURE.md:497`).
Calling `prepareProviderMessagesForApi(postCompactCanonical
Snapshot)` would pass canonical history to a function that
ignores the compaction sidecar — i.e., `W_after ≈ W_before` even
when the active working context has shrunk dramatically. That
would manufacture a false S3 PROVEN (or a false
`S3_RATIO_TRANSFER_NOT_REPRODUCED` if a hook happened to drift).

**See `working-context-seam-recon.md` for the full binding.** The
short version:

The real production seam that produces the post-compaction
working context is the state-aware prepareTurn at
`sdk/packages/core/src/extensions/context/compaction.ts:672-712`,
which:

1. reads the persisted compaction artifact via
   `getState() → activeSessionRef.compactionState`
   (wiring at `local-runtime-host.ts:663`),
2. projects it against canonical via
   `projectSessionCompactionState(existingState, context.messages)`
   (`session-compaction.ts:161-193`) which returns
   `[...compaction-artifact messages, ...canonical-tail messages]`,
3. returns that as `ContextPipelinePrepareTurnResult.messages`.

Then the agent's message-builder (`session-runtime-orchestrator.ts`
constructor wires `messageBuilder = new MessageBuilder(...)`)
turns those into provider-bound `apiMessages`, and
`prepareProviderMessagesForApi` (line 1149 / 1186 / 1192) applies
the second-stage normalization.

### Primary captures (CAUSAL — bound to the real production seam)

```text
STATE_PRE = canonical history (unchanged between runs)

prepareTurn = createCompactionStateAwarePrepareTurn({
                compact,
                getState: () => session.compactionState,
                saveState: ...,
              })

H_before = estimate(systemPrompt + manualCompactionInput + tools)
           // canonical full transcript supplied to manual compaction
           // (apps/cli/src/runtime/interactive/compaction.ts:99-100)

H_after  = estimate(systemPrompt + compactorOutput + tools)
           // compactor's actual output, same estimator basis

W_before = estimate(buildForApi(
              prepareTurn({ messages: STATE_PRE, ... }).messages
            ) + systemPrompt + tools)

apply exactly one manual compaction:
   result = await compact({ messages: STATE_PRE, ... })
   newState = createSessionCompactionState({
                sourceMessages: STATE_PRE,
                compactedMessages: result.messages,
                conversationId, systemPrompt,
              })
   saveState(newState, STATE_PRE)   // installs the new artifact

W_after = estimate(buildForApi(
              prepareTurn({ messages: STATE_PRE, ... }).messages
            ) + systemPrompt + tools)
```

### Why this is causal

Both `W_before` and `W_after` are produced by the SAME production
turn-preparation seam against the SAME canonical state. The ONLY
state change between the two captures is the compaction artifact
having been installed by the manual-compaction call. No model
turn, no hook traffic, no canonical-tail growth.

### Why the rename to WORKING_CONTEXT_RATIO (during recon)

The seam ends at `prepareTurn(...).messages` — that is the
working-context projection. After `prepareTurn`, the agent's
message-builder (`buildForApi`) applies further transformations
(image rewriting, system-prompt prefixing, schema fixes, hook
rewrites, safety normalization) before the final `providerMessages`
array. The recon variable is therefore named
**WORKING_CONTEXT_RATIO** to reflect what `prepareTurn` produces,
NOT "provider_projection_ratio". If subsequent inspection proves
the buildForApi layer is deterministic and compaction-independent,
the discriminator can promote:

```text
WORKING_CONTEXT_RATIO
  → PROVIDER_BOUND_PROJECTION_RATIO
```

with evidence. Until then, the recon variable is intentionally
named to NOT overclaim.

### Primary discriminator (CAUSAL A/B)

```text
manual_ratio           = H_after / H_before
working_context_ratio  = W_after / W_before

ASSERT (or refute): manual_ratio tracks working_context_ratio
```

### Provider observations (LIVE_PROVIDER_QUALIFICATION, NOT the causal oracle)

```text
P_before = provider-normalized input of the last actual request
           BEFORE compaction (may include post-request assistant
           turn, tool results, hook output — i.e., not necessarily
           the same input the compactor saw)
P_after  = provider-normalized input of the first actual request
           AFTER compaction (may include intervening user
           continuation, followup turns, system changes)
```

P captures can be used only as a **conservation / qualification**
check:

```text
ASSERT (weak): P_after ≈ corresponding W_after_promoted
   — proves the provider-side projection agrees with our
     deterministic projection at the model-invocation boundary.
   — but P_after includes anything that arrived between the
     compaction event and the actual request, so this is NOT
     a compaction-ratio equality test.
```

### Verdict (CAUSAL, not overclaimed)

**If `manual_ratio` materially differs from `working_context_ratio`**,
then S3 is REPRODUCED at the **real production working-context
seam**. Necessity is demonstrated. ROOT_CAUSE_ISOLATED =
AMBIGUOUS / UNTAGGED COMPACTION RATIO. Repair options (a)/(b)/(d)
become candidates.

**If `manual_ratio ≈ working_context_ratio`**, then the
**S3 ratio-transfer hypothesis is NOT REPRODUCED**. This does NOT
automatically prove `S1_LABEL_ONLY` is the verdict; it only
eliminates the ratio-transfer defect. Other accounting defects may
remain — R1-R3 are still deferred, and the UI title still claims
"Current tokens used in this request" while the producer is a
transformation over caller-supplied input. The right framing:
ratio invariance → `S3_RATIO_TRANSFER_NOT_REPRODUCED` →
presentation residue remains plausible → proceed to remaining
ACT stop conditions.

**If H or W cannot be captured deterministically around the same
event** (transcript corruption, snapshot capture hook missing,
buildForApi not deterministic for some payload shape), then
`CAPTURE_INSUFFICIENT` — expand the instrumentation or settle for
the textual evidence.

**If P_after cannot be related to a corresponding W_after** (different
sessions, model caching quirks, telemetry loss, intervening turns
between compaction and next provider request), then P observations
are NOT usable as qualification. H/W comparison still stands.

**Do not infer S3 from chronology or absolute values alone.** The
discriminator is *ratio equality under same-event capture*, not
*absolute token count plausibility*.

### Reopen-condition for executing this discriminator

**C1 GO is NOT yet granted.** Before execution, the next turn
must complete the `working-context-seam-recon.md`
reopen-condition checklist:

1. Confirm `buildForApi` has no compaction-aware logic that
   would invalidate the equality
   `buildForApi(prepareTurn(x).messages) ≈ buildForApi(x.messages)`
   for any x (i.e., the second-stage transformation is
   compaction-independent).
2. (Done in this calibration) Author the corrected discriminator
   formula with `buildForApi(prepareTurn(...).messages)`.
3. Commit those changes.

After that, **C1: GO — execute the discriminator immediately,
no further review loop.**

## Repair options (NOT RANKED — only ranked after the ratio discriminator)

Factory doctrine strongly favors the smallest bounded repair until
evidence proves the wire itself needs new semantics. **If the
discriminator shows ratio invariance holds (S1-label-only
verdict), then options (a) and (b) are unnecessary architecture —
no new protocol fields are needed.** If the discriminator shows
ratio invariance fails for manual mode only, option (d) may be the
smallest bounded repair. Option (c) is RETRACTED as unsafe.

| Option | Description | Pros | Cons | Status |
|--------|-------------|------|------|--------|
| **(a) Tag the field** | Producer emits `tokensBefore` + `tokensBeforeKind` ("input_to_compaction" / "active_provider_context"). Consumer uses ratio only when kind matches its assumed scale. | Preserves both contracts; explicit; small wire change. | Requires touching producer (adds `kind` field to schema and JSON) and consumer (read the kind). | DESIGN CANDIDATE; only justified if discriminator fails AND general wire-tag is the chosen fix. |
| **(b) Split into two fields** | Producer emits `compactionInputTokensBefore` AND `activeContextTokensBefore` as distinct fields. UI uses only `activeContextTokensBefore`. | Explicit; no implicit contract; clean separation. | Producer must compute both; redundant writes; bigger schema change. | DESIGN CANDIDATE; only justified if (a) is insufficient. |
| **(c) Producer-side harmonization** (RETRACTED) | For manual compaction, producer computes `tokensBefore = estimate(buildForApi(canonical))`. | Symmetry with auto path. | **Breaks the explicit full-canonical manual-compaction invariant.** The reviewer correctly flagged this as an unsafe premise. | RETRACTED — would destroy the manual mode's intentional canonical-summary behavior. |
| **(d) Consumer-side reconciliation** | UI reads `tokensBefore`/`tokensAfter` ONLY when it can prove the producer used the working-context scale (i.e., only for auto mode). For manual mode, UI displays a neutral divider WITHOUT rescaling `tokensIn`. | Preserves producer contract; UI stops assuming scale; smallest bounded repair. | Loses the "bar updates immediately" benefit for manual compactions (UI shows the next request's `tokensIn` instead of the rescaled one). | DESIGN CANDIDATE; smallest fix if the failure is specifically manual-mode ratio non-invariance. |
| **(e) Label-only** | Update the UI title attribute and divider label to match the producer's actual contract (e.g., "Compaction ratio" instead of "Current tokens used in this request"). | Trivial change; addresses only presentation residue. | Does not address the rescaling arithmetic if it actually fails. | DESIGN CANDIDATE; only sufficient if S1-label-only is the verdict. |

The earlier "most likely correct repair is option (a)" framing was
overclaimed and is RETRACTED. Until the discriminator runs, the
correct default is **wait for evidence** — do not pre-rank.

## What this DOES NOT establish

- It does NOT establish that the operator's intuition about
  "I wasn't carrying 1M tokens of active context" is wrong. The
  intuition is consistent with the source code: the canonical
  transcript character count is 1M; the model may not have
  actually carried 1M. Both can be true.
- It does NOT establish that the rescaling produces a
  provider-accurate `tokensIn`-equivalent for manual compaction.
  For manual mode the rescaling applies a ratio measured on H to
  a `tokensIn` measured on W — these are different scales, so the
  rescaled value CAN be wildly off, OR it can be approximately
  equivalent if the ratio transfers. The discriminator resolves
  this.
- It does NOT rank repair options. All of (a)/(b)/(d)/(e) are
  design candidates pending the discriminator. (c) is RETRACTED.
- It does NOT constitute `ROOT_CAUSE_ISOLATED`. The textual
  evidence supports S3 as a CANDIDATE; the causal proof requires
  the ratio discriminator. Until that runs, ROOT_CAUSE = NOT_ISOLATED.

## Defect ownership map (current best understanding)

| Layer | Path | Contract | Status |
|-------|------|----------|--------|
| Producer (auto) | `session-runtime-orchestrator.ts:1149` | Transformation on `prepareProviderMessagesForApi(canonical)` | CONSISTENT (auto caller passes provider-bound input) |
| Producer (manual CLI) | `apps/cli/.../compaction.ts:99-100` | Transformation on canonical full transcript H | CONSISTENT (manual design intent "intentionally summarizes the full canonical transcript") |
| Producer (manual VSCode) | `apps/vscode/.../sdk-compaction.ts:101-102` | Transformation on canonical full transcript H | CONSISTENT (same intent as CLI manual) |
| Consumer (UI rescaling) | `apps/vscode/src/shared/getApiMetrics.ts:174-225` | Assumes `tokensAfter/tokensBefore` tracks provider-context shrink (implicit S2) | CANDIDATE — ratio is scale-free within the estimator's space; whether it tracks the provider-context shrink for manual mode is exactly what the discriminator tests. |
| Consumer (UI rendering) | `apps/vscode/webview-ui/src/.../ContextWindow.tsx:175` | Renders the rescaled value with title "Current tokens used in this request" | PRESENTATION — title implies S2; producer delivers transformation. Even if rescaling is correct, the title is misleading for manual mode. |
| Consumer (CLI divider) | `apps/cli/src/tui/utils/compaction-status.ts:80-92` | Neutral display | CONSISTENT |
| Telemetry schema | `sdk/packages/core/src/services/telemetry/core-events.ts:773,816` | UNIT/SCALE contract only ("same units as the trigger and limit") | CONSISTENT (does not commit to a payload-identity contract) |
| Threshold check | `compaction.ts:335,362` | Compares `requestInputTokens` to `maxInputTokens * COMPACTION_TRIGGER_RATIO` | BOUNDED to auto mode; manual bypasses. Auto path passes provider-bound input → CONSISTENT. |

**No producer defect is established by the recon.** Whether the
S3 hypothesis (wire-contract ambiguity) is correct depends on the
ratio discriminator. Until that runs, the most we can say is that
the producer is a transformation on whatever was passed, the UI
consumer applies a ratio that may or may not track provider-context
shrink for manual mode, and the UI title is a presentation residue.

## Reclassification of previous turn

| Previous claim | Reclassification |
|----------------|------------------|
| `MANUAL_AUTO_INPUT_ASYMMETRY = PROVEN_STRUCTURAL` | **CORRECT; durable.** |
| `MANUAL_WRONG_INPUT_PROJECTION = WRONG_INPUT_PROJECTION` (case R0'.B) | **RETRACT_PENDING_SEMANTIC_BIND.** The asymmetry is real but its semantic interpretation is NOT YET BOUND. S3 (overloaded wire) is a CANDIDATE but is not proven until the ratio discriminator runs. The producer is a transformation on whatever input the caller supplied; manual compaction correctly supplies canonical H per the explicit design intent. |
| `CASE_B.MANUAL_PROJECTION = PROVEN_ROOT_CAUSE_ISOLATED` | **PREMATURE / RETRACT.** Reclassification: pending the ratio discriminator. ROOT_CAUSE remains UNKNOWN until the discriminator decides between S1-label-only (presentation residue only), S3-proven (ratio non-invariance), or INDETERMINATE. |
| Discriminator verdict (executed 2026-09-02, see `discriminator.md`) | **Cross-scale ratio-transfer mismatch REPRODUCED** at the real production working-context seam (case 2: realistic canonical with assistant text > 200K engages MessageBuilder's truncateAssistantText; manualRatio 0.000210 vs workingContextRatio 0.000629, 66.6% relative divergence). Trivial canonical case (case 1) showed `S3_RATIO_TRANSFER_NOT_REPRODUCED` because buildForApi did not transform small inputs — the mismatch only surfaces when the working context is large enough to engage buildForApi's truncation budgets. RED witness captured mechanically via strong Factory form (see `red-witness.txt`: `AssertionError: expected 0.6664678440519827 to be less than or equal to 0.1`). Reachability mechanically established; prevalence in production telemetry DEFERRED per R1-R3 HALT. |
| Discriminator verdict (CALIBRATED 2026-09-02 Factory form review) | **ROOT_CAUSE = NOT_YET_PROMOTED.** The experiment establishes the cross-scale mismatch is reproducible, but it does NOT uniquely prove the wire/schema is defective vs the consumer's ratio-transfer assumption being invalid. The producer IS allowed to report the transformation over its supplied input; whether the published `tokensBefore`/`tokensAfter` are contractually meant to support cross-scale rescaling is a contract-design question not mechanically settled. **LIKELY_CAUSE = CROSS_SCALE_RATIO_TRANSFER_ASSUMPTION.** **BROKEN_CONSUMER_SEAM = `getApiMetrics.ts:174-225` applies compactor H-space ratio to provider-input P-space tokensIn.** **WIRE_CONTRACT_OVERLOADED = POSSIBLE REPAIR INTERPRETATION (NOT uniquely proven root cause).** **UI_CONSUMER_MATH = INTERNALLY CONSISTENT GIVEN BAD ASSUMPTION.** Recommend first repair trial = (d) consumer-side reconciliation (smallest bounded fix, mechanically testable against same discriminator). R1-R3 still deferred. This verdict does NOT auto-prove S1-LABEL-ONLY or eliminate other accounting defects. |
| `Repair01: pass prepareProviderMessagesForApi(canonical) for manual compaction` | **UNSAFE PREMISE.** This would break the explicit full-canonical manual-compaction invariant. The reviewer correctly flagged this. |
| `ROOT_CAUSE = manual compaction entry points (CLI:99-100, VSCode SDK bridge:101-102)` | **RETRACTED.** The two entry points have a structural asymmetry (manual passes canonical H; auto passes provider-projected W) but the entry points correctly implement their respective design intents. The entry points are NOT the defect. The defect (if any) is in whether the manual-mode ratio transfers to the provider-context shrink — a question the discriminator tests. |
| `S1 (MATERIAL_BEING_COMPACTED) is the producer's contract` (this turn's first draft) | **OVERCLAIMED.** The telemetry docstring establishes a UNIT/SCALE contract only; the producer's actual contract is a *transformation* on whatever request the caller supplied. The semantic content of that request is determined by the caller, not by the producer. |
| `S3 = CURRENT_BEST_CLASSIFICATION` (this turn's first draft) | **OVERCLAIMED.** S3 is PLAUSIBLE but UNPROVEN. `ROOT_CAUSE_ISOLATED = AMBIGUOUS_WIRE_CONTRACT` is unjustified without the ratio discriminator. The two were inconsistent with each other and both retracted in the second-review calibration. |
| `(a) Tag the field = most likely correct repair` (this turn's first draft) | **OVERCLAIMED.** Repair options are NOT RANKED until the discriminator runs. Factory doctrine prefers the smallest bounded fix; if ratio invariance holds, no new protocol fields are needed. |
| `P_after/P_before` is the causal compaction oracle (second-review calibration) | **OVERCLAIMED.** Between the compaction event and the next provider request, intervening assistant/user/tool traffic can change the input; comparing actual provider traffic before/after manufactures exactly the ratio mismatch we're trying to interpret causally. P observations become LIVE_PROVIDER_QUALIFICATION (conservation check), NOT the causal oracle. Primary discriminator is now `manual_ratio = H_after/H_before` vs `provider_projection_ratio = W_after/W_before`, both captured deterministically around the SAME manual-compaction event. |
| `Ratio invariance → S1-LABEL-ONLY is the verdict` (second-review calibration) | **OVERCLAIMED.** Ratio invariance only eliminates the *ratio-transfer defect*. R1-R3 are still deferred; other accounting defects may remain. Correct framing: ratio invariance → `S3_RATIO_TRANSFER_NOT_REPRODUCED` → presentation residue remains plausible → proceed to remaining ACT stop conditions. |
| `W_after = prepareProviderMessagesForApi(postCompactCanonicalSnapshot)` (third-review calibration) | **WRONG — P0 seam error.** `prepareProviderMessagesForApi` is a second-stage transformation that does NOT consult the compaction artifact. Canonical session history is intentionally append-only / full-fidelity, and the post-compaction active working context lives separately as a compaction artifact (`sdk/ARCHITECTURE.md:497`). So `W_after ≈ W_before` would be the deterministic outcome even when the active working context has shrunk dramatically. Fix: bind W to the real production turn-preparation seam — `prepareTurn = createCompactionStateAwarePrepareTurn({compact, getState, saveState})` (compaction.ts:672-712), which reads `activeSession.compactionState` and projects it via `projectSessionCompactionState` (session-compaction.ts:161-193). Drive that seam twice against identical canonical state with exactly one manual compaction applied between captures. Rename to **WORKING_CONTEXT_RATIO** during recon. See `working-context-seam-recon.md`. |

## What changed vs commit 9083ecd56

The previous turn's source-recon found the structural asymmetry and
jumped to "manual compaction passes the wrong input." That jump was
unwarranted. The producer is a transformation on whatever request the
caller supplied; the manual entry points correctly supply canonical
H per the explicit design intent ("intentionally summarizes the full
canonical transcript").

The CALIBRATED version of this turn further refines two claims:
1. "S1 (MATERIAL_BEING_COMPACTED) is the producer's contract" was
   overclaimed — the docstring establishes a UNIT/SCALE contract,
   not a payload-identity contract. The accurate statement is that
   the producer's contract is a transformation on the supplied
   request, with the semantic content determined by the caller.
2. "S3 is the current best classification / root cause isolated"
   was overclaimed — S3 is PLAUSIBLE but UNPROVEN; ROOT_CAUSE
   remains UNKNOWN. The missing necessity proof is whether the
   manual-mode ratio tracks the provider-context shrink, which is
   the ratio discriminator's question.

Resolution requires the ratio discriminator to run. If it shows
ratio non-invariance, then wire-tag / wire-split / consumer-side
reconciliation becomes necessary (and ownership migrates to the
schema/wire layer or the UI consumer, NOT to the compactor entry
points). If it shows ratio invariance, only presentation residue
(UI title, divider label) needs fixing.

## Production delta since opening: 0

No production code changed. Test diff unchanged from commit 2916fb9fd
(R0-A green witness, R0-B/C removed). New evidence: this file.
