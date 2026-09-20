# 06 — RED design (the decisive test pair)

## Production seam under test

`apps/vscode/src/sdk/vscode-run-commands-tool.ts` background path
(`executionMode === "backgroundExec"`) at line 592-709, executed at
`vscode-run-commands-tool.ts:648` where `manager.start({...}, context)`
threads `context.signal` into the listener install at
`command-job-manager.ts:2010`.

## Test strategy (matches `vscode-run-commands-tool.background-state.test.ts`)

Use the REAL `createVscodeRunCommandsTool` factory with:
- `vscodeTerminalExecutionMode: "backgroundExec"`
- `commandJobManager: <real CommandJobManager instance>`
- `backgroundWaitBudgetMs: 50` (small enough that `sleep 5` returns RUNNING)
- `backgroundExecutionDeadlineMs: 30_000` (long enough not to interfere)
- `getTerminalManager: () => { throw }` (not used in backgroundExec mode)
- `onBackgroundStateChange` callback (already proven; orthogonal)
- `context.signal: <AbortController.signal>` (the load-bearing input)

Mock `@/core/storage/StateManager` (returns default shell) and
`@services/telemetry` (no-op).

## Test sequence (PWAOR-RED-01)

```ts
1. Build real manager = new CommandJobManager()
2. Build real tool = createVscodeRunCommandsTool({ backgroundExec, manager, ... })
3. Build real abortController = new AbortController()
4. Execute the tool with a long-running command (/bin/sh -c 'sleep 5'):
   const result = await executeTool(tool,
       { commands: ["/bin/sh -c 'sleep 5'"] },
       { agentId, conversationId, iteration, signal: abortController.signal })
5. Assert result.status === "running" and jobId is truthy
   → THIS IS THE HANDOFF. The job is in the active map, the listener is
     attached, and the tool function has returned RUNNING.
6. Assert the internal job record has job.abortListener set
   → pre-ablation structural proof that the listener is attached.
7. abortController.abort()              // caller aborts after handoff
8. Wait briefly (≤500 ms) for the listener to fire and finalize to settle.
9. Assert the job is no longer in the active map (active.delete happened).
10. Capture BJLA records: assert at least one
    job_cancellation_requested event with
      jobId === result.jobId
      requestOrigin === "caller_abort_signal"
      firstWriterWins === true
      currentState === "running"
```

## Expected outcome

PWAOR-RED-01 must PASS initially, proving the bounded defect on the
production seam: the detached managed CommandJob IS cancelled by the
caller's AbortSignal.

This is the RED on the REAL Proceed While Running handoff. No fake
supervisor, no manual mock of the listener, no synthetic handoff.

## What the RED proves

- The defect is real on the production seam.
- The defect originates at the listener installed in
  `command-job-manager.ts:1986-2010`.
- The LIVE causal chain is now reproducible deterministically (this
  is exactly what the predecessor ACT could not do — see its
  `16-red.txt` which observed the live RED but could not reproduce it).

## What the RED does NOT yet prove

- That REMOVING the listener retention is the **necessary** cause.
  That requires the GREEN (ablation) test below.

## Test sequence (PWAOR-GREEN-01 / ablation)

Same fixture as RED-01. After step 6 (handoff completed, listener
attached) and BEFORE step 7 (abort), call:

```ts
manager.releaseForegroundAbortOwnership(result.jobId)
```

This is the proposed minimal new method on `CommandJobManager` that
removes the caller AbortSignal listener from that job (and only that
job) without touching the deadline timer or anything else.

Then proceed with steps 7-10 as in RED-01.

## Expected outcome of PWAOR-GREEN-01

After the release, aborting the original signal must NOT cancel the
job. The job remains in the active map with `state === "running"`.

If PWAOR-GREEN-01 fails (job is still cancelled after release), the
ablation has not isolated the necessary cause — STOP and reclassify.

## Conservation controls

| ID | Sequence | Required outcome |
|----|----------|------------------|
| PWAOR-CTL-01 | start → abort BEFORE handoff (signal aborts immediately) | job cancelled, origin="caller_abort_signal" |
| PWAOR-CTL-02 | start → handoff → explicit cancelBackgroundCommand(jobId) | job cancelled, origin="background_cancel_rpc" |
| PWAOR-CTL-03 | start → handoff → manager.dispose("extension_shutdown") | job cancelled, origin="extension_shutdown" |
| PWAOR-CTL-04 | release twice (idempotent) | second release is no-op |
| PWAOR-CTL-05 | release → abort original signal | job remains running |
| PWAOR-CTL-06 | release → explicit cancelBackgroundCommand(jobId) | job cancelled, origin="background_cancel_rpc" (cancellation authority CONSERVED) |
| PWAOR-CTL-07 | release → manager.dispose("extension_shutdown") | job cancelled, origin="extension_shutdown" (lifecycle authority CONSERVED) |
| PWAOR-CTL-08 | release → natural completion | completed, active removed once, terminal cache populated once |
| PWAOR-CTL-09 | start WITHOUT context.signal → release | release is no-op |
| PWAOR-CTL-10 | start → release → timeout fires | job cancelled by deadline (timer CONSERVED) |
| PWAOR-CTL-11 | race: abort fires JUST BEFORE release | job cancelled (FIRST-WRITER-WINS intact) |

## Cross-test consistency

The single variable across RED-01 vs GREEN-01 is the `manager.releaseForegroundAbortOwnership(jobId)` call. Everything else (same manager, same tool, same supervisor, same caller signal, same handoff, same command, same shell, same wait budget) is identical.

This is the "one variable" discriminator required by ACT §16.
