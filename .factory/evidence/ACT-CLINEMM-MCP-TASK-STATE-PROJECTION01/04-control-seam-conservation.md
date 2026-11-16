# 04 — Control-seam conservation

**ACT:** `ACT-CLINEMM-MCP-TASK-STATE-PROJECTION01`

---

## The operation registry is unchanged

`apps/vscode/src/sdk/control-seam/control-seam-protocol.ts`:

```ts
export const CONTROL_SEAM_OPERATION_IDS = ["clinemm_capabilities", "clinemm_get_run"] as const
```

- **No third operation was registered.**
- Both operation ids are unchanged.
- Both remain `mutating: false` (a type-level invariant:
  `ControlSeamOperation` only admits `mutating: false`).
- The `CONTROL_SEAM_OPERATIONS` descriptions are unchanged.

**Witness.** The existing `control-seam.qual01.test.ts` witness
`QL21 — EXACTLY two READ-ONLY operations remain, and no mutating
operation exists` passes unchanged. The existing proxy witness `PX01`
asserts the MCP tool list is exactly
`["clinemm_capabilities", "clinemm_get_run"]` and that none of
`start_act`, `send_feedback`, `cancel_run`, `run_commands`, `editor`,
`read_file` is present — it passes unchanged.

---

## The wire payload allow-list is strictly extended, not loosened

`isControlSeamRunIdentity` is the codec's fail-closed validator, applied
on the way OUT of the server (`ControlSeamServer.handleGetRun`) and used
by the tests.

| Set | Members |
|---|---|
| `ALLOWED_RUN_IDENTITY_KEYS` | `sessionId`, `taskId`, `running`, `runtimeStatus`, `queuedPromptCount`, `runId`, **`taskState`** |
| `ALLOWED_TASK_STATE_KEYS` | `phase`, `source`, `seq`, `epoch`, `stateVersion`, `label` |

Everything else is rejected. There is **no** wildcard, no `…`, no
"unknown keys pass" branch.

`ControlSeamServer.handleGetRun` still refuses a widened payload:

```ts
if (!isControlSeamRunIdentity(identity)) {
	return controlSeamError(CONTROL_SEAM_ERROR_CODES.internal, "run identity failed the payload allow-list")
}
```

**Classification:** `REAL_PRODUCTION_SEAM` — the validator is exercised
by the server's own `handleGetRun` path.

---

## The request-side contract is unchanged

| Property | Status |
|---|---|
| Bearer-token authentication | **Unchanged.** `constantTimeEquals(request.token, handle.token)` in `handleLine`, before the operation dispatch. The token is never logged. |
| Constant-time comparison | **Unchanged.** `constantTimeEquals` is untouched. |
| Foreign-session refusal | **Unchanged.** `handleGetRun` compares the echoed session id against the active session id and refuses a mismatch with `control_seam_foreign_session`. |
| Request byte bound | **Unchanged.** `CONTROL_SEAM_MAX_REQUEST_BYTES = 64 * 1024`; the accumulated incomplete line is bounded and an oversized line is rejected with `control_seam_payload_too_large` and the connection is closed. |
| Response byte bound | **Unchanged.** The client's incomplete-line buffer is bounded identically. |
| Per-request timeout | **Unchanged.** `CONTROL_SEAM_DEFAULT_REQUEST_TIMEOUT_MS = 10_000`; every outstanding request is settled on response / close / error / end / timeout. |
| Socket ownership | **Unchanged.** The 0700 directory, the 0600 socket and token, the explicit owner record, and the ownership-scoped cleanup are untouched. |
| Enabled/disabled resolution | **Unchanged.** `resolveControlSeamEnablement(env, optInValid)` still governs `ControlSeamServer.start()`. |
| Transport | **Unchanged.** NDJSON over AF_UNIX; the proxy is still a stdio MCP server. |
| Text-result transport for Codex Desktop | **Unchanged.** `toToolResult` still emits `{ content: [{ type: "text", text: JSON.stringify(result) }] }`. No structured result was added, so no client compatibility risk is introduced. |

**Witnesses.** `control-seam.qual01.test.ts` (QL01–QL21) passes
unchanged: explicit instance ownership, every-outstanding-request
settlement, bounded NDJSON, validated opt-in record, and the two-operation
registry.


---

## The MCP tool description

`clinemm_get_run`'s description now states the contract explicitly:

```
Read the active ClineMM run's session identity and authoritative status.
Read-only; does not start, steer, or cancel anything.

Field semantics:
  running: SDK agent turn currently in flight.
  taskState.phase: Last identity-bound host-submitted TaskHeader phase.
    Vocabulary: idle | streaming | awaiting_approval | awaiting_followup |
                compacting | completed | error | resumable
  taskState.source: Provenance of the published projection (shadow | host | legacy).
  taskState.seq: Presentation/turn-state sequence of the published projection.
  taskState.epoch: Conversation epoch of the published state.
  taskState.stateVersion: Publication version of the submitted state.
  taskState.label: The TaskHeader's user-facing label for that phase.

running=false does NOT mean completed.
taskState.phase=completed is the published terminal presentation,
not proof that every React render has committed.
taskState is omitted when no valid identity-bound published projection exists.
```

The phase vocabulary is documented in the tool description, as the ACT
requires (C3.1's fallback clause), in addition to being enforced by the
wire validator.

---

## The read-only surface

`ControlSeamAuthority` now has SEVEN members, all reads:

```
readActiveSessionId
readActiveTaskId
readCurrentEpoch
readIsRunning
readPublishedTaskState
readQueuedPromptCount
readRuntimeSnapshot
```

There is **no** mutating member, so a caller holding only this interface
cannot start, steer, cancel, approve, or otherwise change a task.

**Witness.** `R4-5` asserts the exact member set of the authority
surface — the structural proof that an MCP read cannot reach the Elm
kernel, the state-post path, or the runtime.

The MCP read path is:

```
ControlSeamServer.handleGetRun
  -> readControlSeamRunIdentity(authority)
       -> authority.readActiveSessionId()      (READ)
       -> authority.readRuntimeSnapshot()      (READ)
       -> authority.readActiveTaskId()         (READ)
       -> authority.readIsRunning()            (READ)
       -> authority.readQueuedPromptCount()    (READ)
       -> authority.readPublishedTaskState()   (READ)
       -> authority.readCurrentEpoch()         (READ)
```

No Elm invocation, no `getStateToPostToWebview()`, no new shadow
projection, no state post, no agent execution.

---

## The ACT's production diff is bounded

| File | Change | Nature |
|---|---|---|
| `apps/vscode/src/shared/task-header-state-label.ts` | **NEW** — the shared pure phase→label mapping | Additive; no behaviour change to the UI (the label text is identical). |
| `apps/vscode/src/sdk/published-task-state.ts` | **NEW** — the bounded record store | Additive; no side effects. |
| `apps/vscode/src/sdk/control-seam/control-seam-protocol.ts` | `ControlSeamTaskState` + the `taskState` key + strict validation | Additive; the allow-list is extended, never loosened. |
| `apps/vscode/src/sdk/control-seam/control-seam-authority.ts` | `readPublishedTaskState` + `readCurrentEpoch` + `projectControlSeamTaskState` | Additive reads. |
| `apps/vscode/src/sdk/control-seam/control-seam-runtime.ts` | The two new surface members are forwarded | Additive. |
| `apps/vscode/src/sdk/control-seam/control-seam-proxy.ts` | The `clinemm_get_run` tool description | Additive documentation; the transport is unchanged. |
| `apps/vscode/src/core/controller/state/subscribeToState.ts` | `sendStateUpdate` returns `Promise<boolean>` | Additive return value; the serialization and dispatch logic is byte-identical. |
| `apps/vscode/src/sdk/SdkController.ts` | The store field, the capture at the handoff, the two authority reads, three `invalidate()` calls | Additive. |
| `apps/vscode/webview-ui/src/components/chat/task-header/taskHeaderTelemetryHelpers.ts` | `stateLabel` reads the label TEXT from the shared mapping | Behaviour-preserving; the rendered label is identical (the existing 45-test label matrix passes unchanged). |

**No `proto/` change. No generalized RPC. No new public agent API. No
new MCP operation. No new dependency. No SDK upgrade.**

---

## What the MCP layer does NOT do

| Forbidden | Status |
|---|---|
| Call the Elm kernel again for MCP | **NO** — the capture reads the already-selected projection. |
| Call `getStateToPostToWebview()` in response to an MCP request | **NO** — the authority has no such member. |
| Derive the phase from `ActiveSession.isRunning` | **NO** — `running` and `taskState.phase` are independent; `R1-1` and `R1-2` prove it in both directions. |
| Derive completion from a persisted session-process exit status | **NO** — the authority has no access to any exit status. |
| Inspect the last assistant message | **NO** — the authority has no access to messages. |
| Construct a fresh shadow projection on an MCP read | **NO**. |
| Subscribe to additional runtime or webview events for this feature | **NO** — no subscription was added; the capture rides the existing publication path. |
| Add a cached last-good fallback | **NO** — the store holds exactly the last accepted publication. |
| Replace the Elm failure sentinel with an inferred status | **NO** — the published value is carried verbatim, provenance included. |
| Use the name `taskStatus` for a completion decision | **NO** — the property is `taskState`; `R5-5` asserts no `taskStatus` key is ever emitted. |
