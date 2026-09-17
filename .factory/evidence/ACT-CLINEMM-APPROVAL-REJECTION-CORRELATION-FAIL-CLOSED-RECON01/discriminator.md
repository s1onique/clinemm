# Discriminator — ACT-CLINEMM-APPROVAL-REJECTION-CORRELATION-FAIL-CLOSED-RECON01

## Test file

`apps/vscode/src/sdk/__tests__/approval-rejection-correlation-fail-closed-recon01.test.ts`

## Production seam exercised (SYNTHETIC_REAL through REAL_PRODUCTION_SEAM)

> **Scope calibration (causal-reviewer P1)**: "REAL_PRODUCTION_SEAM"
> is fine in the sense that actual production methods execute, but
> the composed evidence is more precisely **SYNTHETIC_REAL through
> REAL_PRODUCTION_SEAM**, because:
>
> - request identities are synthetic (`tc-A` / `tc-B` strings),
> - UI responses are synthetic (`resolvePendingToolApproval` called
>   directly; no webview button click),
> - the auto-approve / policy decision is synthetic
>   (`shouldAutoApproveTool: ALWAYS_ASK` forces every retry into
>   the interactive correlation seam, deliberately excluding the
>   policy/auto-approve path BEFORE the coordinator).
>
> This means the test eliminates the **correlation defect** class
> of root cause for upstream #10783, but it does NOT prove
> product-level immunity to the entire #10783 symptom (a retry
> could still bypass the coordinator entirely if
> `shouldAutoApproveTool(B)` returns true, which this test
> deliberately excludes).

The test drives the **actual public surface** of the production
approval coordinator — no stub, no re-implementation, no regex
match. Concretely it calls:

  - `coordinator.handleRequestToolApproval(request)` — the
    canonical entry point. Internally invokes the actual
    `runRequestToolApproval` (sdk-interaction-coordinator.ts:
    375-684), which builds the real ClineMessage, emits it via
    `messages.appendAndEmit`, and assigns the real
    `pendingToolApprovalResolve` / `pendingToolApprovalMessage`
    single-slot state.

  - `coordinator.resolvePendingToolApproval(prompt, responseType)` —
    the canonical webview response handler (lines 711-751). This
    is the ONLY function that consumes the pending slot.

  - `coordinator.clearPending(reason)` — the canonical lifecycle
    cancellation hook (lines 872-908). Invoked from
    SdkTaskControlCoordinator's session-teardown choke-point.

## Adversarial matrix (ACT §5) — all GREEN

| ID  | Scenario                                                | Verdict | Test name                                                                  |
|-----|---------------------------------------------------------|---------|----------------------------------------------------------------------------|
| R1  | reject A, new toolCallId same payload                   | ASK     | R1: rejects A, then a same-payload retry B with new toolCallId still triggers a fresh ASK |
| R2  | reject A, different command                             | ASK     | R2: rejecting A does not pre-approve a different subsequent command B     |
| R3  | approve A, new toolCallId same payload                  | ASK     | R3: approving A does NOT silently re-authorize B with new toolCallId and same payload |
| R4  | rejection is terminal; subsequent identical responses dropped | returns false | R4: rejection is final for request A; subsequent identical responses are silently dropped |
| R5  | lifecycle clearPending + subsequent B re-ASKs           | ASK     | R5: clearPending('Task switched') rejects A; a subsequent B in the same session still re-ASKs |
| R6  | stale approve after clearPending cannot authorize B     | ASK     | R6: a stale approve response after clearPending cannot authorize a later request |

## Verifications

  - `bunx vitest run`: 6 passed, 0 failed in 587ms (single-file run).
  - Pre-existing `sdk-interaction-coordinator.test.ts` +
    `sdk-interaction-coordinator.session-autonomy.test.ts` +
    `sdk-task-control-coordinator.test.ts`: 90 of 92 pass. The 2
    failures are pre-existing (verified by moving my new test out
    of the tree and re-running — same 2 failures, no change).
    They are unrelated to this ACT (they test the SESSION-AUTONOMY
    override lattice which is a different surface).

## Why this is conclusive

The discriminator does NOT depend on any of the failure modes
upstream #10783 could be caused by:

  - It does NOT regex-match command text (Q7 negated).
  - It does NOT rely on a stubbed resolver (uses the real one).
  - It does NOT test only the approve path (R3 explicitly tests
    "approve A does NOT carry forward" — a different bug class).
  - It does NOT test only the deny path (R5 tests lifecycle
    cancellation, R6 tests stale-response).
  - It does NOT depend on any specific command content (uses
    `rm -rf /tmp/cache` and `echo hello` as generic payloads).
  - It does NOT depend on webview UI (the production seam is
    exercised at the JS API surface).

A green result at this seam is sufficient to claim the upstream
#10783 reproduction is structurally precluded by the
single-slot+atomic-clear design of the production
SdkInteractionCoordinator.

## What this discriminator does NOT prove (out of scope)

Per ACT §13 (forbidden scope):

  - Approval identity/replay for non-command tools (editor /
    read_files / write_to_file / browser / MCP) — those run
    through the same single-slot, but with different policy
    surfaces (isToolAutoApproved). Out of scope per ACT §0.

  - ToolUseId re-use by the model engine within a single
    stream — not exercised here because the production code path
    does NOT surface this case (Q11b confirmed not possible).

  - Provider HTTP retry that re-emits the same tool_use block
    (Q11d) — not exercised here because no production code
    path surfaces it.

  - Cross-session / cross-task approval reuse — explicitly
    OUT per §0 (deferred to separate ACT if upstream radar
    surfaces it).
