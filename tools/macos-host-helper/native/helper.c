// =============================================================================
// clinemm-host-helper — C LaunchAgent helper
// =============================================================================
//
// Implements the protocol envelope from ACT-CLINEMM-MACOS-TRUSTED-HOST-HELPER01
// (parent) and the launchd socket-activation wiring from
// ACT-CLINEMM-MACOS-TRUSTED-HOST-HELPER01-CORRECTION01, CORRECTION02
// (correlation + fail-closed fallback), CORRECTION03 (JSON escape on
// output), CORRECTION04 (RFC 8259 §7 \uXXXX Unicode escape on input,
// with full surrogate-pair handling), and CORRECTION05
// (length-aware kv_t so embedded NUL bytes survive the round trip).
//
// PROBE01 EXTENSION:
//   ACT-CLINEMM-MACOS-TRUSTED-VSIX-TESTBED-PROBE01 adds one new
//   fixed method `testbed.run-installed-vsix-smoke` (in addition to
//   the existing `health`). The legal envelope for that method is
//   { version, request_id, method, subject_head, vsix_path, vsix_sha256 }.
//
//   Anti-shell guarantees (PROBE01, in addition to ACT-01):
//     1. The 10 forbidden keys from ACT-01 remain structurally
//        rejected BEFORE value parsing.
//     2. The recognized-key list is now per-method; the method-
//        specific extra fields (subject_head, vsix_path, vsix_sha256)
//        are accepted ONLY when method is on the allow-list AND the
//        extra fields are present.
//     3. The C helper does NOT pass any of these fields to a shell.
//        It validates them structurally (length, hex pattern, ext)
//        and then execve()s ONE fixed runner
//        (CLINEMM_TESTBED_RUNNER env, default
//        $HOME/.clinemm/libexec/clinemm-vsix-testbed-probe) with a
//        FIXED argv[]. No shell, no env map from the request.
//     4. The runner's stdout (bounded by MAX_FRAME) is forwarded as
//        the response body, prefixed by {"version":1,"request_id":...,"ok":true,"result":
//        The runner is the SOLE substrate allowed to perform Tart
//        orchestration, VSIX hashing, and SSH — the C helper remains
//        the trusted capability gate.
//
// Protocol (v1, capability-frozen — CONSERVED):
//   Request (health): {"version":1, "request_id":"...", "method":"health"}
//   Request (testbed.run-installed-vsix-smoke):
//     {"version":1, "request_id":"...", "method":"testbed.run-installed-vsix-smoke",
//      "subject_head":"<40-hex>", "vsix_path":"<absolute>", "vsix_sha256":"<64-hex>"}
//   Response (ok): {"version":1, "request_id":"<echoed>", "ok":true,
//                    "service":"clinemm-host-helper", "pid":<n>, "uid":<n>}
//   Response (testbed ok): {"version":1, "request_id":"<echoed>", "ok":true,
//                    "result":{ ... }} (runner-emitted JSON object)
//   Errors:   {"ok":false, "error":"<CODE>"}
//
// The response echoes the request_id EXACTLY. The client verifies the
// correlation and fails closed on mismatch (ACT-CLINEMM-MACOS-TRUSTED-HOST-
// HELPER01-CORRECTION02 §3).
//
// Wire format: LF-terminated JSON frames, max 8192 bytes (PROBE01).
//
// Structural anti-shell: 10 forbidden keys (command, argv, shell, exec,
// script, spawn, cmd, cmdline, path, file) are rejected BEFORE value
// parsing. The legal envelope has exactly {version, request_id, method}
// for `health`, or {version, request_id, method, subject_head, vsix_path,
// vsix_sha256} for `testbed.run-installed-vsix-smoke`. Any other key is
// rejected with FORBIDDEN_KEY.
//
// launchd integration (fail-closed in CORRECTION02):
//   1. Call launch_activate_socket("Listener") to retrieve the AF_UNIX fd
//      that launchd pre-bound per the plist's Sockets dict.
//      - rc==0 && cnt>=1: use activated fd.
//      - rc==ESRCH(3):   caller is not launchd-managed → manual/dev
//                        fallback (self-bind $CLINEMM_HOST_HELPER_SOCKET
//                        with mode 0600). This is the ONLY self-bind path.
//      - rc==ENOENT(2):  plist name mismatch → CONFIGURATION DEFECT,
//                        fail closed.
//      - rc==EALREADY(): socket already activated → CONFIGURATION DEFECT,
//                        fail closed.
//      - rc==0 && cnt==0: launchd returned success with no fd →
//                        CONFIGURATION DEFECT, fail closed.
//      - any other rc:   fail closed.
//   2. accept(2) loop on the bound fd.
//   3. On $CLINEMM_HOST_HELPER_SOCKET unset or empty: use
//      /tmp/clinemm-host-helper.sock as the fallback bind path.
//
// Build:   cc -O2 -Wall -o helper helper.c
// Install: see scripts/macos/clinemm-host-helper install
// =============================================================================

#include <sys/socket.h>
#include <sys/un.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <errno.h>
#include <launch.h>
#include <fcntl.h>
#include <signal.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <ctype.h>
#include <poll.h>
#include <sys/time.h>

// ACT-CLINEMM-HOST-HELPER-OWNED-PGID-TERMINATION01:
// peer identity (kernel-authenticated client UID/PID) and
// capability-store includes. SOL_LOCAL / LOCAL_PEERPID is the
// Apple-recommended UNIX-domain peer PID discovery (Chromium uses
// it on Apple platforms). kinfo_proc via sysctl() is the
// Darwin/libproc process-information seam used for start-time
// capture (PID reuse resistance).
#include <sys/uio.h>
#include <sys/sysctl.h>
#include <libproc.h>
#include <sys/socketvar.h>  // SOL_LOCAL on Darwin
#include <stdint.h>

// /dev/urandom for CLIENT_TOKEN entropy. arc4random_buf is the
// portable POSIX-friendly random source on macOS.
// (stdlib.h already included above)

// PROBE01: bumped to 8192 to accommodate a full testbed envelope
// (40-hex subject_head + 64-hex SHA256 + absolute path up to ~1KiB).
#define MAX_FRAME 8192

// ACT-CLINEMM-HOST-HELPER-OWNED-PGID-TERMINATION01: forward decls
// for ACT-01 helpers used by the new method handlers. These are
// defined later in this file; the forward declarations keep the
// ACT-01 call sites stable.

// ACT-CLINEMM-HOST-HELPER-OWNED-PGID-TERMINATION01: forward decls
// for ACT-01 helpers + the BUILD_IDENTITY + CAPABILITY_STORE
// primitives used by respond_ok() and the new handlers.
static const char *hex_sha256_of_self_source(void);
static int count_active_clients(void);
static int count_active_jobs(void);
// Review-correction01: forward decl for the extended proc-identity
// reader used by handle_register_owned for ownership proof.
static int read_proc_identity_ext(pid_t pid, uint64_t *start_us,
                                   uid_t *uid, pid_t *ppid);
// ACT-CLINEMM-HOST-HELPER-OWNED-PGID-TERMINATION01: build_id
// is the deterministic 64-hex SHA-256 of the helper's source
// file (CLINEMM_HELPER_SRC env var) + ABI version string.
// Defined here so respond_ok() and the new handlers can read
// it without a forward declaration. Initialized in main().
// `mutable` is approximated by dropping `const` for the
// pointer-to-pointer-write target — we never mutate the
// pointed-to string, only the pointer itself.
static const char *g_build_id = NULL;
#define MAX_KEYS 16
#define MAX_KEY_LEN 64
#define MAX_VAL_LEN 1024
// PROBE01: per-field caps enforced by validate_testbed_fields().
// vsix_path up to 1024 bytes (absolute path under trusted artifact root).
// subject_head is 40 hex chars; vsix_sha256 is 64 hex chars.
#define MAX_VSIX_PATH_LEN 1024

typedef struct {
  char key[MAX_KEY_LEN];
  char val[MAX_VAL_LEN]; // only the legal-envelope values are captured
  size_t val_len;        // CORRECTION05: semantic byte length (may contain
                         // embedded 0x00 bytes; never use strlen(val)).
  enum { V_STR, V_NUM } kind;
} kv_t;

static volatile sig_atomic_t g_shutdown = 0;
static void on_sig(int s) { (void)s; g_shutdown = 1; }

static ssize_t write_all(int fd, const char *buf, size_t n) {
  size_t off = 0;
  while (off < n) {
    ssize_t w = write(fd, buf + off, n - off);
    if (w < 0) { if (errno == EINTR) continue; return -1; }
    off += (size_t)w;
  }
  return (ssize_t)off;
}

static ssize_t read_frame(int fd, char *buf, size_t cap) {
  size_t off = 0;
  while (off < cap) {
    ssize_t r = read(fd, buf + off, 1);
    if (r == 0) return (ssize_t)off;
    if (r < 0) { if (errno == EINTR) continue; return -1; }
    if (buf[off] == '\n') return (ssize_t)(off + 1);
    off++;
  }
  return -2;
}

// Skip whitespace; return advanced pointer.
static const char *skip_ws(const char *p) {
  while (*p && isspace((unsigned char)*p)) p++;
  return p;
}

// CORRECTION03: emit a JSON string with full escape handling so the
// echoed request_id cannot break the wire contract. Mirrors the
// legal-envelope escape set accepted by parse_string() plus all
// control bytes (RFC 8259 §7).
//
// On input, out_cap is the capacity of out[] including the trailing
// NUL byte (i.e. the same convention as snprintf). Returns the number
// of bytes written to out[] excluding the NUL terminator on success,
// or -1 if out would overflow.
//
// Escape map (output -> input):
//   \"  <-  "
//   \\  <-  \ (backslash)
//   \/  <-  /  (optional per RFC; we emit it for safety)
//   \b  <-  BS  (0x08)
//   \f  <-  FF  (0x0C)
//   \n  <-  LF  (0x0A)
//   \r  <-  CR  (0x0D)
//   \t  <-  HT  (0x09)
//   \u00XX  <-  any other byte < 0x20 (control)
//   <byte>   <-  any byte >= 0x20 (passthrough)
//
// Why: parse_string() decodes JSON escapes into the semantic request_id
// (e.g. "a\"b" -> a"b). If respond_ok() then emits the semantic string
// via %s without re-escaping, the wire frame becomes invalid JSON
// (e.g. {"request_id":"a"b",...}). This was the P0 protocol-conservation
// bug identified by HALT_HOST_HELPER_REQUEST_ID_JSON_ESCAPE.
//
// CORRECTION05: now LENGTH-AWARE (the `len` parameter is the byte count,
// not the strlen()). Embedded 0x00 bytes (from \u0000) survive the output
// stage because the loop iterates by index, not by *p sentinel. The
// symmetric counterpart to parse_string's \uXXXX decoding: embedded 0x00
// in the input becomes "\u0000" on the wire (JSON.stringify's canonical
// encoding), so a downstream JSON.parse recovers the original NUL.
static int write_json_string(char *out, size_t out_cap, const void *s, size_t len) {
  if (out_cap == 0) return -1;
  size_t off = 0;
  // Opening quote
  if (off + 1 >= out_cap) return -1;
  out[off++] = '"';
  for (size_t i = 0; i < len; i++) {
    unsigned char c = ((const unsigned char *)s)[i];
    int needed;
    switch (c) {
      case '"':  needed = 2; if (off + needed >= out_cap) return -1;
                 out[off++] = '\\'; out[off++] = '"';  break;
      case '\\': needed = 2; if (off + needed >= out_cap) return -1;
                 out[off++] = '\\'; out[off++] = '\\'; break;
      case '/':  needed = 2; if (off + needed >= out_cap) return -1;
                 out[off++] = '\\'; out[off++] = '/';  break;
      case '\b': needed = 2; if (off + needed >= out_cap) return -1;
                 out[off++] = '\\'; out[off++] = 'b';  break;
      case '\f': needed = 2; if (off + needed >= out_cap) return -1;
                 out[off++] = '\\'; out[off++] = 'f';  break;
      case '\n': needed = 2; if (off + needed >= out_cap) return -1;
                 out[off++] = '\\'; out[off++] = 'n';  break;
      case '\r': needed = 2; if (off + needed >= out_cap) return -1;
                 out[off++] = '\\'; out[off++] = 'r';  break;
      case '\t': needed = 2; if (off + needed >= out_cap) return -1;
                 out[off++] = '\\'; out[off++] = 't';  break;
      default:
        if (c < 0x20) {
          // Control byte: emit \u00XX (6 chars)
          needed = 6;
          if (off + needed >= out_cap) return -1;
          out[off++] = '\\';
          out[off++] = 'u';
          out[off++] = '0';
          out[off++] = '0';
          out[off++] = (char)("0123456789abcdef"[(c >> 4) & 0x0F]);
          out[off++] = (char)("0123456789abcdef"[c & 0x0F]);
        } else {
          if (off + 1 >= out_cap) return -1;
          out[off++] = (char)c;
        }
        break;
    }
  }
  // Closing quote + NUL
  if (off + 1 >= out_cap) return -1;
  out[off++] = '"';
  out[off] = 0;
  return (int)off;
}

// CORRECTION04: decode one hex digit. Returns -1 on non-hex.
static int hex_value(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

// CORRECTION04: encode a Unicode codepoint as 1-4 UTF-8 bytes into
// out[*off]. Advances *off by the number of bytes written. Returns 0
// on success or -1 if the codepoint is out of range or out would
// overflow.
//
// Range policy:
//   cp < 0x80          -> 1 byte
//   cp < 0x800         -> 2 bytes
//   cp < 0x10000       -> 3 bytes  (BMP; rejects surrogates 0xD800-0xDFFF)
//   cp < 0x110000      -> 4 bytes  (supplementary plane)
//   cp >= 0x110000     -> reject
//
// Surrogates (0xD800–0xDFFF) are NOT valid scalar values per RFC 8259
// §7 and are rejected here. Surrogate PAIRS are decoded by the caller
// into a supplementary-plane codepoint BEFORE calling this function.
static int utf8_encode(char *out, size_t out_cap, size_t *off, unsigned long cp) {
  if (cp >= 0x110000UL) return -1;
  if (cp >= 0xD800UL && cp <= 0xDFFFUL) return -1; // surrogate
  if (cp < 0x80UL) {
    if (*off + 1 >= out_cap) return -1;
    out[(*off)++] = (char)cp;
  } else if (cp < 0x800UL) {
    if (*off + 2 >= out_cap) return -1;
    out[(*off)++] = (char)(0xC0 | (cp >> 6));
    out[(*off)++] = (char)(0x80 | (cp & 0x3F));
  } else if (cp < 0x10000UL) {
    if (*off + 3 >= out_cap) return -1;
    out[(*off)++] = (char)(0xE0 | (cp >> 12));
    out[(*off)++] = (char)(0x80 | ((cp >> 6) & 0x3F));
    out[(*off)++] = (char)(0x80 | (cp & 0x3F));
  } else {
    if (*off + 4 >= out_cap) return -1;
    out[(*off)++] = (char)(0xF0 | (cp >> 18));
    out[(*off)++] = (char)(0x80 | ((cp >> 12) & 0x3F));
    out[(*off)++] = (char)(0x80 | ((cp >> 6) & 0x3F));
    out[(*off)++] = (char)(0x80 | (cp & 0x3F));
  }
  return 0;
}

// Parse a quoted JSON string into out, returning the decoded byte length
// in *out_len (caller must initialize *out_len to 0). Returns advanced
// pointer on success or NULL on bad escape / unterminated.
//
// CORRECTION04: now decodes RFC 8259 §7 short escapes PLUS the
// \uXXXX Unicode escape (with surrogate-pair handling). Decoded
// Unicode codepoints are re-encoded into out as UTF-8.
//
// CORRECTION05: the decoded buffer is LENGTH-AWARE. Embedded 0x00
// bytes (from \u0000) survive the round trip because out_len tracks
// the semantic length and consumers iterate by len, not by strlen.
// The out buffer is still NUL-terminated as a defensive fallback (so
// legacy strcmp() on the buffer would not run past val_len into
// uninitialised memory), but the byte at out[*out_len] is a sentinel
// and MUST NOT be considered part of the semantic value.
//
// Out-of-range codepoints, lone surrogates, and malformed \uXXXX
// (non-hex digits, < 4 hex digits, stray \u followed by something
// other than 4 hex digits) are rejected — the parser returns NULL
// and the envelope parser converts that to BAD_JSON. That is the
// fail-closed invariant.
static const char *parse_string(const char *p, char *out, size_t out_cap, size_t *out_len) {
  if (out_len) *out_len = 0;
  size_t off = 0;
  if (*p != '"') return NULL;
  p++;
  while (*p && *p != '"') {
    if (*p == '\\') {
      if (!p[1]) return NULL;
      if (p[1] == 'u') {
        // CORRECTION04: \uXXXX Unicode escape.
        // Read exactly 4 hex digits, decode to codepoint, then
        // optionally consume a low surrogate if this was a high
        // surrogate.
        if (!p[2] || !p[3] || !p[4] || !p[5]) return NULL; // need 4 hex digits
        int h0 = hex_value(p[2]);
        int h1 = hex_value(p[3]);
        int h2 = hex_value(p[4]);
        int h3 = hex_value(p[5]);
        if (h0 < 0 || h1 < 0 || h2 < 0 || h3 < 0) return NULL; // non-hex
        unsigned long cp = ((unsigned long)h0 << 12) |
                           ((unsigned long)h1 <<  8) |
                           ((unsigned long)h2 <<  4) |
                           ((unsigned long)h3      );
        p += 6;
        // Surrogate-pair handling per RFC 8259 §7.
        if (cp >= 0xD800UL && cp <= 0xDBFFUL) {
          // High surrogate: must be followed by \uXXXX low surrogate.
          if (p[0] != '\\' || p[1] != 'u') return NULL;
          if (!p[2] || !p[3] || !p[4] || !p[5]) return NULL;
          int l0 = hex_value(p[2]);
          int l1 = hex_value(p[3]);
          int l2 = hex_value(p[4]);
          int l3 = hex_value(p[5]);
          if (l0 < 0 || l1 < 0 || l2 < 0 || l3 < 0) return NULL;
          unsigned long lo = ((unsigned long)l0 << 12) |
                             ((unsigned long)l1 <<  8) |
                             ((unsigned long)l2 <<  4) |
                             ((unsigned long)l3      );
          if (lo < 0xDC00UL || lo > 0xDFFFUL) return NULL; // not a low surrogate
          cp = 0x10000UL + (((cp - 0xD800UL) << 10) | (lo - 0xDC00UL));
          p += 6;
        } else if (cp >= 0xDC00UL && cp <= 0xDFFFUL) {
          // Lone low surrogate: reject.
          return NULL;
        }
        if (utf8_encode(out, out_cap, &off, cp) < 0) return NULL;
        continue;
      }
      char esc;
      switch (p[1]) {
        case '"': esc = '"'; break;
        case '\\': esc = '\\'; break;
        case '/': esc = '/'; break;
        case 'n': esc = '\n'; break;
        case 't': esc = '\t'; break;
        case 'r': esc = '\r'; break;
        case 'b': esc = '\b'; break;
        case 'f': esc = '\f'; break;
        default: return NULL; // unknown escape
      }
      if (off + 1 >= out_cap) return NULL;
      out[off++] = esc;
      p += 2;
    } else {
      if (off + 1 >= out_cap) return NULL;
      out[off++] = *p++;
    }
  }
  if (*p != '"') return NULL;
  // CORRECTION05: set the semantic length and place the trailing NUL
  // sentinel at the byte AFTER the semantic value. out_len is the
  // truth; the NUL is a defensive sentinel only.
  if (out_len) *out_len = off;
  if (off + 1 < out_cap) out[off] = 0;
  return p + 1;
}

// Parse a JSON number literal. Stores text in out and returns the byte
// count in *out_len. JSON numbers cannot contain NUL bytes, but the
// helper still records the length for symmetry with parse_string and
// for use in length-aware comparisons downstream.
static const char *parse_number(const char *p, char *out, size_t out_cap, size_t *out_len) {
  size_t off = 0;
  if (out_len) *out_len = 0;
  if (*p != '-' && !isdigit((unsigned char)*p)) return NULL;
  while (*p && (*p == '-' || *p == '+' || *p == '.' || *p == 'e' || *p == 'E' || isdigit((unsigned char)*p))) {
    if (off + 1 >= out_cap) return NULL;
    out[off++] = *p++;
  }
  if (out_len) *out_len = off;
  out[off] = 0;
  return p;
}

// Strict envelope parser: only flat string/number values.
// Rejects nested objects/arrays (FORBIDDEN_SHAPE).
// Returns NULL on success or static error string.
static int is_forbidden_key(const char *k);
static int is_recognized_key(const char *k);
static const char *parse_envelope(const char *json, kv_t *kvs, size_t *nkvs) {
  *nkvs = 0;
  const char *p = skip_ws(json);
  if (*p != '{') return "BAD_JSON";
  p = skip_ws(p + 1);
  if (*p == '}') return NULL; // empty object
  while (1) {
    p = skip_ws(p);
    if (*p != '"') return "BAD_JSON";
    char key[MAX_KEY_LEN];
    // CORRECTION05: keys are matched with strcmp() against a small
    // literal list (see is_recognized_key / is_forbidden_key). RFC 8259
    // permits \u0000 in any JSON string, but keys in our envelope come
    // from a fixed small set that does NOT contain NUL bytes, so
    // strcmp-on-NUL-terminated-buffer is the correct primitive here.
    // We discard key_len and rely on the parse_string-side NUL sentinel
    // at key[key_len]. The structural anti-shell invariant lives in the
    // key matching, not the value matching.
    size_t key_len = 0;
    p = parse_string(p, key, sizeof(key), &key_len);
    if (!p) return "BAD_JSON";
    p = skip_ws(p);
    if (*p != ':') return "BAD_JSON";
    p = skip_ws(p + 1);
    // Structural anti-shell: reject forbidden OR unrecognized keys BEFORE
    // parsing the value. This is the load-bearing anti-shell invariant —
    // see ACT §5 "structural anti-shell" and §13 forbidden-keys list.
    if (is_forbidden_key(key)) return "FORBIDDEN_KEY";
    if (!is_recognized_key(key)) return "FORBIDDEN_KEY";
    if (*p == '"') {
      if (*nkvs >= MAX_KEYS) return "BAD_JSON";
      kv_t *kv = &kvs[(*nkvs)++];
      strncpy(kv->key, key, MAX_KEY_LEN - 1);
      kv->key[MAX_KEY_LEN - 1] = 0;
      kv->kind = V_STR;
      // CORRECTION05: capture val_len so embedded 0x00 bytes survive.
      kv->val_len = 0;
      p = parse_string(p, kv->val, sizeof(kv->val), &kv->val_len);
      if (!p) return "BAD_JSON";
    } else if (*p == '-' || isdigit((unsigned char)*p)) {
      if (*nkvs >= MAX_KEYS) return "BAD_JSON";
      kv_t *kv = &kvs[(*nkvs)++];
      strncpy(kv->key, key, MAX_KEY_LEN - 1);
      kv->key[MAX_KEY_LEN - 1] = 0;
      kv->kind = V_NUM;
      // Numbers: parse_number is length-aware too. JSON numbers cannot
      // contain NUL, but the helper still records val_len for symmetry.
      size_t vlen = 0;
      p = parse_number(p, kv->val, sizeof(kv->val), &vlen);
      if (!p) return "BAD_JSON";
      kv->val_len = vlen;
    } else {
      return "FORBIDDEN_SHAPE"; // nested objects/arrays rejected at the wire level
    }
    p = skip_ws(p);
    if (*p == ',') { p++; continue; }
    if (*p == '}') return NULL;
    return "BAD_JSON";
  }
}

static int is_forbidden_key(const char *k) {
  static const char *F[] = {
    "command","argv","shell","exec","script","spawn","cmd","cmdline","path","file", NULL
  };
  for (int i = 0; F[i]; i++) if (strcmp(k, F[i]) == 0) return 1;
  return 0;
}

static int is_recognized_key(const char *k) {
  // PROBE01 + ACT-CLINEMM-HOST-HELPER-OWNED-PGID-TERMINATION01:
  // recognized-key list is the UNION of all method-specific legal keys.
  // Anti-shell invariant: any key NOT in this union fails closed at
  // the parser layer BEFORE value parsing.
  static const char *R[] = {
    // ACT-01 (health envelope):
    "version", "request_id", "method",
    // PROBE01 (testbed.run-installed-vsix-smoke envelope):
    "subject_head", "vsix_path", "vsix_sha256",
    // ACT-CLINEMM-HOST-HELPER-OWNED-PGID-TERMINATION01:
    // opaque capability tokens (hex strings), unsigned numeric pgid.
    // `pgid` is the ONLY caller-supplied identifier that influences
    // authority decisions, and only as a numeric claim verified by
    // ownership checks against the kernel-authenticated peer identity
    // (see handle_register_owned). Caller-supplied signals, pids, or
    // paths remain FORBIDDEN_KEY.
    "client_token", "job_token", "pgid",
    NULL
  };
  for (int i = 0; R[i]; i++) if (strcmp(k, R[i]) == 0) return 1;
  return 0;
}

// PROBE01: structural validators for the testbed method's fields.
// These reject shapes the JSON parser already accepts but that the
// runner must NOT see. Returning 0 means INVALID.
static int is_hex_string(const char *s, size_t n) {
  if (n == 0) return 0;
  for (size_t i = 0; i < n; i++) {
    char c = s[i];
    if (!((c >= '0' && c <= '9') ||
          (c >= 'a' && c <= 'f') ||
          (c >= 'A' && c <= 'F'))) return 0;
  }
  return 1;
}

// PROBE01: vsix_path structural validator. Rejects:
//   - empty
//   - not starting with '/'
//   - containing NUL (defense; parse_string already strips it)
//   - longer than MAX_VSIX_PATH_LEN
//   - containing '..' as a path component (anti-traversal)
//   - not ending with ".vsix"
// Does NOT touch the filesystem; realpath/owner check lives in the runner.
static int is_valid_vsix_path_shape(const char *s, size_t n) {
  if (n == 0) return 0;
  if (n > MAX_VSIX_PATH_LEN) return 0;
  if (s[0] != '/') return 0;
  // Reject '..' components.
  size_t i = 0;
  while (i < n) {
    if (s[i] == '.') {
      size_t j = i + 1;
      if (j < n && s[j] == '.') {
        // Ensure it's a full component: preceded by '/' or start,
        // followed by '/' or end.
        int start_ok = (i == 0 || s[i - 1] == '/');
        size_t k = j + 1;
        int end_ok = (k == n || s[k] == '/');
        if (start_ok && end_ok) return 0;
      }
    }
    i++;
  }
  // Require .vsix suffix.
  if (n < 5) return 0;
  if (s[n - 5] != '.' || s[n - 4] != 'v' || s[n - 3] != 's' ||
      s[n - 2] != 'i' || s[n - 1] != 'x') return 0;
  return 1;
}

static const kv_t *find_kv(const kv_t *kvs, size_t nkvs, const char *key) {
  for (size_t i = 0; i < nkvs; i++) if (strcmp(kvs[i].key, key) == 0) return &kvs[i];
  return NULL;
}

static void respond_err(int cfd, const char *code) {
  char buf[128];
  int n = snprintf(buf, sizeof(buf), "{\"ok\":false,\"error\":\"%s\"}\n", code);
  if (n > 0) (void)write_all(cfd, buf, (size_t)n);
}

static void respond_ok(int cfd, const void *request_id, size_t request_id_len) {
  // CORRECTION02: echo request_id UNCHANGED so the client can correlate
  // the response with the originating request.
  //
  // CORRECTION03: route the request_id through write_json_string() so
  // that JSON-special bytes (", \, control) are escaped on output.
  // Without this, an input like {"request_id":"a\"b","method":"health"}
  // is parsed into semantic a"b and then emitted as:
  //     {"request_id":"a"b",...}
  // which is invalid JSON and the client's JSON.parse rejects it as a
  // malformed response (failing correlation). The frozen wire contract
  // (protocol.ts buildOkResponse) treats request_id as an opaque
  // non-empty string; escaping is the smaller and correct repair.
  //
  // CORRECTION05: request_id and request_id_len are now LENGTH-AWARE.
  // The C representation is no longer a NUL-terminated string at the
  // consume site — embedded 0x00 bytes from "\u0000" survive the round
  // trip because write_json_string iterates by index, not by *p.
  // We pass (request_id, request_id_len) into the emitter, which
  // produces the JSON-escaped representation. Embedded 0x00 bytes
  // become "\u0000" on the wire, so a downstream JSON.parse recovers
  // the original NUL.
  //
  // We assemble the response in a stack buffer and ship it with one
  // write_all call so the client sees a single frame (no partial
  // fragment between header and id). The response frame is bounded by
  // MAX_FRAME (4096 bytes) so the helper can never send a frame larger
  // than the client's read budget.
  char buf[MAX_FRAME];
  size_t off = 0;
  // Header up to (but not including) the request_id value
  int hdr = snprintf(buf + off, sizeof(buf) - off,
    "{\"version\":1,\"request_id\":");
  if (hdr <= 0 || (size_t)hdr >= sizeof(buf) - off) goto trunc;
  off += (size_t)hdr;
  // JSON-escaped request_id (including surrounding quotes)
  int idn = write_json_string(buf + off, sizeof(buf) - off, request_id, request_id_len);
  if (idn < 0) goto trunc;
  off += (size_t)idn;
  // Tail: ok/service/pid/uid + build_id + active counts. The
  // build_id and counts are ACT-CLINEMM-HOST-HELPER-OWNED-PGID-
  // TERMINATION01 additions so the operator can prove the NEW
  // generation started (build_id drift) and that capability
  // state is what was expected.
  int tail = snprintf(buf + off, sizeof(buf) - off,
    ",\"ok\":true,\"service\":\"clinemm-host-helper\",\"pid\":%d,\"uid\":%d,"
    "\"build_id\":\"%s\",\"active_client_count\":%d,\"active_job_count\":%d}\n",
    (int)getpid(), (int)getuid(),
    g_build_id ? g_build_id : "uninitialized",
    count_active_clients(), count_active_jobs());
  if (tail <= 0 || (size_t)tail >= sizeof(buf) - off) goto trunc;
  off += (size_t)tail;
  (void)write_all(cfd, buf, off);
  return;
trunc:
  respond_err(cfd, "INTERNAL_TRUNCATION");
}

// =============================================================================
// PROBE01: testbed method dispatch
// =============================================================================
//
// Validates the testbed method's required fields (subject_head,
// vsix_path, vsix_sha256) and then execve()s ONE fixed runner with a
// FIXED argv[]. No shell, no env map from the request.
//
// The runner path is determined EXACTLY ONCE at helper compile time
// via the env var CLINEMM_TESTBED_RUNNER and a build-time default of
// "$HOME/.clinemm/libexec/clinemm-vsix-testbed-probe". The C helper
// does NOT accept a runner path from the request.
//
// The runner's stdout (one LF-terminated JSON frame, bounded by
// MAX_FRAME) is captured and forwarded to the client with the
// {"version":1,"request_id":...,"ok":true,"result":...} envelope.
// =============================================================================

// Total wallclock budget for the testbed runner subprocess.
// Must be ≥ TOTAL_PHASE_BUDGET_SECONDS in
// tools/macos-vsix-testbed/runner.ts (currently 20+10+5+5+3=43
// phase minutes + 1 minute margin = 44 minutes). We use 46
// minutes (2760s) for a small additional safety margin.
//
// The CLINEMM_TESTBED_TIMEOUT_SECONDS environment variable
// overrides this for testing only. Production callers must NOT
// set it; the helper will warn on stderr if the override is
// non-default. The override exists so unit tests can exercise
// the bounded-lifecycle path without sleeping 46 minutes.
#define RUNNER_TIMEOUT_SECONDS_DEFAULT 2760

static void respond_testbed_ok(int cfd, const void *request_id, size_t request_id_len,
                                const char *runner_stdout, size_t runner_stdout_len);
static void respond_testbed_err(int cfd, const void *request_id, size_t request_id_len,
                                const char *code);

static const char *resolve_runner_path(void) {
  static char buf[1024];
  const char *env = getenv("CLINEMM_TESTBED_RUNNER");
  if (env && *env) {
    snprintf(buf, sizeof(buf), "%s", env);
    return buf;
  }
  const char *home = getenv("HOME");
  if (!home || !*home) home = "/tmp";
  snprintf(buf, sizeof(buf), "%s/.clinemm/libexec/clinemm-vsix-testbed-probe", home);
  return buf;
}

// Test-only timeout override: when CLINEMM_TESTBED_TIMEOUT_SECONDS
// is set to a positive integer, that integer is used as the
// runner deadline instead of RUNNER_TIMEOUT_SECONDS_DEFAULT. The
// helper writes a one-line warning to stderr when the override
// fires so production traces show the deviation.
static int runner_timeout_seconds(void) {
  const char *env = getenv("CLINEMM_TESTBED_TIMEOUT_SECONDS");
  if (env && *env) {
    char *end = NULL;
    long v = strtol(env, &end, 10);
    if (end && *end == 0 && v > 0 && v < RUNNER_TIMEOUT_SECONDS_DEFAULT) {
      fprintf(stderr,
              "[helper] WARNING: CLINEMM_TESTBED_TIMEOUT_SECONDS=%ld "
              "overrides default %d (test-only override)\n",
              v, RUNNER_TIMEOUT_SECONDS_DEFAULT);
      return (int)v;
    }
  }
  return RUNNER_TIMEOUT_SECONDS_DEFAULT;
}

static int validate_testbed_fields(const kv_t *kvs, size_t nkvs,
                                    const char **err_out) {
  const kv_t *head = find_kv(kvs, nkvs, "subject_head");
  const kv_t *path = find_kv(kvs, nkvs, "vsix_path");
  const kv_t *sha  = find_kv(kvs, nkvs, "vsix_sha256");
  if (!head || !path || !sha) { *err_out = "BAD_REQUEST"; return 0; }
  if (head->kind != V_STR || head->val_len != 40 || !is_hex_string(head->val, head->val_len)) {
    *err_out = "BAD_REQUEST"; return 0;
  }
  if (sha->kind != V_STR || sha->val_len != 64 || !is_hex_string(sha->val, sha->val_len)) {
    *err_out = "BAD_REQUEST"; return 0;
  }
  if (path->kind != V_STR || !is_valid_vsix_path_shape(path->val, path->val_len)) {
    *err_out = "BAD_REQUEST"; return 0;
  }
  for (size_t i = 0; i < path->val_len; i++) {
    if (path->val[i] == 0) { *err_out = "BAD_REQUEST"; return 0; }
  }
  *err_out = NULL;
  return 1;
}

// PROBE01: build argv for the runner. argv[] is fixed at 5 fields +
// NULL. No field comes from a shell-evaluated string.
static int build_runner_argv(char **argv,
                              const char *runner_path,
                              const void *request_id, size_t request_id_len,
                              const kv_t *head, const kv_t *path, const kv_t *sha,
                              char *rid_buf, char *head_buf, char *sha_buf, char *path_buf) {
  if (request_id_len >= 1024) return -1;
  memcpy(rid_buf, request_id, request_id_len);
  rid_buf[request_id_len] = 0;
  for (size_t i = 0; i < 40; i++) {
    char c = head->val[i];
    if (c >= 'A' && c <= 'F') c = c - 'A' + 'a';
    head_buf[i] = c;
  }
  head_buf[40] = 0;
  for (size_t i = 0; i < 64; i++) {
    char c = sha->val[i];
    if (c >= 'A' && c <= 'F') c = c - 'A' + 'a';
    sha_buf[i] = c;
  }
  sha_buf[64] = 0;
  memcpy(path_buf, path->val, path->val_len);
  path_buf[path->val_len] = 0;
  argv[0] = (char *)runner_path;
  argv[1] = rid_buf;
  argv[2] = head_buf;
  argv[3] = path_buf;
  argv[4] = sha_buf;
  argv[5] = NULL;
  return 0;
}

// PROBE01 CORRECTION01: bounded, deadline-aware drain of child
// stdout. We poll(2) the read end with a timeout derived from a
// wallclock deadline so a child that never closes its stdout
// (e.g. tart clone stuck retrying) cannot wedge the helper past
// the deadline. On timeout we return the partial buffer + a
// flag indicating EOF was NOT reached; the caller is then
// responsible for SIGKILLing the child and reporting TIMEOUT.
typedef struct {
  ssize_t len;     // bytes drained into out
  int     eof;     // 1 if child closed the pipe (read==0)
  int     timeout; // 1 if we hit the deadline
} drain_result_t;

static drain_result_t drain_with_deadline(int fd, char *out, size_t cap,
                                          struct timespec deadline) {
  drain_result_t r = {0, 0, 0};
  struct timespec now;
  while (r.len < (ssize_t)cap) {
    clock_gettime(CLOCK_MONOTONIC, &now);
    if (now.tv_sec > deadline.tv_sec ||
        (now.tv_sec == deadline.tv_sec && now.tv_nsec >= deadline.tv_nsec)) {
      r.timeout = 1;
      return r;
    }
    // ms remaining before deadline
    long ms_left = (deadline.tv_sec - now.tv_sec) * 1000L
                 + (deadline.tv_nsec - now.tv_nsec) / 1000000L;
    if (ms_left < 0) ms_left = 0;
    if (ms_left > 500) ms_left = 500; // poll slice cap
    struct pollfd pfd = { .fd = fd, .events = POLLIN };
    int pr = poll(&pfd, 1, (int)ms_left);
    if (pr < 0) {
      if (errno == EINTR) continue;
      return r; // give up; treat as soft EOF
    }
    if (pr == 0) {
      // poll timed out within slice; loop back to check deadline
      continue;
    }
    if (pfd.revents & (POLLERR | POLLHUP | POLLNVAL)) {
      // peer hung up: drain any final bytes then return EOF
      r.eof = 1;
      while (r.len < (ssize_t)cap) {
        ssize_t got = read(fd, out + r.len, cap - (size_t)r.len);
        if (got < 0) { if (errno == EINTR) continue; break; }
        if (got == 0) break;
        r.len += got;
      }
      return r;
    }
    if (!(pfd.revents & POLLIN)) continue;
    ssize_t got = read(fd, out + r.len, cap - (size_t)r.len);
    if (got < 0) {
      if (errno == EINTR) continue;
      return r;
    }
    if (got == 0) { r.eof = 1; return r; }
    r.len += got;
  }
  r.eof = 0; // filled cap without EOF
  return r;
}

static void handle_testbed_run(int cfd, const kv_t *rid, const kv_t *kvs, size_t nkvs) {
  const char *verr = NULL;
  if (!validate_testbed_fields(kvs, nkvs, &verr)) {
    respond_testbed_err(cfd, rid->val, rid->val_len, "BAD_REQUEST");
    return;
  }
  const kv_t *head = find_kv(kvs, nkvs, "subject_head");
  const kv_t *path = find_kv(kvs, nkvs, "vsix_path");
  const kv_t *sha  = find_kv(kvs, nkvs, "vsix_sha256");
  (void)verr;

  const char *runner_path = resolve_runner_path();

  struct stat rst;
  if (stat(runner_path, &rst) != 0) {
    fprintf(stderr, "[helper] testbed runner not found: %s errno=%d\n", runner_path, errno);
    respond_testbed_err(cfd, rid->val, rid->val_len, "RUNNER_NOT_FOUND");
    return;
  }
  if (access(runner_path, X_OK) != 0) {
    fprintf(stderr, "[helper] testbed runner not executable: %s errno=%d\n", runner_path, errno);
    respond_testbed_err(cfd, rid->val, rid->val_len, "RUNNER_NOT_EXECUTABLE");
    return;
  }

  int pipefd[2];
  if (pipe(pipefd) != 0) {
    respond_testbed_err(cfd, rid->val, rid->val_len, "INTERNAL_ERROR");
    return;
  }
  int errfd[2];
  if (pipe(errfd) != 0) {
    close(pipefd[0]); close(pipefd[1]);
    respond_testbed_err(cfd, rid->val, rid->val_len, "INTERNAL_ERROR");
    return;
  }

  pid_t pid = fork();
  if (pid < 0) {
    close(pipefd[0]); close(pipefd[1]); close(errfd[0]); close(errfd[1]);
    respond_testbed_err(cfd, rid->val, rid->val_len, "INTERNAL_ERROR");
    return;
  }
  if (pid == 0) {
    close(pipefd[0]);
    close(errfd[0]);
    dup2(pipefd[1], STDOUT_FILENO);
    dup2(errfd[1], STDERR_FILENO);
    close(pipefd[1]);
    close(errfd[1]);
    // Start a new process group so the parent can signal the
    // whole subtree (kill(-pid, SIGKILL)) without killing
    // itself. On macOS Background sessions the per-process
    // kill() returns EPERM even for our own children; signaling
    // the group via -pid routes through the session.
    if (setpgid(0, 0) < 0 && errno != EACCES && errno != EPERM) {
      // EACCES/EPERM mean we are already a group leader;
      // anything else is fatal.
      _exit(125);
    }
    char *argv[6];
    static char rid_buf[1024];
    static char head_buf[41];
    static char sha_buf[65];
    static char path_buf[MAX_VSIX_PATH_LEN + 1];
    if (build_runner_argv(argv, runner_path, rid->val, rid->val_len, head, path, sha,
                          rid_buf, head_buf, sha_buf, path_buf) != 0) {
      fprintf(stderr, "argv build failed\n");
      _exit(127);
    }
    const char *home = getenv("HOME");
    if (!home || !*home) home = "/tmp";
    char home_env[2048];
    snprintf(home_env, sizeof(home_env), "HOME=%s", home);
    char *const envp[] = {
      (char *)"CLINEMM_TESTBED_RUNNER=1",
      (char *)"PATH=/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin",
      home_env,
      NULL
    };
    execve(runner_path, argv, envp);
    fprintf(stderr, "execve(%s) failed errno=%d\n", runner_path, errno);
    _exit(126);
  }
  // Parent: also set the child's pgrp (race-safe; the child
  // already called setpgid, so this is idempotent and avoids
  // the case where we win the race and signal a child that's
  // still in our group).
  (void)setpgid(pid, pid);

  close(pipefd[1]);
  close(errfd[1]);

  // CORRECTION01: deadline covers the WHOLE child lifetime,
  // including pipe drain. We poll(2) the read ends with the
  // remaining time before the wallclock deadline. If the child
  // never closes stdout and keeps writing past the deadline, we
  // SIGKILL it and return TIMEOUT.
  struct timespec deadline;
  clock_gettime(CLOCK_MONOTONIC, &deadline);
  deadline.tv_sec += runner_timeout_seconds();

  char out_buf[MAX_FRAME];
  drain_result_t dr = drain_with_deadline(pipefd[0], out_buf, sizeof(out_buf),
                                          deadline);
  close(pipefd[0]);
  char err_buf[1024];
  drain_result_t derr = drain_with_deadline(errfd[0], err_buf,
                                            sizeof(err_buf) - 1, deadline);
  close(errfd[0]);
  if (derr.len > 0) err_buf[derr.len] = 0;
  (void)err_buf; (void)derr;

  // If the pipe drain timed out OR the child is still alive,
  // SIGKILL it. We poll-waitpid in 100ms slices until either the
  // child exits or the deadline arrives.
  int status = 0;
  pid_t wr = 0;
  if (!dr.timeout) {
    // Drain finished within deadline (EOF or buffer full). Child
    // should be exiting soon; drain it.
    struct timespec now;
    while (1) {
      clock_gettime(CLOCK_MONOTONIC, &now);
      if (now.tv_sec > deadline.tv_sec ||
          (now.tv_sec == deadline.tv_sec && now.tv_nsec >= deadline.tv_nsec)) {
        dr.timeout = 1;
        break;
      }
      wr = waitpid(pid, &status, WNOHANG);
      if (wr == pid) break;
      if (wr < 0) break;
      struct timespec slice = deadline;
      long ns = (deadline.tv_nsec - now.tv_nsec);
      if (ns < 0) { slice.tv_sec -= 1; slice.tv_nsec += 1000000000L; ns += 1000000000L; }
      long ms_left = (slice.tv_sec - now.tv_sec) * 1000L + ns / 1000000L;
      if (ms_left > 100) ms_left = 100;
      if (ms_left < 0) ms_left = 0;
      usleep((useconds_t)(ms_left * 1000L));
    }
  }
  if (wr != pid) {
    // Either timeout or poll error: kill the child and reap.
    // We signal the entire process group (-pid) so descendants
    // and any grandchildren spawned before the exec are also
    // reaped. On macOS Background sessions, the per-process
    // kill() can return EPERM even for our own children;
    // kill(-pid, SIGKILL) goes through the session.
    int kr = kill(-pid, SIGKILL);
    if (kr < 0 && errno == ESRCH) {
      // Already gone: try the per-process kill as a fallback.
      kr = kill(pid, SIGKILL);
    }
    (void)kr;
    waitpid(pid, &status, 0);
    respond_testbed_err(cfd, rid->val, rid->val_len, "TIMEOUT");
    return;
  }

  if (!WIFEXITED(status) || WEXITSTATUS(status) != 0) {
    respond_testbed_err(cfd, rid->val, rid->val_len, "INTERNAL_ERROR");
    return;
  }
  if (dr.len <= 0) {
    respond_testbed_err(cfd, rid->val, rid->val_len, "INTERNAL_ERROR");
    return;
  }
  respond_testbed_ok(cfd, rid->val, rid->val_len, out_buf, (size_t)dr.len);
}

// =============================================================================
// ACT-CLINEMM-HOST-HELPER-OWNED-PGID-TERMINATION01
//
// Helper self-restart + owned-PGID termination extension. CONSERVES
// every prior helper invariant (AF_UNIX, 0600, launch_activate_socket,
// request_id correlation, JSON output escaping, Unicode decode,
// embedded NUL preservation, fail-closed launchd matrix,
// testbed.run-installed-vsix-smoke, anti-shell forbidden keys).
// =============================================================================

// Minimal SHA-256 (RFC 6234) — kept in this translation unit because
// helper.c must remain standalone and must not link libcrypto.
//
// Review-correction01: only compiled when CLINEMM_HELPER_BUILD_ID is
// NOT defined (i.e. the runtime-hash fallback path). The production
// build uses the build-time embedded build_id and does not need
// SHA-256 at runtime.
#ifndef CLINEMM_HELPER_BUILD_ID
typedef struct {
  uint32_t state[8];
  uint64_t bit_count;
  unsigned char buffer[64];
} SHA256_CTX;
static const uint32_t SHA256_K[64] = {
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
};
static inline uint32_t rotr32(uint32_t x, int n) {
  return (x >> n) | (x << (32 - n));
}
static void sha256_init(SHA256_CTX *c) {
  c->state[0] = 0x6a09e667; c->state[1] = 0xbb67ae85;
  c->state[2] = 0x3c6ef372; c->state[3] = 0xa54ff53a;
  c->state[4] = 0x510e527f; c->state[5] = 0x9b05688c;
  c->state[6] = 0x1f83d9ab; c->state[7] = 0x5be0cd19;
  c->bit_count = 0;
}
static void sha256_block(uint32_t state[8], const unsigned char block[64]) {
  uint32_t w[64];
  for (int i = 0; i < 16; i++) {
    w[i] = ((uint32_t)block[i*4] << 24) | ((uint32_t)block[i*4+1] << 16) |
           ((uint32_t)block[i*4+2] << 8) | ((uint32_t)block[i*4+3]);
  }
  for (int i = 16; i < 64; i++) {
    uint32_t s0 = rotr32(w[i-15], 7) ^ rotr32(w[i-15], 18) ^ (w[i-15] >> 3);
    uint32_t s1 = rotr32(w[i-2], 17) ^ rotr32(w[i-2], 19) ^ (w[i-2] >> 10);
    w[i] = w[i-16] + s0 + w[i-7] + s1;
  }
  uint32_t a=state[0], b=state[1], c=state[2], d=state[3];
  uint32_t e=state[4], f=state[5], g=state[6], h=state[7];
  for (int i = 0; i < 64; i++) {
    uint32_t S1 = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25);
    uint32_t ch = (e & f) ^ (~e & g);
    uint32_t t1 = h + S1 + ch + SHA256_K[i] + w[i];
    uint32_t S0 = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22);
    uint32_t mj = (a & b) ^ (a & c) ^ (b & c);
    uint32_t t2 = S0 + mj;
    h = g; g = f; f = e; e = d + t1; d = c; c = b; b = a; a = t1 + t2;
  }
  state[0]+=a; state[1]+=b; state[2]+=c; state[3]+=d;
  state[4]+=e; state[5]+=f; state[6]+=g; state[7]+=h;
}
static void sha256_update(SHA256_CTX *c, const unsigned char *data, size_t len) {
  size_t fill = (size_t)((c->bit_count >> 3) & 63);
  c->bit_count += (uint64_t)len << 3;
  if (fill) {
    size_t need = 64 - fill;
    if (len < need) { memcpy(c->buffer + fill, data, len); return; }
    memcpy(c->buffer + fill, data, need);
    sha256_block(c->state, c->buffer);
    data += need; len -= need;
  }
  while (len >= 64) { sha256_block(c->state, data); data += 64; len -= 64; }
  if (len) memcpy(c->buffer, data, len);
}
static void sha256_final(SHA256_CTX *c, unsigned char out[32]) {
  size_t fill = (size_t)((c->bit_count >> 3) & 63);
  c->buffer[fill++] = 0x80;
  if (fill > 56) {
    while (fill < 64) c->buffer[fill++] = 0;
    sha256_block(c->state, c->buffer);
    fill = 0;
  }
  while (fill < 56) c->buffer[fill++] = 0;
  uint64_t bc = c->bit_count;
  for (int i = 7; i >= 0; i--) {
    c->buffer[56 + i] = (unsigned char)(bc & 0xff);
    bc >>= 8;
  }
  sha256_block(c->state, c->buffer);
  for (int i = 0; i < 8; i++) {
    out[i*4]   = (unsigned char)(c->state[i] >> 24);
    out[i*4+1] = (unsigned char)(c->state[i] >> 16);
    out[i*4+2] = (unsigned char)(c->state[i] >> 8);
    out[i*4+3] = (unsigned char)(c->state[i]);
  }
}
#endif /* CLINEMM_HELPER_BUILD_ID */

// -----------------------------------------------------------------------------
// BUILD_IDENTITY (Phase 0B + review-correction01):
//
// Reported by the `health` method so the operator can prove a NEW
// generation of the helper actually started.
//
// sha256(ABI_version + helper.c bytes) hex-encoded as 64 lowercase
// hex chars. The string is a SOURCE/BUILD identity, not a binary
// SHA — it changes when the source changes, which is the property
// we want for upgrade qualification.
//
// Review-correction01: the hash is now COMPUTED AT BUILD TIME and
// embedded via -DCLINEMM_HELPER_BUILD_ID. The runtime path is just
// "use the embedded string". This removes the runtime dependency
// on the helper.c source being readable at startup, which is the
// load-bearing invariant for atomic-replace A->B in production:
// the production binary lives at ~/.clinemm/bin/clinemm-host-helper
// (not in the repo tree) and must not need its own source.
//
// If CLINEMM_HELPER_BUILD_ID is NOT defined (developer built helper.c
// directly without build.sh), we fall back to the runtime-hash path.
// -----------------------------------------------------------------------------
#ifndef CLINEMM_HELPER_ABI_VERSION
#define CLINEMM_HELPER_ABI_VERSION "OWNED_PGID_TERMINATION_01"
#endif
static char g_build_id_buf[65];

#ifdef CLINEMM_HELPER_BUILD_ID
// Build-time embedded identity. Use as-is.
static const char *hex_sha256_of_self_source(void) {
  const char *embedded = CLINEMM_HELPER_BUILD_ID;
  size_t n = strlen(embedded);
  if (n >= sizeof(g_build_id_buf)) n = sizeof(g_build_id_buf) - 1;
  memcpy(g_build_id_buf, embedded, n);
  g_build_id_buf[n] = 0;
  return g_build_id_buf;
}
#else
// Legacy fallback: read helper.c at runtime. Used by tests that pass
// CLINEMM_HELPER_SRC to bypass the build-time embed.
static const char *hex_sha256_of_self_source(void) {
  const char *src = getenv("CLINEMM_HELPER_SRC");
  if (!src || !*src) src = "tools/macos-host-helper/native/helper.c";
  FILE *f = fopen(src, "rb");
  if (!f) {
    snprintf(g_build_id_buf, sizeof(g_build_id_buf),
             "abi:%s.fallback", CLINEMM_HELPER_ABI_VERSION);
    return g_build_id_buf;
  }
  unsigned char hash[32];
  SHA256_CTX ctx;
  sha256_init(&ctx);
  sha256_update(&ctx, (const unsigned char *)CLINEMM_HELPER_ABI_VERSION,
                strlen(CLINEMM_HELPER_ABI_VERSION));
  unsigned char buf[8192];
  size_t n;
  while ((n = fread(buf, 1, sizeof(buf), f)) > 0) {
    sha256_update(&ctx, buf, n);
  }
  fclose(f);
  sha256_final(&ctx, hash);
  for (int i = 0; i < 32; i++) {
    snprintf(g_build_id_buf + (i * 2), 3, "%02x", hash[i]);
  }
  g_build_id_buf[64] = 0;
  return g_build_id_buf;
}
#endif

// -----------------------------------------------------------------------------
// CAPABILITY STORE (Phase 2): one helper serves multiple Codium
// clients. Cross-client isolation is P0.
//
// client_token: 32 hex chars (>=128 bits from arc4random_buf),
//   helper-generated, memory-only, returned by client.open.
//   Bound at registration to a kernel-authenticated peer (UID + PID)
//   so a leaked token from another connection can never claim
//   authority on a different peer.
//
// job_token: 32 hex chars, returned by process-group.register-owned
//   alongside the stored PGID and leader identity (PID + start time).
// -----------------------------------------------------------------------------

#define CLINEMM_TOKEN_HEX_LEN 32
#define CLINEMM_MAX_CLIENTS  64
#define CLINEMM_MAX_JOBS     128

typedef struct {
  int used;
  char client_token[CLINEMM_TOKEN_HEX_LEN + 1];
  uid_t peer_uid;
  pid_t peer_pid;
} client_record_t;

// Strong identity check: both UID AND PID must match the recorded
// identity. This prevents two same-UID clients from impersonating
// each other across connections (the fundamental cross-client
// isolation requirement).
typedef struct {
  int ok;
  uid_t uid;
  gid_t gid;
  pid_t pid;
} peer_identity_t;
static int peer_matches(client_record_t *cl, const peer_identity_t *pi) {
  if (!pi->ok) return 0;
  if (pi->uid != cl->peer_uid) return 0;
  if (pi->pid != cl->peer_pid) return 0;
  return 1;
}

typedef struct {
  int used;
  int active;
  char job_token[CLINEMM_TOKEN_HEX_LEN + 1];
  char owner_client_token[CLINEMM_TOKEN_HEX_LEN + 1];
  pid_t pgid;
  pid_t leader_pid;
  uint64_t leader_start_us;
  // Review-correction01: PPID of the leader at registration time.
  // Used by future re-verification (e.g. if a leader re-execs and
  // inherits a new parent, the original PPID is recorded as the
  // ownership anchor). Currently informational — the registration
  // check itself enforces (peer_pid == leader_ppid) || (peer_pid == pgid).
  pid_t leader_ppid_at_register;
} job_record_t;

static client_record_t g_clients[CLINEMM_MAX_CLIENTS];
static job_record_t    g_jobs[CLINEMM_MAX_JOBS];

static void gen_token(char out[CLINEMM_TOKEN_HEX_LEN + 1]) {
  unsigned char raw[16];
  arc4random_buf(raw, sizeof(raw));
  static const char H[] = "0123456789abcdef";
  for (int i = 0; i < 16; i++) {
    out[i*2]   = H[(raw[i] >> 4) & 0x0F];
    out[i*2+1] = H[raw[i] & 0x0F];
  }
  out[32] = 0;
}

static client_record_t *find_client(const char *token) {
  if (!token || strlen(token) != CLINEMM_TOKEN_HEX_LEN) return NULL;
  for (int i = 0; i < CLINEMM_MAX_CLIENTS; i++) {
    if (g_clients[i].used && strcmp(g_clients[i].client_token, token) == 0)
      return &g_clients[i];
  }
  return NULL;
}
static job_record_t *find_job(const char *token) {
  if (!token || strlen(token) != CLINEMM_TOKEN_HEX_LEN) return NULL;
  for (int i = 0; i < CLINEMM_MAX_JOBS; i++) {
    if (g_jobs[i].used && strcmp(g_jobs[i].job_token, token) == 0)
      return &g_jobs[i];
  }
  return NULL;
}
static client_record_t *alloc_client_slot(void) {
  for (int i = 0; i < CLINEMM_MAX_CLIENTS; i++)
    if (!g_clients[i].used) return &g_clients[i];
  return NULL;
}
static job_record_t *alloc_job_slot(void) {
  for (int i = 0; i < CLINEMM_MAX_JOBS; i++)
    if (!g_jobs[i].used) return &g_jobs[i];
  return NULL;
}
static int count_active_clients(void) {
  int c = 0;
  for (int i = 0; i < CLINEMM_MAX_CLIENTS; i++) if (g_clients[i].used) c++;
  return c;
}
static int count_active_jobs(void) {
  int c = 0;
  for (int i = 0; i < CLINEMM_MAX_JOBS; i++)
    if (g_jobs[i].used && g_jobs[i].active) c++;
  return c;
}

// Review-correction02: slot reclamation. alloc_*_slot() only looks
// at `used`, so callers MUST clear `used` on terminal transitions
// (release-owned success, terminate-owned success, stale ownership
// detection). Without this, the helper could register at most
// CLINEMM_MAX_JOBS jobs (or CLINEMM_MAX_CLIENTS clients) over its
// ENTIRE lifetime, even after every slot's `active` flag had been
// cleared. We secure-zero the token bytes before setting `used=0`
// so a recycled slot cannot leak its prior token via heap reuse.
static void clear_job_slot(job_record_t *job) {
  if (!job) return;
  // secure-zero the token + identifier fields; the rest is metadata.
  memset(job->job_token, 0, sizeof(job->job_token));
  memset(job->owner_client_token, 0, sizeof(job->owner_client_token));
  job->pgid = 0;
  job->leader_pid = 0;
  job->leader_start_us = 0;
  job->leader_ppid_at_register = 0;
  job->active = 0;
  job->used = 0;
}

// Client reclamation: review-correction02. The same `used`-flag
// leakage exists for g_clients[]. A long-lived helper instance
// that survives many short-lived Codium sessions (each opens + closes
// without explicit logout) would exhaust the 64-slot client pool
// unless we reclaim on either an explicit close or a peer-mismatch
// observation. Production callers SHOULD send a "client.close"
// request when the Codium session ends; if they don't, the slot is
// reclaimed lazily on the next register attempt whose peer identity
// differs from the cached identity. We expose `clear_client_slot`
// here so the close + stale-detection paths share the same
// reclamation primitive.
static void clear_client_slot(client_record_t *cl) {
  if (!cl) return;
  memset(cl->client_token, 0, sizeof(cl->client_token));
  cl->peer_uid = (uid_t)-1;
  cl->peer_pid = 0;
  cl->used = 0;
}

// -----------------------------------------------------------------------------
// PEER IDENTITY (Phase 2):
//
// getpeereid() gives the kernel-authenticated UID/GID of the peer
// process across an AF_UNIX connection. LOCAL_PEERPID gives the
// peer PID for the ownership check. We use BOTH: getpeereid is
// documented as the reliable peer-cred source; LOCAL_PEERPID is
// the Apple-recommended peer-PID discovery (Chromium uses it on
// Apple platforms).
//
// Review-correction01 (HALT_PEER_PROCESS_IDENTITY_NOT_AVAILABLE):
// BOTH primitives are MANDATORY. If either fails, peer_identity
// returns pi.ok=0 and the caller refuses the request. There is NO
// PID-0 fallback: collapsing multiple same-UID clients onto
// (uid=501, pid=0) would defeat the cross-client isolation
// invariant because peer_matches() compares exact (uid, pid).
// -----------------------------------------------------------------------------

static peer_identity_t peer_identity(int cfd) {
  peer_identity_t pi = { 0, (uid_t)-1, (gid_t)-1, 0 };
  // getpeereid is mandatory.
  if (getpeereid(cfd, &pi.uid, &pi.gid) < 0) return pi;
  // LOCAL_PEERPID is mandatory. Without a kernel-derived peer PID
  // we cannot verify "the caller is the one that spawned this PG",
  // which is the load-bearing P0 invariant for ownership proof.
  pid_t ppid = 0;
  socklen_t sl = sizeof(ppid);
  if (getsockopt(cfd, SOL_LOCAL, LOCAL_PEERPID, &ppid, &sl) < 0) return pi;
  if (ppid <= 0) return pi;  // defensive: kernel returned 0/NULL PID
  pi.pid = ppid;
  pi.ok = 1;
  return pi;
}

// Read the kinfo_proc record for `pid`. Returns 1 on success and
// fills *start_us with the process start time in microseconds since
// epoch and *uid with the owning UID. This is the Darwin/libproc
// process-information seam used for PID reuse resistance AND
// ownership verification.
//
// Darwin exposes the start time as kp_proc.p_un.__p_starttime
// (a struct timeval). The owning UID is kp_eproc.e_ucred.cr_uid
// (the "real" UID, not the effective UID).
static int read_proc_identity(pid_t pid, uint64_t *start_us, uid_t *uid) {
  struct kinfo_proc info;
  size_t len = sizeof(info);
  int mib[4] = { CTL_KERN, KERN_PROC, KERN_PROC_PID, (int)pid };
  if (sysctl(mib, 4, &info, &len, NULL, 0) < 0) return 0;
  if (len == 0) return 0;
  struct timeval tv = info.kp_proc.p_un.__p_starttime;
  *start_us = (uint64_t)tv.tv_sec * 1000000ULL +
              (uint64_t)tv.tv_usec;
  *uid = info.kp_eproc.e_ucred.cr_uid;
  return 1;
}

// ACT-CLINEMM-HOST-HELPER-OWNED-PGID-TERMINATION01 (review-correction01):
// Extended variant that also returns the leader's parent PID. Used by
// handle_register_owned to prove the proposed PGID leader is the
// peer's child (or the peer itself) — the load-bearing "ownership
// proof" the kernel records in kp_eproc.e_ppid.
static int read_proc_identity_ext(pid_t pid, uint64_t *start_us,
                                   uid_t *uid, pid_t *ppid) {
  struct kinfo_proc info;
  size_t len = sizeof(info);
  int mib[4] = { CTL_KERN, KERN_PROC, KERN_PROC_PID, (int)pid };
  if (sysctl(mib, 4, &info, &len, NULL, 0) < 0) return 0;
  if (len == 0) return 0;
  struct timeval tv = info.kp_proc.p_un.__p_starttime;
  *start_us = (uint64_t)tv.tv_sec * 1000000ULL +
              (uint64_t)tv.tv_usec;
  *uid = info.kp_eproc.e_ucred.cr_uid;
  // e_ppid is the parent PID as recorded by the kernel. For a
  // detached:true spawn from a Node.js parent, this is the
  // parent process that called child_process.spawn(..., {detached:true}).
  *ppid = (pid_t)info.kp_eproc.e_ppid;
  return 1;
}

// Read the kinfo_proc record for `pid`. Returns 1 on success and
// fills *start_us with the process start time in microseconds since
// epoch. Wrapper for callers that only need the start time.
static int read_proc_start_us(pid_t pid, uint64_t *start_us) {
  uid_t ignored_uid;
  return read_proc_identity(pid, start_us, &ignored_uid);
}

// Validate ownership of a proposed (pgid, leader_pid) by the
// authenticated peer. The standard detached-spawn convention in
// spawnSupervisableShellCommand is leader_pid == pgid. We verify:
//
//   1. leader exists
//   2. leader's start_us matches the recorded value (PID reuse)
//   3. leader's actual pgid == proposed pgid
//
// Returns 1 on success, 0 on any failure (caller fails closed).
static int validate_pgid_ownership(pid_t proposed_pgid,
                                    pid_t leader_pid,
                                    uint64_t leader_start_us) {
  if (kill(leader_pid, 0) < 0 && errno == ESRCH) return 0;
  uint64_t start_us_now = 0;
  if (!read_proc_start_us(leader_pid, &start_us_now)) return 0;
  if (start_us_now != leader_start_us) return 0;
  pid_t actual_pgid = getpgid(leader_pid);
  if (actual_pgid < 0) return 0;
  if (actual_pgid != proposed_pgid) return 0;
  return 1;
}

// JSON helpers (caller owns buf + off; on overflow returns 0).
static int json_num(char *buf, size_t cap, size_t *off, const char *key, long n) {
  int w = snprintf(buf + *off, cap - *off, ",\"%s\":%ld", key, n);
  if (w <= 0 || (size_t)w >= cap - *off) return 0;
  *off += (size_t)w;
  return 1;
}
static int json_str(char *buf, size_t cap, size_t *off,
                    const char *key, const char *s, size_t s_len) {
  size_t cur = *off;
  int w = snprintf(buf + cur, cap - cur, ",\"%s\":", key);
  if (w <= 0 || (size_t)w >= cap - cur) return 0;
  cur += (size_t)w;
  int s_w = write_json_string(buf + cur, cap - cur, s, s_len);
  if (s_w < 0) return 0;
  cur += (size_t)s_w;
  *off = cur;
  return 1;
}

// -----------------------------------------------------------------------------
// METHOD HANDLERS (Phase 2 + Phase 3)
// -----------------------------------------------------------------------------

// Forward declaration so we can write the new handlers here.
static void handle_testbed_run(int cfd, const kv_t *rid, const kv_t *kvs, size_t nkvs);

// client.open: returns a fresh client_token bound to the
// kernel-authenticated peer (UID + PID). No caller-supplied
// identifier influences authority.
static void handle_client_open(int cfd, const kv_t *rid) {
  peer_identity_t pi = peer_identity(cfd);
  if (!pi.ok) {
    respond_err(cfd, "PEER_IDENTITY_UNAVAILABLE");
    return;
  }
  client_record_t *slot = alloc_client_slot();
  if (!slot) { respond_err(cfd, "CAPACITY"); return; }
  gen_token(slot->client_token);
  slot->used = 1;
  slot->peer_uid = pi.uid;
  slot->peer_pid = pi.pid;

  char buf[MAX_FRAME];
  size_t off = 0;
  int hdr = snprintf(buf + off, sizeof(buf) - off,
                     "{\"version\":1,\"request_id\":");
  if (hdr <= 0 || (size_t)hdr >= sizeof(buf) - off) goto trunc;
  off += (size_t)hdr;
  int idn = write_json_string(buf + off, sizeof(buf) - off, rid->val, rid->val_len);
  if (idn < 0) goto trunc;
  off += (size_t)idn;
  if (!json_str(buf, sizeof(buf), &off, "client_token",
                slot->client_token, CLINEMM_TOKEN_HEX_LEN)) goto trunc;
  if (!json_num(buf, sizeof(buf), &off, "peer_uid", (long)slot->peer_uid)) goto trunc;
  if (!json_num(buf, sizeof(buf), &off, "peer_pid", (long)slot->peer_pid)) goto trunc;
  int tail = snprintf(buf + off, sizeof(buf) - off, ",\"ok\":true}\n");
  if (tail <= 0 || (size_t)tail >= sizeof(buf) - off) goto trunc;
  off += (size_t)tail;
  (void)write_all(cfd, buf, off);
  return;
trunc:
  respond_err(cfd, "INTERNAL_TRUNCATION");
}

// Review-correction02: client.close explicitly reclaims the
// client slot. Without this, the 64-slot client pool would
// exhaust over a long-lived helper instance that survives many
// short-lived Codium sessions. The handler validates the
// client_token, authenticates the peer (so a stolen token from
// another connection cannot drop someone else's slot), then
// secure-zeros the slot and emits a CLOSED envelope.
static void handle_client_close(int cfd, const kv_t *rid, const kv_t *kvs, size_t nkvs) {
  const kv_t *ct_kv = find_kv(kvs, nkvs, "client_token");
  if (!ct_kv || ct_kv->kind != V_STR ||
      ct_kv->val_len != CLINEMM_TOKEN_HEX_LEN) {
    respond_err(cfd, "BAD_REQUEST");
    return;
  }
  client_record_t *cl = find_client(ct_kv->val);
  if (!cl) { respond_err(cfd, "DENY_UNKNOWN_CLIENT"); return; }
  peer_identity_t pi = peer_identity(cfd);
  if (!peer_matches(cl, &pi)) {
    respond_err(cfd, "DENY_PEER_MISMATCH");
    return;
  }
  clear_client_slot(cl);

  char buf[MAX_FRAME];
  size_t off = 0;
  int hdr = snprintf(buf + off, sizeof(buf) - off,
                     "{\"version\":1,\"request_id\":");
  if (hdr <= 0 || (size_t)hdr >= sizeof(buf) - off) goto trunc;
  off += (size_t)hdr;
  int idn = write_json_string(buf + off, sizeof(buf) - off,
                              rid->val, rid->val_len);
  if (idn < 0) goto trunc;
  off += (size_t)idn;
  int tail = snprintf(buf + off, sizeof(buf) - off,
                      ",\"ok\":true,\"result\":\"CLOSED\"}\n");
  if (tail <= 0 || (size_t)tail >= sizeof(buf) - off) goto trunc;
  off += (size_t)tail;
  (void)write_all(cfd, buf, off);
  return;
trunc:
  respond_err(cfd, "INTERNAL_TRUNCATION");
}

// process-group.register-owned: caller presents a client_token and a
// proposed pgid. The helper authenticates the peer against the
// recorded client identity, verifies the leader is alive + in the
// claimed PGID + has the recorded start time, and returns a fresh
// job_token.
static void handle_register_owned(int cfd, const kv_t *rid, const kv_t *kvs, size_t nkvs) {
  const kv_t *ct_kv = find_kv(kvs, nkvs, "client_token");
  const kv_t *pg_kv = find_kv(kvs, nkvs, "pgid");
  if (!ct_kv || !pg_kv) { respond_err(cfd, "BAD_REQUEST"); return; }
  if (ct_kv->kind != V_STR || ct_kv->val_len != CLINEMM_TOKEN_HEX_LEN) {
    respond_err(cfd, "BAD_REQUEST"); return;
  }
  if (pg_kv->kind != V_NUM) { respond_err(cfd, "BAD_REQUEST"); return; }
  char pgbuf[32];
  size_t pgbuf_len = pg_kv->val_len;
  if (pgbuf_len == 0 || pgbuf_len >= sizeof(pgbuf)) {
    respond_err(cfd, "BAD_REQUEST"); return;
  }
  memcpy(pgbuf, pg_kv->val, pgbuf_len);
  pgbuf[pgbuf_len] = 0;
  char *endp = NULL;
  unsigned long pgid_ul = strtoul(pgbuf, &endp, 10);
  if (!endp || *endp != 0 || pgid_ul == 0 || pgid_ul > (unsigned long)INT32_MAX) {
    respond_err(cfd, "BAD_REQUEST"); return;
  }
  pid_t proposed_pgid = (pid_t)pgid_ul;

  client_record_t *cl = find_client(ct_kv->val);
  if (!cl) { respond_err(cfd, "DENY_UNKNOWN_CLIENT"); return; }

  // Anti-theft: peer identity on THIS connection must match the
  // recorded identity (both UID AND PID). A leaked token from
  // another connection cannot claim authority here because the
  // kernel reports a different peer PID/UID.
  peer_identity_t pi = peer_identity(cfd);
  if (!peer_matches(cl, &pi)) {
    respond_err(cfd, "DENY_PEER_MISMATCH"); return;
  }

  // The peer identity MUST include a kernel-derived PID (> 0).
  // A peer_pid of 0 means LOCAL_PEERPID failed and we have no
  // kernel-authenticated parent/peer relationship to bind the
  // proposed PGID against. HALT_PEER_PROCESS_IDENTITY_NOT_AVAILABLE
  // is the literal fail-closed rule: without a PID, we cannot
  // verify peer → spawned-leader ancestry and must refuse.
  if (pi.pid <= 0) {
    respond_err(cfd, "PEER_IDENTITY_UNAVAILABLE"); return;
  }

  uint64_t start_us = 0;
  uid_t leader_uid = (uid_t)-1;
  pid_t leader_ppid = -1;
  if (!read_proc_identity_ext(proposed_pgid, &start_us, &leader_uid, &leader_ppid)) {
    respond_err(cfd, "DENY_LEADER_NOT_FOUND"); return;
  }
  if (!validate_pgid_ownership(proposed_pgid, proposed_pgid, start_us)) {
    respond_err(cfd, "DENY_OWNERSHIP"); return;
  }
  if (leader_uid != pi.uid) {
    // The leader exists and is in the right PGID, but it is owned
    // by a DIFFERENT UID than the peer. We refuse: this prevents
    // a sandboxed ClineMM from registering a leader it does not own.
    respond_err(cfd, "DENY_OWNERSHIP"); return;
  }

  // OWNERSHIP PROOF (the load-bearing P0 invariant from the review):
  // Same-UID + same-PGID is NOT sufficient. The leader must be the
  // peer's own child (peer_pid == leader_ppid). This is what proves
  // "the caller is the one that spawned this group" — same UID alone
  // would let any same-UID process claim authority over any
  // same-UID process group, which is the naked PGID killer we
  // explicitly prohibit.
  //
  // Two safe conditions are accepted:
  //   (a) leader_ppid == pi.pid (the peer's child)
  //   (b) leader_pid == pi.pid  (the peer IS the leader — direct
  //       spawn where the leader has already detached, or the
  //       caller is registering its own running group)
  if (leader_ppid != pi.pid && proposed_pgid != pi.pid) {
    respond_err(cfd, "DENY_OWNERSHIP"); return;
  }

  job_record_t *job = alloc_job_slot();
  if (!job) { respond_err(cfd, "CAPACITY"); return; }
  gen_token(job->job_token);
  memcpy(job->owner_client_token, cl->client_token, CLINEMM_TOKEN_HEX_LEN + 1);
  job->pgid = proposed_pgid;
  job->leader_pid = proposed_pgid;
  job->leader_start_us = start_us;
  job->leader_ppid_at_register = leader_ppid;
  job->used = 1;
  job->active = 1;

  char buf[MAX_FRAME];
  size_t off = 0;
  int hdr = snprintf(buf + off, sizeof(buf) - off,
                     "{\"version\":1,\"request_id\":");
  if (hdr <= 0 || (size_t)hdr >= sizeof(buf) - off) goto trunc;
  off += (size_t)hdr;
  int idn = write_json_string(buf + off, sizeof(buf) - off, rid->val, rid->val_len);
  if (idn < 0) goto trunc;
  off += (size_t)idn;
  if (!json_str(buf, sizeof(buf), &off, "job_token",
                job->job_token, CLINEMM_TOKEN_HEX_LEN)) goto trunc;
  if (!json_num(buf, sizeof(buf), &off, "active_job_count",
                (long)count_active_jobs())) goto trunc;
  if (!json_num(buf, sizeof(buf), &off, "active_client_count",
                (long)count_active_clients())) goto trunc;
  int tail = snprintf(buf + off, sizeof(buf) - off, ",\"ok\":true}\n");
  if (tail <= 0 || (size_t)tail >= sizeof(buf) - off) goto trunc;
  off += (size_t)tail;
  (void)write_all(cfd, buf, off);
  return;
trunc:
  respond_err(cfd, "INTERNAL_TRUNCATION");
}

// Resolve a (client_token, job_token) pair from the request and
// verify the peer identity on this connection matches the recorded
// identity. On success returns 1 and writes pointers; on failure
// writes the appropriate error and returns 0.
static int resolve_owned_job(int cfd, const kv_t *rid, const kv_t *kvs, size_t nkvs,
                              client_record_t **out_cl, job_record_t **out_job) {
  (void)rid;
  const kv_t *ct_kv = find_kv(kvs, nkvs, "client_token");
  const kv_t *jt_kv = find_kv(kvs, nkvs, "job_token");
  if (!ct_kv || !jt_kv) { respond_err(cfd, "BAD_REQUEST"); return 0; }
  if (ct_kv->kind != V_STR || ct_kv->val_len != CLINEMM_TOKEN_HEX_LEN ||
      jt_kv->kind != V_STR || jt_kv->val_len != CLINEMM_TOKEN_HEX_LEN) {
    respond_err(cfd, "BAD_REQUEST"); return 0;
  }
  client_record_t *cl = find_client(ct_kv->val);
  if (!cl) { respond_err(cfd, "DENY_UNKNOWN_CLIENT"); return 0; }
  job_record_t *job = find_job(jt_kv->val);
  if (!job || !job->active) { respond_err(cfd, "DENY_UNKNOWN_JOB"); return 0; }
  if (strcmp(job->owner_client_token, cl->client_token) != 0) {
    respond_err(cfd, "DENY_FOREIGN_JOB"); return 0;
  }
  peer_identity_t pi = peer_identity(cfd);
  if (!peer_matches(cl, &pi)) {
    respond_err(cfd, "DENY_PEER_MISMATCH"); return 0;
  }
  *out_cl = cl;
  *out_job = job;
  return 1;
}

#define TERM_GRACE_MS_DEFAULT 2000

// process-group.terminate-owned: SIGTERM grace, then SIGKILL
// escalation. Caller does NOT select the signal.
static void handle_terminate_owned(int cfd, const kv_t *rid, const kv_t *kvs, size_t nkvs) {
  client_record_t *cl = NULL;
  job_record_t *job = NULL;
  if (!resolve_owned_job(cfd, rid, kvs, nkvs, &cl, &job)) return;

  // PID reuse resistance.
  uint64_t start_us_now = 0;
  if (!read_proc_start_us(job->leader_pid, &start_us_now) ||
      start_us_now != job->leader_start_us) {
    // Review-correction02: clear the slot so it can be reused.
    clear_job_slot(job);
    respond_err(cfd, "STALE_OWNERSHIP");
    return;
  }
  pid_t actual_pgid = getpgid(job->leader_pid);
  if (actual_pgid != job->pgid) {
    // Review-correction02: PGID divergence means the group has
    // already been remapped (e.g. setpgid escape). Reclaim the slot.
    clear_job_slot(job);
    respond_err(cfd, "STALE_OWNERSHIP");
    return;
  }

  int grace_ms = TERM_GRACE_MS_DEFAULT;
  const char *genv = getenv("CLINEMM_HELPER_TERM_GRACE_MS");
  if (genv && *genv) {
    char *end2 = NULL;
    long v = strtol(genv, &end2, 10);
    if (end2 && *end2 == 0 && v > 0 && v < 60000) {
      fprintf(stderr,
        "[helper] WARNING: CLINEMM_HELPER_TERM_GRACE_MS=%ld "
        "overrides default %d (test-only override)\n",
        v, TERM_GRACE_MS_DEFAULT);
      grace_ms = (int)v;
    }
  }

  // Build a correlated success envelope: the TS client requires
  // response.request_id == sent request_id for every response
  // (see client.ts:RequestIdMismatchError). Stripping request_id
  // from success envelopes would break the EPERM-only fallback
  // composition chain.
  char resp[MAX_FRAME];
  size_t roff = 0;
  int rh = snprintf(resp + roff, sizeof(resp) - roff,
                    "{\"version\":1,\"request_id\":");
  if (rh <= 0 || (size_t)rh >= sizeof(resp) - roff) goto trunc;
  roff += (size_t)rh;
  int rin = write_json_string(resp + roff, sizeof(resp) - roff,
                              rid->val, rid->val_len);
  if (rin < 0) goto trunc;
  roff += (size_t)rin;

  int trc = kill(-job->pgid, SIGTERM);
  if (trc < 0 && errno == ESRCH) {
    // Review-correction02: group already gone (ESRCH on TERM);
    // clear the slot so the next register can reuse it.
    clear_job_slot(job);
    int rt = snprintf(resp + roff, sizeof(resp) - roff,
                      ",\"ok\":true,\"result\":\"TERMINATED_TERM\"}\n");
    if (rt <= 0 || (size_t)rt >= sizeof(resp) - roff) goto trunc;
    roff += (size_t)rt;
    (void)write_all(cfd, resp, roff);
    return;
  }
  struct timespec start_ts;
  clock_gettime(CLOCK_MONOTONIC, &start_ts);
  int gone = 0;
  while (1) {
    struct timespec now_ts;
    clock_gettime(CLOCK_MONOTONIC, &now_ts);
    long elapsed_ms =
      (now_ts.tv_sec - start_ts.tv_sec) * 1000L +
      (now_ts.tv_nsec - start_ts.tv_nsec) / 1000000L;
    if (elapsed_ms >= grace_ms) break;
    if (kill(-job->pgid, 0) < 0 && errno == ESRCH) { gone = 1; break; }
    struct timespec slp = { .tv_sec = 0, .tv_nsec = 50 * 1000000L };
    nanosleep(&slp, NULL);
  }
  if (gone) {
    // Review-correction02: TERM-grace success path.
    clear_job_slot(job);
    int rt = snprintf(resp + roff, sizeof(resp) - roff,
                      ",\"ok\":true,\"result\":\"TERMINATED_TERM\"}\n");
    if (rt <= 0 || (size_t)rt >= sizeof(resp) - roff) goto trunc;
    roff += (size_t)rt;
    (void)write_all(cfd, resp, roff);
    return;
  }

  int krc = kill(-job->pgid, SIGKILL);
  if (krc < 0 && errno == ESRCH) {
    // Review-correction02: KILL raced with natural exit; free the slot.
    clear_job_slot(job);
    int rt = snprintf(resp + roff, sizeof(resp) - roff,
                      ",\"ok\":true,\"result\":\"TERMINATED_TERM\"}\n");
    if (rt <= 0 || (size_t)rt >= sizeof(resp) - roff) goto trunc;
    roff += (size_t)rt;
    (void)write_all(cfd, resp, roff);
    return;
  }
  struct timespec k_start;
  clock_gettime(CLOCK_MONOTONIC, &k_start);
  while (1) {
    struct timespec now_ts;
    clock_gettime(CLOCK_MONOTONIC, &now_ts);
    long elapsed_ms =
      (now_ts.tv_sec - k_start.tv_sec) * 1000L +
      (now_ts.tv_nsec - k_start.tv_nsec) / 1000000L;
    if (elapsed_ms >= grace_ms) break;
    if (kill(-job->pgid, 0) < 0 && errno == ESRCH) {
      // Review-correction02: KILL-grace success path.
      clear_job_slot(job);
      int rt = snprintf(resp + roff, sizeof(resp) - roff,
                        ",\"ok\":true,\"result\":\"TERMINATED_KILL\"}\n");
      if (rt <= 0 || (size_t)rt >= sizeof(resp) - roff) goto trunc;
      roff += (size_t)rt;
      (void)write_all(cfd, resp, roff);
      return;
    }
    struct timespec slp = { .tv_sec = 0, .tv_nsec = 50 * 1000000L };
    nanosleep(&slp, NULL);
  }
  // Review-correction02: even on TERMINATION_FAILED we must
  // reclaim the slot — the caller has done everything they can.
  // Leaving the slot `used=1` here would be the original
  // HALT_HELPER_JOB_SLOT_EXHAUSTION defect.
  clear_job_slot(job);
  respond_err(cfd, "TERMINATION_FAILED");
  return;
trunc:
  // Truncation path: slot is still in use (no result was delivered).
  // Do NOT clear here — the client may retry.
  respond_err(cfd, "INTERNAL_TRUNCATION");
}

// process-group.release-owned: clear the job slot without signaling.
// Review-correction01: success envelope carries request_id for TS
// client correlation (response.request_id === sent request_id).
// Review-correction02: clear_job_slot() reclaims the slot for
// re-use (alloc_job_slot only inspects `used`, so without this
// the helper would register at most CLINEMM_MAX_JOBS=128 jobs
// over its entire lifetime).
static void handle_release_owned(int cfd, const kv_t *rid, const kv_t *kvs, size_t nkvs) {
  client_record_t *cl = NULL;
  job_record_t *job = NULL;
  if (!resolve_owned_job(cfd, rid, kvs, nkvs, &cl, &job)) return;
  clear_job_slot(job);
  char buf[MAX_FRAME];
  size_t off = 0;
  int hdr = snprintf(buf + off, sizeof(buf) - off,
                     "{\"version\":1,\"request_id\":");
  if (hdr <= 0 || (size_t)hdr >= sizeof(buf) - off) { respond_err(cfd, "INTERNAL_TRUNCATION"); return; }
  off += (size_t)hdr;
  int idn = write_json_string(buf + off, sizeof(buf) - off,
                              rid->val, rid->val_len);
  if (idn < 0) { respond_err(cfd, "INTERNAL_TRUNCATION"); return; }
  off += (size_t)idn;
  int tail = snprintf(buf + off, sizeof(buf) - off,
                      ",\"ok\":true,\"result\":\"RELEASED\"}\n");
  if (tail <= 0 || (size_t)tail >= sizeof(buf) - off) { respond_err(cfd, "INTERNAL_TRUNCATION"); return; }
  off += (size_t)tail;
  (void)write_all(cfd, buf, off);
}

// helper.restart: validate the request, flush a correlated ACK, then
// exit normally. REJECTED when active_job_count > 0 (per §19).
static void handle_helper_restart(int cfd, const kv_t *rid) {
  int active = count_active_jobs();
  if (active > 0) {
    char buf[MAX_FRAME];
    size_t off = 0;
    int hdr = snprintf(buf + off, sizeof(buf) - off,
                       "{\"version\":1,\"request_id\":");
    if (hdr <= 0 || (size_t)hdr >= sizeof(buf) - off) goto trunc;
    off += (size_t)hdr;
    int idn = write_json_string(buf + off, sizeof(buf) - off, rid->val, rid->val_len);
    if (idn < 0) goto trunc;
    off += (size_t)idn;
    int t = snprintf(buf + off, sizeof(buf) - off,
                     ",\"ok\":false,\"error\":\"ACTIVE_JOBS\","
                     "\"active_job_count\":%d,\"active_client_count\":%d}\n",
                     active, count_active_clients());
    if (t <= 0 || (size_t)t >= sizeof(buf) - off) goto trunc;
    off += (size_t)t;
    (void)write_all(cfd, buf, off);
    return;
  }
  char buf[MAX_FRAME];
  size_t off = 0;
  int hdr = snprintf(buf + off, sizeof(buf) - off,
                     "{\"version\":1,\"request_id\":");
  if (hdr <= 0 || (size_t)hdr >= sizeof(buf) - off) goto trunc;
  off += (size_t)hdr;
  int idn = write_json_string(buf + off, sizeof(buf) - off, rid->val, rid->val_len);
  if (idn < 0) goto trunc;
  off += (size_t)idn;
  int t = snprintf(buf + off, sizeof(buf) - off,
                   ",\"ok\":true,\"result\":\"RESTARTING\"}\n");
  if (t <= 0 || (size_t)t >= sizeof(buf) - off) goto trunc;
  off += (size_t)t;
  (void)write_all(cfd, buf, off);
  g_shutdown = 1;
  return;
trunc:
  respond_err(cfd, "INTERNAL_TRUNCATION");
}

// PROBE01: build the ok-response envelope. The runner's stdout is a
// JSON OBJECT LITERAL that contains a single top-level field
// "result" with the testbed result body, e.g.:
//   {"result":{"subject_head":"...","vsix_sha256":"...",...}}
// We splice this verbatim into our envelope as the value of "result"
// by writing the prefix, then the runner's body, then the suffix.
//
// Concretely: the runner emits `{"result":{...}}` and we forward it
// after stripping the outer `{"result":` opener and the trailing
// `}`. To keep the helper simple, the runner contract is:
//   runner_stdout = `{"result":{...}}\n`
// We rebuild the envelope as
//   `{"version":1,"request_id":"<echo>","ok":true,"result":{...}}\n`
// by stripping the leading `{"result":` and trailing `}` from the
// runner output.
static void respond_testbed_ok(int cfd, const void *request_id, size_t request_id_len,
                                const char *runner_stdout, size_t runner_stdout_len) {
  char buf[MAX_FRAME + 256];
  size_t off = 0;
  int hdr = snprintf(buf + off, sizeof(buf) - off, "{\"version\":1,\"request_id\":");
  if (hdr <= 0 || (size_t)hdr >= sizeof(buf) - off) goto trunc;
  off += (size_t)hdr;
  int idn = write_json_string(buf + off, sizeof(buf) - off, request_id, request_id_len);
  if (idn < 0) goto trunc;
  off += (size_t)idn;
  static const char SUFFIX[] = ",\"ok\":true,\"result\":";
  size_t slen = sizeof(SUFFIX) - 1;
  if (sizeof(buf) - off < slen + 4) goto trunc;
  memcpy(buf + off, SUFFIX, slen);
  off += slen;
  if (runner_stdout_len == 0 || runner_stdout[0] != '{') {
    respond_testbed_err(cfd, request_id, request_id_len, "INTERNAL_ERROR");
    return;
  }
  // Trim trailing whitespace from runner output.
  size_t roff = runner_stdout_len;
  while (roff > 0 && (runner_stdout[roff - 1] == '\n' || runner_stdout[roff - 1] == ' ' ||
                       runner_stdout[roff - 1] == '\r' || runner_stdout[roff - 1] == '\t')) roff--;
  if (roff == 0) {
    respond_testbed_err(cfd, request_id, request_id_len, "INTERNAL_ERROR");
    return;
  }
  // Strip the leading `{"result":` opener (10 bytes) and the trailing
  // `}` (1 byte). After trimming, runner_stdout should look like:
  //   {"result":{"subject_head":"...", ... }}
  // We want the inner body: `{"subject_head":"...", ... }` — which is
  // everything except the leading `{"result":` and the trailing `}`.
  static const char OPENER[] = "{\"result\":";
  static const size_t OPENER_LEN = sizeof(OPENER) - 1;
  if (roff < OPENER_LEN + 1 || memcmp(runner_stdout, OPENER, OPENER_LEN) != 0) {
    respond_testbed_err(cfd, request_id, request_id_len, "INTERNAL_ERROR");
    return;
  }
  if (runner_stdout[roff - 1] != '}') {
    respond_testbed_err(cfd, request_id, request_id_len, "INTERNAL_ERROR");
    return;
  }
  // Inner body starts at OPENER_LEN, length roff - OPENER_LEN - 1.
  const char *body = runner_stdout + OPENER_LEN;
  size_t body_len = roff - OPENER_LEN - 1;
  if (sizeof(buf) - off < body_len + 4) goto trunc;
  memcpy(buf + off, body, body_len);
  off += body_len;
  if (off + 2 >= sizeof(buf)) goto trunc;
  buf[off++] = '}';
  buf[off++] = '\n';
  (void)write_all(cfd, buf, off);
  return;
trunc:
  respond_err(cfd, "INTERNAL_TRUNCATION");
}

static void respond_testbed_err(int cfd, const void *request_id, size_t request_id_len,
                                const char *code) {
  char buf[MAX_FRAME];
  size_t off = 0;
  int hdr = snprintf(buf + off, sizeof(buf) - off, "{\"version\":1,\"request_id\":");
  if (hdr <= 0 || (size_t)hdr >= sizeof(buf) - off) goto trunc;
  off += (size_t)hdr;
  int idn = write_json_string(buf + off, sizeof(buf) - off, request_id, request_id_len);
  if (idn < 0) goto trunc;
  off += (size_t)idn;
  int tail = snprintf(buf + off, sizeof(buf) - off,
    ",\"ok\":false,\"error\":\"%s\"}\n", code);
  if (tail <= 0 || (size_t)tail >= sizeof(buf) - off) goto trunc;
  off += (size_t)tail;
  (void)write_all(cfd, buf, off);
  return;
trunc:
  respond_err(cfd, "INTERNAL_TRUNCATION");
}

static void handle_connection(int cfd) {
  char buf[MAX_FRAME + 1];
  ssize_t n = read_frame(cfd, buf, MAX_FRAME);
  if (n == -2) { respond_err(cfd, "OVERSIZE"); close(cfd); return; }
  if (n <= 0) { close(cfd); return; }
  buf[n - 1] = 0;

  kv_t kvs[MAX_KEYS];
  size_t nkvs = 0;
  const char *err = parse_envelope(buf, kvs, &nkvs);
  if (err) { respond_err(cfd, err); close(cfd); return; }

  // The forbidden-key and unrecognized-key checks already ran inside the
  // parser (BEFORE value parsing, per ACT §5 structural anti-shell).
  // Require the three legal keys.
  if (!find_kv(kvs, nkvs, "version") || !find_kv(kvs, nkvs, "request_id") || !find_kv(kvs, nkvs, "method")) {
    respond_err(cfd, "BAD_REQUEST"); close(cfd); return;
  }
  // Version must be 1 (number)
  const kv_t *v = find_kv(kvs, nkvs, "version");
  if (v->kind != V_NUM || strcmp(v->val, "1") != 0) {
    respond_err(cfd, "UNSUPPORTED_VERSION"); close(cfd); return;
  }
  // request_id must be non-empty (CORRECTION05: by length, not by val[0]==0).
  // A request_id of "\u0000" has val_len=1 and is therefore non-empty;
  // a request_id of "" has val_len=0 and is rejected.
  const kv_t *r = find_kv(kvs, nkvs, "request_id");
  if (r->kind != V_STR || r->val_len == 0) {
    respond_err(cfd, "MISSING_REQUEST_ID"); close(cfd); return;
  }
  // Method dispatch. ACT-01 had a single method (`health`); PROBE01
  // adds a second fixed method (`testbed.run-installed-vsix-smoke`).
  // ACT-CLINEMM-HOST-HELPER-OWNED-PGID-TERMINATION01 adds four more:
  //   client.open, process-group.register-owned,
  //   process-group.terminate-owned, process-group.release-owned,
  //   helper.restart.
  // Each branch validates method-specific required fields and emits
  // the matching response.
  const kv_t *m = find_kv(kvs, nkvs, "method");
  if (m->kind != V_STR) {
    respond_err(cfd, "METHOD_NOT_ALLOWED"); close(cfd); return;
  }
  if (strcmp(m->val, "health") == 0) {
    // CORRECTION02: pass the parsed request_id so the response echoes it.
    // CORRECTION05: pass (r->val, r->val_len) — length-aware, preserves NUL.
    // ACT-CLINEMM-HOST-HELPER-OWNED-PGID-TERMINATION01: respond_ok()
    // also emits build_id + active_client_count + active_job_count so
    // the operator can prove the NEW generation started and that
    // capability state is what was expected.
    respond_ok(cfd, r->val, r->val_len);
    close(cfd);
    return;
  }
  if (strcmp(m->val, "testbed.run-installed-vsix-smoke") == 0) {
    handle_testbed_run(cfd, r, kvs, nkvs);
    close(cfd);
    return;
  }
  if (strcmp(m->val, "client.open") == 0) {
    handle_client_open(cfd, r);
    close(cfd);
    return;
  }
  // Review-correction02: client.close reclaims the slot
  // explicitly. Without this, the 64-client pool would
  // exhaust over a long-lived helper that serves many
  // short-lived Codium sessions.
  if (strcmp(m->val, "client.close") == 0) {
    handle_client_close(cfd, r, kvs, nkvs);
    close(cfd);
    return;
  }
  if (strcmp(m->val, "process-group.register-owned") == 0) {
    handle_register_owned(cfd, r, kvs, nkvs);
    close(cfd);
    return;
  }
  if (strcmp(m->val, "process-group.terminate-owned") == 0) {
    handle_terminate_owned(cfd, r, kvs, nkvs);
    close(cfd);
    return;
  }
  if (strcmp(m->val, "process-group.release-owned") == 0) {
    handle_release_owned(cfd, r, kvs, nkvs);
    close(cfd);
    return;
  }
  if (strcmp(m->val, "helper.restart") == 0) {
    handle_helper_restart(cfd, r);
    close(cfd);
    return;
  }
  respond_err(cfd, "METHOD_NOT_ALLOWED");
  close(cfd);
}

int main(int argc, char **argv) {
  (void)argc; (void)argv;
  signal(SIGTERM, on_sig);
  signal(SIGINT, on_sig);
  signal(SIGPIPE, SIG_IGN);

  // Compute the SOURCE/BUILD identity once at startup so every
  // subsequent health() response carries the same build_id.
  g_build_id = hex_sha256_of_self_source();

  int *fds = NULL;
  size_t cnt = 0;
  int rc = launch_activate_socket("Listener", &fds, &cnt);
  int listen_fd = -1;
  int activated = 0;
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
  //
  // The reviewer's note: silently self-binding on ENOENT/EALREADY
  // would hide a real launchd configuration defect (plist mis-named,
  // re-bootstrap race, etc.) by masking it as a "normal dev fallback."
  if (rc == 0 && cnt >= 1) {
    listen_fd = fds[0];
    activated = 1;
    fprintf(stderr, "[helper] launch_activate_socket activated_fd=%d cnt=%zu\n", listen_fd, cnt);
  } else if (rc == ESRCH) {
    fprintf(stderr, "[helper] launch_activate_socket ESRCH; manual/dev fallback self-bind\n");
    const char *path = getenv("CLINEMM_HOST_HELPER_SOCKET");
    if (!path || !*path) path = "/tmp/clinemm-host-helper.sock";
    unlink(path);
    listen_fd = socket(AF_UNIX, SOCK_STREAM, 0);
    if (listen_fd < 0) { perror("socket"); goto fail_closed; }
    struct sockaddr_un addr = { 0 };
    addr.sun_family = AF_UNIX;
    strncpy(addr.sun_path, path, sizeof(addr.sun_path) - 1);
    if (bind(listen_fd, (struct sockaddr*)&addr, sizeof(addr)) < 0) { perror("bind"); goto fail_closed; }
    chmod(path, 0600);
    if (listen(listen_fd, 8) < 0) { perror("listen"); goto fail_closed; }
  } else {
    // rc != 0, or rc == 0 with cnt == 0. Treat as configuration defect.
    fprintf(stderr,
      "[helper] FAIL_CLOSED: launch_activate_socket rc=%d cnt=%zu; "
      "expected rc=0+fd under launchd, or ESRCH for manual/dev mode. "
      "rc=ENOENT or rc=EALREADY indicates a launchd configuration defect "
      "(plist Sockets.Listener missing or already activated). "
      "Refusing to self-bind to avoid masking a real bug.\n",
      rc, cnt);
    if (fds) free(fds);
    return 2; // distinct exit code: 0=ok, 1=bind/listen error, 2=launchd config defect
  }
  if (fds) free(fds);

  const char *status_path = getenv("CLINEMM_HELPER_STATUS_PATH");
  if (status_path) {
    FILE *sf = fopen(status_path, "w");
    if (sf) {
      fprintf(sf, "{\"activated\":%s,\"listen_fd\":%d,\"pid\":%d,\"uid\":%d,\"launchd_rc\":%d}\n",
        activated ? "true" : "false", listen_fd, (int)getpid(), (int)getuid(), rc);
      fclose(sf);
    }
  }

  while (!g_shutdown) {
    int cfd = accept(listen_fd, NULL, NULL);
    if (cfd < 0) { if (errno == EINTR) continue; perror("accept"); break; }
    handle_connection(cfd);
  }
  close(listen_fd);
  return 0;

fail_closed:
  if (fds) free(fds);
  return 1;
}
