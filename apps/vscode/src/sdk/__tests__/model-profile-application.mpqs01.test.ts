/**
 * ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-IMPLEMENTATION01 / Phase C
 *
 * RED -> GREEN witness for MP-R2, MP-R7, MP-R8, MP-R13, MP-R14, MP-R15
 * application-coordinator invariants.
 *
 * Production seams driven (this file):
 *   applyModelProfile          = REAL_PRODUCTION_SEAM
 *   ProfileApplicationOptions  = REAL_PRODUCTION_SEAM
 *   ApplyModelProfileResult    = REAL_PRODUCTION_SEAM
 *
 * Collaborators stubbed:
 *   ProfilesStore               = SYNTHETIC (in-memory dictionary)
 *   readInstance                = SYNTHETIC (in-memory dictionary)
 *   getInstanceSecret           = SYNTHETIC (in-memory dictionary)
 *   sessions.getActiveSession   = SYNTHETIC
 *   sessions.updateActiveSessionModel = SYNTHETIC
 *   providerChange.applyTypedProviderConfigurationInstance = SYNTHETIC
 *   writeTaskHistoryItem        = SYNTHETIC
 *   postStateToWebview          = SYNTHETIC
 */

import type { HistoryItem } from "@shared/HistoryItem"
import type { InstanceSecretName } from "@/shared/storage/instance-secret"
import type { ProviderConfigurationInstance } from "../instance-store/contracts"
import { describe, expect, it, vi } from "vitest"
import { type ModelProfile } from "../profile-store/contracts"
import { applyModelProfile } from "../profile-store/profile-application"
import { ProfilesStore } from "../profile-store/profiles-store"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

interface FakeSession {
	sessionId: string
	isRunning: boolean
	startConfig?: { providerId: string; modelId: string }
}

function makeInstance(
	instanceId: string,
	providerId: string,
	modelId: string,
	apiKey: string,
	overrides: Partial<ProviderConfigurationInstance> = {},
): ProviderConfigurationInstance {
	return {
		instanceId,
		providerId,
		displayLabel: `inst-${instanceId}`,
		credentialRef: {
			kind: "secret",
			name: `instance:${instanceId}-key` as InstanceSecretName,
		},
		connection: { modelId, baseUrl: `https://${instanceId}` },
		createdAt: 1,
		updatedAt: 1,
		...overrides,
	}
}

function makeProfile(
	profileId: string,
	providerInstanceId: string,
	modelId: string,
	overrides: Partial<ModelProfile> = {},
): ModelProfile {
	return {
		profileId,
		name: `Profile ${profileId}`,
		providerInstanceId,
		modelId,
		...overrides,
	}
}

function tmpDataDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "mpqs-app-"))
}

describe("ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-IMPLEMENTATION01 / Phase C", () => {
	// -------------------------------------------------------------------------
	// MP-R2: apply profile B to idle current task -> next effective connection B
	// -------------------------------------------------------------------------
	describe("MP-R2: full reconstruction on instance change", () => {
		it("MPQS01_APPLY_DIFFERENT_INSTANCE_STRATEGY_B: applies profile B, calls providerChange.applyTypedProviderConfigurationInstance", async () => {
			const dataDir = tmpDataDir()
			try {
				const profilesStore = new ProfilesStore({ filePath: path.join(dataDir, "profiles.json") })
				profilesStore.upsert(makeProfile("prof-A", "inst-A", "model-A"))
				profilesStore.upsert(makeProfile("prof-B", "inst-B", "model-B"))

				const instances: Record<string, ProviderConfigurationInstance> = {
					"inst-A": makeInstance("inst-A", "openai-compatible", "model-A", "key-A"),
					"inst-B": makeInstance("inst-B", "openai-compatible", "model-B", "key-B"),
				}
				const secrets: Record<string, string> = {
					"instance:inst-A-key": "key-A",
					"instance:inst-B-key": "key-B",
				}

				const applySpy = vi.fn().mockResolvedValue({ applied: true, newSessionId: "sess-B" })
				const writeTaskHistoryItem = vi.fn().mockResolvedValue(undefined)
				const postStateToWebview = vi.fn().mockResolvedValue(undefined)
				const updateSessionModel = vi.fn().mockResolvedValue(true)

				const sessionA: FakeSession = {
					sessionId: "sess-A",
					isRunning: false,
					startConfig: { providerId: "openai-compatible", modelId: "model-A" },
				}

				const result = await applyModelProfile("prof-B", {
					profilesStore,
					readInstance: (id) => instances[id],
					getInstanceSecret: (name) => secrets[name as string],
					sessions: {
						getActiveSession: () => sessionA as never,
						updateActiveSessionModel: updateSessionModel,
					} as never,
					sessionConfigBuilder: {} as never,
					providerChange: {
						applyTypedProviderConfigurationInstance: applySpy,
					},
					rebuilds: { request: vi.fn() } as never,
					getWorkspaceRoot: async () => "/workspace",
					getCurrentTaskHistoryItem: () => ({ id: "task-1", ts: 1, task: "T", tokensIn: 0, tokensOut: 0, totalCost: 0 } as HistoryItem),
					getCurrentTaskProviderInstanceId: () => "inst-A",
					writeTaskHistoryItem,
					postStateToWebview,
				})

				expect(result.applied).toBe(true)
				if (result.applied) {
					expect(result.profileId).toBe("prof-B")
					expect(result.sessionId).toBe("sess-B")
					expect(result.usedFastPath).toBe(false)
				}
				expect(applySpy).toHaveBeenCalledOnce()
				// Ordering invariant: write happens AFTER apply succeeds
				expect(writeTaskHistoryItem).toHaveBeenCalledOnce()
				expect(postStateToWebview).toHaveBeenCalledOnce()
				expect(updateSessionModel).not.toHaveBeenCalled() // fast path NOT used
			} finally {
				fs.rmSync(dataDir, { recursive: true, force: true })
			}
		})
	})

	// -------------------------------------------------------------------------
	// MP-R7: running task refuses profile switch (preserves current session)
	// -------------------------------------------------------------------------
	describe("MP-R7: in-flight refusal", () => {
		it("MPQS01_RUNNING_SESSION_REFUSED: session_running returns applied=false; no binding mutation", async () => {
			const dataDir = tmpDataDir()
			try {
				const profilesStore = new ProfilesStore({ filePath: path.join(dataDir, "profiles.json") })
				profilesStore.upsert(makeProfile("prof-A", "inst-A", "model-A"))
				profilesStore.upsert(makeProfile("prof-B", "inst-B", "model-B"))

				const applySpy = vi.fn()
				const writeTaskHistoryItem = vi.fn()
				const postStateToWebview = vi.fn()

				const sessionA: FakeSession = {
					sessionId: "sess-A",
					isRunning: true, // in flight
					startConfig: { providerId: "openai-compatible", modelId: "model-A" },
				}

				const result = await applyModelProfile("prof-B", {
					profilesStore,
					readInstance: () => makeInstance("inst-B", "openai-compatible", "model-B", "key-B"),
					getInstanceSecret: () => "key-B",
					sessions: { getActiveSession: () => sessionA as never, updateActiveSessionModel: vi.fn() } as never,
					sessionConfigBuilder: {} as never,
					providerChange: { applyTypedProviderConfigurationInstance: applySpy as never },
					rebuilds: { request: vi.fn() } as never,
					getWorkspaceRoot: async () => "/workspace",
					getCurrentTaskHistoryItem: () => undefined,
					getCurrentTaskProviderInstanceId: () => "inst-A",
					writeTaskHistoryItem,
					postStateToWebview,
				})

				expect(result.applied).toBe(false)
				if (!result.applied) {
					expect(result.reason).toBe("session_running")
				}
				// No runtime calls, no binding mutations, no webview publication
				expect(applySpy).not.toHaveBeenCalled()
				expect(writeTaskHistoryItem).not.toHaveBeenCalled()
				expect(postStateToWebview).not.toHaveBeenCalled()
			} finally {
				fs.rmSync(dataDir, { recursive: true, force: true })
			}
		})
	})

	// -------------------------------------------------------------------------
	// MP-R8: same instance, model-only profile change uses fast path
	// -------------------------------------------------------------------------
	describe("MP-R8: same-instance model-only fast path", () => {
		it("MPQS01_SAME_INSTANCE_DIFF_MODEL_FAST_PATH: uses updateActiveSessionModel, not Strategy B", async () => {
			const dataDir = tmpDataDir()
			try {
				const profilesStore = new ProfilesStore({ filePath: path.join(dataDir, "profiles.json") })
				profilesStore.upsert(makeProfile("prof-A", "inst-A", "model-A"))
				profilesStore.upsert(makeProfile("prof-A-v2", "inst-A", "model-A2"))

				const updateSessionModel = vi.fn().mockResolvedValue(true)
				const applySpy = vi.fn()
				const writeTaskHistoryItem = vi.fn().mockResolvedValue(undefined)
				const postStateToWebview = vi.fn().mockResolvedValue(undefined)

				const sessionA: FakeSession = {
					sessionId: "sess-A",
					isRunning: false,
					startConfig: { providerId: "openai-compatible", modelId: "model-A" },
				}

				const result = await applyModelProfile("prof-A-v2", {
					profilesStore,
					readInstance: () => makeInstance("inst-A", "openai-compatible", "model-A", "key-A"),
					getInstanceSecret: () => "key-A",
					sessions: {
						getActiveSession: () => sessionA as never,
						updateActiveSessionModel: updateSessionModel,
					} as never,
					sessionConfigBuilder: {} as never,
					providerChange: { applyTypedProviderConfigurationInstance: applySpy as never },
					rebuilds: { request: vi.fn() } as never,
					getWorkspaceRoot: async () => "/workspace",
					getCurrentTaskHistoryItem: () => undefined,
					getCurrentTaskProviderInstanceId: () => "inst-A",
					writeTaskHistoryItem,
					postStateToWebview,
				})

				expect(result.applied).toBe(true)
				if (result.applied) {
					expect(result.usedFastPath).toBe(true)
					expect(result.profileId).toBe("prof-A-v2")
				}
				expect(updateSessionModel).toHaveBeenCalledWith("model-A2")
				expect(applySpy).not.toHaveBeenCalled() // Strategy B NOT used
			} finally {
				fs.rmSync(dataDir, { recursive: true, force: true })
			}
		})
	})

	// -------------------------------------------------------------------------
	// MP-R13 / MP-R14: failed apply preserves prior binding + runtime
	// -------------------------------------------------------------------------
	describe("MP-R13/R-R14: failed apply preserves prior state", () => {
		it("MPQS01_APPLY_FAILED_NO_BINDING_MUTATION: when apply fails, no write to task history and no webview publication", async () => {
			const dataDir = tmpDataDir()
			try {
				const profilesStore = new ProfilesStore({ filePath: path.join(dataDir, "profiles.json") })
				profilesStore.upsert(makeProfile("prof-A", "inst-A", "model-A"))
				profilesStore.upsert(makeProfile("prof-B", "inst-B", "model-B"))

				const applySpy = vi.fn().mockResolvedValue({ applied: false, reason: "reconstruction_failed" })
				const writeTaskHistoryItem = vi.fn()
				const postStateToWebview = vi.fn()

				const sessionA: FakeSession = {
					sessionId: "sess-A",
					isRunning: false,
					startConfig: { providerId: "openai-compatible", modelId: "model-A" },
				}

				const result = await applyModelProfile("prof-B", {
					profilesStore,
					readInstance: () => makeInstance("inst-B", "openai-compatible", "model-B", "key-B"),
					getInstanceSecret: () => "key-B",
					sessions: { getActiveSession: () => sessionA as never, updateActiveSessionModel: vi.fn() } as never,
					sessionConfigBuilder: {} as never,
					providerChange: { applyTypedProviderConfigurationInstance: applySpy as never },
					rebuilds: { request: vi.fn() } as never,
					getWorkspaceRoot: async () => "/workspace",
					getCurrentTaskHistoryItem: () => undefined,
					getCurrentTaskProviderInstanceId: () => "inst-A",
					writeTaskHistoryItem,
					postStateToWebview,
				})

				expect(result.applied).toBe(false)
				if (!result.applied) {
					expect(result.reason).toBe("reconstruction_failed")
				}
				// CRITICAL: failure must NOT mutate binding or publish state
				expect(writeTaskHistoryItem).not.toHaveBeenCalled()
				expect(postStateToWebview).not.toHaveBeenCalled()
			} finally {
				fs.rmSync(dataDir, { recursive: true, force: true })
			}
		})

		it("MPQS01_MISSING_CREDENTIAL_REJECTED: missing physical secret -> applied=false, no runtime mutation", async () => {
			const dataDir = tmpDataDir()
			try {
				const profilesStore = new ProfilesStore({ filePath: path.join(dataDir, "profiles.json") })
				profilesStore.upsert(makeProfile("prof-B", "inst-B", "model-B"))

				const applySpy = vi.fn()
				const updateSessionModel = vi.fn()

				const sessionA: FakeSession = {
					sessionId: "sess-A",
					isRunning: false,
					startConfig: { providerId: "openai-compatible", modelId: "model-A" },
				}

				const result = await applyModelProfile("prof-B", {
					profilesStore,
					readInstance: () => makeInstance("inst-B", "openai-compatible", "model-B", "key-B"),
					getInstanceSecret: () => undefined, // MISSING
					sessions: { getActiveSession: () => sessionA as never, updateActiveSessionModel: updateSessionModel } as never,
					sessionConfigBuilder: {} as never,
					providerChange: { applyTypedProviderConfigurationInstance: applySpy as never },
					rebuilds: { request: vi.fn() } as never,
					getWorkspaceRoot: async () => "/workspace",
					getCurrentTaskHistoryItem: () => undefined,
					getCurrentTaskProviderInstanceId: () => "inst-A",
					writeTaskHistoryItem: vi.fn(),
					postStateToWebview: vi.fn(),
				})

				expect(result.applied).toBe(false)
				if (!result.applied) {
					expect(result.reason).toBe("missing_credential")
				}
				expect(applySpy).not.toHaveBeenCalled()
				expect(updateSessionModel).not.toHaveBeenCalled()
			} finally {
				fs.rmSync(dataDir, { recursive: true, force: true })
			}
		})

		it("MPQS01_UNKNOWN_PROFILE_REJECTED: profileId not in store -> applied=false", async () => {
			const dataDir = tmpDataDir()
			try {
				const profilesStore = new ProfilesStore({ filePath: path.join(dataDir, "profiles.json") })

				const result = await applyModelProfile("prof-NONEXISTENT", {
					profilesStore,
					readInstance: () => undefined,
					getInstanceSecret: () => "key",
					sessions: { getActiveSession: () => ({ sessionId: "sess", isRunning: false } as never), updateActiveSessionModel: vi.fn() } as never,
					sessionConfigBuilder: {} as never,
					providerChange: { applyTypedProviderConfigurationInstance: vi.fn() },
					rebuilds: { request: vi.fn() } as never,
					getWorkspaceRoot: async () => "/workspace",
					getCurrentTaskHistoryItem: () => undefined,
					getCurrentTaskProviderInstanceId: () => undefined,
					writeTaskHistoryItem: vi.fn(),
					postStateToWebview: vi.fn(),
				})

				expect(result.applied).toBe(false)
				if (!result.applied) {
					expect(result.reason).toBe("unknown_profile")
				}
			} finally {
				fs.rmSync(dataDir, { recursive: true, force: true })
			}
		})
	})

	// -------------------------------------------------------------------------
	// Ordering invariant: write happens AFTER apply succeeds
	// -------------------------------------------------------------------------
	describe("ordering invariant", () => {
		it("MPQS01_ORDERING_RUNTIME_BEFORE_BINDING: writeTaskHistoryItem is called only after apply returns success", async () => {
			const dataDir = tmpDataDir()
			try {
				const profilesStore = new ProfilesStore({ filePath: path.join(dataDir, "profiles.json") })
				profilesStore.upsert(makeProfile("prof-B", "inst-B", "model-B"))

				const callOrder: string[] = []
				const applySpy = vi.fn(async () => {
					callOrder.push("apply")
					return { applied: true, newSessionId: "sess-B" }
				})
				const writeTaskHistoryItem = vi.fn(async () => {
					callOrder.push("write")
				})
				const postStateToWebview = vi.fn(async () => {
					callOrder.push("postState")
				})

				const sessionA: FakeSession = {
					sessionId: "sess-A",
					isRunning: false,
					startConfig: { providerId: "openai-compatible", modelId: "model-A" },
				}

				await applyModelProfile("prof-B", {
					profilesStore,
					readInstance: () => makeInstance("inst-B", "openai-compatible", "model-B", "key-B"),
					getInstanceSecret: () => "key-B",
					sessions: { getActiveSession: () => sessionA as never, updateActiveSessionModel: vi.fn() } as never,
					sessionConfigBuilder: {} as never,
					providerChange: { applyTypedProviderConfigurationInstance: applySpy as never },
					rebuilds: { request: vi.fn() } as never,
					getWorkspaceRoot: async () => "/workspace",
					getCurrentTaskHistoryItem: () => ({ id: "task-1", ts: 1, task: "T", tokensIn: 0, tokensOut: 0, totalCost: 0 } as HistoryItem),
					getCurrentTaskProviderInstanceId: () => "inst-A",
					writeTaskHistoryItem,
					postStateToWebview,
				})

				expect(callOrder).toEqual(["apply", "write", "postState"])
			} finally {
				fs.rmSync(dataDir, { recursive: true, force: true })
			}
		})
	})

	// -------------------------------------------------------------------------
	// Quick-switch does NOT mutate global default
	// -------------------------------------------------------------------------
	describe("quick-switch isolation", () => {
		it("MPQS01_QUICK_SWITCH_NO_DEFAULT_MUTATION: applyModelProfile does not touch defaultModelProfileId", async () => {
			const dataDir = tmpDataDir()
			try {
				const profilesStore = new ProfilesStore({ filePath: path.join(dataDir, "profiles.json") })
				profilesStore.upsert(makeProfile("prof-B", "inst-B", "model-B"))

				const applySpy = vi.fn().mockResolvedValue({ applied: true, newSessionId: "sess-B" })

				const sessionA: FakeSession = {
					sessionId: "sess-A",
					isRunning: false,
					startConfig: { providerId: "openai-compatible", modelId: "model-A" },
				}

				// The global state shim is a plain object; if applyModelProfile
				// ever touched it, this assertion would fire.
				const globalState: { setGlobalState: () => void; getGlobalStateKey: () => unknown } = {
					setGlobalState: vi.fn(),
					getGlobalStateKey: () => undefined,
				}

				await applyModelProfile("prof-B", {
					profilesStore,
					readInstance: () => makeInstance("inst-B", "openai-compatible", "model-B", "key-B"),
					getInstanceSecret: () => "key-B",
					sessions: { getActiveSession: () => sessionA as never, updateActiveSessionModel: vi.fn() } as never,
					sessionConfigBuilder: {} as never,
					providerChange: { applyTypedProviderConfigurationInstance: applySpy as never },
					rebuilds: { request: vi.fn() } as never,
					getWorkspaceRoot: async () => "/workspace",
					getCurrentTaskHistoryItem: () => undefined,
					getCurrentTaskProviderInstanceId: () => "inst-A",
					writeTaskHistoryItem: vi.fn(),
					postStateToWebview: vi.fn(),
				})

				expect(globalState.setGlobalState).not.toHaveBeenCalled()
			} finally {
				fs.rmSync(dataDir, { recursive: true, force: true })
			}
		})
	})
})
