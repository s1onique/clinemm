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
import { decideVerdict } from "./verdict";
import {
	ACT,
	applyCandidate,
	classifyObservableEpoch,
	classifyVerdict,
	compareCandidates,
	deduplicateHoldoutExports,
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

	// CORRECTION01 (P0-2): de-duplicate the holdout exports BY SESSION
	// IDENTITY before any dataset is constructed. A byte-identical
	// re-export is idempotent; exports of one session that DISAGREE are a
	// conflict and the whole session is rejected. Neither may inflate the
	// holdout dataset.
	const holdoutCandidates = discovered.filter((d) => d.sessionId !== TRAINING_SESSION_ID);
	const dedup = deduplicateHoldoutExports(holdoutCandidates);
	const holdoutDescriptors = dedup.accepted;

	const datasets: {
		descriptor: SourceTraceDescriptor;
		qualified: ReturnType<typeof qualifyDataset>;
	}[] = [];
	for (const descriptor of holdoutDescriptors) {
		datasets.push({ descriptor, qualified: qualifyDataset(loadTrace(descriptor.path)) });
	}

	const allRows = datasets.flatMap((d) => d.qualified.rows);
	const comparisons = compareCandidates(allRows);
	// CORRECTION01 (P1): an independent trace that yields zero eligible
	// attempts is CAPTURE_INSUFFICIENT, not AWAITING_INDEPENDENT_DOGFOOD_SESSION.
	const verdict = decideVerdict({
		independentSessionIds: independence.holdoutSessionIds,
		eligibleAttempts: allRows.length,
		comparisons,
		rows: allRows,
	});
	const suitability = productionSuitability(comparisons);


	const written = writeEvidenceArtifacts({
		sourceHead: SOURCE_HEAD,
		toolSha256: TOOL_SHA,
		discovered,
		loadErrors,
		independence,
		dedup,
		datasets,
		allRows,
		comparisons,
		verdict,
		suitability,
	});

	// CORRECTION01 (P0-3): this invocation executed NO test suite — it
	// evaluated traces. The receipt therefore records an EMPTY `commands`
	// list; the previously executed test evidence is preserved separately
	// under `historicalTestEvidence` and is explicitly labelled as such.
	const receipt = writeTestReceipt(SOURCE_HEAD, TOOL_SHA, [], {
		evaluation: {
			kind: "FRESH_EVALUATION",
			tracesDiscovered: discovered.length,
			tracesAcceptedAsHoldout: holdoutDescriptors.length,
			eligibleAttempts: allRows.length,
			verdict: verdict.verdict,
			testsExecutedByThisRun: 0,
		},
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
