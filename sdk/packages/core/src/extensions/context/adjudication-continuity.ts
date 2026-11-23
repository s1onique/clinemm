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
	ToolResultAcquisition,
} from "@cline/shared";
import { sha256HexSync } from "@cline/shared";
import type { VerifiedOutcomeStatus } from "./evidence-continuity";
import {
	classifyToolResultStatus,
	EVIDENCE_HANDLE_HEX_LENGTH,
	EVIDENCE_HANDLE_PREFIX,
	EVIDENCE_HANDLE_TRAILER_MARKER,
	isEvidenceHandleShape,
} from "./evidence-continuity";

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
 *
 * ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-IMPLEMENT-01-CORRECTION02: the
 * definition now lives in `evidence-continuity.ts`, because the PRODUCTION
 * result classifier must be able to VALIDATE a trailer's handle token, and
 * that classifier lives there. It is RE-EXPORTED here so there is exactly
 * ONE definition in the codebase and the two modules cannot drift apart.
 */
export { EVIDENCE_HANDLE_PREFIX };

/**
 * The number of hex characters in an evidence handle.
 *
 * 16 hex characters is 64 bits of a per-session-secret-derived MAC. The
 * handle must be unguessable by a model that knows the canonical tool-call
 * id, and it must be short enough to carry in a bounded trailer line.
 *
 * ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-IMPLEMENT-01-CORRECTION02:
 * re-exported from `evidence-continuity.ts` (single definition).
 */
export { EVIDENCE_HANDLE_HEX_LENGTH };

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
 * ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-IMPLEMENT-01-CORRECTION01:
 *
 * The definition lives in `evidence-continuity.ts` because the PRODUCTION
 * result classifier must be able to recognise the trailer and exclude it
 * from the operation-payload set. The trailer is a transport annotation the
 * runtime appends to the result the model reads; reading it as a tool
 * operation payload would classify every successful result that carries a
 * handle as `unknown`.
 *
 * It is RE-EXPORTED here so there is exactly ONE definition of the marker
 * in the codebase and the two modules cannot drift apart.
 */
export const EVIDENCE_HANDLE_MARKER = EVIDENCE_HANDLE_TRAILER_MARKER;

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
	 *
	 * ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-IMPLEMENT-01-CORRECTION01:
	 *
	 * The predecessor ALWAYS generated a fresh random secret when the
	 * registry was constructed, and deliberately never persisted it. That
	 * made the handle UNRESOLVABLE after a session recreation: a restored
	 * session minted a NEW secret, so a previously published handle
	 * resolved to nothing and the adjudication it supported silently
	 * disappeared from the carried section.
	 *
	 * The secret is now supplied by the HOST, which owns the session's
	 * lifetime and can therefore re-derive the same secret for the same
	 * session id. When the host supplies NO secret, the registry is in the
	 * DEGRADED mode described on {@link AdjudicationEvidenceRegistry} — see
	 * {@link AdjudicationEvidenceRegistry.isRestorable}.
	 */
	readonly #secret: string;

	/** The session this registry belongs to. */
	readonly sessionId: string;

	/**
	 * ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-IMPLEMENT-01-CORRECTION01.
	 *
	 * Whether this registry's secret is RE-DERIVABLE after the session is
	 * recreated.
	 *
	 * A host-supplied secret is re-derivable by construction: the host
	 * derives it from the session id, so the same session id always yields
	 * the same secret. A randomly generated secret is NOT: it exists only
	 * in memory, so it is lost when the process ends.
	 */
	readonly #restorable: boolean;

	constructor(input: {
		sessionId: string;
		secret?: string;
		/**
		 * ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-IMPLEMENT-01-CORRECTION01.
		 *
		 * Whether the supplied secret is re-derivable after a session
		 * recreation.
		 *
		 * Defaults to `true` when a secret is supplied: a host that
		 * supplies a secret owns its lifetime and is expected to be able to
		 * reproduce it. A host that cannot reproduce it must say so by
		 * passing `false`, and the registry then reports itself as NOT
		 * restorable — which is the fail-closed direction.
		 */
		restorable?: boolean;
	}) {
		this.sessionId = input.sessionId;
		if (input.secret !== undefined) {
			this.#secret = input.secret;
			this.#restorable = input.restorable ?? true;
			return;
		}
		this.#secret = AdjudicationEvidenceRegistry.generateSecret();
		// A randomly generated secret is, by construction, unrecoverable
		// after the process ends.
		this.#restorable = false;
	}

	/**
	 * ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-IMPLEMENT-01-CORRECTION01.
	 *
	 * Whether this registry can re-derive its handles after the session is
	 * recreated.
	 *
	 * When it cannot, the registry is a FAIL-CLOSED DEGRADED MODE: the
	 * handles it mints are valid for the lifetime of the process, and a
	 * handle published before a restart simply stops resolving. That is
	 * the correct security direction — an unresolvable handle cannot
	 * authenticate anything — but it means the adjudication it supported
	 * does NOT survive the restart.
	 *
	 * The distinction is REPORTED rather than blurred: a caller that
	 * claims continuity across a restart must check this and must not
	 * claim restoration when it is false.
	 */
	isRestorable(): boolean {
		return this.#restorable;
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
		return isEvidenceHandleShape(value);
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
 *
 * ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-IMPLEMENT-01-CORRECTION05:
 * the RUNTIME-OWNED test.
 *
 * The previous implementation recognised a trailer block by its SHAPE
 * alone — a text block starting with the marker — and DELETED it. That was
 * a second route around the trusted-origin check: a FORGED text block
 * that merely resembles an annotation was removed from the result BEFORE
 * the classifier ever saw it, so it never contributed to the aggregate.
 *
 * A block is the runtime's own annotation only when its handle is EXACTLY
 * the handle the runtime recorded for this result. A block that merely
 * RESEMBLES an annotation is SOURCE CONTENT, and the runtime has no
 * authority to delete it: it stays in the operation-payload set, where
 * its lack of an affirmative success signal leaves the batch unverified
 * and its failure poisons the aggregate.
 */
function isEvidenceHandleTrailerText(
	part: unknown,
	trustedHandle: string | undefined,
): boolean {
	if (!part || typeof part !== "object") {
		return false;
	}
	const candidate = part as { type?: unknown; text?: unknown };
	if (candidate.type !== "text" || typeof candidate.text !== "string") {
		return false;
	}
	// Without a RUNTIME-RECORDED handle there is no trusted origin, so
	// nothing can be the runtime's own annotation. This is the
	// fail-closed direction.
	if (!trustedHandle) {
		return false;
	}
	const trimmed = candidate.text.trim();
	// The annotation is a SINGLE line: anything else in the block is
	// source content, and the block is not the annotation.
	if (!trimmed.startsWith(`${EVIDENCE_HANDLE_MARKER} `)) {
		return false;
	}
	if (trimmed.includes("\n")) {
		return false;
	}
	const rest = trimmed.slice(EVIDENCE_HANDLE_MARKER.length + 1);
	const separator = rest.indexOf(" ");
	if (separator === -1) {
		return false;
	}
	// THE ORIGIN CHECK: the handle in the line must be EXACTLY the handle
	// the runtime recorded for this result.
	return rest.slice(0, separator) === trustedHandle;
}

/**
 * Remove every evidence-handle trailer from a text.
 *
 * The trailer is a DERIVED, runtime-owned annotation. Stripping it before
 * re-deriving keeps the projection idempotent: applying the enrichment
 * twice produces byte-identical output.
 *
 * ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-IMPLEMENT-01-CORRECTION05:
 * only a RUNTIME-OWNED trailer is removed.
 *
 * The previous implementation removed every LINE that started with the
 * marker, whatever it contained. That is a deletion authority the runtime
 * does not have: tool output is UNTRUSTED source content, and a line of it
 * that merely resembles an annotation is content, not an annotation.
 *
 * Removing such a line silently DROPPED source content from the result —
 * and from the aggregate the classifier builds — which is the same
 * promotion the classifier itself was hardened against: content that
 * should have left the batch UNVERIFIED simply vanished.
 *
 * So a line is removed only when it is the EXACT runtime-generated
 * annotation for the recorded handle. Every other line is left alone.
 *
 * With no recorded handle, nothing is removed: there is no runtime-owned
 * annotation to identify.
 */
export function stripEvidenceHandleTrailers(
	text: string,
	trustedHandle?: string,
): string {
	if (!trustedHandle || !text.includes(EVIDENCE_HANDLE_MARKER)) {
		return text;
	}
	const kept = text
		.split("\n")
		.filter((line) => !isRuntimeOwnedAnnotationLine(line, trustedHandle));
	return kept.join("\n").trimEnd();
}

/**
 * Whether a single LINE is the runtime's own annotation for the recorded
 * handle.
 *
 * The line must carry the recorded handle — a line that merely starts
 * with the marker is source content, not the runtime's annotation.
 */
function isRuntimeOwnedAnnotationLine(
	line: string,
	trustedHandle: string,
): boolean {
	const trimmed = line.trim();
	if (!trimmed.startsWith(`${EVIDENCE_HANDLE_MARKER} `)) {
		return false;
	}
	const rest = trimmed.slice(EVIDENCE_HANDLE_MARKER.length + 1);
	const separator = rest.indexOf(" ");
	if (separator === -1) {
		return false;
	}
	return rest.slice(0, separator) === trustedHandle;
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
 *
 * ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-IMPLEMENT-01-CORRECTION01:
 *
 * The predecessor implemented the last two rules as `block.is_error !== true`,
 * which accepts a result that carries NO success signal at all — including a
 * structured payload that reports a failure without setting `is_error`. The
 * classification is now the PRODUCTION one
 * ({@link classifyToolResultStatus}), which is the same rule the
 * verified-outcome continuity already applies to the same canonical history:
 *
 *   - `is_error: true`              -> failed, not evidence;
 *   - any payload `success: false`  -> failed, not evidence;
 *   - any payload `isError: true`   -> failed, not evidence;
 *   - a payload with no signal      -> UNKNOWN, so the whole result is not
 *                                     evidence;
 *   - every payload `success: true` -> succeeded, evidence.
 *
 * "No evidence of failure" is not "evidence of success".
 */
export function buildCanonicalEvidenceLedger(
	messages: readonly MessageWithMetadata[],
): CanonicalEvidenceLedger {
	const calls = new Map<
		string,
		{ name: string; input: Record<string, unknown>; ambiguous: boolean }
	>();
	const results = new Map<
		string,
		{ isError: boolean; count: number; status: VerifiedOutcomeStatus }
	>();

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
					status: classifyToolResultStatus({
						is_error: block.is_error,
						content: block.content,
						// ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-IMPLEMENT-01-CORRECTION03:
						// the RUNTIME-RECORDED handle is the trusted ORIGIN of the
						// evidence-handle trailer, so it must be forwarded here —
						// without it the runtime's own trailer would be
						// indistinguishable from a forged line in untrusted output.
						evidenceHandle: block.evidenceHandle,
					}),
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
		// ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-IMPLEMENT-01-CORRECTION01:
		// the result must AFFIRMATIVELY have succeeded.
		if (result.status !== "succeeded") {
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
// SECTION 5A — THE ACQUISITION-TIME EVIDENCE LEDGER
// ===========================================================================

/**
 * ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-IMPLEMENT-01-CORRECTION01.
 *
 * WHY THIS SECTION EXISTS
 * -----------------------
 *
 * The predecessor bound a candidate's source revision by RE-RESOLVING the
 * source file at EVALUATION time:
 *
 *   bindSourceRevision() -> resolver.resolve({ sourcePath, toolName })
 *
 * That establishes what the file looks like NOW, not what the evidence the
 * candidate cited actually WAS. The counterexample is a file edited between
 * the read and the citation:
 *
 *   T1  read config.yaml              -> value = A
 *   T2  modify config.yaml             -> value = B
 *   T3  model cites T1's result
 *   T4  revisionResolver resolves the CURRENT file
 *   T5  candidate accepted with B's identity, although its evidence was A
 *
 * The git HEAD can even remain identical throughout, because the edit is
 * uncommitted. So the defect is not a git edge case: it is the ordinary
 * case of an agent that reads a file and then edits it.
 *
 * THE REPAIR
 * ----------
 *
 * The runtime must record the source identity AT THE MOMENT THE EVIDENCE WAS
 * ACQUIRED, and bind the candidate to that RECORDED identity. It must never
 * re-resolve a file to answer "what did this evidence refer to?".
 *
 * The recorded identity has two independent halves, and BOTH are required:
 *
 *   1. WHAT WAS OBSERVED — the source paths the tool RESULT actually
 *      reported. This is derived from the result payload's own attribution
 *      (the production `read_files` executor persists one
 *      `{query, result, success}` payload per requested file, and `query` is
 *      the file path), NEVER from the tool call's declared arguments. A call
 *      that declares a path but did not read it establishes no source
 *      identity, and a NON-READ tool's arguments never establish one.
 *
 *   2. WHAT IT WAS AT THAT MOMENT — the revision and content identity
 *      captured when the result was observed. The runtime resolves it once,
 *      at acquisition, and stores it. Later evaluation READS the stored
 *      value; it never asks the workspace what the file looks like now.
 *
 * The stored record travels WITH the canonical history, so it survives
 * persistence and compaction. A record that was never captured is simply
 * ABSENT, and an absent record is `UNBOUND` — the fail-closed direction.
 */

/**
 * The source paths and revision captured for ONE tool result at the moment
 * its evidence was acquired.
 */
export interface AcquisitionEvidence {
	/** The canonical tool-call id this record belongs to. */
	readonly toolUseId: string;
	/** The tool that produced the result. */
	readonly toolName: string;
	/**
	 * The source paths the RESULT reported observing.
	 *
	 * Every path in this list was READ by the tool. A path that appears only
	 * in the call's arguments does NOT appear here.
	 */
	readonly sourcePaths: readonly string[];
	/**
	 * The revision captured AT ACQUISITION.
	 *
	 * This is the identity the evidence HAD, not the identity the file has
	 * now.
	 */
	readonly revision: SourceRevision;
	/**
	 * ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-IMPLEMENT-01-CORRECTION01.
	 *
	 * The CONTENT identity of each observed source, keyed by path.
	 *
	 * This is the load-bearing half of the acquisition record, and it is
	 * derived from the bytes the tool ACTUALLY RETURNED — never from the
	 * file on disk at evaluation time.
	 *
	 * That derivation is what makes the binding race-free by construction:
	 * a file edited after the read cannot change the identity of the
	 * evidence that was already read, because the evidence's content is
	 * carried in the evidence itself.
	 */
	readonly contentIdentities: ReadonlyMap<string, string>;
}

/**
 * The acquisition-time evidence ledger, keyed by canonical tool-call id.
 */
export interface AcquisitionEvidenceLedger {
	/**
	 * The tool-call ids that carry a captured acquisition record.
	 */
	readonly toolUseIds: readonly string[];
	/**
	 * The captured records, keyed by canonical tool-call id.
	 */
	readonly records: ReadonlyMap<string, AcquisitionEvidence>;
}

/**
 * ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-IMPLEMENT-01-CORRECTION01.
 *
 * The tool whose result payload attributes a SOURCE FILE it observed.
 *
 * The rule is matched on the TOOL'S OWN CONTRACT — the tool that persists
 * one `{query, result, success}` payload per requested file — and not on a
 * provider id. The set is closed and explicit rather than inferred, so a
 * tool that merely ACCEPTS a path argument never gains source authority.
 */
const SOURCE_OBSERVING_TOOL_NAMES: ReadonlySet<string> = new Set([
	"read_files",
]);

/**
 * ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-IMPLEMENT-01-CORRECTION01.
 *
 * Extract the source paths a tool RESULT reported observing.
 *
 * The extraction reads the result's OWN structured payloads and uses their
 * `query` attribution — the production `read_files` executor names the
 * source it read in `query` — and it requires each payload to carry the
 * AFFIRMATIVE success signal.
 *
 * The rules, all of which fail closed:
 *
 *   - the tool must be a source-observing tool (`read_files`);
 *   - the payload must carry `success: true` (an affirmative signal; the
 *     absence of a signal is not a success);
 *   - the payload's `query` must name a source path;
 *   - a payload whose `success` is false, or which carries `isError: true`,
 *     contributes NO path and fails the whole extraction, because a
 *     multi-file read in which one file failed did not observe the set.
 *
 * The `query` may carry a `:start-end` range suffix; the range is stripped
 * so the attribution names the SOURCE, not the line window.
 */
export function extractAcquiredSourcePaths(
	toolName: string,
	content: unknown,
): string[] | undefined {
	if (!SOURCE_OBSERVING_TOOL_NAMES.has(toolName)) {
		return undefined;
	}
	const payloads =
		Array.isArray(content) &&
		content.every((item) => item && typeof item === "object")
			? (content as Record<string, unknown>[])
			: undefined;
	if (!payloads || payloads.length === 0) {
		return undefined;
	}
	const paths: string[] = [];
	for (const payload of payloads) {
		if (payload.success !== true) {
			// No affirmative success signal, or an explicit failure.
			return undefined;
		}
		if (payload.isError === true) {
			return undefined;
		}
		const query = payload.query;
		if (typeof query !== "string") {
			return undefined;
		}
		const path = parseAcquiredSourcePath(query);
		if (!path) {
			return undefined;
		}
		paths.push(path);
	}
	if (paths.length === 0) {
		return undefined;
	}
	return paths;
}

/**
 * ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-IMPLEMENT-01-CORRECTION01.
 *
 * Parse the source path out of a source-read query.
 *
 * The production `formatReadFileQuery()` renders a range as
 * `<path>:<start>-<end>`, so the range suffix is stripped. The path itself
 * may legitimately contain a colon (a Windows drive), so only a suffix that
 * matches the range grammar is removed.
 *
 * A query that is not path-like is rejected: an ambiguous attribution is
 * worse than no attribution.
 */
export function parseAcquiredSourcePath(query: string): string | undefined {
	const trimmed = query.trim();
	if (!trimmed || /[\n\r\0]/.test(trimmed)) {
		return undefined;
	}
	const rangeMatch = /^(.*?):(\d+)(?:-(?:(\d+)|EOF))?$/.exec(trimmed);
	const candidate = rangeMatch?.[1] ?? trimmed;
	if (!candidate || (!candidate.includes("/") && !candidate.includes("\\"))) {
		return undefined;
	}
	return candidate;
}

/**
 * ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-IMPLEMENT-01-CORRECTION01.
 *
 * The CONTENT identity of one observed source, derived from the bytes the
 * tool RETURNED.
 *
 * The production `read_files` executor renders each line as
 * `<number> | <content>`. The gutter is a PRESENTATION artifact of the read
 * tool, not part of the source, so it is stripped before hashing: otherwise
 * two reads of the same file with different line windows would hash
 * differently, and the identity would describe the window rather than the
 * source.
 *
 * A body whose lines do NOT carry the gutter is hashed verbatim: the source
 * text is what was returned, and mangling an unrecognised shape would be
 * worse than hashing it as-is.
 */
export function acquiredContentIdentity(result: unknown): string | undefined {
	if (typeof result !== "string") {
		return undefined;
	}
	return sha256HexSync(stripAcquiredLineGutter(result));
}

/**
 * ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-IMPLEMENT-01-CORRECTION01.
 *
 * Strip the source-file-read line-number gutter from a returned file body.
 *
 * The gutter is only stripped when EVERY non-empty line carries it, so a
 * body that merely CONTAINS a numbered line is left untouched.
 */
function stripAcquiredLineGutter(body: string): string {
	const gutter = /^\s*\d+\s*\|\s?/;
	const meaningful = body.split("\n").filter((line) => line.trim().length > 0);
	if (
		meaningful.length === 0 ||
		!meaningful.every((line) => gutter.test(line))
	) {
		return body;
	}
	return body
		.split("\n")
		.map((line) => (gutter.test(line) ? line.replace(gutter, "") : line))
		.join("\n");
}

/**
 * ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-IMPLEMENT-01-CORRECTION01.
 *
 * Capture the ACQUISITION-TIME evidence record for ONE observed tool result.
 *
 * This is the function the runtime calls when the evidence is observed. It
 * is the ONLY place a source identity is established, and it establishes it
 * from the result's OWN content:
 *
 *   - the source paths come from the result's `query` attribution, not from
 *     the call's arguments;
 *   - the CONTENT identity of each source comes from the bytes the tool
 *     RETURNED, so it describes the file as it was READ;
 *   - the REVISION comes from the host's resolver, called ONCE, here.
 *
 * It returns `undefined` when the result establishes no source identity —
 * a non-source-observing tool, a failed read, a result with no affirmative
 * success signal, or a payload whose content is not attributable to a
 * source. An absent record is `UNBOUND` downstream, which is the
 * fail-closed direction.
 */
export async function captureAcquisitionEvidence(input: {
	toolUseId: string;
	toolName: string;
	content: unknown;
	/**
	 * The host's source-revision resolver, called ONCE per observed source.
	 */
	resolver?: SourceRevisionResolver;
}): Promise<AcquisitionEvidence | undefined> {
	const payloads =
		Array.isArray(input.content) &&
		input.content.every((item) => item && typeof item === "object")
			? (input.content as Record<string, unknown>[])
			: undefined;
	if (!payloads || payloads.length === 0) {
		return undefined;
	}
	if (!SOURCE_OBSERVING_TOOL_NAMES.has(input.toolName)) {
		return undefined;
	}
	const paths: string[] = [];
	const contentIdentities = new Map<string, string>();
	for (const payload of payloads) {
		if (payload.success !== true || payload.isError === true) {
			return undefined;
		}
		const query = payload.query;
		if (typeof query !== "string") {
			return undefined;
		}
		const path = parseAcquiredSourcePath(query);
		if (!path) {
			return undefined;
		}
		const identity = acquiredContentIdentity(payload.result);
		if (!identity) {
			return undefined;
		}
		paths.push(path);
		contentIdentities.set(path, identity);
	}
	if (paths.length === 0) {
		return undefined;
	}
	// The revision is resolved ONCE, for the FIRST observed source. The
	// revision is a property of the WORKSPACE at the moment of observation,
	// not of the file, and the content identity above is what pins the
	// file. A multi-source read therefore needs one workspace revision.
	const revision = input.resolver
		? await input.resolver.resolve({
				sourcePath: paths[0] as string,
				toolName: input.toolName,
			})
		: undefined;
	if (!revision) {
		return undefined;
	}
	return {
		toolUseId: input.toolUseId,
		toolName: input.toolName,
		sourcePaths: paths,
		revision,
		contentIdentities,
	};
}

/**
 * ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-IMPLEMENT-01-CORRECTION01.
 *
 * Build the ACQUISITION-TIME evidence ledger.
 *
 * The ledger is derived from the CANONICAL HISTORY: every tool result that
 * carries an acquisition record contributes it.
 *
 * That is the whole point of the record living ON the tool result: the
 * canonical history is the durable authority, so a session recreated from
 * the persisted messages restores the ledger with NO in-memory handover and
 * NO workspace re-read. An in-memory map answered "what did this evidence
 * refer to?" only while the process lived.
 *
 * A record is usable only when the canonical history actually contains the
 * call AND exactly one non-error result for it. A record for a call that is
 * not in the canonical history proves nothing, and an ambiguous
 * call/result join fails closed.
 */
export function buildAcquisitionEvidenceLedger(
	messages: readonly MessageWithMetadata[],
): AcquisitionEvidenceLedger {
	const records = new Map<string, AcquisitionEvidence>();
	for (const message of messages) {
		if (!Array.isArray(message.content)) {
			continue;
		}
		for (const block of message.content as ContentBlock[]) {
			if (block.type !== "tool_result") {
				continue;
			}
			const acquisition = (block as { acquisition?: unknown }).acquisition;
			if (!acquisition || typeof acquisition !== "object") {
				continue;
			}
			const parsed = parseAcquisitionRecord(acquisition);
			if (!parsed) {
				continue;
			}
			const call = findCanonicalCall(messages, block.tool_use_id);
			if (!call) {
				continue;
			}
			const result = findCanonicalResult(messages, block.tool_use_id);
			if (!result || result.isError) {
				continue;
			}
			records.set(block.tool_use_id, parsed);
		}
	}
	return {
		toolUseIds: [...records.keys()],
		records,
	};
}

/**
 * ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-IMPLEMENT-01-CORRECTION01.
 *
 * Parse a persisted acquisition record back into the runtime's shape.
 *
 * The record is read from durable storage, so it is UNTRUSTED input: every
 * field is validated, and a malformed record is treated as absent — which
 * is `UNBOUND` downstream, the fail-closed direction.
 */
export function parseAcquisitionRecord(
	value: unknown,
): AcquisitionEvidence | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return undefined;
	}
	const record = value as {
		sourcePaths?: unknown;
		contentIdentities?: unknown;
		repositoryIdentity?: unknown;
		workspaceRootIdentity?: unknown;
		revision?: unknown;
		clean?: unknown;
	};
	if (!Array.isArray(record.sourcePaths)) {
		return undefined;
	}
	const sourcePaths = record.sourcePaths.filter(
		(path): path is string => typeof path === "string" && path.length > 0,
	);
	if (sourcePaths.length === 0) {
		return undefined;
	}
	if (
		!record.contentIdentities ||
		typeof record.contentIdentities !== "object" ||
		Array.isArray(record.contentIdentities)
	) {
		return undefined;
	}
	const contentIdentities = new Map<string, string>();
	for (const [path, identity] of Object.entries(
		record.contentIdentities as Record<string, unknown>,
	)) {
		if (typeof identity !== "string" || identity.length === 0) {
			return undefined;
		}
		contentIdentities.set(path, identity);
	}
	if (typeof record.repositoryIdentity !== "string") {
		return undefined;
	}
	if (typeof record.workspaceRootIdentity !== "string") {
		return undefined;
	}
	if (typeof record.revision !== "string" || record.revision.length === 0) {
		return undefined;
	}
	// The content identity of a RESTORED record is the digest over the
	// observed sources' own identities. It is stable, it is derived only
	// from what was pinned, and it does not depend on the workspace.
	const sourceIdentities = sourcePaths
		.map((path) => contentIdentities.get(path))
		.filter((identity): identity is string => Boolean(identity))
		.sort();
	return {
		toolUseId: "",
		toolName: "",
		sourcePaths,
		revision: {
			repositoryIdentity: record.repositoryIdentity,
			workspaceRootIdentity: record.workspaceRootIdentity,
			revision: record.revision,
			contentIdentity: sha256HexSync(sourceIdentities.join("\n")),
			clean: record.clean === true,
		},
		contentIdentities,
	};
}

/**
 * ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-IMPLEMENT-01-CORRECTION01.
 *
 * The PERSISTED shape of an acquisition record.
 *
 * It is what the runtime writes onto the tool result block, so it is the
 * shape that survives a persistence round-trip and comes back when the
 * session is recreated.
 */
export function renderAcquisitionRecord(
	evidence: AcquisitionEvidence,
): ToolResultAcquisition {
	return {
		sourcePaths: [...evidence.sourcePaths],
		contentIdentities: Object.fromEntries(evidence.contentIdentities),
		repositoryIdentity: evidence.revision.repositoryIdentity,
		workspaceRootIdentity: evidence.revision.workspaceRootIdentity,
		revision: evidence.revision.revision,
		clean: evidence.revision.clean,
	};
}

/**
 * ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-IMPLEMENT-01-CORRECTION01.
 *
 * Attach an acquisition record to a tool result block.
 *
 * The record rides ON the block, so it is part of the durable canonical
 * history and is restored with it.
 */
export function attachAcquisitionToToolResult(
	block: ContentBlock,
	evidence: AcquisitionEvidence | undefined,
): ContentBlock {
	if (block.type !== "tool_result") {
		return block;
	}
	if (!evidence) {
		return block;
	}
	return {
		...block,
		acquisition: renderAcquisitionRecord(evidence),
	} as ContentBlock;
}

/**
 * Find the canonical tool CALL for a tool-call id.
 *
 * The join fails closed on ambiguity: an id claimed by more than one call
 * is not a call.
 */
function findCanonicalCall(
	messages: readonly MessageWithMetadata[],
	toolUseId: string,
): { name: string; input: Record<string, unknown> } | undefined {
	let found: { name: string; input: Record<string, unknown> } | undefined;
	for (const message of messages) {
		if (!Array.isArray(message.content)) {
			continue;
		}
		for (const block of message.content as ContentBlock[]) {
			if (block.type !== "tool_use" || block.id !== toolUseId) {
				continue;
			}
			if (found) {
				// Ambiguous: the same id claimed twice.
				return undefined;
			}
			found = {
				name: block.name,
				input: (block.input ?? {}) as Record<string, unknown>,
			};
		}
	}
	return found;
}

/**
 * Find the canonical tool RESULT for a tool-call id.
 *
 * The join fails closed on ambiguity: an id answered by more than one
 * result is not a result.
 */
function findCanonicalResult(
	messages: readonly MessageWithMetadata[],
	toolUseId: string,
): { isError: boolean } | undefined {
	let found: { isError: boolean } | undefined;
	for (const message of messages) {
		if (!Array.isArray(message.content)) {
			continue;
		}
		for (const block of message.content as ContentBlock[]) {
			if (block.type !== "tool_result" || block.tool_use_id !== toolUseId) {
				continue;
			}
			if (found) {
				return undefined;
			}
			found = { isError: block.is_error === true };
		}
	}
	return found;
}

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
	 * ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-IMPLEMENT-01-CORRECTION01:
	 * the resolver is now an ACQUISITION-TIME instrument. It is called ONCE,
	 * when the evidence is observed, and its answer is STORED against the
	 * tool-result identity. It is NOT called during candidate evaluation.
	 *
	 * When absent, no acquisition-time identity can be captured, so no
	 * candidate is bound and every candidate is rejected with
	 * `no_acquisition_record`.
	 */
	readonly revisionResolver?: SourceRevisionResolver;
	/**
	 * ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-IMPLEMENT-01-CORRECTION01.
	 *
	 * The acquisition-time records the runtime captured, keyed by canonical
	 * tool-call id.
	 *
	 * This is the authority for "what did this evidence refer to?". It is
	 * captured when the evidence is OBSERVED and travels with the canonical
	 * history. A candidate whose cited evidence carries no record is
	 * `UNBOUND` — the fail-closed direction.
	 */
	readonly acquisitions?: AcquisitionEvidenceLedger;
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
	// The resolution is evaluated INDEPENDENTLY of the revision gate, so
	// each gate reports its OWN truth. A short-circuit here would report
	// "the references did not resolve" for a candidate whose references
	// DID resolve but whose revision could not be bound — the exact
	// conflation the predecessor's correction was created to remove.
	const resolvedEvidence: string[] = [];
	const unresolvedReferences: string[] = [];
	let unpairedReference: string | undefined;
	for (const reference of [
		...candidate.evidence_tool_use_ids,
		...candidate.counterevidence_tool_use_ids,
	]) {
		const resolved = resolveReference(reference);
		if (!resolved.ok) {
			unresolvedReferences.push(reference);
			continue;
		}
		if (!ledger.pairedToolUseIds.has(resolved.toolUseId)) {
			unpairedReference ??= resolved.toolUseId;
			continue;
		}
		if (!resolvedEvidence.includes(resolved.toolUseId)) {
			resolvedEvidence.push(resolved.toolUseId);
		}
	}
	const canonicalRefsResolved =
		unresolvedReferences.length === 0 && unpairedReference === undefined;

	// --- GATE 5: SOURCE REVISION BINDING ---------------------------
	// The revision is bound by the RUNTIME. The model's claim is never
	// read: the envelope has no revision field, so there is nothing for
	// the model to override.
	//
	// ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-IMPLEMENT-01-CORRECTION01:
	// the binding now reads the ACQUISITION-TIME record. The workspace is
	// NOT consulted here, so the bound identity is the identity the
	// evidence HAD when it was observed — not the identity the file has
	// now.
	let binding: SourceRevisionBinding = {
		state: "UNBOUND",
		reason: "no_acquisition_ledger",
	};
	const acquisitions = options.acquisitions;
	if (acquisitions) {
		binding = await bindSourceRevision({
			resolvedEvidence,
			ledger,
			acquisitions,
		});
	}
	const sourceRevisionBound =
		binding.state === "BOUND" && binding.revision !== undefined;

	// --- THE COMPOSED DECISION -------------------------------------
	// Every gate reports its OWN truth. The candidate is accepted only
	// when EVERY gate passed; a failure in one gate never misreports
	// another.
	if (!canonicalRefsResolved) {
		return {
			...baseAcceptance(),
			schema_valid: true,
			canonical_refs_resolved: false,
			source_revision_bound: sourceRevisionBound,
			candidate_accepted: false,
			reason:
				unresolvedReferences.length > 0
					? `unresolvable_tool_reference:${unresolvedReferences[0]}`
					: `unpaired_or_failed_tool_reference:${unpairedReference ?? "unknown"}`,
			resolvedEvidenceToolUseIds: resolvedEvidence,
			...(binding.revision ? { sourceRevision: binding.revision } : {}),
		};
	}
	if (!sourceRevisionBound) {
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
 * ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-IMPLEMENT-01-CORRECTION01.
 *
 * THE REPAIR: THIS FUNCTION NO LONGER RESOLVES ANYTHING.
 *
 * The predecessor called `resolver.resolve({ sourcePath, toolName })` here,
 * which established what the file looks like AT EVALUATION TIME. The
 * candidate's evidence, however, was observed EARLIER, and the file may
 * have changed in between. The bound revision was therefore frequently
 * WRONG, and the defect was silent: a candidate citing an earlier read was
 * accepted with the LATER file's identity.
 *
 * The binding now reads the ACQUISITION-TIME record the runtime captured
 * when the evidence was observed. The workspace is never consulted at
 * evaluation time, so "what did this evidence refer to?" is answered by the
 * record of the observation, not by a guess about the present.
 *
 * The binding is `BOUND` only when EVERY cited source resolved to the SAME
 * acquisition-time revision. Two sources observed at two different
 * revisions describe a state of the world that never existed, so the
 * candidate is `STALE` rather than `BOUND`.
 */
async function bindSourceRevision(input: {
	resolvedEvidence: readonly string[];
	ledger: CanonicalEvidenceLedger;
	acquisitions: AcquisitionEvidenceLedger;
}): Promise<SourceRevisionBinding> {
	if (input.resolvedEvidence.length === 0) {
		return { state: "UNBOUND", reason: "no_evidence_to_bind" };
	}
	const revisions: SourceRevision[] = [];
	for (const toolUseId of input.resolvedEvidence) {
		const record = input.acquisitions.records.get(toolUseId);
		if (!record) {
			// No acquisition-time record: the runtime never observed this
			// evidence's source identity. It is UNBOUND, not guessed.
			return {
				state: "UNBOUND",
				reason: `no_acquisition_record:${toolUseId}`,
			};
		}
		if (record.sourcePaths.length === 0) {
			return {
				state: "UNBOUND",
				reason: `evidence_has_no_source_identity:${toolUseId}`,
			};
		}
		// ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-IMPLEMENT-01-CORRECTION01
		// (P1): the CONTENT identity of every observed source must be
		// present. A source whose content identity is missing describes a
		// file whose bytes were never pinned, so it establishes nothing.
		for (const path of record.sourcePaths) {
			if (!record.contentIdentities.get(path)) {
				return {
					state: "UNBOUND",
					reason: `missing_content_identity:${toolUseId}:${path}`,
				};
			}
		}
		revisions.push(record.revision);
	}
	const first = revisions[0];
	if (!first) {
		return { state: "UNBOUND", reason: "no_evidence_to_bind" };
	}
	// ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-IMPLEMENT-01-CORRECTION01
	// (P1): COMPATIBILITY is decided by the WORKSPACE identity — the
	// repository, the workspace root and the revision — and NOT by the
	// content identity.
	//
	// The content identity describes an INDIVIDUAL FILE, so two different
	// files read at the same repository revision normally have DIFFERENT
	// content hashes. Requiring them to agree would reject a candidate
	// that cites two valid reads from two different files of the same
	// repository state — a state that really existed.
	//
	// The content identity is validated per source, above, where it
	// belongs: each observed source must have its own pinned identity.
	for (const revision of revisions) {
		if (
			revision.revision !== first.revision ||
			revision.repositoryIdentity !== first.repositoryIdentity ||
			revision.workspaceRootIdentity !== first.workspaceRootIdentity
		) {
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
 *
 * ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-IMPLEMENT-01-CORRECTION01:
 * this function is RETAINED for the tool-call-argument shape only. It is
 * NO LONGER the authority for a candidate's source identity: the
 * authority is the ACQUISITION record (see
 * {@link AcquisitionEvidenceLedger}), which is derived from what the tool
 * RESULT actually reported. See {@link extractAcquiredSourcePaths}.
 */
export function extractSourcePath(
	input: Record<string, unknown>,
): string | undefined {
	const candidates = [input.path, input.file_path, input.filePath, input.file];
	for (const candidate of candidates) {
		if (typeof candidate === "string" && candidate.trim().length > 0) {
			return candidate.trim();
		}
	}
	// The real `read_files` tool accepts several shapes: a single `path`,
	// a `files` list, a `file_paths` list, and a `paths` list. Every entry
	// of every list is a source path, so the FIRST one names the source.
	for (const key of ["paths", "files", "file_paths"] as const) {
		const value = input[key];
		if (!Array.isArray(value)) {
			continue;
		}
		for (const candidate of value) {
			if (typeof candidate === "string" && candidate.trim().length > 0) {
				return candidate.trim();
			}
			if (candidate && typeof candidate === "object") {
				const path = (candidate as { path?: unknown }).path;
				if (typeof path === "string" && path.trim().length > 0) {
					return path.trim();
				}
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
		/**
		 * ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-IMPLEMENT-01-CORRECTION01.
		 *
		 * The acquisition-time evidence records. Without them no candidate
		 * can be bound, because the runtime cannot establish what the
		 * evidence referred to at the moment it was observed.
		 */
		readonly acquisitions?: AcquisitionEvidenceLedger;
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
			...(options.acquisitions ? { acquisitions: options.acquisitions } : {}),
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
	// ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-IMPLEMENT-01-CORRECTION03:
	// the TRUSTED ORIGIN of the trailer.
	//
	// The trailer is a LINE OF TEXT, and text is the untrusted side of the
	// boundary: a file the agent reads, a command's stdout or a tool's own
	// error message can all END with a line that looks exactly like this
	// one. So the handle is recorded in a DEDICATED FIELD on the block —
	// a field only the runtime writes, and which travels with the block
	// through the canonical history.
	//
	// The classifier then recognises the trailer by matching the line's
	// handle against THIS recorded handle. A forged line carries some other
	// handle, so it is not a trailer and it stays in the operation-payload
	// set, where its failure poisons the aggregate and its lack of a
	// success signal leaves the batch unverified.
	const content = block.content;
	if (typeof content === "string") {
		const stripped = stripEvidenceHandleTrailers(content, handle);
		return {
			...block,
			content: `${stripped}\n${trailer}`,
			evidenceHandle: handle,
		};
	}
	if (!Array.isArray(content)) {
		return block;
	}
	// ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-IMPLEMENT-01-CORRECTION04:
	// the annotation is a SEPARATE PAYLOAD, never coalesced with content.
	//
	// The previous implementation appended the trailer to the LAST EXISTING
	// TEXT PAYLOAD, which COALESCED trusted metadata with untrusted source
	// content. The classifier excludes the payload whose last line carries
	// the recorded handle — so a payload that held unverified tool output
	// became INVISIBLE to the success classifier merely because the
	// runtime appended its own legitimate trailer to it. The unverified
	// content was then promoted from "no signal" (batch UNVERIFIED) to
	// "excluded" (batch carried as a verified SUCCESS).
	//
	// The annotation is now appended as a PAYLOAD OF ITS OWN. The source
	// content is left byte-for-byte intact, so it stays in the
	// operation-payload set where its lack of an affirmative success
	// signal leaves the batch unverified, and its failure poisons the
	// aggregate.
	//
	// A PREVIOUS trailer is removed FIRST — both the trailer LINE inside a
	// text block and a trailer that was appended as its OWN text block.
	// Removing only the line would leave the empty block behind, and the
	// projection would not be idempotent.
	const withoutTrailerBlocks = content.filter(
		(part) => !isEvidenceHandleTrailerText(part, handle),
	);
	const cleaned = withoutTrailerBlocks.map((part) =>
		part.type === "text" && typeof part.text === "string"
			? { ...part, text: stripEvidenceHandleTrailers(part.text, handle) }
			: part,
	);
	return {
		...block,
		content: [...cleaned, { type: "text", text: trailer }],
		evidenceHandle: handle,
	};
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
	// ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-IMPLEMENT-01-CORRECTION03: the
	// TRUSTED ORIGIN of the trailer. The trailer is a line of TEXT, and
	// text is untrusted, so the handle is recorded in a dedicated field
	// the runtime owns. The codec persists it onto the canonical block.
	const output = part.output;
	if (typeof output === "string") {
		return {
			...part,
			output: `${stripEvidenceHandleTrailers(output, handle)}\n${trailer}`,
			evidenceHandle: handle,
		};
	}
	if (Array.isArray(output)) {
		// ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-IMPLEMENT-01-CORRECTION04:
		// the annotation is a SEPARATE PART, never coalesced with content.
		//
		// The previous implementation appended the trailer to the LAST EXISTING
		// TEXT PART, which coalesced trusted metadata with untrusted source
		// content and let the classifier's exclusion discard the unverified
		// content along with the annotation. The annotation is now appended
		// as a PART OF ITS OWN, so the source content stays intact and
		// visible to the success classifier.
		//
		// ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-IMPLEMENT-01-CORRECTION05:
		// a PREVIOUS annotation is removed FIRST, so the projection is
		// IDEMPOTENT — applying it twice yields byte-identical output
		// instead of accumulating a second annotation part.
		//
		// Only the runtime's OWN annotation is removed: a part that merely
		// resembles one is source content and is left alone.
		const withoutAnnotation = output.filter(
			(entry) => !isEvidenceHandleTrailerText(entry, handle),
		);
		const next = [...withoutAnnotation];
		next.push({ type: "text", text: trailer });
		return { ...part, output: next, evidenceHandle: handle };
	}
	return {
		...part,
		output: `${trailer}`,
		evidenceHandle: handle,
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
	];

	// The PER-FINDING rules are named explicitly, because a decision that
	// is authorized IN GENERAL can still be forbidden FOR A FINDING. A
	// candidate that uses a forbidden decision is rejected, and the model
	// can only avoid that if the rule is stated.
	const perFindingDecisions = Object.entries(
		vocabulary.allowedDecisionsByFinding ?? {},
	);
	if (perFindingDecisions.length > 0) {
		lines.push("Permitted decisions, per finding:");
		for (const [findingId, decisions] of perFindingDecisions) {
			lines.push(`  ${findingId}: ${decisions.join(", ")}`);
		}
		lines.push("");
	}
	const perFindingQualifications = Object.entries(
		vocabulary.requiredQualificationsByFinding ?? {},
	);
	if (perFindingQualifications.length > 0) {
		lines.push("Required qualification codes, per finding:");
		for (const [findingId, codes] of perFindingQualifications) {
			lines.push(`  ${findingId}: ${codes.join(", ")}`);
		}
		lines.push("");
	}

	lines.push(
		"Rules:",
		"- Do NOT add any field other than the eight listed above.",
		"- Do NOT include file contents, excerpts, prose or explanations in",
		"  the JSON.",
		"- Use a decision that is PERMITTED for the finding you are",
		"  adjudicating, and include every REQUIRED qualification code for",
		"  that finding.",
		"- Cite evidence by the EVIDENCE HANDLE shown on the tool result.",
		"  Do NOT invent a handle, and do NOT cite a tool name.",
		"- Publish only when you have at least one evidence handle.",
		"- Publishing is OPTIONAL. If you are not confident, do not publish.",
		"  A missing candidate is a normal outcome.",
		"- After publishing, continue working normally.",
		ADJUDICATION_INSTRUCTION_END_MARKER,
	);
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
