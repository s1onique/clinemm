import { type ClineCoreStartInput, type ITelemetryService, toClineCoreStartInput } from "@cline/core"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mockClineCoreCreate = vi.hoisted(() => vi.fn())
const mockCreateVscodeExtraTools = vi.hoisted(() => vi.fn(async () => []))
const mockInnerStart = vi.hoisted(() => vi.fn())

vi.mock("@cline/core", async () => {
	const actual = await vi.importActual<typeof import("@cline/core")>("@cline/core")
	return { ...actual, ClineCore: { create: mockClineCoreCreate } }
})
vi.mock("@/services/logging/distinctId", () => ({ getDistinctId: () => "distinct-id" }))
vi.mock("@/core/storage/StateManager", () => ({
	StateManager: { get: () => ({ getGlobalStateKey: () => undefined }) },
}))
vi.mock("./vscode-runtime-builder", () => ({ createVscodeExtraTools: mockCreateVscodeExtraTools }))

import { VscodeGitTelemetry } from "./git-telemetry"
import { VscodeSessionHost } from "./vscode-session-host"

describe("VscodeSessionHost telemetry wiring", () => {
	beforeEach(() => {
		mockClineCoreCreate.mockReset()
		mockClineCoreCreate.mockResolvedValue({ runtimeAddress: undefined })
		mockCreateVscodeExtraTools.mockReset().mockResolvedValue([])
	})

	it("passes shared telemetry to ClineCore.create", async () => {
		const telemetry = makeTelemetry()

		await VscodeSessionHost.create({
			// biome-ignore lint/suspicious/noExplicitAny: focused host unit test
			mcpHub: {} as any,
			telemetry,
		})

		expect(mockClineCoreCreate).toHaveBeenCalledWith(expect.objectContaining({ telemetry }))
	})

	it("injects shared telemetry into CoreSessionConfig when remote config did not provide one", async () => {
		const telemetry = makeTelemetry()
		await VscodeSessionHost.create({
			// biome-ignore lint/suspicious/noExplicitAny: focused host unit test
			mcpHub: {} as any,
			telemetry,
		})

		const prepare = mockClineCoreCreate.mock.calls[0][0].prepare
		const bootstrap = await prepare()
		const prepared = await bootstrap.applyToStartSessionInput({
			source: undefined,
			config: {
				cwd: "/tmp/workspace",
				extraTools: [],
			},
		})

		expect(prepared.source).toBe("vscode")
		expect(prepared.config.telemetry).toBe(telemetry)
	})

	it("preserves telemetry already supplied by remote config", async () => {
		const telemetry = makeTelemetry()
		const remoteTelemetry = makeTelemetry()
		await VscodeSessionHost.create({
			// biome-ignore lint/suspicious/noExplicitAny: focused host unit test
			mcpHub: {} as any,
			telemetry,
			getRemoteConfigIntegration: () =>
				({
					applyToStartSessionInput: (input: ClineCoreStartInput) => ({
						...input,
						config: {
							...input.config,
							telemetry: remoteTelemetry,
						},
					}),
				}) as never,
		})

		const prepare = mockClineCoreCreate.mock.calls[0][0].prepare
		const bootstrap = await prepare()
		const prepared = await bootstrap.applyToStartSessionInput({
			source: undefined,
			config: {
				cwd: "/tmp/workspace",
				extraTools: [],
			},
		})

		expect(prepared.config.telemetry).toBe(remoteTelemetry)
	})

	it("passes custom editor and apply_patch executors into tool executor capabilities", async () => {
		const editorExecutor = vi.fn()
		const applyPatchExecutor = vi.fn()
		await VscodeSessionHost.create({
			// biome-ignore lint/suspicious/noExplicitAny: focused host unit test
			mcpHub: {} as any,
			editorExecutor,
			applyPatchExecutor,
		})

		const capabilities = mockClineCoreCreate.mock.calls[0][0].capabilities
		expect(capabilities.toolExecutors.editor).toBe(editorExecutor)
		expect(capabilities.toolExecutors.applyPatch).toBe(applyPatchExecutor)
	})

	it("leaves the SDK's default edit executors in place when no overrides are provided", async () => {
		await VscodeSessionHost.create({
			// biome-ignore lint/suspicious/noExplicitAny: focused host unit test
			mcpHub: {} as any,
		})

		const capabilities = mockClineCoreCreate.mock.calls[0][0].capabilities
		// ACT-CLINEMM-SEATBELT-YOLO-COMPLETION-AUTHORITY-IMPLEMENTATION01:
		// the host always populates `submit` so the runtime can register
		// `submit_and_exit` whenever CoreSessionConfig.enableSubmitAndExit
		// is set. The other executor slots remain unset.
		expect(capabilities.toolExecutors).toBeDefined()
		expect(capabilities.toolExecutors.editor).toBeUndefined()
		expect(capabilities.toolExecutors.applyPatch).toBeUndefined()
		expect(capabilities.toolExecutors.readFile).toBeUndefined()
		expect(capabilities.toolExecutors.askQuestion).toBeUndefined()
		expect(typeof capabilities.toolExecutors.submit).toBe("function")
	})

	it("waits for policy readiness before selecting and applying remote config", async () => {
		const events: string[] = []
		const beforeStartSession = vi.fn(async () => {
			events.push("ready")
		})
		const applyToStartSessionInput = vi.fn(async (input: ClineCoreStartInput) => {
			events.push("apply")
			return input
		})
		await VscodeSessionHost.create({
			// biome-ignore lint/suspicious/noExplicitAny: focused host unit test
			mcpHub: {} as any,
			beforeStartSession,
			getRemoteConfigIntegration: () =>
				({
					applyToStartSessionInput,
					dispose: vi.fn(),
				}) as never,
		})

		const prepare = mockClineCoreCreate.mock.calls[0][0].prepare
		const bootstrap = await prepare()
		await bootstrap.applyToStartSessionInput({ config: { cwd: "/workspace" } })

		expect(events).toEqual(["ready", "apply"])
	})

	it("applies remote config before appending VS Code extra tools", async () => {
		mockCreateVscodeExtraTools.mockResolvedValueOnce([{ name: "vscode-tool" }] as never)
		const applyToStartSessionInput = vi.fn(async (input: ClineCoreStartInput) => ({
			...input,
			config: {
				...input.config,
				extensions: [{ name: "remote-config" }],
				extraTools: [{ name: "remote-tool" }],
			},
		}))
		await VscodeSessionHost.create({
			// biome-ignore lint/suspicious/noExplicitAny: focused host unit test
			mcpHub: {} as any,
			getRemoteConfigIntegration: () =>
				({
					applyToStartSessionInput,
					dispose: vi.fn(),
				}) as never,
		})

		const prepare = mockClineCoreCreate.mock.calls[0][0].prepare
		const bootstrap = await prepare()
		const result = await bootstrap.applyToStartSessionInput({ config: { cwd: "/workspace" } })

		expect(applyToStartSessionInput).toHaveBeenCalledWith({ config: { cwd: "/workspace" } })
		expect(mockCreateVscodeExtraTools).toHaveBeenCalledWith({} as never, {
			cwd: "/workspace",
			getTerminalManager: undefined,
			foregroundCommands: undefined,
			commandJobManager: expect.objectContaining({ active: expect.anything() }),
			vscodeTerminalExecutionMode: undefined,
			// ACT-CLINEMM-RUNTIME-TASK-PROGRESSION01: pass-through to the
			// run_commands tool so the background state callback fires
			// when the tool returns RUNNING / reaches a terminal state.
			onBackgroundStateChange: undefined,
		})
		expect(result.source).toBe("vscode")
		expect(result.config.extensions).toEqual([{ name: "remote-config" }])
		expect(result.config.extraTools).toEqual([{ name: "remote-tool" }, { name: "vscode-tool" }])
	})

	it("runs the session gate and remote-config integration on a checkpoint restore with a replacement session", async () => {
		const events: string[] = []
		const innerRestore = vi.fn(async (_input: unknown) => ({ checkpoint: {} }))
		mockClineCoreCreate.mockResolvedValue({ runtimeAddress: undefined, restore: innerRestore })
		const host = await VscodeSessionHost.create({
			// biome-ignore lint/suspicious/noExplicitAny: focused host unit test
			mcpHub: {} as any,
			beforeStartSession: async () => {
				events.push("gate")
			},
			getRemoteConfigIntegration: () =>
				({
					applyToStartSessionInput: (input: ClineCoreStartInput) => {
						events.push("integration")
						return input
					},
				}) as never,
		})

		await host.restore({
			sessionId: "session-1",
			checkpointRunCount: 1,
			start: { config: { cwd: "/workspace", extraTools: [] } } as never,
		})

		// The gate must resolve before the integration is read; ClineCore.restore
		// does not run the prepare hook, so the host must apply it itself.
		expect(events).toEqual(["gate", "integration"])
		const restoredInput = innerRestore.mock.calls[0][0] as { start: ClineCoreStartInput }
		expect(restoredInput.start.source).toBe("vscode")
	})

	it("does not gate a workspace-only restore that starts no replacement session", async () => {
		const innerRestore = vi.fn(async () => ({ checkpoint: {} }))
		const beforeStartSession = vi.fn()
		mockClineCoreCreate.mockResolvedValue({ runtimeAddress: undefined, restore: innerRestore })
		const host = await VscodeSessionHost.create({
			// biome-ignore lint/suspicious/noExplicitAny: focused host unit test
			mcpHub: {} as any,
			beforeStartSession,
		})

		await host.restore({ sessionId: "session-1", checkpointRunCount: 1 })

		expect(beforeStartSession).not.toHaveBeenCalled()
		expect(innerRestore).toHaveBeenCalledWith({ sessionId: "session-1", checkpointRunCount: 1 })
	})
})
const gitStartInput: ClineCoreStartInput = {
	config: {
		sessionId: "git-task",
		cwd: "/workspace",
		providerId: "cline",
		modelId: "test",
		systemPrompt: "test",
		enableTools: true,
		enableSpawnAgent: false,
		enableAgentTeams: false,
	},
}

function makeTelemetry(): ITelemetryService {
	return {
		setDistinctId() {},
		setMetadata() {},
		updateMetadata() {},
		setCommonProperties() {},
		updateCommonProperties() {},
		isEnabled: () => true,
		capture() {},
		captureRequired() {},
		recordCounter() {},
		recordHistogram() {},
		recordGauge() {},
		flush: async () => {},
		dispose: async () => {},
	}
}

describe("VscodeSessionHost telemetry wiring", () => {
	beforeEach(() => {
		vi.restoreAllMocks()
		mockInnerStart.mockReset().mockResolvedValue({ sessionId: "core-task" })
		mockClineCoreCreate.mockReset().mockResolvedValue({
			start: mockInnerStart,
			stop: async () => {},
			dispose: async () => {},
		})
		mockCreateVscodeExtraTools.mockReset().mockResolvedValue([])
	})

	it("passes shared telemetry to Core and injects it into session config", async () => {
		const telemetry = makeTelemetry()
		const host = await VscodeSessionHost.create({ mcpHub: {} as never, telemetry })
		await host.start(gitStartInput)
		expect(mockClineCoreCreate).toHaveBeenCalledWith(expect.objectContaining({ telemetry }))
		// ACT-CLINEMM-FORK-UPSTREAM-MERGE01: upstream's new test expected
		// `prepare` to be `undefined`. The fork ALWAYS provides a `prepare`
		// hook, because the fork's VSCode extra tools need the host's
		// `prepareStartSessionInput` lambda:
		//
		//   vscode-session-host.ts:
		//     prepare: async () => ({ applyToStartSessionInput: prepareStartSessionInput })
		//
		// That lambda threads the `commandJobManager` (which carries
		// `safeYoloCapabilitySource`) into `createVscodeExtraTools`.
		// Upstream has no such wiring — it has no extra tools at all —
		// so upstream's assertion is upstream-only truth.
		//
		// The fork's contract wins: assert the prepare hook is present and
		// carries the extra-tools binding.
		const prepare = mockClineCoreCreate.mock.calls[0][0].prepare as
			| (() => Promise<{ applyToStartSessionInput?: unknown }>)
			| undefined
		expect(prepare).toBeTypeOf("function")
		const prepared = await prepare?.()
		expect(prepared?.applyToStartSessionInput).toBeTypeOf("function")
		expect(mockInnerStart.mock.calls[0][0]).toMatchObject({ source: "vscode", config: { telemetry } })
		await host.dispose()
	})

	it("preserves remote-config telemetry but uses host consent for Git", async () => {
		const telemetry = makeTelemetry()
		const remoteTelemetry = makeTelemetry()
		const configure = vi.spyOn(VscodeGitTelemetry.prototype, "configure")
		const host = await VscodeSessionHost.create({
			mcpHub: {} as never,
			telemetry,
			getRemoteConfigIntegration: () =>
				({
					applyToStartSessionInput: (input: ClineCoreStartInput) => ({
						...input,
						config: { ...input.config, telemetry: remoteTelemetry },
					}),
				}) as never,
		})
		await host.start(gitStartInput)
		expect(mockInnerStart.mock.calls[0][0].config.telemetry).toBe(remoteTelemetry)
		expect(configure.mock.contexts[0]).toHaveProperty("telemetry", telemetry)
		await host.dispose()
	})

	it.each(["cline", "cline-pass", "anthropic"])("scopes Git capture to eligible providers: %s", async (providerId) => {
		const host = await VscodeSessionHost.create({ mcpHub: {} as never, telemetry: makeTelemetry() })
		const fetch = vi.fn() as unknown as typeof globalThis.fetch
		await host.start({
			config: { ...gitStartInput.config, providerId, providerConfig: { providerId, modelId: "test", fetch } },
		})
		const config = mockInnerStart.mock.calls[0][0].config
		expect(config.providerConfig.fetch).toBe(fetch)
		expect(config.hooks?.beforeModel).toBeUndefined()
		expect(typeof config.hooks?.afterModel).toBe(providerId === "anthropic" ? "undefined" : "function")
		await host.dispose()
	})

	it.each([
		{ method: "start", requestedId: undefined },
		{ method: "restore", requestedId: undefined },
		{ method: "start", requestedId: " existing-task " },
	])("preserves session ID intent and uses Core's identity ($method, $requestedId)", async ({ method, requestedId }) => {
		const telemetry = makeTelemetry()
		const capture = vi.spyOn(telemetry, "capture")
		const dispose = vi.spyOn(VscodeGitTelemetry.prototype, "dispose")
		const actualId = requestedId?.trim() ?? "core-generated-task"
		const input: ClineCoreStartInput = {
			initialMessages: [{ id: "previous", role: "user", content: [{ type: "text", text: "previous turn" }] }],
			config: {
				...gitStartInput.config,
				sessionId: requestedId,
				extensions: [{ name: "existing-extension", manifest: { capabilities: [] }, setup: vi.fn() }],
			},
		}
		let preparedConfig: ClineCoreStartInput["config"] | undefined
		const checkPrepared = (prepared: ClineCoreStartInput) => {
			expect(prepared.config.sessionId).toBe(requestedId)
			expect(prepared.initialMessages).toBe(input.initialMessages)
			expect(prepared.config.extensions).toEqual(input.config.extensions)
			preparedConfig = prepared.config
		}
		mockClineCoreCreate.mockResolvedValue({
			start: async (start: ClineCoreStartInput) => {
				checkPrepared(start)
				return { sessionId: actualId }
			},
			restore: async (restore: { start: ClineCoreStartInput }) => {
				checkPrepared(restore.start)
				return { sessionId: actualId, startResult: { sessionId: actualId } }
			},
			stop: async () => {},
			dispose: async () => {},
		})
		const host = await VscodeSessionHost.create({ mcpHub: {} as never, telemetry })
		if (method === "start") await host.start(input)
		else await host.restore({ sessionId: "source", checkpointRunCount: 1, start: input })
		await preparedConfig?.hooks?.afterModel?.({
			snapshot: {
				agentId: "root",
				runId: "run",
				iteration: 1,
				status: "running",
				messages: [],
				pendingToolCalls: [],
				usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
			},
			requestId: "backend-request",
			finishReason: "stop",
			assistantMessage: { id: "reply", role: "assistant", content: [], createdAt: 0 },
		})
		await vi.waitFor(() => expect(capture).toHaveBeenCalledTimes(1))
		expect(capture.mock.calls[0][0].properties).toMatchObject({
			sessionId: actualId,
			ulid: actualId,
			request_id: "backend-request",
		})
		expect(input.config.sessionId).toBe(requestedId)
		await host.stop(actualId)
		await host.dispose()
		expect(dispose).toHaveBeenCalledTimes(1)
	})

	it("binds overlapping starts to their own results and disposes sessions independently", async () => {
		const firstPrepared = Promise.withResolvers<void>()
		const releaseFirst = Promise.withResolvers<void>()
		const configure = vi.spyOn(VscodeGitTelemetry.prototype, "configure")
		const dispose = vi.spyOn(VscodeGitTelemetry.prototype, "dispose")
		mockInnerStart.mockImplementation(async (input: ClineCoreStartInput) => {
			if (input.config.modelId === "first") {
				firstPrepared.resolve()
				await releaseFirst.promise
			}
			return { sessionId: `core-${input.config.modelId}` }
		})
		const host = await VscodeSessionHost.create({ mcpHub: {} as never, telemetry: makeTelemetry() })
		const first = host.start({ config: { ...gitStartInput.config, sessionId: undefined, modelId: "first" } })
		await firstPrepared.promise
		await host.start({ config: { ...gitStartInput.config, sessionId: undefined, modelId: "second" } })
		releaseFirst.resolve()
		await first
		expect(configure.mock.contexts[0]).toHaveProperty("sessionId", "core-first")
		expect(configure.mock.contexts[1]).toHaveProperty("sessionId", "core-second")
		await host.stop("core-first")
		expect(dispose.mock.contexts).toEqual([configure.mock.contexts[0]])
		await host.dispose()
		expect(dispose.mock.contexts).toEqual(configure.mock.contexts)
	})

	it("replaces the observer when Core reuses a session ID", async () => {
		const configure = vi.spyOn(VscodeGitTelemetry.prototype, "configure")
		const dispose = vi.spyOn(VscodeGitTelemetry.prototype, "dispose")
		const host = await VscodeSessionHost.create({ mcpHub: {} as never, telemetry: makeTelemetry() })
		await host.start(gitStartInput)
		await host.start(gitStartInput)
		expect(dispose.mock.contexts).toEqual([configure.mock.contexts[0]])
		await host.stop("core-task")
		await host.dispose()
		expect(dispose.mock.contexts).toEqual(configure.mock.contexts)
	})

	it.each(["start", "restore"])("disposes failed %s observers before binding Core's ID", async (method) => {
		const dispose = vi.spyOn(VscodeGitTelemetry.prototype, "dispose")
		const open = vi.spyOn(VscodeGitTelemetry.prototype, "open")
		const failure = new Error("startup failed")
		mockClineCoreCreate.mockResolvedValue({
			start: async () => {
				throw failure
			},
			restore: async () => {
				throw failure
			},
			dispose: async () => {},
		})
		const host = await VscodeSessionHost.create({ mcpHub: {} as never, telemetry: makeTelemetry() })
		const result =
			method === "start"
				? host.start(gitStartInput)
				: host.restore({ sessionId: "source", checkpointRunCount: 1, start: gitStartInput })
		await expect(result).rejects.toBe(failure)
		expect(open).not.toHaveBeenCalled()
		await host.dispose()
		expect(dispose).toHaveBeenCalledTimes(1)
	})

	it("closes a restored observer on host disposal", async () => {
		const dispose = vi.spyOn(VscodeGitTelemetry.prototype, "dispose")
		mockClineCoreCreate.mockResolvedValue({
			restore: async () => ({ sessionId: "git-task", startResult: { sessionId: "git-task" } }),
			dispose: async () => {},
		})
		const host = await VscodeSessionHost.create({ mcpHub: {} as never, telemetry: makeTelemetry() })
		await host.restore({ sessionId: "source", checkpointRunCount: 1, start: gitStartInput })
		expect(dispose).not.toHaveBeenCalled()
		await host.dispose()
		expect(dispose).toHaveBeenCalledTimes(1)
	})

	it("passes custom editor and apply_patch executors into tool executor capabilities", async () => {
		const editorExecutor = vi.fn()
		const applyPatchExecutor = vi.fn()
		await VscodeSessionHost.create({ mcpHub: {} as never, editorExecutor, applyPatchExecutor })
		expect(mockClineCoreCreate.mock.calls[0][0].capabilities.toolExecutors).toMatchObject({
			editor: editorExecutor,
			applyPatch: applyPatchExecutor,
		})
	})

	it("leaves default executors in place when no overrides are provided", async () => {
		await VscodeSessionHost.create({ mcpHub: {} as never })
		// ACT-CLINEMM-FORK-UPSTREAM-MERGE01: upstream's new test expected
		// `toolExecutors` to be `undefined` when no overrides are supplied.
		// The fork ALWAYS installs the default `submit` executor:
		//
		//   vscode-session-host.ts:
		//     toolExecutors.submit = options.submitExecutor ?? createVscodeSubmitExecutor()
		//
		// so `Object.keys(toolExecutors).length > 0` is true and the
		// executor map IS passed to Core. The fork's submit executor is a
		// load-bearing authority (it is the path the `submit` tool takes
		// back into the extension host); dropping it would leave Core
		// without a way to deliver a submitted turn.
		//
		// The fork's contract wins: assert that the DEFAULT submit
		// executor is present and that no caller-provided override
		// leaked in.
		const executors = mockClineCoreCreate.mock.calls[0][0].capabilities.toolExecutors as Record<string, unknown> | undefined
		expect(executors).toBeDefined()
		expect(executors?.submit).toBeTypeOf("function")
		// No caller-provided overrides were supplied, so only the default
		// submit executor is present.
		expect(Object.keys(executors ?? {})).toEqual(["submit"])
	})

	it.each(["start", "restore"])("prepares %s once: readiness, remote config, then extra tools", async (method) => {
		const events: string[] = []
		const restore = vi.fn(async (_input: unknown) => ({ checkpoint: {} }))
		mockClineCoreCreate.mockResolvedValue({ start: mockInnerStart, restore })
		mockCreateVscodeExtraTools.mockImplementationOnce(async () => {
			events.push("tools")
			return [{ name: "vscode-tool" }] as never
		})
		const host = await VscodeSessionHost.create({
			mcpHub: {} as never,
			beforeStartSession: async () => {
				events.push("ready")
			},
			getRemoteConfigIntegration: () => {
				events.push("select")
				return {
					applyToStartSessionInput: (input: ClineCoreStartInput) => {
						events.push("apply")
						return { ...input, config: { ...input.config, extraTools: [{ name: "remote-tool" }] } }
					},
				} as never
			},
		})
		if (method === "start") await host.start(gitStartInput)
		else await host.restore({ sessionId: "source", checkpointRunCount: 1, start: gitStartInput })
		expect(events).toEqual(["ready", "select", "apply", "tools"])
		const prepared =
			method === "start"
				? mockInnerStart.mock.calls[0][0]
				: (restore.mock.calls[0][0] as { start: ClineCoreStartInput }).start
		expect(prepared.source).toBe("vscode")
		expect(prepared.config.extraTools).toEqual([{ name: "remote-tool" }, { name: "vscode-tool" }])
		expect(prepared.localRuntime.configExtensions).not.toContain("hooks")
	})

	it("normalizes local-runtime hooks before preparation without losing them", async () => {
		const afterModel = vi.fn()
		const host = await VscodeSessionHost.create({ mcpHub: {} as never, telemetry: makeTelemetry() })
		const input = { ...gitStartInput, localRuntime: { hooks: { afterModel } } }
		await host.start(input)
		expect(input.config.hooks).toBeUndefined()
		expect(input.localRuntime.hooks.afterModel).toBe(afterModel)
		const prepared = mockInnerStart.mock.calls[0][0]
		expect(prepared.config.hooks.afterModel).not.toBe(afterModel)
		// Core normalizes again: localRuntime must not overwrite the telemetry wrapper.
		expect(toClineCoreStartInput(prepared).config.hooks?.afterModel).toBe(prepared.config.hooks.afterModel)
		await host.dispose()
	})

	it("does not prepare a workspace-only restore", async () => {
		const restore = vi.fn(async () => ({ checkpoint: {} }))
		const beforeStartSession = vi.fn()
		mockClineCoreCreate.mockResolvedValue({ restore })
		const host = await VscodeSessionHost.create({ mcpHub: {} as never, beforeStartSession })
		await host.restore({ sessionId: "session-1", checkpointRunCount: 1 })
		expect(beforeStartSession).not.toHaveBeenCalled()
		expect(restore).toHaveBeenCalledWith({ sessionId: "session-1", checkpointRunCount: 1 })
	})
})
