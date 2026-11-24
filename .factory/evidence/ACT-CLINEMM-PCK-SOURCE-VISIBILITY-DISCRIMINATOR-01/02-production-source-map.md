# 02 — Production source map

## The runtime chronology

The ACT's question was: **where, exactly, does the working agent still have
its complete relevant context, and who owns that point?**

```text
Canonical tool result appended
  -> working context available                          [runtime owns]
  -> context threshold evaluated                        [compaction.ts:699 shouldCompact]
  -> compaction requested                               [compaction.ts:915-990]
  -> summarizer input projected                         [agentic-compaction.ts:140]
  -> summary generated                                  [agentic-compaction.ts:189]
  -> enrichment applied                                 [compaction.ts:1819-1854]
  -> sidecar persisted                                  [compaction.ts:1856-1862]
  -> provider request built                             [MessageBuilder.buildForApi]
  -> model continues
```

### The last safe point before compaction

**It is `compaction.ts` line 1813 — `const result = input.compact ? await input.compact(context) : undefined;` — and, inside it, `agentic-compaction.ts` line 74 — `const messagesToSummarize = messages.slice(0, cutIndex);`.**

At that point:

- `context.messages` is the COMPLETE canonical history, including every
  canonical tool result.
- No summary exists yet.
- The compaction state has NOT been persisted.
- The provider request has NOT been built.

The component that owns this point is **`createCompactionStateAwarePrepareTurn`
in `sdk/packages/core/src/extensions/context/compaction.ts`**, which is the
host-agnostic wrapper around the compaction strategy.

### Why that point is safe for a checkpoint request

A checkpoint requested at that point can read `context.messages` without:

1. **inserting a new canonical user message** — it builds a SEPARATE,
   read-only view; the canonical history is not mutated;
2. **disturbing tool-call pairing** — the view renders calls and results as
   labels; no pairing is rewritten, and `findCutIndex()`'s pairing
   invariant is untouched;
3. **consuming the already-triggered compaction state** — the request takes
   no sidecar, writes no sidecar, and never calls `saveState`.

The ACT's `buildCandidateB()` satisfies all three, and the
`causal-ablation.test.ts` suite asserts the conservation properties
directly.

## The serializer owner

**`renderStructuredToolPayload()` — `sdk/packages/core/src/extensions/context/compaction-shared.ts:258`.**

```ts
function renderStructuredToolPayload(
	payload: Record<string, unknown>,
	index: number,
	toolName?: string,
): string {
	const status = classifyStructuredPayloadStatus(payload);
	const rawQuery = payload.query;
	const classification =
		typeof rawQuery === "string" ? classifyCommand(rawQuery) : "";
	const label = classification || `#${index + 1}`;
	const rawResult = payload.result;
	const sourceFileFact = buildSourceFileFact(payload, toolName);
	if (sourceFileFact) {
		return `[${status}] source-file ${sourceFileFact.path}: ${sourceFileFact.excerpt}`;
	}
	const approvedResult =
		typeof rawResult === "boolean"
			? `result=${rawResult}`
			: typeof rawResult === "number" && Number.isFinite(rawResult)
				? `result=${rawResult}`
				: OMITTED_STRUCTURED_RESULT_MARKER;
	return `[${status}] ${label}: ${approvedResult}`;
}
```

`OMITTED_STRUCTURED_RESULT_MARKER` is `"[result omitted]"` (line 237).

**This function was NOT modified by this ACT.** Its contract is unchanged.

### The adjacent, already-existing source-attributed excerpt path

`buildSourceFileFact()` in `evidence-continuity.ts:590` is the ONE result
class that IS allowed to carry a bounded excerpt. It is **disabled by
default**:

```ts
export const SOURCE_FILE_FACT_CARRY_FORWARD_ENABLED = false;
```

and it applies ONLY to the `read_files` tool:

```ts
const SOURCE_FILE_READ_TOOL_NAME = "read_files";
```

**This matters for the R4 witness.** The R4 observation
(`kc.sh build` / `start --optimized`) reached the canonical history through
a **`run_commands`** stdout body, not through `read_files`. So even if the
source-file-fact switch were enabled, the R4 observation would still be
omitted by the ordinary summarizer. This ACT did **not** enable that switch
and did **not** change `renderStructuredToolPayload()`.

## The budget-projection owner

**`buildBudgetProjection()` — `sdk/packages/core/src/extensions/context/budget-projection/project.ts:479`.**

The `agentic_summary` policy (line 27) sets `dropThinkingBlocks: true`, and
`dropThinkingBlocks()` (line 297) removes every `thinking` block before the
serializer ever sees it.

**This function was NOT modified by this ACT.** Its contract is unchanged.

## The provider-request owner

**`MessageBuilder.buildForApi()` — `sdk/packages/core/src/session/services/message-builder.ts:219`.**

It is the provider-wire projection. It is a STATEFUL builder, which is why
the compaction path uses an isolated accounting builder for budget
measurement (`prepareBudgetAccountingMessages`).

## The thinking-origin classification

Every candidate block's origin is classified by `classifyBlockOrigin()` in
`src/extensions/context/source-visibility-discriminator/content-origin.ts`,
BY DATA SHAPE and role — never by a provider id and never by a tool name:

| Class | Assigned when | Forwardable? |
|---|---|---|
| `USER_CONTENT` | a `text` block in a user message | YES |
| `ASSISTANT_PUBLIC_TEXT` | a `text` block in an assistant message | YES |
| `ASSISTANT_THINKING` | a `thinking` or `redacted_thinking` block | **NO** |
| `TOOL_INPUT` | a `tool_use` block | YES (as a bounded label) |
| `TOOL_RESULT` | a `tool_result` block | YES (as data) |
| `RUNTIME_METADATA` | a `file` / `image` / `media` block | NO |
| `UNKNOWN_ORIGIN` | an unrecognized shape | **NO** |

### THE MOST IMPORTANT CORRECTION THIS ACT MADE

**The predecessor's report stated that `MtsOmni` was "ABSENT from both
post-compaction provider-visible contexts" and that the bare identifier was
lost. That is only PARTLY true, and the ACT's own measurement corrects it.**

The bare identifier `MtsOmni` DOES survive the ordinary summarizer view,
because the tool CALL's own command line is rendered by `formatToolInput()`
and names the file:

```text
[Bot tool calls]: run_commands({"command":"... MtsOmniSmsSenderServiceProvider.java ..."})
```

What the ordinary view does NOT carry is the **INSPECTED IMPLEMENTATION
CONTENT** — the source lines the investigation read, e.g.
`connectTimeoutMillis(3_000)` and `socketTimeOutMillis(10_000)`. Those came
from a `run_commands` stdout body and are rendered `[result omitted]`.

The ACT's RED therefore discriminates on the **implementation content**, not
on the bare identifier. See `03-visibility-red.md`.

A second, related correction: the historical `second-post.json` DOES contain
`connectTimeoutMillis(3_000)`, but **only inside a provider `reasoning`
block** — the model's own private re-derivation, not the tool observation.
Measuring without excluding the reasoning channel would have wrongly
reported that R2's implementation detail SURVIVED the boundary. The ACT's
`providerVisibleNonReasoningText()` excludes it.

A third correction, on R6: the marker text `=== changelog retention ===`
also appears in the tool CALL's command line (it is an `echo` label), so it
is NOT a valid discriminator on its own. The valid discriminator is the
RESULT BODY — the ordinary view renders the structured payload as
`[result omitted]`, so it never carries the body that shows the match set
was EMPTY.

## The three candidate inputs

| | Input | Owner | Label |
|---|---|---|---|
| **A** | the ordinary summarizer view | `buildBudgetProjection` + `serializeConversation` | `REAL_PRODUCTION_SEAM` |
| **B** | the working-agent pre-compaction context | this ACT's `buildCandidateB()` | `SYNTHETIC_REAL` |
| **C** | a dedicated checkpoint-only evidence view | this ACT's `buildCandidateC()` | `SYNTHETIC` |

Input B is labelled `SYNTHETIC_REAL`, NOT `LIVE`, because it is a
CONSTRUCTED, FILTERED approximation of the working agent's context — not an
exact replay of a captured provider-visible request. The provider-wire
projection is a separate, host-supplied, stateful transform.

## G1 exit

```text
An exact production-seam map, not a new architecture.
```

The last safe point is `compaction.ts:1813` / `agentic-compaction.ts:74`,
owned by `createCompactionStateAwarePrepareTurn`. Input B can be produced
there without inserting a canonical user message, disturbing tool-call
pairing, or consuming the compaction state.
