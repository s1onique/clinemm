# C1 — The one bounded P1 correction

**ACT:** `ACT-CLINEMM-MCP-READONLY-LIVE-QUAL01`

The charter allows **one** correction cycle before the listener is enabled live.
Four defects in the RECON01 seam are closed in that single cycle. The
two-operation read-only registry is **PRESERVED** — this is not a transport
rewrite and not a generic framework.

---

## C1.0 The four defects (as found in `cc6aa0987`)

| # | Defect | Where | Consequence |
|---|---|---|---|
| D1 | The socket file was removed **unconditionally** on start; cleanup removed the socket and token **unconditionally**. | `control-seam-server.ts:161-167`, `:225-237` (entry) | A second instance silently **replaced** a live instance's socket and token. The first stayed alive but became unreachable, and the on-disk token matched no live bearer. Symmetrically, a foreign instance's `dispose()` **deleted** another instance's live artifacts. |
| D2 | The client pushed a resolver and never removed it unless a response arrived. | `control-seam-client.ts:102-107` (entry) | A socket close, a transport error, or a server that never answered left the promise **permanently unresolved** — the proxy's MCP tool call hung forever. |
| D3 | The server accumulated `buffer += chunk` with no bound; the client did the same on its response buffer. | `control-seam-server.ts:249-260`, `control-seam-client.ts:82-98` (entry) | A client that never sent a newline could make the extension host buffer **without limit**. |
| D4 | The opt-in record was probed with `existsSync()` only. | `control-seam-server.ts:125` (entry) | A stray empty file, a failed write, or a truncated heredoc **enabled** a local listener. |

---

## C1.1 D1 → EXPLICIT INSTANCE OWNERSHIP

**New module:** `apps/vscode/src/sdk/control-seam/control-seam-ownership.ts`
(320 lines).

### The on-disk owner record

```
<control-seam-dir>/owner.json   mode 0600
{
  "v": 1,
  "instanceId": "<pid>-<16 random bytes hex>",
  "pid": 12345,
  "startedAt": 1760000000000,
  "tokenFingerprint": "<sha256(token)[0:16]>"
}
```

- `instanceId` is unique per instance (pid + 16 random bytes), so two
  controllers in the same extension host still get distinct ids.
- `tokenFingerprint` is a **non-reversible** correlation aid: it lets an operator
  confirm the on-disk token belongs to the recorded owner without disclosing the
  token. It is not a credential and cannot be replayed.
- The record is written **atomically** (write-to-temp + `rename`), so a
  concurrent reader never sees a half-written file.

### The acquisition rule

```
acquireControlSeamOwnership():
  read the record (a malformed/unreadable record THROWS -> fail closed)
  if a record exists and its pid is ALIVE  -> THROW "live-owner"   (fail closed)
  if a record exists and its pid is DEAD   -> the endpoint is STALE; reclaim it
  if no record exists                      -> claim it
```

Liveness is decided by `process.kill(pid, 0)`:

| Probe result | Meaning | Verdict |
|---|---|---|
| no throw | the pid EXISTS | **LIVE** → refuse to take the endpoint |
| `ESRCH` | the pid is gone | DEAD → the endpoint may be reclaimed |
| `EPERM` | the pid exists, another user | **LIVE** → fail closed |

A pid-only probe cannot distinguish a recycled pid from the original owner.
That is acceptable: the endpoint is user-local (0700 directory) and the worst
case is a fail-closed "endpoint busy" that the operator can clear with the
explicit `CLINEMM_CONTROL_SEAM_FORCE=1` escape hatch.

### The release rule

```
releaseControlSeamOwnership({ ownerPath, instanceId }):
  if the on-disk record's instanceId !== ours -> return FALSE (do NOT touch)
  else -> remove the record, return TRUE
```

`ControlSeamServer.releaseOwnedArtifacts()` only removes the socket and the token
when the release returned `TRUE`. When it returns `FALSE`, the server logs
*"ownership was lost; leaving another instance's artifacts untouched"* and
removes **nothing**.

`ControlSeamServer.dispose()` additionally refuses to remove anything when the
instance never completed a successful start (`handle`/`ownerPath` unset) — that
path previously deleted another instance's live endpoint.

### Where ownership is taken

Ownership is acquired **BEFORE** the token is written and **BEFORE** the stale
socket file is removed. The stale-socket removal is now *gated by* the ownership
grant, so a live owner's socket is never unlinked.


---

## C1.2 D2 → EVERY OUTSTANDING REQUEST IS SETTLED

`ControlSeamClient` now settles every pending request on **five** paths:

| Path | Mechanism |
|---|---|
| response arrives | the resolver is shifted and invoked; its timer is disarmed |
| socket `close` | `settleAll(...)` with a non-informative error |
| socket `error` | `settleAll(...)` with a non-informative error |
| socket `end` (the peer's FIN) | `settleAll(...)` with a non-informative error |
| per-request timeout | `setTimeout` (default 10 000 ms, `unref()`'d) fires and resolves the request with a `timed out` error |

Plus:

- `request()` against an **already-dead** transport (`connected === false`)
  settles **immediately** rather than enqueuing against a dead socket.
- `dispose()` settles every outstanding request and is idempotent.
- The server's `dispose()` calls `socket.end()` **before** `socket.destroy()` on
  each accepted connection, so the peer observes a clean EOF and settles
  immediately instead of waiting for its timeout.

The proxy no longer wraps the request in a hand-rolled promise; it awaits the
client's request directly, so the tool call inherits the settling guarantee.

**The invariant:** no code path leaves a `ControlSeamClient.request()` promise
unresolved.

---

## C1.3 D3 → BOUNDED NDJSON

`CONTROL_SEAM_MAX_REQUEST_BYTES = 64 * 1024` (64 KiB) in
`control-seam-protocol.ts`.

- **Server:** the ACCUMULATED line — including an incomplete tail that has not
  been terminated — is measured **before** anything is parsed. When the bound is
  crossed the server writes `control_seam_payload_too_large`, closes the
  connection, and **discards the buffer**. The payload is never parsed, never
  authorized, and never buffered further.
- **Client:** the response buffer is bounded the same way; exceeding it settles
  the pending requests and destroys the socket.
- A legitimate request is far below the bound (the largest legitimate field is
  the 64-hex-char bearer token), so the bound is generous for the protocol and
  tight for memory.

A new error code was added to the registry:
`payloadTooLarge: "control_seam_payload_too_large"`.

---

## C1.4 D4 → VALIDATED OPT-IN RECORD

`parseControlSeamOptInRecord(rawContents)` in `control-seam-enablement.ts` is a
**pure** function. The server reads the file and passes the contents in.

The record is accepted only when it is a JSON **object** carrying the boolean
`enabled: true`. Every one of these is **rejected**:

| Input | Accepted? |
|---|---|
| `{"enabled": true}` | ✅ |
| `{\n  "enabled": true\n}\n` | ✅ |
| `""` / `"   "` (empty) | ❌ |
| `not json` | ❌ |
| `{}` | ❌ |
| `{"enabled": false}` | ❌ |
| `{"enabled": "true"}` (string) | ❌ |
| `{"enabled": 1}` (number) | ❌ |
| `[]` | ❌ |

---

## C1.5 The executed witnesses

**File:** `apps/vscode/src/sdk/control-seam/control-seam.qual01.test.ts`
(21 tests, 554 lines).

Every test drives the **REAL AF_UNIX transport** — a real
`ControlSeamServer` listener and a real `node:net` client socket. No mock
socket, no in-memory pair.

| # | Test | What it proves |
|---|---|---|
| QL01 | a SECOND instance CANNOT replace a live instance's socket or token | **Concurrent-instance negative control.** The second `start()` rejects with *"already owned by a live instance"*; the first's socket still exists, its token file keeps the SAME INODE (not rewritten), and the first still serves the correct session. |
| QL02 | cleanup does NOT remove another instance's live artifacts | A foreign instance's `dispose()` leaves the socket and the token in place, and the original owner still reads its session. |
| QL03 | the OWNER's dispose removes only its own artifacts | Socket, token and owner record are all gone afterwards. |
| QL04 | a STALE socket file (dead owner) IS reclaimed | **Stale-socket-file negative control.** A record with a dead pid + a leftover socket + a leftover token is taken over; the owner record is replaced. |
| QL05 | a LIVE owner record makes the acquisition fail closed | Direct ownership-module witness. |
| QL06 | the operator can explicitly break a stale lock with the FORCE escape hatch | `CLINEMM_CONTROL_SEAM_FORCE=1` is the ONLY way to override a live owner. |
| QL07 | an unreadable owner record fails closed (no silent takeover) | A corrupt record cannot be used to steal the endpoint. |
| QL08 | the owner record is 0600 and carries a non-reversible token fingerprint | Permissions + fingerprint-not-the-token. |
| QL09 | releasing ownership for a FOREIGN instance id is a no-op | The release gate. |
| QL10 | a DISCONNECTED client settles the outstanding request | **Disconnected-client negative control.** The socket is destroyed without a request; a subsequent request settles immediately instead of hanging. |
| QL11 | a request with NO server response settles on the client TIMEOUT | The timeout path. |
| QL12 | `dispose()` settles every outstanding request | The dispose path. |
| QL13 | a DISCONNECTED instance makes the outstanding request FAIL (not hang) | The server-disposes-mid-flight case. |
| QL14 | an OVERSIZED unauthenticated line is rejected and the connection is closed | **Oversized-unauthenticated-input negative control.** A 65 KiB line with NO token is rejected with `control_seam_payload_too_large`, discloses nothing, and the extension host remains healthy and serving on a NEW connection. |
| QL15 | an incomplete line that never terminates is BOUNDED | 128 KiB with NO newline → rejected at the bound. |
| QL16 | a LEGITIMATE request just under the bound is accepted | The bound does not reject legitimate traffic (it is refused for a FOREIGN session, i.e. it was parsed). |
| QL17 | a MALFORMED opt-in record does NOT enable the seam | The opt-in validation table. |
| QL18 | a WELL-FORMED opt-in record enables the seam | The accept case. |
| QL19 | a malformed opt-in FILE leaves the seam OFF (no listener, no socket, no token) | The end-to-end disabled path. |
| QL20 | a WELL-FORMED opt-in FILE enables the seam and creates the artifacts | The end-to-end enabled path. |
| QL21 | EXACTLY two READ-ONLY operations remain | **The registry is preserved.** |

### The full control-seam suite after the correction

```
$ bun x vitest run --config vitest.config.ts src/sdk/control-seam/
 ✓ src/sdk/control-seam/control-seam-proxy.test.ts                      (5 tests)
 ✓ src/sdk/control-seam/control-seam.recon01.test.ts                   (21 tests)
 ✓ src/sdk/control-seam/control-seam.qual01.test.ts                     (21 tests)
 ✓ src/sdk/control-seam/control-seam-authority.production-shape.test.ts  (3 tests)
 Test Files  4 passed (4)
      Tests  50 passed (50)
```

**No regression:** the 21 RECON01 witnesses still pass unchanged, and the
production-shape witness (which drives the REAL `SdkSessionLifecycle`) still
passes unchanged. The RECON01 suite's own `CS15` ("dispose() removes the socket
AND the bearer token") still holds — it is now gated by ownership rather than
by an unconditional delete.

---

## C1.6 Conservation — the exact diff surface

```
 apps/vscode/src/sdk/control-seam/control-seam-client.ts     | 156 +++++-
 apps/vscode/src/sdk/control-seam/control-seam-enablement.ts  |  53 ++
 apps/vscode/src/sdk/control-seam/control-seam-ownership.ts    | 320 ++++++++++++ (NEW)
 apps/vscode/src/sdk/control-seam/control-seam-protocol.ts    |  28 ++
 apps/vscode/src/sdk/control-seam/control-seam-proxy.ts       |  15 +-
 apps/vscode/src/sdk/control-seam/control-seam-server.ts      | 229 +++++++++++--
 apps/vscode/src/sdk/control-seam/control-seam.qual01.test.ts | 554 +++++++++++++ (NEW)
```

**Zero changes** in: `proto/`, `package.json`, `registry.ts`, the shared
barrels, `SdkController.ts`, the Elm arbiter, the BCB, C9/C10, the native
editor, the approval gate, or session ownership.

`control-seam-authority.ts` is **byte-unchanged** — the read surface the seam
consumes is exactly the RECON01 surface.

The only behavioural changes are the four corrections above. The seam remains
**default OFF**, **AF_UNIX only** (no TCP bind exists anywhere in the module),
**read-only** (the registry and the payload allow-list are unchanged), and
**fully cleaned up** by the production `Controller.dispose()` path.

---

## C1.7 Verdict

**PASS.** One correction cycle. Four defects closed. The two-operation
read-only registry preserved. 50/50 executed witnesses across the whole
control-seam suite, including all four required negative controls (concurrent
instances, stale socket files, disconnected clients, oversized unauthenticated
input) against the real AF_UNIX transport.

| `null` | ❌ |

A malformed record leaves the seam **OFF**: no listener, no socket file, no
token file, no owner record.
