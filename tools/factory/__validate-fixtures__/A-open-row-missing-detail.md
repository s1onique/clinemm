# Fixture A — open row missing Detail link

Synthetic board for `tools/factory/validate-epic-board.ts --fixture=A-open-row-missing-detail`.

Expected result: **Gate 6 `EVERY_OPEN_NEXT_ROW_HAS_DETAIL` must FAIL.** All other gates should pass (or be skipped for fixtures — Gate 9 conservation is skipped).

This fixture proves the validator can detect an OPEN row whose `Detail` column is empty.

(No Detail links in this fixture — Gate 2 trivially passes.)

## Current frontier

| Lane | Pri | State | Work | Detail |
|---|---|---|---|---|
| Approval / editor-tool | P1 | OPEN | `ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01` | (none) |