# 12 — Persistence scope (S11)

## 12.1 What survives a restart

For Candidate B, what state must survive a restart?

```text
- The CommandJob's identity (jobId, ownerSessionId).
- The CommandJob's terminal state (one of the five classes from §11).
- The CommandJob's terminal payload (exitCode, signal, stdout, stderr).

The notify=true flag is NOT stored on CommandJob. It lives in
the COORDINATOR'S notificationMarkers map (per §15.7.1 + §15.7.3),
which is EPHEMERAL and dies with the session. Therefore the
notify-on-terminal wake is LOST on restart by design (matches the
session-scoped lifetime invariant in §10.8).

The deferred marker (sessionId, taskId) is session-scoped.
A sessionId that no longer exists is a discarded wake (see §10.8).
A taskId that no longer exists is a discarded wake (see §10.8).
(Epoch is NOT used for the notify-on-terminal lifetime decision —
see §10.8.)
```

## 12.2 What may NOT survive a restart (v1 scope)

```text
- The wake consumer's transient state (the PendingPromptsController
  queue, the in-memory wake intent map).
- The minter epoch (resets on restart; any in-flight wake held
  by epoch binding will be discarded).
```

## 12.3 What this means for v1

```text
PERSISTENCE =
  EPHEMERAL_ONLY for v1.

A wake that is in-flight at restart time is LOST. The user will
see the terminal state in the webview (the jobId row is terminal
in the CommandJobManager) but will NOT receive a wake.

This is acceptable for v1 IF the product wording is honest:
"Background command completion notification is best-effort and
may be lost across host restarts. If you need durable notification,
issue follow-up polls with command_status or use cancel_command
to verify the outcome."
```

## 12.4 Why ephemeral-only is acceptable

- The CommandJobManager's terminal state DOES survive (it is
  in-memory but the host process owns it; on restart, the job is
  no longer there, but the user can re-check via command_status).
- The user-visible webview projection also survives (the job row
  is in the host's session storage).
- The wake is a convenience, not a guarantee.

## 12.5 Future-cycle scope (out of v1)

```text
If persistence becomes required:
  - Serialize the wake intent at terminal-event time.
  - On restart, restore the wake intent and re-evaluate against
    the current session state.
  - Apply the same conservation rules (sessionId, taskId, epoch).

This is a separate ACT.
```

## 12.6 What this ACT freezes

```text
PERSISTENCE_SCOPE_V1 = EPHEMERAL_ONLY.
DOCUMENT_IN_USER_FACING_DOCTRINE =
  "Completion notification is best-effort and may be lost across
   host restarts. Use command_status or cancel_command to verify
   the outcome of a long-running command if restart-recovery is
   required."

A future ACT may upgrade this to PERSISTED if product demand
warrants it. This ACT does NOT fund that future ACT.
```
