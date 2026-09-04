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
keyed by file path (apply-patch-parser.ts:46-49). **The classifier
MUST enumerate BOTH the record key (source path) AND any
`PatchAction.movePath` (move destination)** because `movePath` is
a SEPARATE path-bearing field stored alongside the source path
(apply-patch-parser.ts:36 declares `movePath?: string` and line 171
populates it from the `*** Move to:` marker). Iteration of
`Object.keys(patch.actions)` alone would miss the move destination
and produce INCORRECT INSIDE classification for an inside-source →
outside-move patch, defeating the external-edit rule.

**Frozen target enumeration:**

```ts
for each (sourcePath, action) in patch.actions:
    targets += sourcePath
    if action.movePath exists:
        targets += action.movePath
```

This yields a flat `TargetEvidence[]` that the pure policy
function reduces via the aggregation rule below (Phase 0 §2.1).

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
| `editor`          | first-class (canonical schema `EditFileInputSchema`; executor wired in `sdk-diff-edit-coordinator.ts:102`) | `CURRENT INCLUDED SURFACE` |
| `apply_patch`     | first-class (canonical schema `ApplyPatchInputSchema`; executor wired in `sdk-diff-edit-coordinator.ts:104`) | `CURRENT INCLUDED SURFACE` |
| `replace_in_file` | legacy alias (translated by `message-translator.ts:720-724`)         | `LEGACY POLICY NAME`     |
| `write_to_file`   | legacy alias (translated by `message-translator.ts:663-666`)         | `LEGACY POLICY NAME`     |
| `delete_file`     | legacy alias (translated by `message-translator.ts:666`)             | `LEGACY POLICY NAME`     |

**CURRENT INCLUDED SURFACE** conservation proven by this ACT:
  `editor` and `apply_patch` both carry the path-aware evaluation
  implemented in Phases 1-2. R5 conservation ("approved outside
  STILL WRITES") holds for these two tools.

**LEGACY POLICY NAME** conservation NOT yet proven by this ACT:
  `replace_in_file` + `write_to_file` + `delete_file` flow through
  `message-translator.ts` and arrive at the coordinator as a
  translated request whose approval-time shape is OUT OF SCOPE
  for Phase 0 binding. This ACT does NOT claim target-aware
  parity for the three legacy names; it preserves their existing
  behavior. Disposition:

```text
  preserve existing behavior;
  do not claim target-aware parity until their actual
  approval-time translated request shape is executable
  evidence.
```

The previous Phase 0 sentence "All five share the same
classification lattice … R5 conservation therefore holds for
the entire `isEditTool` member set" was TOO BROAD. It has been
corrected to "R5 conservation holds for the CURRENT INCLUDED
SURFACE (`editor` + `apply_patch`) only." This is the
CYCLE1 reviewer P1 (second half) bounded correction.

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

| targets                                | REQUEST_CLASS |
|----------------------------------------|---------------|
| inside + inside                        | INSIDE        |
| inside + outside                       | OUTSIDE       |
| outside + outside                      | OUTSIDE       |
| inside + unavailable                   | UNAVAILABLE   |
| outside + unavailable                  | UNAVAILABLE   |

Implementation: keep per-target `TargetEvidence[]` in
`EditorPathAuthorityEvidence`, then reduce in the pure policy.

**apply_patch movePath cases (load-bearing — frozen from
CYCLE1 reviewer P1, first half):**

The classifier must enumerate BOTH the `Patch.actions` record
key (source path) AND `PatchAction.movePath` (move destination).
A `*** Move to:` patch produces two targets.

| apply_patch shape                         | targets enumerated                 | REQUEST_CLASS |
|-------------------------------------------|------------------------------------|---------------|
| inside update                             | inside                             | INSIDE        |
| inside add                                | inside                             | INSIDE        |
| outside add                               | outside                            | OUTSIDE       |
| inside source → inside move target        | inside + inside                    | INSIDE        |
| inside source → outside move target       | inside + outside                   | **OUTSIDE**   |
| outside source → inside move target       | outside + inside                   | **OUTSIDE**   |
| any target unavailable                    | inside + unavailable (or similar)  | UNAVAILABLE   |
| mixed multi-file inside + outside         | inside + outside                   | OUTSIDE       |

The fifth row is load-bearing: the previous "iterate
Object.keys(patch.actions)" algorithm would have classified
`inside source → outside move target` as INSIDE (missed move
destination) and silently auto-approved an outside write.

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

### 2.4 Evidence carrier (P2) — DO NOT FREEZE AsyncLocalStorage as the carrier

Per the CYCLE1 reviewer's P2, the existing `AsyncLocalStorage`
context inside `handleRequestToolApproval`
(`sdk-interaction-coordinator.ts:344-363`) is the proven async
composition seam, but it is NOT itself the correct evidence
carrier for `EditorPathAuthorityEvidence`. Phase 0 binds only:

```text
handleRequestToolApproval = the lowest usable async composition seam
                             (proven by source trace)
```

Phase 0 does NOT freeze `AsyncLocalStorage` as the storage
location for the evidence carrier. Phase 1-2 will choose the
simplest bounded mechanism the source permits. The preferred
shape (per CYCLE1 reviewer) is:

```text
await classify(request)
    → local immutable evidence variable
    → feed evidence into pure policy
    → pass evidence to coordinator's downstream branches
        via direct local references (NOT ambient async context)
```

Rationale: building ambient ALS infrastructure purely because
ALS happens to exist in the seam is over-engineered. The
evidence flow is local to a single coordinator call, so
plain locals + direct function parameters suffice.

ALS-precondition (NOT frozen): if Phase 1-2 implementation
later needs to thread evidence across an ALS boundary (e.g. to
a downstream tool called outside the coordinator's local
scope), that decision is re-evaluated at Phase 1/2 time with
explicit source evidence; it is NOT pre-committed here.

## 3. Bound contract summary

```text
ASYNC_CLASSIFICATION_SEAM          = apps/vscode/src/sdk/sdk-interaction-coordinator.ts:326
                                      handleRequestToolApproval
EDIT_TOOL_REQUEST_PATH_EXTRACTION  = per-tool table above (1.2)
                                      [apply_patch: actions + movePath both
                                       enumerated; frozen target enumeration
                                       loop at §1.2]
EXTERNAL_POLICY_STORAGE_FIELD      = settings.actions.editFilesExternally
                                      (AutoApprovalSettings.ts:18)
isToolAutoApproved_sync_OR_async   = SYNC (sdk-tool-policies.ts:1072-1077)
LOWEST_EXISTING_ASYNC_SEAM         = apps/vscode/src/sdk/sdk-interaction-coordinator.ts:326
                                      (insertion BEFORE the short-circuit at :510/:521)
isEditTool_members_conserved       = CURRENT INCLUDED SURFACE = editor + apply_patch
                                      LEGACY POLICY NAMES      = replace_in_file +
                                                                 write_to_file +
                                                                 delete_file
                                      (conservation proven only for CURRENT
                                       INCLUDED SURFACE; legacy names preserve
                                       existing behavior with NO target-aware
                                       parity claim from this ACT)
REQUEST_CLASS_AGGREGATION          = per-target TargetEvidence[] reduced by
                                      pure policy; precedence =
                                      UNAVAILABLE > OUTSIDE > INSIDE
                                      (apply_patch movePath cases frozen in §2.1)
EDITOR_PATH_CONTRACT               = ABSOLUTE_ONLY (source-confirmed)
WORKSPACE_ROOT_SOURCE              = getCwd / getWorkspaceRoot (utils/path.ts:106,
                                      SdkController.ts:2310)
EVIDENCE_CARRIER                   = NOT frozen to AsyncLocalStorage; preferred
                                      shape is local immutable variable + direct
                                      function parameter passing (§2.4)
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

## 6. R0 production-seam principal RED — REPRODUCED on real coordinator

Per the reviewer's HALT_RED_BEFORE_IMPLEMENTATION verdict
(opener-receiver CYCLE1 follow-up), the principal RED was
written and executed BEFORE any implementation work. The
reviewer's required causal chain is:

```text
REAL failure
→ RED reproduction
→ causal discriminator
→ implementation
→ GREEN
→ necessity / ablation
→ conservation
```

### R0 file

```text
apps/vscode/src/sdk/__tests__/editor-effective-destination-approval.r0-red.test.ts
```

The test drives the REAL production seam:
- REAL `SdkInteractionCoordinator.handleRequestToolApproval`
- REAL `shouldAutoApproveTool` callback wired exactly as
  production (line 521):
  `(request) => isToolAutoApproved(request.toolName, effective)`
- REAL `isToolAutoApproved` from
  `apps/vscode/src/sdk/sdk-tool-policies.ts:1072-1077`
- REAL filesystem geometry constructed via `realpathSync`,
  `mkdtempSync`, `writeFileSync` (not faked in any mock).

### Filesystem geometry constructed

```text
workspaceRoot = realpathSync(process.cwd())
             = /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm

insideVictim   = ${workspaceRoot}/.factory/tmp/r0-red-inside-victim.txt
              → realpathSync starts with workspaceRoot  ⇒ INSIDE

outsideDir     = mkdtempSync(/tmp/r0-red-outside-XXXXXX)
outsideVictim  = ${outsideDir}/outside-victim.txt
              → realpathSync does NOT start with workspaceRoot ⇒ OUTSIDE

The beforeAll assertion `expect(resolvedOutside.startsWith(workspaceRoot + "/")).toBe(false)`
is the geometric guard that the victim really is OUTSIDE;
if /tmp is symlinked into the workspace on some macOS host the
test refuses to run instead of silently flipping to a false
positive.
```

### Observed result (commit e1016a0e6 + R0 RED uncommitted)

```text
× R0: editor target OUTSIDE workspace + editFiles=true => MUST ASK (currently silently ALLOW) 517ms
✓ R0b: editor target INSIDE workspace + editFiles=true => ALLOW (positive control) 2ms
✓ R0c: editor target OUTSIDE workspace + editFiles=false => ASK (base-disabled control) 53ms

AssertionError: expected [] to have a length of 1 but got +0
  at vi.waitFor timeout (src/sdk/__tests__/editor-effective-destination-approval.r0-red.test.ts:192:78)
```

### Disposition

```text
R0  = RED_REPRODUCED. The silent auto-approval bug is the
       load-bearing production defect. The REAL production
       code path auto-approves an editor request targeting a
       file OUTSIDE the workspace when editFiles=true.

R0b = already GREEN (positive control: inside + editFiles=true
       correctly auto-approves today because isToolAutoApproved
       only consults the editFiles flag, not the target path).

R0c = already GREEN (base-disabled control: editFiles=false
       correctly refuses today; the bug is purely that
       editFiles=true is the single flag for every editor
       request regardless of target).
```

The defect is reproduced THROUGH THE REAL SEAM. No mock or
hand-rolled `shouldAutoApproveTool` substitute was used. The
RED is load-bearing evidence that the production coordinator
+ production `isToolAutoApproved` need a target-aware branch
BEFORE returning `{ approved: true }`.

## 7. Updated phase ordering (per reviewer's HALT_RED_BEFORE_IMPLEMENTATION)

The reviewer's new ordering replaces the previous
"Phase 1 implementation / Phase 4 RED" backwards ordering:

```text
PHASE 1  RED FIRST (R0..R3 reproduced on real seam)        [DONE]
PHASE 2  Bounded repair (classifier + pure policy +
         coordinator wiring + auto-approval branch)         [NEXT, on RED]
PHASE 3  apply_patch movePath + R3/R4 deny/approve/direct
         ALLOW integration + R5 conservation                [POST-REPAIR]
PHASE 4  Necessity ablation                                  [POST-REPAIR]
```

PHASE 2 may NOT begin until this R0 reproduction is recorded
in the production ACT + parent recon evidence + epic board and
the RED commit lands. The reviewer explicitly said "C1: GO
directly into the bounded repair in the same ACT" — that GO
is granted only after the RED has been observed, which is now
done in this commit's RED test (file above).

PHASE 2 is NOT begun in this commit. It is authorized to begin
in the NEXT commit, by the same ACT, with no new planning
commit, no new recon cycle, no more contract review.
