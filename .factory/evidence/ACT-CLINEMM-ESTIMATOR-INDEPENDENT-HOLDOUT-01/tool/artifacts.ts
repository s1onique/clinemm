/**
 * ACT-CLINEMM-ESTIMATOR-INDEPENDENT-HOLDOUT-01 — evidence artifact writers.
 *
 * Every artifact is written under THIS ACT's own output directory. The
 * previous ACT's evidence directory is never a write target (witness V7).
 */
import {
	ACT,
	classifyObservableEpoch,
	FROZEN_CANDIDATES,
	OBSERVATION_TARGET,
	PRIMARY_CANDIDATE_ID,
	stats,
	TRAINING_SESSION_ID,
	TRAINING_SOURCE_TRACE_SHA256,
	writeArtifact,
	type CandidateComparison,
	type EligibleRow,
	type IndependenceVerdict,
	type ProductionSuitability,
	type QualificationResult,
	type SourceTraceDescriptor,
} from "./holdout";

export interface EvidenceInput {
	readonly sourceHead: string;
	readonly toolSha256: string;
	readonly discovered: readonly SourceTraceDescriptor[];
	readonly loadErrors: readonly { path: string; reason: string }[];
	readonly independence: IndependenceVerdict;
	readonly datasets: readonly {
		descriptor: SourceTraceDescriptor;
		qualified: {
			rows: readonly EligibleRow[];
			exclusions: readonly { reason: string; count: number; authority: string }[];
			observed: Record<string, number>;
		};
	}[];
	readonly allRows: readonly EligibleRow[];
	readonly comparisons: readonly CandidateComparison[];
	readonly verdict: QualificationResult;
	readonly suitability: ProductionSuitability;
}

export function writeEvidenceArtifacts(input: EvidenceInput): {
	path: string;
	sha256: string;
	bytes: number;
}[] {
	const { sourceHead, toolSha256, discovered, loadErrors, independence, datasets, allRows, comparisons } = input;

	const identity = {
		schema: `cline.${ACT}.identity.v1`,
		act: ACT,
		toolVersion: "offline-independent-holdout.v1",
		sourceHead,
		repository: {
			path: "/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm",
			remote: "git@github.com:s1onique/clinemm.git",
			branch: "main",
			entryHead: sourceHead,
		},
		tool: {
			path: `.factory/evidence/${ACT}/tool/holdout.ts`,
			version: "offline-independent-holdout.v1",
			sha256: toolSha256,
			testPath: `.factory/evidence/${ACT}/tool/holdout.test.ts`,
			importer: {
				path:
					".factory/evidence/ACT-CLINEMM-COMPACTION-ESTIMATOR-OFFLINE-CALIBRATION01/tool/analyze.ts",
				version: "offline-estimator-calibration.v1",
				sha256: "ddbb74e93286c59451edc83a154d781d8a5044780a25d8a1a6072fc8329eb471",
				modifiedByThisAct: false,
			},
		},
		verdict: input.verdict.verdict,
		productionDeploymentAuthorized: false,
		estimatorImplementationChanged: false,
		compactionPolicyChanged: false,
		coefficientsRefitOnHoldout: false,
	};

	const holdoutManifest = {
		schema: `cline.${ACT}.holdout-manifest.v1`,
		act: ACT,
		toolVersion: "offline-independent-holdout.v1",
		sourceHead,
		independence: {
			independent: independence.independent,
			reasonCode: independence.reasonCode,
			holdoutSessionIds: independence.holdoutSessionIds,
			trainingSessionIds: independence.trainingSessionIds,
		},
		discoveredTraces: discovered.map((d) => ({
			path: d.path,
			sha256: d.sha256,
			bytes: d.bytes,
			sessionId: d.sessionId,
			schema: d.schema,
			eventCount: d.eventCount,
			truncated: d.truncated,
			droppedEventCount: d.droppedEventCount,
			integrityFailureCount: d.integrityFailureCount,
			role: d.sessionId === TRAINING_SESSION_ID ? "TRAINING_SOURCE" : "HOLDOUT_CANDIDATE",
			decision: d.sessionId === TRAINING_SESSION_ID ? "EXCLUDE_FROM_HOLDOUT" : "INCLUDE",
		})),
		distinctSessionIds: [...new Set(discovered.map((d) => d.sessionId))],
		duplicateExportsOfSameSession: discovered.length - new Set(discovered.map((d) => d.sessionId)).size,
		loadErrors,
		trainingSource: {
			sessionId: TRAINING_SESSION_ID,
			traceSha256: TRAINING_SOURCE_TRACE_SHA256,
		},
		installedBuildIdentity: {
			extensionVersion: "4.1.16-5a1c485cb",
			extensionBundleSha256: "bfda14727f7a2e91fffb47d74884a58dc11c29f7cbce8612e660a4e473a80fb5",
			sourceHead: "UNAVAILABLE_FROM_TRACE",
			observedFrom: "training-session trace identity block",
		},
		modelProviderIdentity: {
			providerId: "openai-compatible",
			modelId: "qwen3.8-flash-next-iq3_s",
			effectiveContextBudgetTokens: 115200,
			reasoningEffort: "medium",
			thinkingEnabled: true,
			maxOutputTokens: 16384,
		},
		strataIdentity: {
			version: "UNAVAILABLE_FROM_TRACE",
			configuration: "UNAVAILABLE_FROM_TRACE",
			note: "The sanitized latency trace carries no Strata version/configuration identity field.",
		},
		rawTraceCommitted: false,
	};

	const joinAudit = {
		schema: `cline.${ACT}.join-audit.v1`,
		act: ACT,
		toolVersion: "offline-independent-holdout.v1",
		sourceHead,
		authority: "AUTHORITATIVE_EXACT_IDENTITY",
		joinKeys: ["sessionId", "preparationRequestId", "modelRequestId"],
		eligibleAttempts: allRows.length,
		excludedAttempts: datasets.flatMap((d) =>
			d.qualified.exclusions.map((e) => ({ ...e, sourcePath: d.descriptor.path })),
		),
		perSource: datasets.map((d) => ({
			sourcePath: d.descriptor.path,
			sessionId: d.descriptor.sessionId,
			observed: d.qualified.observed,
			eligibleAttempts: d.qualified.rows.length,
		})),
		notes:
			"The prior analyzer retains the FIRST provider attempt when a preparation has more than one attempt. This ACT's strict qualification pass removes such ambiguous preparations entirely (AMBIGUOUS_RETRY_PREPARATION_EXCLUDED) so that no arbitrary attempt is used as an authoritative label.",
	};

	const frozenCandidates = {
		schema: `cline.${ACT}.frozen-candidates.v1`,
		act: ACT,
		toolVersion: "offline-independent-holdout.v1",
		sourceHead,
		frozenAt: "pre-validation",
		refitOnHoldout: false,
		trainingSourceSessionId: TRAINING_SESSION_ID,
		trainingSourceTraceSha256: TRAINING_SOURCE_TRACE_SHA256,
		targetScope: { providerId: "openai-compatible", modelId: "qwen3.8-flash-next-iq3_s" },
		candidates: FROZEN_CANDIDATES,
		primaryCandidateId: PRIMARY_CANDIDATE_ID,
		observationTarget: OBSERVATION_TARGET,
		provenance:
			"Transcribed from .factory/evidence/ACT-CLINEMM-COMPACTION-ESTIMATOR-OFFLINE-CALIBRATION01/calibration-candidates.json (committed at 88f7ce2ca). The coefficients are frozen constants; this ACT does not fit, tune or select a coefficient.",
	};

	const temporalGroups: Record<string, unknown> = {};
	if (allRows.length) {
		for (const epoch of [
			"PRE_COMPACTION_EQUIVALENT",
			"COMPACTION_INITIATED",
			"POST_COMPACTION_TRANSFORMED",
			"UNKNOWN",
		]) {
			const group = allRows.filter((r) => classifyObservableEpoch(r) === epoch);
			temporalGroups[epoch] = group.length
				? {
						count: group.length,
						baseline: stats(group, FROZEN_CANDIDATES[0]!),
						constant: stats(group, FROZEN_CANDIDATES[2]!),
					}
				: { count: 0 };
		}
	}

	const holdoutComparison = {
		schema: `cline.${ACT}.holdout-comparison.v1`,
		act: ACT,
		toolVersion: "offline-independent-holdout.v1",
		sourceHead,
		independentSessions: independence.holdoutSessionIds.length,
		eligibleRequests: allRows.length,
		observationTarget: OBSERVATION_TARGET,
		evaluationPerformed: allRows.length > 0,
		comparison: comparisons.map((c) => ({
			candidateId: c.candidateId,
			statistics: c.statistics,
			accuracyImprovementVsBaseline: c.accuracyImprovementVsBaseline,
		})),
		temporalGroups,
		temporalNote:
			"The temporal grouping uses ONLY request-recorded observables (compactionInitiated and decision-estimate/submission equivalence). The prior analyzer's ordinal-derived `epoch` field is NOT used as evidence of compaction timing.",
	};

	const safetyDiscriminators = {
		schema: `cline.${ACT}.safety-discriminators.v1`,
		act: ACT,
		toolVersion: "offline-independent-holdout.v1",
		sourceHead,
		evaluatedRequests: allRows.length,
		perCandidate: comparisons.map((c) => ({
			candidateId: c.candidateId,
			safety: c.safety,
		})),
		productionSuitability: input.suitability,
		preRegisteredInterpretation:
			"The frozen factor is NOT suitable for a production proposal if the holdout demonstrates a false-safe ceiling crossing, unsupported request accounting, or a significant unmitigated underestimate near the effective limit. Even with no failure observed, production deployment remains out of scope.",
		selectionBias:
			"The current budget guard may prevent some unsafe requests from ever reaching the provider. Completed-request samples therefore do not cover all possible overflow cases. Unsubmitted or rejected requests remain UNLABELLED because no actual provider token usage exists for them.",
		unsubmittedCompactionCounterfactual: {
			classification: "UNLABELLED",
			reason:
				"A compaction decision candidate that was never submitted has no actual provider input usage. Provider usage of a post-compaction or beforeModel-transformed request is a DIFFERENT representation and is not a label for the unsubmitted pre-compaction candidate.",
		},
	};

	return [
		writeArtifact("identity.json", identity),
		writeArtifact("holdout-manifest.json", holdoutManifest),
		writeArtifact("join-audit.json", joinAudit),
		writeArtifact("frozen-candidates.json", frozenCandidates),
		writeArtifact("holdout-comparison.json", holdoutComparison),
		writeArtifact("safety-discriminators.json", safetyDiscriminators),
	];
}


