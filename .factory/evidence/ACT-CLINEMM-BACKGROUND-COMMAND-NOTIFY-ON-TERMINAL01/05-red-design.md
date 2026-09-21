ACT-CLINEMM-BACKGROUND-COMMAND-NOTIFY-ON-TERMINAL01 — RED DESIGN
================================================================

## Real seams

RED test must drive:
  - real createVscodeRunCommandsTool factory
  - real createVscodeShellExecutor -> manager.start (real
    CommandJobManager)
  - real start.terminalPromise + status({jobId,waitMs:0})
  - real (or test-shaped) pendingPrompts queue seam

For RED we use a TestPendingPromptsSink that captures what the
wake consumer would enqueue. The sink is the assertion target;
it does NOT replace any production code. It is wired in by the
tool factory options (pendingPromptsSink), mirroring the
production wake transport.

Production code does NOT call the sink directly — it goes
through activeSession.sdkHost.send({delivery:"queue"}). In the
test harness we thread the sink via the same options seam.

## RED scenario

  BCNT-RED-01: before any wake consumer is wired,
    notifyOnCompletion:true + background command reaching
    terminal state produces ZERO queued wakes.

  Steps:
    1. Construct CommandJobManager + vscodeRunCommandsTool
       with TestPendingPromptsSink.
    2. Start a real background command with
       notifyOnCompletion:true (the field is accepted by the
       schema but the wake path does not exist).
    3. Await start.terminalPromise + status() classification.
    4. Assert sink.queuedPrompts.length === 0.
    5. Assert NO marker was registered.

  RED_REPRODUCED = true.
