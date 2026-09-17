# ACT-CLINEMM-COMMAND-RISK-R0-GIT-READONLY-EXPANSION02 — Final Report

## Summary

Closed a focused R0_LEAF_COVERAGE_GAP by adding the `host_safe_git_branch`
host-proven safe rule (plus matching `SAFE_GIT_BRANCH_PROFILE` and 4
corpus rows), so the realistic recon chain
`git status && git log --oneline -20 && git branch --show-current`
auto-promotes ASK → ALLOW via `risk_v2_structured_promotion` when
the parser binds the AST.

The Factory review identified a P1 inaccuracy (the original
`--format=<fmt>` allowlist used `git log --pretty` preset names which
are NOT valid `git branch --format` directives — empirical test:
`git branch --format=oneline` prints literal "oneline" per branch).
The P1 fix REMOVES `--format=` from the rule pattern entirely;
11 new rejection fixtures added.

R5 conservation proven: catastrophic `rm -rf "$HOME"` patterns still
ASK + never-auto-approve in both safe-only and all-mode.

## Trust state

| Item | Value |
|------|-------|
| Prior ACT closure | `b6dc4bd385f9eec957fd92feae620c1addaee540` |
| P1 fix + board row follow-up | `f89983f72cf30f26234bf0ff4b42e4521b084ee7` |
| Bundle sha256 | `5aef2c3583c7235787688c924dd92193221e288d3df6ad6863ea67742fb26a92` |
| VSIX file | `dist/clinemm-r0recon-f89983f72.vsix` |
| Branch | main |
| origin/main | unchanged |
| Push | NOT pushed (ACT-committed work convention) |

## Phase 9 LIVE qualification

- Bundle sha256 verified for both SDK bundle and extension bundle.
- VSIX built at `dist/clinemm-r0recon-f89983f72.vsix`.
- VSIX installed at user's VSCodium path:
  `/Volumes/UserData/Users/chistyakov/.vscodium-clinemm/extensions/
  s1onique.clinemm-4.1.10/dist/extension.js` (sha256 matches).
- The user's VSCodium (process `VSCODE_PID=28847`) has the OLD bundle
  loaded in memory until `Developer: Reload Window` is triggered.
- Evidence classification: **REAL_PRODUCTION_BUNDLE PROVEN;
  LIVE INSTALLED requires user reload** (per Factory review guidance).

After the user reloads VSCodium, the following commands should
auto-run (no approval card) in any chat session with
`executeSafeCommands=true` and no model escalation:

```
git branch --show-current
git branch --list
git branch -a
git branch -r
```

And the following should ASK:

```
git branch --format=oneline       # --format rejected (P1 fix)
git branch foo                    # create
git branch foo HEAD               # create at start
git branch -D foo                 # delete
git branch -d foo                 # delete (safe)
git branch -m old new             # rename
git branch -c old new             # copy
git branch --set-upstream-to=...  # upstream mutation
git branch -u origin/main foo     # upstream mutation
git branch --unset-upstream foo   # upstream mutation
git branch --edit-description foo # writes
git branch --track origin/main foo # create-tracking
git branch --contains HEAD        # broader commit-set predicate
git branch --merged               # broader commit-set predicate
git branch --no-merged             # broader commit-set predicate
git branch --whatever             # unknown option
```

## Verdict

**PASS_R0_GIT_READONLY_EXPANSION (REVISED — Factory review P1 fix applied)**
**ACT-CLINEMM-COMMAND-RISK-R0-GIT-READONLY-EXPANSION02 = CLOSED_CLEAN**
