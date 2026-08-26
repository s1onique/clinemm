# Fixture C — composite OPEN / HOST_REQUIRED (modifier pattern)

Synthetic board for `tools/factory/validate-epic-board.ts --fixture=C-open-host-required-composite`.

Expected result: **All gates PASS.** Gate 6 (`EVERY_OPEN_NEXT_ROW_HAS_DETAIL`) is satisfied (Detail has a relative link). Gate 8 (`HOST_REQUIRED_QUALIFICATION_VALID`) is satisfied because `HOST_REQUIRED` accompanies `OPEN` (composite form `OPEN / HOST_REQUIRED`, per the contract's §2 modifier rule).

(No Detail links in this fixture reference real files — Gate 2 trivially passes. The link text is just a marker.)

## Current frontier

| Lane | Pri | State | Work | Detail |
|---|---|---|---|---|
| Approval / editor-tool | P1 | OPEN / HOST_REQUIRED | `ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01` | [`safe-yolo-seatbelt.md`](./epics/safe-yolo-seatbelt.md) |