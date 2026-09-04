# ACT-CLINEMM-FILE-TOOL-WORKSPACE-REALPATH-AUTHORITY-RECON01 / 07-effective-destination-invariant

ENTRY_HEAD             = a917f73a6 (CYCLE3 closure)
HEAD_AT_BINDING        = a917f73a6
branch                 = main
working tree           = dirty at start of CYCLE4 (new test case D added;
                        entry-freeze pending re-write)

## Honest characterization of the editor authority contract

Per Factory causal reviewer verdicts on commits `a917f73a6`
(CYCLE4: `HALT_AUTHORITY_CONTRACT_NOT_PROVEN`) and `cf84c996e`
(CYCLE5: `PASS_WITH_ONE_BOUNDED_P1 — C1: GO`), this file
captures the ground truth for the editor authority contract as
it stands TODAY, before any repair ACT runs. The recon ACT
does not manufacture authority that does not exist; it reports
what the source says.

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

## CYCLE5 addition (2026-09-04) — runtime policy bind

### Effective edit authority at session time

```text
~/.cline/data/globalState.json (current; modified 2026-09-04 03:00,
3 days AFTER session end at 2026-09-01 10:32):

  autoApprovalSettings = {
    "enabled": true,
    "actions": {
      "readFiles": true,
      "readFilesExternally": true,
      "editFiles": true,
      "editFilesExternally": true,    <-- "Edit all files" ON
      "executeSafeCommands": true,
      "executeAllCommands": true,
      "useBrowser": false,
      "useMcp": true
    }
  }
```

The current global state shows `editFilesExternally: true` —
the user's "Edit all files" toggle is ON. The file was last
modified 3 days after the session ended; durable backup of the
prior state was not preserved. **However**:

- The user is the same person.
- No contradictory session-time evidence survives (the
  session messages have no autoApproval snapshot, and the
  workspace state file for the Runity/srs workspace only
  carries workflow toggles, not auto-approve settings).
- The current setting represents the user's durable intent.

Therefore the most-likely effective runtime policy at session
time was:

```text
EFFECTIVE_EDIT_PROJECT_FILES     = true
EFFECTIVE_EDIT_ALL_FILES         = true
SESSION_OVERRIDE                 = none observed
```

Under that effective policy, the LIVE specimens E1 and E3
were **WITHIN the user's effective authority** — the user
had explicitly opted in to outside-workspace editing via the
"Edit all files" toggle. The mutations were authorized at the
policy layer.

### What the recon ACT actually proves (final, post-CYCLE5)

```text
PROVEN    editor seam has NO built-in workspace bound;
          admits absolute-outside, nonexistent-outside, and
          lexical-inside-but-effective-outside mutations
          verbatim (3 distinct defect surfaces against the
          same seam).

PARTIALLY the user's effective policy at session time was
PROVEN    MOST-LIKELY "Edit all files" = ON (current global
          state shows ON; durable session-time snapshot not
          preserved). Under that policy the LIVE mutations
          E1/E3 were authorized, NOT violations.

NOT       the LIVE mutations were policy violations (only
PROVEN    likely-authorized). The seam permissiveness is
          still a real defect (an opt-out user would have
          been unprotected), but the LIVE evidence does
          not prove opt-out failure.

NOT       any pre-existing code-level invariant enforcing
PROVEN    workspace-only mutation (none exists today).
```

### Corrected V1 contract (closes all three surfaces)

The recon ACT now also records the **correct** V1 contract
algorithm (from Factory reviewer on `cf84c996e`):

```text
EDITOR WORKSPACE AUTHORITY V1

When the effective editor capability is workspace-bounded
(i.e. the user's "Edit all files" toggle is OFF, OR a
ClineMM policy equivalent scopes edits to workspace):

  every editor mutation's effective filesystem destination
  MUST remain beneath one canonical authorized workspace
  root.

Containment is evaluated against:

  realpath(authorized root)
  +
  realpath(nearest existing ancestor of the target)

for newly-created targets (because realpath(target) would
ENOENT for legitimate create targets like
workspace/new/deep/file.ts).

V1 algorithm (closes C, D, E; preserves A, B, F, H):

  canonicalRoot = realpath(authorizedRoot)   // existing

  target        = normalize/resolve the
                  requested path (absolute or relative)

  1. lexical containment against authorizedRoot
     -> rejects cases C, E immediately

  2. walk target upward until an existing ancestor is
     found (the longest prefix that already exists on
     disk)

  3. canonicalAncestor = realpath(existingAncestor)

  4. require canonicalAncestor starts with canonicalRoot
     (with the path-separator boundary check; do not
     match /authX when authorized is /auth)

  5. require any symlink component in the unresolved
     suffix does not redirect outside canonicalRoot
     (this is the case-D closure step; without it,
     a symlink one level below an existing ancestor
     would still escape)

  6. perform the mutation

V1 DOES NOT claim race-safe mutation against an attacker
who changes the directory topology between step 5 and
step 6 (TOCTOU). That is a separate bounded hardening if
warranted; it is explicitly out of scope for this ACT.

V1 DOES NOT claim to handle `O_NOFOLLOW` semantics — the
final file being a symlink is not itself the defect; the
defect is a parent-chain symlink that redirects the OS
lookup at fs.writeFile time. `O_NOFOLLOW` would refuse
to write through a final-file symlink, which is a
different and narrower invariant.
```

### Corrected defect classification (CYCLE5)

The CYCLE3 label `CASE_E_WRONG_AUTHORIZED_ROOT` was
inaccurate: cwd IS present and correct; the defect is not
a wrong base. The corrected encompassing class is:

```text
EDITOR_EFFECTIVE_DESTINATION_AUTHORITY_MISSING

  sub-case C: ABSOLUTE_CONTAINMENT_BYPASS
    (absolute input skips path.relative(cwd, resolved)
     containment test)

  sub-case D: EFFECTIVE_DESTINATION_CANONICALIZATION_MISSING
    (no fs.realpath canonicalization on existing ancestors,
     so a symlink inside authorizedRoot can redirect the
     effective destination outside)

  sub-case E: ABSOLUTE_CONTAINMENT_BYPASS (same as C,
     target happens to be nonexistent so the mkdir-recursive
     also fails the constraint)
```

Sub-cases C and E share the same root cause (absolute
containment bypass) but manifest differently because
of the existing-ancestor lookup timing. Sub-case D is a
separate root cause that requires canonical containment
(realpath on existing ancestors) to close, NOT lexical
containment alone.

Historical CYCLE3/CYCLE4 evidence retains the original
labels for traceability; the implementation ACT will use
the corrected classification.

### Updated handoff (CYCLE5)

The CYCLE4 proposal of `CONTRACT01 + IMPLEMENTATION01` is
**collapsed** into one bounded production ACT per Factory
reviewer's discipline note ("Factory exists to increase
learning speed, not turn every invariant into an ACT"):

```text
ACT-CLINEMM-EDITOR-WORKSPACE-EFFECTIVE-DESTINATION-AUTHORITY01

  Phase 0 (in ACT body, not a separate ACT):
    freeze the V1 contract above

  Phase 1:
    author one bounded production fix at the Q4 seam
    (SdkDiffEditCoordinator.executeEditorTool +
    symmetric executeApplyPatchTool for conservation)
    using the V1 algorithm

  Phase 2:
    flip case C, D, E from RED to GREEN in
    editor.realpath-authority.test.ts while keeping
    A, B, F, H GREEN
    confirm adjacent editor.test.ts (13 tests) remains
    GREEN
    necessity ablation: temporarily disable the wrap ->
    C, D, E return to RED; restore

  Phase 3:
    dogfood + LIVE qualify on a disposable target
    verify auto-approve settings interaction:
      - "Edit project files" + outside write -> refused
      - "Edit all files"     + outside write -> allowed
        (the wrap must NOT masquerade as the broader
         policy; it must reflect the effective capability)

  Phase 4:
    apps/vscode typecheck + targeted lint +
    git diff --check silent
```

`apply_patch` conservation: the implementation ACT must
answer the question "does model-driven apply_patch go
through SdkDiffEditCoordinator or the exact same
canonical-authority primitive?" If yes, conservation
test in the same ACT. If no, record a successor ACT
(`ACT-CLINEMM-APPLY-PATCH-WORKSPACE-AUTHORITY01`) and
do NOT expand scope opportunistically.
