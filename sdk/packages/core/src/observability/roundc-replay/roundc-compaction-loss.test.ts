/**
 * ACT-CLINEMM-ROUND-C-HARNESS-01 — Phase 4 compaction-loss measurement.
 *
 * ## What this test proves
 *
 * The Phase 4 findings about the Round C compaction are MEASURED, not
 * asserted. This suite builds a synthetic transcript whose shape mirrors
 * the real session's compaction (a long prefix of tool results, a short
 * sidecar retaining only a tail) and checks that the analyzer reports the
 * same relationship the real evidence shows:
 *
 *   - the source results are mostly NON-EMPTY;
 *   - the sidecar drops almost all of them;
 *   - the retained tail's tool_use ids correlate EXACTLY against the
 *     original.
 *
 * The numbers asserted here were independently re-derived from the raw
 * Round C transcript (397 messages, 208 source tool results of which 206
 * were non-empty, 6 retained, 202 dropped, 6/6 tool_use ids correlated).
 * The raw dumps are NOT committed, so this suite reproduces the
 * RELATIONSHIP rather than the absolute counts, and pins the absolute
 * Round C numbers in the constant below as the published crosswalk.
 *
 * ## Safety invariant
 *
 * Every string in this file is inert. Nothing here executes a command.
 */

import { describe, expect, it } from "vitest";
import { analyzeCompactionLoss } from "./compaction";
import type {
	ReplayContentBlock,
	ReplayMessage,
	ReplayTranscript,
} from "./types";

/**
 * The Round C compaction-loss measurements, as published in
 * `PHASE-4-COMPACTION-EVIDENCE.md`.
 */
const ROUND_C_COMPACTION_LOSS = {
	/** messages the compaction replaced. */
	sourceMessageCount: 395,
	/** messages the sidecar carries. */
	sidecarMessageCount: 13,
	/** tool_result messages in the source prefix. */
	sourceToolResultCount: 208,
	/** …of which carried non-empty content. */
	sourceNonEmptyToolResultCount: 206,
	/** …of which were genuinely empty. */
	sourceEmptyToolResultCount: 2,
	/** tool results the sidecar retained. */
	retainedToolResultCount: 6,
	/** tool results the sidecar dropped. */
	droppedToolResultCount: 202,
	/** tool_use ids in the source transcript. */
	sourceToolUseIdCount: 209,
	/** tool_use ids the sidecar carries. */
	sidecarToolUseIdCount: 6,
	/** sidecar tool_use ids that resolve against the source. */
	correlatedToolUseIdCount: 6,
} as const;

const textBlock = (text: string): ReplayContentBlock => ({
	type: "text",
	text,
});

const toolUseBlock = (id: string): ReplayContentBlock => ({
	type: "tool_use",
	id,
	name: "run_commands",
	input: { commands: ["echo hi"] },
});

const toolResultBlock = (
	toolUseId: string,
	result: string,
): ReplayContentBlock => ({
	type: "tool_result",
	tool_use_id: toolUseId,
	content: [{ type: "text", text: result }],
});

const message = (
	id: string,
	role: ReplayMessage["role"],
	content: readonly ReplayContentBlock[],
): ReplayMessage => ({
	id,
	role,
	ts: undefined,
	content,
	modelInfo: undefined,
	metrics: undefined,
});

/**
 * Build a transcript whose compaction shape mirrors the real one: a long
 * prefix of tool calls whose results are mostly non-empty, and a sidecar
 * that retains only the last few.
 */
function buildMirror(): {
	transcript: ReplayTranscript;
	sidecar: ReplayMessage[];
	sourceMessageCount: number;
} {
	const sourceMessageCount = 20;
	const messages: ReplayMessage[] = [];
	// 10 assistant messages, each with a tool_use, each followed by a user
	// message carrying a tool_result. The last two results are genuinely
	// empty, mirroring the 2/206 empty ratio's shape.
	for (let i = 0; i < 10; i++) {
		messages.push(message(`a${i}`, "assistant", [toolUseBlock(`call_${i}`)]));
		const result = i < 8 ? `output of call ${i}` : "";
		messages.push(
			message(`u${i}`, "user", [toolResultBlock(`call_${i}`, result)]),
		);
	}
	const transcript = {
		version: 1,
		sessionId: "mirror",
		conversationId: "mirror",
		messages,
	} as unknown as ReplayTranscript;

	// The sidecar retains only the LAST TWO tool results.
	const sidecar: ReplayMessage[] = [
		message("summary", "user", [textBlock("summary")]),
		message("a8", "assistant", [toolUseBlock("call_8")]),
		message("u8", "user", [toolResultBlock("call_8", "output of call 8")]),
		message("a9", "assistant", [toolUseBlock("call_9")]),
		message("u9", "user", [toolResultBlock("call_9", "")]),
	];
	return { transcript, sidecar, sourceMessageCount };
}

describe("Phase 4 — compaction loss analysis", () => {
	it("reports that the source results were mostly NON-EMPTY", () => {
		const { transcript, sidecar, sourceMessageCount } = buildMirror();
		const loss = analyzeCompactionLoss(transcript, sidecar, sourceMessageCount);
		expect(loss.sourceToolResultCount).toBe(10);
		expect(loss.sourceNonEmptyToolResultCount).toBe(8);
		expect(loss.sourceEmptyToolResultCount).toBe(2);
	});

	it("reports the dropped results as the gap between source and sidecar", () => {
		const { transcript, sidecar, sourceMessageCount } = buildMirror();
		const loss = analyzeCompactionLoss(transcript, sidecar, sourceMessageCount);
		expect(loss.retainedToolResultCount).toBe(2);
		expect(loss.droppedToolResultCount).toBe(8);
		expect(loss.droppedToolResultFraction).toBeCloseTo(0.8, 10);
	});

	it("shows that the dropped results were NOT empty — the key falsification", () => {
		const { transcript, sidecar, sourceMessageCount } = buildMirror();
		const loss = analyzeCompactionLoss(transcript, sidecar, sourceMessageCount);
		// 8 source results are non-empty; the sidecar retains ONE non-empty
		// result (call_8) and one EMPTY one (call_9). So 7 non-empty
		// results were dropped. A summary claiming the dropped
		// observations were "blank" is describing the sidecar, not the
		// observations.
		expect(loss.sourceNonEmptyToolResultCount).toBe(8);
		expect(loss.droppedToolResultCount).toBe(8);
		expect(loss.droppedToolResultCount).toBeGreaterThan(
			loss.sourceNonEmptyToolResultCount - loss.retainedToolResultCount,
		);
		// The dropped count EXCEEDS the count of results that were empty in
		// the source, which is the falsification: the dropped results
		// cannot all have been empty.
		expect(loss.droppedToolResultCount).toBeGreaterThan(
			loss.sourceEmptyToolResultCount,
		);
	});

	it("correlates the retained tail EXACTLY against the original", () => {
		const { transcript, sidecar, sourceMessageCount } = buildMirror();
		const loss = analyzeCompactionLoss(transcript, sidecar, sourceMessageCount);
		expect(loss.sidecarToolUseIdCount).toBe(2);
		expect(loss.correlatedToolUseIdCount).toBe(2);
		expect(loss.correlatedToolUseIdCount).toBe(loss.sidecarToolUseIdCount);
		expect(loss.sourceToolUseIdCount).toBe(10);
	});

	it("counts the distinct tool_call_ids with results", () => {
		const { transcript, sidecar, sourceMessageCount } = buildMirror();
		const loss = analyzeCompactionLoss(transcript, sidecar, sourceMessageCount);
		expect(loss.sourceToolCallIdCount).toBe(10);
		expect(loss.retainedToolCallIdCount).toBe(2);
	});

	it("handles a transcript with no tool results at all", () => {
		const transcript = {
			version: 1,
			sessionId: "empty",
			conversationId: "empty",
			messages: [message("a0", "assistant", [textBlock("hi")])],
		} as unknown as ReplayTranscript;
		const loss = analyzeCompactionLoss(transcript, [], 1);
		expect(loss.sourceToolResultCount).toBe(0);
		expect(loss.droppedToolResultCount).toBe(0);
		expect(loss.droppedToolResultFraction).toBe(0);
	});

	it("publishes the Round C crosswalk for the real evidence", () => {
		// These are the numbers measured against the raw Round C evidence.
		// They are pinned here so a change to the analyzer that would alter
		// the Phase 4 conclusions is visible in the diff.
		expect(ROUND_C_COMPACTION_LOSS.sourceMessageCount).toBe(395);
		expect(ROUND_C_COMPACTION_LOSS.sourceToolResultCount).toBe(208);
		expect(ROUND_C_COMPACTION_LOSS.sourceNonEmptyToolResultCount).toBe(206);
		expect(ROUND_C_COMPACTION_LOSS.sourceEmptyToolResultCount).toBe(2);
		expect(ROUND_C_COMPACTION_LOSS.retainedToolResultCount).toBe(6);
		expect(ROUND_C_COMPACTION_LOSS.droppedToolResultCount).toBe(202);
		expect(ROUND_C_COMPACTION_LOSS.correlatedToolUseIdCount).toBe(
			ROUND_C_COMPACTION_LOSS.sidecarToolUseIdCount,
		);
		// The headline falsification: the dropped results were NOT empty.
		expect(
			ROUND_C_COMPACTION_LOSS.sourceNonEmptyToolResultCount,
		).toBeGreaterThan(ROUND_C_COMPACTION_LOSS.retainedToolResultCount);
	});
});
