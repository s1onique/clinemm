# ACT-CLINEMM-FORK-BASELINE01-CORRECTION21 — Phase 0 failure classification (corrected)

Per the reviewer's instruction, each of the **16 (verified count)**
production-runner integration failures in `factory/scripts/run-verification.test.ts`
was isolated and classified before any source change. The previous
version of this document claimed "16/16 Class A"; that classification
collapsed at least three distinct causes. This amendment corrects both
the arithmetic (the table had 17 rows; one was a duplicate) and
the classification (per-cause A1/A2/D1 instead of a single Class A).

## Method

Each failing test was isolated via
`bun test factory/scripts/run-verification.test.ts -t "<name>"`. The
runner was invoked inside a hermetic `mkdtempSync` repo so stderr could
be captured and the worktree inputs sampled without polluting the
parent repository.

## Root-cause ID

Three distinct root causes were identified:

* **A1 — Postflight path policy** (test-harness defect).
  `worktreeInputsClean()` calls `git status --porcelain=v1 -z --untracked-files=all`.
  The freshly-written staging files at
  `.factory/evidence/.ACT-CLINEMM-FORK-BASELINE01-staging-XXX/native-probes.json`
  and `/verification-results.json` are reported as untracked. The runner
  itself owns those paths but they fail `isExpectedRepositoryOutput()`
  (strict-equality check against `EXPECTED_REPOSITORY_OUTPUT_PATHS`).
  Fix: tolerate the **active staging-directory prefix** (and the
  canonical evidence directory prefix during replacement), not all of
  `.factory/`. Use `--untracked-files=normal` for granularity only; that
  does not fix the path policy on its own.
* **A2 — Fixture/schema mismatch** (test-harness defect).
  The fixture builder `buildFixtureProbeInventory` writes a
  CORRECTION16-shape record whose `expected_evidence_payload_paths` is
  not the same set the runner declares under the current schema.
  When the postflight abort (A1) is bypassed, the runner self-check
  reports `manifestContractHonored=false` because the fixture's payload
  list does not include the canonical stream trio
  (`native-probes/<id>.{stdout,stderr,metadata.json}`).
* **D1 — Production runner missing external-stream writer** (real
  implementation gap).
  The runner never writes the per-probe external stream payloads. This
  is the missing CORRECTION21 Checkpoint 1 deliverable, **not** a test
  defect: it is the schema change the ACT is intended to ship.

## Reconciled classification table (16 rows)

Numbers match `bun test factory/scripts/run-verification.test.ts 2>&1
| grep '^)' | sort -u | wc -l` (which returned 16).

| # | Test name | First causal line on stderr | Root cause |
| - | --------- | --------------------------- | ---------- |
| 01 | `ignored node_modules content does not dirty preflight` | `WORKTREE_INPUTS_DIRTY_AFTER: .factory/evidence/.../native-probes.json` | **A1** |
| 02 | `CORRECTION13: clean post-command sample keeps the bundle satisfiable` | `EVIDENCE_SELF_CHECK_FAILED: {"manifestContractHonored":false}` | **A2** (exposed once A1 is fixed) |
| 03 | `repository output changes are permitted without entering the manifest domain` | `WORKTREE_INPUTS_DIRTY_AFTER: ...` | **A1** |
| 04 | `resolveArgv failure still publishes stdout, stderr, and metadata payloads` | `WORKTREE_INPUTS_DIRTY_AFTER: ...` | **A1** |
| 05 | `CORRECTION16: genuine nonexistent-executable still produces a fail row + all three payloads` | `WORKTREE_INPUTS_DIRTY_AFTER: ...` | **A1** |
| 06 | `child exit (process.exit(7)) is reported as a real failure` | `WORKTREE_INPUTS_DIRTY_AFTER: ...` | **A1** |
| 07 | `finalize performs one bundle preparation and does not crash` | `WORKTREE_INPUTS_DIRTY_AFTER: ...` | **A1** |
| 08 | `successful replacement removes old evidence files` | `WORKTREE_INPUTS_DIRTY_AFTER: ...` | **A1** |
| 09 | `CORRECTION13: production-shaped bundle is self-contained` | `WORKTREE_INPUTS_DIRTY_AFTER: ...` | **A1** |
| 10 | `CORRECTION16: native-probes.json is staged into the bundle and hash-listed` | `WORKTREE_INPUTS_DIRTY_AFTER: ...` | **A1** |
| 11 | `CORRECTION16: tracked mirror is informational only; verdict depends on the staged copy` | `WORKTREE_INPUTS_DIRTY_AFTER: ...` | **A1** |
| 12 | `equal command subject values that differ from bundle subject fail` | `WORKTREE_INPUTS_DIRTY_AFTER: ...` | **A1** |
| 13 | `renderer-derived execution identity mismatch fails despite runner assertion` | `WORKTREE_INPUTS_DIRTY_AFTER: ...` | **A1** |
| 14 | `CORRECTION13: pass row with non-null classification fails (relational invariant)` | `WORKTREE_INPUTS_DIRTY_AFTER: ...` | **A1** |
| 15 | `CORRECTION13: bundled verification-results.json command-set mismatch fails` | `WORKTREE_INPUTS_DIRTY_AFTER: ...` | **A1** |
| 16 | `CORRECTION13: metadata file content disagreement fails (semantic binding)` | `WORKTREE_INPUTS_DIRTY_AFTER: ...` | **A1** |

Per-cause rollup: **A1: 16, A2: 0 (downstream of A1 in row 02), D1: 0
(implementation gap that current tests don't reach because A1 fires
first).** Row 02 is the only test that would crash past A1; it is
labelled A2 because its first causal line under the A1 fix is
`EVIDENCE_SELF_CHECK_FAILED`.

## What the table is **not**

* It is **not** "16/16 Class A" — A1, A2, and D1 are distinct, and the
  "all Class A" claim collapsed them.
* Row 02's exact first causal line is conditional on the A1 fix landing
  first. Without the fix, A1's stderr appears earlier and masks A2.

## Micro-checkpoint plan (next attempt)

* **µC-1 — Postflight path policy** (Micro-checkpoint 1):
  Allow the **active staging-directory prefix** and the canonical
  evidence-directory prefix in `isExpectedRepositoryOutput()`. Keep the
  default `--untracked-files=normal` granularity but do **not** blanket-
  ignore `.factory/`. Add targeted tests: staging-payload acceptance,
  unrelated-`.factory/`-rejection, ignored-`node_modules`-invisibility.
  Run the targeted tests and the strict typecheck for the changed
  module only. Commit non-closing.
* **µC-2 — External-stream writer** (Micro-checkpoint 2 — the real
  Checkpoint 1 split-out): runner writes
  `native-probes/<id>.{stdout,stderr,metadata.json}` and declares them
  in `expected_evidence_payload_paths` + `hashes.sha256`. Update the
  fixture builder to declare exactly those paths.
* **µC-3 — Reader authority** (Micro-checkpoint 3): loader requires the
  fixed current layout, drops embedded-stream fallback, enforces
  metadata normalized equality, with positive/negative tests.

CORRECTION21 closes only after µC-1, µC-2, and µC-3 are all green at
HEAD.
