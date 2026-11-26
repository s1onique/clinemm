# ACT-CLINEMM-CACHE-PRESERVING-AUXILIARY-INFERENCE-RECON-01 (AMENDMENT-01) — 04 successor contract

This document SUPERSEDES the recon's first successor contract. The selected candidate is now **B'**, and
the source-visibility deltas are explicit acceptance gates rather than an assumption.

```text
SUCCESSOR_ACT_ID: ACT-CLINEMM-PCK-PREFIX-PRESERVING-IMPLEMENTATION-01
PRIMARY_PRODUCTION_SEAM: sdk/packages/core/src/extensions/context/precompaction-knowledge-checkpoint/
  request construction (model-request.ts), dispatch (compaction.ts), transport
  (sdk/packages/core/src/extensions/context/summary-generation.ts)
SELECTED_CANDIDATE: B' — the COMPLETE existing extraction contract appended at the TAIL of an
  UNCHANGED parent projection
FALLBACK_CANDIDATE: A — the existing independent PCK request (legacy fallback). C' (persistent
  protocol + activation suffix) is retained as a HYPOTHESIS for a later ACT, NOT as a second permanent
  architecture; nothing measured offline makes it necessary.

REQUIRED_PRODUCTION_CHANGES:
  1. The auxiliary request is built from the parent's OWN provider-visible projection
     (MessageBuilder.buildForApi) with ONE appended user message that carries:
       - the existing extraction contract (CHECKPOINT_SYSTEM_PROMPT verbatim, including the closed
         vocabulary, the output shape and the prohibitions),
       - the canonical reference list,
       - the authorized source interval,
       - the extraction objective.
     The conversation is NOT duplicated: the parent projection already carries it.
  2. The auxiliary request keeps the parent's VISIBLE tool schema (so the prefix is preserved) but is
     executed with NO tool authority. The runtime must reject a tool call exactly as runPckAttempt
     does today (failureReason = "tool_call_attempted").
  3. The existing controlled input view, closed vocabulary, publication gate, source-prefix staleness
     check, deadline (180 000 ms) and installation path are REUSED UNCHANGED, EXCEPT for the
     source-visibility deltas that must be closed (see REQUIRED_SUCCESSOR_DISCRIMINATORS).
  4. The legacy independent-request path stays available and is selected automatically whenever the
     auxiliary request cannot be built from the parent's projection.

EXISTING_INFRASTRUCTURE_REUSED:
  runPckAttempt / createPckAbortHandle / DEFAULT_PCK_DEADLINE_MS (runtime.ts);
  buildCheckpointInputView / renderMessageForCheckpoint / CHECKPOINT_SYSTEM_PROMPT (model-request.ts);
  gateClosedProposals + interpretCanonicalEvidence (publication-gate.ts / evidence.ts);
  generateSummary (summary-generation.ts); MessageBuilder.buildForApi;
  resolvePckInferencePolicy / applyPckInferencePolicy (inference-policy.ts);
  the provider-request capture and the prefix-forensics capture.

REQUIRED_RED_WITNESS:
  - The auxiliary request's system prompt MUST differ from the parent's (an independent auxiliary system
    prompt cannot share the parent's prefix).
  - The parent's serialized body MUST be unchanged by the auxiliary branch.
  - The canonical history MUST be byte-identical before and after the auxiliary attempt.
  - The publication gate MUST reject an unobserved evidence reference.
  - A forged activation marker in user text, tool output or a retrieved document MUST NOT enable the
    auxiliary path.

REQUIRED_GREEN_WITNESS:
  - The auxiliary request's leading messages are byte-identical to the parent's, and the first divergence
    is the appended activation message.
  - The parent's tool schema set is byte-identical in the auxiliary request.
  - The auxiliary response that attempts a tool call is rejected; no executor is reachable from the
    auxiliary transport chain.
  - A timeout, a cancellation and an invalid result install nothing and leave the parent running.
  - The parent request re-dispatched after the auxiliary branch is byte-identical to the parent request
    before it.

AUTHORITY_CONSERVATION:
  Activation stays runtime-owned (the environment opt-in plus the compaction eligibility seam). The
  appended contract and suffix are NOT a security boundary: a marker in user text, tool output or a
  retrieved document cannot activate the auxiliary path. The isolated, validated extraction path and the
  publication gate remain the external enforcement.

SOURCE_VISIBILITY_CONSERVATION (NOT yet established — explicit successor gates):
  1. PRIVATE REASONING: the parent projection carries thinking blocks to the wire, so the auxiliary
     request would contain the parent's private reasoning, which the legacy controlled view excluded.
     The successor must either exclude the reasoning from the auxiliary projection — accepting a prefix
     divergence at the first thinking block — or record the exposure explicitly and rely on the gate's
     assurance downgrade (which downgrades to `model_reported` but does not reject).
  2. OBSERVATION STATUS: the legacy view's normalized `status=succeeded` / `status=failed` is not
     reproduced by the parent projection; the successor must either restore the normalization without
     duplicating the conversation, or record the change.
  3. EVIDENCE-REFERENCE BINDING: the canonical ids are dropped by the projection, so a reference list
     alone cannot bind a reference to its content. The successor must carry an ORDERED reference list
     whose order matches the provider-visible message order, and must state that binding explicitly.
  4. BOUNDED SOURCE MATERIAL: the two surfaces truncate differently; the successor must state which
     truncation applies to the auxiliary request.

CANONICAL_HISTORY_CONSERVATION:
  The activation payload and the auxiliary result never become ordinary parent conversation messages;
  the sanctioned knowledge installation path is unchanged; no user impersonation and no manufactured
  assistant tool results.

P40_LIVE_DISCRIMINATOR:
  ONE live compaction decision on the P40 route (qwen3.8-flash-next-q2_0, openai-compatible, Strata)
  with the provider-request capture armed, acquiring POSITIVELY CORRELATED parent and PCK request
  evidence (same run, same session, distinct request identities), measuring input tokens, cache-read
  tokens and duration for BOTH requests, plus the accepted/rejected outcome of the extraction. The
  deadline stays at 180 000 ms. No live experiment was executed in this ACT.

ACCEPTANCE_METRICS (proposed, NOT measured):
  - eligible prefix reuse >= 95% of the parent prefix (baseline ~0%);
  - PCK prefill < 15 s (the historical cold-prefill duration is UNESTABLISHED);
  - a valid accepted extraction instead of zero output;
  - zero unauthorized executions; zero canonical-history mutations;
  - the W1 knowledge benchmark facts retained (05-pck-knowledge-benchmark.md);
  - the four source-visibility deltas above either closed or explicitly accepted in writing.

REMOVAL_OR_FALLBACK_CONDITION:
  Revert to the legacy independent PCK request (A) if the live discriminator shows no measurable
  cache-reuse improvement, if the auxiliary request's tool-call rejection regresses, if the parent body
  changes in any byte, or if the source-visibility deltas cannot be closed or explicitly accepted.
```

## What is deliberately NOT in the successor

* No common CPAI abstraction; no persistent protocol in the ordinary prompt (that is candidate C').
* No R2 changes: the selector's source visibility, its prefix compatibility, the accepted-objective
  parent prefix compatibility and the selector usage-correlation defect stay independently owned.
* No PCK schema redesign, no new knowledge subsystem, no deadline change, no engine change.
