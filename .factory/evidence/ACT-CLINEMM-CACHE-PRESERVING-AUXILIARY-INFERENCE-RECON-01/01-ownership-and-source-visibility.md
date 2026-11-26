# ACT-CLINEMM-CACHE-PRESERVING-AUXILIARY-INFERENCE-RECON-01 — 01 ownership and source visibility

ENTRY_HEAD: `fec5efd83b0294774c604e77c1da68cdaca62922` (== the accepted historical anchor).
Tracked tree clean at entry. No other worktree, stash or extension was touched.

## C0 — production ownership

| Mechanism | Boundary | Owner (file :: function) |
|---|---|---|
| Ordinary parent request | Initiator | `sdk/packages/agents/src/agent-runtime.ts` → the agent loop dispatches `handler.createMessage(systemPrompt, messages, tools)` |
| Ordinary parent request | Provider-visible projection | `sdk/packages/core/src/session/services/message-builder.ts` :: `MessageBuilder.buildForApi` |
| Ordinary parent request | Wire serialization | `sdk/packages/llms/src/providers/compat.ts` :: `buildGatewayRequest` → `sdk/packages/llms/src/providers/ai-sdk.ts` |
| Ordinary parent request | System instructions | the host's system prompt, plus the R2 objective projection (`agent-runtime.ts` :: `projectActiveBoundedObjective`) |
| PCK | Initiator | `sdk/packages/core/src/extensions/context/compaction.ts` :: `generatePreCompactionKnowledgeCheckpoint` (called from the compaction eligibility decision) |
| PCK | Attempt | `.../precompaction-knowledge-checkpoint/runtime.ts` :: `runPckAttempt` |
| PCK | Request construction | `.../precompaction-knowledge-checkpoint/model-request.ts` :: `buildCheckpointInputView`, `buildCheckpointRequest`, `CHECKPOINT_SYSTEM_PROMPT` |
| PCK | Transport | `sdk/packages/core/src/extensions/context/summary-generation.ts` :: `generateSummary` (system prompt + ONE user message, NO tools) — wired in `sdk/packages/core/src/runtime/host/local-runtime-host.ts` |
| PCK | Acceptance | `.../precompaction-knowledge-checkpoint/publication-gate.ts` :: `gateClosedProposals` (closed vocabulary + observed-reference attribution) |
| PCK | Installation | `compaction.ts` :: the accepted records are projected into the compacted summary message |
| PCK | Deadline | `runtime.ts` :: `DEFAULT_PCK_DEADLINE_MS = 180_000`, `createPckAbortHandle` (task signal OR deadline) |
| R2 selector | Initiator | `sdk/packages/agents/src/agent-runtime.ts` :: the bounded-objective selection inference |
| R2 selector | Prompt | `agent-runtime.ts` :: `buildBoundedObjectiveSelectionPrompt` (+ `BOUNDED_OBJECTIVE_SELECTION_PROMPT`) |
| R2 selector | Validation | `sdk/packages/shared/src/agents/bounded-objective.ts` :: `validateBoundedObjective` |
| R2 objective projection | Parent dispatch | `agent-runtime.ts` :: `projectActiveBoundedObjective` → `renderBoundedObjectiveInstruction` (`bounded-objective.ts`), appended to the **system prompt** |
| R2 usage | Accounting | the selection observation carries `selectorRequestId`; the frozen usage record has NO session/request correlation |

## PCK source-visibility contract

* The checkpoint is generated from `context.messages` — the **entire canonical history** at the compaction decision, NOT the messages scheduled for compaction
  (`compaction.ts`: `canonicalMessages: context.messages`).
* The controlled view renders that whole list: assistant TEXT, tool calls as bounded labels, tool results with status + body, and **no private reasoning**
  (`model-request.ts` :: `renderMessageForCheckpoint`).
* Attribution is enforced: the publication gate rejects a record whose `evidenceRefs` are not observed canonical references
  (`publication-gate.ts`: `REFERENCE_NOT_CANONICAL`).
* Executable confirmation: `02c-authority-and-isolation.json` → `sourceVisibility.viewRendersWholeCanonicalList = true`,
  `sourceAttributionEnforcement.codes = ["REFERENCE_NOT_CANONICAL"]`.

## R2 source-visibility contract

* The selector receives: the parent task text, the parent obligation reference ids, the outstanding acceptance obligations, the **stagnation-only**
  "Established observations" list, the available tools and the remaining allowance. It receives **no** parent tool activity, **no** verification
  outcomes and **no** transcript tail.
* Executable confirmation: `02d-r2-selector-visibility.json` → `0 of 1427 parent activity shingles appear verbatim in the selector prompt`,
  parent history = 488 messages / 239 tool calls / 205 tool results.

## C6 — authority and isolation (executable, `02c-authority-and-isolation.json`)

| Control | Result |
|---|---|
| Activation forgery denial | A forged `<<< cline-aux-activation >>>` marker in the transcript does NOT enable PCK: `isPckClosedEnabled({}) = false`; only the runtime env opt-in (`= "1"`) enables it |
| Tool execution denial | A checkpoint response that attempted a tool call is rejected: `failureReason = "tool_call_attempted"`, no record accepted. The request itself carries **no** tools |
| Canonical history isolation | `buildCheckpointInputView` leaves the canonical list byte-identical (`historyUnchanged = true`) |
| Deadline authority | A never-settling generation is aborted by the deadline: `failureReason = "timeout"`, default deadline `180000 ms` |
| Source attribution | An unobserved `evidenceRef` is rejected with `REFERENCE_NOT_CANONICAL` |

## C4 — parent-return (executable, `02b-pck-prefix-equivalence.json`)

* `parentBeforeEqualsParentAfter = true` — the parent's own serialized body is unchanged by the auxiliary branch.
* `candidateBWithoutSuffixEqualsParent = true` — removing the appended suffix reproduces the parent's body byte-for-byte.
* Engine-level cache RESIDENCY is **NOT_EXECUTED** (no live inference is permitted in this ACT).
