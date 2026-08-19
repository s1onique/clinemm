# ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-W1-EPOCH-DOMAIN-MISMATCH-RED-FIX01

## Close Report

### Verdict: PASS

### Lifecycle: VERIFIED

### Verified At: 2026-08-19T10:55:00Z (worktree clean on commit `38f71531f`)

---

## Subject

| Property | Value |
|----------|-------|
| Commit OID | `38f71531fc331dd9f7dbcc9da3c58aded84cf0d7` |
| Parent OID | `d4e24148c048364adce6b19f50cc5e149a0d538f` (REACT-UPDATER-PURITY-REPAIR01) |
| Branch | `act/elm-architecture01-e0-e4` |
| Files Changed | 4 (2 modified, 2 added) |
| Lines Net | +651 / -4 |

---

## Causal Mechanism (Live Composition)

| Row | Channel | Wire | Replica / Committed |
|-----|---------|------|---------------------|
| P12 | W1 host/raw | `turnState: streaming/11` | `idle/3` (RED) |
| P12 | W2 stream | `epoch=2`, `seq=9, 11, 13, …` | advances replica epoch to 2 |
| P35 | W1 host/raw | `turnState: awaiting_followup/34` | `idle/3` (RED) |
| P35 | W2 stream | `epoch=2`, `seq=33` | continues at epoch 2 |

Reducer contract: `applyStateSnapshot` drops the snapshot wholesale
when `snapshotEpoch < state.epoch` (messageReducer.ts:167). The W1
producer (SdkController.getStateToPostToWebview) was returning an
object that did not stamp `epoch` (or `stateVersion`) on the wire.
The webview read it as `epoch ?? 0 = 0` and `stateVersion ?? 0 = 0`,
so every W1 push after the W2 epoch bump was dropped, including
its `turnState`.

---

## Production Fix

`apps/vscode/src/sdk/SdkController.ts` (line range 2754–2788)

| Field | Pre-fix | Post-fix |
|-------|---------|----------|
| `stateVersion` | absent (webview reads 0) | `minter.nextSeq()` (monotonic, wire-stamped) |
| `epoch` | absent (webview reads 0) | `minter.epoch` (synchronous read of fence) |
| `_ptadPushId` (PTAD on) | `minter.nextSeq()` (one-shot) | `sharedSeq = minter.nextSeq()` (shared with `stateVersion`) |

Net diff: 22 lines added, 1 removed (single seam). The same
`MessageIdMinter` that stamps W2 messages
(apps/vscode/src/sdk/sdk-message-coordinator.ts:33-43) now also
stamps W1. Refuses to touch the reducer fence — the rule is correct
given the contract; the bug was always producer-side omission.

---

## Test Policy Compliance

Pre-fix: 2 RED + 1 GREEN in the default suite. Per the test-policy
correction in the prior reviewer verdict: **no deliberate failures
in the default suite**. All three rungs are now GREEN regression
witnesses that pin the post-fix wire shape, with the pre-fix
assertion in a comment trail.

---

## Tests

| File | Status | Notes |
|------|--------|-------|
| `apps/vscode/webview-ui/src/components/chat/chat-view/__tests__/w1-epoch-domain-mismatch-red-fix01.test.tsx` | 3/3 GREEN | R0 streaming composition, R1 ablation, R2 terminal composition |
| `apps/vscode/src/sdk/__tests__/sdk-controller-w1-epoch-stateversion-stamping.test.ts` | 12/12 GREEN | P0 structural witness (4), P1 MessageIdMinter runtime invariants (3), P2 shared-seq invariant (2), P3 causal ordering (3) |
| `apps/vscode/src/sdk/SdkController.task-telemetry-wiring.test.ts` (C04-WIRE-2) | 6/6 GREEN | Source-witness regex updated to match the dual `return { ... } / const snapshot = { ... }` shape (parallel to the E7.1 thinking-presentation structural witness) |

---

## Pre-existing Failures (NOT caused by this fix)

| Test | Reason |
|------|--------|
| `src/sdk/__tests__/hub-runtime-host.provenance-epoch.c24-d3.test.ts` | Missing `@cline-internal/core/hub/runtime-host/hub-runtime-host` package alias. Per `vitest.config.ts:38`, this test requires `vitest.config.c2-4-d-hub.ts`. Pre-existing on HEAD. |
| `src/sdk/sdk-task-control-coordinator.test.ts > settles a pending question when switching tasks` | Pre-existing 20s timeout flake. Pre-existing on HEAD. |
| `src/sdk/__tests__/post-terminal-authority-diagnostic-wiring.test.ts > W3-2` | Pre-existing source-witness assertion that doesn't match the current `setDidHydrateState(true)` position. Pre-existing on HEAD. |

All three confirmed by `git stash` + re-run on unmodified HEAD.

---

## Required Checks

| Check | Status |
|-------|--------|
| Worktree Clean (before fix) | PASS |
| Webview-UI Unit Suite | PASS (602/602 in 74 files) |
| Extension Vitest Suite | PASS (1698/1700 in 121 files; 2 pre-existing failures unrelated to this ACT) |
| Extension Bun Unit Suite | PASS (1067/1067 in 72 files) |
| TypeScript (SdkController.ts, new test files) | PASS (0 errors in touched files) |
| Biome Lint (touched files) | PASS (0 warnings) |
| Worktree Clean (after fix) | PASS |

---

## Causal Evidence Summary

```text
LIVE FAILURE (frozen):
  W2 traffic establishes epoch 2
  W1 accepted by webview without a usable epoch
  reducer interprets W1 epoch as 0
  0 < 2
  W1 snapshot rejected wholesale
  turnState remains idle/3

RED REPRODUCED (pre-fix HEAD, then converted to GREEN witnesses):
  R0: missing W1 epoch + existing epoch 2 → streaming/11 rejected (RED → GREEN)
  R2: missing W1 epoch + existing epoch 2 → awaiting_followup/34 rejected (RED → GREEN)

ABLATION (pre-fix HEAD, retained):
  R1: W1 epoch 2 → streaming/11 accepted (GREEN)

REDUCER CONTRACT (independent, frozen):
  messageReducer.ts:167 — snapshotEpoch < state.epoch → drop snapshot
  messageReducer.ts:177 — snapshotVersion !== 0 && snapshotVersion <= state.stateVersion → ignore
  (correctness of the rule is orthogonal to the producer fix; the rule
   required the producer to stamp, which it now does)

PRODUCER FIX (applied):
  SdkController.getStateToPostToWebview now stamps:
    stateVersion: sharedSeq  (minter.nextSeq())
    epoch: minter.epoch
  Same MessageIdMinter that stamps W2 messages (sdk-message-coordinator.ts).
  When PTAD is on, _ptadPushId aliases stateVersion for diagnostic correlation.

PRODUCER-SEAM TEST BINDING (new file, 12 tests):
  P0: structural — stamping lines exist in SdkController source
  P1: MessageIdMinter — nextSeq advances the same counter W2 uses
  P2: shared-seq — _ptadPushId === stateVersion when PTAD on
  P3: causal ordering — stateVersion strictly orders W1 pushes across W2
```

---

## Disposition

```text
W1/W2 EPOCH-DOMAIN MISMATCH
  live failure                       ✅ PROVEN
  real-provider RED                  ✅ PROVEN (then converted to GREEN witnesses)
  ablation                           ✅ PROVEN
  producer omission                  ✅ PROVEN
  bounded producer repair            ✅ APPLIED

P1:
  producer-seam regression test      ✅ APPLIED (12 tests, P0/P1/P2/P3)
  shared-seq ordering invariant      ✅ APPLIED (P3-1)

FULL SUITES
  webview                            ✅ 602
  extension (vitest)                 ✅ 1698 / 1700 (2 pre-existing failures)
  extension (bun)                    ✅ 1067

NEXT (out of this ACT):
  1. exact-head VSIX
  2. install + dogfood "Say hello and stop"
  3. PTAD + LCD01 dump
  4. confirm: raw epoch == committed epoch, raw streaming/N == committed
     streaming/N, raw awaiting_followup/M == committed awaiting_followup/M,
     W1.stateVersion nonzero, W2.epoch == W1.epoch

E8 / E9                              ⛔ HOLD
```

---

## Commit

```
38f71531f fix(sdk): stamp W1 snapshot with epoch + stateVersion from the minter
```

