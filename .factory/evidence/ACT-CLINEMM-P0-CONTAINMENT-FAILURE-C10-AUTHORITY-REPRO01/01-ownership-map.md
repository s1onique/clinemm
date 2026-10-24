# 01 — Exact source ownership map

All line numbers are against ENTRY_HEAD `e915c785bd1dcdbbed87a3cc1215e589422709a6`.

## 1.1 `apps/vscode/src/sdk/command-job-manager.ts` (3578 lines)

| Concern | Location | Fact |
|---|---|---|
| `CommandJobState` vocabulary (incl. `containment_failed`) | L54-87 | The terminal class union. |
| `CommandJobManagerOptions.terminalPostconditionProbe` | L477 | The DOCUMENTED test-only injection point for the PGID postcondition classifier: `(pgid: number) => "gone" \| "alive" \| "eperm" \| "unknown"`. |
| `CommandJobSnapshot.containmentFailed` | L133 | `"pgid_unset" \| "substrate_alive" \| "substrate_eperm" \| "substrate_unknown"`. Set iff `state === "containment_failed"`. |
| `finalize()` — postcondition probe | L2529-2548 | `postcondition = this.terminalPostconditionProbe(savedPgid)`. If no PGID is resolvable -> `postcondition = undefined`, `job.terminationFailed = "pgid_unset"`. |
| `finalize()` — terminal classification | L2556-2571 | `const invariantProven = postcondition === "gone"`. If proven -> the caller's clean terminal state is KEPT. If NOT proven -> `terminalState = "containment_failed"` (the caller's clean reason is OVERWRITTEN). |
| `finalize()` — residual observation | L2578-2588 | `command_job_residual_detected` emitted pre-delete on the failure path. |
| `finalize()` — active-map delete | L2636 | `this.active.delete(job.id)` — runs on BOTH the clean path AND the containment-failure path. This is the fact that makes an active-map cardinality check UNSOUND as a containment proof. |
| `finalize()` — clean-path block | L2677-2721 | `if (invariantProven) { ... command_job_terminal_committed ... captureContinuationCardinalityAuthorityRecord({ stage: "terminal_committed", ... }) }`. **The C1 `terminal_committed` capture is gated on `invariantProven`.** |
| `finalize()` — failure-path block | L2743-2795 | `command_job_containment_failed` emitted post-delete; carries `containmentFailed: job.terminationFailed`. **NO C1 capture on this path.** |
| `defaultTerminalPostconditionProbe` | L3498-3508 | The production PGID classifier (ESRCH->`gone`, rc=0->`alive`, EPERM->`eperm`, else->`unknown`). |
| `status()` — the manager lookup | L2844-2866 | `lookup()` = `active.get(id) ?? terminal.get(id)`. On a miss -> `{ ok: false, code: "unknown_job" }`. Emits the BJLA `job_status_lookup` diagnostic with `source: "active" \| "terminal" \| "miss"`. |
| `lookup()` | L3075-3077 | `this.active.get(jobId) ?? this.terminal.get(jobId)`. |
| Bounded FIFO eviction | L2819 | `while (this.terminalOrder.length > this.maxTerminalJobs) { ... }` — an evicted jobId is no longer resolvable. |
| `MAX_TERMINAL_JOBS` | L875 | `128`. |

## 1.2 `apps/vscode/src/sdk/command-status-tool.ts` (653 lines)

| Concern | Location | Fact |
|---|---|---|
| `createCommandStatusTool` | L214-598 | The observation-only tool. |
| Manager-miss branch | L289-393 | On `!status.ok` -> consult the BCB compact-receipt store; `resolved` -> truthful `observation: "evicted_receipt"`; `capacity_drop` -> `observation: "capacity_drop"`; `not_present`/`owner_mismatch` -> the truthful `unknown_job` error. |
| Path B (notify=true drain) | L468-491 | Guarded by `snap.state !== "running" && snap.state !== "containment_failed"`. The `containment_failed` exclusion is intentional (the wake consumer owns notify=true authority). |
| Path C (non-notify drain) | L492-532 | `consumeNonNotifyTerminalObservation(...)` for the non-notify observation. |
| Path C' (non-notify drain for `containment_failed`) | L536-574 | **Drains the non-notify observation EVEN when `snap.state === "containment_failed"`.** Added by ACT-CLINEMM-POST-CONSUMPTION-COMPLETION-AUTHORITY01 (PCCA01) to fix the `HALT_POST_CONSUMPTION_COMPLETION_AUTHORITY` stall. The drain is the observation boundary; it carries NO containment judgement. |
| Return payload | L575-596 | The terminal classification is surfaced verbatim (`state: snap.state`), so `containment_failed` IS visible to the model. |

## 1.3 `apps/vscode/src/sdk/background-notify-coordinator.ts` (3572 lines)

| Concern | Location | Fact |
|---|---|---|
| `unconsumedTerminalCountForOwner` | L1867-1887 | `liveMarkers + held + nonNotify` for the owner key. **No containment term.** |
| `unconsumedOwnedTerminalJobIdsForOwner` | L1906-1926 | The list-form sibling. **No containment term.** |
| `recordNonNotifyTerminalObservation` | L1944-1983 | Registers the observation keyed by jobId with the launch-time owner triple. The production caller registers it UNCONDITIONALLY for every terminal state (incl. `containment_failed`). |
| `consumeNonNotifyTerminalObservation` | L2004-2050 | Owner-triple validated; a foreign owner CANNOT drain. Deletes the observation AND `this.terminalReceipts.delete(input.jobId)`. Fires `notifyOwnedTerminalSetDrained` when the owner's held set empties. **No containment judgement.** |
| `recordTerminalReceipt` | L2145-2270 | Records the compact receipt. `isContainmentFailed` is carried on the receipt as a field, but is not used as a gate. |
| `consumeTerminalReceipt` | L2356-2456 | Owner-validated; drains via `resolveObligation` (notify) or `consumeNonNotifyTerminalObservation` (non-notify). |
| `recordTerminalReceiptFromLifecycle` | L3536-3571 | **The production receipt channel.** `if (event.event !== "command_job_terminal_committed") return { kind: "ignored" }`. Since the manager only emits `command_job_terminal_committed` on the `gone` path (L2677), **a containment-failed job NEVER produces a compact receipt.** |
| `consumeTerminal` (Path A) | L2849-3138 | The notify=true wake consumer. `containment_no_wake` -> the obligation is settled with no wake. |

## 1.4 `apps/vscode/src/sdk/sdk-session-event-coordinator.ts` (4466 lines)

| Concern | Location | Fact |
|---|---|---|
| `getBackgroundCommandJobStates` | L214 | PHCF01's per-job terminal-classification authority input. |
| `getBackgroundCommandJobOwners` | L248 | PHCF17's per-job owner-identity discriminator. |
| `getElmCompletionAuthorityDecision` | L633 | **REQUIRED** option (no default). |
| `checkElmCompletionAuthority` | L1310-1402 | The Elm final gate. `hold`/`failure`/throw => suppress the commit effect. |
| **Q5** `reevaluateDeferredContinuation` | L982-1149 | **CONSULTS the containment classification** at L1087-1132: filters `backgroundCommandJobStates` for `reason === "containment_failed"`, scopes by owner (fail-closed on unknown owner), and if any remain -> `setTurnPhase("resumable", ..., "session-event-turn-complete-containment-failed-resumable")` and returns WITHOUT releasing. Its own docstring (L961-970) states the rationale explicitly. |
| **C10 barrier** (the `handleSessionEvent` barrier block) | L3494-3525 | FOUR conjuncts: `outstandingAutonomousWork \|\| ownerStillRunningForC10 \|\| heldObligationForC10 \|\| suppressOriginatingCompletion`. **NO containment conjunct.** `ownerStillRunningForC10` is an active-map cardinality question. |
| **BCB re-evaluation** `reevaluateDeferredCompletionBarrier` | L1637-2054 | Same four conjuncts (L1736-1805). **NO containment conjunct.** |
| Deferred C10 commit | L1988-2036 | `setTurnPhase("completed", ...)` then the `task_completion_committed` capture. |
| Immediate C10 commit | L3879-3908 | `setTurnPhase("completed", ...)` then the `task_completion_committed` capture. |

## 1.5 `apps/vscode/src/sdk/SdkController.ts` (6610 lines)

| Concern | Location | Fact |
|---|---|---|
| `backgroundCommandJobStates` | L1285-1288 | The CONTROLLER-LEVEL, session-LESS per-job terminal-classification map. |
| `backgroundCommandJobOwners` | L1312 | The per-job owner map (PHCF17). |
| Wiring into the coordinator | L2664 / L2683 | `getBackgroundCommandJobStates: () => this.backgroundCommandJobStates` and `getBackgroundCommandJobOwners: () => this.backgroundCommandJobOwners`. **The data IS wired — it is only CONSULTED on the Q5 path.** |
| `updateBackgroundCommandState` | L5390-5588 | Maintains the projection from the runner's per-job terminal publication. |
| `handleCommandJobLifecycle` -> receipt | L5725-5754 | `recordTerminalReceiptFromLifecycle(this.backgroundNotifyCoordinator, event)`. |
| Elm provider wiring | L2885 | `getElmCompletionAuthorityDecision: (sessionId?) => ...`. |

## 1.6 `apps/vscode/elm/completion-authority/src/Authority.elm`

| Concern | Location | Fact |
|---|---|---|
| Job lifecycle vocabulary | `Domain.elm` L206-216 | `JobRunning \| JobTerminal ObservationPending \| JobTerminal ObservationConsumed`. **There is NO containment axis.** |
| Hold reasons | `Authority.elm` L520-590 | `ActiveRun`, `PendingPrompt`, `ScheduledContinuation`, `UnconsumedTerminalObservation`, `RunningBackgroundJob`. **No containment hold reason.** |
| `isUnconsumedOwnedTerminal` | `Authority.elm` L531-535 | `job.kind == TerminalOwned && (lifecycle == JobRunning \|\| lifecycle == JobTerminal ObservationPending)`. A containment-failed terminal is INDISTINGUISHABLE from a clean terminal once observed. |
| `completionAuthorized` | `Authority.elm` L594-597 | `List.isEmpty (computeHoldReasons model)`. |

**Consequence:** once the observation is consumed, the Elm kernel has no
residual fact that could hold the completion.

## 1.7 `apps/vscode/src/sdk/vscode-run-commands-tool.ts`

| Concern | Location | Fact |
|---|---|---|
| `isContainmentFailed` derivation | L1607 | `const isContainmentFailed = terminalState === "containment_failed"`. |
| Non-notify observation registration | L1707 | `recordNonNotifyTerminalObservation(...)` — registered for EVERY terminal state, INCLUDING `containment_failed`. |

## 1.8 Webview truth surface

| Concern | Location | Fact |
|---|---|---|
| `CommandStatusMap.containment_failed` | `webview-ui/src/components/chat/CommandOutputRow.tsx` L364 | `"Run failed"` — the per-job pill is truthful; it does NOT claim clean termination. |
| `stateLabel("completed")` | `webview-ui/src/components/chat/task-header/taskHeaderTelemetryHelpers.ts` L174-175 | `{ label: "Complete", glyph: "✓", live: false }` — the header label is derived from the TASK phase, NOT from any per-job containment fact. |
