/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-REAL-DOGFOOD-POST-TERMINAL-AUTHORITY-SPLIT-TRIAGE01
 *
 * Bounded same-push / same-logical-instant diagnostic capture for the
 * post-terminal authority split the LIVE-E71-R1 walk exposed. The
 * caller (the SdkController and the webview ExtensionStateContext
 * reducer) is expected to invoke `recordPostTerminalAuthoritySnapshot()`
 * on the boundary of every push. The diagnostic is OPT-IN: until
 * `enable()` is called the recorder is a complete no-op so production
 * path-semantics are unchanged in the default build.
 *
 * Trust binding:
 *   - read-only: never mutates the production state shape
 *   - bounded: ring buffer of 64 records (default), expandable via
 *     `setPostTerminalAuthorityDiagnosticBufferSize(n)` for tests
 *   - privacy-safe: no prompt content, no model output, no tool args
 *   - test-visible: `get()`, `getLatest()`, `clear()` are exported
 *
 * Halt-rule posture:
 *   H3 (changes task behavior): the capture is a single synchronous
 *       object construction with no I/O, allocation is bounded and
 *       observable in a Vitest harness.
 *   H4 (no push correlation): the pushId is taken from the existing
 *       wire `stateVersion` field, so the extension-side and the
 *       webview-side recorders correlate without any new wire field.
 *
 * Repo files consumed (read-only):
 *   - apps/vscode/src/shared/ExtensionMessage.ts
 *       ThinkingPresentationProjection, TaskHeaderTelemetryStrip, TurnState
 *   - apps/vscode/src/sdk/task-state-shadow-recorder.ts
 *       ArbiterSnapshot (execution: AgentRuntimeExecutionState; status;
 *       recoveryState; pendingToolCalls)
 *   - apps/vscode/src/sdk/task-state-shadow-arbiter-mapper.ts
 *       ThinkingPresentationProjection producer
 */

import type { TaskHeaderTelemetryStrip, ThinkingPresentationProjection, TurnPhase } from "./ExtensionMessage"

// ============================================================================
// INTENTIONAL DESIGN NOTE
// ============================================================================
// This module is the SHARED post-terminal-authority diagnostic schema and
// ring buffer. It is intentionally free of `ArbiterSnapshot` and
// `@cline/shared` runtime imports so it can be imported from BOTH the
// extension-host process (which compiles `apps/vscode/src/sdk/*`) AND the
// webview bundle (which compiles only `apps/vscode/webview-ui/src/*`).
//
// The extension-side helper that builds snapshots from the
// `ArbiterSnapshot` lives in
// `apps/vscode/src/sdk/post-terminal-authority-diagnostic-builder.ts` and
// imports this module. The webview side builds snapshots from the raw
// `ExtensionState` directly (it has no ArbiterSnapshot on the wire).
// ============================================================================

const DEFAULT_BUFFER_SIZE = 64

/**
 * The T0 diagnostic record. Same pushed payload / version capture shape
 * as frozen in the ACT plan. Every field is optional so the caller can
 * capture partial states (e.g. before the shadow has produced an
 * ArbiterSnapshot).
 */
export interface PostTerminalAuthoritySnapshot {
	/**
	 * The wire monotonic counter. Identical between the extension
	 * side and the webview side because both read `state.stateVersion`.
	 * `stateVersion` equality proves same-push / same-payload-version
	 * correlation; wall-clock `capturedAt` is separately recorded so
	 * the diagnostic can measure transport/apply latency.
	 */
	readonly stateVersion: number
	/** Date.now() at the moment of capture. Strictly >= the prior record. */
	readonly capturedAt: number
	/**
	 * Side marker. The extension side captures this BEFORE the
	 * postMessage call; the webview side captures this AFTER the
	 * `setState` reducer applies. Same `stateVersion` proves
	 * same-pushed-payload correlation; it does NOT prove a literal
	 * same wall-clock instant — the two captures are deliberately
	 * separated by VS Code's webview message-delivery latency.
	 */
	readonly origin: "extension" | "webview"

	// Identity
	readonly sessionId?: string
	readonly taskId?: string
	readonly epoch?: number

	// Runtime snapshot (the truth upstream of the trackers)
	readonly runtimeStatus?: string
	readonly runtimeModelStreaming?: boolean
	readonly runtimeAwaitingApproval?: boolean
	readonly runtimePendingToolCount?: number

	// Shadow / ArbiterSnapshot fragments
	readonly shadowStatus?: string
	readonly shadowRecoveryState?: string
	readonly shadowModelStreaming?: boolean
	readonly shadowTooling?: boolean
	readonly shadowAwaitingApproval?: boolean
	readonly shadowPendingToolCount?: number

	// Legacy turnStateTracker (the legacy authority)
	readonly legacyPhase?: TurnPhase
	readonly legacySeq?: number
	readonly legacyAnchorTs?: number

	// E7.1 thinkingPresentation projection
	readonly thinkingPresentation?: ThinkingPresentationProjection

	// Task telemetry (host-cumulative)
	readonly taskTelemetry?: TaskHeaderTelemetryStrip

	// Composer-related authorities (populated only on the webview side)
	readonly buttonConfig?: {
		readonly sendingDisabled?: boolean
		readonly enableButtons?: boolean
		readonly primaryText?: string
		readonly secondaryText?: string
		readonly primaryAction?: string
		readonly secondaryAction?: string
	}
	/**
	 * The chat-reducer local-useState `sendingDisabled`. Only
	 * meaningful on the webview side. Production code reads it
	 * from `useChatState.ts:18`; the diagnostic captures it as a
	 * witness of the post-terminal lockout candidate.
	 */
	readonly chatReducerSendingDisabled?: boolean
	readonly allowQueuedSubmit?: boolean
	/**
	 * The exact production expression in InputSection.tsx:62:
	 *   submitDisabled = sendingDisabled && !allowQueuedSubmit
	 * Captured verbatim so the diagnostic can disambiguate Case A
	 * (buttonConfig wrong) from Case I (chat reducer stuck).
	 */
	readonly submitDisabled?: boolean

	// Follow-up routing
	readonly followupCanSubmit?: boolean
	readonly followupRoute?: string
	readonly pendingResponsePresent?: boolean
	readonly pendingUserMessagePresent?: boolean
}

/**
 * Per-side ring buffer state. Module-level because the diagnostic
 * is opt-in and must not require a class instance to be wired
 * through the constructor.
 */
interface SideBuffer {
	enabled: boolean
	bufferSize: number
	records: readonly PostTerminalAuthoritySnapshot[]
	seq: number
}

function emptySideBuffer(): SideBuffer {
	return {
		enabled: false,
		bufferSize: DEFAULT_BUFFER_SIZE,
		records: [],
		seq: 0,
	}
}

const extensionSide: SideBuffer = emptySideBuffer()
const webviewSide: SideBuffer = emptySideBuffer()

export function enablePostTerminalAuthorityDiagnostic(side: "extension" | "webview"): void {
	if (side === "extension") {
		extensionSide.enabled = true
	} else {
		webviewSide.enabled = true
	}
}

export function disablePostTerminalAuthorityDiagnostic(side: "extension" | "webview"): void {
	if (side === "extension") {
		extensionSide.enabled = false
	} else {
		webviewSide.enabled = false
	}
}

export function setPostTerminalAuthorityDiagnosticBufferSize(side: "extension" | "webview", n: number): void {
	const size = Math.max(0, Math.floor(n))
	if (side === "extension") {
		extensionSide.bufferSize = size
	} else {
		webviewSide.bufferSize = size
	}
}

export function isPostTerminalAuthorityDiagnosticEnabled(side: "extension" | "webview"): boolean {
	return side === "extension" ? extensionSide.enabled : webviewSide.enabled
}

export function clearPostTerminalAuthorityDiagnostic(side: "extension" | "webview"): void {
	if (side === "extension") {
		extensionSide.records = []
		extensionSide.seq = 0
	} else {
		webviewSide.records = []
		webviewSide.seq = 0
	}
}

function sideOf(origin: "extension" | "webview"): SideBuffer {
	return origin === "extension" ? extensionSide : webviewSide
}

/**
 * Append one record. No-op when the side is disabled. The bounded
 * ring is a simple FIFO trim: when the buffer is full, drop the
 * oldest record. The `seq` counter is independent of the wire
 * `stateVersion` so callers can also use it for assertion.
 */
export function recordPostTerminalAuthoritySnapshot(snapshot: PostTerminalAuthoritySnapshot): void {
	const side = sideOf(snapshot.origin)
	if (!side.enabled) {
		return
	}
	side.seq += 1
	const next = [...side.records, snapshot]
	if (next.length > side.bufferSize) {
		next.splice(0, next.length - side.bufferSize)
	}
	side.records = next
}

export function getPostTerminalAuthorityDiagnosticRecords(
	side: "extension" | "webview",
): readonly PostTerminalAuthoritySnapshot[] {
	return sideOf(side).records
}

export function getPostTerminalAuthorityDiagnosticLatest(
	side: "extension" | "webview",
): PostTerminalAuthoritySnapshot | undefined {
	const records = sideOf(side).records
	return records.length === 0 ? undefined : records[records.length - 1]
}

export function getPostTerminalAuthorityDiagnosticSeq(side: "extension" | "webview"): number {
	return sideOf(side).seq
}

/**
 * The extension-side `buildExtensionSnapshotFromState` helper lives
 * in `apps/vscode/src/sdk/post-terminal-authority-diagnostic-builder.ts`
 * so this shared module stays free of `ArbiterSnapshot`/`@cline/shared`
 * imports (see the INTENTIONAL DESIGN NOTE at the top).
 */

// ============================================================================
// TRANSACTIONAL-TEST-CONTROL SAFETY
// ============================================================================
// The diagnostic is intended to be used by Vitest tests that enable
// capture, trigger actions, then assert on the captured records. The
// helpers below extend the lifecycle:
//
//   beforeEach:
//     clearPostTerminalAuthorityDiagnostic("extension")
//     clearPostTerminalAuthorityDiagnostic("webview")
//     enablePostTerminalAuthorityDiagnostic("extension")
//     enablePostTerminalAuthorityDiagnostic("webview")
//
//   afterEach:
//     disablePostTerminalAuthorityDiagnostic("extension")
//     disablePostTerminalAuthorityDiagnostic("webview")
//
// In production the capture is never enabled; the production path
// never invokes `recordPostTerminalAuthoritySnapshot` so the buffer
// stays empty.

/**
 * For tests only: convenience to enable both sides at once.
 */
export function enablePostTerminalAuthorityDiagnosticBoth(): void {
	enablePostTerminalAuthorityDiagnostic("extension")
	enablePostTerminalAuthorityDiagnostic("webview")
}

export function disablePostTerminalAuthorityDiagnosticBoth(): void {
	disablePostTerminalAuthorityDiagnostic("extension")
	disablePostTerminalAuthorityDiagnostic("webview")
}

export function clearPostTerminalAuthorityDiagnosticBoth(): void {
	clearPostTerminalAuthorityDiagnostic("extension")
	clearPostTerminalAuthorityDiagnostic("webview")
}
