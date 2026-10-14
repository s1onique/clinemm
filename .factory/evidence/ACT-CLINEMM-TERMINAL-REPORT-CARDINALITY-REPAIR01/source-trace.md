# ACT-CLINEMM-TERMINAL-REPORT-CARDINALITY-REPAIR01 — Source Trace

**Closed:** 2026-10-13 at HEAD `b24b954db` (unchanged; this ACT adds
untracked files to the working tree).

This document is the source-traced production-seam reconstruction of
the bounded repair. Every line cited is the production code at
`b24b954db` plus the minimal repair (this ACT's `message-translator.ts`
edit). The repair is reviewed at the line level in §2.

## 1. Pre-repair production seam (per CORR01 §3 + new TRCR01 evidence)

The pre-repair restoration chain for the live task
`1791892624249_io4fp` (persisted at
`/Volumes/UserData/Users/chistyakov/.vscodium-clinemm/cline-data/sessions/1791892624249_io4fp/1791892624249_io4fp.messages.json`,
341 messages) is:

1. **`apps/vscode/src/sdk/sdk-task-history.ts:566-597`** —
   `getClineMessages(taskId)` reads the persisted transcript and calls
   `sdkMessagesToClineMessages(...)` (line 588).

2. **`apps/vscode/src/sdk/message-translator.ts:2547-2785`** —
   `sdkMessagesToClineMessages(...)`. The relevant internal chain:

   - **Line 2601**: `for (const { message, sourceIndex } of projectSessionMessagesForDisplay(messages))` — passes through source messages.
   - **Line 2683**: `pendingToolUses.set(block.id, block)` — queues each `tool_use` keyed by id.
   - **Line 2751-2757**: `pendingToolUses.get(block.tool_use_id)` → `finalizePersistedToolUse(toolUse, state, block.content, block.is_error)` (line 2757).
   - **Line 2775-2781**: appends one empty `ask:"completion_result"` for the "current-terminal" indicator (filtered from visible chat by `messageUtils.ts:123-128`).

3. **`finalizePersistedToolUse` (line 2491-2522)** dispatches
   `content_start` then `content_end` to `agentEventToMessages`, the
   SAME handler used by the live streaming translator. Both events
   drive the completion-tool content_end branch at
   `message-translator.ts:1761-1795`.

4. **Completion content_end handler (line 1761-1795)** UNCONDITIONALLY
   stamps `isAuthoritativelyCompletedResult: true` on the emitted
   `say:"completion_result"` row (line 1781). No
   held-vs-committed distinction is made.

### 1.1 The durable held-vs-committed signal

The persisted transcript at msg 335 (the live task
`1791892624249_io4fp`) carries:

```json
{
  "role": "user",
  "id": "runtime-control-1791893907292",
  "ts": 1791893907292,
  "metadata": {
    "runtimeAuthority": "host_runtime_control",
    "kind": "completion_continuation_control"
  },
  "content": [{ "type": "text", "text": "..." }]
}
```

Verified at this ACT's recon time via `python3 json` against the live
transcript. The metadata fingerprint is the durable host-runtime
control marker emitted by the BCB
(`apps/vscode/src/sdk/SdkController.ts:991`,
`background-notify-coordinator.ts:607-650`).

This message occurs AFTER msg 334 (the tool_result for the FIRST
`submit_and_exit` at xxakngsgiq8s_1) and BEFORE msg 339 (the SECOND
`submit_and_exit` at jyd622908p3h_1). It is the durable evidence that
the first `submit_and_exit` was HELD.

## 2. The bounded repair

### 2.1 `finalizePersistedToolUse` (message-translator.ts:2491-2542)

A new optional 5th parameter `isAuthoritativeCompletion: boolean = true`
was added. The default `true` preserves the live streaming path
unchanged (the live `content_end` for completion tools in
`agentEventToMessages` never threads this flag, so the existing
"always stamp the marker" behavior is preserved). For
`finalizePersistedToolUse` calls from the restoration path in
`sdkMessagesToClineMessages`, the caller computes the bit per
`tool_use` (see §2.3) and threads it onto the synthesized
`content_end` event as `isAuthoritativeCompletion`.

The function passes the flag onto the synthesized `content_end` event
via a conditional spread:

```ts
...(isCompletionTool(toolUse.name) ? { isAuthoritativeCompletion } : {})
```

Only completion tools carry the flag; other tool types ignore it.

### 2.2 The completion content_end handler (message-translator.ts:1761-1815)

The completion branch now reads the threaded flag and OMITS the
`isAuthoritativelyCompletedResult:true` marker when the flag is
`false`:

```ts
const eventAuthority = (event as AgentEvent & { isAuthoritativeCompletion?: boolean })
    .isAuthoritativeCompletion
const isAuthoritativeCompletion = eventAuthority !== false
// ...
messages.push({
    ts,
    type: "say",
    say: "completion_result",
    text: resultText,
    partial: false,
    // ...
    ...(isAuthoritativeCompletion ? { isAuthoritativelyCompletedResult: true } : {}),
})
```

The `!== false` check preserves the existing live-streaming behavior:
if the flag is `undefined` (which is the case for every live
streaming `content_end`, because the live translator's
`content_end` for completion tools does not thread the flag), the
marker is stamped as before. The flag is only `false` when the
restoration path explicitly threads it for a HELD completion tool.

The `state.setTerminalResponseCommittedThisTurn()` call is unchanged
(both live and HELD restoration paths still record the in-memory
TurnState.phase = "completed" signal for the held attempt, because
that signal drives the LIVE session's behavior — the TRCR01 repair
only affects the persisted-row marker that drives reopen
rendering).

### 2.3 The restoration-time held-vs-committed bit (message-translator.ts:2621-2680)

Three O(N) data structures are precomputed once at the top of
`sdkMessagesToClineMessages`:

1. **`runtimeControlIndices: number[]`** — source-transcript indices
   of every user message whose `metadata.runtimeAuthority ===
   "host_runtime_control"` AND `metadata.kind ===
   "completion_continuation_control"`. This is the durable
   runtime-control held-submission marker.

2. **`toolResultSourceIndex: Map<string, number>`** — the source-transcript
   index of the user message that contains the first `tool_result`
   block for each `tool_use_id`.

3. **`isCompletionToolHeld(toolUseId: string): boolean`** — returns
   `true` iff a runtime-control marker occurs AFTER the
   tool_result for `toolUseId` in the source transcript.

At the `finalizePersistedToolUse` call site in the
`sdkMessagesToClineMessages` tool_result handler, the bit is
computed as:

```ts
!isCompletionTool(toolUse.name) || !isCompletionToolHeld(block.tool_use_id)
```

That is: for non-completion tools, the bit is always `true` (no
change). For completion tools, the bit is `true` iff the tool is
NOT held. This minimizes the change to one function-call line.

### 2.4 Conservative fallback: legacy / unknown shape

The pre-scan's `metadata.runtimeAuthority === "host_runtime_control" && metadata.kind === "completion_continuation_control"` check is a
narrow conjunctive fingerprint. If either field is missing, the
runtime-control user message is NOT recorded as a held-submission
marker, and the corresponding `submit_and_exit` rows retain the
authoritative-completion marker. This is the conservative fallback
for legacy / unknown data — the chat surface for such transcripts
is unchanged from the pre-repair behavior. The new TRCR01 Fixture E
asserts this contract.

## 3. Conservation guarantees

The repair's blast radius is bounded to one local function and one
local data structure. No other production file was touched. No
new state, no new marker, no new persistence contract, no new
kernel, no new Elm, no new BCB writer. Specifically preserved:

- **Live streaming path**: `agentEventToMessages`'s completion
  `content_end` branch now reads the flag with a `!== false`
  fallback. The live path never threads the flag, so the existing
  "always stamp the marker" behavior is preserved for every live
  completion event.

- **BCB observation path**: `sdk-session-event-coordinator.ts`'s
  BCB writer (lines 3180-3224) and `deferredCompletionBarrier`
  marker are unchanged. The repair does not add or remove any BCB
  writer call sites.

- **`terminalResponseCommittedThisTurn` invariant**: the in-memory
  `MessageTranslatorState.setTerminalResponseCommittedThisTurn()`
  call at line 1810 is unchanged. The held attempt still records
  the in-memory `TurnState.phase = "completed"` signal (because
  that's what drives the live session's UI; the repair only changes
  the persisted-row marker that drives reopen rendering).

- **`terminalReportFraming` primary marker path**:
  `webview-ui/src/components/chat/terminalReportFraming.ts:107-109`
  uses `message.isAuthoritativelyCompletedResult === true` to
  resolve the "Completed" framing. The held row's marker is now
  absent (or `undefined`), so the framing resolves to a different
  value (e.g., "plan" or fallback), which the per-row render path
  at `ChatRow.tsx:1102-1125` translates to a non-"Completed" card
  presentation.

- **L2847 RED baseline**: 3 RED / 11 PASS — unchanged. The repair
  does not touch the BCB capture / Elm SEAM12 / completion-authority
  / TDD-01 / CPA01 / DCB01 paths.

- **SEAM12, BCB observability repair, prior CORR01 evidence**:
  preserved (working tree retains the untracked ACT reports and
  evidence directories; this ACT adds new files only, not
  modifications to the prior-ACT artifacts).

## 4. The frozen product contract (ACT §1)

| # | Contract | Repair surface |
|---|----------|----------------|
| 1 | A `submit_and_exit` request is not itself proof of task completion. | The per-row marker is now contextual to the held-vs-committed bit. |
| 2 | A held completion attempt must not render as an authoritative `Completed` card. | The held row's `isAuthoritativelyCompletedResult:true` is omitted. The row still exists with its summary text (historical activity), but the `terminalReportFraming` primary marker resolves to a non-"Completed" framing. |
| 3 | The successful committed submission receives the `Completed` presentation. | The committed row's marker is retained. The webview renders the "Completed" badge via the unchanged primary marker path. |
| 4 | Earlier held summaries remain accessible as historical activity. | The held row's `text` (the full summary body) is preserved. The row is not deleted; only the per-row marker is omitted. |
| 5 | Multiple legitimately committed completion episodes may produce multiple `Completed` cards. | The held-vs-committed test requires a runtime-control marker AFTER the tool_result. Without such a marker, the completion tool is treated as committed (Fixture C). |
| 6 | Live and reopened presentation must agree on which submissions were authoritative. | The live path stamps the marker for every completion tool's `content_end` (unchanged). The reopen path now mirrors that, omitting the marker only for HELD rows. So the live "1 authoritative row" matches the reopen "1 authoritative row" for the held-then-committed case. |
| 7 | Task completion cardinality, history persistence, and continuation-control semantics must remain unchanged. | The in-memory `terminalResponseCommittedThisTurn` and the BCB writer path are unchanged. The persisted transcript is unchanged. The continuation-control delivery is unchanged. |
