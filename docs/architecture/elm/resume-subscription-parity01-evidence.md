# ACT-CLINEMM-RESUME-SUBSCRIPTION-PARITY01 — Evidence

## Identity

- ACT_ID: `ACT-CLINEMM-RESUME-SUBSCRIPTION-PARITY01`
- EPIC_ID: `EPIC-CLINEMM-RESUME-SUBSCRIPTION-PARITY01`
- REPOSITORY_ROOT: `/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm`
- BRANCH: `main`
- ENTRY_HEAD: `287b23f81af74242929ddb932fddaea1f3b7431b` (LTZ01 closure head)
- ENTRY_TREE: `72cb592e6fc399cea7c6c29bbd3c6a47adff5a75`
- PRODUCTION_FIX_HEAD: `6915c22ced47d9198119b3f0bf46a22e5850cdb1` (RSP01 production fix + new test + board row)
- PRODUCTION_FIX_TREE: `397766a33d5a1d43f2015890b42e29957a8a2b10`
- DOCS_CLOSURE_HEAD: `ae70870f6573772a6ede1b4f202af0e75a0b0cef` (CORRECTION01 docs-closure commit; authoritative `SOURCE_HEAD` for the rebuilt VSIX)
- DOCS_CLOSURE_TREE: `ca5e4286a39322b6304f2e37ad57db3ed7753f0c`
- FINAL_HEAD: `ae70870f6573772a6ede1b4f202af0e75a0b0cef`
- FINAL_TREE: `ca5e4286a39322b6304f2e37ad57db3ed7753f0c`
- WORKTREE_STATUS: clean (no dirt, no untracked; protected evidence preserved)

## LIVE evidence binding (per Factory addendum; CORRECTION01 wording)

- LIVE_VERSION = `s1onique.clinemm@4.1.10-e5c6bf486` (state-side LAC-ABSENCE01 closure; PRE-LTZ01 + PRE-RSP01)
- LIVE-A: TaskHeader telemetry entirely absent (timer + state + tool-count all missing). Classification: `TASK_TELEMETRY_ABSENT_OR_UNPUBLISHED`. Exact host boundary unproven.
  - LIVE_A = REAL on `e5c6bf486`.
  - LTZ01 causal match = **INFERRED**, not seam-reproduced. LTZ01 may well have repaired a cause capable of producing LIVE-A, but unless that exact old screenshot was reproduced through LTZ01's seam, the LTZ01 ←→ LIVE-A causal attribution is **inference, not proof**.
- LIVE-B: TaskHeader showing `21:37 · Idle · 253` while Cline visibly edits code. Classification: `TELEMETRY_PRESENT_BUT_STALE_OR_TERMINAL` + `STATE_PROJECTION_STALE`. Exact host boundary unproven.
  - LIVE_B = REAL on `e5c6bf486`.
  - MODELED_STALE_ENDEDAT_PATH_ON_CURRENT_HEAD = **NOT_REPRODUCED**. RSP04 proves that the modeled resume chronology (observeTurnPhase("streaming") → CONTINUATION_PHASE) clears `endedAt` correctly, independent of the RSP subscription repair. **RSP04 does NOT prove that LIVE-B cannot occur on current HEAD via any other path.**
  - RSP01_CAUSAL_RELATION_TO_LIVE_B = **UNPROVEN**. The RSP01 ACT closed a subscription-lifecycle gap on the resume seam; that gap is consistent with the LIVE-B class but is not the only candidate cause for the visible symptom.
  - CURRENT_HEAD_LIVE_B_STATUS = **NOT_LIVE_QUALIFIED**. The LIVE-B status on the post-RSP01 HEAD is pending L0-L5 LIVE qualification (install exact-head VSIX, resume an existing task, confirm `Working` and ticking timer return).
- These observations are `REAL_LIVE_FAILURE_ON_DOGFOOD_e5c6bf486` only. The older `e5c6bf486` build was missing BOTH the LTZ01 timer anchor (closed at `287b23f81`) AND the RSP01 subscription wiring (closed at `6915c22c`) AND the CORRECTION03 coordinator setTurnPhase("streaming") assertion. Current HEAD (`ae70870f`) has all three.

## Recon

- FRESH_INIT_RUNTIME_ATTACH = `SdkController.initTask` line 1675 `this.attachCanonicalRuntimeEventSubscription(sessionId)`
- FRESH_INIT_RECOVERY_ATTACH = `SdkController.initTask` line 1670 `this.attachRecoveryTelemetrySubscription(sessionId)`
- RESUME_RUNTIME_ATTACH = (pre-fix) absent; (post-fix) added at `SdkController.reinitExistingTaskFromId` line 1833
- RESUME_RECOVERY_ATTACH = (pre-fix) absent; (post-fix) added at `SdkController.reinitExistingTaskFromId` line 1832
- RUNTIME_SUB_OWNER = `CanonicalRuntimeShadowSubscription` (`apps/vscode/src/sdk/canonical-event-subscription.ts`)
- RECOVERY_SUB_OWNER = `SdkController.taskTelemetryRecoveryUnsub` field (line 249); managed by `attachRecoveryTelemetrySubscription`
- DISPOSER_OWNER = Same as sub owner; both helpers are idempotent on re-init
- CARDINALITY_MODEL = "exactly one active listener per session"; `CanonicalRuntimeShadowSubscription.attach()` disposes previous listener before attaching new; `attachRecoveryTelemetrySubscription` calls `this.taskTelemetryRecoveryUnsub?.()` first

## Contracts (canonical runtime-event subscription)

- PRODUCER: `sdkHost.subscribeRuntimeEvents` (e.g. `VscodeSessionHost.subscribeRuntimeEvents` → `ClineCore.subscribeRuntimeEvents`)
- CONSUMER: `TaskShadowHostWiring.observeCanonicalRuntimeEvent` (production wiring)
- TASK_IDENTITY: `currentSessionId` (captured at attach time)
- SESSION_IDENTITY: `currentSessionId` (same as task identity for this ACT)
- FRESH_DELIVERY: PASS (RSP03 positive control)
- RESUME_DELIVERY: PASS (RSP01 behavioral seam)

## Contracts (recovery telemetry subscription)

- PRODUCER: `sdkHost.subscribeRecoveryStateChange` (e.g. `VscodeSessionHost.subscribeRecoveryStateChange` → `ClineCore.subscribeRecoveryStateChange`)
- CONSUMER: `taskTelemetry.observeRecovery(recovery)` (in `attachRecoveryTelemetrySubscription` listener closure); also mirrors to shadow via `emitHostRecovery`
- TASK_IDENTITY: `currentSessionId` (captured at attach time)
- SESSION_IDENTITY: same
- FRESH_DELIVERY: PASS (RSP04 positive control)
- RESUME_DELIVERY: PASS (RSP02 behavioral seam)

## RED

- RSP01: RED on HEAD before fix (canonical runtime event after resume → 0 shadow observations); GREEN after fix (exactly 1 observation)
- RSP02: RED on HEAD before fix (recovery snapshot after resume → 0 counter increments); GREEN after fix (exactly 1 increment)
- RSP03: GREEN with fix AND without fix (taskTelemetry strip is anchored by LTZ01's `taskTelemetry.startTask(...)`; subscription wiring is independent)
- RSP04: GREEN with fix AND without fix (terminal-timing clear depends on the existing `observeTurnPhase("streaming")` → CONTINUATION_PHASE chain, not on subscription wiring)
- RSP05: RED on HEAD before fix; GREEN after fix (cardinality holds across repeated resumes)
- RSP06: RED on HEAD before fix; GREEN after fix (sessionId filter drops stale A events after A→B switch)
- REPRODUCED = YES (RSP01, RSP02, RSP05, RSP06 all RED on HEAD before fix; all GREEN after fix)

## Classification

- CASE: CASE_C_BOTH_SUBS_MISSING_ON_RESUME (runtime + recovery both missing on the resume seam)

## Cause

- ROOT_CAUSE: `SdkController.reinitExistingTaskFromId` (line 1782+) does not call `attachCanonicalRuntimeEventSubscription` or `attachRecoveryTelemetrySubscription`. Both are called only from `initTask` (lines 1670-1675). The doc-comment at `canonical-event-subscription.ts:35-39` falsely claims `reinitExistingTaskFromId` calls `attachCanonicalRuntimeEventSubscription`; this ACT makes the claim accurate.
- FIRST_BROKEN_BOUNDARY: `SdkController.reinitExistingTaskFromId` body
- DISCRIMINATOR: 4 distinct behavioral REDs (RSP01, RSP02, RSP05, RSP06) at the production-seam harness; plus the non-comment structural sentinel
- NECESSITY_ABLATION: PROVEN. Commenting out both `attachRecoveryTelemetrySubscription(sessionId)` and `attachCanonicalRuntimeEventSubscription(sessionId)` lines → RSP01, RSP02, RSP05, RSP06 RED. Restored → all 9 GREEN.

## Repair

- FILES: `apps/vscode/src/sdk/SdkController.ts` (production fix); `apps/vscode/src/sdk/__tests__/resume-subscription-parity.rsp01.test.ts` (NEW); `.factory/epic-board.md` (EPIC + ACT rows)
- RUNTIME_ATTACH_DELTA: +1 call inside the existing `sessionId === taskId` fence in `reinitExistingTaskFromId`
- RECOVERY_ATTACH_DELTA: +1 call inside the same fence
- DISPOSAL_DELTA: 0 (existing idempotent dispose-then-attach in both helpers handles this)
- FENCE_DELTA: 0 (LTZ01's `sessionId === taskId` fence already protects against superseding intents)
- WIRE_DELTA: 0 (no proto, ExtensionMessage, ClineMessage, or webview field changes)
- UI_DELTA: 0 (no TaskHeader, ChatRow, timer visual, or recovery UI changes)
- TIMER_DELTA: 0 (LTZ01 timer anchor unchanged; the streaming-phase observation that reopens the clock is the existing CONTINUATION_PHASE contract)
- TASK_STATE_SEMANTICS_DELTA: 0

## Cardinality

- FIRST_RESUME: 1 active listener on both runtime + recovery subscriptions; emit 1 event → 1 observation; emit 1 recovery snapshot → 1 increment (RSP01, RSP02)
- SECOND_RESUME: 1 active listener on both (the previous is disposed, a new one attached); emit 1 event → 1 observation; emit 1 recovery snapshot → 1 increment (RSP05)
- FRESH_TO_RESUME: not separately tested (RSP03 and RSP04 are positive controls for fresh init; resume is the main seam)
- A_TO_B: 0 stale A events reach B's wiring (RSP06); sessionId filter holds
- STALE_EVENT_EFFECT: 0 (sessionId filter in `subscribeCanonicalRuntimeEventsToShadow` + recovery listener's `evtSessionId !== sessionId` guard)

## Conservation

- LAC01 = PASS_TASKHEADER_LIVE_STATE_COHERENCE (state-side; closed at `e5c6bf486`; unaffected)
- LAC_ABSENCE01 = PASS (3/3)
- LTZ = PASS (3/3 LTZ01; same-task continuation + timer anchor preserved)
- THCP = PASS (18/18 THCP selector + 7/7 helper + 6/6 THCP11 publication = 31/31)
- TASK_CONTROL = PASS (3/3 tcl-parent + 6/6 tcl-parent.adversarial + 5/5 sdk-controller-w1-epoch-stateversion)
- COMPACTION = PASS (no compaction code changed)
- COMPLETION = PASS (no completion code changed)
- RTP = PASS (no runtime progression changed)

## Quality

- TARGETED: 106/106 PASS on the targeted subscription + telemetry + task-control + state-version surface (RSP01 9 + LTZ01 3 + LAC01 1 + task-telemetry-tracker 43 + SdkController.test 7 + SdkController.task-telemetry-wiring 6 + e2f-f1-correction03 8 + real-local-to-shadow-bridge.c24-c 7 + task-state-shadow-host-wiring.e2f-f1-correction01 8 + tcl-parent 3 + tcl-parent.adversarial 6 + sdk-controller-w1-epoch-stateversion-stamping 5)
- APPS_VSCODE: 1816/1816 PASS (vs 1806/1806 LTZ01 baseline; +10 tests = 9 RSP + 1 helper, all GREEN; one pre-existing flake in `async-command-turn-liveness.acl01` still passes 5/5 in isolation)
- WEBVIEW: 592/592 PASS (no webview delta)
- BUN_UNIT: 1076/1076 PASS (no bun-side delta)
- SDK_CORE: not run (no `@cline/core` / `@cline/agents` / `@cline/shared` changes)
- TYPECHECK: 0 diagnostics (`bunx tsc --noEmit` clean)
- LINT: PASS (`biome lint` clean; proto-lint clean)
- BOARD_VALIDATOR: PASS (board rows added coherently; priority-list item #12 added; no row corruption)
- DIFF_CHECK: PASS (`git diff --check HEAD` clean)

## LIVE (PENDING — exact-head VSIX built but not yet installed)

- SOURCE_HEAD: `ae70870f6573772a6ede1b4f202af0e75a0b0cef` (CORRECTION01 docs-closure commit; HEAD at the moment of artifact rebuild)
- SOURCE_TREE: `ca5e4286a39322b6304f2e37ad57db3ed7753f0c`
- ARTIFACT: `apps/dist/clinemm-rsp01.vsix`
- BYTES: 8893368
- SHA256: `d434bc9112750f71730b326a1d9ef55fbb77b3abf638ea57a6a4f3b8ed247e6c`
- L0_TASK_A: pending user-side install
- L1_RESUME_A: pending
- L2_RUNTIME_EVENT_AFTER_RESUME: pending
- L3_RECOVERY_AFTER_RESUME: pending
- L4_REPEAT_RESUME: pending
- L5_SWITCH_TO_B: pending
- RESULT: PRODUCTION_SEAM_CLOSED (full LIVE qualification deferred to the natural-reproduction cycle)

## Board

- RESUME_SUBSCRIPTION_PARITY: ACT-CLINEMM-RESUME-SUBSCRIPTION-PARITY01 = `IN_PROGRESS → CLOSED` (production-seam RED + GREEN + ablation proven; LIVE qualification deferred to natural-reproduction cycle per ACT §40); EPIC-CLINEMM-RESUME-SUBSCRIPTION-PARITY01 = `OPEN → CLOSED (PASS_PRODUCTION_SEAM; LIVE qualification pending)`

## Commits

- COUNT = 2
- HASHES = `6915c22ced47d9198119b3f0bf46a22e5850cdb1` (production fix + new test + board row); `ae70870f6573772a6ede1b4f202af0e75a0b0cef` (this evidence doc + board closure status; the docs-only closure commit that is the authoritative `SOURCE_HEAD` for the rebuilt VSIX)
- MESSAGES = `fix(sdk): attach runtime + recovery subscriptions on resume seam (RSP01)`; `docs(act): RSP01 evidence + board closure (SOURCE_HEAD + SHA256 + LIVE binding)`

## Pushed

- PUSHED = NO (no push authorized; local-only per ACT §0)
- FORCE_PUSHED = NO
- AMENDED_PUBLISHED_COMMIT = NO

## Protected evidence

- STASHES: preserved (3 stashes: STASH_TCL-PARENT-ADVERSARIAL01, STASH_141372c52 (ACT-ELM-02C2 forensic), STASH_371752f71 (context-accounting-truth01 forensic) — all untouched)
- RECOVERY_REFS: preserved (`recovery/local-main-20260820`, `recovery/remote-main-20260820` — untouched)

## P2 residue

- None. The `canonical-event-subscription.ts:35-39` doc-comment is now accurate.

## Next recommended ACT

- Re-read durable epic board at the next meaningful ACT boundary. The board entries for `EPIC-CLINEMM-RESUME-SUBSCRIPTION-PARITY01` and `ACT-CLINEMM-RESUME-SUBSCRIPTION-PARITY01` will guide the reviewer to this closure evidence. The next natural follow-up is the LIVE qualification of this ACT (L0-L5 per ACT §40) on the installed exact-head VSIX (`apps/dist/clinemm-rsp01.vsix`, SHA256 `d434bc91...`). RSP04 proves only that the modeled resume chronology clears `endedAt` correctly via the existing CONTINUATION_PHASE contract; it does **not** prove that LIVE-B cannot occur on current HEAD via any other path. Current HEAD LIVE-B status: **NOT_LIVE_QUALIFIED**. If LIVE-B reproduces after installing the exact-head VSIX, that would be evidence of a separate defect class (not the subscription-lifecycle gap this ACT closed), and a future bounded ACT would investigate.

## Exact-head dogfood (RSP01) — CORRECTION01 (rebuilt at ae70870f)

  - SOURCE_HEAD = `ae70870f6573772a6ede1b4f202af0e75a0b0cef` (CORRECTION01 docs-closure commit; authoritative for this VSIX)
  - SOURCE_TREE = `ca5e4286a39322b6304f2e37ad57db3ed7753f0c`
  - SOURCE_VERSION = `4.1.10` (apps/vscode/package.json)
  - DOGFOOD_VERSION = `4.1.10`
  - ARTIFACT_PATH = `apps/dist/clinemm-rsp01.vsix`
  - BYTES = `8893368`
  - SHA256 = `d434bc9112750f71730b326a1d9ef55fbb77b3abf638ea57a6a4f3b8ed247e6c`
  - INSTALLED_VERSION = (not installed in this ACT; user-side install is a downstream step)

The bundle `apps/vscode/dist/extension.js` was rebuilt by `bun
esbuild.mjs` immediately after the CORRECTION01 docs commit to keep
the local dogfood target in sync with the repository HEAD. The bundle
includes both LTZ01 (timer anchor on resume) and RSP01 (runtime +
recovery subscriptions on resume) and the CORRECTION03 coordinator
setTurnPhase("streaming") assertion. Because `ae70870f` differs from
`6915c22c` only in documentation (`.factory/epic-board.md` +
`docs/architecture/elm/resume-subscription-parity01-evidence.md`),
the bundled `dist/extension.js` content is identical between the two
SHAs; the VSIX byte count is therefore also identical (8893368). The
distinct SHA256 is per-build archive metadata (timestamps, etc.),
not a content divergence. The original artifact at `b72a94fe57855dc6a323d745e3fb06d8c2eec0fb231e6a119c8b1d96bda683f9`
is NOT the authoritative bound artifact; it was a stale-build snapshot
identified as such by CORRECTION01 and replaced.
