import { createContextCompactionPrepareTurn } from "@cline/core"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { StateManager } from "@/core/storage/StateManager"
import { SdkCompactionCoordinator, type SdkCompactionCoordinatorOptions } from "./sdk-compaction-coordinator"

vi.mock("@cline/core", () => ({
	createContextCompactionPrepareTurn: vi.fn(),
	createSessionCompactionState: vi.fn((input: { compactedMessages: unknown[] }) => ({
		version: 1,
		messages: input.compactedMessages,
	})),
}))

const mockCreateContextCompactionPrepareTurn = createContextCompactionPrepareTurn as unknown as ReturnType<typeof vi.fn>

vi.mock("@/shared/services/Logger", () => ({
	Logger: {
		debug: vi.fn(),
		error: vi.fn(),
		log: vi.fn(),
		warn: vi.fn(),
	},
}))

describe("SdkCompactionCoordinator", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("reports when there is no active session or displayed task", async () => {
		const { coordinator, options } = makeCoordinator({ activeSession: undefined })

		await coordinator.compactTask()

		expect(options.sessions.startNewSession).not.toHaveBeenCalled()
		expect(mockCreateContextCompactionPrepareTurn).not.toHaveBeenCalled()
		expect(options.messages.appendAndEmit).toHaveBeenCalledWith(
			[expect.objectContaining({ say: "info", text: "There is no task to compact." })],
			expect.anything(),
		)
	})

	it("refuses to compact while a turn is running", async () => {
		const activeSession = makeActiveSession({ isRunning: true })
		const { coordinator, options } = makeCoordinator({ activeSession })

		await coordinator.compactTask()

		expect(mockCreateContextCompactionPrepareTurn).not.toHaveBeenCalled()
		expect(options.sessions.startNewSession).not.toHaveBeenCalled()
		expect(options.messages.appendAndEmit).toHaveBeenCalledWith(
			[expect.objectContaining({ say: "info", text: expect.stringContaining("Cannot compact while a response") })],
			expect.anything(),
		)
	})

	it("reports when there are no messages to compact", async () => {
		const activeSession = makeActiveSession()
		activeSession.sdkHost.readMessages.mockResolvedValueOnce([])
		const { coordinator, options } = makeCoordinator({ activeSession })

		await coordinator.compactTask()

		expect(mockCreateContextCompactionPrepareTurn).not.toHaveBeenCalled()
		expect(options.messages.appendAndEmit).toHaveBeenCalledWith(
			[expect.objectContaining({ say: "info", text: "No messages to compact." })],
			expect.anything(),
		)
	})

	it("reports unsupported runtime without running compaction", async () => {
		const activeSession = makeActiveSession()
		;(activeSession.sdkHost as Partial<typeof activeSession.sdkHost>).updateSessionCompactionState = undefined
		const { coordinator, options } = makeCoordinator({ activeSession })

		await coordinator.compactTask()

		expect(activeSession.sdkHost.readMessages).not.toHaveBeenCalled()
		expect(mockCreateContextCompactionPrepareTurn).not.toHaveBeenCalled()
		expect(options.messages.appendAndEmit).toHaveBeenCalledWith(
			[expect.objectContaining({ say: "info", text: expect.stringContaining("not supported") })],
			expect.anything(),
		)
	})

	it("shows a skipped divider when the strategy declines to compact", async () => {
		const activeSession = makeActiveSession()
		const { coordinator, options } = makeCoordinator({ activeSession })
		mockCreateContextCompactionPrepareTurn.mockReturnValueOnce(vi.fn().mockResolvedValue(undefined))

		await coordinator.compactTask()

		expect(mockCreateContextCompactionPrepareTurn).toHaveBeenCalledOnce()
		const rows = compactionRows(options)
		expect(rows[0].info.status).toBe("started")
		expect(rows[1].info.status).toBe("skipped")
		// The terminal row updates the started row in place (same ts).
		expect(rows[1].ts).toBe(rows[0].ts)
	})

	it("holds active-session compaction inside the rebuild mutex", async () => {
		const activeSession = makeActiveSession()
		const { coordinator, options } = makeCoordinator({ activeSession })
		mockCreateContextCompactionPrepareTurn.mockReturnValueOnce(
			vi.fn().mockResolvedValue({ messages: [{ role: "user", content: "summary" }] }),
		)

		await coordinator.compactTask()

		expect(options.rebuilds.runExclusive).toHaveBeenCalledOnce()
		expect(activeSession.sdkHost.updateSessionCompactionState).toHaveBeenCalled()
	})

	it("does not compact a different session installed while waiting for the mutex", async () => {
		const activeSession = makeActiveSession()
		const replacementSession = makeActiveSession({ sessionId: "different-task" })
		const { coordinator, options } = makeCoordinator({ activeSession })
		// Entry check sees the original session; inside the mutex a different
		// task's session has taken its place.
		options.sessions.getActiveSession.mockReturnValueOnce(activeSession).mockReturnValue(replacementSession)

		await coordinator.compactTask()

		expect(mockCreateContextCompactionPrepareTurn).not.toHaveBeenCalled()
		expect(activeSession.sdkHost.readMessages).not.toHaveBeenCalled()
		expect(replacementSession.sdkHost.readMessages).not.toHaveBeenCalled()
	})

	it("compacts through the rebuilt host when an idle rebuild replaced the session object", async () => {
		const activeSession = makeActiveSession()
		// Same conversation (sessionId), new session object and host after a
		// provider/MCP/terminal-mode rebuild drained while we waited.
		const rebuiltSession = makeActiveSession()
		const { coordinator, options } = makeCoordinator({ activeSession })
		options.sessions.getActiveSession.mockReturnValueOnce(activeSession).mockReturnValue(rebuiltSession)
		mockCreateContextCompactionPrepareTurn.mockReturnValueOnce(
			vi.fn().mockResolvedValue({ messages: [{ role: "user", content: "summary" }] }),
		)

		await coordinator.compactTask()

		expect(activeSession.sdkHost.readMessages).not.toHaveBeenCalled()
		expect(rebuiltSession.sdkHost.updateSessionCompactionState).toHaveBeenCalledWith("old-session", {
			version: 1,
			messages: [{ role: "user", content: "summary" }],
		})
	})

	it("compacts and persists the sidecar without rebuilding the session", async () => {
		const activeSession = makeActiveSession()
		activeSession.sdkHost.readMessages.mockResolvedValueOnce([
			{ role: "user", content: "1" },
			{ role: "assistant", content: "2" },
			{ role: "user", content: "3" },
		])
		const { coordinator, options } = makeCoordinator({ activeSession })
		mockCreateContextCompactionPrepareTurn.mockReturnValueOnce(
			vi.fn().mockResolvedValue({ messages: [{ role: "user", content: "summary" }] }),
		)

		await coordinator.compactTask()

		expect(activeSession.sdkHost.updateSessionCompactionState).toHaveBeenCalledWith("old-session", {
			version: 1,
			messages: [{ role: "user", content: "summary" }],
		})
		expect(options.sessions.startNewSession).not.toHaveBeenCalled()
		const rows = compactionRows(options)
		expect(rows[0].info).toMatchObject({ status: "started", mode: "manual" })
		expect(rows[1].info).toMatchObject({ status: "completed", mode: "manual", messagesBefore: 3, messagesAfter: 1 })
		expect(rows[1].ts).toBe(rows[0].ts)
	})
	it("prefers the SDK's token counters from its status notice for the completed divider", async () => {
		const activeSession = makeActiveSession()
		const { coordinator, options } = makeCoordinator({ activeSession })
		mockCreateContextCompactionPrepareTurn.mockReturnValueOnce(
			vi.fn().mockImplementation((context: { emitStatusNotice?: (message: string, metadata?: unknown) => void }) => {
				context.emitStatusNotice?.("compacted", {
					kind: "manual_compaction",
					phase: "completed",
					tokensBefore: 25_000,
					tokensAfter: 6_000,
					messagesBefore: 42,
					messagesAfter: 5,
				})
				return Promise.resolve({ messages: [{ role: "user", content: "summary" }] })
			}),
		)

		await coordinator.compactTask()

		const rows = compactionRows(options)
		expect(rows[1].info).toMatchObject({
			status: "completed",
			mode: "manual",
			tokensBefore: 25_000,
			tokensAfter: 6_000,
			messagesBefore: 42,
			messagesAfter: 5,
		})
	})

	it("does not append compaction status to a different active session", async () => {
		const activeSession = makeActiveSession()
		const { coordinator, options } = makeCoordinator({ activeSession })
		// Same session at the entry check and the inside-mutex identity check;
		// replaced during compaction so the emit-time fencing must engage.
		options.sessions.getActiveSession
			.mockReturnValueOnce(activeSession)
			.mockReturnValueOnce(activeSession)
			.mockReturnValue(makeActiveSession({ sessionId: "other-session" }))
		mockCreateContextCompactionPrepareTurn.mockReturnValueOnce(
			vi.fn().mockResolvedValue({ messages: [{ role: "user", content: "summary" }] }),
		)

		await coordinator.compactTask()

		expect(activeSession.sdkHost.updateSessionCompactionState).toHaveBeenCalled()
		expect(options.messages.appendAndEmit).not.toHaveBeenCalled()
	})

	it("does not report success when sidecar persistence fails", async () => {
		const activeSession = makeActiveSession()
		activeSession.sdkHost.updateSessionCompactionState.mockResolvedValueOnce({ updated: false })
		const { coordinator, options } = makeCoordinator({ activeSession })
		mockCreateContextCompactionPrepareTurn.mockReturnValueOnce(
			vi.fn().mockResolvedValue({ messages: [{ role: "user", content: "summary" }] }),
		)

		await coordinator.compactTask()

		const rows = compactionRows(options)
		expect(rows[rows.length - 1].info.status).toBe("failed")
		expect(options.messages.appendAndEmit).toHaveBeenCalledWith(
			[expect.objectContaining({ say: "info", text: "Couldn't compact the conversation. Please try again." })],
			expect.anything(),
		)
	})

	it("reports a failure when compaction throws", async () => {
		const activeSession = makeActiveSession()
		const { coordinator, options } = makeCoordinator({ activeSession })
		mockCreateContextCompactionPrepareTurn.mockReturnValueOnce(vi.fn().mockRejectedValue(new Error("boom")))

		await coordinator.compactTask()

		const rows = compactionRows(options)
		expect(rows[rows.length - 1].info.status).toBe("failed")
		expect(options.messages.appendAndEmit).toHaveBeenCalledWith(
			[expect.objectContaining({ say: "info", text: "Couldn't compact the conversation. Please try again." })],
			expect.anything(),
		)
	})
	it("resumes a displayed history task in an isolated host, compacts it, then disposes it", async () => {
		const { coordinator, options, resumedHost } = makeCoordinator({
			activeSession: undefined,
			displayedTaskId: "history-task",
		})
		resumedHost.readMessages.mockResolvedValueOnce([
			{ role: "user", content: "1" },
			{ role: "assistant", content: "2" },
		])
		mockCreateContextCompactionPrepareTurn.mockReturnValueOnce(
			vi.fn().mockResolvedValue({ messages: [{ role: "user", content: "summary" }] }),
		)

		await coordinator.compactTask()

		expect(options.rebuilds.runExclusive).toHaveBeenCalledOnce()
		expect(resumedHost.start).toHaveBeenCalledWith(
			expect.objectContaining({ config: expect.objectContaining({ sessionId: "history-task" }), interactive: true }),
		)
		expect(resumedHost.updateSessionCompactionState).toHaveBeenCalledWith("history-task", {
			version: 1,
			messages: [{ role: "user", content: "summary" }],
		})
		expect(resumedHost.stop).toHaveBeenCalledWith("history-task")
		expect(resumedHost.dispose).toHaveBeenCalledWith("compactDisplayedTask")
		expect(options.sessions.startNewSession).not.toHaveBeenCalled()
		expect(options.sessions.endActiveSession).not.toHaveBeenCalled()
		const rows = compactionRows(options)
		expect(rows[rows.length - 1].info).toMatchObject({ status: "completed", messagesBefore: 2, messagesAfter: 1 })
	})

	it("waits for the task's in-flight stop before starting the isolated session", async () => {
		const { coordinator, options, resumedHost } = makeCoordinator({
			activeSession: undefined,
			displayedTaskId: "history-task",
		})
		let stopSettled = false
		options.sessions.waitForPendingStop.mockImplementationOnce(async () => {
			stopSettled = true
		})
		resumedHost.start.mockImplementationOnce(async (input: { config?: { sessionId?: string } }) => {
			expect(stopSettled).toBe(true)
			return { sessionId: input.config?.sessionId ?? "resumed-session" }
		})
		mockCreateContextCompactionPrepareTurn.mockReturnValueOnce(
			vi.fn().mockResolvedValue({ messages: [{ role: "user", content: "summary" }] }),
		)

		await coordinator.compactTask()

		expect(options.sessions.waitForPendingStop).toHaveBeenCalledWith("history-task")
		expect(resumedHost.start).toHaveBeenCalledOnce()
	})

	it("disposes the isolated session even when displayed-task compaction fails", async () => {
		const { coordinator, options, resumedHost } = makeCoordinator({
			activeSession: undefined,
			displayedTaskId: "history-task",
		})
		resumedHost.readMessages.mockRejectedValueOnce(new Error("boom"))

		await coordinator.compactTask()

		expect(resumedHost.stop).toHaveBeenCalledWith("history-task")
		expect(resumedHost.dispose).toHaveBeenCalledWith("compactDisplayedTask")
		expect(options.messages.appendAndEmit).toHaveBeenCalledWith(
			[expect.objectContaining({ say: "info", text: "Couldn't compact the conversation. Please try again." })],
			expect.anything(),
		)
	})

	it("compacts the live session when the displayed task became active while waiting for the mutex", async () => {
		const { coordinator, options } = makeCoordinator({
			activeSession: undefined,
			displayedTaskId: "history-task",
		})
		const liveSession = makeActiveSession({ sessionId: "history-task" })
		liveSession.sdkHost.readMessages.mockResolvedValue([{ role: "user", content: "1" }])
		// Idle at the compactTask entry check, then active once inside runExclusive.
		options.sessions.getActiveSession.mockReturnValueOnce(undefined).mockReturnValue(liveSession)
		mockCreateContextCompactionPrepareTurn.mockReturnValueOnce(
			vi.fn().mockResolvedValue({ messages: [{ role: "user", content: "summary" }] }),
		)

		await coordinator.compactTask()

		expect(options.sessions.startNewSession).not.toHaveBeenCalled()
		expect(liveSession.sdkHost.updateSessionCompactionState).toHaveBeenCalledWith("history-task", {
			version: 1,
			messages: [{ role: "user", content: "summary" }],
		})
		expect(options.sessions.endActiveSession).not.toHaveBeenCalled()
	})

	it("finishes owned compaction without emitting into a replacement active session", async () => {
		const { coordinator, options, resumedHost } = makeCoordinator({
			activeSession: undefined,
			displayedTaskId: "history-task",
		})
		const replacementSession = makeActiveSession({ sessionId: "replacement-task" })
		resumedHost.start.mockImplementationOnce(async () => {
			options.sessions.getActiveSession.mockReturnValue(replacementSession)
			return { sessionId: "history-task" }
		})
		mockCreateContextCompactionPrepareTurn.mockReturnValueOnce(
			vi.fn().mockResolvedValue({ messages: [{ role: "user", content: "summary" }] }),
		)

		await coordinator.compactTask()

		expect(mockCreateContextCompactionPrepareTurn).toHaveBeenCalledOnce()
		expect(resumedHost.updateSessionCompactionState).toHaveBeenCalledWith(
			"history-task",
			expect.objectContaining({ messages: expect.any(Array) }),
		)
		expect(options.messages.appendAndEmit).not.toHaveBeenCalled()
		expect(replacementSession.sdkHost.stop).not.toHaveBeenCalled()
		expect(options.sessions.endActiveSession).not.toHaveBeenCalled()
		expect(resumedHost.stop).toHaveBeenCalledWith("history-task")
		expect(resumedHost.dispose).toHaveBeenCalledWith("compactDisplayedTask")
	})
})

/**
 * ACT-CLINEMM-POST-COMPACTION-W-BAR-REFRESH-RECON01 (PASS
 * POST_COMPACTION_PUBLICATION_REPAIRED) — load-bearing
 * coordinator bridge regression.
 *
 * The producer-side test
 * (`apps/vscode/src/sdk/__tests__/sdk-compaction-w-publish-recon01
 * .test.ts`) proves TWO SEPARATE facts:
 *   (1) `compactSessionMessages()` surfaces
 *       `currentWorkingContextEstimate` from the producer seam.
 *   (2) `WorkingContextHostCapture.setLatest(w)` replaces PRE with
 *       POST in isolation.
 *
 * But the LIVE load-bearing bridge — the only thing that closes
 * the live-UI gap — is the `publishPostCompactionW` invokation
 * inside `SdkCompactionCoordinator.runCompactionInPhase`. If that
 * bridge is wired loosely (publish-after-postStateToWebview, or
 * unconditionally even when W is undefined, or throws up to the
 * caller), the bar still goes stale in production.
 *
 * These tests exercise the bridge directly through the
 * `SdkCompactionCoordinator` constructor (the same construction
 * site as the SdkController wires in production).
 */
describe("POST_COMPACTION_W_BAR_REFRESH_RECON01 - load-bearing coordinator bridge", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	function makeCoordinatorWithPublisher(
		publishPostCompactionW: ((w: number) => void) | undefined,
	) {
		const activeSession = makeActiveSession()
		const base = makeCoordinator({ activeSession })
		// Tighten the cast: we need to set the optional
		// `publishPostCompactionW` on the constructor options and
		// keep the test spy's call-order semantics.
		;(base.options as unknown as { publishPostCompactionW?: (w: number) => void }).publishPostCompactionW =
			publishPostCompactionW
		// postStateToWebview is already a vi.fn() in
		// makeCoordinator (line 437); we re-record its spy here so
		// the order assertion can compare mock.invocationCallOrder
		// against the publish spy.
		const postSpy = base.options.postStateToWebview as unknown as ReturnType<typeof vi.fn>
		return { ...base, postSpy, publishPostCompactionW }
	}

	it("GREEN: Option 1 W publication -- publish called once with the seam-computed POST_COMPACTION_CURRENT_CONFIG_W; LAST postStateToWebview AFTER publish", async () => {
		// ACT-CLINEMM-FACTORIZE-F1-WORKING-CONTEXT-CARRIER-AUTHORITY01
		// (seventy-seventh-pass, Option 1 contract): the manual
		// seam computes W via explicit `estimateRequestInputTokens
		// (...)` on the success branch using SESSION-CONFIG-TIME
		// operands (systemPrompt + messages + extraTools). The
		// producer mock no longer carries W; the seam owns it.
		const publishSpy = vi.fn() as unknown as ReturnType<typeof vi.fn> & ((w: number) => void)
		const { coordinator, postSpy } = makeCoordinatorWithPublisher(publishSpy)
		const projectedMessages = [{ role: "user", content: "summary" }]
		mockCreateContextCompactionPrepareTurn.mockReturnValueOnce(
			vi.fn().mockResolvedValue({
				messages: projectedMessages,
				systemPrompt: "rewritten system",
			}),
		)

		await coordinator.compactTask()

		// Compute the expected W with the SAME operands the seam
		// will use (session-config systemPrompt + extraTools from
		// the makeCoordinator fixture + the projected messages).
		const { estimateRequestInputTokens } = await import("@cline/shared")
		const expectedW = estimateRequestInputTokens({
			systemPrompt: "test system prompt",
			messages: projectedMessages,
			tools: [{ name: "test_tool", description: "tool", input_schema: { type: "object" } }],
		})

		expect(publishSpy).toHaveBeenCalledOnce()
		expect(publishSpy).toHaveBeenCalledWith(expectedW)
		expect(expectedW).toBeGreaterThan(0)
		expect(postSpy).toHaveBeenCalled()

		// Mechanical ordering witness: publish MUST be called BEFORE
		// the FINAL (LAST) postStateToWebview call, so that the
		// resulting ExtensionState payload carries the new W.
		const publishOrder = (publishSpy as unknown as { mock: { invocationCallOrder: number[] } }).mock
			.invocationCallOrder[0]
		const postInvocationOrders = (
			postSpy as unknown as { mock: { invocationCallOrder: number[] } }
		).mock.invocationCallOrder
		expect(postInvocationOrders.length).toBeGreaterThanOrEqual(2)
		const lastPostOrder = postInvocationOrders[postInvocationOrders.length - 1]
		expect(publishOrder).toBeDefined()
		expect(lastPostOrder).toBeDefined()
		expect(publishOrder).toBeLessThan(lastPostOrder)
	})

	it("NEGATIVE: when the producer returns no messages (metadata-only), publish MUST NOT be called and postStateToWebview MUST still execute", async () => {
		// ACT-CLINEMM-FACTORIZE-F1-WORKING-CONTEXT-CARRIER-AUTHORITY01
		// (seventy-seventh-pass, Option 1 contract): the
		// `messages === undefined` branch (metadata-only
		// prepareTurn return) is a "no real compaction happened"
		// signal for manual mode. The seam MUST NOT publish W
		// in that branch. The carrier is failure-closed at the
		// downstream boundary
		// (UNDEFINED_W_STALE_REUSE = FORBIDDEN).
		//
		// Pre-repair semantics: the producer itself returned no W
		// and the seam propagated undefined. Post-repair: the
		// producer never had W; the seam computes W only when
		// `result.messages` is defined (a real projection
		// happened).
		const publishSpy = vi.fn() as unknown as ReturnType<typeof vi.fn> & ((w: number) => void)
		const { coordinator, postSpy } = makeCoordinatorWithPublisher(publishSpy)
		mockCreateContextCompactionPrepareTurn.mockReturnValueOnce(
			vi.fn().mockResolvedValue({
				// metadata-only return: W-only, no projection
				currentWorkingContextEstimate: 1234,
				// messages intentionally omitted
			}),
		)

		await coordinator.compactTask()

		// Critical: no fake W on the no-op branch.
		expect(publishSpy).not.toHaveBeenCalled()
		// And postStateToWebview MUST still run - the divider
		// publication is the user-visible success indicator.
		expect(postSpy).toHaveBeenCalled()
	})

	it("THROW-SWALLOWED: a throwing publish MUST be logged + not propagate; postStateToWebview MUST still execute", async () => {
		const publishError = new Error("synthetic publish failure")
		const publishSpy = vi.fn(() => {
			throw publishError
		}) as unknown as ReturnType<typeof vi.fn> & ((w: number) => void)
		const { coordinator, postSpy } = makeCoordinatorWithPublisher(publishSpy)
		const projectedMessages = [{ role: "user", content: "summary" }]
		mockCreateContextCompactionPrepareTurn.mockReturnValueOnce(
			vi.fn().mockResolvedValue({
				messages: projectedMessages,
				systemPrompt: "rewritten system",
			}),
		)

		// Compute the expected W with the same operands.
		const { estimateRequestInputTokens } = await import("@cline/shared")
		const expectedW = estimateRequestInputTokens({
			systemPrompt: "test system prompt",
			messages: projectedMessages,
			tools: [{ name: "test_tool", description: "tool", input_schema: { type: "object" } }],
		})

		// The coordinator wraps publishPostCompactionW in try/catch
		// and logs; compactTask must NOT propagate.
		await expect(coordinator.compactTask()).resolves.not.toThrow()
		expect(publishSpy).toHaveBeenCalledWith(expectedW)
		expect(postSpy).toHaveBeenCalled()
		// The thrown error is logged (the production boundary uses
		// Logger.error), but never reaches the calling code.
	})
})

/** Collect all say:"compaction" rows emitted through appendAndEmit, in order. */
function compactionRows(options: { messages: { appendAndEmit: ReturnType<typeof vi.fn> } }) {
	return options.messages.appendAndEmit.mock.calls
		.flatMap((call) => call[0] as Array<{ say?: string; text?: string; ts: number }>)
		.filter((message) => message.say === "compaction")
		.map((message) => ({ ts: message.ts, info: JSON.parse(message.text ?? "{}") }))
}

interface MakeCoordinatorInput {
	activeSession: ReturnType<typeof makeActiveSession> | undefined
	displayedTaskId: string | undefined
}

function makeCoordinator(input: Partial<MakeCoordinatorInput> = {}) {
	const activeSession = "activeSession" in input ? input.activeSession : makeActiveSession()
	// The isolated session used to resume a displayed task; its host owns the
	// session and is where the sidecar is persisted and its transcript is read.
	const resumedHost = makeSessionHost()
	const config = {
		providerConfig: { providerId: "anthropic", modelId: "claude" },
		providerId: "anthropic",
		modelId: "claude",
		knownModels: undefined,
		compaction: undefined,
		logger: undefined,
		telemetry: undefined,
		sessionId: undefined as string | undefined,
		// ACT-CLINEMM-FACTORIZE-F1-WORKING-CONTEXT-CARRIER-AUTHORITY01
		// (seventy-seventh-pass, Option 1 repair): forward
		// session-config-time operands so the manual seam can
		// compute POST_COMPACTION_CURRENT_CONFIG_W via
		// `estimateRequestInputTokens(...)`.
		systemPrompt: "test system prompt",
		extraTools: [{ name: "test_tool", description: "tool", input_schema: { type: "object" } }] as never,
	}
	const options = {
		stateManager: {
			getGlobalSettingsKey: vi.fn(() => "act"),
		} as unknown as StateManager,
		sessions: {
			getActiveSession: vi.fn(() => activeSession),
			startNewSession: vi.fn(async (startInput: { config?: { sessionId?: string } }) => ({
				startResult: { sessionId: startInput.config?.sessionId ?? "resumed-session" },
				sdkHost: resumedHost,
			})),
			setRunning: vi.fn(),
			endActiveSession: vi.fn().mockResolvedValue(undefined),
			waitForPendingStop: vi.fn().mockResolvedValue(undefined),
		},
		rebuilds: {
			runExclusive: vi.fn(async (operation: () => Promise<unknown>) => operation()),
		},
		messages: {
			appendAndEmit: vi.fn(),
		},
		taskHistory: {
			findHistoryItem: vi.fn().mockResolvedValue(undefined),
			isLegacyTask: vi.fn().mockResolvedValue(false),
			getLegacyResumeInitialMessages: vi.fn(async (_taskId: string, fallback?: unknown[]) => fallback),
		},
		sessionConfigBuilder: {
			build: vi.fn().mockResolvedValue(config),
		},
		getDisplayedTaskId: vi.fn(() => input.displayedTaskId),
		createTempSessionHost: vi.fn().mockResolvedValue(resumedHost),
		loadInitialMessages: vi.fn().mockResolvedValue([{ role: "user", content: "1" }]),
		getWorkspaceRoot: vi.fn().mockResolvedValue("/workspace"),
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
	} as unknown as SdkCompactionCoordinatorOptions & {
		sessions: {
			getActiveSession: ReturnType<typeof vi.fn>
			startNewSession: ReturnType<typeof vi.fn>
			setRunning: ReturnType<typeof vi.fn>
			endActiveSession: ReturnType<typeof vi.fn>
			waitForPendingStop: ReturnType<typeof vi.fn>
		}
		rebuilds: { runExclusive: ReturnType<typeof vi.fn> }
		messages: { appendAndEmit: ReturnType<typeof vi.fn> }
	}

	return {
		coordinator: new SdkCompactionCoordinator(options),
		options,
		resumedHost,
	}
}

function makeSessionHost() {
	return {
		start: vi.fn().mockImplementation(async (input: { config?: { sessionId?: string } }) => ({
			sessionId: input.config?.sessionId ?? "resumed-session",
		})),
		readMessages: vi.fn().mockResolvedValue([{ role: "user", content: "1" }]),
		updateSessionCompactionState: vi.fn().mockResolvedValue({ updated: true }),
		send: vi.fn(),
		abort: vi.fn().mockResolvedValue(undefined),
		stop: vi.fn().mockResolvedValue(undefined),
		dispose: vi.fn().mockResolvedValue(undefined),
	}
}

function makeActiveSession(input: { isRunning?: boolean; sessionId?: string } = {}) {
	return {
		sessionId: input.sessionId ?? "old-session",
		sdkHost: makeSessionHost(),
		unsubscribe: vi.fn(),
		startResult: { sessionId: input.sessionId ?? "old-session" },
		isRunning: input.isRunning ?? false,
	}
}
