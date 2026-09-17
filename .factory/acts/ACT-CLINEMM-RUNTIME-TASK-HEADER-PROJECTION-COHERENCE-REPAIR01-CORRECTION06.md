# ACT-CLINEMM-RUNTIME-TASK-HEADER-PROJECTION-COHERENCE-REPAIR01-CORRECTION06

> Status: **CLOSED / REPAIR01_COMMITTED_CORRECTION06 / PASS**.
> Owning epic: `EPIC-CLINEMM-RUNTIME-TASK-PROGRESSION01`.
>
> ```text
> ENTRY_HEAD  = d67559172
>               "fix(sdk): ACT-CLINEMM-RUNTIME-TASK-HEADER-PROJECTION-
>                COHERENCE-REPAIR01-CORRECTION05 - projection-authority-
>                bound phase stamp"
> DOCS_HEAD   = 930934293
> CORRECTION05_HEAD = d67559172
> LIVE_QUALIFICATION = LIVE_UNAVAILABLE
> ```
>
> Lane state: Idle / task progression row -> REPAIRED /
> REPAIR01_COMMITTED_CORRECTION06. **Lane CLOSED unless a
> fresh specimen re-opens it.**

## 0. Outcome

PASS. The defect that permits one `ExtensionState`
publication to carry both `turnState.phase="streaming"`
and `taskHeaderPresentation.phase="idle"` is repaired at
the canonical production seam, with **five RED proofs**
driving the real `TurnStateTracker` +
`TaskShadowComparator` end-to-end. CORRECTION06 closes
the chain.

## 0.1 Why this exists (reviewer halt traceability)

The Factory reviewer halted CORRECTION05 (`d67559172`)
with a narrower P0:

```
NEW_P0:
  mutation of a LOWER-PRECEDENCE projection input
  can refresh a HIGHER-PRECEDENCE stale phase

CAUSE:
  "projection input changed" !=
  "current projected phase corroborated"

ACTION:
  adversarial awaitingApproval + tool_started RED
  -> replace mutation-based freshness with same-generation
    shadowPhase === legacyPhase corroboration
  -> rerun existing RED/conservation/typecheck
```

Reviewer also flagged a factual bug in the C05 helper:

```
The new helper claims `lifecycle.reason` is part of the
`projectTurnState()` authority tuple and compares it for
`failed`. But the canonical selector simply does
`case "failed": return "error"` and never reads the
reason. So `isSameTurnProjectionAuthority()` is already
not an exact mirror of the projection function it claims
to encode.
```

CORRECTION06:

1. **deletes** `isSameTurnProjectionAuthority` (and the
   `lifecycle.reason` bug) entirely.
2. **deletes** the `preModel` snapshot and parameter.
3. **replaces** the mutation-based stamping rule with
   same-generation agreement:
   ```ts
   const phaseAuthoritiesAgree = shadowPhase === legacyPhase
   if (event !== "noop" && phaseAuthoritiesAgree) {
       this.lastObservedTurnSeqByPhase.set(shadowPhase, turnSeq)
   }
   ```

## 1. Evidence

- `.factory/evidence/ACT-CLINEMM-RUNTIME-TASK-HEADER-PROJECTION-COHERENCE-REPAIR01-CORRECTION06/entry-freeze.txt`
- `.factory/evidence/ACT-CLINEMM-RUNTIME-TASK-HEADER-PROJECTION-COHERENCE-REPAIR01-CORRECTION06/final-report.md`

## 2. Files changed

```text
M apps/vscode/src/sdk/task-state-shadow.ts
M apps/vscode/src/sdk/__tests__/task-header-projection-coherence-repair01.tcr01.test.ts
```

See `final-report.md` s2 for line counts and section pointers.

## 3. RED -> GREEN (chain-of-corrections)

| Test                                  | Pre-C02 | Pre-C03 | Pre-C04 | Pre-C05 | Pre-C06 | Post-C06 |
| ------------------------------------- | ------- | ------- | ------- | ------- | ------- | -------- |
| THCP11_C02_RED                        | FAIL    | PASS    | PASS    | PASS    | PASS    | PASS     |
| THCP11_C03_RED                        | n/a     | FAIL    | PASS    | PASS    | PASS    | PASS     |
| THCP11_C04_RED                        | n/a     | n/a     | FAIL    | PASS    | PASS    | PASS     |
| THCP11_C04_POSITIVE                   | n/a     | n/a     | PASS    | PASS    | PASS    | PASS     |
| THCP11_C05_RED                        | n/a     | n/a     | n/a     | FAIL    | PASS    | PASS     |
| THCP11_C05_AUTHORITY_POSITIVE         | n/a     | n/a     | n/a     | PASS    | PASS    | PASS     |
| THCP11_C05_STREAMING_RED (rewritten)  | n/a     | n/a     | n/a     | PASS    | PASS    | PASS     |
| THCP11_C06_MASKED_RED                 | n/a     | n/a     | n/a     | n/a     | FAIL    | PASS     |
| THCP11_C06_CORROBORATION_POSITIVE     | n/a     | n/a     | n/a     | n/a     | PASS    | PASS     |
| THCP11_C06_CORROBORATION_AGREEMENT    | n/a     | n/a     | n/a     | n/a     | PASS    | PASS     |
| Conservation T1..T14                  | PASS    | PASS    | PASS    | PASS    | PASS    | PASS     |

## 4. Ablation necessity proof

Disabling the agreement check (`phaseAuthoritiesAgree = true`)
fails THREE REDs:
- `THCP11_C04_RED` (semantic no-op)
- `THCP11_C05_RED` (idle + recovery mutation)
- `THCP11_C06_MASKED_RED` (awaiting_approval + tool_started)

C02/C03 REDs and the positive controls still pass.
Proves the agreement check is necessary AND additive.

## 5. Conservation

93/93 tests PASS across all directly-related suites (THCP01
18, E7.1 14, wiring 11, arbiter-mapper 6, shadow-coordinator
6, THCP11 6, TCCC01 5, CLTCC01 5, REPAIR01 27).

## 6. Typecheck

```text
$ bunx tsc --noEmit
(exit code 0; 0 errors)
```

## 7. Lane state after closure

- `Idle / task progression` row -> **REPAIRED /
  REPAIR01_COMMITTED_CORRECTION06**. Lane CLOSED unless a
  fresh specimen re-opens it.
- R5 manual approval -> **WATCH_ONLY** (unchanged).
- R0 execution-obligation -> CLOSED (unchanged).
- Multi-element path cardinality -> CLOSED (unchanged).
- REPAIR01 (`c1c357ccf`) -> SUPERSEDED by CORRECTION02
  (`43bee46bd`), superseded by CORRECTION03 (`5d926c273`),
  superseded by CORRECTION04 (`0a375393d`), superseded by
  CORRECTION05 (`d67559172`), superseded by CORRECTION06.
  All six commits remain in the tree for audit.
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
  CORRECTION05.
- `HALT_PHASE_STAMP_REFRESHED_BY_MASKED_AUTHORITY_MUTATION`:
  FIXED at CORRECTION06 (this ACT).
- `HALT_RED_NOT_REPRODUCED`: not triggered (CORRECTION06 RED
  reproduces pre-repair, passes post-repair).
- `HALT_CAUSAL_DISCRIMINATOR_FAILED`: not triggered (CASE_D
  locked; CORRECTION06 deletes the mutation-proxy entirely,
  replacing it with agreement-driven stamping that is
  precedence-agnostic by construction).
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
  (CORRECTION06 has its own adversarial REDs reproducing on
  the previous revision.)
- No recursive review after GREEN. OK.
- No adding another exception rather than deleting complexity.
  OK. CORRECTION06 net-deletes four pieces of code (the C05
  helper, the `preModel` parameter, two snapshot branches)
  while adding three REDs and the agreement predicate.
