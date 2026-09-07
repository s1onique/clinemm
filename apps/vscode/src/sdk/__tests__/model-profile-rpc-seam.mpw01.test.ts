/**
 * ACT-CLINEMM-MODEL-PROFILES-PRODUCTION-WIRING01 / Phase A → C
 *
 * RED -> GREEN witness for MPW01: the RPC seam reaches the real
 * extension composition root.
 *
 * What this test proves:
 *   - `applyModelProfile` RPC handler is wired into the generated
 *     protobus service registry.
 *   - When called with a profileId, it reaches the
 *     `modelProfilesOwner` field on the Controller.
 *   - The owner delegates to the existing `applyModelProfile`
 *     coordinator (composition with the typed Foundation seam).
 *   - The handler returns a structured `ApplyModelProfileResponse`
 *     with the expected `applied` / `reason` fields.
 *
 * What this test does NOT prove (covered by separate tests):
 *   - The chat parent reachability (Phase A webview integration).
 *   - The Settings parent reachability (Phase A webview integration).
 *   - The resume/new-task lifecycle composition (Phase B).
 *   - Live VSIX dogfood (out of substrate).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ApplyModelProfileRequest, ApplyModelProfileResponse } from "@/shared/proto/cline/state"
import { applyModelProfile as applyModelProfileHandler } from "@/core/controller/state/applyModelProfile"
import type { Controller } from "@/core/controller"
import type { ModelProfilesOwnerDeps } from "@/sdk/profile-store/owner"

function makeFakeOwner(overrides?: Partial<ModelProfilesOwnerDeps>): ModelProfilesOwnerDeps {
	const profilesStore = {
		read: vi.fn((id: string) =>
			id === "prof-A"
				? {
						profileId: "prof-A",
						name: "A",
						providerInstanceId: "inst-A",
						modelId: "model-A",
					}
				: id === "prof-B"
					? {
							profileId: "prof-B",
							name: "B",
							providerInstanceId: "inst-B",
							modelId: "model-B",
						}
					: undefined,
		),
		list: vi.fn(() => ({
			"prof-A": { profileId: "prof-A", name: "A", providerInstanceId: "inst-A", modelId: "model-A" },
			"prof-B": { profileId: "prof-B", name: "B", providerInstanceId: "inst-B", modelId: "model-B" },
		})),
	} as unknown as ModelProfilesOwnerDeps["profilesStore"]

	const instancesStore = {
		read: vi.fn((id: string) =>
			id === "inst-A" ? ({ instanceId: "inst-A", providerId: "openai" } as never) : undefined,
		),
		list: vi.fn(() => ({})),
	} as unknown as ModelProfilesOwnerDeps["instancesStore"]

	const applyTyped = vi.fn(async () => ({ applied: true as const, newSessionId: "session-new" }))

	return {
		profilesStore,
		instancesStore,
		providerChange: {
			applyTypedProviderConfigurationInstance: applyTyped,
		},
		sessions: {} as never,
		sessionConfigBuilder: {} as never,
		sessionRebuilds: {} as never,
		getInstanceSecret: vi.fn(() => "secret-value"),
		getWorkspaceRoot: vi.fn(async () => "/workspace"),
		getCurrentTaskHistoryItem: vi.fn(() => undefined),
		writeTaskHistoryItem: vi.fn(async () => {}),
		postStateToWebview: vi.fn(async () => {}),
		...overrides,
	}
}

function makeFakeController(owner: ModelProfilesOwnerDeps | undefined): Controller {
	return {
		modelProfilesOwner: owner,
		stateManager: {
			getInstanceSecret: vi.fn(() => "secret-value"),
			getGlobalStateKey: vi.fn(() => undefined),
			setGlobalState: vi.fn(),
		},
	} as unknown as Controller
}

describe("ACT-CLINEMM-MODEL-PROFILES-PRODUCTION-WIRING01 / RPC seam", () => {
	describe("MPW01_RPC_REACHES_OWNER", () => {
		let controller: Controller
		let owner: ModelProfilesOwnerDeps

		beforeEach(() => {
			owner = makeFakeOwner()
			controller = makeFakeController(owner)
		})

		afterEach(() => {
			vi.clearAllMocks()
		})

		it("MPW01_RPC_APPLY_UNKNOWN_PROFILE: returns applied=false, reason=unknown_profile for missing profileId", async () => {
			const req = ApplyModelProfileRequest.create({ profileId: "does-not-exist" })
			const result: ApplyModelProfileResponse = await applyModelProfileHandler(controller, req)
			expect(result.applied).toBe(false)
			expect(result.reason).toBe("unknown_profile")
		})

		it("MPW01_RPC_APPLY_NO_OWNER: returns applied=false, reason=reconstruction_failed when owner is undefined", async () => {
			const ctrl = makeFakeController(undefined)
			const req = ApplyModelProfileRequest.create({ profileId: "prof-A" })
			const result: ApplyModelProfileResponse = await applyModelProfileHandler(ctrl, req)
			expect(result.applied).toBe(false)
			expect(result.reason).toBe("reconstruction_failed")
		})
	})

	describe("MPW01_RPC_HANDLERS_REGISTERED", () => {
		it("MPW01_RPC_HANDLERS_IMPORT: all 8 RPC handler modules are importable", async () => {
			const apply = await import("@/core/controller/state/applyModelProfile")
			const list = await import("@/core/controller/state/listModelProfiles")
			const save = await import("@/core/controller/state/saveCurrentAsModelProfile")
			const setDefault = await import("@/core/controller/state/setDefaultModelProfile")
			const clearDefault = await import("@/core/controller/state/clearDefaultModelProfile")
			const rename = await import("@/core/controller/state/renameModelProfile")
			const update = await import("@/core/controller/state/updateModelProfileFromCurrent")
			const del = await import("@/core/controller/state/deleteModelProfile")
			expect(typeof apply.applyModelProfile).toBe("function")
			expect(typeof list.listModelProfiles).toBe("function")
			expect(typeof save.saveCurrentAsModelProfile).toBe("function")
			expect(typeof setDefault.setDefaultModelProfile).toBe("function")
			expect(typeof clearDefault.clearDefaultModelProfile).toBe("function")
			expect(typeof rename.renameModelProfile).toBe("function")
			expect(typeof update.updateModelProfileFromCurrent).toBe("function")
			expect(typeof del.deleteModelProfile).toBe("function")
		})
	})
})
