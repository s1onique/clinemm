# ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION01

**Type:** bounded correction of `ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-01`
**Subject:** the forensic capture's wire seam, the analyzer's evidence semantics, and the
evidence packaging of the original ACT.
**Preserved:** commits `616c9db8a` (the original implementation) and `19b610083`
(the original closure receipt). Neither is rewritten.

---

## 0. Why this ACT exists

The correction review of `ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-01` returned
`HALT_CAUSAL_ATTRIBUTION_UNPROVEN` with two P0s, three P1s and two P2s.

The review's central judgement was **correct and is adopted**: the structural discovery
is valuable and is preserved; the claim that it explains the P40/5060's recurring
3,895-token plateau is **not established** and is withdrawn.

What this ACT corrects is the part that IS a defect in the delivered artifact: the
forensic capture's wire seam could not run under its own opt-in, the analyzer's
evidence semantics could over-claim, and the committed evidence carried an
unassessed raw excerpt and a permanently unverifiable self-referential hash.

---

## 1. The scope

| # | Step | Outcome |
|---|---|---|
| 1 | Wire-capture RED | Forensic-only activation is shown to miss the real HTTP boundary |
| 2 | Wire-capture GREEN | Forensic-only opt-in reaches the wrapper; default-off preserved |
| 3 | Completeness RED/GREEN | An invalid wire body never produces `complete: true` |
| 4 | Analyzer correction | Missing stages cannot imply equality; all change categories are attributed; exact lineage is required |
| 5 | Evidence correction | Observed MiniMax mutations are separated from unproven Qwen/Strata attribution |
| 6 | Packaging | Sensitive excerpts redacted; artifact hashes corrected |
| 7 | Conservation | Focused tests, typechecks, no provider semantic delta, no new inference run |

**Out of scope, deliberately.** No repair of the stale-read policy. No provider request.
No inference-service restart. No installed-extension replacement. No push. The
"which of the two documented priorities gives way" decision remains a product policy
decision, exactly as the original ACT held.

---

## 2. P0 #1 — the wire forensic capture could never run on its own

### 2.1 The defect

`recordPrefixForensics({stage: "wire_request"})` sat inside the provider-request
capture callback, behind two guards:

1. `wrapFetchForProviderRequestCapture()` returned the **unwrapped** fetch when
   neither the full wire capture nor the wire-reasoning observer was active. The
   forensic capture was not part of that decision.
2. Inside the wrapper, the callback returned **early** when the ordinary wire capture
   was disabled. The forensic capture was not part of that decision either.

Setting only `CLINEMM_PREFIX_FORENSICS=1` therefore did **not** cause the wire
forensic capture to execute. The ACT's independent opt-in contract was violated.

The original ACT's eight capture-writer witnesses called `recordPrefixForensics()`
**directly**, so they never exercised the real HTTP boundary and could not detect this.

### 2.2 The correction

The forensic switch is now a **third, independent reason** to wrap the gateway and to
read the request body — consulted at wrap time and at call time, so an ON/OFF toggle
takes effect for the next request, like the existing observer.

The **default-off path is byte-identical**: with nothing armed and no observer
registered, the base fetch is returned unchanged, the body is never read or cloned,
and the delegate's own promise is returned by reference. Witness `PF-WIRE-02`.

The forensic capture is also **independent of the ordinary capture's surface**: arming
it does not enable the full provider-request capture. Witness `PF-WIRE-04`.

---

## 3. P0 #2 — an invalid wire body was recorded as a complete request

`computeRepresentationFingerprint()` returned `complete: true` unconditionally,
including when its `messages` input was absent or not an array. An unparseable wire
body was therefore recorded as a **complete, zero-message representation** — a
fabricated structural claim that an analyzer could then compare as "equal" against any
other empty request.

### The correction

The completeness contract now distinguishes **absent** from **empty**:

- a message list that is absent or not an array → `complete: false`, with an
  `incompleteReason`;
- an empty but **present** array (`[]`) → `complete: true` (a genuinely empty request
  is a real observation).

The analyzer additionally refuses to compare an incomplete representation; it reports
the stage as unavailable rather than comparing it as an empty request.

---

## 4. P1 — the analyzer's evidence semantics

Three bounded defects in the analyzer's semantics, corrected together.

### 4.1 An unavailable stage could imply equality

The verdict was `stages.every((s) => !s.available || s.differences.length === 0)`, so
an **unavailable** stage counted as "equal". A comparison with only one of the three
representation boundaries present produced a **positive equality result** — a claim
the evidence did not support.

Equality now requires **every** stage to be available **and** undiffering. The
`unavailableStages` list makes the fail-closed state explicit.

### 4.2 The stage attribution read only the message list

`earliestDifferingStage` was derived from `stage.differences.length > 0` — the
**message** list alone. A tool-only, a system-only or a body-only change was invisible
to the attribution.

Each stage comparison now carries `differs` and `differingCategories`
(`messages` / `tools` / `system` / `body`), and the attribution reads `differs`.

### 4.3 The CLI paired captures without establishing consecutive lineage

The CLI pairs captures by session + source + file ordering and then reported the
analyzer's `authoritative` flag verbatim. The analyzer's authority rule accepts a
shared **session**, so a same-session chronology was labelled authoritative without
establishing that the two captures are consecutive requests of the same preparation
lineage.

The CLI now applies an explicit **exact-lineage gate**
(`establishConsecutiveRequestLineage`, exported from the shared analyzer so that every
caller applies the same rule and it is unit-testable):

- the same preparation identity with a strictly increasing **iteration**, or
- the same preparation identity with a **distinct attempt** ordinal (a transport retry);

everything else is reported `NOT_AUTHORITATIVE` with an explicit reason.

### 4.4 The V5 witness was per-stage, not end-to-end

The original V5 witness exercised **separate** per-stage comparisons, so it could not
demonstrate an end-to-end stage transition. `V5-CORR` supplies all three stages of the
same request pair and shows the attribution read across the whole pair.

---

## 5. P0 evidence gap — the causal attribution is separated

The review's second P0 is **an evidence gap, not a code defect**, and it is the most
important correction in this ACT.

The report's three detailed mutations come from a preserved `course` session using
**provider `minimax`, model `MiniMax-M3`**. The engine investigation concerns
**Qwen3.8-Flash-Next on Strata** (P40 Q2_0 and RTX 5060 Ti). The original ACT
acknowledged these are not established to be the same serving path — and then treated
the MiniMax rewrite as the cause of the Strata plateau anyway.

Separately, a **one-time rewrite explains the A → B cache miss but not the
persistence of the plateau**: whether C and every later request continue to miss
depends on checkpoint retention and placement, which the traces suggest is not
uniform (they contain occasional deep-cache recoveries followed by fresh collapses).

### What is retained

`PREFIX_MUTATION_ISOLATED` — the mechanism, its producing seam, its host-independence
(21 occurrences across 6 hosts), and D1's refutation. All direct observations.

### What is withdrawn

The claim that the rewrite is the cause of the specific Strata 3,895-token plateau.
`STRATA_PLATEAU_CAUSE_UNPROVEN` **remains OPEN**.

The full reasoning is in `11-causal-attribution-separation.md`.

---

## 6. Packaging

| Item | Correction |
|---|---|
| The raw excerpt in `02-sanitized-request-difference-matrix.md` §2.1 | **REDACTED** — the verbatim file content and the live `toolCallId` (now a truncated digest). The structural facts are unchanged. |
| The absolute paths in `08-entry-and-identity-evidence.md` and `06-test-receipts.txt` | **REDACTED** — the operator's home directory does not belong in committed evidence. |
| The privacy audit's scope | **EXTENDED** — it now scans every committed evidence file, not only the 173 sanitized capture records. A clean scan of the derivative did not establish that the committed files were sanitized; they were not, and now they are. |
| The artifact hash manifest | **CORRECTED** — it listed its own SHA-256, which is permanently unverifiable (declared `18a43892…`, actual `4b6496c9…`). The corrected manifest omits itself and documents the external-digest procedure. All 23 entries verify with zero mismatches. |

The invalid Leamas gate-summary binding is historical P2 residue and does not block
this correction.

---

## 7. Conservation

| Gate | Result |
|---|---|
| Wire-seam suite (new, 5 tests) | **PASS** — and **3 FAIL** against the pre-correction implementation |
| Analyzer suite (20 tests) | **PASS** — and **10 FAIL** against the pre-correction implementation |
| shared package sweep | **593 passed / 6 skipped**, 0 failed |
| llms package sweep | 19 failed / **1167 passed** — the 19 failures are **identical at pristine HEAD**; the delta is **+5 new passing** |
| agents package sweep | 43 failed / 560 passed — **identical at pristine HEAD** |
| Typecheck (shared, llms) | **EXIT 0** |
| Biome lint | **EXIT 0** (2 infos, the same `noNonNullAssertion` convention as the pre-existing sibling suite) |
| Artifact hashes | **23 verified / 0 mismatches / 0 self-referential entries** |
| Provider semantic delta | **NONE** |
| New provider requests / inference runs | **NONE** |

---

## 8. The next experiment

The review's final point is adopted unchanged and is recorded here so a successor does
not have to re-derive it.

We already have enough evidence to **stop investigating whether ClineMM ever rewrites
old messages**. It does, intentionally.

The next useful experiment is narrower: **correlate one such rewrite with the next two
or three Strata cache decisions**, and distinguish

1. the cost of the initial prefix invalidation,
2. how quickly the new prefix becomes cacheable,
3. whether checkpoint retention prevents recovery.

That experiment will decide whether to change ClineMM's stale-read policy, improve
Strata's checkpoint placement, or do both.

The corrected wire seam makes this experiment possible for the first time: stage C now
actually captures the serialized body under its own opt-in, and the analyzer no longer
over-claims equality.
