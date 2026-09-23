# Trigger Recon — ACT-CLINEMM-EXTENSION-HOST-ALLOCATION-AUTHORITY01

## Qualifying contract (per ACT §3)

The ACT requires the sampler to AUTO-trigger on:

> The first real `run_commands` request in dogfood which requests
> terminal notification AND results in a managed background job.

Translated to production seam terms:

```text
createVscodeRunCommandsTool.execute(...)
        notifyOnCompletion === true
        background execution selected
                ↓
        profiler.trigger()
                ↓
        CommandJobManager.start(...)
```

The trigger MUST be observational — it cannot alter:
- run_commands semantics
- background job ownership
- notify-on-completion semantics
- pending prompts
- completion barrier
- BTCONT / TQCB / CCARD
- terminal-card projection

## Production seam chosen

File: `apps/vscode/src/sdk/vscode-run-commands-tool.ts`
Function: `createVscodeShellExecutor(...)` closure
Lines: 753-811 (the marker-registration branch)

The seam is the EXACT site where all three qualifying predicates
converge:

```ts
const notifyRequested = context.metadata?.notifyOnCompletion === true
if (
    start.state === "running" &&
    notifyRequested && \
    options.backgroundNotifyCoordinator &&
    options.resolveActiveOwner
) {
    // <-- SINGLE trigger call lands immediately BEFORE registerMarker
    options.backgroundNotifyCoordinator.registerMarker({...})
    start.terminalPromise.then(async () => {...})
}
```

This is canonical because:

1. It is the LIVE fork's host adapter, not a test facade.
2. It already gates on `context.metadata.notifyOnCompletion === true`
   — the model's opt-in flag from `RunCommandsInputSchema` (per
   `sdk/packages/core/src/extensions/tools/schemas.ts:166-171`).
3. It already gates on `start.state === "running"` — the canonical
   background-handoff state (NOT a synchronous-fast-path terminal).
4. Both `options.backgroundNotifyCoordinator` and
   `options.resolveActiveOwner` must be present, which is the
   production wiring via `vscode-runtime-builder.ts` (only wired
   under the real SdkController host, NOT in test-only facades).

## Why this seam, not others

| Alternative                                  | Rejected because                                                                                    |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `extension.ts:activate`                      | Activation happens at process start; the operator does unrelated work first; capture interval       |
|                                              | would be uncontrolled and miss the actual workload.                                                  |
| `VscodeSessionHost.create(...)` constructor  | The session-host constructor fires on session build, NOT on `run_commands` invocation; cannot tell   |
|                                              | whether the session will ever invoke `notifyOnCompletion=true`.                                      |
| `SdkController.handleSessionEvent`           | Fires for many event types; per-event profiler start would multiply sessions, violate one-shot.      |
| `BackgroundNotifyCoordinator.registerMarker` | Already happens for unrelated concerns; a profiler trigger here would force the dependency upward.   |
| `CommandJobManager.start(...)`               | Fires for every background job, including notify=false fire-and-forget jobs; wrong predicate.       |
| `command_status` tool execute                | Fires AFTER terminal; too late for capturing the allocation-owning background lifecycle.            |

## Architectural choice — single bounded trigger call

The trigger site at `vscode-run-commands-tool.ts:754` will perform a
single bounded call:

```ts
// Trigger the V8 allocation sampler at the production background-handoff
// seam if and only if:
//   (a) the run is a real background handoff (start.state === "running"),
//   (b) the model opted in via notifyOnCompletion=true,
//   (c) the profiler is currently ARMED (dogfood + CLINEMM_DIAG_ALLOCATION_PROFILE=1),
//   (d) no profiler session is currently active.
triggerExtensionHostAllocationProfilerOnFirstQualifyingJob()
```

The function is idempotent and one-shot:

- Multiple qualifying concurrent jobs → second/third are no-ops.
- A non-notify fire-and-forget job → never fires the trigger.
- Profiler disabled / public profile → no-op.
- A previous session is already ACTIVE/STOPPING/FINALIZED → no-op.

## Hot-path budget (per ACT §18)

The trigger site is NOT in any per-event or per-record path. It is a
single conditional call at the marker-registration seam that fires
exactly once per process. The hot paths that are explicitly FORBIDDEN
to call the profiler:

- `handleSessionEvent`
- `TurnStateTracker.setWithWriter`
- `PendingPromptsController.drain` (per-entry loop)
- `recordTurnStateWriterProvenance`
- CCARD record write

Verified: the trigger call only appears at the `createVscodeShellExecutor`
marker-registration branch (the existing notifyRequested branch) and
no other production site.

## Identity binding

The trigger call is bound to the production tool instance — it is
NOT a module-level import that introduces a side effect at parse time.

```ts
import {
    triggerExtensionHostAllocationProfilerOnFirstQualifyingJob,
} from "./extension-host-allocation-profiler"
```

The function returns a discriminated `TriggerResult` union so the
caller can record `skipped | armed-but-disabled | already-active |
started | failed` for debug but does NOT propagate the result into the
tool's behavior. A `failed` result logs a single bounded warning and
does NOT throw.