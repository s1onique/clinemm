# ACT-CLINEMM-CONTINUATION-CARDINALITY-CORRELATION-LOSS01

PRIMARY PURPOSE: reproduction / causal evidence acquisition

## Status

**PASS_CONTINUATION_CORRELATION_RESTORED.**

This ACT recovers trustworthy C4→C8 correlation evidence after the
bounded OOM repair (`ACT-CLINEMM-EXTENSION-HOST-OOM-DELIVERY-SEMANTICS-REPAIR01
/ CORRECTION01`) failed live qualification P4.

The ACT was re-reviewed on 2026-09-25 against the FACTORY
`HALT_CORRELATION_END_TO_END_NOT_PROVEN` verdict. The reviewer
correctly noted the original CCCL01 RED terminated at the
`sdkHost.send` mock and did not exercise the downstream
`PendingPromptsController.enqueue` -> `drain` -> second `runTurn` ->
`executeTurn` -> `agent_turn_done` path. The ACT now closes that gap
with a new bounded real-host sentinel witness (see
`apps/vscode/src/sdk/__tests__/continuation-cardinality-correlation-loss01.cccl01-e2e-real-host.c24-c-bridge.test.ts`).

Do NOT reopen the OOM repair. The OOM repair's executable code-level
evidence is preserved (see `apps/vscode/src/sdk/vscode-session-host.ts:422-509`
and `sdk/packages/core/src/runtime/turn-queue/pending-prompt-service.ts:475-504`).

## Inheritance

PRE-EXISTING CCARD MODULES (FROZEN — do not modify):

- `apps/vscode/src/sdk/continuation-cardinality-authority.ts` (CCARD capture
  ring + stage enum + `jobId?` field on every record)
- `apps/vscode/src/sdk/continuation-cardinality-authority-runtime.ts` (host
  wiring of the capture seam; dogfood-only)

PRE-EXISTING DERIVEORIGIN CONTRACT (FROZEN — do not modify except as
required by §5-§7 evidence):

- `apps/vscode/src/sdk/vscode-session-host.ts:445-453` —
  `deriveOrigin(delivery, jobId)` precedence.
- `apps/vscode/src/sdk/vscode-session-host.ts:455-508` — five deriveOrigin
  call sites (C4, C5, C6, C7, C8) all carrying `jobId?`.

PRE-EXISTING PIPELINE WIRING (FROZEN — do not modify except as
required by §5-§7 evidence):

- `sdk/packages/core/src/runtime/turn-queue/pending-prompt-service.ts:329-530` —
  `PendingPromptsController.enqueue` / `drain`; entry-level jobId is
  preserved through C4/C5/C6 hooks; `deps.send` payload NO LONGER
  forwards `delivery` (per OOM repair), but `jobId` IS forwarded
  (lines 475-504).
- `sdk/packages/core/src/runtime/host/local-runtime-host.ts:1172-1255` —
  `runTurn`; `input.jobId` is threaded through to
  `PendingPromptsController.enqueue` (line 1211) and to C7/C8 capture
  hooks (lines 1228-1232, 1248-1254).

## Inherited live failure evidence (from operator-supplied JSONL)

SPECIMEN
  SUBJECT_HEAD = 0a97b445c
  VSIX         = dist/dogfood/clinemm-4.1.16-0a97b445c.vsix
  SHA256       = ab4ddfffe825826a573b47b553407aaa40e921dad67c798ee369f5d245ab2037

LIVE CCARD COUNTERS
  pending_prompt_enqueued   = 2, origin=pending_prompt_drain
  pending_prompt_dequeued   = 2, origin=pending_prompt_drain
  continuation_scheduled    = 2, origin=pending_prompt_drain
  run_turn_started          = 4, origin=explicit_user
  agent_turn_done           = 4, origin=explicit_user

LOAD-BEARING SEQUENCE (twice):

  pending_prompt_dequeued(origin=pending_prompt_drain)
    -> continuation_scheduled(origin=pending_prompt_drain)
    -> run_turn_started(origin=explicit_user)

CRITICAL OBSERVATION:

  wake_created records contain jobId.
  pending_prompt_enqueued/dequeued/continuation_scheduled records
    do NOT contain jobId.

Therefore the failure is broader than C7 deriveOrigin alone: the
correlation token is already absent from the observable C4/C5/C6
capture records. And yet C7/C8 origin reports `explicit_user`, meaning
the C7/C8 hooks do not even see a `jobId?` field — not just an
undefined one. (TBD by RED whether the field is absent because the
record was never given a value or because the capture layer stripped
it; both would yield the same observable.)

## Sections

1. [Freeze the live witness](01-live-witness.md)
2. [Recon the actual production path](02-recon.md)
3. [Correlation sentinel + RED discriminator](03-red-discriminator.md)
4. RED requirement — see §3
5. [Distinguish capture loss from semantic loss](04-classification-and-causal-discriminator.md)
6. [Causal discriminator](04-classification-and-causal-discriminator.md)
7. [Bounded repair](04-classification-and-causal-discriminator.md)
8. [Conservation tests](05-conservation-tests.md)
9. [Gates](09-gates-summary.md)
10. [Stop condition / verdict](08-stop-condition-verdict.md)
11. Successor live qualification — DEFERRED
12. Do not solve the next cardinality question yet — DEFERRED

## Verdict

  PASS_CONTINUATION_CORRELATION_RESTORED

  CORRELATION_LOSS_CLASS = F. MULTIPLE_LOSS
  REPAIR_BOUNDARIES      = #4, #5, #6 (callback type, host destructure, host send call)
  CAUSAL_CLAIM           = bound to executable evidence (RED -> GREEN)

  OOM_REPAIR                  = KEEP (untouched)
  OOM_REPAIR_LIVE_QUALIFIED   = FALSE (still requires live re-run with new artifact)
  P4_CORRELATION              = RESTORED
  REPAIR_OF_CORRELATION_LOSS  = APPLIED

## Final state

  Next ACT (DEFERRED):
    ACT-CLINEMM-LONG-HORIZON-CONTINUATION-CARDINALITY-AUTHORITY04
    Primary purpose: causality / cardinality for the two-wake scenario.
    Correlation is now trustworthy so the next ACT can reliably
    answer: why were two wakes created, which job produced each,
    which wake was legitimate, and which turn, if any, was manufactured?
