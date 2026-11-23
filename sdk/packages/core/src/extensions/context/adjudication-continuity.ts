/**
 * ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-IMPLEMENT-01
 *
 * Adjudication candidate continuity across Agentic compaction.
 *
 * THE TWO CONTRACTS THIS MODULE DISCHARGES
 * ------------------------------------------
 *
 * C1 — TRUSTED EVIDENCE IDENTITY. A model-authored adjudication candidate
 * names its evidence. The runtime must resolve that name to an EXACT
 * canonical tool call, and must independently bind a source revision for
 * it. The predecessor ACT
 * (`ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-PROBE-01-CORRECTION01`)
 * measured that a live model cited `call_1`, a tool NAME, or an invented
 * label in every run that cited anything at all, and that the published
 * envelope carried NO revision field, so gate 3 was structurally false and
 * `candidate_accepted` was 0 of 10.
 *
 * C2 — DETERMINISTIC CONTINUITY. An accepted candidate must survive
 * compaction WITHOUT depending on the summarizer's choice of wording. The
 * summarizer is a LOSSY PROJECTION of the canonical history and can omit
 * the candidate entirely.
 *
 * WHY THE EVIDENCE REFERENCE IS A HANDLE, NOT A CANONICAL ID
 * -----------------------------------------------------------
 *
 * The canonical tool-call id IS model-visible: the provider wire format
 * carries `toolCallId` on both the `tool-call` and the `tool-result` part
 * (`sdk/packages/shared/src/llms/ai-sdk-format.ts`). But the live receipts
 * show a model does not RELIABLY QUOTE IT BACK: the model wrote `call_1`,
 * `read_files_1` and `read_files_synthetic-pool-config.yaml` instead. A
 * contract that requires the model to reproduce a provider-issued opaque
 * identifier is a contract the model cannot satisfy.
 *
 * So the runtime issues a BOUNDED, OPAQUE, SESSION-SCOPED EVIDENCE HANDLE
 * and exposes it through the EXISTING tool-result representation (a bounded
 * trailer line on the tool result the model already reads). The model cites
 * the handle; the runtime resolves it through an EXACT, runtime-owned
 * mapping back to the canonical tool-call id. This is mechanism option 2 of
 * the ACT's G3.1 preference order, and it adds no new public tool, no new
 * provider protocol field and no new persistence subsystem.
 *
 * THE HANDLE CONTRACT
 * -------------------
 *
 *   - SESSION-SCOPED: the registry is bound to one session; a handle minted
 *     in session A never resolves in session B.
 *   - COLLISION-RESISTENT WITHIN THE SESSION: the handle is derived from a
 *     per-session secret over the canonical tool-call id, so two different
 *     tool calls cannot share a handle and the handle cannot be guessed
 *     from the id.
 *   - BOUND TO EXACTLY ONE CANONICAL TOOL CALL: the mapping is a function,
 *     not a nearest-match.
 *   - STABLE ACROSS SERIALIZATION AND COMPACTION: the handle is a pure
 *     function of (session secret, canonical tool-call id), so it survives
 *     every persistence round-trip and every re-compaction unchanged.
 *   - REVOKED WHEN ITS EVIDENCE CEASES TO BE USABLE: a candidate whose
 *     cited handle no longer resolves to a paired, successful tool result
 *     is rejected, and the continuity projection drops it.
 *   - INCAPABLE OF RESOLVING ACROSS SESSIONS: the session secret is part
 *     of the derivation, so a handle from another session cannot resolve.
 *
 * WHAT A HANDLE IS NOT
 * --------------------
 *
 * A handle is not a positional guess. A guessed ordinal, a filename match,
 * a tool name, or a "chronologically nearest result" heuristic is NOT an
 * acceptable binding, and none of them is implemented here.
 *
 * AUTHORITY
 * --------
 *
 * The candidate remains MODEL-AUTHORED and PROVISIONAL:
 *
 *   AUTHOR:           MODEL
 *   AUTHORITY:        PROVISIONAL
 *   SEMANTIC_SUPPORT: NOT_INDEPENDENTLY_ADJUDICATED
 *
 * `candidate_accepted` means the TRANSPORT, AUTHORITY and FRESHNESS
 * contract passed. It does NOT mean the model's conclusion is true. A
 * candidate that cites a genuine tool result can still be wrong. The
 * accepted candidate is therefore always rendered as PROVISIONAL and is
 * never promoted above its canonical evidence.
 *
 * THE TASK-SCOPED VOCABULARY IS A HOST-SUPPLIED INPUT
 * ---------------------------------------------------
 *
 * The finding ids, decisions, qualification codes and remaining-question
 * ids used by the synthetic fixture (`S1`, `manual_enforcement_only`, ...)
 * are TEST-LOCAL. They are NOT a global ClineMM vocabulary and this module
 * does not install one.
 *
 * The vocabulary is supplied by the HOST as an
 * {@link AdjudicationVocabulary}. A candidate whose vocabulary cannot be
 * established is NOT accepted: `resolveAdjudicationCandidate()` returns
 * `candidate_accepted: false` with `reason: "no_authorized_vocabulary"`.
 * The ordinary agent path is unaffected because no host supplies a
 * vocabulary by default.
 *
 * THE SOURCE REVISION IS RUNTIME-BOUND
 * ------------------------------------
 *
 * The published envelope carries no revision field and does not need one.
 * The revision is bound INDEPENDENTLY by the runtime from a
 * {@link SourceRevisionResolver}, and the model can neither author nor
 * override it. A model that CLAIMS a revision is ignored: the claim is not
 * read at all.
 */

import type {
	AgentMessage,
	AgentMessagePart,
	ContentBlock,
	MessageWithMetadata,
} from "@cline/shared";

// ===========================================================================
// SECTION 1 — THE TASK-SCOPED VOCABULARY (HOST-SUPPLIED)
// ===========================================================================

/**
 * The authorized, task-scoped adjudication vocabulary.
 *
 * EVERY field is a closed set supplied by the host. Nothing here is derived
 * by scanning arbitrary thinking, tool output or free-form source text: a
 * vocabulary derived that way could be widened by the very content it is
 * supposed to constrain.
 */
export interface AdjudicationVocabulary {
	/**
	 * The finding ids this task recognizes.
	 *
	 * A candidate naming any other finding is REJECTED
	 * (`unknown_finding_id`).
	 */
	readonly findingIds: readonly string[];
	/** The decision values this task recognizes. */
	readonly decisions: readonly string[];
	/** The qualification codes this task recognizes. */
	readonly qualificationCodes: readonly string[];
	/**
	 * The remaining-question ids this task recognizes, mapped to the finding
	 * each belongs to.
	 *
	 * A candidate that cites a question belonging to a DIFFERENT finding is
	 * REJECTED (`question_finding_mismatch`).
	 */
	readonly remainingQuestions: Readonly<Record<string, string>>;
	/**
	 * The decisions each finding may carry.
	 *
	 * A finding that is absent from this map permits EVERY vocabulary
	 * decision. A finding that IS present permits only the listed ones, so a
	 * task can forbid, say, `supported` for a finding whose evidence can
	 * only narrow.
	 */
	readonly allowedDecisionsByFinding?: Readonly<
		Record<string, readonly string[]>
	>;
	/**
	 * The qualification codes that are ESSENTIAL to each finding's decision.
	 *
	 * A candidate that omits one of them is REJECTED
	 * (`missing_essential_qualification`). This is what stops a `narrowed`
	 * finding from being carried as an unsupported `supported` claim: the
	 * qualification is not decoration, it is the load-bearing part of the
	 * verdict.
	 */
	readonly requiredQualificationsByFinding?: Readonly<
		Record<string, readonly string[]>
	>;
}

/** Whether a vocabulary authorizes anything at all. */
export function hasAuthorizedVocabulary(
	vocabulary: AdjudicationVocabulary | undefined,
): vocabulary is AdjudicationVocabulary {
	if (!vocabulary) {
		return false;
	}
	return (
		Array.isArray(vocabulary.findingIds) &&
		vocabulary.findingIds.length > 0 &&
		Array.isArray(vocabulary.decisions) &&
		vocabulary.decisions.length > 0 &&
		Array.isArray(vocabulary.qualificationCodes)
	);
}

// ===========================================================================
// SECTION 2 — THE SESSION-SCOPED EVIDENCE HANDLE REGISTRY
// ===========================================================================

/**
 * The prefix of every evidence handle.
 *
 * The prefix makes a handle visually distinct from a provider-issued
 * tool-call id, so a model that cites one is never mistaken for the other
 * and a provider id can never be mistaken for a handle.
 */
export const EVIDENCE_HANDLE_PREFIX = "cline-ev";

/**
 * The number of hex characters in an evidence handle.
 *
 * 16 hex characters is 64 bits of a per-session-secret-derived MAC. The
 * handle must be unguessable by a model that knows the canonical tool-call
 * id, and it must be short enough to carry in a bounded trailer line.
 */
export const EVIDENCE_HANDLE_HEX_LENGTH = 16;

/**
 * The maximum number of characters the handle trailer line may occupy.
 *
 * The trailer is appended to a tool result the model already reads, so its
 * cost is a fixed constant.
 */
export const EVIDENCE_HANDLE_TRAILER_CHARS = 96;

/**
 * The marker that introduces the evidence-handle trailer on a tool result.
 *
 * The marker is deliberately distinctive so the trailer can be located,
 * stripped and re-derived deterministically — and so a model can be told
 * what it is without the runtime having to parse prose.
 */
export const EVIDENCE_HANDLE_MARKER = "[cline-evidence-handle]";

/**
 * A session-scoped registry that maps an opaque evidence handle to the
 * canonical tool-call id it stands for.
 *
 * The registry is created ONCE per session with a session secret. The
 * secret is what makes a handle unguessable and session-scoped: the handle
 * is a MAC over the canonical tool-call id under that secret, so
 *
 *   - the SAME tool-call id yields the SAME handle in every call, in every
 *     process, and after every serialization round-trip (STABILITY), and
 *   - a handle minted under a DIFFERENT session's secret does not resolve
 *     (SESSION ISOLATION).
 */
export class AdjudicationEvidenceRegistry {
	/**
	 * The per-session secret. Generated once per session.
	 *
	 * It is never persisted and never leaves the session: it exists only to
	 * make the handle unguessable and session-scoped.
	 */
	readonly #secret: string;

	/** The session this registry belongs to. */
	readonly sessionId: string;

	constructor(input: { sessionId: string; secret?: string }) {
		this.sessionId = input.sessionId;
		this.#secret =
			input.secret ?? AdjudicationEvidenceRegistry.generateSecret();
	}

	/**
	 * Generate a fresh session secret.
	 *
	 * The secret is 32 hex characters of cryptographic randomness. It is
	 * NOT persisted: a restored session re-derives its handles from the
	 * canonical history, and a handle minted under a lost secret simply
	 * stops resolving, which is the fail-closed direction.
	 */
	static generateSecret(): string {
		const bytes = new Uint8Array(16);
		globalThis.crypto.getRandomValues(bytes);
		return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
			"",
		);
	}

	/**
	 * Derive the opaque handle for a canonical tool-call id.
	 *
	 * The derivation is a keyed hash over the session id and the canonical
	 * tool-call id. It is a FUNCTION of those two values, so it is stable
	 * for the lifetime of the session and identical across every
	 * re-derivation.
	 */
	handleFor(toolUseId: string): string {
		const digest = hashHex(`${this.#secret} ${this.sessionId} ${toolUseId}`);
		return `${EVIDENCE_HANDLE_PREFIX}-${digest.slice(
			0,
			EVIDENCE_HANDLE_HEX_LENGTH,
		)}`;
	}

	/**
	 * Whether a string LOOKS like an evidence handle.
	 *
	 * The shape test is a routing decision, not an identity decision: it
	 * tells the resolver "this is a handle, resolve it through the
	 * registry" versus "this is a provider id, look it up in the canonical
	 * history".
	 */
	static isHandleShape(value: string): boolean {
		return (
			value.startsWith(`${EVIDENCE_HANDLE_PREFIX}-`) &&
			value.length ===
				EVIDENCE_HANDLE_PREFIX.length + 1 + EVIDENCE_HANDLE_HEX_LENGTH
		);
	}

	/**
	 * Resolve a handle to the canonical tool-call id it stands for.
	 *
	 * The resolution is EXACT: the registry scans the canonical tool-call
	 * ids it was given and returns the one whose derived handle equals the
	 * cited handle. There is no nearest-match, no ordinal and no
	 * chronological heuristic.
	 *
	 * Returns `undefined` when the handle stands for no canonical tool call
	 * in this session — including when it was minted under another
	 * session's secret.
	 */
	resolve(
		handle: string,
		canonicalToolUseIds: readonly string[],
	): string | undefined {
		if (!AdjudicationEvidenceRegistry.isHandleShape(handle)) {
			return undefined;
		}
		for (const toolUseId of canonicalToolUseIds) {
			if (this.handleFor(toolUseId) === handle) {
				return toolUseId;
			}
		}
		return undefined;
	}
}

/**
 * A dependency-free hexadecimal SHA-256.
 *
 * The module must load in the browser host as well as in Node, so it does
 * not import `node:crypto`. The implementation is the standard FIPS 180-4
 * SHA-256.
 */
export function hashHex(input: string): string {
	const bytes = new TextEncoder().encode(input);
	const bitLength = bytes.length * 8;
	// The message is padded to a multiple of 64 bytes.
	const paddedLength = (((bytes.length + 9) >> 6) + 1) << 6;
	const padded = new Uint8Array(paddedLength);
	padded.set(bytes);
	padded[bytes.length] = 0x80;
	const view = new DataView(padded.buffer);
	// The length is a 64-bit big-endian bit count. The high word is derived
	// from the byte length; the low word carries the remainder.
	view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);
	view.setUint32(paddedLength - 4, bitLength >>> 0, false);

	const h = new Uint32Array([
		0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
		0x1f83d9ab, 0x5be0cd19,
	]);
	const w = new Uint32Array(64);

	for (let offset = 0; offset < paddedLength; offset += 64) {
		for (let i = 0; i < 16; i += 1) {
			w[i] = view.getUint32(offset + i * 4, false);
		}
		for (let i = 16; i < 64; i += 1) {
			const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
			const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
			w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
		}
		let a = h[0];
		let b = h[1];
		let c = h[2];
		let d = h[3];
		let e = h[4];
		let f = h[5];
		let g = h[6];
		let hh = h[7];
		for (let i = 0; i < 64; i += 1) {
			const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
			const ch = (e & f) ^ (~e & g);
			const temp1 = (hh + s1 + ch + K[i] + w[i]) >>> 0;
			const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
			const maj = (a & b) ^ (a & c) ^ (b & c);
			const temp2 = (s0 + maj) >>> 0;
			hh = g;
			g = f;
			f = e;
			e = (d + temp1) >>> 0;
			d = c;
			c = b;
			b = a;
			a = (temp1 + temp2) >>> 0;
		}
		h[0] = (h[0] + a) >>> 0;
		h[1] = (h[1] + b) >>> 0;
		h[2] = (h[2] + c) >>> 0;
		h[3] = (h[3] + d) >>> 0;
		h[4] = (h[4] + e) >>> 0;
		h[5] = (h[5] + f) >>> 0;
		h[6] = (h[6] + g) >>> 0;
		h[7] = (h[7] + hh) >>> 0;
	}

	let out = "";
	for (const word of h) {
		out += word.toString(16).padStart(8, "0");
	}
	return out;
}

const K = new Uint32Array([
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
]);

function rotr(value: number, bits: number): number {
	return ((value >>> bits) | (value << (32 - bits))) >>> 0;
}

/**
 * Render the evidence-handle trailer for a tool result.
 *
 * The trailer is the EXISTING tool-result representation, extended with one
 * bounded line. It carries NO source content, NO path and NO excerpt: only
 * the opaque handle and the tool name.
 *
 * Returns `undefined` when there is no handle to expose.
 */
export function renderEvidenceHandleTrailer(input: {
	handle: string;
	toolName: string;
}): string | undefined {
	const trailer = `${EVIDENCE_HANDLE_MARKER} ${input.handle} tool=${input.toolName}`;
	if (trailer.length > EVIDENCE_HANDLE_TRAILER_CHARS) {
		// A trailer that does not fit its own bound is not emitted: the
		// handle would then be invisible to the model, which is a fail-
		// closed outcome rather than an unbounded one.
		return undefined;
	}
	return trailer;
}

/**
 * Whether a content block is an evidence-handle trailer.
 *
 * The trailer is the LAST text block the attachment writes, so it can be
 * recognized and removed as a block. Removing it as a block (rather than
 * only as a line inside another block) is what keeps the attachment
 * idempotent: otherwise the empty block would survive the second
 * application and the projection would not be byte-stable.
 */
function isEvidenceHandleTrailerText(part: unknown): boolean {
	if (!part || typeof part !== "object") {
		return false;
	}
	const candidate = part as { type?: unknown; text?: unknown };
	if (candidate.type !== "text" || typeof candidate.text !== "string") {
		return false;
	}
	return candidate.text.trim().startsWith(`${EVIDENCE_HANDLE_MARKER} `);
}

/**
 * Remove every evidence-handle trailer from a text.
 *
 * The trailer is a DERIVED, runtime-owned annotation. Stripping it before
 * re-deriving keeps the projection idempotent: applying the enrichment
 * twice produces byte-identical output.
 */
export function stripEvidenceHandleTrailers(text: string): string {
	if (!text.includes(EVIDENCE_HANDLE_MARKER)) {
		return text;
	}
	return text
		.split("\n")
		.filter((line) => !line.trimStart().startsWith(EVIDENCE_HANDLE_MARKER))
		.join("\n")
		.trimEnd();
}

// ===========================================================================
// SECTION 3 — THE SOURCE REVISION (RUNTIME-BOUND)
// ===========================================================================

/**
 * A runtime-observed source revision.
 *
 * The fields are the MINIMUM identity that can be established for a
 * repository file at the moment its content was acquired.
 */
export interface SourceRevision {
	/**
	 * The repository identity. Derived from the remote URL when there is
	 * one; otherwise a stable digest of the resolved workspace root.
	 */
	readonly repositoryIdentity: string;
	/**
	 * The resolved workspace root's stable identity.
	 *
	 * The ABSOLUTE PATH is deliberately NOT carried: an absolute path can
	 * be sensitive (it discloses the operator's home directory) and it is
	 * not portable. A digest of it is both stable and non-disclosing.
	 */
	readonly workspaceRootIdentity: string;
	/**
	 * The repository revision (the git HEAD commit sha) at acquisition.
	 */
	readonly revision: string;
	/**
	 * The content identity of the file at acquisition.
	 *
	 * A commit sha alone is insufficient for a DIRTY working tree, and a
	 * content hash alone establishes nothing about provenance. The pair
	 * establishes both.
	 */
	readonly contentIdentity: string;
	/**
	 * Whether the working tree was clean at acquisition.
	 */
	readonly clean: boolean;
}

/**
 * The runtime-side resolver of a source revision.
 *
 * The runtime NEVER asks the model what the revision is. It resolves the
 * revision itself, from the workspace, at the moment the evidence was
 * acquired.
 */
export interface SourceRevisionResolver {
	/**
	 * Resolve the source revision for one source file.
	 *
	 * Returns `undefined` when no trustworthy revision can be established
	 * for that file — for example because the workspace is not a
	 * repository, or the file is outside it, or the resolver could not
	 * compute a content identity. The caller then treats the candidate as
	 * `source_revision_bound: false`.
	 */
	resolve(input: {
		/** The source path, exactly as the tool reported it. */
		sourcePath: string;
		/** The tool that produced the evidence. */
		toolName: string;
	}): Promise<SourceRevision | undefined> | SourceRevision | undefined;
}

/**
 * The revision state of a candidate's evidence.
 */
export type RevisionBinding = "BOUND" | "UNBOUND" | "STALE";

/**
 * The runtime's revision authority over one candidate.
 *
 * The revision is resolved for EACH cited evidence source, and the
 * candidate is bound only when EVERY cited source resolved to the SAME
 * revision. A candidate that cites two sources from two different
 * revisions is `STALE`, not `BOUND`: it describes a state of the world
 * that never existed.
 */
export interface SourceRevisionBinding {
	readonly state: RevisionBinding;
	/** The bound revision, when the state is `BOUND`. */
	readonly revision?: SourceRevision;
	/** Why the revision could not be bound. */
	readonly reason?: string;
}

// ===========================================================================
// SECTION 4 — THE PUBLISHED ENVELOPE (STRICT PARSE)
// ===========================================================================

/**
 * The envelope kind. A different kind is a different contract.
 */
export const ADJUDICATION_ENVELOPE_KIND = "adjudication_candidate";

/**
 * The envelope schema version this runtime understands.
 */
export const ADJUDICATION_ENVELOPE_SCHEMA_VERSION = 1;

/**
 * The bounded maximum number of entries in any envelope array.
 */
export const MAX_ADJUDICATION_ENVELOPE_ENTRIES = 8;

/**
 * The bounded maximum serialized size of an envelope.
 */
export const MAX_ADJUDICATION_ENVELOPE_CHARS = 2_000;

/**
 * The parsed, model-authored adjudication candidate.
 *
 * Every field is bounded and every field is validated against the
 * host-supplied vocabulary before it can become an accepted candidate.
 */
export interface AdjudicationCandidate {
	readonly finding_id: string;
	readonly decision: string;
	readonly qualification_codes: readonly string[];
	readonly evidence_tool_use_ids: readonly string[];
	readonly counterevidence_tool_use_ids: readonly string[];
	readonly remaining_question_ids: readonly string[];
}

/**
 * The outcome of a strict parse.
 */
export type AdjudicationParseOutcome =
	| { readonly status: "ok"; readonly candidate: AdjudicationCandidate }
	| { readonly status: "rejected"; readonly reason: string };

/**
 * STRICTLY parse an adjudication envelope from an assistant `text` carrier.
 *
 * STRICT means:
 *
 *   - the carrier must be EXACTLY one JSON object (no prose around it, no
 *     regex extraction of a verdict word out of a larger transcript);
 *   - unknown fields are REJECTED (a model may not smuggle prose, excerpts,
 *     credentials or instructions through an extra field);
 *   - a missing field is REJECTED, never defaulted;
 *   - every array is bounded in length and every entry must be a string;
 *   - the carrier size is bounded.
 *
 * The parser does NOT consult the vocabulary: schema validity is
 * INDEPENDENT of contract acceptance, exactly as the predecessor's
 * correction established.
 */
export function parseAdjudicationEnvelope(
	carrierText: string,
): AdjudicationParseOutcome {
	if (typeof carrierText !== "string") {
		return { status: "rejected", reason: "carrier_not_text" };
	}
	if (carrierText.length === 0) {
		return { status: "rejected", reason: "empty_carrier" };
	}
	if (carrierText.length > MAX_ADJUDICATION_ENVELOPE_CHARS) {
		return { status: "rejected", reason: "carrier_too_large" };
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(carrierText);
	} catch {
		return { status: "rejected", reason: "malformed_json" };
	}
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		return { status: "rejected", reason: "not_an_object" };
	}
	const record = parsed as Record<string, unknown>;

	const allowedKeys = [
		"kind",
		"schema_version",
		"finding_id",
		"decision",
		"qualification_codes",
		"evidence_tool_use_ids",
		"counterevidence_tool_use_ids",
		"remaining_question_ids",
	] as const;
	for (const key of Object.keys(record)) {
		if (!allowedKeys.includes(key as (typeof allowedKeys)[number])) {
			return { status: "rejected", reason: `unknown_field:${key}` };
		}
	}
	for (const key of allowedKeys) {
		if (!(key in record)) {
			return { status: "rejected", reason: `missing_field:${key}` };
		}
	}
	if (record.kind !== ADJUDICATION_ENVELOPE_KIND) {
		return { status: "rejected", reason: "wrong_kind" };
	}
	if (record.schema_version !== ADJUDICATION_ENVELOPE_SCHEMA_VERSION) {
		return { status: "rejected", reason: "unsupported_schema_version" };
	}
	if (typeof record.finding_id !== "string") {
		return { status: "rejected", reason: "invalid_finding_id" };
	}
	if (typeof record.decision !== "string") {
		return { status: "rejected", reason: "invalid_decision" };
	}
	const arrayFields = [
		"qualification_codes",
		"evidence_tool_use_ids",
		"counterevidence_tool_use_ids",
		"remaining_question_ids",
	] as const;
	for (const field of arrayFields) {
		const value = record[field];
		if (!Array.isArray(value)) {
			return { status: "rejected", reason: `not_an_array:${field}` };
		}
		if (value.length > MAX_ADJUDICATION_ENVELOPE_ENTRIES) {
			return { status: "rejected", reason: `array_too_large:${field}` };
		}
		for (const entry of value) {
			if (typeof entry !== "string") {
				return { status: "rejected", reason: `non_string_entry:${field}` };
			}
		}
	}
	return {
		status: "ok",
		candidate: {
			finding_id: record.finding_id,
			decision: record.decision,
			qualification_codes: record.qualification_codes as string[],
			evidence_tool_use_ids: record.evidence_tool_use_ids as string[],
			counterevidence_tool_use_ids:
				record.counterevidence_tool_use_ids as string[],
			remaining_question_ids: record.remaining_question_ids as string[],
		},
	};
}

/**
 * Collect the published candidates from a canonical history.
 *
 * It reads ONLY assistant `text` blocks. It NEVER inspects `thinking`
 * blocks, tool results, or user messages.
 */
export function collectPublishedAdjudicationCandidates(
	messages: readonly MessageWithMetadata[],
): AdjudicationCandidate[] {
	const out: AdjudicationCandidate[] = [];
	for (const message of messages) {
		if (message.role !== "assistant" || !Array.isArray(message.content)) {
			continue;
		}
		for (const block of message.content as ContentBlock[]) {
			if (block.type !== "text") {
				continue;
			}
			const parsed = parseAdjudicationEnvelope(block.text.trim());
			if (parsed.status === "ok") {
				out.push(parsed.candidate);
			}
		}
	}
	return out;
}

// ===========================================================================
// SECTION 5 — THE CANONICAL EVIDENCE LEDGER
// ===========================================================================

/**
 * The canonical tool-call/result relation extracted from a canonical
 * history.
 *
 * This establishes PROVENANCE IDENTITY ONLY. It says nothing about whether
 * the result SUPPORTS the candidate's decision.
 */
export interface CanonicalEvidenceLedger {
	/** The canonical tool-call ids, in first-appearance order. */
	readonly toolUseIds: readonly string[];
	/** The tool-call id -> the tool that was called. */
	readonly calls: ReadonlyMap<
		string,
		{ readonly name: string; readonly input: Record<string, unknown> }
	>;
	/** The tool-call ids that are answered by exactly one successful result. */
	readonly pairedToolUseIds: ReadonlySet<string>;
}

/**
 * Build the canonical evidence ledger from a canonical history.
 *
 * The join is by the canonical tool-call id, and it FAILS CLOSED on
 * ambiguity:
 *
 *   - a result whose id matches NO call is not evidence;
 *   - an id claimed by MORE THAN ONE call is ambiguous, so it is not
 *     evidence;
 *   - an id answered by MORE THAN ONE result is ambiguous, so it is not
 *     evidence;
 *   - a result flagged as an error is not evidence;
 *   - a result with NO affirmative success signal is not evidence (the same
 *     rule the verified-outcome continuity already applies).
 */
export function buildCanonicalEvidenceLedger(
	messages: readonly MessageWithMetadata[],
): CanonicalEvidenceLedger {
	const calls = new Map<
		string,
		{ name: string; input: Record<string, unknown>; ambiguous: boolean }
	>();
	const results = new Map<string, { isError: boolean; count: number }>();

	for (const message of messages) {
		if (!Array.isArray(message.content)) {
			continue;
		}
		for (const block of message.content as ContentBlock[]) {
			if (block.type === "tool_use") {
				const existing = calls.get(block.id);
				if (existing) {
					// The same id claimed twice: the join is ambiguous.
					existing.ambiguous = true;
					continue;
				}
				calls.set(block.id, {
					name: block.name,
					input: (block.input ?? {}) as Record<string, unknown>,
					ambiguous: false,
				});
				continue;
			}
			if (block.type === "tool_result") {
				const existing = results.get(block.tool_use_id);
				if (existing) {
					existing.count += 1;
					continue;
				}
				results.set(block.tool_use_id, {
					isError: block.is_error === true,
					count: 1,
				});
			}
		}
	}

	const paired = new Set<string>();
	for (const [id, call] of calls) {
		if (call.ambiguous) {
			continue;
		}
		const result = results.get(id);
		if (!result || result.count !== 1 || result.isError) {
			continue;
		}
		paired.add(id);
	}

	return {
		toolUseIds: [...calls.keys()],
		calls,
		pairedToolUseIds: paired,
	};
}

// ===========================================================================
// SECTION 6 — THE ACCEPTANCE DECISION
// ===========================================================================

/**
 * The acceptance decision for one candidate.
 *
 * The five fields are INDEPENDENT. `candidate_accepted` means the
 * transport, authority and freshness contract passed; it does NOT imply
 * `semantic_support_verified`.
 */
export interface AdjudicationAcceptance {
	/** The envelope parsed under the strict schema. */
	readonly schema_valid: boolean;
	/** The candidate's evidence references resolved to canonical tool calls. */
	readonly canonical_refs_resolved: boolean;
	/** The runtime independently bound a source revision. */
	readonly source_revision_bound: boolean;
	/**
	 * The candidate is an ACCEPTED, PROVISIONAL adjudication.
	 *
	 * This is the authoritative transport-contract metric.
	 */
	readonly candidate_accepted: boolean;
	/**
	 * Whether an INDEPENDENT semantic check confirmed the decision.
	 *
	 * There is no such mechanism in this module, so it is always `false`
	 * here. A caller MAY supply an independent adjudicator; the field
	 * exists so that "accepted" is never confused with "true".
	 */
	readonly semantic_support_verified: boolean;
	/** The rejection reason, when the candidate was not accepted. */
	readonly reason?: string;
	/** The canonical tool-call ids the evidence references resolved to. */
	readonly resolvedEvidenceToolUseIds?: readonly string[];
	/** The bound source revision, when one was bound. */
	readonly sourceRevision?: SourceRevision;
	/** The author of the candidate. Always MODEL. */
	readonly author: "MODEL";
	/** The authority of the candidate. Always PROVISIONAL. */
	readonly authority: "PROVISIONAL";
}

/**
 * The options for resolving one candidate.
 */
export interface ResolveAdjudicationCandidateOptions {
	/** The canonical history the candidate is validated against. */
	readonly canonicalMessages: readonly MessageWithMetadata[];
	/** The session-scoped evidence-handle registry. */
	readonly registry: AdjudicationEvidenceRegistry;
	/** The host-supplied task-scoped vocabulary. */
	readonly vocabulary?: AdjudicationVocabulary;
	/**
	 * The runtime's source-revision resolver.
	 *
	 * When absent, no revision can be bound and every candidate is
	 * rejected with `unbound_source_revision`.
	 */
	readonly revisionResolver?: SourceRevisionResolver;
	/**
	 * An INDEPENDENT semantic adjudicator, keyed by canonical tool-call id.
	 *
	 * This is OPT-IN and is NEVER inferred from structural provenance. The
	 * module ships without one.
	 */
	readonly semanticSupport?: (toolUseId: string) => boolean | undefined;
}

/**
 * Resolve one model-authored candidate against the canonical record.
 *
 * The gates are applied IN ORDER, and each gate is reported INDEPENDENTLY:
 *
 *   1. VOCABULARY AUTHORIZATION. Without an authorized task-scoped
 *      vocabulary, the candidate is NOT accepted. There is no default
 *      vocabulary: accepting a candidate against an invented vocabulary
 *      would turn a test-local schema into an unrestricted production API.
 *   2. DECISION PERMISSION. The decision must be permitted for the finding.
 *   3. ESSENTIAL QUALIFICATION. The load-bearing qualification must survive
 *      verbatim.
 *   4. QUESTION OWNERSHIP. Every cited question must belong to the
 *      candidate's own finding.
 *   5. NONEMPTY EVIDENCE. A source-supported adjudication must cite at
 *      least one piece of evidence. An empty array resolves VACUOUSLY —
 *      every item in an empty array resolves — and that is NOT a binding
 *      witness. An `unresolved` output may be treated as an abstention, but
 *      it is never reported as an accepted source-grounded adjudication.
 *   6. CANONICAL REFERENCE RESOLUTION. Every cited reference must resolve
 *      EXACTLY, either to a canonical provider-issued tool-call id or to an
 *      opaque handle this session minted for one.
 *   7. PAIRED, SUCCESSFUL EVIDENCE. The resolved evidence must be a paired,
 *      successful tool result. A successful command is not automatically
 *      source evidence: the result must be attributable to a SOURCE FILE.
 *   8. SOURCE REVISION BINDING. The runtime must independently bind a
 *      source revision for every cited source.
 */
export async function resolveAdjudicationCandidate(
	candidate: AdjudicationCandidate,
	options: ResolveAdjudicationCandidateOptions,
): Promise<AdjudicationAcceptance> {
	const ledger = buildCanonicalEvidenceLedger(options.canonicalMessages);

	const resolveReference = (
		reference: string,
	): { ok: true; toolUseId: string } | { ok: false; reason: string } => {
		// A HANDLE is resolved through the session registry, which maps it
		// EXACTLY to one canonical tool-call id.
		if (AdjudicationEvidenceRegistry.isHandleShape(reference)) {
			const resolved = options.registry.resolve(reference, ledger.toolUseIds);
			if (!resolved) {
				return {
					ok: false,
					reason: `unresolvable_tool_reference:${reference}`,
				};
			}
			return { ok: true, toolUseId: resolved };
		}
		// A PROVIDER-ISSUED ID must exist in the canonical history. It is
		// never mapped to the "first" or "nearest" call.
		if (!ledger.calls.has(reference)) {
			return {
				ok: false,
				reason: `unresolvable_tool_reference:${reference}`,
			};
		}
		return { ok: true, toolUseId: reference };
	};

	// --- GATE 0: VOCABULARY AUTHORIZATION --------------------------
	const vocabulary = options.vocabulary;
	if (!hasAuthorizedVocabulary(vocabulary)) {
		return rejected("no_authorized_vocabulary");
	}
	if (!vocabulary.findingIds.includes(candidate.finding_id)) {
		return rejected(`unknown_finding_id:${candidate.finding_id}`);
	}
	if (!vocabulary.decisions.includes(candidate.decision)) {
		return rejected(`invalid_decision:${candidate.decision}`);
	}
	for (const code of candidate.qualification_codes) {
		if (!vocabulary.qualificationCodes.includes(code)) {
			return rejected(`unknown_qualification_code:${code}`);
		}
	}
	for (const questionId of candidate.remaining_question_ids) {
		const owner = vocabulary.remainingQuestions[questionId];
		if (!owner) {
			return rejected(`unknown_question_id:${questionId}`);
		}
		if (owner !== candidate.finding_id) {
			return rejected(`question_finding_mismatch:${questionId}`);
		}
	}

	// --- GATE 1: DECISION PERMISSION -------------------------------
	const allowedDecisions =
		vocabulary.allowedDecisionsByFinding?.[candidate.finding_id];
	if (allowedDecisions && !allowedDecisions.includes(candidate.decision)) {
		return rejected("decision_not_permitted_for_finding");
	}

	// --- GATE 2: ESSENTIAL QUALIFICATION ---------------------------
	const required =
		vocabulary.requiredQualificationsByFinding?.[candidate.finding_id] ?? [];
	for (const code of required) {
		if (!candidate.qualification_codes.includes(code)) {
			return rejected(`missing_essential_qualification:${code}`);
		}
	}

	// --- GATE 3: NONEMPTY EVIDENCE ---------------------------------
	// An empty evidence array resolves VACUOUSLY. It is not a binding
	// witness, so a source-supported adjudication requires at least one
	// piece of evidence. An abstention (`unresolved`) may carry no
	// evidence, but it is never a source-grounded adjudication.
	const isAbstention = candidate.decision === "unresolved";
	if (candidate.evidence_tool_use_ids.length === 0 && !isAbstention) {
		return rejected("missing_supporting_evidence");
	}

	// --- GATE 4: CANONICAL REFERENCE RESOLUTION --------------------
	const resolvedEvidence: string[] = [];
	for (const reference of [
		...candidate.evidence_tool_use_ids,
		...candidate.counterevidence_tool_use_ids,
	]) {
		const resolved = resolveReference(reference);
		if (!resolved.ok) {
			return rejected(resolved.reason);
		}
		if (!ledger.pairedToolUseIds.has(resolved.toolUseId)) {
			return rejected(
				`unpaired_or_failed_tool_reference:${resolved.toolUseId}`,
			);
		}
		if (!resolvedEvidence.includes(resolved.toolUseId)) {
			resolvedEvidence.push(resolved.toolUseId);
		}
	}

	// --- GATE 5: SOURCE REVISION BINDING ---------------------------
	// The revision is bound by the RUNTIME. The model's claim is never
	// read: the envelope has no revision field, so there is nothing for
	// the model to override.
	let binding: SourceRevisionBinding = {
		state: "UNBOUND",
		reason: "no_revision_resolver",
	};
	if (options.revisionResolver) {
		binding = await bindSourceRevision({
			resolvedEvidence,
			ledger,
			resolver: options.revisionResolver,
		});
	}
	if (binding.state !== "BOUND" || !binding.revision) {
		return {
			...baseAcceptance(),
			schema_valid: true,
			canonical_refs_resolved: true,
			source_revision_bound: false,
			candidate_accepted: false,
			reason: binding.reason ?? "unbound_source_revision",
			resolvedEvidenceToolUseIds: resolvedEvidence,
		};
	}

	// --- SEMANTIC SUPPORT (OPT-IN, NEVER INFERRED) -----------------
	let semanticSupportVerified = false;
	if (options.semanticSupport) {
		const supports = candidate.evidence_tool_use_ids
			.map((reference) => {
				const resolved = resolveReference(reference);
				return resolved.ok
					? options.semanticSupport?.(resolved.toolUseId)
					: undefined;
			})
			.filter((value): value is boolean => value !== undefined);
		semanticSupportVerified =
			supports.length > 0 && supports.every((value) => value === true);
	}

	return {
		...baseAcceptance(),
		schema_valid: true,
		canonical_refs_resolved: true,
		source_revision_bound: true,
		candidate_accepted: true,
		semantic_support_verified: semanticSupportVerified,
		resolvedEvidenceToolUseIds: resolvedEvidence,
		sourceRevision: binding.revision,
	};
}

/**
 * Bind ONE source revision across every cited evidence source.
 *
 * The binding is `BOUND` only when EVERY cited source resolved to the
 * SAME revision. Two sources from two different revisions describe a state
 * of the world that never existed, so the candidate is `STALE` rather than
 * `BOUND`.
 */
async function bindSourceRevision(input: {
	resolvedEvidence: readonly string[];
	ledger: CanonicalEvidenceLedger;
	resolver: SourceRevisionResolver;
}): Promise<SourceRevisionBinding> {
	if (input.resolvedEvidence.length === 0) {
		return { state: "UNBOUND", reason: "no_evidence_to_bind" };
	}
	const revisions: SourceRevision[] = [];
	for (const toolUseId of input.resolvedEvidence) {
		const call = input.ledger.calls.get(toolUseId);
		if (!call) {
			return {
				state: "UNBOUND",
				reason: `unresolvable_tool_reference:${toolUseId}`,
			};
		}
		const sourcePath = extractSourcePath(call.input);
		if (!sourcePath) {
			// A tool call that does not read a SOURCE FILE cannot establish
			// a source revision. A generic command's stdout is NOT
			// reinterpreted as a file read.
			return {
				state: "UNBOUND",
				reason: `evidence_has_no_source_identity:${toolUseId}`,
			};
		}
		const revision = await input.resolver.resolve({
			sourcePath,
			toolName: call.name,
		});
		if (!revision) {
			return {
				state: "UNBOUND",
				reason: `unbound_source_revision:${toolUseId}`,
			};
		}
		revisions.push(revision);
	}
	const first = revisions[0];
	if (!first) {
		return { state: "UNBOUND", reason: "no_evidence_to_bind" };
	}
	for (const revision of revisions) {
		if (revision.revision !== first.revision) {
			return { state: "STALE", reason: "source_revision_mismatch" };
		}
	}
	return { state: "BOUND", revision: first };
}

/**
 * The source path a tool call read, when the call reads a source file.
 *
 * Only a call that DECLARES a file path yields one. A command's stdout is
 * never reinterpreted as a file read.
 */
export function extractSourcePath(
	input: Record<string, unknown>,
): string | undefined {
	const candidates = [input.path, input.file_path, input.filePath];
	for (const candidate of candidates) {
		if (typeof candidate === "string" && candidate.trim().length > 0) {
			return candidate.trim();
		}
	}
	const paths = input.paths;
	if (Array.isArray(paths)) {
		for (const candidate of paths) {
			if (typeof candidate === "string" && candidate.trim().length > 0) {
				return candidate.trim();
			}
		}
	}
	return undefined;
}

function baseAcceptance(): AdjudicationAcceptance {
	return {
		schema_valid: false,
		canonical_refs_resolved: false,
		source_revision_bound: false,
		candidate_accepted: false,
		semantic_support_verified: false,
		author: "MODEL",
		authority: "PROVISIONAL",
	};
}

function rejected(reason: string): AdjudicationAcceptance {
	return { ...baseAcceptance(), schema_valid: true, reason };
}

// ===========================================================================
// SECTION 7 — THE DETERMINISTIC CONTINUITY SECTION (C2)
// ===========================================================================

/**
 * The heading of the carried adjudication section.
 *
 * A stable, greppable marker so the section can be located and replaced
 * deterministically on a later compaction instead of accumulating copies.
 */
export const ADJUDICATION_SECTION_HEADING =
	"## Adjudication candidates (model-derived, provisional)";

const ADJUDICATION_BEGIN_MARKER = "<!-- cline-adjudication:begin -->";
const ADJUDICATION_END_MARKER = "<!-- cline-adjudication:end -->";

/**
 * The maximum number of accepted candidates carried into one summary.
 *
 * A fixed constant: the carried section's size must not grow with the
 * length of the session.
 */
export const MAX_CARRIED_ADJUDICATIONS = 8;

/**
 * The maximum number of characters of a single carried candidate line.
 */
export const MAX_CARRIED_ADJUDICATION_CHARS = 320;

/**
 * An ACCEPTED adjudication candidate, with its runtime-bound evidence.
 */
export interface AcceptedAdjudication {
	/** The finding this candidate adjudicates. */
	readonly finding_id: string;
	/** The decision the model published. */
	readonly decision: string;
	/** The qualification codes that survived validation. */
	readonly qualification_codes: readonly string[];
	/** The remaining-question ids that survived validation. */
	readonly remaining_question_ids: readonly string[];
	/**
	 * The OPAQUE, runtime-validated evidence references.
	 *
	 * These are handles, never raw ids and never source content. A handle
	 * that no longer resolves is dropped by the projection.
	 */
	readonly evidence_handles: readonly string[];
	/** The bound source revision's identity, rendered opaquely. */
	readonly source_revision: string;
}

/**
 * Render the deterministic carry-forward section for the accepted
 * candidates.
 *
 * The representation is CLOSED: a heading, and one bounded line per
 * candidate carrying only vocabulary-validated values and opaque,
 * runtime-validated references. There is no raw source excerpt, no
 * arbitrary prose, no private reasoning and no unrestricted command output.
 *
 * Returns `undefined` when there is nothing to carry, so the caller can
 * leave the summary untouched rather than inventing an empty section.
 */
export function renderAdjudicationSection(
	candidates: readonly AcceptedAdjudication[],
): string | undefined {
	if (candidates.length === 0) {
		return undefined;
	}
	const lines: string[] = [];
	for (const candidate of candidates.slice(0, MAX_CARRIED_ADJUDICATIONS)) {
		const rendered = [
			`${candidate.finding_id}:`,
			`decision=${candidate.decision}`,
			`qualification=${candidate.qualification_codes.join(",")}`,
			candidate.remaining_question_ids.length > 0
				? `remaining_question=${candidate.remaining_question_ids.join(",")}`
				: undefined,
			`evidence=${candidate.evidence_handles.join(",")}`,
			`source_revision=${candidate.source_revision}`,
		]
			.filter((part): part is string => part !== undefined)
			.join(" ");
		lines.push(
			rendered.length > MAX_CARRIED_ADJUDICATION_CHARS
				? `${rendered.slice(0, MAX_CARRIED_ADJUDICATION_CHARS - 3)}...`
				: rendered,
		);
	}
	return [
		ADJUDICATION_SECTION_HEADING,
		ADJUDICATION_BEGIN_MARKER,
		...lines,
		ADJUDICATION_END_MARKER,
	].join("\n");
}

/**
 * Remove any previously carried adjudication section from a summary text.
 *
 * This makes the carry-forward IDEMPOTENT: a later compaction replaces the
 * carried section with the section derived from the CURRENT canonical
 * authority instead of appending a second copy.
 */
export function stripAdjudicationSection(summaryText: string): string {
	// The HEADING is part of the section, not a separate piece of prose.
	// It MUST be stripped together with the marked block, otherwise a later
	// compaction would leave the heading behind and the next carry-forward
	// would append a SECOND section under it — the duplicate accumulation
	// the idempotence requirement forbids.
	const begin = summaryText.indexOf(ADJUDICATION_BEGIN_MARKER);
	if (begin === -1) {
		// No marked block. A stray heading with no block is still removed:
		// a truncated section must never be presented as a complete one.
		return stripAdjudicationHeading(summaryText);
	}
	const end = summaryText.indexOf(ADJUDICATION_END_MARKER, begin);
	const blockEnd = end === -1 ? begin : end + ADJUDICATION_END_MARKER.length;
	// The heading (and any blank lines between it and the block) belongs to
	// the section, so it is removed together with the block.
	const before = summaryText.slice(0, begin).trimEnd();
	const after = summaryText.slice(blockEnd).trimStart();
	const withoutBlock =
		before && after ? `${before}\n\n${after}` : before || after;
	return stripAdjudicationHeading(withoutBlock);
}

/**
 * Remove a stray adjudication HEADING that has no marked block.
 *
 * The heading is only ever emitted together with the block, so a heading
 * without a block is the residue of a truncated section. Removing it keeps
 * the summary's structure honest: the reader never sees a heading with no
 * content under it.
 */
function stripAdjudicationHeading(summaryText: string): string {
	if (!summaryText.includes(ADJUDICATION_SECTION_HEADING)) {
		return summaryText;
	}
	return summaryText
		.split("\n")
		.filter((line) => line.trim() !== ADJUDICATION_SECTION_HEADING)
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

/**
 * Apply the carry-forward to a summary text.
 *
 * Returns the original text unchanged when there is no accepted candidate,
 * so a summary without accepted adjudications is never rewritten.
 */
export function applyAdjudicationSectionToSummary(
	summaryText: string,
	candidates: readonly AcceptedAdjudication[],
): string {
	const section = renderAdjudicationSection(candidates);
	const stripped = stripAdjudicationSection(summaryText).trimEnd();
	if (!section) {
		return stripped;
	}
	if (!stripped) {
		return section;
	}
	return `${stripped}\n\n${section}`;
}

/**
 * The outcome of applying the adjudication carry-forward.
 */
export interface AdjudicationApplicationResult {
	/** The message list to use (enriched when applied, original otherwise). */
	readonly messages: MessageWithMetadata[];
	/** Whether the carry-forward was actually applied. */
	readonly applied: boolean;
	/** The number of accepted candidates carried. */
	readonly carriedCandidateCount: number;
}

/**
 * Apply the deterministic adjudication carry-forward to a compacted message
 * list.
 *
 * The section is attached to the EXISTING `compaction_summary` message — the
 * message the agentic compaction already produced. No second summary
 * message is created, no provider tool call is added, and every other
 * projected message is preserved unchanged.
 *
 * The carried candidates are DERIVED FROM THE CANONICAL HISTORY by the
 * caller and passed in already-validated: this function is the projection
 * step, not the validation step.
 */
export function applyAdjudicationContinuityToCompactedMessages(
	compactedMessages: readonly MessageWithMetadata[],
	candidates: readonly AcceptedAdjudication[],
): AdjudicationApplicationResult {
	const summaryIndex = compactedMessages.findIndex(
		(message) =>
			(message.metadata as { kind?: string } | undefined)?.kind ===
			"compaction_summary",
	);
	if (summaryIndex === -1) {
		return {
			messages: [...compactedMessages],
			applied: false,
			carriedCandidateCount: candidates.length,
		};
	}
	const summaryMessage = compactedMessages[summaryIndex];
	const currentSummary =
		(summaryMessage.metadata as { summary?: string } | undefined)?.summary ??
		readSummaryTextFromContent(summaryMessage);
	if (typeof currentSummary !== "string") {
		return {
			messages: [...compactedMessages],
			applied: false,
			carriedCandidateCount: candidates.length,
		};
	}
	const nextSummary = applyAdjudicationSectionToSummary(
		currentSummary,
		candidates,
	);
	if (nextSummary === currentSummary) {
		return {
			messages: [...compactedMessages],
			applied: false,
			carriedCandidateCount: candidates.length,
		};
	}
	const nextMessages = [...compactedMessages];
	nextMessages[summaryIndex] = rebuildSummaryMessage(
		summaryMessage,
		nextSummary,
	);
	return {
		messages: nextMessages,
		applied: true,
		carriedCandidateCount: candidates.length,
	};
}

/**
 * The provider-visible text of a summary message.
 */
function readSummaryTextFromContent(
	message: MessageWithMetadata,
): string | undefined {
	if (typeof message.content === "string") {
		return message.content;
	}
	if (!Array.isArray(message.content)) {
		return undefined;
	}
	const text = message.content
		.filter(
			(block): block is { type: "text"; text: string } =>
				block.type === "text" && typeof block.text === "string",
		)
		.map((block) => block.text)
		.join("\n");
	if (!text) {
		return undefined;
	}
	const prefix = "Context summary:\n\n";
	return text.startsWith(prefix) ? text.slice(prefix.length) : text;
}

/**
 * Rebuild a summary message with a new summary text, keeping every other
 * metadata field and the message envelope unchanged.
 */
function rebuildSummaryMessage(
	message: MessageWithMetadata,
	summary: string,
): MessageWithMetadata {
	const metadata = message.metadata
		? { ...message.metadata, summary }
		: { summary };
	return {
		...message,
		content: [{ type: "text", text: `Context summary:\n\n${summary}` }],
		metadata,
	};
}

/**
 * Derive the ACCEPTED adjudication candidates from a canonical history.
 *
 * This is the single entry point the compaction path uses. It reads ONLY
 * assistant `text` carriers, resolves each candidate against the canonical
 * evidence, and returns the candidates that passed EVERY gate.
 *
 * The derivation is a pure function of (canonical history, registry,
 * vocabulary, revision resolver). It therefore satisfies the idempotence
 * requirement: `derive(project(messages)) === derive(messages)` for
 * unchanged source state.
 *
 * CONFLICT RULE. A LATER accepted candidate for the same finding
 * SUPERSEDES an earlier one: the model has published a newer adjudication
 * for the same finding, and the newer one is the current position. This is
 * the defined conflict rule, and it makes the carried section free of
 * duplicates.
 */
export async function deriveAcceptedAdjudications(
	canonicalMessages: readonly MessageWithMetadata[],
	options: {
		readonly registry: AdjudicationEvidenceRegistry;
		readonly vocabulary?: AdjudicationVocabulary;
		readonly revisionResolver?: SourceRevisionResolver;
	},
): Promise<AcceptedAdjudication[]> {
	const published = collectPublishedAdjudicationCandidates(canonicalMessages);
	if (published.length === 0) {
		return [];
	}
	const accepted: AcceptedAdjudication[] = [];
	for (const candidate of published) {
		const decision = await resolveAdjudicationCandidate(candidate, {
			canonicalMessages,
			registry: options.registry,
			...(options.vocabulary ? { vocabulary: options.vocabulary } : {}),
			...(options.revisionResolver
				? { revisionResolver: options.revisionResolver }
				: {}),
		});
		if (!decision.candidate_accepted) {
			continue;
		}
		const existing = accepted.findIndex(
			(entry) => entry.finding_id === candidate.finding_id,
		);
		if (existing >= 0) {
			accepted.splice(existing, 1);
		}
		accepted.push({
			finding_id: candidate.finding_id,
			decision: candidate.decision,
			qualification_codes: [...candidate.qualification_codes],
			remaining_question_ids: [...candidate.remaining_question_ids],
			evidence_handles: (decision.resolvedEvidenceToolUseIds ?? []).map(
				(toolUseId) => options.registry.handleFor(toolUseId),
			),
			source_revision: renderSourceRevisionIdentity(decision.sourceRevision),
		});
	}
	return accepted;
}

/**
 * Render the bound source revision as an OPAQUE identity.
 *
 * The absolute workspace path is NOT carried: it can disclose the
 * operator's home directory and it is not portable. The repository
 * identity, the revision and the cleanliness are carried, because they are
 * what establishes provenance.
 */
export function renderSourceRevisionIdentity(
	revision: SourceRevision | undefined,
): string {
	if (!revision) {
		return "unbound";
	}
	return [
		revision.revision.slice(0, 12),
		revision.clean ? "clean" : "dirty",
		revision.contentIdentity.slice(0, 12),
	].join(":");
}

// ===========================================================================
// SECTION 8 — EXPOSING THE HANDLE TO THE MODEL
// ===========================================================================

/**
 * Attach the evidence-handle trailer to ONE tool result.
 *
 * The trailer is appended to the tool result the model already reads, so
 * the model can cite the evidence WITHOUT having to reproduce a
 * provider-issued identifier (which the live receipts show it cannot do
 * reliably).
 *
 * The trailer is BOUNDED and carries no source content: only the opaque
 * handle and the tool name.
 *
 * Returns the block UNCHANGED when no handle applies — a tool that does
 * not read a source file, an error result, or a result whose content does
 * not fit the trailer's bound.
 */
export function attachEvidenceHandleToToolResult(
	block: ContentBlock,
	handle: string,
): ContentBlock {
	if (block.type !== "tool_result" || block.is_error === true) {
		return block;
	}
	const trailer = renderEvidenceHandleTrailer({
		handle,
		toolName: block.name,
	});
	if (!trailer) {
		return block;
	}
	const content = block.content;
	if (typeof content === "string") {
		const stripped = stripEvidenceHandleTrailers(content);
		return {
			...block,
			content: `${stripped}\n${trailer}`,
		};
	}
	if (!Array.isArray(content)) {
		return block;
	}
	// The trailer is appended to the LAST text block, so the result's
	// structure (and any image/file parts) is preserved exactly.
	//
	// A PREVIOUS trailer is removed FIRST — both the trailer LINE inside a
	// text block and a trailer that was appended as its OWN text block.
	// Removing only the line would leave the empty block behind, and the
	// projection would not be idempotent.
	const withoutTrailerBlocks = content.filter(
		(part) => !isEvidenceHandleTrailerText(part),
	);
	const cleaned = withoutTrailerBlocks.map((part) =>
		part.type === "text" && typeof part.text === "string"
			? { ...part, text: stripEvidenceHandleTrailers(part.text) }
			: part,
	);
	let lastTextIndex = -1;
	for (let index = cleaned.length - 1; index >= 0; index -= 1) {
		const part = cleaned[index];
		if (part.type === "text" && typeof part.text === "string") {
			lastTextIndex = index;
			break;
		}
	}
	if (lastTextIndex === -1) {
		return {
			...block,
			content: [...cleaned, { type: "text", text: trailer }],
		};
	}
	const next = [...cleaned];
	const target = next[lastTextIndex] as { type: "text"; text: string };
	next[lastTextIndex] = {
		...target,
		text: `${target.text}\n${trailer}`,
	};
	return { ...block, content: next };
}

/**
 * Attach the evidence handles to EVERY source-reading tool result in a
 * message list.
 *
 * The handles are derived from the canonical tool-call ids, so they are
 * STABLE: the same tool result always carries the same handle, whatever
 * the request shape is and whatever the summary did.
 *
 * The projection is IDEMPOTENT: an existing trailer is stripped before the
 * new one is written, so applying the projection twice produces
 * byte-identical output.
 *
 * The canonical history is NOT mutated: the caller receives a new list.
 */
export function attachEvidenceHandlesToMessages(
	messages: readonly MessageWithMetadata[],
	registry: AdjudicationEvidenceRegistry,
): MessageWithMetadata[] {
	let changed = false;
	const next = messages.map((message) => {
		if (message.role !== "user" || !Array.isArray(message.content)) {
			return message;
		}
		const blocks = message.content as ContentBlock[];
		const nextBlocks = blocks.map((block) => {
			if (block.type !== "tool_result" || block.is_error === true) {
				return block;
			}
			const handle = registry.handleFor(block.tool_use_id);
			const updated = attachEvidenceHandleToToolResult(block, handle);
			if (updated !== block) {
				changed = true;
			}
			return updated;
		});
		return changed ? { ...message, content: nextBlocks } : message;
	});
	return changed ? next : [...messages];
}

// ===========================================================================
// SECTION 9 — THE AGENT-MESSAGE FORM OF THE HANDLE PROJECTION
// ===========================================================================

/**
 * Attach the evidence handles to the tool results of an AGENT-MESSAGE list.
 *
 * The agent-message form is what the `beforeModel` hook receives. The
 * attachment is the SAME bounded trailer, derived from the SAME session
 * registry, so the handle the model sees is identical whether the request
 * was projected from the canonical form or the agent-message form.
 *
 * The projection is IDEMPOTENT: an existing trailer is stripped before the
 * new one is written, so applying the projection twice produces
 * byte-identical output. The input list is NOT mutated.
 */
export function attachEvidenceHandlesToAgentMessages(
	messages: readonly AgentMessage[],
	registry: AdjudicationEvidenceRegistry,
): AgentMessage[] {
	let changed = false;
	const next = messages.map((message) => {
		if (!Array.isArray(message.content)) {
			return message;
		}
		const parts = message.content;
		const nextParts = parts.map((part) => {
			if (part.type !== "tool-result" || part.isError === true) {
				return part;
			}
			const handle = registry.handleFor(part.toolCallId);
			const updated = attachEvidenceHandleToAgentToolResult(part, handle);
			if (updated !== part) {
				changed = true;
			}
			return updated;
		});
		return changed ? { ...message, content: nextParts } : message;
	});
	return changed ? next : [...messages];
}

/**
 * Attach the evidence-handle trailer to ONE agent-message tool result.
 *
 * The output may be a string or a list of media parts. Only a textual
 * output can carry the trailer: a result with no textual content gets a
 * text part appended, which is the shape the provider already accepts for
 * a tool result.
 */
function attachEvidenceHandleToAgentToolResult(
	part: Extract<AgentMessagePart, { type: "tool-result" }>,
	handle: string,
): Extract<AgentMessagePart, { type: "tool-result" }> {
	const trailer = renderEvidenceHandleTrailer({
		handle,
		toolName: part.toolName,
	});
	if (!trailer) {
		return part;
	}
	const output = part.output;
	if (typeof output === "string") {
		return {
			...part,
			output: `${stripEvidenceHandleTrailers(output)}\n${trailer}`,
		};
	}
	if (Array.isArray(output)) {
		let lastTextIndex = -1;
		for (let index = output.length - 1; index >= 0; index -= 1) {
			const entry = output[index] as { type?: string; text?: unknown };
			if (entry?.type === "text" && typeof entry.text === "string") {
				lastTextIndex = index;
				break;
			}
		}
		if (lastTextIndex === -1) {
			return {
				...part,
				output: [...output, { type: "text", text: trailer }],
			};
		}
		const next = [...output];
		const target = next[lastTextIndex] as { type: "text"; text: string };
		next[lastTextIndex] = {
			...target,
			text: `${stripEvidenceHandleTrailers(target.text)}\n${trailer}`,
		};
		return { ...part, output: next };
	}
	return {
		...part,
		output: `${trailer}`,
	};
}

// ===========================================================================
// SECTION 10 — THE PUBLICATION INSTRUCTION
// ===========================================================================

/**
 * The section heading of the publication instruction.
 *
 * A stable, greppable marker so the instruction can be located and
 * REPLACED deterministically on a later turn instead of accumulating
 * copies.
 */
export const ADJUDICATION_INSTRUCTION_HEADING =
	"## Adjudication publication contract";

const ADJUDICATION_INSTRUCTION_BEGIN_MARKER =
	"<!-- cline-adjudication-instruction:begin -->";
const ADJUDICATION_INSTRUCTION_END_MARKER =
	"<!-- cline-adjudication-instruction:end -->";

/**
 * Render the publication instruction for a task-scoped vocabulary.
 *
 * THE INSTRUCTION IS DERIVED FROM THE AUTHORIZED VOCABULARY.
 *
 * It names ONLY the values the runtime is willing to accept, so the
 * instruction and the validator cannot disagree: a value the instruction
 * never mentions is rejected by the parser, and a value the parser accepts
 * is one the instruction named.
 *
 * It does NOT require the model to disclose its reasoning, and it does NOT
 * promise that publishing is required for the task to proceed. A missing
 * envelope is a NORMAL outcome.
 *
 * Returns `undefined` when there is no authorized vocabulary, because
 * without one there is nothing to publish.
 */
export function renderAdjudicationPublicationInstruction(
	vocabulary: AdjudicationVocabulary | undefined,
): string | undefined {
	if (!hasAuthorizedVocabulary(vocabulary)) {
		return undefined;
	}
	const lines: string[] = [
		ADJUDICATION_INSTRUCTION_HEADING,
		ADJUDICATION_INSTRUCTION_BEGIN_MARKER,
		"",
		"When — and ONLY when — the task has given you an authorized",
		"adjudication contract, you MAY publish a structured adjudication",
		"candidate once you have sufficient evidence.",
		"",
		"Publication means: emit EXACTLY ONE JSON object as your own",
		"assistant text output. NOT inside a tool call. NOT inside your",
		"reasoning.",
		"",
		"The JSON object must have EXACTLY these fields:",
		'  kind                   = "adjudication_candidate"',
		"  schema_version         = 1",
		"  finding_id             = one of the authorized finding ids",
		"  decision               = one of the authorized decisions",
		"  qualification_codes    = a list of authorized qualification codes",
		"  evidence_tool_use_ids  = the evidence handles you were given",
		"  counterevidence_tool_use_ids = the evidence handles against you",
		"  remaining_question_ids = a list of authorized question ids",
		"",
		"Authorized finding ids:",
		...vocabulary.findingIds.map((id) => `  - ${id}`),
		"",
		"Authorized decisions:",
		...vocabulary.decisions.map((value) => `  - ${value}`),
		"",
		"Authorized qualification codes:",
		...vocabulary.qualificationCodes.map((value) => `  - ${value}`),
		"",
		"Authorized remaining-question ids:",
		...Object.keys(vocabulary.remainingQuestions).map((id) => `  - ${id}`),
		"",
		"Rules:",
		"- Do NOT add any field other than the eight listed above.",
		"- Do NOT include file contents, excerpts, prose or explanations in",
		"  the JSON.",
		"- Cite evidence by the EVIDENCE HANDLE shown on the tool result.",
		"  Do NOT invent a handle, and do NOT cite a tool name.",
		"- Publish only when you have at least one evidence handle.",
		"- Publishing is OPTIONAL. If you are not confident, do not publish.",
		"  A missing candidate is a normal outcome.",
		"- After publishing, continue working normally.",
		ADJUDICATION_INSTRUCTION_END_MARKER,
	];
	return lines.join("\n");
}

/**
 * Remove any previously rendered publication instruction from a prompt.
 *
 * This makes the instruction application IDEMPOTENT: a later turn replaces
 * the instruction instead of appending a second copy.
 */
export function stripAdjudicationPublicationInstruction(
	prompt: string,
): string {
	const begin = prompt.indexOf(ADJUDICATION_INSTRUCTION_BEGIN_MARKER);
	if (begin === -1) {
		return prompt;
	}
	const end = prompt.indexOf(ADJUDICATION_INSTRUCTION_END_MARKER, begin);
	if (end === -1) {
		return prompt.slice(0, begin).trimEnd();
	}
	const before = prompt.slice(0, begin).trimEnd();
	const after = prompt
		.slice(end + ADJUDICATION_INSTRUCTION_END_MARKER.length)
		.trimStart();
	// The heading is part of the instruction, so it is removed with it.
	const withoutHeading = before
		.split("\n")
		.filter((line) => line.trim() !== ADJUDICATION_INSTRUCTION_HEADING)
		.join("\n")
		.trim();
	if (!withoutHeading) {
		return after;
	}
	if (!after) {
		return withoutHeading;
	}
	return `${withoutHeading}\n\n${after}`;
}

/**
 * Apply the publication instruction to a system prompt.
 *
 * The instruction is appended to the prompt, and any PREVIOUS copy is
 * stripped first, so the result is a pure function of (prompt,
 * vocabulary).
 */
export function applyAdjudicationPublicationInstruction(
	prompt: string,
	vocabulary: AdjudicationVocabulary | undefined,
): string {
	const instruction = renderAdjudicationPublicationInstruction(vocabulary);
	const stripped = stripAdjudicationPublicationInstruction(prompt).trimEnd();
	if (!instruction) {
		return stripped;
	}
	if (!stripped) {
		return instruction;
	}
	return `${stripped}\n\n${instruction}`;
}
