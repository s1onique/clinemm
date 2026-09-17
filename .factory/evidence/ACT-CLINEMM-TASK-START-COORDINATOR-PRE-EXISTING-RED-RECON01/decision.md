# Decision: PASS_TASK_START_COORDINATOR_STALE_TEST_REPAIR_V1

## Summary
The 11 `sdk-task-start-coordinator.test.ts` REDs split into two classes:
- 10/11: TEST_FIXTURE_DEFECT (missing `resolveSessionAutoApprovalOverride`
  added by CAI-01B).
- 1/11: STALE_TEST_EXPECTATION (test 1 used strict `toHaveBeenCalledWith`
  shape matching; production now adds `sessionAutoApprovalOverride` to
  the build args; the test must use `expect.objectContaining`).

No production defect. No race. No ablation needed.

## Discriminator
Standalone path-trace proved:
- WITHOUT resolver: P1 → P2 → P3 → TypeError → captureProviderApiError →
  appendAndEmit(error) → P13(undefined). initTask never reaches
  createAndSetTask.
- WITH resolver: P1 → P2 → P3 → P4 → P6 → P7 → P10 → PHASE streaming →
  P13(sessionId). Production path works exactly as documented.

## Test integrity
After the test-only repair, all 21 tests in the file are GREEN.
The tests still discriminate their intended mechanisms:
- CORRECTION01-1/02-1/02-2/03-1: prove `setTurnPhase("streaming")` is
  asserted only after `startNewSession` resolves. With the resolver
  wired, these tests observe the actual streaming transition. Without
  the resolver, they would observe `calls=0` (wrong reason).
- `emits a Cline auth error` tests: prove the auth-preflight short-circuits
  before `startNewSession`. The original test fixture set providerId="cline"
  with empty apiKey; the test asserts `emitClineAuthError` is called.
  Now that the resolver is wired, this preflight runs correctly and the
  assertions hold.

A separate negative-control ablation (remove the resolver) shows the
tests fail as expected — the tests still discriminate their intended
mechanisms, they were merely gated behind a missing dependency.

## Conservation

| Invariant | Status |
|---|---|
| S1 (operation authority captured before async work) | CONSERVED (no source change) |
| S2 (clear precedes new task installation) | CONSERVED |
| S3 (stale operation cannot install task) | CONSERVED |
| S4 (stale operation cannot survive host start) | CONSERVED |
| S5 (initial message belongs only to current task) | CONSERVED |
| S6 (auto-approval intent obeys peek/consume) | CONSERVED (resolver is `vi.fn()` returning `{kind:"none"}` which is the neutral default) |
| S7 (task start is not completion) | CONSERVED |
| S8 (task start is not cancellation) | CONSERVED |
| TaskOperationFence authority | CONSERVED (no source change) |
| Cancel fence precedes abort | CONSERVED (no source change) |
| Completion authority | CONSERVED (no source change) |

## Final verdict
PASS_TASK_START_COORDINATOR_STALE_TEST_REPAIR_V1
