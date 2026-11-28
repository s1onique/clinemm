# FWL02 migration package producer

The FWMI v1 migration interchange package producer for
`ACT-CLINEMM-FWL02-B-HISTORICAL-RECONCILIATION-01`.

## Pipeline order

The three writers MUST be run in this order:

```bash
bun factory/scripts/fwl02/generate.ts     # wipes + writes the package
bun factory/scripts/fwl02/supplemental.ts  # writes the supplemental artifacts
bun factory/scripts/fwl02/validate.ts      # writes the validation receipt
```

`generate.ts` starts with `rmSync(PACKAGE_DIR, { recursive: true })`, so it
DELETES the artifacts the other two writers produce. Running `supplemental.ts`
or `validate.ts` and then `generate.ts` leaves the package missing
`source-accounting.json`, `decisions-and-knowledge-index.json`,
`source-delta.md` and `validation-receipt.json`.

The package scripts are the same steps:

```bash
bun run factory:fwl02:generate
bun run factory:fwl02:supplemental
bun run factory:fwl02:validate
bun run factory:fwl02:test
bun run verify:fwl02-typecheck
```

## The frozen source head

The package is reconciled FROM the committed revision
`e196d0e6243f40ebfd76d2cf0db7bda74e97d6d6`, frozen in `source-refs.ts` as
`FWL02_FROZEN_SOURCE_HEAD`. The generator, the supplemental writer and the
validator all resolve that revision — never `HEAD` — so the package is
reproducible after the publication commit advances `HEAD`.

## The reconciliation identity

The actual Leamas Go consumer derives the durable migration identity of a
reconciliation record from its `kind`, its `resolution` and the SORTED
`identities` it concerns (`internal/ledger/fwmi/migration.go`, `migrationIDOf`).
Two DISTINCT records that claim the same identity are REJECTED with
`conflicting reconciliation identity`, because the second would overwrite the
first and a lost reconciliation is a lost obligation.

The producer therefore emits ONE authoritative reconciliation record per
reconciliation identity. `contract.ts` exposes `reconciliationIdentityKey()`,
which computes the key exactly as the consumer computes it, and the validator
check `RECONCILIATION.NO_CONFLICTING_IDENTITY` rejects any package that
regresses to two records claiming one identity.

A superseded assessment cannot remain a second record for the same identity:
it is retained in `source-accounting.json` under `superseded_assessments`
instead — source-bound supplemental migration evidence, outside the
machine-consumed wire package.

## Fixtures

`__fixtures__/previous-reconciliation.json` is the reconciliation manifest of
the previous (pre-correction) package, captured verbatim. It is the RED
control for the conflicting-identity check: it still carries the two colliding
`.factory/epic-board.md` records that the consumer rejected.
