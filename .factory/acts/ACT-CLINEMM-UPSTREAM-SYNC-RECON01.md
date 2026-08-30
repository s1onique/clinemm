# ACT-CLINEMM-UPSTREAM-SYNC-RECON01

## Mission

Determine whether ClineMM should synchronize with current `cline/cline` upstream **before continuing the remaining runtime/approval backlog**, and freeze the smallest safe integration contract.

## Verdict

```
VERDICT       = PASS_UPSTREAM_SYNC_RECON
SYNC_PRIORITY = HIGH
NEXT_ACT      = ACT-CLINEMM-UPSTREAM-SYNC-INTEGRATION01
```

## Identity

```
ENTRY_HEAD     = 60a99d2bd3e579b2ed7202d913f372bd6376688c
ENTRY_TREE     = 4e7c1b7c2420f18523847dd2d84e6a1bda59b7e4
BRANCH         = main
WORKTREE       = CLEAN (entry AND exit)
UPSTREAM_HEAD  = 48d63852745460ff0fa3dfcc0457bbe2493841de
MERGE_BASE     = ad442cbb6a81d21773ceabc1398ea5eb58170718
LOCAL_ONLY     = 905 commits
UPSTREAM_ONLY  = 177 commits
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
| fed502e3c | LEGACY | honor classic truncation range when migrating legacy tasks |
| 89c2efa97 | CHECKPOINT | refuse restore when HEAD moved past checkpoint |
## Overlap

```
CLINEMM_FILES_CHANGED    = 1058
UPSTREAM_FILES_CHANGED   = 764
INTERSECTION_COUNT       = 55
CONFLICT_FILES           = 17  (merge-tree --write-tree)
AUTO_MERGE_FILES         = 37
SEMANTIC_OVERLAPS        = 6 high-value (Completion, QPSR/RSR, Editor tool, Sandbox, Settings, SDK runtime)
TRUST_BOUNDARY_OVERLAPS  = 4 (state.proto, SdkController.ts, bash.ts, sdk-tool-policies.ts)
```

## Conflict preview

```
MECHANICAL            = 6  (bun.lock, package.json, tests)
SEMANTIC              = 7  (model-catalog, vscode-session-host, runtime-builder, etc.)
SECURITY_CRITICAL     = 4  (state.proto field 174, SdkController.ts mcpHub,
                            bash.ts executor, sdk-tool-policies.ts MCP approval)
GENERATED             = 0
FACTORY_ONLY          = 0
```

Full classification: `.factory/evidence/ACT-CLINEMM-UPSTREAM-SYNC-RECON01/conflict-classification.tsv`.

## Evidence

| Artifact | Description |
|----------|-------------|
| `identity.txt` | SOURCE_PROVEN entry identity |
| `divergence.txt` | 905 / 177 counts |
| `upstream-commit-map.tsv` | 51 high-value upstream commits with area / behavior / lane / supersession |
| `upstream-commits-oneline.txt` | all 177 upstream-only commit titles |
| `upstream-files.txt` | 764 upstream-changed files |
| `clinemm-files.txt` | 1058 ClineMM-changed files |
| `intersection-files.txt` / `overlap-files.txt` | 55 intersect files |
| `changed-in-both-files.txt` | 54 from merge-tree (manual verification) |
| `merge-tree-result.txt` | raw 124-line merge-tree stage-1/2/3 output |
| `merge-messages.txt` / `merge-messages-full.txt` | git merge-tree `--messages` output (17 CONFLICT lines) |
| `conflict-files.txt` | 17 conflict file paths |
| `conflict-preview.txt` | STRUCTURAL summary with classification |
| `conflict-classification.tsv` | 17-row machine-readable classification |
| `semantic-overlap.md` | 6 high-value overlaps + top-12 verdict table |
| `invariant-map.md` | 26 frozen invariants F1-F26 |
| `recommendation.md` | final verdict + qualification set + C-list gates |

All under `.factory/evidence/ACT-CLINEMM-UPSTREAM-SYNC-RECON01/`.

## Acceptance gates

All C01-C21 PASS — see `.factory/evidence/ACT-CLINEMM-UPSTREAM-SYNC-RECON01/recommendation.md` §"Acceptance gates".

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

1. Create `factory/upstream-sync-<date>` branch.
2. Run `git merge --no-ff upstream/main`.
3. Resolve the 17 conflicts per F17 (state.proto field 174), F23 (task.completed emission), F24 (force-refresh).
4. Run `bun run protos`, `bun run build:sdk`, `bun run check-types`.
5. Run the qualification set in `recommendation.md` §"Qualification set (frozen)".
6. Merge `factory/upstream-sync-<date>` back into `main` with `--no-ff`.
7. Update `factory/inventories/repository.json` to point at the new integration commit.
8. Update `.factory/epic-board.md` to reflect the new state of the lanes.
## Existing lane impact

| Lane | Status | Next action |
|------|--------|-------------|
| COMPLETION_AUTHORITY | UPSTREAM_SUPERSEDED | adopt `emitTaskCompletedOnTeardown` in SEATBELT-YOLO-COMPLETION-AUTHORITY-IMPLEMENTATION01 |
| QPSR_RSR | UPSTREAM_SUPERSEDED | do NOT reopen RSR; upstream closes 4 core seams |
| EDITOR_TOOL_APPROVAL_FRICTION | UPSTREAM_PARTIALLY_SUPERSEDED | live specimen must record provider/model + selected tool (apply_patch vs editor) |
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
| 2b7b01328 | SAFE_YOLO | auto-approve all MCP tool calls when MCP toggle is on |
| 38f8260bc | SETTINGS | remote-config parity, drop field 174 (semantic conflict) |
| 8fe5a196c | HOOKS | deliver tool hook contextModification |
| 61b95a62e | BASH | stream run command output |
| 52d5e1a51 | ABORT | propagate session aborts to teammates |

Full map: `.factory/evidence/ACT-CLINEMM-UPSTREAM-SYNC-RECON01/upstream-commit-map.tsv`.
