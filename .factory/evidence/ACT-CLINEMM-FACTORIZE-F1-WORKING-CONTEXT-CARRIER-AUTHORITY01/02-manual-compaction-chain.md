# 02 — F1 RECON chain 2: MANUAL COMPACTION chain

> Captured 2026-09-05 at ENTRY_HEAD `0debc0cc1...`.
> Mode = RECON only; no production edit proposed.
> Source files referenced are at `0debc0cc1` (entry head) and F0_CLOSURE_HEAD `49e7069c1`.

## 2.2 Invariants preserved by the manual chain

1. **TRANSPORT-ONLY BYPASS** (sdk-compaction-coordinator.ts:78-87): the bypass
   `setLatest` "reuses the carrier's existing fail-closed assignment semantics"
   per file-level comment. It does NOT recompute W; it does NOT mutate runtime
   state; it does NOT fabricate a `working-context-state-changed` event.
2. **UNCONDITIONAL ASSIGNMENT** (working-context-host-capture.ts:228):
   `this._latest = typeof estimate === "number" ? estimate : null` — identical
   to the normal-chain carrier behavior. UNDEFINED_W_STALE_REUSE = FORBIDDEN.
3. **PUBLICATION ORDERING** (sdk-compaction-coordinator.ts:583-587): the
   bypass fires BEFORE the divider's postStateToWebview so the extension
   state payload carries the new W in the very next publication (no race
   window).
4. **FAILURE IS SWALLOWED FOR W** (sdk-compaction-coordinator.ts:585-591):
   publication failure is logged but not propagated because the divider
   publication is the user-visible success indicator and MUST proceed even
   if W publication fails. This means a throwing `setLatest` would NOT
   crash the compaction; it would only lose the W update.
5. **SKIPPED / FAILED COMPACTION PUBLISHES NO OPTIMISTIC W** (line 582):
   the `if (typeof result.currentWorkingContextEstimate === "number")`
   guard means if W is undefined or compacted === false, `setLatest` is
   NOT called. The carrier slot keeps its previous value (per
   UNDEFINED_W_STALE_REUSE = FORBIDDEN: it does NOT retain a stale W from
   the prior prepareTurn? — re-examining this in §2.5).

## 2.3 Test seams already covering this chain

| Test file | What it asserts |
|---|---|
| `apps/vscode/src/sdk/__tests__/sdk-compaction-w-publish-recon01.test.ts` | (1) `compactSessionMessages()` surfaces `currentWorkingContextEstimate` from the producer seam. (2) `WorkingContextHostCapture.setLatest(w)` replaces PRE with POST in isolation. The "publish-after-postStateToWebview, or loose wiring" bug class. |
| `apps/vscode/src/sdk/sdk-compaction-coordinator.test.ts:387-393` | Coordinator bridge wiring: publish-before-postStateToWebview, divider publication authoritative on failure |
| `apps/vscode/src/sdk/sdk-compaction-coordinator.restore-publication.test.ts` | DEFECT B (post-restore publication) closed at HEAD |
| `apps/vscode/src/sdk/sdk-compaction-coordinator.task-header-projection.thcp11.test.ts` | THCP11 host-compaction freshness / conservation (6/6 PASS per board sixty-fifth-pass) |

## 2.4 What the manual chain does NOT depend on

- It does NOT depend on the runtime event subscription pipeline.
- It does NOT depend on `AgentRuntime.snapshot()`.
- It does NOT depend on `LocalRuntimeHost.subscribeRuntimeEvents`.
- It does NOT depend on `WorkingContextHostCapture.observe` (the carrier is
  written directly, never via the observer).

## 2.5 OPEN QUESTION (re-examination of invariant 5)

The line-582 guard `if (typeof result.currentWorkingContextEstimate === "number")`
prevents calling `setLatest` when W is undefined. But the carrier slot still
holds whatever the last observed `working-context-state-changed` event put
there — typically the pre-compaction prepareTurn W.

Is this:

(a) **stale-W reuse** (FORBIDDEN per UNDEFINED_W_STALE_REUSE = FORBIDDEN)? OR
(b) **honest "no new W this compaction"** (the producer simply didn't compute
    one, and the carrier's prior value is the most recent host-visible W)?

The F0 P1 reviewer's framing — "FAILED COMPACTION PUBLISHES NO OPTIMISTIC W"
in the deletion predicate — implies interpretation (b) is acceptable: when
the producer cannot or will not compute W, the carrier keeps its last
authoritative W from the runtime event stream.

**This question is the heart of the F1 discriminator.** It will be answered
in `03-discriminator.md`. The current code happens to satisfy (b); the
question is whether (b) is the **intended** contract or whether (a) is
the intended contract and the manual chain's silent fall-through is a bug.

## 2.6 F1 traceability

ENTRY_HEAD         = 0debc0cc133ce54f02eff3e6e0d673c2571cbf40
FROZEN_AT          = 0debc0cc133ce54f02eff3e6e0d673c2571cbf40
DESCENDS_FROM      = F0 §19.3 frozen replacement language + F0 §17 recommendation + F0 §18 final report
PRODUCED_BY        = F1 RECON chain 2 capture (no production touched)
NEXT_EVIDENCE_FILE = 03-discriminator.md


