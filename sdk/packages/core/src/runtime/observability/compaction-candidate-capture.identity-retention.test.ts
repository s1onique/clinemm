/**
 * ACT-CLINEMM-COMPACTION-TOKEN-EVIDENCE-CAPTURE01.
 *
 * PRIVATE candidate capture: IDENTITY + RETENTION contract regressions.
 *
 * These witnesses run against the PRODUCTION `CompactionCandidateCaptureStore`
 * (not a re-implementation) and assert against the ACTUAL on-disk contents
 * of a temporary directory.
 *
 * Contract under test:
 *
 *   I1  A capture file is identified by the DECISION's storage identity
 *       ALONGSIDE the content fingerprint. Two DISTINCT decisions that share
 *       IDENTICAL content MUST NOT collapse onto one file: the second write
 *       must not overwrite the first decision's snapshot.
 *
 *   I2  The retention cap is a HARD cap on the TOTAL number of retained
 *       snapshots, counting the CONTROL candidate AND the compaction
 *       candidates together. `COMPACTION_CANDIDATE_CAPTURE_MAX_CANDIDATES`
 *       is the declared maximum, so the directory never holds more than
 *       that many candidate files.
 *
 *   I3  The reported byte/count state RECONCILES with the actual directory.
 *
 *   I4  Overlapping `flush()` calls are serialized: two concurrent flushes
 *       never interleave a write to the same file.
 */
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeCandidateContentFingerprint } from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	COMPACTION_CANDIDATE_CAPTURE_MAX_CANDIDATES,
	type CompactionCandidateCaptureReceipt,
	CompactionCandidateCaptureStore,
	type CompactionCandidateSnapshot,
} from "./compaction-candidate-capture";

/**
 * A candidate whose CONTENT is stable but whose decision identity varies.
 *
 * The `decisionId` / `preparationRequestId` are the per-decision identity;
 * the system prompt / messages / tools / options are the measured CONTENT.
 */
function makeCandidate(
	overrides: Partial<CompactionCandidateSnapshot> = {},
): CompactionCandidateSnapshot {
	return {
		systemPrompt: "identical system prompt",
		apiMessages: [{ role: "user", content: "identical message" }],
		tools: [{ name: "tool_a", inputSchema: { type: "object" } }],
		options: { thinking: false, temperature: 0.2 },
		modelId: "evidence-probe-model",
		providerId: "openai-compatible",
		...overrides,
	};
}

/**
 * A candidate with DISTINCT content, so each one gets its own content
 * fingerprint.
 *
 * The retention-cap witnesses must not be confounded by the identity
 * collision: each candidate here has a unique system prompt, so the ONLY
 * thing under test is the COUNT.
 */
function makeDistinctCandidate(index: number): CompactionCandidateSnapshot {
	return makeCandidate({
		systemPrompt: `distinct system prompt ${index}`,
		preparationRequestId: `req_compact_${index}`,
		decisionId: `session#1#${index}`,
	});
}

/**
 * A receipt whose content fingerprint is computed from the candidate's
 * CONTENT ONLY — exactly like the production seam does. Two candidates with
 * identical content therefore share a fingerprint, which is precisely the
 * collision the storage identity has to disambiguate.
 *
 * The fingerprint uses the PRODUCTION fingerprint primitive from
 * `@cline/shared`, so the witness exercises the same content identity the
 * runtime seam produces.
 */
async function makeReceipt(
	candidate: CompactionCandidateSnapshot,
): Promise<CompactionCandidateCaptureReceipt> {
	// The content-only fingerprint: system prompt + messages + tools + options.
	// It deliberately EXCLUDES the decision identity, mirroring the
	// production `computeCandidateContentFingerprint` call site.
	const contentFingerprint = computeCandidateContentFingerprint({
		systemPrompt: candidate.systemPrompt,
		apiMessages: candidate.apiMessages,
		tools: candidate.tools,
		options: candidate.options,
	}).fingerprint;
	return {
		kind: "compaction_candidate",
		requestIdentity:
			candidate.preparationRequestId ?? candidate.decisionId ?? "unknown",
		representation: "CLIENT_DECISION_CANDIDATE_EXACT",
		snapshotComplete: true,
		contentFingerprint,
		estimatedInputTokens: 1_234,
		requestTriggerTokens: 567,
		providerInputTokens: null,
		providerInputAuthority: "UNAVAILABLE_FROM_TRACE",
		compactionInitiated: true,
		decisionId: candidate.decisionId,
		preparationRequestId: candidate.preparationRequestId,
		payloadBytes: 0,
		truncated: false,
	};
}

/** The ACTUAL on-disk byte total of the capture directory. */
async function diskBytes(directory: string): Promise<number> {
	let total = 0;
	for (const file of await readdir(directory)) {
		total += (await stat(join(directory, file))).size;
	}
	return total;
}

describe("ACT-CLINEMM-COMPACTION-TOKEN-EVIDENCE-CAPTURE01 — capture identity and retention", () => {
	let directory: string;

	beforeEach(async () => {
		directory = await mkdtemp(join(tmpdir(), "cline-capture-identity-"));
	});

	afterEach(async () => {
		await rm(directory, { recursive: true, force: true });
	});

	it("I1: DISTINCT decisions with IDENTICAL content do NOT collapse onto one file", async () => {
		const store = new CompactionCandidateCaptureStore(directory);

		// Two DIFFERENT decisions, byte-identical CONTENT. The content
		// fingerprint is therefore identical for both.
		const first = makeCandidate({
			preparationRequestId: "req_A",
			decisionId: "session#1#0",
		});
		const second = makeCandidate({
			preparationRequestId: "req_B",
			decisionId: "session#1#1",
		});
		expect((await makeReceipt(first)).contentFingerprint).toBe(
			(await makeReceipt(second)).contentFingerprint,
		);

		store.record(first, true);
		await store.flush(makeReceipt);
		store.record(second, true);
		await store.flush(makeReceipt);

		// BOTH decisions survive on disk: two files, not one.
		const files = await readdir(directory);
		expect(files.length).toBe(2);
		expect(store.getWrittenCount()).toBe(2);

		// And each file carries its OWN decision's identity — the first
		// decision's snapshot was NOT overwritten by the second.
		const contents = await Promise.all(
			files.map((file) => readFile(join(directory, file), "utf8")),
		);
		expect(contents.some((raw) => raw.includes("req_A"))).toBe(true);
		expect(contents.some((raw) => raw.includes("req_B"))).toBe(true);
	});

	it("I2: the hard retention cap counts the CONTROL and the compaction candidates TOGETHER", async () => {
		const store = new CompactionCandidateCaptureStore(directory);

		// A control candidate plus the maximum number of compaction
		// candidates. The TOTAL must not exceed the declared maximum.
		// Each candidate has DISTINCT content, so the count is not confounded
		// by the identity collision.
		store.record(
			makeCandidate({
				systemPrompt: "distinct system prompt control",
				preparationRequestId: "req_control",
				decisionId: "session#1#control",
			}),
			false,
		);
		for (let i = 0; i < COMPACTION_CANDIDATE_CAPTURE_MAX_CANDIDATES; i++) {
			store.record(makeDistinctCandidate(i), true);
		}

		const receipts = await store.flush(makeReceipt);
		const files = await readdir(directory);

		// The DECLARED maximum is respected on the ACTUAL disk.
		expect(files.length).toBeLessThanOrEqual(
			COMPACTION_CANDIDATE_CAPTURE_MAX_CANDIDATES,
		);
		expect(files.length).toBe(COMPACTION_CANDIDATE_CAPTURE_MAX_CANDIDATES);
		expect(store.getWrittenCount()).toBeLessThanOrEqual(
			COMPACTION_CANDIDATE_CAPTURE_MAX_CANDIDATES,
		);
		expect(receipts.length).toBeLessThanOrEqual(
			COMPACTION_CANDIDATE_CAPTURE_MAX_CANDIDATES,
		);
		// The retained set agrees with what was written.
		expect(store.retainedCandidates().length).toBe(
			COMPACTION_CANDIDATE_CAPTURE_MAX_CANDIDATES,
		);
	});

	it("I2: the 12 → 13 → 14 candidate transitions NEVER exceed the declared maximum on disk", async () => {
		const store = new CompactionCandidateCaptureStore(directory);

		// Start with a control so the TOTAL is control + compaction.
		store.record(
			makeCandidate({
				systemPrompt: "distinct system prompt control",
				preparationRequestId: "req_control",
				decisionId: "session#1#control",
			}),
			false,
		);

		const observedCounts: number[] = [];
		for (let i = 0; i < 14; i++) {
			store.record(makeDistinctCandidate(i), true);
			await store.flush(makeReceipt);
			const files = await readdir(directory);
			observedCounts.push(files.length);
			// The hard cap holds at EVERY transition.
			expect(files.length).toBeLessThanOrEqual(
				COMPACTION_CANDIDATE_CAPTURE_MAX_CANDIDATES,
			);
			expect(store.getWrittenCount()).toBe(files.length);
		}

		// The capture reaches the cap and stays there.
		expect(observedCounts.at(-1)).toBe(
			COMPACTION_CANDIDATE_CAPTURE_MAX_CANDIDATES,
		);
		// The oldest candidate was evicted, not the newest: the newest
		// decisions are the ones that survive.
		const files = await readdir(directory);
		const contents = await Promise.all(
			files.map((file) => readFile(join(directory, file), "utf8")),
		);
		expect(contents.some((raw) => raw.includes("req_compact_13"))).toBe(true);
		expect(contents.some((raw) => raw.includes("req_compact_0"))).toBe(false);
	});

	it("I3: the reported count and byte totals RECONCILE with the actual directory", async () => {
		const store = new CompactionCandidateCaptureStore(directory);

		store.record(
			makeCandidate({
				systemPrompt: "distinct system prompt control",
				preparationRequestId: "req_control",
				decisionId: "session#1#control",
			}),
			false,
		);
		for (let i = 0; i < 14; i++) {
			store.record(makeDistinctCandidate(i), true);
			await store.flush(makeReceipt);

			const files = await readdir(directory);
			expect(store.getWrittenCount()).toBe(files.length);
			expect(store.getWrittenBytes()).toBe(await diskBytes(directory));
			expect([...store.writtenFileNames()].sort()).toEqual(files.sort());
		}
	});

	it("I4: overlapping flushes are serialized and never corrupt a captured file", async () => {
		const store = new CompactionCandidateCaptureStore(directory);
		store.record(
			makeCandidate({
				preparationRequestId: "req_concurrent",
				decisionId: "d1",
			}),
			true,
		);

		// OBSERVE THE OVERLAP DIRECTLY. The receipt resolver is the first
		// asynchronous step inside a flush, so a flush that has NOT started
		// cannot have resolved a receipt. Tracking the resolution ORDER
		// therefore reveals whether the two flushes overlapped.
		const resolutionOrder: number[] = [];
		let inFlight = 0;
		let maxConcurrentResolvers = 0;
		const trackedResolver = async (
			candidate: CompactionCandidateSnapshot,
		): Promise<CompactionCandidateCaptureReceipt> => {
			inFlight += 1;
			maxConcurrentResolvers = Math.max(maxConcurrentResolvers, inFlight);
			resolutionOrder.push(inFlight);
			// Yield long enough for a second, OVERLAPPING flush to enter.
			await new Promise((resolve) => setTimeout(resolve, 20));
			inFlight -= 1;
			return makeReceipt(candidate);
		};

		// Two flushes issued concurrently against the same store.
		const [first, second] = await Promise.all([
			store.flush(trackedResolver),
			store.flush(trackedResolver),
		]);
		expect(first.length).toBe(1);
		expect(second.length).toBe(1);

		// The flushes did NOT overlap: at most one resolver was ever in
		// flight, so the second flush waited for the first to complete.
		expect(maxConcurrentResolvers).toBe(1);
		expect(resolutionOrder.length).toBe(2);

		// The captured file is intact and parseable — no interleaved write.
		const files = await readdir(directory);
		expect(files.length).toBe(1);
		const raw = await readFile(join(directory, files[0]!), "utf8");
		expect(() => JSON.parse(raw)).not.toThrow();
		expect(store.getWrittenCount()).toBe(1);
	});

	it("I4b: an unchanged payload is NOT rewritten on a subsequent flush", async () => {
		const store = new CompactionCandidateCaptureStore(directory);
		store.record(
			makeCandidate({
				preparationRequestId: "req_idempotent",
				decisionId: "d1",
			}),
			true,
		);
		await store.flush(makeReceipt);

		const files = await readdir(directory);
		expect(files.length).toBe(1);
		const filePath = join(directory, files[0]!);
		const firstStat = await stat(filePath);
		// A sentinel mtime that distinguishes "written again" from
		// "left alone". The mtime granularity is coarse on some file
		// systems, so wait past it before the second flush.
		await new Promise((resolve) => setTimeout(resolve, 1100));

		// The SAME candidate is flushed again. Its serialized bytes have
		// not changed, so the file must NOT be rewritten.
		await store.flush(makeReceipt);
		const secondStat = await stat(filePath);

		expect(secondStat.size).toBe(firstStat.size);
		expect(secondStat.mtimeMs).toBe(firstStat.mtimeMs);
		expect(store.getWrittenCount()).toBe(1);
	});
});
