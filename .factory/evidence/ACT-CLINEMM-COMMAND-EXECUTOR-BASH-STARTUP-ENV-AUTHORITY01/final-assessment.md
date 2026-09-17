# ACT-CLINEMM-COMMAND-EXECUTOR-BASH-STARTUP-ENV-AUTHORITY01 — Final Assessment

## Verdict

```
PASS_BASH_STARTUP_ENV_AUTHORITY CLOSED_CLEAN
```

The P0-4 BASH_ENV startup-file execution leak is closed at the
EXECUTOR layer. The strip filter is narrow (4 vars), recon-confirmed,
and conservative: ordinary env, caller-supplied env, exported shell
functions, and Seatbelt sanitized mode are all preserved.

## What was done (three commits)

1. **C1** (`docs(factory)`) — new ACT + RED repros
   - Entry freeze at ENTRY_HEAD=e33e322a8 (C3 of CORRECTION03)
   - P0-4 reproduced LIVE through the actual production executor
     seam (spawnSupervisableShellCommand under DEFAULT_OFF)
   - Causal mismatch documented: policy authorized C, bash
     executed S + C
   - Scope established: general executor boundary, not mktemp

2. **C2** (`feat(safety)`) — executor-side narrow strip filter
   - NEW `BASH_STARTUP_STRIPPABLE_ENV` constant in bash.ts
   - NEW `stripBashStartupEnvFromParent` helper
   - REWRITE buildShellProcess line 240-241 spread-merge
   - NEW `bash.supervised.bash-startup-env.test.ts` (11 tests)

3. **C3** (`docs(factory)`) — final regression + GREEN, ACT CLOSED_CLEAN
   - 3137/0 sdk core FAIL
   - 109/109 apps/vscode PASS
   - 15/15 sandbox c3-real-kernel GREEN
   - All compile/build gates clean

## Production change scope (C2 only -- C1 was evidence-only, C3 was evidence-only)

```
sdk/packages/core/src/extensions/tools/executors/bash.ts

  (a) NEW module constant:
      const BASH_STARTUP_STRIPPABLE_ENV: ReadonlySet<string> = new Set([
        "BASH_ENV",   // bash sources $BASH_ENV at non-interactive
                      // startup (verified live as load-bearing
                      // channel for P0-4)
        "ENV",        // POSIX sh analogue (defensive)
        "SHELLOPTS",  // bash applies colon-separated options at startup
        "BASHOPTS",   // analogous for shopt options
      ]);

  (b) NEW helper function:
      function stripBashStartupEnvFromParent(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv
      Returns a copy of env with bash-startup-affecting variables
      removed. Caller's env (typically config.env) is preserved;
      only the inherited process.env layer is filtered.

  (c) REWRITE buildShellProcess line 240-241:
      OLD:
        const childEnv =
          config.envSemantics === "complete"
            ? config.env
            : { ...process.env, ...config.env };
      NEW:
        const childEnv =
          config.envSemantics === "complete"
            ? config.env
            : { ...stripBashStartupEnvFromParent(process.env), ...config.env };

NEW test file:
  sdk/packages/core/src/extensions/tools/executors/bash.supervised.bash-startup-env.test.ts
    11 tests in 5 describe groups:
      RED CLOSED BASH_ENV (5 forms)
      RED CLOSED ENV (1 form)
      CONSERVATION PATH/TERM/caller-env (3 tests)
      CONSERVATION envSemantics=complete bypasses (1 test)
      CONSERVATION BASH_FUNC_* not stripped (1 test)
```

NO parser-helper change. SHA256SUMS unchanged. NO proto/schema
change. NO public knob added. NO DEFAULT_OFF behavior change
for non-Bash-startup env. NO Seatbelt change. NO executor-API
change. NO command-policy change.

## Test gates

| Suite | Pre-ACT | Post-ACT | Status |
|-------|---------|----------|--------|
| sdk/packages/core full vitest | 3126 PASS | **3137 PASS / 16 SKIP / 0 FAIL** | +11 tests |
| bash.supervised.bash-startup-env.test.ts | -- | **11 PASS** | NEW |
| bash.supervised.test.ts (legacy) | 7 PASS | 7 PASS | unchanged |
| apps/vscode policy/approval/sandbox/sdk-tool-policies suites | 109 PASS | **109 PASS** | unchanged |
| apps/vscode sandbox c3-real-kernel | 15/15 | **15/15** | GREEN regression |
| bun run build:sdk | clean | clean | unchanged |
| apps/vscode bun run compile | clean | clean | unchanged |
| git diff --check | clean | clean | unchanged |

## Architectural invariants preserved

- Sanitized Seatbelt mode (envSemantics: "complete"): closed by
  construction; filter is NO-OP there. CONSERVED.
- DEFAULT_OFF ordinary env (PATH/TERM/LANG): preserved.
- Caller-supplied config.env: preserved verbatim (caller-trusted).
- stdout/stderr/exit/cancel: CONSERVED.
- command-policy: UNCHANGED.
- Parser-helper SHA256SUMS: UNCHANGED.
- spawnSupervisableShellCommand signature: UNCHANGED.

## Composition with prior ACTs

| Prior ACT | Status after this ACT |
|-----------|----------------------|
| CORRECTION01 host-evidence-bound rule | INTACT |
| CORRECTION02 strict-identity-bound rule | INTACT |
| CORRECTION03 slash-bypass rule | INTACT |
| Seatbelt mktemp composition (15/15 c3-real-kernel) | INTACT |
| Command-policy conservation (1044 tests) | PASS |
| Adapter truthfulness (4 CORRECTION02 apps/vscode tests) | PROVEN |
| Shell-resolution identity binding (slash-bypass) | PROVEN |

## Trust state

```
ENTRY_HEAD = e33e322a8 (C3 of CORRECTION03 / mktemp saga closed)
C1_HEAD    = 20209dcb9 docs(factory): new ACT + RED repro
C2_HEAD    = a6f3f8191 feat(safety): executor-side narrow strip filter
C3_HEAD    = <this commit> docs(factory): final regression + GREEN
branch     = main
origin/main = unchanged (18 unpushed local commits)
NOT pushed
```

## Final freeze

```
DEFAULT_OFF executor under inherited BASH_ENV=<file>:
  bash does NOT source $BASH_ENV before executing -c <command>

DEFAULT_OFF executor under inherited ENV=<file>:
  bash does NOT source $ENV

DEFAULT_OFF executor under inherited SHELLOPTS=...:
  bash starts without those shopt options applied

DEFAULT_OFF executor under inherited BASHOPTS=...:
  bash starts without those shopt options applied

PATH inheritance                                      CONSERVED
TERM inheritance                                      CONSERVED
caller-supplied env preservation                      CONSERVED
exported shell functions (BASH_FUNC_*) inheritance    CONSERVED
Sanitized Seatbelt (envSemantics: complete)           UNCHANGED
command-policy                                        UNCHANGED
parser-helper                                         UNCHANGED
Seatbelt mktemp composition                          UNCHANGED (15/15 GREEN)
1044+ cmd-policy tests                                PASS (0 regression)
spawnSupervisableShellCommand signature              UNCHANGED
stdout/stderr/exit/cancel                             CONSERVED
```

## Verdict

```
PASS_BASH_STARTUP_ENV_AUTHORITY
CLOSED_CLEAN
```

## Evidence (gitignored, local)

```
.factory/evidence/ACT-CLINEMM-COMMAND-EXECUTOR-BASH-STARTUP-ENV-AUTHORITY01/
  entry-freeze.txt
  red-p0-4-bash-env-startup.txt
  c1-closure.md
  c2-closure.md
  c3-closure.md
  test-gates.txt
  c3-live-output.txt
  live-qualification.txt
  final-assessment.md
```

## Out of scope (per reviewer; future ACT candidates)

1. **Linux mktemp support.** Proving bounded Linux authority
   requires per-process TMPDIR canonicalization + Linux
   executable identity binding. Separate ACT candidate.

2. **mktemp template forms** (`/usr/bin/mktemp foo.XXXX`). Have
   caller-selected pathname authority and need canonical-path
   evidence binding. Separate authority family.

3. **Executor-side `transformedInput` plumbing.** A future ACT
   could thread `transformedInput` through the executor so the
   policy can rewrite `mktemp` → `/usr/bin/mktemp` AND the
   executor actually uses the rewritten input. This would
   preserve bare-form UX. Significantly larger than this ACT.

4. **POSIX-only `ENV`** under non-bash POSIX shells (sh, dash).
   Stripped defensively. Audit of what other POSIX-sh-affecting
   variables exist is a future ACT candidate.

5. **`BASH_LOADABLES_PATH`**, **`BASH_XTRACEFD`**, **`BASH_COMPAT`**
   and other bash-specific startup-affecting variables not in
   the current strip set. Recon-confirmed set covers what is
   documented to execute code before `-c <command>` at the
   time of this ACT. If later bash versions add new ones, the
   strip set should be reviewed.

## Composition with the broader ClineMM safety story

This ACT, combined with the mktemp CORRECTION chain (01/02/03)
and the Seatbelt composition ACTs, closes every Bash-execution
authority gap the reviewer has raised:

| Channel | Status |
|---------|--------|
| os.tmpdir honors TMPDIR (P0-1) | CLOSED by CORRECTION02 getconf |
| No executable identity binding (P0-2) | CLOSED by CORRECTION02 realpath |
| Shell-function lookup shadow (P0-3a) | CLOSED by CORRECTION03 slash-bypass |
| BASH_ENV startup-file shadow (P0-4) | CLOSED by THIS ACT strip filter |
| PATH shadow (GNU/Nix coreutils) | CLOSED by CORRECTION02 identity gate |

The Bash executor boundary is now bounded:
- The shell does not run inherited startup code before the
  authorized command (this ACT).
- The shell does not interpret shadow functions as the
  authorized command (CORRECTION03).
- The shell runs the proven-identity binary when slash-prefixed
  (CORRECTION03 + CORRECTION02 realpath).
- The shell inherits the proven Darwin per-user temp root,
  not the parent's steered TMPDIR (CORRECTION02 getconf).

DEFAULT_OFF ordinary env (PATH/TERM/LANG/...) is preserved.
Sanitized Seatbelt mode is unchanged. Caller-supplied env is
preserved. Exported shell functions are inherited (slash-bypass
neutralizes them). Command-policy is unchanged.

**The bash-execution authority boundary is now closed for the
recon-confirmed channels.** The BASH startup-env authority gap
that the reviewer raised is closed at the executor layer with a
narrow, conservative, recon-confirmed strip filter.
