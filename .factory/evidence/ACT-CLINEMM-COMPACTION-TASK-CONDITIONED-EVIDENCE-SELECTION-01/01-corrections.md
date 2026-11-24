# 01 — The reviewer's mandatory corrections

ACT-CLINEMM-COMPACTION-TASK-CONDITIONED-EVIDENCE-SELECTION-01

All four corrections are executable and are witnessed by a test file.

## C2.1 — The section boundary (RED/GREEN)

### The defect

The predecessor escaped the section's delimiters inside a carried excerpt
with a **backslash prefix**:

```ts
text.split(END_MARKER).join(`\\${END_MARKER}`)
```

and located the section with a **plain `indexOf(END_MARKER)`**.

The escaped marker still **contains** the literal marker, so `indexOf` found
it and the strip terminated the section **inside the carried excerpt**.

A second defect compounded it: the strip removed only the **first** section,
so a duplicated section survived and the carry-forward did not converge.

### The RED reproduction

`source-bound-evidence.section-boundary.correction01.test.ts` — 7 of 11
witnesses FAILED against the predecessor:

```
× reproduces the predecessor's stripRestoresBase=false /
  canarySurvivesStrip=true / idempotent=false
× does not let an escaped BEGIN marker open a second section
× does not let an escaped END marker close the section early
× escapes BOTH markers when both are present
× removes a section that carries a forged END marker and keeps the rest
× removes EVERY copy of the section, not just the first
× converges when the same evidence is applied to a doubled summary
```

### The repair

A NEW shared primitive, `sdk/packages/core/src/extensions/context/section-delimiters.ts`:

| Element | Contract |
|---|---|
| `SECTION_DELIMITER_ESCAPE_PREFIX` | U+200B (zero-width space) |
| `escapeSectionDelimiters(text, markers)` | the WRITER |
| `findUnescapedMarker(text, marker, from)` | the READER — skips escaped occurrences |
| `findLastUnescapedMarker(...)` | the backwards reader |
| `stripAllDelimitedSections(...)` | removes EVERY copy |
| `joinStrippedSection(...)` | joins without a doubled separator |

The reader also treats the **legacy backslash** prefix as escaped, because
persisted state written by the predecessor build still exists.

The SAME defect existed in the two SIBLING sections in `evidence-continuity.ts`
(`cline-evidence` verified-outcomes and `cline-file-facts`). Both were
repaired to the shared primitive, so the three cannot drift apart again.

### The GREEN

11 of 11 pass, covering: the reviewer's counterexample, escaped BEGIN,
escaped END, both markers, a truncated section, an unrelated summary, a
forged END marker with legitimate trailing content, duplicate sections,
convergence across three applications, and replacement of a different section.

## C2.1 — The revocation witnesses

`source-bound-evidence.revocation.correction01.test.ts`.

### The defect

The seam returned **early** when the current admission produced no fragments:

```ts
if (summaryIndex === -1 || report.admitted.length === 0) {
    return { messages: [...compactedMessages], applied: false, ... };
}
```

That early return **never stripped the section**. A summary that already
carried evidence kept carrying it — after the switch was turned off, and
after the selection became empty.

### The RED reproduction

4 of 8 witnesses FAILED against the predecessor:

```
× removes the previously carried section when the switch is turned OFF
× removes the previously carried section when the payload becomes confidential
× removes the previously carried section when the selection becomes empty
× removes the previously carried section when the canonical prefix is empty
```

### The repair

The strip is now **UNCONDITIONAL**: the section is removed and re-added only
when there is something to carry. The current admission result is the only
authority on what may be published, and an **absent result revokes**.

The default-OFF witnesses passed before and after.

## C2.2 — The measurement correction

See `02-measurement-correction.md`.

## C2.3 — The projection witness

`task-conditioned-evidence-selection.projection.correction01.test.ts` — 3 of 3 pass.

- The state is built by the **production constructor** over the SAME prefix
  the boundary names, so its identity is internally consistent **by
  construction**.
- The production projector **ACCEPTS** it. An `undefined` projection would
  be a **REFUSAL**, and the witness asserts the refusal is visible as
  `undefined` so it can never be confused with an empty successful
  continuation.
- The FORBIDDEN construction — build over the FULL history, then overwrite
  only `source_message_count` — is asserted to be **REFUSED**.
- The negative control distinguishes the **prefix-derived** content (the
  summary and the carried section, byte-identical) from the **retained tail**
  (legitimately different, because the contaminated history has two more
  messages after the boundary).

## C2.4 — The scoring scope

`knowledge-loss-discriminator/scoring-scope.correction01.test.ts` — 6 of 6 pass.

### What the inspection found

The scorer evaluated **only `generatedSummary`**, and the decomposition that
produced `generatedSummary` did **not** strip the SOURCE-BOUND EVIDENCE
section. Two distinct errors followed:

1. **ATTRIBUTION.** The carried section's verbatim bytes were credited to
   the MODEL.
2. **MASKING** — the more serious one. The factual-consistency scorer runs
   over `generatedSummary`. A summarizer that WROTE A CONTRADICTION could
   have that contradiction sit next to a carried excerpt stating the CORRECT
   value, and the check would see the correct value and report `CONSISTENT`.
   The carried section would **hide** the summarizer's own distortion — which
   is exactly the failure mode this ACT exists to detect.

### The repair

- `generatedSummaryProse()` now strips the source-bound evidence section.
- The section is its **own supply mechanism** (`source_bound_evidence`) in
  `KnowledgeContext` / `SUPPLY_MECHANISMS`, so the attribution is correct.

### The decisive witness

The masking witness uses the **historical RED fixture verbatim**:

```
R2: Phone-notification senders use hardcoded/default connect/socket timeouts,
    e.g. `NotificationServiceClient` defaults `500 ms` / `1500 ms`
```

With the carried section stating `DEFAULT_SOCKET_TIMEOUT_MILLIS = 1000`,
the model's own bytes now score `DISTORTED` — the carried section no longer
masks it.
