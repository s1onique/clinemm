# ACT-CLINEMM-COMMAND-RISK-V2-READONLY-AND-COMPOSITION01 — Final Report

## Summary

Closed the R0_LEAF_COVERAGE_GAP that prevented V2 structured promotion
for the user's exact live command:

```
git status --short &&
echo '---BRANCH---' &&
git branch --show-current &&
echo '---REMOTES---' &&
git remote -v
```

by adding two bounded, audited, host-proven safe rules
(`host_safe_git_remote` and `host_safe_echo`) and matching safe
execution profiles (`SAFE_GIT_REMOTE_PROFILE` and `SAFE_ECHO_PROFILE`).
The V2 aggregation engine was already in place
(`structured-command-risk.ts:classifyStmt` `and`/`or`/`pipe` arm);
the only missing pieces were the per-leaf V1 safe-rule matches.

After the ACT:
- The user's literal live command drives to `allow +
  auto-approve-eligible + risk_v2_structured_promotion` through the
  rebuilt SDK bundle.
- The adversarial sentinel control (`git status --short && git branch
  -D __CLINEMM_SENTINEL__`) correctly stays at `ask + ask`, proving
  V2 promotion does NOT extend to mutating neighbors.
- All R5 catastrophic, R3 state-mutation, R4 destructive, and unknown-
  leaf compound shapes remain correctly ASK / never-auto-approve.

## RED → GREEN

| Command | RED (pre-ACT) | GREEN (post-ACT) |
|----------|---------------|------------------|
| LIVE EXACT HEAD (user's command) | ASK + ask (V1 leaves 2/4/5 fall through) | ALLOW + auto-approve-eligible + risk_v2_structured_promotion |
| `git status --short && git branch -D __CLINEMM_SENTINEL__` (sentinel) | ASK + ask | ASK + ask (mutating leaf rejected) |
| `pwd && git status` | ASK + ask | ALLOW + auto-approve-eligible |
| `pwd && sudo rm -rf /` | ASK + ask | ASK + never-auto-approve (R5 floor) |
| `pwd && unknown-binary --something` | ASK + ask | ASK + ask |
| `git remote -v && git push` | ASK + ask | ASK + ask |
| `echo hello && echo world` | ASK + ask | ALLOW + auto-approve-eligible |
| `echo safe && echo $(rm -rf $HOME)` | ASK + ask | ASK + ask (cmdsubst detected) |

## Trust state

| Item | Value |
|------|-------|
| Prior ACT closure | `f89983f72cf30f26234bf0ff4b42e4521b084ee7` (R0-GIT-BRANCH) |
| Live SDK bundle sha256 | `880b66921f40a16de0a48c2770eda401413fd234d1a0fd89a76fb6fb03b820d0` |
| Live extension bundle sha256 | `7787aee7566402d18faaf03bf3085d3546e4237f6c76991dc1f16699b42059e7` |
| Branch | main |
| origin/main | unchanged |
| Push | NOT pushed (ACT-committed work convention) |
| VSIX | Built manually by user |

## Phase 9 evidence-level qualification

Classification: **STRUCTURAL / SYNTHETIC_REAL** (NOT LIVE).

- SDK bundle sha256 (post-P2 defense-in-depth fix):
  `3b1d1ba349ff3064c6ce30597742148a592542554d7b72d06b86ea5fdb1834e4`
  (rebuilt after the `host_safe_echo` regex fix during CLOSURE review).
- Extension bundle sha256 (post-P2 fix):
  `7277cd7d6fe335012a26c73b1d8dba882cbfd2b05ddbf451212a7b7aa3d21658`.
- The user's exact live command drove through the internal
  `evaluateCommandRiskWithParser` entry from the rebuilt SDK dist
  (`dist/runtime/command-policy/command-risk-internal.js`) using a
  hand-constructed `ParsedShell` fixture (NOT the output of the
  parser helper binary). It returned:
  - decision: `allow`
  - disposition: `auto-approve-eligible`
  - source: `risk_v2_structured_promotion`
  - reasons: `["structured-max-risk:auto-approve-eligible:all-branches-safe"]`
- The adversarial sentinel control drove to:
  - decision: `ask`
  - disposition: `ask`
  - source: `host_mode_safe_only_fallthrough`
- Bundle presence verified: the rebuilt SDK dist contains both
  `host_safe_git_remote` and `host_safe_echo` rule source strings.

### Evidence gap (honest)

This ACT did NOT:
- run the parser helper (mvdan/sh) on the live command string to
  produce the AST (the AST was hand-constructed in the harness);
- install the rebuilt VSIX in the user's VSCodium and observe the
  actual chat session behavior.

Both steps are required to upgrade this evidence to REAL_PRODUCTION_SEAM
or LIVE. The first is gated on the parser-helper shipping ACT
(`ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-HELPER-BINARY-SHIPPING01`).
The second is a manual user dogfood step.

### Expected behavior after user dogfood

After the user installs the rebuilt extension bundle and reloads
VSCodium, the following commands SHOULD auto-run (no approval card)
in any chat session with `executeSafeCommands=true` and no model
escalation (subject to the parser-helper producing the same AST
that this ACT assumes):

```
git status --short &&
echo '---BRANCH---' &&
git branch --show-current &&
echo '---REMOTES---' &&
git remote -v

git status --short && git branch --show-current
pwd && git status
echo hello && echo world
git remote -v
echo '---BRANCH---'
```

And the following SHOULD remain ASK (correctly rejected):

```
git status --short && git branch -D __CLINEMM_SENTINEL__
git remote -v && git push
pwd && unknown-binary --something
pwd && sudo rm -rf /
echo $(rm -rf $HOME)
echo $HOME
echo "with $var"
echo *  echo *.txt  echo [abc]  echo {a,b}
git remote add origin url
git remote remove origin
git remote set-url origin url
git remote prune origin
echo --evil  echo -X
```

If the user observes anything inconsistent with the above table, the
ACT must reopen.

## Verdict

**PASS_V2_READONLY_COMPOSITION (STRUCTURAL)** — ACT-CLINEMM-COMMAND-RISK-V2-READONLY-AND-COMPOSITION01
= **CLOSED at STRUCTURAL / SYNTHETIC_REAL level**. NOT yet CLOSED at
LIVE level — requires user dogfood of the rebuilt VSIX against the
exact 5-leaf live command.
