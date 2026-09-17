# ACT-CLINEMM-COMMAND-EXECUTOR-BASH-FUNCTION-ENV-AUTHORITY01 -- C1 Closure

## Verdict

```
C1 = PASS

P0-5 (BASH_FUNC_<name>%% exported-function shadow) is
reproduced LIVE through the actual production executor
seam (spawnSupervisableShellCommand under envSemantics:
overlay, the DEFAULT_OFF contract).

The leak is confirmed to be GENERAL: it affects EVERY
bare-form bash -c invocation (pwd, ls, git, cat, ...),
not just mktemp.

The BASH-STARTUP-ENV-AUTHORITY01-C2 strip filter is
confirmed to NOT close this channel because BASH_FUNC_*
was not in the exact-match strip set.
```

## Why this is a new ACT (per reviewer)

> "If the production executor really launches approved
> commands through non-interactive bash -c while
> DEFAULT_OFF inherits process.env, then exported
> functions in the parent env affect every auto-approved
> Bash command, including:
>
>   pwd
>   git status
>   ls
>   /usr/bin/mktemp
>
> So I would not create CORRECTION04 inside the mktemp
> saga. We have uncovered a more general execution
> invariant."

Confirmed: the leak is in the EXECUTOR (BASH_FUNC_*
propagates through the spread-merge), not in command-
policy. The policy proves authority over the COMMAND
STRING. It cannot prove authority over what bash does
before parsing the command string, including importing
functions from BASH_FUNC_<name>%%.

## The earlier conservation test was structurally wrong

The reviewer correctly identified that the C2 test:

```ts
process.env["BASH_FUNC_mktemp%%"] = "() { printf SHADOWED; }";
// ...
test -n "$BASH_FUNC_mktemp%%"
```

is NOT a valid discriminator because shell parameter
expansion parses `$BASH_FUNC_mktemp` as the variable
name and the trailing `%%` as literal text. So the
test reported non-empty without proving that an
imported function actually ran.

The new test set drives the production executor seam
directly:

```ts
process.env["BASH_FUNC_pwd%%"] = `() { printf 'UNAUTHORIZED' >> ${sentinel}; }`;
spawnSupervisableShellCommand({ executable: "/bin/bash", args: ["-c", "pwd"], ... });
// assert: sentinel remains empty (function did NOT import)
```

This is a real, executed test of the production seam.

## config.env provenance (reviewer ask)

> "C1 should inspect the actual production provenance of
>  config.env. If only trusted fixed host metadata reaches
>  it, fine--freeze that fact. If user/tool-controlled
>  values can supply BASH_ENV or BASH_FUNC_*, the filter
>  must operate on the final environment rather than just
>  the inherited layer."

Trace (apps/vscode/src/sdk/vscode-run-commands-tool.ts:640):

```ts
start = await manager.start(
  {
    command,
    cwd: commandCwd || cwd,
    shell,
    env: { SHELL: shell },     // <-- caller-supplied layer
    waitBudgetMs,
    ...
  },
  context,
)
```

where `shell` is the result of `getShellInvocation()`:

```
@cline/shared -> getShellInvocation
  returns /bin/bash on Unix, powershell on Windows
  (fixed host mapping, not user/tool-controlled)
```

The only other production caller is apps/vscode/src/sdk/command-job-manager.ts:524
which initializes `spawnEnv: Record<string, string> = options.env ?? {}`.
So the production caller-supplied env layer is **always**
host-trusted fixed metadata, never user/tool-controlled.

**Conclusion**: filter on the inherited process.env layer
is sufficient. config.env layer is not a leak vector.

## Causal mismatch

```
policy authorized C = "pwd" (general AUTO)
bash exec: function pwd (imported from BASH_FUNC_pwd%%)
                       > builtin pwd
                       > /bin/pwd (PATH lookup)
imported function executes BEFORE the policy-authorized
command can.
```

This affects EVERY bare-form bash -c invocation.

## Files identified for C2 touch

### Production change (executor-side, NOT command-policy)

```
sdk/packages/core/src/extensions/tools/executors/bash.ts

  Extend BASH_STARTUP_STRIPPABLE_ENV or add a parallel
  BASH_FUNC_PREFIX constant.

  Extend stripBashStartupEnvFromParent to also strip
  any name with the BASH_FUNC_ prefix from the inherited
  process.env layer.

  Strip semantics: prefix-match (not enumerable). The
  function name space is unbounded.

  Under envSemantics: "complete" (sanitized Seatbelt mode),
  the filter is a NO-OP because the materialized env is
  built from SAFE_ENVIRONMENT_BASELINE + allow list, which
  excludes BASH_FUNC_<name>%% by default.
```

### Out of scope (per reviewer)

- Filter on config.env layer (provenance frozen as host-
  trusted fixed metadata)
- linux mktemp support (separate ACT)
- mktemp template forms (separate ACT)
- executor-side transformedInput plumbing (separate ACT)
- other bash function-exporting variables (none documented
  beyond BASH_FUNC_<name>%%)

## Test plan for C2

Test cases (replace the structurally-wrong C2 conservation
test with real RED-CLOSED tests):

1. **RED CLOSED: bare `pwd` against BASH_FUNC_pwd%%**: sentinel remains empty
2. **RED CLOSED: bare `ls /tmp` against BASH_FUNC_ls%%**: sentinel remains empty
3. **RED CLOSED: bare `git --version` against BASH_FUNC_git%%**: sentinel remains empty
4. **RED CLOSED: bare `cat /dev/null` against BASH_FUNC_cat%%**: sentinel remains empty
5. **RED CLOSED: prefix-strip is unbounded**: arbitrary BASH_FUNC_<name>%% is stripped
6. **RED CLOSED: type -t pwd reports builtin (not function)**: when BASH_FUNC_pwd%% is in parent env
7. **CONSERVATION: slash-prefixed /usr/bin/mktemp still works**: composes with slash-bypass

## Trust state (this ACT)

```
ENTRY_HEAD = 622baa703 (C3 of BASH-STARTUP-ENV-AUTHORITY01)
branch     = main
origin/main = unchanged (19 unpushed local commits)
NOT pushed
```

## Verdict

```
C1 = PASS

The P0-5 leak is reproduced live through the production
executor seam.

config.env provenance is HOST-TRUSTED FIXED METADATA
(FROZEN).

The strip-filter approach from BASH-STARTUP-ENV-AUTHORITY01-C2
extends cleanly to BASH_FUNC_<name>%% by prefix-match.

C2 plan:
  EXECUTOR-SIDE strip of BASH_FUNC_* prefix from inherited
  process.env under overlay semantics, BEFORE the spread-
  merge with config.env.

  Implementation in
    sdk/packages/core/src/extensions/tools/executors/bash.ts
  only.

  NO command-policy change.
  NO Seatbelt change.
  NO proto/schema change.
  NO parser-helper change.
  NO DEFAULT_OFF behavior change for non-Bash-startup env.
```
