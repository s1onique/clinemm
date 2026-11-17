# C1 / C2 / C3 — Security, opt-in, and the two new operations

## C1.1 Two independent credentials

| Credential | Purpose | Source | Compared |
|---|---|---|---|
| **Read token** | `clinemm_capabilities`, `clinemm_get_run` | `<clineDir>/data/control-seam/token` (0600) | `constantTimeEquals` per request |
| **Write token** | `clinemm_start_act`, `clinemm_read_events` | `<clineDir>/data/control-seam/write-token` (0600) | `constantTimeEquals` per request |

The write credential is **independently random** (`randomBytes(32)`), is
**never derived from** and **never equal to** the read token (proved by
`R1-4`), and is minted **once per extension-host instance** — a host
restart mints a new one and the old one is invalid (proved by
`R6-5`).

**The read token alone cannot mutate.** The write operations require
BOTH the read token (so the read path keeps its exact existing
semantics) AND a valid write credential. Proved by `R1-1`, `R1-2`,
`R1-3`.

## C1.2 Default OFF, separately enabled

| Decision | Default | How it is turned on |
|---|---|---|
| Seam (read) enablement | **OFF** | `enabled.json` record or env override (pre-existing RECON01 mechanism, unchanged) |
| **Mutation** enablement | **OFF** | `mutation.json` record (`{ "v": 1, "enabled": true, "allowContentRead": false }`) in the SAME 0700 directory |

The two decisions are **independent**: `enabled.json` turns the READ
seam on, `mutation.json` turns MUTATION on. The presence of the
mutation record alone does NOT enable the seam. Proved by `R1-3` and
`R6-9`.

**The content-read sub-grant is a THIRD, separate decision.**
`allowContentRead` defaults to `false`. Without it, `clinemm_read_events`
still returns the event METADATA (cursor, epoch, type, kind,
timestamp) — the conservative path — and **every `text` field is
stripped at the wire boundary**. Proved by `R5-6`.

## C1.3 Transport and file protections — unchanged

| Property | Value |
|---|---|
| Transport | **AF_UNIX only.** No TCP, no HTTP, no SSE. |
| Directory mode | `0700` (`CONTROL_SEAM_DIR_MODE`) |
| Socket / token / write-token file mode | `0600` (`CONTROL_SEAM_FILE_MODE`) |
| Write-token file | distinct from the read-token file; removed on dispose (`R6-8`) |
| Secret logging | **None.** No credential, prompt, or transcript appears in any log line or MCP tool response. |
| Credential invalidation on host replacement | The write credential dies with the host instance (`R6-5`). The write-token FILE is removed on dispose. |

## C1.4 Per-request authorization on an OPEN connection

The mutation grant is re-evaluated on **every** write request, not once
per connection. `authorizeControlSeamMutation()` runs the constant-time
comparison each time, so a client that loses authorization mid-stream
cannot keep mutating. The workspace is **re-verified at request time**
against the host's own current workspace, so a user who opens a
different folder invalidates the grant (`R6-1b`).

## C1.5 The client can never SELECT a workspace

`expectedWorkspace` is the client's **ASSERTION**. It is compared
against the grant's workspace, which the extension host resolved from
its **OWN** installed-workspace owner
(`SdkController.getWorkspaceRoot()` → `HostProvider.workspace.getWorkspacePaths()`).
A mismatch is rejected (`R6-1`). The workspace is never taken from the
request.

## C1.6 Approval conservation — no bypass introduced

| Forbidden by the contract | Present? | Evidence |
|---|---|---|
| YOLO mode | **NO** | No auto-approve flag is set anywhere in the diff. |
| Automatic approval overrides | **NO** | The start routes through the EXISTING `initTask()` → `SdkTaskStartCoordinator` → `SdkSessionLifecycle.startNewSession()` chain, which preserves the native approval path. |
| Shell execution shortcuts | **NO** | `run_commands` is not a registered operation (`R6-10`). |
| Editor-tool bypasses | **NO** | `editor` / `read_file` / `write_file` are not registered operations (`R6-10`). |
| Hidden tool approvals | **NO** | The seam exposes no approval-responding operation; `clinemm_respond_approval` is deliberately NOT implemented (C8). |
| Settings modifications | **NO** | No settings operation exists. |
| Access to another active task | **NO** | The start is REJECTED when an active task owner exists (`R4-1`); the event read is scoped to the owned session (`R5-5`). |

**The seam creates no execution authority.** It holds the SAME
`ClineCore` / `LocalRuntimeHost` / `SessionRuntime` chain the UI uses,
reached through the EXISTING `initTask()` lifecycle. There is no second
runtime and no second execution loop.

## C2 — `clinemm_start_act`

### The contract as implemented

```json
{
  "requestId": "unique-client-operation-id",
  "prompt": "Fix the three test failures...",
  "expectedWorkspace": "/path/to/disposable/workspace"
}
```

### The check order (load-bearing)

1. The registry entry MUST declare `mutating: true` (it does).
2. The mutation grant MUST be present (mutation control ON).
3. The request MUST carry the write credential, matching THIS
   instance's credential in constant time.
4. The asserted workspace MUST match the grant's workspace.
5. The workspace MUST still be the host's current workspace.
6. The payload MUST be present and well-formed (codec-validated).
7. There MUST NOT be an existing active task owner.
8. The ledger MUST NOT already hold this request id with a different
   payload.
9. **ONLY THEN** is the real `initTask()` lifecycle invoked.

### Response semantics

| Outcome | Meaning | Session id |
|---|---|---|
| `accepted` | task/session creation **acknowledged** by the authoritative lifecycle | **REQUIRED** — never returned without one |
| `rejected` | preconditions failed; **no execution started** | absent |
| `superseded` | another lifecycle operation took ownership | absent |
| `unknown_outcome` | transport/host failure prevents proving whether a start occurred | absent |

**An acknowledgement is NOT task completion.** `accepted` says nothing
about whether the task later completed, failed, or was cancelled.

### Idempotency

The client-supplied `requestId` is bound to a **bounded, instance-local,
IN-MEMORY** ledger (`ControlSeamOperationLedger`, 64 entries, oldest
evicted).

| Delivery | Result |
|---|---|
| Same key + same payload | the **SAME recorded outcome** (`R3-1`) |
| Same key + different payload | **REJECTED** (`R3-2`) |
| Duplicate delivered DURING an in-flight start | joins the in-flight operation; **no second task** (`R3-3`) |
| Repeated delivery after acceptance | **never starts another task** (`R3-1`, `R6-4`) |

The ledger stores a **SHA-256 payload fingerprint**, never the prompt
itself, so a ledger dump cannot leak task content.

**Explicit non-claim:** after a host restart the ledger is EMPTY. This
ACT does **not** pretend an in-memory ledger guarantees durable
exactly-once delivery. An ambiguous outcome is reconciled through the
EXISTING session state (`clinemm_get_run`) before retrying, and there is
**no automatic retry** that could create duplicate execution.

## C3 — `clinemm_read_events`

```json
{
  "sessionId": "actual-session-id",
  "afterCursor": "previous-cursor",
  "limit": 20
}
```

| Requirement | Implementation |
|---|---|
| Scoped to the task authorized for this mutation client | The requested session id MUST be the host's active session; a foreign id is refused without disclosing whether it exists (`R5-5`). |
| Reuse existing event identity and ordering | The buffer is fed from the **EXISTING** `SdkMessageCoordinator.onSessionEvent()` publication boundary. The cursor IS the existing `ClineMessage.seq`; the epoch IS the existing `ClineMessage.epoch`. |
| Bounded response and bounded retention | `limit` ≤ 100 (default 20); the ring holds ≤ 500 events; text ≤ 2 000 chars with an explicit truncation marker. |
| Preserve actual ordering; never invent events | Events are appended in production order. **No event is ever synthesized.** A gap is REPORTED, never filled in. |
| Report cursor expiry / gaps explicitly | `cursorExpired: true` when the requested cursor is older than the retained window (`R5-4`). |
| Do not expose other tasks' transcripts | Scoped to the owned session (`R5-5`). |
| Do not expose credentials, hidden reasoning, raw tool arguments, unrestricted file contents | The projection retains only identity fields. Only user-visible prose kinds carry text; tool invocations, tool results, API request bodies, file contents and reasoning payloads are NEVER exposed as text — their `kind` alone is exposed. |
| Content text under a separate explicit grant | `allowContentRead` gates the `text` field only (`R5-6`). |
| Fail closed rather than reconstructing | `PublishedTaskStateStore` is a latest-state projection, NOT event history — it is NOT used as the event source. |
| `clinemm_get_run` remains authoritative for the latest phase | Unchanged. |
| No new event-history database or generalized event bus | The buffer is an in-memory ring scoped to the extension-host instance, dropped on disposal. |

## C4 — Protocol and MCP exposure

| Operation | Type | Scope | MCP tool |
|---|---|---|---|
| `clinemm_capabilities` | READ (`mutating: false` literal) | — | always exposed |
| `clinemm_get_run` | READ (`mutating: false` literal) | — | always exposed |
| `clinemm_start_act` | WRITE (`mutating: true` literal) | `"mutation"` | exposed ONLY when a write credential was published |
| `clinemm_read_events` | WRITE (`mutating: true` literal) | `"mutation"` | exposed ONLY when a write credential was published |

The registry is a **discriminated union** over
`ControlSeamReadOperation` (`mutating: false`) and
`ControlSeamWriteOperation` (`mutating: true` + a declared
`writeScope`). No operation's `mutating` bit was weakened to an
unrestricted boolean.

**The read-only client view is byte-for-byte the RECON01 view.** A
client with no valid write credential sees EXACTLY two operations and
`readOnly: true` (`R6-6`, `PX01`). A mutation-authorized client sees
four and `readOnly: false` (`R6-7`, `PX01b`).

**MCP annotations are DISCOVERY hints, never authorization.**
`clinemm_start_act` declares `readOnlyHint: false`; the
extension-host server still performs the credential comparison itself,
per request, on an open connection.

**The transport architecture is retained:** stdio proxy → AF_UNIX →
extension host.
