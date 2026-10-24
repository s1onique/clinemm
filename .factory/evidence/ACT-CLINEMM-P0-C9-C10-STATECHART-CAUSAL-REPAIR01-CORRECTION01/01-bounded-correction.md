# ACT-CLINEMM-P0-C9-C10-STATECHART-CAUSAL-REPAIR01 — CORRECTION01 (C9C10CDAP01)

**Bounded correction — commit-driven completion-authority publication.**

**ENTRY_HEAD:** `5f6a27caf968fce88adb5b33576ab5487a993cba` (main).

## The review verdict that triggered this correction

`HALT_PREMATURE_COMPLETION_AUTHORITY_PUBLICATION` — two findings.

### P0 — the completion authority is PUBLISHED before the C10 commit

The C9C10SCR01 repair was RETROSPECTIVE: it stamped
`isAuthoritativelyCompletedResult: true` at the completion tool's
`content_end` (PUBLICATION time) and retracted it later when the Elm
authority rejected the completion.

The invariant is TEMPORAL:

> an authoritative completion must never be PUBLISHED before its C10
> commit.

A later corrective update cannot establish that invariant. The webview
receives the publication and the retraction as SEPARATE messages over an
event-based channel and can process the first one before the retraction
arrives. The FINAL projection was correct; the temporal invariant was
violated.

The 19 existing C9C10SCR01 tests drove `content_start → content_end →
done` and inspected the FINAL projection. They never asserted the
projection IMMEDIATELY AFTER `content_end`, before `done` — so they
could not see the premature publication.

### P1 — the deferred C10 path left a legitimate completion badge-less

`reevaluateDeferredCompletionBarrier()` can later AUTHORIZE and COMMIT
the C10 after the Elm decision flipped HOLD → AUTHORIZE. The retraction
removed the marker and nothing ever restored it, so a legitimate,
committed completion ended up with NO badge:

```
content_end  → authority marker published
             → Elm HOLD
             → authority marker retracted
             → agent_turn_done
             → Elm AUTHORIZE
             → C10 committed, phase = completed
             → completion row still has NO authority marker

## The bounded correction

Replace retrospective retraction with **commit-driven authority
publication**.

| # | Contract item | Implementation |
|---|---|---|
| 1 | Publish live `content_end` rows without claiming C10 authority; preserve historical/restored completed-row semantics | `message-translator.ts`: the LIVE completion branch now requires `event.isAuthoritativeCompletion === true` to stamp the marker. The LIVE path passes NO explicit bit, so it stamps NOTHING. The RESTORATION path (`finalizePersistedToolUse`) passes an explicit bit and is UNCHANGED — a persisted COMMITTED completion keeps its marker, a persisted HELD attempt still omits it. |
| 2 | On either C10 commit path — immediate or deferred — promote the corresponding row using the existing `ts`, with owner/session/epoch correlation | `sdk-session-event-coordinator.ts`: new seam `promoteCompletionAuthorityMarker(event)` re-publishes the tracked row with the SAME `ts` and the marker ADDED, via the established update channel (`emitHookMessage`). Invoked at BOTH C10 commits: the immediate turn-complete path and the deferred `reevaluateDeferredCompletionBarrier` path. The tracked row is the one the coordinator ITSELF published for the CURRENT turn (set AFTER the message-layer completion filter ran), so a BCB-filtered row is never resurrected; it is cleared at the turn boundary, so a historical row is never touched. |
| 3 | Add two RED tests: no badge immediately after `content_end`, and deferred C10 promotes the existing row without another `submit_and_exit` | `c9-c10-commit-driven-authority-publication01.c9c10cdap01.test.ts` — RED-04 and RED-05. |
| 4 | Exercise the actual webview `applyMessage` reducer, including sequence/epoch fencing, rather than only the harness's simulated message store | The new suite drives the REAL `applyMessage` from `webview-ui/src/components/chat/chat-view/messageReducer.ts` and models the production `SdkMessageCoordinator.stamp()` seq/epoch stamping exactly. RED-06 asserts the promotion carries a STRICTLY HIGHER `seq` than the publication (so the reducer accepts it) and that a STALE (older-epoch) promotion is DROPPED. |
| 5 | Preserve the already-green conservation tests and re-run the focused gates | The 19 C9C10SCR01 tests (5 + 14) still pass unchanged. |

**No new framework, no new Elm kernel, no additional diagnostic
infrastructure, no new ACT.** One bounded correction to the current
repair.

```

The existing `CONS-04` test did not cover this: it simulated a second
`submit_and_exit` (another marked completion row), not the deferred C10
commit path without another completion-tool invocation.


## RED evidence (the new suite, BEFORE the production fix)

```
× immediately after content_end (before done) the row carries NO authoritative badge
✓ after the C10 commit the SAME row (same ts) is promoted and DOES carry the badge
× Elm HOLD at turn end -> Elm AUTHORIZE at agent_turn_done -> the existing row is promoted
× the promoted row carries a HIGHER seq than the publication, so the reducer accepts it
× a STALE (older-epoch) promotion is dropped by the webview reducer
× an uncontended completion commits once and shows the badge
✓ a permanently-held completion never claims authority
```

5 of 7 fail without the production change. The two that pass are the
controls that are true in BOTH designs (the retraction design also
produced a badge on the immediate commit path, and a permanently-held
completion never had one).

RED-04's failure was the P0 witness: `expected { kind: 'completed', … } to
be undefined` — the badge WAS rendered immediately after `content_end`,
before any C10 commit.

RED-05's failure was the P1 witness: `expected undefined to be
'completed'` — after the deferred C10 committed, the row had NO badge.

## GREEN evidence (after the production fix)

```
✓ src/sdk/__tests__/c9-c10-commit-driven-authority-publication01.c9c10cdap01.test.ts (7 tests)
✓ src/sdk/__tests__/c9-c10-statechart-causal-repair01.c9c10scr01.test.ts (5 tests)
✓ src/sdk/__tests__/c9-c10-statechart-causal-repair01.c9c10scr01-cons.test.ts (14 tests)
✓ src/sdk/__tests__/completion-presentation-authority01.cpa01.test.ts (14 tests)
✓ src/sdk/__tests__/terminal-report-cardinality-repair01.trcr01.test.ts (8 tests)
✓ src/sdk/__tests__/terminal-report-duplication-corr01.trd01.test.ts (5 tests)
✓ src/sdk/message-translator.test.ts (167 tests)
❯ src/sdk/__tests__/task-terminal-divergence-red01.tdd-red01.test.ts (14 tests | 3 failed)  ← PRE-EXISTING BASELINE
```

### Regression delta (whole `src/sdk/__tests__` scope)

BASE: 34 failures. FINAL: 34 failures. **DELTA: identical set (zero
regressions, zero new failures).**

### Harness-fidelity repairs (test-only)

The C10CDAP01 change made two pre-existing harness gaps VISIBLE, because
the marker now travels on the production UPDATE channel
(`emitHookMessage`) instead of the PUBLISH channel (`appendAndEmit`):

- `completion-presentation-authority01.cpa01.test.ts` and
  `task-terminal-divergence-red01.tdd-red01.test.ts` did not model
  `emitHookMessage` at all, and read the visible rows from the raw
  `appendAndEmit` call list instead of the MESSAGE STORE. They now model
  both production channels and read the store (production
  upsert-by-`ts` semantics), which is the faithful projection.
- `completion-presentation-authority01.cpa01.test.ts` was also MISSING
  the required Elm completion-authority provider
  (`getElmCompletionAuthorityDecision`), so EVERY turn in that file had
  its C10 commit suppressed. The provider is now injected explicitly
  (AUTHORIZE), which is what the suite's own assertions
  (`completionCommitCount() === 1`) already required. This FIXED 7
  pre-existing failures in that file.

## Gates

| Gate | Result |
|---|---|
| Focused suite (8 files) | 229 passed, 3 failed — the 3 are the EXACT pre-existing `tdd-red01` baseline failures (verified identical by name) |
| Whole `src/sdk/__tests__` regression | 34 → 34, identical failure set. **Zero delta.** |
| Webview `terminalReportFraming.test.ts` | 40 passed |
| Webview `messageReducer.test.ts` | 16 passed |
| Webview `CompletionOutputRow.test.tsx` | 19 passed |
| Extension typecheck (`tsc --noEmit`) | PASS (exit 0) |
| Webview typecheck (`tsc --noEmit`) | PASS (exit 0) |
| Lint (`biome lint --diagnostic-level=error`) | PASS (exit 0, 2292 files) |
| Live dogfood task | NOT EXECUTED — unchanged from the predecessor ACT (no LLM provider credential in this sandbox; the canonical profile is READ-ONLY). Live evidence is explicitly PENDING and is NOT claimed. |
