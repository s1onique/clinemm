# 21 — Live qualification

## Status: PENDING LIVE CAPTURE

The instrumentation is qualified. The LIVE specimen capture has not
yet been executed in this ACT (per the STOP-rule, this ACT is bounded
to instrumentation qualification, not LIVE run + classification).

## What this ACT delivered

1. The single new BJLA event `job_cancellation_requested` is added to
   the union and the bounded ring.
2. Every production caller of `manager.terminate(reason="cancel")`
   threads an explicit caller-identity label:
   - `VscodeSessionHost.cancelBackgroundCommand` → `"background_cancel_rpc"`
   - `VscodeSessionHost.dispose` → `"extension_shutdown"`
   - `CommandJobManager.start` deadline watchdog → `"command_deadline"`
   - `CommandJobManager.start` AbortSignal listener → `"caller_abort_signal"`
   - `CommandJobManager.cancel` (default) → `"other:unspecified"`
3. The capture is a no-op when captureEnabled=false (BCP-04).
4. The cardinality invariant is enforced (BCP-05): exactly ONE primary
   `firstWriterWins=true` record per LIVE cycle.

## Next LIVE procedure

1. Build dogfood VSIX from committed exact source:
   ```bash
   cd apps/vscode
   bun run package    # or the equivalent dogfood build
   ```

2. Install in VS Code via the `claude-dev` dogfood channel.

3. Start a fresh task:
   ```
   Run this command and wait until it finishes:
   sh -c 'echo STARTED; sleep 600; echo FINISHED'
   ```
   DO NOT click Cancel. DO NOT send another message. DO NOT switch
   modes. DO NOT restart/reload VS Code.

4. Wait until "Working → Your turn" or cancellation occurs.

5. Run these dump commands (in order):
   - `Cline Debug: Dump Background Job Liveness Authority`
   - `Cline Debug: Dump Background Owner Correlation`
   - `Cline: Dump Turn State Writer Provenance Diagnostic`

6. Inspect the BJLA dump for `job_cancellation_requested` records.
   The `requestOrigin` field will mechanically classify the requester
   into CP1 (background_cancel_rpc), CP2/CP6 (extension_shutdown),
   CP3 (caller_abort_signal), CP4 (command_deadline), or CP7.

## Stop rule

Per ACT §34: STOP after (a) the cancellation requester is proven and
(b) the bounded repair is qualified. Do NOT change Q5, TaskHeader,
CommandJobManager architecture, owner/session identity, status
authority, PGID helper semantics, `submit_and_exit`, or terminal row
mutation. One cancellation request. One caller. One repair.
