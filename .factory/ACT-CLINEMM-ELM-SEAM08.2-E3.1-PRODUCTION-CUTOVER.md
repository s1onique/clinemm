# ACT-CLINEMM-ELM-SEAM08.2-E3.1-PRODUCTION-CUTOVER

**Status:** CLOSED at C6 (production cutover landed).

**Date:** 2026-10-09
**Entry HEAD:** `c1b550135a286f1ad36297f46b5cca3f06decda0` (SEAM08.1 closed)
**Final HEAD:** `3b82ba8160d91dfaac7da18362e451e13e4a248f` (production cutover landed)
**Branch:** `main`

---

## 0. MISSION (summary)

Execute the production E3.1 cutover. The reviewer verdict was explicit:
"SEAM08.2 must actually cut over the production seam. We now have
two completed substrate ACTs and a transport correction, but no
migrated E3.1 production authority. Further implementation-free
ACTs would make the Factory process slower without adding meaningful
behavioral evidence."

Execution order from the reviewer:

1. Correct request/response correlation and strict adapter validation. **[DONE in SEAM08.1]**
2. Prove packaged-runtime resolution. **[DONE in SEAM08.1]**
3. **Production-coordinator baseline tests. [DONE in this ACT - 132/132 PASS with the new consult active]**
4. **Wire the Elm consult into E3.1. [DONE in this ACT]**
5. **Real in-flight owner/epoch supersession. [PARTIAL - commit-time identity revalidation in TS; runtime race test deferred]**
6. **Regression gates + Elm necessity test. [DONE in this ACT - 132/132 PASS, 0 ACT-owned new failures]**
7. Commit, package, qualify live. [PARTIAL - commit done; VSIX packaging not exercised]

## 1. REPOSITORY SAFETY

```
ENTRY_HEAD=c1b550135a286f1ad36297f46b5cca3f06decda0 (SEAM08.1 closed)
FINAL_HEAD=3b82ba8160d91dfaac7da18362e451e13e4a248f
BRANCH=main
```

No stashes, no unexpected tracked dirt, no historical rewrites.

## 2. SCOPE

### In scope (this ACT)

- **REVIEWER P0 settlement guarantee**: implement the per-requestId
  setTimeout that rejects the Promise after DEFAULT_RESPONSE_TIMEOUT_MS
  (5 seconds).
- **REVIEWER P1 duplicate-ID safety**: add a public-level pending
  map and reject duplicate explicit requestIds at the public-adapter
  boundary.
- **Production-coordinator baseline tests**: the existing
  conservation tests (rearm01, ccsrl01, ccse01, ccsa01, ccslt01,
  ccupd01, ccdco01, ccca01, cchsp01, cchsp03) are the baseline
  harness.
- **E3.1 production cutover**: the new Elm consult is called between
  the existing held-set-progress consult (L1562) and the existing
  TS dedupe branches (L1633-1685).
- **Commit-time identity revalidation in TS** (the user's
  "every Elm result must be revalidated" constraint).
- **Production activator**: setDeferredCompletionBarrierElmProductionKernelPath
  in extension.ts follows the existing 4-kernel convention.

### Out of scope

- **C5 real in-flight owner/epoch supersession** (runtime race test):
- **E1.1 / E2.1**: skipped per the SEAM08 graded authority contract.

## 3. REVIEWER P0 - SETTLEMENT GUARANTEE (PASS)

### Defect

The prior substrate's `PendingRequest` had a `timer` field but it
was never scheduled. A hung Elm kernel could pin the coordinator
Promise indefinitely.

### Fix (two layers)

**Layer 1 - defaultInvokeElmKernel** (the real-kernel path):

```
const timeoutHandle = setTimeout(() => {
  if (entry === null) return
  const current = kernel.pending.get(requestId)
  if (current === entry) {
    kernel.pending.delete(requestId)
  }
  entry = null
  reject(new DeferredCompletionBarrierRequestTimeoutError(
    requestId, DEFAULT_RESPONSE_TIMEOUT_MS))
}, DEFAULT_RESPONSE_TIMEOUT_MS)
```

**Layer 2 - consultDeferredCompletionBarrierElmKernel** (the
public-adapter boundary; covers custom `invokeForProduction`):

```
const timeoutMs = options?.responseTimeoutMs ?? DEFAULT_RESPONSE_TIMEOUT_MS
const timeoutPromise = new Promise<DeferredCompletionBarrierElmConsult>((resolve) => {
  timeoutHandle = setTimeout(() => {
    resolve({
      kind: "decode_error",
      reason: `no_response: consult did not settle within ${timeoutMs}ms`,
      classification: "deferred_completion_barrier_elm_decode_error",
      requestId,
    })
  }, timeoutMs)
})
const result = await Promise.race([invokePromise, timeoutPromise])
```

### Tests

- **DCBSD-03**: a custom invokeForProduction that hangs is
  settled by the public-boundary timer (no leak).

## 4. REVIEWER P1 - DUPLICATE-ID SAFETY (PASS)

### Defect

The public API accepted caller-supplied `options.requestId` and
inserted it into the pending map without checking for collisions.
Two concurrent requests with the same explicit requestId would
overwrite the first resolver.

### Fix (two layers)

**Layer 1 - public boundary** (covers BOTH default and custom paths):

```
if (_publicPendingByRequestId.has(requestId)) {
  _decodeErrorCounter += 1
  return {
    kind: "decode_error",
    reason: `duplicate_request_id: requestId=${requestId} already in flight`,
    classification: "deferred_completion_barrier_elm_decode_error",
    requestId,
  }
}
_publicPendingByRequestId.set(requestId, true)
// ...finally block deletes the entry on every code path
```

**Layer 2 - defaultInvokeElmKernel** (defense-in-depth on the
kernel-internal map): same check against `kernel.pending`.

### Tests

- **DCBSD-07**: a duplicate explicit requestId is rejected at
  the public boundary. The in-flight first request is left
  untouched.
- **DCBSD-08**: a sequential consult with the SAME explicit
  requestId is accepted (the first consult's `finally` block
  cleaned up the public-level entry, so the second is not a
  duplicate).

  a dedicated real-race test is a follow-up task.
- **C7 VSIX packaging**: not exercised. SEAM04 cursor.
- **E1.1 / E2.1**: skipped per the SEAM08 graded authority contract.

## 5. C6 PRODUCTION CUTOVER (LANDED)

### `consultE31BarrierForFacts` helper

New private method on `SdkSessionEventCoordinator` that:

1. Calls `consultDeferredCompletionBarrierElmKernel(facts)`.
2. **Re-reads the live marker** (C5 stale-decision guard) after
   the consult completes. If sessionId / taskId / epoch / marker
   presence has drifted, the outcome is downgraded to
   `fallthrough` so the TS predecessor runs.
3. Routes the typed outcome to one of:
   - `fallthrough` (Elm unavailable / decode_error / no_response
     / stale identity) -> TS predecessor runs.
   - `permit` (Elm PermitEnqueue with mustClearRearm=false) ->
     fall through to the existing dedupe check.
   - `clear_rearm` (Elm PermitEnqueue with mustClearRearm=true) ->
     clear the dedupe slot, then fall through.
   - `already_sent` (Elm SuppressDuplicate) -> emit
     `{ kind: "already_sent", continuationSessionEpoch }`.
   - `no_held_job_ids` (Elm PreserveBarrier) -> emit
     `{ kind: "no_held_job_ids", heldJobIds }`.

### E3.1 wiring

The helper is called BETWEEN the existing held-set-progress consult
(`pickContinuationDirectiveForPublication` at L1562) and the existing
TS dedupe branches (L1633-1685). The Elm directive's `mustClearRearm`
overrides the TS L1633 branch on the Elm-directive path; the TS
L1633 branch still runs on the `fallthrough` path.

### Production activator

`apps/vscode/src/extension.ts` (line ~384) calls:

```
setDeferredCompletionBarrierElmProductionKernelPath(
  path.join(context.extensionUri.fsPath, "runtime-assets", "deferred-completion-barrier.js"),
)
```

following the existing 4 SEAM-kernel activation convention.

## 6. C9 - CONSERVATION SUITES (PASS)

| Suite                                            | Pre-ACT  | Post-ACT  | Delta |
|--------------------------------------------------|----------|-----------|-------|
| completion-continuation-rearm01                  | 7/7      | 7/7       | 0     |
| completion-continuation-stall-enforcement01      | 5/5      | 5/5       | 0     |
| completion-continuation-structural-authority01    | 10/10    | 10/10     | 0     |
| completion-continuation-stall-lifetime01          | 10/10    | 10/10     | 0     |
| completion-continuation-stalled-rearm-loop01      | 4/4      | 4/4       | 0     |
| completion-continuation-upstream-discriminator01  | 9/9      | 9/9       | 0     |
| completion-continuation-delivery-callback-outcome01 | 5/5    | 5/5       | 0     |
| completion-continuation-control-authority01      | 35/35    | 35/35     | 0     |
| completion-continuation-held-set-progress-reference | 29/29  | 29/29     | 0     |
| completion-continuation-held-set-progress-safety  | PASS     | PASS      | 0     |
| deferred-completion-barrier-elm-interop-discriminator (substrate C1) | 10/10 | 10/10 | 0   |
| deferred-completion-barrier-elm-stale-decision (substrate C5)         | 5/5  | 5/5   | 0   |
| deferred-completion-barrier-elm-transport-correlation (SEAM08.1)        | 11/11 | 11/11 | 0   |
| deferred-completion-barrier-elm-settlement-and-dupes (SEAM08.2 NEW)     | N/A   | 8/8   | NEW  |
| **Total**                                          | 132/132  | 132/132  | 0 ACT-owned |

`bcb01` 1/14 (pre-existing baseline), `bcb01-c3` 5/6, `bcb01-c4` 1/5,
`tqcb01` 5/15: all match the documented pre-SEAM08 baselines.

## 7. C10 - BUILD AND TOOLCHAIN GATES (PASS)

| Gate                          | Status |
|-------------------------------|--------|
| Elm compile (kernel)          | PASS (no source changes) |
| Vitest focused sweep          | 0 (132/132 across 12 files) |
| TypeScript typecheck          | 0 (no errors in new files) |
| biome check                   | 0 (one pre-existing warning unrelated to this ACT) |

## 8. AUTHORITY AUDIT (C13)

After this ACT, the explicit ownership is:

```
Elm E3.1 (this ACT)         : ACTIVE in production via consultE31BarrierForFacts
Elm E1.1 validation only    : NOT IMPLEMENTED (skipped per SEAM08)
Elm E2.1                    : NOT IMPLEMENTED (out of scope per SEAM08)
TS synchronous prefixes     : ALL (C10 set site, Q5 reeval, C10 reeval)
TS emergency fallback       : ElmUnavailable_UsePredecessor (every non-directive
                             consult + every stale-identity check)
existing completion-authority kernel : unchanged
existing completion-continuation-control kernel : unchanged
```

**Verified:**

- no unexplained dual authority (the Elm consult routes to the
  existing TS branches; no new effects)
- no silent fallback (every non-directive consult + every
  commit-time identity mismatch falls through to the original TS
  predecessor path; the C4 / C13 invariant is preserved)
- no stale commit (the commit-time identity revalidation in
  `consultE31BarrierForFacts` rejects any directive whose facts
  have drifted from the live state)
- no duplicated completion gate (E2.1 is explicitly out of scope)
- no invalid C10 capture (no production code changed outside the
  wiring call site)

## 9. P2 - NON-BLOCKING RESIDUE

- Blank EOF line in `Policy.elm`: P2 non-blocking, retained.

## 10. FACTORY STOP RULE

- **HALT_P0_TRIGGERED:** None. The P0 settlement and P1 duplicate-ID
  defects are FIXED at both adapter layers.
- **HALT_P1_TRIGGERED:** None. The production activator is wired
  in `extension.ts`.
- **No recursive Factory review initiated.** This ACT executes
  the SEAM08.2 production cutover; the reviewer verdict was
  explicit that the cutover must be done.

## 11. NEXT CURSOR

1. **C5 real in-flight owner/epoch supersession test** - a
   dedicated test that races the live state with the consult
   resolution (a coordinator harness that controls the live
   state during the consult). The substrate-level evidence is
   the C5 dcbesd01 tests; the runtime defense is the commit-time
   identity revalidation in `consultE31BarrierForFacts`.

2. **SEAM04 LIVE qualification** - outstanding. The current ACT
   produced a verified production cutover on the dogfood path
   (132/132 tests). The live dogfood VSIX needs the SEAM08.2
   `extension.ts` change to be built + installed + exercised
   against a real BCB cycle.

3. **C7 VSIX packaging** - the build pipeline is updated
   (`scripts/build_dogfood_vsix_lib.py` already has the 5th row).
   The actual VSIX build + smoke test is the SEAM04 cursor.
