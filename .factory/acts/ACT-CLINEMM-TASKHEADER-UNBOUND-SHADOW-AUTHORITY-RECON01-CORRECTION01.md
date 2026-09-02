# ACT-CLINEMM-TASKHEADER-UNBOUND-SHADOW-AUTHORITY-RECON01-CORRECTION01

> Status: **OPEN — HALT_LIVE_BINDING_NOT_PROVEN / CORRECTION01_AUTHORIZED /
> BOUNDED_COMPLETION_LANDED / LIVE_CLOSURE_PENDING**.
>
> Epistemic purpose: **CORRECTION** (reviewer disposition follow-up;
> not a re-design; no production-code change to the predecessor repair
> at 6eaa0864).
>
> ```text
> ENTRY_HEAD                  = 0d8130c137fe9a922834650b1cc14a2358389533
>                              (verified via git rev-parse HEAD at CORRECTION01 entry)
> SUBJECT_HEAD                = <this-commit> (recorded in final-report.md)
> CLOSURE_HEAD                = <this-commit> (no production-code delta)
>                              (this ACT closes at the same HEAD as the
>                              bounded-completion capture commit)
>
> Predecessor ACT             = ACT-CLINEMM-TASKHEADER-UNBOUND-SHADOW-AUTHORITY-RECON01
>                              HEAD: 6eaa0864 (production-source repair)
>                                    0d8130c1 (final HEAD with board update)
>
> Reviewer disposition (2026-09-02):
>   VERDICT            = HALT_LIVE_BINDING_NOT_PROVEN
>   ROOT_CAUSE         = ROOT_CAUSE_ISOLATED_FOR_GENERIC_SUBCASE
>   ROOT_CAUSE_LIVE    = ROOT_CAUSE_FOR_SPECIFIC_LIVE_SPECIMEN = NOT FULLY BOUND
>   FRESH_POST_REPAIR  = REQUIRED FOR LIVE CLOSURE
>   PRODUCTION_REWORK  = NONE AUTHORIZED
>
> CORRECTION01 scope (this ACT):
>   P0  = address the LIVE-binding causal gap
>         (bounded diagnostic capture, NOT a production-code rework)
>   P1  = rename UNBOUND to PUBLICATION_SHADOW_BINDING vs LOCAL_SHADOW_TURNSEQ
>   P1  = verify isActiveLegacyPhase / isTerminalShadowPhase coverage
>   P2  = add CLOSURE_HEAD to the final report
>
> No production-code change to selectTaskHeaderPresentation.
> ```

> See the full evidence chain under
> `.factory/evidence/ACT-CLINEMM-TASKHEADER-UNBOUND-SHADOW-AUTHORITY-RECON01-CORRECTION01/`.

## 1. What the reviewer said (2026-09-02)

The predecessor ACT body closed with:

> "Closes the LIVE recurrence for taskId `1788292664979_9qbpd`."

The reviewer disposition (HALT_LIVE_BINDING_NOT_PROVEN) identified a P0
causal gap that makes this closure claim overclaim:

> "`shadowPublicationBinding='UNBOUND'` is not the same fact as
> `canonicalShadowObservedTurnSeq === undefined`."

The diagnostic wire classification and the selector-local input are
INDEPENDENT facts that happen to co-occur in many cases but not all.
The bounded guard at 6eaa0864 inspects only the selector-local input,
so an alternative LIVE-shape subcase (shadow's last `idle` observation
stamped at the matching `seq`) would NOT fire the guard but also would
NOT fire the REPAIR01-CORRECTION02 explicit-staleness gate — leaving
the LIVE defect unfixed by this specific commit.

The reviewer's disposition does NOT reject the repair. It asks for:

1. A bounded LIVE-binding/qualification cycle (one post-repair
   dogfood capture to bind the selector-input to the LIVE specimen)
2. Documentary disambiguation (rename UNBOUND to distinguish
   publication-binding from local-phase-stamp)
3. A verification note for the helper coverage

## 2. What this ACT does

A. **Adds a bounded diagnostic capture** (no production-code change to
   the selector):

   - New module: `apps/vscode/src/sdk/task-header-selector-input-capture.ts`
   - New test: `apps/vscode/src/sdk/__tests__/task-header-selector-input-capture.tusix01.test.ts`
   - Wired into `SdkController.getStateToPostToWebview()` at the same
     emission point as `activity.publication.v1`.
   - Gated by `CLINEMM_DIAG_TASKHEADER_SELECTOR_INPUT_V1=<truthy>`;
     default-off. No state-semantic delta in the default build.

B. **Renames the documentary UNBOUND ambiguity** (in the new capture
   module + test + ACT body):

   - `PUBLICATION_SHADOW_BINDING = UNBOUND | MISSING`  (diagnostic wire)
   - `LOCAL_SHADOW_TURNSEQ = number | MISSING`         (selector-local input)

C. **Documents `isActiveLegacyPhase` / `isTerminalShadowPhase`
   coverage**:

   - `isActiveLegacyPhase` covers `{streaming, awaiting_approval}`.
   - `isTerminalShadowPhase` covers `{idle, completed, error, resumable}`.
   - Phases NOT covered: `{compacting, awaiting_followup}`. Both are
     handled by selector rules 1 and 2 (host overrides) BEFORE rule 3,
     so they cannot reach the new UNBOUND-demotion guard. The helper
     set is therefore exhaustive for the LIVE-shape scope.

D. **Downgrades the closure verdict** in the predecessor ACT body
   and evidence directory.

E. **Adds `CLOSURE_HEAD`** to the final report (was previously
   conflated with `SUBJECT_HEAD`).

## 3. What this ACT does NOT do

- Reopen the predecessor selector design.
- Add production-code changes to `selectTaskHeaderPresentation`.
- Add new wire fields, new public API, or new state.
- Reclassify any of the predecessor tests (THCP04/THCP08/SHADOW_NECESSITY
  remain BOUND-shadow inputs; TCR01 T14 remains the LIVE-specimen
  inverts-to-fixed witness).

## 4. The bounded diagnostic capture

The new module records, per ExtensionState publication, the FOUR
selector-input fields the bounded guard inspects PLUS the post-selection
phase/source:

```
TaskHeaderSelectorInputRecord {
  stateVersion              : number
  publicationShadowBinding  : "MISSING" | "UNBOUND"
  canonicalShadowPhase      : TurnPhase | undefined
  localShadowTurnSeq        : number   | undefined
  currentLegacyPhase        : TurnPhase
  seq                       : number
  selectedPhase             : TurnPhase
  selectedSource            : "host" | "shadow" | "legacy"
  capturedAt                : number
}
```

The two previously-conflated fields are now mechanically distinguished:
a record can carry `publicationShadowBinding: "UNBOUND"` AND
`localShadowTurnSeq: <number>` simultaneously. This is the P0 gap
mechanically pinned.

## 5. The LIVE binding path forward

With this CORRECTION01 landed, the next recurrence is bound by
mechanical capture rather than inference:

```
NEXT RECURRENCE
  ↓
Set CLINEMM_DIAG_TASKHEADER_SELECTOR_INPUT_V1=1 in dogfood
  ↓
Trigger the same epoch/state transition pattern
  ↓
POST capture:
  publicationShadowBinding = UNBOUND
  localShadowTurnSeq       = ??? (the actual selector-input)
  ↓
If localShadowTurnSeq === undefined:
  → predecessor bounded guard covers this subcase.
If localShadowTurnSeq === <number>:
  → alternative subcase: bounded guard does NOT fire.
    A second guarded subcase may be required, OR the shadow's
    phase-keyed observation stamp itself needs review.
```

This is the LIVE-binding cycle the reviewer requested.

## 6. Verdict

```
P0 LIVE_BINDING_GAP            = addressed by bounded diagnostic capture
                                 (no production-code rework per
                                 reviewer directive)
P1 DOCUMENTARY_AMBIGUITY       = addressed by UNBOUND -> PUBLICATION_SHADOW_BINDING
                                 vs LOCAL_SHADOW_TURNSEQ rename
P1 HELPER_COVERAGE             = verified (see entry-freeze.txt)
P2 CLOSURE_HEAD                = added to final report
PRODUCTION_CODE_DELTA          = 0 lines (no change to selectTaskHeaderPresentation)
NEW_DIAGNOSTIC_FILE            = 1 (task-header-selector-input-capture.ts)
NEW_TEST_FILE                  = 1 (task-header-selector-input-capture.tusix01.test.ts)
WIRING_CHANGE                  = 1 (SdkController.getStateToPostToWebview()
                                     +28 lines for the capture call)
GITIGNORE_WHITELIST            = +21 lines (the ACT body + evidence dir
                                      and the new module/test)
LIVE_CLOSURE_VERDICT           = PENDING (one bounded dogfood cycle)
                                 = this ACT does NOT close the LIVE
                                   recurrence; it equips the next
                                   recurrence to be mechanically bound
PRODUCTION_DELTA               = 0 (the capture is opt-in + read-only)
TESTS_DELTA                    = +10 (all PASS)
APPS_VSCODE_CHECK_TYPES        = 0 diagnostics
GIT_DIFF_CHECK                 = PASS
```
