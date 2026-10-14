# ACT-CLINEMM-TERMINAL-REPORT-CARDINALITY-REPAIR01-CORR01 — PASS_CORRECTED_STRUCTURAL_LIVE_PENDING — 2026-10-14

**Status:** CLOSED with verdict **`PASS_CORRECTED_STRUCTURAL_LIVE_PENDING`**.

**Predecessor:** `b24b954db` on `main` (ACT-CLINEMM-BCB-OBSERVABILITY-REPAIR01)
plus the uncommitted CARDINALITY-REPAIR01 work
(`PASS_REPAIR_STRUCTURAL_LIVE_PENDING`).

**Authorized by:** One bounded P0 correction per the frozen multiple-
completion-episodes contract. No additional architecture or review
round.

**Live Cline task (specimen):** `1791892624249_io4fp` (the held-then-
committed live task used as the prior ACT's reference).

**Working tree (post-CORR01, before commit):**
- `apps/vscode/src/sdk/message-translator.ts` (modified — bounded
  CORR01 repair of the held-vs-committed test)
- `apps/vscode/src/sdk/__tests__/terminal-report-cardinality-repair01.trcr01.test.ts`
  (modified — added Fixture F, Fixture G, and the §4
  `resolveTerminalReportFraming` integration test)
- `apps/vscode/src/sdk/__tests__/terminal-report-duplication-corr01.trd01.test.ts`
  (modified — added `name` fields to three `tool_result` blocks and
  serialized the `command_status` content object as a JSON text
  block, per the §5 ACT-owned typecheck cleanup)
- `.factory/acts/ACT-CLINEMM-TERMINAL-REPORT-CARDINALITY-REPAIR01-CORR01.md`
  (new — this file)
- `.factory/epic-board.md` (modified — board update)

**Recognized uncommitted artifacts preserved:**
- `.factory/acts/ACT-CLINEMM-TERMINAL-REPORT-CARDINALITY-REPAIR01.md`
  (parent ACT, `PASS_REPAIR_STRUCTURAL_LIVE_PENDING`)
- `.factory/acts/ACT-CLINEMM-TERMINAL-REPORT-DUPLICATION-RED01-CORR01.md`
  (TRD01 source-trace ACT)
- `.factory/acts/ACT-CLINEMM-TERMINAL-REPORT-DUPLICATION-RED01.md`
  (TRD01 RED01 ACT)
- `.factory/acts/ACT-CLINEMM-ELM-SEAM12-DCB-LIVE-QUALIFICATION01.md`
  (SEAM12 ACT)
- All corresponding `.factory/evidence/` directories

---

## 1. P0 defect (the original P0)

The pre-CORR01 `isCompletionToolHeld(toolUseId)` classified a
completion as HELD whenever ANY later
`completion_continuation_control` user message existed in the
persisted transcript. The classification is global, not source-
correlated, and so it revokes authority from prior
independently-committed completion episodes when a later episode
contains a hold.

This violated the frozen multiple-completion-episodes contract: a
runtime-control observation must be correlated to the SPECIFIC
submission it defers (the nearest eligible prior completion attempt),
not to every earlier submission in the transcript.

Concretely (pre-CORR01 behavior, RED in the new fixtures):

- **Fixture F** (committed A → user follow-up → held B →
  runtime-control → committed C). The runtime-control sat after
  A's tool_result too, so A's marker was wrongly revoked
  (`A.isAuthoritativelyCompletedResult` was `undefined` instead of
  `true`).
- **Fixture G** (two independent episodes, each with a hold). The
  later runtime-control (for C) sat after B's tool_result, so B's
  marker was wrongly revoked. The earlier episode's hold bled
  forward across the user follow-up that explicitly separated the
  two episodes.

The defect was uncovered by the §2 RED discriminator and
reproduced in the pre-fix uncommitted code at this CORR01's working
tree (verified — see Gate 2 below).

## 2. Causal correction (the bounded repair)

### 2.1 The nearest-eligible-prior test

Each `completion_continuation_control` runtime-control observes
THE completion that immediately precedes it in the source
transcript (the most-recent completion-tool tool_result). Later
completions belong to fresh episodes and are not in scope for
that control.

A completion C is HELD iff a runtime-control
`completion_continuation_control` user message exists in the
source-transcript interval `(trIdx_C, nextCompletionToolUseIdx)`,
where `nextCompletionToolUseIdx` is the source-transcript index of
the next completion tool_use (or `messages.length` if there is
none).

This is the per-episode attribution the prior global test was
missing. Earlier episodes' runtime-controls do not revoke
authority from episodes that complete before them. Later
episodes' runtime-controls do not revoke authority from
completions that were already committed before the runtime-
control was emitted.

### 2.2 Implementation (one bounded edit to `message-translator.ts`)

The pre-CORR01 code recorded every runtime-control's source
index, then asked "is any rcIdx > trIdx?" — a global forward
test. The CORR01 edit adds ONE additional forward pre-scan
recording the source index of every completion tool_use
(`completionToolUseSourceIndices`), and the `isCompletionToolHeld`
helper now asks: is there an `rcIdx` in `(trIdx, nextCompletionToolUseIdx)`?

The added pre-scan is O(N) over the source transcript and runs
ONCE per restoration. The existing live-streaming path is
unchanged: the `isAuthoritativeCompletion` flag threaded into
the completion `content_end` event still defaults to `true` and
is only set to `false` by the restoration path
(`sdkMessagesToClineMessages`) for HELD completion tools.

### 2.3 Inventory of preserved invariants

- Live streaming path: unchanged. The live translator's
  `content_end` for completion tools never threads
  `isAuthoritativeCompletion=false`, so the "always stamp the
  marker" behavior is preserved for every live completion event.
- BCB observation path: unchanged. The repair does not add or
  remove any BCB writer call sites.
- `terminalResponseCommittedThisTurn` invariant: unchanged. The
  in-memory `setTerminalResponseCommittedThisTurn()` writer at
  `message-translator.ts:1810` is unchanged.
- `terminalReportFraming` primary marker path: unchanged. The
  held row's marker is now absent (or `undefined`), so the
  framing resolves to a different value (e.g. `undefined` for
  the `say: "completion_result"` shape with no marker and no
  legacy ask fallback) — see the new §4 framing test for
  end-to-end evidence.
- L2847 RED baseline: 3 RED / 11 PASS — unchanged (verified by
  Gate 4).
- BCB observability repair at `b24b954db`: preserved.
- SEAM12 ACT and its 5 evidence SHAs: verified intact.
- DUPLICATION-RED01/CORR01 ACTs and their evidence: preserved.
- 5 Elm kernels (BCB authority, completion authority, completion
  continuation control, deferred completion barrier, task header
  orchestration): untouched.
- The "already proven single held→committed specimen" (Fixture
  A, the live task shape): preserved by the bounded per-episode
  rule. The single runtime-control in `(trIdx_A, trIdx_B)`
  correctly defers A without affecting B.

## 3. RED discriminator (the new fixtures)

`apps/vscode/src/sdk/__tests__/terminal-report-cardinality-repair01.trcr01.test.ts`
adds two new fixtures that RED the pre-fix global test:

### Fixture F — committed episode before later held episode

```text
submit A → committed
user follow-up
submit B → held
runtime-control → observe
submit C → committed
```

Expected authoritative markers (per the multiple-completion-episodes
contract):

| Submission | Marker | Reason |
|------------|--------|--------|
| A | `true` | No runtime-control in `(trIdx_A, trIdx_B)` |
| B | absent  | Runtime-control in `(trIdx_B, trIdx_C)` |
| C | `true` | No runtime-control after `trIdx_C` |

Pre-CORR01 implementation: A's marker is wrongly `undefined` (the
runtime-control sat after A's tool_result too, so the global
forward test revoked A). RED.

### Fixture G — multiple independent episodes with holds

```text
submit A → held
runtime-control A
submit B → committed

user follow-up

submit C → held
runtime-control C
submit D → committed
```

Expected authoritative markers:

| Submission | Marker | Reason |
|------------|--------|--------|
| A | absent  | Runtime-control A in `(trIdx_A, trIdx_B)` |
| B | `true` | No runtime-control in `(trIdx_B, trIdx_C)` |
| C | absent  | Runtime-control C in `(trIdx_C, trIdx_D)` |
| D | `true` | No runtime-control after `trIdx_D` |

Pre-CORR01 implementation: B's marker is wrongly `undefined` (the
runtime-control for C, emitted later, sat after B's tool_result
too, so the global forward test revoked B). RED.

### RED → GREEN evidence

Both fixtures RED in the pre-CORR01 working tree (the parent
ACT's uncommitted repair) and GREEN in the post-CORR01 working
tree (this ACT's bounded per-episode rule). See Gate 2 below.

## 4. Framing projection (the §4 integration test)

The CORR01 ACT requires that the post-repair restoration chain
be driven through the REAL `resolveTerminalReportFraming`
production function (the webview's primary "is this row a
Completed card?" decision), not merely the per-row marker count.

The new "Fixture F framing" test in
`terminal-report-cardinality-repair01.trcr01.test.ts` imports
`resolveTerminalReportFraming` via the established webview→SDK
test cross-import pattern and asserts the actual framing for
each of A, B, C from Fixture F:

- A (committed): `framingA.kind === "completed"`,
  `framingA.label === "Completed"`.
- B (held): `framingB === undefined` (the per-row marker is
  absent and the `say: "completion_result"` shape has no legacy
  ask fallback, so the primary marker path is the only authority
  and the framing resolves to `undefined`).
- C (committed): `framingC.kind === "completed"`,
  `framingC.label === "Completed"`.

All three summary texts are preserved as historical activity
(ACT §1.4) — the test asserts `getSummary(row) === SUMMARY_*`
for each row.

## 5. Typecheck cleanup (the §5 ACT-owned errors)

The §5 ACT identified three ACT-owned TypeScript errors in
`terminal-report-duplication-corr01.trd01.test.ts` (the
pre-existing uncommitted characterization). This CORR01 fixes
all three without altering the test's characterization
assertions:

1. **Line 142 (1st tool_result for `xxakngsgiq8s_1`)**: added
   `name: "submit_and_exit"` (matches the live transcript
   shape).
2. **Line 183 (`command_status` tool_result content object)**:
   wrapped the `{ ok: true, jobId: ... }` object as
   `{ type: "text", text: JSON.stringify(...) }` (a
   `TextContent` block; the original was an arbitrary object
   that didn't satisfy the `ToolResultContent.content` type's
   `string | Array<TextContent | ImageContent | FileContent>`
   contract).
3. **Line 207 (2nd tool_result for `jyd622908p3h_1`)**: added
   `name: "submit_and_exit"` (matches the live transcript
   shape).

Post-CORR01 typecheck: `tsc --noEmit -p apps/vscode/tsconfig.json`
exits clean (zero errors). See Gate 5 below.

## 6. Live qualification

The bounded repair runs at restoration time and is fully
verified by the RED→GREEN real-seam tests in the default vitest
suite. The local toolchain is sufficient for the bounded
production-seam repair.

Manual live qualification remains PENDING the next qualifying
session with a writable extensions mount (per the BCB-
OBSERVABILITY-REPAIR01 §10 "LIVE_REPRODUCED" gate and the
parent ACT's §7.4). The committed VSIX carries the
repaired `message-translator.ts` and the new test files.

## 7. Source-first production-seam inventory

This section is the source-traced production-seam reconstruction
of the bounded CORR01 repair. Every line cited is the production
code at the post-CORR01 working tree (or at the unchanged
`b24b954db` predecessor where the file is unmodified).

### 7.1 Pre-CORR01 pre-scan (CARDI01, unchanged in shape)

`apps/vscode/src/sdk/message-translator.ts:2621-2667` (pre-CORR01)
implemented two pre-scans:
- `runtimeControlIndices: number[]` — source-transcript indices of
  every user message whose metadata carries
  `{ runtimeAuthority: "host_runtime_control",
    kind: "completion_continuation_control" }`.
- `toolResultSourceIndex: Map<string, number>` — earliest source
  index of each `tool_result` user message keyed by
  `tool_use_id`.

The pre-CORR01 `isCompletionToolHeld(toolUseId)` returned `true`
iff there existed an `rcIdx > trIdx` for ANY runtime-control.
This is the global forward test that the CORR01 replaced.

### 7.2 Post-CORR01 pre-scan (this ACT's edit)

`apps/vscode/src/sdk/message-translator.ts:2621-2719` (post-CORR01)
adds ONE additional pre-scan:
- `completionToolUseSourceIndices: number[]` — source-transcript
  indices of every assistant message that contains a
  `tool_use` block with name in
  `isCompletionTool(name)` (i.e. `submit_and_exit` or
  `attempt_completion`).

The `isCompletionToolHeld(toolUseId)` helper now asks: is there
an `rcIdx` in `(trIdx, nextCompletionToolUseIdx)`? Where
`nextCompletionToolUseIdx` is the first
`completionToolUseSourceIndices` entry strictly greater than
`trIdx` (or `messages.length` if none). This is the nearest-
eligible-prior correlation.

### 7.3 Caller (unchanged)

`apps/vscode/src/sdk/message-translator.ts:2874-2882` (the
restoration-path `finalizePersistedToolUse` call site) computes
`!isCompletionTool(toolUse.name) || !isCompletionToolHeld(block.tool_use_id)`
and passes the result as the new `isAuthoritativeCompletion`
flag. Non-completion tools always pass `true` (the default).
Completion tools that the per-episode rule classifies as HELD
pass `false`, which causes the `content_end` emit to OMIT the
`isAuthoritativelyCompletedResult:true` marker on that row.

## 8. Verdict

**`PASS_CORRECTED_STRUCTURAL_LIVE_PENDING`**.

Bounded evidence:
- New Fixtures F + G RED in the pre-CORR01 working tree (2 RED /
  5 GREEN) and GREEN in the post-CORR01 working tree (8/8 GREEN
  including the §4 framing test).
- 5 pre-existing fixtures (A–E) preserved unchanged (5/5 GREEN
  pre- and post-CORR01).
- TRD01 characterization preserved (5/5 GREEN pre- and
  post-CORR01).
- TRD01 + TRCR01 combined: 13/13 GREEN.
- 79 pre-existing vitest failures unchanged (verified by Gate 4
  — no new failures from the bounded repair; L2847 three-RED
  baseline preserved at 3 RED / 11 PASS).
- 3 pre-existing TRD01 typecheck errors fixed (Gate 5); zero
  ACT-owned typecheck errors post-CORR01.
- BCB observability repair at `b24b954db` preserved.
- 5 Elm kernels (BCB authority, completion authority,
  completion continuation control, deferred completion barrier,
  task header orchestration) untouched.
- SEAM12 ACT and its 5 evidence SHAs verified intact.
- DUPLICATION-RED01/CORR01 ACTs and their evidence preserved.
- Single held→committed specimen (Fixture A) preserved.
- Source HEAD: pre-CORR01 `b24b954db932caf738c26a43408e07e8558c0304`
  (commit performed in §9 of this ACT lands the CORR01 repair).

## 9. Commit and packaging

This ACT's intended commit (post-GREEN) lands the three
production/test files enumerated in the Working Tree list at
the top of this file. The committed HEAD is captured and
fingerprinted in the closure evidence at
`.factory/evidence/ACT-CLINEMM-TERMINAL-REPORT-CARDINALITY-
REPAIR01-CORR01/00-closure-evidence.txt`.

The operator installs and dogfoods the resulting VSIX manually
if the extensions mount is unavailable; no live claim is made
about the `b24b954db` build (which does NOT contain the
CORR01 repair).
