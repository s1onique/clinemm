# ACT-CLINEMM-UPSTREAM-SYNC-INTEGRATION01

## Identity (executable)

```text
ACT_ID              = ACT-CLINEMM-UPSTREAM-SYNC-INTEGRATION01
PREDECESSOR_ACT     = ACT-CLINEMM-UPSTREAM-SYNC-RECON01 (CLOSED_CLEAN / PASS_UPSTREAM_SYNC_RECON at 812c931da)
ENTRY_HEAD          = 812c931dab0fe9490323a1145f2d33468e7b3a2f
ENTRY_TREE          = b0535c31954c9f046b1dd91abd9b6ce54c7a73f2
BRANCH              = factory/upstream-sync-2026-08-30
WORKTREE_STATUS     = CLEAN
PROTECTED_STASHES   = 2 (stash@{0} Seatbelt WIP, stash@{1} c2-green-and-c2-p1-delta)
RECON_SUBJECT_HEAD  = 48d63852745460ff0fa3dfcc0457bbe2493841de
FETCHED_UPSTREAM    = 48d63852745460ff0fa3dfcc0457bbe2493841de
DRIFT               = NONE
MERGE_BASE          = ad442cbb6a81d21773ceabc1398ea5eb58170718
LOCAL_ONLY          = 905
UPSTREAM_ONLY       = 177
INTERSECTION        = 55
EXPECTED_CONFLICTS  = 17 (16 base-present + 1 add/add)
EXPECTED_AUTOMERGE  = 38
SECURITY_CRITICAL   = 4 (state.proto, SdkController.ts, bash.ts, sdk-tool-policies.ts)
FROZEN_INVARIANTS   = 27 (F1-F27)
```

## Goal

Execute the frozen 17-conflict merge against upstream `48d63852745460ff0fa3dfcc0457bbe2493841de`,
preserve all 27 fork invariants (F1-F27), produce post-merge qualification
evidence (incl. mandatory F27 `SHARED_HOST_SAFE_YOLO_SOURCE_BINDING`),
and back-merge the integrated branch into `main`.

## Strategy (frozen)

- Pin upstream by SHA `48d63852745460ff0fa3dfcc0457bbe2493841de`. Drift is
  logged, not fatal. Per `RECON_ADVANCE_LOG`: no drift observed.
- Resolve conflicts in **dependency/risk order**, NOT alphabetically:
  1. `state.proto` (wire contract; gates generated code + `updateSettings.ts`)
  2. `sdk-tool-policies.ts` + `sdk-tool-policies.test.ts` (MCP approval; load-bearing for Safe-YOLO)
  3. `SdkController.ts` (coordinates with #2; `isToolAutoApproved` without `mcpHub`)
  4. `vscode-session-host.ts` (F27 target; shared host factory)
  5. `bash.ts` (executor boundary; reconcile upstream stream-output with ClineMM sandbox/command-job-manager)
  6. `definitions.ts` (tool definitions)
  7. `runtime-builder.ts` (orchestrator topology)
  8. shared agent/model contracts (`agent.ts`, `model-catalog/catalog.ts`, `model-catalog/contracts.ts`)
  9. package/UI/tests (`package.json`, `useProviderUsageCostDisplay.ts`, `useProviderUsageCostDisplay.test.ts` add/add, `sdk-task-control-coordinator.test.ts`, `billing.test.ts`)
  10. `bun.lock` LAST (regenerate via `bun install`)
- **NEVER** `--ours`/`--theirs` wholesale on the 4 SECURITY_CRITICAL files.
- All merges must be **semantic**: read both sides, decide intent, produce merged content.

## Post-merge gates (mandatory, in order)

```text
[ ] bun run protos
[ ] bun run build:sdk                        (F26)
[ ] bun run check-types                      (F26)
[ ] bun run lint
[ ] bun run test:unit                        (sdk-tool-policies, sandbox-policy, command-job-manager,
                                              state-manager, session-auto-approval, task-state-shadow-*,
                                              host-ownership-capture, v2-capture — at minimum)
[ ] grep smoke F7/F13/F17/F18: settings round-trip
      (clinemm_safe_yolo_allow_network, user_context_ceiling, auto_approve_all_toggled 174)
[ ] grep smoke F16: no new MCP per-tool approval wiring
[ ] grep smoke F8: capture diagnostics still DEFAULT_OFF
[ ] grep smoke F17/F18: state.proto field numbers 174, 187, 188, 189, 190 present
[ ] git diff --stat factory/ untouched         (F1, F11)
[ ] git stash list == 2 entries                (F10)
[ ] F27 SHARED_HOST_SAFE_YOLO_SOURCE_BINDING   (MANDATORY)
      SdkSessionLifecycle.getOrCreateSharedHost
      → safeYoloCapabilitySource present
      → persisted network=true
      → CommandJobManager capability.network="allow"
      failure → HALT_SHARED_HOST_SOURCE_BINDING_LOST
```

## Back-merge & bookkeeping

```text
[ ] git switch main
[ ] git merge --no-ff factory/upstream-sync-2026-08-30
[ ] Update factory/inventories/repository.json
[ ] Update .factory/epic-board.md
[ ] Stage + commit all ACT body + evidence + board + inventory changes
[ ] Stash@{0} and stash@{1} still preserved
```

## Hard constraints

- No rebase of canonical main.
- No `--force-with-lease`.
- No stash pop/drop on `stash@{0}` or `stash@{1}`.
- No `--hard` reset.
- No rewriting `.factory/evidence/<existing-ACT>/`.
- 4 SECURITY_CRITICAL files: NO wholesale `--ours` / `--theirs`.