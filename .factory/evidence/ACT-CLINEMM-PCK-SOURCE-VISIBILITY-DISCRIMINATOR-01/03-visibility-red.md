# 03 — The source-visibility RED

```text
RED_REPRODUCED: YES
EXIT: RED_SOURCE_VISIBILITY_REPRODUCED
```

The RED is reproduced against the EXACT frozen inputs and the checked-out
production seam. The ACT's own measurement corrected two of the
predecessor's witness definitions; both corrections are recorded below.

## The non-vacuity matrix

```text
                                    R4 cmd pair   R2 impl content   R6 result body
Canonical evidence:                  PRESENT       PRESENT           PRESENT
Working-agent input (candidate B):   PRESENT       PRESENT           PRESENT
Ordinary summarizer input (A):       MISSING       MISSING           MISSING
Checkpoint baseline input (predecessor's A): MISSING MISSING          MISSING
```

Every one of these rows is asserted by a test in
`visibility-red.test.ts`. The tests are **non-vacuous in both directions**:

- they assert the canonical evidence IS present (a precondition, so a later
  absence is a LOSS and not a never-observed fact);
- they assert the ordinary view does NOT carry the detail — and that
  assertion **FAILS** if the production serializer unexpectedly begins
  preserving it.

## R2 — implementation-specific partial progress

The historical investigation identified the MTS Omni and Megafon provider
implementations. Later evidence included a partial assessment of circuit
breakers and timeouts.

The required distinctions:

```text
Observed:
  implementation identifiers and inspected source/output

Provisional:
  implications for timeout/fallback behavior

Unresolved:
  whether the complete production path is protected
```

**The ACT's correction.** The predecessor reported the bare identifier
`MtsOmni` as lost. It is NOT lost — it survives via the tool CALL's command
line, which `formatToolInput()` renders in full. What is lost is the
**inspected implementation content**:

```text
phone-providers/keycloak-sms-provider-megafon/.../MegafonSmsSenderServiceProvider.java:107:
                    .connectTimeoutMillis(3_000)
phone-providers/keycloak-sms-provider-megafon/.../MegafonSmsSenderServiceProvider.java:108:
                    .socketTimeOutMillis(10_000)
```

**Measured:**

| | `connectTimeoutMillis(3_000)` |
|---|---|
| canonical prefix (boundary 2) | PRESENT |
| ordinary summarizer view (A) | **MISSING** |
| working-agent view (B) | PRESENT |
| provider-visible BEFORE compaction | PRESENT |
| provider-visible AFTER compaction, non-reasoning text | **MISSING** |
| provider-visible AFTER compaction, INCLUDING reasoning | present — inside a `reasoning` block ONLY |

The last row is the subtlety that a naive measurement would get wrong. The
historical `second-post.json` does contain the token, but the model
re-derived it in its PRIVATE reasoning; the TOOL OBSERVATION is gone. The
ACT's `providerVisibleNonReasoningText()` excludes the `reasoning` channel
so the measurement reports the truth.

## R6 — the bounded negative observation

The historical statement was:

```text
No delete/purge found in those paths.
```

It was expressed in a **thinking block**. It must NOT be reproduced by
extracting that private reasoning into the checkpoint.

**What the ACT establishes instead.** The statement's UNDERLYING evidence is
non-private and tool-observable. The grep over the provider JPA and
authentication Java sources plus the Liquibase changelog directory for
`delete|purge|retention|cleanup|expired` produced an EMPTY match set, whose
tool-result body is:

```text
=== changelog retention ===
```

That body is a canonical `tool_result`. It is visible to the working-agent
view and invisible to the ordinary view.

**Measured:**

| | exact English sentence | empty-match-set result body |
|---|---|---|
| canonical prefix (boundary 2) | thinking block only | PRESENT (tool_result) |
| ordinary summarizer view (A) | MISSING (thinking dropped) | MISSING (`[result omitted]`) |
| working-agent view (B) | MISSING (thinking dropped) | PRESENT |

**Conclusion:** the exact sentence is `UNAVAILABLE_FROM_TRACE` for
republication without copying private reasoning — and the ACT does NOT copy
it. But the bounded negative IS supportable from non-private evidence, so
the proper conclusion is available:

```text
No matching purge was observed in the inspected scope.
External or database-side mechanisms remain unresolved.
```

**The model's ACTUAL published record (boundary 2, real model response):**

- kind: `observation`, assurance: `tool_observed`, status: `active`
- it states that a bounded repository search found no application-level
  DELETE, purge, or retention job for the token-code table;
- its qualification states that this supports absence of an
  application-managed mechanism in the inspected repository, **not** absence
  of external database cleanup or actual production growth, and that row
  counts and external scheduled maintenance remain unknown.

The model produced a FRESH, bounded, qualified conclusion **without** the
private reasoning block. That is exactly the ACT's requirement.

**Classification:** `BOUNDED_NEGATIVE_PUBLISHED` — not
`LIVE_UNOBSERVABLE`, because non-private evidence does support it.

## The three witness classes are different, and the ACT keeps them different

| Witness | Class | Where it lives | Ordinary view | Working-agent view |
|---|---|---|---|---|
| R4 | observed source fact | tool_result body | MISSING | PRESENT |
| R2 | inspected implementation content | tool_result body | MISSING | PRESENT |
| R6 | bounded negative | tool_result body (empty match set) | MISSING | PRESENT |
| R6 (exact wording) | private reasoning | thinking block | MISSING | MISSING — and MUST stay missing |

## The RED witnesses

```text
earliest_loss_boundary:
  R4  -> L2 (renderStructuredToolPayload), at BOTH boundaries
  R2  -> L2 (renderStructuredToolPayload), at BOTH boundaries
  R6  -> L2 for the evidence, L1 (thinking drop) for the exact wording,
         at boundary 2

L1 = buildBudgetProjection(policyIntent: "agentic_summary")
     sdk/packages/core/src/extensions/context/budget-projection/project.ts
L2 = renderStructuredToolPayload()
     sdk/packages/core/src/extensions/context/compaction-shared.ts
```

Both L1 and L2 are EXISTING, DELIBERATE contracts. **This ACT did not change
either.**

## R4 — the concrete source observation

The canonical tool result is a `run_commands` payload:

```text
query:  cd .../keycloak && cat startup.sh && cat Dockerfile.roz | head -60
result: #!/bin/bash
        set -e # Exit immediately if a command exits with a non-zero status

        /opt/keycloak/bin/kc.sh build

        # Execute the main container process using the free arguments passed to Docker
        exec /opt/keycloak/bin/kc.sh start --optimized "$@"
success: true
```

The required distinctions:

```text
Tool observed:
  both commands

Not independently proven:
  configuration drift
  unsafe effective configuration
  deployment incident
```

**Measured:**

| | `kc.sh build` | `start --optimized` |
|---|---|---|
| canonical prefix (boundary 1) | PRESENT | PRESENT |
| ordinary summarizer view (A) | MISSING | MISSING |
| working-agent view (B) | PRESENT | PRESENT |
| dedicated evidence view (C) | PRESENT | PRESENT |
| provider-visible BEFORE compaction | PRESENT | PRESENT |
| provider-visible AFTER compaction (boundary 1) | — | **MISSING** |
| provider-visible AFTER compaction (boundary 2) | — | **MISSING** |

The exact loss seam is `renderStructuredToolPayload()`, which renders the
structured payload as:

```text
[succeeded] #1: [result omitted]
```

The ACT asserts that marker is present in the ordinary view (so the seam is
pinned positively) and that the working-agent view does NOT contain it.
