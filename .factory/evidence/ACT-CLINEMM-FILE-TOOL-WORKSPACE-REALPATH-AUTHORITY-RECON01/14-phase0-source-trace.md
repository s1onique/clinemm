# ACT-CLINEMM-FILE-TOOL-WORKSPACE-REALPATH-AUTHORITY-RECON01 / 14-phase0-source-trace

```text
ACT_ID        = ACT-CLINEMM-FILE-TOOL-WORKSPACE-REALPATH-AUTHORITY-RECON01
CYCLE         = 6 (Phase-0 discriminator answered from source)
VERDICT_DELTA = AUTHORITY_VIOLATION = SEMANTICS_BOUND_FROM_SOURCE
                (replaces CYCLE5's PENDING_RUNTIME_POLICY_BIND)
PROD_BIND     = DEFECT IS REAL, CONTRACT IS NOT "DENY EXTERNAL EDIT"
                - IT IS "MAYBE ASK WHEN OUTSIDE, ALLOW WHEN INSIDE"
                - BUT THE CLASSIFIER DOES NOT EXIST IN SOURCE
PREV_HEAD     = 78b6361eb (CYCLE5)
THIS_HEAD     = <to be filled at CYCLE6 commit>
```

## 1. Why this file exists

The Factory reviewer verdict on commit `78b6361eb` (`HALT_APPROVAL_POLICY_IS_NOT_PATH_AUTHORITY`)
mandated a Phase-0 discriminator that must be answered from current ClineMM source
before opening the production ACT:

> inspect current ClineMM editor approval path
> and answer:
>   editFilesExternally=false
>   -> ASK, DENY, or DISABLED?

The expected lattice from upstream guidance was:

```text
INSIDE  workspace  +  irrelevant          -> normal editor policy
OUTSIDE workspace  +  external auto OFF   -> ASK
OUTSIDE workspace  +  external auto ON    -> ALLOW
```

But "source wins." This file is the source trace that pins the ClineMM-specific
contract so the production ACT can target the correct lattice.

## 2. The four-file chain that decides editor-tool authority

```text
[tool input: editor / replace_in_file / write_to_file / apply_patch / delete_file]
     |
     v
1. buildToolPolicies() @ apps/vscode/src/sdk/sdk-tool-policies.ts:56
     -> forces `autoApprove: false` for the 5 edit-tool names
       (line 69: set(["editor", "replace_in_file", "write_to_file",
                      "apply_patch", "delete_file"]))
     -> this means the SDK calls requestToolApproval for EVERY edit
     -> "Edit project files" / "Edit all files" toggles do NOT enable
       `autoApprove: true` here; that field is hard-coded false
     |
     v
2. handleRequestToolApproval() @ apps/vscode/src/sdk/sdk-interaction-coordinator.ts:514-537
     -> legacy non-command path:
         if (request.policy.autoApprove === true ||
             this.options.shouldAutoApproveTool?.(request) === true) {
           return { approved: true }     <- silent ALLOW, no UI
         }
     -> fall-through to `emitV2Capture("approval.ui.branch.v2")`
       -> manual ASK UI
     |
     v
3. shouldAutoApproveTool() -> isToolAutoApproved()
   @ apps/vscode/src/sdk/sdk-tool-policies.ts:1072-1119

   THE LOAD-BEARING LINES FOR EDIT TOOLS (1081-1083):
     if (isEditTool(toolName)) {
       return !!settings.actions.editFiles   <- ONLY editFiles. NEVER editFilesExternally.
     }
     |
     v
4. createEditorExecutor() @ sdk/packages/core/src/extensions/tools/executors/editor.ts:221
     -> resolveFilePath() at lines 42-65
        const resolved = isAbsoluteInput
          ? path.normalize(inputPath)            <- ABSOLUTE: passes verbatim
          : path.resolve(cwd, inputPath)         <- RELATIVE: cwd-joined
        if (!restrictToCwd) return resolved      <- restrictToCwd defaults true
        if (isAbsoluteInput) return resolved     <- EARLY BYPASS - line 56-58
        const rel = path.relative(cwd, resolved)
        if (rel.startsWith("..") || path.isAbsolute(rel)) {
          throw new Error(`Path must stay within cwd: ${inputPath}`)
        }
        return resolved                          <- LEXICAL containment only
     -> fs.mkdir(path.dirname(filePath), { recursive: true })  (line 146)
     -> fs.writeFile(filePath, ..., { encoding })                (line 147)
        <- NO realpath check, NO symlink check, NO workspace-root check
        <- path is whatever resolveFilePath returned
```

## 3. The Phase-0 question, answered from source

> `editFilesExternally=false`
> -> ASK, DENY, or DISABLED?

**Answer: none of the above.** `editFilesExternally` is a no-op in policy code.

The grep `grep -rn 'editFilesExternally' --include='*.ts' apps/ sdk/ webview-ui/`
shows the field is **read ONLY in three places**, none of which gate authority:

| Location | Role |
|---|---|
| `apps/vscode/src/shared/AutoApprovalSettings.ts:18` | Type declaration. Comment: **"Legacy field - kept for backward compatibility with older extension versions"** |
| `apps/vscode/src/shared/AutoApprovalSettings.ts:37` | DEFAULT_AUTO_APPROVAL_SETTINGS defaults to `true` |
| `apps/vscode/src/hosts/vscode/vscode-to-file-migration.ts:301` | One-time migration from VSCode ExtensionContext storage to file-backed store. Persistence only. |
| `apps/vscode/src/sdk/session-auto-approval.ts:236` | Pass-through copy into `SessionAutoApprovalOverride` shape. Persistence only. |
| `proto/cline/state.proto` + generated stubs | gRPC serialization. Wire format only. |

**No code path in ClineMM source branches on the value of `editFilesExternally`.**

The Phase-0 verdict:

```text
editFilesExternally == false   =>  NO POLICY EFFECT
editFilesExternally == true    =>  NO POLICY EFFECT
                                  The "Edit all files" toggle is a
                                  legacy dead UI field; it persists
                                  for backward compat but is invisible
                                  to the runtime authority gate.
```

## 4. What actually decides editor-tool authority

The real contract is `editFiles` ONLY:

```text
editFiles == true   (DEFAULT - see AutoApprovalSettings.ts:36)
  -> editor / replace_in_file / write_to_file / apply_patch / delete_file
  -> isToolAutoApproved returns true
  -> handleRequestToolApproval returns { approved: true } silently
  -> executor runs at fs.writeFile time
     (with the lexical-only containment check in editor.ts:42-65)

editFiles == false
  -> editor / replace_in_file / write_to_file / apply_patch / delete_file
  -> isToolAutoApproved returns false
  -> handleRequestToolApproval falls through to approval.ui.branch.v2
  -> MANUAL ASK UI shown to user
     -> user clicks Approve -> executor runs
     -> user clicks Deny    -> { approved: false } returned,
                              tool result is the denial reason
```

**Neither branch throws, neither branch disables the tool, neither branch
classifies the path.** The path is never even inspected at the policy layer
- the lexical relative-path check in `editor.ts` is the ONLY path
classifier, and it is bypassed for absolute inputs.

## 5. The corrected ClineMM lattice (replaces the upstream-guidance lattice)

| `editFiles` | effective destination | Result |
|---|---|---|
| `true` | any (inside OR outside, lexical OR symlinked, relative OR absolute) | **silent ALLOW -> fs.writeFile** (defense-in-depth is the lexical check ONLY for relative inputs) |
| `false` | any | **MANUAL ASK UI** (path is shown to user as text; no automatic classification either way) |

Two facts:

1. **The path is NOT classified by policy code.** The lexical check in
   `editor.ts:42-65` is the only path-authority primitive that exists,
   and it is bypassed for absolute inputs.

2. **`editFilesExternally` does not exist in the policy lattice at all.**
   It is a no-op legacy field.

## 6. Why the Factory reviewer's lattice does not currently apply

The reviewer wrote:

> | Canonically inside workspace        | irrelevant/project edit enabled | normal editor policy        |
> | Canonically outside workspace       | external auto-approval OFF | **ASK**                     |
> | Canonically outside workspace       | external auto-approval ON  | **ALLOW/AUTO-APPROVE**      |

This lattice requires **two things** that ClineMM source does not currently
have:

(A) A canonical inside/outside classifier that runs at policy time
    (so the ASK-vs-ALLOW decision can branch on it).
    - The lexical `path.relative` in `editor.ts` only runs for relative
      inputs and only at executor time, not policy time.
    - `buildPathAuthorityEvidence` exists for command tools in
      `@cline/core/runtime/command-policy/path-authority-evidence-builder.ts`,
      but it is NOT threaded into the editor-tool policy seam.

(B) An `editFilesExternally` field that is wired into the policy gate.
    - It is NOT wired in. It is a legacy field per the type definition.

So the reviewer's lattice is **not implementable today** without first
introducing (A) - and that is exactly the defect the recon ACT proved
under the name `EDITOR_EFFECTIVE_DESTINATION_CLASSIFICATION_MISSING`.

## 7. The implication for the production ACT

The CYCLE6 corrected production ACT contract:

```text
ACT_NAME = ACT-CLINEMM-EDITOR-EFFECTIVE-DESTINATION-APPROVAL01

SCOPE   = introduce the canonical inside/outside classifier at the
          editor-tool policy seam, AND wire the existing
          editFilesExternally setting into the policy gate
          (so the lattice from section 6 of this file becomes enforceable).

PHASE_0 = bound here (this document):
          editFilesExternally=false currently => no policy effect.
          Must wire it into the policy gate so:
            INSIDE + editFilesExternally=false => existing ASK flow
            INSIDE + editFilesExternally=true  => existing ALLOW flow
            OUTSIDE + editFilesExternally=false => ASK
            OUTSIDE + editFilesExternally=true => ALLOW

PHASE_1 = classifier unit tests (no behavior change yet):
            A inside                       -> INSIDE
            B ../outside                   -> OUTSIDE
            C absolute outside             -> OUTSIDE
            D relative via outside symlink -> OUTSIDE
            E nonexistent outside          -> OUTSIDE
            F canonical inside             -> INSIDE
            H ordinary inside              -> INSIDE

PHASE_2 = policy unit tests (no behavior change yet):
            OUTSIDE + editFilesExternally=false => ASK
            OUTSIDE + editFilesExternally=true  => ALLOW
            INSIDE  + editFilesExternally=false => ASK or ALLOW (per existing editFiles)
            INSIDE  + editFilesExternally=true  => ASK or ALLOW (per existing editFiles)

PHASE_3 = wire the classifier into the policy gate at the
          sdk-interaction-coordinator.ts handleRequestToolApproval seam,
          using the realpath evidence pattern that command tools already
          use (buildPathAuthorityEvidence).

PHASE_4 = flip RED tests to GREEN; ensure the adjacent 13-test
          editor.test.ts suite stays GREEN; run full SDK + apps/vscode
          unit + type checks.

V1_ALGORITHM  = (unchanged from CYCLE5)
                 1. lexical absolute target
                 2. classify lexical containment for fast rejection
                 3. find deepest/nearest existing prefix
                 4. canonicalRoot = realpath(workspaceRoot)
                 5. canonicalExistingPrefix = realpath(existingPrefix)
                 6. require canonicalExistingPrefix ⊆ canonicalRoot
                    for INSIDE classification
                 7. unresolved suffix cannot yet exist (no symlink walk)
                 8. perform mutation

PHYSICAL_ROOT_POLICY = STRICT_PHYSICAL_ROOT (V1 default)
                       - symlink leaving workspace always classifies OUTSIDE
                       - explicit LOGICAL_WORKSPACE_WITH_TRUSTED_SYMLINKS
                         is a future capability, not an accidental
                         symlink escape.

APPLY_PATCH_BOUNDARY = apply_patch shares the SAME classifier and
                       policy seam (same SdkDiffEditCoordinator, same
                       executeEditorTool equivalent executeApplyPatchTool),
                       so conservation in the same ACT is correct.
                       Do NOT widen into a repo-wide path-security rewrite.
```

## 8. Defect name (renamed per Factory reviewer recommendation)

```
EDITOR_EFFECTIVE_DESTINATION_CLASSIFICATION_MISSING
    + EDITFILES_EXTERNALLY_LEGACY_NOOP_DEADCODE
```

Two independent sub-defects:

1. **EDITOR_EFFECTIVE_DESTINATION_CLASSIFICATION_MISSING** - proven by
   the CYCLE5 RED matrix (cases C/D/E). The canonical inside/outside
   classifier does not exist in the editor-tool path.

2. **EDITFILES_EXTERNALLY_LEGACY_NOOP_DEADCODE** - proven by this
   Phase-0 source trace. `editFilesExternally` persists in storage but
   no policy code branches on it. The "Edit all files" UI toggle is
   a dead field.

Both are real defects. Both are bounded to the editor-tool policy
seam. Both are addressable in the same production ACT without
widening scope.

## 9. What was NOT changed by this trace

- No production code touched.
- No tests added (the production ACT will add them in PHASE_1 and PHASE_2).
- No settings or migration code changed.
- The CYCLE5 RED matrix at `editor.realpath-authority.test.ts` is the
  same - it tests `createEditorExecutor` directly, which is the right
  seam regardless of how the policy layer above it evolves.

## 10. Summary

```text
PHASE_0_BIND_FROM_SOURCE = COMPLETE
LIVE_SPECIMEN_E1_E3_POLICY =
  editFilesExternally=true (CURRENT globalState, but session-time
  snapshot NOT preserved -> cannot prove session-time value)
  editFiles=true (DEFAULT, assumed ON unless user toggled OFF;
  session-time snapshot NOT preserved -> cannot prove session-time value)

THUS: LIVE SPECIMENS E1/E3 WERE LIKELY-AUTHORIZED IF AND ONLY IF
      editFiles=true AT SESSION TIME (which is the default).
      editFilesExternally IS NOT A FACTOR EITHER WAY.

DEFECT_1 = EDITOR_EFFECTIVE_DESTINATION_CLASSIFICATION_MISSING
           (classifier absent; absolute paths bypass lexical check)
DEFECT_2 = EDITFILES_EXTERNALLY_LEGACY_NOOP_DEADCODE
           (UI toggle persists but no policy code reads it)
DEFECT_BINDING = both real, both bounded, both addressable in one ACT

PRODUCTION_ACT_NEXT = ACT-CLINEMM-EDITOR-EFFECTIVE-DESTINATION-APPROVAL01
                     (Phase 0 freezes the corrected contract from
                     this file; Phases 1-4 implement per section 7 above)
```
