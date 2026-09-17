# ACT-CLINEMM-COMMAND-RISK-V2-MKTEMP-TEMP-AUTHORITY01-CORRECTION03 -- C1 Closure

## Verdict

```
C1 = PASS

The P0-3 leak is reproduced live. The CORRECTION02 evidence
is shown to be insufficient because bash's lookup order
includes shell functions and BASH_ENV BEFORE PATH.

Contract freeze: restrict positive AUTO forms to slash-prefixed
explicit-path variants /usr/bin/mktemp and /usr/bin/mktemp -d.
Bare `mktemp` stays ASK with new source
host_mktemp_shell_resolution_unbound.
```

## Reproduced causal chain

```
parent shell:
  mktemp() { printf "BAD %s\n" "$TMPDIR"; }
  export -f mktemp

policy-time:
  /usr/bin/which mktemp -> /usr/bin/mktemp (or GNU on this Nix host)
  realpath -> matches CORRECTION02 identity gate
  evidence -> valid
  gate passes -> ALLOW

execution-time:
  bash -c "mktemp" (per apps/vscode/src/sdk/command-job-manager.ts:484-487
  and getShellInvocation in sdk/packages/shared/src/parse/shell.ts:88-89)
  bash resolves "mktemp" via its lookup order:
    1. shell function <- EXPORTED FUNCTION RUNS
    2. shell builtin
    3. $PATH
  -> function executes, NOT /usr/bin/mktemp
```

Both reproduction channels verified live:
- `export -f mktemp` → function runs in child bash
- `BASH_ENV=<file defining mktemp()>` → function runs in child bash

## CORRECTION03 contract freeze

### New positive forms (regex-restricted)

The host_safe_mktemp_default_temp rule's positive regex becomes:

```regex
^\/usr\/bin\/mktemp(?:[ \t]+-d)?[ \t]*$
```

That is, EXACTLY:
- `/usr/bin/mktemp`     (no trailing whitespace or args)
- `/usr/bin/mktemp -d`  (exactly one space + -d, no other args)
- `/usr/bin/mktemp  -d` (multiple spaces tolerated)

Anything else (`mktemp`, `mktemp -d`, `mktemp -u`, `/usr/bin/mktemp foo.XXXXXX`,
prefix variants, template forms, etc.) does NOT match the rule → falls through to
the next rule → ASK or DENY based on the existing lattice.

### Why slash-prefix is sufficient

GNU Bash Reference Manual, "Command Search and Execution":

> "If the command name contains a slash, Bash uses it as a
>  pathname and executes it directly, without performing function
>  or builtin lookup."

Live verified at `red-p0-3-shell-function.txt`:
- `bash -c "mktemp"` with `export -f mktemp` → function runs
- `bash -c "/usr/bin/mktemp"` with same `export -f mktemp` → binary runs
- `bash -c "mktemp"` with `BASH_ENV` → function runs
- `bash -c "/usr/bin/mktemp"` with same `BASH_ENV` → binary runs

Bash treats `/usr/bin/mktemp` as an absolute pathname: no function
lookup, no builtin lookup, no PATH lookup, no BASH_ENV consideration.
The executable identity that runs is exactly the identity the policy
proved.

### Why bare `mktemp` cannot be AUTO

Without an absolute pathname, bash performs:
1. Shell function lookup (exported `mktemp` from parent wins)
2. Shell builtin lookup (no `mktemp` builtin, but future-proof)
3. $PATH lookup (proven by CORRECTION02 evidence)

Step 1 is the leak: the parent shell can `export -f mktemp`, and
the child bash inherits the function before the policy-time PATH
lookup happens. Even with the most careful `which`-based evidence,
the identity is only "PATH lookup result", not "actual executed
identity".

The only ways to close this in a bash-string-executor model are:

  (a) Require slash-prefix at the policy layer (this ACT's approach)
  (b) Plumb transformedInput through the executor so the policy
      can rewrite `mktemp` -> `/usr/bin/mktemp` AND the executor
      actually uses the rewritten input.

(b) preserves bare-form UX but requires significant executor
plumbing (StartCommandJobOptions + vscode-run-commands-tool +
sdk-interaction-coordinator + SdkController); this is a separate
architectural concern and out of scope for the bounded CORRECTION03.

### New source label

```
"host_mktemp_shell_resolution_unbound"
```

For bare `mktemp` and `mktemp -d` when the lexical gate fires.
This lets operators see WHY the bare form was not auto-approved
(distinct from the executable-identity and temp-authority gates).

### Files to be touched in C2

```
sdk/packages/core/src/runtime/command-policy/command-safe-rules.ts
  REWRITE host_safe_mktemp_default_temp regex:
    OLD: ^mktemp(?:[ \t]+-d)?[ \t]*$
    NEW: ^\/usr\/bin\/mktemp(?:[ \t]+-d)?[ \t]*$

sdk/packages/core/src/runtime/command-policy/command-policy-types.ts
  +new CommandDecisionSource value
   "host_mktemp_shell_resolution_unbound"

sdk/packages/core/src/runtime/command-policy/command-policy.mktemp-host-evidence-bound.test.ts
  REWRITE positive cases: now requires /usr/bin/mktemp
                          identity-bound evidence
  ADD: bare `mktemp` is ASK with new source
  ADD: bare `mktemp -d` is ASK with new source

sdk/packages/core/src/runtime/command-policy/_live-qualification-c5.test.ts
  RENAME to _live-qualification-c6.test.ts
  REWRITE: positive cases require explicit path; negative cases
          include the bare form

sdk/packages/core/src/runtime/command-policy/_live-qualification-c4.test.ts
  (no resurrection; c6 replaces c5)

apps/vscode/src/sdk/sdk-tool-policies.ts
  (no changes; helper still sources which+getconf+realpath)

apps/vscode/src/sdk/sdk-tool-policies.test.ts
  +1 test: /usr/bin/mktemp identity (positive)
  +1 test: bare `mktemp` lexical result in ASK
  (existing tests remain unchanged; adapter hasn't changed)
```

### Files NOT touched

```
sdk/packages/core/bin/parser-helper/darwin-*/cline-parser-helper   unchanged
sdk/packages/core/bin/parser-helper/SHA256SUMS.txt                unchanged
proto/cline/*.proto                                                unchanged
sdk/packages/core/src/runtime/command-policy/command-risk.ts       unchanged
sdk/packages/core/src/runtime/command-policy/structured-command-risk.ts unchanged
sdk/packages/core/src/runtime/command-policy/path-authority.ts     unchanged
sdk/packages/core/src/runtime/sandbox/macos/seatbelt-backend.ts    unchanged
sdk/packages/core/src/runtime/command-policy/command-policy.ts
  (no changes; the host-evidence-bound branch is intact; the lexical
   change is in command-safe-rules.ts only)
```

### Out of scope (correctly remain ASK)

- All bare `mktemp` / `mktemp -d` (now ASK with new source)
- GNU/Linux mktemp support (separate ACT)
- mktemp template forms `mktemp foo.XXXXXX` (separate authority family)
- All `-u`, `-p`, `-t`, `--tmpdir`, dynamic, env, compose,
  opaque, brace/glob forms (already ASK)
- mktemp -d with prefix variations (ASK via lexical reject)
- /usr/bin/mktemp with arguments other than exactly `-d` (ASK via lexical reject)
- /usr/bin/mktemp with TMPDIR/env override (ASK via lexical reject)

### Trade-off: UX regression for bare `mktemp`

Users typing bare `mktemp` will now see an approval card instead
of AUTO. The approval-card reason will explicitly state the
shell-resolution gap. The model can re-issue the command as
`/usr/bin/mktemp` to obtain AUTO. This is a bounded, explicit
trade-off: the user retains the explicit-approval gate in the
high-risk case, and the policy's identity claim is honest for
the AUTO case.

### Verdict

```
C1 = PASS (entry freeze clean, P0-3 reproduced live, contract
       freeze for the bounded correction established).

C2 = GO (lean implementation as described; explicit-path-only
       positive forms; new source label for bare forms).
```
