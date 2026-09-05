# 01 — F1 RECON chain 1: NORMAL TURN chain

> Captured 2026-09-05 at ENTRY_HEAD `0debc0cc1...`.
> Mode = RECON only; no production edit proposed.
> Source files referenced are at `0debc0cc1` (entry head) and F0_CLOSURE_HEAD `49e7069c1`.

## 1.2 Invariants preserved by the normal chain

1. **UNCONDITIONAL ASSIGNMENT** (line 183): every observed
   `working-context-state-changed` event REPLACES `_latest`. A conditional skip
   would resurrect stale-W behavior; that is FORBIDDEN by file-level comment
   (lines 56-58).
2. **NULL NORMALIZATION** (line 183): runtime-published `undefined` is
   normalized to `null` so the boundary-5 fallback can distinguish "runtime
   cleared" from "legacy carrier absent". The assignment is STILL
   unconditional; the type change is at the public surface only.
3. **RSMT01 OBSERVATION ≠ CONTROL** (sdk/packages/agents/src/agent-runtime.ts:1327-1344):
   the emit try/catch swallows subscriber errors so a throwing listener
   cannot become authority over the preparation result.
4. **PRODUCER CADENCE**: `currentWorkingContextEstimate` is published on every
   prepareTurn (whether or not compaction occurred); the metadata-only branch
   (line 910) is not a "no-op" — it always emits W on the producer cadence.
5. **NO ESTIMATOR RECOMPUTE IN HOST** (working-context-host-capture.ts:75-83):
   the carrier is transport-only; it does not import or call
   `estimateRequestInputTokens` / `estimateMessageTokens`.

## 1.3 Test seams already covering this chain

| Test file | What it asserts |
|---|---|
| `sdk/packages/agents/src/agent-runtime.working-context-publication.test.ts` | Runtime publishes W on prepareTurn; ordering-permitting visibility inside listeners |
| `sdk/packages/agents/src/agent-runtime.current-working-context-state-bind.test.ts` | STATE_BIND: W captured verbatim from prepareTurn result |
| `sdk/packages/agents/src/agent-runtime.runtime-w-observe.test.ts` | Runtime W observed via listener |
| `sdk/packages/core/src/runtime/orchestration/session-runtime-orchestrator.runtime-prepare-turn-w-strip.test.ts` | Metadata-only branch preserves W (no messages/systemPrompt) |
| `sdk/packages/core/src/extensions/context/compaction.working-context-authority-publish.test.ts` | CANONICAL_W_ESTIMATOR applied to FINAL returned shape |
| `sdk/packages/core/src/extensions/context/compaction.real-producer-seam-red.test.ts` | Producer-seam RED for prepareTurn |
| `apps/vscode/src/sdk/dogfood-diagnostic-profile.ts:681-683` | Dogfood: chain exercised end-to-end via synthetic AgentRuntimeEvent(W=271337) |
| `apps/vscode/src/sdk/__tests__/working-context-webview-state-projection.test.ts` | capture → projectWorkingContextStateFromCarrier end-to-end |

## 1.4 What the normal chain does NOT depend on

- It does NOT depend on the manual compaction chain.
- It does NOT depend on `setLatest` (the bypass ingress is a separate code
  path; it is wired only via `SdkController.ts:1704-1707`).
- It does NOT depend on `CompactSessionMessagesResult` shape; the runtime
  publishes W from the snapshot, not from the compaction result.

## 1.5 F1 traceability

ENTRY_HEAD         = 0debc0cc133ce54f02eff3e6e0d673c2571cbf40
FROZEN_AT          = 0debc0cc133ce54f02eff3e6e0d673c2571cbf40
DESCENDS_FROM      = F0 §19.3 frozen replacement language + F0 §07 compatibility/shadow inventory
PRODUCED_BY        = F1 RECON chain 1 capture (no production touched)
NEXT_EVIDENCE_FILE = 02-manual-compaction-chain.md


