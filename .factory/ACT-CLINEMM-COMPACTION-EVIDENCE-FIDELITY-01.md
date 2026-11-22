# ACT-CLINEMM-COMPACTION-EVIDENCE-FIDELITY-01

**Verdict:** `PASS_STRUCTURAL_ONLY`
**Entry HEAD:** `bd39be9da2d0a610c173fbc205e2bdea570f8e70` (branch `main`)
**Historical session:** `1795382314359_rb19c` · **Provider-capture run:** `yHaQSIjO`
**Subject source revision:** Keycloak `42de653b59708e712d694aeb9732f822b7f8fe5b` (`optimize-ftls`)

## What was reproduced

The Round C session audited Keycloak findings R1-R10. At the 84->85 compaction boundary the
post-compaction provider-visible working context asserted that "Actual command outputs were
omitted from the transcript", and therefore that the R1-R10 verdicts could not be assigned.

That assertion was **false**. The canonical pre-compaction history carried the tool results in
full, and the captured provider request at iteration 84 carried them verbatim.

**The witness fact (R4):** `cat startup.sh` returned

```
4 | /opt/keycloak/bin/kc.sh build
7 | exec /opt/keycloak/bin/kc.sh start --optimized "$@"
```

It was present in the iteration-84 provider request (3 occurrences) and **absent from the entire
iteration-85 request**. It was independently adjudicated against the frozen source revision, not
merely accepted on a `success: true`.

## The cause

`renderStructuredToolPayload()` in `compaction-shared.ts` rendered a structured
`{query, result, success}` payload with a string body as the literal `[result omitted]`:

```
flattenToolResultContent([{ query: <path>, result: <body>, success: true }])
  -> "[succeeded] #1: [result omitted]"
```

**Case A** — the fact was removed BEFORE the summarizer saw it. The summarizer then truthfully
reported that the outputs were missing, and at iteration 85 (the first post-compaction request)
the model re-ran `grep -rn "kc.sh build" ...`, seeking precisely the evicted fact.

## The repair

Option B (summarizer input fidelity), in the two existing modules:

A **source-attributed file read** now carries a bounded, source-attributed excerpt
(`SOURCE_FILE_FACT_CHAR_LIMIT = 2_000`) instead of `[result omitted]`, at the summarizer input and
at the deterministic carry-forward seam.

A file read's payload identifies the source and its body IS the source text. A command's stdout
has no attribution and may carry anything the program printed, including a credential — so
arbitrary output is still omitted, and the pre-existing security posture is preserved.

`MAX_CARRIED_OUTCOMES = 12` is unchanged.

## Receipts

```
RED    (unchanged production)    3 failed | 4 passed (7)       EXIT=1
RED    (production reverted)    16 failed | 7 passed (23)      EXIT=1
GREEN  (after the repair)       23 passed (23)                 EXIT=0
SWEP   src/extensions/context/ 440 passed | 2 skipped (442)   EXIT=0
TYPECHECK  43 diagnostics == the entry-HEAD baseline; ACT-owned = 0
FULL SUITE  failing file set IDENTICAL to the entry HEAD (31 files, all pre-existing)
```

## Files changed

| File | Change |
|---|---|
| `sdk/packages/core/src/extensions/context/compaction-shared.ts` | The tool name is threaded into the result projection; a source-attributed file read carries a bounded excerpt. |
| `sdk/packages/core/src/extensions/context/evidence-continuity.ts` | The source-attributed file fact is derived from the canonical payload and carried in the deterministic section. |
| `sdk/packages/core/src/extensions/context/compaction.evidence-fidelity01.test.ts` | NEW — the production-seam RED, the causal discriminator, and 15 negative controls. |

## What is NOT claimed

- No live model was run. The qualification is STRUCTURAL, not LIVE.
- The repair does not prove improved autonomous completion.
- The malformed-tool-call issue (`commands: null`) is a separate causal chain and was not touched.
- The carry-forward's own 12-outcome budget does not reach the R4 read at the 84->85 boundary;
  this is reported, not worked around.

## Evidence

`.factory/evidence/ACT-CLINEMM-COMPACTION-EVIDENCE-FIDELITY-01/`
