/**
 * ACT-CLINEMM-PCK-CLOSED-PUBLICATION-IMPLEMENT-01
 *
 * G4.5 — the EARLY REAL-MODEL GATE.
 *
 * ============================================================================
 * WHAT IT DOES
 * ============================================================================
 *
 * It executes a BOUNDED model-contract test against the EXISTING authorized
 * local/provider configuration. It drives the PRODUCTION checkpoint
 * generation seam (`runPckAttempt`) with the REAL provider transport and the
 * REAL publication gate, and it measures:
 *
 *   SCHEMA_VALID
 *   CLOSED_VALUES_VALID
 *   REFERENCES_RESOLVED
 *   ASSURANCE_BOUNDED
 *   CANDIDATE_ACCEPTED
 *
 * The pass condition is `CANDIDATE_ACCEPTED`, not merely JSON validity.
 *
 * THE BUDGET
 * ----------
 *
 *   Maximum generation attempts: 2
 *   Tool calls:                0
 *   Automatic retries:         0
 *   Publication attempts:      1 per candidate
 *
 * ============================================================================
 * CORRECTION01 — THE PROVIDER CALL RUNS INSIDE THE PRODUCTION ATTEMPT
 * ============================================================================
 *
 * The predecessor performed the provider request FIRST and then handed the
 * already-collected response to `runPckAttempt()`. The production attempt's
 * deadline therefore did NOT bound the actual network request, and the
 * production cancellation contract did NOT govern it.
 *
 * The provider call now runs INSIDE the generator that the production
 * attempt invokes, so:
 *
 *   - the production attempt's combined deadline/cancellation signal
 *     governs the REAL request,
 *   - an aborted attempt stops consuming the provider response
 *     immediately,
 *   - the request that reaches the provider is the EXACT request the
 *     production seam builds from the canonical history, not a
 *     reconstruction of it.
 *
 * The attempt budget is UNCHANGED: two attempts, no automatic retries.
 *
 * WHAT THIS QUALIFIES
 * -------------------
 *
 * It qualifies the REAL MODEL's ability to produce an acceptable closed
 * proposal THROUGH the production generation lifecycle: the production
 * request, the production deadline and cancellation contract, the
 * production parser and the production publication gate.
 *
 * THE CREDENTIAL
 * --------------
 *
 * The credential is read from the operator-local secrets store and is NEVER
 * written to any output file, log line, or evidence artefact. The raw model
 * output is written to the repository's gitignored `tmp/` tree only.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHandlerAsync } from "@cline/llms";
import type { MessageWithMetadata } from "@cline/shared";
import {
	collectObservedCanonicalReferences,
	interpretCanonicalEvidence,
} from "../src/extensions/context/precompaction-knowledge-checkpoint/evidence";
import {
	buildCheckpointInputView,
	buildCheckpointRequest,
	extractCheckpointJson,
} from "../src/extensions/context/precompaction-knowledge-checkpoint/model-request";
import { gateClosedProposals } from "../src/extensions/context/precompaction-knowledge-checkpoint/publication-gate";
import { runPckAttempt } from "../src/extensions/context/precompaction-knowledge-checkpoint/runtime";

const PRIVATE_ROOT = join(
	process.cwd(),
	"..",
	"..",
	"..",
	"tmp",
	"pck-model-gate",
);

interface OperatorProviderConfig {
	readonly providerId: string;
	readonly modelId: string;
	readonly baseUrl?: string;
	readonly apiKey?: string;
	readonly modelInfo?: Record<string, unknown>;
}

/**
 * Read the operator's EXISTING provider configuration.
 */
function readOperatorProviderConfig(): OperatorProviderConfig {
	const state = JSON.parse(
		readFileSync(join(homedir(), ".cline", "data", "globalState.json"), "utf8"),
	) as Record<string, unknown>;
	const secrets = JSON.parse(
		readFileSync(join(homedir(), ".cline", "data", "secrets.json"), "utf8"),
	) as Record<string, string>;
	const providerId = "openai-compatible";
	const modelId = String(state.actModeApiModelId ?? "MiniMax-M3");
	const baseUrl = state.openAiBaseUrl ? String(state.openAiBaseUrl) : undefined;
	const modelInfo = state.actModeOpenAiModelInfo as
		| Record<string, unknown>
		| undefined;
	const apiKey = secrets.openAiApiKey ?? secrets.minimaxApiKey;
	return { providerId, modelId, baseUrl, apiKey, modelInfo };
}

/**
 * The synthetic fixture: a bounded, non-sensitive working session.
 *
 * It carries the R4/R2/R6-style observation classes the closed vocabulary
 * must be able to express, and NO credential and NO private data.
 */
function syntheticFixture(): MessageWithMetadata[] {
	return [
		{
			role: "user",
			id: "fixture_task",
			content:
				"Inspect the deployment configuration and report what the evidence supports.",
		} as unknown as MessageWithMetadata,
		{
			role: "assistant",
			id: "fixture_call",
			content: [
				{
					type: "tool_use",
					id: "fixture_tool_1",
					name: "run_commands",
					input: { command: "deploy.sh build" },
				},
			],
		} as unknown as MessageWithMetadata,
		{
			role: "user",
			id: "fixture_result",
			content: [
				{
					type: "tool_result",
					tool_use_id: "fixture_tool_1",
					content: [
						{
							query: "deploy.sh build",
							result: "build finished successfully",
							success: true,
						},
					],
				},
			],
		} as unknown as MessageWithMetadata,
		{
			role: "assistant",
			id: "fixture_call_2",
			content: [
				{
					type: "tool_use",
					id: "fixture_tool_2",
					name: "read_file",
					input: { path: "config/runtime.yaml" },
				},
			],
		} as unknown as MessageWithMetadata,
		{
			role: "user",
			id: "fixture_result_2",
			content: [
				{
					type: "tool_result",
					tool_use_id: "fixture_tool_2",
					content: [
						{
							query: "config/runtime.yaml",
							result: "connect timeout: 3 seconds",
							success: true,
						},
					],
				},
			],
		} as unknown as MessageWithMetadata,
		{
			role: "assistant",
			id: "fixture_call_3",
			content: [
				{
					type: "tool_use",
					id: "fixture_tool_3",
					name: "search_files",
					input: { pattern: "token_cleanup" },
				},
			],
		} as unknown as MessageWithMetadata,
		{
			role: "user",
			id: "fixture_result_3",
			content: [
				{
					type: "tool_result",
					tool_use_id: "fixture_tool_3",
					content: [
						{
							query: "token_cleanup",
							result: "no matches in the searched scope",
							success: true,
						},
					],
				},
			],
		} as unknown as MessageWithMetadata,
	];
}

async function main(): Promise<void> {
	mkdirSync(PRIVATE_ROOT, { recursive: true });
	const provider = readOperatorProviderConfig();
	// The model identity is DISCOVERED at execution time and recorded.
	console.log(
		JSON.stringify({
			event: "model_identity",
			providerId: provider.providerId,
			modelId: provider.modelId,
			baseUrl: provider.baseUrl ?? "(default)",
			hasCredential: Boolean(provider.apiKey),
		}),
	);
	if (!provider.apiKey) {
		throw new Error("No operator credential is configured.");
	}
	const canonicalMessages = syntheticFixture();
	const observedReferences =
		collectObservedCanonicalReferences(canonicalMessages);
	// ACT-CLINEMM-PCK-CLOSED-PUBLICATION-IMPLEMENT-01-CORRECTION01:
	//
	// The request is NOT built here. The PRODUCTION attempt builds it from
	// the canonical history, so the request that reaches the provider is
	// the EXACT request the production seam would send — not a
	// reconstruction of it. The measurement below reports the size of
	// that request for the receipt.
	const inputView = buildCheckpointInputView(canonicalMessages);
	const request = buildCheckpointRequest(inputView, observedReferences);
	console.log(
		JSON.stringify({
			event: "checkpoint_request",
			observedReferenceCount: observedReferences.length,
			requestChars: request.length,
		}),
	);

	let attempt = 0;
	let accepted = false;
	const deadlineMs = 200_000;
	// ACT-CLINEMM-PCK-CLOSED-PUBLICATION-IMPLEMENT-01-CORRECTION01:
	//
	// The PROVIDER CALL NOW RUNS INSIDE the generator that the PRODUCTION
	// attempt invokes. The predecessor performed the provider request
	// FIRST and then handed the already-collected response to
	// `runPckAttempt()`, so the production attempt's deadline did not
	// bound the actual network request and the production cancellation
	// contract did not govern it.
	//
	// With the call inside the generator, the production attempt's
	// combined deadline/cancellation signal governs the REAL request, and
	// the attempt budget stays at the same two attempts.
	while (attempt < 2 && !accepted) {
		attempt += 1;
		const startedAt = Date.now();
		let rawText = "";
		let usedTools = false;
		// The PRODUCTION attempt drives the provider call. Its signal is
		// the combined deadline/cancellation handle.
		const outcome = await runPckAttempt({
			generate: async ({ systemPrompt, request, signal }) => {
				const handler = await createHandlerAsync({
					providerId: provider.providerId,
					modelId: provider.modelId,
					...(provider.baseUrl ? { baseUrl: provider.baseUrl } : {}),
					apiKey: provider.apiKey,
					...(provider.modelInfo
						? {
								modelInfo: {
									id: provider.modelId,
									...(provider.modelInfo as Record<string, unknown>),
								},
							}
						: {}),
					maxOutputTokens: 4096,
					thinking: false,
				});
				for await (const chunk of handler.createMessage(
					systemPrompt,
					[{ role: "user", content: request }],
				)) {
					// The PRODUCTION cancellation contract is honoured
					// INSIDE the stream: an aborted attempt stops
					// consuming the provider response immediately.
					if (signal.aborted) {
						break;
					}
					if (chunk.type === "text") {
						rawText += chunk.text;
					} else if (chunk.type === "tool_calls") {
						usedTools = true;
					}
				}
				// The raw model output is OPERATOR-LOCAL. It is never
				// committed.
				writeFileSync(
					join(PRIVATE_ROOT, `attempt-${attempt}-raw.txt`),
					rawText,
					"utf8",
				);
				console.log(
					JSON.stringify({
						event: "attempt_completed",
						attempt,
						elapsedMs: Date.now() - startedAt,
						responseChars: rawText.length,
						usedTools,
						aborted: signal.aborted,
					}),
				);
				// The signal is raised so the production attempt observes
				// the cancellation rather than a completed request.
				signal.throwIfAborted();
				return {
					text: rawText,
					reasoningChars: 0,
					usedTools,
					failed: false,
				};
			},
			canonicalMessages,
			identity: { decisionId: "model-gate", sourcePrefixKey: "model-gate" },
			taskSignal: new AbortController().signal,
			deadlineMs,
			currentSourcePrefixKey: () => "model-gate",
		});
		if (outcome.failureReason === "timeout") {
			console.log(
				JSON.stringify({
					event: "attempt_rejected",
					attempt,
					reason: "timeout",
				}),
			);
			continue;
		}
		if (outcome.failureReason === "cancelled") {
			console.log(
				JSON.stringify({
					event: "attempt_rejected",
					attempt,
					reason: "cancelled",
				}),
			);
			continue;
		}
		if (outcome.failureReason === "provider_failure") {
			console.log(
				JSON.stringify({
					event: "attempt_failed",
					attempt,
					errorMessage: "the provider call failed inside the production attempt",
				}),
			);
			continue;
		}
		if (usedTools) {
			console.log(
				JSON.stringify({
					event: "attempt_rejected",
					attempt,
					reason: "tool_call_attempted",
				}),
			);
			continue;
		}
		// The measurement uses the PRODUCTION parser, so the reported
		// metrics describe exactly what the production gate sees.
		const parsed = extractCheckpointJson(rawText) as
			| { records?: unknown[] }
			| undefined;
		const schemaValid = parsed !== undefined && Array.isArray(parsed?.records);
		const gate = gateClosedProposals({
			proposals: Array.isArray(parsed?.records) ? parsed.records : [],
			sourcePrefixKey: "model-gate",
			evidence: {
				canonicalReferences: observedReferences,
				maximumAssuranceFor: (references, atom) =>
					interpretCanonicalEvidence({
						canonicalMessages,
						references,
						atom,
					}),
			},
		});
		console.log(
			JSON.stringify({
				event: "candidate_evaluated",
				attempt,
				SCHEMA_VALID: schemaValid,
				CLOSED_VALUES_VALID: gate.codes.length === 0,
				REFERENCES_RESOLVED:
					gate.codes.filter((code) => code === "REFERENCE_NOT_CANONICAL")
						.length === 0,
				ASSURANCE_BOUNDED:
					gate.records.length > 0 &&
					gate.records.every(
						(record) => record.assurance !== ("runtime_verified" as never),
					),
				CANDIDATE_ACCEPTED: outcome.accepted,
				gateCodes: gate.codes,
				admittedRecordCount: gate.records.length,
				admittedRecords: gate.records.map((record) => ({
					id: record.id,
					kind: record.kind,
					assurance: record.assurance,
					status: record.status,
					statement: record.statement,
					qualificationCount: record.qualifications.length,
					evidenceRefCount: record.evidenceRefs.length,
				})),
				failureReason: outcome.failureReason,
			}),
		);
		accepted = outcome.accepted;
	}
	console.log(
		JSON.stringify({
			event: "model_gate_result",
			attempts: attempt,
			CANDIDATE_ACCEPTED: accepted,
			verdict: accepted
				? "MODEL_CLOSED_CONTRACT_SUPPORTED"
				: "HALT_MODEL_CONTRACT_UNSUPPORTED",
		}),
	);
	if (!accepted) {
		process.exitCode = 1;
	}
}

await main();
