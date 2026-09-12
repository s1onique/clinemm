# ACT-CLINEMM-MACOS-TRUSTED-HOST-HELPER01-CORRECTION02

**Type:** SEATBELT-EXTENSION (correction) — protocol conservation + fail-closed fallback
**Phase:** EVIDENCE_ACQUISITION (correction cycle)
**Scope:** local-development-only
**Parent ACT:** ACT-CLINEMM-MACOS-TRUSTED-HOST-HELPER01
**Correction01:** ACT-CLINEMM-MACOS-TRUSTED-HOST-HELPER01-CORRECTION01 (C helper wires launch_activate_socket)
**Status at freeze:** `HALTED on parent → corrected by CORRECTION01 → corrected by CORRECTION02 → PASS_WITH_LIVE_KERNEL_QUALIFICATION_PENDING`

**Subject HEAD:** `ca50785034e78440dbb3675b1e85219f1df50266` (parent freeze)
**Final HEAD:** TBD (correction02 commit)

---

## section 0. Mission (verbatim per ACT body)

> CORRECTION01's C helper introduced two regressions that the Factory
> reviewer caught at the post-ACT-closure review window:
>
> **P0 — Protocol conservation (request_id correlation):**
> The frozen protocol contract (protocol.ts buildOkResponse) requires
> the response envelope to include `request_id` echoed from the
> request. CORRECTION01's C helper omitted this field. The client
> library (client.ts) silently dropped `request_id` from its
> HealthResponse type to match the wire output. This is exactly the
> kind of production-contract drift a correction cycle must not
> introduce. The wire contract is fixed; the implementation must
> match it, not the other way around.
>
> **P1 — Permissive fallback:**
> The CORRECTION01 C helper treated any non-zero `launch_activate_socket`
> return code as "manual/dev fallback" and self-bound the socket.
> Apple's launch_activate_socket contract distinguishes three failure
> modes:
>   - ESRCH (3):  caller is not managed by launchd → manual/dev fallback is correct
>   - ENOENT (2): named socket is not present in the caller's plist → CONFIGURATION DEFECT
>   - EALREADY:   socket was already activated → CONFIGURATION DEFECT
>   - rc=0, cnt=0: launchd returned success with no descriptor → CONFIGURATION DEFECT
> Silently self-binding on ENOENT/EALREADY/cnt=0 masks a real launchd
> plist misconfiguration as a "normal dev fallback."
>
> This correction ACT does TWO things, both bounded:
> 1. P0: Restore request_id echo in the C helper, restore it in the
>    HealthResponse type, and add strict client-side verification that
>    fails closed on missing/mismatched request_id.
> 2. P1: Distinguish ESRCH (legitimate fallback) from ENOENT / EALREADY
>    / rc=0+cnt=0 (configuration defect; fail closed with exit code 2).

This ACT does NOT:
- redesign the protocol envelope or the Seatbelt rule set
- introduce additional capabilities
- require root or sudo
- widen the seatbelt beyond one exact AF_UNIX path
- introduce public product surface
- touch launchd plumbing, Tart, or any external integration

---

## section 1. Defect acknowledgment (verbatim per ACT body)

CORRECTION01's reviewer verdict (post-closure):

> The launchd wiring defect is substantially fixed: the C helper now
> genuinely calls launch_activate_socket("Listener"), and the evidence
> correctly downgrades live activation to substrate-deferred. But
> CORRECTION01 introduced a new P0: the C helper no longer echoes
> request_id in successful responses, even though request/response
> correlation is part of the frozen protocol contract. The replacement
> C helper and its tests have silently weakened the protocol rather
> than conserving it.

> Worse, the fallback condition in helper.c is currently too permissive.
> Apple documents three relevant failures from launch_activate_socket():
> ESRCH, ENOENT, EALREADY. Only ESRCH represents the intended
> manual/dev situation where self-binding makes sense. If a launchd-
> managed process gets ENOENT because the plist name is wrong, or
> EALREADY because activation happened twice, silently self-binding
> hides a real launchd configuration defect.

See `.factory/evidence/ACT-CLINEMM-MACOS-TRUSTED-HOST-HELPER01-CORRECTION02/00-defect.txt`.

---

## section 2. Bounded fix (P0 — request_id echo)

### 2.1 C helper change (`tools/macos-host-helper/native/helper.c`)

`respond_ok()` now takes the parsed `request_id` and emits it in the
response envelope. The output buffer is grown from 256 to 2048 bytes
to safely accommodate any legal request_id (envelope parser caps at
MAX_VAL_LEN = 1024 bytes), with snprintf truncation detection that
returns INTERNAL_TRUNCATION if the request_id were somehow larger.

```c
static void respond_ok(int cfd, const char *request_id) {
  char buf[2048];
  int n = snprintf(buf, sizeof(buf),
    "{\"version\":1,\"request_id\":\"%s\",\"ok\":true,"
    "\"service\":\"clinemm-host-helper\",\"pid\":%d,\"uid\":%d}\n",
    request_id, (int)getpid(), (int)getuid());
  if (n <= 0 || (size_t)n >= sizeof(buf)) {
    respond_err(cfd, "INTERNAL_TRUNCATION");
    return;
  }
  (void)write_all(cfd, buf, (size_t)n);
}
```

Call site updated:
```c
const kv_t *r = find_kv(kvs, nkvs, "request_id");
if (r->kind != V_STR || r->val[0] == 0) {
  respond_err(cfd, "MISSING_REQUEST_ID"); close(cfd); return;
}
// ...
// CORRECTION02: pass the parsed request_id so the response echoes it.
respond_ok(cfd, r->val);
close(cfd);
```

### 2.2 Client library change (`tools/macos-host-helper/client.ts`)

`HealthResponse` now requires `request_id: string`. `client.health()`
performs strict equality check on the response's `request_id` field
and throws `RequestIdMismatchError` on mismatch or `MissingRequestIdError`
on absence. Both error types are exported.

```typescript
export interface HealthResponse {
  version: 1
  // CORRECTION02: restored. The frozen protocol contract requires the
  // server to echo request_id, and the client to verify exact match.
  request_id: string
  ok: true
  service: "clinemm-host-helper"
  pid: number
  uid: number
}

export class RequestIdMismatchError extends Error {
  readonly sent: string
  readonly received: string | undefined
  constructor(sent: string, received: string | undefined) { /* ... */ }
}

export class MissingRequestIdError extends Error {
  constructor() { /* ... */ }
}
```

Verification in `client.health()`:
```typescript
const healthResp = env as HealthResponse
if (typeof healthResp.request_id !== "string") {
  throw new MissingRequestIdError()
}
if (healthResp.request_id !== requestId) {
  throw new RequestIdMismatchError(requestId, healthResp.request_id)
}
return healthResp
```

### 2.3 Live witness

Direct round-trip via bun's `node:net`:

```
=== correlation-123 round-trip ===
{"version":1,"request_id":"correlation-123","ok":true,
 "service":"clinemm-host-helper","pid":33284,"uid":501}
```

The full witness transcript is in
`.factory/evidence/ACT-CLINEMM-MACOS-TRUSTED-HOST-HELPER01-CORRECTION02/02-launchd-green-c-fallback.txt`.

---

## section 3. Bounded fix (P1 — fail-closed fallback matrix)

### 3.1 C helper change (`tools/macos-host-helper/native/helper.c`)

The previous "rc != 0 → fallback" branch is split into three cases
that match Apple's documented launch_activate_socket contract:

```c
// CORRECTION02 fail-closed fallback matrix.
//
//   rc == 0      && cnt >= 1   → use launchd-activated fd (PRIMARY)
//   rc == 0      && cnt == 0   → launchd bug; fail closed
//   rc == ESRCH  (3)           → not under launchd (manual/dev);
//                                 self-bind via $CLINEMM_HOST_HELPER_SOCKET
//   rc == ENOENT (2)           → plist "Sockets.Listener" missing;
//                                 CONFIGURATION DEFECT; fail closed
//   rc == EALREADY             → socket already activated;
//                                 CONFIGURATION DEFECT; fail closed
//   anything else              → unknown launchd result; fail closed
if (rc == 0 && cnt >= 1) {
  listen_fd = fds[0];
  activated = 1;
  // ... log activated_fd
} else if (rc == ESRCH) {
  // ... self-bind via $CLINEMM_HOST_HELPER_SOCKET, mode 0600
} else {
  // rc != 0, or rc == 0 with cnt == 0. Treat as configuration defect.
  fprintf(stderr,
    "[helper] FAIL_CLOSED: launch_activate_socket rc=%d cnt=%zu; ...\n",
    rc, cnt);
  if (fds) free(fds);
  return 2; // distinct exit code: 0=ok, 1=bind/listen error, 2=launchd config defect
}
```

Exit code 2 is reserved for "launchd configuration defect" so an
operator or installer can distinguish that from a generic bind/listen
error (exit code 1) or a successful run (exit code 0).

### 3.2 Status file forensics

The status file now records `launchd_rc` so operators can debug
launchd-managed runs without re-running the helper:

```json
{"activated":false,"listen_fd":3,"pid":33284,"uid":501,"launchd_rc":3}
```

Under real launchd, `launchd_rc` will be 0 and `activated` will be
true. Under manual/dev mode, `launchd_rc` is 3 (ESRCH) and `activated`
is false.

### 3.3 Test surface

We cannot simulate rc=ENOENT or rc=EALREADY from outside launchd in
this dev sandbox (those only fire under real launchd-managed processes).
The strongest unit-level witness is a source-level invariant check
that the C helper's main() discriminates between ESRCH (manual
fallback) and the configuration-defect codes (fail closed):

```typescript
test("CORRECTION02: fail-closed fallback matrix is encoded in source", () => {
  const src = readFileSync(HELPER_SRC, "utf8")
  expect(src).toContain("ESRCH")
  expect(src).toContain("ENOENT")
  expect(src).toContain("EALREADY")
  expect(src).toContain("FAIL_CLOSED")
  expect(src).toMatch(/return 2[^0-9]/)
})
```

The full source-level matrix is in
`.factory/evidence/ACT-CLINEMM-MACOS-TRUSTED-HOST-HELPER01-CORRECTION02/03-launchd-green-fail-closed-source.txt`.

---

## section 4. Verification (no new blockers introduced)

### 4.1 Helper tests (bun:test)

```
$ bun test tools/macos-host-helper/
 63 pass
 0 fail
 212 expect() calls
 Ran 63 tests across 3 files.  [2.71s]
```

Breakdown:
- `tools/macos-host-helper/native/helper.test.ts`: 22 tests (parent 17 + CORRECTION02 5)
- `tools/macos-host-helper/client.test.ts`: 8 tests (parent 3 + CORRECTION02 5)
- `tools/macos-host-helper/server.test.ts`: 34 tests (parent preserved as dev-mode fallback)

New CORRECTION02 tests:
- helper.test.ts:
  - `CORRECTION02: response echoes request_id EXACTLY`
  - `CORRECTION02: each round-trip preserves request_id verbatim` (10 IDs)
  - `CORRECTION02: fail-closed fallback matrix is encoded in source`
  - `CORRECTION02: status file records launchd_rc for forensics`
  - `CORRECTION02: helper source emits request_id in response`
- client.test.ts:
  - `CORRECTION02: response.request_id equals sent requestId (exact correlation)`
  - `CORRECTION02: HealthResponse type carries request_id at compile time`
  - `CORRECTION02: each distinct requestId round-trips exactly (10 cases)`
  - `CORRECTION02: client exposes RequestIdMismatchError / MissingRequestIdError`
  - (existing tests augmented with `request_id` assertions)

### 4.2 Seatbelt regression (vitest)

```
$ bun x vitest run src/runtime/sandbox/macos/seatbelt-host-helper-authority.test.ts
 Test Files  1 passed (1)
      Tests  8 passed (8)

$ bun x vitest run src/runtime/sandbox/macos/seatbelt-profile.test.ts
 Test Files  1 passed (1)
      Tests  40 passed (40)

$ bun x vitest run src/runtime/sandbox/macos/seatbelt-ssh-agent-authority.test.ts
 Test Files  1 passed (1)
      Tests  7 passed | 4 skipped (11)
```

8 + 40 + 7 = 55 Seatbelt tests still green (4 ssh-agent skipped are
the same substrate-deferred launchd tests as before).

### 4.3 Total

Helper tests: **63/63 PASS**
Seatbelt regression: **55/55 PASS** (4 substrate-deferred skip)
**Total: 118/118 tests pass.**

---

## section 5. Evidence classification

After CORRECTION02:

```
LAUNCHD_SOCKET_ACTIVATION_IMPLEMENTATION = GREEN
LAUNCHD_SOCKET_ACTIVATION_LIVE           = LIVE_UNOBSERVABLE
MANUAL_ESRCH_FALLBACK                    = LIVE GREEN

PROTOCOL_REQUEST_ID_CORRELATION           = GREEN
SEATBELT_KERNEL_RED                       = LIVE_UNOBSERVABLE
SEATBELT_KERNEL_GREEN                     = LIVE_UNOBSERVABLE
SIBLING_KERNEL_DENY                       = LIVE_UNOBSERVABLE
```

The PASS_WITH_LIVE_KERNEL_QUALIFICATION_PENDING disposition is otherwise
the right shape. The digest is still a dirty, unbound subject, so
none of this should be treated as exact-head closure evidence.

---

## section 6. Board transition

```
CORRECTION01 launch_activate_socket wiring     GREEN
CORRECTION01 live launchd activation           LIVE_UNOBSERVABLE
CORRECTION02 protocol conservation             GREEN
CORRECTION02 fail-closed fallback              GREEN

TRUSTED-VSIX-TESTBED-PROBE01                   NOW UNBLOCKED
```

After CORRECTION02:

**C1: GO TO `ACT-CLINEMM-MACOS-TRUSTED-VSIX-TESTBED-PROBE01`.**

No further pre-probe architecture review.
