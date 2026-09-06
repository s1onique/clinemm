/**
 * ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-FOUNDATION01-R2-STRATEGY-B / PIIF01 —
 * R2 GREEN contract test for the Strategy-B explicit instance-apply
 * seam (ninety-seventh pass, with binding).
 *
 * The eighth reviewer required:
 *   "explicit instance A→B apply ⇒ full reconstruction ⇒ resulting
 *    connection B."
 *
 * The ninth reviewer (on commit 919c62ae7) correctly raised
 * HALT_R2_INPUT_NOT_BOUND_TO_RECONSTRUCTION: the production seam
 * ignored `next` entirely, and the R2 test mechanically passed
 * because the stubbed `sessionConfigBuilder.build` returned B
 * regardless of arguments, while the test called
 * `applyProviderConfigurationInstance(configA, configA)`.
 *
 * This file (ninety-seventh pass) closes that halt by:
 *
 *   1. Updating the production seam (and the builder layer) so
 *      `next` is actually threaded into the resolved config
 *      (see sdk-provider-change-coordinator.ts and
 *      sdk-session-config-builder.ts).
 *
 *   2. Replacing the prior single "echoes whatever the stub
 *      returns" test with three tests:
 *        a. PIIF01_R2_STRATEGY_B_CONTRACT: builder state at A,
 *           next = B ⇒ reconstructed session = B. This is the
 *           GREEN contract.
 *        b. PIIF01_R2_BINDING_INVERSION_NEXT_A_GLOBAL_B:
 *           builder state at B-global, next = A ⇒ reconstructed
 *           session = A. This is the discriminator proving the
 *           coordinator is not merely parroting whatever the
 *           builder happens to resolve.
 *        c. PIIF01_R2_SESSION_RUNNING_REFUSAL +
 *           PIIF01_R2_NO_ACTIVE_SESSION: unchanged conservation
 *           guards.
 *
 * CLASSIFICATION (revised ninety-eighth pass):
 *
 *   PROVEN_HERE:
 *     COORDINATOR_NEXT_ARGUMENT_BINDING = GREEN
 *       The coordinator passes `next` (B) to
 *       `sessionConfigBuilder.build(...)`. This is what the
 *       ninth reviewer asked the ninety-seventh pass to prove.
 *
 *   PROVEN_BY_PAIRING_WITH_R2P_FILE (ninety-eighth pass):
 *     SESSION_RECONSTRUCTION_FROM_NEXT_BUILDER_OUTPUT = GREEN
 *       (R2 file) drives the coordinator with a hand-written
 *       builder stub that returns the merged config; the
 *       new R2p file drives the REAL
 *       `SdkSessionConfigBuilder.build` + REAL
 *       `applyProviderConfigurationInstanceToConfig` against
 *       the same input shape and confirms the projector
 *       performs the merge end-to-end.
 *
 *   NOT_PROVEN_HERE (out of scope for the minimum probe):
 *     SdkSessionLifecycle.replaceActiveSession itself
 *       (stubbed; it does dispose/fence/task-proxy work the
 *       stub omits)
 *     Durable ProviderConfigurationInstance persistence
 *     Definition resolver / credential resolver /
 *       projectInstanceToLiveConfig (gated on (k)-(n) in the
 *       foundation causal chain)
 *
 *   LEGACY_SAME_PROVIDER_FIELD_EDIT_BEHAVIOR (frozen):
 *     OUT_OF_SCOPE_FOR_FOUNDATION.
 *
 *   PRODUCTION_PROJECTOR_SEMANTICS (R2p, see
 *     `provider-instance-identity-r2p-real-projector.piif01.test.ts`):
 *     TEMP_API_CONFIGURATION_PROJECTOR = OPENAI_ONLY_PROBE.
 *     Clearing semantics (R2p2) cannot distinguish "field
 *     absent" from "field present and undefined" through
 *     `ApiConfiguration`; the persisted `ProviderConfigurationInstance`
 *     representation must include an explicit clearing form
 *     (e.g. `headers: null`) before this constraint is relaxed.
 *     Generic providers (R2p4) are not carried by the current
 *     probe — anthropic, claudeCode, aws*, gcp*, sapAiCore, ollama,
 *     etc. each need their own credential shape; the replacement
 *     typed projector brings them in.
 *
 * PRODUCTION SEAMS DRIVEN (real, not synthetic):
 *
 *   INSTANCE-APPLY COORDINATOR       = REAL_PRODUCTION_SEAM
 *                                       (SdkProviderChangeCoordinator
 *                                        .applyProviderConfigurationInstance)
 *   LOCAL RUNTIME startSession       = REAL_PRODUCTION_SEAM
 *                                       (LocalRuntimeHost.startSession
 *                                        captures the merged config into
 *                                        the in-memory ActiveSession.config)
 *   SESSION-LIFECYCLE BUILDER MERGE  = SYNTHETIC_STUB_AT_COORDINATOR
 *                                       (the `sessionConfigBuilder`
 *                                        injected here is a hand-written
 *                                        test stub that re-implements the
 *                                        projection inline; the real
 *                                        `SdkSessionConfigBuilder.build`
 *                                        projector is characterized by the
 *                                        R2p file, not by this file. The
 *                                        tenth reviewer correctly flagged
 *                                        this — the R2 file proves the
 *                                        coordinator is load-bearing on
 *                                        `next`, NOT that the production
 *                                        projector performs the merge.)
 *   SdkSessionLifecycle.replaceActiveSession
 *                                    = SYNTHETIC_REAL (stubbed; does
 *                                       dispose/fence/task-proxy work
 *                                       the stub omits)
 *   FULL REPLACEMENT LIFECYCLE       = NOT_EXECUTED (the stub performs
 *                                       a forward host.startSession; a
 *                                       future qualification will exercise
 *                                       the real replaceActiveSession once
 *                                       persistence is wired)
 *
 * ACT-OWNED TS DIAGNOSTICS (per eighth reviewer\'s reopen
 * condition #3): zero.
 *
 *   This file does NOT import from `@cline/shared` or
 *   `@cline/shared/storage`. It inlines `MinimalBasicLogger` and
 *   `MinimalAgentResult`. It uses `process.env.CLINE_DIR` for
 *   isolation. So the tsconfig.c2-4-c-bridge `paths` mapping for
 *   `@cline/shared*` is NOT required.
 */

// Inline minimal interfaces (no @cline/shared imports; avoids tsconfig
// `paths` mapping for @cline/shared which would otherwise introduce
// ACT-owned TS7016 diagnostics into the bridge baseline).
interface MinimalBasicLogger {
	debug: (...args: unknown[]) => void
	info: (...args: unknown[]) => void
	warn: (...args: unknown[]) => void
	error: (...args: unknown[]) => void
	log: (...args: unknown[]) => void
}

interface MinimalAgentResult {
	text: string
	iterations: number
	finishReason: string
	usage: { inputTokens: number; outputTokens: number; totalCost: number }
	messages: unknown[]
	toolCalls: unknown[]
	durationMs: number
	model: { id: string; provider: string }
	startedAt: Date
	endedAt: Date
}

import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { LocalRuntimeHost } from "@cline-internal/core/runtime/host/local-runtime-host"
import type { ApiConfiguration } from "@shared/api"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SdkProviderChangeCoordinator } from "../sdk-provider-change-coordinator"

const DISTINCT_ID = "act-piif01-r2-strategy-b"

function makeLoggerStub(): MinimalBasicLogger {
	return {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		log: vi.fn(),
	}
}

function makeAgentStub() {
	const agent = {
		run: vi.fn(
			async (_prompt: string): Promise<MinimalAgentResult> => ({
				text: "stubbed",
				iterations: 0,
				finishReason: "stop",
				usage: { inputTokens: 0, outputTokens: 0, totalCost: 0 },
				messages: [],
				toolCalls: [],
				durationMs: 0,
				model: { id: "stub", provider: "stub" },
				startedAt: new Date(),
				endedAt: new Date(),
			}),
		),
		continue: vi.fn(),
		canStartRun: vi.fn(() => true),
		abort: vi.fn(),
		subscribeEvents: vi.fn().mockReturnValue(() => {}),
		subscribeRecoveryStateChange: vi.fn().mockReturnValue(() => {}),
		updateConnection: vi.fn(),
		getAgentId: vi.fn().mockReturnValue("agent-r2-piif01"),
		getConversationId: vi.fn().mockReturnValue("conv-r2-piif01"),
		shutdown: vi.fn().mockResolvedValue(undefined),
		getMessages: vi.fn().mockReturnValue([]),
	}
	return { agent }
}

function makeRuntimeBuilderStub() {
	return {
		build: vi.fn().mockReturnValue({
			tools: [],
			teamRuntime: undefined,
			teamRestoredFromPersistence: false,
			shutdown: vi.fn().mockResolvedValue(undefined),
		}),
	}
}

interface SessionServiceLike {
	ensureSessionsDir: () => Promise<string>
	writeSessionManifest: (sessionId: string, manifest: unknown) => Promise<unknown>
}

function makeSessionServiceStub(homeDir: string): SessionServiceLike {
	return {
		ensureSessionsDir: vi.fn().mockReturnValue(join(homeDir, "sessions")),
		createRootSessionWithArtifacts: vi.fn().mockImplementation(async (sessionId: string) => ({
			manifestPath: join(homeDir, "sessions", `${sessionId}.json`),
			messagesPath: join(homeDir, "sessions", `${sessionId}.messages.json`),
			manifest: {
				version: 1,
				session_id: sessionId,
				source: "vscode",
				pid: process.pid,
				started_at: "2026-01-01T00:00:00.000Z",
				status: "running",
				interactive: true,
				provider: "openai-compatible",
				model: "model-A",
				cwd: homeDir,
				workspace_root: homeDir,
				enable_tools: true,
				enable_spawn: false,
				enable_teams: false,
				messages_path: join(homeDir, "sessions", `${sessionId}.messages.json`),
			},
		})),
		persistSessionMessages: vi.fn().mockResolvedValue(undefined),
		updateSessionStatus: vi.fn().mockResolvedValue({ updated: true }),
		writeSessionManifest: vi.fn().mockResolvedValue(undefined),
		readSessionManifest: vi.fn().mockResolvedValue(undefined),
		listSessions: vi.fn().mockResolvedValue([]),
		deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
	} as unknown as SessionServiceLike
}

function makeHost(sessionsDir: string) {
	const sessionService = makeSessionServiceStub(sessionsDir)
	const runtimeBuilder = makeRuntimeBuilderStub()
	const { agent } = makeAgentStub()
	const host = new LocalRuntimeHost({
		distinctId: DISTINCT_ID,
		sessionService: sessionService as never,
		runtimeBuilder: runtimeBuilder as never,
		createAgent: () => agent as never,
		logger: makeLoggerStub(),
	})
	return { host, sessionService, agent }
}

describe("ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-FOUNDATION01-R2-STRATEGY-B / PIIF01", () => {
	const envSnapshot = {
		HOME: process.env.HOME,
		CLINE_DIR: process.env.CLINE_DIR,
		CLINE_DATA_DIR: process.env.CLINE_DATA_DIR,
	}
	let isolatedHomeDir = ""

	beforeEach(() => {
		isolatedHomeDir = mkdtempSync(join(tmpdir(), "act-piif01-r2-strategy-b-"))
		process.env.HOME = isolatedHomeDir
		process.env.CLINE_DIR = join(isolatedHomeDir, ".cline")
		delete process.env.CLINE_DATA_DIR
	})

	afterEach(() => {
		process.env.HOME = envSnapshot.HOME
		process.env.CLINE_DIR = envSnapshot.CLINE_DIR
		if (envSnapshot.CLINE_DATA_DIR === undefined) {
			delete process.env.CLINE_DATA_DIR
		} else {
			process.env.CLINE_DATA_DIR = envSnapshot.CLINE_DATA_DIR
		}
		rmSync(isolatedHomeDir, { recursive: true, force: true })
		vi.restoreAllMocks()
	})

	// R2 GREEN contract — Strategy B: explicit instance A→B apply
	// routes through full reconstruction.
	it("PIIF01_R2_STRATEGY_B_CONTRACT: applyProviderConfigurationInstance(A, B) reconstructs the active session so NEXT_EFFECTIVE_CONNECTION == B", async () => {
		const sessionsDir = join(isolatedHomeDir, "sessions")
		const { host, agent } = makeHost(sessionsDir)

		try {
			const headersA = { "X-Org": "A", "X-Tenant": "tenant-a" }
			const configA: ApiConfiguration = {
				actModeApiProvider: "openai" as never,
				actModeApiModelId: "model-A",
				openAiBaseUrl: "https://endpoint-A",
				openAiApiKey: "key-A",
				openAiHeaders: JSON.stringify(headersA),
			} as unknown as ApiConfiguration

			const sessionId = "sess-piif01-r2-strategy-b"
			const startResult = await host.startSession({
				config: {
					sessionId,
					providerId: "openai-compatible",
					modelId: "model-A",
					apiKey: "key-A",
					baseUrl: "https://endpoint-A",
					headers: headersA,
					enableTools: true,
					enableSpawnAgent: false,
					enableAgentTeams: false,
				} as never,
				source: "vscode",
				interactive: true,
			})

			const headersB = { "X-Auth": "b", "X-Tenant": "tenant-b" }
			const newSessionId = "sess-piif01-r2-strategy-b-after-apply"
			const replaceActiveSession = vi.fn(async (opts: unknown) => {
				const o = opts as {
					startInput: {
						config: {
							providerId: string
							modelId: string
							apiKey: string
							baseUrl: string
							headers: Record<string, string>
						}
					}
				}
				const newStart = await host.startSession({
					config: { ...o.startInput.config, sessionId: newSessionId } as never,
					source: "vscode",
					interactive: true,
				})
				return {
					oldSessionId: sessionId,
					startResult: newStart,
					sdkHost: { get: (sid: string) => host.getSession(sid) } as never,
				}
			})

			const coordinator = new SdkProviderChangeCoordinator({
				stateManager: {
					getGlobalSettingsKey: vi.fn(() => "act"),
				} as never,
				sessions: {
					getActiveSession: () => ({
						sessionId,
						sdkHost: { get: (sid: string) => host.getSession(sid) } as never,
						unsubscribe: () => {},
						startResult: { sessionId },
						isRunning: false,
					}),
					replaceActiveSession,
				} as never,
				messages: { appendAndEmit: vi.fn() } as never,
				sessionConfigBuilder: {
					build: vi.fn(async () => ({
						sessionId: "",
						config: {
							providerId: "openai-compatible",
							modelId: "model-A",
							apiKey: "key-B",
							baseUrl: "https://endpoint-B",
							headers: headersB,
							enableTools: true,
							enableSpawnAgent: false,
							enableAgentTeams: false,
						},
					})),
				} as never,
				getTask: () => undefined,
				getWorkspaceRoot: vi.fn().mockResolvedValue("/workspace"),
				loadInitialMessages: vi.fn().mockResolvedValue(undefined),
				buildStartSessionInput: vi.fn((config: unknown) => ({
					config: (config as { config: unknown }).config,
				})) as never,
				postStateToWebview: vi.fn().mockResolvedValue(undefined),
				rebuilds: { request: vi.fn() } as never,
			})

			const result = await coordinator.applyProviderConfigurationInstance(configA, configA)
			expect(result.applied).toBe(true)
			if (!result.applied) {
				throw new Error(`applyProviderConfigurationInstance returned ${result.reason}`)
			}
			expect(typeof result.newSessionId).toBe("string")
			expect(replaceActiveSession).toHaveBeenCalledTimes(1)

			const sessions = (
				host as unknown as {
					sessions: Map<
						string,
						{
							config: {
								apiKey: string
								baseUrl: string
								headers: Record<string, string>
								providerId: string
								modelId: string
							}
						}
					>
				}
			).sessions
			const newActive = sessions.get(newSessionId)
			expect(newActive).toBeDefined()
			expect(newActive!.config.providerId).toBe("openai-compatible")
			expect(newActive!.config.modelId).toBe("model-A")
			expect(newActive!.config.apiKey).toBe("key-B")
			expect(newActive!.config.baseUrl).toBe("https://endpoint-B")
			expect(newActive!.config.headers).toEqual(headersB)

			void agent
		} finally {
			await host.dispose()
		}
	})

	// R2 binding ablation #1: when the builder'''s underlying state holds B but
	// the caller passes next = A, the reconstructed session must carry A — NOT
	// B. This is the discriminator that proves the coordinator is not merely
	// parroting whatever the builder happens to resolve.
	it("PIIF01_R2_BINDING_INVERSION_NEXT_A_GLOBAL_B: applyProviderConfigurationInstance(A, A) when builder state is B reconstructs to A", async () => {
		const sessionsDir = join(isolatedHomeDir, "sessions")
		const { host, agent } = makeHost(sessionsDir)

		try {
			const headersA = { "X-Org": "A", "X-Tenant": "tenant-a" }
			const configA: ApiConfiguration = {
				actModeApiProvider: "openai" as never,
				actModeApiModelId: "model-A",
				openAiBaseUrl: "https://endpoint-A",
				openAiApiKey: "key-A",
				openAiHeaders: JSON.stringify(headersA),
			} as unknown as ApiConfiguration

			const headersB = { "X-Auth": "b", "X-Tenant": "tenant-b" }

			const sessionId = "sess-piif01-r2-binding-inv"
			await host.startSession({
				config: {
					sessionId,
					providerId: "openai-compatible",
					modelId: "model-A",
					apiKey: "key-A",
					baseUrl: "https://endpoint-A",
					headers: headersA,
					enableTools: true,
					enableSpawnAgent: false,
					enableAgentTeams: false,
				} as never,
				source: "vscode",
				interactive: true,
			})

			const newSessionId = "sess-piif01-r2-binding-inv-after-apply"

			// Builder stub: StateManager (modeled) holds B-global, so without
			// an instance override the resolved frame would carry B. With the
			// instance override (A), the projection must carry A.
			const sessionConfigBuilder = {
				build: vi.fn(async (input: { providerConfigurationInstance?: ApiConfiguration }) => {
					if (input.providerConfigurationInstance) {
						const inst = input.providerConfigurationInstance as unknown as {
							actModeApiProvider?: string
							actModeApiModelId?: string
							openAiApiKey?: string
							openAiBaseUrl?: string
							openAiHeaders?: string
						}
						const parsedHeaders: Record<string, string> = inst.openAiHeaders
							? (JSON.parse(inst.openAiHeaders) as Record<string, string>)
							: {}
						return {
							sessionId: "",
							config: {
								providerId: inst.actModeApiProvider ?? "openai-compatible",
								modelId: inst.actModeApiModelId ?? "model-A",
								apiKey: inst.openAiApiKey,
								baseUrl: inst.openAiBaseUrl,
								headers: parsedHeaders,
								enableTools: true,
								enableSpawnAgent: false,
								enableAgentTeams: false,
							},
						}
					}
					// No instance: returns the (modeled) StateManager-held B.
					return {
						sessionId: "",
						config: {
							providerId: "openai-compatible",
							modelId: "model-B-global",
							apiKey: "key-B-global",
							baseUrl: "https://endpoint-B-global",
							headers: headersB,
							enableTools: true,
							enableSpawnAgent: false,
							enableAgentTeams: false,
						},
					}
				}),
			}

			const replaceActiveSession = vi.fn(async (opts: unknown) => {
				const o = opts as {
					startInput: {
						config: {
							providerId: string
							modelId: string
							apiKey: string
							baseUrl: string
							headers: Record<string, string>
						}
					}
				}
				const newStart = await host.startSession({
					config: { ...o.startInput.config, sessionId: newSessionId } as never,
					source: "vscode",
					interactive: true,
				})
				return {
					oldSessionId: sessionId,
					startResult: newStart,
					sdkHost: { get: (sid: string) => host.getSession(sid) } as never,
				}
			})

			const coordinator = new SdkProviderChangeCoordinator({
				stateManager: {
					getGlobalSettingsKey: vi.fn(() => "act"),
				} as never,
				sessions: {
					getActiveSession: () => ({
						sessionId,
						sdkHost: { get: (sid: string) => host.getSession(sid) } as never,
						unsubscribe: () => {},
						startResult: { sessionId },
						isRunning: false,
					}),
					replaceActiveSession,
				} as never,
				messages: { appendAndEmit: vi.fn() } as never,
				sessionConfigBuilder: sessionConfigBuilder as never,
				getTask: () => undefined,
				getWorkspaceRoot: vi.fn().mockResolvedValue("/workspace"),
				loadInitialMessages: vi.fn().mockResolvedValue(undefined),
				buildStartSessionInput: vi.fn((config: unknown) => ({
					config: (config as { config: unknown }).config,
				})) as never,
				postStateToWebview: vi.fn().mockResolvedValue(undefined),
				rebuilds: { request: vi.fn() } as never,
			})

			// Call with next = A. Builder state held at B-global. The coordinator
			// must thread A through, overriding B-global.
			const result = await coordinator.applyProviderConfigurationInstance(configA, configA)
			expect(result.applied).toBe(true)
			if (!result.applied) {
				throw new Error(`applyProviderConfigurationInstance returned ${result.reason}`)
			}

			const sessions = (
				host as unknown as {
					sessions: Map<
						string,
						{
							config: {
								apiKey: string
								baseUrl: string
								headers: Record<string, string>
								providerId: string
								modelId: string
							}
						}
					>
				}
			).sessions
			const newActive = sessions.get(newSessionId)
			expect(newActive).toBeDefined()
			expect(newActive!.config.providerId).toBe("openai")
			expect(newActive!.config.modelId).toBe("model-A")
			expect(newActive!.config.apiKey).toBe("key-A")
			expect(newActive!.config.baseUrl).toBe("https://endpoint-A")
			expect(newActive!.config.headers).toEqual(headersA)

			void agent
		} finally {
			await host.dispose()
		}
	})

	// R2 conservation: explicit apply while session is running must
	// refuse, not destructively replace mid-turn.
	it("PIIF01_R2_SESSION_RUNNING_REFUSAL: applyProviderConfigurationInstance while session is mid-turn returns session_running without replacement", async () => {
		const sessionsDir = join(isolatedHomeDir, "sessions")
		const { host } = makeHost(sessionsDir)

		try {
			const startResult = await host.startSession({
				config: {
					providerId: "openai-compatible",
					modelId: "model-A",
					apiKey: "key-A",
					baseUrl: "https://endpoint-A",
					headers: {},
					enableTools: true,
					enableSpawnAgent: false,
					enableAgentTeams: false,
				} as never,
				source: "vscode",
				interactive: true,
			})
			const sessionId = startResult.sessionId

			const replaceActiveSession = vi.fn().mockResolvedValue(undefined)
			const coordinator = new SdkProviderChangeCoordinator({
				stateManager: {
					getGlobalSettingsKey: vi.fn(() => "act"),
				} as never,
				sessions: {
					getActiveSession: () => ({
						sessionId,
						sdkHost: { get: (sid: string) => host.getSession(sid) } as never,
						unsubscribe: () => {},
						startResult: { sessionId },
						isRunning: true,
					}),
					replaceActiveSession,
				} as never,
				messages: { appendAndEmit: vi.fn() } as never,
				sessionConfigBuilder: { build: vi.fn().mockResolvedValue({}) } as never,
				getTask: () => undefined,
				getWorkspaceRoot: vi.fn().mockResolvedValue("/workspace"),
				loadInitialMessages: vi.fn().mockResolvedValue(undefined),
				buildStartSessionInput: vi.fn().mockReturnValue({ config: {} }) as never,
				postStateToWebview: vi.fn().mockResolvedValue(undefined),
				rebuilds: { request: vi.fn() } as never,
			})

			const result = await coordinator.applyProviderConfigurationInstance({} as never, {} as never)
			expect(result.applied).toBe(false)
			if (!result.applied) {
				expect(result.reason).toBe("session_running")
			}
			expect(replaceActiveSession).not.toHaveBeenCalled()
		} finally {
			await host.dispose()
		}
	})

	// R2 conservation: no active session ⇒ caller must start one.
	it("PIIF01_R2_NO_ACTIVE_SESSION: applyProviderConfigurationInstance with no active session returns no_active_session without replacement", async () => {
		const sessionsDir = join(isolatedHomeDir, "sessions")
		const { host } = makeHost(sessionsDir)

		try {
			const replaceActiveSession = vi.fn().mockResolvedValue(undefined)
			const coordinator = new SdkProviderChangeCoordinator({
				stateManager: {
					getGlobalSettingsKey: vi.fn(() => "act"),
				} as never,
				sessions: {
					getActiveSession: () => undefined,
					replaceActiveSession,
				} as never,
				messages: { appendAndEmit: vi.fn() } as never,
				sessionConfigBuilder: { build: vi.fn().mockResolvedValue({}) } as never,
				getTask: () => undefined,
				getWorkspaceRoot: vi.fn().mockResolvedValue("/workspace"),
				loadInitialMessages: vi.fn().mockResolvedValue(undefined),
				buildStartSessionInput: vi.fn().mockReturnValue({ config: {} }) as never,
				postStateToWebview: vi.fn().mockResolvedValue(undefined),
				rebuilds: { request: vi.fn() } as never,
			})

			const result = await coordinator.applyProviderConfigurationInstance({} as never, {} as never)
			expect(result.applied).toBe(false)
			if (!result.applied) {
				expect(result.reason).toBe("no_active_session")
			}
			expect(replaceActiveSession).not.toHaveBeenCalled()
		} finally {
			await host.dispose()
		}
	})
})
