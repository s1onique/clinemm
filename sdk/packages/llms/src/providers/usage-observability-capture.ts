/**
 * ACT-CLINEMM-PROVIDER-USAGE-NORMALIZATION-AUTHORITY-01.
 *
 * The NUMERIC USAGE capture.
 *
 * ## Why this exists
 *
 * The provider usage authority is a CHAIN, and each link can lose or distort
 * a number:
 *
 *   provider SSE usage frames
 *     -> the provider adapter (`@ai-sdk/anthropic`, ...)
 *     -> the AI SDK's normalized usage (`asLanguageModelUsage`)
 *     -> ClineMM's `normalizeUsage`
 *
 * The frozen observations that motivated this ACT could not be attributed to
 * a link, because the RAW provider numbers were not observable: only the
 * FINAL normalized value was persisted. Without the raw layer, a claim such
 * as "the provider reported 900 and ClineMM recorded 1900" is only a claim
 * about the SUM of the chain, not about any particular link.
 *
 * This capture makes the chain observable at its three numeric layers, and
 * correlates them by the PHYSICAL REQUEST IDENTITY, so a reader can tell
 * which link lost or distorted a number.
 *
 * ## The privacy contract
 *
 * The record carries NUMBERS and IDENTITIES ONLY:
 *
 *   - the physical request identity (provider / model / attempt / iteration);
 *   - the raw provider's numeric usage fields, by NAME;
 *   - the AI SDK's normalized numeric usage;
 *   - ClineMM's final normalized numeric usage.
 *
 * It never carries a raw transcript, reasoning TEXT, a response body, a
 * credential, a signature, a prompt, a message body or a tool payload. The
 * raw provider usage is traversed by an explicit ALLOWLIST of numeric field
 * names, so an unexpected field cannot leak by accident.
 *
 * ## The DEFAULT-OFF contract
 *
 * The switch is `CLINEMM_USAGE_OBSERVABILITY`, and only the exact value `1`
 * arms it. When it is not armed, this module returns immediately: no
 * directory is resolved, no file is written, and the disabled path performs
 * no serialization and no filesystem access.
 *
 * ## The failure contract
 *
 * Every write is FAIL-ISOLATED: a capture failure must never change
 * provider execution or accounting. The whole capture body is wrapped so
 * that no throw can escape into the provider path.
 */

import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** The environment variable that arms the capture. */
export const USAGE_OBSERVABILITY_ENV = "CLINEMM_USAGE_OBSERVABILITY" as const;

/** The capture file extension. */
const USAGE_OBSERVABILITY_FILE_EXTENSION = ".usage-observability.json";

/**
 * The NUMERIC USAGE ALLOWLIST.
 *
 * Only these field names are read out of a raw provider usage payload, and
 * only their NUMERIC values are retained. A field that is not on this list
 * is never read, so it cannot leak.
 *
 * The list covers the provider contracts whose usage shapes are established:
 * the Anthropic Messages counters, the OpenAI-family counters, and the
 * Google-family counters.
 */
const RAW_NUMERIC_USAGE_ALLOWLIST: readonly string[] = [
	// Anthropic Messages.
	"input_tokens",
	"output_tokens",
	"cache_creation_input_tokens",
	"cache_read_input_tokens",
	"thinking_tokens",
	"reasoning_tokens",
	// OpenAI family.
	"prompt_tokens",
	"completion_tokens",
	"total_tokens",
	"cached_tokens",
	"cache_write_tokens",
	// Google family.
	"promptTokenCount",
	"candidatesTokenCount",
	"totalTokenCount",
	"cachedContentTokenCount",
	"thoughtsTokenCount",
];

/**
 * The NESTED detail objects whose numeric members are read.
 *
 * The reasoning breakdown and the cache breakdown live one level down in
 * the provider payloads, so their parent objects are traversed — but only
 * the allowlisted numeric members of those parents are read.
 */
const RAW_DETAIL_ALLOWLIST: readonly string[] = [
	"output_tokens_details",
	"completion_tokens_details",
	"prompt_tokens_details",
	"input_tokens_details",
];

/**
 * Is the capture armed?
 *
 * Only the exact value `1` arms it, matching the established convention of
 * the sibling forensic capture: a stray boolean-ish value cannot silently
 * arm a diagnostic that writes files.
 */
export function isUsageObservabilityEnabled(): boolean {
	return process.env[USAGE_OBSERVABILITY_ENV]?.trim() === "1";
}

/** A numeric usage field read out of a raw provider payload. */
export interface RawNumericUsage {
	/** The provider's field name. */
	readonly field: string;
	/** The provider's numeric value. */
	readonly value: number;
	/** The provider's nested object the field lives in, when nested. */
	readonly parent?: string;
}

/**
 * Reads the ALLOWLISTED numeric usage fields out of a raw provider usage
 * payload.
 *
 * Only numbers are retained, and only for allowlisted field names. A
 * non-numeric value is skipped rather than coerced, so a stringified
 * number cannot enter the capture.
 */
export function readRawNumericUsage(raw: unknown): RawNumericUsage[] {
	if (!raw || typeof raw !== "object") {
		return [];
	}
	const record = raw as Record<string, unknown>;
	const found: RawNumericUsage[] = [];
	for (const field of RAW_NUMERIC_USAGE_ALLOWLIST) {
		const value = record[field];
		if (typeof value === "number" && Number.isFinite(value)) {
			found.push({ field, value });
		}
	}
	for (const parent of RAW_DETAIL_ALLOWLIST) {
		const details = record[parent];
		if (!details || typeof details !== "object") {
			continue;
		}
		const detailRecord = details as Record<string, unknown>;
		for (const field of RAW_NUMERIC_USAGE_ALLOWLIST) {
			const value = detailRecord[field];
			if (typeof value === "number" && Number.isFinite(value)) {
				found.push({ field, value, parent });
			}
		}
	}
	return found;
}

/**
 * The recorded observation.
 *
 * Every field is either an identity or a NUMBER.
 */
export interface UsageObservabilityRecord {
	/** The capture schema version. */
	readonly schemaVersion: number;
	/** When the observation was taken. */
	readonly observedAt: string;
	/** The provider id. */
	readonly providerId?: string;
	/** The model id. */
	readonly modelId?: string;
	/** The session id. */
	readonly sessionId?: string;
	/**
	 * The LOGICAL MODEL REQUEST identity.
	 *
	 * ACT-CLINEMM-CMP09-INTEGRATED-AUTHORITY-CLOSURE-01 (A4).
	 *
	 * The predecessor called this `providerAttemptId`, which asserted a
	 * PHYSICAL ATTEMPT identity the value does not carry. The value is the
	 * runtime's `modelRequestId` — the identity of the LOGICAL model
	 * request. The production retry middleware re-dials that SAME request
	 * internally, so all of a turn's physical attempts share ONE
	 * `modelRequestId`.
	 *
	 * The record therefore states the identity it actually has, and the
	 * PHYSICAL correlation is reported separately (and only when it is
	 * established).
	 */
	readonly modelRequestId?: string;
	/**
	 * The PHYSICAL ATTEMPT identity, when one is ESTABLISHED.
	 *
	 * ACT-CLINEMM-CMP09-INTEGRATED-AUTHORITY-CLOSURE-01 (A4): the physical
	 * attempt count is an OBSERVED fact (the middleware-owned occupancy
	 * authority), but the per-attempt IDENTITIES are not observable at this
	 * boundary — the middleware aggregates the attempts and does not mint
	 * per-attempt ids. So this is ABSENT unless a real per-attempt identity
	 * is available, and never the logical request id.
	 */
	readonly physicalAttemptId?: string;
	/** The iteration. */
	readonly iteration?: number;
	/**
	 * The provider's own numeric usage fields.
	 *
	 * ACT-CLINEMM-CMP09-INTEGRATED-AUTHORITY-CLOSURE-01 (A4): the SCOPE of
	 * these fields is the SERVED ATTEMPT, always. The production retry
	 * middleware keeps the served attempt's raw payload on the aggregate, so
	 * the raw numbers describe ONE attempt even when the recorded usage is
	 * the turn's aggregate. `rawUsageScope` states that explicitly.
	 */
	readonly rawProviderUsage: readonly RawNumericUsage[];
	/**
	 * The SCOPE of `rawProviderUsage`.
	 *
	 * ACT-CLINEMM-CMP09-INTEGRATED-AUTHORITY-CLOSURE-01 (A4): the raw
	 * payload is ALWAYS the served attempt's, so this is
	 * "served-attempt" — never the aggregate's.
	 */
	readonly rawUsageScope?: "served-attempt";
	/** The AI SDK's normalized numeric usage. */
	readonly sdkUsage?: Record<string, number | undefined>;
	/** ClineMM's final normalized numeric usage. */
	readonly clineUsage?: Record<string, number | undefined>;
	/**
	 * The SCOPE of the usage recorded above.
	 *
	 * ACT-CLINEMM-CMP09-INTEGRATED-AUTHORITY-CLOSURE-01 (A6).
	 *
	 * The four observations are DIFFERENT quantities, and a reader must be
	 * able to tell them apart:
	 *
	 *   "physical-attempt"  ONE physical request's own usage;
	 *   "turn-aggregate"    the SUM over the turn's physical attempts (the
	 *                       BILLING quantity);
	 *   "served-occupancy"  the CONTEXT OCCUPANCY of the served request;
	 *   "normalized"        the normalized runtime usage.
	 *
	 * The predecessor recorded the usage without a scope, so a TURN
	 * AGGREGATE could be read as one PHYSICAL REQUEST's usage — the exact
	 * conflation the ACT forbids. The scope is now stated explicitly, and it
	 * is derived from the OBSERVED facts (the occupancy authority's attempt
	 * count), never invented.
	 */
	readonly usageScope?: UsageObservabilityScope;
	/**
	 * The OBSERVED number of physical attempts the recorded usage covers.
	 *
	 * ACT-CLINEMM-CMP09-INTEGRATED-AUTHORITY-CLOSURE-01 (A4): this is an
	 * OBSERVED fact (the middleware-owned occupancy authority). It is
	 * ABSENT when the authority established no cardinality — an unknown
	 * cardinality stays unknown and is never synthesized.
	 */
	readonly observedAttemptCount?: number;
	/**
	 * The CONTEXT OCCUPANCY of the served physical request, when it is
	 * ESTABLISHED.
	 *
	 * ACT-CLINEMM-CMP09-INTEGRATED-AUTHORITY-CLOSURE-01 (A4): it is
	 * distinguishable from both the aggregate expenditure and the
	 * individual attempt's usage, because it is a DIFFERENT quantity — the
	 * window the served request occupied.
	 */
	readonly servedOccupancy?: number;
}

/**
 * The scope of a recorded usage observation.
 *
 * ACT-CLINEMM-CMP09-INTEGRATED-AUTHORITY-CLOSURE-01 (A6).
 *
 * The values are the ESTABLISHED distinctions; no new registry is
 * introduced.
 */
export type UsageObservabilityScope =
	| "physical-attempt"
	| "turn-aggregate"
	| "served-occupancy"
	| "normalized";

/** The capture schema version. Bump when the record shape changes. */
const USAGE_OBSERVABILITY_SCHEMA_VERSION = 1 as const;

function safeFilePart(value: string): string {
	const safe = value.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
	return safe.slice(0, 64) || "unknown";
}

/**
 * The directory the observations are written to.
 *
 * `CLINEMM_USAGE_OBSERVABILITY_DIR` when the operator names one; otherwise
 * a directory under the data dir. The directory is created with
 * restrictive permissions (0o700) and each file with 0o600.
 */
function resolveObservabilityDir(): string | undefined {
	const explicit = process.env.CLINEMM_USAGE_OBSERVABILITY_DIR?.trim();
	if (explicit) {
		return resolve(explicit);
	}
	const dataDir = process.env.CLINE_DATA_DIR?.trim();
	if (dataDir) {
		return resolve(dataDir, "usage-observability");
	}
	return undefined;
}

/**
 * Write ONE observation.
 *
 * The record is written atomically (write to a temporary file, then rename),
 * with mode 0o600.
 */
function writeObservabilityRecord(record: UsageObservabilityRecord): void {
	try {
		const dir = resolveObservabilityDir();
		if (!dir) {
			return;
		}
		mkdirSync(dir, { recursive: true, mode: 0o700 });
		const name = [
			"uo",
			safeFilePart(record.providerId ?? "noprovider"),
			safeFilePart(record.modelId ?? "nomodel"),
			safeFilePart(record.sessionId ?? "nosession"),
			safeFilePart(record.modelRequestId ?? "noreq"),
			String(record.iteration ?? 0),
			String(record.observedAt.replace(/[^0-9]/g, "")),
		].join("_");
		const finalPath = join(dir, `${name}${USAGE_OBSERVABILITY_FILE_EXTENSION}`);
		const tmpPath = `${finalPath}.${process.pid}.${Date.now()}.tmp`;
		writeFileSync(tmpPath, `${JSON.stringify(record)}\n`, {
			encoding: "utf8",
			mode: 0o600,
		});
		renameSync(tmpPath, finalPath);
	} catch {
		// The capture must never affect model execution or accounting.
	}
}

/**
 * Reads the numeric members of a normalized usage object.
 *
 * Only the top-level numeric members are retained, and only under their
 * established usage names.
 */
function readNumericUsage(
	usage: unknown,
): Record<string, number | undefined> | undefined {
	if (!usage || typeof usage !== "object") {
		return undefined;
	}
	const record = usage as Record<string, unknown>;
	const names = [
		"inputTokens",
		"outputTokens",
		"cacheReadTokens",
		"cacheWriteTokens",
		"reasoningTokenCount",
		"totalCost",
	] as const;
	const result: Record<string, number | undefined> = {};
	let present = false;
	for (const name of names) {
		const value = record[name];
		if (typeof value === "number" && Number.isFinite(value)) {
			result[name] = value;
			present = true;
		}
	}
	return present ? result : undefined;
}

/**
 * Record ONE numeric usage observation.
 *
 * ## The DEFAULT-OFF contract
 *
 * When `CLINEMM_USAGE_OBSERVABILITY` is not exactly `1`, this function
 * returns IMMEDIATELY: no directory is resolved, no file is written, and
 * the disabled path performs no serialization and no filesystem access.
 *
 * ## The failure contract
 *
 * The whole body is failure-isolated. A malformed usage payload or a
 * filesystem error never changes provider execution or accounting.
 */
export function recordUsageObservability(input: {
	providerId?: string;
	modelId?: string;
	sessionId?: string;
	/**
	 * ACT-CLINEMM-CMP09-INTEGRATED-AUTHORITY-CLOSURE-01 (A4): the LOGICAL
	 * MODEL REQUEST identity. It is NOT a physical attempt identity: the
	 * production retry middleware re-dials the same logical request, so all
	 * of a turn's physical attempts share it.
	 */
	modelRequestId?: string;
	/**
	 * ACT-CLINEMM-CMP09-INTEGRATED-AUTHORITY-CLOSURE-01 (A4): a PHYSICAL
	 * ATTEMPT identity, when one is ESTABLISHED. Absent otherwise — the
	 * logical request id is never passed here.
	 */
	physicalAttemptId?: string;
	iteration?: number;
	/** The provider's raw usage payload. */
	raw?: unknown;
	/** The AI SDK's normalized usage. */
	sdkUsage?: unknown;
	/** ClineMM's final normalized usage. */
	clineUsage?: unknown;
	/**
	 * The SCOPE of the recorded usage.
	 *
	 * ACT-CLINEMM-CMP09-INTEGRATED-AUTHORITY-CLOSURE-01 (A6). The caller
	 * states the scope it observed; the capture records it verbatim and never
	 * infers one.
	 */
	usageScope?: UsageObservabilityScope;
	/**
	 * ACT-CLINEMM-CMP09-INTEGRATED-AUTHORITY-CLOSURE-01 (A4): the OBSERVED
	 * physical attempt count. ABSENT when it is unknown — an unknown
	 * cardinality is never synthesized.
	 */
	observedAttemptCount?: number;
	/**
	 * ACT-CLINEMM-CMP09-INTEGRATED-AUTHORITY-CLOSURE-01 (A4): the ESTABLISHED
	 * context occupancy of the served physical request.
	 */
	servedOccupancy?: number;
}): void {
	if (!isUsageObservabilityEnabled()) {
		return;
	}
	try {
		const sdkUsage = readNumericUsage(input.sdkUsage);
		const clineUsage = readNumericUsage(input.clineUsage);
		const record: UsageObservabilityRecord = {
			schemaVersion: USAGE_OBSERVABILITY_SCHEMA_VERSION,
			observedAt: new Date().toISOString(),
			...(input.providerId ? { providerId: input.providerId } : {}),
			...(input.modelId ? { modelId: input.modelId } : {}),
			...(input.sessionId ? { sessionId: input.sessionId } : {}),
			...(input.modelRequestId ? { modelRequestId: input.modelRequestId } : {}),
			...(input.physicalAttemptId
				? { physicalAttemptId: input.physicalAttemptId }
				: {}),
			...(typeof input.iteration === "number"
				? { iteration: input.iteration }
				: {}),
			rawProviderUsage: readRawNumericUsage(input.raw),
			// ACT-CLINEMM-CMP09-INTEGRATED-AUTHORITY-CLOSURE-01 (A4): the raw
			// payload is ALWAYS the served attempt's, whatever the scope of
			// the recorded usage is.
			rawUsageScope: "served-attempt",
			...(sdkUsage ? { sdkUsage } : {}),
			...(clineUsage ? { clineUsage } : {}),
			...(input.usageScope ? { usageScope: input.usageScope } : {}),
			...(input.observedAttemptCount !== undefined
				? { observedAttemptCount: input.observedAttemptCount }
				: {}),
			...(input.servedOccupancy !== undefined
				? { servedOccupancy: input.servedOccupancy }
				: {}),
		};
		writeObservabilityRecord(record);
	} catch {
		// The capture must never affect model execution or accounting.
	}
}
