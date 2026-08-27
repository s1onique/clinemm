# ACT-CLINEMM-E7.1-STATIC-THINKING-PRESENTATION-PERSISTENCE01 — Re-closure (current HEAD)

## Verdict

```text
VERDICT = CLOSED_NOT_REPRODUCED
```

The current OPEN ledger row in `.factory/epics/task-presentation.md`
(line 34) is **stale/reconstructed ledger state**, not genuine
unfinished work.

A historical execution of this exact ACT at `08bd6bb75` (Thu Aug 20 2026,
~14 days before this execution) reached the same verdict, added
STP01..STP08 regression guards, and was followed by a board correction
at `8b62e164` that moved the row from OPEN to CLOSED. The post-sharding
board rebuild at `0b949b28e` (Wed Aug 26 2026) re-listed the row as OPEN
because the prior board correction landed in a stale sub-board that was
later consolidated.

This ACT re-executes the same reconciliation against current HEAD
(commit `20cc7c4d`, 8 commits after the historical closure). The
post-E7.1 canonical projection `thinkingPresentation.modelStreaming`
is still the single source of truth for every active Thinking consumer
in the webview. No new RED discriminator can resurrect stale Thinking
presentation when `modelStreaming === false`. STP01..STP08 still pass
unchanged. The publication path was further hardened by `37e62d04e`
(AOC02 PHASE B REPAIR01-CORRECTION01) which added
`applyPresentationProjections` monotonic-`.seq` fencing in
`ExtensionStateContext.tsx` — a stale later-arriving same-epoch
snapshot cannot downgrade `thinkingPresentation` or
`taskHeaderPresentation`.

```text
PRODUCTION_DELTA = 0 (no production source modified)
TEST_DELTA       = 0 (STP01..STP08 already present and passing)
DOCS_DELTA       = 1 evidence file + 2 board-row updates
```

## Why the historical verdict holds on current HEAD

### 1. The E7.1 cutover (committed `6a4cfe564`) already established a single canonical authority.

Every active Thinking consumer in the webview threads through
`thinkingPresentation.modelStreaming` as the primary authority, with
`turnState.phase === "streaming"` as the documented legacy fallback:

| Consumer                                 | File:Line                              | Authority                                              |
|------------------------------------------|----------------------------------------|--------------------------------------------------------|
| In-list loader row (Virtuoso WAITING_ROW)| `useThinkingLoaderRow.ts:53-101`        | `thinkingPresentation.modelStreaming ?? (turnState.phase === "streaming")` |
| Empty-list overlay (cold-mount fast path)| `MessagesArea.tsx:9-25, 90-121`        | same hook                                               |
| Inline `api_req_started` shimmer         | `RequestStartRow.tsx:208-332`          | `thinkingPresentation.modelStreaming ?? turnStateIsStreaming` |
| Inline `ChatRow` reasoning row title     | `ChatRow.tsx:931-947`                  | `messageTailStreaming && canonicalModelStreaming` (BOTH required) |

This is exhaustive for in-scope surfaces. `TaskHeader` is excluded by the
ACT contract (§5, §17) and owned by separate EPICs.

### 2. The publication seam was hardened post-E7.1.

Between the historical E7.1 closure (`08bd6bb75`) and current HEAD
(`20cc7c4d`), the ACT-CLINEMM-APPLICATION-OWNERSHIP-PROJECTION-COHERENCE01
epic produced two strengthening layers for `thinkingPresentation`:

- **`93b753311`** added the `applyPresentationProjections` reducer helper
  with per-field monotonic `.seq` gating (`messageReducer.ts:116-156`).
- **`37e62d04e`** (PHASE B REPAIR01-CORRECTION01) wired the helper into
  `ExtensionStateContext.tsx:702-765` so that:
  - a same-epoch stale snapshot cannot downgrade
    `thinkingPresentation` (mirrors the existing `applyTurnState` gate),
  - a lower `stateVersion` backstop preserves the committed projections
    wholesale (PBR04 chronology fix),
  - a wholesale `resetTo` (CTRL-E) bypasses both fences and accepts
    the new authoritative truth.

This means a stale later-arriving same-epoch snapshot — the canonical
"post-terminal authority split" discriminator the ACT §7.1 STP08 was
designed to catch — physically cannot resurrect Thinking after the
canonical projection says `modelStreaming === false`.

### 3. STP01..STP08 pass unchanged on HEAD.

`apps/vscode/webview-ui/src/components/chat/chat-view/hooks/useThinkingLoaderRow.test.tsx`
line 411-490 contains all 8 STP guards (the same `describe` block added
in `08bd6bb75`). They target the pure helper `computeIsWaitingForResponse`,
which is exactly the seam that matters. Current-HEAD run:

```text
✓ src/components/chat/chat-view/hooks/useThinkingLoaderRow.test.tsx (38 tests) 8ms
  38 tests pass including STP01..STP08
```

All 38 tests pass unchanged. No bypass was introduced.

### 4. Component-level reasoning tests pass at every Thinking surface.

```text
✓ src/components/chat/terminalReportFraming.test.ts (40 tests)
✓ src/components/chat/__tests__/RequestStartRow.turnState-lifecycle.test.tsx (9 tests)
✓ src/components/chat/__tests__/RequestStartRow.turnState-lifecycle.mutations.test.tsx (8 tests)
✓ src/components/chat/__tests__/ChatRow.reasoning-lifecycle.test.tsx (3 tests)
✓ src/components/chat/__tests__/ChatRow.reasoning-lifecycle.mutations.test.tsx (6 tests)
✓ src/components/chat/__tests__/RequestStartRow.context-only.test.tsx (3 tests)
✓ src/components/chat/chat-view/__tests__/application-ownership-control-coherence.aoc01.test.tsx (4 tests)
✓ src/components/chat/chat-view/__tests__/application-ownership-control-coherence.aoc02.section6.test.tsx (4 tests)
✓ src/components/chat/ThinkingRow.test.tsx (2 tests, passes in isolation)
```

These cover every Thinking-presenting surface, including the LIVE02
"shimmer does NOT reappear after cost lands even with assistant report
visible" pin and the AOC02 partial-subscription discriminator.

### 5. The historical LIVE-E71-R1 walk's static row is intentional, not the defect.

The historical witness at
`docs/architecture/elm/LIVE-E71-R1-red-witness.md` observed a static
"Thinking" row rendered above the assistant's final report. This is
the historical `<ThinkingRow title="Thinking">` reasoning-content
disclosure row (NOT the animated "Thinking..." loader). The
loader/shimmer surface is governed by the canonical projection; the
content disclosure is intentionally always rendered for completed
reasoning (per `ChatRow.tsx:947`: `title={isReasoningStreaming ? "Thinking..." : "Thinking"}`).

Removing the content disclosure would delete historical reasoning —
a direct violation of the ACT's §20 conservation rule.

## Why the board remained/re-became OPEN

Timeline:

```text
08bd6bb75   Thu Aug 20  15:46   E7.1 closure: VERDICT=NOT_REPRODUCED + STP01..STP08 added
8b62e164    Thu Aug 20  16:16   board row corrected OPEN→CLOSED (in a stale sub-board)
0b949b28e   Wed Aug 26  00:30   board sharding rebuild re-listed the row as OPEN because
                                the prior correction was in a stale board path
                                (verbatim-fenced historical detail was preserved but
                                the ACT-ledger row was reconstructed from the source
                                lines, which still said "OPEN" pre-correction)
```

This is exactly the "previously proven CLOSED_NOT_REPRODUCED result
lost/reopened during later board reconstruction" condition the ACT §2.1
calls out.

## Production change required

None. The current HEAD's `thinkingPresentation`-gated consumer seam
already implements the central invariant. Adding another boolean
authority (`isActuallyThinking`, `showThinking`, `hasThinkingRow`,
`thinkingPersisted`) would be a regression — the ACT §3 explicitly
forbids it unless recon proves an independent semantic dimension
exists.

## Test changes required

None. STP01..STP08 already exist on HEAD and pass. Per ACT §14:
**DO NOT ADD DUPLICATE STP09..STP16 TESTS** — the existing matrix is
the regression evidence.

## Quality gates (this execution)

| Gate                                                | Status | Evidence                                       |
|-----------------------------------------------------|--------|------------------------------------------------|
| Targeted vitest (useThinkingLoaderRow)              | PASS   | 38/38 tests, 0 failures                        |
| Component-level reasoning tests                     | PASS   | 9 files, 79 tests, 0 failures (in isolation)   |
| AOC02 PHASE B section 6 partial-subscription        | PASS   | 4/4 tests, 0 failures                          |
| AOC01 production-seam coherence                     | PASS   | 4/4 tests, 0 failures                          |
| apps/vscode typecheck (`bun run check-types`)       | PASS   | EXIT=0                                         |
| Bun unit tests (`bun scripts/run-bun-unit-tests.ts`)| PASS   | 1073/1076 (3 pre-existing port-availability failures in auth-callback-url.test.ts, unrelated) |
| git diff --check                                    | PASS   | clean                                          |
| git status --short (production)                     | PASS   | clean (only log artifacts untracked)           |
| Worktree-clean entry/exit                           | PASS   | entry clean, exit clean (only this evidence + log files) |

The pre-existing `auth-callback-url.test.ts` failures (3) are
environmental: `No available port found for local auth callback
(tried 48801-48811)`. The test file was last touched in the npm→bun
migration commit (`82d1846a4`); no changes since then. This is a
macOS sandbox port-availability artifact, NOT introduced by this ACT
and not in scope.

Pre-existing bulk-run webview failures (TaskHeader tests, OpenAI
provider tests, etc.) are owned by separate ACTs (THCP01 migration,
provider settings tests). They reproduce identically with the
ACT-empty baseline and are not in scope here.

## Acceptance criteria (§21)

```text
[x] Historical exact-ACT closure has been found (08bd6bb75).
[x] Current OPEN-vs-historical-CLOSED contradiction is explained
    (post-sharding board rebuild).
[x] Every current active Thinking consumer is inventoried.
[x] Canonical Thinking presentation authority is identified from code
    (thinkingPresentation.modelStreaming ?? turnState.phase === "streaming").
[x] Runtime stall and stale presentation are explicitly discriminated
    (RUNTIME_THINKING_STALL lives under
     .factory/epics/runtime-task-progression.md per correction04).
[x] STP01..STP08 exist or equivalent coverage is proven (exist + pass).
[x] modelStreaming=false + stale phase=streaming cannot resurrect Thinking
    (STP08).
[x] modelStreaming=true still renders legitimate Thinking (STP07).
[x] Historical reasoning is not destroyed (conservation; ThinkingRow).
[x] TaskHeader projection/timing scopes remain untouched.
[x] Runtime task progression remains untouched.
[x] No speculative production change is made (PRODUCTION_DELTA = 0).
[x] Tests/typecheck/lint/workspace gates are classified with evidence.
[x] git diff --check passes (clean).
[x] Closure evidence binds to the actual test/production range
    (08bd6bb75..HEAD for consumer surface, 93b753311 + 37e62d04e for
    publication hardening).
[x] Board status matches the proven result (updated in this ACT).
```

## Files changed by this ACT

```text
docs/architecture/elm/task-state-e71-static-thinking-presentation-persistence01-reclosure.md
    (new — durable evidence artifact, the canonical closure claim)

.factory/epics/task-presentation.md
    (board row 34: OPEN → CLOSED_NOT_REPRODUCED + new evidence link)
    (open-work section: 4 items → 3 items; this ACT exits the open list)

.factory/epic-board.md
    (family-level row 36: "3 task-header projection items OPEN"
     → "2 task-header projection items OPEN" because this ACT
     is no longer in the family frontier)

PRODUCTION_DELTA = 0
TEST_DELTA       = 0
DOCS_DELTA       = 3 files (1 evidence + 2 board updates)
```

## References

- `docs/architecture/elm/task-state-e71-static-thinking-presentation-persistence01-evidence.md`
  (original 08bd6bb75 evidence — still accurate, this ACT re-validates it)
- `apps/vscode/webview-ui/src/components/chat/chat-view/hooks/useThinkingLoaderRow.test.tsx:411-490`
  (STP01..STP08)
- `apps/vscode/webview-ui/src/components/chat/chat-view/hooks/useThinkingLoaderRow.ts:53-101`
  (the shadow-path `computeIsWaitingForResponse` projection)
- `apps/vscode/webview-ui/src/components/chat/chat-view/messageReducer.ts:116-156`
  (the `applyPresentationProjection` monotonic-seq gate)
- `apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx:702-765`
  (the W1 functional updater that wires the gate)
- Commit `08bd6bb75` (historical E7.1 closure)
- Commits `93b753311`, `37e62d04e`, `b3a950554`, `8ec422210`, `a1610b072`,
  `149fb131e` (post-E7.1 hardening of the presentation projection)
- `.factory/epics/runtime-task-progression.md` (where genuine runtime
  thinking stalls — `RUNTIME_THINKING_STALL` — are tracked; NOT
  a presentation defect)

## Next recommended ACT

After this closure, the next task-presentation slice is:

```text
EPIC-CLINEMM-TASKHEADER-CANONICAL-PROJECTION01
```

Do not start owner-aware timer semantics (`TASKHEADER-OWNER-AWARE-TIMING01`)
until canonical TaskHeader projection correctness is established.
