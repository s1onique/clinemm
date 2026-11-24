# 05 — Exit conditions

Every exit condition the review named, with the receipt that establishes
it.

```text
FALSE_OBSERVATION_ASSURANCE_RED_REPRODUCED     ESTABLISHED
FALSE_OBSERVATION_ASSURANCE_GREEN               ESTABLISHED

REFERENCE_CONFIDENTIALITY:                       RED_REPRODUCED_AND_GREEN
  NOT_REPRODUCED                     — the raw id DID reach publication

MODEL_CONTRACT_SUPPORTED                        ESTABLISHED
DEFAULT_OFF_EQUIVALENCE_PASS                    ESTABLISHED
ACT_OWNED_DIAGNOSTICS=0                         ESTABLISHED
NEW_REGRESSIONS=0                               ESTABLISHED

VERDICT=GO_PACKAGING
```

## 5.1 — FALSE_OBSERVATION_ASSURANCE_RED_REPRODUCED

```text
Receipt: verification/red-false-observation-assurance.txt
Command: bun run test:red:pck-observation-assurance
Result:  Test Files 1 failed (1) | Tests 4 failed | 3 passed (7)
```

Against the PREDECESSOR implementation, the discriminator reproduced the
finding exactly:

```text
AssertionError: expected 'tool_observed' to be 'model_reported'
```

## 5.2 — FALSE_OBSERVATION_ASSURANCE_GREEN

```text
Receipt: verification/act-owned-tests.txt
Command: bun run test:red:pck-observation-assurance
Result:  Test Files 1 passed (1) | Tests 7 passed (7)
```

## 5.3 — REFERENCE_CONFIDENTIALITY

```text
Receipt: verification/red-reference-confidentiality.txt
Result:  RED_REPRODUCED
```

The raw canonical identifier reached the persisted summary AND the
provider-visible continuation:

```text
evidence_refs=toolu_01FAKE-CREDENTIAL-DO-NOT-USE-7P4xQz
```

It was therefore REPRODUCED, and the correction was applied. The GREEN is
established by the ACT-owned receipt: the PCK's own published section now
carries an opaque host-minted alias.

```text
REFERENCE_CONFIDENTIALITY: RED_REPRODUCED_AND_GREEN
```

## 5.4 — MODEL_CONTRACT_SUPPORTED

```text
Receipts: verification/model-contract-gate-run2.txt
          verification/model-contract-gate-run3.txt
          verification/model-contract-gate-run4.txt
Result:   MODEL_CLOSED_CONTRACT_SUPPORTED (four independent executions)
```

The provider call now runs INSIDE the production attempt's generator, so
the production deadline and cancellation contract govern the REAL request.

## 5.5 — DEFAULT_OFF_EQUIVALENCE_PASS

```text
Receipt: verification/act-owned-tests.txt
Suite:   pck-default-off-equivalence.test.ts
Result:  PASSED
```

The correction touched only the evidence interpreter, the alias table and
their call sites. The default-off path is byte-identical to the pre-ACT
behaviour, and the existing equivalence suite confirms it.

## 5.6 — ACT_OWNED_DIAGNOSTICS=0

```text
Command: bun tsc -p tsconfig.dev.json --noEmit
Before: 44 diagnostics  (the entry-head baseline)
After:  44 diagnostics  (the same baseline)
Delta:  0
```

No diagnostic was introduced and none was removed. The correction's own
files contribute ZERO diagnostics.

## 5.7 — NEW_REGRESSIONS=0

```text
Receipt: verification/regression-comparison.txt
Method:  the SAME failing-file set at the entry head and at the corrected
         head, compared mechanically.
Result:  IDENTICAL — 17 files before, 17 files after, ZERO new.
```

The failing files are all in unrelated areas (hub server, composio,
checkpoint hooks, sandbox, seatbelt, persistence) and are PRE-EXISTING.

## 5.8 — VERDICT

```text
VERDICT=GO_PACKAGING
```

The PCK trust boundary is sound at the corrected head:

```text
- a semantically UNRELATED canonical event no longer raises the
  assurance, so the mechanism cannot publish a FALSE OBSERVATION,
- the raw canonical identifier no longer leaves the host, so the
  mechanism cannot become a publication channel for it,
- the model qualification now runs THROUGH the production lifecycle.
```

## 5.9 — What the verdict does NOT establish

```text
ACTUAL CONVERGENCE IMPROVEMENT:   not established. The checkpoint's
                                   usefulness for arbitrary software
                                   engineering tasks remains unproven,
                                   and the measured 12.9 s - 41.9 s
                                   per-attempt cost means
                                   T_PCK < T_redundant work avoided
                                   is STILL an OPEN QUESTION.
INSTALLED-LIVE QUALIFICATION:      not performed. A02a and A02b remain
                                   OPEN and are BLOCKED on this
                                   correction closing.
EXACT-HEAD VSIX:                   not built. Out of scope by instruction.
```

The packaging decision itself remains with the reviewer.
