/**
 * ACT-CLINEMM-COMPACTION-TOKEN-EVIDENCE-CAPTURE01.
 *
 * PRIVATE candidate capture: contract witnesses.
 *
 * Gates covered here:
 *
 *   T9   The candidate snapshot preserves structured tool results and exact
 *        ordering.
 *   T10  Truncation makes a snapshot explicitly ineligible for exact replay.
 *   T12  Synthetic credentials cannot enter a shareable artifact.
 *   T13  Capture failures do not change runtime behaviour.
 *
 * The capture is the ONLY place in this ACT that retains request CONTENT,
 * so these witnesses are the privacy boundary's test suite.
 */
import {
	chmod,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	COMPACTION_CANDIDATE_CAPTURE_ENV_VAR,
	COMPACTION_CANDIDATE_CAPTURE_PROFILE_ENV_VAR,
	type CompactionCandidateCaptureReceipt,
	CompactionCandidateCaptureStore,
	type CompactionCandidateSnapshot,
	isCompactionCandidateCaptureArmed,
	resolveCompactionCandidateCaptureStorageRoot,
} from "./compaction-candidate-capture";

const SYNTHETIC_API_KEY = "sk-synthetic-do-not-leak-000000000000";

/**
 * A candidate whose content mixes plain text, a structured tool result and
 * a multi-part tool result, so the ordering and structure assertions have
 * something real to pin.
 */
function makeCandidate(
	overrides: Partial<CompactionCandidateSnapshot> = {},
): CompactionCandidateSnapshot {
	return {
		systemPrompt: "deterministic probe system prompt",
		apiMessages: [
			{
				role: "user",
				content: [{ type: "text", text: "first message" }],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "toolu_1",
						content: [{ type: "text", text: "structured tool result" }],
					},
				],
			},
			{
				role: "assistant",
				content: [
					{ type: "text", text: "second message" },
					{ type: "text", text: "third message" },
				],
			},
		],
		tools: [
			{ name: "tool_a", description: "first", inputSchema: { type: "object" } },
			{
				name: "tool_b",
				description: "second",
				inputSchema: { type: "object" },
			},
		],
		options: { thinking: false, temperature: 0.2 },
		modelId: "evidence-probe-model",
		providerId: "openai-compatible",
		preparationRequestId: "req_candidate_1",
		decisionId: "session#1#0",
		...overrides,
	};
}

async function makeReceipt(
	candidate: CompactionCandidateSnapshot,
): Promise<CompactionCandidateCaptureReceipt> {
	return {
		kind: "compaction_candidate",
		requestIdentity: candidate.preparationRequestId ?? "unknown",
		representation: "CLIENT_DECISION_CANDIDATE_EXACT",
		snapshotComplete: true,
		contentFingerprint: "a".repeat(64),
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

describe("ACT-CLINEMM-COMPACTION-TOKEN-EVIDENCE-CAPTURE01 — private candidate capture", () => {
	let directory: string;

	beforeEach(async () => {
		directory = await mkdtemp(join(tmpdir(), "cline-candidate-capture-"));
	});

	afterEach(async () => {
		await rm(directory, { recursive: true, force: true });
	});

	it("T9: the snapshot preserves structured tool results and the EXACT ordering", async () => {
		const store = new CompactionCandidateCaptureStore(directory);
		const candidate = makeCandidate();
		store.record(candidate, true);
		const receipts = await store.flush(makeReceipt);
		expect(receipts.length).toBe(1);

		const files = await readdir(directory);
		expect(files.length).toBe(1);
		const raw = await readFile(join(directory, files[0]!), "utf8");
		const parsed = JSON.parse(raw) as {
			kind: string;
			candidate: CompactionCandidateSnapshot;
		};
		expect(parsed.kind).toBe("compaction_candidate_snapshot");
		const captured = parsed.candidate;

		// The MESSAGE ORDER is exact.
		expect(captured.apiMessages.length).toBe(3);
		expect(
			(captured.apiMessages[0] as { content: Array<{ text: string }> })
				.content[0]!.text,
		).toBe("first message");
		expect(
			(captured.apiMessages[2] as { content: Array<{ text: string }> })
				.content[0]!.text,
		).toBe("second message");

		// The STRUCTURED tool result survives with its identity and its
		// nested content parts — it is not flattened to a string.
		const toolMessage = captured.apiMessages[1] as {
			content: Array<{
				type: string;
				tool_use_id?: string;
				content?: unknown;
			}>;
		};
		expect(toolMessage.content[0]!.type).toBe("tool_result");
		expect(toolMessage.content[0]!.tool_use_id).toBe("toolu_1");
		expect(toolMessage.content[0]!.content).toEqual([
			{ type: "text", text: "structured tool result" },
		]);

		// The MULTI-PART message keeps both parts, in order.
		const assistant = captured.apiMessages[2] as {
			content: Array<{ text: string }>;
		};
		expect(assistant.content.map((part) => part.text)).toEqual([
			"second message",
			"third message",
		]);

		// The TOOL ORDER is exact.
		expect(
			(captured.tools as Array<{ name: string }>).map((t) => t.name),
		).toEqual(["tool_a", "tool_b"]);
	});

	it("T10: truncation makes the snapshot explicitly ineligible for exact replay", async () => {
		const store = new CompactionCandidateCaptureStore(directory);
		// A candidate whose serialized payload exceeds the per-candidate
		// byte budget.
		const huge = makeCandidate({
			apiMessages: [
				{
					role: "user",
					content: [{ type: "text", text: "X".repeat(9 * 1024 * 1024) }],
				},
			],
		});
		store.record(huge, true);
		const receipts = await store.flush(makeReceipt);

		expect(receipts.length).toBe(1);
		const receipt = receipts[0]!;
		// The truncation is EXPLICIT.
		expect(receipt.truncated).toBe(true);
		expect(receipt.snapshotComplete).toBe(false);
		expect(receipt.truncationReason).toBeTruthy();
		// A truncated candidate is ineligible for exact counting.
		expect(receipt.truncationReason).toBe(
			"CANDIDATE_EXCEEDS_PER_CANDIDATE_BYTE_BUDGET",
		);
	});

	it("T12: synthetic credentials cannot enter a shareable artifact", async () => {
		const store = new CompactionCandidateCaptureStore(directory);
		// A candidate whose option bag carries a credential-shaped value.
		const candidate = makeCandidate({
			options: {
				thinking: false,
				// A credential-shaped key that is NOT on the capture
				// allowlist.
				apiKey: SYNTHETIC_API_KEY,
				authorization: `Bearer ${SYNTHETIC_API_KEY}`,
			},
		});
		store.record(candidate, true);
		const receipts = await store.flush(makeReceipt);
		const files = await readdir(directory);
		const raw = await readFile(join(directory, files[0]!), "utf8");

		// The credential NEVER reaches the captured payload.
		expect(raw).not.toContain(SYNTHETIC_API_KEY);
		// Nor the receipt.
		expect(JSON.stringify(receipts)).not.toContain(SYNTHETIC_API_KEY);
		// The captured options carry ONLY the allowlisted, formatting
		// relevant values.
		const parsed = JSON.parse(raw) as {
			candidate: { options: Record<string, unknown> };
		};
		expect(Object.keys(parsed.candidate.options).sort()).toEqual(["thinking"]);
	});

	it("T13: a capture failure does not change the runtime behaviour", async () => {
		// A store whose directory cannot be created: a FILE occupies the
		// parent path, so the directory creation fails.
		const { writeFile } = await import("node:fs/promises");
		const occupied = join(directory, "occupied");
		await writeFile(occupied, "occupied", "utf8");
		const store = new CompactionCandidateCaptureStore(join(occupied, "nested"));
		store.record(makeCandidate(), true);

		// The capture fails...
		await expect(store.flush(makeReceipt)).rejects.toBeDefined();

		// ...and the store's retained state is UNCHANGED: the failure did
		// not corrupt, consume or drop the candidate, so a later successful
		// flush can still write it.
		expect(store.retainedCandidates().length).toBe(1);
		expect(store.getWrittenCount()).toBe(0);
		expect(store.getWrittenBytes()).toBe(0);
	});

	it("the private capture is armed ONLY by an explicit separate opt-in AND the dogfood identity", () => {
		// The opt-in alone is NOT sufficient.
		expect(isCompactionCandidateCaptureArmed({})).toBe(false);
		expect(
			isCompactionCandidateCaptureArmed({
				[COMPACTION_CANDIDATE_CAPTURE_ENV_VAR]: "0",
			}),
		).toBe(false);
		expect(
			isCompactionCandidateCaptureArmed({
				[COMPACTION_CANDIDATE_CAPTURE_ENV_VAR]: "true",
			}),
		).toBe(false);
		expect(
			isCompactionCandidateCaptureArmed({
				[COMPACTION_CANDIDATE_CAPTURE_ENV_VAR]: "1",
			}),
		).toBe(false);

		// The dogfood identity alone is NOT sufficient either.
		expect(
			isCompactionCandidateCaptureArmed({
				[COMPACTION_CANDIDATE_CAPTURE_PROFILE_ENV_VAR]: "dogfood",
			}),
		).toBe(false);

		// BOTH are required.
		expect(
			isCompactionCandidateCaptureArmed({
				[COMPACTION_CANDIDATE_CAPTURE_ENV_VAR]: "1",
				[COMPACTION_CANDIDATE_CAPTURE_PROFILE_ENV_VAR]: "dogfood",
			}),
		).toBe(true);
	});

	it("P0-3: a REGULAR profile can NEVER arm the capture, even with the opt-in set", () => {
		// The profile marker is exact-match and fail-closed: a typo, a
		// truthy-ish value and an absent marker all resolve to "public".
		for (const profile of [
			undefined,
			"",
			"   ",
			"public",
			"1",
			"true",
			"yes",
			"Dogfood",
			"dogfood ",
			"production",
		]) {
			expect(
				isCompactionCandidateCaptureArmed({
					[COMPACTION_CANDIDATE_CAPTURE_ENV_VAR]: "1",
					...(profile === undefined
						? {}
						: { [COMPACTION_CANDIDATE_CAPTURE_PROFILE_ENV_VAR]: profile }),
				}),
			).toBe(false);
		}
	});

	it("P0-3: the storage root FAILS CLOSED — there is no implicit ~/.cline/data fallback", () => {
		// No explicit root: the capture has nowhere provably private to
		// write, so it is NOT armed.
		expect(resolveCompactionCandidateCaptureStorageRoot({})).toBeUndefined();
		expect(
			resolveCompactionCandidateCaptureStorageRoot({ CLINE_DIR: "  " }),
		).toBeUndefined();

		// The explicit roots are honoured.
		expect(
			resolveCompactionCandidateCaptureStorageRoot({
				CLINE_DATA_DIR: "/tmp/dogfood-data",
			}),
		).toBe("/tmp/dogfood-data");
		expect(
			resolveCompactionCandidateCaptureStorageRoot({
				CLINE_DIR: "/tmp/dogfood",
			}),
		).toBe("/tmp/dogfood/data");
		// `CLINE_DATA_DIR` wins outright.
		expect(
			resolveCompactionCandidateCaptureStorageRoot({
				CLINE_DATA_DIR: "/tmp/a",
				CLINE_DIR: "/tmp/b",
			}),
		).toBe("/tmp/a");
	});

	it("P0-1: an oversized candidate is REJECTED BEFORE the write — the disk stays bounded", async () => {
		const store = new CompactionCandidateCaptureStore(directory);
		// A candidate whose serialized payload exceeds the per-candidate
		// byte budget (8 MiB).
		const huge = makeCandidate({
			apiMessages: [
				{
					role: "user",
					content: [{ type: "text", text: "X".repeat(9 * 1024 * 1024) }],
				},
			],
		});
		store.record(huge, true);
		const receipts = await store.flush(makeReceipt);

		expect(receipts.length).toBe(1);
		const receipt = receipts[0]!;
		expect(receipt.truncated).toBe(true);
		expect(receipt.snapshotComplete).toBe(false);
		expect(receipt.truncationReason).toBe(
			"CANDIDATE_EXCEEDS_PER_CANDIDATE_BYTE_BUDGET",
		);

		// THE ACTUAL DISK IS BOUNDED. The oversized content was NOT
		// written: the receipt says "truncated" AND the directory agrees.
		const files = await readdir(directory);
		expect(files.length).toBe(0);
		expect(store.getWrittenCount()).toBe(0);
		expect(store.getWrittenBytes()).toBe(0);
	});

	it("P0-1: repeated captures keep the ACTUAL disk file count and byte total bounded", async () => {
		const store = new CompactionCandidateCaptureStore(directory);

		// Several COMPACTION candidates, each with a DISTINCT and STABLE
		// content fingerprint (so each gets its own file name, and the
		// fingerprint does not change between flushes).
		const resolveDistinctReceipt = async (
			candidate: CompactionCandidateSnapshot,
		): Promise<CompactionCandidateCaptureReceipt> => {
			const base = await makeReceipt(candidate);
			const suffix = candidate.preparationRequestId ?? "unknown";
			return {
				...base,
				contentFingerprint: Buffer.from(suffix, "utf8")
					.toString("hex")
					.padEnd(64, "0")
					.slice(0, 64),
			};
		};

		for (let i = 0; i < 5; i++) {
			store.record(
				makeCandidate({
					preparationRequestId: `req_compact_${i}`,
					systemPrompt: `distinct system prompt ${i}`,
				}),
				true,
			);
			await store.flush(resolveDistinctReceipt);
		}

		// The directory holds ONE file per retained candidate — bounded.
		const files = await readdir(directory);
		expect(files.length).toBe(5);
		expect(store.getWrittenCount()).toBe(5);

		// The reported byte total MATCHES the actual on-disk total.
		let actualBytes = 0;
		for (const file of files) {
			const stats = await stat(join(directory, file));
			actualBytes += stats.size;
		}
		expect(store.getWrittenBytes()).toBe(actualBytes);
		expect(actualBytes).toBeGreaterThan(0);
	});

	it("P0-1: a SUPERSEDED control candidate is REMOVED from disk", async () => {
		const store = new CompactionCandidateCaptureStore(directory);
		const resolveDistinctReceipt = async (
			candidate: CompactionCandidateSnapshot,
		): Promise<CompactionCandidateCaptureReceipt> => {
			const base = await makeReceipt(candidate);
			const suffix = candidate.preparationRequestId ?? "unknown";
			return {
				...base,
				contentFingerprint: Buffer.from(suffix, "utf8")
					.toString("hex")
					.padEnd(64, "0")
					.slice(0, 64),
			};
		};

		// A control candidate.
		store.record(
			makeCandidate({ preparationRequestId: "req_control_1" }),
			false,
		);
		await store.flush(resolveDistinctReceipt);
		expect((await readdir(directory)).length).toBe(1);

		// A NEWER control SUPERSEDES it: the old file must be REMOVED, so
		// the directory does not grow without limit.
		store.record(
			makeCandidate({ preparationRequestId: "req_control_2" }),
			false,
		);
		await store.flush(resolveDistinctReceipt);

		const files = await readdir(directory);
		expect(files.length).toBe(1);
		expect(store.getWrittenCount()).toBe(1);
		const raw = await readFile(join(directory, files[0]!), "utf8");
		expect(raw).toContain("req_control_2");
		expect(raw).not.toContain("req_control_1");
	});

	it("P1: the captured snapshot is IMMUTABLE — a later mutation cannot change it", async () => {
		const store = new CompactionCandidateCaptureStore(directory);
		const candidate = makeCandidate();
		// Keep a reference to the caller's live objects.
		const liveMessages = candidate.apiMessages as Array<{
			content: Array<{ text: string }>;
		}>;
		store.record(candidate, true);

		// MUTATE the caller's objects AFTER the record: the snapshot must
		// not change, because it was copied before the first asynchronous
		// boundary.
		liveMessages[0]!.content[0]!.text = "MUTATED AFTER RECORD";

		await store.flush(makeReceipt);
		const files = await readdir(directory);
		const raw = await readFile(join(directory, files[0]!), "utf8");
		expect(raw).not.toContain("MUTATED AFTER RECORD");
		expect(raw).toContain("first message");
	});

	it("P0-3: a PERMISSIVE pre-existing directory and file are CORRECTED, not inherited", async () => {
		// `mkdir`'s `mode` and `writeFile`'s `mode` only apply to NEWLY
		// created entries: an existing permissive directory/file keeps its
		// mode. The store must correct the DIRECTORY and the files IT
		// WRITES.
		const permissiveDir = join(directory, "permissive");
		await mkdir(permissiveDir, { recursive: true, mode: 0o755 });
		await chmod(permissiveDir, 0o755);

		const store = new CompactionCandidateCaptureStore(permissiveDir);
		store.record(makeCandidate(), true);
		await store.flush(makeReceipt);

		// The DIRECTORY is corrected to 0700 even though it already
		// existed with a permissive mode.
		expect((await stat(permissiveDir)).mode & 0o777).toBe(0o700);

		// The file the store WROTE is 0600.
		const files = await readdir(permissiveDir);
		expect(files.length).toBe(1);
		expect((await stat(join(permissiveDir, files[0]!))).mode & 0o777).toBe(
			0o600,
		);

		// A PRE-EXISTING permissive file that the store did not write is
		// not silently rewritten — but the DIRECTORY that holds it is
		// already 0700, so it is no longer reachable by other users.
		const staleFile = join(permissiveDir, "stale.json");
		await writeFile(staleFile, "{}", "utf8");
		await chmod(staleFile, 0o644);
		await store.flush(makeReceipt);
		expect((await stat(permissiveDir)).mode & 0o777).toBe(0o700);
	});

	it("the private directory uses restrictive POSIX permissions", async () => {
		const store = new CompactionCandidateCaptureStore(directory);
		store.record(makeCandidate(), true);
		await store.flush(makeReceipt);

		const dirStats = await stat(directory);
		expect(dirStats.mode & 0o777).toBe(0o700);

		const files = await readdir(directory);
		expect(files.length).toBe(1);
		const fileStats = await stat(join(directory, files[0]!));
		expect(fileStats.mode & 0o777).toBe(0o600);
	});

	it("the capture retains ONE control and the compaction candidates, and is removable", async () => {
		const store = new CompactionCandidateCaptureStore(directory);
		// A control candidate (non-compacting), then a compaction candidate.
		store.record(makeCandidate({ preparationRequestId: "req_control" }), false);
		store.record(makeCandidate({ preparationRequestId: "req_compact" }), true);
		expect(store.retainedCandidates().length).toBe(2);

		// A LATER control REPLACES the earlier one: only the immediately
		// preceding non-compacting candidate is retained.
		store.record(
			makeCandidate({ preparationRequestId: "req_control_2" }),
			false,
		);
		const retained = store.retainedCandidates();
		expect(retained.length).toBe(2);
		expect(retained[0]!.preparationRequestId).toBe("req_control_2");
		expect(retained[1]!.preparationRequestId).toBe("req_compact");

		// The capture is explicitly removable after qualification.
		await store.remove();
		await expect(readdir(directory)).rejects.toBeDefined();
	});
});
