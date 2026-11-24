# ACT-CLINEMM-PCK-EVIDENCE-FIRST-INPUT-RECON-01 — summary

```text
ACT_ID:   ACT-CLINEMM-PCK-EVIDENCE-FIRST-INPUT-RECON-01
ROW:      A02b-R7
TYPE:     bounded executable recon (no production input-representation change)
ENTRY_HEAD: 8a78510b8
VERDICT:  PCK_INCREMENTAL_UTILITY_NOT_ESTABLISHED
```

## WHAT WAS ASKED

Determine the cheapest trustworthy representation of pre-compaction working
knowledge that preserves meaningful checkpoint utility, and — before
optimising the input — test whether the PCK needs a separate LLM request
for every checkpoint at all.

## WHAT WAS DONE

| Section | Outcome |
| --- | --- |
| **C0** | A REAL mature session was recovered (`1795489471969_tachv`, SHA-256 `3d398ad2…db9b27`, 114 messages, 56 joined canonical tool events). The captured history lives only in the gitignored `tmp/` tree. |
| **C1** | Production source recon of `buildCheckpointInputView()`, `buildCheckpointRequest()`, `interpretCanonicalEvidence()`, the closed vocabulary, the publication gate, the projection, the verified-outcome ledger, the task contract and the tokenizer. |
| **C2** | Four candidates built and evaluated against that SAME history: A (existing full-history), B (evidence-first), C (evidence-only), D (deterministic extraction). |
| **C3** | An independently-built utility oracle: 10 frozen findings with their ratings (already preserved by the task contract), 56 runtime-owned observations (already preserved by the verified-outcome ledger), 10 task-contract prohibitions. |
| **C4** | The executable comparison against the LIVE qualified endpoint, with the production transport, policies, parser and gate, and the physical-request count MEASURED. 16 candidate runs. |
| **C5** | 8 trust-boundary conservation witnesses, all passing. |
| **C6** | The decision and the successor question. |

## THE THREE FINDINGS THAT MATTER

### 1. THE OUTPUT BUDGET IS THE FIRST-ORDER DEFECT

At the production 1024-token output budget, **every** inference candidate
fails with `finish_reason=length`, including the production baseline:

| Candidate | Latency | Admitted records |
| --- | --- | --- |
| A (baseline) | **237.8 s** | **0** |
| B (evidence-first) | 33.4 s | 0 |
| C (evidence-only) | 29.3 s | 0 |

Candidate C was repeated **4 times** at the production budget: **4/4
failures, 0 admitted records, every time.** The baseline burns 237.8 s and
would be killed by the 180 s PCK deadline before it could return.

### 2. THE BOTTLENECK IS THE CLOSED PUBLICATION VOCABULARY, NOT THE INPUT

Input reduction is achievable — **96.8 %** (B) and **98.2 %** (C) — and
candidate C reaches **4 942 actual prompt tokens**, comfortably inside the
8 000-token target. But the published statement is RENDERED from six atom
labels and six argument labels, and the argument vocabulary's only
deterministically-establishable entry is `build` via `make build`.

On this workload **0 of 56** canonical tool events carry that
classification (43 `run_commands` unclassified, 5 classified only as `sed`,
5 `fetch_web_content`, 3 `read_files`). So every admitted statement renders
generically: candidate B admitted **10 records with 10 generic
statements**; candidate C admitted **5–6, all generic**
(`operation invoked: none`, `implementation inspected: none`).

### 3. THE DETERMINISTIC DISCRIMINATOR IS NOT FEASIBLE FOR THIS WORKLOAD

Candidate D costs **2 ms** and **0 physical requests** and produces
**nothing**, because its establishable surface is empty.

## THE DECISION

```text
MATURE_HISTORY_IDENTITY=1795489471969_tachv
BASELINE_INPUT_TOKENS=98701
EVIDENCE_FIRST_INPUT_TOKENS=3175
EVIDENCE_ONLY_INPUT_TOKENS=1755
DETERMINISTIC_EXTRACTION_FEASIBILITY=NOT_FEASIBLE_FOR_THIS_WORKLOAD
INCREMENTAL_KNOWLEDGE_UTILITY=NOT_ESTABLISHED
ASSURANCE_CONSERVATION=PASS
CONFIDENTIALITY_CONSERVATION=PASS
PREFERRED_CANDIDATE=NONE
VERDICT=PCK_INCREMENTAL_UTILITY_NOT_ESTABLISHED
```

The engineering targets were met; the **utility** target was not. The ACT
instructs: *"If no candidate demonstrates incremental utility, report that
outcome rather than forcing a production optimization."*

Optimising the input would make the PCK faster and cheaper while
preserving exactly nothing. A fast, cheap, useless checkpoint is harder to
notice and therefore harder to remove — strictly worse than ordinary
compaction.

## WHAT THE ACT DOES NOT RECOMMEND

It does not recommend an input-representation change. There is nothing to
gain: the reduced input preserves nothing that the reduced input's records
can express.

## THE QUESTION IT LEAVES FOR A SUCCESSOR

Not *"how do we make the input smaller?"* but:

- **(a)** should the closed vocabulary carry a bounded, **runtime-owned**
  observation payload — an allowlisted command subject already computed by
  `classifyCommand()` — so a record can say *which* operation was invoked
  rather than merely *that* one was? **or**
- **(b)** should the PCK be retired in favour of the existing
  verified-outcome ledger and task contract, which already carry this
  workload's working knowledge? **or**
- **(c)** should the PCK be scoped to the workloads where its deterministic
  surface is non-empty, and skipped otherwise?

Option (a) keeps the trust boundary exactly as it is: an allowlisted
subject is a constant from a closed set, rendered by the host — the same
property the current atom labels have.

This ACT does not authorise any of the three; it attaches the evidence and
leaves the answer to the successor. **A02b-R9** (the generation-time record
budget) is now the highest-value follow-up, because it is a NUMBER rather
than an architecture.

## WHAT IS NOT CLAIMED

```text
INSTALLED-LIVE QUALIFICATION:  NOT EXECUTED.
MATURE-CONTEXT UTILITY:         NOT ESTABLISHED in either direction. ONE real
                                mature session, ONE live endpoint, 16 runs.
                                No convergence, multi-session, or
                                other-workload claim.
OUTPUT-BUDGET VARIANCE:         MEASURED. Candidate C is STABLE at each
                                budget (4/4 failures at 1024, 5/5 successes
                                at 4096). Candidate B is VARIABLE at 4096
                                (1 success, 2 failures), so a production
                                budget must be sized against the worst
                                candidate.
CACHE CONDITIONS:              NOT COMPARABLE ACROSS ALL RUNS. The canonical
                                reference list is a stable prefix; once
                                warm, candidate C reported 4 935 of 4 942
                                prompt tokens cached (99.9%). Cold runs
                                reported 0. Latency figures span both and
                                are reported separately.
```

## THE CONFIDENTIALITY DISCIPLINE

Nothing from the acquired session reached committed evidence except
aggregate, non-reversible counts. The canonical history and the raw model
outputs live only in the gitignored `tmp/` tree. The committed evidence
contains no private repository content, no credential, and no raw reasoning.
Every admitted record reproduced in the evidence is a runtime-owned
constant, so it is safe to commit by construction.

## THE GATES

```text
PCK REGRESSION SUITE:  16 files, 152/152 PASS
  (including the 8 new R8a witnesses and the 8 new C5 conservation
   witnesses)
TYPECHECK DELTA:       45 -> 45 (zero); no diagnostic in any ACT-owned file
CONFIDENTIALITY:       the acquired history and raw model outputs are
                       gitignored; committed evidence carries aggregates
                       and runtime-owned constants only
```

## THE ARTEFACTS

| Path | Role |
| --- | --- |
| `sdk/packages/core/scripts/pck-input-recon.acquire-history.ts` | C0 — acquires a REAL session's canonical history |
| `sdk/packages/core/scripts/pck-input-recon.utility-oracle.ts` | C3 — the independent utility inventory |
| `sdk/packages/core/scripts/pck-input-recon.compare.ts` | C4 — the executable comparison |
| `sdk/packages/core/src/extensions/context/precompaction-knowledge-checkpoint/input-candidates.recon.ts` | the four candidate representations (RECON-ONLY) |
| `sdk/packages/core/src/extensions/context/precompaction-knowledge-checkpoint/pck-input-candidates.recon.test.ts` | C5 — the 8 conservation witnesses |
| `sdk/packages/core/src/extensions/context/precompaction-knowledge-checkpoint/pck-physical-request-cardinality.r8a.test.ts` | A02b-R8a — the 8 retry-authority witnesses |
