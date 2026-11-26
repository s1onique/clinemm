// LanguageModelV4 middleware that retries a stream when the model returns an
// *empty* turn — no converted content and no unsupported output (see
// `stream-part-classification.ts` for the authoritative taxonomy).
//
// Background: providers intermittently return a response that finishes
// normally but carries no content at all. This was first observed on local
// backends (Ollama especially), but production telemetry shows hosted
// backends (openrouter, cline, generic OpenAI-compatible endpoints) do the
// same. In Cline's runtime an empty assistant turn is a hard failure ("Model
// returned empty response"), so a single flaky generation kills the whole
// task. The `ai-sdk-ollama` provider ships a "reliability" layer for this,
// but it lives in `doGenerate` and *owns the tool loop* (it executes tools
// itself and force-synthesizes a final text answer). That is fundamentally
// incompatible with Cline, which streams via `doStream` and runs its own tool
// loop — a tool-call-only turn is the correct, desired outcome here, not
// something to "complete". So instead of adopting that layer, this middleware
// adds the one piece that is safe for a streaming, self-looping host: retry
// only when a turn produced genuinely nothing.
//
// It is applied to every AI SDK vendor at the central composition point in
// `ai-sdk.ts` (see `withEmptyResponseRetry`); vendors can opt out or tune
// attempts via `ProviderFactoryResult.retryEmptyResponses`.
//
// Stream mechanics: each attempt is BUFFERED until it proves itself — the
// first output part (converted content, unsupported output, or an error)
// accepts the attempt, at which point the buffer is flushed and the rest of
// the attempt streams through live. Rejected (empty) attempts are discarded
// wholesale, so no structural parts, response metadata, or empty block
// markers from discarded requests ever leak into the logical stream — one
// retried request produces one clean stream. Because empty attempts still
// bill real tokens on hosted providers, their `finish.usage` is aggregated
// into the final finish part, so a turn that took three requests reports
// three requests' worth of usage.
//
// The same buffer-until-proven window also covers a second transient
// failure mode: the attempt's stream REJECTING with a network interruption
// before the model produced anything (see `isTransientNetworkError`).
// Production telemetry on the SDK arch shows these as the dominant
// network-class run killer — `terminated: SocketError: other side closed
// (UND_ERR_SOCKET)`, `terminated: BodyTimeoutError`, `terminated: read
// ECONNRESET`, `fetch failed: HeadersTimeoutError`. The AI SDK's own retry
// only guards request *initiation* (it re-runs `doStream()` when that call
// rejects with a retryable APICallError); once the stream has started, a
// body death escapes `postToApi`'s error wrapping and rejects the stream
// raw, killing the run — a failure the legacy extension's first-chunk retry
// loop absorbed silently. Retrying here is safe for the same reason the
// empty retry is: nothing has been emitted yet, so a discarded attempt is
// invisible to the consumer. A failure AFTER output has flowed still passes
// through unchanged (resuming mid-content would require deduplicating
// already-delivered text), and a user abort is never retried.
//
// Safety properties:
//   * A tool-call-only turn counts as content, so it is never retried.
//   * Unsupported-but-real output (custom parts, reasoning files, sources,
//     provider-executed tool results) is never retried either — the model
//     responded; re-billing the request would not help.
//   * Non-empty turns stream through live: buffering only lasts until the
//     first output part, which for a non-empty turn is the moment it starts
//     producing anything.
//   * Turns that finish with an error or hit the token limit are passed
//     through unchanged (retrying wouldn't help and could mask the cause).
//   * Provider-reported in-band `error` parts accept the attempt and pass
//     through — they are business errors, not transport failures.
//   * A successfully retried failure never reaches `streamText`, so no
//     `onError`/`captureSdkError`/`task.provider_api_error` fires for it;
//     an exhausted or non-retryable failure rejects the stream exactly as
//     an unwrapped one does today, leaving the reporting path unchanged.

import type {
	JSONValue,
	LanguageModelV4Middleware,
	LanguageModelV4StreamPart,
	LanguageModelV4StreamResult,
	LanguageModelV4Usage,
} from "@ai-sdk/provider";
import { classifyModelStreamPart } from "./stream-part-classification";

/** Minimal logger surface (a subset of `BasicLogger`). */
interface RetryLogger {
	log?(message: string, meta?: Record<string, unknown>): void;
}

export interface RetryEmptyResponseOptions {
	/** Total attempts including the first (so `3` means up to 2 retries). */
	maxAttempts?: number;
	/** Delay before each empty-response retry, in milliseconds. */
	retryDelayMs?: number;
	/**
	 * Delay before the first network-interruption retry, in milliseconds;
	 * doubles for each subsequent one (2s → 4s with the defaults, matching
	 * the legacy extension's backoff).
	 */
	networkRetryDelayMs?: number;
	logger?: RetryLogger;
}

/** Default total attempts (first try + 2 retries). */
export const DEFAULT_EMPTY_RESPONSE_MAX_ATTEMPTS = 3;
/** Default delay before a retry. */
export const DEFAULT_EMPTY_RESPONSE_RETRY_DELAY_MS = 250;
/** Default delay before the first network-interruption retry. */
export const DEFAULT_NETWORK_RETRY_DELAY_MS = 2_000;

const MAX_CAUSE_DEPTH = 8;

/**
 * Error codes of transient transport interruptions, from the runtimes this
 * package runs under: undici (Node fetch — the VS Code extension host),
 * plain Node/Bun sockets, and Bun's fetch (CLI, desktop sidecar).
 */
const TRANSIENT_NETWORK_ERROR_CODES = new Set([
	"UND_ERR_SOCKET",
	"UND_ERR_BODY_TIMEOUT",
	"UND_ERR_HEADERS_TIMEOUT",
	"UND_ERR_CONNECT_TIMEOUT",
	"ECONNRESET",
	"EPIPE",
	"ETIMEDOUT",
	"ConnectionClosed",
]);

/**
 * Node's fetch wraps every mid-body termination in `TypeError("terminated")`
 * (socket-level cause attached) and connection failures in
 * `TypeError("fetch failed")`; WebKit says "failed to fetch".
 */
const NETWORK_TYPE_ERROR_MESSAGES = new Set([
	"terminated",
	"fetch failed",
	"failed to fetch",
]);

/**
 * Whether an error (anywhere in its `cause` chain) identifies a transient
 * transport interruption — the connection died or timed out underneath a
 * request the provider never rejected. An abort anywhere in the chain
 * vetoes the match: cancelled requests surface the same socket vocabulary,
 * and a user cancel must never be retried. Everything else — HTTP business
 * errors, context-window errors, provider-reported payloads — does not
 * match.
 */
export function isTransientNetworkError(error: unknown): boolean {
	let aborted = false;
	let transient = false;
	let current: unknown = error;
	const seen = new Set<unknown>();
	for (
		let depth = 0;
		depth < MAX_CAUSE_DEPTH &&
		current != null &&
		typeof current === "object" &&
		!seen.has(current);
		depth++
	) {
		seen.add(current);
		const candidate = current as {
			name?: unknown;
			message?: unknown;
			code?: unknown;
			cause?: unknown;
		};
		if (
			candidate.name === "AbortError" ||
			candidate.name === "ResponseAborted"
		) {
			aborted = true;
		}
		if (
			(current instanceof TypeError &&
				typeof candidate.message === "string" &&
				NETWORK_TYPE_ERROR_MESSAGES.has(candidate.message.toLowerCase())) ||
			(typeof candidate.code === "string" &&
				TRANSIENT_NETWORK_ERROR_CODES.has(candidate.code))
		) {
			transient = true;
		}
		current = candidate.cause;
	}
	return transient && !aborted;
}

/**
 * Finish reasons that indicate a "normal" completion where an empty body is a
 * transient provider glitch worth retrying. `error` (upstream failure),
 * `length` (token limit — retrying re-hits it), and `content-filter` are left
 * alone.
 */
const RETRYABLE_FINISH_REASONS = new Set(["stop", "other", "unknown"]);

type FinishPart = Extract<LanguageModelV4StreamPart, { type: "finish" }>;

function addCounts(
	a: number | undefined,
	b: number | undefined,
): number | undefined {
	if (a === undefined && b === undefined) {
		return undefined;
	}
	return (a ?? 0) + (b ?? 0);
}

/**
 * ACT-CLINEMM-CMP09-INTEGRATED-AUTHORITY-CLOSURE-01 (A4.2).
 *
 * Whether an aggregate's output breakdown is COMPLETE.
 *
 * ## THE DEFECT THIS REPAIRS
 * --------------------------
 * The predecessor summed each attempt's breakdown with `addCounts`, which
 * treats an ABSENT count as `0`. For the AGGREGATE TOTAL that is correct:
 * an attempt that reported no output contributes nothing to the total
 * expenditure.
 *
 * For the AGGREGATE BREAKDOWN it is NOT correct: an absent breakdown means
 * the attempt's reasoning is UNKNOWN, not zero. Treating it as zero
 * manufactures a complete partition:
 *
 *   - attempt 1: total 900, reasoning 800
 *   - attempt 2: total 900, reasoning ABSENT
 *   - served:    total 900, reasoning 700
 *
 * The predecessor reported `reasoning = 1500` and `text = 300`, which is
 * WRONG twice over: the actual aggregate reasoning is not established (it is
 * at least 1500, and attempt 2's contribution is unknown), and the reported
 * `text` does not even satisfy `text + reasoning == total` (300 + 1500 =
 * 1800, not 2700), so the aggregate was internally INCONSISTENT.
 *
 * ## THE CONTRACT
 * ---------------
 * A breakdown is COMPLETE only when EVERY attempt in the aggregate reports
 * one. An attempt whose breakdown is absent makes the aggregate's breakdown
 * INCOMPLETE, and an incomplete breakdown is OMITTED — the optional
 * breakdown is not emitted, and the aggregate's TOTAL is conserved exactly.
 *
 * The consumer then reads the aggregate as "the total is established; the
 * breakdown is not established", which is the truth. It never reads a
 * fabricated partition.
 */
function isCompleteBreakdown(usage: LanguageModelV4Usage): boolean {
	return (
		readAttemptReasoning(usage) !== undefined &&
		readAttemptVisibleOutput(usage) !== undefined
	);
}

/**
 * ACT-CLINEMM-PROVIDER-USAGE-NORMALIZATION-AUTHORITY-01.
 *
 * The REASONING BREAKDOWN of a single attempt's usage.
 *
 * The AI SDK's `LanguageModelV4Usage` contract states that
 * `outputTokens.total` is "the total number of output (completion) tokens
 * used" and that `outputTokens.text` and `outputTokens.reasoning` are its
 * PARTS — so `total = text + reasoning`, and the reasoning is a SUBSET of
 * the total.
 *
 * The structured `outputTokens.reasoning` is preferred. The raw provider
 * payload is the fallback for the providers whose adapter does not populate
 * the structured breakdown — the resolved `@ai-sdk/anthropic` adapter, for
 * instance, only reads `output_tokens_details.thinking_tokens` from the
 * FINAL (`message_delta`) usage frame and drops the OPENING
 * (`message_start`) frame's breakdown, so an Anthropic-shaped provider that
 * reports the breakdown in the opening frame leaves the structured field
 * empty while the raw payload still carries it.
 */
function readAttemptReasoning(usage: LanguageModelV4Usage): number | undefined {
	const structured = usage.outputTokens?.reasoning;
	if (typeof structured === "number" && Number.isFinite(structured)) {
		return structured;
	}
	const raw = usage.raw;
	if (!raw || typeof raw !== "object") {
		return undefined;
	}
	const rawRecord = raw as Record<string, unknown>;
	const details = rawRecord.output_tokens_details;
	if (details && typeof details === "object") {
		const detailRecord = details as Record<string, unknown>;
		for (const key of ["reasoning_tokens", "thinking_tokens"]) {
			const value = detailRecord[key];
			if (typeof value === "number" && Number.isFinite(value)) {
				return value;
			}
		}
	}
	for (const key of ["reasoning_tokens", "reasoningTokens"]) {
		const value = rawRecord[key];
		if (typeof value === "number" && Number.isFinite(value)) {
			return value;
		}
	}
	return undefined;
}

/**
 * ACT-CLINEMM-PROVIDER-USAGE-NORMALIZATION-AUTHORITY-01.
 *
 * The VISIBLE (text-only) output of a single attempt's usage.
 *
 * When the attempt's usage carries the SDK's structured remainder, that
 * value IS the visible output. Otherwise the visible output is the total
 * minus the reasoning — but only when the reasoning is known to be part of
 * THAT attempt's total.
 */
function readAttemptVisibleOutput(
	usage: LanguageModelV4Usage,
): number | undefined {
	const structured = usage.outputTokens?.text;
	if (typeof structured === "number" && Number.isFinite(structured)) {
		return structured;
	}
	const total = usage.outputTokens?.total;
	if (typeof total !== "number" || !Number.isFinite(total)) {
		return undefined;
	}
	const reasoning = readAttemptReasoning(usage);
	if (reasoning === undefined) {
		return undefined;
	}
	return Math.max(0, total - reasoning);
}

/** Sum two standardized v4 usage records field by field. */
export function addUsage(
	a: LanguageModelV4Usage,
	b: LanguageModelV4Usage,
): LanguageModelV4Usage {
	//
	// ACT-CLINEMM-PROVIDER-USAGE-NORMALIZATION-AUTHORITY-01.
	//
	// Each record's breakdown is resolved INDEPENDENTLY and then summed.
	//
	// Resolving them independently is what keeps the aggregate's breakdown
	// scoped to exactly the attempts the aggregate's total covers. A record
	// whose adapter left the structured breakdown empty must not contribute
	// a zero: its breakdown is recovered from its own raw payload, which
	// describes that attempt alone. Summing the resolved values — rather
	// than preferring one side's structured field — is what makes
	// `visible + reasoning == total` hold for the aggregate.
	//
	// A record that reports NO breakdown at all (neither structured nor raw)
	// contributes nothing to the aggregate's breakdown: its output is
	// unknown, not zero, so the aggregate's breakdown stays incomplete
	// rather than falsely complete.
	//
	// ACT-CLINEMM-CMP09-INTEGRATED-AUTHORITY-CLOSURE-01 (A4.2).
	//
	// THE BREAKDOWN IS ALL-OR-NOTHING.
	//
	// The predecessor summed the per-attempt breakdowns with `addCounts`,
	// which treats an ABSENT breakdown as ZERO. That is correct for the
	// TOTAL (an attempt that reported no output contributes nothing to the
	// expenditure) but WRONG for the BREAKDOWN: an absent breakdown means the
	// attempt's reasoning is UNKNOWN, not zero.
	//
	// The consequence was a fabricated AND internally inconsistent
	// partition: for attempts of (900/800), (900/absent) and (900/700) the
	// predecessor reported `reasoning = 1500` and `text = 300`, where
	// 300 + 1500 != 2700 — the aggregate did not even satisfy its own
	// partition identity.
	//
	// The breakdown is therefore emitted only when EVERY attempt in the
	// aggregate reports a complete one. Otherwise it is OMITTED, and the
	// TOTAL is conserved exactly. The aggregate then reads as "the
	// expenditure is established; the breakdown is not", which is the truth.
	const breakdownComplete = isCompleteBreakdown(a) && isCompleteBreakdown(b);
	const reasoning = breakdownComplete
		? addCounts(readAttemptReasoning(a), readAttemptReasoning(b))
		: undefined;
	const text = breakdownComplete
		? addCounts(readAttemptVisibleOutput(a), readAttemptVisibleOutput(b))
		: undefined;
	const total = addCounts(a.outputTokens?.total, b.outputTokens?.total);
	return {
		inputTokens: {
			total: addCounts(a.inputTokens?.total, b.inputTokens?.total),
			noCache: addCounts(a.inputTokens?.noCache, b.inputTokens?.noCache),
			cacheRead: addCounts(a.inputTokens?.cacheRead, b.inputTokens?.cacheRead),
			cacheWrite: addCounts(
				a.inputTokens?.cacheWrite,
				b.inputTokens?.cacheWrite,
			),
		},
		outputTokens: {
			total,
			// The SDK's usage contract declares `text` and `reasoning` as
			// `number | undefined` — the KEYS are always present and their
			// VALUE is undefined when the quantity is not established. An
			// INCOMPLETE breakdown is therefore carried as `undefined`, not
			// as an omitted key and never as a fabricated zero.
			text,
			reasoning,
		},
		// `raw` is provider-specific and cannot be summed generically; the
		// emitted finish keeps the final attempt's raw payload.
		...(b.raw !== undefined ? { raw: b.raw } : {}),
	};
}

/**
 * ACT-CLINEMM-CMP09-CONTEXT-BUDGET-AUTHORITY-01 (ADDENDUM-01 CORRECTION-01).
 *
 * THE PHYSICAL-REQUEST OCCUPANCY AUTHORITY.
 *
 * WHY IT EXISTS
 * -------------
 * The middleware AGGREGATES the discarded attempts' usage into the emitted
 * finish part, so `usage.inputTokens.total` is the SUM over the physical
 * attempts of the turn. That aggregate is the correct BILLING quantity: the
 * provider charged for every attempt.
 *
 * It is NOT the correct CONTEXT-OCCUPANCY quantity. The provider's context
 * window is occupied by ONE request's prompt; re-sending the same prompt
 * three times costs three times as much but occupies the window exactly as
 * much as sending it once.
 *
 * THE THREE STATES
 * ---------------
 * The authority is a THREE-VALUED fact, and collapsing it to two is what
 * reintroduced the aggregate as an occupancy:
 *
 *   "single"  the turn made exactly ONE physical attempt, so the aggregate
 *             IS that request's occupancy (the LEGACY shape);
 *   "known"   the turn made several physical attempts and the SERVED
 *             attempt's own prompt size is established, so THAT is the
 *             occupancy;
 *   "unknown" the turn made several physical attempts and the served
 *             attempt's prompt size was NOT established. The aggregate
 *             covers an UNKNOWN number of requests, so it describes NO
 *             request's occupancy. The occupancy authority is DENIED, and
 *             the consumer must NOT fall back to the aggregate.
 *
 * "unknown" is an EXPLICIT denial, not an absence: it says the measurement
 * exists in principle but was not established, which is exactly what forbids
 * the aggregate fallback.
 *
 * THE PROVENANCE
 * --------------
 * The authority travels in the finish part's `providerMetadata`, under the
 * `cline` namespace. `providerMetadata` is `Record<string, JSONObject>` keyed
 * by the OWNING provider's name (`anthropic`, `google`, `vertex`, ...), so a
 * `cline` namespace is MIDDLEWARE-OWNED and a provider cannot forge it.
 *
 * It deliberately does NOT travel in `usage.raw`: the resolved
 * `@ai-sdk/anthropic` adapter sets `raw` to the PROVIDER'S OWN raw usage
 * payload (`raw: rawUsage ?? usage`), so a provider-supplied raw field could
 * otherwise establish the occupancy authority.
 */
export const PHYSICAL_REQUEST_OCCUPANCY_METADATA_NAMESPACE = "cline";

/** The key under which the occupancy authority travels. */
export const PHYSICAL_REQUEST_OCCUPANCY_METADATA_KEY =
	"physicalRequestOccupancy";

/**
 * The THREE-VALUED occupancy authority.
 *
 * `value` is the individual request's context occupancy, present only for
 * the "known" state. `attemptCount` is the number of physical attempts the
 * aggregate covers, which is what makes the "single" state distinguishable
 * from the "unknown" one.
 */
export interface PhysicalRequestOccupancy {
	readonly state: "single" | "known" | "unknown";
	readonly value?: number;
	readonly attemptCount: number;
	/**
	 * The authority travels inside the SDK's `providerMetadata`, whose value
	 * type is `JSONObject` — a record whose index signature is
	 * `JSONValue | undefined`. The index signature is declared so the
	 * authority satisfies that contract structurally, without a cast at the
	 * stamping site.
	 */
	readonly [key: string]: JSONValue | undefined;
}

/**
 * Build the occupancy authority for a turn.
 *
 * `attemptCount` is the number of physical attempts the aggregate covers and
 * `servedInputTokens` is the SERVED attempt's OWN prompt size (undefined
 * when the provider did not report one).
 *
 * A served count that is absent, zero, negative or non-finite is NOT a
 * measurement: it grants no occupancy authority.
 */
export function buildPhysicalRequestOccupancy(input: {
	attemptCount: number;
	servedInputTokens: number | undefined;
}): PhysicalRequestOccupancy {
	const attemptCount = Math.max(1, Math.floor(input.attemptCount));
	const served = input.servedInputTokens;
	const servedIsAMeasurement =
		typeof served === "number" && Number.isFinite(served) && served > 0;
	if (attemptCount === 1) {
		// ONE physical attempt: the aggregate IS the request's occupancy,
		// so the legacy single-request shape is preserved exactly.
		return {
			state: "single",
			attemptCount,
			...(servedIsAMeasurement ? { value: served } : {}),
		};
	}
	if (servedIsAMeasurement) {
		return { state: "known", value: served, attemptCount };
	}
	// SEVERAL attempts and no established served count: the aggregate
	// covers an UNKNOWN number of requests' worth of expenditure, so it
	// establishes NO request's occupancy. The authority is DENIED.
	return { state: "unknown", attemptCount };
}

/**
 * Read the occupancy authority out of a finish part's `providerMetadata`.
 *
 * The value is read ONLY from the middleware-owned `cline` namespace. A
 * provider-supplied `usage.raw` field can never establish this authority.
 *
 * ## THE THREE OUTCOMES
 * ---------------------
 *   `undefined`  NO authority is present at all. The consumer treats this as
 *                 the LEGACY single-request shape (the usage describes ONE
 *                 request, so its input count IS that request's occupancy).
 *
 *   `{ state: "unknown" }`  an authority IS present but it establishes NO
 *                 occupancy. The consumer MUST NOT fall back to the aggregate.
 *
 *   a valid record  the established occupancy.
 *
 * ACT-CLINEMM-CMP09-INTEGRATED-AUTHORITY-CLOSURE-01 (A5.1).
 *
 * The distinction between "absent" and "present but invalid" is LOAD-BEARING.
 * The predecessor returned `undefined` for BOTH, so a CONTRADICTORY record
 * (`state: "single"` with `attemptCount: 3`) was erased into the LEGACY
 * shape — and the legacy shape reads the usage's input count as the
 * occupancy, which for a multi-attempt turn is the AGGREGATE EXPENDITURE.
 * That re-enabled exactly the aggregate fallback the three-state
 * architecture exists to forbid.
 *
 * So a record that is PRESENT but invalid is now reported as an EXPLICIT
 * denial (`state: "unknown"`), never as an absence.
 */
export function readPhysicalRequestOccupancy(
	providerMetadata: unknown,
): PhysicalRequestOccupancy | undefined {
	if (!providerMetadata || typeof providerMetadata !== "object") {
		return undefined;
	}
	const namespace = (providerMetadata as Record<string, unknown>)[
		PHYSICAL_REQUEST_OCCUPANCY_METADATA_NAMESPACE
	];
	if (!namespace || typeof namespace !== "object") {
		return undefined;
	}
	const raw = (namespace as Record<string, unknown>)[
		PHYSICAL_REQUEST_OCCUPANCY_METADATA_KEY
	];
	if (!raw || typeof raw !== "object") {
		return undefined;
	}
	const record = raw as Record<string, unknown>;
	// ACT-CLINEMM-CMP09-INTEGRATED-AUTHORITY-CLOSURE-01 (A5.1).
	//
	// A record that is PRESENT but not VALID is an EXPLICIT denial, never an
	// absence. The distinction matters: an absence means the LEGACY
	// single-request shape, whose input count IS the occupancy — and for a
	// multi-attempt turn that count is the AGGREGATE EXPENDITURE. An
	// explicit denial forbids that fallback.
	const denied: PhysicalRequestOccupancy = {
		state: "unknown",
		attemptCount: 1,
	};
	const state = record.state;
	if (state !== "single" && state !== "known" && state !== "unknown") {
		return denied;
	}
	// ACT-CLINEMM-CMP09-INTEGRATED-AUTHORITY-CLOSURE-01 (A5.1).
	//
	// THE CARDINALITY MUST BE CONSISTENT WITH THE STATE.
	//
	// The predecessor NORMALIZED the attempt count with
	// `Math.max(1, Math.floor(...))` and accepted the record whatever it
	// said. A CONTRADICTORY record — `state: "single"` with
	// `attemptCount: 3` — was therefore accepted as a "single" request, and
	// the consumer reads the "single" state as "the aggregate IS this
	// request's occupancy". That re-enabled exactly the aggregate fallback
	// the three-state architecture exists to forbid.
	//
	// The contract is now:
	//
	//   single + attemptCount = 1     VALID
	//   single + attemptCount = 3     INVALID (denied)
	//   known  + a valid positive value   VALID
	//   known  + an invalid value          DENIED
	//   unknown                      DENIED as an occupancy (it IS returned
	//                                      here, and the consumer denies it)
	//
	// An invalid or contradictory record is DENIED outright: the reader
	// returns NO authority, so the consumer falls into its legacy
	// single-request branch — which uses THAT request's own usage, never an
	// aggregate — and clears any stale occupancy.
	const rawAttemptCount = record.attemptCount;
	const attemptCountIsValid =
		typeof rawAttemptCount === "number" &&
		Number.isFinite(rawAttemptCount) &&
		Number.isInteger(rawAttemptCount) &&
		rawAttemptCount >= 1;
	if (!attemptCountIsValid) {
		return denied;
	}
	const attemptCount: number = rawAttemptCount;
	if (state === "single" && attemptCount !== 1) {
		// A "single" request cannot have made three attempts.
		return denied;
	}
	if (state === "known" && attemptCount === 1) {
		// A "known" occupancy describes a request among SEVERAL; with one
		// attempt the aggregate IS the request's occupancy, which is the
		// "single" state. The record is contradictory.
		return denied;
	}
	const value = record.value;
	const valueIsAMeasurement =
		typeof value === "number" && Number.isFinite(value) && value > 0;
	if (state === "known" && !valueIsAMeasurement) {
		// A "known" occupancy without a valid value establishes NOTHING.
		// Returning it would let the consumer read an absent value as an
		// occupancy of zero.
		return denied;
	}
	return {
		state,
		attemptCount,
		...(valueIsAMeasurement ? { value } : {}),
	};
}

/**
 * Stamp the occupancy authority onto a finish part's `providerMetadata`.
 */
function withOccupancyAuthority(
	finish: FinishPart,
	occupancy: PhysicalRequestOccupancy,
): FinishPart {
	const existing = finish.providerMetadata;
	const existingRecord =
		existing && typeof existing === "object"
			? (existing as Record<string, unknown>)
			: {};
	const existingNamespace =
		existingRecord[PHYSICAL_REQUEST_OCCUPANCY_METADATA_NAMESPACE];
	const namespaceRecord =
		existingNamespace && typeof existingNamespace === "object"
			? (existingNamespace as Record<string, unknown>)
			: {};
	return {
		...finish,
		providerMetadata: {
			...existingRecord,
			[PHYSICAL_REQUEST_OCCUPANCY_METADATA_NAMESPACE]: {
				...namespaceRecord,
				[PHYSICAL_REQUEST_OCCUPANCY_METADATA_KEY]: occupancy,
			},
		},
	};
}

/**
 * Fold the usage of discarded attempts into the finish part that is actually
 * emitted, so hosted-provider billing reflects every request the turn made
 * (including cache and reasoning detail), not just the accepted one.
 *
 * ACT-CLINEMM-CMP09-CONTEXT-BUDGET-AUTHORITY-01 (ADDENDUM-01 CORRECTION-01):
 * the CONTEXT-OCCUPANCY authority is stamped alongside the aggregate, so
 * the compaction budget's calibration is bound to the INDIVIDUAL request
 * while the BILLING authority keeps the aggregate.
 */
function withAggregatedUsage(
	finish: FinishPart,
	discardedUsage: readonly LanguageModelV4Usage[],
): FinishPart {
	if (discardedUsage.length === 0) {
		// ONE physical attempt: the aggregate IS the request's occupancy.
		return withOccupancyAuthority(
			finish,
			buildPhysicalRequestOccupancy({
				attemptCount: 1,
				servedInputTokens: finish.usage.inputTokens?.total,
			}),
		);
	}
	let usage = finish.usage;
	for (const discarded of discardedUsage) {
		usage = addUsage(discarded, usage);
	}
	const aggregated: FinishPart = { ...finish, usage };
	return withOccupancyAuthority(
		aggregated,
		buildPhysicalRequestOccupancy({
			attemptCount: discardedUsage.length + 1,
			servedInputTokens: finish.usage.inputTokens?.total,
		}),
	);
}

/** Sleep that resolves early (without throwing) when the signal aborts. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		if (ms <= 0 || signal?.aborted) {
			resolve();
			return;
		}
		const onAbort = () => {
			clearTimeout(timer);
			resolve();
		};
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

/**
 * Create a middleware that retries empty model responses. Apply it as the
 * outermost middleware (first in the `wrapLanguageModel` array) so each retry
 * re-runs the full request.
 */
export function createRetryEmptyResponseMiddleware(
	options: RetryEmptyResponseOptions = {},
): LanguageModelV4Middleware {
	const maxAttempts = Math.max(
		1,
		options.maxAttempts ?? DEFAULT_EMPTY_RESPONSE_MAX_ATTEMPTS,
	);
	const retryDelayMs = Math.max(
		0,
		options.retryDelayMs ?? DEFAULT_EMPTY_RESPONSE_RETRY_DELAY_MS,
	);
	const networkRetryDelayMs = Math.max(
		0,
		options.networkRetryDelayMs ?? DEFAULT_NETWORK_RETRY_DELAY_MS,
	);
	const logger = options.logger;

	return {
		specificationVersion: "v4",
		wrapStream: async ({ doStream, params, model }) => {
			const abortSignal = params.abortSignal;
			// Kick off the first attempt eagerly, matching normal doStream timing.
			const firstResult = await doStream();
			// The AI SDK holds this object until step completion; keep its headers
			// aligned with the surfaced attempt rather than a discarded retry.
			const response = { ...firstResult.response };

			const stream = new ReadableStream<LanguageModelV4StreamPart>({
				async start(controller) {
					let result: LanguageModelV4StreamResult = firstResult;
					const discardedUsage: LanguageModelV4Usage[] = [];
					// Counted separately from the shared attempt number so the
					// first network retry always waits `networkRetryDelayMs`,
					// regardless of any empty-response retries that came first.
					let networkRetries = 0;

					for (let attempt = 1; ; attempt++) {
						response.headers = result.response?.headers;
						const reader = result.stream.getReader();
						// Parts held back until this attempt proves non-empty.
						const buffered: LanguageModelV4StreamPart[] = [];
						let accepted = false;
						let pendingFinish: FinishPart | null = null;
						let streamFailure: unknown;
						let streamFailed = false;

						try {
							while (true) {
								const { done, value } = await reader.read();
								if (done) {
									break;
								}
								if (value.type === "finish") {
									// Held back so the emitted finish can carry
									// aggregated usage; it is always last anyway.
									pendingFinish = value;
									continue;
								}
								if (!accepted) {
									const kind = classifyModelStreamPart(value);
									if (
										kind === "converted-content" ||
										kind === "unsupported-output" ||
										kind === "error"
									) {
										// The model produced output (or a real
										// error): accept this attempt, flush what
										// was buffered, and go live.
										accepted = true;
										for (const part of buffered) {
											controller.enqueue(part);
										}
										buffered.length = 0;
									}
								}
								if (accepted) {
									controller.enqueue(value);
								} else {
									buffered.push(value);
								}
							}
						} catch (error) {
							streamFailed = true;
							streamFailure = error;
						} finally {
							reader.releaseLock();
						}

						if (streamFailed) {
							const canRetryFailure =
								// Only a pre-content death is retried; once
								// output has flowed, resuming would replay
								// text the consumer already saw.
								!accepted &&
								attempt < maxAttempts &&
								abortSignal?.aborted !== true &&
								isTransientNetworkError(streamFailure);
							if (!canRetryFailure) {
								controller.error(streamFailure);
								return;
							}
							if (pendingFinish) {
								discardedUsage.push(pendingFinish.usage);
							}
							response.headers = undefined;
							const delayMs = networkRetryDelayMs * 2 ** networkRetries;
							networkRetries++;
							logger?.log?.(
								"Transient network interruption before any model output; retrying",
								{
									severity: "warn",
									provider: model.provider,
									modelId: model.modelId,
									attempt,
									maxAttempts,
									retryDelayMs: delayMs,
									error:
										streamFailure instanceof Error
											? streamFailure.message
											: String(streamFailure),
								},
							);
							await sleep(delayMs, abortSignal);
							if (abortSignal?.aborted) {
								// The user cancelled during backoff: surface
								// the abort instead of re-dialing.
								controller.error(abortSignal.reason ?? streamFailure);
								return;
							}
							try {
								result = await doStream();
							} catch (error) {
								controller.error(error);
								return;
							}
							continue;
						}

						if (accepted) {
							if (pendingFinish) {
								controller.enqueue(
									withAggregatedUsage(pendingFinish, discardedUsage),
								);
							}
							controller.close();
							return;
						}

						const finishReason =
							pendingFinish?.finishReason.unified ?? "unknown";
						const canRetry =
							attempt < maxAttempts &&
							RETRYABLE_FINISH_REASONS.has(finishReason);

						if (!canRetry) {
							// Out of retries (or a non-retryable finish): surface
							// the final attempt as-is — its structural parts plus a
							// finish carrying every attempt's usage — so the
							// downstream failure is honest about what happened.
							for (const part of buffered) {
								controller.enqueue(part);
							}
							if (pendingFinish) {
								controller.enqueue(
									withAggregatedUsage(pendingFinish, discardedUsage),
								);
							}
							controller.close();
							return;
						}

						if (pendingFinish) {
							discardedUsage.push(pendingFinish.usage);
						}

						response.headers = undefined;
						logger?.log?.("Model returned an empty response; retrying", {
							severity: "warn",
							provider: model.provider,
							modelId: model.modelId,
							attempt,
							maxAttempts,
							finishReason,
						});

						if (retryDelayMs > 0) {
							await sleep(retryDelayMs, abortSignal);
						}
						if (abortSignal?.aborted) {
							// The user cancelled during backoff: surface the abort
							// instead of re-dialing with an already-aborted signal.
							controller.error(abortSignal.reason);
							return;
						}
						try {
							result = await doStream();
						} catch (error) {
							controller.error(error);
							return;
						}
					}
				},
			});

			return { ...firstResult, response, stream };
		},
	};
}
