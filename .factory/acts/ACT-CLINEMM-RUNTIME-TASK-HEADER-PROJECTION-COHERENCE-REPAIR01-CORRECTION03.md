# ACT-CLINEMM-RUNTIME-TASK-HEADER-PROJECTION-COHERENCE-REPAIR01-CORRECTION03

> Status: **CLOSED / REPAIR01_COMMITTED_CORRECTION03 / PASS**.
> Owning epic: `EPIC-CLINEMM-RUNTIME-TASK-PROGRESSION01`.
>
> ```text
> ENTRY_HEAD  = 43bee46bd
>               "fix(sdk): ACT-CLINEMM-RUNTIME-TASK-HEADER-PROJECTION-
>                COHERENCE-REPAIR01-CORRECTION02 - bind shadow
>                observation to the TurnState sequence domain"
> DOCS_HEAD   = a7464f5f3
>               "docs(factory): ACT-CLINEMM-RUNTIME-TASK-HEADER-
                PROJECTION-COHERENCE-REPAIR01-CORRECTION02 - board
                row update (PASS, REPAIR01 superseded)"
> CORRECTION02_HEAD = 43bee46bd
>                    (CORRECTION02 is superseded by CORRECTION03)
> LIVE_QUALIFICATION = LIVE_UNAVAILABLE
> ```
>
> Lane state: Idle / task progression row → REPAIRED /
> REPAIR01_COMMITTED_CORRECTION03. Lane CLOSED unless a fresh
> specimen re-opens it.

## 0. Outcome

PASS. The defect that permits one `ExtensionState` publication to
carry both `turnState.phase="streaming"` and
`taskHeaderPresentation.phase="idle"` is repaired at the canonical
production seam, with **both** the seq-domain identity
(CORRECTION02 invariant) **and** the projection binding
(CORRECTION03 invariant) proven by RED tests driving the real
`TurnStateTracker` + `TaskShadowComparator` end-to-end.

## 0.1 Why this exists (reviewer halt traceability)

CORRECTION02 (commit `43bee46bd`) was halted by the Factory
reviewer with a narrower P0:

```
NEW_P0:
  SHADOW_PHASE_STAMP_NOT_BOUND_TO_PROJECTION

GOOD:
  same TurnState sequence domain
  real tracker/comparator RED
  executable conservation
  clean two-commit range

MISSING:
  proof that lastObservedTurnSeq versions the shadow phase,
  rather than merely the most recent shadow observation

ACTION:
  one adversarial RED
  → prove impossible OR reproduce
  → if reproduced, phase-bind the stamp
  → rerun existing gates
```

CORRECTION02's stamp advanced on every accepted observation
regardless of whether the observation changed the shadow's
projected phase. A noop observation (production's
"shadow was touched but didn't transition" sentinel at
shadow-adapter.ts:212) under a fresh TurnState generation
advances the stamp without changing the projected phase — the
LIVE contradiction resurfaces.

CORRECTION03 binds the stamp to the projected PHASE on a per-P
Map basis, AND only updates the entry when the observation
event is non-noop.

## 1. Evidence

- `.factory/evidence/ACT-CLINEMM-RUNTIME-TASK-HEADER-PROJECTION-COHERENCE-REPAIR01-CORRECTION03/entry-freeze.txt`
- `.factory/evidence/ACT-CLINEMM-RUNTIME-TASK-HEADER-PROJECTION-COHERENCE-REPAIR01-CORRECTION03/final-report.md`

## 2. Files changed

```text
M apps/vscode/src/sdk/SdkController.ts
M apps/vscode/src/sdk/task-state-shadow.ts
M apps/vscode/src/sdk/task-state-shadow-host-wiring.ts
M apps/vscode/src/sdk/__tests__/task-header-projection-coherence-repair01.tcr01.test.ts
```

See `final-report.md` §2 for line counts and section pointers.

## 3. RED → GREEN (projection-binding proof)

| Test                                  | Pre-repair | Post-repair |
| ------------------------------------- | ---------- | ----------- |
| THCP11_C02_RED                        | PASS       | PASS        |
| THCP11_C02_RED_INVERSE                | PASS       | PASS        |
| THCP11_C02_RED_FRESH_SHADOW_PRESERVED | PASS       | PASS        |
| THCP11_C02_THINKING_RED               | PASS       | PASS        |
| THCP11_C03_RED                        | **FAIL**   | **PASS**    |
| Conservation T1..T14                  | PASS       | PASS        |

The new THCP11_C03_RED test drives the adversarial schedule the
reviewer requested:

```ts
tracker idle N
→ shadow idle stamped N       (real TaskMsg-driven seam)
→ tracker streaming N+1        (legacy advances)
→ shadow noop observed at N+1 (shadow-projection unchanged)
→ publication
```

The test asserts:

```ts
expect(stampAfterNoop).toBe(seqAtIdle)               // noop did NOT re-stamp
expect(stampAfterNoop).not.toBe(seqAfterStreaming)   // seq advanced ≠ stamp advanced
expect(projection.phase).toBe("streaming")           // gate fired; LIVE forbidden
```

## 4. Ablation necessity proof

Disabling the noop-aware stamping rule
(`if (event !== "noop") { ... }` removed) makes the new
`THCP11_C03_RED` test FAIL — proving the rule is **necessary**,
not redundant.

## 5. Conservation

85 tests PASS across all directly-related suites (THCP01 18,
E7.1 14, wiring 11, arbiter-mapper 6, shadow-coordinator 6,
THCP11 6, TCCC01 5, CLTCC01 5, REPAIR01 19).

## 6. Typecheck

```text
$ bunx tsc --noEmit
(exit code 0; 0 errors)
```

## 7. Lane state after closure

- `Idle / task progression` row → **REPAIRED /
  REPAIR01_COMMITTED_CORRECTION03**. Lane CLOSED unless a fresh
  specimen re-opens it.
- R5 manual approval → **WATCH_ONLY** (unchanged).
- R0 execution-obligation → CLOSED (unchanged).
- Multi-element path cardinality → CLOSED (unchanged).
- REPAIR01 (`c1c357ccf`) → SUPERSEDED by CORRECTION02 (`43bee46bd`),
  which is SUPERSEDED by CORRECTION03. All three commits remain in
  the tree for audit.
- `ACT-CLINEMM-RUNTIME-TASK-HEADER-PROJECTION-FORENSICS01` →
  preserved as historical evidence; mechanism dropped per REPAIR01
  entry-fact 8; not re-executed.

## 8. STOP conditions not triggered

- `HALT_SEQ_DOMAIN_IDENTITY_NOT_PROVEN`: FIXED at CORRECTION02.
- `HALT_SHADOW_PHASE_STAMP_NOT_BOUND_TO_PROJECTION`: FIXED at
  CORRECTION03 (this ACT).
- `HALT_RED_NOT_REPRODUCED`: not triggered.
- `HALT_CAUSAL_DISCRIMINATOR_FAILED`: not triggered (CASE_D
  locked; CORRECTION03 binds the stamp to the projection, which
  addresses the narrow P0).
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
  (CORRECTION03 explicitly removes the per-observation
  cardinality comparison and replaces it with a phase-keyed
  map updated only on non-noop observations.)
- No repair without RED reproduction. ✓
- No recursive review after GREEN. ✓
