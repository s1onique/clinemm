# ACT-CLINEMM-FILE-TOOL-WORKSPACE-REALPATH-AUTHORITY-RECON01 / 07-effective-destination-invariant

ENTRY_HEAD             = a917f73a6 (CYCLE3 closure)
HEAD_AT_BINDING        = a917f73a6
branch                 = main
working tree           = dirty at start of CYCLE4 (new test case D added;
                        entry-freeze pending re-write)

## Honest characterization of the editor authority contract

Per Factory causal reviewer verdict on commit `a917f73a6`
(`HALT_AUTHORITY_CONTRACT_NOT_PROVEN`), this file captures the
ground truth for the editor authority contract as it stands
TODAY, before any repair ACT runs. The recon ACT does not
manufacture authority that does not exist; it reports what the
source says.

### What the code-level authority contract DOES say

```text
apps/vscode/src/sdk/vscode-file-read-executor.ts:15-26
  - read_files wrap (ClineMM) — relative paths resolve
    against workspaceRoot, absolute paths DELEGATE WITHOUT
    CHECK (lines 21-23)
  - This is a LEXICAL containment pattern; no realpath
    canonicalization; no symlink guard.

sdk/packages/core/src/extensions/tools/executors/editor.ts:42-65
  - resolveFilePath: restrictToCwd semantic is documented as
    "Absolute paths are always accepted as-is. Cwd
     restriction applies to relative inputs." (JSDoc line 28-33
     + comment line 54)
  - For absolute inputs the closure has an EARLY BYPASS that
    skips path.relative(cwd, resolved) containment entirely.

sdk/packages/core/src/extensions/tools/executors/apply-patch.ts
  - shares the same resolveFilePath shape (conservation).

sdk/packages/core/src/runtime/command-policy/path-authority-evidence.ts
  - WorkspacePathAuthorityEvidence carries realpath of canonical
    roots + operand-level annotations; this substrate is used
    by the SHELL side of command-policy. It is NOT consumed by
    the editor seam today.
```

So at the **code layer**:

1. The ClineMM read seam has partial lexical containment
   (relative only).
2. The editor seam has weaker containment (relative only, with
   even that bypassed for absolute inputs).
3. The apply_patch seam mirrors the editor (conservation).
4. **No code-level invariant currently enforces**
   "editor mutations must remain inside workspace" with
   realpath canonicalization.

### The factory invariant IS partially grounded

EPIC-CLINEMM-FILE-TOOL-WORKSPACE-REALPATH-AUTHORITY01 states:

```text
"Determine whether the file-mutation API surface that the
 model can drive through gRPC / SDK provides a
 containment-boundary guarantee between paths inside the
 configured workspace, and paths outside the workspace."
```

This is the umbrella invariant the recon ACT was opened
against. The LIVE specimens prove the guarantee is BROKEN at
the editor seam (cases C, D, E RED). The reviewer is correct
that the recon ACT does NOT independently prove that the
guarantee was EVER enforced — the epic itself phrases it as a
question, not a contract.

### Disposition

This recon ACT proves:

```text
  PROVEN (LIVE)              editor admits absolute-outside,
                              nonexistent-outside, and
                              lexical-inside-but-effective-
                              outside mutations verbatim
                              (3 distinct defect surfaces
                              against the same seam)

  PROVEN (PRODUCT POLICY)    the user-facing "Edit project
                              files" / "Edit all files"
                              distinction (docs/features/
                              auto-approve.mdx) establishes
                              workspace-only as the
                              DEFAULT and any outside-workspace
                              write as an opt-in escalation
                              (i.e. the user's default
                              expectation is workspace-only)

  PROVEN (CODE PATTERN)      ClineMM has already adopted the
                              principle of workspace-bounded
                              reads (createWorkspaceFileRead
                              Executor at vscode-file-read-
                              executor.ts:15), so the editor's
                              permissive behavior is the
                              ASYMMETRIC EXCEPTION, not the
                              policy

  NOT PROVEN (CODE CONTRACT) no code-level invariant anywhere
                              in apps/vscode/, sdk/, .factory/
                              doctrines, or prior ACTs enforces
                              "editor mutations must remain
                              inside workspace as effective
                              destination" with realpath
                              canonicalization
```

Therefore the next ACT should be classified as one of:

```text
  (a) ACT-CLINEMM-EDITOR-WORKSPACE-AUTHORITY-CONTRACT01
      — explicit contract introduction; freezes the invariant
        as a new durable rule. This is the HONEST framing
        given the gap above.

  (b) ACT-CLINEMM-EDITOR-WORKSPACE-AUTHORITY-IMPLEMENTATION01
      — only AFTER (a) closes with the contract frozen.
        Implements the contract at the seam chosen in Q4.

NOT this (which would overclaim):
  ACT-CLINEMM-FILE-TOOL-AUTHORIZED-ROOT-PATH-AUTHORITY-REPAIR01
    — implies a pre-existing contract violation; that is the
      framing the Factory reviewer correctly rejected on
      commit a917f73a6.
```

### Symlink escape (case D) is a separate defect surface

The recon ACT now also reproduces **case D — existing
symlink escape** as RED. This case is structurally distinct
from cases C and E:

```text
  C. absolute outside target
     -> the path string itself is outside
     -> repair: re-run containment check after normalizing

  E. nonexistent descendant of an outside tree
     -> the parent path string is outside; the file itself is
        absent
     -> repair: containment check before mkdir-recursive

  D. lexical-inside but effective-outside
     -> the path string is inside authorized, but a symlink
        inside authorized redirects to outside
     -> repair: requires fs.realpath canonicalization BEFORE
        containment check (or an O_NOFOLLOW fs.writeFile);
        a LEXICAL-only repair does not close this
```

The factory invariant ("effective destination must remain
inside authorized root") explicitly covers case D. A
LEXICAL-only wrap that only checks `path.relative(cwd, ...)`
would NOT close case D — and the recon ACT's RED on case D
demonstrates this live. The repair ACT must therefore use
**fs.realpath-based canonical containment** (or an
O_NOFOLLOW-equivalent fence at the fs.writeFile boundary),
not pure lexical containment.

This is recorded so the repair ACT's first action includes
picking the canonicalization primitive, not assuming the
existing relative-only check suffices.

### Conservation

```text
  TEMPORARY_EXTERNAL_PATH_AUTHORITY = NOT touched (the
    shell-side substrate is intentionally out of scope; the
    editor is a different surface; widening it would
    conflate command-policy evidence with editor authority)

  Seatbelt                         = NOT touched (Seatbelt
    governs shell, not host-side editor writes; the LIVE
    specimens confirm this — no Seatbelt denial fired for
    the editor tool_use, only for the rm in specimen S2)

  createWorkspaceFileReadExecutor   = NOT touched as part
    of this ACT (its lexical-only pattern is documented but
    not widened here; the conservation pattern of the repair
    ACT will be to mirror the realpath canonicalization
    principle, not to widen its own lexical gap into a
    mutual regression)
```
