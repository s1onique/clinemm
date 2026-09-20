# Diagnostic Design

## Architecture (mirrors TSWPD / THSICAP / W carrier)

```text
                          shared/runtime bounded ring
              background-owner-correlation.ts
                          |
                          v
              extension-side runtime adapter
              background-owner-correlation-runtime.ts
                          |
                          v
              Command Palette dump command
              cline.debug.dumpBackgroundOwnerCorrelation
                          |
                          v
              <globalStorageUri>/background-owner-correlation.jsonl
```

No webview handshake. No gRPC. No proto. No wire field.

## Capture seam (BOCOR §6 contract)

```text
DOGFOOD_ONLY
DEFAULT_OFF outside dogfood
READ_ONLY
BOUNDED
NO_STATE_SEMANTIC_DELTA
NO_PUBLIC_PROTOCOL_DELTA
NO_WEBVIEW_PROTOCOL_FIELD
NO_REACT_STATE
NO_FUNCTIONAL_UPDATER_SIDE_EFFECT
```

Diagnostic enablement does NOT affect:

```text
CommandJob lifecycle
TurnState lifecycle
session identity
guard result
tool execution
webview state
```

It observes only.

## Decision boundary

ONE single seam at the Q5 composition seam in
`SdkSessionEventCoordinator.handleSessionEvent`, immediately
BEFORE the `if (ownerStillRunning)` resolution. The capture
runs in the SAME done-without-completion branch where the
existing writer is bound (`session-event-turn-complete-
resumable-straggler-preserve`).

The capture happens AFTER:

  - event.payload.sessionId is read
  - activeSession.sessionId is read
  - activeJobs snapshot is read (new accessor)
  - hasRunningBackgroundJobForOwner is called
  - ownerStillRunning is computed

The capture happens BEFORE:

  - the if (ownerStillRunning) decision
  - the optional setTurnPhase("awaiting_followup", ...)
  - the TSWPD commit (which is via setTurnPhase in the else-branch)

This preserves the chronology:

```text
event received
  -> active session read
  -> active-job snapshot read
  -> owner query
  -> guard result
  -> diagnostic record (NEW)
  -> branch decision
  -> optional setTurnPhase
  -> TSWPD commit record
```

## Capture schema (BOCOR §15)

```json
{
  "event": "background_owner_correlation_decision",
  "capturedAt": "<unix-ms timestamp>",
  "taskId": "<string|null>",
  "sessionEventSessionId": "<string|null>",
  "activeSessionId": "<string|null>",
  "currentPhase": "streaming",
  "candidatePhase": "awaiting_followup",
  "guardAvailable": <bool>,
  "queriedOwnerSessionId": "<string|null>",
  "guardResult": "<bool|null>",
  "activeJobs": [
    { "jobId": "<id>", "state": "<CommandJobState>", "ownerSessionId": "<id|undefined>" }
  ],
  "candidateWriterId": "session-event-turn-complete-resumable-straggler-preserve"
}
```

`taskId` is sourced from `this.options.getTask?.()?.taskId`;
when the task is unavailable (tests that omit the option) it
defaults to `null` per the closed-runtime contract.

## Active-job ownership snapshot accessor (BOCOR §17)

New minimal read-only accessor on `CommandJobManager`:

```ts
getActiveJobOwnershipSnapshot(): ReadonlyArray<{
  readonly jobId: string
  readonly state: CommandJobState
  readonly ownerSessionId: string | undefined
}>
```

Contract:
  - INTERNAL (not on the public CommandJobSnapshot)
  - READ_ONLY (no mutation)
  - NO_WIRE_API / NO_PROTO / NO_RPC / NO_WEBVIEW_STATE
  - NO_PGID (identity only; getActiveCommandJobs() is the
    PGID-bearing containment view)
  - INCLUDES terminal-state jobs (so future correlation can
    distinguish "no job" from "different job")
  - P1 no-leak invariant preserved (the encapsulation
    invariant at line 925 of command-job-manager.ts is
    preserved; the snapshot shape does NOT spread the
    CommandJob record).

Wired through `VscodeSessionHost.getActiveJobOwnershipSnapshot`
(following the `hasRunningBackgroundJobForOwner` precedent)
and into `SdkController.getActiveJobOwnershipSnapshot` (the
existing option-wiring seam at line 1882-1894 of SdkController.ts).

## Dogfood profile resolver (BOCOR §12)

Three exported helpers in `dogfood-diagnostic-profile.ts`:

  1. `parseBackgroundOwnerCorrelationCaptureEnv(env)` —
     parses `CLINEMM_DIAG_BACKGROUND_OWNER_CORRELATION_V1`
     (`=1`/`true`/`yes` -> ON; `=0`/`off`/`false` -> OFF;
     garbage / unset -> falls through to (2)).
  2. `resolveEffectiveBackgroundOwnerCorrelationCapture(
        env, isDogfood)` — composes explicit env override >
     profile default (dogfood -> ON; public -> OFF).
  3. `applyBackgroundOwnerCorrelationDiagnosticProfile(
        env, isDogfood)` — the SINGLE production activation
     helper. Called from `extension.ts:activate` (sibling to
     the THSICAP / W carrier / D-knob activations). Idempotent;
     flips the module seam in `background-owner-correlation.ts`
     via `setBackgroundOwnerCorrelationCaptureEnabled(boolean)`.

No toggle command. No enable command. No clear command.
The operator workflow is:

```text
dogfood profile (default ON in dogfood)
  -> reproduce Working -> Your turn
  -> Cmd+Shift+P
  -> Cline Debug: Dump Background Owner Correlation
  -> receive the actual file path
```

## Dump command (BOCOR §10)

```ts
vscode.commands.registerCommand(
  commands.DumpBackgroundOwnerCorrelation,
  async () => {
    try {
      const { file, recordCount } =
        await dumpExtensionSideBackgroundOwnerCorrelationDiagnostic(context)
      void vscode.window.showInformationMessage(
        `Background owner correlation diagnostic: ${recordCount} record${recordCount === 1 ? "" : "s"} -> ${file}.`,
      )
    } catch (err) {
      Logger.error("[BOCOR] dump failed", err)
      void vscode.window.showErrorMessage(
        `Background owner correlation dump failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  },
)
```

The dump is unconditional (the operator can inspect any
captured records even after the diagnostic was disabled).
The dump does NOT clear the ring (`dump != clear`).
