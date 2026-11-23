# 02 — G2 trust and feasibility probe

**ACT:** `ACT-CLINEMM-ADJUDICATION-CONTINUITY-REPAIR-01`
**Gate:** G2 — MANDATORY. No production implementation is authorized until
this gate passes.
**Executable artifact:**
`sdk/packages/core/src/extensions/context/compaction.adjudication-continuity.feasibility01.test.ts`
**Outcome:** `HALT_TRUST_BOUNDARY_UNRESOLVED`

---

## 1. The question the gate answers

The predecessor ACT established **where** the qualified adjudication is lost
(stage **M1**, the compaction source selection in
`buildBudgetProjection()`). It did **not** establish a **safe mechanism** for
identifying and transporting the adjudication.

This gate answers the second question, with measurements rather than
assertions:

> **Can a qualified adjudication be carried across the M1 boundary without
> forwarding arbitrary model reasoning or untrusted source content?**

---

## 2. The historical measurement (REAL)

All measurements below were taken against the **frozen canonical snapshot** of
session `1795394987994_fpu77`, which lives OUTSIDE this repository at
`/tmp/cline-recon-rX/`.

**Snapshot integrity:** the file's SHA-256 was recomputed and is
`9ca5309aa18e43c97343d87171de20f2a198f6ccfe8f266c1f1c33557afa5dcd` — an
**exact match** to the ACT-specified value. The live session directory was
not written to.

### 2.1 The block shape of every witness

| Witness | Canonical idx | Block shape | `thinking` chars | Has `text` block |
|---|---:|---|---:|---|
| R8 | 28 | `[thinking, tool_use]` | 1231 | **NO** |
| R7 | 40 | `[thinking, tool_use]` | 981 | **NO** |
| R3 | 64 | `[thinking, tool_use]` | 1387 | **NO** |
| R4 (progress control) | 124 | `[thinking, tool_use]` | 13068 | **NO** |

All four witnesses carry the block shape `[thinking, tool_use]` and **no
`text` block**. The source revision under audit was Keycloak
`42de653b59708e712d694aeb9732f822b7f8fe5b`.

### 2.2 Where the adjudication phrases actually occur

Each of the three adjudication phrases was searched for across the **entire**
196-message record, in every carrier:

| Phrase | Occurrences | Carrier |
|---|---:|---|
| "R8's claim of committed bootstrap admin creds is CONFIRMED as an observation" | **1** | `thinking` @ idx 28 |
| "R7 verdict: CONFIRMED (observation-level) but severity may be narrowed" | **1** | `thinking` @ idx 40 |
| "R3 is NARROWED: the risk is a manual process with a comment, no automated enforcement" | **1** | `thinking` @ idx 64 |

**Each phrase occurs in exactly one place in the whole record, and that place
is a `thinking` block.**

### 2.3 The lexical-noise trap (measured)

Verdict tokens occurring OUTSIDE thinking blocks:

| Carrier | Count | What it actually is |
|---|---:|---|
| `text` | 1 `CONFIRMED`, 1 `NARROWED` | the **USER's original task prompt** — the task-contract RUBRIC, i.e. the *allegation*, not the *adjudication* |
| `tool_result` | 4 `CONFIRMED`, 0 `NARROWED` | **Java source code**: `@Column(name = "CONFIRMED", nullable = false)` in a JPA entity |

The `tool_result` occurrences are a textbook instance of the trap the ACT
warns about: *"It contains a verdict keyword."* A mechanism that recognises
`CONFIRMED` lexically would promote a database column name into an
adjudication.

### 2.4 Is there a structured field inside a thinking block?

Measured across **all 97 thinking blocks** in the record:

| Structured marker | Occurrences |
|---|---:|
| Labelled field (`verdict:` / `finding:` / `decision:` / `evidence:` / `qualification:`) | **0** |
| JSON block | 15 (in other blocks; **none** in R8/R7/R3) |
| Markdown heading | **0** in the three witnesses |

**There is no field boundary inside a thinking block.** The verdict is embedded
in free-form prose that also carries unrelated side-questions and speculative
severity numbers. Any extraction must therefore *search prose*, not read a
field.


---

## 3. Candidate evaluation (executable)

The probe is at
`sdk/packages/core/src/extensions/context/compaction.adjudication-continuity.feasibility01.test.ts`
and exercises the **real production seam** (`buildBudgetProjection()`,
`serializeConversation()`, `isSensitiveSourceFilePath()`), not a
re-implementation.

### 3.1 The candidate extraction used for the probe

The probe implements the **strictest plausible bounded extraction**:

| Check | Rule | Failure reason |
|---|---|---|
| A — eligible | the carrier contains a **verdict token** AND a **qualification token** | `no_verdict_token` / `no_qualification` |
| B — grounded | the carrier's message has a paired `tool_use` whose `tool_result` exists in the canonical record | `no_source_grounding` |
| C — injection | the carrier does not contain an instruction-shaped payload | `injected_instruction` |
| D — secret | the carrier does not contain a credential-shaped token | `secret_bearing` |
| E — provenance | the carrier does not name a credential-bearing path (production `isSensitiveSourceFilePath`) | `sensitive_provenance` |

Source grounding is **STRUCTURAL** (the paired tool call whose result exists),
not a lexical search for a `call_…` id inside the model's prose. A lexical id
search is not verifiable independently of the model; the structural relation
is — it is the same relation `buildBudgetProjection()` itself uses
(`collectToolIds` / `buildToolPairIndex`).


### 3.2 Candidate outcomes

| Candidate | Mechanism | Measured outcome | Label |
|---|---|---|---|
| **S1** | allow raw `thinking` blocks into the summarizer | **REJECT.** It *does* deliver the verdict — and it *also* delivers the model's **unrelated private reasoning** ("let me check the next finding") and its **speculative severity numbers** ("4/5 maybe narrowed to 3/5"). The disclosed volume is the model's entire reasoning block, bounded only by the per-block character cap, not by any property of the content. | REAL_PRODUCTION_SEAM |
| **S2 / assistant_text** | derive from the model-authored `text` carrier | **REJECT for historical recovery.** The historical witness turn has **no `text` block**, so the assistant-text carrier carries **no qualified decision** at all. The extraction returns `no_verdict_token`. | REAL_PRODUCTION_SEAM |
| **S2 / tool_result** | derive from the tool-output carrier | **REJECT.** The tool result carries the **evidence** (`maxWorkers: 36`), not the **adjudication** (`NARROWED` + qualification). The extraction returns `no_verdict_token`. It is also the carrier that **can** contain copied untrusted instructions. | REAL_PRODUCTION_SEAM |
| **S2 / thinking** | derive from the thinking carrier | **REJECT — the trust gate's explicit failure condition.** The extraction **would succeed**, but only by **reading free-form private reasoning prose** with **no field boundary** (§2.4). | REAL_PRODUCTION_SEAM |
| **S3** | preserve an existing authored non-reasoning statement | **FUTURE-FACING ONLY.** It works for a model that publishes the adjudication in a `text` block; it **does not** recover the historical thinking-only witnesses (measured: `historicalExtraction.ok === false`, `futureExtraction.ok === true`). | REAL_PRODUCTION_SEAM |

### 3.3 The G2.3 required probe contract (A through G)

| Item | Requirement | Result |
|---|---|---|
| **A** | A supported qualified adjudication is eligible | **PASS** — over the assistant-text carrier the extraction returns `ok` with a structurally grounded `evidenceToolUseId`. |
| **B** | An unsupported assertion is rejected | **PASS** — `no_qualification`. |
| **C** | An injected instruction is rejected | **PASS** — `injected_instruction`. |
| **D** | Secret-bearing content is not copied | **PASS** — `secret_bearing`; the extracted output is `undefined`. **This is a REFUSAL to promote, not a sanitizer.** A finite denylist does **not** prove arbitrary-content confidentiality, and no such claim is made. |
| **E** | A stale/contradicted adjudication loses authority | **PARTIAL.** The probe establishes that the carrier carries **no source revision** (`carriesSourceRevision === false`), i.e. freshness is **UNRESOLVED** and must be recorded as such rather than assumed. A full freshness rule requires a source-revision identity that the historical record does not carry — see §5. |
| **F** | Original source evidence is never replaced by the verdict | **PASS** — the extraction copies no evidence body (`maxWorkers: 36` / `documentedBudget: 400` are absent from the extracted verdict) and carries the evidence **by reference only**. |
| **G** | The historical thinking-only witness is actually recoverable, **or the limitation is reported explicitly** | **LIMITATION REPORTED EXPLICITLY.** The witness turn has shape `[thinking, tool_use]`; no authorized non-reasoning carrier carries the qualified decision; only the thinking carrier does, and reading it is reading private reasoning prose. The probe also pins the measured absence of any structured verdict field. |

### 3.4 The probe does not depend on test-written flags

The probe has **no** "this candidate is safe" boolean. Its eligibility,
rejection, injection, secret and provenance decisions are computed from the
carrier content plus the production `isSensitiveSourceFilePath()` and the
production tool-pair relation. The `requiredReadingPrivateReasoning` flag is
not an eligibility input — it is a **label** recording which carrier was
read, and the probe asserts on it only to make the private-reasoning
dependency explicit.


---

## 4. Why this is the trust gate's failure condition, not an implementation gap

The ACT's G2.3 states:

> "If eligibility requires inspecting arbitrary private reasoning or
> unrestricted file-result text, **the trust gate fails**."

And G2.2 states, for S1:

> "**REJECT** for automatic deployment: unbounded trust/disclosure surface"

And G2.1 states:

> "**Important:** the historical R3/R7/R8 adjudications existed only in
> thinking blocks. An alternative that carries existing assistant text but
> does not recover these witnesses is not a complete historical repair."

These three constraints intersect exactly on the measured facts:

- The historical adjudications exist **only** in thinking blocks (§2.1, §2.2).
- The only way to reach them is to read the thinking block (§3.2).
- Reading the thinking block means reading free-form private reasoning prose
  with no field boundary (§2.4).

Therefore **no mechanism within the bounded candidate set can recover the
historical adjudications without failing the trust gate**, and **no mechanism
that satisfies the trust gate can recover them at all**.

---

## 5. What a future-facing-only repair would still need

If a future session is authorized to carry an authored non-reasoning
adjudication (S3), the minimum additional contract is:

```
INPUT_AUTHORITY        model-authored assistant text (NOT a system instruction)
ELIGIBILITY_RULE       verdict token AND qualification token in the same message
EVIDENCE_BINDING       the message's paired tool_use whose tool_result exists
OUTPUT_REPRESENTATION  visibly model-derived and qualified; evidence by REFERENCE
CONFIDENTIALITY        refusal-to-promote, never copy; no raw source excerpts
REVISION_FRESHNESS     source-revision identity, or an explicit UNRESOLVED marker
TOKEN_BUDGET           a finite, explicitly validated carry budget
PERSISTENCE            none beyond the compaction sidecar already in use
NO_OP                  zero additional model calls
```

The **source-revision identity** remains the open item: the historical record
carries no revision in the adjudication's carrier, so a freshness rule can
only ever be implemented against a **newly authored** artifact that names its
revision. This is a further reason the mechanism is future-facing.

---

## 6. Executable evidence

```bash
cd sdk/packages/core
bun x vitest run \
  src/extensions/context/compaction.adjudication-continuity.feasibility01.test.ts \
  --config vitest.config.ts
```

**Observed:** `Test Files 1 passed (1)` / `Tests 16 passed (16)` / exit 0.

Raw output: `verification/gate2b-feasibility-probe.txt`.
