ACT-CLINEMM-COMMAND-AUTHORITY-EXECUTION-CAPABILITY-BINDING01
metadata-inventory.md

Every place a `metadata`-shaped object lives in the production chain.
This inventory exists so the design decision (where to place the per-call
capability marker) is data-driven, not assumption-driven.

| # | Location                                           | Type                            | Lifetime              | Identity                  | Source                                                  |
|---|----------------------------------------------------|---------------------------------|-----------------------|---------------------------|---------------------------------------------------------|
| 1 | `AgentToolCallPart.metadata`                       | `unknown`                       | per-call (model)      | toolCallId                | sdk/packages/shared/src/agent.ts:53-60                  |
| 2 | `AgentToolContext.metadata`                        | `Record<string, unknown>`       | per-call (runtime)    | sessionId+toolCallId      | sdk/packages/shared/src/agent.ts:337-347                |
| 3 | `AgentRuntimeConfig.toolContextMetadata`           | `Record<string, unknown>`       | session-wide          | sessionId only            | sdk/packages/agents/src/agent-runtime.ts:2788 (read)    |
| 4 | `ToolApprovalRequest.metadata`                     | `Record<string, unknown>`       | per-call (policy)     | toolCallId                | sdk/packages/shared/src/llms/tools.ts                   |
| 5 | `CommandExecutionPlan.commands[i].matchedRuleSource` | `string` (allow-only, undefined for non-allow) | per-call+per-command | commandIndex | sdk/packages/core/src/runtime/command-policy/command-policy-types.ts:172-176 |
| 6 | `CommandExecutionPlan.commands[i].commandIndex`    | `number`                        | per-call+per-command  | commandIndex              | sdk/packages/core/src/runtime/command-policy/command-execution-plan.ts  |

OBSERVATIONS:

A. The runtime fills `AgentToolContext.metadata` from
   `this.config.toolContextMetadata` (line 2788). That config field is
   populated by the host SDK integrator ONCE per session. So today,
   the per-call marker cannot flow through AgentToolContext without
   (a) the runtime adding a per-call override, OR
   (b) the host wiring toolCall.metadata -> config update before each
       call (race-prone; not per-call).

B. The runtime already has `prepared.toolCall.metadata` in scope at
   the construction site. Wiring a per-call metadata override that
   MERGES session-wide config + per-call `prepared.toolCall.metadata`
   is the narrowest change. The merge must be shallow (per-call entry
   wins on conflict) so the actor can't accidentally widen by dropping
   the session-wide values.

C. `ToolApprovalRequest.metadata` already carries per-call data
   (toolCallId-keyed). The `evaluateCommandToolApproval` callback
   receives this; the host can read it. That is the AUTH-SIDE carrier.
   But it doesn't currently flow back into the executor side.

D. `CommandExecutionPlan.commands[i].matchedRuleSource` is the
   authorization-derived capability marker we care about for THIS
   ACT's C2 (Apple mktemp authorization -> "host_safe_mktemp_default_temp"
   -> createOnlyRoots). For THIS ACT's C1 (synthetic marker) we don't
   use matchedRuleSource; we use a fresh synthetic field to prove the
   transport works.

DECISION FOR THIS ACT'S DESIGN:

For C1 RED/GREEN:
  Marker placement: `prepared.toolCall.metadata.executionCapability` (a
  per-call object containing only the synthetic zero-privilege marker
  in C1; in C2 the same field will carry the canonical createOnlyRoots
  payload).

  Plumbing in C2:
    a. The coordinator's `evaluateCommandToolApproval` callback receives
       the policy decision (today). It can place execution capability
       into the ToolApprovalRequest.metadata or into a host-owned
       capability registry keyed by toolCallId — but registry is
       forbidden per §13.
    b. Cleaner: the executor-side adapter (createVscodeShellExecutor)
       reads `context.metadata?.executionCapability` and forwards it
       into `manager.start(options.executionCapability, ...)`.
    c. Even cleaner: merge at the AgentRuntime.executePreparedTool seam.
       This is the host-neutral place. After C2:
         metadata: {
           ...this.config.toolContextMetadata,
           ...(prepared.toolCall.metadata ?? {}),
         }
       One shallow merge. Per-call wins. Session-wide not lost.
       The shell executor reads context.metadata.executionCapability
       and forwards to manager.start({ ..., executionCapability }).
       manager.start forwards into buildExperimentalReconCapability.

  For C1 (this ACT, synthetic marker only):
    The marker travels in `context.metadata.executionCapability` of
    type `{ correlationId, marker }`. ZERO filesystem/network authority.
    A C1 probe injects this synthetic-marker object via a HostHook
    OR via direct test-side monkeypatch on the runtime config. We
    capture what CommandJobManager.start sees and prove per-invocation
    isolation.

  Why not just `prepared.toolCall.metadata` (raw passthrough)?
    Because the runtime constructs the AgentToolContext fresh on every
    invocation. We must wire THAT construction to merge in the per-call
    metadata. There is no need to modify AgentToolContext's TYPE
    (Record<string, unknown> is enough) — the merge happens at the
    construction site.

WHY THIS IS NARROW ENOUGH:
  - 1 line at the runtime construction site (merge spread).
  - 1 line at the executor site (read context.metadata.executionCapability).
  - 1 line at CommandJobManager.start options (forward executionCapability).
  - 0 changes to the parser helper.
  - 0 changes to command-policy.
  - 0 changes to Seatbelt profile.
  - 0 changes to CommandCapability (in C1; in C2 we'll add
    writableRoots-by-createOnly-roots, but that's the C2 ACT's scope).
