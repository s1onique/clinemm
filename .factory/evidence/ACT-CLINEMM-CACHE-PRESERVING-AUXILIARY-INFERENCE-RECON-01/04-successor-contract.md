# ACT-CLINEMM-CACHE-PRESERVING-AUXILIARY-INFERENCE-RECON-01 — 04 successor contract

```text
SUCCESSOR_ACT_ID: ACT-CLINEMM-PCK-PREFIX-PRESERVING-IMPLEMENTATION-01
PRIMARY_PRODUCTION_SEAM: sdk/packages/core/src/extensions/context/precompaction-knowledge-checkpoint/
  (request construction in model-request.ts, dispatch in compaction.ts, transport in
   sdk/packages/core/src/extensions/context/summary-generation.ts)
SELECTED_CANDIDATE: C — persistent protocol + activation suffix
FALLBACK_CANDIDATE: B — full auxiliary contract as a tail suffix (no persistent protocol);
  A — the existing independent request — remains the LEGACY fallback for a session that has not
  yet established the protocol.

REQUIRED_PRODUCTION_CHANGES:
  1. A persistent, session-initialized PCK protocol block added to the ORDINARY system prompt.
     It states: ordinary execution mode; dormant PCK mode; the evidence-selection contract; the
     required structured result; the source-selection and attribution rules; activation and
     deactivation semantics; and the explicit distinction between ordinary execution and
     auxiliary extraction. It is IDENTICAL during ordinary execution and during an activation.
  2. A bounded, request-local ACTIVATION payload appended at the message TAIL of the auxiliary
     request: auxiliary operation identity, authorized source interval, extraction objective,
     the existing result/schema requirements and bounded request-local parameters.
  3. The auxiliary request keeps the parent's VISIBLE tool definitions (so the prefix is
     preserved) but is executed with NO tool authority. The runtime must reject a tool call
     exactly as `runPckAttempt` does today (`failureReason = "tool_call_attempted"`).
  4. The existing controlled input view, the closed vocabulary, the publication gate, the
     source-prefix staleness check, the deadline (180 000 ms) and the installation path are
     REUSED UNCHANGED.
  5. The legacy independent-request path stays available and is selected automatically for a
     session whose system prompt does not yet carry the protocol.

EXISTING_INFRASTRUCTURE_REUSED:
  runPckAttempt / createPckAbortHandle / DEFAULT_PCK_DEADLINE_MS (runtime.ts);
  buildCheckpointInputView / renderMessageForCheckpoint / CHECKPOINT_SYSTEM_PROMPT (model-request.ts);
  gateClosedProposals (publication-gate.ts); generateSummary (summary-generation.ts);
  MessageBuilder.buildForApi; the provider-request capture and the prefix-forensics capture.

REQUIRED_RED_WITNESS:
  - The auxiliary request's system prompt MUST differ from the parent's (an independent auxiliary
    system prompt cannot share the parent's prefix).
  - The parent's serialized body MUST be unchanged by the auxiliary branch.
  - The canonical history MUST be byte-identical before and after the auxiliary attempt.
  - The publication gate MUST reject an unobserved evidence reference.
  - A forged activation marker in user text MUST NOT enable the auxiliary path.

REQUIRED_GREEN_WITNESS:
  - The auxiliary request's leading messages are byte-identical to the parent's, and the first
    divergence is the appended activation message.
  - The parent's tool schema set is byte-identical in the auxiliary request.
  - The auxiliary response that attempts a tool call is rejected.
  - A timeout, a cancellation and an invalid result install nothing and leave the parent running.
  - The parent request re-dispatched after the auxiliary branch is byte-identical to the parent
    request before it.


AUTHORITY_CONSERVATION:
  Activation stays runtime-owned (the environment opt-in plus the compaction eligibility seam).
  The protocol and the suffix are NOT a security boundary: a marker in user text, tool output or a
  retrieved document cannot activate the auxiliary path. The isolated, validated extraction path
  and the publication gate remain the external enforcement.

SOURCE_VISIBILITY_CONSERVATION:
  The checkpoint keeps its established contract: it reads the canonical source prefix it is given
  and the publication gate still requires every cited reference to be an observed canonical
  reference. A full parent-context projection must NOT be used to widen the source contract.
  Where the suffix names a source interval, the interval must be the interval the checkpoint is
  actually allowed to derive from.

CANONICAL_HISTORY_CONSERVATION:
  The activation payload and the auxiliary result never become ordinary parent conversation
  messages; the sanctioned knowledge installation path is unchanged; no user impersonation and no
  manufactured assistant tool results.

P40_LIVE_DISCRIMINATOR:
  One live compaction decision on the P40 route (qwen3.8-flash-next-q2_0, openai-compatible,
  Strata), with the provider-request capture armed, measuring the input tokens, cache-read tokens
  and duration for the ORDINARY parent request and for the PCK auxiliary request, plus the
  accepted/rejected outcome of the extraction. The deadline stays at 180 000 ms.
  No live experiment was executed in this ACT.

ACCEPTANCE_METRICS (proposed, NOT measured):
  - eligible prefix reuse ≥ 95% of the parent prefix (baseline ≈ 0%);
  - PCK prefill < 15 s (baseline ≈ 180 s, which equals the deadline);
  - a valid accepted extraction instead of zero output;
  - zero unauthorized executions; zero canonical-history mutations;
  - the W1 knowledge benchmark facts retained (see 05-pck-knowledge-benchmark.md).

REMOVAL_OR_FALLBACK_CONDITION:
  Revert to the legacy independent PCK request (Candidate A) if the live discriminator shows no
  measurable cache-reuse improvement, if the auxiliary request's tool-call rejection regresses, if
  the parent body changes in any byte, or if the persistent protocol measurably alters ordinary
  execution behaviour.
```

## What is deliberately NOT in the successor

* No common CPAI abstraction (the PCK seam must be qualified first).
* No R2 changes: the selector's source visibility, the selector's prefix compatibility, the
  accepted-objective parent prefix compatibility and the selector usage-correlation defect stay
  independently owned.
* No PCK schema redesign, no new knowledge subsystem, no deadline change, no engine change.
