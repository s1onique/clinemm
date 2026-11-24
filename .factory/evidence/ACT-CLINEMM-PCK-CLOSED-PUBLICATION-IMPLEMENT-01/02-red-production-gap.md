# 02 — The RED on the real production path

```text
ACT: ACT-CLINEMM-PCK-CLOSED-PUBLICATION-IMPLEMENT-01
ENTRY_HEAD: 0f111f3d76a7e7da9b792cfd173d88635156182c
RED_COMMAND: cd sdk/packages/core && bun x vitest run \
                --config vitest.red.pck-closed-publication.config.ts \
                --reporter=verbose
RED_EXIT_CODE: 1
RED_WITNESS: sdk/packages/core/src/extensions/context/precompaction-knowledge-checkpoint/pck-production-seam.red01.test.ts
RECEIPT: verification/red-production-gap.txt
RECEIPT: verification/red-isolated.txt
```

## 2.1 — The seam that was driven

```text
createCompactionStateAwarePrepareTurn
  -> createContextCompactionPrepareTurn({ strategy: "agentic" })
  -> runAgenticCompaction
     -> buildAgenticSummaryInputBudget -> buildBudgetProjection
     -> serializeConversation -> buildSummaryRequest
     -> generateSummary   (mocked at the EXISTING provider-handler boundary,
                           `createHandlerAsync` in @cline/llms)
  -> applyTaskContractToCompactedMessages
  -> applyVerifiedEvidenceToCompactedMessages
  -> createSessionCompactionState      (the REAL persistence builder)
  -> MessageBuilder.buildForApi        (the REAL provider projection)
```

**Only the external summarizer/provider boundary was mocked.** Every other
function on the path is the REAL production function.

The canonical history is FULLY SYNTHETIC: an invented task message, an
invented `run_commands` call, an invented result, and padding messages that
create the token pressure the REAL auto-mode eligibility check needs so the
production path actually runs.

## 2.2 — The FIRST RED: the missing checkpoint

The assertion required the provider-visible continuation to contain an
accepted, closed working-knowledge section.

```text
Command: bun x vitest run --config vitest.red.pck-closed-publication.config.ts
Exit code: 1

AssertionError: expected '[{"role":"user","content":[{"type":"t…' to contain
                'Working knowledge checkpoint'
```

### The four facts the failure establishes

```text
ACTUAL COMPACTION EXECUTED
  The summarizer request was CAPTURED at the provider boundary, with a
  non-zero length. The production compaction path ran.

ORDINARY SUMMARY PRODUCED
  A `compaction_summary` message with metadata.kind === "compaction_summary"
  was produced. The ordinary agentic summarizer ran.

TASK CONTRACT PRESERVED
  The provider-visible continuation contains "Active task contract" — the
  task contract's own section, with its own begin/end markers.

CHECKPOINT SECTION ABSENT
  The provider-visible continuation does NOT contain
  "Working knowledge checkpoint". The production gap is real.
```

The failure is precisely on the CHECKPOINT assertion. The three
establishing assertions passed BEFORE it, so the RED does not merely show
"the path did nothing" — it shows "the path did everything it used to do,
and the checkpoint was missing".

## 2.3 — The SECOND RED: unsafe publication

The second RED was produced by the **independent security ablation**, which
removes ONLY the closed publication gate.

```text
The ablation bypasses:
  - the proposal SHAPE validation (so an unknown field is admitted), and
  - the reference MEMBERSHIP check (so a forged reference is admitted), and
  - the RUNTIME RENDERING (so the model's own `statement` and
    `qualifications` fields are published verbatim).

The ablation arm then FAILS:
  AssertionError: expected 'Working knowledge checkpoint\nModel-a…' not to
                  contain 'AKIAIOSFODNN7EXAMPLE'
```

**That failure is the leak, made reachable.** With the gate removed, the
conventional fake API key reaches the RENDERED SECTION. The same ablation
made these controls fail:

```text
G3.2   an UNKNOWN FIELD is rejected          -> admitted
G3.3   a MODEL-AUTHORED IDENTIFIER           -> admitted
G3.4   a REFERENCE by MEMBERSHIP              -> admitted
G3.4b  an OPAQUE-SHAPED forged reference      -> admitted
G3.5b  the model assigns itself runtime_verified -> admitted
G3.6   the ten synthetic credential cases     -> published
G3.6b  a model-authored DELIMITER             -> admitted
G7.3   a REJECTED candidate leaves the compaction intact -> not intact
G7.4   a FORGED reference is rejected        -> accepted
```

The gate was RESTORED, and the same suite returned to green with the
payload absent from both the persistence and the provider projections.

### "Do not preserve an intentionally failing security assertion in the
default test suite."

```text
SATISFIED. The ablation is executed INSIDE a PASSING test file
(`pck-conservation-ablation.test.ts`), which constructs the ungated arm
locally and asserts that the ungated arm leaks. The default suite contains
NO intentionally failing security assertion.
```

## 2.4 — RED isolation

```text
The historical intentionally failing adjudication witnesses were UNCHANGED
and ISOLATED:
  src/extensions/context/compaction.summary-churn01.red.test.ts       unchanged
  src/extensions/context/compaction.adjudication-continuity.red01.test.ts unchanged
Both remain EXCLUDED from the default suite by the pre-existing
`vitest.config.ts` entries, which this ACT did not modify.

The PCK RED witness is ISOLATED the same way:
  src/extensions/context/precompaction-knowledge-checkpoint/pck-production-seam.red01.test.ts
  is EXCLUDED from `vitest.config.ts` and is runnable ON DEMAND through
  `vitest.red.pck-closed-publication.config.ts`:
    bun run test:red:pck-closed-publication

The RED receipts with exact test names, commands and exit codes:
  verification/red-production-gap.txt
  verification/red-isolated.txt
```

## G2 exit

```text
RED_PRODUCTION_GAP_REPRODUCED
```
