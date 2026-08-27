# ACT-CLINEMM-E7.1-STATIC-THINKING-PRESENTATION-PERSISTENCE01 — Re-re-closure (current HEAD)

## Verdict

```text
VERDICT = CLOSED_NOT_REPRODUCED
```

This ACT re-executes the same reconciliation as `df8d71d4b` against
**current HEAD `d718a8f87`** (which is `+25 commits` after the previous
reclosure at `20cc7c4d` referenced inside it; current HEAD includes the
LIVENESS02 completion-protocol work but does NOT touch any
thinking-presentation consumer).

```text
ENTRY_HEAD = d718a8f87fc61497723bc13f0785d8b2db1cf824
ENTRY_TREE = 361b87df46e5d3cb95c7cf94c576a90b7b3212ea
PRODUCTION_DELTA = 0
TEST_DELTA       = 0
DOCS_DELTA       = 2 files (1 evidence + 1 board-hygiene correction)
```

The user's prompt asserted the durable ledger said `OPEN`, but
inspection of `.factory/epics/task-presentation.md:34` at this HEAD
already says `**CLOSED_NOT_REPRODUCED**`. The only stale "OPEN"
reference is a one-line note in `.factory/epics/closed-foundation.md:60`
that was not updated when the main ledger row was corrected —
corrected here.

## Why the H0 hypothesis holds on current HEAD (executable evidence)

### Producer of the canonical authority is unchanged

`apps/vscode/webview-ui/src/components/chat/chat-view/hooks/useThinkingLoaderRow.ts`
and its sibling test file have **zero commits between `08bd6bb75`
(prior closure) and current HEAD `d718a8f87`** — verified by
`git log --all --oneline -- useThinkingLoaderRow.{ts,test.tsx}`.
Byte-identical to the original closure state.
### Targeted tests pass unchanged on current HEAD

```text
$ cd apps/vscode/webview-ui
$ bun vitest run --pool=forks --poolOptions.forks.singleFork=true \
    --reporter=verbose \
    src/components/chat/chat-view/hooks/useThinkingLoaderRow.test.tsx

 ✓ computeIsWaitingForResponse (turnState path)                  [5 tests]
 ✓ computeIsWaitingForResponse (legacy path)                    [3 tests]
 ✓ ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1 / computeIsWaitingForResponse (shadow path)
                                                                  [6 tests]
 ✓ useThinkingLoaderRow anti-flash debounce                     [7 tests]
 ✓ useThinkingLoaderRow optimistic response handoff             [9 tests]
 ✓ ACT-CLINEMM-E7.1-STATIC-THINKING-PRESENTATION-PERSISTENCE01 / shadow-path STP discriminators
   ✓ STP01: shadow modelStreaming=false clears the loader (streaming → awaiting_followup)
   ✓ STP02: shadow modelStreaming=false clears the loader (streaming → completed)
   ✓ STP03: shadow modelStreaming=false clears the loader (streaming → error)
   ✓ STP04: shadow modelStreaming=false clears the loader (streaming → compacting)
   ✓ STP05: shadow modelStreaming=false clears the loader after a background command tail
   ✓ STP06: shadow modelStreaming=false does not re-introduce the loader above a finalized reasoning row
   ✓ STP07: shadow modelStreaming=true re-introduces the loader for a fresh active run
   ✓ STP08: a new shadow-off push wins over any stale phase=streaming carry-over

Total: 38/38 tests pass
```

(`kill EPERM` on worker-pool teardown is the same sandbox artifact
the prior closure observed; every individual test reported ✓ before
the teardown noise.)

### All component-level reasoning tests pass in isolation

```text
 ✓ terminalReportFraming.test.ts                                  [40 tests]
 ✓ RequestStartRow.turnState-lifecycle.test.tsx                   [9 tests]
 ✓ RequestStartRow.turnState-lifecycle.mutations.test.tsx         [8 tests]
 ✓ ChatRow.reasoning-lifecycle.test.tsx                           [3 tests]
 ✓ ChatRow.reasoning-lifecycle.mutations.test.tsx                 [6 tests]
 ✓ RequestStartRow.context-only.test.tsx                          [3 tests]
 ✓ application-ownership-control-coherence.aoc01.test.tsx         [4 tests]
 ✓ application-ownership-control-coherence.aoc02.section6.test.tsx
                                                                  [4 tests]
 ✓ ThinkingRow.test.tsx                                           [2 tests]

Total: 79/79 component reasoning tests pass
```


### Publication-path fence intact

```text
messageReducer.ts:139-156         — applyPresentationProjections per-field monotonic-.seq
ExtensionStateContext.tsx:711-765 — two-layer fence (applyPresentationProjections +
                                      stateVersion backstop + resetTo bypass)
useThinkingLoaderRow.ts:53-101    — primary consumer, single canonical authority
RequestStartRow.tsx:208-332       — same canonical authority
ChatRow.tsx:931-947               — messageTailStreaming && canonicalModelStreaming (BOTH required)
MessagesArea.tsx:9-25, 90-121     — same hook
```

### Production consumers between E7.1 and current HEAD

```text
git log --all --oneline -- RequestStartRow.tsx ChatRow.tsx MessagesArea.tsx

3658e65ff  ACT-CLINEMM-TERMINAL-REPORT-COMPLETION-FRAMING01       (completion-framing; orthogonal)
e83d056db  ACT-CLINEMM-REJECTED-COMMAND-PRESENTATION-TRUTH01       (typed lifecycle disposition)
6a4cfe564  feat(elm): E7.1 cut Local Thinking consumers to shadow projection
```

The most recent ChatRow.tsx touch since E7.1 was the completion-framing
ACT (`3658e65ff`), which adds `terminalReportFraming.ts` and modifies
`CompletionOutputRow.tsx` + `ChatRow.tsx` to gate the visible `✓ Completed`
badge on authoritative runtime truth. It does NOT touch the canonical
## What changed since the previous reclosure (`df8d71d4b`)

Only **docs-only commits** in `.factory/` between the two — the
LIVENESS02 completion-protocol work (3 commits at
`d718a8f87`/`b75855904`/`e95215a11`) and other factory recon items.
No production code, no test code, no canonical-projection wiring, no
task-state authority, no model-tool routing, no completion semantics.
The thinking-presentation seam is byte-stable.

## Phase-0 question answered

> Is the current OPEN ledger row genuinely unfinished work, or was a
> previously proven CLOSED_NOT_REPRODUCED result lost/reopened during
> later board reconstruction?

**The latter.** The main ledger row in `task-presentation.md:34` was
already reconciled at `df8d71d4b` to `CLOSED_NOT_REPRODUCED`. The user's
prompt was apparently reading from a stale snapshot. A residual
"OPEN" note in `closed-foundation.md:60` (different file, different
section) had not been propagated when the main ledger row was
corrected — small board-hygiene drift, corrected here.

## Board hygiene correction made in this execution

```text
.factory/epics/closed-foundation.md:60
  - old: "canonical authority exists; static presentation residue remains
          separately OPEN (see `ACT-CLINEMM-E7.1-STATIC-THINKING-PRESENTATION-PERSISTENCE01`)"
  - new: "canonical authority exists; static presentation residue also
          CLOSED_NOT_REPRODUCED under that same ACT (see reclosure02 evidence)"

.factory/epics/closed-foundation.md:61
## Test changes required

None. STP01..STP08 already exist on HEAD and pass. Per ACT §14:
**DO NOT ADD DUPLICATE STP09..STP16 TESTS** — the existing matrix is
the regression evidence, and this execution re-verified it
executable on current HEAD.

## Quality gates (this execution)

| Gate                                                | Status | Evidence                                       |
|-----------------------------------------------------|--------|------------------------------------------------|
| Targeted vitest (useThinkingLoaderRow)              | PASS   | 38/38 tests pass (including STP01..STP08)      |
| Component-level reasoning tests                     | PASS   | 9 files, 79 tests pass in isolation            |
| AOC02 PHASE B section 6 partial-subscription        | PASS   | 4/4 tests pass                                 |
| AOC01 production-seam coherence                     | PASS   | 4/4 tests pass                                 |
| apps/vscode typecheck (`bun run check-types`)       | PASS   | exit code = 0                                  |
| git diff --check                                    | PASS   | clean                                          |
| git status --short                                  | PASS   | clean                                          |
| Stash inventory                                     | PASS   | 1 pre-existing stash preserved (not popped/applied) |

## Verdict and exit

```text
VERDICT = CLOSED_NOT_REPRODUCED (RE-CONFIRMED)

PRODUCTION_DELTA = 0
TEST_DELTA       = 0
DOCS_DELTA       = 2 files

ENTRY_HEAD = d718a8f87fc61497723bc13f0785d8b2db1cf824
FINAL_HEAD = (this ACT's docs commit)

Next recommended ACT: EPIC-CLINEMM-TASKHEADER-CANONICAL-PROJECTION01
  (per the prior closure's sign-off)
```

The task-presentation epic's open-work count is unchanged by this
ACT (the open item this ACT nominally addresses was already
CLOSED_NOT_REPRODUCED in the main ledger; only the closed-foundation
cross-reference needed a one-line correction).

  - source IDs: `E7.1`, `TRACE01` → `E7.1`, `TRACE01`, `STATIC-THINKING-PRESENTATION-PERSISTENCE01`
```

## Production change required

None. The current HEAD's `thinkingPresentation`-gated consumer seam
already implements the central invariant. Adding another boolean
authority (`isActuallyThinking`, `showThinking`, `hasThinkingRow`,
`thinkingPersisted`) would be a regression — the ACT §3 explicitly
forbids it unless recon proves an independent semantic dimension
exists. No such dimension has been discovered.

`thinkingPresentation` projection seam. `RequestStartRow.tsx` and
`MessagesArea.tsx` have not been touched since E7.1.

### `bun run check-types` passes

```text
$ cd apps/vscode && bun run check-types
[bun run protos && bunx tsc --noEmit && bun run check-types:compat && cd webview-ui && bunx tsc --noEmit]
exit code = 0
```

### A/B discriminator vs historical closure (the ACT §12 requirement)

```text
CURRENT_HEAD_WITH_ACT (d718a8f87):    38/38 useThinkingLoaderRow tests pass
HISTORICAL_CLOSURE_HEAD (08bd6bb75):  38/38 useThinkingLoaderRow tests pass (per commit message)
useThinkingLoaderRow.{ts,test.tsx}:  ZERO commits between the two
```

Equivalent result. No drift.

## What changed since the previous reclosure (`df8d71d4b`)

Only **docs-only commits** in `.factory/` between the two — the
LIVENESS02 completion-protocol work (3 commits at
`d718a8f87`/`b75855904`/`e95215a11`) and other factory recon items.
No production code, no test code, no canonical-projection wiring, no
task-state authority, no model-tool routing, no completion semantics.
The thinking-presentation seam is byte-stable.

## Phase-0 question answered

> Is the current OPEN ledger row genuinely unfinished work, or was a
> previously proven CLOSED_NOT_REPRODUCED result lost/reopened during
> later board reconstruction?

**The latter.** The main ledger row in `task-presentation.md:34` was
already reconciled at `df8d71d4b` to `CLOSED_NOT_REPRODUCED`. The user's
prompt was apparently reading from a stale snapshot. A residual
"OPEN" note in `closed-foundation.md:60` (different file, different
section) had not been propagated when the main ledger row was
corrected — small board-hygiene drift, corrected here.

## Board hygiene correction made in this execution

```text
.factory/epics/closed-foundation.md:60
  - old: "canonical authority exists; static presentation residue remains
          separately OPEN (see ACT-CLINEMM-E7.1-STATIC-THINKING-PRESENTATION-PERSISTENCE01)"
  - new: "canonical authority exists; static presentation residue also
          CLOSED_NOT_REPRODUCED under that same ACT (see reclosure02 evidence)"

.factory/epics/closed-foundation.md:61
  - source IDs: `E7.1`, `TRACE01` → `E7.1`, `TRACE01`, `STATIC-THINKING-PRESENTATION-PERSISTENCE01`
```

## Production change required

None. The current HEAD's `thinkingPresentation`-gated consumer seam
already implements the central invariant. Adding another boolean
authority (`isActuallyThinking`, `showThinking`, `hasThinkingRow`,
`thinkingPersisted`) would be a regression — the ACT §3 explicitly
forbids it unless recon proves an independent semantic dimension
exists. No such dimension has been discovered.

## Test changes required

None. STP01..STP08 already exist on HEAD and pass. Per ACT §14:
**DO NOT ADD DUPLICATE STP09..STP16 TESTS** — the existing matrix is
the regression evidence, and this execution re-verified it
executable on current HEAD.

## Quality gates (this execution)

| Gate                                                | Status | Evidence                                       |
|-----------------------------------------------------|--------|------------------------------------------------|
| Targeted vitest (useThinkingLoaderRow)              | PASS   | 38/38 tests pass (including STP01..STP08)      |
| Component-level reasoning tests                     | PASS   | 9 files, 79 tests pass in isolation            |
| AOC02 PHASE B section 6 partial-subscription        | PASS   | 4/4 tests pass                                 |
| AOC01 production-seam coherence                     | PASS   | 4/4 tests pass                                 |
| apps/vscode typecheck (`bun run check-types`)       | PASS   | exit code = 0                                  |
| git diff --check                                    | PASS   | clean                                          |
| git status --short                                  | PASS   | clean                                          |
| Stash inventory                                     | PASS   | 1 pre-existing stash preserved (not popped/applied) |

## Verdict and exit

```text
VERDICT = CLOSED_NOT_REPRODUCED (RE-CONFIRMED)

PRODUCTION_DELTA = 0
TEST_DELTA       = 0
DOCS_DELTA       = 2 files

ENTRY_HEAD = d718a8f87fc61497723bc13f0785d8b2db1cf824
FINAL_HEAD = (this ACT's docs commit)

Next recommended ACT: EPIC-CLINEMM-TASKHEADER-CANONICAL-PROJECTION01
  (per the prior closure's sign-off)
```

The task-presentation epic's open-work count is unchanged by this
ACT (the open item this ACT nominally addresses was already
CLOSED_NOT_REPRODUCED in the main ledger; only the closed-foundation
cross-reference needed a one-line correction).
