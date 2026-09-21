ACT-CLINEMM-BACKGROUND-COMMAND-NOTIFY-ON-TERMINAL01 — LIVE POSITIVE
===================================================================

LIVE QUALIFICATION: DEFERRED to the operator / dogfood VSIX cycle.

Reason: the host machine running this ACT does not have the
dogfood VSIX build infrastructure (`vscode:prepublish` + sign
+ sideload) wired for unattended execution in the cloud agent
context. The ACT explicitly allows LIVE to be qualified by
production-shaped executable coverage (per §46 + §47) when
the manual dogfood cycle is impractical.

Executable coverage that qualifies this in lieu of LIVE:
  - BCNT-01 (notify=true natural terminal -> one queued wake):
    drives the REAL createVscodeRunCommandsTool + REAL
    CommandJobManager + REAL BackgroundNotifyCoordinator end
    to end through the production coordinator -> sink path.
    The TestPendingPromptsSink stands in for the
    PendingPromptsController (the canonical wake target);
    the coordinator's enqueueTerminalWake callback is the
    same signature shape the production
    `activeSession.sdkHost.send({ ..., delivery: "queue" })`
    call uses.

Operator dogfood cycle (next ACT):
  1. Build dogfood VSIX from the post-ACT HEAD.
  2. Install the VSIX.
  3. Open a Cline session and prompt the model with an
     explicit notification-capable request:
       "Start this in the background and notify me when it
        finishes: sh -c 'echo STARTED; sleep 60; echo FINISHED'"
  4. Confirm:
       - tool input contains notifyOnCompletion: true
       - the tool returns RUNNING + jobId
       - the current turn ends
       - the job completes naturally (echo FINISHED)
       - the agent receives the bounded continuation prompt
       - the agent tells the user the job finished
