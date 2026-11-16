# 01 — Publication contract

**ACT:** `ACT-CLINEMM-MCP-TASK-STATE-PROJECTION01`

---

## C1.1 — Current header authority (confirmed at the inspected revision)

The production chain, confirmed by reading the source at
`5dc1394802b86cb1ac996396fda2ca4b72212a70`:

```
TurnStateTracker + canonical shadow
  → pickTaskHeaderPresentationForPublication()      apps/vscode/src/sdk/task-header-elm-authority.ts:79
    → Elm task-header authority                     (apps/vscode/elm/task-header-orchestration/)
      → ExtensionState.taskHeaderPresentation       apps/vscode/src/sdk/SdkController.ts (inside getStateToPostToWebview)
        → webview state publication                  apps/vscode/src/core/controller/state/subscribeToState.ts:71
          → TaskHeaderTelemetry                     apps/vscode/webview-ui/src/components/chat/task-header/TaskHeaderTelemetry.tsx
            → taskHeaderPresentationStateLabel()    apps/vscode/webview-ui/.../taskHeaderTelemetryHelpers.ts
              → rendered label
```

**The Elm kernel owns the semantic presentation decision.** The webview
translates that projection into its user-facing label.

`task-header-elm-authority.ts:79` — `pickTaskHeaderPresentationForPublication`
is the sole production authority. Its failure policy (frozen by
`CORRECTION01-FAILURE-CACHE-SCOPE`) is the **bounded sentinel**:

```ts
function boundedIdleHostSentinel(seq: number): TaskHeaderPresentationProjection {
	return { phase: "idle", source: "host", seq }
}
```

There is **no hold-last-good cache** — the module-scoped cache was
removed because it could leak a successful result from one task into
another task's failure fallback.

**MCP must not create a competing semantic selector.** This ACT adds no
selector: it captures the projection the Elm authority already produced.

---

## C1.2 — The publication boundary

### What `getStateToPostToWebview()` does and does NOT prove

`SdkController.getStateToPostToWebview()` is invoked from **three**
places:

1. `SdkController.flushStateToWebview()` — the regular state-push path.
2. `SdkController.grpcBridge.setGetStateFn(() => this.getStateToPostToWebview())`
   — the gRPC bridge's state accessor.
3. `subscribeToState()` (the `StateService.subscribeToState` handler) —
   the INITIAL state push for a newly subscribing webview.

Therefore **merely constructing a snapshot is NOT sufficient to call it
published.** A snapshot produced by (2) or (3) never traversed the
controller's regular push path and must not be treated as a controller
publication of the task-header phase.

### The actual successful handoff boundary

`SdkController.flushStateToWebview()`:

```ts
private async flushStateToWebview(): Promise<void> {
	const { sendStateUpdate } = await import("@core/controller/state/subscribeToState")
	const state = await this.getStateToPostToWebview()
	const handedOff = await sendStateUpdate(state)     // <-- the handoff
	if (handedOff) {
		this.capturePublishedTaskState(state)            // <-- ACT capture
	}
}
```


### The version / sequence domains

| Field | Domain | Source | Used for |
|---|---|---|---|
| `taskHeaderPresentation.seq` | presentation / turn-state | `TurnStateTracker.seq` | Transport-level stale-push fencing of the projection itself. |
| `stateVersion` | ExtensionState publication | `minter.nextSeq()` (`SdkController.ts`, `sharedSeq`) | Ordering publications; the webview reducer's same-epoch gate. |
| `epoch` | conversation | `minter.epoch` | Fencing a previous task/render's traffic. |

**`seq` and `stateVersion` are DIFFERENT clocks.** The ACT never
compares them to each other. Ordering uses `stateVersion` alone (within
one identity and epoch); `seq` is carried through verbatim as the
projection's own sequence.

### The fences reused

| Fence | Where | Effect |
|---|---|---|
| Epoch transition | `SdkController.resetMessageTranslatorAndFence()` — calls `publishedTaskState.invalidate()` | The previous epoch's projection is dropped. |
| Task clear (universal choke-point) | `SdkController.clearTask()` — calls `publishedTaskState.invalidate()` | Task A's projection cannot be returned for task B. |
| Controller disposal | `SdkController.dispose()` — calls `publishedTaskState.invalidate()` | A disposed controller exposes nothing. |
| Session replacement | Identity check in `projectControlSeamTaskState` (sessionId + taskId) | A new session cannot inherit the old session's projection, even under the same task id. |
| Out-of-order async publication | `PublishedTaskStateStore.capture()` — `stateVersion` must be strictly greater within one identity+epoch | A late completion cannot replace a newer publication. |
| Older-epoch publication | `PublishedTaskStateStore.capture()` — `epoch` must not go backwards | A straggler from a previous epoch cannot resurrect. |

### The authority read (identity-bound projection)

`apps/vscode/src/sdk/control-seam/control-seam-authority.ts`:

```ts
export function projectControlSeamTaskState(
	published, activeSessionId, activeTaskId, currentEpoch,
): ControlSeamTaskState | undefined {
	if (!published) return undefined
	if (!activeSessionId || published.sessionId !== activeSessionId) return undefined
	if (!activeTaskId || published.taskId !== activeTaskId) return undefined
	if (currentEpoch === undefined || published.epoch !== currentEpoch) return undefined
	const label = taskHeaderPhaseLabel(published.projection.phase)
	return { phase, source, seq, epoch, stateVersion, ...(label !== undefined ? { label } : {}) }
}
```

When the current identity cannot be established, `taskState` is
**omitted**. There is **no fabricated `idle`**.

---

## C3.1 — The label contract

The UI label mapping originally lived only in the webview module
`taskHeaderTelemetryHelpers.ts` (`stateLabel`). The extension host
cannot import webview code, and the webview bundle cannot import host
code — so the naive fix would have been a **second switch statement**
with its own permanent semantics, which the ACT forbids.

Instead the mapping was **extracted** into
`apps/vscode/src/shared/task-header-state-label.ts`
(`taskHeaderPhaseLabel`). The `@shared/*` alias is configured on BOTH
sides (`apps/vscode/tsconfig.json` and
`apps/vscode/webview-ui/tsconfig.app.json`), so:

- the webview `stateLabel()` now reads the label text from the shared
  mapping (it keeps only the webview-only `glyph` / `live` facets), and
- the MCP authority reads the SAME mapping.

There is exactly ONE `TurnPhase → label` vocabulary.

The shared function is named `taskHeaderPhaseLabel` (not
`taskHeaderStateLabel`) because the webview module already exports a
*different* function named `taskHeaderStateLabel(turnState)`; the
distinct names prevent a silent mis-binding.

The canonical vocabulary (unchanged):

| Phase | Label |
|---|---|

---

## C3.2 — Strict validation

`isControlSeamRunIdentity` (the codec's fail-closed allow-list) rejects:

| Rejected | Mechanism |
|---|---|
| Unknown top-level properties | `ALLOWED_RUN_IDENTITY_KEYS` |
| Unknown `taskState` properties | `ALLOWED_TASK_STATE_KEYS` |
| Unknown phase values | `ALLOWED_TASK_STATE_PHASES` (the eight canonical `TurnPhase` values) |
| Invalid source discriminants | `ALLOWED_TASK_STATE_SOURCES` (`shadow` / `host` / `legacy`) |
| Invalid / negative sequence or version values | `isNonNegativeInteger` (finite, integer, `>= 0`) |
| Missing required nested fields | each required field is checked explicitly |
| `null` substituted for optional absence | `record.taskState !== undefined && !isControlSeamTaskState(...)` → `null` fails `isControlSeamTaskState`; `taskId: null` fails the `typeof === "string"` check |
| Arbitrary transcript data | the `taskState` key allow-list admits no such field |
| Credential-bearing fields | the key allow-list admits no such field |
| Mutable references to controller-owned state | the store returns a **frozen** record and a frozen projection |

The request authentication, the foreign-session refusal, and the
payload-size bounds are **unchanged**.

**Protocol version:** `CONTROL_SEAM_PROTOCOL_VERSION` stays `1`. The
change is additive and optional; no existing client contract requires a
version bump.

---

## C7 — Conservation boundaries honoured

| Out-of-scope item | Status |
|---|---|
| Repairing the historical completion incident | not touched |
| Changing C9/C10/BCB completion policy | not touched |
| Adding or rewriting Elm task-state authority | not touched — the Elm kernel is still the sole authority |
| Changing React task-header semantics | not touched — only the label TEXT source was shared; the glyph / live facets and all rendering are unchanged |
| Altering run-started/continuation correlation | not touched |
| Starting or controlling ClineMM tasks through MCP | not touched — the authority surface has no mutating member |
| Adding MCP cancellation / approval / feedback operations | not touched — the registry still has exactly two operations |
| Replacing `LocalRuntimeHost` with `HubRuntimeHost` | not touched |
| Supporting CLI ↔ VS Code attachment | not touched |
| Upgrading the MCP SDK | not touched |
| Adding an event-streaming / notification infrastructure | not touched |
| Reconstructing webview state by reading the DOM | not touched |
| Modifying unrelated upstream integration code | not touched |
| `proto/` changes / generalized RPC / public agent API | none |
| A third MCP operation | none — the registry remains `clinemm_capabilities` + `clinemm_get_run` |

| `idle` | Idle |
| `streaming` | Working |
| `awaiting_approval` | Approval |
| `awaiting_followup` | Your turn |
| `compacting` | Compacting |
| `completed` | Complete |
| `error` | Error |
| `resumable` | Paused |

`sendStateUpdate()` (`apps/vscode/src/core/controller/state/subscribeToState.ts`)
is the boundary. Its ACT-owned change is minimal and additive: it now
returns `true` when the state was serialized and dispatched, and `false`
when the handoff failed (the payload could not be serialized, so NOTHING
was dispatched). The previous signature returned `Promise<void>` and
swallowed the serialization failure — which made "publication failed"
unobservable. The serialization/dispatch logic itself is unchanged.

**Consequences of this boundary choice:**

| Fact | Status |
|---|---|
| A constructed-but-never-submitted snapshot is exposed? | **NO** — the capture only runs inside `flushStateToWebview()` after a successful `sendStateUpdate`. |
| A failed publication advances the record? | **NO** — `handedOff === false` short-circuits the capture. |
| A successful eligible publication is observable? | **YES** — the capture runs on the SAME `ExtensionState` object that was submitted. |
| Does a successful host submission prove React committed? | **NO.** `sendStateUpdate` dispatches fire-and-forget; the webview reconciles convergently and may drop the snapshot on its `stateVersion` / `epoch` fence. The MCP projection is documented as "last host-submitted", NOT "currently rendered". |
