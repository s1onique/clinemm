# 01 — The production publication boundary

## 1.1 — The recovered predecessor RED

The A10 witness was preserved by the PCK output-trust and closed-publication
campaigns, at:

```text
.factory/evidence/ACT-CLINEMM-PCK-CLOSED-PUBLICATION-IMPLEMENT-01-CORRECTION01/02-p0-2-reference-confidentiality.md
```

That document records the defect as an OBSERVED FACT rather than as
something the PCK introduced:

```text
## Verified tool outcomes (canonical record)
<!-- cline-evidence:begin -->
- run_commands (toolu_01FAKE-CREDENTIAL-DO-NOT-USE-7P4xQz): succeeded
<!-- cline-evidence:end -->
```

The PCK campaign classified it as PRE-EXISTING, SEPARATE and OUT OF SCOPE
for that ACT, and named it a P2 follow-up for the evidence-continuity
module. This ACT is that follow-up. No new vulnerability was invented.

The synthetic identifier used by the witness — and reused here — is:

```text
toolu_01FAKE-CREDENTIAL-DO-NOT-USE-7P4xQz
```

It is OPAQUE and keyword-free apart from the explicit DO-NOT-USE marker, so
no content scanner would catch it. It is NOT a real credential.

## 1.2 — The boundary map

### The canonical reference's ORIGIN

The canonical tool-call id is written by the transcript producer into the
`tool_use` block's `id` field. It is the JOIN KEY between a tool call and
its tool result, and it is an arbitrary byte string supplied by whoever
produced the transcript.

### The production EXTRACTION SEAM

```text
extractVerifiedToolOutcomes(canonicalMessages) -> VerifiedOutcomeLedger
```

This is where a canonical tool-call / tool-result PAIR is matched, admitted,
and classified. The admission rules (fail-closed on ambiguity, no success
signal, payload disagreement) are UNCHANGED by this ACT.

### The INTERNAL identity consumers

| Consumer | Field | Status |
|---|---|---|
| The call/result join | `toolUseId` | UNCHANGED — still the canonical id |
| The outcome record | `VerifiedToolOutcome.toolUseId` | UNCHANGED — still canonical |
| The rejection ledger | `RejectedVerifiedOutcome.toolUseId` | UNCHANGED — still canonical |

### The RENDERING seam — THE DEFECT

```text
renderEvidenceSection(ledger) -> string | undefined
```

Before the repair, the rendered line was:

```typescript
const line = `- ${outcome.toolName} (${outcome.toolUseId}): succeeded${suffix}`;
```

Both `outcome.toolUseId` (the canonical identifier) and `outcome.toolName`
(a second transcript-supplied identifier) were published RAW.

### The PERSISTENCE destination

```text
createSessionCompactionState(...) -> the persisted compaction summary
```

### The PROVIDER-VISIBLE destination

```text
MessageBuilder.buildForApi(...) -> the provider-visible continuation
```

### The EXISTING reference validation / aliasing / sanitization

- `sanitizeOutcomeText()` — a value-position sanitizer for tool OUTPUT. It
  was NEVER the publication authority for identifiers, and this ACT does not
  make it one.
- `escapeSectionDelimiters()` / `findUnescapedMarker()` — the shared
  delimiter primitive in `section-delimiters.ts`. It protects the SECTION
  BOUNDARY, not the reference TEXT.
- The PCK's own `mintReferenceAlias()` (`ref-0`, `ref-1`, ...) — a
  publication-local sequence alias on a DIFFERENT channel.
- The adjudication channel's `cline-ev-<hex>` handles — an OPT-IN registry,
  unsuitable for the unconditional carry-forward.

The sanitizer was explicitly NOT treated as the publication authority. The
sanitizer is a content-shape tool; the defect is that an IDENTIFIER was
published at all.

## 1.3 — The internal identity vs the externally published representation

The contract requires these two to be DISTINGUISHED. They are:

| | Internal identity | Published representation |
|---|---|---|
| Value | the canonical tool-call id | a publication-local alias |
| Owner | the canonical session history | the runtime, per render |
| Lifetime | the session | the rendered section |
| Purpose | join, attribution, rejection reporting | telling two references apart, and showing two references are the same |
| Bytes | arbitrary, transcript-supplied | runtime-controlled, content-free |

Only the SECOND column changes. The first column is untouched.