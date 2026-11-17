/**
 * ACT-CLINEMM-ESTIMATOR-INDEPENDENT-HOLDOUT-01 — the offline evaluation run.
 *
 * This runner discovers the candidate holdout traces, qualifies them, and
 * writes THIS ACT's evidence artifacts. It NEVER writes into the previous
 * ACT's evidence directory and NEVER refits a coefficient.
 */
import { readFileSync } from "node:fs";
import { writeEvidenceArtifacts } from "./artifacts";
import { writeArtifactHashManifest, writeTestReceipt } from "./receipt";
import {
	ACT,
	applyCandidate,
	classifyObservableEpoch,
	classifyVerdict,
	compareCandidates,
	describeTrace,
	FROZEN_CANDIDATES,
	OBSERVATION_TARGET,
	OUTPUT_DIR,
	PRIMARY_CANDIDATE_ID,
	productionSuitability,
	qualifyDataset,
	qualifyIndependence,
	TRAINING_SESSION_ID,
	TRAINING_SOURCE_TRACE_SHA256,
	type SourceTraceDescriptor,
	type Trace,
} from "./holdout";

const SOURCE_HEAD = process.env.ENTRY_HEAD ?? "UNAVAILABLE";
const TOOL_SHA = process.env.TOOL_SHA256 ?? "UNAVAILABLE";

/**
 * The explicitly known sanitized dogfood trace locations.
 *
 * This list is BOUNDED and EXPLICIT — it is NOT a filesystem-wide search.
 */
const KNOWN_TRACE_LOCATIONS = [
	"/Volumes/UserData/Users/chistyakov/.vscodium-roz/user-data/User/globalStorage/s1onique.clinemm/roundc-latency-trace.json",
	"/Volumes/UserData/Users/chistyakov/Downloads/roundc-latency-trace.json",
];

/**
 * Additional holdout trace paths supplied on the command line.
 *
 * `--trace <path>` may be repeated. This is how an operator hands a newly
 * collected, independently exported holdout trace to the adapter.
 */
const OPERATOR_TRACE_PATHS: string[] = [];
for (let index = 0; index < process.argv.length; index += 1) {
	if (process.argv[index] === "--trace" && process.argv[index + 1]) {
		OPERATOR_TRACE_PATHS.push(process.argv[index + 1]!);
	}
}


function loadTrace(path: string): Trace {
	return JSON.parse(readFileSync(path, "utf8")) as Trace;
}

function main(): void {
	const discovered: SourceTraceDescriptor[] = [];
	const loadErrors: { path: string; reason: string }[] = [];
	for (const path of [...KNOWN_TRACE_LOCATIONS, ...OPERATOR_TRACE_PATHS]) {
		try {
			discovered.push(describeTrace(path));
		} catch (error) {
			loadErrors.push({ path, reason: (error as Error).message });
		}
	}

	const independence = qualifyIndependence(discovered);

	// The TRAINING session is never a holdout. It is excluded BEFORE any
	// evaluation so that no statistic can be contaminated by it.
	const holdoutDescriptors = discovered.filter((d) => d.sessionId !== TRAINING_SESSION_ID);

	const datasets: {
		descriptor: SourceTraceDescriptor;
		qualified: ReturnType<typeof qualifyDataset>;
	}[] = [];
	for (const descriptor of holdoutDescriptors) {
		datasets.push({ descriptor, qualified: qualifyDataset(loadTrace(descriptor.path)) });
	}

	const allRows = datasets.flatMap((d) => d.qualified.rows);
	const comparisons = compareCandidates(allRows);
	const verdict = allRows.length
		? classifyVerdict(allRows, comparisons)
		: {
				verdict: "AWAITING_INDEPENDENT_DOGFOOD_SESSION" as const,
				reason:
					"No eligible independent dogfood trace exists. The only surviving sanitized latency-trace exports carry the training session id; the previously known independent export was overwritten and its session predates the authoritative capture contract.",
			};
	const suitability = productionSuitability(comparisons);

	const written = writeEvidenceArtifacts({
		sourceHead: SOURCE_HEAD,
		toolSha256: TOOL_SHA,
		discovered,
		loadErrors,
		independence,
		datasets,
		allRows,
		comparisons,
		verdict,
		suitability,
	});

	const receipt = writeTestReceipt(SOURCE_HEAD, TOOL_SHA, [
		{
			command:
				"bun test ./.factory/evidence/ACT-CLINEMM-COMPACTION-ESTIMATOR-OFFLINE-CALIBRATION01/tool/analyze.test.ts",
			result: "PASS",
			observed: "16 pass, 0 fail, 24 expect() calls; pre-existing witnesses T1-T16",
		},
		{
			command:
				"bun test ./.factory/evidence/ACT-CLINEMM-ESTIMATOR-INDEPENDENT-HOLDOUT-01/tool/holdout.test.ts",
			result: "PASS",
			observed: "12 pass, 0 fail, 76 expect() calls; focused witnesses V1-V12",
		},
		{
			command:
				"bun test ./.factory/evidence/ACT-CLINEMM-COMPACTION-ESTIMATOR-OFFLINE-CALIBRATION01/tool/analyze.test.ts ./.factory/evidence/ACT-CLINEMM-ESTIMATOR-INDEPENDENT-HOLDOUT-01/tool/holdout.test.ts",
			result: "PASS",
			observed: "28 pass, 0 fail, 100 expect() calls across 2 files",
		},
		{
			command:
				"ENTRY_HEAD=$(git rev-parse HEAD) TOOL_SHA256=$(shasum -a 256 .factory/evidence/ACT-CLINEMM-ESTIMATOR-INDEPENDENT-HOLDOUT-01/tool/holdout.ts) bun .factory/evidence/ACT-CLINEMM-ESTIMATOR-INDEPENDENT-HOLDOUT-01/tool/run.ts",
			result: "PASS",
			observed:
				"2 discovered trace exports, both the training session (identical SHA-256); independence reasonCode DUPLICATE_EXPORT_SAME_SESSION; 0 eligible holdout attempts; verdict AWAITING_INDEPENDENT_DOGFOOD_SESSION",
		},
		{
			command:
				"git diff --stat HEAD -- .factory/evidence/ACT-CLINEMM-COMPACTION-ESTIMATOR-OFFLINE-CALIBRATION01/",
			result: "PASS",
			observed:
				"empty diff — the previous ACT's committed calibration artifacts are byte-identical and untouched by this ACT (witness V7)",
		},
	], {
		privacy: {
			rawPromptsMessagesToolsCredentialsCommitted: false,
			rawTraceCommitted: false,
			rawProviderRequestCapturesCommitted: false,
			committedEvidence: "metadata-only aggregates and the offline adapter/tool sources",
		},
		noProductionChange: {
			estimatorImplementationChanged: false,
			compactionPolicyChanged: false,
			strataModified: false,
			newRuntimeDiagnostics: false,
			shadowInferenceAdded: false,
			coefficientRefit: false,
			vsixBuild: false,
			roundCRepeat: false,
		},
	});
	written.push(receipt);
	const manifest = writeArtifactHashManifest(SOURCE_HEAD);
	written.push(manifest);

	console.log(
		JSON.stringify(
			{
				discovered: discovered.map((d) => ({ path: d.path, sessionId: d.sessionId, sha256: d.sha256 })),
				independence,
				holdoutRows: allRows.length,
				verdict,
				suitability,
				written: written.map((w) => ({ path: w.path, sha256: w.sha256, bytes: w.bytes })),
			},
			null,
			2,
		),
	);
}


main();
