/**
 * ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-PROBE-01 — G6 LIVE MODEL PROBE.
 *
 * A SHORT, BOUNDED experiment that answers ONE question:
 *
 *   Can a REAL model, given a synthetic task and a deliberately requested
 *   adjudication output, EMIT a structured, schema-valid adjudication
 *   candidate in an assistant `text` block, and CONTINUE with normal tool
 *   use afterwards?
 *
 * WHAT THIS IS NOT
 * ----------------
 *
 * This script does NOT change production behaviour, does NOT alter the
 * default Round C task prompt or the checkpoint cadence, and does NOT
 * write into any production state. It runs a single, bounded provider
 * request against a synthetic task and prints a sanitized observation
 * report.
 *
 * The categories of evidence are kept DISTINCT (see the ACT's G6):
 *
 *   SYNTHETIC CANONICAL FIXTURE  -> the serializer can handle the shape
 *   MOCKED PROVIDER RESPONSE      -> the adapter/compaction path handles it
 *   REAL MODEL RESPONSE (this)    -> this model/provider CAN emit it
 *   LIVE INSTALLED RUN            -> the installed runtime exercised it
 *
 * A REAL MODEL RESPONSE does NOT prove the LIVE INSTALLED RUN, and does
 * NOT prove that any model reliably complies.
 *
 * CONFIDENTIALITY
 * ---------------
 *
 * The task, the tool result and the schema are entirely SYNTHETIC. The
 * report records the PRESENCE and SHAPE of the assistant text blocks and
 * whether a candidate PARSES under the strict contract. It does NOT print
 * raw provider payloads, credentials or free-form model prose.
 *
 * USAGE
 * -----
 *
 *   CORE_LIVE_ADJUDICATION_PROBE=1 \
 *   CORE_LIVE_ADJUDICATION_PROVIDERS_PATH=~/.cline/data/settings/providers.json \
 *   bun sdk/packages/core/scripts/adjudication-output-contract.live-probe.ts
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createHandler } from "@cline/llms";
import type { Message, ProviderConfig } from "@cline/shared";

const ENABLED = process.env.CORE_LIVE_ADJUDICATION_PROBE === "1";
const PROVIDERS_FILE_ENV =
	process.env.CORE_LIVE_ADJUDICATION_PROVIDERS_PATH ??
	process.env.LLMS_LIVE_PROVIDERS_PATH;
const PROVIDER_TIMEOUT_MS = Number(
	process.env.CORE_LIVE_ADJUDICATION_TIMEOUT_MS ?? "120000",
);
const PROVIDER_KEY_ENV = process.env.CORE_LIVE_ADJUDICATION_PROVIDER_KEY;

// ---------------------------------------------------------------------------
// The test-local contract, MIRRORED from the probe test file.
//
// It is duplicated here on purpose: this script must not import a `*.test.ts`
// module, and the contract is TEST-LOCAL in both places. The two copies are
// bound by the identical field set, enums and bounds.
// ---------------------------------------------------------------------------

const ENVELOPE_KIND = "adjudication_candidate";
const ENVELOPE_SCHEMA_VERSION = 1;
const FINDING_IDS = ["S1", "S2", "S3"] as const;
const DECISIONS = ["supported", "narrowed", "refuted", "unresolved"] as const;
const QUALIFICATION_CODES = [
	"manual_enforcement_only",
	"independently_observed_contradiction",
	"source_evidence_missing",
] as const;
const MAX_ENVELOPE_ARRAY_ENTRIES = 8;
const MAX_ENVELOPE_CHARS = 2_000;

interface ParsedCandidate {
	finding_id: string;
	decision: string;
	qualification_codes: string[];
	evidence_tool_use_ids: string[];
	counterevidence_tool_use_ids: string[];
	remaining_question_ids: string[];
}

function parseAdjudicationEnvelope(
	carrierText: string,
): { ok: true; candidate: ParsedCandidate } | { ok: false; reason: string } {
	if (typeof carrierText !== "string" || carrierText.length === 0) {
		return { ok: false, reason: "empty_carrier" };
	}
	if (carrierText.length > MAX_ENVELOPE_CHARS) {
		return { ok: false, reason: "carrier_too_large" };
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(carrierText);
	} catch {
		return { ok: false, reason: "malformed_json" };
	}
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		return { ok: false, reason: "not_an_object" };
	}
	const record = parsed as Record<string, unknown>;
	const allowed = new Set([
		"kind",
		"schema_version",
		"finding_id",
		"decision",
		"qualification_codes",
		"evidence_tool_use_ids",
		"counterevidence_tool_use_ids",
		"remaining_question_ids",
	]);
	for (const key of Object.keys(record)) {
		if (!allowed.has(key)) {
			return { ok: false, reason: `unknown_field:${key}` };
		}
	}
	for (const key of allowed) {
		if (!(key in record)) {
			return { ok: false, reason: `missing_field:${key}` };
		}
	}
	if (record.kind !== ENVELOPE_KIND) {
		return { ok: false, reason: "wrong_kind" };
	}
	if (record.schema_version !== ENVELOPE_SCHEMA_VERSION) {
		return { ok: false, reason: "unsupported_schema_version" };
	}
	if (
		typeof record.finding_id !== "string" ||
		!FINDING_IDS.includes(record.finding_id as (typeof FINDING_IDS)[number])
	) {
		return { ok: false, reason: "unknown_finding_id" };
	}
	if (
		typeof record.decision !== "string" ||
		!DECISIONS.includes(record.decision as (typeof DECISIONS)[number])
	) {
		return { ok: false, reason: "invalid_decision" };
	}
	for (const field of [
		"qualification_codes",
		"evidence_tool_use_ids",
		"counterevidence_tool_use_ids",
		"remaining_question_ids",
	] as const) {
		const value = record[field];
		if (!Array.isArray(value)) {
			return { ok: false, reason: `not_an_array:${field}` };
		}
		if (value.length > MAX_ENVELOPE_ARRAY_ENTRIES) {
			return { ok: false, reason: `array_too_large:${field}` };
		}
		for (const entry of value) {
			if (typeof entry !== "string") {
				return { ok: false, reason: `non_string_entry:${field}` };
			}
		}
	}
	for (const code of record.qualification_codes as string[]) {
		if (
			!QUALIFICATION_CODES.includes(
				code as (typeof QUALIFICATION_CODES)[number],
			)
		) {
			return { ok: false, reason: `unknown_qualification_code:${code}` };
		}
	}
	return {
		ok: true,
		candidate: {
			finding_id: record.finding_id as string,
			decision: record.decision as string,
			qualification_codes: record.qualification_codes as string[],
			evidence_tool_use_ids: record.evidence_tool_use_ids as string[],
			counterevidence_tool_use_ids:
				record.counterevidence_tool_use_ids as string[],
			remaining_question_ids: record.remaining_question_ids as string[],
		},
	};
}

// ---------------------------------------------------------------------------
// The SYNTHETIC task and tool.
// ---------------------------------------------------------------------------

const SYNTHETIC_TOOL_NAME = "read_files";

const SYNTHETIC_TOOL: {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
} = {
	name: SYNTHETIC_TOOL_NAME,
	description:
		"Read a synthetic configuration file and return its synthetic contents.",
	inputSchema: {
		type: "object",
		properties: {
			path: { type: "string", description: "Synthetic file path." },
		},
		required: ["path"],
	},
};

const SYSTEM_PROMPT = [
	"You are a careful engineering agent working on a SYNTHETIC audit task.",
	"",
	"There are three allegations:",
	"  S1: the synthetic worker pool exceeds its documented budget.",
	"  S2: the synthetic request timeout is unbounded.",
	"  S3: the synthetic retry policy is undocumented.",
	"",
	"Read the synthetic configuration file with the read_files tool, then",
	"publish your adjudication.",
	"",
	"PUBLICATION CONTRACT (required):",
	"After you have read the configuration, publish EXACTLY ONE JSON object",
	"as your own assistant text output (NOT inside a tool call and NOT inside",
	"your reasoning). The JSON object must have EXACTLY these fields:",
	'  kind            = "adjudication_candidate"',
	"  schema_version  = 1",
	'  finding_id      = one of "S1", "S2", "S3"',
	'  decision        = one of "supported", "narrowed", "refuted", "unresolved"',
	"  qualification_codes = a list drawn from exactly these values:",
	'                     "manual_enforcement_only",',
	'                     "independently_observed_contradiction",',
	'                     "source_evidence_missing"',
	"  evidence_tool_use_ids          = the list of the tool-call ids you used as evidence",
	"  counterevidence_tool_use_ids   = the list of tool-call ids that count against you",
	'  remaining_question_ids         = a list of open question ids, e.g. "S1.automated_enforcement"',
	"",
	"Rules:",
	"- Do NOT add any field other than the eight listed above.",
	"- Do NOT include file contents, excerpts, prose or explanations in the JSON.",
	'- For S1, use decision "narrowed" and qualification code',
	'  "manual_enforcement_only": the observed configuration is within the',
	"  documented budget, but automatic enforcement is absent.",
	'- For S2, use decision "refuted" and qualification code',
	'  "independently_observed_contradiction".',
	'- For S3, use decision "unresolved" and qualification code',
	'  "source_evidence_missing".',
	"- The JSON object must be the ONLY content of that assistant text output.",
	"- After publishing it, you may continue working normally.",
].join("\n");

const SYNTHETIC_USER_PROMPT = [
	"SYNTHETIC AUDIT TASK.",
	"",
	"Allegation S1: the synthetic worker pool exceeds its documented budget.",
	"Allegation S2: the synthetic request timeout is unbounded.",
	"Allegation S3: the synthetic retry policy is undocumented.",
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

// ---------------------------------------------------------------------------
// The probe.
// ---------------------------------------------------------------------------

interface Observation {
	provider: string;
	model: string;
	/** Whether the model emitted any assistant text at all. */
	emittedAssistantText: boolean;
	/** How many assistant text chunks the model emitted. */
	assistantTextChunkCount: number;
	/** The number of DISTINCT assistant text carriers (one per turn). */
	turnCarrierCount: number;
	/** The index of the turn whose carrier held the published candidate. */
	publishedCarrierIndex?: number;
	/** Whether the PUBLISHING turn ALSO carried a tool call. */
	publishedTurnAlsoCarriedToolUse?: boolean;
	/** Whether the model emitted reasoning (never read by the contract). */
	emittedReasoning: boolean;
	/** Whether any assistant text parsed as a schema-valid candidate. */
	publishedValidCandidate: boolean;
	/** The parse failure reason, when the candidate did not parse. */
	parseRejectionReason?: string;
	/** The candidate's decision, when it parsed. */
	decision?: string;
	/** The candidate's qualification codes, when it parsed. */
	qualificationCodes?: string[];
	/** The candidate's evidence tool-call ids, when it parsed. */
	evidenceToolUseIds?: string[];
	/** The candidate's remaining question ids, when it parsed. */
	remainingQuestionIds?: string[];
	/** Whether the model emitted a tool call at all. */
	emittedToolUse: boolean;
	/** The number of tool calls the model emitted. */
	toolCallCount: number;
	/** The number of provider turns the probe ran. */
	turns: number;
	/** Whether assistant text was emitted AFTER a tool result. */
	publishedAfterToolResult: boolean;
	/** The tool-call id the model produced (the first one), if any. */
	firstToolCallId?: string;
	/** The error, if the request failed. */
	error?: string;
}

async function runProbe(config: ProviderConfig): Promise<Observation> {
	const observation: Observation = {
		provider: config.providerId,
		model: config.modelId,
		emittedAssistantText: false,
		assistantTextChunkCount: 0,
		turnCarrierCount: 0,
		emittedReasoning: false,
		publishedValidCandidate: false,
		emittedToolUse: false,
		toolCallCount: 0,
		turns: 0,
		publishedAfterToolResult: false,
	};

	try {
		const handler = createHandler(config);

		// The conversation is built the way ClineMM builds it: an assistant
		// turn may carry BOTH a `text` block and a `tool_use` block, and the
		// tool RESULT comes back as a user turn.
		const messages: Message[] = [
			{
				role: "user",
				content: [{ type: "text", text: SYNTHETIC_USER_PROMPT }],
			},
		];

		// Each assistant turn's text is a SEPARATE carrier. The contract
		// parses ONE carrier at a time; concatenating turns would fabricate
		// a carrier that never existed in the canonical record.
		const turnCarriers: string[] = [];
		const turnToolCallCounts: number[] = [];
		let firstToolCallId: string | undefined;
		let toolCallCount = 0;
		let turns = 0;
		let sawTextAfterToolResult = false;

		const deadline = Date.now() + PROVIDER_TIMEOUT_MS;

		while (turns < 5 && Date.now() < deadline) {
			turns += 1;
			let turnText = "";
			const turnToolCalls: {
				id: string;
				name: string;
				arguments: string | Record<string, unknown> | undefined;
			}[] = [];

			const stream = handler.createMessage(SYSTEM_PROMPT, messages, [
				SYNTHETIC_TOOL,
			]);

			for await (const chunk of stream) {
				if (chunk.type === "text") {
					turnText += chunk.text;
					observation.emittedAssistantText = true;
					observation.assistantTextChunkCount += 1;
					continue;
				}
				if (chunk.type === "reasoning") {
					// The private reasoning is NEVER read by the contract.
					// The probe only records that it was produced.
					observation.emittedReasoning = true;
					continue;
				}
				if (chunk.type === "tool_calls") {
					observation.emittedToolUse = true;
					toolCallCount += 1;
					const call = chunk.tool_call;
					const id =
						call.function.id ?? call.call_id ?? `call_${toolCallCount}`;
					if (!firstToolCallId) {
						firstToolCallId = id;
					}
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

			turnToolCallCounts.push(turnToolCalls.length);
			if (turnText) {
				turnCarriers.push(turnText);
			}

			// The assistant turn: a `text` block AND a `tool_use` block in the
			// SAME canonical turn.
			const assistantContent: Message["content"] = [];
			if (turnText) {
				assistantContent.push({ type: "text", text: turnText });
			}
			for (const call of turnToolCalls) {
				assistantContent.push({
					type: "tool_use",
					id: call.id,
					name: call.name,
					input:
						typeof call.arguments === "object" && call.arguments !== null
							? call.arguments
							: { raw: call.arguments ?? "" },
				});
			}
			if (assistantContent.length > 0) {
				messages.push({ role: "assistant", content: assistantContent });
			}

			if (turnToolCalls.length === 0) {
				// The model finished its turn without asking for a tool. The
				// publication must have happened in THIS turn's text.
				break;
			}

			// The tool result comes back as a user turn, exactly as the
			// canonical record does.
			messages.push({
				role: "user",
				content: turnToolCalls.map((call) => ({
					type: "tool_result" as const,
					tool_use_id: call.id,
					name: call.name,
					content: [{ type: "text" as const, text: SYNTHETIC_TOOL_RESULT }],
				})),
			});

			// A text block emitted AFTER the tool result is the publication
			// the contract cares about.
			if (turnText) {
				sawTextAfterToolResult = true;
			}
		}

		observation.turns = turns;
		observation.toolCallCount = toolCallCount;
		observation.publishedAfterToolResult = sawTextAfterToolResult;
		observation.firstToolCallId = firstToolCallId;

		observation.turnCarrierCount = turnCarriers.length;

		// The STRICT parse over EACH assistant text carrier, one at a time.
		// A carrier that is not an envelope is a NORMAL carrier (a preamble
		// or an explanation); it is simply not a published adjudication.
		const rejectionReasons: string[] = [];
		for (let index = 0; index < turnCarriers.length; index += 1) {
			const parsed = parseAdjudicationEnvelope(turnCarriers[index].trim());
			if (parsed.ok) {
				observation.publishedValidCandidate = true;
				observation.decision = parsed.candidate.decision;
				observation.qualificationCodes = parsed.candidate.qualification_codes;
				observation.evidenceToolUseIds = parsed.candidate.evidence_tool_use_ids;
				observation.remainingQuestionIds =
					parsed.candidate.remaining_question_ids;
				observation.publishedCarrierIndex = index;
				observation.publishedTurnAlsoCarriedToolUse =
					(turnToolCallCounts[index] ?? 0) > 0;
				break;
			}
			rejectionReasons.push(parsed.reason);
		}
		if (!observation.publishedValidCandidate && rejectionReasons.length > 0) {
			observation.parseRejectionReason = rejectionReasons.join(",");
		}
	} catch (error) {
		observation.error = error instanceof Error ? error.message : String(error);
	}

	return observation;
}

async function main(): Promise<void> {
	if (!ENABLED) {
		console.log(
			"SKIPPED: set CORE_LIVE_ADJUDICATION_PROBE=1 to run the G6 live probe.",
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
		console.log(
			`\n=== G6 live probe: ${target.label} (${target.config.providerId}/${target.config.modelId}) ===`,
		);
		const observation = await runProbe(target.config);
		report.observations.push(observation);
		report.observation_count += 1;
		console.log(JSON.stringify(observation, null, 2));
	}
	console.log("\n=== G6 live probe report ===");
	console.log(JSON.stringify(report, null, 2));
}

await main();
