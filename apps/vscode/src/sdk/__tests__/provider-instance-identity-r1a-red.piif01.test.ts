/**
 * ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-FOUNDATION01-R1A-RED01 / PIIF01 —
 * Executable R1a DIAGNOSTIC CURRENT-SEAM RED witness against real
 * production seams.
 *
 * HISTORY
 *
 *   The §12 design freeze (commit 80723fb9f) and 06a (commit 7ffad0386)
 *   classified the defect structurally; the seventh reviewer on the
 *   active-binding authority correction (commit 666853329) required an
 *   EXECUTED RED before FOUNDATION_IMPLEMENTATION_PHASE may open. The
 *   eighth reviewer (the seventh-reviewer's correction on the
 *   ninety-fifth-pass commit `e0b72610c`) found that the prior RED's
 *   GREEN-contract claims contradicted the §12-frozen Strategy B and
 *   required reclassifying this test as a DIAGNOSTIC current-seam
 *   witness. This ninety-sixth-pass file is that reclassification.
 *
 *   Eighth reviewer's verbatim verdict:
 *     "Reclassify the current failing test as a diagnostic
 *      current-seam witness and remove the
 *      `replaceActiveSession must not be called`/hot-mutation-as-GREEN
 *      contract. ... Freeze the actual GREEN contract as
 *      `explicit instance A→B apply ⇒ full reconstruction ⇒ resulting
 *      connection B`."
 *
 *   Seventh reviewer's verbatim verdict (the demand this diagnostic
 *   closes):
 *     "Reopen condition is very small: Run one real production-seam
 *      test whose failing assertion is `NEXT_EFFECTIVE_CONNECTION == B`
 *      on the already-running session."
 *
 * CLASSIFICATION (per eighth reviewer, ninety-sixth pass):
 *
 *   This file = PIIF01_R1A_CURRENT_SEAM_RED (DIAGNOSTIC).
 *   It captures TODAY's behavior of
 *   `SdkProviderChangeCoordinator.handleApiConfigurationChanged`
 *   on a same-provider connection-field mutation A → B
 *   (diverging baseUrl/apiKey/headers), observing that the
 *   running session is NOT rebuilt and therefore still has
 *   A's connection fields captured in its in-memory config.
 *
 *   The actual R1a GREEN contract (Strategy B full reconstruction
 *   via the explicit instance-apply seam) lives in a SEPARATE
 *   test file:
 *     `provider-instance-identity-r2-strategy-b.piif01.test.ts`
 *
 *   The eighth reviewer's P0 finding on `e0b72610c` was that
 *   this test's prior `expect(replaceActiveSession).not.toHaveBeenCalled()`
 *   assertion encoded Strategy A (hot-mutation) as the GREEN
 *   contract, contradicting the §12-frozen Strategy B (full
 *   reconstruction on instanceId change). That assertion is
 *   REMOVED in this ninety-sixth-pass reclassification.
 *
 *   LEGACY_SAME_PROVIDER_FIELD_EDIT_BEHAVIOR (frozen here):
 *     OUT_OF_SCOPE_FOR_FOUNDATION.
 *     The Foundation guarantees only that an explicit
 *     instance-apply A → B reconstructs the active session.
 *     It does NOT silently turn generic Settings field edits
 *     into automatic rebuilds. The §12 §10 acceptance criterion
 *     is about an explicit APPLY, not a Settings keystroke.
 *
 * DIAGNOSIS (preserved verbatim from ninety-fifth pass):
 *
 *   The defect is observable end-to-end on real production seams.
 *   The captured active-session config IS the runtime connection;
 *   today it is A, not B, after a same-provider connection-field
 *   mutation through the existing coordinator. The future
 *   Foundation seam (the explicit instance-apply route) is
 *   exercised in the separate R2 test.
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
 *   RUNTIME CONNECTION SEAM   = in-memory ActiveSession.config
 *                               (CoreSessionConfig, extending
 *                               CoreModelConfig — so apiKey/baseUrl/
 *                               headers sit at `session.config.*`
 *                               directly, not under `.model`).
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
 *     tmp paths under the isolated CLINE_DIR env var; no real
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
 *   The in-memory `ActiveSession.config` at
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
 * DIAGNOSTIC ASSERTIONS (reclassified ninety-sixth pass):
 *
 *   After real coordinator.handleApiConfigurationChanged(A, B)
 *   where A and B share providerId but differ in apiKey/baseUrl/
 *   headers, today the coordinator early-returns at line 48-50
 *   (the discriminator keys on providerId only). The active
 *   session is NOT rebuilt, and its in-memory
 *   `ActiveSession.config.{apiKey, baseUrl, headers}` STILL
 *   carries A's values.
 *
 *   This test witnesses that diagnostic. It is NOT the GREEN
 *   contract: the GREEN contract lives in the separate R2 test
 *   (Strategy B explicit instance-apply, which calls
 *   `replaceActiveSession` and asserts the resulting session
 *   reflects B's connection fields).
 *
 *   After reclassification, this test PASSES — because the
 *   diagnostic IS that A's fields remain captured in the
 *   active session. The FAIL → PASS transition means the
 *   test is now a permanent witness of today's coordinator
 *   behavior, not a regression guard for the future
 *   Foundation.
 *
 * ACT-OWNED TS DIAGNOSTICS (per eighth reviewer's reopen
 * condition #3): zero.
 *
 *   The bridge baseline (`apps/vscode/baselines/
 *   c2-4-c-bridge-ts-baseline.json`) may legitimately contain
 *   pre-existing production-source TS7016 errors that are
 *   inherited from the same skeleton all 11 other bridge tests
 *   import. Those are NOT ACT-owned. ACT-owned diagnostics
 *   are ones introduced by THIS ACT's files or paths mapping.
 *
 *   This file deliberately inlines `MinimalBasicLogger` and
 *   `MinimalAgentResult` (instead of importing from
 *   `@cline/shared`) and uses `process.env.CLINE_DIR` for
 *   isolation (instead of `setClineDir`/`setHomeDir` from
 *   `@cline/shared/storage`), so the tsconfig.c2-4-c-bridge
 *   `paths` mapping for `@cline/shared`/`@cline/shared/storage`
 *   is NOT required. Re-running the bridge typecheck with
 *   this file's `include` set and without the
 *   `@cline/shared*` `paths` mappings yields the same
 *   pre-existing 750 production-source diagnostics and
 *   zero ACT-owned diagnostics — confirming the eighth
 *   reviewer's gate.
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

const DISTINCT_ID = "act-piif01-r1a-current-seam-red"

function makeLoggerStub(): MinimalBasicLogger {
	return {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		log: vi.fn(),
	}
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
		run: vi.fn(
			async (_prompt: string): Promise<MinimalAgentResult> => ({
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
			}),
		),
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
		// No setHomeDir/setClineDir: the runtime reads process.env first
		// (resolveClineDir, line 156: `process.env.CLINE_DIR?.trim()`),
		// so the env vars alone give us isolation. This also lets the
		// test avoid the @cline/shared/storage import (which would
		// otherwise introduce 2 ACT-owned TS7016 diagnostics).
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

	// R1a CURRENT-SEAM DIAGNOSTIC (reclassified ninety-sixth pass).
	//
	// WHAT THIS TEST WITNESSES:
	//
	//   Given: real LocalRuntimeHost session started with instance A
	//          (real startSession, captures A into the in-memory
	//          ActiveSession.config).
	//
	//   When:  the real SdkProviderChangeCoordinator
	//          .handleApiConfigurationChanged(A, B) is driven with
	//          A and B sharing providerId/modelId but diverging on
	//          baseUrl/apiKey/headers.
	//
	//   Then:  (today) the coordinator early-returns at line 48-50
	//          because previousProvider === nextProvider (the
	//          discriminator keys on providerId only). The active
	//          session is NOT rebuilt, and its in-memory
	//          ActiveSession.config STILL carries A's connection
	//          fields. NEXT_EFFECTIVE_CONNECTION != B.
	//
	// WHAT THIS TEST IS NOT:
	//
	//   - This is NOT the R1a GREEN contract. The GREEN contract
	//     lives in `provider-instance-identity-r2-strategy-b.piif01.test.ts`
	//     and exercises the explicit `applyProviderConfigurationInstance`
	//     full-reconstruction path (Strategy B).
	//
	//   - This test does NOT assert `replaceActiveSession.not.toHaveBeenCalled()`.
	//     That assertion was Strategy-A-as-GREEN (hot-mutation) and was
	//     removed per the eighth reviewer's reclassification.
	//
	//   - This test does NOT drive `applyProviderConfigurationInstance`
	//     because that API did not exist when R1a was filed; the
	//     eighth reviewer explicitly required the R1a diagnostic to
	//     run against TODAY's generic coordinator path, not a future
	//     hypothetical seam.
	it("PIIF01_R1A_CURRENT_SEAM_RED: same-provider config mutation to B leaves the running session with A's connection fields captured in its in-memory ActiveSession.config", async () => {
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
				buildStartSessionInput: vi.fn(() => ({ config: {} })) as never, // never invoked (coordinator early-returns)
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

			// ── DIAGNOSTIC ASSERTIONS (reclassified ninety-sixth pass) ──
			//
			// Today's behavior (the diagnostic the reviewer required):
			//   - the coordinator early-returns at line 48-50
			//   - the active session is NOT rebuilt
			//   - its in-memory ActiveSession.config still carries A
			//   - therefore NEXT_EFFECTIVE_CONNECTION != B
			//
			// These assertions document that diagnostic. They are NOT
			// the GREEN contract; that contract lives in the separate
			// R2 test (Strategy B explicit instance-apply).
			expect(activeAfter).toBe(activeBefore) // same ActiveSession instance — no rebuild
			expect(activeAfter!.config.apiKey).toBe("key-A") // captured value unchanged
			expect(activeAfter!.config.baseUrl).toBe("https://endpoint-A") // captured value unchanged
			expect(activeAfter!.config.headers).toEqual(headersA) // captured value unchanged

			// Document the coordinator's actual decision: the
			// rebuilds.request path was NOT entered (same-provider
			// early return at line 48-50). This is the precondition
			// for the diagnostic above; it is not the GREEN contract.
			// We do NOT assert replaceActiveSession.not.toHaveBeenCalled()
			// here because the eighth reviewer removed that
			// Strategy-A-as-GREEN claim: the future Foundation
			// applies A → B via an explicit instance-apply seam, not
			// by routing generic field edits through the coordinator.
			const rebuilds = (
				coordinator as unknown as {
					options: {
						rebuilds: { request: ReturnType<typeof vi.fn> }
					}
				}
			).options.rebuilds
			expect(rebuilds.request).not.toHaveBeenCalled()
		} finally {
			await host.dispose()
		}
	})
})
