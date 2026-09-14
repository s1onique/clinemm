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

// PROBE01: bumped to 8192 to accommodate a full testbed envelope
// (40-hex subject_head + 64-hex SHA256 + absolute path up to ~1KiB).
#define MAX_FRAME 8192
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
  // PROBE01: recognized-key list is the UNION of all method-specific
  // legal keys. Anti-shell invariant: any key NOT in this union fails
  // closed at the parser layer BEFORE value parsing.
  static const char *R[] = {
    // ACT-01 (health envelope):
    "version", "request_id", "method",
    // PROBE01 (testbed.run-installed-vsix-smoke envelope):
    "subject_head", "vsix_path", "vsix_sha256",
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
  // Tail: ok/service/pid/uid and newline
  int tail = snprintf(buf + off, sizeof(buf) - off,
    ",\"ok\":true,\"service\":\"clinemm-host-helper\",\"pid\":%d,\"uid\":%d}\n",
    (int)getpid(), (int)getuid());
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
  // Each branch validates method-specific required fields and emits
  // the matching response.
  const kv_t *m = find_kv(kvs, nkvs, "method");
  if (m->kind != V_STR) {
    respond_err(cfd, "METHOD_NOT_ALLOWED"); close(cfd); return;
  }
  if (strcmp(m->val, "health") == 0) {
    // CORRECTION02: pass the parsed request_id so the response echoes it.
    // CORRECTION05: pass (r->val, r->val_len) — length-aware, preserves NUL.
    respond_ok(cfd, r->val, r->val_len);
    close(cfd);
    return;
  }
  if (strcmp(m->val, "testbed.run-installed-vsix-smoke") == 0) {
    handle_testbed_run(cfd, r, kvs, nkvs);
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
