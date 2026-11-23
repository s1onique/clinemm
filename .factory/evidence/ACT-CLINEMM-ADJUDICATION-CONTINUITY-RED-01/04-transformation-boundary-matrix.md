# 04 — Transformation boundary matrix (M0 → M6)

**Source HEAD:** `a493eff078ec5c8f2b6c874ad8f4a85009d1b64f`
**Session:** `1795394987994_fpu77` · **Subject revision:** Keycloak `42de653b…`
**Canonical snapshot SHA-256:** `9ca5309aa18e43c97343d87171de20f2a198f6ccfe8f266c1f1c33557afa5dcd`

---

## 1. The production sequence (verified against the source at `ENTRY_HEAD`)

```
Canonical messages
    |
    v
runAgenticCompaction()                       agentic-compaction.ts:52
    |
    +-- findCutIndex()                        compaction-shared.ts:596
    +-- findLatestSummaryIndex()              compaction-shared.ts:571
    +-- newMessagesToFold                     agentic-compaction.ts:81
    +-- buildAgenticSummaryInputBudget()      agentic-compaction.ts:31
    |       |
    |       +-- buildBudgetProjection()       budget-projection/project.ts:479
    |               |
    |               +-- resolveProjectionPolicy("agentic_summary")
    |               |       -> dropThinkingBlocks: TRUE      <-- THE BOUNDARY
    |               +-- dropThinkingBlocks()   budget-projection/project.ts:297
    |
    +-- serializeConversation()               compaction-shared.ts:438
    |       +-- serializeMessage()            compaction-shared.ts:387
    |               +-- thinking truncation   truncateText(block.thinking, 2_000)
    |               +-- tool-result projection -> "[result omitted]"
    |
    +-- buildSummaryRequest()                 compaction-shared.ts:943
    +-- generateSummary()                     summary-generation.ts:4
    |       -> handler.createMessage(systemPrompt, [{role:"user", content: request}])
    +-- ensureFilesSection()                  compaction-shared.ts:933
    v
Compaction result -> buildSummaryMessage()   compaction-shared.ts:1042
    |
    v
createCompactionStateAwarePrepareTurn()      compaction.ts:1423
    +-- applyTaskContractToCompactedMessages()   task-contract.ts:358
    +-- applyVerifiedEvidenceToCompactedMessages() evidence-continuity.ts:2173
    v
MessageBuilder.buildForApi()                 session/services/message-builder.ts:219
    |
    v
Provider-visible continuation
```

**The invocation order was confirmed against the current production source**, not
assumed. Two points in particular:

1. `buildBudgetProjection()` runs **inside** `buildAgenticSummaryInputBudget()`,
   i.e. **before** `serializeConversation()` — so a block removed by the
   projection never reaches the serializer.
2. `dropThinkingBlocks()` is invoked at `project.ts:506-515`, **before** the
   `estimatedTokens <= targetTokens` early return at `project.ts:539`. The removal
   is therefore **unconditional** — it is not a budget-pressure artefact.

---

## 2. The stage matrix

Stage authority:

| Stage | Authority | What it means |
|---|---|---|
| **M0** | Canonical history | the statement exists with source identity |
| **M1** | Selected compaction input | message/block included after cutoff **and** budgeting |
| **M2** | Serialized conversation | survives serialization and truncation |
| **M3** | Actual summarizer provider request | visible to the summarizer |
| **M4** | Generated summary | survives semantically |
| **M5** | Persisted/contracted working context | survives compaction projection |
| **M6** | Main-model provider request | remains available to the agent |

### 2.1 R8 — bootstrap-admin credential exposure `CONFIRMED` (observation level)

| Stage | Result | Evidence |
|---|---|---|
| M0 | **PRESENT_EXACT** | canonical idx 28 (`msg_6ttuJ879`), `thinking` block, 1231 chars, tool call `call_e5cb680973cb413f83d0dd07` |
| M1 | **ABSENT** | `buildBudgetProjection(agentic_summary)` removes the `thinking` block; the block is reported as a `dropped_block` budget action |
| M2 | **ABSENT** | `serializeConversation()` receives no thinking block → no `[Bot thinking]` line is produced |
| M3 | **ABSENT** | capture #1 (36→37) contains **0** `[Bot thinking]` markers and 0 occurrences of the adjudication |
| M4 | **ABSENT** | the persisted summary contains **0** occurrences of the R8 adjudication phrase |
| M5 | **ABSENT** | the task contract carries the *original* finding, not the adjudication; the evidence section carries tool outcome STATUS only, not verdicts |
| M6 | **ABSENT** | the adjudication is not in the provider-visible continuation |

**Earliest loss boundary: M1 — SOURCE SELECTION.**
**Classification: L1 — Budget loss.**

### 2.2 R7 — Java-test execution deficiency `CONFIRMED` (observation level)

| Stage | Result | Evidence |
|---|---|---|
| M0 | **PRESENT_EXACT** | canonical idx 40 (`msg_2TMSPY6J`), `thinking` block, 981 chars, tool call `call_d61ae0ee65a744cb826a9d46` |
| M1 | **ABSENT** | same unconditional `dropThinkingBlocks` |
| M2 | **ABSENT** | no thinking block reaches the serializer |
| M3 | **ABSENT** | capture #1: 0 `[Bot thinking]` markers, 0 adjudication occurrences |
| M4 | **ABSENT** | 0 occurrences in the persisted summary |
| M5 | **ABSENT** | no verdict-bearing section carries it |
| M6 | **ABSENT** | — |

**Earliest loss boundary: M1 — SOURCE SELECTION.**
**Classification: L1 — Budget loss.**

### 2.3 R3 — pool-budget risk `NARROWED` (manual, not enforced)

| Stage | Result | Evidence |
|---|---|---|
| M0 | **PRESENT_EXACT** | canonical idx 64 (`msg_b7kphE6s`), `thinking` block, 1387 chars, tool call `call_f52d99c7ca85432da97abed3`; arithmetic `36 × 11 = 396 ≤ 400` verified |
| M1 | **ABSENT** | same unconditional `dropThinkingBlocks` |
| M2 | **ABSENT** | — |
| M3 | **ABSENT** | capture #1: 0 occurrences; capture #2: the bare token `396` occurs once, but it is the *original* finding's text in the USER turn, **not** the adjudication |
| M4 | **ABSENT** | 0 occurrences of `R3 is NARROWED` / `pool adjusted to 36` in the persisted summary |
| M5 | **ABSENT** | — |
| M6 | **ABSENT** | — |

**Earliest loss boundary: M1 — SOURCE SELECTION.**
**Classification: L1 — Budget loss.**

### 2.4 R4 — in-progress narrowing (NOT a terminal verdict)

| Stage | Result | Evidence |
|---|---|---|
| M0 | **PRESENT_EXACT** | canonical idx 124 (`msg_r8qDJLKQ`), `thinking` block, **13068 chars**, tool call `call_8f7c2f095db04a1a9c09b9c0` |
| M1 | **ABSENT** | same unconditional `dropThinkingBlocks` |
| M2 | **ABSENT** | **and additionally** truncated: at 13068 chars this block exceeds the 2000-char serializer window even if it had survived M1 |
| M3 | **ABSENT** | capture #2 (62→63): 0 `[Bot thinking]` markers, 0 occurrences of the narrowing |
| M4 | **ABSENT** | 0 occurrences in the persisted summary |
| M5 | **ABSENT** | — |
| M6 | **ABSENT** | — |

**Earliest loss boundary: M1 — SOURCE SELECTION.**
**Classification: L1 — Budget loss** (primary).
A **secondary** L2 (thinking truncation) would ALSO have applied to R4 at M2 —
13068 > 2000 — had the block survived M1.

> **R4 is an in-progress narrowing, not an adjudication.** No preservation
> requirement is derived from it. It is used only to demonstrate that the loss
> mechanism is not specific to terminal verdicts.

---

## 3. The decisive discriminator: L1, not L2

The ACT asked specifically whether the loss is the **2 000-character thinking
truncation** (`truncateText(block.thinking, 2_000)`). The measurement says **no**:

| Witness | `thinking` length | Inside the 2000-char window? | Lost? |
|---|---|---|---|
| R8 | 1231 | **YES** | **YES** |
| R7 | 981 | **YES** | **YES** |
| R3 | 1387 | **YES** | **YES** |
| R4 | 13068 | no | YES |

**All three adjudications that matter fit comfortably inside the truncation
window, and all three are lost anyway.** The truncation cannot explain the loss.

The controlled comparison is executed in the RED suite (`RED-3`) and in the
discriminator suite (`DISCRIMINATOR A` / `DISCRIMINATOR B`):

- **Discriminator A** — the SAME canonical input through
  `buildBudgetProjection({ policyIntent: "agentic_summary" })` **loses** the
  adjudication; the SAME input through
  `{ policyIntent: "normal_provider_request" }` **keeps** it. The only variable
  is the policy intent. → the loss is **source selection**.
- **Discriminator B** — `serializeConversation()` on the SAME canonical input
  **does** carry the adjudication (with its `[Bot thinking]` marker), and the
  beyond-window variant **does** show `[truncated …]`. → the serializer is
  demonstrably capable of carrying it and is demonstrably truncating at 2000 —
  neither behaviour explains the loss.

**Therefore:**

> **The earliest information-loss boundary is stage M1 — the compaction SOURCE
> SELECTION, inside `buildBudgetProjection()`.**
> The mechanism is `resolveProjectionPolicy("agentic_summary").dropThinkingBlocks
> === true`, applied unconditionally at `budget-projection/project.ts:506-515`,
> before any budget arithmetic.
>
> **Loss classification: L1 — Budget loss.**
> L2 (thinking truncation) is **NOT** the cause of the R3/R7/R8 losses. It would
> only have mattered for R4, which is not an adjudication anyway.

---

## 4. Why the later stages cannot recover the loss

| Later stage | Why it cannot recover |
|---|---|
| M2 serializer | never receives the block |
| M3 summarizer | never receives the statement (0 `[Bot thinking]` markers in every captured request) |
| M4 summary | cannot contain what the summarizer never saw — and the persisted summary indeed has 0 occurrences |
| M5 task contract | carries the **user-authored objective** (the original finding), not the model's later qualified decision. **Task-contract presence ≠ adjudication continuity.** (RED-4 measures this.) |
| M5 evidence section | `renderEvidenceSection()` emits tool outcome STATUS lines (`- run_commands (id): succeeded — subject`), **never verdicts**; and it is bounded by `MAX_CARRIED_OUTCOMES = 12`, so an old adjudication is evicted by later outcomes anyway. (RED-2 measures this.) |
| M6 `MessageBuilder.buildForApi()` | faithfully projects whatever it is given — `DISCRIMINATOR D` shows a summary containing the adjudication IS carried to the provider intact. So M6 is **not** a loss boundary. |

---

## 5. The measurement that ties the historical loss to the reproduced RED

The reproduced RED uses the SAME production functions, in the SAME order, and
observes the SAME absence:

| Measurement | Historical (captured production artifacts) | Reproduced RED (production seam) |
|---|---|---|
| thinking block in canonical history | present (R3/R7/R8) | present |
| thinking block in the budgeted summarizer input | absent | absent |
| `[Bot thinking]` markers in the summarizer request | **0** | **0** |
| adjudication phrase in the summarizer request | **0** | **0** |
| adjudication phrase in the persisted summary | **0** | **0** |
| adjudication phrase in the provider-visible continuation | **0** | **0** |

The reproduction is **`SYNTHETIC_REAL`**: real production functions, synthetic
non-sensitive content. It is **not** a live-model reproduction and does not claim
to be.

---

## 6. Stage summary

| Finding | M0 | M1 | M2 | M3 | M4 | M5 | M6 | Earliest loss | Class |
|---|---|---|---|---|---|---|---|---|---|
| R8 | PRESENT_EXACT | **ABSENT** | ABSENT | ABSENT | ABSENT | ABSENT | ABSENT | **M1 source selection** | **L1** |
| R7 | PRESENT_EXACT | **ABSENT** | ABSENT | ABSENT | ABSENT | ABSENT | ABSENT | **M1 source selection** | **L1** |
| R3 | PRESENT_EXACT | **ABSENT** | ABSENT | ABSENT | ABSENT | ABSENT | ABSENT | **M1 source selection** | **L1** |
| R4 (progress) | PRESENT_EXACT | **ABSENT** | ABSENT (+L2) | ABSENT | ABSENT | ABSENT | ABSENT | **M1 source selection** | **L1** (L2 secondary) |

**All four witnesses fail at the SAME stage, for the SAME mechanism.** This is one
bounded defect with one bounded repair surface — not a "compaction memory bug".
