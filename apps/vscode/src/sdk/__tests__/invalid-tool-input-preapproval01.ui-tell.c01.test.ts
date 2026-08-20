/**
 * ACT-CLINEMM-INVALID-TOOL-INPUT-PREAPPROVAL01-CORRECTION01 — UI-tell
 * production-seam closure (TI_UI01..TI_UI03).
 *
 * Complements the agent-runtime RED tests in
 * `invalid-tool-input-preapproval01.iti.test.ts`. The ITI suite
 * proves the runtime invariant: approvalCalls=0 and executorCalls=0
 * for schema-invalid tool calls. The agent-runtime seam uses
 * `executePreparedTool` to synthesize
 *   result = { output: { error: skipReason }, isError: true }
 * and feeds that back to the SDK stream as a `content_end` event
 * with `event.error` set.
 *
 * The P1 question the reviewer raised: does the rendered webview
 * presentation truthfully reflect that NO approval was requested
 * and NO execution happened?
 *
 * The boundary is the message-translator's `content_end` branch
 * for run_commands at message-translator.ts:1665-1679. The
 * translator emits say:"command" with commandCompleted:true and
 * text composed as
 *   `${commandText}\n${COMMAND_OUTPUT_STRING}\n${outputStr}`
 * where outputStr = `Error: ${event.error}`. The webview
 * CommandOutputRow derives isCommandPending/isCommandExecuting/
 * isCommandCompleted from `commandCompleted` and from whether the
 * text contains the COMMAND_OUTPUT_STRING marker. The error path
 * produces commandCompleted:true AND the marker, which resolves
 * to the "Completed" status pill, NOT "Pending" or "Executing".
 *
 * EXTENSION-SIDE TRUTHFUL CONTRACT for a rejected run_commands call:
 *   - say === "command"
 *   - commandCompleted === true
 *   - text includes the COMMAND_OUTPUT_STRING marker and the
 *     verbatim validation error
 *   - text does NOT include the REQ_APP marker (the marker that
 *     triggers the "model requires explicit approval" badge in
 *     CommandOutputRow.tsx:248-253)
 *
 * The hardcoded webview header text "Cline wants to execute this
 * command:" at ChatRow.tsx:320 is independent of the
 * message-translator contract and is the documented pre-existing
 * webview-side cosmetic residue (NOT the approval-pending card).
 */

import type { CoreSessionEvent } from "@cline/core"
import type { AgentEvent } from "@cline/shared"
import { COMMAND_OUTPUT_STRING, COMMAND_REQ_APP_STRING } from "@shared/combineCommandSequences"
import { describe, expect, it } from "vitest"
import { MessageTranslatorState, translateSessionEvent } from "../message-translator"

function contentStartEvent(toolName: string, input: unknown, toolCallId: string): CoreSessionEvent {
	return {
		type: "agent_event",
		payload: {
			sessionId: "session-ui-1",
			event: {
				type: "content_start",
				contentType: "tool",
				toolName,
				toolCallId,
				input,
			} as AgentEvent,
		},
	}
}

function contentEndEventWithError(toolName: string, toolCallId: string, error: string): CoreSessionEvent {
	return {
		type: "agent_event",
		payload: {
			sessionId: "session-ui-1",
			event: {
				type: "content_end",
				contentType: "tool",
				toolName,
				toolCallId,
				error,
			} as AgentEvent,
		},
	}
}

// ACT-CLINEMM-REJECTED-COMMAND-PRESENTATION-TRUTH01: content_end
// helper that carries the typed lifecycle disposition populated by the
// runtime's executePreparedTool stamp. The translator MUST preserve
// this verbatim on the resulting ClineMessage.
function contentEndEventWithDisposition(
	toolName: string,
	toolCallId: string,
	error: string,
	executionDisposition: "executed" | "rejected_before_execution",
): CoreSessionEvent {
	return {
		type: "agent_event",
		payload: {
			sessionId: "session-ui-1",
			event: {
				type: "content_end",
				contentType: "tool",
				toolName,
				toolCallId,
				error,
				executionDisposition,
			} as AgentEvent,
		},
	}
}

function contentEndEventSuccess(toolName: string, toolCallId: string, output: string): CoreSessionEvent {
	return {
		type: "agent_event",
		payload: {
			sessionId: "session-ui-1",
			event: {
				type: "content_end",
				contentType: "tool",
				toolName,
				toolCallId,
				output,
			} as AgentEvent,
		},
	}
}

describe("ACT-CLINEMM-INVALID-TOOL-INPUT-PREAPPROVAL01-CORRECTION01 / UI-tell seam", () => {
	// TI_UI01 — When prepareToolExecution rejects with inputParseError,
	// executePreparedTool sets result.output.error = skipReason and
	// that surfaces as content_end.event.error. The message-translator
	// MUST emit a say:"command" row that has commandCompleted: true,
	// body text containing the COMMAND_OUTPUT_STRING marker AND the
	// verbatim validation error, and does NOT contain REQ_APP (which
	// would falsely trigger the approval badge in CommandOutputRow
	// line 248).
	it("TI_UI01_REJECTED_COMMAND_RENDERS_AS_ERRORED_COMPLETED_NOT_PENDING", () => {
		const state = new MessageTranslatorState()
		const streaming = translateSessionEvent(
			contentStartEvent("run_commands", { commands: [{ command: "git status" }], timeout: 120000 }, "call-ui-1"),
			state,
		)
		const streamingCommandRows = streaming.messages.filter((m) => m.say === "command")
		expect(streamingCommandRows).toHaveLength(1)
		expect(streamingCommandRows[0].partial).toBe(true)
		expect(streamingCommandRows[0].commandCompleted).toBeFalsy()

		const finalized = translateSessionEvent(
			contentEndEventWithError(
				"run_commands",
				"call-ui-1",
				"Invalid input for tool run_commands: expected string, received object at commands[0]",
			),
			state,
		)
		const commandRows = finalized.messages.filter((m) => m.say === "command")
		expect(commandRows, "exactly one finalized say:'command' row").toHaveLength(1)

		const row = commandRows[0]
		expect(row.partial).toBe(false)
		expect(row.commandCompleted).toBe(true)

		const text = row.text ?? ""
		expect(text).toContain(COMMAND_OUTPUT_STRING)
		expect(text).toMatch(/Invalid input for tool run_commands/)
		expect(text).toMatch(/expected string, received object/)
		expect(text).not.toContain(COMMAND_REQ_APP_STRING)
	})

	// TI_UI02 — Even when autoApprove would normally bypass approval,
	// schema-invalid input still must NOT mark the row as
	// approval-pending (the same message-translator contract applies
	// across policy variants).
	it("TI_UI02_REJECTED_COMMAND_NO_REQ_APP", () => {
		const state = new MessageTranslatorState()
		translateSessionEvent(contentStartEvent("run_commands", { commands: "ls" }, "call-ui-2"), state)
		const finalized = translateSessionEvent(
			contentEndEventWithError(
				"run_commands",
				"call-ui-2",
				"Invalid input for tool run_commands: expected array, received string",
			),
			state,
		)

		const commandRows = finalized.messages.filter((m) => m.say === "command")
		expect(commandRows).toHaveLength(1)
		const row = commandRows[0]
		expect(row.say).toBe("command")
		expect(finalized.messages.some((m) => m.type === "ask")).toBe(false)
		expect(row.text ?? "").not.toContain(COMMAND_REQ_APP_STRING)
		expect(row.text ?? "").toContain("expected array, received string")
	})

	// TI_UI03 — RESIDUE: the hardcoded row title "Cline wants to
	// execute this command:" at webview ChatRow.tsx:320 is
	// independent of the message-translator contract and is the
	// pre-existing webview-side cosmetic residue. This test pins
	// the translator contract for rejected input, alongside the
	// contract for a real run that produced an error, so a future
	// change to the translator can be checked against this
	// baseline. Both rows are commandCompleted:true with output
	// marker AND no REQ_APP marker — the webview's hardcoded row
	// title is the documented residue.
	it("TI_UI03_RESIDUE_TRANSLATOR_CONTRACT_PINNED", () => {
		const stateRejected = new MessageTranslatorState()
		const stateErrored = new MessageTranslatorState()

		translateSessionEvent(
			contentStartEvent("run_commands", { commands: [{ command: "git status" }], timeout: 120000 }, "arm-A"),
			stateRejected,
		)
		const finalizedRejected = translateSessionEvent(
			contentEndEventWithError("run_commands", "arm-A", "Invalid input for tool run_commands"),
			stateRejected,
		)

		translateSessionEvent(contentStartEvent("run_commands", { commands: ["git status"] }, "arm-B"), stateErrored)
		const finalizedErrored = translateSessionEvent(
			contentEndEventWithError("run_commands", "arm-B", "git: not a repository (or any parent): '.git'"),
			stateErrored,
		)

		const rejected = finalizedRejected.messages.filter((m) => m.say === "command")
		const errored = finalizedErrored.messages.filter((m) => m.say === "command")
		expect(rejected).toHaveLength(1)
		expect(errored).toHaveLength(1)

		expect(rejected[0].commandCompleted).toBe(true)
		expect(errored[0].commandCompleted).toBe(true)
		expect(rejected[0].partial).toBe(false)
		expect(errored[0].partial).toBe(false)
		expect(rejected[0].text).toContain(COMMAND_OUTPUT_STRING)
		expect(errored[0].text).toContain(COMMAND_OUTPUT_STRING)
		expect(rejected[0].text).not.toContain(COMMAND_REQ_APP_STRING)
		expect(errored[0].text).not.toContain(COMMAND_REQ_APP_STRING)
	})

	// ACT-CLINEMM-REJECTED-COMMAND-PRESENTATION-TRUTH01 — translator
	// seam tests for the new typed lifecycle disposition. The runtime
	// stamps `executionDisposition` on toolCall.metadata; the bridge
	// (`@cline/core/src/runtime/orchestration/runtime-event-adapter.ts`)
	// propagates it to the legacy content_end; this translator must
	// carry it through verbatim onto `ClineMessage`. These tests pin
	// the translator contract extension so a future regression that
	// drops the typed signal at the translator fails here.

	it("TI_UI04_TRANSLATOR_PROPAGATES_REJECTED_DISPOSITION", () => {
		const state = new MessageTranslatorState()
		translateSessionEvent(contentStartEvent("run_commands", { commands: "ls" }, "call-ui-4"), state)
		const finalized = translateSessionEvent(
			contentEndEventWithDisposition(
				"run_commands",
				"call-ui-4",
				"Invalid input for tool run_commands: expected array, received string",
				"rejected_before_execution",
			),
			state,
		)

		const commandRows = finalized.messages.filter((m) => m.say === "command")
		expect(commandRows).toHaveLength(1)
		expect(commandRows[0].commandExecutionDisposition).toBe("rejected_before_execution")
	})

	it("TI_UI05_TRANSLATOR_PROPAGATES_EXECUTED_DISPOSITION", () => {
		const state = new MessageTranslatorState()
		translateSessionEvent(contentStartEvent("run_commands", { commands: ["git status"] }, "call-ui-5"), state)
		const finalized = translateSessionEvent(
			contentEndEventWithDisposition(
				"run_commands",
				"call-ui-5",
				"git: not a repository (or any parent): '.git'",
				"executed",
			),
			state,
		)

		const commandRows = finalized.messages.filter((m) => m.say === "command")
		expect(commandRows).toHaveLength(1)
		expect(commandRows[0].commandExecutionDisposition).toBe("executed")
	})

	it("TI_UI06_TRANSLATOR_DISTINGUISHES_EXECUTED_FROM_REJECTED_AT_IDENTICAL_ERROR_TEXT", () => {
		// The §16 anti-text-heuristic guard at the translator seam:
		// the same free-form error string must classify correctly
		// based on the typed disposition field, not the text.
		const sameError = "Invalid input for tool run_commands: unexpected shape"
		const stateRejected = new MessageTranslatorState()
		translateSessionEvent(contentStartEvent("run_commands", { commands: "ls" }, "arm-rej"), stateRejected)
		const finalizedRejected = translateSessionEvent(
			contentEndEventWithDisposition("run_commands", "arm-rej", sameError, "rejected_before_execution"),
			stateRejected,
		)
		const rejectedRows = finalizedRejected.messages.filter((m) => m.say === "command")
		expect(rejectedRows[0].commandExecutionDisposition).toBe("rejected_before_execution")

		const stateExecuted = new MessageTranslatorState()
		translateSessionEvent(contentStartEvent("run_commands", { commands: ["git status"] }, "arm-exe"), stateExecuted)
		const finalizedExecuted = translateSessionEvent(
			contentEndEventWithDisposition("run_commands", "arm-exe", sameError, "executed"),
			stateExecuted,
		)
		const executedRows = finalizedExecuted.messages.filter((m) => m.say === "command")
		expect(executedRows[0].commandExecutionDisposition).toBe("executed")
	})
})
