# 21 — Live qualification

## Status: LIVE_BOUND (closed)

The dogfood VSIX was installed and a fresh `sleep 600` task was
executed per the procedure below. The LIVE specimen was captured
and the cancellation requester is now mechanically classified.

The full LIVE specimen, the exact event sequence, the correlation
between REQUEST chain and MUTATION chain, and the exoneration matrix
are recorded in `25-live-result.md`. The resolved classification is
in `15-causal-classification.txt` and the gate evidence is in
`23-gates.txt`.

## LIVE RESULT

```text
jobId                  = cmd_mu9wmnyuhvgva8cn
managerInstance        = M2
sessionId              = 1789914077854_aq4sy
cancellationLatency    = ~147.3 s after job insert
requestOrigin          = caller_abort_signal
firstWriterWins        = true
currentState           = running (verified at the request boundary)
terminalState          = cancelled
activeRemoveReason     = cancel
cleanupPostcondition   = gone
BOCOR guard            = false
TSWPD transition       = streaming → awaiting_followup
TSWPD writerId         = session-event-turn-complete-resumable-straggler-preserve
CLASSIFICATION         = CASE_CP3_CALLER_ABORT_SIGNAL
LIVE_CAUSALITY         = ESTABLISHED
```

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

## LIVE procedure executed

1. Built dogfood VSIX from committed exact source:
   ```bash
   cd apps/vscode
   bun run vscode:prepublish         # exit 0
   bunx @vscode/vsce package --no-dependencies --no-git-tag-version \
       --out $ROOT/dist/clinemm-4.1.16-bjla-cancellation-provenance01.vsix
   ```
   Result: 51 files, 13.94 MB,
   SHA-256 5195db3af3e3f09e95ec2dcfacfafe45694e13244d5a8957276366ce937c71e5,
   built from HEAD 640cc388131ad8071e7a2feccb456c580d1d09a5.

2. Installed in VS Code via the `claude-dev` dogfood channel.

3. Started a fresh task:
   ```
   Run this command and wait until it finishes:
   sh -c 'echo STARTED; sleep 600; echo FINISHED'
   ```
   The operator did NOT click Cancel. The operator did NOT send
   another message. The operator did NOT switch modes. The operator
   did NOT restart/reload VS Code.

4. Waited until "Working → Your turn" occurred (~147.3 s after
   insertion).

5. Ran these dump commands (in order):
   - `Cline Debug: Dump Background Job Liveness Authority`
   - `Cline Debug: Dump Background Owner Correlation`
   - `Cline: Dump Turn State Writer Provenance Diagnostic`

6. Inspected the BJLA dump for `job_cancellation_requested` records.
   The `requestOrigin` field mechanically resolved the requester to
   `caller_abort_signal`, which is CP3 (caller AbortSignal
   propagation). The full correlation is recorded in
   `25-live-result.md`.

## Stop rule

Per ACT §34: STOP after (a) the cancellation requester is proven and
(b) the bounded repair is qualified. Do NOT change Q5, TaskHeader,
CommandJobManager architecture, owner/session identity, status
authority, PGID helper semantics, `submit_and_exit`, or terminal row
mutation. One cancellation request. One caller. One repair.

The cancellation requester is proven (`caller_abort_signal`). The
bounded repair is the next ACT's responsibility.
