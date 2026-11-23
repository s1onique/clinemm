# verification/ — raw executable transcripts

Every file here is the RAW stdout/stderr of one gate command, captured
in the working tree at the time it was run. Nothing is hand-edited.

| File | Command | Exit |
|---|---|---|
| `gate1-focused-probe-correction01.txt` | `bun x vitest run src/extensions/context/compaction.adjudication-output-contract.probe01.test.ts src/extensions/context/compaction.adjudication-output-contract.correction01.test.ts --config vitest.config.ts` | 0 |
| `gate4-context-directory-correction01.txt` | `bun x vitest run src/extensions/context/ --config vitest.config.ts` | 0 |
| `gate5-typecheck-correction01.txt` | `bun tsc -p tsconfig.dev.json --noEmit` | 2 (pre-existing baseline) |
| `gate6-red-preserved-correction01.txt` | `bun x vitest run --config vitest.red.adjudication-continuity-red01.config.ts` | 1 (EXPECTED: the RED must fail) |
| `gate7-biome-correction01.txt` | `bunx biome check --diagnostic-level=error <the three changed files>` | 0 |
| `gate8-live-model-probe-correction01.txt` | `CORE_LIVE_ADJUDICATION_PROBE=1 CORE_LIVE_ADJUDICATION_PROVIDER_KEY=minimax CORE_LIVE_ADJUDICATION_RUNS=10 bun scripts/adjudication-output-contract.live-probe.ts` | 0 |

All commands were run from `sdk/packages/core` except gate 7, which was
run from the repository root.

## Gate 8 — the ten bound receipts

`gate8-live-model-probe-correction01.txt` contains **ten** distinct live
observations, one per run, each emitted as its own JSON object. The
transcript ends with the aggregate report whose `observation_count` is
`10`.

Every statistic in `02-live-receipts.md` is derived from this file alone.
To re-derive them, parse the final report object and count the boolean
fields.

The harness emits, per run:

```text
schema_valid, canonical_refs_resolved, source_revision_bound,
candidate_accepted, publishedTurnIndex, publishedCarrierIndex,
publishedTurnAlsoCarriedToolUse, publishedTurnToolCallIds,
publishedAfterToolResult, unresolvedEvidenceIds,
acceptance_rejection_reason, turns
```

## Confidentiality

The gate 8 transcript is the SANITIZED observation report: it contains
provider/model identifiers, boolean observations, the parsed decision and
the qualification codes. It contains NO credential, NO raw provider
payload, and NO free-form model prose.

The raw provider responses captured during the live experiment were
written to a PRIVATE temp path outside the repository and are
deliberately NOT committed. Only sanitized synthetic fixture data
belongs in Git.

## What this ACT did NOT re-run

Per the reviewer's scope, this correction required no full-suite rerun,
no historical replay and no new memory system. The predecessor's gates 2
(historical discriminator) and 3 (evidence fidelity) are unaffected by
this ACT — it changed no production module and no pre-existing test — and
their predecessor transcripts remain valid as committed. The context
directory (gate 4) was re-run and covers both of them indirectly.
