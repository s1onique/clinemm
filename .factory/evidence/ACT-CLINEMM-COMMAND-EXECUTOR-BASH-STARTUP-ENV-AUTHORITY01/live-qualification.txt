# ACT-CLINEMM-COMMAND-EXECUTOR-BASH-STARTUP-ENV-AUTHORITY01 — C2 Closure

## Verdict

```
C2 = PASS

The P0-4 BASH_ENV startup-file execution leak is closed
at the EXECUTOR layer. Under the DEFAULT_OFF contract
(envSemantics: overlay or undefined), inherited bash-
startup-affecting variables (BASH_ENV, ENV, SHELLOPTS,
BASHOPTS) are stripped from the child env BEFORE the
spread-merge with process.env.

The strip set is narrow and bounded:
  BASH_ENV   verified live as load-bearing channel
  ENV        POSIX sh analogue (defensive)
  SHELLOPTS  bash applies colon-separated options at startup
  BASHOPTS   analogous (shopt options at startup)

All non-bash-startup env (PATH, TERM, LANG, ...) is
preserved. Caller-supplied config.env is preserved.
Exported shell functions (BASH_FUNC_*) are inherited
as-is; CORRECTION03 slash-bypass already neutralizes them
for the command-identity channel.

Under envSemantics: "complete" (sanitized Seatbelt mode),
the filter is a NO-OP because the materialized env is
already controlled by SAFE_ENVIRONMENT_BASELINE + caller
allow list, which excludes the bash-startup variables by
default.
```

## What changed (production)

### `sdk/packages/core/src/extensions/tools/executors/bash.ts`

- NEW module constant:
  ```ts
  const BASH_STARTUP_STRIPPABLE_ENV: ReadonlySet<string> = new Set([
    "BASH_ENV", "ENV", "SHELLOPTS", "BASHOPTS",
  ]);
  ```
  Documents the strip set and the reason for each entry.

- NEW helper function:
  ```ts
  function stripBashStartupEnvFromParent(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv
  ```
  Returns a copy of `env` with the bash-startup-affecting
  variables removed. Caller's `env` (typically `config.env`)
  is preserved by design; only the inherited `process.env`
  layer is filtered.

- REWRITE in `buildShellProcess`:
  ```ts
  // OLD:
  const childEnv =
    config.envSemantics === "complete" ? config.env : { ...process.env, ...config.env };

  // NEW:
  const childEnv =
    config.envSemantics === "complete"
      ? config.env
      : { ...stripBashStartupEnvFromParent(process.env), ...config.env };
  ```

### `sdk/packages/core/src/extensions/tools/executors/bash.supervised.bash-startup-env.test.ts` (NEW, 11 tests)

Drives the **production supervisor** (`spawnSupervisableShellCommand`)
directly. These are REAL production-seam tests, NOT unit tests of
a hypothetical filter.

Test groups:
1. **RED CLOSED: BASH_ENV startup file does NOT run** (5 tests):
   - `/usr/bin/mktemp` (CORRECTION03 slash-form AUTO): sentinel remains empty
   - `/usr/bin/mktemp -d`: sentinel remains empty
   - `pwd` (general): sentinel remains empty
   - `echo hello` (general): sentinel remains empty
   - `/usr/bin/mktemp -d /tmp/foo.XXXXXX` (template ASK candidate): sentinel remains empty

2. **RED CLOSED: ENV (POSIX sh analogue) does NOT run** (1 test):
   - `pwd` with ENV=<file>: sentinel remains empty (defensive filter)

3. **CONSERVATION: ordinary env is preserved** (3 tests):
   - PATH inheritance works (`command -v bash >/dev/null` exits 0)
   - TERM inheritance works (`test "$TERM" = dumb` exits 0 with stdout "OK")
   - Caller-supplied env (`env: { MY_CALLER_VAR: ... }`) is preserved over inherited

4. **CONSERVATION: envSemantics='complete' bypasses the filter** (1 test):
   - Sanitized Seatbelt path: caller env passed AS-IS, filter is NO-OP

5. **CONSERVATION: BASH_FUNC_* is NOT stripped** (1 test):
   - Exported shell functions inherited; CORRECTION03 slash-bypass is the channel that neutralizes them

## Architectural invariants preserved

- **Sanitized Seatbelt mode (envSemantics: "complete")** — closed by
  construction (BASH_ENV not in SAFE_ENVIRONMENT_BASELINE); filter
  is NO-OP there.
- **DEFAULT_OFF ordinary env** — otherwise preserved (PATH/TERM/LANG).
- **Caller-supplied config.env** — preserved verbatim (caller-trusted).
- **stdout/stderr/exit/cancel** — conserved (supervisor behavior
  unchanged).
- **command-policy** — unchanged.
- **Parser-helper SHA256SUMS** — unchanged.
- **CORRECTION03 slash-bypass** — preserved (AUTO forms still AUTO
  on darwin + identity + getconf root).
- **CORRECTION02 host-evidence-bound gate** — preserved.
- **1044+ cmd-policy tests** — PASS with zero regression.
- **15/15 sandbox c3-real-kernel** — GREEN (sanitized Seatbelt
  composition is orthogonal; the strip filter is overlay-only).

## Scope discipline

- **Strip set is narrow**: only BASH_ENV, ENV, SHELLOPTS, BASHOPTS.
  No broad blacklisting; recon-confirmed each entry.
- **Filter is overlay-only**: envSemantics: "complete" unchanged.
- **No policy changes**: command-policy lattice unchanged.
- **No Seatbelt changes**: sanitized mode unchanged.
- **No executor-API changes**: spawnSupervisableShellCommand
  signature unchanged; the strip is an internal detail of
  buildShellProcess.

## Test gates (C2)

| Suite | Pre-CORRECTION (mktemp ACT closed) | Post-C2 (this ACT) | Status |
|-------|------------------------------------|---------------------|--------|
| sdk/packages/core full vitest | 3126 PASS / 16 SKIP | **3137 PASS / 16 SKIP / 0 FAIL** | +11 tests |
| bash.supervised.bash-startup-env.test.ts | -- | **11 PASS** | NEW |
| bash.supervised.test.ts (legacy) | 7 PASS | 7 PASS | unchanged |
| apps/vscode policy/approval/sandbox/sdk-tool-policies suites | 109 PASS | **109 PASS** | unchanged |
| apps/vscode sandbox c3-real-kernel | 15/15 | **15/15** | GREEN regression |
| bun run build:sdk | clean | clean | unchanged |
| apps/vscode bun run compile | clean | clean | unchanged |
| git diff --check | clean | clean | unchanged |

## C3 plan

C3 will:
1. Run the full engineering gate suite
   (sdk core + apps/vscode policy/approval/sandbox suites +
    bun run build:sdk + apps/vscode bun run compile)
2. Run the seatbelt c3-real-kernel suite for GREEN regression
3. Run the C2 suite (bash.supervised.bash-startup-env.test.ts)
   for RED-CLOSED proof
4. Capture live RED-closed output through the production executor
5. Write c3-closure.md + final-assessment.md evidence
6. Single C3 commit closing the ACT with
   `PASS_BASH_STARTUP_ENV_AUTHORITY CLOSED_CLEAN`
