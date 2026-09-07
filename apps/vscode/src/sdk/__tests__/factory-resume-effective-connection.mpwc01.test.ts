/**
 * ACT-CLINEMM-MODEL-PROFILES-PRODUCTION-WIRING01-CORRECTION01
 *
 * C4: FACTORY_RESUME_EFFECTIVE_CONNECTION (RED witness).
 *
 * RED: the captured input does NOT have `providerConfigurationInstanceTyped`.
 * GREEN: it does.
 */

import { describe, expect, it } from "vitest"
import type { InstanceSecretName } from "@/shared/storage/instance-secret"
import type { ProviderConfigurationInstance } from "@/sdk/instance-store/contracts"
import type { StateManager } from "@/core/storage/StateManager"
import { SdkTaskStartCoordinator } from "@/sdk/sdk-task-start-coordinator"
import type { SessionConfigInput } from "@/sdk/cline-session-factory"
import { TaskOperationFence } from "@/sdk/task-operation-fence"
import type { HistoryItem } from "@shared/HistoryItem"
import { resolveActiveInstanceTyped } from "@/sdk/profile-store/owner"
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
	const dataDir = `/tmp/mpwc01-c4-p-${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2)}`
	return new ProfilesStore({ filePath: `${dataDir}/profiles.json` })
}

function makeInstancesStore(instances: ProviderConfigurationInstance[]): InstancesStore {
	const dataDir = `/tmp/mpwc01-c4-i-${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2)}`
	const store = new InstancesStore({ filePath: `${dataDir}/instances.json` })
	for (const inst of instances) store.upsert(inst)
	return store
}

function makeCoordinator(opts: {
	profilesStore: ProfilesStore
	instancesStore: InstancesStore
	defaultProfileId: string | undefined
	captured: { input?: SessionConfigInput }
}): SdkTaskStartCoordinator {
	const { profilesStore, instancesStore, defaultProfileId, captured } = opts
	const sessionConfigBuilder = {
		build: async (input: SessionConfigInput) => {
			captured.input = input
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
				throw new Error("STOP_AFTER_BUILD")
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
		emitClineAuthError: () => {},
		postStateToWebview: async () => {},
		setTurnPhase: () => {},
		resolveProviderInstanceTyped: ({ historyItem, isResume }) => {
			return resolveActiveInstanceTyped(profilesStore, instancesStore, defaultProfileId, historyItem, isResume)
		},
	})
}

describe("MPWC01_C4_FACTORY_RESUME_EFFECTIVE_CONNECTION", () => {
	it("resume: SdkTaskStartCoordinator.initTask threads typed instance into SessionConfigInput", async () => {
		const instA = makeInst("inst-A", "model-A")
		const instB = makeInst("inst-B", "model-B")
		const profilesStore = makeProfilesStore()
		profilesStore.upsert({ profileId: "prof-A", name: "A", providerInstanceId: "inst-A", modelId: "model-A" })
		profilesStore.upsert({ profileId: "prof-B", name: "B", providerInstanceId: "inst-B", modelId: "model-B" })
		const instancesStore = makeInstancesStore([instA, instB])

		const historyItem: HistoryItem = {
			id: "task-resume-1",
			ts: 1,
			task: "resume this",
			tokensIn: 0,
			tokensOut: 0,
			totalCost: 0,
			activeProfileId: "prof-B",
		} as unknown as HistoryItem

		const captured: { input?: SessionConfigInput } = {}
		const coordinator = makeCoordinator({
			profilesStore,
			instancesStore,
			defaultProfileId: "prof-A",
			captured,
		})

		try {
			await coordinator.initTask("resume prompt", undefined, undefined, historyItem)
		} catch {
			// Subsequent steps may throw (sessions/messages stubs
			// lack some methods). We only care that we reached
			// sessionConfigBuilder.build.
		}

		// Always assert: if build was reached, the typed instance
		// must have been threaded through.
		expect(captured.input).toBeDefined()
		expect(captured.input?.providerConfigurationInstanceTyped?.instanceId).toBe("inst-B")
	})

	it("new-task: default profile resolves to A's typed instance", () => {
		const instA = makeInst("inst-A", "model-A")
		const instB = makeInst("inst-B", "model-B")
		const profilesStore = makeProfilesStore()
		profilesStore.upsert({ profileId: "prof-A", name: "A", providerInstanceId: "inst-A", modelId: "model-A" })
		profilesStore.upsert({ profileId: "prof-B", name: "B", providerInstanceId: "inst-B", modelId: "model-B" })
		const instancesStore = makeInstancesStore([instA, instB])

		const resolvedTyped = resolveActiveInstanceTyped(profilesStore, instancesStore, "prof-A", undefined, false)
		expect(resolvedTyped?.instanceId).toBe("inst-A")
	})

	it("no bound profile + no default returns undefined", () => {
		const instA = makeInst("inst-A", "model-A")
		const profilesStore = makeProfilesStore()
		profilesStore.upsert({ profileId: "prof-A", name: "A", providerInstanceId: "inst-A", modelId: "model-A" })
		const instancesStore = makeInstancesStore([instA])

		const resolvedTyped = resolveActiveInstanceTyped(profilesStore, instancesStore, undefined, undefined, true)
		expect(resolvedTyped).toBeUndefined()
	})
})
