# 04 — Causal discriminator

The CPA01 test file already exercises the discriminator structure from
ACT §11:

## Case A — ordinary final completion

```text
no running jobs
no unconsumed terminal observations
no outstanding work
submit_and_exit
→ BCB commits
```

Expected:

```text
task_completion_committed=1
visible completion=1
```

**CPA-02 PASSES.** 1 visible row, 1 commit. The C10 message-layer
filter does NOT suppress when there is no held work (all four
predicates evaluate false).

## Case B — held completion

```text
running job OR unconsumed terminal observation exists
submit_and_exit
→ AgentRuntime ends
→ BCB holds (ownerStillRunning OR unconsumedTerminal > 0)
```

Expected:

```text
task_completion_committed=0
visible completion=0
```

**CPA-01 FAILS (RED).** 0 commits (BCB barrier correctly holds at
SEAM B). But 1 visible completion row leaks through the message-layer
filter at SEAM A — the filter does NOT consult the same predicates
the BCB barrier holds on.

## Discrimination

```text
same submit_and_exit path
same translation pipeline (translateSessionEvent)
same BCB barrier predicate (it correctly holds)
different C10 message-layer filter outcome (it does NOT consult the
right predicates)
```

**Root cause:** the C10 message-layer filter (SEAM A) at
`sdk-session-event-coordinator.ts:1049-1124` is keyed on the wrong
predicate. It only consults:

- `hasActiveNotify(jobId)` (per-job notify markers)
- `pendingPromptAuthorityUnknown || pendingPromptsKnown > 0 || activeNotifyCount > 0` (aggregate fallback)

It does NOT consult:

- `hasRunningBackgroundJobForOwner(sessionId)` (BCB-owned last job)
- `getUnconsumedOwnedTerminalResultCount(sessionId)` (BCB-owned held observations)

The BCB barrier at SEAM B (lines 1313-1318) holds on:

```text
outstandingAutonomousWork
|| ownerStillRunningForC10
|| unconsumedOwnedTerminalResultsForC10 > 0
|| suppressOriginatingCompletion
```

The two seams must reach the same conclusion about whether the task
is currently authoritatively complete. Today they don't.

## Repair target

Reuse the SAME `hasRunningBackgroundJobForOwner` and
`getUnconsumedOwnedTerminalResultCount` option-bag methods the BCB
barrier already consults (no new wiring, no new state, no new
protocol field). Extend the C10 message-layer filter at SEAM A to
OR in those two additional predicates.

Minimal-diff repair: `sdk-session-event-coordinator.ts:1078-1086`
(both narrow and over-broad branches) → add the two predicates.

The test file already encodes the discriminator (CPA-02 = Case A,
CPA-01 = Case B). The same harness drives both cases through the
real production seam.