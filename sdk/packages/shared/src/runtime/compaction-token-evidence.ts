/**
 * ACT-CLINEMM-COMPACTION-TOKEN-EVIDENCE-CAPTURE01.
 *
 * Shared primitives for the compaction-token evidence boundary.
 *
 * ## Why this module exists
 *
 * The measurement this ACT enables needs THREE distinguishable things:
 *
 *   1. a CORRELATION key that joins a compaction DECISION to the request it
 *      measured, to the provider DISPATCH of that request, and to the
 *      provider-reported USAGE;
 *   2. a deterministic FINGERPRINT of the FINAL provider-visible projection,
 *      so two dispatches can be proven to carry the same content (or proven
 *      NOT to);
 *   3. an explicitly opt-in, PRIVATELY stored capture of the exact
 *      pre-compaction CANDIDATE, so it can be independently tokenized later
 *      without re-running the model.
 *
 * The correlation key lives in the trace identity (see
 * `ModelBehaviorTraceIdentity.preparationRequestId`). This module owns the
 * fingerprint representation and the candidate-capture contract.
 *
 * ## Representation contract
 *
 * A fingerprint is only meaningful together with the EXACT representation it
 * was computed over and the producer that computed it. This module therefore
 * emits the fingerprint together with:
 *
 *   - `representation` — a stable identifier of the serialization contract;
 *   - `representationVersion` — the version of that contract;
 *   - `producer` — the component that produced the value.
 *
 * A CONTENT fingerprint is NOT automatically a WIRE-request fingerprint: the
 * provider adapter may still transform the request after this point. Nothing
 * here claims byte-identical provider-wire content.
 */

/**
 * The representation identifier for the final provider-visible projection.
 *
 * The projection is the agent runtime's `AgentModelRequest` as it stands at
 * the dispatch seam: system prompt, messages (in order), tools (in order),
 * and the model options that affect formatting.
 *
 * It is a CLIENT-SIDE representation. The provider adapter may still apply
 * its own transformation (prompt templating, tool-schema serialization,
 * reasoning controls) after this point.
 */
export const COMPACTION_CANDIDATE_PROJECTION_REPRESENTATION =
	"AGENT_MODEL_REQUEST_FINAL_PROJECTION" as const;

/**
 * The representation identifier for the exact pre-compaction CLIENT DECISION
 * CANDIDATE.
 *
 * This is the candidate as the CLIENT prepared it — system prompt, API
 * messages, tools and the formatting-relevant request options — captured at
 * the compaction decision boundary BEFORE any compaction ran.
 *
 * It is NOT `SERVER_FORMATTED_PROMPT_EXACT`: the provider still applies its
 * own chat template and tokenization to it.
 */
export const COMPACTION_CANDIDATE_CLIENT_REPRESENTATION =
	"CLIENT_DECISION_CANDIDATE_EXACT" as const;

/**
 * The representation version of the client-decision-candidate serialization.
 *
 * Bump this whenever the serialized shape changes in a way that would make
 * two captures with the same fingerprint describe DIFFERENT content.
 */
export const COMPACTION_CANDIDATE_CLIENT_REPRESENTATION_VERSION = 1 as const;

/**
 * The producer identifier for fingerprints computed by this module.
 */
export const COMPACTION_CANDIDATE_FINGERPRINT_PRODUCER =
	"@cline/shared/runtime/compaction-token-evidence" as const;

/**
 * The stable, sorted-key JSON canonicalization used for the fingerprint.
 *
 * Object keys are sorted so key-insertion order does not change the
 * fingerprint; array order is PRESERVED because message and tool order is
 * semantically significant to the provider.
 */
export function canonicalizeCompactionEvidenceValue(value: unknown): string {
	if (value === null || typeof value !== "object") {
		return JSON.stringify(value ?? null) ?? "null";
	}
	if (Array.isArray(value)) {
		return `[${value.map(canonicalizeCompactionEvidenceValue).join(",")}]`;
	}
	const record = value as Record<string, unknown>;
	const parts = Object.keys(record)
		.sort()
		.map(
			(key) =>
				`${JSON.stringify(key)}:${canonicalizeCompactionEvidenceValue(record[key])}`,
		);
	return `{${parts.join(",")}}`;
}

/**
 * A SYNCHRONOUS, pure-JavaScript SHA-256.
 *
 * ## Why this is not `crypto.subtle`
 *
 * The fingerprint is computed on the model-request preparation path, which
 * the runtime drives inside an `async` function that the test suite drives
 * with FAKE TIMERS. A WebCrypto `subtle.digest()` is a real asynchronous
 * operation: awaiting it introduces a suspension point that a fake-timer
 * `runAllTimersAsync()` cannot advance, which would hang the production
 * retry-backoff tests.
 *
 * The fingerprint must therefore be SYNCHRONOUS. A synchronous digest keeps
 * the preparation path free of new suspension points, so the request, the
 * tool inventory, the token budget and the provider dispatch are all
 * bit-for-bit identical to the un-instrumented path.
 *
 * It is a compact, dependency-free implementation of FIPS 180-4 SHA-256.
 * It is NOT keyed: the fingerprint is a content identity, not a privacy
 * boundary.
 */

/** The SHA-256 round constants, as a plain number array (readable). */
const SHA256_ROUND_CONSTANTS: number[] = [
	0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
	0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
	0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
	0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
	0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
	0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
	0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
	0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
	0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
	0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
	0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function rotr(value: number, bits: number): number {
	return (value >>> bits) | (value << (32 - bits));
}

/**
 * The SHA-256 digest of a UTF-8 string, as lowercase hex.
 *
 * Synchronous and dependency-free, so it can be used on the model-request
 * preparation path without introducing a suspension point.
 */
export function sha256HexSync(input: string): string {
	const bytes = new TextEncoder().encode(input);
	const bitLength = bytes.length * 8;
	// The message is padded: a 0x80 byte, then zeros, then the 64-bit
	// big-endian length.
	// The message needs a 0x80 byte plus 8 length bytes on top of its
	// content, rounded UP to a whole number of 64-byte blocks.
	const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
	const padded = new Uint8Array(paddedLength);
	padded.set(bytes);
	padded[bytes.length] = 0x80;
	// The length is written as a 64-bit big-endian integer. JavaScript
	// numbers hold the low 53 bits exactly, and the high 32 bits are
	// written separately.
	const view = new DataView(padded.buffer);
	view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
	view.setUint32(paddedLength - 4, bitLength >>> 0);

	const h = new Uint32Array([
		0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
		0x1f83d9ab, 0x5be0cd19,
	]);
	const w = new Uint32Array(64);

	for (let offset = 0; offset < paddedLength; offset += 64) {
		for (let i = 0; i < 16; i++) {
			w[i] = view.getUint32(offset + i * 4);
		}
		for (let i = 16; i < 64; i++) {
			const s0 =
				rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
			const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
			w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
		}
		let [a, b, c, d, e, f, g, hh] = [
			h[0]!,
			h[1]!,
			h[2]!,
			h[3]!,
			h[4]!,
			h[5]!,
			h[6]!,
			h[7]!,
		];
		for (let i = 0; i < 64; i++) {
			const S1 = rotr(e!, 6) ^ rotr(e!, 11) ^ rotr(e!, 25);
			const ch = (e! & f!) ^ (~e! & g!);
			const temp1 = (hh! + S1 + ch + SHA256_ROUND_CONSTANTS[i]! + w[i]!) >>> 0;
			const S0 = rotr(a!, 2) ^ rotr(a!, 13) ^ rotr(a!, 22);
			const maj = (a! & b!) ^ (a! & c!) ^ (b! & c!);
			const temp2 = (S0 + maj) >>> 0;
			hh = g!;
			g = f!;
			f = e!;
			e = (d! + temp1) >>> 0;
			d = c!;
			c = b!;
			b = a!;
			a = (temp1 + temp2) >>> 0;
		}
		h[0] = (h[0]! + a!) >>> 0;
		h[1] = (h[1]! + b!) >>> 0;
		h[2] = (h[2]! + c!) >>> 0;
		h[3] = (h[3]! + d!) >>> 0;
		h[4] = (h[4]! + e!) >>> 0;
		h[5] = (h[5]! + f!) >>> 0;
		h[6] = (h[6]! + g!) >>> 0;
		h[7] = (h[7]! + hh!) >>> 0;
	}

	let hex = "";
	for (const value of h) {
		hex += value.toString(16).padStart(8, "0");
	}
	return hex;
}

/**
 * The fingerprint of a provider-visible projection.
 *
 * The returned object carries the fingerprint AND the provenance needed to
 * interpret it. A bare hex string would let a consumer forget which
 * representation it was comparing against.
 */
export interface CompactionEvidenceFingerprint {
	/** Lowercase SHA-256 hex of the canonicalized projection. */
	readonly fingerprint: string;
	/** The representation identifier. */
	readonly representation: string;
	/** The representation contract version. */
	readonly representationVersion: number;
	/** The component that produced the fingerprint. */
	readonly producer: string;
}

/**
 * Compute the deterministic fingerprint of the FINAL provider-visible
 * projection.
 *
 * The projection MUST be the request as it stands at the dispatch seam —
 * after compaction, after every `beforeModel` transform, and after the
 * budget enforcement. A `beforeModel` hook that mutates the messages or the
 * tool inventory therefore changes the fingerprint, which is exactly the
 * property that makes "false equality" detectable.
 */
export function computeFinalProjectionFingerprint(
	projection: unknown,
): CompactionEvidenceFingerprint {
	const canonical = canonicalizeCompactionEvidenceValue(projection);
	return {
		fingerprint: sha256HexSync(canonical),
		representation: COMPACTION_CANDIDATE_PROJECTION_REPRESENTATION,
		representationVersion: COMPACTION_CANDIDATE_CLIENT_REPRESENTATION_VERSION,
		producer: COMPACTION_CANDIDATE_FINGERPRINT_PRODUCER,
	};
}

/**
 * Compute the deterministic fingerprint of an exact pre-compaction client
 * decision candidate.
 *
 * The candidate is captured at the compaction decision boundary BEFORE any
 * compaction ran, so the fingerprint identifies the request that was
 * MEASURED by the decision — the one that would have been submitted had the
 * decision not fired.
 */
export function computeCandidateContentFingerprint(
	candidate: unknown,
): CompactionEvidenceFingerprint {
	const canonical = canonicalizeCompactionEvidenceValue(candidate);
	return {
		fingerprint: sha256HexSync(canonical),
		representation: COMPACTION_CANDIDATE_CLIENT_REPRESENTATION,
		representationVersion: COMPACTION_CANDIDATE_CLIENT_REPRESENTATION_VERSION,
		producer: COMPACTION_CANDIDATE_FINGERPRINT_PRODUCER,
	};
}
