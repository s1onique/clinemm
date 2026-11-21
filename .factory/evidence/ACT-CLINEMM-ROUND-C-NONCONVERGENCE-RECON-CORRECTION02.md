# ACT-CLINEMM-ROUND-C-NONCONVERGENCE-RECON-CORRECTION02

**Type:** CORRECTION / evidence-probe semantics
**Parent:** `ACT-CLINEMM-ROUND-C-NONCONVERGENCE-RECON-01`
**Predecessor correction:** `ACT-CLINEMM-ROUND-C-NONCONVERGENCE-RECON-CORRECTION01` (`a8231e416`)
**Parent commit:** `1df0217fb`
**Production changes:** FORBIDDEN — none made
**Scope:** correct summary-generation identity, fix timeline fingerprint ordering, repair the verdict-stability metric, regenerate affected artifacts and hashes, run focused probe assertions.

---

## 1. Why this correction exists

The CORRECTION01 review returned `HALT_NEW_P0_EVIDENCE_DEFECTS` with two P0 and one P1
finding against the **evidence-generating probes** — not against ClineMM production.
This ACT performs exactly the three bounded corrections the review specified, plus
the two P2 cleanups it deferred to terminal cleanup.

### 1.1 P0-1 — eight apparent compactions were still counted as sixteen

CORRECTION01 reported **16 compaction events** by tracking changes in the carried
summary's **payload** identity. The review identified that the probe's own event index
contains **eight adjacent pairs**, each second element differing from its first by
**exactly +41 bytes** and **+2 provider-visible messages** — i.e. an *enriched
projection* of a generation, not a new generation.

**Root cause.** The generation identity was computed on the raw payload. But an
enrichment re-inserts a duplicated `## Active task contract (authoritative)` heading
before the existing `<!-- cline-task-contract:begin -->` marker. That changes the
payload hash without producing a new compaction.

**Correction.** Generation identity is now computed on the **contract-stripped**
summary (`compaction_probe.strip_contract_section`). The transition classifier
(`compaction_probe.classify_transition`) now emits three distinct labels:

| Label | Meaning |
|---|---|
| `FIRST_SUMMARY` | the first summary observed in the run |
| `NEW_COMPACTION` | a genuinely different generation replaced the summary |
| `SAME_GENERATION_ENRICHED` | the same generation, re-projected with the duplicated contract heading |

### 1.2 P0-2 — the timeline's fingerprint classifier was inert

`tools/build-timeline.py` added the result fingerprint to the seen set **before**
testing whether it was new, so every nonempty result classified as `NONEMPTY` and the
timeline could never emit `CONTENT_DISTINCT`.

**Correction.** Membership is now tested **before** insertion, then the set is updated.
The independently-implemented `novelty-probe.py` already performed the operation in
the correct order and reported **342** distinct bodies; its result is preserved, and
the regenerated timeline now agrees with it exactly.

### 1.3 P1 — the verdict-stability metric overclaimed

CORRECTION01 published `last_stable_coverage_turn = null` and used it to assert that
"there is no turn at which all ten subjects had a verdict that was never subsequently
revised". The measurement only tested whether each subject's **first** assertion was
revised — which cannot establish that no **later** point had stable coverage.

**Correction.** The metric is renamed `first_assertion_stability` and states exactly
what it measures. The unsupported conclusion is withdrawn. The answerable companion
metric `last_verdict_change_turn = 638` is reported instead.

---

## 2. Corrected evidence

### 2.1 Compaction identity (P0-1)

```
$ python3 tools/compaction_probe.py \
    --capture-dir ~/.vscodium-roz/cline-data/provider-request-captures \
    --out compaction-probe.json
provider requests total                       : 277
requests carrying a compacted summary (STATE) : 257
requests without a compacted summary          : 20
distinct PROVIDER-VISIBLE summary payloads    : 16
distinct COMPACTION GENERATIONS               : 8
compaction EVENTS observed                     : 8
generation TRANSFORMATIONS observed           : 8
retention (task contract)                     : 257/257
retention (completion obligation)             : 257/257
retention (canonical evidence record)         : 257/257
```
Exit code: **0**

| Quantity | Value | Meaning |
|---|---|---|
| Provider requests | 277 | total requests in the autonomous run |
| Requests carrying a compacted summary | 257 | a **state** count |
| Distinct provider-visible summary payloads | 16 | 8 generations × 2 projections |
| **Distinct compaction generations** | **8** | the contract-stripped identity space |
| **Compaction events** | **8** | new generations that began |
| **Generation transformations** | **8** | enrichments of an existing generation (NOT compactions) |

Compaction events occur at iterations **21, 55, 82, 104, 130, 164, 203, 240**;
enrichments at **22, 56, 83, 105, 131, 165, 204, 241** — exactly the pair-firsts and
pair-seconds of the review's table.

The runtime's own compaction-event record is **`UNAVAILABLE_FROM_TRACE`**; the count
above is derived from the summary-identity transition, which is the authoritative
observable available in the provider captures.

**Retention is unchanged: 257 / 257** for the task contract, the completion
obligation and the canonical evidence record.

### 2.2 Result classification (P0-2)

```
$ python3 tools/build-timeline.py \
    --session-dir ~/.vscodium-roz/cline-data/sessions/1795252560069_t82cp \
    --capture-dir ~/.vscodium-roz/cline-data/provider-request-captures \
    --out timeline.jsonl
wrote 661 events to timeline.jsonl
```
Exit code: **0**

```
$ python3 tools/novelty-probe.py \
    --session-dir ~/.vscodium-roz/cline-data/sessions/1795252560069_t82cp \
    --out novelty-probe.json
body tiers: {"CONTENT_DISTINCT": 342, "EMPTY": 26, "NONEMPTY_DUPLICATE_BODY": 3}
source reads: 136 total; 129 added new lines; 7 were pure re-reads
total new distinct lines added: 4388
distinct sources read: 50
FACTUALLY_NOVEL (decision-relevant): UNPROVEN at this layer
```
Exit code: **0**

The regenerated timeline's `CONTENT_DISTINCT` count now equals the independent
novelty probe's **342**. The legacy `information_gain` key is gone from the
timeline; results are classified `EMPTY` / `CONTENT_DISTINCT` / `NONEMPTY`.

`FACTUALLY_NOVEL` remains **`UNPROVEN`** — distinct bodies are a diversity
measurement, not proof of decision-relevant novelty.

### 2.3 Verdict stability (P1)

```
$ python3 tools/readiness-probe.py \
    --session-dir ~/.vscodium-roz/cline-data/sessions/1795252560069_t82cp \
    --out readiness-probe.json
all_ten_subjects_verdicted=True
readiness_turn_index=271
cost_after_readiness={"output_tokens_after_readiness": 71194, "tool_calls_after_readiness": 202, "turns_after_readiness": 174}
readiness_semantics: first_recorded_verdict_coverage=271; independent_factual_sufficiency=UNPROVEN
subjects_refined_after_first_assertion=[2, 3, 4, 5, 6, 7, 9, 10] (8/10)
all_first_assertions_stable=False (turn_all_first_assertions_stable=None)
last_verdict_change_turn=634 (the last turn at which a subject's verdict-class set DIFFERED from its previous assertion)
last_verdict_assertion_turn=638 (the last turn at which any subject produced a verdict assertion of any kind, including a repetition)
NOTE: a null first-assertion-stability turn does NOT establish that no later stable turn exists.
```
Exit code: **0**

The metric now states only what it measures. **Independent factual sufficiency
remains `UNPROVEN`.**

### 2.4 P1 residue — the change-turn metric name and value

A further non-blocking review residue was raised after the first CORRECTION02
commit: the metric was **named** `last_verdict_change_turn` but **computed**
`max(index for index, _ in assertions)` — the last turn at which any subject
produced a verdict **assertion**. That is an assertion timestamp, not the last
turn a verdict **changed**.

**Correction.** The change turn is now computed by comparing successive
verdict-class sets per subject, and **both** quantities are published under
distinct names:

| Metric | Value | Meaning |
|---|---|---|
| `last_verdict_change_turn` | **634** | last turn at which a subject's verdict-class set **differed** from its previous assertion |
| `last_verdict_assertion_turn` | **638** | last turn at which any subject produced a verdict assertion of **any** kind, including a repetition |

**The previously published `638` is withdrawn as a change turn.** Turn 634 is
R4's class set changing to `SUFFICIENT` — the last substantive change. Turns
636 and 638 are R1 re-asserting `CONFIRMED`, an identical class set, and are
therefore repetitions rather than changes.

Per-subject, `R1` and `R8` report `change = null` (their only assertion was
their first, so their verdict never changed) while still reporting their
assertion turns (638 and 543). `R2` and `R7` show gaps of 79 and 93 turns
between their last change and their last assertion. Every subject's change
turn is `<=` its assertion turn.

Independent verification of the tail (rebuilding the assertion history from
the session messages independently of the probe):

```
=== assertions at/after turn 600 ===
  turn 636  R1   classes=('CONFIRMED',)
  turn 638  R1   classes=('CONFIRMED',)
  turn 630  R4   classes=('CONDITIONAL', 'CONFIRMED', 'NARROWED')
  turn 634  R4   classes=('SUFFICIENT',)
last 3 actual CHANGES: [(507, 3, ...), (630, 4, ...), (634, 4, ('SUFFICIENT',))]
max change turn       : 634
max assertion turn    : 638
```

---

## 3. Focused assertions

`tools/assert-corrections.py` is the executable receipt for this correction. It
asserts **26 positive properties** of the corrected probes and regenerated
artifacts, plus **4 negative controls** that prove the suite can actually fail.

```
$ python3 tools/assert-corrections.py --act-dir . --out assertions.json
...
30/30 assertions passed
```
Exit code: **0**

| Group | Assertions | Covers |
|---|---|---|
| **A — compaction generation identity** | A1–A11 | enriched projection strips to the same generation; a genuinely different summary does not; the transition classifier emits `FIRST_SUMMARY` / `NEW_COMPACTION` / `SAME_GENERATION_ENRICHED`; the historical run yields 8 generations / 8 events / 8 transformations at the exact expected iterations; retention 257/257 |
| **B — result fingerprint ordering** | B1–B5 | a synthetic 3-result probe yields `CONTENT_DISTINCT, NONEMPTY, EMPTY`; membership is tested before insertion; the regenerated timeline emits `CONTENT_DISTINCT`; the legacy `information_gain` key is absent; the timeline count equals the independent novelty probe's count |
| **C — verdict-stability metric** | C1–C10 | the metric is named for what it measures; a null value is *not* accompanied by a claim that no later stable turn exists; `last_verdict_change_turn` is reported and is a real turn; 8/10 first assertions refined; independent sufficiency remains `UNPROVEN`; the change turn and the assertion turn are published separately and are **distinct** values; each carries its own explicit meaning; a subject that never changed reports `change = null`; every change turn is `<=` its assertion turn |
| **N — negative controls** | N1–N4 | the pre-fix ordering yields no `CONTENT_DISTINCT`; the pre-fix strip leaves base ≠ enriched; the pre-fix counting yields 16 events, not 8; the pre-fix change metric equalled the assertion turn |

The negative controls matter: a suite that only passes is not evidence that it can
fail. N1–N3 reconstruct each pre-correction defect in isolation and assert that the
corresponding check **would** fail.

---

## 4. Deterministic reproduction

Every artifact was regenerated into a scratch directory and compared byte-for-byte
against the published artifact.

```
=== byte-identical check ===
IDENTICAL  compaction-probe.json
IDENTICAL  timeline.jsonl
IDENTICAL  novelty-probe.json
IDENTICAL  readiness-probe.json
```

All four regenerate **byte-identically** from the private captures.

---

## 5. Production-seam control

```
$ git diff --stat HEAD -- sdk/ apps/ src/
(no output)
```

**No production file was modified.** The change set contains only evidence artifacts
and the epic-board update. The production seams inspected remain the ones named in
`source-map.md`; the installed extension artifact and its SHA-256 are unchanged and
recorded in `artifact-hashes.json`.

---

## 6. Sanitization

| Check | Result |
|---|---|
| Credential patterns (`sk-*`, `api_key=`, `Bearer`, `ghp_*`, `x-access-token`) | **none found** |
| Raw capture contents copied into published artifacts | **none** |
| Session / capture paths in narratives | `~`-relative only |
| `artifact-hashes.json` absolute paths | local filesystem paths only (parent design; no credentials) |

---

## 7. P2 cleanup (batched)

| Item | Disposition |
|---|---|
| Extra blank line at EOF | **FIXED** — `tools/novelty-probe.py` normalized; probe output verified unchanged (342 / 26 / 3) |
| Invalid legacy gate-summary binding | **NOT MODIFIED — out of ACT scope** |

The gate-summary issue is a `.factory/`-level metadata artifact bound to
`ACT-CLINEMM-SEATBELT-SSH-AGENT-AUTHORITY-IMPLEMENTATION01`, not to this ACT. The
review classified it as a **separate non-blocking Factory metadata issue** that
"does not invalidate the independently recorded 87 passing tests", and directed that
no cleanup campaign is warranted. Writing a new gate summary for this ACT would
assert gate coverage this ACT did not run. It is therefore recorded as an
outstanding non-blocking item for the Factory, **not** silently fixed.

---

## 8. Hypothesis dispositions (unchanged)

| Hypothesis | Disposition | Basis |
|---|---|---|
| **H1** — Model stopping judgment | **SUPPORTED**, not proved exclusive | completion tool present in schema 277/277; completion obligation present 277/277; autonomous `submit_and_exit` 0/277; every autonomous turn contained a tool call |
| **H2** — Completion-contract failure | **SUBSTANTIALLY REFUTED** | `submit_and_exit` exposed in all 277 requests; obligation present in all 277; the tool worked after operator intervention, including deferred completion |
| **H3** — Compaction-induced progress loss | **NARROWED** | **8 compaction events** + 8 enrichments; contract/obligation/evidence-record retained 257/257 (presence only); full evidence completeness NOT established |
| **H4** — Ineffective evidence collection | **INCONCLUSIVE** | body diversity measured (342 `CONTENT_DISTINCT`), but `FACTUALLY_NOVEL` is `UNPROVEN`; a repeated command is not by itself evidence of a redundant investigation |
| **H5** — Output-budget boundary | **REFUTED** for the observed autonomous turns | no recorded autonomous response hit the 16,384-token output limit |

**No ClineMM production defect has been reproduced.** No repair is justified.

---

## 9. Exit status

`PASS_BOUNDARY_CLASSIFIED` continues to hold for the parent ACT, now on corrected
evidence.

This correction is complete:

* P0-1 corrected — summary-generation identity now distinguishes a new generation
  from an enrichment of the same generation; the historical run yields **8**
  compaction events, **16** provider-visible payloads and **8** transformations.
* P0-2 corrected — the timeline's fingerprint membership is tested before insertion;
  the regenerated timeline reports **342** `CONTENT_DISTINCT`, matching the
  independently-implemented novelty probe.
* P1 corrected — the metric is `first_assertion_stability`, the unsupported
  "no later stable turn" conclusion is withdrawn, and the change/assertion turn
  distinction is repaired (`last_verdict_change_turn = 634`,
  `last_verdict_assertion_turn = 638`).
* Artifacts regenerated, hashes refreshed, deterministic reproduction verified
  byte-identical.
* Focused assertions: **30/30 passed, exit 0**, including 4 negative controls.
* **No production change.**

### Successor

`ACT-CLINEMM-ROUND-C-CONVERGENCE-EXPERIMENT-01` is authorized as a **bounded paired
feasibility pilot** — not conclusive evidence of model superiority. It must vary only
the evidence-neutral completion reminder, keep tool calls permitted, and measure
**autonomous completion** alongside **independently assessed, blinded verdict
quality**, tool use and source-content novelty. One pair, not an unrestricted
multi-hour run.

The separate stable-prefix live qualification
(`ACT-CLINEMM-COMPACTION-STABLE-PREFIX-LIVE-QUALIFICATION-01`) remains **open** and
is not merged into this ACT.

---

## 10. Artifact index

All paths relative to
`.factory/evidence/ACT-CLINEMM-ROUND-C-NONCONVERGENCE-RECON-01/`.

| Artifact | Role |
|---|---|
| `source-map.md` | production boundaries, installed/source identities |
| `timeline.jsonl` | event ledger (661 events) |
| `timeline-summary.md` | four-interval narrative |
| `readiness-analysis.md` | earliest defensible synthesis point and subsequent work |
| `readiness-probe.json` | readiness + first-assertion-stability measurement |
| `causal-discriminators.md` | H1–H5 evidence, controls, verdicts |
| `qualification-report.md` | findings, limitations, successor recommendation |
| `compaction-probe.json` | compaction generation/event/transformation identity |
| `novelty-probe.json` | result-body tiers + per-source novelty |
| `assertions.json` | the 24 focused assertions and their results |
| `artifact-hashes.json` | source revision, paths, byte sizes, SHA-256 |
| `tools/compaction_probe.py` | compaction identity probe (renamed from `compaction-probe.py`) |
| `tools/build-timeline.py` | timeline builder (imports the shared identity logic) |
| `tools/novelty-probe.py` | novelty probe |
| `tools/readiness-probe.py` | readiness probe |
| `tools/assert-corrections.py` | focused assertion suite |
| `tools/build-artifact-hashes.py` | artifact hash builder |
