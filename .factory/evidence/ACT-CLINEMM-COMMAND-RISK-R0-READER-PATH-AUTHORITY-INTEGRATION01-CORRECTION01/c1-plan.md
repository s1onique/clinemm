# ACT-CLINEMM-COMMAND-RISK-R0-READER-PATH-AUTHORITY-INTEGRATION01-CORRECTION01 — C1 plan

## Reviewer post-merge P0

```text
HALT_READER_DYNAMIC_OPERAND_AUTHORITY_ALIAS
```

The new V1 reader safe-rule regexes
(`host_safe_cat`, `host_safe_head_path`, `host_safe_tail_path`)
positively accepted unquoted shell-active characters in path
operands: `$`, `~`, `*`, `?`. Bash performs parameter expansion /
tilde expansion / filename generation BEFORE `cat` / `head` /
`tail` sees argv. The host evidence is built from the LITERAL
token; the kernel executes against the SHELL-EVALUATED operand.
That breaks the load-bearing invariant:

```text
evidence operand identity  ==  actual filesystem operand
```

## Reproduction

The reviewer demanded a real workspace fixture whose raw-token
literal would make the authority check succeed. We built
exactly that fixture: a real file at the literal raw-token path.

```bash
mkdir -p "$WORKSPACE/$HOME"
echo secret > "$WORKSPACE/$HOME/secret"
```

Then:

```bash
cat $HOME/secret
```

The literal-token evidence builder resolved `$HOME/secret` to
`$WORKSPACE/$HOME/secret` (a real file we placed there),
`contained: true`, and the policy ALLOWED. The bash shell
actually executes `cat /Users/<who>/secret` -- outside the
workspace.

### Evidence

| file                                                   | result                                            |
|--------------------------------------------------------|---------------------------------------------------|
| `red_repro_dynamic_operand_authority_alias.ts`         | standalone RED → GREEN harness                   |
| `red_repro_post_correction01_output.txt`               | 7/7 ASK, source=`host_mode_safe_only_fallthrough` |
| `real_production_seam_post_correction01_output.txt`   | 14/14 PASS (no regression on parent cases)        |

## Bounded fix

Narrowed the V1 reader path-operand character class to characters
that are INERT in an unquoted shell word under the supported
grammar. Removed `$`, `~`, `*`, `?` from the new positive reader
patterns. Quoted/dynamic/path-rich operands stay conservative
until V2 can positively establish `argProvenance === "static"`
and bind the EXACT projected operand to host authority.

```diff
- [-A-Za-z0-9_/.,+:%^@~*$?]
+ [-A-Za-z0-9_/.,+:%^@]
```

Applied to all three new reader rules:

| source                   | pattern                                    |
|--------------------------|--------------------------------------------|
| `host_safe_cat`          | narrowed                                   |
| `host_safe_head_path`    | narrowed                                   |
| `host_safe_tail_path`    | narrowed                                   |

The narrowed class matches the existing R0 rules
(`host_safe_ls`, `host_safe_find`) — those already excluded
`$ ~ * ?` for the same reason.

## Files modified (production)

1. `sdk/packages/core/src/runtime/command-policy/command-safe-rules.ts`
   - 3 regex patterns narrowed
   - 3 inline comments added documenting CORRECTION01 invariant

## Tests added (+9 unit tests in Section F)

`sdk/packages/core/src/runtime/command-policy/structured-command-risk.reader-path-authority.test.ts`

Section F: `HALT_READER_DYNAMIC_OPERAND_AUTHORITY_ALIAS`
   - `cat $HOME/secret` → ASK
   - `head -30 $HOME/secret` → ASK
   - `tail -20 $HOME/secret` → ASK
   - `cat ~/secret` → ASK
   - `head -30 ~/secret` → ASK
   - `tail -20 ~/secret` → ASK
   - `cat *` → ASK
   - `cat ?.txt` → ASK
   - CONSERVATION: `cat <inside-file> + matching evidence` → ALLOW (still)

## Fixture added

The test setup now creates literal files under the workspace
fixture:

```text
${PROJECT_DIR}/$HOME/secret   (real file at the literal raw-token path)
${PROJECT_DIR}/~/secret       (real file at the literal raw-token path)
```

This makes the host-evidence builder resolve the LITERAL token
inside the workspace, while bash evaluates the SHELL-EXPANSION
candidate OUTSIDE the workspace. The discriminator the reviewer
demanded.

## Out of scope (NOT YET LIVE)

- `cat -n` / `-b` / `-s` / `-E` / `-T` / `-v` / `-A` / `-e` / `-t`
  (option surface deferred; same as parent ACT)
- `tail -f` / `-F` / `--follow` / `--retry` / `--pid` / `-c`
  (long-running / byte-counted; same as parent ACT)
- `sort` / `uniq` / `wc` (next backlog tier per ACT §13)
- Quoted-dynamic operand promotion
  (`cat "$HOME/secret"`, `cat "${HOME}/secret"`)
  -- requires V2 parser-proven `argProvenance === "static"` AND
  binding the EXACT projected operand (not the raw token).
  Deferred to a separate ACT.

## Status

CORRECTION01 GREEN:
  - `cat $HOME/secret`              ASK (was ALLOW)
  - `head -30 $HOME/secret`         ASK (was ALLOW)
  - `tail -20 $HOME/secret`         ASK (was ALLOW)
  - `cat ~/secret`                  ASK (was ASK, wrong reason)
  - `head -30 ~/secret`             ASK (was ASK, wrong reason)
  - `tail -20 ~/secret`             ASK (was ASK, wrong reason)
  - `cat *`                         ASK (was ASK, wrong reason)
  - `cat ?.txt`                     ASK (was ASK, wrong reason)
  - 14/14 parent REAL_PRODUCTION_SEAM still PASS
  - 921/921 `@cline/core` command-policy tests PASS
  - 1076/1076 apps/vscode unit tests PASS
  - apps/vscode check-types EXIT=0

## Next steps

The reviewer authorized:
  "One bounded correction, then proceed. Do not reopen the wider
   path-authority design."

So: continue to VSIX / LIVE qualification on the parent ACT.
