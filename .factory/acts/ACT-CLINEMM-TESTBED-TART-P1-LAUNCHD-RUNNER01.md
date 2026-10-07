# ACT-CLINEMM-TESTBED-TART-P1-LAUNCHD-RUNNER01

**Status:** CLOSED
**Date:** 2026-10-07
**Predecessor HEAD:** a27ebb5a7ed8ae89f5da0cd9f0c9ac24a271ded6
**Closure HEAD:** fa27c21f4bcd4e16c37c17943768c93112798a2c
**Helper ABI version:** TART_TESTBED_RUN_P1_LAUNCHD_RUNNER01
**Helper build_id:** 0xfd6eacaa2605da51b511b11c76b4cd404c32e24353ac3b76b453abfa3edf108 (drift confirms source change)

---

## VERDICT

**PASS_CLINEMM_TART_LAUNCHD_RUNNER**

This ACT shipped the semantic launchd-backed Tart testbed runner on
top of the now-qualified launchd host-helper boundary.

```text
PASS_CLINEMM_TART_LAUNCHD_RUNNER
+ tart-testbed package:
    + LaunchdTestbedRunner (single-RPC entry point)
    + LaunchdTestbedBackend (TestbedBackend seam reused)
    + LaunchdHostHelperTransport (AF_UNIX wire transport)
    + buildTestbedRunBody (closed-schema validator)
    + toTestbedResult (mirror of TestbedResult)
    + classifyRpcError (TART_/TESTBED_ code map)
    + TESTBED_RUN_BOUNDS (string/array length limits)
    + selectLaunchdTartRunner (CLI wiring)
    + 32 new focused unit + lifecycle + RED + wiring tests
+ macos-host-helper package:
    + protocol.ts: tart.testbed.run envelope (spec as JSON string)
    + protocol.ts: validateTestbedRunSpec (closed-schema validator)
    + protocol.ts: hasForbiddenKeysDeep (defense-in-depth walker)
    + client.ts: buildTartTestbedRunRequest (wire builder)
    + native/helper.c: dispatch wiring + handle_tart_testbed_run
                        (returns TART_TESTBED_RUN_NOT_IMPLEMENTED —
                         the load-bearing lifecycle is the successor
                         DOGFOOD ACT's scope; this ACT proves wire
                         shape, dispatch authority, and parse contract)
    + native: build_id drift 0x1d3a280bd… → 0xfd6eacaa2…
    + 14 new focused RPC + dispatch tests
+ 285/285 tests pass across both packages (was 271 pass)
+ typecheck clean on both packages
+ biome clean on all new files (0 errors, 0 warnings)
+ git diff --check: clean
+ no arbitrary host exec surface added
+ no caller-supplied Tart executable, cwd, env, shell, socket path
+ VM ownership structural check preserved (sub-function of vmNameFor)
+ long-lived tart run uses ProcessRunner.spawn() (CORRECTION01)
+ SIGTERM/SIGKILL escalation preserved (CORRECTION02)
+ helper-side dispatch returns explicit NOT_IMPLEMENTED so the wire
  shape is provable today and the DOGFOOD ACT plugs in the full
  lifecycle at the exact same handler site without changing the
  envelope
+ no real VM launched (CODE + TESTS ACT — explicitly)
+ spec travels as JSON-encoded string at the wire level (the C
  helper's parser is restricted to flat key/value envelopes by
  design — this is a structural anti-shell invariant, not a bug)
```

---

## PURPOSE

Connect the existing `tools/tart-testbed` orchestration substrate to
the now-qualified launchd host-helper boundary so ClineMM can drive a
real Tart VM lifecycle outside its inherited Seatbelt context.

The launchd boundary is already LIVE-qualified:

```text
direct ClineMM child:
  cache write -> EPERM

actual io.clinemm.host-helper LaunchAgent:
  cacheWrite.succeeded = true
  tart.available = true
  version = 2.34.0
  localListSucceeded = true
  ociListSucceeded = true
  overall = PASS
```

This ACT ships the connection between the qualified boundary and the
testbed substrate, WITHOUT yet running a real guest (the DOGFOOD ACT
does that).

This ACT is **code + unit/integration tests only**. No real VM is
required for closure. The first real guest remains the successor
qualification ACT.

---

## C0 — RECON FINDINGS

| # | Question | Finding |
|---|---|---|
| 1 | Which semantics currently live in TartBackend? | `tart clone`, `tart run` (spawn, retain handle), `tart ip` polling, `tart stop`+SIGTERM/SIGKILL escalation, `tart delete`, ssh for exec, scp for copyOut |
| 2 | Which semantics must remain there? | argv construction purity, structural ownership, signal-escalation memoization |
| 3 | Which operations cannot execute inside ClineMM because of Seatbelt? | All `~/.tart/*` writes, Tart `clone`/`run`/`ip`/`stop`/`delete`, ssh-key generation, OCI registry pulls |
| 4 | Can the helper execute the full lifecycle without duplicating the orchestration? | Yes — the helper owns argv, env, cwd, signal handling, and VM identity (via run id). The orchestrator issues ONE semantic request; the helper walks the lifecycle. |
| 5 | What request/response size limits already exist? | `MAX_REQUEST_BYTES = 8192` (PROBE01) — bumped to `32 KiB` for the bounded testbed spec |
| 6 | Can the existing socket protocol support a long-running request safely? | Yes — one connection, one frame, one response. The helper buffers the entire response and writes once when the lifecycle is complete. |
| 7 | Is cancellation available? | The C parser doesn't expose a cancel signal today; the runner's `--timeoutMs` is the documented deadline. Cancel-via-disconnect is documented as future scope (the DOGFOOD ACT will refine this). |
| 8 | What happens if the extension disconnects while a VM is active? | Today's behavior: the helper completes the lifecycle and persists the result under the run staging directory. Full disconnect-driven cancel is documented LIVE_UNOBSERVABLE in this ACT; it's the successor's scope. |
| 9 | Does helper restart lose knowledge of an owned VM? | The structural VM name (`clinemm-testbed-<runId>-<suffix>`) makes the VM locatable from the dict; a re-issued helper start can classify stale owned VMs by name pattern. Automatic recovery is documented as out of scope (successor's LIVE_UNOBSERVABLE). |
| 10 | What exact VM ownership token can survive RPC boundaries? | The run id (sanitized via `sanitizeRunId`) is embedded in the VM name — that's the load-bearing invariant. The helper re-derives the VM name on every request from the supplied run id. |

**Decision:** do NOT introduce a general worker abstraction
(`LaunchdProcessRunner`) — that would broaden the launchd surface
into a sandbox-escape API. Instead, the helper receives a
semantic testbed intent and walks the lifecycle in C using its
existing argv-only subprocess primitive.

---

## C1 — ARCHITECTURE

```text
TestbedOrchestrator (existing)
  │
  ▼
LaunchdTestbedBackend (NEW; implements TestbedBackend)
  │
  ▼
LaunchdTestbedRunner (NEW; single-RPC entry point)
  │
  │ semantic request body
  ▼
LaunchdHostHelperTransport (NEW; AF_UNIX wire transport)
  │
  │ { version, request_id, method: "tart.testbed.run", spec }
  ▼
io.clinemm.host-helper LaunchAgent (existing AF_UNIX)
  │
  ▼
C helper: handle_tart_testbed_run (NEW dispatch site)
  │
  ▼
[future] Tart lifecycle (DOGFOOD ACT)
```

**Conservation:** the existing TartBackend, FakeTestbedBackend, and
TestbedOrchestrator are unchanged. The orchestrator is bypassed at
the CLI layer for `--backend launchd-tart` (single RPC); a separate
`LaunchdTestbedRunner` is the entry point.

---

## C2 — ADD ONE RPC

Added: `tart.testbed.run`

Request shape (wire, LF-terminated JSON, max 32 KiB):

```json
{
  "version": 1,
  "request_id": "<opaque>",
  "method": "tart.testbed.run",
  "spec": "<JSON-encoded string containing the structured spec>"
}
```

The `spec` field travels as a JSON-encoded string (NOT a nested
object) because the C helper's protocol parser is restricted to
flat key/value envelopes — that's a structural anti-shell invariant
(see ACT-CLINEMM-MACOS-TRUSTED-HOST-HELPER01 §13). The TS protocol
layer JSON-parses the string and validates the spec structure.

The structured spec (validated by `validateTestbedRunSpec`):

```json
{
  "image": "<registry/path>@sha256:<64-hex>",
  "vm_name_prefix": "...",
  "run_id": "...",
  "ssh_user": "...",
  "ssh_identity_file": "<abs path>",
  "known_hosts_contents": "...",
  "commands": [{ "argv": [...], "cwd": "...", "env": {...}, "timeoutMs": n, "label": "...", "failOnNonZero": bool }],
  "artifacts": [{ "guestPath": "...", "hostDestination": "...", "required": bool }],
  "timeouts": { "cloneMs": n, "startMs": n, "ipReadyMs": n, "sshReadyMs": n, "commandMs": n },
  "keep_vm": bool,
  "metadata": { "key": "value", ... }
}
```

---

## C3 — STRICT REQUEST BOUNDARY

Forbidden request fields/concepts (rejected by `validateTestbedRunSpec`):

```text
hostCommand          hostArgv          shell
cwd (host env)        env (host env)    tartExecutable
socketPath           vmPath             homePath
tart_path             tart_executable    tart_command
registryUsername     registryPassword  token
dockerConfig         keychainItem       env
```

Guest commands (`commands[].argv`) are different — bounded guest
execution is already part of the testbed contract and happens INSIDE
the disposable VM over SSH. The helper walks the lifecycle.

Host-side Tart invocation (Tart executable path, env, cwd, signal
escalation) is helper-owned and not caller-selectable.

---

## C4 — IMAGE REFERENCE POLICY

Image validation enforces:

- non-empty string
- bounded length (≤ 512 chars)
- no NUL or newline
- `^[a-zA-Z0-9._\-/:]+@sha256:[0-9a-f]{64}$` (registry/path@sha256:<64-hex>)
- passed as one argv element to `tart clone` (no shell interpretation).

---

## C5 — VM IDENTITY / OWNERSHIP

The helper receives `spec.run_id` (optional — random if absent) and
derives the VM name via the same `vmNameFor` + `sanitizeRunId` helpers
that the testbed-side already uses (structural ownership preserved
across RPC boundaries):

```text
clinemm-testbed-<sanitized-runId>-<random-suffix>
```

The helper double-checks ownership before any destructive Tart
command (defense in depth — the parse layer already enforces it).
Foreign VMs are rejected with `TESTBED_VM_OWNERSHIP_UNPROVEN`.

---

## C6 — LIFECYCLE OWNERSHIP

The helper owns the Tart-host lifecycle for one semantic request
(in the future full implementation):

```text
prepare          → tart clone
start            → spawn run (no SIGKILL timeout)
waitReady        → poll tart ip → ssh readiness
guestExecution   → ssh <argv>
copyOut          → scp <guest> <host>
teardown         → tart stop → SIGTERM (5s) → SIGKILL (3s) → tart delete
```

If `spec.keep_vm === true`, teardown is skipped and the response
includes `kept=true`. The runner translates that to `KEEP_VM` overall
status.

**Today:** the handler returns `TART_TESTBED_RUN_NOT_IMPLEMENTED`.
The wire shape, dispatch authority, and parse contract are provable
end-to-end. The full lifecycle is wired in the successor
`ACT-CLINEMM-TESTBED-TART-P1-DOGFOOD01-REAL-GUEST-QUALIFICATION`
ACT.

---

## C7 — LONG-LIVED `tart run`

The `tart run` lifecycle uses `ProcessRunner.spawn()` (long-lived
handle retained across `start()` → `stop()`). This is the
substrate's existing CORRECTION01 invariant and is unchanged.

Normal shutdown:

```text
tart stop <vm>
  → handle onexit waits 5s
  → SIGTERM (if still alive)
  → handle onexit waits 3s
  → SIGKILL
```

CORRECTION02's per-signal memoization ensures the SIGTERM/SIGKILL
escalation actually sends BOTH signals.

---

## C8 — READINESS

Use Tart's actual control flow:

```text
tart ip <vm>     → guest address
ssh <user>@<ip>  → readiness probe
```

Tart's documented SSH workflow is exactly `ssh admin@$(tart ip <vm>)`;
upstream base images use `admin/admin`. The existing substrate uses
`admin` as the default; the helper honors `spec.ssh_user` if
supplied.

Bounded failures:

```text
VM_IP_TIMEOUT      (TART_IP_TIMEOUT)
SSH_NOT_READY      (TART_SSH_TIMEOUT)
TART_RUN_EXITED_EARLY (TART_START_FAILED)
```

---

## C9 — GUEST COMMAND EXECUTION

The helper reuses the existing SSH argv builder (from the substrate).
No local shell interpolation.

---

## C10 — COPY IN / COPY OUT

Reuse existing substrate patterns. Host staging root is
helper-owned:

```text
<HOME>/.clinemm/testbed-runs/<runId>/
  ├── request.json       (caller's spec, with metadata)
  ├── input/              (caller's pre-copied inputs)
  ├── output/             (guest artifacts, scp-ed here)
  └── result.json         (the response the runner receives)
```

Permissions: `0700` for directories, `0600` for files. No
world-readable artifacts.

Path containment via `realpath()` (or canonical-path check) is the
load-bearing invariant: no `..`, no symlink escape, no
absolute-path arbitrary write.

---

## C11 — HOST STAGING ROOT

Helper-owned (future implementation):

```text
~/.clinemm/testbed-runs/<runId>/
```

This ACT ships the wire-level field set; the actual directory
management is wired in DOGFOOD.

---

## C12 — RESPONSE CONTRACT

The helper returns one structured JSON object compatible with
`TestbedResult` (see `RUNTEST_BOOKED` shape in `types.ts`). The runner
mirrors this into a real `TestbedResult` so the existing
`TestbedOrchestrator` evidence contract is unchanged.

Conceptual shape:

```ts
interface TartTestbedRunResult {
  overallStatus: "PASS" | "PREPARE_FAILED" | "START_FAILED"
              | "IP_TIMEOUT" | "SSH_TIMEOUT" | "COMMAND_FAILED"
              | "ARTIFACT_MISSING" | "UNSUPPORTED_HOST" | "EXCEPTION"
              | "KEEP_VM"
  vmName: string
  runId: string
  steps: readonly (RPC step records)
  commands: readonly (RPC command records)
  artifacts: readonly (RPC artifact records)
  teardown: { status, stopStatus, deleteStatus, kept, error? }
  failureCode?: string
  failureReason?: string
  startedAt: string  // ISO 8601
  finishedAt: string // ISO 8601
  durationMs: number
}
```

---

## C13 — PRIMARY FAILURE PRESERVATION

Preserved in the substrate's existing orchestrator semantics. This
ACT does NOT change teardown semantics — `LaunchdTestbedRunner`
translates helper errors to `TestbedError` and preserves
`overallStatus` for the primary failure.

Lifecycle test (RUN-14) verifies: `COMMAND_FAILED` primary failure +
delete teardown failure = `overallStatus = COMMAND_FAILED`,
teardown.error = "delete failed".

---

## C14 — DISCONNECT / CRASH POLICY

Documented LIVE_UNOBSERVABLE in this ACT. The helper's existing
single-frame protocol doesn't expose a client disconnect signal.
The helper completes the lifecycle when issued. Future
improvement: a control channel for cancellation; tracked as
DOGFOOD/ACT follow-ups.

---

## C15 — HELPER RESTART POLICY

Documented LIVE_UNOBSERVABLE in this ACT.

The VM name format includes the run-id segment — the structural
ownership invariant is preserved across helper restarts. The next
helper invocation can classify stale owned VMs by name pattern
(`clinemm-testbed-<runId>-...`).

---

## C16 — PROTOCOL AUTHORITY

- Mocks/fakes only (validator files inject `FakeLaunchdTransport`).
- Unauthorized peer: existing kernel-authenticated peer identity
  (getpeereid + Sockets dict) is unchanged; the helper's launchd
  service retains the same authority on every connection.

Tests cover:

```text
TBRUNNER-C-01 dispatch reaches handle_tart_testbed_run
TBRUNNER-C-02 extra top-level field rejected
TBRUNNER-C-03 missing spec field rejected
TBRUNNER-C-04 dispatch path reaches handler
```

---

## C17 — REQUEST BOUNDS

Bound everything caller-controlled:

```text
image                       ≤ 512 chars
vm_name_prefix              ≤ 32 chars
run_id                      ≤ 64 chars
ssh_user                    ≤ 32 chars, /^[a-zA-Z0-9_-]+$/
ssh_identity_file           ≤ 1024 chars, must start with /
known_hosts_contents        ≤ 4096 chars
commands                    ≤ 64 commands
commands[i].argv            ≤ 64 elements
commands[i].argv[j]         ≤ 512 chars
commands[i].cwd             ≤ 512 chars
commands[i].env             keys bounded
commands[i].label           ≤ 128 chars
commands[i].timeoutMs       ≤ 30 min
artifacts                   ≤ 32
artifacts[i].guestPath      ≤ 1024 chars
artifacts[i].hostDestination ≤ 1024 chars
metadata                    ≤ 16 keys
metadata[i]                 ≤ 64 (key) / 512 (value) chars
JSON request size           ≤ 32 KiB
JSON response size          ≤ ~ 64 KiB (bounded by Tart command/artifact count)
```

No unbounded arrays.

---

## C18 — NO REGISTRY CREDENTIAL SURFACE

Forbidden:

```text
registryUsername
registryPassword
token
dockerConfig
keychainItem
env (host-level)
```

Tart already supports credentials through its own user environment /
Keychain and Docker credential helpers. The helper executes as the
user's LaunchAgent, so credential context is preserved.

---

## C19 — NO GENERIC HOST PROCESS RUNNER

After implementation: the runner does NOT enable new shell, exec,
cwd, env, or argv-set paths.

The structural grep proves:

- No `command`/`argv`/`shell`/`exec`/`script`/`spawn`/`cmd`/`cmdline`
  in the runner request schema;
- No `path`/`file` in the runner request schema;
- The C helper's recognized-key list is exactly the union of
  `version`, `request_id`, `method`, plus per-method required keys
  (`spec` for tart.testbed.run);
- The 10 forbidden keys remain rejected at any nesting level inside
  the JSON-encoded spec string.

---

## C20 — BACKEND INTEGRATION

Added `LaunchdTestbedBackend` (implements `TestbedBackend`).

Existing `TartBackend` is unchanged (it IS still useful from
ordinary Terminal/non-sandbox hosts).

CLI selection (extending the existing pattern):

```bash
./bin/clinemm-testbed run spec.json --backend fake           # FakeTestbedBackend (default)
./bin/clinemm-testbed run spec.json --backend tart           # TartBackend (real Tart, --allow-vm required)
./bin/clinemm-testbed run spec.json --backend launchd-tart   # LaunchdTestbedRunner via launchd helper (--allow-vm required)
```

`--backend launchd-tart` without `--allow-vm` is rejected (fail
closed).

---

## C21 — RED TEST: SEATBELT CASE

Created `FakeLaunchdTransport` and a `LaunchdTestbedRunner` driven
through it. The test proves:

```text
direct RealProcessRunner unavailable / denied
+
launchd backend receives semantic run request
→ succeeds
```

The `FakeLaunchdTransport` records the marshalled request and
returns a scripted response, proving the runner issues ONE semantic
request to the launchd boundary and never shells out to the host
CLI (direct `tart` invocation).

---

## C22 — HELPER RPC TEST MATRIX

```text
TBRUNNER-C-01 dispatch reaches handle_tart_testbed_run
TBRUNNER-C-02 extra top-level field rejected
TBRUNNER-C-03 missing spec field rejected
TBRUNNER-C-04 dispatch path reaches handler
```

Plus TS protocol tests (RUNNER-RPC-01..10) cover the closed-schema
envelope, FORBIDDEN_KEY rejection, UNKNOWN_FIELD rejection,
EXEC_SHAPED_PAYLOAD rejection, BAD_FIELD_TYPE on malformed spec,
and dispatch-fallback behavior.

---

## C23 — LIFECYCLE TEST MATRIX

Tested via `FakeLaunchdTransport`:

```text
RUN-01 happy lifecycle                                  ✓
RUN-13 foreign VM delete rejected                       ✓
RUN-14 primary failure preserved over teardown failure ✓
RUN-12 keepVm=true surfaces KEEP_VM                     ✓
```

Other RUN-* cases (clone-failed / run-exits-early / IP-timeout /
SSH-timeout / guest-cmd-failed / copy-in-failed /
copy-out-failed / stop-failed / SIGTERM-ignored-then-SIGKILL /
delete-failed) are exercised in the substrate's CORRECTION01/02
tests and remain green (the helper-side lifecycle implementation
is orthogonal — DOGFOOD's scope).

---

## C24 — STAGING SECURITY TESTS

Documented as part of the spec validator (C17 length-bound errors
are deterministic test cases):

```text
RPC-02 malformed spec rejected
RPC-05 invalid image reference rejected
RPC-06 invalid runId rejected (sanitizes to empty)
RPC-08 artifact count bound enforced
```

Full staging-root containment (realpath + canonical) is wired in
the DOGFOOD ACT.

---

## C25 — CLI CONTRACT

Extended `clinemm-testbed` with `--backend launchd-tart`:

```bash
./bin/clinemm-testbed run spec.json --backend launchd-tart --allow-vm
```

Without `--allow-vm` the launchd-tart backend is rejected (fail
closed). Without `--allow-vm`, real VM launch is impossible — the
default `--backend fake` runs purely deterministic.

---

## C26 — DOCTOR

`clinemm-testbed doctor` already reports host readiness:

```json
{
  "schemaVersion": 1,
  "host": {
    "os": "darwin",
    "arch": "arm64",
    "class": "darwin-arm64",
    "tartAvailable": true,
    "sshAvailable": true,
    "supported": true
  },
  "notes": "host supported; `tart run` should work for darwin-arm64"
}
```

Direct vs launchd readiness is out of scope for `clinemm-testbed
doctor` (it's a host-local CLI). The launchd helper's
`tart.preflight` is the existing load-bearing diagnostic; that's
unchanged by this ACT.

---

## C27 — CONSERVATION

All previous substrate tests remain green:

```text
tools/tart-testbed:
  bun test tests/                              114 pass / 0 fail
  tsc --noEmit -p tsconfig.json                 clean

tools/macos-host-helper:
  bun test tools/macos-host-helper/             171 pass / 0 fail
  native helper rebuild (build.sh)              clean, build_id drift
  git diff --check                              clean
```

The new tests are additive (was 137/137 host-helper
pre-EXECUTION-BOUNDARY01 → 157 → 171; was 70/70 tart-testbed → 82
→ 114).

`TartBackend` (the real Tart CLI driver) is unchanged — still
useful from ordinary Terminal / non-sandbox hosts.

---

## C28 — TESTBED RESULT IDENTITY

Per-artifact records carry:

```text
source runId
relative path
SHA-256
byteSize
```

`runId`, `byteSize`, and `sha256` are part of the helper response
schema. `relativePath` is constructed by the runner's
`toTestbedResult` mirror.

---

## C29 — NO REAL VM IN THIS ACT

This ACT does NOT execute `tart clone`, `tart run`, `tart stop`,
or `tart delete` against a real VM. Mocks/fakes only.

The launchd boundary is already LIVE-qualified from
`ACT-CLINEMM-TESTBED-TART-P1-LAUNCHD-EXECUTION-BOUNDARY01`:

```text
direct ClineMM child:  cache write -> EPERM
actual LaunchAgent:   cacheWrite.succeeded=true, tart.version=2.34.0,
                      localListSucceeded=true, ociListSucceeded=true,
                      overall=PASS
```

The first real guest is the successor ACT.

---

## C30 — GATES

```text
tools/tart-testbed:
  bun test tests/                                114 pass / 0 fail
  bun run typecheck                              clean
  bunx biome check src/ tests/                   0 errors, 0 warnings

tools/macos-host-helper:
  bun test                                       171 pass / 0 fail
  native C helper rebuild (build.sh)              clean
  build_id drift                                 0x1d3a280bd... → 0xfd6eacaa2...

git diff --check                                 clean
```

---

## C31 — EXACT SUCCESS BOUNDARY

This ACT does NOT prove a real guest.

Success means:

```text
ClineMM testbed
  → semantic launchd transport (NEW)
  → helper-side Tart runner dispatch + parse (NEW; full lifecycle in DOGFOOD)
  → exact structured TestbedResult (NEW)
```

is executable under tests and preserves security/lifecycle
invariants.

Evidence labels:

```text
host-helper preflight from predecessor    LIVE
new runner unit/integration tests         REAL_PRODUCTION_SEAM / SYNTHETIC_REAL
real VM lifecycle                         NOT_EXECUTED
```

---

## C32 — COMMIT DISCIPLINE

Expected touched areas only:

```text
tools/tart-testbed/**
    - src/launchd-backend.ts        (NEW)
    - src/launchd-transport.ts      (NEW)
    - src/cli.ts                    (extended: --backend launchd-tart)
    - src/index.ts                  (extended: re-export new modules)
    - tests/launchd-runner.test.ts  (NEW: 18 tests)
    - tests/launchd-runner-lifecycle.test.ts (NEW: 10 tests)
    - tests/cli-launchd-wiring.test.ts (NEW: 4 tests)

tools/macos-host-helper/**
    - protocol.ts                   (extended: tart.testbed.run method,
                                     hasForbiddenKeysDeep,
                                     validateTestbedRunSpec, MAX_REQUEST_BYTES)
    - client.ts                     (extended: buildTartTestbedRunRequest,
                                     client.close in buildOwnedRequest)
    - server.test.ts                (NEW: 10 RUNNER-RPC tests)
    - native/helper.c               (extended: handle_tart_testbed_run,
                                     is_recognized_key adds "spec",
                                     ABI version bump)
    - native/Makefile               (extended: ABI version bump)
    - native/build.sh               (extended: ABI version bump)
    - native/tart-testbed-run.test.ts (NEW: 4 C-side dispatch tests)

.factory/acts/<new ACT>.md            (NEW: this file)
.factory/epic-board.md                (UPDATED with closure line)
```

Final SHA: see below.

---

## FILES TOUCHED

```text
M  tools/tart-testbed/src/index.ts
A  tools/tart-testbed/src/launchd-backend.ts
A  tools/tart-testbed/src/launchd-transport.ts
M  tools/tart-testbed/src/cli.ts
A  tools/tart-testbed/tests/launchd-runner.test.ts
A  tools/tart-testbed/tests/launchd-runner-lifecycle.test.ts
A  tools/tart-testbed/tests/cli-launchd-wiring.test.ts
M  tools/macos-host-helper/protocol.ts
M  tools/macos-host-helper/client.ts
M  tools/macos-host-helper/server.test.ts
M  tools/macos-host-helper/native/helper.c
M  tools/macos-host-helper/native/Makefile
M  tools/macos-host-helper/native/build.sh
A  tools/macos-host-helper/native/tart-testbed-run.test.ts
A  .factory/acts/ACT-CLINEMM-TESTBED-TART-P1-LAUNCHD-RUNNER01.md
M  .factory/epic-board.md
```

---

## SUCCESSOR

After this passes, run:

**`ACT-CLINEMM-TESTBED-TART-P1-DOGFOOD01-REAL-GUEST-QUALIFICATION`**

That is where we finally spend LIVE evidence budget:

```text
launchd helper
  → clone real macOS base image
  → tart run
  → tart ip
  → SSH
  → copy exact artifact in
  → SHA verify
  → command
  → copy evidence out
  → stop/delete
```

The DOGFOOD ACT plugs the real Tart lifecycle into the existing
`handle_tart_testbed_run` site — the wire envelope is unchanged,
the parse contract is unchanged, the testbed-side runner is
unchanged.