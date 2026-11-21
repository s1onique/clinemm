/**
 * ACT-CLINEMM-BEFOREMODEL-OPERATOR-CHECKPOINT-01
 *
 * Executable evidence for the operator-configurable, request-local
 * `beforeModel` completion checkpoint.
 *
 * The suite drives the REAL production composition:
 *
 *   REAL SdkSessionConfigBuilder.build
 *     -> REAL buildAgentHooks (the production hook bag)
 *       -> REAL beforeModel (the typed hook contract)
 *         -> the provider-bound request projection
 *
 * Every assertion is written against the OBSERVABLE provider-bound
 * request, never against an internal helper.
 */

import type { AgentBeforeModelContext, AgentMessage, AgentModelRequest } from "@cline/shared"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { __resetPrimeInjectionStateForTests } from "../hooks-adapter"
import { __resetMycPrimeResultsForTests, recordMycPrimeResult } from "../myc-prime-automation"
import { SdkSessionConfigBuilder } from "../sdk-session-config-builder"

// ---------------------------------------------------------------------------
// Mocks: the session factory is replaced (it needs a real provider), but the
// HOOK composition under test is the real production code.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
	buildSessionConfig: vi.fn(),
}))

vi.mock("../cline-session-factory", () => ({
	buildSessionConfig: mocks.buildSessionConfig,
}))

const CHECKPOINT_TEXT = "CHECKPOINT: summarise the work so far before continuing."

interface SettingsShape {
	hooksEnabled?: boolean
	beforeModelCheckpointEnabled?: boolean
	beforeModelCheckpointText?: string
	beforeModelCheckpointInterval?: number
}

function makeStateManager(settings: SettingsShape) {
	return {
		getGlobalSettingsKey: vi.fn((key: string) => (settings as Record<string, unknown>)[key]),
		getInstanceSecret: vi.fn(() => undefined),
	} as never
}

/**
 * Build the REAL hook bag through the REAL `SdkSessionConfigBuilder`.
 */
async function buildRealHooks(settings: SettingsShape, sessionId = "session-under-test") {
	mocks.buildSessionConfig.mockImplementation(async () => ({ sessionId }) as never)
	const builder = new SdkSessionConfigBuilder({
		stateManager: makeStateManager(settings),
		emitHookMessage: vi.fn(),
	})
	const config = (await builder.build({ cwd: "/tmp" } as never)) as {
		hooks: {
			beforeModel?: (ctx: AgentBeforeModelContext) => Promise<unknown>
			onEvent?: (event: unknown) => void
		}
	}
	return config.hooks
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function userMessage(text: string): AgentMessage {
	return { id: `u-${text}`, role: "user", content: [{ type: "text", text }], createdAt: 1 }
}

function assistantToolCallMessage(toolCallIds: string[]): AgentMessage {
	return {
		id: `a-${toolCallIds.join("-")}`,
		role: "assistant",
		content: toolCallIds.map((id) => ({
			type: "tool-call" as const,
			toolCallId: id,
			toolName: "read_file",
			input: {},
		})),
		createdAt: 2,
	}
}

function toolResultMessage(toolCallIds: string[]): AgentMessage {
	return {
		id: `t-${toolCallIds.join("-")}`,
		role: "tool",
		content: toolCallIds.map((id) => ({
			type: "tool-result" as const,
			toolCallId: id,
			toolName: "read_file",
			output: "ok",
		})),
		createdAt: 3,
	}
}

interface CtxOptions {
	iteration: number
	messages: AgentMessage[]
	sessionId?: string
}

function makeCtx({ iteration, messages, sessionId = "session-under-test" }: CtxOptions): AgentBeforeModelContext {
	const request = {
		messages,
		systemPrompt: "SYSTEM PROMPT",
		tools: [{ name: "read_file", description: "read", inputSchema: { type: "object" } }],
		options: { metadata: { existing: "keep-me" } },
	} as unknown as AgentModelRequest
	return {
		snapshot: {
			agentId: "agent-1",
			sessionId,
			conversationId: "conv-1",
			runId: "run-1",
			status: "running",
			iteration,
			messages,
			pendingToolCalls: [],
			usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
		},
		request,
	} as unknown as AgentBeforeModelContext
}

/** The text of every message in the returned projection. */
function textsOf(result: unknown): string[] {
	const messages = (result as { messages?: readonly AgentMessage[] })?.messages ?? []
	return messages.flatMap((m) => m.content.filter((p) => p.type === "text").map((p) => (p as { text: string }).text))
}

/** The count of messages carrying the exact checkpoint text. */
function checkpointCount(result: unknown): number {
	return textsOf(result).filter((t) => t === CHECKPOINT_TEXT).length
}

function turnFinished(toolCallCount: number) {
	return { type: "turn-finished", iteration: 1, toolCallCount }
}

describe("ACT-CLINEMM-BEFOREMODEL-OPERATOR-CHECKPOINT-01 — real composition", () => {
	beforeEach(() => {
		mocks.buildSessionConfig.mockReset()
		__resetPrimeInjectionStateForTests()
		__resetMycPrimeResultsForTests()
	})

	// ---- 1. Disabled feature: provider request unchanged -----------------
	it("R1: with the feature disabled the provider request is unchanged", async () => {
		const hooks = await buildRealHooks({
			hooksEnabled: true,
			beforeModelCheckpointEnabled: false,
			beforeModelCheckpointText: CHECKPOINT_TEXT,
			beforeModelCheckpointInterval: 4,
		})
		const messages = [userMessage("hello")]
		const ctx = makeCtx({ iteration: 1, messages })

		// Advance the counter past the milestone so the disabled feature is
		// proven inert rather than merely un-triggered.
		for (let i = 0; i < 8; i += 1) {
			hooks.onEvent?.(turnFinished(1))
		}

		const result = await hooks.beforeModel?.(ctx)
		expect(result).toBeUndefined()
		expect(textsOf(result)).not.toContain(CHECKPOINT_TEXT)
	})

	// ---- 2. No checkpoint before the fourth completed tool-using turn -----
	it("R2: interval 4 produces no checkpoint before the fourth completed tool-using turn", async () => {
		const hooks = await buildRealHooks({
			hooksEnabled: true,
			beforeModelCheckpointEnabled: true,
			beforeModelCheckpointText: CHECKPOINT_TEXT,
			beforeModelCheckpointInterval: 4,
		})
		const messages = [userMessage("hello")]

		for (let turn = 1; turn <= 3; turn += 1) {
			hooks.onEvent?.(turnFinished(1))
			const result = await hooks.beforeModel?.(makeCtx({ iteration: turn + 1, messages }))
			expect(checkpointCount(result)).toBe(0)
		}
	})

	// ---- 3. Fourth completed tool-using turn: exact text in next request --
	it("R3: after the fourth completed tool-using turn the exact configured text appears in the next request", async () => {
		const hooks = await buildRealHooks({
			hooksEnabled: true,
			beforeModelCheckpointEnabled: true,
			beforeModelCheckpointText: CHECKPOINT_TEXT,
			beforeModelCheckpointInterval: 4,
		})
		const messages = [userMessage("hello")]

		for (let turn = 1; turn <= 4; turn += 1) {
			hooks.onEvent?.(turnFinished(1))
		}
		const result = await hooks.beforeModel?.(makeCtx({ iteration: 5, messages }))
		expect(textsOf(result)).toContain(CHECKPOINT_TEXT)
		expect(checkpointCount(result)).toBe(1)
	})

	// ---- 4. Multiple tools in one assistant turn count as ONE turn -------
	it("R4: multiple tools in one assistant turn count as a single turn", async () => {
		const hooks = await buildRealHooks({
			hooksEnabled: true,
			beforeModelCheckpointEnabled: true,
			beforeModelCheckpointText: CHECKPOINT_TEXT,
			beforeModelCheckpointInterval: 4,
		})
		const messages = [userMessage("hello")]

		// Three tool calls in ONE turn -> ONE completed tool-using turn.
		hooks.onEvent?.(turnFinished(3))
		hooks.onEvent?.(turnFinished(3))
		hooks.onEvent?.(turnFinished(3))

		const result = await hooks.beforeModel?.(makeCtx({ iteration: 4, messages }))
		expect(checkpointCount(result)).toBe(0)
	})

	// ---- 5. Eligible checkpoint appears once in a prepared request -------
	it("R5: the eligible checkpoint appears exactly once in a prepared request", async () => {
		const hooks = await buildRealHooks({
			hooksEnabled: true,
			beforeModelCheckpointEnabled: true,
			beforeModelCheckpointText: CHECKPOINT_TEXT,
			beforeModelCheckpointInterval: 4,
		})
		const messages = [userMessage("hello")]

		for (let turn = 1; turn <= 4; turn += 1) {
			hooks.onEvent?.(turnFinished(1))
		}
		const result = await hooks.beforeModel?.(makeCtx({ iteration: 5, messages }))
		expect(checkpointCount(result)).toBe(1)
	})

	// ---- 6. Provider retry does not duplicate the checkpoint --------------
	it("R6: a provider retry that reuses the prepared projection does not duplicate the checkpoint", async () => {
		const hooks = await buildRealHooks({
			hooksEnabled: true,
			beforeModelCheckpointEnabled: true,
			beforeModelCheckpointText: CHECKPOINT_TEXT,
			beforeModelCheckpointInterval: 4,
		})
		const messages = [userMessage("hello")]

		for (let turn = 1; turn <= 4; turn += 1) {
			hooks.onEvent?.(turnFinished(1))
		}
		const ctx = makeCtx({ iteration: 5, messages })
		const first = await hooks.beforeModel?.(ctx)
		expect(checkpointCount(first)).toBe(1)

		// The runtime re-issues the SAME prepared projection on a provider
		// retry: the hook is not re-invoked, and the projection still
		// carries exactly one checkpoint.
		const prepared = first as { messages: readonly AgentMessage[] }
		expect(checkpointCount({ messages: prepared.messages })).toBe(1)

		// Even if the hook IS re-invoked against the already-prepared
		// request (defensive), it must NOT add a second copy. Returning
		// `undefined` means "no change" — the runtime keeps the request
		// as it is, so the provider-visible request still carries exactly
		// one checkpoint.
		const second = await hooks.beforeModel?.({
			...ctx,
			request: { ...ctx.request, messages: prepared.messages },
		})
		const providerVisible = second ? (second as { messages: readonly AgentMessage[] }).messages : prepared.messages
		expect(checkpointCount({ messages: providerVisible })).toBe(1)
	})

	// ---- 7. Zero-tool-call turns do not advance the counter --------------
	it("R7: zero-tool-call turns do not advance the counter", async () => {
		const hooks = await buildRealHooks({
			hooksEnabled: true,
			beforeModelCheckpointEnabled: true,
			beforeModelCheckpointText: CHECKPOINT_TEXT,
			beforeModelCheckpointInterval: 4,
		})
		const messages = [userMessage("hello")]

		// Three turns with NO tool calls.
		for (let turn = 1; turn <= 3; turn += 1) {
			hooks.onEvent?.(turnFinished(0))
		}
		const result = await hooks.beforeModel?.(makeCtx({ iteration: 4, messages }))
		expect(checkpointCount(result)).toBe(0)
	})

	// ---- 8. A fresh session resets the counter ---------------------------
	it("R8: a fresh session resets the counter", async () => {
		const settings = {
			hooksEnabled: true,
			beforeModelCheckpointEnabled: true,
			beforeModelCheckpointText: CHECKPOINT_TEXT,
			beforeModelCheckpointInterval: 4,
		}
		const first = await buildRealHooks(settings, "session-A")
		for (let turn = 1; turn <= 4; turn += 1) {
			first.onEvent?.(turnFinished(1))
		}
		expect(
			checkpointCount(
				await first.beforeModel?.(makeCtx({ iteration: 5, messages: [userMessage("a")], sessionId: "session-A" })),
			),
		).toBe(1)

		// A FRESH session (a fresh hook bag) starts from zero.
		const second = await buildRealHooks(settings, "session-B")
		const result = await second.beforeModel?.(makeCtx({ iteration: 1, messages: [userMessage("b")], sessionId: "session-B" }))
		expect(checkpointCount(result)).toBe(0)
	})

	// ---- 9/10. MYC prime composition ------------------------------------
	it("R9/R10: the MYC prime and the operator checkpoint compose without losing either message", async () => {
		recordMycPrimeResult({
			sessionId: "session-under-test",
			status: "ok",
			text: "PRIME PAYLOAD",
			ts: 42,
		})

		const hooks = await buildRealHooks({
			hooksEnabled: true,
			beforeModelCheckpointEnabled: true,
			beforeModelCheckpointText: CHECKPOINT_TEXT,
			beforeModelCheckpointInterval: 4,
		})
		const messages = [userMessage("hello")]

		// The FIRST request carries the prime (the prime's own iteration
		// gate is unchanged).
		const first = await hooks.beforeModel?.(makeCtx({ iteration: 1, messages }))
		const firstTexts = textsOf(first)
		expect(firstTexts.some((t) => t.includes("PRIME PAYLOAD"))).toBe(true)
		expect(checkpointCount(first)).toBe(0)

		// A RESUMED session can reach a checkpoint milestone on its very
		// first model request (the counter is advanced by the turns that
		// completed before the resume). That is the case in which the
		// prime and the operator checkpoint land in the SAME request, and
		// neither may be lost.
		const resumed = await buildRealHooks(
			{
				hooksEnabled: true,
				beforeModelCheckpointEnabled: true,
				beforeModelCheckpointText: CHECKPOINT_TEXT,
				beforeModelCheckpointInterval: 4,
			},
			"session-resumed",
		)
		recordMycPrimeResult({
			sessionId: "session-resumed",
			status: "ok",
			text: "PRIME PAYLOAD",
			ts: 43,
		})
		for (let turn = 1; turn <= 4; turn += 1) {
			resumed.onEvent?.(turnFinished(1))
		}
		const composed = await resumed.beforeModel?.(
			makeCtx({ iteration: 1, messages: [userMessage("hello")], sessionId: "session-resumed" }),
		)
		const composedTexts = textsOf(composed)
		// BOTH messages survive the composition.
		expect(composedTexts.some((t) => t.includes("PRIME PAYLOAD"))).toBe(true)
		expect(composedTexts).toContain(CHECKPOINT_TEXT)
		expect(checkpointCount(composed)).toBe(1)
		// The original message is still first, and the checkpoint is last.
		expect(composedTexts[0]).toBe("hello")
		expect(composedTexts[composedTexts.length - 1]).toBe(CHECKPOINT_TEXT)
	})

	// ---- 11. Tool schema, authorization and system prompt unchanged ------
	it("R11: the tool schema, options/metadata and the original messages are preserved", async () => {
		const hooks = await buildRealHooks({
			hooksEnabled: true,
			beforeModelCheckpointEnabled: true,
			beforeModelCheckpointText: CHECKPOINT_TEXT,
			beforeModelCheckpointInterval: 4,
		})
		const messages = [userMessage("hello"), assistantToolCallMessage(["c1"]), toolResultMessage(["c1"])]

		for (let turn = 1; turn <= 4; turn += 1) {
			hooks.onEvent?.(turnFinished(1))
		}
		const ctx = makeCtx({ iteration: 5, messages })
		const result = (await hooks.beforeModel?.(ctx)) as {
			messages: readonly AgentMessage[]
			systemPrompt?: string
			tools?: unknown[]
			options?: unknown
		}

		// The original messages and their ORDER are preserved.
		expect(result.messages.slice(0, messages.length).map((m) => m.id)).toEqual(messages.map((m) => m.id))
		// The system prompt is untouched (the hook never returns one).
		expect(result.systemPrompt).toBeUndefined()
		// The tool inventory is untouched (the hook never returns tools).
		expect(result.tools).toBeUndefined()
		// The request options/metadata are untouched.
		expect(result.options).toBeUndefined()
		// The persistent conversation history was NOT mutated.
		expect(ctx.request.messages).toHaveLength(messages.length)
	})

	// ---- 12. A malformed / overlength setting cannot modify a request ----
	it("R12: a malformed or over-length persisted setting cannot modify a provider request", async () => {
		const malformed: SettingsShape[] = [
			{
				hooksEnabled: true,
				beforeModelCheckpointEnabled: true,
				beforeModelCheckpointText: CHECKPOINT_TEXT,
				beforeModelCheckpointInterval: 0,
			},
			{
				hooksEnabled: true,
				beforeModelCheckpointEnabled: true,
				beforeModelCheckpointText: CHECKPOINT_TEXT,
				beforeModelCheckpointInterval: -3,
			},
			{
				hooksEnabled: true,
				beforeModelCheckpointEnabled: true,
				beforeModelCheckpointText: CHECKPOINT_TEXT,
				beforeModelCheckpointInterval: 2.5,
			},
			{
				hooksEnabled: true,
				beforeModelCheckpointEnabled: true,
				beforeModelCheckpointText: "",
				beforeModelCheckpointInterval: 4,
			},
			{
				hooksEnabled: true,
				beforeModelCheckpointEnabled: true,
				beforeModelCheckpointText: "x".repeat(5000),
				beforeModelCheckpointInterval: 4,
			},
		]
		for (const settings of malformed) {
			const hooks = await buildRealHooks(settings)
			for (let turn = 1; turn <= 8; turn += 1) {
				hooks.onEvent?.(turnFinished(1))
			}
			const result = await hooks.beforeModel?.(makeCtx({ iteration: 9, messages: [userMessage("hello")] }))
			expect(result).toBeUndefined()
		}
	})

	// ---- 13. The parent Hooks setting disables effective injection --------
	it("R13: the existing Hooks setting off makes the checkpoint ineffective without deleting the saved text", async () => {
		const hooks = await buildRealHooks({
			hooksEnabled: false,
			beforeModelCheckpointEnabled: true,
			beforeModelCheckpointText: CHECKPOINT_TEXT,
			beforeModelCheckpointInterval: 4,
		})
		for (let turn = 1; turn <= 8; turn += 1) {
			hooks.onEvent?.(turnFinished(1))
		}
		const result = await hooks.beforeModel?.(makeCtx({ iteration: 9, messages: [userMessage("hello")] }))
		expect(result).toBeUndefined()
		expect(textsOf(result)).not.toContain(CHECKPOINT_TEXT)
	})

	// ---- 14. The effective configuration is frozen per session -----------
	it("R14: an active session keeps its frozen configuration when the settings change mid-task", async () => {
		const settings: SettingsShape = {
			hooksEnabled: true,
			beforeModelCheckpointEnabled: true,
			beforeModelCheckpointText: CHECKPOINT_TEXT,
			beforeModelCheckpointInterval: 4,
		}
		const hooks = await buildRealHooks(settings)

		// The operator changes the settings mid-task.
		settings.beforeModelCheckpointEnabled = false
		settings.beforeModelCheckpointText = "CHANGED"

		for (let turn = 1; turn <= 4; turn += 1) {
			hooks.onEvent?.(turnFinished(1))
		}
		const result = await hooks.beforeModel?.(makeCtx({ iteration: 5, messages: [userMessage("hello")] }))
		expect(textsOf(result)).toContain(CHECKPOINT_TEXT)
		expect(textsOf(result)).not.toContain("CHANGED")
	})
})
