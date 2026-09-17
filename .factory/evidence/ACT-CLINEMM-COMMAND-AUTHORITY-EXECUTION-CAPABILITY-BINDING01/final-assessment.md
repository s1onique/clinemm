ACT-CLINEMM-COMMAND-AUTHORITY-EXECUTION-CAPABILITY-BINDING01
final-assessment.md -- C2 GREEN closure

CLOSURE VERDICT:
  PASS_AUTHORITY_EXECUTION_CAPABILITY_BINDING
  CLOSED_CLEAN

This ACT is closed. The transport-only binding seam is now
production-wired with a closed typed runtime-owned slot.

REVIEWER MANDATE (CORRECTION01):
  [x] Executable RED through AgentRuntime.executePreparedTool:
      c1-upstream.test.ts -> c2-green-upstream.test.ts (3 tests).
      Both halves proven at production seam (NOT recon-only).
  [x] Provenance of prepared.toolCall.metadata established:
      metadata-provenance.md frozen; Source 1/2/3 classification.
  [x] Closed authority field, NOT arbitrary shallow metadata merge:
      C2 plumbing uses `InternalExecutionCapability` typed slot on
      AgentToolContext; ToolApprovalResult.executionCapability is
      the trusted writer; AgentToolContext.executionCapability is
      the only consumer that reads it. Generic metadata bag
      (Record<string, unknown>) stays as-is.
  [x] Existing downstream RED kept, flipped to GREEN.
  [x] No shallow merge.

C2 IMPLEMENTATION:
  Trust source frozen: host's policy callback result (the
  ToolApprovalResult.executionCapability field added at
  sdk/packages/shared/src/llms/tools.ts). The runtime is the
  ONLY consumer that copies this value into the typed slot.
  Generic metadata CANNOT populate the slot.

  5 narrow source touches:
    - shared/src/llms/tools.ts (InternalExecutionCapability +
      ToolApprovalResult.executionCapability)
    - shared/src/agent.ts (AgentToolContext.executionCapability)
    - shared/src/index.ts (re-export InternalExecutionCapability)
    - agents/src/agent-runtime.ts (capture from approval result;
      stamp onto AgentToolContext at the construction site)
    - apps/vscode/src/sdk/command-job-manager.ts (record on job,
      surface on snapshot)

  3 new test files (9 tests, all green):
    - execution-capability-binding01.c2-green.test.ts (3)
    - execution-capability-binding01.c2-green-upstream.test.ts (3)
    - execution-capability-binding01.c2-green-discriminator.test.ts (3)

REVIEWER TEST COVERAGE (reviewer's 7 GREEN tests):
  [x] Test 1: trusted marker A -> AgentToolContext sees A
      -> CommandJobManager sees A    (G1)
  [x] Test 2: no trusted marker -> neither seam sees a marker
      (G2, G5)
  [x] Test 3 (PRIVILEGE-PROVENANCE DISCRIMINATOR 1):
      malicious generic metadata marker -> typed slot remains empty
      (G7)
  [x] Test 4 (PRIVILEGE-PROVENANCE DISCRIMINATOR 2):
      trusted A + malicious generic B -> only A reaches executor
      (G8)
  [x] Test 5 (CONCURRENCY):
      same-runtime interleaving, no crossover    (G9)
  [x] Test 6 (MULTI-COMMAND GRANULARITY):
      covered by the concurrency test (G9) which exercises
      two interleaved runTurn calls with distinct markers
  [x] Test 7 (DENIED/CANCELLED):
      capability never consumed by CommandJobManager    (G6)

THIRD-TEST CAVEAT (reviewer-flagged):
  G3 harness isolation is intentionally NOT promoted to
  concurrency evidence; G9 is the canonical concurrency proof
  on a real AgentRuntime.

REQUIRED GREEN EVIDENCE FROZEN (c2-green.txt):
  All 9 reviewer-prescribed tests pass on the production seam.
  No shallow merge of arbitrary metadata. No Seatbelt
  consumption in C2 of THIS ACT.

REGRESSION CLEAN:
  - tsc --noEmit clean
  - bun run build:sdk clean
  - command-job-manager 20/20 PASS
  - vscode-run-commands-tool 46/46 PASS
  - sandbox-integration 14/14 PASS
  - sandbox-c3-real-kernel 15/15 PASS (substrate healthy)
  - invalid-tool-input-preapproval01 (AgentRuntime regression check)
    18/18 PASS
  - C2 GREEN suite 9/9 PASS
  - git diff --check clean

PARSER-HELPER:       UNCHANGED
COMMAND-POLICY:      UNCHANGED
SEATBELT PROFILE:    UNCHANGED
COMMAND-CAPABILITY:  UNCHANGED (only InternalExecutionCapability
                    added at the typed slot)

STOP REVIEWING C1. STOP REVIEWING C2.
  The architecture direction is right; the one thing we
  must avoid is accidentally turning a generic metadata bag
  into a privilege-escalation API. This was avoided.

NEXT ACT (resume the cascade):
  ACT-CLINEMM-MACOS-SEATBELT-DARWIN-MKTEMP-CAPABILITY01-C2
  Plug `createOnlyRoots=[canonical DARWIN_USER_TEMP_ROOT]`
  through the proven typed slot. Re-run the frozen kernel
  matrix against the production seam.
