# ACT-CLINEMM-EDITOR-EFFECTIVE-DESTINATION-APPROVAL01 / phase0-reconfirmation

```text
ACT_ID       = ACT-CLINEMM-EDITOR-EFFECTIVE-DESTINATION-APPROVAL01
CYCLE        = 1 (Phase 0)
PHASE        = 0  (binding from source; no RED yet)
PARENT_RECON = ACT-CLINEMM-FILE-TOOL-WORKSPACE-REALPATH-AUTHORITY-RECON01
PARENT_HEAD  = 72594d50921fe2527b98d5052e09c74969a88fe1 (CYCLE7)
```

## 0. Purpose

Phase 0 of this production ACT must bind six facts from current
ClineMM source BEFORE any RED test is written. The CYCLE7
reviewer verdict explicitly identified these six as load-bearing
for the contract; this file is the placeholder where each is
filled with the source trace, line numbers, and exact binding.

## 1. The six required reconfirmations

### 1.1 ASYNC_CLASSIFICATION_SEAM

```text
ASYNC_CLASSIFICATION_SEAM = ?
```

Question: where, in the current ClineMM call path, does an
async classification step belong? Most likely candidates
(in priority order from the CYCLE7 reviewer's
"prefer existing async approval/coordinator boundary" rule):

```text
1. apps/vscode/src/sdk/sdk-interaction-coordinator.ts
     handleRequestToolApproval @ line 514-537
   This is the LOWEST existing async seam in the
   approval flow. It receives the SDKToolPolicyRequest,
   has access to the policy.shouldAutoApproveTool hook,
   and can perform async fs observation before
   branching into the silent-ALLOW vs ASK-UI paths.

2. apps/vscode/src/sdk/SdkController.ts
     A coordinator-level option, mirroring
     resolveHostAuthorization + buildPathAuthorityEvidence
     for the command-authority pattern.

3. (Do NOT mutate isToolAutoApproved itself — that is
     almost certainly sync; converting it ripples through
     every tool-approval caller. Per CYCLE7 P1-3.)
```

Source-trace to fill in Phase 0:
- Exact line of `handleRequestToolApproval` entry
- Whether the seam is awaited or fire-and-forget today
- How to thread the immutable evidence carrier across it

### 1.2 EDIT_TOOL_REQUEST_PATH_EXTRACTION

```text
EDIT_TOOL_REQUEST_PATH_EXTRACTION = ?
```

Question: for each edit-tool request, where does the
target-path field live in the input shape? Phase 0 must
answer this BEFORE any RED because the classifier operates
on the extracted path.

```text
Tool             | Input path field | Notes
---------------- | ---------------- | -----
editor           | (bind in Phase 0) | current SDK canonical
replace_in_file  | (bind in Phase 0) | legacy alias?
write_to_file    | (bind in Phase 0) | legacy alias?
apply_patch      | (bind in Phase 0) | multi-target via patch hunks
delete_file      | (bind in Phase 0) | single target
```

Source-trace to fill in Phase 0:
- The TypeScript type definition of each request shape
- Where in the SDK each shape is consumed
- The exact `.path` accessor (or equivalent) the classifier
  will receive

### 1.3 EXTERNAL_POLICY_STORAGE_FIELD

```text
EXTERNAL_POLICY_STORAGE_FIELD = ?
```

Question: where in the current Settings/State model does the
"Edit all files" toggle live, and is it the legacy
`editFilesExternally` field or a new non-legacy field?

```text
Already known from CYCLE6 source trace (parent ACT):
  - apps/vscode/src/shared/AutoApprovalSettings.ts:18
    (type declaration, marked "Legacy field")
  - apps/vscode/src/shared/AutoApprovalSettings.ts:37
    (default value = true)
  - apps/vscode/src/hosts/vscode/vscode-to-file-migration.ts:301
    (persistence migration)
  - apps/vscode/src/sdk/session-auto-approval.ts:236
    (pass-through into SessionAutoApprovalOverride)

Decision this ACT must freeze:
  LEGACY_FIELD_REACTIVATION = deliberate ClineMM
                               compatibility choice
  (NOT a claim upstream currently treats it as live policy;
   per CYCLE7 P1-7)
```

Source-trace to fill in Phase 0:
- Re-confirm the four read sites are unchanged
- Verify no new write site has appeared since 72594d509
- Decide whether to reuse `editFilesExternally` (default
  for smallest migration cost) or introduce a new field
  (cleanest forward path; requires UI surface change)

### 1.4 isToolAutoApproved_sync_OR_async

```text
isToolAutoApproved_sync_OR_async = ?
```

Question: is `isToolAutoApproved()` synchronous or async
in current ClineMM? Per CYCLE7 P1-3, the production ACT
must NOT mutate it to be async.

```text
Already known from CYCLE6 source trace (parent ACT):
  apps/vscode/src/sdk/sdk-tool-policies.ts:1072-1119
    Lines 1081-1083 (load-bearing):
      if (isEditTool(toolName)) {
        return !!settings.actions.editFiles
      }

Verbatim signature (Phase 0 to re-confirm):
  shouldAutoApproveTool(policy: SDKToolPolicy): boolean
    OR
  isToolAutoApproved(toolName: string, ...): boolean
```

Phase 0 binding to fill:
- Exact function signature
- All call sites (must enumerate; converting to async
  ripples through every site)
- Whether the function body uses any `await` (it almost
  certainly does not)

### 1.5 LOWEST_EXISTING_ASYNC_SEAM

```text
LOWEST_EXISTING_ASYNC_SEAM = ?
```

Question: what is the LOWEST existing async seam in the
approval flow where a classifier step can be inserted?

```text
Already known candidates:
  1. apps/vscode/src/sdk/sdk-interaction-coordinator.ts
       handleRequestToolApproval @ 514-537
       (async; returns Promise<ToolApprovalResponse>)
  2. apps/vscode/src/sdk/SdkController.ts
       resolveHostAuthorization (command path, async)
  3. The browser-screenshot / browser-launch path
       (async; reference pattern for evidence acquisition)

Phase 0 must pick the LOWEST one whose existing return type
already accommodates an async-evidence payload. The
handleRequestToolApproval path is the natural candidate.
```

Source-trace to fill in Phase 0:
- The full type signature of the candidate seam
- Whether it already accepts an evidence carrier (it does
  not; that is what this ACT adds)
- The exact insertion point (line number)

### 1.6 isEditTool_members_conserved

```text
isEditTool_members_conserved = ?
```

Question: which edit-tool members share the same request
shape and target-path extraction, and which are legacy
aliases rather than real current runtime tools?

```text
Upstream hint (from CYCLE7 reviewer):
  docs/tools-reference/all-cline-tools.mdx:
    "current SDK runtime uses editor and apply_patch;
     older names (replace_in_file, write_to_file) are
     legacy names"

ClineMM-specific note:
  The set of edit-tool names is hard-coded in
  apps/vscode/src/sdk/sdk-tool-policies.ts:69:
    set(["editor", "replace_in_file", "write_to_file",
         "apply_patch", "delete_file"])
  This is the FULL current ClineMM policy surface.
```

Phase 0 table to fill:

```text
{tool}: REQUEST_SHAPE = ...;
       TARGET_PATH_EXTRACTION = ...;
       POLICY_SEAM_BINDING =
         INCLUDED       (current ClineMM runtime uses it)
       | SUCCESSOR      (current upstream runtime; ClineMM
                         will eventually adopt)
       | UNCHANGED      (legacy alias; do NOT widen)
```

## 2. Phase 0 frozen facts (binding from source — to be filled)

When Phase 0 work begins, the following MUST be filled with
the source trace for each of the six placeholders:

```text
ASYNC_CLASSIFICATION_SEAM          = (file:line + reasoning)
EDIT_TOOL_REQUEST_PATH_EXTRACTION  = (per-tool table)
EXTERNAL_POLICY_STORAGE_FIELD      = (decision + rationale)
isToolAutoApproved_sync_OR_async  = (signature + call sites)
LOWEST_EXISTING_ASYNC_SEAM         = (file:line + insertion point)
isEditTool_members_conserved       = (per-tool binding table)
```

Then RED tests are authored against the bound seams.

## 3. What this Phase 0 file does NOT yet contain

Phase 0 is binding only. It does NOT yet contain:

- The classifier implementation (Phase 1)
- The pure policy function (Phase 1)
- The coordinator wiring (Phase 2)
- The auto-approval branch (Phase 2)
- The necessity-ablation patch (Phase 4)
- Any R1..R5 RED test (Phase 4)
- Any production code change (Phase 4)

This file is the input contract to Phases 1–4, not the
implementation.

## 4. Frozen CYCLE7 corrections carried into Phase 0

The CYCLE7 reviewer's bounded P1 wording correction is
ALREADY APPLIED in the parent ACT file §3 (frozen execution
semantics: "denied approval means executor not invoked"
replaces "non-approved-outside target still refuses").

Phase 0 must preserve this layer distinction throughout the
binding work — specifically:

- The classifier (§1.1, §1.5) is the ONLY async fs layer.
- The policy (§1.4) is the ONLY sync layer that consumes
  the immutable evidence carrier.
- The coordinator (§1.5) is the ONLY layer that decides
  whether to invoke the executor.
- The executor (§1.2, §1.6) is NEVER asked about policy.

These are non-negotiable invariants; Phase 0 binds the seams
that enforce them.
