/**
 * ACT-CLINEMM-TOOL-NORMALIZATION-LIVE-QUALIFICATION-01 — evidence analyzer.
 *
 * READ-ONLY. Derives the qualification facts from the LIVE artifacts that are
 * already on disk and writes a sanitized JSON summary to stdout.
 *
 *   bun tool/qualify.ts > analysis.json
 *
 * Artifacts read (all OUTSIDE the repository, never committed):
 *   - the live dogfood session transcript (Qwen baseline),
 *   - the live Round C session transcript (object-array / JSON-array-string),
 *   - the two live Flint session transcripts,
 *   - the live roundc latency trace (schema_validation / tool_execution /
 *     tool_result_delivered boundaries),
 *   - the live provider-request captures (the model-facing schema as sent).
 *
 * NOTHING raw is copied into the output: command texts, prompts, API keys and
 * provider payloads are reduced to SHAPES, COUNTS and tool-call ids.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";

const PROFILE = "/Volumes/UserData/Users/chistyakov/.vscodium-roz";
const SESSIONS = `${PROFILE}/cline-data/sessions`;
const CAPTURES = `${PROFILE}/cline-data/provider-request-captures`;

interface Block {
	type?: string;
	id?: string;
	name?: string;
	input?: Record<string, unknown>;
	content?: unknown;
	tool_use_id?: string;
}

interface Transcript {
	origin?: Record<string, unknown>;
	messages?: Array<{ content?: unknown }>;
}

/** Reduce a `run_commands` input to a SHAPE (no command text is retained). */
function shapeOf(input: unknown): string {
	if (input === null || typeof input !== "object" || Array.isArray(input)) {
		return `non_object:${Array.isArray(input) ? "array" : typeof input}`;
	}
	const record = input as Record<string, unknown>;
	const keys = Object.keys(record).sort();
	if (keys.length === 0) {
		return "object:{}";
	}
	const value = record[keys[0]!];
	let valueShape: string;
	if (Array.isArray(value)) {
		const memberTypes = value.map((m) =>
			m !== null && typeof m === "object" && !Array.isArray(m)
				? "object"
				: Array.isArray(m)
					? "array"
					: typeof m,
		);
		valueShape = `array[${memberTypes.join(",")}]`;
	} else if (typeof value === "string") {
		const trimmed = value.trim();
		if (trimmed.startsWith("[")) {
			let parsed: string;
			try {
				const decoded: unknown = JSON.parse(trimmed);
				if (!Array.isArray(decoded)) {
					parsed = "not_json";
				} else if (decoded.every((m) => typeof m === "string")) {
					parsed = "json_array_of_strings";
				} else if (
					decoded.every(
						(m) =>
							m !== null &&
							typeof m === "object" &&
							!Array.isArray(m),
					)
				) {
					parsed = "json_array_of_objects";
				} else {
					parsed = "json_array_mixed";
				}
			} catch {
				parsed = "not_json";
			}
			valueShape = `string:${parsed}`;
		} else {
			valueShape = "string:plain";
		}
	} else {
		valueShape = typeof value;
	}
	return `keys[${keys.join(",")}] ${valueShape}`;
}

/** The rejection verdict recorded in the transcript's own tool_result. */
function verdictOf(resultContent: unknown): "REJECTED" | "ACCEPTED" | "NO_RESULT" {
	if (resultContent === undefined) {
		return "NO_RESULT";
	}
	const text = resultText(resultContent);
	return text.includes("Invalid input for tool") ? "REJECTED" : "ACCEPTED";
}

function resultText(content: unknown): string {
	if (typeof content === "string") {
		return content;
	}
	if (Array.isArray(content)) {
		return content
			.map((p) =>
				p !== null && typeof p === "object"
					? String((p as { text?: unknown }).text ?? "")
					: String(p),
			)
			.join(" ");
	}
	return "";
}

function analyzeSession(sessionId: string): Record<string, unknown> {
	const path = `${SESSIONS}/${sessionId}/${sessionId}.messages.json`;
	if (!existsSync(path)) {
		return { sessionId, present: false };
	}
	const raw = readFileSync(path);
	const transcript = JSON.parse(raw.toString("utf8")) as Transcript;
	const uses = new Map<
		string,
		{ messageIndex: number; blockIndex: number; name: string; input: unknown }
	>();
	const results = new Map<string, unknown>();
	(transcript.messages ?? []).forEach((message, messageIndex) => {
		const content = message.content;
		if (!Array.isArray(content)) {
			return;
		}
		(content as Block[]).forEach((block, blockIndex) => {
			if (block?.type === "tool_use" && typeof block.id === "string") {
				uses.set(block.id, {
					messageIndex,
					blockIndex,
					name: String(block.name ?? ""),
					input: block.input,
				});
			}
			if (
				block?.type === "tool_result" &&
				typeof block.tool_use_id === "string"
			) {
				results.set(block.tool_use_id, block.content);
			}
		});
	});
	const runCommands = [...uses.entries()].filter(([, u]) => u.name === "run_commands");
	const byShape = new Map<string, number>();
	const byShapeVerdict = new Map<string, Record<string, number>>();
	const rejectionMessages = new Set<string>();
	for (const [id, use] of runCommands) {
		const shape = shapeOf(use.input);
		byShape.set(shape, (byShape.get(shape) ?? 0) + 1);
		const verdict = verdictOf(results.get(id));
		const bucket = byShapeVerdict.get(shape) ?? {};
		bucket[verdict] = (bucket[verdict] ?? 0) + 1;
		byShapeVerdict.set(shape, bucket);
		const match = /Invalid input for tool run_commands: ([^"\\]+)/.exec(
			resultText(results.get(id)),
		);
		if (match?.[1]) {
			rejectionMessages.add(match[1].trim());
		}
	}
	return {
		sessionId,
		present: true,
		transcriptSha256: createHash("sha256").update(raw).digest("hex"),
		originVersion: transcript.origin?.version ?? null,
		messageCount: transcript.messages?.length ?? 0,
		totalToolUse: uses.size,
		runCommandsCalls: runCommands.length,
		runCommandsShapes: Object.fromEntries(byShape),
		runCommandsShapeVerdicts: Object.fromEntries(byShapeVerdict),
		distinctRejectionMessages: [...rejectionMessages].sort(),
		toolCallIds: runCommands.map(([id]) => id).sort(),
	};
}

/** The model-facing `run_commands` schema as actually sent to the provider. */
function analyzeCaptures(): Record<string, unknown> {
	if (!existsSync(CAPTURES)) {
		return { present: false };
	}
	const files = readdirSync(CAPTURES)
		.filter((f) => f.endsWith(".provider-request.json"))
		.map((f) => `${CAPTURES}/${f}`);
	const perSession = new Map<
		string,
		{ strictJsonSchema: unknown; runCommandsSchemaHash: string; captures: number }
	>();
	for (const file of files) {
		let parsed: {
			correlation?: Record<string, unknown>;
			payload?: {
				providerOptions?: Record<string, unknown>;
				tools?: Record<string, unknown>;
			};
		};
		try {
			parsed = JSON.parse(readFileSync(file, "utf8"));
		} catch {
			continue;
		}
		const sessionId = String(parsed.correlation?.sessionId ?? "unknown");
		const providerOptions = parsed.payload?.providerOptions ?? {};
		const openaiCompatible = (providerOptions.openaiCompatible ?? {}) as Record<
			string,
			unknown
		>;
		const tools = parsed.payload?.tools ?? {};
		const runCommands = (tools.run_commands ?? {}) as Record<string, unknown>;
		const schemaHash = createHash("sha256")
			.update(JSON.stringify(runCommands.inputSchema ?? null))
			.digest("hex");
		const existing = perSession.get(sessionId);
		if (existing) {
			existing.captures += 1;
			continue;
		}
		perSession.set(sessionId, {
			strictJsonSchema: openaiCompatible.strictJsonSchema ?? null,
			runCommandsSchemaHash: schemaHash,
			captures: 1,
		});
	}
	return {
		present: true,
		captureFiles: files.length,
		perSession: Object.fromEntries(perSession),
	};
}

/** The live latency trace's normalization/execution/delivery boundaries. */
function analyzeTrace(tracePath: string): Record<string, unknown> {
	if (!existsSync(tracePath)) {
		return { present: false, path: tracePath };
	}
	const trace = JSON.parse(readFileSync(tracePath, "utf8")) as {
		sessionId?: string;
		identity?: Record<string, unknown>;
		events?: Array<{
			boundary?: string;
			phase?: string;
			metadata?: Record<string, unknown>;
		}>;
	};
	const events = trace.events ?? [];
	const start = (boundary: string) =>
		events.filter((e) => e.boundary === boundary && e.phase === "start");
	const idMap = (boundary: string) =>
		new Map(
			start(boundary).map((e) => [
				String(e.metadata?.toolCallId),
				e.metadata?.toolName,
			]),
		);
	const execStart = idMap("tool_execution");
	const execEnd = idMap("tool_execution");
	const deliveredStart = idMap("tool_result_delivered");
	const deliveredEnd = idMap("tool_result_delivered");
	const schemaValidations = start("schema_validation");
	const schemaValidTrue = schemaValidations.filter(
		(e) => e.metadata?.schemaValid === true,
	).length;
	const sameIds = (a: Map<string, unknown>, b: Map<string, unknown>) =>
		a.size === b.size && [...a.keys()].every((k) => b.has(k));
	const nameMismatches = [...execStart.keys()].filter(
		(k) => deliveredStart.has(k) && execStart.get(k) !== deliveredStart.get(k),
	);
	return {
		present: true,
		path: tracePath,
		sessionId: trace.sessionId ?? null,
		identity: trace.identity ?? null,
		schemaValidationStarts: schemaValidations.length,
		schemaValidationTrue: schemaValidTrue,
		schemaValidationTools: [
			...new Set(schemaValidations.map((e) => String(e.metadata?.toolName))),
		].sort(),
		toolExecutionStarts: execStart.size,
		toolExecutionEnds: execEnd.size,
		toolResultDeliveredStarts: deliveredStart.size,
		toolResultDeliveredEnds: deliveredEnd.size,
		executionStartEndIdsMatch: sameIds(execStart, execEnd),
		deliveryStartEndIdsMatch: sameIds(deliveredStart, deliveredEnd),
		deliveredIdsEqualExecutionIds: sameIds(execStart, deliveredStart),
		toolNameMismatchesBetweenExecutionAndDelivery: nameMismatches,
		toolCallIds: [...execStart.keys()].sort(),
	};
}

/** Cross-check the transcript's tool-call ids against the trace's. */
function correlate(
	transcript: Record<string, unknown>,
	trace: Record<string, unknown>,
): Record<string, unknown> {
	const transcriptIds = (transcript.toolCallIds as string[]) ?? [];
	const traceIds = (trace.toolCallIds as string[]) ?? [];
	const transcriptSet = new Set(transcriptIds);
	const traceSet = new Set(traceIds);
	const shared = [...transcriptSet].filter((id) => traceSet.has(id));
	return {
		transcriptToolCallIds: transcriptIds.length,
		traceToolCallIds: traceIds.length,
		sharedToolCallIds: shared.length,
		transcriptOnly: [...transcriptSet].filter((id) => !traceSet.has(id)).sort(),
		traceOnly: [...traceSet].filter((id) => !transcriptSet.has(id)).sort(),
	};
}

const QWEN = "1794892591345_7em4g";
const ROUND_C = "1794702518894_gui73";
const FLINT_A = "1794587196390_xn030";
const FLINT_B = "1794593797996_r48lj";
const TRACE = "/Volumes/UserData/Users/chistyakov/Downloads/roundc-latency-trace(8).json";

const qwen = analyzeSession(QWEN);
const roundC = analyzeSession(ROUND_C);
const flintA = analyzeSession(FLINT_A);
const flintB = analyzeSession(FLINT_B);
const trace = analyzeTrace(TRACE);

const result = {
	act: "ACT-CLINEMM-TOOL-NORMALIZATION-LIVE-QUALIFICATION-01",
	generatedBy: "tool/qualify.ts (read-only)",
	artifactClassification: "PRIVATE_IN",
	committedContent: "SANITIZED_SHAPES_AND_COUNTS_ONLY",
	sessions: {
		qwenBaseline: qwen,
		roundCLive: roundC,
		flintPreFix: flintA,
		flintPostFix: flintB,
	},
	trace,
	traceTranscriptCorrelation: correlate(qwen, trace),
	providerRequests: analyzeCaptures(),
	secretsRedaction: {
		providerApiKeysRead: false,
		promptsRead: false,
		commandTextRetained: false,
	},
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
