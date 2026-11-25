# 02 — The current RED and the GREEN

## 2.1 — The reproduction against the REAL production path

The witness drives the actual evidence-continuity extraction and publication
path — not a helper-only renderer:

```text
createCompactionStateAwarePrepareTurn()
  -> createContextCompactionPrepareTurn({strategy:"agentic"})
  -> the evidence carry-forward
  -> createSessionCompactionState()          [PERSISTED SUMMARY]
  -> MessageBuilder.buildForApi()            [PROVIDER-VISIBLE CONTINUATION]
```

Both destinations are exercised in every adversarial case, and the sentinel
is asserted absent from BOTH.

Classification:

```text
SYNTHETIC_REAL_PRODUCTION_SEAM
```

No real credentials and no external inference requests were used.

## 2.2 — The RED at HEAD

Running the new suite against the UNMODIFIED production module (`git show
HEAD:...evidence-continuity.ts`) gives:

```text
✓ P1: the credential-shaped canonical id is a REAL canonical reference of the session
× P2: the sentinel reaches NEITHER the persisted summary NOR the provider-visible continuation
× P3: the legitimate observation REMAINS present and attributable
× P4: the published reference is a runtime-controlled alias, not a derivative of the canonical id
✓ C1: the INTERNAL canonical identity is unchanged
× C2: distinct canonical identities remain DISTINGUISHABLE, and the cardinality is preserved
× C3: the SAME identity keeps the SAME alias across BOTH destinations and across re-derivation
× C4: references with SIMILAR PREFIXES remain distinguishable
✓ C5: the ASSURANCE is neither promoted nor weakened
× C6: publication cannot MANUFACTURE a reference to an unobserved event
✓ C7: the section is byte-STABLE across re-derivation (the prompt-cache invariant)
✓ C8: the summary is byte-stable across a re-compaction
× A1: no adversarial identifier reaches EITHER destination
× A2: an adversarial identifier's SENTINEL never reaches either destination
× A3: an adversarial TOOL NAME cannot forge a section boundary
× A4: MIXED legitimate and malicious identifiers are handled independently
✓ A5: an UNRESOLVED reference is not carried at all

Tests  11 failed | 6 passed (17)
```

Receipt: `verification/red-a10-reference-trust.txt`.

The failing assertion is the raw-id publication itself:

```text
AssertionError: expected '{"version":1,"updated_at":...' not to contain
  'toolu_01FAKE-CREDENTIAL-DO-NOT-USE-7P…'
```

The published section at HEAD was:

```text
## Verified tool outcomes (canonical record)
<!-- cline-evidence:begin -->
- run_commands (toolu_01FAKE-CREDENTIAL-DO-NOT-USE-7P4xQz): succeeded
<!-- cline-evidence:end -->
```

## 2.3 — The GREEN

With the repair in place:

```text
Tests  17 passed (17)
```

Receipt: `verification/green-a10-reference-trust.txt`.

The published section is now:

```text
## Verified tool outcomes (canonical record)
<!-- cline-evidence:begin -->
- run_commands (ev-0): succeeded
<!-- cline-evidence:end -->
```

## 2.4 — The two defects the ACT repaired

The ACT-owned suite found TWO distinct publication defects, not one.

### Defect 1 — the raw canonical reference (the recovered RED)

`outcome.toolUseId` was published raw.

### Defect 2 — the transcript-supplied tool NAME (found by A3)

`outcome.toolName` was published raw. It is a second transcript-supplied
identifier, and it had TWO forgery channels:

1. **The delimiter channel.** A name containing the section's END marker
   could CLOSE the section early and append text of the producer's choosing.
2. **The line-break channel.** A carried line is a LINE, and the rendered
   section is a sequence of `\n`-separated lines. A name containing a LINE
   BREAK could forge an ADDITIONAL carried outcome — a line the runtime
   never minted, carrying an assurance (`succeeded`) and a reference of the
   transcript-producer's choosing.

Defect 2's second channel was found by the A3 control itself: the control
was written to assert on the RENDERED section, and it failed against the
otherwise-correct escaping. The escaping neutralised the MARKER but not the
LINE BREAK, because the forged content was delivered by the line break
rather than by the marker. This is why the production treatment reduces a
published identifier to a SINGLE LINE.

Both channels are now closed. The A3 control asserts the true property — the
section holds exactly ONE carried outcome line, and the forged text is
present only INLINE, as inert characters of that one real line.

## 2.5 — The causal discriminator

The discriminator changes ONLY reference PUBLICATION. It does not change
evidence ADMISSION and does not change the observation itself.

```text
Ablation A  alias treatment REMOVED (raw canonical id published)
            -> 10 failed | 7 passed (17)

Ablation B  tool-name escaping REMOVED
            ->  1 failed | 16 passed (17)

Ablation C  single-line reduction REMOVED (name escaped, line break kept)
            ->  1 failed | 16 passed (17)

RESTORED    treatment in place
            -> 17 passed (17)
```

Receipt: `verification/necessity-ablation.txt`.

Each ablation is SPECIFIC: removing one treatment fails exactly the
control that covers it, and the other controls still pass. Ablation A
fails the ten publication-confidentiality and conservation controls, which
is the direct demonstration that the raw identifier is what crosses the
boundary.

## 2.6 — The repair

```text
sdk/packages/core/src/extensions/context/evidence-continuity.ts
```

### The alias

```text
ev-0, ev-1, ev-2, ...
```

The alias is a SEQUENCE NUMBER, not a derivative of the canonical id. A
hash of the canonical id would still be a FUNCTION of the id, and a
credential-shaped id is short enough to be brute-forced from a digest — a
keyed MAC would be better than a plain hash, but it would still be a
function of the id, so it would still carry the id's entropy into the
published artifact. A per-publication sequence carries NO information about
the canonical id at all.

### The alias lifetime

PUBLICATION-LOCAL. The alias table is built PER RENDER, so an alias means
nothing outside the section that carries it. This is the correct lifetime,
derived from the ACTUAL consumers:

- a reader of the section, who needs to tell two references APART and to see
  that two references are the SAME; and
- the runtime's own boundary-stable re-derivation, which re-renders the
  section from the SAME canonical prefix and therefore produces the SAME
  aliases.

Nothing resolves an alias back to a canonical id, so NO durable or
cross-session provenance requirement exists — and none was invented. The
contract's prohibition on inventing such requirements is honoured.

### The escape

The tool NAME is published through `escapePublishedIdentifier()`, which
applies the shared delimiter escaping and then reduces the result to a
SINGLE LINE. The command SUBJECTS do not need the single-line treatment:
they are drawn from a FINITE allowlist of classifications, so they are
runtime-owned strings with no line break by construction.

### The rule

> Internal reference identity may remain canonical. Published reference text
> must be runtime-controlled and must not expose arbitrary canonical
> identifier bytes.

Satisfied: the published reference is `ev-<n>`, a runtime-owned constant
followed by a per-render sequence number.

### What was explicitly NOT used

- A credential-pattern regex as the authority for publishability. The
  defect is that an identifier was published at all; no regex can
  distinguish "safe to republish" from "happens to look harmless".
- A hash or truncation of the arbitrary identifier, because it would still
  be a function of the id and would still carry its entropy.
- Discarding all references, because that would satisfy the negative
  confidentiality assertion only by destroying the evidence. The positive
  conservation controls would have failed.
- The adjudication channel's `cline-ev-<hex>` handles, because that
  registry only exists when the OPT-IN adjudication seam is enabled, so its
  contract is not suitable for the unconditional carry-forward.

## 2.7 — No new public API

The alias helpers `mintEvidenceReferenceAlias()` and
`buildEvidenceReferenceAliases()` were initially exported from the module
so that a test could read the rule. The review item was whether that
violated the "no new public API" constraint. It was resolved by
INTERNALISING both helpers: nothing outside the module resolves an alias, so
no consumer needs them, and an exported rule would have created a public
contract this ACT does not authorise.

Only `EVIDENCE_REFERENCE_ALIAS_PREFIX` remains exported, and it is
consumed by the in-package regression suites that assert the SHAPE of the
published reference.

The package barrel (`sdk/packages/core/src/index.ts`) is UNCHANGED, and the
barrel-witness typecheck passes:

```text
WITNESS_EXIT=0
```

## 2.8 — No conflict with an existing consumer

The contract requires halting if existing consumers genuinely require raw
published canonical identifiers. No such consumer exists:

- The published reference is read by the summarizer and by the model, both
  of which need only to distinguish and correlate references.
- The only in-repo consumers of the reference string are the compaction
  regression suites, which were UPDATED to assert the alias shape rather
  than the raw id.
- No durable store, sidecar schema or provider field records the published
  reference.

So no contract was changed and no halt was required.