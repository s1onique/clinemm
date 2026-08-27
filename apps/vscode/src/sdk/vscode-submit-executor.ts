/**
 * ACT-CLINEMM-SEATBELT-YOLO-COMPLETION-AUTHORITY-IMPLEMENTATION01
 *
 * PASSIVE host-side executor for the `submit_and_exit` tool.
 *
 * The runtime registers `submit_and_exit` whenever
 * `CoreSessionConfig.enableSubmitAndExit === true` AND the host supplies
 * a `submit` executor via `VscodeSessionHostOptions`. This module is the
 * canonical PASSIVE implementation: it accepts the submitted summary,
 * returns a deterministic acknowledgment, and DOES NOT:
 *
 *   - mutate task phase / turn state
 *   - synthesize completion_result messages
 *   - post directly to the webview
 *   - retag / republish messages
 *   - invoke any observer / telemetry callback (telemetry is wired
 *     through the runtime's standard tool-event channel, NOT through
 *     this executor — see message-translator.ts which consumes the
 *     submit_and_exit tool_use and emits the corresponding
 *     `completion_result` + `attemptCompletionSeen` +
 *     `terminalResponseCommittedThisTurn` signals).
 *
 * Why no callback hook: completion-authority semantics are bound to
 * the runtime tool event stream. Adding a `submit → callback` observer
 * here would create a second completion-authority seam that bypasses
 * the message-translator, contradicting the frozen architecture.
 *
 * Invariants:
 *   - Pure (no state mutation, no globals, no side effects beyond
 *     producing the return value).
 *   - Synchronous-fast (no I/O, no awaits). The runtime enforces a
 *     `submitTimeoutMs` so even if a future variant does more work,
 *     it cannot block the turn indefinitely.
 *   - Never throws — returns a deterministic string for any input. The
 *     SDK's `withTimeout` wrapper translates a thrown error into a
 *     tool error; we keep the executor happy-path-only.
 */

import type { ToolExecutors } from "@cline/core"

/**
 * The canonical VS Code host-side submit executor. The runtime invokes
 * it with the validated `summary` and `verified` fields extracted from
 * the SDK's `SubmitInput` zod schema (sdk/packages/core/src/extensions/
 * tools/definitions.ts:createSubmitAndExitTool).
 *
 * Returns `ToolExecutors["submit"]` (the SDK's canonical shape) so
 * downstream wiring can directly assign the result without an `as`.
 */
export function createVscodeSubmitExecutor(): ToolExecutors["submit"] {
	return async (_summary: string, verified: boolean): Promise<string> => {
		// Deterministic, schema-stable acknowledgment. The shape matches
		// the SDK's canonical "submitted" echo so existing dogfood
		// assertions (submit_and_exit.execute returning a string) match.
		return verified ? "submitted (verified=true)" : "submitted"
	}
}
