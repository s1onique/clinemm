ACT-CLINEMM-COMMAND-AUTHORITY-EXECUTION-CAPABILITY-BINDING01
metadata-provenance.md (CORRECTION01)

REVIEWER QUESTION:
  Do not shallow-merge arbitrary `toolCall.metadata`. Establish the
  provenance of every value in `prepared.toolCall.metadata` BEFORE
  designing the C2 plumbing. The metadata bag is a generic runtime
  carrier, not an authority channel.

PROVENANCE OF `prepared.toolCall.metadata`:

1. SOURCE 1 -- MODEL-STREAM METADATA (partially trusted)
   Where: AgentRuntime.handleModelStreamEvent, "tool-call-delta" branch
          sdk/packages/agents/src/agent-runtime.ts:1730-1810
   Input: event.metadata, which arrives from the model adapter.
   Specifically:
     - ai-sdk adapter: sdk/packages/llms/src/providers/ai-sdk.ts:1070
     - apihandler adapter: sdk/packages/core/src/services/llms/apihandler-agent-model-adapter.ts:52
   Risk: provider SDKs MAY forward arbitrary server-side metadata on
         tool-call parts (OpenAI / Anthropic / Vercel AI SDK are
         heterogeneous on this). Host code does NOT sanitize.
   Trust level: PARTIAL -- providers can attach metadata the host did
                not intend; a future model could even include
                `executionCapability` in its own metadata, which
                would let the model manufacture authority.

2. SOURCE 2 -- RUNTIME-OWNED METADATA (trusted)
   Where: prepareToolExecution / executePreparedTool
          sdk/packages/agents/src/agent-runtime.ts:2437-2500
   Keys stamped by the runtime itself:
     - metadata.inputParseError         (agent-runtime.ts:2496-2501)
     - metadata.toolSource.executionMode (agent-runtime.ts:2444-2457)
     - metadata.toolSource.providerId
     - metadata.executionDisposition    (stamped in executePreparedTool
                                          after execution; not seen
                                          by AgentToolContext)
   Risk: NONE -- the runtime owns the writer, no external input
         reaches these keys.
   Trust level: FULL.

3. SOURCE 3 -- HOST-ATTACHED METADATA (would-be trusted IF it existed)
   Today: NONE.
   The host's `evaluateCommandToolApproval` callback returns
     { approved, decision, executionPlan, hostAuthorization }
   but NONE of these fields are written into `toolCall.metadata`.
   `prepareToolExecution` (line 2556-2570) consumes the approval
   result but does NOT stamp an `executionCapability` (or any
   similar slot) into the returned `prepared.toolCall`.

PROVENANCE CLASSIFICATION (FROZEN):

  Provenance A (RUNTIME-OWNED): trusted.
  Provenance B (MODEL-STREAM-DERIVED): UNTRUSTED for authority.
  Provenance C (HOST-ATTACHED; would-be): trusted IF written by host.

CORRECT C2 DESIGN (FROZEN):

  Do NOT shallow-merge all of `prepared.toolCall.metadata` into
  AgentToolContext.metadata. The current C1 RED design was unsafe
  because it would have allowed Source-B metadata to flow into the
  executor as if it were an authority slot.

  Two acceptable shapes:

  (preferred) Option 1: runtime-owned typed field on AgentToolContext
    Add a closed, runtime-owned property to AgentToolContext:
      executionCapability?: InternalExecutionCapability
    The host's authorization callback returns a typed object that
    the runtime stamps into THIS slot (not into generic metadata).
    The generic metadata channel stays as-is; nothing else flows
    to the executor.

  (fallback) Option 2: closed key copy
    metadata: {
      ...this.config.toolContextMetadata,
      executionCapability:
        prepared.toolCall.metadata?.executionCapability,
    }
    Still arbitrary if Source B writes the key, so Option 2 requires
    that Source B is prohibited from setting `executionCapability`.
    That requires a runtime-side whitelist check at the
    handleModelStreamEvent site. More code, more chance to forget.

OPTION 1 IS PREFERRED because:
  - It cannot be confused with Source B (different namespace).
  - It cannot be widened by mistake (typed slot).
  - It is auditable (a single new field in a single file).
  - It does not require changes to Source-B handling.
  - It does not require a whitelist filter.
  - The existing `metadata?: Record<string, unknown>` stays as-is
    and continues to serve its generic-runtime-carrier purpose.

WHAT THIS MEANS FOR C2:
  In C2 (GREEN), AgentToolContext gains:
    executionCapability?: InternalExecutionCapability
  InternalExecutionCapability is the closed-type wrapper that
  carries the host-attached authorization payload. In C1 it is the
  synthetic zero-privilege marker; in C2-DARWIN-CASCADE it carries
  createOnlyRoots. The shape is closed; the runtime owns the writer.

  The runtime's construction site at agent-runtime.ts:2780 changes
  from:
    metadata: this.config.toolContextMetadata
  to:
    metadata: this.config.toolContextMetadata,
    executionCapability: ??? <-- host-attached from the
                                  approval callback result.
  The host-attached value comes from a NEW channel between the
  policy callback and the runtime -- e.g., the
  `ToolApprovalResult` gains an `executionCapability` field, OR the
  runtime stamps the capability at line 2569 (after `approval` is
  resolved) using a host-owned helper that the policy callback
  populates.

C1-CORRECTION01 OPEN ITEMS:
  - O1: Upstream RED -- drive AgentRuntime end-to-end with
       `prepared.toolCall.metadata.executionCapability = X` set
       by a stub model adapter, and observe the AgentToolContext
       actually received by the tool. The marker MUST be absent
       today (proves Loss #1 is real, not just hypothesized).
  - O2: Provenance -- this file (metadata-provenance.md) freezes
       the classification.
  - O3: Design -- Option 1 (typed runtime-owned slot) preferred.
  - O4: No production code in CORRECTION01.
  - O5: Existing downstream RED (C1) stays; it remains the
       downstream-half witness.
