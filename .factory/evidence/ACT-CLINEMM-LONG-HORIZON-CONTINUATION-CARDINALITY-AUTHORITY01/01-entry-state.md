# ACT-CLINEMM-LONG-HORIZON-CONTINUATION-CARDINALITY-AUTHORITY01 — Entry State

## Frozen

```
LIVE_SINGLE_JOB_DUPLICATE_COMPLETION = PROVEN
LIVE_MULTI_JOB_DUPLICATE_COMPLETION  = PROVEN

CommandJob lifecycle                 = CONSERVED
notify-on-terminal                   = LIVE_GREEN
pending-prompts authority            = CLOSED
terminal-card projection             = CLOSED
synthetic wake presentation hiding   = CLOSED
completion barrier                   = PRESENT
dual-delivery arbitration            = PRESENT

ROOT_CAUSE                           = UNRESOLVED

```text
DIAGNOSTIC_FIRST_1_2_SEAM             = UNRESOLVED (the LIVE QUALIFICATION decides)
```
```

## Halt history

1. **HALT_CCARD_DIAGNOSTIC_CANNOT_DISCRIMINATE_CONTINUATION_ORIGIN**
   — V1 capture was hard-coded to `pending_prompt_drain` for C7/C8
   and C5/C6 were emitted in lockstep. Fixed by V2 (split C5/C6,
   derive origin from delivery, thread jobId).

2. **HALT_CCARD_V2_PRODUCTION_WIRING_FALSE_GREEN**
   — V2 declared `onBeforeDispatch` on the SDK contract but the real
   `LocalRuntimeHost` never forwarded it to `PendingPromptsControllerDeps`
   (so C6 never fired in LIVE), `next.jobId` was captured at C5/C6
   but never crossed the `deps.send` boundary (so C6→C7 correlation
   was lost), and C7 fired at `runTurn` request entry (BEFORE the
   queue/steer short-circuit) so a `runTurn(delivery:"queue")` request
   manufactured a `1→2` signal all on its own. Fixed by V3 (see
   Production-Wiring Fixes below).

## Prior ACT closure claim (TQCB01 / CORRECTION02.5)

The TQCB01 / CORRECTION02.5 ACT closed `PASS_PRODUCTION_SEAM_WITNESS_PROVEN`
(2026-09-23), but fresh LIVE evidence (one managed notify=true job →
one terminal result → one legitimate completion → later autonomous
continuation → second submit_and_exit → second COMPLETED) shows the
closure is INSUFFICIENT for the autonomous-continuation case.

## Production-Wiring Fixes (V3)

Three P0/P1 production-wiring defects were closed in V3:

| # | Defect | Fix | Regression test |
|---|--------|-----|-----------------|
| 1 | `onBeforeDispatch` declared on SDK contract but NOT forwarded to `PendingPromptsControllerDeps` in `LocalRuntimeHost` constructor. C6 hook therefore never fired in LIVE production. | Added the missing dep-forwarding spread so `options.pendingPromptCapture?.onBeforeDispatch` actually reaches the controller. | CCARD-WIRE-01 (real controller, real drain, stubbed send) — fails if forwarding is removed. |
| 2 | C7 (`onRunTurnStarted`) fired at `runTurn` entry — BEFORE the queue/steer short-circuit. A `runTurn(delivery:"queue")` request manufactured a `1→2` signal by itself. | Moved C7 to fire immediately before `executeTurn(...)`. The queue/steer short-circuit now returns before C7 fires. | CCARD-WIRE-02 (queue-path enqueue with `canStartRun() === false` does NOT fire send). |
| 3 | `next.jobId` was captured at C5/C6 but NOT copied into the SendSessionInput passed to `runTurn` — so C6→C7 jobId correlation was lost. | Threaded `next.jobId` (and `next.delivery` so the drained prompt's origin is preserved) into `deps.send({...})`. | CCARD-WIRE-01 (asserts the jobId survives the send boundary). |

## Disposition for THIS ACT

The TQCB01 completion barrier and TQ7 dual-delivery arbitration are
useful but insufficient. The first duplicated seam is unknown.

This ACT's purpose is bounded:

1. Add a temporary dogfood-only Command Palette dump command for
   continuation-cardinality capture (this file + the diagnostic module
   + the registry entry + the Command Palette registration + the
   `package.json` declaration + the C1..C10 production instrumentation
   sites).
2. Run a LIVE dogfood reproduction (one notify=true 30s job →
   one terminal result → confirm the dump produces a JSONL whose
   per-stage counter shows the first 1 → 2 cardinality seam).
3. NOT patch presentation / arbitration / completion semantics — those
   were already ruled out as the cause.

## Conservation (UNCHANGED)

- BCAFG01 — unchanged
- BCNEX01 — unchanged
- BCNT01 — unchanged
- BCTCP01 — unchanged
- BTCONT01 — unchanged
- AGCONT01 — unchanged
- LHOWA01 — unchanged
- PPAT01 — unchanged
- TQCB01 — unchanged
