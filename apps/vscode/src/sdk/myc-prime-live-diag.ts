// ACT-MYC-CLINEMM03-LIVE-DIAG01: default-off live diagnostics for the
// ClineMM prime-injection causal chain.
//
// SCOPE: OBSERVE ONLY. Do NOT redesign injection, recorder lookup, or
// message construction here. The diagnostic is a forensic scaffolding
// The diagnostic only records numeric / boolean / status metadata. It
// MUST NEVER store, log, or surface:
//   - the prime text itself,
//   - recalled memory contents,
//   - prompts,
//   - provider request bodies,
//   - node IDs, paths, or raw headers.
//
// Gating: an explicit opt-in env flag.
//   CLINEMM_MYC_PRIME_DIAG=1  -> enabled
//   CLINEMM_MYC_PRIME_DIAG=0  -> explicitly off
//   unset (default)            -> off
//
// When DISABLED (production default, the verified working state):
//   - zero new state writes,
//   - zero new request mutations,
//   - zero new log lines,
//   - zero impact on the prime-recorder singleton,
//   - zero impact on the per-session injection tracker.
// In other words, the production path-of-execution is bit-identical to
// what ACT-MYC-CLINEMM02-C-CORRECTION02 produced.
//
// When ENABLED (operator-driven live dogfood session): the singleton
// below is populated with one entry per active host session id; the
// entry is updated at four observation points:
//   1. ACQUISITION -> runMycPrimeOnSessionStart  myc-prime-automation.ts
//   2. LOOKUP      -> beforeModel               hooks-adapter.ts
//   3. INJECTION   -> beforeModel               hooks-adapter.ts
//   4. CAPTURE     -> beforeModel               hooks-adapter.ts
//
// Removal trigger (per ACT §14): the first of
//   - root cause isolated,
//   - capture insufficient,
//   - successor evidence supersedes it.
// When telemetry later wants any of these counters, redesign them under
// ACT-MYC-CLINEMM-TELEMETRY01 — do NOT silently promote this record
// into product telemetry.

import { Logger } from "@/shared/services/Logger"

/**
 * Opt-in env flag. Default off; must be the literal string `"1"` (case
 * insensitive; surrounding whitespace tolerated).
 */
const ENV_FLAG_NAME = "CLINEMM_MYC_PRIME_DIAG"

/**
 * Discriminated per-injection reason. The exhaustive enumeration makes
 * the live decision matrix in ACT §12 a closed-form match — no
 * inferential branch on `reason === undefined`.
 */
export type MycPrimeLiveInjectionReason =
	| "ok"
	| "iteration_not_first"
	| "no_session_id"
	| "no_recorded_prime"
	| "prime_empty"
	| "already_injected"

export type MycPrimeLiveAcquisitionStatus = "ok" | "failed" | "skipped"

/**
 * One entry per host session id. The entry is keyed by the same id used
 * by `lastResultBySessionId` in myc-prime-automation.ts, so a diag
 * lookup miss with `acquisition.status === "ok"` is unambiguous: it
 * points at the identity/join boundary (HALT_LIVE_PRIME_LOOKUP_MISS).
 */
export interface MycPrimeLiveDiagnostic {
	readonly sessionId: string
	readonly acquisition: {
		attempted: boolean
		serverDetected: boolean
		status: MycPrimeLiveAcquisitionStatus
		textPresent: boolean
		/** UTF-8 byte length of the recorded prime text. 0 when none. */
		textBytes: number
		/** Truncated message on failure; NEVER the prime text. */
		error?: string
		ts?: number
	}
	readonly lookup: {
		attempted: boolean
		snapshotSessionIdPresent: boolean
		matchedRecordedSession: boolean
		recordedPrimeFound: boolean
		iteration?: number
		ts?: number
	}
	readonly injection: {
		attempted: boolean
		injected: boolean
		reason?: MycPrimeLiveInjectionReason
		/** UTF-8 byte length of the `<prime_packet>` text block. 0 when no packet. */
		packetBytes?: number
		ts?: number
		iteration?: number
	}
	capture?: {
		/** Stable capture id stamped onto request.metadata.captureId. */
		captureId?: string
		aiSdkPromptObserved?: boolean
		wireRequestObserved?: boolean
	} | null
}

/** Module-level singleton. Hold the live diagnostic per host session id. */
const liveDiagBySessionId = new Map<string, MycPrimeLiveDiagnostic>()

// added to prove WHERE the live chain breaks — not to fix it.
/**
 * Read the env flag. ONLY the literal `"1"` (whitespace-trimmed,
 * case-insensitive) enables.
 *
 * Cost: a single `process.env` lookup + trim + lower-case + `===`.
 * When disabled, every recorder below short-circuits on this single
 * boolean — zero state writes, zero request mutations, zero log lines.
 */
export function isMycPrimeLiveDiagEnabled(): boolean {
	const raw = process.env[ENV_FLAG_NAME]
	if (typeof raw !== "string") return false
	return raw.trim().toLowerCase() === "1"
}

/**
 * Begin (or refresh) a diagnostic entry for `sessionId`. No-op when
 * diagnostics are disabled.
 */
export function startMycPrimeLiveDiag(sessionId: string): void {
	if (!isMycPrimeLiveDiagEnabled()) return
	const prior = liveDiagBySessionId.get(sessionId)
	if (prior) {
		Logger.warn(
			`[MycPrimeLiveDiag] overwriting prior diagnostic entry for session=${sessionId} ` +
				`(prior.acquisition.status=${prior.acquisition.status}, prior.injection.injected=${prior.injection.injected}).`,
		)
	}
	liveDiagBySessionId.set(sessionId, freshEntry(sessionId))
}

export function recordMycPrimeLiveAcquisition(
	sessionId: string,
	fields: {
		attempted: boolean
		serverDetected: boolean
		status: MycPrimeLiveAcquisitionStatus
		textPresent: boolean
		textBytes: number
		error?: string
	},
): void {
	if (!isMycPrimeLiveDiagEnabled()) return
	const entry = ensureEntry(sessionId)
	entry.acquisition.attempted = fields.attempted
	entry.acquisition.serverDetected = fields.serverDetected
	entry.acquisition.status = fields.status
	entry.acquisition.textPresent = fields.textPresent
	entry.acquisition.textBytes = fields.textBytes
	entry.acquisition.error = fields.error
	entry.acquisition.ts = Date.now()
}

export function recordMycPrimeLiveLookup(
	sessionId: string,
	fields: {
		attempted: boolean
		snapshotSessionIdPresent: boolean
		matchedRecordedSession: boolean
		recordedPrimeFound: boolean
		iteration?: number
	},
): void {
	if (!isMycPrimeLiveDiagEnabled()) return
	const entry = ensureEntry(sessionId)
	entry.lookup.attempted = fields.attempted
	entry.lookup.snapshotSessionIdPresent = fields.snapshotSessionIdPresent
	entry.lookup.matchedRecordedSession = fields.matchedRecordedSession
	entry.lookup.recordedPrimeFound = fields.recordedPrimeFound
	entry.lookup.iteration = fields.iteration
	entry.lookup.ts = Date.now()
}

export function recordMycPrimeLiveInjection(
	sessionId: string,
	fields: {
		attempted: boolean
		injected: boolean
		reason: MycPrimeLiveInjectionReason
		packetBytes?: number
		iteration?: number
	},
): void {
	if (!isMycPrimeLiveDiagEnabled()) return
	const entry = ensureEntry(sessionId)
	entry.injection.attempted = fields.attempted
	entry.injection.injected = fields.injected
	entry.injection.reason = fields.reason
	entry.injection.packetBytes = fields.packetBytes
	entry.injection.iteration = fields.iteration
	entry.injection.ts = Date.now()
}

export function recordMycPrimeLiveCapture(
	sessionId: string,
	fields: {
		captureId: string
		aiSdkPromptObserved: boolean
		wireRequestObserved?: boolean
	},
): void {
	if (!isMycPrimeLiveDiagEnabled()) return
	const entry = ensureEntry(sessionId)
	entry.capture = {
		captureId: fields.captureId,
		aiSdkPromptObserved: fields.aiSdkPromptObserved,
		wireRequestObserved: fields.wireRequestObserved,
	}
}

/**
 * Lookup the live diagnostic for a sessionId. Returns `undefined` when
 * no entry has been started. NEVER throws; caller must NOT depend on
 * the returned shape for control flow.
 */
export function getMycPrimeLiveDiag(sessionId: string): MycPrimeLiveDiagnostic | undefined {
	if (!isMycPrimeLiveDiagEnabled()) return undefined
	return liveDiagBySessionId.get(sessionId)
}

/** Test-only: clear every recorded entry. NOT for production use. */
export function __resetMycPrimeLiveDiagForTests(): void {
	liveDiagBySessionId.clear()
}

/**
 * Test-only: read every recorded entry as a plain array. Used by
 * diagnostic RED/GREEN assertions to walk the full singleton without
 * depending on internal map ordering.
 */
export function __getAllMycPrimeLiveDiagForTests(): readonly MycPrimeLiveDiagnostic[] {
	if (!isMycPrimeLiveDiagEnabled()) return []
	return Array.from(liveDiagBySessionId.values())
}

function freshEntry(sessionId: string): MycPrimeLiveDiagnostic {
	return {
		sessionId,
		acquisition: {
			attempted: false,
			serverDetected: false,
			status: "failed",
			textPresent: false,
			textBytes: 0,
		},
		lookup: {
			attempted: false,
			snapshotSessionIdPresent: false,
			matchedRecordedSession: false,
			recordedPrimeFound: false,
		},
		injection: {
			attempted: false,
			injected: false,
		},
	}
}

function ensureEntry(sessionId: string): MycPrimeLiveDiagnostic {
	const existing = liveDiagBySessionId.get(sessionId)
	if (existing) return existing
	// Defensive: a recorder firing without a prior
	// `startMycPrimeLiveDiag` lazily initializes a minimal entry.
	const entry = freshEntry(sessionId)
	liveDiagBySessionId.set(sessionId, entry)
	return entry
}
