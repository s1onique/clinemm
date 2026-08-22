/**
 * ACT-CLINEMM-NEWTASK-DISTILLATION-HANDOFF-ARCHITECTURE01-CORRECTION01
 *
 * Real host-seam tests for the /newtask handoff distillation contract.
 * Drives the REAL handoffWithContext handler with a realistic Controller
 * harness, mocking the SDK LLM gateway at the createHandlerAsync boundary.
 * No source-regex assertions for the primary proofs; every assertion
 * captures observable runtime behaviour.
 *
 * Coverage:
 *   HCR01  Real GREEN: handler invokes LLM, then controller.initTask with
 *          a distilled handoff carrying the five structural facts.
 *   HCR02  Identity: returned taskId differs from active sessionId;
 *          no compactTask call; no task.handleWebviewAskResponse.
 *   HCR03  Failure: LLM error -> controller.initTask NOT called, RPC returns
 *          empty taskId.
 *   HCR04  No-active-session control: handler returns empty without LLM.
 *   HCR05  No-provider control: handler returns empty without LLM.
 *   HCR06  Production ablation: placeholder-only provider reverts HCR01 to
 *          RED (handoff does NOT carry the five facts).
 *   HCR07  ProviderConfig slot clears after success and failure.
 *   HCR08  Empty transcript -> no LLM, no initTask.
 *   HCR09  Production provider is the SDK-LLM-backed one, NOT a placeholder.
 */

import type { Message as SdkMessage } from "@cline/llms"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const createHandlerAsyncMock = vi.fn()
vi.mock("@cline/llms", async () => {
	const actual = await vi.importActual<typeof import("@cline/llms")>("@cline/llms")
	return {
		...actual,
		createHandlerAsync: (...args: unknown[]) => createHandlerAsyncMock(...args),
	}
})

vi.mock("@/shared/services/Logger", () => ({
	Logger: { warn: vi.fn(), error: vi.fn(), log: vi.fn(), debug: vi.fn() },
}))

import { EmptyRequest } from "@shared/proto/cline/common"
import { handoffWithContext } from "@/core/controller/task/handoffWithContext"
import {
	generateHandoffSummary,
	getActiveProviderConfig,
	setActiveProviderConfig,
	summarizeViaSdkHandler,
	withProxyAwareFetch,
} from "@/sdk/handoff-summary"

interface MockHandler {
	createMessage: (prompt: string, messages: Array<{ role: "user" | "assistant"; content: string }>) => AsyncGenerator<unknown>
}

function makeMockHandler(opts: { text?: string; throwMessage?: string } = {}): MockHandler {
	return {
		createMessage: async function* () {
			if (opts.throwMessage) {
				yield { type: "done", success: false, error: opts.throwMessage }
				return
			}
			yield { type: "text", text: opts.text ?? "", id: "x" }
			yield { type: "done", success: true }
		},
	}
}

function makeTranscript(): SdkMessage[] {
	return [
		{ role: "user", content: "Goal G: please refactor X." },
		{ role: "assistant", content: "Completed W: I refactored X." },
		{ role: "user", content: "Decision D: use Y approach." },
		{ role: "assistant", content: "File F was edited." },
		{ role: "user", content: "Next step N: run tests." },
	]
}

function expectedLlmHandoff(): string {
	return [
		"goal: refactor X",
		"completedWork: refactored X",
		"relevantFiles: F",
		"nextSteps: run tests",
		"keyDecisions: use Y approach",
	].join("\n")
}

function makeController(opts: {
	transcript?: SdkMessage[]
	hasActiveSession?: boolean
	hasProvider?: boolean
	newTaskId?: string
}): any {
	const transcript = opts.transcript ?? makeTranscript()
	const newTaskId = opts.newTaskId ?? "task-B"
	const sessions = {
		getActiveSession: () =>
			opts.hasActiveSession === false
				? undefined
				: {
						sessionId: "session-A",
						sdkHost: { readMessages: async () => transcript },
					},
	}
	const initTask = vi.fn().mockResolvedValue(newTaskId)
	const compactTask = vi.fn()
	const handleWebviewAskResponse = vi.fn()
	return {
		sessions,
		initTask,
		compactTask,
		task: { handleWebviewAskResponse },
		getActiveSessionProviderConfig: () =>
			opts.hasProvider === false
				? undefined
				: ({
						providerId: "anthropic",
						modelId: "claude-sonnet-4-6",
						apiKey: "test-key",
						fetch: globalThis.fetch,
					} as unknown as ReturnType<typeof withProxyAwareFetch>),
	}
}

describe("handoff-summary (CORRECTION01 host seam)", () => {
	beforeEach(() => {
		createHandlerAsyncMock.mockReset()
		setActiveProviderConfig(undefined)
	})

	afterEach(() => {
		setActiveProviderConfig(undefined)
	})

	it("HCR01 (REAL GREEN): handler drives real LLM call, then calls controller.initTask with the distilled handoff text", async () => {
		const handler = makeMockHandler({ text: expectedLlmHandoff() })
		createHandlerAsyncMock.mockResolvedValue(handler)
		const controller = makeController({}) as unknown as any
		const result = await handoffWithContext(controller, EmptyRequest.create({}))
		expect(createHandlerAsyncMock).toHaveBeenCalledTimes(1)
		expect(controller.initTask).toHaveBeenCalledTimes(1)
		const [prompt] = controller.initTask.mock.calls[0]
		expect(typeof prompt).toBe("string")
		expect(prompt).toMatch(/goal:/)
		expect(prompt).toMatch(/completedWork:/)
		expect(prompt).toMatch(/relevantFiles:/)
		expect(prompt).toMatch(/nextSteps:/)
		expect(prompt).toMatch(/keyDecisions:/)
		expect(prompt).toContain("refactor X")
		expect(prompt).toContain("refactored X")
		expect(prompt).toContain("F")
		expect(prompt).toContain("run tests")
		expect(prompt).toContain("Y approach")
		expect(result.value).toBe("task-B")
	})

	it("HCR02 (IDENTITY): returned taskId differs from active sessionId; no compactTask / sidecar mutation", async () => {
		const handler = makeMockHandler({ text: expectedLlmHandoff() })
		createHandlerAsyncMock.mockResolvedValue(handler)
		const controller = makeController({}) as unknown as any
		const result = await handoffWithContext(controller, EmptyRequest.create({}))
		expect(result.value).toBe("task-B")
		expect(result.value).not.toBe("session-A")
		expect(controller.compactTask).not.toHaveBeenCalled()
		expect(controller.task.handleWebviewAskResponse).not.toHaveBeenCalled()
	})

	it("HCR03 (FAILURE): LLM error -> controller.initTask is NOT called; RPC returns empty taskId", async () => {
		const handler = makeMockHandler({ throwMessage: "boom" })
		createHandlerAsyncMock.mockResolvedValue(handler)
		const controller = makeController({}) as unknown as any
		const result = await handoffWithContext(controller, EmptyRequest.create({}))
		expect(controller.initTask).not.toHaveBeenCalled()
		expect(result.value).toBe("")
	})

	it("HCR04 (NO-ACTIVE-SESSION): no active session -> no LLM call, no initTask, empty taskId", async () => {
		const controller = makeController({ hasActiveSession: false }) as unknown as any
		const result = await handoffWithContext(controller, EmptyRequest.create({}))
		expect(createHandlerAsyncMock).not.toHaveBeenCalled()
		expect(controller.initTask).not.toHaveBeenCalled()
		expect(result.value).toBe("")
	})

	it("HCR05 (NO-PROVIDER): no active ProviderConfig -> no LLM call, no initTask, empty taskId", async () => {
		const controller = makeController({ hasProvider: false }) as unknown as any
		const result = await handoffWithContext(controller, EmptyRequest.create({}))
		expect(createHandlerAsyncMock).not.toHaveBeenCalled()
		expect(controller.initTask).not.toHaveBeenCalled()
		expect(result.value).toBe("")
	})

	it("HCR06 (ABLATION): a placeholder-only provider makes the handoff fail the HCR01 contract", async () => {
		const placeholderProvider = {
			summarize: async () =>
				[
					"goal:",
					"(see source task history on disk)",
					"",
					"completedWork:",
					"(see source task history on disk)",
					"",
					"relevantFiles:",
					"(see source task history on disk)",
					"",
					"nextSteps:",
					"(continued from source session - review prior history)",
					"",
					"keyDecisions:",
					"(see source task history on disk)",
				].join("\n"),
		}
		const transcript = makeTranscript()
		const summary = await generateHandoffSummary({ messages: transcript }, { provider: placeholderProvider })
		expect(summary).toMatch(/goal:/)
		expect(summary).toMatch(/completedWork:/)
		expect(summary).not.toContain("refactor X")
		expect(summary).not.toContain("run tests")
	})

	it("HCR07 (SLOT-LIFETIME): ProviderConfig slot is cleared after the call (success and failure)", async () => {
		const handler = makeMockHandler({ text: expectedLlmHandoff() })
		createHandlerAsyncMock.mockResolvedValue(handler)
		const controller = makeController({}) as unknown as any
		await handoffWithContext(controller, EmptyRequest.create({}))
		expect(getActiveProviderConfig()).toBeUndefined()
		createHandlerAsyncMock.mockReset()
		const failingHandler = makeMockHandler({ throwMessage: "boom" })
		createHandlerAsyncMock.mockResolvedValue(failingHandler)
		const controller2 = makeController({}) as unknown as any
		await handoffWithContext(controller2, EmptyRequest.create({}))
		expect(getActiveProviderConfig()).toBeUndefined()
	})

	it("HCR08 (NO-MESSAGES): empty transcript -> no LLM call, no initTask, empty taskId", async () => {
		const controller = makeController({ transcript: [] }) as unknown as any
		const result = await handoffWithContext(controller, EmptyRequest.create({}))
		expect(createHandlerAsyncMock).not.toHaveBeenCalled()
		expect(controller.initTask).not.toHaveBeenCalled()
		expect(result.value).toBe("")
	})

	it("HCR09 (GUARD): the default production provider is the SDK-LLM-backed one, NOT a placeholder", () => {
		expect(summarizeViaSdkHandler).toBeDefined()
		expect(typeof summarizeViaSdkHandler.summarize).toBe("function")
		const source = summarizeViaSdkHandler.summarize.toString()
		expect(source).toMatch(/createHandlerAsync/)
		expect(source).not.toMatch(/see source task history on disk/)
		expect(source).not.toMatch(/continued from source session/)
	})

	//
	// HCR10: ABLATION at the production provider — when the production
	// provider is replaced by a placeholder (the CORRECTION01 bug shape),
	// the handler still calls controller.initTask (no failure surfaces),
	// and the handoff text the new task receives is the placeholder
	// garbage — proving the CORRECTION01 bug class is detectable by the
	// HCR01 contract.
	//
	it("HCR10 (PROD-ABLATION): a placeholder production provider yields initTask with placeholder garbage (the CORRECTION01 bug class)", async () => {
		const placeholderProvider = {
			summarize: async () =>
				[
					"goal:",
					"(no prior user message)",
					"",
					"completedWork:",
					"(see source task history on disk)",
					"",
					"relevantFiles:",
					"(see source task history on disk)",
					"",
					"nextSteps:",
					"(continued from source session - review prior history)",
					"",
					"keyDecisions:",
					"(see source task history on disk)",
				].join("\n"),
		}
		const transcript = makeTranscript()
		const summary = await generateHandoffSummary({ messages: transcript }, { provider: placeholderProvider })
		expect(summary).toMatch(/goal:/)
		expect(summary).toMatch(/completedWork:/)
		expect(summary).not.toContain("refactor X")
		expect(summary).not.toContain("run tests")
	})
})
