# ACT-CLINEMM-COMMAND-RISK-R0-WORKSPACE-PATH-AUTHORITY01

## Phase 1 — Recon

Pre-ACT (HEAD `23f328295`, prior ACT
`ACT-CLINEMM-COMMAND-RISK-R0-READONLY-RECON-EXPANSION02-CORRECTION02`
closed):

The `host_safe_ls` and `host_safe_find` rules in
`DEFAULT_COMMAND_HOST_ALLOW_RULES` were PATH-AGNOSTIC. The regex
matched ANY path-class-conformant operand (relative or absolute).
The corpus entry `r0-ls-somepath: "ls /etc" => allow` documented
this as the post-V3 snapshot.

**The regression**: an `ls /etc`, `ls ~/.ssh`, `find /etc`,
`find /`, or any absolute-path read-only recon of a path outside
the project was ALLOW. The path-agnostic regex confirmed the
COMMAND SHAPE is safe, but the path operands' read scope was
unbounded — the policy layer could not answer "are these operands
inside the project?".

**The user's correct architectural point** (from the board review):
absolute paths inside the active project should not be penalized
just for being absolute; absolute paths outside the project
should ASK. Read scope is a separate axis from command shape.

## Why a separate layer (path authority)

1. **Small, bounded, positive allowlist.** The R0 regex must remain
   small. Path-aware allowlisting (enumerating every workspace root
   in REGEX) would bloat the regex and conflate "command shape"
   with "path scope".

2. **Host-supplied workspace root.** The host owns "the active
   project". The policy layer must never bake any user's
   filesystem layout into its rules. The host passes
   `workspaceRoots` and `cwd` on the authorization object; the
   policy consults them at evaluation time.

3. **Reusability.** Future R0 family expansions (cat, head, tail,
   stat, file) consult the same containment helper without
   re-deriving path logic.

## V1 contract (LEXICAL_WORKSPACE_CONFINEMENT)

```
read-only command
+
every path operand resolves inside an authorized workspace root
=
ALLOW-eligible
```

Containment primitive: `path.resolve(root, operand) === root || path.resolve(root, operand).startsWith(root + path.sep)`. Lexical dot-segments (`..`) are caught by `path.resolve` upstream of the containment check.

## V1 known limitations (pinned in corpus)

1. **Symlink-to-outside** (`project/outside-link -> /etc`)
   lexically passes containment. The realpath variant is a
   follow-up ACT
   (`ACT-CLINEMM-COMMAND-RISK-V2-REALPATH-WORKSPACE-CONFINEMENT01`).

2. **Tilde-prefixed operands** (`~/.ssh`) are explicitly REJECTED
   at the path authority layer (POSIX shell-expansion token).

3. **Multi-root workspaces** — V1 confines the path authority to
   the active workspace root. Multi-root support is a follow-up
   enhancement.

## Files touched

- `sdk/packages/core/src/runtime/command-policy/path-authority.ts` (NEW)
- `sdk/packages/core/src/runtime/command-policy/path-authority.test.ts` (NEW)
- `sdk/packages/core/src/runtime/command-policy/command-risk-corpus.path-authority.test.ts` (NEW)
- `sdk/packages/core/src/runtime/command-policy/command-policy-types.ts`
- `sdk/packages/core/src/runtime/command-policy/command-policy.ts`
- `sdk/packages/core/src/runtime/command-policy/command-safe-rules.ts`
- `sdk/packages/core/src/runtime/command-policy/command-risk-corpus.ts`
- `sdk/packages/core/src/runtime/command-policy/command-risk-corpus.baseline.test.ts`
- `sdk/packages/core/src/runtime/command-policy/index.ts`
- `apps/cli/src/runtime/command-policy-host.ts`
- `apps/vscode/src/sdk/sdk-tool-policies.ts`
- `apps/vscode/src/sdk/SdkController.ts`
- `.factory/evidence/ACT-CLINEMM-COMMAND-RISK-R0-WORKSPACE-PATH-AUTHORITY01/00-recon-report.md` (this file)
- `.factory/evidence/ACT-CLINEMM-COMMAND-RISK-R0-WORKSPACE-PATH-AUTHORITY01/01-decision-record.md`
- `.factory/evidence/ACT-CLINEMM-COMMAND-RISK-R0-WORKSPACE-PATH-AUTHORITY01/02-final-report.md`
- `docs/closure-plans/ACT-CLINEMM-COMMAND-RISK-R0-WORKSPACE-PATH-AUTHORITY01.json` (closure plan)
- `.factory/epic-board.md` (board row)
