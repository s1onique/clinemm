/**
 * ACT-CLINEMM-COMPACTION-TRIGGER-LIVE-ADJUDICATION-01 — offline adjudicator.
 *
 * Reads the preserved real dogfood latency trace and emits SANITIZED, BOUNDED
 * evidence artifacts. It NEVER copies message text, prompts, tool payloads,
 * credentials or the raw trace into the repository.
 *
 * Everything written is a scalar, a classification, an opaque identifier or a
 * digest — the same privacy contract the latency trace itself enforces.
 *
 * Run:
 *   bun <this-file> --trace "<path>" --out "<dir>" --source-head "<sha>"
 */
import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ACT = "ACT-CLINEMM-COMPACTION-TRIGGER-LIVE-ADJUDICATION-01";

/** The authoritative trace identity this ACT adjudicates. */
const EXPECTED = {
	sessionId: "1794892591345_7em4g",
	schema: "cline.roundc-latency-trace.v1",
	captureProfile: "dogfood",
	requestedModelId: "qwen3.8-flash-next-iq3_s",
	extensionVersion: "4.1.16-5a1c485cb",
	extensionBundleSha256:
		"b8b63baaebf9b5a12e2a636004695fc4eccbde0fb2bf13b55ccf7107cf83263e",
	sha256: "b84ee4a83f3819b4a849e2d05f95c044443e3d3fb036818aef98f9b7fe96b5e1",
	eventCount: 418,
	completedModelRequests: 18,
	compactions: 1,
};

/** The production constants the decision contract is built from. */
const PRODUCTION = {
	COMPACTION_TRIGGER_RATIO: 0.9,
	CONTEXT_WINDOW_INPUT_RATIO: 0.9,
	MAX_INPUT_UNDERESTIMATE_FACTOR: 4,
};

interface TraceEvent {
	correlationId: string;
	boundary: string;
	phase: string;
	monotonicMs: number;
	wallClockIso: string;
	metadata?: Record<string, unknown>;
	durationMs?: number;
	status?: string;
}

interface Trace {
	schema: string;
	sessionId: string;
	captureProfile: string;
	identity: Record<string, unknown>;
	exportedAtIso: string;
	eventCount: number;
	stageCount: number;
	unavailableCount: number;
	integrityFailureCount: number;
	truncation: Record<string, unknown>;
	events: TraceEvent[];
	stages: unknown[];
	unavailable: Array<{ boundary?: string }>;
	integrityFailures: unknown[];
}

function parseArgs(argv: string[]): {
	trace: string;
	out: string;
	sourceHead: string;
} {
	let trace = "";
	let out = "";
	let sourceHead = "";
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		const next = argv[i + 1];
		if (arg === "--trace" && next) {
			trace = next;
			i += 1;
		} else if (arg === "--out" && next) {
			out = next;
			i += 1;
		} else if (arg === "--source-head" && next) {
			sourceHead = next;
			i += 1;
		}
	}
	if (!trace || !out || !sourceHead) {
		throw new Error(
			"usage: adjudicate.ts --trace <path> --out <dir> --source-head <sha>",
		);
	}
	return { trace, out, sourceHead };
}

function sha256Of(buffer: Buffer): string {
	return createHash("sha256").update(buffer).digest("hex");
}

function num(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function str(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function buildIdentity(
	trace: Trace,
	tracePath: string,
	traceBytes: number,
	traceSha256: string,
	sourceHead: string,
): Record<string, unknown> {
	const checks = {
		sha256Matches: traceSha256 === EXPECTED.sha256 ? "MATCH" : "MISMATCH",
		sessionIdMatches:
			trace.sessionId === EXPECTED.sessionId ? "MATCH" : "MISMATCH",
		schemaMatches:
			trace.schema === EXPECTED.schema ? "MATCH" : "MISMATCH",
		captureProfileMatches:
			trace.captureProfile === EXPECTED.captureProfile
				? "MATCH"
				: "MISMATCH",
		requestedModelIdMatches:
			trace.identity.requestedModelId === EXPECTED.requestedModelId
				? "MATCH"
				: "MISMATCH",
		extensionVersionMatches:
			trace.identity.extensionVersion === EXPECTED.extensionVersion
				? "MATCH"
				: "MISMATCH",
		extensionBundleSha256Matches:
			trace.identity.extensionBundleSha256 ===
				EXPECTED.extensionBundleSha256
				? "MATCH"
				: "MISMATCH",
		eventCountMatches:
			trace.eventCount === EXPECTED.eventCount ? "MATCH" : "MISMATCH",
		actualEventCount: trace.events.length,
		truncation: trace.truncation.truncated === false ? "NONE" : "TRUNCATED",
		droppedEventCount: num(trace.truncation.droppedEventCount) ?? null,
		integrityFailureCount: trace.integrityFailureCount,
		unavailableCount: trace.unavailableCount,
		unavailableBoundaries: [
			...new Set(
				trace.unavailable.map((entry) => entry.boundary ?? "UNKNOWN"),
			),
		].sort(),
	};
	const complete =
		checks.truncation === "NONE" &&
		checks.integrityFailureCount === 0 &&
		Object.entries(checks).every(
			([key, value]) => !key.endsWith("Matches") || value === "MATCH",
		);
	return {
		schema: `cline.${ACT}.identity.v1`,
		act: ACT,
		generatedBy: "tool/adjudicate.ts",
		source: {
			repository: "s1onique/clinemm",
			branch: "main",
			entryHead: sourceHead,
			note:
				"ENTRY_HEAD is the repository commit inspected. The installed extension bundle below is an INSTALLED-RUNTIME identity recorded by the capture; it is NOT proof that this repository HEAD produced the bundle (trace identity.sourceHead is UNAVAILABLE_FROM_TRACE).",
		},
		installedExtension: {
			extensionVersion: trace.identity.extensionVersion,
			extensionBundleSha256: trace.identity.extensionBundleSha256,
			sourceHead: trace.identity.sourceHead,
			authority:
				"INSTALLED_RUNTIME_IDENTITY_ONLY — not evidence that the current repository HEAD produced this bundle",
		},
		sourceTrace: {
			path: tracePath,
			bytes: traceBytes,
			sha256: traceSha256,
			schema: trace.schema,
			sessionId: trace.sessionId,
			captureProfile: trace.captureProfile,
			requestedModelId: trace.identity.requestedModelId,
			exportedAtIso: trace.exportedAtIso,
		},
		checks,
		complete,
		rawTraceCommitted: false,
	};
}

interface Decision {
	decisionOrdinal: number | null;
	decisionId: string | null;
	sessionId: string | null;
	preparationRequestId: string | null;
	decisionJoinAuthority: string | null;
	decisionMonotonicMs: number;
	decisionWallClockIso: string;
	compactionMode: string | null;
	compactionStrategy: string | null;
	apiMessageTokens: number | null;
	requestOverheadTokens: number | null;
	requestInputTokens: number | null;
	requestInputTokensAuthority: string;
	requestTriggerTokens: number | null;
	rawMaxInputTokens: number | null;
	effectiveMaxInputTokens: number | null;
	maxInputTokens: number | null;
	actualPreviousInputTokens: number | null;
	actualPreviousInputTokensAuthority: string;
	underestimateFactor: number | null;
	inputBudgetSource: string | null;
	userContextCeiling: number | null;
	workingContextMessageCount: number | null;
	apiMessageCount: number | null;
	apiMessagesJsonChars: number | null;
	shouldCompact: boolean;
	compactionInitiated: boolean;
	classification: string;
	preparedRequestMessageCount: number | null;
	preparedRequestMonotonicMs: number | null;
	providerReportedInputTokens: number | null;
}

function collectJoins(trace: Trace): {
	providerInputByPrep: Map<string, number>;
	preparedMessageCountByPrep: Map<string, number>;
	preparedAtMonoByPrep: Map<string, number>;
} {
	const providerInputByPrep = new Map<string, number>();
	const preparedMessageCountByPrep = new Map<string, number>();
	const preparedAtMonoByPrep = new Map<string, number>();
	for (const event of trace.events) {
		if (!event.metadata) {
			continue;
		}
		const prepId = str(event.metadata.preparationRequestId);
		if (!prepId) {
			continue;
		}
		if (event.boundary === "provider_completed" && event.phase === "start") {
			const inputTokens = num(event.metadata.inputTokens);
			if (inputTokens !== undefined) {
				providerInputByPrep.set(prepId, inputTokens);
			}
		}
		if (event.boundary === "request_preparation" && event.phase === "start") {
			const messageCount = num(event.metadata.messageCount);
			if (messageCount !== undefined) {
				preparedMessageCountByPrep.set(prepId, messageCount);
			}
			preparedAtMonoByPrep.set(prepId, event.monotonicMs);
		}
	}
	return { providerInputByPrep, preparedMessageCountByPrep, preparedAtMonoByPrep };
}

function buildDecisions(
	trace: Trace,
	joins: ReturnType<typeof collectJoins>,
): Decision[] {
	return trace.events
		.filter((event) => event.boundary === "compaction_decision")
		.map((event) => {
			const metadata = event.metadata ?? {};
			const apiMessageTokens = num(metadata.apiMessageTokens) ?? null;
			const requestOverheadTokens =
				num(metadata.requestOverheadTokens) ?? null;
			const requestTriggerTokens =
				num(metadata.requestTriggerTokens) ?? null;
			const preparationRequestId =
				str(metadata.preparationRequestId) ?? null;
			// The production seam computes
			//   requestOverheadTokens = requestInputTokens - apiMessageTokens
			// so requestInputTokens = apiMessageTokens + requestOverheadTokens.
			// The latency trace's metadata allowlist omits `requestInputTokens`
			// itself, so the production projection is RECONSTRUCTED from the
			// two fields the allowlist DOES carry. This is an EXACT algebraic
			// identity, not an approximation.
			const requestInputTokens =
				apiMessageTokens !== null && requestOverheadTokens !== null
					? apiMessageTokens + requestOverheadTokens
					: null;
			const shouldCompact = metadata.shouldCompact === true;
			const compactionInitiated = metadata.compactionInitiated === true;
			const branchSaysCompact =
				requestInputTokens !== null &&
				requestTriggerTokens !== null &&
				requestInputTokens >= requestTriggerTokens;
			const classification =
				shouldCompact !== branchSaysCompact
					? "PRODUCTION_BRANCH_INCONSISTENT"
					: shouldCompact
						? "TRIGGERED"
						: "NOT_TRIGGERED";
			return {
				decisionOrdinal: num(metadata.decisionOrdinal) ?? null,
				decisionId: str(metadata.decisionId) ?? null,
				sessionId: str(metadata.sessionId) ?? null,
				preparationRequestId,
				decisionJoinAuthority:
					str(metadata.decisionJoinAuthority) ?? null,
				decisionMonotonicMs: event.monotonicMs,
				decisionWallClockIso: event.wallClockIso,
				compactionMode: str(metadata.compactionMode) ?? null,
				compactionStrategy: str(metadata.compactionStrategy) ?? null,
				apiMessageTokens,
				requestOverheadTokens,
				requestInputTokens,
				requestInputTokensAuthority:
					"RECONSTRUCTED_EXACT_IDENTITY: apiMessageTokens + requestOverheadTokens (the production seam computes requestOverheadTokens = requestInputTokens - apiMessageTokens)",
				requestTriggerTokens,
				rawMaxInputTokens: num(metadata.rawMaxInputTokens) ?? null,
				effectiveMaxInputTokens:
					num(metadata.effectiveMaxInputTokens) ?? null,
				maxInputTokens: num(metadata.maxInputTokens) ?? null,
				actualPreviousInputTokens:
					num(metadata.actualPreviousInputTokens) ?? null,
				actualPreviousInputTokensAuthority:
					"PROVIDER_REPORTED_USAGE_OF_THE_PREVIOUS_SUBMITTED_REQUEST — never the candidate's usage",
				underestimateFactor: num(metadata.underestimateFactor) ?? null,
				inputBudgetSource: str(metadata.inputBudgetSource) ?? null,
				userContextCeiling: num(metadata.userContextCeiling) ?? null,
				workingContextMessageCount: num(metadata.messageCount) ?? null,
				apiMessageCount: num(metadata.apiMessageCount) ?? null,
				apiMessagesJsonChars: num(metadata.apiMessagesJsonChars) ?? null,
				shouldCompact,
				compactionInitiated,
				classification,
				preparedRequestMessageCount:
					preparationRequestId !== null
						? (joins.preparedMessageCountByPrep.get(preparationRequestId) ??
							null)
						: null,
				preparedRequestMonotonicMs:
					preparationRequestId !== null
						? (joins.preparedAtMonoByPrep.get(preparationRequestId) ??
							null)
						: null,
				providerReportedInputTokens:
					preparationRequestId !== null
						? (joins.providerInputByPrep.get(preparationRequestId) ?? null)
						: null,
			};
		})
		.sort((a, b) => (a.decisionOrdinal ?? 0) - (b.decisionOrdinal ?? 0));
}

const PRODUCTION_CONTRACT = {
	source:
		"sdk/packages/core/src/extensions/context/compaction.ts — createContextCompactionPrepareTurn",
	thresholdConstruction:
		"maxInputTokens = rawMaxInputTokens / underestimateFactor; requestTriggerTokens = maxInputTokens * COMPACTION_TRIGGER_RATIO",
	requestTimeTokenEstimation:
		"requestInputTokens = estimateRequestInputTokens({systemPrompt, messages, tools}) — a REQUEST-TIME ESTIMATE of the candidate, never provider-reported usage",
	providerUsageAuthority:
		"actualPreviousInputTokens = the provider-reported input usage of the PREVIOUS submitted request. It only scales the budget via underestimateFactor = min(4, max(1, actualPrevious/requestInputTokens)), and only when the estimate UNDER-counts it",
	shouldCompactDecision:
		"shouldCompact = requestInputTokens >= requestTriggerTokens",
	compactionInitiation:
		"in auto mode the seam returns undefined (no compaction work) when shouldCompact is false; compactionInitiated = effectiveMode !== 'auto' || shouldCompact",
	compactionTriggerRatio: PRODUCTION.COMPACTION_TRIGGER_RATIO,
	contextWindowInputRatio: PRODUCTION.CONTEXT_WINDOW_INPUT_RATIO,
	maxInputUnderestimateFactor: PRODUCTION.MAX_INPUT_UNDERESTIMATE_FACTOR,
};

function main(): void {
	const { trace: tracePath, out, sourceHead } = parseArgs(process.argv.slice(2));
	const raw = readFileSync(tracePath);
	const trace = JSON.parse(raw.toString("utf8")) as Trace;
	const traceSha256 = sha256Of(raw);
	const traceBytes = statSync(tracePath).size;

	const identity = buildIdentity(
		trace,
		tracePath,
		traceBytes,
		traceSha256,
		sourceHead,
	);
	const joins = collectJoins(trace);
	const decisions = buildDecisions(trace, joins);
	const compactionEvents = trace.events.filter(
		(event) => event.boundary === "compaction",
	);
	const inconsistent = decisions.filter(
		(d) => d.classification === "PRODUCTION_BRANCH_INCONSISTENT",
	);
	const triggered = decisions.filter((d) => d.classification === "TRIGGERED");

	// The trace's own decimal-oracle identities, checked EXACTLY.
	const lastNonTrigger = decisions.find((d) => d.decisionOrdinal === 11);
	const firstTrigger = decisions.find((d) => d.decisionOrdinal === 12);

	const decisive = {
		lastNonTrigger: {
			decisionNumber: 12,
			decisionOrdinal: 11,
			decisionId: "1794892591345_7em4g#12#11",
			preparationRequestId: "req_B3-Yjnop",
			apiMessageTokens: 97_741,
			requestOverheadTokens: 5_695,
			sum: 97_741 + 5_695,
			expectedSum: 103_436,
			sumMatches: 97_741 + 5_695 === 103_436,
			requestTriggerTokens: 103_680,
			shouldCompact: false,
			compactionInitiated: false,
			observedMatches:
				lastNonTrigger?.apiMessageTokens === 97_741 &&
				lastNonTrigger?.requestOverheadTokens === 5_695 &&
				lastNonTrigger?.requestInputTokens === 103_436 &&
				lastNonTrigger?.requestTriggerTokens === 103_680 &&
				lastNonTrigger?.shouldCompact === false &&
				lastNonTrigger?.compactionInitiated === false,
		},
		firstTrigger: {
			decisionNumber: 13,
			decisionOrdinal: 12,
			decisionId: "1794892591345_7em4g#13#12",
			preparationRequestId: "req_wdW3TYdm",
			apiMessageTokens: 102_585,
			requestOverheadTokens: 5_695,
			sum: 102_585 + 5_695,
			expectedSum: 108_280,
			sumMatches: 102_585 + 5_695 === 108_280,
			requestTriggerTokens: 103_680,
			shouldCompact: true,
			compactionInitiated: true,
			observedMatches:
				firstTrigger?.apiMessageTokens === 102_585 &&
				firstTrigger?.requestOverheadTokens === 5_695 &&
				firstTrigger?.requestInputTokens === 108_280 &&
				firstTrigger?.requestTriggerTokens === 103_680 &&
				firstTrigger?.shouldCompact === true &&
				firstTrigger?.compactionInitiated === true,
		},
		actualPrecedingProviderInputTokens: {
			expected: 83_984,
			observed:
				firstTrigger?.actualPreviousInputTokens === 83_984
					? 83_984
					: (firstTrigger?.actualPreviousInputTokens ?? null),
			matches: firstTrigger?.actualPreviousInputTokens === 83_984,
			authority:
				"PROVIDER_REPORTED — this is the provider's reported input for the PREVIOUS submitted request (req_B3-Yjnop), NOT for the unsubmitted candidate",
			previousRequestProviderInputTokens:
				joins.providerInputByPrep.get("req_B3-Yjnop") ?? null,
		},
	};

	// ---------------------------------------------------------------------
	// REPRESENTATION BOUNDARY
	// ---------------------------------------------------------------------
	const compactionEnd = compactionEvents.find(
		(event) => event.phase === "end" && event.metadata,
	);
	const compactionMeta = compactionEnd?.metadata ?? {};
	const triggerPrepId = decisive.firstTrigger.preparationRequestId;
	const triggerDecision = decisions.find(
		(d) => d.preparationRequestId === triggerPrepId,
	);
	const triggerPreparedMessageCount =
		joins.preparedMessageCountByPrep.get(triggerPrepId) ?? null;
	const triggerPreparedAtMono =
		joins.preparedAtMonoByPrep.get(triggerPrepId) ?? null;
	const triggerProviderInput = joins.providerInputByPrep.get(triggerPrepId) ?? null;
	const compactionEndedAtMono = compactionEnd?.monotonicMs ?? null;
	const refsBefore = num(compactionMeta.compactionEvidenceRefsBefore) ?? null;
	const refsAfter = num(compactionMeta.compactionEvidenceRefsAfter) ?? null;

	const representationBoundary = {
		preCompactionCandidate: {
			preparationRequestId: triggerPrepId,
			decisionId: triggerDecision?.decisionId ?? null,
			workingContextMessageCount:
				triggerDecision?.workingContextMessageCount ?? null,
			projectedRequestInputTokens: triggerDecision?.requestInputTokens ?? null,
			projectedTokenAuthority:
				"PRODUCTION_ESTIMATE — the candidate was NEVER submitted to the provider",
			providerReportedInputTokens: null,
			providerReportedInputTokensAuthority: "UNLABELLED",
			label: "UNLABELLED",
		},
		postCompactionRequest: {
			preparationRequestId: triggerPrepId,
			preparedMessageCount: triggerPreparedMessageCount,
			preparedAtMonotonicMs: triggerPreparedAtMono,
			providerReportedInputTokens: triggerProviderInput,
			providerReportedInputTokensAuthority:
				"PROVIDER_REPORTED — this is the SUBMITTED post-compaction request",
			compactionEndedAtMonotonicMs: compactionEndedAtMono,
			preparedAfterCompactionEnded:
				compactionEndedAtMono !== null &&
				triggerPreparedAtMono !== null &&
				triggerPreparedAtMono > compactionEndedAtMono,
			projectionChangedBeforeSubmission:
				triggerDecision?.workingContextMessageCount !== null &&
				triggerPreparedMessageCount !== null &&
				triggerDecision.workingContextMessageCount !== triggerPreparedMessageCount,
		},
		compactionOutcome: {
			durationMs: compactionEnd?.durationMs ?? null,
			durationMsApproximately: 64_564,
			durationMsMatches:
				typeof compactionEnd?.durationMs === "number" &&
				Math.abs(compactionEnd.durationMs - 64_564) < 1_000,
			messagesBefore: num(compactionMeta.compactionMessagesBefore) ?? null,
			messagesAfter: num(compactionMeta.compactionMessagesAfter) ?? null,
			messagesRemoved: num(compactionMeta.compactionMessagesRemoved) ?? null,
			evidenceRefsBefore: refsBefore,
			evidenceRefsAfter: refsAfter,
			evidenceRefsRetained: num(compactionMeta.compactionEvidenceRefsRetained) ?? null,
			evidenceRefsDropped: num(compactionMeta.compactionEvidenceRefsDropped) ?? null,
			evidenceRefsReplaced: num(compactionMeta.compactionEvidenceRefsReplaced) ?? null,
			outcome: str(compactionMeta.compactionOutcome) ?? null,
			status: compactionEnd?.status ?? null,
		},
		droppedWorkingContextReferences: {
			count: refsBefore !== null && refsAfter !== null ? refsBefore - refsAfter : null,
			expected: 17,
			matches:
				refsBefore !== null && refsAfter !== null
					? refsBefore - refsAfter === 17
					: false,
			classification:
				"OBSERVATION_ONLY — whether the corresponding CANONICAL evidence survived belongs to RC-04, NOT to this ACT",
		},
		unsupportedAttributionGuard: {
			assertion:
				"The 15,607-token provider response is NOT the token count of the unsubmitted 108,280-token pre-compaction projection.",
			preCompactionProjectionTokens: triggerDecision?.requestInputTokens ?? null,
			postCompactionProviderReportedTokens: triggerProviderInput,
			valuesDiffer:
				triggerDecision?.requestInputTokens !== triggerProviderInput,
			guardSatisfied:
				triggerDecision?.requestInputTokens !== triggerProviderInput,
		},
	};

	// ---------------------------------------------------------------------
	// OUTPUT
	// ---------------------------------------------------------------------
	const decisionCount = decisions.length;
	const decisionCountMatches = decisionCount === EXPECTED.completedModelRequests;
	const decisiveChecksPassed =
		decisive.lastNonTrigger.observedMatches &&
		decisive.firstTrigger.observedMatches &&
		decisive.actualPrecedingProviderInputTokens.matches;
	const representationChecksPassed =
		representationBoundary.postCompactionRequest.preparedAfterCompactionEnded &&
		representationBoundary.postCompactionRequest.projectionChangedBeforeSubmission &&
		representationBoundary.unsupportedAttributionGuard.guardSatisfied &&
		representationBoundary.droppedWorkingContextReferences.matches &&
		representationBoundary.compactionOutcome.durationMsMatches;
	const identityComplete = identity.complete === true;
	const verdict =
		identityComplete &&
		decisionCountMatches &&
		inconsistent.length === 0 &&
		decisiveChecksPassed &&
		representationChecksPassed
			? "PASS_OBSERVED_TRIGGER_CAUSALITY"
			: "CAPTURE_INSUFFICIENT";

	const decisionAudit = {
		schema: `cline.${ACT}.decision-audit.v1`,
		act: ACT,
		generatedBy: "tool/adjudicate.ts",
		productionContract: PRODUCTION_CONTRACT,
		census: {
			expectedDecisionCount: EXPECTED.completedModelRequests,
			observedDecisionCount: decisionCount,
			decisionCountMatches,
			triggeredDecisionCount: triggered.length,
			expectedCompactionCount: EXPECTED.compactions,
			observedCompactionSpanCount: compactionEvents.filter(
				(event) => event.phase === "start",
			).length,
			productionBranchInconsistencyCount: inconsistent.length,
			decisionIdentities: decisions.map((d) => ({
				decisionOrdinal: d.decisionOrdinal,
				decisionId: d.decisionId,
				preparationRequestId: d.preparationRequestId,
				decisionJoinAuthority: d.decisionJoinAuthority,
			})),
		},
		decisive,
		decisions,
		representationBoundary,
	};

	writeFileSync(join(out, "identity.json"), `${JSON.stringify(identity, null, 2)}\n`);
	writeFileSync(
		join(out, "decision-audit.json"),
		`${JSON.stringify(decisionAudit, null, 2)}\n`,
	);
	writeFileSync(
		join(out, "adjudication-result.json"),
		`${JSON.stringify(
			{
				schema: `cline.${ACT}.adjudication-result.v1`,
				act: ACT,
				traceSha256,
				identityComplete,
				decisionCount,
				decisionCountMatches,
				productionBranchInconsistencyCount: inconsistent.length,
				decisiveChecksPassed,
				representationChecksPassed,
				verdict,
			},
			null,
			2,
		)}\n`,
	);

	console.log(
		JSON.stringify(
			{
				identityComplete,
				decisionCount,
				decisionCountMatches,
				productionBranchInconsistencyCount: inconsistent.length,
				decisiveChecksPassed,
				representationChecksPassed,
				verdict,
			},
			null,
			2,
		),
	);
}

main();
