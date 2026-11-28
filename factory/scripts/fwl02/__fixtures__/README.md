# FWL02 test fixtures

## `previous-reconciliation.json`

The reconciliation manifest of the PREVIOUS (pre-correction) FWMI v1 producer
package, captured verbatim from the published package.

It exists as the RED control for the deterministic conflicting-reconciliation
identity check. The previous package carried TWO records that claimed the SAME
reconciliation identity:

| field    | value                       |
| -------- | --------------------------- |
| kind     | `INCOMPLETE_COVERAGE`       |
| resolution | `RESOLVED`                |
| identities | `[".factory/epic-board.md"]` |

One described an INCOMPLETE inventory of 167 historical ACT identities; the
other described the CORRECTED inventory of 316. The actual Leamas Go consumer
derives the durable migration identity of a reconciliation record from exactly
those three fields — `kind`, `resolution` and the SORTED identities — so the
two records collided, and the consumer rejected the package with
`conflicting reconciliation identity` before publication.

The corrected package emits ONE authoritative record for this identity. This
fixture keeps the previous shape recoverable so the check can be shown to
DETECT the collision (RED) and to PASS against the corrected package (GREEN).
