# Historical five-boundary qualification — ACT-CLINEMM-COMPACTION-EVIDENCE-FIDELITY-01

**CORRECTED** by `ACT-CLINEMM-COMPACTION-EVIDENCE-FIDELITY-CORRECTION01`. See
`correction-record.md` for the P0-1 finding that invalidated the first version of this report.

## Summary

All five recorded boundaries were evaluated. All five are **authoritative compaction events** (not
context-reset candidates), all five are **structurally replayable** (the provider-request captures
are `mode: full` and the canonical transcript is complete), and at all five the source-verified
R4 fact was **present before the boundary and absent from the compacted summary after it**.

The corrected production projection carries the fact at **all five** boundaries, through **both**
paths: the summarizer input and the deterministic file-fact section.

## The per-boundary canonical prefix

The authoritative prefix of each boundary is derived from that boundary's own PRE-compaction
provider request: the last tool-call id in that request is looked up in the canonical transcript,
and its assistant-message index is the prefix end.

| Boundary | Pre-compaction request's last tool-call id | Canonical prefix end | Prefix size | Source-file reads inside the prefix |
|---|---|---|---|---|
| 7 -> 8 | `call_cf2e104766564657b26b14ca` | 15 | 16 messages | 6 |
| 23 -> 24 | `call_9fc3edfd1ee141c78a50efb8` | 49 | 50 messages | 8 |
| 41 -> 42 | `call_0bb085b10d764636b9b3e66a` | 85 | 86 messages | 8 |
| 62 -> 63 | `call_53285fd8d21a40fdb41a2ad3` | 127 | 128 messages | 8 |
| 84 -> 85 | `call_2b533113c5be408a8431fcc7` | 171 | 172 messages | 10 |

The first version of this report used the **complete final canonical history** for every
boundary, which reported 13 reads at each of them. That was the P0-1 finding: an early compaction
cannot be replayed with evidence generated later in the session. The numbers above are the
corrected ones.

The persisted sidecar's own `source_message_count = 217` /
`source_last_message_key = id:msg_AdPPg-ET` (canonical index 216) independently confirms the
method for the final generation.

## Per-boundary results

| Boundary | Authoritative compaction event? | Corrected summarizer input carries the fact? | Corrected file-fact section carries the fact? | Fact before (historical) | Fact after (historical) |
|---|---|---|---|---|---|
| 7 -> 8 | YES | **YES** | **YES** | 3 in the iteration-7 request | 0 in the compacted summary, 0 in the whole iteration-8 request |
| 23 -> 24 | YES | **YES** | **YES** | 3 | 0 in the compacted summary; 2 survive only in the PRESERVED TAIL (a raw tool-result block), not as carried evidence |
| 41 -> 42 | YES | **YES** | **YES** | 6 | 0 in the compacted summary, 0 in the whole iteration-42 request |
| 62 -> 63 | YES | **YES** | **YES** | 4 | 0 in the compacted summary, 0 in the whole iteration-63 request |
| 84 -> 85 | YES | **YES** | **YES** | 3 | 0 in the compacted summary, 0 in the whole iteration-85 request |

Raw measurements: `verification/boundary-replay.json` and
`historical-boundary-index.json`.

### Why each boundary is an authoritative compaction event

The post-compaction `messages[0]` of the captured provider request is a `Context summary:` block
in every case. This is the production shape `buildSummaryMessage()` produces, and the `basic`
strategy and the overflow recovery path produce no LLM summary at all. The boundary is therefore
an authoritative **agentic** compaction, not a context reset.

### Replayability

`HISTORICAL_BOUNDARY_NOT_REPLAYABLE` does **not** apply: all five boundaries are replayable. The
provider-request captures are complete (`mode: full` for all 102 captured requests of run
`yHaQSIjO`) and the canonical transcript (255 messages) is complete. What is NOT recoverable is
the exact *historical* persisted sidecar generation for the four earlier boundaries, because the
sidecar file holds only the latest generation. That does not prevent the replay: the boundary's
canonical source history and its provider-visible projection are both available, and the prefix
is derived from the boundary's own request.

## The tracked counts (as required)

These are tracked SEPARATELY. A count of retained tool-call IDs is **not** a fact-fidelity score
and is not used as one.

| Metric | Value |
|---|---|
| Source-verified facts preserved | 1 (the R4 `startup.sh` fact) at each of the 5 boundaries, by BOTH corrected paths |
| Required facts missing | 0 at each of the 5 boundaries, by the corrected projection. By the HISTORICAL projection: 1 at each of the 5 boundaries. |
| Facts explicitly unverified | 0 — no summary validation was introduced (that is Option C, which the evidence did not justify). |
| Contradictory evidence retained | 0. The contradictory-result case fails closed (`ambiguous_result_id`), so the conflicting outcome is rejected rather than carried. CONTROL 9 asserts this. |
| Tool outcomes retained | 12 (`MAX_CARRIED_OUTCOMES`, unchanged). This is an execution-outcome count, not a fact-fidelity score. |
| Source-file facts retained | 6, 8, 8, 8, 10 (`MAX_CARRIED_FILE_FACTS = 12`, a SEPARATE budget). |
| New evidence added after the compaction boundary | 0. Both carry-forwards are derived from the boundary-scoped canonical prefix, so an outcome verified after the boundary is not attributed to it. |

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
- **After, historical** (iteration 85): 0 in the compacted summary; the summary asserted the
  outputs had been omitted.
- **After, corrected**: the fact reaches the summarizer input AND the deterministic file-fact
  section at every boundary.

## The retention pressure (why the file-fact section is separately budgeted)

`MAX_CARRIED_OUTCOMES = 12` keeps the **most recent** verified outcomes. The R4 `read_files` sits
at canonical index 6, so it falls outside that window once the session has produced 12 later
verified outcomes:

| Boundary | Oldest retained outcome (canonical index) | R4 read (index 6) retained? |
|---|---|---|
| 7 -> 8 | 2 | yes |
| 23 -> 24 | 18 | **no** |
| 41 -> 42 | 59 | **no** |
| 62 -> 63 | 99 | **no** |
| 84 -> 85 | 145 (the R4 fact is not the retained one; a later read at 163 is) | **no** |

This is reported rather than worked around. The ACT explicitly states that `MAX_CARRIED_OUTCOMES`
is an execution-outcome budget, not a semantic-evidence guarantee, and that expanding it is not a
fix. The correction introduces a **separate** budget for the file facts, so an execution-status
budget no longer decides a factual question. `MAX_CARRIED_OUTCOMES` itself is **unchanged**.

## What this qualification does NOT claim

- It does not claim that the repair makes the historical session converge.
- It does not claim a behavioural causal link: the corrected chronology shows the model did **not**
  re-read the R4 fact after the boundary, so the behavioural causality is `UNPROVEN`. See
  `correction-record.md` (P0-4).
- It does not claim that the malformed-tool-call issue (`commands: null`) is fixed; that is an
  explicitly separate causal chain.
- It does not claim live-model behaviour: the qualification is a deterministic projection replay,
  i.e. **STRUCTURAL**, not **LIVE**.

---

## CONTAINMENT01 addendum — the automatic feature is withdrawn

The third review (`HALT_P0_EXCERPT_CONTENT_CONFIDENTIALITY`) confirmed that an unconventional
credential in an ORDINARY source file still reached the excerpt path. The automatic excerpt
carry-forward is therefore **OFF by default** (`SOURCE_FILE_FACT_CARRY_FORWARD_ENABLED = false`),
at the shared extraction boundary `buildSourceFileFact()` — the single function through which
both the summarizer-input projection and the deterministic file-fact section obtain an excerpt.

**What this table now describes.** The per-boundary results above are the qualification of the
**CAPABILITY**, exercised with the switch explicitly enabled. With the deployed default, the
automatic excerpt path produces nothing, and the table's "Corrected projection carries the fact"
column does NOT describe the deployed configuration.

| Boundary | Capability (switch ON) | Deployed default (switch OFF) |
|---|---|---|
| 7 -> 8 | summarizer input + file-fact section carry the fact | no excerpt carried |
| 23 -> 24 | summarizer input + file-fact section carry the fact | no excerpt carried |
| 41 -> 42 | summarizer input + file-fact section carry the fact | no excerpt carried |
| 62 -> 63 | summarizer input + file-fact section carry the fact | no excerpt carried |
| 84 -> 85 | summarizer input + file-fact section carry the fact | no excerpt carried |

The **historical loss** remains `REPRODUCED` and the responsible transformation remains
`IDENTIFIED` — those are facts about the ORIGINAL production code and are unaffected by the
containment. What is withdrawn is the claim that the repair is **deployed**.

The task-contract carry-forward, the verified-outcome carry-forward and the stable-prefix
behaviour are UNCHANGED and remain active in the deployed default.
