# 02 — The production seam

ACT-CLINEMM-COMPACTION-FACTUAL-PRESERVATION-REPAIR-01

## The inspected production surface

| Function | Location | Role |
|---|---|---|
| `runAgenticCompaction()` | `sdk/packages/core/src/extensions/context/agentic-compaction.ts:52-262` | The production summarizer request path. |
| `buildAgenticSummaryInputBudget()` | `agentic-compaction.ts:31-42` | The production summarizer-input budget projection. |
| `buildSummaryRequest()` | `compaction-shared.ts:943-977` | Assembles the request: instructions, previous summary, files, conversation. |
| `buildSummaryMessage()` | `compaction-shared.ts:1042-1066` | Builds the `compaction_summary` message. |
| `applyTaskContractToCompactedMessages()` | `task-contract.ts:358-445` | The task-contract carry-forward. Takes a `sourceMessageCount` boundary. |
| `applyVerifiedEvidenceToCompactedMessages()` | `evidence-continuity.ts:2356-2469` | The verified-outcome carry-forward. Takes a `sourceMessageCount` boundary. |
| `applyAdjudicationCarryForward()` | `compaction.ts` | The adjudication carry-forward. |
| `sanitizeOutcomeText()` | `evidence-continuity.ts:1379-1406` | The value-position credential sanitizer. |
| `isSensitiveSourceFilePath()` | `evidence-continuity.ts:406-411` | The credential-path rule. |
| `countCanonicalSourceMessages()` | `session/models/session-compaction.ts:81-85` | The canonical boundary count. |
| `projectSessionCompactionState()` | `session/models/session-compaction.ts:229-259` | The persisted-state projector. Appends the canonical tail. |

## The three integration sites

The production seam has THREE places where a fresh compaction result is
enriched before it is persisted and before the provider projection is built:

1. **The re-compaction site** — `compaction.ts:2047-2067`. A historical
   sidecar is enriched on READ, scoped to the sidecar's OWN
   `source_message_count`.
2. **The first-compaction site** — `compaction.ts:2203-2218`. The first
   compaction of a session, scoped to the FULL canonical count.
3. **The new-compaction site** — `compaction.ts:2009-2053`. A fresh compaction
   whose boundary is the whole canonical history at this moment.

The source-bound evidence carry-forward is applied at ALL THREE, with the
same boundary each of the other carry-forwards uses. That is what keeps the
provider-visible prefix byte-stable across every continuation.

## The KEY architectural finding

**The production ALREADY owns a deterministic, idempotent,
boundary-stable carry-forward mechanism.**

`applyVerifiedEvidenceToCompactedMessages()`:

- derives its section from the CANONICAL history AT THE BOUNDARY;
- attaches it to the EXISTING `compaction_summary` message — no second
  message, no provider tool call;
- strips any previously carried section and replaces it, so repeated
  compactions CONVERGE rather than accumulate;
- updates the provider-visible text AND `metadata.summary` together.

That is exactly candidate C's primitive. The ACT therefore did NOT build a new
memory store, a database, a retrieval service or a public protocol. It added
a THIRD section to an existing mechanism.

## The new section

`sdk/packages/core/src/extensions/context/source-bound-evidence.ts`

```
## Source-bound evidence (canonical excerpts, verbatim)
<!-- cline-source-evidence:begin -->
- [OBSERVED_EXCERPT] <source> (succeeded): <the ORIGINAL, bounded, redacted excerpt>
<!-- cline-source-evidence:end -->
```

### Why the model never writes these bytes

This is the whole point of candidate C. The predecessor's
`EVIDENCE_ENHANCED_SUMMARIZATION` put the evidence in the SUMMARIZER's input
and asked the model to compress it. The model then rewrote the observation,
and the rewrite substituted a value from a neighbouring subsystem.

Here the section is assembled by the RUNTIME from the canonical history. The
summarizer never sees the evidence at all, so it cannot rewrite it.

### The admission contract

A fragment reaches a destination only if it passes ALL of:

1. It originates from the FROZEN CANONICAL SOURCE PREFIX.
2. Its source is NOT a known credential-bearing location
   (`isSensitiveSourceFilePath()`, reused unchanged).
3. Its body is BOUNDED before it is redacted, so the sanitizer never sees an
   unbounded input.
4. Its body is REDACTED with the existing value-position sanitizer
   (`sanitizeOutcomeText()`, reused unchanged).
5. It is BOUNDED per fragment (2 000 characters) and per request (12
   fragments).
6. It is framed as DATA — an observation, not an instruction — and the
   section's delimiters are ESCAPED inside the excerpt, so a carried excerpt
   can never close the section and forge a new authority.

The admission is delegated to the existing bounded-evidence contract
(`bounded-evidence-contract/contract.ts`), which owns the shape rule, the
sensitive-path rule, the bound-then-redact order and the runtime-metadata
neutralisation. This ACT did not re-implement any of them.

### The default-OFF containment

`SOURCE_BOUND_EVIDENCE_CARRY_FORWARD_ENABLED = false`

The switch is at the ADMISSION boundary — the extraction is the ONLY route to
a carried excerpt — so it governs EVERY consumer at once. There is no path by
which an excerpt is carried while the switch is off.

This mirrors the existing `SOURCE_FILE_FACT_CARRY_FORWARD_ENABLED = false`
pattern exactly.

### The budget order

The SELECTION happens BEFORE the budget is applied. The budget is spent on
the MOST SELECTIVE evidence, so a decisive observation late in the session is
not crowded out by boilerplate.

Applying the budget first would admit the EARLIEST fragments and report the
rest as budget omissions — which is precisely the defect the predecessor ACT
found in its own projection.

### The idempotence and the boundary stability

- `stripSourceBoundEvidenceSection()` removes any previously carried section
  before a new one is appended, so repeated applications CONVERGE.
- The section is derived from the canonical prefix AT THE BOUNDARY, so
  appending messages to the session does not change it. A re-compaction
  replaces it with the same one rather than accumulating copies.

Both are executable witnesses in `source-bound-evidence.test.ts`.
