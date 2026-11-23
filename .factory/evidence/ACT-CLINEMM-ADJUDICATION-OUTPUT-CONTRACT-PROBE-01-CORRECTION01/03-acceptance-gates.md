# 03 — Schema validity is SEPARATE from contract acceptance

## The conflation that was corrected

The predecessor's live observation reported a single boolean:

```text
publishedValidCandidate: true
```

and its reports then treated that boolean as evidence of live
*compliance* with the adjudication contract. But the predecessor's own
contract specification (`02-output-contract.md`) defines FOUR distinct
conditions, and a candidate must satisfy all of them:

```text
1. the envelope parses under the strict schema         (SCHEMA VALIDITY)
2. every evidence reference resolves to a canonical
   tool call/result pair                                (CANONICAL REFS)
3. the runtime independently binds a source revision     (REVISION BINDING)
4. all of the above hold, so the candidate is
   an accepted adjudication                              (ACCEPTANCE)
```

Collapsing these into one boolean is what produced the false impression of
live compliance. The corrected harness reports them **independently**.

## The four gates in the corrected harness

```ts
// GATE 1 — SCHEMA VALIDITY
observation.schema_valid = true;

// GATE 2 — CANONICAL REFERENCE RESOLUTION
const resolution = resolveCanonicalReferences(parsed.candidate, canonicalToolCallIds);
observation.canonical_refs_resolved = resolution.canonical_refs_resolved;

// GATE 3 — SOURCE REVISION BINDING
observation.source_revision_bound = false;

// GATE 4 — CANDIDATE ACCEPTANCE
if (!resolution.canonical_refs_resolved) {
    observation.acceptance_rejection_reason =
        `unresolvable_tool_reference:${resolution.unresolvedIds[0]}`;
} else if (!observation.source_revision_bound) {
    observation.acceptance_rejection_reason = "unbound_source_revision";
} else {
    observation.candidate_accepted = true;
}
```

## The demonstrated `call_1` reference MUST fail gate 2

The reviewer required this explicitly:

> The demonstrated `call_1` reference must fail the second gate.

The predecessor's committed observation cited `call_1` while the
canonical tool-call id of that session was
`call_01a20794edda73718c196864`. Under the corrected harness:

```text
schema_valid            = true
canonical_refs_resolved = FALSE
unresolvedEvidenceIds   = ["call_1"]
acceptance_rejection_reason = "unresolvable_tool_reference:call_1"
candidate_accepted      = false
```

This is not asserted — it is **executed** in the correction test file
against the exact ids from the committed receipt:

```ts
const resolution = resolveCanonicalReferences(
    { evidence_tool_use_ids: ["call_1"] },
    ["call_01a20794edda73718c196864"],
);
expect(resolution.canonical_refs_resolved).toBe(false);
expect(resolution.unresolvedIds).toEqual(["call_1"]);
```

## Gate 3 is STRUCTURALLY false — and that is the point

The published envelope schema has **eight fields** and none of them is a
source revision:

```text
kind, schema_version, finding_id, decision,
qualification_codes, evidence_tool_use_ids,
counterevidence_tool_use_ids, remaining_question_ids
```

There is consequently nothing for the runtime to bind a revision to. The
corrected harness reports `source_revision_bound = false` for every
observable envelope, and says so **explicitly** rather than leaving the
field absent or inferring it from the schema-valid result.

The 10 live receipts confirm this: `source_revision_bound` is `false` in
all 10 runs, and `candidate_accepted` is `false` in all 10 runs.

## The one run that reached gate 3

**Run 4** is the receipt that proves the gates are independent:

```text
schema_valid            = true
canonical_refs_resolved = true      <-- passed gate 2
unresolvedEvidenceIds   = []         <-- nothing cited; vacuously resolved
source_revision_bound   = false     <-- failed gate 3
acceptance_rejection_reason = "unbound_source_revision"
candidate_accepted      = false
```

Had the harness reported a single boolean, run 4 would have been counted
as a success alongside the other eight — and the claim would have been
that a live model produced an accepted adjudication. It did not.

## The aggregate that follows

```text
schema_valid             9 / 10
canonical_refs_resolved  1 / 10
source_revision_bound    0 / 10
candidate_accepted       0 / 10
```

The reader is left with no way to mistake one gate for another, and no
way to read "9 published" as "9 accepted".

## What this does NOT claim

- It does **not** claim the contract is unsatisfiable. Gate 3 is
  unsatisfiable *by the current envelope schema*, which is a design
  input, not a law. A successor schema that carries a runtime-bound
  revision could satisfy it.
- It does **not** claim the model misbehaved. The model published a
  well-formed envelope with the required qualification intact in 9 of 10
  runs. It failed to cite canonical ids because **it was never told them**
  — that is constraint C1.
- It does **not** claim the output contract is a deployed security
  guarantee. It is not deployed. The parser is test-local, and structured
  model output must be validated in trusted application code before
  downstream use.
