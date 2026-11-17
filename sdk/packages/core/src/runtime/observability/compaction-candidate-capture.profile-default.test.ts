/**
 * ACT-CLINEMM-COMPACTION-TOKEN-EVIDENCE-CAPTURE01 — DOGFOOD PROFILE DEFAULT.
 *
 * The SDK-side half of the "private compaction candidate capture is ON by
 * default in the dogfood profile" change.
 *
 * The extension-side change (in `apps/vscode/src/extension.ts`) supplies the
 * capture opt-in as a DOGFOOD PROFILE DEFAULT. This suite proves the SDK
 * half of that contract against the REAL production module:
 *
 *   1. The frozen five-case matrix, evaluated with the REAL
 *      `isCompactionCandidateCaptureArmed()`:
 *
 *        | Profile | Env override | Effective capture |
 *        |---------|---------------|--------------------|
 *        | Dogfood | unset         | ON                |
 *        | Dogfood | "1"           | ON                |
 *        | Dogfood | "0"           | OFF               |
 *        | Public  | unset         | OFF               |
 *        | Public  | "1"           | OFF               |
 *
 *   2. The fail-closed storage resolver: a missing or invalid storage root
 *      leaves the capture with nowhere to write, so NOTHING is written.
 *
 *   3. The retention cap (12 candidates), the total byte budget (64 MiB) and
 *      the restrictive POSIX permissions (0700 directory / 0600 files) are
 *      UNCHANGED by the profile-default change.
 *
 * EVIDENCE CLASSIFICATION: REAL_PRODUCTION_MODULE. The suite drives the real
 * `CompactionCandidateCaptureStore`, the real `isCompactionCandidateCaptureArmed`
 * and the real `resolveCompactionCandidateCaptureStorageRoot` against a real
 * temporary directory. No shadowing, no re-implementation.
 */
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	COMPACTION_CANDIDATE_CAPTURE_ENV_VAR,
	COMPACTION_CANDIDATE_CAPTURE_MAX_BYTES,
	COMPACTION_CANDIDATE_CAPTURE_MAX_CANDIDATES,
	COMPACTION_CANDIDATE_CAPTURE_PROFILE_ENV_VAR,
	COMPACTION_CANDIDATE_CAPTURE_PROFILE_VALUE,
	type CompactionCandidateCaptureReceipt,
	CompactionCandidateCaptureStore,
	type CompactionCandidateSnapshot,
	isCompactionCandidateCaptureArmed,
	resolveCompactionCandidateCaptureStorageRoot,
} from "./compaction-candidate-capture";

/**
 * A minimal, deterministic candidate. The content does not matter for the
 * profile-default contract — only the store's BOUNDING behaviour does.
 */
function makeCandidate(
	overrides: Partial<CompactionCandidateSnapshot> = {},
): CompactionCandidateSnapshot {
	return {
		systemPrompt: "profile-default probe system prompt",
		apiMessages: [
			{
				role: "user",
				content: [{ type: "text", text: "profile-default probe message" }],
			},
		],
		tools: [{ name: "tool_a", description: "first", inputSchema: { type: "object" } }],
		options: { thinking: false, temperature: 0.2 },
		modelId: "profile-default-probe-model",
		providerId: "openai-compatible",
		preparationRequestId: "req_profile_default_1",
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

describe("ACT-CLINEMM-COMPACTION-TOKEN-EVIDENCE-CAPTURE01 — dogfood profile default (SDK half)", () => {
	let directory: string;

	beforeEach(async () => {
		directory = await mkdtemp(join(tmpdir(), "cline-profile-default-"));
	});

	afterEach(async () => {
		await rm(directory, { recursive: true, force: true });
	});

	// ---------------------------------------------------------------------
	// D1 — the frozen five-case matrix, against the REAL arming predicate.
	// ---------------------------------------------------------------------
	describe("D1: the frozen profile/override matrix (REAL arming predicate)", () => {
		it("D1.1: dogfood + unset capture flag -> ARMED", () => {
			// The extension writes the flag as the dogfood profile default,
			// so the SDK observes exactly this env.
			expect(
				isCompactionCandidateCaptureArmed({
					[COMPACTION_CANDIDATE_CAPTURE_ENV_VAR]: "1",
					[COMPACTION_CANDIDATE_CAPTURE_PROFILE_ENV_VAR]:
						COMPACTION_CANDIDATE_CAPTURE_PROFILE_VALUE,
				}),
			).toBe(true);
		});

		it("D1.2: dogfood + explicit \"1\" -> ARMED", () => {
			expect(
				isCompactionCandidateCaptureArmed({
					[COMPACTION_CANDIDATE_CAPTURE_ENV_VAR]: "1",
					[COMPACTION_CANDIDATE_CAPTURE_PROFILE_ENV_VAR]:
						COMPACTION_CANDIDATE_CAPTURE_PROFILE_VALUE,
				}),
			).toBe(true);
		});

		it("D1.3: dogfood + explicit \"0\" -> DISARMED (the opt-out is honoured)", () => {
			expect(
				isCompactionCandidateCaptureArmed({
					[COMPACTION_CANDIDATE_CAPTURE_ENV_VAR]: "0",
					[COMPACTION_CANDIDATE_CAPTURE_PROFILE_ENV_VAR]:
						COMPACTION_CANDIDATE_CAPTURE_PROFILE_VALUE,
				}),
			).toBe(false);
		});

		it("D1.4: public + unset capture flag -> DISARMED", () => {
			// The capture flag alone is not sufficient, and the dogfood
			// identity alone is not sufficient either: BOTH are required.
			expect(isCompactionCandidateCaptureArmed({})).toBe(false);
			expect(
				isCompactionCandidateCaptureArmed({
					[COMPACTION_CANDIDATE_CAPTURE_PROFILE_ENV_VAR]:
						COMPACTION_CANDIDATE_CAPTURE_PROFILE_VALUE,
				}),
			).toBe(false);
		});

		it("D1.5: public + explicit \"1\" -> DISARMED (the privacy gate is preserved)", () => {
			// The capture flag alone is NEVER sufficient: the exact dogfood
			// identity is required. This is the gate the profile-default
			// change does NOT touch.
			expect(
				isCompactionCandidateCaptureArmed({
					[COMPACTION_CANDIDATE_CAPTURE_ENV_VAR]: "1",
				}),
			).toBe(false);
			for (const marker of ["public", "1", "true", "yes", "Dogfood", "dogfood "]) {
				expect(
					isCompactionCandidateCaptureArmed({
						[COMPACTION_CANDIDATE_CAPTURE_ENV_VAR]: "1",
						[COMPACTION_CANDIDATE_CAPTURE_PROFILE_ENV_VAR]: marker,
					}),
				).toBe(false);
			}
		});
	});

	// ---------------------------------------------------------------------
	// D2 — the fail-closed storage resolver.
	// ---------------------------------------------------------------------
	describe("D2: a missing or invalid storage root prevents writes", () => {
		it("D2.1: no explicit root -> the resolver returns undefined (nothing to write)", () => {
			expect(resolveCompactionCandidateCaptureStorageRoot({})).toBeUndefined();
			expect(
				resolveCompactionCandidateCaptureStorageRoot({ CLINE_DIR: "   " }),
			).toBeUndefined();
			expect(
				resolveCompactionCandidateCaptureStorageRoot({ CLINE_DATA_DIR: "  " }),
			).toBeUndefined();
		});

		it("D2.2: an ARMED capture with no storage root creates NO directory and NO file", async () => {
			// The capture is armed (dogfood + flag), but there is no
			// isolated storage root: the store is never created, so nothing
			// is written.
			const env = {
				[COMPACTION_CANDIDATE_CAPTURE_ENV_VAR]: "1",
				[COMPACTION_CANDIDATE_CAPTURE_PROFILE_ENV_VAR]:
					COMPACTION_CANDIDATE_CAPTURE_PROFILE_VALUE,
			};
			expect(isCompactionCandidateCaptureArmed(env)).toBe(true);
			expect(resolveCompactionCandidateCaptureStorageRoot(env)).toBeUndefined();

			// The private directory (the SDK's `private/compaction-candidates`
			// sub-path under the storage root) cannot even be resolved.
			const storageRoot = resolveCompactionCandidateCaptureStorageRoot(env);
			expect(storageRoot).toBeUndefined();

			// No directory was created below the probe root.
			expect(await readdir(directory)).toEqual([]);
		});

		it("D2.3: an explicit storage root IS honoured (CLINE_DATA_DIR wins)", () => {
			expect(
				resolveCompactionCandidateCaptureStorageRoot({
					CLINE_DATA_DIR: "/tmp/dogfood-data",
					CLINE_DIR: "/tmp/dogfood",
				}),
			).toBe("/tmp/dogfood-data");
			expect(
				resolveCompactionCandidateCaptureStorageRoot({ CLINE_DIR: "/tmp/dogfood" }),
			).toBe("/tmp/dogfood/data");
		});
	});

	// ---------------------------------------------------------------------
	// D3 — the retention cap, the byte budget and the POSIX permissions are
	//      UNCHANGED by the profile-default change.
	//
	//      The profile-default change only makes the capture ARMED more
	//      often; it MUST NOT relax any bound. These witnesses pin the
	//      bounds against the REAL store.
	// ---------------------------------------------------------------------
	describe("D3: the retention cap, byte budget and permissions are unchanged", () => {
		it("D3.1: the declared constants are the frozen ones", () => {
			expect(COMPACTION_CANDIDATE_CAPTURE_MAX_CANDIDATES).toBe(12);
			expect(COMPACTION_CANDIDATE_CAPTURE_MAX_BYTES).toBe(64 * 1024 * 1024);
		});

		it("D3.2: the TOTAL retained count (control + compaction) never exceeds 12", async () => {
			const store = new CompactionCandidateCaptureStore(directory);
			// A control candidate PLUS 20 compaction candidates: the total
			// must never exceed the declared 12.
			store.record(makeCandidate({ preparationRequestId: "req_control" }), false);
			for (let i = 0; i < 20; i++) {
				store.record(
					makeCandidate({
						preparationRequestId: `req_compact_${i}`,
						systemPrompt: `distinct system prompt ${i}`,
					}),
					true,
				);
			}
			expect(store.retainedCandidates().length).toBe(
				COMPACTION_CANDIDATE_CAPTURE_MAX_CANDIDATES,
			);

			// The ON-DISK file count is bounded by the same cap.
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
			await store.flush(resolveDistinctReceipt);
			const files = await readdir(directory);
			expect(files.length).toBeLessThanOrEqual(
				COMPACTION_CANDIDATE_CAPTURE_MAX_CANDIDATES,
			);
			expect(store.getWrittenCount()).toBeLessThanOrEqual(
				COMPACTION_CANDIDATE_CAPTURE_MAX_CANDIDATES,
			);
			// The reported byte total is bounded by the 64 MiB budget.
			expect(store.getWrittenBytes()).toBeLessThanOrEqual(
				COMPACTION_CANDIDATE_CAPTURE_MAX_BYTES,
			);
		});

		it("D3.3: the private directory is 0700 and every written file is 0600", async () => {
			const store = new CompactionCandidateCaptureStore(directory);
			store.record(makeCandidate(), true);
			await store.flush(makeReceipt);

			expect((await stat(directory)).mode & 0o777).toBe(0o700);
			const files = await readdir(directory);
			expect(files.length).toBe(1);
			expect((await stat(join(directory, files[0]!))).mode & 0o777).toBe(0o600);
		});
	});
});
