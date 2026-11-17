/**
 * ACT-CLINEMM-COMPACTION-TOKEN-EVIDENCE-CAPTURE01.
 *
 * PRIVATE, opt-in capture of the exact pre-compaction CLIENT DECISION
 * CANDIDATE.
 *
 * ## Why this exists
 *
 * The compaction DECISION records metadata: the estimated input tokens, the
 * trigger, the decision identity, the correlation keys. That is enough to
 * join a decision to a provider dispatch and to provider-reported usage —
 * but it is NOT enough to count the candidate independently. The candidate
 * itself (system prompt, API messages, tools, formatting-relevant options)
 * is never reconstructed from metadata, because the canonical history has
 * already moved on by the time anyone could read it.
 *
 * This module captures the candidate AT THE DECISION BOUNDARY, BEFORE any
 * compaction runs, so an independent tokenizer can count it later without
 * re-running the model.
 *
 * ## Privacy contract
 *
 * This capture is deliberately SEPARATE from the standard
 * "Cline Debug: Dump Latency Trace" output, which stays metadata-only and
 * shareable.
 *
 * The private capture:
 *
 *   - requires a SEPARATE, EXPLICIT diagnostic opt-in;
 *   - is available only in an isolated dogfood runtime;
 *   - NEVER enters normal logs, diagnostics exports, incident bundles or
 *     Git;
 *   - is written to an explicitly PRIVATE diagnostic directory;
 *   - uses restrictive file permissions (0600 files, 0700 directory on
 *     POSIX);
 *   - is bounded in COUNT and in TOTAL BYTES;
 *   - reports truncation EXPLICITLY, and a truncated candidate is ineligible
 *     for exact counting;
 *   - is explicitly removable after qualification;
 *   - is NEVER printed to a terminal or included in a support export.
 *
 * ## Conservation
 *
 * When the capture is OFF, this module performs NO directory creation, NO
 * serialization and NO filesystem write. The decision seam calls it only
 * when the opt-in is armed AND the sink is armed.
 */

import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sha256HexSync } from "@cline/shared";

/**
 * The environment variable that arms the PRIVATE candidate capture.
 *
 * It is SEPARATE from the standard latency/trace opt-in on purpose: an
 * operator who enabled the shareable metadata trace must not silently start
 * retaining full request bodies.
 *
 * The value must be exactly `"1"` to arm the capture. Any other value — or
 * an absent variable — leaves the capture disarmed.
 */
export const COMPACTION_CANDIDATE_CAPTURE_ENV_VAR =
	"CLINE_PRIVATE_COMPACTION_CANDIDATE_CAPTURE";

/**
 * The maximum number of candidates retained by the capture.
 *
 * The retention policy prefers ONE immediately preceding non-compacting
 * candidate (the control) and up to SIX actual compaction candidates. The
 * hard cap bounds the directory regardless of traffic.
 *
 * ## The cap is a TOTAL
 *
 * The cap counts the CONTROL and the COMPACTION candidates TOGETHER: the
 * directory never holds more than `COMPACTION_CANDIDATE_CAPTURE_MAX_CANDIDATES`
 * candidate files, whatever the mix. The control does not get a separate
 * allowance, because an extra control slot would make the declared maximum
 * a fiction — the directory would hold 13 files while the constant said 12.
 */
export const COMPACTION_CANDIDATE_CAPTURE_MAX_CANDIDATES = 12;

/**
 * The maximum TOTAL bytes the capture may write.
 *
 * A candidate that would exceed the budget is NOT written in full: it is
 * recorded as a TRUNCATED receipt, and a truncated candidate is ineligible
 * for exact counting.
 */
export const COMPACTION_CANDIDATE_CAPTURE_MAX_BYTES = 64 * 1024 * 1024;

/**
 * The maximum size of a single candidate payload.
 *
 * A single candidate larger than this is truncated. Truncation is reported
 * explicitly so a consumer never mistakes a truncated candidate for a
 * complete one.
 */
export const COMPACTION_CANDIDATE_CAPTURE_MAX_CANDIDATE_BYTES = 8 * 1024 * 1024;

/**
 * The environment variable that carries the closed-runtime dogfood identity.
 *
 * This is the SAME marker the dogfood diagnostic profile already consumes
 * (see `apps/vscode/src/sdk/dogfood-runtime-profile.ts`). The private
 * candidate capture REUSES it rather than inventing a second profile bit:
 * the capture is only ever armed inside the isolated dogfood runtime.
 *
 * The value must be EXACTLY `"dogfood"`. Anything else — including an
 * absent variable — leaves the capture disarmed (fail-closed).
 */
export const COMPACTION_CANDIDATE_CAPTURE_PROFILE_ENV_VAR =
	"CLINEMM_RUNTIME_PROFILE" as const;

/**
 * The dogfood profile marker value.
 */
export const COMPACTION_CANDIDATE_CAPTURE_PROFILE_VALUE = "dogfood" as const;

/**
 * Whether the private capture is armed in this process.
 *
 * The capture is armed ONLY when BOTH of the following hold:
 *
 *   1. the SEPARATE, EXPLICIT private-capture opt-in is set to exactly
 *      `"1"`; AND
 *   2. the closed-runtime dogfood identity is present and EXACTLY
 *      `"dogfood"`.
 *
 * Both conditions are REQUIRED (fail-closed). The dogfood identity is the
 * established runtime profile bit: a regular/public profile can never arm
 * this capture, no matter how the environment is set, because the profile
 * marker is launcher-owned and exact-match only.
 *
 * Reading the environment is the ONLY thing this function does; it creates
 * nothing and writes nothing.
 */
export function isCompactionCandidateCaptureArmed(
	env: Record<string, string | undefined> = process.env,
): boolean {
	if (env[COMPACTION_CANDIDATE_CAPTURE_ENV_VAR] !== "1") {
		return false;
	}
	return (
		env[COMPACTION_CANDIDATE_CAPTURE_PROFILE_ENV_VAR] ===
		COMPACTION_CANDIDATE_CAPTURE_PROFILE_VALUE
	);
}

/**
 * The environment variables that establish the ISOLATED storage root of
 * the dogfood runtime.
 *
 * These are the SAME variables the shared file-backed storage resolves its
 * data directory from. The private capture deliberately has NO implicit
 * `~/.cline/data` fallback: a capture that lands in the shared default
 * data directory is not provably inside the isolated dogfood profile, and
 * it may contain the operator's real credentials and prompts.
 *
 * The capture therefore FAILS CLOSED when neither variable is set: no
 * directory is resolved, no capture is written.
 */
export const COMPACTION_CANDIDATE_CAPTURE_DATA_DIR_ENV_VARS = [
	"CLINE_DATA_DIR",
	"CLINE_DIR",
] as const;

/**
 * Resolve the isolated storage root for the private capture, or `undefined`
 * when no explicit root is configured.
 *
 * Returns the RESOLVED root (absolute), never a fallback:
 *
 *   - `CLINE_DATA_DIR` wins outright when set;
 *   - otherwise `CLINE_DIR` yields `<CLINE_DIR>/data`;
 *   - otherwise `undefined` — the capture is NOT armed.
 *
 * Pure / synchronous / no I/O.
 */
export function resolveCompactionCandidateCaptureStorageRoot(
	env: Record<string, string | undefined> = process.env,
): string | undefined {
	const dataDir = env.CLINE_DATA_DIR?.trim();
	if (dataDir) {
		return dataDir;
	}
	const clineDir = env.CLINE_DIR?.trim();
	if (clineDir) {
		return join(clineDir, "data");
	}
	return undefined;
}

/**
 * The exact client-decision candidate, captured at the decision boundary.
 *
 * The shape mirrors the inputs the compaction decision actually measured:
 * the system prompt, the API-visible messages in order, the tool inventory
 * in order, and the model/request options that affect formatting.
 *
 * NOTHING here is mutated: the capture is a deep-copied, frozen view of
 * what the decision measured.
 */
export interface CompactionCandidateSnapshot {
	/** The system prompt the decision measured. */
	readonly systemPrompt: string;
	/** The API-visible messages, in order. */
	readonly apiMessages: readonly unknown[];
	/** The tool inventory, in order. */
	readonly tools: readonly unknown[];
	/** The formatting-relevant model / request options. */
	readonly options: Readonly<Record<string, unknown>>;
	/** The model id the decision measured. */
	readonly modelId?: string;
	/** The provider id the decision measured. */
	readonly providerId?: string;
	/** The PREPARATION request identity. */
	readonly preparationRequestId?: string;
	/** The DECISION identity. */
	readonly decisionId?: string;
}

/**
 * The metadata-only receipt for a captured candidate.
 *
 * This is the ONLY shape that may ever leave the private directory. It
 * carries hashes, sizes and classifications — never content.
 */
export interface CompactionCandidateCaptureReceipt {
	/** The kind marker. */
	readonly kind: "compaction_candidate";
	/** The opaque request identity. */
	readonly requestIdentity: string;
	/** The representation of the captured content. */
	readonly representation: string;
	/** Whether the snapshot is COMPLETE (and therefore exactly countable). */
	readonly snapshotComplete: boolean;
	/** The SHA-256 of the captured content. */
	readonly contentFingerprint: string;
	/** The estimated input tokens at the decision. */
	readonly estimatedInputTokens?: number;
	/** The trigger tokens at the decision. */
	readonly requestTriggerTokens?: number;
	/** The provider-reported input tokens, when the candidate was submitted. */
	readonly providerInputTokens: number | null;
	/** The authority of the provider-reported token count. */
	readonly providerInputAuthority: string;
	/** Whether the candidate triggered a compaction. */
	readonly compactionInitiated: boolean;
	/** The decision identity. */
	readonly decisionId?: string;
	/** The preparation request identity. */
	readonly preparationRequestId?: string;
	/** The byte size of the captured payload. */
	readonly payloadBytes: number;
	/** Whether the payload was truncated. */
	readonly truncated: boolean;
	/** The explicit truncation reason, when truncated. */
	readonly truncationReason?: string;
}

/**
 * The OPTION KEYS that may ever be captured.
 *
 * The filter is an ALLOWLIST: an unknown key is DROPPED, never passed
 * through. That makes it impossible for a new option — or a credential —
 * to leak into the private capture by default.
 *
 * The same allowlist is applied BOTH by the compaction seam (which builds
 * the candidate) and by the capture store (which writes it). The store's
 * copy is the DEFENCE IN DEPTH: even a caller that forgot to filter
 * cannot write a credential.
 */
const CAPTURE_ALLOWED_OPTION_KEYS = new Set([
	"thinking",
	"reasoningEffort",
	"reasoning",
	"maxOutputTokens",
	"maxTokens",
	"temperature",
	"topP",
	"topK",
	"toolChoice",
	"parallelToolCalls",
	"stream",
	"includeReasoning",
	"reasoningBudgetTokens",
	"thinkingBudgetTokens",
]);

/**
 * Filter the request options down to the formatting-relevant, non-secret
 * subset that may be captured.
 *
 * The filter is an ALLOWLIST: a key that is not explicitly known to be
 * formatting-relevant is DROPPED. An unknown key (or a credential) can
 * therefore never reach the private capture.
 */
export function filterCapturableRequestOptions(
	options: Readonly<Record<string, unknown>> | undefined,
): Record<string, unknown> {
	if (!options) {
		return {};
	}
	const filtered: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(options)) {
		if (!CAPTURE_ALLOWED_OPTION_KEYS.has(key)) {
			continue;
		}
		if (
			typeof value === "string" ||
			typeof value === "number" ||
			typeof value === "boolean" ||
			value === null
		) {
			filtered[key] = value;
			continue;
		}
		if (Array.isArray(value)) {
			filtered[key] = value.filter(
				(item) =>
					typeof item === "string" ||
					typeof item === "number" ||
					typeof item === "boolean" ||
					item === null,
			);
		}
	}
	return filtered;
}

/**
 * Deep-copy and freeze a candidate snapshot.
 *
 * The store serializes the snapshot LATER (during `flush()`), which is
 * after at least one asynchronous boundary. Retaining the caller's object
 * references would mean a mutation of the live request objects in between
 * could change what the "exact" snapshot represents — the fingerprint would
 * then identify a representation that was never the one that was captured.
 *
 * The copy is STRUCTURAL: objects and arrays are recreated and frozen, and
 * primitives are copied by value. A `Map`/`Set` is converted to a plain
 * array of entries, which is what the JSON representation carries anyway.
 */
function freezeCandidateSnapshot(
	candidate: CompactionCandidateSnapshot,
): CompactionCandidateSnapshot {
	return Object.freeze({
		systemPrompt: candidate.systemPrompt,
		apiMessages: freezeValue(candidate.apiMessages) as readonly unknown[],
		tools: freezeValue(candidate.tools) as readonly unknown[],
		options: Object.freeze({ ...candidate.options }),
		modelId: candidate.modelId,
		providerId: candidate.providerId,
		preparationRequestId: candidate.preparationRequestId,
		decisionId: candidate.decisionId,
	});
}

/**
 * Recursively copy and freeze an arbitrary JSON-shaped value.
 */
function freezeValue(value: unknown): unknown {
	if (Array.isArray(value)) {
		return Object.freeze(value.map((item) => freezeValue(item)));
	}
	if (value instanceof Map) {
		return Object.freeze(
			[...value.entries()].map(([key, item]) => [
				freezeValue(key),
				freezeValue(item),
			]),
		);
	}
	if (value instanceof Set) {
		return Object.freeze([...value.values()].map((item) => freezeValue(item)));
	}
	if (value !== null && typeof value === "object") {
		const copy: Record<string, unknown> = {};
		for (const [key, item] of Object.entries(value)) {
			copy[key] = freezeValue(item);
		}
		return Object.freeze(copy);
	}
	return value;
}

/**
 * Resolve the PER-DECISION storage identity of a captured candidate.
 *
 * ## Why the content fingerprint is not enough
 *
 * The content fingerprint identifies WHAT was measured (the system prompt,
 * the API messages, the tools, the formatting-relevant options). It does
 * NOT identify WHICH decision measured it. Two distinct eligibility
 * decisions can measure byte-identical content — for example, the same
 * conversation retried after a transient failure, or two sessions that
 * converge on the same request.
 *
 * Deriving the capture file name from the content fingerprint ALONE
 * therefore collapses those two decisions onto ONE file: the second write
 * silently OVERWRITES the first decision's snapshot, and the first decision
 * is lost from the evidence.
 *
 * The storage identity is the DECISION's own identity — its `decisionId`
 * (the per-session decision ordinal) or, failing that, its
 * `preparationRequestId` (the request preparation identity). Together with
 * the content fingerprint it makes the file name a per-DECISION identity:
 * distinct decisions never collapse, and the content fingerprint still
 * describes exactly what was measured.
 *
 * The identity is sanitized to a filesystem-safe token and shortened, so it
 * can be embedded in a file name without escaping the capture directory.
 */
function resolveCaptureStorageIdentity(
	candidate: CompactionCandidateSnapshot,
): string {
	const raw =
		candidate.decisionId?.trim() ||
		candidate.preparationRequestId?.trim() ||
		"";
	if (!raw) {
		// No identity at all: fall back to a CONSTANT token. The content
		// fingerprint still distinguishes different content; two candidates
		// with BOTH identical content AND no identity are genuinely
		// indistinguishable observations and must not silently overwrite
		// one another, so the caller disambiguates with an ordinal.
		return "unidentified";
	}
	// Filesystem-safe: keep only characters that are safe in a POSIX file
	// name on every supported platform.
	const safe = raw.replace(/[^A-Za-z0-9._-]/g, "_");
	// Bound the length so a pathological identity cannot blow up the file
	// name. The suffix is a short hash of the FULL identity, so two
	// identities that sanitize to the same token still differ.
	const digest = sha256HexSync(raw).slice(0, 12);
	return `${safe.slice(0, 48)}-${digest}`;
}

/**
 * Resolve the capture file name for a candidate.
 *
 * The name combines the DECISION's storage identity with the CONTENT
 * fingerprint:
 *
 *   `<storage identity>--<content fingerprint>.json`
 *
 * The content fingerprint alone is NOT a sufficient identity: two distinct
 * decisions can measure byte-identical content, and naming both files after
 * the content would make the second write silently overwrite the first
 * decision's snapshot.
 *
 * A candidate that carries NEITHER a decision identity NOR a preparation
 * request identity has no natural storage identity. Such a candidate is
 * given a MONOTONIC ordinal when it is recorded, so it still gets its own
 * file: the capture must never silently drop an observation just because
 * the caller did not supply an identity.
 */
function resolveCaptureFileName(
	storageIdentity: string,
	receipt: CompactionCandidateCaptureReceipt,
): string {
	return `${storageIdentity}--${receipt.contentFingerprint}.json`;
}

/**
 * A retained candidate together with the PER-DECISION storage identity it
 * was assigned when it was recorded.
 *
 * The identity is resolved AT RECORD TIME, not at flush time, so a
 * candidate's file name is STABLE for its whole lifetime: repeated flushes
 * of the same candidate address the same file, and a candidate is never
 * re-identified between two flushes.
 */
interface RetainedCandidate {
	readonly snapshot: CompactionCandidateSnapshot;
	/** The per-decision storage identity (the file-name prefix). */
	readonly storageIdentity: string;
}

/**
 * The private capture store.
 *
 * It owns the private directory, the retention policy and the byte budget.
 * It never reads a value back into the runtime: the capture is strictly
 * one-way, so it cannot influence the request, the dispatch or the run.
 */
export class CompactionCandidateCaptureStore {
	private readonly directory: string;
	/**
	 * The files this store currently owns on disk, mapped to their byte
	 * size.
	 *
	 * The map is the STORE'S OWN record of the directory contents. It is
	 * what makes the byte budget an ACTUAL on-disk budget rather than an
	 * accounting fiction: every byte counted here corresponds to a file
	 * that exists, and every file this store wrote is tracked here so it
	 * can be removed when it is superseded.
	 */
	private readonly writtenFiles = new Map<string, number>();
	/**
	 * The serialized payload this store already wrote for each file.
	 *
	 * It is what makes a flush IDEMPOTENT: a candidate whose serialized
	 * bytes have not changed is NOT rewritten. Rewriting an unchanged file
	 * on every flush would churn the directory for no reason, and would
	 * needlessly re-expose the private payload to the filesystem.
	 */
	private readonly writtenPayloads = new Map<string, string>();
	/** The most recent non-compacting candidate (the control). */
	private controlCandidate: RetainedCandidate | undefined;
	/** The actual compaction candidates, newest last. */
	private compactionCandidates: RetainedCandidate[] = [];
	/**
	 * The tail of the flush chain.
	 *
	 * Every `flush()` is appended to this chain, so two OVERLAPPING
	 * flushes run one after the other instead of interleaving. Node
	 * explicitly warns against overlapping `writeFile()` calls to the same
	 * file: the writes can interleave and produce a corrupt file. The
	 * capture is private diagnostic evidence, so a corrupt capture is
	 * worse than a slightly delayed one.
	 */
	private flushChain: Promise<unknown> = Promise.resolve();
	/**
	 * A monotonic counter used to disambiguate candidates that carry NEITHER
	 * a decision identity NOR a preparation request identity.
	 *
	 * Without it, two such candidates with identical content would resolve
	 * to the same storage identity and the second would overwrite the first.
	 */
	private unidentifiedSequence = 0;

	constructor(directory: string) {
		this.directory = directory;
	}

	/**
	 * The private directory the capture writes to.
	 */
	getDirectory(): string {
		return this.directory;
	}

	/**
	 * The number of bytes this store currently owns on disk.
	 *
	 * This is the ACTUAL on-disk total for the files this store wrote — not
	 * a running total of write attempts. A superseded file is removed and
	 * its bytes are subtracted, so the number always describes the
	 * directory.
	 */
	getWrittenBytes(): number {
		let total = 0;
		for (const size of this.writtenFiles.values()) {
			total += size;
		}
		return total;
	}

	/**
	 * The number of candidate files this store currently owns on disk.
	 */
	getWrittenCount(): number {
		return this.writtenFiles.size;
	}

	/**
	 * The names of the candidate files this store currently owns.
	 */
	writtenFileNames(): readonly string[] {
		return [...this.writtenFiles.keys()];
	}

	/**
	 * Record a candidate.
	 *
	 * `compactionInitiated` distinguishes the CONTROL candidate (the most
	 * recent request that did NOT trigger compaction) from the ACTUAL
	 * compaction candidates. Only the immediately preceding control is
	 * retained; older controls are discarded.
	 *
	 * The candidate is IMMUTABLE-IZED HERE, before the first asynchronous
	 * boundary: it is deep-copied and frozen. The store serializes it
	 * later, during `flush()`, and a mutation of the caller's objects in
	 * between would otherwise change what the "exact" snapshot represents.
	 *
	 * ## The retention cap is enforced HERE, on the TOTAL
	 *
	 * The cap counts the CONTROL and the COMPACTION candidates TOGETHER.
	 * A control does NOT get a slot on top of the cap: otherwise the
	 * directory would hold `MAX + 1` files while the declared maximum said
	 * `MAX`. When a new candidate would overflow the total, the OLDEST
	 * compaction candidate is evicted first — the control is the most
	 * valuable single observation (it is the immediately preceding
	 * non-compacting request) and is only evicted when there is nothing
	 * older left to drop.
	 */
	record(
		candidate: CompactionCandidateSnapshot,
		compactionInitiated: boolean,
	): void {
		const snapshot = freezeCandidateSnapshot(candidate);
		// The per-decision storage identity is resolved ONCE, here, so the
		// candidate's file name is stable across every subsequent flush.
		const identity = resolveCaptureStorageIdentity(snapshot);
		const storageIdentity =
			identity === "unidentified"
				? `${identity}-${this.unidentifiedSequence++}`
				: identity;
		const retained: RetainedCandidate = { snapshot, storageIdentity };
		if (compactionInitiated) {
			this.compactionCandidates.push(retained);
		} else {
			// Only the MOST RECENT control is retained.
			this.controlCandidate = retained;
		}
		this.enforceRetentionCap();
	}

	/**
	 * Enforce the TOTAL retention cap.
	 *
	 * The CONTROL and the COMPACTION candidates share ONE budget of
	 * `COMPACTION_CANDIDATE_CAPTURE_MAX_CANDIDATES` slots. The oldest
	 * compaction candidate is evicted first; the control is evicted only
	 * when it is the only remaining candidate beyond the cap.
	 */
	private enforceRetentionCap(): void {
		while (
			this.totalRetainedCount() > COMPACTION_CANDIDATE_CAPTURE_MAX_CANDIDATES
		) {
			if (this.compactionCandidates.length > 0) {
				this.compactionCandidates.shift();
				continue;
			}
			// Only the control is left over the cap.
			this.controlCandidate = undefined;
		}
	}

	/**
	 * The TOTAL number of retained candidates (control + compaction).
	 */
	private totalRetainedCount(): number {
		return (this.controlCandidate ? 1 : 0) + this.compactionCandidates.length;
	}

	/**
	 * The retained candidates, oldest first: the control first, then the
	 * compaction candidates.
	 */
	retainedCandidates(): readonly CompactionCandidateSnapshot[] {
		return this.retainedEntries().map((entry) => entry.snapshot);
	}

	/**
	 * The retained candidates WITH their storage identities, oldest first:
	 * the control first, then the compaction candidates.
	 */
	private retainedEntries(): readonly RetainedCandidate[] {
		return [
			...(this.controlCandidate ? [this.controlCandidate] : []),
			...this.compactionCandidates,
		];
	}

	/**
	 * Write the retained candidates to the private directory.
	 *
	 * The write is BOUNDED — and the bound is enforced ON THE WRITE, not
	 * merely reported afterwards:
	 *
	 *   - a candidate whose serialized payload exceeds the per-candidate
	 *     byte budget is REJECTED BEFORE any byte is written, and is
	 *     reported as a metadata-only rejection receipt;
	 *   - a candidate that would push the store past the total byte budget
	 *     is likewise rejected before the write;
	 *   - a candidate that is no longer retained (superseded control, or a
	 *     compaction candidate beyond the retention cap) has its file
	 *     REMOVED from disk, so the in-memory retention cap is also an
	 *     on-disk file cap.
	 *
	 * A rejected candidate is marked `snapshotComplete: false` and
	 * `truncated: true`, so it is ineligible for exact counting.
	 *
	 * The write is FAILURE-ISOLATED at the call site: a write failure never
	 * changes the runtime's behaviour.
	 *
	 * ## Serialization
	 *
	 * Overlapping `flush()` calls are CHAINED: the second flush starts only
	 * after the first has completed. Node explicitly warns against
	 * overlapping `writeFile()` calls to the same file — the writes can
	 * interleave and leave a corrupt file behind. The capture is private
	 * diagnostic evidence, so a delayed flush is strictly better than a
	 * corrupt one.
	 *
	 * ## Idempotence
	 *
	 * A candidate whose serialized payload is byte-identical to the payload
	 * already on disk is NOT rewritten. The capture therefore does not churn
	 * the directory on every flush, and a previously persisted snapshot is
	 * not needlessly re-exposed.
	 */
	flush(
		resolveReceipt: (
			candidate: CompactionCandidateSnapshot,
		) => Promise<CompactionCandidateCaptureReceipt>,
	): Promise<CompactionCandidateCaptureReceipt[]> {
		// Chain onto the tail so overlapping flushes run one after the
		// other. The chain MUST NOT break on a failure: a rejected flush
		// must not poison every subsequent flush.
		const run = this.flushChain.then(
			() => this.performFlush(resolveReceipt),
			() => this.performFlush(resolveReceipt),
		);
		this.flushChain = run.then(
			() => undefined,
			() => undefined,
		);
		return run;
	}

	/**
	 * The actual flush, executed on the serialized flush chain.
	 */
	private async performFlush(
		resolveReceipt: (
			candidate: CompactionCandidateSnapshot,
		) => Promise<CompactionCandidateCaptureReceipt>,
	): Promise<CompactionCandidateCaptureReceipt[]> {
		const candidates = this.retainedEntries();
		if (candidates.length === 0) {
			return [];
		}
		await mkdir(this.directory, { recursive: true, mode: 0o700 });
		// `mkdir`'s `mode` only applies to NEWLY CREATED directories: an
		// existing directory keeps whatever mode it had. Correct it
		// explicitly so a permissive pre-existing directory cannot retain
		// world-readable access.
		await chmod(this.directory, 0o700);
		// Remove the files this store owns that are no longer retained.
		//
		// The file name is derived from the RECEIPT's content fingerprint
		// AND the DECISION's storage identity, so the receipts are resolved
		// FIRST and the retained file names are computed from them. This
		// keeps the on-disk file set and the receipt set in exact agreement.
		const resolved = await Promise.all(
			candidates.map(async (entry) => ({
				entry,
				receipt: await resolveReceipt(entry.snapshot),
			})),
		);
		// The file name is a PER-DECISION identity: the content fingerprint
		// ALONE would collapse two distinct decisions that measured
		// byte-identical content onto one file, and the second write would
		// silently overwrite the first decision's snapshot.
		const fileNames = resolved.map(({ entry, receipt }) =>
			resolveCaptureFileName(entry.storageIdentity, receipt),
		);
		const retainedFileNames = new Set(fileNames);
		await this.removeSupersededFiles(retainedFileNames);
		const receipts: CompactionCandidateCaptureReceipt[] = [];
		for (const [index, { entry, receipt }] of resolved.entries()) {
			const fileName = fileNames[index]!;
			const candidate = entry.snapshot;
			// DEFENCE IN DEPTH: the option bag is filtered at the WRITE
			// boundary as well as at the producer. A caller that forgot to
			// filter still cannot write a credential.
			const safeCandidate: CompactionCandidateSnapshot = {
				...candidate,
				options: filterCapturableRequestOptions(candidate.options),
			};
			const serialized = JSON.stringify(
				{ kind: "compaction_candidate_snapshot", candidate: safeCandidate },
				null,
				2,
			);
			const payloadBytes = Buffer.byteLength(serialized, "utf8");
			const perCandidateExceeded =
				payloadBytes > COMPACTION_CANDIDATE_CAPTURE_MAX_CANDIDATE_BYTES;
			const totalExceeded =
				this.getWrittenBytes() + payloadBytes >
				COMPACTION_CANDIDATE_CAPTURE_MAX_BYTES;
			const truncated = perCandidateExceeded || totalExceeded;
			const finalReceipt: CompactionCandidateCaptureReceipt = truncated
				? {
						...receipt,
						snapshotComplete: false,
						truncated: true,
						truncationReason: perCandidateExceeded
							? "CANDIDATE_EXCEEDS_PER_CANDIDATE_BYTE_BUDGET"
							: "CANDIDATE_EXCEEDS_TOTAL_BYTE_BUDGET",
						payloadBytes,
					}
				: { ...receipt, payloadBytes };
			if (truncated) {
				// REJECT BEFORE WRITING. The oversized content is NOT
				// written to disk: the budget bounds the ACTUAL bytes on
				// disk, not merely the reported receipt.
				receipts.push(finalReceipt);
				continue;
			}
			const filePath = join(this.directory, fileName);
			// IDEMPOTENCE: an unchanged payload is NOT rewritten. The
			// previously persisted snapshot stays exactly as it was, and the
			// directory is not churned on every flush.
			if (this.writtenPayloads.get(fileName) !== serialized) {
				await writeFile(filePath, serialized, {
					encoding: "utf8",
					mode: 0o600,
				});
				// `writeFile`'s `mode` only applies to NEWLY CREATED files. An
				// existing file keeps its previous mode, so correct it
				// explicitly.
				await chmod(filePath, 0o600);
				this.writtenPayloads.set(fileName, serialized);
			}
			this.writtenFiles.set(fileName, payloadBytes);
			receipts.push(finalReceipt);
		}
		return receipts;
	}

	/**
	 * Remove the files this store owns that are no longer retained.
	 *
	 * Without this, the in-memory retention cap would NOT bound the
	 * directory: a superseded control and every compaction candidate beyond
	 * the cap would leave their file behind, so the directory would grow
	 * without limit while the store reported a bounded state.
	 */
	private async removeSupersededFiles(
		retainedFileNames: ReadonlySet<string>,
	): Promise<void> {
		const superseded: string[] = [];
		for (const fileName of this.writtenFiles.keys()) {
			if (!retainedFileNames.has(fileName)) {
				superseded.push(fileName);
			}
		}
		for (const fileName of superseded) {
			await rm(join(this.directory, fileName), { force: true });
			this.writtenFiles.delete(fileName);
			this.writtenPayloads.delete(fileName);
		}
	}

	/**
	 * Remove every captured candidate from the private directory.
	 *
	 * Qualification MUST be able to remove the private capture afterwards.
	 */
	async remove(): Promise<void> {
		await rm(this.directory, { recursive: true, force: true });
		this.writtenFiles.clear();
		this.writtenPayloads.clear();
		this.controlCandidate = undefined;
		this.compactionCandidates = [];
	}
}
