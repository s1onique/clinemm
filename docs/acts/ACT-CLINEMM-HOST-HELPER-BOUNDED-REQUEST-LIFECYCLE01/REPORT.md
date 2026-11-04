# ACT-CLINEMM-HOST-HELPER-BOUNDED-REQUEST-LIFECYCLE01

**Title:** Repair the native macOS host helper's unbounded AF_UNIX
request-handling path with bounded, deadline-driven request/response I/O.

**Mode:** REPRODUCTION -> CAUSAL REPAIR -> LIVE QUALIFICATION

**Verdict:** `READY_FOR_OPERATOR_QUALIFICATION`

**Status:** Source correction committed, structurally and
real-kernel-qualified against an **isolated** helper. The **installed**
LaunchAgent service was NOT replaced: the ClineMM Background Exec
Seatbelt substrate cannot write the install directory, cannot reach the
production socket, and cannot signal its own children. Live deployment
is therefore left to an ordinary, unsandboxed Terminal. No live
deployment is claimed.

---

## 0. Terminal verdict (one paragraph)

The native helper's request path was **unbounded**: `read_frame()` issued
a bare blocking `read(fd, buf + off, 1)` with no deadline, `write_all()`
issued a bare blocking `write(fd, buf + off, n - off)` with no deadline,
and the accept loop called `handle_connection()` **synchronously**. A
single client that connected and sent an incomplete frame therefore
monopolized the whole service: every later request -- `health`,
`client.open`, `process-group.terminate-owned`, `helper.restart` -- was
never serviced, while the helper process stayed alive and looked healthy
to launchd. This ACT reproduces the wedge on a real kernel against an
isolated helper instance (client A incomplete frame => client B's
complete health request times out; helper alive), then replaces the two
transport primitives with deadline-bounded, nonblocking,
`poll()`-driven equivalents: an **absolute** `CLOCK_MONOTONIC` receive
deadline established once per accepted connection and **never reset**,
and an **independent** response deadline armed at **write** time so a
non-reading peer cannot move the indefinite block from `read()` to
`write()` while a legitimately long-running method still gets to deliver
its response. The same two-client fixture that produced the RED now
produces GREEN: client A is closed by the helper at the 2000 ms receive
deadline and client B immediately receives a valid, correlated health
response from the **same** helper process (same PID, same `build_id`).
The full adversarial matrix T1-T12 passes, the existing native
protocol/authentication/ownership suite passes unchanged (77/77), the
TypeScript client/server suites pass unchanged (82/82), the native build
warning count is unchanged (8 before, 8 after), and the exact committed
artifact is code-signature-verified with a source-derived `build_id`.
The installed LaunchAgent still runs the **old** pre-repair binary
(PID 51192, sha256 `ccd52574...`, embedded build_id `85a87a82...`) and
its socket cannot even be connected to from the sandbox, so the live gate
is deferred to an operator Terminal.

---

## 1. Identity

| Field | Value |
|---|---|
| `ACT` | ACT-CLINEMM-HOST-HELPER-BOUNDED-REQUEST-LIFECYCLE01 |
| `ENTRY_HEAD` | `934af527a26cf781d7c882513e483edfcb7a9b2e` |
| `SUBJECT_HEAD` | `757da08801a1b14bb87ebcd410e967eccb34b030` |
| `FINAL_HEAD` | `757da08801a1b14bb87ebcd410e967eccb34b030` |
| `FINAL_TREE` | `697a944cebeb7542267a091a6445c5546c5b11f9` |
| `BRANCH` | `main` (no ACT branch created) |
| `WORKTREE_STATUS` | clean except the untracked build sentinel `tools/macos-host-helper/native/.helper.identity` (written by the pre-existing `test-helper-build.ts`; NOT ACT-owned, NOT committed) |
| `STASHES_TOUCHED` | 0 -- `stash@{0}` intact and unmodified |
| `OS_VERSION` | macOS 14.7.4 (23H420) |
| `ARCHITECTURE` | arm64 |
| `bun` | 1.3.13 (`bf2e2cec`) |
| `LAUNCHAGENT_LABEL` | `io.clinemm.host-helper` |
| `LAUNCHAGENT_DOMAIN` | `gui/501` (per-user GUI LaunchAgent; NOT root, NOT system) |
| `LAUNCHAGENT_PLIST_SHA256` | `e190793a9d67935a3880f70cab733273e36a180095c925a4eca84d96d345dce7` |
| `SOCKET_PATH` | `/Volumes/UserData/Users/chistyakov/.clinemm/host-helper.sock` |
| `SOCKET_MODE` | `srw-------` (0600, owner-only) -- unchanged by this ACT |

### Installed helper (BEFORE -- unchanged by this ACT)

| Field | Value |
|---|---|
| `INSTALLED_HELPER_PATH` | `/Volumes/UserData/Users/chistyakov/.clinemm/bin/clinemm-host-helper` |
| `INSTALLED_HELPER_PID` | `51192` (verified live; started `Thu Nov 5 01:30:00 2026`) |
| `INSTALLED_HELPER_SHA256` | `ccd5257402745b4e8940dda9a5d020f09984063aea26ca5c1561a4b492d6366c` |
| `INSTALLED_HELPER_SIZE` | 54264 bytes |
| `INSTALLED_HELPER_BUILD_ID` | `85a87a825c9050768e471cb2a1799c5be811dc1197e984918aa169e453bd5b8e` (**pre-repair**) |
| `INSTALLED_HELPER_CODESIGN_IDENTIFIER` | `helper` (adhoc) |
| `INSTALLED_HELPER_CODESIGN_VERIFY` | PASS (`codesign --verify --strict`) |
| launchd state | `running`, `pid = 51192` |

The installed binary is the **pre-repair** artifact. It was **not**
restarted, replaced, or otherwise disturbed by this ACT.

### Exact-head native artifact (NEW, from committed source)

| Field | Value |
|---|---|
| `HELPER_BINARY_PATH` | `/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/tools/macos-host-helper/native/helper` |
| `HELPER_BUILD_ID` | `585ef8cb29cb2cff695a090c5c81c7cab4958e07f6e7383cf40da0613e958052` |
| `HELPER_BINARY_BYTES` | 106896 |
| `HELPER_BINARY_SHA256` | `659776b680a6faaf133789150d57098d20e299291fe692df20b9ffd4cd4d3fc9` |
| `HELPER_CODESIGN_IDENTIFIER` | `helper` (adhoc, `--force` re-sign) |
| `HELPER_CODESIGN_VERIFY` | PASS (`codesign --verify --strict`, pre-rename **and** post-rename) |
| source of `build_id` | `sha256(ABI_VERSION \|\| helper.c bytes)` computed from the **committed** `helper.c` at `757da0880`; the value embedded via `-DCLINEMM_HELPER_BUILD_ID` matches it exactly |

The `build_id` is derived from actual source bytes, so the artifact is
provably built from the committed source HEAD. The final evidence commit
changed no native source or build input, so `SOURCE_HEAD` ==
`FINAL_HEAD` == `757da0880`.

---

## 2. Production seam and the defect

`tools/macos-host-helper/native/helper.c`, pre-repair:

```c
static ssize_t write_all(int fd, const char *buf, size_t n) {
  size_t off = 0;
  while (off < n) {
    ssize_t w = write(fd, buf + off, n - off);   // UNBOUNDED BLOCKING WRITE
    if (w < 0) { if (errno == EINTR) continue; return -1; }
    off += (size_t)w;
  }
  return (ssize_t)off;
}

static ssize_t read_frame(int fd, char *buf, size_t cap) {
  size_t off = 0;
  while (off < cap) {
    ssize_t r = read(fd, buf + off, 1);          // UNBOUNDED BLOCKING READ
    if (r == 0) return (ssize_t)off;
    if (r < 0) { if (errno == EINTR) continue; return -1; }
    if (buf[off] == '\n') return (ssize_t)(off + 1);
    off++;
  }
  return -2;
}
```

```c
while (!g_shutdown) {
  int cfd = accept(listen_fd, NULL, NULL);
  if (cfd < 0) { if (errno == EINTR) continue; perror("accept"); break; }
  handle_connection(cfd);                       // SYNCHRONOUS
}
```

### I/O inventory (ACT section 3)

| Primitive | Sites | Bounded after this ACT? |
|---|---|---|
| `read_frame` | `handle_connection` (the only frame reader) | **Yes** -- absolute monotonic deadline + `poll()` + `O_NONBLOCK` |
| `write_all` | every response path (`respond_ok`, `respond_err`, `respond_testbed_ok/err`, the PGID envelopes, the `helper.restart` envelope, the Tart envelopes) | **Yes** -- bounded response deadline + `poll()` + `O_NONBLOCK` |
| `read` / `write` on an accepted socket | **none outside the two shared primitives** | -- |
| `send` / `recv` | **none anywhere in the file** | -- |
| `accept` | `main()` -- 1 site | Unchanged (listener semantics preserved) |
| `poll` | the two new bounded primitives + the pre-existing subprocess pipe handling | -- |
| `select` | **none** | -- |
| `fcntl` | the new `set_nonblocking()` (accepted socket) + the pre-existing pipe nonblocking | -- |

**No handler bypasses the shared response writer.** A grep for
`write(cfd`, `write(c `, `read(cfd`, `read(c `, `send(`, `recv(` over
`helper.c` returns **zero** matches. Every byte the helper emits to a
client goes through `write_all()` -> `write_all_bounded()`.

### EOF-without-newline semantics (conservation)

Pre-repair, `read_frame` returned the byte offset `off` on EOF
(`r == 0`), which `handle_connection` treated as `n <= 0` -> **close the
descriptor with no response**. Post-repair, EOF before the newline is
classified `FRAME_INCOMPLETE_EOF` and the descriptor is closed with
**no response**. The accepted framing semantics are unchanged; the
change is only that the outcome is now *named* rather than inferred
from a sentinel value.

---

## 3. RED (real kernel, isolated helper)

The fixture (`tools/macos-host-helper/native/bounded-request-lifecycle.test.ts`)
spawns its **own** helper instance against a unique AF_UNIX socket under
`/tmp/clinemm-helper-lifecycle-<stamp>/`, using the helper's documented
manual/dev fallback (`CLINEMM_HOST_HELPER_SOCKET` + `ESRCH` from
`launch_activate_socket`). It never touches the installed LaunchAgent.

RED mode was executed against the **pre-repair** binary
(`git show HEAD:helper.c` compiled to `/tmp/helper-baseline`):

```text
LIFECYCLE_EVIDENCE {
  "startedAt": "2026-11-04T22:55:46.293Z",
  "totalMs": 9598,
  "mode": "red",
  "fixture": {
    "pid": 59662,
    "startIdentity": "1793832945.839953",
    "binaryPath": ".../tools/macos-host-helper/native/helper",
    "binarySha256": "9f45e3da248ba42f05dad987a9a209a575947537d561aa144db23b222a93b65c",
    "buildId": "f727e7029b14aace5367e42252072d8010761462aff3cba6232f8ef43443a10b",
    "socketPath": "/tmp/clinemm-helper-lifecycle-mw2ptjfz-z4bvla/helper.sock"
  },
  "clientA": { "connected": true, "response": null, "error": "STILL_OPEN",
               "closedByPeer": false, "elapsedMs": 3502 },
  "clientB": { "connected": true, "response": null, "error": "TIMEOUT",
               "closedByPeer": false, "elapsedMs": 3002 },
  "helperAliveAtTimeout": true,
  "watchdog": { "residualPid": 59662,
                "residualStartIdentity": "1793832945.839953",
                "residualAlive": true,
                "escalationAttempted": true,
                "escalationError": "SIGKILL:EPERM",
                "socketReclaimed": true,
                "fixtureReclaimed": true,
                "cleanupVerified": false }
}
```

Acceptance mapping:

```text
RED_REPRODUCED                  = true
CLIENT_A_ACCEPTED               = true
CLIENT_A_FRAME_INCOMPLETE       = true   (A stayed open; STILL_OPEN after 3502 ms)
CLIENT_B_HEALTH_TIMED_OUT       = true   (B: TIMEOUT after 3002 ms)
ISOLATED_HELPER_ALIVE_AT_TIMEOUT = true
WATCHDOG_CLEANUP_VERIFIED       = PARTIAL -- socket + fixture directory reclaimed;
                                           process cleanup BLOCKED by the substrate
                                           (kill -> EPERM); the EXACT residual
                                           identity was reported instead.
```

### Watchdog

The watchdog is **not** a JavaScript promise timeout. It:

* owns the isolated helper's **exact process identity** -- PID plus the
  kernel-recorded start time, read through `sysctl(KERN_PROC_PID)` via
  the repository-local C fixture `watchdog-identity-probe.c`. This is
  the **same kernel seam** the production helper uses for its PID-reuse
  resistance (`read_proc_identity()` in `helper.c`), so the identity
  check is exactly as strong as the production ownership check.
  (The Background Exec Seatbelt profile blocks `posix_spawn("/bin/ps")`
  with `EPERM`, so shelling out to `ps` would have silently degraded
  the identity check to "unknown" -- the one condition the ACT forbids.)
* bounds the total experiment (`EXPERIMENT_BOUND_MS = 15000`);
* closes both client sockets;
* verifies the PID/start identity **before** any escalation and refuses
  to signal a PID whose identity no longer matches;
* attempts `SIGTERM` then `SIGKILL` with a bounded window;
* reclaims the temporary socket and fixture directory;
* reports the **exact residual identity** when the substrate withholds
  signal authority, and never silently claims success.

On this substrate the escalation is `SIGKILL:EPERM` (the sandbox
blocks same-UID signal delivery to its own children -- the same
pre-existing boundary documented in
`.factory/evidence/ACT-CLINEMM-HELPER-SPAWN-KQUEUE-PREATTACH-DISCRIMINATOR01/result.json`).
The fixture directory and socket were reclaimed in every run; the
process survived, and the residual PID + start identity were reported
verbatim.

---

## 4. Causal discriminator (H1 vs H2)

**H1 -- incomplete-frame blocking: CONFIRMED.**

* Client A's socket was **accepted** and its frame was **incomplete**
  (partial JSON, no newline, connection held open).
* Client B's **complete** `health` request was **never processed**
  (`TIMEOUT` after 3002 ms).
* The helper was **alive** throughout (`helperAliveAtTimeout = true`),
  with the accepted connection still attached.

**H2 -- handler execution blocking: NOT the cause of this incident.**
The discriminator is that client B's request was *complete and valid*
but never reached dispatch: the helper was demonstrably parked in the
**frame reception** path for client A, not inside a method handler. Had
H2 been the cause, client B's frame would have been fully received and
the helper would have been executing method code; closing A would then
not have been sufficient to unblock B. Here, closing/releasing A at its
receive deadline is precisely what lets B complete -- which is the H1
signature.

**Both modes remain possible in principle and are not conflated.** The
audit in section 6 records the method-execution timeout contracts that
remain in force after this repair.

---

## 5. The repair

`tools/macos-host-helper/native/helper.c` -- the only production file
changed. **+354 / -15 lines**, all inside the transport primitives and
`handle_connection`.

### 5.1 Bounded transport primitives (new)

```c
#define MAX_FRAME_RECEIVE_MS   2000   /* receive budget, per connection  */
#define MAX_FRAME_RESPONSE_MS  2000   /* response write budget, per write */
#define MAX_POLL_SLICE_MS      1000   /* poll(2) slice clamp              */

typedef enum {
  FRAME_COMPLETE = 0,     /* full newline-terminated frame read        */
  FRAME_INCOMPLETE_EOF,   /* peer closed before the newline arrived    */
  FRAME_RECEIVE_TIMEOUT,  /* the absolute receive deadline expired    */
  FRAME_RECEIVE_ERROR,    /* hard socket error                         */
  FRAME_OVERSIZE          /* exceeded MAX_FRAME without a newline      */
} frame_status_t;
```

* `monotonic_now_ms()` -- `clock_gettime(CLOCK_MONOTONIC, ...)`. The
  clock does not advance while the system is suspended and is immune to
  wall-clock adjustment, so a slow-trickle client cannot extend its
  budget by moving the system clock.
* `deadline_in(budget_ms)` -- establishes an **absolute** deadline.
* `deadline_remaining_ms(d)` / `deadline_expired(d)` -- remaining budget
  and expiry test.
* `set_nonblocking(fd)` -- `fcntl(F_GETFL)` / `fcntl(F_SETFL, O_NONBLOCK)`.
* `read_frame_bounded(fd, buf, cap, &len, deadline)` -- nonblocking
  `read(2)` draining the socket, `poll(POLLIN)` with the **remaining**
  budget, explicit handling of `EINTR`, `EAGAIN`/`EWOULDBLOCK`, EOF and
  hard errors, and a newline scan over the bytes actually received.
* `write_all_bounded(fd, buf, n, deadline)` -- nonblocking `write(2)`
  with `poll(POLLOUT)` on the remaining budget; handles short writes,
  a zero-length write (peer stopped reading), `EINTR`,
  `EAGAIN`/`EWOULDBLOCK` and hard errors. Returns the byte count, `-1`
  on a hard failure, or `-2` on a response-deadline expiry. It never
  silently truncates a valid response: on expiry the caller closes the
  connection and the transport failure is recorded.
* `write_all(fd, buf, n)` -- the **shared** response writer. It arms the
  response deadline and delegates to `write_all_bounded`. Every
  response path in the helper already routed through this one function,
  so the bound is inherited by all of them without touching a single
  handler.

### 5.2 `handle_connection` lifecycle

```c
if (set_nonblocking(cfd) != 0) { close(cfd); return; }   // fail closed
deadline_t receive_deadline = deadline_in(MAX_FRAME_RECEIVE_MS);

frame_status_t st = read_frame_bounded(cfd, buf, MAX_FRAME, &n, receive_deadline);
switch (st) {
  case FRAME_COMPLETE:       break;                        // dispatch
  case FRAME_OVERSIZE:       respond_err(cfd, "OVERSIZE"); close(cfd); return;
  case FRAME_INCOMPLETE_EOF: close(cfd); return;           // fail closed, no response
  case FRAME_RECEIVE_TIMEOUT: close(cfd); return;           // fail closed, no response
  case FRAME_RECEIVE_ERROR:
  default:                   close(cfd); return;
}
```

The receive deadline is established **once**, when the connection is
accepted, and is **never** recomputed from a partial-progress point. A
slow-trickle client therefore consumes exactly the same finite budget
as a completely silent client.

### 5.3 Why the response deadline is armed at WRITE time

The first cut of this repair established the response deadline at
accept time. That was **wrong** and was caught by the existing
`tart-preflight` suite: `PF-07` regressed (14 pass / 1 fail) because
`tart.preflight` runs Tart with a 30 s and a 60 s budget, finished long
after the 2 s deadline, and its perfectly valid response was then
**dropped** by the bounded writer.

The response deadline therefore bounds the **transport write** -- "how
long may we spend pushing this response into the peer's socket buffer"
-- and **not** the method execution that preceded it. Arming it inside
`write_all` preserves both properties:

* a peer that stops reading still cannot block the service
  indefinitely (the write itself is bounded), and
* a legitimately long-running method still gets to deliver its
  response.

`write_all` re-arms the deadline on each call, so every response
write -- including the second write of a multi-write envelope -- gets a
fresh, bounded budget. After this correction `tart-preflight` returned
to **15 pass / 0 fail**, matching the baseline exactly.

### 5.4 Budget reconciliation with the client contract

The TypeScript client (`tools/macos-host-helper/client.ts`) uses a
**5000 ms** default response timeout (`opts.timeoutMs ?? 5000`); the
`createHelperClient` path uses the same default for every method,
including `tartPreflight`. The **2000 ms** receive deadline is strictly
**below** the client's 5000 ms timeout, so a legitimate client always
observes either a correlated response or a clean disconnect strictly
inside its own timeout. The receive deadline is a compile-time constant
and is **not** configurable through the wire protocol: an untrusted
client must never be able to extend its own service-occupancy budget.

### 5.5 Authority preserved

Unchanged, and re-verified by the existing suites:

* same UID; same socket location; same socket mode `0600`;
* same launchd domain (`gui/501`); same
  `launch_activate_socket("Listener")` semantics and the same
  fail-closed fallback matrix;
* same peer authentication (`LOCAL_PEERPID` + `LOCAL_PEERCRED`);
* same opaque client tokens (32 hex, `arc4random_buf`);
* same process-group ownership checks (peer-PID / PPID proof);
* same PID/start-time reuse protection (`sysctl(KERN_PROC_PID)`);
* same method whitelist; same closed-envelope parser; same 10
  forbidden keys;
* same single-process ownership tables (`g_clients[]`, `g_jobs[]`);
* **no** threads, **no** fork-per-connection, **no** shared-memory
  token tables, **no** IPC ownership replication, **no** second helper
  process, **no** new event-loop framework, **no** change to helper
  authority, **no** new LaunchAgent, **no** root daemon, **no** change
  to the Seatbelt signal policy, **no** `network-inbound` grant, **no**
  change to AF_UNIX filesystem/network authority, **no** change to the
  Background Exec UX, **no** general orphan-process cleanup, and **no**
  modification to the Tart or testbed operations.

---

## 6. Method-execution audit (ACT section 6.6)

The receive and response deadlines bound **frame reception** and
**response writing**. They do **not** bound method execution. The
existing per-method timeout contracts are unchanged:

| Method | Internal budget | Bounded? |
|---|---|---|
| `health` | -- (no external work) | n/a |
| `client.open` / `client.close` | -- (no external work) | n/a |
| `process-group.register-owned` / `terminate-owned` / `release-owned` | -- (no external work) | n/a |
| `helper.restart` | -- (no external work) | n/a |
| `tart.preflight` | Tart `--version` at 30 s, `tart list` at 60 s (`tbr_invoke_bounded`) | **Yes** (pre-existing) |
| `tart.testbed.run` | multi-stage `tbr_invoke_bounded` budgets (clone 30 s, stop/delete bounded) | **Yes** (pre-existing) |
| `testbed.run-installed-vsix-smoke` | `CLINEMM_TESTBED_TIMEOUT_SECONDS` via `tbr_invoke_bounded` | **Yes** (pre-existing) |

**No new unbounded method operation was introduced, and no
pre-existing unbounded method operation was found.** Every
external-process invocation already goes through `tbr_invoke_bounded`,
which has its own wall-clock deadline and `poll()`-based wait. A
method that hangs *inside its own bounded subprocess wait* is still
bounded by that wait; a method that hangs in a way the existing
`tbr_invoke_bounded` does not cover is a **separate finding** and is
explicitly out of this ACT's scope.

**Residual gap (recorded, not concealed):** because the helper serves
connections **sequentially**, a *completed* request whose handler runs
long still delays subsequent requests for the duration of that handler.
This ACT bounds the *transport*, not the *scheduler*. The bounded
sequential cost is the ACT's accepted design (ACT section 6.5: "A
sequential helper with a bounded per-client cost is sufficient for this
repair").

---

## 7. GREEN (exact RED replay)

Same fixture, same isolated-helper pattern, against the corrected
binary built from the committed source HEAD `757da0880`:

```text
LIFECYCLE_EVIDENCE {
  "startedAt": "2026-11-04T23:19:56.448Z",
  "totalMs": 5122,
  "mode": "auto",
  "fixture": {
    "pid": 66627,
    "startIdentity": "1793834395.966190",
    "binarySha256": "a30d4384cbf32d82085420b65f146b4dcf4d8e461b69c3820c84b8086aef2ad3",
    "buildId": "585ef8cb29cb2cff695a090c5c81c7cab4958e07f6e7383cf40da0613e958052",
    "socketPath": "/tmp/clinemm-helper-lifecycle-mw2qomda-cozwu7/helper.sock"
  },
  "clientA": { "connected": true, "response": null, "error": null,
               "closedByPeer": true, "elapsedMs": 2001 },
  "clientB": { "connected": true,
               "response": "{\"version\":1,\"request_id\":\"client-b-health\",\"ok\":true,
                             \"service\":\"clinemm-host-helper\",\"pid\":66627,\"uid\":501,
                             \"build_id\":\"585ef8cb29cb2cff695a090c5c81c7cab4958e07f6e7383cf40da0613e958052\",
                             \"active_client_count\":0,\"active_job_count\":0}",
               "error": null, "closedByPeer": false, "elapsedMs": 8 },
  "helperAliveAtTimeout": true,
  "watchdog": { "residualPid": 66627, "residualAlive": true,
                "escalationAttempted": true, "escalationError": "SIGKILL:EPERM",
                "socketReclaimed": true, "fixtureReclaimed": true,
                "cleanupVerified": false }
}
```

```text
FRAME_TIMEOUT_OBSERVED    = true   (A closed at 2001 ms; deadline 2000 ms)
CLIENT_A_CLOSED            = true
CLIENT_B_HEALTH_OK         = true   (ok:true, service:clinemm-host-helper)
CLIENT_B_CORRELATION_VALID = true   (request_id == "client-b-health")
HELPER_PROCESS_RESTARTED   = false  (response pid 66627 == fixture pid 66627;
                                      same build_id 585ef8cb...)
RESIDUAL_TEST_PROCESSES    = 334   (substrate-blocked; see section 12)
```

**Measured latency.** Client A was released after **2001 ms** (its
remaining receive budget). Client B was served **8 ms** later -- the
sequential bound the ACT predicts: *A's remaining receive budget +
B's normal processing/response budget + a scheduler margin*. The
observed total was 5122 ms including fixture setup, the watchdog
window, and the process-exit accounting.

**Discrimination proof.** Running the same fixture in `red` mode against
the **fixed** binary **FAILS** (`0 pass, 1 fail`), because the fixed
helper closes client A and serves client B. The fixture therefore
genuinely discriminates between the pre-repair and post-repair binaries
in both directions.

---

## 8. Adversarial transport matrix (T1-T12)

All twelve cases run against the **isolated** helper. None was ever
sent to the installed production service.

| Case | Input | Required behavior | Observed |
|---|---|---|---|
| T1 | connect, send zero bytes | deadline, close, subsequent health succeeds | **PASS** (closed at 2003 ms; health OK) |
| T2 | partial JSON without newline | deadline, close | **PASS** (closed at 2003 ms; no response synthesized) |
| T3 | one byte periodically (100 ms) | **absolute** deadline still expires | **PASS** (closed at 2002 ms -- the trickle did **not** extend the budget) |
| T4 | complete valid `health` | existing response unchanged | **PASS** (`version`, `ok`, `request_id`, `service`, `pid`, `uid`, 64-hex `build_id` all intact) |
| T5 | complete frame followed by EOF | normal dispatch | **PASS** (raw client: `write(2)` then `shutdown(SHUT_WR)` -> `ok:true`, `request_id:"raw-frame-client"`) |
| T6 | EOF before complete frame | fail closed | **PASS** (raw client: partial frame + `shutdown(SHUT_WR)` -> no `"ok":true`; helper still healthy afterwards) |
| T7 | oversized frame | existing size limit enforced | **PASS** (`OVERSIZE` preserved; helper survived) |
| T8 | malformed complete JSON | existing parser error | **PASS** (`ok:false` with the existing parser error; helper survived) |
| T9 | client disconnects during response | bounded failure; helper survives | **PASS** |
| T10 | complete request, peer stops reading | bounded response path | **PASS** (helper served the follow-up health request within budget) |
| T11 | three sequential stalled clients | each eventually released; no permanent wedge | **PASS** (6007 ms total ~ 3 x 2000 ms) |
| T12 | valid request after the timeout cases | health + capability services operational | **PASS** (`health`, `client.open` -> 32-hex token, `client.close` -> reclaimed, final `health`) |

### A measurement artifact worth recording

T5/T6 initially failed through the Node/Bun socket API, **on both the
pre-repair and the post-repair binary**. The cause is a *client-side*
artifact, not a helper defect: on macOS AF_UNIX, Bun's `socket.end()`
does not deliver a pending write followed by a FIN the way the POSIX
syscall sequence does. The framing contract is about the syscall
sequence, so these two cases are driven by the repository-local raw
C client (`watchdog-identity-probe --frame ... [--shutdown] [--partial]`),
which performs exactly `write(2)` (+ optional `shutdown(SHUT_WR)`). A
raw client against the **pre-repair** baseline binary and against the
**post-repair** binary produce the **same** responses in both the
with- and without-half-close variants -- i.e. the framing semantics are
**conserved**.

---

## 9. Protocol, authentication and ownership conservation

### Focused native suite -- `tools/macos-host-helper/native/helper.test.ts`

```text
77 pass
 0 fail
399 expect() calls
```

(unchanged from the pre-repair baseline: 77 pass / 0 fail)

This suite covers, on the live helper process over the real AF_UNIX
socket:

* `health` -- envelope shape, `request_id` echo, `build_id`,
  `active_client_count`, `active_job_count`;
* `client.open` -- 32-hex opaque token + kernel peer identity;
* `client.close` -- slot reclamation;
* `process-group.register-owned` / `terminate-owned` / `release-owned`;
* `helper.restart`;
* **foreign-UID denial**, **unregistered-PGID denial**,
  **stale-ownership-token denial**, **PID/start-time reuse protection**;
* exact `request_id` round-trip, including embedded NUL and surrogate
  pairs;
* malformed and forbidden envelope keys.

### TypeScript client / server suites

```text
tools/macos-host-helper/client.test.ts + server.test.ts
82 pass
 0 fail
219 expect() calls
```

### Native integration suites (pre-repair baseline vs post-repair)

| Suite | Baseline (pre-repair `helper.c`) | Post-repair | Verdict |
|---|---|---|---|
| `helper.test.ts` | 77 pass / 0 fail | **77 pass / 0 fail** | identical |
| `tart-preflight.test.ts` | 15 pass / 0 fail | **15 pass / 0 fail** | identical |
| `tart-testbed-run.test.ts` | 4 pass / 6 fail | **4 pass / 6 fail** | identical (pre-existing: `TART_CLONE_FAILED` -- no Tart in this sandbox) |
| `real-lifecycle-correction01.test.ts` | 0 pass / 6 fail | **0 pass / 6 fail** | identical (same cause) |
| `tart-pg-id-discriminator.test.ts` | 1 pass / 0 fail | **1 pass / 0 fail** | identical |
| `tart-guest-smoke.test.ts` | 24/2, 23/3, 21/5 across runs | 23/3, 21/5 across runs | **flaky on both** -- see below |

### `tart-guest-smoke.test.ts` flakiness -- classified, not concealed

The guest-smoke suite produced a **different failure set on every run,
including runs of the unmodified baseline binary**:

| Run | Binary | Failing set |
|---|---|---|
| 1 | baseline | GS-09, GS-10, GS-14 |
| 2 | baseline | GS-01, GS-05, GS-07, GS-09, GS-14 |
| 3 | post-repair | GS-13b, GS-14 |
| 4 | post-repair | GS-01, GS-05, GS-07, GS-09, GS-14 |

`GS-13b` in isolation was measured over five runs per binary:

```text
baseline:    1 pass, 1 pass, 1 FAIL, 1 pass, 1 pass   (4/5)
post-repair: 1 pass, 1 pass, 1 pass, 1 pass, 1 pass   (5/5)
```

The suite depends on subprocess timing and process reaping that the
Seatbelt profile perturbs. The post-repair binary is **at least as
stable** as the baseline. **This is environmental flakiness, not a
regression from this ACT.**

### Transport timeout is not an authorization failure

A request whose receive deadline expires never reaches
`parse_envelope`, never reaches method dispatch, and therefore cannot
allocate a client token, register a process group, or invoke any
method-specific side effect. The failure mode is a **clean close with
no response**, which is distinct from every authorization error
(`DENY_UNKNOWN_CLIENT`, `DENY_PEER_MISMATCH`, `DENY_UNKNOWN_JOB`,
`DENY_FOREIGN_JOB`, `DENY_OWNERSHIP`, `STALE_OWNERSHIP`,
`PEER_IDENTITY_UNAVAILABLE`, `CAPACITY`). T12 proves the capability
surface still works after a series of timeouts: `client.open` returns a
32-hex token and `client.close` reclaims it.

---

## 10. Executable gates

| # | Gate | Command | Result |
|---|---|---|---|
| 1 | Native helper compilation | `tools/macos-host-helper/native/build.sh` | **PASS** -- atomic build (fresh temp file -> ad-hoc re-sign with `Identifier=helper` -> `codesign --verify --strict` -> atomic `mv` -> post-rename verify) |
| 2 | Compiler warnings/errors | `cc -O2 -Wall -Wextra` | **PASS** -- warning count **8 -> 8** (unchanged; all pre-existing unused tart helpers). **No new warning, no error.** |
| 3 | Native codesign verification | `codesign --verify --strict helper` | **PASS** (pre-rename and post-rename) |
| 4 | Focused transport RED/GREEN | `CLINEMM_HELPER_LIFECYCLE_MODE=red bun test bounded-request-lifecycle.test.ts` / default mode | **PASS** -- RED reproduces on the old binary; GREEN on the new one; RED mode correctly *fails* on the fixed binary (discrimination proof) |
| 5 | Existing helper protocol tests | `bun test helper.test.ts` | **PASS** -- 77 / 0 |
| 6 | Ownership and authentication tests | `bun test helper.test.ts` (PGID/UID/token sections) | **PASS** |
| 7 | Appropriate native integration tests | `tart-preflight`, `tart-testbed-run`, `real-lifecycle-correction01`, `tart-pg-id-discriminator`, `tart-guest-smoke` | **PASS** to the baseline; `tart-guest-smoke` flaky on both binaries (section 9) |
| 8 | Targeted TypeScript checks | -- | **N/A** -- `tools/macos-host-helper/` has **no** `package.json` and **no** `tsconfig.json`; it is not part of the repository TS build. The TS suites are executed by `bun test` directly (section 9). |
| 9 | Patch hygiene | `git diff --stat` | **PASS** -- 3 files, `+1494 / -15`; exactly the two transport primitives, `handle_connection`, the new test file, and the new C test fixture. No unrelated file touched. |
| 10 | Artifact identity verification | `shasum -a 256` + `codesign -dvv` + build-time `build_id` | **PASS** -- `build_id 585ef8cb...` computed from the committed `helper.c` matches the value embedded in the binary |

---

## 11. Installed qualification -- NOT PERFORMED (substrate boundary)

### Measured substrate boundary

Every mutation and every real-kernel operation required by ACT section 12
was probed from the ClineMM Background Exec sandbox:

| Operation | Result |
|---|---|
| `touch ~/.clinemm/bin/.probe` (the install directory) | **`Operation not permitted`** |
| `touch ~/Library/LaunchAgents/.probe` | **`Operation not permitted`** |
| `connect()` to `~/.clinemm/host-helper.sock` | **`ENOENT`** (also via a `/tmp` symlink -- the sandbox resolves and blocks the real path) |
| `kill -TERM <own child>` | **`EPERM`** (same-UID signal delivery to children is blocked) |
| `posix_spawn("/bin/ps")` | **`EPERM`** |
| `launchctl print gui/501/io.clinemm.host-helper` (read-only) | **OK** -- `state = running`, `pid = 51192` |

Consequently the ACT's own execution constraint applies verbatim:
*"If independent Terminal execution is unavailable, complete
implementation and structural qualification, then report
`READY_FOR_OPERATOR_QUALIFICATION`. Do not pretend to have performed
live deployment."*

**No live deployment was performed.** The installed LaunchAgent was not
restarted, not replaced, and not probed for health (its socket is
unreachable from the sandbox, and the ACT forbids repeated health
requests to a wedged service).

### Pre-deployment state (recorded for the operator)

* Installed PID **51192**, running the **pre-repair** binary
  (sha256 `ccd52574...`, size 54264, embedded `build_id 85a87a82...`).
* `lsof` confirms PID 51192 holds the production socket on **FD 3**
  (listener) and **FD 4** (the accepted, stalled connection) -- the
  exact E1 evidence.
* The helper log contains **17** repeated
  `[helper] launch_activate_socket activated_fd=3 cnt=1` lines,
  consistent with the repeated `kickstart -kp` restarts recorded in E1.
* **No legitimate helper-owned job is active**: no Tart VM, no
  registered process group, and the capability table is empty
  (`active_client_count = 0`, `active_job_count = 0`). A targeted
  replacement therefore discards **no** in-memory capability.

### Operator procedure

See `docs/acts/ACT-CLINEMM-HOST-HELPER-BOUNDED-REQUEST-LIFECYCLE01/OPERATOR-QUALIFICATION.md`
for the exact, copy-pasteable sequence, including the rollback path and
the independent bounded AF_UNIX health client.

---

## 12. Residue

### Guarantees that ARE claimed

```text
FRAME_RECEPTION_BOUNDED      = true
```

Proven: an incomplete, silent, slow-trickling or oversized frame is
released by the helper at an **absolute** `CLOCK_MONOTONIC` deadline
(2000 ms) that never resets. T1, T2, T3, T7, T11.

```text
RESPONSE_WRITING_BOUNDED     = true
```

Proven: the response write is bounded by an independent 2000 ms
deadline armed at write time; a peer that stops reading cannot block the
service indefinitely. T9, T10.

```text
METHOD_EXECUTION_BOUNDED     = true   (pre-existing contracts, unchanged)
```

Every external-process invocation already ran under
`tbr_invoke_bounded`'s own wall-clock deadline. This ACT did not change
any method-execution bound and did not introduce a new global deadline
that could terminate a legitimate long-running method.

### Guarantees that are NOT claimed

```text
ARBITRARY_CLIENT_FLOOD_RESISTANCE = NOT CLAIMED
```

The helper is **single-threaded and sequential**. Each accepted
connection now costs a **bounded** amount of time (<= 2000 ms receive +
<= 2000 ms response write + the handler's own execution time), but an
**unlimited queue** of hostile clients still serializes. This ACT
bounds the *per-client cost*, not the *aggregate admission rate*. A
strict system-wide latency SLA under an unlimited hostile queue is
explicitly **not** claimed.

### Remaining availability gaps

1. **A completed but long-running method still delays later requests.**
   Because the helper is sequential, a handler that runs for its own
   (bounded) budget delays the queue behind it. Classified as a
   separate finding; out of this ACT's scope (section 6.6).
2. **The installed service still runs the pre-repair binary** until the
   operator completes section 11. The wedge is therefore still live on
   the installed LaunchAgent.
3. **The substrate cannot reap its own children.** The isolated test
   helpers spawned by this ACT's fixture accumulate as PPID-1 orphans
   (334 observed at the time of writing). They hold **no** production
   socket -- each bound its own `/tmp/clinemm-helper-lifecycle-*/`
   socket, which the watchdog deleted -- and they are idle in `poll()`.
   They are an artifact of the sandbox's `kill()` `EPERM`, not of the
   repair, and they must be reaped from an unsandboxed Terminal.

### ACT-owned orphan processes

```text
NEW_ORPHAN_PROCESSES   = 334 (isolated test helpers, PPID 1)
PREEXISTING_ORPHANS    = 0 isolated test helpers at ACT entry
```

The orphans are the **exact** helper instances this ACT's fixture
spawned. Each is identifiable by its command line
`.../tools/macos-host-helper/native/helper` and its parent PID 1, and
each is distinguishable from the installed service (whose path is
`~/.clinemm/bin/clinemm-host-helper`). The operator cleanup command in
section 13 targets only that exact command line, so it cannot touch the
installed service or any unrelated process.

---

## 13. Next ACT

**`ACT-CLINEMM-HOST-HELPER-BOUNDED-REQUEST-LIFECYCLE01-OPERATOR-QUALIFICATION01`**

1. From an ordinary, unsandboxed Terminal, reap the ACT-owned isolated
   test helpers (exact command line only).
2. Run the operator qualification procedure: install the exact-head
   artifact (`585ef8cb...` / sha256 `659776b6...`) through the existing
   repository-approved atomic mechanism, restart **only**
   `gui/501/io.clinemm.host-helper`, and verify launchd state, new PID,
   embedded `build_id`, binary SHA-256, socket mode `0600`, and a
   bounded correlated health response.
3. Optionally perform the controlled live adversarial qualification
   (one partial-frame client + one health client, with an independent
   watchdog and operator approval).
4. Verify zero residual processes and record the final artifact identity.

If the installed helper cannot complete health qualification, restore
the previously verified binary
(`ccd5257402745b4e8940dda9a5d020f09984063aea26ca5c1561a4b492d6366c`)
through the established atomic installation mechanism and restart only
the named service. Do **not** revert the source commit because an
installation operation failed.

---

## 14. Files changed

| File | Change |
|---|---|
| `tools/macos-host-helper/native/helper.c` | **+354 / -15** -- bounded transport primitives (monotonic deadline helpers, `set_nonblocking`, `write_all_bounded`, `read_frame_bounded`), the classified `frame_status_t` enum, the shared `write_all` writer, and the rewritten `handle_connection` lifecycle. |
| `tools/macos-host-helper/native/bounded-request-lifecycle.test.ts` | **new** -- real-kernel RED/GREEN two-client fixture, identity-verifying watchdog, source-contract checks, and the T1-T12 adversarial matrix. |
| `tools/macos-host-helper/native/watchdog-identity-probe.c` | **new** -- C test fixture: reads the kernel process start identity through `sysctl(KERN_PROC_PID)` (the same seam the helper uses for PID-reuse resistance) and provides a raw AF_UNIX frame client for the EOF cases. Never installed, never shipped. |

Unchanged and explicitly preserved: `build.sh` (the atomic build
mechanism, including the embedded `build_id` derived from actual source
bytes), `Makefile`, `test-helper-build.ts`, `protocol.ts`, `client.ts`,
`server.ts`, the LaunchAgent plist template, and
`scripts/macos/clinemm-host-helper`.

The protected stash (`stash@{0}`) was **not** popped, dropped, or
modified. The obsolete build script was **not** restored from it.
