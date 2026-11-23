# Verification artifacts

Raw, unedited outputs of the gates executed by this ACT. Every file here is the
**observed** stdout/stderr of the command named in
`../09-executable-gates.md`.

| File | Command | Exit |
|---|---|---|
| `red01-first-reproduction.txt` | `bun x vitest run src/extensions/context/compaction.adjudication-continuity.red01.test.ts --config vitest.config.ts` (first run) | **1** |
| `gate1-focused-red.txt` | `bun run test:red:adjudication-continuity-red01` | **1** |
| `gate2-evidence-fidelity.txt` | `bun x vitest run src/extensions/context/compaction.evidence-fidelity01.test.ts --config vitest.config.ts` | **0** |
| `gate3-context-directory.txt` | `bun x vitest run src/extensions/context/ --config vitest.config.ts` | **0** |
| `gate4-discriminator-controls.txt` | `bun x vitest run src/extensions/context/compaction.adjudication-continuity.discriminator01.test.ts --config vitest.config.ts` | **0** |
| `gate5-typecheck.txt` | `bun tsc -p tsconfig.dev.json --noEmit` | **2** (44 pre-existing baseline diagnostics, 0 ACT-owned) |

**No raw transcript, canonical message body, provider payload body, summarizer
capture body or credential is present in this directory.** The gate outputs
contain only the synthetic fixture content and the production function names.

The private historical artifacts remain in
`~/.vscodium-roz/cline-data/` and in `/tmp/cline-recon-rX/`; their SHA-256
values are recorded in `../artifact-hashes.json` under `private_input_artifacts`.
