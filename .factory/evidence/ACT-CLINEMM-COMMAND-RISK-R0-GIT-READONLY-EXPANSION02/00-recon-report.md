# ACT-CLINEMM-COMMAND-RISK-R0-GIT-READONLY-EXPANSION02

## Phase 1 — Recon

Pre-ACT (HEAD `fc4ff10e`): `git status --short && git log --oneline -20 &&
git branch --show-current` → the third leaf (`git branch --show-current`)
falls through to `host_mode_safe_only_fallthrough` (ASK) because no rule
matches. The first two leaves ALLOW (via `host_safe_git_status` and
`host_safe_git_log`), but the aggregate is ASK because `&&` triggers
`OPAQUE_SHELL_TOKENS` → rendered path ASK.

Even with V2 parser binding the AST, `risk_v2_structured_promotion`
cannot fire because one leaf is null (not positively matched).

The discriminator is exactly the missing `host_safe_git_branch` rule.

## Phase 2 — Per-option REVIEW STANDARD audit

git-branch(1) explicitly distinguishes listing/query from create/delete/
rename/copy/upstream-mutation. PASS:
  (bare)/--list, -a/--all, -r/--remotes, --show-current,
  --points-at <object>, --no-color, --color=<a|n>,
  -v/-vv/-vva, --no-abbrev

REJECT (mutating / authority-broadening):
  <name> create, -d/-D/--delete, -m/-M/--move, -c/-C/--copy,
  -u/--set-upstream-to/--unset-upstream, --edit-description,
  --track/--no-track, --contains/--merged/--no-merged,
  --format=<fmt> (see P1 fix below), unknown --foo

## Phase 4 — Bounded repair

Added `host_safe_git_branch` rule (regex, enumerated read-only
query forms only), `SAFE_GIT_BRANCH_PROFILE` (hardening prefix, no
diff-family suffix because `git branch` does not consume diff
options), and 1 new switch-arm in `getSafeExecutionProfileForSource`.

No parser changes. No shell AST changes. No command-risk V2 changes.
No new settings. No parser-helper delta.

## Phase 6 — V2 compound proof

```
git status --short && git log --oneline -20 && git branch --show-current
  safe-only + parser-binds AST => ALLOW + auto-approve-eligible
                              + risk_v2_structured_promotion
```

With `host_safe_git_branch` added, all three leaves are positively
matched → V2 promotion fires.

## Phase 7 — Ablation (load-bearing proof)

The Group A baseline freeze test asserts each new corpus row
matches its specific matchedSource:

```
r0-git-branch-show-current   matchedSource === 'host_safe_git_branch'
r0-git-branch-list           matchedSource === 'host_safe_git_branch'
r0-git-branch-all             matchedSource === 'host_safe_git_branch'
r0-git-branch-remotes         matchedSource === 'host_safe_git_branch'
```

If the rule is removed, these assertions fail. The test itself is
the ablation guard.

## REVISED 2026-08-24 (Factory review P1)

The original closure listed `--format=<reviewed fmt>` as PASS with
rationale "fmt in the same reviewed finite set as git log's --pretty:
oneline, short, medium, full, fuller, reference, email, raw, tformat".
This was inaccurate.

Per git-branch(1), `--format=<format>` is the **git-for-each-ref
interpolation format** (e.g. `%(refname:short)`, `%(HEAD)`,
`%(upstream:track)`). The names `oneline`/`short`/etc. are
log/pretty presets — NOT valid git-branch --format directives.
Empirically, `git branch --format=oneline` prints literal "oneline"
per branch rather than formatting the branch name, confirming the
original allowlist was a **false positive** (ALLOW that does the
wrong thing).

**Bounded fix**: the `--format=` token is REMOVED from the rule
pattern entirely. The rationale comment in `command-safe-rules.ts`
is rewritten. 11 new rejection fixtures added to
`command-safe-rules.test.ts` (every previously-allowed preset name
+ a representative git-for-each-ref interpolation).

The board row for the prior ACT is marked "REVISED 2026-08-24
(Factory review P1; --format rejection; see follow-up commit)" and
the follow-up commit carries the production fix.

**Net effect on safe-only corpus**:
- `git branch --format=oneline` (and 8 sibling preset names) change
  from ALLOW → ASK (correct behavior; users get the right approval
  gate for an unhandled option).
- All other positive fixtures (bare/`--list`/`-a`/`-r`/`--show-current`/
  `--points-at`/color/v/abbrev) remain ALLOW.
- No mutating form's verdict changes.
- No other command's ALLOW surface changes.
