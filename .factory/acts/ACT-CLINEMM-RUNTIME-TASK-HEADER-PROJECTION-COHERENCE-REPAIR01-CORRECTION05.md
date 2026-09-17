# ACT-CLINEMM-RUNTIME-TASK-HEADER-PROJECTION-COHERENCE-REPAIR01-CORRECTION05

> Status: **CLOSED / REPAIR01_COMMITTED_CORRECTION05 / PASS**.
> Owning epic: `EPIC-CLINEMM-RUNTIME-TASK-PROGRESSION01`.
>
> ```text
> ENTRY_HEAD  = 0a375393d
>               "fix(sdk): ACT-CLINEMM-RUNTIME-TASK-HEADER-PROJECTION-
>                COHERENCE-REPAIR01-CORRECTION04 - model-change-bound
>                phase stamp"
> DOCS_HEAD   = 8e56af26a
> CORRECTION04_HEAD = 0a375393d
> LIVE_QUALIFICATION = LIVE_UNAVAILABLE
> ```
>
> Lane state: Idle / task progression row -> REPAIRED /
> REPAIR01_COMMITTED_CORRECTION05. Lane CLOSED unless a
> fresh specimen re-opens it.

## 0. Outcome

PASS. The defect that permits one `ExtensionState` publication
to carry both `turnState.phase="streaming"` and
`taskHeaderPresentation.phase="idle"` is repaired at the
canonical production seam, with **four RED proofs** driving
the real `TurnStateTracker` + `TaskShadowComparator`
end-to-end. CORRECTION05 closes the reviewer halt on
CORRECTION04.

## 0.1 Why this exists (reviewer halt traceability)

The Factory reviewer halted CORRECTION04 (`0a375393d`) with a
narrower P0:

```
NEW_P0:
  full TaskModel mutation != phase-authority mutation
```

CORRECTION04's `isSameTaskModel` check was over-broad. The
canonical `projectTurnState` (selectors.ts:47) reads only FOUR
model axes:

  `activity.awaitingApproval`  (projects "awaiting_approval")
  `activity.modelStreaming`    (projects "streaming")
  `activity.activeToolCallIds` (projects "streaming" via isTooling())
  `lifecycle.kind`             (terminal/resumable axes)
  `lifecycle.reason`           (only when kind=failed)

`recovery_changed` (`update.ts:355`) materially mutates the
model but touches NONE of those axes. So the projected phase
is unchanged - yet CORRECTION04 stamped it, restoring the
LIVE contradiction.

CORRECTION05 replaces `isSameTaskModel` with the narrower
projection-authority check `isSameTurnProjectionAuthority`
that compares ONLY the canonical phase-authority tuple.

## 1. Evidence

- `.factory/evidence/ACT-CLINEMM-RUNTIME-TASK-HEADER-PROJECTION-COHERENCE-REPAIR01-CORRECTION05/entry-freeze.txt`
- `.factory/evidence/ACT-CLINEMM-RUNTIME-TASK-HEADER-PROJECTION-COHERENCE-REPAIR01-CORRECTION05/final-report.md`

## 2. Files changed

```text
M apps/vscode/src/sdk/task-state-shadow.ts
M apps/vscode/src/sdk/__tests__/task-header-projection-coherence-repair01.tcr01.test.ts
```

See `final-report.md` s2 for line counts and section pointers.

## 3. RED -> GREEN (chain-of-corrections)

| Test                                  | Pre-C02 | Pre-C03 | Pre-C04 | Pre-C05 | Post-C05 |
| ------------------------------------- | ------- | ------- | ------- | ------- | -------- |
| THCP11_C02_RED                        | FAIL    | PASS    | PASS    | PASS    | PASS     |
| THCP11_C02_RED_INVERSE                | FAIL    | PASS    | PASS    | PASS    | PASS     |
| THCP11_C02_RED_FRESH_SHADOW_PRESERVED | PASS    | PASS    | PASS    | PASS    | PASS     |
| THCP11_C02_THINKING_RED               | FAIL    | PASS    | PASS    | PASS    | PASS     |
| THCP11_C03_RED                        | n/a     | FAIL    | PASS    | PASS    | PASS     |
| THCP11_C04_RED                        | n/a     | n/a     | FAIL    | PASS    | PASS     |
| THCP11_C04_POSITIVE                   | n/a     | n/a     | PASS    | PASS    | PASS     |
| THCP11_C05_RED                        | n/a     | n/a     | n/a     | FAIL    | PASS     |
| THCP11_C05_AUTHORITY_POSITIVE         | n/a     | n/a     | n/a     | PASS    | PASS     |
| THCP11_C05_STREAMING_RED              | n/a     | n/a     | n/a     | FAIL    | PASS     |
| Conservation T1..T14                  | PASS    | PASS    | PASS    | PASS    | PASS     |

## 4. Ablation necessity proof

Disabling the projection-authority check
(`projectionAuthorityChanged = preModel === null ? true : true`)
makes `THCP11_C04_RED`, `THCP11_C05_RED`, and
`THCP11_C05_STREAMING_RED` fail. C02/C03 REDs still pass
because they are gated by other invariants. Proving the
projection-authority check is necessary and additive.

## 5. Conservation

90/90 tests PASS across all directly-related suites (THCP01
18, E7.1 14, wiring 11, arbiter-mapper 6, shadow-coordinator
6, THCP11 6, TCCC01 5, CLTCC01 5, REPAIR01 24).

## 6. Typecheck

```text
$ bunx tsc --noEmit
(exit code 0; 0 errors)
```

## 7. Lane state after closure

- `Idle / task progression` row -> **REPAIRED /
  REPAIR01_COMMITTED_CORRECTION05**. Lane CLOSED unless a
  fresh specimen re-opens it.
- R5 manual approval -> **WATCH_ONLY** (unchanged).
- R0 execution-obligation -> CLOSED (unchanged).
- Multi-element path cardinality -> CLOSED (unchanged).
- REPAIR01 (`c1c357ccf`) -> SUPERSEDED by CORRECTION02
  (`43bee46bd`), superseded by CORRECTION03 (`5d926c273`),
  superseded by CORRECTION04 (`0a375393d`), superseded by
  CORRECTION05. All five commits remain in the tree for
  audit.
- `ACT-CLINEMM-RUNTIME-TASK-HEADER-PROJECTION-FORENSICS01` ->
  preserved as historical evidence; mechanism dropped per
  REPAIR01 entry-fact 8; not re-executed.

## 8. STOP conditions not triggered

- `HALT_SEQ_DOMAIN_IDENTITY_NOT_PROVEN`: FIXED at CORRECTION02.
- `HALT_SHADOW_PHASE_STAMP_NOT_BOUND_TO_PROJECTION`: FIXED at
  CORRECTION03.
- `HALT_PHASE_STAMP_ADVANCES_ON_SEMANTIC_NOOP`: FIXED at
  CORRECTION04.
- `HALT_PHASE_STAMP_ADVANCES_ON_NON_PHASE_MUTATION`: FIXED at
  CORRECTION05 (this ACT).
- `HALT_RED_NOT_REPRODUCED`: not triggered (CORRECTION05 REDs
  reproduce pre-repair, pass post-repair).
- `HALT_CAUSAL_DISCRIMINATOR_FAILED`: not triggered (CASE_D
  locked; CORRECTION05 binds the stamp to projection-authority
  changes, which addresses the narrow P0 without changing
  the case).
- `HALT_<NEW_P0>`: not triggered.

## 9. FORBIDDEN checklist

- No R5 work. OK.
- No outside-read policy changes. OK.
- No R0 reopening. OK.
- No new generic diagnostic framework. OK.
- No ACT-owned-capture requirement. OK.
- No timer/debounce cosmetic fix. OK.
- No UI-only patch. OK.
- No React functional-updater diagnostic side effects. OK.
- No request-time observation called updater-time observation. OK.
- No phase-observation-bound cardinality comparison. OK.
- No repair without RED reproduction. OK.
  (CORRECTION05 has its own adversarial REDs reproducing on
  the previous revision.)
- No recursive review after GREEN. OK.
