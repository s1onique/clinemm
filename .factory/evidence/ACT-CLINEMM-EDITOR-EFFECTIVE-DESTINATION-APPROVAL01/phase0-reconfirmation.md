# ACT-CLINEMM-EDITOR-EFFECTIVE-DESTINATION-APPROVAL01 / phase0-reconfirmation

```text
ACT_ID       = ACT-CLINEMM-EDITOR-EFFECTIVE-DESTINATION-APPROVAL01
CYCLE        = 1 (Phase 0)
PHASE        = 0  (binding from source; no RED yet)
PARENT_RECON = ACT-CLINEMM-FILE-TOOL-WORKSPACE-REALPATH-AUTHORITY-RECON01
PARENT_HEAD  = 72594d50921fe2527b98d5052e09c74969a88fe1 (CYCLE7)
ENTRY_HEAD   = 148e30c176b97ab1cf48086d7e1a42ef9dc33949 (CYCLE1 opener)
```

## 0. Purpose

Phase 0 binds six reconfirmations from current ClineMM source
BEFORE any RED test is written. Per Factory reviewer verdict on
CYCLE7 (commit 72594d509) and per the subsequent PRODUCTION-ACT
reviewer (PASS_WITH_NO_NEW_P1_AT_C1_GO), these are the only
facts this ACT requires before RED.

## 1. Six bound reconfirmations

### 1.1 ASYNC_CLASSIFICATION_SEAM — BOUND

```text
ASYNC_CLASSIFICATION_SEAM = apps/vscode/src/sdk/sdk-interaction-coordinator.ts:326-373
                            handleRequestToolApproval(request: ToolApprovalRequest)
                            → Promise<{ approved, decision?, ... }>
```

- This is the LOWEST async seam in the editor-tool approval flow
  on the current ClineMM source. It runs before any `shouldAutoApproveTool`
  call inside `runRequestToolApproval` (lines 375+, the private worker).
- Already returns a Promise; already builds an immutable
  correlationId + commandDigest AsyncLocalStorage context (lines
  344-363) — the natural place to attach the immutable
  `EditorPathAuthorityEvidence` carrier produced by the async
  classifier.
- The classifier is called AWAITED before the synchronous
  `request.policy.autoApprove === true || shouldAutoApproveTool?.(request) === true`
  short-circuit at `sdk-interaction-coordinator.ts:521`.

### 1.2 EDIT_TOOL_REQUEST_PATH_EXTRACTION — BOUND

Source: `sdk/packages/core/src/extensions/tools/schemas.ts`.

| tool              | input shape (source line)            | target-path extraction | multi-target? |
|-------------------|--------------------------------------|------------------------|---------------|
| `editor`          | `EditFileInputSchema` (lines 200-227)| `input.path` (absolute) | NO            |
| `replace_in_file` | legacy alias — schema not in @cline/core; flows through message-translator (apps/vscode/src/sdk/message-translator.ts:720-724) which converts to `editor` shape | via translator | NO            |
| `write_to_file`   | legacy alias — same translator path | via translator | NO            |
| `apply_patch`     | `ApplyPatchInputSchema` (lines 235-246) `{ input: "<patch body>" }` | parse via `PatchParser` (sdk/packages/core/src/extensions/tools/executors/apply-patch-parser.ts:85-108); one absolute path per `*** Update File: <path>` / `*** Add File: <path>` / `*** Delete File: <path>` / `*** Move to: <new path>` header (PATCH_MARKERS, apply-patch-parser.ts:7-16) | YES — multi-target |
| `delete_file`     | legacy alias — schema not in @cline/core | via translator | NO            |

The `apply_patch` parser produces `Patch.actions: Record<string, PatchAction>`
keyed by file path (apply-patch-parser.ts:46-49). The classifier
iterates this record to produce a `TargetEvidence[]`.

### 1.3 EXTERNAL_POLICY_STORAGE_FIELD — BOUND

```text
EXTERNAL_POLICY_STORAGE_FIELD = settings.actions.editFilesExternally
                                (apps/vscode/src/shared/AutoApprovalSettings.ts:18,
                                 legacy field per upstream, preserved as
                                 passthrough by apps/vscode/src/sdk/
                                 session-auto-approval.ts:236)
```

- The current `AutoApprovalSettings` shape carries
  `editFilesExternally?: boolean` as an OPTIONAL legacy field
  (default true; never consulted by `isToolAutoApproved` at
  `sdk-tool-policies.ts:1072-1119`).
- Phase 0 binding: REACTIVATE `editFilesExternally` as the
  active "external edit auto-approval" semantic for ClineMM.
  This is `LEGACY_FIELD_REACTIVATION` per the production ACT
  §0 — a deliberate ClineMM compatibility choice, not an
  upstream-enforced field.

### 1.4 isToolAutoApproved_sync_OR_async — BOUND

```text
isToolAutoApproved_sync_OR_async = SYNC
```

- Signature (`sdk-tool-policies.ts:1072-1077`):

  ```ts
  export function isToolAutoApproved(
      toolName: string,
      settings: AutoApprovalSettings,
      mcpHub?: McpHub,
      override: SessionAutoApprovalOverride = "none",
  ): boolean
  ```

- The function returns a plain `boolean`, is invoked SYNC at
  every call site, and is the live gate that
  `SdkController.shouldAutoApproveTool` (SdkController.ts:996-1015)
  threads into the non-command auto-approval branch.
- Per CYCLE7 P1-3: do NOT mutate this signature to async. It
  ripples through every non-command approval caller.
- The async classifier feeds an immutable evidence carrier
  (passed alongside `request`) into the existing sync policy
  evaluation; the policy itself stays sync.

### 1.5 LOWEST_EXISTING_ASYNC_SEAM — BOUND

```text
LOWEST_EXISTING_ASYNC_SEAM = apps/vscode/src/sdk/sdk-interaction-coordinator.ts:326
                             (handleRequestToolApproval, full signature above)
```

- Already async (Promise<>).
- Already captures the request context with AsyncLocalStorage
  (lines 339-345) — the natural mechanism to thread an
  immutable evidence carrier across the synchronous policy
  evaluation that follows.
- Insertion point for the async classifier call: BEFORE the
  command-vs-non-command branch (line 346) and BEFORE the
  existing short-circuit at line 510/521. The classifier
  needs the request's toolName + input to enumerate targets,
  and it must run before the sync policy evaluation reads the
  evidence carrier.

### 1.6 isEditTool_members_conserved — BOUND

```text
isEditTool_members_conserved =
  current full set, classified honestly against current ClineMM runtime surface
```

The hard-coded set lives at `apps/vscode/src/sdk/sdk-tool-policies.ts:69`
and `apps/vscode/src/sdk/sdk-tool-policies.ts:91-93`:

```ts
set(["editor", "replace_in_file", "write_to_file", "apply_patch", "delete_file"])
```

| tool              | current ClineMM runtime surface | classification          |
|-------------------|---------------------------------|-------------------------|
| `editor`          | first-class (canonical schema `EditFileInputSchema`; executor wired in `sdk-diff-edit-coordinator.ts:102`) | `INCLUDED`     |
| `apply_patch`     | first-class (canonical schema `ApplyPatchInputSchema`; executor wired in `sdk-diff-edit-coordinator.ts:104`) | `INCLUDED`     |
| `replace_in_file` | legacy alias (translated by `message-translator.ts:720-724`)         | `SUCCESSOR`    |
| `write_to_file`   | legacy alias (translated by `message-translator.ts:663-666`)         | `SUCCESSOR`    |
| `delete_file`     | legacy alias (translated by `message-translator.ts:666`)             | `SUCCESSOR`    |

All five share the same classification lattice; the legacy
aliases simply route through the same path after translation.
R5 conservation therefore holds for the entire `isEditTool`
member set, including the legacy aliases — the auto-approval
decision and path-authority classification applied to the
translated request do not change as a function of the original
tool name.

## 2. Additional CYCLE1 opener-receiver invariants

### 2.1 Multi-target aggregation (P1)

Per the opener-receiver reviewer's P1, `apply_patch` carries
multiple targets per request. The request-level aggregation is:

```text
REQUEST_CLASS =
  unavailable  if ANY target is unavailable
  outside      else if ANY target is outside
  inside       otherwise
```

Truth table:

| targets                          | REQUEST_CLASS |
|----------------------------------|---------------|
| inside + inside                  | INSIDE        |
| inside + outside                 | OUTSIDE       |
| outside + outside                | OUTSIDE       |
| inside + unavailable             | UNAVAILABLE   |
| outside + unavailable            | UNAVAILABLE   |

Implementation: keep per-target `TargetEvidence[]` in
`EditorPathAuthorityEvidence`, then reduce in the pure policy.

### 2.2 EDITOR_PATH_CONTRACT (P2)

```text
EDITOR_PATH_CONTRACT =
  ABSOLUTE_ONLY  // confirmed by ClineMM source (EditFileInputSchema
                 // docstring at schemas.ts:205) — NOT solely by
                 // upstream documentation
```

The current `EditFileInputSchema` (schemas.ts:200-227) describes
`path` as `"The absolute path for the action to be performed on"`.
The current `apply-patch` parser and `editor.ts`/`apply-patch.ts`
executors also accept absolute paths directly (resolveFilePath at
executors/editor.ts:42-65 and executors/apply-patch.ts:59-77).

A relative path is rejected by the executor's own
`path.relative(cwd, resolved).startsWith("..")` check (line 73
in both executors) BEFORE classification runs. Phase 0 treats
`EDITOR_PATH_CONTRACT = ABSOLUTE_ONLY` as a ClineMM-source-
confirmed invariant, NOT as an upstream-derived assumption.

### 2.3 Workspace root source

```text
WORKSPACE_ROOT_SOURCE = apps/vscode/src/utils/path.ts:106-109 getCwd()
                        (HostProvider.workspace.getWorkspacePaths())
                        OR apps/vscode/src/sdk/SdkController.ts:2310-2323
                        getWorkspaceRoot() (async; uses lastKnownWorkspaceRoot cache)
```

The classifier must consume the workspace root from the same
source the executors consume it (`resolveFilePath(cwd, inputPath,
restrictToCwd)`). On the canonical-realpath containment
predicate, see the production ACT §5.

## 3. Bound contract summary

```text
ASYNC_CLASSIFICATION_SEAM          = apps/vscode/src/sdk/sdk-interaction-coordinator.ts:326
EDIT_TOOL_REQUEST_PATH_EXTRACTION  = per-tool table above (1.2)
EXTERNAL_POLICY_STORAGE_FIELD      = settings.actions.editFilesExternally
                                      (AutoApprovalSettings.ts:18)
isToolAutoApproved_sync_OR_async   = SYNC (sdk-tool-policies.ts:1072-1077)
LOWEST_EXISTING_ASYNC_SEAM         = apps/vscode/src/sdk/sdk-interaction-coordinator.ts:326
                                      (insertion BEFORE the short-circuit at :510/:521)
isEditTool_members_conserved       = 5-member set, INCLUDED for editor/apply_patch,
                                      SUCCESSOR for replace_in_file/write_to_file/delete_file
REQUEST_CLASS_AGGREGATION          = outside-precedence; UNAVAILABLE dominates OUTSIDE
EDITOR_PATH_CONTRACT               = ABSOLUTE_ONLY (source-confirmed)
WORKSPACE_ROOT_SOURCE              = getCwd / getWorkspaceRoot (utils/path.ts:106,
                                      SdkController.ts:2310)
```

## 4. What Phase 0 does NOT yet contain

- Classifier implementation (Phase 1)
- Pure policy function (Phase 1)
- Coordinator wiring (Phase 2)
- Auto-approval branch (Phase 2)
- Necessity-ablation patch (Phase 4)
- Any R1..R5 RED test (Phase 4)
- Any production code change (Phase 4)

Phase 0 is the input contract to Phases 1-4, not the implementation.

## 5. CYCLE7 corrections carried into Phase 0

The CYCLE7 reviewer's bounded P1 wording correction is ALREADY
APPLIED in the production ACT §3: "denied approval means executor
not invoked" replaces "non-approved-outside target still refuses".

The opener-receiver reviewer's two follow-up corrections (P1
multi-target aggregation; P2 source-confirmed ABSOLUTE_ONLY)
are now bound in §2.1 and §2.2 above.

Layer invariants (non-negotiable throughout Phases 1-4):
- CLASSIFIER (§1.1, §1.5) is the ONLY async fs layer.
- POLICY (§1.4) is the ONLY sync layer that consumes the
  immutable evidence carrier.
- COORDINATOR (§1.5) is the ONLY layer that decides whether
  to invoke the executor.
- EXECUTOR (§1.2, §1.6) is NEVER asked about policy.
