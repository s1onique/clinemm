# FWL02 — Source delta since the first shadow migration

> Supplemental migration evidence. This is NOT a machine-consumed FWMI v1 input.

## Repository identity

| Field | Value |
|---|---|
| Entry head (this ACT's starting point) | `e196d0e6243f40ebfd76d2cf0db7bda74e97d6d6` |
| First shadow-migration source head | `29774ba05851f9dd5a46a33a90d963ff3ef286d5` |
| Source head of this package (FROZEN) | `e196d0e6243f40ebfd76d2cf0db7bda74e97d6d6` |

## Why the source head is frozen

The package's source head is an EXPLICIT committed revision, not `HEAD`.
The package's own publication commit advances `HEAD`; deriving the source head
from `HEAD` at generation time would rebind every assertion to the publication
commit itself and make the package non-reproducible and self-referential. The
frozen head is the repository state the migration was reconciled FROM:
`e196d0e6243f40ebfd76d2cf0db7bda74e97d6d6`.

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

## The CORRECTION-02 correction of the reconciled inventory

This package is the CORRECTED successor of the original FWL02 producer package.
The correction changed the PRODUCER's reconciliation, not the source: the source
head is unchanged at `e196d0e6243f40ebfd76d2cf0db7bda74e97d6d6`, and every
assertion is still bound to the exact committed bytes it was derived from.

Four bounded defects were corrected:

1. **Wire compatibility.** The package emitted a `relationships` field that the
   actual Leamas Go consumer does not have, omitted the nested `schema_version` on
   every work item, historical record and reconciliation record, and used a
   globally-scoped `item_id`. The consumer's strict decoder rejected all three.
   All relationship kinds now live in the `dependencies` array, every nested record
   carries `schema_version: 1`, and every item identity is local to its epic.
2. **Prerequisite direction.** The architecture package emitted E8 DEPENDS_ON E9
   alongside E9 DEPENDS_ON E8, a cycle that contradicted the recovered `E7 -> E8
   -> E9 -> ELMIZATION02` ordering. The reversed edge is withdrawn; E7 remains an
   explicit blocker on E8 and is not invented as an obligation.
3. **One authoritative obligation per identity.** Four duplicate groups carried
   independent lifecycle-bearing records. Each group now has exactly one
   authoritative obligation; the secondary representations are conserved in the
   reconciliation records and in `source-accounting.json`.
4. **Historical source accounting.** The board's trailing region 9,542-44,731 was
   assumed to be narrative history. It is not: it carries 205 further ACT report
   sections at heading level 2, belonging to 149 distinct historical identities
   the level-1-only extraction had skipped. The corrected extraction indexes 361
   report sections carrying 316 distinct identities.

The corrected inventory is therefore NOT the previous one: 45 obligations (not 50)
and 316 historical identities (not 167). Neither count was tuned to reproduce a
previous value; both are what the actual source yields under the corrected
reconciliation.
