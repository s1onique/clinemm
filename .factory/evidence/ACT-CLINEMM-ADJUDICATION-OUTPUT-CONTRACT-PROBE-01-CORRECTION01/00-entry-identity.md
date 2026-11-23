# 00 — Entry identity and correction scope

```text
ACT:                    ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-PROBE-01-CORRECTION01
PREDECESSOR:            ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-PROBE-01
ENTRY_HEAD:             df2be7a34  (the predecessor's final commit)
BRANCH:                 main
WORKTREE:               /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm
PRODUCTION_DELTA:       ZERO (no src/ production module changed)
PREDECESSOR_VERDICT:    PASS_PROBE_CONTINUITY_STRUCTURAL (PRESERVED)
REVIEWER_VERDICT:       HALT_LIVE_EVIDENCE_CONTRADICTION
THIS_VERDICT:           PASS_CORRECTION_EVIDENCE_RECONCILED
```

## Why this ACT exists

The predecessor ACT was reviewed by the Factory runtime reviewer, who
returned `HALT_LIVE_EVIDENCE_CONTRADICTION` — a verdict that **explicitly
preserved** the predecessor's structural conclusion
(`PASS_PROBE_CONTINUITY_STRUCTURAL`) while refusing to authorize the
implementation on the strength of the live-compliance evidence.

Two P0 findings were raised.

### P0-1 — the committed live evidence contradicted the exit report

Three different measurement accounts existed for the same live experiment:

| Source                       | Live runs | Valid publications | Same-turn tool use |
| ---------------------------- | --------- | ------------------ | ------------------ |
| `06-adversarial-controls.md` | 9         | 8                  | claimed 8/8        |
| `07-contract-decision.md`    | 10        | 9                  | claimed success    |
| `gate8-live-model-probe.txt` | **1**     | **1**              | **`false`**        |

The single committed live observation was a direct **counterexample** to
the universal same-turn claim. The 9/10 statistic could not be derived
from the committed transcript.

### P0-2 — two live-probe correlation metrics were implemented incorrectly

Both defects were in
`sdk/packages/core/scripts/adjudication-output-contract.live-probe.ts`:

1. **Same-turn correlation.** `turnToolCallCounts` recorded EVERY turn;
   `turnCarriers` recorded only turns containing text. The publishing
   carrier's index was used to index the per-turn array. As soon as a
   preceding turn carried tools but no text, the metric reported the
   tool-call count of a DIFFERENT turn.

2. **After-tool-result correlation.** `sawTextAfterToolResult` was set
   from the text of a tool-calling turn — text emitted BEFORE the tool
   result was appended — and was not tied to the adjudication carrier.

These are **bounded diagnostic defects, not production defects**. The
predecessor shipped no production changes.

## What this ACT does

Exactly the four items the reviewer required, in one bounded cycle:

| # | Required correction | Where |
|---|---|---|
| 1 | Fix the live-harness correlation; add counterexamples with tool-only turns | `01-harness-correction.md` |
| 2 | Reconcile the live receipts; report only verifiable measurements | `02-live-receipts.md` |
| 3 | Separate schema validity from contract acceptance | `03-acceptance-gates.md` |
| 4 | Preserve the implementation constraints C1 and C2 | `04-constraints-and-verdict.md` |

No production changes, no historical replay, no new memory system and no
full-suite rerun are required for this correction. The reviewer classified
the six whitespace diagnostics and the unrelated stale gate-summary
metadata as **P2, NON-BLOCKING**; they are out of scope here and are not
claimed as fixed.

## The scope boundary that is NOT crossed

The predecessor's **structural** conclusions survive this correction
untouched and are NOT re-litigated here:

- the assistant `text` block is a viable carrier;
- assistant text survives the M1 (`agentic_summary`) policy while thinking
  blocks do not;
- canonical persistence preserves that carrier in the tested paths;
- the strict parser rejects malformed and unsupported representations;
- the summarizer CAN omit an otherwise valid published candidate;
- the predecessor shipped ZERO production changes.

This ACT corrects the **live-measurement** evidence. It does not convert
the test-local parser into a deployed security guarantee, and it does not
assert that the output contract is currently enforced anywhere in
production. It is not: the contract remains test-local.

## The constraints that remain OPEN

The reviewer was explicit that **C1** (canonical evidence identity) and
**C2** (deterministic continuity under summarizer omission) may not be
treated as already solved. They are carried forward as **OPEN, explicitly
unproven prerequisites** for
`ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-IMPLEMENT-01`, and the
implementation ACT must satisfy them with separately tested evidence.
