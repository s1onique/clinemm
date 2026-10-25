# 06 — SOURCE-BOUND ARTIFACT MANIFEST

Every artifact below is bound to an exact file state by its sha256. The
hashes were computed over the FINAL working-tree state at closure.

## Changed / added files

| # | Path | Lines | sha256 |
|---|---|---|---|
| 1 | `apps/vscode/src/sdk/sdk-session-event-coordinator.ts` (MODIFIED — the repair) | 4728 | `c7fa1b26652a80820f6c928e415be4b3f50e5edd75aa5410b617dac12f6fc27b` |
| 2 | `apps/vscode/src/sdk/__tests__/containment-failure-c10-authority-repair01.cfc10ar01.test.ts` (NEW — the ACT-owned conservation suite, 25 tests) | 891 | `dc0c9be1f8c11f7069805d4cb42bbcdef7bc223907d73cf10f3ea86c4d957597` |
| 3 | `apps/vscode/src/sdk/__tests__/containment-failure-c10-authority01.cfc10a01.test.ts` (MODIFIED — the predecessor's suite: the RED-03-B witness converted + a new deferred witness) | 1057 | `1b1e303cdd4fe99097ed082879b9bef5ba80ed51c12051ceb80a9a824c32a0a6` |
| 4 | `docs/architecture/task-lifecycle/02-c9-bcb-elm-c10-authority.md` (MODIFIED — Chart 02 A-02 predicate + conjunct table + the observation/containment distinction) | — | `e237e448a863ec97df4699e588783fc192306e795078143665f61203743e1424` |
| 5 | `docs/architecture/task-lifecycle/transitions.tsv` (MODIFIED — the `T-02` / `A-04` predicates + the NEW `A-04b` containment row) | — | `a047575d3405127ec9e34bea6c3ba80b34f1dbb75598d6f83c0fca7d1f2246bd` |

## Evidence directory (NEW)

`.factory/evidence/ACT-CLINEMM-P0-CONTAINMENT-FAILURE-C10-AUTHORITY-REPAIR01/`

| File | Content |
|---|---|
| `00-entry.txt` | R0 — the verified entry state (ENTRY_HEAD, branch, the predecessor suite, the Q5 classifier, the two C10 seams, the injection paths, the already-wired authority inputs). |
| `01-red-results.md` | R1 — the ORIGINAL failing evidence for BOTH paths, with the exact failing assertions. |
| `02-conservation-matrix.md` | R5 — the before/after conservation matrix (18 rows + the 3 R4 rows) and the classifier's semantics table. |
| `03-baseline-classification.md` | R6 — the explicit baseline-failure classification (the 8 named pre-existing suites with identical counts, and the wider pre-existing population). |
| `04-source-diff.md` | R2/R3/R4 — the source diff narrative and the scope-compliance table. |
| `05-evidence-report.md` | The evidence report: the claim, the proof, the gate table, the test results, and the evidence limits. |
| `06-artifact-manifest.md` | This file. |
| `07-verdict.md` | The verdict and the next cursor. |
| `result.json` | The machine-readable result. |

## Explicitly NOT changed

The following were inspected and deliberately left UNTOUCHED, per the ACT's
scope restrictions:

- `apps/vscode/elm/**` — the Elm kernels (no Elm kernel change).
- `apps/vscode/webview-ui/**` — the React / webview reducers.
- `proto/**` — no new protocol field.
- `apps/vscode/src/sdk/command-job-manager.ts` — the background-job
  termination machinery.
- `apps/vscode/src/sdk/background-notify-coordinator.ts` — the compact
  terminal receipt channel.
- `apps/vscode/src/sdk/SdkController.ts` — the authority inputs were ALREADY
  wired (`getBackgroundCommandJobStates` at L2664, `getBackgroundCommandJobOwners`
  at L2683); no wiring change was needed or made.

## Reproduction commands

```bash
export PATH="$HOME/.bun/bin:/opt/homebrew/bin:$PATH"
cd apps/vscode

# The ACT-owned conservation suite (25 tests)
bunx vitest run --config vitest.config.ts \
  src/sdk/__tests__/containment-failure-c10-authority-repair01.cfc10ar01.test.ts

# The predecessor's retained suite (19 tests)
bunx vitest run --config vitest.config.ts \
  src/sdk/__tests__/containment-failure-c10-authority01.cfc10a01.test.ts

# The Q5 owner-scoping gate (10 tests)
bunx vitest run --config vitest.config.ts \
  src/sdk/__tests__/premature-handoff-containment-failure01.phcf01.test.ts

# Static checks
bunx tsc --noEmit -p tsconfig.json
bunx biome lint --config-path ./biome.jsonc --no-errors-on-unmatched \
  --files-ignore-unknown=true --diagnostic-level=error \
  src/sdk/sdk-session-event-coordinator.ts \
  src/sdk/__tests__/containment-failure-c10-authority01.cfc10a01.test.ts \
  src/sdk/__tests__/containment-failure-c10-authority-repair01.cfc10ar01.test.ts

# Documentation validators (repo root)
bun scripts/verify-lifecycle-transition-contract.ts
bun scripts/verify-markdown-mermaid-blocks.ts \
  docs/architecture/task-lifecycle/01-task-turn-phase.md \
  docs/architecture/task-lifecycle/02-c9-bcb-elm-c10-authority.md \
  docs/architecture/task-lifecycle/03-background-command-containment.md \
  docs/architecture/task-lifecycle/04-completion-presentation.md
bun scripts/verify-chart04-mermaid-parse.ts \
  docs/architecture/task-lifecycle/02-c9-bcb-elm-c10-authority.md
```

## The environment note

On this macOS host the vitest DEFAULT (`forks`) pool hits a `kill EPERM`
worker-termination artifact when a suite leaves a live child process. The
`--pool=threads` pool runs the same suites deterministically and was used
for the full-suite baseline comparison. This is an ENVIRONMENT limitation,
not a code defect, and it affects the PRISTINE and the REPAIRED runs
identically.
