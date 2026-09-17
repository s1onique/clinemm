ACT-CLINEMM-COMMAND-AUTHORITY-EXECUTION-CAPABILITY-BINDING01
production-chain.md

PER-INVOCATION EXECUTION PATH (background path; foreground path is
VscodeTerminalManager and is out of scope for this ACT — only the
host-owned supervised execution path carries an authorization-derived
capability).

1. SdkController.evaluateCommandToolApproval (apps/vscode/src/sdk/SdkController.ts)
   resolves the canonical command policy via
   `getCommandHostAuthorization(toolInput)` + `evaluateCommandPolicy(...)`
   and produces:
     {
       approved: boolean,
       decision: { kind: "allow"|"ask"|"deny", reason, source },
       executionPlan?: CommandExecutionPlan,   // CommandExecutionPlan.commands[i].matchedRuleSource
       hostAuthorization?: CommandHostAuthorization  // includes tempAuthorityEvidence
     }

2. SdkInteractionCoordinator (apps/vscode/src/sdk/sdk-interaction-coordinator.ts:80-110)
   accepts the `evaluateCommandToolApproval` callback. The result with
   `executionPlan` and `hostAuthorization` is captured at the coordinator
   (per spec: "the policy decision is computed at the coordinator").

3. AgentRuntime.executePreparedTool (sdk/packages/agents/src/agent-runtime.ts:2645+)
   receives the prepared tool call. It reads:
     - prepared.toolCall.toolCallId (per-call, exists)
     - prepared.toolCall.metadata (per-call, exists — read for runtime-
       internal reasons: `inputParseError`, `toolSource`)
   but constructs the AgentToolContext passed to `tool.execute(...)` with:
     metadata: this.config.toolContextMetadata    <-- session-wide

   The per-call `prepared.toolCall.metadata` is NOT propagated into the
   AgentToolContext. This is the LOAD-BEARING GAP. (Line 2788.)

4. AgentToolContext (sdk/packages/shared/src/agent.ts:337-347) shape:
     {
       sessionId?, agentId, conversationId?, runId?, iteration,
       toolCallId?, signal?,
       metadata?: Record<string, unknown>,     <-- session-wide
       snapshot?: AgentRuntimeStateSnapshot,
       emitUpdate?
     }
   Tool-call identity is already `toolCallId`. The session-wide
   `metadata` cannot safely carry a per-invocation capability marker.

5. createShellTool -> ShellExecutor (sdk/packages/core/src/extensions/tools/types.ts:79-83)
     type ShellExecutor = (
       command: string | StructuredCommandInput,
       cwd: string,
       context: AgentToolContext,
     ) => Promise<string>

6. createVscodeShellExecutor (apps/vscode/src/sdk/vscode-run-commands-tool.ts:571+)
   invokes `manager.start({command, cwd, shell, env, waitBudgetMs, executionDeadlineMs, maxOutputChars}, context)`
   on the BACKGROUND path. The marker-bearing context is in scope here.

7. CommandJobManager.start (apps/vscode/src/sdk/command-job-manager.ts:470)
   currently consumes only `context.signal` (line 736). `context.metadata`
   is NEVER read. `experimentalSandboxWorkspaceRoots` is a frozen
   constructor-time value (line 460). Capability construction at line 555:
     buildExperimentalReconCapability({ cwd, workspaceRoots })
   is called without per-invocation context.

SUMMARY OF SEAM LOSS POINTS:
  STEP 3 -> STEP 4: prepared.toolCall.metadata exists, AgentToolContext
                      receives only session-wide metadata. THE PRIMARY GAP.
  STEP 4 -> STEP 7: AgentToolContext.metadata exists, never read by
                      CommandJobManager.start. The cap-executor boundary
                      has the data, the executor ignores it.

CORRELATION IDENTITY:
  - prepared.toolCall.toolCallId (per-call, unique within a session)
  - CommandExecutionPlan.commands[i].commandIndex (per-command index)
  The `toolCallId` is sufficient correlation identity at the moment:
  one AgentToolContext corresponds to exactly one tool call, which maps
  to one CommandExecutionPlan entry whose `matchedRuleSource` is the
  authorization marker for that invocation.

CORRELATION LIFETIME:
  - toolCallId is unique per call. It exists in prepared.toolCall from
    model-stream parse until after tool.execute resolves. The AgentToolContext
    is constructed just before tool.execute is invoked (line 2780+ in
    agent-runtime.ts) and discarded after. Per-invocation correlation
    is straightforward.

KEY FINDING:
  There is already a per-call field that we could legally use — the
  existing `toolCall.metadata` in AgentToolCallPart (sdk/packages/shared/src/agent.ts:53-60).
  The runtime reads it for runtime-internal reasons but does NOT copy
  it into the per-call AgentToolContext that flows to tool.execute.
  This ACT will bridge THAT gap.

LIFECYCLE / ISOLATION EVIDENCE (per §21):
  - AgentToolContext is a per-call local object literal constructed at
    line 2780; it is not retained beyond tool.execute's returned
    promise. A marker placed there cannot leak to a future invocation.
  - Re-evaluation paths (requestToolApproval can be called multiple
    times; the runtime may rebuild the AgentToolContext on retry) would
    need to re-derive the marker from the still-live executionPlan; the
    marker is not a one-shot immutable object — it's a value attached
    at execute-time and discarded after.
