/**
 * ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION02.
 *
 * The CLI's END-TO-END request-pairing contract.
 *
 * ## THE DEFECT (P0)
 * --------------------
 * The CORRECTION01 lineage gate required
 *
 *     before.preparationRequestId === after.preparationRequestId
 *
 * but `preparationRequestId` is minted ONCE PER PREPARED REQUEST
 * (`AgentRuntime.prepareModelRequest()` — `createUID("req")`), so two
 * SUCCESSIVE MODEL TURNS carry DIFFERENT preparation identities. The gate
 * therefore rejected exactly the B->C and C->D comparisons that the next
 * experiment needs, and ACCEPTED the retry case (same preparation, different
 * attempt) — inverting the runtime's own documented distinction.
 *
 * The CLI also sorted every capture together and examined adjacent entries,
 * so the three representation stages of ONE request could be interleaved
 * with another request's stages, and the wire stage carried no preparation
 * identity at all.
 *
 * ## WHAT THIS SUITE PROVES
 * ------------------------
 * The CLI, driven as a REAL PROCESS over a REAL directory of capture
 * records, must:
 *
 *   - group the three representation stages of one request into ONE bundle,
 *   - compare a bundle with the NEXT bundle in the same session by proven
 *     adjacency, and
 *   - refuse a bundle whose identity cannot establish adjacency, without
 *     ever substituting a timestamp.
 *
 * The negative controls are the point: a RETRY, a NON-ADJACENT iteration, a
 * CROSS-SESSION pair and a bundle with a MISSING stage must all be refused
 * or reported incomplete — never silently accepted.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	computeRepresentationFingerprint,
	type PrefixForensicsCaptureRecord,
} from "./prefix-forensics";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(HERE, "prefix-forensics-analyzer-cli.ts");

const KEY = "cli-lineage-test-key";
const COHORT = "cohort-cli-1";

/** One message list. */
const MESSAGES_A = [
	{ role: "user", content: [{ type: "text", text: "hello" }] },
	{
		role: "tool",
		content: [{ type: "tool-result", toolCallId: "c1", output: "x" }],
	},
];

/** The same list with the tool result rewritten in place. */
const MESSAGES_MUTATED = [
	MESSAGES_A[0],
	{
		role: "tool",
		content: [
			{
				type: "tool-result",
				toolCallId: "c1",
				output: "y-and-much-longer",
			},
		],
	},
];

/** Build one sanitized capture record for a stage of one request. */
function record(options: {
	stage: string;
	messages: unknown[];
	sessionId?: string;
	preparationRequestId?: string;
	providerAttemptId?: string;
	iteration?: number;
	body?: unknown;
}): PrefixForensicsCaptureRecord {
	const representation = computeRepresentationFingerprint(
		options.stage,
		options.messages,
		{
			key: KEY,
			...(options.body !== undefined ? { body: options.body } : {}),
		},
	);
	const withoutDigest = {
		schemaVersion: 1,
		producer: "@cline/shared/runtime/prefix-forensics",
		capturedAt: "2026-11-21T00:00:00.000Z",
		cohortId: COHORT,
		sessionId: options.sessionId ?? "session-1",
		...(options.preparationRequestId !== undefined
			? { preparationRequestId: options.preparationRequestId }
			: {}),
		...(options.providerAttemptId !== undefined
			? { providerAttemptId: options.providerAttemptId }
			: {}),
		...(options.iteration !== undefined
			? { iteration: options.iteration }
			: {}),
		source: options.stage,
		representation,
	};
	return { ...withoutDigest, recordSha256: "0".repeat(64) };
}

/** Write a set of records into a fresh directory as capture files. */
function writeCaptures(records: PrefixForensicsCaptureRecord[]): string {
	const dir = mkdtempSync(join(tmpdir(), "pf-cli-"));
	const captureDir = join(dir, "captures");
	mkdirSync(captureDir);
	records.forEach((capture, index) => {
		writeFileSync(
			join(
				captureDir,
				`pf_${COHORT}_${String(index).padStart(3, "0")}.prefix-forensics.json`,
			),
			`${JSON.stringify(capture)}\n`,
			"utf8",
		);
	});
	return captureDir;
}

/** Run the REAL CLI over a directory and parse its JSON output. */
function runCli(dir: string): {
	schema: string;
	captureCount: number;
	pairCount: number;
	pairs: {
		before: string;
		after: string;
		authoritative: boolean;
		unavailableReason?: string;
		earliestDifferingStage?: string;
		commonPrefixLength?: number;
		firstDifference?: { index: number; kind: string };
	}[];
} {
	const stdout = execFileSync(
		process.execPath,
		["--experimental-strip-types", CLI, dir],
		{ encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
	);
	return JSON.parse(stdout);
}

/** The three stages of one request. */
function stagesOf(options: {
	preparationRequestId: string;
	providerAttemptId: string;
	iteration: number;
	sessionId?: string;
	messages?: unknown[];
	bodyPrefix?: string;
}): PrefixForensicsCaptureRecord[] {
	const messages = options.messages ?? MESSAGES_A;
	const sessionId = options.sessionId ?? "session-1";
	return [
		record({
			stage: "runtime_projection",
			messages,
			sessionId,
			preparationRequestId: options.preparationRequestId,
			providerAttemptId: options.providerAttemptId,
			iteration: options.iteration,
		}),
		record({
			stage: "ai_sdk_prompt",
			messages,
			sessionId,
			preparationRequestId: options.preparationRequestId,
			providerAttemptId: options.providerAttemptId,
			iteration: options.iteration,
		}),
		record({
			stage: "wire_request",
			messages,
			sessionId,
			preparationRequestId: options.preparationRequestId,
			providerAttemptId: options.providerAttemptId,
			iteration: options.iteration,
			body: `${options.bodyPrefix ?? "body"}-${options.iteration}`,
		}),
	];
}

describe("ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION02 — the CLI request pairing", () => {
	it("CLI-01: two complete three-stage requests produce an authoritative B->C comparison", () => {
		// THE REOPEN CONDITION.
		//
		// Two consecutive model turns of ONE session, each observed at all
		// THREE representation stages. The turns carry DIFFERENT
		// preparation identities — because `preparationRequestId` is minted
		// once per prepared request — and the SAME session with adjacent
		// iterations.
		//
		// The CLI must group each turn's three stages into one bundle and
		// compare bundle B with bundle C.
		const dir = writeCaptures([
			...stagesOf({
				preparationRequestId: "prep-29",
				providerAttemptId: "attempt-29",
				iteration: 29,
			}),
			...stagesOf({
				preparationRequestId: "prep-30",
				providerAttemptId: "attempt-30",
				iteration: 30,
				messages: MESSAGES_MUTATED,
			}),
		]);
		try {
			const result = runCli(dir);
			expect(result.captureCount).toBe(6);
			// Exactly ONE pair: the two bundles, not the six individual
			// captures.
			expect(result.pairCount).toBe(1);
			const pair = result.pairs[0];
			expect(pair?.authoritative).toBe(true);
			expect(pair?.unavailableReason).toBeUndefined();
			// The rewrite is localized at the mutated message.
			expect(pair?.commonPrefixLength).toBe(1);
			expect(pair?.firstDifference?.index).toBe(1);
			expect(pair?.firstDifference?.kind).toBe("modified");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("CLI-02: a third append-only continuation produces an authoritative C->D comparison", () => {
		const dir = writeCaptures([
			...stagesOf({
				preparationRequestId: "prep-29",
				providerAttemptId: "attempt-29",
				iteration: 29,
			}),
			...stagesOf({
				preparationRequestId: "prep-30",
				providerAttemptId: "attempt-30",
				iteration: 30,
				messages: MESSAGES_MUTATED,
			}),
			...stagesOf({
				preparationRequestId: "prep-31",
				providerAttemptId: "attempt-31",
				iteration: 31,
				messages: [
					...MESSAGES_MUTATED,
					{ role: "user", content: [{ type: "text", text: "more" }] },
				],
			}),
		]);
		try {
			const result = runCli(dir);
			expect(result.captureCount).toBe(9);
			expect(result.pairCount).toBe(2);
			for (const pair of result.pairs) {
				expect(pair.authoritative).toBe(true);
			}
			// The second pair is the append-only continuation.
			const second = result.pairs[1];
			expect(second?.commonPrefixLength).toBe(2);
			expect(second?.firstDifference?.kind).toBe("inserted");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("CLI-03: a RETRY of the same preparation is NOT a consecutive turn", () => {
		// The runtime's own distinction: a provider RETRY re-mints the
		// attempt id but KEEPS the preparation id, and it does NOT advance
		// the iteration. It must never be reported as the next turn.
		const dir = writeCaptures([
			...stagesOf({
				preparationRequestId: "prep-29",
				providerAttemptId: "attempt-29",
				iteration: 29,
			}),
			...stagesOf({
				preparationRequestId: "prep-29",
				providerAttemptId: "attempt-29-retry",
				iteration: 29,
			}),
		]);
		try {
			const result = runCli(dir);
			for (const pair of result.pairs) {
				expect(pair.authoritative).toBe(false);
				expect(pair.unavailableReason).toBeTruthy();
			}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("CLI-04: a NON-ADJACENT iteration gap is refused", () => {
		// Iteration 29 and iteration 31 are not adjacent: iteration 30 is
		// missing from the capture. The CLI must NOT bridge the gap by
		// timestamp.
		const dir = writeCaptures([
			...stagesOf({
				preparationRequestId: "prep-29",
				providerAttemptId: "attempt-29",
				iteration: 29,
			}),
			...stagesOf({
				preparationRequestId: "prep-31",
				providerAttemptId: "attempt-31",
				iteration: 31,
			}),
		]);
		try {
			const result = runCli(dir);
			for (const pair of result.pairs) {
				expect(pair.authoritative).toBe(false);
				expect(pair.unavailableReason).toBeTruthy();
			}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("CLI-05: a CROSS-SESSION pair is refused", () => {
		const dir = writeCaptures([
			...stagesOf({
				preparationRequestId: "prep-29",
				providerAttemptId: "attempt-29",
				iteration: 29,
				sessionId: "session-A",
			}),
			...stagesOf({
				preparationRequestId: "prep-30",
				providerAttemptId: "attempt-30",
				iteration: 30,
				sessionId: "session-B",
			}),
		]);
		try {
			const result = runCli(dir);
			for (const pair of result.pairs) {
				expect(pair.authoritative).toBe(false);
				expect(pair.unavailableReason).toBeTruthy();
			}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("CLI-06: a bundle with a MISSING stage is reported incomplete, never as equal", () => {
		// The wire stage of the second turn is absent. The comparison is
		// still a consecutive turn, but it must NOT claim that the wire
		// stage is equal — and the bundle must say the stage is
		// unavailable.
		const second = stagesOf({
			preparationRequestId: "prep-30",
			providerAttemptId: "attempt-30",
			iteration: 30,
			messages: MESSAGES_MUTATED,
		});
		const dir = writeCaptures([
			...stagesOf({
				preparationRequestId: "prep-29",
				providerAttemptId: "attempt-29",
				iteration: 29,
			}),
			// Drop the wire stage.
			second[0]!,
			second[1]!,
		]);
		try {
			const result = runCli(dir);
			expect(result.pairCount).toBe(1);
			const pair = result.pairs[0];
			// The pair IS a consecutive turn...
			expect(pair?.authoritative).toBe(true);
			// ...but the unavailable stage is reported, not treated as
			// equal.
			expect(pair?.unavailableStages).toContain("wire_request");
			expect(pair?.allStagesEqual).toBe(false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
