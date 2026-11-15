/**
 * ACT-CLINEMM-ROUND-C-HARNESS-01 — synthetic replay fixtures.
 *
 * ## Why synthetic fixtures
 *
 * The real Round C session dumps are NEVER committed to this repository:
 * they contain a full adversarial audit transcript, absolute paths from the
 * operator's machine, and repository contents. The regression suite
 * therefore runs against SYNTHETIC transcripts built here, whose expected
 * metrics are computed by construction rather than recorded.
 *
 * The builder is deterministic: the same options always produce the same
 * transcript, byte for byte. No clock, no randomness, no environment.
 *
 * ## Safety invariant (load-bearing)
 *
 * The strings below are inert placeholders. They are NOT commands and are
 * never executed — the profiler only ever counts and measures them.
 */

import type { ReplayCompactionSnapshot } from "./types";

/**
 * Options for building a synthetic transcript.
 */
export interface SyntheticFixtureOptions {
	/** Number of assistant model turns to emit. */
	readonly turns?: number;
	/**
	 * How many `run_commands` invocations each assistant turn emits.
	 */
	readonly commandsPerTurn?: number;
	/**
	 * The shape of the emitted `run_commands` input.
	 *
	 * - `canonical` — `{commands: ["cmd-0", ...]}` (accepted).
	 * - `string`    — `{commands: "[\"cmd-0\"]"}` (rejected: whole list
	 *                 serialized as one string).
	 * - `objects`   — `{commands: [{command: "cmd-0"}, ...]}` (rejected by
	 *                 the strict schema; one command per entry).
	 */
	readonly shape?: "canonical" | "string" | "objects";
	/** Whether each turn's invocation is schema-rejected. */
	readonly rejected?: boolean;
	/** Wall-clock gap before each assistant turn, in milliseconds. */
	readonly modelGapMs?: number;
	/** Wall-clock gap between an assistant turn and its tool result. */
	readonly toolGapMs?: number;
	/** Starting epoch for the transcript, in milliseconds. */
	readonly startTs?: number;
	/** Session id carried by the transcript. */
	readonly sessionId?: string;
}

/**
 * A synthetic transcript together with the metrics it must produce.
 */
export interface SyntheticFixture {
	readonly transcript: unknown;
	readonly compaction: readonly ReplayCompactionSnapshot[];
	readonly expected: {
		readonly elapsedMs: number;
		readonly messageCount: number;
		readonly modelTurns: number;
		readonly toolInvocations: number;
		readonly validCommandStrings: number;
		readonly rejectedInvocations: number;
		readonly intervalModelMs: number;
		readonly intervalToolMs: number;
		readonly intervalOtherMs: number;
		readonly inputTokens: number;
		readonly outputTokens: number;
		readonly cacheReadTokens: number;
	};
}

/**
 * The schema-rejection message the runtime records for a rejected call.
 *
 * It is a fixed, inert string: no command text, no path, no secret.
 */
export const SYNTHETIC_SCHEMA_ERROR_MESSAGE =
	"Invalid input for tool run_commands: invalid input";
/**
 * Build a deterministic synthetic transcript.
 *
 * The transcript alternates: assistant turn (tool call) -> user message
 * carrying the tool result. The first message is a user message that
 * starts the session, so every assistant turn has a PRECEDING event to
 * measure its model gap against.
 */
export function buildSyntheticFixture(
	options: SyntheticFixtureOptions = {},
): SyntheticFixture {
	const turns = options.turns ?? 3;
	const commandsPerTurn = options.commandsPerTurn ?? 1;
	const shape = options.shape ?? "canonical";
	const rejected = options.rejected ?? false;
	const modelGapMs = options.modelGapMs ?? 1000;
	const toolGapMs = options.toolGapMs ?? 250;
	const startTs = options.startTs ?? 1_700_000_000_000;
	const sessionId = options.sessionId ?? "synthetic-session";

	const messages: unknown[] = [];
	let ts = startTs;

	// Opening user message: gives every assistant turn a preceding event.
	messages.push({
		id: "synthetic-0",
		role: "user",
		content: [{ type: "text", text: "synthetic opening" }],
		ts,
	});

	let inputTokens = 0;
	let outputTokens = 0;
	let cacheReadTokens = 0;
	let validCommandStrings = 0;
	let rejectedInvocations = 0;
	let toolInvocations = 0;

	for (let turn = 0; turn < turns; turn++) {
		// The model gap: time between the previous event and this turn.
		ts += modelGapMs;

		const commands = Array.from(
			{ length: commandsPerTurn },
			(_unused, index) => `synthetic-command-${turn}-${index}`,
		);
		const input =
			shape === "string"
				? { commands: JSON.stringify(commands) }
				: shape === "objects"
					? { commands: commands.map((command) => ({ command })) }
					: { commands };

		const toolUseId = `synthetic-call-${turn}`;
		messages.push({
			id: `synthetic-assistant-${turn}`,
			role: "assistant",
			content: [
				{ type: "thinking", thinking: "synthetic thinking" },
				{ type: "tool_use", id: toolUseId, name: "run_commands", input },
			],
			ts,
			modelInfo: {
				id: "synthetic-model",
				provider: "synthetic-provider",
			},
			metrics: {
				inputTokens: 100,
				outputTokens: 10,
				cacheReadTokens: 5,
				cacheWriteTokens: 0,
			},
		});
		inputTokens += 100;
		outputTokens += 10;
		cacheReadTokens += 5;
		toolInvocations++;

		if (shape === "canonical" || shape === "objects") {
			// The strict schema accepts the canonical list. The object list
			// is rejected as a whole, but each entry still carries exactly
			// one command.
			validCommandStrings += commandsPerTurn;
		}
		if (rejected) {
			rejectedInvocations++;
		}

		// The tool gap: time between the assistant turn and its result.
		ts += toolGapMs;
		messages.push({
			id: `synthetic-user-${turn}`,
			role: "user",
			content: [
				{
					type: "tool_result",
					tool_use_id: toolUseId,
					name: "run_commands",
					content: rejected
						? { error: SYNTHETIC_SCHEMA_ERROR_MESSAGE }
						: commands.map((command) => ({
								query: command,
								result: `synthetic output for ${command}`,
								success: true,
							})),
				},
			],
			ts,
		});
	}

	const elapsedMs = ts - startTs;
	return {
		transcript: {
			version: 1,
			sessionId,
			agent: "lead",
			origin: {
				source: "synthetic",
				mode: "user",
				sessionId,
				version: "synthetic-0.0.0",
			},
			messages,
		},
		compaction: [],
		expected: {
			elapsedMs,
			messageCount: messages.length,
			modelTurns: turns,
			toolInvocations,
			validCommandStrings,
			rejectedInvocations,
			// Every assistant turn is preceded by a user(tool_result) or a
			// user(text) message, so each model gap is a `model` interval.
			intervalModelMs: turns * modelGapMs,
			intervalToolMs: turns * toolGapMs,
			intervalOtherMs: 0,
			inputTokens,
			outputTokens,
			cacheReadTokens,
		},
	};
}
