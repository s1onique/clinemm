/**
 * ACT-CLINEMM-PCK-CLOSED-PUBLICATION-IMPLEMENT-01-CORRECTION01
 *
 * P0-2 — the CANONICAL-REFERENCE CONFIDENTIALITY discriminator.
 *
 * ============================================================================
 * THE QUESTION
 * ============================================================================
 *
 * The canonical reference set is built from the session's OWN canonical
 * tool-call ids and message ids. MEMBERSHIP establishes that an identifier
 * was PRESENT in the canonical history. It does NOT establish that the
 * identifier is SAFE TO REPUBLISH.
 *
 * The projection renders the admitted record's evidence references
 * verbatim:
 *
 *   evidence_refs=${record.evidenceRefs.join(",")}
 *
 * So if a canonical tool-call id happened to be credential-SHAPED — or
 * simply carried a value that must not leave the host — the published
 * section and the provider-visible continuation would carry it.
 *
 * ============================================================================
 * THE DISCRIMINATOR
 * ============================================================================
 *
 *   1. Put a synthetic credential-shaped value into an OTHERWISE VALID
 *      canonical tool-call id.
 *   2. Reference that id in an OTHERWISE VALID closed proposal.
 *   3. Exercise the ACTUAL publication gate and the ACTUAL projection
 *      through the REAL production compaction seam.
 *   4. Inspect BOTH the persisted summary and the provider-visible
 *      continuation.
 *
 * If the raw identifier appears, the trust-boundary RED is REPRODUCED and
 * the fix is to use host-minted opaque reference aliases (or to omit raw
 * identifiers from rendered publication). If it does not appear, the finding
 * is closed as NOT_REPRODUCED.
 */

import type * as LlmsProviders from "@cline/llms";
import type { MessageWithMetadata } from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionCompactionState } from "../../../session/models/session-compaction";
import { MessageBuilder } from "../../../session/services/message-builder";
import {
	createCompactionStateAwarePrepareTurn,
	createContextCompactionPrepareTurn,
} from "../compaction";

const createHandlerMock = vi.fn();

vi.mock("@cline/llms", () => ({
	createHandlerAsync: (config: unknown) => createHandlerMock(config),
}));

/**
 * The synthetic credential-shaped canonical tool-call id.
 *
 * It is NOT a real credential. It is deliberately OPAQUE and keyword-free
 * apart from the explicit DO-NOT-USE marker, so no content scanner would
 * catch it, and it satisfies every shape rule a reference might have.
 */
const CREDENTIAL_SHAPED_TOOL_CALL_ID =
	"toolu_01FAKE-CREDENTIAL-DO-NOT-USE-7P4xQz";

const HISTORICAL_SUMMARY = [
	"## Goal",
	"Inspect the deployment configuration and report the working knowledge.",
].join("\n");

const capturedSummarizerRequests: string[] = [];
const capturedCheckpointRequests: string[] = [];

let checkpointResponseText = "";

async function* streamChunks(
	chunks: readonly Record<string, unknown>[],
): AsyncGenerator<Record<string, unknown>> {
	for (const chunk of chunks) {
		yield chunk;
	}
}

beforeEach(() => {
	capturedSummarizerRequests.length = 0;
	capturedCheckpointRequests.length = 0;
	checkpointResponseText = "";
	createHandlerMock.mockReset();
	createHandlerMock.mockImplementation((config: unknown) => {
		const providerConfig = config as { systemPrompt?: string };
		const isCheckpoint =
			typeof providerConfig.systemPrompt === "string" &&
			providerConfig.systemPrompt.includes("WORKING-KNOWLEDGE CHECKPOINT");
		return {
			createMessage: vi.fn((_systemPrompt: string, messages: unknown[]) => {
				const first = messages[0] as { content?: string } | undefined;
				if (isCheckpoint) {
					capturedCheckpointRequests.push(first?.content ?? "");
					return streamChunks([
						{ type: "text", id: "pck-1", text: checkpointResponseText },
						{ type: "done", id: "pck-1", success: true },
					]);
				}
				capturedSummarizerRequests.push(first?.content ?? "");
				return streamChunks([
					{ type: "text", id: "summary-1", text: HISTORICAL_SUMMARY },
					{ type: "done", id: "summary-1", success: true },
				]);
			}),
		};
	});
});

afterEach(() => {
	delete process.env.CLINEMM_PCK_CLOSED_ENABLED;
});

function syntheticCanonicalHistory(): MessageWithMetadata[] {
	const messages: MessageWithMetadata[] = [
		{
			role: "user",
			id: "msg_task",
			content: "Inspect the deployment configuration and report findings.",
		} as unknown as MessageWithMetadata,
		{
			role: "assistant",
			id: "msg_call",
			content: [
				{
					type: "tool_use",
					id: CREDENTIAL_SHAPED_TOOL_CALL_ID,
					name: "run_commands",
					input: { command: "kc.sh build" },
				},
			],
		} as unknown as MessageWithMetadata,
		{
			role: "user",
			id: "msg_result",
			content: [
				{
					type: "tool_result",
					tool_use_id: CREDENTIAL_SHAPED_TOOL_CALL_ID,
					content: [
						{
							query: "kc.sh build",
							result: "build completed",
							success: true,
						},
					],
				},
			],
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
	return messages;
}

async function runProductionSeam(input: {
	canonicalMessages: MessageWithMetadata[];
}): Promise<{
	readonly checkpointRequest: string;
	readonly providerVisibleText: string;
	readonly persistedText: string;
}> {
	const providerId = "anthropic";
	const modelId = "mock-model";
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

	const inner = createContextCompactionPrepareTurn(
		{
			providerId,
			modelId,
			providerConfig: { providerId, modelId } as LlmsProviders.ProviderConfig,
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
		prepareApiMessages: async (messages) => messages,
		saveState: () => undefined,
		knowledgeCheckpoint: {
			generate: async ({ systemPrompt, request, signal }) => {
				const handler = await createHandlerMock({
					systemPrompt,
				}).createMessage(systemPrompt, [{ role: "user", content: request }]);
				let text = "";
				for await (const chunk of handler) {
					if (chunk.type === "text") {
						text += chunk.text;
					}
				}
				signal.throwIfAborted();
				return { text, reasoningChars: 0, usedTools: false, failed: false };
			},
			decisionId: () => "decision-p0-2",
			deadlineMs: () => 5_000,
		},
	});

	const result = await prepareTurn({
		agentId: "agent-1",
		conversationId: "conv-1",
		parentAgentId: null,
		iteration: 1,
		abortSignal: new AbortController().signal,
		systemPrompt: "You are a helpful coding assistant.",
		tools: [],
		messages: input.canonicalMessages,
		apiMessages: input.canonicalMessages,
		model: outerModel,
	});

	const productionMessages = result?.messages ?? [];
	const providerVisible = new MessageBuilder().buildForApi(
		productionMessages as unknown as Parameters<
			MessageBuilder["buildForApi"]
		>[0],
	);
	const sidecar = createSessionCompactionState({
		sourceMessages: input.canonicalMessages,
		compactedMessages: productionMessages,
		conversationId: "conv-1",
	});
	return {
		checkpointRequest: capturedCheckpointRequests.at(-1) ?? "",
		providerVisibleText: JSON.stringify(providerVisible),
		persistedText: JSON.stringify(sidecar),
	};
}

/**
 * Build the checkpoint request the runtime would send for a history.
 *
 * It is used only to assert the PRECONDITION: the credential-shaped id is
 * genuinely present in the session's own canonical history.
 */
function buildRequestFor(history: MessageWithMetadata[]): string {
	const references: string[] = [];
	for (const message of history) {
		if (!Array.isArray(message.content)) {
			continue;
		}
		for (const block of message.content) {
			if (block.type === "tool_use") {
				references.push(block.id);
			}
		}
	}
	return references.join(", ");
}

/**
 * Extract the PCK's OWN published section from a serialised payload.
 *
 * The section is delimited by the runtime-owned markers, so the extraction
 * is exact and does not depend on the surrounding JSON.
 */
function extractPckSection(serialised: string): string {
	const begin = "<!-- cline-knowledge-checkpoint:begin -->";
	const end = "<!-- cline-knowledge-checkpoint:end -->";
	const start = serialised.indexOf(begin);
	const stop = serialised.indexOf(end);
	if (start === -1 || stop === -1 || stop < start) {
		return "";
	}
	return serialised.slice(start, stop + end.length);
}

/**
 * Extract the PRE-EXISTING evidence-continuity section.
 */
function extractEvidenceSection(serialised: string): string {
	const begin = "<!-- cline-evidence:begin -->";
	const end = "<!-- cline-evidence:end -->";
	const start = serialised.indexOf(begin);
	const stop = serialised.indexOf(end);
	if (start === -1 || stop === -1 || stop < start) {
		return "";
	}
	return serialised.slice(start, stop + end.length);
}

describe("ACT-CLINEMM-PCK-CLOSED-PUBLICATION-IMPLEMENT-01-CORRECTION01 — P0-2", () => {
	it("P0-2.1: the credential-shaped id IS a canonical reference of the session", () => {
		// PRECONDITION: the identifier really is in the session's own
		// canonical history, so membership admits it. The discriminator is
		// therefore testing the RENDERING, not the membership check.
		const history = syntheticCanonicalHistory();
		const request = buildRequestFor(history);
		expect(request).toContain(CREDENTIAL_SHAPED_TOOL_CALL_ID);
	});

	it("P0-2.2: the RAW canonical id does NOT reach the persisted summary OR the provider-visible continuation", async () => {
		process.env.CLINEMM_PCK_CLOSED_ENABLED = "1";
		checkpointResponseText = JSON.stringify({
			records: [
				{
					kind: "observation",
					assurance: "tool_observed",
					status: "active",
					atom: "OPERATION_INVOKED",
					argument: "build",
					evidenceRefs: [CREDENTIAL_SHAPED_TOOL_CALL_ID],
				},
			],
		});
		const history = syntheticCanonicalHistory();
		const seam = await runProductionSeam({ canonicalMessages: history });

		// The checkpoint WAS produced: the discriminator must not pass
		// because the feature silently did nothing.
		expect(seam.providerVisibleText).toContain("Working knowledge checkpoint");
		expect(seam.persistedText).toContain("Working knowledge checkpoint");

		// THE DISCRIMINATOR: within the PCK's OWN published section, the raw
		// credential-shaped identifier must not appear.
		//
		// The section is isolated deliberately. The PRE-EXISTING
		// evidence-continuity section (`<!-- cline-evidence:begin -->`)
		// renders the canonical tool-call id too, and that mechanism is
		// OUT OF SCOPE for this ACT: it is a separate, already-shipped
		// carry-forward, not the PCK's publication channel. P0-2.3 records
		// that exposure separately rather than hiding it inside this
		// discriminator.
		const persistedSection = extractPckSection(seam.persistedText);
		const providerSection = extractPckSection(seam.providerVisibleText);
		expect(persistedSection.length).toBeGreaterThan(0);
		expect(providerSection.length).toBeGreaterThan(0);
		expect(persistedSection).not.toContain(CREDENTIAL_SHAPED_TOOL_CALL_ID);
		expect(providerSection).not.toContain(CREDENTIAL_SHAPED_TOOL_CALL_ID);
		// The record keeps its provenance HANDLE, as an opaque alias.
		expect(persistedSection).toContain("evidence_refs=ref-0");
	});

	it("P0-2.3: the PRE-EXISTING evidence-continuity section is a SEPARATE exposure", async () => {
		// The evidence-continuity carry-forward renders the canonical
		// tool-call id as well. It is a PRE-EXISTING, SEPARATE mechanism
		// that this ACT does not modify, and it is recorded here so the
		// finding is not mistaken for something the PCK introduced or
		// fixed.
		process.env.CLINEMM_PCK_CLOSED_ENABLED = "1";
		checkpointResponseText = JSON.stringify({
			records: [
				{
					kind: "observation",
					assurance: "tool_observed",
					status: "active",
					atom: "OPERATION_INVOKED",
					argument: "build",
					evidenceRefs: [CREDENTIAL_SHAPED_TOOL_CALL_ID],
				},
			],
		});
		const history = syntheticCanonicalHistory();
		const seam = await runProductionSeam({ canonicalMessages: history });
		const evidenceSection = extractEvidenceSection(seam.persistedText);
		expect(evidenceSection.length).toBeGreaterThan(0);
		// The pre-existing mechanism DOES render the raw id. This is
		// recorded as an OBSERVED PRE-EXISTING EXPOSURE, not attributed to
		// the PCK, and not silently claimed away.
		expect(evidenceSection).toContain(CREDENTIAL_SHAPED_TOOL_CALL_ID);
	});
});
