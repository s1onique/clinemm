/**
 * ACT-CLINEMM-BEFOREMODEL-OPERATOR-CHECKPOINT-01
 *
 * The compact, typed operator configuration for the request-local
 * `beforeModel` completion checkpoint.
 *
 * This module is the SINGLE SOURCE OF TRUTH for:
 *   - the persisted field names,
 *   - the defaults,
 *   - the validation rules (write-time rejection),
 *   - the effective-configuration resolution (consumption-time).
 *
 * It is intentionally free of VS Code / SDK imports so that BOTH the
 * extension host (persistence + runtime composition) and the webview
 * (UI validation feedback) can consume it without a cycle.
 *
 * DEFAULT IS OFF. When the feature is disabled the resolver returns
 * `undefined` and the runtime MUST NOT modify any provider request.
 */

/** Persisted state key for the enable toggle. */
export const BEFORE_MODEL_CHECKPOINT_ENABLED_KEY = "beforeModelCheckpointEnabled" as const
/** Persisted state key for the operator prompt text. */
export const BEFORE_MODEL_CHECKPOINT_TEXT_KEY = "beforeModelCheckpointText" as const
/** Persisted state key for the interval (in completed tool-using turns). */
export const BEFORE_MODEL_CHECKPOINT_INTERVAL_KEY = "beforeModelCheckpointInterval" as const

/** Default: the feature is OFF. */
export const DEFAULT_BEFORE_MODEL_CHECKPOINT_ENABLED = false
/** Default: no prompt text. */
export const DEFAULT_BEFORE_MODEL_CHECKPOINT_TEXT = ""
/** Default: every 4 completed tool-using turns. */
export const DEFAULT_BEFORE_MODEL_CHECKPOINT_INTERVAL = 4

/**
 * Bounded maximum length (in UTF-16 code units) of the operator prompt
 * text. Longer values are REJECTED at write time — never truncated.
 */
export const BEFORE_MODEL_CHECKPOINT_MAX_TEXT_LENGTH = 4096

/**
 * The upper bound of the interval. A checkpoint that fires more often
 * than every turn is not an operator checkpoint, so the value is
 * bounded to keep the behaviour predictable.
 */
export const BEFORE_MODEL_CHECKPOINT_MAX_INTERVAL = 1000

export interface BeforeModelCheckpointSettings {
	/** Whether the operator checkpoint is enabled. */
	enabled: boolean
	/** The exact prompt text injected into the provider-bound request. */
	text: string
	/** Fire after every N completed tool-using assistant turns. */
	interval: number
}

/**
 * The EFFECTIVE configuration of the checkpoint. `undefined` means the
 * feature is NOT effective and the runtime must not modify any request.
 */
export interface EffectiveBeforeModelCheckpoint {
	/** The exact text to append (never empty, never truncated). */
	text: string
	/** The validated positive interval. */
	interval: number
}

/**
 * Validate a candidate interval value.
 *
 * A valid interval is a finite, positive, safe integer.
 * Returns `undefined` for an invalid value (the caller rejects it).
 */
export function normalizeBeforeModelCheckpointInterval(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
		return undefined
	}
	if (value > BEFORE_MODEL_CHECKPOINT_MAX_INTERVAL) {
		return undefined
	}
	return value
}

/**
 * Validate a candidate prompt text value.
 *
 * A valid text is a string whose length does not exceed the bounded
 * maximum. The text is NEVER truncated: an over-length value is
 * rejected outright.
 */
export function normalizeBeforeModelCheckpointText(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined
	}
	if (value.length > BEFORE_MODEL_CHECKPOINT_MAX_TEXT_LENGTH) {
		return undefined
	}
	return value
}

/**
 * Resolve the EFFECTIVE checkpoint configuration from the raw persisted
 * values.
 *
 * The configuration is effective only when ALL of the following hold:
 *   - the parent Hooks feature is enabled,
 *   - the checkpoint toggle is enabled,
 *   - the prompt text is non-empty,
 *   - the interval is a valid positive integer.
 *
 * When any condition fails, `undefined` is returned and the caller MUST
 * NOT modify the provider request.
 *
 * A malformed or over-length persisted value degrades to "not effective"
 * (fail closed) rather than modifying a request.
 */
export function resolveEffectiveBeforeModelCheckpoint(input: {
	hooksEnabled: boolean | undefined
	enabled: boolean | undefined
	text: string | undefined
	interval: number | undefined
}): EffectiveBeforeModelCheckpoint | undefined {
	// The parent Hooks feature is authoritative: an undefined persisted
	// value means "enabled" (see `getHooksEnabledSafe`).
	if (!(input.hooksEnabled ?? true)) {
		return undefined
	}
	if (input.enabled !== true) {
		return undefined
	}
	const text = normalizeBeforeModelCheckpointText(input.text)
	if (text === undefined || text.trim() === "") {
		return undefined
	}
	const interval = normalizeBeforeModelCheckpointInterval(input.interval)
	if (interval === undefined) {
		return undefined
	}
	return { text, interval }
}
