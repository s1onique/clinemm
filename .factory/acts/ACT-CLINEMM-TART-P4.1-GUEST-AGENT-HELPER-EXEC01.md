# ACT-CLINEMM-TART-P4.1-GUEST-AGENT-HELPER-EXEC01

**Status:** IN PROGRESS.

**Predecessor:** `ACT-CLINEMM-TART-P4-IMPORTED-SONOMA-REAL-GUEST-LIFECYCLE01` (P4 ACT scaffold committed at 537cc5f24; operator-driven Phases 2-6 remain DEFERRED to operator-side `tart run` / `tart exec` / `tart stop`).

**SUBJECT_HEAD:** `537cc5f24ce51bc75d5d4f4f01b3c2eb940bdc75` (main; the P4 scaffold commit; clean working tree).
**ENTRY_HEAD:** identical (no production source change yet).
**DOGFOOD_SOURCE_HEAD:** identical.

## 0. Mission

Implement and qualify one non-destructive, explicitly authorized guest-agent smoke operation through ClineMM's existing macOS host helper: a `tart.guest.smoke` RPC that runs exactly two fixed guest diagnostics (`/usr/bin/sw_vers` and `/usr/bin/uname -a`) inside the already-running imported Sonoma VM, without granting the ClineMM client control over arbitrary guest commands, host processes, VM creation, or VM destruction.

## 1. Source and repository gate

**Gate S0:** `PASS_REAL_PRODUCTION_SEAM_IDENTIFIED`

The relevant production seam is the AF_UNIX-dispatched `clinemm-host-helper` C binary at `tools/macos-host-helper/native/helper.c`, with the TypeScript protocol adapter at `tools/macos-host-helper/protocol.ts` and the client at `tools/macos-host-helper/client.ts`. Existing test harnesses (fake-Tart injection, status-file rendezvous, AF_UNIX socket fallback) are at `tools/macos-host-helper/native/{helper,tart-preflight,tart-testbed-run,real-lifecycle-correction01}.test.ts`. The launchd transport is at `tools/tart-testbed/src/launchd-backend.ts`. Working tree is clean at `537cc5f24` — no `git status --short` output.

## 2. Frozen RPC contract

**Gate S1:** `PASS_CLOSED_GUEST_SMOKE_PROTOCOL`

One new method, exactly: `tart.guest.smoke`.

Wire envelope (the only legal shape):
```json
{"version":1,"request_id":"<non-empty string>","method":"tart.guest.smoke"}
```

**No caller-supplied** VM name, TART_HOME, executable, argv, environment, credentials, directory, timeout, command, shell, script, path, or file. The 10 forbidden keys (`command`, `argv`, `shell`, `exec`, `script`, `spawn`, `cmd`, `cmdline`, `path`, `file`) remain rejected at any nesting level.

The native handler constructs the exact argv vectors:
- `<tart> exec <authorized-vm> /usr/bin/sw_vers`
- `<tart> exec <authorized-vm> /usr/bin/uname -a`

No shell interpolation, no `sh -c`, no caller-driven argv, no general-purpose `guest.exec`.

Response body is a single object containing:
- `request_id` (echo)
- `service` (`"clinemm-host-helper"`)
- `helper_build_id` (embedded 64-hex build id)
- `authorized_vm` (the operator-configured VM name; never a caller field)
- `tart_home` (the operator-configured TART_HOME; never a caller field)
- `tart_path` (the resolved sealed-allowlist Tart executable)
- `tart_version` (output of `tart --version`, JSON-escaped)
- `results.sw_vers` — `{ exit_code, stdout, stderr, duration_ms }`
- `results.uname_a` — `{ exit_code, stdout, stderr, duration_ms }`
- `duration_ms` (total wallclock)
- `overall` — `"PASS"` iff both diagnostics exit 0 and neither output was truncated; otherwise an explicit error code.

Explicit error codes (mutually exclusive, exactly one):
`SMOKE_NOT_CONFIGURED`, `VM_NOT_AUTHORIZED`, `VM_NOT_RUNNING`, `TART_NOT_FOUND`, `TART_EXEC_FAILED`, `TART_EXEC_TIMEOUT`, `GUEST_COMMAND_NONZERO`, `RESULT_TRUNCATED`, `INTERNAL_ERROR`, `INTERNAL_TRUNCATION`.

The handler must NEVER emit `ok:true` for a partial/truncated result. Truncation of either diagnostic's output is reported as `RESULT_TRUNCATED` and `ok:false`. The truncation check is structural (the capture buffer has a one-byte residual space, so we can detect when the captured bytes equal the buffer cap with no NUL terminator within that range).

## 3. Trusted VM binding

**Gate S2:** `PASS_HELPER_OWNED_VM_AUTHORIZATION`

The VM target is bound by the helper at startup, not by the RPC. A client-provided VM name is forbidden. Two env vars are the trusted configuration:
- `CLINEMM_SMOKE_VM` — exact imported VM name (string).
- `CLINEMM_SMOKE_TART_HOME` — exact TART_HOME path (string).

When either is unset/empty, the smoke capability is disabled and `tart.guest.smoke` returns `SMOKE_NOT_CONFIGURED`. This is the production fail-closed default; without explicit operator authorization, the smoke RPC is unreachable.

For the first qualification (this ACT), the operator-bound values are exactly:
- `CLINEMM_SMOKE_VM=clinemm-p3-sonoma-imported`
- `CLINEMM_SMOKE_TART_HOME=/private/tmp/clinemm-tart-p3-20261015T131912Z-30833`

The configuration is read at request dispatch time (not at helper startup, so a test can restart the helper with different trusted bindings per case). It is NOT writable through the RPC. It is NOT derived from the request envelope, the `HOME` env var, the `TART_HOME` env var, the caller's cwd, or any other client-controlled field.

At the moment of dispatch, the helper validates the configured TART_HOME storage identity:
- `lstat(tart_home)` succeeds; is a directory; `S_ISDIR(st.st_mode)`.
- `realpath(tart_home)` does not return NULL.
- `lstat()` on the canonicalized path is not a symlink (no resolution surprise).
- The `vms/` subdirectory exists; `lstat(vms)` is a directory.
- `access(tart_home, X_OK)` succeeds (so `tart` can write its lock files there).
- Owner UID equals the helper's UID (the launchd-managed helper runs as uid 501 / `chistyakov`).

If any of the above fails, return `SMOKE_NOT_CONFIGURED` (NOT `TART_NOT_FOUND` or `INTERNAL_ERROR` — the identity check is a configuration concern, not a runtime concern). Do not fall back silently to the user's default TART_HOME.

The Tart child environment is sealed: `PATH` (a fixed allowlist), `HOME=<helper's resolved home>`, `LANG=C.UTF-8`, `LC_ALL=C.UTF-8`, `TMPDIR=/tmp`, **and `TART_HOME=<configured TART_HOME>` explicitly injected**. No other env vars reach the child.

The ACT does NOT hardcode the operator's personal path in general production source; the binding is read from the environment at dispatch time.

## 4. RED reproduction

**Gate S3:** `PASS_RED_REPRODUCED`

Before implementing dispatch, prove with a bounded executable witness against the real native helper protocol that:
- A correctly shaped `tart.guest.smoke` request is currently unsupported (helper returns `METHOD_NOT_ALLOWED`).
- Additional `argv`, `command`, `vm_name`, `path`, or environment fields are rejected at the parse layer (parser returns `EXEC_SHAPED_PAYLOAD` or `UNKNOWN_FIELD`).
- Unconfigured smoke access cannot execute anything (even after dispatch is added, missing `CLINEMM_SMOKE_VM` returns `SMOKE_NOT_CONFIGURED`).
- The existing `tart.testbed.run` contract remains unchanged (its existing test suite still passes).

RED witness file: `red-witness.log` (captured via test runner). GREEN proof: same test file passes with the dispatch implemented.

## 5. Bounded production implementation

**Gate S4:** `PASS_GUEST_SMOKE_IMPLEMENTATION`

Modify only the existing native helper and protocol adapter. Reuse:
- The existing trusted Tart executable resolver (`tart_resolve_executable`).
- The existing bounded argv-only subprocess infrastructure (`tart_run_argv` for the Tart parent; `fork`/`pipe`/`waitpid` directly for the `tart exec` argv vector).
- Existing JSON encoding and response-correlation helpers (`write_json_string`, `respond_*`).
- Existing native test infrastructure (`build.sh`, AF_UNIX fallback, `CLINEMM_TART_EXECUTABLE` env-override, status-file rendezvous).

Add:
- `CLINEMM_SMOKE_VM` and `CLINEMM_SMOKE_TART_HOME` env var reads in the dispatch site.
- A new TART_HOME identity validator (directory, ownership, no symlink, vms/ subdir).
- A new handler `handle_tart_guest_smoke` that:
  1. Reads the env-bound config.
  2. Validates the TART_HOME identity.
  3. Resolves the Tart executable.
  4. Captures `tart --version` (bounded 10s) for the response.
  5. Runs `<tart> exec <vm> /usr/bin/sw_vers` (bounded 30s).
  6. Runs `<tart> exec <vm> /usr/bin/uname -a` (bounded 30s).
  7. Classifies `overall=PASS` only if both exit 0 and neither output is truncated.
  8. Emits the structured response.

The TypeScript protocol layer (`protocol.ts`) gets the matching method entry: `tart.guest.smoke` in `ALLOWED_METHODS`, an empty `METHOD_REQUIRED_KEYS[tart.guest.smoke]`, a `ParsedTartGuestSmokeRequest` interface, and a `dispatch()` arm that returns `METHOD_NOT_AVAILABLE_IN_TS_FALLBACK` (consistent with the existing launchd-only methods).

The client (`client.ts`) does NOT gain a typed call site for this ACT — the smoke is dispatched directly against the C helper via the existing AF_UNIX transport.

### Absolutely forbidden production effects

The smoke handler must contain no path to:
- `tart clone`
- `tart pull`
- `tart run`
- `tart stop`
- `tart delete`
- Host shell execution (`/bin/sh`, `bash -c`)
- Helper restart
- LaunchAgent modification

Do not change the existing `tart.testbed.run` lifecycle to satisfy this feature.

The restriction is enforced by the native handler (not just documented in TypeScript): the only argv vectors constructed inside `handle_tart_guest_smoke` are the two `<tart> exec <vm> /usr/bin/...>` invocations. A grep for `tart clone` / `tart pull` / `tart run` / `tart stop` / `tart delete` / `sh -c` / `/bin/sh` inside the smoke handler body must produce zero matches.

## 6. Security and conservation tests

**Gate S5:** `PASS_GUEST_SMOKE_SECURITY_CONSERVATION`

Use the real compiled native helper and the existing test harness. The fake-Tart binary is a small `/bin/sh` script that simulates tart behavior for deterministic error injection.

| ID | Scenario | Expected |
|---|---|---|
| GS-01 | Valid smoke request, configured VM, real Tart → real Sonoma | Fixed commands executed, both exit 0, `overall=PASS` |
| GS-02 | Extra `command` field | Rejected at parser as `EXEC_SHAPED_PAYLOAD` |
| GS-03 | Extra `vm_name` / `path` / `env` field | Rejected at parser as `UNKNOWN_FIELD` |
| GS-04 | Missing `CLINEMM_SMOKE_VM` env | `SMOKE_NOT_CONFIGURED`, no fork |
| GS-05 | `CLINEMM_SMOKE_VM` differs from real VM (or a non-existent VM) | `TART_EXEC_FAILED`, no false PASS |
| GS-06 | Stopped VM (`tart exec` against a non-running VM) | `TART_EXEC_FAILED` (nonzero exit), no false PASS |
| GS-07 | Guest command returns nonzero (fake-Tart that exits 7) | `GUEST_COMMAND_NONZERO` |
| GS-08 | Guest command exceeds the 30s timeout (fake-Tart that sleeps 60s) | `TART_EXEC_TIMEOUT`, child reaped, no orphaned subprocess |
| GS-09 | Oversize output (fake-Tart that prints 64 KiB) | `RESULT_TRUNCATED`, response marks truncation explicitly, `ok:false` |
| GS-10 | Two concurrent smoke requests | Both succeed with correct request correlation; no shared mutable state corruption |
| GS-11 | Raw Unix-socket bypass attempt — hand-crafted envelope with extra `argv` field | Native validation rejects with `EXEC_SHAPED_PAYLOAD` |
| GS-12 | Existing testbed lifecycle (`tart.testbed.run`) | No regression — `tart-testbed-run.test.ts` passes |
| GS-13 | Cancellation / client disconnect mid-flight | Subprocess reaped (SIGTERM, then SIGKILL after grace), no zombie, response NOT emitted |
| GS-14 | Smoke invocation while a `tart.testbed.run` is in flight | Smoke proceeds against the configured VM (the smoke handler does not contend with the testbed lifecycle because the smoke VM is fixed and not managed by the testbed) |

The fake-Tart script is invoked only for error injection (GS-07..09) and security-conservation tests (GS-02, GS-03, GS-11). GS-01 uses the real Tart binary against the real imported Sonoma guest.

Necessity: temporarily disable the new native dispatch entry (e.g., make the `strcmp(m->val, "tart.guest.smoke")` branch return `SMOKE_NOT_CONFIGURED` unconditionally); require the successful smoke witness (GS-01 with a fake-Tart that mimics a healthy guest — exit 0, short outputs) to fail; restore; verify GREEN. Do not add a second review cycle.

## 7. Real guest qualification

**Gate S6:** `PASS_REAL_GUEST_AGENT_HELPER_SMOKE`

This is the load-bearing milestone. Do not perform a real execution until source tests pass and the operator has explicitly authorized the VM target (the operator authorization is the ClineMM task description itself + the proven P4 ENTRY evidence).

### Step A — Compile and bind

Build the native helper from the actual current source HEAD (537cc5f24 + this ACT's diff). Record:
- `SOURCE_HEAD` = `537cc5f24ce51bc75d5d4f4f01b3c2eb940bdc75` (and the post-ACT commit hash)
- `BINARY_PATH` = `tools/macos-host-helper/native/helper`
- `BINARY_SHA256` = `<shasum -a 256 helper>`
- `BUILD_ID` = embedded in the binary via the Makefile/build.sh mechanism
- `TART_VERSION` = output of `tart --version` against the system tart

Do not replace the installed LaunchAgent service from ClineMM. The dev-fallback binary at `tools/macos-host-helper/native/helper` is the unit under test.

### Step B — First live test through an isolated helper

Use a run-owned, operator-started development helper on a separate Unix socket, with the frozen trusted smoke target. Set:
- `CLINEMM_HOST_HELPER_SOCKET=/tmp/clinemm-smoke-p41-isolated.sock`
- `CLINEMM_HELPER_STATUS_PATH=/tmp/clinemm-smoke-p41-isolated.status.json`
- `CLINEMM_SMOKE_VM=clinemm-p3-sonoma-imported`
- `CLINEMM_SMOKE_TART_HOME=/private/tmp/clinemm-tart-p3-20261015T131912Z-30833`
- `PATH` is the system PATH (so the real `tart` binary resolves).

Launch the dev helper: `tools/macos-host-helper/native/helper` with those envs.

Evidence classification: `REAL_HELPER_CODE / DEV_FALLBACK_TRANSPORT`. This is NOT the production launchd qualification.

### Step C — Operator boots imported VM

From the normal host Terminal (not the Seatbelted agent), with `TART_HOME=/private/tmp/clinemm-tart-p3-20261015T131912Z-30833`:
```bash
tart run "clinemm-p3-sonoma-imported" --no-graphics
```

Keep the Tart process under operator control. Do not automatically create or delete a VM.

### Step D — Real smoke RPC

Send the fixed `tart.guest.smoke` request to the isolated helper. The agent emits `01-isolated-helper-build.txt`, `02-isolated-helper-start.txt`, `03-isolated-helper-status.json`; the operator runs `tart run`; the agent (or the operator, by paste) emits `04-real-tart-run-bootstrap.txt` showing the Tart boot output. Then the agent sends the smoke RPC and emits `05-real-smoke-rpc.json`. After that:
- The agent emits `06-real-tart-list-during-smoke.json` proving the imported VM is still `running` (not stopped, not deleted, no foreign VM created).
- The agent emits `07-real-tart-list-post-shutdown.json` (when the operator stops the VM via the P4 §9 final shutdown) showing the VM is back in `stopped` state and was NOT deleted.

Require (per the ACT §0 mission):
- Real Sonoma guest identity (`ProductName: macOS`, `ProductVersion: 14.x`, `Build: 23J520`).
- Successful `sw_vers` (exit 0, non-truncated, plausible body).
- Successful `uname -a` (exit 0, non-truncated, plausible body, `Darwin ... arm64`).
- Correct request correlation.
- No additional VM process created.
- No `tart stop` or `tart delete` issued.
- Original VM still running afterward.

## 8. Installed production qualification

**Gate S7:** `PASS_INSTALLED_LAUNCHD_GUEST_SMOKE`

The existing installed helper cannot be assumed to support the newly compiled method. Its build_id is `85a87a825c9050768e471cb2a1799c5be811dc1197e984918aa169e453bd5b8e` (recorded in P4 entry evidence). The new helper has a different build_id (because the C source changed). Record `INSTALLED_HELPER_UPDATE_REQUIRED`.

Do not automatically bootstrap, unload, restart, or replace the installed helper. Any installation or reactivation requires a separately authorized operator host-maintenance step, outside ordinary Seatbelted execution.

After a safely installed version is independently verified (this is out-of-scope for this ACT), repeat the exact fixed smoke request through the canonical socket. Require:
- Verified installed build identity (matches the freshly built binary's `g_build_id`).
- Same fixed guest diagnostics.
- Actual launchd helper execution.
- No lifecycle mutation.
- Original imported VM retained.

If installed activation cannot safely be performed, close the implementation with S6 evidence and S7 explicitly outstanding. Do not pretend the dev helper is the installed launchd helper.

## 9. Final shutdown

After live testing, the operator stops the imported VM:
```bash
TART_HOME="/private/tmp/clinemm-tart-p3-20261015T131912Z-30833" \
  tart stop "clinemm-p3-sonoma-imported"
```

Verify:
- VM is stopped (`tart list --source local` shows `State: stopped`).
- Original `tart run` process exited.
- Imported VM remains available (NOT deleted; the VM is a protected qualification asset).
- No foreign VM was affected (`tart list` shows exactly one VM, the original imported one).

The helper itself must not shut down the imported VM. The helper has no `tart stop` code path; the only argv vectors in the smoke handler are the two `tart exec` invocations.

## 10. Executable gates

Run, with exit codes recorded:
- `bash tools/macos-host-helper/native/build.sh` (compile native helper)
- `bun test tools/macos-host-helper/native/tart-guest-smoke.test.ts` (new test file)
- `bun test tools/macos-host-helper/native/tart-preflight.test.ts` (regression: no-op)
- `bun test tools/macos-host-helper/native/tart-testbed-run.test.ts` (regression: must still pass)
- `bun test tools/macos-host-helper/native/helper.test.ts` (regression)
- `bun test tools/macos-host-helper/server.test.ts` (TS protocol regression)
- `bun test tools/macos-host-helper/client.test.ts` (TS client regression)
- `bunx tsc --noEmit -p tools/macos-host-helper` (typecheck)
- `biome check tools/macos-host-helper/protocol.ts tools/macos-host-helper/client.ts` (lint)
- `git diff --check` (whitespace)

ACT-owned failures: zero. The full monorepo suite is NOT required unless a shared contract actually changed.

## 11. Artifact identity

```
ENTRY_HEAD:                  537cc5f24ce51bc75d5d4f4f01b3c2eb940bdc75
SUBJECT_HEAD:                <post-ACT commit hash>
HELPER_SOURCE_HEAD:          <post-ACT commit hash>
HELPER_BINARY_SHA256:        <recorded at Step A>
HELPER_BUILD_ID:             <embedded 64-hex from build.sh>
INSTALLED_HELPER_BUILD_ID:   85a87a825c9050768e471cb2a1799c5be811dc1197e984918aa169e453bd5b8e (pre-ACT; INSTALLED_HELPER_UPDATE_REQUIRED)
TART_VERSION:                <recorded at Step A>
TART_HOME:                   /private/tmp/clinemm-tart-p3-20261015T131912Z-30833
AUTHORIZED_VM_NAME:          clinemm-p3-sonoma-imported
GUEST_OS_VERSION:            <from real sw_vers transcript>
GUEST_ARCH:                  <from real uname -a transcript; expected: arm64>
GUEST_COMMAND_RESULTS:       { sw_vers: PASS, uname_a: PASS } (or explicit failure codes)
REAL_GUEST_SMOKE:            PASS (Gate S6)
INSTALLED_LAUNCHD_SMOKE:     OUTSTANDING (Gate S7; INSTALLED_HELPER_UPDATE_REQUIRED)
VM_SHUTDOWN:                 PASS (operator-driven; no helper-driven shutdown)
VM_PRESERVED:                PASS (VM still listed; Size 27, Disk 50, State: stopped)
```

No simulated-to-live evidence promotion. No predicted future SHAs. No speculative installed-version claims.

## 12. Stop rules

### P0 — HALT

- Arbitrary host or guest execution exposed.
- Caller-selected VM or executable.
- Invalid target identity accepted.
- Native parser bypass.
- Foreign VM mutation.
- Destructive operation against imported source VM.
- Launchd mutation from the agent.
- Seatbelt relaxation.
- Failed guest command reported successful.
- Unbounded subprocess escape.
- Unexpected tracked dirt.
- Artifact identity mismatch.

### P1 — fix once

- Narrow protocol typing error.
- Bounded argv construction error.
- Correctly identified test-harness defect.
- Incorrect target configuration.
- Output-capture issue.

### P2 — never block

- Comments.
- Board formatting.
- Historical SHA prose.
- Unrelated Factory schema residue.

Do not initiate another pre-execution review after the bounded fix unless a new P0 appears.

## 13. Closure

Allowed verdicts:
- `PASS_GUEST_SMOKE_IMPLEMENTATION`
- `PASS_REAL_GUEST_AGENT_HELPER_SMOKE`
- `PASS_INSTALLED_LAUNCHD_GUEST_SMOKE` (only if S7 is achieved)
- `PASS_WITH_NONBLOCKING_RESIDUE`
- `CLOSED_HALTED_CLEAN`

Update `.factory/epic-board.md` once at terminal closure. Commit only ACT-owned changes. No blank evidence templates. No new general Tart architecture plan.

## Next cursor

After S6 PASS (and S7 if achieved): `ACT-CLINEMM-TART-P5-EXACT-HEAD-VSIX-DOGFOOD01`. P5 will use the working Tart substrate to verify the installed ClineMM VSIX, existing Elm kernels, terminal observations, and canonical task completion.

---

**-- end of ACT document; status is IN PROGRESS pending real guest smoke (operator-driven `tart run` + agent-driven `tart.guest.smoke` + operator-driven `tart stop`) --**
