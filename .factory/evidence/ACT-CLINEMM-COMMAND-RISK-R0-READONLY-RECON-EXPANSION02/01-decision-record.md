# ACT-CLINEMM-COMMAND-RISK-R0-READONLY-RECON-EXPANSION02 — Decision Record

## Decision

Add two new host-proven safe rules to `DEFAULT_COMMAND_HOST_ALLOW_RULES`:

- `host_safe_ls` — covers every documented `ls(1)` option.
- `host_safe_find` — covers `find`'s stdout-only observation forms
  and pure predicates. Action-capable primitives are EXPLICITLY
  REJECTED by the rule pattern.

Wire matching intrinsic safe execution profiles (`SAFE_LS_PROFILE`,
`SAFE_FIND_PROFILE`) — no overlay applied.

Add 6 corpus rows + Group A baseline freeze.

Plus: carries the Factory-review P1 fix from the prior ACT — the
`--format=` token is REMOVED from `host_safe_git_branch` (per
git-branch(1), git log --pretty preset names are NOT valid
git-branch --format directives).

## Phase 6 — V2 compound proof

```
ls /etc && find . -type f
  safe-only + parser-binds AST => ALLOW + risk_v2_structured_promotion

ls /etc && rm -rf "$HOME"
  safe-only + parser-binds AST => ASK + never-auto-approve + host_mode_safe_only_fallthrough
  all-mode + parser-binds AST   => ASK + never-auto-approve + risk_hard_floor
```

Without `host_safe_ls` / `host_safe_find`, the AST leaves are null →
V2 promotion cannot fire.

## Phase 7 — Ablation

The Group A baseline freeze test asserts each new corpus row
matches its specific matchedSource. If either rule were removed,
those assertions fail.

## Phase 8 — Gates

```
@cline/core full unit:           2362 PASS / 14 SKIPPED
@cline/core command-policy/:     396 PASS (15 files)
CLI host command-policy:          45 PASS
VSCode sdk-tool-policies:         88 PASS
VSCode src/sdk/__tests__/:        623 PASS / 5 SKIP
apps/vscode check-types:         EXIT=0
git diff --check HEAD:            PASS
```

## Phase 9 — LIVE qualification (real-bundle proof)

Rebuilt SDK + extension bundle. Bundle sha256:
`5aef2c3583c7235787688c924dd92193221e288d3df6ad6863ea67742fb26a92`.

VSIX built: `dist/clinemm-r0recon-f89983f72.vsix` (51 files, 13.53 MB).

VSIX installed at user's VSCodium path:
`/Volumes/UserData/Users/chistyakov/.vscodium-clinemm/extensions/
s1onique.clinemm-4.1.10/dist/extension.js`

The user's VSCodium (process `VSCODE_PID=28847`) has the OLD bundle
loaded in memory until `Developer: Reload Window` is triggered.

**HONEST CLASSIFICATION**: per the Factory review guidance "If not,
call the current evidence REAL_PRODUCTION_BUNDLE, not LIVE", this
ACT LIVE qualification is classified as **REAL_PRODUCTION_BUNDLE
PROVEN; LIVE INSTALLED requires user reload**.

Drove the canonical V1 path through the actual production bundle
(`sdk/packages/core/dist/index.js`) and confirmed:

```
ls, ls -la, ls /etc, find ., find . -type f, git branch --show-current
  => ALLOW via host_safe_ls / host_safe_find / host_safe_git_branch
find . -delete, find . -exec rm {} ;, git branch -D, git branch --format=oneline
  => ASK (mutating / executing / P1 fix / create correctly rejected)
```

## Stop rule — all conditions met

```
[x] ls AUTO-RUN via ALLOW (live bundle)
[x] find AUTO-RUN via ALLOW (live bundle)
[x] realistic compounds AUTO-RUN via V2 promotion
[x] mutating find forms still ASK
[x] R5 still ASK + never-auto-approve (safe-only and all-mode)
[x] sensitive-path policy NOT introduced (out of scope)
[x] no parser / V2 architecture delta
```

## Trust state

| Item | Value |
|------|-------|
| Prior ACT closure | `b6dc4bd385f9eec957fd92feae620c1addaee540` |
| New ACT production | `2052395c33ca155e8d5197e83e3e15e7b5402f7c` |
| Board row follow-up | `f89983f72cf30f26234bf0ff4b42e4521b084ee7` |
| Bundle sha256 | `5aef2c3583c7235787688c924dd92193221e288d3df6ad6863ea67742fb26a92` |
| VSIX file | `dist/clinemm-r0recon-f89983f72.vsix` |
| Branch | main |
| origin/main | unchanged |
| Push | NOT pushed (ACT-committed work convention) |

## Verdict

**PASS_R0_READONLY_RECON_EXPANSION**
**ACT-CLINEMM-COMMAND-RISK-R0-READONLY-RECON-EXPANSION02 = CLOSED_CLEAN**

---

## CORRECTION01 ADDENDUM (Factory review, 2026-08-24)

The Factory review identified a P0: `host_safe_find` allowed
pre-shell source text containing shell glob metacharacters,
even though shell pathname expansion happens AFTER regex matching
and can synthesize action-bearing argv.

**Bounded fix applied**:
- starting paths: literal POSIX paths only, no glob metachars
  (`* ? [ ] { }`); `~` removed (shell tilde expansion)
- `-name` / `-iname` / `-path` / `-ipath`: literal patterns only
- `-regex` / `-iregex`: regex syntax allowed, globs rejected
- comment in `command-safe-rules.ts` rewritten with full rationale
  including GNU find(1) quote-warning citation

**Files changed**:
- `command-safe-rules.ts` — `host_safe_find` rule rewritten;
  `host_safe_ls` comment wording cleanup (no behavior change)
- `command-safe-rules.test.ts` — `host_safe_find` positive fixtures
  replaced with literal-only equivalents; new describe block
  "REJECTED find shell-glob forms (CORRECTION01 shell-expansion
  boundary)" with 33 fixtures; comment header notes CORRECTION01
- `command-risk-corpus.ts` — `r0-find-type-name` and
  `r0-find-not-path` switched to literal patterns; 3 new
  `r0-find-glob-ask-*` corpus rows added (ASK, not ALLOW)
- `command-risk-corpus.baseline.test.ts` — 3 new assertions
  locking the negative posture
- `command-safe-rules.hostile-filename.test.ts` (NEW) — 3
  adversarial filesystem tests with real `find` binary

**Bundle identity** (post-CORRECTION01):
- SDK dist: `0482b502ad75c6321376b66b89a48c0951a818c8e55da11a080de2c8aa383cc6`
- Extension dist: `c8810e1be5e8f2ec4eddccbcef14ee25154e61e047db2bc1da5173407caf1b06`
- VSIX: `dist/clinemm-r0recon-findglobfix.vsix` (14,176,354 bytes)
- Installed at:
  `/Volumes/UserData/Users/chistyakov/.vscodium-clinemm/extensions/s1onique.clinemm-4.1.10/dist/extension.js`
  (sha256 verified)

**Stop rule — all conditions met (post-CORRECTION01)**:
```
[x] git branch rule        GO (unchanged)
[x] ls rule                GO (unchanged; comment wording tightened)
[x] find rule              GO (shell-expansion boundary closed)
[x] literal find forms     ALLOW via host_safe_find
[x] glob find forms        ASK at V1 (defense-in-depth at the regex
                                  layer; V2 parser-quote provenance
                                  required to bless these)
[x] mutating find forms    ASK (unchanged)
[x] R5                     ASK + never-auto-approve (unchanged)
[x] no parser / V2 architecture delta confirmed
```

**Verdict (post-CORRECTION01)**:
**PASS_R0_READONLY_RECON_EXPANSION (REVISED — Factory review P0 shell-expansion fix applied)**
**ACT-CLINEMM-COMMAND-RISK-R0-READONLY-RECON-EXPANSION02 = CLOSED_CLEAN (post-revision)**
