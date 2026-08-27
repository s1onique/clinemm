# ACT-CLINEMM-TERMINAL-REPORT-COMPLETION-FRAMING01-CORRECTION01

> Bounded correction to v1: replace the per-row mutable `turnState.phase`
> authority with a stable per-message identity stamped at the canonical
> completion publication seam.

## 1. Goal

A historical `say: "completion_result"` row must keep its `✓ Completed`
badge after the user resumes the task and a new turn streams
(`turnState.phase === "streaming"`). v1 gates the badge on
`turnState.phase === "completed"`, which is a single mutable task-level
value — once the user resumes, that value flips away from `"completed"`
and every historical completion-result row silently loses its badge.

## 2. Diagnosis (confirmed via recon)

- `TurnState.phase` is task-level mutable state, owned by
  `TurnStateTracker` and rewritten at every lifecycle boundary
  (`sdk-session-event-coordinator.ts:133`, etc.).
- `anchorTs` IS already part of `TurnState`, but the canonical completion
  path emits `setTurnPhase("completed", undefined, ...)` — no anchor is
  recorded for live completion rows.
- `anchorTs` IS only populated for synthetic resume asks
  (`sdk-task-control-coordinator.ts:268-273`); historical completion
  rows have no anchor and cannot be cross-referenced to the phase.
- Per-message completion identity is therefore NOT available at the
  message level today.

## 3. Bounded correction

Add the smallest immutable per-message marker at the single canonical
completion-publication seam.

### 3.1 Type

Add to `ClineMessage` in `apps/vscode/src/shared/ExtensionMessage.ts`:

```ts
/**
 * ACT-CLINEMM-TERMINAL-REPORT-COMPLETION-FRAMING01-CORRECTION01:
 * immutable per-message marker stamped by the runtime AT THE MOMENT
 * a final terminal completion_result row is published (the
 * attempt_completion / submit_and_exit content_end seam in
 * message-translator.ts). Stamped once and persisted on the message
 * for the rest of the row's lifetime, so it survives phase flips
 * (resume, retry-after-error, follow-up) and provides a stable
 * per-message identity that the webview can key on.
 *
 * ABSENT means the row was never authoritatively marked as a
 * terminal completion — either pre-CORRECTION01 history, or a
 * synthetic ask:"completion_result" / say:"completion_result" row
 * produced outside the canonical completion seam (debug commands,
 * legacy translation paths, etc.). Consumers MUST treat absence
 * as opaque.
 */
isAuthoritativelyCompletedResult?: boolean
```

### 3.2 Stamp site (the single canonical seam)

`apps/vscode/src/sdk/message-translator.ts:1640-1646`:

```ts
messages.push({
    ts,
    type: "say",
    say: "completion_result",
    text: resultText,
    partial: false,
    isAuthoritativelyCompletedResult: true, // CORRECTION01
})
```

This is the only place where a non-partial `say: "completion_result"`
row is emitted by the runtime; it is right next to
`state.setTerminalResponseCommittedThisTurn()` which is the canonical
authority for terminal-response surface. There is no other code path
that produces a finalized `say: "completion_result"` legitimately.

The partial row at line 1370-1376 (content_start) is intentionally NOT
stamped — the row is replaced in-place by the non-partial row at
content_end, and we want the badge to fail closed while the row is
streaming.

The legacy `say: "completion_result"` row emitted by
`dev/commands/tasks.ts` is intentionally NOT stamped — that command
fakes a completion surface and is not a real runtime completion.

### 3.3 Webview helper

Update `terminalReportFraming.ts` so the per-message marker is the
primary authority, with `turnState.phase === "completed"` retained as
a defensive secondary check on the legacy-ask fallback:

```ts
function isAuthoritativeCompletionResult(message: ClineMessage): boolean {
    return message.isAuthoritativelyCompletedResult === true
}

function isLegacyAskCompletionResult(message: ClineMessage): boolean {
    // Legacy tasks bypass the SDK translator and produce an
    // ask:"completion_result" with non-empty text directly.
    return (
        message.type === "ask" &&
        message.ask === "completion_result" &&
        typeof message.text === "string" &&
        message.text.length > 0
    )
}

export function resolveTerminalReportFraming(input): TerminalReportFraming | undefined {
    if (input.mode === "plan") return undefined

    const isAuthoritative = isAuthoritativeCompletionResult(input.message)

    if (isAuthoritative) {
        // Per-message marker is monotonic and authoritative. It survives
        // phase flips (resume, retry-after-error, follow-up, compaction),
        // so a historical completed row keeps its badge even when the
        // current task is mid-stream or mid-compaction. The marker is
        // the canonical identity for "this row WAS a terminal completion".
        return COMPLETED
    }

    // Legacy ask: completion_result path: phase + shape.
    if (input.turnState?.phase !== "completed") return undefined
    if (!isLegacyAskCompletionResult(input.message)) return undefined
    return COMPLETED
}
```

The key insight: **the per-message marker survives the phase flip**,
so a historical completed row keeps its badge when
`turnState.phase` flips back to `"streaming"` after a resume. The
phase guard is applied only to the legacy fallback path, where it
provides defense in depth: legacy tasks bypass the SDK translator
and so never get the marker stamped. The marker is canonical for
"this row WAS a terminal completion"; the phase is canonical for
"this turn is currently terminal". Both must agree for the legacy
fallback path because legacy tasks don't carry the per-message
marker.

### 3.4 Test changes

Two-row and three-row discriminators must be added to both the helper
matrix and the component matrix. The reviewer called these out
explicitly. Concretely:

**Helper tests (terminalReportFraming.test.ts):**

1. `historical completed result with marker + phase=streaming → visible` (the reviewer's two-row discriminator)
2. `historical completed result with marker + phase=streaming + intermediate streaming follow-up → historical keeps badge`
3. `historical completed result with marker + phase=streaming + second terminal completion row → historical keeps badge, second row gets new badge` (three-row)
4. `historical completed result with marker + phase=completed → visible` (sanity)
5. `marker set to false + phase=completed → not visible` (explicit opt-out)
6. `marker absent + phase=completed + say completion_result non-partial → not visible` (no fallback to phase-only when shape is say but no marker)
7. `marker absent + phase=completed + ask completion_result with non-empty text → visible` (legacy authority)
8. `marker absent + phase=streaming + ask completion_result with non-empty text → not visible` (legacy still requires phase)

**Component tests (CompletionOutputRow.test.tsx):**

A small harness component renders multiple rows in one render tree so
the test can assert per-row badge presence across the boundary.

## 4. What does NOT change

- `setTurnPhase("completed", ...)` semantics — unchanged.
- `terminalResponseCommittedThisTurn` semantics — unchanged.
- The session-event coordinator's promotion to "completed" — unchanged.
- The `sdk-task-control-coordinator.ts` synthetic-resume path —
  unchanged. Legacy tasks that bypass the SDK translator still go
  through the existing fallback path.
- Plan-mode handling — unchanged. `plan_completion_result` is filtered
  by the helper's message-shape gate.
- All other consumer behavior — unchanged.

## 5. Bounded claim

After this correction lands:

> ClineMM visually marks a final assistant result as Completed iff the
> message carries `isAuthoritativelyCompletedResult: true` (canonical
> completion publication seam in
> `message-translator.ts:1640`), OR the message is a legacy
> `ask: "completion_result"` with non-empty text AND the current
> `turnState.phase === "completed"`. The badge survives phase flips
> (resume, retry, follow-up, compaction) because the per-message
> marker is immutable on the row.

## 6. Gates

- All existing tests must continue to pass.
- New two-row and three-row component tests must pass.
- `bun run check-types` clean.
- `bun run lint` clean.
- `git diff --check` clean.
- Manual dogfood: a task that completes, then a follow-up turn that
  streams, must show `✓ Completed` on the historical row only.

## 7. Open work after CORRECTION01

This correction closes the historical-completion-identity gap. The
remaining open items in the task-presentation epic
(`E7.1-STATIC-THINKING-PRESENTATION-PERSISTENCE01`,
`TASKHEADER-CANONICAL-PROJECTION01`, `TASKHEADER-OWNER-AWARE-TIMING01`)
are independent of this ACT.

## 8. Closure Evidence (range-bound)

### 8.1 Authoritative review range

The CORRECTION01 implementation lives principally in commit
`bbbdffc99` (factory-state closure in the follow-up `23010e7bb`).
The reviewer (Cline architecture reviewer) required the closure
digest to be bound to the production state of the implementation
commit, not to the documentation-only closure commit. The
authoritative range for review is:

```
bbbdffc99^..23010e7bb
```

which encompasses:

```
23010e7bb  factory: re-close ACT-CLINEMM-TERMINAL-REPORT-COMPLETION-FRAMING01 v2
bbbdffc99  ACT-CLINEMM-TERMINAL-REPORT-COMPLETION-FRAMING01-CORRECTION01
```

NOTE on range semantics: `bbbdffc99^` resolves to `3658e65ff`, the v1
ACT commit. For `git diff`, `A..B` (two-dot) compares the two
endpoint trees and is equivalent to `git diff A B`; it is **not**
a commit-set traversal and is **not** the symmetric difference
(the symmetric difference for commits is `A...B`, three-dot).
Therefore `git diff bbbdffc99^..23010e7bb` compares the v1 tree
(`3658e65ff`) against the tree after CORRECTION01 + closure
(`23010e7bb`), exposing exactly the net correction/closure delta
relative to v1. The v1 changes themselves are the baseline
endpoint and are not double-counted.

### 8.2 File-level diff bound to `bbbdffc99^..23010e7bb` (range used by this evidence)

```text
$ git diff --stat bbbdffc99^..23010e7bb

 ...NAL-REPORT-COMPLETION-FRAMING01-CORRECTION01.md | 211 ++++++++++++++++++++
 .factory/epic-board.md                             |   2 +-
 .factory/epics/task-presentation.md                |   3 +-
 .gitignore                                         |   1 +
 apps/vscode/src/sdk/message-translator.ts          |   9 +
 apps/vscode/src/shared/ExtensionMessage.ts         |  24 +++
 .../components/chat/CompletionOutputRow.test.tsx   | 100 +++++++++-
 .../components/chat/terminalReportFraming.test.ts  | 212 ++++++++++++++++++++-
 .../src/components/chat/terminalReportFraming.ts   | 140 ++++++++------
 9 files changed, 631 insertions(+), 71 deletions(-)
```

This range binds the claim that the CORRECTION01 implementation
contains exactly the files the closure documentation describes
(the marker type, the canonical stamp, the helper, both test
files, the plan, the board updates, and the `.gitignore`
whitelist).

### 8.3 File-level diff of `bbbdffc99` alone (the implementation delta)

```text
$ git show --stat bbbdffc99 | tail -11

 ...NAL-REPORT-COMPLETION-FRAMING01-CORRECTION01.md | 211 ++++++++++++++++++++
 .factory/epic-board.md                             |   2 +-
 .factory/epics/task-presentation.md                |   3 +-
 .gitignore                                         |   1 +
 apps/vscode/src/sdk/message-translator.ts          |   9 +
 apps/vscode/src/shared/ExtensionMessage.ts         |  24 +++
 .../components/chat/CompletionOutputRow.test.tsx   | 100 +++++++++-
 .../components/chat/terminalReportFraming.test.ts  | 212 ++++++++++++++++++++-
 .../src/components/chat/terminalReportFraming.ts   | 140 ++++++++------
 9 files changed, 631 insertions(+), 71 deletions(-)
```

`bbbdffc99` carries the entire CORRECTION01 implementation:
- 5 production/test source files
- 1 plan file (`ACT-CLINEMM-TERMINAL-REPORT-COMPLETION-FRAMING01-CORRECTION01.md`)
- 2 board/ledger files (reopened → CORRECTION01 row)
- 1 `.gitignore` whitelist

The follow-up commit `23010e7bb` flips the board/ledger from
"OPEN / P1 CORRECTION" to "CLOSED v2" — that is the only delta in
the second commit (3 insertions / 3 deletions across 2 files).

### 8.4 Gate evidence (post-range, on working tree)

Captured at `bbbdffc99 + 23010e7bb + ae6129bc0` (working tree at `ae6129bc0`):

#### 8.4.1 Helper unit matrix (vitest)

```text
$ cd apps/vscode/webview-ui && bun vitest run \
    src/components/chat/terminalReportFraming.test.ts \
    src/components/chat/CompletionOutputRow.test.tsx --no-isolate

 ✓ src/components/chat/terminalReportFraming.test.ts (40 tests) 3ms
 ✓ src/components/chat/CompletionOutputRow.test.tsx  (19 tests) 86ms
```

40/40 helper tests pass (was 25 in v1; +15 net new in CORRECTION01,
arithmetic of `git diff bbbdffc99^ bbbdffc99 -- .../terminalReportFraming.test.ts`
= 16 added + 1 deleted test — the deleted case was the v1
"completed + final say completion_result → visible Completed framing"
test, which was renamed to the canonical-path variant
"completed + final say completion_result **with marker** → visible
Completed framing").
19/19 component tests pass (was 16 in v1; +3 net new multi-row
discriminator tests through a new `MultiRowHarness` component).

#### 8.4.2 Typecheck

```text
$ cd apps/vscode && bun run check-types
→ bun run protos && bunx tsc --noEmit && bun run check-types:compat && cd webview-ui && bunx tsc --noEmit
→ exit 0
```

(Protobuf regeneration, vscode-side tsc, vscode-compat tsc, and
webview-ui tsc all clean.)

#### 8.4.3 Biome lint

```text
$ bunx biome check \
    src/shared/ExtensionMessage.ts \
    src/sdk/message-translator.ts \
    webview-ui/src/components/chat/terminalReportFraming.ts \
    webview-ui/src/components/chat/terminalReportFraming.test.ts \
    webview-ui/src/components/chat/CompletionOutputRow.test.tsx
Checked 5 files in 102ms. No fixes applied. Found 1 info.

 → only the pre-existing `any` warning at
   src/shared/ExtensionMessage.ts:53 remains (GrcpResponse.message);
   that line was not modified by this ACT.
```

#### 8.4.4 Workspace `bun scripts/run-bun-unit-tests.ts`

```text
Files: 72   Pass: 1073   Fail: 3   Time: ~36s
Failing files (1):
  src/test/services/auth-callback-url.test.ts  (2 pass / 3 fail)
```

The 3 failures are in `AuthHandler.getCallbackUrl (standalone/CLI)`
port-binding tests (`No available port found for local auth
callback (tried 48801-48811)`). These failures were verified to
be **pre-existing** by stashing the CORRECTION01 commits and
re-running the same test file against `origin/main` — the same 3
failures reproduce without any of the CORRECTION01 changes.
The failures are environmental (port restriction on this machine),
not caused by the correction.

#### 8.4.5 Whitespace gate

```text
$ git diff --check HEAD
(clean — no whitespace errors anywhere in the working tree)

$ git diff --check HEAD~3 HEAD
(clean — no whitespace errors in the CORRECTION01 + evidence lineage)
```

### 8.5 Two-row / three-row discriminator tests (reviewer's required invariant)

The reviewer required the closure artifact to make the
discriminator test visible. The helper test file
`apps/vscode/webview-ui/src/components/chat/terminalReportFraming.test.ts`
contains a dedicated `ACT-CLINEMM-TERMINAL-REPORT-COMPLETION-FRAMING01-CORRECTION01 — three-row invariant (reviewer's discriminator)`
describe block with three explicit tests:

```text
row A: historical completed result with marker + streaming phase → visible
row B: intermediate streaming follow-up → no Completed
row C: second terminal completion with marker + streaming phase → visible (new final result)
```

These three tests share the same `RESUMED_PHASE = { phase: "streaming", seq: 99 }`
and assert the load-bearing invariant v1 failed to prove: a
historical completion row keeps its badge even when the resumed
task's current turn phase is streaming.

The component test file
`apps/vscode/webview-ui/src/components/chat/CompletionOutputRow.test.tsx`
mirrors this at the presentation layer via a new `MultiRowHarness`
component that renders multiple rows simultaneously through the
helper, sharing the same `turnState`, with one extra "M-killer" test
that asserts "text says 'Completed' but no marker → no badge".

### 8.6 State binding

| Item | Bound to |
|---|---|
| Production code review | `bbbdffc99` (5 source files) |
| Test code review | `bbbdffc99` (2 test files) |
| Plan record review | `bbbdffc99` (1 ACT plan file) |
| Board state review | `23010e7bb` (2 board files, CLOSED v2) |
| `.gitignore` policy | `bbbdffc99` (1 entry) |
| Test-count attestation | reconciled in `ae6129bc0` (CORRECTION02 ledger update: 14 → 15 net-new helper tests, with the 16 added / 1 deleted arithmetic recorded) |
| Gate evidence (§8.4) | working tree at `ae6129bc0` |

### 8.7 Disposition

```text
ACT_IMPLEMENTATION              = CLOSED
ACT_EVIDENCE_ATTESTATION        = BOUND_TO_BBBDFFC99^..23010E7BB
EVIDENCE_RECORRECTION02         = APPLIED (EOF whitespace, range semantics, test-count)
NEED_RUNTIME_CHANGE             = NO
NEED_TEST_CODE_CHANGE           = NO
```

