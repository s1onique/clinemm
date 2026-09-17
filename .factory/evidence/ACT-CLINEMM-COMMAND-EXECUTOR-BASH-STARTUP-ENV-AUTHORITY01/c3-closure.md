# ACT-CLINEMM-COMMAND-EXECUTOR-BASH-STARTUP-ENV-AUTHORITY01 — C3 Closure

## Verdict

```
PASS_BASH_STARTUP_ENV_AUTHORITY CLOSED_CLEAN
```

The P0-4 BASH_ENV startup-file execution leak is closed at the
EXECUTOR layer (NOT at the policy layer, where it doesn't belong).
The strip filter is narrow (4 vars), recon-confirmed, and
conservative: ordinary env, caller-supplied env, exported shell
functions, and Seatbelt sanitized mode are all preserved.

## Test gates (C3)

| Suite | Pre-ACT (post-mktemp) | Post-ACT | Status |
|-------|----------------------|----------|--------|
| sdk/packages/core full vitest | 3126 PASS | **3137 PASS / 16 SKIP / 0 FAIL** | +11 tests |
| bash.supervised.bash-startup-env.test.ts | -- | **11 PASS** | NEW |
| bash.supervised.test.ts (legacy) | 7 PASS | 7 PASS | unchanged |
| apps/vscode policy/approval/sandbox/sdk-tool-policies suites | 109 PASS | **109 PASS** | unchanged |
| apps/vscode sandbox c3-real-kernel | 15/15 | **15/15** | GREEN regression |
| bun run build:sdk | clean | clean | unchanged |
| apps/vscode bun run compile | clean | clean | unchanged |
| git diff --check | clean | clean | unchanged |

## End-to-end UX closure (LIVE)

Before C2 fix (P0-4 RED):
```
$ BASH_ENV=<file> bash -c "/usr/bin/mktemp"
/var/folders/.../T/tmp.xxx
$ cat sentinel
STARTUP 832219000     # <-- LEAK
```

After C2 fix (production executor with strip filter):
```
[BASH_ENV=<file> via spawnSupervisableShellCommand]
  bashCmd: "/usr/bin/mktemp"
  exitCode: 0
  sentinel: (empty)   # <-- BASH_ENV stripped at supervisor
```

The strip set is BASH_STARTUP_STRIPPABLE_ENV = { BASH_ENV, ENV,
SHELLOPTS, BASHOPTS }. Under envSemantics: "overlay" or undefined
(DEFAULT_OFF), these are stripped from the inherited process.env
layer before the spread-merge with config.env.

The slash-bypass from CORRECTION03 still works for the AUTO forms:
  - /usr/bin/mktemp + darwin + identity + getconf root -> AUTO
  - The C2 strip filter closes the BASH_ENV startup-file channel
    IN ADDITION to the slash-bypass closing the function-lookup
    channel. Both channels are now closed.

## Architectural invariants preserved

- **Sanitized Seatbelt mode** (envSemantics: "complete"): closed
  by construction; filter is NO-OP there. CONSERVED.
- **DEFAULT_OFF ordinary env** (PATH/TERM/LANG): preserved.
- **Caller-supplied config.env**: preserved verbatim (caller-trusted).
- **stdout/stderr/exit/cancel**: CONSERVED.
- **command-policy**: UNCHANGED.
- **Parser-helper SHA256SUMS**: UNCHANGED.
- **spawnSupervisableShellCommand signature**: UNCHANGED (strip
  is internal to buildShellProcess).
- **CORRECTION01/02/03 mktemp rules**: INTACT.
- **1044+ cmd-policy tests**: PASS with zero regression.
- **15/15 sandbox c3-real-kernel**: GREEN.

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
  policy authorized C = "/usr/bin/mktemp"
  bash executes C      = "/usr/bin/mktemp"   (only)
  BASH_ENV             = NOT SOURCED

DEFAULT_OFF executor under inherited ENV=<file>:
  policy authorized C = "pwd"
  bash executes C      = "pwd"                (only)
  ENV                  = NOT SOURCED

DEFAULT_OFF executor under inherited SHELLOPTS=errexit:nounset:
  bash starts          = without errexit/nounset
  policy authorized C  = unchanged

DEFAULT_OFF executor under inherited BASHOPTS=expand_aliases:
  bash starts          = without alias expansion
  policy authorized C  = unchanged

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
   preserve bare-form UX while closing the function-lookup
   leak (slash-bypass is already in place, so the executor
   binding would close the redundant policy-vs-executor
   re-resolution window). Significantly larger than this ACT.

4. **POSIX-only `ENV`** under non-bash POSIX shells (sh, dash).
   We strip defensively. Audit of what other POSIX-sh-affecting
   variables exist is a future ACT candidate; not exercised in
   production.

5. **`BASH_LOADABLES_PATH`**, **`BASH_XTRACEFD`**, **`BASH_COMPAT`**
   and other bash-specific startup-affecting variables not in
   the current strip set. The recon-confirmed set covers what
   is documented to execute code before `-c <command>`. If
   later bash versions add new ones, the strip set should be
   reviewed.

**The BASH startup-env authority boundary is closed at the
executor layer for the recon-confirmed channels.** Combined
with the CORRECTION03 slash-bypass for command-identity, every
auto-approved Bash invocation under DEFAULT_OFF now has a
clear identity claim:
- policy-time identity = execution-time identity (slash-bypass)
- no inherited startup-code precedes the authorized command
  (this ACT's strip filter)
