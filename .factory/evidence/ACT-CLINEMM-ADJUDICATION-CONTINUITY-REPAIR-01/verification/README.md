# Verification — raw gate outputs

These are the **raw, unedited** outputs of the executable gates run by
`ACT-CLINEMM-ADJUDICATION-CONTINUITY-REPAIR-01`.

Toolchain: Bun 1.4.4, Vitest 4.1.10, TypeScript via `bun tsc`, Biome via
`bun x biome`. All commands were run from `sdk/packages/core`.

| File | Gate | Command | Exit code | Result |
|---|---|---|---|---|
| `gate1-red.txt` | 1 | `bun run test:red:adjudication-continuity-red01` | **1** | 5 failed / 5 — RED preserved |
| `gate2-discriminator.txt` | 2 | `bun x vitest run src/extensions/context/compaction.adjudication-continuity.discriminator01.test.ts --config vitest.config.ts` | 0 | 24 passed |
| `gate2b-feasibility-probe.txt` | 2b | `bun x vitest run src/extensions/context/compaction.adjudication-continuity.feasibility01.test.ts --config vitest.config.ts` | 0 | 16 passed |
| `gate2-evidence-fidelity.txt` | 2 | `bun x vitest run src/extensions/context/compaction.evidence-fidelity01.test.ts --config vitest.config.ts` | 0 | 39 passed |
| `gate3-context-directory.txt` | 3 | `bun x vitest run src/extensions/context/ --config vitest.config.ts` | 0 | 496 passed / 2 skipped |
| `gate4-typecheck.txt` | 4 | `bun tsc -p tsconfig.dev.json --noEmit` | 2 | 44 diagnostics (baseline 44; ACT-owned 0) |
| `gate5-biome.txt` | 5 | `bun x biome check <changed test files>` | 0 | no fixes; 1 pre-existing `info` |
| `production-diff.txt` | 5 | `git diff --stat a493eff07..HEAD -- ':(exclude).factory/**' ':(exclude)sdk/packages/core/src/**/*.test.ts'` | 0 | only the predecessor's test-harness files |

**Confidentiality.** No raw model reasoning, historical verdict prose,
credential, private path or provider payload body appears in any of these
outputs. The only credential-shaped string is the standard synthetic
placeholder `AKIAIOSFODNN7EXAMPLE`, used by the predecessor's own negative
control and by the feasibility probe's control D.

**Not in this directory.** The frozen canonical snapshot of session
`1795394987994_fpu77` lives OUTSIDE the repository at `/tmp/cline-recon-rX/`
and was read-only. It is **not committed**. Its SHA-256 is
`9ca5309aa18e43c97343d87171de20f2a198f6ccfe8f266c1f1c33557afa5dcd`.
