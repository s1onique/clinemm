# 07 — VERDICT

## VERDICT: PASS_STRUCTURAL_ONLY

**ACT:** ACT-CLINEMM-P0-CONTAINMENT-FAILURE-C10-AUTHORITY-REPAIR01 (CFC10AR01)
**Predecessor verdict:** HALT_P0_REPRODUCED
**Evidence class:** SYNTHETIC_REAL
**Expected verdict (per the ACT contract):** PASS_STRUCTURAL_ONLY — **met**

## Why PASS_STRUCTURAL_ONLY and not PASS_LIVE

- The defect was reproduced and repaired against the REAL production
  manager / BCB / coordinator / status-tool seams, with ONLY the manager's
  documented `terminalPostconditionProbe` test seam and the supervisor
  injected.
- **No installed-extension capture was taken.** No live process-group
  containment failure was observed in a running extension and no such
  capture is claimed.
- The original live incident (`1792850126157_b9u7x` / epoch 6 /
  `cmd_mvmh3u69j62aclho`) remains separately classified
  **CAPTURE_INSUFFICIENT**, exactly as the predecessor recorded it. THIS ACT
  DOES NOT RE-ADJUDICATE THAT INCIDENT and does not claim the repair
  resolves it.

## The success criterion — DEMONSTRATED

```
containment_failed + observation_consumed + Elm_AUTHORIZE → C10_completed
```

is now **IMPOSSIBLE** through the tested production paths:

| Gate | Before | After |
|---|---|---|
| Immediate C10 barrier (Site A) | COMMIT | **HOLD** |
| Deferred C10 re-evaluation (Site B) | COMMIT | **HOLD** |
| Commit boundary after the awaited Elm flush (R4) | COMMIT | **HOLD** |

and the corresponding CLEAN-terminal path **CONTINUES TO WORK** (M1-D,
M3-B, M4-B all commit exactly once).

## What was proven

1. **The defect was real and reproduced on BOTH paths** — with the exact
   failing assertion `expected 1 to be +0`.
2. **The repair is ONE shared predicate** — `unresolvedContainmentFailuresForOwner`
   — with the Q5 inline copy deleted. The containment predicate is no longer
   triplicated and cannot drift again.
3. **The R4 async interval was real and IS closed** — the adversarial test
   confirmed the `completed` phase committed over a containment failure
   published during the awaited Elm flush. The commit-boundary revalidation
   closes it with NO additional provider call.
4. **No false HOLD was introduced** — the clean-terminal path still commits.
5. **Zero new failures** across the whole `apps/vscode` vitest suite
   (278 pristine → 257 repaired; the 8 named pre-existing suites keep
   byte-identical counts).
6. **The documentation is consistent** — Chart 02, the transition ledger,
   and every existing validator pass.

## The bounded repair boundary was respected

No Elm kernel change. No React/webview reducer change. No new public API or
protocol field. No change to the compact terminal receipts. No change to the
background-job termination machinery. No new continuation-control design. No
new generalized lifecycle instrumentation. No descendant-safety claim beyond
the existing owned-primary-PGID contract. No worktrees; direct commit and
push on `main`.

## Next cursor

1. **Live qualification (optional, separate ACT).** If a live capture is
   wanted, the minimum next capture is a per-job lifecycle-event record for
   a job that actually fails containment, plus a per-session Elm decision
   trace. This ACT's structural proof does not substitute for it.
2. **Repair (or explicitly baseline) the pre-existing BCB/PCCA harness RED**
   (`getElmCompletionAuthorityDecision` not injected) before any future
   conservation claim relies on those suites. It was NOT done here because
   none of them is load-bearing for this ACT's claims.
3. **Re-adjudicate the original incident** only after (1) — it remains
   `CAPTURE_INSUFFICIENT` and this ACT does not change that.
