# ACT-CLINEMM-COMMAND-EXECUTOR-BASH-FUNCTION-ENV-AUTHORITY01 -- C2 Closure

## Verdict

```
C2 = PASS

The P0-5 BASH_FUNC_<name>%% exported-function shadow leak
is closed at the EXECUTOR layer. The strip filter from
BASH-STARTUP-ENV-AUTHORITY01 is extended to also strip
any name with the BASH_FUNC_ prefix from the inherited
process.env layer BEFORE the spread-merge with config.env.

Strip semantics: prefix-match (not enumerable). The
function name space is unbounded; prefix-match is the
only safe approach.

Verified RED-CLOSED on:
  - bare `pwd`     against BASH_FUNC_pwd%%      sentinel empty
  - bare `ls /tmp` against BASH_FUNC_ls%%       sentinel empty
  - bare `git`     against BASH_FUNC_git%%      sentinel empty
  - bare `cat`     against BASH_FUNC_cat%%      sentinel empty
  - arbitrary name against BASH_FUNC_anything%% sentinel empty
  - type -t pwd = builtin (not function)
  - /usr/bin/mktemp still works (slash-bypass composes)
```

## What changed (production)

### `sdk/packages/core/src/extensions/tools/executors/bash.ts`

- NEW module constant:
  ```ts
  const BASH_FUNC_PREFIX = "BASH_FUNC_";
  ```
  Documents the prefix-match strip.

- REWRITE the strip helper:
  ```ts
  function stripBashStartupEnvFromParent(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const out: NodeJS.ProcessEnv = {};
    for (const [key, value] of Object.entries(env)) {
      if (BASH_STARTUP_STRIPPABLE_ENV.has(key)) {
        continue;
      }
      if (key.startsWith(BASH_FUNC_PREFIX)) {
        continue;
      }
      out[key] = value;
    }
    return out;
  }
  ```

- Documentation updated:
  - `BASH_STARTUP_STRIPPABLE_ENV` doc now references both
    `BASH_FUNC_<funcname>%%` and the GNU Bash Reference
    Manual, Shell Functions.
  - `buildShellProcess` comment now mentions BASH_FUNC_*
    and the function-import strip.

### `sdk/packages/core/src/extensions/tools/executors/bash.supervised.bash-startup-env.test.ts`

The structurally-wrong `BASH_FUNC_mktemp%%` "conservation"
test is replaced with **6 new RED-CLOSED tests** driving
the production executor seam directly:

1. `bare `pwd` against BASH_FUNC_pwd%%`: sentinel empty
2. `bare `ls /tmp` against BASH_FUNC_ls%%`: sentinel empty
3. `bare `git --version` against BASH_FUNC_git%%`: sentinel empty
4. `bare `cat /dev/null` against BASH_FUNC_cat%%`: sentinel empty
5. `prefix-strip is unbounded: BASH_FUNC_anything%% stripped`: sentinel empty
6. `type -t pwd reports builtin (not function)`: out = "type=builtin"
7. `slash-prefixed `/usr/bin/mktemp` still works (slash-bypass composes with the strip)`: exit 0, sentinel empty

Total test count for the file: **17/17 PASS** (was 11/11; +6 new RED-CLOSED tests, 0 conservation tests removed and replaced with real RED-CLOSED tests).

## Architectural invariants preserved

- **Sanitized Seatbelt mode (envSemantics: "complete")**: closed by construction; filter is NO-OP. CONSERVED.
- **DEFAULT_OFF ordinary env** (PATH/TERM/LANG): preserved.
- **Caller-supplied config.env** (provenanced as `{ SHELL: shell }` from `getShellInvocation()`): preserved verbatim.
- **stdout/stderr/exit/cancel**: CONSERVED.
- **command-policy**: UNCHANGED.
- **Parser-helper SHA256SUMS**: UNCHANGED.
- **spawnSupervisableShellCommand signature**: UNCHANGED (strip is internal to buildShellProcess).
- **CORRECTION03 slash-bypass**: COMPOSES. Slash-prefixed commands run as pathnames regardless of inherited functions.
- **BASH-STARTUP-ENV-AUTHORITY01 strip set**: INTACT (BASH_ENV, ENV, SHELLOPTS, BASHOPTS).

## RED-GREEN cycle verified

Temporarily reverting the strip filter (the entire
`stripBashStartupEnvFromParent(process.env)` filter) made
**12 of 17 tests fail**:
  - 6 BASH_ENV tests (red-CLOSE from previous ACT)
  - 1 ENV test
  - 6 new BASH_FUNC_* tests (red-CLOSE from this ACT)

Reapplying the strip filter returns to 17/17 PASS.

Only the CONSERVATION tests (PATH/TERM/caller-env/sanitized/
slash-bypass) preserved passing across the reversion, as
expected (they are not RED-closed tests; they are guard
rails).

## Composition with prior ACTs

| Prior ACT | Status after this ACT |
|-----------|----------------------|
| CORRECTION01 host-evidence-bound rule | INTACT |
| CORRECTION02 strict-identity-bound rule | INTACT |
| CORRECTION03 slash-bypass rule | INTACT (composes with prefix-strip) |
| BASH-STARTUP-ENV-AUTHORITY01 (BASH_ENV, ENV, SHELLOPTS, BASHOPTS) | INTACT |
| Seatbelt mktemp composition (15/15 c3-real-kernel) | INTACT (sanitized mode is orthogonal) |
| Command-policy conservation (1044 tests) | PASS |

## Test gates

| Suite | Pre-ACT (post-BASH-STARTUP-ENV) | Post-ACT | Status |
|-------|-------------------------------|----------|--------|
| sdk/packages/core full vitest | 3137 PASS | **3143 PASS / 16 SKIP / 0 FAIL** | +6 tests |
| bash.supervised.bash-startup-env.test.ts | 11 PASS | **17 PASS** | +6 RED-CLOSED |
| bash.supervised.test.ts (legacy) | 7 PASS | 7 PASS | unchanged |
| apps/vscode policy/approval/sandbox/sdk-tool-policies suites | 109 PASS | **109 PASS** | unchanged |
| apps/vscode sandbox c3-real-kernel | 15/15 | **15/15** | GREEN regression |
| bun run build:sdk | clean | clean | unchanged |
| apps/vscode bun run compile | clean | clean | unchanged |
| git diff --check | clean | clean | unchanged |

## Verdict

```
C2 = PASS

The P0-5 leak is closed at the executor layer with a
narrow, prefix-match strip filter. RED-closed for:
  - bare pwd / ls / git / cat (general AUTO candidates)
  - arbitrary BASH_FUNC_<name>%%
  - type -t pwd reports builtin (not function)

Slash-bypass composes with the strip. All conservation
invariants preserved.

C3 plan: capture RED-closed live output + final regression
+ ACT CLOSED_CLEAN.
```
