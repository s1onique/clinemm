# ACT-CLINEMM-APPLICATION-OWNERSHIP-PROJECTION-COHERENCE01 — seam map (re-validated at HEAD `fa66f7a62`)

> Per ACT §3. This is a **re-validation** of the seam map already committed
> by AOPC01 PROBE-1 (`0af728ac8`), AOPC01 PROBE-1 tightening (`378e40a37`),
> AOPC02 PHASE A (`469523e1f`), AOPC02 PHASE A CORRECTION01..03
> (`94034bb19` / `2eb5d90d2` / `eddfc6276`), AOPC02 PHASE B (`93b753311`),
> and AOPC02 PHASE B REPAIR01-CORRECTION01 (`37e62d04e`). File-tree inspection
> at HEAD `fa66f7a62` confirms every load-bearing source file and every
> named test file is present.

## Producer-side canonical chain (unchanged from AOPC02 PHASE A)

| Step | File:Function | Notes |
|---|---|---|
| Host session | `sdk/packages/core/src/runtime/host/local-runtime-host.ts` (via `@cline-internal/core/runtime/host/local-runtime-host`) | LocalRuntimeHost; same source producer AOPC02 PHASE A exercised |
| Adapter snapshot | `apps/vscode/src/sdk/SdkController.ts:2967` calls `host.runtimeSnapshot(sessionId)` | returns canonical runtime truth (modelStreaming, toolActive, foregroundCommandRunning, backgroundCommandRunning) |
| Canonical mapper | `apps/vscode/src/sdk/task-state-shadow-arbiter-mapper.ts:296-298` (`mapAgentRuntimeStateSnapshotToArbiterSnapshot`) + `:652` (`createCanonicalRestorePhaseCallback`) | arbiter snapshot; legacy fallback when no shadow harness attached (CONTRACT_2) |
| Thinking selector | `task-state-shadow-arbiter-mapper.ts:selectThinkingPresentation({canonicalShadow, currentLegacyPhase, seq})` | projection domain 1; uses legacy phase when canonicalShadow is undefined |
| TaskHeader selector | `task-state-shadow-arbiter-mapper.ts:selectTaskHeaderPresentation({canonicalShadowPhase, currentLegacyPhase, seq})` | projection domain 2; uses legacy phase when canonicalShadowPhase is undefined |
| Producer composer | `apps/vscode/src/sdk/SdkController.ts:getStateToPostToWebview()` lines ~2886-3010 | exact property-access composition pinned by AOPC02 PHASE A discriminator |
| Publication identity | `apps/vscode/src/sdk/turn-state-tracker.ts` (`TurnStateTracker`) + `MessageIdMinter` | AOPC02 PHASE A found the producers internally coherent at idle-yield (E1 PASS) |

The MessageIdMinter is the single canonical publication counter: it feeds
`stateVersion`, `turnState.seq`, `_ptadPushId`, `thinkingPresentation.seq`,
and `taskHeaderPresentation.seq` from the same total-order guarantee (W1
contract from `W1-epoch-domain-mismatch-red-fix01`).

## Application-side publication / projection chain (unchanged from AOPC02 PHASE B REPAIR)

| Step | File:Function | Notes |
|---|---|---|
| Per-field `.seq` fence | `apps/vscode/webview-ui/src/components/chat/chat-view/messageReducer.ts:113-134` (`applyPresentationProjection<T extends { seq: number }>`) | rejects stale per-field content; same seq idempotent accept |
| Two-projection helper | `messageReducer.ts:139-167` (`applyPresentationProjections`) | composed fence for `taskHeaderPresentation` + `thinkingPresentation` together (PBR01-PBR03) |
| Full-snapshot gate | `messageReducer.ts:225-...` (`stateVersion` monotonic, MERGE by ts/seq, NEVER truncate) | the existing full-snapshot fence |
| W1 same-epoch stale-publication gate | `apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx:~700-750` (3-branch: stale-same-epoch preserve / epoch-advance reset / seq-fence apply) | PBR04 adversarial contract; added by 37e62d04e |
| Cancel predicate | `apps/vscode/webview-ui/src/components/chat/chat-view/shared/buttonConfig.ts` (producer of `secondaryAction === "cancel"`) | pinned by 33+ production-seam tests (AOC02 §2 9/9, AOC01 4/4, SDK task-control 20/20) |
| Composer-disable predicate | `apps/vscode/webview-ui/src/components/chat/chat-view/hooks/useChatState.ts` + `InputSection.tsx:96` | bounded composer enable/disable |
| Thinking-row consumer | `apps/vscode/webview-ui/src/components/chat/chat-view/hooks/useThinkingLoaderRow.ts:53-101` + `RequestStartRow.tsx:208-332` + `ChatRow.tsx:931-947` | consumes `thinkingPresentation.modelStreaming`; E7.1 closed |
| TaskHeader consumer | `apps/vscode/webview-ui/src/components/chat/task-header/...` | consumes `taskHeaderPresentation.phase` + `taskHeaderPresentation.source` |

## Cancel authority (the exact predicate, unchanged from AOC02 §2)

```
secondaryAction === "cancel"
  iff
  (turnState.phase === "streaming" OR foregroundCommandRunning OR backgroundCommandRunning)
```

AOPC02 PHASE A discriminator proved the inputs are internally coherent at
the producer seam at idle-yield (E1 PASS — see
`.factory/epics/webview-seam-aop.md` Phase A capture block). The
webview-side reducer fence (added by `37e62d04e`) backstops any future
straggler at the application seam (CASE_D1, CASE_D2 adversarial
PBR01-PBR04 closed).

## The exact contradiction (Idle + Thinking + Cancel) — already classified

The exact `Idle + Thinking + Cancel` specimen the reviewer is asking me
to find the cause for is the **LIVE-CAPTURE01-RESULT01** capture (board
row 299c): `PASS_LIVE_CONTRADICTION_CAPTURED` /
`CASE_L1_STATE_ITSELF_CONTRADICTORY` / root-cause class
`STALE_LEGACY_TURNSTATE` / trigger `MANUAL_COMPACTION_PRECEDES_FAILURE`.
See the verbatim capture block at `.factory/epics/webview-seam-aop.md`
L2740-2770. The single causal writer —
`apps/vscode/src/sdk/sdk-compaction-coordinator.ts:runCompaction`'s
`finally` block — is repaired by
`ACT-CLINEMM-COMPACTION-LEGACY-TURNSTATE-COHERENCE01` + 5 corrections
(CLTCC01..15 39/39 + CLTCC15 2/2 PASS). The
`createCanonicalRestorePhaseCallback` factory is wired into SdkController
at line 1591. The application-seam backstop is the AOPC02 PHASE B
REPAIR01-CORRECTION01 fence composition.

## Companion diagnostic infrastructure (already on disk, NOT ACT-owned)

- `apps/vscode/src/sdk/post-terminal-authority-diagnostic-builder.ts` (LIVE-CAPTURE01 instrumentation; default-off, additive, removable, gated)
- `apps/vscode/src/shared/post-terminal-authority-diagnostic.ts` (PTAD ring buffer; 4 additive fields added by LIVE-CAPTURE01)
- `apps/vscode/src/sdk/dogfood-runtime-profile.ts` (dogfood identity resolver; 22/22 vitest GREEN at HEAD ancestor)
- `apps/vscode/src/sdk/v2-capture.ts` (capture codepath; 16/16 vitest at HEAD ancestor; auto-rooted at `<globalStorageFsPath>/runtime-diag/<id>.jsonl` per CORRECTION02)
- The dogfood diagnostics V/I/P auto-on-in-dogfood + VIP header indicator + P-probe discriminator (added at HEAD `9d595e4cf` + `0776d35f7`; current head `fa66f7a62` = CORRECTION03)

These are durable dogfood infrastructure committed by prior ACTs. **Do
not remove them in this ACT** (per ACT §17: only diagnostics introduced
specifically for AOPC01 are subject to this ACT's removal trigger; none
were introduced).

## Companion tests at HEAD (file-tree confirmed)

- `apps/vscode/src/sdk/__tests__/application-ownership-projection-coherence.aopc01.c24-c-bridge.test.ts` (608 lines)
- `apps/vscode/src/sdk/__tests__/application-ownership-projection-coherence.aopc02.c24-c-bridge.test.ts`
- `apps/vscode/src/sdk/__tests__/application-ownership-projection-coherence.aopc02-phase-a-correction01.c24-c-bridge.test.ts`
- `apps/vscode/src/sdk/__tests__/application-ownership-projection-coherence.aopc02-phase-a-correction02.c24-c-bridge.test.ts`
- `apps/vscode/src/sdk/__tests__/application-ownership-projection-coherence.aopc02-phase-a-correction03.c24-c-bridge.test.ts`
- `apps/vscode/src/sdk/__tests__/application-ownership-projection-coherence.aopc02-phase-b.c24-c-bridge.test.ts` (PHASE B — CASE_D2)
- `apps/vscode/src/sdk/__tests__/application-ownership-projection-coherence.aopc02-phase-b-repair01-correction01.c24-c-bridge.test.ts` (REPAIR)
- `apps/vscode/src/sdk/__tests__/application-ownership-control-coherence.aoc02.c24-c-bridge.test.ts` (§2 verdict GREEN)
- `apps/vscode/src/sdk/__tests__/sdk-compaction-coordinator.legacy-turnstate-coherence.cltcc13.test.ts` (CORRECTION04 chronology proof)
- `apps/vscode/src/sdk/__tests__/task-state-shadow-task-header-presentation.thcp01.test.ts`
- `apps/vscode/src/sdk/__tests__/task-state-shadow-thinking-presentation.e7.1.test.ts`
- `apps/vscode/src/sdk/__tests__/task-header-live-activity-coherence.lac01.test.ts` (+ helpers)
- `apps/vscode/src/sdk/__tests__/host-ownership-diagnostic-runtime.live-capture01.test.ts` (LIVE-CAPTURE01 wiring)
- `apps/vscode/src/sdk/__tests__/post-terminal-authority-diagnostic-runtime.test.ts` + `*-builder.test.ts` + `*-wiring.test.ts`

Plus the webview-ui tests for THCP / E7.1 / useThinkingLoaderRow /
buttonConfig / messageReducer per the closed substrate.

## Reproduction gate (per ACT §15 LIVE_QUALIFICATION)

The honest disposition here is **STRUCTURAL** only — bun is not installed
in this shell, so vitest cannot run here; the closed family's LIVE
qualification gate (per its closure verdicts) was already executed in
prior headed dogfood sessions and produced the synchronized capture
documented in LIVE-CAPTURE01-RESULT01.

If a fresh headed dogfood launch is available in a future shell, the
exact ACT §15 LIVE_QUALIFICATION repro path is documented in
`.factory/epics/webview-seam-aop.md` row 299e5 (CLTCC15
REAL_TEMPORAL_COMPOSITION) + the LIVE-CAPTURE01-RESULT01 operational
path (lines 2718-2760). The manual-compact-between-prompts chronology
is the load-bearing repro for the `STALE_LEGACY_TURNSTATE` class.
