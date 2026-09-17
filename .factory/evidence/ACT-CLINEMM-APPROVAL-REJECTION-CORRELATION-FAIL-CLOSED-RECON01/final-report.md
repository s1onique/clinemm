# Final Report — ACT-CLINEMM-APPROVAL-REJECTION-CORRELATION-FAIL-CLOSED-RECON01

## Outcome

```text
CLASS:        CASE_A — FAIL_CLOSED / IMMUNE (correlation layer)
VERDICT:      APPROVAL_REJECTION_CORRELATION_PROVEN
              / CORRELATION_DEFECT_NOT_REPRODUCED
UPSTREAM_10783: CORRELATION_HYPOTHESIS_ELIMINATED
              / PRODUCT-LEVEL IMMUNITY NOT YET PROVEN
STOP:         YES (at the correlation layer only)
REPAIR:       NOT NEEDED, NOT AUTHORIZED
EPIC_DELTA:   EPIC-APPROVAL-PROTECTION row 19 (editor-tool recon
              sister); no follow-up ACT required for the
              approval-correlation lane, but upstream #10783
              as a whole remains OPEN.
```

## Scope calibration (causal-reviewer P1)

The committed discriminator at
`apps/vscode/src/sdk/__tests__/approval-rejection-correlation-fail-closed-recon01.test.ts`
forces every retry into the interactive correlation seam via:

```ts
const ALWAYS_ASK = vi.fn().mockReturnValue(false)
...
shouldAutoApproveTool: ALWAYS_ASK
```

That deliberately excludes the policy/auto-approve path BEFORE
the coordinator. Combined with synthetic request identities
(`tc-A` / `tc-B`) and synthetic UI responses
(`resolvePendingToolApproval` called directly), the evidence is
more precisely **SYNTHETIC_REAL through REAL_PRODUCTION_SEAM**
than bare `REAL_PRODUCTION_SEAM`.

What this proves:

```text
APPROVAL_REJECTION_CORRELATION = PROVEN_FAIL_CLOSED
  reject A → new request B → if B requires approval
  → B receives a fresh approval prompt
NO_APPROVAL_CACHE_BY_PAYLOAD = PROVEN
STALE_RESPONSE_REPLAY       = PROVEN_BLOCKED
```

What this does NOT prove:

```text
UPSTREAM_10783_PRODUCT_LEVEL_REPRODUCTION:
  reject A → real retry path → real auto-approval/policy
  decision → real interaction coordinator → must prompt again.
  A retry could bypass the coordinator entirely if
  shouldAutoApproveTool(B) returns true, which this test
  deliberately excludes.
```

**Do not count #10783 as fully neutralized.** The correlation
hypothesis is convincingly eliminated (one plausible root-cause
class down); product-level immunity remains unproven and would
require a separate end-to-end reproduction test that drives a
real policy/auto-approve decision on the retry.

## One-line answer (scope-calibrated)

> Can approval/rejection state from request X incorrectly
> authorize or suppress approval for request Y, **once a request
> enters the manual approval seam**, in ClineMM's VSCode host
> adapter?
> **NO** (proven at the correlation layer; the policy/auto-approve
> path BEFORE the coordinator is out of scope for this ACT).

## Evidence summary

| Artifact | Location |
|----------|----------|
| ACT body | `.factory/acts/ACT-CLINEMM-APPROVAL-REJECTION-CORRELATION-FAIL-CLOSED-RECON01.md` |
| Entry freeze | `.factory/evidence/.../entry-freeze.txt` |
| Approval seam map | `.factory/evidence/.../approval-seam-map.md` |
| Trust model | `.factory/evidence/.../trust-model.md` |
| Discriminator | `.factory/evidence/.../discriminator.md` |
| Discriminator test | `apps/vscode/src/sdk/__tests__/approval-rejection-correlation-fail-closed-recon01.test.ts` |
| Test output | `bunx vitest run`: 6 passed / 0 failed in 587ms (single-file) |

## Key findings

1. **Single-slot is the correlation mechanism.** The
   `SdkInteractionCoordinator` maintains exactly one
   in-flight approval at a time via the
   `pendingToolApprovalResolve` property (lines 674-683).
   This is a stronger invariant than the typical
   "Map<id, pending>" design — it guarantees that rejection
   on A cannot be confused with authorization of B, because by
   the time B's `handleRequestToolApproval` runs, A's slot has
   been atomically destroyed (lines 735-736 execute together).

2. **Atomic slot destruction** ensures reject on A genuinely
   resets state for B. `pendingToolApprovalResolve` and
   `pendingToolApprovalMessage` are cleared as a single
   statement pair, BEFORE the resolver is invoked (the
   in-flight Promise is captured in a local `resolve`
   variable at line 721 first).

5. **`recordApprovedToolMessage` is UI-only.** It updates
   `messageTranslatorState` for render bookkeeping, NOT a
   hidden approval cache. Future gates cannot be bypassed by
   an earlier approve.

6. **Stale-response handling is fail-closed.** When a
   response arrives at a cleared coordinator (R6
   discriminator), `resolvePendingToolApproval` returns
   false. There is no queue, no replay, no deferred delivery.
   The stale response is silently dropped.

7. **Lifecycle cancellation is fail-closed.** `clearPending`
   (R5 discriminator) destroys the slot AND calls
   `recordDeniedToolApproval` (line 898) so the UI gets the
   diff-preview close signal AND the in-flight request
   receives `{ approved: false, reason }`.

## Causal distinction from ACT-CLINEMM-COMMAND-APPROVAL-AUTHORITY-FAIL-CLOSED-RECON01 (507fdd890)

| | Closed ACT (507fdd890) | This ACT |
|---|---|---|
| Question | Can model-supplied `requires_approval=false` lower the lattice? | Can approval/rejection state from request X authorize/suppress Y? |
| Threat model | Model fakes a "no approval needed" hint | Model retries the same command after user rejected |
| Layer tested | Command-policy lattice (evaluateCommandPolicy + R5 floor) | Approval correlation seam (pendingToolApprovalResolve slot) |
| Files added | `sdk/packages/core/src/runtime/command-policy/command-policy-authority-fail-closed-recon01.test.ts` | `apps/vscode/src/sdk/__tests__/approval-rejection-correlation-fail-closed-recon01.test.ts` |
| Evidence class | STRUCTURAL + SYNTHETIC_REAL | SYNTHETIC_REAL through REAL_PRODUCTION_SEAM |
| Verdict | APPROVAL_AUTHORITY_FAIL_CLOSED_PROVEN | APPROVAL_REJECTION_CORRELATION_PROVEN |

## Causal distinction from ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01 (row 19)

| | Editor-tool ACT (row 19) | This ACT |
|---|---|---|
| Question | Does the UI re-prompt after override lifting? | Does rejection of command X leak into command Y? |
| Lane | UI friction (does the card get re-shown?) | Authority (does rejection state corrupt the gate?) |
| Status | OPEN — CASE_A only (structural) | CLOSED GREEN — R1+R2+R3+R4+R5+R6 |

## Production callers verified

  - apps/vscode/src/sdk/SdkController.ts:1084-1085 — wires
    `interactions.handleRequestToolApproval` into the
    `agentRuntimeOptions.requestToolApproval` seam.
  - apps/vscode/src/sdk/SdkController.ts:947-948 — wires
    `recordApprovedToolMessage` /
    `recordDeniedToolApproval` into the coordinator's
## Stop

Per ACT §12 stop rule (scope-calibrated): R1 GREEN at the
correlation layer (force-routed via ALWAYS_ASK) →
`CORRELATION_HYPOTHESIS_ELIMINATED`, STOP at this layer.

Per ACT §7 CASE_A: FAIL_CLOSED / IMMUNE within the correlation
layer only.

**NOT proven**:
- full product-level immunity to upstream #10783 (the
  policy/auto-approve path BEFORE the coordinator is excluded
  by `shouldAutoApproveTool: ALWAYS_ASK`);
- the existence of any other root-cause class for the upstream
  symptom.

No production repair authorized at this layer; no new test
authorized at this layer (correlation defect class convincingly
eliminated).

## Recommended backlog sequence (per upstream prioritization, this ACT does NOT queue follow-ups)

The user-provided sequence remains authoritative:

  NOW: #10783 (this ACT — CLOSED GREEN)
  NEXT: #10499 MCP Auto-approve OFF authority bypass
  THEN: #12939 replace_in_file synchronous CPU blow-up
  PARALLEL / WAITING FOR LIVE: long-session UI unresponsiveness,
    post-repair Idle dogfood qualification.

This ACT does NOT introduce a new follow-up ACT for the
approval-correlation lane; the case is closed by the
structural design (single-slot + atomic-clear). If upstream
later reports a specific failure mode in this lane, the
discriminator at
`apps/vscode/src/sdk/__tests__/approval-rejection-correlation-fail-closed-recon01.test.ts`
is the regression target.

## Verification snapshot

  - Date: 2026-09-01
  - REPO_HEAD: 507fdd890 (entry-freeze)
  - Test command:
    `bunx vitest run apps/vscode/src/sdk/__tests__/approval-rejection-correlation-fail-closed-recon01.test.ts`
  - Test result: 6 passed, 0 failed, 587ms
  - Pre-existing test sanity:
    `sdk-interaction-coordinator.test.ts` +
    `sdk-interaction-coordinator.session-autonomy.test.ts` +
    `sdk-task-control-coordinator.test.ts` →
    90/92 passed (2 pre-existing failures unrelated to this
    ACT; verified by stashing the new test file and re-running
    the same set — same 2 failures).
    options.
  - apps/vscode/src/sdk/sdk-task-control-coordinator.ts —
    calls `interactions.clearPending(...)` at session
    teardown choke-points.

## Production seam map (one-liner)

```
model emits tool_use
   ↓
sdkHost.requestToolApproval(request)
   ↓
SdkController → SdkInteractionCoordinator.handleRequestToolApproval
   ↓
   evaluateCommandToolApproval(...)  [atomic, per-call, line 633 of sdk-tool-policies.ts]
   ↓
   runRequestToolApproval  [lines 375-684]
   ↓
   pendingToolApprovalResolve = resolve  ← single slot
   pendingToolApprovalMessage = {...}    ← single slot
   ↓
user clicks → askResponse
   ↓
SdkController.askResponse → resolvePendingToolApproval(...)
   ↓
   if no slot → return false (R6 stale)
   if "messageResponse" → return false (R4 feedback)
   else:
     approved = (responseType === "yesButtonClicked")
     atomic slot destruction (R1, R2, R3, R4)
     recordApprovedToolMessage on yes
     recordDeniedToolApproval on no (line 766)
     resolver called with { approved, reason, executionPlan }
```
3. **No global approval cache exists.** Verified by
   exhaustive search: no `autoApproveCache`, no
   `approvedCommandsSet`, no `deniedToolCallIds` skip-list,
   no `approvedToolsMap`. The single mutable state plane is
   the single-slot.

4. **`isToolAutoApproved` is stateless per-call.** It reads
   `autoApprovalSettings` + the current `request.toolName`
   and returns a boolean. It does NOT memoize by command
   text or tool name. Every call is fresh.
