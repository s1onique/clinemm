/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-LIVE-CONTEXT-DIMENSIONS01-C1
 *
 * Capture-kind / record-type freeze for the per-boundary
 * request-site capture layer introduced by LIVE-CONTEXT-DIMENSIONS01
 * C1. This module is a SEPARATE diagnostic instrument from the
 * existing PostTerminalAuthorityDiagnostic; both may run in
 * parallel because their toggles are independent and their record
 * shapes do not overlap.
 *
 * SCOPE — captured here
 *   - W1 / W2 / Q / B0 / C request-site and commit-site observations
 *
 * SCOPE — NOT captured here (LIVE_UNOBSERVABLE under §3 LC_T_PURITY)
 *   - B_LITERAL, R, N
 *
 * Offline R/N replay against B + P is HYPOTHESIS_ONLY and must
 * NOT be presented as a reproduction.
 *
 * PURITY (R18 + R20)
 *   - No emission function may be called from inside the queued
 *     functional updater. All request-site captures are recorded
 *     BEFORE the queued updater is constructed. The committed-state
 *     capture is emitted from a SEPARATE useEffect keyed on
 *     `[state]`, downstream of React's commit.
 *
 * CORRELATION IDENTITY (R21)
 *   - W1/P and C records MAY carry `_ptadPushId` when the source
 *     intrinsically stamps it; `associationQuality = "INTRINSIC"`.
 *   - W2 records carry native identity with
 *     `associationQuality = "INTERVAL_INFERRED"` or `"NONE"`.
 *     `INTRINSIC` on a W2 record is an integrity violation.
 *   - INTERVAL_INFERRED records MUST NOT be promoted to causal
 *     identity — the preferred shape is bracketed prev/next push
 *     IDs, no scalar pseudo-ID.
 *
 * DEFAULT-OFF
 *   - Returns false unless explicitly flipped. The capture is
 *     opt-in; the webview tree, the wire, and the production code
 *     paths are byte-for-byte unchanged when disabled.
 *
 * REMOVAL CONTRACT
 *   - Single-file delete + delete of the import-and-emit-block in
 *     ExtensionStateContext + delete of the C1 test file. No
 *     production data shape, public API, or proto contract touched.
 */

// Capture kinds (frozen at C1 commit).
export type LiveContextDimensions01CaptureKind =
	| "webview-w1-request"
	| "webview-w2-request"
	| "webview-w1-request-q"
	| "webview-w2-request-q"
	| "webview-w1-request-replica"
	| "webview-w2-request-replica"
	| "webview-committed-c"

// Correlation identity (R21).
export type AssociationQuality = "INTRINSIC" | "INTERVAL_INFERRED" | "NONE"
export type W2CorrelationIdentity = "INTERVAL_INFERRED" | "NONE"

export interface IntervalInferred {
	readonly prevPushId: number | undefined
	readonly nextPushId: number | undefined
}

// Native W2 identity (replaces `_ptadPushId` on the W2 wire).
export type LiveContextDimensions01PartialDiscriminator = "partial" | "final"

export interface LiveContextDimensions01NativeW2Identity {
	readonly epoch: number
	readonly seq: number
	readonly ts: number
	readonly discriminator: LiveContextDimensions01PartialDiscriminator
}

// Writer identity (Q).
export type LiveContextDimensions01WriterIdentity =
	| "W1_SNAPSHOT_REQUEST"
	| "W2_PARTIAL_REQUEST"

// Correlation identity wrapper.
export interface LiveContextDimensions01CorrelationIdentity {
	readonly associationQuality: AssociationQuality
	readonly associatedPushId: number | undefined
	readonly intervalInferred: IntervalInferred | undefined
}

// Record shape (frozen).
export interface LiveContextDimensions01Capture {
	readonly kind: LiveContextDimensions01CaptureKind
	readonly capturedAt: number
	readonly captureSeq: number
	readonly correlation: LiveContextDimensions01CorrelationIdentity
	readonly nativeW2: LiveContextDimensions01NativeW2Identity | undefined
	readonly writerIdentity: LiveContextDimensions01WriterIdentity | undefined
	readonly replicaTurnState: unknown | undefined
	readonly hostTurnState: unknown | undefined
	readonly committedTurnState: unknown | undefined
}

// Side buffer (webview-local, default-off, small).
interface LiveContextDimensions01SideBuffer {
	enabled: boolean
	bufferSize: number
	seq: number
	records: LiveContextDimensions01Capture[]
}

const BUFFERS: { webview: LiveContextDimensions01SideBuffer } = {
	webview: { enabled: false, bufferSize: 256, seq: 0, records: [] },
}

function isW2Kind(kind: LiveContextDimensions01CaptureKind): boolean {
	return (
		kind === "webview-w2-request" ||
		kind === "webview-w2-request-q" ||
		kind === "webview-w2-request-replica"
	)
}

function isQKind(kind: LiveContextDimensions01CaptureKind): boolean {
	return kind === "webview-w1-request-q" || kind === "webview-w2-request-q"
}

function isB0Kind(kind: LiveContextDimensions01CaptureKind): boolean {
	return (
		kind === "webview-w1-request-replica" ||
		kind === "webview-w2-request-replica"
	)
}

function validateCapture(record: LiveContextDimensions01Capture): void {
	const isW2 = isW2Kind(record.kind)

	if (isW2) {
		if (record.correlation.associationQuality === "INTRINSIC") {
			throw new Error(
				`[LCD01] W2 record carries INTRINSIC association — ` +
					`integrity violation under the current protocol ` +
					`(kind=${record.kind})`,
			)
		}
		if (record.nativeW2 === undefined) {
			throw new Error(
				`[LCD01] W2 record missing nativeW2 identity ` +
					`(kind=${record.kind})`,
			)
		}
	} else {
		if (record.correlation.associationQuality === "INTERVAL_INFERRED") {
			throw new Error(
				`[LCD01] non-W2 record carries INTERVAL_INFERRED ` +
					`association — INTERVAL_INFERRED is W2-only ` +
					`(kind=${record.kind})`,
			)
		}
		if (record.nativeW2 !== undefined) {
			throw new Error(
				`[LCD01] non-W2 record carries nativeW2 identity — ` +
					`nativeW2 is W2-only (kind=${record.kind})`,
			)
		}
	}

	if (isQKind(record.kind)) {
		if (record.writerIdentity === undefined) {
			throw new Error(
				`[LCD01] Q record missing writerIdentity ` +
					`(kind=${record.kind})`,
			)
		}
	} else if (record.writerIdentity !== undefined) {
		throw new Error(
			`[LCD01] non-Q record carries writerIdentity — ` +
				`writerIdentity is Q-only (kind=${record.kind})`,
		)
	}

	if (isB0Kind(record.kind)) {
		// No shape requirement on replicaTurnState — a B0 record
		// is a per-request-site observation; an undefined turnState
		// at the request site is a valid observation, not a missing
		// payload.
	} else if (record.replicaTurnState !== undefined) {
		throw new Error(
			`[LCD01] non-B0 record carries replicaTurnState — ` +
				`replicaTurnState is B0-only (kind=${record.kind})`,
		)
	}

	if (record.kind === "webview-committed-c") {
		// No shape requirement on committedTurnState — a C record
		// is a per-commit observation; an undefined turnState at
		// commit time is a valid observation, not a missing payload.
	} else if (record.committedTurnState !== undefined) {
		throw new Error(
			`[LCD01] non-C record carries committedTurnState — ` +
				`committedTurnState is C-only (kind=${record.kind})`,
		)
	}
}

// Public API.
export function enableLiveContextDimensions01Capture(): void {
	BUFFERS.webview.enabled = true
}

export function disableLiveContextDimensions01Capture(): void {
	BUFFERS.webview.enabled = false
}

export function isLiveContextDimensions01CaptureEnabled(): boolean {
	return BUFFERS.webview.enabled
}

export function clearLiveContextDimensions01Capture(): void {
	BUFFERS.webview.records = []
	BUFFERS.webview.seq = 0
}

export function setLiveContextDimensions01CaptureBufferSize(n: number): void {
	BUFFERS.webview.bufferSize = Math.max(1, Math.floor(n))
	if (BUFFERS.webview.records.length > BUFFERS.webview.bufferSize) {
		BUFFERS.webview.records.splice(
			0,
			BUFFERS.webview.records.length - BUFFERS.webview.bufferSize,
		)
	}
}

export function recordLiveContextDimensions01Capture(
	record: Omit<LiveContextDimensions01Capture, "capturedAt" | "captureSeq">,
): void {
	if (!BUFFERS.webview.enabled) {
		return
	}
	validateCapture(record as LiveContextDimensions01Capture)
	BUFFERS.webview.seq += 1
	const stamped: LiveContextDimensions01Capture = {
		...record,
		capturedAt: Date.now(),
		captureSeq: BUFFERS.webview.seq,
	}
	BUFFERS.webview.records.push(stamped)
	if (BUFFERS.webview.records.length > BUFFERS.webview.bufferSize) {
		BUFFERS.webview.records.shift()
	}
}

export function getLiveContextDimensions01CaptureRecords(): readonly LiveContextDimensions01Capture[] {
	return BUFFERS.webview.records.slice()
}

export function getLiveContextDimensions01CaptureSeq(): number {
	return BUFFERS.webview.seq
}

// Test/build-time helper. Resets buffer + seq so test cases are
// deterministic. Not part of the user-facing API; documented here
// for the C1 test file.
export function __resetLiveContextDimensions01CaptureForTesting(): void {
	BUFFERS.webview.enabled = false
	BUFFERS.webview.bufferSize = 256
	BUFFERS.webview.records = []
	BUFFERS.webview.seq = 0
}