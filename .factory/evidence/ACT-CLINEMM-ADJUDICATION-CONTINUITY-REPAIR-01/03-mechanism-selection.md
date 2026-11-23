# 03 — Mechanism selection

**ACT:** `ACT-CLINEMM-ADJUDICATION-CONTINUITY-REPAIR-01`
**G2.4 exit decision:** `HALT_TRUST_BOUNDARY_UNRESOLVED`

---

## 1. The decision table

| Candidate | Mechanism | Decision | Binding reason |
|---|---|---|---|
| **S1** | Allow raw `thinking` blocks into the summarizer | **REJECT** | Unbounded trust/disclosure surface. Measured: S1 delivers the verdict **and** the model's unrelated private reasoning **and** its speculative severity numbers. A character cap bounds the *volume* of disclosure, not *which text* is disclosed. Also prohibited outright by the ACT ("Raw `thinking` preservation is not an acceptable shortcut") and by G4's implementation exclusions. |
| **S2** | Derive a bounded, source-grounded adjudication from an already-authorized structured representation | **REJECT (historical)** | Measured against the real record: the only already-authorized carriers are assistant `text` and `tool_result`. The historical witness turn has **no `text` block** and the `tool_result` carries the **evidence**, not the **adjudication**. Neither carrier yields a qualified decision. |
| **S2′** | …the same derivation, but reading the `thinking` carrier | **REJECT** | This is precisely the ACT's stated trust-gate failure: "If eligibility requires inspecting arbitrary private reasoning … the trust gate fails." Measured: 0 structured verdict fields across all 97 thinking blocks, so the verdict must be found by *searching free-form prose*. |
| **S3** | Preserve an existing explicitly authored non-reasoning progress statement | **REJECT (as a historical repair) / AVAILABLE (future-facing only)** | Measured: works only for a model that *publishes* the adjudication in a `text` block. The historical witnesses never did. The ACT forbids mis-presenting this as recovering historical thinking-only verdicts. |

---

## 2. The eligible representation

**There is NO eligible representation for the historical witnesses.**

For a **future-facing** mechanism the eligible representation would be:

> a **model-authored assistant `text` block** that (a) contains a verdict
> token AND a qualification token, and (b) sits in a message that carries a
> `tool_use` whose matching `tool_result` exists in the canonical record.

This representation is:

| Property | Assessment |
|---|---|
| Who authored it? | The model. It is model-derived state, **not** system instruction and **not** independently trusted fact. |
| What authority does it have? | **None beyond being a continuation aid.** It must not outrank the canonical tool-result record, user instructions, runtime completion obligations, or newer contradictory evidence. |
| Can it contain copied untrusted instructions? | **Yes** — a model may echo tool output. Hence the injection rejection is mandatory. |
| Can it contain credentials or private reasoning? | **Yes, in principle.** Hence the refusal-to-promote rule; a denylist is **not** a confidentiality proof. |
| Can its supporting evidence be verified independently? | **Yes** — structurally, via the paired `tool_use` / `tool_result` relation, which is verifiable without trusting the model's prose. |
| Can it become stale? | **Yes** — hence a source-revision identity is required, or an explicit **UNRESOLVED** marker. The historical record carries **no** revision in the carrier, so freshness cannot be established for it. |
| Can it be carried to a possibly different summarizer provider? | Yes, as ordinary assistant text — this is the property S3 inherits. |
| Can it survive the next compaction without becoming authoritative over newer evidence? | Only if the carry-forward is explicitly qualified and refreshable. |

---

## 3. Source grounding, confidentiality, injection resistance, freshness

| Dimension | Status | Basis |
|---|---|---|
| **Source grounding** | **PROVEN for a future-facing carrier** | Structural: the carrier message's paired `tool_use` whose `tool_result` exists in the canonical record. **NOT provable for the historical witnesses** — their carriers are absent. |
| **Confidentiality** | **REFUSAL-TO-PROMOTE ONLY** | The probe refuses to promote a secret-bearing carrier. **This is not a sanitizer and does not prove arbitrary-content confidentiality.** No such claim is made. |
| **Injection resistance** | **PROVEN for the tested shapes** | Instruction-shaped payloads are refused. A finite shape list is **not** a universal injection proof. |
| **Freshness** | **UNRESOLVED for the historical witnesses** | The carrier carries no source revision. A freshness rule requires a newly authored artifact that names its revision. |
| **Historical witness coverage** | **ZERO of R3 / R7 / R8** | Measured: each adjudication phrase occurs exactly once in the whole record, in a `thinking` block. |

---

## 4. Why no production change was made

G2 states:

> "**No production implementation is authorized until this gate passes.**"
> …
> "**Exit:** `HALT_SCOPE_EXPANSION` with the minimum new contract documented."

and G2.4:

> "Otherwise: `HALT_TRUST_BOUNDARY_UNRESOLVED`
> Preserve the RED and the feasibility findings. Do not weaken the assertions
> to manufacture GREEN."

The gate **did not pass**. Therefore:

- **G3 (minimum implementation contract) was NOT executed** — it is
  conditional on `GO_BOUNDED_IMPLEMENTATION`.
- **G4 (production repair) was NOT executed.**
- **G5 (turn the RED GREEN) was NOT executed.** The RED remains RED, and the
  original assertions were **not** weakened.
- **G6/G7 adversarial and conservation suites were NOT re-specified against a
  deployed implementation**, because there is none. The predecessor's eight
  controls remain in the discriminator and were re-run and pass.
- **G8 Gate 6** was applied as the ACT specifies for a halt: the RED is left
  isolated with its intentional-failure designation and is **not** in the
  default suite.

---

## 5. The minimum contract for a successor ACT

Two successor shapes are possible. Both are recorded here as **the minimum**
required, not as a proposal to implement now.

### 5.1 Shape A — future-facing carry-forward of an authored non-reasoning statement

Requires: a new model-output contract (the model publishes its adjudication
in a `text` block, naming its finding id, its qualification, its evidence
tool-call id and its source revision). **This is a new model-output protocol
and is outside this bounded M1 repair** (G2.2's `HALT_SCOPE_EXPANSION`
condition). It would make the repair **future-facing only** and would **not**
repair the historical R3/R7/R8 loss.

### 5.2 Shape B — a structured adjudication channel inside the canonical record

Requires: a new content-block type or a sidecar schema field that carries the
adjudication as **structured, model-authored, source-revision-bound** data.
This is a **new public protocol field** and is explicitly excluded by G4
("new public protocol field without separate authorization") and by the ACT's
final constraints.

**Both shapes are future-facing. Neither recovers the historical witnesses.**
That is the substantive finding of this ACT.
