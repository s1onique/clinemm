# 09 — Implementation feasibility

**Evidence class:** `STRUCTURAL` + `REAL_MODEL_RESPONSE` + `SYNTHETIC_REAL`.

---

## 9.1 What is feasible, mechanically

The ACT's question was: *can a model explicitly preserve important working knowledge
immediately before compaction, and can ClineMM carry it forward without silently
converting hypotheses into facts?*

**The second half is answered YES.** The mechanical carrier works.

### The carrier

A checkpoint is a bounded set of structured records, parsed and validated, then
projected as a deterministic section attached to the **existing** `compaction_summary`
message. It:

- does **not** create a second summary message,
- does **not** add a provider tool call,
- does **not** mutate the canonical history,
- does **not** displace the task contract or the verified-outcome section,
- does **not** depend on the summarizer repeating anything in its prose,
- is **idempotent** (strip-then-replace),
- costs **~1 000–1 100 estimated tokens** of provider-visible context.

This mirrors `applyAdjudicationContinuityToCompactedMessages` exactly, which is the
strongest possible precedent: the same pattern, the same seam, the same closed
representation, already shipping in the production compaction path.

### The validation is sound

- **0 unsupported promotions** across 32 published records (2 boundaries).
- **0 contradicted** records.
- The parser is **total** — nine malformed shapes asserted, never throws.
- The trust gates drop, rather than sanitize: instruction-shaped records,
  credential-shaped records, global-negation overclaims, proven-causality overclaims,
  and unresolved-investigation promotions.
- A missing evidence reference is **dropped**, never replaced with a fabricated one.
- Assurance is **capped**, never promoted.

### The model behaves correctly

Given a controlled input, the model published **13** and **20** records and, in every
case, refused to certify what it could not establish. It explicitly reported the
omission of the tool-result bodies rather than inventing their content. It published
R1–R10 as `unresolved`/`unverified`. It wrote a standing constraint — *"absence from
inspected paths does not prove absence of an external mechanism"* — that is exactly the
R6 discipline, without being prompted about R6 specifically.

**A model-authored checkpoint does not silently convert hypotheses into facts.** That
is the ACT's central safety question, and it is answered affirmatively by measurement.

---

## 9.2 What is NOT feasible yet, and why

**The checkpoint model does not receive the relevant pre-compaction evidence.**

Measured, at both boundaries, for all three witnesses:

| Witness | In canonical history | In the checkpoint model's input |
|---|---|---|
| R4 (`start --optimized`) | ✅ | ❌ |
| R6 (`No delete/purge found in those paths`) | ✅ | ❌ |
| R2 (`MtsOmni`) | ✅ | ❌ |

### The two independent causes

**(a) Source-selection / input-serialization defect (L1/L2).**

The production `renderStructuredToolPayload()` renders a structured
`{query, result, success}` tool payload as `[succeeded] #1: [result omitted]`, because
arbitrary command output is never copied. The `agentic_summary` budget policy
additionally drops every `thinking` block before serialization. Both are **existing,
deliberate contracts** (see `01-production-seam-map.md` §1.5).

The consequence: the observations that ordinary compaction loses are, in the cases
measured here, the SAME observations the checkpoint model cannot see. A checkpoint fed
the current production serializer's view inherits exactly the summarizer's blind spot.

**(b) Checkpoint selection / the experimental ceiling.**

At boundary 2 the model emitted 20 records; the 12-record experimental ceiling kept the
first 12 and dropped the model's own qualified `r4-013` and `r6-015` records. The
model had done the right thing; the ceiling discarded it.

This cause is an artifact of the ACT's own experimental bound and is trivially
addressable by selection policy (for example, by prioritizing records that assert an
observation or an open question over records that restate a constraint).

### Why this is a HALT rather than a partial success

The ACT's `GO_PCK_IMPLEMENTATION_FEASIBLE` requires, among other conditions:

> - The checkpoint model receives the relevant pre-compaction evidence.

That condition is **NO**, for all three selected witnesses, at both boundaries.

The ACT also anticipates exactly this outcome:

> `HALT_SOURCE_VISIBILITY` — The necessary facts are missing from the checkpoint model's
> input. **Next: fix the input-selection problem before designing a memory carrier.**

**The ACT's own instruction is to fix the input-selection problem FIRST.** Designing a
finer memory carrier now would be building on a carrier that cannot see the facts it
is supposed to carry.

### What this HALT does NOT say

It does **not** say the checkpoint concept is unsound. The oracle proves the transport
works. It says the **input** is wrong, and that the input must be fixed before a
carrier is worth deploying.

---

## 9.3 The trust boundary — resolved, not blocked

`HALT_TRUST_BOUNDARY_UNRESOLVED` is **NOT** triggered.

A bounded, structured, validated record set can be projected within an acceptable
confidentiality and authority boundary:

- The controlled input **structurally excludes** private reasoning blocks.
- The projection is a **closed representation** — kind, assurance, status, statement,
  qualifications, opaque references. No raw source excerpt, no unrestricted command
  output, no absolute workspace path in the section.
- Credential-shaped and instruction-shaped records are **dropped**, not redacted, so no
  sanitized derivative of a secret reaches the provider-visible context.
- The projection was **never wired into a live agent**; the live sidecar and the
  installed extension were not modified.

The one genuine trust-boundary lesson this ACT produced is a NEGATIVE one, and it is
recorded in `04-model-publication-results.md` §4.6: a length-based "base64-shaped"
credential pattern **rejected two legitimate records** (an absolute path and a 40-hex git
revision). An over-broad shape check destroys real knowledge. A production
implementation would need a much more careful discriminator — or, better, a structural
one (for example, emitting only enumerated, non-free-text fields into the projection).

---

## 9.4 The cost, measured

| Cost | Boundary 1 | Boundary 2 |
|---|---|---|
| Checkpoint generation latency | **66 496 ms** | **80 654 ms** |
| Extra provider-visible tokens | **1 010 est.** | **1 117 est.** |
| Extra model calls | 1 | 1 |
| Records published / accepted | 13 / 10 | 20 / 12 |

**66–81 seconds is a material cost.** It is measured, not estimated, and it is stated
here so that any follow-up ACT must confront it. A production design would need a
justification — for example, generating the checkpoint only when the summarizer has
actually dropped bounded observations, or assigning the checkpoint role to a smaller
model. **This ACT proposes neither.**

---

## 9.5 The concrete next step, in the ACT's own terms

**Fix the input-selection problem before designing a memory carrier.**

The question a follow-up ACT must answer is narrow and answerable:

> Can the checkpoint model be given a view of the pre-compaction history that contains
> the source observations ordinary compaction loses, **without** widening the
> production serializer's contract for arbitrary command output?

Three candidate directions, in the order this ACT's evidence supports them — and
explicitly **not** as an authorization for any of them:

1. **A dedicated, checkpoint-only source view.** The production serializer's
   `[result omitted]` contract exists to keep arbitrary command output out of the
   SUMMARIZER's context. A checkpoint model has a different job: it needs to read
   bounded observations. A checkpoint-specific renderer could emit a bounded,
   source-attributed excerpt for a **source-file read** (the class
   `buildSourceFileFact()` already recognises) without changing the summarizer's
   contract at all. The existing `SOURCE_FILE_FACT_CARRY_FORWARD_ENABLED = false` flag
   is the natural place to look — but enabling it would change a production contract,
   which this ACT is not authorized to do.

2. **Reuse the existing evidence machinery.** The production
   `applyVerifiedEvidenceToCompactedMessages` path already carries a bounded, closed
   representation of verified tool outcomes into the summary. The checkpoint could be
   derived from that same canonical evidence rather than from the serializer's lossy
   view.

3. **Selection policy.** Separately from the input question, the record-selection
   question is answered by the measurement: the 12-record ceiling must not discard a
   qualified observation in favour of a constraint restatement. This is a pure ordering
   problem and is cheap to solve.

**None of these is authorized by this ACT.** This ACT's authorization is reproduction
and feasibility only.

---

## 9.6 The feasibility summary

| Question | Answer |
|---|---|
| Is a structured working-knowledge checkpoint mechanically carryable through the real compaction seam? | **YES** — proven by the oracle |
| Can it be validated without promoting hypotheses into facts? | **YES** — 0 unsupported promotions across 32 records; 10 negative controls pass |
| Does the projection preserve it independently of the summarizer prose? | **YES** |
| Does removing it restore the absence? | **YES** — the ablation |
| Is the confidentiality/authority boundary acceptable? | **YES** — with one measured over-broad-regex lesson |
| What is the overhead? | **~1 000–1 100 est. tokens; 66–81 s** |
| **Can the checkpoint model currently SEE the facts it must carry?** | **NO** — for all three witnesses, at both boundaries |
| Is the concept therefore ready to implement? | **NO** — the input-selection problem must be fixed first |
