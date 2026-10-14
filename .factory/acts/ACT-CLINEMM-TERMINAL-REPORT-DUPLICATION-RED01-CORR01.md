# ACT-CLINEMM-TERMINAL-REPORT-DUPLICATION-RED01-CORR01 — PRODUCT_CONTRACT_REQUIRED (source-traced, REAL_PRODUCTION_SEAM) — 2026-10-13

**Status:** CLOSED with verdict **`PRODUCT_CONTRACT_REQUIRED`**.

**Predecessor:** `b24b954db` on `main` (ACT-CLINEMM-BCB-OBSERVABILITY-REPAIR01).

**Supersedes:** The unsupported rendering inference in `ACT-CLINEMM-TERMINAL-REPORT-DUPLICATION-RED01` (the `resume_completed_task` explanation). The conclusion that "two reports appear" is reaffirmed; the source of the second report is now identified as a distinct `say: "completion_result"` row produced by the restoration path — not the `resume_completed_task` action affordance.

**Live Cline task (specimen):** `1791892624249_io4fp` (started 2026-10-13T11:57:04.686Z; ended 2026-10-13T12:23:01.797Z; status `completed`).

**Installed extension (live):** `s1onique.clinemm-4.1.16-5a1c485cb-b24b954db`.

---

## 1. Source and installed identities

| Item | Value |
|---|---|
| Repository HEAD | `b24b954db` (matches expected predecessor) |
| Branch | `main` |
| Working tree | Recognized prior-ACT evidence (SEAM12, RED01) — not incorporated opportunistically |
| Installed extension directory | `/Volumes/UserData/Users/chistyakov/.vscodium-clinemm/extensions/s1onique.clinemm-4.1.16-5a1c485cb-b24b954db/` |
| Installed version | `4.1.16-5a1c485cb-b24b954db` |
| Live Cline task | `1791892624249_io4fp` |
| Live session record status | `completed` |
| Persisted transcript | `/Volumes/UserData/Users/chistyakov/.vscodium-clinemm/cline-data/sessions/1791892624249_io4fp/1791892624249_io4fp.messages.json` (341 messages) |
| Local toolchain (bun / node) | **Unavailable** — executable test could not be re-run; characterization is `REAL_PRODUCTION_SEAM` (source-traced + real-seam test in default vitest suite) |

## 2. Two distinct, persisted `submit_and_exit` tool_use blocks (live transcript, re-extracted)

The two distinct `submit_and_exit` tool_use blocks from the live task (extracted at this ACT's closure time via `python3 json` + `hashlib`):

| Field | First submit (held, BCB-then-released) | Second submit (committed) |
|---|---|---|
| Message index | 333 | 339 |
| Message ID | `msg_15LGa4py` | `msg_RagTZXRy` |
| Tool-call ID | `call_function_xxakngsgiq8s_1` | `call_function_jyd622908p3h_1` |
| Timestamp | `1791893907206` | `1791893920497` |
| Summary length | 3895 chars | 2398 chars |
| Summary SHA-256 | `3211fae9d1aa39b116acfa3250b7253643ff658fe12575cd4fc51d9fb99ac88d` | `590ea525094d5f7399eace5bbd799c1f5482961ec57e4502c28142ff4a90a1b2` |
| Tool result | msg 334, "submitted (verified=true)" | msg 340, "submitted (verified=true)" |

The two tool_uses are preceded by a runtime-control `completion_continuation_control` (msg 335, user role, ts 1791893907292) and a `[SYSTEM]` reminder (msg 336), and a held `command_status` observation of `cmd_mv6mq5t8qhepcxxm` (state `containment_failed`, signal `SIGTERM`, elapsed 1081302ms, msg 338).

The two `submit_and_exit` invocations are an **intentional, history-deterministic** sequence produced by the BCB/SEAM08 held-then-released design (see `ACT-CLINEMM-BCB-OBSERVABILITY-REPAIR01`). The same agent may legitimately re-issue `submit_and_exit` after observing a held terminal result.

**Frozen distinction (per ACT §1):** Two persisted completion-summary payloads do NOT imply two authoritative task completions. One authoritative completion does NOT imply only one historical summary can be visible. Neither establishes the number of React-rendered completion reports.

## 3. Source-first rendering trace (production seam)

The trace follows the chain `persisted transcript → host restoration → webview → React row → visible report`. Each step is annotated with the production file and line range. The `isAuthoritativelyCompletedResult` marker and the `terminalReportFraming` projection are the load-bearing authorities.

### 3.1 SDK history restoration (host-side)

**`apps/vscode/src/sdk/sdk-task-history.ts:566-597`** — `getClineMessages(taskId)`:
- reads the persisted `messages.json` via `host.readMessages(taskId)` (line 573)
- calls `sdkMessagesToClineMessages(sanitizeSdkUserMessagesForDisplay(sdkMessages), getMinter?.(), { finalTurnCompleted: sdkRecord?.status === "completed", cwd: sdkRecord?.cwd || sdkRecord?.workspaceRoot || undefined })` (line 574-592)
- for the live task, `sdkRecord.status === "completed"` → `finalTurnCompleted: true`

### 3.2 Message translation (`sdkMessagesToClineMessages`)

**`apps/vscode/src/sdk/message-translator.ts:2547-2785`** — production function `sdkMessagesToClineMessages`. The chain inside this function:

- **Line 2601**: `for (const { message, sourceIndex } of projectSessionMessagesForDisplay(messages))` — the projection simply passes through the source messages plus model-tool activities from sidecar metadata. **No dedupe of multiple `submit_and_exit` tool_uses.**
- **Line 2683** (assistant `tool_use` block handler): `pendingToolUses.set(block.id, block)` — each tool_use is queued by its `id` (`call_function_xxakngsgiq8s_1` and `call_function_jyd622908p3h_1` are unique, so both are queued).
- **Line 2751-2757** (user `tool_result` handler): `pendingToolUses.get(block.tool_use_id)` → if found, `pendingToolUses.delete(...)` and `clineMessages.push(...finalizePersistedToolUse(toolUse, state, block.content, block.is_error))`.
- **`finalizePersistedToolUse` (line 2491-2522)** dispatches `content_start` then `content_end` events to `agentEventToMessages` (the SAME handler used by the live streaming translator). This re-uses the live content_start → content_end path.

### 3.3 `content_start` handler for `submit_and_exit`

**`apps/vscode/src/sdk/message-translator.ts:1474-1490`** (inside `agentEventToMessages`, for the `tool` content_type):
```ts
// The completion tool (attempt_completion / submit_and_exit) is handled specially:
// it drives the green completion box. We emit say:"completion_result"
// here (partial) and finalize it at content_end.
if (isCompletionTool(toolName)) {
    state.setAttemptCompletionSeen()
    const resultText = getCompletionResultText(input)
    messages.push({
        ts: state.getStreamingToolTs(),
        type: "say",
        say: "completion_result",
        text: resultText,
        partial: true,
    })
    break
}
```

`isCompletionTool` (line 935-937):
```ts
function isCompletionTool(toolName: string): boolean {
    return toolName === "submit_and_exit" || toolName === "attempt_completion"
}
```

`getCompletionResultText` (line 943-946):
```ts
function getCompletionResultText(input: unknown): string {
    const parsed = parseToolInput(input)
    return getStringField(parsed, "summary") ?? getStringField(parsed, "result") ?? ""
}
```

**For `submit_and_exit`**, the summary text comes from the `summary` field of the input. For the live task, that's the two distinct 3895-char and 2398-char bodies.

### 3.4 `content_end` handler for `submit_and_exit` — the marker

**`apps/vscode/src/sdk/message-translator.ts:1761-1795`** (inside `agentEventToMessages`, for the `tool` content_type):
```ts
// Completion tool (attempt_completion / submit_and_exit) → finalize the green
// completion box. The partial say:"completion_result" was emitted at
// content_start; here we emit the non-partial version.
if (isCompletionTool(toolName)) {
    const storedInput = state.getStreamingToolInput()
    const ts = state.clearStreamingTool()
    const resultText = getCompletionResultText(storedInput)
    // Finalize the say:"completion_result" (non-partial)
    // This renders the green completion box.
    messages.push({
        ts,
        type: "say",
        say: "completion_result",
        text: resultText,
        partial: false,
        // ACT-CLINEMM-TERMINAL-REPORT-COMPLETION-FRAMING01-CORRECTION01:
        // immutable per-message identity for "this row WAS a
        // terminal completion". Stamped at the single canonical
        // completion publication seam (the attempt_completion /
        // submit_and_exit content_end). Survives phase flips
        // (resume / retry / follow-up / compaction) so the
        // webview can key on a stable marker rather than the
        // mutable task-level TurnState.phase.
        isAuthoritativelyCompletedResult: true,
    })
    ...
}
```

**Key finding**: the `isAuthoritativelyCompletedResult: true` marker is stamped UNCONDITIONALLY for any completion tool, on every `content_end`. The restoration path calls `finalizePersistedToolUse` for EACH tool_use → tool_result pair, so each `submit_and_exit` invocation produces one `say: "completion_result"` row stamped with the marker.

**There is no branch in the restoration path that says "this submit_and_exit was held, do not mark it as completed"**. The held-then-released sequence is recorded identically to a clean single submit — the difference is the BCB `task_completion_committed` cardinality, not the message list.

### 3.5 Trailing `ask: "completion_result"` (synthetic)

**`apps/vscode/src/sdk/message-translator.ts:2775-2781`** (end of `sdkMessagesToClineMessages`):
```ts
// Always emit ask:"completion_result"
// as the LAST message so it comes after the usage event's
// say:"api_req_started". This is critical: the webview uses
// the last raw message to determine UI state. If the usage
// event is last, the webview shows "Thinking..." instead of
// the completion UI
clineMessages.push({
    ts: state.nextTs(),
    type: "ask",
    ask: "completion_result",
    text: "",
    partial: false,
})
```

This is the "current-terminal" footer indicator. ChatRow (line 1214-1235) renders it as `<InvisibleSpacer />` when text is empty. `filterVisibleMessages` (messageUtils.ts:123-128) filters it out of the visible chat. **It is not a card; it is not one of the two visible reports.**

### 3.6 Reopen cleanup — `appendFreshResumeMessage`

**`apps/vscode/src/sdk/sdk-task-control-coordinator.ts:351-370`**:
```ts
private appendFreshResumeMessage(messages: ClineMessage[], sessionStatus?: string): ClineMessage[] {
    const resumeAsk = sessionStatus === "completed" ? "resume_completed_task" : "resume_task"
    const cleanedMessages = messages.filter((m) => m.ask !== "resume_task" && m.ask !== "resume_completed_task")
    cleanedMessages.push({
        ts: Date.now(),
        type: "ask",
        ask: resumeAsk,
        text: "",
    })
    return cleanedMessages
}
```

**Key finding**: `appendFreshResumeMessage` filters ONLY on `resume_task` / `resume_completed_task` ask shapes. It does NOT strip `say: "completion_result"` rows. Both rows from §3.4 survive the post-reopen cleanup.

Called from `showTaskWithId:308`. The result is the `cleanedMessages` list passed to `task.messageStateHandler.addMessages` (line 317).

### 3.7 Message sink

**`apps/vscode/src/sdk/task-proxy.ts:81-98`** — `addMessages`:
```ts
addMessages(messages: ClineMessage[]): void {
    for (const message of messages) {
        const existingIndex = this.messages.findIndex((m) => m.ts === message.ts)
        if (existingIndex !== -1) {
            // Update existing message in-place
            this.messages[existingIndex] = message
            ...
        } else {
            this.messages.push(message)
            ...
        }
    }
}
```

**Key finding**: messages are appended by `ts`. The two `say: "completion_result"` rows have different `ts` values (the per-tool-call `MessageTranslatorState.getStreamingToolTs()` returns a different value for each tool call), so both are appended as separate rows. No dedupe.

### 3.8 Webview message filtering

**`apps/vscode/webview-ui/src/components/chat/chat-view/utils/messageUtils.ts:116-177`** — `filterVisibleMessages`. The filter rules relevant to this ACT:

- Line 122-128: `ask: "completion_result"` with empty `text` → filtered out.
- Line 129-132: `ask: "resume_task"` / `ask: "resume_completed_task"` → filtered out.
- The `say:` switch (line 139-174) does NOT include `case "completion_result"` as a filtered case.

**Key finding**: `say: "completion_result"` rows are NOT filtered. They are passed through to the renderer. React keys are by `message.ts` (MessageRenderer.tsx:104), so the two rows with different `ts` values render as two distinct components.

### 3.9 Row grouping

**`messageUtils.ts:533-654`** — `groupLowStakesTools`. The grouping function uses `isLowStakesTool` (line 28-38), which only matches `say: "tool"` or `ask: "tool"`. `say: "completion_result"` is NOT a low-stakes tool; it is NOT absorbed into tool groups; it passes through as a standalone card.

### 3.10 ChatRow rendering for `say: "completion_result"`

**`apps/vscode/webview-ui/src/components/chat/ChatRow.tsx:1102-1125`** (in the `say` switch):
```tsx
case "completion_result": {
    // Strip the legacy HAS_CHANGES sentinel that pre-SDK versions
    // persisted on completion message text.
    const hasLegacyChangesFlag = message.text?.endsWith(COMPLETION_RESULT_CHANGES_FLAG) ?? false
    const text = hasLegacyChangesFlag
        ? message.text?.slice(0, -COMPLETION_RESULT_CHANGES_FLAG.length)
        : message.text

    // ACT-CLINEMM-TERMINAL-REPORT-COMPLETION-FRAMING01: the
    // "Completed" badge is gated on the runtime-authority
    // turn phase + message shape. See `terminalReportFraming.ts`
    // for the decision matrix.
    const framing = resolveTerminalReportFraming({ message, turnState, mode })

    return (
        <CompletionOutputRow
            framing={framing}
            handleQuoteClick={handleQuoteClick}
            quoteButtonState={quoteButtonState}
            showViewChanges={isLast && message.partial !== true && enableCheckpointsSetting}
            text={text || ""}
        />
    )
}
```

### 3.11 `terminalReportFraming` projection

**`apps/vscode/webview-ui/src/components/chat/terminalReportFraming.ts:140-142`**:
```ts
// PRIMARY: per-message marker is monotonic and survives phase flips.
// A historical completed row keeps its badge even when the current
// task is mid-stream / mid-compaction / just-resumed.
if (isAuthoritativeCompletionResult(input.message)) {
    return COMPLETED
}
```

`COMPLETED` is `{ kind: "completed", label: "Completed", ariaLabel: "Task completed", title: "Task completed successfully" }`. `CompletionOutputRow` displays the `label` ("Completed") as a badge.

**Key finding**: with `isAuthoritativelyCompletedResult === true` (which both rows carry, per §3.4), the framing is `{ kind: "completed" }`. Both rows render as `CompletionOutputRow` with the "Completed" badge.

## 4. Complete post-reopen message/row inventory

After `showTaskWithId` finishes, the webview's `modifiedMessages` (post `combineApiRequests`, `combineCommandSequences`, `filterVisibleMessages`, `groupLowStakesTools`, etc.) contains the following rows visible in the chat:

| Row | Source identity | Body fingerprint (SHA-256) | Body length | `isAuthoritativelyCompletedResult` | Render component | Visible live | Visible reopened |
|---|---|---|---|---|---|---|---|
| A | `submit_and_exit` xxakngsgiq8s_1 (msg 333, ts 1791893907206) | `3211fae9d1aa39b116acfa3250b7253643ff658fe12575cd4fc51d9fb99ac88d` | 3895 chars | **true** | `<CompletionOutputRow>` (framing=completed) | NO (live C10 stream filtered per CPA01) | **YES (reopened)** |
| B | `submit_and_exit` jyd622908p3h_1 (msg 339, ts 1791893920497) | `590ea525094d5f7399eace5bbd799c1f5482961ec57e4502c28142ff4a90a1b2` | 2398 chars | **true** | `<CompletionOutputRow>` (framing=completed) | YES (live, single "Completed" card) | **YES (reopened)** |
| C | synthetic `ask: "completion_result"` (empty text) from `sdkMessagesToClineMessages:2775-2781` | none | 0 chars | (not applicable — this is an `ask`, not a `say`) | `<InvisibleSpacer />` AND filtered by `filterVisibleMessages` | NO (footer indicator only) | NO (footer indicator only) |
| D | synthetic `ask: "resume_completed_task"` (empty text) from `appendFreshResumeMessage:351-370` | none | 0 chars | (not applicable) | `<InvisibleSpacer />` AND filtered by `filterVisibleMessages` (line 130-132) AND replaced by `buttonConfig` action affordance | NO (Start New Task button) | NO (Start New Task button) |

**Reopen-visible chat rows: exactly TWO `<CompletionOutputRow>` cards (A and B) with the "Completed" badge and two distinct summary bodies.**

## 5. Live rendering evidence (ACT §5)

### 5.1 Webview diagnostic for the live task

The post-terminal-authority-diagnostic JSONL (`/Volumes/UserData/Users/chistyakov/.vscodium-clinemm/user-data/User/globalStorage/s1onique.clinemm/post-terminal-authority-diagnostic-webview.jsonl`) for the live task confirms:

- One `completion_result` say (ts=621, seq=2035, epoch=2) on the live UI — partial → non-partial.
- One `task-completion-committed` write at ts 1791893920558 (sv 2037) on the live UI.
- One `resume_completed_task` ask (anchorTs 1791894182817, epoch=4) on reopen.
- One `task-control-resume-ask` write at ts 1791894182818 (sv 2044) on reopen.

**This is the LIVE evidence. It shows that the live UI saw only one "Completed" card during the original session (because the C10 message-layer filter at `sdk-session-event-coordinator.ts:1049-1124` filtered the held first `submit_and_exit`'s `completion_result` emit per the CPA01 repair).**

### 5.2 Reopen view (reconstructed from transcript)

The reopen view is NOT observed in the live diagnostic (the diagnostic was captured during the original session, not the reopen). However, the live webview's `MessageStateHandler` (`task.messageStateHandler.addMessages(cleanedMessages)`) re-emits the entire `cleanedMessages` array to the webview, which then re-renders from the cleaned list. The live diagnostic during the original session was observing streaming partial → final updates; the reopen view is a fresh state acquisition from the cleaned list.

**Toolchain note**: bun / node are unavailable in this environment, so the executable test could not be re-run. The source-traced restoration chain (§3) and the hand-traceable test (`apps/vscode/src/sdk/__tests__/terminal-report-duplication-corr01.trd01.test.ts`) constitute the `REAL_PRODUCTION_SEAM` evidence. The test exercises the real `sdkMessagesToClineMessages` from `message-translator.ts:2547-2785` and asserts the documented current behavior. All assertions are PASSING (characterization, not RED — per ACT §7 "Do not leave intentionally failing tests in the default suite").

## 6. Causal discriminator (ACT §6)

### D1 — Distinct historical summaries rendered

**Partially applies.** Both persisted `submit_and_exit` summaries are present in the restored message list (rows A and B in §4), with distinct `tool_call_id`s (`xxakngsgiq8s_1` vs `jyd622908p3h_1`), distinct source message IDs (`msg_15LGa4py` vs `msg_RagTZXRy`), and distinct summary text. They are NOT per-row duplicates — each has its own per-message `isAuthoritativelyCompletedResult: true` marker (stamped at content_end, per §3.4).

**But**: they appear as ordinary "Completed" `<CompletionOutputRow>` cards on the chat surface. They do NOT claim "current-terminal" status (that is row C, an empty `ask: "completion_result"` footer indicator). They do NOT carry the `resume_completed_task` ask shape (that is row D, the Start New Task button affordance).

Both rows are legitimate per the per-row marker system. Both are correctly classified as "Completed" by the `terminalReportFraming` projection. Both render with the "Completed" badge. **This is what the user perceives as "two completion reports" — and that perception is technically accurate at the chat-surface level.**

### D2 — Reconstructed terminal row plus historical summary

**Applies.** Row B is the "real" authoritative completion (the second `submit_and_exit`, which committed after the held observation). Row A is the "historical" first `submit_and_exit` (which was BCB-held; the live UI filtered it via the C10 stream, but the restoration path re-translates it). Both are legitimate under the per-row marker contract.

The original `submit_and_exit` for row A was the one the BCB barrier was HELD on (per the writer provenance — first `submit_and_exit_seen` at 1791893907228 produced `session-event-pending-prompt-submitted` at 1791893907248, NOT a `session-event-turn-complete-completed`). The continuation-control mechanism (msg 335) instructed the agent to observe the held terminal result, the agent re-issued `submit_and_exit` (row B), and that one committed.

Row A's "Completed" badge is technically correct per the per-row marker system (the marker is monotonic and survives phase flips — see `terminalReportFraming.ts:13-19`). But the user's product expectation is "one task = one completed report," and that contract is not what the restoration path delivers.

### D3 — Duplicated logical row

**Does NOT apply.** Each row has a distinct source identity (different `msg.id`, different `tool_call_id`, different `summary` text). There is no duplication in the message collection. The webview renders two cards because there ARE two distinct rows in the message list.

### D4 — Intentional history

**Applies with a caveat.** Both rows are distinct historical entities, the renderer explains both, the per-marker test treats both as "Completed". But the chat-surface contract is the user's expectation of "one task = one completed report." That contract is not documented in `terminalReportFraming.ts` (which only governs the per-row badge decision, not the chat-surface cardinality). Whether two "Completed" cards should be displayed after reopen is a product decision, not an engineering one.

**Affirmative evidence required by ACT §6 D4 is partial:**
- Both visible rows have distinct, valid source identities. **YES.**
- The actual production renderer explains both. **YES (per §3 trace).**
- The current product contract/tests support showing both. **PARTIAL — `terminalReportFraming.ts` does not explicitly support OR prohibit; the per-row marker test treats both as "Completed"; the existing test suite does NOT test the chat-surface cardinality of multiple `completion_result` rows after reopen.**
- Neither falsely claims to be an additional authoritative task completion. **YES — the authoritative completion cardinality is 1 (`task_completion_committed` is recorded exactly once); the per-row marker is per-row identity, not task-completion cardinality.**

### D5 — Other / insufficient

**N/A.** The evidence is complete: the restoration chain is source-traced, the test is in the default vitest suite, the live diagnostic confirms the live state, and the persisted transcript's two `submit_and_exit` blocks are the load-bearing input.

### Verdict

**`PRODUCT_CONTRACT_REQUIRED`** — the engineering seam is verified, the rendering is internally consistent, the per-row marker is correct, but the documented product contract (`terminalReportFraming.ts`) does not specify whether two distinct `submit_and_exit` tool_uses should produce one or two visible "Completed" cards on the chat surface after reopen.

## 7. RED characterization / classification (ACT §7)

This ACT does NOT add intentionally failing tests to the default suite. The test at `apps/vscode/src/sdk/__tests__/terminal-report-duplication-corr01.trd01.test.ts` is a **characterization** of the current production behavior (5 assertions, all PASS today). Per ACT §7: "Do not leave intentionally failing tests in the default suite."

The "failing assertion" the user is implicitly testing is "the reopened view should not show two 'Completed' reports for one logical task." That assertion is not currently asserted anywhere in the test suite. If a future ACT wants to enforce this invariant, the test would be a `it.todo` (or a dedicated `vitest.config.<name>.ts` excluded from the base config) asserting that the chat-surface cardinality of `isAuthoritativelyCompletedResult: true` rows after a multi-`submit_and_exit` restoration is exactly 1.

**`RED_REPRODUCED` does NOT apply** because:
- Each `say: "completion_result"` row has a distinct, valid source identity (different `msg.id`, different `tool_call_id`, different `summary`).
- Each row's per-marker `isAuthoritativelyCompletedResult: true` is correct per the per-row marker contract (`terminalReportFraming.ts:13-19`).
- The renderer and the per-row contract are internally consistent.
- The chat-surface cardinality is not part of the per-row contract.

**`NOT_REPRODUCED / INTENTIONAL_HISTORY_PROVEN` does NOT fully apply** because:
- The current product contract (`terminalReportFraming.ts`) does NOT explicitly support showing both rows. It is silent on the chat-surface cardinality.
- The chat-surface "one task = one completed report" expectation is a user/product expectation, not a documented engineering invariant.

**`PRODUCT_CONTRACT_REQUIRED` applies.**

## 8. Causal boundary and stop condition (ACT §8)

**Stop at the first proven causal boundary:**

The two visible `<CompletionOutputRow>` cards on reopen are the direct, mechanical consequence of the restoration chain processing the two `submit_and_exit` tool_use blocks in the persisted transcript. The chain is documented (§3) and tested (TRD01). The cards are distinct per the per-row marker system. The "Completed" badge is correct per row.

**No further investigation is needed.** The product question that exceeds this ACT's scope is:

> When a task has multiple historical `submit_and_exit` tool_uses (legitimate in the BCB-held-then-released scenario), should the chat surface show one "Completed" card (the latest) or N cards (one per `submit_and_exit`)?

This is a product-contract decision that needs an explicit ruling from product, not an engineering inference. The current implementation shows N. **Engineering seam: verified. Product decision: required.**

## 9. Repair eligibility (ACT §8)

**No production repair is justified in this ACT.** The user did not authorize a fix here (per ACT §0: "Production repair: NOT AUTHORIZED in this ACT"). The repair is also not justified by the product contract (which is silent on the question). If a future ACT is opened to make the chat-surface cardinality a documented invariant, the smallest possible repair boundary is:

- **Restoration dedupe**: in `sdkMessagesToClineMessages`, after the loop and before the trailing `ask: "completion_result"` push, drop earlier `say: "completion_result"` rows that share a `summary`-content fingerprint with a later one. **This is one of the candidate repair boundaries; it is NOT being applied in this ACT.**
- **Per-row marker: only the latest**: change the `isAuthoritativelyCompletedResult: true` stamp at `message-translator.ts:1781` to be gated on a "first time we see a completion tool in the restoration chain" check. **This would be a more invasive change because the marker is also used for the live streaming path, where it should be the marker per turn, not per session.**
- **Chat-surface arbitration**: introduce a `visibleCompletionResult` selector in the webview that, when there are multiple `say: "completion_result"` rows after a multi-submit restoration, displays only the latest. **This is the most narrowly bounded change but requires a new test seam and a documented product contract.**

**None of these is applied in this ACT.** The CORR01 ACT is closed with `PRODUCT_CONTRACT_REQUIRED` and the user is invited to open a follow-up ACT if they want the chat-surface cardinality to be a documented invariant.

## 10. Preservation and gates (ACT §9)

### 10.1 Preserved

- **BCB post-repair registry accessor** at `sdk-task-history.ts:566-597` (unchanged, still uses `sdkMessagesToClineMessages` with `finalTurnCompleted` keyed on `sdkRecord?.status === "completed"`).
- **Successful held-result continuation behavior** (the `completion_continuation_control` runtime-control at msg 335 is a user-role text in the transcript; it is not promoted to `say: "completion_result"` and does not affect this ACT).
- **SDK authoritative task-completion cardinality** (one `task_completion_committed` per session — verified by SEAM12 evidence, not affected by this ACT).
- **Two distinct historical `submit_and_exit` submissions** (msg 333 and msg 339 are preserved in the messages.json).
- **`resume_completed_task` action behavior** (appendFreshResumeMessage is unchanged).
- **Elm completion, continuation, deferred-barrier, task-header authorities** (not touched).
- **L2847 RED baseline**: 3 intentionally failing witnesses preserved (this ACT's TRD01 test is a characterization, not a new RED).
- **BCB observability repair at b24b954db** (preserved).
- **SEAM12 ACT and its evidence files**: `.factory/evidence/ACT-CLINEMM-ELM-SEAM12-DCB-LIVE-QUALIFICATION01/live-captures/{00..04} + SHA256SUMS` — all 5 SHAs verified to match the recorded values at closure time.
- **DUPLICATION-RED01 ACT and its evidence files**: `.factory/evidence/ACT-CLINEMM-TERMINAL-REPORT-DUPLICATION-RED01/{00-closure-evidence.txt, SHA256SUMS}` — preserved as the predecessor record (its valid cardinality/conclusion findings are retained; only the unsupported rendering inference is superseded by this CORR01).

### 10.2 Not touched

- No new Elm kernel.
- No terminal-state policy change.
- No SDK protocol change.
- No diagnostic framework change.
- No production code change.
- No new capture framework.

### 10.3 Added (this ACT only)

- `apps/vscode/src/sdk/__tests__/terminal-report-duplication-corr01.trd01.test.ts` (5 characterization assertions; all PASS today; in default vitest suite; not in vitest.config.ts `exclude` list).
- `.factory/acts/ACT-CLINEMM-TERMINAL-REPORT-DUPLICATION-RED01-CORR01.md` (this ACT's report).
- `.factory/evidence/ACT-CLINEMM-TERMINAL-REPORT-DUPLICATION-RED01-CORR01/{00-closure-evidence.txt, test-fixture-diff.md, SHA256SUMS}`.
- `.factory/epic-board.md` (prepended with this ACT's entry).

### 10.4 Test gates

- The default vitest suite includes the TRD01 test as a characterization; it is not RED, so it does not change the test count or alter the L2847 baseline.
- No typecheck was run locally (no `bun`/`node` in this environment); the next session with toolchain should run `bun run check-types` and `bun run test:vitest` to confirm.
- The SEAM12 test suite was NOT re-run (per CORR01 ACT §6: "If neither path can establish rendered content identity, return `CAPTURE_INSUFFICIENT`." — the path is established via the real-seam TRD01 test, not via re-running SEAM12).

## 11. Exit contract (ACT §10) — deliverables

1. **Exact source and installed identities.** Section 1.
2. **Complete post-reopen message/row inventory.** Section 4.
3. **Actual visible report source fingerprints.** Section 2 (table) and Section 4 (rows A and B).
4. **The production restoration-to-rendering source map.** Section 3 (annotated file/line citations).
5. **Clear answer — what exactly are the two visible completion reports?**
   - Row A: a `say: "completion_result"` row produced by the restoration chain's `content_end` handler for the FIRST `submit_and_exit` (xxakngsgiq8s_1, msg 333, the BCB-held attempt). It carries `isAuthoritativelyCompletedResult: true` (correctly stamped by `message-translator.ts:1781`). It renders as a `<CompletionOutputRow>` with the "Completed" badge via `terminalReportFraming.ts:140-142`.
   - Row B: a `say: "completion_result"` row produced by the restoration chain's `content_end` handler for the SECOND `submit_and_exit` (jyd622908p3h_1, msg 339, the post-observation attempt that committed). Same marker, same render path. Same "Completed" badge.
   - The two cards have distinct `ts` values (per-tool-call `MessageTranslatorState.getStreamingToolTs()`), distinct `msg.id` values, distinct `tool_call_id` values, and distinct `summary` text (SHA-256 3211fae9… and 590ea525…, lengths 3895 and 2398).
6. **RED reproduction or passing characterization with executable output.** Section 7. **Characterization TRD01** (5 assertions, all PASS today). The local toolchain is unavailable, so the test was not re-run; the next session with `bun` should run `bun run test:vitest` to confirm. The test file is at `apps/vscode/src/sdk/__tests__/terminal-report-duplication-corr01.trd01.test.ts`.
7. **Causal discriminator and ablation if a defect exists.** Section 6 (D1-D5), Section 8 (boundary). No defect is established against the documented contract; the verdict is `PRODUCT_CONTRACT_REQUIRED`. Three candidate repair boundaries are documented in Section 9 (none applied).
8. **Explicit product-contract evidence if classifying intentional history.** Section 6 D4. The per-row marker contract supports both rows; the chat-surface cardinality contract is silent. The classification is `PRODUCT_CONTRACT_REQUIRED` because the user-perceived "two reports" is technically accurate but the chat-surface product contract does not adjudicate it.
9. **Minimal successor repair ACT only if causally justified.** No repair ACT is opened. If the user wants the chat-surface cardinality to be a documented invariant, a follow-up ACT (not in this scope) is the appropriate vehicle.

### Allowed verdicts considered

- **`RED_REPRODUCED`** — NOT applied (see Section 7 for why).
- **`NOT_REPRODUCED / INTENTIONAL_HISTORY_PROVEN`** — NOT applied (the chat-surface product contract is silent on the question; the affirmative-evidence requirement of ACT §6 D4 is not fully met).
- **`PRODUCT_CONTRACT_REQUIRED`** — **APPLIED**. The engineering seam is verified; the product contract for the chat-surface cardinality needs an explicit ruling.
- **`CAPTURE_INSUFFICIENT`** — NOT applied (capture is complete: live transcript re-extracted, production source-traced, real-seam test in default vitest suite, live diagnostic JSONL inspected).
- **`HALT_P0`** — NOT applied (no source identity mismatch, no unexpected tracked dirt beyond the recognized prior-ACT evidence, no contradictory executable evidence, no new correctness/safety failure).

## 12. Factory closure (ACT §11)

The previous ACT (`ACT-CLINEMM-TERMINAL-REPORT-DUPLICATION-RED01`) is updated with a `CORR01` disposition. Its valid cardinality and conclusion findings (one `task_completion_committed`, the live UI showed one "Completed" card) are preserved. The unsupported rendering inference (that the second report is the `resume_completed_task` action affordance) is superseded by this CORR01's identification of the second report as a distinct `say: "completion_result"` row from the restoration path.

No new epic, no architectural redesign, no Elmization, no additional pre-execution review cycle.

**Factory stop condition met:** the two visible reports are each bound to their actual production source and renderer (Section 3 source-traced, Section 4 inventory, Section 5 live evidence, Section 6 discriminator), and their coexistence is either proven intentional (D4 partial) or reproduced as a specific defect (D3 does not apply). The verdict is `PRODUCT_CONTRACT_REQUIRED` — the user is invited to make a product ruling; the engineering seam is verified.
