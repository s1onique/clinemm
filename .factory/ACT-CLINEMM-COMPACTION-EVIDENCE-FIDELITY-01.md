# ACT-CLINEMM-COMPACTION-EVIDENCE-FIDELITY-01 (+ CORRECTION01 + SECURITY01)

**Verdict:** `PASS_STRUCTURAL_ONLY` (after CORRECTION01 and SECURITY01)
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
iteration-85 request**. It is independently adjudicated against the frozen source revision, not
merely accepted on a `success: true`.

## The cause

`renderStructuredToolPayload()` in `compaction-shared.ts` rendered a structured
`{query, result, success}` payload with a string body as the literal `[result omitted]`:

```
flattenToolResultContent([{ query: <path>, result: <body>, success: true }])
  -> "[succeeded] #1: [result omitted]"
```

**Discriminator case A** — the fact was removed BEFORE the summarizer saw it. Cases B and C are
excluded by this observation.

## The repair

Option B (summarizer input fidelity), in the two existing modules:

A **source-attributed file read** (a `read_files` result whose `query` is the file path and whose
`result` is that file's content) carries a bounded, source-attributed, **redacted** excerpt
instead of `[result omitted]` — at the summarizer input and in a dedicated deterministic section.

A file read's payload identifies the source and its body IS the source text. A command's stdout
has no attribution and may carry anything the program printed, including a credential — so
arbitrary output is still omitted, and the pre-existing security posture is preserved.

## CORRECTION01 — what the review changed

The review of `e9ab27bc8` raised three P0 findings and one P1. **All four were accepted**; two
were real defects in the shipped repair.

| Finding | Disposition |
|---|---|
| P0-1 — the five-boundary replay used the FINAL canonical history for every boundary | **ACCEPTED** — the replay is regenerated with each boundary's authoritative prefix (6/8/8/8/10 reads, not 13 everywhere). |
| P0-2 — summarizer visibility is not provider-visible preservation | **ACCEPTED — a real defect.** The file facts now have a dedicated section with their own budget (`MAX_CARRIED_FILE_FACTS = 12`). `SCENARIO 16` (fact outside the 12-outcome budget, summarizer omits it) FAILED against `e9ab27bc8` and now passes. |
| P0-3 — source attribution does not establish confidentiality | **ACCEPTED — a real security defect.** The excerpt is now redacted with the module's existing value-position sanitizer. Four new controls (16-19). |
| P0-4 — the behavioural causal claim used the wrong observation boundary | **ACCEPTED** — the `grep "kc.sh build"` call predated the boundary. `BEHAVIORAL_CAUSE_SUPPORTED` is **withdrawn**; the disposition is `BEHAVIORAL_CAUSE_UNPROVEN`. |
| P1 — the fixture was labelled with a `run_commands` id but reconstructed as `read_files` | **ACCEPTED** — the LABEL was wrong; the id `call_362cfbf4cd5d44c19d876aeb` IS the historical `read_files` call (verified against the canonical transcript). Documentation corrected. |

## Receipts

```
RED    (production reverted)    6 failed | 22 passed (28)      EXIT=1
GREEN  (after the repair)       34 passed (34)                EXIT=0
SWEP   src/extensions/context/ 451 passed | 2 skipped (453)    EXIT=0
TYPECHECK  43 diagnostics == the entry-HEAD baseline; ACT-owned = 0
FULL SUITE  failing file set IDENTICAL to the entry HEAD (31 files)
BIOME  0 errors, 0 warnings
```

## SECURITY01 — the bounded security correction

The second review (`HALT_NEW_P0_CREDENTIAL_EXPOSURE`) found a concrete redaction bypass in the
`read_files` excerpt path: a `.pgpass`-style credential (`host:port:db:user:password`), a legacy
`_auth=` token and a `scheme://user:password@host` URL all survive `sanitizeOutcomeText()`
verbatim. **The counterexample was confirmed against the production code.**

The repair is a **PATH-BASED fail-closed rule**, not one more regex — the module's own governing
rule is that no regex can be made safe for arbitrary content, and the set of credential formats is
unbounded. What CAN be established is the path: a file at `~/.pgpass` or `~/.ssh/id_rsa` is a
credential container by construction. Such a source now contributes **neither content nor path**.

The path vocabulary reuses the one the codebase already applies to credential targets
(`runtime/command-policy/structured-command-risk.ts`).

`SECURITY 1`-`SECURITY 6` are the production-seam RED. **SECURITY 2, 3 and 5 FAIL against the
pre-correction code**, so the gate is load-bearing. The whole R4 evidence-fidelity suite is
preserved and GREEN.

## Files changed

| File | Change |
|---|---|
| `sdk/packages/core/src/extensions/context/compaction-shared.ts` | The tool name is threaded into the result projection; a source-attributed file read carries a bounded, redacted excerpt. |
| `sdk/packages/core/src/extensions/context/evidence-continuity.ts` | The source-attributed file fact is derived from the canonical payload, redacted, and carried in a dedicated, independently budgeted section. A known credential-bearing SOURCE PATH is not carried at all (SECURITY01). |
| `sdk/packages/core/src/extensions/context/compaction.evidence-fidelity01.test.ts` | NEW — the production-seam RED, the causal discriminator, 19 negative controls, the realistic outside-the-budget RED and the confidentiality controls (incl. the 6 SECURITY controls). |

## What is NOT claimed

- No live model was run. The qualification is STRUCTURAL, not LIVE.
- The repair does not prove improved autonomous completion.
- **Behavioural causality is UNPROVEN**: the model did not re-read the R4 fact after the boundary.
- The malformed-tool-call issue (`commands: null`) is a separate causal chain and was not touched.
- `MAX_CARRIED_OUTCOMES = 12` is unchanged.
- The residual limit is stated, not hidden: an unrecognized credential format inside an ORDINARY
  file is bounded, attributed and redacted for key-shaped values, but is not detected. Closing
  that gap needs the broader trust mechanism the review flagged — a separate design ACT.

## Evidence

`.factory/evidence/ACT-CLINEMM-COMPACTION-EVIDENCE-FIDELITY-01/`
