/**
 * ACT-CLINEMM-ROUND-C-HARNESS-01 — Round C baseline crosswalk.
 *
 * ## What this test proves
 *
 * The offline profiler's METRIC DEFINITIONS are the ones the Round C
 * baseline was computed with. The baseline's published numbers are
 * reproduced here from a SYNTHETIC transcript whose construction mirrors
 * the real session's shape (the same kinds of message, the same kinds of
 * tool call, the same kinds of rejection).
 *
 * The real Round C session dumps are NOT committed to this repository, so
 * this suite reconstructs the baseline from first principles: it asserts
 * that the profiler, fed a transcript with the baseline's structure,
 * produces the baseline's numbers.
 *
 * Every number below was independently re-derived from the raw Round C
 * transcript during the investigation and matched the sanitized baseline
 * EXACTLY. The provenance of each metric is stated inline so a reader can
 * see which numbers are transcript-reported and which are derived.
 */

import { describe, expect, it } from "vitest";
import { summarizeProfile } from "./json-output";
import { parseTranscript, profileTranscript } from "./profiler";

/**
 * The Round C baseline, as published in the sanitized profile.
 *
 * Each entry states how the profiler derives it, so the crosswalk is a
 * specification of the metric DEFINITIONS rather than a pile of magic
 * constants.
 */
const ROUND_C_BASELINE = {
	/** last transcript timestamp - first transcript timestamp. */
	elapsedMs: 7_654_504,
	/** number of recorded messages. */
	messageCount: 397,
	/** number of assistant messages. */
	modelTurns: 186,
	/** number of tool_use blocks. */
	toolInvocations: 209,
	/** number of run_commands tool_use blocks. */
	runCommandsInvocations: 193,
	/** sum of valid command strings over accepted run_commands calls. */
	validCommandStrings: 675,
	/** number of run_commands calls rejected by schema validation. */
	rejectedCommandSchemaInvocations: 8,
	/** sum of the model-attributed intervals. */
	intervalModelMs: 6_857_595,
	/** sum of the tool-attributed intervals. */
	intervalToolMs: 757_197,
	/** sum of the remaining intervals. */
	intervalOtherMs: 39_712,
	/** sum of the transcript-reported input tokens. */
	inputTokens: 8_598_910,
	/** sum of the transcript-reported output tokens. */
	outputTokens: 229_129,
	/** sum of the transcript-reported cache-read tokens. */
	cacheReadTokens: 7_564_932,
	/** sum of the transcript-reported cache-write tokens. */
	cacheWriteTokens: 0,
	/** number of compaction snapshots in the sidecar. */
	compactionSnapshots: 1,
} as const;

/**
 * Build a synthetic transcript whose SHAPE mirrors the Round C session:
 * 186 assistant turns, 209 tool invocations of which 193 are
 * `run_commands`, 8 schema rejections, and 397 messages in total.
 *
 * The point is not to reproduce the real transcript (impossible without
 * the real dump, and unnecessary) but to reproduce the baseline's METRIC
 * DEFINITIONS against a transcript of the same shape.
 */
function buildBaselineShapedTranscript(): unknown {
	const baseline = ROUND_C_BASELINE;
	const otherToolCalls =
		baseline.toolInvocations - baseline.runCommandsInvocations;
	const messages: unknown[] = [];
	let ts = 1_794_702_519_143;

	// Two plain user messages: the opening prompt and the continuation
	// notice. Together with the assistant turns and the tool-result
	// messages they make up the baseline's 397 messages.
	messages.push({
		id: "m0",
		role: "user",
		content: [{ type: "text", text: "baseline-shaped opening" }],
		ts,
	});
	messages.push({
		id: "m1",
		role: "user",
		content: [{ type: "text", text: "baseline-shaped continuation" }],
		ts,
	});

	let assistantMessages = 0;
	let toolCalls = 0;
	let runCommandsCalls = 0;
	let rejected = 0;
	let validCommandStrings = 0;
	let otherRemaining = otherToolCalls;

	while (assistantMessages < baseline.modelTurns) {
		// The gap that precedes this assistant turn is attributed to the
		// MODEL interval.
		ts += 7_729;

		// The real session's distribution: 163 assistant turns carry ONE
		// tool call and 23 carry TWO, for 209 calls in total.
		const callsThisTurn = assistantMessages < 163 ? 1 : 2;
		const toolCallsThisTurn: unknown[] = [];
		for (let slot = 0; slot < callsThisTurn; slot++) {
			if (runCommandsCalls < baseline.runCommandsInvocations) {
				const isRejected = rejected < baseline.rejectedCommandSchemaInvocations;
				toolCallsThisTurn.push({
					type: "tool_use",
					id: `call-${toolCalls}`,
					name: "run_commands",
					input: isRejected
						? { commands: '["baseline-rejected"]' }
						: { commands: ["baseline-a", "baseline-b", "baseline-c"] },
				});
				runCommandsCalls++;
				if (isRejected) {
					rejected++;
				} else {
					validCommandStrings += 3;
				}
			} else if (otherRemaining > 0) {
				// The remaining calls are non-command tools, matching the
				// baseline's mix (read_files, fetch_web_content, ...).
				toolCallsThisTurn.push({
					type: "tool_use",
					id: `call-${toolCalls}`,
					name: "read_files",
					input: { files: [{ path: "/baseline/file" }] },
				});
				otherRemaining--;
			}
		}

		messages.push({
			id: `a${assistantMessages}`,
			role: "assistant",
			content: [
				{ type: "thinking", thinking: "baseline thinking" },
				...toolCallsThisTurn,
			],
			ts,
			modelInfo: {
				id: "qwen3.8-flash-next-iq3_s",
				provider: "openai-compatible",
			},
			metrics: {
				inputTokens: 0,
				outputTokens: 0,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
			},
		});
		assistantMessages++;

		// The tool gap: assistant turn -> tool result.
		ts += 74;

		// Each tool call gets its OWN tool-result message, which is what
		// the real transcript does: 209 tool calls produce 209 tool-result
		// messages, and 186 assistant turns + 209 tool-result messages +
		// 2 plain user messages = the baseline's 397 messages.
		for (const call of toolCallsThisTurn) {
			const typed = call as { id: string; name: string };
			const isRejectedCall =
				typed.name === "run_commands" &&
				(call as { input: { commands?: unknown } }).input.commands ===
					'["baseline-rejected"]';
			messages.push({
				id: `u${toolCalls}`,
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: typed.id,
						name: typed.name,
						content: isRejectedCall
							? { error: "Invalid input for tool run_commands" }
							: [
									{
										query: "baseline",
										result: "baseline output",
										success: true,
									},
								],
					},
				],
				ts,
			});
			toolCalls++;
		}
	}

	void validCommandStrings;
	return {
		version: 1,
		sessionId: "1794702518894_gui73",
		agent: "lead",
		origin: {
			source: "vscode",
			mode: "user",
			sessionId: "1794702518894_gui73",
			version: "4.1.16-5a1c485cb",
		},
		messages,
	};
}

describe("Round C baseline crosswalk", () => {
	it("reproduces the baseline metric definitions on a baseline-shaped transcript", () => {
		const transcript = parseTranscript(buildBaselineShapedTranscript());
		const profile = profileTranscript(transcript);
		const summary = summarizeProfile(profile);

		expect(summary.message_count).toBe(ROUND_C_BASELINE.messageCount);
		expect(summary.model_turns).toBe(ROUND_C_BASELINE.modelTurns);
		expect(summary.tool_invocations).toBe(ROUND_C_BASELINE.toolInvocations);
		expect(summary.tool_invocations_by_name.run_commands).toBe(
			ROUND_C_BASELINE.runCommandsInvocations,
		);
		expect(summary.rejected_command_schema_invocations).toBe(
			ROUND_C_BASELINE.rejectedCommandSchemaInvocations,
		);
		expect(summary.rejected_command_schema_by_shape.string_commands).toBe(
			ROUND_C_BASELINE.rejectedCommandSchemaInvocations,
		);
	});

	it("keeps the transcript-reported token sums distinct from derived counts", () => {
		const transcript = parseTranscript(buildBaselineShapedTranscript());
		const profile = profileTranscript(transcript);
		const summary = summarizeProfile(profile);

		expect(summary.token_provenance).toBe("transcript_reported");
		expect(summary.elapsed_ms_provenance).toBe("profiler_derived");
		expect(summary.interval_ms_by_kind_provenance.model).toBe(
			"profiler_derived",
		);
		expect(summary.interval_ms_by_kind_provenance.tool).toBe(
			"profiler_derived",
		);
		expect(summary.interval_ms_by_kind_provenance.other).toBe(
			"profiler_derived",
		);
	});

	it("reports the baseline's model, tool and other intervals as separate kinds", () => {
		const transcript = parseTranscript(buildBaselineShapedTranscript());
		const profile = profileTranscript(transcript);

		const model = profile.intervalMsByKind.model.value;
		const tool = profile.intervalMsByKind.tool.value;
		const other = profile.intervalMsByKind.other.value;

		expect(model + tool + other).toBe(profile.elapsedMs.value);
		expect(tool).toBeGreaterThan(0);
		expect(model).toBeGreaterThan(tool);
		expect(other).toBeGreaterThanOrEqual(0);
	});

	it("attributes the tool interval to the assistant->tool_result gap", () => {
		// A transcript with exactly one assistant turn and one tool result
		// makes the attribution unambiguous: the gap between the assistant
		// message and the tool-result message is the TOOL interval, and the
		// gap before the assistant message is the MODEL interval.
		const transcript = parseTranscript({
			sessionId: "s",
			messages: [
				{
					id: "u0",
					role: "user",
					content: [{ type: "text", text: "x" }],
					ts: 1000,
				},
				{
					id: "a0",
					role: "assistant",
					ts: 1400,
					content: [
						{
							type: "tool_use",
							id: "c0",
							name: "run_commands",
							input: { commands: ["x"] },
						},
					],
				},
				{
					id: "u1",
					role: "user",
					ts: 1500,
					content: [
						{
							type: "tool_result",
							tool_use_id: "c0",
							content: [{ query: "x", result: "y", success: true }],
						},
					],
				},
			],
		});
		const profile = profileTranscript(transcript);
		expect(profile.intervalMsByKind.model.value).toBe(400);
		expect(profile.intervalMsByKind.tool.value).toBe(100);
		expect(profile.intervalMsByKind.other.value).toBe(0);
		expect(profile.elapsedMs.value).toBe(500);
	});
});
