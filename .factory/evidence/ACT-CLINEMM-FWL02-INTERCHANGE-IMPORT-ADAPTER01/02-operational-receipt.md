# 02 — End-to-end operational receipt

Executed against an ISOLATED scratch repository (`/tmp/fwmi-qual/sandbox`), never the real repository.
The fixture is `tools/factory/fwmi/__fixtures__/sample-package` — a synthetic FWMI v1
package shaped like the real one (source head `29774ba05…`, one epic with four work
items including an UNKNOWN-status item and an UNRESOLVED-lifecycle item, two historical
ACTs including an AMBIGUOUS one, and one UNRESOLVED reconciliation record).

## 1. Dry-run interchange validation

```text
FWMI v1 validation: PASS
────────────────────────────────────────────────────────────────────────
epics=1 items=4 (open=0 active=0 blocked=0 deferred=2 terminal=1 unresolved=1)
historical ACTs=2 dependencies=1 cross-links=2
unresolved conflicts=1 unknown original status=1 unknown qualification=3 unknown coverage=3
────────────────────────────────────────────────────────────────────────
```

Exit code: `0` (PASS). Six WARNINGs and four INFOs are reported and NOT hidden — the
warnings are the `dependency_coverage: UNKNOWN` and `criteria_coverage: UNKNOWN`
statements, i.e. the very distinction the legacy adapter destroyed.

## 2. Shadow import (writes nothing)

```text
SHADOW IMPORT — interchange=29774ba05851f9dd5a46a33a90d963ff3ef286d5 verdict=SOURCE_RECONCILIATION_READY
────────────────────────────────────────────────────────────────────────
files=6 changed=6 byteDelta=9644
  create    docs/closure-plans/imported/EPIC-ARCHITECTURE.json  0 -> 1588 bytes
  create    docs/closure-plans/imported/EPIC-ARCHITECTURE__E7.json  0 -> 1687 bytes
  create    docs/closure-plans/imported/EPIC-ARCHITECTURE__E8.json  0 -> 2046 bytes
  create    docs/closure-plans/imported/EPIC-ARCHITECTURE__E9.json  0 -> 1563 bytes
  create    docs/closure-plans/imported/EPIC-ARCHITECTURE__E-UNKNOWN.json  0 -> 1572 bytes
  create    docs/closure-plans/imported/historical-index.json  0 -> 1188 bytes
────────────────────────────────────────────────────────────────────────
ledger records planned=5 archive index entries=2
reconciliationReady=true (a reconciliation state, NOT cutover approval)
```

## 3. Apply (the only writing command) + persisted conservation verification

```text
  wrote docs/closure-plans/imported/EPIC-ARCHITECTURE__E9.json
  wrote docs/closure-plans/imported/EPIC-ARCHITECTURE__E-UNKNOWN.json
  wrote docs/closure-plans/imported/historical-index.json
after: byteDelta=0 changedFiles=0

PERSISTED CONSERVATION: PASS
────────────────────────────────────────────────────────────────────────
records checked=4 historical ACTs checked=2
────────────────────────────────────────────────────────────────────────
RESULT: CONSERVATION PASS
```

## 4. Historical lookup

```text
HISTORICAL LOOKUP: ACT-CLINEMM-FACTORIZE-F3-SHADOW-RETIREMENT01
────────────────────────────────────────────────────────────────────────
act_id           ACT-CLINEMM-FACTORIZE-F3-SHADOW-RETIREMENT01
sources          imported_index, board_census
original_verdict PASS_STRUCTURAL_ONLY
epic_id          EPIC-ARCHITECTURE
work_item_ids    EPIC-ARCHITECTURE/E8
evidence         .factory/evidence/ACT-CLINEMM-FACTORIZE-F3-SHADOW-RETIREMENT01/
reconciliation   UNAMBIGUOUS
unresolved       false
source_locations .factory/epic-board.md
────────────────────────────────────────────────────────────────────────
```

## 5. Exact replay

```text
  unchanged docs/closure-plans/imported/EPIC-ARCHITECTURE__E-UNKNOWN.json  1572 -> 1572 bytes
  unchanged docs/closure-plans/imported/historical-index.json  1188 -> 1188 bytes
────────────────────────────────────────────────────────────────────────
byteDelta=0 changedFiles=0
conservation=PASS records=4 acts=2
RESULT: EXACT REPLAY CLEAN (zero unintended canonical byte delta)
```

Exit code: `0` — **zero unintended canonical byte delta**.
