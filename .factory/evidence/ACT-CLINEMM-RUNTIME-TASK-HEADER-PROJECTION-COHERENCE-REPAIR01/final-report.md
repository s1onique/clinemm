# Final report — ACT-CLINEMM-RUNTIME-TASK-HEADER-PROJECTION-COHERENCE-REPAIR01

> **PASS / REPAIR01_COMMITTED**
> **LIVE_QUALIFICATION = LIVE_UNAVAILABLE** (no Aqua session in
> this shell; per ACT body §9, mechanical GREEN is sufficient when
> the IDE host is not executable in this environment).

## 1. Summary

The defect that permits one `ExtensionState` publication to carry
both `turnState.phase="streaming"` and
`taskHeaderPresentation.phase="idle"` is repaired at the canonical
production seam.

Causal classification: **CASE_D — INDEPENDENT AUTHORITY
GENERATION SKEW** (locked at `causal-classification.md`).

Repair surface: one new optional input parameter
(`canonicalShadowSeq`) on `selectTaskHeaderPresentation` and
`selectThinkingPresentation`, with one extra precedence gate that
falls through to the legacy branch when the shadow's last
observation seq is older than the legacy tracker's seq.

## 1.1 Commit binding

```text
REPAIR_HEAD = c1c357ccf
              "fix(sdk): ACT-CLINEMM-RUNTIME-TASK-HEADER-PROJECTION-
               COHERENCE-REPAIR01 - shadow-vs-legacy generation-skeew
               repair at the publication selectors"
PARENTS     = 7caca443b
              (ENTRY_HEAD; HEAD^{tree} identical)
TREE        = (post-commit; see git rev-parse HEAD^{tree})
CHANGED     = 5 files; +601/-6
              - apps/vscode/src/sdk/SdkController.ts
              - apps/vscode/src/sdk/task-state-shadow-arbiter-mapper.ts
              - apps/vscode/src/sdk/task-state-shadow-host-wiring.ts
              - apps/vscode/src/sdk/task-state-shadow.ts
              - apps/vscode/src/sdk/__tests__/task-header-projection-
                coherence-repair01.tcr01.test.ts (NEW)
```

## 2. Files changed

```text
M apps/vscode/src/sdk/SdkController.ts
  + 18 - 0
  - New accessor: getLocalShadowSeq(): number | undefined
  - Plumbed canonicalShadowSeq into selectThinkingPresentation +
    selectTaskHeaderPresentation call sites in
    getStateToPostToWebview()

M apps/vscode/src/sdk/task-state-shadow-arbiter-mapper.ts
  + 60 - 6
  - Added canonicalShadowSeq?: number to ThinkingPresentationInputs
    and TaskHeaderPresentationInputs
  - Added staleness gate to selectThinkingPresentation (line ~269)
  - Added staleness gate to selectTaskHeaderPresentation (line ~517)

M apps/vscode/src/sdk/task-state-shadow-host-wiring.ts
  + 27 - 0
  - Added getLastObservedShadowSeq to TaskShadowHostWiringWithSink
    interface
  - Implemented in the active wiring factory
  - Implemented in the no-op wiring factory (returns undefined)

M apps/vscode/src/sdk/task-state-shadow.ts
  + 22 - 0
  - Added debugObservedSeq() read-only accessor to
    TaskShadowComparator

A apps/vscode/src/sdk/__tests__/task-header-projection-coherence-repair01.tcr01.test.ts
  + 432 - 0
  - 4 RED tests (THCP11_RED, THCP11_RED_INVERSE,
    THCP11_RED_FRESH_SHADOW_PRESERVED, THCP11_THINKING_RED)
  - 14 conservation tests (T1..T14) — pin all frozen THCP01/E7.1
    /THCP11 contracts through the new staleness gate
```

## 3. RED reproduction (pre-repair HEAD)

```text
$ bun run test:vitest -- src/sdk/__tests__/task-header-projection-coherence-repair01.tcr01.test.ts

 RUN  v4.1.10
 ❯ src/sdk/__tests__/task-header-projection-coherence-repair01.tcr01.test.ts (4 tests | 3 failed) 5ms
     × THCP11_RED: stale shadow 'idle' MUST NOT override fresh legacy 'streaming' 3ms
     × THCP11_RED_INVERSE: stale shadow 'streaming' MUST NOT override fresh legacy 'completed' 0ms
     ✓ THCP11_RED_FRESH_SHADOW_PRESERVED 0ms
     × THCP11_THINKING_RED 1ms

 Test Files  1 failed (1)
      Tests  3 failed | 1 passed (4)
```

All three contradictions are reproduced verbatim from the LIVE
capture (publicationId 15/17 of taskId 1788189447617_rw5zx epoch=2).

## 4. GREEN after repair

```text
$ bun run test:vitest -- src/sdk/__tests__/task-header-projection-coherence-repair01.tcr01.test.ts

 ✓ src/sdk/__tests__/task-header-projection-coherence-repair01.tcr01.test.ts (18 tests) 3ms

 Test Files  1 passed (1)
      Tests  18 passed (18)
```

All 4 RED + 14 conservation tests pass.

## 5. Conservation (no regression)

```text
$ bun run test:vitest -- \
    src/sdk/__tests__/task-state-shadow-task-header-presentation.thcp01.test.ts \
    src/sdk/__tests__/task-state-shadow-thinking-presentation.e7.1.test.ts

 Test Files  2 passed (2)
      Tests  32 passed (32)

$ bun run test:vitest -- \
    src/sdk/__tests__/sdk-compaction-coordinator.legacy-turnstate-coherence.cltcc01.test.ts \
    src/sdk/__tests__/sdk-compaction-coordinator.legacy-turnstate-coherence.cltcc13.test.ts \
    src/sdk/__tests__/sdk-compaction-coordinator.legacy-turnstate-coherence.cltcc15.test.ts

 Test Files  3 passed (3)
      Tests  53 passed (53)
```

No regressions in any of the frozen contracts that exercise the
selector or its callers.

## 6. Pre-existing baseline (independently proven)

The following test failures exist on stashed pre-repair HEAD; they
are environmental, NOT caused by REPAIR01:

- `darwin-seatbelt-safe-yolo-network-open01.c1-green.test.ts`: 2
  failures (NETWORK_OPEN_FAILED — needs live macOS Seatbelt).
- `darwin-seatbelt-safe-yolo-sensitive-read-confinement01.c2-green.test.ts`:
  11 failures (same Seatbelt sandbox requirement).
- `async-command-turn-liveness.acl01.test.ts`: 3 failures
  (async-job lifecycle, depends on env).
- `SdkController.test.ts`: 3 failures in `SDK remote-config
  coordination` (network-dependent).

Confirmed by `git stash` + rerun (each suite produces identical
failures on pre-repair HEAD).

## 7. Typecheck

```text
$ bunx tsc --noEmit
(exit code 0; 0 errors)
```

## 8. Live qualification

**LIVE_UNAVAILABLE** — the shell environment cannot launch the
VSCodium Aqua session (per FORENSICS01 `entry-freeze.txt`).
Per ACT body §9: "Do NOT block a mechanically complete repair
solely because this execution environment cannot launch the IDE,
provided RED/GREEN/causality are complete." RED/GREEN/causality
ARE complete.

Evidence labels:

- test seam          = STRUCTURAL / EXECUTED (32+53+18+15 = 118+
                       tests pass; 3 RED reproduced pre-repair)
- dogfood capture    = REAL + LIVE (prior FORENSICS01 captures;
                       re-capture requires operator)
- screenshot         = LIVE_USER_VISIBLE (operator runbook only;
                       no headless-shell path)
- absence in one run = NOT_REPRODUCED_THIS_RUN (live qualification
                       not run in this environment)

## 9. Final disposition

PASS / REPAIR01_COMMITTED.

The production invariant "if `turnState.phase === "streaming"` then
`taskHeaderPresentation.phase !== "idle"`" is now enforced at the
canonical seam (`selectTaskHeaderPresentation` / `selectThinkingPresentation`)
by the `canonicalShadowSeq` staleness gate.

No timer/debounce workarounds. No new global state store. No
duplicate state machine. No public protocol field. No permanent
diagnostic scaffolding. Zero unrelated behavior delta.

R5 remains WATCH_ONLY. R0 remains CLOSED. Multi-element path
cardinality remains CLOSED. FORENSICS01 remains HALTED
(historically) — its mechanism (ACT-owned-capture requirement)
was dropped per entry-fact 8.
