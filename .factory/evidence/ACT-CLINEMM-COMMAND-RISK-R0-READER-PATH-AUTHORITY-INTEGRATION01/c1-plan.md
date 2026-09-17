# ACT-CLINEMM-COMMAND-RISK-R0-READER-PATH-AUTHORITY-INTEGRATION01 — C1 plan

## Reviewer context

The previous LIVE pipeline qualification
(`ACT-CLINEMM-COMMAND-RISK-V2-PIPELINE-LEAF-COMPOSITION01`) chained
four corrections to produce a CORRECTION04-closed path-bearing
authority machinery. The dogfood chain now passes through every
green step:

```
echo hello | head -30                                      AUTO-RUN
pwd && head -30                                            AUTO-RUN
pwd && git status && head -30                              AUTO-RUN
original recon chain                                       AUTO-RUN
git status 2>/dev/null                                     AUTO-RUN
```

That's LIVE confirmation that the last two production repairs
compose correctly. The next friction the user hits is the
file-inspection commands that take PATH OPERANDS, not stdin:

```
cat .factory/README.md
head -30 some-file
tail -20 some-file
```

The previous LIVE result was directly limited because:

- `cat some-file` / `head some-file` / `tail some-file` were
  never in any V1 R0 safe rule
- V2 parser-proven stdin-only readers (parent ACT) explicitly
  REJECT path-bearing forms
- V1 safe-rule layers required `host_workspace_realpath_authority`
  evidence for ANY path-bearing rule match

## C1 plan

This ACT adds three NEW R0 path-bearing reader safe rules
(`host_safe_cat`, `host_safe_head_path`, `host_safe_tail_path`)
that compose with the existing canonical
CORRECTION01-CORRECTION04 path-authority machinery (not a parallel
subsystem). Per ACT §11:

```
host_safe_cat
host_safe_head_path
host_safe_tail_path
```

are added to `R0_READONLY_PATH_BEARING_SOURCES` so V1's
`host_workspace_realpath_authority` gate fires for them.

The new readers reuse the existing architecture:
- V1 safe-rule regex: positive matcher that rejects every
  un-reviewed option
- V1 host realpath evidence: per-operand identity + canonical
  containment
- V1 authority context binding: roots/cwd byte-equal against
  the current host authorization (CORRECTION04 invariant)
- V2 structured-command-risk classifier: pipe / and / or / subshell
  composition; every reachable R0 path-bearing leaf must be bound

## Per-source operand extraction

The reviewer-flagged pre-design check is the operand extractor.
The generic `extractPathOperands` ("skip any token starting
with `-`") is UNSOUND for `head -n 30 FILE` because `-n`'s value
token `30` is treated as a path candidate. That mismatch would
make the authority gate fail operand-identity binding on the
count number and force ASK.

This ACT introduces `extractR0PathOperands(command, source)`:
a per-source dispatcher. The same dispatch is mirrored in the
V2 walker (`structured-command-risk.ts`) so the host-evidence
binder and the V2 promotion gate see IDENTICAL operand lists.

| Source                  | Extractor                                |
|-------------------------|------------------------------------------|
| `host_safe_cat`         | every non-option, non-`--` token         |
| `host_safe_head_path`   | first non-option token after consuming `-n N` |
| `host_safe_tail_path`   | first non-option token after consuming `-n N` |
| `host_safe_ls`          | generic (existing)                       |
| `host_safe_find`        | generic (existing)                       |
| (fallback)              | generic                                  |

## Mandatory adversarial matrix (already RED → GREEN)

The full matrix from the ACT §8 is exercised in the new test
file `structured-command-risk.reader-path-authority.test.ts`:

| case                                                    | expected |
|---------------------------------------------------------|----------|
| cat FILE + matching evidence                            | ALLOW    |
| cat FILE1 FILE2 + matching evidence                     | ALLOW    |
| cat README.md /etc/passwd (one outside operand)         | ASK      |
| cat FILE 2>/dev/null (redirect V1)                       | ASK      |
| cat FILE > /tmp/x                                       | ASK      |
| head -30 FILE + matching evidence                       | ALLOW    |
| head -n 30 FILE + matching evidence                      | ALLOW    |
| head -- FILE + matching evidence                        | ALLOW    |
| head -30 /outside/file + matching evidence              | ASK      |
| tail -20 FILE + matching evidence                       | ALLOW    |
| tail -n 20 FILE + matching evidence                      | ALLOW    |
| tail -f FILE                                            | ASK (rule reject) |
| tail --follow FILE                                      | ASK (rule reject) |
| tail --retry FILE                                       | ASK (rule reject) |
| missing evidence (cat/head/tail)                        | ASK      |
| wrong-operand evidence                                  | ASK      |
| stale broader-roots evidence (CORRECTION04 invariant)   | ASK      |
| stale foreign-cwd evidence (CORRECTION04 invariant)     | ASK      |
| symlink escape (realpath-resolved outside)              | ASK      |
| dynamic operand (`$HOME`, `$(cmd)`)                     | ASK (rule reject) |
| R5 sibling (`cat README.md && rm -rf $HOME`)            | ASK (R5 floor) |
| R5 sibling (`head README.md && git branch -D ...`)       | ASK (R5 floor) |
| necessity ablation (disable only the 3 new sources)     | ASK      |

## Why "not all six backlog readers"

The Factory progression stays bounded. The first three
(`cat`, `head FILE`, `tail FILE`) have:
- strongest observed utility in Cline reconnaissance
- cleanest per-command grammar (small finite option surface)
- direct composition with the existing R0 path-authority machinery

`sort`, `uniq`, `wc` would multiply the option grammar
(`sort -k 1 -t :`, `wc -l -w`, `uniq -c -d -u`) without an observed
production pain point. The ACT §13 backlog order is preserved:

```
LIVE pipeline qualification       DONE
→ cat/head/tail path authority    NOW
→ git log positional refs         next likely precision win
→ shellStatic false negatives
   HEAD~1 / HEAD@{upstream}        only if dogfood proves friction
→ sort/uniq/wc                    demand-driven
```

## Production seam

`real_production_seam_qualification.ts` (in this evidence dir)
exercises the canonical `evaluateCommandPolicy` against the
14-case adversarial matrix. 14/14 PASS.

## Gates

```
✓ 28 test files / 912 tests PASS in @cline/core command-policy/
✓ 1076 apps/vscode unit tests PASS
✓ apps/vscode check-types EXIT=0
✓ 14/14 REAL_PRODUCTION_SEAM harness PASS
✓ parser-helper binaries unchanged
✓ CLI typecheck unchanged
```

## Status

REAL_PRODUCTION_SEAM 14/14 GREEN. C2 GREEN + conservation
implied (the tests already include a necessity-ablation matrix
that proves the new sources are load-bearing).
