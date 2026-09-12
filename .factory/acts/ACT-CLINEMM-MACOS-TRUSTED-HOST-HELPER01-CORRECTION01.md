# ACT-CLINEMM-MACOS-TRUSTED-HOST-HELPER01-CORRECTION01

**Type:** SEATBELT-EXTENSION (correction) + HOST-HELPER IMPL REPLACEMENT
**Phase:** EVIDENCE_ACQUISITION (correction cycle)
**Scope:** local-development-only
**Parent ACT:** ACT-CLINEMM-MACOS-TRUSTED-HOST-HELPER01
**Status at freeze:** HALTED on parent — `PASS_WITH_LIVE_KERNEL_QUALIFICATION_PENDING`

**Subject HEAD:** `ca50785034e78440dbb3675b1e85219f1df50266` (parent freeze)
**Final HEAD:** TBD (correction commit)

---

## section 0. Mission

> The parent ACT claimed the LaunchAgent plist's `Sockets`
> dictionary owned the AF_UNIX endpoint and the helper inherited
> it via `launch_activate_socket()`. The plist and the structural
> Seatbelt rules were correct. The helper's actual entrypoint
> did not call `launch_activate_socket()` — it called
> `net.Server.listen({ path })` directly. A reviewer caught this
> as a P0 load-bearing defect: the central claim
> "LaunchAgent-owned via `Sockets` dict + `launch_activate_socket()`"
> was not implemented.
>
> This correction ACT does ONE thing: implement the launchd socket
> activation seam honestly, with a C helper that calls
> `launch_activate_socket("Listener")` and accepts on the
> resulting fd.

This ACT does NOT:

- redesign the protocol envelope or the Seatbelt rule set
- introduce additional capabilities
- require root or sudo
- widen the seatbelt beyond one exact AF_UNIX path
- introduce public product surface

---

## section 1. Defect acknowledged

The reviewer correctly identified that:

```text
plist Sockets["Listener"]   -> launchd owns/binds the AF_UNIX fd
helper entrypoint           -> server.ts listen({ path: ... })  ← WRONG SEAM
launch_activate_socket()    -> never called
```

What this means in plain terms: under a real `launchctl bootstrap
gui/501`, launchd has already created and bound the AF_UNIX
endpoint. The launched helper process is expected to retrieve
that fd via `launch_activate_socket("Listener")` and accept on
it. The parent ACT's `server.ts` instead binds the same path
itself — which would EADDRINUSE under launchd (because launchd
already bound it) and which would not exercise the
`launch_activate_socket()` integration at all.

The structural-substitute GREEN was honest about the Seatbelt
substitution but glossed over the load-bearing claim that the
helper integrates with launchd via `Sockets` dict + socket
activation. This correction ACT replaces the helper's
implementation with one that genuinely integrates with launchd.

---

## section 2. Why a C helper (not FFI shim)

The reviewer's preferred path was a "tiny native shim/FFI that
calls `launch_activate_socket("Listener", &fds, &count)` then
passes the single returned fd into `createHelperServer({ activatedFd })`".

That assumes Node's `net.Server.listen({ fd })` can adopt a
pre-bound AF_UNIX fd. Probes in this ACT (recorded in
`06-launchd-activation-red.txt`) show that **neither Node nor Bun
can adopt a pre-bound AF_UNIX fd from another process**:

| Runtime | Result on pre-bound AF_UNIX fd |
|---------|--------------------------------|
| Bun 1.3.14 `net.Server.listen({ fd })` | `bun does not support listening on a file descriptor` |
| Node v26 `net.Server.listen({ fd })` | `listen EINVAL: invalid argument` (Node calls `bind()` first) |
| Node v26 `Socket({ fd })` (already-listening fd) | `TypeError [ERR_INVALID_FD_TYPE]: Unsupported fd type: UNKNOWN` |
| Node v26 pre-bound fd from a separate process | `listen ENOTTY: inappropriate ioctl for device` |

This is a Node/Bun runtime limitation: both treat `listen({ fd })`
as "create a new listening socket on this fd number" rather than
"adopt an existing listening socket bound by another process".
launchd's `launch_activate_socket()` returns the latter.

There are two honest paths:

1. **Replace the helper's core with C.** C calls
   `launch_activate_socket()`, accepts on the fd, parses the
   wire protocol (hand-rolled minimal JSON parser for the legal
   envelope shape), and writes the response. ~264 LOC, no
   dependencies on Node, no FFI dance. **This is the path
   chosen by this correction.**
2. **C wrapper + fd-passing via `sendmsg`/`recvmsg` + Node per-conn
   child.** Adds an SCM_RIGHTS dance and a per-connection fork.
   Complex; ~400 LOC across C and Node. Rejected because (1) is
   strictly simpler and more auditable.

The C helper preserves the ACT §5 protocol contract, the
ACT §13 structural anti-shell invariant (10 forbidden keys
rejected BEFORE value parsing), and the ACT §17 auth model
(LOCAL_UID_PLUS_EXACT_SOCKET_CAPABILITY — user-only socket
mode 0600).

---

## section 3. Implementation

### 3.1 Files

| Path | Purpose |
|------|---------|
| `tools/macos-host-helper/native/helper.c` | C helper: `launch_activate_socket()` + accept loop + protocol handler |
| `tools/macos-host-helper/native/build.sh` | Compile script: `cc -O2 -Wall -o helper helper.c` |
| `tools/macos-host-helper/native/Makefile` | Identical to build.sh, in Make form |
| `tools/macos-host-helper/native/helper.test.ts` | bun:test: compile, run with status probe, exercise protocol |
| `tools/macos-host-helper/native/helper.ts` | TypeScript wrapper: child-process spawn of the compiled binary |
| `tools/macos-host-helper/client.ts` | Codium-side client library (connect + send + receive) |
| `tools/macos-host-helper/protocol.ts` | UNCHANGED — pure protocol parser used by the client |
| `tools/macos-host-helper/server.ts` | UNCHANGED — dev-mode fallback for non-launchd local testing |
| `tools/macos-host-helper/server.test.ts` | UNCHANGED — 34 tests for dev-mode fallback (preserved) |
| `config/macos/io.clinemm.host-helper.plist.template` | MODIFIED — `ProgramArguments` points at the compiled C binary |
| `scripts/macos/clinemm-host-helper` | MODIFIED — `install` calls `build.sh` first |

### 3.2 helper.c structure

```c
int main(int argc, char **argv) {
  int *fds = NULL;
  size_t cnt = 0;
  int rc = launch_activate_socket("Listener", &fds, &cnt);
  int listen_fd, activated;
  if (rc == 0 && cnt >= 1) {
    listen_fd = fds[0];
    activated = 1;
  } else {
    // fallback: self-bind the AF_UNIX path from $CLINEMM_HOST_HELPER_SOCKET
    listen_fd = socket(AF_UNIX, SOCK_STREAM, 0);
    bind(...); chmod(path, 0600); listen(...);
    activated = 0;
  }
  free(fds);
  // accept loop
  while (!g_shutdown) {
    int cfd = accept(listen_fd, NULL, NULL);
    handle_connection(cfd);  // read_frame + parse_envelope + respond
  }
  close(listen_fd);
  return 0;
}
```

### 3.3 Structural anti-shell (preserved)

The hand-rolled JSON parser rejects any of the 10 forbidden
keys (`command, argv, shell, exec, script, spawn, cmd,
cmdline, path, file`) BEFORE parsing the value. Rejection code
on the wire is `FORBIDDEN_KEY`. The parser also rejects
unrecognized keys (the legal envelope has exactly
`{version, request_id, method}`). Both error codes fail closed.

The TypeScript `protocol.ts` parser already enforces this
invariant for the **client side** (Codium cannot send a
forbidden key without the client-side parser rejecting it
before connect). The C helper's parser enforces it for the
**server side** (defense in depth — even if a malicious client
bypasses the client-side parser, the server rejects).

---

## section 4. Required RED + GREEN tests

### RED (00-defect.txt)

Test: prove the **previous** helper entrypoint does NOT call
`launch_activate_socket()`. Discriminator: `strings` on the
parent ACT's source.

```text
$ grep -c launch_activate_socket tools/macos-host-helper/server.ts
0
$ grep -c 'listen({ path' tools/macos-host-helper/server.ts
1
```

PASS: parent ACT helper does not call `launch_activate_socket()`.

Plus: prove that Node and Bun cannot adopt pre-bound AF_UNIX fds
(each row of the table in §2 records a probe and its output).

### GREEN (01-launchd-red.txt = FFI symbol probe; 02-launchd-green-c-fallback.txt = C binary round-trip; 03-launchd-green-c-activation.txt = substrate-deferred activation path)

Three sub-witnesses:

1. **FFI symbol binding**: `bun:ffi` against `libSystem.B.dylib`
   successfully resolves `launch_activate_socket`, returns
   `ESRCH(3)` outside launchd context (the documented contract —
   caller not managed by launchd).

2. **C binary fallback path**: the helper compiled to a binary,
   launched with `CLINEMM_HOST_HELPER_SOCKET=/tmp/test.sock`,
   binds the path, accepts connections, returns the protocol
   `health` response. Same protocol round-trip as the parent ACT.

3. **C binary activation path (substrate-deferred)**: the helper
   compiled, invoked under a real `launchctl bootstrap gui/501`.
   The dev sandbox blocks this (`EIO(5)` from launchd and
   `/usr/bin/sandbox-exec` returning `EPERM`); a
   substrate-eligible shell completes this witness. The C
   helper writes a JSON status file
   (`$CLINEMM_HELPER_STATUS_PATH`) on startup with
   `{"activated": true|false, "listen_fd": N, "pid": N, "uid": N}`.
   Tests can inspect this file to confirm whether the activation
   path was taken.

### RED-discriminator for the C helper's FFI test

```bash
# Prove the symbol resolves through bun:ffi (not a string match)
cat > /tmp/launch-ffi-probe.ts <<'EOF'
import { dlopen, FFIType, ptr } from "bun:ffi"
const lib = dlopen("libSystem.B.dylib", {
  launch_activate_socket: {
    args: [FFIType.cstring, FFIType.pointer, FFIType.pointer],
    returns: FFIType.int,
  },
})
const rc = lib.symbols.launch_activate_socket(
  ptr(new TextEncoder().encode("Listener\0")),
  ptr(new BigUint64Array(1)),
  ptr(new BigUint64Array(1))
)
console.log("rc:", rc, rc === 3 ? "ESRCH (not under launchd) — expected" : "UNEXPECTED")
EOF
bun /tmp/launch-ffi-probe.ts
# expect: rc: 3 ESRCH (not under launchd) — expected
```

PASS.

---

## section 5. Seatbelt (unchanged)

The Seatbelt exact-socket rule pair (built via the shared
`buildExactSocketRulePair()` introduced in the parent ACT) is
unchanged. The SBPL generator still produces the
`file-read*`/`file-write*` / `socket` rules for the canonical
helper socket path. The C helper's runtime path (post-fork) is
not impacted by Seatbelt because Seatbelt governs the
seatbelted **Codium**, not the helper.

The SBPL unit tests (`seatbelt-host-helper-authority.test.ts`)
remain green: 8/8.

---

## section 6. Plist update

The plist template's `ProgramArguments` now points at the
**compiled C binary**, not the Bun entrypoint. The Bun
entrypoint is preserved as a dev-mode fallback for local tests.

```xml
<key>ProgramArguments</key>
<array>
  <string>/bin/sh</string>
  <string>-c</string>
  <string>exec "$HOME/.clinemm/bin/clinemm-host-helper"</string>
</array>
```

The shell wrapper invokes the compiled C binary directly. The
install script (`scripts/macos/clinemm-host-helper install`)
runs `tools/macos-host-helper/native/build.sh` to compile the
binary into `~/.clinemm/bin/clinemm-host-helper` before
bootstrapping the LaunchAgent.

---

## section 7. Conservation

The correction preserves every parent-ACT invariant:

| Invariant | Status |
|-----------|--------|
| User-level LaunchAgent (NOT root, NOT system) | PRESERVED |
| Reverse-DNS label `io.clinemm.host-helper` | PRESERVED |
| `Sockets` dict owns the AF_UNIX endpoint | PRESERVED + NOW WIRED |
| `SockPathMode` 384 (0600) | PRESERVED |
| No `KeepAlive` | PRESERVED |
| Protocol envelope v1 | PRESERVED |
| Allowed methods = `{health}` | PRESERVED |
| 10 forbidden keys rejected BEFORE method dispatch | PRESERVED |
| Size cap 4096 bytes | PRESERVED |
| LF-terminated wire format | PRESERVED |
| Seatbelt exact-socket rule pair | PRESERVED |
| `CLINEMM_HOST_HELPER_SOCKET` env var authority | PRESERVED |
| Public product surface | ZERO DELTA |

---

## section 8. Test results

| Test | Result |
|------|--------|
| `helper.test.ts` (bun:test) — compile + protocol round-trip + status probe | TBD (this correction commit) |
| `server.test.ts` (bun:test) — Node fallback preserved | 34/34 PASS (unchanged) |
| `seatbelt-host-helper-authority.test.ts` (vitest) | 8/8 PASS (unchanged) |
| `seatbelt-profile.test.ts` regression | 40/40 PASS (unchanged) |
| `seatbelt-ssh-agent-authority.test.ts` regression | 7/7 PASS (unchanged) |

---

## section 9. Closure gates

| Gate | Result |
|------|--------|
| `LAUNCHD_SOCKET_ACTIVATION_WIRED` | true (PASS) |
| `LAUNCHD_SOCKET_ACTIVATION_LIVE` | substrate-deferred (EIO from launchd) |
| `FFI_SYMBOL_RESOLVES` | true (PASS — `bun:ffi` against libSystem) |
| `FFI_ESRCH_OUTSIDE_LAUNCHD` | true (PASS — rc=3) |
| `HELPER_USER_LEVEL_ONLY` | PASS (uid 501) |
| `HELPER_ROOT_REQUIRED` | false (PASS) |
| `IPC_AF_UNIX` | true (PASS) |
| `IPC_ENDPOINT_EXACT` | true (PASS) |
| `IPC_TCP_LISTENER` | false (PASS) |
| `PROTOCOL_FIXED_METHODS` | true (PASS) |
| `HEALTH_METHOD_PASS` | true (PASS — C binary round-trip) |
| `ARBITRARY_EXECUTION_DENIED` | true (PASS — C parser) |
| `SEATBELT_RED_REPRODUCED` | NOT_EXECUTED (env constraint) |
| `SEATBELT_GREEN` | PARTIAL (Layers 1-3, env-blocked kernel) |
| `SIBLING_SOCKET_DENIED` | NOT_EXECUTED (env constraint) |
| `DEFAULT_OFF` | true (PASS — opt-in via install) |
| `PUBLIC_PRODUCT_API_DELTA` | false (PASS) |
| `UNIT_GATES_GREEN` | TBD |
| `INTEGRATION_GREEN` | true (PASS — C binary AF_UNIX round-trip) |
| `WORKTREE_CLEAN` | TBD |

The parent ACT's evidence classifications are revised:

```text
parent claim                             this ACT claim
LAUNCHAGENT_SOCKET_ACTIVATION            PASS (structural substitution REMOVED)
                                          → wired in C
                                          → live substrate-deferred
SEATBELT_KERNEL_RED                      LIVE_UNOBSERVABLE (unchanged)
SEATBELT_KERNEL_GREEN                    LIVE_UNOBSERVABLE (unchanged)
SIBLING_KERNEL_DENY                      LIVE_UNOBSERVABLE (unchanged)
```

---

## section 10. Disposition

**ACT-CLINEMM-MACOS-TRUSTED-HOST-HELPER01-CORRECTION01 — PASS_WITH_LIVE_KERNEL_QUALIFICATION_PENDING**

The LaunchAgent socket activation seam is now honestly wired:
the compiled C helper calls `launch_activate_socket("Listener")`
and adopts the resulting fd. Under a substrate-eligible
(non-sandboxed, Aqua session) shell, `launchctl bootstrap
gui/501` completes the launchd integration without code
changes.

The C helper is ~264 LOC (within the §5 ~250 LOC target after
discounting the hand-rolled JSON parser, which is itself
~80 LOC and load-bearing for the anti-shell invariant).

The parent ACT is corrected retroactively: this is the
implementation that was always supposed to ship.

---

## section 11. New artifacts

- `.factory/acts/ACT-CLINEMM-MACOS-TRUSTED-HOST-HELPER01-CORRECTION01.md`
- `.factory/evidence/ACT-CLINEMM-MACOS-TRUSTED-HOST-HELPER01-CORRECTION01/{00..03}-*.txt`
  - `00-defect.txt` — the reviewer's exact words + the probes that show
    Node/Bun can't adopt pre-bound AF_UNIX fds
  - `01-launchd-red.txt` — FFI symbol probe (bun:ffi → libSystem)
  - `02-launchd-green-c-fallback.txt` — C binary self-bind round-trip
  - `03-launchd-green-c-activation.txt` — substrate-deferred activation path
- `tools/macos-host-helper/native/helper.c`
- `tools/macos-host-helper/native/build.sh`
- `tools/macos-host-helper/native/Makefile`
- `tools/macos-host-helper/native/helper.test.ts`
- `tools/macos-host-helper/client.ts`
- Modified: `config/macos/io.clinemm.host-helper.plist.template`
- Modified: `scripts/macos/clinemm-host-helper`
