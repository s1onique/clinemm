# ACT-CLINEMM-FORK-BASELINE01-CORRECTION21 — Phase 0 failure classification (final)

Per the reviewer's instruction, each of the **16 (verified count)**
production-runner integration failures in `factory/scripts/run-verification.test.ts`
was isolated and classified before any source change.

## Method

Each failing test was isolated via
`bun test factory/scripts/run-verification.test.ts -t "<name>"`. The
runner was invoked inside a hermetic `mkdtempSync` repo so stderr could
be captured.

The very first attempts of this attempt identified a `WORKTREE_INPUTS_DIRTY_AFTER` failure mode and an attempted `µC-1` postflight fix (`287642978`).
Both were reversed in `8fb5104f1` because they were addressing a
**phantom cause**: the runner's `--untracked-files=all` porcelain
command does NOT surface `.factory/` paths (they are gitignored), so
no postflight path was ever reported. The original `WORKTREE_INPUTS_DIRTY_AFTER` log was a side-effect of an intermediate runner that
included the canonical evidence directory in `EXPECTED_REPOSITORY_OUTPUT_PATHS` but the staging prefix was added later. Subsequent runs of the unmodified
runner source (post-revert) consistently show that the real first-causal line
is **`EVIDENCE_SELF_CHECK_FAILED: {"manifestContractHonored":false}`**.

## Root cause

All 16 failures share the same first causal line:

```
error: EVIDENCE_SELF_CHECK_FAILED:
  {"executionIdentityValid":true,"perCommandDriftChecked":true,
   "manifestContractHonored":false,"hashManifestValid":true,
   "commandSetExact":true,"bundledResultCommandSetExact":true,
   "missingFiles":[],"unexpectedFiles":[],
   "commandRecordMismatches":[],"malformedEvidenceCommandRows":0,
   "malformedExecutedCommandRows":0,
   "rowRelationalInvariantViolations":[],
   "bundledResultExtraCommands":[],
   "bundledResultMissingCommands":[]}
```

The runner's self-check fails at `manifestContractHonored=false` because
the CORRECTION17 schema derived from the **current evidence schema version**
(`5+`) requires every payload under `native-probes/`, plus the per-probe
metadata.json, plus the per-probe stdout/stderr files. The runner does
not yet write the per-probe external stream payloads; the fixture
inventory's `expected_evidence_payload_paths` does not declare the
canonical stream trio. Both are part of the same missing production
change, **not** a test-harness defect.

## Classification (final, post-A1-revert)

| ID | Count | Classification | Description |
| -- | ----- | --------------- | ----------- |
| A2 | 16 | **Test-harness / schema mismatch** | Runner self-check reports `manifestContractHonored=false` because the current schema (evidence version ≥5) requires a per-probe external stream trio that neither the runner nor the fixture declares. |
| D1 | 0 (counted above) | **Production implementation gap** | The runner never writes `native-probes/<id>.{stdout,stderr,metadata.json}`. This is the missing CORRECTION21 Checkpoint 1 deliverable; the test failures are the visible symptom of its absence. |
| A1 | 0 | (no postflight flag) | After revert `8fb5104f1`, runner self-check at line 1277 fires before postflight. No postflight WORKTREE_INPUTS_DIRTY_AFTER is observed. The previously-cited `WORKTREE_INPUTS_DIRTY_AFTER` was an artefact of an intermediate, currently-reverted runner state. |

Per-cause rollup: **A2: 16, D1: 0 (reached via A2), A1: 0.** All 16
tests fail at the same `manifestContractHonored=false` self-check line.

## What the table is **not**

* It is **not** "16/16 Class A1" — the previous version's A1 classification
  was the result of an intermediate (now reverted) runner state.
* It is **not** "16/16 Class A2 alone" — A2 is the surface; D1 is the
  underlying gap the ACT is intended to ship.

## Failure test → first causal line (current HEAD runner)

| # | Test name | First causal stderr line |
| - | --------- | ----------------------- |
| 01 | `ignored node_modules content does not dirty preflight` | `EVIDENCE_SELF_CHECK_FAILED: {"manifestContractHonored":false}` |
| 02 | `CORRECTION13: clean post-command sample keeps the bundle satisfiable` | `EVIDENCE_SELF_CHECK_FAILED: ...` |
| 03 | `repository output changes are permitted without entering the manifest domain` | `EVIDENCE_SELF_CHECK_FAILED: ...` |
| 04 | `resolveArgv failure still publishes stdout, stderr, and metadata payloads` | `EVIDENCE_SELF_CHECK_FAILED: ...` |
| 05 | `CORRECTION16: genuine nonexistent-executable still produces a fail row + all three payloads` | `EVIDENCE_SELF_CHECK_FAILED: ...` |
| 06 | `child exit (process.exit(7)) is reported as a real failure` | `EVIDENCE_SELF_CHECK_FAILED: ...` |
| 07 | `finalize performs one bundle preparation and does not crash` | `EVIDENCE_SELF_CHECK_FAILED: ...` |
| 08 | `successful replacement removes old evidence files` | `EVIDENCE_SELF_CHECK_FAILED: ...` |
| 09 | `CORRECTION13: production-shaped bundle is self-contained` | `EVIDENCE_SELF_CHECK_FAILED: ...` |
| 10 | `CORRECTION16: native-probes.json is staged into the bundle and hash-listed` | `EVIDENCE_SELF_CHECK_FAILED: ...` |
| 11 | `CORRECTION16: tracked mirror is informational only; verdict depends on the staged copy` | `EVIDENCE_SELF_CHECK_FAILED: ...` |
| 12 | `equal command subject values that differ from bundle subject fail` | `EVIDENCE_SELF_CHECK_FAILED: ...` |
| 13 | `renderer-derived execution identity mismatch fails despite runner assertion` | `EVIDENCE_SELF_CHECK_FAILED: ...` |
| 14 | `CORRECTION13: pass row with non-null classification fails (relational invariant)` | `EVIDENCE_SELF_CHECK_FAILED: ...` |
| 15 | `CORRECTION13: bundled verification-results.json command-set mismatch fails` | `EVIDENCE_SELF_CHECK_FAILED: ...` |
| 16 | `CORRECTION13: metadata file content disagreement fails (semantic binding)` | `EVIDENCE_SELF_CHECK_FAILED: ...` |

(Tests after row 16 in the suite are PASS or SKIP — see `bun test` total: 25 tests, 16 fail, 9 pass.)

## Reverted µC-1

The postflight patch in `287642978` was reverted in `8fb5104f1`. The
patch had two real defects the reviewer correctly identified:

1. It compared an absolute `stagingDir` to porcelain's repository-relative
   paths, which can never match.
2. It applied the staging exemption to **preflight** as well, weakening
   `worktree_inputs_clean_before` from "the repository was clean before
   any runner output was written" to "the repository was clean after
   the runner created a directory the cleanliness checker was told to
   ignore".

The current runner is identical to the pre-`287642978` state and the
self-check failure is the next contract boundary.

## Next attempt (per the reviewer's plan)

* **µC-1 (rewrite)** — Pre-staging strict preflight + relative-path
  postflight exemption. The corrected implementation must use
  `path.relative(ROOT, stagingDir)` to produce the prefix, and must
  apply the exemption only on the postflight call. Add tests that
  prove: (a) active staging accepted, (b) unrelated `.factory/`
  rejected, (c) ignored `node_modules` invisible, (d) preflight
  unchanged.
* **µC-2 — External-stream writer**: the actual CORRECTION21
  Checkpoint 1 deliverable. The runner must write
  `native-probes/<id>.{stdout,stderr,metadata.json}` and declare them
  in `expected_evidence_payload_paths` and `hashes.sha256`. The fixture
  builder must declare those paths too.
* **µC-3 — Reader authority**: require the current stream layout,
  drop embedded-stream fallback, enforce metadata normalized equality,
  with positive/negative tests.

CORRECTION21 closes only after µC-2 + µC-3 are green at HEAD on the
current evidence schema.
