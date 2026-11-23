# 07 — Semantic evaluation

**Evidence class:** `REAL` for the frozen reference set and the historical captures;
`REAL_MODEL_RESPONSE` for the scored records.

**The ACT's rule:** *Success cannot mean merely that the words `R4` or `startup.sh`
appear.* The scoring below is therefore per-record and per-witness, not a keyword
count.

---

## 7.1 The independent reference set

Built from the frozen canonical transcript and the frozen captures, independently of
the model's output.

| Witness | Required checkpoint content | The reference source |
|---|---|---|
| **R4** | Both startup operations; actual observed behavior **distinguished from** the configuration-drift hypothesis | the `cat startup.sh` tool result at canonical index 7; the assistant's discussion at `pre.json` msg[8]/msg[12] |
| **R6** | No deletion/purge located in inspected paths; **broader mechanism remains unresolved** | the empty `delete|purge|retention|cleanup|expired` grep result; the assistant's statement *"No delete/purge found in those paths."* |
| **R2** | Provider implementations identified; timeout/fallback investigation **remains incomplete** | the `MtsOmni`/`Megafon` tool result and the planned-inspection reasoning at `pre.json` msg[18]; the partial implementation state at `second-pre.json` msg[41] |

---

## 7.2 Per-record scoring

**Scoring scale:** `SUPPORTED` / `SUPPORTED_WITH_QUALIFICATION` / `UNSUPPORTED` /
`CONTRADICTED` / `NOT_OBSERVABLE`.

### Boundary 1 — 13 records published, 12 after the ceiling, 10 accepted

| # | Record | Score | Basis |
|---|---|---|---|
| 1 | `obs-001` repository identity | `SUPPORTED` | The command invocation is in the canonical history. (**REJECTED** by the credential gate on the absolute path — a false positive, corrected in §4.6 of doc 04) |
| 2 | `obs-002` bounded searches attempted | `SUPPORTED_WITH_QUALIFICATION` | Correctly qualifies: *"These records establish which bounded searches were attempted, not what repository facts they found."* |
| 3 | `obs-003` Helm render batches | `SUPPORTED_WITH_QUALIFICATION` | Correctly qualifies that the filtered output is not retained and that the renders cannot confirm or disprove R1/R9/R10 |
| 4 | `obs-004` frozen R1–R10 ratings | `SUPPORTED_WITH_QUALIFICATION` | *"These are frozen claims and original ratings, not adjudicated or runtime-verified findings."* — correctly labelled `model_reported` |
| 5 | `obs-005` no terminal completion | `SUPPORTED` | The canonical transcript has no `submit_and_exit` |
| 6 | `open-001` identity unverified | `SUPPORTED` | Correctly `unresolved` / `unverified` (**REJECTED** by the credential gate — false positive) |
| 7 | `open-002` verdicts not assignable | `SUPPORTED` | *"None of CONFIRMED, NARROWED, CONDITIONAL, DISPROVEN, or UNKNOWN can be assigned"* |
| 8 | `open-003` upstream semantics not consulted | `SUPPORTED` | Bounded to the visible tool-call list |
| 9 | `constraint-001` read-only mission | `SUPPORTED` | From the user task message |
| 10 | `constraint-002` bounded verification, no credential output | `SUPPORTED` | From the user task message |
| 11 | `constraint-003` deliverable contract | `SUPPORTED_WITH_QUALIFICATION` | (**REJECTED** by `UNRESOLVED_INVESTIGATION_PROMOTED` — conservative gate behaviour) |
| 12 | **`constraint-004`** boundedness of absence | `SUPPORTED` | *"absence from inspected paths does not prove absence of an external mechanism"* — the R6 discipline, as a standing constraint |
| 13 | `constraint-005` retracted R5 claim | `SUPPORTED` | Matches the user task message |

### Boundary 2 — 20 records published, 12 after the ceiling, 12 accepted

| # | Record | Score | Basis |
|---|---|---|---|
| 1 | `session-completion-001` | `SUPPORTED` | No terminal completion in the canonical transcript |
| 2 | `repository-path-002` | `SUPPORTED` | The path is a Git work tree |
| 3 | `repository-identity-003` | `SUPPORTED` | *"The expected identity is a user-supplied requirement, not an observed repository fact."* — the allegation/evidence separation, explicit |
| 4 | `working-tree-004` | `SUPPORTED` | Correctly `unresolved` |
| 5 | `verification-scope-005` | `SUPPORTED_WITH_QUALIFICATION` | Correctly states the omitted output bodies |
| 6 | `repository-side-effects-006` | `SUPPORTED_WITH_QUALIFICATION` | Bounded to the visible transcript |
| 7 | `upstream-semantics-007` | `SUPPORTED` | Correctly `unresolved`; *"Mixed tool status does not support a positive or negative claim"* |
| 8 | `mission-constraints-008` | `SUPPORTED` | From the user task message |
| 9 | `reporting-contract-009` | `SUPPORTED` | From the user task message |
| 10 | `r1-010` | `SUPPORTED` | Correctly `unresolved` / `unverified` |
| 11 | **`r2-011`** | `SUPPORTED_WITH_QUALIFICATION` | *"A class name alone is not evidence that the breaker is wired into the production sender path or prevents worker exhaustion."* |
| 12 | `r3-012` | `SUPPORTED` | Correctly `unresolved` |
| 13 | **`r4-013`** | `SUPPORTED_WITH_QUALIFICATION` | *"An intentional startup build can be operationally valid; the decisive issue is whether it produces inconsistent or unsafe effective configuration under the image's persisted build state."* — **DROPPED by the 12-record ceiling** |
| 14 | `r5-014` | `SUPPORTED` | Correctly `unresolved` — dropped by the ceiling |
| 15 | **`r6-015`** | `SUPPORTED_WITH_QUALIFICATION` | *"Repository absence searches are bounded and do not prove that no database job, external scheduler, or operational purge process exists."* — **DROPPED by the 12-record ceiling** |
| 16–19 | `r7-016` .. `r10-019` | `SUPPORTED` | Correctly `unresolved` — dropped by the ceiling |
| 20 | `final-deliverables-020` | `SUPPORTED` | dropped by the ceiling |

**No record is `UNSUPPORTED`. No record is `CONTRADICTED`.** Two records are
`NOT_OBSERVABLE` in the sense that their subject's exact content was never in the
model's input: the exact R4 command pair and the exact R6 bounded negative.

---

## 7.3 Per-witness evaluation against the reference set

### R4 — Both startup operations; observed behavior distinguished from the drift hypothesis

| Required | Present? | Detail |
|---|---|---|
| Both startup operations | **PARTIAL** | The published record names `startup.sh` and `kc.sh build` (visible in the assistant's public text). The second operation, `start --optimized`, is **absent** — it was never in the model's input. |
| Observed behavior distinguished from the drift hypothesis | **YES** | `r4-013` is `unresolved`/`unverified` and explicitly keeps the drift question open without certifying it. The `UNPROVEN_CAUSALITY_OVERCLAIM` gate independently enforces this. |

### R6 — No deletion/purge located in inspected paths; broader mechanism unresolved

| Required | Present? | Detail |
|---|---|---|
| The bounded negative | **PARTIAL** | The published record names the retention/purge searches; the exact bounded observation is absent — it lived in a thinking block. |
| The broader mechanism remains unresolved | **YES** | `r6-015` is `unresolved` and states that absence searches do not prove an external purge does not exist. `constraint-004` states the same rule generally. |

### R2 — Provider implementations identified; timeout/fallback investigation incomplete

| Required | Present? | Detail |
|---|---|---|
| Provider implementations identified | **PARTIAL** | The published record names the carrier senders and the circuit-breaker class; the exact identifier `MtsOmni` is absent — never in the model's input. |
| The investigation remains incomplete | **YES** | `r2-011` is `unresolved` and says a class name alone is not evidence the breaker is wired into the production path. |

**Overall semantic verdict: `SUPPORTED_WITH_QUALIFICATION` for all three witnesses.**
The *epistemic posture* is preserved faithfully. The *exact operational detail* is
preserved only where it was visible to the checkpoint model — which, for the three
selected witnesses, it was not.

---

## 7.4 The measured metrics (G6)

| Metric | Boundary 1 | Boundary 2 |
|---|---|---|
| `valid_checkpoint_records` | 12 | 12 |
| `supported_records` | **12** | **12** |
| `supported_with_qualification` | 6 | 8 |
| `unsupported` | **0** | **0** |
| `contradicted` | **0** | **0** |
| `essential_qualifications_preserved` | **6/6** | **8/8** (within the ceiling) |
| `unsupported_promotions` | **0** | **0** |
| `missing_critical_observations` | **3** (R4 exact pair, R6 exact negative, R2 exact identifier) | **3** (same) |
| `extra_tokens` | 1 010 est. | 1 117 est. |
| `extra_model_calls` | **1** | **1** |
| `checkpoint_latency` | 66 496 ms | 80 654 ms |
| `summarizer_omissions` | 3 (the summarizer never saw the detail either) | 3 |
| `provider_visible_retention` | subject-level | subject-level |

### The three missing critical observations all have ONE cause

All three are missing because the production source-selection contract
(`renderStructuredToolPayload` + `dropThinkingBlocks`) removes them **before** the
checkpoint model sees the history. **None is a knowledge-extraction failure**: the
model extracted everything it could see, and it explicitly reported that it could not
see the rest.

---

## 7.5 The three measured outcome boundaries (G6.1)

### Structural retention — **ACHIEVED**

Accepted records reach the provider-visible continuation, attached to the existing
`compaction_summary` message, independently of the summarizer prose. Proven by case C
(oracle) and case B (model) in `05-deterministic-projection.md`.

### Semantic fidelity — **ACHIEVED for what was visible; NOT ACHIEVED for the exact detail**

The published records accurately preserve the observations and uncertainty the model
could legitimately see, and promote nothing. The exact operational detail of the three
selected witnesses is not preserved, because it was never in the checkpoint model's
input.

### Behavioral improvement — `NOT_EXECUTED`

No separately controlled continuation was run. Whether a continuing agent avoids
reinvestigation on the strength of a preserved checkpoint is **not** claimed.

---

## 7.6 The classification summary (G8)

| Claim | Evidence class |
|---|---|
| The exact witness tokens are in the canonical history at both boundaries | `REAL` |
| The exact witness tokens are absent from both post-compaction provider-visible contexts | `REAL` |
| The exact witness tokens are absent from the controlled checkpoint input | `REAL` |
| The production serializer renders the structured payload as `[result omitted]` | `REAL` |
| The oracle checkpoint survives the real projection seam | `SYNTHETIC_REAL` |
| The model checkpoint is published, parsed, bound and projected | `REAL_MODEL_RESPONSE` |
| The model published no unsupported promotion | `REAL_MODEL_RESPONSE` |
| The 12-record ceiling dropped the model's qualified R4 and R6 records at boundary 2 | `REAL_MODEL_RESPONSE` |
| A continuing agent behaves differently with the checkpoint | `NOT_EXECUTED` |
| A deployed checkpoint would help in production | `NOT_EXECUTED` |
