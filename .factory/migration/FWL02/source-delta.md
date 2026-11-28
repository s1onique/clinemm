# FWL02 — Source delta since the first shadow migration

> Supplemental migration evidence. This is NOT a machine-consumed FWMI v1 input.

## Repository identity

| Field | Value |
|---|---|
| Entry head (this ACT's starting point) | `e196d0e6243f40ebfd76d2cf0db7bda74e97d6d6` |
| First shadow-migration source head | `29774ba05851f9dd5a46a33a90d963ff3ef286d5` |
| Source head of this package | `e196d0e6243f40ebfd76d2cf0db7bda74e97d6d6` |

## Board size change

| Measurement | First shadow migration | This package | Delta |
|---|---:|---:|---:|
| Root epic board lines | 44730 | 44731 | 1 |
| Root epic board bytes | 3571144 | 3571338 | 194 |

## Files changed between the two source heads

| Path | Status | From blob | To blob |
|---|---|---|---|
| `.factory/acts/ACT-CLINEMM-FWL02-INTERCHANGE-IMPORT-ADAPTER01.md` | added | `` | `5805fd5cca3b` |
| `.factory/epic-board.md` | modified | `43ca30bfeb06` | `76fba9d08eb4` |
| `.factory/epics/factory-infrastructure.md` | modified | `a67cf960ba64` | `8088ea17e102` |
| `.factory/evidence/ACT-CLINEMM-FWL02-INTERCHANGE-IMPORT-ADAPTER01/00-entry-and-scope.md` | added | `` | `adaf12503f6e` |
| `.factory/evidence/ACT-CLINEMM-FWL02-INTERCHANGE-IMPORT-ADAPTER01/01-executable-gates.md` | added | `` | `dedabdb2cb23` |
| `.factory/evidence/ACT-CLINEMM-FWL02-INTERCHANGE-IMPORT-ADAPTER01/02-operational-receipt.md` | added | `` | `72d993733a2a` |
| `.factory/evidence/ACT-CLINEMM-FWL02-INTERCHANGE-IMPORT-ADAPTER01/03-semantic-conservation-contract.md` | added | `` | `a15de96d2e6a` |
| `.factory/evidence/ACT-CLINEMM-FWL02-INTERCHANGE-IMPORT-ADAPTER01/04-residual-risk-and-operator-handoff.md` | added | `` | `2a01733b469f` |
| `.factory/evidence/ACT-CLINEMM-FWL02-INTERCHANGE-IMPORT-ADAPTER01/05-repository-conservation.md` | added | `` | `fc6f03531529` |
| `.factory/evidence/ACT-CLINEMM-FWL02-INTERCHANGE-IMPORT-ADAPTER01/artifact-hashes.json` | added | `` | `f009bff765ca` |
| `docs/closure-plans/ACT-CLINEMM-FWL02-INTERCHANGE-IMPORT-ADAPTER01.json` | added | `` | `1abaa0c8367e` |

## What the delta contains

The delta between the first shadow-migration source and this package's source head is
exactly the three-commit experimental FWMI adapter episode and its supersession:

1. `95234b6b6` — the experimental TypeScript FWMI adapter was implemented in ClineMM.
2. `1d8a204df` — the adapter's evidence packet was bound to its final head.
3. `e196d0e62` — the adapter was DISOWNED and removed. Ownership was clarified:
   Leamas is the sole implementation owner of the ledger and its FWMI consumer;
   ClineMM is the producer of the migration data.

Two of the three commits touch the engineering-state documentation:

- `.factory/epic-board.md` gains ONE row — the FWL02 producer-side row in the
  board's "Open supporting work" table.
- `.factory/epics/factory-infrastructure.md` gains the superseded-adapter ledger
  row, a new "Ownership" section, and the FWL02 producer-side Open-work bullet.

The third commit and the adapter evidence packet are NOT engineering-state
documentation: they are the historical record of the superseded experiment. The
migration preserves that record's disposition (the adapter is SUPERSEDED and is
NOT an active capability) without treating its importer as a live capability.

## Consequence for the migration

Because the source head advanced, the board grew by one line and one byte-bound
row relative to the first shadow migration. The migration binds every assertion to
the CURRENT source head, so the FWL02 producer-side obligation is represented as a
current work item rather than being absent. The first shadow migration's counts
are NOT target values for this package; the recovered inventory is reported from
the actual source.
