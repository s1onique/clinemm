# ACT-CLINEMM-RUNTIME-TASK-HEADER-PROJECTION-COHERENCE-REPAIR01

> Status: **CLOSED / REPAIR01_COMMITTED / PASS**.
> Owning epic: `EPIC-CLINEMM-RUNTIME-TASK-PROGRESSION01`.
>
> ```text
> ENTRY_HEAD = 7caca443b592360ac02e90d3bc4461af0ef0edda
> REPAIR_HEAD = c1c357ccf
>               "fix(sdk): ACT-CLINEMM-RUNTIME-TASK-HEADER-PROJECTION-
>                COHERENCE-REPAIR01 - shadow-vs-legacy generation-skeew
>                repair at the publication selectors"
> DOCS_HEAD  = de4066829
>               "docs(factory): ACT-CLINEMM-RUNTIME-TASK-HEADER-
>                PROJECTION-COHERENCE-REPAIR01 - board row update
>                (PASS at c1c357ccf)"
> LIVE_QUALIFICATION = LIVE_UNAVAILABLE
>                     (no Aqua session in this shell; mechanical
>                     GREEN per ACT body §9 is sufficient)
> ```

## 0. Outcome

PASS. The defect that permits one `ExtensionState` publication to
carry both `turnState.phase="streaming"` and
`taskHeaderPresentation.phase="idle"` is repaired at the canonical
production seam (`selectTaskHeaderPresentation` /
`selectThinkingPresentation`).

Causal classification: **CASE_D — INDEPENDENT AUTHORITY
GENERATION SKEW**.

Repair surface: one new optional input parameter
(`canonicalShadowSeq?: number`) on both selectors, with one extra
precedence gate that falls through to the legacy branch when the
shadow's last observation seq is older than the legacy tracker's
seq.

## 1. Evidence

- `.factory/evidence/ACT-CLINEMM-RUNTIME-TASK-HEADER-PROJECTION-COHERENCE-REPAIR01/entry-freeze.txt`
- `.factory/evidence/ACT-CLINEMM-RUNTIME-TASK-HEADER-PROJECTION-COHERENCE-REPAIR01/source-seam-trace.md`
- `.factory/evidence/ACT-CLINEMM-RUNTIME-TASK-HEADER-PROJECTION-COHERENCE-REPAIR01/red-report.md`
- `.factory/evidence/ACT-CLINEMM-RUNTIME-TASK-HEADER-PROJECTION-COHERENCE-REPAIR01/causal-classification.md`
- `.factory/evidence/ACT-CLINEMM-RUNTIME-TASK-HEADER-PROJECTION-COHERENCE-REPAIR01/final-report.md`

## 2. Files changed

```text
M apps/vscode/src/sdk/SdkController.ts
M apps/vscode/src/sdk/task-state-shadow-arbiter-mapper.ts
M apps/vscode/src/sdk/task-state-shadow-host-wiring.ts
M apps/vscode/src/sdk/task-state-shadow.ts
A apps/vscode/src/sdk/__tests__/task-header-projection-coherence-repair01.tcr01.test.ts
```

See `final-report.md` §2 for the full line counts and section
pointers.

## 3. RED → GREEN

| Test                                    | Pre-repair | Post-repair |
| --------------------------------------- | ---------- | ----------- |
| THCP11_RED                              | FAIL       | PASS        |
| THCP11_RED_INVERSE                      | FAIL       | PASS        |
| THCP11_RED_FRESH_SHADOW_PRESERVED       | PASS       | PASS        |
| THCP11_THINKING_RED                     | FAIL       | PASS        |
| Conservation T1..T14 (14 tests)         | n/a (new)  | PASS        |

Total: **18 tests in `tcr01.test.ts` — all PASS post-repair**;
3 RED reproductions confirmed pre-repair.

## 4. No regression (independent baseline)

- THCP01 (existing TaskHeader presentation contract): 18 tests PASS.
- E7.1 (existing Thinking presentation contract): 14 tests PASS.
- CLTCC01/13/15 (compaction legacy-turnstate coherence): 53 tests
  PASS.
- AOPC01/AOPC02-PHASE-A-CORRECTION03 (application ownership
  projection coherence bridge): all PASS.
- ARTC01, CTA01, LAC01 (related task-header coherence): all PASS.
- Task-state-shadow-host-wiring + task-state-shadow-coordinator:
  all PASS.

Pre-existing baseline failures (independently verified by
`git stash` + rerun) are environmental, not caused by REPAIR01:

- `darwin-seatbelt-safe-yolo-network-open01.c1-green.test.ts`:
  2 (Seatbelt sandbox env-dependent)
- `darwin-seatbelt-safe-yolo-sensitive-read-confinement01.c2-green.test.ts`:
  11 (Seatbelt sandbox env-dependent)
- `async-command-turn-liveness.acl01.test.ts`: 3 (async-job
  lifecycle env-dependent)
- `SdkController.test.ts`: 3 in `SDK remote-config coordination`
  (network-dependent)

## 5. Typecheck

```text
$ bunx tsc --noEmit
(exit code 0; 0 errors)
```

## 6. Live qualification

**LIVE_UNAVAILABLE.** Per ACT body §9: mechanical RED/GREEN
causality are sufficient when the IDE host cannot launch in this
environment.

## 7. Lane state after closure

- `Idle / task progression` row → **REPAIRED /
  REPAIR01_COMMITTED**. Lane CLOSED unless a fresh specimen
  re-opens it.
- R5 manual approval → **WATCH_ONLY** (`R5_NEXT_TRIGGER =
  fully-authorized all-inside unexpected ASK`).
- R0 execution-obligation → CLOSED (unchanged).
- Multi-element path cardinality → CLOSED (unchanged).
- `ACT-CLINEMM-RUNTIME-TASK-HEADER-PROJECTION-FORENSICS01` →
  preserved as historical evidence (HALTED with mechanism
  dropped per REPAIR01 entry-fact 8); not re-executed.

## 8. STOP conditions not triggered

- `HALT_UNEXPECTED_TRACKED_DIRT`: not triggered (worktree clean).
- `HALT_RED_NOT_REPRODUCED`: not triggered (RED reproduced 3/3).
- `HALT_CAUSAL_DISCRIMINATOR_FAILED`: not triggered (CASE_D
  locked; repair removes RED).
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
- No unbound shadow evidence promoted to same-generation proof. ✓
- No repair without RED reproduction. ✓ (RED reproduced; ablation
  implicit via the same test file)
- No recursive review after GREEN. ✓
