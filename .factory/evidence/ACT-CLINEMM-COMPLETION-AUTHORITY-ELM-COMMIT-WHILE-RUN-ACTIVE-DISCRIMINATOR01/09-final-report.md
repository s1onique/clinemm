# §19 — Final report

```
ACT=
ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-COMMIT-WHILE-RUN-ACTIVE-DISCRIMINATOR01

ENTRY_HEAD=
4f702adbcd70e0aee04c52be087703e52a7aad10

REAL_SESSION_ID=1790809530345_lrsk9
REAL_TRACE_SHA256=ec77301dd854dffe4d8121643852fd9a33ab7dddac8b2d70c9b0da1d9d0ddccd
REPLAYABLE_PROJECTION_SHA256=ad5c8b26c89bc6287aa92072823e43451efe6751749328faeb0be4289bc0f12b
REAL_DIVERGENCE_SEQ=8
REAL_DIVERGENCE_STAGE=task_completion_committed
REAL_DIVERGENCE_KIND=ELM_REJECTS_TS_SEQUENCE
REAL_DIVERGENCE_VIOLATION=TaskCompletionCommittedWhileHeld active_run

C10_BEFORE_C8_REPRODUCED=
true
- LIVE trace seq 8 (at=1790809536499) precedes seq 9 (at=1790809536550) by 51ms.
- Bridge test CWRA-01.RED confirms production-source C10 site is INSIDE executeTurn (sdk-session-event-coordinator.ts:1431) and C8 site is AFTER executeTurn returns (local-runtime-host.ts:1321).

C10_SEMANTIC_STATE=
zero_unresolved_authority
- BCB barrier passed: outstandingAutonomousWork=false at C10.
- wasTerminalResponseCommittedThisTurn()=true; wasAttemptCompletionSeen()=true.
- No held background jobs, no queued prompts, no active notify markers.
- runIdBySessionId retains run_h7wXy0mx (the Elm kernel's `ActiveRun` hold sees this exact runId).

C10_TO_C8_SEMANTIC_EVENTS=
zero_semantic
- 4 BOOKKEEPING: setTurnPhase("completed", ...); sessions.setRunning(false); handleSessionEvent return; executeTurn return.
- 1 TEARDOWN: taskHistory.updateTaskUsage (fire-and-forget).
- 1 OBSERVATION: postStateToWebview (fire-and-forget).
- 1 UNKNOWN: leaveExtensionHostHotloopHandleSessionEvent (diagnostic-only, no-op when OFF).
- Zero events match the §4 definition of semantic work (model/tool work, prompt creation/drain, continuation scheduling, command/job ownership transition, terminal observation, task-state mutation, submit/completion transition, completion-invalidating failure).

POST_C10_FAILURE_CAN_INVALIDATE_COMPLETION=
false
- CWRA-05 verdict: NOT_APPLICABLE.
- No injectable semantic failure seam in the C10->C8 interval.
- All failure modes are: fire-and-forget Promise rejections (logged-and-suppressed), diagnostic-only depth-tracker (no-op when OFF), or a host-side race that does NOT invalidate semantic completion (only produces an inconsistent CCARD ring: C10 without C8).

COUNTERFACTUAL_C8_BEFORE_C10_ELM_RESULT=
NO_VIOLATION
- Counterfactual projection (06-counterfactual-replay.json) replayed through REAL Elm kernel.
- agent_turn_done emitted FIRST (clears activeRun=Just runId).
- submit_and_exit_seen emitted (no commit yet, activeRun is already Nothing).
- task_completion_committed emitted (no hold -> task=completion_committed, committedCompletion=Just completionId).
- firstDivergenceSeq=null, firstDivergenceKind=null, firstDivergenceStage=null.
- Deterministic SHA256: 480e75f223f8c6f22b5049a07ac0f297ca7b9781af331f78f79a758838584866.
- CONCLUSION: The Elm disagreement is specifically about C10/C8 ordering. The kernel is internally consistent.

H1_ELM_TOO_STRICT=true
H2_TS_COMMITS_TOO_EARLY=false

VERDICT=H1_ELM_TOO_STRICT

ROOT_CAUSE=
The Elm kernel's `computeHoldReasons` (Authority.elm:439-532) classifies `activeRun /= Nothing` as a completion-blocking hold. The hold treats "an agent_turn_done event has not yet been received for the currently-active run" as semantically equivalent to "the run is still semantically active and cannot be committed". In production, agent_turn_done fires AFTER task_completion_committed by 51ms because (a) C9+C10 fire inside `handleSessionEvent` synchronously when the agent's done event propagates through eventBridge, and (b) C8 fires in `LocalRuntimeHost.runTurn` AFTER `await executeTurn(...)` returns. The semantic completion (attempt_completion tool's content_end committed the terminal response, BCB barrier passed, deferred continuation machinery did not engage, setTurnPhase("completed", ...) is the authoritative UI commit) is COMPLETE at C10. C8 is downstream bookkeeping the Elm kernel mistakenly requires for commit authorization. The model is correct in spirit (completion should require the run to be closed) but wrong in mechanism (it requires the agent_turn_done event to have fired).

PRODUCTION_SEMANTICS_CHANGED=false
ELM_AUTHORITY_SEMANTICS_CHANGED=false
QUEUE_SEMANTICS_CHANGED=false
PRESENTATION_SEMANTICS_CHANGED=false
MCP_CODE_CHANGED=false
MYC_CODE_CHANGED=false

READY_FOR_ELM_SHADOW02=false
SUCCESSOR_ACT=
ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-COMMIT-WHILE-RUN-ACTIVE-REPAIR01

EVIDENCE_INVENTORY:
- 00-entry.txt                              ACT metadata, frozen identities
- 01-real-live-trace.jsonl                  REAL + LIVE + REAL_PRODUCTION_SEAM (9 records, SHA matches REAL_TRACE_SHA256)
- 01-real-live-counters.json              REAL + LIVE counter snapshot
- 02-replayable-projection.jsonl            DERIVED_REAL_PROJECTION (5 records, SHA matches REPLAYABLE_PROJECTION_SHA256)
- 03-real-replay-result.json                REAL_OFFLINE_REPLAY (REAL trace over Elm kernel — first divergence at seq 1 due to INSUFFICIENT_IDENTITY for terminalKind)
- 04-projected-replay-result.json          REAL_OFFLINE_REPLAY (projected trace over Elm kernel — first divergence at seq 8 ELM_REJECTS_TS_SEQUENCE active_run)
- 02-recon.md                              §3 seam table + Q&A from production source
- 03-c10-state.md                          §7 CWRA-02 state snapshot at C10
- 04-c10-to-c8-events.md                   §8 CWRA-03 events between C10 and C8
- 05-post-c10-failure-discriminator.md     §10 CWRA-05 post-C10 failure modes (NOT_APPLICABLE)
- 06-counterfactual-replay.json            §11 CWRA-06 counterfactual B = C8 before C10 (NO VIOLATION)
- 07-existing-contracts.md                  §12 CWRA-07 existing TS invariants
- 08-discriminator-result.md              §16 decision tree composition
- 09-final-report.md                       THIS FILE

PRODUCTION_SHAPE_BRIDGE_TEST:
- apps/vscode/src/sdk/__tests__/completion-authority-commit-while-run-active-discriminator01.c24-c-bridge.test.ts
- Registered in apps/vscode/vitest.config.c2-4-c-bridge.ts
- 7 tests, all PASS:
  - CWRA-01.RED: production code emits C10 inside executeTurn teardown and C8 AFTER executeTurn returns
  - CWRA-01.HOST: real LocalRuntimeHost fires prelude_enter then agent_turn_done in runTurn
  - CWRA-02.RED: at C10 boundary, active session.isRunning=true and the runId is retained
  - CWRA-03.RED: post-C10/pre-C8 interval contains ONLY bookkeeping/teardown/observation
  - CWRA-04.RED: the C10->C8 tail is bounded by the host's post-executeTurn bookkeeping, not by run activity
  - CWRA-05: between C10 and C8 there is NO controllable semantic failure seam
  - CWRA-06.RED: with C8 emitted first, Elm accepts C10 (no active_run hold)
```

## Stop condition (per §20)

The discriminator has reached a single defensible verdict: **H1_ELM_TOO_STRICT**. The discriminator ACT stops here.

The successor ACT (`ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-COMMIT-WHILE-RUN-ACTIVE-REPAIR01`) will operate within the Elm kernel only and is responsible for repairing the model. Per §14 / §15 of this ACT:

- No Elm changes were made in this ACT.
- No TS changes were made in this ACT.
- All diagnostics are default-OFF and removable.
- The bridge test is registered in the dedicated bridge config (NOT the base config).

The discriminator is closed.
