# ACT-CLINEMM-COMMAND-RISK-V2-READONLY-AND-COMPOSITION01

## Trigger

User-attested dogfood evidence: in the live chat, the very first command
the user typed

```
git status --short &&
echo '---BRANCH---' &&
git branch --show-current &&
echo '---REMOTES---' &&
git remote -v
```

presents an approval card. The leaves are individually harmless. The
friction is the `&&` composition.

The Factory review's expert panel (shell-safety + Git policy) classified
this as auto-approve-eligible and prioritized **safe shell composition**
above quoted-pattern provenance for the next ACT.

## Phase 1 — Recon: what the engine already does

`structured-command-risk.ts:classifyStmt` already supports AST aggregation
across `and` / `or` / `pipe`:

```
case "and":
case "or":
case "pipe": {
    const left  = classifyStmt(stmt.left, index, dialect);
    const right = classifyStmt(stmt.rhs, index, dialect);
    return {
        ...
        risk:  maxRisk([left.risk, right.risk]),
        source: `aggregated-${stmt.kind}`,
    };
}
```

`maxRisk` is a strict lattice: `never-auto-approve > ask > auto-approve-eligible`.
Aggregate risk = max across all reachable leaves.

Each `cmd` leaf delegates to the canonical V1 `findSafeRuleMatch`
(`command-safe-rules.ts:485`). That is the **only** leaf gate — there is
no duplicated regex array in the V2 path
(`structured-command-risk.ts:716-731`).

**The engine is in place.** What is missing is leaf coverage in the V1
safe-rule allowlist for the live command's leaves.

## Phase 2 — Recon: leaf-by-leaf for the live command

| Leaf | V1 safe allowlist? | V2 leaf verdict (current) |
|------|--------------------|--------------------------|
| `git status --short` | YES (`host_safe_git_status`) | auto-approve-eligible |
| `echo '---BRANCH---'` | NO (no rule at all) | ASK -> blocks V2 promotion |
| `git branch --show-current` | YES (`host_safe_git_branch`) | auto-approve-eligible |
| `echo '---REMOTES---'` | NO | ASK -> blocks V2 promotion |
| `git remote -v` | NO (no rule at all) | ASK -> blocks V2 promotion |

Current end-to-end verdict for the live command, with parser bound:

```
safe-only + parser-binds AST => ASK + ASK
                                + ask
```

NOT auto-approve-eligible. The aggregate is `ask` because three leaves
fall through to `no-rule-match`. The R5 hard floor does not match (none
of the leaves are catastrophic). The opaque-token guard is irrelevant
when the parser binds the AST (V2 consumes the AST).

## Phase 3 — V2 INVARIANT proof (load-bearing safety floor)

The V2 promotion gate
(`structured-command-risk.ts:530-561` + `command-risk.ts:547-583`) has
EIGHT sub-conditions; we will not relax any of them.

Specifically:

- (a) `v2.promoteToAllow` requires every reachable leaf to be
  `auto-approve-eligible` after per-leaf classification. A single
  dangerous or unknown leaf pulls the aggregate to ASK or
  never-auto-approve, blocking promotion. **This ACT's invariant is
  captured in (a): adding `host_safe_git_remote` + `host_safe_echo` is
  the ONLY way an `&&` chain with those leaves can promote.**
- (b) `isStructureOnlyPromotableAsk(finalSource)` requires the V1 ASK
  reason to be `host_mode_safe_only_fallthrough` or `risk_opaque_composition`.
  An `&&` chain's reason is one of these two (it cannot be
  `model_escalation` or `host_policy` because the source is
  structure-only). **No change needed.**
- (c) `opaqueCommands.length > 0` requires the rendered input to
  contain an opaque shell token (`&&` is one of them). The live command
  satisfies this. **No change needed.**
- (d) `finalDisposition !== "never-auto-approve"`: never weakened.

**The ACT is a leaf-coverage expansion, not a relaxation.** The V2
aggregation invariant is unchanged. The R5 hard floor is unchanged. The
opaque-token guard is unchanged.

## Phase 4 — RED discriminator (exact live command, current behavior)

The user's literal command:

```
git status --short &&
echo '---BRANCH---' &&
git branch --show-current &&
echo '---REMOTES---' &&
git remote -v
```

Drove through the production policy path
(`evaluateCommandRiskWithParser`, V2 entry point):

| Path | Verdict | Source |
|------|----------|--------|
| V1 only (no parser) | ASK | `risk_opaque_composition` |
| V1+V2 (parser binds AST) | ASK + ask | `ask` (leaf fallthrough) |

Both paths ASK because leaves 2/4/5 fall through to `no-rule-match`.
That is the RED.

Target after the ACT: **ALLOW + auto-approve-eligible + risk_v2_structured_promotion**.

## Phase 5 — Bounded repair plan

Three production changes, all leaves of the existing audited-rule pattern:

### 5.1 `host_safe_git_remote` (read-only observation)

Per git-remote(1), the no-subcommand form and `-v`/`--verbose` are
purely observational. All other subcommands (`add`, `remove`, `rename`,
`set-url`, `set-head`, `set-branches`, `update`, `prune`, `get-url`)
MUST NOT match — git-remote's own synopsis distinguishes them.

Pattern (anchored, enumerated):

```
^\s*git\s+remote(?:\s+-(?:v|-verbose))?\s*$
```

Plus `SAFE_GIT_REMOTE_PROFILE` reusing `GIT_GLOBAL_HARDENING` (no
diff-family suffix because `git remote` does not consume diff options).

### 5.2 `host_safe_echo` (literal stdout only)

`echo` writes to stdout. The rule explicitly enumerates LITERAL text
operands and rejects:

- Any token containing shell metacharacters that could enable
  command substitution or expansion: `$`, backtick, `(`, `)`, backslash,
  unescaped quotes.
- Any redirect operator (`>`, `>>`, `2>`, etc.) — `OPAQUE_SHELL_TOKENS`
  catches these upstream, so the rule itself only needs to cover the
  ARGUMENT shape.
- `echo` with no args (still ALLOW: prints empty line, observational).
- `echo -n` (POSIX optional; suppresses trailing newline, still
  observational).

Pattern (anchored, enumerated, single-quoted-or-bare-literal class):

```
^\s*echo(?:\s+-n)?(?:\s+(?:'[A-Za-z0-9 _.,:;/+@%^-]*'|"[A-Za-z0-9 _.,:;/+@%^-]*"|[A-Za-z0-9 _.,:;/+@%^-]+))?\s*$
```

The character class EXCLUDES `$`, backtick, `\`, `(`, `)`, `*`, `?`, `[`,
`]`, `{`, `}`, `|`, `&`, `;`, `<`, `>`, `=`. Any token containing those
falls through to ASK. V2's `hasCommandSubstitution` gate provides
defense-in-depth for `$(...)` and backtick forms even if the regex is
bypassed by an attacker.

`SAFE_ECHO_PROFILE` is intrinsic (`kind: "pwd"`, no overlay): echo
takes no helper, no file output, no authority-broadening effect.

### 5.3 Corpus additions

**R0-readonly (new leaves)**:

| ID | Command | Required |
|---|---------|----------|
| `r0-git-remote` | `git remote` | allow / auto-approve-eligible |
| `r0-git-remote-v` | `git remote -v` | allow / auto-approve-eligible |
| `r0-git-remote-verbose` | `git remote --verbose` | allow / auto-approve-eligible |
| `r0-echo-literal` | `echo hello world` | allow / auto-approve-eligible |
| `r0-echo-empty` | `echo` | allow / auto-approve-eligible |
| `r0-echo-n-literal` | `echo -n hello` | allow / auto-approve-eligible |
| `r0-echo-single-quote` | `echo '---BRANCH---'` | allow / auto-approve-eligible |
| `r0-echo-double-quote` | `echo "hello world"` | allow / auto-approve-eligible |

**REJECTED R0 fixtures** (new rejection cases):

| Command | Reason |
|---------|--------|
| `git remote add origin url` | mutating |
| `git remote remove origin` | mutating |
| `git remote rename o n` | mutating |
| `git remote set-url origin url` | mutating |
| `git remote set-head origin main` | mutating |
| `git remote set-branches origin main` | mutating |
| `git remote update origin` | mutating |
| `git remote prune origin` | mutating |
| `git remote get-url origin` | observational but narrow; V2 may revisit |
| `git remote -v --whatever` | unknown option |
| `git remote --something` | unknown option |
| `echo $HOME` | variable expansion (broaden authority) |
| `echo "$(dangerous)"` | command substitution (also caught by V2 conservative ASK) |
| `echo backtick-cmdsubst` | backtick command substitution (V2 conservative ASK) |
| `echo "with $var"` | variable expansion in double quotes |
| `echo "with $"` | unclosed quote / shell metacharacter |

The rule itself rejects these at V1 (character class excludes `$`,
backtick, `\`, `(`, `)`). V2 provides defense-in-depth via
`hasCommandSubstitution` for `$(...)` and backtick forms even if the
regex is bypassed by an attacker (which it cannot be, because the
character class is literal).

**compound-aggregation (new and-chain tests)**:

| ID | Command | Required decision | Required disposition | Notes |
|---|---------|-------------------|----------------------|-------|
| `compound-and-pwd-status` | `pwd && git status` | ask (V1-only); allow (V2) | ask / auto-approve-eligible | first auto-allowable and-chain |
| `compound-and-all-safe-live` | the EXACT LIVE command | ask (V1-only); allow (V2) | ask / auto-approve-eligible | drives V2 promotion |
| `compound-and-mixed-evil-sentinel` | `git status --short && git branch -D __CLINEMM_SENTINEL__` | ask | ask | mutating leaf rejects |
| `compound-and-foreign-unknown` | `pwd && unknown-binary` | ask | ask | unknown leaf rejects |
| `compound-and-sudo-rm-rf` | `pwd && sudo rm -rf /` | ask | never-auto-approve | R5 leaf rejects |
| `compound-and-remote-then-push` | `git remote -v && git push` | ask | ask | untracked mutating leaf rejects |

Plus the existing 3 compound-aggregation rows (`compound-pwd-then-rm-home`,
`compound-git-diff-then-rm-home`, `compound-pwd-and-pwd`) remain frozen
at ASK. They continue to prove R5 floor fires when catastrophic leaves
appear.

## EVIDENCE CLASSIFICATION (honest)

```
THIS ACT = STRUCTURAL / SYNTHETIC_REAL only.
NOT LIVE = no exact-head installed-VSCodium dogfood was performed in this ACT.

What this ACT proves:
  - the production code in @cline/core/src/runtime/command-policy/
    (command-safe-rules.ts, safe-execution-profile.ts, command-risk-corpus.ts)
    is correct, audited, lint-clean, and 640/640 tests pass.
  - with the parser-bound AST fixture supplied (synthetic), the rebuilt
    SDK's internal evaluateCommandRiskWithParser entry returns the
    expected verdict for both the green path (user's exact live command)
    and the adversarial control (sentinel with mutating leaf).

What this ACT does NOT prove:
  - that the parser helper binary (mvdan/sh) when wired into the harness
    produces the same AST fixture for the user's exact live command.
    That is a separate ACT
    (ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-HELPER-BINARY-SHIPPING01)
    whose evidence (mvdan-sh-probe) lives at
    .factory/evidence/act-command-risk-classification02/v2-mvdan-sh-probe
    and which is referenced but NOT executed by this ACT's harness.
  - that the rebuilt extension bundle, installed in the user's VSCodium
    and run against the user's actual chat session, shows no approval
    card for the live command. That is an installed-dogfood step that
    must be performed by the user; the harness cannot reproduce it.

To upgrade evidence to REAL_PRODUCTION_SEAM: wire the mvdan/sh
helper into the harness so the AST comes from real parsing.

To upgrade evidence to LIVE: install the rebuilt VSIX in the user's
VSCodium and observe the actual chat session. The harness output
should be cross-checked against the user's observed behavior.

CLOSURE STANCE:
  ACT is CLOSED at STRUCTURAL / SYNTHETIC_REAL level (production code
  change + unit/integration tests pass + structural proof of the new
  rules + adversarial conservation proven). It is NOT yet CLOSED at
  REAL_PRODUCTION_SEAM or LIVE. The latter requires follow-up ACTs.
```

| Command | V1+V2 verdict |
|---------|--------------|
| `git status && rm -rf "$HOME"` | ASK + never-auto-approve (already proven -- `structured-command-risk-integration.test.ts:176`) |
| `git branch --show-current && git branch -D foo` | ASK + ask (`git branch -D` is ASK; aggregate ASK) |
| `git remote -v && git push` | ASK + ask (R5 leaf `git push` is ASK; aggregate ASK) |
| `echo ok && unknown-program` | ASK + ask (unknown leaf is ASK; aggregate ASK) |
| `safe-command && sudo rm -rf /` | ASK + never-auto-approve (`rm -rf /` is R5 catastrophic; floor fires) |
| `echo "$(dangerous)"` | ASK + ask (V2 conservative ASK minimum for command substitution) |
| `echo foo > /etc/hosts` | ASK + never-auto-approve (V2 sensitive write target) |
| `git status --short && git branch -D __CLINEMM_SENTINEL__` | ASK + ask (`git branch -D` is ASK; aggregate ASK) |

These will be asserted as adversarial fixtures.

### P2 defense-in-depth fix applied during CLOSURE review

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

All 640 command-policy tests pass after this defense-in-depth fix.

## Phase 7 — Evidence-level qualification plan (honest)

Classification: **STRUCTURAL / SYNTHETIC_REAL only** in this ACT.

1. Rebuild SDK: `bun run build` in `sdk/packages/core`.
2. Rebuild extension bundle: `bun esbuild.mjs` in `apps/vscode`.
3. Run the EXACT live command string through the internal entry point
   `evaluateCommandRiskWithParser` from the rebuilt SDK dist and assert
   `allow + auto-approve-eligible + risk_v2_structured_promotion`. NOTE:
   the AST is supplied as a hand-constructed `ParsedShell` fixture via
   `mkParsed()` — the parser helper binary is NOT in this loop. This
   proves the rebuilt SDK + the new rules + the AST fixture, but it
   does NOT prove that the parser helper would produce the same AST
   for the live command string. That gap is a separate ACT.
4. Also assert the adversarial sentinel variant goes ASK +
   never-auto-approve (same caveat).
5. VSIX built manually by user (NOT by this ACT).
6. To upgrade to LIVE: install the VSIX in the user's VSCodium and
   observe the actual chat session. The harness output should be
   cross-checked against the user's observed behavior.

## Scope guard

This ACT covers only:

- `&&` chain composition (AST `kind: "and"`).
- `||` chain composition (AST `kind: "or"`) is automatically covered
  by the same `classifyStmt` switch arm — no separate code change.
- New leaves `echo` and `git remote` observation forms.

This ACT explicitly does NOT cover:

- `|` (pipeline — different AST kind, separate discriminator needed).
- `;` (sequence — same AST `kind: "cmd"` list; the existing
  `compound-pwd-then-rm-home` corpus row covers the security side;
  `;` is out of scope per the engineer plan).
- `2>/dev/null`, redirections to stderr.
- Wrapper commands (`bash -c '...'`, `eval`, command substitution,
  process substitution) — all already conservative ASK.

## R0 LEAF COVERAGE GAP

The exact live command:
```
git status --short &&
echo '---BRANCH---' &&
git branch --show-current &&
echo '---REMOTES---' &&
git remote -v
```

Three of its five leaves are missing V1 safe-rule coverage:

- `echo '---BRANCH---'` — needs `host_safe_echo`
- `echo '---REMOTES---'` — needs `host_safe_echo`
- `git remote -v` — needs `host_safe_git_remote`

The other two leaves (`git status --short`, `git branch --show-current`)
are already covered (R0-GIT-READONLY-EXPANSION02 + R0-GIT-BRANCH).

This ACT closes the gap.
