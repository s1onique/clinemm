# 09 — Build and live qualification

**ACT:** `ACT-CLINEMM-ADJUDICATION-CONTINUITY-REPAIR-01**
**Status:** **NOT EXECUTED — not applicable.** G9 is conditional on "Only after
a safe GREEN". There is **no safe GREEN**: the G2 trust gate halted and **no
production change exists**.

---

## 1. Why no build was produced

The ACT's G9 states:

> "Only after a safe GREEN.
> Discover:
> ```
> SUBJECT_HEAD
> SOURCE_VERSION
> BUILD_HEAD
> VSIX_PATH
> VSIX_BYTES
> VSIX_SHA256
> INSTALLED_VERSION
> INSTALLED_BUNDLE_SHA256
> ```"

and G11:

> "`PASS_STRUCTURAL_ONLY` — The repaired production seam is GREEN and the
> trust/conservation gates pass, but live installed qualification is not
> executed."

`PASS_STRUCTURAL_ONLY` also does **not** apply here, because it requires "the
repaired production seam is GREEN" — and **no repair was made and the RED is
still RED**. Reporting `PASS_STRUCTURAL_ONLY` would misreport the state.

**The correct verdict is `HALT_TRUST_BOUNDARY_UNRESOLVED`.**

Accordingly:

| Property | Value | Label |
|---|---|---|
| `SUBJECT_HEAD` | `172efa60faa74ec6431b93a1810eb279d8c1add3` | REAL (the ACT's own head) |
| `SOURCE_VERSION` | **NOT_EXECUTED** | — |
| `BUILD_HEAD` | **NOT_EXECUTED** | — |
| `VSIX_PATH` | **NOT_EXECUTED** | — |
| `VSIX_BYTES` | **NOT_EXECUTED** | — |
| `VSIX_SHA256` | **NOT_EXECUTED** | — |
| `INSTALLED_VERSION` | **NOT_EXECUTED** | — |
| `INSTALLED_BUNDLE_SHA256` | **NOT_EXECUTED** | — |

Building and installing a VSIX would produce an artifact that is
**byte-identical in production behaviour** to the entry build — because the
production diff is **0 bytes** (§5 of `08-executable-gates.md`). A hashed
artifact would therefore add no information about the repair, while implying
a qualification that did not happen.

---

## 2. Live qualification

**NOT EXECUTED.** The ACT's live observations require:

> 2. "An adjudication is established through the authorized representation."
> 4. "The qualified decision survives in the actual provider-visible continuation."

**There is no authorized representation** for the historical witness shape, and
no production mechanism exists that could establish one. Running a live model
session would exercise the **unmodified** production compaction path, whose
behaviour with a thinking-only adjudication is already fully characterised:
the adjudication is removed at M1.

**No provider-capture pipeline was run. No correlation identities are
reported. No session was created.**

| Live observation | Status |
|---|---|
| 1. Source and installed bundle identity match | **NOT_EXECUTED** |
| 2. An adjudication is established through the authorized representation | **NOT_EXECUTED** — no authorized representation exists |
| 3. Compaction occurs | **NOT_EXECUTED** |
| 4. The qualified decision survives in the actual provider-visible continuation | **NOT_EXECUTED** |
| 5. The source evidence remains distinguishable from the model-derived verdict | **NOT_EXECUTED** |
| 6. No raw thinking block is forwarded | **STRUCTURALLY HOLDS** — the production projection drops every thinking block for the `agentic_summary` policy; this is unchanged and is asserted by the discriminator |
| 7. No source-file excerpt section is activated | **STRUCTURALLY HOLDS** — `SOURCE_FILE_FACT_CARRY_FORWARD_ENABLED` is `false`, asserted executably |
| 8. Subsequent requests preserve stable-prefix behaviour | **NOT_EXECUTED** (live) / **STRUCTURAL** (projection emits no `dropped_message` action for a within-budget request) |
| 9. A later contradiction invalidates or qualifies the old decision | **NOT_EXECUTED** against a deployed mechanism |
| 10. No new trust-boundary exposure is observed in the tested cases | **STRUCTURALLY HOLDS** — no production change |

---

## 3. Behavioural improvement

**Not measured, and not claimed.**

The ACT states:

> "Whether the agent performs fewer redundant reads or finishes earlier is a
> separate measurement. The structural repair's success must not be reported
> as proof of improved autonomous convergence."

No structural repair exists, no live run was performed, and no convergence
claim is made in either direction. The predecessor's own finding stands
unchanged: the historical loss is a **real, measured** adjudication-continuity
defect at M1 — this ACT establishes that its **safe repair is currently
blocked by the trust boundary**, not that the defect is unimportant.

---

## 4. Reopen conditions for the build/live stage

The build and live stages become reachable only when a successor ACT has:

1. established an **authorized representation** for a qualified adjudication
   (a new model-output contract or a new structured adjudication channel —
   both outside this bounded M1 repair), and
2. turned the RED GREEN **without** weakening RED-3's thinking-placement
   assertion, and
3. passed the full G6 adversarial and G7 conservation suites against the
   deployed implementation.

Until then, a VSIX hash would certify an unchanged production tree.
