# ClineMM Native → `agent-trace/0.1` Mapping

**ACT:** `ACT-CLINEMM-HARNESS-NEUTRAL-TRACE-CONTRACT-RECON01`
**Adapter:** `apps/vscode/src/sdk/normalize-agent-trace.ts`
**Reference capture:** `model-behavior-trace.jsonl`
(SHA-256 `84f6bea329299bbb5af1a38ffef6ce4a87227c5c894c8947f32458043090a070`, 3892 lines)

This is the **adapter** for the ClineMM harness. It is one implementation of the
portable contract; the contract itself does not depend on it.

---

## 1. The ClineMM production seams this mapping is grounded in

| Seam | Path | What it owns |
|---|---|---|
| Recorder + schema | `sdk/packages/shared/src/runtime/model-behavior-trace.ts` | the ring, the record shape, the `evidenceBoundary` labels, the privacy sanitizer, the truncation accounting |
| Extension-host runtime | `apps/vscode/src/sdk/model-behavior-trace-runtime.ts` | the single recorder instance, the default-OFF toggle, the dump, the SDK bridge |
| Agent runtime | `sdk/packages/agents/src/agent-runtime.ts` | model-request boundary, tool-call identity, the `req_*` wire correlation id, the `run_<8>` run id |
| Provider transport | `sdk/packages/llms/src/providers/provider-request-capture.ts` | the serialized-wire observation boundary |
| Wire registry | `sdk/packages/shared/src/runtime/model-wire-reasoning.ts` | the process-wide observer registry for serialized wire controls |
| Session orchestrator | `sdk/packages/core/src/runtime/orchestration/session-runtime-orchestrator.ts` | the `run_<epochMs>_<rand>` run id, loop verdicts, run termination |
| Edit observers | `sdk/packages/core/src/extensions/tools/executors/edit-observation.ts` | the `REAL_PRODUCTION_SEAM` workspace facts |
| Existing comparator | `scripts/compare-model-behavior-traces.ts` | the fail-closed **comparability** authority (unchanged by this ACT) |

---

## 2. Event-type → family mapping

Every native event the recorder can emit, and its portable family.

| Native event | Portable family | Producer seam | Identity carried |
|---|---|---|---|
| `model_config` | `model` | `buildSessionConfig()` → `recordModelBehaviorTraceConfig` | session (after binding) |
| `effective_model_config` | `model` | `AgentRuntime` effective model-request boundary | session + run + iteration |
| `model_request_start` | `model` | `AgentRuntime.generateAssistantMessage` (pre-stream) | session + run + iteration |
| `model_request_finish` | `model` | same, post-stream | session + run + iteration |
| `model_request_error` | `model` | same, error path | session + run + iteration |
| `model_request_abort` | `model` | same, abort path | session + run + iteration |
| `model_wire_reasoning` | `model` | provider transport (serialized body) | session + run + iteration + `wireRequestId` |
| `tool_start` | `tool` | agent runtime tool dispatch | session + run + iteration + `toolCallId` |
| `tool_finish` | `tool` | agent runtime tool completion | session + run + iteration + `toolCallId` |
| `edit_attempt` | `workspace` | editor executor | session + run + iteration + `toolCallId` |
| `edit_target_resolved` | `workspace` | editor write layer | session + run + iteration + `toolCallId` |
| `edit_application` | `workspace` | editor write layer | session + run + iteration + `toolCallId` |
| `edit_failure` | `workspace` | editor write layer | session + run + iteration + `toolCallId` |
| `edit_write_verification` | `workspace` | independent read-back | session + run + iteration + `toolCallId` |
| `edit_checkpoint_observation` | `workspace` | checkpoint / dump-time filesystem observation | session + run |
| `loop_verdict` | `run` | session orchestrator | session + task + run (**orchestrator namespace**) |
| `compaction_diagnostics` | `context` | compaction prepare-turn resolver | session + iteration |
| `compaction_completed` | `context` | compaction execution | session + iteration |
| `run_terminated` | `run` | session orchestrator | session + task + run (**orchestrator namespace**) |
| *(summary record)* | **not a record** | the dump | — |
| — | `process` | **NO PRODUCER** | — |
| — | `acceptance` | **NO PRODUCER** | — |

---

## 3. The two run-id namespaces (the central correlation fact)

ClineMM emits **two disjoint** run-id namespaces. They coexist in one capture.

| Namespace | Shape | Minted by | Carried by |
|---|---|---|---|
| `agent_runtime` | `run_<nanoid(8)>` — e.g. `run_W2aMQQ9w` | `AgentRuntime.execute` (`agent-runtime.ts:1614`) | `effective_model_config`, `model_request_*`, `model_wire_reasoning`, `tool_*`, `edit_*`, `compaction_*` |
| `session_orchestrator` | `run_<epochMs>_<rand>` — e.g. `run_1793428459419_7n4w98` | `SessionRuntimeOrchestrator` (`session-runtime-orchestrator.ts:1027`) | `loop_verdict`, `run_terminated` |

**Consequence.** The `run_terminated` record for a run and the `model_request_*`
records of that same run **do not share a run id**. They are joined, if at all,
by the shared `sessionId` — never by the run id string.

The adapter therefore carries `identity.runIdNamespace` on every record that
has a run id, and the coverage report names this explicitly
(`unjoinableIdentities[kind="dual_run_id_namespace"]`).

> The recorder does **not** carry a namespace tag. The adapter classifies by
> **shape**. An id matching neither shape is reported as unknown, never guessed.

### 3.1 Observed in the reference capture

| Namespace | Run ids | Records |
|---|---|---|
| `agent_runtime` | `run_W2aMQQ9w`, `run_JX9aZPGf`, `run_ngsEq7Ka`, `run_jYoOC3fP`, `run_g41lVt8c` | 2 956 |
| `session_orchestrator` | `run_1793428459419_7n4w98`, `run_1793432737506_zytkvk`, `run_1793434131508_ol2sao`, `run_1793434142016_hddvhn`, `run_1793434178320_joteey` | 488 |

---

## 4. Evidence-quality mapping

### 4.1 The two axes

ClineMM's `evidenceBoundary` describes **correlation completeness**, not
evidence kind. It therefore maps to the portable `correlationCompleteness`
field, **not** to `evidenceQuality`.

| Native `evidenceBoundary` | Portable `correlationCompleteness` | Portable `evidenceQuality` (absent `provenance`) |
|---|---|---|
| `observed` | `observed` | `REAL` |
| `partial_identity` | `partial_identity` | `REAL` |
| `no_identity` | `no_identity` | `REAL` |
| `synthesized` | `no_identity` | `SYNTHETIC` |
| `inferred_budget` | `no_identity` | `INFERRED` |

### 4.2 `provenance` wins

When a payload carries `provenance`, it describes the **producing layer** and
is a stronger statement about evidence kind. It therefore overrides the
boundary-derived value:

| Native `provenance` | Portable `evidenceQuality` |
|---|---|
| `REAL_PRODUCTION_SEAM` | `REAL` |
| `INFERRED` | `INFERRED` |

`provenance` appears on `edit_target_resolved`, `edit_application`,
`edit_write_verification`, and `edit_checkpoint_observation`.

### 4.3 What is NEVER promoted

- `partial_identity` is **never** upgraded to `observed`.
- `synthesized` is **never** upgraded to `REAL`.
- `no_identity` is **never** upgraded to `observed`.
- An `UNAVAILABLE_FROM_TRACE` sentinel is carried through **verbatim**.

---

## 5. Field-level mapping

### 5.1 Envelope

| Native | Portable | Notes |
|---|---|---|
| `seq` | `nativeEventId`, `sourceOrder` | the source's own monotonic id and ordering |
| `timestamp` | `timestamp` | ISO-8601, verbatim |
| `traceId` | `nativeTraceId` | recorder-scoped |
| `event` | `nativeEventType` | verbatim |
| `evidenceBoundary` | `sourceEvidenceBoundary` | verbatim |
| `evidenceBoundary` | `correlationCompleteness` | via §4.1 |
| — | `evidenceQuality` | via §4 |
| `sessionId` | `identity.sessionId` | |
| `taskId` | `identity.taskId` | the conversation id (`conv_<ts>_<rand>`) |
| `runId` | `identity.runId` + `identity.runIdNamespace` | see §3 |
| `iteration` | `identity.iteration` | the agent-loop iteration |
| `providerId` | `identity.providerId` | optional; the contract is provider-neutral |
| `modelId` | `identity.modelId` | optional |
| `payload.requestId` | `identity.wireRequestId` | the `req_*` transport join key |
| `payload.toolCallId` | `identity.toolCallId` | owner-scoped |

### 5.2 Durations

| Native event | Native field | Portable `durationMs` | `durationProvenance` |
|---|---|---|---|
| `model_request_finish` | `requestDurationMs` | same value | `provider_request_wall_clock` |
| `tool_finish` | `durationMs` | same value | `tool_invocation_wall_clock` |
| `edit_application` | `durationMs` | same value | `edit_application_wall_clock` |
| `run_terminated` | `durationMs` | same value | `run_wall_clock` |

`durationProvenance` exists so a reader can never mistake a provider-request
span for a turn span.

### 5.3 The three reasoning facts

| Portable location | Native source | Native field |
|---|---|---|
| `model` / `model_request_start`.`requestedThinking` | agent runtime (requested) | `requestedThinking` |
| `model` / `model_request_start`.`requestedReasoningEffort` | agent runtime (requested) | `requestedReasoningEffort` |
| `model` / `model_request_start`.`reasoningEffortAdvertised` | agent runtime (requested) | `reasoningEffortAdvertised` |
| `model` / `model_wire_reasoning`.`wireThinkingMode` | provider transport (serialized) | `wireThinkingMode` |
| `model` / `model_wire_reasoning`.`wireOutputConfigEffort` | provider transport (serialized) | `wireOutputConfigEffort` |
| `model` / `model_wire_reasoning`.`wireOutputTokenLimit` | provider transport (serialized) | `wireOutputTokenLimit` |
| `model` / `model_request_finish`.`providerReportedReasoningTokens` | provider (reported) | `providerReportedReasoningTokens` |
| `model` / `model_request_finish`.`reasoningContentBytes` | transport (bytes) | `reasoningContentBytes` |

`reasoningContentBytes` is a **byte count of transported reasoning content**.
It is NOT a token count and the adapter never converts it. The contract's
rule "never infer provider reasoning-token counts from reasoning-content bytes"
is enforced by keeping the two in separate fields with no conversion path.

### 5.4 The four editing stages

| Stage | Native event | Portable evidence |
|---|---|---|
| invocation | `edit_attempt` | `operation`, `approvalOutcome`, `executionInvoked`, `targetCount` |
| application | `edit_application` | `outcome`, `requestedFileCount`, `mutatedFileCount`, `unmutatedFileCount`, `noOp` |
| verification | `edit_write_verification` | `writeReturned`, `readbackAttempted`, `readbackMatched`, `fileExistsAfterWrite` |
| retained delta | `edit_checkpoint_observation` | `observedTargetCount`, `targets[].state` |

The adapter adds **no** `retained` flag to an application record. The retained
claim lives only on the checkpoint record, and the `REAL-05` witness pins this.

### 5.5 Context / compaction

| Portable field | Native field | Meaning preserved |
|---|---|---|
| `requestInputTokens` | `requestInputTokens` | the INPUT size of the request |
| `maxInputTokens` | `maxInputTokens` | the resolved budget |
| `effectiveMaxInputTokens` | `effectiveMaxInputTokens` | the budget after the ceiling |
| `requestTriggerTokens` | `requestTriggerTokens` | the threshold that triggers compaction |
| `inputBudgetSource` | `inputBudgetSource` | the budget's provenance |
| `tokensBefore` / `tokensAfter` / `tokensSaved` | same | the compaction boundary |
| `messagesBefore` / `messagesAfter` | same | the message-count boundary |

The four token numbers keep their **distinct meanings**. The adapter never
coalesces them into a single "tokens" number.

---

## 6. Privacy transformations applied by the adapter

The ClineMM recorder already sanitizes its payloads. The adapter is the **last**
gate before the portable file exists, and re-checks.

ACT-CLINEMM-HARNESS-NEUTRAL-TRACE-CONTRACT-RECON01-CORR01 (P0-1) replaced the
predecessor's **deny-list** filter with a **schema-aware allowlist**.

### 6.1 The allowlist is the primary gate

| Transformation | Rule |
|---|---|
| **family allowlist (primary)** | a key is exported only if it is **explicitly permitted** for the record's family. An **unfamiliar** key does **not** escape merely because the filter has never seen it. |
| forbidden-key deny-list (defence in depth) | `arguments`, `params`, `input`, `prompt`, `system_prompt`, `message(s)`, `text`, `content`, `reasoning`, `thinking`, `raw`, `request(body)`, `response`, `result`, `output`, `stdout`, `stderr`, `value`, `token(s)`, `secret(s)`, `credential(s)`, `apiKey`, `password`, `passwd`, `command`, `cmd`, `script`, `code`, `diff`, `patch`, `authorization`, `cookie`, `bearer`, `privateKey`, `env`, `environment` — rejected at **every** depth |
| nested allowlist | a nested object or array element may carry only the explicitly permitted nested keys (`fileIdentity`, `contentVersionPre/Post`, `linesAdded/Removed`, `measurementSkipped`, `state`, `contentFingerprint`, `measurementSkippedReason`, `toolCatalogCount`, and the `edit_target_resolved` scalars) |
| depth cap | 4 levels; deeper content is **dropped**, not partially trusted |
| absolute-path drop | any string matching `^/`, `^[A-Za-z]:[\\/]`, or `^\\\\` |
| tool catalog | `toolNames` → `toolCatalogCount` only; names and catalog identity are never exported |
| dropped-field accounting | every dropped key is counted **by path** in `coverage.privacyFilteredFields` |

### 6.2 Catalog identity is unavailable (CORR02 P0-A)

The CORR01 digest was keyed by the capture's recorder trace id. That trace id
is exported as `nativeTraceId`, so every export consumer could derive the same
key and recompute the digest for any candidate catalog. The digest was stable,
but it was not secret; capture-scoped public hashing did not establish catalog
identity.

The portable contract therefore exports **only `toolCatalogCount`** and reports
`toolCatalogIdentity: UNAVAILABLE_FROM_TRACE`. Catalog identity remains
unavailable until either an evaluator-managed secret key or an independent
manifest authority exists. No catalog fingerprint or key label is published.

The adapter introduces **no** content the recorder omitted. It removes.

---

## 7. Refused joins (reported, never performed)

The coverage report names every refused join. In the reference capture:

| Refusal | Count | Why |
|---|---|---|
| `wire_request_without_request_id` | 10 | the wire observation carries no `requestId`; it cannot be joined to an agent-side request. The adapter does **not** join it to the neighbouring `model_request_start` by timestamp. |
| `wire_request_without_run_id` | 10 | same records; also un-attributable to a run |
| `record_without_run_id` / `compaction_diagnostics` | 469 | the compaction resolver observes a session + iteration, not a run |
| `record_without_run_id` / `compaction_completed` | 1 | same |
| `record_without_run_id` / `model_config` | 2 | the build-time snapshot precedes run allocation |
| `dual_run_id_namespace` | 957 | two disjoint run-id namespaces coexist |

---

## 8. Native events with NO portable equivalent

| Native fact | Why it is not portable |
|---|---|
| `argumentFingerprint` | it is an **ephemeral per-trace HMAC**: stable within a trace, unrecoverable across traces. It is comparable **within** one capture only. The adapter carries it verbatim and labels it as such; it is not a cross-harness key. |
| `fileIdentity`, `contentVersionPre/Post`, `executorCwdIdentity` | ephemeral per-trace HMACs of paths and bytes. Same limitation. |
| `toolNames` | catalog content; replaced by a count only. Catalog identity is unavailable without an independent authority. |
| `model_config.temperature` / `topP` / `maxOutputTokens` | `UNAVAILABLE_FROM_TRACE` in this capture — carried through verbatim as unknown. |

---

## 9. What the adapter does NOT do

- It does **not** re-implement the existing comparator's comparability rules.
  `scripts/compare-model-behavior-traces.ts` remains the fail-closed
  comparability authority and is **unchanged**.
- It does **not** write to the trace, the recorder, or any production state.
- It does **not** re-derive or patch the source capture.
- It does **not** invent a `process` or `acceptance` record.
- It does **not** join across run-id namespaces, or by timestamp.
