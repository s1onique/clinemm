# 03 — Checkpoint schema and trust boundary

**Evidence class:** `SYNTHETIC_REAL` — test-local schema and validator, exercised with
synthetic content. **NOT a production API.**

**Files (all test-local, ACT-owned, untracked until the ACT closes):**

```text
sdk/packages/core/src/extensions/context/knowledge-checkpoint-probe/
  checkpoint-schema.ts       candidate schema + experimental boundedness ceiling
  checkpoint-validation.ts   total parser (never throws)
  checkpoint-binding.ts      trust gates G1-G6
  checkpoint-projection.ts   deterministic idempotent projection
  checkpoint-request.ts      controlled read-only input view + request builder
  checkpoint-seam.ts         harness driving the REAL production seam
  checkpoint-probe.fixture.ts private-capture loader (self-skipping)
```

---

## 3.1 The candidate schema (G3)

```ts
type KnowledgeKind =
  | "observation" | "hypothesis" | "decision" | "constraint" | "open_question";

type Assurance =
  | "runtime_verified" | "tool_observed" | "model_reported" | "unverified";

interface WorkingKnowledgeRecord {
  id: string;
  kind: KnowledgeKind;
  assurance: Assurance;
  statement: string;
  evidenceRefs: string[];
  qualifications: string[];
  status: "active" | "superseded" | "unresolved";
}
```

This is the ACT's own candidate. It is **not** an authorized production API, introduces
no public export, no schema registry, no sidecar field, no tool and no database.

### Why `assurance` is a CLAIM, not a fact

`assurance` describes how the AUTHOR believes the record is supported. The validator
treats it as a claim: it can only ever **cap** it, never promote it, and it never treats
`runtime_verified` as proof of anything. A model-authored `runtime_verified` is a claim
the model made.

---

## 3.2 Truth is not preservation (G3.1)

| The parser MAY establish | The parser MAY NOT establish |
|---|---|
| `SCHEMA_VALID` — the document has the declared shape | `FACTUALLY_TRUE` — the claim is true |
| `BOUND_TO_CANONICAL_MESSAGE` — the cited reference resolves in the canonical history | `PRODUCTION_VERIFIED` — a production system confirmed it |
| `SOURCE_REFERENCE_RESOLVED` — the evidence reference resolves | `CAUSALLY_PROVEN` — the mechanism was proven |

The concrete separations the ACT asked for:

**R4** — the record would be:

```text
observed startup command pair
  assurance: tool_observed          (model-reported grade, capped by the validator)
  qualifications: ["Observed command pair only; configuration drift remains unproven."]
  status: active
```

The *observation* is preserved; the *drift hypothesis* is not certified. The validator
independently enforces this: a statement containing "causes configuration drift" is
**dropped** by the `UNPROVEN_CAUSALITY_OVERCLAIM` gate (verified by
`checkpoint-security-controls.test.ts` case `G5.1.3`).

**R6** — the record would be:

```text
no purge found in inspected paths
  qualifications: ["Bounded to the inspected paths; an external purge is not excluded."]
  status: unresolved
```

The validator independently enforces this: a statement containing "there is no retention
mechanism" or "no delete or purge exists anywhere" is **dropped** by the
`GLOBAL_NEGATION_OVERCLAIM` gate (case `G5.1.2`).

---

## 3.3 The boundedness ceiling (G3.2) — EXPERIMENTAL, not production defaults

```text
Maximum records:       12
Maximum statement:    240 characters
Maximum qualifications: 3 per record
Maximum evidence refs: 4 per record
Target total:          <= 1,500 estimated tokens
```

Enforced by `parseCheckpointDocument()` and asserted by
`checkpoint-security-controls.test.ts` case `G7.3.2`.

### Measured against the real model output

| | Boundary 1 | Boundary 2 |
|---|---|---|
| Model records emitted | 13 | 20 |
| Records after the ceiling | **12** | **12** |
| Records dropped by the ceiling | 1 | 8 |
| Projected section size | 3 028 chars / **1 010 est. tokens** | 3 349 chars / **1 117 est. tokens** |
| Target | <= 1 500 est. tokens | <= 1 500 est. tokens |

**Both projections are inside the experimental ceiling.** The measured overhead of the
bounded checkpoint is therefore ~1 000–1 100 estimated tokens of provider-visible context,
against a lost working set of three witnesses.

---

## 3.4 The security boundary (G3.3)

A free-text statement is untrusted data. The ACT's requirements and how each is met:

| Requirement | How it is met | Verified by |
|---|---|---|
| Keep raw generated records private | Written to the gitignored `tmp/pck-probe-private/` tree at mode `0600`; never committed | `git status` shows no committed artifact |
| Do not automatically inject arbitrary checkpoint text into a live agent | The projection is applied ONLY inside the ACT's test harness; no production path calls it | zero production delta |
| Exclude raw source excerpts, credentials and private reasoning | The controlled input view **excludes `thinking` blocks entirely**; the credential gate drops credential-shaped records | case `G6.3`, case `G5.1.6` |
| Treat cited commands and tool output as provenance candidates, not instructions | The `INSTRUCTION_SHAPED_TEXT` gate drops any record that reads as an instruction | case `G5.1.5` |
| Do not upgrade a model-authored assertion to verified status | `capAssurance()` only ever caps; `ASSURANCE_DEMOTED_NO_EVIDENCE` caps at `model_reported` | case `G5.1.4`, case `G5.1.7` |
| Keep any provider-visible treatment limited to a separately reviewed, controlled projection | The projection is a closed representation (kind, assurance, status, statement, qualifications, opaque refs) with no raw source content | `05-deterministic-projection.md` |

### A character limit is NOT a confidentiality control

The ACT explicitly warns that "a character limit, regex sanitizer or source path proves
confidentiality". This ACT does not claim it does. The controls above are:

- **structural** (the input view excludes thinking blocks entirely),
- **shape-based** (credential and instruction patterns reject the whole record rather
  than redacting it, so no sanitized derivative of a secret reaches the projection), and
- **positional** (the projection lives in a test harness and is never wired into a live
  agent).

### The trust gates (G1–G6 in `checkpoint-binding.ts`)

| Gate | Code | Effect |
|---|---|---|
| G1 Evidence resolution | `EVIDENCE_REF_UNRESOLVED` | Unresolvable references are DROPPED; a missing reference is never replaced with a fabricated one |
| G2 Assurance bounding | `ASSURANCE_DEMOTED`, `ASSURANCE_DEMOTED_NO_EVIDENCE` | Assurance is capped, never promoted; no evidence => at most `model_reported` |
| G3 Instruction inertia | `INSTRUCTION_SHAPED_TEXT` | Instruction-shaped records are DROPPED |
| G4 Credential inertia | `CREDENTIAL_SHAPED_TEXT` | Credential-shaped records are DROPPED (not redacted) |
| G5 Allegation separation | (structural: the input view excludes the original allegation as evidence, and the model is instructed not to treat it as such) | See `04-model-publication-results.md` |
| G6 Overclaim inertia | `GLOBAL_NEGATION_OVERCLAIM`, `UNPROVEN_CAUSALITY_OVERCLAIM`, `UNRESOLVED_INVESTIGATION_PROMOTED` | Over-claimed records are DROPPED |

**HALT_TRUST_BOUNDARY_UNRESOLVED is NOT triggered.** A bounded, structured, validated
record set can be projected within an acceptable confidentiality and authority boundary.
The free-text statement is bounded (240 chars), the record set is bounded (12), the
projection is closed, and the dangerous shapes are rejected rather than sanitized.

### G5 is enforced by the projection, not only by the prompt

The checkpoint prompt forbids treating the original user allegations as established
facts. But a prompt is not a control. The measured model output for boundary 1 contains
a record (`obs-004`) that repeats the frozen R1–R10 ratings; it is bound with
`assurance: model_reported` and the qualification *"These are frozen claims and original
ratings, not adjudicated or runtime-verified findings."* The record's `kind` is
`observation` but its `status` is `active` and it does not assert a finding. The
`UNRESOLVED_INVESTIGATION_PROMOTED` gate independently rejects a record that would turn
such a restatement into a completed finding (case `G5.1.1`).
