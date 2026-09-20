# ACT-CLINEMM-BACKGROUND-COMMAND-LIFECYCLE-OWNERSHIP01-CORRECTION03

**Epistemic purpose:** Repair the production integration of the
jobId-targeted cancellation seam so a fresh `bun run vscode:prepublish`
dogfood build succeeds end-to-end.

**HALT trigger:** `HALT_DOGFOOD_BUILD_RED` — fresh `vscode:prepublish`
emitted 5 TypeScript errors that the narrower host-only typecheck
previously hidden.

**One-bounded-cycle constraint:** This is a CORRECTION03 despite the
normal one-review-cycle rule because the failure is genuinely new
executable production evidence (5 fresh TS errors from a clean
`bun run protos` + `tsc -b --force` chain) discovered after
CORRECTION02 closure.

---

## Diagnosis

The previous CORRECTION0X bounded repair correctly migrated the
production cancellation chain from `EmptyRequest` to `StringRequest`,
but the migration was incomplete in the webview:

1. The regenerated webview client at `grpc-client.ts:1077` correctly
   declares `cancelBackgroundCommand(request: proto.cline.StringRequest)`.
2. TWO handwritten call sites in `useMessageHandlers.ts` still pass
   `EmptyRequest`:
   - line 570 (streaming-cancel `executeButtonAction("cancel")` path)
   - line 640 (card-level dispatcher fallback when no jobId)
3. The `MessageHandlers` interface in `chatTypes.ts` was not updated
   to declare `cancelBackgroundCommandByJobId`, so the two card-level
   consumers (MessagesArea.tsx, MessageRenderer.tsx) cannot resolve
   the callback, and the object literal returned from `useMessageHandlers`
   is rejected as having an unknown property.

## RED witness

Preserved at `red-witness-vscode-prepublish.txt` (verbatim 5-error
tsc -b --force output).

## Bounded repair (3 production files)

### 1. `apps/vscode/webview-ui/src/components/chat/chat-view/types/chatTypes.ts`

Added `cancelBackgroundCommandByJobId: (jobId?: string) => Promise<void>`
to the `MessageHandlers` interface. The signature mirrors the
implementation shape that the CORRECTION0X bounded repair already
produced in `useMessageHandlers`.

### 2. `apps/vscode/webview-ui/src/components/chat/chat-view/hooks/useMessageHandlers.ts`

#### Site 570 (streaming-cancel)

Was: `await TaskServiceClient.cancelBackgroundCommand(EmptyRequest.create({}))`

Becomes:
```ts
await TaskServiceClient.cancelBackgroundCommand(StringRequest.create({ value: "" }))
```

Rationale: the streaming-cancel button has no jobId in scope (it
is not bound to any specific backgrounded CommandJob). The
backend's `cancelBackgroundCommand` already treats empty `value`
as "no jobId supplied" → legacy session-wide cancel fallback.
Empty `StringRequest` is therefore the correct shape here; it
preserves the jobId-targeted cancellation seam without fabricating
an identity this caller cannot know.

#### Site 640 (card-level dispatcher `cancelBackgroundCommandByJobId`)

Was:
```ts
const request = jobId ? StringRequest.create({ value: jobId }) : EmptyRequest.create({})
await TaskServiceClient.cancelBackgroundCommand(request)
```

Becomes:
```ts
if (!jobId) {
    console.warn("cancelBackgroundCommandByJobId called without jobId; skipping (no identity to cancel)")
    return
}
const request = StringRequest.create({ value: jobId })
await TaskServiceClient.cancelBackgroundCommand(request)
```

Rationale: the card-level Cancel button is bound to a specific
backgrounded CommandJob and always supplies a real id. If a caller
invokes this dispatcher without a jobId, the request is meaningless
— we log and skip rather than emit an empty `StringRequest` that
the backend would (legitimately) interpret as a session-wide cancel.

## Production invariant

```
UI Cancel(jobId)
  → MessageHandlers(jobId)
  → StringRequest{value: jobId}
  → cancelBackgroundCommand
  → exact CommandJob
```

This invariant is preserved: every UI cancellation call carries
an explicit jobId through the dispatcher.

## GREEN witness

`bun run check-types` → EXIT=0 (runs `protos → biome format →
tsc --noEmit → tsc compat → cd webview-ui && tsc -b --noEmit`).

`bun run test:unit` → 82 files / 1141 tests / 0 failures / 44.8s.

The 5 RED-witness TS errors are no longer emitted; they were
replaced by the 3 production edits above.

## Files updated

- `apps/vscode/webview-ui/src/components/chat/chat-view/types/chatTypes.ts`
- `apps/vscode/webview-ui/src/components/chat/chat-view/hooks/useMessageHandlers.ts`
- `.factory/epic-board.md` (this ACT's row)
- `.factory/acts/ACT-CLINEMM-BACKGROUND-COMMAND-LIFECYCLE-OWNERSHIP01-CORRECTION03/`
  (RED + GREEN witnesses)

## Status

PASS_PRODUCTION_INTEGRATION_REPAIR. The dogfood build is GREEN.
Live operator qualification (⎇ 1 → 0 round-trip per CORRECTION02)
can now resume.
