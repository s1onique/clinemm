# 04 — The executable gate results

Every gate below was executed against the repaired tree. The receipts are in
`verification/`.

## 4.1 — The ACT-owned witnesses

```text
RED    (production module at HEAD)   11 failed | 6 passed (17)
GREEN  (repaired production module)  17 passed (17)
```

Receipts: `verification/red-a10-reference-trust.txt`,
`verification/green-a10-reference-trust.txt`.

## 4.2 — The necessity ablation

```text
Ablation A  alias treatment REMOVED            10 failed | 7 passed (17)
Ablation B  tool-name escaping REMOVED          1 failed | 16 passed (17)
Ablation C  single-line reduction REMOVED       1 failed | 16 passed (17)
RESTORED                                      17 passed (17)
```

Receipt: `verification/necessity-ablation.txt`.

## 4.3 — The evidence-continuity suite and the relevant compaction /
provider-projection suites

```text
Test Files  38 passed (38)
Tests       524 passed | 1 skipped (525)
```

This run includes:

- the ACT-owned suite;
- the evidence-continuity suite;
- the compaction persistence suites
  (`compaction.summary-churn01`, `compaction.stable-prefix-repair01`,
  `compaction.roundc-fidelity-recon02`);
- the PCK publication-confidentiality controls;
- the source-bound evidence containment controls and their section-boundary
  and revocation corrections;
- the source-visibility and knowledge-loss discriminators;
- the bounded-evidence-contract fixtures;
- the session-compaction persistence test and the MessageBuilder
  provider-projection test.

Receipt: `verification/gates-relevant-suites.txt`.

## 4.4 — The PCK publication confidentiality controls, in isolation

```text
Test Files  16 passed (16)
Tests       152 passed (152)
```

Receipt: `verification/gates-containment-default-off.txt`.

## 4.5 — The full core suite, compared by FAILING TEST IDENTITY

The full `@cline/core` suite was run BEFORE and AFTER the repair, and the
sets of failing test identities were compared. This is a stricter
comparison than comparing counts, because a count cannot distinguish "one
new failure plus one fixed failure" from "no change".

```text
failing identities at BASELINE   114
failing identities AFTER         114

ADDED   (new regressions)        (none)
REMOVED (fixed)                  (none)
```

```text
NEW_REGRESSIONS=0
```

Receipt: `verification/full-suite-regression-comparison.txt`,
`verification/full-suite-failing-after.txt`.

The 114 pre-existing failures are UNRELATED to this ACT. They include the
DELIBERATE RED receipts of other campaigns — for example
`pck-production-seam.red01.test.ts` ("the REAL production path does NOT yet
carry a closed working-knowledge section") and
`pck-physical-request-cardinality.red01.test.ts` ("WITHOUT the policy a PCK
request issues MORE THAN ONE physical request") — which are expected to
fail, and which were confirmed to fail IDENTICALLY at baseline.

The session/observability gate has the SAME 3 pre-existing failures as the
baseline: 3 failed, 361 passed. There were no new regressions there either.

## 4.6 — Lint

```text
Checked 9 files. No fixes applied.
```

Biome, over every ACT-owned file.

Receipt: `verification/gates-lint-typecheck.txt`.

## 4.7 — Typecheck

```text
tsc -p tsconfig.dev.json --noEmit   45 errors   (the pre-existing baseline)
ACT-owned diagnostics                0
tsc -p tsconfig.witness.json         exit 0      (the barrel witness)
```

The 45-error count is UNCHANGED from the baseline, which was measured by
stashing the change and re-running. No diagnostic mentions
`evidence-continuity`.

The barrel witness is the direct check that NO NEW PUBLIC API was added: the
package barrel is unchanged, and the typecheck that verifies the barrel's
surface passes.

Receipt: `verification/gates-lint-typecheck.txt`.

## 4.8 — The containment controls

```text
SOURCE_BOUND_EVIDENCE_CARRY_FORWARD_ENABLED = false
SOURCE_FILE_FACT_CARRY_FORWARD_ENABLED      = false
PCK opt-in env var = "CLINEMM_PCK_CLOSED_ENABLED"   (not enabled by default)
LEAMAS touched: 0
```

Receipt: `verification/gates-containment-default-off.txt`.

## 4.9 — Gates deliberately NOT run

Per the contract's "do not run unrelated repository-wide gates merely for
ceremonial completeness":

- no VSIX packaging;
- no installation;
- no live inference requests;
- no repository-wide gate outside the `@cline/core` package and the
  in-package suites that exercise this boundary.

## 4.10 — The classification and the verdict inputs

```text
CLASSIFICATION           SYNTHETIC_REAL_PRODUCTION_SEAM
A10_PREDECESSOR_RED_RECOVERED   YES
A10_CURRENT_RED                 YES (11 failed | 6 passed)
A10_GREEN                       YES (17 passed)
ACT_OWNED_DIAGNOSTICS           0
NEW_REGRESSIONS                 0
```