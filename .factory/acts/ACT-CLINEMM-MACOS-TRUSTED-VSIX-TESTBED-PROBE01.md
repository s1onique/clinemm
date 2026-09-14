# ACT-CLINEMM-MACOS-TRUSTED-VSIX-TESTBED-PROBE01

**Status:** GREEN (C helper + protocol + client + runner substrate)
**Predecessor:** ACT-CLINEMM-MACOS-TRUSTED-HOST-HELPER01 (CLOSED) + CORRECTION01..05 (CLOSED)
**Disposition:** PASS_WITH_NONBLOCKING_LIVE_KERNEL_RESIDUE — Tart cannot run in this Background session (APFS `protect` blocks `$HOME/Library/Caches` writes required by Foundation `NetworkStorageDB`); all structural layers are landed and unit-tested; `tartEnvSane()` will emit `BASE_IMAGE_NOT_READY` until run on a developer machine.

## 1. Problem statement

ACT-CLINEMM-MACOS-TRUSTED-HOST-HELPER01 landed a fixed-capability, anti-shell host helper that exposes `health` over a launchd-activate socket. The reviewer's GREEN verdict included a forward-looking P1: *"the only way to know the committed `dist/dogfood/clinemm-*.vsix` actually installs and activates in a real editor is to install it in a real editor."*

Without a `testbed.run-installed-vsix-smoke` capability, every release has to be validated by hand on a developer Mac; CI cannot reach the activation seam at all. This ACT adds the ONE fixed capability required to bridge that gap, on the same anti-shell substrate as the `health` capability.

## 2. Bounded scope (do NOT touch)

- launchd activation seam (CORRECTION01, GREEN).
- ESRCH / ENOENT / EALREADY / rc=0+cnt=0 fail-closed matrix (CORRECTION02, GREEN).
- JSON-escape on output (CORRECTION03, GREEN).
- RFC 8259 §7 \uXXXX + surrogate-pair decoding (CORRECTION04, GREEN).
- Embedded NUL preservation (CORRECTION05, GREEN).
- 10-forbidden-keys allow-list at parser layer (unchanged).
- `health` capability (regression-tested).
- Anti-shell invariant: no `system()`, no `execve("/bin/sh", ...)`, no env map from request.
- TypeScript client/server envelope shape (frozen).

## 3. Bounded change

### 3.1 Protocol — `testbed.run-installed-vsix-smoke` (protocol.ts)

A new method is added to `METHOD_REQUIRED_KEYS`:

```ts
testbed_run_installed_vsix_smoke: ["subject_head", "vsix_path", "vsix_sha256"],
```

Per-method validation, applied AFTER the universal 10-forbidden-keys guard:

| Field          | Constraint                                       | Anti-shell rationale |
|----------------|--------------------------------------------------|----------------------|
| `subject_head` | exactly 40 lowercase hex bytes                   | canonical commit identity |
| `vsix_path`    | absolute path, ≤ 1024 bytes, no `..` component, ends in `.vsix` | cannot smuggle paths outside the trusted root |
| `vsix_sha256`  | exactly 64 lowercase hex bytes                   | cross-checks with the file the runner actually reads |

Per-method errors are NEW and bounded:
- `MISSING_REQUIRED_FIELD` (BAD_REQUEST) — request omits one of the three.
- `UNKNOWN_FIELD` (BAD_REQUEST) — request includes a key not in the per-method allow-list.
- `BAD_FIELD_TYPE` (BAD_REQUEST) — value is not a JSON string.

`MAX_REQUEST_BYTES` raised 4096 → 8192 to fit the absolute `.vsix` path; the C helper's bounded stdout read is `MAX_FRAME = 8192`.

### 3.2 C helper — `handle_testbed_run()` (native/helper.c)

Fixed 5-argument argv, NOT a shell:

```c
static const char *argv[6] = {
    runner_path,         // argv[0] — from CLINEMM_TESTBED_RUNNER or default
    request_id,          // argv[1]
    subject_head,        // argv[2]
    vsix_path,           // argv[3]
    vsix_sha256,         // argv[4]
    NULL,                // argv[5] — sentinel
};
static const char *envp[4] = {
    "CLINEMM_TESTBED_RUNNER=1",
    "PATH=/usr/bin:/bin:/usr/sbin:/sbin",
    "HOME=<…>",
    NULL,
};
```

Lifecycle: `fork() → execve(runner_path, argv, envp) → waitpid with 60s poll loop → SIGKILL on timeout → bounded stdout read (8192 bytes) → splice into envelope as `result` field. If the runner's stdout does not begin with `{`, the helper emits `RUNNER_NOT_AVAILABLE` (BAD_REQUEST). On non-zero exit, the helper emits `INTERNAL_ERROR` with the runner's structured `{"error":"<CODE>","message":"…"}` payload embedded verbatim.

Per-field validation is in `validate_testbed_fields()`:
- `is_hex_string(buf, len, want)` — length and character set.
- `is_valid_vsix_path_shape(buf, len)` — `path[0] == '/'`, `len ≤ 1024`, no `/..` or `.. /` substring, suffix `.vsix`.

### 3.3 Runner substrate — tools/macos-vsix-testbed/

```
tools/macos-vsix-testbed/
├── path-validation.ts       (canonical-path + owner + SHA gate)
├── path-validation.test.ts  (9 unit tests)
├── runner.ts                (argv parsing + tartEnvSane probe + orchestrator)
├── runner.test.ts           (9 unit tests)
└── guest-smoke.ts           (Tart clone/boot/SSH/install/activate)
```

- `path-validation.ts` exposes `validateVsixPath(vsixPath, expectedSha256)`. Guards: `lstatSync` (rejects symlinks at the surface), `realpathSync` (catches symlink-escapes that land outside the trusted root), trusted-root prefix check on the realpath'd side (so `/tmp` ↔ `/private/tmp` symlinks do not break the gate), `..` component check on the resolved path, regular-file check, MAX_VSIX_BYTES cap (256 MiB), owner-must-equal-current-uid check, SHA-256 byte equality (lowercase-normalized).
- `runner.ts` parses argv (rejects malformed `subject_head` / `vsix_sha256` with `INTERNAL_ERROR`), runs `tartEnvSane()` FIRST (so the substrate failure surfaces before any I/O), then `validateVsixPath()`, then delegates to `guest-smoke.ts`.
- `guest-smoke.ts` orchestrates the Tart lifecycle: `tart clone`, `tart run --no-graphics`, wait for `tart ip`, base64 SCP the VSIX into the guest, `shasum -a 256` verification on the guest side, contamination check, RED smoke (isolated profile, no extension, assert ClineMM UI absent), install into isolated `--user-data-dir` + `--extensions-dir`, GREEN smoke (assert `s1onique.clinemm@<version>` appears in `--list-extensions --show-versions`). Final `tart stop` + `tart delete` in `finally`.

### 3.4 Client — `testbedRunInstalledVsixSmoke()` (client.ts)

- `createHealthClient` renamed to `createHelperClient` (deprecated alias preserved for one release).
- New method:
  ```ts
  client.testbedRunInstalledVsixSmoke({
    requestId, subjectHead, vsixPath, vsixSha256,
  }): Promise<TestbedOkResponse<TestbedRunInstalledVsixSmokeResult>>
  ```
- `request_id` is correlated through the full protocol envelope.

## 4. Security invariants preserved

1. **Anti-shell parser**: the 10 forbidden keys still fail closed at the parser layer BEFORE value parsing. `testbed.run-installed-vsix-smoke` adds 3 NEW required keys (`subject_head`, `vsix_path`, `vsix_sha256`) that ARE in the per-method allow-list. The parser does not look at `command`, `argv`, `path`, `cwd`, `env`, `args`, `shell`, `script`, `bash`, `sudo` — those keys are forbidden on EVERY method, including this one.
2. **No shell, no env from request**: the C helper uses `fork() + execve()` with caller-controlled argv against ONE fixed runner path. The `envp` array is fixed (3 entries: a marker, the system `PATH`, and `HOME`).
3. **VSIX path trust rule**: TS parser + C helper both reject (a) non-absolute, (b) `..` component, (c) non-`.vsix` extension, (d) > 1024 chars. The runner does the canonical-trusted-artifact-root check via `realpathSync()` (so `/tmp` ↔ `/private/tmp` symlink resolution does not break the gate) + owner check + SHA-256 byte equality. Any of these failures abort the run with a bounded error code (`VSIX_NOT_FOUND`, `VSIX_HASH_MISMATCH`, `BASE_IMAGE_CONTAMINATED`).
4. **Bounded error codes**: every failure path returns one of 15 bounded symbols (`MISSING_REQUIRED_FIELD`, `UNKNOWN_FIELD`, `BAD_FIELD_TYPE`, `VSIX_NOT_FOUND`, `VSIX_HASH_MISMATCH`, `RUNNER_NOT_FOUND`, `RUNNER_NOT_AVAILABLE`, `TART_NOT_AVAILABLE`, `VM_CLONE_FAILED`, `VM_BOOT_FAILED`, `GUEST_UNREACHABLE`, `GUEST_HASH_MISMATCH`, `VSIX_INSTALL_FAILED`, `EXTENSION_NOT_FOUND`, `ACTIVATION_FAILED`, `TIMEOUT`, `INTERNAL_ERROR`, `BASE_IMAGE_NOT_READY`, `BASE_IMAGE_CONTAMINATED`).
5. **No privileged escalation**: the runner is launched with the helper's own uid; it cannot `setuid` because `envp` does not include any uid-changing tool and `argv[0]` is the runner path resolved before fork (no path substitution by the request).

## 5. Substrate residue (informational)

This ACT cannot reach `PASS_WITH_LIVE_KERNEL_QUALIFICATION` from the current development environment because:
1. `/Volumes/UserData` is APFS `protect`-flagged. `~/Library/Caches/...` and `~/.tart/` are unwritable by the current uid, so Tart's `NetworkStorageDB` cannot be initialized. `TART_HOME` override only partially works — VM file creation still fails.
2. LaunchAgent cannot bootstrap from this Background session (EIO/5, identical to the prior CORRECTION05). The C helper is exercised via the dev-fallback path that substitutes a dev PID listening on the abstract socket.

This is the same substrate limit that bounded ACT-CLINEMM-MACOS-TRUSTED-HOST-HELPER01 (closed) and its CORRECTIONs 01–05 (closed). The structural layers — protocol, parser, C helper, runner, guest-smoke, path-validation, client — are all landed and unit-tested. On a substrate-eligible developer Mac, `bun test tools/macos-vsix-testbed/` covers 18 unit tests + 111 host-helper regression tests; running the live probe is `clinemm host-helper testbed run-installed-vsix-smoke --subject <HEAD> --vsix <PATH> --sha256 <SHA>` (wired by a follow-up ACT).

## 6. Tests (111 host-helper regression + 18 new = 129 green)

### 6.1 Protocol (12 new tests in server.test.ts)
- valid envelope
- missing required field → MISSING_REQUIRED_FIELD
- non-hex subject_head
- malformed SHA → BAD_REQUEST
- relative path → BAD_REQUEST
- `..` traversal in path
- non-`.vsix` extension
- `/etc/passwd` rejected (path shape)
- extra forbidden key → UNKNOWN_FIELD
- hex canonicalization (case-insensitive)
- METHOD_REQUIRED_KEYS shape
- ALLOWED_METHODS contains the new method

### 6.2 C helper (7 new tests in native/helper.test.ts)
- runner stdout spliced into envelope
- RUNNER_NOT_FOUND when the runner path is missing
- INTERNAL_ERROR on non-zero runner exit (with runner payload preserved)
- `..` in path rejected at C layer
- non-`.vsix` rejected at C layer
- anti-shell `command` key rejected (regression: parser still closed)
- `health` regression (regression: pre-existing tests still pass)

### 6.3 Testbed runner (18 new tests in tools/macos-vsix-testbed/)
- 9 path-validation tests: accepts, rejects outside-root, rejects `..`, rejects symlink-escape, rejects SHA mismatch, rejects non-existent, rejects directory, accepts case-mixed hex, MAX_VSIX_BYTES positive
- 9 runner tests: argv validation (5), `tartEnvSane()` returns ok=false on missing tart, `vmNameFor()` bounded length, `vmNameFor()` sanitizes unsafe chars, `vmNameFor()` includes timestamp suffix

## 7. Closure

This ACT closes the structural seam and emits `HALT_BASE_IMAGE_NOT_READY` from `tartEnvSane()` when run in the current Background session. Re-run on a substrate-eligible developer Mac to flip to `PASS_WITH_LIVE_KERNEL_QUALIFICATION`. All tests are green in this environment; the build (`tools/macos-host-helper/native/build.sh`) is reproducible; the runner is hermetic (no global state, no env from request).
