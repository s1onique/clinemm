# ACT-CLINEMM-UPSTREAM-SYNC-RECON01

## Mission

Determine whether ClineMM should synchronize with current `cline/cline` upstream **before continuing the remaining runtime/approval backlog**, and freeze the smallest safe integration contract.

## Verdict

```
VERDICT       = PASS_UPSTREAM_SYNC_RECON
SYNC_PRIORITY = HIGH
NEXT_ACT      = ACT-CLINEMM-UPSTREAM-SYNC-INTEGRATION01
```

## Identity (SOURCE_PROVEN)

```
ENTRY_HEAD           = 60a99d2bd3e579b2ed7202d913f372bd6376688c
ENTRY_TREE           = 4e7c1b7c2420f18523847dd2d84e6a1bda59b7e4
BRANCH               = main
WORKTREE             = CLEAN (entry AND exit)
UPSTREAM_HEAD        = 48d63852745460ff0fa3dfcc0457bbe2493841de
UPSTREAM_TREE        = 14500ceda6208e38fc6cf2289efd5156d44ca46e
MERGE_BASE           = ad442cbb6a81d21773ceabc1398ea5eb58170718
LOCAL_ONLY_COMMITS   = 905
UPSTREAM_ONLY_COMMITS = 177
RECON_SUBJECT_HEAD   = 48d63852745460ff0fa3dfcc0457bbe2493841de
                      (pin upstream by SHA; successor must merge
                       THIS exact object, not an implicitly-moving
                       upstream/main. Drift is logged-but-not-fatal;
                       see recommendation.md §"Drift-handling policy".)
PROTECTED_STASHES_PRESERVED = 2  (untouched)
```

## High-value upstream changes

Top 12 commits affecting ClineMM open lanes:

| SHA | Lane | Behavior |
|-----|------|----------|
| c870116d1 | COMPLETION | task.completed emitted from every teardown path |
| 80dd57315 | COMPLETION | submit_and_exit UX finalized (auto-expand + markdown) |
| b9efa9682 | QPSR | survive on resume, do not rebuild from history |
| eef7958ca | QPSR | truthful session status so checkpoint restore stops wedging |
| 9cf60cd43 | QPSR | finalize queued turns on chat_done |
## Overlap

```
CLINEMM_FILES_CHANGED     = 1058
UPSTREAM_FILES_CHANGED    = 764
INTERSECTION_COUNT        = 55  (file-diff intersection via `comm -12`)
CHANGED_IN_BOTH_COUNT     = 54  (merge-tree section; 1 less because the
                                add/add test file is reported separately.
                                See conflict-preview.txt §"55-vs-54 NOTE".)
CONFLICT_FILES            = 17  (merge-tree --write-tree; authoritative)
AUTO_MERGE_FILES          = 38  (= 55 - 17, intersection minus conflicts)
BASE_PRESENT_CONFLICTS    = 16  (CONFLICT (content) entries)
ADD_ADD_CONFLICTS         = 1   (useProviderUsageCostDisplay.test.ts)
SEMANTIC_OVERLAPS         = 6 high-value (Completion, QPSR/RSR, Editor tool,
                                Sandbox, Settings, SDK runtime)
TRUST_BOUNDARY_OVERLAPS   = 4 (state.proto, SdkController.ts, bash.ts,
                                sdk-tool-policies.ts)
```

## Conflict preview

Frozen taxonomy (four classes):

```
MECHANICAL            = 6  (bun.lock, package.json, sdk-tool-policies.test.ts,
                             sdk-task-control-coordinator.test.ts,
                             useProviderUsageCostDisplay.ts, billing.test.ts)
SEMANTIC              = 7  (vscode-session-host.ts, useProviderUsageCostDisplay.test.ts
                             [add/add], definitions.ts, runtime-builder.ts,
                             agent.ts, model-catalog/catalog.ts,
                             model-catalog/contracts.ts)
SECURITY_CRITICAL     = 4  (state.proto field 174, SdkController.ts mcpHub,
                             bash.ts executor, sdk-tool-policies.ts MCP approval)
FACTORY_ONLY          = 0
GENERATED             = 0  (class removed in P1 bounded correction; the add/add
                             test is now SEMANTIC. See
                             conflict-classification-README.md.)
```

Full classification: `.factory/evidence/ACT-CLINEMM-UPSTREAM-SYNC-RECON01/conflict-classification.tsv`.

## Existing lane impact

| Lane | Status | Next action |
|------|--------|-------------|
| COMPLETION_AUTHORITY | UPSTREAM_SUPERSEDED | adopt `emitTaskCompletedOnTeardown` in SEATBELT-YOLO-COMPLETION-AUTHORITY-IMPLEMENTATION01 |
| QPSR_RSR | UPSTREAM_SUPERSEDED | do NOT reopen RSR; upstream closes 4 core seams |
| EDITOR_TOOL_APPROVAL_FRICTION | UPSTREAM_PARTIALLY_SUPERSEDED | live specimen must record provider/model + selected tool (apply_patch vs editor per `DEFAULT_MODEL_TOOL_ROUTING_RULES`) |
| SETTINGS_SANDBOX_CAPABILITIES (CLOSED_V2) | UPSTREAM_INDEPENDENT | preserve `state.proto` field 174 (ClineMM restoration anchors legacy migration) |
| SEATBELT_NETWORK (CLOSED) | UPSTREAM_INDEPENDENT | `sandbox-policy.ts` + `command-job-manager.ts` ClineMM-only |
| SEATBELT_SSH_AGENT (CLOSED) | UPSTREAM_INDEPENDENT | same |
| HOST-TEST RUNNER | INDEPENDENT | still required for live qualification |
| TOOL_RUNTIME_RELIABILITY | MUST_REBASE_ON_UPSTREAM_FIRST | upstream hook changes may affect framing |

## Decision

```
SYNC_PRIORITY = HIGH
WHY           = upstream changed completion, resume, abort, tool routing,
                and approval semantics that overlap current ClineMM open
                investigations. Continuing local causal work first has
                worse SPEED × CORRECTNESS.
NEXT_ACT      = ACT-CLINEMM-UPSTREAM-SYNC-INTEGRATION01
```

## Evidence

| Artifact | Description |
|----------|-------------|
| `identity.txt` | SOURCE_PROVEN entry identity |
| `divergence.txt` | 905 / 177 counts |
| `upstream-commit-map.tsv` | 51 high-value upstream commits with area / behavior / lane / supersession |
| `upstream-commits-oneline.txt` | all 177 upstream-only commit titles |
| `upstream-commits-meta.txt` | all 177 upstream-only commits with full SHA + title |
| `upstream-files.txt` | 764 upstream-changed files |
| `clinemm-files.txt` | 1058 ClineMM-changed files |
| `intersection-files.txt` / `overlap-files.txt` | 55 intersect files |
| `changed-in-both-files.txt` | 54 from merge-tree (add/add test excluded; see §"55-vs-54 NOTE") |
| `merge-tree-result.txt` | raw 124-line merge-tree stage-1/2/3 output |
| `merge-messages.txt` / `merge-messages-full.txt` | git merge-tree `--messages` output (17 CONFLICT lines) |
| `conflict-files.txt` | 17 conflict file paths |
| `conflict-preview.txt` | STRUCTURAL summary with classification + 55-vs-54 NOTE |
| `conflict-classification.tsv` | 17-row machine-readable classification |
| `conflict-classification-README.md` | taxonomy reconciliation note |
| `semantic-overlap.md` | 6 high-value overlaps + top-12 verdict table |
| `invariant-map.md` | 27 frozen invariants F1-F27 |
| `recommendation.md` | final verdict + qualification set + C-list gates |

All under `.factory/evidence/ACT-CLINEMM-UPSTREAM-SYNC-RECON01/`.

## Acceptance gates

All C01-C21 PASS — see `.factory/evidence/ACT-CLINEMM-UPSTREAM-SYNC-RECON01/recommendation.md` §"Acceptance gates".

## Post-review corrections (recon ACT halts clean)

This recon ACT was reviewed before closure. Two review rounds were completed; the second round surfaced two more bounded corrections, all applied across two commits:

```
ROUND 1 (commit be6c3fb75 -> 730a58954):
  P0  = NONE
  P1  = ONE_BOUNDED_EVIDENCE_CORRECTION
  P2  = DOCUMENTARY_RESIDUE

  P1: conflict taxonomy inconsistency
      - First draft introduced a GENERATED class for the add/add test.
      - Post-review freeze uses four classes only (MECHANICAL, SEMANTIC,
        SECURITY_CRITICAL, FACTORY_ONLY); the add/add test is SEMANTIC.
      - conflict-classification.tsv, conflict-preview.txt, recommendation.md,
        and this ACT body all now agree.

  P2: 55-vs-54 overlap accounting
      - One-sentence explanation added to conflict-preview.txt §"55-vs-54 NOTE".

  P2: ACT markdown assembly damage
      - Top 12 table restored; section ordering corrected.

  P1 (execution-contract): pin upstream by SHA
      - RECON_SUBJECT_HEAD = 48d63852745460ff0fa3dfcc0457bbe2493841de
      - Successor must merge THIS exact object, not upstream/main.
      - Halt-on-drift guard added to integration strategy in recommendation.md.

  P1 (qualification set): F27 added
      - SHARED_HOST_SAFE_YOLO_SOURCE_BINDING regression test is mandatory
        post-merge. SdkController.ts and vscode-session-host.ts are both
        conflict files while sdk-session-lifecycle.ts auto-merges; this is
        precisely where a syntactically-clean merge can silently break the
        newly-repaired live source binding. Failure halts as
        HALT_SHARED_HOST_SOURCE_BINDING_LOST.

ROUND 2 (this commit):
  P0  = NONE
  P1  = ONE_ARITHMETIC_RESIDUE (FIX_OPPORTUNISTICALLY)
  P1  = ONE_POLICY_REFINEMENT (LOG_DONT_HALT)
  P2  = NONE

  P1: arithmetic residue
      - Earlier draft: AUTO_MERGE = 54 - 17 = 37  (WRONG, double-subtracts
        the add/add test that is in INTERSECTION but not in CHANGED_IN_BOTH).
      - Correct accounting:
          BASE_PRESENT_CONFLICTS = 16
          ADD_ADD_CONFLICTS      = 1
          AUTO_MERGE = INTERSECTION - TOTAL_CONFLICTS = 55 - 17 = 38
          AUTO_MERGE = CHANGED_IN_BOTH - BASE_PRESENT_CONFLICTS = 54 - 16 = 38
      - Fixed in conflict-preview.txt, recommendation.md, this ACT body.

  P1: policy refinement
      - Earlier runbook: "if upstream/main != RECON_SUBJECT_HEAD -> exit 1"
        (too strict; forces pointless new recon for any README/release
        commit that lands mid-execution).
      - Post-review freeze: LOG drift, spot-check new commits for
        P0/security issues, proceed if none, halt only if yes.
      - Documented in recommendation.md §"Drift-handling policy".
```
## Halt conditions triggered

None. The fetch succeeded, divergence was measured, overlap was mapped, conflicts were previewed, invariants were frozen, and the strategy was frozen. No halt was reached.

## What this ACT explicitly did NOT do

- Did not merge upstream.
- Did not resolve conflicts.
- Did not edit production code.
- Did not renumber protobuf fields.
- Did not port upstream fixes manually.
- Did not drop ClineMM changes.
- Did not pop, drop, or rewrite any protected stash.
- Did not modify factory/inventories/repository.json.
- Did not run any test suites (recon-only).
- Did not create a worktree or branch.

## Successor contract

`ACT-CLINEMM-UPSTREAM-SYNC-INTEGRATION01` must:

1. Re-fetch upstream; compare with `RECON_SUBJECT_HEAD=48d63852745460ff0fa3dfcc0457bbe2493841de`. If drifted, **log but do NOT halt** unless the new commits introduce a P0/security issue (see `recommendation.md` §"Drift-handling policy").
2. Create `factory/upstream-sync-<date>` branch.
3. Run `git merge --no-ff 48d63852745460ff0fa3dfcc0457bbe2493841de` (the pinned subject, not `upstream/main`).
4. Resolve the 17 conflicts in the frozen order (see `recommendation.md` §"Conflict resolution order"):
   1. state.proto, 2. sdk-tool-policies.ts + test, 3. SdkController.ts, 4. vscode-session-host.ts, 5. bash.ts, 6. definitions.ts, 7. runtime-builder.ts, 8. shared agent/model contracts, 9. package / UI / tests, 10. bun.lock LAST.
5. Do **NOT** take ours/theirs wholesale for the four `SECURITY_CRITICAL` files.
6. Run `bun run protos`, `bun run build:sdk`, `bun run check-types`.
7. Run the qualification set in `recommendation.md` §"Qualification set (frozen)" — including F27 SHARED_HOST_SAFE_YOLO_SOURCE_BINDING regression test.
8. Merge `factory/upstream-sync-<date>` back into `main` with `--no-ff`.
9. Update `factory/inventories/repository.json` to point at the new integration commit.
10. Update `.factory/epic-board.md` to reflect the new state of the lanes.
