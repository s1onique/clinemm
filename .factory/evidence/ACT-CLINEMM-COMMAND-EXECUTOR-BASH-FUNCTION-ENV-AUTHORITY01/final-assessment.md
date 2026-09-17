# ACT-CLINEMM-COMMAND-EXECUTOR-BASH-FUNCTION-ENV-AUTHORITY01 -- Final Assessment

## Verdict

```
PASS_BASH_FUNCTION_ENV_AUTHORITY CLOSED_CLEAN
```

The P0-5 BASH_FUNC_<name>%% exported-function shadow leak
is closed at the EXECUTOR layer. The strip filter from
BASH-STARTUP-ENV-AUTHORITY01 is extended to also strip
any name with the BASH_FUNC_ prefix from the inherited
process.env layer BEFORE the spread-merge with config.env.

Strip semantics: prefix-match (not enumerable). The function
name space is unbounded; prefix-match is the only safe
approach.

config.env layer provenance is FROZEN as host-trusted fixed
metadata.

## What was done (two commits)

1. **C1+C2** (`feat(safety)`) -- executor-side prefix-match strip
   - NEW `BASH_FUNC_PREFIX` constant in bash.ts
   - REWRITE `stripBashStartupEnvFromParent` to also strip
     by prefix
   - REPLACE the structurally-wrong BASH_FUNC_* "conservation"
     test with 6 real RED-CLOSED tests driving the production
     executor seam directly
   - Documentation updated

2. **C3** (`docs(factory)`) -- final regression + GREEN, ACT CLOSED_CLEAN
   - 3143/0 sdk core FAIL
   - 109/109 apps/vscode PASS
   - 15/15 sandbox c3-real-kernel GREEN
   - All compile/build gates clean

## Production change scope (C1+C2 only -- C3 was evidence-only)

```
sdk/packages/core/src/extensions/tools/executors/bash.ts

  (a) NEW module constant:
      const BASH_FUNC_PREFIX = "BASH_FUNC_";
      Documents the prefix-match strip.

  (b) REWRITE stripBashStartupEnvFromParent:
      OLD:
        if (BASH_STARTUP_STRIPPABLE_ENV.has(key)) continue;
        out[key] = value;
      NEW:
        if (BASH_STARTUP_STRIPPABLE_ENV.has(key)) continue;
        if (key.startsWith(BASH_FUNC_PREFIX)) continue;
        out[key] = value;

  Strip semantics: prefix-match (not enumerable). The
  function name space is unbounded; prefix-match is the
  only safe approach.

  (c) Documentation updated to reference GNU Bash Reference
      Manual, Shell Functions, and the BASH_FUNC_<funcname>%%
      encoding.

NEW/REPLACED test file:
  sdk/packages/core/src/extensions/tools/executors/bash.supervised.bash-startup-env.test.ts
    Total: 17 tests in 6 describe groups (was 11; +6 RED-CLOSED)
    The structurally-wrong BASH_FUNC_mktemp%% "conservation"
    test is REPLACED with 6 real RED-CLOSED tests.
```

NO parser-helper change. SHA256SUMS unchanged. NO proto/schema
change. NO public knob added. NO DEFAULT_OFF behavior change
for non-Bash-startup env. NO Seatbelt change. NO executor-API
change. NO command-policy change.

## Test gates

| Suite | Pre-ACT | Post-ACT | Status |
|-------|---------|----------|--------|
| sdk/packages/core full vitest | 3137 PASS | **3143 PASS / 16 SKIP / 0 FAIL** | +6 tests |
| bash.supervised.bash-startup-env.test.ts | 11 PASS | **17 PASS** | +6 RED-CLOSED |
| bash.supervised.test.ts (legacy) | 7 PASS | 7 PASS | unchanged |
| apps/vscode policy/approval/sandbox/sdk-tool-policies suites | 109 PASS | **109 PASS** | unchanged |
| apps/vscode sandbox c3-real-kernel | 15/15 | **15/15** | GREEN regression |
| bun run build:sdk | clean | clean | unchanged |
| apps/vscode bun run compile | clean | clean | unchanged |
| git diff --check | clean | clean | unchanged |

## Architectural invariants preserved

- Sanitized Seatbelt mode (envSemantics: "complete"): closed
  by construction (BASH_FUNC_<name>%% not in
  SAFE_ENVIRONMENT_BASELINE); filter is NO-OP there.
- DEFAULT_OFF ordinary env (PATH/TERM/LANG): preserved.
- Caller-supplied config.env (provenanced as
  `{ SHELL: shell }` from `getShellInvocation()`): preserved
  verbatim.
- stdout/stderr/exit/cancel: CONSERVED.
- command-policy: UNCHANGED.
- Parser-helper SHA256SUMS: UNCHANGED.
- spawnSupervisableShellCommand signature: UNCHANGED.
- CORRECTION03 slash-bypass: COMPOSES.
- BASH-STARTUP-ENV-AUTHORITY01 strip set: INTACT.

## Composition with prior ACTs

| Prior ACT | Status after this ACT |
|-----------|----------------------|
| CORRECTION01 host-evidence-bound rule | INTACT |
| CORRECTION02 strict-identity-bound rule | INTACT |
| CORRECTION03 slash-bypass rule | INTACT (composes with prefix-strip) |
| BASH-STARTUP-ENV-AUTHORITY01 (BASH_ENV, ENV, SHELLOPTS, BASHOPTS) | INTACT |
| Seatbelt mktemp composition (15/15 c3-real-kernel) | INTACT (sanitized mode is orthogonal) |
| Command-policy conservation (1044 tests) | PASS |

## Trust state

```
ENTRY_HEAD = 622baa703 (C3 of BASH-STARTUP-ENV-AUTHORITY01)
C1+C2_HEAD = dc25759ea feat(safety): extend strip filter to BASH_FUNC_<name>%% prefix
C3_HEAD    = <this commit> docs(factory): final regression + GREEN
branch     = main
origin/main = unchanged (20 unpushed local commits)
NOT pushed
```

## Final freeze

```
DEFAULT_OFF executor under inherited BASH_ENV=<file>:
  bash does NOT source $BASH_ENV

DEFAULT_OFF executor under inherited ENV=<file>:
  bash does NOT source $ENV

DEFAULT_OFF executor under inherited SHELLOPTS=...:
  bash starts without those shopt options

DEFAULT_OFF executor under inherited BASHOPTS=...:
  bash starts without those shopt options

DEFAULT_OFF executor under inherited BASH_FUNC_<name>%%=...:
  bash does NOT import the function
  bare <name>: real builtin/external runs
  type -t <name>: builtin (not function)

PATH inheritance                                      CONSERVED
TERM inheritance                                      CONSERVED
caller-supplied env preservation                      CONSERVED
Sanitized Seatbelt (envSemantics: complete)           UNCHANGED
command-policy                                        UNCHANGED
parser-helper                                         UNCHANGED
Seatbelt mktemp composition                          UNCHANGED (15/15 GREEN)
1044+ cmd-policy tests                                PASS (0 regression)
spawnSupervisableShellCommand signature              UNCHANGED
stdout/stderr/exit/cancel                             CONSERVED
CORRECTION03 slash-bypass                             COMPOSES
```

## Verdict

```
PASS_BASH_FUNCTION_ENV_AUTHORITY
CLOSED_CLEAN
```

## Evidence (gitignored, local)

```
.factory/evidence/ACT-CLINEMM-COMMAND-EXECUTOR-BASH-FUNCTION-ENV-AUTHORITY01/
  entry-freeze.txt
  red-p0-5-bash-function-shadow.txt
  c1-closure.md
  c2-closure.md
  c3-closure.md
  test-gates.txt
  c3-live-output.txt
  live-qualification.txt
  final-assessment.md
```

## Out of scope (per reviewer; future ACT candidates)

1. **Linux mktemp support.** Separate ACT.
2. **mktemp template forms** (`/usr/bin/mktemp foo.XXXX`).
   Separate ACT.
3. **Executor-side `transformedInput` plumbing.** Separate ACT.
4. **POSIX-only `ENV`** under non-bash POSIX shells (sh,
   dash). Stripped defensively. Audit is a future ACT.
5. **`BASH_LOADABLES_PATH`**, **`BASH_XTRACEFD`**,
   **`BASH_COMPAT`** and other bash-specific startup-
   affecting variables not in the current strip set.
   Recon-confirmed set covers what is documented to execute
   code before `-c <command>` at the time of this ACT.
   Review on bash version bumps.
6. **Filter on `config.env` layer**. Currently the strip
   operates on the inherited process.env layer only. The
   caller-supplied config.env layer is FROZEN as
   host-trusted fixed metadata. Future ACT if any caller
   is found to pass user/tool-controlled env values.

## Composition with the broader ClineMM safety story

Combined with the mktemp CORRECTION chain (01/02/03), the
BASH-STARTUP-ENV-AUTHORITY01 chain, and the Seatbelt
composition ACTs, every Bash-execution authority gap the
reviewer has raised is now closed:

| Channel | Status |
|---------|--------|
| os.tmpdir honors TMPDIR (P0-1) | CLOSED by CORRECTION02 getconf |
| No executable identity binding (P0-2) | CLOSED by CORRECTION02 realpath |
| Shell-function lookup shadow for slash-form (P0-3a) | CLOSED by CORRECTION03 slash-bypass |
| BASH_ENV startup-file shadow (P0-4) | CLOSED by BASH-STARTUP-ENV-AUTHORITY01 strip |
| PATH shadow (GNU/Nix coreutils) | CLOSED by CORRECTION02 identity gate |
| Shell-function lookup shadow for bare-form (P0-5) | CLOSED by BASH-FUNCTION-ENV-AUTHORITY01 prefix-strip |

The Bash executor boundary is now bounded:
- The shell does not run inherited startup code before the
  authorized command (BASH-STARTUP-ENV-AUTHORITY01).
- The shell does not interpret inherited exported functions
  as the authorized command, regardless of whether the
  command is bare-form or slash-prefixed
  (BASH-FUNCTION-ENV-AUTHORITY01 prefix-strip + CORRECTION03
  slash-bypass).
- The shell runs the proven-identity binary when slash-
  prefixed (CORRECTION03 + CORRECTION02 realpath).
- The shell inherits the proven Darwin per-user temp root,
  not the parent's steered TMPDIR (CORRECTION02 getconf).

DEFAULT_OFF ordinary env (PATH/TERM/LANG/...) is preserved.
Sanitized Seatbelt mode is unchanged. Caller-supplied env
is preserved. Command-policy is unchanged.
