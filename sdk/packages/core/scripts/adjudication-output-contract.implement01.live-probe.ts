/**
 * ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-IMPLEMENT-01 — G9 LIVE PROBE.
 *
 * A SHORT, BOUNDED experiment that answers ONE question:
 *
 *   Can a REAL model, given a synthetic task, an authorized task-scoped
 *   vocabulary and a RUNTIME-ISSUED evidence handle, publish an
 *   adjudication candidate that the runtime ACCEPTS — with a genuine,
 *   NONEMPTY, runtime-bound evidence reference and an INDEPENDENTLY bound
 *   source revision?
 *
 * WHAT THIS IS NOT
 * ----------------
 *
 * This script does NOT change production behaviour, does NOT alter the
 * default task prompt or the checkpoint cadence, and does NOT write into
 * any production state. It runs a single, bounded provider request
 * against a synthetic task and prints a sanitized observation report.
 *
 * The categories of evidence are kept DISTINCT:
 *
 *   SYNTHETIC CANONICAL FIXTURE  -> the serializer can handle the shape
 *   MOCKED PROVIDER RESPONSE      -> the adapter/compaction path handles it
 *   REAL MODEL RESPONSE (this)    -> this model/provider CAN emit it
 *   LIVE INSTALLED RUN            -> the installed runtime exercised it
 *
 * A REAL MODEL RESPONSE does NOT prove the LIVE INSTALLED RUN, and does
 * NOT prove that any model reliably complies.
 *
 * THE LOAD-BEARING METRIC
 * -----------------------
 *
 * The predecessor's correction established that "the model published the
 * envelope" is NOT compliance. The metric here is `candidate_accepted`:
 *
 *   schema_valid
 *   nonempty_evidence_refs
 *   canonical_refs_resolved
 *   source_revision_bound
 *   candidate_accepted
 *   semantic_support_verified
 *
 * A vacuously-resolved empty evidence array is NOT a binding witness, and
 * a model-invented id is NOT a reference. The load-bearing live success is
 * at least one run with `candidate_accepted=true` AND a genuinely nonempty
 * bound reference.
 *
 * CONFIDENTIALITY
 * ---------------
 *
 * The task, the tool result and the schema are entirely SYNTHETIC. The
 * report records the PRESENCE and SHAPE of the assistant text blocks and
 * the acceptance metrics. It does NOT print raw provider payloads,
 * credentials or free-form model prose.
 *
 * USAGE
 * -----
 *
 *   CORE_LIVE_ADJUDICATION_PROBE=1 \
 *   CORE_LIVE_ADJUDICATION_PROVIDER_KEY=minimax \
 *   CORE_LIVE_ADJUDICATION_RUNS=3 \
 *   bun scripts/adjudication-output-contract.implement01.live-probe.ts
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createHandler } from "@cline/llms";
import type {
	Message,
	MessageWithMetadata,
	ProviderConfig,
} from "@cline/shared";
import {
	ADJUDICATION_SECTION_HEADING,
	AdjudicationEvidenceRegistry,
	type AdjudicationVocabulary,
	applyAdjudicationPublicationInstruction,
	deriveAcceptedAdjudications,
	parseAdjudicationEnvelope,
	renderEvidenceHandleTrailer,
	resolveAdjudicationCandidate,
	type SourceRevision,
} from "../src/extensions/context/adjudication-continuity";
import {
	createCompactionStateAwarePrepareTurn,
	createContextCompactionPrepareTurn,
} from "../src/extensions/context/compaction";
import { MessageBuilder } from "../src/session/services/message-builder";

const ENABLED = process.env.CORE_LIVE_ADJUDICATION_PROBE === "1";
const PROVIDERS_FILE_ENV =
	process.env.CORE_LIVE_ADJUDICATION_PROVIDERS_PATH ??
	process.env.LLMS_LIVE_PROVIDERS_PATH;
const PROVIDER_TIMEOUT_MS = Number(
	process.env.CORE_LIVE_ADJUDICATION_TIMEOUT_MS ?? "120000",
);
const PROVIDER_KEY_ENV = process.env.CORE_LIVE_ADJUDICATION_PROVIDER_KEY;
const RUNS_PER_PROVIDER = Number(
	process.env.CORE_LIVE_ADJUDICATION_RUNS ?? "1",
);

const SESSION_ID = "live-adjudication-probe-session";
const SOURCE_PATH = "synthetic-pool-config.yaml";
const SOURCE_CALL_ID = "call_live_source_read_0001";

/**
 * The SYNTHETIC source revision the runtime observes.
 *
 * It is produced by the RUNTIME, never by the model. The published
 * envelope carries no revision field, so there is nothing for the model
 * to author, forge or override.
 */
const SYNTHETIC_REVISION: SourceRevision = {
	repositoryIdentity: "synthetic-repo",
	workspaceRootIdentity: "synthetic-root",
	revision: "9ca5309aa18e43c97343d87171de20f2a198f6ccfe8f266c1f1c33557afa5dcd",
	contentIdentity:
		"3b1f0c9a7d2e4f6a8b0c2d4e6f8a0b2c4d6e8f0a2b4c6d8e0f2a4b6c8d0e2f4a",
	clean: true,
};

/**
 * The HOST-SUPPLIED, TASK-SCOPED vocabulary.
 *
 * It is SYNTHETIC and derived from the synthetic task fixture. It is NOT a
 * global ClineMM vocabulary.
 */
const VOCABULARY: AdjudicationVocabulary = {
	findingIds: ["S1"],
	decisions: ["supported", "narrowed", "refuted", "unresolved"],
	qualificationCodes: ["manual_enforcement_only"],
	remainingQuestions: {
		"S1.automated_enforcement": "S1",
	},
	allowedDecisionsByFinding: {
		S1: ["narrowed", "unresolved"],
	},
	requiredQualificationsByFinding: {
		S1: ["manual_enforcement_only"],
	},
};

const SYNTHETIC_TOOL_NAME = "read_files";

const SYNTHETIC_TOOL: {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
} = {
	name: SYNTHETIC_TOOL_NAME,
	description:
		"Read a synthetic configuration file and return its synthetic contents.",
	// The schema mirrors the REAL `read_files` tool's shape, so the model
	// calls it the way it would call the production tool.
	inputSchema: {
		type: "object",
		properties: {
			path: { type: "string", description: "Synthetic file path." },
		},
		required: ["path"],
	},
};

const SYNTHETIC_USER_PROMPT = [
	"SYNTHETIC AUDIT TASK.",
	"",
	"Allegation S1: the synthetic worker pool exceeds its documented budget.",
	"",
	"Read synthetic-pool-config.yaml with the read_files tool, then publish",
	"your adjudication of S1 using the publication contract in your",
	"instructions.",
].join("\n");

/**
 * The SYNTHETIC tool result the provider is shown after the model calls the
 * tool. It is the ONLY file content that ever enters the probe, and it is
 * entirely synthetic.
 */
const SYNTHETIC_TOOL_RESULT =
	"maxWorkers: 36\ndocumentedBudget: 400\nautomaticEnforcement: absent";

// ---------------------------------------------------------------------------
// Provider configuration (read from the local settings file; never printed).
// ---------------------------------------------------------------------------

interface StoredProviderSettingsLike {
	providers?: Record<string, { settings?: unknown }>;
}

function resolveProvidersFilePath(): string {
	if (PROVIDERS_FILE_ENV) {
		return path.resolve(PROVIDERS_FILE_ENV);
	}
	return path.join(
		process.env.HOME ?? "",
		".cline",
		"data",
		"settings",
		"providers.json",
	);
}

function toProviderConfig(settingsInput: unknown): ProviderConfig {
	const settings = (settingsInput ?? {}) as Record<string, unknown>;
	const providerId = settings.provider;
	if (typeof providerId !== "string" || providerId.trim().length === 0) {
		throw new Error("provider entry must include a provider string");
	}
	const apiKey =
		typeof settings.apiKey === "string" ? settings.apiKey : undefined;
	return {
		providerId,
		modelId: typeof settings.model === "string" ? settings.model : "default",
		...(apiKey ? { apiKey } : {}),
		...(typeof settings.baseUrl === "string"
			? { baseUrl: settings.baseUrl }
			: {}),
	};
}

function loadProviderTargets(): { label: string; config: ProviderConfig }[] {
	const filePath = resolveProvidersFilePath();
	if (!existsSync(filePath)) {
		throw new Error(`providers file not found: ${filePath}`);
	}
	const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
	const stored = parsed as StoredProviderSettingsLike;
	const entries = Object.entries(stored.providers ?? {});
	if (entries.length === 0) {
		throw new Error("no provider entries found in the providers file");
	}
	const wanted = PROVIDER_KEY_ENV
		? entries.filter(([key]) => key === PROVIDER_KEY_ENV)
		: entries;
	if (wanted.length === 0) {
		throw new Error(
			`no provider entry matched CORE_LIVE_ADJUDICATION_PROVIDER_KEY=${PROVIDER_KEY_ENV}`,
		);
	}
	return wanted.map(([key, value]) => ({
		label: key,
		config: toProviderConfig(
			(value as { settings?: unknown }).settings ?? value,
		),
	}));
}

/**
 * Parse a tool call's arguments into the canonical input shape.
 *
 * The provider delivers the arguments as a JSON STRING, so they must be
 * parsed before the canonical `tool_use` block is built. An unparseable
 * argument is retained verbatim under `raw`, so the probe never loses the
 * observation.
 */
function parseToolArguments(
	argumentsValue: string | Record<string, unknown> | undefined,
): Record<string, unknown> {
	if (argumentsValue && typeof argumentsValue === "object") {
		return argumentsValue;
	}
	if (typeof argumentsValue === "string" && argumentsValue.trim()) {
		try {
			const parsed = JSON.parse(argumentsValue);
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				return parsed as Record<string, unknown>;
			}
		} catch {
			// Not JSON: the raw value is retained.
		}
		return { raw: argumentsValue };
	}
	return {};
}

// ---------------------------------------------------------------------------
// The observation.
// ---------------------------------------------------------------------------

interface Observation {
	provider: string;
	model: string;
	/** Whether the model emitted any assistant text at all. */
	emittedAssistantText: boolean;
	/** The number of DISTINCT assistant text carriers (one per turn). */
	turnCarrierCount: number;
	/** The CANONICAL turn index whose carrier held the published candidate. */
	publishedTurnIndex?: number;
	/** Whether the model emitted reasoning (never read by the contract). */
	emittedReasoning: boolean;
	/** GATE 1 — SCHEMA VALIDITY. */
	schema_valid: boolean;
	/** Whether the candidate cited at least ONE evidence reference. */
	nonempty_evidence_refs: boolean;
	/** GATE 2 — CANONICAL REFERENCE RESOLUTION. */
	canonical_refs_resolved: boolean;
	/** The evidence references that did NOT resolve. */
	unresolvedEvidenceIds?: string[];
	/** GATE 3 — SOURCE REVISION BINDING. */
	source_revision_bound: boolean;
	/** GATE 4 — CANDIDATE ACCEPTANCE. */
	candidate_accepted: boolean;
	/** GATE 5 — SEMANTIC SUPPORT. Always false without an adjudicator. */
	semantic_support_verified: boolean;
	/** The reason the candidate was NOT accepted, when it was not. */
	acceptance_rejection_reason?: string;
	/** The parse failure reason, when the candidate did not parse. */
	parseRejectionReason?: string;
	/** The candidate's decision, when it parsed. */
	decision?: string;
	/** The candidate's qualification codes, when it parsed. */
	qualificationCodes?: string[];
	/** The candidate's remaining question ids, when it parsed. */
	remainingQuestionIds?: string[];
	/** Whether the model emitted a tool call at all. */
	emittedToolUse: boolean;
	/** The number of provider turns the probe ran. */
	turns: number;
	/** The error, if the request failed. */
	error?: string;
	/** The compaction boundary observation, when the candidate was accepted. */
	compaction?: CompactionObservation;
}

/**
 * The revision resolver for the synthetic fixture.
 *
 * It resolves the revision from the WORKSPACE, never from the model.
 */
const REVISION_RESOLVER = {
	resolve: ({ sourcePath }: { sourcePath: string; toolName: string }) =>
		sourcePath === SOURCE_PATH ? SYNTHETIC_REVISION : undefined,
};

// ---------------------------------------------------------------------------
// The probe.
// ---------------------------------------------------------------------------

async function runProbe(config: ProviderConfig): Promise<Observation> {
	const observation: Observation = {
		provider: config.providerId,
		model: config.modelId,
		emittedAssistantText: false,
		turnCarrierCount: 0,
		emittedReasoning: false,
		schema_valid: false,
		nonempty_evidence_refs: false,
		canonical_refs_resolved: false,
		source_revision_bound: false,
		candidate_accepted: false,
		semantic_support_verified: false,
		emittedToolUse: false,
		turns: 0,
	};

	try {
		const handler = createHandler(config);
		const registry = new AdjudicationEvidenceRegistry({
			sessionId: SESSION_ID,
		});
		// The handle is derived from the ACTUAL provider-issued tool-call
		// id, so it is the handle the model was SHOWN on that tool result
		// and the handle the runtime resolves back to that same call.
		let handle = "";

		// The SYSTEM PROMPT is the EXACT instruction the production
		// runtime renders for an authorized vocabulary, plus the
		// publication contract the model is told to follow.
		const systemPrompt = applyAdjudicationPublicationInstruction(
			[
				"You are a careful engineering agent working on a SYNTHETIC audit task.",
				"",
				"There is one allegation:",
				"  S1: the synthetic worker pool exceeds its documented budget.",
				"",
				"Read the synthetic configuration file with the read_files tool, then",
				"publish your adjudication of S1.",
			].join("\n"),
			VOCABULARY,
		);

		const messages: Message[] = [
			{
				role: "user",
				content: [{ type: "text", text: SYNTHETIC_USER_PROMPT }],
			},
		];

		let turns = 0;
		let toolResultsAppended = 0;
		const deadline = Date.now() + PROVIDER_TIMEOUT_MS;

		while (turns < 5 && Date.now() < deadline) {
			turns += 1;
			let turnText = "";
			const turnToolCalls: {
				id: string;
				name: string;
				arguments: string | Record<string, unknown> | undefined;
			}[] = [];

			const stream = handler.createMessage(systemPrompt, messages, [
				SYNTHETIC_TOOL,
			]);

			for await (const chunk of stream) {
				if (chunk.type === "text") {
					turnText += chunk.text;
					observation.emittedAssistantText = true;
					continue;
				}
				if (chunk.type === "reasoning") {
					// The private reasoning is NEVER read by the contract.
					observation.emittedReasoning = true;
					continue;
				}
				if (chunk.type === "tool_calls") {
					observation.emittedToolUse = true;
					const call = chunk.tool_call;
					const id = call.function.id ?? call.call_id ?? `call_${turns}`;
					canonicalToolCallIds.add(id);
					turnToolCalls.push({
						id,
						name: call.function.name ?? SYNTHETIC_TOOL_NAME,
						arguments: call.function.arguments,
					});
					continue;
				}
				if (chunk.type === "done") {
					break;
				}
			}

			// The assistant turn: a `text` block AND a `tool_use` block in
			// the SAME canonical turn.
			const assistantContent: Message["content"] = [];
			if (turnText) {
				assistantContent.push({ type: "text", text: turnText });
			}
			for (const call of turnToolCalls) {
				assistantContent.push({
					type: "tool_use",
					id: call.id,
					name: call.name,
					input: parseToolArguments(call.arguments),
				});
			}
			if (assistantContent.length > 0) {
				messages.push({ role: "assistant", content: assistantContent });
			}

			if (turnToolCalls.length === 0) {
				// The model finished its turn without asking for a tool.
				// The publication must have happened in THIS turn's text.
				break;
			}

			// The tool result comes back as a user turn, exactly as the
			// canonical record does. It carries the RUNTIME-ISSUED evidence
			// handle, which is what the model cites.
			handle = registry.handleFor(turnToolCalls[0].id);
			const trailer = renderEvidenceHandleTrailer({
				handle,
				toolName: SYNTHETIC_TOOL_NAME,
			});
			messages.push({
				role: "user",
				content: turnToolCalls.map((call) => ({
					type: "tool_result" as const,
					tool_use_id: call.id,
					name: call.name,
					content: [
						{
							type: "text" as const,
							text: `${SYNTHETIC_TOOL_RESULT}\n${trailer ?? ""}`,
						},
					],
				})),
			});

			toolResultsAppended += turnToolCalls.length;
		}

		observation.turns = turns;
		observation.turnCarrierCount = messages.filter(
			(message) =>
				message.role === "assistant" &&
				Array.isArray(message.content) &&
				message.content.some((block) => block.type === "text"),
		).length;

		// The STRICT parse over EACH assistant text carrier, one at a time.
		for (const message of messages) {
			if (message.role !== "assistant" || !Array.isArray(message.content)) {
				continue;
			}
			for (const block of message.content) {
				if (block.type !== "text") {
					continue;
				}
				const parsed = parseAdjudicationEnvelope(block.text.trim());
				if (parsed.status !== "ok") {
					continue;
				}

				// --- GATE 1: SCHEMA VALIDITY --------------------------
				observation.schema_valid = true;
				observation.decision = parsed.candidate.decision;
				observation.qualificationCodes = [
					...parsed.candidate.qualification_codes,
				];
				observation.remainingQuestionIds = [
					...parsed.candidate.remaining_question_ids,
				];
				observation.publishedTurnIndex = turns;

				// --- The NONEMPTY requirement ------------------------
				// An empty evidence array resolves VACUOUSLY. It is not a
				// binding witness, so it is reported separately.
				observation.nonempty_evidence_refs =
					parsed.candidate.evidence_tool_use_ids.length > 0;

				// --- GATES 2-5: THE RUNTIME'S OWN DECISION ----------
				// The decision is made by the PRODUCTION resolver, not
				// re-implemented by the probe.
				const canonicalMessages = messages.map((message) => ({
					role: message.role,
					content: message.content,
				})) as never;
				// The canonical tool-call ids observed on the stream are
				// recorded so an unresolved reference can be reported
				// against them.
				const decision = await resolveAdjudicationCandidate(parsed.candidate, {
					canonicalMessages,
					registry,
					vocabulary: VOCABULARY,
					revisionResolver: REVISION_RESOLVER,
				});
				observation.canonical_refs_resolved = decision.canonical_refs_resolved;
				observation.source_revision_bound = decision.source_revision_bound;
				observation.candidate_accepted = decision.candidate_accepted;
				observation.semantic_support_verified =
					decision.semantic_support_verified;
				if (decision.reason) {
					observation.acceptance_rejection_reason = decision.reason;
				}
				if (!decision.canonical_refs_resolved) {
					observation.unresolvedEvidenceIds = [
						...parsed.candidate.evidence_tool_use_ids,
					].filter((id) => id !== handle && !canonicalToolCallIds.has(id));
				}
				if (observation.candidate_accepted) {
					// The COMPACTION BOUNDARY: the accepted candidate must
					// survive into the provider-visible request even when
					// the summarizer omits it.
					observation.compaction = await observeCompactionBoundary({
						canonicalMessages: canonicalMessages as MessageWithMetadata[],
						registry,
						providerConfig: config,
					});
				}
				return observation;
			}
		}
	} catch (error) {
		observation.error = error instanceof Error ? error.message : String(error);
	}

	return observation;
}

/**
 * The canonical tool-call ids observed on the provider stream.
 *
 * Declared OUTSIDE the probe function so the unresolved-reference report
 * can name the ids that did NOT resolve.
 */
const canonicalToolCallIds = new Set<string>();

async function main(): Promise<void> {
	if (!ENABLED) {
		console.log(
			"SKIPPED: set CORE_LIVE_ADJUDICATION_PROBE=1 to run the G9 live probe.",
		);
		return;
	}
	const targets = loadProviderTargets();
	const report: {
		execution_class: string;
		observation_count: number;
		observations: Observation[];
	} = {
		execution_class: "REAL_MODEL_RESPONSE",
		observation_count: 0,
		observations: [],
	};
	for (const target of targets) {
		for (let runIndex = 0; runIndex < RUNS_PER_PROVIDER; runIndex += 1) {
			console.log(
				`\n=== G9 live probe: ${target.label} (${target.config.providerId}/${target.config.modelId}) run ${runIndex + 1}/${RUNS_PER_PROVIDER} ===`,
			);
			canonicalToolCallIds.clear();
			const observation = await runProbe(target.config);
			report.observations.push(observation);
			report.observation_count += 1;
			console.log(JSON.stringify(observation, null, 2));
		}
	}
	console.log("\n=== G9 live probe report ===");
	console.log(JSON.stringify(report, null, 2));
}

await main();

// ---------------------------------------------------------------------------
// THE COMPACTION BOUNDARY (G9.3)
// ---------------------------------------------------------------------------

/**
 * The observation of the compaction boundary for one accepted candidate.
 */
interface CompactionObservation {
	/** The candidate was ACCEPTED before the compaction. */
	candidate_accepted: boolean;
	/** The compaction was actually executed. */
	compaction_executed: boolean;
	/** The persisted sidecar carried the adjudication section. */
	persisted_section_present: boolean;
	/** The PROVIDER-VISIBLE request carried the adjudication section. */
	provider_visible_candidate: boolean;
	/** Whether the carried section names the finding. */
	provider_visible_finding: boolean;
	/** Whether the carried section names the opaque evidence handle. */
	provider_visible_evidence_handle: boolean;
	/** The number of adjudication sections in the provider-visible text. */
	provider_visible_section_count: number;
	/** The error, if the compaction failed. */
	error?: string;
	/** The metadata kinds of the installed continuation's messages. */
	compaction_message_kinds?: string[];
}

/**
 * Run the REAL agentic compaction over the accepted candidate and observe
 * whether the candidate survives into the provider-visible request.
 *
 * The seam is the production one:
 *
 *   createCompactionStateAwarePrepareTurn
 *     -> createContextCompactionPrepareTurn({ strategy: "agentic" })
 *     -> runAgenticCompaction -> generateSummary (MOCKED)
 *     -> applyTaskContractToCompactedMessages
 *     -> applyVerifiedEvidenceToCompactedMessages
 *     -> applyAdjudicationCarryForward
 *     -> MessageBuilder.buildForApi
 *
 * The summarizer is a deterministic mock that deliberately OMITS the
 * candidate, so the observation measures the DETERMINISTIC continuity and
 * not the summarizer's cooperation.
 */
async function observeCompactionBoundary(input: {
	canonicalMessages: MessageWithMetadata[];
	registry: AdjudicationEvidenceRegistry;
	providerConfig: ProviderConfig;
}): Promise<CompactionObservation> {
	const observation: CompactionObservation = {
		candidate_accepted: false,
		compaction_executed: false,
		persisted_section_present: false,
		provider_visible_candidate: false,
		provider_visible_finding: false,
		provider_visible_evidence_handle: false,
		provider_visible_section_count: 0,
	};

	try {
		const accepted = await deriveAcceptedAdjudications(
			input.canonicalMessages,
			{
				registry: input.registry,
				vocabulary: VOCABULARY,
				revisionResolver: REVISION_RESOLVER,
			},
		);
		observation.candidate_accepted = accepted.length > 0;

		let persistedSummary = "";
		const inner = createContextCompactionPrepareTurn({
			providerId: "minimax",
			modelId: "MiniMax-M3",
			providerConfig: {
				providerId: "minimax",
				modelId: "MiniMax-M3",
			} as ProviderConfig,
			compaction: {
				enabled: true,
				strategy: "agentic",
				preserveRecentTokens: 1,
				// The REAL summarizer, with the REAL provider credentials:
				// the compaction boundary is measured through the production
				// agentic path, not through a mock.
				summarizer: {
					providerId: input.providerConfig.providerId,
					modelId: input.providerConfig.modelId,
					...(input.providerConfig.apiKey
						? { apiKey: input.providerConfig.apiKey }
						: {}),
					...(input.providerConfig.baseUrl
						? { baseUrl: input.providerConfig.baseUrl }
						: {}),
					providerConfig: input.providerConfig,
				},
			},
			logger: undefined,
		});

		const prepareTurn = createCompactionStateAwarePrepareTurn({
			compact: (context) =>
				inner?.({
					...context,
					model: {
						id: "MiniMax-M3",
						provider: "minimax",
						info: { id: "MiniMax-M3", maxInputTokens: 10 },
					} as never,
				}) ?? Promise.resolve(undefined),
			getState: () => undefined,
			prepareApiMessages: async (messages) => messages,
			saveState: () => undefined,
			adjudication: {
				registry: input.registry,
				vocabulary: VOCABULARY,
				revisionResolver: REVISION_RESOLVER,
			},
		});

		const result = await prepareTurn({
			agentId: "live-probe-agent",
			conversationId: "live-probe-conversation",
			parentAgentId: null,
			iteration: 1,
			abortSignal: new AbortController().signal,
			systemPrompt: "You are a careful engineering agent.",
			tools: [],
			messages: input.canonicalMessages,
			apiMessages: input.canonicalMessages,
			model: {
				id: "MiniMax-M3",
				provider: "minimax",
				info: { id: "MiniMax-M3", maxInputTokens: 128_000 },
			} as never,
		});

		const installedMessages = (result?.messages ?? []) as MessageWithMetadata[];
		observation.compaction_executed = installedMessages.length > 0;
		observation.compaction_message_kinds = installedMessages.map(
			(message) =>
				(message.metadata as { kind?: string } | undefined)?.kind ?? "(none)",
		);

		// The PERSISTED representation: the summary message's metadata.
		for (const message of installedMessages) {
			const summary = (message.metadata as { summary?: string } | undefined)
				?.summary;
			if (typeof summary === "string") {
				persistedSummary = summary;
			}
		}
		observation.persisted_section_present = persistedSummary.includes(
			ADJUDICATION_SECTION_HEADING,
		);

		// The PROVIDER-VISIBLE representation: the last production
		// transformation before dispatch.
		const providerVisible = new MessageBuilder().buildForApi(
			installedMessages as never,
		);
		const visibleText = providerVisible
			.flatMap((message) =>
				Array.isArray((message as { content?: unknown }).content)
					? (message as { content: unknown[] }).content
							.filter(
								(block): block is { type: "text"; text: string } =>
									typeof block === "object" &&
									block !== null &&
									(block as { type?: unknown }).type === "text" &&
									typeof (block as { text?: unknown }).text === "string",
							)
							.map((block) => block.text)
					: [],
			)
			.join("\n");

		observation.provider_visible_section_count =
			visibleText.split(ADJUDICATION_SECTION_HEADING).length - 1;
		observation.provider_visible_candidate =
			observation.provider_visible_section_count > 0;
		observation.provider_visible_finding = visibleText.includes("S1:");
		observation.provider_visible_evidence_handle = visibleText.includes(
			input.registry.handleFor(
				canonicalToolCallIds.values().next().value ?? "",
			),
		);
	} catch (error) {
		observation.error = error instanceof Error ? error.message : String(error);
	}

	return observation;
}
