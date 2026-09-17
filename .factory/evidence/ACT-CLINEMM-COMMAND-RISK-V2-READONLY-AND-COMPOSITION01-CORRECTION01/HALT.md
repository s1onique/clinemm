# ACT-CLINEMM-COMMAND-RISK-V2-READONLY-AND-COMPOSITION01-CORRECTION01 -- HALT NOTICE

**STATUS: HALTED** -- HALT_STRUCTURED_ARGV_PROVENANCE_UNSOUND + RED_WITNESS_SEMANTICS_CORRECTED

**Halt raised by**: Factory review of the CORRECTION02 attack recon.

**Halt timestamp**: 2026-08-24 (commit e31ca30c3 originally; commit 457b84c0d for the corrected witness)

**Verdict reversed**: `PASS_V2_READONLY_COMPOSITION_LIVE — REAL_PRODUCTION_SEAM` -> `HALTED`

## Two Halts

### First Halt (e31ca30c3)

The CORRECTION01 attack witness had a shell-semantics error: several
"attack" fixtures were not attacks at all because single quotes REMOVE
shell significance. The first RED witness conflated characters that
resemble shell syntax with syntax that is actually active in the
original shell source.

### Second Halt (this file's corrected witness, commit 457b84c0d)

The CORRECTION01 repair still has REAL bypasses for **unquoted
expansion in compound** (the 2 MUST ASK failures) and false-ASKs for
**quoted literal data** (the 10 MUST ALLOW failures). The corrected
witness documents exactly which.

## The attack (corrected matrix)

Active expansion (MUST ASK, currently violated):

```
echo <(touch /tmp/CLINEMM_SENTINEL)    -> ask     (OK by accident)
echo >(cat)                            -> ask     (OK by accident)
echo {a,b,c}                           -> ask     (OK by accident)
echo {1..5}                            -> ask     (OK by accident)
echo *                                 -> ask     (OK by accident)
echo *.ts                              -> ask     (OK by accident)
echo /etc/passwd*                      -> ask     (OK by accident)
echo $HOME                             -> ask     (OK by accident)
echo ${HOME}                           -> ask     (OK by accident)
echo ${x:-foo}                         -> ask     (OK by accident)
echo $(touch /tmp/CLINEMM_SENTINEL)    -> ask     (OK by accident)
echo $((1+2))                          -> ask     (OK by accident)
echo '---BRANCH---' && echo *          -> allow   (P0 BYPASS)
echo '---BRANCH---' && echo <(touch /tmp/CLINEMM_SENTINEL)  -> ask (OK by accident; trailing <() has no opaque)
echo '---BRANCH---' && echo {a,b}      -> allow   (P0 BYPASS)
echo '---BRANCH---' && echo $HOME      -> ask     (OK by accident; trailing $HOME has no opaque)
git status --short && git branch -D __CLINEMM_SENTINEL__ -> ask (sentinel)
```

Quoted literal data (MUST ALLOW, currently violated):

```
echo '<(touch /tmp/nope)'              -> allow   (correct)
echo '<(/bin/rm -rf $HOME)'            -> ask     (P1 false-ASK; V1 regex chokes on $)
echo '{a,b}'                           -> ask     (P1 false-ASK)
echo '{1..5}'                          -> ask     (P1 false-ASK)
echo '$(touch /tmp/nope)'              -> ask     (P1 false-ASK)
echo '$((1+2))'                        -> ask     (P1 false-ASK)
echo '${HOME}'                         -> ask     (P1 false-ASK)
echo '*'                               -> ask     (P1 false-ASK)
echo '$HOME'                           -> ask     (P1 false-ASK)
echo 'foo; rm -rf /'                   -> allow   (correct; the discriminator)
echo 'foo*bar'                         -> ask     (P1 false-ASK)
echo 'foo|bar'                         -> allow   (correct)
echo '---BRANCH---'                    -> ask     (P1 false-ASK; user's LIVE leaf as single command)
echo '---REMOTES---'                   -> ask     (P1 false-ASK)
echo "---BRANCH---"                    -> ask     (P1 false-ASK)
echo 'foo'bar'baz'                     -> ask     (P1 false-ASK; concat of literals)
git status --short && echo '---BRANCH---' && git branch --show-current && echo '---REMOTES---' && git remote -v -> allow (correct; user's exact LIVE chain)
echo '---BRANCH---' && echo '<(touch /tmp/nope)' && echo '{a,b}' && echo '*' -> allow (correct)
```

**Counts**: 23 of 35 correct on CORRECTION01. 12 RED (the binding contract):
- 2 MUST ASK bypasses (real P0)
- 10 MUST ALLOW false-ASKs (architectural limitation; V1 source-text echo
  regex cannot recover these without parser-proven static-literal provenance)

## What the discriminator pair tells us

```
echo 'foo; rm -rf /'    # one literal argument (safe)
echo foo; rm -rf /      # shell composition (R5)
```

The projection needs to be able to tell these apart. The string-blacklist
on flattened argv cannot. Only positive parser-proven static-literal
provenance can.

## Discovered by

`structured-command-risk.attack-witness.test.ts` (35 tests, drives the
vendored mvdan/sh helper through `evaluateCommandRiskWithParser`).

## Disposition

- DO NOT dogfood `apps/vscode/dist/clinemm-4.1.10.vsix` (built at the
  unsafe source HEAD).
- DO NOT start `ACT-CLINEMM-COMMAND-RISK-V2-QUOTED-PATTERN-PROVENANCE01`.
- DO start `ACT-CLINEMM-COMMAND-RISK-V2-READONLY-AND-COMPOSITION01-CORRECTION02`
  (board row opened at commit e31ca30c3, corrected witness at commit
  457b84c0d). The new ACT introduces positive parser-proven static-literal
  provenance to replace the unsound character-blacklist.
