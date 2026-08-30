# ACT-CLINEMM-UPSTREAM-SYNC-RECON01 — RECOMMENDATION

```
VERDICT          = PASS_UPSTREAM_SYNC_RECON
SYNC_PRIORITY    = HIGH
WHY              = Upstream has materially changed the four seams that
                   overlap ClineMM's open investigations:
                   (1) completion authority (c870116d1, 80dd57315),
                   (2) resume/restore/session-status (b9efa9682,
                       eef7958ca, 9cf60cd43, fed502e3c),
                   (3) checkpoint restore race protection (89c2efa97),
                   (4) MCP approval simplification (2b7b01328).
                   Continuing local causal work first has worse
                   SPEED × CORRECTNESS because upstream has already
                   replaced or supplied the seams ClineMM was about
                   to investigate.
NEXT_ACT         = ACT-CLINEMM-UPSTREAM-SYNC-INTEGRATION01
```

## Identity (SOURCE_PROVEN)

```
ENTRY_HEAD       = 60a99d2bd3e579b2ed7202d913f372bd6376688c
ENTRY_TREE       = 4e7c1b7c2420f18523847dd2d84e6a1bda59b7e4
BRANCH           = main
WORKTREE_STATUS  = CLEAN
PROTECTED_STASHES_PRESERVED = 2  (untouched, did NOT pop/drop)
UPSTREAM_REMOTE  = https://github.com/cline/cline.git (upstream)
UPSTREAM_HEAD    = 48d63852745460ff0fa3dfcc0457bbe2493841de
UPSTREAM_TREE    = 14500ceda6208e38fc6cf2289efd5156d44ca46e
MERGE_BASE       = ad442cbb6a81d21773ceabc1398ea5eb58170718
LOCAL_ONLY_COMMITS    = 905
UPSTREAM_ONLY_COMMITS = 177
RECON_SUBJECT_HEAD    = 48d63852745460ff0fa3dfcc0457bbe2493841de
                       (P1 bounded correction: pin upstream by SHA;
                        successor must merge THIS exact object,
                        not an implicitly-moving upstream/main.
                        See §"Drift-handling policy" for how drift is
                        logged-but-not-fatal.)
RECON_SUBJECT_TREE    = 14500ceda6208e38fc6cf2289efd5156d44ca46e
```
## Counts

```
UPSTREAM_FILES_CHANGED    = 764
CLINEMM_FILES_CHANGED     = 1058 (incl. .factory/, tools/factory/)
INTERSECTION_COUNT        = 55  (file-diff intersection via `comm -12`)
CHANGED_IN_BOTH_COUNT     = 54  (merge-tree section; 1 less than
                                 INTERSECTION_COUNT because the add/add
                                 test file is reported separately by
                                 merge-tree. See conflict-preview.txt
                                 §"55-vs-54 NOTE".)
CONFLICT_FILES            = 17  (merge-tree --write-tree; authoritative)
AUTO_MERGE_FILES          = 38  (= 55 - 17, intersection minus conflicts)
BASE_PRESENT_CONFLICTS    = 16  (CONFLICT (content) entries)
ADD_ADD_CONFLICTS         = 1   (useProviderUsageCostDisplay.test.ts)
MECHANICAL_CONFLICTS      = 6
SEMANTIC_CONFLICTS        = 7
SECURITY_CRITICAL_CONFLICTS = 4  (state.proto, SdkController.ts,
                                   bash.ts, sdk-tool-policies.ts)
FACTORY_ONLY_CONFLICTS    = 0   (factory files do not intersect upstream)
GENERATED_CONFLICTS       = 0   (class removed in P1 bounded correction;
                                   the add/add test is now SEMANTIC)
```

The taxonomy uses **four classes**: `MECHANICAL`, `SEMANTIC`, `SECURITY_CRITICAL`, `FACTORY_ONLY`. See `conflict-classification-README.md` for the reconciliation history.

## Open lane impact (per ACT §20 reprioritization)

| Lane | Status vs upstream | Next action |
|------|---------------------|-------------|
| COMPLETION_AUTHORITY | **UPSTREAM_SUPERSEDED** | Reorient NEXT = `SEATBELT-YOLO-COMPLETION-AUTHORITY-IMPLEMENTATION01` to adopt upstream `emitTaskCompletedOnTeardown`; do not hand-wire task.completed path |
| QPSR_RSR (PARKED) | **UPSTREAM_SUPERSEDED** | Do NOT reopen RSR — upstream closes the four core seams. Add a separate upstream-tracking ACT only if the post-merge qualification surfaces a residual |
| EDITOR_TOOL_APPROVAL_FRICTION | **UPSTREAM_PARTIALLY_SUPERSEDED** | Live specimen must record actual model/provider and the tool the runtime selects (`editor` vs `apply_patch` per `DEFAULT_MODEL_TOOL_ROUTING_RULES`); MCP-approval simplification affects per-tool MCP flow |
| SETTINGS_SANDBOX_CAPABILITIES (CLOSED_V2) | **UPSTREAM_INDEPENDENT** | No upstream overlap; `state.proto` field 174 must be kept (ClineMM restoration anchors legacy migration); wire contract F18/F19 preserved |
## Conflict preview (STRUCTURAL — no merge executed)

Real conflict files (17):

```
apps/vscode/package.json                                   MECHANICAL
apps/vscode/proto/cline/state.proto                        SECURITY_CRITICAL  (field 174)
apps/vscode/src/sdk/SdkController.ts                       SECURITY_CRITICAL  (mcpHub removed)
apps/vscode/src/sdk/model-catalog/catalog.ts               SEMANTIC
apps/vscode/src/sdk/model-catalog/contracts.ts             SEMANTIC
apps/vscode/src/sdk/sdk-task-control-coordinator.test.ts   MECHANICAL
apps/vscode/src/sdk/sdk-tool-policies.test.ts              MECHANICAL
apps/vscode/src/sdk/sdk-tool-policies.ts                   SECURITY_CRITICAL  (MCP approval)
apps/vscode/src/sdk/vscode-session-host.ts                 SEMANTIC
apps/vscode/webview-ui/src/hooks/useProviderUsageCostDisplay.test.ts  SEMANTIC  (add/add; manual merge step required)
apps/vscode/webview-ui/src/hooks/useProviderUsageCostDisplay.ts       MECHANICAL
bun.lock                                                   MECHANICAL
sdk/packages/core/src/extensions/tools/definitions.ts      SEMANTIC
sdk/packages/core/src/extensions/tools/executors/bash.ts   SECURITY_CRITICAL  (executor boundary)
sdk/packages/core/src/runtime/orchestration/runtime-builder.ts  SEMANTIC
sdk/packages/llms/src/providers/billing.test.ts            MECHANICAL
sdk/packages/shared/src/agent.ts                           SEMANTIC
```

## Integration strategy (frozen for successor)

Doctrine: temporary integration branch, no rebase of canonical main, historical SHAs preserved.

**P1 bounded correction (post-review):** Pin upstream by SHA, not by ref.

```bash
RECON_SUBJECT_HEAD=48d63852745460ff0fa3dfcc0457bbe2493841de

# step 0: re-fetch upstream; LOG drift but do NOT halt on it.
#         The whole point of pinning by SHA is that we can execute
#         even if upstream has advanced. Reopen recon only if the new
#         commits introduce a P0/security issue or you explicitly
#         decide staying current is worth invalidating the frozen
#         17-conflict map.
git fetch --prune upstream main
FETCHED_UPSTREAM_HEAD=$(git rev-parse upstream/main)
if [ "$FETCHED_UPSTREAM_HEAD" != "$RECON_SUBJECT_HEAD" ]; then
    echo "upstream advanced from $RECON_SUBJECT_HEAD to $FETCHED_UPSTREAM_HEAD"
    echo "RECON_ADVANCE_LOG: pinned subject is still the merge target."
    echo "RECON_ADVANCE_LOG: review the new commits for P0/security;"
    echo "RECON_ADVANCE_LOG: if none, proceed with the frozen subject."
    # DO NOT exit 1 — that would force a pointless new recon for
    # any README/release commit that lands while we are executing.
    # Record the drift and continue.
fi

# step 1: branch off the pinned subject head (NOT upstream/main)
git switch -c factory/upstream-sync-<date>
git merge --no-ff $RECON_SUBJECT_HEAD

# step 2: resolve the 17 conflicts per the order below (NOT alphabetical)
#       then regenerate proto and build:
#   bun run protos
#   bun run build:sdk
#   bun run check-types

# step 3: qualification set (see next section)

# step 4: merge back into main with --no-ff; do not fast-forward.
git switch main
git merge --no-ff factory/upstream-sync-<date>

# step 5: update factory/inventories/repository.json and .factory/epic-board.md
```

The merge target is the **exact recon subject** `48d63852745460ff0fa3dfcc0457bbe2493841de`, not an implicitly-moving `upstream/main`. A 178th upstream commit silently landing between recon and execution would invalidate the 17-conflict map; pinning by SHA makes the integration **decoupled** from `upstream/main` drift. Per the policy adjustment below, drift is **logged, not fatal** — the integration subject is frozen regardless.

### Conflict resolution order (frozen)

Resolve by dependency / risk, **not alphabetically**:

1. `state.proto` (wire contract; affects generated code AND `updateSettings.ts` wire types)
2. `sdk-tool-policies.ts` + its test (MCP approval simplification; load-bearing for Safe-YOLO)
3. `SdkController.ts` (calls `isToolAutoApproved` without `mcpHub` per upstream; must coordinate with #2)
4. `vscode-session-host.ts` (creates the shared host that `SdkController.ts` ref-gates; F27 target)
5. `bash.ts` (executor boundary; reconcile upstream stream-output with ClineMM sandbox/command-job-manager seams)
6. `definitions.ts` (tool definitions; affects #4 and #5)
7. `runtime-builder.ts` (orchestrator topology)
8. shared agent/model contracts (`agent.ts`, `model-catalog/catalog.ts`, `model-catalog/contracts.ts`)
9. package / UI / tests (`package.json`, `useProviderUsageCostDisplay.ts`, `useProviderUsageCostDisplay.test.ts` add/add, `sdk-task-control-coordinator.test.ts`, `billing.test.ts`)
10. `bun.lock` LAST (regenerate via `bun install`; never hand-edit)

Especially **do NOT** take ours/theirs wholesale for the four `SECURITY_CRITICAL` files (state.proto, SdkController.ts, bash.ts, sdk-tool-policies.ts).

### Integration strategy — what NOT to do

```
git rebase upstream/main onto main  # would rewrite ClineMM history
git push --force-with-lease         # would rewrite ClineMM history
git stash pop stash@{0}             # would surface Seatbelt WIP that must remain WIP
git reset --hard                    # would destroy evidence anchors
```

### Drift-handling policy (P1 bounded correction, post-review)

A naive "if upstream/main != pinned subject → exit 1" rule is too strict:
it forces a pointless new recon for any README/release commit that lands
while the successor is mid-execution. The whole point of pinning by SHA is
that the integration subject is **frozen regardless of upstream drift**.

The successor's drift-handling rule is therefore:

```
1. Re-fetch upstream.
2. Compare FETCHED_UPSTREAM_HEAD with RECON_SUBJECT_HEAD.
3. If equal: proceed silently.
4. If different: LOG the drift (RECON_ADVANCE_LOG: ...), then
   (a) spot-check the new commits for P0/security issues
       (new auth flow, sandbox escape, proto renumbering, dependency
       RCE, etc.),
   (b) if none, proceed with the frozen subject and the frozen
       17-conflict map,
   (c) if yes, halt as HALT_UPSTREAM_ADVANCE_P0 and re-open
       ACT-CLINEMM-UPSTREAM-SYNC-RECON01 with the new subject.
```

This matches the Factory objective (freeze bounded contract → execute
it) rather than continuously chasing a moving branch.

## Qualification set (frozen)

Required post-merge:

```
[ ] bun run build:sdk                 (F26)
[ ] bun run protos                    (after state.proto + task.proto resolution)
[ ] bun run check-types               (F26)
[ ] bun run lint
[ ] bun run test:unit                (sdk-tool-policies, sandbox-policy, command-job-manager,
                                      state-manager, session-auto-approval, task-state-shadow-*,
                                      host-ownership-capture, v2-capture — at minimum)
[ ] grep smoke: settings round-trip (clinemm_safe_yolo_allow_network, user_context_ceiling,
                                      auto_approve_all_toggled 174) — F7, F13, F17, F18
[ ] grep smoke: no new MCP per-tool approval wiring (F16)
[ ] grep smoke: capture diagnostics still DEFAULT_OFF (F8)
[ ] grep smoke: state.proto field numbers 174, 187, 188, 189, 190 all present and consistent (F17, F18)
[ ] git diff --stat shows factory/ untouched (F11)
[ ] git stash list still shows 2 entries (F10)

[ ] SdkSessionLifecycle.getOrCreateSharedHost             (F27: SHARED_HOST_SAFE_YOLO_SOURCE_BINDING)
    → safeYoloCapabilitySource present
    → persisted network=true
    → CommandJobManager capability.network="allow"
    (P1 bounded correction: SdkController.ts and vscode-session-host.ts
     are both conflict files, while sdk-session-lifecycle.ts auto-merges.
     This is precisely where git produces a syntactically clean merge
     that silently breaks the newly-repaired live source binding. This
     test MUST be green post-merge; otherwise halt as
     HALT_SHARED_HOST_SOURCE_BINDING_LOST.)
```

NOT required unless upstream touched them:

```
[ ] HOST-TEST RUNNER                    (host-only-behaviour qualification)
[ ] editor-tool LIVE specimen           (live capture required)
[ ] classic-protection LIVE             (live capture required)
[ ] seatbelt real-kernel probes         (live OS-kernel required)
```

## Fork invariants frozen

See `invariant-map.md` (F1-F27). 27 invariants total: 12 from prior recon + 14 discovered in this ACT + 1 added post-review (F27: `SHARED_HOST_SAFE_YOLO_SOURCE_BINDING` — see Qualification set).

## Evidence quality labels

```
IDENTITY            = SOURCE_PROVEN     (git plumbing)
DIVERGENCE          = SOURCE_PROVEN     (git rev-list)
FILE_INTERSECTION   = SOURCE_PROVEN     (git diff --name-only)
CONFLICT_PREVIEW    = STRUCTURAL        (merge-tree --write-tree; not executed)
UPSTREAM_TOUR       = SOURCE_PROVEN     (git log + git show on every named SHA)
SEMANTIC_OVERLAP    = SOURCE_PROVEN + INFERRED  (named SHAs are real; risk classification is inferred)
FORK_INVARIANTS     = SOURCE_PROVEN     (file existence + grep; some derived from prior ACTs)
INTEGRATION_STRATEGY = DOCTRINE          (frozen from prior recon; reconfirmed; pin-by-SHA P1 correction)
QUALIFICATION_SET   = INFERRED          (selected from the conflict map; not yet run; F27 target added post-review)
LANE_IMPACT         = INFERRED          (judgment based on upstream commit contents)
```

## Acceptance gates against ACT's C-list

```
C01_UPSTREAM_REMOTE_BOUND              = PASS
C02_UPSTREAM_FETCHED                   = PASS   (timeout-fetch + unshallow succeeded)
C03_REAL_DIVERGENCE_COUNTED            = PASS   (905 / 177)
C04_MERGE_BASE_BOUND                   = PASS   (ad442cbb...)
C05_UPSTREAM_COMMITS_CLASSIFIED        = PASS   (177 commits, see upstream-commit-map.tsv)
C06_CLINEMM_DELTA_INVENTORIED          = PASS   (1058 files / 905 commits; see clinemm-files.txt)
C07_FILE_OVERLAP_MAP                   = PASS   (55 files; see overlap-files.txt)
C08_SEMANTIC_OVERLAP_MAP               = PASS   (see semantic-overlap.md, 6 high-value sections)
C09_COMPLETION_OVERLAP_CLASSIFIED      = PASS   (c870116d1 + 80dd57315 → SUPERSEDED)
C10_RESUME_QPSR_OVERLAP_CLASSIFIED     = PASS   (b9efa9682 + eef7958ca + 9cf60cd43 + fed502e3c + 89c2efa97 → SUPERSEDED)
C11_EDITOR_TOOL_OVERLAP_CLASSIFIED     = PASS   (2b7b01328 + DEFAULT_MODEL_TOOL_ROUTING_RULES → PARTIALLY_SUPERSEDED, MODEL_DEPENDENT)
C12_SANDBOX_OVERLAP_CLASSIFIED         = PASS   (no upstream change; INDEPENDENT)
C13_SETTINGS_PROTO_COLLISION_CHECKED   = PASS   (no field-number collision; semantic conflict on field 174 only)
C14_CONFLICT_PREVIEW                   = PASS   (17 files, classified)
C15_FORK_INVARIANTS_FROZEN             = PASS   (F1-F26 frozen)
C16_INTEGRATION_STRATEGY_FROZEN        = PASS   (temporary branch + merge, doctrine)
C17_QUALIFICATION_SET_FROZEN           = PASS   (see above)
C18_OPEN_WORK_REPRIORITIZED            = PASS   (see lane impact table)
C19_NO_PRODUCTION_DELTA                = PASS   (no source touched)
C20_DIFF_CHECK                         = PASS   (clean)
C21_WORKTREE_CLEAN                     = PASS   (clean at entry; no edits)
```

See `invariant-map.md` (F1-F26). 26 invariants total: 12 from prior recon + 14 discovered this ACT.

## What this ACT did NOT do

```
[ ] Did not merge upstream.
[ ] Did not resolve conflicts.
[ ] Did not edit production code.
[ ] Did not renumber protobuf fields.
[ ] Did not port upstream fixes manually.
[ ] Did not drop ClineMM changes.
[ ] Did not pop, drop, or rewrite any protected stash.
[ ] Did not modify factory/inventories/repository.json.
[ ] Did not run any test suites (the ACT is recon-only).
[ ] Did not run any builds (no source mutation).
[ ] Did not create a worktree or branch.
```
# resolve 17 conflicts per F17 / F23 / F24 contracts
# regenerate proto via bun run protos
# bun run build:sdk
# bun run check-types
# then qualification set per the next section
git switch main
git merge --no-ff factory/upstream-sync-<date>
```

NEVER:

```
git rebase upstream/main onto main  # would rewrite ClineMM history
git push --force-with-lease         # would rewrite ClineMM history
git stash pop stash@{0}             # would surface Seatbelt WIP that must remain WIP
git reset --hard                    # would destroy evidence anchors
```
| SEATBELT_NETWORK (CLOSED) | **UPSTREAM_INDEPENDENT** | `sandbox-policy.ts` and `command-job-manager.ts` are ClineMM-only; upstream did not land competing code |
| SEATBELT_SSH_AGENT (CLOSED) | **UPSTREAM_INDEPENDENT** | Same as above |
| HOST-TEST RUNNER | **INDEPENDENT** | Still required for live qualification of editor + classic-protection; no upstream change |
| TOOL_RUNTIME_RELIABILITY | **MUST_REBASE_ON_UPSTREAM_FIRST** | Some upstream hook changes (8fe5a196c, 9b9a067fb) may affect reliability investigation framing; defer until post-merge |
| ARCHITECTURE / ELMIZATION02 | **UPSTREAM_HOLD** | No upstream change affecting ELMIZATION02 directly |
UPSTREAM_REMOTE  = https://github.com/cline/cline.git (upstream)
UPSTREAM_HEAD    = 48d63852745460ff0fa3dfcc0457bbe2493841de
MERGE_BASE       = ad442cbb6a81d21773ceabc1398ea5eb58170718
LOCAL_ONLY_COMMITS    = 905
UPSTREAM_ONLY_COMMITS = 177
```
