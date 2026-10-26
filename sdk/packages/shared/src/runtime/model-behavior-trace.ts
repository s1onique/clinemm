/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-TRACE01
 *
 * Model-agnostic flight recorder for observable model behavior.
 *
 * PURPOSE
 * -------
 * Answer, with executable evidence, the question:
 *
 *   "When a model appears to loop, is it actually making repeated model
 *    decisions, encountering runtime failures, losing context, or performing
 *    productive work that merely requires more calls?"
 *
 * The recorder is a CENTRALIZED bounded ring. It is deliberately NOT one
 * ring per subsystem: the whole point is a single interleaved timeline where
 * model requests, tool executions, loop-detector verdicts, and compaction
 * boundaries can be correlated against one another.
 *
 * HARD CONSTRAINTS (see the ACT)
 * ------------------------------
 *   - Default OFF. No records are produced until explicitly enabled.
 *   - Model-agnostic. No provider/model special-casing anywhere.
 *   - Read-only observation. The recorder NEVER changes model requests,
 *     prompts, tool execution, compaction policy, lifecycle authority, or
 *     loop-detector behavior.
 *   - No disk writes until an explicit Dump. The recorder is memory-only.
 *   - Privacy-preserving. No prompt contents, reasoning text, tool
 *     arguments, tool results, credentials, environment values, or raw
 *     request bodies are recorded by default.
 *   - Bounded. Ring capacity is capped by BOTH a record count and a byte
 *     budget; dropped records are REPORTED (count + sequence range), never
 *     silently presented as exhaustive.
 *   - Failure-isolated. A recorder failure must never affect a model call,
 *     tool execution, or lifecycle commit. Every public entry point is
 *     wrapped so a throw degrades to a no-op.
 *
 * EVIDENCE BOUNDARY
 * -----------------
 * Correlation fields are carried on every record. Where an identity is
 * unavailable the field is ABSENT (not guessed) and the record carries an
 * `evidenceBoundary` marker so an analyst can tell "not correlated" apart
 * from "correlated to the wrong thing". Events are NEVER correlated by
 * timestamp alone.
 */

// =============================================================================
// Limits
// =============================================================================

/** Maximum number of records retained in the ring. */
export const MODEL_BEHAVIOR_TRACE_MAX_RECORDS = 8_192;

/** Maximum retained payload size, in bytes, across all records in the ring. */
export const MODEL_BEHAVIOR_TRACE_MAX_BYTES = 4 * 1024 * 1024;

/** Sentinel used wherever a value could not be observed from the runtime. */
export const MODEL_BEHAVIOR_TRACE_UNAVAILABLE =
	"UNAVAILABLE_FROM_TRACE" as const;

// =============================================================================
// Schema
// =============================================================================

/**
 * The correlation identity carried on every record.
 *
 * Every field is optional on purpose: an unavailable identity is omitted
 * rather than invented. `traceId` is always present because it is minted by
 * the recorder itself.
 */
export interface ModelBehaviorTraceIdentity {
	/** Recorder-scoped id. Stable for the lifetime of the recorder. */
	readonly traceId: string;
	/** Host-owned session id, when the producer knows it. */
	readonly sessionId?: string;
	/** Host-owned task id, when the producer knows it. */
	readonly taskId?: string;
	/** Runtime run id, when the producer knows it. */
	readonly runId?: string;
	/** Agent iteration number, when the producer knows it. */
	readonly iteration?: number;
	/** Configured provider id, when known. */
	readonly providerId?: string;
	/** Configured model id, when known. */
	readonly modelId?: string;
}

/**
 * Classification of the evidence boundary for a record.
 *
 * - `observed`            — the record reflects a directly observed runtime fact.
 * - `partial_identity`    — some correlation identities were unavailable.
 * - `no_identity`         — no session/task/run identity was available.
 * - `synthesized`         — the value was derived (e.g. a fingerprint), not raw.
 * - `inferred_budget`     — the effective budget was inferred by the production resolver.
 */
export type ModelBehaviorTraceEvidenceBoundary =
	| "observed"
	| "partial_identity"
	| "no_identity"
	| "synthesized"
	| "inferred_budget";

/** The event kinds the recorder understands. */
export type ModelBehaviorTraceEvent =
	| "model_config"
	/**
	 * ACT-CLINEMM-MODEL-BEHAVIOR-COMPARABILITY-AUTHORITY-REPAIR01 (R3/R4).
	 *
	 * The EFFECTIVE model configuration observed at the model-request
	 * boundary, carrying the real session/run identity.
	 */
	| "effective_model_config"
	| "model_request_start"
	| "model_request_finish"
	| "model_request_error"
	| "model_request_abort"
	| "tool_start"
	| "tool_finish"
	| "loop_verdict"
	| "compaction_diagnostics"
	| "compaction_completed"
	| "run_terminated";

/**
 * One recorded observation.
 *
 * `payload` holds ONLY privacy-safe scalar facts. Raw text, arguments,
 * results, and request bodies are never stored here.
 */
export interface ModelBehaviorTraceRecord extends ModelBehaviorTraceIdentity {
	/** Monotonically increasing sequence number, unique per recorder. */
	readonly seq: number;
	/** ISO-8601 timestamp of the observation. */
	readonly timestamp: string;
	/** What happened. */
	readonly event: ModelBehaviorTraceEvent;
	/** How trustworthy the correlation on this record is. */
	readonly evidenceBoundary: ModelBehaviorTraceEvidenceBoundary;
	/** Privacy-safe scalar facts about the observation. */
	readonly payload: Readonly<Record<string, unknown>>;
}

/**
 * The provenance of the effective input budget.
 *
 * These are the ACTUAL sources the production resolver consults, in
 * precedence order. `fallback_128k` is the production `DEFAULT_MAX_INPUT_TOKENS`
 * fallback used when the model exposes neither an input limit nor a context
 * window.
 */
export type ModelBehaviorTraceBudgetSource =
	| "modelMaxInputTokens"
	| "contextWindow"
	| "userCeiling"
	| "fallback_128k";

/**
 * A snapshot of model configuration.
 *
 * Selected / SDK-resolved / provider-confirmed identities are DISTINCT on
 * purpose. A provider-confirmed identity is only ever populated when the
 * provider actually exposed one — it is never inferred from the request.
 */
export interface ModelBehaviorTraceModelConfig {
	/** What the user selected. */
	readonly selectedProviderId?: string;
	readonly selectedModelId?: string;
	/** What the SDK resolved the request to. */
	readonly runtimeProviderId?: string;
	readonly runtimeModelId?: string;
	/** What the server reported, only when the provider exposed it. */
	readonly providerConfirmedModelId?: string;
	readonly thinkingEnabled?: boolean;
	readonly reasoningEffort?: string;
	readonly temperature?: number;
	readonly topP?: number;
	readonly maxOutputTokens?: number;
	readonly contextWindow?: number;
	readonly maxInputTokens?: number;
	readonly userContextCeiling?: number;
	readonly toolCount?: number;
	readonly toolNames?: readonly string[];
	readonly sourceHead?: string;
	readonly extensionVersion?: string;
	/**
	 * ACT-CLINEMM-MODEL-BEHAVIOR-COMPARABILITY-AUTHORITY-REPAIR01 (R2).
	 *
	 * The SHA-256 of the ACTUAL installed `dist/extension.js` bundle bytes.
	 *
	 * This is the artifact identity, NOT the source identity. It is read from
	 * the installed bundle via `resolveInstalledBundleIdentity()`, so it
	 * describes the bytes that actually ran. `sourceHead` remains a SEPARATE
	 * fact: it is informational only, and "unknown" source provenance never
	 * becomes a match on its own.
	 */
	readonly extensionBundleSha256?: string;
	/**
	 * ACT-CLINEMM-MODEL-BEHAVIOR-COMPARABILITY-AUTHORITY-REPAIR01 (R3).
	 *
	 * The EFFECTIVE context input budget the production compaction/model
	 * resolver actually applies, together with the provenance of the value
	 * that won.
	 *
	 * - `effectiveMaxInputTokens` — the number the production policy uses.
	 * - `inputBudgetSource` — which input determined it
	 *   (`modelMaxInputTokens` | `contextWindow` | `userCeiling` |
	 *   `fallback_128k`).
	 * - `userContextCeilingMode` — `auto` when the configured ceiling is
	 *   undefined AND the operating mode is the verified Auto mode; `explicit`
	 *   when a numeric ceiling governs. This distinguishes "no ceiling
	 *   configured" (a known operating mode) from "ceiling unknown".
	 */
	readonly effectiveMaxInputTokens?: number;
	readonly inputBudgetSource?: string;
	readonly userContextCeilingMode?: "auto" | "explicit";
}

/**
 * A privacy-preserving, stable-within-trace fingerprint of normalized
 * tool arguments.
 *
 * The fingerprint is an HMAC over a canonicalized argument form, keyed by
 * an EPHEMERAL per-trace random key. That means:
 *   - the same normalized arguments produce the same fingerprint WITHIN one
 *     trace (so repetition is detectable),
 *   - the same arguments produce a DIFFERENT fingerprint ACROSS traces
 *     (so a dump cannot be used as a cross-session rainbow table),
 *   - low-entropy values (a bare filename, a flag, a numeric literal) are
 *     not recoverable by dictionary attack, because the key is unknown.
 */
export interface ModelBehaviorTraceFingerprint {
	readonly fingerprint: string;
	/** Key id of the ephemeral key used; never the key itself. */
	readonly keyId: string;
}

// =============================================================================
// Argument normalization (privacy-preserving)
// =============================================================================

/**
 * Normalize an arbitrary argument value into a canonical, comparable shape
 * WITHOUT retaining the original values.
 *
 * Strategy:
 *   - object keys are sorted (so key order does not change the fingerprint),
 *   - string values are replaced by their TYPE plus a length bucket AND a
 *     KEYED digest of the value (see `fingerprintArguments` — the digest is
 *     an HMAC under an ephemeral per-trace key, so it distinguishes two
 *     different same-length strings WITHOUT exposing either, and cannot be
 *     reversed or dictionary-attacked without the key),
 *   - numeric values keep their exact value ONLY in the digest (the
 *     normalized shape records finiteness, not the number),
 *   - array LENGTHS are preserved (a different number of arguments is a
 *     meaningfully different action),
 *   - nested structures are normalized recursively with a depth cap.
 *
 * The result is deliberately lossy in its STRUCTURE, but the final
 * fingerprint is computed over the canonicalized structure together with
 * the keyed digests, so distinct actions stay distinguishable.
 */
export function normalizeTraceArguments(
	value: unknown,
	depth = 0,
	digest?: (input: string) => string | Promise<string>,
): unknown {
	const MAX_DEPTH = 6;
	if (depth > MAX_DEPTH) {
		return { $depth: "truncated" };
	}
	if (value === null) {
		return { $type: "null" };
	}
	if (value === undefined) {
		return { $type: "undefined" };
	}
	switch (typeof value) {
		case "string":
			return {
				$type: "string",
				$len: lengthBucket(value.length),
				...(digest ? { $digest: digest(value) } : {}),
			};
		case "number":
			return {
				$type: "number",
				$finite: Number.isFinite(value),
				...(digest ? { $digest: digest(String(value)) } : {}),
			};
		case "boolean":
			return { $type: "boolean", $value: value };
		case "bigint":
			return { $type: "bigint" };
		case "symbol":
			return { $type: "symbol" };
		case "function":
			return { $type: "function" };
		default:
			break;
	}
	if (Array.isArray(value)) {
		return {
			$type: "array",
			$len: value.length,
			$items: value.map((item) =>
				normalizeTraceArguments(item, depth + 1, digest),
			),
		};
	}
	if (value instanceof Date) {
		return { $type: "date" };
	}
	if (value instanceof Error) {
		return { $type: "error", $name: value.name };
	}
	const record = value as Record<string, unknown>;
	const out: Record<string, unknown> = { $type: "object" };
	for (const key of Object.keys(record).sort()) {
		out[key] = normalizeTraceArguments(record[key], depth + 1, digest);
	}
	return out;
}

/**
 * Asynchronously normalize an argument value, awaiting any keyed digests.
 *
 * This is the variant the recorder uses: the keyed digest is an HMAC, which
 * is asynchronous under WebCrypto.
 */
export async function normalizeTraceArgumentsAsync(
	value: unknown,
	digest: (input: string) => Promise<string>,
	depth = 0,
): Promise<unknown> {
	const MAX_DEPTH = 6;
	if (depth > MAX_DEPTH) {
		return { $depth: "truncated" };
	}
	if (value === null) {
		return { $type: "null" };
	}
	if (value === undefined) {
		return { $type: "undefined" };
	}
	switch (typeof value) {
		case "string":
			return {
				$type: "string",
				$len: lengthBucket(value.length),
				$digest: await digest(value),
			};
		case "number":
			return {
				$type: "number",
				$finite: Number.isFinite(value),
				$digest: await digest(String(value)),
			};
		case "boolean":
			return { $type: "boolean", $value: value };
		case "bigint":
			return { $type: "bigint" };
		case "symbol":
			return { $type: "symbol" };
		case "function":
			return { $type: "function" };
		default:
			break;
	}
	if (Array.isArray(value)) {
		const items = await Promise.all(
			value.map((item) =>
				normalizeTraceArgumentsAsync(item, digest, depth + 1),
			),
		);
		return { $type: "array", $len: value.length, $items: items };
	}
	if (value instanceof Date) {
		return { $type: "date" };
	}
	if (value instanceof Error) {
		return { $type: "error", $name: value.name };
	}
	const record = value as Record<string, unknown>;
	const out: Record<string, unknown> = { $type: "object" };
	for (const key of Object.keys(record).sort()) {
		out[key] = await normalizeTraceArgumentsAsync(
			record[key],
			digest,
			depth + 1,
		);
	}
	return out;
}

/**
 * Bucket a length into a small, non-revealing band.
 *
 * Bands (not exact lengths) keep the fingerprint stable against trivial
 * jitter while still distinguishing materially different argument shapes.
 */
function lengthBucket(length: number): string {
	if (length === 0) return "0";
	if (length <= 4) return "1-4";
	if (length <= 16) return "5-16";
	if (length <= 64) return "17-64";
	if (length <= 256) return "65-256";
	if (length <= 1024) return "257-1024";
	return "1025+";
}

// =============================================================================
// Keyed fingerprint (ephemeral per-trace)
// =============================================================================

/**
 * Minimal HMAC-SHA256 over a string, implemented on top of the platform
 * `crypto` module.
 *
 * This lives in `@cline/shared` (not in the extension) so the SDK core can
 * fingerprint tool arguments with the SAME key material the extension
 * recorder uses — a fingerprint computed in one place and compared in
 * another must agree.
 */
export async function hmacSha256(
	key: string,
	message: string,
): Promise<string> {
	const subtle = globalThis.crypto?.subtle;
	if (!subtle) {
		throw new Error("model-behavior-trace: WebCrypto subtle is unavailable");
	}
	const encoder = new TextEncoder();
	const keyBytes = await subtle.importKey(
		"raw",
		encoder.encode(key),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await subtle.sign(
		"HMAC",
		keyBytes,
		encoder.encode(message),
	);
	return [...new Uint8Array(signature)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

/**
 * Stable canonical JSON serialization (sorted keys) for fingerprinting.
 */
export function canonicalizeTraceValue(value: unknown): string {
	if (value === null || typeof value !== "object") {
		return JSON.stringify(value ?? null) ?? "null";
	}
	if (Array.isArray(value)) {
		return `[${value.map((item) => canonicalizeTraceValue(item)).join(",")}]`;
	}
	const record = value as Record<string, unknown>;
	const parts = Object.keys(record)
		.sort()
		.map(
			(key) => `${JSON.stringify(key)}:${canonicalizeTraceValue(record[key])}`,
		);
	return `{${parts.join(",")}}`;
}

// =============================================================================
// Tool categorization
// =============================================================================

/** Coarse tool category. Used for milestone/analysis grouping. */
export type ModelBehaviorTraceToolCategory =
	| "read"
	| "search"
	| "write"
	| "test"
	| "command"
	| "other";

/**
 * Classify a tool by NAME only (never by its arguments).
 *
 * Name-based classification is model-agnostic and does not inspect content.
 * The mapping is deliberately coarse and order-sensitive: the first match
 * wins, so more specific categories are checked first.
 */
export function categorizeTraceTool(
	toolName: string,
): ModelBehaviorTraceToolCategory {
	// Tool names are conventionally snake_case or kebab-case, so the word
	// boundary must treat `_` and `-` as separators (the default `\b` does
	// not: `_` is a word character).
	const name = toolName.toLowerCase().replace(/[_\-.]+/g, " ");
	if (
		/(^| )(test|tests|spec|specs|jest|vitest|pytest|mocha|go test|cargo test)( |$)/.test(
			name,
		)
	) {
		return "test";
	}
	if (
		/(^| )(search|grep|glob|find|list|ls|ripgrep|codebase|explore)( |$)/.test(
			name,
		)
	) {
		return "search";
	}
	if (/(^| )(read|cat|view|open|get file|load)( |$)/.test(name)) {
		return "read";
	}
	if (
		/(^| )(write|edit|create|delete|remove|replace|apply patch|patch|insert|update)( |$)/.test(
			name,
		)
	) {
		return "write";
	}
	if (
		/(^| )(command|bash|shell|exec|execute|run|terminal|process)( |$)/.test(
			name,
		)
	) {
		return "command";
	}
	return "other";
}

// =============================================================================
// Recorder
// =============================================================================

/** Options accepted by {@link ModelBehaviorTraceRecorder}. */
export interface ModelBehaviorTraceRecorderOptions {
	/** Max retained records. Defaults to {@link MODEL_BEHAVIOR_TRACE_MAX_RECORDS}. */
	readonly maxRecords?: number;
	/** Max retained bytes. Defaults to {@link MODEL_BEHAVIOR_TRACE_MAX_BYTES}. */
	readonly maxBytes?: number;
	/**
	 * Ephemeral fingerprint key. When omitted the recorder mints one.
	 * Tests may inject a fixed key to make fingerprints deterministic.
	 */
	readonly fingerprintKey?: string;
	/** Stable trace id. When omitted the recorder mints one. */
	readonly traceId?: string;
	/** Clock injection point for deterministic tests. */
	readonly now?: () => number;
}

/**
 * What a Dump reports about the ring's completeness.
 *
 * The ACT requires that an incomplete trace is NEVER silently presented as
 * exhaustive. Every dump carries this block.
 */
export interface ModelBehaviorTraceTruncation {
	/** True when at least one record was dropped from the ring. */
	readonly truncated: boolean;
	/** How many records were dropped. */
	readonly droppedCount: number;
	/** Lowest dropped sequence number, when any were dropped. */
	readonly droppedFromSeq?: number;
	/** Highest dropped sequence number, when any were dropped. */
	readonly droppedToSeq?: number;
	/** Total records ever accepted by the recorder. */
	readonly totalRecorded: number;
	/** Records currently retained in the ring. */
	readonly retainedCount: number;
	/** Approximate retained bytes. */
	readonly retainedBytes: number;
}

/** A dump payload: the records plus their completeness metadata. */
export interface ModelBehaviorTraceDump {
	readonly traceId: string;
	readonly records: readonly ModelBehaviorTraceRecord[];
	readonly truncation: ModelBehaviorTraceTruncation;
	/** ISO timestamp of the dump. */
	readonly dumpedAt: string;
}

/**
 * The centralized bounded recorder.
 *
 * Failure isolation: every public method catches its own errors. A recorder
 * failure degrades to a no-op and never propagates into a model call, a
 * tool execution, or a lifecycle commit.
 */
export class ModelBehaviorTraceRecorder {
	private readonly records: ModelBehaviorTraceRecord[] = [];
	private readonly maxRecords: number;
	private readonly maxBytes: number;
	private readonly now: () => number;
	private readonly fingerprintKey: string;
	private readonly fingerprintKeyId: string;

	private enabled = false;
	private nextSeq = 1;
	private totalRecorded = 0;
	private retainedBytes = 0;
	private droppedCount = 0;
	private droppedFromSeq: number | undefined;
	private droppedToSeq: number | undefined;
	private readonly traceId: string;

	constructor(options: ModelBehaviorTraceRecorderOptions = {}) {
		this.maxRecords = Math.max(
			1,
			options.maxRecords ?? MODEL_BEHAVIOR_TRACE_MAX_RECORDS,
		);
		this.maxBytes = Math.max(
			1,
			options.maxBytes ?? MODEL_BEHAVIOR_TRACE_MAX_BYTES,
		);
		this.now = options.now ?? (() => Date.now());
		this.traceId = options.traceId ?? mintTraceId();
		this.fingerprintKey = options.fingerprintKey ?? mintFingerprintKey();
		this.fingerprintKeyId = mintKeyId(this.fingerprintKey);
	}

	/** The recorder-scoped trace id. */
	getTraceId(): string {
		return this.traceId;
	}

	/** True when the recorder is armed. */
	isEnabled(): boolean {
		return this.enabled;
	}

	/**
	 * Arm or disarm the recorder.
	 *
	 * Disarming NEVER clears the buffer — the operator must still be able to
	 * dump evidence captured before the toggle.
	 */
	setEnabled(enabled: boolean): void {
		this.enabled = enabled;
	}

	/**
	 * Record one observation.
	 *
	 * Returns the stored record, or `undefined` when the recorder is OFF or
	 * the record failed to serialize. Never throws.
	 */
	record(
		event: ModelBehaviorTraceEvent,
		identity: Omit<ModelBehaviorTraceIdentity, "traceId">,
		payload: Record<string, unknown> = {},
		options: {
			readonly evidenceBoundary?: ModelBehaviorTraceEvidenceBoundary;
		} = {},
	): ModelBehaviorTraceRecord | undefined {
		if (!this.enabled) {
			return undefined;
		}
		try {
			const seq = this.nextSeq++;
			const record: ModelBehaviorTraceRecord = {
				seq,
				timestamp: new Date(this.now()).toISOString(),
				traceId: this.traceId,
				event,
				evidenceBoundary:
					options.evidenceBoundary ?? classifyEvidenceBoundary(identity),
				...(identity.sessionId !== undefined
					? { sessionId: identity.sessionId }
					: {}),
				...(identity.taskId !== undefined ? { taskId: identity.taskId } : {}),
				...(identity.runId !== undefined ? { runId: identity.runId } : {}),
				...(identity.iteration !== undefined
					? { iteration: identity.iteration }
					: {}),
				...(identity.providerId !== undefined
					? { providerId: identity.providerId }
					: {}),
				...(identity.modelId !== undefined
					? { modelId: identity.modelId }
					: {}),
				payload: sanitizePayload(payload),
			};
			this.append(record);
			return record;
		} catch {
			// Failure isolation: a recorder bug must never affect production.
			return undefined;
		}
	}

	/**
	 * Compute a stable-within-trace fingerprint of normalized arguments.
	 *
	 * Returns `undefined` when the recorder is OFF or the fingerprint could
	 * not be computed. Never throws.
	 */
	async fingerprintArguments(
		toolName: string,
		input: unknown,
	): Promise<ModelBehaviorTraceFingerprint | undefined> {
		if (!this.enabled) {
			return undefined;
		}
		try {
			// A per-call keyed digest lets two DIFFERENT same-length values
			// produce different fingerprints without exposing either: the HMAC
			// key is ephemeral and never leaves the recorder, so the digest
			// cannot be reversed or dictionary-attacked from a dump.
			const digest = (input: string) =>
				hmacSha256(this.fingerprintKey, `v:${input}`).then((value) =>
					value.slice(0, 32),
				);
			const normalized = await normalizeTraceArgumentsAsync(input, digest);
			const message = `${toolName}${canonicalizeTraceValue(normalized)}`;
			const fingerprint = await hmacSha256(this.fingerprintKey, message);
			return { fingerprint, keyId: this.fingerprintKeyId };
		} catch {
			return undefined;
		}
	}

	/** The retained records, oldest first. */
	getRecords(): readonly ModelBehaviorTraceRecord[] {
		return this.records;
	}

	/** How many records are currently retained. */
	getRecordCount(): number {
		return this.records.length;
	}

	/** The completeness metadata for the current ring state. */
	getTruncation(): ModelBehaviorTraceTruncation {
		return {
			truncated: this.droppedCount > 0,
			droppedCount: this.droppedCount,
			...(this.droppedFromSeq !== undefined
				? { droppedFromSeq: this.droppedFromSeq }
				: {}),
			...(this.droppedToSeq !== undefined
				? { droppedToSeq: this.droppedToSeq }
				: {}),
			totalRecorded: this.totalRecorded,
			retainedCount: this.records.length,
			retainedBytes: this.retainedBytes,
		};
	}

	/** Build the dump payload (records + completeness metadata). */
	dump(): ModelBehaviorTraceDump {
		return {
			traceId: this.traceId,
			records: [...this.records],
			truncation: this.getTruncation(),
			dumpedAt: new Date(this.now()).toISOString(),
		};
	}

	/**
	 * Reset the recorder to a pristine state. Test seam only — production
	 * code never calls this.
	 */
	_reset(): void {
		this.records.length = 0;
		this.enabled = false;
		this.nextSeq = 1;
		this.totalRecorded = 0;
		this.retainedBytes = 0;
		this.droppedCount = 0;
		this.droppedFromSeq = undefined;
		this.droppedToSeq = undefined;
	}

	// --------------------------------------------------------------------------
	// Internals
	// --------------------------------------------------------------------------

	private append(record: ModelBehaviorTraceRecord): void {
		const size = estimateRecordBytes(record);
		this.totalRecorded += 1;
		this.records.push(record);
		this.retainedBytes += size;

		// Evict oldest records until BOTH bounds are satisfied. A single
		// oversized record still gets evicted so the ring cannot grow without
		// bound.
		while (
			this.records.length > this.maxRecords ||
			(this.retainedBytes > this.maxBytes && this.records.length > 1)
		) {
			const evicted = this.records.shift();
			if (!evicted) {
				break;
			}
			this.retainedBytes -= estimateRecordBytes(evicted);
			this.droppedCount += 1;
			this.droppedFromSeq =
				this.droppedFromSeq === undefined
					? evicted.seq
					: Math.min(this.droppedFromSeq, evicted.seq);
			this.droppedToSeq =
				this.droppedToSeq === undefined
					? evicted.seq
					: Math.max(this.droppedToSeq, evicted.seq);
		}
	}
}

// =============================================================================
// Module helpers
// =============================================================================

/**
 * Keys that MUST NEVER be written into a trace payload.
 *
 * The recorder's privacy guarantee is enforced structurally: the payload
 * sanitizer drops these keys rather than trusting callers to omit them.
 * The list is deliberately broad — a key whose NAME suggests it could carry
 * user content or a secret is dropped even if a particular value would
 * happen to be harmless.
 */
const FORBIDDEN_PAYLOAD_KEYS = new Set([
	"apikey",
	"api_key",
	"auth",
	"authorization",
	"body",
	"command",
	"content",
	"credential",
	"credentials",
	"env",
	"environment",
	"input",
	"message",
	"messages",
	"output",
	"password",
	"path",
	"prompt",
	"raw",
	"reasoning",
	"request",
	"requestbody",
	"request_body",
	"response",
	"result",
	"secret",
	"stderr",
	"stdout",
	"systemprompt",
	"system_prompt",
	"text",
	"thinking",
	"token",
	"tokens",
	"value",
]);

/**
 * Strip non-privacy-safe values from a payload.
 *
 * Allowed value shapes: `undefined`, `null`, booleans, finite numbers,
 * strings that are short AND not obviously content-bearing, and arrays of
 * allowed scalars. Everything else is replaced by a type marker.
 */
export function sanitizePayload(
	payload: Record<string, unknown>,
): Readonly<Record<string, unknown>> {
	const out: Record<string, unknown> = {};
	for (const key of Object.keys(payload)) {
		const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
		if (FORBIDDEN_PAYLOAD_KEYS.has(normalizedKey)) {
			out[key] = "[REDACTED_BY_TRACE_SCHEMA]";
			continue;
		}
		out[key] = sanitizePayloadValue(payload[key]);
	}
	return out;
}

function sanitizePayloadValue(value: unknown): unknown {
	if (value === undefined || value === null) {
		return value;
	}
	if (typeof value === "boolean") {
		return value;
	}
	if (typeof value === "number") {
		return Number.isFinite(value) ? value : String(value);
	}
	if (typeof value === "string") {
		// Long strings are the classic carrier for raw content. Only short
		// opaque identifiers survive.
		return value.length <= 64 ? value : `[STRING:${value.length}]`;
	}
	if (Array.isArray(value)) {
		return value.slice(0, 64).map((item) => sanitizePayloadValue(item));
	}
	if (typeof value === "object") {
		const record = value as Record<string, unknown>;
		const out: Record<string, unknown> = {};
		for (const key of Object.keys(record).slice(0, 64)) {
			out[key] = sanitizePayloadValue(record[key]);
		}
		return out;
	}
	return `[${typeof value}]`;
}

/**
 * Classify the evidence boundary implied by the available identities.
 *
 * A record with no session/task/run identity cannot be correlated to a
 * specific execution and must say so.
 */
export function classifyEvidenceBoundary(
	identity: Omit<ModelBehaviorTraceIdentity, "traceId">,
): ModelBehaviorTraceEvidenceBoundary {
	const hasSession = identity.sessionId !== undefined;
	const hasTask = identity.taskId !== undefined;
	const hasRun = identity.runId !== undefined;
	if (!hasSession && !hasTask && !hasRun) {
		return "no_identity";
	}
	if (hasSession && hasTask && hasRun) {
		return "observed";
	}
	return "partial_identity";
}

/**
 * Approximate the retained byte cost of a record.
 *
 * Uses the serialized length so the byte cap reflects what the dump will
 * actually cost on disk.
 */
export function estimateRecordBytes(record: ModelBehaviorTraceRecord): number {
	try {
		return JSON.stringify(record).length;
	} catch {
		return 256;
	}
}

/**
 * Mint a random, opaque trace id.
 */
export function mintTraceId(): string {
	const bytes = new Uint8Array(12);
	globalThis.crypto.getRandomValues(bytes);
	return `mbt_${hex(bytes)}`;
}

/**
 * Mint an ephemeral fingerprint key.
 *
 * The key NEVER leaves the recorder; only a short key id (derived from it)
 * is exposed on fingerprints, so two fingerprints can be shown to belong to
 * the same key without the key itself being recoverable.
 */
export function mintFingerprintKey(): string {
	const bytes = new Uint8Array(32);
	globalThis.crypto.getRandomValues(bytes);
	return hex(bytes);
}

/**
 * Derive a short, non-reversible key id from a fingerprint key.
 */
export function mintKeyId(key: string): string {
	// A short prefix of a non-cryptographic hash is sufficient here: the key
	// id is a LABEL, not a secret, and the key itself is never exposed.
	let hash = 0x811c9dc5;
	for (let index = 0; index < key.length; index += 1) {
		hash ^= key.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return `k_${hash.toString(16).padStart(8, "0")}`;
}

function hex(bytes: Uint8Array): string {
	return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// =============================================================================
// SDK observation sink
// =============================================================================

/**
 * The observation contract the SDK core calls into.
 *
 * This is intentionally a NARROW, read-only interface: the SDK reports what
 * it observed and the sink decides whether to record it. The SDK never
 * reads back a decision, so the sink can NEVER influence execution.
 *
 * Every method is optional so a partially-implemented sink still compiles.
 */
export interface ModelBehaviorTraceSink {
	/**
	 * ACT-CLINEMM-MODEL-BEHAVIOR-TRACE01-CORR01: report whether tracing is
	 * currently ARMED.
	 *
	 * This is a pure, synchronous, side-effect-free read of the recorder's
	 * enable bit. It exists so the runtime can take a SYNCHRONOUS fast path
	 * when tracing is OFF: without it, the runtime would have to `await` the
	 * fingerprint promise on every tool call, and that `await` introduces an
	 * extra microtask suspension point between the tool-start boundary and
	 * the tool execution even when the recorder is inert.
	 *
	 * When this is ABSENT the runtime conservatively awaits the fingerprint
	 * (it cannot prove tracing is off), so behavior is unchanged for sinks
	 * that do not implement the signal.
	 */
	isTraceEnabled?: () => boolean;
	/**
	 * Compute a privacy-preserving fingerprint of a tool call's arguments.
	 *
	 * The SDK passes the RAW arguments here and the implementation returns
	 * only the fingerprint. The implementation MUST NOT retain the raw
	 * arguments. This keeps the ephemeral fingerprint key inside the
	 * recorder (which owns it) while still letting the SDK compute the
	 * fingerprint at the tool boundary.
	 */
	fingerprintToolArguments?: (
		toolName: string,
		input: unknown,
	) => Promise<string | undefined> | string | undefined;
	/**
	 * ACT-CLINEMM-MODEL-BEHAVIOR-COMPARABILITY-AUTHORITY-REPAIR01 (R3/R4).
	 *
	 * The EFFECTIVE model configuration observed at the boundary where the
	 * values actually govern execution — the model request the runtime is
	 * about to issue.
	 *
	 * This is deliberately a SEPARATE channel from the build-time
	 * `model_config` snapshot: the build-time snapshot describes what the
	 * host CONFIGURED (and may predate the session id), while this one
	 * describes what the runtime EFFECTIVELY sends, carrying the real
	 * session/run identity.
	 *
	 * The payload carries only privacy-safe scalars:
	 * `toolCount`, `toolNames`, `reasoningEffort`, `thinkingEnabled`,
	 * `maxOutputTokens`.
	 */
	onEffectiveModelConfig?: (observation: ModelBehaviorTraceObservation) => void;
	/** A model request is about to be issued. */
	onModelRequestStart?: (observation: ModelBehaviorTraceObservation) => void;
	/** A model request completed (successfully or with a finish reason). */
	onModelRequestFinish?: (observation: ModelBehaviorTraceObservation) => void;
	/** A model request failed. */
	onModelRequestError?: (observation: ModelBehaviorTraceObservation) => void;
	/** A model request was aborted / cancelled. */
	onModelRequestAbort?: (observation: ModelBehaviorTraceObservation) => void;
	/** A tool call started. */
	onToolStart?: (observation: ModelBehaviorTraceObservation) => void;
	/** A tool call finished. */
	onToolFinish?: (observation: ModelBehaviorTraceObservation) => void;
	/** The production loop detector returned a verdict. */
	onLoopVerdict?: (observation: ModelBehaviorTraceObservation) => void;
	/** The production compaction resolver produced its diagnostics. */
	onCompactionDiagnostics?: (
		observation: ModelBehaviorTraceObservation,
	) => void;
	/** The production compaction completed. */
	onCompactionCompleted?: (observation: ModelBehaviorTraceObservation) => void;
	/** The run terminated. */
	onRunTerminated?: (observation: ModelBehaviorTraceObservation) => void;
}

/**
 * What the SDK hands to the sink for one observation.
 *
 * `payload` contains privacy-safe facts only. The SDK is responsible for
 * NOT passing raw content through this channel.
 */
export interface ModelBehaviorTraceObservation {
	readonly sessionId?: string;
	readonly taskId?: string;
	readonly runId?: string;
	readonly iteration?: number;
	readonly providerId?: string;
	readonly modelId?: string;
	readonly payload: Readonly<Record<string, unknown>>;
}

/**
 * A sink that observes nothing. Used as the default so the production path
 * pays only a null check.
 */
export const NOOP_MODEL_BEHAVIOR_TRACE_SINK: ModelBehaviorTraceSink = {};
