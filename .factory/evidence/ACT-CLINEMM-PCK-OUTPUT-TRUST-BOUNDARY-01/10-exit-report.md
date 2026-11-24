# 10 — Exit report

```text
ACT: ACT-CLINEMM-PCK-OUTPUT-TRUST-BOUNDARY-01

ENTRY_HEAD: 0f111f3d76a7e7da9b792cfd173d88635156182c
SUBJECT_HEAD: 0f111f3d76a7e7da9b792cfd173d88635156182c
FINAL_HEAD: 0f111f3d76a7e7da9b792cfd173d88635156182c
BRANCH: main
WORKTREE: /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm
TRACKED_DIRT: NONE (git diff --stat HEAD is empty)
PREDECESSOR_ARTIFACT_STATUS: UNTRACKED_PROTECTED — the predecessor
  ACT-CLINEMM-PCK-SOURCE-VISIBILITY-DISCRIMINATOR-01 was NOT committed at
  entry and was NOT committed by this ACT. Its 13 source-file SHA-256
  identities were re-verified and are recorded in
  verification/predecessor-source-hashes.txt. It was read, never modified,
  never staged.
PROTECTED_STASHES: none existed at entry; none popped; none mutated
PRODUCTION_DELTA: NONE — every ACT path is a NEW untracked file

SOURCE_MAP:
  checkpoint_parser: knowledge-checkpoint-probe/checkpoint-validation.ts
    parseCheckpointDocument() line 98
  checkpoint_validator: knowledge-checkpoint-probe/checkpoint-validation.ts
    parseCheckpointDocument() line 98
    (no confidentiality validation exists at this HEAD)
  assurance_bounding: source-visibility-discriminator/trust.ts
    boundAssurance() line 188
  publication_gate: NONE AT THIS HEAD.
    Controlled gate (test-local): output-trust-boundary/controlled-publication-gate.ts
      gateClosedStructure() / gateRuntimeAttestation() / gateExplicitApproval()
  persistence_destination: session/models/session-compaction.ts
    createSessionCompactionState() line 181
  provider_projection: session/services/message-builder.ts
    buildForApi() line 219

RED:
  confidentiality_reproduced: YES
  instruction_publication_reproduced: YES
  actual_function_exercised: the predecessor's REAL exported
    renderCheckpointSection() (source-visibility-discriminator/projection.ts:84)
    plus applyCheckpointSectionToSummary() (line 154)
  persisted_secret_marker: FAKE-CREDENTIAL-DO-NOT-USE-7P4x
  provider_visible_secret_marker: FAKE-CREDENTIAL-DO-NOT-USE-7P4x

CANDIDATES:
  closed_structure: IMPLEMENTED and MEASURED — safe by construction, generic,
    non-vacuous
  runtime_attestation: IMPLEMENTED and MEASURED — safe, but ClineMM has NO
    existing mechanism that can attest a tool result's BODY is publishable;
    as an automatic contract it collapses into closed_structure
  explicit_approval: IMPLEMENTED and MEASURED — sound; all five bindings
    proven; requires a trusted authority that does not exist today
  selected_contract: CANDIDATE A — CLOSED STRUCTURED KNOWLEDGE
  decision_basis:
    1. the only candidate that is safe BY CONSTRUCTION for the automatic path
    2. not vacuous — R4/R2/R6 fully retained with
       arbitrary_text_newly_persisted = 0
    3. generic — an unrelated synthetic TypeScript project passes the same
       contract (G5.4)
    4. enforceable WITHOUT a content scanner — every published byte is a
       runtime-owned string, so the opaque dummy (S4) fails closed
    5. needs the least new trusted authority

SECURITY:
  synthetic_credential_cases: 10 (S1-S10)
  arbitrary_secret_case: PASS — the opaque keyword-free dummy (qj7ZKm4x) is
    not automatically persisted
  qualification_field_case: PASS — a credential in qualifications[] is not
    automatically persisted
  marker_injection: PASS — a checkpoint begin/end marker in source content
    is rejected before rendering, so it cannot truncate the section
  cross_session_negative: PASS — a non-canonical cross-session-shaped
    reference is rejected; the session binding lives in the approval contract
  prompt_injection_negative: PASS — forged system/developer roles, tool
    output claiming elevated authority, instructions hidden in a
    qualification, and delimiter smuggling all stay DATA and are rejected
  unrelated_reference_negative: PASS — identityResolved=true,
    semanticSupportVerified=false, never runtime_verified
  downstream_action_authority: CHECKPOINT_CANNOT_AUTHORIZE_ACTION
    (tool authorization, completion authority, approval fences, task
    contract, command policy, session identity, user-visible actions)
  false_rejection_controls: PASS — a benign 40-hex revision is admitted as a
    canonical reference; a benign absolute path is preserved as attested
    content

KNOWLEDGE_UTILITY:
  R2: RETAINED — the inspected implementation content, the 3 s connect
    timeout, the 10 s socket timeout, AND the unresolved effective
    production sender / runtime toggle
  R4: RETAINED — BOTH observed startup operations (kc.sh build AND
    kc.sh start --optimized) AND the observation-only qualification that
    does not establish causation
  R6: RETAINED — the bounded negative search result AND both unresolved
    qualifications; it does NOT become "No token cleanup exists."
  unrelated_repository: PASS — four equivalent knowledge categories pass the
    same contract with no Keycloak-specific string
  observations_retained: 6
  qualifications_retained: 5
  unsupported_promotions: 0

PROJECTION:
  rendered_section: 1719 characters / ~430 estimated tokens for the
    six-record R2/R4/R6 set; every statement and qualification is a
    runtime-owned string
  persisted_summary: the REAL createSessionCompactionState() output contains
    no arbitrary model-authored string under the gate
  provider_visible_request: the REAL MessageBuilder.buildForApi() output
    contains no arbitrary model-authored string under the gate
  rejected_candidate_fallback: PASS — the ordinary compaction is
    byte-identical; no checkpoint section is persisted; no retry; no model
    call
  idempotence: PASS — exactly ONE checkpoint section after two applications

ABLATION:
  leakage_returns_without_gate: YES — ABLATION A and B both restore the
    original RED
  utility_lost_without_projection: YES — ABLATION D removes R4, R2 and R6
    continuation information
  authorization_binding_if_applicable: YES — ABLATION E proves all five
    bindings independently (content identity, session, destination, record
    id, one-shot consumption)

CONSERVATION: PASS — canonical messages unchanged, the original user task
  unchanged, tool-call/result pairing unchanged, the task contract
  unchanged, the verified-outcome carry-forward unchanged, the adjudication
  carry-forward unchanged, stable-prefix behaviour unchanged, no sidecar
  schema change, no new provider tool, no new execution command, no global
  memory store, no leaked raw thinking, no default-on instrumentation, no
  live installed-extension mutation
FOCUSED_TESTS: 63 passed / 6 files
CONTEXT_SUITE: 832 passed, 2 skipped, 0 failed / 53 files passed, 1 skipped
TYPECHECK: 0 ACT-owned diagnostics (44 baseline, re-measured, unchanged)
BIOME: exit 0, 10 files checked
ACT_OWNED_DIAGNOSTICS: 0
ARTIFACT_HASHES: see artifact-hashes.json

LIVE_INSTALLED_QUALIFICATION: NOT_EXECUTED
BEHAVIORAL_CONVERGENCE: NOT_EXECUTED

VERDICT: GO_PCK_BOUNDED_PUBLICATION
```

## What the ACT proved

**The trust boundary the predecessor established was only half a boundary.**

The predecessor proved that a model-authored checkpoint cannot claim
`runtime_verified`: the host bounds the assurance. That protects the TRUTH
of a record.

This ACT proved that the same checkpoint has NO protection at all for the
CONFIDENTIALITY of its TEXT, and that the protection the predecessor relied
on — a length limit, a record-count limit, a model-authored banner, a valid
canonical reference — does not close that gap.

The decisive measurement is small and exact:

```text
The predecessor's REAL exported renderCheckpointSection() copies a
28-character dummy secret out of a synthetic tool result, through a
candidate that cites a VALID canonical reference and a SUCCESSFUL command,
into the rendered section, into the persisted sidecar, and into the
provider-visible continuation.

The reference resolves.        identityResolved = true
The support is not verified.  semanticSupportVerified = false
The assurance is bounded.      runtime_verified -> tool_observed
The secret is published.       PRESENT, in all three places.
```

## What the ACT corrected in the predecessor's account

Nothing in the predecessor's conclusions was re-litigated. The ACT found
one thing the predecessor's framing understated: the predecessor's own
security controls (`security-controls.test.ts`) asserted that a credential in
a tool result is "NOT certified by the resolver" — which is true, and which
the predecessor correctly read as a safety property.

It is not a safety property. It is a statement about the RESOLVER, not about
the PUBLICATION. The resolver was never the component that would leak the
credential; the RENDERER is. And the renderer had no confidentiality
control at all.

## The two findings the ACT's own controls produced

These are recorded because they changed the implementation, and because they
are the most transferable result of the ACT.

**Finding 1 — a shape rule cannot keep content out of an identifier.**
The first implementation accepted a model-authored `id` and validated it
with `isOpaqueIdentifier()` (no whitespace, `[A-Za-z0-9._-]` only). The S6
control FAILED: `id-FAKE-CREDENTIAL-DO-NOT-USE-7P4x` satisfies every shape
rule, and it is a secret. **Fix:** the identifier is no longer part of the
model's proposal; the gate mints it.

**Finding 2 — a shape rule cannot keep content out of a reference.**
The second implementation validated the evidence reference with the same
opaque-shape rule. S6 FAILED again:
`ref-FAKE-CREDENTIAL-DO-NOT-USE-7P4x` also satisfies the shape rule.
**Fix:** the gate accepts a reference only if it is a MEMBER of the
runtime-supplied set of observed canonical references. That is a JOIN, not a
PATTERN.

The generalisable lesson: **for an opaque handle, membership is the only
sound discriminator. Shape is not enough, because a secret can be shaped
opaquely.**

## What the ACT did NOT prove

```text
NOT PROVEN  That a live installed Cline leaks a secret through this path.
             The predecessor's projection is TEST-LOCAL and is not
             installed.

NOT PROVEN  That a continuing agent obeys or ignores a copied instruction.
             DOWNSTREAM_UNAUTHORIZED_ACTION = NOT_EXECUTED. No instrumented
             consumer was exercised.

NOT PROVEN  That no secret exists anywhere in a session, or anywhere in
             natural-language output. The ACT's scope is the PCK publication
             path.

NOT PROVEN  That the closed vocabulary is complete for arbitrary
             repositories. It is not; it must grow as runtime-owned atoms
             are added. That is a bounded, documented loss — the lost
             knowledge is not published unsafely, it is not published at
             all.

NOT PROVEN  That the model-authored banner is useless. It is not: it is a
             correct, necessary LABEL for a reader. It is simply not a
             CONTROL, and the ACT measured that it does not block
             publication.
```

## NEXT_ACTION

```text
Propose a bounded production PCK implementation ACT using EXACTLY the
demonstrated trust contract: CANDIDATE A — CLOSED STRUCTURED KNOWLEDGE.
```

That implementation ACT should, at minimum:

1. Introduce the closed vocabulary as a RUNTIME-OWNED enum, and change the
   checkpoint schema so the model selects rather than writes. The model
   must have NO free-text field in the proposal.
2. Mint the record identifier in the host. Never accept a model-authored
   identifier.
3. Accept an evidence reference ONLY on membership in the runtime's observed
   canonical-reference set. Never on a shape rule.
4. Run the publication gate BEFORE either destination — before the sidecar
   is written and before the provider-visible projection is built.
5. Carry the assurance bounding and the MODEL-AUTHORED banner unchanged.
   The banner is a label; it must not be described as a control.
6. Decide the latency policy. The predecessor's cost was 178 853 ms and
   73 827 ms for two model calls; this ACT did not change that, because it
   did not need a model call to establish the contract.
7. Keep the fail-closed fallback: a rejected checkpoint leaves the ordinary
   compaction byte-identical, with no retry and no repeated model call.
8. Treat the restricted free-text capability (CANDIDATE C) as a SEPARATE,
   explicitly authorised decision. It is NOT part of the automatic
   contract, and it must not be enabled by default.

## REOPEN_CONDITION

Reopen this ACT if ANY of the following becomes true:

- the checkpoint proposal schema gains ANY free-text field, or the identifier
  becomes model-authored;
- the gate's reference check is weakened from MEMBERSHIP to a shape rule, or
  to a secret-pattern matcher;
- the gate is moved to run only at the provider projection, or only at
  persistence, so that one destination bypasses it;
- the runtime-owned vocabulary is extended with a free-form member, which
  would restore a model-authored channel;
- the MODEL-AUTHORED banner is described as a security control rather than
  a label;
- a downstream consumer is instrumented, so that
  DOWNSTREAM_UNAUTHORIZED_ACTION can be measured for the first time;
- the predecessor's projection is repaired, so the RED receipts in this
  ACT's evidence stop reproducing — the negative witness must be preserved.

## The exit criteria, evaluated

| ACT exit criterion | Met? | Reason |
|---|---|---|
| `GO_PCK_BOUNDED_PUBLICATION` | **YES** | every clause is satisfied: the confidentiality RED is reproduced against the real exported projection, a bounded and non-vacuous publication contract passes, arbitrary model free text is not automatically admitted, R2/R4/R6 remain useful and qualified, an unrelated synthetic repository passes the same generic contract, untrusted instructions cannot acquire tool or completion authority, rejected candidates do not damage ordinary compaction, both the persistence and the provider projections honour the same gate, the ablation proves the control is necessary, and no production change occurred |
| `GO_PCK_RESTRICTED_PUBLICATION_ONLY` | NO | the automatic contract A is safe and non-vacuous, so the automatic path is not required to be disabled. CANDIDATE C remains available as a documented restricted capability, but it is not the selected contract and it is not automatically enabled |
| `HALT_OUTPUT_TRUST_UNRESOLVED` | NO | the boundary is resolved: the gate is identified as the last shared publication function, and it is enforced by shape and membership rather than by content inspection |
| `HALT_NO_SAFE_USEFUL_CONTRACT` | NO | the protection does not discard the essential observations: R2, R4 and R6 are retained in full with their qualifications, and `arbitrary_text_newly_persisted = 0` |
| `HALT_RED_NOT_REPRODUCED` | NO | the RED reproduced against the real exported `renderCheckpointSection()`, the real `applyCheckpointSectionToSummary()`, the real `createSessionCompactionState()` and the real `MessageBuilder.buildForApi()` |
| `HALT_P0` | NO | no new correctness or security blocker was found. Two implementation weaknesses were found by the ACT's own controls and both were fixed before the exit |
| `CAPTURE_INSUFFICIENT` | NO | the six frozen private artefacts re-verified by digest; the predecessor's 13 source files re-verified by digest; the entry identity established at runtime |
