/**
 * ACT-CLINEMM-PCK-EVIDENCE-FIRST-INPUT-RECON-01
 *
 * C4 — the EXECUTABLE COMPARISON of the four input representations against
 * the SAME REAL canonical history.
 *
 * ============================================================================
 * WHAT IT DOES
 * ============================================================================
 *
 * For EACH candidate (A, B, C) it drives the REAL production transport
 * (`generateSummary()` -> `createHandlerAsync()` -> the gateway ->
 * `ai-sdk.ts` -> `streamText`) against the LIVE qualified endpoint, with the
 * PRODUCTION inference policy and the PRODUCTION physical-request policy
 * applied, and records:
 *
 *   - the SERIALIZED input size (characters and ESTIMATED tokens),
 *   - the ACTUAL provider prompt tokens (from the transport's `usage`
 *     chunk),
 *   - the ACTUAL cached prompt tokens,
 *   - the TOTAL request latency,
 *   - the COMPLETION tokens,
 *   - the ACTUAL finish reason,
 *   - the PARSER outcome,
 *   - the ADMITTED checkpoint record count through the EXISTING publication
 *     gate,
 *   - the gate's reason codes.
 *
 * Candidate D makes NO inference request at all: its records are produced by
 * the runtime's OWN deterministic extraction, so its "latency" is the
 * deterministic extraction's own wall-clock cost.
 *
 * ============================================================================
 * WHAT IS FIXED ACROSS THE CANDIDATES
 * ============================================================================
 *
 *   - the model and the endpoint,
 *   - reasoning disabled (`reasoning_effort: "none"`),
 *   - the temperature (`0.1`),
 *   - the output-token budget (`1024`),
 *   - JSON mode (`response_format: json_object`),
 *   - the NO-AUTOMATIC-RETRY contract (the physical-request policy),
 *   - the publication validation and the assurance rules (the EXISTING
 *     production gate).
 *
 * ============================================================================
 * CONFIDENTIALITY
 * ============================================================================
 *
 * The RAW model output is written to the GITIGNORED `tmp/` tree only. The
 * committed evidence carries the AGGREGATE metrics and the ADMITTED records
 * (whose every byte is a RUNTIME-OWNED constant).
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHandlerAsync } from "@cline/llms";
import type { MessageWithMetadata } from "@cline/shared";
import { estimateTokens } from "@cline/shared";
import {
	collectObservedCanonicalReferences,
	interpretCanonicalEvidence,
} from "../src/extensions/context/precompaction-knowledge-checkpoint/evidence";
import {
	applyPckInferencePolicy,
	PCK_INFERENCE_POLICY_ENV_VAR,
	QWEN_STRATA_V1_PARAMETERS,
	QWEN_STRATA_V1_POLICY_ID,
	resolvePckInferencePolicy,
} from "../src/extensions/context/precompaction-knowledge-checkpoint/inference-policy";
import {
	buildCandidateA,
	buildCandidateB,
	buildCandidateC,
	buildCandidateD,
	buildCandidateDRecords,
	type ReconCandidateInput,
} from "../src/extensions/context/precompaction-knowledge-checkpoint/input-candidates.recon";
import {
	buildCheckpointInputView,
	buildCheckpointRequest,
	CHECKPOINT_SYSTEM_PROMPT,
	extractCheckpointJson,
	extractCheckpointProposals,
} from "../src/extensions/context/precompaction-knowledge-checkpoint/model-request";
import { applyPckPhysicalRequestPolicy } from "../src/extensions/context/precompaction-knowledge-checkpoint/physical-request-policy";
import { gateClosedProposals } from "../src/extensions/context/precompaction-knowledge-checkpoint/publication-gate";

const PRIVATE_ROOT = join(
	process.cwd(),
	"..",
	"..",
	"..",
	"tmp",
	"pck-input-recon",
);

/**
 * The operator's existing provider settings. The credential is NEVER
 * written to any output file, log line or evidence artefact.
 */
interface OperatorProviderConfig {
	readonly providerId: string;
	readonly modelId: string;
	readonly baseUrl?: string;
	readonly apiKey?: string;
}

function readOperatorProviderConfig(): OperatorProviderConfig {
	const providersPath = join(
		homedir(),
		".vscodium-roz",
		"cline-data",
		"settings",
		"providers.json",
	);
	const providers = JSON.parse(readFileSync(providersPath, "utf8")) as {
		providers?: Record<
			string,
			{ settings?: { apiKey?: string; baseUrl?: string; model?: string } }
		>;
	};
	const entry = providers.providers?.["openai-compatible"]?.settings;
	if (!entry?.apiKey) {
		throw new Error("No operator credential is configured.");
	}
	return {
		providerId: "openai-compatible",
		modelId: entry.model ?? "qwen3.8-flash-next-q2_0",
		baseUrl: entry.baseUrl,
		apiKey: entry.apiKey,
	};
}

/**
 * ONE candidate's MEASURED outcome.
 */
interface CandidateMeasurement {
	readonly candidate: "A" | "B" | "C" | "D";
	readonly inputChars: number;
	readonly estimatedInputTokens: number;
	readonly actualPromptTokens?: number;
	readonly actualCacheReadTokens?: number;
	readonly actualCompletionTokens?: number;
	readonly totalLatencyMs: number;
	readonly finishReason?: string;
	readonly parserOutcome: "parsed" | "invalid_json" | "no_response";
	readonly admittedRecordCount: number;
	readonly gateCodes: readonly string[];
	readonly admittedRecords: readonly {
		readonly assurance: string;
		readonly kind: string;
		readonly status: string;
		readonly statement: string;
	}[];
	readonly carriedMessageCount: number;
	readonly carriedObservationCount: number;
	readonly providerFailed: boolean;
	readonly physicalRequestCount: number;
}

/**
 * Drive ONE candidate through the REAL production transport.
 *
 * The physical-request count is observed by wrapping the `fetch` the
 * transport uses, so the cardinality contract is MEASURED rather than
 * assumed.
 */
async function measureCandidate(input: {
	readonly candidate: ReconCandidateInput;
	readonly canonicalMessages: readonly MessageWithMetadata[];
	readonly provider: OperatorProviderConfig;
}): Promise<CandidateMeasurement> {
	const observedReferences = collectObservedCanonicalReferences(
		input.canonicalMessages,
	);
	const effectiveProviderConfig = {
		providerId: input.provider.providerId,
		modelId: input.provider.modelId,
		...(input.provider.baseUrl ? { baseUrl: input.provider.baseUrl } : {}),
		apiKey: input.provider.apiKey,
	};
	const resolution = resolvePckInferencePolicy({
		purpose: "pck",
		featureEnabled: true,
		effectiveProviderConfig,
		env: { [PCK_INFERENCE_POLICY_ENV_VAR]: QWEN_STRATA_V1_POLICY_ID },
	});
	if (!resolution.applied) {
		throw new Error(`the inference policy did not apply: ${resolution.reason}`);
	}
	// The output budget is a RECON KNOB, not a production change: the
	// production policy's own value is the default, and an override lets the
	// SAME harness measure the budget's effect without touching production.
	const budgetOverride = process.env.PCK_RECON_MAX_OUTPUT_TOKENS;
	const policyParameters =
		budgetOverride === undefined
			? QWEN_STRATA_V1_PARAMETERS
			: {
					...QWEN_STRATA_V1_PARAMETERS,
					maxOutputTokens: Number.parseInt(budgetOverride, 10),
				};
	const withInference = applyPckInferencePolicy(
		effectiveProviderConfig,
		policyParameters,
	);
	// The PRODUCTION physical-request policy is applied, so the
	// no-automatic-retry contract holds for every candidate identically.
	const withPolicy = applyPckPhysicalRequestPolicy(withInference);

	let physicalRequestCount = 0;
	const countingFetch = (async (...args: Parameters<typeof fetch>) => {
		physicalRequestCount += 1;
		return fetch(...args);
	}) as typeof fetch;

	const handler = await createHandlerAsync({
		...(withPolicy as unknown as Record<string, unknown>),
		fetch: countingFetch,
	} as never);

	const request = buildCheckpointRequest(
		{
			text: input.candidate.text,
			references: observedReferences,
			sourceMessageCount: 0,
		},
		observedReferences,
	);

	const startedAt = Date.now();
	let text = "";
	let providerFailed = false;
	let actualPromptTokens: number | undefined;
	let actualCacheReadTokens: number | undefined;
	let actualCompletionTokens: number | undefined;
	let finishReason: string | undefined;
	let providerError: string | undefined;
	try {
		for await (const chunk of handler.createMessage(CHECKPOINT_SYSTEM_PROMPT, [
			{ role: "user", content: request },
		])) {
			if (chunk.type === "text") {
				text += chunk.text;
				continue;
			}
			if (chunk.type === "usage") {
				actualPromptTokens = chunk.inputTokens;
				actualCacheReadTokens = chunk.cacheReadTokens;
				actualCompletionTokens = chunk.outputTokens;
				continue;
			}
			if (chunk.type === "done") {
				providerFailed = !chunk.success;
				finishReason =
					chunk.incompleteReason ?? (chunk.success ? "stop" : "error");
				if (chunk.error !== undefined) {
					providerError = chunk.error;
				}
			}
		}
	} catch (error) {
		providerFailed = true;
		finishReason = `transport_error:${(error as Error).message}`;
		providerError = (error as Error).message;
	}
	const totalLatencyMs = Date.now() - startedAt;

	// The RAW output is OPERATOR-LOCAL. It is never committed.
	writeFileSync(
		join(PRIVATE_ROOT, `candidate-${input.candidate.candidate}-raw.txt`),
		text,
		"utf8",
	);

	// The PARSER is the PRODUCTION parser.
	const parsed = extractCheckpointJson(text.trim());
	const parserOutcome: CandidateMeasurement["parserOutcome"] =
		text.trim().length === 0
			? "no_response"
			: parsed === undefined
				? "invalid_json"
				: "parsed";
	const proposals =
		parsed === undefined ? [] : extractCheckpointProposals(parsed);

	// The PUBLICATION GATE is the EXISTING production gate, and the
	// interpreter is the EXISTING production interpreter.
	const gate = gateClosedProposals({
		proposals,
		sourcePrefixKey: `recon-${input.candidate.candidate}`,
		evidence: {
			canonicalReferences: observedReferences,
			maximumAssuranceFor: (references, atom, argument) =>
				interpretCanonicalEvidence({
					canonicalMessages: input.canonicalMessages,
					references,
					atom,
					argument,
				}),
		},
	});

	return {
		candidate: input.candidate.candidate,
		inputChars: input.candidate.textChars,
		estimatedInputTokens: estimateTokens(input.candidate.textChars),
		actualPromptTokens,
		actualCacheReadTokens,
		actualCompletionTokens,
		totalLatencyMs,
		finishReason,
		parserOutcome,
		admittedRecordCount: gate.records.length,
		gateCodes: gate.codes,
		admittedRecords: gate.records.map((record) => ({
			assurance: record.assurance,
			kind: record.kind,
			status: record.status,
			statement: record.statement,
		})),
		carriedMessageCount: input.candidate.carriedMessageCount,
		carriedObservationCount: input.candidate.carriedObservationCount,
		providerFailed,
		physicalRequestCount,
		providerError,
	};
}

/**
 * Measure CANDIDATE D — the DETERMINISTIC discriminator.
 *
 * Candidate D makes NO inference request. Its records are produced by the
 * runtime's OWN deterministic extraction, so the "latency" it reports is the
 * deterministic extraction's own wall-clock cost, and the physical request
 * count is ZERO by construction.
 */
function measureCandidateD(input: {
	readonly canonicalMessages: readonly MessageWithMetadata[];
}): CandidateMeasurement {
	const startedAt = Date.now();
	const records = buildCandidateDRecords(input.canonicalMessages);
	const candidate = buildCandidateD(input.canonicalMessages);
	const totalLatencyMs = Date.now() - startedAt;
	return {
		candidate: "D",
		inputChars: candidate.textChars,
		estimatedInputTokens: estimateTokens(candidate.textChars),
		actualPromptTokens: 0,
		actualCacheReadTokens: 0,
		actualCompletionTokens: 0,
		totalLatencyMs,
		finishReason: "deterministic_no_inference",
		parserOutcome: "parsed",
		admittedRecordCount: records.length,
		gateCodes: [],
		admittedRecords: records.map((record) => ({
			assurance: record.assurance,
			kind: record.kind,
			status: record.status,
			statement: `${record.atom}${
				record.argument ? `: ${record.argument}` : ""
			}`,
		})),
		carriedMessageCount: candidate.carriedMessageCount,
		carriedObservationCount: candidate.carriedObservationCount,
		providerFailed: false,
		physicalRequestCount: 0,
	};
}

async function main(): Promise<void> {
	mkdirSync(PRIVATE_ROOT, { recursive: true });
	const sessionId = process.argv[2];
	if (!sessionId) {
		console.error("usage: pck-input-recon.compare.ts <sessionId> [candidates]");
		process.exit(2);
	}
	const requested = (process.argv[3] ?? "A,B,C,D").split(",");
	const canonicalMessages = JSON.parse(
		readFileSync(join(PRIVATE_ROOT, `${sessionId}.canonical.json`), "utf8"),
	) as MessageWithMetadata[];

	const provider = readOperatorProviderConfig();
	console.log(
		JSON.stringify({
			event: "model_identity",
			providerId: provider.providerId,
			modelId: provider.modelId,
			baseUrl: provider.baseUrl ?? "(default)",
			hasCredential: Boolean(provider.apiKey),
			sessionId,
			messageCount: canonicalMessages.length,
		}),
	);

	// The PRODUCTION input view is the baseline's input.
	const productionInputView = buildCheckpointInputView(canonicalMessages);

	const candidates: Record<string, ReconCandidateInput> = {
		A: buildCandidateA(canonicalMessages, productionInputView.text),
		B: buildCandidateB(canonicalMessages),
		C: buildCandidateC(canonicalMessages),
		D: buildCandidateD(canonicalMessages),
	};

	const measurements: CandidateMeasurement[] = [];
	for (const candidate of requested) {
		const key = candidate.trim().toUpperCase();
		if (key === "D") {
			const measurement = measureCandidateD({ canonicalMessages });
			measurements.push(measurement);
			console.log(
				JSON.stringify({ event: "candidate_measured", ...measurement }),
			);
			continue;
		}
		const built = candidates[key];
		if (!built) {
			console.error(`unknown candidate: ${candidate}`);
			process.exit(2);
		}
		const measurement = await measureCandidate({
			candidate: built,
			canonicalMessages,
			provider,
		});
		measurements.push(measurement);
		console.log(
			JSON.stringify({ event: "candidate_measured", ...measurement }),
		);
	}

	// The summary is DERIVED from the measurements, never hardcoded.
	const summary = {
		event: "recon_comparison_summary",
		sessionId,
		providerId: provider.providerId,
		modelId: provider.modelId,
		inferencePolicy: {
			reasoningEffort: QWEN_STRATA_V1_PARAMETERS.reasoningEffort,
			temperature: QWEN_STRATA_V1_PARAMETERS.temperature,
			maxOutputTokens: QWEN_STRATA_V1_PARAMETERS.maxOutputTokens,
			responseFormat: QWEN_STRATA_V1_PARAMETERS.responseFormat,
		},
		measurements: measurements.map((measurement) => ({
			candidate: measurement.candidate,
			inputChars: measurement.inputChars,
			estimatedInputTokens: measurement.estimatedInputTokens,
			actualPromptTokens: measurement.actualPromptTokens,
			actualCacheReadTokens: measurement.actualCacheReadTokens,
			actualCompletionTokens: measurement.actualCompletionTokens,
			totalLatencyMs: measurement.totalLatencyMs,
			finishReason: measurement.finishReason,
			parserOutcome: measurement.parserOutcome,
			admittedRecordCount: measurement.admittedRecordCount,
			gateCodes: measurement.gateCodes,
			carriedMessageCount: measurement.carriedMessageCount,
			carriedObservationCount: measurement.carriedObservationCount,
			providerFailed: measurement.providerFailed,
			physicalRequestCount: measurement.physicalRequestCount,
			providerError: measurement.providerError,
		})),
	};
	writeFileSync(
		join(PRIVATE_ROOT, `${sessionId}.comparison.json`),
		JSON.stringify(summary, null, 2),
		"utf8",
	);
	console.log(JSON.stringify(summary, null, 2));
}

await main();
