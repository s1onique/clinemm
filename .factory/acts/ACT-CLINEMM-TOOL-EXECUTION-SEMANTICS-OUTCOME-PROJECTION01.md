# ACT-CLINEMM-TOOL-EXECUTION-SEMANTICS-OUTCOME-PROJECTION01 (TES-OUT-01)

> Status: **CLOSED / PASS_STRUCTURAL_ONLY** — bounded production
> implementation of the tool RUNTIME-OUTCOME projection.
> EPIC: `EPIC-CLINEMM-TOOL-EXECUTION-SEMANTICS01` (remains OPEN — the
> deferred slices below stay under it).
> Predecessor: `ACT-CLINEMM-TOOL-EXECUTION-SEMANTICS-IMPLEMENTATION01`
> (mechanism projection V1).

## 0. Frozen epistemic contract

```text
mechanism   = REAL          (canonical toolName on content_start(tool))  [V1, unchanged]
outcome     = REAL          (typed ToolRuntimeOutcome)                  [V2, this ACT]
duration    = REAL          (computed upstream)                         [deferred]
effect      = STRUCTURAL where proven, otherwise UNKNOWN               [deferred]
purpose     = UNAVAILABLE_FROM_TRACE                                     [deferred]
retryId     = UNAVAILABLE_TODAY                                          [deferred]
subprocess exit status = OUT OF SCOPE (separate authority)
```

V2 reports the TYPED RUNTIME TOOL OUTCOME. A `run_commands` invocation
that the runtime executed successfully counts as `succeeded` even when the
shell process exited nonzero. No shell-text parsing, no name heuristics,
no prose scraping, no exit-status inference.

## 1. Production seam (C0 recon result)

The typed outcome hook EXISTS and fires in production — but it was
**dropped by both merge layers**, so no host could ever subscribe:

```text
TYPED_OUTCOME_TYPE      = sdk/packages/shared/src/agents/recovery/types.ts
                           ToolRuntimeOutcome { success | failure | control_plane }
HOOK_CONTRACT           = sdk/packages/shared/src/agent.ts
                           AgentRuntimeHooks.onToolRuntimeOutcome (read-only)
RUNTIME_PRODUCER        = sdk/packages/agents/src/agent-runtime.ts
                           executePreparedTool → notifyToolRuntimeOutcome
                           (EXACTLY ONCE per tool invocation)
DROP_POINT_1            = sdk/packages/core/src/hooks/hook-file-hooks.ts
                           mergeAgentHooks  → onToolRuntimeOutcome dropped
DROP_POINT_2            = sdk/packages/core/src/runtime/orchestration/
                           session-runtime-orchestrator.ts mergeRuntimeHooks
                           → onToolRuntimeOutcome dropped
HOST_CONSUMER           = apps/vscode/src/sdk/task-telemetry-tracker.ts
                           recordToolRuntimeOutcome
HOST_WIRING             = apps/vscode/src/sdk/sdk-session-config-builder.ts
                           → config.hooks.onToolRuntimeOutcome
HOST_ADAPTER            = apps/vscode/src/sdk/SdkController.ts
                           onToolRuntimeOutcome → tracker.recordToolRuntimeOutcome
WIRE_TYPE               = apps/vscode/src/shared/ExtensionMessage.ts
                           TaskHeaderTelemetryStrip.outcome? (additive optional)
RENDER_SEAM             = apps/vscode/webview-ui/src/components/chat/task-header/
                           TaskHeaderTelemetry.tsx
```

Verdict: **the seam was reachable with a bounded, additive fix** — NOT a
runtime redesign. `HALT_WRONG_PRODUCTION_SEAM` did not apply.

## 2. Empirical truth established (probe against the REAL AgentRuntime)

A throwaway probe drove the real `AgentRuntime` and recorded, per case,
both the emitted `tool-started` events and the `onToolRuntimeOutcome`
outcomes:

```text
POLICY_DISABLED  events=[tool-started:t-1]  outcomes=[t-1:control_plane]
HOST_DENY        events=[tool-started:t-1]  outcomes=[t-1:control_plane]
SUCCESS          events=[tool-started:t-1]  outcomes=[t-1:success]
UNKNOWN_TOOL     events=[tool-started:t-1]  outcomes=[t-1:failure]
```

Two consequences, both load-bearing:

1. `tool-started` fires for EVERY prepared tool call — INCLUDING the
   pre-execution control-plane paths. The pre-existing SdkController
   comment claiming "control-plane DENY/REJECT/UNKNOWN_TOOL never emit
   this event" was FACTUALLY WRONG and has been corrected in place.
   The counted `toolCalls` therefore DOES include those calls.
2. `onToolRuntimeOutcome` fires EXACTLY ONCE per invocation and carries
   the SAME `toolCallId` as the corresponding `tool-started` — so the
   join key is authoritative, not chronological.

## 3. Frozen V2 wire contract

```ts
interface ToolOutcomeSummary {
  succeeded: number
  failed: number
  pending: number
  unknown: number
}
```

Published as `TaskHeaderTelemetryStrip.outcome?` (additive, optional).

| Bucket | Definition |
|---|---|
| `succeeded` | matched counted start whose authoritative terminal outcome is `success` |
| `failed` | matched counted start whose authoritative terminal outcome is `failure` |
| `pending` | counted start with NO matching terminal outcome yet |
| `unknown` | counted start whose terminal status is unavailable or cannot be safely classified as success/failure |

Classification rules:

```text
ToolRuntimeOutcome.kind === "success"       → succeeded
ToolRuntimeOutcome.kind === "failure"       → failed
ToolRuntimeOutcome.kind === "control_plane"  → unknown  (NEITHER success NOR failure)
counted start without a stable identity      → unknown  (can never be joined)
```

A `control_plane` outcome is a pre-execution denial / abort / transport
condition. It is NEVER counted as a successful or failed tool execution,
and it NEVER invents a corresponding start event. When the execution DID
cross the tool-start boundary (the empirical norm), the matched counted
start moves from `pending` to `unknown` — conserving the total.

Conservation invariant (checked host-side AND webview-side):

```text
succeeded + failed + pending + unknown === toolCalls
```

Join rules (fail closed — never join chronologically):

```text
unmatched identity (foreign session/task)  → DROPPED (no start invented)
duplicate terminal for a discharged id      → DROPPED (no double counting)
repeated starts reusing one id             → tracked as a COUNT (per-invocation
                                            cardinality preserved; each terminal
                                            discharges exactly ONE pending start)
```

## 4. RED reproduction

`apps/vscode/src/sdk/__tests__/tool-outcome-projection.tes02.test.ts`
drives the REAL production `TaskTelemetryTracker` with REAL typed
`ToolRuntimeOutcome` values (the production discriminants from
`@cline/shared`, not test-invented constants).

RED (before implementation) — 12/12 failed:

```text
TypeError: tracker.recordToolStartedWithIdentity is not a function.
TypeError: tracker.recordToolRuntimeOutcome is not a function.
AssertionError: expected undefined to deeply equal
  { succeeded: 1, failed: 1, pending: 1, unknown: 0 }
```

Scenario (ACT §5): three canonical tool starts; one typed success; one
typed failure; one left pending.

```text
toolCalls = 3
succeeded = 1
failed    = 1
pending   = 1
unknown   = 0
```

## 5. Files (8 production + 3 test)

### Production

| File | Change |
|---|---|
| `apps/vscode/src/shared/ExtensionMessage.ts` | `ToolOutcomeSummary` type + `TaskHeaderTelemetryStrip.outcome?` |
| `apps/vscode/src/sdk/task-telemetry-tracker.ts` | `recordToolStartedWithIdentity`, `recordToolRuntimeOutcome`, pending-id map, reset, wire projection |
| `apps/vscode/src/sdk/SdkController.ts` | forward `event.toolCallId` on tool start; install the read-only outcome observer; correct the stale "control-plane never emits" comment |
| `apps/vscode/src/sdk/sdk-session-config-builder.ts` | compose `onToolRuntimeOutcome` onto the session hooks bag |
| `sdk/packages/core/src/hooks/hook-file-hooks.ts` | `mergeAgentHooks` fans out `onToolRuntimeOutcome` |
| `sdk/packages/core/src/runtime/orchestration/session-runtime-orchestrator.ts` | `mergeRuntimeHooks` fans out `onToolRuntimeOutcome` |
| `apps/vscode/webview-ui/src/components/chat/task-header/taskHeaderTelemetryHelpers.ts` | `isUsableOutcomeProjection` wire validator (webview mirror) |
| `apps/vscode/webview-ui/src/components/chat/task-header/TaskHeaderTelemetry.tsx` | outcome chips next to the existing tool summary |

### Test

| File | Cases |
|---|---|
| `apps/vscode/src/sdk/__tests__/tool-outcome-projection.tes02.test.ts` | 15 (host tracker projection) |
| `apps/vscode/webview-ui/src/components/chat/task-header/TaskHeaderTelemetry.outcome.tes02.test.tsx` | 8 (rendering + validator + legacy fallback) |
| `sdk/packages/core/src/runtime/orchestration/session-runtime-orchestrator.tool-outcome-hook.tes02.test.ts` | 3 (hook fan-out reaches the real runtime hook bag) |

## 6. Execution conservation

Unchanged by this ACT:

```text
which tools run / when they run          unchanged
approval policy                          unchanged
tool arguments / results                  unchanged
cancellation and retry behavior          unchanged
runtime completion authority              unchanged
model calls / reasoning settings         unchanged
ELM task-state ownership                  unchanged
MYC accounting                           unchanged
existing model-behavior recorder         unchanged
```

The outcome hook is READ-ONLY: `AgentRuntime.notifyToolRuntimeOutcome`
ignores the hook's return value, so the observer can never influence
execution, approval, or recovery. No diagnostic writes inside React
functional updaters (the projection is a plain object read during
render).

Hook cardinality was MEASURED, not inferred: the probe above shows the
runtime fires `onToolRuntimeOutcome` exactly once per tool invocation,
independently of the tool-start count.

## 7. Adversarial witnesses

| Witness | Where | Result |
|---|---|---|
| Success | TESOUT-01 | counts only at authoritative terminal outcome |
| Failure | TESOUT-01 | does not count as success |
| Pending | TESOUT-01 | start without terminal remains pending |
| Duplicate terminal | TESOUT-04 | no double counting |
| Foreign task/session | TESOUT-05 | cannot discharge local pending work |
| Parallel siblings | TESOUT-06 | independent outcome attribution |
| Continuation | TESOUT-08 | same task preserves cumulative counts |
| New task | TESOUT-09 | resets the V2 projection with the existing tracker |
| Missing identity | TESOUT-03 | fail closed; never join chronologically |
| Legacy host | TESOUTUI-02 | V1 display unchanged |
| Malformed projection | TESOUTUI-03/04 | V1 fallback |
| Command exit vs runtime result | TESOUT-13/14 | runtime success never claims shell exit 0 |
| Control-plane terminal | TESOUT-07 | neither success nor failure |
| Hook fan-out closure | TESOUTSDK-01/02/03 | the typed outcome reaches the real runtime hook bag |

## 8. Deferred (explicitly NOT implemented)

```text
shell-process exit statuses          separate authority
tool duration aggregation             separate slice
semantic tool purpose                UNAVAILABLE_FROM_TRACE
effect classification                separate slice
retry/recovery deduplication         separate slice
new model-behavior events            forbidden here
general-purpose execution analytics  out of scope
```

## 9. Verdict

```text
VERDICT = PASS_STRUCTURAL_ONLY
```

Implementation and executable tests pass. The installed-UI demonstration
is pending because the sandbox cannot launch the Electron host (the
baseline code fails identically — see the evidence file).
