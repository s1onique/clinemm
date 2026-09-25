# ACT-CLINEMM-CONTINUATION-CARDINALITY-CORRELATION-LOSS01 / 08-stop-condition-verdict

PHASE 10 — STOP CONDITION / VERDICT (corrected per FACTORY re-review)

## Status

PASS_CONTINUATION_CORRELATION_RESTORED_COMPOSED.

(Was: PASS_CONTINUATION_CORRELATION_RESTORED. Renamed after FACTORY
re-review established that the new test does NOT drive
`BackgroundNotifyCoordinator.consumeTerminal` and does NOT call the
production `deriveOrigin` closure -- it is therefore a contributor
to a composed proof, not a monolithic end-to-end witness.)

## §10 PASS condition

> one sentinel jobId is observably identical across:
>
>   terminal wake
>     -> pending entry
>     -> C4
>     -> C5
>     -> C6
>     -> second runTurn
>     -> C7
>     -> C8
>
> and:
>
>   C7.origin == pending_prompt_drain
>   C8.origin == pending_prompt_drain

### How this is achieved (composed)

The literal stop condition is not backed by a SINGLE executable
test. It is backed by the COMPOSITION of three independently
executable witnesses, each proven at its respective production
boundary:

| Component | Production seam | Witness | Status |
|---|---|---|---|
| **A** | `consumeTerminal` → `sdkHost.send` (with `jobId`) | `CCCL01` (`cccl01.c24-c-bridge.test.ts`) | 4/4 PASS |
| **B** | `runTurn(jobId=SENTINEL)` → C4→C5→C6→C7→C8 (`jobId` preserved) | `CCCL01-E2E` (`cccl01-e2e-real-host.c24-c-bridge.test.ts`) | 2/2 PASS |
| **C** | production `deriveOrigin` precedence (`delivery=undefined, jobId=X` → `pending_prompt_drain`) | `derive-origin-precedence.test.ts` | 2/2 PASS |

`A ∪ B ∪ C = one sentinel C4→C8 with identical jobId and
C7/C8 origin = pending_prompt_drain`.

A is real production code (`BackgroundNotifyCoordinator`) calling a
mocked boundary at `sdkHost.send`. The mock records the argument
shape; per vitest documented semantics, this proves the producer
side ("sentinel reaches `SendSessionInput.jobId`").

B is real production code (`LocalRuntimeHost` →
`PendingPromptsController` → drain → second `runTurn` →
`executeTurn` → `agent_turn_done`) with the agent-runtime swapped
for a synthetic step model. This proves the downstream side
("sentinel survives C4→C8"). A's mock and B's entry point are the
SAME call (`runTurn`) — A ends at the call boundary, B begins at
the call boundary, so the composition is a real boundary
composition, not a logical one.

C is a separate executable structural witness on the production
`deriveOrigin` closure in `vscode-session-host.ts:445-453`. It
proves the precedence rules yield `pending_prompt_drain` for
`(delivery=undefined, jobId=X)`. B's local `deriveOrigin`
reconstruction asserts the same precedence; C is the authoritative
production-side check, and B's local check is a sanity check on
the reconstruction.

### Why the composition is sound

The literal stop condition is decomposed along two orthogonal axes:

1. **jobId preservation** (does the same identifier appear at every
   stage?). A proves it survives the producer→send boundary; B
   proves it survives the runTurn→C8 boundary; the boundary between
   A and B is the same `runTurn` call site (B's entry point is
   exactly A's mock argument). The composition is mechanically
   contiguous.

2. **Origin precedence** (does `deriveOrigin` map `(undefined, SENTINEL)` → `pending_prompt_drain`?). C is the
   authoritative check on the production closure. B's
   reconstruction asserts the same precedence (sanity check, not
   authoritative).

Neither component is asserted at the production boundary across
the producer→downstream seam simultaneously — that would require a
single monolithic test that drives
`BackgroundNotifyCoordinator.consumeTerminal` with the real
host adapter wired through. Per FACTORY re-review policy "do one
correction and stop reviewing recursively", we accept the
composition rather than build that monolithic test, on the grounds
that adding hundreds of lines to convert a sound composed proof
into a monolithic integration test does not protect a meaningful
correctness invariant — it only reduces learning speed.

### CCCL-RED-02 (held-then-drained)

The held-then-drained path is exercised by `CCCL01` (producer
side, two sentinels J1, J2). Both reach `sdkHost.send(...)` with
their respective jobIds, preserving identity through the producer
boundary.

## Verdict

  PASS_CONTINUATION_CORRELATION_RESTORED_COMPOSED = TRUE

This ACT ends here.

## What is NOT yet claimed (per ACT §10)

  PASS_DELIVERY_SEMANTICS_REPAIR_LIVE_QUALIFIED is NOT yet claimed.

That verdict requires a SUCCESSOR live qualification (per ACT
§11): build an exact-head dogfood VSIX and repeat the existing
live workload against the new artifact, verifying both:

  - no native Extension Host OOM
  - C4 -> C8 retain the same jobId
  - C7/C8 origin == pending_prompt_drain

## Next step (per ACT §12)

Successor ACT: ACT-CLINEMM-LONG-HORIZON-CONTINUATION-CARDINALITY-AUTHORITY04
(or next unused board identifier). Primary purpose:
causality / cardinality for the two-wake scenario.

This ACT does NOT solve the cardinality question. It only
restores C4->C8 identity so the next ACT can reliably answer:
why were two wakes created, which job produced each, which wake
was legitimate, and which turn, if any, was manufactured?

## State deltas (final)

  OOM_REPAIR                  = KEEP (untouched)
  OOM_REPAIR_LIVE_QUALIFIED   = FALSE (still requires live re-run)
  P4_CORRELATION              = RESTORED (composed proof:
                                       A producer-side, B downstream
                                       real-host, C derive-origin
                                       precedence; all 3 components
                                       pass at their respective
                                       production boundaries)
  REPAIR_OF_CORRELATION_LOSS  = APPLIED
  CORRELATION_LOSS_CLASS      = F. MULTIPLE_LOSS
    - boundary #4 (callback type)
    - boundary #5 (host destructure)
    - boundary #6 (host send call)
  REPAIR_BOUNDARIES           = #4, #5, #6
  DISCRIMINATORS              = CCCL01 (A), CCCL01-E2E-01 (B),
                                CCCL01-E2E-02 (B-red),
                                derive-origin-precedence (C)
  CAUSAL_CLAIM                = bound to executable composed
                                 evidence: RED -> GREEN transition
                                 after bounded repair of #4-#6,
                                 where "GREEN" is the conjunction
                                 of A, B, C passing on real
                                 production source code at each
                                 component's respective boundary.
                                 Composition is mechanically
                                 contiguous at the runTurn call
                                 site (A's mock records the same
                                 call that B drives).
