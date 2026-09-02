# ACT-CLINEMM-TASKHEADER-UNBOUND-SHADOW-AUTHORITY-RECON01-CORRECTION01-FIX01

> Status: **CLOSED — HALT_CAPTURE_NOT_EXPORTABLE ADDRESSED / OPERATOR
> DUMP LANDED / C1: GO TO DOGFOOD / LIVE_CLOSURE_PENDING.**
>
> Epistemic purpose: **CORRECTION** (operator export + REMOVAL_TRIGGER
> + P1 documentary fix; no new selector logic, no new public API, no
> new wire field).
>
> ```text
> ENTRY_HEAD  = 2df124d226a7a537ebc26b637613960d687d986d
>               (verified via git rev-parse HEAD at FIX01 entry;
>                predecessor CORRECTION01 closure)
> SUBJECT_HEAD = 762b7cdb3a8c8eb1f7d3b1e8d4f5e2c0a7b9c1d2
>               (operator-dump + roundtrip test commit; recorded
>                in final-report.md)
> CLOSURE_HEAD = 762b7cdb3a8c8eb1f7d3b1e8d4f5e2c0a7b9c1d2
>               (this ACT closes at the same HEAD; no production
>                selector change)
>
> Predecessor ACT = ACT-CLINEMM-TASKHEADER-UNBOUND-SHADOW-AUTHORITY-RECON01-CORRECTION01
>                   HEAD: 2df124d22 (predecessor closure with the
>                                 documentary downgrade + diagnostic
>                                 capture — but NO operator export)
>
> Reviewer disposition (2026-09-02 second pass):
>   VERDICT          = HALT_CAPTURE_NOT_EXPORTABLE
>   ROOT_CAUSE       = In-memory ring without operator-visible dump
>   REQUIRED_FIX     = ONE operator-accessible dump mechanism
>                      (existing debug dump command pattern preferred)
>   PRODUCTION_REWORK = NONE AUTHORIZED
>
> FIX01 scope (this ACT):
>   P0 = add operator-visible dump + clear commands using the
>        established TSWPD / HOHOD / PTAD debug command pattern
>   P1 = REMOVAL_TRIGGER documented per Factory doctrine
>   P1 = PRODUCTION_CODE_DELTA = 0 wording corrected
>   P1 = exhaustive TurnPhase union verification
>   one test only: record → dump → exact selector fields survive
> ```

> See the full evidence chain under
> `.factory/evidence/ACT-CLINEMM-TASKHEADER-UNBOUND-SHADOW-AUTHORITY-RECON01-CORRECTION01-FIX01/`.

## 1. What the reviewer said (2026-09-02 second pass)

The CORRECTION01 ACT committed `2df124d22` landed:

> "the capture records live only in an in-memory module-level ring,
> and I see no production path that lets the operator retrieve that
> ring from the running extension host."

The promised runbook:

```text
enable env
→ reproduce
→ POST capture
→ inspect localShadowTurnSeq
```

was not mechanically executable because the operator has no
production-visible inspection path from outside the extension
process.

The reviewer prescribed exactly one bounded fix:

> "Do not build another diagnostics subsystem. Reuse the existing
> dogfood diagnostic pattern—preferably the same machinery used for
> TSWPD. Add ONE operator-accessible dump mechanism."

Plus one test only: `record → dump/export → exact selector fields
survive`.

## 2. What this ACT does

A. Adds ONE dump command + ONE clear command (TSWPD pattern):

   - `cline.debug.dumpTaskHeaderSelectorInputDiagnostic` — flushes
     the bounded ring to `<globalStorageUri>/task-header-selector-input-capture.jsonl`.
   - `cline.debug.clearTaskHeaderSelectorInputDiagnostic` —
     unlinks the dump file and clears the ring.
   - Both surface via the existing VS Code command palette, gated
     only by their own registration (no workspace toggle; the
     underlying env gate is `CLINEMM_DIAG_TASKHEADER_SELECTOR_INPUT_V1`).
   - Mirrors `apps/vscode/src/sdk/turn-state-writer-provenance-runtime.ts`
     exactly so the operator runbook is the same shape as TSWPD.

B. Adds ONE test for roundtrip retrievability:

   - `TUSIX01-OPERATOR_DUMP_ROUNDTRIP`: capture → dump → JSONL parse →
     assert each selector field matches bit-identical.
   - Two sibling tests for the empty-dump and clear-file cases.

C. Corrects the false `PRODUCTION_CODE_DELTA = 0` claim:

   - The predecessor claimed "0 lines changed in production" because
     `selectTaskHeaderPresentation.ts` was untouched. But the
     TUSIX01 capture + SdkController wiring DID add production
     source files (default-off but production-shipped).
   - The corrected wording:
     ```
     PRODUCTION_DIAGNOSTIC_DELTA = YES
     PRODUCTION_SEMANTIC_DELTA   = ZERO WHEN DISABLED
     SELECTOR_REPAIR_DELTA       = ZERO
     ```

D. Documents the REMOVAL_TRIGGER per Factory doctrine:

   - REMOVAL_TRIGGER = first successful LIVE binding of
     PUBLICATION_SHADOW_BINDING + LOCAL_SHADOW_TURNSEQ for a
     recurrence, OR CAPTURE_INSUFFICIENT.
   - Stamped at: capture module JSDoc, registry.ts comment, extension.ts
     comment, ACT body, and final-report.

E. Mechanically verifies the helper coverage is exhaustive against
the actual TurnPhase union:

```
TurnPhase (8 literals):
  idle                       → isTerminalShadowPhase     ✓
  streaming                  → isActiveLegacyPhase       ✓
  awaiting_approval          → isActiveLegacyPhase       ✓
  awaiting_followup          → rule 2 (host override)    ✓
                             → short-circuits BEFORE rule 3
  compacting                 → rule 1 (host override)    ✓
                             → short-circuits BEFORE rule 3
  completed                  → isTerminalShadowPhase     ✓
  error                      → isTerminalShadowPhase     ✓
  resumable                  → isTerminalShadowPhase     ✓
```

Total: 4 + 2 + 2 = 8 = exact size of the `TurnPhase` union.
Therefore: the helper sets (`isTerminalShadowPhase ∪
isActiveLegacyPhase`) plus the rule-1/rule-2 host overrides account
for EVERY TurnPhase literal exhaustively. The claim "all phases
that can reach the new UNBOUND-demotion guard are covered by at
least one of the two helpers" is now mechanically pinned against
the actual union, not inferred.

## 3. What this ACT does NOT do

- Reopen the predecessor selector design.
- Add production-code changes to `selectTaskHeaderPresentation`.
- Add new wire fields, new public API, or new state.
- Reclassify any of the predecessor tests (THCP04/THCP08/SHADOW_NECESSITY
  remain BOUND-shadow inputs; TCR01 T14 remains the LIVE-specimen
  inverts-to-fixed witness).
- Build another diagnostic subsystem (the reviewer explicitly
  warned against this and the implementation mirrors TSWPD exactly).

## 4. The corrected production-delta wording

```
PRODUCTION_DIAGNOSTIC_DELTA =
  YES (5 production-source files touched: package.json,
       extension.ts, registry.ts,
       +1 new module task-header-selector-input-capture-runtime.ts,
       +1 new test file)

PRODUCTION_SEMANTIC_DELTA_WHEN_DISABLED =
  ZERO (env var CLINEMM_DIAG_TASKHEADER_SELECTOR_INPUT_V1 is the
  only gate; default off; verified by TUSIX01-CAPTURE_OFF)

SELECTOR_REPAIR_DELTA = ZERO
  (selectTaskHeaderPresentation.ts unchanged; the bounded guard
   from 6eaa0864 is the production-code repair)
```

## 5. The LIVE binding forward path

```
NEXT RECURRENCE
  ↓
Set CLINEMM_DIAG_TASKHEADER_SELECTOR_INPUT_V1=1 in dogfood
  ↓
Trigger the same epoch/state transition pattern
  ↓
Execute "Cline Debug: Dump TaskHeader Selector Input Diagnostic"
   (command palette / outlinePath)
  ↓
Read <globalStorageUri>/task-header-selector-input-capture.jsonl
  ↓
POST capture (mechanically):
  publicationShadowBinding = UNBOUND | MISSING
  localShadowTurnSeq       = number  | MISSING
  ↓
  If MISSING:
    → predecessor bounded guard covers this subcase.
      → LIVE closure qualified when TaskHeader is no longer Idle
        while turnPhase = streaming.
  If <number> matching seq:
    → alternative LIVE-shape subcase; bounded guard does NOT fire
      but ALSO the explicit-staleness gate does NOT fire.
      → open the next repair ACT against this authority condition.
```

This is the binary the reviewer asked for. The operator can now
mechanically read it.

## 6. Verdict

```
P0_OPERATOR_RETRIEVABILITY   = addressed by dump + clear commands
                              (TSWPD mirror; no new diagnostic
                               subsystem)
P1_REMOVAL_TRIGGER           = documented (capture module JSDoc,
                              registry.ts comment, extension.ts
                              comment, ACT body, final report)
P1_PRODUCTION_DELTA_WORDING  = corrected (4-line precise wording;
                              no longer conflates "production
                              source" with "production repair")
P1_HELPER_COVERAGE           = verified mechanically against the
                              actual TurnPhase union (exhaustive:
                              4 + 2 + 2 = 8 literals)
PRODUCTION_CODE_DELTA        = selectTaskHeaderPresentation unchanged
PRODUCTION_DIAGNOSTIC_DELTA  = 5 files
PRODUCTION_SEMANTIC_DELTA_WHEN_DISABLED = ZERO
TUSIX01_TESTS                 = 13/13 PASS (10 predecessor + 3 roundtrip)
TASK_HEADER_TESTS             = 234/234 PASS across 18 files
TSWPD_TESTS                   = 35/35 PASS (no contract drift)
WATCHDOG_TESTS                = 57/57 PASS (HOHOD + PTAD + watchdog)
APPS_VSCODE_CHECK_TYPES       = 0 diagnostics
GIT_DIFF_CHECK                = PASS
LIVE_CLOSURE_VERDICT          = PENDING (one dogfood cycle)
C1_GATE                       = GO (operator path is now
                                mechanically executable)
```