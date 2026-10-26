#!/usr/bin/env bun
/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-TRACE01 — offline A/B comparator.
 *
 * Compares two exported model behavior traces (explicitly labelled M3 and
 * M3.1) and produces:
 *
 *   - a compact Markdown comparison,
 *   - a machine-readable JSON summary.
 *
 * WHAT THIS TOOL DOES NOT DO
 * --------------------------
 * It does NOT declare one model "better". A trace comparison answers
 * "what observably differed", not "which model is better". Fewer tool calls
 * is not, by itself, a win — it can equally mean less work was done.
 *
 * Every repetition metric is reported as a HEURISTIC, never as proof of a
 * model defect. Expected retries, polling, and repeated tests after a source
 * change are explicitly separated from "the model repeated itself".
 *
 * USAGE
 * -----
 *   bun scripts/compare-model-behavior-traces.ts \
 *     --m3 <trace-a.jsonl> \
 *     --m3.1 <trace-b.jsonl> \
 *     --md <out.md> \
 *     --json <out.json>
 *
 * The two inputs are explicitly labelled: the first is M3, the second M3.1.
 *
 * INCOMPATIBILITY
 * ----------------
 * A comparison is FLAGGED (and marked `compatible: false`) when the two
 * traces differ materially in source HEAD, tool configuration, context
 * ceiling, reasoning policy, or test workload — because in those cases the
 * difference between the traces cannot be attributed to the model.
 */

import { readFile, writeFile } from "node:fs/promises";

// ============================================================================
// Types
// ============================================================================

/** One recorded observation, as written by the recorder. */
interface TraceRecord {
	seq: number;
	timestamp: string;
	traceId: string;
	event: string;
	evidenceBoundary: string;
	sessionId?: string;
	taskId?: string;
	runId?: string;
	iteration?: number;
	providerId?: string;
	modelId?: string;
	payload: Record<string, unknown>;
}

/** The summary line the dump appends. */
interface TraceSummary {
	kind: "summary";
	traceId: string;
	dumpedAt: string;
	truncation: {
		truncated: boolean;
		droppedCount: number;
		droppedFromSeq?: number;
		droppedToSeq?: number;
		totalRecorded: number;
		retainedCount: number;
		retainedBytes: number;
	};
}

/** A parsed trace file. */
interface ParsedTrace {
	label: "M3" | "M3.1";
	records: TraceRecord[];
	summary?: TraceSummary;
}

/** One material difference between the two traces. */
interface MaterialDifference {
	dimension: string;
	m3: string;
	m31: string;
	severity: "material" | "informational";
	reason: string;
}

/** The repetition / error statistics computed for one trace. */
interface TraceStatistics {
	totalToolCalls: number;
	exactRepeatedActionCount: number;
	nonConsecutiveRepetitionCount: number;
	consecutiveErrorStreakMax: number;
	repeatedVerificationAttempts: number;
	compactionCount: number;
	repeatedActionsAfterCompaction: number;
	completionReason?: string;
	acceptedGateCount: number;
	toolCallsPerAcceptedGate?: number;
	timeToFirstFileEditMs?: number;
	timeToFirstExecutableGateMs?: number;
	truncated: boolean;
	droppedCount: number;
}

/** The machine-readable summary. */
interface ComparisonSummary {
	compatible: boolean;
	labels: { m3: string; m31: string };
	materialDifferences: MaterialDifference[];
	statistics: { m3: TraceStatistics; m31: TraceStatistics };
	configurationDifferences: Record<string, { m3: string; m31: string }>;
	repetitionInterpretation: string;
	completionEvidence: {
		m3?: string;
		m31?: string;
		m3AcceptedGates?: number;
		m31AcceptedGates?: number;
	};
	timelineSections: {
		compactions: { m3: TimelineSlice[]; m31: TimelineSlice[] };
		suspectedLoops: { m3: TimelineSlice[]; m31: TimelineSlice[] };
	};
	warnings: string[];
}

/** A short excerpt of the timeline around an interesting boundary. */
interface TimelineSlice {
	at: string;
	seq: number;
	event: string;
	detail: string;
}

// ============================================================================
// CLI parsing
// ============================================================================

interface CliOptions {
	m3Path: string;
	m31Path: string;
	mdPath?: string;
	jsonPath?: string;
}

function parseArgs(argv: string[]): CliOptions {
	const options: Partial<CliOptions> = {};
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		const next = argv[index + 1];
		switch (arg) {
			case "--m3":
				options.m3Path = next ?? "";
				index += 1;
				break;
			case "--m3.1":
				options.m31Path = next ?? "";
				index += 1;
				break;
			case "--md":
				options.mdPath = next ?? "";
				index += 1;
				break;
			case "--json":
				options.jsonPath = next ?? "";
				index += 1;
				break;
			default:
				break;
		}
	}
	if (!options.m3Path || !options.m31Path) {
		throw new Error(
			"usage: compare-model-behavior-traces.ts --m3 <a.jsonl> --m3.1 <b.jsonl> [--md out.md] [--json out.json]",
		);
	}
	return options as CliOptions;
}

// ============================================================================
// Parsing
// ============================================================================

async function parseTrace(
	path: string,
	label: "M3" | "M3.1",
): Promise<ParsedTrace> {
	const raw = await readFile(path, "utf8");
	const records: TraceRecord[] = [];
	let summary: TraceSummary | undefined;
	for (const line of raw.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) {
			continue;
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(trimmed);
		} catch {
			continue;
		}
		if (typeof parsed !== "object" || parsed === null) {
			continue;
		}
		const object = parsed as Record<string, unknown>;
		if (object.kind === "summary") {
			summary = object as unknown as TraceSummary;
			continue;
		}
		if (typeof object.event === "string" && typeof object.seq === "number") {
			records.push(object as unknown as TraceRecord);
		}
	}
	return { label, records, summary };
}

// ============================================================================
// Analysis
// ============================================================================

/**
 * Tool names that represent a verification / executable gate.
 *
 * The tool name is normalized the same way the recorder normalizes it
 * (`_`, `-`, and `.` become spaces) so that snake_case tool names such as
 * `run_tests` are matched as "run tests".
 */
const VERIFICATION_TOOL_PATTERN =
	/(^| )(test|tests|spec|specs|jest|vitest|pytest|mocha|typecheck|lint|build|check|coverage)( |$)/i;

/** Tool names that represent a file edit. */
const FILE_EDIT_TOOL_PATTERN =
	/(^| )(write|edit|create|apply patch|patch|replace|insert|update)( |$)/i;

/**
 * Normalize a tool name for category matching.
 */
function normalizeToolName(name: string): string {
	return name.toLowerCase().replace(/[_\-.]+/g, " ");
}

/**
 * The action key used for repetition detection.
 *
 * Uses the tool name plus the stable-within-trace argument fingerprint. The
 * fingerprint is already privacy-preserving, so comparing it reveals no
 * argument content.
 */
function actionKey(record: TraceRecord): string | undefined {
	const name = record.payload.toolName;
	const fingerprint = record.payload.argumentFingerprint;
	if (typeof name !== "string") {
		return undefined;
	}
	return typeof fingerprint === "string" ? `${name}#${fingerprint}` : name;
}

function timestampMs(record: TraceRecord): number {
	const parsed = Date.parse(record.timestamp);
	return Number.isFinite(parsed) ? parsed : 0;
}

function computeStatistics(trace: ParsedTrace): TraceStatistics {
	const toolStarts = trace.records.filter(
		(record) => record.event === "tool_start",
	);
	const toolFinishes = trace.records.filter(
		(record) => record.event === "tool_finish",
	);
	const compactions = trace.records.filter(
		(record) => record.event === "compaction_completed",
	);

	// Exact repeated actions within the same run.
	const seenByRun = new Map<string, Set<string>>();
	let exactRepeatedActionCount = 0;
	// Non-consecutive repetition: an action revisited after other work.
	const lastIndexByAction = new Map<string, number>();
	let nonConsecutiveRepetitionCount = 0;

	for (let index = 0; index < toolStarts.length; index += 1) {
		const record = toolStarts[index];
		const key = actionKey(record);
		if (!key) {
			continue;
		}
		const runKey = record.runId ?? "no-run";
		let seen = seenByRun.get(runKey);
		if (!seen) {
			seen = new Set<string>();
			seenByRun.set(runKey, seen);
		}
		if (seen.has(key)) {
			exactRepeatedActionCount += 1;
		}
		seen.add(key);

		const lastIndex = lastIndexByAction.get(key);
		if (lastIndex !== undefined && lastIndex !== index - 1) {
			nonConsecutiveRepetitionCount += 1;
		}
		lastIndexByAction.set(key, index);
	}

	// Consecutive error streak.
	let consecutiveErrorStreakMax = 0;
	let currentErrorStreak = 0;
	for (const record of toolFinishes) {
		if (record.payload.outcome === "error") {
			currentErrorStreak += 1;
			consecutiveErrorStreakMax = Math.max(
				consecutiveErrorStreakMax,
				currentErrorStreak,
			);
		} else {
			currentErrorStreak = 0;
		}
	}

	// Repeated verification attempts (test/verification actions re-run).
	const verificationCounts = new Map<string, number>();
	for (const record of toolStarts) {
		const name = record.payload.toolName;
		if (
			typeof name !== "string" ||
			!VERIFICATION_TOOL_PATTERN.test(normalizeToolName(name))
		) {
			continue;
		}
		const key = actionKey(record);
		if (!key) {
			continue;
		}
		verificationCounts.set(key, (verificationCounts.get(key) ?? 0) + 1);
	}
	let repeatedVerificationAttempts = 0;
	for (const count of verificationCounts.values()) {
		if (count > 1) {
			repeatedVerificationAttempts += count - 1;
		}
	}

	// Repeated actions after a compaction: an action that already happened
	// BEFORE the compaction boundary and happened again AFTER it.
	let repeatedActionsAfterCompaction = 0;
	const actionsBeforeCompaction = new Set<string>();
	let sawCompaction = false;
	for (const record of trace.records) {
		if (record.event === "compaction_completed") {
			sawCompaction = true;
			continue;
		}
		if (record.event !== "tool_start") {
			continue;
		}
		const key = actionKey(record);
		if (!key) {
			continue;
		}
		if (sawCompaction) {
			if (actionsBeforeCompaction.has(key)) {
				repeatedActionsAfterCompaction += 1;
			}
		} else {
			actionsBeforeCompaction.add(key);
		}
	}

	// Milestones.
	let timeToFirstFileEditMs: number | undefined;
	let timeToFirstExecutableGateMs: number | undefined;
	const firstRecord = trace.records[0];
	for (const record of toolStarts) {
		const name = record.payload.toolName;
		if (typeof name !== "string") {
			continue;
		}
		const normalizedName = normalizeToolName(name);
		const elapsed = firstRecord
			? timestampMs(record) - timestampMs(firstRecord)
			: 0;
		if (
			timeToFirstFileEditMs === undefined &&
			FILE_EDIT_TOOL_PATTERN.test(normalizedName)
		) {
			timeToFirstFileEditMs = elapsed;
		}
		if (
			timeToFirstExecutableGateMs === undefined &&
			VERIFICATION_TOOL_PATTERN.test(normalizedName)
		) {
			timeToFirstExecutableGateMs = elapsed;
		}
	}

	// Completion / termination.
	const termination = [...trace.records]
		.reverse()
		.find((record) => record.event === "run_terminated");
	const completionReason =
		typeof termination?.payload.finishReason === "string"
			? termination.payload.finishReason
			: undefined;

	// Accepted gates: verification actions that SUCCEEDED.
	const acceptedGateCount = toolFinishes.filter(
		(record) =>
			record.payload.outcome === "success" &&
			typeof record.payload.toolName === "string" &&
			VERIFICATION_TOOL_PATTERN.test(
				normalizeToolName(record.payload.toolName),
			),
	).length;

	const totalToolCalls = toolStarts.length;
	const toolCallsPerAcceptedGate =
		acceptedGateCount > 0
			? Number((totalToolCalls / acceptedGateCount).toFixed(3))
			: undefined;

	return {
		totalToolCalls,
		exactRepeatedActionCount,
		nonConsecutiveRepetitionCount,
		consecutiveErrorStreakMax,
		repeatedVerificationAttempts,
		compactionCount: compactions.length,
		repeatedActionsAfterCompaction,
		...(completionReason ? { completionReason } : {}),
		acceptedGateCount,
		...(toolCallsPerAcceptedGate !== undefined
			? { toolCallsPerAcceptedGate }
			: {}),
		...(timeToFirstFileEditMs !== undefined ? { timeToFirstFileEditMs } : {}),
		...(timeToFirstExecutableGateMs !== undefined
			? { timeToFirstExecutableGateMs }
			: {}),
		truncated: trace.summary?.truncation.truncated ?? false,
		droppedCount: trace.summary?.truncation.droppedCount ?? 0,
	};
}

/**
 * Extract the model configuration snapshot from a trace.
 */
function extractConfig(trace: ParsedTrace): Record<string, string> {
	const config = trace.records.find(
		(record) => record.event === "model_config",
	);
	if (!config) {
		return {};
	}
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(config.payload)) {
		out[key] = typeof value === "string" ? value : JSON.stringify(value);
	}
	return out;
}

/**
 * Compare the two traces' configurations and flag MATERIAL differences.
 *
 * The dimensions that make a comparison INVALID are the ones the ACT names:
 * source HEAD, tool configuration, context ceiling, reasoning policy, and
 * test workload. When any of those differ, the difference between the two
 * traces cannot be attributed to the model.
 */
function compareConfiguration(
	m3: ParsedTrace,
	m31: ParsedTrace,
): {
	differences: MaterialDifference[];
	fields: Record<string, { m3: string; m31: string }>;
} {
	const m3Config = extractConfig(m3);
	const m31Config = extractConfig(m31);
	const differences: MaterialDifference[] = [];
	const fields: Record<string, { m3: string; m31: string }> = {};

	const materialDimensions: Array<{ key: string; reason: string }> = [
		{
			key: "sourceHead",
			reason:
				"different source HEAD — behavior differences may come from the code, not the model",
		},
		{
			key: "extensionVersion",
			reason:
				"different extension version — behavior differences may come from the build, not the model",
		},
		{
			key: "userContextCeiling",
			reason:
				"different user context ceiling — the compaction boundary differs, so the traces are not comparable",
		},
		{
			key: "reasoningEffort",
			reason:
				"different reasoning policy — the models were asked to do different things",
		},
		{
			key: "thinkingEnabled",
			reason:
				"different thinking mode — the models were asked to do different things",
		},
		{
			key: "toolCount",
			reason:
				"different tool configuration — the effective action space differs",
		},
		{
			key: "toolNames",
			reason:
				"different tool configuration — the effective action space differs",
		},
		{
			key: "maxOutputTokens",
			reason:
				"different output budget — the models were allowed to do different amounts of work per call",
		},
	];

	for (const dimension of materialDimensions) {
		const left = m3Config[dimension.key] ?? "UNAVAILABLE_FROM_TRACE";
		const right = m31Config[dimension.key] ?? "UNAVAILABLE_FROM_TRACE";
		fields[dimension.key] = { m3: left, m31: right };
		if (left !== right) {
			differences.push({
				dimension: dimension.key,
				m3: left,
				m31: right,
				severity: "material",
				reason: dimension.reason,
			});
		}
	}

	// Informational dimensions — reported, not disqualifying.
	for (const key of [
		"selectedProviderId",
		"selectedModelId",
		"runtimeProviderId",
		"runtimeModelId",
		"providerConfirmedModelId",
		"temperature",
		"topP",
		"contextWindow",
		"maxInputTokens",
	]) {
		const left = m3Config[key] ?? "UNAVAILABLE_FROM_TRACE";
		const right = m31Config[key] ?? "UNAVAILABLE_FROM_TRACE";
		fields[key] = { m3: left, m31: right };
		if (left !== right) {
			differences.push({
				dimension: key,
				m3: left,
				m31: right,
				severity: "informational",
				reason:
					"configuration difference reported for context; it does not by itself invalidate the comparison",
			});
		}
	}

	return { differences, fields };
}

/**
 * Build the timeline slices around compactions and suspected loops.
 */
function buildTimelineSections(trace: ParsedTrace): {
	compactions: TimelineSlice[];
	suspectedLoops: TimelineSlice[];
} {
	const compactions: TimelineSlice[] = [];
	const suspectedLoops: TimelineSlice[] = [];

	for (const record of trace.records) {
		if (record.event === "compaction_completed") {
			compactions.push({
				at: record.timestamp,
				seq: record.seq,
				event: record.event,
				detail: `tokens ${String(record.payload.tokensBefore)} → ${String(record.payload.tokensAfter)} (budget source: ${String(record.payload.inputBudgetSource)})`,
			});
		}
		if (record.event === "loop_verdict" && record.payload.verdict !== "ok") {
			suspectedLoops.push({
				at: record.timestamp,
				seq: record.seq,
				event: record.event,
				detail: `verdict ${String(record.payload.verdict)} on tool ${String(record.payload.toolName)}`,
			});
		}
	}
	return { compactions, suspectedLoops };
}

// ============================================================================
// Rendering
// ============================================================================

function renderMarkdown(summary: ComparisonSummary): string {
	const lines: string[] = [];
	lines.push("# Model Behavior Trace Comparison");
	lines.push("");
	lines.push(`- **M3 trace**: ${summary.labels.m3}`);
	lines.push(`- **M3.1 trace**: ${summary.labels.m31}`);
	lines.push(
		`- **Comparable**: ${summary.compatible ? "YES" : "NO — material configuration mismatch (see below)"}`,
	);
	lines.push("");
	lines.push(
		"> All repetition numbers below are **heuristics**, not proof of a model defect.",
	);
	lines.push(
		"> Expected retries, polling, and repeated tests after a source change are not pathological looping.",
	);
	lines.push("");

	if (summary.materialDifferences.length > 0) {
		lines.push("## Material Differences");
		lines.push("");
		lines.push("| Dimension | M3 | M3.1 | Severity | Reason |");
		lines.push("| --- | --- | --- | --- | --- |");
		for (const difference of summary.materialDifferences) {
			lines.push(
				`| ${difference.dimension} | ${difference.m3} | ${difference.m31} | ${difference.severity} | ${difference.reason} |`,
			);
		}
		lines.push("");
	}

	lines.push("## Repetition and Error Statistics");
	lines.push("");
	lines.push("| Metric | M3 | M3.1 |");
	lines.push("| --- | --- | --- |");
	const metricRows: Array<[string, keyof TraceStatistics]> = [
		["Total tool calls (activity, not productivity)", "totalToolCalls"],
		["Exact repeated-action count", "exactRepeatedActionCount"],
		["Non-consecutive repetition", "nonConsecutiveRepetitionCount"],
		["Consecutive error streak (max)", "consecutiveErrorStreakMax"],
		["Repeated verification attempts", "repeatedVerificationAttempts"],
		["Compactions", "compactionCount"],
		["Repeated actions after compaction", "repeatedActionsAfterCompaction"],
		["Accepted gates", "acceptedGateCount"],
	];
	for (const [label, key] of metricRows) {
		lines.push(
			`| ${label} | ${String(summary.statistics.m3[key])} | ${String(summary.statistics.m31[key])} |`,
		);
	}
	lines.push(
		`| Tool calls per accepted gate | ${String(summary.statistics.m3.toolCallsPerAcceptedGate ?? "n/a")} | ${String(summary.statistics.m31.toolCallsPerAcceptedGate ?? "n/a")} |`,
	);
	lines.push(
		`| Time to first file edit (ms) | ${String(summary.statistics.m3.timeToFirstFileEditMs ?? "n/a")} | ${String(summary.statistics.m31.timeToFirstFileEditMs ?? "n/a")} |`,
	);
	lines.push(
		`| Time to first executable gate (ms) | ${String(summary.statistics.m3.timeToFirstExecutableGateMs ?? "n/a")} | ${String(summary.statistics.m31.timeToFirstExecutableGateMs ?? "n/a")} |`,
	);
	lines.push(
		`| Completion / termination reason | ${String(summary.statistics.m3.completionReason ?? "n/a")} | ${String(summary.statistics.m31.completionReason ?? "n/a")} |`,
	);
	lines.push(
		`| Trace truncated | ${String(summary.statistics.m3.truncated)} | ${String(summary.statistics.m31.truncated)} |`,
	);
	lines.push("");

	lines.push("## Completion / Gate Evidence");
	lines.push("");
	lines.push(
		`- M3 termination: ${summary.completionEvidence.m3 ?? "NOT OBSERVED"} (accepted gates: ${summary.completionEvidence.m3AcceptedGates ?? 0})`,
	);
	lines.push(
		`- M3.1 termination: ${summary.completionEvidence.m31 ?? "NOT OBSERVED"} (accepted gates: ${summary.completionEvidence.m31AcceptedGates ?? 0})`,
	);
	lines.push("");
	lines.push(summary.repetitionInterpretation);
	lines.push("");

	lines.push("## Timeline Around Compactions");
	lines.push("");
	for (const [label, slices] of [
		["M3", summary.timelineSections.compactions.m3],
		["M3.1", summary.timelineSections.compactions.m31],
	] as const) {
		lines.push(`### ${label}`);
		if (slices.length === 0) {
			lines.push("- (no compaction observed)");
		} else {
			for (const slice of slices) {
				lines.push(`- \`${slice.at}\` seq=${slice.seq} — ${slice.detail}`);
			}
		}
		lines.push("");
	}

	lines.push("## Timeline Around Suspected Loops");
	lines.push("");
	for (const [label, slices] of [
		["M3", summary.timelineSections.suspectedLoops.m3],
		["M3.1", summary.timelineSections.suspectedLoops.m31],
	] as const) {
		lines.push(`### ${label}`);
		if (slices.length === 0) {
			lines.push("- (no non-`ok` loop-detector verdict observed)");
		} else {
			for (const slice of slices) {
				lines.push(`- \`${slice.at}\` seq=${slice.seq} — ${slice.detail}`);
			}
		}
		lines.push("");
	}

	if (summary.warnings.length > 0) {
		lines.push("## Warnings");
		lines.push("");
		for (const warning of summary.warnings) {
			lines.push(`- ${warning}`);
		}
		lines.push("");
	}

	return `${lines.join("\n")}\n`;
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
	const options = parseArgs(process.argv.slice(2));
	const m3 = await parseTrace(options.m3Path, "M3");
	const m31 = await parseTrace(options.m31Path, "M3.1");

	const configuration = compareConfiguration(m3, m31);
	const statistics = { m3: computeStatistics(m3), m31: computeStatistics(m31) };
	const material = configuration.differences.filter(
		(difference) => difference.severity === "material",
	);

	const warnings: string[] = [];
	if (statistics.m3.truncated || statistics.m31.truncated) {
		warnings.push(
			"At least one trace is TRUNCATED — its repetition statistics are lower bounds, not exhaustive counts.",
		);
	}
	if (m3.records.length === 0) {
		warnings.push("The M3 trace contains NO records (NO_CAPTURE).");
	}
	if (m31.records.length === 0) {
		warnings.push("The M3.1 trace contains NO records (NO_CAPTURE).");
	}

	const m3Timeline = buildTimelineSections(m3);
	const m31Timeline = buildTimelineSections(m31);

	const summary: ComparisonSummary = {
		compatible: material.length === 0,
		labels: { m3: options.m3Path, m31: options.m31Path },
		materialDifferences: configuration.differences,
		statistics,
		configurationDifferences: configuration.fields,
		repetitionInterpretation:
			"Repetition scores are HEURISTICS derived from tool-call fingerprints. They are not proof of a model defect: an expected retry, a polling loop, or a repeated test after a source change produces the same signal. Compare the error-streak and gate-evidence columns before drawing any conclusion. A lower tool-call count is NOT, by itself, evidence of a better model — it can equally mean less work was done.",
		completionEvidence: {
			...(statistics.m3.completionReason
				? { m3: statistics.m3.completionReason }
				: {}),
			...(statistics.m31.completionReason
				? { m31: statistics.m31.completionReason }
				: {}),
			m3AcceptedGates: statistics.m3.acceptedGateCount,
			m31AcceptedGates: statistics.m31.acceptedGateCount,
		},
		timelineSections: {
			compactions: { m3: m3Timeline.compactions, m31: m31Timeline.compactions },
			suspectedLoops: {
				m3: m3Timeline.suspectedLoops,
				m31: m31Timeline.suspectedLoops,
			},
		},
		warnings,
	};

	const markdown = renderMarkdown(summary);
	const json = `${JSON.stringify(summary, null, 2)}\n`;

	if (options.mdPath) {
		await writeFile(options.mdPath, markdown, "utf8");
	}
	if (options.jsonPath) {
		await writeFile(options.jsonPath, json, "utf8");
	}
	if (!options.mdPath && !options.jsonPath) {
		process.stdout.write(markdown);
	}
}

if (import.meta.main) {
	main().catch((error) => {
		process.stderr.write(
			`compare-model-behavior-traces failed: ${error instanceof Error ? error.message : String(error)}\n`,
		);
		process.exitCode = 1;
	});
}
