# Historical five-boundary qualification — ACT-CLINEMM-COMPACTION-EVIDENCE-FIDELITY-01

## Summary

All five recorded boundaries were evaluated. All five are **authoritative
compaction events** (not context-reset candidates), all five are
**structurally replayable** (the provider-request captures are `mode: full`
and the canonical transcript is complete), and at all five the source-verified
R4 fact was **present before the boundary and absent from the compacted
summary after it**.

The corrected production projection carries the fact at **all five** boundaries.

## Per-boundary results

| Boundary | Authoritative compaction event? | Canonical source history | Persisted compaction generation | Corrected projection carries the fact? | Fact before | Fact after (historical) |
|---|---|---|---|---|---|---|
| 7 -> 8 | YES | available (canonical transcript complete) | recoverable (the sidecar holds the final generation; earlier generations are folded into it) | **YES** | 3 occurrences in the iteration-7 provider request | 0 in the compacted summary, 0 in the whole iteration-8 request |
| 23 -> 24 | YES | available | recoverable | **YES** | 3 | 0 in the compacted summary; 2 survive only in the PRESERVED TAIL (messages[2], a raw tool-result block), not as carried evidence |
| 41 -> 42 | YES | available | recoverable | **YES** | 6 | 0 in the compacted summary, 0 in the whole iteration-42 request |
| 62 -> 63 | YES | available | recoverable | **YES** | 4 | 0 in the compacted summary, 0 in the whole iteration-63 request |
| 84 -> 85 | YES | available | recoverable | **YES** | 3 | 0 in the compacted summary, 0 in the whole iteration-85 request |

Raw measurements: `verification/boundary-replay.json` and
`historical-boundary-index.json`.

### Why each boundary is an authoritative compaction event

The post-compaction `messages[0]` of the captured provider request is a
`Context summary:` block in every case. This is the production shape
`buildSummaryMessage()` produces, and the `basic` strategy and the overflow
recovery path produce no LLM summary at all. The boundary is therefore an
authoritative **agentic** compaction, not a context reset.

### Replayability

`HISTORICAL_BOUNDARY_NOT_REPLAYABLE` does **not** apply: all five boundaries
are replayable. The provider-request captures are complete (`mode: full` for
all 102 captured requests of run `yHaQSIjO`) and the canonical transcript
(255 messages) is complete. What is NOT recoverable is the exact *historical*
persisted sidecar generation for the four earlier boundaries, because the
sidecar file holds only the latest generation and the earlier ones were
folded into the subsequent summaries. That does not prevent the replay: the
boundary's canonical source history and its provider-visible projection are
both available.

## The tracked counts (as required)

These are tracked SEPARATELY. A count of retained tool-call IDs is **not** a
fact-fidelity score and is not used as one.

| Metric | Value |
|---|---|
| Source-verified facts preserved | 1 (the R4 `startup.sh` fact) at each of the 5 boundaries, by the corrected projection |
| Required facts missing | 0 at each of the 5 boundaries, by the corrected projection. By the HISTORICAL projection: 1 at each of the 5 boundaries. |
| Facts explicitly unverified | 0 — the repair carries no `INCOMPLETE`/`UNVERIFIABLE` classification, because no summary validation was introduced (that is Option C, which the evidence did not justify). |
| Contradictory evidence retained | 0. The contradictory-result case fails closed (`ambiguous_result_id`), so the conflicting outcome is rejected rather than carried. CONTROL 9 asserts this. |
| Tool outcomes retained | 12 (the `MAX_CARRIED_OUTCOMES` budget, unchanged by this ACT). This is an execution-outcome count, not a fact-fidelity score. |
| New evidence added after the compaction boundary | 0. The carry-forward is derived from the boundary-scoped canonical prefix, so an outcome verified after the boundary is not attributed to it. |

### What the repaired projection carries at the historical boundaries

The corrected summarizer-input projection over the canonical history yields
**13 source-attributed file facts** across **4 `read_files` batches**:

| Canonical index | Batch | Facts | Contains the R4 witness |
|---|---|---|---|
| 7 | `startup.sh`, `values.yaml` (x3), `values-prod.yaml` (x2), `index_delta_db1_to_db2.sql` | 6 | **YES** |
| 16 | `token-code-changelog.xml`, `NotificationServiceClient.java` | 2 | no |
| 164 | `.gitlab-ci.yml:95-200`, `Dockerfile.roz:160-195` | 2 | no |
| 216 | `MtsOmniSmsSenderServiceProvider.java`, `RedsmsSmsSenderServiceProvider.java`, `TokenCode.java` | 3 | no |

Each batch's projection is bounded by the PRE-EXISTING
`TOOL_RESULT_CHAR_LIMIT = 2_000` and is marked truncated when it is cut. The
R4 witness is the first file of its batch, so it is inside the bound.

## The R4 fact, verified before and after

```
1 | #!/bin/bash
2 | set -e # Exit immediately if a command exits with a non-zero status
3 |
4 | /opt/keycloak/bin/kc.sh build
5 |
6 | # Execute the main container process using the free arguments passed to Docker
7 | exec /opt/keycloak/bin/kc.sh start --optimized "$@"
```

- **Before** (iteration 84): 3 occurrences in the provider-visible request.
- **After, historical** (iteration 85): 0 in the compacted summary; the
  summary asserted the outputs had been omitted.
- **After, corrected**: the fact is in the summarizer input at every boundary,
  and therefore in the compacted working context the model receives.

## Boundary-scope honesty

The carry-forward section's own budget (`MAX_CARRIED_OUTCOMES = 12`, the most
recent verified outcomes) does **not** reach the R4 read at the 84->85
boundary: the read is at canonical index 6, while the budget retains the
outcomes at canonical indices 229-253.

This is reported rather than worked around, for two reasons:

1. The ACT explicitly states that `MAX_CARRIED_OUTCOMES` is an
   execution-outcome budget, not a semantic-evidence guarantee, and that
   expanding it is not a fix.
2. The repair's seam is the SUMMARIZER INPUT, and the summarizer input covers
   the folded prefix — which contains the R4 read at every boundary. The
   fact is therefore available to the summarizer, which is what was missing.

The deterministic carry-forward section is a SECOND, redundant path (it
carries the fact even when the summarizer's prose drops it, which is what the
RED's SCENARIO 2 exercises). Its budget is unchanged.

## What this qualification does NOT claim

- It does not claim that the repair makes the historical session converge.
- It does not claim that the malformed-tool-call issue (`commands: null`) is
  fixed; that is an explicitly separate causal chain.
- It does not claim live-model behaviour: the qualification is a deterministic
  projection replay, i.e. **STRUCTURAL**, not **LIVE**.
