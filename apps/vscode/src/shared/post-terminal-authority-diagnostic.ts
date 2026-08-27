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
 *       ThinkingPresentationProjection, TaskHeaderPresentationProjection,
 *       TaskHeaderTelemetryStrip, TurnState
 *   - apps/vscode/src/sdk/task-state-shadow-recorder.ts
 *       ArbiterSnapshot (execution: AgentRuntimeExecutionState; status;
 *       recoveryState; pendingToolCalls)
 *   - apps/vscode/src/sdk/task-state-shadow-arbiter-mapper.ts
 *       ThinkingPresentationProjection producer
 *       TaskHeaderPresentationProjection producer
 */

import type {
	TaskHeaderPresentationProjection,
	TaskHeaderTelemetryStrip,
	ThinkingPresentationProjection,
	TurnPhase,
} from "./ExtensionMessage"

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
/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-REAL-DOGFOOD-POST-TERMINAL-AUTHORITY-SPLIT-TRIAGE01-C2-CORRECTION01-REPLICA-TRUTH
 *
 * The `captureKind` discriminator identifies WHICH capture site a record
 * came from. The C2 live smoke proved that every webview-side record was
 * effectively equivalent (all from the `webview-replica` site), making it
 * impossible to tell input-section decisions apart from action-buttons
 * decisions apart from follow-up-route decisions. With `captureKind` the
 * diagnostic can assert per-site coverage.
 *
 * ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-POST-TERMINAL-AUTHORITY-SPLIT-C2-CORRECTION02-RAW-INCOMING-TRUTH
 *
 * The C2R isolated replay proved the production applyTurnState reducer is
 * correct for the live E1-E9 sequence; the defect, if real, lives OUTSIDE
 * the authorized replica boundary. The `webview-raw-incoming` captureKind
 * adds a paired record stamped BEFORE the reducer mutates the raw incoming
 * payload, on the SAME `_ptadPushId` as the post-reducer `webview-replica`
 * record. The pair makes the boundary decision binary:
 *
 *   extension.current != rawIncoming   -> W1_PRE_APPLY (corruption before webview apply)
 *   rawIncoming != applied             -> W2_DURING_APPLY (corruption during apply)
 *   rawIncoming == applied             -> W3_POST_CONTEXT (consumer/memoization)
 *
 * The capture is OPT-IN: when PTAD is disabled (production default), neither
 * the raw nor the applied record is emitted and the wire shape is unchanged.
 */
export type PostTerminalAuthorityCaptureKind =
	| "extension-push"
	| "webview-raw-incoming"
	/**
	 * ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-C2-CORRECTION02-FIXUP04-PURE-UPDATER-EVIDENCE:
	 * React-committed state, emitted once per React commit from a
	 * `useEffect` keyed on `[state]`. Corresponds to the LATEST
	 * `_ptadPushId` only, because React 18+ automatic batching
	 * coalesces multiple setState calls into a single commit. This
	 * is the true downstream / context consumer view.
	 *
	 * FIXUP04 removed the intermediate `webview-reducer-output`
	 * capture kind (FIXUP03) because it required the functional
	 * updater to write to a ref map, which is an externally
	 * observable side effect inside what React's contract requires
	 * to be a pure calculate-and-return function. The diagnostic now
	 * captures only the two observable boundaries: wire-side arrival
	 * and React commit.
	 */
	| "webview-committed"
	| "input-section"
	| "action-buttons"
	| "followup-route"

export interface PostTerminalAuthoritySnapshot {
	/**
	 * The wire monotonic counter. Identical between the extension
	 * side and the webview side because both read `state.stateVersion`.
	 * `stateVersion` equality proves same-push / same-payload-version
	 * correlation; wall-clock `capturedAt` is separately recorded so
	 * the diagnostic can measure transport/apply latency.
	 *
	 * ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-REAL-DOGFOOD-POST-TERMINAL-AUTHORITY-SPLIT-TRIAGE01-C2-CORRECTION01-REPLICA-TRUTH:
	 * `stateVersion` is no longer the primary PTAD correlation authority
	 * — see `_ptadPushId` below. It is retained as a witness because the
	 * webview's `messageReducer.applyStateSnapshot` still uses it as
	 * the snapshot-version gate.
	 */
	readonly stateVersion: number
	/**
	 * ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-REAL-DOGFOOD-POST-TERMINAL-AUTHORITY-SPLIT-TRIAGE01-C2-CORRECTION01-REPLICA-TRUTH
	 *
	 * Diagnostic-only monotonic push ID. The extension mints a fresh
	 * value (from the shared `MessageIdMinter.nextSeq()` counter) on
	 * every `ExtensionState` push and stamps it into both the wire
	 * payload (a private `_ptadPushId` field) and the extension
	 * diagnostic record. The webview propagates the same value into
	 * every diagnostic record it emits — the webview NEVER derives the
	 * value independently. `_ptadPushId` equality across records
	 * proves they refer to the same `ExtensionState` push, regardless
	 * of `stateVersion`.
	 *
	 * `undefined` when PTAD is disabled (no monotonic counter stamped
	 * into the wire payload). In production (PTAD off), this field is
	 * never set on any record and has zero observable effect.
	 */
	readonly _ptadPushId?: number
	/**
	 * Which capture site produced this record. The C2 live smoke showed
	 * that without `captureKind` the webview records collapsed into a
	 * single ambiguous bucket. See the `PostTerminalAuthorityCaptureKind`
	 * union for the full taxonomy.
	 */
	readonly captureKind: PostTerminalAuthorityCaptureKind
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

	/**
	 * ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-POST-TERMINAL-AUTHORITY-SPLIT-C2-CORRECTION02-RAW-INCOMING-TRUTH
	 *
	 * Raw incoming payload fields. These record the values on the `stateData`
	 * argument as parsed from `JSON.parse(response.stateJson)`, BEFORE the
	 * production `applyStateSnapshot` reducer mutates the `stateData.turnState`
	 * in place. They are populated on both the `webview-raw-incoming` and the
	 * `webview-replica` records (the latter for paired-with-applied comparison)
	 * so a single diagnostic dump lets the analyzer correlate the raw truth
	 * with the post-reducer applied truth on the same `_ptadPushId`.
	 *
	 * The existing `legacyPhase` / `legacySeq` keep their meaning as the
	 * post-reducer applied view (consumed by the C2R replay tests), so adding
	 * these explicit `rawIncoming*` aliases is purely additive and cannot
	 * silently re-purpose existing semantics.
	 */
	readonly rawIncomingLegacyPhase?: TurnPhase
	readonly rawIncomingLegacySeq?: number
	/**
	 * Explicit applied view, populated on the `webview-replica` record for
	 * paired-with-raw comparison. Functionally identical to `legacyPhase` /
	 * `legacySeq` (which are always the post-reducer applied values), but
	 * the explicit `applied*` name makes forensic analysis self-documenting.
	 */
	readonly appliedLegacyPhase?: TurnPhase
	readonly appliedLegacySeq?: number

	// E7.1 thinkingPresentation projection
	readonly thinkingPresentation?: ThinkingPresentationProjection

	// ACT-CLINEMM-TASKHEADER-CANONICAL-PROJECTION-MIGRATION01:
	// TaskHeader presentation projection (state label authority).
	readonly taskHeaderPresentation?: TaskHeaderPresentationProjection

	// Task telemetry (host-cumulative)
	readonly taskTelemetry?: TaskHeaderTelemetryStrip

	/**
	 * ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-POST-TERMINAL-AUTHORITY-SPLIT-C2-CORRECTION02-RAW-INCOMING-TRUTH
	 *
	 * Raw incoming `thinkingPresentation`, recorded on the
	 * `webview-raw-incoming` capture BEFORE any reducer touches the payload.
	 * This is the cross-check companion to the post-reducer
	 * `thinkingPresentation` field: if the live `bc2c794be` trace showed
	 * the extension's `modelStreaming=false` reached the webview applied
	 * view, comparing these two fields across the same `_ptadPushId`
	 * confirms whether the wire-side projection is identical (raw ==
	 * applied) or whether the reducer mutated it.
	 */
	readonly rawIncomingThinkingPresentation?: ThinkingPresentationProjection

	/**
	 * ACT-CLINEMM-TASKHEADER-CANONICAL-PROJECTION-MIGRATION01:
	 * Raw incoming `taskHeaderPresentation`, recorded on the
	 * `webview-raw-incoming` capture BEFORE any reducer touches the
	 * payload. Companion to the post-reducer `taskHeaderPresentation`
	 * field.
	 */
	readonly rawIncomingTaskHeaderPresentation?: TaskHeaderPresentationProjection

	/**
	 * Raw incoming `taskTelemetry`, recorded on the `webview-raw-incoming`
	 * capture BEFORE any reducer touches the payload. Companion to the
	 * post-reducer `taskTelemetry` field.
	 */
	readonly rawIncomingTaskTelemetry?: TaskHeaderTelemetryStrip

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

	// ACT-CLINEMM-APPLICATION-OWNERSHIP-CONTROL-COHERENCE01-LIVE-CAPTURE01:
	// AOC02 §6 LIVE-synchronized-state capture. None of these fields
	// are populated by default-off production paths; they are stamped
	// only at the action-buttons / input-section / webview-committed
	// capture sites. The fields are PURELY ADDITIVE — no existing
	// semantic is re-purposed.
	/**
	 * The EXACT value passed as `foregroundCommandRunning` to
	 * `getButtonConfigFromState(messages, turnState, mode, foregroundCommandRunning)`
	 * at ActionButtons.tsx:53. The button predicate is the production
	 * seam between committed state and rendered Cancel; capturing the
	 * exact input is required to disambiguate Case A (buttonConfig wrong)
	 * from Case I (chat reducer stuck) and from the LIVE `Idle + Cancel`
	 * contradiction.
	 */
	readonly foregroundCommandRunning?: boolean
	/** Backstop: whether a background command is reportedly running. */
	readonly backgroundCommandRunning?: boolean
	/**
	 * Composer enabled predicate (`!submitDisabled`). Captured at
	 * the input-section site so a single dump correlates composer
	 * ownership with the button config / TaskHeader presentation.
	 */
	readonly composerEnabled?: boolean
	/**
	 * Identity-only tail of `clineMessages`. NO bodies, NO secrets.
	 * Populated at every capture site that has access to the
	 * committed `clineMessages` (action-buttons, input-section,
	 * webview-committed). Disambiguates CASE_L5_TASK_IDENTITY_MIX
	 * from CASE_L2_RENDER_DERIVATION_MISMATCH.
	 */
	readonly messageTail?: {
		readonly ts?: number
		readonly type?: string
		readonly ask?: string
		readonly say?: string
		readonly partial?: boolean
		readonly seq?: number
		readonly epoch?: number
	}

	// ============================================================================
	// ACT-CLINEMM-COMPLETION-PTAD-EXTEND01
	//
	// Causal discriminator for the completion-protocol-liveness family.
	// Both fields are READ from `MessageTranslatorState` at the
	// extension-side capture seam (`SdkController.getStateToPostToWebview`)
	// and live ONLY in the PTAD ring buffer — they NEVER enter the
	// wire payload. Captured only when PTAD is enabled.
	//
	// ABSENT vs false:
	//   absent  = no measurement (PTAD off, or capture site pre-EXTEND01)
	//   false   = a captured `false` (the canonical authority answered no)
	//   true    = a captured `true`  (the canonical authority answered yes)
	// ============================================================================

	/**
	 * Whether the message translator observed the completion tool
	 * (attempt_completion / submit_and_exit) being called this turn.
	 * Sourced from `MessageTranslatorState.wasAttemptCompletionSeen()`.
	 *
	 * The structural test in
	 * `post-terminal-authority-diagnostic-builder.test.ts > S1-EXT01`
	 * proves the value comes from the real `MessageTranslatorState`
	 * authority, not from a duplicated boolean invented in PTAD or
	 * the builder.
	 */
	readonly attemptCompletionSeen?: boolean

	/**
	 * Whether the translator committed a terminal user-facing response
	 * this turn (a finalized say:"completion_result" /
	 * say:"plan_completion_result" / ask:"api_req_failed" row).
	 * Sourced from
	 * `MessageTranslatorState.wasTerminalResponseCommittedThisTurn()`.
	 *
	 * `committed=true` means the canonical terminal surface was
	 * published; downstream presentation is then the relevant
	 * causal seam. `committed=false` means the surface was never
	 * published, regardless of `attemptCompletionSeen`.
	 */
	readonly terminalResponseCommittedThisTurn?: boolean
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
// ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-POST-TERMINAL-AUTHORITY-SPLIT-C2-CORRECTION02-RAW-INCOMING-TRUTH
// ============================================================================
//
// Pure diagnostic classifier. Given the three-way (extension, raw,
// applied) phase/seq tuple on the same _ptadPushId, returns the
// boundary class. This is NOT a runtime reducer — it is a static
// helper for the diagnostic dump analyzer. It is exported because
// the C2-CORRECTION02 RED tests assert it directly.
//
// Classification:
//
//   NO_DIVERGENCE      extension == raw == applied
//   W1_PRE_APPLY       extension != raw, raw == applied
//   W2_DURING_APPLY    extension == raw, raw != applied
//   W4_MULTI_BOUNDARY  extension != raw AND raw != applied
//
// Note: W3_POST_CONTEXT (consumer/memoization divergence with all
// three equal) cannot be detected from this triple alone; the live
// dogfood analyzer inspects a separate consumer-side capture to
// classify W3.

// ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-C2-CORRECTION02-FIXUP01:
// Split classification into two layers:
//
//   - THREE-WAY boundary classification (extension, raw, applied) is a
//     PURE function over the three captures. W3 cannot be detected
//     from this triple alone (W3 means extension == raw == applied with
//     a SEPARATE consumer/memoization divergence), so the pure helper
//     returns `ThreeBoundaryClass` which excludes W3 by design.
//   - FULL boundary classification combines the three-way result with
//     an optional consumer capture so that W3_POST_CONTEXT can be
//     assigned when the three are equal AND the consumer differs.
//
// This split avoids the API misuse of having `classifyBoundary` return
// a W3 value that its inputs cannot actually distinguish.

/**
 * PURE three-way boundary classification. Cannot return W3 (consumer-
 * side divergence) because the inputs do not include a consumer
 * capture. Callers that want W3 must use `classifyFullBoundary` with
 * the additional consumer capture.
 */
export type ThreeBoundaryClass = "NO_DIVERGENCE" | "W1_PRE_APPLY" | "W2_DURING_APPLY" | "W4_MULTI_BOUNDARY"

/**
 * Full five-way classification including W3. The consumer capture is
 * optional: if it is omitted, the helper falls back to the three-way
 * result. To classify W3 the caller MUST provide a consumer capture
 * whose phase/seq differs from the equal triple.
 */
export type BoundaryClass = ThreeBoundaryClass | "W3_POST_CONTEXT"

/**
 * @deprecated Kept as an alias for backward compatibility with the
 * C2-CORRECTION02 `BoundaryClass` declaration. New code should prefer
 * `ThreeBoundaryClass` or `BoundaryClass` directly.
 */
export type BoundaryClassDeprecated = BoundaryClass

interface PhaseSeqPair {
	readonly phase?: TurnPhase
	readonly seq?: number
}

function pairEquals(a: PhaseSeqPair, b: PhaseSeqPair): boolean {
	return a.phase === b.phase && a.seq === b.seq
}

/**
 * Pure three-way boundary classifier. CANNOT return W3.
 *
 *   NO_DIVERGENCE     extension == raw == applied
 *   W1_PRE_APPLY      extension != raw, raw == applied
 *   W2_DURING_APPLY   extension == raw, raw != applied
 *   W4_MULTI_BOUNDARY extension != raw AND raw != applied
 */
export function classifyBoundary(extension: PhaseSeqPair, raw: PhaseSeqPair, applied: PhaseSeqPair): ThreeBoundaryClass {
	const extEqRaw = pairEquals(extension, raw)
	const rawEqApplied = pairEquals(raw, applied)

	if (extEqRaw && rawEqApplied) {
		// Healthy. W3 (consumer-side divergence with all three equal)
		// is NOT classified here — call `classifyFullBoundary` with a
		// consumer capture to assign W3.
		return "NO_DIVERGENCE"
	}
	if (!extEqRaw && rawEqApplied) {
		// Raw matches applied but both diverge from the extension:
		// the corruption happened BEFORE the webview received the
		// payload (or during the wire serialization).
		return "W1_PRE_APPLY"
	}
	if (extEqRaw && !rawEqApplied) {
		// Raw is current but applied is stale: the corruption
		// happened DURING the reducer / apply composition.
		return "W2_DURING_APPLY"
	}
	// Both edges diverge independently: multiple boundaries are
	// faulty. The ACT halts on this case.
	return "W4_MULTI_BOUNDARY"
}

/**
 * Higher-level boundary classifier that combines the three-way
 * equality result with an optional consumer capture. W3 is assigned
 * only when the three captures are pairwise equal AND the consumer
 * capture is provided AND the consumer differs from the equal triple.
 */
export function classifyFullBoundary(
	extension: PhaseSeqPair,
	raw: PhaseSeqPair,
	applied: PhaseSeqPair,
	consumer?: PhaseSeqPair,
): BoundaryClass {
	const threeWay = classifyBoundary(extension, raw, applied)
	if (threeWay !== "NO_DIVERGENCE") {
		return threeWay
	}
	// threeWay is NO_DIVERGENCE: the triple is equal. W3 is only
	// possible here if a consumer capture disagrees.
	if (consumer && !pairEquals(consumer, extension)) {
		return "W3_POST_CONTEXT"
	}
	return "NO_DIVERGENCE"
}

// ============================================================================
// ACT-CLINEMM-APPLICATION-OWNERSHIP-CONTROL-COHERENCE01-LIVE-CAPTURE01:
// AOC02 contradiction detector (pure predicate only)
// ============================================================================
//
// The LIVE W2 contradiction is `TaskHeader=Idle` while `Cancel` is visible.
// The synthetic seam tests (§2, §3, §6) ruled out the obvious static
// paths; the remaining question is what committed state the LIVE render
// actually saw. The contradiction detector is a PURE predicate over one
// `PostTerminalAuthoritySnapshot` that flags any capture whose committed
// UI derivation is incoherent.
//
// The detector does NOT declare a root cause. It only marks capture
// points where the LIVE combination is reproducible. From those flags,
// the next ACT picks a CASE_L1..L5 classification by comparing the
// flagged records side-by-side.
//
// ACT contract (per directive §5):
//   - TaskHeader phase == idle AND secondaryAction == cancel
//   - TaskHeader == idle AND thinkingPresentation.modelStreaming == true
//   - TaskHeader == completed AND (
//       secondaryAction == cancel
//       OR modelStreaming == true
//     )
//
// ACT contract (per directive §3): TaskHeader, Thinking, button config
// all derived from the SAME committed object. The detector consumes one
// `PostTerminalAuthoritySnapshot` so the single-object invariant is
// automatically preserved.
// ============================================================================

export type PostTerminalAuthorityContradictionKind =
	| "IDLE_PLUS_CANCEL"
	| "IDLE_PLUS_MODEL_STREAMING"
	| "COMPLETED_PLUS_ACTIVE_WORK"

/**
 * ACT-CLINEMM-APPLICATION-OWNERSHIP-CONTROL-COHERENCE01-LIVE-CAPTURE01:
 *
 * Pure predicate over one `PostTerminalAuthoritySnapshot`. Returns the
 * contradiction kind if the snapshot is incoherent; otherwise `null`.
 * Intended to run over the bounded ring buffer AFTER the LIVE capture
 * has been preserved, NOT in any synchronous React render path.
 *
 * Test contract (per directive §7):
 *   - D2: coherent Idle => no flag
 *   - D3: Idle + Cancel input => IDLE_PLUS_CANCEL
 *   - D4: Idle + modelStreaming=true => IDLE_PLUS_MODEL_STREAMING
 */
export function classifyContradiction(snapshot: PostTerminalAuthoritySnapshot): PostTerminalAuthorityContradictionKind | null {
	const headerPhase = snapshot.taskHeaderPresentation?.phase
	const modelStreaming = snapshot.thinkingPresentation?.modelStreaming
	const secondaryAction = snapshot.buttonConfig?.secondaryAction

	if (headerPhase === "idle" && secondaryAction === "cancel") {
		return "IDLE_PLUS_CANCEL"
	}
	if (headerPhase === "idle" && modelStreaming === true) {
		return "IDLE_PLUS_MODEL_STREAMING"
	}
	if (headerPhase === "completed" && (secondaryAction === "cancel" || modelStreaming === true)) {
		return "COMPLETED_PLUS_ACTIVE_WORK"
	}
	return null
}

/**
 * ACT-CLINEMM-APPLICATION-OWNERSHIP-CONTROL-COHERENCE01-LIVE-CAPTURE01:
 *
 * Walk the bounded ring buffer and return every flagged record. Useful
 * for LIVE post-capture forensics; not used inside any reactive path.
 */
export function findPostTerminalAuthorityContradictions(
	side: "extension" | "webview",
): readonly { snapshot: PostTerminalAuthoritySnapshot; kind: PostTerminalAuthorityContradictionKind }[] {
	const records = getPostTerminalAuthorityDiagnosticRecords(side)
	const flags: { snapshot: PostTerminalAuthoritySnapshot; kind: PostTerminalAuthorityContradictionKind }[] = []
	for (const r of records) {
		const kind = classifyContradiction(r)
		if (kind !== null) {
			flags.push({ snapshot: r, kind })
		}
	}
	return flags
}

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
