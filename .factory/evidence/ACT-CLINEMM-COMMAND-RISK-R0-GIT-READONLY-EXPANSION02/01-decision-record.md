# ACT-CLINEMM-COMMAND-RISK-R0-GIT-READONLY-EXPANSION02 — Decision Record

## Decision

Add a bounded, audited host-proven safe rule `host_safe_git_branch` to
`DEFAULT_COMMAND_HOST_ALLOW_RULES`, covering read-only `git branch`
query forms documented in git-branch(1). Each option is reviewed
against the REVIEW STANDARD at the top of `command-safe-rules.ts`.

Plus matching safe execution profile `SAFE_GIT_BRANCH_PROFILE`
(reuses `GIT_GLOBAL_HARDENING`; no diff-family suffix because
`git branch` does not consume `--no-ext-diff` / `--no-textconv`).

Plus 4 corpus rows in `command-risk-corpus.ts` (family `R0-readonly`).

Plus Group A baseline freeze test updates.

Plus `--format=<fmt>` REMOVED from the rule pattern entirely
(Factory review P1 fix). The previously-allowed git log --pretty
preset names (`oneline`/`short`/`medium`/`full`/`fuller`/`reference`/
`email`/`raw`/`tformat`) are log/pretty presets — NOT valid git-branch
--format directives. Empirically, `git branch --format=oneline` prints
literal "oneline" per branch rather than formatting the branch name,
confirming the original allowlist was a false positive.

## Production diff (this ACT)

3 production files + 3 test files + 3 evidence docs + 1 board row.

| File | Change |
|------|--------|
| `command-safe-rules.ts` | + `host_safe_git_branch` rule; `--format=` token REMOVED (P1) |
| `safe-execution-profile.ts` | + `SAFE_GIT_BRANCH_PROFILE` |
| `command-risk-corpus.ts` | + 4 corpus rows |
| `command-safe-rules.test.ts` | + 26 positive + 23 rejection fixtures (incl. 11 --format) |
| `safe-execution-profile.test.ts` | + 2 new tests |
| `command-risk-corpus.baseline.test.ts` | + 8 new assertions |

## Tests (3 surfaces, +43 tests)

```
@cline/core command-policy/ (15 files):           369 PASS
@cline/core full unit:                           2334 PASS / 14 SKIPPED
                                                  (was 2291 at HEAD; +43 net)
CLI host command-policy:                          45 PASS
VSCode sdk-tool-policies:                         88 PASS
apps/vscode check-types:                         EXIT=0
git diff --check HEAD:                            PASS
```

5 of 6 modified SDK files lint CLEAN. The 6th
(`command-risk-corpus.baseline.test.ts`) has a pre-existing
import-order error inherited from `1a3f79a2` (HEAD before any ACT
work) — NOT introduced by this ACT.

## R5 conservation

Live V2 path with parser binding proves `git status && rm -rf "$HOME"`
strengthens to ASK + never-auto-approve (safe-only via
`host_mode_safe_only_fallthrough`, all-mode via `risk_hard_floor`) —
both floors intact.

`git branch -D __SENTINEL_DOES_NOT_EXIST__` → ASK (mutation correctly
rejected).

## Phase 9 LIVE qualification

Rebuilt SDK (`bun run build` in `sdk/packages/core`) and re-bundled
extension (`bun esbuild.mjs` in `apps/vscode`). The new rule is
present in both bundles (verified via `grep`).

Bundle sha256: `5aef2c3583c7235787688c924dd92193221e288d3df6ad6863ea67742fb26a92`.

VSIX built: `dist/clinemm-r0recon-f89983f72.vsix` (51 files, 13.53 MB).

Installed at user's VSCodium path:
`/Volumes/UserData/Users/chistyakov/.vscodium-clinemm/extensions/
s1onique.clinemm-4.1.10/dist/extension.js`

The user's VSCodium (process `VSCODE_PID=28847`) has the OLD bundle
loaded in memory until `Developer: Reload Window` is triggered. Per
the Factory review's guidance ("If not, call the current evidence
REAL_PRODUCTION_BUNDLE, not LIVE"), this evidence is classified as
**REAL_PRODUCTION_BUNDLE PROVEN; LIVE INSTALLED requires user reload**.

Drove the canonical V1 path through the actual production bundle
(`sdk/packages/core/dist/index.js`) — this is exactly the code that
runs in the extension host — and confirmed:

```
LIVE via bundled SDK dist/index.js (post-build):

git branch --show-current       => ALLOW (host_safe_git_branch)
git branch -a                   => ALLOW (host_safe_git_branch)
git branch -D some-feature      => ASK  (mutating form correctly rejected)
git branch --format=oneline     => ASK  (P1 fix --format rejected)
git branch foo                  => ASK  (create form correctly rejected)
```

## Trust state

| Item | Value |
|------|-------|
| Prior ACT closure | `b6dc4bd385f9eec957fd92feae620c1addaee540` |
| P1 fix + board row follow-up | `f89983f72cf30f26234bf0ff4b42e4521b084ee7` |
| Bundle sha256 | `5aef2c3583c7235787688c924dd92193221e288d3df6ad6863ea67742fb26a92` |
| VSIX file | `dist/clinemm-r0recon-f89983f72.vsix` (14,176,352 bytes) |
| Branch | main |
| origin/main | unchanged |
| Push | NOT pushed (ACT-committed work convention) |

## Verdict

**PASS_R0_GIT_READONLY_EXPANSION (REVISED — Factory review P1 fix applied)**
**ACT-CLINEMM-COMMAND-RISK-R0-GIT-READONLY-EXPANSION02 = CLOSED_CLEAN**
