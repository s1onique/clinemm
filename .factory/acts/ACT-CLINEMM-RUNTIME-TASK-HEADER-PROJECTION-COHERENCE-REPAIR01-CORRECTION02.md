# ACT-CLINEMM-RUNTIME-TASK-HEADER-PROJECTION-COHERENCE-REPAIR01-CORRECTION02

> Status: **CLOSED / REPAIR01_COMMITTED_CORRECTION02 / PASS**.
> Owning epic: `EPIC-CLINEMM-RUNTIME-TASK-PROGRESSION01`.
>
> ```text
> ENTRY_HEAD  = c1c357ccf
>               "fix(sdk): ACT-CLINEMM-RUNTIME-TASK-HEADER-PROJECTION-
>                COHERENCE-REPAIR01 - shadow-vs-legacy generation-skeew
>                repair at the publication selectors"
> DOCS_HEAD   = de4066829
>               "docs(factory): ACT-CLINEMM-RUNTIME-TASK-HEADER-
>                PROJECTION-COHERENCE-REPAIR01 - board row update"
> REPAIR01_HEAD = c1c357ccf
>                (REPAIR01 is superseded by CORRECTION02 — the
>                seq-domain identity it attempted was invalid;
>                both commits remain in the tree)
> LIVE_QUALIFICATION = LIVE_UNAVAILABLE
>                       (no Aqua session in this shell; mechanical
>                       GREEN with same-domain proof per ACT body §9)
> ```

## 0. Outcome

PASS. The defect that permits one `ExtensionState` publication to
carry both `turnState.phase="streaming"` and
`taskHeaderPresentation.phase="idle"` is repaired at the canonical
production seam, with the seq-domain identity proven by RED tests
that drive the real `TurnStateTracker` + `TaskShadowComparator`
end-to-end (not by manually injected numbers).

## 0.1 Why this exists (reviewer halt traceability)

The previous REPAIR01 (commit `c1c357ccf`) was halted by the
Factory reviewer with:

```
P0 — HALT_SEQ_DOMAIN_IDENTITY_NOT_PROVEN.
... The wiring then exposes that unrelated counter as
getLastObservedShadowSeq(). Nothing in the supplied patch binds
that counter to the TurnStateTracker/publication seq domain.
... The new tests continue to manually manufacture this
assumption.
... HALT_SEQ_DOMAIN_IDENTITY_NOT_PROVEN.
```

The original REPAIR01 compared two unrelated counters (the
TurnState lifecycle seq vs the shadow's INTERNAL observation
counter). Those have different event cardinalities; comparing
them numerically does not establish chronology. The RED tests
encoded the invalid identity assumption by hand.

CORRECTION02 binds the shadow's last-observation stamp to the
**TurnState sequence domain** by sampling
`turnStateTracker.get().seq` at the moment the shadow accepts an
observation. Both sides of the publication-selector staleness gate
(`seq` and `canonicalShadowObservedTurnSeq`) are now sampled from
the SAME `TurnStateTracker` instance.

## 1. Evidence

- `.factory/evidence/ACT-CLINEMM-RUNTIME-TASK-HEADER-PROJECTION-COHERENCE-REPAIR01-CORRECTION02/entry-freeze.txt`
- `.factory/evidence/ACT-CLINEMM-RUNTIME-TASK-HEADER-PROJECTION-COHERENCE-REPAIR01-CORRECTION02/source-seam-trace.md`
- `.factory/evidence/ACT-CLINEMM-RUNTIME-TASK-HEADER-PROJECTION-COHERENCE-REPAIR01-CORRECTION02/final-report.md`

## 2. Files changed

```text
M apps/vscode/src/sdk/SdkController.ts
M apps/vscode/src/sdk/task-state-shadow-arbiter-mapper.ts
M apps/vscode/src/sdk/task-state-shadow-coordinator.ts
M apps/vscode/src/sdk/task-state-shadow-host-wiring.ts
M apps/vscode/src/sdk/task-state-shadow.ts
M apps/vscode/src/sdk/__tests__/task-header-projection-coherence-repair01.tcr01.test.ts
```

See `final-report.md` §2 for the full line counts and section
pointers.

## 3. RED → GREEN (same-domain proof)

| Test                                  | Pre-repair | Post-repair |
| ------------------------------------- | ---------- | ----------- |
| THCP11_C02_RED                        | FAIL (LIVE)| PASS        |
| THCP11_C02_RED_INVERSE                | FAIL (LIVE)| PASS        |
| THCP11_C02_RED_FRESH_SHADOW_PRESERVED | PASS       | PASS        |
| THCP11_C02_THINKING_RED               | FAIL (LIVE)| PASS        |
| Conservation T1..T14                  | n/a        | PASS        |

All 18 tests pass post-CORRECTION02. RED tests assert the
same-domain identity:

```ts
expect(fx.comparator.debugLastObservedTurnSeq()).toBe(seqAtFirstSet) // same-domain equality
expect(publicationShadowStamp).toBeLessThan(publicationSeq)            // same-domain ordering
```

## 4. Ablation necessity proof

Disabling the staleness gate (`isShadowStale = false`) on either
selector makes 6 of 18 tests FAIL — proving the gate is
**necessary**, not redundant with the selector's branch logic.

## 5. Conservation

84 tests PASS across all directly-related suites (THCP01 18,
E7.1 14, wiring 11, arbiter-mapper 6, shadow-coordinator 6,
THCP11 6, TCCC01 5, CLTCC01 5, REPAIR01 18).

## 6. Typecheck

```text
$ bunx tsc --noEmit
(exit code 0; 0 errors)
```

## 7. Lane state after closure

- `Idle / task progression` row → **REPAIRED /
  REPAIR01_COMMITTED_CORRECTION02**. Lane CLOSED unless a fresh
  specimen re-opens it.
- R5 manual approval → **WATCH_ONLY** (`R5_NEXT_TRIGGER =
  fully-authorized all-inside unexpected ASK`).
- R0 execution-obligation → CLOSED (unchanged).
- Multi-element path cardinality → CLOSED (unchanged).
- REPAIR01 (`c1c357ccf`) → superseded by CORRECTION02; both
  commits remain in the tree for audit.
- `ACT-CLINEMM-RUNTIME-TASK-HEADER-PROJECTION-FORENSICS01` →
  preserved as historical evidence; mechanism dropped per REPAIR01
  entry-fact 8; not re-executed.

## 8. STOP conditions not triggered

- `HALT_UNEXPECTED_TRACKED_DIRT`: not triggered.
- `HALT_RED_NOT_REPRODUCED`: not triggered (RED drives real seam).
- `HALT_CAUSAL_DISCRIMINATOR_FAILED`: not triggered (CASE_D
  locked; same-domain repair removes RED; ablation confirms
  necessity).
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
- No repair without RED reproduction. ✓
- No recursive review after GREEN. ✓
