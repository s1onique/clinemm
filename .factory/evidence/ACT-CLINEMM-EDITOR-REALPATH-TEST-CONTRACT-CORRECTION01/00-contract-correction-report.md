# ACT-CLINEMM-EDITOR-REALPATH-TEST-CONTRACT-CORRECTION01 — Contract Correction

```text
ENTRY_HEAD = fa7da411d401b2e46672fa426fdaf10db5827360   (== EXPECTED ENTRY_HEAD)
BRANCH     = main
REMOTE     = origin git@github.com:s1onique/clinemm.git
WORKTREE   = clean tracked tree at ENTRY (verified before any edit)
VERDICT    = PASS
PRODUCTION_CODE_CHANGES = 0
```

## 1. VERDICT

```text
PASS — SDK and host contracts pass.
```

The three obsolete executor-level assertions in
`sdk/packages/core/src/extensions/tools/executors/editor.realpath-authority.test.ts`
have been replaced with executable tests of the ACTUAL
authorized-external-edit contract. The suite now verifies ClineMM's real
authorization architecture instead of imposing a nonexistent workspace-only
restriction on the raw SDK executor.

## 2. Entry verification

```text
$ git rev-parse HEAD
fa7da411d401b2e46672fa426fdaf10db5827360      # == EXPECTED ENTRY_HEAD

$ git branch --show-current
main

$ git remote -v
origin  git@github.com:s1onique/clinemm.git (fetch)
origin  git@github.com:s1onique/clinemm.git (push)
upstream https://github.com/cline/cline.git (fetch)
upstream https://github.com/cline/cline.git (push)

$ git status --short
(empty tracked tree at ENTRY)

$ git stash list
(empty at ENTRY; the temporary stash used to prove the Bash failures are
 pre-existing was popped immediately after the probe)

$ git worktree list
(protected worktrees preserved and untouched; no branch/reset/push/PR performed)
```

## 3. Existing RED (suite UNMODIFIED at ENTRY_HEAD)

```text
$ cd sdk/packages/core
$ bunx vitest run --config vitest.config.ts \
    src/extensions/tools/executors/editor.realpath-authority.test.ts

 ✓ A. control: clean write inside cwd passes
 ✓ B. relative lexical traversal escape (../...) is refused today
 × C. ABSOLUTE OUTSIDE TARGET — RED: must be refused
 × D. EXISTING SYMLINK ESCAPE — RED: lexical-inside must still be refused (effective destination)
 × E. nonexistent descendant of an outside root — RED: must be refused
 ✓ F. control: in-root canonical variant still passes
 ✓ H. control: ordinary workspace edit still passes

 Test Files  1 failed (1)
      Tests  3 failed | 4 passed (7)
```

**RED_REPRODUCED** — the established `3 failed / 4 passed` result reproduced
exactly. There was NO material baseline difference, so no re-classification of
the baseline was required.

The transcript in `01-original-red-reproduction.txt` was captured by restoring
the ENTRY_HEAD version of the file verbatim as a temporary witness
(`zz-entry-head-witness.realpath-authority.test.ts`), running it, and then
REMOVING the witness. The witness file is NOT part of the commit.

## 4. The contract this correction encodes

The predecessor ACT (`ACT-CLINEMM-EDITOR-REALPATH-AUTHORITY-TRIAGE01`) settled
the contract; this ACT only corrects the test that mis-stated it.

The real production contract is **"capability-specific authorized writable
root"**:

- The SDK executor is **deliberately policy-ignorant**. Its only path option
  is `restrictToCwd`, documented in `editor.ts` as *"Restrict relative-path file
  operations to paths inside cwd. Absolute paths are always accepted as-is."*
  The `cwd` argument is a **relative-path resolution base**, not a security
  boundary.
- Authorization lives **one layer up**, in the host:
  `SdkInteractionCoordinator.handleEditorOrApplyPatchApproval` →
  `classifyEditTarget` (realpath canonicalization) →
  `evaluateEditAutoApproval` (the lattice) → ASK publishes an approval card
  and blocks; ALLOW invokes the executor.

```text
editFiles=false                            => ASK  (any target)
editFiles=true  + inside                   => ALLOW
editFiles=true  + outside + external=false => ASK
editFiles=true  + outside + external=true  => ALLOW
classification=unavailable                => ASK  (fail closed)
```

`editFilesExternally` is the explicit, user-visible authorization for external
edits; it ships **ON** by default. An ASK resolves to either a rejection OR an
explicit user approval — and **an approved outside write STILL WRITES**.

The predecessor's own precedent, already adjudicated:

> *"current CYCLE5 RED suite expects C/D/E → executor refuses, but the correct
> semantic is C/D/E → ASK → user approves → executor STILL WRITES … Cannot
> simply flip C/D/E to executor-rejection GREEN — that encodes 'outside is
> forbidden', contradicting the upstream 'Edit all files' product contract."*

## 5. The bounded test correction

**File changed:** `sdk/packages/core/src/extensions/tools/executors/editor.realpath-authority.test.ts`

| Case | Before (obsolete) | After (corrected) |
|---|---|---|
| A | control — write inside | **UNCHANGED** |
| B | relative lexical traversal refused | **UNCHANGED** — still refused when `restrictToCwd` is enabled |
| C | absolute outside ⇒ executor refuses | **absolute outside ⇒ WRITTEN** (already-authorized); actual destination + contents asserted |
| D | symlink escape ⇒ executor refuses | **symlink destination resolved to the intended outside fixture ⇒ WRITTEN**; effective destination + contents asserted |
| E | nonexistent outside descendant ⇒ executor refuses | **nonexistent outside descendant ⇒ CREATED and WRITTEN**; actual destination + contents asserted |
| F | control — in-root canonical | **UNCHANGED** |
| H | control — ordinary workspace edit | **UNCHANGED** |

For each of C/D/E the suite now asserts, against disposable fixtures:

1. the executor call **resolves** (no rejection),
2. the **actual destination** holds the intended contents
   (`expectEffectiveDestination`),
3. the **effective (realpath) destination** lies OUTSIDE the workspace root,
4. the write did **not** land at a second, in-root location, and
5. the disposable fixture tree is **removed** (the `withTwoRootFixture` helper
   asserts `ENOENT` on the temp root in its `finally` block).

**NO authorization policy was added to `createEditorExecutor`.** The production
executor (`sdk/packages/core/src/extensions/tools/executors/editor.ts`) is
**byte-for-byte unchanged**.

## 6. Host-side conservation

The host already owns the authorization contract. The already-passing suites
were REUSED, not rewritten:

| Required host point | Existing suite |
|---|---|
| Absolute outside classification | `editor-path-authority.r1-classifier.test.ts` |
| Symlink realpath classification | `editor-path-authority.r1-classifier.test.ts` |
| `editFilesExternally=false` → ASK | `editor-effective-destination-approval.r0-green.test.ts` (R0), `correction02-policy-precedence` (T5) |
| `editFilesExternally=true` → ALLOW | `editor-effective-destination-approval.r0-green.test.ts` (R0d), `editor-auto-approval-policy.r2-lattice.test.ts` |
| `unavailable` → ASK | `editor-auto-approval-policy.r2-lattice.test.ts` |

### Actual coverage gaps found → 1 new host suite

Two required points had **no** permanent executable coverage:

- **GAP 1 — nonexistent outside descendant classification.** The classifier
  suite covers absolute-outside, symlink-realpath-outside and unavailable, but
  it did not pin the THIRD geometry the SDK suite exercises: a target that does
  not exist yet whose nearest EXISTING ancestor is OUTSIDE the workspace root.
  That classification is what makes SDK case E an *authorized* external edit
  rather than an escape.
- **GAP 2 — explicit user approval permitting an outside write.** The existing
  `r0-green` R0 drives the REAL coordinator and asserts `{ approved: true }`,
  but never asserts the FILESYSTEM EFFECT. The load-bearing product semantic
  is "APPROVAL ≠ REFUSAL": once the user approves an outside edit, the
  executor DOES write outside.

**File added:** `apps/vscode/src/sdk/__tests__/editor-authorized-external-edit-contract01.test.ts`
(5 tests) — GAP1 outside, GAP1 inside-conservation, GAP2 ASK-with-no-write,
GAP2 explicit-approval⇒write, GAP2 external-ON⇒write.

It drives the REAL classifier and the REAL coordinator
(`../editor-path-authority`, `../sdk-interaction-coordinator`,
`../sdk-message-coordinator`, `../sdk-tool-policies`, `../task-proxy`) and the
**REAL** SDK executor. `@cline/core` is aliased to
`src/test/cline-core-vitest-stub.ts` under the base vitest config, and that
stub **re-exports `createEditorExecutor` directly from**
`sdk/packages/core/src/extensions/tools/executors/editor` — i.e. the production
executor, not a re-implementation.

The 21 disposable triage witnesses from the predecessor ACT were **NOT**
duplicated as permanent tests.

## 7. Executable evidence

| # | Gate | Command | Result |
|---|---|---|---|
| 1 | Original RED | `cd sdk/packages/core && bunx vitest run --config vitest.config.ts <ENTRY_HEAD copy of the suite>` | **3 failed \| 4 passed (7)** — RED_REPRODUCED (`01-original-red-reproduction.txt`) |
| 2 | Corrected SDK suite | `cd sdk/packages/core && bunx vitest run --config vitest.config.ts src/extensions/tools/executors/editor.realpath-authority.test.ts` | **7 passed (7)** — all GREEN (`02-corrected-sdk-suite-green.txt`) |
| 3 | Existing host approval suites | `cd apps/vscode && bunx vitest run --config vitest.config.ts <12 editor host suites>` | **66 passed (66)**, 12 files (`03-host-suites-green.txt`) |
| 4 | Wider tools regression | `cd sdk/packages/core && bunx vitest run --config vitest.config.ts src/extensions/tools` | **682 passed**, 3 failed (the unrelated Bash trio), 105 skipped (`04-...`) |
| 5 | Host typecheck | `cd apps/vscode && bunx tsc --noEmit -p tsconfig.json` | **EXIT=0, zero diagnostics** |
| 6 | SDK core typecheck delta | `cd sdk/packages/core && bunx tsc --noEmit -p tsconfig.json` | **70 before / 70 after — ZERO delta**; the edited file contributes **0** diagnostics |
| 7 | Lint | `cd sdk && bunx biome lint … editor.realpath-authority.test.ts` / `cd apps/vscode && bunx biome lint … editor-authorized-external-edit-contract01.test.ts` | **clean, 0 errors** |

### The 3 unrelated Bash startup-environment failures — classified separately

They live in
`sdk/packages/core/src/extensions/tools/executors/bash.supervised.bash-startup-env.test.ts`:

```text
× `/usr/bin/mktemp` (slash-form AUTO): BASH_ENV sentinel remains empty
× `/usr/bin/mktemp -d`: BASH_ENV sentinel remains empty
× slash-prefixed `/usr/bin/mktemp` still works (slash-bypass composes with the strip)
```

**Classification: PRE-EXISTING and UNRELATED to this ACT.** Evidence: the
file is **untouched** by this ACT, and the SAME 3 failures
(`3 failed | 14 passed (17)`) reproduce **with this ACT's changes stashed
away**. Per the ACT instruction, those tests were **NOT modified**.

## 8. Hygiene

```text
DISPOSABLE FIXTURES ONLY = yes (os.tmpdir() mkdtemp; removed by the suites'
                            own finally / afterEach blocks)
LEFTOVER FIXTURE SWEEP   = no cline-edit-auth-* / contract01-* remained
ARBITRARY REAL FILES TOUCHED = none (the host suite's workspace root is a
                            disposable temp root, not the repository)
PRODUCTION CODE MODIFIED = none
TEST SKIPS / EXCLUSIONS / WEAKENINGS = none (no .skip / .only / xit / todo;
                            grep-verified on both files)
RELATIVE-TRAVERSAL PROTECTION = PRESERVED (case B unchanged and still GREEN)
```

## 9. Files changed (exact)

```text
M sdk/packages/core/src/extensions/tools/executors/editor.realpath-authority.test.ts
A apps/vscode/src/sdk/__tests__/editor-authorized-external-edit-contract01.test.ts
M .factory/epic-board.md
A .factory/evidence/ACT-CLINEMM-EDITOR-REALPATH-TEST-CONTRACT-CORRECTION01/
  00-contract-correction-report.md
  01-original-red-reproduction.txt
  02-corrected-sdk-suite-green.txt
  03-host-suites-green.txt
  04-wider-tools-regression-and-bash-classification.txt
```

No production source file was modified. No `createEditorExecutor` signature,
option, or behavior was changed. No authorization policy was added to the
executor.
