06 — RED Design
================

Goal: prove the production `ChatRowContent` + REAL `CommandOutputRow`
rendering currently keeps the row in `Backgrounded` + Cancel state even
when the live `CommandJobManager` has finalized the underlying job.

Real seam required (§11):

  REAL ChatRowContent (apps/vscode/webview-ui/src/components/chat/ChatRow.tsx)
    -> derives isCommandBackgrounded from message.commandExecutionDisposition
    -> passes isCommandBackgrounded to REAL CommandOutputRow
       (apps/vscode/webview-ui/src/components/chat/CommandOutputRow.tsx)
    -> CommandOutputRow shows pill "Backgrounded" + Cancel button

Test plan:

  Given:
    - ClineMessage (say:"command") with historical
      commandExecutionDisposition:"backgrounded"
      text: includes {"status":"running","jobId":"cmd_X"}
    - Live webview state projection:
      backgroundCommandJobStates: { "cmd_X": "terminal" }

  Current RED expectation:
    - ChatRow still reports isCommandBackgrounded = true (the bug)
    - CommandOutputRow still shows "Backgrounded" pill
    - CommandOutputRow still shows Cancel button

  Future GREEN expectation:
    - ChatRow consults backgroundCommandJobStates[jobId]; sees "terminal"
    - ChatRow flips isCommandBackgrounded = false (override)
    - CommandOutputRow shows "Completed" pill (terminal lifecycle)
    - CommandOutputRow hides Cancel button

Wire shape (minimum):

  ExtensionState.backgroundCommandJobStates?: Record<string, "running" | "terminal">

This is a per-job projection updated by the existing
updateBackgroundCommandState seam:

  updateBackgroundCommandState(true, jobId)    → backgroundCommandJobStates[jobId] = "running"
  updateBackgroundCommandState(false, undefined) → for every "running" entry, set to "terminal"

RED test file:

  apps/vscode/webview-ui/src/components/chat/__tests__/background-command-terminal-card-projection.bctcp01.test.tsx

  BCTCP-RED-01
    historical running + live terminal projection
    + REAL ChatRowContent + REAL CommandOutputRow
    → expect Backgrounded pill NOT present
    → expect Cancel button NOT present

  BCTCP-01 running projection (conservation)
    historical running + live running projection
    + REAL render
    → Backgrounded pill present, Cancel button present

  BCTCP-02 natural exit (conservation + new repair)
    historical running + live terminal projection
    → terminal pill present, Cancel button absent

  BCTCP-03 cancelled (conservation + new repair)
  BCTCP-04 deadline_exceeded (conservation + new repair)
  BCTCP-05 unrelated job terminates → row unaffected
  BCTCP-06 multi-job per-row projection
    { job_a: terminal, job_b: running }
    row_a → terminal, row_b → Backgrounded+CanceL
  BCTCP-07 historical tool result remains immutable
    same ClineMessage object reference, commandCompleted:false preserved
  BCTCP-08 duplicate terminal projection is idempotent
  BCTCP-09 notify=true terminal: row terminal AND (notify conservation exercised separately)
  BCTCP-10 notify=false terminal: row terminal AND no notify (out of scope for row projection)

Mock discipline (§11):
  - REAL ChatRowContent
  - REAL CommandOutputRow (no mock)
  - Mock ONLY useExtensionState to feed the live projection

Conservation support (§33):
  - Pure selector test (if extracted): deriveCommandCardLifecycle(...)
    Run as a unit on a typed input set; orthogonal to the real-seam RED.
