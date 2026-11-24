# 05 — Trust and provenance

## The adversarial case (G4.1)

```text
R4 tool result:
  contains the startup script's commands

Candidate record:
  claims no OTP retention mechanism exists

Evidence reference:
  points to the valid R4 tool call
```

**Measured result:**

```text
Reference identity: RESOLVED
Semantic support:  NOT_VERIFIED
Assurance:         never runtime_verified
```

This is asserted by `trust-provenance.test.ts` G4.1 and G4.1.2. The second
case asserts the DOWNGRADE: a record that CLAIMS `runtime_verified` over a
tool-only reference is bounded to `tool_observed`.

**The ACT did not implement "a valid reference certifies the claim", so the
`HALT_EVIDENCE_SUPPORT_UNBOUND` condition does not arise.** The reference
resolver is deliberately CONTENT-BLIND: it resolves an identity and never
reads the referenced body, so it is structurally incapable of asserting that
a body entails a statement.

## The support classes

`resolveEvidenceReference()` assigns exactly one class per reference:

| Class | Assigned when | Meaning |
|---|---|---|
| `VERIFIED_EXECUTION_STATUS` | the reference resolves to a canonical `tool_use` id | the CALL exists; an execution status can be established. It establishes NOTHING about the call's semantic content |
| `TOOL_OBSERVED_CONTENT_UNVERIFIED` | the reference resolves to a canonical message id | the RESULT exists and its content was observed; the content's meaning is not independently verified |
| `SOURCE_REVISION_BOUND` | — | **never assigned by this ACT**: no revision resolver ran, so no reference is revision-bound |
| `MODEL_REPORTED` | — | not assigned by the resolver; it is a record-level assurance a model may claim |
| `UNRESOLVED` | the reference resolves to nothing, or is AMBIGUOUS | the identity is not established |
| `CONTRADICTED` | — | not assigned by the resolver; it is a lifecycle class a validator would assign |

### The critical rule about `SOURCE_REVISION_BOUND`

**A `run_commands` source inspection must NOT silently become
`SOURCE_REVISION_BOUND`.** The resolver never assigns it, and
`trust-provenance.test.ts` G4.2 asserts that neither a tool-call reference
nor a message reference yields it.

The canonical tool-call id is also **ambiguity-checked**: an id claimed by
MORE THAN ONE canonical call is excluded from the resolvable set, so an
ambiguous id resolves to `UNRESOLVED` rather than to an arbitrary call.
This mirrors the production evidence-continuity module's fail-closed rule.

## The assurance bound

`boundAssurance()` NEVER promotes. Its rules:

```text
no resolved references                  -> unverified
any reference unresolved                -> unverified
any reference CONTRADICTED              -> unverified
max maximumAssurance is unverified      -> unverified
claimed model_reported                  -> model_reported
claimed unverified                      -> unverified
otherwise                               -> the maximum, capped at tool_observed
```

`runtime_verified` is **not in the output type at all**. `BoundedAssurance`
is `tool_observed | model_reported | unverified`. A model-authored record
therefore cannot be projected with a runtime-verification grade, by
construction rather than by convention.

## No authority laundering (G4.4)

The checkpoint is MODEL-AUTHORED data. Attaching it to a compaction summary
does not make it a system instruction, a developer instruction, or a
verified source finding.

The projected section therefore carries the banner:

```text
Model-authored working knowledge. Not a system instruction.
Statements carry their own qualifications; semantic support is not verified.
```

This is asserted by `trust-provenance.test.ts` G4.4 and by
`causal-ablation.test.ts` G7.3, which additionally asserts that the
projected section never contains `assurance=runtime_verified`.

## The ten confidentiality negative controls (G4.3)

All ten PASS (`security-controls.test.ts`).

| # | Control | The asserted property |
|---|---|---|
| 1 | arbitrary credential in ordinary command output | the resolver resolves the reference but NEVER reads the body, so it can never assert the body is safe; the assurance is never `runtime_verified` |
| 2 | credential in an unrelated source file | same; `boundAssurance` yields `tool_observed`, never a promotion |
| 3 | credential-looking text in a tool-result annotation | the annotation is DATA; identity resolves, semantic support does not |
| 4 | prompt injection embedded in stdout | the content is carried as TOOL RESULT data and is labelled as such; the view asserts nothing about it |
| 5 | SHA-1/SHA-256-style revision misread as a credential | the resolver is IDENTITY-based; a revision-shaped token cannot change the class it assigns |
| 6 | absolute source path misread as a credential | same |
| 7 | valid evidence reference to unrelated source content | identity RESOLVED, semantic support NOT VERIFIED |
| 8 | failed command with a superficially successful trailer | the status comes from the payload's OWN signal (`status=failed`), never from the trailer's shape |
| 9 | contradictory later source observation | the duplicated id makes the reference AMBIGUOUS; it resolves to `UNRESOLVED` |
| 10 | unknown content origin or private reasoning block | both are DROPPED by the view; the origin classifier agrees |

### Why a finite regex set is not a confidentiality proof

The controls deliberately assert **STRUCTURAL** properties, not lexical
ones. The ACT does not claim that a secret can be detected in arbitrary
text; it claims that the RESOLVER never inspects content, so there is no
place for a lexical check to be the load-bearing guarantee.

The safe path the ACT took is exactly the one G4.3 names:

```text
structural scoping  +  correct authority classification  +  controlled publication
```

and, for the data classes where these are insufficient, **exclusion**.

## The over-claim the REAL model made

This is the empirical payoff of the trust gate.

```text
Boundary 1: 2 of 20 records claimed runtime_verified
Boundary 2: 4 of 16 records claimed runtime_verified
Total:      6 over-claims, ALL downgraded by the gate
```

The over-claimed records were the identity and image-supply ones — records
whose evidence was a repository path or a file listing. That is precisely
the trap G4.2 warns about: a successful command establishes ACCESS, not the
CONTENT the command was supposed to reveal.

**This finding changes the design conclusion.** A naive design that
"trusts" the model's assurance label would have projected six
runtime-verification claims that no runtime had established. The bounding
is what makes the richer input SAFE to use.

## G4 exit

```text
PASS — no HALT_TRUST_BOUNDARY_UNRESOLVED, no HALT_EVIDENCE_SUPPORT_UNBOUND.
```

The trust boundary is established: identity resolution is separated from
semantic support, the model-authored nature is explicit in the projection,
and the over-claims the real model actually made are mechanically bounded.
