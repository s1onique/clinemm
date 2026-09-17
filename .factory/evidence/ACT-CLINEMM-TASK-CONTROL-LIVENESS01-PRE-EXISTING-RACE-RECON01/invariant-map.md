# Invariant map

## L1 — latest task selection wins
- **Status:** CONSERVED (verified by PARENT01, REACH02)
- **Mechanism:** `taskOperationFence.begin()` at entry of `showTaskWithId`
  and `initTask`. Post-host.start fence check at `sdk-session-lifecycle.ts:330`
  disposes just-started session if a newer intent advanced the fence.

## L2 — clear wins over older show
- **Status:** CONSERVED (verified by ADVERSARIAL A, REACH02)
- **Mechanism:** `clearTask` calls `fence.begin()` at entry
  (`sdk-task-control-coordinator.ts:124`). The `clearTaskForOperation(token)`
  variant is used by `initTask` so the initTask's own token is preserved (a
  naive `clearTask()` would self-supersede).
- **Post-clear fence check at line 156** in `clearTaskForOperation` (after
  `await endActiveSession`) catches a concurrent external clear.

## L3 — newer show may replace earlier clear only if it truly starts later
- **Status:** CONSERVED
- **Mechanism:** Ordering is based on fence generation, not promise completion.
  Each top-level user intent (New Task click, History click, clear button)
  allocates a generation via `fence.begin()`. Async completion time is not
  the authority.

## L4 — cancel fence precedes abort
- **Status:** CONSERVED
- **Mechanism:** `raiseCancelFence()` SYNC before `await sdkHost.abort(sessionId)`
  (`sdk-task-control-coordinator.ts:87-92`). Source comment explicitly states
  ordering is causal.

## L5 — stale session events cannot revive cancelled UI
- **Status:** CONSERVED (asserted in production code, not directly exercised
  by the RED tests)
- **Mechanism:** Cancel fence raises epoch synchronously; SDK events after
  the abort carry the old epoch (dropped by the webview).

## L6 — clear is not completion
- **Status:** CONSERVED
- **Mechanism:** `clearTask` does not emit a `task.completed` status. The
  completion-authority lane is separate and untouched.

## L7 — cancel is not completion
- **Status:** CONSERVED
- **Mechanism:** `cancelTask` emits `status: "cancelled"` with a `resume_task`
  ask (`sdk-task-control-coordinator.ts:113`). Not a `completion_result`.

## L8 — history-open derives correct turn phase
- **Status:** CONSERVED (verified by `showTaskWithId` lines 280-291)
- **Mechanism:** Turn phase derived from the appended resume ask after
  task installation. If `ask === "resume_completed_task"` → phase =
  "completed". If `ask === "resume_task"` → phase = "resumable". Else
  → phase = "idle" (fallback).

## L9 — TaskOperationFence is an independent lifecycle authority
- **Status:** CONSERVED (this ACT does not modify the fence)
- **Mechanism:** `taskOperationFence` is a singleton passed into both
  control and start coordinators; `SdkSessionLifecycle` consults it via
  `isOperationCurrent(token)`. Distinct from `taskViewGeneration` which
  no longer exists as a separate counter — it was unified into
  `TaskOperationFence.generation` by ACT-CLINEMM-TASK-CONTROL-LIVENESS01-FIX01.
