/**
 * ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-FOUNDATION01-R1A-RED01 / PIIF01 —
 * Executable R1a RED witness against real production seams.
 *
 * The §12 design freeze (commit 80723fb9f) and 06a (commit 7ffad0386)
 * classified the defect structurally; the seventh reviewer on the
 * active-binding authority correction (commit 666853329) required an
 * EXECUTED RED before FOUNDATION_IMPLEMENTATION_PHASE may open.
 *
 *   "Reopen condition is very small: Run one real production-seam
 *    test whose failing assertion is `NEXT_EFFECTIVE_CONNECTION == B`
 *    on the already-running session." — seventh reviewer
 *
 * This file is exactly that test.
 *
 * PRODUCTION SEAMS DRIVEN (real, not synthetic):
 *
 *   CONFIG MUTATION SEAM      = real SdkProviderChangeCoordinator
 *                               .handleApiConfigurationChanged
 *                               (apps/vscode/src/sdk/
 *                                sdk-provider-change-coordinator.ts:43-63).
 *                               Today: early-returns at line 48-50
 *                               on same-provider because the
 *                               discriminator keys on providerId only,
 *                               NOT on baseUrl/apiKey/headers.
 *
 *   SESSION LIFECYCLE SEAM    = real LocalRuntimeHost.startSession
 *                               (sdk/packages/core/src/runtime/host/
 *                                local-runtime-host.ts:398-428 →
 *                                startResolvedSession 430-).
 *                               Captures input.config into the
 *                               in-memory ActiveSession (line 918:
 *                               `this.sessions.set(sessionId, active)`).
 *
 *   RUNTIME CONNECTION SEAM   = in-memory ActiveSession.config.model
 *                               (sdk/packages/core/src/types/session.ts:14:
 *                               `config: CoreSessionConfig`).
 *                               This is the captured input to handler
 *                               construction; NOT re-read from global
 *                               state; immutable post-start under the
 *                               current same-provider early-return.
 *
 * SYNTHETIC_REAL (acknowledged):
 *
 *   - createAgent stub: returns a minimal SessionRuntime-shaped
 *     object. SessionRuntime is never INVOKED in this test because
 *     we never runTurn; the test only exercises the startSession
 *     capture path and the post-start observation seam.
 *
 *   - sessionService stub: provides the bare minimum surface
 *     needed by startResolvedSession to write the manifest. Returns
 *     tmp paths under the isolated HOME/CLINE_DIR; no real
 *     persistence required.
 *
 *   - stateManager stub: returns `mode = "act"` so the
 *     coordinator's `getCurrentMode()` resolves correctly. The
 *     coordinator does NOT consult stateManager for connection
 *     fields — it receives prev/next as method arguments directly.
 *
 * NOT_EXERCISED (acknowledged):
 *
 *   - Network provider request. The defect is observable entirely
 *     in the configuration-projection + session-lifecycle seams.
 *   - AgentRuntime. The SessionRuntime is stubbed; never invoked.
 *   - Live user session.
 *
 * OBSERVATION SEAM (the lowest real seam):
 *
 *   The in-memory `ActiveSession.config` (CoreSessionConfig,
 *   extending CoreModelConfig) at
 *   `local-runtime-host.ts:918`. Read via the host's private
 *   `sessions` map (cast to `any` in the test). This is the
 *   authoritative captured input to the runtime handler
 *   constructor; it is NEVER re-read from `stateManager` or
 *   `providerConfigStore` post-start.
 *
 *   We also observe `host.getSession(sessionId)` (the public
 *   manifest-shaped surface, line 1225-1236) as the secondary
 *   seam, but the assertion lives on the in-memory config because
 *   the manifest schema (SessionManifestSchema, session-manifest.ts)
 *   intentionally omits apiKey/baseUrl/headers.
 *
 * ASSERTION (the FAILing one — the RED):
 *
 *   After real coordinator.handleApiConfigurationChanged(A, B)
 *   where A and B share providerId but differ in apiKey/baseUrl/
 *   headers, the in-memory `ActiveSession.config.model.{apiKey,
 *   baseUrl, headers}` MUST equal B's values (the GREEN claim).
 *
 *   Today (pre-fix): the captured config still equals A's values
 *   because the coordinator early-returns at line 48-50 and never
 *   propagates the mutation. Therefore this assertion FAILS. The
 *   FAIL is the RED.
 *
 *   Post-fix (anticipated): the coordinator must recognize
 *   same-provider connection-field divergence and route the
 *   mutation through `LocalRuntimeHost.updateSessionConnection`
 *   (which mutates `session.config` in-place, line 1692-1697),
 *   making the assertion PASS.
 */

import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AgentResult, BasicLogger } from "@cline/shared"
import { setClineDir, setHomeDir } from "@cline/shared/storage"
import { LocalRuntimeHost } from "@cline-internal/core/runtime/host/local-runtime-host"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ApiConfiguration } from "@shared/api"
import { SdkProviderChangeCoordinator } from "../sdk-provider-change-coordinator"

const DISTINCT_ID = "act-piif01-r1a-red"

function makeLoggerStub(): BasicLogger {
	return {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		log: vi.fn(),
	} as unknown as BasicLogger
}

function makeSessionServiceStub(tmpDir: string) {
	return {
		ensureSessionsDir: vi.fn().mockReturnValue(tmpDir),
		createRootSessionWithArtifacts: vi.fn().mockImplementation(async (sessionId: string) => ({
			manifestPath: join(tmpDir, `${sessionId}.json`),
			messagesPath: join(tmpDir, `${sessionId}.messages.json`),
			manifest: {
				version: 1,
				session_id: sessionId,
				source: "vscode",
				pid: process.pid,
				started_at: "2026-01-01T00:00:00.000Z",
				status: "running",
				interactive: true,
				provider: "openai-compatible",
				model: "model-A2",
				cwd: tmpDir,
				workspace_root: tmpDir,
				enable_tools: true,
				enable_spawn: false,
				enable_teams: false,
				messages_path: join(tmpDir, `${sessionId}.messages.json`),
			},
		})),
		persistSessionMessages: vi.fn().mockResolvedValue(undefined),
		updateSessionStatus: vi.fn().mockResolvedValue({ updated: true }),
		writeSessionManifest: vi.fn().mockResolvedValue(undefined),
		readSessionManifest: vi.fn().mockResolvedValue(undefined),
		listSessions: vi.fn().mockResolvedValue([]),
		deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
	}
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

function makeAgentStub() {
	const agent = {
		run: vi.fn(async (_prompt: string): Promise<AgentResult> => ({
			text: "stub",
			iterations: 0,
			finishReason: "completed",
			usage: { inputTokens: 0, outputTokens: 0, totalCost: 0 },
			messages: [],
			toolCalls: [],
			durationMs: 0,
			model: { id: "stub", provider: "stub" },
			startedAt: new Date(),
			endedAt: new Date(),
		})),
		continue: vi.fn(),
		canStartRun: vi.fn(() => true),
		abort: vi.fn(),
		subscribeEvents: vi.fn().mockReturnValue(() => {}),
		subscribeRecoveryStateChange: vi.fn().mockReturnValue(() => {}),
		updateConnection: vi.fn(),
		getAgentId: vi.fn().mockReturnValue("agent-piif01"),
		getConversationId: vi.fn().mockReturnValue("conv-piif01"),
		shutdown: vi.fn().mockResolvedValue(undefined),
		getMessages: vi.fn().mockReturnValue([]),
	}
	return { agent }
}

async function makeHost(tmpDir: string) {
	const sessionService = makeSessionServiceStub(tmpDir)
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

function makeStartConfig(sessionId: string, baseUrl: string, apiKey: string, headers: Record<string, string>) {
	return {
		sessionId,
		providerId: "openai-compatible",
		modelId: "model-A2",
		apiKey,
		baseUrl,
		headers,
		cwd: "/workspace",
		workspaceRoot: "/workspace",
		systemPrompt: "test",
		mode: "act" as const,
		enableTools: true,
		enableSpawnAgent: false,
		enableAgentTeams: false,
	}
}

// ── Test environment ──────────────────────────────────────────────────

describe("ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-FOUNDATION01-R1A-RED01 / PIIF01", () => {
	const envSnapshot = {
		HOME: process.env.HOME,
		CLINE_DIR: process.env.CLINE_DIR,
		CLINE_DATA_DIR: process.env.CLINE_DATA_DIR,
	}
	let isolatedHomeDir = ""

	beforeEach(() => {
		isolatedHomeDir = mkdtempSync(join(tmpdir(), "act-piif01-r1a-red-"))
		process.env.HOME = isolatedHomeDir
		process.env.CLINE_DIR = join(isolatedHomeDir, ".cline")
		delete process.env.CLINE_DATA_DIR
		setHomeDir(isolatedHomeDir)
		setClineDir(process.env.CLINE_DIR)
	})

	afterEach(() => {
		process.env.HOME = envSnapshot.HOME
		process.env.CLINE_DIR = envSnapshot.CLINE_DIR
		if (envSnapshot.CLINE_DATA_DIR === undefined) {
			delete process.env.CLINE_DATA_DIR
		} else {
			process.env.CLINE_DATA_DIR = envSnapshot.CLINE_DATA_DIR
		}
		setHomeDir(envSnapshot.HOME ?? "~")
		setClineDir(envSnapshot.CLINE_DIR ?? join("~", ".cline"))
		rmSync(isolatedHomeDir, { recursive: true, force: true })
		vi.restoreAllMocks()
	})

	// R1a PRINCIPAL RED — see file header for full classification.
	it("PIIF01_R1A_RED: same-provider config mutation to B does NOT propagate B's connection fields to the running session", async () => {
		const sessionId = "sess-piif01-r1a-red"
		const tmpDir = join(isolatedHomeDir, "sessions")
		const { host } = await makeHost(tmpDir)
		try {
			// Step 1: start session with A
			const headersA = { "X-Auth": "a", "X-Tenant": "tenant-a" }
			await host.startSession({
				source: "vscode",
				interactive: true,
				config: makeStartConfig(sessionId, "https://endpoint-A", "key-A", headersA) as never,
			})

			// Step 2: observe A captured into ActiveSession.config
			const sessions = (
				host as unknown as {
					sessions: Map<
						string,
						{
							config: {
								apiKey?: string
								baseUrl?: string
								headers?: Record<string, string>
								providerId: string
								modelId: string
							}
						}
					>
				}
			).sessions
			const activeBefore = sessions.get(sessionId)
			expect(activeBefore).toBeDefined()
			expect(activeBefore!.config.providerId).toBe("openai-compatible")
			expect(activeBefore!.config.modelId).toBe("model-A2")
			expect(activeBefore!.config.apiKey).toBe("key-A")
			expect(activeBefore!.config.baseUrl).toBe("https://endpoint-A")
			expect(activeBefore!.config.headers).toEqual(headersA)

			const manifestBefore = await host.getSession(sessionId)
			expect(manifestBefore?.provider).toBe("openai-compatible")
			expect(manifestBefore?.model).toBe("model-A2")

			// Step 3: build B (same provider, different connection)
			const configA: ApiConfiguration = {
				actModeApiProvider: "openai" as never,
				openAiBaseUrl: "https://endpoint-A",
				openAiApiKey: "key-A",
				openAiHeaders: JSON.stringify(headersA),
			} as unknown as ApiConfiguration
			const headersB = { "X-Auth": "b", "X-Tenant": "tenant-b" }
			const configB: ApiConfiguration = {
				actModeApiProvider: "openai" as never,
				openAiBaseUrl: "https://endpoint-B",
				openAiApiKey: "key-B",
				openAiHeaders: JSON.stringify(headersB),
			} as unknown as ApiConfiguration

			// Step 4: drive REAL SdkProviderChangeCoordinator
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
						isRunning: false,
					}),
					replaceActiveSession,
				} as never,
				messages: { appendAndEmit: vi.fn() } as never,
				sessionConfigBuilder: { build: vi.fn().mockResolvedValue({}) } as never,
				getTask: () => undefined,
				getWorkspaceRoot: vi.fn().mockResolvedValue("/workspace"),
				loadInitialMessages: vi.fn().mockResolvedValue(undefined),
				buildStartSessionInput: vi.fn(() => ({ config: {} })),
				postStateToWebview: vi.fn().mockResolvedValue(undefined),
				rebuilds: {
					request: vi.fn((_reason: string, rebuild: () => Promise<void>) => {
						void rebuild()
					}),
				} as never,
			})

			coordinator.handleApiConfigurationChanged(configA, configB)

			// Give the async rebuild path (if any) a chance to settle.
			await new Promise((resolve) => setTimeout(resolve, 50))

			// Step 5: observe post-mutation state
			const activeAfter = sessions.get(sessionId)

			// ── ASSERTION (the FAILing one — this is the RED) ──
			//
			// Post-fix (GREEN): these PASS because the coordinator
			// would have routed B's connection fields through
			// host.updateSessionConnection → session.config.
			//
			// Today (pre-fix RED): these FAIL because the
			// coordinator early-returns at line 48-50 and
			// session.config is never mutated.
			expect(activeAfter!.config.apiKey).toBe("key-B")
			expect(activeAfter!.config.baseUrl).toBe("https://endpoint-B")
			expect(activeAfter!.config.headers).toEqual(headersB)

			// The coordinator should NOT have called replaceActiveSession
			// for a same-provider connection-only mutation. Today it
			// doesn't (early-return). GREEN must also respect this.
			expect(replaceActiveSession).not.toHaveBeenCalled()
		} finally {
			await host.dispose()
		}
	})
})
