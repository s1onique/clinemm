import type { HistoryItem } from "@shared/HistoryItem"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { StateManager } from "@/core/storage/StateManager"
import { isDirectory } from "@/utils/fs"
import { PROVIDER_FAILURE_ERROR_TYPE, PROVIDER_FAILURE_PHASE } from "./provider-failure-telemetry"
import { SdkTaskStartCoordinator, type SdkTaskStartCoordinatorOptions } from "./sdk-task-start-coordinator"

vi.mock("@/shared/services/Logger", () => ({
	Logger: {
		error: vi.fn(),
		log: vi.fn(),
		warn: vi.fn(),
	},
}))

vi.mock("@/utils/fs", () => ({
	isDirectory: vi.fn(),
}))

describe("SdkTaskStartCoordinator", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(isDirectory).mockResolvedValue(false)
	})

	it("initializes a new task, emits the task message, and sends the resolved prompt", async () => {
		const { coordinator, options, state } = makeCoordinator()

		const sessionId = await coordinator.initTask("hello @file", ["image.png"], ["a.ts"])

		expect(sessionId).toEqual(expect.any(String))
		expect(options.clearTask).toHaveBeenCalledOnce()
		expect(options.sessionConfigBuilder.build).toHaveBeenCalledWith({
			prompt: "hello @file",
			images: ["image.png"],
			files: ["a.ts"],
			historyItem: undefined,
			taskSettings: undefined,
			cwd: "/workspace",
			mode: "act",
		})
		expect(options.buildStartSessionInput).toHaveBeenCalledWith(
			expect.objectContaining({ providerId: "anthropic", modelId: "model", sessionId }),
			expect.objectContaining({
				prompt: "hello @file",
				images: ["image.png"],
				files: ["a.ts"],
				cwd: "/workspace",
				mode: "act",
			}),
		)
		expect(state.task?.taskId).toBe(sessionId)
		expect(options.taskHistory.updateTaskHistoryItem).toHaveBeenCalledWith(
			expect.objectContaining({ id: sessionId, task: "hello @file", modelId: "model" }),
		)
		// Attachments must be on the authoritative task message so the webview's
		// optimistic pending copy (which carries them) gets confirmed and cleared.
		expect(options.messages.appendAndEmit).toHaveBeenCalledWith(
			[
				expect.objectContaining({
					type: "say",
					say: "task",
					text: "hello @file",
					images: ["image.png"],
					files: ["a.ts"],
				}),
			],
			{ type: "status", payload: { sessionId, status: "running" } },
		)
		expect(options.postStateToWebview).toHaveBeenCalledTimes(2)
		expect(options.messages.appendAndEmit.mock.invocationCallOrder[0]).toBeLessThan(
			options.sessions.startNewSession.mock.invocationCallOrder[0],
		)
		// The first state post carries the streaming TurnState to the webview (thinking
		// indicator) and must not wait for the potentially slow session startup.
		expect(options.postStateToWebview.mock.invocationCallOrder[0]).toBeLessThan(
			options.sessions.startNewSession.mock.invocationCallOrder[0],
		)
		expect(options.resolveContextMentions).toHaveBeenCalledWith("hello @file")
		expect(options.sessions.fireAndForgetSend).toHaveBeenCalledWith(
			expect.objectContaining({ send: expect.any(Function) }),
			sessionId,
			"resolved: hello @file",
			["image.png"],
			["a.ts"],
		)
	})

	it("omits images/files from the task message when the task has no attachments", async () => {
		const { coordinator, options } = makeCoordinator()

		await coordinator.initTask("plain text task")

		const [emitted] = options.messages.appendAndEmit.mock.calls[0][0] as [Record<string, unknown>]
		expect(emitted).toMatchObject({ type: "say", say: "task", text: "plain text task" })
		expect(emitted).not.toHaveProperty("images")
		expect(emitted).not.toHaveProperty("files")
	})

	it("emits a Cline auth error instead of starting when the cline provider has no token", async () => {
		const { coordinator, options } = makeCoordinator({ config: { providerId: "cline", modelId: "model", apiKey: "" } })

		const sessionId = await coordinator.initTask("needs auth")

		expect(sessionId).toBeUndefined()
		expect(options.emitClineAuthError).toHaveBeenCalledWith("needs auth")
		expect(options.captureProviderApiError).not.toHaveBeenCalled()
		expect(options.sessions.startNewSession).not.toHaveBeenCalled()
	})

	it("emits a Cline auth error instead of starting when ClinePass has no token", async () => {
		const { coordinator, options } = makeCoordinator({ config: { providerId: "cline-pass", modelId: "model", apiKey: "" } })

		const sessionId = await coordinator.initTask("needs clinepass auth")

		expect(sessionId).toBeUndefined()
		expect(options.emitClineAuthError).toHaveBeenCalledWith("needs clinepass auth")
		expect(options.captureProviderApiError).not.toHaveBeenCalled()
		expect(options.sessions.startNewSession).not.toHaveBeenCalled()
	})

	it("emits a plain chat error when session start fails (e.g. provider misconfigured)", async () => {
		const { coordinator, options, state } = makeCoordinator()
		const error = new Error("No model configured for provider openai")
		options.sessions.startNewSession.mockRejectedValue(error)

		const sessionId = await coordinator.initTask("do something")

		expect(sessionId).toBeUndefined()
		expect(options.emitClineAuthError).not.toHaveBeenCalled()
		expect(options.captureProviderApiError).toHaveBeenCalledWith({
			sessionId: state.task?.taskId,
			error,
			providerId: "anthropic",
			modelId: "model",
			errorType: PROVIDER_FAILURE_ERROR_TYPE.TASK_INIT,
			failurePhase: PROVIDER_FAILURE_PHASE.PREFLIGHT,
		})
		expect(state.task?.taskId).toEqual(expect.any(String))
		expect(options.messages.appendAndEmit).toHaveBeenCalledWith(
			[
				expect.objectContaining({
					type: "say",
					say: "error",
					text: expect.stringContaining("No model configured for provider openai"),
				}),
			],
			{ type: "status", payload: { sessionId: state.task?.taskId, status: "error" } },
		)
		// One early post before session startup, one after the failure.
		expect(options.postStateToWebview).toHaveBeenCalledTimes(2)
	})

	it.each([true, false])("forwards task useAutoCondense=%s into SDK session config inputs", async (useAutoCondense) => {
		const { coordinator, options } = makeCoordinator()
		const taskSettings = { useAutoCondense }

		await coordinator.initTask("hello", undefined, undefined, undefined, taskSettings)

		expect(options.sessionConfigBuilder.build).toHaveBeenCalledWith(
			expect.objectContaining({
				taskSettings,
			}),
		)
		expect(options.buildStartSessionInput).toHaveBeenCalledWith(
			expect.any(Object),
			expect.objectContaining({
				taskSettings,
			}),
		)
	})

	it("reinitializes an existing task with preserved initial messages", async () => {
		vi.mocked(isDirectory).mockResolvedValue(true)
		const historyItem: HistoryItem = {
			id: "task-1",
			task: "old task",
			ts: 1,
			tokensIn: 0,
			tokensOut: 0,
			totalCost: 0,
			cwdOnTaskInitialization: "/task-cwd",
		}
		const { coordinator, options, state, tempHost } = makeCoordinator({ historyItem })

		await coordinator.reinitExistingTaskFromId("task-1")

		expect(options.clearTask).toHaveBeenCalledOnce()
		expect(options.taskHistory.findHistoryItem).toHaveBeenCalledWith("task-1")
		expect(isDirectory).toHaveBeenCalledWith("/task-cwd")
		expect(options.getWorkspaceRoot).not.toHaveBeenCalled()
		expect(options.sessionConfigBuilder.build).toHaveBeenCalledWith({ cwd: "/task-cwd", mode: "act" })
		expect(options.createTempSessionHost).toHaveBeenCalledOnce()
		expect(options.loadInitialMessages).toHaveBeenCalledWith(tempHost, "task-1")
		expect(tempHost.dispose).toHaveBeenCalledWith("readMessages")
		expect(options.sessions.startNewSession).toHaveBeenCalledWith({
			config: expect.objectContaining({ providerId: "anthropic", modelId: "model" }),
			interactive: true,
			initialMessages: [{ role: "user", content: "hello" }],
			sessionMetadata: expect.objectContaining({
				title: "old task",
				modelId: "model",
			}),
		})
		expect(state.task?.taskId).toBe("session-123")
		expect(options.postStateToWebview).toHaveBeenCalledOnce()
	})

	it("falls back to the workspace root when a stored task cwd is unavailable", async () => {
		const historyItem: HistoryItem = {
			id: "task-1",
			task: "old task",
			ts: 1,
			tokensIn: 0,
			tokensOut: 0,
			totalCost: 0,
			cwdOnTaskInitialization: "/missing-task-cwd",
		}
		const { coordinator, options } = makeCoordinator({ historyItem })

		await coordinator.reinitExistingTaskFromId("task-1")

		expect(isDirectory).toHaveBeenCalledWith("/missing-task-cwd")
		expect(options.getWorkspaceRoot).toHaveBeenCalledOnce()
		expect(options.sessionConfigBuilder.build).toHaveBeenCalledWith({ cwd: "/workspace", mode: "act" })
	})

	it("emits Cline auth errors when reinitialization fails due auth", async () => {
		const { coordinator, options } = makeCoordinator()
		options.sessionConfigBuilder.build.mockRejectedValue(new Error("missing api key"))
		options.isClineManagedProviderActive.mockReturnValue(true)

		await coordinator.reinitExistingTaskFromId("task-1")

		expect(options.emitClineAuthError).toHaveBeenCalledWith()
		expect(options.messages.emitSessionEvents).not.toHaveBeenCalled()
	})

	// ========================================================================
	// ACT-CLINEMM-DOGFOOD-CORRECTION04-CORRECTION03
	//
	// Regression pin for the "header says Idle while the runtime streams"
	// defect, accumulated across CORRECTION01..CORRECTION03:
	//
	//   P0.1 — single canonical writer (CORRECTION02).
	//     `SdkTaskStartCoordinator` is the SOLE writer of the new-task /
	//     resume → streaming transition. `SdkController.initTask` and
	//     `SdkController.reinitExistingTaskFromId` no longer re-assert
	//     streaming. Two writers at the same logical transition would
	//     violate the canonical-authority invariant.
	//
	//   P0.2 — async-resolution proof (CORRECTION02).
	//     The deferred-promise tests below pin the property that
	//     blocking `startNewSession` on a manual resolver keeps
	//     `setTurnPhase` uncalled, and the assertion only fires once the
	//     session promise resolves.
	//
	//   P0.3 — required authority (CORRECTION03).
	//     `setTurnPhase` is now a REQUIRED field on
	//     `SdkTaskStartCoordinatorOptions`. TypeScript itself enforces
	//     that every real constructor supplies the authority. An
	//     optional-authority seam would silently downgrade a wiring
	//     defect into a stale-state runtime mode.
	//
	//   P0.4 — post visibility (CORRECTION03).
	//     The state mutation must be followed by an outbound
	//     `postStateToWebview()` so the webview observes the streaming
	//     phase. CORRECTION03-1 pins the order:
	//       seed post  <  session_resolution  <  setTurnPhase
	//         <  post_state_to_webview_after_streaming
	//
	//   P1 — exactly-one transition per logical lifecycle (CORRECTION02).
	//     One logical new-task / resume lifecycle produces exactly ONE
	//     `setTurnPhase("streaming")` call.
	//
	//   P1 — failure paths assert no streaming (CORRECTION02).
	//     `startNewSession` rejection, Cline auth preflight, and
	//     synchronous throws from session start must not produce a
	//     misleading "streaming" badge.
	//
	// M1..M6 mutation-proof (each must fail if the corresponding
	// mutation is applied):
	//
	//   M1 — move `setTurnPhase("streaming")` BEFORE `startNewSession`
	//        → CORRECTION02-1 fails (asserts during pending session).
	//   M2 — re-introduce `turnStateTracker.set("streaming")` in
	//        `SdkController.initTask` → CORRECTION02-6 fails
	//        (structural witness reads `SdkController.ts` source and
	//        asserts no `turnStateTracker.set("streaming")` in
	//        `initTask` or `reinitExistingTaskFromId`).
	//   M3 — drop `setTurnPhase("streaming")` from `initTask` →
	//        CORRECTION02-1 fails.
	//   M4 — drop `setTurnPhase("streaming")` from
	//        `reinitExistingTaskFromId` → CORRECTION02-4 fails.
	//   M5 — wire the TaskHeader clock interval-suppression wrong
	//        → CLOCK-* tests in TaskHeaderTelemetry.test.tsx fail
	//        (covered by webview suite, not asserted here).
	//   M6 — drop the post-state-to-webview call that follows
	//        `setTurnPhase("streaming")` on the new-task path →
	//        CORRECTION03-1 fails (no outbound post after streaming).
	// ========================================================================

	it("CORRECTION01-1: setTurnPhase is asserted with streaming at the canonical boundary (after startNewSession)", async () => {
		const { coordinator, options } = makeCoordinator()

		await coordinator.initTask("hello")

		expect(options.setTurnPhase).toHaveBeenCalled()
		expect(options.setTurnPhase).toHaveBeenCalledWith("streaming")
		// setTurnPhase may be called once (lifecycle boundary). It must
		// NOT be called before `clearTask` ran.
		const firstInvocationOrder = options.setTurnPhase.mock.invocationCallOrder[0]
		const clearTaskOrder = options.clearTask.mock.invocationCallOrder[0]
		const startNewSessionOrder = options.sessions.startNewSession.mock.invocationCallOrder[0]
		expect(firstInvocationOrder).toBeGreaterThan(clearTaskOrder)
		expect(firstInvocationOrder).toBeGreaterThan(startNewSessionOrder)
	})

	// CORRECTION02-1: deferred-promise proof that the streaming
	// assertion waits for the asynchronous session creation to resolve,
	// not just for the call to `startNewSession` to be textually past.
	// The previous test (CORRECTION01-1) only proved source-order, which
	// is not the same property. This test blocks `startNewSession` on a
	// manual resolver and asserts:
	//   - while the session is pending → setTurnPhase is NOT called
	//   - after the session promise resolves → setTurnPhase(streaming)
	//
	// Mutation M1 (move setTurnPhase before startNewSession) → fails.
	// Mutation M3 (drop setTurnPhase from initTask) → fails.
	it("CORRECTION02-1: setTurnPhase(streaming) is NOT asserted while startNewSession is pending, only after it resolves", async () => {
		const { coordinator, options } = makeCoordinator()
		let resolveStart: (value: { startResult: { sessionId: string }; sdkHost: { send: () => void } }) => void = () => {}
		const startPromise = new Promise<{ startResult: { sessionId: string }; sdkHost: { send: () => void } }>((resolve) => {
			resolveStart = resolve
		})
		options.sessions.startNewSession.mockImplementationOnce(() => startPromise)

		// Fire-and-forget the initTask so we can observe the in-flight state.
		const initPromise = coordinator.initTask("deferred")
		// Yield so the synchronous prefix (clearTask, appendAndEmit, postStateToWebview)
		// has fully run before we inspect.
		await Promise.resolve()
		await Promise.resolve()
		await Promise.resolve()
		// Session is still pending — the streaming assertion must NOT have fired.
		expect(options.setTurnPhase).not.toHaveBeenCalledWith("streaming")
		expect(options.sessions.startNewSession).toHaveBeenCalledOnce()

		// Resolve the session — now the canonical boundary has been crossed.
		resolveStart({ startResult: { sessionId: "session-deferred" }, sdkHost: { send: vi.fn() } })
		const sessionId = await initPromise
		expect(sessionId).toBe("session-deferred")
		expect(options.setTurnPhase).toHaveBeenCalledWith("streaming")
	})

	// CORRECTION02-2: exactly-one-transition sentinel.
	// Production invariants: one logical new-task lifecycle produces
	// exactly ONE `setTurnPhase("streaming")` call. This catches any
	// re-introduction of the duplicate writer in `SdkController.initTask`
	// (the M2 mutation in the brief).
	it("CORRECTION02-2: exactly one setTurnPhase(streaming) is emitted per logical new-task lifecycle", async () => {
		const { coordinator, options } = makeCoordinator()

		await coordinator.initTask("once")

		const streamingCalls = options.setTurnPhase.mock.calls.filter(([phase]) => phase === "streaming")
		expect(streamingCalls).toHaveLength(1)
	})

	// CORRECTION02-3: a synchronous throw from startNewSession must
	// NOT advance the streaming phase (the runtime never got running).
	// Async rejection is covered by CORRECTION01-2; this pins the
	// synchronous-throw branch too. Note: the coordinator's catch
	// block captures the error and returns `undefined` (the same
	// shape as the async-rejection path) — that's why the assertion
	// checks the resolved return value, not `.rejects`.
	it("CORRECTION02-3: a synchronous throw from startNewSession does not assert streaming", async () => {
		const { coordinator, options } = makeCoordinator()
		options.sessions.startNewSession.mockImplementationOnce(() => {
			throw new Error("boom (sync)")
		})

		const sessionId = await coordinator.initTask("sync throw")
		expect(sessionId).toBeUndefined()
		expect(options.setTurnPhase).not.toHaveBeenCalledWith("streaming")
	})

	// CORRECTION03-1: post-visibility proof for the new-task path.
	//
	// The state mutation (`setTurnPhase("streaming")`) only matters if
	// the resulting phase reaches the webview. The VS Code webview
	// boundary is "post-driven" — the extension host must call
	// `postStateToWebview()` for the new phase to be delivered.
	//
	// Required sequence:
	//
	//   seed_post    (synchronous prefix, before startNewSession resolves)
	//     <  session_resolution  (startNewSession() promise resolves)
	//     <  setTurnPhase("streaming")
	//     <  post_state_to_webview  (the authoritative streaming post)
	//
	// Mutation M6 (drop the post-state-to-webview call that follows
	// `setTurnPhase("streaming")` on the new-task path) → CORRECTION03-1
	// fails.
	it("CORRECTION03-1: postStateToWebview fires after setTurnPhase(streaming); seed post fires before session resolves", async () => {
		const { coordinator, options } = makeCoordinator()
		let resolveStart: (value: { startResult: { sessionId: string }; sdkHost: { send: () => void } }) => void = () => {}
		const startPromise = new Promise<{ startResult: { sessionId: string }; sdkHost: { send: () => void } }>((resolve) => {
			resolveStart = resolve
		})

		// Capture the order of postStateToWebview / setTurnPhase /
		// startNewSession around the deferred session start.
		const order: string[] = []
		options.postStateToWebview.mockImplementation(async () => {
			order.push("post")
		})
		options.setTurnPhase.mockImplementation((phase) => {
			order.push(`set:${phase}`)
		})
		options.sessions.startNewSession.mockImplementation(() => {
			order.push("start:invoke")
			return startPromise
		})

		const initPromise = coordinator.initTask("vis")
		// Yield so the synchronous prefix (clearTask, appendAndEmit,
		// the seed postStateToWebview, and the startNewSession call)
		// all run before we inspect. The seed post is fire-and-forget
		// (returns a promise ignored via .catch), so we need a few
		// micro-tasks to let it tick.
		for (let i = 0; i < 8; i++) await Promise.resolve()

		const startInvokeIdx = order.indexOf("start:invoke")
		expect(startInvokeIdx).toBeGreaterThanOrEqual(0)
		expect(order.includes("set:streaming")).toBe(false)
		// Seed post must have fired BEFORE startNewSession resolves.
		const postsBeforeResolve = order.slice(0, startInvokeIdx + 1).filter((e) => e === "post")
		expect(postsBeforeResolve.length).toBeGreaterThanOrEqual(1)

		// Resolve the session — now the canonical boundary has been crossed.
		resolveStart({ startResult: { sessionId: "session-vis" }, sdkHost: { send: vi.fn() } })
		await initPromise

		// Required sequence:
		//   seed_post → start:invoke → (resolve) → setTurnPhase("streaming") → post (streaming post)
		const startInvoke = order.indexOf("start:invoke")
		const setIdx = order.indexOf("set:streaming")
		expect(setIdx).toBeGreaterThan(startInvoke)
		// At least one post AFTER setTurnPhase("streaming") so the
		// webview observes the streaming phase.
		const postsAfterSet = order.slice(setIdx + 1).filter((e) => e === "post")
		expect(postsAfterSet.length).toBeGreaterThanOrEqual(1)
	})

	it("CORRECTION01-2: setTurnPhase is NOT called when session start fails (preflight abort)", async () => {
		const { coordinator, options } = makeCoordinator()
		const error = new Error("No model configured for provider openai")
		options.sessions.startNewSession.mockRejectedValue(error)

		await coordinator.initTask("do something")

		// Auth/preflight failure path: no session was created, so the
		// streaming phase must NOT be asserted (the webview should see
		// the error path, not a misleading "Working" badge).
		expect(options.setTurnPhase).not.toHaveBeenCalledWith("streaming")
	})

	it("CORRECTION01-3: setTurnPhase is NOT called when the Cline auth preflight fires", async () => {
		const { coordinator, options } = makeCoordinator({ config: { providerId: "cline", modelId: "model", apiKey: "" } })

		await coordinator.initTask("needs auth")

		expect(options.sessions.startNewSession).not.toHaveBeenCalled()
		expect(options.setTurnPhase).not.toHaveBeenCalledWith("streaming")
	})

	// CORRECTION02-4: deferred-promise proof for reinitExistingTaskFromId.
	// The resume path must also wait for startNewSession to resolve
	// before asserting streaming. Mutation M4 (drop setTurnPhase from
	// reinit) → fails.
	it("CORRECTION02-4: reinitExistingTaskFromId also asserts streaming only after startNewSession resolves", async () => {
		vi.mocked(isDirectory).mockResolvedValue(true)
		const historyItem: HistoryItem = {
			id: "task-1",
			task: "old task",
			ts: 1,
			tokensIn: 0,
			tokensOut: 0,
			totalCost: 0,
			cwdOnTaskInitialization: "/task-cwd",
		}
		const { coordinator, options } = makeCoordinator({ historyItem })

		let resolveStart: (value: { startResult: { sessionId: string } }) => void = () => {}
		const startPromise = new Promise<{ startResult: { sessionId: string } }>((resolve) => {
			resolveStart = resolve
		})
		options.sessions.startNewSession.mockImplementationOnce(() => startPromise)

		const reinitPromise = coordinator.reinitExistingTaskFromId("task-1")
		await Promise.resolve()
		await Promise.resolve()
		await Promise.resolve()
		// Session is still pending — streaming must NOT have fired.
		expect(options.setTurnPhase).not.toHaveBeenCalledWith("streaming")

		resolveStart({ startResult: { sessionId: "session-resumed" } })
		await reinitPromise
		expect(options.setTurnPhase).toHaveBeenCalledWith("streaming")
	})

	// CORRECTION02-5: the resume path also emits exactly one streaming
	// transition (no duplicate writer on the resume path either).
	it("CORRECTION02-5: reinitExistingTaskFromId emits exactly one setTurnPhase(streaming)", async () => {
		vi.mocked(isDirectory).mockResolvedValue(true)
		const historyItem: HistoryItem = {
			id: "task-1",
			task: "old task",
			ts: 1,
			tokensIn: 0,
			tokensOut: 0,
			totalCost: 0,
			cwdOnTaskInitialization: "/task-cwd",
		}
		const { coordinator, options } = makeCoordinator({ historyItem })

		await coordinator.reinitExistingTaskFromId("task-1")

		const streamingCalls = options.setTurnPhase.mock.calls.filter(([phase]) => phase === "streaming")
		expect(streamingCalls).toHaveLength(1)
	})

	it("CORRECTION01-4: reinitExistingTaskFromId also asserts streaming at its boundary", async () => {
		vi.mocked(isDirectory).mockResolvedValue(true)
		const historyItem: HistoryItem = {
			id: "task-1",
			task: "old task",
			ts: 1,
			tokensIn: 0,
			tokensOut: 0,
			totalCost: 0,
			cwdOnTaskInitialization: "/task-cwd",
		}
		const { coordinator, options } = makeCoordinator({ historyItem })

		await coordinator.reinitExistingTaskFromId("task-1")

		expect(options.setTurnPhase).toHaveBeenCalledWith("streaming")
	})

	// CORRECTION02-6: structural witness for the single-writer invariant.
	// The new-task → streaming and resume → streaming transitions own ONE
	// writer: `SdkTaskStartCoordinator`. `SdkController` must not have
	// a duplicate `turnStateTracker.set("streaming")` call inside
	// `initTask` or `reinitExistingTaskFromId` — those would be the
	// M2 mutation from the brief. The structural sentinel below reads
	// the controller source and asserts the count of those writes is
	// zero on those two methods.
	//
	// M2 mutation (re-introduce `this.turnStateTracker.set("streaming")`
	// inside `initTask` or `reinitExistingTaskFromId`) → CORRECTION02-6
	// fails.
	it("CORRECTION02-6: SdkController.initTask and reinitExistingTaskFromId do NOT write streaming directly", async () => {
		const fs = await import("node:fs")
		const path = await import("node:path")
		const sourcePath = path.resolve(__dirname, "SdkController.ts")
		const source = fs.readFileSync(sourcePath, "utf8")

		function sliceMethod(name: string): string {
			// Find the method header line and slice to capture the method body.
			// The method may be `async` or non-async at the same depth.
			const headerRe = new RegExp(`^\\t(?:async\\s+)?${name}\\s*\\(`, "m")
			const start = source.search(headerRe)
			if (start < 0) {
				throw new Error(`SdkController.${name} not found`)
			}
			// Take ~6KB of source after the header; sufficient to cover
			// both `initTask` and `reinitExistingTaskFromId`.
			return source.slice(start, start + 6_000)
		}

		function stripCommentsAndStrings(s: string): string {
			// Strip /* ... */ block comments AND // line comments. The
			// current source has a long documentation block right above
			// `initTask` that mentions the literal string we want to ban,
			// so we must mask it out before scanning.
			return s
				.replace(/\/\*[\s\S]*?\*\//g, "")
				.split("\n")
				.map((line) => line.replace(/\/\/.*$/, ""))
				.join("\n")
		}

		const initTaskBody = stripCommentsAndStrings(sliceMethod("initTask"))
		const reinitBody = stripCommentsAndStrings(sliceMethod("reinitExistingTaskFromId"))

		// The sole writer for the new-task → streaming transition is the
		// `setTurnPhase` callback injected into the coordinator. The
		// controller must not call `turnStateTracker.set("streaming")`
		// in these two methods.
		expect(initTaskBody).not.toMatch(/turnStateTracker\.set\(\s*["']streaming["']\s*\)/)
		expect(reinitBody).not.toMatch(/turnStateTracker\.set\(\s*["']streaming["']\s*\)/)
	})

	// CORRECTION01-5 (the optional-authority test) was deleted in CORRECTION03:
	// `setTurnPhase` is now REQUIRED on `SdkTaskStartCoordinatorOptions`,
	// enforced by TypeScript. An optional-authority test no longer
	// matches production intent; the type itself is the invariant.
})

function makeCoordinator(input: Partial<MakeCoordinatorInput> = {}) {
	const state: { task?: { taskId: string } } = {}
	const config = input.config ?? {
		providerId: "anthropic",
		modelId: "model",
		apiKey: "key",
	}
	const historyItem = input.historyItem ?? {
		id: "task-1",
		task: "old task",
		ts: 1,
		tokensIn: 0,
		tokensOut: 0,
		totalCost: 0,
	}
	const tempHost = {
		readMessages: vi.fn().mockResolvedValue([{ role: "user", content: "hello" }]),
		dispose: vi.fn().mockResolvedValue(undefined),
	}
	const sdkHost = {
		send: vi.fn(),
	}
	const options = {
		stateManager: {
			getGlobalSettingsKey: vi.fn(() => input.mode ?? "act"),
		} as unknown as StateManager,
		sessions: {
			startNewSession: vi.fn((startInput?: { config?: { sessionId?: string } }) => ({
				startResult: { sessionId: startInput?.config?.sessionId ?? "session-123" },
				sdkHost,
			})),
			fireAndForgetSend: vi.fn(),
		},
		messages: {
			appendAndEmit: vi.fn(),
			emitSessionEvents: vi.fn(),
		},
		taskHistory: {
			findHistoryItem: vi.fn(() => (input.hasHistoryItem === false ? undefined : historyItem)),
			updateTaskHistory: vi.fn().mockResolvedValue([]),
			updateTaskHistoryItem: vi.fn().mockResolvedValue(undefined),
		},
		sessionConfigBuilder: {
			build: vi.fn().mockResolvedValue(config),
		},
		buildStartSessionInput: vi.fn((startConfig, startInput) => ({
			config: startConfig,
			interactive: true,
			prompt: startInput.prompt,
		})),
		createHistoryItemFromSession: vi.fn((sessionId, task, modelId, cwd) => ({
			id: sessionId,
			task,
			ts: 1,
			tokensIn: 0,
			tokensOut: 0,
			totalCost: 0,
			modelId,
			cwdOnTaskInitialization: cwd,
		})),
		// ACT-CLINEMM-DOGFOOD-CORRECTION04-CORRECTION01: phase authority
		// given to the start coordinator. Tests below assert that the
		// streaming phase is asserted AFTER `startNewSession` returns — the
		// canonical lifecycle boundary — and never before, so the inner
		// `clearTask()` → `set("idle")` round-trip cannot drop it.
		setTurnPhase: vi.fn(),
		clearTask: vi.fn().mockResolvedValue(undefined),
		setTask: vi.fn((task) => {
			state.task = task as { taskId: string } | undefined
		}),
		onAskResponse: vi.fn().mockResolvedValue(undefined),
		onCancelTask: vi.fn().mockResolvedValue(undefined),
		getWorkspaceRoot: vi.fn().mockResolvedValue("/workspace"),
		createTempSessionHost: vi.fn().mockResolvedValue(tempHost),
		loadInitialMessages: vi.fn().mockResolvedValue([{ role: "user", content: "hello" }]),
		resolveContextMentions: vi.fn(async (text: string) => `resolved: ${text}`),
		isClineManagedProviderActive: vi.fn(() => false),
		emitClineAuthError: vi.fn(),
		captureProviderApiError: vi.fn(),
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
	} as unknown as SdkTaskStartCoordinatorOptions & {
		sessions: SdkTaskStartCoordinatorOptions["sessions"] & {
			startNewSession: ReturnType<typeof vi.fn>
			fireAndForgetSend: ReturnType<typeof vi.fn>
		}
		messages: SdkTaskStartCoordinatorOptions["messages"] & {
			appendAndEmit: ReturnType<typeof vi.fn>
			emitSessionEvents: ReturnType<typeof vi.fn>
		}
		taskHistory: SdkTaskStartCoordinatorOptions["taskHistory"] & {
			findHistoryItem: ReturnType<typeof vi.fn>
			updateTaskHistory: ReturnType<typeof vi.fn>
			updateTaskHistoryItem: ReturnType<typeof vi.fn>
		}
		sessionConfigBuilder: SdkTaskStartCoordinatorOptions["sessionConfigBuilder"] & { build: ReturnType<typeof vi.fn> }
		buildStartSessionInput: ReturnType<typeof vi.fn>
		createHistoryItemFromSession: ReturnType<typeof vi.fn>
		clearTask: ReturnType<typeof vi.fn>
		createTempSessionHost: ReturnType<typeof vi.fn>
		loadInitialMessages: ReturnType<typeof vi.fn>
		resolveContextMentions: ReturnType<typeof vi.fn>
		isClineManagedProviderActive: ReturnType<typeof vi.fn>
		emitClineAuthError: ReturnType<typeof vi.fn>
		captureProviderApiError: ReturnType<typeof vi.fn>
		postStateToWebview: ReturnType<typeof vi.fn>
		setTurnPhase: ReturnType<typeof vi.fn>
	}

	return {
		coordinator: new SdkTaskStartCoordinator(options),
		options,
		state,
		tempHost,
	}
}

interface MakeCoordinatorInput {
	mode: "act" | "plan"
	config: {
		providerId: string
		modelId: string
		apiKey: string
	}
	historyItem: HistoryItem
	hasHistoryItem: boolean
}
