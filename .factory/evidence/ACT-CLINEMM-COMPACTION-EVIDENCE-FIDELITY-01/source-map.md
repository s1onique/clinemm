# Source map — ACT-CLINEMM-COMPACTION-EVIDENCE-FIDELITY-01

## Entry identity

| Item | Value |
|---|---|
| Repository | `s1onique/clinemm` (local: `/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm`) |
| Entry HEAD | `bd39be9da2d0a610c173fbc205e2bdea570f8e70` |
| Branch | `main` |
| Runtime | bun `1.3.14` (package manager + task runner), Node runtime for the VS Code extension host |
| SDK package under repair | `@cline/core` (`sdk/packages/core`), version `0.2.0` |
| Subject source revision (audited repo) | Keycloak `42de653b59708e712d694aeb9732f822b7f8fe5b`, branch `optimize-ftls` |
| Historical session | `1795382314359_rb19c` |
| Provider-capture run | `yHaQSIjO` |
| Capture client version | `4.1.26-bd39be9da` (matches the entry HEAD's short hash) |

The capture run's `correlation.clientVersion` is `4.1.26-bd39be9da`, and the session
sidecar's `metadata.sessionHistoryOrigin.version` is the same string. The session and
capture-run identities therefore correspond, and both bind to the entry HEAD.

## Production boundary — the files that own the lost evidence

| File | Role in the path | Why it matters |
|---|---|---|
| `sdk/packages/core/src/extensions/context/compaction.ts` | Strategy selection, state-aware seam, persistence | Owns `createContextCompactionPrepareTurn` and `createCompactionStateAwarePrepareTurn`; applies the task-contract and evidence-continuity carry-forwards and publishes the working-context estimate. |
| `sdk/packages/core/src/extensions/context/compaction-shared.ts` | **RESPONSIBLE TRANSFORMATION** | `renderStructuredToolPayload()` renders a structured `{query, result, success}` payload with a STRING `result` as the literal `[result omitted]`. `serializeMessage()` builds the summarizer input through it. |
| `sdk/packages/core/src/extensions/context/agentic-compaction.ts` | Summarizer invocation | `runAgenticCompaction()` folds the prefix, calls `serializeConversation()` and `buildSummaryRequest()`. The summarizer never sees an omitted payload body. |
| `sdk/packages/core/src/extensions/context/basic-compaction.ts` | Deterministic strategy | Not on the historical path (the historical summary is prose, i.e. agentic). |
| `sdk/packages/core/src/extensions/context/evidence-continuity.ts` | Deterministic carry-forward | `extractVerifiedToolOutcomes()` + `renderEvidenceSection()` + `applyVerifiedEvidenceToCompactedMessages()` carry VERIFIED OUTCOMES (status + allowlisted classification). **Repaired in this ACT** to also carry a bounded, source-attributed file fact, in a SEPARATE, independently budgeted section (`MAX_CARRIED_FILE_FACTS`), because an execution-status budget must not decide whether a factual excerpt survives (CORRECTION01, P0-2). |
| `sdk/packages/core/src/extensions/context/task-contract.ts` | Task-contract carry-forward | Carries the original user requirements and the terminal completion obligation. Unchanged. |
| `sdk/packages/core/src/session/models/session-compaction.ts` | Persisted compaction state | `createSessionCompactionState()` / `projectSessionCompactionState()` bind the persisted sidecar to the canonical source history. Unchanged. |
| `sdk/packages/core/src/agent-runtime.ts` (agents package) | Model dispatch | `MessageBuilder.buildForApi` is the last production transformation before the provider request. Unchanged. |
| `sdk/packages/core/src/extensions/context/budget-projection/project.ts` | Summarizer-input budget | Selects which messages are folded. Confirmed NOT responsible: the payload reached the serializer and was omitted there. |

## Complete path (as traced)

```
Canonical messages
  -> compaction strategy selection          compaction.ts (strategy = "agentic")
  -> cut boundary / source-message identity  findCutIndex() + previous-summary fold
  -> summarizer input, if agentic           serializeConversation() -> serializeMessage()
                                              -> flattenToolResultContent()
                                              -> renderStructuredToolPayload()   <-- LOSS HERE
  -> compacted message projection           buildSummaryMessage()
  -> task-contract carry-forward            applyTaskContractToCompactedMessages()
  -> verified-outcome carry-forward         applyVerifiedEvidenceToCompactedMessages()
  -> persisted compaction state             createSessionCompactionState()
  -> MessageBuilder.buildForApi             provider-visible projection
  -> beforeModel                            agent runtime checkpoint
  -> final provider request                 captured in provider-request-captures/
```

## Exact producers of the strings named by the ACT

| String | Producer | Location |
|---|---|---|
| `Context summary:` | `buildSummaryMessage()` | `compaction-shared.ts` |
| `Verified tool outcomes (canonical record)` | `EVIDENCE_SECTION_HEADING` | `evidence-continuity.ts` |
| `[result omitted]` | `OMITTED_STRUCTURED_RESULT_MARKER` | `compaction-shared.ts` |
| `## Source file facts (canonical record)` | `SOURCE_FILE_FACT_SECTION_HEADING` | `evidence-continuity.ts` (CORRECTION01) |
| `Concrete outputs ... are omitted` | Model-generated summary prose | (model output, not a production constant) |
| `Actual command outputs ... were omitted` | Model-generated summary prose | (model output, not a production constant) |

The last two are **model assertions**, not production strings. The production
pipeline never wrote them; the summarizer wrote them because it never saw the
outputs. This is why the historical summary's claim is a *symptom*, not the defect.

## Historical strategy determination

The historical boundary used the **agentic** strategy. Evidence (not inference from
the summary's appearance):

- The post-compaction `messages[0]` in the captured provider request is a
  `Context summary:` block with prose sections (`## Goal`, `## State`, `## Highlights`,
  `## Next`, `## Files`) — the shape `buildSummaryMessage()` produces from a generated
  summary.
- The persisted sidecar's `messages[0].metadata.kind` is `compaction_summary` with a
  populated `metadata.summary` and `metadata.tokensBefore`.
- The `basic` strategy produces no LLM summary at all, so the presence of a generated
  prose summary excludes it.
- Overflow recovery is excluded: `overflowRecovery` forces the *deterministic basic*
  strategy, which would not produce prose.

## Verdict-relevant note on the responsible transformation

`renderStructuredToolPayload()` is responsible for the REPRESENTATION loss. The
model's later behaviour (re-investigation) is a separate causal link, qualified in
`causal-discriminator.md`.


## CORRECTION01 note (see `correction-record.md`)

`renderStructuredToolPayload()` remains the RESPONSIBLE TRANSFORMATION for the representation
loss, and that conclusion is unchanged by the review. What CORRECTION01 changed is:

1. The **historical replay prefix**: each boundary is replayed over its OWN authoritative
   canonical prefix, not the final session history.
2. The **deterministic carry-forward**: the source-file facts now have their own section and
   their own budget, so the fact survives even when the summarizer omits it AND the outcome
   budget has moved past it.
3. The **confidentiality contract** of the excerpt path: the excerpt is redacted with the
   module's existing value-position sanitizer.
4. The **behavioural causal claim**: withdrawn (the observed tool call predated the boundary).
