# 10 — Qualification and next action

**Verdict: `RED_REPRODUCED_BOUNDARY_CLASSIFIED`**

---

## 1. The one-sentence answer

> **At what exact production boundary does ClineMM lose a previously
> established, qualified adjudication, and what is the minimum safe contract
> necessary to prevent that loss?**

**Boundary:** the compaction **SOURCE SELECTION** — stage **M1** — inside
`buildBudgetProjection()` (`budget-projection/project.ts`), where the
`agentic_summary` policy sets `dropThinkingBlocks: true` and removes **every**
`thinking` block from the summarizer's input window, unconditionally and before
any budget arithmetic.

**Minimum safe contract:** a previously established, source-grounded, **qualified**
adjudication must remain visible to the summarizer, and through it to the
provider-visible continuation — carried as a **bounded, source-grounded verdict
with its qualification**, never as raw source content, never as untrusted
instruction, and never without a source-revision freshness check.

---

## 2. Why this ACT does not stop at "the summarizer did not see it"

The previous ACT (`CORRECTION01`) had already established that the summarizer
never received the R4 source evidence, and attributed that to the **serializer**
(`renderStructuredToolPayload` → `[result omitted]`). That was correct **for
source evidence**, and it remains correct.

This ACT is about a **different** class of loss: the **adjudication itself**.
And the measurement says something the previous ACT did not establish:

> **The three adjudications are not in the summarizer's input at all — not
> truncated, not omitted by the summarizer, but never rendered.** Every one of
> the seven captured summarizer requests contains **0** `[Bot thinking]`
> markers.

So the causal chain is:

```
canonical history  ──►  buildBudgetProjection(agentic_summary)
                            └── dropThinkingBlocks: TRUE  ◄── THE DEFECT
                                   └── thinking block removed
                                          └── no [Bot thinking] line exists
                                                 └── summarizer never sees the verdict
                                                        └── summary has no verdict
                                                               └── provider continuation has no verdict
```

The **serializer's** `[result omitted]` behaviour is a **different, secondary**
loss that affects *source evidence*. It is **not** the cause of the
*adjudication* loss, and it is untouched by this ACT.

---

## 3. What was measured, and what was not

| Claim | Label |
|---|---|
| The three historical adjudications existed in the canonical history, inside the 36→37 covered prefix | **REAL** |
| They are absent from the actual captured summarizer requests | **REAL** |
| They are absent from the persisted compaction summary | **REAL** |
| The loss is reproduced against the real production seam | **REAL_PRODUCTION_SEAM** / **SYNTHETIC_REAL** |
| The earliest loss boundary is M1 (source selection), not M2 (truncation) | **REAL_PRODUCTION_SEAM** (controlled comparison) |
| The loss classification is L1 (budget/source selection) | **STRUCTURAL** |
| The preservation of that specific state is structurally necessary | **STRUCTURAL** (test-local ablation) |
| How a **live** model would respond to a summarizer input that DID contain the adjudication | **NOT_EXECUTED** |
| A separately verified VSIX/bundle hash for the historical host build | **NOT_EXECUTED** |

No live model was executed. No production repair was made. No new persistent
adjudication ledger was created.

---

## 4. The proposed successor ACT

```text
ACT-CLINEMM-ADJUDICATION-CONTINUITY-REPAIR-01
```

**It is proposed, NOT authorized and NOT pre-approved.** This ACT's exit
decision authorizes only a *bounded successor repair ACT after checking the
recorded trust constraints*.

### 4.1 Mandatory scope restriction

The repair is restricted to the **demonstrated earliest failing boundary**:
**M1, the compaction source selection**.

It must **not**:

- introduce a generalized persistent fact/verdict ledger (**not authorized**);
- restore raw `run_commands` stdout to the summarizer (**explicit non-goal**);
- re-enable the automatic source-file excerpt carry-forward
  (`SOURCE_FILE_FACT_CARRY_FORWARD_ENABLED` must stay **`false`**);
- change the `beforeModel` completion checkpoint (**explicit non-goal**);
- change `submit_and_exit` or terminal-tool behaviour (**explicit non-goal**);
- change the compaction-sidecar schema;
- change `MAX_CARRIED_OUTCOMES = 12`;
- add a model/provider request to the no-op path;
- introduce a blanket regex sanitizer and declare the trust problem solved.

> "It must not introduce a generic memory system merely because the session is
> long-running." The repair surface is **one boolean and one bounded
> carry-forward**, not a memory subsystem.

### 4.2 The eight preconditions the repair must prove

Before choosing a persistence mechanism, the repair ACT must prove:

| # | Precondition | Why it matters |
|---|---|---|
| 1 | The adjudication representation is sufficiently **source-grounded** | a verdict must be tied to a specific tool call whose result is in the canonical record, not free-form reasoning |
| 2 | It carries the necessary **verdict qualifications** | a bare verdict token without its qualification is a **different, wrong** state (RED-1 asserts both separately) |
| 3 | It **cannot** be promoted from untrusted source instructions | CONTROL 2 and CONTROL 3 |
| 4 | It does **not** automatically expose secrets or private reasoning | CONTROL 1, CONTROL 6, CONTROL 8 |
| 5 | It fits the existing compaction and provider **budget** | the carried section must be bounded, like `MAX_CARRIED_OUTCOMES` |
| 6 | It survives **multiple** compactions without stale verdict authority | CONTROL 5 (source-revision freshness) |
| 7 | It does **not** disrupt the stable provider prefix unnecessarily | the stable-prefix repair work must not be regressed |
| 8 | Its **removal or ablation restores RED** | the same test-local ablation pattern used in G6 |

### 4.3 A design note the successor must confront

The measurement says the adjudication lives **only** in a `thinking` block. That
is the historical shape of all four witnesses. A repair has two candidate
surfaces, and they are **not** equivalent:

| Surface | What it changes | Consideration |
|---|---|---|
| **S1** — stop dropping thinking blocks for the summarizer input | re-enables ALL thinking text into the summarizer's window | maximal blast radius: it also re-exposes the model's *unadjudicated* reasoning and any secret the model echoed. The `[Bot thinking]` window is 2000 chars/block. |
| **S2** — carry a **bounded, qualified adjudication** derived from the canonical record | adds a narrow, source-grounded carry-forward | narrower, but it must decide *how* an adjudication is identified from model-authored text — which is exactly where the trust boundary lives. |

**The successor ACT must make this choice explicitly and must not present S1 as
"simply carrying the verdict"**: S1 carries *all* reasoning, which is a
strictly larger disclosure surface than a bounded verdict.

---

## 5. Reopen condition

The RED is reopened if any of the following becomes true:

1. The `agentic_summary` budget policy stops dropping `thinking` blocks **and**
   the RED-1/RED-2/RED-4 assertions still fail — i.e. the loss moved to a
   later boundary, and the classification must be re-derived.
2. The summarizer's input window starts carrying thinking blocks but the
   generated summary still drops the adjudication — the loss would then be
   **L3** and the discriminator set must be re-run.
3. A future change makes the historical witness shape irrelevant (e.g. the model
   starts emitting verdicts in `text` blocks) — the RED fixture would then be
   measuring a shape that no longer occurs.
4. The compaction strategy changes from `agentic` to `basic` — the basic path
   uses the same `dropThinkingBlocks: true` policy, but the surrounding seam
   differs and the discriminator must be re-run.

---

## 6. Explicit non-goals honoured

| Non-goal | Honoured? |
|---|---|
| Restoring raw `run_commands` stdout to the summarizer | ✔ not attempted |
| Re-enabling automatic source-file excerpts | ✔ the flag stays `false` (verified) |
| Building a generalized persistent fact/verdict ledger | ✔ not created |
| Modifying the `beforeModel` completion checkpoint | ✔ not touched |
| Changing `submit_and_exit` or terminal-tool behaviour | ✔ not touched |
| Investigating malformed `commands:null` | ✔ out of scope |
| Optimizing llama.cpp/Strata prompt caching | ✔ out of scope |
| Re-running Round C with a live model | ✔ no live model executed |
| Reworking unrelated Factory evidence or legacy gate summaries | ✔ previous ACT's files verified UNCHANGED |

---

## 7. Deliverables of this ACT

| Deliverable | Location |
|---|---|
| RED witness (5 scenarios, intentionally failing) | `sdk/packages/core/src/extensions/context/compaction.adjudication-continuity.red01.test.ts` |
| Discriminators + ablation + security/conservation controls (23 tests, passing) | `sdk/packages/core/src/extensions/context/compaction.adjudication-continuity.discriminator01.test.ts` |
| Dedicated RED runner config | `sdk/packages/core/vitest.red.adjudication-continuity-red01.config.ts` |
| Default-suite exclusion (test harness only) | `sdk/packages/core/vitest.config.ts` |
| Runner script (test harness only) | `sdk/packages/core/package.json` |
| This evidence package | `.factory/evidence/ACT-CLINEMM-ADJUDICATION-CONTINUITY-RED-01/` |

**Production delta: ZERO.**
