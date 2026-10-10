# ACT-CLINEMM-ELM-SEAM08.3-CORRECTION01-STALE-REQUEST-CONSERVATION

**Status:** CLOSED with verdict `PASS_SEAM08.3_CORRECTION01` after a bounded
reviewer-halt correction. The SEAM08.3 ACT closed as
`HALT_STALE_DECISION_COMMIT_UNPROVEN`: the central stale-request
conservation invariant was not proven because the DCBR01-01 test
allowed the TS predecessor to enqueue when the consult's directive
was for a superseded owner. This CORRECTION01 ACT is bounded to
the reviewer's six required corrections; no architectural reset,
no new Elm kernel, no new public wire field, no new state-machine
framework.

**Date:** 2026-10-10
**Entry HEAD:** `25b45c387...` (SEAM08.3 closed)
**Final HEAD:** `<post-correction>`
**Branch:** `main`

---

## 0. MISSION (summary)

The reviewer's verdict on SEAM08.3 was:

> DCBR01-01 does not prove the central stale-request
> conservation invariant. The new test actually exposes the
> problem.
>
> But then the test explicitly permits the TypeScript
> predecessor to enqueue:
>
> > The cascade may pin the dedupe slot ... That is the
> > TS-predecessor's LEGITIMATE enqueue against the LIVE
> > marker.
>
> The test finishes with:
>
> ```
> expect([
>   "delivered",
>   "no_held_job_ids",
>   "not_held",
>   "already_sent",
> ]).toContain(outcome.kind)
> ```
>
> It does not assert `sendLog.length === 0` after resolution,
> and it does not establish that the dedupe slot remains
> unchanged.
>
> That contradicts the requested invariant:
>
> ```
> Old request R1 for A/epoch 7
>        ↓
> Current marker becomes B/epoch 8
>        ↓
> R1 receives PermitEnqueue
>        ↓
> R1 must not enqueue for A or B
> R1 must not mutate B's dedupe slot
> R1 must not commit completion
> ```
>
> Detecting staleness and then continuing the old operation
> is not stale-request rejection.

The critical distinction is:

> A failed Elm consult can use the TypeScript predecessor. An
> obsolete request must not use the predecessor to perform
> effects against a newer owner.

The reviewer's bounded fix (six items, verbatim):

1. Preserve DCBR01-01 as the RED witness, but replace the
   permissive outcome assertion with exact state/effect assertions.
2. Distinguish `authority_unavailable` from `request_superseded`.
   Only the former may invoke the predecessor policy, and only
   while the original request remains valid.
3. On supersession, terminate the obsolete request without
   enqueue, marker mutation, dedupe mutation, or completion
   commit.
4. Exercise the same real coordinator with session, task, and
   epoch supersession, including the case where only the epoch
   changes.
5. Verify normal healthy Elm authority and kernel-offline
   fallback still work.
6. Rerun DCBR01, focused conservation tests, typecheck, and lint.
   Do not reopen packaging or the other Elm kernels.

## 1. REPOSITORY SAFETY

```
ENTRY_HEAD=25b45c387... (SEAM08.3 closed at 25b45c387, the last commit
                         on the working tree before this ACT)
BRANCH=main
```

No stashes, no unexpected tracked dirt, no historical rewrites.

## 2. SCOPE

### In scope (this ACT)

- **Item 1**: replace the permissive `toContain` assertion in
  DCBR01-01 with exact `expect(outcome.kind).toBe("request_superseded")`
  and assertions on `h.sendLog.length === 0`, dedupe slot
  unchanged, marker unchanged, no completion commit.
- **Item 2**: in `consultE31BarrierForFacts`, distinguish
  `authority_unavailable` (kernel offline / decode error /
  no_response) from `request_superseded` (directive consult
  whose live state has drifted). The non-directive consult
  keeps the prior SEAM08.2 `fallthrough` semantics (TS
  predecessor runs). The directive consult whose live state
  has drifted returns `request_superseded` (terminal).
- **Item 3**: add a `request_superseded` outcome to
  `enqueueCompletionContinuationIfHeld`; the new branch
  returns immediately with no enqueue, no marker mutation,
  no dedupe mutation, no completion commit. The TS predecessor
  is NOT permitted to run for a directive consult whose facts
  have drifted.
- **Item 4**: add four supplementary tests (DCBR01-01a/b/c/d)
  covering epoch-only, sessionId-only, taskId-only, and
  marker-cleared drift.
- **Item 5**: preserve the existing healthy-path tests
  (DCBR01-02, 03, 04) and the kernel-offline fallback
  (DCBR01-05, 06, 07) — all continue to pass.
- **Item 6**: rerun DCBR01, the SEAM08 substrate test suites,
  the existing conservation tests (rearm01, ccsrl01, ccse01,
  ccsa01, ccslt01, ccupd01, ccdco01, cchsp01, cchsp03), and
  the completion-continuation-control-elm test suites.
  Typecheck and lint must be green.

### Out of scope (per reviewer's instruction)

- The VSIX packaging fix (c568a80f4) is CLOSED in SEAM08.3.
  Do not reopen.
- The other 4 Elm kernels (completion-authority, completion-
  continuation-control, background-notify-authority, task-
  header-orchestration) are CLOSED in earlier ACTs. Do not
  reopen.
- The MDN-cited timeout test (DCBR01-09) is documented as
  settlement rather than cancellation. The reviewer's P1
  follow-up (Promise.race does not cancel the losing promise)
  is OUT OF SCOPE for this correction.


## 3. REVIEWER P0 #1 - STALE-REQUEST CONSERVATION (PASS)

### Defect (SEAM08.3 verdict)

The `consultE31BarrierForFacts` C5 stale-decision guard
returned `"fallthrough"` on identity drift, which routed to
the TS predecessor. Detecting staleness and then continuing
the old operation is not stale-request rejection.

### Fix (three layers)

**Layer 1 - distinguish the two failure modes**:

```ts
const liveMarker = this.deferredCompletionBarrier
const liveStateDrifted =
    liveMarker === undefined ||
    liveMarker.sessionId !== facts.sessionId ||
    liveMarker.taskId !== facts.taskId ||
    liveMarker.epoch !== facts.markerEpoch
// Non-directive outcomes (kernel_offline /
// decode_error / no_decision) are fail-closed; the
// TS predecessor path runs.
if (consultResult.kind !== "directive") {
    return "fallthrough"
}
// Directive + live state drift: the consult was
// directive for the OLD owner / task / epoch, and
// the live state has advanced since. The original
// request is now obsolete; the TS predecessor must
// NOT run.
if (liveStateDrifted) {
    return "request_superseded"
}
```

The order is load-bearing: a non-directive consult
(`kernel_offline` / `decode_error` / `no_response`) keeps
the prior SEAM08.2 `fallthrough` semantics (the kernel
made no decision, so the original request is still valid
and the TS predecessor runs). A directive consult whose
facts have drifted is now `request_superseded` (the
directive was for a snapshot the live state no longer
represents; the TS predecessor must NOT run).

The `RejectStaleIdentity` case in the switch is updated
to be a safety net: if the kernel rejected but the host's
revalidation did not detect drift, the consult is still
treated as `request_superseded` (the kernel's directive
is authoritative; the host must honor it). A
`Logger.warn` is emitted so the operator can see the
discrepancy in the production dogfood dump.

**Layer 2 - call site discriminator**:

```ts
if (e31Outcome === "fallthrough") {
    // Elm authority unavailable. The original
    // request is still valid because the kernel
    // never made a decision. The TS path
    // continues to run.
} else if (e31Outcome === "request_superseded") {
    // Elm consult was directive for the OLD
    // owner / task / epoch / marker-absent
    // state. The live state has drifted since
    // the consult was started. The original
    // request is now OBSOLETE. TERMINAL: no
    // enqueue, no marker mutation, no dedupe
    // slot mutation, no completion commit. The
    // TS predecessor is NOT permitted to run.
    Logger.warn(
        `[SdkController] E3.1 deferred-completion-barrier request superseded (live state drifted after consult); terminating without enqueue for session=${activeSessionId}`,
    )
    return Promise.resolve({ kind: "request_superseded" })
} else if (e31Outcome === "clear_rearm") {
    ...
}
```

**Layer 3 - new typed outcome**:

The `enqueueCompletionContinuationIfHeld` return union
gains `{ kind: "request_superseded" }`. The
`applyBlockedCompletionContinuationOutcome` mapping
gains the same union member (treated as a no-op — no
marker stamp, no incident publication; the
stale-request conservation invariant is enforced at
the call site, not in the mapping).

## 4. REVIEWER ITEM 1 - DCBR01-01 EXACT ASSERTIONS (PASS)

### RED witness (before correction)

The original DCBR01-01 had a permissive
`expect([...]).toContain(outcome.kind)` assertion. The
test allowed the TS predecessor to enqueue and the
dedupe slot to be pinned with a key computed against
the OLD owner's facts.

### GREEN witness (after correction)

The new DCBR01-01 makes five exact assertions:

```ts
expect(outcome.kind).toBe("request_superseded")
expect(h.sendLog.length).toBe(0)
const afterMarker = h.coordinator.getDeferredCompletionBarrierForTesting()
expect(afterMarker?.sessionId).toBe("B")
expect(afterMarker?.taskId).toBe("T_B")
expect(afterMarker?.epoch).toBe(8)
expect(internal.lastCompletionContinuationSessionEpoch).toBe(dedupeBeforeDrift)
expect(h.completionCommitCount()).toBe(0)
```

Each invariant is now an exact assertion:

1. `outcome.kind === "request_superseded"` (TERMINAL;
   the directive is rejected without routing to the TS
   predecessor).
2. `h.sendLog.length === 0` (no enqueue fired — neither
   from the consult nor from the TS predecessor).
3. `internal.lastCompletionContinuationSessionEpoch ===
   dedupeBeforeDrift` (the consult did not pin B's dedupe
   slot with a key computed against A's facts).
4. `afterMarker` is unchanged (B/epoch=8) — the consult
   did not mutate the marker.
5. `h.completionCommitCount() === 0` — no completion
   commit fired.

**Test result:** PASS.

## 5. REVIEWER ITEM 4 - SESSION/TASK/EPOCH SUPERSESSION (PASS)

Four supplementary tests exercise the same real
coordinator with each kind of single-field drift:

- **DCBR01-01a**: epoch-only drift (sessionId and
  taskId match the live marker; only the epoch is
  advanced). Result: `request_superseded`. PASS.
- **DCBR01-01b**: sessionId-only drift (taskId and
  epoch match the live marker; only the sessionId is
  changed). Result: `request_superseded`. PASS.
- **DCBR01-01c**: taskId-only drift (sessionId and
  epoch match the live marker; only the taskId is
  changed). Result: `request_superseded`. PASS.
- **DCBR01-01d**: live marker cleared entirely
  mid-flight. Result: `request_superseded`. PASS.

Together with the original DCBR01-01 (full owner/epoch
drift), all five supersession shapes are covered.

## 6. REVIEWER ITEM 5 - HEALTHY ELM + KERNEL-OFFLINE (PASS)

The pre-existing healthy-path and kernel-offline tests
continue to pass (no regression):

- DCBR01-02: healthy `SuppressDuplicate` directive →
  `already_sent`. PASS.
- DCBR01-03: healthy `PermitEnqueue{mustClearRearm:true}`
  directive → clears REARM, delivers. PASS.
- DCBR01-04: healthy `PreserveBarrier` directive →
  `no_held_job_ids`. PASS.
- DCBR01-05: `kernel_offline` non-directive consult
  falls through to the TS predecessor (which delivers).
  PASS. (The C4 / C13 invariant: a failed Elm consult
  CAN use the TS predecessor because the original
  request is still valid.)
- DCBR01-06: malformed directive is rejected at the
  public-adapter boundary and falls through to the TS
  predecessor. PASS.
- DCBR01-07: `decode_error` (malformed echo) consult
  falls through to the TS predecessor. PASS.
- DCBR01-09: 5-second public-boundary timer fires for
  a never-resolving invoke; the consult surfaces
  `decode_error(no_response)` and the TS predecessor
  runs. PASS. (Documented as settlement, not
  cancellation — the reviewer's P1 follow-up is OUT OF
  SCOPE.)

## 7. REVIEWER ITEM 2 - DCBR01-08 REDEFINED (PASS)

The pre-existing DCBR01-08 cleared the marker BEFORE
the `enqueueCompletionContinuationIfHeld` call. Under
that scenario, the L1664 guard `if
(!this.deferredCompletionBarrier) return not_held`
fires before the consult is reached; the consult is
never invoked. The test was titled "C5 guard" but
actually exercised the L1664 guard, not the C5 guard.

The new DCBR01-08 holds the consult in flight, clears
the live marker mid-flight, then releases a
`RejectStaleIdentity` directive. The consult is
directive and the live state has drifted (marker
gone), so the request is `request_superseded`. The
test now exercises the C5 guard as the title
intended.

**Test result:** PASS.


## 8. C9 - CONSERVATION SUITES (PASS)

| Suite                                                       | Status                | Delta |
|-------------------------------------------------------------|-----------------------|-------|
| deferred-completion-barrier-elm-coordinator-qualification   | 13/13 PASS            | +4 (01a/01b/01c/01d), 1 modified (01 exact, 08 redefined) |
| completion-continuation-rearm01                             | 7/7 PASS              | 0     |
| completion-continuation-stall-enforcement01                 | 5/5 PASS              | 0     |
| completion-continuation-stall-lifetime01                    | 10/10 PASS            | 0     |
| completion-continuation-structural-authority01              | 10/10 PASS            | 0     |
| completion-continuation-upstream-discriminator01            | 9/9 PASS              | 0     |
| completion-continuation-delivery-callback-outcome01         | 9/9 PASS              | 0     |
| completion-continuation-delivery-callback-outcome-red01     | 5/5 PASS              | 0     |
| deferred-completion-barrier-elm-stale-decision              | 5/5 PASS              | 0     |
| deferred-completion-barrier-elm-transport-correlation       | 11/11 PASS            | 0     |
| deferred-completion-barrier-elm-interop-discriminator       | 10/10 PASS            | 0     |
| deferred-completion-barrier-elm-settlement-and-dupes        | 8/8 PASS              | 0     |
| **Total**                                                   | **102/102 across 12 files** | 0 ACT-owned regressions |

The completion-continuation-control-elm-* suites
(correspondence, capability, malformed, namespace-
coexistence, loader-discriminator, production-wiring,
authority-cutover) all pass: 56/56.

## 9. C10 - BUILD AND TOOLCHAIN GATES (PASS)

| Gate                          | Status |
|-------------------------------|--------|
| Elm compile (kernel)          | PASS (no source changes) |
| TypeScript typecheck          | PASS (0 errors in changed files) |
| biome lint                    | PASS (0 errors) |
| biome format                  | PASS (0 errors) |
| Vitest focused sweep          | 102/102 across 12 files |

## 10. AUTHORITY AUDIT (C13)

After this ACT, the explicit ownership is:

```
Elm E3.1 (this ACT)         : ACTIVE in production via consultE31BarrierForFacts
Elm E3.1 stale-request guard: ACTIVE (CORRECTION01) — distinguishes
                              authority_unavailable (kernel offline) from
                              request_superseded (directive consult + drift).
Elm E1.1 validation only    : NOT IMPLEMENTED (skipped per SEAM08)
Elm E2.1                    : NOT IMPLEMENTED (out of scope per SEAM08)
TS synchronous prefixes     : ALL (C10 set site, Q5 reeval, C10 reeval)
TS emergency fallback       : ElmUnavailable_UsePredecessor — but ONLY
                              for non-directive consults. Directive
                              consults whose facts have drifted are
                              TERMINAL (`request_superseded`).
existing completion-authority kernel : unchanged
existing completion-continuation-control kernel : unchanged
```

**Verified:**

- no unexplained dual authority (the Elm consult routes
  to the existing TS branches for healthy directives;
  for drifted directives, the consult's verdict is
  terminal; the TS predecessor is not invoked)
- no silent fallback for directive consults (a
  directive consult with a drifted live state is
  `request_superseded`, never `fallthrough` into the
  TS predecessor)
- no stale commit (the new `request_superseded` branch
  is the commit-time identity revalidation's terminal
  verdict; the C5 invariant is preserved)
- no duplicated completion gate (E2.1 is explicitly
  out of scope)
- no invalid C10 capture (no production code changed
  outside the wiring call site and the helper type)

## 11. P2 - NON-BLOCKING RESIDUE

None. The reviewer's bounded fix is fully executed.

## 12. FACTORY STOP RULE

- **HALT_P0_TRIGGERED:** None. The stale-request
  conservation invariant is now executable and green.
- **HALT_P1_TRIGGERED:** None.
- **No recursive Factory review initiated.** This ACT
  executes the reviewer's bounded fix for SEAM08.3
  in a single bounded correction.

## 13. NEXT CURSOR

1. **SEAM08 LIVE qualification** — the corrected E3.1
   production cutover is now ready for live dogfood
   qualification. The VSIX packaging fix
   (`c568a80f4` whitelisting all 5 runtime-asset
   kernels) is already in place; the production
   activator (`setDeferredCompletionBarrierElmProductionKernelPath`
   in extension.ts) is already wired. The remaining
   work is to build a fresh VSIX and exercise the
   corrected production seam against a real BCB
   cycle.
2. **C5 Timeout test (P1 follow-up, OUT OF SCOPE
   here)** — the reviewer's note that
   `Promise.race` does not cancel the losing promise
   is a separate follow-up. The DCBR01-09 test
   demonstrates settlement (the 5-second timer fires
   and the consult surfaces `decode_error`); the
   underlying never-resolving invoke is never
   canceled. Keep as a P1 follow-up unless the
   underlying operation retains resources or can
   subsequently mutate state.

## 14. FILES CHANGED

- `apps/vscode/src/sdk/sdk-session-event-coordinator.ts`
  - `consultE31BarrierForFacts` (L1024-1115): added
    `request_superseded` return; re-ordered the
    C5 stale-decision guard to fire AFTER the
    directive-type check; added
    `request_superseded` branch to the directive
    switch; added `Logger.warn` for the safety
    net.
  - `enqueueCompletionContinuationIfHeld` (L1672-)
    return union: added `{ kind: "request_superseded" }`.
  - Call site of `consultE31BarrierForFacts`
    (L1934-): added `request_superseded` branch
    that returns immediately with no enqueue, no
    marker mutation, no dedupe mutation, no
    completion commit.
  - `applyBlockedCompletionContinuationOutcome`
    (L2185-): added `request_superseded` union
    member (no-op).

- `apps/vscode/src/sdk/__tests__/deferred-completion-barrier-elm-coordinator-qualification.dcbr01.test.ts`
  - DCBR01-01: replaced permissive `toContain`
    assertion with five exact assertions.
  - DCBR01-01a/b/c/d: added four supplementary
    tests (epoch-only, sessionId-only, taskId-only,
    marker-cleared drift).
  - DCBR01-08: re-defined to exercise the C5
    guard (was actually exercising the L1664
    guard).

## 15. WHAT IS ACCEPTED

| Evidence                          | Assessment                                        |
| --------------------------------- | ------------------------------------------------- |
| DCBR01 exact supersession         | PASS (DCBR01-01: 5 exact assertions)              |
| DCBR01 supplementary supersession| PASS (DCBR01-01a/01b/01c/01d: 4 tests)            |
| DCBR01 healthy-path                | PASS (DCBR01-02, 03, 04)                          |
| DCBR01 kernel-offline              | PASS (DCBR01-05, 06, 07)                          |
| DCBR01 timeout settlement          | PASS (DCBR01-09, 5005ms)                          |
| Conservation suites                | PASS (rearm01/ccse01/ccslt01/ccsa01/ccupd01/ccdco01/ccdco-red01) |
| SEAM08 substrate suites            | PASS (dcbesd01/dcbtc01/dcbeid01/dcbsd01)          |
| Completion-control-elm suites      | PASS (cccec01/cccap01/ccmb01/ccnc01/ccld01/ccpw01/ccac01) |
| TypeScript typecheck               | PASS (0 errors)                                   |
| biome lint                         | PASS (0 errors)                                   |
| biome format                       | PASS (0 errors)                                   |

## 16. VERDICT

```
SEAM08.3_PRODUCTION_REACH:       PASS
SEAM08.3_ELM_NECESSITY:         PASS_WITH_INJECTED_DIRECTIVES
SEAM08.3_VSIX:                  BUILT (closed in c568a80f4)
SEAM08.3_STALE_REQUEST_SAFETY:  PASS  (was HALT; now GREEN via the new
                                      request_superseded outcome, exact
                                      DCBR01-01 assertions, and the
                                      four supplementary tests)
SEAM08.3_LIVE:                  LIVE_UNOBSERVABLE
```

Next: SEAM08 LIVE dogfood qualification. The production
seam is now ready to be exercised against a real BCB
cycle.
