# 05 — The gates

ACT-CLINEMM-COMPACTION-UTILITY-FINAL-DISCRIMINATOR-01

## The production delta

```text
git diff --stat HEAD -- sdk/packages/core/src/   ->  (EMPTY)
PRODUCTION_DELTA = NONE
```

The only additions are four EXPERIMENTAL SCRIPTS under
`sdk/packages/core/scripts/`:

```text
compaction-utility-final-discriminator.arms.ts
compaction-utility-final-discriminator.adjudication.ts
compaction-utility-final-discriminator.probe.ts
compaction-utility-final-discriminator.score.ts
```

No production module was touched: not the selector, not the admission
contract, not the publication path, not the projector, not the scorer, not
the oracle, not the assertions. No new persistent store, no database, no
retrieval service, no protocol message, no public wire field.

The source-bound evidence remains DEFAULT OFF; the PCK remains DEFAULT OFF.

## The gate checks

| gate | result | how it was checked |
|---|---|---|
| Frozen artefact identities | PASS | the prefix hash is recomputed with the PRODUCTION hash function and compared with the sidecar's own recorded value; the summary digest is recomputed and compared with the frozen value; the selection is re-run and asserted to EQUAL the recorded index set. Each check THROWS on a mismatch. |
| Internally consistent production projection | PASS | `projectSessionCompactionState()` is used, and it REFUSES a state whose prefix identity does not match. The projection is 53 messages = 51 compacted + 2 tail, and the script throws if the count does not reconcile. |
| Identical baseline between arms | PASS | the three arms' tails are compared byte for byte (`JSON.stringify`) and the script throws if they differ. The arms differ ONLY by the carried section. |
| No oracle leakage into A or B | PASS | `assertNoOracleLeakage()` is run over the ACTUAL prompt of every arm. It returned `leaked=false` on all three. The probe THROWS on a leak. |
| No unauthorized evidence publication | PASS | the arms are assembled through the PRODUCTION admission contract (`collectEvidenceCandidates`) and the PRODUCTION renderer (`renderSelectionSection`). Arm C's fragments are the ORIGINAL tool-result bodies that the oracle's own evidence references name; nothing is fabricated and no new publication channel is added. |
| No production source delta | PASS | see above. |
| No tracked raw histories or model responses | PASS | every raw context, prompt, answer and report is written under the gitignored `tmp/utility-final-discriminator/` tree. `git check-ignore` confirms `tmp/` is ignored. The committed evidence carries aggregates, runtime-owned constants and oracle item ids only. |
| Relevant focused tests | PASS | the ACT changed NO production code, so the whole SDK regression suite was correctly NOT run. The FOCUSED context suite was run anyway, as a regression guard: **1132 passed / 0 failed** across 80 files (2 skipped), matching the predecessor's baseline exactly. |
| Typecheck | PASS (zero ACT-owned) | `tsc -p tsconfig.dev.json --noEmit` reports **45** diagnostics with the four scripts present and **45** with them removed: **ZERO ACT-owned diagnostics**. |
| Biome | PASS | `biome check` on the four scripts: no errors, no warnings, no info. |
| Reproducibility | PASS | the whole pipeline was re-run after the lint fixes and reproduced IDENTICALLY: the arms, the direct adjudication (all 9 classifications and the 3 scorer false negatives) and the behavioural scoring (A 0/0/3, B 0/2/1, C 0/3/0). |
| Git diff hygiene | PASS | `git diff --check` is CLEAN; the only working-tree entries are the four new untracked scripts. |
| No packaging / installation | PASS | no VSIX was built and nothing was installed. |

## The oracle-leakage witness

```text
arm A: leaked=false, leakedTerms=[]
arm B: leaked=false, leakedTerms=[]
arm C: leaked=false, leakedTerms=[]
```

The witness checks the ACTUAL prompt for the oracle's distinctive strings —
the propositions and the correct-answer criteria — and the probe script
throws rather than spending a request on a leaked prompt.

## The requests

```text
PHYSICAL_INFERENCE_REQUESTS = 3
  arm A: 1
  arm B: 1
  arm C: 1
  repeats: 0
ADDITIONAL_SUMMARIZATION_REQUESTS = 0
```

The physical count is OBSERVED, not asserted: the probe wraps the `fetch`
the production transport uses and counts the calls. Each arm's report
records `physicalRequestCount=1`.

## The confidentiality position

- **Private** — every raw artefact is under the gitignored `tmp/` tree.
- **Destination-authorized** — the single approved local endpoint from the
  operator's own settings; no other destination is contacted.
- **Confined** — the source-bound evidence carry-forward is DEFAULT OFF in
  production, and the arms enable it only in the experiment's own process.
  No fragment was published to any other destination.
- **Refuse rather than bypass** — the admission contract's refusal rules
  (the credential-bearing source, the empty body, the body that carries
  nothing after redaction, the bound-then-redact order) applied UNCHANGED
  in every arm. The ACT did not bypass a refusal anywhere.
