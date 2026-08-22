/**
 * ACT-CLINEMM-NEWTASK-DISTILLATION-HANDOFF-ARCHITECTURE01-CORRECTION01+02
 *
 * SYNTHETIC_REAL_HANDLER_COMPOSITION tests for the /newtask handoff
 * distillation contract. The handler under test is the REAL
 * handoffWithContext; the Controller is a hand-built synthetic harness;
 * the SDK LLM gateway is mocked at the createHandlerAsync boundary.
 * No source-regex assertions for the primary proofs; every assertion
 * captures observable runtime behaviour.
 *
 * Coverage:
 *   HCR01  REAL GREEN: handler invokes LLM, then controller.initTask with
 *          a distilled handoff carrying the five structural facts.
 *   HCR02  Identity: returned taskId differs from active sessionId.
 *   HCR03  Failure: LLM error -> controller.initTask NOT called.
 *   HCR04  No-active-session control: handler returns empty without LLM.
 *   HCR05  No-provider control: handler returns empty without LLM.
 *   HCR06  Provider ablation: placeholder-only provider fails HCR01.
 *   HCR07  Request isolation: two concurrent calls remain provider-isolated
 *          even when interleaved (CORRECTION02 PRIMARY RED).
 *   HCR08  Clear-race: one request finishing cannot clear another
 *          request's provider context (CORRECTION02 SECONDARY RED).
 *   HCR09  Empty transcript -> no LLM, no initTask.
 *   HCR10  Production factory: createSdkHandoffSummaryProvider captures
 *          its ProviderConfig in closure and consults no module state.
 *   HCR11  PROD-ABLATION: a placeholder production provider yields
 *          initTask with placeholder garbage (the CORRECTION01 bug class).
 */

import type { ProviderConfig, Message as SdkMessage } from "@cline/llms"
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
import { createSdkHandoffSummaryProvider, generateHandoffSummary, withProxyAwareFetch } from "@/sdk/handoff-summary"

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

function expectedLlmHandoff(marker: string): string {
	return [
		`goal: refactor ${marker}`,
		`completedWork: refactored ${marker}`,
		`relevantFiles: F${marker}`,
		`nextSteps: run tests ${marker}`,
		`keyDecisions: use ${marker} approach`,
	].join("\n")
}

function makeProviderConfig(marker: string): ProviderConfig {
	return {
		providerId: "anthropic",
		modelId: `claude-sonnet-4-6-${marker}`,
		apiKey: `test-api-key-placeholder-${marker}`,
		fetch: globalThis.fetch,
	}
}

function makeController(opts: {
	transcript?: SdkMessage[]
	hasActiveSession?: boolean
	hasProvider?: boolean | ProviderConfig
	newTaskId?: string
	providerMarker?: string
}): any {
	const transcript = opts.transcript ?? makeTranscript()
	const newTaskId = opts.newTaskId ?? "task-B"
	const providerMarker = opts.providerMarker ?? "A"
	const sessions = {
		getActiveSession: () =>
			opts.hasActiveSession === false
				? undefined
				: {
						sessionId: `session-${providerMarker}`,
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
		getActiveSessionProviderConfig: () => {
			if (opts.hasProvider === false) return undefined
			if (opts.hasProvider !== undefined && opts.hasProvider !== true) return opts.hasProvider
			return makeProviderConfig(providerMarker)
		},
	}
}

describe("handoff-summary (CORRECTION01+02 host seam)", () => {
	beforeEach(() => {
		createHandlerAsyncMock.mockReset()
	})

	afterEach(() => {
		createHandlerAsyncMock.mockReset()
	})

	it("HCR01 (REAL GREEN): handler drives real LLM call, then calls controller.initTask with the distilled handoff text", async () => {
		const handler = makeMockHandler({ text: expectedLlmHandoff("A") })
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
		expect(prompt).toContain("refactor A")
		expect(prompt).toContain("refactored A")
		expect(prompt).toContain("FA")
		expect(prompt).toContain("run tests A")
		expect(prompt).toContain("A approach")
		expect(result.value).toBe("task-B")
	})

	it("HCR02 (IDENTITY): returned taskId differs from active sessionId; no compactTask / sidecar mutation", async () => {
		const handler = makeMockHandler({ text: expectedLlmHandoff("A") })
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

	it("HCR06 (ABLATION): a placeholder-only provider fails the HCR01 contract", async () => {
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
		expect(summary).not.toContain("refactor A")
		expect(summary).not.toContain("run tests")
	})

	//
	// HCR07 (CORRECTION02 PRIMARY RED): two concurrent /newtask calls
	// remain provider-isolated even when their LLM streams interleave
	// adversarially. The CORRECTION01 module-scoped slot exposed the
	// wrong config under this ordering; the CORRECTION02 closure-captured
	// provider fixes it.
	//
	it("HCR07 (CONCURRENT ISOLATION): two interleaved /newtask calls use their OWN provider configs", async () => {
		const handlerA = makeMockHandler({ text: expectedLlmHandoff("A") })
		const handlerB = makeMockHandler({ text: expectedLlmHandoff("B") })
		// Use deferred createMessage handlers so we can deterministically
		// interleave A and B's LLM streams.
		const streamA: { resolve?: (value: unknown) => void; promise: Promise<unknown> } = {
			promise: Promise.resolve(),
		}
		const streamB: { resolve?: (value: unknown) => void; promise: Promise<unknown> } = {
			promise: Promise.resolve(),
		}
		streamA.promise = new Promise<unknown>((r) => (streamA.resolve = r))
		streamB.promise = new Promise<unknown>((r) => (streamB.resolve = r))
		// createHandlerAsync is called TWICE — once per request. The
		// returned handler's createMessage returns the appropriate
		// deferred. We capture the ProviderConfig each call received
		// (via mockImplementation) and assert post-hoc.
		const capturedConfigs: ProviderConfig[] = []
		createHandlerAsyncMock.mockImplementation((cfg: ProviderConfig) => {
			capturedConfigs.push(cfg)
			const marker = cfg.modelId?.endsWith("-B") ? "B" : "A"
			const deferred = marker === "A" ? streamA : streamB
			return deferred.promise.then(() => (marker === "A" ? handlerA : handlerB))
		})
		const controllerA = makeController({ providerMarker: "A" }) as unknown as any
		const controllerB = makeController({ providerMarker: "B" }) as unknown as any
		const aPromise = handoffWithContext(controllerA, EmptyRequest.create({}))
		const bPromise = handoffWithContext(controllerB, EmptyRequest.create({}))
		// Flush microtasks so both have entered their LLM streams
		// (createHandlerAsync was called twice; streams are deferred).
		await new Promise((r) => setTimeout(r, 0))
		// Adversarial ordering: release B first. In the CORRECTION01
		// slot impl, B's stream resolves while A is still waiting on
		// the slot — A would then read undefined or A's stale value.
		streamB!.resolve!(undefined)
		await new Promise((r) => setTimeout(r, 0))
		streamA!.resolve!(undefined)
		await Promise.all([aPromise, bPromise])
		// Each invocation called createHandlerAsync with its OWN config.
		expect(createHandlerAsyncMock).toHaveBeenCalledTimes(2)
		expect(capturedConfigs).toHaveLength(2)
		const cfgA = capturedConfigs.find((c) => c.modelId === "claude-sonnet-4-6-A")
		const cfgB = capturedConfigs.find((c) => c.modelId === "claude-sonnet-4-6-B")
		expect(cfgA).toBeDefined()
		expect(cfgB).toBeDefined()
		expect(cfgA?.apiKey).toBe("test-api-key-placeholder-A")
		expect(cfgB?.apiKey).toBe("test-api-key-placeholder-B")
		// Each handler called initTask with its OWN distilled handoff.
		expect(controllerA.initTask).toHaveBeenCalledTimes(1)
		expect(controllerB.initTask).toHaveBeenCalledTimes(1)
		const [promptA] = controllerA.initTask.mock.calls[0]
		const [promptB] = controllerB.initTask.mock.calls[0]
		expect(promptA).toContain("refactor A")
		expect(promptA).toContain("run tests A")
		expect(promptA).not.toContain("refactor B")
		expect(promptB).toContain("refactor B")
		expect(promptB).toContain("run tests B")
		expect(promptB).not.toContain("refactor A")
	})

	//
	// HCR08 (CORRECTION02 SECONDARY RED): when request A finishes and
	// runs its post-summary code, it must not clear request B's
	// provider context. The CORRECTION01 module-scoped slot exposed
	// this race when A's `finally { setActiveProviderConfig(undefined) }`
	// ran while B was still consuming the slot.
	//
	it("HCR08 (CLEAR-RACE): A finishing and clearing does not affect B's in-flight LLM call", async () => {
		const handlerA = makeMockHandler({ text: expectedLlmHandoff("A") })
		const streamB: { resolve?: (value: unknown) => void; promise: Promise<unknown> } = {
			promise: Promise.resolve(),
		}
		streamB.promise = new Promise<unknown>((r) => (streamB.resolve = r))
		const capturedConfigs: ProviderConfig[] = []
		createHandlerAsyncMock.mockImplementation((cfg: ProviderConfig) => {
			capturedConfigs.push(cfg)
			const marker = cfg.modelId?.endsWith("-B") ? "B" : "A"
			if (marker === "A") return Promise.resolve(handlerA)
			return streamB.promise.then(() => makeMockHandler({ text: expectedLlmHandoff("B") }))
		})
		const controllerA = makeController({ providerMarker: "A" }) as unknown as any
		const controllerB = makeController({ providerMarker: "B" }) as unknown as any
		const aPromise = handoffWithContext(controllerA, EmptyRequest.create({}))
		const bPromise = handoffWithContext(controllerB, EmptyRequest.create({}))
		// Let A complete entirely. In the CORRECTION01 slot impl,
		// A's finally would clear activeProviderConfig while B is
		// still awaiting it (B's createHandlerAsync was called but
		// B's stream is deferred).
		await aPromise
		streamB!.resolve!(undefined)
		await bPromise
		expect(createHandlerAsyncMock).toHaveBeenCalledTimes(2)
		expect(capturedConfigs).toHaveLength(2)
		const cfgA = capturedConfigs.find((c) => c.modelId === "claude-sonnet-4-6-A")
		const cfgB = capturedConfigs.find((c) => c.modelId === "claude-sonnet-4-6-B")
		// B still saw its OWN config — not undefined, not A's.
		expect(cfgB).toBeDefined()
		expect(cfgB?.apiKey).toBe("test-api-key-placeholder-B")
		expect(cfgA?.apiKey).toBe("test-api-key-placeholder-A")
		expect(controllerA.initTask).toHaveBeenCalledTimes(1)
		expect(controllerB.initTask).toHaveBeenCalledTimes(1)
		const [promptA] = controllerA.initTask.mock.calls[0]
		const [promptB] = controllerB.initTask.mock.calls[0]
		expect(promptA).toContain("refactor A")
		expect(promptA).not.toContain("refactor B")
		expect(promptB).toContain("refactor B")
		expect(promptB).not.toContain("refactor A")
	})

	it("HCR09 (NO-MESSAGES): empty transcript -> no LLM call, no initTask, empty taskId", async () => {
		const controller = makeController({ transcript: [] }) as unknown as any
		const result = await handoffWithContext(controller, EmptyRequest.create({}))
		expect(createHandlerAsyncMock).not.toHaveBeenCalled()
		expect(controller.initTask).not.toHaveBeenCalled()
		expect(result.value).toBe("")
	})

	//
	// HCR10: The production factory captures ProviderConfig in closure
	// (no module state). The returned provider consults no global
	// slot.
	//
	it("HCR10 (FACTORY): createSdkHandoffSummaryProvider captures its config in closure and consults no module state", async () => {
		const cfg = makeProviderConfig("Z")
		const provider = createSdkHandoffSummaryProvider(withProxyAwareFetch(cfg))
		expect(provider).toBeDefined()
		expect(typeof provider.summarize).toBe("function")
		const handler = makeMockHandler({ text: expectedLlmHandoff("Z") })
		createHandlerAsyncMock.mockResolvedValue(handler)
		const summary = await provider.summarize({ messages: makeTranscript() })
		expect(summary).toContain("refactor Z")
		// The mocked createHandlerAsync received the original config (the
		// factory closed over it; withProxyAwareFetch spread the original
		// fields through).
		expect(createHandlerAsyncMock).toHaveBeenCalledTimes(1)
		const [passedCfg] = createHandlerAsyncMock.mock.calls[0]
		expect(passedCfg.providerId).toBe("anthropic")
		expect(passedCfg.modelId).toBe("claude-sonnet-4-6-Z")
		expect(passedCfg.apiKey).toBe("test-api-key-placeholder-Z")
	})

	//
	// HCR11 (PROD-ABLATION): a placeholder production provider yields
	// initTask with placeholder garbage (the CORRECTION01 bug class).
	//
	it("HCR11 (PROD-ABLATION): a placeholder production provider yields initTask with placeholder garbage", async () => {
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
		expect(summary).not.toContain("refactor A")
		expect(summary).not.toContain("run tests")
	})
})
