/**
 * ACT-CLINEMM-ROUND-C-HARNESS-01 — Phase 1 offline replay profiler.
 *
 * ## What this is
 *
 * A pure, dependency-free function that reconstructs the metric profile of a
 * recorded agent session from its transcript. It is the offline stand-in for
 * the runtime latency instrumentation of Phase 2: given the same transcript,
 * it must produce byte-identical output every time.
 *
 * ## What this is NOT
 *
 * It is NOT a live measurement. Every number it produces is either
 * TRANSCRIPT-REPORTED (a field the transcript itself carries) or
 * PROFILER-DERIVED (a structural fact the profiler computed from the
 * transcript). The two are tagged separately in the output so a later
 * reader can never mistake one for the other.
 *
 * ## Safety invariant (load-bearing)
 *
 * The profiler PARSES; it never EXECUTES. Transcript text is treated as
 * opaque data throughout: command strings are counted and measured, never
 * run, split, interpreted, or forwarded to a shell. Nothing in this file
 * calls `exec`, `spawn`, `eval`, or a shell, and nothing in it interprets a
 * recorded string as an instruction to the agent.
 *
 * ## Interval attribution
 *
 * Wall-clock gaps between consecutive transcript events are attributed by the
 * KIND of the pair, which is what makes the split meaningful:
 *
 * | Pair                                        | Kind    | Meaning                          |
 * |---------------------------------------------|---------|----------------------------------|
 * | assistant -> user(tool_result)               | `tool`  | command execution + delivery     |
 * | user(tool_result) -> assistant               | `model` | waiting for the model's turn     |
 * | user -> assistant (no tool result pending)   | `model` | waiting for the model's turn     |
 * | user(tool_result) -> user(tool_result)      | `other` | tool-result to tool-result gap   |
 */

import type {
	ReplayCompactionSnapshot,
	ReplayContentBlock,
	ReplayInterval,
	ReplayIntervalKind,
	ReplayMessage,
	ReplayMetric,
	ReplayMetricProvenance,
	ReplayModelTurn,
	ReplayProfile,
	ReplayToolInvocation,
	ReplayTranscript,
} from "./types";

/**
 * The shape of a `run_commands` tool input as recorded in a transcript.
 *
 * Only the structural aspects are modelled. `commands` is typed as `unknown`
 * because the recorded value is exactly the thing under investigation: it
 * may be a list of strings, a list of objects, or a single string.
 */
interface RunCommandsLikeInput {
	readonly commands?: unknown;
}

/**
 * The shape of a recorded tool result payload.
 *
 * The recorded payload is either a LIST of per-command result items or a
 * single OBJECT carrying an `error` key (the shape used for a schema
 * rejection). Both are represented here; the CONTENT of a result item is
 * never inspected beyond its `success` flag and its `result` length.
 */
interface RecordedResultItem {
	readonly success?: unknown;
	readonly result?: unknown;
}

const REPORTED: ReplayMetricProvenance = "transcript_reported";
const DERIVED: ReplayMetricProvenance = "profiler_derived";

function derived<T>(value: T): ReplayMetric<T> {
	return { value, provenance: DERIVED };
}

function reported<T>(value: T): ReplayMetric<T> {
	return { value, provenance: REPORTED };
}

/**
 * Format a millisecond epoch as a UTC ISO-8601 timestamp.
 *
 * The formatting is locale-independent and identical on every host, so the
 * profiler's output is byte-stable across machines.
 */
export function toUtcTimestamp(epochMs: number): string {
	return new Date(epochMs).toISOString();
}

/**
 * Read a finite number from an unknown value, or `undefined`.
 *
 * Anything non-numeric (including `NaN` and `Infinity`) is rejected: a
 * transcript that carries a non-finite token count must not silently
 * poison a sum.
 */
function finiteNumber(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return undefined;
	}
	return value;
}

/**
 * Read a string from an unknown value, or `undefined`.
 */
function optionalString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

/**
 * Normalize one recorded content block into the typed model.
 *
 * Unknown block types are preserved as `{ type: "unknown" }` rather than
 * dropped, so a transcript that grows a new block type still round-trips
 * without silently losing events.
 */
function normalizeBlock(raw: unknown): ReplayContentBlock {
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
		return { type: "unknown", raw };
	}
	const record = raw as Record<string, unknown>;
	switch (record.type) {
		case "text":
			return {
				type: "text",
				text: typeof record.text === "string" ? record.text : "",
			};
		case "thinking":
			return {
				type: "thinking",
				thinking: typeof record.thinking === "string" ? record.thinking : "",
			};
		case "tool_use":
			return {
				type: "tool_use",
				id: typeof record.id === "string" ? record.id : "",
				name: typeof record.name === "string" ? record.name : "",
				input: record.input,
			};
		case "tool_result":
			return {
				type: "tool_result",
				tool_use_id:
					typeof record.tool_use_id === "string" ? record.tool_use_id : "",
				name: optionalString(record.name),
				content: record.content,
			};
		default:
			return { type: "unknown", raw };
	}
}
/**
 * Normalize one recorded message into the typed model.
 */
function normalizeMessage(raw: unknown, index: number): ReplayMessage {
	const record =
		raw !== null && typeof raw === "object" && !Array.isArray(raw)
			? (raw as Record<string, unknown>)
			: {};
	const rawContent = Array.isArray(record.content) ? record.content : [];
	const content = rawContent.map(normalizeBlock);
	const rawModelInfo = record.modelInfo;
	const modelInfo =
		rawModelInfo !== null &&
		typeof rawModelInfo === "object" &&
		!Array.isArray(rawModelInfo)
			? {
					id:
						typeof (rawModelInfo as Record<string, unknown>).id === "string"
							? ((rawModelInfo as Record<string, unknown>).id as string)
							: "",
					provider:
						typeof (rawModelInfo as Record<string, unknown>).provider ===
						"string"
							? ((rawModelInfo as Record<string, unknown>).provider as string)
							: "",
				}
			: undefined;
	const rawMetrics = record.metrics;
	const metrics =
		rawMetrics !== null &&
		typeof rawMetrics === "object" &&
		!Array.isArray(rawMetrics)
			? (() => {
					const m = rawMetrics as Record<string, unknown>;
					return {
						inputTokens: finiteNumber(m.inputTokens) ?? 0,
						outputTokens: finiteNumber(m.outputTokens) ?? 0,
						cacheReadTokens: finiteNumber(m.cacheReadTokens) ?? 0,
						cacheWriteTokens: finiteNumber(m.cacheWriteTokens) ?? 0,
					};
				})()
			: undefined;
	const role =
		record.role === "user" || record.role === "assistant"
			? record.role
			: "unknown";
	return {
		id: typeof record.id === "string" ? record.id : `index:${index}`,
		role,
		ts: finiteNumber(record.ts),
		content,
		modelInfo,
		metrics,
	};
}

/**
 * Parse a raw transcript document into the typed model.
 *
 * Accepts either an already-parsed object or the JSON text of one. A
 * document that cannot be parsed yields an empty transcript rather than
 * throwing, so a corrupt file produces a diagnosable profile instead of an
 * unhandled exception.
 */
export function parseTranscript(source: unknown): ReplayTranscript {
	let document: unknown = source;
	if (typeof source === "string") {
		try {
			document = JSON.parse(source);
		} catch {
			document = undefined;
		}
	}
	const record =
		document !== null &&
		typeof document === "object" &&
		!Array.isArray(document)
			? (document as Record<string, unknown>)
			: {};
	const rawMessages = Array.isArray(record.messages) ? record.messages : [];
	const rawOrigin = record.origin;
	const origin =
		rawOrigin !== null &&
		typeof rawOrigin === "object" &&
		!Array.isArray(rawOrigin)
			? {
					source: optionalString((rawOrigin as Record<string, unknown>).source),
					mode: optionalString((rawOrigin as Record<string, unknown>).mode),
					sessionId: optionalString(
						(rawOrigin as Record<string, unknown>).sessionId,
					),
					version: optionalString(
						(rawOrigin as Record<string, unknown>).version,
					),
				}
			: undefined;
	return {
		version: finiteNumber(record.version),
		sessionId:
			typeof record.sessionId === "string" ? record.sessionId : "unknown",
		agent: optionalString(record.agent),
		origin,
		messages: rawMessages.map(normalizeMessage),
	};
}

/**
 * Whether a message carries at least one tool result.
 */
function isToolResultMessage(message: ReplayMessage): boolean {
	return message.content.some((block) => block.type === "tool_result");
}

/**
 * Classify the shape of a recorded `run_commands` input.
 *
 * The classification is PURELY STRUCTURAL — it looks at the JSON shape of
 * the recorded argument and never at the text inside it. The distinct
 * shapes are the ones confirmed in the Round C transcript:
 *
 * - `canonical_list`    — `commands` is a list of strings.
 * - `string_commands`   — `commands` is a single string (the whole list
 *                         serialized as one string).
 * - `object_entries`    — `commands` is a list of `{command: ...}` objects.
 * - `absent`            — no `commands` key at all.
 * - `other`             — any other shape.
 */
export type RunCommandsInputShape =
	| "canonical_list"
	| "string_commands"
	| "object_entries"
	| "absent"
	| "other";

/**
 * Determine the structural shape of a recorded `run_commands` input.
 */
export function classifyRunCommandsInput(
	input: unknown,
): RunCommandsInputShape {
	if (input === null || typeof input !== "object" || Array.isArray(input)) {
		return "other";
	}
	const record = input as RunCommandsLikeInput;
	if (!("commands" in record)) {
		return "absent";
	}
	const commands = record.commands;
	if (typeof commands === "string") {
		return "string_commands";
	}
	if (!Array.isArray(commands)) {
		return "other";
	}
	const allStrings = commands.every((member) => typeof member === "string");
	if (allStrings) {
		return "canonical_list";
	}
	const allObjects = commands.every(
		(member) =>
			member !== null && typeof member === "object" && !Array.isArray(member),
	);
	return allObjects ? "object_entries" : "other";
}

/**
 * Count the VALID command strings a recorded `run_commands` input carries.
 *
 * A string-valued `commands` carries ZERO valid command strings: the
 * strict schema requires an array, so the whole invocation is rejected and
 * contributes nothing. A list of `{command: ...}` objects carries one
 * command per entry (the shape the strict schema rejects but the structured
 * command schema supports), so it is counted per entry.
 */
export function countValidCommandStrings(input: unknown): number | null {
	const shape = classifyRunCommandsInput(input);
	switch (shape) {
		case "canonical_list":
		case "object_entries": {
			const commands = (input as RunCommandsLikeInput).commands;
			return Array.isArray(commands) ? commands.length : 0;
		}
		case "string_commands":
			return 0;
		case "absent":
		case "other":
			return null;
	}
}

/**
 * Whether a recorded `run_commands` input matches the STRICT canonical
 * schema shape (`commands` is a list of strings).
 */
export function isStrictRunCommandsShape(input: unknown): boolean {
	return classifyRunCommandsInput(input) === "canonical_list";
}

/**
 * Read the per-command result items out of a recorded tool result payload.
 *
 * A schema rejection is recorded as a bare OBJECT carrying `error`; an
 * execution produces a LIST of items. Anything else yields no items.
 */
function readResultItems(content: unknown): readonly RecordedResultItem[] {
	if (!Array.isArray(content)) {
		return [];
	}
	return content.filter(
		(item): item is RecordedResultItem =>
			item !== null && typeof item === "object" && !Array.isArray(item),
	);
}

/**
 * Attribute a wall-clock gap between two consecutive transcript events.
 *
 * The attribution is by the KIND of the PAIR, which is what makes the
 * split meaningful:
 *
 * | Pair                                        | Kind    | Meaning                      |
 * |---------------------------------------------|---------|------------------------------|
 * | assistant -> user(tool_result)               | `tool`  | command execution + delivery |
 * | user(tool_result) -> assistant               | `model` | waiting for the model's turn |
 * | user -> assistant (no tool result pending)   | `model` | waiting for the model's turn |
 * | user(tool_result) -> user(tool_result)      | `other` | tool-result to tool-result   |
 *
 * The order of the tests matters: a tool-result message followed by
 * another tool-result message is `other`, NOT `tool`. Checking "the next
 * message is a tool result" first would misattribute that gap.
 */
function classifyInterval(
	from: ReplayMessage,
	to: ReplayMessage,
): ReplayIntervalKind {
	const fromIsToolResult = from.role === "user" && isToolResultMessage(from);
	if (fromIsToolResult) {
		// The gap after a tool result is either the wait for the model's
		// next turn, or the gap to the next tool result.
		return to.role === "assistant" ? "model" : "other";
	}
	if (to.role === "user" && isToolResultMessage(to)) {
		return "tool";
	}
	if (to.role === "assistant") {
		return "model";
	}
	return "other";
}

/**
 * Compute the metric profile of a recorded transcript.
 *
 * The function is PURE: the same transcript always yields the same
 * profile, byte for byte. Nothing here depends on wall-clock time, the
 * host, or any ambient state.
 *
 * @param transcript the parsed transcript
 * @param compaction the parsed compaction sidecar snapshots, if any
 */
export function profileTranscript(
	transcript: ReplayTranscript,
	compaction: readonly ReplayCompactionSnapshot[] = [],
): ReplayProfile {
	const messages = transcript.messages;
	const perCompaction = compaction;

	// --- Tool invocations ------------------------------------------------
	//
	// A tool call is an assistant `tool_use` block; its result is the
	// `tool_result` block carrying the SAME tool_use id. The pairing is by
	// id, never by position, so a message with several tool calls pairs
	// correctly.
	const resultByToolUseId = new Map<
		string,
		{ readonly content: unknown; readonly name: string | undefined }
	>();
	for (const message of messages) {
		for (const block of message.content) {
			if (block.type === "tool_result") {
				resultByToolUseId.set(block.tool_use_id, {
					content: block.content,
					name: block.name,
				});
			}
		}
	}

	const perToolInvocation: ReplayToolInvocation[] = [];
	const toolInvocationsByName: Record<string, number> = {};
	let validCommandStrings = 0;
	let rejectedCommandSchemaInvocations = 0;
	const rejectedCommandSchemaByShape: Record<string, number> = {};

	for (let index = 0; index < messages.length; index++) {
		const message = messages[index];
		if (message.role !== "assistant") {
			continue;
		}
		for (const block of message.content) {
			if (block.type !== "tool_use") {
				continue;
			}
			const tool = block.name;
			toolInvocationsByName[tool] = (toolInvocationsByName[tool] ?? 0) + 1;

			const isCommandTool = tool === "run_commands";
			const shape = isCommandTool
				? classifyRunCommandsInput(block.input)
				: null;
			const schemaValid = isCommandTool
				? isStrictRunCommandsShape(block.input)
				: null;
			const commandCount = isCommandTool
				? countValidCommandStrings(block.input)
				: null;

			const result = resultByToolUseId.get(block.id);
			const items = readResultItems(result?.content);
			const schemaErrorMessage = readSchemaError(result?.content);
			const schemaError = schemaErrorMessage !== undefined;

			let successItems = 0;
			let failedItems = 0;
			let resultTextChars = 0;
			for (const item of items) {
				if (item.success === true) {
					successItems++;
				} else if (item.success === false) {
					failedItems++;
				}
				if (typeof item.result === "string") {
					resultTextChars += item.result.length;
				}
			}

			if (isCommandTool) {
				if (schemaValid === true && commandCount !== null) {
					validCommandStrings += commandCount;
				}
				if (schemaError) {
					rejectedCommandSchemaInvocations++;
					const key = shape ?? "unknown";
					rejectedCommandSchemaByShape[key] =
						(rejectedCommandSchemaByShape[key] ?? 0) + 1;
				}
			}

			perToolInvocation.push({
				eventIndex: index,
				tool,
				schemaValid,
				commandCount,
				resultItems: items.length,
				successItems,
				failedItems,
				resultTextChars,
				schemaError,
				schemaErrorMessage,
			});
		}
	}

	/**
	 * Read the schema-rejection message out of a recorded tool result payload.
	 *
	 * A schema rejection is recorded in EITHER of two shapes, and the real
	 * Round C transcript contains BOTH:
	 *
	 *   - a JSON TEXT string carrying `{"error": "..."}`; and
	 *   - an OBJECT carrying an `error` key.
	 *
	 * The text shape is the one the runtime actually emits, so it is the one
	 * that must be recognised first; the object shape is accepted as well so
	 * a differently-shaped producer is still classified rather than silently
	 * counted as a successful execution.
	 */
	function readSchemaError(content: unknown): string | undefined {
		if (typeof content === "string") {
			// The recorded payload is JSON text. It is parsed as DATA — never
			// evaluated — purely to read the `error` member.
			let parsed: unknown;
			try {
				parsed = JSON.parse(content);
			} catch {
				return undefined;
			}
			if (
				parsed !== null &&
				typeof parsed === "object" &&
				!Array.isArray(parsed)
			) {
				const error = (parsed as Record<string, unknown>).error;
				if (typeof error === "string") {
					return error;
				}
			}
			return undefined;
		}
		if (
			content !== null &&
			typeof content === "object" &&
			!Array.isArray(content)
		) {
			const error = (content as Record<string, unknown>).error;
			if (typeof error === "string") {
				return error;
			}
		}
		return undefined;
	}

	// --- Model turns and intervals ---------------------------------------
	//
	// A model turn is an assistant message. Its elapsed time is the gap
	// from the PREVIOUS transcript event to this turn — i.e. the wall-clock
	// the agent spent waiting for the model to produce it.
	const perModelTurn: ReplayModelTurn[] = [];
	const intervals: ReplayInterval[] = [];
	const intervalMsByKind: Record<ReplayIntervalKind, number> = {
		model: 0,
		tool: 0,
		other: 0,
	};

	for (let index = 0; index < messages.length; index++) {
		const message = messages[index];
		const previous = index > 0 ? messages[index - 1] : undefined;
		const previousTs = previous?.ts;
		const ts = message.ts;

		if (message.role === "assistant") {
			const metrics = message.metrics;
			const elapsedMs =
				ts !== undefined && previousTs !== undefined ? ts - previousTs : 0;
			perModelTurn.push({
				eventIndex: index,
				tsUtc: ts === undefined ? undefined : toUtcTimestamp(ts),
				elapsedMs,
				inputTokens: metrics?.inputTokens ?? 0,
				outputTokens: metrics?.outputTokens ?? 0,
				cacheReadTokens: metrics?.cacheReadTokens ?? 0,
				cacheWriteTokens: metrics?.cacheWriteTokens ?? 0,
				modelId: message.modelInfo?.id,
				provider: message.modelInfo?.provider,
			});
		}

		if (previous && ts !== undefined && previousTs !== undefined) {
			const kind = classifyInterval(previous, message);
			const durationMs = ts - previousTs;
			intervalMsByKind[kind] += durationMs;
			intervals.push({
				kind,
				fromIndex: index - 1,
				toIndex: index,
				durationMs,
			});
		}
	}

	// --- Aggregate token sums --------------------------------------------
	let inputTokens = 0;
	let outputTokens = 0;
	let cacheReadTokens = 0;
	let cacheWriteTokens = 0;
	for (const turn of perModelTurn) {
		inputTokens += turn.inputTokens;
		outputTokens += turn.outputTokens;
		cacheReadTokens += turn.cacheReadTokens;
		cacheWriteTokens += turn.cacheWriteTokens;
	}

	// --- Elapsed --------------------------------------------------------
	const timestamps = messages
		.map((message) => message.ts)
		.filter((ts): ts is number => ts !== undefined);
	const elapsedMs =
		timestamps.length >= 2
			? timestamps[timestamps.length - 1] - timestamps[0]
			: 0;

	const modelId = perModelTurn.find((turn) => turn.modelId)?.modelId;
	const provider = perModelTurn.find((turn) => turn.provider)?.provider;

	return {
		sessionId: transcript.sessionId,
		model: modelId,
		provider,
		extensionVersion: transcript.origin?.version,
		elapsedMs: derived(elapsedMs),
		messageCount: derived(messages.length),
		modelTurns: derived(perModelTurn.length),
		toolInvocations: derived(perToolInvocation.length),
		toolInvocationsByName,
		validCommandStrings: derived(validCommandStrings),
		rejectedCommandSchemaInvocations: derived(rejectedCommandSchemaInvocations),
		rejectedCommandSchemaByShape,
		intervalMsByKind: {
			model: derived(intervalMsByKind.model),
			tool: derived(intervalMsByKind.tool),
			other: derived(intervalMsByKind.other),
		},
		inputTokens: reported(inputTokens),
		outputTokens: reported(outputTokens),
		cacheReadTokens: reported(cacheReadTokens),
		cacheWriteTokens: reported(cacheWriteTokens),
		compactionSnapshots: derived(perCompaction.length),
		perModelTurn,
		perToolInvocation,
		perCompaction,
	};
}
