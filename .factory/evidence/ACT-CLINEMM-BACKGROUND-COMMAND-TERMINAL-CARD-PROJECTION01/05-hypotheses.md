05 — Hypotheses
===============

Given the recon (§04), the candidates narrow to:

CPJ1 — row renders solely from historical tool result
  Evidence: ChatRow.tsx:236 reads `message.commandExecutionDisposition`
  Verdict: STRUCTURAL. The row CANNOT observe liveness beyond its
           own clineMessages entry.
  Required: route the live CommandJobState to the row.

CPJ2 — live background state lacks per-job identity
  Evidence: getStateToPostToWebview only carries the LAST
           backgroundCommandTaskId (scalar). Multi-job impossible.
  Verdict: STRUCTURAL. current wire has no per-job projection.

CPJ3 — terminal state is published but not consumed by row
  Evidence: scalar backgroundCommandRunning IS published; the
           CommandOutputRow does NOT consult it.
  Verdict: STRUCTURAL. Even the scalar cannot disambiguate multi-job.

Combined classification
----------------------
**CPJ1 + CPJ2**: the row's liveness flag is purely historical
  (CPJ1), AND the live webview projection has no per-job keying
  (CPJ2). To unblock both, introduce a per-job projection
  `Map<jobId, CurrentJobProjection>` on the webview state, updated
  by the same onBackgroundStateChange seam that flips the scalar
  ⎇ gauge. The chat row consults this map keyed by the jobId it
  extracted from its own historical text envelope.

CPJ5 — cancellation eligibility inferred from job existence
  Evidence: extractJobIdFromOutput succeeds (jobId exists in
           the historical text), so onCancelCommand(jobId) is
           always wired. The Dispatcher path is unchanged.
  Verdict: NOT THE BUG. The Cancel button is "wired correctly"
           (calls backend with jobId). The BUG is that the Cancel
           button is SHOWN even though the job is terminal.
           Repair: hide the button when the per-job projection
           says terminal.

CPJ4 / CPJ6 — not applicable.

## Authority rule

- CommandJobManager = lifecycle authority (UNCHANGED)
- historical tool result = immutable (UNCHANGED)
- webview current-job projection = derived consumer (NEW bounded
  per-job projection keyed by jobId)
- command row = projection only (renamed semantics: it consults
  the per-job projection; historical stamp is the default when
  the projection is absent — e.g. across task-switch reload)
