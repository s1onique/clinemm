# 01 — Production compaction seam map

**Evidence class:** `REAL` — read from the checked-out source at ENTRY_HEAD
`502d31c5821492147ff1019773d3b5e30fedbbb8`.

---

## 1.1 The source inventory the ACT named

| Path | Present | Role |
|---|---|---|
| `sdk/packages/core/src/extensions/context/agentic-compaction.ts` | OK 262 lines | The agentic compaction driver |
| `sdk/packages/core/src/extensions/context/compaction-shared.ts` | OK 1066 lines | Cut index, serializer, summary request/message, file-op extraction |
| `sdk/packages/core/src/extensions/context/compaction.ts` | OK 2226 lines | Prepare-turn seams, budget guard, carry-forward orchestration |
| `sdk/packages/core/src/extensions/context/budget-projection/project.ts` | OK 668 lines | Summarizer input budget projection |
| `sdk/packages/core/src/extensions/context/evidence-continuity.ts` | OK 2469 lines | Verified-outcome carry-forward, source-file facts |
| `sdk/packages/core/src/extensions/context/task-contract.ts` | OK 566 lines | Task-contract carry-forward |
| `sdk/packages/core/src/extensions/context/adjudication-continuity.ts` | OK 2925 lines | Adjudication binding + carry-forward (closest existing analog) |
| `sdk/packages/core/src/session/models/session-compaction.ts` | OK 246 lines | Canonical source messages, prefix hash, sidecar state, projection |
| SDK provider-request construction | OK | `sdk/packages/core/src/session/services/message-builder.ts` — `MessageBuilder.buildForApi()` at line 219 |

---

## 1.2 The actual sequence, confirmed against the source

```text
Canonical messages
    |
    v  compaction.ts: createCompactionStateAwarePrepareTurn
    |      (getState -> existing sidecar; prepareApiMessages; saveState)
    v  compaction.ts: createContextCompactionPrepareTurn({strategy:"agentic"})
    |      -> budget guard (shouldCompact / requestInputTokens vs trigger)
    v  agentic-compaction.ts: runAgenticCompaction
    |
    |- findCutIndex(messages, preserveRecentTokens, estimateMessageTokens)   [compaction-shared.ts:596]
    |- messagesToSummarize = messages.slice(0, cutIndex)
    |- latestSummaryIndex = findLatestSummaryIndex(messagesToSummarize)      [compaction-shared.ts:571]
    |- newMessagesToFold = messagesToSummarize.slice(latestSummaryIndex + 1)
    |- preProjectionFileOps = extractFileOps(messagesToSummarize)
    |- resolveSummarizerConfig(...) -> summarizerProviderConfig
    |- availableSummaryInputTokens = summarizerInputLimit - summaryRequestOverheadTokens
    |- summaryInputBudget = buildAgenticSummaryInputBudget({messages: newMessagesToFold, ...})
    |      -> buildBudgetProjection({policyIntent: "agentic_summary"})         [budget-projection/project.ts]
    |- fileOps         = extractFileOps(summaryInputBudget.messages)
    |- conversationText = serializeConversation(summaryInputBudget.messages)   [compaction-shared.ts:438]
    |- summaryRequest  = buildSummaryRequest({previousSummary, conversationText, fileOps})
    |- summaryResult   = await generateSummary({providerConfig, systemPrompt, request})
    |- summary         = ensureFilesSection(rawSummary, fileOps)
    |- resultMessages  = [buildSummaryMessage({summary, fileOps, tokensBefore, userRunSpan}), ...messages.slice(cutIndex)]
    |
    v  compaction.ts: after the compaction callback returns
    |- applyTaskContractToCompactedMessages(result.messages, context.messages, contractBudget(...))
    |- applyVerifiedEvidenceToCompactedMessages(contracted.messages, context.messages, {sourceMessageCount})
    |- applyAdjudicationCarryForward(evidenced.messages, context.messages, input.adjudication, count)
    |- createSessionCompactionState({sourceMessages: context.messages, compactedMessages: contractedMessages, ...})
    |- await input.saveState?.(nextState, context.messages)
    v  compaction.ts: publishWorkingContextEstimate(...)
    v  MessageBuilder.buildForApi(installedMessages)
    v
Actual provider request
```

**Ownership and ordering confirmed.** The three production carry-forwards compose in the
order **task contract -> verified evidence -> adjudication**, each attached to the existing
`compaction_summary` message. A checkpoint carry-forward would slot in at the same level,
after the adjudication carry-forward and before `createSessionCompactionState`.

### The insertion point used by this probe

The probe applies the checkpoint projection **after** the production carry-forwards and
**before** the provider projection:

```text
... applyTaskContractToCompactedMessages
... applyVerifiedEvidenceToCompactedMessages
... [CHECKPOINT PROJECTION]           <- test-local, ACT-owned
... MessageBuilder.buildForApi
```

This mirrors `applyAdjudicationContinuityToCompactedMessages` exactly.

---

## 1.3 The three independent input sets (G1.2)

These are three DIFFERENT things, and conflating them is exactly the error the ACT warns
about.

### A — Canonical pre-compaction history

What the runtime stored: the canonical message list, from which
`canonicalSourceMessages()` selects the source prefix and `sourcePrefixHash()` computes
the persisted boundary identity.

At the two frozen boundaries this is the first **47** and first **101** canonical
messages of the 141-message transcript (see `00-entry-and-artifact-identity.md`).

### B — Actual summarizer-visible input

What survived source selection, budget projection and serialization:
`newMessagesToFold` -> `buildBudgetProjection(policyIntent: "agentic_summary")` ->
`serializeConversation()` -> `buildSummaryRequest()`.

Measured properties of this path in the current source:

- `buildBudgetProjection` with the `agentic_summary` policy **drops every `thinking`
  block** before any budget arithmetic. (Known contract — unchanged by this ACT.)
- `serializeMessage()` renders a `tool_result` whose content is a structured
  `{query, result, success}` payload through `renderStructuredToolPayload()`, which
  **never copies arbitrary command output**. The rendered form is
  `[succeeded] #1: [result omitted]`. (Known contract — unchanged by this ACT.)
- `serializeMessage()` truncates a `thinking` block at 2 000 characters.

### C — Post-compaction provider-visible continuation

What the working agent could see afterwards: the `compaction_summary` message (plus the
task-contract, verified-evidence and adjudication sections attached to it) followed by the
preserved tail, rendered through `MessageBuilder.buildForApi()`.

**The provider request BEFORE compaction is not automatically identical to the
summarizer input.** In the frozen captures the distinction is directly observable:

| | provider-visible messages | canonical prefix |
|---|---|---|
| boundary 1 pre | 30 | 47 |
| boundary 1 post | 11 | — |
| boundary 2 pre | 46 | 101 |
| boundary 2 post | 9 | — |

---

## 1.4 Earliest-disappearance matrix (G1.2)

For each selected witness, the stage at which the exact detail first disappears.

### R4 — `startup.sh` executes `kc.sh build`, then `kc.sh start --optimized`

| Stage | Verdict |
|---|---|
| A. Canonical pre-compaction history | **PRESENT** (canonical index 7 — a `tool_result` whose payload is the structured `{query, result, success}` shape) |
| B. Summarizer-visible input | **ABSENT** — `renderStructuredToolPayload()` renders the structured payload as `[succeeded] #1: [result omitted]`. The arbitrary command output that carries the observation is never copied. |
| C. Post-compaction provider-visible | **ABSENT** (0 occurrences in `post.json`) |

-> **L2** (removed during serialization/budget projection). The `kc.sh build` half of the
pair survives as a *topic* in the summary prose; the `--optimized` half never reaches
either the summarizer or the continuation.

### R6 — "No delete/purge found in those paths."

| Stage | Verdict |
|---|---|
| A. Canonical pre-compaction history | **PRESENT** at boundary 2 — but it lives in a `thinking` block |
| B. Summarizer-visible input | **ABSENT** — the `agentic_summary` budget policy drops every `thinking` block before serialization |
| C. Post-compaction provider-visible | **ABSENT** (0 occurrences in `second-post.json`) |

-> **L1** (absent from checkpoint/summarizer source selection).

### R2 — `MtsOmni` / `Megafon` provider identification

| Stage | Verdict |
|---|---|
| A. Canonical pre-compaction history | **PRESENT** at both boundaries (tool result at boundary 1; reasoning + tool results at boundary 2) |
| B. Summarizer-visible input | **ABSENT** at boundary 1 (structured payload -> `[result omitted]`); **PARTIAL** at boundary 2 (the identifier appears in the assistant's own reasoning-derived text, but not as a tool observation) |
| C. Post-compaction provider-visible | **ABSENT** (`MtsOmni`: 0 occurrences in both `post.json` and `second-post.json`; `Megafon` survives only inside reasoning prose at boundary 2) |

-> **L2** at boundary 1, **L1/L2** at boundary 2.

**Stages that are not observable from the trace:** the summarizer's own internal
tokenization of the request it received is `UNAVAILABLE_FROM_TRACE` — the captures are
provider-side, not summarizer-side. The summary prose itself IS available (it is the
`compaction_summary` message content in the post-compaction capture), so summarizer
omission (L3) and projection loss (L4) ARE distinguishable here.

---

## 1.5 Known findings NOT reopened (G1.3)

The following are existing contracts and were deliberately **not** changed by this ACT:

1. The `agentic_summary` budget policy drops thinking blocks. **Unchanged.**
2. The structured-output serializer deliberately omits arbitrary command-output strings.
   **Unchanged.** (This is the direct cause of R4's L2 loss — a known contract, not a
   defect introduced here.)
3. The automatic file-content carry-forward remains disabled
   (`SOURCE_FILE_FACT_CARRY_FORWARD_ENABLED = false`). **Unchanged.**

No production file was modified. The probe's own modules live under
`sdk/packages/core/src/extensions/context/knowledge-checkpoint-probe/` and are imported
only by the ACT's test and probe files.
