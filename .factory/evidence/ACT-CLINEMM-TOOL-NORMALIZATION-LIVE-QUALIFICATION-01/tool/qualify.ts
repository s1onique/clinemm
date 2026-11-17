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

/**
 * CORRECTION01 — the path seam.
 *
 * The analyzer previously hard-coded every artifact path, which made it
 * impossible to drive against an ADVERSARIAL fixture. These overrides are the
 * test seam the witness uses. They default to the REAL artifact locations, so
 * the unqualified invocation still analyses the real evidence.
 *
 *   CLINE_QUALIFY_PROFILE   the VSCodium profile root
 *   CLINE_QUALIFY_TRACE     the latency trace path
 */
const PROFILE_ROOT = process.env.CLINE_QUALIFY_PROFILE ?? PROFILE;
const SESSIONS_ROOT =
	process.env.CLINE_QUALIFY_SESSIONS ?? `${PROFILE_ROOT}/cline-data/sessions`;
const CAPTURES_ROOT =
	process.env.CLINE_QUALIFY_CAPTURES ??
	`${PROFILE_ROOT}/cline-data/provider-request-captures`;

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
	const path = `${SESSIONS_ROOT}/${sessionId}/${sessionId}.messages.json`;
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
		/**
		 * CORRECTION01 — the ids of EVERY tool call in the transcript, not
		 * only the `run_commands` ones.
		 *
		 * The prior analyzer compared the transcript's `run_commands`-ONLY id
		 * list against the trace's ALL-tool id list, which is an
		 * apples-to-oranges comparison and produced a spurious "5 trace-only"
		 * difference. The trace-only ids were in fact the non-`run_commands`
		 * calls (3 x read_files, 1 x fetch_web_content, 1 x submit_and_exit),
		 * which ARE present in the transcript.
		 */
		allToolCallIds: [...uses.keys()].sort(),
		allToolCallNamesById: Object.fromEntries(
			[...uses.entries()].map(([id, u]) => [id, u.name]),
		),
	};
}

/**
 * CORRECTION01 — the model-facing `run_commands` schema as actually sent to
 * the provider.
 *
 * DEFECT B (RED, reproduced): the prior implementation read ONLY the FIRST
 * capture of each session and `continue`d on every later capture. A second
 * capture in the same session with a DIFFERENT `run_commands` schema hash was
 * therefore invisible, and the "all captures carry a byte-identical schema"
 * claim was unfalsifiable.
 *
 * DEFECT C (RED, reproduced): `strictJsonSchema ?? null` collapsed a MISSING
 * value into `null`, which is indistinguishable from a recorded `false` in a
 * boolean reading. A capture with no `strictJsonSchema` field must read as
 * `UNKNOWN` — never as `false`.
 *
 * The corrected implementation inspects EVERY capture and reports the parsed
 * / invalid / missing-field counts explicitly. Schema consistency and
 * strictness are DERIVED from the observed values, never assumed.
 */
interface CaptureSessionSummary {
	/** Every capture inspected for this session. */
	captures: number;
	/** Distinct `run_commands` inputSchema hashes observed. */
	runCommandsSchemaHashes: string[];
	/** True only when EVERY inspected capture agreed on ONE hash. */
	runCommandsSchemaConsistent: boolean;
	/** The observed `strictJsonSchema` values, verbatim. */
	strictJsonSchemaValues: unknown[];
	/** The DERIVED strictness finding. */
	strictJsonSchemaFinding: "FALSE" | "TRUE" | "UNKNOWN" | "MIXED";
	/** True when at least one capture omitted the field entirely. */
	strictJsonSchemaMissingInSomeCapture: boolean;
}

function analyzeCaptures(): Record<string, unknown> {
	if (!existsSync(CAPTURES_ROOT)) {
		return { present: false };
	}
	const files = readdirSync(CAPTURES_ROOT)
		.filter((f) => f.endsWith(".provider-request.json"))
		.map((f) => `${CAPTURES_ROOT}/${f}`);

	const perSession = new Map<string, CaptureSessionSummary>();
	let parsedCount = 0;
	let invalidCount = 0;
	let missingCorrelationCount = 0;
	let missingToolSchemaCount = 0;
	let missingStrictFieldCount = 0;
	const missingStrictFieldFiles: string[] = [];
	const invalidFiles: string[] = [];

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
			// An UNPARSEABLE capture is counted, not skipped: it is a real
			// observation about the capture set.
			invalidCount += 1;
			invalidFiles.push(file);
			continue;
		}
		parsedCount += 1;

		const sessionId = parsed.correlation?.sessionId;
		if (typeof sessionId !== "string" || sessionId.length === 0) {
			missingCorrelationCount += 1;
			continue;
		}
		const providerOptions = parsed.payload?.providerOptions ?? {};
		const openaiCompatible = (providerOptions.openaiCompatible ?? {}) as Record<
			string,
			unknown
		>;
		const tools = parsed.payload?.tools ?? {};
		const runCommands = (tools.run_commands ?? {}) as Record<string, unknown>;
		if (!("inputSchema" in runCommands)) {
			missingToolSchemaCount += 1;
		}
		const schemaHash = createHash("sha256")
			.update(JSON.stringify(runCommands.inputSchema ?? null))
			.digest("hex");

		// The strictness value is read VERBATIM. `undefined` means the field
		// was absent — it is NOT the same as `false`.
		const hasStrictField = Object.prototype.hasOwnProperty.call(
			openaiCompatible,
			"strictJsonSchema",
		);
		const strictValue = hasStrictField
			? openaiCompatible.strictJsonSchema
			: undefined;
		if (!hasStrictField) {
			missingStrictFieldCount += 1;
			missingStrictFieldFiles.push(file);
		}

		const existing = perSession.get(sessionId);
		if (existing) {
			// EVERY capture contributes to the session's finding. The prior
			// implementation stopped here.
			existing.captures += 1;
			if (!existing.runCommandsSchemaHashes.includes(schemaHash)) {
				existing.runCommandsSchemaHashes.push(schemaHash);
			}
			existing.strictJsonSchemaValues.push(strictValue);
			existing.strictJsonSchemaMissingInSomeCapture =
				existing.strictJsonSchemaMissingInSomeCapture || !hasStrictField;
			existing.runCommandsSchemaConsistent =
				existing.runCommandsSchemaHashes.length === 1;
			continue;
		}
		perSession.set(sessionId, {
			captures: 1,
			runCommandsSchemaHashes: [schemaHash],
			runCommandsSchemaConsistent: true,
			strictJsonSchemaValues: [strictValue],
			strictJsonSchemaFinding: "UNKNOWN",
			strictJsonSchemaMissingInSomeCapture: !hasStrictField,
		});
	}

	// DERIVE the strictness finding from the observed values.
	for (const summary of perSession.values()) {
		const observed = summary.strictJsonSchemaValues.filter(
			(v) => v !== undefined,
		);
		const distinct = new Set(observed.map((v) => JSON.stringify(v)));
		if (observed.length === 0) {
			summary.strictJsonSchemaFinding = "UNKNOWN";
		} else if (distinct.size > 1) {
			summary.strictJsonSchemaFinding = "MIXED";
		} else if (observed[0] === false) {
			summary.strictJsonSchemaFinding = "FALSE";
		} else if (observed[0] === true) {
			summary.strictJsonSchemaFinding = "TRUE";
		} else {
			summary.strictJsonSchemaFinding = "UNKNOWN";
		}
	}

	const allHashes = new Set<string>();
	for (const summary of perSession.values()) {
		for (const hash of summary.runCommandsSchemaHashes) {
			allHashes.add(hash);
		}
	}
	const allStrictFindings = new Set(
		[...perSession.values()].map((s) => s.strictJsonSchemaFinding),
	);
	const inconsistentSessions = [...perSession.entries()]
		.filter(([, s]) => !s.runCommandsSchemaConsistent)
		.map(([id]) => id)
		.sort();

	return {
		present: true,
		captureFiles: files.length,
		parsedCaptures: parsedCount,
		invalidCaptures: invalidCount,
		invalidCaptureFiles: invalidFiles.map((f) => f.split("/").pop() ?? f),
		capturesMissingCorrelation: missingCorrelationCount,
		capturesMissingToolSchema: missingToolSchemaCount,
		capturesMissingStrictJsonSchemaField: missingStrictFieldCount,
		missingStrictFieldFiles: missingStrictFieldFiles.map(
			(f) => f.split("/").pop() ?? f,
		),
		distinctRunCommandsSchemaHashesAcrossAllCaptures: [...allHashes].sort(),
		allCapturesShareOneRunCommandsSchema:
			allHashes.size === 1 && parsedCount > 0,
		sessionsWithInconsistentRunCommandsSchema: inconsistentSessions,
		strictJsonSchemaFindingsAcrossSessions: [...allStrictFindings].sort(),
		strictJsonSchemaFinding:
			allStrictFindings.size === 1
				? [...allStrictFindings][0]
				: allStrictFindings.size === 0
					? "UNKNOWN"
					: "MIXED",
		perSession: Object.fromEntries(perSession),
	};
}

/**
 * CORRECTION01 — the live latency trace's normalization/execution/delivery
 * boundaries.
 *
 * DEFECT A (RED, reproduced): the prior implementation built BOTH the "start"
 * and the "end" maps with the SAME helper, which filtered on
 * `phase === "start"`. The "end" maps were therefore copies of the "start"
 * maps, and `executionStartEndIdsMatch` / `deliveryStartEndIdsMatch` were
 * TAUTOLOGICALLY TRUE: a MISSING `end` event could never fail them. The
 * counts reported as `toolExecutionEnds` / `toolResultDeliveredEnds` were the
 * START counts, not the end counts.
 *
 * The corrected implementation selects `start` and `end` INDEPENDENTLY and
 * compares CARDINALITY, the ID SETS, the ORDERING (a start must be followed by
 * its own end, in time) and the tool names.
 */
interface BoundaryEvents {
	starts: Array<{
		toolCallId: string;
		toolName: string;
		monotonicMs: number;
	}>;
	ends: Array<{
		toolCallId: string;
		toolName: string;
		monotonicMs: number;
	}>;
}

function collectBoundary(
	events: Array<{
		boundary?: string;
		phase?: string;
		monotonicMs?: number;
		metadata?: Record<string, unknown>;
	}>,
	boundary: string,
): BoundaryEvents {
	const starts: BoundaryEvents["starts"] = [];
	const ends: BoundaryEvents["ends"] = [];
	for (const e of events) {
		if (e.boundary !== boundary) {
			continue;
		}
		const entry = {
			toolCallId: String(e.metadata?.toolCallId ?? ""),
			toolName: String(e.metadata?.toolName ?? ""),
			monotonicMs: Number(e.monotonicMs ?? Number.NaN),
		};
		if (e.phase === "start") {
			starts.push(entry);
		} else if (e.phase === "end") {
			ends.push(entry);
		}
	}
	return { starts, ends };
}

/** The ID sets are equal. */
function idSetsEqual(a: string[], b: string[]): boolean {
	const sa = new Set(a);
	const sb = new Set(b);
	return sa.size === sb.size && [...sa].every((k) => sb.has(k));
}

/**
 * Every `start` has exactly one matching `end` with the SAME tool call id and
 * the SAME tool name, and the end is not EARLIER than its start.
 */
function pairsAreWellFormed(events: BoundaryEvents): {
	wellFormed: boolean;
	unmatchedStartIds: string[];
	unmatchedEndIds: string[];
	toolNameMismatches: string[];
	endBeforeStartIds: string[];
} {
	const startById = new Map(events.starts.map((e) => [e.toolCallId, e]));
	const endById = new Map(events.ends.map((e) => [e.toolCallId, e]));
	const unmatchedStartIds = events.starts
		.map((e) => e.toolCallId)
		.filter((id) => !endById.has(id));
	const unmatchedEndIds = events.ends
		.map((e) => e.toolCallId)
		.filter((id) => !startById.has(id));
	const toolNameMismatches = [...startById.entries()]
		.filter(([id, s]) => {
			const e = endById.get(id);
			return e !== undefined && e.toolName !== s.toolName;
		})
		.map(([id]) => id);
	const endBeforeStartIds = [...startById.entries()]
		.filter(([id, s]) => {
			const e = endById.get(id);
			return (
				e !== undefined &&
				Number.isFinite(s.monotonicMs) &&
				Number.isFinite(e.monotonicMs) &&
				e.monotonicMs < s.monotonicMs
			);
		})
		.map(([id]) => id);
	return {
		wellFormed:
			unmatchedStartIds.length === 0 &&
			unmatchedEndIds.length === 0 &&
			toolNameMismatches.length === 0 &&
			endBeforeStartIds.length === 0 &&
			events.starts.length === events.ends.length,
		unmatchedStartIds: unmatchedStartIds.sort(),
		unmatchedEndIds: unmatchedEndIds.sort(),
		toolNameMismatches: toolNameMismatches.sort(),
		endBeforeStartIds: endBeforeStartIds.sort(),
	};
}

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
			monotonicMs?: number;
			metadata?: Record<string, unknown>;
		}>;
	};
	const events = trace.events ?? [];

	const exec = collectBoundary(events, "tool_execution");
	const delivered = collectBoundary(events, "tool_result_delivered");
	const execPairs = pairsAreWellFormed(exec);
	const deliveredPairs = pairsAreWellFormed(delivered);

	const schemaValidations = events.filter(
		(e) => e.boundary === "schema_validation" && e.phase === "start",
	);
	const schemaValidationEnds = events.filter(
		(e) => e.boundary === "schema_validation" && e.phase === "end",
	);
	const schemaValidTrue = schemaValidations.filter(
		(e) => e.metadata?.schemaValid === true,
	).length;

	const execIds = exec.starts.map((e) => e.toolCallId);
	const deliveredIds = delivered.starts.map((e) => e.toolCallId);
	const execEndIds = exec.ends.map((e) => e.toolCallId);
	const deliveredEndIds = delivered.ends.map((e) => e.toolCallId);

	const nameMismatches = exec.starts
		.filter((s) => {
			const d = delivered.starts.find((x) => x.toolCallId === s.toolCallId);
			return d !== undefined && d.toolName !== s.toolName;
		})
		.map((s) => s.toolCallId);

	return {
		present: true,
		path: tracePath,
		sessionId: trace.sessionId ?? null,
		identity: trace.identity ?? null,
		schemaValidationStarts: schemaValidations.length,
		schemaValidationEnds: schemaValidationEnds.length,
		schemaValidationStartEndCountsMatch:
			schemaValidations.length === schemaValidationEnds.length,
		schemaValidTrue: schemaValidTrue,
		schemaValidationTools: [
			...new Set(schemaValidations.map((e) => String(e.metadata?.toolName))),
		].sort(),
		toolExecutionStarts: exec.starts.length,
		toolExecutionEnds: exec.ends.length,
		toolResultDeliveredStarts: delivered.starts.length,
		toolResultDeliveredEnds: delivered.ends.length,
		executionStartEndIdsMatch: idSetsEqual(execIds, execEndIds),
		deliveryStartEndIdsMatch: idSetsEqual(deliveredIds, deliveredEndIds),
		deliveredIdsEqualExecutionIds: idSetsEqual(execIds, deliveredIds),
		executionPairsWellFormed: execPairs.wellFormed,
		deliveryPairsWellFormed: deliveredPairs.wellFormed,
		executionUnmatchedStartIds: execPairs.unmatchedStartIds,
		executionUnmatchedEndIds: execPairs.unmatchedEndIds,
		deliveryUnmatchedStartIds: deliveredPairs.unmatchedStartIds,
		deliveryUnmatchedEndIds: deliveredPairs.unmatchedEndIds,
		executionEndBeforeStartIds: execPairs.endBeforeStartIds,
		deliveryEndBeforeStartIds: deliveredPairs.endBeforeStartIds,
		toolNameMismatchesBetweenExecutionAndDelivery: nameMismatches.sort(),
		toolCallIds: [...execIds].sort(),
		/** The tool name of every `tool_execution` start, by tool-call id. */
		toolCallNamesById: Object.fromEntries(
			exec.starts.map((e) => [e.toolCallId, e.toolName]),
		),
	};
}

/**
 * CORRECTION01 — cross-check the transcript's tool-call ids against the
 * trace's.
 *
 * The comparison is now LIKE-FOR-LIKE: the transcript's ALL tool-call ids are
 * compared against the trace's ALL `tool_execution` ids. The prior analyzer
 * compared the transcript's `run_commands`-only ids against the trace's
 * all-tool ids, which manufactured a spurious "5 trace-only" difference: those
 * 5 ids were the non-`run_commands` calls (3 x read_files, 1 x
 * fetch_web_content, 1 x submit_and_exit), and they ARE in the transcript.
 */
function correlate(
	transcript: Record<string, unknown>,
	trace: Record<string, unknown>,
): Record<string, unknown> {
	const transcriptIds = (transcript.allToolCallIds as string[]) ?? [];
	const traceIds = (trace.toolCallIds as string[]) ?? [];
	const transcriptNames = (transcript.allToolCallNamesById ?? {}) as Record<
		string,
		string
	>;
	const traceNames = (trace.toolCallNamesById ?? {}) as Record<string, string>;
	const transcriptSet = new Set(transcriptIds);
	const traceSet = new Set(traceIds);
	const shared = [...transcriptSet].filter((id) => traceSet.has(id));
	const nameMismatches = shared
		.filter((id) => transcriptNames[id] !== traceNames[id])
		.sort();
	return {
		comparison: "LIKE_FOR_LIKE_ALL_TOOL_CALLS",
		transcriptToolCallIds: transcriptIds.length,
		traceToolCallIds: traceIds.length,
		sharedToolCallIds: shared.length,
		transcriptOnly: [...transcriptSet].filter((id) => !traceSet.has(id)).sort(),
		traceOnly: [...traceSet].filter((id) => !transcriptSet.has(id)).sort(),
		toolNameMismatchesOnSharedIds: nameMismatches,
		transcriptToolCallNamesById: transcriptNames,
		traceToolCallNamesById: traceNames,
	};
}

const QWEN = "1794892591345_7em4g";
const ROUND_C = "1794702518894_gui73";
const FLINT_A = "1794587196390_xn030";
const FLINT_B = "1794593797996_r48lj";
const TRACE =
	process.env.CLINE_QUALIFY_TRACE ??
	"/Volumes/UserData/Users/chistyakov/Downloads/roundc-latency-trace(8).json";

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
