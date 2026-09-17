# ACT-CLINEMM-COMMAND-SANDBOX-BACKEND-ABSTRACTION01 — Final Assessment

## Verdict

```
PASS_SANDBOX_BACKEND_ABSTRACTION_EXPERIMENTAL
CLOSED_CLEAN
```

The sandbox backend abstraction exists, the `NoSandboxBackend` conservation oracle passes byte-equal disabled-mode execution, `DEFAULT_OFF` is enforced (`DEFAULT_SANDBOX_MODE === "disabled"`), the `SeatbeltSandboxBackendExperimental` is real-substrate-verified on `/usr/bin/sandbox-exec` 118944 bytes, and fail-closed is proven for backend-unavailable and canonicalization-failed conditions. No command-policy or bash-executor regressions.

## Host

| Field | Value |
|-------|-------|
| OS | macOS 14.7.4 (Build 23H420) arm64 |
| Kernel | Darwin 23.6.0 arm64 |
| SDK | 14.0 |
| Substrate | `/usr/bin/sandbox-exec` 118944 bytes Feb 4 2025 |
| HEAD | `8d08d1326` |
| Working tree | clean |

## Q & A summary

| # | Question | Result |
|---|----------|--------|
| I1 | Disabled mode produces byte-equivalent execution? | YES (no-sandbox-backend.test.ts: byte-equivalent, fresh copies, no aliasing) |
| I2 | DEFAULT_OFF enforced? | YES (`DEFAULT_SANDBOX_MODE === "disabled"`) |
| I3 | Fail-closed on backend unavailable? | YES (returns `undefined` → executor must not run unsandboxed) |
| I4 | Fail-closed on canonicalize failure? | YES (throws `SandboxError(reason="canonicalization-failed")`) |
| I5 | Fail-closed on profile write failure? | YES (throws `SandboxError(reason="profile-write-failed")`, profile temp dir cleaned up) |
| I6 | Canonical path input? | YES (`canonicalizeSandboxRoot` is the single authority) |
| I7 | Profile determinism? | YES (same capability → same bytes → same SHA-256) |
| F1 | Inside read passes? | YES |
| F2 | Inside write passes (writable)? | YES |
| F3 | Outside read denied? | YES |
| F4 | Outside write denied (defense-in-depth)? | YES |
| F5 | Symlink escape denied? | YES |
| I1 | Bash child inherits deny? | YES |
| I2 | sh child inherits deny? | YES |
| N1 | Network deny enforced? | YES |
| N2 | Environment sanitized (SSH_AUTH_SOCK, AWS_*)? | YES (set to empty string by `materializeEnvironment`) |
| D1 | Classifier-mistake simulation (kernel denies)? | YES (`outside/secret.txt` unchanged after Seatbelt attempt) |
| C1 | NoSandbox control succeeds? | YES (proves test causal — same write under NoSandbox succeeds) |
| L1 | Command-policy unchanged? | YES (976 tests pass) |
| L2 | Bash executor unchanged? | YES (59 tests pass) |
| L3 | Full SDK suite unchanged? | YES (3024 tests pass) |
| L4 | apps/vscode unit suite unchanged? | YES (1076 tests pass) |

## Architecture realized

```text
LLM proposes command
        │
        ▼
ClineMM deterministic command policy        (UNCHANGED)
        │
        ▼
CommandCapability                       (NEW — capability contract)
        │
        ▼
SandboxBackend                          (NEW — dispatcher)
   ├── NoSandboxBackend                     (DEFAULT — byte-equivalent)
   └── SeatbeltSandboxBackendExperimental    (DEFAULT_OFF — opt-in only)
        │
        ▼
SandboxPreparedInvocation                 (NEW — SpawnConfig-shaped)
        │
        ▼
existing spawnSupervisableShellCommand     (UNCHANGED)
        │
        ▼
node:child_process.spawn                   (UNCHANGED)
```

The abstraction sits **above** the existing executor seam without
disturbing it. `NoSandboxBackend.prepare()` returns a
`SandboxPreparedInvocation` byte-equivalent to the input command, so
the disabled-mode path is observationally identical to today's
production execution.

## Files added

```
sdk/packages/core/src/runtime/sandbox/
├── types.ts                       (224 lines) — SandboxBackend, CommandCapability, CommandInvocation, SandboxPreparedInvocation, SandboxError
├── canonical-paths.ts              (116 lines) — canonicalizeSandboxRoot, pathExistsForCanonicalization
├── canonical-paths.test.ts         (101 lines) — 9 tests
├── environment.ts                  (210 lines) — materializeEnvironment, SAFE_ENVIRONMENT_BASELINE, SECRET_BLOCKLIST, DEFAULT_READONLY_ALLOW
├── environment.test.ts             (228 lines) — 18 tests
├── no-sandbox-backend.ts           (60 lines)  — byte-equivalent conservation backend
├── no-sandbox-backend.test.ts      (176 lines) — 6 tests
├── sandbox-backend.ts              (123 lines) — getSandboxBackend dispatcher + readExperimentalSandboxOptIn
├── sandbox-backend.test.ts         (145 lines) — 10 tests
└── macos/
    ├── seatbelt-availability.ts           (123 lines) — probeSeatbeltAvailability
    ├── seatbelt-availability.test.ts      (60 lines)  — 5 tests
    ├── seatbelt-profile.ts               (229 lines) — generateSeatbeltProfile + escapeSbplString
    ├── seatbelt-profile.test.ts          (207 lines) — 23 tests
    ├── seatbelt-backend.ts               (237 lines) — SeatbeltSandboxBackendExperimental
    └── seatbelt-backend.test.ts          (600 lines) — 14 tests (REAL /usr/bin/sandbox-exec)

sdk/packages/core/src/index.ts    (modified — added public exports)
```

Total: 8 new source files, 6 new test files, 1 modified index. **Zero**
changes to existing production executor code (`bash.ts`,
`command-job-manager.ts`, `vscode-run-commands-tool.ts`,
`command-policy/*`).

## Critical invariants — all PROVEN

| Invariant | Evidence |
|-----------|----------|
| I1 — disabled = exact legacy execution | `no-sandbox-backend.test.ts`: byte-equivalent comparison, fresh-copy isolation, no aliasing |
| I2 — sandbox failure never falls back | `sandbox-backend.test.ts`: `getSandboxBackend("seatbelt-experimental")` without opt-in returns `undefined`; on non-darwin also `undefined`. `seatbelt-backend.test.ts`: invalid writableRoot throws `SandboxError`; command NOT executed. |
| I3 — input is capability, not text | `types.ts`: `SandboxBackend.prepare({ capability: CommandCapability, command: CommandInvocation })` — no `command: string` parameter |
| I4 — canonical paths | `canonical-paths.ts`: realpath on every path before profile generation; fail-closed on ENOENT/EACCES/ELOOP/non-string |
| I5 — env authority explicit | `environment.ts`: positive allowlist + secret-blocklist override (explicit empty-string override to defeat spread-merge executors); SSH_AUTH_SOCK/AWS_*/etc. set to `""` when sanitized; tested in `seatbelt-backend.test.ts` |

## Defense-in-depth proof

The same synthetic write (`printf BAD >> outside/secret.txt`) was
attempted through:

| Backend | Result |
|---------|--------|
| `NoSandboxBackend` (control) | **SUCCEEDED** — file became `"TOP-SECRET\nCONTROL"` |
| `SeatbeltSandboxBackendExperimental` | **DENIED** at kernel — file remains `"TOP-SECRET\n"` |

This is the strongest discriminator in the ACT: the test is causal
(control succeeds) AND the defense-in-depth is real (Seatbelt denies
exactly what the classifier would have authorized).

## Apple support posture

- `sandbox-exec` — `EXPERIMENTAL_UNSUPPORTED_INTERFACE` (documented binary, NOT part of public App Sandbox API)
- App Sandbox helper — `SUPPORTED_PATH_FOUND` (backlog ACT)
- VM / container — `BACKLOG`

The Wave-1 abstraction is platform-neutral; the Seatbelt implementation
is platform-specific and lives under `runtime/sandbox/macos/`. Future
Linux/Windows backends can be added without touching the interface.

## Risks documented

1. **`network=allow` doesn't trivially allow external network**: the
   recon's positive control used `curl 127.0.0.1:18929` with a local
   HTTP server. External connections from inside the sandbox may
   still be blocked by the host firewall (this is what we observed
   with `nc -z 1.1.1.1 53` from inside the sandbox returning 1).
   The `net=deny` guarantee is rock-solid; `net=allow` is permissive
   to the extent the host kernel allows.

2. **`/private/var/folders` was removed from the always-writable
   set**: the recon included this path, but it caused defense-in-
   depth tests run under `/var/folders/.../T/` to silently fail (the
   inside/outside siblings were both under `/private/var/folders`).
   We tightened to `/dev/null`, `/dev/tty` only. Real-world tools
   that need tmp access must use the capability's `tempRoot`.

3. **Sandbox wrapper adds latency**: typical 10–30ms per command
   (from recon). Acceptable for non-interactive commands; not
   measured on the dogfood ACT scope.

## Recommended next ACT

```
ACT-CLINEMM-MACOS-SEATBELT-DOGFOOD01
```

Purpose: enable Seatbelt in the dedicated ClineMM profile and discover
real-world incompatibilities before considering default-on behavior.

Scope: real workflows, NOT more synthetic sandbox mechanics. Will test
git status, find, rg, tests, npm/pnpm, Go, git credentials, networked
tools.

C3 of this ACT (production opt-in wiring at `CommandJobManager.start`)
goes here.
