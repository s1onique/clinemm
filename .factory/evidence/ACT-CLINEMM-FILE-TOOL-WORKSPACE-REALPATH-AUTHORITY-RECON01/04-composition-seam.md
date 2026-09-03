# ACT-CLINEMM-FILE-TOOL-WORKSPACE-REALPATH-AUTHORITY-RECON01 / 04-composition-seam

ENTRY_HEAD          = 03af027a9
HEAD_AT_BINDING     = 684356da8
branch              = main
working tree        = clean at ENTRY

## Q4 — Find the lowest authoritative composition seam

The seam must simultaneously know:

  1. the intended authorized writable root(s)
  2. the requested mutation target
  3. enough information to make the authority decision BEFORE
     mutation
  4. (preferably) the same authority substrate the host already
     builds per session so we don't re-derive the workspace
     root in a new way

### Candidates the seam survey identified

```text
A. UI validation
   - chat composer prompt text does not pass through the
     model well enough; UX-only; doesn't enforce the invariant
     for programmatic callers
   - REJECTED.

B. SdkDiffEditCoordinator.executeEditorTool
   (apps/vscode/src/sdk/sdk-diff-edit-coordinator.ts:118-144)
   - already wraps every editor invocation in ClineMM
   - already knows the cwd (closure arg)
   - already has the upstream fallback executor at hand
   - already runs BEFORE fs.writeFile (the executor delegates
     to fallbackEditorExecutor which performs fs.mkdir +
     fs.writeFile internally)
   - shares the seam with apply_patch (Q4 conservation
     applies symmetrically:
     SdkDiffEditCoordinator.executeApplyPatchTool at line 151)
   - KNOWS the workspace root via
     SdkController.getWorkspaceRoot
     (already used in createWorkspaceFileReadExecutor wiring
     at SdkController.ts:1186 and :1261 — same controller,
     same accessor)
   - CHOSEN.

C. SdkController.editorExecutor (the inline closure at
   SdkController.ts:1184 / :1257)
   - functionally equivalent to B but bypasses the
     diff-edit coordinator's preview / approval infrastructure
   - REJECTED (lower leverage than B; bypasses preview)

D. React/webview UX gating
   - REJECTED for the same reason as A.

E. controller/file/* handlers (createSkillFile,
   createRuleFile, etc.)
   - 29 separate file-touching endpoints with their own
     per-tool sanitizers
   - REJECTED for the ACT's bug class (the LIVE specimens
     did not pass through these; they used the SDK's editor
     tool, which is gRPC-routed, not hostcontroller-routed)
```

### Decision

```text
LOWEST_AUTHORITY_SEAM    =
  SdkDiffEditCoordinator.executeEditorTool
CALLERS                  = (1) SdkController.editorExecutor
                          closure at SdkController.ts:1184
                          (the active V2 wiring under the
                          current diagnostic-state
                          architecture); (2)
                          SdkController.editorExecutor
                          closure at SdkController.ts:1257
                          (the v3-/V1-closeout wiring retained
                          as a parallel hook for the legacy
                          runtime path; same body). Both are
                          the only callers of
                          executeEditorTool. Both close over
                          this.diffEdits =
                          new SdkDiffEditCoordinator
                          at SdkController.ts:962.
SHARED_WITH_APPLY_PATCH  = YES  (executeApplyPatchTool at the
                          same SdkDiffEditCoordinator is the
                          apply_patch analog; it shares the
                          fallbackApplyPatchExecutor hook and
                          is delegated to identically by
                          SdkController.applyPatchExecutor at
                          :1185 and :1258). Conservation case
                          in §13 of the ACT contract covers
                          this.
SHARED_WITH_GLOBAL_CONFIG_TOOLS = NO  (the SKILL/rule/hook
                          writers under apps/vscode/src/core/
                          controller/file/* operate on
                          ensureAgentSkillsDirectoryExists(
                            { isGlobal: ...})
                          directly, NOT through this seam.
                          They are an unrelated authority
                          problem and are explicitly out of
                          scope for this ACT per the frozen
                          capability-specific correctness
                          contract.)
```

### Composition seam shape

The chosen seam is structurally a *wrap* in front of
`fallbackEditorExecutor(input, cwd, context)`. The wrap
performs an authority decision against `authorizedRoots`
(== session workspace root, retrieved via
SdkController.getWorkspaceRoot, which already drives the
read_files sibling) BEFORE the call to
fallbackEditorExecutor. That puts the decision one stack
frame above the existing closure, with:

  1. The closure-introduced `cwd` passed to
     fallbackEditorExecutor remains authoritative for the
     existing relative-path semantic.
  2. The new authority check consults the SAME source of
     truth (the workspaceRoot the controller already
     exposes) so the editor and read_files seams cannot
     drift.
  3. The apply_patch conservation is achieved by adding
     the same wrap logic to
     SdkDiffEditCoordinator.executeApplyPatchTool.
  4. Existing diff-preview / approval flow is UNCHANGED —
     the wrap precedes (or rejects before) the fallback,
     not the preview stage.

### Verdict

```text
Q4 STATUS                  = BOUND
LOWEST_AUTHORITY_SEAM      =
  SdkDiffEditCoordinator.executeEditorTool
                            + (conservation)
                            SdkDiffEditCoordinator.executeApplyPatchTool
```

The seam survey explicitly respects ACT §10 ("Do not create
an abstraction unless current source geometry justifies
it."): the wrap is a single new constructor option on
`SdkDiffEditCoordinatorOptions` named
`isEditPathAuthorized` (closure with the same cwd + new
workspaceRoot arg), and is otherwise identical to the
existing preview/fallback pattern that already exists in
this seam.

Continue to Q5: RED matrix against the production seam.
