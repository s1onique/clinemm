# EPIC-TASK-CONTROL-LIVENESS

> Task-control lifecycle: generation-fence repair (`TASK-CONTROL-LIVENESS01` + `FIX01`), queued-prompt stop/resume integrity, and the `STOP THIS BUG FAMILY` closure that consolidates the recurring class of message-coordinator invariant violations. See `.factory/epic-board.md` for the active index and links to in-flight epics.

## Current status

- Status: CLOSED family (the generation-fence repair is bounded and live; the queued-prompt integrity work is bounded; the bug-family closure is a structural statement of how to recognize this class of bug in future reviews)
- Priority: P1 (production-correctness substrate for message-coordinator interactions)
- Current frontier: see board row 22 (`CLASSIC-PROTECTION-RECON01`) for the unblocked next-frontier after Safe-YOLO closure; task-control-liveness work is in the historical substrate
- Blocked by: n/a

## Contract / durable conclusions

- **Generation-fence invariant.** A task's generation counter must strictly advance across live turns; stale state must not be allowed to commit a partial update. The repair (`FIX01`) lands a bounded generation-fence that holds across the live-task boundary.
- **Queued-prompt stop/resume integrity.** When a task is paused or stopped mid-queue, queued prompts must not be silently dropped or replayed against an out-of-date state. The integrity ACT establishes the boundary.
- **Stop-this-bug-family recognition.** When a `message-coordinator` invariant is violated and the cause is `generation-counter` drift across the live task boundary, the family is identified and closed; further occurrences go to the same family (FACT-003-style residue recognition).

## ACT ledger

| ACT / Source ID | Verdict | Source line range (pre-sharding) | Purpose |
|---|---|---|---|
| `ACT-CLINEMM-TASK-CONTROL-LIVENESS01` (+ `FIX01`) | CLOSED (RECON + Phase 2 + Phase 5 — bounded generation-fence repair landed) | L4227-4385 | Generation-fence repair |
| `ACT-CLINEMM-QUEUED-PROMPT-STOP-RESUME-INTEGRITY01` | CLOSED first commit (corrected after Factory review) | L4386-4503 | Queued-prompt stop/resume integrity |
| (Sub-family: `MESSAGE-COORDINATOR-INVARIANT-VIOLATION-SURFACING01`) | CLOSED via "STOP THIS BUG FAMILY" | L4504-4544 | Bug-family structural statement |
| `ACT-CLINEMM-QUEUED-PROMPT-STOP-RESUME-INTEGRITY01` (re-stated in section 32) | CLOSED (same ACT, second reference) | L4504-4544 | Cross-reference |

## Open work

None directly in this epic. The current frontier for this domain is **post-sharding review** — any new message-coordinator invariant violation should be evaluated against the bug-family signature before starting a fresh ACT.

## Deferred work

None.

## Historical detail

The text below is migrated verbatim from the prior single-file `.factory/epic-board.md` (L4227-4544, pre-sharding) so the durable conclusions remain anchored to their source lines. **Do not rewrite history here unless the underlying ACT itself is being amended.** Each fenced payload is one board section preserved bit-for-bit (with leading/trailing separator trims documented in the section header).

### TASK-CONTROL-LIVENESS01 / FIX01 — RECON + PHASE 2 + PHASE 5 (bounded generation-fence repair landed) — L4227-4385 (pre-sharding)

````text
SOURCE: .factory/epic-board.md L4227-4385 (pre-sharding). VERBATIM: yes; trims: leading/trailing blank lines collapsed

## ACT-CLINEMM-TASK-CONTROL-LIVENESS01 / FIX01 — RECON + PHASE 2 + PHASE 5 (bounded generation-fence repair landed)

**HEAD**: `e6996ee7793520216804839764b26fe7efb9f513` (TREE `cb656bb296a709d5d981eb8c52c812854be406ae`)
**LOCAL_AHEAD**: 9 commits ahead of `origin/main` (`c4d1db8b4`)
**STATUS**: `CLASSIFIED_BUT_REPAIR_LANDED` — bounded generation-fence repair landed in Phase 2; Phase 4 ablation proved the fence is load-bearing; Phase 5 retargeted PARENT02 to the repaired top-level path; pending LIVE qualification (L0..L5 per ACT §42) with a freshly-installed dogfood VSIX.

### Causal RED pinned at the production top-level user path

**Live witness (REAL / LIVE_UI)**: `Compact` click → silent no-op; second `New Task` click eventually recovers.

**TCL-PARENT01 (parental causal RED)** — `task=undefined, activeSession=session-B` after racing `initTask` against concurrent `clearTask`. The invariant spans two owners (`TaskProxy` via `SdkTaskControlCoordinator.setTask`; `activeSession` via `SdkSessionLifecycle.activeSession`); a lifecycle-only mutex cannot make the pair atomic.

### Repair (bounded generation fence)

- New shared authority `TaskOperationFence` at `apps/vscode/src/sdk/task-operation-fence.ts`. `begin()` / `isCurrent(token)` — explicit token carried by the originating operation.
- `SdkSessionLifecycle.startNewSession(startInput, operationToken?)` — discriminated return `{status: "started" | "superseded", ...}`. FENCE-FIRST ordering: token check BEFORE `endActiveSession` (the P0 the reviewer flagged), then check after each awaited boundary, then LOAD-BEARING POST-START check before installing `activeSession`.
- `SdkTaskControlCoordinator.clearTaskForOperation(token)` — internal clear that does NOT advance the fence. Used by `initTask` so the internal clear inherits the caller's token.
- `SdkTaskStartCoordinator.initTask` / `reinitExistingTaskFromId` — capture `operationToken = fence.begin()` at entry; fence check before each shared-state commit (`createAndSetTask`, `startNewSession`, history item, `setTurnPhase("streaming")`, `fireAndForgetSend`).
- **Hardening (CORRECTION)**: a superseded init MUST NOT call global `setTask(undefined)` (would erase newer task); it cleans up only resources it uniquely owns.

### Test status (post-FIX01)

| Test | Pre-FIX01 | Post-FIX01 |
|---|---|---|
| TCL09 (synthetic activeSession, no TaskProxy) | RED | RED — `KNOWN_HARDENING_RESIDUE` |
| TCL-REACH01 (STRUCTURAL conservation, 6 tests) | 6 GREEN | 6 GREEN |
| TCL-REACH02 PARENTAL (naked lifecycle) | RED | GREEN (retargeted to "fenced — no wedge produced") |
| TCL-REACH02 COMMON01 (second New Task recovery) | GREEN | GREEN |
| TCL-REACH02 COMMON02 (silent drop) | RED | RED — `KNOWN_HARDENING_RESIDUE` |
| TCL-PARENT01 (top-level user path) | RED | **GREEN** |
| TCL-PARENT02 (Compact silent no-op) | RED | **GREEN** (Phase 5: normal coordinator behavior through repaired top-level path) |
| TCL-PARENT03 (New Task recovery from wedge) | GREEN | GREEN (retargeted: racing initTask vs clearTask no longer produces the wedge; fresh initTask produces a clean pair) |
| ADVERSARIAL A (init A → clear) | RED | **GREEN** |
| ADVERSARIAL B (init A → init B) | RED | **GREEN** |
| ADVERSARIAL C (clear during host.start) | RED | **GREEN** |
| ADVERSARIAL D (stale A after B current) | RED | **GREEN** |
| ADVERSARIAL E (cleanup failure conserves B) | RED | **GREEN** |
| ADVERSARIAL F (stale reinit must not terminate B) | n/a | RED at HEAD, **GREEN** post-fix |

**Total**: 115 GREEN + 2 RED (both `KNOWN_HARDENING_RESIDUE`) across 10 test files.

Adjacent suites (conservation):
- `sdk-compaction-coordinator`: unchanged GREEN
- `sdk-task-control-coordinator`: 1 mock updated for `clearTaskForOperation` delegation
- `sdk-task-start-coordinator`: mocks updated for the discriminated return shape and the `operationToken` argument
- `sdk-message-coordinator`: unchanged GREEN
- `sdk-session-lifecycle`: unchanged GREEN

### Phase 4 ablation (working-tree only, no commit)

Temporarily disabled the POST-START fence check before `this.activeSession = {...}` (changed `if (operationToken !== undefined && !isCurrent(operationToken))` to `if (false && operationToken !== undefined && !isCurrent(operationToken))`). Result: `TCL-PARENT01` turned RED with the canonical wedge shape (`task=undefined, activeSession=defined(sessionId=session-B)`), confirming the fence is load-bearing rather than decorative. Restored immediately; no commit.

### Honest domain labeling

- **`FENCED DOMAIN`** = `initTask` ↔ `clearTask` / `showTaskWithId` / external `startNewSession` calls with tokens.
- **`LEGACY REBUILD DOMAIN`** = the four `replaceActiveSession` callers (mode / terminal / provider / MCP rebuilds). NOT covered by FIX01; threading tokens through these callers is a separate follow-up ACT (P2 recon residue).
- The optional `operationToken` parameter on `startNewSession` is the bypass for legacy callers; the discriminated return type is unchanged either way.

### `KNOWN_HARDENING_RESIDUE` — file `ACT-CLINEMM-MESSAGE-COORDINATOR-INVARIANT-VIOLATION-SURFACING01`

Two tests directly manufacture the wedge by calling `compactTask` / manipulating `messages.appendMessages` with `getTask() === undefined`. They assert that the silent-drop path is observable. The causal repair (`TaskOperationFence`) prevents the wedge from forming at the production seam, but it does NOT change `SdkMessageCoordinator.appendMessages` (which still has the `if (!task) return` guard). Per the reviewer's CORRECTION04 directive: "Do not weaken the lifecycle repair just to satisfy them. They are hardening tests, not causal-repair acceptance tests. Reclassify: `KNOWN_HARDENING_RESIDUE`. They directly manufacture an invariant-violating state."

Both tests remain RED and serve as a smoke-detector for the wedge if it ever re-emerges via a different path. A future `ACT-CLINEMM-MESSAGE-COORDINATOR-INVARIANT-VIOLATION-SURFACING01` can choose to harden the message coordinator's silent-drop into an explicit failure publication; this is out of scope for FIX01.

### No public/wire delta

- No `proto/*.proto` change.
- No `ExtensionMessage` change.
- No webview state field change.
- Internal-only orchestration correctness repair.

### Files changed (cumulative, all 9 commits)

| File | LoC delta |
|---|---|
| `apps/vscode/src/sdk/task-operation-fence.ts` | +66 (new) |
| `apps/vscode/src/sdk/SdkController.ts` | +31 |
| `apps/vscode/src/sdk/sdk-session-lifecycle.ts` | +138 / -1 |
| `apps/vscode/src/sdk/sdk-task-control-coordinator.ts` | +74 / -2 |
| `apps/vscode/src/sdk/sdk-task-start-coordinator.ts` | +110 / -3 |
| `apps/vscode/src/sdk/__tests__/task-control-liveness.tcl-parent.adversarial.test.ts` | +603 (A..F cases) |
| `apps/vscode/src/sdk/__tests__/task-control-liveness.tcl-parent.test.ts` | +110 / -110 |
| `apps/vscode/src/sdk/__tests__/task-control-liveness.tcl-reach02.test.ts` | +66 / -3 (PARENTAL GREEN retargeted) |
| `apps/vscode/src/sdk/__tests__/task-control-liveness.tcl-reach01.test.ts` | +5 |
| `apps/vscode/src/sdk/sdk-task-control-coordinator.test.ts` | +4 |
| `apps/vscode/src/sdk/sdk-task-start-coordinator.test.ts` | +39 / -4 |

### Commits (all test-only except Phase 2)

- `089eefa7b` test(sdk): pin parental top-level initTask race RED at production seam (TCL-PARENT01-03)
- `2ee94160a` test(sdk): pin adversarial concurrency envelope RED at production seam (TCL-PARENT-ADVERSARIAL01)
- `7e215278c` test(sdk): credential hygiene + corrected fence-contract doc (TCL-PARENT-ADVERSARIAL01a)
- `bcfc1362b` test(sdk): pin ADVERSARIAL F (stale reinit must not terminate current B) RED at production seam
- `9f3ab71ce` fix(sdk): add bounded generation-fence for task/session pair (FIX01 / Phase 2) — the only commit with production code change
- `e6996ee77` test(sdk): retarget TCL-PARENT02 through the repaired top-level Compact path (Phase 5)

### Quality gates

- `apps/vscode typecheck`: 0 diagnostics
- `git diff --check` (HEAD~5..HEAD): PASS
- Cumulative vitest suite (the 10 affected test files): 115 GREEN + 2 RED
- Phase 4 ablation: PARENT01 turns RED with the canonical wedge when the load-bearing fence check is disabled
- No push, no force-push, no amend of published commits
- Protected evidence preserved (`STASH_141372c52`, `STASH_371752f71`)

### Pending: LIVE qualification

After this commit, the LIVE qualification chain (L0..L5 per the original ACT §42) requires a freshly-installed dogfood VSIX with the new build, and:

- **L0**: normal New Task flow
- **L1**: provoke rapid New Task / task clear/start transition if safely possible
- **L2**: Compact works or explicitly rejects
- **L3**: New Task works first try
- **L4**: first prompt starts
- **L5**: no Idle/orphan session contradiction

Per the reviewer's directive: "Do not claim natural-race reproduction if not observed." The closure verdict can move to `PASS_LIVE_TASK_CONTROL_LIVENESS` on the first dogfood cycle where the original L0..L5 reproducer is observed to behave correctly.

### NEXT ACT (NOT auto-promoted)

`ACT-CLINEMM-MESSAGE-COORDINATOR-INVARIANT-VIOLATION-SURFACING01` (P2 hardening, follow-up) — see the `KNOWN_HARDENING_RESIDUE` block above. Optional; reviewer's directive does not require it.

### CORRECTION01 closure mechanics (per Factory reviewer)

Per reviewer disposition `PASS_REPAIR_WITH_ONE_P1_CLOSURE_DEFECT`, three bounded mechanics landed after the initial closure commit:

- `611a831b5` **fix(sdk): tighten StartNewSessionResult discriminated union; no fake sdkHost on "superseded"** — production code only; removes the `undefined as unknown as SdkSessionHost` cast on pre-host fence paths; `"superseded"` now carries no `sdkHost` (the caller has nothing to use it for); post-start fence path optionally carries `startedSessionId` for observability.
- `154aad879` **test(sdk): dispose TCL09 + COMMON02 as passing KNOWN_HARDENING_RESIDUE witnesses** — test-only; both tests now assert the CURRENT silent-drop contract (with explicit `EXPECTED_CURRENT_BEHAVIOR` / `PRODUCT_DESIRED_BEHAVIOR` / `FOLLOWUP_ACT` annotation) instead of asserting that the silent drop is gone. Causal tests (PARENT01, REACH02, A–F) remain normal GREEN acceptance gates — NOT weakened.
- `3c1d5053f` **board(epic): this ACT closed pending LIVE** — force-added the board row through `.gitignore` so the disposition is durable in Git terms.

### Test status (post-CORRECTION01)

| Bucket | Pre-CORRECTION01 | Post-CORRECTION01 |
|---|---|---|
| All 10 affected test files | 115 GREEN + 2 RED (TCL09 + COMMON02 as RED acceptance tests) | **117 GREEN + 0 RED** (TCL09 + COMMON02 disposed as passing KNOWN_HARDENING_RESIDUE witnesses) |
| `apps/vscode typecheck` | 0 diagnostics | 0 diagnostics |
| `git diff HEAD~9..HEAD --check` | PASS | PASS |

HEAD = `3c1d5053f`. LOCAL_AHEAD = 12 commits ahead of `origin/main`.

### Honest PARENT02 wording (per reviewer)

PARENT02 (Phase 5 rewrite) verifies:

- repaired race leaves `task=undefined` and `activeSession=undefined`;
- calling `compactTask()` preserves that clean state;
- no new `Logger.error` appears.

It does NOT actually assert an explicit user-visible rejection. The captured warning count is not asserted, and a `Logger.warn` would not by itself prove that the webview received anything.

- `COMPACT_AFTER_REPAIRED_RACE` = normal no-session coordinator branch reached; no error-level failure; clean pair invariant preserved
- `USER_VISIBLE_COMPACT_REJECTION` = LIVE_PENDING / not proven by PARENT02

That is fine. Exact-head LIVE qualification owns the UI claim.

### Board validator

The two pre-existing board validator failures at L204 / L207 are P2 / historical (visible in board history before FIX01 began). They MUST NOT block this ACT and are explicitly NOT fixed here.
````

### QUEUED-PROMPT-STOP-RESUME-INTEGRITY01 — first commit (corrected after Factory review) — L4386-4503 (pre-sharding)

````text
SOURCE: .factory/epic-board.md L4386-4503 (pre-sharding). VERBATIM: yes; trims: leading/trailing blank lines collapsed

## ACT-CLINEMM-QUEUED-PROMPT-STOP-RESUME-INTEGRITY01 — first commit (corrected after Factory review)

**STATUS:** `CASE_Q2_TRANSCRIPT_RESTORE_REPLAYS_TOOL_REQUEST = NOT_REPRODUCED` (narrowed per Factory reviewer disposition). At the core Stop→Resume composition (real `LocalRuntimeHost + SessionRuntime + AgentRuntime`, transcript-intact, post-Stop Resume, upstream chronology P2-while-P1-running, production Resume entrypoint `readLiveSessionMessages` → fresh-host `startSession({ initialMessages })` → `runTurn`), the loss-of-completed-tool-result-blocks causal hypothesis for upstream #12975 is ruled out at this seam. The broader provider-dependent behavioral replay (framing, span selection, salience, reconstructed user turns, etc.) remains NOT_EXERCISED by this test. The synthetic StepModel collapses the upstream question to one specific causal hypothesis; this is a necessary, not sufficient, result for the global "upstream defect absent at this fork" claim.

(Initial commit `e6272bb4e` claimed `PASS_PRODUCTION_SEAM_GREEN_HOST_QUEUE_ABORT` — too strong. The second commit `e5a699695` corrected to `HALT_RED_NOT_REPRODUCED` but the Factory reviewer's `HALT_TEST_SEAM_INVALID` disposition flagged two P0 gaps (queue precondition, Resume entrypoint). The third commit added `QPSR03_PRODUCTION_CHRONOLOGY` to close both P0s. Per the reviewer's most recent narrowing, the verdict is now `CASE_Q2 = NOT_REPRODUCED` rather than the global `HALT_RED_NOT_REPRODUCED`.)

**ENTRY_HEAD (corrected, third commit):** HEAD on `act/task-interaction-ownership-projection01-live-capture` (post-third-commit).
**BRANCH:** `act/task-interaction-ownership-projection01-live-capture` (no new branch created — existing LIVE-Capture branch used, per Factory reviewer disposition).

**Recon doc:** `docs/architecture/elm/queued-prompt-stop-resume-integrity01-recon.md` (now §15 explains the real-composition discriminator).

**Tests** (bridge-only):
`apps/vscode/src/sdk/__tests__/queued-prompt-stop-resume-integrity.qpsr01.c24-c-bridge.test.ts`
(6 tests, 0 collateral damage; full bridge suite 81/81 PASS; full apps/vscode vitest 2023/2023 PASS in 51.44s; base check-types EXIT=0; board validator OK).

The new `QPSR03_PRODUCTION_CHRONOLOGY` test (third commit) closes the two P0s the Factory reviewer flagged against `e5a699695`:
- **Witness #1** — P1 is provably active when P2 is submitted (c1Count === 1 before queue submission).
- **Witness #2** — P2 enqueue is observed via the host's `pending_prompts` event surface (NOT inferred from the `delivery:"queue"` label).
- **Witness #3** — P2 drain is observed via `pending_prompt_submitted` AFTER P1 finishes, AND C3 has begun executing.
- **Witness #4** — Resume enters through the PRODUCTION entrypoint: `readLiveSessionMessages` → fresh-host `startSession({ initialMessages })` → `runTurn`. This mirrors `SdkFollowupCoordinator.resumeSessionFromTask` exactly (the lifecycle does NOT just call `runTurn` on the live session; it reloads the transcript into a fresh session).

C3 is wrapped in a deferred executor that races its release-promise against `AgentToolContext.signal`, so `agent.abort()` (called by `host.abort`) deterministically interrupts C3 mid-tool. **Caveat**: C3's executor itself returns `success:true` when abort wins — it does NOT throw. This is a structural mirror of the failure timing, NOT a faithful reproduction of the production executeTurn throw path. What the test really proves is the *window*: C3 executor entered (`c3Count === 1`), Stop landed before release, the host's own `abort()` machinery drove status to `"idle"`. See recon §15.2 for the full caveat.

**Composition:**
- REAL: `LocalRuntimeHost`, `SessionRuntime` orchestrator, `AgentRuntime`, `FileSessionService`, `ConversationStore` (all production classes via bridge aliases).
- SYNTHETIC_REAL: scripted `StepModel` (data-dependent on the messages array — emits a `tool-call-delta` for `c1-replay` ONLY if the prior C1/C2 tool results are absent from the transcript), counter-backed `run_c1` / `run_c2` / `run_c3` `AgentTool.execute()`, `requestToolApproval = approve-all` (replaces VS Code approval UI).
- NOT_EXERCISED: VS Code approval UI, real LLM provider, CLI/desktop-app sidecar, the `host.restoreSession({ restore: { messages: true } })` path (production Resume in VS Code is `startSession({ sessionId, prompt })` on the LIVE session, NOT `restoreSession` — recon §15.1).

**Chronology (per recon §15, §15.2):**

*QPSR01 (host queue + abort controls only):*
1. `startSession({ sessionId: S, prompt: P1 })`
2. `runTurn(P1)` → completed.
3. `runTurn(P2, { delivery: "queue" })` → enqueued → drain fires `agent.continue()` → completed.
4. `host.abort(S, "user-pressed-stop")` → status settles to `"idle"`.

*QPSR02 (real composition, simplified Resume):*
1. `startSession({ sessionId: S, prompt: P1 })` (no prompt — agent bootstrapped idle).
2. `runTurn(P1)` → model emits `run_c1` (`c1Count = 1`) → `run_c2` (`c2Count = 1`) → text → completed. ConversationStore accumulates `[user-P1, asst(C1), tool(C1_result), asst(C2), tool(C2_result), asst-text]`.
3. `runTurn(P2, { delivery: "queue" })` → enqueued → drain fires `agent.continue()` → `run_c3` (`c3Count = 1`).
4. `host.abort(S, "user-pressed-stop")` → abort reaches agent exactly once → status settles to `"idle"`.
5. **RESUME** (simplified): `runTurn({ sessionId: S, prompt: "Resume P2" })`. The `StepModel` inspects the messages array; it found `tool-result for qpsr-c1` AND `tool-result for qpsr-c2` present, so it emitted a `text-delta` continuation (NO replay).
6. Assertions: `c1Count === 1`, `c2Count === 1`, `finishReason === "completed"`.

*QPSR03 (real composition, upstream chronology, production Resume entrypoint — third commit):*
1. `startSession({ sessionId: S })` (no prompt).
2. `runTurn(P1)` started WITHOUT awaiting completion. **Witness #1**: wait until `c1Count === 1` AND `session.status === "running"` (P1 is provably active).
3. **Witness #2**: `runTurn({ sessionId: S, prompt: P2, delivery: "queue" })` submitted while P1 is still executing. The host emits `pending_prompts` with P2 in `prompts[]` AND `delivery === "queue"`. The queue precondition (`!canStartRun() && interactive → "queue"`) is genuinely exercised.
4. `await p1Promise` → P1 completes → `canStartRun()` flips TRUE → `scheduleDrain` → `drain` → `runTurn` → `run_c3.execute()` (deferred, blocks on release-vs-abort-signal race). **Witness #3**: `pending_prompt_submitted` event observed for P2; `c3Count >= 1` (C3 currently executing).
5. `firstHost.abort(S, "user-pressed-stop")` → `session.aborting = true` → `agent.abort(reason)` → `abortController.signal` aborted → `run_c3.execute()`'s gate unblocks via signal (executor returns success:true — synthetic, see recon §15.2 caveat; NOT a faithful reproduction of the production executeTurn throw). The host's `abort()` machinery itself drives `completeAbortedInteractiveTurn` → status `"idle"`. **This is the upstream Stop window.**
6. **Witness #4 prep**: `firstHost.readLiveSessionMessages(S)` → `initialMessages`. `firstHost.dispose()`.
7. **Witness #4**: construct SECOND `LocalRuntimeHost` against the SAME `FileSessionService` → `secondHost.startSession({ sessionId: S, initialMessages, ... })` → `secondHost.runTurn({ sessionId: S, prompt: "Resume P2" })`. The resume-only `StepModel` inspects `initialMessages` and emits text continuation (NO replay).
8. Assertions: `c1Count === 1`, `c2Count === 1`, `p2EnqueueObserved >= 1`, `p2DrainCount >= 1`, `finishReason === "completed"`.

**Test outputs (final state from `console.log` in the QPSR02 + QPSR03 tests):**
```
[QPSR02_REAL_COMPOSITION]
{
  "c1Count": 1,
  "c2Count": 1,
  "c3Count": 1,
  "finishReason": "completed",
  "classification": "HALT_RED_NOT_REPRODUCED — transcript intact, C1/C2 not replayed"
}

[QPSR03_PRODUCTION_CHRONOLOGY]
{
  "c1Count": 1,
  "c2Count": 1,
  "c3Count": 1,
  "p2EnqueueObserved": 1,
  "p2DrainCount": 1,
  "finishReason": "completed",
  "preResume": {
    "c1Count": 1,
    "c2Count": 1,
    "c3Count": 1,
    "p2EnqueueObserved": 1,
    "p2DrainCount": 1
  },
  "classification": "HALT_RED_NOT_REPRODUCED — C1/C2 durable transcript conservation across Stop→Resume"
}
```

**Classification (per ACT §7 — corrected, third commit, narrowed per Factory reviewer disposition):**

```
CASE_Q2_TRANSCRIPT_RESTORE_REPLAYS_TOOL_REQUEST = NOT_REPRODUCED
C1/C2_TOOL_RESULT_DURABILITY_ACROSS_RESUME      = PROVEN
P2_QUEUE_ENQUEUE                                 = PROVEN
P2_QUEUE_DRAIN                                   = PROVEN
PRODUCTION_RESUME_BOOTSTRAP                      = SYNTHETIC_REAL_COMPOSITION_PROVEN
UPSTREAM_BEHAVIORAL_REPLAY                       = NOT_FULLY_DISCRIMINATED
C3_ABORT_RESULT_SEMANTICS                        = SYNTHETIC  (returns success:true; production executeTurn-throw path NOT faithfully reproduced)
```

- **At this seam** (real composition, transcript-intact, post-Stop Resume, upstream chronology, production Resume entrypoint), the ConversationStore retains the T1 transcript through Stop, the second host's startSession-with-history bootstrap loads the transcript, and the resumed `agent.continue()` sees both prior tool results in `request.messages` and emits a text-delta continuation rather than a tool-call replay.
- **What the test proves**: the loss-of-completed-tool-result-blocks causal hypothesis for upstream `#12975` is ruled out at the core Stop→Resume composition.
- **What the test does NOT prove**: that a real provider cannot choose to replay given a preserved history (framing, span selection, salience, reconstructed user turns, etc.). Those hypotheses are not exercised by the synthetic StepModel.
- The QPSR03 discriminator is necessary, not sufficient, for the global "upstream defect absent at this fork" claim.
- C3 abort semantics are synthetic: the deferred executor returns `success:true` on either path (release or signal-abort); it does NOT throw. The host's own `abort()` machinery does drive `completeAbortedInteractiveTurn` → status `"idle"`, which is the load-bearing observation. `c3Count === 1` means C3 executor *entered*, not that it completed.
- **Initial commit `e6272bb4e`** classified this ACT prematurely as `PASS_PRODUCTION_SEAM_GREEN_HOST_QUEUE_ABORT` — too strong, scoped only to the host queue + abort control seam.
- **Second commit `e5a699695`** corrected to `HALT_RED_NOT_REPRODUCED` — global verdict overclaim flagged by Factory reviewer (`HALT_TEST_SEAM_INVALID`).
- **Third commit's `QPSR03_PRODUCTION_CHRONOLOGY`** closes both P0 gaps (queue precondition not exercised; Resume entrypoint bypassed) and narrows the verdict to `CASE_Q2 = NOT_REPRODUCED`.
- **Net verdict (narrowed)**: `CASE_Q2_TRANSCRIPT_RESTORE_REPLAYS_TOOL_REQUEST = NOT_REPRODUCED` at the core Stop→Resume composition. Real-provider replay: NOT_EXERCISED.

**What the test deliberately does NOT exercise:**
- The `host.restoreSession({ restore: { messages: true } })` path — production Resume in VS Code is `startSession({ sessionId, prompt })` on the live session, not `restoreSession`. `restoreSession` is only used by `editMessageAndRegenerate`. Per recon §15.1, this ACT targets the production Resume path; the `restoreSession` path is a separate `host.restoreCheckpoint` seam that the VS Code Resume UI does not invoke.

**What was NOT modified (per ACT §13):**
- `host-ownership-diagnostic.ts` / `host-ownership-capture/*` — untouched.
- `post-terminal-authority-diagnostic.ts` / PTAD ring — untouched.
- `turn-state-writer-provenance.ts` / writer-provenance ring — untouched.
- `ClineCore` diagnostic surface — untouched.
- `TaskHeader` UI presentation — untouched.

**No push, no force push, no published-commit amend.** Commits land at the current entry head plus the bridge + recon + board delta; no remote update.
````

### ACT closure — STOP THIS BUG FAMILY — L4504-4544 (pre-sharding)

````text
SOURCE: .factory/epic-board.md L4504-4544 (pre-sharding). VERBATIM: yes; trims: leading/trailing blank lines collapsed

## ACT closure — STOP THIS BUG FAMILY

Per Factory reviewer disposition (post-`8f7190932` narrowing):

```
ACT-CLINEMM-QUEUED-PROMPT-STOP-RESUME-INTEGRITY01

VERDICT =
  NOT_REPRODUCED_AT_CORE_TRANSCRIPT_RESUME_COMPOSITION

PROVEN =
  queued P2 chronology
  queue enqueue/dequeue
  Stop while P2 current
  fresh-session Resume bootstrap
  completed C1/C2 tool results survive
  C1/C2 execute once

NOT_PROVEN =
  absence of upstream replay under a real provider/model

PRODUCTION_DELTA = NONE

NEXT =
  STOP THIS BUG FAMILY

NO_QPSR04
NO_PRODUCTION_REPAIR
```

The investigation is closed as a successful negative. The fork preserves
completed tool-result history across the exact queued-P2 → Stop →
fresh-session Resume lifecycle, so transcript loss at that boundary is
not the reproduced cause of upstream `#12975`. Real-provider replay
remains NOT_EXERCISED and is out of scope for this ACT family.

The fourth commit (`pending`) is a bounded evidence-correction-only
patch (board wording refinement, recon §15.2 caveat, test-file SEMANTIC
NOTE comment on the C3 deferred tool). No new test. No new ACT. No
review cycle beyond what the reviewer explicitly requested.
````
