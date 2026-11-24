# ACT-CLINEMM-PCK-EVIDENCE-FIRST-INPUT-RECON-01 — C3 the utility oracle

## WHY AN ORACLE IS NEEDED FIRST

"Utility" cannot be measured against a candidate's own output — that is
circular. So before any candidate was run, the RELEVANT KNOWLEDGE of the
source history was inventoried **independently**, from the history's own
task contract and from the runtime's own evidence machinery.

The oracle is at
`sdk/packages/core/scripts/pck-input-recon.utility-oracle.ts` and its
output is written to the gitignored tree
(`tmp/pck-input-recon/1795489471969_tachv.utility-oracle.json`).

## THE INVENTORY

```json
{
  "frozenFindingCount": 10,
  "frozenFindingIds": ["R1","R2","R3","R4","R5","R6","R7","R8","R9","R10"],
  "frozenFindingRatings": {
    "R1": "Severity 5/5, Confidence 5/5",
    "R2": "Severity 5/5, Confidence 4/5",
    "R3": "Severity 4/5, Confidence 4",
    "R4": "Severity 4/5, Confidence 3",
    "R5": "Severity 4/5, Confidence 4",
    "R6": "Severity 4/5, Confidence 4",
    "R7": "Severity 4/5, Confidence 5/5",
    "R8": "Severity 4/5 (5 if unrotated), Confidence 4/5 for exposure and 2/5 for current usability",
    "R9": "Severity 3/5, Confidence 4/5",
    "R10": "Severity 3/5, Confidence 4/5"
  },
  "runtimeOwnedObservationCount": 56,
  "runtimeEstablishedObservationCount": 5,
  "alreadyPreservedItemCount": 10,
  "totalItemCount": 66,
  "canonicalReferenceCount": 170,
  "incrementalCandidateItemCount": 56
}
```

## THE SEVEN CLASSES, CLASSIFIED AGAINST THIS HISTORY

| Class | Count in this history | Where it lives |
| --- | --- | --- |
| **Established observations** | 56 runtime-owned tool events, of which **5** the runtime can establish at a stronger assurance (the `sed`-classified `run_commands` calls) | the joined call↔result ledger |
| **Unverified hypotheses** | the 10 findings' surviving or rejected conclusions — all free text, none expressible in the closed vocabulary | the task contract + the transcript |
| **Active constraints** | the task contract's own prohibitions (no commits, no pushes, no live Kubernetes, no credential testing, HALT on unexpected HEAD, …) | the task contract |
| **Unresolved questions** | the open falsification questions per finding | the transcript |
| **Superseded evidence** | the earlier build's own claims that the session supersedes | the transcript |
| **Contradictory evidence** | e.g. the stock image observed without CI `--set` vs the CI-set image; the `helm template` EXIT=0 vs EXIT=1 pair | the tool results |
| **Already-preserved knowledge** | **10** — the ten frozen findings R1–R10 with their severity/confidence ratings, plus the task contract's prohibitions | the **task-contract** mechanism |

## THE DECISIVE ORACLE OBSERVATION

**Ten of the sixty-six inventoried items — exactly the ten frozen findings,
which are the session's ACTUAL working knowledge — are ALREADY PRESERVED**
by the production task-contract mechanism, together with their severity and
confidence ratings.

The remaining 56 items are the runtime-owned tool events. Of those, the
runtime can establish a stronger assurance for only **5**.

So the ceiling on a checkpoint's incremental utility over ordinary
compaction, for this workload and under the CLOSED vocabulary, is:

```text
MAX_INCREMENTAL_ITEMS_ESTABLISHABLE_BY_THE_RUNTIME = 5
```

...and every one of those 5 is an allowlisted command SUBJECT
(`sed`), because that is the only classification the workload's commands
carry besides `(none)`.

## WHAT THE ORACLE SAYS ABOUT UTILITY

The ACT states: *"Record count alone is not a utility metric. An empty
checkpoint is a valid result when no additional useful knowledge exists."*

Applied here:

- The **10 items that matter** are already preserved by the task contract.
- The **56 candidate items** are tool events whose subjects are `sed` and
  `(none)`.
- The published statement of a record is RENDERED from a closed atom label
  and a closed argument label, so a record can say **only**
  `operation invoked: <argument>` and the argument vocabulary on this
  workload collapses to `none`.

Therefore the **incremental checkpoint utility over ordinary compaction is
bounded at effectively ZERO for this workload**, and the C4 measurements
confirm it empirically: every admitted statement is generic.

## WHAT AN EMPTY CHECKPOINT MEANS HERE

An empty checkpoint is the CORRECT result for this workload under the closed
vocabulary. The evidence supports this reading rather than contradicting it:

1. The 10 findings are preserved by the task contract.
2. The 5 runtime-established observations are already preserved by the
   **verified-outcome ledger** (`extractVerifiedToolOutcomes()`), which
   carries each successful tool outcome's status and its allowlisted
   subjects across compaction.
3. The closed vocabulary has no field that can express a finding's content,
   a hypothesis, a question's text, a contradiction or a resolution.

A checkpoint that published only `operation invoked: none` would be
**noise**: it would add tokens to the compacted context and would assert
nothing that the reader did not already have.
