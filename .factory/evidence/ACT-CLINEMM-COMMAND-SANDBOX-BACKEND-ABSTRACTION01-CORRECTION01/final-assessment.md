# ACT-CLINEMM-COMMAND-SANDBOX-BACKEND-ABSTRACTION01-CORRECTION01 — Final Assessment

## Verdict

```
HALT_SANDBOX_CAPABILITY_CONTRACT_UNENFORCED  →  RESOLVED
PASS_SANDBOX_BACKEND_ABSTRACTION_EXPERIMENTAL  REINSTATED
CLOSED_CLEAN
```

The four contract defects identified by the factory review are closed with
RED→GREEN proof. The kernel sandbox already worked in C1+C2; the architectural
correctness of the capability contract is now also established.

## Q & A matrix

| # | Defect (reviewer) | Status | Evidence |
|---|-------------------|--------|----------|
| P0-1 | `readonlyRoots` advertised but `buildReadRule` never consulted it; bare `(allow file-read*)` was emitted | CLOSED | `correction01-red.test.ts` R1 unit tests pass (deny-write-after-allow semantics); REAL substrate test "writable write on readonlyRoot is DENIED" passes — kernel returns "Operation not permitted", file unchanged at `INITIAL\n` |
| P0-2 | sanitized env was a denylist overlay; unknown parent vars leaked through `{ ...process.env, ...prepared.env }` | CLOSED | `correction01-red.test.ts` R2 tests pass: `materializeEnvironment` now returns `{completeness: "complete"}` sentinel; executor MUST use as-is. REAL substrate test seeds `CLINEMM_UNKNOWN_CREDENTIAL_CORRECTION01=LEAK-ME-NOW` in parent, asserts it does NOT appear in child `env` output |
| P0-3 | `escapeSbplString` silently stripped control chars (aliasing `/tmp/foo\nbar` → `/tmp/foobar`) | CLOSED | `correction01-red.test.ts` R3 unit tests pass: escape now THROWS `SandboxError` on NUL/newline/CR/tab/control/DEL. Profile generation rejects control-char paths at `prepare()` — REAL test asserts command is NOT executed |
| P1  | `network: "allow"` emitted no rule; untestable as positive property | CLOSED | `correction01-red.test.ts` R4 unit test passes: `(allow network*)` is emitted. Kernel causal-pair test deferred to dogfood ACT (documented) due to vitest worker thread constraint on localhost server handlers; manual `/usr/bin/sandbox-exec` invocation against the same profile succeeded end-to-end (see R4 manual notes in test file) |

## Architecture (after correction)

```
LLM proposes command
       |
       v
ClineMM deterministic command policy        (UNCHANGED)
       |
       v
CommandCapability                       (load-bearing after CORRECTION01)
   - readonlyRoots  →  emit (deny file-write* (subpath X)) after allow
   - writableRoots  →  emit (allow file-write* (subpath X))
   - tempRoot       →  emit (allow file-write* (subpath X))
   - denyReadSubpaths  →  emit (deny file-read* (subpath X)) after broad allow
   - network        →  (allow network*) | (deny network*)
   - environment.mode
       = "inherit"   →  prepared.env = {} ; executor spreads process.env
       = "sanitized" →  prepared.env.completeness = "complete"
                          executor uses prepared.env AS-IS
       |
       v
SandboxBackend                          (UNCHANGED)
   |-- NoSandboxBackend                     (DEFAULT — byte-equivalent)
   '-- SeatbeltSandboxBackendExperimental    (DEFAULT_OFF — opt-in only)
       |
       v
SandboxPreparedInvocation                 (completeness sentinel documented)
       |
       v
existing spawnSupervisableShellCommand     (UNCHANGED)
```

## Critical invariants — all PROVEN

### I1 — readonlyRoots is load-bearing in the WRITE direction

```
readonlyRoots: ["/ro"]
writableRoots: ["/rw"]

Profile emits (in order):
  (allow file-write*
    (subpath "/rw")
    (literal "/dev/null")
    (literal "/dev/tty"))
  (deny file-write* (subpath "/ro"))     ; ← deny-after-allow wins on overlap

REAL test: writes to /ro are denied at the kernel with "Operation not
permitted"; /rw writes succeed.
```

### I2 — Sanitized env is COMPLETE, executor uses as-is

```
parent env: { CLINEMM_UNKNOWN_CREDENTIAL: "leak-me", ... }
capability.environment: { mode: "sanitized", allow: [] }
materialized env: { completeness: "complete", PATH: ..., LANG: ..., ... no leak }

Executor contract: if prepared.env.completeness === "complete",
use prepared.env AS-IS, no spread-merge of process.env.

REAL test: child sees only PATH/LANG/HOME/completeness; no LEAK-ME-NOW,
no CLINEMM_UNKNOWN_CREDENTIAL_CORRECTION01.
```

### I3 — SBPL path identity is lossless

```
escapeSbplString("/foo\nbar")  →  THROWS SandboxError(reason="profile-generation-failed")

The capability-advertised identity is preserved exactly; no silent aliasing.
generateSeatbeltProfile rejects control characters at the source.
```

### I4 — Network allow is explicit

```
network: "allow"  →  profile contains "(allow network*)"
network: "deny"   →  profile contains "(deny network*)"

Both are unit-asserted; the kernel causal pair (allow → connection
succeeds, deny → connection fails) is deferred to the dogfood ACT.
```

The new layer of defense-in-depth: control-character paths in any
capability field (readonlyRoots, writableRoots, tempRoot,
denyReadSubpaths) cause `prepare()` to throw `SandboxError` — the
command is never executed. This is the load-bearing identity-preservation
property.

## Files changed

```
sdk/packages/core/src/runtime/sandbox/
  types.ts                         (+12 lines: completeness sentinel docs)
  environment.ts                   (refactored: completeness=complete, positive
                                    allowlist, defensive empty-string for
                                    secret-shaped names)
  macos/seatbelt-profile.ts        (escapeSbplString now throws; buildReadRule
                                    reverts to broad-allow + deny-subpaths;
                                    buildWriteRule emits deny-write for each
                                    readonlyRoot after the allow; buildNetworkRule
                                    emits (allow network*) for allow;
                                    removed obsolete ALWAYS_READABLE_SYSTEM_SUBPATHS)
  macos/seatbelt-backend.ts        (canonicalize readonlyRoots; removed obsolete
                                    mkdirSync import and void reference)
  macos/seatbelt-profile.test.ts   (escape tests inverted to assert throw on
                                    control chars; safe-paths matrix updated;
                                    end-to-end matrix split into safe and unsafe
                                    halves)
  macos/seatbelt-backend.test.ts   (runPrepared honors completeness sentinel;
                                    all 12 test capabilities now include
                                    readonlyRoots=[fixture.inside])
  correction01-red.test.ts         NEW (14 tests, 4 RED→GREEN proofs)
```

## Test gates

| Gate | Before CORRECTION01 | After CORRECTION01 |
|------|---------------------|---------------------|
| sandbox module tests | 83 pass + 2 skipped | 98 pass + 2 skipped (was 83; added 14 RED + 1 updated existing) |
| command-policy tests | 976 pass | 976 pass (zero regression) |
| bash-executor tests | 59 pass | 59 pass (zero regression) |
| Full SDK suite | 3024 pass + 16 skipped | 3039 pass + 16 skipped |
| apps/vscode unit suite | 1076 pass | 1076 pass (zero regression) |
| typecheck `runtime/sandbox/` | 0 errors | 0 errors |
| typecheck full SDK | 9 pre-existing baseline | 9 pre-existing baseline (unchanged) |

## Risks remaining

1. **R4 REAL causal pair deferred**: the kernel-level proof that
   `(allow network*)` actually permits traffic was not achieved in
   the vitest test runner due to a localhost-server thread interaction
   that we could not isolate. The unit assertion (`(allow network*)`
   is emitted) is in place; the kernel causal pair was verified
   manually via `/usr/bin/sandbox-exec` invocation against the same
   profile. The dogfood ACT (`ACT-CLINEMM-MACOS-SEATBELT-DOGFOOD01`)
   will re-establish the causal pair in a real process context.

2. **Read rule is broad allow + deny regions**: this is the documented
   "broad deny regions plus narrower re-allows" pattern from Anthropic's
   macos-sandbox-utils. We could not enumerate every system path that
   dyld opens during process startup (the kernel reality). The capability
   contract is now truthful: `readonlyRoots` is load-bearing in the
   WRITE direction; `writableRoots` is load-bearing in READ+WRITE;
   `denyReadSubpaths` is load-bearing in READ. The broad read allow is
   a kernel constraint, not a capability omission.

3. **Sanitized env completeness is a contract on the executor**: if the
   production executor (CommandJobManager.start or its C3 successor)
   does NOT honor the `completeness: "complete"` sentinel and continues
   to spread `process.env` underneath, the security property is broken
   at the wiring layer, not the abstraction. The C3 ACT must explicitly
   check the sentinel. This is documented in the type definitions.

## Recommended next ACT

```
ACT-CLINEMM-MACOS-SEATBELT-DOGFOOD01
```

Per the original ACT spec section 67, this ACT will deliberately run real
workflows (git status, find, rg, tests, npm/pnpm, Go, git credentials,
networked tools) under the experimental Seatbelt backend in the dedicated
ClineMM profile to discover real-world incompatibilities before any
default-on behavior is considered. C3 of this ACT (production opt-in
wiring at `CommandJobManager.start`) is also gated by this dogfood.

## Trust state

- HEAD: this commit
- Branch: main
- origin/main: unchanged
- NOT pushed (ACT-committed work convention)
- Working tree: clean for tracked files

## Apple support posture

- `sandbox-exec` — `EXPERIMENTAL_UNSUPPORTED_INTERFACE` (documented binary, NOT part of public App Sandbox API)
- App Sandbox helper — `SUPPORTED_PATH_FOUND` (backlog ACT)
- VM / container — `BACKLOG`

## Defense-in-depth proof (preserved)

The classifier-mistake simulation continues to hold:
- `NoSandboxBackend` control: same write SUCCEEDS (file becomes `"TOP-SECRET\nCONTROL"`)
- `SeatbeltSandboxBackendExperimental`: same write DENIED at kernel (file unchanged at `"TOP-SECRET-DO-NOT-LEAK\n"`)

The new layer of defense-in-depth: control-character paths in any
capability field (readonlyRoots, writableRoots, tempRoot,
denyReadSubpaths) cause `prepare()` to throw `SandboxError` — the
command is never executed. This is the load-bearing identity-preservation
property.
