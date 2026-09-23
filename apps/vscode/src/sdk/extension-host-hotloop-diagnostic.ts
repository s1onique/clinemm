/**
 * ACT-CLINEMM-EXTENSION-HOST-SESSION-EVENT-HOTLOOP01
 *
 * TEMPORARY Extension-host hot-loop diagnostic counters.
 * Production-seam counters that pin the load-bearing witness for
 * the EHLOOP01 / extension-host-stability qualification.
 *
 * The counters measure:
 *
 *   - how many session events were observed,
 *   - how many times the synchronous `logQueueEvents` path ran,
 *   - how many `setTurnPhase` / `setWithWriter` writes were
 *     attempted vs. how many produced a real change,
 *   - how many pending-prompt drain events fired, and
 *   - the maximum synchronous re-entry depth of `handleSessionEvent`.
 *
 * DESIGN CONSTRAINTS (frozen in this ACT, mirrors BJLA / BOCOR / CCARD):
 *
 *   - DEFAULT_OFF: every counter is disabled in public builds.
 *   - DOGFOOD_ONLY: enablement is wired by the central dogfood profile.
 *   - BOUNDED: counters are plain numbers / bounded Maps with hard caps.
 *   - NO PROTOCOL FIELD: counters never serialize into proto or ExtensionState.
 *   - NO WEBVIEW FIELD: counters never appear in webview-observable state.
 *   - NO STATE-SEMANTIC DELTA: counters NEVER change observable behavior.
 *   - NO SYNCHRONOUS DISK WRITE: counters are RAM-only.
 *
 * ============================================================================
 * THIS MODULE OWERS OBSERVATION ONLY (CORRECTION02).
 * ============================================================================
 *
 * As of CORRECTION02, this module owns NO production-soundness gate.
 * The synchronous `Logger.log` breadcrumb in `logQueueEvents` is gated
 * by the PERMANENT policy module
 * `extension-host-queue-log-policy.ts`. The diagnostic merely observes
 * whether the breadcrumb fired (via `logQueueEventsCalls`,
 * `logQueueEventsLogCalls`, `logQueueEventsSuppressedByProfile`) — it
 * does not decide whether it can fire.
 *
 * This separation means removing the diagnostic post-qualification
 * (per REMOVAL_TRIGGER below) does NOT touch the production policy.
 *
 * REMOVAL_TRIGGER (per ACT §34, refined in CORRECTION02):
 *   Once the host-stability repair is GREEN on LIVE qualification, OR
 *   CAPTURE_INSUFFICIENT is declared, the following MUST be removed
 *   TOGETHER:
 *
 *     - this counter module (extension-host-hotloop-diagnostic.ts)
 *     - the activation helper (applyExtensionHostHotloopDiagnosticProfile
 *       in dogfood-diagnostic-profile.ts — but ONLY the diagnostic-
 *       enablement half; the queue-log half stays and migrates to a
 *       permanent call site if needed)
 *     - the host-side dump runtime
 *     - the Command Palette registration
 *     - the registry entry
 *     - the package.json command declaration
 *
 *   What MUST remain after removal:
 *
 *     - extension-host-queue-log-policy.ts (PERMANENT)
 *     - applyExtensionHostQueueLogPolicy() invocations in the
 *       dogfood profile resolver (PERMANENT)
 *     - shouldEmitExtensionHostQueueLog() consulted in logQueueEvents
 *       (PERMANENT)
 *
 *   See EHLOOP-REMOVAL-01 for the structural test that pins this
 *   invariant.
 */

const MAX_BUCKETS = 32

export interface ExtensionHostHotloopCounters {
	sessionEvents: number
	handleSessionEventCalls: number
	setTurnPhaseCalls: number
	setWithWriterCalls: number
	samePhaseWriteAttempts: number
	actualPhaseChanges: number
	pendingPromptDrainCalls: number
	pendingPromptDispatchCalls: number
	logQueueEventsCalls: number
	logQueueEventsLogCalls: number
	logQueueEventsSuppressedByProfile: number
	coordinatorLogCalls: number
	maxNestedHandleDepth: number
	overflowed: number
	byEventType: Record<string, number>
	byWriter: Record<string, number>
}

let _enabled = false

let _counters: ExtensionHostHotloopCounters = freshCounters()

let _nestedDepth = 0

function freshCounters(): ExtensionHostHotloopCounters {
	return {
		sessionEvents: 0,
		handleSessionEventCalls: 0,
		setTurnPhaseCalls: 0,
		setWithWriterCalls: 0,
		samePhaseWriteAttempts: 0,
		actualPhaseChanges: 0,
		pendingPromptDrainCalls: 0,
		pendingPromptDispatchCalls: 0,
		logQueueEventsCalls: 0,
		logQueueEventsLogCalls: 0,
		logQueueEventsSuppressedByProfile: 0,
		coordinatorLogCalls: 0,
		maxNestedHandleDepth: 0,
		overflowed: 0,
		byEventType: {},
		byWriter: {},
	}
}

export function isExtensionHostHotloopDiagnosticEnabled(): boolean {
	return _enabled
}

export function setExtensionHostHotloopDiagnosticEnabled(enabled: boolean): void {
	_enabled = enabled
}

export function resetExtensionHostHotloopDiagnostic(): void {
	_counters = freshCounters()
	_nestedDepth = 0
}

export function getExtensionHostHotloopDiagnosticSnapshot(): Readonly<ExtensionHostHotloopCounters> {
	return _counters
}

export function recordExtensionHostHotloopSessionEvent(eventType: string): void {
	if (!_enabled) return
	_counters.sessionEvents++
	const buckets = _counters.byEventType
	if (eventType in buckets) {
		buckets[eventType]! += 1
	} else if (Object.keys(buckets).length < MAX_BUCKETS) {
		buckets[eventType] = 1
	} else {
		_counters.overflowed++
	}
}

export function enterExtensionHostHotloopHandleSessionEvent(): void {
	if (!_enabled) return
	_nestedDepth++
	_counters.handleSessionEventCalls++
	if (_nestedDepth > _counters.maxNestedHandleDepth) {
		_counters.maxNestedHandleDepth = _nestedDepth
	}
}

export function leaveExtensionHostHotloopHandleSessionEvent(): void {
	if (!_enabled) return
	if (_nestedDepth > 0) _nestedDepth--
}

export function recordExtensionHostHotloopLogQueueEvent(opts: { readonly producedLog: boolean }): void {
	if (!_enabled) return
	_counters.logQueueEventsCalls++
	if (opts.producedLog) {
		_counters.logQueueEventsLogCalls++
	} else {
		_counters.logQueueEventsSuppressedByProfile++
	}
}

export function recordExtensionHostHotloopPhaseWrite(opts: {
	readonly changed: boolean
	readonly writer: string | undefined
}): void {
	if (!_enabled) return
	_counters.setTurnPhaseCalls++
	_counters.setWithWriterCalls++
	if (!opts.changed) {
		_counters.samePhaseWriteAttempts++
	} else {
		_counters.actualPhaseChanges++
	}
	const buckets = _counters.byWriter
	const writer = opts.writer ?? "<unknown-legacy-writer>"
	if (writer in buckets) {
		buckets[writer]! += 1
	} else if (Object.keys(buckets).length < MAX_BUCKETS) {
		buckets[writer] = 1
	} else {
		_counters.overflowed++
	}
}

export function recordExtensionHostHotloopPendingPrompt(opts: { readonly kind: "drain" | "dispatch" }): void {
	if (!_enabled) return
	if (opts.kind === "drain") {
		_counters.pendingPromptDrainCalls++
	} else {
		_counters.pendingPromptDispatchCalls++
	}
}

export function recordExtensionHostHotloopCoordinatorLog(): void {
	if (!_enabled) return
	_counters.coordinatorLogCalls++
}
