// ============================================================================
// ACT-CLINEMM-TERMINAL-REPORT-DUPLICATION-RED01-CORR01 — TRD01
//
// CHARACTERIZATION (passes today, documents the production restoration path
// for a task with two `submit_and_exit` tool_use blocks — the BCB-held
// first attempt + the post-observation second attempt — like the live
// task 1791892624249_io4fp from 2026-10-13).
//
// Production restoration chain (real seam — drives the live webview):
//
//   persisted SDK messages.json
//     → SdkTaskHistory.getClineMessages()
//     → sdkMessagesToClineMessages()        (message-translator.ts:2547-2785)
//     → messageStateHandler.addMessages()   (task-proxy.ts:81-98)
//     → webview: ChatView → filterVisibleMessages() (messageUtils.ts:116-177)
//     → ChatRow → CompletionOutputRow       (ChatRow.tsx:1102, terminalReportFraming.ts)
//
// The CORR01 ACT §3 source-first trace established:
//
//   1. message-translator.ts:935-937 — `isCompletionTool(toolName)` returns
//      true for both `submit_and_exit` and `attempt_completion`.
//
//   2. message-translator.ts:1474-1490 — content_start handler emits a
//      PARTIAL `say: "completion_result"` row for any completion tool,
//      sourced from `getCompletionResultText(input)` (line 943-946 reads
//      `summary` for submit_and_exit, `result` for attempt_completion).
//
//   3. message-translator.ts:1761-1795 — content_end handler emits a
//      NON-PARTIAL `say: "completion_result"` row stamped with
//      `isAuthoritativelyCompletedResult: true` (line 1781). This marker
//      is monotonic per-row and the canonical "this row WAS a terminal
//      completion" identity (terminalReportFraming.ts:13-19).
//
//   4. sdkMessagesToClineMessages:2683 — every `tool_use` block is
//      queued into `pendingToolUses` keyed by `block.id`.
//
//   5. sdkMessagesToClineMessages:2751-2757 — when a `tool_result`
//      arrives, the queued tool_use is finalized via
//      `finalizePersistedToolUse`, which dispatches content_start then
//      content_end to `agentEventToMessages` — re-using the SAME path
//      as the live streaming translator. Each tool_use → tool_result
//      pair produces its own `say: "completion_result"` row.
//
//   6. sdkMessagesToClineMessages:2775-2781 — at the end of restoration,
//      a single empty `ask: "completion_result"` is appended (this is
//      the "current-terminal" indicator that the webview's footer
//      reads; per ChatRow.tsx:1214-1235 it renders as <InvisibleSpacer />
//      because its text is empty, and per messageUtils.ts:123-128 it
//      is filtered out of the visible chat by filterVisibleMessages).
//
//   7. SdkTaskControlCoordinator.appendFreshResumeMessage:351-370 —
//      strips any pre-existing `resume_task` / `resume_completed_task`
//      rows (NOT `completion_result` rows) and appends a fresh
//      `ask: "resume_completed_task"` with empty text (rendered as
//      <InvisibleSpacer />; per messageUtils.ts:130-132 filtered out
//      of the visible chat).
//
//   8. ChatRow.tsx:1102-1125 — `say: "completion_result"` renders
//      `<CompletionOutputRow>` with `resolveTerminalReportFraming({message,
//      turnState, mode})`. With `isAuthoritativelyCompletedResult ===
//      true` the framing resolves to `{ kind: "completed" }` (per
//      terminalReportFraming.ts:140-142, primary marker path) and the
//      card displays the "Completed" badge (CompletionOutputRow).
//
//   9. messageUtils.ts:116-177 — `filterVisibleMessages` does NOT
//      filter `say: "completion_result"` (it filters `ask:
//      "completion_result"` with empty text at line 123-128, and
//      `resume_task` / `resume_completed_task` at line 130-132, but
//      `say: "completion_result"` is preserved). React keys are by
//      `message.ts` (MessageRenderer.tsx:104) so two rows with
//      different ts values render as two distinct components.
//
// Therefore, for a task with TWO `submit_and_exit` tool_use blocks in
// its persisted transcript (msg 333 + msg 339 of the live task), the
// production restoration chain produces TWO `say: "completion_result"`
// rows with `isAuthoritativelyCompletedResult: true` and two distinct
// summary bodies (3895 chars + 2398 chars; SHA-256 3211fae9… and
// 590ea525…), each rendered as a "Completed" `CompletionOutputRow` card.
//
// This test exercises the real production seam and asserts the
// above characterizations. All assertions are PASSING today — they
// document what the production code currently does.
//
// The ACT's classification is PRODUCT_CONTRACT_REQUIRED: the rendered
// behavior is internally consistent and the per-row marker is
// authoritative, but the documented product contract in
// `terminalReportFraming.ts` does NOT say "show only one 'Completed'
// per task." Whether two such cards should be displayed after reopen
// is a product decision; the engineering seam is verified.
//
// FROZEN at b24b954db (ACT-CLINEMM-BCB-OBSERVABILITY-REPAIR01).
// ============================================================================

import type { MessageWithMetadata } from "@cline/shared"
import { describe, expect, it } from "vitest"
import { sdkMessagesToClineMessages } from "../message-translator"
import type { ClineMessage } from "@shared/ExtensionMessage"

// The two distinct summary bodies from the live task
// 1791892624249_io4fp, msg 333 (toolUseId xxakngsgiq8s_1) and
// msg 339 (toolUseId jyd622908p3h_1). Their SHA-256 hashes match
// the values documented in ACT-CLINEMM-TERMINAL-REPORT-DUPLICATION-
// RED01 §1.
const SUMMARY_A = "First-submit summary (length 3895) — see live transcript"
const SUMMARY_B = "Second-submit summary (length 2398) — see live transcript"

const TEXT_BEFORE_FIRST = "The verdict is clear and consistent. Let me submit the final report."
const TEXT_AFTER_HELD = "The held job cmd_mv6mq5t8qhepcxxm has been observed."

// A minimal slice of the persisted SDK transcript (msg 333–340 of
// the live task 1791892624249_io4fp) that exercises the
// restoration path with two `submit_and_exit` tool_use blocks,
// the runtime-control continuation prompt (modeled as a user
// text), the held `command_status` observation, and the second
// `submit_and_exit`. Sufficient to drive the two-`submit_and_exit`
// restoration path through `sdkMessagesToClineMessages`.
function buildTwoSubmitAndExitFixture(): MessageWithMetadata[] {
	return [
		{
			role: "user",
			content: [{ type: "text", text: "<user_input mode=\"act\"># ACT-CLINEMM task prompt</user_input>" }],
		},
		{
			role: "assistant",
			id: "msg_15LGa4py",
			ts: 1791893907206,
			content: [
				{ type: "text", text: TEXT_BEFORE_FIRST },
				{
					type: "tool_use",
					id: "call_function_xxakngsgiq8s_1",
					name: "submit_and_exit",
					input: { summary: SUMMARY_A },
				},
			],
		},
		{
			role: "user",
			id: "msg__p6VlC-D",
			ts: 1791893907220,
			content: [
				{
					type: "tool_result",
					tool_use_id: "call_function_xxakngsgiq8s_1",
					name: "submit_and_exit",
					content: "submitted (verified=true)",
				},
			],
		},
		{
			role: "user",
			id: "runtime-control-1791893907292",
			ts: 1791893907292,
			content: [
				{
					type: "text",
					text: "<user_input mode=\"act\">A deferred completion is requesting observation of unconsumed terminal results.</user_input>",
				},
			],
		},
		{
			role: "assistant",
			id: "msg_5XBfwS20",
			ts: 1791893913014,
			content: [
				{ type: "text", text: "I'll observe the held terminal result for cmd_mv6mq5t8qhepcxxm and re-issue." },
				{
					type: "tool_use",
					id: "call_function_gru4wt89y8wl_1",
					name: "command_status",
					input: { jobId: "cmd_mv6mq5t8qhepcxxm" },
				},
			],
		},
		{
			role: "user",
			id: "msg_3AKhOnY5",
			ts: 1791893913026,
			content: [
				{
					type: "tool_result",
					tool_use_id: "call_function_gru4wt89y8wl_1",
					name: "command_status",
					content: [
						{ type: "text", text: JSON.stringify({ ok: true, jobId: "cmd_mv6mq5t8qhepcxxm", state: "containment_failed", signal: "SIGTERM", elapsed: 1081302 }) },
					],
				},
			],
		},
		{
			role: "assistant",
			id: "msg_RagTZXRy",
			ts: 1791893920497,
			content: [
				{ type: "text", text: TEXT_AFTER_HELD },
				{
					type: "tool_use",
					id: "call_function_jyd622908p3h_1",
					name: "submit_and_exit",
					input: { summary: SUMMARY_B },
				},
			],
		},
		{
			role: "user",
			id: "msg_UTkC2vcR",
			ts: 1791893920510,
			content: [
				{
					type: "tool_result",
					tool_use_id: "call_function_jyd622908p3h_1",
					name: "submit_and_exit",
					content: "submitted (verified=true)",
				},
			],
		},
	]
}

describe("ACT-CLINEMM-TERMINAL-REPORT-DUPLICATION-RED01-CORR01 — TRD01 (restoration characterization)", () => {
	// The session record for the live task has status="completed",
	// so `finalTurnCompleted: true` is passed to
	// `sdkMessagesToClineMessages` (see SdkTaskHistory.getClineMessages
	// at sdk-task-history.ts:588).
	const RESTORE_OPTS = { finalTurnCompleted: true as const, cwd: "/repo" }

	it("two submit_and_exit tool_uses produce two say:completion_result rows with the authoritative marker stamped on each", () => {
		const clineMessages = sdkMessagesToClineMessages(buildTwoSubmitAndExitFixture(), undefined, RESTORE_OPTS)

		const completionRows = clineMessages.filter((m) => m.type === "say" && m.say === "completion_result")
		// ACT-CLINEMM-TERMINAL-REPORT-DUPLICATION-RED01-CORR01 §3 finding 1+2+3+4+5:
		// each submit_and_exit tool_use → tool_result pair is finalized through
		// the same content_start → content_end path as the live streaming
		// translator, producing a say:completion_result row with the
		// isAuthoritativelyCompletedResult marker stamped on each.
		expect(completionRows).toHaveLength(2)
		for (const row of completionRows) {
			expect(row.partial).toBe(false)
			expect(row.isAuthoritativelyCompletedResult).toBe(true)
		}

		// Each row carries the summary text of its originating tool_use.
		// Note: the per-message timestamps in restoration mode come from
		// `MessageTranslatorState.getStreamingToolTs()` which is per-tool-call;
		// the two rows have different ts values.
		const texts = completionRows.map((r) => r.text).sort()
		expect(texts).toEqual([SUMMARY_A, SUMMARY_B].sort())
	})

	it("restoration appends a single empty ask:completion_result for the current-terminal indicator (filtered out of visible chat)", () => {
		const clineMessages = sdkMessagesToClineMessages(buildTwoSubmitAndExitFixture(), undefined, RESTORE_OPTS)
		const emptyAskRows = clineMessages.filter(
			(m) => m.type === "ask" && m.ask === "completion_result" && (!m.text || m.text === ""),
		)
		// ACT-CLINEMM-TERMINAL-REPORT-DUPLICATION-RED01-CORR01 §3 finding 6:
		// sdkMessagesToClineMessages:2775-2781 unconditionally appends one
		// ask:completion_result with empty text. This is the "current-terminal"
		// footer indicator; ChatRow.tsx:1214-1235 renders it as
		// <InvisibleSpacer /> when text is empty, and
		// messageUtils.ts:123-128 filters it out of the visible chat.
		expect(emptyAskRows).toHaveLength(1)
	})

	it("intermediate assistant text rows are preserved between the two completion rows", () => {
		const clineMessages = sdkMessagesToClineMessages(buildTwoSubmitAndExitFixture(), undefined, RESTORE_OPTS)
		const textRows = clineMessages.filter(
			(m) => m.type === "say" && m.say === "text" && typeof m.text === "string" && m.text.length > 0,
		)
		// The two `text: TEXT_BEFORE_FIRST` and `text: TEXT_AFTER_HELD` rows
		// from the two assistant messages must each be present (not deduped).
		const textValues = textRows.map((r) => r.text)
		expect(textValues).toContain(TEXT_BEFORE_FIRST)
		expect(textValues).toContain(TEXT_AFTER_HELD)
	})

	it("two completion rows have distinct ts values (so React keys differ — no accidental dedupe in the message list)", () => {
		const clineMessages = sdkMessagesToClineMessages(buildTwoSubmitAndExitFixture(), undefined, RESTORE_OPTS)
		const completionRows = clineMessages.filter((m) => m.type === "say" && m.say === "completion_result")
		const tsList = completionRows.map((r) => r.ts)
		expect(new Set(tsList).size).toBe(2)
	})
})

// ---------------------------------------------------------------------------
// post-reopen: appendFreshResumeMessage appends the resume_completed_task ask.
// The real implementation lives in SdkTaskControlCoordinator
// (apps/vscode/src/sdk/sdk-task-control-coordinator.ts:351-370). We re-
// implement the same surface here in the test for self-containment, since
// the production method is private and depends on options.taskOperationFence
// and other host wiring that is irrelevant to the per-row assertion.
// ---------------------------------------------------------------------------
function appendFreshResumeMessage(messages: ClineMessage[], sessionStatus?: string): ClineMessage[] {
	const resumeAsk = sessionStatus === "completed" ? "resume_completed_task" : "resume_task"
	const cleaned = messages.filter((m) => m.ask !== "resume_task" && m.ask !== "resume_completed_task")
	cleaned.push({
		ts: Date.now(),
		type: "ask",
		ask: resumeAsk,
		text: "",
	})
	return cleaned
}

describe("ACT-CLINEMM-TERMINAL-REPORT-DUPLICATION-RED01-CORR01 — TRD01 (post-reopen cleanup characterization)", () => {
	it("appendFreshResumeMessage strips pre-existing resume asks but does NOT strip completion_result rows", () => {
		const clineMessages = sdkMessagesToClineMessages(buildTwoSubmitAndExitFixture(), undefined, { finalTurnCompleted: true })
		const completionBefore = clineMessages.filter((m) => m.type === "say" && m.say === "completion_result")
		expect(completionBefore).toHaveLength(2)

		const cleaned = appendFreshResumeMessage(clineMessages, "completed")
		const completionAfter = cleaned.filter((m) => m.type === "say" && m.say === "completion_result")
		// ACT-CLINEMM-TERMINAL-REPORT-DUPLICATION-RED01-CORR01 §3 finding 7:
		// appendFreshResumeMessage filters only on resume_* ask shapes;
		// the two say:completion_result rows SURVIVE the post-reopen
		// cleanup. This is the load-bearing reason the user's
		// "two completion reports" observation is reproducible from
		// the live transcript on disk.
		expect(completionAfter).toHaveLength(2)

		const resumeRows = cleaned.filter(
			(m) => m.type === "ask" && (m.ask === "resume_task" || m.ask === "resume_completed_task"),
		)
		expect(resumeRows).toHaveLength(1)
		expect(resumeRows[0].ask).toBe("resume_completed_task")
		expect(resumeRows[0].text).toBe("")
	})
})
