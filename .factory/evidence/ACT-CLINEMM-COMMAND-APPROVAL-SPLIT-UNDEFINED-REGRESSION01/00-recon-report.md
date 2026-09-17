# ACT-CLINEMM-COMMAND-APPROVAL-SPLIT-UNDEFINED-REGRESSION01
# Recon Report
## Symptom

The user reports that even the trivial command `pwd` (and `git status`,
`git status && git diff --stat`) is rejected BEFORE EXECUTION with:

```
Tool "run_commands" approval request failed:
Cannot read properties of undefined (reading 'split')
```

This is NOT a safe-command classification decision. The approval
PATH itself is throwing.

## Root cause (located by direct production repro)

The CORRECTION01 -> CORRECTION02 ACTs added host-produced realpath
evidence (`buildPathAuthorityEvidence`) to the production ALLOW
path for path-bearing R0 commands. Both host adapters (VSCode
`SdkController.ts:1843`, CLI `command-policy-host.ts:368`) call:

```ts
const result = buildPathAuthorityEvidence({
    workspaceRoots,
    cwd,
    command: toolInput as never,   // <-- raw toolInput, NOT a NormalizedCommand
})
```

`buildPathAuthorityEvidence` -> `extractPathOperands` ->
`renderNormalizedCommand(cmd)`. `renderNormalizedCommand` is typed
for `NormalizedCommand = string | { command: string, args?: string[] }`.
For ANY input that is not one of those exact shapes, the cast
`as never` masks the type error at the host but at runtime:

```ts
// renderNormalizedCommand:
const args = cmd.args ?? [];       // cmd.args === undefined -> []
if (args.length === 0) {
    return cmd.command;            // cmd.command === undefined -> returns undefined
}
```

The returned `undefined` then reaches `extractPathOperands`:

```ts
const rendered = renderNormalizedCommand(command);   // undefined
const tokens = rendered.split(/\s+/u)...              // TypeError: Cannot read properties of undefined (reading 'split')
```

## Concrete failing shapes (proven by `node /tmp/pwd-repro4.mjs`)

The canonical normalizer `normalizeRunCommandsInput` accepts (via the
`RunCommandsInputUnionSchema` union in
`sdk/packages/core/src/extensions/tools/schemas.ts:168-178`):

- `string`
- `{ command: string }`         <- passes
- `{ command, args }`           <- passes
- `{ commands: ["pwd"] }`       <- THROWS  (this matches the live symptom)
- `{ commands: [{...}] }`       <- THROWS
- `{ commands: { command: "pwd" } }` <- THROWS
- `{ cmd: "pwd" }`              <- THROWS
- `["pwd"]`                     <- THROWS
- `[{...}]`                     <- THROWS

Live direct repro (run from the project root):

```bash
node /tmp/pwd-repro4.mjs
```

```
--- string 'pwd' ---
  ok=true operands=0
--- {command:'pwd'} ---
  ok=true operands=0
--- {commands:['pwd']} ---
  THREW: Cannot read properties of undefined (reading 'split')
--- {cmd:'pwd'} ---
  THREW: Cannot read properties of undefined (reading 'split')
--- {commands:{command:'pwd'}} ---
  THREW: Cannot read properties of undefined (reading 'split')
--- {commands:[{command:'pwd'}]} ---
  THREW: Cannot read properties of undefined (reading 'split')
--- {parallel:false} ---
  THREW: Cannot read properties of undefined (reading 'split')
--- {timeout:10000,cwd:'/x'} ---
  THREW: Cannot read properties of undefined (reading 'split')
```

This is the exact wording the user reported. **Root cause located.**

## Strong discriminator (per expert suggestion)

The discriminator the expert suggested (`if path-authority code is
entered for pwd, then likely incorrect scope/gating`) is correct in
spirit but slightly off. The path-authority code IS entered — and
the bug is that the path-authority code assumes the input is a
`NormalizedCommand` when the host has not pre-normalized.

The CORRECT discriminator is: **any input that
`normalizeRunCommandsInput` accepts but isn't a `string` or
`{command, args?}` object will throw**.

## Decision

P0_APPROVAL_RUNTIME_EXCEPTION. NOT a parser rejection, NOT a
coverage gap, NOT a path-authority ASK, NOT a reformulation
behavior.

The `as never` cast at the host boundary is masking a real
contract violation: `buildPathAuthorityEvidence` expects a
`NormalizedCommand`, but the host passes raw `toolInput`.

## Fix shape

Two options:

(A) Make `buildPathAuthorityEvidence` accept `unknown` and
    internally call `normalizeRunCommandsInput` (the canonical
    normalizer used by the policy layer). On normalization
    failure, return `ok: false` like other failures.

(B) Make the host adapters pre-normalize before calling
    `buildPathAuthorityEvidence`.

Option (A) is the correct architectural choice because:
- The policy layer is the canonical owner of normalization
  semantics (it already calls `normalizeRunCommandsInput`
  internally in `normalizeForPolicy` at
  `command-policy.ts:157`).
- Option (B) duplicates that knowledge in N host adapters and
  re-introduces the same shape drift every time a new tool
  variant is added.
- The CLI and VSCode adapters are both affected identically —
  fixing it once in the SDK closes the whole bug class.

## Affected host adapters (will continue to work after the fix)

| Host | File | Line | Current code |
|------|------|------|--------------|
| VSCode | `apps/vscode/src/sdk/SdkController.ts` | 1843 | `command: toolInput as never` |
| CLI | `apps/cli/src/runtime/command-policy-host.ts` | 368 | `command: input.toolInput as never` |

Both `as never` casts become unnecessary after the fix (the SDK
parameter type widens to `NormalizedCommand | unknown` and the
normalizer handles it internally).
