# ACT-CLINEMM-ROUND-C-NONCONVERGENCE-RECON-CORRECTION01 — PASS_EVIDENCE_STRENGTH_CORRECTED — 2026-11-21

**Type:** Evidence-only corrective continuation of
`ACT-CLINEMM-ROUND-C-NONCONVERGENCE-RECON-01` (commit `1df0217fb`).

**Production changes:** NONE. No production file was modified, rebuilt,
packaged or installed. No inference was re-run against a new capture; every
number below comes from the **existing** captures and the **existing** session
artifacts.

---

## 1. Why this continuation exists

Expert review of `1df0217fb` found three P0 **evidence-contract** problems:
observations had been promoted into causal conclusions beyond their actual
evidence strength. This continuation reclassifies those three claims, narrows
the affected hypothesis verdicts, and preserves everything that was already
directly observed.

The reviewer's own disposition is accepted in full:

| Hypothesis | Parent ACT | Reviewer | **This correction** |
|---|---|---|---|
| H1 model stopping judgment | SUPPORTED (primary) | SUPPORTED, not proved exclusive | **SUPPORTED, not proved exclusive** |
| H2 completion-contract failure | REFUTED | SUBSTANTIALLY REFUTED | **REFUTED (unchanged, re-verified)** |
| H3 compaction progress loss | REFUTED | retention established; full preservation not established | **NARROWED** |
| H4 ineffective evidence loop | REFUTED | INCONCLUSIVE on factual information gain | **INCONCLUSIVE** |
| H5 output-budget boundary | REFUTED | REFUTED for observed turns | **REFUTED (unchanged, re-verified)** |

---

## 2. F1 — the compaction count

### The error

The parent ACT reported **"257 real compaction boundaries"**. That number
counted provider requests whose `messages[0]` was a compacted summary. A
summary **persists** across many requests, so a request count was presented
as an event count.

### The correction

A new compaction **replaces** the summary. Therefore a change in the carried
summary's **identity** is the authoritative observable signature of a new
compaction.

```
$ python3 tools/compaction-probe.py \
    --capture-dir ~/.vscodium-roz/cline-data/provider-request-captures \
    --out compaction-probe.json
provider requests total                       : 277
requests carrying a compacted summary (STATE) : 257
requests without a compacted summary          : 20
distinct summary generations                  : 16
compaction EVENTS observed (identity change)  : 16
retention (task contract)                     : 257/257
retention (completion obligation)             : 257/257
retention (canonical evidence record)         : 257/257
```

**16 compaction events**, across 16 distinct summary generations. The 16
payloads decompose into **8 compaction generations × 2 projections**: each
generation appears once as the base summary and once more with the
`## Active task contract (authoritative)` section appended (a 41-byte delta,
verified by line diff).

### What changed and what did not

* **CHANGED:** "257 compactions" → "**16 compaction events**; 257 requests
  carried a compacted summary". Both numbers are published, with their
  meaning, in `compaction-probe.json`.
* **UNCHANGED:** the retention result, **257 / 257** for the task contract,
  the runtime completion obligation and the canonical evidence record. The H3

---

## 3. F2 — novelty versus information gain

### The error

The parent ACT classified results as `information_gain = "none" |
"content_present"` — a **NONEMPTY** check — and then treated "186 novel
results" as proof that the post-readiness work was productive.

### The correction

Three mechanically verifiable tiers are now separated from the one that is
not:

| Tier | Meaning | Status |
|---|---|---|
| `EMPTY` | no result body | measurable |
| `NONEMPTY` | a result body exists | measurable |
| `CONTENT_DISTINCT` | the body differs from every other body seen | measurable |
| `FACTUALLY_NOVEL` | the read contributed a new decision-relevant fact | **UNPROVEN** |

The ledger key `information_gain` was **removed** and replaced by
`result_class` plus an explicit `factually_novel: "UNPROVEN_AT_THIS_LAYER"`.
Verified: the legacy key no longer appears in `timeline.jsonl`.

```
$ python3 tools/novelty-probe.py --session-dir <private> --out novelty-probe.json
body tiers: {"CONTENT_DISTINCT": 342, "EMPTY": 26, "NONEMPTY_DUPLICATE_BODY": 3}
source reads: 136 total; 129 added new lines; 7 were pure re-reads
total new distinct lines added: 4388
distinct sources read: 50
FACTUALLY_NOVEL (decision-relevant): UNPROVEN at this layer
```

### The stronger measurement added

`CONTENT_DISTINCT` is still only body-level diversity. A strictly stronger,
mechanically verifiable measurement was added: for every read attributable to
a **source** (file path or URL), the normalised lines are compared against
the union of lines already seen from that **same** source. A read adding no
unseen line is a **pure re-read**; a read adding unseen lines contributed
**new source content**.

| Measure | Value |
|---|---|
| Source-attributable reads | 136 |
| Reads adding ≥1 previously-unseen line from that source | **129** |
| Pure re-reads | **7** |
| Total new distinct lines added | **4,388** |
| Distinct sources read | 50 |

This is strong evidence against the *literal* redundancy clause of H4, but it
does **not** settle the second clause ("changed its conclusion without new
evidence"), which requires an independent adjudication of R1–R10 — out of
scope for this ACT.

### Verdict change

**H4: REFUTED → INCONCLUSIVE.**

---

## 4. F3 — readiness was promoted beyond the rubric

### The error

The parent ACT reported turn 271 as the "earliest independently defensible
synthesis point" and asserted that the necessary evidence was therefore
available for the whole run.

### The correction

The rubric detects the model's **own recorded adjudication language**. It
therefore establishes **first recorded verdict COVERAGE** — the earliest turn
at which all ten subjects had some recorded verdict assertion. It does **not**
establish independent factual sufficiency.

The readiness probe was extended to measure per-subject verdict **stability**:

| Subject | First assertion | Stability |
|---|---|---|
| R1 | 153 | `STABLE` |
| R2 | 134 | `REFINED` |
| R3 | 229 | `REFINED` |
| R4 | 221 | `REFINED` |
| R5 | 192 | `REFINED` |
| R6 | 64 | `REFINED` |
| R7 | 177 | `REFINED` |
| R8 | 271 | `STABLE` |
| R9 | 56 | `REFINED` |
| R10 | 53 | `REFINED` |

**8 of 10 subjects** had their first assertion later refined. Only R1 and R8
were stable. A first assertion the model itself later refined was not final,
so its turn is not a defensible synthesis point for that subject.


---

## 5. Re-verification of the unchanged conclusions

The H2 and H5 conclusions were **not** affected by the three findings, and
were re-verified against the same captures:

| Claim | Re-verified value |
|---|---|
| `submit_and_exit` in the provider-visible tool schema | **277 / 277** |
| Completion obligation present anywhere in the request | **277 / 277** |
| Distinct `maxOutputTokens` values | **{16384}** |
| Max output tokens used in any autonomous turn | **3,130** (19.1 % of 16,384) |
| p50 output tokens per autonomous turn | **380** |
| Truncations / `max-tokens` finish reasons in the autonomous phase | **0** |
| Autonomous `submit_and_exit` calls | **0** |
| Autonomous turns with no tool call | **0 / 277** |
| Production-seam control | `bun x vitest run src/extensions/tools/definitions.test.ts` → exit `0`, **87 passed** |

**One H2 measurement was also strengthened** for the record: the completion
obligation was previously reported as present in `messages[0]` (257/277).
The corrected measurement is over the **whole request**, because before the

---

## 7. Conservation and forbidden shortcuts

| Guarantee | Status |
|---|---|
| Canonical evidence authority | **PRESERVED** — the correction narrows a *claim about* it; it does not alter it |
| Task-contract continuation | **PRESERVED** — 257/257 retention re-verified |
| Successful tool-call/result correlation | **PRESERVED** — unchanged |
| Failed and ambiguous result rejection | **PRESERVED** — the `EMPTY` tier now makes empty/failed results explicit rather than lumped into "content_present" |
| Request-budget fail-closed behaviour | **PRESERVED** — untouched; no budget error occurred in the session |
| Sidecar/resume integrity | **PRESERVED** — sidecar `source_prefix_hash` / `source_last_message_key` re-verified intact |
| Exact session/task/epoch terminality | **PRESERVED** — unchanged (0 autonomous / 2 post-intervention `submit_and_exit`) |

**Forbidden shortcuts — none taken.** No stop-after-N-tools rule. No
diagnostic side effects in React functional updaters. No prompt, compaction
policy or tool-authorization change. No Strata or cache-policy change. No
new harness comparison. **No synthetic observations** — every number comes
from the pre-existing captures. No expansion into orchestration redesign. No
new scoring infrastructure: the two new probes are read-only re-derivations
of the **same** artifacts the parent ACT already consumed.

---

## 8. Sensitive-data boundary

The two new probes publish only aggregates and non-reversible fingerprints.
`novelty-probe.json` publishes each source as `sha256:<16 hex>` plus a
`source_kind` of `FILE_PATH` / `URL` — **no source path or URL is published**,
because a private repository path is itself sensitive. No raw result text,
command text, file content or credential appears in any artifact.

Verification: 0 strings longer than 200 characters in `timeline.jsonl`; 0
credential-shape matches across the published set; **gitleaks reported "no
leaks found"** on the commit.

---

## 9. Decision

**PASS_EVIDENCE_STRENGTH_CORRECTED.** The three overclaims are corrected at
source, the affected verdicts are narrowed to their true evidence strength,
the two unaffected verdicts are re-verified, and the direct completion-tool
observations are preserved intact.

The central result of the parent ACT is **unchanged**: the completion tool
was exposed, the completion obligation was present, and the model never
invoked the route. What changed is the honesty of the surrounding claims:
the evidence-sufficiency half is now **UNPROVEN**, the evidence-collection
hypothesis is **INCONCLUSIVE**, and the compaction count is **16 events**.

**Successor:** `ACT-CLINEMM-ROUND-C-CONVERGENCE-EXPERIMENT-01` is authorised
to proceed, now with two concrete additions that this correction makes
necessary:

1. **Independently assessed verdict quality** as a first-class secondary
   endpoint, assessed by a party that did not watch the arm — because
   CORRECTION01 F3 left evidence sufficiency open, and the parent rubric
   measures only the model's own recorded adjudication language;
2. **the per-source novelty metric** in each arm, so that a treatment arm
   converging by *abandoning* investigation is distinguishable from one
   converging after doing the work.

The experiment should begin with **one bounded paired pilot**, not another
unrestricted multi-hour run. Tool calls remain permitted in both arms.

`ACT-CLINEMM-COMPACTION-STABLE-PREFIX-LIVE-QUALIFICATION-01` remains open
and separate and was **not** merged into this continuation.

first compaction the obligation lives in `messages[1]`. The whole-request
figure is **277 / 277** — the H2 conclusion is now stated on the strongest
available measurement.

---

## 6. Verification commands and their results

Every command was run; every exit code is stated.

| Command | Exit | Result |
|---|---|---|
| `python3 tools/compaction-probe.py --capture-dir <private> --out compaction-probe.json` | `0` | 277 requests; 257 carrying a summary; **16 compaction events**; retention 257/257 ×3 |
| `python3 tools/novelty-probe.py --session-dir <private> --out novelty-probe.json` | `0` | tiers `CONTENT_DISTINCT` 342 / `EMPTY` 26 / `NONEMPTY_DUPLICATE_BODY` 3; 129/136 source reads added new lines; 4,388 new lines |
| `python3 tools/build-timeline.py --session-dir <private> --capture-dir <private> --out timeline.jsonl` | `0` | 661 events; legacy `information_gain` key absent; `compaction_event` true for 16 |
| `python3 tools/readiness-probe.py --session-dir <private> --out readiness-probe.json` | `0` | coverage turn 271; 8/10 `REFINED`; `last_turn_all_ten_verdicts_STABLE` = null |
| `bun x vitest run src/extensions/tools/definitions.test.ts --config vitest.config.ts` | `0` | **87 passed (87)** — production-seam control, unchanged |
| `python3 tools/build-artifact-hashes.py …` | `0` | `artifact-hashes.json` regenerated with the new artifacts |

**ACT-owned failures: zero.** No pre-existing diagnostic was disturbed; this
continuation touched no production file, so the baseline is untouched.

Consequently `last_turn_all_ten_verdicts_STABLE` is **`null`**, and
**independent readiness is `UNPROVEN`**. The parent ACT's "readiness
established" phrasing is **withdrawn**.

### What survives — and what the causal claim now rests on

The H1 verdict does **not** rest on readiness. It rests on two directly
measured facts:

1. the completion tool was in the provider-visible schema and the completion
   obligation was in the request in **277 / 277** pre-intervention requests;
2. the model invoked the completion route **0** times — not even on turns
   where it recorded explicit sufficiency (*"I have enough for R4"*, turn 634).

**H1: SUPPORTED (primary) → SUPPORTED, not proved exclusive.**

  *retention* conclusion stands.
* **NARROWED:** H3 moves from REFUTED to **NARROWED**, because the probe
  verifies the **presence** of the `<!-- cline-evidence:begin -->` record,
  not the **completeness** of every prior tool outcome. The parent ACT's
  "no evidence was lost" phrasing was stronger than the evidence supports.
