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

/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-EDIT-EFFICIENCY-TRACE01-CORR01.
 *
 * The editing-efficiency statistics computed for ONE trace.
 *
 * Every number here is derived from OBSERVED file revisions, never from
 * a generic tool success. A run that changed source files through
 * `run_commands` contributes NO native-edit observations, and the trace
 * says so explicitly rather than presenting zero edits as a clean run.
 *
 * THE ACCOUNTING IS LAYERED (CORR01)
 * ----------------------------------
 * The previous implementation collapsed four DIFFERENT facts into one
 * counter. The corrected model keeps them apart, because they answer
 * different questions:
 *
 *   - `successfulEditOperations` — how many edit operations completed
 *     without an error. This is an OPERATION count.
 *   - `filesWritten` — how many files the write layer actually wrote.
 *     This is the MUTATED-FILE count the metric always claimed to be.
 *   - `filesWithVerifiedContentChange` — how many of those writes were
 *     observed to change the file's CONTENT. A write whose measurement
 *     was skipped is NOT counted here: it is UNVERIFIED, not unchanged.
 *   - `noOpEditOperations` — how many successful operations left every
 *     written file byte-identical.
 *   - `partialMutationOperations` — how many operations wrote at least
 *     one file AND failed, i.e. a multi-file patch that partially applied.
 */
interface EditingEfficiencyStatistics {
	/** Native edit attempts (requested native editing operations). */
	nativeEditAttempts: number;
	/**
	 * Edit operations that completed WITHOUT an error.
	 *
	 * This is an OPERATION count, not a file count.
	 */
	successfulEditOperations: number;
	/**
	 * The number of files the write layer ACTUALLY wrote.
	 *
	 * This is the mutated-file count: a successful two-file patch
	 * contributes 2, and a patch that failed after its first write
	 * contributes 1.
	 */
	filesWritten: number;
	/**
	 * The number of written files whose CONTENT was observed to change.
	 *
	 * A write whose content measurement was skipped is NOT counted here:
	 * it is unverified, not unchanged.
	 */
	filesWithVerifiedContentChange: number;
	/**
	 * The number of written files whose content could NOT be verified
	 * (the measurement was skipped, e.g. the size limit).
	 */
	filesWithUnverifiedContentChange: number;
	/**
	 * Successful operations that left the content of every written file
	 * unchanged (a genuine no-op).
	 */
	noOpEditOperations: number;
	/**
	 * Operations that wrote at least one file AND failed — a PARTIAL
	 * application of a multi-file patch.
	 */
	partialMutationOperations: number;
	/** Rejected or failed operations. */
	failedEdits: number;
	/** Distinct files observed as mutated. */
	distinctFilesModified: number;
	/** Observed mutations per modified file. */
	editsPerFile: number;
	/** Files whose version sequence returned to an earlier version. */
	revertedMutations: number;
	/** Intermediate mutations that a later revision superseded. */
	revisionChurn: number;
	/** Milliseconds from the run start to the first ACTUAL mutation. */
	timeToFirstAppliedEditMs?: number;
	/** Total observed file-write duration, in milliseconds. */
	fileWriteDurationMs?: number;
	/** Shell calls observed, reported as SEPARATE activity. */
	shellCallCount: number;
	/** Shell calls that executed without an error. */
	shellCallSuccessCount: number;
	/**
	 * The number of edit applications joined to their originating
	 * `edit_attempt` by EXACT session/run/tool-call identity.
	 */
	correlatedEditApplications: number;
	/**
	 * The number of edit applications that could NOT be joined to an
	 * attempt — the identity was missing, or the identity was ambiguous.
	 *
	 * These are counted on their own (the write really happened) but they
	 * are never paired with an attempt by timestamp or array adjacency.
	 */
	uncorrelatedEditApplications: number;
	/**
	 * The number of `edit_attempt` records that have NO application joined
	 * to them (the request never produced a write observation).
	 */
	unfulfilledEditAttempts: number;
	/**
	 * The provenance of the application-to-attempt join.
	 *
	 * `EXACT_IDENTITY` — the join was made by exact tool-call identity.
	 */
	correlationProvenance: "EXACT_IDENTITY";
	/**
	 * True when shell activity was observed WITHOUT any native edit
	 * telemetry.
	 *
	 * ACT-CLINEMM-MODEL-BEHAVIOR-EDIT-EFFICIENCY-TRACE01-CORR01: the trace
	 * has NO independent workspace-delta source, so the origin of anything
	 * a shell call may have changed is UNOBSERVED. It is never reported as
	 * an observed file change.
	 */
	editOriginUnobserved: boolean;
	/**
	 * True when an independent real workspace-delta source established an
	 * actual file change.
	 *
	 * No such source exists today, so this is always `false`; the field
	 * exists so the distinction cannot be re-collapsed into a guess.
	 */
	workspaceDeltaObserved: boolean;
	/** The explicit marker reported for the edit origin. */
	editOriginMarker: string;
	/** Accepted executable gates — NOT observable in the trace. */
	acceptedExecutableGates: string;
	/** The provenance of the churn heuristics. */
	churnProvenance: "INFERRED";
	/** The provenance of the mutation counts. */
	mutationProvenance: "REAL_PRODUCTION_SEAM";
}

/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-WORKSPACE-EFFECT-TRACE01 (R4/R5).
 *
 * The retention classification of ONE observed edit target.
 *
 * - `RETAINED_CHANGED` — the target's final observed state differs from
 *   its initial state and the target still exists.
 * - `REVERTED` — the target's final observed state equals an EARLIER
 *   observed state (A → B → A).
 * - `DELETED` — the target no longer exists at the checkpoint.
 * - `UNCHANGED` — the target was written but its content is unchanged.
 * - `OUTSIDE_SCOPE` — the destination was resolved outside the
 *   designated benchmark root.
 * - `UNVERIFIED` — the outcome could not be established (no read-back, an
 *   ambiguous identity, or a missing checkpoint).
 * - `UNAVAILABLE_FROM_TRACE` — the trace carries NO CHECKPOINT observation,
 *   so the CURRENT state of the target is not knowable from the trace at
 *   all.
 *
 * ACT-CLINEMM-MODEL-BEHAVIOR-WORKSPACE-EFFECT-TRACE01-CORR01
 * ------------------------------------------------------
 * The retained-change classifications REQUIRE the checkpoint observation.
 *
 * The previous implementation derived them from the LAST post-write
 * read-back, which is unsound:
 *
 *   T1  native editor writes B     → read-back confirms B on disk
 *   T2  a shell command restores A  → NO native editor event is emitted
 *   T3  the trace is dumped         → the last read-back still says "B"
 *
 * That produced a false RETAINED_CHANGED for a workspace that was
 * demonstrably back at A. The post-write read-back is now reported
 * separately as the LAST_OBSERVED_POST_WRITE_STATE, and the retained-change
 * classification is derived ONLY from the `edit_checkpoint_observation`
 * record — a real filesystem observation taken at the checkpoint.
 *
 * When the trace carries no checkpoint, the honest answer is
 * `UNAVAILABLE_FROM_TRACE`, never a guess.
 */
export type EditRetentionClassification =
	| "RETAINED_CHANGED"
	| "REVERTED"
	| "DELETED"
	| "UNCHANGED"
	| "OUTSIDE_SCOPE"
	| "UNVERIFIED"
	| "UNAVAILABLE_FROM_TRACE";

/**
 * The workspace-progress summary of ONE trace.
 *
 * This section answers the question the previous editing-efficiency
 * section could not: WHERE the writes went, and whether anything was
 * actually RETAINED in the designated benchmark workspace.
 */
export interface WorkspaceProgressStatistics {
	/** The number of `edit_target_resolved` observations. */
	targetsResolved: number;
	/**
	 * The number of resolved targets whose destination was canonically
	 * established to be INSIDE the active workspace.
	 */
	targetsInsideActiveWorkspace: number;
	/**
	 * The number of resolved targets whose destination was canonically
	 * established to be OUTSIDE the active workspace.
	 *
	 * This is the number that was previously invisible: an out-of-workspace
	 * write produced an `edit_application` record that was indistinguishable
	 * from an in-workspace one.
	 */
	targetsOutsideActiveWorkspace: number;
	/**
	 * The number of resolved targets under a DIFFERENT known workspace
	 * root.
	 */
	targetsInOtherWorkspace: number;
	/**
	 * The number of resolved targets whose scope could NOT be established
	 * (the canonicalization failed, or no workspace identity was available).
	 *
	 * These are reported as `PATH_SCOPE_UNVERIFIED` — never as "inside".
	 */
	targetsScopeUnverified: number;
	/**
	 * The number of applied writes whose destination was resolved OUTSIDE
	 * the active workspace.
	 */
	appliedWritesOutsideWorkspace: number;
	/**
	 * The number of applied writes whose destination was resolved INSIDE
	 * the active workspace.
	 */
	appliedWritesInsideWorkspace: number;
	/**
	 * The number of writes that were INDEPENDENTLY verified by a
	 * read-back from disk.
	 */
	independentlyVerifiedWrites: number;
	/**
	 * The number of writes whose read-back observed exactly the content
	 * the executor intended to write.
	 */
	verifiedWritesMatchingIntended: number;
	/**
	 * The number of writes whose read-back observed DIFFERENT content
	 * than the executor intended.
	 */
	verifiedWritesDivergingFromIntended: number;
	/**
	 * The number of writes that returned successfully but whose read-back
	 * could not be performed — UNVERIFIED, never "succeeded".
	 */
	unverifiedWrites: number;
	/**
	 * The number of writes whose destination was ABSENT when the
	 * read-back ran.
	 *
	 * A file created and then deleted lands here and is therefore never
	 * counted as a retained change.
	 */
	writesWithDestinationAbsent: number;
	/** The per-classification retention counts. */
	retentionCounts: Record<EditRetentionClassification, number>;
	/**
	 * The number of observed targets that are inside the designated
	 * benchmark root.
	 */
	trackedTargetCount: number;
	/**
	 * The number of observed targets that are OUTSIDE the designated
	 * benchmark root.
	 */
	untrackedTargetCount: number;
	/**
	 * The number of observed targets whose benchmark-root membership could
	 * not be established.
	 */
	ignoredTargetCount: number;
	/**
	 * The number of files the git index tracks inside the benchmark root.
	 *
	 * This is a GIT-SCOPED count, deliberately reported separately from
	 * the filesystem-scoped target counts: "tracked" in git is not the
	 * same question as "present in the tree".
	 */
	gitTrackedFileCount?: number;
	/**
	 * Milliseconds from the run start to the first write whose destination
	 * was resolved INSIDE the active workspace.
	 */
	timeToFirstWriteInsideWorkspaceMs?: number;
	/**
	 * Milliseconds from the run start to the last RETAINED change.
	 */
	timeSinceLastRetainedChangeMs?: number;
	/**
	 * The number of tool calls observed since the last retained change.
	 */
	toolCallsSinceLastRetainedChange: number;
	/** Native edit failures observed. */
	nativeEditFailures: number;
	/**
	 * Edit attempts that produced no application observation.
	 */
	unfulfilledEditAttempts: number;
	/** Shell calls observed. */
	shellCallCount: number;
	/**
	 * Shell calls that executed without an error.
	 */
	shellCallSuccessCount: number;
	/**
	 * Shell activity that produced NO observed native mutation.
	 *
	 * The trace CANNOT attribute a filesystem change to a shell call, so
	 * this is reported as activity, never as an observed mutation.
	 */
	shellActivityWithoutObservedMutation: number;
	/**
	 * True when the trace carries target-resolution evidence at all.
	 *
	 * False means the trace predates this feature, so every workspace
	 * number below is UNAVAILABLE rather than zero.
	 */
	workspaceEvidenceAvailable: boolean;
	/**
	 * The marker for every workspace figure that the trace cannot
	 * establish.
	 */
	workspaceEvidenceMarker: string;
	/** Accepted executable gates — NOT observable in the trace. */
	acceptedExecutableGates: string;
	/** The provenance of the workspace figures. */
	workspaceProvenance: "REAL_PRODUCTION_SEAM" | "INFERRED";
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
	/**
	 * ACT-CLINEMM-MODEL-BEHAVIOR-EDIT-EFFICIENCY-TRACE01: the editing
	 * efficiency section.
	 */
	editingEfficiency: {
		m3: EditingEfficiencyStatistics;
		m31: EditingEfficiencyStatistics;
	};
	/**
	 * ACT-CLINEMM-MODEL-BEHAVIOR-WORKSPACE-EFFECT-TRACE01 (R5): the
	 * workspace-progress section.
	 */
	workspaceProgress: {
		m3: WorkspaceProgressStatistics;
		m31: WorkspaceProgressStatistics;
	};
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
	/**
	 * ACT-CLINEMM-MODEL-BEHAVIOR-COMPARABILITY-AUTHORITY-REPAIR01 (R3/R4):
	 * the EFFECTIVE configuration snapshots observed at the model-request
	 * boundary, in observation order.
	 *
	 * These carry the REAL session/run identity, so they are the
	 * authoritative source for the effective toolset, reasoning policy and
	 * output limit.
	 */
	effectiveSnapshots: Array<{
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
	const effectiveSnapshots: TraceConfigAnalysis["effectiveSnapshots"] = [];
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
		if (
			record.event !== "model_config" &&
			record.event !== "effective_model_config"
		) {
			continue;
		}
		const values: Record<string, string> = {};
		for (const [key, value] of Object.entries(record.payload)) {
			values[key] = typeof value === "string" ? value : JSON.stringify(value);
		}
		const snapshot = {
			values,
			...(record.sessionId !== undefined
				? { sessionId: record.sessionId }
				: {}),
			...(record.runId !== undefined ? { runId: record.runId } : {}),
			...(record.modelId !== undefined ? { modelId: record.modelId } : {}),
			...(record.providerId !== undefined
				? { providerId: record.providerId }
				: {}),
		};
		if (record.event === "effective_model_config") {
			effectiveSnapshots.push(snapshot);
		} else {
			snapshots.push(snapshot);
		}
	}

	return {
		snapshots,
		effectiveSnapshots,
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
 * ACT-CLINEMM-MODEL-BEHAVIOR-COMPARABILITY-AUTHORITY-REPAIR01 (R4):
 * the identity-verified scope of a run.
 *
 * A run belongs to exactly ONE session. The scope therefore resolves to:
 *   - `runId` — the selected run,
 *   - `sessionId` — the session that owns the selected run, derived from
 *     the records that actually carry that run id.
 *
 * The session id is DERIVED FROM IDENTITY, never from timestamp proximity.
 * When the selected run is never observed on a record, the session id stays
 * `undefined` and the scope is run-id-only.
 */
interface RunScope {
	readonly runId: string;
	readonly sessionId?: string;
}

/**
 * Resolve the identity-verified scope for a selected run.
 *
 * A record is INCLUDED when it is bound to the selected run, or when it is
 * bound to the session that owns the selected run and carries NO run id of
 * its own (a session-level record such as the build-time configuration
 * snapshot, which legitimately precedes run creation).
 *
 * A record that carries a DIFFERENT run id is NEVER included, even when it
 * belongs to the same session — that is what keeps two runs of one session
 * from contaminating each other.
 *
 * A record whose identity is UNKNOWN (neither a run id nor a session id) is
 * NEVER included: attaching it by timestamp proximity would silently attach
 * another session's record.
 */
function resolveRunScope(
	records: readonly TraceRecord[],
	selectedRunId: string,
): RunScope {
	const owningSessions = new Set<string>();
	for (const record of records) {
		if (record.runId === selectedRunId && record.sessionId !== undefined) {
			owningSessions.add(record.sessionId);
		}
	}
	// A run belongs to exactly one session. If the trace somehow shows more,
	// the scope cannot be identity-verified, so no session id is claimed.
	const sessionId =
		owningSessions.size === 1 ? [...owningSessions][0] : undefined;
	return {
		runId: selectedRunId,
		...(sessionId !== undefined ? { sessionId } : {}),
	};
}

/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-TRACE01-CORR01: the filter applied to a trace
 * before its statistics are computed.
 *
 * When a run is explicitly selected, every record that belongs to a
 * DIFFERENT run is dropped, so the statistics describe exactly the
 * selected run and not an aggregate across runs.
 *
 * ACT-CLINEMM-MODEL-BEHAVIOR-COMPARABILITY-AUTHORITY-REPAIR01 (R4): the
 * unconditional `runId === undefined` inclusion rule is REPLACED by an
 * identity-verified rule. A record without a run id is included only when
 * it carries the session id that owns the selected run. A record with no
 * identity at all is never included.
 */
function scopeRecords(
	trace: ParsedTrace,
	selectedRunId?: string,
): TraceRecord[] {
	if (!selectedRunId) {
		return trace.records;
	}
	const scope = resolveRunScope(trace.records, selectedRunId);
	return trace.records.filter((record) => {
		if (record.runId !== undefined) {
			return record.runId === scope.runId;
		}
		// No run id: include ONLY when the record is bound to the session
		// that owns the selected run.
		return (
			scope.sessionId !== undefined && record.sessionId === scope.sessionId
		);
	});
}

/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-COMPARATOR-CORRECTION01 (C3): the model
 * identities observed INSIDE the identity-verified scope of a run.
 *
 * The scope is the SAME one the statistics use: a record that carries a
 * different run id is excluded, a record with no run id is included only
 * when it carries the session that owns the selected run, and a record with
 * NO identity at all is never included.
 *
 * This is what keeps a selected M3 run from inheriting the M3.1 identities
 * recorded by the other runs of a mixed-model dump.
 */
function collectScopedModelIds(
	trace: ParsedTrace,
	selectedRunId: string,
): string[] {
	const scope = resolveRunScope(trace.records, selectedRunId);
	const modelIds = new Set<string>();
	for (const record of scopeRecords(trace, selectedRunId)) {
		if (record.modelId !== undefined && record.modelId !== "") {
			modelIds.add(record.modelId);
		}
	}
	// The scope is resolved but not used directly above; referencing it
	// keeps the identity-verification explicit and guards against a future
	// refactor that widens the scope.
	void scope;
	return [...modelIds].sort();
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
 * ACT-CLINEMM-MODEL-BEHAVIOR-EDIT-EFFICIENCY-TRACE01.
 *
 * Compute the editing-efficiency statistics from the OBSERVED edit events.
 *
 * The chain the trace records is:
 *
 *   edit requested → authorized → executor invoked → mutation applied
 *     → file revision observed → subsequent revision → verification
 *
 * This function reads the LAST TWO links only — the ones that are
 * actually observed:
 *   - `edit_attempt` — the request structure,
 *   - `edit_application` — the write layer's report of what happened.
 *
 * The mutation counts come from `edit_application`, which the WRITE layer
 * produced, so they carry `REAL_PRODUCTION_SEAM` provenance. The churn
 * heuristics (reversion, churn) are derived from correlated revisions
 * and carry `INFERRED` provenance: an A → B → A reversion is stronger
 * evidence than a repeated edit, but it still does not prove the model
 * made a mistake.
 */
function computeEditingEfficiency(
	trace: ParsedTrace,
	records: TraceRecord[],
): EditingEfficiencyStatistics {
	const attempts = records.filter((record) => record.event === "edit_attempt");
	const applications = records.filter(
		(record) => record.event === "edit_application",
	);

	// ------------------------------------------------------------------
	// CORRELATION (CORR01)
	// ------------------------------------------------------------------
	// An application is joined to its attempt ONLY by EXACT identity:
	// the same session, the same run and the same tool-call id.
	//
	// The join is deliberately NOT made by timestamp proximity and NOT by
	// array adjacency: with several edits in one run, adjacency would
	// happily pair a write with the wrong request, and a timestamp is not
	// an identity at all. An application whose identity is missing — or
	// whose identity matches more than one attempt — stays UNVERIFIED and
	// is counted on its own, never paired.
	const attemptByIdentity = new Map<string, TraceRecord[]>();
	for (const attempt of attempts) {
		const identity = readCorrelationIdentity(attempt);
		if (!identity) {
			continue;
		}
		const bucket = attemptByIdentity.get(identity.key);
		if (bucket) {
			bucket.push(attempt);
		} else {
			attemptByIdentity.set(identity.key, [attempt]);
		}
	}
	const fulfilledAttemptKeys = new Set<string>();
	let correlatedEditApplications = 0;
	let uncorrelatedEditApplications = 0;

	// Per-file observed revision sequences, keyed by the ephemeral file
	// identity. The sequence holds the INITIAL version followed by each
	// observed post-write version.
	const revisionsByFile = new Map<string, string[]>();
	let successfulEditOperations = 0;
	let filesWritten = 0;
	let filesWithVerifiedContentChange = 0;
	let filesWithUnverifiedContentChange = 0;
	let noOpEditOperations = 0;
	let partialMutationOperations = 0;
	let failedEdits = 0;
	let totalWriteDurationMs = 0;
	let sawWriteDuration = false;
	let timeToFirstAppliedEditMs: number | undefined;
	const firstRecord = records[0];

	for (const record of applications) {
		const outcome = record.payload.outcome;
		const applicationIdentity = readCorrelationIdentity(record);
		if (applicationIdentity) {
			const bucket = attemptByIdentity.get(applicationIdentity.key);
			// An EXACT identity match that is NOT ambiguous (exactly one
			// attempt carries this identity) is the only accepted join.
			if (bucket && bucket.length === 1) {
				correlatedEditApplications += 1;
				fulfilledAttemptKeys.add(applicationIdentity.key);
			} else {
				uncorrelatedEditApplications += 1;
			}
		} else {
			// No identity at all: the write is still real, but it cannot be
			// attributed to a request.
			uncorrelatedEditApplications += 1;
		}
		const mutatedFileCount = readNonNegativeInteger(
			record.payload.mutatedFileCount,
		);
		const writtenFiles = mutatedFileCount ?? 0;
		if (outcome === "applied") {
			successfulEditOperations += 1;
		} else {
			failedEdits += 1;
			if (writtenFiles > 0) {
				// A failure AFTER at least one file was written is a PARTIAL
				// application, not a clean failure.
				partialMutationOperations += 1;
			}
		}
		filesWritten += writtenFiles;
		const duration = record.payload.durationMs;
		if (typeof duration === "number" && Number.isFinite(duration)) {
			totalWriteDurationMs += duration;
			sawWriteDuration = true;
		}
		if (
			timeToFirstAppliedEditMs === undefined &&
			outcome === "applied" &&
			writtenFiles > 0 &&
			firstRecord
		) {
			timeToFirstAppliedEditMs = timestampMs(record) - timestampMs(firstRecord);
		}
		const mutations = record.payload.fileMutations;
		if (!Array.isArray(mutations)) {
			continue;
		}
		for (const mutation of mutations) {
			if (!mutation || typeof mutation !== "object") {
				continue;
			}
			const record0 = mutation as Record<string, unknown>;
			const pre = record0.contentVersionPre;
			const post = record0.contentVersionPost;
			if (typeof pre === "string" && typeof post === "string") {
				if (pre !== post) {
					filesWithVerifiedContentChange += 1;
				}
			} else if (record0.measurementSkipped !== undefined) {
				// The write happened but its CONTENT was not measured, so the
				// change is UNVERIFIED — not "unchanged".
				filesWithUnverifiedContentChange += 1;
			}
			const fileIdentity = record0.fileIdentity;
			if (typeof fileIdentity !== "string" || fileIdentity === "") {
				continue;
			}
			const versions = revisionsByFile.get(fileIdentity) ?? [];
			if (versions.length === 0) {
				if (typeof pre === "string") {
					versions.push(pre);
				}
			}
			if (typeof post === "string") {
				versions.push(post);
			}
			revisionsByFile.set(fileIdentity, versions);
		}
	}

	// A successful operation that wrote files but changed NO content is a
	// genuine no-op. The executor already reports this as `noOp`, and the
	// per-file measurement independently confirms it, so both are accepted
	// — but ONLY when at least one file was actually written (otherwise
	// the operation was not a no-op write, it was a no-write).
	for (const record of applications) {
		if (record.payload.outcome !== "applied") {
			continue;
		}
		const writtenFiles = readNonNegativeInteger(
			record.payload.mutatedFileCount,
		);
		if (!writtenFiles || writtenFiles === 0) {
			continue;
		}
		if (record.payload.noOp === true) {
			noOpEditOperations += 1;
		}
	}

	// REVERSION: the final observed version equals an EARLIER version.
	// CHURN: an intermediate version that a later revision superseded.
	let revertedMutations = 0;
	let revisionChurn = 0;
	for (const versions of revisionsByFile.values()) {
		if (versions.length < 3) {
			// Fewer than three versions means at most one observed write: no
			// intermediate version can have been superseded.
			continue;
		}
		const final = versions[versions.length - 1];
		const earlier = versions.slice(0, versions.length - 1);
		if (earlier.includes(final)) {
			revertedMutations += 1;
		}
		// Every version that is not the final one is an intermediate
		// mutation that a later revision superseded.
		revisionChurn += versions.length - 2;
	}

	const distinctFilesModified = revisionsByFile.size;
	const totalObservedMutations = Array.from(revisionsByFile.values()).reduce(
		(total, versions) => total + Math.max(0, versions.length - 1),
		0,
	);
	const editsPerFile =
		distinctFilesModified > 0
			? Math.round((totalObservedMutations / distinctFilesModified) * 100) / 100
			: 0;

	// Shell activity is reported SEPARATELY. A successful shell call does
	// NOT establish which files changed, so shell activity never
	// contributes to the native-edit counters.
	const toolStarts = records.filter((record) => record.event === "tool_start");
	const toolFinishes = records.filter(
		(record) => record.event === "tool_finish",
	);
	const shellToolNames = new Set(["run_commands", "bash", "shell"]);
	const shellStarts = toolStarts.filter((record) => {
		const name = record.payload.toolName;
		return typeof name === "string" && shellToolNames.has(name);
	});
	const shellCallCount = shellStarts.length;
	let shellCallSuccessCount = 0;
	for (const finish of toolFinishes) {
		const name = finish.payload.toolName;
		if (typeof name !== "string" || !shellToolNames.has(name)) {
			continue;
		}
		if (finish.payload.outcome !== "error") {
			shellCallSuccessCount += 1;
		}
	}

	// ------------------------------------------------------------------
	// EDIT ORIGIN (CORR01)
	// ------------------------------------------------------------------
	// There is NO independent workspace-delta source in this trace. The
	// recorder observes the WRITE LAYER, not the workspace, so a shell
	// call that happened to rewrite a file leaves NO evidence of that in
	// the trace.
	//
	// The previous implementation inferred "FILE_CHANGES_OBSERVED" from
	// the mere PRESENCE of a shell call. That fabricated an observation:
	// a read-only `run_commands` satisfied the predicate, and the report
	// then claimed a file change that nothing had measured.
	//
	// The corrected rule: shell activity without native edit telemetry is
	// reported as `EDIT_ORIGIN_UNOBSERVED` — the origin of anything the
	// shell may have changed is not observed. An actual observed file
	// change is reported only when an independent real workspace delta
	// establishes it, and no such source exists yet.
	const workspaceDeltaObserved = false;
	const editOriginUnobserved =
		!workspaceDeltaObserved &&
		shellCallCount > 0 &&
		applications.length === 0 &&
		attempts.length === 0;
	const unfulfilledEditAttempts = Math.max(
		0,
		attempts.length - fulfilledAttemptKeys.size,
	);
	void trace;

	return {
		nativeEditAttempts: attempts.length,
		successfulEditOperations,
		filesWritten,
		filesWithVerifiedContentChange,
		filesWithUnverifiedContentChange,
		noOpEditOperations,
		partialMutationOperations,
		failedEdits,
		distinctFilesModified,
		editsPerFile,
		revertedMutations,
		revisionChurn,
		...(timeToFirstAppliedEditMs !== undefined
			? { timeToFirstAppliedEditMs }
			: {}),
		...(sawWriteDuration ? { fileWriteDurationMs: totalWriteDurationMs } : {}),
		shellCallCount,
		shellCallSuccessCount,
		correlatedEditApplications,
		uncorrelatedEditApplications,
		unfulfilledEditAttempts,
		correlationProvenance: "EXACT_IDENTITY",
		editOriginUnobserved,
		workspaceDeltaObserved,
		editOriginMarker: editOriginUnobserved
			? "EDIT_ORIGIN_UNOBSERVED"
			: workspaceDeltaObserved
				? "FILE_CHANGES_OBSERVED / EDIT_ORIGIN_UNAVAILABLE"
				: "NATIVE_EDIT_ORIGIN_OBSERVED",
		acceptedExecutableGates: UNAVAILABLE,
		churnProvenance: "INFERRED",
		mutationProvenance: "REAL_PRODUCTION_SEAM",
	};
}

/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-WORKSPACE-EFFECT-TRACE01 (R4/R5).
 *
 * Compute the WORKSPACE PROGRESS of a trace.
 *
 * WHY THIS SECTION EXISTS
 * -----------------------
 * A benchmark run produced THIRTEEN applied native writes and ZERO
 * retained workspace changes. The existing editing-efficiency section
 * could not explain why, because it never learned WHERE the writes
 * landed and never learned what was on disk afterwards.
 *
 * This section reads the two NEW evidence channels:
 *
 *   - `edit_target_resolved` — where each write landed, relative to the
 *     active workspace;
 *   - `edit_write_verification` — what an INDEPENDENT read-back observed
 *     on disk after the write.
 *
 * HONESTY RULES
 * -------------
 *   - A destination whose scope could not be canonically established is
 *     `PATH_SCOPE_UNVERIFIED`, never "inside the workspace".
 *   - A write whose read-back could not be performed is UNVERIFIED,
 *     never "succeeded".
 *   - Shell activity is reported as ACTIVITY. The trace cannot attribute
 *     a filesystem change to a shell call, so it never contributes to a
 *     mutation count.
 *   - The git-tracked file count is reported separately from the
 *     filesystem-scoped target counts: "tracked by git" and "present in
 *     the tree" are different questions.
 */
function computeWorkspaceProgress(
	records: TraceRecord[],
): WorkspaceProgressStatistics {
	const resolutions = records.filter(
		(record) => record.event === "edit_target_resolved",
	);
	const verifications = records.filter(
		(record) => record.event === "edit_write_verification",
	);
	const applications = records.filter(
		(record) => record.event === "edit_application",
	);
	const failures = records.filter((record) => record.event === "edit_failure");
	const attempts = records.filter((record) => record.event === "edit_attempt");
	const toolStarts = records.filter((record) => record.event === "tool_start");

	const workspaceEvidenceAvailable = resolutions.length > 0;

	/**
	 * The scope of a resolved destination, read from the payload.
	 *
	 * An unrecognised scope is UNVERIFIED — never optimistically read as
	 * "inside the workspace".
	 */
	const readScope = (
		payload: Record<string, unknown>,
	):
		| "active_workspace"
		| "other_workspace"
		| "outside_workspace"
		| "unknown" => {
		const scope = payload.destinationScope;
		if (
			scope === "active_workspace" ||
			scope === "other_workspace" ||
			scope === "outside_workspace"
		) {
			return scope;
		}
		return "unknown";
	};

	/**
	 * The benchmark-root membership of a resolved destination.
	 *
	 * `undefined` means the membership was not established (no benchmark
	 * root was designated) — never "outside".
	 */
	const readUnderBenchmarkRoot = (
		payload: Record<string, unknown>,
	): boolean | undefined => {
		const value = payload.underBenchmarkRoot;
		return typeof value === "boolean" ? value : undefined;
	};

	// ------------------------------------------------------------------
	// DESTINATION SCOPE
	// ------------------------------------------------------------------
	let targetsInsideActiveWorkspace = 0;
	let targetsOutsideActiveWorkspace = 0;
	let targetsInOtherWorkspace = 0;
	let targetsScopeUnverified = 0;
	let trackedTargetCount = 0;
	let untrackedTargetCount = 0;
	let ignoredTargetCount = 0;

	const resolvedFileIdentities = new Set<string>();
	for (const record of resolutions) {
		const scope = readScope(record.payload);
		switch (scope) {
			case "active_workspace":
				targetsInsideActiveWorkspace += 1;
				break;
			case "outside_workspace":
				targetsOutsideActiveWorkspace += 1;
				break;
			case "other_workspace":
				targetsInOtherWorkspace += 1;
				break;
			default:
				targetsScopeUnverified += 1;
				break;
		}
		const underBenchmarkRoot = readUnderBenchmarkRoot(record.payload);
		if (underBenchmarkRoot === true) {
			trackedTargetCount += 1;
		} else if (underBenchmarkRoot === false) {
			untrackedTargetCount += 1;
		} else {
			ignoredTargetCount += 1;
		}
		const fileIdentity = record.payload.fileIdentity;
		if (typeof fileIdentity === "string" && fileIdentity !== "") {
			resolvedFileIdentities.add(fileIdentity);
		}
	}

	// ------------------------------------------------------------------
	// APPLIED WRITES — INSIDE vs OUTSIDE
	// ------------------------------------------------------------------
	//
	// A write is attributed to a destination ONLY when the resolution and
	// the application share the SAME tool-call identity. Without that
	// identity the write's destination is UNKNOWN — it is never counted
	// as inside or outside.
	const scopeByToolCallId = new Map<
		string,
		"active_workspace" | "other_workspace" | "outside_workspace" | "unknown"
	>();
	for (const record of resolutions) {
		const toolCallId = record.payload.toolCallId;
		if (typeof toolCallId !== "string" || toolCallId === "") {
			continue;
		}
		scopeByToolCallId.set(toolCallId, readScope(record.payload));
	}
	let appliedWritesInsideWorkspace = 0;
	let appliedWritesOutsideWorkspace = 0;
	for (const record of applications) {
		if (record.payload.outcome !== "applied") {
			continue;
		}
		const toolCallId = record.payload.toolCallId;
		if (typeof toolCallId !== "string" || toolCallId === "") {
			continue;
		}
		const scope = scopeByToolCallId.get(toolCallId);
		if (scope === "active_workspace") {
			appliedWritesInsideWorkspace += 1;
		} else if (scope === "outside_workspace" || scope === "other_workspace") {
			appliedWritesOutsideWorkspace += 1;
		}
	}

	// ------------------------------------------------------------------
	// INDEPENDENT VERIFICATION
	// ------------------------------------------------------------------
	let independentlyVerifiedWrites = 0;
	let verifiedWritesMatchingIntended = 0;
	let verifiedWritesDivergingFromIntended = 0;
	let unverifiedWrites = 0;
	let writesWithDestinationAbsent = 0;
	for (const record of verifications) {
		const matched = record.payload.readbackMatched;
		if (matched === true) {
			independentlyVerifiedWrites += 1;
			verifiedWritesMatchingIntended += 1;
		} else if (matched === false) {
			independentlyVerifiedWrites += 1;
			verifiedWritesDivergingFromIntended += 1;
		} else {
			// The read-back was not attempted or did not complete: the
			// write's outcome is UNVERIFIED — never "succeeded".
			unverifiedWrites += 1;
		}
		if (record.payload.fileExistsAfterWrite === false) {
			writesWithDestinationAbsent += 1;
		}
	}

	// ------------------------------------------------------------------
	// RETENTION CLASSIFICATION
	// ------------------------------------------------------------------
	//
	// The classification is per OBSERVED TARGET, driven by the CHECKPOINT
	// observation — a real filesystem observation taken at the operator
	// checkpoint or the trace dump.
	//
	// ACT-CLINEMM-MODEL-BEHAVIOR-WORKSPACE-EFFECT-TRACE01-CORR01: the
	// previous implementation derived the classification from the LAST
	// post-write read-back. That is unsound, because a command that later
	// restores the file produces no native editor event: the read-back
	// still describes the file as changed when the trace is dumped.
	//
	// The classification is now:
	//
	//   - the checkpoint observed the target as ABSENT → DELETED;
	//   - the checkpoint observed content equal to the content the target
	//     had BEFORE the first write → REVERTED (the change did not
	//     survive) or UNCHANGED (it never changed);
	//   - the checkpoint observed DIFFERENT content from the pre-write
	//     content → RETAINED_CHANGED (the change survived);
	//   - the target is outside the designated benchmark root →
	//     OUTSIDE_SCOPE;
	//   - the checkpoint could not read the target → UNVERIFIED;
	//   - the trace carries NO checkpoint → UNAVAILABLE_FROM_TRACE.
	const retentionCounts: Record<EditRetentionClassification, number> = {
		RETAINED_CHANGED: 0,
		REVERTED: 0,
		DELETED: 0,
		UNCHANGED: 0,
		OUTSIDE_SCOPE: 0,
		UNVERIFIED: 0,
		UNAVAILABLE_FROM_TRACE: 0,
	};

	/**
	 * The observed content sequence of each file identity, in record
	 * order.
	 *
	 * This is the LAST_OBSERVED_POST_WRITE_STATE: what the post-write
	 * read-backs saw. It is NOT the current state of the file, and it is
	 * never used to classify a retained change.
	 */
	const observedContentByFile = new Map<string, string[]>();
	/**
	 * Whether each file identity was observed as ABSENT at its last
	 * read-back.
	 */
	const absentAtLastReadback = new Set<string>();

	for (const record of verifications) {
		const fileIdentity = record.payload.fileIdentity;
		if (typeof fileIdentity !== "string" || fileIdentity === "") {
			continue;
		}
		if (record.payload.fileExistsAfterWrite === false) {
			absentAtLastReadback.add(fileIdentity);
			continue;
		}
		absentAtLastReadback.delete(fileIdentity);
		const actual = record.payload.actualContentFingerprint;
		if (typeof actual !== "string" || actual === "") {
			continue;
		}
		const versions = observedContentByFile.get(fileIdentity) ?? [];
		versions.push(actual);
		observedContentByFile.set(fileIdentity, versions);
	}

	// The benchmark-root membership of each file identity.
	const underBenchmarkRootByFileIdentity = new Map<string, boolean>();
	for (const record of resolutions) {
		const fileIdentity = record.payload.fileIdentity;
		if (typeof fileIdentity !== "string" || fileIdentity === "") {
			continue;
		}
		const underBenchmarkRoot = readUnderBenchmarkRoot(record.payload);
		if (underBenchmarkRoot !== undefined) {
			underBenchmarkRootByFileIdentity.set(fileIdentity, underBenchmarkRoot);
		}
	}

	// The union of every file identity the trace observed as a target.
	const allFileIdentities = new Set<string>([
		...resolvedFileIdentities,
		...observedContentByFile.keys(),
		...absentAtLastReadback,
	]);

	// ------------------------------------------------------------------
	// THE CHECKPOINT OBSERVATION
	// ------------------------------------------------------------------
	//
	// ACT-CLINEMM-MODEL-BEHAVIOR-WORKSPACE-EFFECT-TRACE01-CORR01: the
	// checkpoint is the ONLY authority for a retained-change
	// classification. It is a real filesystem observation taken at the
	// operator checkpoint or the trace dump.
	const checkpoints = records.filter(
		(record) => record.event === "edit_checkpoint_observation",
	);

	/**
	 * The checkpointed state of each file identity.
	 *
	 * The LAST checkpoint wins: a later checkpoint is a later observation
	 * of the same target.
	 */
	const checkpointStateByFile = new Map<
		string,
		{
			readonly state: "present" | "absent" | "unreadable";
			readonly contentFingerprint?: string;
		}
	>();
	for (const record of checkpoints) {
		const targets = record.payload.targets;
		if (!Array.isArray(targets)) {
			continue;
		}
		for (const target of targets) {
			if (!target || typeof target !== "object") {
				continue;
			}
			const entry = target as Record<string, unknown>;
			const fileIdentity = entry.fileIdentity;
			if (typeof fileIdentity !== "string" || fileIdentity === "") {
				continue;
			}
			const state = entry.state;
			if (state !== "present" && state !== "absent" && state !== "unreadable") {
				continue;
			}
			const contentFingerprint = entry.contentFingerprint;
			checkpointStateByFile.set(fileIdentity, {
				state,
				...(typeof contentFingerprint === "string" && contentFingerprint !== ""
					? { contentFingerprint }
					: {}),
			});
		}
	}

	/**
	 * The content version each file identity had BEFORE its first write.
	 *
	 * It is the baseline a retained change is measured against: the
	 * checkpoint's content equals the baseline when the change did NOT
	 * survive.
	 */
	const preWriteVersionByFile = new Map<string, string>();
	for (const record of applications) {
		const mutations = record.payload.fileMutations;
		if (!Array.isArray(mutations)) {
			continue;
		}
		for (const mutation of mutations) {
			if (!mutation || typeof mutation !== "object") {
				continue;
			}
			const entry = mutation as Record<string, unknown>;
			const fileIdentity = entry.fileIdentity;
			const pre = entry.contentVersionPre;
			if (
				typeof fileIdentity !== "string" ||
				fileIdentity === "" ||
				typeof pre !== "string" ||
				pre === ""
			) {
				continue;
			}
			// The FIRST observed pre-write version is the baseline.
			if (!preWriteVersionByFile.has(fileIdentity)) {
				preWriteVersionByFile.set(fileIdentity, pre);
			}
		}
	}

	// ACT-CLINEMM-MODEL-BEHAVIOR-WORKSPACE-EFFECT-TRACE01-CORR01: when the
	// trace carries no explicit pre-write content version, the baseline
	// falls back to the FIRST observed post-write content version.
	//
	// That is the content the file held before the first observed write
	// changed it, in the A → B → A shape: the first read-back observed A,
	// the second observed B, and the checkpoint observed A again — so the
	// change happened and was undone.
	//
	// The fallback is only used when the trace provides no explicit
	// baseline; an explicit `contentVersionPre` always wins.
	for (const [fileIdentity, versions] of observedContentByFile) {
		if (preWriteVersionByFile.has(fileIdentity)) {
			continue;
		}
		const first = versions[0];
		if (typeof first === "string" && first !== "") {
			preWriteVersionByFile.set(fileIdentity, first);
		}
	}

	/**
	 * The timestamp of the last retained change, for the progress figure.
	 */
	let lastRetainedChangeTimestampMs: number | undefined;
	/**
	 * The timestamp of the first write whose destination was inside the
	 * active workspace.
	 */
	let firstInsideWorkspaceWriteTimestampMs: number | undefined;

	for (const fileIdentity of allFileIdentities) {
		if (underBenchmarkRootByFileIdentity.get(fileIdentity) === false) {
			retentionCounts.OUTSIDE_SCOPE += 1;
			continue;
		}
		const checkpoint = checkpointStateByFile.get(fileIdentity);
		if (!checkpoint) {
			// No checkpoint observation for this target. The CURRENT state
			// of the file is NOT knowable from the trace, so the honest
			// answer is UNAVAILABLE_FROM_TRACE — never a guess, and never
			// a retained change derived from the last post-write read-back.
			retentionCounts.UNAVAILABLE_FROM_TRACE += 1;
			continue;
		}
		if (checkpoint.state === "absent") {
			// The checkpoint observed the target as ABSENT: it was deleted
			// (or never created) after the last observed write.
			retentionCounts.DELETED += 1;
			continue;
		}
		if (checkpoint.state === "unreadable") {
			// The checkpoint could not read the target: the state is
			// genuinely UNKNOWN, never "unchanged".
			retentionCounts.UNVERIFIED += 1;
			continue;
		}
		const baseline = preWriteVersionByFile.get(fileIdentity);
		if (baseline === undefined || checkpoint.contentFingerprint === undefined) {
			// Without a pre-write baseline or a checkpointed content
			// fingerprint, whether anything CHANGED is not knowable.
			retentionCounts.UNVERIFIED += 1;
			continue;
		}
		if (checkpoint.contentFingerprint === baseline) {
			// The checkpoint observed the ORIGINAL content: the write did
			// not survive.
			//
			// The discriminator is whether the target was EVER observed
			// with content other than its baseline. If it was, the change
			// happened and was then undone → REVERTED. If it never was,
			// nothing changed → UNCHANGED.
			const versions = observedContentByFile.get(fileIdentity) ?? [];
			const wasObservedChanged = versions.some(
				(version) => version !== baseline,
			);
			if (wasObservedChanged) {
				retentionCounts.REVERTED += 1;
			} else {
				retentionCounts.UNCHANGED += 1;
			}
			continue;
		}
		// The checkpoint observed content that differs from the pre-write
		// baseline: the change SURVIVED to the checkpoint.
		retentionCounts.RETAINED_CHANGED += 1;
	}

	// The timestamp of the last retained change, derived from the
	// checkpoint that classified a target as RETAINED_CHANGED.
	//
	// ACT-CLINEMM-MODEL-BEHAVIOR-WORKSPACE-EFFECT-TRACE01-CORR01: this is
	// the checkpoint's timestamp, not a post-write read-back's — the
	// retained change is the one that SURVIVED to the checkpoint.
	for (const record of checkpoints) {
		const targets = record.payload.targets;
		if (!Array.isArray(targets)) {
			continue;
		}
		const at = timestampMs(record);
		for (const target of targets) {
			if (!target || typeof target !== "object") {
				continue;
			}
			const entry = target as Record<string, unknown>;
			const fileIdentity = entry.fileIdentity;
			const contentFingerprint = entry.contentFingerprint;
			if (
				typeof fileIdentity !== "string" ||
				fileIdentity === "" ||
				typeof contentFingerprint !== "string" ||
				contentFingerprint === ""
			) {
				continue;
			}
			const baseline = preWriteVersionByFile.get(fileIdentity);
			if (baseline === undefined || contentFingerprint === baseline) {
				continue;
			}
			if (
				lastRetainedChangeTimestampMs === undefined ||
				at > lastRetainedChangeTimestampMs
			) {
				lastRetainedChangeTimestampMs = at;
			}
		}
	}

	// The first write whose destination was inside the active workspace.
	for (const record of applications) {
		if (record.payload.outcome !== "applied") {
			continue;
		}
		const toolCallId = record.payload.toolCallId;
		if (typeof toolCallId !== "string" || toolCallId === "") {
			continue;
		}
		if (scopeByToolCallId.get(toolCallId) !== "active_workspace") {
			continue;
		}
		const at = timestampMs(record);
		if (
			firstInsideWorkspaceWriteTimestampMs === undefined ||
			at < firstInsideWorkspaceWriteTimestampMs
		) {
			firstInsideWorkspaceWriteTimestampMs = at;
		}
	}

	const firstRecord = records[0];
	const lastRecord = records[records.length - 1];
	const timeToFirstWriteInsideWorkspaceMs =
		firstInsideWorkspaceWriteTimestampMs !== undefined && firstRecord
			? firstInsideWorkspaceWriteTimestampMs - timestampMs(firstRecord)
			: undefined;
	const timeSinceLastRetainedChangeMs =
		lastRetainedChangeTimestampMs !== undefined && lastRecord
			? timestampMs(lastRecord) - lastRetainedChangeTimestampMs
			: undefined;

	// The number of tool calls observed after the last retained change.
	const toolCallsSinceLastRetainedChange =
		lastRetainedChangeTimestampMs === undefined
			? toolStarts.length
			: toolStarts.filter(
					(record) => timestampMs(record) > lastRetainedChangeTimestampMs,
				).length;

	// Shell activity, reported SEPARATELY.
	const shellToolNames = new Set(["run_commands", "bash", "shell"]);
	const shellStarts = toolStarts.filter((record) => {
		const name = record.payload.toolName;
		return typeof name === "string" && shellToolNames.has(name);
	});
	const shellCallCount = shellStarts.length;
	const toolFinishes = records.filter(
		(record) => record.event === "tool_finish",
	);
	let shellCallSuccessCount = 0;
	for (const finish of toolFinishes) {
		const name = finish.payload.toolName;
		if (typeof name !== "string" || !shellToolNames.has(name)) {
			continue;
		}
		if (finish.payload.outcome !== "error") {
			shellCallSuccessCount += 1;
		}
	}
	// Shell activity that produced NO observed native mutation. The trace
	// CANNOT attribute a filesystem change to a shell call, so this is
	// activity, never an observed mutation.
	const shellActivityWithoutObservedMutation =
		shellCallCount > 0 && applications.length === 0 ? shellCallCount : 0;

	// The unfulfilled attempts: an attempt with no application joined to
	// it. The join is by EXACT identity only.
	const fulfilledAttemptKeys = new Set<string>();
	for (const record of applications) {
		const identity = readCorrelationIdentity(record);
		if (identity) {
			fulfilledAttemptKeys.add(identity.key);
		}
	}
	let unfulfilledEditAttempts = 0;
	for (const record of attempts) {
		const identity = readCorrelationIdentity(record);
		if (!identity || !fulfilledAttemptKeys.has(identity.key)) {
			unfulfilledEditAttempts += 1;
		}
	}

	return {
		targetsResolved: resolutions.length,
		targetsInsideActiveWorkspace,
		targetsOutsideActiveWorkspace,
		targetsInOtherWorkspace,
		targetsScopeUnverified,
		appliedWritesOutsideWorkspace,
		appliedWritesInsideWorkspace,
		independentlyVerifiedWrites,
		verifiedWritesMatchingIntended,
		verifiedWritesDivergingFromIntended,
		unverifiedWrites,
		writesWithDestinationAbsent,
		retentionCounts,
		trackedTargetCount,
		untrackedTargetCount,
		ignoredTargetCount,
		...(timeToFirstWriteInsideWorkspaceMs !== undefined
			? { timeToFirstWriteInsideWorkspaceMs }
			: {}),
		...(timeSinceLastRetainedChangeMs !== undefined
			? { timeSinceLastRetainedChangeMs }
			: {}),
		toolCallsSinceLastRetainedChange,
		nativeEditFailures: failures.length,
		unfulfilledEditAttempts,
		shellCallCount,
		shellCallSuccessCount,
		shellActivityWithoutObservedMutation,
		workspaceEvidenceAvailable,
		workspaceEvidenceMarker: workspaceEvidenceAvailable
			? "WORKSPACE_EFFECT_OBSERVED"
			: UNAVAILABLE,
		acceptedExecutableGates: UNAVAILABLE,
		workspaceProvenance: "REAL_PRODUCTION_SEAM",
	};
}

/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-EDIT-EFFICIENCY-TRACE01-CORR01.
 *
 * The exact correlation identity of an edit event.
 *
 * The identity is the session + run + tool-call id. It is read from the
 * EVENT itself, never inferred from its position in the record stream.
 */
interface CorrelationIdentity {
	/** The composite key used for the join. */
	readonly key: string;
}

/**
 * Read the exact correlation identity of an edit event.
 *
 * The identity is the COMPLETE triple: session + run + tool-call id. All
 * three components must be present and nonempty, otherwise the event
 * carries an INCOMPLETE identity and stays UNVERIFIED — it is never
 * paired with an attempt.
 *
 * Coercing a missing component to the empty string would let two
 * different incomplete identities collapse onto the SAME key (for
 * example both "  tc-1"), which would let the join pair events that are
 * not provably the same edit. Failing closed is the only safe reading:
 * an incomplete identity is no identity at all.
 */
function readCorrelationIdentity(
	record: TraceRecord,
): CorrelationIdentity | undefined {
	const toolCallId = record.payload.toolCallId;
	if (typeof toolCallId !== "string" || toolCallId === "") {
		return undefined;
	}
	const sessionId = record.sessionId;
	if (typeof sessionId !== "string" || sessionId === "") {
		return undefined;
	}
	const runId = record.runId;
	if (typeof runId !== "string" || runId === "") {
		return undefined;
	}
	return { key: `${sessionId} ${runId} ${toolCallId}` };
}

/**
 * Read a non-negative integer from an unknown payload value.
 *
 * A non-integer or negative value is UNKNOWN, never coerced to zero.
 */
function readNonNegativeInteger(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return undefined;
	}
	if (!Number.isInteger(value) || value < 0) {
		return undefined;
	}
	return value;
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
		key: "extensionBundleSha256",
		reason:
			"different installed bundle identity — the two traces ran DIFFERENT extension bytes, so behavior differences may come from the build, not the model",
	},
	{
		key: "extensionVersion",
		reason:
			"different extension version — behavior differences may come from the build, not the model",
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
 * ACT-CLINEMM-MODEL-BEHAVIOR-COMPARATOR-CORRECTION01 (C1): the ceiling-mode
 * operating fact carried by a configuration snapshot.
 *
 * The mode is one of:
 *   - `auto`    — no user-configured ceiling; the effective budget came
 *                 from the model/provider capacity chain,
 *   - `explicit`— the user configured a ceiling,
 *   - `unknown` — the mode was not observed.
 */
type CeilingMode = "auto" | "explicit" | "unknown";

/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-COMPARATOR-CORRECTION01 (C1): the verdict of
 * the COMBINED ceiling assessment.
 *
 * The ceiling dimensions (`userContextCeiling`, `userContextCeilingMode`,
 * `effectiveMaxInputTokens`, `inputBudgetSource`) describe ONE fact: the
 * compaction boundary the two runs actually used. They are therefore
 * assessed together rather than as four independent scalar comparisons.
 */
interface CeilingParity {
	readonly comparison: DimensionComparison;
	readonly reason: string;
	/**
	 * The dimension the verdict is anchored to — the one that actually
	 * decided the outcome. It is the dimension reported in the material /
	 * unverified difference list.
	 */
	readonly anchorDimension: string;
	/** The per-dimension verdicts, keyed by dimension name. */
	readonly dimensions: Record<
		string,
		{ m3: string; m31: string; comparison: DimensionComparison }
	>;
}

/** Read the recorded ceiling operating mode. */
function readCeilingMode(config: Record<string, string>): CeilingMode {
	const mode = config.userContextCeilingMode?.trim().toLowerCase();
	if (mode === "auto") {
		return "auto";
	}
	if (mode === "explicit") {
		return "explicit";
	}
	return "unknown";
}

/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-COMPARATOR-CORRECTION01 (C1): assess the
 * ceiling equivalence of two configuration snapshots as ONE fact.
 *
 * The rules are:
 *
 *   1. An UNKNOWN operating mode on either side is UNVERIFIED. An unknown
 *      mode is never assumed to be Auto, and Auto equivalence is never
 *      granted on an unknown mode.
 *   2. `auto` vs `explicit` (in either order) is a MATERIAL difference:
 *      one side ran under a user ceiling and the other under the model's
 *      own capacity, so the compaction boundaries differ.
 *   3. `auto` vs `auto` satisfies ceiling-mode equivalence ONLY when the
 *      effective input budget AND its provenance are KNOWN and EQUAL on
 *      both sides. That is an INDEPENDENTLY VERIFIED equivalence: the two
 *      runs provably used the same compaction boundary even though neither
 *      configured a ceiling.
 *   4. `explicit` vs `explicit` requires the configured ceilings to be
 *      known and equal, AND the effective budgets and their provenance to
 *      be known and equal.
 *   5. Any other combination (different budgets, different provenance, an
 *      unknown effective budget) is either MATERIAL (both sides known and
 *      different) or UNVERIFIED (a value is unknown on either side).
 */
function assessCeilingParity(
	m3Config: Record<string, string>,
	m31Config: Record<string, string>,
): CeilingParity {
	const m3Mode = readCeilingMode(m3Config);
	const m31Mode = readCeilingMode(m31Config);
	const budget = compareDimension(
		"effectiveMaxInputTokens",
		m3Config.effectiveMaxInputTokens,
		m31Config.effectiveMaxInputTokens,
	);
	const provenance = compareDimension(
		"inputBudgetSource",
		m3Config.inputBudgetSource,
		m31Config.inputBudgetSource,
	);
	const ceiling = compareDimension(
		"userContextCeiling",
		m3Config.userContextCeiling,
		m31Config.userContextCeiling,
	);
	const mode = compareDimension(
		"userContextCeilingMode",
		m3Config.userContextCeilingMode,
		m31Config.userContextCeilingMode,
	);

	const dimensions: CeilingParity["dimensions"] = {
		userContextCeiling: {
			m3: ceiling.m3,
			m31: ceiling.m31,
			comparison: ceiling.comparison,
		},
		userContextCeilingMode: {
			m3: mode.m3,
			m31: mode.m31,
			comparison: mode.comparison,
		},
		effectiveMaxInputTokens: {
			m3: budget.m3,
			m31: budget.m31,
			comparison: budget.comparison,
		},
		inputBudgetSource: {
			m3: provenance.m3,
			m31: provenance.m31,
			comparison: provenance.comparison,
		},
	};

	// (1) An unknown operating mode fails closed.
	if (m3Mode === "unknown" || m31Mode === "unknown") {
		return {
			comparison: "unverified",
			anchorDimension: "userContextCeilingMode",
			reason:
				"the user context ceiling OPERATING MODE is UNKNOWN on at least one side — an unknown mode is never assumed to be Auto, so ceiling-mode equivalence is UNPROVEN",
			dimensions,
		};
	}

	// (2) Auto vs explicit is a material difference.
	if (m3Mode !== m31Mode) {
		return {
			comparison: "different",
			anchorDimension: "userContextCeilingMode",
			reason: `different user context ceiling operating mode — one side ran under an explicit ceiling ("${m3Mode}") and the other under "${m31Mode}", so the compaction boundary differs`,
			dimensions,
		};
	}

	// (3) Auto vs Auto: equivalence requires a known, equal effective budget
	// AND a known, equal budget provenance.
	if (m3Mode === "auto") {
		if (budget.comparison === "different") {
			return {
				comparison: "different",
				anchorDimension: "effectiveMaxInputTokens",
				reason:
					"both sides ran under the verified Auto operating mode, but their EFFECTIVE context input budgets differ — the compaction boundary differs, so the traces are not comparable",
				dimensions,
			};
		}
		if (provenance.comparison === "different") {
			return {
				comparison: "different",
				anchorDimension: "inputBudgetSource",
				reason:
					"both sides ran under the verified Auto operating mode, but their input-budget PROVENANCE differs — the effective budget was resolved from different inputs, so the compaction boundary differs",
				dimensions,
			};
		}
		if (
			budget.comparison === "unverified" ||
			provenance.comparison === "unverified"
		) {
			return {
				comparison: "unverified",
				anchorDimension:
					budget.comparison === "unverified"
						? "effectiveMaxInputTokens"
						: "inputBudgetSource",
				reason:
					"both sides ran under the verified Auto operating mode, but the effective input budget or its provenance is UNKNOWN — Auto ceiling-mode equivalence requires a KNOWN and EQUAL effective budget and budget provenance",
				dimensions,
			};
		}
		// The verified equivalence is established. The raw user ceiling is
		// not a separate fact in Auto mode: there IS no user ceiling.
		dimensions.userContextCeiling = {
			m3: ceiling.m3,
			m31: ceiling.m31,
			comparison: "equal",
		};
		return {
			comparison: "equal",
			anchorDimension: "userContextCeilingMode",
			reason:
				"both sides ran under the INDEPENDENTLY VERIFIED Auto operating mode with the SAME known effective input budget resolved from the SAME known budget provenance — the compaction boundary is provably identical",
			dimensions,
		};
	}

	// (4) Explicit vs explicit.
	if (ceiling.comparison === "different") {
		return {
			comparison: "different",
			anchorDimension: "userContextCeiling",
			reason:
				"different user context ceiling — the compaction boundary differs, so the traces are not comparable",
			dimensions,
		};
	}
	if (
		ceiling.comparison === "unverified" ||
		budget.comparison === "unverified" ||
		provenance.comparison === "unverified"
	) {
		return {
			comparison: "unverified",
			anchorDimension:
				ceiling.comparison === "unverified"
					? "userContextCeiling"
					: budget.comparison === "unverified"
						? "effectiveMaxInputTokens"
						: "inputBudgetSource",
			reason:
				"both sides ran under an explicit ceiling, but the configured ceiling, the effective input budget, or the budget provenance is UNKNOWN — a known value cannot be matched against an unknown one",
			dimensions,
		};
	}
	if (
		budget.comparison === "different" ||
		provenance.comparison === "different"
	) {
		return {
			comparison: "different",
			anchorDimension:
				budget.comparison === "different"
					? "effectiveMaxInputTokens"
					: "inputBudgetSource",
			reason:
				"both sides ran under an explicit ceiling, but their effective input budget or budget provenance differs — the compaction boundary differs",
			dimensions,
		};
	}
	return {
		comparison: "equal",
		anchorDimension: "userContextCeilingMode",
		reason:
			"both sides ran under the same explicit ceiling with the same effective input budget resolved from the same budget provenance",
		dimensions,
	};
}

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
 * ACT-CLINEMM-MODEL-BEHAVIOR-COMPARABILITY-AUTHORITY-REPAIR01 (R2/R5):
 * the SOURCE/BUILD parity verdict.
 *
 * The source identity and the artifact identity are SEPARATE facts:
 *
 *   - `sourceHead` is the SOURCE provenance. It is "unknown" whenever the
 *     build was not made from a git working tree (the normal case for an
 *     installed VSIX).
 *   - `extensionBundleSha256` is the ARTIFACT identity: the SHA-256 of the
 *     ACTUAL installed `dist/extension.js` bytes that ran.
 *
 * The rules are:
 *
 *   1. Two KNOWN, DIFFERENT bundle digests are incompatible — the bytes
 *      differed, regardless of what the source provenance says.
 *   2. Two KNOWN, EQUAL source heads are equal.
 *   3. Two KNOWN, DIFFERENT source heads are incompatible.
 *   4. Two KNOWN, EQUAL bundle digests AND equal extension versions are a
 *      VERIFIED EQUIVALENT ARTIFACT-IDENTITY PROOF: the two traces ran the
 *      SAME bytes of the SAME release. That is sufficient to establish
 *      source/build parity even when the source provenance is unknown.
 *   5. Otherwise — most importantly when the source provenance is unknown
 *      on either side and there is NO verified artifact-identity proof —
 *      source/build parity is UNVERIFIED. Unknown source provenance is
 *      NEVER turned into a match.
 */
interface SourceBuildParity {
	readonly comparison: DimensionComparison;
	readonly reason: string;
	/** True when the artifact-identity proof established the parity. */
	readonly artifactIdentityProof: boolean;
}

function assessSourceBuildParity(
	m3Config: Record<string, string>,
	m31Config: Record<string, string>,
): SourceBuildParity {
	const sourceEqual = compareDimension(
		"sourceHead",
		m3Config.sourceHead,
		m31Config.sourceHead,
	);
	const bundleEqual = compareDimension(
		"extensionBundleSha256",
		m3Config.extensionBundleSha256,
		m31Config.extensionBundleSha256,
	);
	const versionEqual = compareDimension(
		"extensionVersion",
		m3Config.extensionVersion,
		m31Config.extensionVersion,
	);

	// (1) Different BYTES are always incompatible, whatever the source says.
	if (bundleEqual.comparison === "different") {
		return {
			comparison: "different",
			reason:
				"the two traces ran DIFFERENT installed bundle bytes (different extensionBundleSha256) — behavior differences may come from the build, not the model",
			artifactIdentityProof: false,
		};
	}

	// (2) The same source head is a direct proof.
	if (sourceEqual.comparison === "equal") {
		return {
			comparison: "equal",
			reason: "both sides observed the same source HEAD",
			artifactIdentityProof: false,
		};
	}

	// (3) Two different, KNOWN source heads are incompatible.
	if (sourceEqual.comparison === "different") {
		return {
			comparison: "different",
			reason:
				"the two traces were built from DIFFERENT source HEADs — behavior differences may come from the code, not the model",
			artifactIdentityProof: false,
		};
	}

	// (4) The source provenance is unknown on at least one side. A verified
	// EQUIVALENT artifact-identity proof can still establish the parity.
	if (
		bundleEqual.comparison === "equal" &&
		versionEqual.comparison === "equal"
	) {
		return {
			comparison: "equal",
			reason:
				"the source provenance is unknown, but BOTH traces ran the SAME verified installed bundle bytes of the SAME extension version — that is a verified equivalent artifact-identity proof",
			artifactIdentityProof: true,
		};
	}

	// (5) Nothing proves the parity. Unknown source provenance is never
	// turned into a match.
	return {
		comparison: "unverified",
		reason:
			"the source provenance is unknown and there is NO verified equivalent artifact-identity proof (equal installed bundle bytes AND equal extension version) — source/build parity is UNPROVEN",
		artifactIdentityProof: false,
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

	// ACT-CLINEMM-MODEL-BEHAVIOR-COMPARABILITY-AUTHORITY-REPAIR01 (R2/R5):
	// the source/build parity is assessed as ONE combined fact, because the
	// source provenance and the artifact identity are two proofs of the same
	// claim (and either one can settle it).
	const sourceBuildParity = assessSourceBuildParity(m3Config, m31Config);
	const sourceEqual = compareDimension(
		"sourceHead",
		m3Config.sourceHead,
		m31Config.sourceHead,
	);
	const bundleEqual = compareDimension(
		"extensionBundleSha256",
		m3Config.extensionBundleSha256,
		m31Config.extensionBundleSha256,
	);
	fields.sourceHead = {
		m3: sourceEqual.m3,
		m31: sourceEqual.m31,
		comparison: sourceBuildParity.comparison,
	};
	fields.extensionBundleSha256 = {
		m3: bundleEqual.m3,
		m31: bundleEqual.m31,
		comparison:
			sourceBuildParity.comparison === "equal" &&
			sourceBuildParity.artifactIdentityProof
				? "equal"
				: bundleEqual.comparison,
	};
	if (sourceBuildParity.comparison === "different") {
		differences.push({
			dimension: "sourceHead",
			m3: sourceEqual.m3,
			m31: sourceEqual.m31,
			severity: "material",
			reason: sourceBuildParity.reason,
		});
	} else if (sourceBuildParity.comparison === "unverified") {
		differences.push({
			dimension: "sourceHead",
			m3: sourceEqual.m3,
			m31: sourceEqual.m31,
			severity: "unverified",
			reason: `${sourceBuildParity.reason} — this dimension could not be VERIFIED from the trace, so source/build parity is UNPROVEN`,
		});
	}

	// ACT-CLINEMM-MODEL-BEHAVIOR-COMPARATOR-CORRECTION01 (C1): the ceiling
	// dimensions are assessed as ONE COMBINED FACT.
	//
	// The four ceiling dimensions describe the SAME fact — the compaction
	// boundary the run actually used — so they are NOT four independent
	// scalar comparisons. In particular, two independently verified Auto
	// modes (known and equal effective budget AND known and equal budget
	// provenance) satisfy ceiling-mode equivalence even though the raw user
	// ceiling is absent on both sides.
	const ceilingParity = assessCeilingParity(m3Config, m31Config);
	for (const [dimension, result] of Object.entries(ceilingParity.dimensions)) {
		fields[dimension] = {
			m3: result.m3,
			m31: result.m31,
			comparison: result.comparison,
		};
	}
	if (ceilingParity.comparison === "different") {
		differences.push({
			dimension: ceilingParity.anchorDimension,
			m3:
				ceilingParity.dimensions[ceilingParity.anchorDimension]?.m3 ??
				UNAVAILABLE,
			m31:
				ceilingParity.dimensions[ceilingParity.anchorDimension]?.m31 ??
				UNAVAILABLE,
			severity: "material",
			reason: ceilingParity.reason,
		});
	} else if (ceilingParity.comparison === "unverified") {
		differences.push({
			dimension: ceilingParity.anchorDimension,
			m3:
				ceilingParity.dimensions[ceilingParity.anchorDimension]?.m3 ??
				UNAVAILABLE,
			m31:
				ceilingParity.dimensions[ceilingParity.anchorDimension]?.m31 ??
				UNAVAILABLE,
			severity: "unverified",
			reason: `${ceilingParity.reason} — this dimension could not be VERIFIED from the trace, so source/build parity is UNPROVEN`,
		});
	}

	for (const dimension of MATERIAL_DIMENSIONS) {
		// The source/build dimensions were already assessed as one combined
		// fact above.
		if (
			dimension.key === "sourceHead" ||
			dimension.key === "extensionBundleSha256"
		) {
			continue;
		}
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

	// (1) Configuration presence. Configuration is recorded at session build
	// time AND at the effective model-request boundary. Enabling the
	// recorder on an ALREADY-RUNNING session produces a trace with NO
	// configuration at all.
	//
	// ACT-CLINEMM-MODEL-BEHAVIOR-COMPARABILITY-AUTHORITY-REPAIR01 (R3/R4):
	// an EFFECTIVE snapshot also establishes that the configuration is
	// known — it is the stronger evidence, because it carries the real
	// session/run identity.
	if (config.snapshots.length === 0 && config.effectiveSnapshots.length === 0) {
		fail(
			"missing_config",
			"missing_model_config",
			"the trace contains NO model_config snapshot — the model configuration is UNKNOWN, so comparability cannot be established (configuration is recorded at session build time and at the effective model-request boundary)",
		);
	} else if (config.snapshots.length > 1) {
		// (2) Ambiguous configuration: more than one snapshot means the
		// trace spans multiple sessions/models.
		//
		// When a run was EXPLICITLY selected, the ambiguity is resolved for
		// that run: only the snapshots belonging to the selected run (and the
		// session-level snapshot it inherits) are considered.
		//
		// ACT-CLINEMM-MODEL-BEHAVIOR-COMPARATOR-CORRECTION01 (C2): the
		// SESSION-LESS / SESSION-BOUND build-time pair is ONE
		// configuration, not an ambiguity. The pair is cross-checked by
		// value: when the halves agree on every material dimension there is
		// no ambiguity. When they DISAGREE, the build-time configuration is
		// ambiguous and the comparison is refused.
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
			const conflictingDimensions = collectEffectiveConflicts(
				scopedSnapshots,
			).map((conflict) => conflict.dimension);
			if (conflictingDimensions.length > 0) {
				fail(
					"ambiguous_config",
					"ambiguous_model_config",
					`the trace contains ${distinct.size} DISTINCT model_config snapshots that disagree on ${conflictingDimensions.join(", ")} — the build-time configuration is AMBIGUOUS; select one run explicitly`,
				);
			}
		}
	}

	// ACT-CLINEMM-MODEL-BEHAVIOR-COMPARATOR-CORRECTION01 (C2): EVERY
	// effective snapshot belonging to the selected run is evaluated. A
	// mid-run material change is DETECTED, not silently ignored.
	//
	// The selection is reused here so the comparability verdict and the
	// dimension comparison always describe the SAME set of snapshots.
	const selection = selectConfigValues(trace, selectedRunId);
	if (selection.effectiveConflicts.length > 0) {
		const described = selection.effectiveConflicts
			.map(
				(conflict) => `${conflict.dimension} (${conflict.values.join(" vs ")})`,
			)
			.join(", ");
		fail(
			"ambiguous_config",
			"effective_model_config_changed",
			`the selected run's effective model configuration CHANGED during the run — ${described}. The run was not governed by a single configuration, so the observed behavior cannot be attributed to the model alone`,
		);
	}

	// (3) Model attribution. The recorded model identity must match the
	// supplied label.
	//
	// ACT-CLINEMM-MODEL-BEHAVIOR-COMPARATOR-CORRECTION01 (C3): the
	// IDENTITY-VERIFIED run scope is applied BEFORE the model-family
	// membership is evaluated.
	//
	// Without this, selecting an M3 run from a mixed-model dump would
	// inherit the M3.1 identities recorded by the dump's OTHER runs and
	// the attribution would be wrongly REJECTED. The scope is never
	// widened by the attribution check: an UNSCOPED mixed-model dump is
	// still refused (see check (4)).
	const scopedModelIds = selectedRunId
		? collectScopedModelIds(trace, selectedRunId)
		: config.observedModelIds;
	if (scopedModelIds.length > 0) {
		const mismatched = scopedModelIds.filter((modelId) => {
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
 * ACT-CLINEMM-MODEL-BEHAVIOR-COMPARATOR-CORRECTION01 (C2): the outcome of
 * selecting the configuration values that describe the SELECTED run.
 */
interface ConfigSelection {
	/** The merged configuration values used for the dimension comparison. */
	readonly values: Record<string, string>;
	/**
	 * The effective snapshots that were evaluated for the selected run.
	 * EVERY one of them is considered — not just the first.
	 */
	readonly evaluatedEffectiveSnapshots: number;
	/**
	 * The MATERIAL dimensions on which the evaluated effective snapshots
	 * disagreed. A non-empty list means the configuration CHANGED during
	 * the run, which is a refusal — not something to average away.
	 */
	readonly effectiveConflicts: Array<{
		dimension: string;
		values: string[];
	}>;
	/**
	 * True when the build-time configuration could not be bound to the
	 * selected run (e.g. a session-less snapshot in a multi-session trace).
	 */
	readonly buildTimeUnbound: boolean;
}

/**
 * The effective-snapshot dimensions that are MATERIAL to the comparison.
 *
 * These are the facts that the runtime actually sends to the provider. A
 * change in any of them during a run means the run was not governed by a
 * single configuration, so the comparison cannot attribute the observed
 * behavior to the model alone.
 */
const EFFECTIVE_MATERIAL_DIMENSIONS = [
	"toolCount",
	"toolNames",
	"thinkingEnabled",
	"reasoningEffort",
	"maxOutputTokens",
] as const;

/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-COMPARATOR-CORRECTION01 (C2): collect the
 * material conflicts among the evaluated effective snapshots.
 *
 * Only KNOWN values participate: an unknown value on one snapshot and a
 * known value on another is not a conflict, it is an observation gap (and
 * the comparison of the two SIDES already handles unknown values as
 * unverified). Two snapshots that both leave a dimension unknown are
 * equally unknown — not evidence of a change.
 */
function collectEffectiveConflicts(
	snapshots: ReadonlyArray<{ values: Record<string, string> }>,
): ConfigSelection["effectiveConflicts"] {
	const conflicts: ConfigSelection["effectiveConflicts"] = [];
	for (const dimension of EFFECTIVE_MATERIAL_DIMENSIONS) {
		const observed = new Map<string, string>();
		for (const snapshot of snapshots) {
			const value = snapshot.values[dimension];
			if (!isKnownValue(value)) {
				continue;
			}
			observed.set(value as string, dimension);
		}
		if (observed.size > 1) {
			conflicts.push({
				dimension,
				values: [...observed.keys()].sort(),
			});
		}
	}
	return conflicts;
}

/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-COMPARATOR-CORRECTION01 (C2): the
 * configuration values used for the dimension comparison.
 *
 * When a run was explicitly selected, the snapshot belonging to THAT run is
 * used; otherwise the (single, non-ambiguous) snapshot is used.
 *
 * ACT-CLINEMM-MODEL-BEHAVIOR-COMPARABILITY-AUTHORITY-REPAIR01 (R3/R4):
 * the EFFECTIVE configuration is layered ON TOP of the build-time
 * configuration.
 *
 * The effective snapshot is preferred because it describes what the runtime
 * ACTUALLY sent. The build-time snapshot supplies the facts the runtime
 * cannot observe (build identity, catalog context window, the configured
 * ceiling mode).
 *
 * ACT-CLINEMM-MODEL-BEHAVIOR-COMPARATOR-CORRECTION01 (C2):
 *
 *   - EVERY effective snapshot that belongs to the selected run is
 *     EVALUATED, not just the first one. A mid-run material change is
 *     reported as a conflict instead of being silently ignored.
 *   - The build-time SESSION-LESS / SESSION-BOUND pair is handled as ONE
 *     configuration: the session-less snapshot is the same build-time
 *     configuration before the session id existed, and the session-bound
 *     one is the same configuration after it was bound. They are therefore
 *     cross-checked against each other and BOTH contribute their values,
 *     rather than the first one winning and the pair looking ambiguous.
 *   - True session/run isolation is preserved: an effective snapshot that
 *     belongs to a DIFFERENT run is never evaluated, and a build-time
 *     snapshot that belongs to a DIFFERENT session is never applied.
 */
function selectConfigValues(
	trace: ParsedTrace,
	selectedRunId?: string,
): ConfigSelection {
	const config = analyzeConfig(trace);
	if (config.snapshots.length === 0 && config.effectiveSnapshots.length === 0) {
		return {
			values: {},
			evaluatedEffectiveSnapshots: 0,
			effectiveConflicts: [],
			buildTimeUnbound: false,
		};
	}

	const scope = selectedRunId
		? resolveRunScope(trace.records, selectedRunId)
		: undefined;

	// --- The build-time (session-level) configuration -----------------------
	//
	// ACT-CLINEMM-MODEL-BEHAVIOR-COMPARATOR-CORRECTION01 (C2): the
	// SESSION-LESS / SESSION-BOUND pair is ONE configuration.
	//
	// The build-time configuration is constructed before the session id
	// exists, so it is first recorded session-LESS and then re-recorded
	// bound to the session by the authority that allocated the id. The two
	// records describe the SAME configuration; they are NOT two competing
	// configurations and must NOT be reported as an ambiguity.
	//
	// The binding rule is identity-verified:
	//   - a snapshot bound to the SELECTED RUN applies,
	//   - a snapshot bound to the session that OWNS the selected run
	//     applies (this is the session-bound half of the pair),
	//   - a SESSION-LESS snapshot applies only when it can be bound to the
	//     selected run's session — that is, when the trace has exactly ONE
	//     session. In a multi-session trace the session-less snapshot is
	//     left unbound rather than cross-bound to the wrong session.
	const buildTimeValues: Record<string, string> = {};
	let buildTimeUnbound = false;
	const applyBuildTimeSnapshot = (snapshot: {
		values: Record<string, string>;
	}): void => {
		for (const [key, value] of Object.entries(snapshot.values)) {
			// A KNOWN value from the first applicable snapshot wins; an
			// unknown one never overwrites a known one.
			if (isKnownValue(value) && !isKnownValue(buildTimeValues[key])) {
				buildTimeValues[key] = value;
			}
		}
	};
	if (selectedRunId) {
		// The selected run's OWN build-time snapshot.
		const runBound = config.snapshots.filter(
			(snapshot) => snapshot.runId === selectedRunId,
		);
		for (const snapshot of runBound) {
			applyBuildTimeSnapshot(snapshot);
		}
		// The session-bound half of the pair: the session that owns the
		// selected run.
		if (scope?.sessionId !== undefined) {
			const sessionBound = config.snapshots.filter(
				(snapshot) =>
					snapshot.runId === undefined &&
					snapshot.sessionId === scope.sessionId,
			);
			for (const snapshot of sessionBound) {
				applyBuildTimeSnapshot(snapshot);
			}
			// The SESSION-LESS half of the pair: it belongs to the same
			// configuration, but only when there is exactly ONE session in
			// the trace — otherwise it cannot be bound by identity.
			const sessionLess = config.snapshots.filter(
				(snapshot) =>
					snapshot.runId === undefined && snapshot.sessionId === undefined,
			);
			if (sessionLess.length > 0) {
				if (config.observedSessions.length === 1) {
					for (const snapshot of sessionLess) {
						applyBuildTimeSnapshot(snapshot);
					}
				} else {
					buildTimeUnbound = true;
				}
			}
		}
	} else {
		// No run was selected: the build-time configuration applies only
		// when every snapshot belongs to the SAME session (a single session
		// whose configuration was rebuilt, possibly through the session-less
		// / session-bound pair).
		const sessions = new Set(
			config.snapshots.map((snapshot) => snapshot.sessionId),
		);
		const onlySession = config.observedSessions.length === 1;
		if (sessions.size === 1 && onlySession) {
			for (const snapshot of config.snapshots) {
				applyBuildTimeSnapshot(snapshot);
			}
		} else {
			buildTimeUnbound = config.snapshots.length > 0;
		}
	}

	// --- The EFFECTIVE (run-level) configuration ---------------------------
	//
	// ACT-CLINEMM-MODEL-BEHAVIOR-COMPARATOR-CORRECTION01 (C2): EVERY
	// effective snapshot belonging to the selected run is EVALUATED.
	const evaluatedEffective: Array<{ values: Record<string, string> }> = [];
	if (selectedRunId) {
		for (const snapshot of config.effectiveSnapshots) {
			if (snapshot.runId === selectedRunId) {
				evaluatedEffective.push(snapshot);
			}
		}
	} else {
		// Without a selected run, the effective configuration applies only
		// when the trace has exactly ONE effective snapshot — otherwise the
		// trace spans several runs and is refused.
		if (config.effectiveSnapshots.length === 1) {
			evaluatedEffective.push(config.effectiveSnapshots[0]);
		}
	}
	const effectiveConflicts = collectEffectiveConflicts(evaluatedEffective);

	// The effective values WIN where both sides observed them; otherwise the
	// build-time value is retained. An UNKNOWN effective value never
	// overwrites a KNOWN build-time value.
	const merged: Record<string, string> = { ...buildTimeValues };
	for (const snapshot of evaluatedEffective) {
		for (const [key, value] of Object.entries(snapshot.values)) {
			if (isKnownValue(value)) {
				merged[key] = value;
			}
		}
	}
	return {
		values: merged,
		evaluatedEffectiveSnapshots: evaluatedEffective.length,
		effectiveConflicts,
		buildTimeUnbound,
	};
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

	// ACT-CLINEMM-MODEL-BEHAVIOR-EDIT-EFFICIENCY-TRACE01: the editing
	// efficiency section.
	lines.push("## Editing Efficiency");
	lines.push("");
	lines.push(
		"> Mutation counts come from the WRITE layer (`REAL_PRODUCTION_SEAM`): they count files that were actually mutated, not tool calls that reported success.",
	);
	lines.push(
		"> Churn and reversion are HEURISTICS (`INFERRED`): a repeated edit to the same file is not automatically waste, and a reversion is stronger evidence of churn but still does not prove a model mistake.",
	);
	lines.push(
		"> Shell activity is reported SEPARATELY: a successful `run_commands` does not establish which files changed, so it never contributes to the native-edit counters.",
	);
	lines.push("");
	lines.push(
		"> Edit operations and written files are counted SEPARATELY: one operation may write several files, and a patch that failed after its first write is a PARTIAL application, not a clean failure.",
	);
	lines.push(
		"> An application is joined to its request only by EXACT tool-call identity. An observation without that identity stays UNVERIFIED — it is never paired by timestamp or by position.",
	);
	lines.push("");
	lines.push("| Metric | M3 | M3.1 |");
	lines.push("| --- | --- | --- |");
	const editRows: Array<[string, keyof EditingEfficiencyStatistics]> = [
		["Native edit attempts", "nativeEditAttempts"],
		["Successful edit operations", "successfulEditOperations"],
		["Files written", "filesWritten"],
		["Files with verified content change", "filesWithVerifiedContentChange"],
		[
			"Files with unverified content change",
			"filesWithUnverifiedContentChange",
		],
		["No-op edit operations", "noOpEditOperations"],
		["Partial-mutation operations", "partialMutationOperations"],
		["Failed / rejected edits", "failedEdits"],
		["Distinct files modified", "distinctFilesModified"],
		["Edits per file", "editsPerFile"],
		["Reverted mutations (INFERRED)", "revertedMutations"],
		["Revision churn (INFERRED)", "revisionChurn"],
		["Correlated edit applications", "correlatedEditApplications"],
		["Uncorrelated edit applications", "uncorrelatedEditApplications"],
		["Unfulfilled edit attempts", "unfulfilledEditAttempts"],
		["Shell calls (separate activity)", "shellCallCount"],
		["Shell calls without error", "shellCallSuccessCount"],
		["Accepted executable gates", "acceptedExecutableGates"],
	];
	for (const [label, key] of editRows) {
		lines.push(
			`| ${label} | ${String(summary.editingEfficiency.m3[key])} | ${String(summary.editingEfficiency.m31[key])} |`,
		);
	}
	lines.push(
		`| Time to first APPLIED edit (ms) | ${String(summary.editingEfficiency.m3.timeToFirstAppliedEditMs ?? "n/a")} | ${String(summary.editingEfficiency.m31.timeToFirstAppliedEditMs ?? "n/a")} |`,
	);
	lines.push(
		`| Observed file-write duration (ms) | ${String(summary.editingEfficiency.m3.fileWriteDurationMs ?? "n/a")} | ${String(summary.editingEfficiency.m31.fileWriteDurationMs ?? "n/a")} |`,
	);
	lines.push(
		`| Edit origin | ${summary.editingEfficiency.m3.editOriginMarker} | ${summary.editingEfficiency.m31.editOriginMarker} |`,
	);
	lines.push("");
	if (
		summary.editingEfficiency.m3.editOriginUnobserved ||
		summary.editingEfficiency.m31.editOriginUnobserved
	) {
		lines.push(
			"> A run with shell activity but no native edit telemetry is reported as `EDIT_ORIGIN_UNOBSERVED`: the trace observes the WRITE LAYER, not the workspace, so it cannot establish that any file changed. The origin is UNOBSERVED — never reported as an observed file change.",
		);
		lines.push("");
	}
	lines.push(
		"> These numbers do NOT rank the models. Fewer edits is not, by itself, evidence of a better model — it can equally mean less work was done.",
	);
	lines.push("");

	// ------------------------------------------------------------------
	// ACT-CLINEMM-MODEL-BEHAVIOR-WORKSPACE-EFFECT-TRACE01 (R5): the
	// workspace-progress section.
	// ------------------------------------------------------------------
	lines.push("## Workspace Progress");
	lines.push("");
	if (
		!summary.workspaceProgress.m3.workspaceEvidenceAvailable &&
		!summary.workspaceProgress.m31.workspaceEvidenceAvailable
	) {
		lines.push(
			`Both traces predate the workspace-effect evidence: every figure below is ${UNAVAILABLE}. The trace can say THAT a write happened; it cannot say WHERE it landed or what is on disk afterwards.`,
		);
		lines.push("");
	} else {
		const progressRows: ReadonlyArray<
			readonly [string, keyof WorkspaceProgressStatistics]
		> = [
			["Targets resolved", "targetsResolved"],
			["Targets inside the active workspace", "targetsInsideActiveWorkspace"],
			["Targets OUTSIDE the active workspace", "targetsOutsideActiveWorkspace"],
			["Targets in another known workspace", "targetsInOtherWorkspace"],
			["Targets with an UNVERIFIED scope", "targetsScopeUnverified"],
			["Applied writes inside the workspace", "appliedWritesInsideWorkspace"],
			["Applied writes OUTSIDE the workspace", "appliedWritesOutsideWorkspace"],
			["Independently verified writes", "independentlyVerifiedWrites"],
			[
				"Verified writes matching the intended content",
				"verifiedWritesMatchingIntended",
			],
			[
				"Verified writes diverging from the intended content",
				"verifiedWritesDivergingFromIntended",
			],
			["Unverified writes (read-back unavailable)", "unverifiedWrites"],
			[
				"Writes whose destination was absent at read-back",
				"writesWithDestinationAbsent",
			],
			["Retained and changed", "retentionCounts"],
			["Reverted", "retentionCounts"],
			["Deleted", "retentionCounts"],
			["Unchanged", "retentionCounts"],
			["Outside the benchmark scope", "retentionCounts"],
			["Unverified retention", "retentionCounts"],
			["Targets inside the benchmark root (tracked)", "trackedTargetCount"],
			[
				"Targets outside the benchmark root (untracked)",
				"untrackedTargetCount",
			],
			[
				"Targets with unknown benchmark membership (ignored)",
				"ignoredTargetCount",
			],
			["Native edit failures", "nativeEditFailures"],
			["Unfulfilled edit attempts", "unfulfilledEditAttempts"],
			["Shell calls (separate activity)", "shellCallCount"],
			[
				"Shell activity without an observed mutation",
				"shellActivityWithoutObservedMutation",
			],
			[
				"Tool calls since the last retained change",
				"toolCallsSinceLastRetainedChange",
			],
			["Accepted executable gates", "acceptedExecutableGates"],
		];
		lines.push("| Metric | M3 | M3.1 |");
		lines.push("| --- | --- | --- |");
		for (const [label, key] of progressRows) {
			const render = (stats: WorkspaceProgressStatistics): string => {
				if (key === "retentionCounts") {
					const classification = label
						.split(" ")
						.map((word) => word.toUpperCase())
						.join("_") as EditRetentionClassification;
					return String(stats.retentionCounts[classification] ?? 0);
				}
				return String(stats[key]);
			};
			lines.push(
				`| ${label} | ${render(summary.workspaceProgress.m3)} | ${render(summary.workspaceProgress.m31)} |`,
			);
		}
		lines.push(
			`| Time to first write inside the workspace (ms) | ${String(summary.workspaceProgress.m3.timeToFirstWriteInsideWorkspaceMs ?? "n/a")} | ${String(summary.workspaceProgress.m31.timeToFirstWriteInsideWorkspaceMs ?? "n/a")} |`,
		);
		lines.push(
			`| Time since the last retained change (ms) | ${String(summary.workspaceProgress.m3.timeSinceLastRetainedChangeMs ?? "n/a")} | ${String(summary.workspaceProgress.m31.timeSinceLastRetainedChangeMs ?? "n/a")} |`,
		);
		lines.push(
			`| Workspace evidence | ${summary.workspaceProgress.m3.workspaceEvidenceMarker} | ${summary.workspaceProgress.m31.workspaceEvidenceMarker} |`,
		);
		lines.push("");
		lines.push(
			'> The destination scope is established CANONICALLY (symlinks followed). A destination whose canonicalization failed is reported as `PATH_SCOPE_UNVERIFIED` — never optimistically as "inside the workspace". A write whose read-back could not be performed is UNVERIFIED — never "succeeded". Neither figure asserts DURABILITY: a successful write is not an fsync.',
		);
		lines.push("");
		lines.push(
			"> Shell activity is reported as ACTIVITY, never as an observed mutation: the trace observes the write layer, so it cannot attribute a filesystem change to a shell command.",
		);
		lines.push("");
	}

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
	/**
	 * ACT-CLINEMM-MODEL-BEHAVIOR-EDIT-EFFICIENCY-TRACE01.
	 */
	editingEfficiency: {
		m3: EditingEfficiencyStatistics;
		m31: EditingEfficiencyStatistics;
	};
	/**
	 * ACT-CLINEMM-MODEL-BEHAVIOR-WORKSPACE-EFFECT-TRACE01 (R5).
	 */
	workspaceProgress: {
		m3: WorkspaceProgressStatistics;
		m31: WorkspaceProgressStatistics;
	};
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
		editingEfficiency: input.editingEfficiency,
		workspaceProgress: input.workspaceProgress,
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

	// ACT-CLINEMM-MODEL-BEHAVIOR-COMPARATOR-CORRECTION01 (C2): the selection
	// evaluates EVERY effective snapshot belonging to the selected run and
	// reports any mid-run material change.
	const m3Selection = selectConfigValues(m3, options.m3RunId);
	const m31Selection = selectConfigValues(m31, options.m31RunId);

	const configuration = compareConfiguration(
		m3Selection.values,
		m31Selection.values,
	);
	const statistics = {
		m3: computeStatistics(m3, m3Records),
		m31: computeStatistics(m31, m31Records),
	};
	// ACT-CLINEMM-MODEL-BEHAVIOR-EDIT-EFFICIENCY-TRACE01: the editing
	// efficiency section is computed from the OBSERVED edit events, so a
	// run with no native edit observations reports zero edits AND says
	// that the edit origin is unavailable.
	const editingEfficiency = {
		m3: computeEditingEfficiency(m3, m3Records),
		m31: computeEditingEfficiency(m31, m31Records),
	};
	// ACT-CLINEMM-MODEL-BEHAVIOR-WORKSPACE-EFFECT-TRACE01 (R5): the
	// workspace-progress section. It reads the NEW target-resolution and
	// write-verification evidence; a trace that predates the feature
	// reports every workspace figure as UNAVAILABLE rather than zero.
	const workspaceProgress = {
		m3: computeWorkspaceProgress(m3Records),
		m31: computeWorkspaceProgress(m31Records),
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
		editingEfficiency,
		workspaceProgress,
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
