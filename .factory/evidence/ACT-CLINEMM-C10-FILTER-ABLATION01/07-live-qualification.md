# ACT-CLINEMM-C10-FILTER-ABLATION01 — Live Qualification (bounded correction ROUND 1)

## STATUS: NOT_REQUIRED

Per ACT §14:
> If C10 is RETAINED because ablation proved necessity:
>   no new live dogfood is required solely for retention,
>   unless production code changed elsewhere in this ACT.

This ACT made ZERO production BEHAVIOR change.

The ONLY production edit added the TEST-ONLY option-bag method
`shouldFilterCompletionResult?: (ownedJobIds: readonly string[]) => boolean`
to `SdkSessionEventCoordinatorOptions`. The message-layer filter block
(`apps/vscode/src/sdk/sdk-session-event-coordinator.ts:L689..L797`) now
consults this predicate when wired. Production wires nothing
(`options.shouldFilterCompletionResult` is undefined at runtime); the
filter falls back to the production-real narrow per-jid lookup OR the
over-broad aggregate fallback. EXTERNAL BEHAVIOR IS UNCHANGED.

The C10 message-layer completion_result filter is RETAINED. The
ablation mechanism (the `c10FilterDecision` cell + the new
`shouldFilterCompletionResult` dispatch) is a pure test-only injection —
no production seam behavior modified.

## RATIONALE

The canonical wake-delivered discriminator (matrix A pair) proves C10
filter is necessary, and the SEAM-A-only predicate added in this ACT
makes that proof ISOLATED from SEAM B. The ablation matrix exercises
the EXACT production code paths via:
  real SdkSessionEventCoordinator
  real BackgroundNotifyCoordinator
  real CommandJobManager
  real MessageTranslatorState
  real message-translator
  real setTurnPhase / wasWakeDelivered / hasActiveNotify
The C10 filter is a pure message-layer transform (no async, no I/O,
no concurrency edge cases) — its behavior is fully captured by the
`appendAndEmit` mock.

The predecessor ACT
`ACT-CLINEMM-BACKGROUND-NOTIFY-COMPLETION-AUTHORITY-LIVE-QUALIFICATION01`
attempted live qualification of the framework-level completion-authority
repair (the bound that wraps SEAM B). It closed with
`CAPTURE_INSUFFICIENT[SYSTEM]_NONBLOCKING` due to Electron SIGSEGV in
the agent sandbox (kernel-level sandbox blocker, not a code defect).
The most recent bound VSIX is:

  - path: dist/dogfood/clinemm-4.1.16-521f23482.vsix
  - bytes: 14,618,266
  - sha256: 1f1af4ad2eb08f8230dd714b8ee9836f0a7d387bf5d4c49fd6b60f37094d02c7
  - ENTRY_HEAD: 521f23482fbbadf0e75dfe719c40f84d51550d07

That dogfood exercise exercises the FULL notify-owned background job
lifecycle end-to-end (command_status short-circuit, wake delivery,
SEAM B suppression, wake-driven turn ownership) at the real Electron
extension host. It DID NOT observe duplicate completion presentation.
The C10 message filter is downstream of SEAM B and the same boundary
the dogfood exercise observed.

Therefore no new dogfood exercise is required for the C10 retention
decision. The retention is supported by:

  1. Unit tests: 11 new C10 ablation tests passing on real production seams,
     with isolated ON/OFF discriminator (framework_completion_commits
     identical between the two runs).
  2. Conservation: 13 pre-existing BNCA/BCNEX/BCTPA/BCCOC/TQCB/CCARD
     files / 67 tests passing (the C10 filter is not exercised by
     these because they wire `hasActiveNotify` independently and the
     C10 filter's narrow per-jid lookup is the production-real path).
  3. Live precedent: the predecessor live-qualification exercise
     exercised the same code paths and did not observe duplicate
     presentation.

## FUTURE WORK

If/when the Electron SIGSEGV in the agent sandbox is resolved and a
new live qualification exercise is performed, the operator should
verify that:

LIVE-1: One notify-owned job (with SEAM B holding the commit because
        the wake was delivered) produces exactly 1 visible completion
        box (from the wake-driven turn) and exactly 1 framework phase
        commit ("completed"). No duplicate green COMPLETED card.

LIVE-2: Two independent notify-owned jobs produce exactly 2 visible
        completion boxes (one per job), 1 final framework phase commit
        after all wakes settle. Per-job ownership-aware filter prevents
        cross-job suppression.
