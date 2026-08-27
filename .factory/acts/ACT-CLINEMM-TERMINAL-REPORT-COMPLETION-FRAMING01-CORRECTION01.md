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




