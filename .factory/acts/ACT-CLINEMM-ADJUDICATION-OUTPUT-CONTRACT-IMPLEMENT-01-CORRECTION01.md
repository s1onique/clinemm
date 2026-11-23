# ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-IMPLEMENT-01-CORRECTION01

> Status: **OPEN / IN_REVIEW** — bounded provenance-correction ACT against
> the implementation of `ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-IMPLEMENT-01`.
> Authored 2026-11-23 in response to the factory reviewer's verdict
> `HALT_ADJUDICATION_PROVENANCE_CONTRACT`.
>
> **Primary purpose**: repair the three load-bearing provenance defects the
> reviewer found in the committed implementation, and requalify the exact
> packaged artifact — without a new memory framework, without unrelated
> refactoring, and without a new long Round C run.
>
> **Predecessor**:
> `ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-IMPLEMENT-01`
> (`PASS_STRUCTURAL_ONLY`, commit `c7de1120e`). The predecessor's
> structural continuity result and its 4/16 real-model acceptance
> measurement are **PRESERVED** and are not re-litigated here. This ACT
> targets the provenance contract and the artifact identity only.
>
> **Forecasted outcome**: a `PASS_CORRECTION_PROVENANCE_BOUND` review
> verdict, with the release-artifact identity established by the bundled
> bytes of a freshly rebuilt VSIX.

---

## FACTORY_REVIEWER_PROMPT (2026-11-23)

| Expert(s)                                      | Question                                                       | Plan                                                                          |
| ---------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| ClineMM runtime, security, release engineering | Review `ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-IMPLEMENT-01` | Verify C1/C2, source provenance, artifact identity and qualification evidence |

**Review verdict: `HALT_ADJUDICATION_PROVENANCE_CONTRACT`**

Structural progress is confirmed; release is NOT authorized. Four P0s.

### P0-1 — source revision is not bound at acquisition time

`bindSourceRevision()` resolves the *current* file during candidate
evaluation. Nothing stores the revision/content identity that the
evidence had when it was acquired. The counterexample is a file edited
between the read and the citation: the candidate is accepted with the
LATER identity while its evidence was the EARLIER content.

### P0-2 — evidence success and source identity are insufficiently validated

`buildCanonicalEvidenceLedger()` treats a tool result as successful
whenever `block.is_error !== true`, accepting a result with no affirmative
success signal. `extractSourcePath()` extracts a path from the tool-call
arguments without verifying that the tool READ that path, and selects only
the FIRST path of a multi-file request.

### P0-3 — handle continuity fails across session recreation

The registry's secret is random per construction and is deliberately not
persisted, so a restored session cannot resolve previously published
handles. The persisted adjudication disappears on restoration.

### P0-4 — the packaged VSIX contains an outdated compiled SDK implementation

The extension bundles `@cline/core` from compiled `dist/` files, so
source-level tests do not establish that the VSIX contains the final
implementation.

---

## MISSION

Apply the bounded correction above, in one cycle, and produce evidence
that is re-derivable from the committed transcript alone.

### Required work — four executable gates

| # | Gate | Artifact |
|---|------|----------|
| 1 | Reproduce and repair ACQUISITION-TIME evidence identity, including a changed file and a multi-file call | `sdk/packages/core/src/extensions/context/adjudication-continuity.ts`, `.../compaction.adjudication-provenance.correction01.test.ts` |
| 2 | Reject failed, ambiguous, non-read and insufficiently attributed evidence using the ACTUAL production result semantics | same module + same test |
| 3 | Exercise session recreation against persisted canonical history and sidecar; demonstrate valid continuity OR explicitly define and test fail-closed loss | same module + same test |
| 4 | Rebuild `@cline/core`, repackage the VSIX, verify the corrected implementation in its ACTUAL bundled bytes | `verification/gate4-artifact-identity.txt` |

### Conservation requirements

```text
RED_WITNESS (adjudication-continuity.red01.test.ts)   byte-identical
PRE-EXISTING TESTS                                   none modified/skipped/deleted
NEW MEMORY FRAMEWORK                                 none
UNRELATED REFACTORING                                none
NEW LONG ROUND C RUN                                 none
PREDECESSOR STRUCTURAL VERDICT                       PRESERVED
PREDECESSOR 4/16 LIVE ACCEPTANCE                    PRESERVED
```

### Out of scope (explicitly NOT claimed as fixed)

- The three whitespace findings and the stale gate-summary binding
  (**P2, NON-BLOCKING**).
- Behavioral improvement (whether ClineMM investigates less after
  compaction) — **not established** by this ACT.

---

## EVIDENCE

`.factory/evidence/ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-IMPLEMENT-01-CORRECTION01/`

```text
00-entry-identity.md
01-acquisition-time-binding.md
02-evidence-authority.md
03-session-continuity.md
04-artifact-identity.md
05-exit-report.md
artifact-hashes.json
verification/
```

## BOARD

`.factory/epic-board.md` — entry
`ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-IMPLEMENT-01-CORRECTION01`.
