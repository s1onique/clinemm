# ACT-CLINEMM-PCK-EVIDENCE-FIRST-INPUT-RECON-01 — C6 the decision

## THE EXIT RECORD

```text
MATURE_HISTORY_IDENTITY=1795489471969_tachv
  (canonicalHistorySha256=3d398ad20c71e9136fb592bb9853a2d9565a0862d368ad76cc211e96a7db9b27,
   extensionVersion=4.1.26-6fdf56079, 114 messages, 56 joined canonical tool events,
   REAL persisted session, not a synthetic fixture)

BASELINE_INPUT_TOKENS=98701          (estimated, candidate A)
BASELINE_ACTUAL_PROMPT_TOKENS=NOT_REPORTED  (the baseline request never completed)

EVIDENCE_FIRST_INPUT_TOKENS=3175     (estimated, candidate B)
EVIDENCE_FIRST_ACTUAL_PROMPT_TOKENS=6376

EVIDENCE_ONLY_INPUT_TOKENS=1755      (estimated, candidate C)
EVIDENCE_ONLY_ACTUAL_PROMPT_TOKENS=4942

DETERMINISTIC_EXTRACTION_FEASIBILITY=NOT_FEASIBLE_FOR_THIS_WORKLOAD
  (0 records: 0 of 56 canonical tool events carry the `make build`
   classification, which is the ONLY classification that establishes the ONLY
   establishable argument; the deterministic surface is EMPTY)

INCREMENTAL_KNOWLEDGE_UTILITY=NOT_ESTABLISHED
  (0 of the 10 relevant items — the ten frozen findings — are carried by the
   closed vocabulary at all; the remaining 56 runtime observations are already
   preserved by the production verified-outcome ledger; every admitted
   statement measured was generic (`operation invoked: none`))

ASSURANCE_CONSERVATION=PASS
  (C5 witnesses 8/8; the assurance ceiling is computed from the CANONICAL
   history, never from the candidate's view; omission can only downgrade)

CONFIDENTIALITY_CONSERVATION=PASS
  (the acquired history and the raw model outputs live only in the gitignored
   `tmp/` tree; no private repository content, credential or raw reasoning
   reached committed evidence; no candidate carries private reasoning; no
   candidate carries raw tool output)

PREFERRED_CANDIDATE=NONE
  (no candidate is recommended for production implementation)

VERDICT=PCK_INCREMENTAL_UTILITY_NOT_ESTABLISHED
```

## WHY THE VERDICT IS NOT `GO_BOUNDED_INPUT_IMPLEMENTATION`

Candidate B and candidate C DO meet the engineering targets on their own
terms:

| Target | Required | Candidate C measured | Met? |
| --- | --- | --- | --- |
| Input | ≈ 8 000 tokens or less | **4 942 actual** / 1 755 estimated | **YES** |
| Added PCK latency | ≈ 30 s or less on the current P40 backend | 91.6 s (cached-prefix run) / 33.9 s (uncached run) | **MARGINAL** |
| No repeated physical requests | required | **1** on every measurement | **YES** |
| Useful incremental checkpoint knowledge | required | **0** | **NO** |
| No trust-boundary regression | required | **PASS** | **YES** |

The ACT says: *"Select the simplest candidate justified by the evidence"* and
*"If no candidate demonstrates incremental utility, report that outcome rather
than forcing a production optimization."*

The input-reduction and latency goals are achievable. **The utility goal is
not.** Optimising the input would make the PCK **faster and cheaper while
preserving exactly nothing** — a strictly worse outcome than doing nothing,
because a fast, cheap, useless checkpoint is harder to notice and therefore
harder to remove.

## WHY THE VERDICT IS NOT `GO_DETERMINISTIC_CHECKPOINT_DISCRIMINATOR`

Candidate D is the cheapest possible answer — 2 ms, zero physical requests,
zero latency — and it is the **wrong** answer on this workload. Its
deterministic surface is empty because the production command allowlist's
establishable classification (`make build`) does not appear in the workload's
56 canonical tool events.

Recommending D would mean recommending a mechanism that is silent and empty
for every workload except those that happen to run `make build`. That is a
narrow, workload-specific optimisation masquerading as an architecture.

## WHY THE VERDICT IS NOT `CAPTURE_INSUFFICIENT`

The capture was sufficient. The REAL mature session was recovered, its
identity is pinned by a SHA-256, all 114 messages and all 56 joined
canonical tool events were loaded, and every candidate was evaluated
against that SAME history with the REAL production transport against the
LIVE qualified endpoint. The measurements are repeatable and the
conclusions are stable across repeats.

The insufficiency, if any, is in the **closed vocabulary**, not in the
capture.

## THE ACTUAL FINDING

**The bottleneck is not the input representation. It is the closed
publication vocabulary.**

The closed vocabulary was designed to make a checkpoint safe: every
published byte is a runtime-owned constant, so no model-authored string can
reach the persisted sidecar or the provider-visible continuation. That
property is intact and must not be weakened.

But the same property means a published record can carry **no content**:
the statement is rendered from six atom labels and six argument labels, and
the argument vocabulary's only deterministically-establishable entry is
`build` via `make build`. On a workload whose commands carry no such
classification, every admitted record renders as `operation invoked: none`.

The measurement makes the consequence concrete:

- Candidate B: **10** admitted records, **10** generic statements.
- Candidate C: **5–6** admitted records, **all** generic statements.
- Candidate A: **0** admitted records at 1024 tokens, **0** at 4096, after
  **291.4 s**.

**A checkpoint that publishes `operation invoked: none` five times is
strictly worse than an ordinary compaction**, which at least carries the
task contract's findings and the verified-outcome ledger.

## WHAT THE EVIDENCE DOES SUPPORT

Three findings are solid and actionable, and none of them requires changing
the trust boundary:

1. **The output budget is the first-order defect.** At the production
   1024-token budget EVERY inference candidate fails with
   `finish_reason=length`, including the baseline. Candidate A burns
   **237.8 s** and admits nothing. This is **A02b-R9** (the generation-time
   record budget) and it is the highest-value follow-up, because it is a
   NUMBER, not an architecture.

2. **The input representation can be reduced by 96.8–98.2 %** with no
   trust-boundary change, if a future record vocabulary makes that
   reduction worth taking. The reduced candidates reach **4 942** actual
   prompt tokens — comfortably inside the 8 000-token target.

3. **The physical-request contract held on every single measurement** in
   this ACT: **1** physical request on every live candidate run, including
   every failure. The A02b-R8 repair is confirmed against the live
   endpoint, not only against synthetic wire responses.

## THE RECOMMENDED NEXT STEP

**Do not change the input representation.** There is nothing to gain: the
reduced input preserves nothing that the reduced input's records can
express.

Instead, the next ACT should decide, with the evidence now in hand:

- **(a)** whether the closed vocabulary should carry a **bounded,
  runtime-owned** observation payload — for example an allowlisted
  command subject already computed by `classifyCommand()` — so a record can
  say *which* operation was invoked rather than merely *that* one was; or
- **(b)** whether the PCK should be **retired** in favour of the existing
  verified-outcome ledger and task contract, which already carry this
  workload's working knowledge; or
- **(c)** whether the PCK should be **scoped to the workloads where its
  deterministic surface is non-empty**, and skipped otherwise.

Option (a) keeps the trust boundary exactly as it is: a runtime-owned
allowlisted subject is a constant from a closed set, rendered by the host,
which is the same property the current atom labels have. Option (b) is the
honest reading of this ACT's evidence. Option (c) is the conservative
reading.

**The ACT does not authorize any of them.** This ACT's scope excludes
production input-representation changes, output-budget changes, new
vocabulary and new storage. So this ACT recommends the QUESTION, and
leaves the answer to a successor ACT with the evidence attached.

## WHAT IS NOT CLAIMED

```text
INSTALLED-LIVE QUALIFICATION:  NOT EXECUTED. The VSIX has not been packaged,
                                installed or run live against these findings.
MATURE-CONTEXT UTILITY:         NOT ESTABLISHED, in either direction. This
                                ACT measured ONE real mature session against
                                ONE live endpoint. It does not establish
                                convergence behaviour, multi-session
                                behaviour, or the behaviour of any workload
                                whose commands carry the establishable
                                classifications.
OUTPUT-BUDGET VARIANCE:         MEASURED. Candidate C was repeated THREE
                                times at each of the two budgets and the
                                outcome was STABLE at each: 3/3 failures with
                                0 admitted records at 1024 tokens, and 3/3
                                successes with 5-6 admitted records at 4096
                                tokens. Candidate B, which carries more
                                supporting text, was VARIABLE: it succeeded
                                once and failed twice with
                                `finish_reason=length` at the 4096 budget. A
                                production budget must therefore be chosen
                                against the WORST observed candidate, not
                                against one successful run.
CACHE CONDITIONS:              NOT COMPARABLE ACROSS ALL RUNS. One candidate C
                                run obtained a 4 935-token cache hit (the
                                canonical reference list is a stable prefix);
                                other runs obtained none. The latency figures
                                therefore span both cached and uncached
                                conditions and are reported separately.
```

## THE CANDIDATE-RUN VARIANCE, RECORDED

| Candidate | Budget | Run | Latency | Prompt tok | Cached tok | Completion tok | Finish | Admitted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A | 1024 | 1 | 237 765 ms | — | — | — | error | 0 |
| A | 4096 | 1 | 291 368 ms | — | — | — | error | 0 |
| B | 1024 | 1 | 33 383 ms | — | — | — | error | 0 |
| B | 4096 | 1 | 34 363 ms | 6 376 | 0 | 1 060 | stop | 10 |
| B | 4096 | 2 | 94 316 ms | — | — | — | error | 0 |
| B | 4096 | 3 | 128 377 ms | — | — | — | error | 0 |
| C | 1024 | 1 | 29 301 ms | — | — | — | error | 0 |
| C | 1024 | 2 | 16 981 ms | — | — | — | error | 0 |
| C | 1024 | 3 | 17 227 ms | — | — | — | error | 0 |
| C | 1024 | 4 | 16 840 ms | — | — | — | error | 0 |
| C | 4096 | 1 | 33 889 ms | 4 942 | 0 | 1 368 | stop | 5 |
| C | 4096 | 2 | 91 629 ms | 4 942 | 4 935 | 2 288 | stop | 6 |
| C | 4096 | 3 | 37 169 ms | 4 942 | 4 935 | 2 288 | stop | 6 |
| C | 4096 | 4 | 22 434 ms | 4 942 | 4 935 | 1 368 | stop | 5 |
| C | 4096 | 5 | 37 179 ms | 4 942 | 4 935 | 2 288 | stop | 6 |
| D | — | 1 | 2 ms | 0 | 0 | 0 | n/a | 0 |

Every row: **1** physical request (D: **0**, by construction).

### THE REPEATABILITY READING

- **Candidate C at 1024 tokens: 4/4 FAILURES, 0 admitted records.** The
  production budget NEVER yields a usable checkpoint on this workload.
- **Candidate C at 4096 tokens: 5/5 SUCCESSES, 5-6 admitted records.** The
  outcome is STABLE, but the latency varies 22.4 s - 91.6 s and the
  completion-token count varies 1 368 - 2 288, which is why the admitted
  count alternates between 5 and 6.
- **Candidate B at 4096 tokens: 1 success, 2 failures.** B carries more
  supporting text, so the model's output runs longer and the 4096 budget
  becomes MARGINAL for it.

So the budget is not merely "too small": it must be sized against the
**worst** candidate, and candidate B shows that a budget sufficient for C
is NOT sufficient for B.
