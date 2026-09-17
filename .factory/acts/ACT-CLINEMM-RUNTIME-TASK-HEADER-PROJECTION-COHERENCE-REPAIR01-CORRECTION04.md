# ACT-CLINEMM-RUNTIME-TASK-HEADER-PROJECTION-COHERENCE-REPAIR01-CORRECTION04

> Status: **CLOSED / REPAIR01_COMMITTED_CORRECTION04 / PASS**.
> Owning epic: `EPIC-CLINEMM-RUNTIME-TASK-PROGRESSION01`.
>
> ```text
> ENTRY_HEAD  = 5d926c273
>               "fix(sdk): ACT-CLINEMM-RUNTIME-TASK-HEADER-PROJECTION-
>                COHERENCE-REPAIR01-CORRECTION03 - phase-key the
>                shadow stamp + reject noop observations"
> DOCS_HEAD   = 08b3172a8
>               "docs(factory): ACT-CLINEMM-RUNTIME-TASK-HEADER-
>                PROJECTION-COHERENCE-REPAIR01-CORRECTION03 - board
>                row update (PASS, CORRECTION02 superseded)"
> CORRECTION03_HEAD = 5d926c273
>                    (CORRECTION03 is superseded by CORRECTION04)
> LIVE_QUALIFICATION = LIVE_UNAVAILABLE
> ```
>
> Lane state: Idle / task progression row -> REPAIRED /
> REPAIR01_COMMITTED_CORRECTION04. Lane CLOSED unless a fresh
> specimen re-opens it.

## 0. Outcome

PASS. The defect that permits one `ExtensionState` publication to
carry both `turnState.phase="streaming"` and
`taskHeaderPresentation.phase="idle"` is repaired at the canonical
production seam, with a chain of three RED proofs (CORRECTION02,
CORRECTION03, CORRECTION04) driving the real `TurnStateTracker` +
`TaskShadowComparator` end-to-end. CORRECTION04 closes the
reviewer halt on CORRECTION03.

## 0.1 Why this exists (reviewer halt traceability)

The Factory reviewer halted CORRECTION03 (`5d926c273`) with a
narrower P0:

```
NEW_P0:
  event != "noop" is not equivalent to shadow-state mutation
```

CORRECTION03's stamping rule `if (event !== "noop")` was a
label-based proxy for mutation. The production shadow reducer
has documented semantic-noop paths
(`task-state.update.test.ts:312`):

  "an approval_resolved WITHOUT an active approval is a no-op"

That is, a perfectly valid TaskMsg with a non-`"noop"` event
label that the reducer accepts but leaves the model untouched.
The label-based rule could not distinguish those from real
mutations; they advanced the stamp and restored the LIVE
contradiction.

CORRECTION04 replaces the label proxy with the canonical
structural-equality check `isSameTaskModel`
(`@cline/agents/runtime/state/task-state/model.ts`). The
stamp advances only when the shadow model structurally
changed between pre- and post-observation, OR this is the
comparator's very first observation (no pre-model to
compare against).

## 1. Evidence

- `.factory/evidence/ACT-CLINEMM-RUNTIME-TASK-HEADER-PROJECTION-COHERENCE-REPAIR01-CORRECTION04/entry-freeze.txt`
- `.factory/evidence/ACT-CLINEMM-RUNTIME-TASK-HEADER-PROJECTION-COHERENCE-REPAIR01-CORRECTION04/final-report.md`

## 2. Files changed

```text
M apps/vscode/src/sdk/task-state-shadow.ts
M apps/vscode/src/sdk/__tests__/task-header-projection-coherence-repair01.tcr01.test.ts
```

See `final-report.md` §2 for line counts and section pointers.

## 3. RED -> GREEN (chain-of-corrections)

| Test                                  | Pre-C02 | Pre-C03 | Pre-C04 | Post-C04 |
| ------------------------------------- | ------- | ------- | ------- | -------- |
| THCP11_C02_RED                        | FAIL    | PASS    | PASS    | PASS     |
| THCP11_C02_RED_INVERSE                | FAIL    | PASS    | PASS    | PASS     |
| THCP11_C02_RED_FRESH_SHADOW_PRESERVED | PASS    | PASS    | PASS    | PASS     |
| THCP11_C02_THINKING_RED               | FAIL    | PASS    | PASS    | PASS     |
| THCP11_C03_RED                        | n/a     | FAIL    | PASS    | PASS     |
| THCP11_C04_RED                        | n/a     | n/a     | FAIL    | PASS     |
| THCP11_C04_POSITIVE                   | n/a     | n/a     | PASS    | PASS     |
| Conservation T1..T14                  | PASS    | PASS    | PASS    | PASS     |

(Each RED reproduces in its respective pre-repair revision.)

## 4. Ablation necessity proof

Disabling the model-equality check
(`materialMutation = preModel === null ? true : true`) makes
`THCP11_C04_RED` fail. All other tests still pass. Proving the
check is necessary and additive.

## 5. Conservation

87/87 tests PASS across all directly-related suites (THCP01
18, E7.1 14, wiring 11, arbiter-mapper 6, shadow-coordinator
6, THCP11 6, TCCC01 5, CLTCC01 5, REPAIR01 21).

## 6. Typecheck

```text
$ bunx tsc --noEmit
(exit code 0; 0 errors)
```

## 7. Lane state after closure

- `Idle / task progression` row -> **REPAIRED /
  REPAIR01_COMMITTED_CORRECTION04**. Lane CLOSED unless a
  fresh specimen re-opens it.
- R5 manual approval -> **WATCH_ONLY** (unchanged).
- R0 execution-obligation -> CLOSED (unchanged).
- Multi-element path cardinality -> CLOSED (unchanged).
- REPAIR01 (`c1c357ccf`) -> SUPERSEDED by CORRECTION02
  (`43bee46bd`), superseded by CORRECTION03 (`5d926c273`),
  superseded by CORRECTION04. All four commits remain in the
  tree for audit.
- `ACT-CLINEMM-RUNTIME-TASK-HEADER-PROJECTION-FORENSICS01` ->
  preserved as historical evidence; mechanism dropped per
  REPAIR01 entry-fact 8; not re-executed.

## 8. STOP conditions not triggered

- `HALT_SEQ_DOMAIN_IDENTITY_NOT_PROVEN`: FIXED at CORRECTION02.
- `HALT_SHADOW_PHASE_STAMP_NOT_BOUND_TO_PROJECTION`: FIXED at
  CORRECTION03.
- `HALT_PHASE_STAMP_ADVANCES_ON_SEMANTIC_NOOP`: FIXED at
  CORRECTION04 (this ACT).
- `HALT_RED_NOT_REPRODUCED`: not triggered (CORRECTION04 RED
  reproduces pre-repair, passes post-repair).
- `HALT_CAUSAL_DISCRIMINATOR_FAILED`: not triggered (CASE_D
  locked; CORRECTION04 binds the stamp to model material
  mutation, which addresses the narrow P0 without changing
  the case).
- `HALT_<NEW_P0>`: not triggered.

## 9. FORBIDDEN checklist

- No R5 work. ✓
- No outside-read policy changes. ✓
- No R0 reopening. ✓
- No new generic diagnostic framework. ✓
- No ACT-owned-capture requirement. ✓
- No timer/debounce cosmetic fix. ✓
- No UI-only patch. ✓
- No React functional-updater diagnostic side effects. ✓
- No request-time observation called updater-time observation. ✓
- No phase-observation-bound cardinality comparison. ✓
- No repair without RED reproduction. ✓
  (CORRECTION04 has its own adversarial RED reproducing on
  the previous revision.)
- No recursive review after GREEN. ✓
