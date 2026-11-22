# Conservation and adversarial gates — ACT-CLINEMM-COMPACTION-EVIDENCE-FIDELITY-01

Every gate below was executed. Receipts are the observed command output.

## Gate summary

| Gate | Requirement | Result | Receipt |
|---|---|---|---|
| C1 | Canonical authority | PASS | The carried fact is derived from the canonical tool-call/tool-result pair, matched by the tool-call id, exactly like every other verified outcome. The summarizer's prose is never an authority source. |
| C2 | Task contract | PASS | `task-contract.ts` unchanged; `task-contract-conservation.test.ts` (29 tests) + `task-contract-conservation.historical.test.ts` (3) + `task-contract-budget-authority.test.ts` all PASS. |
| C3 | Tool-result provenance | PASS | 7 provenance negative controls PASS (CONTROL 1/2/3/7/8/9/10). No failed, ambiguous, unmatched or mixed-batch result yields a fact. |
| C4 | Security | PASS | CONTROL 4, CONTROL 11, CONTROL 12, CONTROL 13 PASS. |
| C5 | Stable prefix | PASS | `compaction.stable-prefix-repair01.test.ts` (28 tests) PASS. The carried fact is derived from the boundary-scoped canonical prefix, so it is byte-stable across continuations. |
| C6 | Budget | PASS | `SOURCE_FILE_FACT_CHAR_LIMIT = 2_000` is a fixed constant. No request-budget guard was bypassed or weakened; `compaction.working-context-ratio.test.ts` and `compaction.estimator-parity01.test.ts` PASS. |
| C7 | Tool-call structure | PASS | The repair adds text to the summary message only. It creates no tool result, reorders no call/result pair and fabricates no success. |
| C8 | Session persistence | PASS | `session-compaction.ts` unchanged. No migration, no mutation of historical sidecars. The historical artifacts' SHA-256 digests are unchanged (see `artifact-hashes.json`). |
| C9 | Disabled/no-op behaviour | PASS | The repair is a pure function of the canonical payload and the tool name. With no source-file read in the history, the output is byte-identical to the pre-repair output (the existing 425 context tests, including the exact `[succeeded] cat: [result omitted]` and `[failed] #2: [result omitted]` assertions, all PASS). No React functional updater is touched. |

## Required tests — executed receipts

### RED -> GREEN against the real production seam

```
$ cd sdk/packages/core
$ bunx vitest run --config vitest.config.ts \
    src/extensions/context/compaction.evidence-fidelity01.test.ts
EXIT=0
 Test Files  1 passed (1)
      Tests  23 passed (23)
```

The RED receipt (against unchanged production code) is in `red-reproduction.md`:
`EXIT=1`, `3 failed | 4 passed (7)`.

### Negative controls

15 controls, all PASS. Map to the ACT's list:

| ACT requirement | Control | Result |
|---|---|---|
| the tool succeeded but established no relevant fact | CONTROL 4 (a command's stdout is never carried) | PASS |
| the tool returned an error | CONTROL 1, CONTROL 3 | PASS |
| two results contradict one another | CONTROL 9 (`ambiguous_result_id`) | PASS |
| the referenced file changed between observations | CONTROL 9 (contradictory reads of the SAME path fail closed) | PASS |
| the result contains a secret | CONTROL 12 (a synthetic secret in command output is not carried) | PASS |
| a result is incomplete or truncated | CONTROL 13 (a truncated excerpt is MARKED truncated and is a strict prefix of the source) | PASS |
| an adversarial tool output contains fake authority/summary delimiters | CONTROL 11 (the delimiters are escaped; only the section's own markers are unescaped) | PASS |
| (extra) a multi-file batch is ambiguous | CONTROL 7 | PASS |
| (extra) a mixed batch (one payload failed) | CONTROL 8 (`payload_failure`) | PASS |
| (extra) an unmatched result | CONTROL 10 | PASS |
| (extra) no success signal | CONTROL 2 | PASS |
| (extra) a non-path query | CONTROL 5 | PASS |
| (extra) an empty result | CONTROL 6 | PASS |
| (extra) repeated compaction | CONTROL 14 (exactly one section; the fact survives) | PASS |
| (extra) canonical history not mutated | CONTROL 15 (byte-identical before/after) | PASS |

### One representative fact preserved across repeated compactions

CONTROL 14 PASS: the carried fact is present after compaction, and exactly ONE
`<!-- cline-evidence:begin -->` marker exists — the carry-forward replaces the
section rather than appending a second copy.

### Existing task-contract and evidence-continuity tests

```
$ bunx vitest run --config vitest.config.ts src/extensions/context/
 Test Files  26 passed | 1 skipped (27)
      Tests  440 passed | 2 skipped (442)
```

(the 1 skipped file is `compaction.live.test.ts`, a pre-existing live-provider
test that is skipped by default.)

This sweep includes, all PASS:
`task-contract-conservation.test.ts`, `task-contract-conservation.historical.test.ts`,
`task-contract-budget-authority.test.ts`, `evidence-continuity.test.ts`,
`compaction.stable-prefix-repair01.test.ts`, `compaction.tool-result-shape-red.test.ts`,
`compaction.roundc-fidelity-recon02.test.ts`, `compaction.summary-churn01.test.ts`,
`compaction.decision-capture.matrix.test.ts`, `compaction.working-context-ratio.test.ts`,
`compaction.estimator-parity01.test.ts`, `compaction.cut-snap-forward.test.ts`.

### Existing stable-prefix and provider-request-budget tests

`compaction.stable-prefix-repair01.test.ts` (28 tests) PASS.
`compaction.working-context-ratio.test.ts` (3 tests) PASS.
`compaction.estimator-parity01.test.ts` PASS.

### Exact comparison of canonical history before/after

CONTROL 15 PASS: `JSON.stringify(canonicalMessages)` is byte-identical before and
after the production seam runs. The repair reads the canonical history and never
writes to it.

### No information disclosure through model-visible projections

- The only newly model-visible content is a bounded excerpt of a file the agent
  was already reading, attributed to its source path.
- Arbitrary command output is still omitted (CONTROL 4, CONTROL 12).
- The excerpt is escaped against section-delimiter forgery (CONTROL 11).
- The excerpt is bounded and marked when cut (CONTROL 13).
- The historical artifacts (canonical transcript, provider captures) are NOT
  copied into the repository. Only safe fixture values are.

### No unrelated change in summary-generation frequency or token budget

- No compaction trigger, ratio, target or `preserveRecentTokens` value changed.
- No summarizer configuration changed.
- `MAX_CARRIED_OUTCOMES` is unchanged at 12.
- The only new constant is `SOURCE_FILE_FACT_CHAR_LIMIT = 2_000`.
- `compaction.estimator-parity01.test.ts` and `compaction.working-context-ratio.test.ts`
  PASS unchanged.

## Typecheck

The ACT-owned diagnostics are at ZERO and the pre-existing baseline is preserved
EXACTLY.

```
$ cd sdk/packages/core
$ bun tsc -p tsconfig.dev.json --noEmit | grep -cE '^src/.*error TS'
43
```

43 is the count at the entry HEAD (verified by stashing the change and re-running
the same command). The normalized diagnostic SETS are identical:

```
$ diff /tmp/baseline-diags.txt /tmp/current-diags.txt
IDENTICAL TO BASELINE
```

`compaction.evidence-fidelity01.test.ts` contributes **0** diagnostics.

## Full-suite baseline

```
$ bunx vitest run --config vitest.config.ts      # WITH the repair
 Test Files  32 failed | 331 passed | 4 skipped (368)
      Tests  154 failed | 5483 passed | 176 skipped (5822)

$ bunx vitest run --config vitest.config.ts      # at the entry HEAD (stashed)
 Test Files  32 failed | 330 passed | 4 skipped (367)
      Tests  154 failed | 5460 passed | 176 skipped (5799)
```

Identical failure counts (32 files / 154 tests) before and after. The repair adds
1 test file and 23 passing tests and changes **no** failing test.

## Intentionally failing tests

None. The default suite contains no intentionally failing test introduced by this
ACT. The pre-existing `compaction.summary-churn01.red.test.ts` remains excluded by
the pre-existing `vitest.config.ts` rule; this ACT did not touch that exclusion
and did not weaken any assertion to make it pass.

---

## CORRECTION01 addendum — the new gates

### The P0-2 gate (provider-visible preservation, not just summarizer visibility)

| Assertion | Result |
|---|---|
| SCENARIO 16: with the R4 fact outside the 12-outcome budget AND the summarizer omitting it, the provider-visible projection still carries the fact | PASS |

This gate **FAILED** against `e9ab27bc8` and passes only after the dedicated, independently
budgeted source-file-fact section was added.

### The P0-3 gates (confidentiality of the source-file excerpt path)

| Assertion | Result |
|---|---|
| CONTROL 16: a credential in a SOURCE FILE is redacted from the carried excerpt | PASS |
| CONTROL 17: a credential in a SOURCE FILE never reaches the summarizer request OR the persisted/provider-visible projection | PASS |
| CONTROL 18: a PEM private key in a source file is redacted | PASS |
| CONTROL 19: an ARBITRARY COMMAND's stdout is still never carried (the pre-repair posture is preserved) | PASS |

### The corrected budgets

| Budget | Value | Note |
|---|---|---|
| `MAX_CARRIED_OUTCOMES` | 12 | **UNCHANGED** — an execution-status budget. |
| `MAX_CARRIED_FILE_FACTS` | 12 | **NEW, SEPARATE** — a factual-excerpt budget. It exists so an execution-status budget cannot decide a factual question. |
| `SOURCE_FILE_FACT_CHAR_LIMIT` | 2000 | A fixed constant; the excerpt is marked when truncated. |

### The corrected receipts

```
$ bunx vitest run --config vitest.config.ts src/extensions/context/
 Test Files  26 passed | 1 skipped (27)
      Tests  445 passed | 2 skipped (447)
EXIT=0

$ bun tsc -p tsconfig.dev.json --noEmit | grep -cE '^src/.*error TS'
43
```

43 is the entry-HEAD baseline. The ACT-owned diagnostics remain at **0**.

```
$ bunx biome check <the two modified production files> <the new test file>
Checked 3 files. 0 errors, 0 warnings.
```

---

## SECURITY01 addendum — the confidentiality gate after the path-based fail-closed correction

The second review (`HALT_NEW_P0_CREDENTIAL_EXPOSURE`) found that the content
sanitizer does NOT recognise a credential without key-shaped syntax. The
correction adds a **PATH-BASED fail-closed rule** in front of the content
sanitizer. See `security-record.md`.

| Assertion | Result |
|---|---|
| SECURITY 1: the content sanitizer does NOT recognise a `.pgpass`/`_auth=`/URL credential (pins WHY the repair is a path rule) | PASS |
| SECURITY 2: a `.pgpass` source is never carried at all | PASS |
| SECURITY 3: the credential-bearing SOURCE PATH is itself never carried (9 path classes) | PASS |
| SECURITY 4: a non-sensitive source path IS still carried (not a blanket disable) | PASS |
| SECURITY 5: a `.pgpass` credential reaches neither the summarizer request nor the persisted/provider-visible summary | PASS |
| SECURITY 6: an ordinary source's key-shaped credential is still redacted | PASS |

### The security gate is load-bearing

Against the pre-correction production code (`git checkout --` of
`evidence-continuity.ts`), **SECURITY 2, 3 and 5 FAIL** — the `.pgpass`
credential IS carried. The gate therefore fails when the protection is removed.

### The corrected receipts

```
$ bunx vitest run --config vitest.config.ts \
    src/extensions/context/compaction.evidence-fidelity01.test.ts
 Test Files  1 passed (1)
      Tests  34 passed (34)
EXIT=0

$ bunx vitest run --config vitest.config.ts src/extensions/context/
 Test Files  26 passed | 1 skipped (27)
      Tests  451 passed | 2 skipped (453)
EXIT=0

$ bun tsc -p tsconfig.dev.json --noEmit | grep -cE '^src/.*error TS'
43
```
43 is the entry-HEAD baseline; the ACT-owned diagnostics are 0.

### Gate C4 restated

The excerpt path's confidentiality contract is now:

1. A **known credential-bearing SOURCE PATH** is not carried at all — neither
   content nor path. (SECURITY 2, 3)
2. For an ordinary source, a **key-shaped credential value is redacted**.
   (CONTROL 16, 17, SECURITY 6)
3. An **arbitrary command's stdout** is still never carried. (CONTROL 19)
4. The excerpt is **bounded** and marked when truncated. (CONTROL 13)
5. The section **delimiters** are escaped. (CONTROL 11)
6. The **source attribution** names the source, so a reader can tell what the
   excerpt belongs to.

The residual limit — an unrecognized credential format inside an ORDINARY file
— is stated in `security-record.md`, not hidden. Closing it completely needs the
broader trust mechanism the review flagged, which is a separate design ACT.
