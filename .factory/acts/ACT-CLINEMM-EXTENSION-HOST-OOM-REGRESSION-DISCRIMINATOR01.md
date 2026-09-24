# ACT-CLINEMM-EXTENSION-HOST-OOM-REGRESSION-DISCRIMINATOR01

**PRIMARY PURPOSE**: causality / necessity

## Status

DISCRIMINATORS_INSTALLED_LIVE_SPECIMEN_READY_FOR_OPERATOR

## Frozen evidence

```
GOOD_ARTIFACT                  = d1ecf48dc
BAD_ARTIFACT                   = 99006fbcc
ENTRY_HEAD                     = 97a2efcb07632420666d53f6bd296313bfcf5fba
REGRESSION_COMMIT              = 99006fbccaacb150b78e54dad7bdadc2a1390238
REGRESSION_COMMIT_COUNT        = 1
```

The two-dot interval `d1ecf48dc..99006fbcc` contains exactly one
commit: `99006fbcc` — ACT-CLINEMM-LONG-HORIZON-CONTINUATION-CARDINALITY-AUTHORITY01
V3 production-wiring fix.

## Hypothesis (H1)

Propagation of `next.delivery` across
`PendingPromptsController.drain → deps.send → LocalRuntimeHost.runTurn`
is **necessary** for the observed Extension Host OOM regression.

H1 is NOT proven. This ACT discriminates it.

## Ablation

A throwaway diagnostic ablation seam was added to
`sdk/packages/core/src/runtime/turn-queue/pending-prompt-service.ts`:

```typescript
private readonly __ablateDeliveryPropagation =
    process.env.CLINEMM_OOM_DISC01_ABLATE_DELIVERY === "1";
```

The conditional spread at the `deps.send(...)` payload in
`PendingPromptsController.drain` was modified:

```typescript
// Before (production):
...(next.delivery !== undefined ? { delivery: next.delivery } : {}),

// After (with seam, default off):
...(this.__ablateDeliveryPropagation || next.delivery === undefined
    ? {}
    : { delivery: next.delivery }),
```

When `CLINEMM_OOM_DISC01_ABLATE_DELIVERY=1`, the `delivery` field is
dropped from the `deps.send` payload. When unset (default), the
production behavior is preserved byte-for-byte.

**Preserved** (not touched):
- `next.jobId` propagation (line ~529)
- `onBeforeDispatch` forwarding
- C4/C5/C6 hooks
- C7 placement at executeTurn boundary
- all CCARD capture hooks
- CCARD ring/counters
- termination authority tooling
- CPU profiler substrate
- sandbox behavior
- completion/arbitration/presentation semantics

## Discriminators

### AB-DELIVERY-01 (structural)

File: `sdk/packages/core/src/runtime/turn-queue/pending-prompt-service.test.ts`

Given a drained `PendingPromptEntry` with `delivery: "queue"` and
`jobId: "job-1"`, under the ablation:

```typescript
process.env.CLINEMM_OOM_DISC01_ABLATE_DELIVERY = "1";
// ...
const call = sendCalls[0];
expect(Object.prototype.hasOwnProperty.call(call, "delivery")).toBe(false);
expect(call?.jobId).toBe("job-1");
```

This exercises the **real** `PendingPromptsController.drain` seam (not
a duplicate of the payload-construction helper).

**RED proof**: temporarily reverting the seam (so the ablation is
no-op) causes AB-DELIVERY-01 to fail with
`hasOwnProperty("delivery") = true` (expected: false). This confirms
AB-DELIVERY-01 is load-bearing.

### AB-DELIVERY-02 (conservation)

With the ablation env var explicitly deleted inside the test
(production path):

```typescript
delete process.env.CLINEMM_OOM_DISC01_ABLATE_DELIVERY;
// ...
expect(call?.delivery).toBe("queue");
expect(call?.jobId).toBe("job-1");
```

Confirms the production path is preserved exactly when the env var
is unset.

### Expected RED on CCARD-WIRE-01 (existing test)

The existing `CCARD-WIRE-01` test pins `sendCalls[0]?.delivery === "queue"`.
Under ablation this fails — proving the ablation is observing the same
field-removal that CCARD-WIRE-01 was originally protecting.

## Gates

| Gate | Result |
|------|--------|
| pending-prompt-service.test.ts (production mode) | 12/12 PASS |
| pending-prompt-service.test.ts (ablation mode) | 11/12 PASS + 1 expected RED (CCARD-WIRE-01) |
| sdk/core typecheck | 67 pre-existing errors in unrelated files; 0 new errors in touched files |
| apps/vscode typecheck | exit 0, empty output (clean) |
| git diff --check | empty (clean) |

## Live specimen

The live specimen is **READY_FOR_OPERATOR_RUN** but was not performed
in this session (this dev environment lacks VSCodium, the isolated
user-data dir, and the ClineMM Nix wrapper required for the same
operator launch path used for the historical BAD=99006fbcc
reproduction).

See `.factory/evidence/ACT-CLINEMM-EXTENSION-HOST-OOM-REGRESSION-DISCRIMINATOR01/05-live-ablation.md`
for the complete execution contract.

## Verdict (this session)

**DISCRIMINATORS_INSTALLED_LIVE_SPECIMEN_READY_FOR_OPERATOR**

The code-level discriminators are complete and load-bearing. The
ablation seam is wired. The live specimen must be run by a human
operator to convert the code-level proof into a production-OOM
necessity proof.

## If H1 is proven (after operator runs live specimen)

Do NOT fold the repair into this ACT. Close with
**PASS_DELIVERY_PROPAGATION_NECESSARY_FOR_OOM** and open a separate
bounded repair ACT whose first job is to determine WHY propagating
`delivery` back through the drain boundary re-enters or changes
queue/steer semantics. The repair must preserve whatever correlation
CCARD actually needs without reintroducing the causal semantic cycle.

## If H1 is refuted (after operator runs live specimen)

Do NOT immediately modify another semantic field. Close this ACT
with **PASS_DELIVERY_PROPAGATION_REFUTED**. The next discriminator
becomes CCARD diagnostic activation as a whole — specifically,
compare current semantics with all C1..C10 capture callbacks
disabled while preserving the underlying 99006fbcc queue/jobId/delivery
semantics.

## Artifacts

```
.factory/evidence/ACT-CLINEMM-EXTENSION-HOST-OOM-REGRESSION-DISCRIMINATOR01/
├── 01-entry-state.md
├── 02-single-commit-boundary.txt
├── 03-ablation-diff.txt
├── 04-focused-gates.txt
├── 04a-focused-gates-production-mode-full.txt
├── 04b-focused-gates-ablation-mode-full.txt
├── 04c-sdk-core-typecheck.txt
├── 04d-apps-vscode-typecheck.txt
├── 04e-git-diff-check.txt
├── 05-live-ablation.md
└── result.json
```
