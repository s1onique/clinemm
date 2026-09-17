# ACT-CLINEMM-COMMAND-APPROVAL-SPLIT-UNDEFINED-REGRESSION01
# Decision Record

## Classification

```
P0_APPROVAL_RUNTIME_EXCEPTION

NOT:
  R0 coverage gap
  V2 parser rejection
  path-authority ASK
  reformulation behavior
```

## Reproduction (verbatim from the user's report)

> Tool "run_commands" approval request failed:
> Cannot read properties of undefined (reading 'split')

Reproduced via direct production SDK call against the bundled
`@cline/core/dist/index.js` (see recon report). The throw site is:

```
extractPathOperands (sdk/packages/core/src/runtime/command-policy/path-authority.ts:192)
  → renderNormalizedCommand(...) returns undefined
  → undefined.split(...) THROWS
```

## Root cause

Both host adapters pass the RAW `toolInput` straight through to
`buildPathAuthorityEvidence` with an `as never` cast:

```ts
// apps/vscode/src/sdk/SdkController.ts:1843
command: toolInput as never,

// apps/cli/src/runtime/command-policy-host.ts:368
command: input.toolInput as never,
```

`buildPathAuthorityEvidence` is typed for `NormalizedCommand =
string | { command, args? }`. The canonical normalizer
`normalizeRunCommandsInput` accepts MORE shapes than this — e.g.
`{ commands: ["pwd"] }`, `{ cmd: "pwd" }`, `{ commands: { command:
"pwd" } }`, `{ commands: [{ command: "pwd" }] }`, `["pwd"]`. For
any of those shapes, `renderNormalizedCommand` returns `undefined`
and the next `.split(...)` throws.

## Decision

Fix at the SDK boundary. `buildPathAuthorityEvidence` now:

1. Accepts `unknown` for `command` (was `NormalizedCommand`).
2. Internally runs the canonical normalizer
   `normalizeRunCommandsInput` (the SAME normalizer the policy
   layer uses in `normalizeForPolicy`).
3. Returns `ok: false` with a new `unparseable-command` reason on
   normalization failure — same fail-closed posture as the
   existing `no-workspace-roots` and `realpath-threw-uncaught`
   reasons. Under CORRECTION02, missing evidence ⇒ ASK (no V1
   lexical fallback in the production ALLOW path).

The host adapters no longer need the `as never` escape hatch;
both `SdkController.ts:1848` and `command-policy-host.ts:373` now
pass `toolInput` directly with the correct type.

## Why not fix at the host boundary instead?

Option (B) — pre-normalize in each host — was considered and
rejected:

1. The canonical normalizer belongs at the policy/SDK layer. The
   policy layer already calls it inside `normalizeForPolicy`. Any
   host that calls `buildPathAuthorityEvidence` would have to
   duplicate the same knowledge.
2. With 2 host adapters today and possibly more (JetBrains,
   future desktop), each new host is a new opportunity for the
   same shape drift.
3. The bug class is "input shape that the normalizer accepts but
   the evidence builder doesn't". Fixing it once at the SDK
   boundary closes the whole class.

## Why not throw a fail-closed error?

The function's contract is "fail closed, never throw" — see
the existing `no-workspace-roots` and `realpath-failed-enoent`
shapes. A thrown error becomes an uncaught exception at the host
boundary, which is exactly the bug we're repairing. Returning
`ok: false` lets the existing fail-closed logic kick in: host
disables path authority, policy downgrades path-bearing R0
commands to ASK with `host_workspace_realpath_authority`.

## Fail-closed contract (final)

`buildPathAuthorityEvidence` returns `ok: false` for:

| Reason | When |
|--------|------|
| `unparseable-command` | NEW: input cannot be normalized to a `NormalizedCommand`. |
| `no-workspace-roots` | Any configured workspace root fails `realpathSync`. |
| `realpath-threw-uncaught` | Any other uncaught fs error during operand resolution. |

Under all three, the host attaches no evidence to the policy;
under CORRECTION02 the production ALLOW path requires realpath
evidence, so missing evidence ⇒ ASK, never ALLOW. The V1 lexical
gate remains in the SDK for unit-testing and diagnostics but is
NOT part of the canonical policy's production ALLOW path.

## RED/GREEN proof (production-boundary)

### RED (before fix, run from a clean tree)

```
$ node /tmp/pwd-repro4.mjs
--- string 'pwd' ---           ok=true
--- {command:'pwd'} ---        ok=true
--- {commands:['pwd']} ---     THREW: Cannot read properties of undefined (reading 'split')
--- {cmd:'pwd'} ---            THREW: Cannot read properties of undefined (reading 'split')
--- {commands:{command:'pwd'}} --- THREW
--- {commands:[{command:'pwd'}]} --- THREW
--- {parallel:false} ---       THREW
--- {timeout:10000,cwd:'/x'} -- THREW
```

The 4 RED tests in the unit suite (`buildPathAuthorityEvidence`)
all failed with the EXACT wording the user reported.

### GREEN (after fix, rebuilt SDK + retest)

```
$ node /tmp/pwd-repro4.mjs
--- string 'pwd' ---           ok=true operands=0
--- {command:'pwd'} ---        ok=true operands=0
--- {commands:['pwd']} ---     ok=true operands=0     ← WAS THROWING
--- {cmd:'pwd'} ---            ok=true operands=0     ← WAS THROWING
--- {commands:{command:'pwd'}} --- ok=true operands=0  ← WAS THROWING
--- {commands:[{command:'pwd'}]} --- ok=true operands=0 ← WAS THROWING
--- {parallel:false} ---       ok=false (unparseable)   ← FAIL-CLOSED
--- {timeout:10000,cwd:'/x'} -- ok=false (unparseable)  ← FAIL-CLOSED
```

The same 4 RED tests now PASS, AND the truly-unparseable shapes
(no `command`/`commands`/`cmd` keys) return `ok: false` instead
of throwing — same fail-closed posture.
