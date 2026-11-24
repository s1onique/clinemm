# ACT-CLINEMM-PCK-EVIDENCE-FIRST-INPUT-RECON-01 — C5 trust-boundary conservation

## THE CLAIM UNDER TEST

> A reduced input view is NOT a replacement for the canonical publication
> authority.

The candidates change WHAT THE MODEL SEES. They must never change what the
gate ACCEPTS. The witnesses are at
`sdk/packages/core/src/extensions/context/precompaction-knowledge-checkpoint/pck-input-candidates.recon.test.ts`.

```text
C5 TRUST-BOUNDARY CONSERVATION: 8/8 PASS
```

## THE WITNESSES

| Witness | What it establishes |
| --- | --- |
| **C5.1** | NO candidate carries PRIVATE REASONING. The sentinel `SECRET-PRIVATE-REASONING-MUST-NEVER-BE-CARRIED` appears in none of B, C or D, and neither does the block type name. |
| **C5.2** | A private-reasoning-only message is classified `private_only` and is EXCLUDED from the candidates' selection, and it contributes no observation. |
| **C5.3** | The gate still REJECTS a reference the runtime did not observe (`call_DOES_NOT_EXIST` → `REFERENCE_NOT_CANONICAL`, 0 records). The MEMBERSHIP check is computed from the CANONICAL history, not from the candidate's view. |
| **C5.4** | A FAILED tool result can never establish an observation: the ceiling for `call_failed_1` is not `tool_observed`. |
| **C5.5** | The deterministic candidate never claims a FAILED operation: exactly ONE record, resting on the SUCCESSFUL `call_build_1`. |
| **C5.6** | The deterministic candidate's records PASS the PRODUCTION gate — they are not a bypass. The gate admits 1 record at `tool_observed` with **zero** reason codes. |
| **C5.7** | The deterministic candidate is EMPTY when the runtime establishes nothing: remove the successful `make build` event and the candidate yields **0** records. It does not manufacture one. |
| **C5.8** | The reduced candidates NEVER carry raw tool OUTPUT. The bodies `build finished` and `permission denied` appear in neither B nor C — only the runtime-owned STATUS is carried. |

## THE TWO PROPERTIES THE ACT NAMED EXPLICITLY

### "OMITTED CONTRADICTORY OR SUPERSEDING EVIDENCE CANNOT CREATE FALSELY STRENGTHENED CLAIMS"

This holds, and the mechanism is structural rather than procedural: the
assurance ceiling is computed by `interpretCanonicalEvidence()` against the
**CANONICAL history**, which is the complete, unreduced history. The
candidate's view is never consulted when the bound is computed. A candidate
can therefore omit evidence, but it cannot thereby *acquire* assurance:
omission can only ever leave the bound unchanged or make the model's claim
exceed it — and the gate DOWNGRADES an exceeding claim rather than
promoting it.

Witness C5.5 and C5.7 together establish the contrapositive directly: the
deterministic candidate produces a record only where the runtime
establishes it, and produces nothing where it does not.

### "A REDUCED INPUT VIEW IS NOT A REPLACEMENT FOR THE CANONICAL PUBLICATION AUTHORITY"

Every candidate's output was passed through the EXISTING production
`gateClosedProposals()` with the EXISTING production
`interpretCanonicalEvidence()`. No candidate has its own gate, and no
candidate output reaches a destination except through the production gate's
output.

## CONFIDENTIALITY AND PROMPT-INJECTION RESISTANCE

- The candidate headers (`--- FULL SESSION TRANSCRIPT ---`, etc.) are
  RUNTIME-OWNED constants.
- Candidate D's rendered records consist entirely of runtime-owned
  vocabulary.
- The candidates carry NO raw tool output (C5.8), so a tool-result-borne
  prompt injection has no verbatim carrier into a candidate's observation
  section. The supporting excerpts DO carry public assistant and user text,
  which is the same text the production input view already carries — so the
  injection surface is not widened by the reduction.
- The raw model outputs remain in the gitignored tree and are never
  committed.

## WHAT IS NOT CLAIMED

The witnesses are `SYNTHETIC_REAL`: they drive the EXISTING production gate
and interpreter over production-shaped fixtures. They are NOT an
installed-live qualification, and they do not qualify the live endpoint's
own behaviour.
