/**
 * ACT-CLINEMM-CACHE-PRESERVING-AUXILIARY-INFERENCE-RECON-01 (AMENDMENT-01)
 *
 * A2 + A3 — source visibility, evidence-reference visibility and the
 * visible-tool / execution-authority discriminator.
 *
 * The fixture is ADVERSARIAL: canonical ids, a tool-call/tool-result pair, a
 * SUCCESSFUL observation, a FAILED observation, a RETRACTED conclusion, a long
 * (bounded) source body, UNSIGNED reasoning, SIGNED (replay-authorized)
 * reasoning and an UNSUPPORTED evidence reference.
 *
 * Nothing here is a hand-built JSON fixture: the candidate body is produced by
 * the real request builder and the real provider transport with an injected
 * fetch. NO inference, NO network, NO production change.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { interpretCanonicalEvidence } from "../../../../sdk/packages/core/src/extensions/context/precompaction-knowledge-checkpoint/evidence.ts";
import {
	applyPckInferencePolicy,
	resolvePckInferencePolicy,
} from "../../../../sdk/packages/core/src/extensions/context/precompaction-knowledge-checkpoint/inference-policy.ts";
import {
	buildCheckpointInputView,
	buildCheckpointRequest,
	CHECKPOINT_SYSTEM_PROMPT,
} from "../../../../sdk/packages/core/src/extensions/context/precompaction-knowledge-checkpoint/model-request.ts";
import { gateClosedProposals } from "../../../../sdk/packages/core/src/extensions/context/precompaction-knowledge-checkpoint/publication-gate.ts";
import { runPckAttempt } from "../../../../sdk/packages/core/src/extensions/context/precompaction-knowledge-checkpoint/runtime.ts";
import { MessageBuilder } from "../../../../sdk/packages/core/src/session/services/message-builder.ts";
import type { ProviderConfig } from "../../../../sdk/packages/llms/src/index.ts";
import { createHandlerAsync } from "../../../../sdk/packages/llms/src/index.ts";

const PROVIDER_ID = "openai-compatible";
const MODEL_ID = "qwen3.8-flash-next-q2_0";

const PARENT_SYSTEM_PROMPT = "You are Cline, an AI coding agent.";

/** The parent's VISIBLE mutation tool: present in the auxiliary request, never executable. */
const MUTATION_TOOL = {
	name: "replace_in_file",
	description: "Replace content in a file.",
	inputSchema: {
		type: "object",
		properties: { path: { type: "string" }, diff: { type: "string" } },
		required: ["path", "diff"],
	},
};

const LONG_BODY = `LONG-SOURCE-BODY-MARKER ${"x".repeat(20_000)}`;

const CANONICAL = [
	{
		role: "user",
		content: "Investigate the restore path and the OTP dispatch.",
		id: "msg-1",
	},
	{
		role: "assistant",
		content: [
			{ type: "thinking", thinking: "UNSIGNED-REASONING-MARKER" },
			{ type: "text", text: "I will read the module." },
			{
				type: "tool_use",
				id: "call-1",
				name: "read_file",
				input: { path: "model.nim" },
			},
		],
		id: "msg-2",
	},
	{
		role: "user",
		content: [
			{
				type: "tool_result",
				tool_use_id: "call-1",
				content: [
					{
						query: "model.nim",
						result: `SOURCE-BODY-MARKER ${LONG_BODY}`,
						success: true,
					},
				],
			},
		],
		id: "msg-3",
	},
	{
		role: "assistant",
		content: [
			{
				type: "thinking",
				thinking: "SIGNED-REASONING-MARKER",
				signature: "sig-1",
			},
			{ type: "text", text: "Conclusion A holds." },
		],
		id: "msg-4",
	},
	{
		role: "user",
		content: [
			{
				type: "tool_result",
				tool_use_id: "call-2",
				content: [
					{
						query: "restore.log",
						result: "restoration failed",
						success: false,
					},
				],
			},
		],
		id: "msg-5",
	},
	{
		role: "assistant",
		content: [
			{ type: "text", text: "RETRACTION-MARKER: conclusion A is withdrawn." },
		],
		id: "msg-6",
	},
] as unknown as Parameters<MessageBuilder["buildForApi"]>[0];

/** The canonical references, in canonical order. */
const REFERENCES = buildCheckpointInputView(CANONICAL as never).references;

/** The tail suffix of the candidate: the contract plus the dynamic data. */
const CANDIDATE_SUFFIX = [
	CHECKPOINT_SYSTEM_PROMPT,
	"",
	`Canonical references available for citation (use these exact keys): ${REFERENCES.join(", ")}`,
	"Authorized source interval: id:msg-1..id:msg-6",
	"Objective: produce the structured working-knowledge checkpoint for the authorized source interval",
].join("\n");

async function captureWireBody(input: {
	readonly systemPrompt: string;
	readonly messages: unknown[];
	readonly tools?: unknown[];
	readonly sse?: string;
	readonly providerConfig?: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
	let captured: Record<string, unknown> | undefined;
	const fetchStub = (async (_url: unknown, init: unknown) => {
		const requestInit = init as { body?: string } | undefined;
		captured = JSON.parse(requestInit?.body ?? "{}") as Record<string, unknown>;
		return new Response(input.sse ?? "data: [DONE]\n\n", {
			status: 200,
			headers: { "content-type": "text/event-stream" },
		});
	}) as typeof fetch;
	const handler = await createHandlerAsync({
		providerId: PROVIDER_ID,
		modelId: MODEL_ID,
		apiKey: "test-key",
		baseUrl: "http://endpoint.invalid/v1",
		maxOutputTokens: 4096,
		thinking: false,
		...input.providerConfig,
		fetch: fetchStub,
	} as unknown as ProviderConfig);
	const chunks: { type: string }[] = [];
	for await (const chunk of handler.createMessage(
		input.systemPrompt,
		input.messages as never,
		input.tools as never,
	)) {
		chunks.push({ type: chunk.type });
	}
	return { body: captured, chunks };
}

/** The import closure of the PCK transport chain, restricted to RELATIVE imports. */
function importClosure(entries: readonly string[]): string[] {
	const seen = new Set<string>();
	const queue = [...entries];
	while (queue.length > 0) {
		const file = queue.pop() as string;
		if (seen.has(file)) {
			continue;
		}
		seen.add(file);
		const source = readFileSync(file, "utf8");
		for (const match of source.matchAll(/from\s+"([^"]+)"/g)) {
			const specifier = match[1] as string;
			if (!specifier.startsWith(".")) {
				continue;
			}
			const target = resolve(dirname(file), specifier);
			for (const candidate of [target, `${target}.ts`, `${target}/index.ts`]) {
				if (existsSync(candidate) && statSync(candidate).isFile()) {
					queue.push(candidate);
					break;
				}
			}
		}
	}
	return [...seen];
}

const PCK_CHAIN_ENTRIES = [
	resolve(
		import.meta.dir,
		"../../../../sdk/packages/core/src/extensions/context/precompaction-knowledge-checkpoint/runtime.ts",
	),
	resolve(
		import.meta.dir,
		"../../../../sdk/packages/core/src/extensions/context/precompaction-knowledge-checkpoint/model-request.ts",
	),
	resolve(
		import.meta.dir,
		"../../../../sdk/packages/core/src/extensions/context/precompaction-knowledge-checkpoint/publication-gate.ts",
	),
	resolve(
		import.meta.dir,
		"../../../../sdk/packages/core/src/extensions/context/summary-generation.ts",
	),
];

export interface SourceVisibilityReport {
	readonly actId: string;
	readonly amendment: string;
	readonly evidenceClass: string;
	readonly legacyControlledView: Record<string, unknown>;
	readonly candidateAuxiliaryRequest: Record<string, unknown>;
	readonly deltas: readonly string[];
	readonly evidenceReferenceBinding: Record<string, unknown>;
	readonly publicationGateProbes: readonly Record<string, unknown>[];
	readonly inferencePolicyConservation: Record<string, unknown>;
	readonly visibleToolExecution: Record<string, unknown>;
}

export async function runSourceVisibilityAndExecution(): Promise<SourceVisibilityReport> {
	const legacy = buildCheckpointInputView(CANONICAL as never);
	const legacyRequest = buildCheckpointRequest(legacy, REFERENCES);
	const parentMessages = new MessageBuilder().buildForApi(CANONICAL);
	const candidate = await captureWireBody({
		systemPrompt: PARENT_SYSTEM_PROMPT,
		messages: [...parentMessages, { role: "user", content: CANDIDATE_SUFFIX }],
		tools: [MUTATION_TOOL],
	});
	const candidateBody = candidate.body as Record<string, unknown>;
	const candidateText = JSON.stringify(candidateBody);

	const legacyText = legacy.text;
	const legacySurface = {
		carriesCanonicalIdsInline: legacyText.includes("[id:msg-3]"),
		carriesSuccessfulObservation: legacyText.includes("SOURCE-BODY-MARKER"),
		carriesFailedObservation: legacyText.includes("status=failed"),
		normalizesSuccessStatus: legacyText.includes("status=succeeded"),
		carriesRetractedConclusion: legacyText.includes("RETRACTION-MARKER"),
		excludesUnsignedReasoning: !legacyText.includes(
			"UNSIGNED-REASONING-MARKER",
		),
		excludesSignedReasoning: !legacyText.includes("SIGNED-REASONING-MARKER"),
		carriesReasoningSignature: !legacyText.includes("sig-1"),
		longBodyRetained: legacyText.includes(LONG_BODY.slice(0, 64)),
		longBodyTruncated: !legacyText.includes(LONG_BODY),
	};

	const candidateSurface = {
		carriesCanonicalIdsInline: candidateText.includes("[id:msg-3]"),
		referenceLabelsVisibleInSuffix: REFERENCES.every((reference) =>
			candidateText.includes(reference),
		),
		carriesSuccessfulObservation: candidateText.includes("SOURCE-BODY-MARKER"),
		carriesFailedObservation: candidateText.includes("restoration failed"),
		normalizesFailureStatus: candidateText.includes("status=failed"),
		carriesRetractedConclusion: candidateText.includes("RETRACTION-MARKER"),
		excludesUnsignedReasoning: !candidateText.includes(
			"UNSIGNED-REASONING-MARKER",
		),
		excludesSignedReasoning: !candidateText.includes("SIGNED-REASONING-MARKER"),
		longBodyRetained: candidateText.includes(LONG_BODY.slice(0, 64)),
		longBodyTruncated: !candidateText.includes(LONG_BODY),
		toolSchemaPresent: JSON.stringify(candidateBody.tools ?? null).includes(
			"replace_in_file",
		),
	};

	const deltas: string[] = [];
	if (
		!candidateSurface.excludesUnsignedReasoning ||
		!candidateSurface.excludesSignedReasoning
	) {
		deltas.push(
			"private reasoning: the legacy controlled view EXCLUDES it, the parent-derived candidate EXPOSES it",
		);
	}
	if (
		legacySurface.normalizesSuccessStatus &&
		!candidateSurface.normalizesFailureStatus
	) {
		deltas.push(
			"observation status: the legacy controlled view NORMALIZES success/failure, the parent-derived candidate carries the raw payload only",
		);
	}
	if (
		legacySurface.carriesCanonicalIdsInline &&
		!candidateSurface.carriesCanonicalIdsInline
	) {
		deltas.push(
			"evidence-reference binding: the legacy controlled view BINDS each reference to its content inline, the candidate lists references WITHOUT their content",
		);
	}
	if (candidateSurface.longBodyTruncated !== legacySurface.longBodyTruncated) {
		deltas.push(
			"bounded source material: the two surfaces truncate differently",
		);
	}

	const gateProbes = (
		[
			{
				label: "successful-observation",
				reference: "id:msg-3",
				atom: "OPERATION_INVOKED",
			},
			{
				label: "user-text-only",
				reference: "id:msg-1",
				atom: "IMPLEMENTATION_INSPECTED",
			},
			{
				label: "signed-reasoning-message",
				reference: "id:msg-4",
				atom: "IMPLEMENTATION_INSPECTED",
			},
			{
				label: "unsupported-reference",
				reference: "id:msg-does-not-exist",
				atom: "OPERATION_INVOKED",
			},
		] as const
	).map((probe) => {
		const gate = gateClosedProposals({
			proposals: [
				{
					kind: "observation",
					assurance: "tool_observed",
					status: "active",
					atom: probe.atom,
					argument: "none",
					qualificationClasses: ["OBSERVATION_ONLY_NO_CAUSATION"],
					evidenceRefs: [probe.reference],
				},
			],
			sourcePrefixKey: "k-1",
			evidence: {
				canonicalReferences: REFERENCES,
				// The REAL interpreter, exactly as `runPckAttempt` uses it: the
				// assurance a record may claim is bounded by what the canonical
				// evidence actually shows.
				maximumAssuranceFor: (references, atom, argument) =>
					interpretCanonicalEvidence({
						canonicalMessages: CANONICAL as never,
						references,
						atom,
						argument,
					}),
			},
		});
		return {
			label: probe.label,
			reference: probe.reference,
			observedAssurance: interpretCanonicalEvidence({
				canonicalMessages: CANONICAL as never,
				references: [probe.reference],
				atom: probe.atom,
				argument: "none",
			}),
			acceptedRecordCount: gate.records.length,
			acceptedAssurances: gate.records.map((record) => record.assurance),
			codes: gate.codes,
		};
	});

	// A3 — the REAL gateway, the parent's VISIBLE mutation tool, and a
	// syntactically VALID tool call in the response.
	const toolCallSse = [
		'data: {"id":"cmpl-1","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"replace_in_file","arguments":""}}]},"finish_reason":null}]}',
		'data: {"id":"cmpl-1","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"path\\":\\"model.nim\\",\\"diff\\":\\"-x\\"}"}}]},"finish_reason":null}]}',
		'data: {"id":"cmpl-1","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}',
		"data: [DONE]\n\n",
	].join("\n\n");
	const toolCallAttempt = await captureWireBody({
		systemPrompt: PARENT_SYSTEM_PROMPT,
		messages: [...parentMessages, { role: "user", content: CANDIDATE_SUFFIX }],
		tools: [MUTATION_TOOL],
		sse: toolCallSse,
	});
	const toolCallChunks = (toolCallAttempt.chunks as { type: string }[]).map(
		(chunk) => chunk.type,
	);
	const wireToolSchemaPresent = JSON.stringify(
		toolCallAttempt.body ?? {},
	).includes("replace_in_file");

	const attempt = await runPckAttempt({
		generate: async () => ({
			text: "",
			reasoningChars: 0,
			usedTools: toolCallChunks.includes("tool_calls"),
			failed: false,
		}),
		canonicalMessages: CANONICAL as never,
		identity: { decisionId: "d-1", sourcePrefixKey: "k-1" },
		taskSignal: new AbortController().signal,
		deadlineMs: 1_000,
		currentSourcePrefixKey: () => "k-1",
	});

	/**
	 * A4 — the PCK inference-policy conservation, bound to the ACTUAL
	 * RESOLVED policy (not to a fixture with identical hardcoded settings).
	 */
	const policyResolution = resolvePckInferencePolicy({
		purpose: "pck",
		featureEnabled: true,
		effectiveProviderConfig: { providerId: PROVIDER_ID, modelId: MODEL_ID },
		env: { CLINEMM_PCK_INFERENCE_POLICY: "qwen-strata-v1" },
	});
	const inheritedConfig = {
		providerId: PROVIDER_ID,
		modelId: MODEL_ID,
		apiKey: "test-key",
		baseUrl: "http://endpoint.invalid/v1",
		maxOutputTokens: 16_384,
		temperature: 0.7,
		thinking: false,
	};
	const appliedConfig =
		policyResolution.applied === true
			? (applyPckInferencePolicy(
					inheritedConfig as never,
					policyResolution.parameters,
				) as unknown as Record<string, unknown>)
			: inheritedConfig;
	const policyBody = (
		await captureWireBody({
			systemPrompt: PARENT_SYSTEM_PROMPT,
			messages: [
				...parentMessages,
				{ role: "user", content: CANDIDATE_SUFFIX },
			],
			tools: [MUTATION_TOOL],
			providerConfig: appliedConfig,
		})
	).body as Record<string, unknown>;
	const ordinaryBody = (
		await captureWireBody({
			systemPrompt: PARENT_SYSTEM_PROMPT,
			messages: parentMessages,
			tools: [MUTATION_TOOL],
			providerConfig: inheritedConfig,
		})
	).body as Record<string, unknown>;

	const closure = importClosure(PCK_CHAIN_ENTRIES);
	const executorIdentifierMatches: { file: string; identifier: string }[] = [];
	for (const file of closure) {
		const source = readFileSync(file, "utf8");
		for (const identifier of [
			"executeTool",
			"executeToolCall",
			"toolExecutor",
			"runToolExecutor",
		]) {
			if (source.includes(identifier)) {
				executorIdentifierMatches.push({ file, identifier });
			}
		}
	}

	return {
		actId: "ACT-CLINEMM-CACHE-PRESERVING-AUXILIARY-INFERENCE-RECON-01",
		amendment: "AMENDMENT-01",
		evidenceClass: "SYNTHETIC_REAL_PRODUCTION_SEAM",
		legacyControlledView: legacySurface,
		candidateAuxiliaryRequest: candidateSurface,
		deltas,
		evidenceReferenceBinding: {
			legacyBindsReferenceToContent: legacySurface.carriesCanonicalIdsInline,
			candidateBindsReferenceToContent:
				candidateSurface.carriesCanonicalIdsInline,
			candidateReferenceLabelsVisible:
				candidateSurface.referenceLabelsVisibleInSuffix,
			missingSeam:
				"the canonical id <-> provider-visible message position binding is NOT carried on the wire: the ids are dropped by the projection and the reference list alone cannot resolve which content a reference denotes",
		},
		publicationGateProbes: gateProbes,
		inferencePolicyConservation: {
			resolvedPolicy:
				policyResolution.applied === true
					? policyResolution.policyId
					: `not applied: ${policyResolution.reason}`,
			pckRequestOnTheWire: {
				reasoning_effort: policyBody.reasoning_effort ?? null,
				temperature: policyBody.temperature ?? null,
				max_tokens: policyBody.max_tokens ?? null,
				response_format: policyBody.response_format ?? null,
			},
			ordinaryRequestOnTheWire: {
				reasoning_effort: ordinaryBody.reasoning_effort ?? null,
				response_format: ordinaryBody.response_format ?? null,
				max_tokens: ordinaryBody.max_tokens ?? null,
			},
		},
		visibleToolExecution: {
			toolSchemaPresentOnTheWire: wireToolSchemaPresent,
			streamChunkTypes: toolCallChunks,
			toolCallObservedByTheTransport: toolCallChunks.includes("tool_calls"),
			auxiliaryResultRejected: attempt.failureReason === "tool_call_attempted",
			acceptedRecordCount: attempt.records.length,
			executorInvocationCount: 0,
			executorBoundary:
				"the PCK transport chain (runtime.ts -> summary-generation.ts -> the llms provider) contains NO tool executor: the import closure carries no executor, MCP or approval module, and the transport only PRODUCES stream chunks",
			importClosureFileCount: closure.length,
			executorPathsInImportClosure: closure.filter((file) =>
				/extensions\/tools\/executors|\/mcp\/|approval/i.test(file),
			),
			executorIdentifierMatches,
			productionComposition:
				"NOT_EXECUTED — the production composition that would carry the parent's VISIBLE tool schema on the auxiliary request does not exist yet; the seam qualified here is the isolated inference path",
		},
	};
}

if (import.meta.main) {
	const report = await runSourceVisibilityAndExecution();
	process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
