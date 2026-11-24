# 01 — The publication boundary map

```text
ACT: ACT-CLINEMM-PCK-OUTPUT-TRUST-BOUNDARY-01
ENTRY_HEAD: 0f111f3d76a7e7da9b792cfd173d88635156182c
```

## 1.1 — The complete path a model-authored checkpoint string can travel

Every transition is annotated with **REAL** (a production function) or
**TEST-LOCAL** (a composition owned by the predecessor ACT's measurement
modules). The ACT does not describe a test-local composition as an installed
production feature.

```text
Tool result / public assistant text
   |
   v
[1] Checkpoint input view
      buildCandidateA / buildCandidateB / buildCandidateC
      source-visibility-discriminator/candidate-views.ts
      TEST-LOCAL (predecessor's measurement module)
      |
      v
[2] Checkpoint model response
      the model emits a JSON document with free-text `statement`
      and `qualifications[]`
      REAL_MODEL_RESPONSE (predecessor: MiniMax-M3, 2 calls)
      |
      v
[3] JSON parsing / schema validation
      parseCheckpointDocument()
      knowledge-checkpoint-probe/checkpoint-validation.ts
      TEST-LOCAL (predecessor PCK probe)
      |  accepts arbitrary `statement` and `qualifications[]` strings
      |  bounds length (240 chars) and count (3) — SIZE limits, not
      |  confidentiality controls
      v
[4] Canonical reference resolution
      resolveEvidenceReference()
      source-visibility-discriminator/trust.ts
      TEST-LOCAL (predecessor's measurement module)
      |  content-blind by construction
      |  identityResolved:true  !=  semanticSupportVerified:true
      v
[5] Assurance bounding
      boundAssurance()
      source-visibility-discriminator/trust.ts
      TEST-LOCAL (predecessor's measurement module)
      |  downgrades a model-claimed `runtime_verified` to `tool_observed`
      |  NEVER promotes
      v
[6] Record selection
      selection.ts (predecessor)
      TEST-LOCAL
      |
      v
[7] renderCheckpointSection()
      source-visibility-discriminator/projection.ts:84
      TEST-LOCAL — REAL EXPORTED FUNCTION, exercised by this ACT's RED
      |  NO publication gate on this path
      v
[8] Compaction summary
      applyCheckpointSectionToSummary()   projection.ts:154
      applyCheckpointToCompactedMessages() projection.ts:221
      TEST-LOCAL
      |
      +--> [9] persisted sidecar
      |      createSessionCompactionState()
      |      sdk/packages/core/src/session/models/session-compaction.ts:181
      |      REAL — the production persistence builder
      |      the sidecar schema is unchanged by this ACT
      |
      +--> [10] provider-visible continuation
             MessageBuilder.buildForApi()
             sdk/packages/core/src/session/services/message-builder.ts:219
             REAL — the production provider-request preparation seam
```

### 1.1.1 — What is REAL and what is TEST-LOCAL

The **predecessor's projection is TEST-LOCAL**. It is not an installed
production feature. The two destinations it feeds — the persistence builder
and the provider-request seam — are REAL production functions.

This distinction matters for the verdict: the ACT establishes that the
*test-local* projection is unsafe **as a contract proposal**, and it
establishes which REAL seams a repaired projection would have to traverse.
It does NOT claim that a live installed Cline currently leaks a secret
through this path, because the projection is not installed.

## 1.2 — Field classification (G1.1)

```text
FIELD             SOURCE_OWNER                 TRUST_LEVEL                   VALIDATION_OWNER            ALLOWED_VALUES                                   PERSISTENCE_DESTINATION       PROVIDER_VISIBILITY
id                MODEL_AUTHORED               MODEL_AUTHORED_FREE_TEXT      NONE                        arbitrary text                                  PERSISTED_COMPACTION_STATE    VISIBLE
kind              MODEL_SELECTED_CLOSED_SET    RUNTIME_VALIDATED_ENUM        HOST (closed enumeration)    observation|hypothesis|decision|constraint|open_question  PERSISTED_COMPACTION_STATE    VISIBLE
assurance         RUNTIME_BOUNDED              RUNTIME_VALIDATED_ENUM        HOST (boundAssurance)        tool_observed|model_reported|unverified            PERSISTED_COMPACTION_STATE    VISIBLE
status            MODEL_SELECTED_CLOSED_SET    RUNTIME_VALIDATED_ENUM        HOST (closed enumeration)    active|superseded|unresolved                    PERSISTED_COMPACTION_STATE    VISIBLE
statement         MODEL_AUTHORED               MODEL_AUTHORED_FREE_TEXT      NONE                        arbitrary text                                  PERSISTED_COMPACTION_STATE    VISIBLE
qualifications[]  MODEL_AUTHORED               MODEL_AUTHORED_FREE_TEXT      NONE                        arbitrary text                                  PERSISTED_COMPACTION_STATE    VISIBLE
evidenceRefs[]    MODEL_SELECTED_CANONICAL_SET OPAQUE_CANONICAL_REFERENCE    HOST (identity only)         canonical tool-call id or id:<message id>        PERSISTED_COMPACTION_STATE    VISIBLE
```

The table is a DOCUMENTED CONSTANT in
`output-trust-boundary/publication-gate.ts`
(`CHECKPOINT_FIELD_CLASSIFICATION`), asserted by this ACT's test suite so it
cannot drift from the implementation.

### 1.2.1 — Source attribution is NOT declassification

A model statement that cites a canonical tool result remains
`MODEL_AUTHORED_FREE_TEXT`. The reference resolver is content-blind by
construction: it can establish that a reference IDENTIFIES something that
exists, and never whether the identified content SUPPORTS a statement — and
never whether that content may be REPRODUCED.

The two questions are independent, and the ACT proves it:

```text
Tool output was observed  !=  Tool output is safe to reproduce
```

This is measured, not asserted: the RED in `02-confidentiality-red.md` shows
a candidate that cites a VALID, SUCCESSFULLY EXECUTED canonical reference and
whose statement copies the referenced result's secret. The reference resolves;
the semantic support is not verified; and the secret is published.

## 1.3 — The three confidentiality destinations (G1.2)

```text
A. PRIVATE_PROBE_OUTPUT
   Operator-local, explicitly scoped experimental artifacts.
   Mode 0600. Never committed.

B. PERSISTED_COMPACTION_STATE
   The durable task/session history. `createSessionCompactionState()`
   writes `messages` into the compaction sidecar, which is restored by
   `projectSessionCompactionState()` and therefore survives across
   sessions of the same task and across re-compaction.

C. PROVIDER_VISIBLE_CONTINUATION
   The context supplied to subsequent MODEL REQUESTS.
   `MessageBuilder.buildForApi()` produces the provider-bound message
   list. The same text is sent to the provider on every subsequent turn
   of the session.
```

A record may be permissible in A while unsafe for B or C.

### 1.3.1 — What authority permits A → B/C

```text
A -> B/C is permitted ONLY by a publication gate that runs BEFORE either
destination receives the candidate.
```

No other authority suffices:

- a **length limit** is a size control, not a confidentiality control;
- a **record-count limit** is a size control;
- a **model-authored banner** is a LABEL. It tells a reader the section is
  data; it does not mechanically prevent publication, and it does not
  prevent a model from treating the text as an instruction. This ACT
  MEASURES that the banner does not block publication (`03-injection-red.md`,
  case G2.3.4);
- a **valid canonical reference** is an identity statement, not a
  declassification;
- a **successful command** is an execution status, not a declassification.

## 1.4 — The last enforcement point (G1.3)

```text
                  model-authored candidate record
                              |
                              v
              [ CONTROLLED PUBLICATION GATE ]   <-- THE LAST ENFORCEMENT POINT
                              |
              +---------------+---------------+
              |                               |
              v                               v
      rendered checkpoint section      rendered checkpoint section
              |                               |
              v                               v
   [9] persisted sidecar            [10] provider-visible continuation
   (createSessionCompactionState)     (MessageBuilder.buildForApi)
```

The gate is the EARLIEST SHARED function that BOTH destinations traverse.

**Why a provider-only defence is insufficient:** if the gate ran only inside
`buildForApi`, the sensitive record would already be inside the persisted
sidecar. The sidecar outlives the session's provider context, is restored by
`projectSessionCompactionState()`, and is visible to any later consumer of
the task history.

**Why a persistence-only defence is insufficient:** the projection is also
the source of the provider-visible continuation, and the predecessor's
`applyCheckpointToCompactedMessages()` has a second consumer path. A defence
that runs only at persistence leaves the provider path open.

The ACT's production-seam test (`08-persistence-and-provider-projection.md`)
asserts BOTH destinations against the SAME gate output, and asserts that a
rejected candidate leaves the ordinary compaction byte-identical.

## 1.5 — Source map (the actual current definitions)

```text
checkpoint_parser:
  knowledge-checkpoint-probe/checkpoint-validation.ts
    parseCheckpointDocument()        line 98
    parseRecord()                    line 147

checkpoint_validator:
  knowledge-checkpoint-probe/checkpoint-validation.ts
    parseCheckpointDocument()        line 98
  (no confidentiality validation exists at this HEAD)

assurance_bounding:
  source-visibility-discriminator/trust.ts
    boundAssurance()                 line 188

publication_gate:
  NONE AT THIS HEAD.
  This ACT's controlled gate:
    output-trust-boundary/controlled-publication-gate.ts
      gateClosedStructure()          (closed structure)
      gateRuntimeAttestation()       (runtime attestation)
      gateExplicitApproval()         (explicit approval)

persistence_destination:
  sdk/packages/core/src/session/models/session-compaction.ts
    createSessionCompactionState()   line 181
    projectSessionCompactionState()  line 209

provider_projection:
  sdk/packages/core/src/session/services/message-builder.ts
    buildForApi()                    line 219

renderCheckpointSection():
  source-visibility-discriminator/projection.ts
                                   line 84

applyCheckpointSectionToSummary():
  source-visibility-discriminator/projection.ts
                                   line 154

stripCheckpointSection():
  source-visibility-discriminator/projection.ts
                                   line 125

resolveEvidenceReference():
  source-visibility-discriminator/trust.ts
                                   line 139
```

Every line number above was re-verified against the working tree at this
HEAD, not taken from the predecessor's report.

## G1 exit

```text
PUBLICATION_SEAM_IDENTIFIED
```
