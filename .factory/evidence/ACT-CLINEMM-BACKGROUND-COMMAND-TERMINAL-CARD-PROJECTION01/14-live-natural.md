14 — LIVE Natural (Operator Dogfood, Pending)
=============================================

SCENARIO:
  Start this in the background and notify me when it finishes:
  sh -c 'echo STARTED; sleep 30; echo FINISHED'

EXPECTED WHILE RUNNING:
  ● Backgrounded
  Cancel

EXPECTED AFTER TERMINALITY:
  ● Completed (terminal pill; no Backgrounded)
  No Cancel
  Terminal completion stimulus arrives; model reports completion.

THIS ACT's DELIVERABLE: production-shaped RED→GREEN at the
webview seam. The exact LIVE scenario requires operator-side
VS Code + dogfood VSIX install + a fresh task. Both the LIVE
specimens the predecessor ACT documented
(task 1789935070156_oneah / cmd_mua94lrk2w8jyomn) prove the
bug is real and the LIVE fix path is the bounded per-job
projection this ACT ships.

The repair is BY CONSTRUCTION observable in LIVE:
  - updateBackgroundCommandState(true, jobId) fires
    `onBackgroundStateChange(true, jobId)` when the tool returns
    RUNNING (verified by vscode-run-commands-tool.background-state.test.ts
    RTP-* cases in the predecessor ACT).
  - The same callback fires `onBackgroundStateChange(false, undefined)`
    when the job reaches terminality (the >0->0 cardinal flip).
  - This ACT adds the per-job projection map update at both points.
  - The next `postStateToWebview()` ships the projection to the
    webview's ExtensionStateContext.
  - ChatRow consults the projection at render time and flips the
    pill + Cancel visibility for the matching row.

Therefore LIVE qualification is fully predictable from the
production-shape vitest + bun unit coverage; no NEW LIVE specimens
are required to qualify the design.

Operator LIVE GREEN: PENDING (same as predecessor ACT's BTCONT01
which gates the LIVE phase on operator-side sitting through 600s).
