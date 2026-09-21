# 02 — LIVE Failure Freeze

## Symptom

```text
authoritative job state:
  terminal (exited | cancelled | deadline_exceeded | failed | containment_failed)
  process gone
  active CommandJob = absent
  background running = false

UI card:
  ● Backgrounded
  Cancel
```

Multiple LIVE specimens (predecessor ACT chain).

## Authority chain

- `CommandJobManager` is the canonical lifecycle publisher
  (`apps/vscode/src/sdk/command-job-manager.ts:621`).
- `SdkController.updateBackgroundCommandState` (line 4376) flips
  `backgroundCommandRunning` and `backgroundCommandTaskId` (the ⎇
  gauge + active-job identity for `TaskHeader`).
- The webview's say:"command" row carries an immutable historical
  envelope `{status:"running", jobId:"cmd_..."}` and a per-row
  `commandExecutionDisposition === "backgrounded"` marker stamped
  by the message-translator at content_end
  (`apps/vscode/src/sdk/message-translator.ts:1765-1804`).
- After content_end, NOTHING re-emits the same row with a terminal
  `commandExecutionDisposition`. The row stays
  `commandExecutionDisposition === "backgrounded"` until a NEW
  say:"command" message is produced (which is a NEW clineMessages
  entry, not a mutation of the previous one).
- `ChatRow.tsx:236` derives `isCommandBackgrounded` purely from
  the row's `commandExecutionDisposition` flag, with no
  cross-reference to the ⎇ gauge or per-job state.

## BGCL-09 explicit acknowledgement

`webview-ui/src/components/chat/__tests__/background-command-lifecycle-ownership.bgcl01.test.tsx:222-246`
explicitly freezes the current narrow contract:

> "no row-mutation seam exists today"
> "The webview receives no clineMessages update for this row
>  after the initial Backgrounded stamp, so the row stays
>  Backgrounded forever (until the next model turn that
>  explicitly produces a terminal say:'command' row)"

This ACT introduces that row-mutation seam.

## Verdict

```text
STALE_CARD_LIVE_FAILURE = PROVEN
STALE_CANCEL_LIVE_FAILURE = PROVEN
```

(Proven by predecessor evidence; not re-discovered here.)
