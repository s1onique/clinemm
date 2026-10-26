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
 * COMPARABILITY IS FAIL-CLOSED
 * ----------------------------
 * ACT-CLINEMM-MODEL-BEHAVIOR-TRACE01-CORR01
 *
 * The comparator only reports `compatible: true` when it can PROVE that the
 * two traces are attributable to the model difference alone. It is
 * deliberately asymmetric: it is much easier to fail a comparison than to
 * pass one.
 *
 * A comparison is INCOMPATIBLE or INCONCLUSIVE when ANY of these hold:
 *
 *   1. A trace has NO `model_config` snapshot.
 *      Configuration is only recorded at session-build time, so enabling the
 *      recorder on an ALREADY-RUNNING session yields a trace with no
 *      configuration at all. Two equally-missing configurations are NOT
 *      evidence of equality — they are equally unknown, which proves
 *      nothing.
 *
 *   2. A trace has AMBIGUOUS configuration.
 *      More than one distinct `model_config` snapshot means the trace spans
 *      multiple sessions/models, and the comparator would otherwise
 *      aggregate activity from every run against only the FIRST snapshot.
 *
 *   3. The recorded model identity does not match the supplied label.
 *      An "M3" trace that contains M3.1 events is a MISLABELLED trace, and
 *      a mislabelled trace cannot support a model comparison.
 *
 *   4. The trace spans multiple sessions or runs and no run was selected.
 *      Use `--m3-run` / `--m3.1-run` to scope the comparison explicitly.
 *
 *   5. A material configuration dimension is known on one side and UNKNOWN
 *      on the other, or is UNKNOWN on both sides.
 *      "Both unavailable" is UNVERIFIED, not "equal".
 *
 *   6. A trace is TRUNCATED.
 *      A truncated capture's repetition counts are lower bounds; they are
 *      not exhaustive, so they cannot support an exhaustive repetition
 *      comparison.
 *
 * EXECUTABLE GATE EVIDENCE
 * ------------------------
 * The trace does NOT record command arguments or command output. ClineMM
 * executes shell verification through `run_commands`, whose actual test
 * command and results are deliberately NOT captured. A successful
 * `run_commands` event is therefore NOT evidence of a passing test gate,
 * and a tool merely NAMED `run_tests` is not evidence either.
 *
 * Consequently the comparator reports tool-name-based counts ONLY as
 * explicitly labelled HEURISTICS, and reports accepted executable gates as
 * `UNAVAILABLE_FROM_TRACE`.
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
	severity: "material" | "informational" | "unverified";
	reason: string;
}

/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-TRACE01-CORR01: the three-state result of
 * comparing ONE configuration dimension.
 *
 *   - `equal`     — both sides are KNOWN and identical. This is the only
 *                   state that proves the dimension cannot confound the
 *                   model comparison.
 *   - `different` — both sides are KNOWN and differ. The dimension
 *                   confounds the comparison (material).
 *   - `unverified`— at least one side is UNKNOWN. Two equally unknown values
 *                   are NOT equal; they are equally unknown. This is NOT
 *                   proof of a match (material / inconclusive).
 */
type DimensionComparison = "equal" | "different" | "unverified";

/** The outcome of a single configuration dimension. */
interface DimensionResult {
	dimension: string;
	m3: string;
	m31: string;
	comparison: DimensionComparison;
	reason: string;
}

/**
 * Why a trace could not support a model comparison.
 *
 * `incompatible` means the traces demonstrably differ in a way that
 * confounds the model attribution. `inconclusive` means the evidence was
 * insufficient to decide — which is equally a refusal to compare.
 */
type ComparabilityStatus = "compatible" | "incompatible" | "inconclusive";

/** One reason a comparison was refused. */
interface ComparabilityReason {
	code: string;
	severity: "material" | "informational";
	detail: string;
}

/** The comparability verdict for one trace side. */
interface TraceComparability {
	label: "M3" | "M3.1";
	status:
		| "ok"
		| "missing_config"
		| "ambiguous_config"
		| "mismatched_model"
		| "multi_run_unscoped"
		| "truncated"
		| "no_records";
	selectedRunId?: string;
	observedRuns: string[];
	observedSessions: string[];
	observedModelIds: string[];
	observedProviderIds: string[];
	reasons: ComparabilityReason[];
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
	/**
	 * ACT-CLINEMM-MODEL-BEHAVIOR-TRACE01-CORR01: the number of tool calls
	 * whose NAME matched a verification keyword. This is a TOOL-NAME
	 * HEURISTIC, not an accepted gate.
	 */
	verificationToolCallCount: number;
	/** True when `verificationToolCallCount` was derived from tool names. */
	verificationToolNameHeuristic: true;
	/**
	 * Accepted executable gates are NOT observable in the trace: the actual
	 * test command and its results are deliberately not recorded, and a
	 * successful `run_commands` is not evidence of a passing test.
	 */
	acceptedExecutableGates: string;
	toolCallsPerAcceptedGate: string;
	timeToFirstFileEditMs?: number;
	/**
	 * Time to the first tool call whose NAME matched a verification keyword.
	 * A tool-name heuristic, NOT a time-to-accepted-gate.
	 */
	timeToFirstVerificationNamedToolMs?: number;
	truncated: boolean;
	droppedCount: number;
}

/** The machine-readable summary. */
interface ComparisonSummary {
	compatible: boolean;
	comparability: {
		status: ComparabilityStatus;
		m3: TraceComparability;
		m31: TraceComparability;
		reasons: ComparabilityReason[];
	};
	labels: { m3: string; m31: string };
	materialDifferences: MaterialDifference[];
	statistics: { m3: TraceStatistics; m31: TraceStatistics };
	configurationDifferences: Record<
		string,
		{ m3: string; m31: string; comparison: DimensionComparison }
	>;
	repetitionInterpretation: string;
	completionEvidence: {
		m3?: string;
		m31?: string;
		m3AcceptedGates: string;
		m31AcceptedGates: string;
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
	/**
	 * ACT-CLINEMM-MODEL-BEHAVIOR-TRACE01-CORR01: explicitly scope each side
	 * to ONE run id. A trace that spans multiple runs is otherwise refused,
	 * because aggregating every run's activity against a single
	 * configuration snapshot is not a comparison.
	 */
	m3RunId?: string;
	m31RunId?: string;
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
			case "--m3-run":
				options.m3RunId = next ?? "";
				index += 1;
				break;
			case "--m3.1-run":
				options.m31RunId = next ?? "";
				index += 1;
				break;
			default:
				break;
		}
	}
	if (!options.m3Path || !options.m31Path) {
		throw new Error(
			"usage: compare-model-behavior-traces.ts --m3 <a.jsonl> --m3.1 <b.jsonl> [--md out.md] [--json out.json] [--m3-run <runId>] [--m3.1-run <runId>]",
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
 * ACT-CLINEMM-MODEL-BEHAVIOR-TRACE01-CORR01: the sentinel used for a value
 * the trace does not know.
 *
 * A value equal to this sentinel means "NOT OBSERVED". Two such values are
 * NOT equal evidence — they are equally unknown — so the comparison layer
 * treats them as `unverified`, never as `equal`.
 */
const UNAVAILABLE = "UNAVAILABLE_FROM_TRACE";

/**
 * Tool names that LOOK like a verification / executable gate.
 *
 * ACT-CLINEMM-MODEL-BEHAVIOR-TRACE01-CORR01: this is a NAME heuristic and
 * NOTHING more. Matching a name does NOT prove that a test ran, that its
 * assertions passed, or that a gate was accepted. ClineMM normally runs
 * shell verification through `run_commands`, whose command and output are
 * deliberately not recorded, so a successful `run_commands` contributes
 * NOTHING to a gate count.
 *
 * The pattern is therefore used ONLY for explicitly-labelled heuristic
 * metrics, never to derive an "accepted gate" count.
 */
const VERIFICATION_TOOL_PATTERN =
	/(^| )(test|tests|spec|specs|jest|vitest|pytest|mocha|typecheck|lint|build|check|coverage)( |$)/i;

/** Tool names that represent a file edit. */
const FILE_EDIT_TOOL_PATTERN =
	/(^| )(write|edit|create|apply patch|patch|replace|insert|update)( |$)/i;

/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-TRACE01-CORR01: the model families the labels
 * `--m3` / `--m3.1` may denote.
 *
 * The comparison validates that the RECORDED model identity matches the
 * supplied label. An "M3" trace that contains M3.1 events is mislabelled
 * and cannot support a model comparison.
 *
 * Matching is deliberately conservative: only identities that unambiguously
 * belong to one family are classified. An identity that matches NEITHER
 * family is reported as "unrecognized" rather than silently accepted.
 */
const MODEL_FAMILY_PATTERNS: Record<"M3" | "M3.1", RegExp> = {
	// MiniMax M3 (NOT M3.1). The `1` must not be present.
	M3: /(^|[^0-9])m3([^0-9.]|$)/i,
	// MiniMax M3.1 (and M3.1-Flash style identifiers).
	"M3.1": /m3[._-]?1/i,
};

/**
 * Classify a recorded model identity into the M3 / M3.1 families.
 *
 * Returns `null` when the identity matches neither family — an unknown
 * model id cannot be used to prove the label is correct.
 */
export function classifyModelFamily(modelId: string): "M3" | "M3.1" | null {
	const isM31 = MODEL_FAMILY_PATTERNS["M3.1"].test(modelId);
	const isM3 = MODEL_FAMILY_PATTERNS.M3.test(modelId);
	if (isM31) {
		return "M3.1";
	}
	if (isM3) {
		return "M3";
	}
	return null;
}

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

/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-TRACE01-CORR01: the configuration snapshots
 * observed in a trace, plus the scope metadata needed to decide whether the
 * trace can support a comparison.
 */
interface TraceConfigAnalysis {
	/** The distinct configuration snapshots, in observation order. */
	snapshots: Array<{
		values: Record<string, string>;
		sessionId?: string;
		runId?: string;
		modelId?: string;
		providerId?: string;
	}>;
	/** Every distinct run id observed anywhere in the trace. */
	observedRuns: string[];
	/** Every distinct session id observed anywhere in the trace. */
	observedSessions: string[];
	/** Every distinct model id observed anywhere in the trace. */
	observedModelIds: string[];
	/** Every distinct provider id observed anywhere in the trace. */
	observedProviderIds: string[];
}

/**
 * Collect the configuration snapshots and scope metadata from a trace.
 *
 * ACT-CLINEMM-MODEL-BEHAVIOR-TRACE01-CORR01: the snapshots are NOT collapsed
 * to "the first one" — the caller must decide whether an ambiguous trace
 * can be scoped explicitly.
 */
function analyzeConfig(trace: ParsedTrace): TraceConfigAnalysis {
	const snapshots: TraceConfigAnalysis["snapshots"] = [];
	const runs = new Set<string>();
	const sessions = new Set<string>();
	const modelIds = new Set<string>();
	const providerIds = new Set<string>();

	for (const record of trace.records) {
		if (record.runId !== undefined) {
			runs.add(record.runId);
		}
		if (record.sessionId !== undefined) {
			sessions.add(record.sessionId);
		}
		if (record.modelId !== undefined && record.modelId !== "") {
			modelIds.add(record.modelId);
		}
		if (record.providerId !== undefined && record.providerId !== "") {
			providerIds.add(record.providerId);
		}
		if (record.event !== "model_config") {
			continue;
		}
		const values: Record<string, string> = {};
		for (const [key, value] of Object.entries(record.payload)) {
			values[key] = typeof value === "string" ? value : JSON.stringify(value);
		}
		snapshots.push({
			values,
			...(record.sessionId !== undefined
				? { sessionId: record.sessionId }
				: {}),
			...(record.runId !== undefined ? { runId: record.runId } : {}),
			...(record.modelId !== undefined ? { modelId: record.modelId } : {}),
			...(record.providerId !== undefined
				? { providerId: record.providerId }
				: {}),
		});
	}

	return {
		snapshots,
		observedRuns: [...runs].sort(),
		observedSessions: [...sessions].sort(),
		observedModelIds: [...modelIds].sort(),
		observedProviderIds: [...providerIds].sort(),
	};
}

/**
 * True when a recorded configuration value is actually KNOWN.
 *
 * ACT-CLINEMM-MODEL-BEHAVIOR-TRACE01-CORR01: an empty value, the
 * `UNAVAILABLE_FROM_TRACE` sentinel, and an empty tool-name list are all
 * "not observed" — not "observed to be equal".
 */
function isKnownValue(value: string | undefined): boolean {
	if (value === undefined) {
		return false;
	}
	const trimmed = value.trim();
	if (trimmed === "" || trimmed === UNAVAILABLE) {
		return false;
	}
	// `toolNames` is serialized as a JSON array; an empty array carries no
	// information about the tool configuration.
	if (trimmed === "[]") {
		return false;
	}
	return true;
}

/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-TRACE01-CORR01: the filter applied to a trace
 * before its statistics are computed.
 *
 * When a run is explicitly selected, every record that belongs to a
 * DIFFERENT run is dropped, so the statistics describe exactly the
 * selected run and not an aggregate across runs.
 */
function scopeRecords(
	trace: ParsedTrace,
	selectedRunId?: string,
): TraceRecord[] {
	if (!selectedRunId) {
		return trace.records;
	}
	return trace.records.filter(
		(record) => record.runId === undefined || record.runId === selectedRunId,
	);
}

function computeStatistics(
	trace: ParsedTrace,
	records: TraceRecord[],
): TraceStatistics {
	const toolStarts = records.filter((record) => record.event === "tool_start");
	const toolFinishes = records.filter(
		(record) => record.event === "tool_finish",
	);
	const compactions = records.filter(
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
	for (const record of records) {
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
	let timeToFirstVerificationNamedToolMs: number | undefined;
	const firstRecord = records[0];
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
			timeToFirstVerificationNamedToolMs === undefined &&
			VERIFICATION_TOOL_PATTERN.test(normalizedName)
		) {
			timeToFirstVerificationNamedToolMs = elapsed;
		}
	}

	// Completion / termination.
	const termination = [...records]
		.reverse()
		.find((record) => record.event === "run_terminated");
	const completionReason =
		typeof termination?.payload.finishReason === "string"
			? termination.payload.finishReason
			: undefined;

	// ACT-CLINEMM-MODEL-BEHAVIOR-TRACE01-CORR01 — EXECUTABLE GATE EVIDENCE
	// ------------------------------------------------------------------
	// The trace deliberately does NOT capture command arguments or command
	// output. ClineMM runs shell verification through `run_commands`, so the
	// actual test command and its results are not observable here.
	//
	// Consequently:
	//   - a successful `run_commands` event is NOT a successful test gate;
	//   - a tool merely NAMED `run_tests` is NOT an accepted gate either.
	//
	// The only thing the trace supports is a TOOL-NAME HEURISTIC: how many
	// tool calls were named like a verification. That count is reported
	// under an explicitly heuristic name, and the accepted-gate metrics are
	// reported as UNAVAILABLE rather than fabricated.
	const verificationToolCallCount = toolStarts.filter((record) => {
		const name = record.payload.toolName;
		return (
			typeof name === "string" &&
			VERIFICATION_TOOL_PATTERN.test(normalizeToolName(name))
		);
	}).length;

	const totalToolCalls = toolStarts.length;

	return {
		totalToolCalls,
		exactRepeatedActionCount,
		nonConsecutiveRepetitionCount,
		consecutiveErrorStreakMax,
		repeatedVerificationAttempts,
		compactionCount: compactions.length,
		repeatedActionsAfterCompaction,
		...(completionReason ? { completionReason } : {}),
		verificationToolCallCount,
		verificationToolNameHeuristic: true,
		acceptedExecutableGates: UNAVAILABLE,
		toolCallsPerAcceptedGate: UNAVAILABLE,
		...(timeToFirstFileEditMs !== undefined ? { timeToFirstFileEditMs } : {}),
		...(timeToFirstVerificationNamedToolMs !== undefined
			? { timeToFirstVerificationNamedToolMs }
			: {}),
		truncated: trace.summary?.truncation.truncated ?? false,
		droppedCount: trace.summary?.truncation.droppedCount ?? 0,
	};
}

/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-TRACE01-CORR01: the material configuration
 * dimensions.
 *
 * A difference in ANY of these means the two traces cannot be attributed to
 * the model difference alone.
 */
const MATERIAL_DIMENSIONS: Array<{ key: string; reason: string }> = [
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
		reason: "different tool configuration — the effective action space differs",
	},
	{
		key: "toolNames",
		reason: "different tool configuration — the effective action space differs",
	},
	{
		key: "maxOutputTokens",
		reason:
			"different output budget — the models were allowed to do different amounts of work per call",
	},
];

/**
 * The configuration dimensions that are reported for context only.
 *
 * These do NOT by themselves invalidate a comparison, but an UNKNOWN value
 * is still reported as unverified rather than as a match.
 */
const INFORMATIONAL_DIMENSIONS = [
	"selectedProviderId",
	"selectedModelId",
	"runtimeProviderId",
	"runtimeModelId",
	"providerConfirmedModelId",
	"temperature",
	"topP",
	"contextWindow",
	"maxInputTokens",
];

/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-TRACE01-CORR01: compare ONE configuration
 * dimension across the two traces using a THREE-STATE result.
 *
 * The critical rule: two equally-UNKNOWN values are NOT equal. They are
 * equally unknown, which proves nothing, so the result is `unverified`.
 */
function compareDimension(
	dimension: string,
	left: string | undefined,
	right: string | undefined,
): DimensionResult {
	const leftKnown = isKnownValue(left);
	const rightKnown = isKnownValue(right);
	const leftValue = leftKnown ? (left as string) : UNAVAILABLE;
	const rightValue = rightKnown ? (right as string) : UNAVAILABLE;
	if (leftKnown && rightKnown) {
		const equal = leftValue === rightValue;
		return {
			dimension,
			m3: leftValue,
			m31: rightValue,
			comparison: equal ? "equal" : "different",
			reason: equal
				? "both sides observed the same value"
				: "both sides observed DIFFERENT values — the dimension confounds the model comparison",
		};
	}
	return {
		dimension,
		m3: leftValue,
		m31: rightValue,
		comparison: "unverified",
		reason:
			leftKnown || rightKnown
				? "the value is UNKNOWN on one side — a known value cannot be matched against an unknown one"
				: "the value is UNKNOWN on BOTH sides — two equally unknown values are not evidence of a match",
	};
}

/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-TRACE01-CORR01: compare the two traces'
 * configurations using the three-state result.
 */
function compareConfiguration(
	m3Config: Record<string, string>,
	m31Config: Record<string, string>,
): {
	differences: MaterialDifference[];
	fields: Record<
		string,
		{ m3: string; m31: string; comparison: DimensionComparison }
	>;
} {
	const differences: MaterialDifference[] = [];
	const fields: ComparisonSummary["configurationDifferences"] = {};

	for (const dimension of MATERIAL_DIMENSIONS) {
		const result = compareDimension(
			dimension.key,
			m3Config[dimension.key],
			m31Config[dimension.key],
		);
		fields[dimension.key] = {
			m3: result.m3,
			m31: result.m31,
			comparison: result.comparison,
		};
		if (result.comparison === "different") {
			differences.push({
				dimension: dimension.key,
				m3: result.m3,
				m31: result.m31,
				severity: "material",
				reason: dimension.reason,
			});
		} else if (result.comparison === "unverified") {
			differences.push({
				dimension: dimension.key,
				m3: result.m3,
				m31: result.m31,
				severity: "unverified",
				reason: `${dimension.reason} — this dimension could not be VERIFIED from the trace, so source/build parity is UNPROVEN`,
			});
		}
	}

	for (const key of INFORMATIONAL_DIMENSIONS) {
		const result = compareDimension(key, m3Config[key], m31Config[key]);
		fields[key] = {
			m3: result.m3,
			m31: result.m31,
			comparison: result.comparison,
		};
		if (result.comparison === "different") {
			differences.push({
				dimension: key,
				m3: result.m3,
				m31: result.m31,
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
function buildTimelineSections(records: TraceRecord[]): {
	compactions: TimelineSlice[];
	suspectedLoops: TimelineSlice[];
} {
	const compactions: TimelineSlice[] = [];
	const suspectedLoops: TimelineSlice[] = [];

	for (const record of records) {
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
// Comparability (fail-closed)
// ============================================================================

/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-TRACE01-CORR01: decide whether ONE trace can
 * support a model comparison.
 *
 * Every check here is REFUSAL-oriented. The trace must positively
 * demonstrate that it is a single, correctly-labelled, complete capture
 * before it is allowed to contribute to a comparison.
 */
function assessTraceComparability(
	trace: ParsedTrace,
	label: "M3" | "M3.1",
	selectedRunId?: string,
): TraceComparability {
	const config = analyzeConfig(trace);
	const reasons: ComparabilityReason[] = [];
	let status: TraceComparability["status"] = "ok";

	const fail = (
		nextStatus: TraceComparability["status"],
		code: string,
		detail: string,
	): void => {
		status = nextStatus;
		reasons.push({ code, severity: "material", detail });
	};

	if (trace.records.length === 0) {
		fail(
			"no_records",
			"no_records",
			"the trace contains NO records (NO_CAPTURE) — there is nothing to compare",
		);
	}

	// (1) Configuration presence. Configuration is recorded ONLY at session
	// build time, so enabling the recorder on an ALREADY-RUNNING session
	// produces a trace with NO configuration at all.
	if (config.snapshots.length === 0) {
		fail(
			"missing_config",
			"missing_model_config",
			"the trace contains NO model_config snapshot — the model configuration is UNKNOWN, so comparability cannot be established (configuration is recorded only at session build time)",
		);
	} else if (config.snapshots.length > 1) {
		// (2) Ambiguous configuration: more than one snapshot means the
		// trace spans multiple sessions/models.
		//
		// When a run was EXPLICITLY selected, the ambiguity is resolved for
		// that run: only the snapshots belonging to the selected run (and the
		// session-level snapshot it inherits) are considered.
		const scopedSnapshots = selectedRunId
			? config.snapshots.filter(
					(snapshot) =>
						snapshot.runId === selectedRunId || snapshot.runId === undefined,
				)
			: config.snapshots;
		const distinct = new Set(
			scopedSnapshots.map((snapshot) => JSON.stringify(snapshot.values)),
		);
		if (distinct.size > 1) {
			fail(
				"ambiguous_config",
				"ambiguous_model_config",
				`the trace contains ${distinct.size} DISTINCT model_config snapshots — it spans multiple sessions/models and the comparison is AMBIGUOUS; select one run explicitly`,
			);
		}
	}

	// (3) Model attribution. The recorded model identity must match the
	// supplied label.
	const observedModelIds = config.observedModelIds;
	if (observedModelIds.length > 0) {
		const mismatched = observedModelIds.filter((modelId) => {
			const family = classifyModelFamily(modelId);
			return family !== null && family !== label;
		});
		if (mismatched.length > 0) {
			fail(
				"mismatched_model",
				"model_attribution_mismatch",
				`the trace labelled "${label}" contains events for ${mismatched.join(", ")} — the model attribution is REJECTED`,
			);
		}
	}

	// (4) Multi-run scoping. Activity from several runs must not be
	// aggregated against a single configuration snapshot.
	if (
		!selectedRunId &&
		(config.observedRuns.length > 1 || config.observedSessions.length > 1)
	) {
		fail(
			"multi_run_unscoped",
			"multi_run_unscoped",
			`the trace spans ${config.observedRuns.length} run(s) and ${config.observedSessions.length} session(s) — select one run explicitly (--m3-run / --m3.1-run) instead of aggregating across runs`,
		);
	}
	if (selectedRunId && !config.observedRuns.includes(selectedRunId)) {
		fail(
			"multi_run_unscoped",
			"selected_run_absent",
			`the selected run "${selectedRunId}" does not appear in the trace`,
		);
	}

	// (5) Completeness. A truncated capture's counts are lower bounds.
	if (trace.summary?.truncation.truncated) {
		fail(
			"truncated",
			"truncated_capture",
			`the capture is TRUNCATED (${trace.summary.truncation.droppedCount} record(s) dropped) — its repetition counts are LOWER BOUNDS and cannot support an exhaustive repetition comparison`,
		);
	}

	return {
		label,
		status,
		...(selectedRunId !== undefined ? { selectedRunId } : {}),
		observedRuns: config.observedRuns,
		observedSessions: config.observedSessions,
		observedModelIds: config.observedModelIds,
		observedProviderIds: config.observedProviderIds,
		reasons,
	};
}

/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-TRACE01-CORR01: the configuration values used
 * for the dimension comparison.
 *
 * When a run was explicitly selected, the snapshot belonging to THAT run is
 * used; otherwise the (single, non-ambiguous) snapshot is used.
 */
function selectConfigValues(
	trace: ParsedTrace,
	selectedRunId?: string,
): Record<string, string> {
	const config = analyzeConfig(trace);
	if (config.snapshots.length === 0) {
		return {};
	}
	if (selectedRunId) {
		const scoped = config.snapshots.find(
			(snapshot) =>
				snapshot.runId === selectedRunId ||
				snapshot.sessionId === selectedRunId,
		);
		if (scoped) {
			return scoped.values;
		}
	}
	return config.snapshots[0].values;
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
		`- **Comparable**: ${summary.compatible ? "YES" : `NO — ${summary.comparability.status} (see Comparability below)`}`,
	);
	lines.push(`- **Comparability status**: \`${summary.comparability.status}\``);
	lines.push("");
	lines.push(
		"> All repetition numbers below are **heuristics**, not proof of a model defect.",
	);
	lines.push(
		"> Expected retries, polling, and repeated tests after a source change are not pathological looping.",
	);
	lines.push(
		"> Accepted executable gates are **NOT observable in the trace** — the actual test command and its results are deliberately not recorded, so a successful `run_commands` is not evidence of a passing gate.",
	);
	lines.push("");

	lines.push("## Comparability");
	lines.push("");
	if (summary.comparability.reasons.length === 0) {
		lines.push(
			"- No refusal reasons: both traces fully identified their model configuration, were correctly labelled, and are complete.",
		);
	} else {
		for (const reason of summary.comparability.reasons) {
			lines.push(`- \`${reason.code}\` — ${reason.detail}`);
		}
	}
	lines.push("");
	lines.push("| Side | Status | Observed runs | Observed models |");
	lines.push("| --- | --- | --- | --- |");
	for (const side of [summary.comparability.m3, summary.comparability.m31]) {
		lines.push(
			`| ${side.label} | \`${side.status}\` | ${side.observedRuns.join(", ") || "(none)"} | ${side.observedModelIds.join(", ") || "(none)"} |`,
		);
	}
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
		[
			"Repeated verification attempts (tool-name heuristic)",
			"repeatedVerificationAttempts",
		],
		["Compactions", "compactionCount"],
		["Repeated actions after compaction", "repeatedActionsAfterCompaction"],
		[
			"Verification-NAMED tool calls (tool-name heuristic)",
			"verificationToolCallCount",
		],
		["Accepted executable gates", "acceptedExecutableGates"],
	];
	for (const [label, key] of metricRows) {
		lines.push(
			`| ${label} | ${String(summary.statistics.m3[key])} | ${String(summary.statistics.m31[key])} |`,
		);
	}
	lines.push(
		`| Tool calls per accepted gate | ${summary.statistics.m3.toolCallsPerAcceptedGate} | ${summary.statistics.m31.toolCallsPerAcceptedGate} |`,
	);
	lines.push(
		`| Time to first file edit (ms) | ${String(summary.statistics.m3.timeToFirstFileEditMs ?? "n/a")} | ${String(summary.statistics.m31.timeToFirstFileEditMs ?? "n/a")} |`,
	);
	lines.push(
		`| Time to first VERIFICATION-NAMED tool (ms) | ${String(summary.statistics.m3.timeToFirstVerificationNamedToolMs ?? "n/a")} | ${String(summary.statistics.m31.timeToFirstVerificationNamedToolMs ?? "n/a")} |`,
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
		`- M3 termination: ${summary.completionEvidence.m3 ?? "NOT OBSERVED"} (accepted executable gates: ${summary.completionEvidence.m3AcceptedGates})`,
	);
	lines.push(
		`- M3.1 termination: ${summary.completionEvidence.m31 ?? "NOT OBSERVED"} (accepted executable gates: ${summary.completionEvidence.m31AcceptedGates})`,
	);
	lines.push(
		"- Accepted executable gates are UNAVAILABLE_FROM_TRACE: the trace records neither the executed test command nor its result, so gate acceptance cannot be inferred from a tool name or a generic successful `run_commands`.",
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

/**
 * Assemble the machine-readable comparison summary.
 */
function buildSummary(input: {
	status: ComparabilityStatus;
	m3Comparability: TraceComparability;
	m31Comparability: TraceComparability;
	comparabilityReasons: ComparabilityReason[];
	configuration: {
		differences: MaterialDifference[];
		fields: ComparisonSummary["configurationDifferences"];
	};
	statistics: { m3: TraceStatistics; m31: TraceStatistics };
	m3Records: TraceRecord[];
	m31Records: TraceRecord[];
	warnings: string[];
	options: CliOptions;
}): ComparisonSummary {
	const m3Timeline = buildTimelineSections(input.m3Records);
	const m31Timeline = buildTimelineSections(input.m31Records);
	return {
		compatible: input.status === "compatible",
		comparability: {
			status: input.status,
			m3: input.m3Comparability,
			m31: input.m31Comparability,
			reasons: input.comparabilityReasons,
		},
		labels: { m3: input.options.m3Path, m31: input.options.m31Path },
		materialDifferences: input.configuration.differences,
		statistics: input.statistics,
		configurationDifferences: input.configuration.fields,
		repetitionInterpretation:
			"Repetition scores are HEURISTICS derived from tool-call fingerprints. They are not proof of a model defect: an expected retry, a polling loop, or a repeated test after a source change produces the same signal. The verification-named tool call count is a TOOL-NAME heuristic — it does NOT mean a test ran or that a gate was accepted; accepted executable gates are UNAVAILABLE_FROM_TRACE. A lower tool-call count is NOT, by itself, evidence of a better model — it can equally mean less work was done.",
		completionEvidence: {
			...(input.statistics.m3.completionReason
				? { m3: input.statistics.m3.completionReason }
				: {}),
			...(input.statistics.m31.completionReason
				? { m31: input.statistics.m31.completionReason }
				: {}),
			m3AcceptedGates: UNAVAILABLE,
			m31AcceptedGates: UNAVAILABLE,
		},
		timelineSections: {
			compactions: { m3: m3Timeline.compactions, m31: m31Timeline.compactions },
			suspectedLoops: {
				m3: m3Timeline.suspectedLoops,
				m31: m31Timeline.suspectedLoops,
			},
		},
		warnings: input.warnings,
	};
}

async function main(): Promise<void> {
	const options = parseArgs(process.argv.slice(2));
	const m3 = await parseTrace(options.m3Path, "M3");
	const m31 = await parseTrace(options.m31Path, "M3.1");

	// ACT-CLINEMM-MODEL-BEHAVIOR-TRACE01-CORR01: the comparability decision
	// comes FIRST and is FAIL-CLOSED. A trace that cannot positively
	// identify itself never contributes to a "compatible" verdict.
	const m3Comparability = assessTraceComparability(m3, "M3", options.m3RunId);
	const m31Comparability = assessTraceComparability(
		m31,
		"M3.1",
		options.m31RunId,
	);

	const m3Records = scopeRecords(m3, options.m3RunId);
	const m31Records = scopeRecords(m31, options.m31RunId);

	const m3Config = selectConfigValues(m3, options.m3RunId);
	const m31Config = selectConfigValues(m31, options.m31RunId);

	const configuration = compareConfiguration(m3Config, m31Config);
	const statistics = {
		m3: computeStatistics(m3, m3Records),
		m31: computeStatistics(m31, m31Records),
	};
	const material = configuration.differences.filter(
		(difference) => difference.severity === "material",
	);
	const unverified = configuration.differences.filter(
		(difference) => difference.severity === "unverified",
	);

	// The comparability reasons from BOTH sides are collected.
	const comparabilityReasons: ComparabilityReason[] = [
		...m3Comparability.reasons.map((reason) => ({
			...reason,
			detail: `[M3] ${reason.detail}`,
		})),
		...m31Comparability.reasons.map((reason) => ({
			...reason,
			detail: `[M3.1] ${reason.detail}`,
		})),
	];

	// The overall status.
	//
	//   - `incompatible` — the traces demonstrably differ (material) or a
	//     trace is mislabelled / ambiguous.
	//   - `inconclusive` — the evidence was insufficient (missing config,
	//     unverified dimension, truncated capture).
	//   - `compatible`   — every material dimension is KNOWN and EQUAL, both
	//     traces are correctly labelled, unambiguous, and complete.
	//
	// A MATERIAL difference ALWAYS yields `incompatible`, independently of
	// whether either side was individually blocked.
	const m3Blocking = m3Comparability.status !== "ok";
	const m31Blocking = m31Comparability.status !== "ok";
	const determinateMismatch =
		m3Comparability.status === "mismatched_model" ||
		m31Comparability.status === "mismatched_model" ||
		m3Comparability.status === "ambiguous_config" ||
		m31Comparability.status === "ambiguous_config";
	const status: ComparabilityStatus =
		material.length > 0
			? "incompatible"
			: m3Blocking || m31Blocking
				? determinateMismatch
					? "incompatible"
					: "inconclusive"
				: unverified.length > 0
					? "inconclusive"
					: "compatible";

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
	if (unverified.length > 0) {
		warnings.push(
			`${unverified.length} configuration dimension(s) could not be VERIFIED from the trace — "both sides unavailable" is NOT evidence that the two sides match.`,
		);
	}
	warnings.push(
		"Accepted executable gates are UNAVAILABLE_FROM_TRACE: the trace records neither the executed test command nor its result, so gate acceptance cannot be inferred from a tool name or from a generic successful `run_commands`.",
	);

	const summary = buildSummary({
		status,
		m3Comparability,
		m31Comparability,
		comparabilityReasons,
		configuration,
		statistics,
		m3Records,
		m31Records,
		warnings,
		options,
	});

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
