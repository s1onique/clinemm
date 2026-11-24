# 09 — The executable gates

```text
ACT: ACT-CLINEMM-PCK-OUTPUT-TRUST-BOUNDARY-01
ENTRY_HEAD: 0f111f3d76a7e7da9b792cfd173d88635156182c
```

| # | Gate | Requirement | Result | Evidence |
|---|---|---|---|---|
| 1 | Entry identity and protected evidence verified | required | **PASS** | `00-entry-and-source-identity.md`, `verification/predecessor-source-hashes.txt`, `verification/frozen-artifact-hashes.txt` |
| 2 | Actual checkpoint publication path mapped | required | **PASS** | `01-publication-boundary-map.md` — 10 transitions, each labelled REAL or TEST-LOCAL; all five named functions re-verified at this HEAD |
| 3 | Dummy-secret RED reproduced against the real test-local projection | required | **PASS** | `02-confidentiality-red.md` — 9 assertions; the REAL exported `renderCheckpointSection()` is the function exercised |
| 4 | Injection-text RED reproduced | required | **PASS** | `03-injection-red.md` — 7 assertions; `INSTRUCTION_TEXT_PERSISTED = TRUE`, `DOWNSTREAM_UNAUTHORIZED_ACTION = NOT_EXECUTED` |
| 5 | Candidate-contract comparison completed | required | **PASS** | `04-candidate-contract-comparison.md` — A, B and C implemented and measured; selected A |
| 6 | At least 10 confidentiality/adversarial controls | ≥10 | **PASS — 31** | `05-security-negative-controls.md` — S1–S10 plus 13 injection/memory-poisoning controls plus 8 downstream-action controls |
| 7 | R2/R4/R6 utility controls | required | **PASS** | `06-knowledge-utility.md` — G5.1, G5.2, G5.3 |
| 8 | Unrelated-repository genericity control | required | **PASS** | `06-knowledge-utility.md` §6.4 — G5.4 |
| 9 | Causal ablation | required | **PASS** | `07-causal-ablation.md` — A, B, C, D, E |
| 10 | Real compaction/provider-message seam | required | **PASS** | `08-persistence-and-provider-projection.md` — the real `createCompactionStateAwarePrepareTurn` → `runAgenticCompaction` → `MessageBuilder.buildForApi` chain |
| 11 | Sidecar persistence boundary checked | required | **PASS** | `08-…` §8.2/§8.3 — the real `createSessionCompactionState()` is exercised; the schema is unchanged |
| 12 | Existing context test suite | required | **PASS** | `verification/context-suite-regression.txt` — 832 passed, 2 skipped, 0 failed / 53 files passed, 1 skipped |
| 13 | Typecheck and Biome | required | **PASS** | `verification/typecheck.txt` (44 baseline, 0 ACT-owned), `verification/biome.txt` (exit 0, 10 files checked) |
| 14 | Production-source delta zero | required | **PASS** | `verification/production-delta.txt` — `git diff --stat HEAD` is empty |

## 9.1 — The command ledger

Every command was run from the repository root unless noted.

```text
GATE 1  git rev-parse HEAD
        git rev-parse --abbrev-ref HEAD
        git --no-pager status --porcelain=v1
        git --no-pager stash list
        bun --version                                  -> 1.4.4
        grep '"vitest":' package.json                  -> ^4.0.18
        shasum -a 256 on each predecessor source file

GATE 3/4  cd sdk/packages/core && bun x vitest run --config vitest.config.ts \
            --reporter=verbose src/extensions/context/output-trust-boundary/

GATE 6-9  cd sdk/packages/core && bun x vitest run --config vitest.config.ts \
            --reporter=verbose src/extensions/context/output-trust-boundary/

GATE 10/11 cd sdk/packages/core && bun x vitest run --config vitest.config.ts \
            --reporter=verbose src/extensions/context/output-trust-boundary/production-seam.test.ts

GATE 12 cd sdk/packages/core && bun x vitest run --config vitest.config.ts \
            src/extensions/context/

GATE 13 cd sdk/packages/core && bun tsc -p tsconfig.dev.json --noEmit
        bun x --bun @biomejs/biome check \
            sdk/packages/core/src/extensions/context/output-trust-boundary/

GATE 14 git --no-pager diff --stat HEAD
        git --no-pager status --porcelain=v1
```

## 9.2 — The TypeScript baseline, re-measured

The predecessor recorded **44** diagnostics. The ACT re-measured rather than
assumed, and compared the exact identities:

```text
Baseline (predecessor ACT): 44
Measured now:                44
ACT-owned (output-trust-boundary): 0
Difference:                  0
```

The 44 diagnostics are all in files this ACT did not touch. Their exact
identities (file, line, column, code, message) are recorded in
`verification/typecheck.txt`.

## 9.3 — The scope discipline (G8, "avoid a full repository-wide suite")

The focused executable evidence points at exactly one covered area: the
checkpoint publication path in `sdk/packages/core/src/extensions/context/`.
The ACT therefore ran:

- the **ACT-owned** suite (63 assertions / 6 files),
- the **existing context suite** (834 assertions / 54 files) — the suite that
  owns the compaction, task-contract, evidence-continuity and adjudication
  machinery the checkpoint touches.

No repository-wide suite was run, because no focused executable evidence
pointed at a regression outside the covered area. The production delta is
zero, so no file outside the ACT's own directory could have regressed.

## 9.4 — No intentionally failing test was left behind

```text
The RED suites are GREEN against the CURRENT tree because they assert the
OBSERVED behaviour of the predecessor's projection, which is unchanged.

  confidentiality-red.test.ts  asserts that the leak IS present ->
  the suite PASSES while the leak is present.  It is a RECEIPT of the
  defect, not a failing test.

  injection-red.test.ts          asserts that the instruction IS published ->
  same.

These are not left failing, and they do not fail the default suite. They
are self-contained witnesses that would FAIL if the predecessor's projection
were ever repaired — which is the correct behaviour for a receipt.

The isolation discipline the predecessor established is preserved: the
historical thinking-only RED
(compaction.adjudication-continuity.red01.test.ts) remains excluded from the
default suite and was NOT touched by this ACT.
```

## 9.5 — What was NOT done

```text
NOT DONE  No production source was modified.
NOT DONE  No VSIX was built, packaged or installed.
NOT DONE  No live Round C replay.
NOT DONE  No model-generation experiment was launched (G7.1 maximum: 2
          calls; 0 were needed — the static trust contract was decisive).
NOT DONE  The full Keycloak task was not re-run.
NOT DONE  The `agentic_summary` serializer was not modified.
NOT DONE  SOURCE_FILE_FACT_CARRY_FORWARD_ENABLED was not enabled.
NOT DONE  No public API, protocol field or persistence schema was added.
NOT DONE  The adjudication-specific machinery was not broadened.
NOT DONE  The installed `codium-roz` extension was not changed.
```

## 9.6 — The private-artifact policy

```text
Committed: synthetic dummy-secret fixtures and sanitised gate results.
NOT committed: the raw session transcript, the provider payloads, the private
reasoning and any generated checkpoint free text. Those remain operator-local
at their existing paths and were re-verified by digest
(verification/frozen-artifact-hashes.txt).

No real credential appears in any committed artifact. The credential-shaped
strings that DO appear in the committed test sources are all synthetic and
self-identifying:
  - "FAKE-CREDENTIAL-DO-NOT-USE-7P4x"   (DO-NOT-USE marker)
  - "s3cr3t-Pa55w0rd-SYNTHETIC"          (SYNTHETIC marker)
  - "sk-live-FAKE0000FAKE0000FAKE0000FAKE0000fake" (FAKE marker)
  - "hunter2-shared-secret-value (synthetic)"       (synthetic marker)
```
