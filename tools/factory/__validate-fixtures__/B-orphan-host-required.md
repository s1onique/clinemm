# Fixture B — orphan HOST_REQUIRED in a row

Synthetic board for `tools/factory/validate-epic-board.ts --fixture=B-orphan-host-required`.

Expected result: **Gate 8 `HOST_REQUIRED_QUALIFICATION_VALID` must FAIL.** All other gates should pass (or be skipped for fixtures — Gate 9 conservation is skipped).

This fixture proves the validator can detect a row whose State cell contains ONLY `HOST_REQUIRED` without an accompanying status token. Per the contract's §2 modifier rule, `HOST_REQUIRED` must accompany another status (`OPEN / HOST_REQUIRED`, `CLOSED / HOST_REQUIRED`, etc.); it is not a mutually-exclusive status.

(No Detail links in this fixture — Gate 2 trivially passes.)

## Active epics

| Epic | Pri | State | Frontier | Detail |
|---|---|---|---|---|
| Safe-YOLO + Darwin Seatbelt | P0 | HOST_REQUIRED | `HOST-TEST RUNNER` | (none) |