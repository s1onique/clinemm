# ACT-CLINEMM-COMPACTION-STABLE-PREFIX-REPAIR-01 — Qualification Report

**Verdict:** `PASS_STABLE_PREFIX_REPAIR`

> **CORRECTION02 note.** The CORRECTION01 review returned
> `HALT_CANONICAL_BOUNDARY_INDEX_MISMATCH` with one new P0 — a canonical
> boundary count applied to an unfiltered array — which was confirmed,
> reproduced against the real seams and fixed. The principal verdict is
> unchanged because the P0 was a defect in the CORRECTION01 seam, not in the
> original repair, and the original RED witness, the evidence-conservation
> guarantee and the budget guarantees are all intact after the fix.

**Entry HEAD:** `9117f13ae7d643373c56eeedc30da661fc790b08`
**Subject HEAD:** `9f57bc84d98f3439a0d70e4bf74300efef6564cd`

---

## 1. The final report fields

```text
RED_REPRODUCED:               YES — at ENTRY_HEAD, unmodified witness, EXIT 1
STABLE_PREFIX_GREEN:          YES — same witness, same assertion, EXIT 0
CANONICAL_EVIDENCE_CONSERVED: YES — boundary outcomes carried in the summary section;
                                post-boundary outcomes model-visible in the canonical
                                tail with the affirmative success signal; negative control
                                proves the assertion fails when they are removed.
                                (CORRECTION02: the boundary ledger's SOURCE COLLECTION
                                was the raw list while the boundary COUNT was canonical,
                                so a display-only message could drop a verified outcome
                                from the section — measured `carriedOutcomeCount: 0`,
                                `EVIDENCE LOST`, in both Phase A and Phase B. FIXED: the
                                canonical filter is applied BEFORE the slice, so the count
                                and the slice operate over the identical collection.)
BUDGET_SAFETY:                YES — two DISTINCT fail-closed guarantees.
                               PERSISTENCE safety: the compaction-side budget
                               projection, which runs before the sidecar is written.
                               DISPATCH safety: the FINAL provider-request guard at
                               the dispatch seam (`agent-runtime.ts`,
                               `assertProviderRequestWithinBudget()`), which measures
                               the provider-visible projection of the FINAL messages
                               after every `beforeModel` mutation and fails closed
                               before any provider request leaves the process. The
                               repair adds no model-visible content and no message.
                               (CORRECTION01: the earlier "can only REDUCE" argument
                               was WITHDRAWN — the rolling-12 window means a
                               boundary-scoped ledger is NOT always a subset.
                               CORRECTION02: the earlier "before any sidecar write"
                               ordering claim was WRONG — the compaction path calls
                               `saveState` internally, so the two guarantees are
                               stated separately above.)
PROVIDER_SEMANTIC_DELTA:      The provider-visible request gains NO message and NO
                               field. It LOSES the redundant re-derivation of the
                               post-boundary verified outcomes from the early summary.
                               The model still receives every verified outcome, through
                               the canonical tail instead of a duplicated summary
                               section.
SOURCE_HEAD:                  9117f13ae7d643373c56eeedc30da661fc790b08
SUBJECT_HEAD:                 9f57bc84d98f3439a0d70e4bf74300efef6564cd
CORRECTION_HEAD:              a9bf4fc8be637a17d11b9fbb0338e4774cd98b56
CORRECTION02_HEAD:            b0bf8fcb13b97d4f7ada75496a30d76a2b314bfd
FINAL_HEAD:                   b0bf8fcb13b97d4f7ada75496a30d76a2b314bfd
                              (the terminal PRODUCTION commit; the documentation
                              commits that carry the artifact package and this
                              manifest follow it and change no production module
                              and no test)
LIVE_STRATA_CACHE_EFFECT:     NOT_EXECUTED
```

---

## 2. What was established, and at what strength

| Claim | Strength | Evidence |
|---|---|---|
| The summary churns across an append-only continuation at ENTRY_HEAD | **OBSERVED** | the original RED witness, unmodified, EXIT 1, with the exact one-line diff |
| The producer is the verified-evidence restoration | **ESTABLISHED** | inherited from the predecessor (`EVIDENCE_RESTORATION_CAUSAL`), and re-isolated here |
| The canonical tail already represents every post-boundary verified outcome | **ESTABLISHED** (offline, real seams) | `tail-sufficiency-matrix.json`: 12 scenarios (A–L), 12/12 `postBoundarySufficient: true` |
| The repair stabilises the summary without suppressing evidence | **ESTABLISHED** (offline, real seams) | the RED witness GREEN + the new suite's 28 tests, including the negative control |
| A display-only message cannot drop a verified outcome from the boundary section | **ESTABLISHED** (offline, real seams) | CORRECTION02: the P0 reproduced (`carriedOutcomeCount: 0`, `EVIDENCE LOST`) and the fix is proven to be a true discriminator (revert → 3 failed / 23 passed; apply → 26 passed) |
| The boundary inference is authoritative for evidence conservation | **NOT ESTABLISHED — CLAIM WITHDRAWN** | CORRECTION02: measured, an under-estimated boundary can OMIT a boundary outcome (the section carried zero). The inference is safe for FABRICATION but not for OMISSION; the production path always passes the authoritative boundary |
| The repair is fail-closed on budget | **ESTABLISHED** | the unchanged budget-authority suite passes, and the final dispatch-seam guard is unchanged and fail-closed. CORRECTION01: the "the measured request can only shrink" argument was WITHDRAWN as mathematically false (the rolling-12 window means a boundary-scoped ledger can render LARGER); the authority is the final guard, not a shrinkage property |
| A provider retained a checkpoint at the new boundary | **NOT ESTABLISHED** | requires a live provider; out of scope for this ACT |

---

## 3. Offline quantitative qualification (§11)

Four successive post-compaction requests under the SAME source inputs:

- **A** — the persisted compaction summary established,
- **B** — the first append-only verified outcome,
- **C** — the second append-only verified outcome,
- **D** — an unchanged-history control.

The **baseline** is the historical production behaviour (the section re-derived
from the whole canonical history on every restoration). The **repaired**
behaviour is the boundary-scoped derivation.

The measurement is the **structural common prefix in UTF-16 code units** over
the SERIALIZED provider-visible message list. It is NOT a tokenizer token
offset and NOT a byte count.

| Metric | Baseline | Repaired |
|---|---|---|
| Early summary content fingerprint (step A) | `9b138b60ddcdff17` | `9b138b60ddcdff17` |
| Early summary content fingerprint (step B) | `f7930102aa7ab8e7` — **changes** | `9b138b60ddcdff17` — **stable** |
| Early summary content fingerprint (step C) | `9a186d3a37bd717c` — **changes** | `9b138b60ddcdff17` — **stable** |
| Summary byte length (step A) | 366 | 366 |
| Summary byte length (step B) | 413 — **changes** | 366 — **stable** |
| Summary byte length (step C) | 460 — **changes** | 366 — **stable** |
| Provider-visible common prefix, step B (code units) | **419** — truncated by the summary mutation | **1001** — the whole earlier request is a common prefix |
| Provider-visible common prefix, step C (code units) | **465** — truncated | **1292** — the whole earlier request is a common prefix |
| Provider-visible common prefix, step D (control, code units) | 1772 | 1588 |
| Current verified outcomes visible | Yes | **Yes** |
| Task contract visible | Yes | **Yes** |
| Additional provider requests | 0 | **0** |
| Effective budget respected | Yes | **Yes** |
| Provider-visible message count (A/B/C/D) | 1 / 3 / 5 / 5 | 1 / 3 / 5 / 5 |

The baseline's step-B common prefix collapses from 1002 to 419 code units —
the summary mutation truncates the common prefix at the FIRST message of the
request, which is exactly the mechanism the ACT targets. The repaired
behaviour keeps the FULL earlier request as a common prefix.

### Interpretation

```text
PREFIX_STABILITY:               measured
EVIDENCE_CONSERVATION:          measured
TOKEN_LEVEL_CACHE_COMPATIBILITY: unavailable unless directly verified
LIVE_PREFILL_IMPROVEMENT:       NOT_EXECUTED
```

An increased structural common prefix establishes that **ClineMM has stopped
the targeted early mutation**. It does **NOT** establish that Strata retained
a checkpoint at that boundary.

**No seconds are reported as measured performance.** The live performance
qualification is the separately authorized successor ACT
`ACT-CLINEMM-COMPACTION-STABLE-PREFIX-LIVE-QUALIFICATION-01`.

---

## 4. The canonical-tail sufficiency discriminator (§3)

The discriminator drove the real production seams for all twelve required
scenarios. Its verdict, per scenario:

| Scenario | Required observation | Tail sufficient? | Summary stable? |
|---|---|---|---|
| A | call and successful result both after the boundary | Yes | Yes |
| B | call before the boundary, result after it | Yes | Yes |
| C | call and result both before the boundary | Yes | **No — the canonical CONTRACT changed** |
| D | multiple commands inside one successful tool result | Yes | Yes |
| E | failed, rejected or unpaired tool result | Yes | Yes |
| F | successful outcome superseded by a later outcome | Yes | Yes |
| G | repeated preparation of unchanged canonical history | Yes | Yes |
| H | resume from a historical sidecar lacking the evidence section | Yes | Yes |
| I | re-compaction after several new successful tool results | Yes | Yes |
| J | stale-read replacement after the original tool result | Yes | Yes |
| K | rolling 12-outcome window advances | Yes | Yes |
| L | canonical tail approaches or exceeds the effective token budget | Yes | Yes |

**Scenario C is the ONLY scenario whose summary still changes, and that is
CORRECT.** Its continuation adds a NEW USER INSTRUCTION, which genuinely
changes the active task contract. Per the ACT: "If an active task contract
genuinely changes, its correctness takes priority over prefix stability." The
change is contract-only — the evidence section and the generated prose are
byte-identical.

**The one case that needed care** was scenario B. The tool_use BLOCK is not in
the tail (the call precedes the boundary), but the RESULT block carries the
canonical tool-call identity in `tool_use_id`. The discriminator's first pass
demanded the block and reported B as insufficient; it was corrected to demand
the call IDENTITY — which is what the verified-success authority is bound to
— and B is then sufficient.

### The decision

**Design alternative 1 (tail-only conservation) was selected.** The canonical
tail represents the post-boundary verified-success authority for every
required class, so no additional later-in-context evidence representation was
built. Design alternative 2 was NOT needed: there is no second
representation of the post-boundary evidence, so nothing is duplicated and
nothing can contradict.

---

## 5. Limitations and what this ACT does NOT claim

1. **No live provider observation.** No inference was run, no VSIX was built
   or installed, no provider was contacted. Every measurement in this ACT is
   an OFFLINE measurement over the REAL production seams with SYNTHETIC
   canonical histories, labelled `SYNTHETIC_REAL_SEAM` in the artifacts.
2. **No token-level cache evidence.** The structural common prefix is not a
   Strata tokenizer offset. `TOKEN_LEVEL_CACHE_COMPATIBILITY` is unavailable.
3. **No live prefill improvement.** `LIVE_PREFILL_IMPROVEMENT: NOT_EXECUTED`.
   No seconds are claimed.
4. **The synthetic histories are not the live session.** The live session
   `1795229584545_t33f9` was NOT re-run. The mechanism it exhibited is the
   one the predecessor isolated, and the repair targets exactly that
   mechanism.
5. **The boundary fallback is a fallback.** The production path always passes
   the authoritative `source_message_count`. The inference exists so that a
   direct helper call is also stable; it is exact for every real production
   shape, but the production path does not depend on it.
6. **The rolling-12 selection was not changed.** Which 12 of the boundary's
   outcomes are shown remains presentation policy. What the section CLAIMS is
   a correctness obligation, and it is satisfied: the section never claims a
   success the canonical record does not support, and it never omits a
   boundary outcome that the visible tail cannot represent.
7. **The predecessor's churn-witness suite was inverted, not weakened.** It
   pinned the defect and explicitly deferred the repair to a later ACT. See
   `conservation-results.md` for the exact before/after of each of its three
   affected assertions. No assertion was skipped, deleted or softened.

---

## 6. Successor

`ACT-CLINEMM-COMPACTION-STABLE-PREFIX-LIVE-QUALIFICATION-01`.

A green source-level repair is **not** a demonstrated live performance
improvement. The successor may build a provenance-bound dogfood VSIX, install
it into the isolated ClineMM profile, use the existing prefix-forensics
capture, observe one naturally occurring compaction and several subsequent
turns, compare prompt-cache reuse with the previous live baseline, measure
engine-side read/reused tokens and prefill latency where available, and check
that the correct verified evidence and task obligations remain visible.

Any live claim must distinguish actual measurement from offline prediction.

**CORRECTION02 — PERSISTENCE SAFETY vs DISPATCH SAFETY (the two are
DISTINCT).** An earlier version of this document stated that the final
budget guard runs "before any compaction sidecar write". **That claim was
wrong about the ORDER.** The compaction path calls `saveState` INTERNALLY —
`compaction.ts:1618` (Phase A) and `compaction.ts:1715` (re-compaction) —
and only THEN returns to the dispatch path, where the final guard runs.

The two guarantees must be read separately:

| Guarantee | Enforced by | When it applies |
|---|---|---|
| **PERSISTENCE safety** | the compaction-side budget projection (`applyTaskContractToCompactedMessages`, which measures an ISOLATED accounting projection via `prepareBudgetAccountingMessages`) | BEFORE the sidecar is written, inside the compaction path |
| **DISPATCH safety** | the final provider-request guard (`agent-runtime.ts`, `assertProviderRequestWithinBudget()`), which measures the PROVIDER-VISIBLE projection of the FINAL messages after every `beforeModel` mutation | before any provider request leaves the process |

Both fail closed. The dispatch guard is the last line of defence and it
cannot be bypassed: an over-budget request raises `TaskContractBudgetError`
before any provider call. The persistence guard ensures an over-budget
compaction does not WRITE a sidecar in the first place.

Nothing about the repair changes either guard. The repair adds no
model-visible content and no message.
