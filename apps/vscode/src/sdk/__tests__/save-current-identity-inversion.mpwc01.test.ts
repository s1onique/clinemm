/**
 * ACT-CLINEMM-MODEL-PROFILES-PRODUCTION-WIRING01-CORRECTION01
 *
 * C3: SAVE_CURRENT_IDENTITY_INVERSION (RED witness)
 *
 * The previous implementation did:
 *
 *   const match = Object.values(allInstances).find(
 *     i => i.providerId === providerId,
 *   )
 *
 * for both `saveCurrentAsModelProfile` and
 * `updateModelProfileFromCurrent`. For two instances of the same
 * provider (A and B), a running session on B could be captured as A
 * — recreating the providerId-collapse bug the Foundation eliminated.
 *
 * Discriminator: with two same-provider instances (A and B), no
 * profile binding, and an active session, both handlers MUST fail
 * closed with an explicit error (NOT silently pick A).
 *
 * RED before the fix (handlers picked A by string matching).
 * GREEN after (handlers require an authoritative identity source).
 */

import { describe, expect, it } from "vitest"
import { saveCurrentAsModelProfile } from "@/core/controller/state/saveCurrentAsModelProfile"
import { updateModelProfileFromCurrent } from "@/core/controller/state/updateModelProfileFromCurrent"
import type { Controller } from "@/core/controller"
import type { InstanceSecretName } from "@/shared/storage/instance-secret"
import type { ProviderConfigurationInstance } from "@/sdk/instance-store/contracts"
import type { HistoryItem } from "@shared/HistoryItem"

function makeInstancesStoreStub(instances: ProviderConfigurationInstance[]) {
	return {
		list: () => Object.fromEntries(instances.map((i) => [i.instanceId, i])),
	}
}

function makeProfilesStoreStub() {
	const profiles = new Map<string, { profileId: string; providerInstanceId: string; modelId: string; name: string }>()
	return {
		read: (id: string) => profiles.get(id),
		upsert: (p: { profileId: string; providerInstanceId: string; modelId: string; name: string }) => {
			profiles.set(p.profileId, p)
			return p
		},
		list: () => Object.fromEntries(profiles),
	}
}

function makeControllerStub(opts: {
	instances: ProviderConfigurationInstance[]
	currentTaskHistoryItem?: HistoryItem
	activeSessionProviderId?: string
}): Controller {
	const instancesStore = makeInstancesStoreStub(opts.instances)
	const profilesStore = makeProfilesStoreStub()

	const owner = {
		instancesStore,
		profilesStore,
		sessions: {
			getActiveSession: () =>
				opts.activeSessionProviderId
					? {
							sessionId: "test-session",
							startConfig: {
								providerId: opts.activeSessionProviderId,
								modelId: "model-B",
							},
						}
					: undefined,
		},
		getCurrentTaskHistoryItem: () => opts.currentTaskHistoryItem,
		getInstanceSecret: (_name: InstanceSecretName) => "secret-value",
		getWorkspaceRoot: async () => "/workspace",
		getCurrentTaskProviderInstanceId: () => undefined,
		postStateToWebview: async () => {},
		writeTaskHistoryItem: async () => {},
	} as never

	return {
		modelProfilesOwner: owner,
	} as unknown as Controller
}

describe("MPWC01_C3_SAVE_CURRENT_IDENTITY_INVERSION", () => {
	const instA: ProviderConfigurationInstance = {
		instanceId: "inst-A",
		providerId: "openai-compatible",
		displayLabel: "inst-A",
		createdAt: 1,
		updatedAt: 1,
		connection: { modelId: "model-A", baseUrl: "https://endpoint-A", headers: {} },
		credentialRef: { name: "instance:inst-A" as InstanceSecretName, kind: "secret" },
	}
	const instB: ProviderConfigurationInstance = {
		instanceId: "inst-B",
		providerId: "openai-compatible",
		displayLabel: "inst-B",
		createdAt: 1,
		updatedAt: 1,
		connection: { modelId: "model-B", baseUrl: "https://endpoint-B", headers: {} },
		credentialRef: { name: "instance:inst-B" as InstanceSecretName, kind: "secret" },
	}

	it("saveCurrentAsModelProfile fails closed when no authoritative providerInstanceId is available", async () => {
		const controller = makeControllerStub({
			instances: [instA, instB],
			// No active task binding AND no authoritative current instance id.
			currentTaskHistoryItem: undefined,
			activeSessionProviderId: "openai-compatible",
		})

		await expect(
			saveCurrentAsModelProfile(controller, { name: "Captured" } as never),
		).rejects.toThrow(/authoritative providerInstanceId/i)
	})

	it("updateModelProfileFromCurrent fails closed when no authoritative providerInstanceId is available", async () => {
		const controller = makeControllerStub({
			instances: [instA, instB],
			currentTaskHistoryItem: undefined,
			activeSessionProviderId: "openai-compatible",
		})

		await expect(
			updateModelProfileFromCurrent(controller, { profileId: "prof-1" } as never),
		).rejects.toThrow(/authoritative providerInstanceId/i)
	})

	it("saveCurrentAsModelProfile does NOT silently pick inst-A when runtime is inst-B", async () => {
		// Even with the "wrong" order of instances in the store, the
		// previous bug would have picked the FIRST same-provider
		// instance. The handler MUST throw rather than return a
		// ModelProfile with providerInstanceId="inst-A".
		const controller = makeControllerStub({
			instances: [instA, instB], // inst-A appears first
			currentTaskHistoryItem: undefined,
			activeSessionProviderId: "openai-compatible",
		})

		await expect(
			saveCurrentAsModelProfile(controller, { name: "X" } as never),
		).rejects.toThrow()
	})
})
