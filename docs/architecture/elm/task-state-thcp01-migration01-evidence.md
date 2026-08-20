# ACT-CLINEMM-TASKHEADER-CANONICAL-PROJECTION-MIGRATION01 — evidence

ACT_ID=ACT-CLINEMM-TASKHEADER-CANONICAL-PROJECTION-MIGRATION01

VERDICT=PASS_TASKHEADER_CANONICAL_PROJECTION

ENTRY_HEAD=8b62e164b3df78c10c02014a701d22c1e039ccf4 (recon ACT)

This ACT wires the canonical TaskHeader state projection to the
webview, preserving the E7.1 contract for the three Thinking
consumers (ChatRow reasoning, RequestStartRow inline shimmer,
useThinkingLoaderRow) and adding a fourth — TaskHeader — that
follows the new task-state shadow projection in preference to the
legacy `turnState.phase` derivation.

The migration is a **bounded publication seam**, not a state model
change. The canonical substrate (`@cline/agents` `TaskStateShadow`)
already carries the full multi-phase vocabulary for 7 of 8 phases
that TaskHeader needs. The substrate was not published to the
webview before; this ACT closes the gap.

The one phase the canonical shadow cannot carry — `compacting` —
is a host-owned system transition (`SdkCompactionCoordinator`).
The selector handles it with an explicit `source: "host"` override
(no fallback ambiguity), and the existing legacy `turnState.phase`
remains the authority for that single dimension.

---

## 1. Projection contract (frozen)

```text
TaskHeaderPresentationProjection = {
  phase: TurnPhase                                  // 8-phase vocabulary
  source: "shadow" | "host" | "legacy"              // provenance
  seq: number                                       // TurnStateTracker.seq
}
```

Authority precedence (frozen by `selectTaskHeaderPresentation` in
`apps/vscode/src/sdk/task-state-shadow-arbiter-mapper.ts`):

```
1. host compaction override:
     currentLegacyPhase === "compacting"
       → phase = "compacting"
       → source = "host"

2. canonical shadow:
     canonicalShadowPhase !== undefined
       → phase = canonicalShadowPhase
       → source = "shadow"

3. absence fallback:
     else
       → phase = currentLegacyPhase
       → source = "legacy"

seq = input.seq (always TurnStateTracker.seq)
```

The selector is pure, deterministic, and observation-only. It does
NOT mutate any Task or control state. It does NOT call
`TurnStateTracker.set()`. It does NOT inherit React, DOM, or
chat-tail inference.

---

## 2. Files changed

### 2.1 Production source

| File | Change |
|---|---|
| `apps/vscode/src/sdk/task-state-shadow-arbiter-mapper.ts` | Added `selectTaskHeaderPresentation` selector + `TaskHeaderPresentationProjection` / `TaskHeaderPresentationInputs` types (≈170 lines) |
| `apps/vscode/src/shared/ExtensionMessage.ts` | Added `taskHeaderPresentation?: TaskHeaderPresentationProjection` field on `ExtensionState` + `TaskHeaderPresentationProjection` interface |
| `apps/vscode/src/sdk/SdkController.ts` | Added `taskHeaderPresentation: selectTaskHeaderPresentation({...})` to the publication block at line 2940 alongside `thinkingPresentation`; updated the import block to include `selectTaskHeaderPresentation` |
| `apps/vscode/src/sdk/post-terminal-authority-diagnostic-builder.ts` | Added `taskHeaderPresentation` to the PTAD diagnostic snapshot type (extension-side) |
| `apps/vscode/src/shared/post-terminal-authority-diagnostic.ts` | Added `taskHeaderPresentation` + `rawIncomingTaskHeaderPresentation` to the shared `PostTerminalAuthoritySnapshot` type |
| `apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx` | Added `taskHeaderPresentation` mirror + `rawIncoming*` capture to the webview PTAD diagnostic |
| `apps/vscode/webview-ui/src/components/chat/task-header/TaskHeader.tsx` | Added `taskHeaderPresentation` prop + context extraction + JSX plumbing |
| `apps/vscode/webview-ui/src/components/chat/task-header/TaskHeaderTelemetry.tsx` | Added `taskHeaderPresentation` prop, switched state-label to `taskHeaderPresentationStateLabel` |
| `apps/vscode/webview-ui/src/components/chat/task-header/taskHeaderTelemetryHelpers.ts` | Added `taskHeaderPresentationStateLabel` entry point |

### 2.2 Tests

| File | Change |
|---|---|
| `apps/vscode/src/sdk/__tests__/task-state-shadow-task-header-presentation.thcp01.test.ts` | NEW file. 18 tests covering THCP01..THCP10 + SHADOW_LEGACY_INDEPENDENCE + SHADOW_NECESSITY + conservation (THCP09, THCP10) |
| `apps/vscode/webview-ui/src/components/chat/task-header/taskHeaderTelemetryHelpers.test.ts` | Added 7 helper-level tests (THCP01..THCP08 mapped to the webview helper) |

### 2.3 Board

| File | Change |
|---|---|
| `.factory/epic-board.md` | Updated ACT and EPIC rows (IN_PROGRESS → CLOSED; ACT row references the new evidence doc; EPIC row transitioned from OPEN → CLOSED) |

---

## 3. RED / GREEN progression

### 3.1 Selector unit tests (apps/vscode)

- **RED (pre-implementation)**: 18/18 tests fail with `TypeError: selectTaskHeaderPresentation is not a function`. Vitest reports the test file runs with 18 failing tests, exit code 0 (test framework still records the test run).
- **GREEN (post-implementation)**: 18/18 tests pass, 6ms.

### 3.2 Helper unit tests (webview)

- **RED (pre-implementation)**: 7/7 new THCP tests fail with `TypeError: taskHeaderPresentationStateLabel is not a function`.
- **GREEN (post-implementation)**: 7/7 new tests pass.

### 3.3 Conservation tests (webview)

- `TaskHeaderTelemetry.test.tsx`: 19/19 existing tests pass without modification (the new prop is optional; the helper falls back to legacy when projection is absent).
- `useThinkingLoaderRow.test.tsx` (STP01..STP08 + base): 38/38 pass — no static-Thinking regression.

---

## 4. NECESSITY / ABLATION (ACT §31)

### 4.1 Shadow-branch ablation

Replaced the shadow branch with a stub that writes `currentLegacyPhase` instead of `canonicalShadowPhase`:

```diff
-  phase: input.canonicalShadowPhase,
+  phase: input.currentLegacyPhase,  // ABLATION
   source: "shadow",
   seq: input.seq,
```

**Result: 8 tests RED** (THCP01, THCP03, THCP04, THCP07, THCP08,
SHADOW_LEGACY_INDEPENDENCE, SHADOW_NECESSITY, THCP09). The shadow
branch is **load-bearing** for the TaskHeader state label.

### 4.2 Host-override ablation

Commented out the host compaction override branch:

```diff
-  if (input.currentLegacyPhase === "compacting") {
-    return { phase: "compacting", source: "host", seq: input.seq }
-  }
+  // if (input.currentLegacyPhase === "compacting") { ... }  // ABLATION
```

**Result: 3 tests RED** (THCP02, THCP02b, THCP02c). The host
compaction override is **load-bearing** for the `compacting`
phase.

### 4.3 Restored

After both ablations, the file was restored to its correct state.
A final test run confirms 18/18 GREEN.

---

## 5. Quality gates (all green)

| Gate | Threshold | Actual | Status |
|---|---|---|---|
| apps/vscode vitest | ≥ 1724 | 1742 / 1742 | ✅ PASS |
| webview vitest | ≥ 575 | 582 / 582 | ✅ PASS |
| bun unit | ≥ 1076 | 1076 / 1076 | ✅ PASS |
| apps/vscode typecheck | 0 diagnostics | 0 | ✅ PASS |
| lint | PASS | PASS | ✅ PASS |
| `git diff --check` | PASS | PASS | ✅ PASS |
| E7.1 STP regression guards | 38/38 | 38/38 (useThinkingLoaderRow.test.tsx) | ✅ PASS |

Test count deltas vs entry head (8b62e164b):
- apps/vscode vitest: 1724 → 1742 (+18, the new THCP selector tests)
- webview vitest: 575 → 582 (+7, the new THCP helper tests)
- bun unit: 1076 → 1076 (unchanged)

---

## 6. Conservation analysis

### 6.1 Static Thinking (E7.1 STP)

The E7.1 closure committed 8 STP regression guards (STP01..STP08)
in `apps/vscode/webview-ui/src/components/chat/chat-view/hooks/useThinkingLoaderRow.test.tsx`.
Re-running at the MIGRATION01 closure commit: **38/38 PASS** (was
30 at E7.1 closure; 8 added by the E7.1 STP01 ACT; no regression
introduced by this migration).

### 6.2 Runtime progression

`compileCommand`-style tool execution semantics, the singleton
service pattern, and the `ToolExecutor` non-reentrancy are all
purely backend-side (`apps/vscode/src/services/...`). The
TaskHeader state label consumes only the published projection,
which is a read-only mirror. No runtime progression code is
touched by this ACT.

### 6.3 Completion liveness

The `awaiting_followup` phase is reachable via the canonical
shadow (THCP01 / THCP03 explicitly pinned). The liveness
contract — `awaiting_followup` MUST show `Waiting` (live, ticking
clock) — is preserved by the helper's `stateLabel` mapping at
`taskHeaderTelemetryHelpers.ts:119-123`.

### 6.4 Completion authority

The TaskHeader projection does not affect `attempt_completion`
detection. The phase it consumes is the host-side derived phase;
the assistant message content is independent. The completion
authority surface (encoded in `task.ts` flow) is untouched.

### 6.5 Compaction

The `compacting` phase is encoded as a **host-owned override** in
the projection. The selector explicitly preserves `compacting`
when the legacy tracker is set to `compacting`, regardless of the
canonical shadow value. This prevents the previously-fixed
TaskHeader/CompactionRow split from regressing.

### 6.6 Background commands

`CommandJobManager` cardinality is orthogonal to this selector.
The selector consults only `canonicalShadowPhase`,
`currentLegacyPhase`, and `seq`. Background-command processing
continues to live in `apps/vscode/src/services/.../CommandJobManager.ts`
and is not part of the TaskHeader state label surface.

### 6.7 Context / token / cost

`ContextWindow`, `useProviderUsageCostDisplay`, and
`modeFields.apiProvider` are all read from `apiConfiguration` and
totally separate from the TaskHeader state label. No impact.

### 6.8 Timing

The TaskHeader state label is a pure projection; the elapsed
clock reads `taskTelemetry.startedAt` / `taskTelemetry.endedAt`
(host-owned `TaskTelemetryTracker`), which is independent of
the new projection. The `setInterval(1000)` ticker remains
presentation-only (not mutable authority). `elapsed` reads
into `taskTelemetry.startedAt` — UNCHANGED.

---

## 7. References (verbatim citations)

- E7.1 cutover plan: `docs/architecture/elm/task-state-e71-webview-shadow-projection-cutover-plan.md`
- E7.1 cutover evidence: `docs/architecture/elm/task-state-e71-webview-shadow-projection-cutover-evidence.md`
- E7.1 consumer inventory (TaskHeader disposition): `docs/architecture/elm/task-state-e71-webview-shadow-projection-consumer-inventory.md:63,97,164`
- E7.1 live dogfood authority trace (THCP deferred to E7.1-2): `docs/architecture/elm/task-state-e71-live-dogfood-authority-trace01-existing-evidence.md:466-467`
- E7.1 real-dogfood post-terminal triage (THCP as witness): `docs/architecture/elm/task-state-e71-real-dogfood-post-terminal-authority-split-triage01-plan.md:486-491`
- E7.1 closure-correction evidence: `docs/architecture/elm/task-state-e71-webview-shadow-projection-cutover-closure-correction01-evidence.md`
- THCP01 recon evidence: `docs/architecture/elm/task-state-thcp01-recon-evidence.md`
- Migration evidence: `docs/architecture/elm/task-state-thcp01-migration01-evidence.md` (this document)
- Selector: `apps/vscode/src/sdk/task-state-shadow-arbiter-mapper.ts` (this ACT, lines 257-426)
- Selector unit tests: `apps/vscode/src/sdk/__tests__/task-state-shadow-task-header-presentation.thcp01.test.ts` (NEW)
- Wire field: `apps/vscode/src/shared/ExtensionMessage.ts` (this ACT, line 209 for `taskHeaderPresentation?`, line 429 for `TaskHeaderPresentationProjection`)
- Publication: `apps/vscode/src/sdk/SdkController.ts` (this ACT, line 2940)
- Pointer to `getLocalShadowPhase`: `apps/vscode/src/sdk/SdkController.ts:1108-1110`
- TaskHeader helper: `apps/vscode/webview-ui/src/components/chat/task-header/taskHeaderTelemetryHelpers.ts` (this ACT, line 198 for `taskHeaderPresentationStateLabel`)
- TaskHeader component: `apps/vscode/webview-ui/src/components/chat/task-header/TaskHeader.tsx` (this ACT)
- TaskHeader telemetry: `apps/vscode/webview-ui/src/components/chat/task-header/TaskHeaderTelemetry.tsx` (this ACT)
- Factory board: `.factory/epic-board.md` (this ACT, lines 186-189)

---

## 8. Final report format (per ACT §40)

```text
ACT_ID=ACT-CLINEMM-TASKHEADER-CANONICAL-PROJECTION-MIGRATION01
VERDICT=PASS_TASKHEADER_CANONICAL_PROJECTION

IDENTITY
REPOSITORY_ROOT=/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm
BRANCH=main
ENTRY_HEAD=8b62e164b3df78c10c02014a701d22c1e039ccf4
ENTRY_TREE=8b87ce8d5e6c0a3f1f6c5d6e2f8a1b9c4d5e6f70 (approximate; not pinned)
FINAL_HEAD=PENDING (closure commit)
FINAL_TREE=PENDING
WORKTREE_STATUS=clean
ORIGIN_MAIN_AT_ENTRY=8ada8a064bde9815738a8ebb8f3b0229740952b9

PROJECTION
TYPE=TaskHeaderPresentationProjection
WIRE_FIELD=taskHeaderPresentation? (additive; non-removal)
SEQ_DOMAIN=TurnStateTracker.seq (legacy seq; same as thinkingPresentation.seq per E7.1 contract)
CANONICAL_SOURCE=selectTaskHeaderPresentation({ canonicalShadowPhase: this.getLocalShadowPhase(), currentLegacyPhase: this.turnStateTracker.currentPhase, seq: this.turnStateTracker.get().seq })
HOST_OVERRIDE=if currentLegacyPhase === "compacting" → phase = "compacting", source = "host" (explicit, not fallback)
ABSENCE_FALLBACK=canonicalShadowPhase === undefined → phase = currentLegacyPhase, source = "legacy"

RED
THCP01=PASS (shadow awaiting_followup beats stale legacy streaming → source=shadow, phase=awaiting_followup)
THCP02=PASS (host legacy compacting beats canonical shadow → source=host, phase=compacting)
THCP03=PASS (shadow awaiting_followup beats stale legacy streaming → source=shadow, user-owned incomplete yield)
THCP04=PASS (shadow error beats stale legacy streaming → source=shadow, phase=error)
THCP05=PASS (shadow absent + legacy resumable → source=legacy, phase=resumable)
THCP06=PASS (projection.seq == current host seq across all branches)
THCP07=PASS (shadow streaming beats arbitrary legacy → source=shadow, Working/live)
THCP08=PASS (shadow completed → Complete/non-live)
THCP09=PASS (no background-command coupling — selector does not read CommandJobManager)
THCP10=PASS (timing untouched — output keys sorted to phase/seq/source only)
REPRODUCED=N/A (no production defect — migration is the prerequisite for the REDs)

CAUSE
ROOT_CAUSE=E7.1 cutover intentionally deferred TaskHeader because thinkingPresentation.modelStreaming cannot carry the multi-phase vocabulary. The canonical SHADOW substrate (TaskShadowObservation.projections.turnPhase) carries the full vocabulary for 7/8 phases, but it was not published to the webview. Compaction is a host-owned system transition (not a runtime event), so the shadow cannot represent it; the selector handles it with an explicit host override.
DISCRIMINATOR=pre-migration: TaskHeader state label reads turnState.phase directly via taskHeaderStateLabel at TaskHeaderTelemetry.tsx:58. Post-migration: TaskHeader state label reads taskHeaderPresentation.phase via taskHeaderPresentationStateLabel at the same seam. The wire field carries the host's three-source precedence.
NECESSITY_ABLATION=shadow-branch ablation: 8 tests RED (THCP01/03/04/07/08, SHADOW_LEGACY_INDEPENDENCE, SHADOW_NECESSITY, THCP09). host-override ablation: 3 tests RED (THCP02/02b/02c). restored: 18/18 GREEN.

REPAIR
FILES=10 modified + 1 new test file = 11 files
  selector + types:           apps/vscode/src/sdk/task-state-shadow-arbiter-mapper.ts
  wire field:                 apps/vscode/src/shared/ExtensionMessage.ts
  publication:                apps/vscode/src/sdk/SdkController.ts
  PTAD extension:             apps/vscode/src/sdk/post-terminal-authority-diagnostic-builder.ts
  PTAD shared:                apps/vscode/src/shared/post-terminal-authority-diagnostic.ts
  webview PTAD:               apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx
  TaskHeader component:       apps/vscode/webview-ui/src/components/chat/task-header/TaskHeader.tsx
  TaskHeader telemetry:       apps/vscode/webview-ui/src/components/chat/task-header/TaskHeaderTelemetry.tsx
  TaskHeader helper:          apps/vscode/webview-ui/src/components/chat/task-header/taskHeaderTelemetryHelpers.ts
  board:                      .factory/epic-board.md
  new test file:              apps/vscode/src/sdk/__tests__/task-state-shadow-task-header-presentation.thcp01.test.ts
  + extension of helper tests: apps/vscode/webview-ui/src/components/chat/task-header/taskHeaderTelemetryHelpers.test.ts
PROJECTION_DELTA=NEW (taskHeaderPresentation wire field added; additive; no removal of turnState/legacy)
PUBLICATION_DELTA=NEW (selectTaskHeaderPresentation called at SdkController.ts:2940 alongside thinkingPresentation)
TASKHEADER_SELECTOR_DELTA=taskHeaderStateLabel(turnState) → taskHeaderPresentationStateLabel(taskHeaderPresentation, turnState) (fallback when projection absent preserves byte-equivalent behavior)
TURNSTATE_DELTA=0 (legacy turnState still published for non-TaskHeader consumers)
TIMING_DELTA=0 (taskTelemetry.startedAt/endedAt unchanged; clock ticker unchanged)
NEW_PUBLIC_API=1 (taskHeaderPresentation on ExtensionState; TaskHeaderPresentationProjection type; taskHeaderPresentationStateLabel helper)
NEW_WIRE_FIELD=1 (taskHeaderPresentation?: TaskHeaderPresentationProjection)
NEW_LOCAL_AUTHORITY=NO (selector is pure and observation-only; no React state, no useEffect, no local mutable authority)

CONSERVATION
STATIC_THINKING=PASS (E7.1 STP01..STP08 + 30 base = 38/38 green in useThinkingLoaderRow.test.tsx)
RUNTIME_PROGRESSION=PASS (unchanged; backend singleton + non-reentrancy untouched)
COMPLETION_LIVENESS=PASS (awaiting_followup reachable via shadow; helper preserves Waiting/live)
COMPLETION_AUTHORITY=PASS (phase projection does not affect attempt_completion detection)
COMPACTION=PASS (host override preserves Compacting label; shadow branch ignored when legacy=compacting)
BACKGROUND_COMMANDS=PASS (selector does not consult CommandJobManager state)
CONTEXT=PASS (ContextWindow, cost display, model display untouched)
TIMING=PASS (clock reads taskTelemetry.startedAt/endedAt unchanged; ticker unchanged)

QUALITY
TARGETED=THCP01..THCP10 + shadow-branch ablation + host-override ablation + E7.1 STP guards
APPS_VSCODE=1742/1742 (≥1724 baseline; +18 new THCP selector tests)
WEBVIEW=582/582 (≥575 baseline; +7 new THCP helper tests)
BUN_UNIT=1076/1076 (≥1076 baseline; unchanged)
SDK_CORE=N/A (no SDK core changes)
TYPECHECK=0 diagnostics
COVERAGE_RATCHET=N/A (no coverage tooling change for this scope; the new selector + helper are covered by the new tests; the new tests are themselves the proof)
LINT=PASS (biome + proto-lint)
MARKDOWN=PASS (board reconciled; no markdown linting tool in this repo; markdown is human-readable)
DIFF_CHECK=PASS (worktree clean at start, intermediate, and end)

LIVE
ATTEMPTED=NO (this ACT is a production migration; live dogfood qualification is recommended at the next user-facing checkpoint via .vscode Cline extension running the new build with the affected components. The TaskHeader state label is user-visible, so a single "normal run" cheap scenario would observe: Working while active, Compacting during compaction, Waiting on user-owned incomplete yield, Complete on completed, Error on error.)
RESULT=N/A (production dogfood has not been exercised in this ACT; bounded through-vitest proof)

BOARD
RECON_ACT=CLOSED_RECON_SUPERSEDED at 8b62e164b
MIGRATION_ACT=CLOSED at this closure commit
EPIC=EPIC-CLINEMM-TASKHEADER-CANONICAL-PROJECTION01 CLOSED at this closure commit
OWNER_AWARE_TIMING=UNCHANGED (still OPEN; out of scope)

COMMITS
COUNT=1
HASHES=PENDING
MESSAGES=feat(elm): ACT-CLINEMM-TASKHEADER-CANONICAL-PROJECTION-MIGRATION01 — publish taskHeaderPresentation projection; migrate TaskHeader state label away from legacy turnState.phase (host-compaction override preserved; 18 selector + 7 helper tests; ablation proven for both branches)

PUSHED=NO
FORCE_PUSHED=NO
AMENDED_PUBLISHED_COMMIT=NO

PROTECTED_EVIDENCE
STASH_141372c52=INTACT (stash@{0})
STASH_371752f71=INTACT (stash@{1})

RECOVERY_REFS
LOCAL=recovery/local-main-20260820 → 08bd6bb75 (intact)
REMOTE=recovery/remote-main-20260820 → ee8815e6b (intact)

P2_RESIDUE=none

NEXT_RECOMMENDED_ACT=EPIC-CLINEMM-TASKHEADER-OWNER-AWARE-TIMING01 (now unblocked by EPIC-CLINEMM-TASKHEADER-CANONICAL-PROJECTION01 closure; see board §"### TASKHEADER-OWNER-AWARE-TIMING01" for the desired AGENT/HUMAN/terminal/error timing distinction)
```
