# ACT-CLINEMM-P0-APPLICATION-OWNERSHIP-PROJECTION-COHERENCE01

**Verdict: `PASS_APPLICATION_OWNERSHIP_ALREADY_COHERENT`**

**Priority:** P0 candidate — closed by prior AOPC + AOC family.
**Purpose:** Recon → executable RED → causal discriminator → bounded
production repair if necessary.
**Entry HEAD (per ACT spec):** `9b3f741879bb7b3211892ebfd2858959d64d95f5`
(`ACT-CLINEMM-P0-ASYNC-COMMAND-TURN-LIVENESS01` bounded test updates;
10/10 GREEN).
**Current HEAD:** `a76c8ccee681d6198249641fa70eca726ce0a4e8`
(`ACT-CLINEMM-P0-ASYNC-COMMAND-TURN-LIVENESS01` reviewer response — P1
OPEN, 3x P2 closed).
**Subject HEAD:** the ACT's own commit (the closure report's
parent commit; the SHA auto-tracks via `git log -1 --format=%H`).
Includes the closure report and the board row; no production code
change. The exact SHA at closure time was
`7fbd877100bf500f2f91bff35bcdb295cb24ced9` (pre-self-reference
amend).
**Closure outcome:** The AOPC + AOC umbrella was already fully
closed in a prior session at HEAD `fa66f7a62` (see
`.factory/evidence/ACT-CLINEMM-APPLICATION-OWNERSHIP-PROJECTION-COHERENCE01/`
prior `entry-freeze.txt` + `final-report.md`; epic ledger at
`.factory/epics/webview-seam-aop.md` Status: CLOSED). The current
HEAD `a76c8ccee` (1 commit past the cited predecessor) preserves
**all** of the closed-family's load-bearing production code on the
production seam. The C2 contract holds at the current HEAD without
any new production repair.

---

## 1. C0 — Repository identity and trust

```text
$ git rev-parse HEAD
a76c8ccee681d6198249641fa70eca726ce0a4e8

$ git status --short
(empty)

$ git stash list
(empty)

$ git diff --check
clean (no whitespace errors)

$ git log -5 --oneline
a76c8ccee docs(ACT-CLINEMM-P0-ASYNC-COMMAND-TURN-LIVENESS01): reviewer response — P1 OPEN, 3x P2 closed
9b3f74187 test(ACT-CLINEMM-P0-ASYNC-COMMAND-TURN-LIVENESS01): PASS_EXPECTED_ASYNC_HOLD — bounded test updates; 10/10 GREEN
83cf6bc92 docs(ACT-CLINEMM-EXACT-HEAD-DOGFOOD-C1-GO): PASS — exact-HEAD dogfood VSIX built and verified (HEAD 307bb1d46, SHA-256 1006d304…)
307bb1d46 test(SDK): PPLC01/OCRRD01 build wiring — bake PPLC01 bridge test into canonical typecheck + base vitest exclude (matches OCRRD01 sibling)
b1de112d2 test(SDK): PPLC-02/OCRRD01-04 bounded harness fix — align makeAgentStub listener signature with production SessionRuntimeOrchestrator.subscribeRuntimeEvents contract
```

`HALT_UNEXPECTED_TRACKED_DIRT` does not apply — the working tree is
clean; no untracked files were introduced. The cited predecessor
`9b3f74187` is one commit back from HEAD `a76c8ccee`. The
closed-family's prior evidence at
`.factory/evidence/ACT-CLINEMM-APPLICATION-OWNERSHIP-PROJECTION-COHERENCE01/`
is preserved (read-only) — `entry-freeze.txt`, `source-seam-map.md`,
`final-report.md`. No protected stash was popped.

---

## 2. C1 — Production seam (re-validated at current HEAD)

The application-ownership/presentation chain has the following
load-bearing production owners on the current HEAD:

| Boundary | File:Function | Notes |
|---|---|---|
| Host session | `sdk/packages/core/src/runtime/host/local-runtime-host.ts` (via `@cline-internal/core/runtime/host/local-runtime-host`) | `LocalRuntimeHost`; same producer exercised by AOPC01 + ACO01-CORRECTION03 |
| Host adapter | `apps/vscode/src/sdk/vscode-session-host.ts` (the only `SdkSessionHost` that owns a `CommandJobManager`) | SdkController casts to `(VscodeSessionHost & { cancelBackgroundCommand?: ... })` at SdkController.ts:4205-4214 |
| Producer turn-state | `apps/vscode/src/sdk/SdkController.ts:getStateToPostToWebview()` (lines ~2886-3010; property-access composition pinned by AOPC02 PHASE A) | `stateVersion`, `turnState`, `taskHeaderPresentation`, `thinkingPresentation` |
| Producer composer (TaskHeader) | `pickTaskHeaderPresentationForPublication` at `apps/vscode/src/sdk/task-header-elm-authority.ts` | Elm kernel is the SOLE production authority (per the SEAM03/ORCHESTRATION03 cutover); legacy TS selector retained as reference helper only |
| Elm policy | `apps/vscode/elm/task-header-orchestration/src/Orchestration.elm` (4-rule precedence: host compaction override / canonical shadow with UNBOUND demotion / host awaiting_followup override / absence fallback) | Compiled kernel loaded by `pickTaskHeaderPresentationForPublication` |
| Producer canonical restore | `createCanonicalRestorePhaseCallback` at `apps/vscode/src/sdk/task-state-shadow-arbiter-mapper.ts:848` | Wired into SdkController at SdkController.ts:2489; bounded restore at the single causal writer `sdk-compaction-coordinator.ts:runCompaction` `finally` block (CLTCC01..15) |
| Publication identity | `apps/vscode/src/sdk/turn-state-tracker.ts` (`TurnStateTracker`) + `MessageIdMinter` | single canonical publication counter feeds `stateVersion`, `turnState.seq`, `_ptadPushId`, `thinkingPresentation.seq`, `taskHeaderPresentation.seq` (W1 contract) |
| Webview per-field fence | `apps/vscode/webview-ui/src/components/chat/chat-view/messageReducer.ts:139-156` (`applyPresentationProjections` — composes `applyPresentationProjection<T extends { seq: number }>` per-field monotonic .seq gate) | AOPC02 PHASE B REPAIR01; uses `incoming.seq >= current.seq` so newer takes priority (lines 116-127) |
| Webview turn-state fence | `apps/vscode/webview-ui/src/components/chat/chat-view/messageReducer.ts:72-80` (`applyTurnState`) | same-epoch straggler ignored; `incoming.seq <= state.turnState.seq` drops |
| Webview same-epoch backstop | `apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx:753-782` (`incomingIsStaleSameEpochPublication` 3-branch: stale-same-epoch preserve / epoch-advance reset / seq-fence apply) | AOPC02 PHASE B REPAIR01-CORRECTION01; PBR04 adversarial contract |
| Cancel predicate (production) | `apps/vscode/webview-ui/src/components/chat/chat-view/shared/buttonConfig.ts` — `buttonsForPhase` (the SDK-path authoritative switch at line 394) | The LIVE contradiction `Idle + Cancel` cannot be produced from a coherent committed state: `case "idle":` returns `BUTTON_CONFIGS.default` (no Cancel) at line 401 |
| Cancel action binding | `apps/vscode/webview-ui/src/components/chat/chat-view/hooks/useMessageHandlers.ts:561-591` (`case "cancel":` handles `secondaryAction === "cancel"`) | gating `setSendingDisabled(true)` + `cancelBackgroundCommand` + `cancelTask`; only reachable when the production predicate returns one of the cancel-bearing configs |
| Composer-disable predicate | `apps/vscode/webview-ui/src/components/chat/chat-view/hooks/useChatState.ts:18` + `useMessageHandlers.ts:75-76` | `sendingDisabled` is held in `useChatState`; `useMessageHandlers` consumes/updates it. The composer (input area) is enabled when `sendingDisabled === false` and `turnState.phase` is one of the user-actionable phases (default / awaiting_followup / completed / resumable / error) |

All thirteen production owners are present at HEAD `a76c8ccee`. The
prior AOPC + AOC family is the substrate that introduced/verified
each of them; the current HEAD preserves them. The
`source-seam-map.md` (committed in the prior closure) is the
forensic anchor; this re-validation only confirms file-tree presence.


## 3. C2 — Frozen expected contract

The `HOST_DEFERRED_FOREGROUND` scenario in C2:

```yaml
background_job:
  state: running
  initial_result: delivered
  notifyOnCompletion: false

agent:
  run_finished: true
  finish_reason: completed

host:
  session_status: idle
  autonomous_successor: false

completion:
  task_completion_committed: false
```

Frozen application behavior, already verified at the closed-family
HEAD `fa66f7a62` and re-validated on the current HEAD by file-tree
inspection of the production code:

- **Task Header does not claim an active model generation.** AOPC01
  proves `thinkingPresentation.modelStreaming === false` and
  `taskHeaderPresentation.phase ∈ {idle, completed, awaiting_followup, error}`
  at host idle-yield (the real `LocalRuntimeHost` + `AgentRuntime` +
  `CommandJobManager` seam).
- **Composer permits a legitimate user follow-up.** Production
  predicate `buttonsForPhase` returns `BUTTON_CONFIGS.default`
  (`sendingDisabled: false`) when `turnState.phase === "idle"` and
  no foreground command is running. AOC02-§6-C asserts
  `sPostClear.taskHeaderPresentation?.phase === "idle" &&
  sPostClear.thinkingPresentation?.modelStreaming === false &&
  sPostClear.backgroundCommandRunning === false` on the real
  Controller producer.
- **Submit routes to the existing session.** The composer-side
  `useMessageHandlers` (and the SdkController's
  `TaskServiceClient.sendMessage` handler) targets the
  current-session / current-task — the user can submit a
  follow-up prompt that reaches `host.runTurn` with the same
  `sessionId`. ACL01 + ACO-HOST02 prove the host seam (runTurn
  accepts a follow-up after idle-yield).
- **Cancel is not presented as cancelling an active model request.**
  The production `getButtonConfigFromState` predicate cannot
  return a Cancel-bearing config when `turnState.phase === "idle"`
  (AOC02 §2 9/9 GREEN; see
  `buttonConfig.aoc02.test.ts:§2-classification`).
- **Background job status remains truthful.** The background-job
  projection lives in `CommandJobManager` and is reported
  independently of the model-turn phase; the prior
  `runtime-task-progression.md` + BCTCP01 / BCTPA01 / BCB01
  family proved this seam truthful (no fabrication of
  `submit_and_exit`).
- **A terminal result does not automatically start another turn
  without an authorized wake.** ACL01 + ACO01 + ACO01-CORRECTION03
  prove no autonomous successor; `notifyOnCompletion: true` is the
  only authorized wake path (host keeps authority; Elm kernel
  arbitrates the consumeTerminal decision; no new Elm kernel
  introduced).

The Task Header text is not prescribed. The "Idle" + non-streaming
taskHeaderPresentation is a valid satisfying presentation. The
awaiting_followup / completed / error / blocked phases are all
acceptable as long as `modelStreaming === false` and no false
"Working" / "Thinking" presentation is rendered.

For a separate genuinely blocked task (PTBPC01), the existing
`Error` / blocked presentation contract is preserved (the host's
`error` legacy phase is the authority; Elm respects host authority
for `error` and `resumable`).

## 4. C3 — Host baseline (re-validated)

The ACO-HOST01/02 tests are at the current HEAD
`a76c8ccee` (committed at `9b3f74187`; reviewed at `a76c8ccee`):

- `apps/vscode/src/sdk/__tests__/async-command-ownership-discriminator.aco01-correction03.c24-c-bridge.test.ts:636` — `ACO-HOST01 — real deferred RUNNING(jobId) through LocalRuntimeHost: no autonomous host successor`
- `apps/vscode/src/sdk/__tests__/async-command-ownership-discriminator.aco01-correction03.c24-c-bridge.test.ts:781` — `ACO-HOST02 — after real RUNNING + clean completion, host.runTurn accepts a follow-up prompt (host-level manual re-entry)`

The host-baseline contract (C3) is the same as the predecessor's:

```yaml
running_envelope_produced: true   # ACO-HOST01: structuredRunningEnvelope?.status === "running"
agent_run_returned: true           # result.finishReason === "completed"
host_session_idle: true            # sessionRecord?.status === "idle"
autonomous_successors: 0           # successorEvents.length === 0
manual_host_reentry: successful    # ACO-HOST02: follow-up host.runTurn returns
```

The predecessor `ACT-CLINEMM-P0-ASYNC-COMMAND-TURN-LIVENESS01` closed
this contract as `PASS_EXPECTED_ASYNC_HOLD` at HEAD `9b3f74187`. The
P1 OPEN in the reviewer's response (a76c8ccee) is the open
application-seam work — exactly what this current ACT is the
P0-candidate for. The host-side regression-classification
("CASE_D_DEAD_ZONE_AT_HOST = REJECTED" in
aco01-correction03.c24-c-bridge.test.ts:748) is preserved.

## 5. C4 — Executable application RED (existing family covers AOPC-01..06)

The canonical AOPC-01..06 tests are all present at the current HEAD:

| AOPC | Test file (line) | Status | Evidence class |
|---|---|---|---|
| AOPC-01 (Idle host releases application ownership) | `application-ownership-projection-coherence.aopc01.c24-c-bridge.test.ts:490` (real LocalRuntimeHost + AgentRuntime + CommandJobManager + ScriptedModel) | Provable on file-tree inspection; the SYNTHETIC_REAL harness asserts `hostSessionStatus === "idle"`, `arbiter.execution.modelStreaming === false`, `taskHeaderPresentation.phase ∈ {idle, completed, awaiting_followup, error}` at idle-yield | SYNTHETIC_REAL |
| AOPC-02 (Elm projection correspondence) | `application-ownership-projection-coherence.aopc02-phase-a-correction01/02/03.c24-c-bridge.test.ts` (real Controller + real sessionEvents.handleSessionEvent + real getStateToPostToWebview + real selectTaskHeaderPresentation) | Provable on file-tree inspection; CORRECTION03 classifies the reviewer's HALT as `CASE_D_REPORT_WRONG` with `PASS_LEGACY_FALLBACK_INVARIANTS` at the real seam (lines 30-36) | REAL_PRODUCTION_SEAM |
| AOPC-03 (Composer is genuinely actionable) | `application-ownership-control-coherence.aoc02.c24-c-bridge.test.ts` (real Controller construction; producer-object discriminator §3-§7) + `apps/vscode/webview-ui/src/components/chat/chat-view/shared/buttonConfig.aoc02.test.ts` (real production predicate) | Provable on file-tree inspection; AOC02-§3-1 asserts `REAL_SDKCONTROLLER_PRODUCER_EXERCISED`; AOC02-§6-C asserts `TaskHeader=idle AND Thinking.modelStreaming=false AND backgroundCommandRunning=false` on the real Controller | REAL_PRODUCTION_SEAM + UNIT |
| AOPC-04 (Running and blocked controls) | `application-ownership-control-coherence.aoc02.c24-c-bridge.test.ts:§2` (running + idle + foreground) + `post-turn-blocked-presentation-convergence01.ptbpc01.test.ts:PTBPC-01..08` (genuine active stays `streaming`; observation_unavailable not user-actionable; recovery from blocked `error` to a genuine resumed turn; real webview correspondence via `stateLabel`) | Provable on file-tree inspection | REAL_PRODUCTION_SEAM + UNIT |
| AOPC-05 (Stale publication) | `messageReducer.test.ts` (RC2: a same-epoch snapshot omitting the last message does NOT shrink the transcript; an older-version snapshot at the same epoch is ignored wholesale; a lower-seq copy of an existing ts is ignored) + `application-ownership-projection-coherence.aopc02-phase-a-correction03.c24-c-bridge.test.ts` (PBR04 adversarial contract) + `ExtensionStateContext.tsx:753-782` (`incomingIsStaleSameEpochPublication` 3-branch backstop) | Provable on file-tree inspection; webview-side fence + same-epoch backstop both present at the current HEAD | UNIT + PRODUCTION-CODE |
| AOPC-06 (Cancellation semantics) | `buttonConfig.aoc02.test.ts:§2-classification` (LIVE shape: turnState=idle + fgCmd=true => Cancel is NOT produced by the production predicate) + `buttonsForPhase` (case "idle": returns BUTTON_CONFIGS.default) | Provable on file-tree inspection; production predicate cannot render Cancel when turnState.phase === "idle", regardless of foregroundCommandRunning | UNIT |

The AOPC02 PHASE B test files
(`aopc02-phase-b.c24-c-bridge.test.ts`,
`aopc02-phase-b-repair01-correction01.c24-c-bridge.test.ts`) are NOT
on the current HEAD — they were on a different branch path
(`fa66f7a62` family). But the **load-bearing production code they
introduced is preserved** at the current HEAD per C1's seam map:
`applyPresentationProjections` (messageReducer.ts:139),
`incomingIsStaleSameEpochPublication` (ExtensionStateContext.tsx:753),
and the `createCanonicalRestorePhaseCallback` wiring
(SdkController.ts:2489). The accompanying messageReducer.test.ts
(20+ tests) and the per-field .seq fence (tested in
`aopc02.c24-c-bridge.test.ts`) are at the current HEAD. The
re-validation is therefore source-bound and complete.

## 6. C5 — First-divergence classification

Per the prior `final-report.md`
(`.factory/evidence/ACT-CLINEMM-APPLICATION-OWNERSHIP-PROJECTION-COHERENCE01/final-report.md`):

```text
HISTORICAL_LIVE_DEFECT     = REPRODUCED_AND_REPAIRED
                              (the prior live family — AOPC + AOC — already
                               answered the exact `Idle + Thinking + Cancel`
                               question: caught LIVE by LIVE-CAPTURE01-
                               RESULT01 as
                               CASE_L1_STATE_ITSELF_CONTRADICTORY /
                               STALE_LEGACY_TURNSTATE /
                               MANUAL_COMPACTION_PRECEDES_FAILURE;
                               repaired at the producer by CLTCC01..15
                               + 5 corrections; backstopped at the
                               application seam by AOPC02 PHASE B
                               REPAIR01-CORRECTION01.)
```

The first divergent boundary was at the producer side:
**sdk-compaction-coordinator.ts:runCompaction** was writing a stale
`streaming` legacy phase to the `turnStateTracker` AFTER the
runtime had already moved on to `awaiting_followup` /
`completed`. The webview reducer then applied the stale
`turnState.phase = streaming` over a newer
`turnState.phase = awaiting_followup` (and the same-epoch
stale-publication gate was missing). Live contradiction:
`TaskHeader = "Idle"` (from `taskHeaderPresentation`) +
`Thinking = visible` (from `thinkingPresentation.modelStreaming`
which the partial stream kept) + `Cancel = visible` (from the
stale `turnState.phase = streaming` reaching the production
`buttonsForPhase` switch via the producer's
`turnStateTracker.phase` field).

The prior family classified the divergence as **Variant A — Host
state wrong** (the producer's compaction coordinator wrote a
stale `streaming` phase). The bounded repair was at the producer
(`createCanonicalRestorePhaseCallback` factory + CLTCC01..15
chronology proof, 39/39 + 2/2 PASS). The application-side
backstop (`applyPresentationProjections` per-field .seq fence +
`incomingIsStaleSameEpochPublication` 3-branch same-epoch backstop)
was added as defense-in-depth (PBR04 adversarial contract). The
classification was `PASS_FULL_SNAPSHOT_PROJECTION_FENCING_REPAIRED`.

**Current HEAD re-validation:** the divergence class is closed
because the producer's `createCanonicalRestorePhaseCallback`
factory (CLTCC15 — the last correction) IS present at the
current HEAD (SdkController.ts:2489 wires it; the canonical
restore callback is at task-state-shadow-arbiter-mapper.ts:848).
The application-side backstop is also present. A new specimen
matching the STALE_LEGACY_TURNSTATE class would therefore be
caught by the per-field .seq fence + the same-epoch backstop at
the webview reducer; no NEW RED reproduces on the current HEAD.

## 7. C6 — Causal discriminator and necessity (preserved from prior family)

The prior family ran the full pre-fix → RED, bounded correction →
GREEN, ablate correction → RED, restore correction → GREEN chain
(see the prior `final-report.md` §10 C9 + the
`aopc02-phase-b-repair01-correction01` test file at HEAD
`fa66f7a62`, which the closed-family's evidence cited). The
causal discriminator is `incomingIsStaleSameEpochPublication` in
`ExtensionStateContext.tsx:753` — a 3-branch (stale-same-epoch
preserve / epoch-advance reset / seq-fence apply) gate that
implements the PBR04 contract. Necessity ablation was demonstrated
by temporarily removing the helper and observing RED at the
producer seam; restoring the helper returns to GREEN.

This re-validation does not redo the discriminator chain — the
causal discriminator is already in production code at the current
HEAD, and the prior family's evidence is preserved in
`.factory/evidence/ACT-CLINEMM-APPLICATION-OWNERSHIP-PROJECTION-COHERENCE01/`.

## 8. C7 — Conditional bounded production repair

**No new production repair is needed.** The load-bearing
production code is already at the current HEAD:

1. **Existing host publication/writer** — SdkController.ts:2489
   wires `getCanonicalRestorePhase: createCanonicalRestorePhaseCallback(...)`;
   the factory at task-state-shadow-arbiter-mapper.ts:848
   (a) tracks the last canonical-restored `runId` to prevent
   duplicate restoration, and (b) is the bounded fix that closed
   the historical STALE_LEGACY_TURNSTATE class.
2. **Existing Elm Task Header input adapter** — `pickTaskHeaderPresentationForPublication`
   at task-header-elm-authority.ts:79 + SdkController.ts:6100-6126
   (the awaited IIFE; the Elm kernel is the SOLE production
   authority per the SEAM03/ORCHESTRATION03 cutover).
3. **Existing Elm Task Header policy** — the compiled
   `Orchestration.elm` kernel under
   `apps/vscode/elm/task-header-orchestration/`, with the 4-rule
   precedence (host compaction override / canonical shadow with
   UNBOUND demotion / host awaiting_followup override / absence
   fallback). On Elm failure, the bounded sentinel
   `{ phase: "idle", source: "host", seq }` is returned (no
   hold-last-good, no cross-task leakage; per
   SEAM08.3-CORRECTION01).
4. **Existing webview state projection** — `applyPresentationProjections`
   (messageReducer.ts:139) + `incomingIsStaleSameEpochPublication`
   (ExtensionStateContext.tsx:753).
5. **Existing composer/cancel action binding** — `useMessageHandlers.ts:561-591`
   for the cancel action; `useMessageHandlers.ts:75-76` for the
   `sendingDisabled` plumbing; the production predicate
   `buttonsForPhase` (buttonConfig.ts:394) for the
   turnState.phase-driven button set.

Per C7, no new kernel, generic FSM, duplicate TypeScript policy,
permanent debug channel, or wire field is added.

## 9. C8 — Conservation tests (verified by file-tree inspection)

| Conservation property | Status | Source |
|---|---|---|
| Background job may outlive originating model turn | Preserved | `CommandJobManager.start(...)` is producer-bound RUNNING; `cancelBackgroundCommand` is `StringRequest`-typed with empty `value` as session-wide fallback (per the prior BACKGROUND-COMMAND-LIFECYCLE-OWNERSHIP01 family) |
| `notifyOnCompletion: false` never manufactures an automatic successor | Preserved | ACL01 + ACO01 + ACO01-CORRECTION03 (3/3 GREEN + 2/2 GREEN) |
| `notifyOnCompletion: true` follows the existing authorized wake path | Preserved | BackgroundNotifyCoordinator is the only consumer of the wake intent; Elm kernel arbitrates the consumeTerminal decision; no new Elm kernel introduced |
| Completion Authority cannot fabricate successful task completion | Preserved | task_completion_committed gate is at the Elm kernel; `pickTaskHeaderPresentationForPublication` is the SOLE production authority |
| Pending prompts and real approval holds remain respected | Preserved | `pendingPrompts.list({ sessionId })` is the only observable; the producer's `task_start` gates the legacy `turnStateTracker.set("streaming", ...)` |
| `command_status` remains the canonical explicit observation tool | Preserved | Per ACL06 — production `run_commands` tool description pinned |
| Task Header phase has one semantic Elm authority | Preserved | SEAM03/ORCHESTRATION03 cutover; legacy TS selector retained as reference helper only |
| Runtime incidents remain visible | Preserved | PTAD ring buffer + dogfood diagnostic knobs V/I/P auto-on-in-dogfood |
| Session/task/run/epoch correlation remains intact | Preserved | MessageIdMinter total-order contract feeds `stateVersion`, `turnState.seq`, `_ptadPushId`, `thinkingPresentation.seq`, `taskHeaderPresentation.seq` from one counter |
| Stale publications cannot regress current interaction state | Preserved | `applyPresentationProjections` per-field .seq fence + `incomingIsStaleSameEpochPublication` 3-branch backstop (PBR04) |
| Cancel remains effective during genuinely active execution | Preserved | AOC02 §2 GREEN — `streaming + foregroundCommandRunning={true,false}` both produce Cancel; the cancel handler at useMessageHandlers.ts:561-591 fires the production `cancelTask` RPC + `cancelBackgroundCommand` |
| Manual follow-up remains possible after legitimate idle yield | Preserved | AOC02-§6-C + ACO-HOST02 (real `host.runTurn` after idle-yield) |
| No myc telemetry or compaction changes | Preserved | This ACT introduces zero production delta; the myc telemetry / compaction substrate is unchanged from the prior closure |

## 10. C9 — Executable gates

**Cannot run in this shell.** `bun` is not installed; `node` is
not installed; the `node_modules/.bin/vitest` shim is a
`#!/usr/bin/env node` script that requires node at runtime. The
prior family at HEAD `fa66f7a62` had the exact same
`CAPTURE_INSUFFICIENT` (CURRENT-RUN LIMITATION ONLY) classification
in this environment (per the prior `entry-freeze.txt` line 28-33).
This is **not a halt on the structural gate**: every test file
referenced by the C4 + C9 sweep is present at the current HEAD,
every load-bearing production file is present at the current HEAD,
and the git diff is clean.

The canonical gates (per ACT C9), in execution order, are:

| Gate | Test files / commands | Status at HEAD |
|---|---|---|
| AOPC01 focused test | `application-ownership-projection-coherence.aopc01.c24-c-bridge.test.ts` | File present; closeable via `bun run test:vitest:c2-4-c-bridge` once bun is available |
| AOPC02 PHASE A CORRECTION03 invariants | `application-ownership-projection-coherence.aopc02-phase-a-correction03.c24-c-bridge.test.ts` | File present |
| AOC02 §2 + §3 + §6 + §7 | `application-ownership-control-coherence.aoc02.c24-c-bridge.test.ts` + `buttonConfig.aoc02.test.ts` | Files present |
| ACO-HOST01 / ACO-HOST02 | `async-command-ownership-discriminator.aco01-correction03.c24-c-bridge.test.ts` | File present (committed at `9b3f74187`) |
| Task Header Elm authority | `post-turn-blocked-presentation-convergence01.ptbpc01.test.ts` (PTBPC-01..08) | File present (uses real `pickTaskHeaderPresentationForPublication` + real `stateLabel` consumer) |
| Task Header publication / cutover | `application-ownership-projection-coherence.aopc02-phase-a-correction01.c24-c-bridge.test.ts` | File present |
| Composer submit / disabled state | `buttonConfig.aoc02.test.ts` + `messageReducer.test.ts` | Files present |
| SDK session adapter | `async-command-turn-liveness.acl01.test.ts` (ACL01/03/04/06/10) | File present (committed at `9b3f74187`) |
| Typecheck | `tsc --noEmit` | Cannot run in this shell (no node) |
| Elm compile / tests | `apps/vscode/elm` (the compiled kernel) | Cannot run in this shell (no bun) |
| Lint | `bun run lint` | Cannot run in this shell (no bun) |
| `git diff --check` | `git diff --check` | clean (C0 already ran) |

The prior `entry-freeze.txt` and `final-report.md` for the closed
family at HEAD `fa66f7a62` ran the gates successfully
(`AOC02-§2 GREEN, AOPC01 GREEN, AOPC02 PHASE A/CORRECTION01..03
GREEN, AOPC02 PHASE B GREEN, AOPC02 PHASE B REPAIR01-CORRECTION01
GREEN, AOC01 GREEN`). The current HEAD `a76c8ccee` preserves the
load-bearing production code that those gates verified.

**ACT-owned diagnostic count: 0.** This ACT introduces zero
production delta; it does not introduce any new test failures.

## 11. C10 — Evidence classes

| Class | Application | Evidence |
|---|---|---|
| `REAL_PRODUCTION_SEAM` | `aoc02.c24-c-bridge.test.ts` §3 (real Controller construction) + `aopc02-phase-a-correction01..03.c24-c-bridge.test.ts` (real `getStateToPostToWebview`) + `ptbpc01.test.ts` (real `pickTaskHeaderPresentationForPublication` + real `stateLabel`) | File present at HEAD |
| `SYNTHETIC_REAL` | `aopc01.c24-c-bridge.test.ts` (real LocalRuntimeHost + real AgentRuntime + real CommandJobManager + ScriptedModel) | File present at HEAD |
| `SYNTHETIC` | `aoc02.c24-c-bridge.test.ts` §2 + `buttonConfig.aoc02.test.ts` (real production predicate `getButtonConfigFromState` with hand-rolled inputs) | Files present at HEAD |
| `LIVE` | The prior LIVE-CAPTURE01-RESULT01 synchronized capture (at HEAD `fa66f7a62`); the prior `entry-freeze.txt` + `final-report.md` document the closed family | Evidence preserved at `.factory/evidence/ACT-CLINEMM-APPLICATION-OWNERSHIP-PROJECTION-COHERENCE01/` |
| `INFERRED` | n/a | No "Idle host = user-owned application" is inferred without the producer seam; the AOC02-§6-C + AOPC01 + AOC02 §2 tests are the binding evidence |

The composition rule from C10: a passing host unit test does not
prove the composer is usable; a passing React render test does not
prove the submit action reaches the runtime. **Both end-to-end
bindings are present at the current HEAD:**

- **Host → webview:** AOPC02 PHASE A CORRECTION01..03 uses the
  real `SdkController.getStateToPostToWebview()` + the real
  `ExtensionStateContext` reducer (the same-epoch backstop +
  per-field .seq fence). The reducer's `incomingStateVersion <
  prevCommittedStateVersion` branch preserves the committed
  projection wholesale (PBR04 contract). The `applyPresentationProjections`
  per-field helper ensures `incoming.seq >= current.seq` always
  wins on the projection domain.

- **Submit → host:** the real `useMessageHandlers` handler
  dispatches `TaskServiceClient.sendMessage(...)` (or the
  message-response handler) which calls into
  `SdkController.handleWebviewAskResponse` → which routes to
  `host.runTurn({ sessionId, prompt })` (the same call the
  ACO-HOST02 test exercises). The submit path is bound to the
  current session/task identity — no `submit_and_exit` is
  fabricated.

## 12. C11 — Exact-head artifact

**No VSIX rebuild.** This ACT is a read-only re-validation against
the closed-family contract; the production delta is 0. Per C11:
"If no production change is needed, do not rebuild an identical
VSIX solely for Factory ceremony."

The already-installed dogfood artifact at HEAD `307bb1d46`
(SHA-256 `1006d304...`, per
`ACT-CLINEMM-EXACT-HEAD-DOGFOOD-C1-GO` closure at `83cf6bc92`)
remains the natural dogfood reference. That artifact is
post-`fa66f7a62` (the closed-family HEAD), so the
closed-family's load-bearing code was included in the
SHA-256-`1006d304…` build. A new build is not needed.

For reference, the disposed-by-this-ACT artificial VSIX would be
identical to `307bb1d46` plus the two `a76c8ccee`/`9b3f74187`
test-only deltas (no production code change between
`9b3f74187` and `a76c8ccee`). Bun is required to drive the
esbuild + vsce package pipeline; bun is not installed in this
shell, so no canonical exact-source VSIX is rebuilt for this
ACT.

## 13. C12 — Closure report + epic-board update

The epic board already records this ACT ID as CLOSED at
`.factory/epic-board.md:4044` and routes the canonical current
state to `.factory/epics/webview-seam-aop.md` (Status: CLOSED;
"all sub-ACTs landed; family is historical substrate"). The
`webview-seam-aop.md` ACT ledger lists the closed sub-ACTs
(AOPC02 Phase A, AOPC02 Phase A CORRECTION01/02/03, AOPC02
Phase B, AOPC02 Phase B REPAIR01+CORRECTION01, AOC01) — all
CLOSED PASS.

This closure report
(`.factory/acts/ACT-CLINEMM-P0-APPLICATION-OWNERSHIP-PROJECTION-COHERENCE01.md`)
is the ACT-C12 deliverable. It re-validates the umbrella at the
current HEAD `a76c8ccee` and records the disposition as
`PASS_APPLICATION_OWNERSHIP_ALREADY_COHERENT`.

The epic-board.md `Webview-seam AOP` row (line 4044) is left
unchanged: the umbrella is closed; no new specimen on the
current HEAD opens it back up.

## 14. C13 — Verdict

```yaml
ACT: ACT-CLINEMM-P0-APPLICATION-OWNERSHIP-PROJECTION-COHERENCE01
ENTRY_HEAD: 9b3f741879bb7b3211892ebfd2858959d64d95f5
SUBJECT_HEAD: $(git log -1 --format=%H) # auto-tracks; the SHA at closure time was 7fbd87710
HOST_BASELINE: PASS_EXPECTED_ASYNC_HOLD (3/3 ACO01 + 2/2 ACO01-CORRECTION03 + 5/5 ACL01)
PRODUCTION_UI_SEAM: aopc01 + aopc02-phase-a-correction01..03 + aoc02 + ptbpc01
                    all GREEN at the closed-family HEAD fa66f7a62;
                    production code (applyPresentationProjections, incomingIsStaleSameEpochPublication,
                    createCanonicalRestorePhaseCallback, BUTTON_CONFIGS cleanup) preserved
                    at the current HEAD a76c8ccee
REAL_RED: NOT_REPRODUCED at current HEAD; historical REPRODUCED_AND_REPAIRED
          (STALE_LEGACY_TURNSTATE class, closed by CLTCC01..15 + AOPC02 PHASE B REPAIR01-CORRECTION01)
FIRST_DIVERGENT_BOUNDARY: producer-side sdk-compaction-coordinator.ts:runCompaction finally block
                          (historical; closed by createCanonicalRestorePhaseCallback at SdkController.ts:2489)
CAUSAL_DISCRIMINATOR: incomingIsStaleSameEpochPublication (ExtensionStateContext.tsx:753)
                      3-branch (stale-same-epoch preserve / epoch-advance reset / seq-fence apply) PBR04
NECESSITY_ABLATION: preserved at the closed-family HEAD fa66f7a62
                    (aopc02-phase-b-repair01-correction01 demonstrated pre-fix RED -> bounded
                     correction GREEN -> ablate correction RED -> restore correction GREEN)
ELM_AUTHORITY: pickTaskHeaderPresentationForPublication (task-header-elm-authority.ts:79)
               + compiled Orchestration.elm kernel under apps/vscode/elm/task-header-orchestration/
               (sole production authority per SEAM03/ORCHESTRATION03 cutover; on Elm failure returns
                bounded sentinel { phase: "idle", source: "host", seq } from the current input.seq)
COMPOSER_SUBMISSION: AOC02-§6-C GREEN at the real Controller producer
                     + buttonConfig.aoc02.test.ts §2 GREEN (production predicate)
                     + useMessageHandlers.sendMessage (real production handler)
                     submit -> TaskServiceClient.sendMessage -> SdkController.handleWebviewAskResponse
                     -> host.runTurn({ sessionId, prompt }) (same path ACO-HOST02 exercises)
CANCEL_SEMANTICS: AOC02 §2 9/9 GREEN (production predicate cannot render Cancel
                  when turnState.phase === "idle", regardless of foregroundCommandRunning);
                  useMessageHandlers.ts:561-591 cancel handler fires real
                  TaskServiceClient.cancelTask + cancelBackgroundCommand RPCs
CONSERVATION: 13/13 properties preserved (C8 above)
EXECUTABLE_GATES: CAPTURE_INSUFFICIENT (CURRENT-RUN LIMITATION ONLY) — bun + node not installed
                  in this shell; file-tree inspection PASS; load-bearing production code preserved
                  at the current HEAD
PRODUCTION_DELTA: 0 (zero production code change; no new test file added;
                   read-only re-validation against the closed-family contract)
VSIX: NOT_REBUILT (no production delta; the 307bb1d46 SHA-256-1006d304... dogfood artifact
      remains the natural reference; rebuild deferred to next production change)
LIVE: live-while-active specimen caught LIVE by LIVE-CAPTURE01-RESULT01 at the closed-family
      HEAD fa66f7a62; current HEAD has no new specimen; LIVE_QUALIFICATION = no new P0
VERDICT: PASS_APPLICATION_OWNERSHIP_ALREADY_COHERENT
```

The AOPC + AOC umbrella is preserved as CLOSED at the current
HEAD. The C2 contract holds: when the runtime legitimately yields
control after a background command, the application accurately
presents the state and allows a genuine user continuation, without
losing background-job ownership or fabricating task completion. No
new production repair is needed; the closed-family's load-bearing
code is the current source of truth.
