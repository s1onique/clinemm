# ACT-CLINEMM-FILE-TOOL-WORKSPACE-REALPATH-AUTHORITY-RECON01 / 02-authorized-root

ENTRY_HEAD          = 03af027a9
HEAD_AT_BINDING     = 684356da8
branch              = main
working tree        = clean at ENTRY

## Q2 — Freeze the LIVE tool's authority contract

```text
TOOL_ID                  = editor
AUTHORITY_PRODUCER       = upstream SDK contract documented at
                            SDK-PACKAGES-CORE-EXTENSIONS-TOOLS-
                            DEFINITIONS.TS line 914:
                            "An editor for controlled filesystem
                             edits on the text file at the
                             provided path."
                          and reinforced in the ClineMM wiring
                          at SdkController.ts:2193 where
                          workspacePath (== cwd) is the
                          workspace root used for sibling
                          authority-bearing subsystems.
AUTHORIZED_ROOTS         = (live spec holds ONE root, the
                          session cwd = session workspaceRoot):
                              /Volumes/UserData/Users/chistyakov/
                              Projects/Runity/srs
                          (== workspaceRoot from
                          SdkController.cwd derivation, line
                          2193 and identical to session cwd at
                          messages.metadata.cwd).
ROOT_CARDINALITY         = 1  (single workspace; no multi-root
                              ClineMM harness in this scope; the
                              authority substrate is
                              WorkspacePathAuthorityEvidence,
                              which CAN carry multiple canonical
                              roots but in this LIVE specimen
                              carried just the one above).
ROOT_LIFETIME            = SESSION_SCOPED  (frozen at session
                              start, refreshed by VS Code
                              workspace-root changes; authority
                              has never been observed to grow
                              during a session).
ROOT_SOURCE_QUALITY      = LIVE  (verbatim from the session
                              metadata at the LIVE specimen's
                              own sessionId).
```

## Where the authority root is consumed today

```text
editor tool (EXECUTION side):
  - SDK default: createEditorExecutor() in
    sdk/packages/core/src/extensions/tools/executors/editor.ts:221
  - The executor's resolveFilePath(cwd, input.path, true) at
    line 235 receives cwd from the SDK tool definition:
    createEditorTool(cwd = config.cwd ?? process.cwd()) at
    definitions.ts:909; but the executor at line 56-58 explicitly
    bypasses restrictToCwd for path.isAbsolute(input.path).
  - ClineMM's wiring in SdkController.ts:1184 / :1257 replaces
    the default with the SdkDiffEditCoordinator; the coordinator
    also bypasses the same default (options.fallbackEditorExecutor
    ?? createEditorExecutor() at line 86, with no path
    containment layer above it). The cwd is the workspaceRoot,
    but the workspaceRoot is NOT consulted for authority.

sibling tools (AUTHORITY side, NOT this ACT's subject):
  - read_files: already wrapped by
    createWorkspaceFileReadExecutor()
    (apps/vscode/src/sdk/vscode-file-read-executor.ts:15);
    relative paths resolve against workspaceRoot but absolute
    paths STILL bypass containment (lines 21-23). This is a
    CONSERVATION surface but is treated here as a sibling for
    a future ACT, NOT widened into this one.
  - apply_patch: shares the same resolveFilePath shape as
    editor (see sdk/packages/core/src/extensions/tools/
    executors/apply-patch.ts:46-63); ClineMM wires the same
    SdkDiffEditCoordinator fallback at lines 168 +
    sdk-diff-edit-coordinator.ts:86. CONSERVATION case under
    Q4.

seatbelt (RUNTIME CONFINEMENT, NOT this ACT's subject):
  - seatbelt only governs shell, not host-side file writes
    performed by the editor tool. Confirmed by the LIVE
    specimens: specimens E1 and E3 produced host-side file
    writes outside the workspace; no Seatbelt denial was
    returned for those tool calls (Seatbelt denial only
    appeared in specimen S2's rm, which is a shell
    command).
```

## Authorized-root vs. observed target

```text
LIVE_TARGET_AUTHORIZED     = NO  (the target /Volumes/.../Runtime/srs
                                 is OUTSIDE the LIVE authorized
                                 root /Volumes/.../Runity/srs;
                                 the two share the parent
                                 /Volumes/.../Projects/ but
                                 DIFFER in the second segment)
PASS_LIVE_MUTATION_AUTHORIZED = (not applicable; this is
                                       NOT the case-G conservation
                                       path; the LIVE mutation
                                       IS a capability-root escape)
```

The two authorized/observed targets share a parent under
`/Volumes/UserData/Users/chistyakov/Projects/` — this rules
out a bare "lexical traversal escape" reading (no `..` was
involved) and confirms the production seam admits the
absolute path as-is.

## Verdict

```text
Q2 AUTHORIZED_ROOTS        = [/Volumes/UserData/Users/chistyakov/
                              Projects/Runity/srs]
LIVE_TARGET_AUTHORIZED     = NO
Q2 STATUS                  = BOUND
```

Continue to Q3/Q4 with this contract as the basis for the
RED matrix.
