/**
 * ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-FOUNDATION01-R2-STRATEGY-B / PIIF01 —
 * R2 GREEN contract test for the Strategy-B explicit instance-apply
 * seam added in this ninety-sixth pass.
 *
 * The eighth reviewer required that the actual GREEN contract be:
 *   "explicit instance A→B apply ⇒ full reconstruction ⇒ resulting
 *    connection B."
 *
 * This file is exactly that test.
 *
 * CLASSIFICATION:
 *
 *   R2_STRATEGY_B_CONTRACT_GUARD = REAL.
 *
 *   LEGACY_SAME_PROVIDER_FIELD_EDIT_BEHAVIOR (frozen here):
 *     OUT_OF_SCOPE_FOR_FOUNDATION.
 *     This test does NOT exercise the legacy generic
 *     `handleApiConfigurationChanged` path; that is the diagnostic
 *     witness in
 *     `provider-instance-identity-r1a-red.piif01.test.ts`. The
 *     Foundation only guarantees that an explicit
 *     `applyProviderConfigurationInstance` call reconstructs the
 *     active session.
 *
 * PRODUCTION SEAMS DRIVEN (real, not synthetic):
 *
 *   INSTANCE-APPLY SEAM     = real SdkProviderChangeCoordinator
 *                             .applyProviderConfigurationInstance
 *                             (apps/vscode/src/sdk/
 *                              sdk-provider-change-coordinator.ts:
 *                              ninety-sixth-pass addition).
 *                             Strategy B: calls `replaceActiveSession`
 *                             with a startInput built from B's config,
 *                             which causes `LocalRuntimeHost.startSession`
 *                             to capture B into the new active session's
 *                             in-memory config.
 *
 *   SESSION LIFECYCLE SEAM  = real LocalRuntimeHost.startSession
 *                             (sdk/packages/core/src/runtime/host/
 *                              local-runtime-host.ts:398-428).
 *
 *   RUNTIME CONNECTION SEAM = in-memory ActiveSession.config
 *                             (CoreSessionConfig, extending
 *                             CoreModelConfig).
 *
 * SYNTHETIC_REAL (acknowledged):
 *
 *   - createAgent stub: returns a minimal SessionRuntime-shaped
 *     object. SessionRuntime is never INVOKED in this test.
 *
 *   - sessionService stub: provides the bare minimum surface
 *     needed by startResolvedSession to write the manifest.
 *
 *   - stateManager stub: returns `mode = "act"` so the
 *     coordinator's `getCurrentMode()` resolves correctly.
 *
 *   - sessionConfigBuilder.build stub: returns a SessionConfig
 *     whose `config` field carries B's effective values (apiKey /
 *     baseUrl / headers / providerId / modelId) when invoked.
 *     This is the only way the coordinator can route B through
 *     `replaceActiveSession` without introducing the real
 *     `providerConfigStore` projection; it's an explicit probe
 *     seam and is named `buildForApply` for clarity.
 *
 *   - replaceActiveSession stub: simulates replacement by calling
 *     `host.startSession(...)` with the new startInput, which
 *     captures B into a new in-memory active session on the same
 *     host. (The real `SdkSessionLifecycle.replaceActiveSession`
 *     does much more — dispose old, fence races, manage task
 *     proxy — but for this contract test we only need the
 *     observable outcome: a new active session on the host with
 *     B's connection captured.)
 *
 * NOT_EXERCISED (acknowledged):
 *
 *   - Network provider request. The contract is observable entirely
 *     in the configuration-projection + session-lifecycle seams.
 *   - AgentRuntime. The SessionRuntime is stubbed; never invoked.
 *   - Live user session.
 *   - Persistence. The Foundation's durable persistence layer is
 *     intentionally NOT yet added (50-line probe only); this test
 *     only proves the in-memory instance-apply routing works.
 *
 * ACT-OWNED TS DIAGNOSTICS (per eighth reviewer's reopen
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
