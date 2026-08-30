# Conflict-classification TSV — reconciliation note

## Schema

```
PATH<TAB>CLASS<TAB>NOTE
```

`PATH` is a leaf filename (not a full path) so the TSV can be grep'd easily and joined against `conflict-files.txt`. Real paths live in `conflict-files.txt` and the merge-tree output (`merge-tree-result.txt`).

## Frozen taxonomy (P1 bounded correction, post-review)

The first draft of `conflict-classification.tsv` introduced a fifth class `GENERATED` for the `useProviderUsageCostDisplay.test.ts` add/add conflict. The reviewer flagged this as inconsistent with the human summary in `conflict-preview.txt` and `recommendation.md`, both of which counted the test under `SEMANTIC`. The corrected taxonomy uses **four classes only**:

| Class | Count | Files |
|-------|-------|-------|
| `MECHANICAL` | 6 | bun.lock, package.json, sdk-tool-policies.test.ts, sdk-task-control-coordinator.test.ts, useProviderUsageCostDisplay.ts, billing.test.ts |
| `SEMANTIC` | 7 | vscode-session-host.ts, useProviderUsageCostDisplay.test.ts (add/add), definitions.ts, runtime-builder.ts, agent.ts, model-catalog/catalog.ts, model-catalog/contracts.ts |
| `SECURITY_CRITICAL` | 4 | state.proto, SdkController.ts, bash.ts, sdk-tool-policies.ts |
| `FACTORY_ONLY` | 0 | (no factory file intersects upstream) |
| **TOTAL** | **17** | |

`GENERATED` is no longer a class. An add/add hand-written test is not "generated" merely because both sides created the same path; it is a `SEMANTIC` conflict because a manual merge step is required.

This matches `conflict-preview.txt` (which already says `SEMANTIC: 7` and lists the test under SEMANTIC) and `recommendation.md` §"Conflict preview" (which says the same).

The TSV is the source of truth for successor tooling; the human-readable summaries are kept consistent with it.
