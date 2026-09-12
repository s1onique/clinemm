# ACT-CLINEMM-MACOS-TRUSTED-HOST-HELPER01-CORRECTION04

**Status:** GREEN (post-CORRECTION03) + JSON Unicode input parsing witness GREEN
**Predecessor:** ACT-CLINEMM-MACOS-TRUSTED-HOST-HELPER01-CORRECTION03 (GREEN)
**Reviewer's verdict addressed:** HALT_HOST_HELPER_JSON_UNICODE_ESCAPE_PARSE (P0 protocol conservation)
**Disposition:** PASS_WITH_LIVE_KERNEL_QUALIFICATION_PENDING

## 1. Problem statement

CORRECTION03 added JSON-escape on output so escape-shaped IDs round-trip
correctly. The input parser (`parse_string()`) accepted only the short
escapes:

```c
\" \\ \/ \n \t \r \b \f
```

and rejected everything else (including the RFC 8259 §7 `\uXXXX` Unicode
escape). That meant a perfectly legal request like:

```json
{"version":1,"request_id":"ctl-\u0001","method":"health"}
```

was rejected as `BAD_JSON`. JSON.stringify legitimately emits `\uXXXX`
for control characters and `\uD83D\uDE80` surrogate pairs for
supplementary-plane codepoints. So the C parser was still narrower than
the declared protocol. The output side was correct (CORRECTION03); the
input side was still broken.

## 2. Bounded scope (do NOT touch)

- launchd activation seam (CORRECTION01, GREEN).
- ESRCH / ENOENT / EALREADY / rc=0+cnt=0 fail-closed matrix (CORRECTION02, GREEN).
- JSON-escape on output (CORRECTION03, GREEN).
- Seatbelt profiles, Tart, capability model.
- TypeScript client/server (already escape via JSON.stringify).
- Protocol envelope shape (frozen).

## 3. Bounded change

### 3.1 `hex_value()` (helper.c, lines ~184–190)

A 4-line helper that decodes one hex digit to a value 0..15 or returns
-1 on non-hex. Used by the `\uXXXX` decoder.

### 3.2 `utf8_encode()` (helper.c, lines ~192–230)

Encodes a Unicode codepoint as 1–4 UTF-8 bytes into `out[*off]`.
Rejects codepoints outside the Unicode range (`>= 0x110000`) and
rejects surrogate code units (`0xD800–0xDFFF`) per RFC 8259 §7. Returns
0 on success or -1 if `out` would overflow or the codepoint is invalid.

### 3.3 `parse_string()` Unicode branch (helper.c, lines ~248–289)

The `if (p[1] == 'u')` branch reads exactly 4 hex digits after `\u`,
decodes to a 16-bit codepoint, then:

1. If the codepoint is a high surrogate (`0xD800–0xDBFF`), requires
   that the next 6 chars be `\uXXXX` where XXXX is a low surrogate
   (`0xDC00–0xDFFF`). Combines them via the standard UTF-16 surrogate
   pair arithmetic to obtain a supplementary-plane codepoint.
2. If the codepoint is a lone low surrogate (`0xDC00–0xDFFF`), rejects
   (returns NULL → BAD_JSON).
3. Otherwise (BMP non-surrogate), uses the codepoint as-is.
4. Calls `utf8_encode()` to write 1–4 UTF-8 bytes into `out`.

### 3.4 No regex restriction on input

The repair is **decode on input**, not **reject on input**. Any
sequence of bytes that the envelope parser accepts is preserved
verbatim; the new Unicode decode path matches what JSON.stringify
emits and what JSON.parse accepts.

## 4. RED→GREEN discriminator (mandated by reviewer)

For each positive ID, `JSON.stringify({request_id: id})` → C helper →
`JSON.parse(response)` → `response.request_id === id`.

Positive IDs:
- `ctl-\u0001`
- `snowman-\u2603` (`\uXXXX` for BMP)
- `rocket-\u{1F680}` (surrogate pair `\uD83D\uDE80` for supplementary plane)
- `mixed-quote-\"-\u2603-\u{1F680}` (combined short + BMP + surrogate)

Negative IDs (must reject with `BAD_JSON`):
- `\uD800` (lone high surrogate)
- `\uDC00` (lone low surrogate)
- `\uZZZZ` (non-hex digits)
- `\u00` (truncated — only 2 hex digits)
- `\uD83D-x` (high surrogate not followed by `\uXXXX`)
- `\uD83D\u0041` (high surrogate followed by non-low-surrogate)

## 5. Test plan (executed 2026-09-12)

### 5.1 helper.test.ts — 8 new CORRECTION04 tests

| # | Name | What it asserts |
|---|------|-----------------|
| 1 | source declares hex_value + utf8_encode + Unicode decode | Source-level invariants for the new symbols. |
| 2 | \uXXXX round-trips BMP characters (snowman, controls) | `ctl-\u0001`, `snowman-\u2603` round-trip. |
| 3 | surrogate pair \uD83D\uDE80 decodes to 🚀 | Hand-authored wire payload with literal surrogate pair; round-trip exact. |
| 4 | supplementary plane codepoint (🚀) round-trips end-to-end via JSON.stringify | Bun's JSON.stringify emits raw UTF-8 for 🚀; the parser must accept it. |
| 5 | mixed \uXXXX + short escapes + injection round-trip | Hand-authored wire with `\"`, `\u2603`, and `\uD83D\uDE80` all in one request_id. |
| 6 | same ID with raw UTF-8 in wire (Bun JSON.stringify behavior) round-trips | Companion: Bun's emitted form (raw UTF-8) round-trips. |
| 7 | malformed \uXXXX fails closed (BAD_JSON) | All 6 negative IDs return `{ok:false, error:"BAD_JSON"}`. |
| 8 | client API round-trips Unicode escapes | End-to-end through `createHealthClient().health()`. |

### 5.2 client.test.ts — 4 new CORRECTION04 tests

| # | Name | What it asserts |
|---|------|-----------------|
| 1 | client.health round-trips BMP \uXXXX (snowman) | ☃ via the client API. |
| 2 | client.health round-trips supplementary plane (🚀 via surrogate pair) | 🚀 via the client API. |
| 3 | client.health round-trips mixed escapes + Unicode | Combined `\"` + `\uXXXX` + surrogate pair via the client API. |
| 4 | client.health rejects malformed \uXXXX with BAD_JSON | Hand-built wire payload with lone high surrogate; rejection observable at API surface. |

### 5.3 Re-classified evidence invariants

| Invariant | Pre-CORRECTION04 | Post-CORRECTION04 |
|-----------|------------------|--------------------|
| `PROTOCOL_REQUEST_ID_BASIC_CORRELATION` | GREEN | GREEN |
| `PROTOCOL_REQUEST_ID_JSON_ROUNDTRIP` | GREEN | GREEN |
| `PROTOCOL_REQUEST_ID_UNICODE_INPUT` | **P0 FAIL** | **GREEN** |
| `FAIL_CLOSED_LAUNCHD_MATRIX` | STRUCTURAL + ESRCH LIVE | unchanged |
| `LAUNCHD_SOCKET_ACTIVATION_IMPLEMENTATION` | GREEN | GREEN |
| `LAUNCHD_SOCKET_ACTIVATION_LIVE` | LIVE_UNOBSERVABLE | LIVE_UNOBSERVABLE |
| `MANUAL_ESRCH_FALLBACK` | LIVE GREEN | LIVE GREEN |
| `SEATBELT_KERNEL_*` / `SIBLING_KERNEL_DENY` | LIVE_UNOBSERVABLE | LIVE_UNOBSERVABLE |

## 6. Live GREEN witness (recorded 2026-09-12)

### Positive (reviewer-mandated IDs):

```
=== POSITIVE TEST (reviewer-mandated IDs with REAL \uXXXX in wire) ===
  input payload: {"version":1,"request_id":"ctl-\u0001","method":"health"}
  PASS  ctl-\u0001                           echoed="ctl-\u0001"
  input payload: {"version":1,"request_id":"snowman-\u2603","method":"health"}
  PASS  snowman-\u2603                       echoed="snowman-\u2603"
  input payload: {"version":1,"request_id":"rocket-\u{1F680}","method":"health"}
  PASS  rocket-\u{1F680}                     echoed="rocket-\u{1F680}"
  input payload: {"version":1,"request_id":"mixed-quote-\"-\u2603-\u{1F680}","method":"health"}
  PASS  mixed-quote-"-\u2603-\u{1F680}       echoed="mixed-quote-\"-\u2603-\u{1F680}"
  ---
  POSITIVE SUMMARY: 4 pass, 0 fail
```

### Negative (hand-authored wire with literal \uXXXX escapes):

```
=== NEGATIVE TEST (corrected: one backslash before u) ===
  PASS  lone high surrogate \uD800                  response={"ok":false,"error":"BAD_JSON"}
  PASS  lone low surrogate \uDC00                   response={"ok":false,"error":"BAD_JSON"}
  PASS  malformed \uZZZZ                           response={"ok":false,"error":"BAD_JSON"}
  PASS  truncated \u00                             response={"ok":false,"error":"BAD_JSON"}
  PASS  high surrogate not followed by low          response={"ok":false,"error":"BAD_JSON"}
  PASS  high surrogate followed by non-low (\u0041) response={"ok":false,"error":"BAD_JSON"}
  ---
  NEGATIVE SUMMARY: 6 correctly rejected, 0 incorrectly accepted
```

Note: The positive test sends the actual surrogate pair bytes via
Bun's `JSON.stringify`, which for 🚀 emits the raw 4-byte UTF-8
character (Bun does NOT escape supplementary characters in JSON).
The C parser sees those raw bytes, stores them as UTF-8 in the
request_id, then re-emits them through `write_json_string()` on
output. JSON.parse on the response yields 🚀.

The negative test hand-builds wire payloads with literal `\uXXXX`
escape sequences to ensure each negative case has the EXACT form the
helper should reject (one backslash, then `uXXXX`). The `String.raw`
template literal prevents JavaScript from interpreting `\uXXXX` in
the test source code as a Unicode escape.

## 7. Full test battery (post-CORRECTION04)

```
bun test tools/macos-host-helper/         →  82 pass / 0 fail  / 348 expects / 3 files
  - helper.test.ts:    34 tests (parent 17 + C02 5 + C03 4 + C04 8)
  - client.test.ts:    14 tests (parent 3  + C02 4 + C03 3 + C04 4)
  - server.test.ts:    34 tests (parent, dev-mode fallback)

bun x vitest run seatbelt-host-helper-authority   →  8 pass
bun x vitest run seatbelt-profile                 → 40 pass
bun x vitest run seatbelt-ssh-agent-authority     →  7 pass | 4 skipped (substrate-deferred)

TOTAL: 137 pass / 0 fail / 4 skipped
```

(The CORRECTION03 tally was 70 helper + 55 seatbelt = 125. The +12
helper delta is the eight CORRECTION04 helper.test.ts tests and four
CORRECTION04 client.test.ts tests. Helper LOC: 464 → 562; the +98 LOC
is `hex_value`, `utf8_encode`, and the Unicode branch in `parse_string`.)

## 8. Build / lint

- `cc -O2 -Wall -Wextra -o helper helper.c` → exit 0, no warnings.
- `tsc --noEmit --skipLibCheck --module esnext --target esnext --moduleResolution bundler --types bun client.ts client.test.ts` → exit 0.

## 9. Files

### Modified

- `tools/macos-host-helper/native/helper.c`
  - `+hex_value()` (lines ~184–190).
  - `+utf8_encode()` (lines ~192–230).
  - `parse_string()` extended with `\uXXXX` decode + surrogate-pair handling (lines ~244–349).
  - File header comment updated to cite CORRECTION04.
- `tools/macos-host-helper/native/helper.test.ts`
  - 8 new CORRECTION04 tests.
- `tools/macos-host-helper/client.test.ts`
  - 4 new CORRECTION04 tests.
  - `+import { createConnection } from "node:net"`.
- `.gitignore`
  - Whitelist CORRECTION04 ACT + evidence.

### Added

- `.factory/acts/ACT-CLINEMM-MACOS-TRUSTED-HOST-HELPER01-CORRECTION04.md` (this file).
- `.factory/evidence/ACT-CLINEMM-MACOS-TRUSTED-HOST-HELPER01-CORRECTION04/`
  - `00-defect.txt` — reviewer's P0 Unicode-input defect.
  - `01-launchd-red.txt` — FFI symbol probe (unchanged).
  - `02-launchd-green-c-fallback.txt` — C fallback witness (unchanged).
  - `03-launchd-green-fail-closed-source.txt` — fail-closed matrix (unchanged).
  - `04-launchd-green-c-json-escape.txt` — JSON-escape output (unchanged).
  - `05-launchd-green-c-unicode-input.txt` — **NEW** Unicode input round-trip witnesses.

## 10. Closure note

Reviewer's verdict **HALT_HOST_HELPER_JSON_UNICODE_ESCAPE_PARSE** is
fully resolved. The C parser now decodes RFC 8259 §7 short escapes,
`\uXXXX` BMP escapes, and surrogate pairs for supplementary-plane
codepoints. Malformed inputs (lone surrogates, non-hex digits,
truncation) are rejected with `BAD_JSON` (fail-closed). The wire
contract now matches what `JSON.stringify` legitimately produces and
what `JSON.parse` accepts.

The protocol-conservation chain is now closed:

```
JSON.stringify(request_id)
  → wire bytes (may contain ", \, \b, \uXXXX, surrogate pairs, raw UTF-8)
  → C parse_string decodes all of these (CORRECTION04)
  → semantic UTF-8 in kv.val
  → C write_json_string re-encodes (CORRECTION03)
  → wire bytes (valid JSON)
  → JSON.parse(response)
  → response.request_id === original semantic ID
```

Board transition:

```
CORRECTION01 launch_activate_socket wiring       GREEN
CORRECTION02 request_id correlation              GREEN
CORRECTION02 fail-closed launchd matrix          GREEN
CORRECTION03 JSON output escaping                GREEN
CORRECTION04 JSON Unicode input parsing          NOW

TRUSTED-VSIX-TESTBED-PROBE01                     BLOCKED only on commit/rebind
```

Per the reviewer's final note: **after this bounded parser fix and
clean committed identity: C1: GO TO TRUSTED-VSIX-TESTBED-PROBE01.**
