08 — Causal Discriminator
==========================

RED result:
  BCTCP-RED-01, 02, 03, 04, 06, 08 — FAIL
  BCTCP-01, 05, 07, 09 — PASS (conservation/control)

## Classification

The failing tests prove **CPJ1 + CPJ2** combined:

### CPJ1 — row renders solely from historical tool result

  Evidence: ChatRow.tsx:236 reads `message.commandExecutionDisposition`
  as the sole input to `isCommandBackgrounded`. The BCTCP-RED-01
  fixture sets `liveJobStates = { [jobId]: "terminal" }` and the row
  STILL shows "Backgrounded". So the historical flag is necessary
  and sufficient; live state has no effect.

### CPJ2 — live background state lacks per-job identity

  Evidence: the webview receives only a scalar `backgroundCommandRunning`
  + `backgroundCommandTaskId` (the LAST active jobId). Even if the
  row consulted this scalar, the row's `message.text` cannot be
  matched to it (no per-row ↔ per-job wiring). And BCTCP-06
  (multi-job) proves a scalar projection can never disambiguate.

## Discriminator ablation

If we make the row consult `backgroundCommandJobStates[jobId]`:
  → historical flag overridden when live says "terminal"
  → BCTCP-RED-01, 02, 03, 04, 06, 08 GREEN
  → BCTCP-01 (running projection) preserved (GREEN)
  → BCTCP-05 (absent projection → keep historical) preserved (GREEN)
  → BCTCP-07 (immutability) preserved (GREEN)
  → BCTCP-09 (cancel dispatch with jobId) preserved (GREEN)

This is the minimal bounded repair. It does NOT require:
  - changing message-translator
  - changing CommandJobManager
  - changing CommandOutputRow's signature (already has
    `isCommandBackgrounded` as a prop)
  - changing the cancellation path
  - changing historical `clineMessages`

## Affected Files (predicted)

1. `apps/vscode/src/shared/ExtensionMessage.ts`
   Add `backgroundCommandJobStates?: Record<string, "running" | "terminal">`

2. `apps/vscode/src/sdk/SdkController.ts`
   Add a `backgroundCommandJobStates: Map<string, "running" | "terminal">`
   private field.
   In `updateBackgroundCommandState(running, taskId)`:
     - (true, jobId) → `map.set(jobId, "running")`
     - (false, undefined) [>0->0 cardinal] → for every entry that
       is "running", set to "terminal"
   Expose via `getStateToPostToWebview()`.

3. `apps/vscode/src/core/controller/state/getStateToPostToWebview.ts`
   Forward `backgroundCommandJobStates` to wire.

4. `apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx`
   Add `backgroundCommandJobStates` to defaults.

5. `apps/vscode/webview-ui/src/components/chat/ChatRow.tsx`
   Read `useExtensionState().backgroundCommandJobStates`;
   extract jobId from `message.text` (same regex as CommandOutputRow);
   override `isCommandBackgrounded` when projection says "terminal".

6. Optional: extract a pure selector `deriveCommandCardLifecycle(...)`
   so terminal matrices are testable in isolation (BCTCP conservation
   support, not the load-bearing RED).

7. NO change to `CommandOutputRow.tsx` (signature stays the same;
   the bug is upstream of the row).

8. NO change to the cancel callback path; the existing
   `cancelBackgroundCommandByJobId(jobId)` is preserved exactly.

## Authority separation

  CommandJobManager   = lifecycle authority        (UNCHANGED)
  Historical message  = immutable record           (UNCHANGED)
  Per-job projection  = derived consumer (NEW)
  CommandOutputRow    = pure renderer              (UNCHANGED)
  ChatRow             = derives isCommandBackgrounded
                         from historical flag,
                         with live override        (NEW BRANCH)
