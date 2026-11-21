# ACT-CLINEMM-COMPACTION-SUMMARY-CHURN-01 — Source Map

**Entry HEAD:** `60432babb98729f1c6b7116c79f5709750472718` (`main`)
**Scope:** read-only recon + offline reproduction + disposable ablation. No production repair.

---

## 1. The provider-visible transformation boundary

The provider-visible compaction projection is produced by
`createCompactionStateAwarePrepareTurn()` in
`sdk/packages/core/src/extensions/context/compaction.ts:1422`.

Its provider-visible restoration path — the one that runs on EVERY turn
once a sidecar exists — is `compaction.ts:1605-1633`:

```
compaction.ts:1605   const projectedSystemPrompt = result?.systemPrompt ?? existingState.system_prompt;
compaction.ts:1613   const restored = await applyTaskContractToCompactedMessages(
compaction.ts:1614       projectedMessages,
compaction.ts:1615       context.messages,              // <-- CANONICAL, growing
compaction.ts:1616       contractBudget(...),
compaction.ts:1617   );
compaction.ts:1624   const restoredWithEvidence = applyVerifiedEvidenceToCompactedMessages(
compaction.ts:1625       restored.messages,
compaction.ts:1626       context.messages,              // <-- CANONICAL, growing
compaction.ts:1627   );
compaction.ts:1628   return publishWorkingContextEstimate(restoredWithEvidence.messages, ...);
```

The freshly-compacted branch is the same composition at
`compaction.ts:1557-1604` (contract at `:1565`, evidence at `:1586`).

### The confirmed production order

```
persisted compaction state (sidecar)
   ↓  projectSessionCompactionState()               session/models/session-compaction.ts:168
canonical transcript + sidecar projection
   ↓  applyTaskContractToCompactedMessages()        extensions/context/task-contract.ts:358
task-contract restoration
   ↓  applyVerifiedEvidenceToCompactedMessages()   extensions/context/evidence-continuity.ts:1366
verified-evidence restoration
   ↓  MessageBuilder.buildForApi()                  session/services/message-builder.ts:219
provider-visible messages
   ↓  AI SDK → wire serialization
```

This matches the ACT's expected logical flow exactly.

---

## 2. Ownership map

| Concern | Owner | Location |
|---|---|---|
| **Summary text (prose)** | the compaction summarizer, persisted in the sidecar | `state.messages[0].metadata.summary` |
| **Summary carrier message** | `buildSummaryMessage()` / the `compaction_summary` metadata kind | `extensions/context/compaction-shared.ts:439-486` |
| **Task-contract section** | `applyTaskContractToCompactedMessages()` → `applyTaskContractToSummary()` → `renderTaskContractSection()` | `extensions/context/task-contract.ts:358 / 287 / 220` |
| **Verified-outcome section** | `applyVerifiedEvidenceToCompactedMessages()` → `applyEvidenceToSummary()` → `renderEvidenceSection()` | `extensions/context/evidence-continuity.ts:1366 / 1275 / 1193` |
| **Canonical history authority** | `context.messages` (the runtime's canonical transcript) | consumed at `compaction.ts:1567` and `:1588` |
| **Sidecar persistence boundary** | `createSessionCompactionState()` / `projectSessionCompactionState()` | `session/models/session-compaction.ts:140 / 168` |
| **Provider-visible transformation boundary** | `createCompactionStateAwarePrepareTurn()` | `extensions/context/compaction.ts:1422` |
| **Provider-request serialization** | `MessageBuilder.buildForApi()` | `session/services/message-builder.ts:219` |

### The two section markers

- Contract: `## Active task contract (authoritative)` + `<!-- cline-task-contract:begin -->` / `<!-- cline-task-contract:end -->`
- Evidence: `## Verified tool outcomes (canonical record)` + `<!-- cline-evidence:begin -->` / `<!-- cline-evidence:end -->`

Both are APPENDED to the end of the summary. Both are STRIPPED and
REPLACED on every restoration (`stripEvidenceSection()` at
`evidence-continuity.ts:1236`, `stripTaskContractSection()` at
`task-contract.ts:258`).

---

## 3. What each stage mutates

| Stage | Mutates the summary? | Why |
|---|---|---|
| `projectSessionCompactionState()` | **No** | It clones the sidecar's messages and appends the canonical tail. It never touches the summary text. |
| `applyTaskContractToCompactedMessages()` | **Conditionally** | Only when the canonical contract differs from the one already carried. The contract is derived from the canonical transcript's user-authored objective / later instructions / runtime obligation. |
| `applyVerifiedEvidenceToCompactedMessages()` | **Conditionally, and this is the observed churn** | The verified-outcome ledger is re-derived from the ENTIRE canonical history on every call. A new successful tool call/result pair anywhere in the canonical tail changes the ledger, which changes the rendered section, which changes the summary. |
| `MessageBuilder.buildForApi()` | **No** | It transforms blocks into the provider shape. The live captures show the summary fingerprint is IDENTICAL at `runtime_projection` and at `wire_request`, so the builder is not a mutator of the summary text. |

### The decisive live discriminator

The preserved prefix-forensics captures of the live session record the
summary carrier's content fingerprint at THREE stages. The fingerprints at
`runtime_projection` are **byte-identical** to the ones at `ai_sdk_prompt`
and at `wire_request` for every iteration. The mutation is therefore
introduced AT OR BEFORE `runtime_projection` — i.e. inside
`createCompactionStateAwarePrepareTurn()` — and is propagated verbatim
downstream. The message builder is exonerated.

---

## 4. The mutation mechanism, in production code

`evidence-continuity.ts:1366` `applyVerifiedEvidenceToCompactedMessages()`:

```
const ledger = extractVerifiedToolOutcomes(canonicalMessages);   // :1370 — reads the WHOLE canonical history
const summaryIndex = compactedMessages.findIndex(isCompactionSummary);  // :1371
const currentSummary = metadata.summary ?? readSummaryTextFromContent(...);  // :1384
const nextSummary = applyEvidenceToSummary(currentSummary, ledger);        // :1394
if (nextSummary === currentSummary) return { applied: false, ... };        // :1395
nextMessages[summaryIndex] = rebuildSummaryMessage(summaryMessage, nextSummary);  // :1403
```

`applyEvidenceToSummary()` (`evidence-continuity.ts:1275`) strips the
previous section and appends the newly derived one. The section is at the
TAIL of the summary, but the summary's CONTENT changes, and the summary is
the FIRST provider-visible message. A prompt cache can only reuse a
checkpoint over an unchanged prefix, so a changed summary invalidates every
deeper checkpoint.

`extractVerifiedToolOutcomes()` (`evidence-continuity.ts:960`) keeps the
most recent `MAX_CARRIED_OUTCOMES` (12) verified outcomes and sorts them by
canonical position. So the section content is a pure function of the
canonical history — and it changes whenever the canonical history gains a
verified outcome.

---

## 5. Existing relevant tests (inspected before adding anything)

| Suite | What it covers |
|---|---|
| `sdk/packages/core/src/extensions/context/evidence-continuity.test.ts` | 62 tests. The evidence carry-forward: the reproduced defect, failure/ambiguity rejection, idempotence, delimiter escaping, credential safety. **Already drives `createCompactionStateAwarePrepareTurn()` and `MessageBuilder.buildForApi()`.** |
| `sdk/packages/core/src/extensions/context/task-contract-conservation.test.ts` | The task-contract carry-forward and its conservation guarantees. |
| `sdk/packages/core/src/extensions/context/task-contract-conservation.historical.test.ts` | The same against a REAL historical sidecar and transcript. |
| `sdk/packages/core/src/extensions/context/task-contract-budget-authority.test.ts` | The fail-closed budget guard. |
| `sdk/packages/core/src/session/models/session-compaction.test.ts` | The sidecar projector and its source-prefix hash validation. |
| `sdk/packages/core/src/extensions/context/compaction.real-producer-seam-red.test.ts` | The prior "producer hypothesis" RED witness — a NOT_REPRODUCED witness, retained in the same convention. |

**No existing suite asserts the provider-visible summary's PREFIX STABILITY.**
That gap is what this ACT's RED witness fills.

---

## 6. The prefix-forensics capture infrastructure (reused, not rebuilt)

| Component | Location |
|---|---|
| Capture writer | `sdk/packages/llms/src/providers/prefix-forensics-capture.ts:194` |
| Representation fingerprinting | `sdk/packages/shared/src/runtime/prefix-forensics.ts:245` |
| Cohort id | `sdk/packages/shared/src/runtime/prefix-forensics.ts:467` |
| Analyzer | `sdk/packages/shared/src/runtime/prefix-forensics-analyzer.ts:1149` |

The three stages are `runtime_projection`, `ai_sdk_prompt` and
`wire_request` (`prefix-forensics-capture.ts:64`). The ACT explicitly
forbids a new tracing framework; this ACT adds none.
