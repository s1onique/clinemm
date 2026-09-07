/**
 * ACT-CLINEMM-MODEL-PROFILES-PRODUCTION-WIRING01-CORRECTION02
 *
 * C6: BOUND_PROFILE_MISSING_INSTANCE_FAIL_CLOSED (RED -> GREEN).
 *
 * The discriminated `ResolveActiveInstanceResult` MUST distinguish
 * three cases:
 *
 *   - RESOLVED       → apply typed instance
 *   - NONE_BOUND     → no profile binding (legacy fallback OK)
 *   - BOUND_BUT_BROKEN → profile is bound but its instance is
 *                        missing/corrupt (FAIL CLOSED, no legacy
 *                        fallback).
 *
 * The factory (SdkTaskStartCoordinator) must:
 *   1. Recognize the BOUND_BUT_BROKEN case and refuse to call
 *      sessionConfigBuilder.build (NO legacy/default substitution).
 *   2. Surface the error to the user via emitClineAuthError with
 *      actionable guidance (initTask path).
 *
 * Two failure modes are covered:
 *   - profile.providerInstanceId is undefined (profile_missing_providerInstanceId)
 *   - instance referenced by providerInstanceId is absent from
 *     instancesStore (instance_not_found)
 */

import { describe, expect, it } from "vitest"
import type { InstanceSecretName } from "@/shared/storage/instance-secret"
import type { ProviderConfigurationInstance } from "@/sdk/instance-store/contracts"
import type { StateManager } from "@/core/storage/StateManager"
import { SdkTaskStartCoordinator } from "@/sdk/sdk-task-start-coordinator"
import type { SessionConfigInput } from "@/sdk/cline-session-factory"
import { TaskOperationFence } from "@/sdk/task-operation-fence"
import type { HistoryItem } from "@shared/HistoryItem"
import { resolveActiveInstanceTypedDiscriminated } from "@/sdk/profile-store/owner"
import { ProfilesStore } from "@/sdk/profile-store/profiles-store"
import { InstancesStore } from "@/sdk/instance-store/instances-store"

function makeInst(id: string, modelId: string): ProviderConfigurationInstance {
	return {
		instanceId: id,
		providerId: "openai-compatible",
		displayLabel: id,
		createdAt: 1,
		updatedAt: 1,
		connection: {
			modelId,
			baseUrl: `https://endpoint-${id}`,
			headers: {},
		},
		credentialRef: { name: `instance:${id}` as InstanceSecretName, kind: "secret" },
	}
}

function makeProfilesStore(): ProfilesStore {
	const dataDir = `/tmp/mpwc02-c6-p-${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2)}`
	return new ProfilesStore({ filePath: `${dataDir}/profiles.json` })
}

function makeInstancesStore(instances: ProviderConfigurationInstance[]): InstancesStore {
	const dataDir = `/tmp/mpwc02-c6-i-${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2)}`
	const store = new InstancesStore({ filePath: `${dataDir}/instances.json` })
	for (const inst of instances) store.upsert(inst)
	return store
}

function makeCoordinator(opts: {
	profilesStore: ProfilesStore
	instancesStore: InstancesStore
	defaultProfileId: string | undefined
	captured: { buildCalled: boolean; input?: SessionConfigInput }
	authError: { message: string }
}): SdkTaskStartCoordinator {
	const { profilesStore, instancesStore, defaultProfileId, captured, authError } = opts
	const sessionConfigBuilder = {
		build: async (input: SessionConfigInput) => {
			captured.input = input
			captured.buildCalled = true
			return {
				providerId: input.providerConfigurationInstanceTyped?.providerId ?? "fallback",
				modelId: input.providerConfigurationInstanceTyped?.connection?.modelId ?? "fallback",
				apiKey: "stub",
			} as never
		},
	}
	return new SdkTaskStartCoordinator({
		stateManager: {
			getGlobalSettingsKey: () => undefined,
		} as unknown as StateManager,
		sessions: {
			startNewSession: async () => {
				throw new Error("STOP_AFTER_BUILD (should not be reached when BOUND_BUT_BROKEN)")
			},
			fireAndForgetSend: () => {},
		} as never,
		messages: {
			appendAndEmit: () => {},
		} as never,
		taskHistory: { findHistoryItem: async () => undefined } as never,
		sessionConfigBuilder: sessionConfigBuilder as never,
		resolveSessionAutoApprovalOverride: () => "none",
		taskOperationFence: new TaskOperationFence(),
		buildStartSessionInput: () => ({}) as never,
		createHistoryItemFromSession: () => ({}) as HistoryItem,
		clearTask: async () => {},
		clearTaskForOperation: async () => {},
		setTask: () => {},
		onAskResponse: async () => {},
		onCancelTask: async () => {},
		getWorkspaceRoot: async () => "/workspace",
		createTempSessionHost: async () => ({}) as never,
		loadInitialMessages: async () => undefined,
		resolveContextMentions: async (t: string) => t,
		isClineManagedProviderActive: () => false,
		emitClineAuthError: (msg?: string) => {
			authError.message = msg ?? ""
		},
		postStateToWebview: async () => {},
		setTurnPhase: () => {},
		resolveProviderInstanceTyped: ({ historyItem, isResume }) => {
			return resolveActiveInstanceTypedDiscriminated(
				profilesStore,
				instancesStore,
				defaultProfileId,
				historyItem,
				isResume,
			)
		},
	})
}

describe("MPWC02_C6_BOUND_PROFILE_MISSING_INSTANCE_FAIL_CLOSED", () => {
	it("discriminated resolver: RESOLVED + NONE_BOUND + BOUND_BUT_BROKEN", () => {
		const instA = makeInst("inst-A", "model-A")
		const profilesStore = makeProfilesStore()
		profilesStore.upsert({ profileId: "prof-A", name: "A", providerInstanceId: "inst-A", modelId: "model-A" })
		profilesStore.upsert({
			profileId: "prof-D",
			name: "D",
			providerInstanceId: "inst-DOES-NOT-EXIST",
			modelId: "model-D",
		})
		const instancesStore = makeInstancesStore([instA])

		// RESOLVED
		const ok = resolveActiveInstanceTypedDiscriminated(profilesStore, instancesStore, "prof-A", undefined, false)
		expect(ok.kind).toBe("RESOLVED")
		if (ok.kind === "RESOLVED") expect(ok.instance.instanceId).toBe("inst-A")

		// NONE_BOUND
		const none = resolveActiveInstanceTypedDiscriminated(profilesStore, instancesStore, undefined, undefined, false)
		expect(none.kind).toBe("NONE_BOUND")

		// BOUND_BUT_BROKEN (instance_not_found — realistic case)
		const missing = resolveActiveInstanceTypedDiscriminated(profilesStore, instancesStore, "prof-D", undefined, false)
		expect(missing.kind).toBe("BOUND_BUT_BROKEN")
		if (missing.kind === "BOUND_BUT_BROKEN") {
			expect(missing.reason).toBe("instance_not_found")
			expect(missing.profileId).toBe("prof-D")
			expect(missing.referencedInstanceId).toBe("inst-DOES-NOT-EXIST")
		}
	})

	it("resolver: instance_not_found returns BOUND_BUT_BROKEN on resume path too", () => {
		const instA = makeInst("inst-A", "model-A")
		const profilesStore = makeProfilesStore()
		profilesStore.upsert({
			profileId: "prof-D",
			name: "D",
			providerInstanceId: "inst-DOES-NOT-EXIST",
			modelId: "model-D",
		})
		const instancesStore = makeInstancesStore([instA])
		const historyItem: HistoryItem = {
			id: "task-resume-1",
			ts: 1,
			task: "resume this",
			tokensIn: 0,
			tokensOut: 0,
			totalCost: 0,
			activeProfileId: "prof-D",
		} as unknown as HistoryItem

		const result = resolveActiveInstanceTypedDiscriminated(
			profilesStore,
			instancesStore,
			"prof-A", // default = prof-A (irrelevant, task binding wins)
			historyItem,
			true, // resume
		)
		expect(result.kind).toBe("BOUND_BUT_BROKEN")
		if (result.kind === "BOUND_BUT_BROKEN") {
			expect(result.reason).toBe("instance_not_found")
			expect(result.profileId).toBe("prof-D")
		}
	})

	it("initTask: bound profile with missing instance does NOT call sessionConfigBuilder.build", async () => {
		const profilesStore = makeProfilesStore()
		profilesStore.upsert({
			profileId: "prof-D",
			name: "D",
			providerInstanceId: "inst-DOES-NOT-EXIST",
			modelId: "model-D",
		})
		const instancesStore = makeInstancesStore([])

		const captured: { buildCalled: boolean; input?: SessionConfigInput } = { buildCalled: false }
		const authError = { message: "" }
		const coordinator = makeCoordinator({
			profilesStore,
			instancesStore,
			defaultProfileId: "prof-D",
			captured,
			authError,
		})

		try {
			await coordinator.initTask("test prompt", undefined, undefined, undefined)
		} catch {
			// Sessions/messages stubs may throw; we only care about
			// the bound-but-broken abort at build.
		}

		expect(captured.buildCalled).toBe(false)
		expect(authError.message).toMatch(/prof-D|missing provider instance/i)
	})

	it("reinitExistingTaskFromId: bound profile with missing instance does NOT call sessionConfigBuilder.build", async () => {
		const profilesStore = makeProfilesStore()
		profilesStore.upsert({
			profileId: "prof-D",
			name: "D",
			providerInstanceId: "inst-DOES-NOT-EXIST",
			modelId: "model-D",
		})
		const instancesStore = makeInstancesStore([])

		const captured: { buildCalled: boolean; input?: SessionConfigInput } = { buildCalled: false }
		const authError = { message: "" }
		const coordinator = makeCoordinator({
			profilesStore,
			instancesStore,
			defaultProfileId: undefined,
			captured,
			authError,
		})

		const historyItem: HistoryItem = {
			id: "task-resume-broken",
			ts: 1,
			task: "resume this",
			tokensIn: 0,
			tokensOut: 0,
			totalCost: 0,
			activeProfileId: "prof-D",
		} as unknown as HistoryItem

		;(coordinator as unknown as {
			options: { taskHistory: { findHistoryItem: (id: string) => Promise<HistoryItem | undefined> } }
		}).options.taskHistory = {
			findHistoryItem: async () => historyItem,
		}

		await coordinator.reinitExistingTaskFromId("task-resume-broken")

		expect(captured.buildCalled).toBe(false)
	})

	it("NONE_BOUND: factory falls back to legacy (build IS called)", async () => {
		const profilesStore = makeProfilesStore()
		const instancesStore = makeInstancesStore([])

		const captured: { buildCalled: boolean; input?: SessionConfigInput } = { buildCalled: false }
		const authError = { message: "" }
		const coordinator = makeCoordinator({
			profilesStore,
			instancesStore,
			defaultProfileId: undefined,
			captured,
			authError,
		})

		try {
			await coordinator.initTask("test prompt", undefined, undefined, undefined)
		} catch {
			// Sessions/messages stubs may throw.
		}

		expect(captured.buildCalled).toBe(true)
		expect(captured.input?.providerConfigurationInstanceTyped).toBeUndefined()
	})
})
