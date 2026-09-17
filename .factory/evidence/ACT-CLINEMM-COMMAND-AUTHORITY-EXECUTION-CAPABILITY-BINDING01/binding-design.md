ACT-CLINEMM-COMMAND-AUTHORITY-EXECUTION-CAPABILITY-BINDING01
binding-design.md (CORRECTION01 revised)

GOAL (this ACT):
  Prove the transport seam from policy decision to CommandJobManager.start
  carries a per-invocation, zero-privilege marker for exactly the
  authorized invocation, with no cross-invocation leakage.

C1 SCOPE (this ACT, no production delta):
  Synthetic marker only. The marker is structurally typed, carries
  NO filesystem/network authority, and is observed by the test seam.

  Marker shape (C1):
    interface C1ExecutionCapabilityMarker {
      correlationId: string         // unique per invocation
      marker: "factory-binding-probe"  // constant literal
      // ZERO filesystem/network authority on purpose.
    }

  The C1 marker is observable only by:
    1. the unit/bridge test driving the seam,
    2. internal CommandJobManager instrumentation (a per-call start
       audit field) so the test can assert "what reached start()".

C2 SCOPE (this ACT, GREEN -- CORRECTION01 revised):
  Minimal plumbing to make C1's synthetic marker observable end-to-end
  on the production seam.

  AUTHORITY PROVENANCE (frozen in metadata-provenance.md):
    Source 1 (model-stream metadata): PARTIALLY trusted.
      Provider SDKs may forward arbitrary metadata on tool-call parts.
      Host code does NOT sanitize today. A model could in principle
      manufacture executionCapability if it landed in the generic
      metadata bag.
    Source 2 (runtime-owned metadata keys): FULLY trusted.
      inputParseError, toolSource.*, executionDisposition.
    Source 3 (host-attached; would-be): trusted IF added via a typed
      runtime-owned slot.

  CORRECTION01 DECISION:
    DO NOT shallow-merge prepared.toolCall.metadata.
    DO add a typed runtime-owned field on AgentToolContext:
      executionCapability?: InternalExecutionCapability

  Why typed slot over shallow merge:
    - Cannot be confused with Source-B (different namespace).
    - Cannot be widened by mistake (typed, closed shape).
    - Auditable: single new field, single source of truth.
    - Does not require Source-B whitelist filter.
    - The existing generic metadata bag stays untouched and
      continues to serve its runtime-carrier purpose.

SEAM ARCHITECTURE (CORRECTION01):

  policy decision (evaluateCommandToolApproval)
        |     produces executionPlan + hostAuthorization
        v
  SdkInteractionCoordinator
        |     captures executionPlan + hostAuthorization
        v
  AgentRuntime.prepareToolExecution
        |     today: reads inputParseError, toolSource from toolCall.metadata
        |     C2 CHANGE: stamps the authorization-derived capability
        |     into a NEW typed slot carried on the host's policy
        |     callback result, OR via a host-owned helper that
        |     extracts capability from hostAuthorization.
        v
  AgentRuntime.executePreparedTool
        |     C2 CHANGE at agent-runtime.ts:2780-2800:
        |       {
        |         ...this.config.toolContextMetadata,
        |         executionCapability: <host-attached typed slot>,
        |       }
        v
  tool.execute(input, context)
        |     AgentToolContext.executionCapability is the typed slot
        v
  createVscodeShellExecutor
        |     reads context.executionCapability
        |     forwards into StartCommandJobOptions.executionCapability
        v
  CommandJobManager.start(options, context)
        |     options.executionCapability = marker
        |     records on job (NO sandbox consumption yet)
        v
  BUILD Experimental Recon Capability
        |     C1: same as today.
        |     C2 of DARWIN-MKTEMP-CAPABILITY01 cascade:
        |     adds createOnlyRoots from options.executionCapability.

PROVENANCE GATE (CORRECTION01 contract):
  The capability MUST cross the seam through a CLOSED TYPED FIELD,
  not by promoting an arbitrary metadata namespace. The runtime
  stamps the field; untrusted inputs (Source B) cannot.

  Formally:
    AgentToolContext.executionCapability?: InternalExecutionCapability
  where InternalExecutionCapability is the closed union:
    { correlationId: string, marker: "factory-binding-probe" }   (C1)
    | { correlationId: string, createOnlyRoots: readonly string[] } (C2 future)
    | <future variants explicitly enumerated in this union>

  The runtime typechecks the field at the construction site (not
  at consumption), so an unexpected shape fails closed.

PER-INVOCATION INVARIANTS (C1 SPEC):

  I1. For invocation A:
      - the host attaches a typed executionCapability on the
        policy callback result; runtime stamps it onto the
        AgentToolContext typed slot.
      - expected: tool.execute(context) sees
        context.executionCapability.correlationId === "A"
      - expected: manager.start(options) sees
        options.executionCapability.correlationId === "A"

  I2. For invocation B (no capability):
      - host callback returns without executionCapability
      - expected: tool.execute(context) sees
        context.executionCapability === undefined
      - expected: manager.start(options) sees
        options.executionCapability === undefined

  I3. Concurrency: A and B interleaved => each sees its own
      capability only.

  I4. Denied invocation: NEVER reaches manager.start.

  I5. Foreground (vscodeTerminal) path: NA.

CORRELATION IDENTITY:
  - toolCall.toolCallId (per-call, unique within a session).
  - Capability.correlationId is a derivative (asserted in tests).

ANTI-PATTERN CHECKS:
  - NO global mutable state keyed by command text.
  - NO module-level `currentCapability` singleton.
  - NO sandbox backend parses raw command text.
  - NO `CommandJobManager.start` calls policy again.
  - NO shallow merge of arbitrary toolCall.metadata.
  - Authority flows through a CLOSED typed slot only.

DETERMINISM:
  - Marker literal "factory-binding-probe" is unique.
  - Capability payload type is a closed union (exhaustive).
  - Marker carries NO fields matching CommandCapability.
  - Type system prevents accidental sandbox consumption in C1.

FAIL-CLOSED CONTRACT (frozen now):
  If a future per-invocation capability is REQUIRED for the sandbox
  but is MISSING from the typed slot at CommandJobManager.start time,
  the manager MUST NOT spawn the command silently under reduced
  authority. It MUST surface a spawn_failed signal naming the
  missing capability.

  For C1 there is no required capability, so this contract is
  recorded but not exercised.

EVIDENCE-FIRST DESIGN:
  This ACT produces:
    .factory/evidence/ACT-CLINEMM-COMMAND-AUTHORITY-EXECUTION-CAPABILITY-BINDING01/
      entry-freeze.txt
      production-chain.md
      metadata-inventory.md
      metadata-provenance.md   <-- CORRECTION01 NEW
      binding-design.md        <-- CORRECTION01 REVISED
      red.txt                  (downstream Loss #2)
      red-upstream.txt         <-- CORRECTION01 NEW (upstream Loss #1)
      c1-disposition.txt       <-- CORRECTION01 UPDATED
      test-gates.txt           <-- CORRECTION01 UPDATED
      final-assessment.md      <-- C3
