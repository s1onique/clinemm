# ACT-CLINEMM-COMPACTION-INCREMENTAL-KNOWLEDGE-LOSS-DISCRIMINATOR-01 — C1 production compaction boundary map

## 1. THE CONCEPTUAL CHAIN AND ITS OWNERS

Every boundary below was located in the SOURCE, not assumed. Paths are
relative to the repository root.

```text
Canonical source history
    → Compaction input selection
    → Summarizer input
    → Generated summary
    → Task-contract / evidence projection
    → Persisted compaction state
    → Restored / projected working context
    → Provider-visible continuation
```

| # | Boundary | Owning function | File:span |
| --- | --- | --- | --- |
| B1 | Canonical source history | `canonicalSourceMessages()` / `countCanonicalSourceMessages()` | `sdk/packages/core/src/session/models/session-compaction.ts:54-85` |
| B2 | Compaction eligibility and strategy selection | `createContextCompactionPrepareTurn()` | `sdk/packages/core/src/extensions/context/compaction.ts:617-1511` |
| B3 | Retained-tail cut | `findCutIndex()` | `sdk/packages/core/src/extensions/context/compaction-shared.ts:596-652` |
| B4 | Summarizer input selection (budget projection) | `buildAgenticSummaryInputBudget()` → `buildBudgetProjection()` | `sdk/packages/core/src/extensions/context/agentic-compaction.ts:31-42` |
| B5 | **Summarizer input rendering** | `serializeConversation()` → `serializeMessage()` → `renderStructuredToolPayload()` | `sdk/packages/core/src/extensions/context/compaction-shared.ts:258-280, 387-440` |
| B6 | Summarizer request assembly | `buildSummaryRequest()` | `sdk/packages/core/src/extensions/context/compaction-shared.ts:943-977` |
| B7 | Summarizer configuration | `resolveSummarizerConfig()` | `sdk/packages/core/src/extensions/context/compaction-shared.ts:1002-1040` |
| B8 | Ordinary agentic summarization | `runAgenticCompaction()` | `sdk/packages/core/src/extensions/context/agentic-compaction.ts:52-262` |
| B9 | Summarizer transport | `generateSummary()` | `sdk/packages/core/src/extensions/context/summary-generation.ts:4-38` |
| B10 | Generated summary → summary message | `buildSummaryMessage()` / `ensureFilesSection()` | `sdk/packages/core/src/extensions/context/compaction-shared.ts:933-941, 1042+` |
| B11 | Task-contract preservation | `applyTaskContractToCompactedMessages()` | `sdk/packages/core/src/extensions/context/task-contract.ts:358-392` |
| B12 | Verified-outcome preservation | `applyVerifiedEvidenceToCompactedMessages()` | `sdk/packages/core/src/extensions/context/evidence-continuity.ts` |
| B13 | Evidence adjudication | `applyAdjudicationCarryForward()` | `sdk/packages/core/src/extensions/context/compaction.ts:1588-1637` |
| B14 | PCK generation | `generatePreCompactionKnowledgeCheckpoint()` | `sdk/packages/core/src/extensions/context/compaction.ts:1671-1750` |
| B15 | PCK publication | `projectPreCompactionKnowledgeCheckpoint()` | `sdk/packages/core/src/extensions/context/compaction.ts:1765-1777` |
| B16 | Persisted compaction state | `createSessionCompactionState()` | `sdk/packages/core/src/session/models/session-compaction.ts:201-227` |
| B17 | State persistence / restoration | `projectSessionCompactionState()`; `persistSessionCompactionState()`; `updateSessionCompactionState()` | `session-compaction.ts:229-259`; `persistence-service.ts:336-351`; `local-runtime-host.ts:2307-2408` |
| B18 | Provider-visible continuation assembly | `createCompactionStateAwarePrepareTurn()` | `sdk/packages/core/src/extensions/context/compaction.ts:1779-2287` |
| B19 | Working-agent model invocation | `AgentRuntime.prepareTurnForModelRequest()` / `streamPreparedRequest()` | `sdk/packages/agents/src/agent-runtime.ts:4701-4910, 2981-3475` |

## 2. WHERE SEMANTIC KNOWLEDGE MAY DISAPPEAR OR BECOME DISTORTED

### B5 — THE SUMMARIZER-INPUT RENDERING (the decisive boundary)

`renderStructuredToolPayload()` (`compaction-shared.ts:258-280`) renders ONE
structured tool payload for the summarizer input:

```ts
const status = classifyStructuredPayloadStatus(payload);
const classification = typeof rawQuery === "string" ? classifyCommand(rawQuery) : "";
const label = classification || `#${index + 1}`;
const rawResult = payload.result;
const sourceFileFact = buildSourceFileFact(payload, toolName);
if (sourceFileFact) {
    return `[${status}] source-file ${sourceFileFact.path}: ${sourceFileFact.excerpt}`;
}
const approvedResult =
    typeof rawResult === "boolean" ? `result=${rawResult}`
    : typeof rawResult === "number" && Number.isFinite(rawResult) ? `result=${rawResult}`
    : OMITTED_STRUCTURED_RESULT_MARKER;                       // "[result omitted]"
return `[${status}] ${label}: ${approvedResult}`;
```

Two independent losses occur here for a `run_commands` payload:

1. **THE BODY IS OMITTED.** An arbitrary command's stdout is replaced by
   `[result omitted]`. This is the documented, deliberate confidentiality
   policy (`ACT-CLINEMM-COMPACTION-EVIDENCE-FIDELITY-01`).
2. **THE COMMAND IDENTITY IS LOST.** `classifyCommand()` matches the
   command's LEADING WORDS against a finite allowlist. Every W1 command
   begins `cd <path> && <cmd>`, and `cd` is not in the allowlist, so the
   classification is EMPTY and the label degrades to `#1`.

### MEASURED CONSEQUENCE ON W1

The ACT measured the production rendering of the W1 source prefix through the
production `findCutIndex()` → `buildAgenticSummaryInputBudget()` →
`serializeConversation()` chain:

```text
cutIndex:                 194  of 244
budget status:            ok   (estimated 114,458 tokens, 185 messages)
conversationText chars:   46,531
summaryRequest chars:     46,902
[succeeded] markers:      90
[result omitted] markers: 90
```

**Every one of the 90 successful commands reaches the summarizer as
`[succeeded] #1: [result omitted]`** — a contentless, identically-labelled
line. A representative sample of the ACT's own measured rendering:

```text
[Tool result]: [succeeded] #1: [result omitted]
[Tool result]: [succeeded] #1: [result omitted]
...
```

The summarizer therefore observes **90 successes and zero evidence content**,
and cannot even tell which commands succeeded. This is the boundary at which
the investigation's acquired knowledge stops existing for the compaction.

### B14/B15 — THE PCK (default OFF)

`generatePreCompactionKnowledgeCheckpoint()` returns `[]` immediately when
`isPckClosedEnabled()` is false. It is reached ONLY on the FIRST compaction of
a session, on the AGENTIC path, and is bound to the compaction DECISION
identity and the CANONICAL source-prefix identity. It is projected AFTER the
summary and every existing enrichment, and BEFORE the sidecar is written and
BEFORE the provider projection is built.

### B16/B17 — PERSISTENCE AND RESTORATION

`createSessionCompactionState()` derives `source_message_count` from
`canonicalSourceMessages(input.sourceMessages)` and records
`source_prefix_hash` over the SAME collection. `projectSessionCompactionState()`
projects `[...state.messages, ...sourceMessages.slice(state.source_message_count)]`
and REFUSES to project when the prefix hash does not match. The persisted
sidecar is therefore a byte-stable historical snapshot.

### B18 — THE PROVIDER-VISIBLE CONTINUATION

`createCompactionStateAwarePrepareTurn()` has two branches:

- **Re-compaction branch** (a state already exists): projects the persisted
  state over the canonical history, then restores the task contract and the
  verified outcomes **scoped to the SIDECAR'S OWN `source_message_count`**,
  so the provider-visible prefix stays byte-stable across continuations.
- **First-compaction branch**: runs the compaction, applies the task contract,
  the verified outcomes and the adjudication carry-forwards, then the PCK
  projection, then persists, then publishes the working-context estimate.

Both branches preserve the **retained canonical tail** verbatim.

## 3. EXISTING DIAGNOSTICS AND TEST SEAMS

| Mechanism | Where | Observable? |
| --- | --- | --- |
| Compaction decision diagnostics (`requestInputTokens`, `triggerTokens`, `maxInputTokens`, `decisionId`) | `compaction.ts:826-960` | yes, when a trace sink is armed |
| Working-context estimate publication | `publishWorkingContextEstimate()` | yes |
| Model behaviour trace | `modelBehaviorTraceSink` | yes |
| Private compaction candidate capture | `captureCompactionDecisionCandidate()` | yes, opt-in |
| PCK own diagnostics (decision id, prefix key, deadline, failure reason) | `compaction.ts:1698-1739` | yes |
| **The summarizer's INPUT** | — | **NOT** instrumented in production; the ACT measured it out-of-band |
| **The summarizer's OUTPUT** | — | **NOT** persisted; only the resulting summary is |
| **The provider-visible request** | — | **NOT** persisted |

**The three un-instrumented boundaries are exactly the ones this ACT had to
measure out-of-band.** They are noted in the exit report as a bounded
observability gap, not as a defect claim.

## 4. WHAT IS SAFELY OBSERVABLE AND WHAT IS NOT

| Boundary | Observable in this ACT? | How |
| --- | --- | --- |
| B1 canonical history | **YES** | the persisted file, SHA-256 verified |
| B2 eligibility | **YES** | the production seam was driven directly |
| B3 retained-tail cut | **YES** | production `findCutIndex()`, measured |
| B4/B5 summarizer input | **YES** | production `serializeConversation()`, measured |
| B6 summarizer request | **YES** | production `buildSummaryRequest()`, measured |
| B7 summarizer config | **YES** | production `resolveSummarizerConfig()` |
| B8/B9 summarization | **YES** | production `generateSummary()` against the live endpoint |
| B10 summary message | **YES** | production `buildSummaryMessage()` |
| B11/B12/B13 carry-forwards | **YES** | the production functions, driven directly |
| B14/B15 PCK | **YES** | default OFF; the disabled path was witnessed |
| B16/B17 persistence and restoration | **YES** | the production functions, driven directly |
| B18 provider-visible assembly | **YES** (reconstructed) | the production projector + carry-forwards |
| B19 working-agent invocation | **PARTIAL** | the probe harness uses the production transport (`createHandlerAsync`) but NOT the full agent runtime turn loop |

**The exercised seam is stated precisely:** the ACT exercised the production
**compaction composition** (`createContextCompactionPrepareTurn`'s production
pieces: `findCutIndex`, `buildAgenticSummaryInputBudget`,
`serializeConversation`, `buildSummaryRequest`, `resolveSummarizerConfig`,
`generateSummary`, `buildSummaryMessage`) plus the production
**carry-forward, persistence and projection** functions. It did **not**
implement a second compacter, and it did **not** re-implement compaction
behaviour in the harness.

**A second compacter was NOT written.** `replayOrdinaryCompaction()` in
`sdk/packages/core/scripts/knowledge-loss-discriminator.arms.ts` is a
SEQUENCE OF PRODUCTION CALLS, not a re-implementation: every step is a
production function invoked with production arguments.

## 5. THE LOCATION OF THE FIRST LOSS

```text
SUMMARIZER_INPUT_SELECTION   ← B5: renderStructuredToolPayload()
                               (90 of 90 command bodies replaced by
                                "[result omitted]", command identity lost)
```

The loss is NOT at B11/B12 (the task contract and the verified-outcome
carry-forward both work and both carried), and NOT at B16/B17 (the sidecar
round-trips exactly), and NOT at B18 (the projection is faithful).

It is at **B5**, and it is **upstream of every downstream mechanism**. No
downstream mechanism can conserve what B5 destroys, because the task contract
carries the INITIAL BRIEF, the verified-outcome ledger carries CALL STATUS
WITHOUT SUBSTANCE, and the adjudication section is EMPTY for this workload
(`adjudicationSectionChars: 0`).
