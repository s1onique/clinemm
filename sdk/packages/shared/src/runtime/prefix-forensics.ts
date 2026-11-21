import { createHash, createHmac, randomBytes } from "node:crypto";

/**
 * ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-01.
 *
 * Shared primitives for the post-compaction prefix-cache forensics boundary.
 *
 * ## Why this module exists
 *
 * The observed post-compaction prefix-cache plateau needs an answer to ONE
 * question: **what is the earliest model-facing difference between two
 * consecutive provider requests?** Answering it requires observing the SAME
 * request at THREE representation boundaries (runtime projection, AI SDK
 * prompt, serialized wire body) and comparing them STRUCTURALLY.
 *
 * This module owns:
 *
 *   1. the OPT-IN switch (`CLINEMM_PREFIX_FORENSICS`) — DEFAULT OFF, with no
 *      observer, sink, allocation, hashing or filesystem access on the
 *      ordinary disabled path;
 *   2. the KEYED fingerprint primitive (HMAC-SHA-256) — a plain SHA-256 of a
 *      low-entropy private string is a dictionary-attackable disclosure of
 *      that string, so new fingerprints are keyed;
 *   3. the STRUCTURAL inventory of one request representation — roles, part
 *      types, per-part lengths and per-part keyed fingerprints, tool
 *      fingerprints, system fingerprint — with NO raw content;
 *   4. the capture record schema, which carries session / version / source /
 *      SHA-256 identity so a consumer can tell a real capture from a
 *      fabricated one.
 *
 * ## What this module deliberately does NOT do
 *
 * It does not persist raw prompts, message bodies, tool commands, tool
 * results, credentials, raw tool schemas, private project paths or unredacted
 * provider payloads. It never modifies the request it observes. It never
 * issues a provider request. It never changes retry or compaction behaviour.
 *
 * A fingerprint is an identity of a REPRESENTATION, not a proof of semantic
 * equality: two different contents can collide only by HMAC forgery, but the
 * same content under two different REPRESENTATIONS is deliberately NOT
 * comparable, because the representation identifier travels with it.
 */

/** The environment variable that arms the forensic capture. */
export const PREFIX_FORENSICS_ENV = "CLINEMM_PREFIX_FORENSICS" as const;

/**
 * The representation identifiers.
 *
 * A fingerprint is only meaningful together with the EXACT representation it
 * was computed over. These three are the three boundaries the ACT compares.
 */
export const PREFIX_FORENSICS_RUNTIME_PROJECTION =
	"AGENT_MODEL_REQUEST_FINAL_PROJECTION" as const;
export const PREFIX_FORENSICS_AI_SDK_PROMPT =
	"AI_SDK_REQUEST_MESSAGES" as const;
export const PREFIX_FORENSICS_WIRE_REQUEST =
	"SERIALIZED_PROVIDER_REQUEST" as const;

/** The capture schema version. Bump when the record shape changes. */
export const PREFIX_FORENSICS_SCHEMA_VERSION = 1 as const;

/** The producer identity that owns these fingerprints. */
export const PREFIX_FORENSICS_FINGERPRINT_PRODUCER =
	"@cline/shared/runtime/prefix-forensics" as const;

/**
 * ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-01.
 *
 * Is the forensic capture armed?
 *
 * The switch is read AT OBSERVATION TIME, never snapshotted at
 * construction time, so an already-armed process can be disarmed (and vice
 * versa) without a rebuild — and so the DEFAULT-OFF path pays nothing.
 *
 * Only the exact value `1` arms it. Any other value — including `0`,
 * `true`, `yes` and the empty string — leaves it OFF, so a stray boolean-ish
 * environment variable cannot silently arm a diagnostic that writes files.
 */
export function isPrefixForensicsEnabled(): boolean {
	return process.env[PREFIX_FORENSICS_ENV]?.trim() === "1";
}

/**
 * The keyed fingerprint of a string.
 *
 * HMAC-SHA-256 with a per-capture-session key. The key is NEVER persisted
 * into the capture record and NEVER committed to the repository: it is kept
 * locally, with restrictive permissions, only for as long as a comparison
 * cohort needs to be compared.
 *
 * A keyed fingerprint is comparable across requests in the SAME cohort (same
 * key) and is not comparable across cohorts. This is why the capture record
 * carries a COHORT id and never the key itself.
 */
export function keyedFingerprintHex(key: string, value: string): string {
	// `node:crypto` is imported at module scope in Node; the browser build
	// of this package never reaches the forensic path (it is a dogfood-only
	// diagnostic), so a static import is safe and keeps the primitive
	// synchronous.
	return createHmac("sha256", key).update(value, "utf8").digest("hex");
}

/**
 * The UTF-8 byte length of a string.
 *
 * Byte length — not character count — because the provider serializes bytes.
 */
export function utf8ByteLength(value: string): number {
	return Buffer.byteLength(value, "utf8");
}

/**
 * The stable, sorted-key JSON canonicalization used for the fingerprint.
 *
 * Object keys are SORTED (so key-insertion order does not change the
 * fingerprint) while ARRAY order is PRESERVED (message and tool order is
 * semantically significant to the provider).
 */
export function canonicalizeForFingerprint(value: unknown): string {
	if (value === null || typeof value !== "object") {
		return JSON.stringify(value ?? null) ?? "null";
	}
	if (Array.isArray(value)) {
		return `[${value.map(canonicalizeForFingerprint).join(",")}]`;
	}
	const record = value as Record<string, unknown>;
	const parts = Object.keys(record)
		.sort()
		.map(
			(key) =>
				`${JSON.stringify(key)}:${canonicalizeForFingerprint(record[key])}`,
		);
	return `{${parts.join(",")}}`;
}

/**
 * One content part's structural fingerprint.
 *
 * Carries the part TYPE (so a text part and a tool-result part are never
 * conflated) and the part's byte length and keyed fingerprint.
 */
export interface PrefixForensicsPartFingerprint {
	readonly type: string;
	readonly bytes: number;
	readonly fingerprint: string;
}

/**
 * One message's structural fingerprint.
 *
 * `role` is authoritative when the producer knows it. `parts` is the ordered
 * list of content-part fingerprints.
 */
export interface PrefixForensicsMessageFingerprint {
	readonly role: string;
	readonly bytes: number;
	readonly fingerprint: string;
	readonly parts: readonly PrefixForensicsPartFingerprint[];
}

/**
 * The structural inventory of ONE request representation.
 *
 * This is the whole observation: no content, only shape and keyed
 * identities.
 */
export interface PrefixForensicsRepresentation {
	readonly representation: string;
	readonly representationVersion: number;
	readonly producer: string;
	/** The ordered message count. */
	readonly messageCount: number;
	/** The ordered per-message fingerprints. */
	readonly messages: readonly PrefixForensicsMessageFingerprint[];
	/** The system / developer / instructions fingerprint, when present. */
	readonly systemFingerprint?: string;
	readonly systemBytes?: number;
	/** The ordered tool-definition fingerprints, when present. */
	readonly toolFingerprints?: readonly {
		readonly name: string;
		readonly fingerprint: string;
	}[];
	/** The request-level body fingerprint, when the producer can compute one. */
	readonly bodyFingerprint?: string;
	readonly bodyBytes?: number;
	/** Whether the observation is COMPLETE for this representation. */
	readonly complete: boolean;
	/** Why the observation is incomplete, when it is. */
	readonly incompleteReason?: string;
}

/**
 * Extract the ordered content parts of an unknown message-shaped value.
 *
 * The AI SDK prompt uses `{role, content}` where `content` is a string or a
 * part array. The runtime projection uses `{role, content: ContentBlock[]}`.
 * Both are handled here so ONE inventory function serves both boundaries.
 */
function extractParts(message: unknown): { type: string; text: string }[] {
	const record =
		message && typeof message === "object"
			? (message as Record<string, unknown>)
			: {};
	const content = record.content;
	if (typeof content === "string") {
		return [{ type: "text", text: content }];
	}
	if (!Array.isArray(content)) {
		return [];
	}
	const parts: { type: string; text: string }[] = [];
	for (const part of content) {
		if (!part || typeof part !== "object") {
			parts.push({ type: "unknown", text: "" });
			continue;
		}
		const partRecord = part as Record<string, unknown>;
		const type =
			typeof partRecord.type === "string" ? partRecord.type : "unknown";
		// The part's TEXT is never persisted — only its length and keyed
		// fingerprint. The serialized form of the part is what is
		// fingerprinted, so a tool-call's input and a tool-result's output
		// are covered too.
		const serialized =
			typeof partRecord.text === "string"
				? partRecord.text
				: typeof partRecord.output === "string"
					? partRecord.output
					: canonicalizeForFingerprint(part);
		parts.push({ type, text: serialized });
	}
	return parts;
}

/**
 * Compute the structural inventory of a request representation.
 *
 * @param representation The representation identifier.
 * @param messages The ordered messages.
 * @param options The system prompt and tool inventory, when the producer has
 * them.
 * @param options.key The cohort key for the keyed fingerprints.
 */
export function computeRepresentationFingerprint(
	representation: string,
	messages: unknown,
	options: {
		key: string;
		system?: unknown;
		tools?: unknown;
		body?: unknown;
	},
): PrefixForensicsRepresentation {
	const messageFingerprints: PrefixForensicsMessageFingerprint[] = [];
	let messageCount = 0;
	// ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION01: the
	// COMPLETENESS contract.
	//
	// A representation whose message list could not be determined is NOT a
	// complete zero-message representation — it is an INCOMPLETE observation.
	// The pre-correction implementation always returned `complete: true`,
	// so an unparseable wire body was recorded as a complete, empty request:
	// a fabricated structural claim that an analyzer could then compare as
	// "equal" against any other empty request.
	//
	// An EMPTY but PRESENT message array (`[]`) IS complete: a genuinely
	// empty request is a real observation.
	let messagesAvailable = true;
	let incompleteReason: string | undefined;
	if (Array.isArray(messages)) {
		messageCount = messages.length;
		for (const message of messages) {
			const record =
				message && typeof message === "object"
					? (message as Record<string, unknown>)
					: {};
			const role = typeof record.role === "string" ? record.role : "unknown";
			const messageParts = extractParts(message);
			const perPart = messageParts.map((part) => ({
				type: part.type,
				bytes: utf8ByteLength(part.text),
				fingerprint: keyedFingerprintHex(options.key, part.text),
			}));
			const serialized = canonicalizeForFingerprint(message);
			messageFingerprints.push({
				role,
				bytes: utf8ByteLength(serialized),
				fingerprint: keyedFingerprintHex(options.key, serialized),
				parts: perPart,
			});
		}
	} else {
		messagesAvailable = false;
		incompleteReason =
			"the message list was absent or not an array; the representation " +
			"could not be observed as a complete request";
	}

	let systemFingerprint: string | undefined;
	let systemBytes: number | undefined;
	if (options.system !== undefined && options.system !== null) {
		const serialized =
			typeof options.system === "string"
				? options.system
				: canonicalizeForFingerprint(options.system);
		systemFingerprint = keyedFingerprintHex(options.key, serialized);
		systemBytes = utf8ByteLength(serialized);
	}

	let toolFingerprints: { name: string; fingerprint: string }[] | undefined;
	if (options.tools !== undefined && options.tools !== null) {
		const entries: { name: string; fingerprint: string }[] = [];
		if (Array.isArray(options.tools)) {
			for (const tool of options.tools) {
				const record =
					tool && typeof tool === "object"
						? (tool as Record<string, unknown>)
						: {};
				const name = typeof record.name === "string" ? record.name : "unknown";
				entries.push({
					name,
					fingerprint: keyedFingerprintHex(
						options.key,
						canonicalizeForFingerprint(tool),
					),
				});
			}
		} else if (typeof options.tools === "object") {
			for (const [name, tool] of Object.entries(
				options.tools as Record<string, unknown>,
			)) {
				entries.push({
					name,
					fingerprint: keyedFingerprintHex(
						options.key,
						canonicalizeForFingerprint(tool),
					),
				});
			}
		}
		toolFingerprints = entries;
	}

	let bodyFingerprint: string | undefined;
	let bodyBytes: number | undefined;
	if (options.body !== undefined && options.body !== null) {
		const serialized =
			typeof options.body === "string"
				? options.body
				: canonicalizeForFingerprint(options.body);
		bodyFingerprint = keyedFingerprintHex(options.key, serialized);
		bodyBytes = utf8ByteLength(serialized);
	}

	return {
		representation,
		representationVersion: PREFIX_FORENSICS_SCHEMA_VERSION,
		producer: PREFIX_FORENSICS_FINGERPRINT_PRODUCER,
		messageCount,
		messages: messageFingerprints,
		...(systemFingerprint !== undefined
			? { systemFingerprint, systemBytes }
			: {}),
		...(toolFingerprints !== undefined ? { toolFingerprints } : {}),
		...(bodyFingerprint !== undefined ? { bodyFingerprint, bodyBytes } : {}),
		complete: messagesAvailable,
		...(incompleteReason !== undefined ? { incompleteReason } : {}),
	};
}

/**
 * The forensic capture record.
 *
 * This is what is written to disk (OUTSIDE Git, under a uniquely named
 * private directory with restrictive permissions). It carries:
 *
 *   - `schemaVersion` / `producer` — the record's own identity;
 *   - `cohortId` — the comparison cohort (NOT the key);
 *   - `sessionId` / `preparationRequestId` / `providerAttemptId` /
 *     `iteration` — the correlation identities, exactly as the existing
 *     trace identity defines them;
 *   - `source` — where the observation came from (the seam);
 *   - `representation` — the structural inventory;
 *   - `recordSha256` — the record's own content digest, so a consumer can
 *     detect tampering or truncation.
 *
 * It carries NO raw prompt, NO message body, NO tool command, NO tool
 * result, NO credential, NO raw tool schema and NO private project path.
 */
export interface PrefixForensicsCaptureRecord {
	readonly schemaVersion: number;
	readonly producer: string;
	readonly capturedAt: string;
	/** The comparison cohort. The KEY is never recorded. */
	readonly cohortId: string;
	readonly sessionId?: string;
	readonly preparationRequestId?: string;
	readonly providerAttemptId?: string;
	readonly iteration?: number;
	readonly providerId?: string;
	readonly modelId?: string;
	/** The seam that produced the observation. */
	readonly source: string;
	readonly representation: PrefixForensicsRepresentation;
	/** The record's own content digest (over the record WITHOUT this field). */
	readonly recordSha256: string;
}

/**
 * The capture record's content digest.
 *
 * The digest is computed over the canonicalized record WITHOUT the digest
 * field itself, so it is verifiable by a consumer that re-serializes the
 * record.
 */
export function computeCaptureRecordSha256(
	record: Omit<PrefixForensicsCaptureRecord, "recordSha256">,
): string {
	return createHash("sha256")
		.update(canonicalizeForFingerprint(record), "utf8")
		.digest("hex");
}

/**
 * A per-process cohort key.
 *
 * The key is generated ONCE per process (or per capture session), used for
 * every keyed fingerprint the process emits, and NEVER written to disk. A
 * consumer that needs to compare two requests compares them within the SAME
 * cohort, which is exactly the comparison the ACT requires.
 *
 * When the operator supplies `CLINEMM_PREFIX_FORENSICS_KEY`, that key is used
 * instead, so a comparison cohort can span more than one process. The
 * operator-supplied key is still never written to disk by this module.
 */
let cohortKey: string | undefined;
let cohortId: string | undefined;

/**
 * The cohort key for this process.
 *
 * The key is read from `CLINEMM_PREFIX_FORENSICS_KEY` when present, and
 * otherwise generated from the process's crypto entropy. It is never
 * persisted.
 */
export function getPrefixForensicsCohortKey(): string {
	if (cohortKey !== undefined) {
		return cohortKey;
	}
	const supplied = process.env.CLINEMM_PREFIX_FORENSICS_KEY?.trim();
	if (supplied) {
		cohortKey = supplied;
	} else {
		cohortKey = randomBytes(32).toString("hex");
	}
	return cohortKey;
}

/**
 * The cohort id for this process.
 *
 * A short, NON-SECRET digest of the cohort key. It identifies the cohort
 * without disclosing the key: an observer who learns the cohort id cannot
 * recompute any fingerprint from it.
 */
export function getPrefixForensicsCohortId(): string {
	if (cohortId !== undefined) {
		return cohortId;
	}
	cohortId = createHash("sha256")
		.update(getPrefixForensicsCohortKey(), "utf8")
		.digest("hex")
		.slice(0, 16);
	return cohortId;
}

/** Reset the cohort key. Test-only; never called by production code. */
export function _resetPrefixForensicsCohortForTests(): void {
	cohortKey = undefined;
	cohortId = undefined;
}
