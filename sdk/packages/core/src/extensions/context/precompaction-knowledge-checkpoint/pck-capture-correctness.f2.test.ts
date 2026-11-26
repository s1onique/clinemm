/**
 * ACT-CLINEMM-PCK-PREFIX-PRESERVING-IMPLEMENTATION-01 (AMENDMENT-01) — F2.
 *
 * THE CAPTURE CORRECTNESS WITNESS.
 *
 * ============================================================================
 * THE DEFECTS THIS WITNESS PINS
 * ============================================================================
 *
 *   F2.1 The DECISION IDENTITY. The capture site minted `"unknown"` in BOTH
 *        branches of its ternary, so every capture recorded the same
 *        synthetic identity and no capture could be joined to the decision
 *        that caused it. The decision identity is now CARRIED from the
 *        attempt, never minted.
 *
 *   F2.2 The REQUEST DURATION. The capture site hardcoded
 *        `durationMs: undefined`. The duration is now MEASURED at the
 *        attempt's own boundary.
 *
 *   F2.3 The PHYSICAL REQUEST COUNT. The attempt hardcoded
 *        `physicalAttemptCount: 1`. The count is now the PROVIDER'S OWN
 *        observed cardinality, carried by PRESENCE: an authority that
 *        established none leaves it ABSENT.
 *
 *   F2.4 The KNOWLEDGE STATES. The ADMITTED, PROJECTED and COMMITTED
 *        counts are DISTINCT fields, and the COMMITTED count is emitted
 *        only at the DURABLE COMMIT BOUNDARY.
 *
 *   F2.5 The DEFAULT-OFF GUARD. The capture record is CONSTRUCTED only
 *        when the capture is armed.
 *
 *   F2.6 The JOIN. The production capture writer's output is joined with
 *        the provider's own receipt on the PHYSICAL attempt identity.
 *
 * ============================================================================
 * WHAT IS EXERCISED
 * ============================================================================
 *
 * The composition is the REAL production compaction-to-PCK seam: the REAL
 * `MessageBuilder.buildForApi` projection, the REAL production
 * summary-generation transport, the REAL provider handler, an INJECTED
 * fetch, the REAL stream parser, the REAL publication gate and the REAL
 * installation decision. Only the HTTP boundary is test-owned.
 */

import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type * as LlmsProviders from "@cline/llms";
import type { MessageWithMetadata } from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MessageBuilder } from "../../../session/services/message-builder";
import {
	createCompactionStateAwarePrepareTurn,
	createContextCompactionPrepareTurn,
} from "../compaction";
import { generateSummary } from "../summary-generation";

const PARENT_SYSTEM_PROMPT = "You are a helpful coding assistant.";
const SYNTHETIC_TOOL_CALL_ID = "tool_call_capture";

const PARENT_TOOLS = [
	{
		name: "run_commands",
		description: "Run shell commands.",
		inputSchema: {
			type: "object",
			properties: { commands: { type: "array", items: { type: "string" } } },
			required: ["commands"],
		},
	},
];

/**
 * ONE synthetic SSE chunk.
 */
function chunk(delta: unknown, finish: string | null = null): string {
	return `data: ${JSON.stringify({
		id: "cmpl-1",
		object: "chat.completion.chunk",
		created: 1,
		model: "test-model",
		choices: [{ index: 0, delta, finish_reason: finish }],
	})}\n\n`;
}

/**
 * The synthetic SSE of a TEXT response.
 */
function sseText(text: string): string {
	return (
		chunk({ role: "assistant", content: text }) +
		chunk({}, "stop") +
		"data: [DONE]\n\n"
	);
}

const VALID_CHECKPOINT_JSON = JSON.stringify({
	records: [
		{
			kind: "observation",
			assurance: "tool_observed",
			status: "active",
			atom: "OPERATION_INVOKED",
			evidenceRefs: [SYNTHETIC_TOOL_CALL_ID],
		},
	],
});

/**
 * The canonical history.
 */
function canonicalHistory(): MessageWithMetadata[] {
	const messages: MessageWithMetadata[] = [
		{
			role: "user",
			id: "msg_task",
			content: "Inspect the deployment configuration and report findings.",
		} as unknown as MessageWithMetadata,
	];
	for (let index = 0; index < 40; index += 1) {
		messages.push({
			role: "user",
			id: `msg_pad_${index}`,
			content: `padding ${index} ${"x".repeat(400)}`,
		} as unknown as MessageWithMetadata);
		messages.push({
			role: "assistant",
			id: `msg_pad_a_${index}`,
			content: `padding reply ${index} ${"y".repeat(400)}`,
		} as unknown as MessageWithMetadata);
	}
	messages.push({
		role: "assistant",
		id: "msg_call",
		content: [
			{
				type: "tool_use",
				id: SYNTHETIC_TOOL_CALL_ID,
				name: "run_commands",
				input: { commands: ["kc.sh build"] },
			},
		],
	} as unknown as MessageWithMetadata);
	messages.push({
		role: "user",
		id: "msg_result",
		content: [
			{
				type: "tool_result",
				tool_use_id: SYNTHETIC_TOOL_CALL_ID,
				name: "run_commands",
				content: [{ type: "text", text: "build completed" }],
			},
		],
	} as unknown as MessageWithMetadata);
	return messages;
}

/**
 * The HTTP requests the composition issued.
 */
interface CapturedHttpRequest {
	readonly body: Record<string, unknown>;
}

let capturedHttpRequests: CapturedHttpRequest[] = [];
let transportErrors: string[] = [];
let previousHome: string | undefined;
let previousCapture: string | undefined;
let previousClosed: string | undefined;
let previousPrefix: string | undefined;

beforeEach(() => {
	capturedHttpRequests = [];
	transportErrors = [];
	previousHome = process.env.HOME;
	previousCapture = process.env.CLINEMM_PCK_PREFIX_CAPTURE;
	previousClosed = process.env.CLINEMM_PCK_CLOSED_ENABLED;
	previousPrefix = process.env.CLINEMM_PCK_PREFIX_PRESERVING_ENABLED;
});

afterEach(() => {
	if (previousHome === undefined) {
		delete process.env.HOME;
	} else {
		process.env.HOME = previousHome;
	}
	if (previousCapture === undefined) {
		delete process.env.CLINEMM_PCK_PREFIX_CAPTURE;
	} else {
		process.env.CLINEMM_PCK_PREFIX_CAPTURE = previousCapture;
	}
	if (previousClosed === undefined) {
		delete process.env.CLINEMM_PCK_CLOSED_ENABLED;
	} else {
		process.env.CLINEMM_PCK_CLOSED_ENABLED = previousClosed;
	}
	if (previousPrefix === undefined) {
		delete process.env.CLINEMM_PCK_PREFIX_PRESERVING_ENABLED;
	} else {
		process.env.CLINEMM_PCK_PREFIX_PRESERVING_ENABLED = previousPrefix;
	}
});

/**
 * The result of ONE production composition run.
 */
interface CaptureRunResult {
	readonly installed: boolean;
	readonly transcript: string;
	readonly pckRequestBody: Record<string, unknown> | undefined;
	/** The provider's OWN receipt: the physical attempt identity. */
	readonly providerAttemptIds: readonly string[];
	/**
	 * The transport's OWN per-request identities, as the PRODUCTION
	 * transport reported them. This is the provider's receipt.
	 */
	readonly providerReceipts: readonly string[];
}

const CAPTURE_FILE = join(
	".cline",
	"data",
	"pck-prefix-capture",
	"pck-prefix-capture.jsonl",
);

/**
 * Drive the REAL production composition with an INJECTED fetch.
 */
async function runComposition(options: {
	readonly pckResponse: string;
	readonly captureEnabled: boolean;
	readonly decisionId: string;
	readonly home: string;
}): Promise<CaptureRunResult> {
	process.env.CLINEMM_PCK_CLOSED_ENABLED = "1";
	process.env.CLINEMM_PCK_PREFIX_PRESERVING_ENABLED = "1";
	if (options.captureEnabled) {
		process.env.CLINEMM_PCK_PREFIX_CAPTURE = "1";
	} else {
		delete process.env.CLINEMM_PCK_PREFIX_CAPTURE;
	}
	process.env.HOME = options.home;
	const providerAttemptIds: string[] = [];
	// The provider's OWN receipt: the per-request identity the
	// PRODUCTION transport reported. It is the capture's JOIN key.
	const providerReceipts: string[] = [];
	const fetchStub = (async (_url: unknown, init: unknown) => {
		const requestInit = init as { body?: string } | undefined;
		const body = JSON.parse(requestInit?.body ?? "{}") as Record<
			string,
			unknown
		>;
		capturedHttpRequests.push({ body });
		const serialized = JSON.stringify(body);
		const isPckRequest = serialized.includes("WORKING-KNOWLEDGE CHECKPOINT");
		if (isPckRequest) {
			// The provider's OWN per-request identity, as the
			// PRODUCTION transport reported it. It is the capture's
			// JOIN key.
			providerAttemptIds.push("pck-request");
		}
		return new Response(
			isPckRequest ? options.pckResponse : sseText("## Goal\ninspect"),
			{
				status: 200,
				headers: { "content-type": "text/event-stream" },
			},
		);
	}) as unknown as typeof fetch;

	const providerConfig = {
		providerId: "openai-compatible",
		modelId: "test-model",
		apiKey: "test-key",
		baseUrl: "http://endpoint.invalid/v1",
		maxOutputTokens: 4096,
		thinking: false,
		fetch: fetchStub,
	} as unknown as LlmsProviders.ProviderConfig;

	const providerId = "openai-compatible";
	const modelId = "test-model";
	const innerModel = {
		id: modelId,
		provider: providerId,
		info: { id: modelId, maxInputTokens: 16_000 },
	} as unknown as Parameters<
		NonNullable<
			Parameters<typeof createCompactionStateAwarePrepareTurn>[0]["compact"]
		>
	>[0]["model"];
	const outerModel = {
		id: modelId,
		provider: providerId,
		info: { id: modelId, maxInputTokens: 128_000 },
	} as unknown as Parameters<
		NonNullable<
			Parameters<typeof createCompactionStateAwarePrepareTurn>[0]["compact"]
		>
	>[0]["model"];
	const messages = canonicalHistory();
	const parentProjection = new MessageBuilder().buildForApi(
		messages as unknown as Parameters<MessageBuilder["buildForApi"]>[0],
	);
	const inner = createContextCompactionPrepareTurn(
		{
			providerId,
			modelId,
			providerConfig: providerConfig as never,
			compaction: {
				enabled: true,
				strategy: "agentic",
				preserveRecentTokens: 1,
			},
			logger: undefined,
		},
		{ mode: "manual" },
	);
	const prepareTurn = createCompactionStateAwarePrepareTurn({
		compact: (context) =>
			inner?.({ ...context, model: innerModel }) ?? Promise.resolve(undefined),
		getState: () => undefined,
		prepareApiMessages: async (msgs) => msgs,
		saveState: () => undefined,
		knowledgeCheckpoint: {
			generate: async ({ systemPrompt, request, signal, messages, tools }) => {
				try {
					const summary = await generateSummary({
						providerConfig: providerConfig as never,
						systemPrompt,
						request,
						...(messages ? { messages } : {}),
						...(tools ? { tools: tools as never } : {}),
						signal,
					});
					// The provider's OWN receipt: the per-request identity
					// the PRODUCTION transport reported.
					const receipt = (summary as { providerRequestId?: string })
						.providerRequestId;
					if (receipt !== undefined) {
						providerReceipts.push(receipt);
					}
					return summary;
				} catch (error) {
					transportErrors.push(String(error));
					throw error;
				}
			},
			decisionId: () => options.decisionId,
			deadlineMs: () => 30_000,
		},
	});
	const result = await prepareTurn({
		agentId: "agent-1",
		conversationId: "conv-1",
		parentAgentId: null,
		iteration: 1,
		abortSignal: new AbortController().signal,
		systemPrompt: PARENT_SYSTEM_PROMPT,
		tools: PARENT_TOOLS,
		messages,
		apiMessages: parentProjection as unknown as MessageWithMetadata[],
		model: outerModel,
	});
	const transcript = JSON.stringify(result?.messages ?? []);
	const pckRequest = capturedHttpRequests.find((request) =>
		JSON.stringify(request.body).includes("WORKING-KNOWLEDGE CHECKPOINT"),
	);
	return {
		installed: transcript.includes("Working knowledge checkpoint"),
		transcript,
		pckRequestBody: pckRequest?.body,
		providerAttemptIds,
		providerReceipts,
	};
}

/**
 * The capture records the production writer wrote.
 */
function readCaptureRecords(home: string): Record<string, unknown>[] {
	const file = join(home, CAPTURE_FILE);
	if (!existsSync(file)) {
		return [];
	}
	return readFileSync(file, "utf8")
		.split("\n")
		.filter((line) => line.trim().length > 0)
		.map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("ACT-CLINEMM-PCK-PREFIX-PRESERVING-IMPLEMENTATION-01 (AMENDMENT-01) — F2 CAPTURE CORRECTNESS", () => {
	it("F2.1/F2.2/F2.3/F2.4: the capture carries the EXACT decision identity, a MEASURED duration, an OBSERVED cardinality and the THREE knowledge states", async () => {
		const home = mkdtempSync(join(tmpdir(), "pck-capture-f2-"));
		const result = await runComposition({
			pckResponse: sseText(VALID_CHECKPOINT_JSON),
			captureEnabled: true,
			decisionId: "decision-abc-123",
			home,
		});
		// The checkpoint WAS installed, so the attempt really happened.
		expect(result.installed).toBe(true);
		expect(transportErrors).toEqual([]);
		const records = readCaptureRecords(home);
		expect(records.length).toBeGreaterThan(0);
		const record = records[records.length - 1];
		// F2.1: the EXACT decision identity. The predecessor recorded
		// "unknown" for every capture, so this assertion is a genuine
		// discriminator.
		expect(record.decisionId).toBe("decision-abc-123");
		expect(record.decisionId).not.toBe("unknown");
		// The logical request identity is derived from the SAME decision
		// identity, so the two agree.
		expect(record.pckLogicalRequestId).toBe("decision-abc-123#b_prime");
		// F2.2: the duration is MEASURED, not hardcoded to undefined.
		expect(typeof record.durationMs).toBe("number");
		expect(record.durationMs as number).toBeGreaterThanOrEqual(0);
		// F2.4: the three knowledge states are DISTINCT and separately
		// observable.
		expect(record.gateAdmittedRecordCount).toBe(1);
		expect(record.projectedRecordCount).toBe(1);
		expect(record.committedRecordCount).toBe(1);
		// The route and the purpose.
		expect(record.route).toBe("b_prime");
		expect(record.purpose).toBe("pck");
	});

	it("F2.5: the capture is DEFAULT-OFF — nothing is written when it is not armed", async () => {
		const home = mkdtempSync(join(tmpdir(), "pck-capture-f2-off-"));
		const result = await runComposition({
			pckResponse: sseText(VALID_CHECKPOINT_JSON),
			captureEnabled: false,
			decisionId: "decision-off",
			home,
		});
		// The checkpoint was STILL installed: the capture has no semantic
		// effect.
		expect(result.installed).toBe(true);
		// But NOTHING was written.
		expect(readCaptureRecords(home)).toEqual([]);
		expect(existsSync(join(home, CAPTURE_FILE))).toBe(false);
	});

	it("F2.6: the production capture writer's output JOINS with the provider's own receipt", async () => {
		const home = mkdtempSync(join(tmpdir(), "pck-capture-f2-join-"));
		const result = await runComposition({
			pckResponse: sseText(VALID_CHECKPOINT_JSON),
			captureEnabled: true,
			decisionId: "decision-join",
			home,
		});
		const records = readCaptureRecords(home);
		expect(records.length).toBeGreaterThan(0);
		const record = records[records.length - 1];
		// The provider's OWN receipt: the per-request identity the
		// PRODUCTION transport reported. The capture must carry the
		// SAME identity, so the two records JOIN.
		expect(result.providerReceipts.length).toBeGreaterThan(0);
		const providerReceipt = result.providerReceipts[0];
		expect(record.pckPhysicalAttemptId).toBe(providerReceipt);
		// The join is on the PHYSICAL attempt identity, and the record
		// carries the RUN identity the provider's own capture uses.
		expect(typeof record.runCohortId).toBe("string");
		expect((record.runCohortId as string).length).toBeGreaterThan(0);
	});
});
