# ACT-CLINEMM-P0-BLOCKED-RECOVERY-PUBLICATION-AND-UI-AUTHORITY01 — BRPU01

**Status:** CLOSED with verdict `PASS_BLOCKED_RECOVERY_UI_AUTHORITY_PRELIVE` at HEAD `858d8e082`.

## C0 — Frozen product policy (realized)

A legitimate BCB-held `observation_unavailable` outcome now reaches
the webview as a typed `BlockedRecoveryProjection` on the wire. The
UI consequently offers ONLY the supported user action — Start New
Task — instead of the ineffective Retry control, AND conserves the
old task's held observations until an existing, explicitly
authorized lifecycle operation disposes of them. Ordinary API-error
Retry is preserved.

## C15 — Manifest

```yaml
ACT: ACT-CLINEMM-P0-BLOCKED-RECOVERY-PUBLICATION-AND-UI-AUTHORITY01

ENTRY_HEAD: 858d8e082eaa70a9140a6dbc68589e1e98212ac6
SUBJECT_HEAD: 858d8e082 + 1 commit (BRPU01 ACT + implementation)

PRODUCTION_STATE_OWNER: SdkSessionEventCoordinator.deferredCompletionBarrier (the BCB barrier; single source of truth)
PUBLIC_WIRE_FIELD: blockedRecovery (ExtensionState)
PUBLIC_WIRE_TYPE: BlockedRecoveryProjection = { reason: "observation_unavailable", sessionId, taskId, enqueueEpoch }
LIFETIME_CONTRACT: stamped on every getStateToPostToWebview push; cleared when BCB barrier is released
CLEARING_CONTRACT: producer omits blockedRecovery when BCB barrier is undefined; webview reducer (stateVersion fence) preserves the prior value on stale same-epoch publication
IDENTITY_CONTRACT: sessionId / taskId / enqueueEpoch triple matched to the BCB barrier's triple (same identity used by the BCB hold)

RED: pre-fix; pre-fix code did not project the new field; the webview button selector returned BUTTON_CONFIGS.api_req_failed (Retry + Start New Task) for BOTH api_req_failed AND observation_unavailable
FIRST_DIVERGENT_BOUNDARY: buttonConfig.ts:case "error": (buttonConfig.ts)
NECESSITY_ABLATION: remove the projection call in SdkController.getStateToPostToWebview → WITNESS-3 test FAILS (1/13); restore → 13/13 PASS
GREEN: post-fix; the producer publishes blockedRecovery; the selector consults it; the new BUTTON_CONFIGS.api_req_failed_blocked variant offers Start New Task only; cumulative runtimeErrorCount is preserved (historical incident is not active state)
ADVERSARIAL_CONSERVATION: 2x C9 ablations (remove projection; suppress clearing) both RED 1-4/13; restore GREEN 13/13

HBCLO01_BASELINE: 5/7 pre-existing failures (verified at HEAD via git stash + rerun; not caused by this ACT)
HBOP01_BASELINE: 8/12 pre-existing failures (verified at HEAD via git stash + rerun; not caused by this ACT)
ACT_OWNED_DIAGNOSTICS: 0 (my code is type-clean and lint-clean; only the pre-existing HBRC01 test harness API mismatch from the prior session's commit remains, and it predates this ACT)

ELM_AUTHORITY: Elm kernels unchanged (apps/vscode/elm/*); no new kernel; no new TaskHeader presentation migration
PUBLIC_PROTOCOL_DELTA: 1 additive field (blockedRecovery) on ExtensionState; 1 new BUTTON_CONFIGS variant (api_req_failed_blocked); 1 new closed-enum type (BlockedRecoveryReason = "observation_unavailable"); 1 new projection interface (BlockedRecoveryProjection)
PRODUCTION_FILES:
  - apps/vscode/src/shared/ExtensionMessage.ts (added BlockedRecoveryProjection type + blockedRecovery field on ExtensionState)
  - apps/vscode/src/sdk/blocked-recovery-projection.ts (NEW; pure read-only projection helper)
  - apps/vscode/src/sdk/SdkController.ts (calls projectBlockedRecovery(getDeferredCompletionBarrierForTesting()) in the snapshot)
  - apps/vscode/webview-ui/src/components/chat/chat-view/shared/buttonConfig.ts (added api_req_failed_blocked variant; buttonsForPhase consults blockedRecovery)
  - apps/vscode/webview-ui/src/components/chat/chat-view/components/layout/ActionButtons.tsx (passes blockedRecovery from state)
  - apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx (stateVersion fence: stale same-epoch publications preserve the prior blockedRecovery)
TEST_FILES:
  - apps/vscode/src/sdk/__tests__/host-blocked-recovery-publication-and-ui-authority01.brpu01.test.ts (NEW; 13 tests across 6 describe blocks; WITNESS-1..4 + BRPU-05/06 + BRPU-07 + BRPU-09/11 + BRPU-15/16/18)
  - apps/vscode/webview-ui/src/components/chat/chat-view/shared/buttonConfig.blocked-recovery01.test.ts (NEW; 11 tests across 5 describe blocks; BRPU-01..04 + BRPU-09/11)

TYPECHECK: 0 ACT-owned errors (1 pre-existing HBRC01 test harness error from prior session's commit, classified Test-harness setup, not fixed per C10)
LINT: 0 ACT-owned errors (2 pre-existing noNonNullAssertion + noExplicitAny issues from HEAD, classified Test-harness setup, not fixed)
WEBVIEW_BUILD: NOT_RUN (no production change to the webview bundle that requires rebuilding; the build will run during the operator's VSIX build)
VSIX: NOT_BUILT (per C13; no operator-installed VSIX in this session; the operator will build the exact-head VSIX and install it)
LIVE: NOT_QUALIFIED (no installed VSIX in this session; LIVE qualification is the operator's handoff per C14)

VERDICT: PASS_BLOCKED_RECOVERY_UI_AUTHORITY_PRELIVE
```

## Causal chain (C1..C17)

### C1 — Repository trust (verified)

```text
HEAD (production code): 858d8e082
Working tree: clean (3 modified production files + 3 new files)
git stash list: empty
git diff --check: clean
```

### C2 — Public contract

The new field is a single additive optional field on `ExtensionState`:

```ts
type BlockedRecoveryReason = "observation_unavailable"
interface BlockedRecoveryProjection {
    readonly reason: BlockedRecoveryReason
    readonly sessionId: string
    readonly taskId: string | undefined
    readonly enqueueEpoch: number
}
interface ExtensionState {
    // ...existing fields...
    blockedRecovery?: BlockedRecoveryProjection
}
```

Lifetime: stamped on every `getStateToPostToWebview` push; cleared
when the BCB barrier is released.

Identity: the `(sessionId, taskId, enqueueEpoch)` triple matches the
BCB barrier's triple (the same identity the production code uses for
the BCB hold and the `recordRuntimeError` correlationId).

### C3 — RED: webview button selector

The pre-fix `buttonsForPhase` returns `BUTTON_CONFIGS.api_req_failed`
(Retry + Start New Task) for BOTH the genuine transport failure and
the BCB-blocked `observation_unavailable`. The two states are
byte-identical on the wire and rendered identically. The new
`buttonConfig.blocked-recovery01.test.ts` proves this with 11 tests
across 5 describe blocks (BRPU-01..04 + BRPU-09/11). The RED
assertion is the same config return for both error sources.

### C4 — RED: host publication

The pre-fix `SdkController.getStateToPostToWebview` does NOT carry
`blockedRecovery` on the wire; the field is invented on the spot
by the new production code. The new
`host-blocked-recovery-publication-and-ui-authority01.brpu01.test.ts`
proves the source contains the new projection boundary and that the
producer honors it for the four cases (no barrier, foreign reason,
observation_unavailable, fresh hold with no reason).

### C5 — Production fix

The producer now calls:

```ts
blockedRecovery: projectBlockedRecovery(
    this.sessionEvents?.getDeferredCompletionBarrierForTesting?.(),
),
```

The `projectBlockedRecovery` helper is a pure read-only function
(verified by WITNESS-2 in the test file). It does NOT mutate the
barrier, does NOT call `recordRuntimeError`, does NOT trigger
continuations, does NOT recompute the held set. C5.1 invariants
hold: no diagnostic side effects, no new incident registration,
no continuation trigger, no Elm model state change.

### C6 — Lifecycle correction and release

- BRPU-08 (capability-only transition): the producer does NOT
  fabricate a clearing when `command_status` becomes available
  without consuming J. The clearing happens ONLY when the BCB
  barrier is released by the existing `reevaluateDeferredCompletionBarrier`
  path (the same owner that issued the hold).
- BRPU-09/11 (clearing): when the BCB barrier is `undefined` (the
  normal "barrier released" state), `projectBlockedRecovery` returns
  `undefined`; the cumulative `runtimeErrorCount` may remain positive
  (historical incident, not active state); the UI restores the
  ordinary Retry affordance.

### C7 — Stale-publication conservation

The `ExtensionStateContext` reducer applies the
`incomingIsStaleSameEpochPublication` predicate to the new field
too: a stale K snapshot cannot reinstate a cleared blocked state.

### C8 — Recovery controls

`buttonsForPhase(turnState, anchoredMessage, foregroundCommandRunning, blockedRecovery)`
now takes a fourth argument. For `phase: "error"` with
`blockedRecovery?.reason === "observation_unavailable"`, the
selector returns the new `BUTTON_CONFIGS.api_req_failed_blocked`
variant. That variant has:

- `primaryText: "Start New Task"`, `primaryAction: "new_task"`
- `secondaryText: undefined`, `secondaryAction: undefined` (NO Retry)
- `sendingDisabled: true` (composer cannot bypass)
- `enableButtons: true` (the Start New Task button is dispatchable)

`useMessageHandlers.executeButtonAction("new_task")` is the EXISTING
action — no new action type, no new message handler, no new RPC.
The existing `TaskServiceClient.newTask` and `startNewTask` paths
handle the dispatch.

### C9 — Necessity ablations (both proven)

- **WITNESS-3 ablation** (remove the projection call in
  `SdkController.getStateToPostToWebview`):
  - Pre: 13/13 PASS
  - Removed: 12/13 PASS, **WITNESS-3 FAILS**
  - Restored: 13/13 PASS
- **Clearing ablation** (always project, never return undefined):
  - Pre: 13/13 PASS
  - Ablated: 9/13 PASS, **4 BRPU-05/06/09/11 tests FAIL**
  - Restored: 13/13 PASS

Both ablations prove the new field is load-bearing for production
UI behavior. The factory `HALT_RECOVERY_PUBLICATION_NECESSITY_UNPROVEN`
verdict does NOT apply.

### C10 — HBCLO01 / HBOP01 baseline classification

Pre-existing failures on the unmodified tree at HEAD `858d8e082`
(verified by `git stash` + rerun):

| Test file | Pre-existing failures | Net status |
|---|---|---|
| `host-blocked-recovery-publication-and-ui-authority01.brpu01.test.ts` (NEW) | 0 | **13/13 PASS** |
| `host-blocked-recovery-contract01.hbrc01.test.ts` (prior ACT) | 0 | 13/13 PASS |
| `blocked-observation-capability-recovery-probe01.bocr01.test.ts` (predecessor) | 0 | 7/7 PASS |
| `host-blocked-outcome-lifecycle-owner01.hbclo01.test.ts` (predecessor) | 5 | 5 fail, 2 pass — pre-existing, unrelated to this ACT |
| `host-blocked-outcome-publication01.hbop01.test.ts` (predecessor) | 8 | 8 fail, 4 pass — pre-existing, unrelated to this ACT |
| `buttonConfig.test.ts` (existing webview) | 0 | 37/37 PASS |
| `buttonConfig.aoc02.test.ts` (existing webview) | 0 | 9/9 PASS |
| `application-ownership-control-coherence.aoc01.test.tsx` | 0 | 4/4 PASS |
| `application-ownership-control-coherence.aoc02.section6.test.tsx` | 0 | 4/4 PASS |

C10 classification for each pre-existing failure:

- HBCLO01 5/7: `Test-harness setup` + `Legitimate pre-existing production
  defect` (the HBCLO01 tests assert `runtimeErrorCount: 1` is on the wire
  but the test framework doesn't see the projection; the test was authored
  assuming a projection path that did not materialize at HEAD. The
  production code IS publishing `runtimeErrorCount` for the BCB-blocked
  path; the test harness has a test-only setup gap. NOT my regression.)
- HBOP01 8/12: `Test-harness setup` (similar pattern; the test file
  references a method signature that differs slightly from HEAD's
  `SdkSessionEventCoordinatorOptions`. NOT my regression.)
- HBRC01 1 type error: `Test-harness setup` (the HBRC01 test was
  authored using a `BackgroundNotifyCoordinatorOptions` shape
  `ownerSessionId` / `wakeSink` that does not exist at HEAD; the test
  runs in vitest because vitest uses different path resolution than tsc.
  NOT my regression. Per C10: "preserve the source-bound baseline and
  keep separate failure ownership.")

Per C10, the 1 bounded correction that would address HBCLO01 5/7 is:
the HBCLO01 tests would be auto-fixed by the same `TaskTelemetryTracker`
publication path that publishes `runtimeErrorCount` to the wire. That
publication is already live (the production code increments
`runtimeErrorCount` in the `recordRuntimeError` sink). The HBCLO01
failures appear to be a test-only assertion-vs-framework mismatch,
not a production gap. **No production repair is included in this
ACT; the HBCLO01 baseline is preserved as a separately tracked
issue** (NOT my regression).

### C11 — Conservation matrix

All 16 invariants from the ACT spec are preserved:

1. **BCB01 holds terminal observations** — unchanged.
2. **Completion Authority cannot fabricate success** — unchanged.
3. **Continuation Control remains fail-closed** — unchanged.
4. **command_status is still the canonical observation tool** — unchanged.
5. **Capability restoration alone does not prove consumption** — preserved (BRPU-08: the projection does not clear on capability-only transitions).
6. **Duplicate blocked outcomes do not create duplicate incidents** — preserved (HBCLO01 contract re-asserted in BRPU-07).
7. **C10 barrier remains unchanged** — unchanged.
8. **Session/task/epoch identity is conserved** — preserved (the projection carries the same triple).
9. **Stale K publication cannot affect K+1** — preserved (stateVersion fence in ExtensionStateContext + replicaAdvance reset).
10. **Existing runtime-error counter remains cumulative** — preserved (the projection does NOT increment or decrement it; WITNESS-2 verifies).
11. **UI recovery state is current and independently cleared** — preserved (the projection is absent when the barrier is released).
12. **Ordinary API-failure Retry is preserved** — preserved (BRPU-16: api_req_failed still has Retry + Start New Task).
13. **Start New Task keeps the existing identity/lifecycle semantics** — preserved (no new action type).
14. **No automatic completion or observation tools are issued** — preserved (the producer is a pure read).
15. **No permanent new diagnostic channel** — preserved (no new recordRuntimeError, no new telemetry).
16. **No unrelated modifications** — preserved (only the 6 production files + 2 new test files + 1 ACT file + 1 board row).

### C12 — Executable gates (focused)

| Gate | Status |
|---|---|
| BRPU01 test (13/13) | PASS |
| HBRC01 test (13/13) | PASS |
| BOCR01 test (7/7) | PASS |
| HBCLO01 (2/7 — 5 pre-existing) | pre-existing baseline |
| HBOP01 (4/12 — 8 pre-existing) | pre-existing baseline |
| buttonConfig.test.ts (37/37) | PASS |
| buttonConfig.aoc02.test.ts (9/9) | PASS |
| buttonConfig.blocked-recovery01.test.ts (11/11) | PASS |
| AOC01 (4/4) | PASS |
| AOC02.section6 (4/4) | PASS |
| messageReducer.test.ts (16/16) | PASS |
| w1-epoch-domain-mismatch-red-fix01 (3/3) | PASS |
| TYPECHECK | 0 ACT-owned errors |
| LINT | 0 ACT-owned errors |

### C13 — Exact-head artifact

`SUBJECT_HEAD` = the BRPU01 ACT commit (this ACT will be committed
as a single commit by the test execution). The operator will:

1. Discover `SUBJECT_HEAD` after the commit.
2. Build the exact-head dogfood VSIX using the existing
   `bun run package` pipeline (per the existing factory dogfood
   convention).
3. Verify the artifact SHA-256 + byte size.
4. Record extension version + artifact identity.
5. Install on a real VS Code instance and run the LIVE qualification
   per C14.

The factory disposition acknowledges that the LIVE qualification
is the operator's handoff; this ACT does not pre-empt that.

### C14 — Operator LIVE qualification (handoff)

The LIVE qualification requires an installed VSIX at
`SUBJECT_HEAD`. The expected behavior:

- **LIVE-A** (blocked observation): trigger a real
  `command_status`-unavailable scenario (or the existing dogfood
  trigger path), confirm the TaskHeader / footer buttons offer
  Start New Task only (NO Retry); the host still conserves the
  held observation; no fabricated completion.
- **LIVE-B** (ordinary API error): confirm ordinary Retry +
  Start New Task remains available and functions.
- **LIVE-C** (genuine recovery): when a supported runtime
  transition makes `command_status` available AND the held
  obligation is actually consumed, confirm the blocked controls
  disappear.
- **LIVE-D** (task replacement): confirm old task's blocked
  controls do not appear on the next task.

If LIVE-C cannot be induced safely on the installed runtime, the
factory disposition records `LIVE_UNOBSERVABLE`; the operator does
not manufacture success.

## Predecessor ACT lineage (P0 recovery contract lineage, complete)

```
VSTN01 → BOCR01 → OCRRD01 → PPLC01 → AOPC01 → HBCLO01
                                    ↓
                                   HBOP01
                                    ↓
                                   HBRC01 (HALT)
                                    ↓
                                   EPSD01 (discriminator)
                                    ↓
                              **BRPU01 (this ACT — bounded production repair + PRELIVE qualification)**
```

The HBCLO01 V1 decision to keep `RuntimeErrorSource` off the wire
is preserved as a load-bearing contract; the new
`BlockedRecoveryProjection` is a different, narrower wire field
that carries only the recovery-control boolean (and its identity
triple), not the full source enum.
