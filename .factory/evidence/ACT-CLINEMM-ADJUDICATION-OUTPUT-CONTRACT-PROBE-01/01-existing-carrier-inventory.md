# 01 — Existing carrier inventory (G1)

This is the RECON section. It inspects the REAL source and the REAL tests
before freezing any representation. The rule followed throughout: **do not
assume a capability merely because the TypeScript union permits its shape.**

## The files that actually decide the question

| Concern | Real source |
|---|---|
| M1 source selection (the loss boundary) | `sdk/packages/core/src/extensions/context/budget-projection/project.ts` |
| Agentic compaction driver | `sdk/packages/core/src/extensions/context/agentic-compaction.ts` |
| Canonical serialization for the summarizer | `sdk/packages/core/src/extensions/context/compaction-shared.ts` |
| Provider response -> canonical assistant message | `sdk/packages/core/src/runtime/config/agent-message-codec.ts` |
| Provider stream -> agent message parts | `sdk/packages/agents/src/agent-runtime.ts` |
| Provider stream -> API stream chunks | `sdk/packages/llms/src/providers/ai-sdk.ts` |
| Provider stream chunk shapes | `sdk/packages/llms/src/providers/stream.ts` |
| Canonical block union | `sdk/packages/shared/src/llms/messages.ts` |
| Canonical persistence normalization | `sdk/packages/core/src/services/session-data.ts` |
| Provider-visible projection | `sdk/packages/core/src/session/services/message-builder.ts` |
| User/runtime authority carrier (the only existing structured carrier) | `sdk/packages/core/src/extensions/context/task-contract.ts` |

## 1. Converting provider responses into canonical assistant messages

The chain is:

```text
provider wire  ->  ai-sdk.ts (fullStream parts)  ->  AgentModelEvent
                ->  agent-runtime.ts (sequence of parts)  ->  AgentMessage
                ->  agent-message-codec.ts (agentPartToContentBlock)  ->  ContentBlock[]
                ->  session-data.ts (normalizeStoredMessagesForPersistence)  ->  persisted
```

Concretely, `agent-runtime.ts` builds ONE assistant message whose `content`
array receives, in stream order, `text` parts, `reasoning` parts and
`tool-call` parts:

```ts
// sdk/packages/agents/src/agent-runtime.ts (stream loop)
case "text-delta": {
    accumulatedText += event.text;
    const last = sequence.at(-1);
    if (last?.type === "part" && last.part.type === "text") {
        last.part.text += event.text;      // merges into the SAME text part
    } else {
        sequence.push({ type: "part", part: { type: "text", text: event.text } });
    }
    ...
}
```

and at the end of the turn:

```ts
const message = createMessage("assistant", content, ...);
```

where `content` holds every part collected from the stream. **A text part
and a tool-call part therefore coexist in the same assistant turn** — this
is not a type-level possibility, it is how the runtime is written.

The mapping back to canonical blocks is `agentPartToContentBlock`:

```ts
case "text":   return { type: "text", text: part.text };
case "reasoning": return { type: "thinking", thinking: part.text, ... };
case "tool-call": return { type: "tool_use", id: part.toolCallId, name: part.toolName, input: part.input ?? {}, ... };
```

## 2. Differentiating `thinking`, `text` and `tool_use` blocks

`ContentBlock` (`sdk/packages/shared/src/llms/messages.ts`) is a closed union:

```ts
export type ContentBlock =
    | TextContent | ImageContent | MediaContent
    | ToolUseContent | ToolResultContent
    | ThinkingContent | FileContent | RedactedThinkingContent;
```

`TextContent` is `{ type: "text"; text: string; signature?: string }`.
`ThinkingContent` is `{ type: "thinking"; thinking: string; ... }`.
`ToolUseContent` is `{ type: "tool_use"; id; name; input; ... }`.

They are DISTINCT types with DISTINCT fields. A `text` block is never
confused with a `thinking` block, and the runtime's own code relies on
that distinction (`agent-runtime.ts` treats `reasoning` and `text`
differently in the retry predicate: "no content beyond reasoning").

## 3. Handling assistant text emitted alongside tool calls

**There is no text suppression on tool-use turns.** Verified by inspection
of the real code:

- `sdk/packages/llms/src/providers/ai-sdk.ts:1571` yields `text-delta`
  independently of the tool-call part handling; there is no branch that
  drops text when a tool call is also present.
- `sdk/packages/agents/src/agent-runtime.ts` has no
  suppress/discard/drop-text logic; the only `text` handling is the
  accumulation above.
- The turn-level predicates that DO branch on content
  (`isRetryableProviderErrorTurn`, `isRecoverableMaxTokensTurn`) branch on
  `tool-call` PRESENCE to decide retry behaviour, never to suppress text.

## 4. Persisting canonical assistant messages

`normalizeStoredMessagesForPersistence()`
(`sdk/packages/core/src/services/session-data.ts:114`) maps each stored
message through `normalizeStoredMessageModelMetadata`, which normalizes
`modelInfo` and leaves `content` untouched. The `text` block therefore
survives persistence VERBATIM.

## 5. Reconstructing provider-visible requests

`MessageBuilder.buildForApi()` (`message-builder.ts:219`) transforms the
canonical messages into the provider-visible projection. For assistant
`text` blocks it applies `truncateAssistantText`, whose default limit is

## 6. Selecting and serializing messages for agentic compaction

`runAgenticCompaction()` (`agentic-compaction.ts:52`) drives:

```text
findCutIndex -> buildAgenticSummaryInputBudget (M1) -> extractFileOps
              -> serializeConversation -> buildSummaryRequest
              -> generateSummary -> buildSummaryMessage
```

`buildAgenticSummaryInputBudget` calls `buildBudgetProjection` with
`policyIntent: "agentic_summary"`, whose policy is:

```ts
case "agentic_summary":
case "basic_compaction_projection":
    return {
        protectLatestTypedUser: true,
        protectLiveTailFromDrop: true,
        dropUnsafeOutsideLiveTail: true,
        dropThinkingBlocks: true,       // <-- the ONLY block type dropped
    };
```

`dropThinkingBlocks` is the ONLY content-block drop in that policy. A
`text` block is NOT dropped.

`serializeMessage()` renders blocks as:

```ts
case "text":    lines.push(`[${...}]: ${block.text}`);      // assistant -> "[Bot]: ..."
case "thinking": lines.push(`[Bot thinking]: ${truncateText(block.thinking, 2_000)}`);
```

So an assistant `text` block reaches the summarizer's input window as
`[Bot]: <the envelope>`, while a `thinking` block is dropped entirely by
M1 and therefore never reaches it at all.

## The capability matrix

| Candidate | Question | Verdict | Evidence |
|---|---|---|---|
| Assistant `text` | Can a model publish an explicit text block without ending the task? | **YES** | `text` is a first-class canonical block; the runtime accumulates it in the same assistant turn as tool calls; a text-only turn is an ordinary turn |
| `text` plus `tool_use` | Can both coexist in the same canonical assistant turn? | **YES** | `agent-runtime.ts` pushes both into ONE `content` array; `ai-sdk.ts` yields text independently of tool calls; no suppression path exists. Live-confirmed in `06-adversarial-controls.md` (the publishing turn also carried a tool call in every successful live run) |
| Existing tool mechanism | Can a model publish a structured, side-effect-free artifact using an existing authorized tool? | **NO** | The registered tools are `read_files`, `search_codebase`, `run_commands`, `fetch_web_content`, `apply_patch`, `editor`, `skills`, `ask_question`, `submit_and_exit` (`definitions.ts`). Every one of them either mutates the workspace, executes a command, or terminates the run. `submit_and_exit` carries `lifecycle.completesRun === true` and ENDS the task, which is the opposite of "without ending the task". There is no side-effect-free structured-publication tool |
| Existing task/progress state | Is there already a suitable non-reasoning progress carrier? | **PARTIAL — but NOT for model-authored adjudication** | `task-contract.ts` IS a structured non-reasoning carrier, but its authority is explicitly `"user" | "runtime"` and its extractor only accepts a user turn start or a runtime-stamped completion reminder (`isCompletionToolReminderMessage`). It can NEVER carry a model-authored adjudication, and promoting one into it would be exactly the authority escalation the ACT forbids. `evidence-continuity.ts` carries TOOL OUTCOMES (evidence), not adjudications (verdicts) |
| Provider-specific output | Does the model/adapter suppress assistant text during tool-use turns? | **NO** | No suppression path in `ai-sdk.ts` or `agent-runtime.ts` |

## G1 exit

```text
EXISTING_TEXT_CARRIER:          YES
TEXT_AND_TOOL_USE:               YES
CANONICAL_PERSISTENCE:           YES
COMPACTION_INPUT_VISIBILITY:     YES
EXISTING_STRUCTURED_CARRIER:     NO   (for model-authored adjudication state)
```

`NO_EXISTING_CARRIER` is **NOT** triggered. The existing runtime already
carries a bounded, strictly-parseable, non-reasoning model-authored artifact
from the provider response through canonical persistence into the
summarizer's input window. A new public protocol is NOT required for the
publication step.

**The remaining open boundary — which no carrier can close by itself — is
CONTINUITY, not PUBLICATION.** The summarizer is a separate model call and
may omit the envelope from its summary; the probe measures that explicitly
as the mandatory negative control in `05-compaction-consumer-probe.md`.

`DEFAULT_MAX_ASSISTANT_TEXT_CHARS = 200_000` — two orders of magnitude
above the bounded envelope size (the contract caps a carrier at 2,000
characters). `DEFAULT_MAX_ASSISTANT_TOOL_MARKUP_CHARS = 12_000` only
applies to text containing REPEATED tool-call markup, which a strict JSON
envelope cannot contain.
