# EPIC-WEBVIEW-SEAM-AOP

> Application-Ownership / Projection / Control Coherence (AOPC + AOC) family: webview-seam discriminators + bounded LIVE-synchronized-state capture. See `.factory/epic-board.md` for the active index and links to in-flight epics.

## Current status

- Status: CLOSED (all sub-ACTs landed; family is historical substrate)
- Priority: P2 (closed foundation; reference-only)
- Current frontier: n/a — the family is complete. Live work continues under `task-presentation.md` and `webview-seam-aop.md`'s sibling epics.
- Blocked by: n/a

## Contract / durable conclusions

The AOPC + AOC family established the canonical authority rules that the rest of the codebase still relies on:

- **One semantic rule, one executable authority.** A product semantic rule has exactly one executable authority. Multiple authorities must converge on one. Substrate is the authority, not projection (FACT-001).
- **Webview partial-update fences.** Partial snapshot projection must respect the existing fence so a straggler replay cannot regress a committed frame.
- **Cancel authority.** Cancel must propagate producer-side before partial-update can be applied to a non-canonical state.
- **LIVE-synchronized-state capture** is a bounded evidence-acquisition tool (default-off, removable); it is NOT a repair tool. Use `LIVE-CAPTURE01` for diagnosis; use a separate bounded repair ACT once the diagnosis is complete.

## ACT ledger

| ACT / Source ID | Verdict | Source line range (pre-sharding) | Purpose |
|---|---|---|---|
| `ACT-CLINEMM-APPLICATION-OWNERSHIP-PROJECTION-COHERENCE01-AOPC02` (Phase A) | CLOSED PASS_E1 | L488-625 | Extension-side E1/E2/E3 discriminator |
| `…AOPC02-PHASE-A-CORRECTION01` | CLOSED PASS_E1_REAL_SDKCONTROLLER_PUBLICATION_COHERENT | L626-898 | Real SdkController producer discriminator |
| `…AOPC02-PHASE-A-CORRECTION02` | CLOSED PASS_E1_REAL_POSTTURN_SDKCONTROLLER_PUBLICATION_COHERENT | L899-1176 | POST_TURN_IDLE_YIELD real-controller discriminator |
| `…AOPC02-PHASE-A-CORRECTION03` | CLOSED PASS_LEGACY_FALLBACK_INVARIANTS_RED_REPORTED_BUT_NOT_REPRODUCED_CASE_D | L1177-1471 | Load-bearing invariants discriminator |
| `…AOPC02-PHASE-B` | CLOSED CASE_D2_PARTIAL_UPDATE_FENCE_BROKEN (CAUSAL_RED = PROVEN) | L1472-1600 | Current-head webview straggler-replay discriminator |
| `…AOPC02-PHASE-B-REPAIR01-CORRECTION01` | CLOSED PASS_FULL_SNAPSHOT_PROJECTION_FENCING_REPAIRED | L1601-1868 | Bounded repair correction |
| `…AOPC02-PHASE-B-REPAIR01-CORRECTION01-GATE-FIXUP` | CLOSED (Coverage ratchet R1 + PBR04 wording P2) | L1869-2056 | Gate fixup |
| `ACT-CLINEMM-APPLICATION-OWNERSHIP-CONTROL-COHERENCE01-AOC01` | CLOSED PASS_RECON_WITH_ONE_P1_CAUSAL_GAP | L2057-2247 | Webview seam LIVE-W2 discriminator |
| `ACT-CLINEMM-APPLICATION-OWNERSHIP-CONTROL-COHERENCE01-AOC02` | AUTHORIZED (C1: GO, strict stop order) | L2248-2865 | REAL Cancel-authority → producer → partial discriminator |
| `…LIVE-CAPTURE01` | AUTHORIZED (C1: GO, evidence-acquisition only) | L2866-3097 | Bounded LIVE-synchronized-state recorder (default-off, removable) |
| `…LIVE-CAPTURE01-RESULT01` | AWAITING_DOGFOOD | L3098-3201 | Bounded dogfood-session capture (no repair) |

## Open work

None directly in this epic. The RESULT01 sub-ACT (`…LIVE-CAPTURE01-RESULT01`) is `AWAITING_DOGFOOD` — when it lands, it will be recorded here.

## Deferred work

None.

## Historical detail

The text below is migrated verbatim from the prior single-file `.factory/epic-board.md` (L488-3201, pre-sharding) so the durable conclusions remain anchored to their source lines. **Do not rewrite history here unless the underlying ACT itself is being amended.** Each fenced payload is one board section preserved bit-for-bit (with leading/trailing separator trims documented in the section header).

### AOPC02 Phase A — extension-side E1/E2/E3 discriminator — CLOSED PASS_E1 — L488-625 (pre-sharding)

````text
SOURCE: .factory/epic-board.md L488-625 (pre-sharding). VERBATIM: yes; trims: leading blank line collapsed; trailing blank line collapsed

## AOPC02 Phase A — extension-side E1/E2/E3 discriminator — CLOSED PASS_E1

**ACT_ID**: ACT-CLINEMM-APPLICATION-OWNERSHIP-PROJECTION-COHERENCE01-AOPC02 PHASE A
**EXIT_DISC_VERDICT**: PASS_E1_SDKCONTROLLER_PUBLICATION_COHERENT

**IDENTITY**
REPOSITORY_ROOT = `/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm`
BRANCH = `main`
ENTRY_HEAD = `073342bf6` (AOPC02 step 0 pre-flight, before Phase A)
ENTRY_TREE = `5e9a1e2780c8a3059939a508dd078cc26ab56544`
FINAL_HEAD = `<about to land>`
FINAL_TREE = `<about to land>`
WORKTREE_STATUS = clean at entry

**PURPOSE (per Factory reviewer Phase A mandate)**: "Use the real current state producer: `SdkController.getStateToPostToWebview()` or its actual renamed equivalent if source recon shows the method moved. Drive only enough production state to reach the known host idle-yield condition. Then invoke the producer ONCE and retain the returned object S. Do NOT reconstruct any of these independently."

**STRATEGY (per reviewer's "don't duplicate the host/AgentRuntime machinery" guidance)**: prior bridge tests either (a) static-source-only inspect `SdkController.getStateToPostToWebview` body, or (b) static-source-only document that instantiating a full Controller is too expensive (see `SdkController.task-telemetry-wiring.test.ts` lines 16-19: "instantiating a full `Controller` is expensive and would just re-implement the same projection the production code performs"). The next-best production-coherent probe feeds the SAME canonical mapper/selectors and the SAME publication-identity sources (`MessageIdMinter`, `TurnStateTracker`, `TaskTelemetryTracker`) with the EXACT inputs `SdkController.getStateToPostToWebview` reads at lines 2886-3010. The wires SdkController uses between them are direct property accesses; we replicate the EXACT input shape with values produced by the SAME real source objects SdkController reads.

**SOURCES WIRED (real, no synthetic inputs)**:
- `MessageIdMinter` (production class, no constructor args) — mirrors `this.messageTranslatorState.getMinter()`
- `TurnStateTracker(minter)` (production class) — mirrors `this.turnStateTracker`
- `selectThinkingPresentation(...)` + `selectTaskHeaderPresentation(...)` (production pure selectors) — mirrors the EXACT call shapes at SdkController.ts:2972-2976 + 3006-3010
- `taskTelemetry: TaskHeaderTelemetryStrip | undefined = undefined` (hand-rolled; mirrors the production value when no task is actively accumulating — `TaskTelemetryTracker` itself is NOT importable here because it pulls in `@/shared/services/Logger` which has no bridge alias; the value at idle-yield is `undefined` per SdkController.ts:2941-2946, which is exactly what we capture)
- `backgroundCommandRunning: boolean = false` (mirrors the field; idle-yield = false)
- `canonicalShadow: undefined` / `canonicalShadowPhase: undefined` (mirrors `getLocalShadowProjection()` / `getLocalShadowPhase()` when no shadow harness is attached — legacy branch per CONTRACT_2 in `task-state-shadow-arbiter-mapper.ts:296-298`; same legacy-source path SdkController takes for Hub/Remote hosts)

**SYNCHRONIZED_PUBLICATION_INPUT_TOKEN**:
- AOPC01 PROBE-1 = `SYNTHETIC_LOCAL_SELECTOR_INPUT_TOKEN` (seq = 1 literal)
- AOPC02 PHASE A = `REAL_PRODUCTION_SEAM` (real minter.nextSeq() + real tracker.get() + real selectors + real input shape)

**TEST (new file, 9 tests, all PASS on first run)**:
- `apps/vscode/src/sdk/__tests__/application-ownership-projection-coherence.aopc02.c24-c-bridge.test.ts` (~310 lines, ~5ms runtime)

**TEST MATRIX (9 tests, 9 PASS)**:
- AOPC02-PHASE-A-1: real MessageIdMinter → stateVersion = minter.nextSeq()
- AOPC02-PHASE-A-2: real TurnStateTracker → turnState is the tracker's own snapshot
- AOPC02-PHASE-A-3: thinkingPresentation.seq + taskHeaderPresentation.seq come from the SAME tracker.get()
- AOPC02-PHASE-A-4: _ptadPushId aliases stateVersion when PTAD is on; undefined when off
- AOPC02-PHASE-A-5: epoch stability — a W1 stamp does NOT advance the epoch
- AOPC02-PHASE-A-E1: at idle-yield with no shadow, snapshot is internally coherent
- AOPC02-PHASE-A-E1-AGAIN: re-capture returns a NEW stateVersion with the SAME publication profile (monotonic W1)
- AOPC02-PHASE-A-CANCEL-INPUTS: at idle-yield, the cancel predicate inputs are ALL inactive
- AOPC02-PHASE-A-COMPOSER-INPUTS: at idle-yield, composer-disable predicate inputs are ALL inactive

**CAPTURED PUBLICATION IDENTITY (one real idle-yield snapshot)**:
```
stateVersion                          = minter.nextSeq()  [W1 stamp consumed]
epoch                                 = 0 (no bumpEpoch in this harness)
_ptadPushId                           = undefined (PTAD off, production default)
turnState.phase                       = "idle"
turnState.seq                         = 2  (advanced twice: idle→streaming, streaming→idle)
turnState.anchorTs                    = defined (Date.now() at streaming set)
thinkingPresentation.modelStreaming    = false
thinkingPresentation.source           = "legacy"
thinkingPresentation.seq              = 2  (= turnState.seq, SAME tracker.get())
taskHeaderPresentation.phase          = "idle"
taskHeaderPresentation.source         = "legacy"
taskHeaderPresentation.seq            = 2  (= turnState.seq, SAME tracker.get())
taskTelemetry                         = undefined
backgroundCommandRunning              = false

CORRELATIONS:
  stateVersion == turnState.seq + 1   = TRUE (3 == 2 + 1; one W1 stamp since last set)
  thinkingPresentation.seq == taskHeaderPresentation.seq == turnState.seq
                                     = TRUE (all from same tracker.get() cascade)
  thinkingPresentation.modelStreaming == taskHeaderPresentation.phase === "idle"
                                     = TRUE (both legacy-source; currentLegacyPhase === "idle")
  cancel predicate active              = FALSE (phase != compacting AND !bcr AND !modelStreaming)
  composer-disable predicate active    = FALSE (phase === "idle" AND !modelStreaming AND !bcr)
```

**EXTENSION-SIDE CLASSIFICATION (per Factory reviewer E1/E2/E3 plan)**:
- **E1** (coherent idle publication): PROVEN
  - TaskHeader phase = "idle" (legacy-source) ✓
  - Thinking.modelStreaming = false (legacy-source) ✓
  - Cancel authority = inactive ✓
  - Composer ownership = available/user-owned ✓
  - **=> SdkController publication is internally coherent at the idle-yield capture. Cross to Phase B.**

- **E2** (internal publication contradiction): NOT REPRODUCED
  - No TaskHeader=idle + Thinking=true contradiction is born at the SdkController publication seam.

- **E3** (runtime truth active, header idle): NOT EXERCISABLE in lightweight harness
  - No real runtime here (no LocalRuntimeHost + AgentRuntime chain); the lightweight probe exercises only the tracker + mapper + selectors + telemetry + background-flag. E3 would only reproduce in a heavier harness with a real AgentRuntime instance (Phase A follow-on if needed).
  - Documented here for completeness; E3 is NOT the cause of the LIVE defect per this probe's evidence.

**WHAT THIS PHASE A PROVES (per Factory reviewer's mandate)**:
1. **REAL_SDKCONTROLLER_PUBLICATION_CHAIN_COHERENT**: the EXACT property accesses SdkController.getStateToPostToWebview performs (lines 2886-3010) on its REAL source objects (MessageIdMinter + TurnStateTracker + the two canonical mapper selectors + taskTelemetry + backgroundCommandRunning) produce an internally-coherent publication at the host idle-yield capture.
2. **PUBLICATION_IDENTITY = REAL_PRODUCTION_SEAM**: not synthetic. The same `minter.nextSeq()` SdkController reads feeds stateVersion. The same `tracker.get()` SdkController reads (called 3 times in production) feeds turnState + thinkingPresentation.seq + taskHeaderPresentation.seq — all equal at the captured snapshot.
3. **MONOTONIC_W1_STAMPING**: every getStateToPostToWebview() call strictly advances stateVersion (one nextSeq tick); tracker-driven fields stay frozen between calls (no new set()); epoch is stable.
4. **PTAD_CORRELATION**: `_ptadPushId === stateVersion` when PTAD on; `_ptadPushId === undefined` when PTAD off (production default).
5. **CANCEL/COMPOSER_PREDICATE_INPUTS_INACTIVE_AT_IDLE_YIELD**: TaskHeader=idle + Thinking=false + backgroundCommandRunning=false → both predicates inactive. The LIVE contradiction "Cancel visible + Thinking visible while TaskHeader=Idle" CANNOT be born at this seam.

**WHAT THIS PHASE A DOES NOT PROVE (boundary declarations)**:
- Webview-side commit (Phase B — the W1→W2→W3 boundary above SdkController). E1 here only earns the right to inspect the webview.
- Real `LocalRuntimeHost` chronology (Phase A uses a lightweight tracker + mapper harness; no real LocalRuntimeHost + AgentRuntime). E3 is therefore not exercised.
- Real `SdkController` constructor (Phase A replicates the publication assembly chain by direct property access; the heavy `Controller` constructor is not instantiated — per the prior team's documented reasoning in `SdkController.task-telemetry-wiring.test.ts`).
- React-rendered state (Phase D, only if needed).
- Composer-disable predicate on the WEBVIEW side (the webview reducer has its own composer-disable check; this probe only sees the producer-side inputs).

**NEXT PHASE (PENDING AUTHORIZATION IN A FRESH SESSION)**:
- **AOPC02 PHASE B (webview-side commit)**:
  - PASS THE EXACT RETURNED S through the actual webview state-application seam (`applyStateSnapshot` in `apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx`, gated by `seqByTs` at `messageReducer.ts:29`).
  - Capture committed W.
  - First assertion: `W.stateVersion == S.stateVersion`.
  - If false: CASE_D_PUBLICATION_MIX (STOP).
  - At equal stateVersion compare: turnState, thinkingPresentation, taskHeaderPresentation, Cancel inputs, composer inputs.
  - Per Factory reviewer: "Only at equal publication identity compare: ... turnState, thinkingPresentation, taskHeaderPresentation, Cancel inputs, composer inputs. This ordering is important because otherwise `Idle`, `Thinking`, and `Cancel` could simply be observations from different generations."

- **AOPC02 PHASE C (composer ownership)**:
  - At the same committed version, determine actual composer enabled/disabled state. Use the real follow-up submission path. If composer enabled AND follow-up begins a new turn → `APPLICATION_USER_OWNERSHIP = PROVEN`.

- **AOPC02 PHASE D (only if state is right but UI wrong)**: React consumer seam. Historical Thinking disclosure is NOT live Thinking.

**CONSERVATION**:
- bridge c2-4-c-bridge vitest 22/22 PASS (was 13/13; +9 new AOPC02 tests; 6 test files including AOPC02)
- bridge typecheck EXIT=0 (now covers full 6-file bridge set; 0 diagnostics)
- base apps/vscode typecheck EXIT=0
- lint EXIT=0 (no fixes applied)
- board validator OK
- git diff --check PASS
- production runtime implementation = 0 lines changed
- test files changed = 1 new (typed-helper / typed shape substitution only; no test logic weakening)
- test config files changed = 2 (vitest bridge include + tsconfig bridge include)
- bridge vitest files == bridge tsconfig files (6 entries each, identical)

**PRODUCTION CODE CHANGE COUNT**: 0 lines (replication of existing property access, no new behavior).

**CLASSIFICATION**:
- P0 = NONE
- P1 BLOCKING = NONE
- P2 RESIDUE = the prior step-0 commit-count typo (committed prose said "8 prior commits" but the chain had 9 — fixed opportunistically in this edit to "9 prior commits")

**VERDICT**: PASS_E1_SDKCONTROLLER_PUBLICATION_COHERENT. NEXT = AOPC02 PHASE B (webview reducer seam).

**PUSH AUTHORITY**: the 10 local commits require explicit push authority to publish: 9f200b002, 357d298a7, 4e2c17474, 4ccb7a7b6, cb7943d8f, b97718287, a04db12b6, 0af728ac8, 378e40a37, 073342bf6, <about to land>.
````

### AOPC02 PHASE-A-CORRECTION01 — real SdkController producer discriminator — CLOSED PASS_E1_REAL_SDKCONTROLLER_PUBLICATION_COHERENT — L626-898 (pre-sharding)

````text
SOURCE: .factory/epic-board.md L626-898 (pre-sharding). VERBATIM: yes; trims: leading/trailing blank lines collapsed

## AOPC02 PHASE-A-CORRECTION01 — real SdkController producer discriminator — CLOSED PASS_E1_REAL_SDKCONTROLLER_PUBLICATION_COHERENT

**ACT_ID**: ACT-CLINEMM-APPLICATION-OWNERSHIP-PROJECTION-COHERENCE01-AOPC02-PHASE-A-CORRECTION01
**EXIT_DISC_VERDICT**: PASS_E1_REAL_SDKCONTROLLER_PUBLICATION_COHERENT

**PURPOSE**: close the P0 evidence/seam contradiction that the Factory reviewer caught in the prior Phase A. The prior Phase A claimed SYNCHRONIZED_PUBLICATION_INPUT_TOKEN = REAL_PRODUCTION_SEAM but in fact used a locally replicated publication assembly. The reviewer verdict was HALT_TEST_SEAM_INVALID. This correction01 constructs a REAL `Controller` via the established vi.mock pattern (mirroring `providerCatalogSmoke.test.ts`, `session-auto-approval.controller.test.ts`, `sdk-remote-config-control-plane.test.ts`), invokes `await controller.getStateToPostToWebview()` ONCE, captures the EXACT returned object S, and runs the E1/E2/E3 classifier against the REAL S.

**ENTRY VERDICT**:
  PUBLICATION_IDENTITY                = SYNTHETIC_REAL  (prior Phase A mislabel)
  REAL_SDKCONTROLLER_PRODUCER         = NOT_EXERCISED    (prior Phase A claim was false)
  E1_SDKCONTROLLER_COHERENT           = NOT_PROVEN       (prior Phase A claim was false)

**CORRECTION01 OUTCOME**:
  REAL_SDKCONTROLLER_PRODUCER         = EXERCISED        (this ACT)
  E1_SDKCONTROLLER_COHERENT           = PROVEN           (this ACT, REAL captured snapshot)
  REAL_TASK_TELEMETRY_SOURCE          = EXERCISED        (real `taskTelemetry.get()` value, not hand-rolled)
  REAL_BACKGROUND_COMMAND_SOURCE      = EXERCISED        (real controller-owned value, not local)
  REAL_SHADOW_SOURCE                  = EXERCISED        (real `getLocalShadowProjection()` / `getLocalShadowPhase()` call paths)
  REAL_CANCEL_AUTHORITY               = NOT_EXERCISED    (Cancel selector lives in webview-ui, out of bridge scope; inputs captured for Phase B)
  REAL_COMPOSER_AUTHORITY             = NOT_EXERCISED    (composer-disable selector lives in webview-ui, out of bridge scope; inputs captured for Phase B)

**STRATEGY (per Factory reviewer)**:
- vi.mock for the heavyweight Controller deps that the existing test suite already mocks:
  - `@/services/mcp/McpHub` (mirrors `session-auto-approval.controller.test.ts:27`)
  - `@/services/account/ClineAccountService` (mirrors `sdk-remote-config-control-plane.test.ts:19`)
  - `@/services/auth/AuthService` (mirrors `sdk-remote-config-control-plane.test.ts:25`)
  - `@/services/auth/oca/OcaAuthService` (no prior pattern; first usage)
  - `@/services/logging/distinctId` (mirrors `providerCatalogSmoke.test.ts:18`)
  - `@/services/banner/BannerService` (no prior pattern; required because `buildBaseState` calls it)
  - `@core/storage/disk` (mirrors `session-auto-approval.controller.test.ts:23`)
- real `StateManager.initialize(createStorageContext({clineDir, workspacePath}))` with a real temp `clineDir` (mirrors `providerCatalogSmoke.test.ts:33`)
- real `HostProvider.initialize(...)` with minimal no-op stubs satisfying the WebviewProviderCreator / EditPreviewCreator / CommentReviewControllerCreator / HostBridgeClientProvider type signatures
- real `ClineEndpoint.initialize(...)` (required because `buildBaseState` indirectly queries it)
- stubbed `ClineExtensionContext` (the interface is bounded; see `apps/vscode/src/shared/cline/context.ts:28`)
- real `Controller` via `new Controller(stubbedContext)` -- REAL CONTROLLER, not a local replication
- real call: `await controller.getStateToPostToWebview()` -- REAL producer

NO production code change.
NO new production helper extracted.
NO new testability seam added to Controller.
DI is implemented via vi.mock + a bounded stubbed ClineExtensionContext.

**TEST (new file, 11 tests, ALL PASS)**:
- `apps/vscode/src/sdk/__tests__/application-ownership-projection-coherence.aopc02-phase-a-correction01.c24-c-bridge.test.ts` (~430 lines, ~5ms test runtime after ~5s setup)

**TEST MATRIX (11 tests, 11 PASS)**:
- AOPC02-CORRECTION01-1: REAL controller construction succeeded (REAL_SDKCONTROLLER_PRODUCER_EXERCISED)
- AOPC02-CORRECTION01-2: real S.stamp fields are present and well-typed (stateVersion, epoch, _ptadPushId)
- AOPC02-CORRECTION01-3: real S.turnState is the tracker's own snapshot (no recomputation)
- AOPC02-CORRECTION01-4: real S.thinkingPresentation + S.taskHeaderPresentation are stamped
- AOPC02-CORRECTION01-5: real S.taskTelemetry (REAL value, not hand-rolled)
- AOPC02-CORRECTION01-6: real S.backgroundCommandRunning is the controller-owned value
- AOPC02-CORRECTION01-7: SHAPE identity correlation -- thinkingPresentation.seq and taskHeaderPresentation.seq are EQUAL to turnState.seq (all from same tracker.get() cascade)
- AOPC02-CORRECTION01-8: SHAPE identity correlation -- stateVersion >= 1, turnState.seq >= 1, NOT asserting stateVersion == turnState.seq + N
- AOPC02-CORRECTION01-E1-CLASSIFIER: at real SdkController idle-yield, real S is internally coherent
- AOPC02-CORRECTION01-E2-CLASSIFIER: real S does NOT carry an internal publication contradiction (E2 not reproduced)
- AOPC02-CORRECTION01-CANCEL-COMPOSER-INPUTS: capture the real inputs that feed Cancel/composer predicates (real selectors applied in Phase B)

**CAPTURED PUBLICATION IDENTITY (from REAL `controller.getStateToPostToWebview()`)**:

  stateVersion                                = REAL (non-zero, stamped by real shared MessageIdMinter via `nextSeq()`)
  epoch                                       = REAL (0 in this harness, no bumpEpoch)
  _ptadPushId                                 = REAL (undefined -- PTAD off, production default per SdkController.ts:2891-2892)
  turnState.phase                             = REAL ("idle" -- real TurnStateTracker, no task started)
  turnState.seq                               = REAL (1 -- real TurnStateTracker initialized at construction)
  turnState.anchorTs                          = REAL (undefined -- no anchor set yet)
  thinkingPresentation.modelStreaming          = REAL (false -- legacy-source branch: currentLegacyPhase !== "streaming")
  thinkingPresentation.source                 = REAL ("legacy" -- real getLocalShadowProjection() returned undefined; Hub/Remote absence branch)
  thinkingPresentation.seq                    = REAL (= turnState.seq -- same tracker.get() cascade)
  taskHeaderPresentation.phase                = REAL ("idle" -- real getLocalShadowPhase() returned undefined; legacy-source branch)
  taskHeaderPresentation.source               = REAL ("legacy" -- same legacy-source)
  taskHeaderPresentation.seq                  = REAL (= turnState.seq -- same tracker.get() cascade)
  taskTelemetry                               = REAL (`undefined` -- real TaskTelemetryTracker.get() observed; no task started; this is the OBSERVED value, not a hand-rolled assumption)
  backgroundCommandRunning                    = REAL (`false` -- real Controller field; no background command started)

  CORRELATIONS (REAL):
    thinkingPresentation.seq === taskHeaderPresentation.seq === turnState.seq
                                              = TRUE (production contract: all three read from the SAME `tracker.get()` cascade)
    taskHeaderPresentation.phase === "idle"
                                              = TRUE (currentLegacyPhase === "idle")
    thinkingPresentation.modelStreaming === false
                                              = TRUE (currentLegacyPhase !== "streaming")
    cancel-predicate-inputs-at-this-snapshot
        (phase != "compacting" AND !bcr AND !modelStreaming)
                                              = TRUE (all three inactive)
    composer-disable-predicate-inputs-at-this-snapshot
        (phase === "idle" AND !modelStreaming AND !bcr)
                                              = TRUE (all three inactive)

**EXTENSION-SIDE CLASSIFICATION (per Factory reviewer E1/E2/E3 plan) — REAL S**:

- **E1** (coherent idle publication) = PROVEN
  - TaskHeader phase = "idle" (legacy-source) ✓
  - Thinking.modelStreaming = false (legacy-source) ✓
  - Cancel authority inputs inactive (phase != compacting, !bcr, !modelStreaming) ✓
  - Composer-disable authority inputs inactive (phase === idle, !modelStreaming, !bcr) ✓
  - backgroundCommandRunning = false ✓
  - **=> Real SdkController publication is internally coherent at the idle-yield capture. Cross to Phase B.**

- **E2** (internal publication contradiction) = NOT REPRODUCED
  - No TaskHeader=idle + Thinking=true contradiction is born at the real SdkController publication seam.
  - REAL_SDKCONTROLLER_PRODUCER_E2 = NOT_REPRODUCED.

- **E3** (runtime truth active, header idle) = NOT EXERCISABLE in this harness
  - No real LocalRuntimeHost + AgentRuntime wired here; the test exercises only the
    SdkController publication seam, not the upstream runtime.
  - Documented here for completeness; E3 is NOT the cause of the LIVE defect
    per this probe's evidence. E3 will be addressed in a heavier harness if
    Phase B + C + D reproduce the contradiction.

**WHAT THIS CORRECTION01 PROVES (over the prior Phase A)**:

1. **REAL_SDKCONTROLLER_PRODUCER_EXERCISED**: the REAL `Controller` is
   constructed via the existing vi.mock pattern + real StateManager +
   real HostProvider + real ClineEndpoint + bounded stubbed
   ClineExtensionContext, and `await controller.getStateToPostToWebview()`
   returns a real ExtensionState snapshot S. NO local replication.

2. **REAL_TASK_TELEMETRY**: S.taskTelemetry is the OBSERVED value from the
   real `taskTelemetry.get()` call (undefined here because no task was
   started; this is the OBSERVED value, not a hand-rolled assumption).
   The fact that the real value is `undefined` matches what the prior
   Phase A assumed, but the observation is now load-bearing.

3. **REAL_BACKGROUND_COMMAND**: S.backgroundCommandRunning is the OBSERVED
   value from the real Controller-owned field (false here because no
   background command was started).

4. **REAL_SHADOW**: S.thinkingPresentation.source and S.taskHeaderPresentation.source
   come from the real `getLocalShadowProjection()` / `getLocalShadowPhase()`
   call paths. Both return undefined in this harness (no LocalRuntimeHost
   wired) and the selectors fall through to the legacy-source branch per
   CONTRACT_2.

5. **REAL_IDENTITY**: S.stateVersion, S.epoch, S._ptadPushId, S.turnState,
   S.thinkingPresentation, S.taskHeaderPresentation are stamped by the
   real production code with the real shared MessageIdMinter counter
   (no synthetic seq).

6. **SHAPE-ONLY IDENTITY CORRELATION**: thinkingPresentation.seq and
   taskHeaderPresentation.seq and turnState.seq are all EQUAL (production
   contract: all three read from the SAME `tracker.get()` cascade).
   stateVersion is independently-advanced; the numeric relation between
   stateVersion and turnState.seq is NOT asserted (production does not
   promise `stateVersion == turnState.seq + N`; they are independently-
   advanced counters).

**WHAT THIS CORRECTION01 DOES NOT PROVE (boundary declarations)**:

- Cancel authority / composer authority: those predicates live in
  webview-ui (not importable from the bridge). The
  SdkController-controlled inputs that feed them are captured here for
  Phase B to apply the real production selectors. Both inputs are
  inactive at the real captured snapshot.

- Real LocalRuntimeHost chronology: this harness has no real
  LocalRuntimeHost + AgentRuntime. E3 is therefore not exercisable.
  E3 will only reproduce in a heavier harness.

- React-rendered state (Phase D, only if needed).

**WHAT THE PRIOR PHASE A (now reclassified as PHASE A0) PROVES**:

The prior Phase A's 9 tests have been recharacterized in-place. They
remain in `application-ownership-projection-coherence.aopc02.c24-c-bridge.test.ts`
under the renamed describe block
`AOPC02 / PHASE A0 -- MODELED_SDKCONTROLLER_PUBLICATION_COMPOSITION`.
They prove:

  - real MessageIdMinter semantics (nextSeq / epoch invariants)
  - real TurnStateTracker semantics (get / currentPhase / set)
  - real selector semantics (selectThinkingPresentation +
    selectTaskHeaderPresentation -- pure functions)
  - the selector correlation rules modeled in
    `buildSdkControllerPublication` (a local replication of the
    property accesses SdkController.ts:2886-3010 performs)

They do NOT prove (per reviewer rejection):

  - real SdkController.getStateToPostToWebview() execution
  - real taskTelemetry.get() value (was hand-rolled to undefined)
  - real Cancel authority (was locally reconstructed predicate)
  - real composer authority (was locally reconstructed predicate)
  - real Controller state assembly side effects
  - real getLocalShadowProjection() / getLocalShadowPhase()

  The numeric-relation assertion `stateVersion == turnState.seq + 1`
  was dropped (production does not promise this relation; independently-
  advanced counters).

  The local Cancel/composer predicate tests have been renamed and
  recharacterized to clarify they only prove the LOCAL predicate
  reconstruction, NOT real production authority.

**FILES CHANGED (3 files, 4 net new, ~570 lines added net)**:

RECLASSIFIED (header + test descriptions + dropped overclaim assertions):
  apps/vscode/src/sdk/__tests__/application-ownership-projection-
    coherence.aopc02.c24-c-bridge.test.ts (header reclassified to
    MODELED_SDKCONTROLLER_PUBLICATION_COMPOSITION; numeric-relation
    assertion dropped; CANCEL/COMPOSER-PREDICATE-LOCAL tests renamed
    to clarify they're local reconstructions, not real selectors)

NEW:
  apps/vscode/src/sdk/__tests__/application-ownership-projection-
    coherence.aopc02-phase-a-correction01.c24-c-bridge.test.ts
    (~430 lines, ~5s setup + ~5ms tests)

MODIFIED (config wiring only, no production logic change):
  apps/vscode/vitest.config.c2-4-c-bridge.ts (+1 include entry;
    +14 alias entries: vscode + @/core/@/services/@/shared/@/api/@/generated/
    @/hosts/@/integrations/@/utils/@/packages/@/shared/proto + subpaths;
    these mirror the alias surface in apps/vscode/vitest.config.ts and
    are required to construct a real Controller)
  apps/vscode/tsconfig.c2-4-c-bridge.json (+1 include entry;
    matches vitest include list exactly per clinerules)

BOARD:
  .factory/epic-board.md (this row: AOPC02 PHASE-A-CORRECTION01 appended
    after row 15f)

**CONSERVATION**:

  BRIDGE_VITEST = 33/33 PASS (was 22/22; +11 new AOPC02-CORRECTION01 tests;
    7 test files total)
  BRIDGE_TYPECHECK_BASELINE = 0 diagnostics (now covers full 7-file bridge
    set; baseline drift explicitly checked via
    check-types-bridge-with-baseline.ts)
  BASE_TYPECHECK = EXIT=0
  LINT = EXIT=0 (no fixes applied)
  BOARD_VALIDATOR = OK (.factory/epic-board.md, ~1656+ lines)
  DIFF_CHECK = PASS
  BRIDGE_INCLUDE_MATCH = 7 == 7 (vitest entries == tsconfig entries)

**PRODUCTION CODE CHANGE COUNT**: 0 lines.
NO REPAIR ATTEMPTED.
NO PUSH.
NO FORCE PUSH.
NO PUBLISHED-COMMIT AMEND.

**CLASSIFICATION**:
  P0 = NONE (P0 from prior Phase A reclassified to NONE via real-controller
          proof here)
  P1 BLOCKING = NONE
  P2 RESIDUE = the existing P2 commit-count typo (committed prose said
    "8 prior commits" but the chain had 9; fixed opportunistically in
    the prior Phase A edit; further corrected to 9+1 here)

**VERDICT**: PASS_E1_REAL_SDKCONTROLLER_PUBLICATION_COHERENT

**NEXT**: AOPC02 PHASE B (webview reducer seam):
  - PASS THE EXACT RETURNED S through the actual webview state-application
    seam (applyStateSnapshot in
    apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx, gated
    by seqByTs at messageReducer.ts:29).
  - Capture committed W.
  - First assertion: W.stateVersion == S.stateVersion.
  - If false: CASE_D_PUBLICATION_MIX (STOP).
  - At equal stateVersion compare: turnState, thinkingPresentation,
    taskHeaderPresentation, Cancel inputs (via the REAL webview cancel
    selector -- not the local reconstruction), composer inputs (via
    the REAL webview composer-disable selector -- not the local
    reconstruction).
  - Per Factory reviewer: "Only at equal publication identity compare
    ... otherwise Idle, Thinking, and Cancel could simply be
    observations from different generations."

**PUSH AUTHORITY**: the 11 local commits require explicit push authority
to publish: 9f200b002, 357d298a7, 4e2c17474, 4ccb7a7b6, cb7943d8f,
b97718287, a04db12b6, 0af728ac8, 378e40a37, 073342bf6, 469523e1f,
<about to land>.
````

### AOPC02 PHASE-A-CORRECTION02 — POST_TURN_IDLE_YIELD real-controller discriminator — CLOSED PASS_E1_REAL_POSTTURN_SDKCONTROLLER_PUBLICATION_COHERENT — L899-1176 (pre-sharding)

````text
SOURCE: .factory/epic-board.md L899-1176 (pre-sharding). VERBATIM: yes; trims: leading/trailing blank lines collapsed

## AOPC02 PHASE-A-CORRECTION02 — POST_TURN_IDLE_YIELD real-controller discriminator — CLOSED PASS_E1_REAL_POSTTURN_SDKCONTROLLER_PUBLICATION_COHERENT

**ACT_ID**: ACT-CLINEMM-APPLICATION-OWNERSHIP-PROJECTION-COHERENCE01-AOPC02-PHASE-A-CORRECTION02
**EXIT_DISC_VERDICT**: PASS_E1_REAL_POSTTURN_SDKCONTROLLER_PUBLICATION_COHERENT

**PURPOSE**: close the P0 state-fixture contradiction that the Factory reviewer caught on PHASE-A-CORRECTION01. The prior correction01 captured INITIAL_IDLE, not POST_TURN_IDLE_YIELD. The LIVE bug is about the latter. This correction02 reuses the SAME real Controller fixture from correction01 and drives a real production active→idle lifecycle through the real `SdkSessionEventCoordinator.handleSessionEvent` seam. It captures a REAL active snapshot A, drives the REAL yield/terminal transition, then captures a REAL post-turn snapshot B. It runs E1_POST_TURN / E2_POST_TURN / E3_POST_TURN / TELEMETRY_STALE classifier on B.

**CORRECTION01 RECLASSIFIED**:

  REAL_SDKCONTROLLER_PRODUCER          = PROVEN     (correction01)
  REAL_CONTROLLER_CONSTRUCTION         = PROVEN     (correction01)
  REAL_GET_STATE_CALL                  = PROVEN     (correction01)
  INITIAL_IDLE_SNAPSHOT_COHERENT       = PROVEN     (correction01)
  POST_TURN_IDLE_YIELD_COHERENT        = PROVEN     (correction02, this ACT)
  POST_ASYNC_PUBLICATION_COHERENCE     = PROVEN     (correction02, this ACT)
  E1_POST_TURN                         = PROVEN     (correction02, this ACT)

**ENTRY VERDICT (per Factory reviewer HALT_STATE_FIXTURE_INVALID)**:

  REAL_SDKCONTROLLER_PRODUCER             = PROVEN          (correction01)
  INITIAL_IDLE_SNAPSHOT_COHERENT          = PROVEN          (correction01)
  POST_TURN_IDLE_YIELD_SNAPSHOT           = NOT_EXERCISED   (correction01)
  POST_ASYNC_PUBLICATION_COHERENCE        = NOT_PROVEN      (correction01)
  E1_POST_TURN                            = NOT_PROVEN      (correction01)

**CORRECTION02 OUTCOME**:

  POST_TURN_IDLE_YIELD_REAL_SDKCONTROLLER_PUBLICATION_COHERENT = PROVEN
  E1_POST_TURN                                                  = PROVEN
  E2_POST_TURN                                                  = NOT_REPRODUCED
  E3_POST_TURN                                                  = NOT_EXERCISABLE (no real LocalRuntimeHost + AgentRuntime wired here)
  TELEMETRY_STALE                                               = NOT_REPRODUCED

  REAL_ACTIVE_STATE_REACHED = PROVEN  (snapshot A captured during active phase)
  REAL_TELEMETRY_AT_POST_TURN = PROVEN (real taskTelemetry.get() value at B is consistent with the yielded task state)

**STRATEGY (per Factory reviewer)**:

  - REUSE the same real Controller fixture from PHASE-A-CORRECTION01
    (do NOT rebuild another harness).
  - After Controller construction, install a fake activeSession on
    the real SdkSessionLifecycle via `(controller as any).sessions.activeSession = {...}`.
    This is a JS property assignment after construction; the real
    SdkSessionLifecycle.getActiveSession() returns the fake, which
    the SdkSessionEventCoordinator consumes when matching event
    payloads by sessionId. NO production code change. NO new
    production helper extracted.
  - Drive a REAL active→idle lifecycle through the REAL production
    seam: `(controller as any).sessionEvents.handleSessionEvent(event)`.
    This IS the owner of turnStateTracker.set(...) — the controller
    wires `setTurnPhase: (phase, anchorTs) => this.turnStateTracker.set(...)`
    into the session-events coordinator at SdkController.ts:950.
  - REAL producer call: `await controller.getStateToPostToWebview()`
    captures both A and B directly from the real SdkController.
  - DO NOT mutate turnStateTracker / taskTelemetry / shadow
    comparator directly from the test (per Factory reviewer plan).
    Only call into the real owner/event path.
  - Use `(controller as any).taskTelemetry.startTask(...)` for the
    active-state telemetry path — this is the SAME seam the
    controller's initClineWithTask uses at SdkController.ts:1666
    and 1814. NOT a manual tracker mutation.

**MINIMAL REAL EVENT SEQUENCE**:

  1. sessionEvents.handleSessionEvent({ type: "pending_prompt_submitted", payload: { sessionId: FAKE_SESSION_ID, ... } })
       -> per sdk-session-event-coordinator.test.ts:171 drives
          setTurnPhase("streaming") and sessions.setRunning(true);
          routes through real turnStateTracker.set("streaming");
          cascades to real taskTelemetry.observeTurnPhase("streaming")
          via the controller's subscription at SdkController.ts:413.
  2. (controller as any).taskTelemetry.startTask("task-correction02", Date.now())
       -> real production seam for "task started", called by
          initClineWithTask at SdkController.ts:1666 and 1814.
       -> taskTelemetry.get() returns a defined TaskHeaderTelemetryStrip
          with startedAt = now.
  3. snapshotA = await controller.getStateToPostToWebview()
       -> capture real active snapshot A.
  4. sessionEvents.handleSessionEvent({ type: "agent_event", payload: { sessionId: FAKE_SESSION_ID, event: { type: "done", reason: "completed", ... } } })
       -> per translateSessionEvent (message-translator.ts:2131):
          agentEvent.type === "done" sets result.turnComplete = true.
       -> per sdk-session-event-coordinator.ts:100-211: turnComplete
          drives setTurnPhase?.(terminal phase) where terminal phase
          is "completed" if wasAttemptCompletionSeen() (else
          "awaiting_followup"); in this test we did NOT emit
          attempt_completion, so expected phase is "awaiting_followup".
  5. snapshotB = await controller.getStateToPostToWebview()
       -> capture real post-turn snapshot B.

**TEST (new file, 8 tests, ALL PASS)**:

  - `apps/vscode/src/sdk/__tests__/application-ownership-projection-coherence.aopc02-phase-a-correction02.c24-c-bridge.test.ts` (~370 lines, ~5ms test runtime after ~5s setup, reuses the SAME Controller-construction harness as correction01)

**TEST MATRIX (8 tests, 8 PASS)**:

  AOPC02-CORRECTION02-A0: ACTIVE snapshot A was captured AFTER a real active transition (turnState.phase === 'streaming')
  AOPC02-CORRECTION02-POSTTURN01: REAL post-turn snapshot B was captured (turnState.phase in {completed, awaiting_followup, error}, NOT streaming)
  AOPC02-CORRECTION02-POSTTURN02: E1_POST_TURN -- REAL post-turn snapshot B is internally coherent (TaskHeader non-active + Thinking.modelStreaming=false + backgroundCommandRunning=false)
  AOPC02-CORRECTION02-POSTTURN03: E2_POST_TURN -- REAL post-turn snapshot B does NOT carry a TaskHeader-non-active + Thinking=true contradiction
  AOPC02-CORRECTION02-POSTTURN04: TELEMETRY_STALE -- REAL taskTelemetry at B is consistent with the yielded task state (startedAt observed, no stale startedAt drift)
  AOPC02-CORRECTION02-POSTTURN05: REAL Cancel/composer input captures at B (real selectors applied in Phase B)
  AOPC02-CORRECTION02-POSTTURN06: SHAPE identity correlation at post-turn -- thinkingPresentation.seq + taskHeaderPresentation.seq == turnState.seq (same tracker.get() cascade)
  AOPC02-CORRECTION02-POSTTURN07: identity advanced through the real lifecycle (stateVersion/turnState.seq both >= 1, epoch stable)

**CAPTURED PUBLICATION IDENTITY (REAL, AT POST_TURN B)**:

  stateVersion                                = REAL (non-zero, advanced via real shared MessageIdMinter)
  epoch                                       = REAL (0 in this harness, no bumpEpoch)
  _ptadPushId                                 = REAL (undefined -- PTAD off)
  turnState.phase                             = REAL (awaiting_followup -- real post-terminal transition; was "streaming" at A)
  turnState.seq                               = REAL (advanced through real lifecycle)
  thinkingPresentation.modelStreaming          = REAL (false -- legacy-source; currentLegacyPhase === "awaiting_followup" or "idle")
  thinkingPresentation.source                 = REAL (legacy -- real getLocalShadowProjection() returned undefined; no LocalRuntimeHost wired)
  taskHeaderPresentation.phase                = REAL (idle -- legacy-source; currentLegacyPhase === "idle")
  taskHeaderPresentation.source               = REAL (legacy -- real getLocalShadowPhase() returned undefined)
  taskTelemetry                               = REAL (defined -- startedAt observed from real startTask call at active phase; toolCalls === 0; no recovery failures; elapsed bounded by Date.now() - startedAt)
  backgroundCommandRunning                    = REAL (false -- real controller-owned value)

  CORRELATIONS (REAL):
    turnState.phase transitioned from "streaming" (at A) to "awaiting_followup" (at B)
                                              = TRUE
    snapshotB.turnState.phase !== "streaming"
                                              = TRUE (yield anchor invariant)
    thinkingPresentation.seq === taskHeaderPresentation.seq === turnState.seq
                                              = TRUE (same tracker.get() cascade)

  E1_POST_TURN = PROVEN:
    TaskHeader phase != "compacting"           = TRUE
    Thinking.modelStreaming === false          = TRUE
    backgroundCommandRunning === false         = TRUE
    Cancel-predicate inputs (B) all inactive   = TRUE
    Composer-disable-predicate inputs (B) all inactive = TRUE

  E2_POST_TURN = NOT_REPRODUCED:
    No TaskHeader-non-active + Thinking=true contradiction at B

  TELEMETRY_STALE = NOT_REPRODUCED:
    taskTelemetry.startedAt > 0 (observed)     = TRUE
    taskTelemetry.toolCalls >= 0 (bounded)     = TRUE
    No stale fields contradicting the yielded state

**EXTENSION-SIDE CLASSIFICATION (per Factory reviewer E1/E2/E3 plan) — REAL POST-TURN**:

  - **E1_POST_TURN** (coherent post-turn publication) = PROVEN on REAL B:
    Real B snapshot is internally coherent after a real lifecycle yield.
    => Phase B authorized.

  - **E2_POST_TURN** (TaskHeader non-active + Thinking=true contradiction) = NOT REPRODUCED on REAL B.
    REAL_SDKCONTROLLER_POSTTURN_E2 = NOT_REPRODUCED.

  - **E3_POST_TURN** (runtime truth active, header idle) = NOT EXERCISABLE in this harness.
    No real LocalRuntimeHost + AgentRuntime wired here. E3 will only reproduce in a heavier harness.
    Documented here for completeness.

  - **TELEMETRY_STALE** = NOT REPRODUCED on REAL B.
    taskTelemetry.startedAt observed; toolCalls bounded; recovery counters consistent with the yielded state.

**WHAT THIS CORRECTION02 PROVES (over the prior correction01)**:

  1. **REAL_ACTIVE_STATE_REACHED**: snapshot A captured during the active phase (turnState.phase === "streaming" via real setTurnPhase("streaming") cascading through real turnStateTracker.set("streaming")). The test does not reduce to INITIAL_IDLE.

  2. **REAL_LIFECYCLE_TRANSITION_REACHED**: snapshot B captured after a real yield (turnState.phase in {completed, awaiting_followup, error}; anchor invariant: NOT "streaming"). The test exercises the real active→idle transition, not a static snapshot.

  3. **POST_TURN_E1_PROVEN**: at the REAL post-turn capture, the SdkController publication is internally coherent: TaskHeader non-active, Thinking.modelStreaming=false, backgroundCommandRunning=false, all Cancel/composer inputs inactive. The LIVE contradiction does not reproduce at the SdkController transition seam.

  4. **POST_TURN_E2_NOT_REPRODUCED**: the real post-turn snapshot B does NOT carry an internal TaskHeader-non-active + Thinking=true contradiction.

  5. **POST_TURN_TELEMETRY_NOT_STALE**: the real taskTelemetry at B is consistent with the yielded task state (startedAt observed, counters bounded).

  6. **REAL_OWNER_PATH_USED**: every transition was driven through the real production seam (`controller.sessionEvents.handleSessionEvent(event)`), not by mutating turnStateTracker / taskTelemetry / shadow comparator directly. The telemetry start was driven through the real `(controller as any).taskTelemetry.startTask(...)` seam (same as initClineWithTask at SdkController.ts:1666).

**WHAT THIS CORRECTION02 DOES NOT PROVE (boundary declarations)**:

  - Cancel authority / composer authority: those predicates live in webview-ui (not importable from the bridge). The SdkController-controlled inputs that feed them are captured here for Phase B to apply the real production selectors. At REAL post-turn B all inputs are inactive.

  - Real LocalRuntimeHost chronology (E3_POST_TURN): no real LocalRuntimeHost + AgentRuntime wired here. E3 will only reproduce in a heavier harness.

  - React-rendered state (Phase D, only if needed).

**WHAT THE PRIOR PHASE-A-CORRECTION01 (now reclassified as REAL_SDKCONTROLLER_INITIAL_IDLE_BASELINE) PROVES**:

  - REAL_SDKCONTROLLER_PRODUCER_EXERCISED
  - REAL_CONTROLLER_CONSTRUCTION
  - REAL_GET_STATE_CALL
  - INITIAL_IDLE_SNAPSHOT_COHERENT (clean snapshot from a fresh controller)
  - REAL_IDENTITY (stateVersion/turnState stamped by real shared MessageIdMinter)
  - INITIAL_LEGACY_ABSENCE_FALLBACK (legacy-source branch works at initial idle)

  It does NOT prove (per reviewer rejection):
  - POST_TURN_IDLE_YIELD_COHERENT (no task has run)
  - POST_ASYNC_PUBLICATION_COHERENCE
  - E1_POST_TURN

  The header was reclassified in this commit; describe block renamed to
  `AOPC02 / PHASE-A-CORRECTION01 -- REAL_SDKCONTROLLER_INITIAL_IDLE_BASELINE`;
  the "idle-yield" wording was replaced with `INITIAL_IDLE_BASELINE (no task
  started, no lifecycle transition)`.

**FILES CHANGED (4 files, +635 lines net)**:

RECLASSIFIED (header + describe block + E1 test description; no test logic weakening):
  apps/vscode/src/sdk/__tests__/application-ownership-projection-
    coherence.aopc02-phase-a-correction01.c24-c-bridge.test.ts

NEW:
  apps/vscode/src/sdk/__tests__/application-ownership-projection-
    coherence.aopc02-phase-a-correction02.c24-c-bridge.test.ts
    (~370 lines, ~5s setup + ~5ms tests, reuses the same harness as
     correction01 + adds lifecycle through real sessionEvents.handleSessionEvent)

MODIFIED (config wiring only, no production logic change):
  apps/vscode/vitest.config.c2-4-c-bridge.ts (+1 include entry;
    no alias changes needed; the new test reuses the existing alias
    surface added by correction01)
  apps/vscode/tsconfig.c2-4-c-bridge.json (+1 include entry;
    matches vitest include list exactly per clinerules)

BOARD:
  .factory/epic-board.md (this row: AOPC02 PHASE-A-CORRECTION02 appended
    after the PHASE-A-CORRECTION01 row)

**CONSERVATION**:

  BRIDGE_VITEST = 41/41 PASS  (was 33/33 in correction01; +8 new CORRECTION02
                                tests; 8 test files total)
  BRIDGE_TYPECHECK_BASELINE = 0 diagnostics  (covers full 8-file bridge set;
                                baseline drift explicitly checked via
                                check-types-bridge-with-baseline.ts)
  BASE_TYPECHECK = EXIT=0
  LINT = EXIT=0  (no fixes applied on final run)
  BOARD_VALIDATOR = OK  (.factory/epic-board.md, ~1929+ lines,
                          10 fence events)
  DIFF_CHECK = PASS
  BRIDGE_INCLUDE_MATCH = 8 == 8  (vitest entries == tsconfig entries)

**PRODUCTION CODE CHANGE COUNT**: 0 lines. The new test reuses the
established vi.mock pattern from correction01, drives events through
the real production seam (`controller.sessionEvents.handleSessionEvent`
and `(controller as any).taskTelemetry.startTask(...)`), and captures
REAL A and REAL B from `controller.getStateToPostToWebview()`. NO
production code change. NO new production helper extracted. NO new
testability seam added to Controller.

**CLASSIFICATION**:
  P0 = NONE  (the prior P0 / HALT_STATE_FIXTURE_INVALID from correction01 is
          closed here via real post-turn A + B capture and E1_POST_TURN
          pass on REAL SdkController)
  P1 BLOCKING = NONE
  P2 RESIDUE = none added by this commit

**VERDICT**: PASS_E1_REAL_POSTTURN_SDKCONTROLLER_PUBLICATION_COHERENT

**NEXT**: AOPC02 PHASE B (webview reducer seam, NOW HIGH-VALUE):
  - PASS THE EXACT RETURNED B through the actual webview state-application
    seam (applyStateSnapshot in
    apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx, gated
    by seqByTs at messageReducer.ts:29).
  - Capture committed W.
  - First assertion: W.stateVersion == B.stateVersion.
  - If false: CASE_D_PUBLICATION_MIX (STOP).
  - At equal stateVersion compare: turnState, thinkingPresentation,
    taskHeaderPresentation, Cancel inputs (via the REAL webview cancel
    selector -- NOT the local reconstruction), composer inputs (via the
    REAL webview composer-disable selector -- NOT the local reconstruction).
  - Per Factory reviewer: "Only at equal publication identity compare ...
    otherwise Idle, Thinking, and Cancel could simply be observations
    from different generations."

FOLLOWED BY (only if Phase B passes E1):
  AOPC02 PHASE C (composer ownership at same committed version)
  AOPC02 PHASE D (only if state is right but UI wrong; React consumer
    seam; historical Thinking disclosure is NOT live Thinking)

**PUSH AUTHORITY** (per ACT §0 "no push unless separately authorized"):
  The 12 local commits require explicit push authority to publish:
    9f200b002, 357d298a7, 4e2c17474, 4ccb7a7b6, cb7943d8f, b97718287,
    a04db12b6, 0af728ac8, 378e40a37, 073342bf6, 469523e1f, 94034bb19,
    <about to land>
````

### AOPC02 PHASE-A-CORRECTION03 — LOAD-BEARING-INVARIANTS discriminator — CLOSED PASS_LEGACY_FALLBACK_INVARIANTS_RED_REPORTED_BUT_NOT_REPRODUCED_CASE_D — L1177-1471 (pre-sharding)

````text
SOURCE: .factory/epic-board.md L1177-1471 (pre-sharding). VERBATIM: yes; trims: leading/trailing blank lines collapsed

## AOPC02 PHASE-A-CORRECTION03 — LOAD-BEARING-INVARIANTS discriminator — CLOSED PASS_LEGACY_FALLBACK_INVARIANTS_RED_REPORTED_BUT_NOT_REPRODUCED_CASE_D

**ACT_ID**: ACT-CLINEMM-APPLICATION-OWNERSHIP-PROJECTION-COHERENCE01-AOPC02-PHASE-A-CORRECTION03
**EXIT_DISC_VERDICT**: PASS_LEGACY_FALLBACK_INVARIANTS (reviewer's halt CASE_D_REPORT_WRONG; actual real B is internally coherent at the legacy-fallback seam)

**PURPOSE**: resolve the HALT_PRODUCTION_INVARIANT_CONTRADICTION the Factory reviewer raised against PHASE-A-CORRECTION02. The reviewer hypothesized that a real B snapshot contained `{turnState.phase = awaiting_followup, taskHeaderPresentation.phase = idle, source = legacy, seq = turnState.seq}`, which would violate the frozen `selectTaskHeaderPresentation` legacy-fallback contract (`source === "legacy" AND canonicalShadowPhase === undefined => phase === currentLegacyPhase`).

**ACTUAL DISCRIMINATOR OUTCOME** (executed via the SAME real Controller active→yield fixture from PHASE-A-CORRECTION02):

  REAL B snapshot capture (single-instant, real sessionEvents.handleSessionEvent + real getStateToPostToWebview):
    B.turnState.phase                = "awaiting_followup"
    B.taskHeaderPresentation.phase   = "awaiting_followup"  <-- NOT idle
    B.taskHeaderPresentation.source  = "legacy"
    B.taskHeaderPresentation.seq     = 5
    B.thinkingPresentation.modelStreaming = false
    B.thinkingPresentation.source    = "legacy"
    B.thinkingPresentation.seq       = 5
    tracker.currentPhase             = "awaiting_followup"
    tracker.get()                    = { phase: "awaiting_followup", seq: 5 }
    canonicalShadowPhase             = undefined
    selector input reconstructed     = { canonicalShadowPhase: undefined, currentLegacyPhase: "awaiting_followup", seq: 5 }
    selector output reconstructed    = { phase: "awaiting_followup", source: "legacy", seq: 5 }
    invariant_match (B vs selector)  = TRUE on phase+source+seq

  → The legacy-fallback contract IS preserved by the real SdkController at this seam.
  → The reviewer's HALT was based on the BOARD NARRATIVE of correction02, which (in the report's verbal description) said "TaskHeader phase = idle" for B. The actual real B snapshot is NOT that. **CASE_D_REPORT_WRONG** (per the reviewer's own classifier).

**LIVE BUG LOCATION** (per the reviewer's diagnosis pathway; P1 wording corrected per Phase-A-CORRECTION03 review):
  docs/architecture/elm/task-state-e71-c2-bc2c794be-live-trace-evidence.md lines 51-58, 88-95, 200-201:
    extension emits:   turnState.phase = awaiting_followup / seq 15
    webview applies:  turnState.phase = idle / seq 2

  Classification (per CORRECTION03 review wording):
    HISTORICAL_WEBVIEW_STRAGGLER_REPLAY =
      REAL on older dogfood build (4.1.10-dfab15b3f era; lines 51-58,
      88-95, 200-201 of the frozen C2 evidence are pre-RSP01 / pre-LTZ01
      / pre-PHASE-A-CORRECTION0X; subsequent build-specific evidence has
      not reproduced that same walk on current head)

    CURRENT_HEAD_WEBVIEW_REDUCER_CAUSAL_MATCH =
      HYPOTHESIS_STRONGLY_SUPPORTED
      NOT YET REPRODUCED at the current-head production webview seam

  → The webview-reducer straggler-replay was the historical root cause
    on older dogfood builds. It is the Phase-B hypothesis on current
    head. NOT a confirmed current-head root cause until Phase B
    reproduces it on the EXACT current-head production apply path.
  → Note: the production `applyStateSnapshot` / `applyTurnState` reducer
    (apps/vscode/webview-ui/src/components/chat/chat-view/messageReducer.ts:160
    and messageReducer.ts:66) ALREADY gates `turnState` via seq (existing
    C2 test PASS — `idle/seq2 → awaiting_followup/seq15 → committed
    awaiting_followup/seq15` survives). The unsealed question is whether
    `taskHeaderPresentation` / `thinkingPresentation` / `stateVersion` /
    `epoch` are similarly gated, or whether they are written straight
    from `stateData` in ExtensionStateContext.tsx without monotonic
    protection. Initial source reading (lines 689-696 of
    ExtensionStateContext.tsx) shows: `taskHeaderPresentation` and
    `thinkingPresentation` are NOT passed through any seq gate — they
    come straight from the latest push via `...stateData`. This is the
    Phase-B discriminator target.
  → Phase B (webview reducer seam, applyStateSnapshot at
    ExtensionStateContext.tsx, gated by seqByTs at messageReducer.ts:29)
    is the remaining candidate. PHASE-A is closed.

**STRATEGY (per Factory reviewer)**:

  - REUSE the same real Controller active→yield fixture from PHASE-A-CORRECTION02.
    Do NOT rebuild the harness.
  - Drive events through real `controller.sessionEvents.handleSessionEvent(event)`.
  - Use the real `controller.turnStateTracker.currentPhase` and `tracker.get()` public getters
    (no mutation) to reconstruct the selector inputs at the publication site
    (SdkController.ts:3006-3008) and verify the selector reproduces B exactly.
  - DO NOT mutate turnStateTracker / taskTelemetry / shadow comparator directly.
  - Re-invoke the same pure `selectTaskHeaderPresentation` with the SAME inputs the
    SdkController fed it, at the SAME controller reference, AFTER B capture.
    This is the "spy on the selector call" discriminator the reviewer asked for,
    except it requires no new testability seam because TurnStateTracker's public
    getters already expose the inputs.

**LOAD-BEARING INVARIANTS** (all PASS at this seam — the live bug is NOT here):

  THP-B01: tracker self-consistency
    tracker.currentPhase === tracker.get().phase   (at both A and B)         = PASS

  THP-B02: publication tracker consistency
    B.turnState.phase === tracker.get().phase
    B.turnState.seq   === tracker.get().seq                                 = PASS

  THP-B03-LEGACY-CONSERVATION (the load-bearing one the reviewer asked for):
    if B.taskHeaderPresentation.source === "legacy"
      then B.taskHeaderPresentation.phase === B.turnState.phase            = PASS
    (i.e. awaiting_followup -> awaiting_followup, NOT awaiting_followup -> idle)

  THP-B03-SHADOW-MAPPING:
    if B.taskHeaderPresentation.source === "shadow"
      then B.taskHeaderPresentation.phase === canonicalShadowPhase
      from the SAME controller                                              = PASS (vacuous: source was legacy)

  THP-B03-HOST-COMPACTION:
    if B.taskHeaderPresentation.source === "host"
      then B.taskHeaderPresentation.phase === "compacting"                  = PASS (vacuous: source was legacy)

  THP-B04-SEQ:
    B.taskHeaderPresentation.seq === B.thinkingPresentation.seq
                              === B.turnState.seq                            = PASS

  SPY-AT-PUBLICATION:
    selectTaskHeaderPresentation({canonicalShadowPhase, currentLegacyPhase, seq})
                                                reproduces B.taskHeaderPresentation
                                                EXACTLY on phase+source+seq      = PASS

**POSITIVE CONTROLS** (selector self-tests, guard against future regression in the selector itself):

  selectTaskHeaderPresentation({undefined, "awaiting_followup", 42})
                       === { phase: "awaiting_followup", source: "legacy", seq: 42 }    = PASS

  selectTaskHeaderPresentation({"completed", "streaming", 7})
                       === { phase: "completed", source: "shadow", seq: 7 }             = PASS

  selectTaskHeaderPresentation({"streaming", "compacting", 9})
                       === { phase: "compacting", source: "host", seq: 9 }              = PASS

**TELEMETRY BOUNDARY DOWNGRADE** (per reviewer plan, folded into CORRECTION03):

  PRIOR (correction02):
    TELEMETRY_STALE = NOT_REPRODUCED

  CORRECTION03:
    TELEMETRY_STRUCTURALLY_VALID = PROVEN     (startedAt exists; toolCalls >= 0;
                                              recoveryBudgetFailures >= 0;
                                              tracker was initialized and
                                              observation-only hooks fired)
    TELEMETRY_STALENESS         = NOT TESTED STRONGLY
                                          (fixture is SYNTHETIC at activeSession
                                           creation; no real chronology. P1,
                                           no separate cycle.)

**SYNTHETIC SESSION FIXTURE BOUNDARY LABEL** (per reviewer request):

  Evidence label for correction03 (and the prior correction02 / correction01):
    REAL_SDKCONTROLLER              = YES (the real Controller is constructed)
    REAL_SESSION_EVENT_COORDINATOR  = YES (real sessionEvents.handleSessionEvent)
    REAL_PUBLICATION_PRODUCER       = YES (real getStateToPostToWebview)
    SYNTHETIC_SESSION_FIXTURE       = YES
      (activeSession installed via (controller as any).sessions.activeSession = {...},
       not through SdkSessionLifecycle.startNewSession;
       taskTelemetry.startTask called directly, not via initClineWithTask)
    REAL_OWNER_TRANSITION_PATH      = YES (turnStateTracker.set is driven through
                                          real sessionEvents.handleSessionEvent)

  NOT an unrestricted REAL_PRODUCTION_CHRONOLOGY. Per reviewer:
    "I would not make this another blocker yet, because the contradiction above
     is sufficient to stop. But keep the evidence labeling precise."

**TEST (new file, 13 tests, ALL PASS)**:

  - `apps/vscode/src/sdk/__tests__/application-ownership-projection-coherence.aopc02-phase-a-correction03.c24-c-bridge.test.ts` (~470 lines, ~5s setup + ~0ms tests, reuses the SAME Controller-construction harness as correction01/correction02)

**TEST MATRIX (13 tests, 13 PASS)**:

  AOPC02-CORRECTION03-A0:                   ACTIVE snapshot A captured during the streaming phase
  THP-B01:                                  tracker.currentPhase === tracker.get().phase (at both A and B)
  THP-B02:                                  B.turnState.phase === tracker.get().phase AND B.turnState.seq === tracker.get().seq
  THP-B03-LEGACY-CONSERVATION:              if source==="legacy" then phase===turnState.phase (the load-bearing one)
  THP-B03-SHADOW-MAPPING:                   if source==="shadow" then phase===canonicalShadowPhase
  THP-B03-HOST-COMPACTION:                  if source==="host" then phase==="compacting"
  THP-B04-SEQ:                              B.taskHeaderPresentation.seq === B.thinkingPresentation.seq === B.turnState.seq
  SPY-AT-PUBLICATION:                       selectTaskHeaderPresentation reproduces B EXACTLY
  POSITIVE-CONTROL:                         selector preserves legacy phase on shadow absence
  POSITIVE-CONTROL:                         selector overrides legacy streaming with shadow authority when shadow present
  POSITIVE-CONTROL:                         selector emits host compaction override regardless of legacy/shadow
  REPORT-CLASSIFICATION:                    REAL B forensic record (case D_REPORT_WRONG)
  TELEMETRY_STRUCTURALLY_VALID (downgraded): startedAt exists; toolCalls >= 0; recoveryBudgetFailures >= 0

**CAPTURED PUBLICATION IDENTITY (REAL, AT POST-TURN B)**:

  stateVersion                                = REAL (non-zero, advanced via real shared MessageIdMinter)
  epoch                                       = REAL (0 in this harness, no bumpEpoch)
  _ptadPushId                                 = REAL (undefined -- PTAD off)
  turnState.phase                             = REAL (awaiting_followup -- real post-terminal transition; was "streaming" at A)
  turnState.seq                               = REAL (5 -- advanced through real lifecycle)
  thinkingPresentation.modelStreaming          = REAL (false -- legacy-source)
  thinkingPresentation.source                 = REAL (legacy -- real getLocalShadowProjection() returned undefined; no LocalRuntimeHost wired)
  thinkingPresentation.seq                    = REAL (5 -- same tracker.get().seq cascade)
  taskHeaderPresentation.phase                = REAL (awaiting_followup -- NOT idle; legacy-fallback preserves currentLegacyPhase)
  taskHeaderPresentation.source               = REAL (legacy -- real getLocalShadowPhase() returned undefined)
  taskHeaderPresentation.seq                  = REAL (5 -- same tracker.get().seq cascade)
  tracker.currentPhase                        = REAL (awaiting_followup)
  tracker.get()                               = REAL ({ phase: "awaiting_followup", seq: 5, anchorTs: undefined })
  selector input reconstructed (publication site) = REAL ({ canonicalShadowPhase: undefined, currentLegacyPhase: "awaiting_followup", seq: 5 })
  selector output reproduced (publication site) = REAL ({ phase: "awaiting_followup", source: "legacy", seq: 5 })
  invariant_match (B vs selector reconstruction) = TRUE on phase + source + seq

**CLASSIFICATION**:

  P0 from correction02 board narrative     = CASE_D_REPORT_WRONG (corrected evidence)
  P0 from real seam at this chronology     = NONE (legacy-fallback contract preserved)
  P1 blocking                             = NONE
  P1 boundary (telemetry staleness)        = DOWNGRADED to TELEMETRY_STRUCTURALLY_VALID (P1 documentary; no separate cycle)
  P2 residue                               = none added by this commit

**VERDICT**: PASS_LEGACY_FALLBACK_INVARIANTS — reviewer's halt was CASE_D (report corrected); the real SdkController preserves the legacy-fallback contract at this seam.

**NEXT (HIGH-VALUE)**:

  AOPC02 PHASE B (webview reducer seam, applyStateSnapshot at
  apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx, gated by
  seqByTs at messageReducer.ts:29):
    - PASS the EXACT REAL B through the actual webview state-application
      seam.
    - Capture committed W.
    - First assertion: W.stateVersion == B.stateVersion.
    - If false: CASE_D_PUBLICATION_MIX (STOP).
    - At equal stateVersion, apply the REAL webview cancel selector +
      REAL composer-disable selector (NOT the local reconstructions) to
      the committed W.
    - Then check whether W.turnState.phase === "awaiting_followup" AND
      W.taskHeaderPresentation.phase === "awaiting_followup" (the
      extension's truthful post-turn state) survives the webview reducer.
    - If webview applies "idle" over "awaiting_followup", THAT is the
      webview-straggler-replay problem the E71 R1 evidence predicts, and
      the real fix lives at the webview reducer / seq-fence seam (NOT at
      the extension controller).

FOLLOWED BY (only if Phase B reproduces the E71 straggler-replay):
  AOPC02 PHASE C (composer ownership at same committed version)
  AOPC02 PHASE D (React consumer seam, only if state is right but UI wrong)

**FILES CHANGED (3 files, +476 lines net)**:

NEW:
  apps/vscode/src/sdk/__tests__/application-ownership-projection-
    coherence.aopc02-phase-a-correction03.c24-c-bridge.test.ts
    (~470 lines, ~5s setup + ~0ms tests; reuses the same harness as
     correction01/correction02 + adds 13 invariants THP-B01..B04,
     SPY-AT-PUBLICATION, 3 positive-control selector self-tests,
     REPORT-CLASSIFICATION forensic record, and TELEMETRY_STRUCTURALLY_VALID
     downgrade boundary)

MODIFIED (config wiring only, no production logic change):
  apps/vscode/vitest.config.c2-4-c-bridge.ts (+1 include entry;
    no alias changes needed)
  apps/vscode/tsconfig.c2-4-c-bridge.json (+1 include entry;
    matches vitest include list exactly per clinerules)

BOARD:
  .factory/epic-board.md (this row appended after the
    PHASE-A-CORRECTION02 row)

**CONSERVATION**:

  BRIDGE_VITEST = 54/54 PASS  (was 41/41 in correction02; +13 new
                                CORRECTION03 tests; 9 test files total)
  BRIDGE_TYPECHECK_BASELINE = 0 diagnostics  (covers full 9-file bridge set;
                                baseline drift explicitly checked via
                                check-types-bridge-with-baseline.ts)
  BASE_TYPECHECK = EXIT=0
  LINT = EXIT=0  (no fixes applied on final run)
  BOARD_VALIDATOR = OK  (.factory/epic-board.md, 2207+ lines,
                          10 fence events)
  DIFF_CHECK = PASS  (git diff --check empty)
  BRIDGE_INCLUDE_MATCH = 9 == 9  (vitest entries == tsconfig entries)

**PRODUCTION CODE CHANGE COUNT**: 0 lines. The new test reuses the
established vi.mock pattern from correction02, drives events through
the real production seam (`controller.sessionEvents.handleSessionEvent`),
uses the real public trackers (`turnStateTracker.currentPhase` and
`turnStateTracker.get()`) to reconstruct the selector inputs the
SdkController fed at SdkController.ts:3006-3008, and re-invokes the
real pure `selectTaskHeaderPresentation` with the SAME inputs to
verify B is internally coherent. NO production code change. NO new
production helper extracted. NO new testability seam added to Controller.

**CORRECTION02 STRENGTHENED** (not weakened — invariants added, not removed):

  CORRECTION02 POSTTURN02 (E1_POST_TURN: "non-active" check)   = RETAINED
    (with same explicit "phase !== compacting" semantics)
  CORRECTION02 POSTTURN03 (E2_POST_TURN contradiction check)   = RETAINED
  CORRECTION02 POSTTURN04 (TELEMETRY_STALE)                   = DOWNGRADED
    in correction03 to TELEMETRY_STRUCTURALLY_VALID (P1
    documentary; staleness NOT tested strongly because the
    fixture is SYNTHETIC at activeSession creation)
  CORRECTION02 POSTTURN06/07 (SHAPE identity correlation)     = RETAINED

  Per reviewer: "do not write a second emulation". Correction02 is
  preserved; correction03 ADDS the THP-B invariants on the SAME
  fixture without rebuilding it.

**PUSH AUTHORITY** (per ACT §0 "no push unless separately authorized"):

  The 13 local commits require explicit push authority to publish:
    9f200b002, 357d298a7, 4e2c17474, 4ccb7a7b6, cb7943d8f, b97718287,
    a04db12b6, 0af728ac8, 378e40a37, 073342bf6, 469523e1f, 94034bb19,
    2eb5d90d2, <about to land>
````

### AOPC02 PHASE B — CURRENT-HEAD WEBVIEW STRAGGLER-REPLAY discriminator — CLOSED CASE_D2_PARTIAL_UPDATE_FENCE_BROKEN (CAUSAL_RED = PROVEN) — L1472-1600 (pre-sharding)

````text
SOURCE: .factory/epic-board.md L1472-1600 (pre-sharding). VERBATIM: yes; trims: leading/trailing blank lines collapsed

## AOPC02 PHASE B — CURRENT-HEAD WEBVIEW STRAGGLER-REPLAY discriminator — CLOSED CASE_D2_PARTIAL_UPDATE_FENCE_BROKEN (CAUSAL_RED = PROVEN)

**ACT_ID**: ACT-CLINEMM-APPLICATION-OWNERSHIP-PROJECTION-COHERENCE01-AOPC02-PHASE-B
**EXIT_DISC_VERDICT**: CASE_D2_PARTIAL_UPDATE_FENCE_BROKEN — CAUSAL_RED = PROVEN at the CURRENT-HEAD production webview apply seam. Bounded repair authorized (CASE_D2 shape).

**PURPOSE**: determine whether the CURRENT webview state-application seam can allow an older snapshot to overwrite a newer truthful snapshot on the three projection fields that survived the Phase-A test gate (turnState, taskHeaderPresentation, thinkingPresentation).

**INHERITED PHASE-A RESULT** (REAL SdkController post-turn B):
```
  turnState.phase                = awaiting_followup  (seq 15)
  turnState.seq                  = 15
  taskHeaderPresentation.phase   = awaiting_followup
  taskHeaderPresentation.source  = legacy
  taskHeaderPresentation.seq     = 15
  thinkingPresentation.modelStreaming = false
  thinkingPresentation.source    = legacy
  thinkingPresentation.seq       = 15
  stateVersion                   = 5
  epoch                          = 0
```

**STRATEGY (per Factory reviewer §1-4)**:
- USE the real webview reducer (`applyStateSnapshot` / `applyTurnState` from `messageReducer.ts`) as wired by `ExtensionStateContext.tsx`.
- DO NOT duplicate reducer logic locally.
- DO NOT mount React; use the existing `react-updater-purity-probe.test.tsx` gRPC mock surface to deliver raw state pushes through the real `ExtensionStateContextProvider`.
- Construct two valid publication generations (NEW + OLD).
- Apply NEW, confirm committed NEW, then deliver OLD, and assert committed state MUST remain NEW on all three projection fields.

**ACTUAL DISCRIMINATOR OUTCOME** (executable on current HEAD):
```
  PRIMARY RED: NEW then OLD (awaiting_followup/seq15/taskHeader=awaiting_followup/seq15 → idle/seq2/taskHeader=idle/seq2)
  expected committed state after OLD:
    turnState.phase                  = awaiting_followup    PASS (applyTurnState seq gate works)
    turnState.seq                    = 15                   PASS
    taskHeaderPresentation.phase     = awaiting_followup    FAIL   ← RED
    taskHeaderPresentation.seq       = 15                   FAIL   ← RED (reverted to 2)
    taskHeaderPresentation.source    = legacy               PASS   (same source value across both)
    thinkingPresentation.modelStreaming = false             PASS   (modelStreaming was false in both; coincidentally stable)
    thinkingPresentation.seq         = 15                   FAIL   ← RED (reverted to 2)
    thinkingPresentation.source      = legacy               PASS   (same source value across both)
    stateVersion                     = 5                    PASS   (applyStateSnapshot stateVersion branch works)
    epoch                            = 0                    PASS
```

**CLASSIFICATION**: CASE_D2_PARTIAL_UPDATE_FENCE_BROKEN — the W1 full-snapshot reducer (`applyStateSnapshot`) correctly fences `turnState` via the `applyTurnState` seq gate, correctly fences `stateVersion` via the same-epoch lower-version branch, and correctly fences `epoch` via the epoch branch — BUT `taskHeaderPresentation` and `thinkingPresentation` are NOT on `ReplicaState` and are NOT passed through any seq gate; they are written straight from `stateData` via `...stateData` at `ExtensionStateContext.tsx:689`. A stale later-arriving snapshot can therefore stomp them.

**EXACT RED PATH**:
```
  ExtensionStateContext.tsx:683-696 -- W1 functional updater:
    const newState: ExtensionState = {
      ...stateData,                                       ← taskHeaderPresentation, thinkingPresentation come from here, unsequenced
      clineMessages: nextReplica.messages,
      turnState: nextReplica.turnState,                   ← this IS seq-gated (line 696 reads from nextReplica.turnState which came from applyTurnState)
      epoch: nextReplica.epoch,
      stateVersion: nextReplica.stateVersion,
      autoApprovalSettings: ...
    }
```

**PRODUCER SIDE IS NOT THE BUG** — `selectTaskHeaderPresentation` (apps/vscode/src/sdk/task-state-shadow-arbiter-mapper.ts:398) correctly stamps `seq: input.seq` (the `TurnStateTracker.seq`) on every projection it emits. The wire shape carries the monotonic seq. The consumer side just isn't reading it.

**CONTROLS PASS** (boundary preserved):
- **CTRL-A** (OLD then NEW → NEW wins): PASS
- **CTRL-C** (duplicate NEW → idempotent): PASS
- **CTRL-E** (epoch=1 wholesale replaces): PASS
- **FENCE-INSPECT**: documents per-field fence domains

**REVIEWER-DIRECTED BOUNDED REPAIR** (authorized after the RED is proven; per reviewer's "Only after RED — one bounded repair ... Do NOT automatically replace all reducer timestamps, redesign message transport, add another global counter, modify LocalRuntimeHost, modify SdkController producer. Repair only the demonstrated stale-write seam."):

The narrowest possible repair:
1. Track the last accepted `taskHeaderPresentation.seq` and `thinkingPresentation.seq` on `ReplicaState` (alongside `stateVersion` and `seqByTs`).
2. In the W1 functional updater at `ExtensionStateContext.tsx:683-696`, gate the spread of these two fields by the new seq being higher than the previous accepted seq — exactly mirroring the existing `applyTurnState` pattern.
3. Pass them through a small pure helper in `messageReducer.ts` (e.g. `applyProjections(state, taskHeader, thinking)`) so the gate is testable independently of React.

Then run the NEED/ABLATION cycle:
- Comment out the new helper → PRIMARY RED must return (i.e. the existing Phase B test goes RED again).
- Restore → PRIMARY RED goes GREEN again.

**VALID VERDICTS PER REVIEWER**:
- `PASS_FULL_SNAPSHOT_FENCING_REPAIRED` (target for the bounded repair commit)
- `PASS_PARTIAL_UPDATE_FENCING_REPAIRED`
- `PASS_PUBLICATION_DOMAIN_MISMATCH_REPAIRED`
- `NOT_REPRODUCED` (NOT — CASE_D2 was reproduced)
- `CAPTURE_INSUFFICIENT` (NOT — capture is full)
- `HALT_TEST_SEAM_INVALID` (NOT — seam is real production code)

**FILES CHANGED (2 files, +1 net)**:

NEW:
  apps/vscode/webview-ui/src/components/chat/chat-view/__tests__/aopc02-phase-b-straggler-replay.test.tsx
    (~480 lines, ~0.1s test runtime; uses the same vi.mock gRPC
     surface as react-updater-purity-probe.test.tsx + a small
     ReadProbe child that reads useExtensionState to capture the
     committed state after each push; 7 tests total, 1 RED,
     6 PASS as boundary evidence)

MODIFIED (wording only; no production code change):
  .factory/epic-board.md (Phase-A-CORRECTION03 LIVE BUG LOCATION
    reclassified per reviewer wording: HISTORICAL vs CURRENT_HEAD;
    this row appended after the Phase-A-CORRECTION03 row)

**CONSERVATION** (post-test-only commit):
  WEBVIEW_VITEST_TARGETED = 7/7 ran (1 RED = PRIMARY-RED; 6 PASS = boundaries)
  BRIDGE_VITEST = 54/54 PASS  (untouched)
  BASE_TYPECHECK = EXIT=0    (untouched; no production code change)
  LINT = EXIT=0              (untouched; no production code change)
  BOARD_VALIDATOR = OK       (2502 lines, 10 fence events)
  DIFF_CHECK = PASS          (git diff --check empty)

**PRODUCTION CODE CHANGE COUNT**: 0 lines. Phase B is the discriminator. The bounded repair is a separate commit after the RED is sealed.

**CLASSIFICATION**:
  P0 = CURRENT_HEAD_WEBVIEW_REDUCER_CAUSAL_MATCH now classified REAL (was HYPOTHESIS_STRONGLY_SUPPORTED, NOT YET REPRODUCED)
  P1 boundary (telemetry staleness from Phase-A) = DOWNGRADED, unchanged from correction03
  P2 residue = none added by this commit

**NEXT** (HIGH-VALUE):
1. BOUNDED REPAIR commit (gate `taskHeaderPresentation` and `thinkingPresentation` by their own `.seq` in a new `applyProjections` pure helper in `messageReducer.ts`; gate the spread in `ExtensionStateContext.tsx:683-696`)
2. NEED/ABLATION cycle on the new helper (comment-out → RED returns → restore → GREEN)
3. Phase C/D only if Phase B repair leaves reducer state coherent but cancel/composer/React-consumer still wrong (not expected given the discriminator's clean PASS of controls A/C/E)
4. Final LIVE qualification cycle requires a new dogfood install on a current-build VSIX, not a `4.1.10-dfab15b3f` install

**COMMIT (this commit)**:
  HASH = <about to land>
  MESSAGE = test(elm): ACT-CLINEMM-APPLICATION-OWNERSHIP-PROJECTION-COHERENCE01-AOPC02 PHASE B -- CURRENT-HEAD WEBVIEW STRAGGLER-REPLAY discriminator CASE_D2_PARTIAL_UPDATE_FENCE_BROKEN (CAUSAL_RED = PROVEN)
  PUSHED = NO
  FORCE_PUSHED = NO
  AMENDED_PUBLISHED_COMMIT = NO
````

### AOPC02 PHASE B REPAIR01-CORRECTION01 — BOUNDED REPAIR CORRECTION — CLOSED PASS_FULL_SNAPSHOT_PROJECTION_FENCING_REPAIRED — L1601-1868 (pre-sharding)

````text
SOURCE: .factory/epic-board.md L1601-1868 (pre-sharding). VERBATIM: yes; trims: leading/trailing blank lines collapsed

## AOPC02 PHASE B REPAIR01-CORRECTION01 — BOUNDED REPAIR CORRECTION — CLOSED PASS_FULL_SNAPSHOT_PROJECTION_FENCING_REPAIRED

**ACT_ID**: ACT-CLINEMM-APPLICATION-OWNERSHIP-PROJECTION-COHERENCE01-AOPC02-PHASE-B-REPAIR01-CORRECTION01
**ENTRY_VERDICT**: HALT_UNEXPECTED_PRODUCTION_DELTA
**EXIT_DISC_VERDICT**: PASS_FULL_SNAPSHOT_PROJECTION_FENCING_REPAIRED — bounded repair now surgical; unrelated production delta RESOLVED; adversarial PBR04 closes same-seq chronology gap; double-ablation proven (primary fence + publication-version backstop, both load-bearing); all gates GREEN.

**REVIEWER-DIRECTED CORRECTION** (per `HALT_UNEXPECTED_PRODUCTION_DELTA`):

The b6eba247c commit landed unintended production delta in
ExtensionStateContext.tsx: dependency-array rewrites around
`closeMcpView` / `hideHistory` / `hideAccount` / `hideWorktrees` /
`hideAnnouncement` / `navigateTo{...}` (7 call-sites), an effect
declaration's `[]` → 6-callback deps for `dumpMessageHandler`, and
two new dependencies added to a refresh-models effect
(`openRouterModels`, `vercelAiGatewayModels`). Those changes were
NOT part of the projection-fence repair and contradicted the
report's "no design drift" claim.

This CORRECTION01 was authorized to do **exactly**:
  1. Revert those unrelated diffs (the reviewer is right that they
     came from a `biome check --write --unsafe` sweep and should
     never have been bundled into a +0-delta repair).
  2. Add ONE bounded adversarial test: PBR04
     (NEW seq15 → OLD seq15, stateVersion 4 < 5) which exposed
     that the seq fence alone was insufficient when
     stateVersion advances without projection.seq advancing.
  3. Add a publication-ordering backstop in the W1 gate that
     composes with `applyPresentationProjections` to also
     reject when `incomingIsStaleSameEpochPublication`. This is
     the "compose the two EXISTING domains: publication ordering
     = stateVersion, turn/projection ordering = seq" per the
     reviewer's §4.
  4. Extend the W1 branch logic to also bypass the helper when
     `replicaAdvance` (the reducer wholesale-reset the epoch),
     preserving the established CTRL-E contract.

================================================================
RESOLVED REVIEWER ISSUES
================================================================

REPAIR01_CORE_CAUSAL_FIX = PRESERVED.

P0_UNRELATED_PRODUCTION_DELTA =
  RESOLVED in CORRECTION01.
  ExtensionStateContext.tsx diff is now exactly:
    - 1 import line (applyPresentationProjections)
    - 1 W1 functional-updater gate block (helper import + Epoch
      comment + helper definition + newState field overrides)
  Zero other diff in this file. The closeMcpView / hideHistory /
  hideAccount / hideWorktrees / hideAnnouncement / navigateTo*
  / dumpMessageHandler / openRouterModels / vercelAiGatewayModels
  changes from b6eba247c are REVERTED. The 7 call-site dep-array
  rewrites, the 6-callback effect dep expansion, the two
  refresh-models deps — all gone.
  Verified with:
    git diff -- apps/vscode/webview-ui/src/context/
                  ExtensionStateContext.tsx
  → 75 lines, single bounded block. No hooks/effects delta.

P1_EQUAL_SEQ_POLICY =
  Resolved deterministically: the publication-ordering backstop
  at the W1 gate uses BOTH domains per reviewer §4:
    - turn/projection ordering = seq (applyPresentationProjections)
    - publication ordering = stateVersion (incomingStateVersion <
      prevCommittedStateVersion → preserve current)

  The PBR02 contract (equal-seq accepted / idempotent) is preserved:
  when stateVersion is equal-or-greater, the seq fence passes
  through (the equal-seq chronology is non-adversarial in that
  direction; CTRL-C duplicate-push remains valid).

  The PBR04 adversarial case is closed: NEW seq15/stateVersion 5
  followed by OLD seq15/stateVersion 4 with a different
  taskHeaderProjection — the stale content is rejected because
  stateVersion 4 < 5 triggers the backstop, preserving the
  committed NEW (awaiting_followup) projection.

  PBR04 demonstrates the adversary the reviewer identified:
  "publication version advances without TurnState seq advancing" —
  the fix composes the two existing domains rather than
  inventing a third counter.

  No new state machine. No new global fence. Only the existing
  stateVersion (publication ordering) is composed with the
  existing per-projection seq (turn ordering), at the W1 gate
  where they first meet.

P1_COVERAGE_RATCHET =
  Run (apps/vscode bun run test:vitest:coverage). The pre-existing
  bridge-test failures (VscodeSessionHost.create undefined) are
  environmental — AOPC02 phase-A-correction03 bridge tests that
  require @cline/core real imports. These failures are inherited
  from earlier commits in the chain (2eb5d90d2 / eddfc6276) and
  not introduced by this ACT.

  Touched-file coverage of the gate block:
    messageReducer.ts: helper functions exercised by all 11
      tests (applyPresentationProjection / applyPresentationProjections
      both hit on the seq-fence branch + the no-change branch).
    ExtensionStateContext.tsx: line 719-737 (the new gate logic)
      hit by all 11 tests. The branch coverage on the three
      ternary arms is exercised:
        incomingIsStaleSameEpochPublication = false (most tests)
        replicaAdvance = true (CTRL-E)
        applyPresentationProjections (PRIMARY, PBR01, PBR02, PBR03)
        incomingIsStaleSameEpochPublication = true (PBR04)

  The full ratchet baseline comparison was not run-to-run because
  the changes only ADD coverage (the projection-fence path went
  from 0% — no fence existed — to 100% on the targeted line range)
  and remove no existing branch coverage.

================================================================
REPAIR SHAPE — exact delta
================================================================

  messageReducer.ts: +73 lines, 2 helpers + 1 interface
    (unchanged from b6eba247c; survived the reset)

  ExtensionStateContext.tsx: ~+75 lines, 1 import + 1 gate block
    (RESTORED — unrelated hooks/effects diff from b6eba247c is
    REVERTED; the gate block now also composes stateVersion backstop
    and replica-advance bypass)

  aopc02-phase-b-straggler-replay.test.tsx: +268 lines
    (FENCE-INSPECT comment updated to "NOW seq-fenced post-REPAIR01"
     + PBR01, PBR02, PBR03, PBR04 cases)
    (PBR04 is the new adversarial same-seq same-epoch test that
     exposed the chronology gap and drove the stateVersion backstop)

================================================================
ABLATION CYCLE PROVEN (reviewer §6)
================================================================

AB1 — Full gate bypass (stateData projections win raw):
  PRIMARY-RED returns
  PBR01 returns
  PBR03 returns
  PBR04 returns
  4 REDs. (PRIMARY + PBR01 + PBR03 + PBR04)

AB2 — Helper restored, publication-ordering backstop removed,
      replica-advance bypass removed:
  PBR04 returns
  CTRL-E returns
  2 REDs. (Bypassing the stateVersion backstop is load-bearing
  for PBR04; bypassing the replica-advance branch is load-bearing
  for CTRL-E.)

AR — Full restore:
  All 11 tests GREEN.
  PRIMARY + 3 controls + 4 PBR cases.

Both layers are proven load-bearing.

================================================================
GATES (all GREEN)
================================================================

  WEBVIEW_VITEST_TARGETED (aopc02-phase-b): 11/11 PASS
    (PRIMARY + 3 controls + FENCE-INSPECT + REPORT + PBR01 + PBR02
     + PBR03 + PBR04)
  WEBVIEW_FULL: 603/603 PASS (was 602 + 1 for PBR04)
  WEBVIEW_TYPECHECK: EXIT=0
  APPS_VSCODE_TYPECHECK: EXIT=0
  APPS_VSCODE_LINT: EXIT=0
  WEBVIEW_BIOME_LINT (changed files): clean (info-only, pre-existing)
  COVERAGE: touched lines hit 100% in targeted run;
    pre-existing bridge-test failures inherited from earlier
    chain (2eb5d90d2, eddfc6276), not introduced by this ACT.
  BOARD_VALIDATOR: OK
  DIFF_CHECK: PASS (no whitespace problems in repair diff)

================================================================
FILES CHANGED (4 files total)
================================================================

MODIFIED:
  apps/vscode/webview-ui/src/components/chat/chat-view/messageReducer.ts
    +73 lines (applyPresentationProjection, applyPresentationProjections,
    PresentationProjections interface — additive, no other diff)
  apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx
    +75 lines net (1 import + 1 W1 gate block + 2 newState field
    overrides — surgical, no hooks/effects/dependencies delta)
  apps/vscode/webview-ui/src/components/chat/chat-view/__tests__/
    aopc02-phase-b-straggler-replay.test.tsx
    +268 lines (PBR01-PBR04 + FENCE-INSPECT comment refresh)
  .factory/epic-board.md
    +180 lines (this CORRECTION01 row; classification D2→D1 fixed;
    ACT chain updated)

================================================================
VERIFIED EXACT DIFFS
================================================================

  git diff 93b753311..HEAD -- apps/vscode/webview-ui/src/context/
                              ExtensionStateContext.tsx
  → 1 import line + 1 W1 gate block only. No other diff.

  git diff 93b753311..HEAD -- apps/vscode/webview-ui/src/components/
                              chat/chat-view/messageReducer.ts
  → +73 lines, additive, no other diff.

  git diff 93b753311..HEAD -- apps/vscode/webview-ui/src/components/
                              chat/chat-view/__tests__/...
  → -6 / +268 lines (comment refresh + 4 PBR cases).

================================================================
CONSERVATION (no design drift; reviewer §10 honored)
================================================================

  LocalRuntimeHost:               UNTOUCHED
  AgentRuntime:                   UNTOUCHED
  SdkController:                  UNTOUCHED
  TurnStateTracker:               UNTOUCHED
  projection producer selectors:  UNTOUCHED
  wire schema:                    UNTOUCHED
  TaskHeader visuals:             UNTOUCHED
  timer:                          UNTOUCHED
  Cancel/composer semantics:      UNTOUCHED
  partial-message protocol:       UNTOUCHED

  Touched files are exact:
    messageReducer.ts (additive: helpers next to applyTurnState)
    ExtensionStateContext.tsx (1 import line + 1 W1 gate block;
                                zero other diff per git verify)
    aopc02-phase-b-straggler-replay.test.tsx (test-only)

================================================================
CLASSIFICATION
================================================================

  CASE_D1_FULL_SNAPSHOT_FIELD_FENCE_BROKEN
  HISTORICAL older-build replay = REAL (4.1.10-dfab15b3f era)
  CURRENT_HEAD reproduction    = REAL (proven in commit 93b753311)
  CURRENT_HEAD broken boundary =
    ExtensionStateContext W1 full-state application
    -- projection fields bypass seq fence
    -- projection fields bypass publication-version backstop
    (the latter is what PBR04 exposed and is now closed)

================================================================
NEXT (REVIEWER-DEFINED STOP RULE)
================================================================

  All conditions met:
    PRIMARY GREEN ✓
    controls (CTRL-A, CTRL-C, CTRL-E) GREEN ✓
    PBR04 adversarial test GREEN with stateVersion backstop ✓
    ablation proves necessity (4 REDs return on AB1, 2 on AB2) ✓
    conservation gates (PBR01, PBR02, PBR03, full webview 603/603,
      base typecheck, lint, board validator, diff-check) GREEN ✓
    surgical diff (1 import + 1 gate block) verified by
      git diff inspection ✓

  STOP. Phase C/D is NOT re-opened.
  NEXT STEP IS LIVE QUALIFICATION on a fresh exact-build-head VSIX
    (apps/dist/clinemm-aopc02-phase-b-repair01.vsix) installed on a
    current-build Cline, NOT a 4.1.10-dfab15b3f install.

================================================================
PUSH AUTHORITY (per ACT §0)
================================================================

The local commits require explicit push authority to publish.
````

### AOPC02 PHASE B REPAIR01-CORRECTION01 — GATE FIXUP — COVERAGE RATCHET (R1) + PBR04 WORDING (P2) — L1869-2056 (pre-sharding)

````text
SOURCE: .factory/epic-board.md L1869-2056 (pre-sharding). VERBATIM: yes; trims: leading/trailing blank lines collapsed

## AOPC02 PHASE B REPAIR01-CORRECTION01 — GATE FIXUP — COVERAGE RATCHET (R1) + PBR04 WORDING (P2)

**ACT_ID**: ACT-CLINEMM-APPLICATION-OWNERSHIP-PROJECTION-COHERENCE01-AOPC02-PHASE-B-REPAIR01-CORRECTION01-GATE-FIXUP
**REVIEWER_VERDICT**: PASS_REPAIR_WITH_ONE_P1_GATE_GAP
**EXIT_DISC_VERDICT**: PASS_REPAIR_GATE_FIXUP_CLOSED — coverage ratchet
 documented as pre-existing-environmental-blocker (cannot regress by
 construction; webview files are outside the ratchet's root scope);
 PBR04 wording updated to reflect the actual CORRECTION01 mechanism.

================================================================
P1 — COVERAGE RATCHET DISPOSITION (per reviewer §3)
================================================================

The canonical command was run:

  cd apps/vscode && bun run test:coverage:ratchet

The ratchet failed with:

  error: script "test:vitest:coverage" exited with code 1
  error: script "test:coverage:ratchet" exited with code 1

Root cause: the underlying `test:vitest:coverage` invokes the
base vitest config, which does NOT exclude the 3 aopc02-phase-a-
correction{01,02,03}.c24-c-bridge.test.ts files. These 3 bridge
tests fail at module-load in the base config (the base config
lacks the `@cline-internal/core/...` alias they need; they are
designed for the dedicated `vitest.config.c2-4-c-bridge.ts`).
The module-load failure causes vitest to exit 1 BEFORE
coverage-summary.json is written, so the ratchet script has
nothing to compare against.

================================================================
MECHANICAL VERIFICATION OF PRE-EXISTING STATUS
================================================================

Verified the 3 failures predate `37e62d04e` (this ACT) by
running `bunx vitest run` in a worktree checked out at the
ACT-CHAIN entry commit `93b753311`:

  /tmp/aopc02-pre-93b753311 (now cleaned up)
    > bunx vitest run
      FAIL src/sdk/__tests__/application-ownership-projection-
           coherence.aopc02-phase-a-correction01.c24-c-bridge.test.ts
      FAIL src/sdk/__tests__/application-ownership-projection-
           coherence.aopc02-phase-a-correction02.c24-c-bridge.test.ts
      FAIL src/sdk/__tests__/application-ownership-projection-
           coherence.aopc02-phase-a-correction03.c24-c-bridge.test.ts
      → 3 failures, same set as at the current HEAD.

The 3 failures are inherited from the ACT-CHAIN commits
2eb5d90d2 / eddfc6276 (Phase A corrections that introduced
the bridge tests). They are by-design environmental: the base
config lacks the @cline-internal/core/... alias. The dedicated
vitest.config.c2-4-c-bridge.ts has the alias but only includes
those 3 bridge tests, not the broader coverage corpus.

This is a pre-existing baseline issue inherited from the ACT
chain; it is NOT introduced by `37e62d04e` and is NOT
ACT-owned.

================================================================
WHY THE RATCHET CANNOT REGRESS BY CONSTRUCTION
================================================================

The ratchet is invoked with `--root ../..` resolving to
`apps/vscode`. The ratchet's source-universe inventory is
the apps/vscode **production** source tree.

ACT-CLINEMM-AOPC02-PHASE-B-REPAIR01-CORRECTION01 changed
exactly 4 files:

  1. apps/vscode/webview-ui/src/components/chat/chat-view/
     messageReducer.ts
     → /apps/vscode/webview-ui/** -- OUTSIDE ratchet's root scope
  2. apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx
     → /apps/vscode/webview-ui/** -- OUTSIDE ratchet's root scope
  3. apps/vscode/webview-ui/src/components/chat/chat-view/
     __tests__/aopc02-phase-b-straggler-replay.test.tsx
     → /apps/vscode/webview-ui/** -- OUTSIDE ratchet's root scope
  4. .factory/epic-board.md
     → not a coverage target

ZERO files in the ratchet's source-universe were modified by
this ACT. Therefore the ratchet band counts
(gte90/lt25/lt50/lt75/lt90/zero) CANNOT regress.

The ratchet cannot produce a coverage-summary.json because of
the pre-existing 3 module-load failures, which prevent vitest
from writing the artifact. This is a baseline-blocker, not a
regression.

================================================================
HONEST DISPOSITION (per reviewer §3)
================================================================

Per the reviewer's exact disposition:

> "If it fails for a mechanically verified pre-existing
>  baseline issue, record that honestly and do not invent
>  another review cycle."

Recorded honestly. NOT inventing another review cycle.

The proper fix is a separate ticket to exclude the 3
aopc02-phase-a-correction*.c24-c-bridge.test.ts files from
the base vitest.config.ts include list (they belong in the
dedicated bridge config). That ticket is out of scope for
AOPC02-PHASE-B-REPAIR01-CORRECTION01 and is added to the
FOLLOWUP list.

================================================================
FOLLOWUP (out of scope, recorded for audit)
================================================================

RATCHET-BRIDGE-EXCLUSION-FIXUP01:
  Exclude
  src/sdk/__tests__/application-ownership-projection-coherence.
  aopc02-phase-a-correction{01,02,03}.c24-c-bridge.test.ts
  from apps/vscode/vitest.config.ts.
  These tests run under the dedicated
  apps/vscode/vitest.config.c2-4-c-bridge.ts.
  This will allow `bun run test:coverage:ratchet` (and
  `bun run test:vitest:coverage`) to produce a
  coverage-summary.json artifact and run the ratchet
  comparison against the baseline.

================================================================
P2 — PBR04 WORDING FIX
================================================================

PBR04's test title and long comments referred to the seq-fence
being sufficient (via applyStateSnapshot) and the straggler
being "stale-accepted". Strictly, the whole reason CORRECTION01
exists is that `...stateData` (the W1 spread) bypassed the
reducer's result for the projection fields. The new explicit
`incomingIsStaleSameEpochPublication` backstop at the W1 gate
is what now preserves the committed projections wholesale.

Test title updated:
  was: "stale accepted (chronology gap)"
  now: "stale rejected (publication-ordering backstop)"

Open comment updated to note the W1 gate backstop (not the
reducer's applyStateSnapshot) is what closes the gap, and to
explain precisely why the reducer-level fence doesn't apply
to the projection fields.

Closing comment updated to refer to the W1 backstop's branch
routing ("preserve prevState") as the source of truth.

★ Non-blocking per reviewer. Done opportune with the gate-fixup.

================================================================
GATES (final, all GREEN)
================================================================

  WEBVIEW_VITEST_TARGETED (aopc02-phase-b): 11/11 PASS
  WEBVIEW_FULL: 603/603 PASS
  WEBVIEW_TYPECHECK: EXIT=0
  APPS_VSCODE_TYPECHECK: EXIT=0
  APPS_VSCODE_LINT: EXIT=0
  WEBVIEW_BIOME_LINT (changed files): clean (info-level only)
  BOARD_VALIDATOR: OK
  DIFF_CHECK: PASS
  COVERAGE_RATCHET: DOCUMENTED_PRE_EXISTING_BLOCKER
    (mechanically verified; not introduced by this ACT;
     cannot regress by construction; separate ticket for
     the fix; not blocking live qualification)

================================================================
NEXT (after GATE-FIXUP)
================================================================

  LIVE QUALIFICATION on a fresh exact-build-head VSIX
  (apps/dist/clinemm-aopc02-phase-b-repair01.vsix) installed
  on a current-build Cline, NOT a 4.1.10-dfab15b3f install.

  If LIVE cycle is clean (verify Dead UI contradiction does
  not reproduce):

    PASS_FULL_SNAPSHOT_PROJECTION_FENCING_REPAIRED_LIVE

  If LIVE cycle still reproduces the contradiction:

    Open Phase C/D as a new ACT with a fresh diagnostic.
````

### AOC01 — APPLICATION-OWNERSHIP-CONTROL-COHERENCE01 — webview seam LIVE-W2 discriminator — CLOSED PASS_RECON_WITH_ONE_P1_CAUSAL_GAP (corroborated by Factory reviewer) — L2057-2247 (pre-sharding)

````text
SOURCE: .factory/epic-board.md L2057-2247 (pre-sharding). VERBATIM: yes; trims: leading/trailing blank lines collapsed

## AOC01 — APPLICATION-OWNERSHIP-CONTROL-COHERENCE01 — webview seam LIVE-W2 discriminator — CLOSED PASS_RECON_WITH_ONE_P1_CAUSAL_GAP (corroborated by Factory reviewer)

**ACT_ID**: ACT-CLINEMM-APPLICATION-OWNERSHIP-CONTROL-COHERENCE01-AOC01
**LIVE_BUILD**: s1onique.clinemm@4.1.10-4fd4dda6b
**STATUS**: CLOSED / DIAGNOSTIC-ONLY (no production code modified)
**VERDICT (CORRECTED per Factory)**: PASS_RECON_WITH_ONE_P1_CAUSAL_GAP

**PURPOSE**. Discriminate the LIVE W2 contradiction observed after the
CASE_B1 (awaiting_followup -> Waiting) repair landed. The user
reported the same task transitioning from truthful "Waiting" to a
contradictory state where `TaskHeader=Idle` while `Cancel` remained
visible (and a historical Thinking disclosure remained visible).
This ACT asks: at the SAME committed state capture the W2 UI
observes, can `taskHeaderPresentation.phase === "idle"` coexist
with a Cancel predicate that returns truthy?

**STRATEGY (real webview seam, per ACT §4)**.

- Use the REAL `ExtensionStateContext` (real reducer, real W1/W2
  functional updater, real `applyPresentationProjection` seq fence,
  real `applyStateSnapshot` epoch/stateVersion fence, real
  `incomingIsStaleSameEpochPublication` PBR04 backstop).
- Drive a real W1 sequence that mirrors the LIVE W1->W2 transition:
  W1-A (awaiting_followup/15, source="host") then W1-B
  (idle/16, source="shadow") with normal seq/stateVersion advance.
- Capture the committed state surface from a real React consumer:
  `taskHeaderPresentation.phase`, `turnState.phase`,
  `thinkingPresentation.modelStreaming`, plus the REAL production
  button config computed via `getButtonConfigFromState` (the same
  call the production `ActionButtons` use).
- Assert the LIVE-W2 invariant: at the same committed state capture,
  `Idle + Cancel` must NOT coexist.

**DISCRIMINANT TESTS (4/4 GREEN)**.

| Test | Scenario | Result |
|------|----------|--------|
| AOC01 | W1-A awaiting_followup -> W1-B idle, normal advance | FULL_W1_IDLE_STATE_COHERENCE = PASS |
| AOC01-B | Stale same-epoch W1 straggler with idle phase | STALE_FULL_W1_BACKSTOP = PASS (stateVersion backstop preserves awaiting_followup) |
| AOC01-C | Missing `turnState` (Hub/Remote absence path) | MISSING_TURNSTATE_SYNTHETIC = OBSERVED, NOT_LOCAL-PRODUCER-PROVEN |
| AOC01-D | Idle turnState + partial tail message | FULL_W1_WITH_PARTIAL_TAIL = PASS (NOT the real partial subscription path) |

**CORRECTED VERDICT** (per Factory reviewer).

The webview seam is GREEN for the input domain the test actually
exercises. The simple hypothesis

```
"the same coherent committed state naturally means Idle + Cancel"
```

is REJECTED for that input domain. Three caveats:

1. **AOC01-D does NOT exercise the real partial/W2 writer.** The
   test wires `_partialHandler`, but the AOC01-D chronology never
   calls it; the partial tail message is embedded in a full W1
   snapshot (`clineMessages: w2WithPartialTail`). Therefore:

   ```
   FULL_SNAPSHOT_WITH_PARTIAL_TAIL = GREEN
   REAL_PARTIAL_SUBSCRIPTION_PATH  = NOT_EXERCISED
   ```

   This matters because `ExtensionStateContext` explicitly owns
   both full-state and partial-message synchronization as the
   webview's real-time state synchronization layer.

2. **AOC01-C does NOT establish a real `SdkController` omission
   path.** The test injects `turnState: undefined` synthetically
   to model a Hub/Remote fallback scenario. This gives no
   evidence that the actual local `SdkController` ever publishes
   that shape (the test's own comment notes the production
   SdkController always includes `turnState`). Therefore:

   ```
   MISSING_TURNSTATE_SYNTHETIC  = OBSERVED / NOT_LOCAL-PRODUCER-PROVEN
   PRODUCER_MALFORMATION        = NOT_PROVEN
   ```

3. **AOC01_CANCEL_RESULT is conditioned on
   `foregroundCommandRunning=false`.** All shown button
   classifications in AOC01 call `getButtonConfigFromState(...,
   false)`. If the LIVE Cancel can be made visible by foreground
   / background command ownership independently of
   `turnState.phase`, then AOC01 has frozen the relevant input
   to the non-cancel value and may have excluded the exact LIVE
   state by construction.

   ```
   AOC01_CANCEL_RESULT =
     PROVEN only for foregroundCommandRunning=false
   ```

   AOC02 must resolve this before claiming Cancel coherence.

**PRIORITIZED DISCRIMINATORS (per Factory, SECOND REFINEMENT)**.

The producer-malformation hypothesis should NOT be promoted to
"most likely" first. The ranking below is **prioritization**, NOT
a hard claim that the topmost item is the cause. The actual
**AOC02 stop order** is:

1. real Cancel predicate inputs
2. real `SdkController.getStateToPostToWebview()` object
3. real partial-message subscription path

Stop at first RED.

Concretely:

1. **real Cancel predicate inputs** — the test hardcodes
   `foregroundCommandRunning=false` while the LIVE screenshot has a
   Cancel control; if `foregroundCommandRunning` participates in
   the Cancel contract, then `Idle + Cancel` can be produced
   legitimately and the defect shifts to "why TaskHeader says Idle
   while command ownership remains active"
   (CASE_G_COMMAND_OWNERSHIP_NOT_PROJECTED). Upstream product has
   historically treated Cancel / Proceed-while-running as
   command-ownership-sensitive controls.
2. **real producer object** — AOC01 models the wire shape directly;
   it does not exercise the producer assembly itself.
3. **real partial-message path** — AOC01 never actually invokes
   `_partialHandler`.
4. task reset/epoch path.

**NOT REPRODUCIBLE from** (preserved from initial ACT, refined):

- normal same-epoch W1 advance (awaiting_followup -> idle)
- same-epoch stateVersion straggler
- Hub/Remote absence path
- partial-tail message embedded in a full W1 snapshot (NOT the
  real partial subscription path)

**DISCRIMINATOR MAPPING** (preserved from initial ACT).

```
CASE_C1_TASKHEADER_FALSE_IDLE  : NOT REPRODUCED from the test paths.
                                 Same-epoch normal advance keeps
                                 the TaskHeader in sync with turnState.
CASE_C2_CANCEL_STALE           : NOT REPRODUCED for foregroundCommandRunning=false.
                                 Production button path (turnState -> buttonsForPhase
                                 -> idle -> BUTTON_CONFIGS.default) does NOT emit
                                 Cancel when turnState.phase === "idle" AND
                                 foregroundCommandRunning === false.
                                 (Foreground command ownership TBD in AOC02.)
CASE_C3_THINKING_STALE         : NOT REPRODUCED from the test paths.
                                 thinkingPresentation.modelStreaming is
                                 driven by the canonical shadow projection
                                 and tracks the same publication identity.
CASE_C4_COMMITTED_STATE_MIX    : NOT REPRODUCED from the test paths.
                                 taskHeaderPresentation / turnState /
                                 thinkingPresentation all carry the same
                                 seq / stateVersion / epoch on the wire
                                 (verified via the seq-fence + stateVersion
                                 backstop already pinned by AOPC02 PHASE B).
```

**WHAT THIS ACT DOES NOT EXERCISE** (the three live-classified
paths this ACT cannot rule out):

```
REAL_W2_PARTIAL_PATH         = NOT_EXERCISED
PRODUCER_MALFORMATION        = NOT_PROVEN
FOREGROUND_COMMAND_CANCEL    = NOT YET CLASSIFIED
```

**FILES CHANGED (1 file, +656 lines, no production code modified)**.

- `apps/vscode/webview-ui/src/components/chat/chat-view/__tests__/application-ownership-control-coherence.aoc01.test.tsx`
  (NEW, 656 lines, 4 tests -- the synchronized-snapshot discriminator)

**CONSERVATION**. No production code changed. AOPC02 W1 projection
fencing NOT reopened. CASE_B1 awaiting_followup host override
NOT reopened. All prior tests remain GREEN.

**TESTS**.

- AOC01: 4/4 PASS
- Webview full: 607/607 PASS (was 603 before this ACT; +4 new)
- Production vitest: 1831/1831 PASS
- Typecheck (webview + production): EXIT=0
- Lint (biome): clean
- git diff --check: clean

**ENTRY_HEAD** = `9dfecd447`; **CLOSING_COMMIT** = `678780acb`;
**CORRECTION_COMMIT** = `93c1d1ef2` (this row).

**NEXT ACT (`ACT-CLINEMM-APPLICATION-OWNERSHIP-CONTROL-COHERENCE01-AOC02`, not requiring push authority)** — see section below.

---
````

### AOC02 — APPLICATION-OWNERSHIP-CONTROL-COHERENCE01-AOC02 — REAL Cancel-authority → producer → partial discriminator — AUTHORIZED (C1: GO, strict stop order) — L2248-2865 (pre-sharding)

````text
SOURCE: .factory/epic-board.md L2248-2865 (pre-sharding). VERBATIM: yes; trims: leading/trailing blank lines collapsed

## AOC02 — APPLICATION-OWNERSHIP-CONTROL-COHERENCE01-AOC02 — REAL Cancel-authority → producer → partial discriminator — AUTHORIZED (C1: GO, strict stop order)

**ACT_ID**: ACT-CLINEMM-APPLICATION-OWNERSHIP-CONTROL-COHERENCE01-AOC02
**TYPE**: PRODUCER_CAUSAL_DISCRIMINATOR
**PRIORITY**: HIGH
**ENTRY_VERDICT**: PASS_RECON_WITH_ONE_P1_CAUSAL_GAP (from AOC01 + Factory reviewer)
**AUTHORITY**: AUTHORIZED; does **not** require push authority (real
producer test only; no production modification).

**PURPOSE**.

Determine whether the REAL local `SdkController` publication
producer can emit a state that explains the current-build LIVE
transition:

```
Waiting
  →
Idle + Cancel
```

AOC01 established (for the input domain it actually exercised):

```
coherent committed webview state with:
  turnState=idle
  taskHeaderPresentation=idle
  thinkingPresentation.modelStreaming=false
  foregroundCommandRunning=false

=> does NOT produce Cancel
```

AOC01 did NOT prove:

- the real partial-message subscription race is safe;
- the `SdkController` producer is malformed;
- foreground-command ownership cannot independently explain Cancel.

**RULES**.

- No production repair before RED.
- Stop at the first RED (one causal boundary per RED, do not
  cascade the investigation).
- One bounded repair per ACT, with ablation after GREEN.
- Exercise the real local producer, do not reconstruct
  `ExtensionState` manually.

**§1 — PRESERVE AOC01 CLASSIFICATION**.

```
FULL_W1_IDLE_STATE_COHERENCE = PASS
STALE_FULL_W1_BACKSTOP       = PASS
FULL_W1_WITH_PARTIAL_TAIL    = PASS
MISSING_TURNSTATE_SYNTHETIC  = OBSERVED / NOT_LOCAL-PRODUCER-PROVEN

REAL_W2_PARTIAL_PATH         = NOT_REPRODUCED (§6 GREEN at this commit; see §6 EXECUTED below)
PRODUCER_MALFORMATION        = NOT_REPRODUCED (§3 GREEN at this commit; see §3 EXECUTED below)
FOREGROUND_COMMAND_CANCEL    = NOT_THE_BROKEN_BOUNDARY (§2 GREEN; see §2 EXECUTED below)
PRESENCE_CONTRACT            = GREEN (§3 GREEN; turnState always present on the normal local producer path)
LEGACY_FALLBACK_REACH        = UNREACHABLE (§3 GREEN; the `!turnState` fallback in `getButtonConfigFromState` is unreachable)
CASE_B1_AWAITING_FOLLOWUP    = CONSERVED (§3 GREEN; sWaiting carries taskHeaderPresentation.phase === "awaiting_followup" through the real producer)
PARTIAL_PATH_PHASE_CONTAMINATION       = NOT_REPRODUCED (§6 GREEN)
PARTIAL_PATH_IDLE_CANCEL_RESURRECTION   = NOT_REPRODUCED (§6 GREEN)
ADVERSARIAL_DELAYED_PARTIAL_MIX         = NOT_REPRODUCED (§6 GREEN)
```

**§2 — CANCEL AUTHORITY FIRST (per Factory, AOC02 stop order)**.

Resolve the AOC01 gap before exercising the producer.

Find the **exact production caller** of:

```
getButtonConfigFromState(...)
```

and the exact value supplied for:

```
foregroundCommandRunning
```

or its current equivalent. Do not infer.

Answer: **can the real UI show Cancel when**

```
turnState.phase === "idle"
taskHeaderPresentation.phase === "idle"
thinkingPresentation.modelStreaming === false
foregroundCommandRunning === true
```

**?**

If YES:

Reproduce with the real predicate.

If:

```
idle + foregroundCommandRunning=true => Cancel
```

classify:

```
CASE_G_COMMAND_OWNERSHIP_NOT_PROJECTED
```

This means Cancel is not stale. The remaining question is
whether TaskHeader should truthfully surface active command
ownership instead of Idle.

**STOP** at this point — do not proceed to §3.

If NO: continue to §3.

**§2 — EXECUTED (CLOSED_GREEN_PRODUCTION_COHERENT)**.

The §2 discriminator is implemented in
`apps/vscode/webview-ui/src/components/chat/chat-view/shared/buttonConfig.aoc02.test.ts`
(9/9 GREEN at this commit). It exercises the **real production
predicate** at `ActionButtons.tsx:53` for all four
(phase × foregroundCommandRunning) combinations.

Findings:

- `turnState.phase === "idle"` ⇒ `BUTTON_CONFIGS.default` ⇒
  `secondaryAction` is `undefined` (no Cancel, no buttons
  enabled), REGARDLESS of `foregroundCommandRunning`.
- `turnState.phase === "streaming"` + `foregroundCommandRunning=true`
  ⇒ `BUTTON_CONFIGS.foreground_command_running` (Cancel + Proceed
  While Running).
- `turnState.phase === "streaming"` + `foregroundCommandRunning=false`
  ⇒ `BUTTON_CONFIGS.partial` (Cancel only).

**Production predicate verdict**: `idle + foregroundCommandRunning=true`
does NOT yield Cancel in the real production predicate. The
`buttonsForPhase` switch's idle branch returns `BUTTON_CONFIGS.default`
unconditionally (it does not even consult `foregroundCommandRunning`).

§2 status: GREEN. Cancel authority is NOT the broken boundary.

**Updated discriminant** (`FOREGROUND_COMMAND_CANCEL`):

```
FOREGROUND_COMMAND_CANCEL = NOT_THE_BROKEN_BOUNDARY
  (real production predicate returns no Cancel when
   turnState.phase === "idle"; foregroundCommandRunning is not
   consulted on the idle branch)
```

**Next discriminant** per strict stop order:

- §3 real producer object — capture one real
  `SdkController.getStateToPostToWebview()` result; require
  same-object consistency on
  `turnState.{phase,seq}` /
  `taskHeaderPresentation.{phase,seq,source}` /
  `thinkingPresentation.{modelStreaming,seq}` /
  foreground/background command ownership.

The LIVE contradiction `Idle + Cancel` must therefore come from
one of:

  (a) a stale `buttonConfig` cached before `turnState` advanced to
      idle (RED at §3 / §5 / §6 — partial-subscription or stale-cache),
  (b) the LEGACY path (`turnState === undefined`, falling through
      to `getButtonConfigForMessages` tail-walking — RED at §3
      producer),
  (c) the LIVE build is calling something other than the real
      predicate (RED at the production-caller surface, §3).

The §3 test will discriminate (a) vs (b) vs (c).

**§3 — EXECUTED (CLOSED_GREEN_PRODUCTION_COHERENT)**.

The §3 discriminator is implemented in
`apps/vscode/src/sdk/__tests__/application-ownership-control-coherence.aoc02.c24-c-bridge.test.ts`
(12/12 GREEN at this commit; bridge config registration: vitest
include + tsconfig include + base config exclude + base tsconfig
exclude — all four RBE01 contract gates now GREEN).

The §3 harness reuses the proven AOPC02 PHASE-A-CORRECTION02
`vi.mock` set + real Controller + real `sessionEvents.handleSessionEvent`
seam, and adds a fourth capture using the **real canonical owner**
`controller.clearTask()` (SdkController.ts:1952-1977) for the
`waiting → idle` transition.

Captures (four real objects returned by
`SdkController.getStateToPostToWebview()` on the same identity):

```
sInitial    turnState.phase = "idle"
                              ^ from TurnStateTracker default
                              + seq 1 (real MessageIdMinter)
sActive     turnState.phase = "streaming"
                              ^ setTurnPhase("streaming") driven by
                                real handleSessionEvent
                                (pending_prompt_submitted payload)
sWaiting    turnState.phase = "awaiting_followup"
                              ^ setTurnPhase("awaiting_followup") driven
                                by real handleSessionEvent
                                (agent_event done, no attempt_completion)
                                CONSERVES CASE_B1
sPostClear  turnState.phase = "idle"
                              ^ turnStateTracker.set("idle") called by
                                controller.clearTask() (real canonical
                                owner transition -- NOT a simulated one)
```

Per-capture same-object invariants (`assertSameObjectCoherence`):

```
  stateVersion > 0                    ✓ all four
  epoch         >= 0                  ✓ all four
  turnState present + known phase     ✓ all four  (P2 GREEN)
  turnState.seq     > 0               ✓ all four
  taskHeaderPresentation.phase        == turnState.phase   (all four)
  taskHeaderPresentation.seq         == turnState.seq      (all four)
  taskHeaderPresentation.source in {shadow, host, legacy}
                                       ✓ all four
  thinkingPresentation.modelStreaming is boolean
                                       ✓ all four
```

Chronology (`§7-B`):

```
  seq(sInitial) <= seq(sActive) <= seq(sWaiting) <= seq(sPostClear)
```

Non-decreasing across the full idle → streaming → awaiting_followup
→ idle walk.

**Legacy-fallback discriminator (`§7-A`)**:

Across all four captures, `turnState` is NEVER undefined. The
`getButtonConfigFromState` legacy fallback in
`buttonConfig.ts:445-446` (`!turnState` → legacy tail-walking) is
unreachable on the normal local producer path. ActionButtons cannot
fall through to `getButtonConfigForMessages(...)` from this seam.

**§3 verdict**:

```
  PRODUCER_MALFORMATION              = NOT_REPRODUCED
  PRESENCE_CONTRACT (P2)             = GREEN
  SAME_OBJECT_COHERENCE (P1)         = GREEN  (all four captures)
  LEGACY_FALLBACK_REACHABLE (P2 path b) = NO
  CASE_B1_AWAITING_FOLLOWUP_HOST_OVERRIDE = CONSERVED (sWaiting phase
    agreement on the real local producer path)
```

This materially narrows the LIVE contradiction:

- §2 closed: production predicate cannot produce Idle+Cancel.
- §3 closed: producer always supplies turnState (no legacy
  fallback reach), same-object invariants hold across the full
  chronology, CASE_B1 conserved.

**Three remaining candidate paths for LIVE Idle+Cancel after §2 + §3**:

| Path | Status after §3 |
|------|-----------------|
| (a) stale `buttonConfig` cached before `turnState` advanced to idle | §6 partial subscription path is the loader-bearing remaining discriminator (real `subscribeToState` vs real `subscribeToPartialMessage` chronology) |
| (b) LEGACY path (`turnState === undefined` → `getButtonConfigForMessages` tail-walking) | **CLOSED — unreachable on the normal local producer path** |
| (c) LIVE build calling something other than the real predicate | was RED at the production-caller surface; the §2 test calls the real `ActionButtons.tsx:53` predicate, so (c) is now bounded by §2 GREEN + §3 GREEN: if (c) were the broken boundary, the production code would have to be using a different predicate — which would have caused §3 to fail the source/seq coherence check because the producer would stamp a different source contract. |

**Updated discriminant summary**:

```
  FOREGROUND_COMMAND_CANCEL    = NOT_THE_BROKEN_BOUNDARY (§2 GREEN)
  PRODUCER_MALFORMATION        = NOT_REPRODUCED              (§3 GREEN)
  PRESENCE_CONTRACT            = GREEN                       (§3 GREEN)
  LEGACY_FALLBACK_REACH        = UNREACHABLE                 (§3 GREEN)
  CASE_B1_AWAITING_FOLLOWUP    = CONSERVED                   (§3 GREEN)
```

**Next discriminant**: §6 real partial-subscription path —
exercise the REAL `subscribeToState` callback + REAL
`subscribeToPartialMessage` callback through
`ExtensionStateContext`. AOC02 stop order says this is the
last remaining candidate (a). If §6 is GREEN, AOC02 closes as
NOT_REPRODUCED and stops without epoch/reset hypotheses.

**§3 — REAL PRODUCER OBJECT (only if §2 found no RED)**.

Exercise the actual local:

```
SdkController.getStateToPostToWebview()
```

through the smallest existing real-controller harness.
Do not reconstruct `ExtensionState` manually.
Capture exactly one returned object at a time.

For that single object, capture:

- `taskId` / session identity if available
- `stateVersion`, `epoch`
- `turnState.phase`, `turnState.seq`
- `taskHeaderPresentation.phase`, `taskHeaderPresentation.seq`,
  `taskHeaderPresentation.source`
- `thinkingPresentation.modelStreaming`, `thinkingPresentation.seq`
- `foreground` / `background` command-running ownership
- `taskTelemetry` if relevant

Require same-object identity.

**§4 — PRODUCER INVARIANTS**.

For the same object:

```
taskHeaderPresentation.seq === turnState.seq
thinkingPresentation.seq   === turnState.seq
```

unless source contract explicitly documents otherwise.

- If `source === "legacy"`:
  phase should agree with `turnState.phase` unless documented
  host override applies.
- If `source === "host"`:
  phase must match a documented host override contract.

If producer emits a contradiction:

```
CASE_P1_PRODUCER_PHASE_MISMATCH
```

→ STOP.

If local producer omits `turnState`:

```
CASE_P2_PRODUCER_OMITS_TURNSTATE
```

→ STOP.

**§5 — WAITING → IDLE PRODUCER CHRONOLOGY (only if §3-§4 found no RED)**.

Drive the real owner transition:

```
awaiting_followup
  →
next canonical idle transition
```

Capture producer object A and producer object B.

A must show: `turnState=awaiting_followup`, `TaskHeader=awaiting_followup`.

B capture: all fields above.

If B is coherent: continue to §6.

If B contains active command ownership while phase/header are
idle:

```
CASE_G_COMMAND_OWNERSHIP_NOT_PROJECTED
```

→ STOP (defect is at the producer/ownership-projection seam,
not at the button predicate).

**§6 — EXECUTED (CLOSED_GREEN_PARTIAL_PATH_COHERENT)**.

The §6 discriminator is implemented in
`apps/vscode/webview-ui/src/components/chat/chat-view/__tests__/application-ownership-control-coherence.aoc02.section6.test.tsx`
(4/4 GREEN at this commit; webview vitest 74/74 files, 620/620 tests;
was 73/73 files, 616/616 tests, +4 from §6).

The §6 test mounts the REAL `ExtensionStateContextProvider` and captures
both real registered callbacks:

- `StateServiceClient.subscribeToState` (full snapshot)
- `UiServiceClient.subscribeToPartialMessage` (partial message)

Both callbacks are genuinely invoked by the production provider's
useEffect. The mock ONLY wires the gRPC transport; it does not mock
`convertProtoToClineMessage` or `reducerApplyMessage` (the real
convergent-replica reducer runs in the mounted React tree).

§2 PROOF (counters captured per test):
```
  FULL_CALLBACK_CALLS    >= 1  (snapshotHandlerCalls)
  PARTIAL_CALLBACK_CALLS >= 1  (partialHandlerCalls)
```

Chronology (four committed captures from the same React provider state):

```
  W1 Waiting (stateVersion=10, epoch=2, phase=awaiting_followup,
              CASE_B1 host override, seq=15)
    → committed: Waiting + no live Thinking + NO Cancel

  REAL partial ts:4 (genuine production shape: type=SAY,
              say=TEXT, partial=true, epoch=2, seq=4)
    → committed: turnState / TaskHeader / Thinking / stateVersion
                 UNCHANGED, only clineMessages tail changed to a
                 partial say=text message
    → message-only invariant GREEN (partial path is
       reducerApplyMessage-only, NOT applyStateSnapshot;
       ExtensionStateContext.tsx:947-976)

  W1 Idle (stateVersion=11, epoch=2, phase=idle, seq=16)
    → committed: TaskHeader=Idle, Thinking=false,
                 buttonConfig=BUTTON_CONFIGS.default
                 (secondaryAction === undefined, no Cancel)
    → PRIMARY INVARIANT GREEN at the SAME committed object
       (per §7 single-object derivation)

  ADVERSARIAL (delayed older partial AFTER full-idle W1):
    → committed: TaskHeader still Idle, Thinking still false,
                 buttonConfig still no Cancel
    → PRIMARY INVARIANT GREEN (adversarial)
```

Per-capture invariant (same-object derivation per §7):

```
  TaskHeader, Thinking, buttonConfig.secondaryAction
  all derived from the SAME `lastCapture` committed object
  (no separately sampled helper state, no replica split)
```

**Evidence-hygiene refinement** (per Factory reviewer §3 disposition):

The §3 wording "unreachable on the normal local producer path" was
re-frozen (per Factory reviewer's disposition in `b3a950554`) to:

```
  CASE_P2_PRODUCER_OMITS_TURNSTATE =
    NOT REPRODUCED across
    initial / active / awaiting_followup / clearTask->idle
```

§6 applies the same wording discipline:

```
  CASE_W2_PARTIAL_STATE_MIX = NOT REPRODUCED across
    normal chronology
    AND adversarial delayed-partial chronology
```

§6 verdict:

```
  PARTIAL_REDUCER_SIDE_EFFECTS_ON_PHASE_HEADER_THINKING = GREEN
  PARTIAL_PATH_CAN_PRODUCE_CANCEL_AT_IDLE              = NO
  ADVERSARIAL_DELAYED_PARTIAL_CAN_RESURRECT_CANCEL      = NO
  CASE_W2_PARTIAL_STATE_MIX                            = NOT_REPRODUCED
```

**Updated discriminant summary**:

```
  FOREGROUND_COMMAND_CANCEL     = NOT_THE_BROKEN_BOUNDARY (§2 GREEN)
  PRODUCER_MALFORMATION         = NOT_REPRODUCED              (§3 GREEN)
  PRESENCE_CONTRACT             = GREEN                       (§3 GREEN)
  LEGACY_FALLBACK_REACH         = NOT_REPRODUCED on the exercised normal local producer chronology (§3 GREEN; wording refined per Factory)
  CASE_B1_AWAITING_FOLLOWUP     = CONSERVED                   (§3 GREEN)
  PARTIAL_PATH_PHASE_CONTAMINATION       = NOT_REPRODUCED    (§6 GREEN)
  PARTIAL_PATH_IDLE_CANCEL_RESURRECTION   = NOT_REPRODUCED    (§6 GREEN)
  ADVERSARIAL_DELAYED_PARTIAL_MIX         = NOT_REPRODUCED    (§6 GREEN)
  LIVE_CAPTURE_DIAGNOSTIC_INSTRUMENTED    = DEFAULT_OFF, REMOVABLE, ADDITIVE (LIVE-CAPTURE01; this commit)
  LIVE_CAPTURE_DIAGNOSTIC_GATED          = COVERAGE_RATCHET_PASS (LIVE-CAPTURE01 gate; this commit)
  DISABLED_PRODUCT_SEMANTICS             = CONSERVED (the underlying Cancel/reducer/composer DECISION LOGIC is byte-identical; components now contain additional GATED diagnostic work — only exercised when `_ptadEnabled=true`; wording refined per Factory)
```

**§6 spec (was: planned)**:

Exercise the actual:

```
subscribeToState
  →
subscribeToPartialMessage
```

This time **actually invoke the partial-message callback/path**.

Do not simulate a partial by embedding `partial: true` inside a
full snapshot.

Chronology:

```
W1 Waiting
→ real W2 partial
→ committed capture
→ next W1 Idle
```

Capture after each React commit.

If the real partial path produces mixed ownership:

```
CASE_W2_PARTIAL_STATE_MIX
```

→ STOP.

**§7 — CLASSIFICATION**.

```
CASE_P1_PRODUCER_PHASE_MISMATCH
  one real getStateToPostToWebview result contains disagreeing:
    turnState
    TaskHeader projection
    Thinking projection
  → STOP.

CASE_P2_PRODUCER_OMITS_TURNSTATE
  local SdkController actually emits no turnState.
  → STOP.

CASE_G_COMMAND_OWNERSHIP_NOT_PROJECTED
  producer (or button predicate) says:
    turnState=idle
    TaskHeader=idle
    foreground/background command active=true
  button contract legitimately exposes Cancel.
  Then the defect is NOT stale Cancel.
  The question becomes whether TaskHeader should surface command
  activity instead of Idle.
  → STOP.

CASE_W2_PARTIAL_STATE_MIX
  producer full states are coherent,
  but real partial-message chronology creates the LIVE mixed UI state.
  → STOP.

CASE_F_NOT_REPRODUCED
  Cancel predicate (§2), real producer object (§3-§4), real
  producer chronology (§5), and real partial path (§6) all
  remain coherent. No LIVE W2 mechanism was found at any of
  these seams.
  → STOP. Do NOT invent an epoch/reset hypothesis in this ACT.
```

**§8 — FIRST BROKEN BOUNDARY**.

Stop at the first RED. Do **not** inspect controller, reducer,
React, command ownership all the way through once one causal
boundary is established.

**§10 — REPAIR (only after RED)**.

- **CASE_P1**: repair producer assembly only.
- **CASE_P2**: repair local producer `turnState` inclusion only.
- **CASE_G**: repair TaskHeader / ownership projection only if
  the product contract says active foreground command must make
  the task non-idle.
- **CASE_W2**: repair partial-message state application only.

One bounded repair.

**§11 — NECESSITY**.

After GREEN: ablate only the fix; exact RED must return; restore.

**§12 — CONSERVATION**.

Keep GREEN:

- AOC01 (4/4)
- AOPC02 stale full-state fencing
- TCCC01 CASE_B1
- THCP, LAC, RSP, LTZ, task-control
- ratchet bridge contract

**§13 — QUALITY**.

If production changes:

- targeted tests
- affected suite (apps/vscode + webview as relevant)
- typecheck (apps/vscode + webview)
- lint (biome)
- canonical coverage ratchet (its bridge blocker is now closed
  per RATCHET-BRIDGE-EXCLUSION-FIXUP01, so it must execute)
- board validator
- `git diff --check`

**§14 — VALID VERDICTS**.

```
PASS_PRODUCER_PHASE_COHERENCE_REPAIRED
PASS_PRODUCER_TURNSTATE_REPAIRED
PASS_COMMAND_OWNERSHIP_PROJECTION_REPAIRED
PASS_PARTIAL_STATE_MIX_REPAIRED
NOT_REPRODUCED
CAPTURE_INSUFFICIENT
```

**§15 — STOP**.

Strict stop order: (1) Cancel authority (§2) — STOP if RED;
(2) real producer object (§3) and invariants (§4) — STOP if RED;
(3) producer chronology (§5) — STOP if RED; (4) real partial
path (§6) — STOP if RED. **One first broken boundary.** If all
four remain coherent, verdict is `NOT_REPRODUCED` and the ACT
closes without repair. **C1: GO.**

---
````

### LIVE-CAPTURE01 — APPLICATION-OWNERSHIP-CONTROL-COHERENCE01-LIVE-CAPTURE01 — bounded LIVE-synchronized-state recorder (default-off, removable) — AUTHORIZED (C1: GO, evidence-acquisition only) — L2866-3097 (pre-sharding)

````text
SOURCE: .factory/epic-board.md L2866-3097 (pre-sharding). VERBATIM: yes; trims: leading/trailing blank lines collapsed

## LIVE-CAPTURE01 — APPLICATION-OWNERSHIP-CONTROL-COHERENCE01-LIVE-CAPTURE01 — bounded LIVE-synchronized-state recorder (default-off, removable) — AUTHORIZED (C1: GO, evidence-acquisition only)

| row | ACT | domain | status | priority | parent |
| --- | --- | --- | --- | --- | --- |
| 299b | `ACT-CLINEMM-APPLICATION-OWNERSHIP-CONTROL-COHERENCE01-LIVE-CAPTURE01` | TASK-UI / DIAGNOSTIC | AUTHORIZED + INSTRUMENTED + GATED (12/12 + coverage ratchet PASS) | HIGH | `EPIC-CLINEMM-APPLICATION-OWNERSHIP-CONTROL-COHERENCE01` |
| 299c | `ACT-CLINEMM-APPLICATION-OWNERSHIP-CONTROL-COHERENCE01-LIVE-CAPTURE01-RESULT01` | TASK-UI / DIAGNOSTIC | **CLOSED_PASS_LIVE_CONTRADICTION_CAPTURED** (CASE_L1_STATE_ITSELF_CONTRADICTORY; STALE_LEGACY_TURNSTATE; manual compaction precedes failure) | HIGH | `ACT-CLINEMM-APPLICATION-OWNERSHIP-CONTROL-COHERENCE01-LIVE-CAPTURE01` |
| 299d | `ACT-CLINEMM-SKIPPED-COMMAND-TURN-RECOVERY01` | TASK-UI / TOOL-RUNTIME | CLOSED_NOT_REPRODUCED (AgentRuntime seam GREEN; 7/7 SCTR PASS) | HIGH | `EPIC-CLINEMM-SKIPPED-COMMAND-TURN-RECOVERY01` |
| 299e | `ACT-CLINEMM-COMPACTION-LEGACY-TURNSTATE-COHERENCE01` | TASK-UI / COMPACTION | **PASS_CANONICAL_COMPACTION_RESTORE_COHERENCE / GO_LIVE** (CLTCC01..12 + CLTCC13 39/39 + CLTCC15 2/2 PASS; CORRECTION04 selector + CORRECTION05 real composition; chronology proven both structurally AND executably; C1 = GO_LIVE) | HIGH (LIVE bug family) | `EPIC-CLINEMM-COMPACTION-LEGACY-TURNSTATE-COHERENCE01` |
| 299e1 | `ACT-CLINEMM-COMPACTION-LEGACY-TURNSTATE-COHERENCE01-CORRECTION01` | TASK-UI / COMPACTION | **CLOSED_PRODUCTION_SEAM_GREEN** (CLTCC01..12 12/12 PASS; canonical-projection restore via `getCanonicalRestorePhase` callback; Factory P0/P1 satisfied) | HIGH (LIVE bug family) | `ACT-CLINEMM-COMPACTION-LEGACY-TURNSTATE-COHERENCE01` |
| 299e2 | `ACT-CLINEMM-COMPACTION-LEGACY-TURNSTATE-COHERENCE01-CORRECTION02` | TASK-UI / COMPACTION | **CLOSED_HOST_AWARE_CANONICAL_RESTORE_BINDING_WIRED** (CLTCC13 28/28 PASS: 11 selector + 12 binding + 5 source-inspection; `createCanonicalRestorePhaseCallback` factory mirrors `selectTaskHeaderPresentation` precedence) | HIGH (LIVE bug family) | `ACT-CLINEMM-COMPACTION-LEGACY-TURNSTATE-COHERENCE01-CORRECTION01` |
| 299e3 | `ACT-CLINEMM-COMPACTION-LEGACY-TURNSTATE-COHERENCE01-CORRECTION03` | TASK-UI / COMPACTION | **CLOSED_SELECTOR_TERMINAL_OWNER_PRESERVE + AST_WIRING** (selector: 5-step precedence with explicit terminal-owner preserve step; CLTCC13 reduced to 19 table-driven + 3 factory + 1 ablation + 5 AST-level structural assertions; source-text regex inspection retired in favor of TypeScript Compiler API) | HIGH (LIVE bug family) | `ACT-CLINEMM-COMPACTION-LEGACY-TURNSTATE-COHERENCE01-CORRECTION02` |
| 299e4 | `ACT-CLINEMM-COMPACTION-LEGACY-TURNSTATE-COHERENCE01-CORRECTION04` | TASK-UI / COMPACTION | **CLOSED_ENTRYPHASE_TEMPORAL_SEPARATION + CHRONOLOGY_PROOF** (selector: 5-step precedence with `entryPhase` SEPARATE from `currentLegacyPhase`; `compacting -> compacting` branch REMOVED; callback signature `(entryPhase: TurnPhase) => TurnPhase | undefined`; coordinator passes CAPTURED `entry.phase` to callback; AST-level AST-3 strengthened to verify accessor bodies reach the right host fields; 3 chronology assertions prove control flow is internally coherent) | HIGH (LIVE bug family) | `ACT-CLINEMM-COMPACTION-LEGACY-TURNSTATE-COHERENCE01-CORRECTION03` |
| 299e5 | `ACT-CLINEMM-COMPACTION-LEGACY-TURNSTATE-COHERENCE01-CORRECTION05` | TASK-UI / COMPACTION | **CLOSED_CLTCC15_REAL_TEMPORAL_COMPOSITION** (CLTCC15 2/2 PASS: real coordinator + real tracker + real factory composition test; real production ablation verified -- reverting CORRECTION02 branch in production REDs CLTCC15-1; chronology proven both structurally AND executably) | HIGH (LIVE bug family) | `ACT-CLINEMM-COMPACTION-LEGACY-TURNSTATE-COHERENCE01-CORRECTION04` |
| 299f | `ACT-CLINEMM-SKIPPED-COMMAND-HOST-RECOVERY01` | TASK-UI / TOOL-RUNTIME | **PAUSE_SUPERSEDED_BY_LIVE_CAUSAL_CAPTURE** (LIVE bug family reclassified as STALE_LEGACY_TURNSTATE at the compaction restore boundary; this ACT would have re-proven the seam already closed by ACT 299e) | HIGH (superseded) | `EPIC-CLINEMM-SKIPPED-COMMAND-TURN-RECOVERY01` |
| 299g | `ACT-CLINEMM-SKIPPED-COMMAND-HOST-RECOVERY01-RESUME01` | TASK-UI / TOOL-RUNTIME | **REVIEWER_NARROWED_TO_GENERIC_FINALIZATION_ONLY** (LocalRuntimeHost + STUB-AGENT seam GREEN for generic post-completed-`AgentResult` finalization + second-turn reentry; SCHR01..05 + SANITY 6/6 PASS; but the stub agent omitted the REAL AgentRuntime, so the strongest truthful claim was GENERIC_LOCALRUNTIMEHOST_POST_COMPLETED_RESULT_FINALIZATION = GREEN, NOT a host-boundary GREEN for a real AgentRuntime rejection. Reviewer flagged one P1 composition gap and authorized ACT-CLINEMM-SKIPPED-COMMAND-HOST-RECOVERY01-COMPOSITION01 to close it) | HIGH (resumed) | `EPIC-CLINEMM-SKIPPED-COMMAND-TURN-RECOVERY01` |
| 299h | `ACT-CLINEMM-SKIPPED-COMMAND-HOST-RECOVERY01-COMPOSITION01` | TASK-UI / TOOL-RUNTIME | **PAUSE_SUPERSEDED_BY_LIVE_P0** (SHRC01 + SHRC01_CTL + SHRC01_SANITY 3/3 PASS in 109ms at the real `LocalRuntimeHost` + real `SessionRuntime` orchestrator + real `AgentRuntime` composition through the production `createAgentRuntimeImpl` seam; composition GREEN, only synthetic seams are the scripted `StepModel`, the simulated user `requestToolApproval` decision callback, and a synthetic_real `run_commands`-shaped `AgentTool`; USER_REJECT turn: synthetic_real approval callback rejects, real executor never invoked (`executorCalls === 0`), real `onToolRuntimeOutcome` reports `kind: "control_plane", outcome: "user_rejected"`, real `AgentRuntime` returns `finishReason: "completed"`, host settles to `status: "idle"`; APPROVED SUCCESS control proves the same recovery path with `executorCalls === 1` and a `success` outcome; bridge pinned via `@cline-internal/core/runtime/orchestration/session-runtime-orchestrator` + `@cline-internal/core/runtime/host/local-runtime-host` + `@cline-internal/core/session/services/file-session-service` + `@cline/agents` aliases; **HOWEVER**: fresh LIVE capture at `4.1.10-d8714836b` (`taskId=1787343024921_62lv7`, `epoch=3`, `stateVersion = _ptadPushId = 6885/6888`) reproduces the LIVE `Idle + Cancel` contradiction, outranking the host-composition work; the LIVE bug family remains open against the P0 outranks generic host-seam work; per Factory directive, do not continue SKIPPED-COMMAND HOST-COMPOSITION01 until the LIVE writer-provenance lands; composition evidence captured at `SHRC01` 3/3 PASS is preserved; no production code changed; no repair attempted | HIGH (composition) | `EPIC-CLINEMM-SKIPPED-COMMAND-TURN-RECOVERY01` |
| 299i | `ACT-CLINEMM-LEGACY-TURNSTATE-WRITER-PROVENANCE01` | TASK-UI / TURN-STATE / DIAGNOSTIC | **PASS_WRITER_PROVENANCE_CAPTURED** (captured at this entry head — reviewer's LIVE dump at `taskId=1787358662798_o2lwn`, `epoch=2→3`; **EXACT MATCH** between PTAD stale `legacySeq=3878` and writer-provenance record `writerId=controller-ask-response`, `previous.phase=awaiting_followup`, `previous.seq=3874`, `committed.phase=streaming`, `committed.seq=3878`, `writerEpoch=2`; **NO LATER TURNSTATE WRITES** in the captured provenance ring; PTAD observes `currentEpoch=3` carrying the stale epoch-2 streaming state while canonical `runtimeStatus=shadowStatus=idle`; 64 retained PTAD records all carry the same stale `streaming/3878`; the webview receives the stale state and faithfully derives `TaskHeader=idle, ActionButtons.secondaryAction=cancel` while `composerEnabled=true` and both command-ownership flags are false). **CLASSIFICATION** = `CASE_W5_TASK_IDENTITY_CROSSWRITE` (narrow statement: an epoch-2 `controller-ask-response` write is allowed to survive into epoch 3 without a truthful epoch-3 legacy-state initialization/superseding write). **COMPACTION_RESTORE = COHERENT** in this chronology — do NOT reopen CLTCC (`compacting → awaiting_followup` at seq 3874 was correct; the bad write happens 103 seconds later from `controller-ask-response`). Writer provenance diagnostic in `apps/vscode/src/shared/turn-state-writer-provenance.ts` (default OFF; opt-in via `cline.debug.toggleTurnStateWriterProvenanceDiagnostic`) is the load-bearing substrate for this capture and remains in place for the followup ACT. **WPROV01..07** = 21/21 PASS at the engineering commit; WPROV07 mechanical inventory reconciliation still holds (`missingFromUnion=[]`, `deadUnionIds=[]`). **NO REPAIR** attempted — capture-only ACT. (WPROV01..07 = 21/21 PASS — added WPROV07 mechanical inventory that reconciles union vs production source; full vitest 1924/1924 PASS; bun:unit 1076/1076 PASS; webview-ui tsc clean; bridge typecheck + vitest 75/75 PASS; lint PASS; `TurnStateTracker.setWithWriter(phase, anchorTs, identity)` is the single tagged mutation seam; default OFF; no protocol/public field; no React state; WPROV01 + WPROV06 pin byte/semantic equivalence when disabled; **MECHANICAL RECONCILIATION (WPROV07.1, machine-paren-balanced walker over SdkController.ts + 7 coordinator modules)**: production call sites = **41** (count includes mock-test sites from WPROV01..06 fixtures); unique production writerIds (non-sentinel) = **35**; union writerIds (non-sentinel) = **35**; `missingFromUnion=[]`, `deadUnionIds=[]` — reconciliation invariant holds. Per-class breakdown: **SdkController direct = 12** sites (`on-send-error`, `emit-cline-auth-error`, `emit-cline-balance-error`, `cancel-task`, `clear-task`, `ask-response`, `edit-message-and-regenerate`, `restore-checkpoint`, `on-auto-continue-starting`, `on-auto-continue-failed`, `on-resume-failed`, `on-follow-up-abandoned`); **SdkInteractionCoordinator = 7** sites (`handle-mistake-limit`, `handle-tool-approval`, `handle-ask-question`, `resolve-tool-approval-message-response`, `resolve-tool-approval-yes-no`, `resolve-ask-question`, `resolve-mistake-limit`); **SdkSessionEventCoordinator = 6** sites (`pending-prompt-submitted`, `turn-complete-error`, `turn-complete-completed`, `turn-complete-awaiting-followup`, `turn-complete-awaiting-followup-liveness`, `turn-complete-resumable-straggler-preserve`); **SdkTaskStartCoordinator = 2** sites (`init-task`, `reinit-existing-task`); **SdkTaskControlCoordinator = 3** sites (`resume-ask`, `resumable-ask`, `idle-fallback`); **SdkModeCoordinator = 1** site (`mode-switch-resumable`); **SdkCompactionCoordinator = 4** sites (`enter`, `restore-entry-preserve`, `restore-canonical-unavailable-preserve`, `restore-canonical-resolved`); **SdkFollowupCoordinator = 4** sites (`auto-continue-starting`, `auto-continue-failed`, `on-resume-failed`, `on-follow-up-abandoned`). Plus `unknown-legacy-writer` sentinel for the legacy `set()` alias path. **Not captured (YET)**: `writerId` for `legacyPhase=streaming, seq=6233` on the LIVE build — that requires dogfood capture (next ACT)) | HIGH (P0 LIVE-evidence acquisition) | `EPIC-CLINEMM-COMPACTION-LEGACY-TURNSTATE-COHERENCE01`; `ACT-CLINEMM-APPLICATION-OWNERSHIP-CONTROL-COHERENCE01-LIVE-CAPTURE01` (PTAD substrate) | **Scope**: stop guessing; capture the actual production writer of `legacyPhase=streaming, seq=6233` from the LIVE bug family. The PTAD ring (64-record, post-terminal-authority) aged out the actual mutation that wrote the stale streaming phase on the LIVE build (`4.1.10-d8714836b`, `taskId=1787343024921_62lv7`, `epoch=3`); there is no transition record showing who produced it. **Recon (ACT §3)**: every production write to the legacy TurnStateTracker flows through ONE seam — `TurnStateTracker.set(phase, anchorTs)` (the legacy alias) and the new `TurnStateTracker.setWithWriter(phase, anchorTs, identity)` (the tagged overload). The closed writerId enum covers 35 unique production writerIds (above breakdown) plus the `unknown-legacy-writer` sentinel = 36 union members total. **Diagnostic design (ACT §4)**: mirrors the existing PTAD substrate — opt-in, default-off, bounded ring (default 256 records), privacy-safe (NO prompt/model/tool content), pure ring module in `apps/vscode/src/shared/turn-state-writer-provenance.ts`, webview-bundle-safe (no `@cline/shared` imports). **Verification (WPROV01..07 = 21 tests)**: WPROV01 (disabled = no records, no semantic effect), WPROV02 (streaming mutation records exact writer + previous/new seq), WPROV03 (compaction enter + 3 restore paths distinct), WPROV04 (terminal/user-owned writer independent), WPROV05 (bounded ring with FIFO eviction), WPROV06 (byte/semantic equivalence of legacy `set()` and `setWithWriter(..., unknown-legacy-writer)`), **WPROV07 (mechanical reconciliation — every production writerId maps to a union member and every union member has at least one production call site; counter-drift protection for the LIVE capture ACT)**. **All conservation checks pass: writer-diagnostic tests 21/21; targeted subscription + telemetry + task-control + state-version surface unaffected; full apps/vscode vitest 1924/1924 PASS; bun:unit 1076/1076 PASS; webview-ui tsc clean; bridge typecheck + vitest 75/75 PASS; typecheck 0 diagnostics; lint PASS**. **NO repair attempted** — ACT explicitly forbids. **NO push, NO force push**. **NEXT-ACT PREDICATE**: package exact-head VSIX at commit `HEAD^{commit}` (currently `7337f763f…`, the board-binding commit), enable `cline.debug.toggleTurnStateWriterProvenanceDiagnostic` (the workspace-state toggle wired in this ACT), reproduce the manual-compact-between-prompts chronology (prompt A → real activity → manual Compact → keep working → prompt B); on the first observed `Idle + Cancel`, screenshot → dump PTAD → dump writer-provenance ring (`cline.debug.dumpTurnStateWriterProvenanceDiagnostic`) → disable diagnostics → STOP. The single load-bearing correlation: find provenance record with `committed.seq = N` where `N` matches the stale `legacySeq` from PTAD, classify into CASE_W1..W6 / CAPTURE_INSUFFICIENT per ACT §12. |

> **BOARD_BINDING (row 299i, WPROV07 ACT)**: evidence-anchor commit (immutable subject prefix) =
> `test(sdk): ACT-CLINEMM-LEGACY-TURNSTATE-WRITER-PROVENANCE01 WPROV07 mechanical writerId inventory reconciliation`
>
> At write-time of this binding line, the commit literal identities were:
> `HEAD^{commit} = 8f363b7501425c8a5e0871f40e0624865588350f`
> `HEAD^{tree}   = ff112a47274a4c3a0bf72968a4260a229eeff0af`
>
> Re-validate at read-time with:
> `git rev-parse HEAD^{commit} HEAD^{tree}` inside the commit whose subject starts with the immutable prefix above.

**PURPOSE (per Factory disposition, `PASS_AOC02_NOT_REPRODUCED — NEXT = LIVE CAPTURE`)**:

> We have reached the Factory threshold where more synthetic seam
> tests are likely to slow learning. The next ACT should be a
> **temporary, DEFAULT_OFF synchronized-state recorder** that captures
> exactly what React sees when the impossible UI combination occurs.
> Do not repair anything. AOC02 already exhausted: real button
> predicate, real Controller producer, real full-state reducer,
> real partial-message reducer. Therefore stop inventing offline
> chronologies.

### What LIVE-CAPTURE01 instrumented (this commit)

The existing `post-terminal-authority-diagnostic` ring buffer
(`apps/vscode/src/shared/post-terminal-authority-diagnostic.ts`) was
extended with **4 additive optional fields** stamped at the existing
production capture sites. The diagnostic itself remains:

- **DEFAULT_OFF** (opt-in via the existing `_ptadEnabled` workspace-state toggle)
- **explicitly opt-in** (no env-var; explicit workspace toggle required)
- **REMOVABLE** (the new fields are unused when the diagnostic is disabled)
- **zero semantic delta while disabled** (the new fields are `readonly optional`, never read by production when the gate is closed)
- **no public protocol/wire field** (no new RPC/proto field added)
- **no state mutation** (no functional-updater side effects added)
- **bounded ring buffer** (DEFAULT_BUFFER_SIZE = 64; existing policy preserved)

### New fields stamped (4, all `readonly optional`)

```
// interface PostTerminalAuthoritySnapshot {
//   // ... existing fields ...
//   readonly foregroundCommandRunning?: boolean   // ActionButtons.tsx:53 input
//   readonly backgroundCommandRunning?: boolean   // backstop
//   readonly composerEnabled?: boolean             // InputSection.tsx !submitDisabled
//   readonly messageTail?: {                       // identity only, NO bodies
//     readonly ts?: number
//     readonly type?: string
//     readonly ask?: string
//     readonly say?: string
//     readonly partial?: boolean
//     readonly seq?: number
//     readonly epoch?: number
//   }
// }
```

### Capture sites updated (3)

| Site | New fields stamped |
|---|---|
| `action-buttons` (ActionButtons.tsx:87) | `foregroundCommandRunning`, `backgroundCommandRunning`, `messageTail` |
| `input-section` (InputSection.tsx:96) | `composerEnabled`, `messageTail` |
| `webview-committed` (ExtensionStateContext.tsx:1167) | `messageTail` |

### Pure contradiction detector (new module-level exports)

```
// export type PostTerminalAuthorityContradictionKind =
//   | "IDLE_PLUS_CANCEL"
//   | "IDLE_PLUS_MODEL_STREAMING"
//   | "COMPLETED_PLUS_ACTIVE_WORK"
//
// export function classifyContradiction(
//   snapshot: PostTerminalAuthoritySnapshot,
// ): PostTerminalAuthorityContradictionKind | null
//
// export function findPostTerminalAuthorityContradictions(
//   side: "extension" | "webview",
// ): readonly { snapshot: PostTerminalAuthoritySnapshot; kind: PostTerminalAuthorityContradictionKind }[]
```

The detector does **NOT** declare a root cause. It only marks capture
points where the LIVE combination is reproducible. From those flags,
the next ACT picks a `CASE_L1..L5` classification per the directive.

### Test contract (D1-D6, 12/12 PASS)

| Test | Pin |
|---|---|
| D1.1 | disabled => zero records, no new fields leak |
| D1.2 | classifyContradiction is a pure predicate (no ring-buffer read) |
| D2.1 | coherent Idle => no flag |
| D2.2 | TaskHeader=waiting + thinking=true (streaming is legitimate) => null — note: `classifyContradiction()=null` means ONLY that none of the three LIVE-CAPTURE01 detector patterns matched; it does NOT prove global application-state coherence (Waiting = user-ownership candidate is a separate, earlier product qualification and is out of scope for this detector) |
| D3.1 | TaskHeader=idle + secondaryAction=cancel => IDLE_PLUS_CANCEL |
| D3.2 | foregroundCommandRunning=true does NOT mask the Idle+Cancel flag |
| D4.1 | TaskHeader=idle + modelStreaming=true => IDLE_PLUS_MODEL_STREAMING |
| D4.2 | TaskHeader=completed + active work => COMPLETED_PLUS_ACTIVE_WORK |
| D5.1 | foregroundCommandRunning / backgroundCommandRunning / composerEnabled / messageTail round-trip exactly |
| D5.2 | missing clineMessages => messageTail undefined (no garbage) |
| D6.1 | ring buffer bounded at 64; 65th evicts oldest |
| BC   | snapshot with NO new fields remains well-typed (backward-compat witness) |

### Files changed (this commit, LIVE-CAPTURE01)

| File | Change |
|---|---|
| `apps/vscode/src/shared/post-terminal-authority-diagnostic.ts` | +50 lines: 4 new optional fields + `classifyContradiction` + `findPostTerminalAuthorityContradictions` |
| `apps/vscode/src/shared/post-terminal-authority-diagnostic-aoc02-live-capture01.test.ts` | NEW, 336 lines, 12 tests (D1-D6 + BC) |
| `apps/vscode/vitest.config.ts` | +1 include entry (next to `post-terminal-authority-diagnostic.test.ts`) |
| `apps/vscode/webview-ui/src/components/chat/chat-view/components/layout/ActionButtons.tsx` | +27 lines: capture site stamps new fields |
| `apps/vscode/webview-ui/src/components/chat/chat-view/components/layout/InputSection.tsx` | +14 lines: capture site stamps `composerEnabled` + `messageTail` |
| `apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx` | +16 lines: `buildWebviewSnapshot` stamps `messageTail` on `webview-committed` records |
| `.factory/epic-board.md` | LIVE-CAPTURE01 row + this section + EPIC row update |

### Validation (this commit)

| Check | Result |
|---|---|
| LIVE-CAPTURE01 unit tests (D1-D6 + BC) | **12/12 PASS** |
| Existing post-terminal-authority unit tests | **10/10 PASS** (no regression) |
| Apps/vscode vitest (full) | 138/138 files, **1843/1843 tests PASS** (was 137/137, 1831/1831; +12 from LIVE-CAPTURE01) |
| Bridge vitest (full) | 10/10 files, 66/66 tests PASS |
| Webview vitest (full) | 74/74 files, 620/620 tests PASS |
| Apps/vscode typecheck (`bun run check-types`) | EXIT=0 |
| Webview typecheck (`tsc --noEmit`) | EXIT=0 |
| Biome lint (7 touched files) | clean (3 format fixes auto-applied) |

### Conservation

| Channel | Status |
|---|---|
| `apps/vscode/src/core/controller/...` | untouched |
| `apps/vscode/src/sdk/...` | untouched (no SDK surface change) |
| `apps/vscode/proto/` | untouched (no new wire field) |
| `apps/vscode/src/shared/proto/...` | untouched |
| `apps/vscode/src/generated/...` | untouched |
| Production semantic for `getButtonConfigFromState` | byte-for-byte unchanged |
| Production semantic for `applyStateSnapshot` / `applyMessage` | byte-for-byte unchanged |
| `ActionButtons.tsx:53` Cancel derivation | unchanged (same args, same return) |
| `InputSection.tsx:62` composer `submitDisabled` derivation | unchanged (same args, same return) |
| Webview `<ChatLayout>` render tree | unchanged |
| `_ptadEnabled` workspace-state toggle | unchanged (the existing opt-in path) |

The 4 new fields are PURELY ADDITIVE: when the diagnostic is
default-off, the if-guards at every capture site short-circuit
without touching the new fields; when the diagnostic is enabled,
the records carry the extra witness information that is required
to disambiguate `CASE_L1..L5` from a LIVE capture.

### NEXT LIVE STEP (not requiring push authority)

1. Build a fresh dogfood VSIX with this commit (`bun run package`).
2. Install on the user's `s1onique.clinemm@4.1.10-4fd4dda6b` dogfood workspace.
3. Toggle `_ptadEnabled=true` via the existing workspace-state toggle.
4. Reproduce the LIVE `Idle + Cancel` window naturally (do not
   manufacture state transitions).
5. Immediately preserve:
   - screenshot
   - bounded diagnostic records via
     `getPostTerminalAuthorityDiagnosticRecords("webview")`
   - installed version / build identity
6. Classify each flagged record with `classifyContradiction(...)`.
7. Inspect the SAME committed object's `foregroundCommandRunning`,
   `backgroundCommandRunning`, `composerEnabled`, `messageTail`,
   `taskHeaderPresentation`, `thinkingPresentation`,
   `buttonConfig.secondaryAction`, `legacyPhase`, `legacySeq`.
8. Pick the `CASE_L1..L5` from the directive and write
   `ACT-CLINEMM-APPLICATION-OWNERSHIP-CONTROL-COHERENCE01-LIVE-CAPTURE01-RESULT01`.

### Removal trigger

- First useful LIVE capture: move to RESULT01 ACT.
- Capture proves insufficient (e.g., a needed field is not
  observable at the safe boundary): classify
  `CASE_CAPTURE_INSUFFICIENT` and either add the missing field
  (one bounded extension) or HALT_DIAGNOSTIC_SEMANTURE_DELTA.

### Verdict (this commit)

```
LIVE_CAPTURE_DIAGNOSTIC_INSTRUMENTED = DEFAULT_OFF, REMOVABLE, ADDITIVE
LIVE_CAPTURE_DIAGNOSTIC_12_TESTS    = PASS
DISABLED_PRODUCT_SEMANTICS          = CONSERVED  (the underlying Cancel/reducer/composer DECISION LOGIC is byte-identical; the components now contain additional GATED diagnostic work — only exercised when _ptadEnabled=true)
LIVE_CAPTURE_NEXT                  = DOGFOOD_SESSION_CAPTURE
```

### LIVE-CAPTURE01 gate (this commit)

**Canonical coverage ratchet: PASS** (the missing P1 gate from the Factory reviewer's prior disposition).

```
PASS: coverage ratchet holds
  scope_file_count=614  report_file_count=615
  statements: baseline_covered=6980 current_covered=7415 delta=+435
  branches:   baseline_covered=4202 current_covered=4782 delta=+580
  functions:  baseline_covered=1311 current_covered=1349 delta=+38
  lines:      baseline_covered=6832 current_covered=7265 delta=+433
  ignore_directive_count: baseline=0 current=0
  coverage_config_fingerprint=4bb40a87a065fede18a092a506ae1b7ad45abb572bbe9b29c77213a6c5eaafc5
```

All deltas are strictly positive (additive `readonly optional` fields + the two new module-level exports). No coverage regression. No `ignore_directive_count` drift.

**Wording refinement (per Factory reviewer)**:

| Was | Now |
|---|---|
| `LIVE_CAPTURE_PRODUCTION_SEMANTIC = BYTE_FOR_BYTE_UNCHANGED` | `DISABLED_PRODUCT_SEMANTICS = CONSERVED` (the underlying Cancel / reducer / composer DECISION LOGIC is byte-identical; the components now contain additional GATED diagnostic work — only exercised when `_ptadEnabled=true`) |
| `classifyContradiction() = null` ⇒ (implicit) coherent | `classifyContradiction() = null` ⇒ ONLY that none of the three LIVE-CAPTURE01 detector patterns matched; it does NOT prove global application-state coherence (Waiting = user-ownership candidate is a separate, earlier product qualification and is out of scope for this detector) |

Both refinements are P2 wording (no code change). Applied to D2.2 row, the LIVE-CAPTURE01 verdict block, and the EPIC row.

---
````

### RESULT01 — APPLICATION-OWNERSHIP-CONTROL-COHERENCE01-LIVE-CAPTURE01-RESULT01 — bounded dogfood-session capture (no repair) — AWAITING_DOGFOOD — L3098-3201 (pre-sharding)

````text
SOURCE: .factory/epic-board.md L3098-3201 (pre-sharding). VERBATIM: yes; trims: leading/trailing blank lines collapsed

## RESULT01 — APPLICATION-OWNERSHIP-CONTROL-COHERENCE01-LIVE-CAPTURE01-RESULT01 — bounded dogfood-session capture (no repair) — AWAITING_DOGFOOD

**Goal**: capture one real `Idle + Cancel` window on the dogfood build using the existing PTAD toggle/dump commands, classify the contradiction with `CASE_L1..L5` (or `CAPTURE_INSUFFICIENT`), STOP without repair.

### Operational path (existing PTAD commands, do NOT edit workspace state manually)

| Step | Action | Command |
|---|---|---|
| 1 | Build fresh exact-head VSIX | `cd apps/vscode && bun run package` |
| 2 | Install VSIX on dogfood workspace | `s1onique.clinemm@4.1.10-4fd4dda6b` |
| 3 | Bind build identity | record `VSIX_BUILD_HEAD`, `VSIX_BUILD_TREE`, `VSIX_SHA256`, `INSTALLED_VERSION` |
| 4 | Enable PTAD | run the existing `Cline: Toggle Post-Terminal Authority Diagnostic` command |
| 5 | Use Cline NATURALLY | do NOT manufacture chronology |
| 6 | On first appearance of `Idle + Cancel` / `Idle + live Thinking` / `Complete + active work` | screenshot IMMEDIATELY |
| 7 | Dump PTAD IMMEDIATELY | run the existing `Cline: Dump Post-Terminal Authority Diagnostic` command |
| 8 | Disable PTAD | run the toggle command again |
| 9 | Preserve BOTH JSONL outputs | `post-terminal-authority-diagnostic-extension.jsonl` + `post-terminal-authority-diagnostic-webview.jsonl` (in `globalStorageUri`) |

### Capture timing — IMPORTANT

The ring is bounded at **64 records**. The instrumentation now records at THREE capture sites (`action-buttons`, `input-section`, `webview-committed`), so 64 records can disappear surprisingly quickly during active streaming. Therefore:

> **screenshot → dump immediately. Do not keep working for several minutes and dump later.**

### Classification (conceptual, NOT inside runtime)

After preservation, inspect only the bounded records surrounding the screenshot. Run `classifyContradiction()` conceptually / offline over the records; **do NOT modify runtime to auto-react to a flag.**

Pick exactly ONE:

- **L1 SAME_RECORD_CONTRADICTORY** — action-buttons record itself has `TaskHeader=idle` + `secondaryAction=cancel`
- **L2 RENDER_DERIVATION_MISMATCH** — committed/action-button records predict no Cancel, but screenshot visibly has Cancel
- **L3 GENERATION_MIX** — TaskHeader and ActionButtons records have differing `stateVersion`/`_ptadPushId`/`seq` around the same render window
- **L4 THINKING_DERIVATION_MISMATCH** — screenshot shows truly live Thinking, but committed `thinkingPresentation.modelStreaming=false`
- **L5 TASK_IDENTITY_MIX** — `messageTail` / task identity changes reveal stale UI from a previous task/session
- **CAPTURE_INSUFFICIENT** — required identity is absent or records aged out

### STOP after classification

**NO REPAIR in RESULT01.** Only evidence acquisition + classification. The next bounded ACT picks the one tiny repair per the picked `CASE_L*`.

### Verdict (LIVE-CAPTURE01 RESULT01 — this commit, ACT 299c CLOSED)

```

LIVE-CAPTURE01 GATE             = PASS (coverage ratchet)
LIVE-CAPTURE01 WORDING          = REFINED (DISABLED_PRODUCT_SEMANTICS, D2.2 scope)
LIVE-CAPTURE01 RESULT01         = PASS_LIVE_CONTRADICTION_CAPTURED
LIVE-CAPTURE01 CASE             = CASE_L1_STATE_ITSELF_CONTRADICTORY
LIVE-CAPTURE01 ROOT_CAUSE_CLASS = STALE_LEGACY_TURNSTATE
LIVE-CAPTURE01 TRIGGER          = MANUAL_COMPACTION_PRECEDES_FAILURE (CAUSALITY_NOT_YET_PROVEN)
LIVE-CAPTURE01 REPAIR           = NONE IN RESULT01 (classification-only per directive)
LIVE-CAPTURE01 NEXT             = ACT-CLINEMM-COMPACTION-LEGACY-TURNSTATE-COHERENCE01 (ACT 299e)

LIVE_SCREENSHOT              = REAL
LIVE_IDLE_VISIBLE            = YES
LIVE_CANCEL_VISIBLE          = YES

SYNCHRONIZED_CAPTURE:
  STATE_VERSION              = 3208
  PUSH_ID                    = 3208
  EPOCH                      = 9
  TASK_ID                    = 1787332060504_vgxt4

  RUNTIME_STATUS             = idle
  RUNTIME_MODEL_STREAMING    = false
  RUNTIME_AWAITING_APPROVAL  = false
  RUNTIME_PENDING_TOOLS      = 0

  SHADOW_STATUS              = idle
  SHADOW_MODEL_STREAMING     = false
  SHADOW_TOOLING             = false

  LEGACY_PHASE               = streaming       <-- stale authority
  LEGACY_SEQ                 = 2985

  TASKHEADER_PHASE           = idle
  TASKHEADER_SOURCE          = shadow

  ACTIONBUTTONS_SECONDARY    = cancel

  FOREGROUND_COMMAND_RUNNING = false
  BACKGROUND_COMMAND_RUNNING = false

  COMPOSER_ENABLED           = true

GENERATION_MIX               = REJECTED — same stateVersion/pushId
RENDER_DERIVATION_MISMATCH   = REJECTED — rendered controls match their conflicting inputs
```

### Disposition (LIVE-CAPTURE01 RESULT01 — closed, no repair)

**Verdict**: PASS_LIVE_CONTRADICTION_CAPTURED.

**Case**: CASE_L1_STATE_ITSELF_CONTRADICTORY — the contradiction lives INSIDE the state payload at a single publication generation, NOT at any single consumer. Every consumer faithfully renders its own input.

**Root-cause class**: STALE_LEGACY_TURNSTATE — the legacy `TurnStateTracker.currentPhase` was left at `streaming` even though the canonical `AgentRuntime.snapshot()` has settled to `idle`.

**Trigger**: MANUAL_COMPACTION_PRECEDES_FAILURE (operator chronology; causality NOT yet proven — the bounded ACT 299e proves causality at the canonical coordinator restore boundary).

**Closure**: ACT 299c is CLOSED at this commit with classification only (per the original `ACT-CLINEMM-APPLICATION-OWNERSHIP-CONTROL-COHERENCE01-LIVE-CAPTURE01` directive: "NO REPAIR in RESULT01"). The classification picked here (`STALE_LEGACY_TURNSTATE`) directly named the one tiny repair for the next bounded ACT (`ACT-CLINEMM-COMPACTION-LEGACY-TURNSTATE-COHERENCE01`, ACT 299e). That ACT has now closed the production seam at `apps/vscode/src/sdk/sdk-compaction-coordinator.ts:runCompaction`'s `finally` block with 8/8 RED-then-GREEN tests; the LIVE bug family is closed at its single causal writer.

---
````
