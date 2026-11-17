/**
 * ACT-CLINEMM-TOOL-NORMALIZATION-LIVE-QUALIFICATION-01 — CORRECTION01
 * adversarial witness.
 *
 * Drives `qualify.ts` as a SUBPROCESS against the adversarial fixtures and the
 * preserved REAL artifacts, and asserts the properties the prior analyzer
 * failed to hold.
 *
 *   bun tool/witness.ts
 *
 * Exit code 0 = every check passed; 1 = at least one check failed.
 *
 * The three P0 defects this witness pins:
 *
 *   A. A MISSING `tool_execution` / `tool_result_delivered` END event must
 *      FAIL the corresponding identity/count check. The prior analyzer built
 *      the "end" maps from the "start" events, so the check was tautological.
 *
 *   B. A second provider capture in ONE session carrying a DIFFERENT
 *      `run_commands` schema hash must INVALIDATE the all-captures-consistent
 *      claim. The prior analyzer stopped at the first capture per session.
 *
 *   C. A MISSING `strictJsonSchema` value must read `UNKNOWN`, never `false`.
 *      The prior analyzer collapsed it to `null`.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const TOOL_DIR = import.meta.dir;
const FIXTURES = join(TOOL_DIR, "fixtures");
const ANALYZER = join(TOOL_DIR, "qualify.ts");

interface Analysis {
	trace: Record<string, unknown>;
	providerRequests: Record<string, unknown>;
}

interface Check {
	id: string;
	requirement: string;
	passed: boolean;
	observed: unknown;
	expected: string;
}

const checks: Check[] = [];

function record(
	id: string,
	requirement: string,
	passed: boolean,
	observed: unknown,
	expected: string,
): void {
	checks.push({ id, requirement, passed, observed, expected });
}

/** Run the analyzer against an optional trace + captures override. */
function runAnalyzer(options: {
	trace?: string;
	captures?: string;
}): Analysis {
	const env = { ...process.env };
	if (options.trace) {
		env.CLINE_QUALIFY_TRACE = options.trace;
	}
	if (options.captures) {
		env.CLINE_QUALIFY_CAPTURES = options.captures;
	}
	const proc = spawnSync("bun", [ANALYZER], {
		env,
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
	});
	if (proc.status !== 0) {
		throw new Error(
			`analyzer exited ${proc.status}: ${(proc.stderr ?? "").slice(0, 400)}`,
		);
	}
	return JSON.parse(proc.stdout) as Analysis;
}

function fixtureTrace(name: string): string {
	const path = join(FIXTURES, name, "roundc-latency-trace(8).json");
	if (!existsSync(path)) {
		throw new Error(`fixture missing: ${path} (run tool/make-fixtures.ts)`);
	}
	return path;
}

function fixtureCaptures(name: string): string {
	const path = join(FIXTURES, name);
	if (!existsSync(path)) {
		throw new Error(`fixture missing: ${path} (run tool/make-fixtures.ts)`);
	}
	return path;
}

function sessionOf(
	analysis: Analysis,
	sessionId: string,
): Record<string, unknown> | undefined {
	const perSession = analysis.providerRequests.perSession as
		| Record<string, Record<string, unknown>>
		| undefined;
	return perSession?.[sessionId];
}

/**
 * A field the analyzer does not emit at all is an explicit FAIL, never a
 * crash: the absence of the field IS the defect.
 */
function field(
	source: Record<string, unknown> | undefined,
	name: string,
): unknown {
	return source?.[name];
}

/** The list-valued field, or an empty list when the field is absent. */
function listField(
	source: Record<string, unknown> | undefined,
	name: string,
): unknown[] {
	const value = field(source, name);
	return Array.isArray(value) ? value : [];
}

/* ------------------------------------------------------------------ */
/* A. Missing END events must fail the identity/count checks           */
/* ------------------------------------------------------------------ */

const real = runAnalyzer({});

record(
	"A0",
	"the REAL trace passes the start/end identity checks (the control)",
	real.trace.executionStartEndIdsMatch === true &&
		real.trace.deliveryStartEndIdsMatch === true &&
		real.trace.executionPairsWellFormed === true &&
		real.trace.deliveryPairsWellFormed === true &&
		real.trace.toolExecutionStarts === real.trace.toolExecutionEnds &&
		real.trace.toolResultDeliveredStarts === real.trace.toolResultDeliveredEnds,
	{
		executionStartEndIdsMatch: real.trace.executionStartEndIdsMatch,
		deliveryStartEndIdsMatch: real.trace.deliveryStartEndIdsMatch,
		executionPairsWellFormed: real.trace.executionPairsWellFormed,
		deliveryPairsWellFormed: real.trace.deliveryPairsWellFormed,
		toolExecutionStarts: real.trace.toolExecutionStarts,
		toolExecutionEnds: real.trace.toolExecutionEnds,
		toolResultDeliveredStarts: real.trace.toolResultDeliveredStarts,
		toolResultDeliveredEnds: real.trace.toolResultDeliveredEnds,
	},
	"all true; starts == ends",
);

const missingExecEnd = runAnalyzer({
	trace: fixtureTrace("trace-missing-exec-end"),
});
record(
	"A1",
	"a MISSING tool_execution END event fails the execution identity check",
	missingExecEnd.trace.executionStartEndIdsMatch === false,
	{
		executionStartEndIdsMatch: missingExecEnd.trace.executionStartEndIdsMatch,
		toolExecutionStarts: missingExecEnd.trace.toolExecutionStarts,
		toolExecutionEnds: missingExecEnd.trace.toolExecutionEnds,
		executionUnmatchedStartIds:
			missingExecEnd.trace.executionUnmatchedStartIds,
	},
	"executionStartEndIdsMatch === false",
);
record(
	"A2",
	"a MISSING tool_execution END event makes the execution pairs NOT well formed",
	missingExecEnd.trace.executionPairsWellFormed === false,
	missingExecEnd.trace.executionPairsWellFormed,
	"false",
);
record(
	"A3",
	"a MISSING tool_execution END event is reported as a cardinality difference",
	missingExecEnd.trace.toolExecutionStarts !==
		missingExecEnd.trace.toolExecutionEnds,
	{
		starts: missingExecEnd.trace.toolExecutionStarts,
		ends: missingExecEnd.trace.toolExecutionEnds,
	},
	"starts !== ends",
);

const missingDeliveryEnd = runAnalyzer({
	trace: fixtureTrace("trace-missing-delivery-end"),
});
record(
	"A4",
	"a MISSING tool_result_delivered END event fails the delivery identity check",
	missingDeliveryEnd.trace.deliveryStartEndIdsMatch === false,
	{
		deliveryStartEndIdsMatch: missingDeliveryEnd.trace.deliveryStartEndIdsMatch,
		toolResultDeliveredStarts:
			missingDeliveryEnd.trace.toolResultDeliveredStarts,
		toolResultDeliveredEnds:
			missingDeliveryEnd.trace.toolResultDeliveredEnds,
	},
	"deliveryStartEndIdsMatch === false",
);
record(
	"A5",
	"a MISSING tool_result_delivered END event makes the delivery pairs NOT well formed",
	missingDeliveryEnd.trace.deliveryPairsWellFormed === false,
	missingDeliveryEnd.trace.deliveryPairsWellFormed,
	"false",
);

const mismatchedNames = runAnalyzer({
	trace: fixtureTrace("trace-mismatched-names"),
});
record(
	"A6",
	"a tool-name mismatch between execution and delivery is DETECTED",
	listField(
		mismatchedNames.trace,
		"toolNameMismatchesBetweenExecutionAndDelivery",
	).length > 0,
	mismatchedNames.trace.toolNameMismatchesBetweenExecutionAndDelivery,
	"a non-empty mismatch list",
);

const reordered = runAnalyzer({ trace: fixtureTrace("trace-reordered") });
record(
	"A7",
	"reordering the event list does not change the boundary counts",
	reordered.trace.toolExecutionStarts === real.trace.toolExecutionStarts &&
		reordered.trace.toolExecutionEnds === real.trace.toolExecutionEnds &&
		reordered.trace.toolResultDeliveredStarts ===
			real.trace.toolResultDeliveredStarts &&
		reordered.trace.toolResultDeliveredEnds ===
			real.trace.toolResultDeliveredEnds,
	{
		execStarts: reordered.trace.toolExecutionStarts,
		execEnds: reordered.trace.toolExecutionEnds,
		deliveredStarts: reordered.trace.toolResultDeliveredStarts,
		deliveredEnds: reordered.trace.toolResultDeliveredEnds,
	},
	"counts identical to the real trace",
);

/* ------------------------------------------------------------------ */
/* B. A schema-hash drift inside ONE session invalidates consistency   */
/* ------------------------------------------------------------------ */

const drift = runAnalyzer({
	captures: fixtureCaptures("captures-schema-drift"),
});
record(
	"B1",
	"two captures in ONE session with DIFFERENT schema hashes are detected",
	drift.providerRequests.allCapturesShareOneRunCommandsSchema === false,
	drift.providerRequests.allCapturesShareOneRunCommandsSchema,
	"false",
);
record(
	"B2",
	"the session with the drifting schema is NAMED",
	listField(
		drift.providerRequests,
		"sessionsWithInconsistentRunCommandsSchema",
	).includes("1794593797996_r48lj"),
	field(drift.providerRequests, "sessionsWithInconsistentRunCommandsSchema"),
	"contains 1794593797996_r48lj",
);
record(
	"B3",
	"the per-session consistency flag is false for the drifting session",
	sessionOf(drift, "1794593797996_r48lj")?.runCommandsSchemaConsistent ===
		false,
	sessionOf(drift, "1794593797996_r48lj"),
	"runCommandsSchemaConsistent === false",
);
record(
	"B4",
	"BOTH captures of the drifting session were inspected",
	sessionOf(drift, "1794593797996_r48lj")?.captures === 2,
	sessionOf(drift, "1794593797996_r48lj"),
	"captures === 2",
);
record(
	"B5",
	"the parsed/invalid/missing-field counts are reported explicitly",
	typeof drift.providerRequests.parsedCaptures === "number" &&
		typeof drift.providerRequests.invalidCaptures === "number" &&
		typeof drift.providerRequests.capturesMissingStrictJsonSchemaField ===
			"number",
	{
		parsedCaptures: drift.providerRequests.parsedCaptures,
		invalidCaptures: drift.providerRequests.invalidCaptures,
		capturesMissingStrictJsonSchemaField:
			drift.providerRequests.capturesMissingStrictJsonSchemaField,
	},
	"all three counts present as numbers",
);

/* ------------------------------------------------------------------ */
/* C. A missing strictJsonSchema value must be UNKNOWN, never false    */
/* ------------------------------------------------------------------ */

const missingStrict = runAnalyzer({
	captures: fixtureCaptures("captures-missing-strict"),
});
record(
	"C1",
	"a capture with NO strictJsonSchema field yields the finding UNKNOWN",
	missingStrict.providerRequests.strictJsonSchemaFinding === "UNKNOWN",
	missingStrict.providerRequests.strictJsonSchemaFinding,
	"UNKNOWN",
);
record(
	"C2",
	"the missing field is COUNTED, not silently defaulted",
	missingStrict.providerRequests.capturesMissingStrictJsonSchemaField === 1,
	missingStrict.providerRequests.capturesMissingStrictJsonSchemaField,
	"1",
);
record(
	"C3",
	"the per-session finding is UNKNOWN (never false) when the field is absent",
	sessionOf(missingStrict, "1794593797996_r48lj")
		?.strictJsonSchemaFinding === "UNKNOWN",
	sessionOf(missingStrict, "1794593797996_r48lj"),
	"UNKNOWN",
);
record(
	"C4",
	"the REAL capture set's strictness is MIXED (FALSE + UNKNOWN) — the field is ABSENT in 496 of 622 captures",
	real.providerRequests.strictJsonSchemaFinding === "MIXED" &&
		real.providerRequests.capturesMissingStrictJsonSchemaField === 496 &&
		(
			real.providerRequests.strictJsonSchemaFindingsAcrossSessions as string[]
		).includes("FALSE") &&
		(
			real.providerRequests.strictJsonSchemaFindingsAcrossSessions as string[]
		).includes("UNKNOWN"),
	{
		finding: real.providerRequests.strictJsonSchemaFinding,
		findingsAcrossSessions:
			real.providerRequests.strictJsonSchemaFindingsAcrossSessions,
		capturesMissingStrictJsonSchemaField:
			real.providerRequests.capturesMissingStrictJsonSchemaField,
	},
	"MIXED, with FALSE and UNKNOWN both present and 496 missing fields",
);
record(
	"C4b",
	"the sessions this ACT RELIES ON (both Flint sessions) record strictJsonSchema=false in EVERY capture",
	(() => {
		for (const sid of ["1794587196390_xn030", "1794593797996_r48lj"]) {
			const s = sessionOf(real, sid);
			if (!s) {
				return false;
			}
			const values = listField(s, "strictJsonSchemaValues");
			if (values.length !== s.captures) {
				return false;
			}
			if (!values.every((v) => v === false)) {
				return false;
			}
			if (s.strictJsonSchemaMissingInSomeCapture === true) {
				return false;
			}
		}
		return true;
	})(),
	{
		preFix: sessionOf(real, "1794587196390_xn030"),
		postFix: sessionOf(real, "1794593797996_r48lj"),
	},
	"every capture of BOTH Flint sessions records false, with none missing",
);
record(
	"C5",
	"the REAL capture set's all-captures-consistent claim is DERIVED, not assumed",
	real.providerRequests.allCapturesShareOneRunCommandsSchema === true &&
		listField(
			real.providerRequests,
			"distinctRunCommandsSchemaHashesAcrossAllCaptures",
		).length === 1,
	{
		allCapturesShareOneRunCommandsSchema:
			real.providerRequests.allCapturesShareOneRunCommandsSchema,
		distinctHashes: field(
			real.providerRequests,
			"distinctRunCommandsSchemaHashesAcrossAllCaptures",
		),
		sessionsWithInconsistent: field(
			real.providerRequests,
			"sessionsWithInconsistentRunCommandsSchema",
		),
	},
	"true with exactly one distinct hash",
);
record(
	"C6",
	"the REAL capture set's every capture was inspected (parsed == total)",
	real.providerRequests.parsedCaptures === real.providerRequests.captureFiles,
	{
		parsedCaptures: real.providerRequests.parsedCaptures,
		captureFiles: real.providerRequests.captureFiles,
		invalidCaptures: real.providerRequests.invalidCaptures,
	},
	"parsedCaptures === captureFiles",
);

/* ------------------------------------------------------------------ */
/* E. The transcript<->trace correlation must be LIKE-FOR-LIKE          */
/* ------------------------------------------------------------------ */

const realRun = runAnalyzer({});
const correlation = (
	realRun as unknown as {
		traceTranscriptCorrelation?: Record<string, unknown>;
	}
).traceTranscriptCorrelation ?? {};

record(
	"E1",
	"the transcript's ALL tool-call ids correlate 1:1 with the trace's ALL tool_execution ids",
	correlation.transcriptToolCallIds === correlation.traceToolCallIds &&
		correlation.sharedToolCallIds === correlation.transcriptToolCallIds &&
		listField(correlation, "transcriptOnly").length === 0 &&
		listField(correlation, "traceOnly").length === 0,
	{
		transcriptToolCallIds: correlation.transcriptToolCallIds,
		traceToolCallIds: correlation.traceToolCallIds,
		sharedToolCallIds: correlation.sharedToolCallIds,
		transcriptOnly: correlation.transcriptOnly,
		traceOnly: correlation.traceOnly,
	},
	"equal counts, all shared, nothing on either side",
);
record(
	"E2",
	"the tool names agree on every shared id",
	listField(correlation, "toolNameMismatchesOnSharedIds").length === 0,
	correlation.toolNameMismatchesOnSharedIds,
	"an empty mismatch list",
);
record(
	"E3",
	"the comparison is explicitly LIKE-FOR-LIKE over ALL tool calls",
	correlation.comparison === "LIKE_FOR_LIKE_ALL_TOOL_CALLS",
	correlation.comparison,
	"LIKE_FOR_LIKE_ALL_TOOL_CALLS",
);

/* ------------------------------------------------------------------ */
/* Report                                                              */
/* ------------------------------------------------------------------ */

const failed = checks.filter((c) => !c.passed);
for (const c of checks) {
	process.stdout.write(
		`${c.passed ? "PASS" : "FAIL"}  ${c.id}  ${c.requirement}\n`,
	);
	if (!c.passed) {
		process.stdout.write(
			`      expected: ${c.expected}\n      observed: ${JSON.stringify(c.observed)}\n`,
		);
	}
}
process.stdout.write(
	`\n${checks.length - failed.length}/${checks.length} checks passed\n`,
);

if (failed.length > 0) {
	process.exitCode = 1;
}
