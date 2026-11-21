# ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-01 — Causal Attribution Separation

**Added by** `ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION01`.

---

## 1. Why this file exists

The correction review found a **P0 evidence gap** that the original ACT did
not state plainly enough: the report's three detailed mutations come from a
preserved `course` session using **provider `minimax`, model `MiniMax-M3`**,
while the engine investigation concerns **Qwen3.8-Flash-Next on Strata**,
including the P40 Q2_0 and RTX 5060 Ti configurations.

The original ACT acknowledged that "the MiniMax capture corpus and the
queried Strata endpoint are **not established to be the same serving
path**". But it then went on to treat the MiniMax historical rewrite as
**the cause** of the particular Strata reuse plateau.

This file separates the two claims explicitly, so that neither is
over-read.

---

## 2. The two claims, stated separately

### 2.1 CLAIM A — ESTABLISHED (direct observation)

> **ClineMM deliberately rewrites historical `read_files` results IN PLACE.**
> The message count, the order, the role, the position and the tool-call id
> are ALL unchanged; only the bytes inside the block move. The producer is
> `MessageBuilder.replaceOutdatedReadContent()`.

| Property | Status |
|---|---|
| Direct observation of the mechanism | **PASS** |
| Message identity / role / position preserved | **PASS** |
| Producer attributed to a named source seam | **PASS** |
| Occurs across multiple hosts (21 mutations / 6 hosts) | **PASS** |
| Three representation boundaries instrumented | **PASS** (source-level) |
| The mutation CAN invalidate an exact-prefix cache | **PASS** (mechanism is sound) |

**Evidence class:** the preserved `minimax` / `MiniMax-M3` dogfood corpus,
read-only, 24,862 full-payload captures.

### 2.2 CLAIM B — NOT ESTABLISHED (inference across systems)

> **The in-place rewrite is the cause of the P40 / RTX 5060 Ti 3,895-token
> reuse plateau on Strata serving Qwen3.8-Flash-Next.**

| Property | Status |
|---|---|
| A joined engine/capture evidence pair | **ABSENT** — no authoritative cross-system join exists |
| Same serving path | **NOT ESTABLISHED** — `minimax`/`MiniMax-M3` ≠ `Qwen3.8-Flash-Next`/Strata |
| Same model family, tokenizer, cache keying | **NOT ESTABLISHED** |
| The rewrite alone explains a PERSISTENT plateau | **NOT ESTABLISHED** — see §3 |
| `STRATA_PLATEAU_CAUSE_UNPROVEN` | **STILL OPEN** |

**Verdict on CLAIM B: `HALT_CAUSAL_ATTRIBUTION_UNPROVEN`** — it remains a
credible causal HYPOTHESIS, not an experimentally established explanation.


---

## 3. Why one rewrite does not prove a persistent plateau

The original report argued that once the historical content is rewritten,
the shallow cache plateau persists "because the rewritten bytes remain
rewritten". That is **not sufficient**. Consider three provider requests:

| Request | Historical content | Expected cache behaviour |
|---|---|---|
| A | Original large tool result | Deep checkpoint available |
| B | Tool result replaced with the stale marker | A's deep checkpoint cannot match |
| C | Same replacement, followed by new messages | B's processed prefix may now be reusable |

A one-time rewrite explains the **A → B cache miss**.

It does **not**, by itself, explain why C — and every subsequent request —
continues to miss. That depends on:

1. whether Strata retains a compatible checkpoint from B, and
2. where its checkpoints are positioned relative to the rewritten block.

This matters because the actual traces contain **occasional deep-cache
recoveries followed by fresh collapses**. A mechanism that predicted a
permanent plateau would not produce that pattern.

### 3.1 The successor experiment this implies

The successor ACT needs, for ONE rewrite event:

| # | Required observation |
|---|---|
| 1 | The rewrite event itself (request B) |
| 2 | The IMMEDIATELY following request (C) |
| 3 | One further append-only continuation (D) |
| 4 | All three correlated to the ACTUAL engine cache decisions |

That experiment would distinguish:

1. the cost of the INITIAL prefix invalidation;
2. how quickly the new prefix becomes cacheable;
3. whether checkpoint retention prevents recovery.

Which in turn decides whether to change ClineMM's stale-read policy,
improve Strata's checkpoint placement, or do both.

---

## 4. What is RETAINED from the original ACT

The original ACT's `PREFIX_MUTATION_ISOLATED` classification is **retained
and unchanged**. It is a claim about CLAIM A — an exact early model-facing
change, identified and bound to its producing seam — and it is supported by
direct observation on the corpus that was actually analysed.

What is **withdrawn** is the implied causal leap from CLAIM A to CLAIM B.

| Original statement | Status after the correction |
|---|---|
| `PREFIX_MUTATION_ISOLATED` | **RETAINED** — directly observed |
| "the mechanism that explains the STICKY, REPEATED 3,895-token plateau" | **WITHDRAWN** — not established |
| "The plateau is therefore STICKY" (as an explanation) | **WITHDRAWN** — a plausible mechanism, not an observed engine behaviour |
| "The client-side mutation is present. The server-side checkpoint limitation is therefore NOT the explanation." | **WITHDRAWN** — presence of the client-side mutation does not exclude a server-side contribution without a joined observation |
| "D5's precondition — a STABLE request prefix — is NOT met" | **RETAINED** (true of the observed corpus) |
| "D5 is NOT THE EXPLANATION" | **WITHDRAWN** — the precondition being unmet on the MiniMax corpus does not settle the question for the Strata sessions |

---

## 5. The discriminator report's own caveat, promoted

The original `04-discriminator-report.md` §D2 asserted the causal reading
directly. The correction adds this caveat to that section, and
`09-causal-classification.md` §1.3 is amended by the same wording.

> **CAUSAL ATTRIBUTION CAVEAT
> (ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION01).**
> The three detailed mutations analysed here come from a preserved
> `course` session on **provider `minimax`, model `MiniMax-M3`**. The
> engine investigation concerns **Qwen3.8-Flash-Next served by Strata**
> (P40 Q2_0 and RTX 5060 Ti). No authoritative cross-system join
> establishes that these are the same serving path. The observations
> below establish the MECHANISM (CLAIM A) and the mechanism's sufficiency
> IN PRINCIPLE; they do **not** establish that the mechanism accounts for
> the specific Strata 3,895-token plateau (CLAIM B). See
> `11-causal-attribution-separation.md`.
