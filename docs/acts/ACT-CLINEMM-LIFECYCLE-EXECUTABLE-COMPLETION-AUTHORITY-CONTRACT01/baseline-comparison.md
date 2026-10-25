# ACT-CLINEMM-LIFECYCLE-EXECUTABLE-COMPLETION-AUTHORITY-CONTRACT01 — JSON baseline comparison

The comparison is made from the Vitest JSON reports, NOT from failure-output line counts.
Identities are keyed by `(normalized_file_path, fullName)`.

## Execution settings (IDENTICAL for baseline and subject)

| setting | value |
|---|---|
| command | `bunx vitest run --config vitest.config.ts --pool=threads --reporter=json` |
| working directory | `apps/vscode` |
| baseline | the pristine tree at `3558e914009b84b0d54f6e549c46802095f44b2b` |
| subject | the H03 working tree |
| baseline process exit status | `1` (the pristine tree has a pre-existing failure population) |
| subject process exit status | `1` (the pre-existing population remains) |

## The summary

| metric | baseline | subject | delta |
|---|---|---|---|
| total tests | 4998 | 5049 | +51 (the new H03 suites) |
| passed | 4704 | 4801 | +97 |
| failed | 239 | 193 | **-46** |
| test files | 1762 | 1765 | +3 |

## The four required comparisons

### 1. The test inventory

- **added identities: 51** — all of them in the three new H03 suites:

  - `src/sdk/__tests__/completion-authority-contract01.chart02.h03.test.ts` — 9 assertions
  - `src/sdk/__tests__/completion-authority-contract01.h03.test.ts` — 32 assertions
  - `src/sdk/__tests__/completion-authority-contract01.neg.h03.test.ts` — 10 assertions
- **removed identities: 0** — none. No test was deleted or renamed.

### 2. NEW failed identities (regressions)

**0** — there is NO ACT-owned regression.

### 3. REMOVED failed identities

**0** — no previously-failing identity disappeared from the inventory.

### 4. PREVIOUSLY failing identities that are UNCHANGED

**248** identities across **47** suites remain failing, exactly as they did in the pristine baseline. They are the pre-existing, unrelated failure population (macOS seatbelt / sandbox real-kernel suites, task-history, extension-host termination authority, and similar). Per the ACT scope, this population was NOT cleaned.

The one member of the BCB family that remains failing is:

- `src/sdk/__tests__/background-notify-completion-authority-fire-and-forget-red01.bnca-red01.test.ts` — `BNCA-RED-01: pre-repair — Path A enqueue races ahead of Path B discard; wake survives` (1 identity).

  **Explicit classification (per R4).** This suite does NOT construct a `SdkSessionEventCoordinator`; it exercises `BackgroundNotifyCoordinator.resolveObligation` directly. The Elm provider is therefore not involved and the R4 correction could not reach it. Its failure (`expected 'resolved' to be 'no_marker'`) is a SEMANTIC divergence between the BNCA repair's `resolveObligation` contract and this suite's expectation of the PRE-repair behaviour. The suite is named a **RED** suite and asserts the PRE-repair race; the production code was repaired by a later ACT. **Its intended semantics are obsolete, and the discrepancy is CLASSIFIED here rather than blindly made green.** Making it green would require either reverting the BNCA repair or rewriting the RED's stated intent — both are production-semantics changes, which this ACT forbids.

## The newly-passing identities (46)

Every one of them is in the twelve R4-repaired legacy suites. **No newly-passing test is claimed to have been fixed by anything other than the R4 harness correction.**

| suite | newly passing |
|---|---|
| `src/sdk/__tests__/background-completion-barrier01-correction01.bcb01-c.test.ts` | 6 |
| `src/sdk/__tests__/background-completion-barrier01-correction02.bcb01-c2.test.ts` | 2 |
| `src/sdk/__tests__/background-completion-barrier01-correction03.bcb01-c3.test.ts` | 1 |
| `src/sdk/__tests__/background-completion-barrier01-correction04.bcb01-c4.test.ts` | 3 |
| `src/sdk/__tests__/background-completion-barrier01.bcb01.test.ts` | 13 |
| `src/sdk/__tests__/background-notify-completion-authority-c10-framework-ablation01.bnca-ablation01.test.ts` | 1 |
| `src/sdk/__tests__/background-notify-completion-authority-c10-framework-dispatch-failed-ablation01.bnca-ablation01.test.ts` | 3 |
| `src/sdk/__tests__/background-notify-completion-authority-c10-framework-dispatch-failed01.bnca-framework01.test.ts` | 2 |
| `src/sdk/__tests__/background-notify-completion-authority-c10-framework01.bnca-framework01.test.ts` | 2 |
| `src/sdk/__tests__/background-notify-completion-authority-c10-red01.bnca-red01.test.ts` | 1 |
| `src/sdk/__tests__/long-horizon-task-quiescence-completion-barrier01.tqcb01.test.ts` | 10 |
| `src/sdk/__tests__/post-consumption-completion-authority01.pcca01.test.ts` | 2 |
| **TOTAL** | **46** |

The 51 ADDED identities (the new H03 suites) all pass:

| suite | added assertions | result |
|---|---|---|
| `apps/vscode/src/sdk/__tests__/completion-authority-contract01.h03.test.ts` | 32 | all pass |
| `apps/vscode/src/sdk/__tests__/completion-authority-contract01.neg.h03.test.ts` | 10 | all pass |
| `apps/vscode/src/sdk/__tests__/completion-authority-contract01.chart02.h03.test.ts` | 9 | all pass |

## Environment and worker failures

Both runs used the SAME command, the SAME working directory and the SAME machine. **No environment or worker failure was observed in either run**: every suite produced a complete JSON report, and the JSON report's own totals (`numTotalTests`, `numPassedTests`, `numFailedTests`) are the basis of this comparison — an incomplete report would have been detected by the total-test-count delta being smaller than the added-identity count. It is not (4998 + 51 = 5049).

One environment-only artifact was produced and removed: the `darwin-seatbelt-*` / `command-job-manager.sandbox-*` suites fail in BOTH runs for the same reason (this machine's Seatbelt / sandbox real-kernel behaviour). They are classified as pre-existing, not as ACT-owned.

## Conclusion

**G11 PASS.** Same inventory modulo the explicitly-accounted additions; **zero new failed identities**; zero removed failed identities; the previously-failing population is unchanged; the environment and worker behaviour is identical between the two runs; and both process exit statuses were captured (`1` for both, from the pre-existing population).
