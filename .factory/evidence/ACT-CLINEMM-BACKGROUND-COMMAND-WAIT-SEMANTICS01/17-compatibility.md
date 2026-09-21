# 17 — Compatibility (frozen)

Impact of Contract B on current behavior.

## 17.1 Backwards compatibility

```text
Existing tasks that assume polling:
  unchanged (default is notifyOnCompletion=false → wake consumer
  is dormant → today's behavior is preserved exactly)

Existing Proceed While Running (foreground UX):
  unchanged (this is a USER UX affordance for foreground terminals,
  not the background-execution path; see §3.2)

Existing fire-and-forget:
  unchanged (this is the default behavior; notifyOnCompletion=false
  is the explicit opt-out and is also the default)

Existing TaskHeader:
  unchanged (no card surface change in this ACT)

Existing terminal continuation:
  unchanged (the BTCONT01 turn-state consumer runs alongside
  the wake consumer; both consumers operate on the same
  onCommandJobLifecycle callback)

Existing stale card:
  unchanged (the LIVE_PROVEN stale-card defect remains the
  responsibility of ACT-CLINEMM-BACKGROUND-COMMAND-TERMINAL-CARD-PROJECTION01)

Existing CommandJobManager.start / cancel / status / treeEscapee
semantics:
  unchanged (the wake consumer is a NEW lifecycle subscriber; it
  does not modify the existing CommandJob state machine)
```

## 17.2 Tool schema compatibility

```text
OLD schema:
  { commands: string[] }   // .strict() — rejects unknown fields

NEW schema:
  { commands: string[], notifyOnCompletion?: boolean }

Compat impact:
  - Existing calls WITHOUT notifyOnCompletion: identical behavior
    (the field is optional; default false; the wake consumer is
    dormant).
  - Existing calls WITH a typo for the new field: rejected by
    .strict() at runtime. This is the intended behavior (no silent
    acceptance of unknown fields).
  - New calls WITH notifyOnCompletion:true: enable the wake
    consumer; same shape as old calls in every other way.
```

## 17.3 Default behavior compatibility

```text
TODAY (no contract selected):
  - terminal event → turn-state awaiting_followup (BTCONT01)
  - no agent re-entry
  - user polls or follows up manually

AFTER Contract B (with default notifyOnCompletion=false):
  - terminal event → turn-state awaiting_followup (BTCONT01)
  - wake consumer checks notifyOnCompletion; it is false → DORMANT
  - no agent re-entry
  - user polls or follows up manually
  → IDENTICAL to today.
```

## 17.4 Opt-in behavior (new)

```text
WITH notifyOnCompletion:true:
  - terminal event → turn-state awaiting_followup (BTCONT01)
  - wake consumer checks notifyOnCompletion; it is true → ACTIVE
  - one wake delivered exactly once via PendingPromptsController
  - user-visible: agent resumes after terminal
  → NEW behavior, opt-in only.
```

## 17.5 Tool result compatibility

```text
The run_commands tool result envelope is unchanged:
  - RUNNING with jobId (existing)
  - terminal with state/exitCode/etc. (existing)
  - command_status and cancel_command unchanged
```

## 17.6 What does NOT change in this contract

```text
- F4 ("run them in background and redirect to a tmp file...")
  remains the model-facing instruction for output management.
- The wake consumer is a strict superset of today's behavior.
- Default behavior is byte-identical to today.
- All existing tests (AGCONT01 family, BTCONT01 family, etc.)
  must continue to pass.
```

## 17.7 What does change

```text
- The run_commands schema gains an OPTIONAL boolean field.
- The F4 description gains a single appended paragraph about the
  notify flag.
- ONE new lifecycle subscriber is registered on the
  CommandJobManager.onCommandJobLifecycle callback.
- The wake subscriber:
  - subscribes to the per-job `command_job_terminal_committed`
    lifecycle event (NOT the `>0 -> 0` cardinal transition).
  - reads the notifyOnCompletion flag from the COORDINATOR-OWNED
    active-notify set (`notificationMarkers` map at the
    SdkSessionEventCoordinator seam, per §15.7.1 + §15.7.3),
    NOT from the CommandJob record. CommandJob's footprint is
    preserved.
  - on per-job terminal, applies the §10.8
    NOTIFICATION_LIFETIME_INVARIANT (per-session + per-task
    identity; epoch NOT used).
  - if same-owner otherNotifyCount > 0, HOLD the wake in the
    session/coordinator held set (FIFO by createdAtMs).
  - if same-owner otherNotifyCount === 0, DRAIN held wakes
    (FIFO) + enqueue the current job's wake via
    PendingPromptsController.enqueue with delivery:"queue".
  - the wake prompt is a bounded GENERATED PROMPT STRING
    (formatTerminalWakePrompt, per §15.7.2), NOT a typed payload.
  - is dormant when the marker is absent or notifyOnCompletion
    is false (DETACH intent).
```

## 17.8 Why this is a strict-superset change

```text
For any existing code path that does not set notifyOnCompletion:
  - The wake consumer is dormant.
  - No new behavior is observed.
  - All existing tests pass unchanged.

For any new code path that sets notifyOnCompletion:true:
  - The wake consumer is active.
  - The wake is delivered via the existing PendingPromptsController.
  - The wake is bounded by the existing identity-correlating
    machinery.

No existing test breaks. No existing user-visible behavior changes.
The new behavior is opt-in and additive.
```
