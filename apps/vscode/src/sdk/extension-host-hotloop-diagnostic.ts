/**
 * ACT-CLINEMM-EXTENSION-HOST-SESSION-EVENT-HOTLOOP01
 *
 * Extension-host hot-loop diagnostic counters. Production-seam
 * counters that pin the load-bearing witness for the EHLOOP01 /
 * extension-host-stability qualification.
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
 * REMOVAL_TRIGGER (per ACT §34): once the host-stability repair is
 * GREEN on LIVE qualification, OR CAPTURE_INSUFFICIENT is declared,
 * the counter module + the activation helper + the host-side dump
 * runtime + the Command Palette registration + the package.json
 * command declaration MUST be removed TOGETHER.
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

// ACT-CLINEMM-EXTENSION-HOST-SESSION-EVENT-HOTLOOP01 (CORRECTION01):
//
// Permanent production rule. The synchronous `Logger.log` breadcrumb
// inside `SdkSessionEventCoordinator.logQueueEvents` is gated behind
// this independent opt-in (NOT the diagnostic enablement bit). It is
// DEFAULT_OFF in every profile — public, dogfood, or otherwise —
// because the call site has been demonstrated (CPU profile
// exthost-66cdb2.cpuprofile) to monopolize the extension-host thread
// while the dogfood profile is enabled.
//
// Two distinct gates:
//
//   _enabled             — counters + per-event buckets + nested
//                           depth tracker. Cheap (bounded Maps,
//                           numeric increments). Bound to dogfood.
//
//   _queueLogEnabled     — synchronous Logger.log breadcrumb inside
//                           logQueueEvents. The dogfood profile does
//                           NOT enable this. Operators must opt in
//                           explicitly via the env knob
//                           CLINEMM_DIAG_HOTLOOP_QUEUE_LOG=<truthy>
//                           (only honored in dogfood).
//
// The two are decoupled so removing the temporary diagnostic does not
// resurrect the hot path.
let _queueLogEnabled = false

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

// ACT-CLINEMM-EXTENSION-HOST-SESSION-EVENT-HOTLOOP01 (CORRECTION01):
// Independent opt-in for the synchronous Logger.log breadcrumb inside
// logQueueEvents. DEFAULT_OFF in every profile. See module docstring
// for the rationale (this gate is decoupled from the diagnostic
// enablement so removing the diagnostic does not silently re-arm the
// hot path).
export function isExtensionHostHotloopQueueLogEnabled(): boolean {
	return _queueLogEnabled
}

export function setExtensionHostHotloopQueueLogEnabled(enabled: boolean): void {
	_queueLogEnabled = enabled
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

// ACT-CLINEMM-EXTENSION-HOST-SESSION-EVENT-HOTLOOP01 (CORRECTION01):
// Records whether the synchronous Logger.log breadcrumb in
// logQueueEvents was permitted by the queue-log opt-in gate
// (independent of the diagnostic enablement).
//
//   permitted === true  -> Logger.log fires (queueLogEnabled was on).
//   permitted === false -> Logger.log was suppressed by the
//                           permanent production rule (queueLogEnabled
//                           was off; the dogfood profile does NOT
//                           grant this).
//
// This counter is captured even when the diagnostic is OFF so the
// post-mortem can always confirm the permanent rule held during a
// LIVE failure (no opt-in knob change can shift the witness).
export function recordExtensionHostHotloopQueueLogPermitted(permitted: boolean): void {
	if (!_enabled) return
	if (permitted) {
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
