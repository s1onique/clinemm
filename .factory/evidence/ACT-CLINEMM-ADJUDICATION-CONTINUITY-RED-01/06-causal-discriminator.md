# 06 — Causal discriminator

**Label:** `REAL_PRODUCTION_SEAM` (the discriminators execute production
functions); `SYNTHETIC` for the fixture content; `NOT_EXECUTED` for live-model
behaviour.

All four discriminators are implemented in
`src/extensions/context/compaction.adjudication-continuity.discriminator01.test.ts`
and are **PASSING** in the default suite.

**Controlled comparison discipline:** every discriminator uses the **identical
canonical input**, the **identical budget** (`targetTokens: 100_000`), the
**identical model configuration** and the **identical compaction cutoff**. The
**only** variable that changes is the one named in the discriminator.

---

## Discriminator A — Source selection

> *Does the verdict-containing message reach the budgeted summarizer input? If
> not, the loss is upstream of serialization.*

**Test:** `DISCRIMINATOR A` — the production
`buildBudgetProjection()` is invoked twice on the same canonical input, once per
policy intent.

| Invocation | Result |
|---|---|
| `policyIntent: "agentic_summary"` | adjudication **absent** from the projected messages |
| `policyIntent: "normal_provider_request"` | adjudication **present** |

The projection additionally **reports** the removal as a `dropped_block` budget
action with `reason: "unsafe_to_truncate"` — so the loss is **observable in
production diagnostics**, not silent.

**Answer: NO — the verdict-containing message does NOT reach the budgeted
summarizer input.** The loss is **upstream of serialization**.

**Mechanism (exact):** `resolveProjectionPolicy()` at
`budget-projection/project.ts:25-43` returns `dropThinkingBlocks: true` for the
`agentic_summary` intent. `buildBudgetProjection()` then calls
`dropThinkingBlocks()` at `project.ts:506-515` — **before** the
`estimatedTokens <= targetTokens` early return at `project.ts:539`. The removal
is therefore **unconditional** and is not a function of budget pressure.

---

## Discriminator B — Serialization

> *Does the budgeted input contain the adjudication, but the serialized
> conversation omit or truncate it? If yes, establish the exact
> transformation.*

**Test:** `DISCRIMINATOR B` — `serializeConversation()` is invoked directly on the
same canonical input.

| Fixture | Result |
|---|---|
| adjudication at the start of a thinking block | **carried** — the output contains the adjudication and the `[Bot thinking]` marker |
| adjudication after 2500 filler characters | **truncated** — the output contains `[truncated …]` and not the adjudication |

**Answer: NO.** The serializer **does** carry the adjudication when the block
reaches it. The exact truncation transformation exists and is measurable
(`truncateText(block.thinking, 2_000)` at `compaction-shared.ts:400`, appending
`\n...[truncated N chars]`), but it is **not** the cause of the R3/R7/R8 losses,
because those blocks are **inside** the window (1231 / 981 / 1387 chars) and are
still lost.

**Discriminator A and B together exclude the serializer.**

---

## Discriminator C — Summarizer omission

> *Does the complete adjudication reach the actual summarizer request, but
> disappear in the returned summary?*

**Test:** `DISCRIMINATOR C` — the production `serializeConversation()` output
(the summarizer's input window) is checked for the verdict and the qualification.

| Probe | Result |
|---|---|
| `NARROWED` (verdict token) | **present** in the serialized conversation |
| `missing automatic enforcement` (qualification token) | **present** in the serialized conversation |

**Answer: NO.** The adjudication is **never** in the summarizer's request, so it
cannot have been "selected out" by the summarizer. **L3 — Summarizer omission is
excluded.**

> **Explicit limit.** This discriminator establishes a property of the
> **input window**, not of a model's behaviour. It does **not** claim that a live
> model, given the adjudication, would have selected it into the summary. No
> live model was executed; none is required. A mocked summarizer cannot prove
> how a live model would respond, and no claim of that kind is made.

---

## Discriminator D — Provider continuation

> *Does the generated summary contain the verdict, but the final
> provider-visible request omit it?*

**Test:** `DISCRIMINATOR D` — the production `MessageBuilder.buildForApi()` is
invoked on a summary message that **does** contain the adjudication.

| Probe | Result |
|---|---|
| `NARROWED` in the provider-visible projection | **present** |
| `missing automatic enforcement` in the provider-visible projection | **present** |

**Answer: NO.** When the adjudication is present in the summary, the production
state-aware projection and `MessageBuilder.buildForApi()` carry it to the
provider **intact**. **L4 — Post-summary projection loss is excluded.**

---

## Summary

| Discriminator | Question | Answer | Loss class excluded |
|---|---|---|---|
| **A** | does the verdict reach the budgeted input? | **NO** | — (this IS the boundary) |
| **B** | does the serializer drop/truncate it? | **NO** | **L2** |
| **C** | did the summarizer select it out? | **NO** | **L3** |
| **D** | did the provider projection drop it? | **NO** | **L4** |

**Conclusion:**

> **The earliest information-loss boundary is the compaction SOURCE SELECTION
> (stage M1), inside `buildBudgetProjection()` with the `agentic_summary`
> policy. Loss classification: L1 — Budget loss.**
>
> The defect is a **single, bounded, unconditional removal of `thinking` blocks
> from the summarizer's input window**. It is not a truncation-window issue, not
> a summarizer-reliability issue, and not a post-summary projection issue.

---

## Why the loss is specific to `thinking` blocks

The production policy distinguishes the two compaction intents:

| Intent | `dropThinkingBlocks` | `dropUnsafeOutsideLiveTail` | Used by |
|---|---|---|---|
| `agentic_summary` | **true** | true | the agentic compaction path (`runAgenticCompaction`) |
| `basic_compaction_projection` | **true** | true | the basic compaction path |
| `normal_provider_request` | false | false | the main-model provider request |

The `thinking` removal is deliberate in the main-model request too — the model
must not be shown its own raw reasoning — but the **summarizer** is a different
consumer: it is the component whose job is to distil the session's decisions
into a continuation note. A verdict expressed only in `thinking` is exactly the
kind of statement the summarizer is supposed to carry forward, and it is
systematically invisible to it.

The **measurements** confirm the shape of the historical loss: the R3/R7/R8
witness turns each carry `[thinking, tool_use]` with **no** `text` block, so the
adjudication has **no** other carrier. A verdict that had also been stated in an
ordinary assistant `text` block would have survived — RED-3's control proves
this.
