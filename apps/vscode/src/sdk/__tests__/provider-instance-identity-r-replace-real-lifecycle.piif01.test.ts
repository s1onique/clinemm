/**
 * ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-IMPLEMENTATION01 / R-REPLACE
 *
 * Real composed-lifecycle witness (fourteenth reviewer, C1:
 * "GO TO R-REPLACE", on the hundred-and-first-pass commit 50623cf39).
 *
 * The thirteenth-reviewer halt
 * `HALT_MISSING_INSTANCE_SECRET_FAILS_OPEN` was closed
 * structurally: the builder is now the SOLE fail-closed gate and
 * the projector signature is non-nullable with a runtime guard.
 * But the structural proof stopped at the BUILDER seam. The
 * fourteenth reviewer requires the same fail-closed contract to
 * be observable through the LIFECYCLE seam — i.e. when the
 * builder rejects, the active session at the lifecycle layer is
 * genuinely still the original session (object identity
 * preserved), and when the builder succeeds the LIFECYCLE
 * actually performs the replacement (a NEW session is installed
 * with B's identity).
 *
 * This file drives the REAL composition:
 *
 *     REAL SdkSessionConfigBuilder.build()
 *         ↓
 *     [credential resolution]
 *         ↓
 *     [typed projection (R5)]
 *         ↓
 *     REAL SdkSessionLifecycle.replaceActiveSession(...)
 *         ↓
 *     REAL startNewSession() → install new active session
 *
 * Production seams driven (this file):
 *
 *   SdkSessionConfigBuilder.build                    = REAL_PRODUCTION_SEAM
 *   applyTypedProviderInstanceToConfig               = REAL_PRODUCTION_SEAM
 *   MissingProviderInstanceCredentialError           = REAL_PRODUCTION_SEAM
 *   SdkSessionLifecycle.replaceActiveSession         = REAL_PRODUCTION_SEAM
 *   SdkSessionLifecycle.startNewSession              = REAL_PRODUCTION_SEAM
 *   SdkSessionLifecycle.endActiveSession             = REAL_PRODUCTION_SEAM
 *   SdkSessionLifecycle.updateActiveSessionModel     = REAL_PRODUCTION_SEAM
 *
 * Collaborators stubbed:
 *
 *   buildSessionConfig (= baseline A)                = SYNTHETIC
 *   buildAgentHooks   (= no-op)                      = SYNTHETIC
 *   VscodeSessionHost.create (= fake sdkHost)        = SYNTHETIC
 *   StateManager (only autoApprovalSettings probed)  = SYNTHETIC
 */

import type { CoreSessionConfig } from "@cline/core"
import type { InstanceSecretName } from "@/shared/storage/instance-secret"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
	MissingProviderInstanceCredentialError,
	type ProviderConfigurationInstance,
} from "../instance-store/contracts"
import { SdkSessionConfigBuilder } from "../sdk-session-config-builder"
import { SdkSessionLifecycle } from "../sdk-session-lifecycle"

const mocks = vi.hoisted(() => ({
	buildSessionConfig: vi.fn(),
	buildAgentHooks: vi.fn(() => ({}) as unknown as CoreSessionConfig["hooks"]),
	createSessionHost: vi.fn(),
	stateManagerGetGlobalSettingsKey: vi.fn(() => undefined),
}))

vi.mock("../cline-session-factory", () => ({
	buildSessionConfig: mocks.buildSessionConfig,
}))

vi.mock("../hooks-adapter", () => ({
	buildAgentHooks: mocks.buildAgentHooks,
}))

vi.mock("../vscode-session-host", () => ({
	VscodeSessionHost: {
		create: mocks.createSessionHost,
	},
}))

vi.mock("@/core/storage/StateManager", () => ({
	StateManager: {
		get: () => ({
			getGlobalSettingsKey: mocks.stateManagerGetGlobalSettingsKey,
		}),
	},
}))

type FakeSdkHost = {
	start: ReturnType<typeof vi.fn>
	subscribe: ReturnType<typeof vi.fn>
	updateSessionModel: ReturnType<typeof vi.fn>
	stop: ReturnType<typeof vi.fn>
	dispose: ReturnType<typeof vi.fn>
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface BaselineShape {
	providerId?: string
	modelId?: string
	apiKey?: string | null
	baseUrl?: string | null
	headers?: Record<string, string> | null
}

function baselineAConfig(): CoreSessionConfig {
	return {
		providerId: "openai-compatible",
		modelId: "model-A",
		apiKey: "key-A",
		baseUrl: "https://endpoint-A",
		headers: { "X-A": "1" },
	} as unknown as CoreSessionConfig
}

function makeInstance(overrides: Partial<ProviderConfigurationInstance> = {}): ProviderConfigurationInstance {
	return {
		instanceId: "inst-B",
		providerId: "openai-compatible",
		displayLabel: "B",
		credentialRef: { kind: "secret", name: "instance:inst-B-key" as InstanceSecretName },
		connection: {
			modelId: "model-B",
			baseUrl: "https://endpoint-B",
			headers: { "X-B": "2" },
		},
		createdAt: 1,
		updatedAt: 1,
		...overrides,
	}
}

function makeFakeSdkHost(sessionIds: Array<string>): FakeSdkHost {
	let startCallIndex = 0
	return {
		start: vi.fn(async (_input: unknown) => {
			const idx = startCallIndex++
			const sessionId = sessionIds[idx] ?? sessionIds[sessionIds.length - 1] ?? "session-default"
			return { sessionId } as never
		}),
		subscribe: vi.fn(() => () => {}),
		updateSessionModel: vi.fn(async (_sessionId: string, _modelId: string) => undefined),
		stop: vi.fn(async (_sessionId: string) => undefined),
		dispose: vi.fn(async () => undefined),
	}
}

function makeLifecycle(): SdkSessionLifecycle {
	return new SdkSessionLifecycle({
		mcpHub: {} as never,
		requestToolApproval: vi.fn(),
		askQuestion: vi.fn(),
		onSessionEvent: vi.fn(),
		onSendComplete: vi.fn(),
		onSendError: vi.fn(),
	})
}

function makeBuilder(getInstanceSecretImpl: (name: InstanceSecretName) => string | undefined): SdkSessionConfigBuilder {
	return new SdkSessionConfigBuilder({
		stateManager: {
			getInstanceSecret: vi.fn(getInstanceSecretImpl),
		} as never,
		emitHookMessage: vi.fn(),
	})
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-IMPLEMENTATION01 / R-REPLACE", () => {
	beforeEach(() => {
		mocks.buildSessionConfig.mockReset()
		mocks.buildAgentHooks.mockReset()
		mocks.createSessionHost.mockReset()
		mocks.buildAgentHooks.mockImplementation(() => ({}) as unknown as CoreSessionConfig["hooks"])
		// buildSessionConfig is called for every builder.build() call;
		// we always resolve to a fresh baseline A so the projector
		// overlays cleanly each time. Returning the SAME object across
		// builds would also work, but a fresh one keeps the witnesses
		// isolated.
		mocks.buildSessionConfig.mockImplementation(() => Promise.resolve(baselineAConfig()))
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("R_REPLACE_POSITIVE: apply B through REAL SdkSessionConfigBuilder + REAL SdkSessionLifecycle.replaceActiveSession installs the projected B", async () => {
		const fakeHost = makeFakeSdkHost(["sess-A", "sess-B"])
		mocks.createSessionHost.mockResolvedValue(fakeHost)


		const builder = makeBuilder((name) => {
			if (name === ("instance:inst-B-key" as InstanceSecretName)) {
				return "physical-key-B"
			}
			return undefined
		})

		const lifecycle = makeLifecycle()

		// Step 1: install session A as the active session.
		const initialConfig = await builder.build({ cwd: "/workspace", mode: "act" })
		const initialStart = await lifecycle.startNewSession({
			config: { ...initialConfig, sessionId: "sess-A" },
			source: "vscode",
			interactive: true,
		} as never)
		expect(initialStart.status).toBe("started")
		if (initialStart.status !== "started") {
			throw new Error("initial startNewSession did not return started")
		}
		const activeSessionA = lifecycle.getActiveSession()!
		expect(activeSessionA.sessionId).toBe("sess-A")
		expect(activeSessionA.startConfig).toEqual({ providerId: "openai-compatible", modelId: "model-A" })

		// Mark session idle before attempting the apply (mirrors the
		// real flow: apply is refused while running).
		lifecycle.setRunning(false)

		// Step 2: drive the composed apply. Real builder + real lifecycle.
		const instanceB = makeInstance()
		const projectedB = await builder.build({
			cwd: "/workspace",
			mode: "act",
			providerConfigurationInstanceTyped: instanceB,
		})
		// The typed projector must have replaced the apiKey with the
		// PHYSICAL secret value, not the reference name.
		expect((projectedB as BaselineShape).apiKey).toBe("physical-key-B")
		expect((projectedB as BaselineShape).modelId).toBe("model-B")
		expect((projectedB as BaselineShape).baseUrl).toBe("https://endpoint-B")
		expect((projectedB as BaselineShape).headers).toEqual({ "X-B": "2" })
		expect((projectedB as BaselineShape).providerId).toBe("openai-compatible")

		const replaceResult = await lifecycle.replaceActiveSession({
			expectedSession: activeSessionA,
			startInput: {
				config: { ...projectedB, sessionId: "sess-B" },
				source: "vscode",
				interactive: true,
			} as never,
			disposeReason: "providerInstanceApply",
		})

		// replaceActiveSession must have succeeded.
		expect(replaceResult).toBeDefined()
		expect(replaceResult?.startResult.sessionId).toBe("sess-B")

		// The active session at the lifecycle layer is now the NEW one
		// (not the same object reference as A), with B's identity.
		const activeSessionB = lifecycle.getActiveSession()!
		expect(activeSessionB.sessionId).toBe("sess-B")
		expect(activeSessionB.startConfig).toEqual({ providerId: "openai-compatible", modelId: "model-B" })
		expect(activeSessionB).not.toBe(activeSessionA)

		// host.start was called exactly twice (once for A, once for B).
		expect(fakeHost.start).toHaveBeenCalledTimes(2)

		// ─── COMPLETE_V1_CONNECTION_AT_HOST_START ───
		// The fourteenth reviewer (this pass's predecessor) noted the
		// prior positive witness only asserted { providerId, modelId }
		// at the lifecycle layer (because `ActiveSession.startConfig`
		// intentionally only stores those two). Production source
		// already establishes passthrough -- `startNewSession` calls
		// `sdkHost.start({ ...startInput, ...(toolPolicies ? {...} : {}) })`
		// at sdk-session-lifecycle.ts:317 -- but the prior file only
		// verified it structurally. This block converts that
		// structural proof to an executable one.
		//
		// Production shape (per `startNewSession` at
		// sdk-session-lifecycle.ts:287-317):
		//   sdkHost.start({ ...startInput, ...(toolPolicies ? {...} : {}) })
		// where startInput has the form
		//   { config: { ..., sessionId, providerId, modelId, ... },
		//     source, interactive, ... }
		// `startInput.config.sessionId` is what the lifecycle pulls out
		// for the active session's sessionId (line 287: `requestedSessionId =
		// startInput.config?.sessionId?.trim()`). The full config object
		// is forwarded to host.start as-is.
		expect(fakeHost.start).toHaveBeenCalledTimes(2)
		const secondStartCall = fakeHost.start.mock.calls[1]?.[0] as
			| { config?: Record<string, unknown>; source?: string; interactive?: boolean }
			| undefined
		expect(secondStartCall).toBeDefined()
		// The complete B connection tuple crosses the lifecycle boundary
		// into host.start -- providerId, modelId, apiKey (the resolved
		// physical secret), baseUrl, headers. This freezes
		// COMPLETE_V1_CONNECTION_AT_HOST_START.
		expect(secondStartCall?.config).toMatchObject({
			providerId: "openai-compatible",
			modelId: "model-B",
			apiKey: "physical-key-B",
			baseUrl: "https://endpoint-B",
			headers: { "X-B": "2" },
			sessionId: "sess-B",
		})

		// Sanity: the apiKey in the startConfig carried to host.start
		// is the PHYSICAL secret value, not the reference name.
		// This is the same fail-closed invariant the R5 file
		// freezes at the builder seam, observed at the lifecycle
		// boundary.
		expect(secondStartCall?.config?.apiKey).toBe("physical-key-B")
		expect(secondStartCall?.config?.apiKey).not.toBe("instance:inst-B-key")
	})

	it("R_REPLACE_NEGATIVE_MISSING_CREDENTIAL: builder rejects; lifecycle active session is the SAME object reference as before the attempted apply", async () => {
		const fakeHost = makeFakeSdkHost(["sess-A"])
		mocks.createSessionHost.mockResolvedValue(fakeHost)

		const builder = makeBuilder(() => undefined) // every secret missing

		const lifecycle = makeLifecycle()

		// Install session A.
		const initialConfig = await builder.build({ cwd: "/workspace", mode: "act" })
		const initialStart = await lifecycle.startNewSession({
			config: { ...initialConfig, sessionId: "sess-A" },
			source: "vscode",
			interactive: true,
		} as never)
		expect(initialStart.status).toBe("started")
		lifecycle.setRunning(false)

		const referenceBeforeAttempt = lifecycle.getActiveSession()!

		// Attempt to apply B with a missing credential.
		const instanceB = makeInstance()
		await expect(
			builder.build({
				cwd: "/workspace",
				mode: "act",
				providerConfigurationInstanceTyped: instanceB,
			}),
		).rejects.toBeInstanceOf(MissingProviderInstanceCredentialError)

		// The active session at the LIFECYCLE seam is the SAME object
		// reference as before the attempt -- the failure never reached
		// replaceActiveSession, so the lifecycle layer is untouched.
		const activeSessionAfterAttempt = lifecycle.getActiveSession()!
		expect(activeSessionAfterAttempt).toBe(referenceBeforeAttempt)
		expect(activeSessionAfterAttempt.sessionId).toBe("sess-A")
		expect(activeSessionAfterAttempt.startConfig).toEqual({ providerId: "openai-compatible", modelId: "model-A" })

		// host.start was called only once (the initial install). The
		// failed build attempt never reached replaceActiveSession.
		expect(fakeHost.start).toHaveBeenCalledTimes(1)
	})

	it("R_REPLACE_RUNNING_SESSION_REFUSAL: replaceActiveSession returns undefined while active session is running; active session reference unchanged", async () => {
		const fakeHost = makeFakeSdkHost(["sess-A"])
		mocks.createSessionHost.mockResolvedValue(fakeHost)

		const builder = makeBuilder(() => "physical-key-B")

		const lifecycle = makeLifecycle()

		// Install session A and keep it running.
		const initialConfig = await builder.build({ cwd: "/workspace", mode: "act" })
		const initialStart = await lifecycle.startNewSession({
			config: { ...initialConfig, sessionId: "sess-A" },
			source: "vscode",
			interactive: true,
		} as never)
		expect(initialStart.status).toBe("started")
		// isRunning stays true (we never call setRunning(false)).

		const activeSessionA = lifecycle.getActiveSession()!
		expect(activeSessionA.isRunning).toBe(true)
		const referenceBeforeAttempt = activeSessionA

		// Attempt replaceActiveSession while the session is mid-turn.
		const instanceB = makeInstance()
		const projectedB = await builder.build({
			cwd: "/workspace",
			mode: "act",
			providerConfigurationInstanceTyped: instanceB,
		})
		const replaceResult = await lifecycle.replaceActiveSession({
			expectedSession: activeSessionA,
			startInput: {
				config: { ...projectedB, sessionId: "sess-B" },
				source: "vscode",
				interactive: true,
			} as never,
			disposeReason: "providerInstanceApply",
		})

		// replaceActiveSession REFUSED the apply (returned undefined).
		expect(replaceResult).toBeUndefined()

		// Active session reference is UNCHANGED -- same object, same id,
		// same startConfig, still running.
		const activeSessionAfter = lifecycle.getActiveSession()!
		expect(activeSessionAfter).toBe(referenceBeforeAttempt)
		expect(activeSessionAfter.sessionId).toBe("sess-A")
		expect(activeSessionAfter.startConfig).toEqual({ providerId: "openai-compatible", modelId: "model-A" })
		expect(activeSessionAfter.isRunning).toBe(true)

		// host.start was called exactly once (the initial install). No
		// replacement attempt reached host.start.
		expect(fakeHost.start).toHaveBeenCalledTimes(1)
	})

	it("R_REPLACE_CONSERVATION_MODEL_ONLY: updateActiveSessionModel swaps the model WITHOUT host.start (no replacement)", async () => {
		const fakeHost = makeFakeSdkHost(["sess-A"])
		mocks.createSessionHost.mockResolvedValue(fakeHost)

		const builder = makeBuilder(() => "physical-key-A")

		const lifecycle = makeLifecycle()

		// Install session A.
		const initialConfig = await builder.build({ cwd: "/workspace", mode: "act" })
		const initialStart = await lifecycle.startNewSession({
			config: { ...initialConfig, sessionId: "sess-A" },
			source: "vscode",
			interactive: true,
		} as never)
		expect(initialStart.status).toBe("started")
		lifecycle.setRunning(false)

		const referenceBeforeAttempt = lifecycle.getActiveSession()!

		// Same instance, model-only mutation: A.modelId A1 -> A2.
		const swapped = await lifecycle.updateActiveSessionModel("model-A2")

		expect(swapped).toBe(true)
		expect(fakeHost.updateSessionModel).toHaveBeenCalledWith("sess-A", "model-A2")

		// Active session reference is UNCHANGED (fast lane, no rebuild).
		const activeSessionAfter = lifecycle.getActiveSession()!
		expect(activeSessionAfter).toBe(referenceBeforeAttempt)
		expect(activeSessionAfter.sessionId).toBe("sess-A")

		// host.start was called exactly once (the initial install).
		expect(fakeHost.start).toHaveBeenCalledTimes(1)
	})
})
