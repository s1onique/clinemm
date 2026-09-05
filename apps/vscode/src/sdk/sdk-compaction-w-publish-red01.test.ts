/**
 * ACT-CLINEMM-FACTORIZE-F1-WORKING-CONTEXT-CARRIER-AUTHORITY01
 * (seventy-seventh-pass): post-compaction W publication RED.
 *
 * Phase: C1_GO_RED_TO_GREEN (per the seventy-seventh-pass
 * reviewer directive):
 *
 *   "I would choose Option 1 (APPROXIMATE_MANUAL_W named
 *    POST_COMPACTION_CURRENT_CONFIG_W) over Option 2."
 *
 *   "The repair is the explicit-estimator variant:
 *      raw compact -> result.messages ->
 *      estimateRequestInputTokens(
 *        sessionConfig.systemPrompt,
 *        result.messages,
 *        sessionConfig.extraTools ?? []
 *      )
 *      -> return currentWorkingContextEstimate"
 *
 * This file is the RED test for that repair. The mock pattern
 * mirrors the existing sdk-compaction.test.ts: a hand-rolled
 * `createContextCompactionPrepareTurn` stub returns the same
 * shape a real successful manual compaction would return. R2
 * (the architectural approximation discriminator) is pure and
 * does not depend on the seam -- it pins the
 * APPROXIMATE->CANONICAL boundary forever.
 *
 * Pre-repair (HEAD = ab68c57dc):
 *
 *   compact returns { messages: [...], systemPrompt: "rewritten" }
 *     (CoreCompactionResult has no W field)
 *   => sdk-compaction.ts:184 reads
 *        currentWorkingContextEstimate: result.currentWorkingContextEstimate
 *      which is `undefined`
 *   => returns { compacted: true, messages, compactionState,
 *                currentWorkingContextEstimate: undefined }
 *
 * Post-repair (Option 1, this ACT):
 *
 *   compact returns { messages: [...], systemPrompt: "rewritten" }
 *   => sdk-compaction.ts:184 explicitly computes
 *        currentWorkingContextEstimate
 *          = estimateRequestInputTokens({
 *              systemPrompt: input.config.systemPrompt,
 *              messages: result.messages,
 *              tools: input.config.extraTools ?? [],
 *            })
 *   => returns { compacted: true, messages, compactionState,
 *                currentWorkingContextEstimate: <number> }
 *
 * The value is bounded at the manual-publication moment using
 * SESSION-CONFIG-TIME operands (not runtime-composed operands).
 * Quality is APPROXIMATE per POST_COMPACTION_CURRENT_CONFIG_W.
 *
 * Four assertions:
 *
 *   R1 -- Real-producer W publication (post-repair contract):
 *        result.currentWorkingContextEstimate ===
 *        estimateRequestInputTokens({
 *          systemPrompt: input.config.systemPrompt,
 *          messages: result.messages,
 *          tools: input.config.extraTools ?? [],
 *        })
 *
 *   R2 -- Approximation discriminator (architectural freeze,
 *         pure):
 *        POST_COMPACTION_CURRENT_CONFIG_W
 *          != CANONICAL_RUNTIME_W
 *        when runtime-added tools exist. Pins the
 *        approximation contract forever.
 *
 *   R3 -- Empty-operands negative control (load-bearing
 *         metadata):
 *        Proves the threaded metadata is load-bearing. If the
 *        repair ever regresses to empty operands, this
 *        flips RED.
 *
 *   R4 -- No-op branch contract:
 *        messages === undefined MUST NOT publish optimistic W.
 *        Failure-closed at the carrier
 *        (UNDEFINED_W_STALE_REUSE = FORBIDDEN).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { estimateRequestInputTokens } from "@cline/shared"

// ---- Mocks for the @cline/core seam (mirror sdk-compaction.test.ts) ----

const createContextCompactionPrepareTurn = vi.fn()
const createSessionCompactionState = vi.fn((input: unknown) => ({ version: 1, input }))
vi.mock("@cline/core", () => ({
	createContextCompactionPrepareTurn: (...args: unknown[]) =>
		createContextCompactionPrepareTurn(...args),
	createSessionCompactionState: (input: unknown) => createSessionCompactionState(input),
}))

vi.mock("@/shared/services/Logger", () => ({
	Logger: { debug: vi.fn(), error: vi.fn(), log: vi.fn(), warn: vi.fn() },
}))

// Imported lazily after mocks are wired so the production code
// under test sees the mocked @cline/core.
let compactSessionMessages: typeof import("./sdk-compaction").compactSessionMessages

const SYSTEM_PROMPT =
	"You are a concise coding assistant. Help with tasks succinctly."

// Two minimal tool entries -- same shape as the RED baseline at
// compaction.real-producer-seam-red.test.ts (snake_case
// `input_schema`). The exact TS-shape is irrelevant; the
// estimator receives `tools: readonly unknown[]` and
// JSON.stringifies them.
const TOOLS = [
	{
		name: "read_files",
		description: "Read files",
		input_schema: { type: "object" },
	},
]

const MESSAGES_BEFORE = [
	{ role: "user" as const, content: "List the files in /tmp" },
	{
		role: "assistant" as const,
		content: "I will list the files in /tmp for you.",
	},
	{
		role: "user" as const,
		content: "Also show the largest file size in each dir",
	},
	{
		role: "assistant" as const,
		content: "Here are the sizes: ...",
	},
]

// The shape a successful manual compaction would return from
// @cline/core under the existing prod seam
// (sdk/packages/core/src/extensions/context/compaction.ts).
const PROJECTED_MESSAGES = [
	{ role: "user" as const, content: "summary" },
]

function makeBaseConfig() {
	return {
		providerConfig: {
			providerId: "anthropic",
			modelId: "claude-test",
		} as never,
		providerId: "anthropic",
		modelId: "claude-test",
		knownModels: {
			"claude-test": { id: "claude-test", maxInputTokens: 200_000 },
		},
		compaction: { enabled: true, strategy: "basic" },
		logger: undefined,
		telemetry: undefined,
		systemPrompt: SYSTEM_PROMPT,
		extraTools: TOOLS,
	} as unknown as Parameters<typeof compactSessionMessages>[0]["config"]
}

describe("compactSessionMessages -- Option 1 W publication (seventy-seventh-pass RED)", () => {
	beforeAll(async () => {
		;({ compactSessionMessages } = await import("./sdk-compaction"))
	})

	beforeEach(() => {
		vi.clearAllMocks()
	})

	afterAll(() => {
		vi.useRealTimers()
	})

	it("R1 -- successful manual compaction returns numeric POST_COMPACTION_CURRENT_CONFIG_W from session-config operands", async () => {
		const compact = vi.fn().mockResolvedValue({
			messages: PROJECTED_MESSAGES,
			systemPrompt: "rewritten system",
			// Note: CoreCompactionResult has no W field by design.
			// The manual seam is responsible for computing W.
		})
		createContextCompactionPrepareTurn.mockReturnValueOnce(compact)

		const result = await compactSessionMessages({
			config: makeBaseConfig(),
			sessionId: "session-red-r1",
			messages: MESSAGES_BEFORE,
		})

		expect(result.compacted).toBe(true)
		expect(result.messages).toEqual(PROJECTED_MESSAGES)
		expect(typeof result.currentWorkingContextEstimate).toBe("number")
		expect(result.currentWorkingContextEstimate).toBeGreaterThan(0)

		// Exact Option-1 product contract:
		// W is bound to the session-config operands, NOT to
		// runtime-composed operands. The next-prepareTurn
		// boundary replaces this with CANONICAL_RUNTIME_W.
		const expectedW = estimateRequestInputTokens({
			systemPrompt: SYSTEM_PROMPT,
			messages: PROJECTED_MESSAGES,
			tools: TOOLS,
		})
		expect(result.currentWorkingContextEstimate).toBe(expectedW)
	})

	it("R3 -- empty-operands negative control: W is bound to threaded metadata, not to empty defaults", async () => {
		const compact = vi.fn().mockResolvedValue({
			messages: PROJECTED_MESSAGES,
			systemPrompt: "rewritten system",
		})
		createContextCompactionPrepareTurn.mockReturnValueOnce(compact)

		const result = await compactSessionMessages({
			config: makeBaseConfig(),
			sessionId: "session-red-r3",
			messages: MESSAGES_BEFORE,
		})

		expect(result.compacted).toBe(true)
		expect(typeof result.currentWorkingContextEstimate).toBe("number")

		// If the repair regresses to passing `systemPrompt: ""`
		// and `tools: []` into the estimator (the historic bug
		// shape from the upstream wrapper), this assertion
		// flips RED.
		const emptyOperandsW = estimateRequestInputTokens({
			systemPrompt: "",
			messages: PROJECTED_MESSAGES,
			tools: [],
		})
		expect(result.currentWorkingContextEstimate).not.toBe(emptyOperandsW)
	})

	it("R2 -- approximation discriminator (pure, no seam): POST_COMPACTION_CURRENT_CONFIG_W != CANONICAL_RUNTIME_W when runtime-added tools exist", () => {
		// The contract: sessionConfig.extraTools is a strict
		// subset of the effective runtime tool set whenever the
		// runtime adds tools (plugin/MCP/addTools paths). The
		// 77th-pass reviewer froze this as
		// INCOMPLETE_WHEN_RUNTIME_TOOLS_EXIST.
		//
		// This assertion is pure -- no mock, no seam. It pins the
		// architectural discriminator forever: a future evidence
		// pass cannot silently promote APPROXIMATE -> CANONICAL
		// because at least one valid runtime geometry
		// (configuredTools + runtimeAddedTool) is now bound to
		// produce a different W than the session-config-only
		// operand set.
		const configuredTools = TOOLS

		const runtimeAddedTool = {
			name: "mcp_server_tool",
			description:
				"Runtime-added MCP server tool with a long description",
			input_schema: {
				type: "object",
				properties: {
					query: { type: "string", description: "search query" },
				},
				required: ["query"],
			},
		}

		const currentConfigW = estimateRequestInputTokens({
			systemPrompt: SYSTEM_PROMPT,
			messages: MESSAGES_BEFORE,
			tools: configuredTools,
		})

		const fullRuntimeW = estimateRequestInputTokens({
			systemPrompt: SYSTEM_PROMPT,
			messages: MESSAGES_BEFORE,
			tools: [...configuredTools, runtimeAddedTool],
		})

		expect(currentConfigW).not.toBe(fullRuntimeW)
		expect(fullRuntimeW).toBeGreaterThan(currentConfigW)
	})

	it("R4 -- no-op branch (messages === undefined metadata-only) MUST NOT publish optimistic W", async () => {
		// When the inner compact returns a metadata-only shape
		// (just W, no messages), this is a "no real compaction"
		// signal for manual mode. The seam must NOT publish W
		// for it -- the bar should stay on its prior value
		// (which the carrier handles as failure-closed).
		const compact = vi.fn().mockResolvedValue({
			currentWorkingContextEstimate: 4242,
			// No messages, no systemPrompt -- metadata-only.
		})
		createContextCompactionPrepareTurn.mockReturnValueOnce(compact)

		const result = await compactSessionMessages({
			config: makeBaseConfig(),
			sessionId: "session-red-r4",
			messages: MESSAGES_BEFORE,
		})

		expect(result.compacted).toBe(false)
		expect(result.currentWorkingContextEstimate).toBeUndefined()
	})
})
