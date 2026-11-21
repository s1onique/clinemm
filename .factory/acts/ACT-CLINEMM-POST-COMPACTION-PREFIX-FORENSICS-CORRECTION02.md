# ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION02

**Type:** bounded correction of the request-lineage and three-stage aggregation contract of
`ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION01`.
**Scope:** exactly the P0 named by the CORRECTION01 review. No other review, no change to
the stale-read policy, no new inference run.

---

## 0. The verdict this correction adopts

`HALT_CROSS_REQUEST_LINEAGE_CONTRACT` for live forensic qualification.

The review's central claim is **CONFIRMED by execution** and is corrected here.

---

## 1. The defect — the CORRECTION01 lineage rule was INVERTED

`establishConsecutiveRequestLineage()` required

```
before.preparationRequestId === after.preparationRequestId
```

But `preparationRequestId` is minted **ONCE PER PREPARED REQUEST**, not once per
conversation. The runtime's own documentation is the authority
(`sdk/packages/agents/src/agent-runtime.ts:930-949`):

| Identity | Minted | Lifetime |
|---|---|---|
| `preparationRequestId` (`req_…`) | once per PREPARED REQUEST (`createUID("req")`, `:2801`) | **UNCHANGED across provider retries** |
| `providerAttemptId` / `modelRequestId` (`model_request_…`) | per PROVIDER ATTEMPT (`:3011`) | **RE-MINTED on every retry** |
| `iteration` | per MODEL TURN | advances once per turn |

So two **successive model turns** carry DIFFERENT preparation identities, and a
**retry** KEEPS the same preparation identity while re-minting the attempt id.

The CORRECTION01 gate had these two cases exactly backwards:

| Case | CORRECTION01 verdict | Correct verdict |
|---|---|---|
| Two successive turns (different preparation, adjacent iteration) | **REJECTED** | **CONSECUTIVE** |
| A retry (same preparation, different attempt) | **ACCEPTED** | **NOT a turn** |

The gate therefore rejected exactly the B->C and C->D comparisons the next
experiment needs, and accepted the one case that must never be confused with a turn.

Two compounding defects:

- the wire stage recorded **no preparation identity at all** (only
  `providerAttemptId` from `modelRequestId`), so it could not be grouped with the
  other stages of the same request; and
- the CLI sorted every capture together and examined **adjacent entries**, so the
  three stages of one request could interleave with another request's stages, and
  it compared **ONE record per side** — it could never express a comparison of two
  complete requests across all three stages.

---

## 2. The correction

### 2.1 The identity model

`establishRequestLineage()` replaces the inverted rule and distinguishes the three
identities the review named:

| Relation | Condition | Consecutive? |
|---|---|---|
| **within-request** | same session + same iteration + same preparation; differs only by `source` | no — AGGREGATED |
| **retry** | same session + same iteration + same preparation + DIFFERENT attempt | no — a retry is never a turn |
| **consecutive turn** | same session + **EXACTLY adjacent** iterations + DISTINCT preparation and attempt | **YES** |

Every required identity is mandatory: when the session id, the iteration, the
preparation identity or the attempt identity is absent, the pair is
`NOT_AUTHORITATIVE` with an explicit reason. **A timestamp is never substituted.**

### 2.2 The request bundle

`groupCapturesIntoRequestBundles()` groups records by the within-request identity
(cohort, session, iteration, preparation, attempt). The **stage is the key inside
the bundle**, never part of the grouping key — that is what keeps the A/B/C stages
of one request together even when their file order interleaves them.

`comparePrefixForensicsBundles()` compares two bundles stage-by-stage, so a single
comparison now covers all three representation boundaries at once — the end-to-end
stage transition the CORRECTION01 `V5-CORR` witness only approximated by calling the
analyzer three times.

### 2.3 The production side — the preparation identity at the wire seam

Stage B (`ai-sdk.ts`) and stage C (`provider-request-capture.ts`) now carry
`preparationRequestId`, read from the request metadata under the established
`MODEL_BEHAVIOR_WIRE_REASONING_REQUEST_ID_METADATA_KEY` — the id the runtime already
mints once per prepared request and already carries in that bag. No new metadata
key, no new transport field, no new protocol field.

---

## 3. The reopen condition

> *One RED->GREEN witness through the real CLI, with two complete three-stage
> requests followed by a third append-only continuation, must prove that the CLI can
> produce authoritative B->C and C->D comparisons. Include missing-stage, retry,
> nonconsecutive-iteration and cross-session negative controls.*

`sdk/packages/shared/src/runtime/prefix-forensics-analyzer-cli.test.ts` drives the
CLI as a **real process** over a **real directory** of capture records.

| Witness | Control | Result |
|---|---|---|
| CLI-01 | two complete three-stage requests -> authoritative B->C | **PASS** |
| CLI-02 | a third append-only continuation -> authoritative C->D | **PASS** |
| CLI-03 | a RETRY (same preparation, different attempt) | **REFUSED** |
| CLI-04 | a NON-ADJACENT iteration gap (29 -> 31) | **REFUSED** |
| CLI-05 | a CROSS-SESSION pair | **REFUSED** |
| CLI-06 | a bundle with a MISSING stage | reported incomplete, never as equal |

**RED:** against the CORRECTION01 implementation, CLI-01, CLI-02 and CLI-06 **FAIL**
(the CLI produced **0 pairs** for two complete three-stage requests). The three
negative controls passed only VACUOUSLY there — no pairs were produced at all — and
now genuinely exercise the refusal paths.

`PF-WIRE-06` proves the production half: the wire stage carries the preparation
identity, the attempt identity and the iteration.

---

## 4. Conservation

| Gate | Result |
|---|---|
| CLI suite (new, 6 tests) | **PASS** — and **3 FAIL** against the CORRECTION01 implementation |
| Analyzer suite (20 tests) | **PASS** |
| shared package sweep | **599 passed / 6 skipped**, 0 failed (was 593: **+6**) |
| llms package sweep | 19 failed / **1168 passed** — the 19 failures are **identical at pristine HEAD** (was 1167: **+1**) |
| agents package sweep | 43 failed / 560 passed — **identical at pristine HEAD** |
| Typecheck (shared, llms, agents) | **EXIT 0** |
| Biome lint | **EXIT 0** (5 infos; the same `noNonNullAssertion` convention as the pre-existing sibling suites) |
| Provider semantic delta | **NONE** — no provider request, no retry/compaction behaviour change, no prompt change |
| New inference run | **NONE** |

`CORR-07` in the analyzer suite was **rewritten**, not deleted: its three cases
(successive turn / iteration gap / retry / same-request stages) are now asserted
against the runtime-accurate model. The CORRECTION01 version had asserted the
inverted semantics.

---

## 5. What is NOT changed

- The wire-capture and completeness repairs of CORRECTION01 are **retained** as
  delivered.
- The causal separation is **retained**: `PREFIX_MUTATION_ISOLATED` stays closed;
  `STRATA_PLATEAU_CAUSE_UNPROVEN` stays **OPEN**.
- The stale-read policy is **not** touched. The repair question remains a product
  policy decision.
- No push, no VSIX replacement, no inference-service restart, no provider request.

---

## 6. What the next step now is

The instrumentation is fit for live forensic qualification. The review's disposition
is adopted: once the live capture is authorized, the successor experiment is the
one already recorded — correlate ONE rewrite with the next two or three Strata
cache decisions, distinguishing the cost of the initial prefix invalidation, how
quickly the new prefix becomes cacheable, and whether checkpoint retention
prevents recovery.

Strata's own documentation distinguishes checkpoint PLACEMENT from exact-prefix
MATCHING: `--prompt-cache-spread` changes which checkpoints SURVIVE rather than
restoring compatibility between different token sequences. That is why the
three-request comparison — rewrite, next request, next continuation — is decisive,
and why the corrected CLI must be able to produce exactly that comparison.
