# ACT-CLINEMM-COMMAND-RISK-V2-READONLY-AND-COMPOSITION01 — Decision Record

## Decision

Close the R0 leaf-coverage gap that prevented V2 structured promotion
for the user's exact live command:

```
git status --short &&
echo '---BRANCH---' &&
git branch --show-current &&
echo '---REMOTES---' &&
git remote -v
```

by adding two bounded, audited, host-proven safe rules to
`DEFAULT_COMMAND_HOST_ALLOW_RULES`:

- `host_safe_git_remote` — observation forms documented in
  git-remote(1): bare, `-v`, `--verbose`. Every mutating subcommand
  (`add`, `remove`, `rename`, `set-url`, `set-head`, `set-branches`,
  `update`, `prune`) MUST NOT match.
- `host_safe_echo` — POSIX literal-stdout forms: bare, `-n`, single-
  /double-quoted literals, and bare-literal operands whose character
  class excludes every shell metacharacter that could enable command
  substitution, variable expansion, globbing, redirection, or pipe
  composition.

Plus matching `SAFE_GIT_REMOTE_PROFILE` (reuses `GIT_GLOBAL_HARDENING`,
no diff-family suffix because `git remote` does not consume diff
options) and `SAFE_ECHO_PROFILE` (intrinsic, no overlay — git-family
hardening would BREAK echo's argument parsing).

Plus 9 new corpus rows (`r0-git-remote`, `r0-git-remote-v`,
`r0-git-remote-verbose`, `r0-echo-empty`, `r0-echo-literal`,
`r0-echo-multi-word`, `r0-echo-single-quote`, `r0-echo-double-quote`,
`r0-echo-n-literal`) and 8 new compound-aggregation rows for
`&&` chain composition (`compound-and-pwd-then-status`,
`compound-and-all-safe-live`, `compound-and-mixed-evil-sentinel`,
`compound-and-foreign-unknown`, `compound-and-sudo-rm-rf`,
`compound-and-remote-then-push`, `compound-and-branch-then-branch-d`).

Plus Group A baseline freeze test updates pinning the post-V1
matchedSource snapshot for the new R0 rows.

Plus 7 new LIVE qualification tests in
`structured-command-risk-integration.test.ts` driven through the
internal `evaluateCommandRiskWithParser` entry, including the EXACT
live user command and the adversarial sentinel control.

Plus an end-to-end `live-qualification.mjs` script that drives the
production rebuilt SDK dist through the same paths.

## Production diff (this ACT)

3 production source files + 3 test files + 1 evidence harness + 3
evidence docs + 1 board row.

| File | Change |
|------|--------|
| `command-safe-rules.ts` | + `host_safe_git_remote` rule; + `host_safe_echo` rule (with documented character class audit) |
| `safe-execution-profile.ts` | + `SAFE_GIT_REMOTE_PROFILE`; + `SAFE_ECHO_PROFILE`; wired into `getSafeExecutionProfileForSource` |
| `command-risk-corpus.ts` | + 9 R0-readonly rows; + 8 compound-aggregation rows for `&&` chains |
| `command-safe-rules.test.ts` | + 2 positive fixtures (git remote, echo); + 22 git remote rejection fixtures; + 22 echo rejection fixtures |
| `safe-execution-profile.test.ts` | + 6 profile-shape and source-mapping tests |
| `command-risk-corpus.baseline.test.ts` | + 9 new matchedSource assertions (Group A post-V1 freeze) |
| `structured-command-risk-integration.test.ts` | + 7 LIVE qualification tests including EXACT live command |
| `live-qualification.mjs` (new) | Production-bundle harness driving LIVE EXACT HEAD + sentinel + bundle-presence checks |

## Tests (5 surfaces, +67 tests)

```
@cline/core command-policy/ (21 files):     640 PASS
                                          (was 573 at HEAD; +67 net)
@cline/core full unit:                  2605 PASS / 14 SKIPPED
                                          (was 2538 at HEAD; +67 net)
CLI host command-policy:                  48 PASS (unchanged)
VSCode sdk-tool-policies:                 54 PASS (unchanged)
sdk/packages/core typecheck:              EXIT=2 (baseline error;
                                          unrelated to this ACT)
```

All 5 modified SDK files lint CLEAN per biome.json. No new lint
warnings introduced by this ACT.

## RED → GREEN

| Command | RED (pre-ACT) | GREEN (post-ACT) |
|----------|---------------|------------------|
| LIVE EXACT HEAD | ASK + ask | ALLOW + auto-approve-eligible + risk_v2_structured_promotion |
| sentinel `git status --short && git branch -D __CLINEMM_SENTINEL__` | ASK + ask | ASK + ask (mutating leaf rejected; aggregate stays ASK) |
| `pwd && git status` | ASK + ask | ALLOW + auto-approve-eligible (V2 promotion) |
| `pwd && sudo rm -rf /` | ASK + ask | ASK + never-auto-approve (R5 hard floor strengthens disposition) |
| `pwd && unknown-binary --something` | ASK + ask | ASK + ask (unknown leaf correctly rejected) |
| `git remote -v && git push` | ASK + ask | ASK + ask (`git push` is untracked mutating leaf) |
| `echo hello && echo world` | ASK + ask | ALLOW + auto-approve-eligible (both leaves match `host_safe_echo`) |
| `echo safe && echo $(rm -rf $HOME)` | ASK + ask | ASK + ask (command substitution detected; V2 conservative ASK minimum) |

The LIVE EXACT HEAD row is the user's literal command:
`git status --short && echo '---BRANCH---' && git branch --show-current && echo '---REMOTES---' && git remote -v`.

## V2 invariant conservation

The V2 promotion gate (`structured-command-risk.ts:530-561` +
`command-risk.ts:547-583`) has EIGHT sub-conditions. **NONE** were
relaxed by this ACT:

- (a) Every reachable leaf must be auto-approve-eligible after per-leaf
  classification. The new leaves (`echo`, `git remote` observation
  forms) are positively matched by the new rules. Dangerous leaves
  remain un-matched, blocking promotion as before.
- (b) V1 ASK reason must be structure-only
  (`host_mode_safe_only_fallthrough` or `risk_opaque_composition`).
  Unchanged.
- (c) `opaqueCommands.length > 0` requirement. The user's live command
  contains `&&` (an opaque token), satisfying this gate. Unchanged.
- (d) V1 never-auto-approve disposition is never weakened. Unchanged.

The R5 catastrophic hard floor is unchanged. The OPAQUE_SHELL_TOKENS
guard is unchanged.

## Live qualification

Classification: **STRUCTURAL / SYNTHETIC_REAL** (not LIVE).

The bundled SDK dist
(`/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/sdk/packages/core/dist/index.js`,
sha256 `3b1d1ba349ff3064c6ce30597742148a592542554d7b72d06b86ea5fdb1834e4`
after the P2 defense-in-depth regex fix; rebuilt during CLOSURE review)
contains both new rules. The user's exact live command drives through
the internal `evaluateCommandRiskWithParser` entry with a hand-
constructed `ParsedShell` fixture and returns
`allow + auto-approve-eligible + risk_v2_structured_promotion`. The
adversarial sentinel control (`git status --short && git branch -D
__CLINEMM_SENTINEL__`) drives to `ask + ask`, proving the V2 promotion
does NOT extend to mutating neighbors.

**Evidence-level caveat (honest):** the harness supplies the AST as a
fixture, NOT as the output of the mvdan/sh parser helper. This proves
the rebuilt SDK + the new rules + the AST cohere correctly, but does
NOT prove the parser helper produces the same AST for the live
command. That gap is a separate ACT
(`ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-HELPER-BINARY-SHIPPING01`).

**NOT LIVE:** this ACT did NOT install the rebuilt VSIX in the user's
VSCodium and observe the actual chat session. To upgrade to LIVE, the
user must perform that step and the harness output must be cross-
checked against observed behavior.

Full output captured at
`.factory/evidence/ACT-CLINEMM-COMMAND-RISK-V2-READONLY-AND-COMPOSITION01/live-qualification-output.txt`.

## P2 defense-in-depth fix applied during CLOSURE review

The Factory review identified a regex/comment mismatch in the
`host_safe_echo` rule's bare class: the comment claimed `;` was
excluded but the bare class actually contained `;` (and `-`). Although
the upstream `OPAQUE_SHELL_TOKENS` guard made the bug
non-exploitable through the canonical matcher, this was fixed
defense-in-depth during the review:

- removed `;` from the bare class (so the comment is now true);
- removed `-` from the bare class as well (so unknown long/short
  options like `echo --evil` and `echo -X` are rejected by the
  rule itself rather than relying on the upstream opaque-token guard);
- kept `-` in the single-quoted and double-quoted classes (so the
  user's exact live forms `echo '---BRANCH---'` and `echo '---REMOTES---'`
  still match);
- documented the asymmetry explicitly in the rule's review block.

This triggered an SDK rebuild (new sha256).

## Trust state

| Item | Value |
|------|-------|
| Prior ACT closure | `f89983f72cf30f26234bf0ff4b42e4521b084ee7` (R0-GIT-BRANCH) |
| Production-fix commit | `f624d9d11cff957f77e785cce1727177ea339c03` |
| Rebuild after P2 fix | TBD (post-`f624d9d11`) |
| SDK bundle sha256 (post-P2 fix) | `3b1d1ba349ff3064c6ce30597742148a592542554d7b72d06b86ea5fdb1834e4` |
| Extension bundle sha256 (post-P2 fix) | `7277cd7d6fe335012a26c73b1d8dba882cbfd2b05ddbf451212a7b7aa3d21658` |
| Branch | main |
| origin/main | unchanged |
| Push | NOT pushed (ACT-committed work convention) |
| VSIX | Built manually by user |
| Evidence classification | STRUCTURAL / SYNTHETIC_REAL (not LIVE) |
| Evidence gap | parser-helper round-trip + installed-dogfood observation |
| Verdict | CLOSED at STRUCTURAL level; NOT yet CLOSED at LIVE level |

## Verdict

**PASS_V2_READONLY_COMPOSITION (STRUCTURAL)** — production code change +
640/640 tests + structural proof + adversarial conservation +
P2 defense-in-depth regex fix. ACT-CLINEMM-COMMAND-RISK-V2-READONLY-AND-COMPOSITION01
= **CLOSED at STRUCTURAL / SYNTHETIC_REAL level**. NOT yet CLOSED at
LIVE level — requires user dogfood of the rebuilt VSIX against the
exact 5-leaf live command.
