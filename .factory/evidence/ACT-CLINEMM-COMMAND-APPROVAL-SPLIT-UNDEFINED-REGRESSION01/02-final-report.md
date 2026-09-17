# ACT-CLINEMM-COMMAND-APPROVAL-SPLIT-UNDEFINED-REGRESSION01
# Final Report

## Closure disposition

**Closed at the production-fix commit (HEAD after this ACT).**

This ACT HALTED the reformulation work and repaired a P0
approval-path regression introduced by
`ACT-CLINEMM-COMMAND-RISK-R0-WORKSPACE-PATH-AUTHORITY01-CORRECTION02`.
The reformulation ACT is now unblocked — it may resume once this
ACT is merged.

## Root cause

`buildPathAuthorityEvidence(...)` in
`sdk/packages/core/src/runtime/command-policy/path-authority-evidence-builder.ts`
was typed for `NormalizedCommand = string | { command, args? }`.
Both production host adapters (`SdkController.ts:1843` and
`command-policy-host.ts:368`) passed the RAW `toolInput` with an
`as never` cast, which bypassed the type check at compile time
but threw at runtime for any shape that the canonical
`normalizeRunCommandsInput` accepts but `NormalizedCommand`
doesn't recognize — including `{ commands: ["pwd"] }`,
`{ cmd: "pwd" }`, arrays, and other AI-emission variants.

## Bounded repair

The fix is local to the SDK boundary:

- `BuildPathEvidenceOptions.command` is widened from
  `NormalizedCommand` to `unknown`.
- A new private helper `normalizeForEvidence(...)` runs the
  canonical `normalizeRunCommandsInput` and reduces the result
  to a list of `NormalizedCommand` values (returning `null` on
  failure).
- `BuildPathEvidenceFailure.reason` gained a new
  `unparseable-command` value, treated identically to the
  existing `no-workspace-roots` and `realpath-threw-uncaught`
  reasons: the host treats `!result.ok` as "path authority
  disabled", and under CORRECTION02 the policy downgrades
  path-bearing R0 commands to ASK (no V1 lexical fallback in
  the production ALLOW path).
- The `as never` escape hatch in both host adapters is removed
  (now unnecessary — the parameter type is `unknown`).
- Multi-command inputs
  (e.g. `{ commands: ["ls /etc", "ls /var"] }`) are flattened
  into a single operands array; the CORRECTION02 operand
  identity binding is checked per-command later in the policy
  layer.

The V1 lexical primitives (`isLexicallyContained`,
`evaluateCommandPathConformance`) remain in the SDK for
unit-testing and diagnostics but are not part of the canonical
policy's production ALLOW path (unchanged from CORRECTION02).

## RED/GREEN proof (RED -> GREEN, SDK boundary)

Before fix (RED):

```
buildPathAuthorityEvidence({ ..., command: { commands: ["pwd"] } })
  → TypeError: Cannot read properties of undefined (reading 'split')
  at extractPathOperands (path-authority.ts:192:26)
  at buildPathAuthorityEvidence (path-authority-evidence-builder.ts:179:19)
```

After fix (GREEN):

```
buildPathAuthorityEvidence({ ..., command: { commands: ["pwd"] } })
  → { ok: true, evidence: { roots, cwd, operands: [] } }
```

The 11 new RED tests in
`sdk/packages/core/src/runtime/command-policy/path-authority-evidence-builder.test.ts`
cover:

- `{ commands: ["pwd"] }` (live symptom)
- `{ cmd: "pwd" }`
- `{ commands: { command: "pwd" } }` (object form)
- `{ commands: [{ command: "pwd" }] }` (structured array)
- bare array `["pwd"]`
- `{ command: "pwd", cwd: "/x" }` (AI-emitted extras)
- operand extraction correctness for path-bearing inputs in all
  of the above shapes
- canonical `{ command: "pwd" }` and string `"pwd"` inputs
  (regression guards)

The 4 new RED tests in
`apps/cli/src/runtime/command-policy-host.test.ts` cover the
end-to-end CLI host adapter behavior for the live symptom
shapes.

## Tests

| Surface | Count | Status |
|---------|-------|--------|
| `@cline/core` unit (full) | 2509 PASS / 14 SKIPPED (was 2498 / 14; +11 from this ACT) | GREEN |
| `@cline/core` command-policy/ | 549 PASS (was 538; +11 from this ACT) | GREEN |
| `@cline/core` typecheck | EXIT=0 (no new errors introduced; 7 pre-existing unrelated errors remain) | GREEN |
| `apps/cli` command-policy-host | 51 PASS / 5 integration (was 42; +4 new RED tests for the live symptom shapes) | GREEN |
| `apps/cli` typecheck | EXIT=0 | GREEN |
| `apps/vscode` src/sdk/ | 1954 PASS / 5 SKIP (was 1954; no regression — new tests live at SDK boundary) | GREEN |
| `apps/vscode` sdk-tool-policies | 88 PASS (was 88; no regression) | GREEN |
| `apps/vscode` check-types | EXIT=0 | GREEN |
| `git diff --check HEAD` | PASS | GREEN |
| Biome lint (changed files) | CLEAN (auto-format applied) | GREEN |
| SDK rebuild | EXIT=0 | GREEN |

## Live verification (production SDK bundle)

```
$ node /tmp/pwd-repro4.mjs
--- string 'pwd' ---           ok=true operands=0
--- {command:'pwd'} ---        ok=true operands=0
--- {commands:['pwd']} ---     ok=true operands=0
--- {cmd:'pwd'} ---            ok=true operands=0
--- {commands:{command:'pwd'}} --- ok=true operands=0
--- {commands:[{command:'pwd'}]} --- ok=true operands=0
--- {parallel:false} ---       ok=false (unparseable)   ← FAIL-CLOSED
--- {timeout:10000,cwd:'/x'} -- ok=false (unparseable)  ← FAIL-CLOSED
--- {tool:'run_commands',input:{command:'pwd'}} --- ok=false (unparseable)
```

The previously-throwing shapes now return `ok: true` with the
correct operand set, and truly-unparseable inputs (no
`command`/`commands`/`cmd` keys at all) return `ok: false` —
same fail-closed posture as `no-workspace-roots`. Under
CORRECTION02, missing evidence ⇒ ASK, never ALLOW.

## Conservation

- V1 lexical primitives unchanged.
- CORRECTION02 fail-closed posture unchanged.
- No new TypeScript errors introduced.
- All pre-existing tests still pass (no regressions).
- CLI host adapter (`autoApproveTools=false` → `mode: "manual"`)
  contract preserved.
- VSCode host adapter approval flow unchanged at the call-site
  level — the only change is dropping the `as never` cast and
  updating the failure log message.

## R5 hard-floor conservation

R5 catastrophic commands (`rm -rf /`) still trigger the R5 hard
floor regardless of host mode or evidence state. The hard floor
is layered on top of the canonical policy verdict in
`evaluateCommandToolApprovalWithPlan` (line 318 in
`apps/vscode/src/sdk/sdk-tool-policies.ts`) — that layering is
unchanged.

## Trust state

- HEAD = (this ACT's commit).
- Branch: main.
- origin/main: unchanged.
- NOT pushed (ACT-committed work convention).
- All edits surgical; no edits to `out/`, `dist/`, or
  `src/generated/`.

## Files changed

| File | Change |
|------|--------|
| `sdk/packages/core/src/runtime/command-policy/path-authority-evidence-builder.ts` | Fix: widen `command` to `unknown`, add `normalizeForEvidence`, add `unparseable-command` failure reason, flatten multi-command inputs. |
| `sdk/packages/core/src/runtime/command-policy/path-authority-evidence-builder.test.ts` | +11 RED tests for the production-boundary normalization contract. |
| `apps/cli/src/runtime/command-policy-host.ts` | Drop `as never`, pass `toolInput` directly. Updated failure-log comment for CORRECTION02 fail-closed posture. |
| `apps/cli/src/runtime/command-policy-host.test.ts` | +4 RED tests for the CLI host adapter's behavior on the live symptom shapes. |
| `apps/vscode/src/sdk/SdkController.ts` | Drop `as never`, pass `toolInput` directly. Updated log message for CORRECTION02 fail-closed posture. |

## Verdict

`PASS_COMMAND_APPROVAL_SPLIT_UNDEFINED_REGRESSION`

The P0 approval-path exception is closed. The reformulation ACT
is now unblocked. Trivial commands (`pwd`, `git status`, `git
status && git diff --stat`) traverse the approval path without
exception; R5 catastrophic commands still hit the hard floor;
R0 path-bearing commands still hit the new path-authority gate
under CORRECTION02.

## Reopen conditions

- A new input shape is accepted by `normalizeRunCommandsInput`
  but the new evidence-builder `normalizeForEvidence` rejects
  it (the new tests pin the current contract; new shapes must
  add new tests).
- The V2 parser-helper ACT (`ACT-CLINEMM-COMMAND-RISK-V2-QUOTED-PATTERN-PROVENANCE01`)
  introduces a new tool-input shape that the normalizer
  accepts but the evidence builder doesn't (out of scope here;
  forward pointer in the closure plan for that ACT).
