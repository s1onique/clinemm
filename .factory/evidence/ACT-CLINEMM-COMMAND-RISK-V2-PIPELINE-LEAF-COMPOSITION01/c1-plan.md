# ACT-CLINEMM-COMMAND-RISK-V2-PIPELINE-LEAF-COMPOSITION01 -- C1 PLAN (CORRECTED)

## Status: C1-C2 COMPLETE / C2-CORRECTION01 REPAIR LANDED / C5 CLOSE_PENDING

Factory reviewer dispositions:

```
# C1 (pre-correction):
HALT_PATH_AUTHORITY_PROMOTION_GAP

  Do one bounded plan correction, then proceed directly to C2 RED.
  No further review round is needed unless that correction uncovers a new P0.

  REOPEN:
    amend C1 scope:
      stdin-only/pathless leaves now
      path-bearing leaves require canonical realpath gate
      Git revision false-negatives explicitly deferred

  THEN:
    C2: GO
    produce bounded RED once

# C2 (post-implementation):
HALT_PARSER_PROVEN_PROMOTION_BYPASSES_PATH_AUTHORITY

  The leaf implementation itself is good (the new head/tail
  validators are genuinely stdin-only). The P0 is one level
  higher, in command-risk.ts: the generalized parser-proven
  promotion gate (PARSER_PROVEN_SOURCE_LABELS) was missing the
  authority-preservation gate (isStructureOnlyPromotableAsk).
  Adding it closes the bypass.

  STDIN-ONLY HEAD/TAIL LEAF CONTRACT       PASS
  REAL V4 PARSER PROVENANCE                PASS
  PER-COMMAND ARGV VALIDATORS              PASS
  MIXED-RISK/R5 CONSERVATION               PASS
  GENERALIZED V1->V2 PROMOTION:
    authority-ASK preservation             FAIL

  BOUNDED CORRECTION:
    make host-authority ASK non-promotable
    + prove with real path-evidence tests

  THEN:
    PASS_PIPELINE_LEAF_STDIN_ONLY_READER
    CLOSED_CLEAN
```

This file is the post-reviewer **corrected** C1 plan. The
pre-correction plan is preserved at `c1-plan-pre-reviewer-correction.md`.
The C2-CORRECTION01 amendment is preserved at `c1-plan-correction01.md`
and reflects the production code change in commit `<<TBD>>`.

C2-CORRECTION01 PRODUCTION CHANGE:
  - `command-risk.ts`: `isParserProvenPromotion` now also
    requires `isStructureOnlyPromotableAsk(finalSource)`,
    matching the existing `v2StructureCausedAsk` gate.
  - `structured-command-risk.pipeline-leaf-composition.test.ts`:
    +9 new Section J tests (real host-bound authority
    preservation: temp filesystem + realpath + per-command
    DISC for missing/outside/symlink cases).
  - P2 cleanup: corrected contradictory protocol-version
    test comments; primary gate is `parserResult.protocolVersion
    !== STRUCTURED_PROTO_VERSION && parserResult.protocolVersion
    !== 2`, secondary gate in classifyCmd is `>= 3` (the latter
    is unreachable from v3 because the former rejects first).

---

## Reviewer's P0: static shell syntax != filesystem authority

The corrected understanding:

```
argProvenance=static    => the shell won't expand this argument
argProvenance=static    !=> the host authorizes this filesystem object
```

For a NEW `cat`/`head`/`tail`/etc. family, V1 has no safe rule
match at all. So:

- V1 emits `host_mode_safe_only_fallthrough` (the generic
  safe-only ASK), NOT `host_workspace_realpath_authority`
  (which only fires AFTER V1 matched an R0 rule).
- The proposed "reject when V1 source is
  `host_workspace_realpath_authority`" gate therefore does NOT
  fire here, because there is no such source to inspect.
- A V2-only positive promotion would bypass the confinement
  layer entirely. That would be an authority expansion.

**Both proofs required for path-bearing promotion**:

```
PARSER:
  command shape observational
  shell arguments parser-proven static

HOST:
  every filesystem operand has exact host-produced realpath evidence
  AND resolves inside authorized workspace roots

BOTH  => promotion eligible
```

Neither proof substitutes for the other.

## Reviewer's semantic correction: HEAD~1 / HEAD@{upstream} are not shell-dynamic

The pre-correction C1 plan recorded these as "tilde expansion" and
"brace expansion" respectively. Reviewer correction:

- `HEAD~1` is Git revision syntax, NOT bash tilde expansion.
  Bash tilde expansion only fires when `~` is at the start of an
  eligible word. (`HEAD~1` does not have `~` at the start.)
  Current helper reports `dynamic`; that is a **conservative
  false negative** with **no safety impact** and **some
  precision loss**.
- `HEAD@{upstream}` is Git revision syntax, NOT bash brace
  expansion. Brace expansion requires comma alternatives or a
  sequence expression. Current helper reports `dynamic`; again
  conservative false negative, no safety impact.
- `{main,feature}` IS genuine shell brace expansion and remains
  correctly classified `dynamic`.

The reviewer explicitly directed:

```
Do not fix this inside the pipeline ACT.

Record:
  PARSER_PROVENANCE_FALSE_NEGATIVES:
    HEAD~1
    HEAD@{upstream}
  SAFETY_DELTA: none
  PRECISION_DELTA: some valid Git revision expressions
                  cannot yet be promoted
```

Recorded. Deferred to a later ACT.

---

## Corrected C2 SCOPE

### IN scope (now, this ACT):

| Form | Why safe |
|------|----------|
| `head` | stdin-only, zero path operands |
| `head -30` | stdin-only |
| `head -n 30` | stdin-only |
| `head -c 100` | stdin-only |
| `head --` | stdin-only (explicit end-of-options) |
| `head -n 30 --` | stdin-only |
| `tail` | stdin-only |
| `tail -20` | stdin-only |
| `tail -n 20` | stdin-only |
| `git log` (existing V1 argv shape only -- no positional ref) | conservation only |
| `git log --oneline -20` | conservation -- already V1-safe via existing `host_safe_git_log` regex |
| existing `pwd`, `git status`, `ls`, `find` | conservation only |

**The path-bearing family (`cat FILE`, `head FILE`, etc.) is OUT OF SCOPE this ACT.** A separate ACT will integrate them
with the existing R0 path-bearing machinery by:

1. Adding `host_safe_head_path_proven`, `host_safe_cat_path_proven`,
   etc. as recognized R0 path-bearing sources in
   `R0_READONLY_PATH_BEARING_SOURCES` (command-policy.ts:531).
2. Letting V1's existing `isR0ReadonlyRuleSource` gate fire the
   `host_workspace_realpath_authority` realpath gate for them.
3. The V2 parser-proven branch provides the "argv shape is
   reviewed" half of the two-proof composition; the realpath
   gate provides the "every operand is host-authorized" half.

### Path-bearing blocked list (must remain ASK):

- `head some-file`, `head -30 some-file` (any file operand)
- `tail -20 some-file`
- `cat some-file`
- `sort some-file`, `uniq some-file`, `wc -l some-file`

### Git log positional refs (deferred to git-provenance ACT):

- `git log main..feature` -- parser-proven `static` today; C2
  may include (tiny argv validator). Reviewer's edge case
  indicates it is a false negative-deferred family; safer to
  defer.
- `git log HEAD~1`, `git log HEAD@{upstream}` -- parser says
  `dynamic` (conservative false negative); defer.
- `git log {main,feature}` -- genuine `dynamic`; ASK forever.

### OUT of scope (explicit):

- Pipe-to-shell dangerous sinks (reformulation-classifier
  territory).
- Bash wrapper detection.
- Path authority integration for path-bearing readers (separate
  ACT).
- ArgProvenance `~`/`{...}` classification precision fix
  (separate ACT).
- `git log --grep=...`, `--author=...`, `--since=...` option
  surface expansion (separate ACT after the git-provenance ACT).

---

## Architecture: per-command validators, not a giant allowlist

Reviewer's explicit directive:

```
Don't generalize:
  host_safe_echo_parser_proven
into one giant:
  if all args static and command in LIST -> ALLOW

Prefer per-command validators:
  classifyParserProvenEcho(...)
  classifyParserProvenHead(...)
  classifyParserProvenGitLog(...)
sharing only the common positive primitive:
  allArgsStatic(...)
```

For this ACT's narrow scope, the per-command validator pattern is
applied as:

```
isParserProvenStdinOnlyReader(cmd) -> boolean
isParserProvenPathlessGitLog(cmd)   -> boolean
isParserProvenPathlessEcho(cmd)     -> boolean  (existing branch)
```

Each validator:
- Returns `false` if `cmd.name` doesn't match.
- Returns `false` if `protocolVersion < 3` (v2 injects
  `["unknown"]*` already).
- Returns `false` if `cmd.redirects.length !== 0` (echo's
  invariant; apply uniformly -- a `head -30 > /tmp/x` must
  remain ASK until redirected-write is reviewed).
- Returns `false` if `cmd.argProvenance` missing or any entry
  !== `"static"`.
- Returns `true` only after the per-command argv-shape review.

The dispatch in the existing parser-proven branch becomes:

```ts
if (isParserProvenStdinOnlyReader(cmd)) return { source: "host_safe_head_parser_proven_stdin_only", risk: auto-approve-eligible }
if (isParserProvenPathlessGitLog(cmd))   return { source: "host_safe_git_log_parser_proven_pathless", risk: auto-approve-eligible }
if (isParserProvenPathlessEcho(cmd))     return { source: "host_safe_echo_parser_proven", risk: auto-approve-eligible }   // existing branch, kept as-is
```

The composition (`&&`/`||`/`|`) automatically composes via
`classifyStmt` aggregation: once all leaves are parser-proven
safe, the chain is ALLOW.

---

## Reviewer-mandated conservation suite (RED):

```
head "$HOME"                              -> ASK (dynamic arg)
head $(cmd)                               -> ASK
head some-file                            -> ASK until path authority integrated
head --help                               -> ASK (option not reviewed)
head --version                            -> ASK (option not reviewed)
head -c 100                               -> ASK (-c option not in stdin-only profile)
head -30 /etc/passwd                      -> ASK (path operand)
head -30 | sh                             -> ASK (dangerous sink)

git log {main,feature}                    -> ASK (brace expansion)
git log "$(cmd)"                          -> ASK
git log --grep=foo                        -> ASK (--grep not reviewed)

safe chain && git branch -D sentinel      -> ASK (R5 sibling)
```

---

## Does the narrow scope fix the original LIVE chain?

Original ACT §12 chain:

```
pwd && git status && git log --oneline -5 origin/main && ls -la .factory/ 2>/dev/null | head -30
```

Decomposed:

| Component | Today's verdict | After this ACT |
|-----------|-----------------|----------------|
| `pwd` | ALLOW (V1) | ALLOW (conservation) |
| `git status` | ALLOW (V1) | ALLOW (conservation) |
| `git log --oneline -5 origin/main` | ASK (no rule for positional refs) | STILL ASK (deferred to git-provenance ACT) |
| `ls -la .factory/` | ASK (path authority gate) | ASK (conservation; OUT OF SCOPE) |
| `head -30` | ASK (no rule) | **ALLOW** (stdin-only reader) |

The pipe `ls ... | head -30` becomes ALLOW only when BOTH `ls`
(path evidence supplied by host) AND `head -30` (stdin-only
reader, parser-proven) are ALLOW. After this ACT:

- `head -30` (stdin-only): ALLOW.
- `ls ... 2>/dev/null`: still depends on host `pathAuthorityEvidence`. NOT this ACT's scope.

So the narrow scope **does not** fully close the original ACT §12
chain. But it does close the **head component** and the
**pipe-from-stdin-to-head composition**, which is the original
defect the reviewer identified:

> the original recon chain still asks specifically due to
> `head` not being part of the safe leaf surface, rather than
> because of redirect semantics

After this ACT:

```
ls -la .factory/ 2>/dev/null | head -30
              ^                   ^
              still ASK (path    ALLOW (parser-proven
              authority, out     stdin-only reader)
              of scope)
```

The pipe's right leaf is now ALLOW. The left leaf's ASK is no
longer "head not in safe leaf surface" -- it is now exclusively
a path-authority question, which is the correct architectural
location for that concern. The original ACT's headline defect
("`head 2>/dev/null` causes chain to ASK") is closed.

---

## File-level plan

### C2 RED: `structured-command-risk.pipeline-leaf-composition.test.ts`

Sections:

- A: stdin-only positive cases (real helper)
  - `head`, `head -30`, `head -n 30`, `head -c 100`, `head --`,
    `head -n 30 --`
  - `tail`, `tail -20`, `tail -n 20`
- B: path-bearing negative cases (real helper) -- MUST REMAIN ASK
  - `head some-file`, `head -30 some-file`, `head -n 30 some-file other-file`
  - `cat some-file`, `tail -20 some-file`, `sort some-file`,
    `uniq some-file`, `wc -l some-file`
- C: dynamic-arg negative cases (real helper)
  - `head $(cmd)`, `head "$HOME"`, `head ${HOME}/file`
  - `git log $(cmd)`, `git log "$VAR"`
- D: unknown-option negative cases
  - `head --help`, `head --version`, `head -v`, `head -c 100`
- E: redirect negative case
  - `head -30 > /tmp/x` (redirect -> ASK)
- F: pipe composition (stdin-only head after various lefts)
  - `echo hello | head` -> ALLOW
  - `echo hello | head -30` -> ALLOW
  - `ls . 2>/dev/null | head -30` -> ASK because ls still ASK
    (path authority); head -30 ALLOW; ASK via ls sibling
- G: && chain composition (mixed)
  - `pwd && git status && head -30` -> ALLOW
  - `pwd && head -30 && git branch -D sentinel` -> ASK
    (sibling R5)
- H: synthetic fixtures (no helper)
  - Build a fake `ParsedShell` with `argProvenance: ["static"]`
    and a `cmd.name: "head"` with `args: ["-30"]`; verify
    `classifyCmd` returns auto-approve-eligible.
- I: helper-version gates
  - `protocolVersion: 2` -> ASK (v2 injects `["unknown"]*`)
  - `protocolVersion: 3` -> ALLOW (v3 emits real provenance)
  - `protocolVersion: 4` -> ALLOW (v4 additively carries
    redirect fd/pathProvenance)

Target: ~30 new tests.

### C3 production code: `structured-command-risk.ts`

- Add `parserProvenStdinOnlyReaderAllowlist: ReadonlySet<string>`
  (just `{head, tail}` for this ACT).
- Add per-command argv-shape validators
  (`isParserProvenStdinOnlyReader`, `isParserProvenPathlessGitLog`).
- Generalize the existing `host_safe_echo_parser_proven` branch
  into a dispatch block. Keep the existing source label for
  `echo` (don't break the trace).
- Add NEW source labels for the new branches:
  - `host_safe_head_parser_proven_stdin_only`
  - `host_safe_tail_parser_proven_stdin_only`
- Fail-closed invariants: identical to echo's invariants
  (protocolVersion gate, argProvenance gate, no-redirects gate).

### C4 (VSIX + binding): NO CHANGE

The v4 parser helper already emits `argProvenance` for every
command's args. No protocol bump needed. No vendored-helper
rebuild needed. CORRECTION01's helper rebinding remains valid
for this ACT.

### C5 (epic board row): append a row

Same format as previous rows. Verify with REAL_PRODUCTION_SEAM
evidence (not LIVE):

- `head -30` -> ALLOW
- `cat some-file` -> ASK (path-bearing; out of scope)
- `head "$HOME"` -> ASK
- `head --help` -> ASK
- `echo hello | head -30` -> ALLOW
- `ls .factory/ 2>/dev/null | head -30` -> ASK (ls still ASK)

---

## Acceptance criteria

1. **REGRESSION GATE**: all existing 783/783 command-policy tests
   still PASS.
2. **NEW RED -> GREEN**: ~30 new tests in
   `pipeline-leaf-composition.test.ts` go from RED to GREEN.
3. **REAL-BINARY GATE**: 7+ discriminator cases on the rebuilt
   v4 helper.
4. **VSIX gate**: no helper rebuild required; fresh `bun run
   package` produces a new VSIX that bundles the existing v4
   helper.
5. **EVIDENCE-LEVEL**: REAL_PRODUCTION_SEAM (no installed-UI
   LIVE) per the corrected labeling convention.

---

## Halt conditions (NOT to do)

- DO NOT promote `head FILE`, `cat FILE`, `tail FILE`,
  `sort FILE`, `uniq FILE`, `wc FILE` (path-bearing family
  blocked until canonical realpath gate is integrated in a
  separate ACT).
- DO NOT touch the wrapper detection (`bash -c`, `sh -c`).
- DO NOT modify the redirect classifier.
- DO NOT extend `git log` to positional refs in this ACT
  (deferred to git-provenance ACT).
- DO NOT fix the `~` / `{...}` shell-static classification
  precision (deferred to a shell-static classifier ACT).
- DO NOT auto-promote the ACT §12 chain end-to-end; the
  `ls` path-authority boundary is OUT OF SCOPE.

---

## Reviewer-mandated recorded observations

```
PARSER_PROVENANCE_FALSE_NEGATIVES:
  HEAD~1           (Git revision syntax, not bash tilde expansion)
  HEAD@{upstream}  (Git revision syntax, not bash brace expansion)

SAFETY_DELTA:   none  (conservative false negatives cannot lead
                      to spurious ALLOW)
PRECISION_DELTA: some valid Git revision expressions cannot yet
                 be promoted; will be addressed in a later
                 shell-static classification ACT

The v3/v4 helper is intentionally conservative: any unquoted Lit
containing ~, {...}, or a glob is marked dynamic. False negatives
are accepted; false positives are rejected.
```

---

## End of corrected C1 plan.
