# verification/ — raw executable transcripts

Every file here is the RAW stdout/stderr of one gate command, captured in
the working tree at the time it was run. Nothing is hand-edited.

| File | Command | Exit |
|---|---|---|
| `gate1-focused-probe.txt` | `bun x vitest run src/extensions/context/compaction.adjudication-output-contract.probe01.test.ts --config vitest.config.ts` | 0 |
| `gate2-historical-discriminator.txt` | `bun x vitest run src/extensions/context/compaction.adjudication-continuity.discriminator01.test.ts --config vitest.config.ts` | 0 |
| `gate3-evidence-fidelity.txt` | `bun x vitest run src/extensions/context/compaction.evidence-fidelity01.test.ts --config vitest.config.ts` | 0 |
| `gate4-context-directory.txt` | `bun x vitest run src/extensions/context/ --config vitest.config.ts` | 0 |
| `gate5-typecheck.txt` | `bun tsc -p tsconfig.dev.json --noEmit` | 2 (pre-existing baseline) |
| `gate6-red-preserved.txt` | `bun x vitest run --config vitest.red.adjudication-continuity-red01.config.ts` | 1 (EXPECTED: the RED must fail) |
| `gate7-biome.txt` | `bunx biome check --diagnostic-level=error <both changed files>` | 0 |
| `gate8-live-model-probe.txt` | `CORE_LIVE_ADJUDICATION_PROBE=1 bun scripts/adjudication-output-contract.live-probe.ts` | 0 |

All commands were run from `sdk/packages/core` except gate 7, which was run
from the repository root.

## Confidentiality

`gate8-live-model-probe.txt` is the SANITIZED observation report: it
contains provider/model identifiers, boolean observations, the parsed
decision and the qualification codes. It contains NO credential, NO raw
provider payload, and NO free-form model prose.

The raw provider responses captured during the live experiment were written
to a PRIVATE temp path outside the repository and are deliberately NOT
committed. Only sanitized synthetic fixture data belongs in Git.
