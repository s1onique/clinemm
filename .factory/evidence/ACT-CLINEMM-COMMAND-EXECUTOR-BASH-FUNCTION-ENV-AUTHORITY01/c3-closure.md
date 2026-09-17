# ACT-CLINEMM-COMMAND-EXECUTOR-BASH-FUNCTION-ENV-AUTHORITY01 -- C3 Closure

## Verdict

```
PASS_BASH_FUNCTION_ENV_AUTHORITY CLOSED_CLEAN
```

The P0-5 BASH_FUNC_<name>%% exported-function shadow leak
is closed at the EXECUTOR layer. The strip filter from
BASH-STARTUP-ENV-AUTHORITY01 is extended to also strip any
name with the BASH_FUNC_ prefix from the inherited
process.env layer BEFORE the spread-merge with config.env.

Strip semantics: prefix-match (not enumerable). The function
name space is unbounded; prefix-match is the only safe
approach.

config.env layer provenance is FROZEN as host-trusted fixed
metadata: `env: { SHELL: shell }` where `shell` comes from
`getShellInvocation()` (fixed host mapping: /bin/bash on
Unix, powershell on Windows). Filter on the inherited
process.env layer is sufficient.

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

## End-to-end UX closure (LIVE)

Before C2 fix (P0-5 RED):
```
$ BASH_FUNC_pwd%%='() { printf UNAUTHORIZED; }' \
  bash -c 'pwd'
UNAUTHORIZED$   # <-- function ran, not the builtin
```

After C2 fix (production executor with prefix-match strip):
```
[spawnSupervisableShellCommand with BASH_FUNC_pwd%% in process.env]
  bashCmd: "pwd >/dev/null"
  exitCode: 0
  sentinel: (empty)   # <-- function stripped at supervisor
  type -t pwd: builtin
```

Strip set now:
- **Exact-match**: { BASH_ENV, ENV, SHELLOPTS, BASHOPTS }
- **Prefix-match**: BASH_FUNC_* (any name with this prefix
  is stripped)

Both layers of inherited state are now bounded:
- BASH-STARTUP-ENV-AUTHORITY01: blocks startup-file execution
  (BASH_ENV) and bash startup-option mutation (SHELLOPTS/BASHOPTS)
- BASH-FUNCTION-ENV-AUTHORITY01: blocks function-import
  shadow (BASH_FUNC_<name>%%)

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
- 15/15 sandbox c3-real-kernel: GREEN regression.

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
