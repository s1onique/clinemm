/**
 * ACT-CLINEMM-COMPACTION-TOOL-RESULT-SHAPE-REPRO01
 *
 * Production-seam reproduction of a loss of STRUCTURED tool results at the
 * real compaction boundary.
 *
 * THE HYPOTHESIS UNDER TEST
 * -------------------------
 *
 * The canonical representation of a `run_commands` tool result is an ARRAY
 * of untyped entries:
 *
 *   [ { query: "...", result: "...", success: true } ]
 *
 * The `run_commands` executor produces exactly that shape
 * (`sdk/packages/core/src/extensions/tools/definitions.ts`), and the
 * canonical persistence + provider-visible projection preserves the array
 * AS AN ARRAY (`toPersistedToolResultContent()` in
 * `sdk/packages/shared/src/llms/request-budget.ts` explicitly documents
 * that "Cline ToolOperationResult objects" are persisted as arrays even when
 * their entries are not media/text blocks).
 *
 * So the MODEL-BOUND runtime shape of `ToolResultContent.content` is an
 * array that can contain entries which are NOT `text` / `file` / `image`
 * blocks.
 *
 * The summarizer input, however, is built by
 *
 *   serializeConversation()  ->  serializeMessage()
 *     -> flattenToolResultContent(block.content)
 *
 * and `flattenToolResultContent()` recognizes ONLY the typed `text`, `file`
 * and `image` blocks. Everything else falls into its `default:` branch,
 * which returns the EMPTY STRING. A structured `{query, result, success}`
 * entry is therefore SILENTLY DROPPED from the summarizer's input window.
 *
 * THE DISCRIMINATOR
 * -----------------
 *
 * Every scenario below asserts on the ACTUAL summarizer request — the exact
 * string handed to the provider by the production
 * `createContextCompactionPrepareTurn({ strategy: "agentic" })` seam. The
 * test does NOT re-implement a flattening helper: it observes the real
 * request that `runAgenticCompaction()` produced.
 *
 * The canonical result must contain useful output, the corresponding tool
 * call must be present, and then the summarizer-input projection is checked
 * for that output.
 *
 * CONFIDENTIALITY
 * ---------------
 *
 * The credential-bearing scenario uses SYNTHETIC credentials only. No real
 * Keycloak secret appears in this file.
 */

import type * as LlmsProviders from "@cline/llms";
import type { MessageWithMetadata } from "@cline/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createContextCompactionPrepareTurn } from "./compaction";

type FakeChunk = Record<string, unknown>;

const createHandlerMock = vi.fn();

vi.mock("@cline/llms", () => ({
	createHandlerAsync: (config: unknown) => createHandlerMock(config),
}));

async function* streamChunks(chunks: FakeChunk[]): AsyncGenerator<FakeChunk> {
	for (const chunk of chunks) {
		yield chunk;
	}
}

/**
 * The EXACT request string the production summarizer sent to the provider.
 * Captured from the mocked provider handler, not re-derived.
 */
let capturedSummarizerRequest = "";

beforeEach(() => {
	capturedSummarizerRequest = "";
	createHandlerMock.mockReset();
	createHandlerMock.mockReturnValue({
		createMessage: vi.fn((_systemPrompt: string, messages: unknown[]) => {
			const first = messages[0] as { content?: string } | undefined;
			capturedSummarizerRequest = first?.content ?? "";
			return streamChunks([
				{ type: "text", id: "summary-1", text: "## Goal\nContinue the work" },
				{ type: "done", id: "summary-1", success: true },
			]);
		}),
	});
});

const MODEL = {
	id: "mock-model",
	provider: "anthropic",
	// A deliberately small input limit so the REAL auto-mode eligibility
	// check (`shouldCompact`) is TRUE and the production compaction path
	// actually runs. The summarizer budget falls back to
	// MIN_AGENTIC_SUMMARY_INPUT_TOKENS, which is ample for these fixtures.
	info: { id: "mock-model", maxInputTokens: 10 },
} as const;

const SYSTEM_PROMPT = "You are a helpful coding assistant.";

/** A typed user turn (a real turn start). */
function userTurn(text: string): MessageWithMetadata {
	return { role: "user", content: [{ type: "text", text }] };
}

/** An assistant turn issuing a tool call. */
function toolCall(
	id: string,
	name: string,
	input: Record<string, unknown>,
): MessageWithMetadata {
	return {
		role: "assistant",
		content: [{ type: "tool_use", id, name, input }],
	};
}

/**
 * A user turn carrying a tool result whose `content` is the RUNTIME shape:
 * an array that may hold untyped `{query, result, success}` entries.
 */
function toolResult(
	toolUseId: string,
	name: string,
	content: unknown,
	options: { isError?: boolean } = {},
): MessageWithMetadata {
	return {
		role: "user",
		content: [
			{
				type: "tool_result",
				tool_use_id: toolUseId,
				name,
				content,
				...(options.isError ? { is_error: true } : {}),
			},
		] as MessageWithMetadata["content"] extends Array<infer T> ? T[] : never,
	};
}

/** An assistant turn with plain text (the preserved tail). */
function assistantTurn(text: string): MessageWithMetadata {
	return { role: "assistant", content: [{ type: "text", text }] };
}

/**
 * Drive the REAL production agentic-compaction seam and return the exact
 * summarizer request it produced.
 */
async function runAgenticCompactionAndCaptureRequest(input: {
	messages: MessageWithMetadata[];
	preserveRecentTokens?: number;
}): Promise<{ request: string; result: unknown }> {
	const prepareTurn = createContextCompactionPrepareTurn({
		providerId: "anthropic",
		modelId: "mock-model",
		providerConfig: {
			providerId: "anthropic",
			modelId: "mock-model",
		} as LlmsProviders.ProviderConfig,
		compaction: {
			enabled: true,
			strategy: "agentic",
			preserveRecentTokens: input.preserveRecentTokens ?? 1,
		},
		logger: undefined,
	});
	const result = await prepareTurn?.({
		agentId: "agent-1",
		conversationId: "conv-1",
		parentAgentId: null,
		iteration: 1,
		abortSignal: new AbortController().signal,
		systemPrompt: SYSTEM_PROMPT,
		tools: [],
		messages: input.messages,
		apiMessages: input.messages,
		model: MODEL,
	});
	return { request: capturedSummarizerRequest, result };
}

// ---------------------------------------------------------------------------
// The decisive Helm observation (safe, approved content).
// ---------------------------------------------------------------------------

const HELM_CALL_ID = "call_helm_render_001";
const HELM_IMAGE = "quay.io/keycloak/keycloak:26.0.7";
const HELM_OUTPUT = [
	"rc=0",
	'213:          image: "quay.io/keycloak/keycloak:26.0.7"',
	"210:          securityContext:",
	"211:            runAsNonRoot: true",
].join("\n");

describe("ACT-CLINEMM-COMPACTION-TOOL-RESULT-SHAPE-REPRO01 — production-seam RED", () => {
	it("SCENARIO 1: a successful run_commands result with untyped {query, result, success} entries reaches the summarizer input", async () => {
		const messages = [
			userTurn("Render the helm chart and report the image."),
			toolCall(HELM_CALL_ID, "run_commands", {
				commands: ["helm template kc-test . -f values.yaml"],
			}),
			toolResult(HELM_CALL_ID, "run_commands", [
				{
					query: "helm template kc-test . -f values.yaml",
					result: HELM_OUTPUT,
					success: true,
				},
			]),
			assistantTurn("The render finished."),
		];

		const { request, result } = await runAgenticCompactionAndCaptureRequest({
			messages,
		});

		// The compaction really ran and the summarizer really was called.
		expect(result).toBeDefined();
		expect(request.length).toBeGreaterThan(0);

		// The CANONICAL result carries the useful output...
		expect(JSON.stringify(messages)).toContain(HELM_IMAGE);
		// ...and the corresponding tool call is present...
		expect(JSON.stringify(messages)).toContain(HELM_CALL_ID);

		// ...so the summarizer-input projection MUST carry it too.
		expect(request).toContain(HELM_IMAGE);
	});

	it("SCENARIO 2: multiple command results with mixed success/failure retain their individual outcomes", async () => {
		const messages = [
			userTurn("Run the migration and the verification."),
			toolCall("call_mixed_001", "run_commands", {
				commands: ["migrate-up", "verify-schema"],
			}),
			toolResult("call_mixed_001", "run_commands", [
				{
					query: "migrate-up",
					result: "MIGRATION_OK schema version 42",
					success: true,
				},
				{
					query: "verify-schema",
					result: "verify-schema failed: relation does not exist",
					success: false,
					error: "Command failed with exit code 2",
				},
			]),
			assistantTurn("Migration ran; verification failed."),
		];

		const { request, result } = await runAgenticCompactionAndCaptureRequest({
			messages,
		});

		expect(result).toBeDefined();
		expect(request.length).toBeGreaterThan(0);

		// The successful command's decisive output survives.
		expect(request).toContain("MIGRATION_OK schema version 42");
		// The failed command's decisive output survives too — a mixed batch
		// must not become "wholly successful", and a failure must not hide.
		expect(request).toContain("relation does not exist");
	});
});

describe("ACT-CLINEMM-COMPACTION-TOOL-RESULT-SHAPE-REPRO01 — conservation controls", () => {
	it("SCENARIO 3 (conservation control): typed text and file results are preserved", async () => {
		const messages = [
			userTurn("Read the manifest and the chart."),
			toolCall("call_typed_001", "read_files", {
				files: [{ path: "/tmp/manifest.yaml" }],
			}),
			toolResult("call_typed_001", "read_files", [
				{ type: "text", text: "TYPED_TEXT_MARKER manifest loaded" },
				{
					type: "file",
					path: "/tmp/chart.yaml",
					content: "TYPED_FILE_MARKER apiVersion: v2",
				},
			]),
			assistantTurn("Read the files."),
		];

		const { request, result } = await runAgenticCompactionAndCaptureRequest({
			messages,
		});

		expect(result).toBeDefined();
		expect(request.length).toBeGreaterThan(0);

		// The typed blocks the published serializer recognizes are conserved.
		expect(request).toContain("TYPED_TEXT_MARKER manifest loaded");
		expect(request).toContain("TYPED_FILE_MARKER apiVersion: v2");
	});

	it("SCENARIO 3b (mechanism separation): an image block is dropped by the BUDGET PROJECTION policy, not by the serializer", async () => {
		// The `agentic_summary` budget projection drops unsafe blocks (image /
		// media / redacted thinking) outside the protected live tail
		// (`budget-projection/project.ts`: `isNestedUnsafeToolResultBlock` +
		// `dropUnsafeOutsideLiveTail`). That is a SEPARATE, deliberate
		// mechanism from the serializer's `default:` branch.
		//
		// This control pins the distinction: the typed IMAGE entry never
		// reaches the serializer at all, whereas the typed TEXT entry does and
		// survives it.
		const messages = [
			userTurn("Read the manifest."),
			toolCall("call_typed_img_001", "read_files", {
				files: [{ path: "/tmp/manifest.yaml" }],
			}),
			toolResult("call_typed_img_001", "read_files", [
				{ type: "text", text: "TYPED_TEXT_MARKER manifest loaded" },
				{
					type: "image",
					mediaType: "image/png",
					data: "iVBORw0KGgo=",
				},
			]),
			assistantTurn("Read the files."),
		];

		const { request, result } = await runAgenticCompactionAndCaptureRequest({
			messages,
		});

		expect(result).toBeDefined();
		expect(request.length).toBeGreaterThan(0);

		// The typed text entry survives the projection AND the serializer.
		expect(request).toContain("TYPED_TEXT_MARKER manifest loaded");
		// The image entry is dropped upstream of the serializer, by the
		// budget projection's documented unsafe-block policy.
		expect(request).not.toContain("[image:image/png]");
	});

	it("SCENARIO 4: the safe, decisive Helm observation survives the projection", async () => {
		const messages = [
			userTurn("Confirm the effective image."),
			toolCall(HELM_CALL_ID, "run_commands", {
				commands: ["helm template kc-test . -f values.yaml"],
			}),
			toolResult(HELM_CALL_ID, "run_commands", [
				{
					query: "helm template kc-test . -f values.yaml",
					result: HELM_OUTPUT,
					success: true,
				},
			]),
			assistantTurn("Done."),
		];

		const { request } = await runAgenticCompactionAndCaptureRequest({
			messages,
		});

		expect(request).toContain(HELM_IMAGE);
	});

	it("SCENARIO 5 (negative control): a credential-bearing sibling payload does not hide the safe observation", async () => {
		const syntheticSecret = "SYNTHETIC-DO-NOT-USE-pw-abc123";
		const messages = [
			userTurn("Apply the secret and then render."),
			toolCall("call_cred_001", "run_commands", {
				commands: ["apply-secret", "helm template kc-test . -f values.yaml"],
			}),
			toolResult("call_cred_001", "run_commands", [
				{
					query: "apply-secret",
					result: `applied secret with password=${syntheticSecret}`,
					success: true,
				},
				{
					query: "helm template kc-test . -f values.yaml",
					result: HELM_OUTPUT,
					success: true,
				},
			]),
			assistantTurn("Applied and rendered."),
		];

		const { request, result } = await runAgenticCompactionAndCaptureRequest({
			messages,
		});

		expect(result).toBeDefined();
		expect(request.length).toBeGreaterThan(0);

		// The safe Helm observation MUST survive even when a sibling payload
		// carries credential-bearing output.
		expect(request).toContain(HELM_IMAGE);
	});
});

describe("ACT-CLINEMM-COMPACTION-TOOL-RESULT-SHAPE-REPRO01 — repeated compaction", () => {
	it("SCENARIO 6: a second compaction with a prior summary carries the new evidence", async () => {
		const firstSummary = [
			"## Goal",
			"Continue the helm deployment.",
			"",
			"## Next",
			"- Re-render the chart",
		].join("\n");

		const messages = [
			{
				role: "user" as const,
				content: [
					{
						type: "text" as const,
						text: `Context summary:\n\n${firstSummary}`,
					},
				],
				metadata: {
					kind: "compaction_summary",
					displayRole: "system",
					userRunSpan: 1,
					summary: firstSummary,
					details: { readFiles: [], modifiedFiles: [] },
					tokensBefore: 10_000,
					generatedAt: 1,
				},
			},
			userTurn("Re-render the chart with the new values."),
			toolCall(HELM_CALL_ID, "run_commands", {
				commands: ["helm template kc-test . -f values.yaml"],
			}),
			toolResult(HELM_CALL_ID, "run_commands", [
				{
					query: "helm template kc-test . -f values.yaml",
					result: HELM_OUTPUT,
					success: true,
				},
			]),
			assistantTurn("Re-rendered."),
		];

		const { request, result } = await runAgenticCompactionAndCaptureRequest({
			messages,
		});

		expect(result).toBeDefined();
		expect(request.length).toBeGreaterThan(0);

		// The prior summary is handed to the summarizer...
		expect(request).toContain("Previous summary:");
		expect(request).toContain("Continue the helm deployment.");
		// ...and the NEW evidence is folded in, without duplicating the prior
		// summary's own text.
		expect(request).toContain(HELM_IMAGE);
		expect(request.match(/Continue the helm deployment\./g)?.length).toBe(1);
	});
});

describe("ACT-CLINEMM-COMPACTION-TOOL-RESULT-SHAPE-REPRO01 — malformed and sensitive payloads", () => {
	it("SCENARIO 7: a malformed payload with no status signal is classified as unknown, never promoted to success", async () => {
		const messages = [
			userTurn("Run the unclassified command."),
			toolCall("call_malformed_001", "run_commands", {
				commands: ["unclassified-command"],
			}),
			toolResult("call_malformed_001", "run_commands", [
				{
					query: "unclassified-command",
					result: "MALFORMED_OUTPUT_MARKER ran without a status signal",
				},
			]),
			assistantTurn("Ran it."),
		];

		const { request, result } = await runAgenticCompactionAndCaptureRequest({
			messages,
		});

		expect(result).toBeDefined();
		expect(request.length).toBeGreaterThan(0);

		// The payload is described with its OWN status, which is NOT success.
		expect(request).toContain("[unknown] unclassified-command");
		expect(request).toContain("MALFORMED_OUTPUT_MARKER ran without a status");
		expect(request).not.toContain("[succeeded] unclassified-command");
	});

	it("SCENARIO 8: an unsupported tool-result shape is classified explicitly and its content is NOT copied", async () => {
		const messages = [
			userTurn("Run the odd tool."),
			toolCall("call_odd_001", "run_commands", {
				commands: ["odd-command"],
			}),
			toolResult("call_odd_001", "run_commands", [
				{
					unexpectedField: "UNSUPPORTED_CONTENT_MARKER",
					anotherField: "MORE_UNSUPPORTED_MARKER",
				},
			]),
			assistantTurn("Ran it."),
		];

		const { request, result } = await runAgenticCompactionAndCaptureRequest({
			messages,
		});

		expect(result).toBeDefined();
		expect(request.length).toBeGreaterThan(0);

		// The unsupported shape is CLASSIFIED, never silently dropped...
		expect(request).toContain("[unsupported tool result shape]");
		// ...and none of its content is promoted into the summarizer input.
		expect(request).not.toContain("UNSUPPORTED_CONTENT_MARKER");
		expect(request).not.toContain("MORE_UNSUPPORTED_MARKER");
	});

	it("SCENARIO 9 (credential negative control): synthetic credentials in a structured payload are redacted, and the safe sibling survives", async () => {
		const syntheticSecret = "SYNTHETIC-DO-NOT-USE-pw-abc123";
		const messages = [
			userTurn("Apply the secret and then render."),
			toolCall("call_cred_002", "run_commands", {
				commands: ["apply-secret", "helm template kc-test . -f values.yaml"],
			}),
			toolResult("call_cred_002", "run_commands", [
				{
					query: "apply-secret",
					result: `applied secret with password=${syntheticSecret}`,
					success: true,
				},
				{
					query: "helm template kc-test . -f values.yaml",
					result: HELM_OUTPUT,
					success: true,
				},
			]),
			assistantTurn("Applied and rendered."),
		];

		const { request, result } = await runAgenticCompactionAndCaptureRequest({
			messages,
		});

		expect(result).toBeDefined();
		expect(request.length).toBeGreaterThan(0);

		// The SYNTHETIC credential never reaches the summarizer input.
		expect(request).not.toContain(syntheticSecret);
		expect(request).toContain("[REDACTED]");
		// The safe, decisive Helm observation survives alongside it.
		expect(request).toContain(HELM_IMAGE);
	});

	it("SCENARIO 10 (repeated compaction): a second compaction over the SAME canonical evidence does not duplicate it", async () => {
		const buildMessages = (): MessageWithMetadata[] => [
			userTurn("Render the helm chart and report the image."),
			toolCall(HELM_CALL_ID, "run_commands", {
				commands: ["helm template kc-test . -f values.yaml"],
			}),
			toolResult(HELM_CALL_ID, "run_commands", [
				{
					query: "helm template kc-test . -f values.yaml",
					result: HELM_OUTPUT,
					success: true,
				},
			]),
			assistantTurn("The render finished."),
		];

		const first = await runAgenticCompactionAndCaptureRequest({
			messages: buildMessages(),
		});
		const second = await runAgenticCompactionAndCaptureRequest({
			messages: buildMessages(),
		});

		expect(first.result).toBeDefined();
		expect(second.result).toBeDefined();

		// The same canonical evidence yields the SAME summarizer input: the
		// projection is a pure function of the canonical history, so a
		// repeated compaction cannot accumulate copies.
		expect(second.request).toBe(first.request);
		expect(
			second.request.match(/quay\.io\/keycloak\/keycloak:26\.0\.7/g)?.length,
		).toBe(1);
	});
});
