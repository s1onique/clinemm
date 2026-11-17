# ACT-CLINEMM-EDITOR-REALPATH-AUTHORITY-TRIAGE01

**Repository:** `s1onique/clinemm`  ·  **Branch:** `main`
**ENTRY_HEAD:** `2a8c31bd07065678966ef908af2f3e97e0d6b193`
**Mode:** Bounded reconnaissance and reproduction. No production repair authorized.

## Purpose

Determine whether three pre-existing editor realpath failures represent an
actual workspace-authorization bypass, a mismatch between tests and intended
policy, or a test-environment artifact.

## VERDICT

```
PASS_INTENDED_EXTERNAL_EDIT_CONTRACT
```

## Summary

The three RED failures in
`sdk/packages/core/src/extensions/tools/executors/editor.realpath-authority.test.ts`
(cases C "absolute outside target", D "existing symlink escape", E
"nonexistent descendant of an outside root") are a **test-contract
mismatch**, not an authorization bypass and not an environment artifact.

The suite calls the raw SDK executor `createEditorExecutor()` and asserts
that it must **refuse** out-of-workspace targets. But:

1. The real production contract is **"capability-specific authorized
   writable root"** — not "workspace only". External edits are permitted
   when explicitly authorized via the `editFilesExternally` toggle, which
   ships **ON by default** (`DEFAULT_AUTO_APPROVAL_SETTINGS`) and is **ON**
   in the live installed configuration (`~/.cline/data/globalState.json`).
2. The SDK executor has **no** workspace-authorization concept. Its only
   path option, `restrictToCwd`, is documented as *"Restrict relative-path
   file operations to paths inside cwd. Absolute paths are always accepted
   as-is."* The `cwd` the test passes as `authorizedRoot` is a
   **relative-path resolution base**, not a security boundary.
3. The authorization boundary that DOES exist lives one layer up, in the
   host: `SdkInteractionCoordinator.handleEditorOrApplyPatchApproval` →
   `classifyEditTarget` (realpath) → `evaluateEditAutoApproval` (the 5-row
   lattice) → ASK publishes an approval card and **blocks**; ALLOW invokes
   the executor. The VS Code host forces `autoApprove=false` for the
   `editor` tool (`sdk-tool-policies.ts:69`), so **every** editor call
   traverses that gate.
4. Executably confirmed on the REAL seam: with `editFilesExternally=false`
   an outside target yields **ASK** and **no filesystem effect**; with
   `editFilesExternally=true` it yields **ALLOW**; and with the toggle OFF
   but the **user clicking Approve**, the executor **does** write outside —
   proving that "outside is forbidden" is not the contract.
5. The macOS `/var` ↔ `/private/var` alias is **NOT causal**: a
   discriminating control re-ran the classifier and the executor with the
   aliased root spelling and obtained identical results.

This exact conflict was already adjudicated in the predecessor ACT's
CYCLE7 P1-4 correction: *"Cannot simply flip C/D/E to executor-rejection
GREEN — that encodes 'outside is forbidden', contradicting the upstream
'Edit all files' product contract."* The SDK-side file is the un-split
CYCLE5 RED suite; the split (classifier / policy / executor) was
implemented on the host side by `ACT-CLINEMM-EDITOR-EFFECTIVE-DESTINATION-APPROVAL01`.

## Independent classification of the three failures

| # | geometry | classification |
|---|---|---|
| C | absolute outside write | intentional, explicitly approved external edit |
| D | symlink escape | intentional, explicitly approved external edit |
| E | nonexistent descendant of an outside root | intentional, explicitly approved external edit |

None is an unauthorized escape through the applicable production
authorization path.

## Evidence

`.factory/evidence/ACT-CLINEMM-EDITOR-REALPATH-AUTHORITY-TRIAGE01/`

- `01-reproduction-and-contract.md` — entry identity, RED reproduction,
  the frozen contract, the causal discriminator (D1–D5), independent
  classification, filesystem hygiene.
- `02-executable-transcript.txt` — verbatim test output for the RED
  reproduction and for the disposable causal discriminator (21/21 PASS).

## Files changed by this ACT

```
M  .factory/acts/ACT-CLINEMM-EDITOR-REALPATH-AUTHORITY-TRIAGE01.md      (NEW)
M  .factory/evidence/ACT-CLINEMM-EDITOR-REALPATH-AUTHORITY-TRIAGE01/01-reproduction-and-contract.md  (NEW)
M  .factory/evidence/ACT-CLINEMM-EDITOR-REALPATH-AUTHORITY-TRIAGE01/02-executable-transcript.txt  (NEW)
M  .factory/epic-board.md
```

Production code: **0 changes**. Existing tests: **0 modifications, 0 skips,
0 deletions**. The RED is preserved intact.

## Disposition / successor

A narrowly scoped **test-contract correction** (NOT a production repair) is
the correct successor: split
`sdk/packages/core/src/extensions/tools/executors/editor.realpath-authority.test.ts`
per the CYCLE7 P1-4 shape — move the classifier assertions to the host
classifier, and make the SDK-executor rows assert that an **approved**
outside write **succeeds** while the **relative** traversal escape (case B)
is still refused. That correction is explicitly outside this bounded recon
ACT's scope.
