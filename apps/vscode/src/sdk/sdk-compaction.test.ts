import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

const createContextCompactionPrepareTurn = vi.fn()
const createSessionCompactionState = vi.fn((input: unknown) => ({ version: 1, input }))
vi.mock("@cline/core", () => ({
	createContextCompactionPrepareTurn: (...args: unknown[]) => createContextCompactionPrepareTurn(...args),
	createSessionCompactionState: (input: unknown) => createSessionCompactionState(input),
}))

vi.mock("@/shared/services/Logger", () => ({
	Logger: { debug: vi.fn(), error: vi.fn(), log: vi.fn(), warn: vi.fn() },
}))

let compactSessionMessages: typeof import("./sdk-compaction").compactSessionMessages

const baseConfig = {
	providerConfig: { providerId: "anthropic", modelId: "claude" },
	providerId: "anthropic",
	modelId: "claude",
	knownModels: { claude: { id: "claude", maxInputTokens: 200_000 } },
	compaction: undefined,
	logger: undefined,
	telemetry: undefined,
} as unknown as Parameters<typeof compactSessionMessages>[0]["config"]

describe("compactSessionMessages", () => {
	beforeAll(async () => {
		;({ compactSessionMessages } = await import("./sdk-compaction"))
	})

	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("returns compacted=false without invoking the SDK when there are no messages", async () => {
		const result = await compactSessionMessages({ config: baseConfig, sessionId: "s1", messages: [] })

		expect(result).toEqual({ compacted: false, messages: [] })
		expect(createContextCompactionPrepareTurn).not.toHaveBeenCalled()
	})

	it("builds a manual-mode prepareTurn and force-enables compaction", async () => {
		const compact = vi
			.fn()
			.mockResolvedValue({ messages: [{ role: "user", content: "summary" }], systemPrompt: "rewritten system" })
		createContextCompactionPrepareTurn.mockReturnValueOnce(compact)

		const messages = [
			{ role: "user" as const, content: "1" },
			{ role: "assistant" as const, content: "2" },
		]
		const result = await compactSessionMessages({ config: baseConfig, sessionId: "s1", messages })

		// Manual mode + enabled compaction + telemetry keying.
		expect(createContextCompactionPrepareTurn).toHaveBeenCalledWith(
			expect.objectContaining({
				providerId: "anthropic",
				modelId: "claude",
				compaction: expect.objectContaining({ enabled: true }),
				sessionId: "s1",
			}),
			{ mode: "manual" },
		)
		expect(compact).toHaveBeenCalledOnce()
		expect(createSessionCompactionState).toHaveBeenCalledWith({
			sourceMessages: messages,
			compactedMessages: [{ role: "user", content: "summary" }],
			conversationId: "s1",
			systemPrompt: "rewritten system",
		})
		expect(result).toEqual({
			compacted: true,
			messages: [{ role: "user", content: "summary" }],
			compactionState: { version: 1, input: expect.anything() },
		})
	})

	it("preserves context-only model limits for the shared resolver", async () => {
		const compact = vi.fn().mockResolvedValue({ messages: [{ role: "user", content: "summary" }] })
		createContextCompactionPrepareTurn.mockReturnValueOnce(compact)
		const contextOnlyConfig = {
			...baseConfig,
			knownModels: { claude: { id: "claude", contextWindow: 400_000 } },
		} as unknown as Parameters<typeof compactSessionMessages>[0]["config"]

		await compactSessionMessages({
			config: contextOnlyConfig,
			sessionId: "s-context-only",
			messages: [{ role: "user", content: "long context" }],
		})

		expect(compact).toHaveBeenCalledWith(
			expect.objectContaining({
				model: expect.objectContaining({
					info: { id: "claude", contextWindow: 400_000 },
				}),
			}),
		)
	})

	it("returns compacted=false when prepareTurn is unavailable", async () => {
		createContextCompactionPrepareTurn.mockReturnValueOnce(undefined)

		const messages = [{ role: "user" as const, content: "1" }]
		const result = await compactSessionMessages({ config: baseConfig, sessionId: "s1", messages })

		expect(result).toEqual({ compacted: false, messages })
	})

	it("returns compacted=false when the strategy declines (returns undefined)", async () => {
		const compact = vi.fn().mockResolvedValue(undefined)
		createContextCompactionPrepareTurn.mockReturnValueOnce(compact)

		const messages = [{ role: "user" as const, content: "1" }]
		const result = await compactSessionMessages({ config: baseConfig, sessionId: "s1", messages })

		expect(result).toEqual({ compacted: false, messages })
	})

	// ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
	// (twenty-fourth-pass, P1, T1): regression guard for the
	// metadata-only prepareTurn result shape. The producer
	// (`publishWorkingContextEstimateMetadataOnly` in
	// `@cline/core`) returns
	//   { currentWorkingContextEstimate }
	// without `messages` / `systemPrompt` for every
	// prepareTurn to publish W on the producer-cadence
	// invariant. For manual compaction, this is a
	// no-op projection signal — NOT an actual compaction
	// artifact. The bounded contract:
	//
	//   defined ContextPipelinePrepareTurnResult
	//   ≠
	//   compaction necessarily occurred
	//
	//   real compaction artifact
	//   requires actual projected messages
	//
	// Without this regression test, a future change could
	// silently allow:
	//
	//   { compacted: true, messages: undefined, ... }
	//
	// or:
	//
	//   compactionState.compactedMessages = undefined
	//
	// without necessarily recreating the same TypeScript
	// error. This test pins the runtime semantic branch
	// that the typecheck fix in P0-A made possible.
	it("returns compacted=false on metadata-only prepareTurn result (W publish, no projection)", async () => {
		const compact = vi.fn().mockResolvedValue({ currentWorkingContextEstimate: 4242 })
		createContextCompactionPrepareTurn.mockReturnValueOnce(compact)

		const messages = [
			{ role: "user" as const, content: "1" },
			{ role: "assistant" as const, content: "2" },
		]
		const result = await compactSessionMessages({ config: baseConfig, sessionId: "s1", messages })

		// No real compaction happened — must report
		// compacted=false, return original messages, and
		// NOT build a compactionState (that would have
		// undefined compactedMessages, a hard schema
		// violation).
		expect(result.compacted).toBe(false)
		expect(result.messages).toEqual(messages)
		expect(result.compactionState).toBeUndefined()

		// The mock helper would have logged the call if
		// the consumer had mistakenly tried to build a
		// compactionState; verify it was NOT called.
		expect(createSessionCompactionState).not.toHaveBeenCalled()
	})
})
