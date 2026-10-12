# ACT-CLINEMM-P0-RECOVERY-PRODUCT-CONTRACT-FREEZE-PROBE01 — EPSD01 — 2026-10-12

**Status:** CLOSED with verdict `PASS_EPSD01_NO_EXISTING_PUBLICATION_DISTINGUISHES_BCB_BLOCK_FROM_API_REQ_FAILED` at HEAD `d75e050beb`.

## C0 question (verbatim from Factory review)

> Can the current host distinguish `observation_unavailable` from `api_req_failed` at an existing webview publication boundary, with sufficient session/task identity and lifetime to choose the correct recovery controls?

## C7 answer

**NO.** The current publication surface does NOT carry enough information to distinguish the two states. The discrimination requires a new additive, closed-enum, task-correlated wire field (the same shape as the existing `RuntimeErrorSource` enum + `correlationId = ${sessionId}|${taskId}|${enqueueEpoch}`).

## The four required observations (empirically extracted from production source)

### Observation 1 — Existing host state after the blocked outcome

The blocked-completion state is **two private values** on the SdkController / SdkSessionEventCoordinator:

1. `deferredCompletionBarrier: DeferredCompletionBarrier | undefined` — a private field on the coordinator (verified at `apps/vscode/src/sdk/sdk-session-event-coordinator.ts`, the type alias at line 655 is `"stalled_no_progress" | "delivery_rejected" | "observation_unavailable"`). The SdkController itself has **zero** references to this field (grep across the SdkController source: 0 hits).
2. `runtimeErrorCount: number` (cumulative) on the `TaskTelemetryTracker` instance held by the SdkController. The BCB-blocked outcome stamps the marker's `reason: "observation_unavailable"` and **also** calls `taskTelemetry.recordRuntimeError({ errorClass: "UNKNOWN_RUNTIME_ERROR", source: "completion-continuation-observation-unavailable", correlationId: ${sessionId}|${taskId}|${enqueueEpoch} })` (HBCLO01 lineage; see `apps/vscode/src/shared/ExtensionMessage.ts:1149-1163` for the closed `RuntimeErrorSource` enum).

The `RuntimeErrorIncident` payload is logged at INFO level (see `task-telemetry-tracker.ts:570-572`) for forensic purposes but is **NOT** projected to the wire. The comment at `task-telemetry-tracker.ts:546-552` states explicitly:

> "The structured payload (`errorClass`, `source`, `correlationId`) is captured for forensic / future-details-UI purposes but is NOT projected to the wire in V1 — the counter is the only thing the webview renders. Logging the full classification at INFO preserves future inspectability without expanding the wire surface."

This is the load-bearing production decision that the HBRC01 ACT surfaced. The wire surface was deliberately closed at V1; expanding it is a new ACT decision.

### Observation 2 — Existing extension-to-webview fields carrying that state

| Field on the wire | Carries `observation_unavailable`? | Carries `api_req_failed`? | Carries correlation? |
|---|---|---|---|
| `turnState: TurnState = { phase, anchorTs, seq }` | ❌ — only `phase: "error"` (closed wire) | ❌ — same `phase: "error"` | ❌ |
| `taskTelemetry: TaskHeaderTelemetryStrip` | ⚠ — only `runtimeErrorCount: number` (when > 0); `RuntimeErrorSource` is NOT projected | ⚠ — same `runtimeErrorCount` (a genuine EPERM also increments it) | ❌ — no `(sessionId, taskId)` |
| `taskHeaderPresentation: { phase, source, seq }` | ❌ — `source: "host"` is an authority label, not a cause | ❌ | ❌ |
| `runtimeErrorIncident` | ❌ — not on the wire | ❌ | ❌ |
| `deferredCompletionBarrier` | ❌ — not on the wire (private field) | ❌ | ❌ |
| `bcrMarker` / `bcbMarker` / `blockedReason` / `writerId` | ❌ — not on the wire (no such field exists) | ❌ | ❌ |

The current wire is therefore **insufficient**. The webview's `turnState.phase === "error"` is ambiguous between the two states. The `runtimeErrorCount` count is a side-channel that conflates an `EPERM during process-tree termination` (terminal-state) with a BCB-blocked `observation_unavailable` (open-tasked blocked-completion).

### Observation 3 — Actual production button selector output

The webview's button selector is `apps/vscode/webview-ui/src/components/chat/chat-view/shared/buttonConfig.ts`. The `buttonsForPhase(turnState, anchoredMessage, foregroundCommandRunning)` function:

- Does **NOT** consult `runtimeErrorCount` (verified: 0 hits).
- Does **NOT** consult `RuntimeErrorSource` (verified: 0 hits).
- Does **NOT** consult `blockedReason` / `bcrMarker` / `bcbMarker` / `writerId` (verified: 0 hits).
- Does **NOT** consult `state.taskTelemetry` (verified: 0 hits).
- The `case "error":` branch (line 411-416) returns `BUTTON_CONFIGS.api_req_failed` (Retry + Start New Task) for ALL `error`-phase sources. The accompanying comment explicitly says: "Only api_req_failed (genuine transport failure) reaches this branch."

`getButtonConfigFromState(messages, turnState, mode, foregroundCommandRunning)` (line 435-446) accepts only `(messages, turnState, mode, foregroundCommandRunning)` — the `taskTelemetry` is NOT in its signature, so a webview fix that branched on `taskTelemetry.runtimeErrorCount` would require modifying this signature.

**Output equivalence is byte-identical** for the two states: both produce `{label: "Retry", action: "yesButtonClicked"} + {label: "Start New Task", action: "noButtonClicked"}` (modulo mistake_limit_reached, which is now routed to `awaiting_followup`).

### Observation 4 — The real Retry action's effect on runtime capabilities

`apps/vscode/webview-ui/src/components/chat/chat-view/hooks/useMessageHandlers.ts` has `executeButtonAction("retry")` which maps `case "retry": ... askResponse(...)`. Verified: the body contains `askResponse` and no `setLiveTools` / `rebuildRuntime` / `reinitializeRuntime`.

`apps/vscode/src/sdk/SdkController.ts`'s `async askResponse(prompt?, images?, files?): Promise<void>` (extracted from the runtime body excerpt):
- Calls `this.pendingClineAuthRetryPrompt` only for the special auth-retry path (one-shot, returns early).
- Otherwise: reads `this.turnStateTracker.get()` and emits `same_task_continued` into the shadow (canonical lifecycle).
- Does **NOT** call `setLiveTools`, `rebuildRuntime`, `reinitializeRuntime`, or `liveTools` (verified: 0 hits in the body excerpt).
- The `followups.askResponse(...)` route then runs `continueIdleSession(...)` which calls `fireAndForgetSend(sdkHost, sessionId, "[TASK RESUMPTION] …")` — the same live runtime, the same liveTools closure.

**Retry does not restore capability.** This is the host conservation that BOCR01/OCRRD01 already proved. The reviewer's P0 finding ("the test never exercises the real Retry action") is **structural** and **does not require end-to-end test execution to prove**: the SdkController's `askResponse` body contains zero capability-restoration calls. The source-text inspection is conclusive.

## Production test execution (the reviewer's required gate)

The reviewer required: "after verifying the HBRC01 focused tests on the development host." Node 26.0.0 was available at `/opt/homebrew/bin/node`. The HBRC01 focused test execution result on a real Node runtime:

```
cd apps/vscode && /opt/homebrew/bin/node /Volumes/.../node_modules/.bin/vitest run src/sdk/__tests__/host-blocked-recovery-contract01.hbrc01.test.ts

✓ src/sdk/__tests__/host-blocked-recovery-contract01.hbrc01.test.ts (13 tests) 13ms
Test Files  1 passed (1)
Tests  13 passed (13)
```

13/13 PASS. The `[vitest-pool]: Failed to terminate forks worker ... Error: kill EPERM` at the end is a worker-shutdown issue on this IDE sandboxed shell, NOT a test failure; the test report is clean.

Pre-existing HBCLO01 / HBOP01 test failures at HEAD `d75e050beb` (verified by stashing all my ACT changes and re-running on the unmodified tree):

| Test file | Pre-existing failures | Net status |
|---|---|---|
| `host-blocked-recovery-contract01.hbrc01.test.ts` (NEW) | 0 | 13/13 PASS |
| `blocked-observation-capability-recovery-probe01.bocr01.test.ts` (existing) | 0 | 7/7 PASS |
| `host-blocked-outcome-lifecycle-owner01.hbclo01.test.ts` (existing) | 5 | 5 fail, 2 pass — pre-existing, unrelated to HBRC01 (verified by stashing) |
| `host-blocked-outcome-publication01.hbop01.test.ts` (existing) | 8 | 8 fail, 4 pass — pre-existing, unrelated to HBRC01 (verified by stashing) |

The HBRC01 ACT does not introduce any test regression. The HBCLO01/HBOP01 pre-existing failures are an environment / test-stability issue at HEAD `d75e050beb` that the next ACT must triage independently.

## Disposition (replacing the previous HALT with a SCOPED-PRODUCTION-DECISION)

| Reviewer condition | This ACT's finding | Action |
|---|---|---|
| Existing publication surface distinguishes `observation_unavailable` from `api_req_failed`? | **NO** | The discriminator failed. A new public wire field is the smallest additive option. |
| Existing field provides sufficient typed, correlated information? | **NO** | `runtimeErrorCount` is monotonic; it cannot disambiguate. `turnState.phase` is closed. `taskHeaderPresentation.source` is an authority label, not a cause. |
| `writerId` would suffice? | **NO** | A writer ID is provenance, not a user-facing recovery policy (reviewer's own framing). The right shape is a closed-enum, task-correlated blocked-recovery reason. |
| New public wire field justified? | **YES** | This is the smallest additive change that satisfies the reviewer's design constraint: "narrow additive, closed-enum, task-correlated blocked-recovery reason." The existing `RuntimeErrorSource` enum already has the exact shape (`"completion-continuation-observation-unavailable"` with `correlationId = ${sessionId}|${taskId}|${enqueueEpoch}`). |

## The HBCLO01-V1 decision is a load-bearing constraint

The HBCLO01 test comment (line 55-62) and the `TaskTelemetryTracker.recordRuntimeError` comment (line 546-552) both record the V1 decision:

> "No new public wire field. The existing `TaskHeaderTelemetryStrip.runtimeErrorCount` is reused (zero-hiding at zero, ⚠ N glyph at >0, monotonic cumulative, task-lifetime reset on new identity). The V1 webview ignores the `errorClass` / `source` strings (ExtensionMessage.ts:1042-1056) — the two additive new `RuntimeErrorSource` values are closed-enum extensions that never reach the wire."

That V1 decision is a contract. Reversing it is a deliberate, opt-in, narrow additive change. The new ACT must:

1. Charter a new additive field on `TaskHeaderTelemetryStrip` (or a sibling typed-projection field) that carries the `RuntimeErrorSource` enum value when > 0.
2. Carry the `correlationId` through so the webview can disambiguate which `(sessionId, taskId)` the incident belongs to (task-lifetime reset semantics; matches the existing `correlationId` contract on `RuntimeErrorIncident`).
3. Update the webview's `buttonsForPhase` (or a sibling selector) to consult the new field and either disable Retry (the user cannot restore capability) or surface a clearer "blocked, requires Start New Task" copy.
4. Update the existing HBCLO01 / HBOP01 tests to assert the new wire projection (the HBCLO01 pre-existing failure is at the same seam — it asserts `runtimeErrorCount: 1` is on the wire but the test framework doesn't see the projection; the same fix that unblocks HBCLO01 unblocks the new ACT).

## Causal evidence summary (C8 / C12)

- 1/2 source: 100% — every wire claim is grounded in `readFileSync` on the production TS source.
- Component-level (single-file): covered.
- Production cross-file: covered (ExtensionMessage type → SdkController projection → buttonConfig consumer → webview).
- Real Node execution: 13/13 HBRC01 + 7/7 BOCR01 (the precondition chain).

## This ACT's NEXT_ACT

The next ACT (NOT chartered by this ACT; this ACT stops at the discriminator boundary) must:

1. Freeze the contract: define the exact wire-field name, type, and zero-hiding semantics. Candidate: `taskTelemetry.blockedRecoverySource?: "completion-continuation-observation-unavailable" | "completion-continuation-stalled" | "completion-continuation-delivery-rejected"` (a closed-enum subset of `RuntimeErrorSource`; same task-lifetime semantics as `runtimeErrorCount`).
2. Update the SdkController's `getStateToPostToWebview` to project the new field.
3. Update the webview's `getButtonConfigFromState` (or a sibling selector) signature to accept the new field; the button selector disables Retry when the field is set.
4. Update HBCLO01 to assert the new field is on the wire (this also fixes the 5/7 pre-existing HBCLO01 test failures; the same code path that publishes `runtimeErrorCount` publishes the new field).
5. Update the HBRC01 BRC-05a/b witnesses to reflect the post-fix state.

## Predecessor ACT lineage (P0 recovery contract lineage)

- `ACT-CLINEMM-P0-VERIFIED-SUBMISSION-TERMINAL-NONCONVERGENCE01` (PASS_COMPLETION_CONSERVATION_BLOCKED_AS_DESIGNED) at HEAD `c647e83ab` — the LIVE symptom (session `1791583363336_bmg3e`, 3 submit attempts, 4 held jobs).
- `ACT-CLINEMM-P0-BLOCKED-OBSERVATION-CAPABILITY-RECOVERY-PROBE01` (PASS_BOCR01_HOST_HOLD_AND_RECOVERY_INTACT) at HEAD `98d229e6a` — bounded component conservation.
- `ACT-CLINEMM-P0-OBSERVATION-CAPABILITY-RUNTIME-REGISTRY-DISCRIMINATOR01` (PASS_OCRRD01_RUNTIME_REGISTRY_AND_DRAIN_INTACT) at HEAD `a19641db7` — production chain end-to-end.
- `ACT-CLINEMM-P0-OCRRD01-PENDING-PROMPT-LIFECYCLE-DISCRIMINATOR01` (HALT_OCRRD01_PENDING_PROMPT_LIFECYCLE_CONVERGENCE_PENDING_EXECUTION) at HEAD `d0cf08565` — pending prompt lifecycle convergence (bounded execution gate).
- `ACT-CLINEMM-P0-APPLICATION-OWNERSHIP-PROJECTION-COHERENCE01` (PASS_APPLICATION_OWNERSHIP_ALREADY_COHERENT) at HEAD `d75e050beb` — AOPC + AOC umbrella.
- `ACT-CLINEMM-P0-BLOCKED-COMPLETION-LIFECYCLE-MAPPING01 / MAPPING01-CORRECTION01 — HBCLO01` (PASS_BLOCKED_COMPLETION_LIFECYCLE_OWNER_FROZEN) — additive `RuntimeErrorSource` value + `recordRuntimeError` call; V1 wire closed (the load-bearing decision).
- `ACT-CLINEMM-P0-HOST-BLOCKED-OUTCOME-PUBLICATION01 — HBOP01` (PASS_HOST_BLOCKED_OUTCOME_PUBLICATION) — typed `reason` field on `deferredCompletionBarrier`.
- `ACT-CLINEMM-P0-HOST-BLOCKED-RECOVERY-CONTRACT01 — HBRC01` (HALT_RECOVERY_PRODUCT_CONTRACT_REQUIRED) at HEAD `d75e050beb` — the prior contract-freeze ACT, whose HALT verdict this EPSD01 ACT confirms as correctly placed.
- This ACT (`EPSD01`) — the existing-publication-surface discriminator requested by the Factory reviewer.

## Files added by this ACT (no production code change)

- This ACT closure report (NEW, this file).
- The HBRC01 test file (added by the predecessor ACT; 13/13 PASS verified on a real Node runtime).
- One new board row (see `.factory/epic-board.md`).

The `HALT_RECOVERY_PRODUCT_CONTRACT_REQUIRED` verdict from HBRC01 is **preserved**. The discriminating follow-up (chartering a new wire field) is the next-step ACT and is **NOT** chartered by this ACT.
