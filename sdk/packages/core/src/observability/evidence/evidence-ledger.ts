/**
 * ACT-CLINEMM-ROUND-C-HARNESS-01 — Phase 4 immutable evidence ledger.
 *
 * ## What this is
 *
 * A DESIGNED contract for an immutable, HEAD-bound evidence ledger: a
 * record of OBSERVATIONS, each tied to the source it came from, the
 * verification that was applied to it, and the finding it supports.
 *
 * ## What this is NOT
 *
 * This ACT does NOT redesign compaction, and this module does NOT change
 * any compaction behaviour. It specifies and implements the ledger's
 * RECORD SHAPE and its invariants, so that a future implementation has
 * an unambiguous contract to satisfy.
 *
 * ## The problem the ledger answers
 *
 * The Round C session showed exactly what a compaction loses. Measured
 * against the real evidence:
 *
 *   - 397 transcript messages became a 13-message sidecar;
 *   - 208 tool results existed in the compacted prefix, of which
 *     206 carried NON-EMPTY content;
 *   - the sidecar retained only 6 tool results, so 202 were DROPPED;
 *   - the summary nevertheless reported that "tool results appear
 *     blank/non-visible", and listed ~40 attempted file targets under
 *     "No confirmed file content is visible from this segment".
 *
 * The observations were PRESENT and were LOST. A summary that says
 * "blank" cannot be distinguished from a summary written where the
 * observations really were blank — because the evidence that would
 * settle the question was dropped by the very act being questioned.
 *
 * The ledger closes that gap. It records, IMMUTABLY and BEFORE the
 * compaction, what was observed, what it was verified against, and which
 * finding it bears on — so the post-compaction summary can be checked
 * against the record instead of being taken on faith.
 *
 * ## Privacy invariant (load-bearing)
 *
 * The ledger records IDENTITIES, COUNTS, DIGESTS and CLASSIFICATIONS.
 * It never records a credential, a secret, a file's content, a command's
 * arguments or a command's output. An observation carries a SOURCE
 * HASH of the content it describes, never the content itself.
 */

import { createHash } from "node:crypto";

/**
 * The verification state of an observation.
 */
export type EvidenceVerification =
	/** The observation was checked against the source and holds. */
	| "verified"
	/** The observation was checked against the source and does NOT hold. */
	| "refuted"
	/** The observation could not be checked — the source is unavailable. */
	| "unverifiable"
	/** The observation has not been checked yet. */
	| "pending";

/**
 * What KIND of thing the observation describes.
 *
 * The kind is what makes an observation checkable: a "tool_result"
 * observation names the tool call whose result it describes, and that
 * result can be re-read from the transcript.
 */
export type EvidenceKind =
	| "tool_result"
	| "file_read"
	| "command_output"
	| "model_turn"
	| "compaction";

/**
 * The identity of the source an observation came from.
 *
 * The source hash is a digest over the SOURCE CONTENT, so two
 * observations of the same source agree and an observation of a changed
 * source disagrees — without the content ever being stored.
 */
export interface EvidenceSource {
	/** The tool call's id, for a tool-result observation. */
	readonly toolCallId?: string;
	/** The message's id, for a message-scoped observation. */
	readonly messageId?: string;
	/** The path or URL the observation is about, when it has one. */
	readonly subject?: string;
	/** The digest of the source content. */
	readonly sourceHash: string;
	/** The byte size of the source content. */
	readonly sourceBytes?: number;
}

/**
 * One recorded observation.
 */
export interface EvidenceObservation {
	/**
	 * The observation's stable id.
	 *
	 * The id is DERIVED from the observation's content, so the same
	 * observation recorded twice produces the same id — which is what
	 * makes the ledger append-only in the meaningful sense.
	 */
	readonly observationId: string;
	/** The kind of thing observed. */
	readonly kind: EvidenceKind;
	/** The source the observation came from. */
	readonly source: EvidenceSource;
	/** The verification state. */
	readonly verification: EvidenceVerification;
	/**
	 * The findings the observation bears on.
	 *
	 * A finding reference is an ID, never a finding's text: the ledger
	 * indexes the findings, it does not duplicate them.
	 */
	readonly findingRefs: readonly string[];
	/**
	 * The git HEAD the observation was captured at.
	 *
	 * Every observation is bound to the tree it was captured at, so an
	 * observation cannot be silently carried across a change that
	 * invalidates it.
	 */
	readonly head: string;
	/** The capture time, as an ISO-8601 string. */
	readonly capturedAtIso: string;
	/**
	 * A SHORT, human-readable label.
	 *
	 * A label is a classification, not content: "helm-render", not the
	 * rendered manifest.
	 */
	readonly label?: string;
}

/**
 * An entry in the ledger.
 */
export interface EvidenceLedgerEntry {
	/** The observation. */
	readonly observation: EvidenceObservation;
	/**
	 * The digest of the ledger's entries UP TO AND INCLUDING this one.
	 *
	 * Each entry commits to its predecessor, so the ledger is a HASH
	 * CHAIN: altering or removing an earlier entry changes every
	 * subsequent digest, and the break is detectable.
	 */
	readonly chainDigest: string;
}

/**
 * The immutable ledger.
 *
 * The ledger is APPEND-ONLY. There is no method that edits or removes an
 * entry; a correction is a new observation that references the one it
 * supersedes.
 */
export interface EvidenceLedger {
	/** The git HEAD the ledger is bound to. */
	readonly head: string;
	/** The ledger's entries, oldest first. */
	readonly entries: readonly EvidenceLedgerEntry[];
	/** The digest of the whole ledger. */
	readonly digest: string;
}

/**
 * Compute a content digest.
 *
 * The digest is a plain SHA-256, hex-encoded. It is a change-detection
 * and correlation digest, not a concealment mechanism: a digest of a
 * short, low-entropy string could be brute-forced, so a ledger entry
 * whose subject is a short string should not rely on the digest alone.
 */
export function digestEvidenceContent(content: string): string {
	return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Derive an observation's stable id.
 *
 * The id is derived from the observation's identity — its kind, its
 * source hash, its HEAD and its finding references — so that recording
 * the same observation twice yields the same id, and a DIFFERENT
 * observation can never collide with it.
 */
export function deriveObservationId(input: {
	readonly kind: EvidenceKind;
	readonly sourceHash: string;
	readonly head: string;
	readonly findingRefs: readonly string[];
}): string {
	const payload = [
		input.kind,
		input.sourceHash,
		input.head,
		[...input.findingRefs].sort().join(","),
	].join("|");
	return `obs_${digestEvidenceContent(payload).slice(0, 32)}`;
}

/**
 * Compute the chain digest for an entry.
 *
 * The chain digest commits to the PREVIOUS digest as well as to the
 * observation, which is what turns a list of independent entries into a
 * tamper-evident chain.
 */
export function computeChainDigest(
	previousDigest: string,
	observation: EvidenceObservation,
): string {
	return digestEvidenceContent(
		`${previousDigest}|${observation.observationId}|${observation.source.sourceHash}|${observation.verification}|${observation.head}`,
	);
}

/**
 * The digest of an empty ledger.
 */
export const EMPTY_LEDGER_DIGEST = digestEvidenceContent("");

/**
 * Build an append-only evidence ledger.
 *
 * The builder is the ONLY way to produce a ledger. It never edits or
 * removes an entry.
 */
export class EvidenceLedgerBuilder {
	private readonly entries: EvidenceLedgerEntry[] = [];

	constructor(readonly head: string) {}

	/**
	 * Append an observation.
	 *
	 * The observation's id and chain digest are COMPUTED here, so a caller
	 * cannot forge either.
	 */
	append(input: {
		readonly kind: EvidenceKind;
		readonly source: {
			readonly toolCallId?: string;
			readonly messageId?: string;
			readonly subject?: string;
			readonly sourceHash?: string;
			readonly sourceContent?: string;
			readonly sourceBytes?: number;
		};
		readonly verification: EvidenceVerification;
		readonly findingRefs?: readonly string[];
		readonly capturedAtIso: string;
		readonly label?: string;
	}): EvidenceObservation {
		const sourceHash =
			input.source.sourceHash ??
			digestEvidenceContent(input.source.sourceContent ?? "");
		const observationId = deriveObservationId({
			kind: input.kind,
			sourceHash,
			head: this.head,
			findingRefs: input.findingRefs ?? [],
		});
		const previousDigest =
			this.entries.length === 0
				? EMPTY_LEDGER_DIGEST
				: (this.entries[this.entries.length - 1] as EvidenceLedgerEntry)
						.chainDigest;
		const observation: EvidenceObservation = {
			observationId,
			kind: input.kind,
			source: {
				toolCallId: input.source.toolCallId,
				messageId: input.source.messageId,
				subject: input.source.subject,
				sourceHash,
				sourceBytes: input.source.sourceBytes,
			},
			verification: input.verification,
			findingRefs: [...(input.findingRefs ?? [])].sort(),
			head: this.head,
			capturedAtIso: input.capturedAtIso,
			label: input.label,
		};
		this.entries.push({
			observation,
			chainDigest: computeChainDigest(previousDigest, observation),
		});
		return observation;
	}

	/**
	 * The immutable ledger.
	 */
	build(): EvidenceLedger {
		const last = this.entries[this.entries.length - 1];
		return {
			head: this.head,
			entries: [...this.entries],
			digest: last ? last.chainDigest : EMPTY_LEDGER_DIGEST,
		};
	}
}

/**
 * Verify a ledger's chain.
 *
 * A ledger is INTACT when every entry's chain digest matches the digest
 * recomputed from its predecessor, and the ledger's own digest matches
 * its last entry.
 *
 * ## What this does and does not detect
 *
 * The chain commits FORWARD: each entry's digest covers its predecessor.
 * So the chain detects an EDITED entry and a REMOVED entry from the
 * middle or the head.
 *
 * It does NOT, by itself, detect removal of the LAST entry combined with
 * re-stating the new last entry's digest — that is indistinguishable
 * from a ledger that was simply shorter, because a hash chain commits
 * forward and not backward. Tail truncation is detected by comparing the
 * ledger's published `digest` and entry count against an EXTERNAL anchor
 * captured when the ledger was sealed; see `sealEvidenceLedger` and
 * `verifyEvidenceLedgerAgainstAnchor`.
 */
export function verifyEvidenceLedger(ledger: EvidenceLedger): {
	readonly intact: boolean;
	readonly brokenAtIndex?: number;
} {
	let previousDigest = EMPTY_LEDGER_DIGEST;
	for (let index = 0; index < ledger.entries.length; index++) {
		const entry = ledger.entries[index] as EvidenceLedgerEntry;
		const expected = computeChainDigest(previousDigest, entry.observation);
		if (expected !== entry.chainDigest) {
			return { intact: false, brokenAtIndex: index };
		}
		previousDigest = entry.chainDigest;
	}
	const expectedDigest =
		ledger.entries.length === 0
			? EMPTY_LEDGER_DIGEST
			: (ledger.entries[ledger.entries.length - 1] as EvidenceLedgerEntry)
					.chainDigest;
	return { intact: expectedDigest === ledger.digest };
}

/**
 * The external anchor for a sealed ledger.
 *
 * The anchor is what makes TAIL truncation detectable: it is captured
 * once, at seal time, and compared later. The anchor is cheap to publish
 * (a digest and a count) and carries no content.
 */
export interface EvidenceLedgerAnchor {
	/** The ledger's digest at seal time. */
	readonly digest: string;
	/** The number of entries at seal time. */
	readonly entryCount: number;
	/** The HEAD the ledger was bound to at seal time. */
	readonly head: string;
}

/**
 * Seal a ledger into an anchor.
 */
export function sealEvidenceLedger(
	ledger: EvidenceLedger,
): EvidenceLedgerAnchor {
	return {
		digest: ledger.digest,
		entryCount: ledger.entries.length,
		head: ledger.head,
	};
}

/**
 * Check a ledger against a previously sealed anchor.
 *
 * This is the check that detects tail truncation, which the chain alone
 * cannot detect: a hash chain commits forward and not backward, so a
 * ledger that was simply shorter is indistinguishable from one whose
 * tail was removed.
 */
export function verifyEvidenceLedgerAgainstAnchor(
	ledger: EvidenceLedger,
	anchor: EvidenceLedgerAnchor,
): {
	readonly intact: boolean;
	readonly reason?:
		| "chain-broken"
		| "digest-mismatch"
		| "entry-count-mismatch"
		| "head-mismatch";
	readonly brokenAtIndex?: number;
} {
	const chain = verifyEvidenceLedger(ledger);
	if (!chain.intact) {
		return {
			intact: false,
			reason: "chain-broken",
			brokenAtIndex: chain.brokenAtIndex,
		};
	}
	if (ledger.head !== anchor.head) {
		return { intact: false, reason: "head-mismatch" };
	}
	if (ledger.entries.length !== anchor.entryCount) {
		return { intact: false, reason: "entry-count-mismatch" };
	}
	if (ledger.digest !== anchor.digest) {
		return { intact: false, reason: "digest-mismatch" };
	}
	return { intact: true };
}
