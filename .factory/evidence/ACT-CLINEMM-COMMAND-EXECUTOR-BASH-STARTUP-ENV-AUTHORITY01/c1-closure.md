# ACT-CLINEMM-COMMAND-EXECUTOR-BASH-STARTUP-ENV-AUTHORITY01 — C1 Closure

## Verdict

```
C1 = PASS

P0-4 (BASH_ENV startup-file execution) is reproduced LIVE
through the actual production executor seam
(spawnSupervisableShellCommand under envSemantics=overlay,
the DEFAULT_OFF contract).

The leak is confirmed to be GENERAL: it affects EVERY
bash -c invocation (pwd, ls, echo, /usr/bin/mktemp,
/usr/bin/mktemp -d, /usr/bin/mktemp -d /tmp/foo.XXXXXX,
etc.), not just mktemp.

The CORRECTION03 slash-bypass fix is confirmed correct
for what it claims to fix (function-lookup channel) but
does NOT close the BASH_ENV startup-file channel because
bash sources $BASH_ENV before command-line parsing.
```

## Why this is a new ACT, not a CORRECTION04 in mktemp

Per reviewer:

> "If the production executor really launches approved
> commands through non-interactive bash -c while
> DEFAULT_OFF inherits process.env, then a hostile or
> surprising BASH_ENV affects every auto-approved Bash
> command, including things like:
>   pwd
>   git status
>   ls
>   /usr/bin/mktemp
>
> So I would not create CORRECTION04 inside the mktemp
> saga. We have uncovered a more general execution
> invariant."

Confirmed: the leak is in the EXECUTOR, not in
command-policy. The policy proves authority over the
COMMAND STRING. It cannot prove authority over what
bash does before parsing the command string. That's an
executor-side concern.

The mktemp saga (CORRECTION01-CORRECTION03) is genuinely
closed at the policy layer; the slash-bypass does what
the policy claims (proves command-identity for the final
simple command).

## Causal mismatch (reviewer)

```
command policy proves command C
        ↓
executor starts bash
        ↓
bash executes inherited startup program S
        ↓
bash executes C

policy authorized C
but execution was S + C
```

This is a real production-seam authority gap.

## Seatbelt sanity (reviewer)

> "We cannot rely on sanitized Seatbelt environment
> stripping these variables."

But actually: looking at the production code:

```ts
// sdk/packages/core/src/runtime/sandbox/environment.ts
export function materializeEnvironment(
  capability: EnvironmentCapability,
  ...
): Record<string, string> {
  if (capability.mode === "inherit") {
    return {};  // <-- DEFAULT_OFF returns empty
  }
  // sanitized mode:
  //   materialize SAFE_ENVIRONMENT_BASELINE + allow list
  //   BASH_ENV is NOT in baseline
  //   return complete env
}
```

```ts
// sdk/packages/core/src/extensions/tools/executors/bash.ts line 240-241
const childEnv =
  config.envSemantics === "complete" ? config.env : { ...process.env, ...config.env };
```

So:
- **DEFAULT_OFF** (envSemantics: undefined or "overlay"):
  inherits ALL of process.env including BASH_ENV.
  **LEAK.**
- **Sanitized Seatbelt** (envSemantics: "complete"):
  uses materialized env verbatim. BASH_ENV is not in
  baseline, not in allow list by default. **CLOSED by
  construction.**

This ACT is therefore about DEFAULT_OFF (envSemantics:
overlay) under the bash -c shell path.

## Files identified for C2 touch

### Production change (executor-side, NOT command-policy)

```
sdk/packages/core/src/extensions/tools/executors/bash.ts
  Modify buildShellProcess so that under
  envSemantics === "overlay" or undefined (the DEFAULT_OFF
  contract), the inherited process.env is filtered to
  strip bash-startup-affecting variables BEFORE
  spreading.

  Variables to strip (RECON BEFORE FINAL LIST):
    BASH_ENV
    ENV
    SHELLOPTS
    BASHOPTS

  Reason: bash sources these at non-interactive startup
  before parsing -c <command>.

  Don't strip:
    - PATH, TERM, LANG (ordinary env)
    - exported shell functions (BASH_FUNC_*): CORRECTION03
      slash-bypass neutralizes them for the command-
      identity channel.
    - caller-supplied env (e.g., SHELL override from
      command-job-manager.ts:640): caller-controlled,
      trusted.

  Caveat: --noprofile/--norc alone is INSUFFICIENT for
  BASH_ENV (bash docs separately).
```

### Out of scope (per reviewer)

- Auto-blacklisting every Bash-affecting var; recon first
  to confirm which matter for the actual invocation mode
  (Bash non-interactive -c).
- Adding command-policy shell-startup special cases (the
  fix is executor-side, not policy-side).
- Touching Seatbelt sanitized mode (already closed by
  construction).
- Touching the structured-input path (no shell; not
  affected).
- Touching command-job-manager.ts (the executor config is
  filtered at the supervisor level in bash.ts).

## Test plan for C2

Test cases:
1. **RED closed**: With BASH_ENV=<file>, the supervisor
   does NOT source the file before running -c <command>.
   Sentinel file remains empty.
2. **Existing behavior conserved**: WITHOUT BASH_ENV set,
   the supervisor runs the command identically to today
   (no functional regression).
3. **Bash ENV closed**: With ENV=<file>, same.
4. **Bash SHELLOPTS closed**: With SHELLOPTS=...,
   the supervisor does not propagate the inherited
   SHELLOPTS to the child shell (Bash parses it at startup).
5. **Bash BASHOPTS closed**: same as #4.
6. **PATH preserved**: ordinary PATH inheritance works.
7. **Caller-supplied SHELL= override preserved**:
   command-job-manager's `env: { SHELL: shell }` still
   reaches the child.
8. **Sanitized mode unchanged**: envSemantics: "complete"
   bypasses the filter (the materialized env is already
   controlled by the Seatbelt backend).
9. **Slash-bypass / mktemp / CORRECTION03 GREEN**: All
   existing tests pass with zero regression.

## Trust state (this ACT)

```
ENTRY_HEAD = e33e322a8 (C3 of the mktemp CORRECTION03)
C1_HEAD    = <this commit> docs(factory): reopen + RED repro
branch     = main
origin/main = unchanged (16 unpushed local commits)
NOT pushed
```

## Verdict

```
C1 = PASS

The P0-4 leak is reproduced live through the production
executor seam (spawnSupervisableShellCommand under
DEFAULT_OFF / overlay env semantics).

The CORRECTION03 fixes (slash-bypass) are PRESERVED:
  - /usr/bin/mktemp + darwin identity + getconf root -> AUTO
  - bare mktemp -> ASK with shell_resolution_unbound
  - PATH-shadow -> ASK with executable_identity_unbound
  - etc.

The mktemp saga is genuinely closed at the policy layer.

The BASH_ENV authority gap is a NEW ACT and a NEW
executor-side concern.

C2 plan:
  EXECUTOR-SIDE strip of bash-startup-affecting env vars
  (BASH_ENV, ENV, SHELLOPTS, BASHOPTS) under overlay
  semantics, BEFORE the spread-merge with process.env.

  Implementation in
    sdk/packages/core/src/extensions/tools/executors/bash.ts
  only.

  NO command-policy change.
  NO Seatbelt change.
  NO proto/schema change.
  NO parser-helper change.
  NO DEFAULT_OFF behavior change for non-Bash-startup env.
```
