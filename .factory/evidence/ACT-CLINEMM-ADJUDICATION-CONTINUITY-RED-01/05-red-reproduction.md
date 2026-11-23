# 05 — RED reproduction

**Verdict of this section:** the RED is **REPRODUCED** against unchanged
production code.

---

## 1. The test suite

| Property | Value |
|---|---|
| RED witness | `sdk/packages/core/src/extensions/context/compaction.adjudication-continuity.red01.test.ts` |
| Companion (passing) | `sdk/packages/core/src/extensions/context/compaction.adjudication-continuity.discriminator01.test.ts` |
| Dedicated RED config | `sdk/packages/core/vitest.red.adjudication-continuity-red01.config.ts` |
| Runner script | `bun run test:red:adjudication-continuity-red01` |
| Default-suite exclusion | `sdk/packages/core/vitest.config.ts` → `test.exclude` |
| Fixture label | **`SYNTHETIC_REAL`** |

**The RED is excluded from the default suite**, exactly as G5 requires and
following the existing `compaction.summary-churn01.red.test.ts` precedent. The
default `src/extensions/context/` gate is therefore **GREEN**.

### 1.1 The production seam exercised

The suite drives the REAL production chain, in the real order:

```
createCompactionStateAwarePrepareTurn                       compaction.ts:1423
  -> createContextCompactionPrepareTurn({strategy:"agentic"}) compaction.ts
     -> runAgenticCompaction()                               agentic-compaction.ts:52
        -> findCutIndex()                                    compaction-shared.ts:596
        -> buildAgenticSummaryInputBudget()                  agentic-compaction.ts:31
           -> buildBudgetProjection()                        budget-projection/project.ts:479
        -> serializeConversation()                           compaction-shared.ts:438
        -> buildSummaryRequest()                             compaction-shared.ts:943
        -> generateSummary()                                 summary-generation.ts:4
  -> applyTaskContractToCompactedMessages()                  task-contract.ts:358
  -> applyVerifiedEvidenceToCompactedMessages()              evidence-continuity.ts:2173
  -> MessageBuilder.buildForApi()                            message-builder.ts:219
```

**The summarizer is mocked at the EXISTING provider-handler injection boundary**
(`createHandlerAsync` from `@cline/llms`, the same seam used by the existing
`compaction.evidence-fidelity01.test.ts`). The **exact request string** the
production code sent is captured from that mock — it is never re-derived.

The suite does **not** merely call a new helper and does **not** assert on
constants declared inside the test. Every assertion is on the **observed output**
of a production function.

### 1.2 The fixture

Synthetic, non-sensitive, mirroring the historical shape:

- a user-defined finding (**S1**);
- a source-read `run_commands` tool call with a **matching** tool result
  (`call_s1_source_read_0001`);
- a model-authored **qualified** adjudication supported by that result
  (`NARROWED — the specific configuration is within budget; the remaining risk is
  missing automatic enforcement when scaling.`);
- later successful tool calls sufficient to move earlier outcomes outside the
  12-outcome continuity budget (RED-2);
- a valid compaction cutoff and a recent tail.

The adjudication-bearing turn carries exactly the historical block shape:
`[thinking, tool_use]` with **no** `text` block.

---

## 2. The failing assertions and the exit code

Command (cwd `sdk/packages/core`):

```bash
bun x vitest run \
  src/extensions/context/compaction.adjudication-continuity.red01.test.ts \
  --config vitest.config.ts
```

Observed output (verbatim excerpt):

```
 ❯ src/extensions/context/compaction.adjudication-continuity.red01.test.ts (5 tests | 5 failed) 20ms
     × RED-1 (RED): the source-grounded qualified adjudication is present in canonical history and absent from the provider-visible continuation 9ms
     × RED-2 (RED): the qualified adjudication is absent from the provider-visible continuation once more than 12 later verified outcomes exist 4ms
     × RED-3 (RED): a thinking-block adjudication at any position cannot reach the summarizer, while the same adjudication in assistant text can 4ms
     × RED-4 (RED): the original finding survives in the task contract while its later qualified decision does not 1ms
     × RED-5 (RED): the historical shape loses the adjudication at the source-selection boundary, upstream of serialization 1ms

 Test Files  1 failed (1)
      Tests  5 failed (5)
```

**EXIT CODE = 1.**

### 2.1 Per-scenario failing assertion

| Scenario | Failing assertion | File:line | What it proves |
|---|---|---|---|
| **RED-1** | `expect(request).toContain(VERDICT_TOKEN)` | `:547` | the adjudication does not reach the **actual summarizer request** |
| **RED-2** | `expect(installedText).toContain(VERDICT_TOKEN)` | `:580` | with >12 later verified outcomes, the adjudication is absent from the **installed continuation** |
| **RED-3** | `expect(inside.request).toContain(ADJUDICATION)` | `:634` | a thinking-block adjudication **inside** the 2000-char window is lost (the text control at `:628` **passed**) |
| **RED-4** | `expect(installedText).toContain(VERDICT_TOKEN)` | `:671` | the **original** finding is present (the preceding assertion at `:668` **passed**) while the **qualified decision** is absent |
| **RED-5** | `expect(request).toContain(VERDICT_TOKEN)` | `:737` | the historical shape loses it; the same canonical input under `normal_provider_request` **keeps** it (`:731` **passed**) |

**RED-3 and RED-4 are internally discriminating**: in both, the *control*
assertion (the preceding line) **passed** while the RED assertion failed. That is
what distinguishes real adjudication loss from a broken harness.

### 2.2 The observed failure — the actual summarizer request

The captured request received by the mocked summarizer (RED-1 failure output):

```
Summarize this session for continuation. Be concise and factual.

## Goal
One sentence: what is being built or fixed.
...
## Files
Read: none
Edited: none

Conversation:
[User]: Finding S1: No automated limit protects a configured resource budget. Source observation: The configuration contains a per-worker limit of 36. Counterevidence: With 11 workers, total capacity is 396, which is below the documented budget of 400.

[Bot tool calls]: run_commands(commands="grep -n 'maxWorkers' synthetic-pool-config.yaml")

[Tool result]: [succeeded] grep: [result omitted]

[Bot tool calls]: run_commands(commands="synthetic-probe-0")
[Tool result]: [succeeded] #1: [result omitted]
...
```

Note what is **present** (the original finding, the tool calls, the tool-result
statuses) and what is **absent**: **no `[Bot thinking]` line at all**, and
therefore no adjudication. This is byte-for-byte the shape of the historical
capture.

---

## 3. RED acceptance — reversion and reproduction

The ACT requires: "The required failure must occur against unchanged production
code. Capture the initially failing assertion and exit code. Then revert any
temporary production modification and reproduce the same failure."

**No production modification was ever made.** The G6 ablation is implemented
**test-locally** in the discriminator file, so there was nothing to revert. The
production tree was never in a modified state at any point of this ACT.

The failure was nonetheless reproduced **three independent times**, all against
the unchanged production tree:

| Run | Command | Exit | Result |
|---|---|---|---|
| 1 | `bun x vitest run …red01.test.ts --config vitest.config.ts` | **1** | 5 failed / 5 |
| 2 | `bun x vitest run …red01.test.ts --config vitest.config.ts` (re-run) | **1** | 5 failed / 5 |
| 3 | `bun run test:red:adjudication-continuity-red01` (dedicated RED config) | **1** | 5 failed / 5 |

The failing assertion lines and exit code are **identical** across all three
runs.

**Production diff at exit:**

```
git status --porcelain --untracked-files=no
 M sdk/packages/core/package.json          <- test-harness script wiring
 M sdk/packages/core/vitest.config.ts       <- test-harness exclusion wiring
```

```
git diff --stat -- 'sdk/packages/core/src/**/*.ts' ':(exclude)*.test.ts'
  -> (empty)
```

**PRODUCTION_DELTA = ZERO.**

---

## 4. Why the RED is not a false positive

Four independent reasons, each executed:

1. **The control assertion passes.** In RED-3 the *same* adjudication in an
   ordinary assistant `text` block **does** reach the summarizer
   (`expect(text.request).toContain(ADJUDICATION)` — **passed**). The harness
   works; the loss is specific to the thinking-block position.

2. **The historical artifacts agree.** All seven captured production summarizer
   requests contain **0** `[Bot thinking]` markers and **0** adjudication
   occurrences. The reproduction and the history have the same shape.

3. **The controlled policy comparison isolates the mechanism.** Same canonical
   input; `agentic_summary` loses it, `normal_provider_request` keeps it.

4. **The ablation is reversible.** Removing the test-local restoration restores
   the RED exactly (see `07-ablation-and-necessity.md`).

---

## 5. The default suite is not poisoned

```
bun x vitest run src/extensions/context/ --config vitest.config.ts
-> Test Files  27 passed | 1 skipped (28)
   Tests  479 passed | 2 skipped (481)
   EXIT 0
```

The RED witness is excluded; the passing discriminator suite runs in the default
gate; the rest of the context suite is unaffected.
