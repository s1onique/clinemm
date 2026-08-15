/**
 * Deterministic identity for tool failures and exact attempts.
 *
 * Browser-compatible, synchronous, no Node builtins. `@cline/agents`
 * must remain embeddable in environments without `node:crypto`.
 *
 * ## Two-track identity (the contract this module enforces)
 *
 *   1. **Control identity** (full canonical string) — authoritative
 *      equality basis for `Set.has` / `Map.get` decisions inside the
 *      recovery tracker. NEVER serialised into snapshots or events.
 *      The control identity MUST NOT be the 32-bit diagnostic hash —
 *      doing so would make one tool attempt inherit another attempt's
 *      recovery state under a birthday-collision attack (~65k
 *      attempts in one episode has ~50% chance of a 32-bit collision).
 *
 *   2. **Diagnostic identifier** (8-char FNV-1a hex) — opaque projection
 *      safe to surface in `RecoverySnapshot.blockedExactKeys`,
 *      `RecoverySnapshot.currentFailureFamily`,
 *      `RecoverySnapshot.blockedFamilies`, and
 *      `RecoveryStateChangeEvent.failureFamily`. NOT a security boundary;
 *      it is a stable opaque key for telemetry.
 *
 * The invariant:
 *
 *   same canonical input → same controlKey → same diagnosticId
 *   different canonical input → different controlKey → different diagnosticId
 *
 * The 32-bit diagnostic projection is for telemetry; the unbounded
 * canonical control identity is for circuit decisions. They are
 * separate values bound to the same logical identity via
 * `ToolAttemptIdentity` / `ToolFamilyIdentity`.
 */

const FNV_OFFSET_32 = 0x811c9dc5;
const FNV_PRIME_32 = 0x01000193;
const DIAGNOSTIC_HEX_LENGTH = 8;

/**
 * Deterministic FNV-1a 32-bit hash. Returns an 8-character lowercase hex
 * string. Browser-compatible, synchronous, no Node deps.
 */
function fnv1a32Hex(input: string): string {
	let hash = FNV_OFFSET_32;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		hash = Math.imul(hash, FNV_PRIME_32) >>> 0;
	}
	return hash.toString(16).padStart(8, "0").slice(-DIAGNOSTIC_HEX_LENGTH);
}

/**
 * Sort object keys deterministically so JSON.stringify produces a stable
 * canonical form across key-insertion order. Mirrors the canonicalizer
 * in `safety/loop-detection.ts` but kept private to avoid a cross-package
 * dependency on `@cline/core`.
 */
function sortKeys(value: unknown): unknown {
	if (value == null || typeof value !== "object") return value;
	if (Array.isArray(value)) return value.map(sortKeys);
	const sorted: Record<string, unknown> = {};
	for (const key of Object.keys(value as Record<string, unknown>).sort()) {
		sorted[key] = sortKeys((value as Record<string, unknown>)[key]);
	}
	return sorted;
}

function canonicalJson(value: unknown): string {
	if (value == null) return "null";
	if (typeof value === "string") return JSON.stringify(value);
	if (typeof value !== "object") return JSON.stringify(value);
	try {
		return JSON.stringify(sortKeys(value));
	} catch {
		return String(value);
	}
}

// ---------------------------------------------------------------------------
// Typed identities — the runtime wiring layer MUST use these, not the
// 32-bit diagnostic projection.
// ---------------------------------------------------------------------------

/**
 * The two-track identity for a single tool attempt
 * `(toolName, canonicalInput)`. Bound at the runtime boundary, where
 * the canonical input is fully known.
 */
export interface ToolAttemptIdentity {
	/**
	 * Canonical control key: `toolName + "\0" + canonicalJson(input)`.
	 * Authoritative equality basis for tracker `Set.has` / `Map.get`.
	 * Package-private — never serialised into snapshots or events.
	 */
	readonly controlKey: string;
	/**
	 * Opaque 8-char hex diagnostic projection. Safe to surface in
	 * telemetry, runtime events, and host projections.
	 */
	readonly diagnosticId: string;
	readonly toolName: string;
}

/**
 * The two-track identity for a failure family
 * `(toolName, failureClass, stableCode)`. Bound after execution, when
 * the failure classification is known.
 */
export interface ToolFamilyIdentity {
	/**
	 * Canonical control family: `toolName + ":" + failureClass + ":" + stableCode`.
	 * Authoritative equality basis for tracker `Map` keys.
	 */
	readonly controlFamily: string;
	/**
	 * Opaque 8-char hex diagnostic projection. Safe to surface.
	 */
	readonly diagnosticFamily: string;
	readonly toolName: string;
	readonly failureClass: string;
	readonly stableCode: string;
}

/**
 * Construct a two-track identity for a tool attempt. Use this at the
 * runtime boundary (pre-execution). The control key MUST be passed to
 * `RecoveryTracker.isExactBlocked(...)` / `recordFailure(..., exactKey, ...)`,
 * NOT the diagnostic projection.
 */
export function createAttemptIdentity(toolName: string, input: unknown): ToolAttemptIdentity {
	const canonical = canonicalJson(input);
	const controlKey = `${toolName}\0${canonical}`;
	return {
		controlKey,
		diagnosticId: fnv1a32Hex(controlKey),
		toolName,
	};
}

/**
 * Construct a two-track identity for a failure family. Use this at the
 * runtime boundary (post-execution) once the classifier has produced a
 * structured classification. The control family MUST be passed to
 * `RecoveryTracker.recordFailure(family, ...)`,
 * NOT the diagnostic projection.
 */
export function createFamilyIdentity(
	toolName: string,
	failureClass: string,
	stableCode: string,
): ToolFamilyIdentity {
	const controlFamily = `${toolName}:${failureClass}:${stableCode}`;
	return {
		controlFamily,
		diagnosticFamily: fnv1a32Hex(controlFamily),
		toolName,
		failureClass,
		stableCode,
	};
}

/**
 * Project a canonical control key back to its diagnostic identifier.
 * Use ONLY for telemetry/event projection — never for circuit decisions.
 */
export function controlKeyToDiagnosticId(controlKey: string): string {
	return fnv1a32Hex(controlKey);
}

/**
 * Project a canonical control family back to its diagnostic identifier.
 * Use ONLY for telemetry/event projection — never for circuit decisions.
 */
export function controlFamilyToDiagnosticId(controlFamily: string): string {
	return fnv1a32Hex(controlFamily);
}

export interface ToolCallFingerprint {
	toolName: string;
	/**
	 * Diagnostic identifier for the canonical input. Stable across
	 * key-insertion order. Safe to surface in telemetry; NOT the
	 * canonical input itself.
	 *
	 * For authoritative circuit decisions, derive a `ToolAttemptIdentity`
	 * via `createAttemptIdentity(toolName, input)` and use
	 * `.controlKey` (the canonical form) instead of this 32-bit hex.
	 */
	inputFingerprint: string;
}

export interface ToolFailureFingerprint {
	toolName: string;
	failureClass: string;
	/** Diagnostic identifier for the family. */
	failureFamily: string;
	/** Diagnostic identifier for the exact failure (family + input). */
	failureFingerprint: string;
	stableCode: string;
	iteration: number;
	toolCallId: string;
}

/**
 * Compute a fingerprint for a tool call input. The returned shape is a
 * DIAGNOSTIC projection only; for authoritative circuit decisions the
 * caller MUST use `createAttemptIdentity(toolName, input).controlKey`.
 *
 * Retained for the C1.0 fingerprint test contract (10 tests).
 */
export function fingerprintToolInput(toolName: string, input: unknown): ToolCallFingerprint {
	const identity = createAttemptIdentity(toolName, input);
	return {
		toolName,
		inputFingerprint: identity.diagnosticId,
	};
}

/**
 * Compute a fingerprint for a tool failure. Returns a DIAGNOSTIC
 * projection; for authoritative family-keyed decisions the caller MUST
 * use `createFamilyIdentity(toolName, failureClass, stableCode).controlFamily`.
 *
 * Retained for the C1.0 fingerprint test contract.
 */
export function fingerprintToolFailure(
	toolName: string,
	failureClass: string,
	stableCode: string,
	iteration: number,
	toolCallId: string,
	input?: unknown,
): ToolFailureFingerprint {
	const family = createFamilyIdentity(toolName, failureClass, stableCode);
	let failureFingerprint: string;
	if (input !== undefined) {
		const attempt = createAttemptIdentity(toolName, input);
		// Mix control family and control attempt key so distinct attempts
		// in the same family have distinct exact fingerprints.
		failureFingerprint = fnv1a32Hex(`${family.controlFamily}\0${attempt.controlKey}`);
	} else {
		failureFingerprint = family.diagnosticFamily;
	}

	return {
		toolName,
		failureClass,
		failureFamily: family.diagnosticFamily,
		failureFingerprint,
		stableCode,
		iteration,
		toolCallId,
	};
}

/**
 * Returns the diagnostic identifier for a family given its components.
 * Delegates to `createFamilyIdentity` so the canonical encoding
 * convention is defined in exactly one place.
 */
export function familyDiagnosticId(toolName: string, failureClass: string, stableCode: string): string {
	return createFamilyIdentity(toolName, failureClass, stableCode).diagnosticFamily;
}

/**
 * Returns the diagnostic identifier for an exact attempt given its
 * canonical input. Delegates to `createAttemptIdentity` so the
 * canonical encoding convention is defined in exactly one place.
 */
export function attemptDiagnosticId(toolName: string, input: unknown): string {
	return createAttemptIdentity(toolName, input).diagnosticId;
}

export function isSameFailureFamily(
	a: ToolFailureFingerprint,
	b: ToolFailureFingerprint,
): boolean {
	return a.failureFamily === b.failureFamily;
}

export function isSameExactFailure(
	a: ToolFailureFingerprint,
	b: ToolFailureFingerprint,
): boolean {
	return a.failureFingerprint === b.failureFingerprint;
}
