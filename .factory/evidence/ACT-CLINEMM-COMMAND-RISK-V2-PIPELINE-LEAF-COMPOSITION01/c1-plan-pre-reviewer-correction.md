# ACT-CLINEMM-COMMAND-RISK-V2-PIPELINE-LEAF-COMPOSITION01 — C1 PLAN

## Status: RECON COMPLETE / C1 READY

Factory reviewer disposition (CORRECTION01 closure report):
> The backlog pointer is now legitimate:
> `ACT-CLINEMM-COMMAND-RISK-V2-PIPELINE-LEAF-COMPOSITION01`
> because the original recon chain still asks specifically due to
> `head` not being part of the safe leaf surface, rather than
> because of redirect semantics.
>
> **C1: GO to that next ACT.**

This file is the recon summary + C1 plan.

---

## Recon: what is the actual defect class?

The ACT §12 recon chain
`pwd && git status && git log --oneline -5 origin/main && ls -la .factory/ 2>/dev/null | head -30`
is ASK for **three independent reasons**, each a separate boundary:

### Boundary A (in-scope): leaf-level safe-rule coverage gaps

- `git log --oneline -5 origin/main` -> ASK because `host_safe_git_log`
  regex doesn't allow positional ref args (`origin/main`, `HEAD~5`,
  `HEAD^`, etc.). All args are parser-proven static literals.
- `head -30 some-file` -> ASK because there is no `host_safe_head`
  rule at all. All args are parser-proven static literals.
- `cat some-file`, `wc -l some-file`, `tail -20 some-file`, `sort`,
  `uniq` -- same gap (no V1 rules, parser-proven static).

### Boundary B (in-scope but separate sub-ACT): V2 promotion surface

The current V2 parser-proven promotion branch is hard-coded to
`echo` only (`structured-command-risk.ts:859-873`):

```ts
if (
    protocolVersion >= 3 &&
    cmd.name === "echo" &&
    cmd.redirects.length === 0 &&
    cmd.argProvenance !== undefined &&
    cmd.argProvenance.length === cmd.args.length &&
    cmd.argProvenance.every((p) => p === "static")
) { ... }
```

It does not generalize to `head`/`cat`/`git log` because:
1. The reviewed-option whitelist for `head`/`cat` doesn't exist.
2. The promotion needs additional argv-shape restrictions
   (e.g., `--help` should NOT promote even though args are static).

### Boundary C (OUT OF SCOPE): path authority for `ls`

`ls -la .factory/ 2>/dev/null` -> ALLOW in our recon harness
(V2 promoteToAllow=true), but in production it falls through to
ASK because the host adapter does not supply
`pathAuthorityEvidence`. This is a host-adapter concern; it is
the responsibility of `buildPathAuthorityEvidence` (which was
fixed in `ACT-CLINEMM-COMMAND-APPROVAL-SPLIT-UNDEFINED-REGRESSION01`).
**NOT in this ACT's scope.**

### Boundary D (OUT OF SCOPE): dangerous sinks

`head some-file | sh` is ASK because the `| sh` sink is dangerous.
This is the reformulation-classifier / dangerous-sink boundary.
**NOT in this ACT's scope.**

---

## Recon: parser-proven argProvenance works for the candidate commands

(`.factory/evidence/.../recon-argprovenance-corpus.txt`)

### POSITIVE (all args parser-proven `static`):

| Command | Args | argProvenance |
|---------|------|---------------|
| `git log --oneline -5 origin/main` | `log, --oneline, -5, origin/main` | static x 4 |
| `git log --oneline -20 origin/main` | `log, --oneline, -20, origin/main` | static x 4 |
| `git log -n 10` | `log, -n, 10` | static x 3 |
| `git log --stat -5` | `log, --stat, -5` | static x 3 |
| `git show HEAD` | `show, HEAD` | static x 2 |
| `git show --stat HEAD` | `show, --stat, HEAD` | static x 3 |
| `git rev-parse HEAD` | `rev-parse, HEAD` | static x 2 |
| `git rev-parse --abbrev-ref HEAD` | `rev-parse, --abbrev-ref, HEAD` | static x 3 |
| `git rev-list --count HEAD` | `rev-list, --count, HEAD` | static x 3 |
| `git branch --show-current` | `branch, --show-current` | static x 2 |
| `head -30 some-file` | `-30, some-file` | static x 2 |
| `head -n 30 some-file` | `-n, 30, some-file` | static x 3 |
| `cat some-file` | `some-file` | static x 1 |
| `wc -l some-file` | `-l, some-file` | static x 2 |
| `tail -20 some-file` | `-20, some-file` | static x 2 |
| `sort some-file` | `some-file` | static x 1 |
| `uniq some-file` | `some-file` | static x 1 |

### NEGATIVE (gate MUST reject):

| Command | Why rejected |
|---------|-------------|
| `git diff HEAD~1` | `HEAD~1` is `dynamic` (tilde expansion) |
| `git diff --stat HEAD~1` | same |
| `head $(rm -rf foo)` | `$(...)` is `dynamic`; `hasCommandSubstitution=true` |
| `head "$HOME"` | `$HOME` is `dynamic` (param expansion) |
| `head ${HOME}/file` | same |
| `head some-file; rm -rf foo` | second statement `rm -rf foo` is R5-mutating |
| `head some-file | sh` | pipe to sh (out of scope: dangerous-sink boundary) |
| `head some-file > /etc/passwd` | sensitive redirect target (already caught by R5 redirect classifier) |
| `head --help`, `head --version` | parser-proven static BUT not in reviewed option whitelist (need argv-shape check) |

---

## C1 SCOPE

Bounded V2 parser-proven leaf-class extension:

### Scope: extend `host_safe_echo_parser_proven` to a curated allowlist

1. **Generalize** the `host_safe_echo_parser_proven` branch to
   accept a curated set of observational/reader commands
   (echo / cat / head / tail / wc / sort / uniq + git log / git show
   / git rev-parse / git rev-list / git branch).

2. **Each command gets a per-command argv-shape validator** that
   enumerates the reviewed options. Examples:
   - `head`: `-n <int>`, `-c <int>`, `-<int>`, `--`, then >=1 path
     args. NO `--help`, `--version`, `-v`, etc.
   - `cat`: NO options except `--`. Then >=1 path args.
   - `git log`: reviewed V1 options + `argProvenance=static` for
     ALL args including positional refs (`HEAD`, `origin/main`,
     `main..feature` -- wait, `main..feature` has `dynamic`? let me check).

3. **Source labels**: distinct per command to preserve the V2
   trace, e.g. `host_safe_head_parser_proven`, `host_safe_cat_parser_proven`,
   `host_safe_git_log_parser_proven`, etc.

4. **Composition**: the existing `classifyStmt` aggregation
   (`maxRisk`) and V2 promotion gate
   (`command-risk.ts:572-583`) automatically compose. Once the
   leaves are parser-proven safe, `git log ... | head` and the
   ACT §12 chain both move from ASK to ALLOW (modulo the
   out-of-scope boundaries above).

5. **Fail-closed invariants** (any one disqualifies the promotion):
   - protocolVersion < 3 (v2 injects `["unknown"]*` already)
   - cmd.name not in the new allowlist
   - any argProvenance !== "static"
   - argProvenance length mismatch with args
   - the per-command argv-shape validator rejects (e.g. `head --help`)
   - any redirect present (echo promotion's invariant; applies
     uniformly)
   - any aggregated sibling is not also parser-proven
     (i.e., the `&&`/`||`/`|` chain must have ALL leaves parser-
     proven; this is enforced automatically by `classifyStmt`
     since `promoteToAllow` requires `max(risk) === auto-approve-eligible`)

### Conservation proofs (NEW tests):

- `head --help` -> ASK (option not in reviewed whitelist)
- `head --version` -> ASK
- `head -30 $(rm -rf foo)` -> ASK (dynamic arg)
- `head -30 "$HOME"` -> ASK (dynamic arg)
- `head some-file; rm -rf foo` -> ASK (sibling mutating leaf)
- `head -30 /etc/passwd` -> ASK (path authority; OUT of this ACT's
  promotion, but the classifier must NOT bypass path authority
  by promoting via the parser-proven path)

### Out of scope (explicit):

- **Pipe-to-shell dangerous-sink**: `head | sh`, `cat | sh`
  remain ASK via the reformulation-classifier. NOT this ACT.
- **`bash -c 'head -30 /etc/passwd'`**: wrapper; stays ASK
  (existing wrapper handling).
- **Path authority for `ls`**: host-adapter concern, NOT this ACT.
- **`git log main..feature`** (range with `..`): tbd whether
  `..` is `dynamic` or `static` per the classifier; will be
  checked in C2.
- **`echo $(cmd)` / `echo $VAR`**: V1's `host_safe_echo` regex
  already rejects (the `host_safe_echo_parser_proven` branch is
  additive).

---

## File-level plan

### C2 (test file): RED-first RED tests

`sdk/packages/core/src/runtime/command-policy/structured-command-risk.pipeline-leaf-composition.test.ts`

Sections:
- A: positive real-binary (v4 helper) -- the candidate leaves
- B: real-helper conservation controls (dynamic, sensitive path,
  unknown options)
- C: pipe composition (parser-proven leaf + parser-proven leaf)
- D: && chain composition (parser-proven leaf + parser-proven leaf)
- E: synthetic fixtures (parser-proven argProvenance without the
  helper, for unit-test symmetry)

Target: ~30 new tests.

### C3 (production code): the classifier change

`sdk/packages/core/src/runtime/command-policy/structured-command-risk.ts`

- Add a `parserProvenAllowList: ReadonlySet<string>` and a
  per-command argv-shape validator map.
- Generalize the existing `host_safe_echo_parser_proven` branch
  to dispatch on `cmd.name`.
- Each new branch returns its own source label
  (`host_safe_head_parser_proven`, etc.).
- The fail-closed invariants remain identical (same protocol
  version gate, same argProvenance gate, same no-redirects gate).

### C4 (VSIX + binding): NO CHANGE

The v4 parser helper already emits `argProvenance` for every
command's args. No protocol bump needed. No vendored-helper
rebuild needed. **CORRECTION01's helper rebinding remains valid
for this ACT.**

### C5 (epic board row): append a row

Same format as previous rows. Verify:
- `evaluateCommandRiskWithParser` on the ACT §12 recon chain
  (with the path-authority evidence path supplied) -> ALLOW.
- Conservation: all 9 negative controls remain ASK.

---

## Acceptance criteria

1. **REGRESSION GATE**: all existing 783/783 command-policy tests
   still PASS.
2. **NEW RED -> GREEN**: ~30 new tests in
   `pipeline-leaf-composition.test.ts` go from RED to GREEN.
3. **REAL-BINARY GATE**: 7+ discriminator cases on the rebuilt
   v4 helper including the original ACT §12 recon chain (with
   path evidence supplied).
4. **VSIX gate**: no helper rebuild required; fresh `bun run
   package` produces a new VSIX that bundles the existing v4
   helper.
5. **EVIDENCE-LEVEL**: REAL_PRODUCTION_SEAM (no installed-UI
   LIVE) per the corrected labeling convention.

---

## Risks / open questions

1. **`git log main..feature` argProvenance**: the `..` operator
   is shell literal (no expansion), so it should be `static`.
   Need to confirm in C2's RED tests.
2. **`sort -u some-file`** / `uniq -c some-file`: parser-proven
   static; need reviewed-option whitelist for these.
3. **V1 path authority**: need to confirm the V2 parser-proven
   promotion does NOT bypass V1's path authority check. The
   `command-risk.ts:572-583` `v2StructureCausedAsk` gate
   currently requires `opaqueCommands.length > 0`; the
   parser-proven branch (lines 580-585) does NOT require that,
   so it could in principle promote a path-bearing ASK. We
   need to add a path-authority-aware gate to the parser-proven
   branch -- likely: "if V1's source label indicates path
   authority (e.g. `host_workspace_realpath_authority`),
   parser-proven cannot promote."
4. **Backward compatibility**: the parser-proven branch was
   documented as `echo`-only. Generalizing it requires a new
   ACT row documenting the broader allowlist with reviewed
   options for each command.

---

## Halt conditions (NOT to do)

- DO NOT extend to writer/mutating commands (`rm`, `mv`, `cp`,
  `mkdir`, `chmod`, `chown`, etc.).
- DO NOT touch the wrapper detection (`bash -c`, `sh -c`).
- DO NOT modify the redirect classifier.
- DO NOT extend to commands with positional ref expansion
  semantics (e.g. `git log --grep=...` -- `--grep` takes a
  regex; positional refs include `HEAD@{upstream}`, `HEAD^2`,
  etc. which may be `dynamic`).
- DO NOT auto-promote the ACT §12 chain end-to-end; the
  path-authority boundary (`ls`) is OUT OF SCOPE.

---

## End of C1 plan.
