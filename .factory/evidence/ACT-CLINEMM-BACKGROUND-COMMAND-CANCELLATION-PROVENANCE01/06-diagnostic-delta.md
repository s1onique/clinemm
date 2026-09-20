# 06 — Diagnostic delta

Extends BJLA (the existing Background Job Liveness Authority diagnostic at
`apps/vscode/src/sdk/background-job-liveness-authority.ts`) with a new
record type and a request-boundary capture seam.

## Vocabulary delta

Added one new event name: `job_cancellation_requested`.

The record shape is the canonical BJLA shape (event discriminator +
capturedAt timestamp + diagnostic identity tuple):

```ts
interface BackgroundJobLivenessAuthorityJobCancellationRequestedRecord {
  readonly event: "job_cancellation_requested"
  readonly capturedAt: number
  readonly managerInstance: string | null
  readonly hostInstance: string | null
  readonly jobId: string
  readonly requestOrigin: string         // ← THE PRIMARY DISCRIMINATOR
  readonly sessionId: string | null
  readonly taskId: string | null
  readonly currentState: CommandJobState
  readonly firstWriterWins: boolean       // FIRST-WRITER-WINS gate
}
```

`requestOrigin` is bounded to:

```text
background_cancel_rpc
manager_dispose
extension_shutdown
command_deadline
caller_abort_signal
other:<bounded id>          (escape hatch)
```

The new record is added to the union type
`BackgroundJobLivenessAuthorityRecord` so the existing dump command
`cline.debug.dumpBackgroundJobLivenessAuthority` serializes it
automatically — no new operator surface.

## Capture seams added

| Seam | Origin label | File |
|------|--------------|------|
| `VscodeSessionHost.cancelBackgroundCommand` | `background_cancel_rpc` | `vscode-session-host.ts:506` |
| `VscodeSessionHost.dispose` → `CommandJobManager.dispose` loop | `extension_shutdown` | `vscode-session-host.ts:601` → `command-job-manager.ts:3167` |
| `CommandJobManager.start` deadline watchdog | `command_deadline` | `command-job-manager.ts:1967` |
| `CommandJobManager.start` AbortSignal listener | `caller_abort_signal` | `command-job-manager.ts:1993` |
| `CommandJobManager.cancel` (default when no origin passed) | `other:unspecified` | `command-job-manager.ts:2824` |

## Capture seams that REMAIN unchanged

| Existing seam | File | Notes |
|---------------|------|-------|
| `manager_constructed` | `background-job-liveness-authority-runtime.ts` | Unchanged |
| `manager_dispose_begin` | `command-job-manager.ts:3132` | The `reason` field now carries the threaded origin (was `null`) |
| `manager_dispose_end` | `command-job-manager.ts` | Unchanged |
| `job_active_inserted` | `command-job-manager.ts` | Unchanged |
| `job_active_removed` | `command-job-manager.ts` | Unchanged |
| `process_terminality_record` | `command-job-manager.ts` | Unchanged |
| `job_status_lookup` | `command-job-manager.ts` | Unchanged |
| `job_cancel_lookup` | `command-job-manager.ts` | Unchanged |
| `background_state_change_published` | `command-job-manager.ts` | Unchanged |
| `job_lifecycle_event_published` | `command-job-manager.ts` | Unchanged |

## Public API delta — ZERO

- No new field on the proto `StringRequest` for `cancelBackgroundCommand`
- No new field on the webview state shape
- No new field on `SdkSessionHost` interface
- `CancelCommandJobOptions` gains ONE optional field (`origin`) — internal-only
- `CommandJobManager.dispose()` gains ONE optional parameter (`origin`) — internal-only
- `CommandJobManager.terminate()` gains ONE optional parameter (`_origin`) — preserved for future internal callers but the public capture is performed by the caller

## Operator surface delta — ZERO

The existing Command Palette command
`cline.debug.dumpBackgroundJobLivenessAuthority` (registered in
`apps/vscode/extension.ts`) serializes the bounded ring including the new
event. No new command, no new toggle, no new env var. Activation
remains dogfood-profile-only via the central
`applyBackgroundJobLivenessAuthorityDiagnosticProfile` resolver.

## Semantic delta — ZERO

- All `captureBackgroundJobLivenessAuthorityRecord` calls are no-ops when
  `captureEnabled` is false (the default). The BC-04 test proves this.
- The `cancel()`, `dispose()`, and `terminate()` flow semantics are
  unchanged. No new await boundaries, no new control flow, no new
  timing constraints.
- All existing BCLAS tests pass unchanged.

## Removed

Nothing. This ACT strictly ADDS to the diagnostic — no fields removed,
no events removed, no paths removed.
