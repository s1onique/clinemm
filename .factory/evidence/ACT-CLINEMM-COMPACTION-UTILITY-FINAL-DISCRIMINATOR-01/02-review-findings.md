# 02 — The predecessor review's findings, INDEPENDENTLY VERIFIED

ACT-CLINEMM-COMPACTION-UTILITY-FINAL-DISCRIMINATOR-01

The review identified six findings. This ACT verified each one against the
production source and, where the workload allowed, against the measured
behaviour. **All six are CONFIRMED at source level.** One of them is
additionally REFINED: the multi-result counterexample is real as a source
defect but has ZERO instances in the measured workload, so its practical
weight is bounded.

## F1 — Invocation correlation selects the first result in a multi-result message

**CONFIRMED (source).** `resolveToolUseIdForFragment()` returns the FIRST
`tool_result` block's `tool_use_id` for the whole message:

```ts
for (const block of message.content) {
    if (block.type === "tool_result") {
        return block.tool_use_id;   // <-- the FIRST result, always
    }
}
```

The function takes only a `messageIndex`; it has no knowledge of WHICH
payload within that message produced the fragment. The admission contract
admits payloads one at a time, so a message carrying two results yields two
fragments that are BOTH attributed to the first result.

**MEASURED REACHABILITY.** Over the ENTIRE canonical history of the W1
workload (246 canonical messages, not only the frozen prefix):

```text
messages carrying MORE THAN ONE tool_result = 0
```

So the defect is a genuine source-level counterexample but has **no
instance in the measured workload**. Its repair is still required before
activation — the reviewer is right that the attribution must be preserved
during extraction rather than rediscovered afterwards — but it did not
contribute to any result in this ACT.

## F2 — Preselected fragments are not bound to the current admission

**CONFIRMED (source).** `selectSourceBoundEvidence()` computes the current
canonical candidates and then, when `selectedFragments` is supplied,
**replaces** the admission with them:

```ts
const candidates = extractSourceBoundEvidenceCandidates({ ... });
if (input.selectedFragments) {
    const admitted = input.selectedFragments.slice(0, maxFragments);
    return { admitted, ... };
}
```

The candidates are computed and then used only for the report counters.
The supplied fragments are never checked against them. The invariant
"Selection determines usefulness. Admission determines authorization." is
therefore not enforced by this interface.

**CONSEQUENCE FOR THIS ACT.** The arms therefore do NOT use
`applySourceBoundEvidenceToCompactedMessages()`; they use the production
renderer `renderSelectionSection()` over candidates that the PRODUCTION
admission contract produced (`collectEvidenceCandidates()`), and the
adjudication script matches facts FRAGMENT-SCOPED, by the renderer's own
attribution. The experiment is not affected by F2, and F2 blocks activation.

## F3 — The production selector differs from the measured winning candidate

**CONFIRMED (source).** The production entry point selects a different arm
and a different budget:

```ts
const result = selectEvidence({
    candidates,
    arm: "TASK_CONDITIONED",            // <-- the measured winner is SUBJECT_DIVERSITY
    signals,
    budget: {
        maxFragments: input.maxFragments ?? MAX_SELECTED_EVIDENCE_FRAGMENTS,
        maxEstimatedTokens: input.maxEstimatedTokens ?? Number.MAX_SAFE_INTEGER,
                                           // <-- the measurement used 2048
    },
});
return { fragments: result.selected.map((c) => c.fragment), result };
```

Two divergences: the ARM is `TASK_CONDITIONED` (the measurement's
`TASK_CONDITIONED@2048` scores `critOmitted=4`, while the measured winner
`SUBJECT_DIVERSITY@2048` scores `critOmitted=3`), and the production
budget is unbounded. The invocation identity is also discarded by the
`map((c) => c.fragment)`.

**THIS ACT'S ARMS USE THE MEASURED WINNER, NOT THE PRODUCTION ENTRY
POINT.** Arm B is `SUBJECT_DIVERSITY@2048`, because the ACT's question is
whether the EXISTING evidence has behavioural utility — and the existing
evidence is the one that was measured. This is another reason the
production path is not authorized.

## F4 — Production token-budget enforcement is not established

**CONFIRMED (source).** The production budget is `Number.MAX_SAFE_INTEGER`
for tokens, so the production path enforces no token budget at all; only
`maxFragments` (12) bounds it. The screening experiment's 2048-token budget
is an artifact of the SCREENING, not of production.

**MEASURED COST OF THE SCREENING BUDGET.** The frozen section is 8120
characters = 2030 estimated tokens, and it produced a **2632-token**
provider-observed prompt increase (23 943 -> 26 575). The estimate and the
provider's observation differ by 30%, in the direction that matters: the
rendered section costs MORE than the estimate states.

## F5 — The previous evaluation did not assemble the complete continuation

**CONFIRMED and REPAIRED for this ACT.** `buildBaselineContinuation()`
returned the summary, the task contract and the verified outcomes — and no
tail. This ACT uses the production projector, which yields the compacted
messages PLUS the retained tail (canonical 244 and 245).

**THE REPAIRED BASELINE IS MEASURABLY STRONGER.** With the real tail
attached, arm A scores `critOmitted=3` where the predecessor's constructed
context scored `critOmitted=5`. The retained tail carries the session's
final adjudication report, which supplies propositions the constructed
context did not have. **The predecessor's baseline was pessimistic by two
critical items.** Every structural number in the predecessor's report is
therefore measured against a baseline that did not exist in production.

## F6 — The factual scorer does not establish the absence of contradictions across every continuation component

**CONFIRMED (source).** `decideFactualVerdict(item, context.generatedSummary)`
reads only `generatedSummary`. The C2.4 correction made the source-bound
section its own SUPPLY MECHANISM, so the carried section is no longer
inside `generatedSummary` — but the RETAINED TAIL is also outside it, and
the tail is where a contradiction introduced by the summarizer's own final
report would live.

**THIS ACT MEASURED THE CONSEQUENCE.** The retained tail asserts:

```text
"The repository has 43 tracked Java test classes"
```

Direct inspection of the canonical source shows the tail is **NOT**
distorting the evidence — the source really does establish 43, via
`git ls-files | grep -c "src/test/java.*\.java"` (canonical 171), and 42 via
`git ls-files | grep -c "src/test/java.*Test\.java"` (canonical 123). The
source establishes **four** counts under four counting definitions:

```text
42   src/test/java.*Test\.java
43   src/test/java.*\.java
47   (case-insensitive) test\.java$        <- the conventional-suffix count
73   any tracked .java whose path contains 'test'
```

But the automated scorer reported `MATERIAL_DISTORTIONS=0` in every arm,
including arm C, which carries 47 and 73 alongside the tail's 43. The
scorer cannot see the contradiction, because it does not read the tail.

**THE MATERIAL DISTORTION IS REAL AND UNSCORED.** Arm C carries `47` and
`73` while the tail carries `43`, and the scorer calls that consistent.
