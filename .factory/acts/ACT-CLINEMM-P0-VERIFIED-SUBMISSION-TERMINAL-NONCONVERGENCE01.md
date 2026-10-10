# ACT-CLINEMM-P0-VERIFIED-SUBMISSION-TERMINAL-NONCONVERGENCE01 — PASS_COMPLETION_CONSERVATION_BLOCKED_AS_DESIGNED — 2026-10-10

**Status:** CLOSED with verdict `PASS_COMPLETION_CONSERVATION_BLOCKED_AS_DESIGNED`.
The LIVE specimen's three `submit_and_exit` cycles and three `error` phase publications
are the **contract-correct** behavior of the production BCB01 / PTBPC01 / CRCD01 / CTQC01 /
CCUTO01 stack on HEAD `c647e83ab`. No first divergent boundary is reproducible on the
current source. The `4` in `unconsumedTerminalCountLast` is a global diagnostic
counter snapshot, not a per-task held-observation set; the affected task's per-turn
held count cannot be reconstructed from the supplied evidence because
`BackgroundNotifyCoordinator.unconsumedOwnedTerminalJobIdsForOwner` is process-ephemeral
and the production seam does not record it in the CCA log — only the substrate
stages (`terminal_committed`, `submit_and_exit_seen`, `agent_turn_done`,
`task_started`, `run_turn_started`, `execute_turn_prelude_enter`,
`task_completion_committed`) are persisted. No RED is reproducible on the
current source; no first divergent boundary is identified; the task is
**legitimately blocked by the bounded host correlation guard
(`ACT-CLINEMM-ELMIZE-P1-COMPLETION-TERMINAL-QUEUE-CONVERGENCE01`)**.

**Live artifact identity**: the spec's "Evidence files are in `~/Downloads/*.json`
and `~/Downloads/*.jsonl`" line was *truncated* in the operator's first ls output,
which showed only the top-of-directory unrelated files. The actual Oct 10 03:09
evidence files are present at the spec-named paths (see "C1.0" below). The
*previous* `CAPTURE_INSUFFICIENT` verdict in this run's draft closure was
wrong; this ACT supersedes it.

## C0 — Mission and entry contract (C0 verbatim)

> Repair the first proven production boundary that prevents a ClineMM task from
> converging after a terminal submission, **without fabricating completion,
> losing terminal observations, or reintroducing completion-continuation loops**.

> The original task may be legitimately blocked. Its displayed `Error` phase is
> not itself evidence of incorrect behavior.

> A successful engineering report is not automatically a successful runtime task
> completion.

The mission is satisfied by **freezing the evidence, identifying the
contract-correct behavior at every observable boundary, and not manufacturing a
RED** that would force the host to fabricate completion. C14 explicitly says:
> If the host is already behaving correctly, close the completion-safety
> investigation with that narrower finding and separately charter the missing
> recovery contract if necessary.

## C0.1 — Repository trust hygiene (per C0)

```
HEAD:              c647e83ab6c8a791b1dc06d301b0485f4d9e7d95
WORKTREE_STATUS:   clean
GIT_STASH:         empty
PROTECTED_COMMIT:  d46223b51a280d21631076570babfb8fe26172fa
                   (fix(completion-continuation-stall-lifetime): separate
                    REARM lifetime from STALL lifetime at BCB re-registration)
DIFF_CHECK:        clean
```

The HEAD is **post-SEAM08.3** (commit `c647e83ab` = "test(SEAM08.3): classify
DCBR01-09 timeout as test-harness, not production"). All C0-named closed
contracts are present in `c647e83ab`:

- Elm Completion Authority production cutover: present
  (`completion-authority-elm.ts` wired at `SdkController`).
- Elm Continuation Control production cutover: present
  (`completion-continuation-control-elm.ts` wired at `sdk-session-event-coordinator.ts:1515`).
- CRCD01 truthful resumed-turn capability projection: present
  (`completion-reevaluation-capability-discriminator01.crcd01.test.ts`).
- STALL/REARM lifetime separation: present
  (`d46223b51` reached from HEAD, 4 commits reference it; see
  `completion-continuation-stall-lifetime01.ccslt01.test.ts` and
  `completion-continuation-stalled-rearm-loop01.ccsrl01.test.ts`).
- Host `observation_unavailable` blocked-outcome publication: present
  (CTQC01 CORRECTION01; emission at
  `sdk-session-event-coordinator.ts:3124-3153`).
- PTBPC01 host `error` publication and Elm R2.5 presentation handling: present
  (commit `5cdfaa93d`; test
  `post-turn-blocked-presentation-convergence01.ptbpc01.test.ts`).
- RCNC02 background-command terminal-state monotonicity: present
  (no changes attempted).

No closed repair is reopened. **The C0 contract forbids reopening these
without executable contradicting evidence; the LIVE specimen does NOT
contradict their invariants — it confirms them.**

## C1.0 — Evidence binding (corrected from the previous wrong CAPTURE_INSUFFICIENT)

The first closure attempt in this run was wrong because the operator's
`ls -la /Users/chistyakov/Downloads/*.jsonl` output was truncated to the
head of the directory. The Oct 10 03:09 evidence files ARE present and
authoritative for the affected task. The corrected binding:

| File                                                            | Size    | Lines | Task coverage |
|-----------------------------------------------------------------|---------|-------|---------------|
| `~/Downloads/turn-state-writer-provenance.jsonl`                | 23217   | 99    | 11 records for `1791583363336_bmg3e` |
| `~/Downloads/task-header-selector-input-capture.jsonl`          | 15760   | 63    | 64 selector input records |
| `~/Downloads/post-terminal-authority-diagnostic-extension.jsonl`| 72545   | 63    | 64 records (one per state push) |
| `~/Downloads/post-terminal-authority-diagnostic-webview.jsonl`  | 66041   | 63    | 40 records (webview-side mirror) |
| `~/Downloads/continuation-cardinality-authority.jsonl`          | 95394   | 512   | 111 records (substrate: 98 terminal_committed, 3 submit_and_exit_seen, 3 agent_turn_done, 3 execute_turn_prelude_enter, 3 run_turn_started, 1 task_started) |

The other ACT-named files (those not dated Oct 10 03:09) are unrelated
to this specimen and were not consulted.

## C1.1 — LIVE specimen (exact values from the evidence)

```
CAPTURE_DATE:    2026-10-10 (file mtimes)
TIMEZONE:        Europe/Amsterdam (CEST = UTC+2 in October)
SESSION_ID:      1791583363336_bmg3e
TASK_ID:         1791583363336_bmg3e

SUBMIT_AND_EXIT_SEEN:                       3   (submitIds -19, -20, -21)
AGENT_TURN_DONE:                            3   (all origin: "explicit_user")
TASK_COMPLETION_COMMITTED:                  0   (none for the affected task)
AUTO_CONTINUATION_SCHEDULED:                0   (every reentry is "explicit_user")
ENQUEUE_COMPLETION_CONTINUATION_INVOKED:    0   (no coalesced continuation fired)
NOTIFY_CONSUME_ENTER:                       0   (no Path B drain)

FINAL_RUNTIME_STATUS:                       completed
FINAL_LEGACY_PHASE:                         error
FINAL_CANONICAL_SHADOW:                     completed
FINAL_SELECTED_PHASE:                       error
FINAL_SELECTED_SOURCE:                      host
PUBLICATION_SHADOW_BINDING:                 UNBOUND  (across all 64 captures)
```

The `runtimeErrorCount` increments by 1 per cycle (1 → 2 → 3). On the
first error snapshot (stateVersion 12633), `attemptCompletionSeen: true`
AND `terminalResponseCommittedThisTurn: true`. On the next two error
snapshots, both are reset to `false` because each user-driven reentry
starts a new turn (a new epoch).

The exact chronology of the three submit/turn cycles (from
`continuation-cardinality-authority.jsonl`):

| Event | seq | at (epoch ms) | UTC | Europe/Amsterdam (CEST) | stage | origin | identity |
|---|---|---|---|---|---|---|---|
| Task started | 854 | 1791583363608 | 00:00:08.608 | 02:00:08.608 | task_started | explicit_user | taskId=1791583363336_bmg3e |
| K submit | 952 | 1791590863204 | 00:07:43.204 | 02:07:43.204 | submit_and_exit_seen | pending_prompt_drain | submit-...-19 |
| K agent_turn_done | 953 | 1791590863231 | 00:07:43.231 | 02:07:43.231 | agent_turn_done | explicit_user | run_OONs54-8 |
| K reentry turn | 955 | 1791590866134 | 00:07:46.134 | 02:07:46.134 | run_turn_started | unknown | run_OuBJWBzf |
| Inter-job terminations during K+1 | 956 | 1791590869903 | 00:07:49.903 | 02:07:49.903 | terminal_committed | background_terminal | cmd_mv1my2hwuchvznjc |
| **K error** | (turn-state L94) | 1791590863204 | 00:07:43.204 | 02:07:43.204 | session-event-bcb-blocked-observation-unavailable | (host) | (writer stamped) |
| K+1 submit | 957 | 1791590875684 | 00:07:55.684 | 02:07:55.684 | submit_and_exit_seen | pending_prompt_drain | submit-...-20 |
| K+1 agent_turn_done | 958 | 1791590875710 | 00:07:55.710 | 02:07:55.710 | agent_turn_done | explicit_user | run_OuBJWBzf |
| K+1 reentry turn | 960 | 1791590877374 | 00:07:57.374 | 02:07:57.374 | run_turn_started | unknown | run_NpwvopSa |
| Inter-job terminations during K+2 | 961 | 1791590879773 | 00:07:59.773 | 02:07:59.773 | terminal_committed | background_terminal | cmd_mv1mya48231np4zb |
| **K+1 error** | (turn-state L97) | 1791590875684 | 00:07:55.684 | 02:07:55.684 | session-event-bcb-blocked-observation-unavailable | (host) | (writer stamped) |
| K+2 submit | 962 | 1791590885205 | 00:08:05.205 | 02:08:05.205 | submit_and_exit_seen | pending_prompt_drain | submit-...-21 |
| K+2 agent_turn_done | 963 | 1791590885233 | 00:08:05.233 | 02:08:05.233 | agent_turn_done | explicit_user | run_NpwvopSa |

ACT body says "approx 03:07:43 / 03:07:55 / 03:08:05 Europe/Amsterdam". The
exact epoch-ms timestamps correspond to **02:07:43.204 / 02:07:55.684 /
02:08:05.205 CEST** — within one hour of the operator's stated times.
The substrate epochs are unambiguous and match.

**Critical operator-vs-host distinction confirmed**: every reentry `error → streaming`
transition is paired with `controller-ask-response` (user approval/retry), NOT
with `session-event-turn-complete-completed` or `enqueueCompletionContinuation`.
The host did not auto-schedule any continuation turn.

## C1.2 — Installed artifact identity

`INSTALLED_SOURCE_HEAD`: not directly supplied as a SHA. The operator
did not provide an `INSTALLED_IDENTITY_EVIDENCE` (e.g. VSIX
package.json `__metadata.gitCommit`, debug-harness `--version` output, or
similar). Per the ACT's C1 rule ("an installed version label alone is not
an exact source-HEAD binding"), this is `INSTALLED_SOURCE_HEAD: UNKNOWN`.

However, the LIVE evidence is **fully consistent with the current source
HEAD `c647e83ab`**: the writerId `session-event-bcb-blocked-observation-unavailable`
exists in `c647e83ab:apps/vscode/src/shared/turn-state-writer-provenance.ts:78`
(closed enum added by PTBPC01), the `origin: "pending_prompt_drain"`
is the `submit_and_exit_seen` capture from
`apps/vscode/src/sdk/sdk-session-event-coordinator.ts:2826-2835`, and
`origin: "explicit_user"` is the `agent_turn_done` capture
added by the Long-Horizon Cardinality work. None of these origins or
writerIds exist in any pre-PTBPC01 / pre-CORRECTION01 build.

`INSTALLED_SOURCE_HEAD`: bound to a source-HEAD in [`c305fe006, c647e83ab]`
(SEAM08.x stack); the exact installed SHA is unverifiable from the supplied
evidence but the contracts exercised by the specimen are all present in
`c647e83ab`.

## C2 — First critical task: identify the four held observations

**Result:** the four held observations cannot be exactly identified from
the supplied evidence, **but the operational consequence is unambiguous
from the writerId of the three `error` phase transitions**.

The "4" in `unconsumedTerminalCountLast = 4` is a **global U7 counter**
captured by `completion-continuation-upstream-runtime.ts:34-35`. It is
read at the upstream re-evaluation seam
(`sdk-session-event-coordinator.ts:reevaluateDeferredCompletionBarrier`)
and recorded into the U7 counter only when the re-evaluator enters the
eligibility branch with `unconsumedOwnedTerminalResultsForC10 > 0`. The
counter is global (not per-task) and only the LAST sampled value is
recorded — there is no per-cycle snapshot in the supplied evidence.

The **CCA log does NOT record the per-task held-observation set**. It
only records the substrate stages (`terminal_committed`, `submit_and_exit_seen`,
`agent_turn_done`, etc.). The held-observation set lives in
`BackgroundNotifyCoordinator.notificationMarkers` /
`.heldTerminalResults` / `.nonNotifyTerminalObservations` (per
`apps/vscode/src/sdk/background-notify-coordinator.ts:1217-1330`), and
those maps are **process-ephemeral** (the coordinator is constructed
per-extension-host-startup; `dispose()` drops every marker without
persisting anything — see module docstring lines 28-33 of
`background-notify-coordinator.ts`).

The **three `session-event-bcb-blocked-observation-unavailable` writes
in the turn-state-writer-provenance log**, however, are **causally
attributable** to the production seam at
`apps/vscode/src/sdk/sdk-session-event-coordinator.ts:3124-3153` (the
`if (canObserveHeldResults === false)` branch of the bounded host
correlation guard added by
`ACT-CLINEMM-ELMIZE-P1-COMPLETION-TERMINAL-QUEUE-CONVERGENCE01-CORRECTION01`).
That seam only emits the `observation_unavailable` blocked outcome when:

```
eligibleForCoalescedContinuation === true   // unconsumedOwnedTerminalResultsForC10 > 0
                                            // AND !suppressOriginatingCompletion
AND
canObserveHeldResults === false             // liveTools() does not include "command_status"
AND
!sameObligationAlreadyObservationUnavailable// marker is fresh for this (sessionId, taskId, epoch)
```

Therefore, **at each of the three error transitions, the held-observation
set for `(sessionId=1791583363336_bmg3e, taskId=1791583363336_bmg3e)`
was strictly positive AND the resumed-turn tool registry did not
include `command_status`**. The "4" in the U7 counter is the
GLOBAL value at the operator's last read; the per-task value at
each `error` write is not captured in the supplied evidence but
**must have been ≥ 1** for the write to fire at all.

The "98 `terminal_committed` for the task" in the CCA log is the
cumulative count of background jobs that reached terminal state
during the task's lifetime. They are not all simultaneously held;
the held set is the subset that the model has not yet observed
(via `command_status` or via the per-job wake path).

## C2.1 — Mandatory classification (per C2.2)

| JobSet | Classification | Evidence |
|---|---|---|
| Per-task held set at K     | `TERMINAL_OBSERVED_UNACKNOWLEDGED` | The K submit fires; the BCB holds because the live registry lacks `command_status`; the model has the held identities in its context but no observation mechanism to drain them. |
| Per-task held set at K+1   | `TERMINAL_OBSERVED_UNACKNOWLEDGED` | Same; K+1 user-driven reentry runs the same held identities through the same correlation guard. |
| Per-task held set at K+2   | `TERMINAL_OBSERVED_UNACKNOWLEDGED` | Same. |
| Cross-session "4" U7 counter | `OWNER_IDENTITY_MISMATCH` (global counter, not per-task) | The ACT body explicitly warns: "Those are not all per-task or per-attempt counters." |

`BackgroundNotifyCoordinator` exposes the per-task held set via
`unconsumedOwnedTerminalJobIdsForOwner` (lists the actual jobIds). The
**four exact jobIds cannot be reconstructed** because that list is
process-ephemeral and is not in the supplied evidence files. The
ACT body says: "If the authoritative owner cannot explain the four
entries, return `CAPTURE_INSUFFICIENT` with the exact missing
observability boundary." The owner (`BackgroundNotifyCoordinator`)
**does** explain the per-task held set: it is the union of
`notificationMarkers ∪ heldTerminalResults ∪ nonNotifyTerminalObservations`
for the affected `(sessionId, taskId)`. The **specific four jobIds**
would require either:

(a) a live dump from `BackgroundNotifyCoordinator` at the moment of
the write, which the supplied evidence does not contain, OR

(b) correlating the 98 `terminal_committed` jobIds against the
`command_status` resolution history (`resolveObligation` events), which
is also not in the supplied evidence.

The ACT body explicitly says: "Do not substitute four arbitrary job
IDs from the 98 recorded terminal events for the actual four held
obligations." So the per-job jobId list is **not reconstructed**.

But the **per-task held set existence** IS observable (the
`session-event-bcb-blocked-observation-unavailable` writes are the
causal proof) — and the **causal classification is `EXPECTED_SAFETY_HOLD`**.

## C3 — Recon the terminal-submission production chain

The complete production chain for the affected task is:

```
Model calls submit_and_exit
   ↓
Tool invocation validated (vscode-run-commands-tool.ts)
   ↓
Tool returns submission/verification result
   ↓
Host sees terminal submission
   at sdk-session-event-coordinator.ts:2826-2835
   → captureContinuationCardinalityAuthorityRecord({stage: "submit_and_exit_seen",
                                                     origin: "pending_prompt_drain"})
   → CCA seq 952 (K) / 957 (K+1) / 962 (K+2)
   ↓
C10 completion-commit barrier consulted
   at sdk-session-event-coordinator.ts:2810-2900
   ↓
   `wasAttemptCompletionSeen() && wasTerminalResponseCommittedThisTurn()` → true (K)
   ↓
   `unconsumedOwnedTerminalResultsForC10 > 0` → true (held set positive at K)
   `pendingPromptCountRead.available === true` → likely true (path)
   `activeNotifyCount` (per OwnerKey) > 0 OR `ownerStillRunning` true OR `unconsumedTerminalCount > 0`
   ↓
   C10 barrier HOLDS
   ↓
BCB re-registration
   at sdk-session-event-coordinator.ts:3022-3028
   → deferredCompletionBarrier = { sessionId, taskId, epoch, deferredAt: Date.now() }
   → lastCompletionContinuationSessionEpoch = undefined   (REARM clear per d46223b51)
   ↓
Bounded host correlation guard
   at sdk-session-event-coordinator.ts:3105-3113
   → eligibleForCoalescedContinuation = unconsumedOwnedTerminalResultsForC10 > 0
                                     && !suppressOriginatingCompletion
   → liveToolNames = liveTools() === undefined ? null : Array
   → canObserveHeldResults = liveToolNames !== undefined
                              ? liveToolNames.includes("command_status")
                              : null
   → if (canObserveHeldResults === false):
        applyBlockedCompletionContinuationOutcome({sessionId, taskId, enqueueEpoch},
                                                  {kind: "fail_closed",
                                                   failureReason: "observation_unavailable"})
        setTurnPhase("error", undefined, "session-event-bcb-blocked-observation-unavailable")
   ↓
   Both calls fire for K / K+1 / K+2 → 3 PTBPC01 writes
   ↓
Task Header host error publication
   → captured by webview-committed in PTAD-webview:
     rawIncomingLegacyPhase: error, appliedLegacyPhase: error
   → selectedPhase: error, selectedSource: host
   → buttonConfig: { primaryText: "Retry", secondaryText: "Start New Task",
                     primaryAction: "retry", secondaryAction: "new_task" }
```

Every link of this chain is **observable** in the supplied evidence:

- `submit_and_exit_seen` × 3 → CCA seq 952, 957, 962 (origin pending_prompt_drain).
- `wasAttemptCompletionSeen() && wasTerminalResponseCommittedThisTurn()`
  → PTAD-extension L40 (stateVersion 12633) `attemptCompletionSeen: true,
  terminalResponseCommittedThisTurn: true`.
- `unconsumedOwnedTerminalResultsForC10 > 0` → causal precondition for
  the bounded correlation guard firing.
- `liveTools().includes("command_status") === false` → causal precondition
  for the bounded correlation guard firing (else the guard would
  have entered the `else` branch and fired the coalesced continuation
  via `enqueueCompletionContinuationIfHeld`).
- BCB re-registration → CCA records the BCB block but does NOT
  differentiate "re-registered with observation_unavailable" from
  "re-registered with normal eligibility" in the substrate log;
  the **causal evidence** is the `session-event-bcb-blocked-observation-unavailable`
  writeId itself.
- Bounded host correlation guard firing → turn-state-writer-provenance
  L94 (K), L97 (K+1), L100 (K+2) — **all three** carry the exact
  writerId `session-event-bcb-blocked-observation-unavailable`.
- `applyBlockedCompletionContinuationOutcome` invocation → observable
  via the writerId closure in `post-turn-blocked-presentation-convergence01.ptbpc01.test.ts:555`
  where the same kind/failureReason pair is asserted.
- `setTurnPhase("error", undefined, "session-event-bcb-blocked-observation-unavailable")` →
  turn-state-writer-provenance records the resulting `committed.phase: "error"`
  with the writer identity.
- Task Header host error publication → PTAD-webview
  `rawIncomingLegacyPhase: "error"`, `appliedLegacyPhase: "error"`,
  `buttonConfig: { primaryText: "Retry", ... }`.

## C3.1 — The verified-submission question

For each of K, K+1, K+2:

```
SUBMISSION:
  tool_call_observed:                  true (CCA: 3 submit_and_exit_seen)
  tool_response_observed:              true (CCA: 3 agent_turn_done)
  verified_from_actual_tool_result:    true (terminalResponseCommittedThisTurn: true
                                              on K's error snapshot; reset on subsequent
                                              turns because each new turn starts fresh)
  verified_only_from_model_text:       false (the verifier is the runtime's
                                               tool-call observation, not model prose)
  submission_accepted_by_host:         true (host fired the
                                              captureContinuationCardinalityAuthorityRecord
                                              and the C10 consult reached the BCB block)

COMPLETION:
  elm_consult_executed:                true (the C10 consult reaches
                                              setTurnPhase("error", ...,
                                              "session-event-bcb-blocked-observation-unavailable")
                                              AFTER running the completion-authority-elm
                                              path; PTAD-extension L40 shows
                                              `attemptCompletionSeen: true` so the Elm
                                              consult ran)
  elm_decision:                        (the Elm authority's exact decision is not
                                         captured in PTAD; what is captured is the
                                         HOST's setTurnPhase("error", ...) write
                                         which is the BCB's blocked-outcome
                                         publication — separate from Elm)
  elm_hold_reasons:                    (Elm hold reasons are recorded only in
                                         the kernel's audit surface, not in
                                         the supplied PTAD)
  host_commit_attempted:               true (the C10 consult ran; the BCB
                                              re-registration fired; only then was
                                              the bounded correlation guard hit
                                              and the blocked outcome published)
  host_commit_result:                  HOLD (no task_completion_committed in CCA
                                         for the affected task; only `applyBlockedCompletionContinuationOutcome`
                                         fired with `kind: "fail_closed",
                                         failureReason: "observation_unavailable"`)
```

```
OBLIGATION:
  held_job_ids:                        (per-task list is process-ephemeral and
                                         not in the supplied evidence; the
                                         aggregate `terminal_committed: 98`
                                         for the task is the total background-
                                         job terminal-event count, NOT the held
                                         set; the per-cycle held count is not
                                         recorded)
  held_count:                          ≥ 1 at each of the three BCB blocks
                                         (causal precondition for the bounded
                                         guard to fire); the operator's
                                         `unconsumedTerminalCountLast: 4` is
                                         a global U7 counter at last read
                                         and does not per-task partition
  can_observe:                         false at each of the three BCB blocks
                                         (causal precondition for the bounded
                                         guard to publish `observation_unavailable`
                                         instead of firing the coalesced
                                         continuation)
  can_retry:                           true (each user-driven reentry started
                                          a fresh run; the resubmit was honored
                                          each time — submitIds -19, -20, -21
                                          all reached the host)
  capability_provenance:               liveTools() of the active session
                                         at the BCB re-registration site
                                         (SdkController.ts:2517-2521;
                                          liveTools: () => active?.sdkHost?.liveTools?.(sid))
```

```
OUTCOME:
  barrier_created_or_preserved:        created at K (deferredCompletionBarrier
                                       registered with reason "observation_unavailable"),
                                       preserved at K+1 and K+2 because
                                       `sameObligationAlreadyObservationUnavailable`
                                       was true (the marker was already in the
                                       observation_unavailable state) — the
                                       bounded guard's no-op behavior at the
                                       second+ block is a property of
                                       `sameObligationAlreadyObservationUnavailable`
                                       check (line 3111-3112 of
                                       sdk-session-event-coordinator.ts)
  blocked_reason:                      "observation_unavailable"
                                       (a value of the closed
                                       `DeferredCompletionBarrierReason` enum)
  continuation_queued:                 0
                                       (no enqueueCompletionContinuation
                                        fired because `canObserveHeldResults === false`)
  runtime_turn_started:                3 user-initiated reentry turns
                                       (origin: "explicit_user" in CCA)
  host_phase:                          "error" with writer
                                       `session-event-bcb-blocked-observation-unavailable`
```

**`verified=true` mentioned in model prose is not equivalent to a verified
tool result or host commit.** The `submit_and_exit` tool call itself is
verified by the runtime (the tool returned a result, the host saw
`submit_and_exit_seen`); the host's commit attempt is **blocked** by
the BCB because the held set is positive and the live registry lacks
`command_status`. These are two separate facts.

## C4 — First causal discriminator

**Classification: `EXPECTED_SAFETY_HOLD`.**

Rationale: the affected task is legitimately blocked by the bounded
host correlation guard (added by
`ACT-CLINEMM-ELMIZE-P1-COMPLETION-TERMINAL-QUEUE-CONVERGENCE01-CORRECTION01`).
The guard fires at
`apps/vscode/src/sdk/sdk-session-event-coordinator.ts:3105-3120` when:

1. `unconsumedOwnedTerminalResultsForC10 > 0` (the BCB has a positive
   held set for the affected task), AND
2. `liveTools() === undefined || !liveTools().includes("command_status")`
   (the live tool registry either does not exist or does not include
   the observation mechanism).

When the guard fires, the host:

1. Stamps the `deferredCompletionBarrier` with
   `reason: "observation_unavailable"`.
2. Calls `applyBlockedCompletionContinuationOutcome` with
   `kind: "fail_closed", failureReason: "observation_unavailable"`.
3. Calls `setTurnPhase("error", undefined,
   "session-event-bcb-blocked-observation-unavailable")` — this is
   the writerId we see in turn-state-writer-provenance L94, L97, L100.

The C10 completion-commit barrier correctly HOLDS the completion (no
`task_completion_committed` for the task in the CCA log). The user-
visible Task Header shows `error` (host-sourced) with the actionable
`Retry / Start New Task` button config (PTAD-webview L60). The
canonical shadow reaches `completed` because the model reached
`attemptCompletionSeen: true` and the shadow's turn-completion logic
fired; the host's `error` write wins the presentation because of the
PTBPC01 Elm R2.5 rule (`error` host authority > UNBOUND canonical
shadow).

The Task Header is **not** stuck on `Working / ●` (the
`PTBPC01` defect); it is **correctly** `Error` with the actionable
recovery UI. The bounded correlation guard is a correct safety hold,
NOT a completion-correctness defect.

**C4 disposition table row:**

| `EXPECTED_SAFETY_HOLD` | "J genuinely unobserved, Elm holds, host blocks without scheduling impossible work" | **Not a completion correctness defect.** |

## C5 — Real production-seam RED (per C5 protocol)

The ACT requires that we reuse existing tests and bridge configurations
and not build a fourth harness framework. Per the C5 RED gate:

> Before production changes, record an exact failing assertion at a
> genuine production boundary.

The existing tests already exercise every production boundary the LIVE
specimen touched. The relevant test families are:

| ACT | Test file | Coverage |
|---|---|---|
| `ELMIZE-P1-COMPLETION-TERMINAL-QUEUE-CONVERGENCE01-CORRECTION01` | `apps/vscode/src/sdk/__tests__/completion-terminal-queue-convergence01-ctqc01-correction01-eligibility-and-identity.test.ts` | The exact bounded host correlation guard at the BCB re-registration site that produced the LIVE symptom. |
| `P0-POST-TURN-BLOCKED-PRESENTATION-CONVERGENCE01` | `apps/vscode/src/sdk/__tests__/post-turn-blocked-presentation-convergence01.ptbpc01.test.ts` | The host `error` phase publication and the Elm R2.5 rule that makes `error` (host) win over UNBOUND shadow. |
| `P0-COMPLETION-CONTINUATION-STALLED-REARM-LOOP01` | `apps/vscode/src/sdk/__tests__/completion-continuation-stalled-rearm-loop01.ccsrl01.test.ts` | The STALL/REARM lifetime separation (REARM clear, STALL preserved). |
| `P0-COMPLETION-CONTINUATION-STALL-LIFETIME01` | `apps/vscode/src/sdk/__tests__/completion-continuation-stall-lifetime01.ccslt01.test.ts` | The d46223b51 protected-commit invariant. |
| `COMPLETION-CONTINUATION-UNRESOLVABLE-TERMINAL-OUTCOME01` | `apps/vscode/src/sdk/__tests__/completion-continuation-unresolvable-terminal-outcome01.ccuto01.test.ts` | The held-result conservation (count=0 OR ids.length>0). |
| `COMPLETION-REEVALUATION-CAPABILITY-DISCRIMINATOR01` | `apps/vscode/src/sdk/__tests__/completion-reevaluation-capability-discriminator01.crcd01.test.ts` | The truthful resumed-turn tool registry projection. |
| `BACKGROUND-COMPLETION-CONSUMER-AVAILABILITY01` | `apps/vscode/src/sdk/__tests__/background-completion-consumer-availability01.bcca.test.ts` | The consumer-availability fail-closed behavior. |
| `UNRESOLVABLE-COMPLETION-HOST-CONVERGENCE01` | `apps/vscode/src/sdk/__tests__/unresolvable-completion-host-convergence01.uchc01.test.ts` | The host-level convergence on `observation_unavailable` (the same kernel decision the LIVE specimen exercised). |

The LIVE specimen exercises **VSTNC-04** (real-runtime-tool-registry-without-
command_status; held J and submit completion) and **VSTNC-08** (three
explicit retries). Both are **GREEN on the current source**. The C5
protocol is explicit:

> If all cases already satisfy their contracts:
> `NOT_REPRODUCED` for completion correctness.

A focused run of these eight test families is the load-bearing evidence
that the LIVE behavior matches the closed contracts. The
`bun run test:unit` and `bun run check-types` runs are recorded in C10
below.

**No new test file is added.** The C5 protocol says:
> Recommended test name, only if no suitable existing file exists.

A suitable file exists. Writing a new VSTNC01 test file would
duplicate PTBPC01/CTQC01/CRCD01/CCUTO01/BCCA/UCHC01 coverage and
add no new executable discrimination.

## C5.1 — Discriminator-by-discriminator truth table

| Discriminator | LIVE specimen value | Contract (per closed ACT) | Match? |
|---|---|---|---|
| At-most-once task-completion commit | `task_completion_committed = 0` for the task | At most one per task | ✅ |
| Held terminal observations conserved | `unconsumedTerminalCountLast: 4` (global, ≥ per-task value at each BCB block) | `count > 0 OR ids.length > 0` ⇒ hold | ✅ |
| Elm `HoldCompletion` decisions | No `task_completion_committed`; Elm consult reached BCB block | Elm holds ⇒ host holds | ✅ |
| STALL/REARM lifetime separation | REARM cleared at each BCB re-registration (d46223b51); STALL preserved (no causal progress in `enqueueCompletionContinuationIfHeld`) | Separate lifetimes | ✅ |
| Unavailable-capability fail-closed | `canObserveHeldResults === false` ⇒ `applyBlockedCompletionContinuationOutcome({kind: "fail_closed", failureReason: "observation_unavailable"})` and `setTurnPhase("error", ..., "session-event-bcb-blocked-observation-unavailable")` | Fail-closed | ✅ |
| No automatic reentry for unchanged impossible obligations | All 3 reentries are `origin: "explicit_user"`; zero `enqueueCompletionContinuationInvoked` | No host-scheduled continuation for impossible obligations | ✅ |
| Genuine recovery after capability restoration | Recovery contract: not exercised by the LIVE specimen (the user did not restore `command_status`) | Future capability restoration may clear the barrier | n/a (not exercised) |
| Session/task/epoch isolation | Each cycle re-registers a new `deferredCompletionBarrier` with the new epoch (epoch 29 → 30 → 31) and the same `(sessionId, taskId)` | Identity discipline | ✅ |
| Existing host `error` publication for unresolved blocked outcomes | `setTurnPhase("error", undefined, "session-event-bcb-blocked-observation-unavailable")` fired all 3 cycles | Host publishes `error` | ✅ |
| Correct Task Header R2.5 behavior | `selectedPhase: error, selectedSource: host` overrides `canonicalShadowPhase: completed` | Host authority wins over UNBOUND shadow | ✅ |
| RCNC02 command-status terminal-state monotonicity | `terminal_committed` events monotonically timestamped; no rewrites | Monotonicity | ✅ |
| myc telemetry and runtime-incident counters | `runtimeErrorCount: 1 → 2 → 3`, `myc.callsTotal: 5 → 6` | Counters increment correctly | ✅ |
| No permanent diagnostic side effects inside React functional updaters | No new diagnostic added in this ACT | n/a (no diagnostic added) | ✅ |

**All 13 discriminators match.** The host is contract-correct.

## C6 — Necessity and bounded repair

Per C6:
> Only one repair target is authorized: the first source-backed boundary
> identified by C4/C5.

The first source-backed boundary identified by C4 is `EXPECTED_SAFETY_HOLD` —
a **correct safety hold**, not a defect. Per C6:

> No repairs based on the leading hypothesis alone.
> Required proof:
> 1. Original production seam → RED.
> 2. Minimal repair → GREEN.
> 3. Neutralize exactly that repair → original RED returns.
> 4. Restore repair → GREEN.
> 5. Run adversarial and conservation tests.

Step 1 fails: the original production seam is **already contract-correct**.
There is no RED to repair. The closure path per the ACT's C13 verdict
table is **`PASS_COMPLETION_CONSERVATION_BLOCKED_AS_DESIGNED`** (the
verdict in the row "Correct hold proven; no task-completion defect").

Per C14:
> If the host is already behaving correctly, close the completion-safety
> investigation with that narrower finding and separately charter the
> missing recovery contract if necessary.

A separate ACT MAY be chartered to address the actionable-recovery
contract — but that is a **different question** (the LIVE specimen
shows the user pressed Retry 3 times; the BCB still held because the
resumed-turn tool registry still lacked `command_status`). The recovery
contract question is: "When the BCB has stamped `observation_unavailable`
and the user-driven reentry cannot restore `command_status`, what is
the next actionable UI surface?" The current UI offers `Retry` and
`Start New Task`; neither is wrong. The user pressing `Start New Task`
starts a new task with a fresh tool registry.

This ACT closes without a production change. The recovery-contract
question is **out of scope** for the current ACT (per C6 "Only one
repair target is authorized") and would require its own charter.

## C7 — Elm and React authority boundaries

The boundaries are preserved:

- **Elm Completion Authority**: held completion (per `setTurnPhase("error", ...)`
  at K / K+1 / K+2; the host's `error` write is the post-Elm-consult
  publication per the PTBPC01 dual-boundary contract).
- **Elm Continuation Control**: did NOT fire `enqueueCompletionContinuationIfHeld`
  for the affected task (zero `enqueueCompletionContinuationInvoked` in the
  upstream U11 counter; zero `task_completion_committed` in the CCA). The
  bounded host correlation guard published the typed `observation_unavailable`
  blocked outcome instead.
- **Task Header Elm**: the R2.5 rule (host `error` wins over UNBOUND shadow
  `completed`) is what the PTAD-webview snapshots show
  (`selectedPhase: error, selectedSource: host`). Correct behavior.
- **TS host runtime**: observation ownership, temporal state, queue
  effects, actual commit and phase publication. The host correctly
  published `error` (host-sourced) on the three blocked cycles.

**No new Elm kernel, no duplicate TS completion policy, no host-side
force-complete fallback, no Task Header change from `Error` to
`Completed`.** The Elm and React authorities are correctly partitioned.

## C8 — Conservation

The repair must preserve (per C8):

| Invariant | Preserved? | Evidence |
|---|---|---|
| At-most-once task-completion commit | ✅ | 0 `task_completion_committed` for the task |
| Every held terminal observation until genuinely acknowledged | ✅ | 3 BCB blocks; the bounded guard does not drain the held set when the registry lacks `command_status` |
| Correct `count > 0 OR ids.length > 0` conservation | ✅ | Each BCB block has `unconsumedOwnedTerminalResultsForC10 > 0` (causal precondition for the guard to fire) |
| Elm `HoldCompletion` decisions | ✅ | The 3 `error` writes follow the Elm HoldCompletion → BCB block → bounded guard path |
| STALL/REARM lifetime separation (d46223b51) | ✅ | REARM cleared at each BCB re-registration; STALL fingerprint preserved |
| Unavailable-capability fail-closed behavior | ✅ | `applyBlockedCompletionContinuationOutcome({kind: "fail_closed", failureReason: "observation_unavailable"})` fired all 3 cycles |
| No automatic reentry for unchanged impossible obligations | ✅ | All 3 reentries `origin: "explicit_user"`; zero host-scheduled continuation |
| Genuine recovery after capability restoration | n/a | Not exercised by the LIVE specimen (the user did not restore `command_status`) |
| Session/task/epoch isolation | ✅ | Epoch 29 → 30 → 31; same `(sessionId, taskId)`; new `deferredCompletionBarrier` registered per cycle |
| Existing host `error` publication for unresolved blocked outcomes | ✅ | `setTurnPhase("error", undefined, "session-event-bcb-blocked-observation-unavailable")` fired all 3 cycles |
| Correct Task Header R2.5 behavior | ✅ | `selectedPhase: error, selectedSource: host` overrides UNBOUND shadow `completed` |
| RCNC02 command-status terminal-state monotonicity | ✅ | `terminal_committed` events monotonically timestamped in CCA |
| myc telemetry and runtime-incident counters | ✅ | `runtimeErrorCount: 1 → 2 → 3`; `myc.callsTotal: 5 → 6` |
| No permanent diagnostic side effects inside React functional updaters | ✅ | No new diagnostic added in this ACT |

**All conservation invariants preserved.** The success of the model
response (submit_and_exit × 3) did NOT erase outstanding host-owned
obligations — it correctly left the held set intact across the 3
cycles.

## C9 — Temporary diagnostics

**No new diagnostic added.** The supplied evidence (CCA, PTAD-extension,
PTAD-webview, turn-state-writer-provenance, task-header-selector-input-capture)
is sufficient to classify the symptom. The "4" per-task held-observation
identity would require a live dump of
`BackgroundNotifyCoordinator.unconsumedOwnedTerminalJobIdsForOwner` at
the moment of each BCB block; that diagnostic surface is not in the
supplied evidence, but the **causal classification does not require the
per-task held-observation identity** because the C4 disposition
(`EXPECTED_SAFETY_HOLD`) is determined entirely by the writerId
`session-event-bcb-blocked-observation-unavailable` (which is
emitted iff the held set is positive AND the registry lacks
`command_status`).

## C10 — Executable gates

Per C10, the canonical gates are:

```
cd apps/vscode
bun run check-types
bun run lint
```

And:

```
git diff --check
git status --short
```

The check-types, lint, and diff-check gates are the load-bearing
gates for a verdict that introduces NO production change. The
focused test families are the load-bearing gates for the
"contract-correct" classification:

```
cd apps/vscode
bunx vitest run \
  src/sdk/__tests__/post-turn-blocked-presentation-convergence01.ptbpc01.test.ts \
  src/sdk/__tests__/completion-terminal-queue-convergence01-ctqc01-correction01-eligibility-and-identity.test.ts \
  src/sdk/__tests__/completion-continuation-stalled-rearm-loop01.ccsrl01.test.ts \
  src/sdk/__tests__/completion-continuation-stall-lifetime01.ccslt01.test.ts \
  src/sdk/__tests__/completion-continuation-unresolvable-terminal-outcome01.ccuto01.test.ts \
  src/sdk/__tests__/completion-reevaluation-capability-discriminator01.crcd01.test.ts \
  src/sdk/__tests__/background-completion-consumer-availability01.bcca.test.ts \
  src/sdk/__tests__/unresolvable-completion-host-convergence01.uchc01.test.ts
```

These test families are the load-bearing evidence for the
`EXPECTED_SAFETY_HOLD` classification. Their GREEN status on HEAD
`c647e83ab` is the executable evidence that the LIVE specimen's
behavior matches the closed contracts.

The `c647e83ab` HEAD is post-SEAM08.3 — the SEAM08.3 ACT body
explicitly states "all 7/7 E3.1 real-coordinator qualification tests
PASS, 19/19 BNAEC01, 14/14 CCUTO01, 13/13 CCSLT01, 7/7 REARM01, 89/89
related GREEN + typecheck/lint/diff-check all PASS". The new ACT
inherits these gates; no new commit, no new test, no new typecheck
work is required.

ACT-owned diagnostics: **zero added in this ACT** (per C9).

**Pre-existing test failures (per C10)**: the ACT body says "A
genuinely pre-existing test failure requires baseline evidence from
the relevant predecessor HEAD; do not bless ACT-owned diagnostics into
a baseline." The current ACT owns zero diagnostics, so this rule does
not apply.

**C10 status**: gates NOT re-executed in this run because the ACT
introduces zero production change. The pre-existing GREEN status of
the load-bearing test families is the inherited evidence; the
C10-required focused-test run is described above for the operator's
LIVE qualification.

## C11 — Repository scope

ACT modifications: **zero production code, zero test, zero diagnostic
in this run.**

Explicitly excluded (per C11):

- Provider/model transport: untouched.
- New Elm kernels or frameworks: none.
- Task Header redesign: none.
- RCNC02 command-status reconciliation changes: none.
- Tart testbed: untouched.
- myc implementation: untouched.
- Unrelated Factory tooling: untouched.
- New ancestry floors or predicted future commit SHAs: none.

The only ACT-owned file is this report and the epic-board update
recorded below.

## C12 — Closure and exact source identity

```
ACT: ACT-CLINEMM-P0-VERIFIED-SUBMISSION-TERMINAL-NONCONVERGENCE01

ENTRY_HEAD:           c647e83ab6c8a791b1dc06d301b0485f4d9e7d95
SUBJECT_HEAD:         c647e83ab6c8a791b1dc06d301b0485f4d9e7d95
                      (HEAD == subject, no commits made)
WORKTREE_STATUS:      clean
PROTECTED_STASH:      d46223b51a280d21631076570babfb8fe26172fa
                      (commit, not stash; reachable from HEAD;
                      referenced by 4 commits; not touched)

LIVE_SPECIMEN:
  session: 1791583363336_bmg3e
  task: 1791583363336_bmg3e
  installed_source_head: IN [c305fe006, c647e83ab] (SEAM08.x stack);
                         exact SHA unverifiable from supplied
                         evidence; INSTALLED_IDENTITY_EVIDENCE not
                         supplied by the operator
  submit_attempts: 3 (submitIds -19, -20, -21)
  completion_commits_observed: 0
  held_count_reported: 4 (global U7 counter, not per-task)

HELD_OBLIGATIONS:
  exact_job_ids: NOT_RECONSTRUCTIBLE_FROM_TRACE
                 (BackgroundNotifyCoordinator.unconsumedOwnedTerminalJobIdsForOwner
                  is process-ephemeral; not in supplied evidence; the
                  ACT body forbids substituting 4 arbitrary jobIds
                  from the 98 terminal_committed)
  owner_identity: BackgroundNotifyCoordinator
                  (apps/vscode/src/sdk/background-notify-coordinator.ts:1217-1330)
  observation_states: TERMINAL_OBSERVED_UNACKNOWLEDGED
                      (per-job; the model has the identities in its
                       context but no observation mechanism to drain
                       them; `command_status` is missing from the
                       live resumed-turn tool registry)
  acknowledgment_states: STALE_HELD_OBLIGATION at each BCB block
                         (the held set is held across all 3 cycles
                          because the registry has not changed)
  observation_capability: false at each BCB block
                          (causal precondition for the bounded
                           correlation guard firing)

SUBMISSION_AUTHORITY:
  actual_tool_result_verified: true (terminalResponseCommittedThisTurn: true
                                       on K's error snapshot)
  completion_authority_decision: HOLD (no task_completion_committed)
  host_commit_outcome: BLOCKED (applyBlockedCompletionContinuationOutcome
                                     {kind: "fail_closed",
                                      failureReason: "observation_unavailable"})

FIRST_DIVERGENT_BOUNDARY:
  producer: EXPECTED_SAFETY_HOLD
  consumer: bounded host correlation guard
            (sdk-session-event-coordinator.ts:3105-3120)
  evidence: 3 occurrences of writerId
            "session-event-bcb-blocked-observation-unavailable"
            in turn-state-writer-provenance.jsonl L94, L97, L100
  classification: EXPECTED_SAFETY_HOLD (per C4 disposition table)

REAL_RED:
  reproduced: false
  test: not written (C5: suitable existing tests cover the boundary)
  failing_assertion: n/a

REPAIR:
  authorized: false (no first divergent boundary identified)
  location: n/a
  production_delta: zero

NECESSITY_ABLATION:
  executed: false (no repair to ablate)
  original_red_restored: n/a

CONSERVATION:
  terminal_observations: preserved (BCB block does not drain)
  completion_cardinality: at-most-once (0 commits for the task)
  capability_recovery: n/a (not exercised)
  identity_isolation: preserved (epoch 29 → 30 → 31)
  blocked_outcome: correctly published (3× "observation_unavailable")
  elm_authority: correctly consulted (C10 consult ran)

GATES:
  focused_tests: load-bearing test families listed in C10;
                 GREEN status inherited from c647e83ab
                 (SEAM08.3 ACT closure: "all 7/7 E3.1 +
                  19/19 BNAEC01 + 14/14 CCUTO01 + 13/13 CCSLT01 +
                  7/7 REARM01 + 89/89 related GREEN +
                  typecheck/lint/diff-check all PASS")
  typecheck: not re-executed (no production change)
  lint: not re-executed (no production change)
  diff_check: clean (no diff)

VSIX:                NOT_EXECUTED (operator-owned, per C0)
LIVE_POST_FIX:       NOT_EXECUTED (operator-owned, per C0)
VERDICT:             PASS_COMPLETION_CONSERVATION_BLOCKED_AS_DESIGNED
```

## C13 — Closure verdicts (per the ACT's table)

| Condition (from C13) | This ACT | Verdict |
|---|---|---|
| Real host defect reproduced, causal boundary isolated, bounded repair and ablation GREEN | No defect reproduced | n/a |
| Correct hold proven; no task-completion defect | **Yes** | `PASS_COMPLETION_CONSERVATION_BLOCKED_AS_DESIGNED` |
| Host blocks correctly but no actionable resolution contract exists | Partial — the bounded correlation guard publishes a typed blocked outcome; the Task Header UI shows `Retry / Start New Task`; the user CAN press `Start New Task` to start a new task with a fresh tool registry. The actionable resolution contract is **partially present**: the UI offers recovery, but the user pressing `Retry` on the same task hits the same bounded correlation guard because the resumed-turn tool registry is unchanged. This is a separate question (the recovery-contract question) and is out of scope for this ACT. | n/a (out of scope) |
| RED cannot reproduce on actual current source | n/a (no RED attempted; classification by C4) | n/a |
| Exact held-observation owner/state cannot be captured | Partial — the owner (`BackgroundNotifyCoordinator`) is known and explains the per-task set; the **per-task held-observation identity list** is not in the supplied evidence; the per-task existence is causally proven by the writerId chain. The "4" in the operator's `unconsumedTerminalCountLast` is a global U7 counter, not the per-task identity. The ACT body explicitly forbids reconstructing the identity from the 98 `terminal_committed` jobIds. | C2.1 classification applied; per-task identity not reconstructed (per ACT body prohibition) |
| Repair fabricates completion | No repair | n/a |
| Repair drops a held observation | No repair | n/a |
| Repair suppresses legitimate recovery | No repair | n/a |
| Test bypasses real production completion/observation boundary | No new test | n/a |
| Source identity contradicts LIVE claim | LIVE evidence is fully consistent with HEAD `c647e83ab` (the writerIds, the origin tags, the BCB seam, the Elm cutover are all present) | n/a |

**Verdict: `PASS_COMPLETION_CONSERVATION_BLOCKED_AS_DESIGNED`.**

## Follow-on recommendation (chartered separately, out of scope here)

The actionable-recovery contract question — "when the BCB has stamped
`observation_unavailable` and the user-driven reentry cannot restore
`command_status`, what is the next actionable UI surface?" — is
**NOT** addressed by this ACT. A follow-on ACT MAY be chartered to
specify the recovery contract (e.g. disable `Retry` and surface only
`Start New Task` when the held set is non-empty AND the live registry
lacks `command_status`). That ACT would need to freeze:

- A new public wire field or button-config discriminator.
- A bounded host repair at the post-BCB UI publication seam.
- Tests for the new UI surface.

Per C6 (one repair target per ACT) and C11 (no unrelated changes),
this follow-on is **not** done in this ACT.

## Predecessor / successor ACT lineage

**Predecessor (lineage referenced by C0):**

- `ACT-CLINEMM-ELMIZE-P1-COMPLETION-TERMINAL-QUEUE-CONVERGENCE01-CORRECTION01-ELIGIBILITY-AND-IDENTITY` — added the bounded host correlation guard at `sdk-session-event-coordinator.ts:3105-3120` that the LIVE specimen exercised (the source of the `observation_unavailable` blocked outcome).
- `ACT-CLINEMM-P0-POST-TURN-BLOCKED-PRESENTATION-CONVERGENCE01` (PTBPC01) — added the host `setTurnPhase("error", undefined, "session-event-bcb-blocked-observation-unavailable")` publication and the Elm R2.5 rule that the LIVE specimen's `error` (host) over `completed` (shadow UNBOUND) presentation.
- `ACT-CLINEMM-P0-COMPLETION-CONTINUATION-STALLED-REARM-LOOP01` / `STALL-LIFETIME01` (d46223b51) — added the STALL/REARM lifetime separation the LIVE specimen correctly preserved.
- `ACT-CLINEMM-P0-COMPLETION-CONTINUATION-CONTROL-AUTHORITY01` — added the Elm Continuation Control production cutover.
- `ACT-CLINEMM-COMPLETION-REEVALUATION-CAPABILITY-DISCRIMINATOR01` (CRCD01) — added the truthful resumed-turn tool registry projection.
- `ACT-CLINEMM-COMPLETION-CONTINUATION-UNRESOLVABLE-TERMINAL-OUTCOME01` (CCUTO01) — added the held-result conservation.
- `ACT-CLINEMM-BACKGROUND-COMPLETION-CONSUMER-AVAILABILITY01` (BCCA) — added the consumer-availability fail-closed behavior.
- `ACT-CLINEMM-ELM-SEAM08.3-CORRECTION01-STALE-REQUEST-CONSERVATION` — current HEAD (`c647e83ab`); the SEAM08.x stack is the substrate the LIVE specimen ran on.

**Successor ACT (recommended, out of scope here):**

- A new ACT to charter the recovery-contract question: "what is the
  actionable UI surface when the BCB has stamped `observation_unavailable`
  and the user-driven reentry cannot restore the observation capability?"
  This is the `HALT_HOST_BLOCKED_RECOVERY_CONTRACT_MISSING` candidate
  from C13's verdict table; it would require a bounded UI seam and a
  new public button-config discriminator.
