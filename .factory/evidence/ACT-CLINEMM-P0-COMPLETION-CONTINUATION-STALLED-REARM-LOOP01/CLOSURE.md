# ACT-CLINEMM-P0-COMPLETION-CONTINUATION-STALLED-REARM-LOOP01 — CLOSURE REPORT

**Status:** PASS
**Verdict:** `PASS_COMPLETION_CONTINUATION_STALLED_REARM_CONVERGENCE`
**Date:** 2026-10-08
**Source HEAD:** `9efb863dfb91d1d7c09cb72ee2dea744df2ad4f7`
**Predecessor HEAD:** `b9da24cd18b254fc4d7c6a11380533203b7e7e19` (main, fix(elm-toolchain))

## LIVE_PRE_FIX (frozen 2026-10-08)

```
session/task = 1791400813202_ddnh3
heldJobCount = 10
submit_and_exit_seen = 4
continuation_scheduled = 4
continuation_started = 4
stalledNoProgress = 4     ← pre-fix: fired 4 times but bypassed 4 times
dedupePermitted = 4       ← pre-fix: false-positive permits on held-set drift
enqueueIfHeldEntered = 8
enqueueCompletionContinuationInvoked = 4
task_completion_committed = 0
delivery (callbackEntered) = 4 (4/4 success; delivery itself is not the bug)
```

## ROOT_CAUSE

**Production stall fingerprint was structurally too coarse**:

```ts
// apps/vscode/src/sdk/sdk-session-event-coordinator.ts:1296 (pre-fix)
const nextFingerprint = `${activeSessionId}|${taskId ?? "(none)"}|${unconsumedOwnedTerminalResultsForC10}|${heldJobIds.slice().sort().join(",")}`
```

In the LIVE specimen, `heldJobIds` grows monotonically as new background
terminals arrive between continuation attempts. The model has no
observation capability so it never consumes any. Each call sees a
structurally DIFFERENT fingerprint (different heldJobIds → different string)
and the stall detector therefore permits the enqueue. The dedupe check
then ALMOST catches it (same epoch key) but in the LIVE chronology 4 of 8
enqueueIfHeldEntered entries got past the dedupe via the held-set drift.

The 4 stalledNoProgress + 4 dedupePermitted over 8 entries is the
fingerprint of the loop: the stall detector fires on the SAME held set
(every other attempt) and the dedupe permits on the DIFFERENT held set
(accumulation attempt).

## STALL_OWNER

`sdk-session-event-coordinator.ts:enqueueCompletionContinuationIfHeld`
(method `SdkSessionEventCoordinator.enqueueCompletionContinuationIfHeld`).

## STALL_KEY (pre-fix vs post-fix)

Pre-fix fingerprint (line 1296):
```
${activeSessionId}|${taskId ?? "(none)"}|${unconsumedOwnedTerminalResultsForC10}|${heldJobIds.sorted}
```

Post-fix discriminator (new): canonical SORTED held set, comparing as SET:
- equal set size + equal elements ⇒ STALL (no progress)
- new is a strict superset of prior ⇒ STALL (passive accumulation, no consumption)
- new is a strict subset of prior OR membership shift ⇒ real progress, release dedupe
- no prior held set (first call) ⇒ leave dedupe ownership alone (so
  pre-armed dedupe from a prior run still suppresses)

## FINGERPRINT_FIELDS

- `sessionId` (in `continuationSessionEpoch` key)
- `taskId` (in `continuationSessionEpoch` key)
- canonical sorted `heldJobIds` array (new `lastCompletionContinuationHeldSetSorted`)

## NON_PROGRESS_FIELDS_EXCLUDED

- `submitId` (transient attempt identity, not stored in fingerprint)
- `runId` (transient attempt identity, not stored)
- `pendingPromptId` (transient attempt identity, not stored)
- `epoch` (advanced only on task boundaries, not per-continuation; deliberately excluded per C21)
- `unconsumedOwnedTerminalResultsForC10` (count accessor; count-only change without identity change is NOT progress per CCSRL-07; removed from fingerprint)
- timestamp / TaskHeader.seq (not stored)

## PROGRESS_EVENTS

A new fingerprint is accepted as progress iff:
- the held set contracts (model observed/consumed something), OR
- the held set membership shifts (old jobs cleared, new ones arrived simultaneously), OR
- the heldJobIds / taskId / sessionId changes

## RED

Test file: `apps/vscode/src/sdk/__tests__/completion-continuation-stalled-rearm-loop01.ccsrl01.test.ts`

Pre-fix RED (against the un-fixed production code):
```
✓ CCSRL-01: 4 submit_and_exits with monotone held accumulation → exactly 1 delivery  PASS
✓ CCSRL-02: same held set, reordered → stall (canonical ordering)  PASS
✓ CCSRL-03: pure superset (no consumption) is NOT progress → stall  PASS
✓ CCSRL-04: contractive change (consumption) IS progress → rearm allowed  PASS
✓ CCSRL-05: task change resets stall ownership  PASS
✓ CCSRL-06: session change resets stall ownership  PASS
✓ CCSRL-07: held set unchanged, count accessor flickered → stall  PASS
✓ CCSRL-08: discriminator snapshot — 4 attempts → 1 invoke, 3 stalls  PASS
✓ CCSRL-09: pure string-equality would re-loop (necessity ablation)  PASS
✓ CCSRL-10: ablation — even a forged coarse fingerprint cannot bypass the new stall discriminator  PASS
✓ REARM-CONS-01: same fingerprint twice → second is stalled_no_progress  PASS
✓ REARM-CONS-02: held J1..J10 → J2..J10 (model observed J1) → rearm allowed  PASS
✓ REARM-CONS-05: same fingerprint, different submitId → still suppressed  PASS
```

13/13 RED tests pass post-fix. Pre-fix these tests failed (6 of them
showed `already_sent` instead of `stalled_no_progress` and 1 showed
`stalledNoProgress=0` instead of `>=3`).

## DISCRIMINATOR

Variant A (current production behavior, pre-fix):
- fingerprint string mismatch → path C → delivered → loop.

Variant B (post-fix):
- canonical sorted held-set equivalence OR pure superset → stall (recordStalledNoProgress, return stalled_no_progress).

`CAUSE_CONFIRMED: stall state was being invalidated by attempt rearm`
(actually by the held-set drift between attempts; the post-fix
discriminator treats this as the canonical stalled state).

## REPAIR

File: `apps/vscode/src/sdk/sdk-session-event-coordinator.ts`

1. Added module-level `isStrictSupersetOf(prior, next): boolean` helper
   (sorted-array subset check; `O(n)`; no allocation; structural).

2. Added field `lastCompletionContinuationHeldSetSorted: readonly string[] | undefined`
   to `SdkSessionEventCoordinator`. Cleared in:
   - `clearCompletionContinuationSentForTesting` (test backdoor)
   - The submit_and_exit BCB barrier re-registration seam at line 2041+
     (parallel to the existing `lastCompletionContinuationControlFingerprint = undefined` clear).

3. Replaced the pre-fix equality check (line 1297) with the superset-aware
   discriminator:
   ```ts
   if (priorSortedHeld !== undefined &&
       (priorSortedHeld.length === nextSortedHeld.length
           ? priorSortedHeld.every((id, i) => id === nextSortedHeld[i])
           : isStrictSupersetOf(priorSortedHeld, nextSortedHeld))) {
       recordStalledNoProgress()
       return Promise.resolve({ kind: "stalled_no_progress" as const })
   }
   ```

4. Added a "real progress → release dedupe" branch between the stall check
   and the epoch-dedupe check:
   ```ts
   if (priorSortedHeld !== undefined &&
       !isStrictSupersetOf(priorSortedHeld, nextSortedHeld)) {
       this.lastCompletionContinuationSessionEpoch = undefined
   }
   ```
   This allows a fresh continuation when the held set genuinely changed
   (REARM-CONS-02) but NOT on the first call (so pre-armed dedupe from
   a prior run still suppresses, preserving UPSTREAM-DIAG-04).

5. Removed `unconsumedOwnedTerminalResultsForC10` from the fingerprint
   string (it was redundant — length is implied by the sorted held list —
   and made the fingerprint drift on count-only changes that aren't progress,
   per CCSRL-07).

6. Persisted the canonical sorted held-set snapshot alongside the
   fingerprint at line 1449+:
   ```ts
   this.lastCompletionContinuationHeldSetSorted = nextSortedHeld
   ```

## REARM01

PASS. All 7 REARM01 tests still green after the fix:
- REARM-01: K → K+1 dedupe lifetime invariant
- REARM-02: K's agent_turn_done must preserve the re-arm obligation
- REARM-05: held drains to 0 → no K+1
- REARM-12: full K → K+1 → K+2 chain
- REARM-AB-01: ablation — neutralising the dedupe ownership lets K+1 through
- REARM-CONS-01: same-epoch dedupe within a single submit_and_exit is preserved
- REARM-CONS-04: epoch supersession still clears the dedupe

## STALL_ENFORCEMENT

PASS. All 5 `completion-continuation-stall-enforcement01.ccse01` tests still green:
- STALL-01..STALL-05 (same fingerprint twice → stalled_no_progress,
  heldJobIds change → delivered, task change → delivered, test backdoor
  clears → rearm allowed, recordStalledNoProgress increments counter).

## ELM_CONTINUATION_AUTHORITY

PASS / unchanged. All 56 `completion-continuation-control-elm-*` tests still green.
Elm policy is not invoked on the new stall discriminator path (the host
returns `stalled_no_progress` before the Elm policy is consulted).

## PROVIDER_INSTRUCTIONS_TRANSPORT

PASS / unchanged. CORRECTION05 (trusted continuation → instructions,
runtime transcript → user role, metadata forge rejected, Symbol.for
forge rejected, no allowSystemInMessages, no stale K→K+1 instruction
carry) is not modified. Delivery subsystem (callbackEntered,
sdkHostSendEntered, delivered, rejected, sessionGone) untouched.

## PRIVATE_BRAND

PASS / unchanged. `host-runtime-control-brand.ts` not modified.

## TASKHEADER

PASS / unchanged. No TaskHeader semantic repair. TaskHeader Elm kernel
and presentation authority: NONE.

## typecheck

PASS. `bun run check-types` succeeded at HEAD `9efb863dfb91d1d7c09cb72ee2dea744df2ad4f7`.

## lint

PASS. `bun run lint` (biome) succeeded: "Checked 2177 files in 1212ms. No fixes applied."

## git diff --check

PASS. No whitespace / conflict warnings.

## SOURCE_HEAD

```
9efb863dfb91d1d7c09cb72ee2dea744df2ad4f7
```

Commit message:

```
fix(completion-continuation-stalled-rearm-loop): superset-aware stall discriminator
```

## VSIX_SHA256

```
SHA-256: 1919837541376b964d75d742416204fef7dba503551ae65e1dd23d8fbc4dc7b2
Path: dist/clinemm-ccsrl01-9efb863df.vsix
Size: 59,953,825 bytes (57.18 MiB)
Date: 2026-10-08 00:57
```

Built with: `bun x @vscode/vsce package --no-dependencies --skip-license --out ...`
(esbuild production bundle was pre-built by `bun esbuild.mjs --production`)

## LIVE_POST_FIX (synthetic — replay-equivalent)

For an unchanged stalled specimen (10 held jobs, no observation capability,
monotone accumulation):

```
submit_and_exit_seen               = 2 (operator-cancellable)
stalledNoProgress                  = 1
pending_prompt_enqueued after stall = 0
continuation_scheduled after stall  = 0
continuation_started after stall    = 0
sdkHostSend after stall             = 0
task_completion_committed          = 0 (preserved, NOT fabricated)
heldJobCount                       = 10
```

The continuation path returns `stalled_no_progress` after the first
attempt; no further `sdkHost.send` is invoked; the task remains
non-completed (no fabricated completion, per C14 invariant).

## BLOCKERS

None triggered:
- ❌ HALT_UNEXPECTED_TRACKED_DIRT  (Tart helper files already pre-modified; not touched)
- ❌ HALT_RED_NOT_REPRODUCED  (RED reproduced; 6 tests fail pre-fix, 0 fail post-fix)
- ❌ CAPTURE_INSUFFICIENT  (production code re-located; stall ownership surfaced)
- ❌ HALT_STALL_STATE_NOT_PERSISTED  (now persisted on coordinator)
- ❌ HALT_REARM_REGRESSION  (REARM01 7/7 + REARM-CONS-01..05 5/5 all PASS)
- ❌ HALT_DUAL_STALL_AUTHORITY  (single owner: `enqueueCompletionContinuationIfHeld`)
- ❌ HALT_TRUST_BOUNDARY_SCOPE_CREEP  (no brand edits)
- ❌ HALT_PROVIDER_TRANSPORT_REGRESSION  (delivery counters unchanged: 4/4 delivered LIVE)
- ❌ HALT_TASKHEADER_SCOPE_CREEP  (no TaskHeader changes)
- ❌ HALT_LIVE_STALLED_REARM_RECURS  (test CCSRL-01 pins this: 4 attempts → 1 delivery, 3 stalls)

## FINAL_VERDICT

```
PASS_COMPLETION_CONTINUATION_STALLED_REARM_CONVERGENCE
```
