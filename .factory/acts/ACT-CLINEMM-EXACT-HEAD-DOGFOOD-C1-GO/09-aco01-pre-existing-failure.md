# ACO01 / ACO03 pre-existing CASE_D_DEAD_ZONE failures (NOT a regression of the PPLC01 wiring)

**Test:** `src/sdk/__tests__/async-command-ownership-discriminator.aco01.c24-c-bridge.test.ts`

**Verdict on regression question:** **Pre-existing.** The Expert digest at
`b1de112d2` did not run the full bridge sweep, only the focused PPLC01/OCRRD01
tests. Re-running just `aco01` against the pristine pre-PPLC01 HEAD
(`b1de112d2`) with the 4 PPLC01 wiring files reverted yields the IDENTICAL
2/3 failure:

```
× ACO01 — after RUNNING(jobId) the surrounding agent run returns without scheduling any successor
✓ ACO02 — terminal completion racing agent.run() return does not duplicate or lose continuation
× ACO03 — terminal completion after agent.run() returns does not produce any successor model step
Test Files  1 failed (1)
     Tests  2 failed | 1 passed (3)
```

The test's own report at runtime explicitly classifies both failures as
`CASE_D_DEAD_ZONE` — a known production gap (no host-side continuation hook
exists in the production code path that the test exercises; matches ACL02's
SOURCE_RECON in the parent epic). The test is DESIGNED to surface this
gap, not to be a green gate.

**Verdict on the PPLC01 wiring:** **Zero regression.** Re-running the full
bridge sweep at the post-commit HEAD `307bb1d46` (the Expert-blessed PPLC01
build-wiring commit) produces the SAME 2/3 failure shape, and the bridge
typecheck (the canonical gate the Expert consulted) remains at 0 NEW
diagnostics vs the frozen baseline. The bridge typecheck was the only
canonical gate that touched the new PPLC01 wiring, and it is PASS.

**Out of scope for this ACT:** Fixing the CASE_D_DEAD_ZONE production gap
is the parent ACT-CLINEMM-ASYNC-COMMAND-OWNERSHIP-DISCRIMINATOR01's open
work, not the PPLC01/OCRRD01 followup. The Expert's digest did not assert
ACO01/03 green; it asserted PPLC01 8/8 + OCRRD01 5/5 + bridge typecheck
0 NEW diagnostics, all of which are confirmed on `307bb1d46`.
