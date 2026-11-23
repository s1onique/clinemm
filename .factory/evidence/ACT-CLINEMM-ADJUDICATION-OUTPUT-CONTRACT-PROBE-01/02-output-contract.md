# 02 — The output contract (G2)

This is a **test-local contract proposal**, not an authorized production
protocol. It lives entirely in
`sdk/packages/core/src/extensions/context/compaction.adjudication-output-contract.probe01.test.ts`
(and its live-probe mirror in
`sdk/packages/core/scripts/adjudication-output-contract.live-probe.ts`).
Nothing here is installed as a global ClineMM API.

## The candidate envelope

The model publishes a JSON object in an ordinary assistant `text` block:

```json
{
  "kind": "adjudication_candidate",
  "schema_version": 1,
  "finding_id": "S1",
  "decision": "narrowed",
  "qualification_codes": ["manual_enforcement_only"],
  "evidence_tool_use_ids": ["call_s1_source_read_0001"],
  "counterevidence_tool_use_ids": [],
  "remaining_question_ids": ["S1.automated_enforcement"]
}
```

This is **model-authored candidate state**, never authoritative source
evidence.

## The test-local bounded vocabulary

Derived from the synthetic task fixture, deliberately NOT global:

```text
FINDING_IDS            S1 | S2 | S3
DECISIONS              supported | narrowed | refuted | unresolved
QUALIFICATION_CODES    manual_enforcement_only
                       independently_observed_contradiction
                       source_evidence_missing
QUESTION_IDS           S1.automated_enforcement
                       S2.observed_configuration
                       S3.source_location
BOUNDS                 MAX_ENVELOPE_ARRAY_ENTRIES = 8
                       MAX_ENVELOPE_CHARS         = 2000
```

The synthetic task:

| Finding | Decision | Qualification | Rationale |
|---|---|---|---|
| **S1** | `narrowed` | `manual_enforcement_only` | The observed configuration is within the current documented budget, but automatic enforcement is absent |
| **S2** | `refuted` | `independently_observed_contradiction` | A claim contradicted by independently observed configuration evidence |
| **S3** | `unresolved` | `source_evidence_missing` | A claim whose necessary source evidence is missing or ambiguous |

## Field authority

| Field | Authority rule (enforced) |
|---|---|
| `finding_id` | Must match a known task finding (`FINDING_IDS`). Unknown id -> REJECT (`unknown_finding_id`) |
| `decision` | Strict enum. Invalid value -> REJECT (`invalid_decision`). A value not permitted for the finding -> REJECT (`decision_not_permitted_for_finding`) |
| `qualification_codes` | Bounded allowlist. Unknown code -> REJECT. The ESSENTIAL qualification for the finding must be present, or the candidate is REJECTED as `missing_essential_qualification:<code>` |
| `evidence_tool_use_ids` | Must resolve to a canonical PAIRED tool call/result. Unresolvable -> REJECT. Unpaired -> REJECT. Failed result -> REJECT |
| `counterevidence_tool_use_ids` | Same validation as evidence references |
| `remaining_question_ids` | Must be a recognized open question AND belong to the same finding, else REJECT |
| Source revision | Must be independently established by the runtime or a source snapshot. A revision the runtime cannot bind -> REJECT (`unbound_source_revision`). A changed revision -> `STALE` |

**No arbitrary natural-language evidence body is required.** The contract
deliberately has no field for one: a source excerpt is rejected as an
unknown field.

## If a decision cannot be represented faithfully

The contract must REJECT rather than silently discard qualifications. This
is implemented directly: an artifact that loses `manual_enforcement_only`
is rejected as `missing_essential_qualification:manual_enforcement_only`,
and an artifact that converts `narrowed` into `supported` is rejected as
`decision_not_permitted_for_finding`. Both are executable assertions in
PROBE-6.


## Hard boundaries — the contract rejects

| Rejected input | Rejection reason |
|---|---|
| Unknown fields | `unknown_field:<key>` |
| Unknown finding IDs | `unknown_finding_id` |
| Invalid enum values | `invalid_decision` |
| Unbounded arrays | `array_too_large:<field>` |
| Free-form injected instructions | `unknown_field:<key>` (a prose field) or `unknown_qualification_code:<code>` (an instruction-shaped code) |
| Source excerpts | `unknown_field:evidence_excerpt` |
| Secrets or credential values | `unknown_field:<key>` — there is NO field through which arbitrary content can be carried |
| Tool references that cannot be resolved | `unresolvable_tool_reference:<id>` |
| Unpaired tool references | `unpaired_tool_reference:<id>` |
| Failed tool results | `failed_tool_result:<id>` |
| Claimed source revisions that cannot be independently bound | `unbound_source_revision` |
| Missing qualifications essential to the decision | `missing_essential_qualification:<code>` |
| Malformed / interrupted / partial envelopes | `malformed_json` (never partially accepted) |
| Oversized carriers | `carrier_too_large` |

**Parsing is strict, never a regex scrape.** The carrier must be EXACTLY
one JSON object; `JSON.parse` failure is `malformed_json`. No verdict word
is ever extracted from a larger transcript.

## Authority classification

Every accepted envelope retains:

```text
AUTHOR:         MODEL
AUTHORITY:      PROVISIONAL
SOURCE_SUPPORT: NOT_INDEPENDENTLY_ADJUDICATED
REVISION:       VERIFIED | UNVERIFIED | STALE
```

A structurally valid artifact is **not** automatically a correct verdict.

**Semantic support is OPT-IN and never inferred from provenance.** The
validator accepts an optional, test-local, INDEPENDENT semantic check. When
it is absent, or when it disagrees, the candidate stays `PROVISIONAL` and
`semantically_verified` stays `false`. A tool-call reference that resolves
to a paired call/result establishes PROVENANCE IDENTITY, not TRUTH.

The candidate is **never** promoted into a system or developer instruction:
the provider-visible projection contains zero `role: "system"` messages in
the probe, and no authority field is ever written.

## The confidentiality boundary

The transport surface is deliberately a CLOSED vocabulary of identifiers and
enums. There is no field through which arbitrary model prose, file content,
stdout or reasoning can travel. This is the design response to the ACT's
warning that an unrecognized secret format in arbitrary model-authored prose
cannot be made universally safe by a finite sanitizer: **the transport
surface for arbitrary content is not created, so it does not need to be
made safe.**
