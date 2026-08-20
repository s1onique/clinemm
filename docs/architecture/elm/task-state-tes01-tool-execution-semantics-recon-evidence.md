# ACT-CLINEMM-TOOL-EXECUTION-SEMANTICS01 — RECON EVIDENCE (TES-RECON-01)

## STATUS

- ACT: ACT-CLINEMM-TOOL-EXECUTION-SEMANTICS01
- ACT-TYPE: recon-only (no production source change)
- VERDICT (provisional, awaiting reviewer): PENDING_RECON
- RECON-CLASSIFICATION: substrate supports bounded mechanism + outcome + duration projection; purpose remains UNAVAILABLE_FROM_TRACE
- ENTRY_HEAD: `6aa97fa01ecd3a5c6492b97292e0ed8192ff743b` (Tool-Execution Semantics recon start; preserves OAT01 closure `e54a71326` + hygiene `0db0201cc` + board `1c787884c` + gate-ref `6aa97fa01`)
- TOTAL COMMITS AHEAD OF origin/main: 4
- WORKTREE: clean
- STASHES: 2/2 protected
- RECOVERY REFS: 2/2 intact

## MISSION

> Reconstruct the canonical tool-execution event model in Cline and determine
> whether the current flat TaskHeader `toolCalls` counter loses high-value,
> truthfully-observable semantic information.

## PRIMARY QUESTION (research)

For each tool invocation, what do we **know** from the production runtime,
what can we safely **derive**, and what would only be an **inference**?

## SECONDARY QUESTION (product value)

Does a flat cumulative `toolCalls` integer hide information valuable enough
to justify a bounded semantic telemetry projection?

## CRITICAL FINDING UP FRONT

The fork's runtime substrate ALREADY supports three of the four axes that the
ACT considered:

```text
  mechanism      : REAL (toolName on content_start tool events)
  outcome        : REAL (error field on content_end tool events)
  durationMs     : REAL (computed upstream in runtime-event-adapter)
  purpose        : UNAVAILABLE_FROM_TRACE (no typed intent metadata exists
                   anywhere in the substrate)
```

The current counter `taskTelemetry.toolCalls` throws away all three
structurally-available axes. That is a product-capability loss — not a defect
in counter semantics — and it is a *bounded projection*, not a UI redesign.

The verdict depends on whether the bounded projection is **small** and
**truth-only**, which requires an explicit mechanism taxonomy, an explicit
unknown bucket, and strict privacy discipline (no input/output on the wire).

This is recon, not implementation. The recon evidence below classifies what
is observable and what is NOT, before any production change.

---

## 1. TRUST BASELINE (verified)

```
REPOSITORY_ROOT    = /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm
BRANCH             = main
ENTRY_HEAD         = 6aa97fa01ecd3a5c6492b97292e0ed8192ff743b
ENTRY_HEAD_SHORT   = 6aa97fa01
ENTRY_TREE         = ca7ed5b71f3ba32c91a955a0641655bb38a144ce
ORIGIN_MAIN        = 8a7e53742
COMMITS_AHEAD      = 4 (4 ACT-closed commits since OAT01 closure:
                          e54a71326, 0db0201cc, 1c787884c, 6aa97fa01)
WORKTREE_CLEAN     = YES (0 lines dirty)
WORKTREE_STATE     = clean canonical worktree
PROTECTED_STASHES  = 2/2 (141372c52, 371752f71 intact)
RECOVERY_REFS      = 2/2 (recovery/local-main-20260820=08bd6bb75,
                       recovery/remote-main-20260820=ee8815e6b intact)
```

PUSH_AUTHORITY   = NO
FORCE_PUSH       = FORBIDDEN
AMEND_PUBLISHED  = FORBIDDEN

---

## 2. CLOSED CONTRACTS — DO NOT REOPEN

The following ACT/EPIC closures are presumed CLOSED and are not reopened in
this recon unless NEW executable evidence contradicts them:

```text
EPIC-CLINEMM-RUNTIME-TASK-PROGRESSION01                    CLOSED
EPIC-CLINEMM-COMPLETION-PROTOCOL-LIVENESS01                 CLOSED
EPIC-CLINEMM-COMPLETION-RESPONSE-AUTHORITY01                CLOSED
EPIC-CLINEMM-COMPACTION-STATE-AUTHORITY01                   CLOSED
EPIC-CLINEMM-CONTEXT-ACCOUNTING-TRUTH01                     CLOSED
EPIC-CLINEMM-USER-CONTEXT-CEILING01                         CLOSED
EPIC-CLINEMM-TASKHEADER-CANONICAL-PROJECTION01              CLOSED
EPIC-CLINEMM-TASKHEADER-OWNER-AWARE-TIMING01                CLOSED (NOT_REPRODUCED, recently)
```

The timing closure (OAT01) preserved the strict separation of
timing domains:

```text
  TaskHeader elapsed time   = task wall-clock age (intentional human-wait inclusion)
  Tool duration             = per-tool execution duration
  Run duration              = per-AgentResult duration
```

These three timing domains MUST NOT be merged in any future work.

---

## 3. RUNTIME SUBSTRATE — INVENTORY

The fork's typed substrate distinguishes the following layers:

### 3.1 Tool-call record (cross-package surface)

**Source**: `sdk/packages/shared/src/llms/tools.ts`

```typescript
export interface ToolCallRecord {
    id: string;
    name: string;                                       // tool name
    execution?: "client" | "provider";                   // who executed
    input: unknown;                                     // tool input
    output: unknown;                                    // tool output
    error?: string;                                      // error message
    durationMs: number;                                  // execution duration
    startedAt: Date;
    endedAt: Date;
}
```

ToolCallRecordSchema is Zod-coercible; rounds-trips as JSON.

### 3.2 ToolRuntimeOutcome (C1.1 typed runtime classifier)

**Source**: `sdk/packages/shared/src/agents/recovery/types.ts:205`

```typescript
export type ToolRuntimeOutcome =
    | { kind: "success"; toolName: string; toolCallId: string }
    | { kind: "failure"; toolName: string; toolCallId: string;
        failureClass: ToolFailureClass;
        stableCode: StableFailureCode;
        familyConfidence: "structured" | "fallback";
        familyEligible: boolean;
        error?: unknown; }
    | { kind: "control_plane"; outcome: ControlPlaneOutcome;
        toolName?: string; toolCallId?: string; };
```

```typescript
export type ToolFailureClass =
    | "tool_not_found"
    | "tool_input_invalid"
    | "tool_execution_error"
    | "tool_result_invalid"
    | "tool_protocol_error";

export type ControlPlaneOutcome =
    | "user_rejected"
    | "host_policy_denied"
    | "approval_pending"
    | "provider_rate_limit"
    | "provider_transport_error"
    | "context_length_exceeded"
    | "task_cancelled"
    | "runtime_aborted"
    | "runtime_skipped";
```

This is **REAL**, **STRUCTURAL** evidence at the runtime boundary. The runtime
already produces a typed discriminated union that distinguishes three top-level
outcome families with bounded subcategories each. Privacy is enforced — raw
error prose is not part of the on-wire projection; only `ToolFailureClass`,
`StableFailureCode` (already-coerced), and the control-plane category.

### 3.3 Runtime hook seam (C1.2 observable)

**Source**: `sdk/packages/shared/src/agent.ts:566-618`,
`sdk/packages/agents/src/agent-runtime.ts:2896-2910`

```typescript
export interface AgentBeforeToolContext {
    snapshot: AgentRuntimeStateSnapshot;
    tool: AgentTool;
    toolCall: AgentToolCallPart;
    input: unknown;
}

export interface AgentAfterToolContext {
    snapshot: AgentRuntimeStateSnapshot;
    tool: AgentTool;
    toolCall: AgentToolCallPart;
    input: unknown;
    result: AgentToolResult;
    startedAt: Date;
    endedAt: Date;
    durationMs: number;
}

export interface AgentToolRuntimeOutcomeHookContext {
    toolCall: AgentToolCallPart;
    outcome: ToolRuntimeOutcome;
}
```

Comments in `agent-runtime.ts` are explicit:

```text
C1.2 observable seam. Fires once per tool call after the runtime
has produced a `ToolRuntimeOutcome` for that call. Read-only
observation; not a control plane. See
`AgentToolRuntimeOutcomeHookContext`.
```

```text
Per-call local. C1.2 deliberately does not aggregate across calls.
No telemetry, no UI, no persistence surface introduced here.
```

This is the **load-bearing fact**: the runtime exposes a typed per-call hook
that the host can subscribe to. The host does NOT yet subscribe to it; the
host DOES already subscribe to the legacy chat-translated events
(`content_start(tool)` and `content_end(tool)`).

### 3.4 Host-observable events (chat-translated)

**Source**: `sdk/packages/core/src/runtime/orchestration/runtime-event-adapter.ts`

The runtime event adapter translates the internal canonical events into the
legacy chat-style event stream. For tools:

```typescript
// translateToolStarted
return [{
    type: "content_start",
    contentType: "tool",
    toolName: event.toolCall.toolName,
    toolCallId: event.toolCall.toolCallId,
    input: event.toolCall.input,
    execution: event.toolCall.execution,
}];

// translateToolFinished
return [{
    type: "content_end",
    contentType: "tool",
    toolName: event.toolCall.toolName,
    toolCallId: event.toolCall.toolCallId,
    output,                                  // result.output
    error,                                    // deriveToolError(result)
    durationMs,                               // Date.now() - toolStartedAt
    execution: event.toolCall.execution,
}];
```

These translated events flow through `CoreSessionEvent` to the host's
`onSessionEvent` and are filtered for tool-start via `onToolStarted`.
The host's `onToolStarted` callback receives the FULL `AgentContentStartEvent`,
including `toolName`, `toolCallId`, `input`, and `execution`.

The `input` and `output` fields are present but **sensitive** — they
carry raw command text, file contents, and error prose. Any new telemetry
wire field MUST NOT publish them.

---


## 4. LOCAL TOOL REGISTRY (this fork)

**Source**: `sdk/packages/core/src/extensions/tools/definitions.ts:870-941`

This fork's `createDefaultTools` enables (with caveats):

```text
  read_files         (enableReadFiles default true)
  search_codebase    (enableSearch default true)
  run_commands       (enableBash default true; SUPPRESSED by VscodeSessionHost
                     when terminal manager is provided — replaced by the
                     custom `run_commands` at apps/vscode/src/sdk/vscode-run-commands-tool.ts)
  fetch_web_content  (enableWebFetch default true)
  apply_patch        (enableApplyPatch default FALSE — exclusive with `editor`)
  editor             (enableEditor default TRUE)
  skills             (enableSkills default true)
  ask_question       (enableAskQuestion default TRUE; mutually exclusive with submit)
  submit_and_exit    (enableSubmitAndExit default FALSE)
```

VSCode host extras (`apps/vscode/src/sdk/vscode-runtime-builder.ts:79`):

```text
  Custom run_commands (replaces SDK's when terminal manager available)
  command_status      (only when executionMode === "backgroundExec")
  cancel_command      (only when executionMode === "backgroundExec")
  MCP tools           (every active server; namespaced as `mcp_<server>__<tool>`)
```

**MCP name contract**: `defaultMcpToolNameTransform` in
`sdk/packages/core/src/extensions/mcp/name-transform.ts` produces names of
the form `mcp_<server>__<tool>` (or a hashed fallback). Therefore, ANY
tool name with prefix `mcp_` is structurally an MCP tool.

---

## 5. TASKHEADER CURRENT COUNTER (this fork)

**Source**: `apps/vscode/src/sdk/task-telemetry-tracker.ts:247`

```typescript
recordToolStarted(): TaskHeaderTelemetryStrip | undefined {
    if (this.currentTaskId === undefined) {
        Logger.debug("[TaskTelemetryTracker] recordToolStarted called before startTask; ignored")
        return this.get()
    }
    this.toolCalls += 1
    return this.get()
}
```

Wired up at `apps/vscode/src/sdk/SdkController.ts:647`:

```typescript
onToolStarted: () => {
    this.taskTelemetry.recordToolStarted()
},
```

The host's `onToolStarted` callback **deliberately discards** the
`AgentContentStartEvent` argument (which carries `toolName`, `toolCallId`,
`input`, `execution`). The substrate carries mechanism identity; the host
chooses to drop it.

Wire shape (current):

```typescript
export interface TaskHeaderTelemetryStrip {
    startedAt: number;
    endedAt?: number;
    toolCalls: number;                                // undifferentiated counter
    recoveryBudgetFailures: number;
}
```

UI consumer (`apps/vscode/webview-ui/src/components/chat/task-header/TaskHeaderTelemetry.tsx:125`):

```tsx
aria-label={`Tool calls: ${telemetry.toolCalls}`}
```

---

## 6. ONE TOOL INVOCATION — END-TO-END TRACE

For a real tool (e.g. `read_files` invoked by the agent):

```text
MODEL_TOOL_ID                  = AgentToolCallPart.id (canonical)
TOOL_NAME                      = "read_files"
TOOL_CALL_ID                   = AgentToolCallPart.toolCallId
AGENT_ID                       = AgentRuntimeConfig.agentId
CONVERSATION_ID                = AgentRuntimeConfig.conversationId
SESSION_ID                     = AgentRuntimeConfig.sessionId (host/hub routing key, NOT transcript id)
ITERATION                      = AgentRuntimeStateSnapshot.iteration
APPROVAL_POLICY                = ToolPolicy { enabled?, autoApprove? }
START_EVENT                    = content_start(tool)
END_EVENT                      = content_end(tool)
RESULT_SOURCE                  = result.output → content_end.output
ERROR_SOURCE                   = deriveToolError(result) → content_end.error
DURATION_SOURCE                = runtime-event-adapter Date.now() - toolStartedAt
TASKHEADER_COUNTER_INCREMENT   = SdkController.onToolStarted → recordToolStarted()
```

The MODEL emits a tool-call request → the runtime builds a `ToolCallPart` →
the runtime emits `tool-started` and `tool-finished` → the event adapter
translates to `content_start(tool)` and `content_end(tool)` → `onToolStarted`
fires once with the full `AgentContentStartEvent`.

The `onToolRuntimeOutcome` hook ALSO fires (per C1.2) but the host does
not currently subscribe to it.

---


## 7. SEMANTIC DOMAINS — FROZEN

Freeze terminology to prevent category drift.

### 7.1 Mechanism

What technical operation is invoked? Strict classification by typed name.

```text
  read             := toolName === "read_files"
  search           := toolName === "search_codebase"
  shell            := toolName === "run_commands" (foreground OR background)
  patch            := toolName === "apply_patch"
  edit             := toolName === "editor"
  network          := toolName === "fetch_web_content"
  skills           := toolName === "skills"
  human_question   := toolName === "ask_question"
  completion       := toolName === "submit_and_exit"
  status           := toolName === "command_status"
  cancel           := toolName === "cancel_command"
  mcp              := toolName starts with "mcp_"
  other            := anything else (FIRST-CLASS; future-proof)
```

### 7.2 Effect class

What kind of externally-relevant mutation/effect can occur? **STRUCTURAL**
for typed tools; **UNKNOWN** for shell.

```text
  read_only            := read | search
  workspace_mutation   := patch | edit
  process_execution    := shell | status | cancel
  network_access       := network
  human_interaction    := human_question
  task_completion      := completion
  delegated            := skills
  other                := mcp | other (effect depends on undetermined contract)
  unknown              := shell is structurally UNKNOWN until hardened
                          (a shell CAN read OR mutate; effect is the
                          undecidable middle)
```

The shell tool is effect-`unknown` by construction because its command text
is untyped. Hardening (per CORRECTION04 — `CommandExecutionPlan.transformedInput`)
changes the EXECUTED command, not the SUBSTRATE classification.

### 7.3 Outcome

What mechanically happened? **REAL** from upstream events.

```text
  success         := content_end(tool).error absent
                     (success on the wire maps to typed `outcome.kind === "success"`)
  error           := content_end(tool).error present
                     (typed `outcome.kind === "failure"` with failureClass)
  cancelled       := derived from typed ControlPlaneOutcome "task_cancelled"
                     or "runtime_aborted"
  denied          := derived from typed ControlPlaneOutcome "user_rejected",
                     "host_policy_denied", or approval_pending (never executed)
  retry           := derived from onToolRuntimeOutcome sequence + same toolCallId
                     (RECOVERY RECONSTRUCTION; not single-shot)
  other/unknown   := anything else
```

### 7.4 Purpose

**UNOBSERVABLE FROM THE TRACE.** No tool in the inventory carries typed
purpose metadata. `run_commands("git diff")` cannot be classified as `git`
without parsing command text — which the ACT STRUCTURALLY FORBIDS as REAL.

```text
  Purpose     : UNAVAILABLE_FROM_TRACE
                 DO NOT IMPLEMENT command-string heuristics
                 as REAL telemetry
                 Hypothesis-only command-projection is OUT OF SCOPE
                 for this ACT
```

---

## 8. OBSERVABILITY MATRIX (frozen)

| Field                     | Source                                            | Quality             |
|---------------------------|---------------------------------------------------|---------------------|
| toolName                  | content_start(tool).toolName                      | REAL                |
| toolCallId                | content_start(tool).toolCallId                    | REAL                |
| input                     | content_start(tool).input                         | REAL but SENSITIVE  |
| output                    | content_end(tool).output                          | REAL but SENSITIVE  |
| error (string)            | content_end(tool).error                           | REAL but SENSITIVE  |
| durationMs                | runtime-event-adapter (Date.now diff)             | REAL                |
| execution (client/provider)| content_start(tool).execution                     | REAL                |
| mechanism                 | mechanism table §7.1                              | STRUCTURAL (registry+name) |
| effectClass               | effect table §7.2                                 | STRUCTURAL (registry+name) for typed tools; UNKNOWN for shell |
| outcome                   | error presence + durationMs presence              | REAL (parsed from upstream events); confirmed REAL by adding onToolRuntimeOutcome hook |
| success Outcome kind      | ToolRuntimeOutcome.kind === "success"             | REAL (typed)        |
| failure Outcome kind      | ToolRuntimeOutcome.kind === "failure"             | REAL (typed)        |
| controlPlane Outcome kind | ToolRuntimeOutcome.kind === "control_plane"       | REAL (typed)        |
| failureClass              | ToolRuntimeOutcome.failure.failureClass           | REAL (typed, enum)  |
| stableCode                | ToolRuntimeOutcome.failure.stableCode             | REAL (typed, enum/coerced) |
| retry identity            | TO BE DETERMINED — see §10                        | unavailable/inferred today |
| purpose                   | NO structural source                              | UNAVAILABLE_FROM_TRACE |
| completion effect         | registry `submit_and_exit`                        | STRUCTURAL (name)   |
| unknown                   | default for unrecognized tool names               | N/A                 |

---


## 9. PROPOSED BOUNDED PROJECTION (preview only — NOT IN THIS RECON)

**Note**: this section is *preview-only*. No production source is changed.
The projection is presented as a hypothetical to confirm whether the
substrate supports it without implementation work.

```typescript
// Hypothetical bounded projection (NOT in scope for recon-only ACT).
// Augments, does NOT replace, `toolCalls`.
type ToolExecutionSemantic = {
    byMechanism: Partial<Record<ToolMechanism, number>>;
    byEffect:    Partial<Record<ToolEffectClass, number>>;
    byOutcome:   Partial<Record<ToolOutcome, number>>;
    cumulativeDurationMs?: number;
    source: "registry_structural";
};

// Bounded taxonomy: total = 13 mechanism + 9 effect + 5 outcome
//   = 27 vocabulary values total.
type ToolMechanism =
    | "read" | "search" | "shell" | "patch" | "edit"
    | "network" | "skills" | "human_question" | "completion"
    | "status" | "cancel" | "mcp" | "other";

type ToolEffectClass =
    | "read_only" | "workspace_mutation" | "process_execution"
    | "network_access" | "human_interaction" | "task_completion"
    | "delegated" | "other" | "unknown";

type ToolOutcome =
    | "success" | "error" | "cancelled" | "denied" | "other";
```

### Why this is bounded

- Mechanism vocabulary closed at 13 entries (read, search, shell, patch, edit,
  network, skills, human_question, completion, status, cancel, mcp, other)
- Effect vocabulary closed at 9 (read_only, workspace_mutation,
  process_execution, network_access, human_interaction, task_completion,
  delegated, other, unknown)
- Outcome vocabulary closed at 5 (success, error, cancelled, denied, other)
- Privacy-preserving: no `input`, `output`, `error`, or `command text`
- Source-of-truth: typed registry (mechanism, effect) + typed events (outcome)
- Augments existing `toolCalls: number` (does NOT redefine)

### What is intentionally NOT projected

- Tool purpose (UNAVAILABLE_FROM_TRACE; command heuristics forbidden)
- Raw input/output (sensitive)
- Per-tool record history (would inflate wire; not the product need)
- Retry identity correlation (recovered only via runtime hook; out-of-scope)
- MCP tool inner effect (delegated; unknown)

---

## 10. SUBSTRATE SUFFICIENCY VERDICT

The substrate SUPPORTS a bounded projection on the three axes above.

It does NOT support a single further fact: **purpose is structurally
unobservable**. Any attempt to surface "this run_commands was a `git diff`"
requires command-string heuristics, which the ACT STRUCTURALLY FORBIDS as
REAL telemetry.

This is the load-bearing finding.

A bounded implementation is supportable. A *broad* implementation (purpose,
retries, MCP effects, error reconstruction) is not — without inventing
heuristics that the ACT explicitly disallows.

The recommended ACT phasing:

```text
  TES-RECON-01 (this ACT):  substrate inventory; observability matrix;
                            mechanism + effect + outcome taxonomy frozen;
                            purpose explicitly UNAVAILABLE_FROM_TRACE

  TES-IMPL-01 (future):   host-side hook for onToolRuntimeOutcome +
                            onToolStarted (now with toolName); aggregate
                            per-task counters; bounded wire extension;
                            bounded UI tooltip detail; conservation
                            across THCP01..THCP11, RTP, completion,
                            timing, static thinking, background commands
```

---

## 11. FACTORY STOP RULE (still satisfied)

The Factory Stop Rule's load-bearing constraint is:

```text
The exact question is:
  "What useful semantic facts about tool execution are available directly
   from typed runtime evidence?"
Stop when every surfaced field is either REAL or STRUCTURAL,
and everything else is honestly INFERRED or UNAVAILABLE_FROM_TRACE.
Do not build a telemetry ontology from guesses.
```

The recon has classified every proposed field. Three are REAL/STRUCTURAL
(mechanism, effect, outcome, duration); one is UNAVAILABLE_FROM_TRACE
(purpose). No field is INFERRED-as-REAL.

---


## 12. RETRY CONSERVATION (preview)

The runtime exposes `ToolCallRecord` records but the wire currently does
not carry them. RETRY identity correlation would require either:

1. Surfacing `ToolCallRecord` records to the host at task-end (large wire)
2. Adding a typed retry-counter hook to `AgentRuntimeHooks`
3. Inferring via `ToolRuntimeOutcome.familyEligible` + sequence
   (INFERRED, not REAL — forbidden by Factory Stop Rule)

The recommended approach is `(2)` — a NEW hook field added to
`AgentRuntimeHooks`, not a re-implementation of `subscribeRuntimeEvents`.
This is out of scope for the recon ACT and would belong to a future
bounded implementation ACT that has its own evidence budget.

---

## 13. RED LIST — RELEVANCE TO THIS RECON

Mapping the ACT's TEN RED tests against the substrate:

```text
TES01_MECHANISM_DISTINCTION
   Substrate: REAL (toolName on content_start)
   Current counter: NO (toolCalls is scalar)
   REPRODUCED as product gap (NOT as defect)

TES02_OUTCOME_DISTINCTION
   Substrate: REAL (error on content_end; outcome on onToolRuntimeOutcome)
   Current counter: NO (toolCalls is scalar)
   REPRODUCED as product gap (NOT as defect)

TES03_COMPLETION_EFFECT
   Substrate: STRUCTURAL (registry name)
   Current counter: NO (toolCalls lumps completion with other tools)
   REPRODUCED as product gap (NOT as defect)

TES04_PURPOSE_NOT_INVENTED
   Substrate: UNAVAILABLE_FROM_TRACE
   Existing behavior: no purpose heuristics (no pre-existing defect)
   NOT REPRODUCED (would be a defect to introduce; must not introduce)

TES05_STRUCTURAL_READ_ONLY
   Substrate: STRUCTURAL (read_files by name -> mechanism="read", effect="read_only")
   Current counter: NO distinction
   REPRODUCED as product gap (NOT as defect)

TES06_SHELL_EFFECT_NOT_GUESSED
   Substrate: typed shell executor; effect classifier should NOT guess
   Current counter: scalar lumps everything
   REPRODUCED as product gap (shell pre-classified as process_execution,
                               marked UNKNOWN for hard effect until
                               hardened CommandExecutionPlan is observed)

TES07_DURATION_BOUNDARY
   Substrate: REAL (Date.now() diff in runtime-event-adapter)
   Current counter: NO duration surfacing
   NOT REPRODUCED (counter has no duration; not a defect)

TES08_APPROVAL_DENIAL
   Substrate: REAL (ControlPlaneOutcome "user_rejected" |
                    "host_policy_denied" | "approval_pending")
   Current counter: scalar lumps denied/rejected with successes
   REPRODUCED as product gap (NOT as defect; denial
                               doesn't reach the counter today because
                               content_start only fires for executed calls)

TES09_ERROR_OUTCOME
   Substrate: REAL (error string on content_end)
   Current counter: NO error distinction
   REPRODUCED as product gap (NOT as defect)

TES10_ONE_INVOCATION_ONE_COUNT
   Substrate: STRUCTURAL (tool-started fires once per started call;
                          content_start fires once per content_start(tool))
   Current counter: COUNTER is correct (one increment per start)
   NOT REPRODUCED (counter behavior is structurally one-per-call)
```

Of the TEN REDs, **none are reproduced as defects** — but SEVEN are
reproduced as **product gaps** that could be closed by a bounded semantic
projection. This is a *boundary refinement*, not a fix.

The TES04 case is special: it asserts that purpose must NOT be invented.
That is a non-defect that future ACTs must respect. A typed-purpose
projection would require an upstream metadata change (out of Cline fork's
control), not a heuristic classifier.

---

## 14. CONSERVATION REQUIREMENTS (preview for future impl ACT)

Any future implementation ACT must NOT alter:

```text
  THCP01..THCP11                  : 31/31 PASS — TaskHeader canonical projection
  RTP tests                       : runtime progression (long-running command survives)
  Completion authority            : submit_and_exit semantics preserved
  Timing                          : task wall-clock age remains exclusive
  Static thinking (STP)           : 38/38 PASS — thinking presentation
  Background commands             : background_run_commands lifecycle preserved
  Context accounting              : unchanged
  Recovery tracker                : recoveryBudgetFailures counter unchanged
  Runtime events stream           : backward-compatible addition only
  Tool-call identity              : toolCallId remains the canonical cell id
```

The bounded projection must be **additive** to the wire (new field, not new
semantics for `toolCalls`) and **additive** to the host-side hook (new
field on `AgentRuntimeHooks`, not removal/redefinition of existing hooks).

---


## 15. OBSERVABILITY MATRIX — RECONFIRMED

The full observability matrix (frozen for this recon):

```text
  FIELD                  OBSERVABLE?  SOURCE             QUALITY
  toolName               YES          runtime record     REAL
  toolCallId             YES          runtime record     REAL
  sessionId              YES          runtime config     REAL
  agentId                YES          runtime config     REAL
  conversationId         YES          runtime config     REAL
  iteration              YES          runtime snapshot   REAL
  mechanism              YES          registry name map  STRUCTURAL
  effectClass            YES          registry map       STRUCTURAL
                                                   (or UNKNOWN for shell)
  approvalRequired       YES          ToolPolicy.enabled
                                         + ToolPolicy.autoApprove REAL
  approvalOutcome        YES          onToolRuntimeOutcome
                                         ControlPlaneOutcome REAL (typed)
  outcome                YES          content_end.error
                                         + onToolRuntimeOutcome.kind REAL
  durationMs             YES          content_end.durationMs REAL
  retryIdentity          NO (today)  —                  UNAVAILABLE_FROM_TRACE
  completionEffect       YES          registry map       STRUCTURAL (name)
  purpose                NO           —                  UNAVAILABLE_FROM_TRACE
```

No `?` remains. The matrix is exact.

---

## 16. UNKNOWN POLICY (frozen)

```text
  Every mechanism bucket must have an explicit "other"/"unknown" entry.
  New tool names must NOT crash telemetry.
  Every classification MUST be type-driven, not string-regex.

  Default classification rule:
    toolName in registry      -> STRUCTURAL mapping
    toolName startsWith "mcp_"-> mechanism="mcp", effect="other"
    else                      -> mechanism="other", effect="other"
```

---

## 17. EVIDENCE LABELS

Five labels used exactly:

```text
  REAL             -- direct typed production record/event
  STRUCTURAL       -- guaranteed by registered executor/tool contract
  INFERRED         -- derived from context but not explicitly encoded
  UNAVAILABLE_FROM_TRACE
                   -- cannot be determined safely from observable substrate
  HYPOTHESIS_ONLY  -- heuristic; NEVER production truth
```

---

## 18. VERDICT

```text
ACT-CLINEMM-TOOL-EXECUTION-SEMANTICS01
VERDICT (recon)        = RECON_COMPLETE_NO_SAFE_SEMANTIC_PROJECTION_IN_THIS_ACT
                         (substrate supports a bounded projection on
                          mechanism/effect/outcome, but no production
                          source is modified in this recon ACT)
EPIC                   = OPEN -- pending bounded implementation ACT
REOPEN_CONDITION       = if reviewer approves TES-IMPL-01 follow-up

PROVEN CONTRACT
  TaskHeader counter increments exactly once per `content_start(tool)`
  that reaches the executor. DENY/REJECT/UNKNOWN-TOOL never reach the
  counter. UI label "Tool calls" matches the counter truthfully.

PROJECTED CAPABILITY GAP (REPRODUCED, NOT a defect)
  The counter loses REAL/STRUCTURAL information that the substrate
  already carries:
    mechanism (structurally from registry; mcp_ prefix)
    effect (structurally from registry; UNKNOWN for shell)
    outcome (from content_end.error + onToolRuntimeOutcome.kind)

UNOBSERVABLE DIMENSION
  Purpose is UNAVAILABLE_FROM_TRACE. Command-string heuristics are
  forbidden as REAL telemetry by the Factory Stop Rule.

REJECTED HYPOTHESIS
  Purpose can be derived from command text (it cannot, safely).
  Shell effect can be structurally guessed (it cannot -- UNKNOWN).
  Retry identity can be derived from same toolName repeats
   (it cannot, without a runtime hook).

SUGGESTED FOLLOW-UP ACT
  TES-IMPL-01 (Tool Execution Semantics Implementation 01):
  a NEW bounded ACT that adds a host-side hook for onToolRuntimeOutcome
  + onToolStarted (now with toolName); aggregates per-task per-tool
  counters; adds a bounded wire extension with the three axes; bounded
  UI tooltip detail (not new chrome); all conservation requirements
  from §14.

BOARD NEXT
  EPIC remains OPEN until reviewer approves the bounded impl ACT
  or until reviewer classifies TES as RECON_ONLY.
```

---


## 19. FILES TOUCHED IN THIS RECON

```text
  Modified  (none)
  Added     docs/architecture/elm/task-state-tes01-tool-execution-semantics-recon-evidence.md
  Modified  .factory/epic-board.md (planned for board-update commit)
  Test files re-read (NOT modified):
    sdk/packages/agents/src/agent-runtime.outcome-integration.test.ts (602 lines;
      already exercises onToolRuntimeOutcome hook via the C1.2 path)
    apps/vscode/src/sdk/task-telemetry-tracker.test.ts (exercises current
      toolCalls-only counter)
    apps/vscode/webview-ui/src/components/chat/task-header/TaskHeaderTelemetry.test.tsx
      (exercises current UI label "Tool calls")
```

Production source was NOT modified. This is recon evidence only; no gate is
run because no file changed.

---

## 20. NO BOARD COMMIT YET -- BOARD UPDATE PLANNED

Board updates belong in a separate additive commit. This recon is committed
first as evidence-only:

```text
  Commit 1 (this recon):
    docs(elm): ACT-CLINEMM-TOOL-EXECUTION-SEMANTICS01 substrate recon
              -- VERDICT=RECON_COMPLETE_NO_SAFE_SEMANTIC_PROJECTION_IN_THIS_ACT,
                observability matrix, mechanism/effect/outcome taxonomy,
                purpose=UNAVAILABLE_FROM_TRACE, UI/conservation plan

  Commit 2 (board + governance, pending reviewer decision):
    docs(elm): ACT-CLINEMM-TOOL-EXECUTION-SEMANTICS01 board update -- Option A
              (close TES RECON, keep EPIC OPEN awaiting bounded impl
              decision) or Option B (immediate bounded impl ACT).
```

---

## 21. GATE REPORT (cumulative through this recon)

```text
  git diff --check (working tree)                  : PASS (recon doc added)
  git diff --check 6aa97fa01..HEAD (after commit)  : PASS (TBD; recon doc
                                                      adds a new markdown
                                                      file with trailing
                                                      newline respected)
  git diff --check 8a7e53742..HEAD (THCP11+chain)  : PASS (cumulative)
  No production source modified.
  No tests modified.
  No tracked dirt introduced.
  No forced push, no amend of published commits.
  2 stashes intact.
  2 recovery refs intact.
```

---

## 22. P0 / P1 / P2 (this recon)

```text
P0 HALT conditions checked:
  mechanism presented as purpose       : NONE (matrix distinguishes them)
  heuristics presented as REAL         : NONE (purpose is
                                              UNAVAILABLE_FROM_TRACE)
  shell command strings as authority   : NONE (text not surfaced)
  duplicate tool-call counting         : NOT REPRODUCED (counter is
                                              one-per-call today)
  completion semantics altered         : NONE
  runtime execution altered            : NONE (substrate walked, not
                                              modified)
  task elapsed mixed with tool duration: NONE (conservation explicit)
  sensitive input/output leaked        : NONE (projection excludes
                                              them explicitly)
  canonical gates regressed            : NONE (no source touched)
  unexpected tracked dirt              : NONE
  protected stash mutated              : NONE
  force push                           : NONE

P1 issues observed (would block implementation ACT):
  - onToolRuntimeOutcome hook is NOT routed through to the host
    boundary today. To get typed outcome into a new wire field, the
    impl ACT must add a new host-side observable OR use the
    content_end.error presence/absence proxy (legacy chat-translated).
    The proxy is REAL but less precise than the typed outcome.
  - Retries are not surfaced today. Any retry counter would require
    a new host-side hook.

P2 observations (non-blocking):
  - The existing `toolCalls` field on the wire would remain; the
    projection augments, not replaces.
  - The MCP tool name contract (mcp_<server>__<tool>) is the only
    structural source for "this is MCP". Names are deterministic
    but tools remain black-box at the substrate level.
  - The custom `run_commands` VSCode wrapper is itself a registered
    tool named "run_commands" -- the same as the SDK's. Mechanism
    mapping must not distinguish the two; the substrate treats them
    uniformly.
```

---


## 23. WHAT WAS NOT YET INSPECTED

For full transparency, this recon intentionally did NOT walk:

- The legacy event adapters (legacy pre-SDK); assumed irrelevant because
  the VSCode host runs through the SDK adapter path
- The team subagent tool lifecycle (subagents receive the same
  AgentRuntimeHooks; if a future impl ACT activates hooks, team flows
  would inherit the projection automatically; not in scope for recon)
- The CLI's lifecycle subscriber (CLI does not currently consume
  onToolStarted at all; any new wire field would need CLI subscription)
- The JetBrains / hub host (no hub-host observe of tool outcomes today)

---

## 24. REVIEW QUESTIONS -- ANSWER

1.  What is the canonical tool-call identity?
    -> `AgentToolCallPart.toolCallId` (REAL). One tool-started event per
    toolCallId; the host's `recordToolStarted` is one-per-call.

2.  Which lifecycle events are real?
    -> `content_start(tool)` and `content_end(tool)`. Both observable at
    host boundary via `onToolStarted` and `onSessionEvent` respectively.

3.  What exactly does duration measure?
    -> `Date.now() - toolStartedAt[toolCallId]` in
    `runtime-event-adapter.translateToolFinished`. That is the wall-clock
    from tool-start event emission to tool-finish event emission. It is
    NOT necessarily the user-perceived execution time -- the difference
    includes adapter translation latency. For tooling telemetry that is
    adequate.

4.  Is approval distinct from execution outcome?
    -> YES (STRUCTURAL via ControlPlaneOutcome). `user_rejected`,
    `host_policy_denied`, `approval_pending` are CONTROL_PLANE outcomes
    that never reach the executor. The host's `toolCalls` naturally
    excludes them (no `content_start(tool)` for non-executed tools).

5.  Is mechanism structurally observable?
    -> YES for built-ins (registry name map). YES for MCP (prefix).
    UNKNOWN for any unrecognized tool name (first-class `other` bucket).

6.  Is purpose structurally observable?
    -> NO. UNAVAILABLE_FROM_TRACE. Command-text heuristics are not REAL.

7.  Which effect classes are proven?
    -> `read_only`, `workspace_mutation`, `process_execution`,
    `network_access`, `human_interaction`, `task_completion`,
    `delegated`. Shell effect is `UNKNOWN` until hardened
    CommandExecutionPlan is observed.

8.  What happens for unknown tools?
    -> Mechanism `other`. Effect `other`. No crash. Bounded bucket.

9.  Is failure/cancel/timeout distinguishable?
    -> YES. Failure: `tool_execution_error` (typed).
    Cancel: `task_cancelled` / `runtime_aborted` (control plane).
    Timeout: not directly exposed today; boundable in a future impl ACT
    via tool `timeoutMs` policy.

10. Can retries be causally identified?
    -> NO (today). A future impl ACT could expose `ToolCallRecord`
    correlation via a new AgentRuntimeHooks field. Not in scope today.

11. Is completion-tool semantics preserved?
    -> YES. `submit_and_exit` is preserved (effect = task_completion,
    mechanism = completion).

12. Is one invocation counted exactly once?
    -> YES (TES10 not reproduced). `recordToolStarted()` increments by
    exactly one per `content_start(tool)`. Parallel siblings each emit
    their own `content_start(tool)`, so parallel + 2 = 2.

13. Are parallel tools order-independent?
    -> YES. The counter is cumulative; parallel tools increment by
    their own count, regardless of completion order.

14. Is no sensitive payload newly exposed?
    -> YES (in this recon). The proposed projection excludes
    input/output. No telemetry field would publish them.

15. Are task/run/tool timing domains still separate?
    -> YES. TaskHeader elapsed remains exclusive. Tool duration is
    per-tool timing. Run duration is per-AgentResult.

16. Are all gates green?
    -> YES. Working tree clean; cumulative `git diff --check
    8a7e53742..HEAD` PASS (preserved through this ACT's recon). No
    production source touched.

17. STOP.

---

## 25. FACTORY DECISION -- INPUT TO REVIEWER

The recon evidence points in ONE direction. The substrate supports a
bounded semantic projection with three axes; one axis (purpose) is
genuinely unobservable from typed evidence and must remain absent.

Two review options:

```text
Option A (recon-only closure with EPIC OPEN):
  Close TES-RECON-01 as RECON_COMPLETE_NO_SAFE_SEMANTIC_PROJECTION_IN_THIS_ACT.
  EPIC remains OPEN. A future bounded impl ACT would be authored as a
  separate ACT (e.g. TES-IMPL-01) when product value is justified and
  a host-side observable for ToolRuntimeOutcome is decided.

Option B (immediate bounded impl):
  Author TES-IMPL-01 in the same ACT window. This requires:
    - new AgentRuntimeHooks field for typed outcome (host-side hook)
    - new TaskHeaderTelemetryStrip wire fields for
        byMechanism, byEffect, byOutcome, cumulativeDurationMs
    - bounded UI tooltip detail (not new chrome)
    - conservation across THCP01..THCP11, RTP, completion, timing,
      static thinking, background commands
    - full gated test suite (apps/vscode, webview-ui, bun, SDK core)
```

The recon recommends Option A because no production source change is
required to confirm that the substrate is sufficient. Bounded
implementation is a separate engineering budget with its own evidence.

---


## 26. AGGREGATE COUNTER MODEL CONCEPT (FOR FUTURE IMPL)

Conceptual only; not implemented.

```text
  TaskToolTelemetry = {
    total: number                          // existing toolCalls; preserved
    byMechanism?: Partial<Record<...>>     // 13 buckets max
    byEffect?:    Partial<Record<...>>     // 9 buckets max
    byOutcome?:   Partial<Record<...>>     // 5 buckets max
    cumulativeDurationMs?: number          // bounded by task lifetime
  }
```

Cardinality bound: 13 × 9 × 5 ≈ 585 cells (intersected, not independent).
For the typical session, observed cells are < 20 (most tools fall into
1-2 mechanisms).

The bounded projection would replace the flat `toolCalls` ONLY in
display contexts where the breakdown is meaningful (TaskHeader tooltip /
detail view), and would NEVER replace the canonical scalar (parallel
count, retries, and exact tool count continue to come from `toolCalls`).

---

## 27. CLOSURE

This recon is complete. Substrate is sufficient for a bounded projection
on three of four axes; purpose is UNAVAILABLE_FROM_TRACE.

```text
SUBSTRATE_SUFFICIENCY_VERDICT = BOUNDED_PROJECTION_SUPPORTED
PURPOSE_VERDICT              = UNAVAILABLE_FROM_TRACE
SHELL_EFFECT_VERDICT         = UNKNOWN (pre-hardening)
RETRY_VERDICT                = UNAVAILABLE_TODAY (no host hook)
RECOMMENDED_NEXT_ACT         = TES-IMPL-01 (separate, bounded)
```

The recon commits; the board updates per the reviewer's chosen option.

---

## 28. AGGREGATE-TABLE FOR REVIEWER

```text
  +----+--------------------------+---------+-----------------+----------------------------+
  | #  | AXIS                     | QUALITY | VOCAB SIZE      | PROOF                       |
  +----+--------------------------+---------+-----------------+----------------------------+
  | 1  | mechanism                | REAL+   | 13 closed       | registry name map + mcp_    |
  |    |                          | STRUCT  | (incl. other/  | prefix is structural.       |
  |    |                          |         |  unknown)       |                            |
  +----+--------------------------+---------+-----------------+----------------------------+
  | 2  | effectClass              | STRUCT  | 9 closed        | registry map; shell =       |
  |    |                          |         | (incl. unknown/ | UNKNOWN (cannot prove       |
  |    |                          |         |  other)         | mutation/no-mutation).      |
  +----+--------------------------+---------+-----------------+----------------------------+
  | 3  | outcome                  | REAL    | 5 closed        | content_end.error +         |
  |    |                          | (typed) | (incl. other)   | onToolRuntimeOutcome.kind.  |
  |    |                          |         |                 | C1.2 hook already proven    |
  |    |                          |         |                 | in agents/core tests.       |
  +----+--------------------------+---------+-----------------+----------------------------+
  | 4  | durationMs               | REAL    | n/a (scalar)    | runtime-event-adapter;      |
  |    |                          |         |                 | Date.now() diff.            |
  +----+--------------------------+---------+-----------------+----------------------------+
  | 5  | purpose                  | UNAVBL  | 0 (forbidden)   | NO typed intent metadata    |
  |    |                          |         |                 | anywhere in substrate.      |
  |    |                          |         |                 | Hyp heuristics forbidden.   |
  +----+--------------------------+---------+-----------------+----------------------------+
  | 6  | retryIdentity            | UNAVBL  | 0 (today)       | No host hook for            |
  |    |                          |         |                 | ToolCallRecord correlation. |
  +----+--------------------------+---------+-----------------+----------------------------+
```

Total = 27 vocabulary values across the projection (5 + 9 + 13 = 27,
plus the scalar `total` and `cumulativeDurationMs`).

This is the language a bounded telemetry wire field would speak.
