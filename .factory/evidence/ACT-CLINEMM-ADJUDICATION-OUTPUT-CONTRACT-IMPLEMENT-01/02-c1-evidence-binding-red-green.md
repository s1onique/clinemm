# 02 — C1: the evidence-binding gates

## The defect the predecessor measured

The corrected MiniMax-M3 experiment measured, over 10 runs:

```text
runs                          10
schema_valid                   9
nonempty canonical refs bound  0
source_revision_bound          0
candidate_accepted             0
```

Run 4's empty evidence-reference array was incorrectly counted as
successful reference resolution in the old aggregate. An empty array
resolves VACUOUSLY — every item in an empty array resolves — and that is
not a binding witness.

## The mechanism chosen, and why

The ACT's G3.1 preference order is:

1. Reuse an exact, already model-visible canonical tool-call id.
2. Expose a bounded, opaque evidence handle through an EXISTING
   tool-result representation, with an exact runtime-owned mapping.
3. Stop.

**Mechanism 1 was traced and MEASURED to be insufficient.** The canonical
id IS on the wire — the provider format carries `toolCallId` on both the
`tool-call` and the `tool-result` part. But the predecessor's live
receipts show the model does not quote it back: across 10 runs it wrote
`call_1` (8 times), `read_files_1` and
`read_files_synthetic-pool-config.yaml`. A contract that requires the
model to reproduce a provider-issued opaque identifier is a contract the
model cannot satisfy.

**Mechanism 2 was implemented.** The runtime issues a BOUNDED, OPAQUE,
SESSION-SCOPED evidence handle and exposes it through the EXISTING
tool-result representation: one bounded trailer line on the tool result
the model already reads.

```text
[cline-evidence-handle] cline-ev-e6aa9c86e8e4e711 tool=read_files
```

The trailer carries NO source content, NO path and NO excerpt — only the
opaque handle and the tool name.

## The handle contract

| Requirement | How it is met |
|---|---|
| Session-scoped | The registry is bound to one session and carries a per-session secret that is part of the derivation. |
| Collision-resistant within the session | The handle is a keyed hash over the canonical tool-call id under the session secret. Two different tool calls cannot share a handle, and the handle cannot be guessed from the id. |
| Bound to exactly one canonical tool call | The mapping is a FUNCTION. `resolve()` scans the canonical tool-call ids and returns the one whose derived handle equals the cited handle. There is NO nearest-match, NO ordinal, NO chronological heuristic, NO filename match and NO tool-name match. |
| Stable across serialization and compaction | The handle is a pure function of (session secret, session id, canonical tool-call id). |
| Revoked when the evidence ceases to be usable | A candidate whose cited handle no longer resolves to a paired, successful tool result is rejected, and the continuity projection drops it. |
| Incapable of resolving across sessions | The session secret is part of the derivation, so a handle minted under another session's secret does not resolve. This is asserted by a dedicated negative control. |

## The gates, in order

1. **Vocabulary authorization.** Without a host-supplied vocabulary the
   candidate is NOT accepted (`no_authorized_vocabulary`). There is no
   default vocabulary.
2. **Decision permission.** The decision must be permitted for the
   finding.
3. **Essential qualification.** The load-bearing qualification must
   survive verbatim.
4. **Question ownership.** Every cited question must belong to the
   candidate's own finding.
5. **Nonempty evidence.** A source-supported adjudication must cite at
   least one piece of evidence. An `unresolved` abstention may carry
   none, but it is never a source-grounded adjudication.
6. **Canonical reference resolution.** Every cited reference resolves
   EXACTLY — to a canonical provider-issued id, or to an opaque handle
   this session minted for one.
7. **Paired, successful evidence.** The resolved evidence must be a
   paired, successful tool result.
8. **Source-revision binding.** The runtime must independently bind a
   source revision for every cited source.

## The independent reporting (a defect this ACT found and fixed)

The FIRST implementation short-circuited: a candidate whose references
resolved but whose revision could not bind reported
`canonical_refs_resolved: false`, which is FALSE.

The LIVE probe caught it — the first live run reported
`canonical_refs_resolved: false` with an EMPTY unresolved-reference list,
which is a contradiction no honest implementation should produce.

The reference resolution and the revision binding are now evaluated
independently, and each reports its own truth. The live receipts now show
the distinction clearly: runs 6 and 8 of the final 16-run sample reported
`canonical_refs_resolved: true` with `source_revision_bound: false`.

## The G3 exit witness

```text
schema_valid              true
nonempty_refs             true
canonical_refs_resolved   true
source_revision_bound     true
candidate_accepted        true
semantic_support_verified false
```

`semantic_support_verified` is `false` and there is NO mechanism in this
module that could make it `true`: the module ships without an independent
semantic adjudicator. The field exists so that "accepted" can never be
confused with "true".

## The exact negative controls

| Control | Result |
|---|---|
| Empty evidence-reference array | Rejected: `missing_supporting_evidence` |
| Invented `call_1` | Rejected: `unresolvable_tool_reference:call_1` |
| The exact canonical tool-call id | ACCEPTED |
| A handle from another session | Rejected: `unresolvable_tool_reference:<handle>` |
| A handle for a call with no matching result | Rejected: `unpaired_or_failed_tool_reference:<id>` |
| A FAILED tool result | Rejected: `unpaired_or_failed_tool_reference:<id>` |
| A tool-name-only reference (`read_files`) | Rejected: `unresolvable_tool_reference:read_files` |
| A generic command's stdout as evidence | Rejected: `evidence_has_no_source_identity:<id>` — a command's stdout is NEVER reinterpreted as a file read |
| No revision resolver | `canonical_refs_resolved: true`, `source_revision_bound: false` |
| No authorized vocabulary | Rejected: `no_authorized_vocabulary` |
| An unknown finding id | Rejected: `unknown_finding_id:<id>` |
| A missing essential qualification | Rejected: `missing_essential_qualification:<code>` |
| An unknown qualification code | Rejected: `unknown_qualification_code:<code>` |
| An unknown JSON field | Rejected at parse: `unknown_field:<name>` |
| A missing field | Rejected at parse: `missing_field:<name>` |
| A forged source-revision field | Rejected at parse: `unknown_field:source_revision` — the model has no such field to author |
| A candidate in a thinking block only | NEVER collected |
| A candidate in a tool result only | NEVER collected |
| A replayed candidate from another session | NEVER accepted |
