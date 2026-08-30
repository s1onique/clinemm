# Source-seam map: Cancel button rendering pipeline (post-upstream-integration)

## Repository trust at entry

```text
ENTRY_HEAD       = 15c7e3374637e8831a8aaf7692c17cf3e7d88ca1
ENTRY_TREE       = 1b626e9d7bed8c61b30812aa12b021a3fab7102d
BRANCH           = main
ORIGIN_MAIN      = 15c7e3374637e8831a8aaf7692c17cf3e7d88ca1  (matches HEAD)
WORKTREE_STATUS  = clean (0 untracked dirt, 0 stashes, 0 protected-stash branches)
```

Status: **PASS**.

## Cancel-render pipeline (frozen from current merged tree)

### Stage 1 — Render entry point

```text
apps/vscode/webview-ui/src/components/chat/chat-view/components/layout/ActionButtons.tsx:53
  buttonConfig = useMemo(() => {
    return getButtonConfigFromState(messages, turnState, mode, foregroundCommandRunning)
  }, [messages, turnState, mode, foregroundCommandRunning])
```

`buttonConfig` is derived once per render from the four inputs:
- `messages` — full chat history (ClineMessage[])
- `turnState` — authoritative TurnState from `useExtensionState()` (always provided in production via `SdkController.getStateToPostToWebview() → turnState: this.turnStateTracker.get()`)
- `mode` — "act" / "plan"
- `foregroundCommandRunning` — boolean from extension state

### Stage 2 — Predicate

```text
apps/vscode/webview-ui/src/components/chat/chat-view/shared/buttonConfig.ts:435
  export function getButtonConfigFromState(
    messages, turnState, mode = "act", foregroundCommandRunning = false,
  ): ButtonConfig {
    if (turnState) {
      const anchored = turnState.anchorTs !== undefined
        ? messages.find((m) => m.ts === turnState.anchorTs)
        : undefined
      return buttonsForPhase(turnState, anchored, foregroundCommandRunning)
    }
    return getButtonConfigForMessages(messages, mode)  // LEGACY FALLBACK (dead in production)
  }
```

In production, `turnState` is always defined (initial = `idle`). The legacy fallback path is unreachable.

### Stage 3 — Phase → button-set switch

```text
apps/vscode/webview-ui/src/components/chat/chat-view/shared/buttonConfig.ts:399-426
  export function buttonsForPhase(
    turnState: TurnState,
    anchoredMessage: ClineMessage | undefined,
    foregroundCommandRunning = false,
  ): ButtonConfig {
    switch (turnState.phase) {
      case "idle":              return BUTTON_CONFIGS.default          // NO Cancel
      case "streaming":         return foregroundCommandRunning
                                  ? BUTTON_CONFIGS.foreground_command_running
                                  : BUTTON_CONFIGS.partial              // HAS Cancel
      case "completed":         return BUTTON_CONFIGS.completion_result // NO Cancel
      case "resumable":         return BUTTON_CONFIGS.resume_task      // NO Cancel
      case "error":             return BUTTON_CONFIGS.api_req_failed   // NO Cancel
      case "awaiting_followup": return anchoredMessage
                                  ? getButtonConfig(anchoredMessage, "act")
                                  : BUTTON_CONFIGS.followup            // NO Cancel
      case "awaiting_approval": return anchoredMessage
                                  ? getButtonConfig(anchoredMessage, "act")
                                  : BUTTON_CONFIGS.tool_approve        // NO Cancel
      case "compacting":        return BUTTON_CONFIGS.default          // NO Cancel (system internal)
      default:                  return BUTTON_CONFIGS.default
    }
  }
```

### The complete Cancel-button matrix (verified via existing tests)

| Phase | foregroundCommandRunning | Config returned | Cancel visible? |
|---|---|---|---|
| `idle` | true | `default` | **NO** |
| `idle` | false | `default` | **NO** |
| `streaming` | true | `foreground_command_running` | **YES** (Cancel + Proceed While Running) |
| `streaming` | false | `partial` | **YES** (Cancel) |
| `awaiting_approval` | any | anchored message → `tool_approve` etc. | NO (Approve/Reject buttons) |
| `awaiting_followup` | any | anchored message → `followup` etc. | NO (input prompt) |
| `completed` | any | `completion_result` | NO (Start New Task button) |
| `resumable` | any | `resume_task` | NO (Resume button) |
| `error` | any | `api_req_failed` | NO (Retry/Start New Task) |
| `compacting` | any | `default` | NO (system internal) |

**Verified by**:
- `apps/vscode/webview-ui/src/components/chat/chat-view/shared/buttonConfig.aoc02.test.ts` (9/9 PASS)
- `apps/vscode/webview-ui/src/components/chat/chat-view/__tests__/application-ownership-control-coherence.aoc01.test.tsx` (4/4 PASS)

### Stage 4 — Cancel click handler (backend pipeline)

```text
apps/vscode/webview-ui/src/components/chat/chat-view/hooks/useMessageHandlers.ts:561-582
  case "cancel": {
    if (cancelInFlightRef.current) return
    cancelInFlightRef.current = true
    setSendingDisabled(true)
    setEnableButtons(false)
    try {
      if (backgroundCommandRunning) {
        await TaskServiceClient.cancelBackgroundCommand(EmptyRequest.create({}))
          .catch((err) => console.error("Failed to cancel background command:", err))
      }
      await TaskServiceClient.cancelTask(EmptyRequest.create({}))
    } finally {
      cancelInFlightRef.current = false
      setSendingDisabled(false)
      setEnableButtons(true)
    }
    break
  }
```

### Stage 5 — Extension-side cancel owner

```text
apps/vscode/src/core/controller/task/cancelTask.ts
  export async function cancelTask(controller, _request): Promise<Empty> {
    await controller.cancelTask()
    return Empty.create()
  }

apps/vscode/src/core/controller/task/cancelBackgroundCommand.ts
  export async function cancelBackgroundCommand(controller, _request): Promise<Empty> {
    const controllerWithCancel = controller as Controller & { cancelBackgroundCommand: () => Promise<void> }
    await controllerWithCancel.cancelBackgroundCommand()
    return Empty.create()
  }
```

Both gRPC handlers exist and forward to `Controller.cancelTask()` / `Controller.cancelBackgroundCommand()`.

```text
apps/vscode/src/sdk/sdk-task-control-coordinator.ts:76-116
  async cancelTask(): Promise<void> {
    this.options.interactions.clearPending("Task cancelled")
    // ... [fence raise + epoch bump + abort]
    await sdkHost.abort(sessionId)
    // ... [emit resume message + "cancelled" status]
  }
```

The SDK-side owner is `SdkTaskControlCoordinator.cancelTask()` → `sdkHost.abort(sessionId)`. Backend cancel pipeline is **fully implemented and not broken**.

## Upstream vs ClineMM comparison (buttonConfig.ts)

```text
UPSTREAM pinned subject 48d63852745460ff0fa3dfcc0457bbe2493841de:

  partial:                       secondaryText: "Cancel",      secondaryAction: "cancel"
  foreground_command_running:   secondaryText: "Cancel",      secondaryAction: "cancel"
  api_req_active:               secondaryText: "Cancel",      secondaryAction: "cancel"

  buttonsForPhase switch:       same structure, same phases
  getButtonConfigFromState:     same wrapper
```

```text
CLINEMM at HEAD 15c7e3374:

  partial:                       secondaryText: "Cancel",      secondaryAction: "cancel"
  foreground_command_running:   secondaryText: "Cancel",      secondaryAction: "cancel"
  api_req_active:               secondaryText: "Cancel",      secondaryAction: "cancel"

  buttonsForPhase switch:       same structure, same phases
  getButtonConfigFromState:     same wrapper
```

**Cancel button structure is BYTE-IDENTICAL upstream vs ClineMM** (only difference: line numbers shift +9 because ClineMM adds `mistake_limit_reached` advisory support and a `dismiss` ButtonActionType for that advisory). The cancel predicate, configs, and routing are unchanged.

## Cancel handler upstream vs ClineMM

```text
useMessageHandlers.ts: case "cancel"
  Upstream:  TaskServiceClient.cancelTask + cancelBackgroundCommand
  ClineMM:   TaskServiceClient.cancelTask + cancelBackgroundCommand  (BYTE-IDENTICAL)
```

## Existing tests pinning Cancel behavior (all PASS on current tree)

| Test | Status | Coverage |
|---|---|---|
| `buttonConfig.aoc02.test.ts` | **9/9 PASS** | All 4 (phase × fgCmd) combinations pin the §2 LIVE contradiction: idle+fgCmd → no Cancel; streaming+fgCmd → Cancel visible |
| `application-ownership-control-coherence.aoc01.test.tsx` | **4/4 PASS** | Real webview reducer + StateServiceClient subscription; pins AOC01-D: idle+partial-tail = coherent (Idle, no Cancel) |
| `application-ownership-control-coherence.aoc02.section6.test.tsx` | (PASS per epic board entry) | Real partial-subscription path |
| `sdk-task-control-coordinator.test.ts` | **20/20 PASS** | cancelTask/cancelBackgroundCommand/AOC cancel-via-sdkHost.abort |
| `ActionButtons.test.tsx` | (existing) | ActionButtons render mechanics |

## Existing prior ACT verdict (the recon THIS ACT must respect)

```text
.factory/epics/webview-seam-aop.md (sub-shard, ACT ledger):

  AOC02 §2 verdict (per epic board):  GREEN
    "the LIVE contradiction (idle + fgCmd = Cancel visible) CANNOT be born
     at this seam"
    "all four controls show the idle branch returning the `default` config
     (no Cancel)"

  AOC01 verdict (per epic board):  PASS_RECON_WITH_ONE_P1_CAUSAL_GAP

  ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-RECON01 cancel-authority.json:
    schema = cancel-affordance-authority.v1
    status = NOT_YET_COLLECTED
    invariant_under_test = "cancellable-owner <-> Cancel availability"
    verdict = null (awaiting LIVE capture)
```

## Why does the Cancel button appear in OLDER UI screenshots but not in CURRENT?

The recon cannot definitively answer this without the actual screenshots. **Hypotheses** (ranked by plausibility, all require LIVE capture to confirm):

### Hypothesis A — Phase gate (most likely)

The OLDER UI was in `phase: "streaming"` (showing model output streaming, or a foreground command running) → Cancel visible. The CURRENT UI is in a different phase (`awaiting_approval`, `awaiting_followup`, `idle` post-completion, etc.) → Cancel hidden by design.

This is **NOT a defect** — the new turn-state-driven predicate intentionally gates Cancel to the `streaming` phase only.

### Hypothesis B — Sub-task mode (likely)

The CURRENT task is in a state the new predicate correctly classifies as non-`streaming` (e.g., a sub-agent waiting for child completion that the prior code treated as a streaming turn). Cancel is correctly hidden.

### Hypothesis C — Phase-projection defect (possible)

A real defect in the SdkSessionEventCoordinator phase-transition logic that fails to transition `idle → streaming` when a new prompt is submitted, or fails to preserve `streaming` during long tool execution. **Not yet reproduced** — would require LIVE capture.

### Hypothesis D — Tail-fallback regression (very unlikely)

The legacy tail-walking fallback (`getButtonConfigForMessages`) was once used and showed Cancel during `api_req_started`. Now that `turnState` is always provided, the legacy fallback is dead code. If a test fixture or non-production code path relies on the legacy fallback, Cancel would be hidden — but this would be a fixture bug, not a user-facing regression.

### Hypothesis E — Upstream UX change (ruled out)

Upstream `48d638527` and ClineMM HEAD have IDENTICAL Cancel button configs. The upstream merge did not remove Cancel. **Ruled out** by diff.

### Hypothesis F — ClineMM local removal (ruled out)

ClineMM-local git history of `buttonConfig.ts` shows only the mistake_limit advisory change (irrelevant to Cancel) and the cancel logic is byte-identical upstream. **Ruled out** by history.

## Decision per reviewer's §11

### CASE C5 — screenshot only reflects temporary substate

```text
WITHOUT LIVE CAPTURE:
  The Cancel button is INTENTIONALLY hidden in `idle`,
  `awaiting_approval`, `awaiting_followup`, `completed`,
  `resumable`, `error`, `compacting` phases by the
  TurnState-driven predicate. The user's "actively working
  but no Cancel" observation matches one of these phases;
  without the actual screenshot we cannot disambiguate.
```

### Verdict path

Per reviewer's §11 CASE C5:
```text
NOT_REPRODUCED_AS_GLOBAL_MISSING_CANCEL
```

This is the **first stopping point** of the recon. **No production repair authorized** without LIVE capture that proves the task is genuinely active (tool running, model producing tokens) AND the phase is NOT `streaming`.

## What's needed for the next step (a real defect hunt, not this recon)

```text
1. LIVE capture of the exact UI state matching the user's observation:
   - Read turnState.phase, foregroundCommandRunning, backgroundCommandRunning
   - Read lastMessage.{type, say, partial, ask}
   - Read the entire clineMessages tail (last 5 entries)

2. If phase === "streaming":
   → Cancel SHOULD be visible (per existing tests)
   → Bug is in rendering, not predicate

3. If phase !== "streaming" AND task is genuinely working:
   → Bug is in SdkSessionEventCoordinator phase transitions
   → Must be reproduced and classified per §11 C1/C2/C3/C4

4. If phase === "idle" AND task is genuinely working:
   → This is the "stale streaming" defect class
   → The AOC02 §6 production path test pins this case
   → If reproducible: requires bounded repair ACT
```

## Backward-compatibility & conservation checks

### Completion-authority conservation (reviewer §16)

```text
Cancel handler in SdkTaskControlCoordinator.cancelTask:
  - Sets fence + epoch (filters stragglers)
  - Calls sdkHost.abort(sessionId) — does NOT emit task.completed
  - Emits a "cancelled" status message
  - Adds a resume message

  Cancel → task.completed count = 0  ✓
```

### Auto-Approve conservation (reviewer §17)

```text
The Cancel predicate (turnState.phase === "streaming") is independent of
auto-approval settings. Cancel remains visible whether Auto-Approve is
ON or OFF, as long as phase === "streaming".  ✓
```

### Long-running command conservation (reviewer §18)

```text
foregroundCommandRunning=true AND phase=streaming
  → BUTTON_CONFIGS.foreground_command_running
  → secondaryText: "Cancel"  ✓
  → primaryText: "Proceed While Running" (lets agent continue with partial output)

Background commands:
  TaskServiceClient.cancelBackgroundCommand exists and is wired.
  foreground_command_running / backgroundCommandRunning are independent
  ownership flags in ExtensionState.
```

## Predecessor ACTs (history this recon stands on)

| ACT | Status | Contribution to cancel understanding |
|---|---|---|
| `ACT-CLINEMM-COMPLETION-PROTOCOL-LIVENESS02` | CLOSED | Bound the LIVENESS02 specimen; established that the cancel-affordance-vs-owner invariant is the canonical authority question |
| `ACT-CLINEMM-APPLICATION-OWNERSHIP-PROJECTION-COHERENCE01-AOPC02` (family) | CLOSED | Established extension-side E1/E2/E3 coherence rules |
| `ACT-CLINEMM-APPLICATION-OWNERSHIP-CONTROL-COHERENCE01-AOC01` | CLOSED PASS_RECON_WITH_ONE_P1_CAUSAL_GAP | Webview-seam LIVE-W2 discriminator (idle+Cancel case) |
| `ACT-CLINEMM-APPLICATION-OWNERSHIP-CONTROL-COHERENCE01-AOC02` | AUTHORIZED | Cancel-authority → producer → partial discriminator. §2 verdict: GREEN. |
| `ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-RECON01` | CLOSED VERDICT_AMENDED NO_PRODUCTION_DELTA | Cancel-authority.json evidence schema established; status NOT_YET_COLLECTED awaiting LIVE capture |

## Decision rule

**The recon cannot conclude that Cancel was removed by ClineMM or upstream**. The Cancel button structure is byte-identical upstream vs ClineMM, the predicate is `streaming`-phase-only, and that predicate has been exhaustively pinned by 9+4+20 production-seam tests (all PASS).

**A genuine missing-Cancel defect, IF it exists, requires LIVE capture to reproduce**: which phase was the live UI in? Was the task genuinely working? Was the phase projection correct?

**Per the reviewer's §11 CASE C5 / §25 HALT conditions**: this is **NOT_REPRODUCED** — the ACT halts here without a defect being reproducible from the merged source. No production code change is authorized.

The next step (a bounded repair ACT) requires LIVE capture that proves: **(task actively working) AND (phase !== "streaming") AND (no equivalent interrupt control visible)**. Until then, the source-seam map and the existing 33+ production-seam tests pin the predicate as correct.
