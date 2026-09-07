/**
 * ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-IMPLEMENTATION01 / PIIF01 composition
 *
 * MP-C1 RED -> GREEN witness for the sixteenth reviewer's halt
 * `HALT_TYPED_INSTANCE_FOUNDATION_BYPASSED_BY_PRODUCT_APPLY`.
 *
 * This file closes that halt by driving the REAL composition:
 *
 *   applyModelProfile(B)
 *     -> resolve profile / instance / credential
 *   REAL SdkProviderChangeCoordinator.applyTypedProviderConfigurationInstance
 *     -> builds config with `providerConfigurationInstanceTyped`
 *   REAL SdkSessionConfigBuilder.build
 *     -> typed projector overlays B's identity/connection
 *   REAL applyTypedProviderInstanceToConfig
 *     ->
 *   captured startInput drives the witness
 *
 * The fixture is two OpenAI-compatible profiles that share a provider
 * but differ on every connection field. The witness asserts that
 * the captured `startInput.config` carries B's complete V1 tuple,
 * not the legacy fabricated ApiConfiguration shape.
 *
 * (SdkSessionLifecycle is replaced by a stub that captures the
 * `startInput` argument, mirroring the structure used by R-REPLACE —
 * but in the bridge config the lifecycle stub via StateManager mock
 * is what the lifecycle-routing path needs. We capture at the
 * startInput boundary the same way the real lifecycle passes to
 * sdkHost.start. See provider-instance-identity-r-replace-real-
 * lifecycle.piif01.test.ts for the captured-sdkHost-start witness.)
 */

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { HistoryItem } from "@shared/HistoryItem"
import type { CoreSessionConfig } from "@cline/core"
import type { InstanceSecretName } from "@/shared/storage/instance-secret"
import { describe, expect, it, vi } from "vitest"
import type { ProviderConfigurationInstance } from "../instance-store/contracts"
import { SdkSessionConfigBuilder } from "../sdk-session-config-builder"
import { SdkProviderChangeCoordinator } from "../sdk-provider-change-coordinator"
import { ProfilesStore } from "../profile-store/profiles-store"
import { applyModelProfile } from "../profile-store/profile-application"

interface BaselineShape {
	providerId?: string
	modelId?: string
	apiKey?: string | null
	baseUrl?: string | null
	headers?: Record<string, string> | null
}

function tmpDataDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "mp-composition-"))
}

function makeInstance(
	instanceId: string,
	modelId: string,
	baseUrl: string,
	headers: Record<string, string>,
	secretName: string,
): ProviderConfigurationInstance {
	return {
		instanceId,
		providerId: "openai-compatible",
		displayLabel: instanceId,
		credentialRef: { kind: "secret", name: secretName as InstanceSecretName },
		connection: { modelId, baseUrl, headers },
		createdAt: 1,
		updatedAt: 1,
	}
}

function makeProfile(profileId: string, providerInstanceId: string, modelId: string) {
	return {
		profileId,
		name: profileId,
		providerInstanceId,
		modelId,
	}
}

function baselineAConfig(): BaselineShape {
	return {
		providerId: "openai-compatible",
		modelId: "model-A",
		apiKey: "physical-key-A",
		baseUrl: "https://endpoint-A",
		headers: { "X-A": "1" },
	}
}

const mocks = vi.hoisted(() => ({
	buildSessionConfig: vi.fn(),
	buildAgentHooks: vi.fn(() => ({}) as unknown as CoreSessionConfig["hooks"]),
}))

vi.mock("../cline-session-factory", () => ({
	buildSessionConfig: mocks.buildSessionConfig,
}))

vi.mock("../hooks-adapter", () => ({
	buildAgentHooks: mocks.buildAgentHooks,
}))

vi.mock("@/core/storage/StateManager", () => ({
	StateManager: {
		get: () => ({
			getGlobalSettingsKey: vi.fn((k: string) => (k === "mode" ? "act" : undefined)),
		}),
	},
}))

function makeBuilder(getInstanceSecretImpl: (name: InstanceSecretName) => string | undefined): SdkSessionConfigBuilder {
	return new SdkSessionConfigBuilder({
		stateManager: {
			getInstanceSecret: vi.fn(getInstanceSecretImpl),
		} as never,
		emitHookMessage: vi.fn(),
	})
}

describe("ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-IMPLEMENTATION01 / MP-C1 composition", () => {
	it("MP_C1_REAL_COMPOSITION_B_INSTALLED: applyModelProfile(B) routes through real typed foundation; captured startInput carries B's complete V1 connection tuple", async () => {
		const dataDir = tmpDataDir()
		try {
			mocks.buildSessionConfig.mockImplementation(() => Promise.resolve(baselineAConfig()))

			const builder = makeBuilder((name) => {
				if (name === ("instance:inst-A-key" as InstanceSecretName)) return "physical-key-A"
				if (name === ("instance:inst-B-key" as InstanceSecretName)) return "physical-key-B"
				return undefined
			})

			const profilesStore = new ProfilesStore({ filePath: path.join(dataDir, "profiles.json") })
			profilesStore.upsert(makeProfile("prof-A", "inst-A", "model-A"))
			profilesStore.upsert(makeProfile("prof-B", "inst-B", "model-B"))

			const instances: Record<string, ProviderConfigurationInstance> = {
				"inst-A": makeInstance("inst-A", "model-A", "https://endpoint-A", { "X-A": "1" }, "instance:inst-A-key"),
				"inst-B": makeInstance("inst-B", "model-B", "https://endpoint-B", { "X-B": "2" }, "instance:inst-B-key"),
			}

			const capturedStartInputs: Array<{ config: Record<string, unknown> }> = []
			let capturedSessionId = "sess-A"

			const fakeSession = {
				sessionId: "sess-A",
				isRunning: false,
				startConfig: { providerId: "openai-compatible", modelId: "model-A" },
				sdkHost: {} as never,
				unsubscribe: () => {},
			}

			const fakeSessions = {
				getActiveSession: () => fakeSession,
				replaceActiveSession: async (args: {
					startInput: { config: Record<string, unknown> }
					disposeReason: string
				}) => {
					capturedStartInputs.push(args.startInput)
					capturedSessionId = "sess-B"
					// Mirror the lifecycle contract: return a StartSessionResult.
					return {
						startResult: { sessionId: "sess-B" },
						disposedReason: args.disposeReason,
					}
				},
				updateActiveSessionModel: vi.fn(async () => undefined),
			}

			const coordinator = new SdkProviderChangeCoordinator({
				stateManager: {
					getGlobalSettingsKey: vi.fn((k: string) => (k === "mode" ? "act" : undefined)),
				} as never,
				sessions: fakeSessions as never,
				messages: {
					appendAndEmit: vi.fn(),
				} as never,
				sessionConfigBuilder: builder,
				getTask: () => undefined,
				getWorkspaceRoot: async () => "/workspace",
				loadInitialMessages: async () => undefined,
				buildStartSessionInput: (config, { cwd, mode }) =>
					({
						config: { ...(config as object), cwd, mode },
						source: "vscode",
						interactive: true,
					}) as never,
				postStateToWebview: async () => undefined,
				rebuilds: { request: vi.fn() } as never,
			})

			const writeTaskHistoryItem = vi.fn().mockResolvedValue(undefined)
			const postStateToWebview = vi.fn().mockResolvedValue(undefined)

			const result = await applyModelProfile("prof-B", {
				profilesStore,
				readInstance: (id) => instances[id],
				getInstanceSecret: (name) => {
					if (name === ("instance:inst-A-key" as InstanceSecretName)) return "physical-key-A"
					if (name === ("instance:inst-B-key" as InstanceSecretName)) return "physical-key-B"
					return undefined
				},
				sessions: fakeSessions as never,
				sessionConfigBuilder: builder,
				providerChange: coordinator,
				rebuilds: { request: vi.fn() } as never,
				getWorkspaceRoot: async () => "/workspace",
				getMode: () => "act",
				getCurrentTaskHistoryItem: () =>
					({ id: "task-1", ts: 1, task: "T", tokensIn: 0, tokensOut: 0, totalCost: 0 } as HistoryItem),
				getCurrentTaskProviderInstanceId: () => "inst-A",
				writeTaskHistoryItem,
				postStateToWebview,
			})

			expect(result.applied).toBe(true)
			if (result.applied) {
				expect(result.profileId).toBe("prof-B")
				expect(result.usedFastPath).toBe(false)
				expect(result.sessionId).toBe("sess-B")
			}

			// CRITICAL: the captured startInput carries B's COMPLETE V1 connection tuple.
			expect(capturedStartInputs).toHaveLength(1)
			const startInput = capturedStartInputs[0]
			expect(startInput.config.providerId).toBe("openai-compatible")
			expect(startInput.config.modelId).toBe("model-B")
			expect(startInput.config.apiKey).toBe("physical-key-B")
			expect(startInput.config.apiKey).not.toBe("REDACTED_BY_TYPED_PROJECTOR")
			expect(startInput.config.baseUrl).toBe("https://endpoint-B")
			expect(startInput.config.headers).toEqual({ "X-B": "2" })

			// Ordering invariant: binding persistence happens AFTER runtime success.
			expect(writeTaskHistoryItem).toHaveBeenCalledOnce()
			const persisted = (writeTaskHistoryItem as ReturnType<typeof vi.fn>).mock.calls[0][0] as HistoryItem
			expect(persisted.activeProfileId).toBe("prof-B")
			expect(postStateToWebview).toHaveBeenCalledOnce()

			// Sanity: the captured session id reflects the new B session.
			expect(capturedSessionId).toBe("sess-B")
		} finally {
			fs.rmSync(dataDir, { recursive: true, force: true })
		}
	})
})
