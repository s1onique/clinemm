# 02 — P0-2: the canonical reference confidentiality

```text
FINDING:      PCK_REFERENCE_CONFIDENTIALITY_UNPROVEN
STATUS:       RED_REPRODUCED_AND_GREEN
RED:          REPRODUCED  (receipt: verification/red-reference-confidentiality.txt)
GREEN:        CONFIRMED  (receipt: verification/act-owned-tests.txt)
```

## 2.1 — The discriminator, as the review specified it

```text
1. Put a synthetic credential-shaped value into an otherwise valid
   canonical tool-call id.
2. Reference that id in an otherwise valid closed proposal.
3. Exercise the ACTUAL publication gate and projection.
4. Inspect the persisted summary and the provider-visible continuation.
```

The synthetic id:

```text
toolu_01FAKE-CREDENTIAL-DO-NOT-USE-7P4xQz
```

It is OPAQUE and keyword-free apart from the explicit DO-NOT-USE marker,
so no content scanner would catch it, and it satisfies every shape rule a
reference might have. It is NOT a real credential.

The discriminator drives the REAL production compaction seam
(`createCompactionStateAwarePrepareTurn` ->
`createContextCompactionPrepareTurn({strategy:"agentic"})` -> the REAL
persistence builder -> the REAL provider projection), not a test-local
substitute.

## 2.2 — The RED

```text
× P0-2.2: the RAW canonical id does NOT reach the persisted summary OR the
  provider-visible continuation
  AssertionError: expected '{"version":1,"updated_at":"2026-11-24…' not to
  contain 'toolu_01FAKE-CREDENTIAL-DO-NOT-USE-7P…'
```

The published section was:

```text
<!-- cline-knowledge-checkpoint:begin -->
pck-0: kind=observation assurance=tool_observed status=active
statement=operation invoked: build
evidence_refs=toolu_01FAKE-CREDENTIAL-DO-NOT-USE-7P4xQz
<!-- cline-knowledge-checkpoint:end -->
```

**REFERENCE_CONFIDENTIALITY: RED_REPRODUCED**

The raw identifier reached BOTH the persisted summary and the
provider-visible continuation.

## 2.3 — The correction

The review's own instruction:

> *"Use host-minted opaque reference aliases or omit raw identifiers from
> rendered publication."*

The correction implements the FIRST option: **host-minted opaque reference
aliases**.

### The alias

```text
ref-0, ref-1, ref-2, ...
```

The alias is a SEQUENCE NUMBER, not a derivative of the canonical
identifier. A hash of the canonical id would still be a function of the id,
and a credential-shaped id is short enough to be brute-forced from a
digest. A per-publication sequence carries NO information about the
canonical id at all.

### The alias table

The table is PER GATE CALL, so an alias means nothing outside the
checkpoint that carries it:

```text
canonical reference  ->  host-minted alias
tool_call_r4         ->  ref-0
id:msg_call         ->  ref-1
```

The published record carries ONLY the alias. The raw canonical identifier
never reaches the renderer, so it cannot reach the persisted sidecar or
the provider-visible continuation.

### What is preserved

The record keeps its provenance HANDLE: `evidence_refs=ref-0` still tells a
reader that the record rests on a specific canonical event, and the
per-publication alias table still binds that handle to the exact
canonical reference inside the host.

## 2.4 — A SEPARATE, PRE-EXISTING exposure is recorded, not hidden

The discriminator's RED output also revealed that the PRE-EXISTING
evidence-continuity carry-forward renders the canonical tool-call id too:

```text
## Verified tool outcomes (canonical record)
<!-- cline-evidence:begin -->
- run_commands (toolu_01FAKE-CREDENTIAL-DO-NOT-USE-7P4xQz): succeeded
<!-- cline-evidence:end -->
```

That mechanism is:
- PRE-EXISTING — it shipped before this ACT,
- SEPARATE — it is not the PCK's publication channel, and
- OUT OF SCOPE — this ACT is a bounded PCK correction, not a repair of the
  evidence-continuity module.

The discriminator therefore ISOLATES the PCK's own section (by its
runtime-owned markers) and asserts the absence of the raw id there.
P0-2.3 records the pre-existing exposure as an OBSERVED FACT so it is not
mistaken for something the PCK introduced, and not silently claimed away.

**This is a P2 follow-up for the evidence-continuity module. It is NOT
attributed to the PCK, and it does not block the PCK correction.**

## 2.5 — The GREEN

```text
✓ P0-2.1: the credential-shaped id IS a canonical reference of the session
✓ P0-2.2: the RAW canonical id does NOT reach the persisted summary OR the
  provider-visible continuation
✓ P0-2.3: the PRE-EXISTING evidence-continuity section is a SEPARATE
  exposure
```

**REFERENCE_CONFIDENTIALITY: RED_REPRODUCED_AND_GREEN**

The discriminator still proves the precondition (P0-2.1): the identifier
really IS in the session's own canonical history, so membership admits it.
The pass is therefore a property of the RENDERING, not of a feature that
silently did nothing.
