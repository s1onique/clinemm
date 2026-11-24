# ACT-CLINEMM-PCK-EVIDENCE-FIRST-INPUT-RECON-01 — C2/C4 comparative candidates and the executable comparison

## THE FOUR CANDIDATES

All four were evaluated against the **SAME** canonical history
(`1795489471969_tachv`, SHA-256 `3d398ad2…db9b27`), the **SAME** model and
endpoint, the **SAME** inference policy, and the **SAME** publication gate.

| Candidate | Representation | Input chars | Est. tokens | Reduction vs A |
| --- | --- | --- | --- | --- |
| **A** | the EXISTING full-history input (production builders, unchanged) | 296 103 | 98 701 | — |
| **B** | EVIDENCE-FIRST: runtime-classified observations + bounded supporting excerpts of every evidence-bearing message | 9 524 | 3 175 | **96.8 %** |
| **C** | EVIDENCE-ONLY: the runtime's own observation ledger alone | 5 263 | 1 755 | **98.2 %** |
| **D** | DETERMINISTIC EXTRACTION: no inference at all | 53 | 18 | 99.98 % |

Candidate D is the discriminator the ACT asked for: can the runtime produce
useful closed-vocabulary records **without** spending an inference request?

## WHAT IS FIXED ACROSS THE CANDIDATES

Model `qwen3.8-flash-next-q2_0`, provider `openai-compatible`, endpoint
`http://192.168.50.239:8080//v1`; reasoning `none`; temperature `0.1`;
JSON mode `response_format: json_object`; the **no-automatic-retry**
physical-request policy (`maxRetries: 0`, `streamRetries: 0`,
`emptyResponseAttempts: 1`); the EXISTING production parser and the
EXISTING production publication gate with the EXISTING production evidence
interpreter.

The physical request count was **MEASURED** by wrapping the transport's
`fetch`, not assumed.

## C4 — THE MEASUREMENTS

### At the PRODUCTION output budget (1024 tokens)

| Candidate | Input chars | Est. tok | Total latency | Finish reason | Parser | Admitted | Physical reqs |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **A** | 296 103 | 98 701 | **237 765 ms** | `error` | `no_response` | **0** | 1 |
| **B** | 9 524 | 3 175 | **33 383 ms** | `error` | `no_response` | **0** | 1 |
| **C** | 5 263 | 1 755 | **29 301 ms** | `error` | `no_response` | **0** | 1 |
| **D** | 53 | 18 | **2 ms** | `deterministic_no_inference` | n/a | **0** | **0** |

The provider's reported error, verbatim, for A, B and C:

```text
structured output was incomplete (finish_reason=length); increase the output budget
```

**At the production budget, EVERY inference candidate produces NOTHING.**
Candidate A — the production baseline — burns **237.8 s** and admits
**zero** records. The PCK's own deadline is 180 s, so candidate A would be
KILLED BY THE DEADLINE before it could even return.

### At a 4096-token output budget (the discriminating control)

| Candidate | Actual prompt tok | Cached prompt tok | Completion tok | Total latency | Finish | Admitted | Physical reqs |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **A** | (not reported — the response never completed) | — | — | **291 368 ms** | `error` | **0** | 1 |
| **B** | 6 376 | 0 | 1 060 | 34 363 ms | `stop` | **10** | 1 |
| **C** | 4 942 | 0 | 1 368 | 33 889 ms | `stop` | **5** | 1 |
| **D** | 0 | 0 | 0 | **2 ms** | n/a | **0** | 0 |

**The failure was the OUTPUT BUDGET, not the input.** Raising the budget
from 1024 to 4096 turns B and C from zero-record failures into successful
requests — at 3–4× the input reduction and a ~9× latency reduction.

Candidate A still fails at 4096 tokens: the model tries to emit a record for
every one of the 56 observations, exhausts a 4096-token budget, and the
request takes **291.4 s**.

### MEASURED VERSUS ESTIMATED

| Candidate | Est. input tokens | ACTUAL provider prompt tokens | Ratio |
| --- | --- | --- | --- |
| B | 3 175 | 6 376 | 2.01× |
| C | 1 755 | 4 942 | 2.81× |

The runtime's `estimateTokens()` (3 chars/token) **UNDER-estimates** the real
prompt tokens by 2.0–2.8× on this workload, because the estimate counts
only the rendered input text while the provider also tokenizes the
instruction envelope, the system prompt and the 170-entry canonical
reference list. The reference list alone is ~3 900 characters.

The estimate is therefore a **conservative under-estimate** for the reduced
candidates: candidate C's ACTUAL 4 942 prompt tokens still lands well under
the 8 000-token target.

### CACHE CONDITIONS

`cacheReadTokens` was **0** on every candidate, in both budget runs. The
reference list is the request's PREFIX, so the prefix is cacheable in
principle — but the measurement shows no cache hit was obtained. The
candidates are therefore compared under **COMPARABLE cache conditions**
(none cached), which makes the comparison sound.

## C4 — THE UTILITY OF WHAT WAS ADMITTED

This is the decisive section. The admitted records for candidate B (10) and
candidate C (5) are reproduced here in full. Every byte is a RUNTIME-OWNED
constant, so they are safe to commit.

**Candidate C — 5 admitted records:**

| assurance | kind | status | statement |
| --- | --- | --- | --- |
| `model_reported` | observation | active | operation invoked: none |
| `model_reported` | observation | active | implementation inspected: none |
| `model_reported` | observation | active | operation invoked: none |
| `model_reported` | observation | active | operation invoked: none |
| `unverified` | open_question | unresolved | question remains open: none |

**Candidate B — 10 admitted records:**

| assurance | kind | status | statement |
| --- | --- | --- | --- |
| `model_reported` | observation | active | operation invoked: none |
| `model_reported` | observation | active | implementation inspected: none |
| `model_reported` | observation | active | operation invoked: none |
| `model_reported` | observation | active | operation invoked: none |
| `model_reported` | observation | active | operation invoked: none |
| `model_reported` | constraint | active | operation invoked: none |
| `unverified` | open_question | unresolved | question remains open: none |
| `unverified` | open_question | unresolved | bounded search returned no match: none |
| `unverified` | open_question | unresolved | question remains open: none |
| `model_reported` | decision | active | operation invoked: none |

### THE FINDING

**Every admitted statement is generic.** `operation invoked: none` is
rendered identically for every session in which the model selects that
atom. `implementation inspected: none` likewise. There is **not one
distinguishing token** in any admitted statement.

This is not a candidate-quality problem. It is a **VOCABULARY** limitation,
and it is structural:

- The closed vocabulary has six atoms and six arguments.
- The `statement` is RENDERED by the host from the atom label and the
  argument label. There is no free-text field.
- The `argument` vocabulary is `build`, `start`, `start_optimized`,
  `connect_timeout_3s`, `socket_timeout_10s`, `none`.
- The only argument with a non-empty deterministic classification set is
  `build` (via `make build`).

So a session that never runs `make build` can only ever publish
`operation invoked: none` — a statement that says **nothing** about what
happened.

### WHY THE MODEL SELECTED `none`

The runtime's observation ledger tells the model, for each of the 56
events, its tool, class, status and subject. The subjects are the runtime's
own allowlisted command classifications: `sed` for 5 events and `(none)`
for the other 51. **No event carries the `build` classification.** The
model therefore has exactly one argument the runtime can ever support, and
it does not apply, so it selects `none` — which the runtime then correctly
DOWNGRADES to `model_reported` / `unverified`, because the `none` argument
has an EMPTY deterministic classification set.

**The trust boundary behaved exactly as designed.** The model asked for an
operation; the runtime refused to assert it and published the claim at the
truthful ceiling. The gate did its job. The problem is that what survives
the gate is not worth publishing.

## C2-D — THE DETERMINISTIC EXTRACTION DISCRIMINATOR

Candidate D produced **ZERO** records on the real mature workload, and the
reason is exact:

| Tool | Command classifications | Count |
| --- | --- | --- |
| `run_commands` | `(none)` | 43 |
| `run_commands` | `sed` | 5 |
| `fetch_web_content` | `(none)` | 5 |
| `read_files` | `(none)` | 3 |

**Zero** of the 56 joined canonical tool events carries the `make build`
classification — the only classification that establishes the only
establishable argument. The deterministic extraction therefore has an
**EMPTY** establishable surface on this workload.

Candidate D costs **2 ms** and **0 physical requests**, and produces
**nothing**. It is the fastest possible answer and it is the wrong answer.

## ADDENDUM — THE REPEATABILITY STUDY

Candidate C was repeated on the SAME history, against the SAME endpoint,
with the SAME policies, at both budgets.

| Budget | Runs | Outcome | Admitted records | Latency range |
| --- | --- | --- | --- | --- |
| **1024** (production) | **4** | **4/4 `finish_reason=length`** | **0 every time** | 16.8 s - 29.3 s |
| **4096** | **5** | **5/5 `stop`** | **5 or 6** | 22.4 s - 91.6 s |

```text
CANDIDATE_C_AT_PRODUCTION_BUDGET=4/4 FAILURES, 0 ADMITTED RECORDS
CANDIDATE_C_AT_4096_BUDGET=5/5 SUCCESSES, 5-6 ADMITTED RECORDS
```

So the production output budget **never** yields a usable checkpoint on this
workload, and the failure is not a fluke.

Candidate B, by contrast, was **variable** at 4096 tokens: 1 success, 2
failures. B carries more supporting text, so the model's output runs longer
and the same budget becomes marginal for it. **A production budget must be
sized against the worst candidate, not against one successful run.**

### THE CACHE CONDITION, OBSERVED

The canonical reference list is the request's stable PREFIX, so it is
cacheable. The measurement bears this out: once the prefix was warm,
candidate C reported `cacheReadTokens: 4 935` of its 4 942 prompt tokens —
a **99.9 %** cache hit. The first run of a cold prefix reported 0.

So the uncached candidate C run took 33.9 s and the cached ones took
22.4 s - 37.2 s, with one outlier at 91.6 s. The latency figures therefore
span both conditions and are reported separately rather than averaged.
