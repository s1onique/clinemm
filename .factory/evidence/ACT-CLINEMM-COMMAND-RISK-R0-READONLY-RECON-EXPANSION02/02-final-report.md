# ACT-CLINEMM-COMMAND-RISK-R0-READONLY-RECON-EXPANSION02 — Final Report

## Summary

Closed a focused R0_LEAF_COVERAGE_GAP by adding `host_safe_ls` and
`host_safe_find` host-proven safe rules (plus matching intrinsic
`SAFE_LS_PROFILE` and `SAFE_FIND_PROFILE`, and 6 corpus rows), so
realistic recon chains like `ls /etc && find . -type f` auto-promote
ASK → ALLOW via `risk_v2_structured_promotion` when the parser binds
the AST. R5 conservation (catastrophic `rm -rf "$HOME"` patterns) is
preserved in both safe-only and all-mode.

The user's exact recon chain (`find ... 2>/dev/null | head -20`)
remains ASK — RED proves the only remaining blocker is the
redirect+pipe, which is the next ACT
(`ACT-CLINEMM-COMMAND-RISK-R0-HARMLESS-REDIRECT-PRECISION01`).

This ACT also carries the Factory-review P1 fix from the prior ACT
(removing the misleading `--format=<fmt>` allowlist from
`host_safe_git_branch`).

## Phase 9 LIVE qualification status (REVISED — Factory review honesty check)

Bundle sha256: `5aef2c3583c7235787688c924dd92193221e288d3df6ad6863ea67742fb26a92`
VSIX built: `dist/clinemm-r0recon-f89983f72.vsix` (51 files, 13.53 MB)
VSIX installed at user path:
`/Volumes/UserData/Users/chistyakov/.vscodium-clinemm/extensions/s1onique.clinemm-4.1.10/dist/extension.js`

The user's VSCodium (process `VSCODE_PID=28847`) has the OLD bundle
loaded in memory until `Developer: Reload Window` is triggered.

Per the Factory review's guidance "If not, call the current evidence
REAL_PRODUCTION_BUNDLE, not LIVE", this ACT LIVE qualification is
classified as **REAL_PRODUCTION_BUNDLE PROVEN; LIVE INSTALLED requires
user reload**.

After the user reloads VSCodium, the following commands should
auto-run (no approval card) in any chat session with
`executeSafeCommands=true` and no model escalation:

```
git branch --show-current
ls -la /tmp
find . -type f -name '*.ts' -not -path '*/node_modules/*'
```

And the following should ASK:

```
git branch --format=oneline           # --format rejected (P1 fix)
git branch -D __CLINEMM_SENTINEL_DOES_NOT_EXIST__
find . -delete
```

## Trust state

| Item | Value |
|------|-------|
| Prior ACT closure | `b6dc4bd385f9eec957fd92feae620c1addaee540` |
| New ACT production | `2052395c33ca155e8d5197e83e3e15e7b5402f7c` |
| Board row follow-up | `f89983f72cf30f26234bf0ff4b42e4521b084ee7` |
| Bundle sha256 | `5aef2c3583c7235787688c924dd92193221e288d3df6ad6863ea67742fb26a92` |
| VSIX file | `dist/clinemm-r0recon-f89983f72.vsix` (14,176,352 bytes) |
| Branch | main |
| origin/main | unchanged |
| Push | NOT pushed (ACT-committed work convention) |

## Backlog handoff

- `ACT-CLINEMM-COMMAND-RISK-R0-HARMLESS-REDIRECT-PRECISION01` — handle
  the `2>/dev/null` / `| head` patterns. The user's exact recon chain
  will still ask until that ACT lands.
- (future) sensitive-path policy for `ls`/`find` — explicitly OUT OF
  SCOPE per the engineer's plan.

## Verdict

**PASS_R0_READONLY_RECON_EXPANSION**
**ACT-CLINEMM-COMMAND-RISK-R0-READONLY-RECON-EXPANSION02 = CLOSED_CLEAN**

---

## CORRECTION01 — Shell-expansion boundary (Factory review, 2026-08-24)

The Factory review identified a real P0: the `host_safe_find` rule
classified pre-shell source text, but shell pathname expansion
happens AFTER regex matching and BEFORE find sees its argv.
A pre-expansion wildcard like `*.ts` may be expanded by the shell
to whatever names match in cwd — an attacker who can plant
filenames can change the argv that find parses. Per GNU find(1):
"Patterns containing metacharacters must be quoted so the shell
does not expand them before find sees them."

**Bounded fix**:
- Starting paths must be LITERAL POSIX paths with no glob
  metacharacters (* ? [ ] { } ~).
- Pattern-bearing predicates (-name / -iname / -path / -ipath)
  accept ONLY LITERAL patterns in V1.
- `-regex` / `-iregex` allow regex syntax that is NOT a shell
  metachar (. + ( ) | ^ $); globs `* ? [ ] { }` are rejected.
- `~` is no longer in the path class (shell tilde expansion).

**New tests added**:
- 5 negative corpus rows in `command-risk-corpus.ts`:
  `r0-find-glob-ask-name`, `r0-find-glob-ask-path`,
  `r0-find-glob-ask-start`, plus existing literals now correct
- 1 new test file `command-safe-rules.hostile-filename.test.ts`:
  - ALLOW'd literal form cannot be subverted by planted filenames
  - ASK'd glob form demonstrates shell-expansion argv-mutation class
  - ASK'd glob starting path: find sees attacker filenames in argv
- 33 new negative regression fixtures in `command-safe-rules.test.ts`
  (`REJECTED find shell-glob forms` describe block)

**Adversarial filesystem test** (`command-safe-rules.hostile-filename.test.ts`):
plants 14 hostile filenames including `-delete`, `-exec`, `-fprint`,
`-[a-z]`, `${file}`, `{a,b}`, etc. in a temp dir, then proves:
1. `find . -type f` (ALLOW) — survives; hostile filenames treated
   as path operands; nothing deleted.
2. `find . -name *.ts` (ASK) — shell expands; argv mutation class
   documented.
3. `find *` (ASK) — GNU/BSD find emit "illegal option" /
   "unknown primary or operator" because shell-expanded
   `-delete` etc. become argv.

**Test counts** (post-CORRECTION01):
- @cline/core full unit:           **2396 PASS / 14 SKIPPED**
                                  (was 2362 at ACT closure; +34 net)
- @cline/core command-policy/:     **431 PASS** (16 files; +3 adversarial)
- CLI host command-policy:          **45 PASS**
- VSCode sdk-tool-policies:         **88 PASS**
- VSCode src/sdk/__tests__/:        **623 PASS**

**Live bundle proof** (drove through `sdk/packages/core/dist/index.js`):
```
ls                              => ALLOW (host_safe_ls)
ls -la                          => ALLOW (host_safe_ls)
ls /etc                         => ALLOW (host_safe_ls)

find .                          => ALLOW (host_safe_find)
find . -type f                  => ALLOW (host_safe_find)
find . -name foo.ts             => ALLOW (host_safe_find)   [literal]

find . -name *.ts               => ASK   [CORRECTION01 fix; was ALLOW]
find . -path */node_modules/*   => ASK   [CORRECTION01 fix; was ALLOW]
find *                          => ASK   [CORRECTION01 fix; was ALLOW]

find . -delete                  => ASK   [unchanged]
find . -exec rm {} ;            => ASK   [unchanged]

git branch --show-current        => ALLOW (host_safe_git_branch)
git branch --format=oneline      => ASK   [P1 fix; was ALLOW]
```

**Bundle identity**:
- SDK dist: `0482b502ad75c6321376b66b89a48c0951a818c8e55da11a080de2c8aa383cc6`
- Extension dist: `c8810e1be5e8f2ec4eddccbcef14ee25154e61e047db2bc1da5173407caf1b06`
- VSIX: `dist/clinemm-r0recon-findglobfix.vsix` (14,176,354 bytes)
- Installed at user path:
  `/Volumes/UserData/Users/chistyakov/.vscodium-clinemm/extensions/s1onique.clinemm-4.1.10/dist/extension.js`
  (sha256 `c8810e1b...` verified).

**Verdict (revised)**:
- `host_safe_git_branch` = GO (P1 fix conservative and defensible)
- `host_safe_ls`         = GO (no fs-mutating command mode in reviewed surface)
- `host_safe_find`       = GO (CORRECTION01 properly bounds shell-expansion boundary;
                             V1 takes conservative path: literal patterns only;
                             V2 parser-quote provenance required to bless globs)

---

## CORRECTION02 — shell operator/control chars in -regex / -iregex (Factory review P1)

The Factory reviewer (second round) flagged that the original
CORRECTION01 conflated **pathname expansion** with **shell control
syntax**. The original comment claimed `(`, `)`, `|` were "regex
syntax not expanded by the shell", but `(`, `)` are reserved shell
operators (subshell grouping) and `|` is the pipe operator — bash
does NOT pass `.(foo|bar)` as one argv element.

**Bounded fix**:
- Removed raw `(`, `)` from the `-regex` / `-iregex` positive
  argument char class. (`|` was already implicitly excluded
  because the rule returns ASK on OPAQUE_SHELL_TOKENS, which
  contains `|`.)
- The V1 model is now strictly: allow only characters that are
  NEITHER pathname-expansion metacharacters (`* ? [ ] { }`)
  NOR shell control/operator syntax (`|` `&` `;` `<` `>` `(`
  `)` `` ` `` `\` `~` etc.).
- Pure-regex syntax `.`, `+`, `^`, `$`, `\` retained.
- 6 new negative fixtures: 3 each for `-regex` and `-iregex`
  covering raw `(foo|bar)`, `foo|bar`, `(foo)`.

**Quoted forms** (`find . -regex '(foo|bar).ts'`) **remain ASK** at
V1 because the parentheses trip OPAQUE_SHELL_TOKENS. The V2
parser-quote provenance integration is the path to bless these —
explicit forward pointer in code comment.

**Files changed (post-CORRECTION02)**:
- `command-safe-rules.ts`: removed `()` from `-regex`/`-iregex`
  positive arg char class
- `command-safe-rules.test.ts`: +6 negative fixtures in the
  existing REJECTED find shell-glob forms describe block;
  comment header rewritten to reflect the new (narrower) model

**Bundle identity (post-CORRECTION02)**:
- SDK dist sha256: `046b2518985adb9aa779c82c5ffef1b444d3243215247f079cd9094d90d2e752`
- Extension dist sha256: `48eaa14ba677e0c28d65c0abf954dad1af0afd6d5fde67dbd69e3860b29f1bbc`
- VSIX: `dist/clinemm-r0recon-correction02.vsix` (13.52 MB)
- Installed at user path:
  `/Volumes/UserData/Users/chistyakov/.vscodium-clinemm/extensions/s1onique.clinemm-4.1.10/dist/extension.js`
  (sha256 verified; matches VSIX bundle sha256)

**Test counts (post-CORRECTION02)**:
- `@cline/core` full unit:           **2402 PASS / 14 SKIPPED**
                                    (was 2396 at CORRECTION01;
                                     +6 net shell-operator negatives)
- `@cline/core` command-policy/:     **437 PASS** (16 files)
- CLI command-policy-host:            **45 PASS**
- VSCode sdk-tool-policies:           **88 PASS**
- VSCode src/sdk/__tests__/:          **623 PASS / 5 SKIP**

**LIVE discrimination through rebuilt bundle**:
```
ALLOW: find . -regex .ts$
ALLOW: find . -regex foo.bar
ALLOW: find . -regex .+ts$
ALLOW: find . -regex ^foo
ASK:   find . -regex (foo|bar).ts   [CORRECTION02 fix; was ALLOW]
ASK:   find . -regex foo|bar         [CORRECTION02 fix; was ALLOW]
ASK:   find . -regex (foo)           [CORRECTION02 fix; was ALLOW]
```

**Verdict (post-CORRECTION02)**:
**PASS_R0_READONLY_RECON_EXPANSION (REVISED — Factory review P0
                                       shell-expansion fix applied;
                                       P1 shell-operator narrowing
                                       applied)**
**ACT-CLINEMM-COMMAND-RISK-R0-READONLY-RECON-EXPANSION02 = CLOSED_CLEAN
 (post-CORRECTION02)**
