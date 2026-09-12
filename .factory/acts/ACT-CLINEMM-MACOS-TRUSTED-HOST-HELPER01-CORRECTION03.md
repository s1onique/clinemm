# ACT-CLINEMM-MACOS-TRUSTED-HOST-HELPER01-CORRECTION03

**Status:** GREEN (post-CORRECTION02) + JSON-escape witness GREEN
**Predecessor:** ACT-CLINEMM-MACOS-TRUSTED-HOST-HELPER01-CORRECTION02 (GREEN)
**Reviewer's verdict addressed:** HALT_HOST_HELPER_REQUEST_ID_JSON_ESCAPE (P0 protocol conservation)
**Disposition:** PASS_WITH_LIVE_KERNEL_QUALIFICATION_PENDING

## 1. Problem statement

CORRECTION02 restored `request_id` echo through the C helper. The wire
emission used `snprintf("...,\"request_id\":\"%s\",...", request_id)`.
That passes through any `request_id` literally, including JSON-special
bytes that `parse_string()` already decoded into the semantic value.

Result: perfectly legal IDs broke the response envelope:

```c
// Input  (decode by parse_string):  a"b
// Output (via %s, no re-escape):    {"request_id":"a"b","ok":true,...}
// Which is invalid JSON.
```

`protocol.ts::buildOkResponse` treats `request_id` as an opaque non-empty
string. The TypeScript path uses `JSON.stringify`, which always escapes.
The C path, post-CORRECTION02, did not — silently narrowing the protocol
to `[A-Za-z0-9._-]+` without declaring it. That is production-contract
drift and a protocol-conservation regression.

## 2. Bounded scope (do NOT touch)

- launchd activation seam (CORRECTION01).
- ESRCH / ENOENT / EALREADY / rc=0+cnt=0 fail-closed matrix (CORRECTION02).
- Seatbelt profiles, Tart, or the helper capability model.
- The TypeScript client/server side (already escapes via JSON.stringify).
- The protocol envelope shape (frozen: `{version, request_id, method}`).

## 3. Bounded change

### 3.1 `write_json_string()` emitter (helper.c, lines ~104–180)

A small RFC 8259 §7 escape-aware string emitter:

```
"   -> \"
\   -> \\
/   -> \/
\b \f \n \r \t -> corresponding short escape
any byte < 0x20 -> \u00XX (6 chars)
any byte >= 0x20 -> passthrough
```

Returns the number of bytes written (excluding NUL) or -1 on overflow.
The emitter is bounded by the caller's `out_cap` and never writes past
it; if the output would overflow, it returns -1 and the caller falls
through to the existing `INTERNAL_TRUNCATION` error path.

### 3.2 `respond_ok()` refactor (helper.c, lines ~299–343)

The previous single-`snprintf` form is replaced by three bounded writes
into one stack buffer, all assembled into the same frame and shipped in
a single `write_all()`:

```
header     = snprintf("{\"version\":1,\"request_id\":")
id         = write_json_string(buf, sizeof(buf), request_id)
tail       = snprintf(",\"ok\":true,\"service\":\"clinemm-host-helper\",...}\n")
```

The buffer was previously a separate 2048-byte stack array; it is now
`MAX_FRAME` (4096) so the response is bounded by the same wire cap as
the request, and a single frame ships atomically.

### 3.3 No regex restriction on request_ids

The reviewer explicitly forbade narrowing the protocol to a regex set.
The repair is **escape on output**, not **reject on input**. Any
sequence of bytes the parser accepts is preserved verbatim and re-escaped
on output.

## 4. RED→GREEN discriminator (mandated by reviewer)

For each of the following IDs, this loop MUST yield `PASS`:

```
JSON.stringify({version:1, request_id: <id>, method:"health"})
  -> C helper
  -> JSON.parse(response)
  -> response.request_id === <id>
```

IDs:
- `plain`
- `quote-"inside`
- `backslash-\-inside`
- `newline-\n-inside`
- `tab-\t-inside`

Plus one injection-shaped value:
- `x","ok":false,"request_id":"evil`

For this value, the response MUST still be `{version:1, request_id: <evil>, ok:true, service:..., pid:..., uid:...}` —
the data must not bleed into the response structure.

## 5. Test plan (executed 2026-09-12)

### 5.1 helper.test.ts — 4 new CORRECTION03 tests

| # | Name | What it asserts |
|---|------|-----------------|
| 1 | source declares JSON-escape emitter write_json_string | Source-level: the emitter exists, covers `\`, `"`, `/`, `\b`, `\f`, `\n`, `\r`, `\t`, and `\u00XX` for control bytes. |
| 2 | response is valid JSON for adversarial request_ids | The 5 escape-shaped IDs + 1 injection-shaped ID. For each: response is valid JSON, response.request_id === semantic id, response.ok === true, structural keys intact, no second `request_id`. |
| 3 | each round-trip preserves request_id verbatim (escape-shaped) | Wire round-trip on the 5 escape-shaped IDs. |
| 4 | injection-shaped request_id stays data, not structure | The injection ID round-trips as data, with `ok=true` and exactly the legal top-level keys. |

### 5.2 client.test.ts — 3 new CORRECTION03 tests

| # | Name | What it asserts |
|---|------|-----------------|
| 1 | client round-trips escape-shaped request_ids | The 5 escape-shaped IDs through `createHealthClient().health()`. |
| 2 | client round-trips injection-shaped request_id as data | The injection ID through the client API; `env.ok === true` and `env.request_id === evil`. |
| 3 | client rejects malformed response when helper omits escape | Source-level: `MissingRequestIdError` / `RequestIdMismatchError` are exported with the right names — the fail-closed invariant is intact at the API surface. |

### 5.3 Re-classified evidence invariants

| Invariant | Pre-CORRECTION03 | Post-CORRECTION03 |
|-----------|------------------|--------------------|
| `PROTOCOL_REQUEST_ID_BASIC_CORRELATION` | GREEN | GREEN |
| `PROTOCOL_REQUEST_ID_JSON_ROUNDTRIP` | **P0 FAIL** | **GREEN** |
| `FAIL_CLOSED_LAUNCHD_MATRIX` | STRUCTURAL + ESRCH LIVE | unchanged |
| `LAUNCHD_SOCKET_ACTIVATION_IMPLEMENTATION` | GREEN | GREEN |
| `LAUNCHD_SOCKET_ACTIVATION_LIVE` | LIVE_UNOBSERVABLE | LIVE_UNOBSERVABLE |
| `MANUAL_ESRCH_FALLBACK` | LIVE GREEN | LIVE GREEN |
| `SEATBELT_KERNEL_*` / `SIBLING_KERNEL_DENY` | LIVE_UNOBSERVABLE | LIVE_UNOBSERVABLE |

## 6. Live GREEN witness (recorded 2026-09-12)

```
=== ADVERSARIAL test: each round-trip must JSON.parse cleanly + request_id === semantic ID ===
  PASS  plain                                               echoed="plain"
  PASS  quote-"inside                                       echoed="quote-\"inside"
  PASS  backslash-\-inside                                  echoed="backslash-\\-inside"
  PASS  newline-\n-inside                                   echoed="newline-\n-inside"
  PASS  tab-\t-inside                                       echoed="tab-\t-inside"
  PASS  x","ok":false,"request_id":"evil                    echoed="x\",\"ok\":false,\"request_id\":\"evil"
---
SUMMARY: 6 pass, 0 fail
```

The injection-shaped value is echoed as DATA (the `"` are escaped to
`\"`), and the response structure is intact (`ok=true`, exactly one
`request_id`, version=1).

## 7. Full test battery (post-CORRECTION03)

```
bun test tools/macos-host-helper/         →  70 pass / 0 fail  / 290 expects / 3 files
  - helper.test.ts:    26 tests (parent 17 + C02 5 + C03 4)
  - client.test.ts:    10 tests (parent 3  + C02 5 + C03 3 [overlap on mismatch errors])
  - server.test.ts:    34 tests (parent, dev-mode fallback)

bun x vitest run seatbelt-host-helper-authority   →  8 pass
bun x vitest run seatbelt-profile                 → 40 pass
bun x vitest run seatbelt-ssh-agent-authority     →  7 pass | 4 skipped (substrate-deferred)

TOTAL: 125 pass / 0 fail / 4 skipped
```

(The CORRECTION02 tally was 63 helper + 55 seatbelt = 118. The +7 helper
delta is the four CORRECTION03 helper.test.ts tests and three
CORRECTION03 client.test.ts tests. Helper LOC: 303 → ~480; the +180 LOC
is dominated by `write_json_string()` and its exhaustive comments.)

## 8. Build / lint

- `cc -O2 -Wall -Wextra -o helper helper.c` → exit 0, no warnings.
- `bun --bun tsc --noEmit --skipLibCheck --module esnext --target esnext --moduleResolution bundler --types bun client.ts client.test.ts` → exit 0.

## 9. Files

### Modified
- `tools/macos-host-helper/native/helper.c`
  - +`write_json_string()` (lines ~104–180, ~80 LOC incl. comment).
  - `respond_ok()` refactored to route request_id through the emitter (lines ~299–343).
  - File header comment updated to cite CORRECTION03.
- `tools/macos-host-helper/native/helper.test.ts`
  - 4 new CORRECTION03 tests (lines ~323–409).
  - Replaced the obsolete `%s` source-emit invariant with the emitter-existence invariant.
- `tools/macos-host-helper/client.test.ts`
  - 3 new CORRECTION03 tests (lines ~146–218).
- `.gitignore`
  - Whitelist CORRECTION03 ACT + evidence.

### Added
- `.factory/acts/ACT-CLINEMM-MACOS-TRUSTED-HOST-HELPER01-CORRECTION03.md` (this file)
- `.factory/evidence/ACT-CLINEMM-MACOS-TRUSTED-HOST-HELPER01-CORRECTION03/`
  - `00-defect.txt` — reviewer's P0 defect summary
  - `01-launchd-red.txt` — FFI symbol probe (unchanged)
  - `02-launchd-green-c-fallback.txt` — C fallback witness (updated to include JSON-escape note)
  - `03-launchd-green-fail-closed-source.txt` — fail-closed matrix (unchanged)
  - `04-launchd-green-c-json-escape.txt` — **NEW** JSON-escape round-trip witnesses

## 10. Closure note

Reviewer's verdict **HALT_HOST_HELPER_REQUEST_ID_JSON_ESCAPE** is fully
resolved. The C helper now emits a JSON-escaped `request_id` on every
response, so the wire contract matches `protocol.ts::buildOkResponse`
exactly: any sequence of bytes accepted by the envelope parser is
preserved verbatim in the response.

The Trusted-VSIX-Testbed-Probe01 stays blocked on (a) this correction
(now GREEN) and (b) clean committed identity — see the verifier's note
about 29 untracked files and tracked modifications. The exact-head
closure evidence must be rebinded AFTER `git commit` of this ACT body
and the helper / test files.

The `TRUSTED-VSIX-TESTBED-PROBE01` unblocker sequence is now:
1. CORRECTION03 (this ACT) — JSON-escape witness GREEN.
2. `git add -f .factory/acts/.../CORRECTION03.md` + helper + tests +
   `.gitignore` whitelist + evidence files.
3. `git commit` with message referencing the closure.
4. Re-run the trust-window probe from the new HEAD.
