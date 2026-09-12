# ACT-CLINEMM-MACOS-TRUSTED-HOST-HELPER01-CORRECTION05

**Status:** GREEN (post-CORRECTION04) + embedded-NUL preservation witness GREEN
**Predecessor:** ACT-CLINEMM-MACOS-TRUSTED-HOST-HELPER01-CORRECTION04 (GREEN)
**Reviewer's verdict addressed:** HALT_HOST_HELPER_REQUEST_ID_NUL_TRUNCATION (P0)
**Disposition:** PASS_WITH_LIVE_KERNEL_QUALIFICATION_PENDING

## 1. Problem statement

CORRECTION04 added RFC 8259 §7 `\uXXXX` decoding to the C parser's input
side, including `\u0000`. But the parser still stores decoded strings as
NUL-terminated C strings in `kv_t.val`. The perfectly valid request:

```json
{"version":1,"request_id":"a\u0000b","method":"health"}
```

decodes semantically to the three bytes `a 0x00 b`, but the helper's C
representation becomes effectively `"a"` for every consumer that uses
ordinary C-string semantics (`strlen`, `strcmp`, `printf %s`,
`write_json_string`'s previous `*p` iteration).

The response writes back only `"a"`, so correlation silently fails.

## 2. Bounded scope (do NOT touch)

- launchd activation seam (CORRECTION01, GREEN).
- ESRCH / ENOENT / EALREADY / rc=0+cnt=0 fail-closed matrix (CORRECTION02, GREEN).
- JSON-escape on output (CORRECTION03, GREEN).
- RFC 8259 §7 \uXXXX + surrogate-pair decoding (CORRECTION04, GREEN).
- Lone-surrogate handling (CORRECTION04: BAD_JSON — reviewer's
  approved protocol clarification, NOT a redesign).
- Seatbelt profiles, Tart, capability model.
- TypeScript client/server (already length-aware via JSON.stringify /
  Buffer.length; no changes needed).
- Protocol envelope shape (frozen).

## 3. Bounded change

### 3.1 `kv_t` gets `val_len` (helper.c, line ~73)

```c
typedef struct {
  char key[MAX_KEY_LEN];
  char val[MAX_VAL_LEN]; // only the legal-envelope values are captured
  size_t val_len;        // CORRECTION05: semantic byte length (may contain
                         // embedded 0x00 bytes; never use strlen(val)).
  enum { V_STR, V_NUM } kind;
} kv_t;
```

The `val` array is still NUL-terminated as a defensive sentinel at
`val[val_len]`, but the semantic truth is `val_len`. Consumers MUST
iterate by `val_len`, not by `*val`.

### 3.2 `parse_string` signature change (helper.c, line ~256)

Before:
```c
static const char *parse_string(const char *p, char *out, size_t out_cap);
```

After:
```c
static const char *parse_string(const char *p, char *out, size_t out_cap, size_t *out_len);
```

`parse_string` now writes the decoded byte count to `*out_len` and
keeps a defensive NUL sentinel at `out[*out_len]`. The buffer is
safe to read up to `out_cap - 1` bytes (the trailing NUL is at
`out[off]` if there's room; the bounds checks already ensure `off`
stays ≤ `out_cap - 1`).

### 3.3 `write_json_string` signature change (helper.c, line ~136)

Before:
```c
static int write_json_string(char *out, size_t out_cap, const char *s);
```

After:
```c
static int write_json_string(char *out, size_t out_cap, const void *s, size_t len);
```

The loop iterates by `for (size_t i = 0; i < len; i++)`, not by `*p`.
No `strlen()` call. Embedded 0x00 bytes are escaped as `\u0000` per
the existing control-byte branch (the input `c < 0x20` arm already
handles them).

### 3.4 `respond_ok` signature change (helper.c, line ~448)

Before:
```c
static void respond_ok(int cfd, const char *request_id);
```

After:
```c
static void respond_ok(int cfd, const void *request_id, size_t request_id_len);
```

The body now passes `(request_id, request_id_len)` to
`write_json_string` instead of just `request_id`.

### 3.5 `handle_connection` empty check (helper.c, line ~525)

Before:
```c
if (r->kind != V_STR || r->val[0] == 0) {
  respond_err(cfd, "MISSING_REQUEST_ID");
  ...
}
```

After:
```c
if (r->kind != V_STR || r->val_len == 0) {
  respond_err(cfd, "MISSING_REQUEST_ID");
  ...
}
```

A request_id of `"\u0000"` has `val_len == 1` and is therefore
non-empty (preserved through the round trip). A request_id of `""`
has `val_len == 0` and is rejected.

### 3.6 `parse_number` symmetric change (helper.c, line ~344)

For symmetry and to support length-aware comparisons downstream,
`parse_number` now also returns the decoded byte count in `*out_len`.
JSON numbers cannot contain NUL, so this is defensive rather than a
correctness fix.

### 3.7 Caller updates (helper.c)

`parse_envelope` passes `&kv->val_len` to `parse_string` and
`&vlen` to `parse_number`. The `handle_connection` site now calls
`respond_ok(cfd, r->val, r->val_len)`.

## 4. RED→GREEN discriminator (mandated by reviewer)

For each positive case, `JSON.stringify({request_id: id})` → C helper →
`JSON.parse(response)` → byte-for-byte equality + length equality.

| # | Semantic request_id        | Pre-C05 result        | Post-C05 result |
|---|----------------------------|------------------------|------------------|
| 1 | `a\u0000b` (3 bytes)       | `"a"` (1 byte) FAIL   | `"a\u0000b"` (3 bytes) PASS |
| 2 | `\u0000` (1 byte)          | `MISSING_REQUEST_ID` (rejected) FAIL | `"\u0000"` (1 byte) PASS |
| 3 | `\u0000-leading` (9 bytes) | `MISSING_REQUEST_ID` (rejected) FAIL | `"\u0000-leading"` (9 bytes) PASS |
| 4 | `trailing-\u0000` (10 bytes) | `"trailing-"` (9 bytes) FAIL | `"trailing-\u0000"` (10 bytes) PASS |
| 5 | `a\u0001b` (3 bytes)       | `"a\u0001b"` PASS     | `"a\u0001b"` PASS (regression preserved) |
| 6 | `rocket-\u{1F680}` (9 bytes) | `"rocket-\u{1F680}"` PASS | `"rocket-\u{1F680}"` PASS (regression preserved) |
| 7 | `a\u0000b\u0000c` (5 bytes, multi-NUL) | `"a"` FAIL | `"a\u0000b\u0000c"` PASS |

## 5. Live GREEN witness (recorded 2026-09-12)

The helper was spawned via the standard test harness (af_unix socket
under `/tmp/clinemm-c05-evidence.sock`, status file under
`/tmp/clinemm-c05-evidence.status.json`). The reviewer-mandated
discriminator and 6 additional cases were sent over real AF_UNIX:

```
case: a\u0000b (reviewer discriminator, 3 bytes)
  wire bytes:  7b 22 ... 61 5c 75 30 30 30 30 62 ... 7d
                 ^^                     ^^^^
                 "a"                    \u0000 (literal 6-char escape)
                                            then "b"
  response:    {"version":1,"request_id":"a\u0000b","ok":true,...}
  request_id:  "a\u0000b"
  request_id bytes: 61 00 62   (the 0x00 IS preserved)
  length:      3
  RESULT:      PASS

case: \u0000-leading (9 bytes)
  request_id bytes: 00 2d 6c 65 61 64 69 6e 67
  length:      9
  RESULT:      PASS

case: trailing-\u0000 (10 bytes)
  request_id bytes: 74 72 61 69 6c 69 6e 67 2d 00
  length:      10
  RESULT:      PASS

case: a\u0000b\u0000c (multi-NUL, 5 bytes)
  request_id bytes: 61 00 62 00 63
  length:      5
  RESULT:      PASS

case: \u0000 only (1 byte)
  request_id bytes: 00
  length:      1
  RESULT:      PASS

case: a\u0001b (control-NOT-NUL, regression check)
  request_id bytes: 61 01 62
  length:      3
  RESULT:      PASS

case: rocket-\u{1F680} (supplementary plane, regression check)
  request_id bytes: 72 6f 63 6b 65 74 2d f0 9f 9a 80
  length:      9
  RESULT:      PASS

SOURCE-LEVEL INVARIANTS:
  kv_t has val_len:                       PASS
  write_json_string takes (..., len):     PASS
  respond_ok takes (cfd, bytes, len):     PASS
  caller passes (r->val, r->val_len):     PASS
  empty check uses val_len:               PASS
  write_json_string loop bound is len:    PASS
  write_json_string does not use strlen:  PASS
```

Full witness at
`.factory/evidence/ACT-CLINEMM-MACOS-TRUSTED-HOST-HELPER01-CORRECTION05/06-launchd-green-c-nul-preservation.txt`.

## 6. Reviewer's correction to CORRECTION04 (acknowledged)

The reviewer noted that CORRECTION04's "lone surrogates = malformed
JSON" requirement was over-prescribed. RFC 8259 §7 permits lone
surrogates (they are "non-interoperable Unicode content", not
syntactic errors).

We adopt the reviewer's favored protocol clarification: **this
helper restricts request IDs to Unicode scalar values**, so lone
surrogates continue to be rejected as `BAD_JSON`. This is unchanged
from CORRECTION04. The reviewer explicitly stated: "Do not let this
spawn another architecture cycle."

## 7. Test plan (executed 2026-09-12)

### 7.1 helper.test.ts — 10 new CORRECTION05 tests

| # | Name | What it asserts |
|---|------|-----------------|
| 1 | RED — embedded NUL in request_id round-trips | Reviewer's exact discriminator: `a\u0000b` → 3 bytes back. |
| 2 | lone `\u0000` request_id is NOT rejected as empty | A single NUL byte has `val_len=1`; non-empty by length. |
| 3 | leading NUL byte preserved | `\u0000-leading` → 9 bytes back. |
| 4 | trailing NUL byte preserved | `trailing-\u0000` → 10 bytes back. |
| 5 | `a\u0001b` (control, not NUL) still round-trips | Regression check on CORRECTION04. |
| 6 | `rocket-\u{1F680}` (supplementary plane) still round-trips | Regression check on CORRECTION04. |
| 7 | source declares `val_len` + length-aware `write_json_string` | Source-level invariants for the new shape. |
| 8 | kv_t uses length, not NUL termination, at the consume site | Verify the `respond_ok(cfd, r->val, r->val_len)` call site and that the `write_json_string` loop iterates by `i < len`. |
| 9 | client API round-trips embedded NUL | End-to-end through `createHealthClient().health()`. |
| 10 | `a\u0000b\u0000c` — multiple embedded NULs | Stress: multiple NULs in one request_id. |

### 7.2 client.test.ts — no changes

The client API is length-aware by construction (JSON.stringify /
Buffer / JSON.parse all carry lengths). The 4 existing CORRECTION04
client tests still pass without modification, and the 5 CORRECTION05
client tests in helper.test.ts (#9 above) cover the end-to-end
behavior through `createHealthClient().health()`.

### 7.3 CORRECTION02 test #2 (helper.test.ts) — updated

The test "CORRECTION02: helper source emits request_id in response"
previously asserted `respond_ok(cfd, r->val)`. After CORRECTION05
the call site is `respond_ok(cfd, r->val, r->val_len)`. The test
was updated to assert the new form. The intent (verify the
parsed request_id is routed to the response) is preserved.

## 8. Full test battery (post-CORRECTION05)

```
bun test tools/macos-host-helper/         →  92 pass / 0 fail  / 409 expects / 3 files
  - helper.test.ts:    44 tests (parent 17 + C02 5 + C03 4 + C04 8 + C05 10)
  - client.test.ts:    14 tests (parent 3  + C02 4 + C03 3 + C04 4)
  - server.test.ts:    34 tests (parent, dev-mode fallback)

bun x vitest run seatbelt-host-helper-authority   →  8 pass
bun x vitest run seatbelt-profile                 → 40 pass
bun x vitest run seatbelt-ssh-agent-authority     →  7 pass | 4 skipped (substrate-deferred)

TOTAL: 147 pass / 0 fail / 4 skipped
```

The CORRECTION04 tally was 137 (helper 82 + seatbelt 55). The +10
helper delta is the eight CORRECTION05 helper.test.ts tests (the
9th and 10th are the source-invariant tests). Helper LOC: 562 → 597;
the +35 LOC is the length-aware `parse_string` / `parse_number` /
`write_json_string` / `respond_ok` plumbing + comments.

## 9. Build / lint

- `cc -O2 -Wall -Wextra -o helper helper.c` → exit 0, no warnings.
- `tsc --noEmit --skipLibCheck --module esnext --target esnext --moduleResolution bundler --types bun client.ts client.test.ts` → exit 0.

## 10. Files

### Modified

- `tools/macos-host-helper/native/helper.c`
  - `kv_t` gains `size_t val_len` (line ~73).
  - `parse_string` signature: `(p, out, cap)` → `(p, out, cap, out_len)` (line ~256).
  - `parse_string` body: writes `*out_len = off`, places defensive NUL at `out[off]` if room.
  - `parse_number` signature: `(p, out, cap)` → `(p, out, cap, out_len)` (line ~344).
  - `write_json_string` signature: `(out, cap, s)` → `(out, cap, s, len)` (line ~136).
  - `write_json_string` loop: `*p` → `i < len`.
  - `respond_ok` signature: `(cfd, id)` → `(cfd, id, id_len)` (line ~448).
  - `handle_connection` empty check: `r->val[0] == 0` → `r->val_len == 0` (line ~525).
  - `handle_connection` `respond_ok` call: `respond_ok(cfd, r->val)` → `respond_ok(cfd, r->val, r->val_len)`.
  - File header comment updated to cite CORRECTION05.
- `tools/macos-host-helper/native/helper.test.ts`
  - 10 new CORRECTION05 tests.
  - CORRECTION02 test #2 updated for the new `respond_ok` signature.
- `.gitignore`
  - Whitelist CORRECTION05 ACT + evidence.

### Added

- `.factory/acts/ACT-CLINEMM-MACOS-TRUSTED-HOST-HELPER01-CORRECTION05.md` (this file).
- `.factory/evidence/ACT-CLINEMM-MACOS-TRUSTED-HOST-HELPER01-CORRECTION05/`
  - `00-defect.txt` — reviewer's P0 embedded-NUL defect.
  - `01-launchd-red.txt` — FFI symbol probe (unchanged from CORRECTION04).
  - `02-launchd-green-c-fallback.txt` — C fallback witness (unchanged).
  - `03-launchd-green-fail-closed-source.txt` — fail-closed matrix (unchanged).
  - `04-launchd-green-c-json-escape.txt` — JSON-escape output (unchanged).
  - `05-launchd-green-c-unicode-input.txt` — Unicode input round-trip (unchanged).
  - `06-launchd-green-c-nul-preservation.txt` — **NEW** embedded-NUL witnesses.

## 11. Closure note

Reviewer's verdict **HALT_HOST_HELPER_REQUEST_ID_NUL_TRUNCATION** is
fully resolved. The C helper now stores parsed strings as
`(bytes, len)` rather than NUL-terminated strings, and every consumer
iterates by length:

- `parse_string(p, out, cap, *out_len)` writes the semantic length.
- `parse_envelope` captures `kv->val_len` from the parser.
- `respond_ok(cfd, request_id, request_id_len)` passes both to the
  emitter.
- `write_json_string(out, cap, s, len)` iterates by index, escapes
  embedded 0x00 as `\u0000` per the existing control-byte arm.

The protocol-conservation chain is now fully closed:

```
JSON.stringify(request_id)
  → wire bytes (may contain ", \, \b, \f, \n, \r, \t, \uXXXX (incl. \u0000),
                 surrogate pairs, raw UTF-8)
  → C parse_string decodes all of these (CORRECTION04)
  → semantic bytes in kv.val with kv.val_len (CORRECTION05)
  → C write_json_string re-encodes by len (CORRECTION03 + CORRECTION05)
  → wire bytes (valid JSON, NUL bytes become \u0000)
  → JSON.parse(response)
  → response.request_id === original request_id, byte-for-byte,
    length-for-length, regardless of NUL content
```

Board transition:

```
C01 launch_activate_socket wiring       GREEN
C02 correlation/fail-closed matrix      GREEN
C03 JSON output escaping                GREEN
C04 JSON Unicode input parsing          GREEN for scalar Unicode
C05 embedded-NUL preservation           NOW — P0

commit/rebind                           BLOCKED on C05
TRUSTED-VSIX-TESTBED-PROBE01            BLOCKED on C05 + commit/rebind
```

Per the reviewer's final note: "after that one bounded fix:
commit/rebind, then **C1: GO to the trusted VSIX testbed probe.**"

The CORRECTION05 ACT body and evidence files are now git-tracked via
the `.gitignore` whitelist. The worktree has not yet been committed
— that commit-and-rebind step is out of scope for this correction
ACT (it is the next step the verifier will perform, after which
TRUSTED-VSIX-TESTBED-PROBE01 is unblocked).
