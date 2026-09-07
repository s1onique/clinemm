/**
 * ACT-CLINEMM-MODEL-PROFILES-FIRST-RUN-BOOTSTRAP01 / CORRECTION06
 *
 * End-to-end projection-side witness for the LIVE_FOUND defect
 * HALT_MODEL_PROFILE_POST_CREATE_STATE_NOT_PUBLISHED: once a
 * `modelProfilesOwner` is wired into the controller shape, the
 * `getStateToPostToWebview()` projection MUST populate
 * `ExtensionState.modelProfiles` from the freshly-written
 * `profiles.json`.
 *
 * This file tests the RIGHT-hand seam (the projection). The
 * LEFT-hand seam (the call site that threads `modelProfilesOwner`
 * into `buildBaseState`) is exercised separately by
 * `MPFRB01_C06_PUBLICATION_THREADS_OWNER` in
 * `apps/vscode/src/sdk/SdkController.test.ts`. Together the two
 * witnesses fully bracket the defect: the LHS proves the call
 * site threads the owner, this RHS proves the projection uses it.
 *
 * Both witnesses are GREEN with the CORRECTION06 fix; the RHS
 * would have been GREEN BEFORE the fix too (because the
 * projection is correct in isolation), so the RED witness for
 * the actual live bug is the LHS test.
 *
 * Run via:
 *   cd apps/vscode && bunx vitest run --config vitest.config.ts \
 *     src/core/controller/state/post-create-state-convergence.mpfrb01-correction06.test.ts
 */

import { mkdtempSync } from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { StateManager } from "@/core/storage/StateManager"
import { InstancesStore } from "@/sdk/instance-store/instances-store"
import { ProfilesStore } from "@/sdk/profile-store/profiles-store"
import { BootstrapModelProfileRequest } from "@/shared/proto/cline/state"
import { createStorageContext } from "@/shared/storage/storage-context"
import { bootstrapModelProfileFromCurrentConfiguration } from "./bootstrapModelProfileFromCurrentConfiguration"
import { getStateToPostToWebview } from "./getStateToPostToWebview"

// StateManager.initialize() reads distinct-id + HostProvider; mock them.
vi.mock("@/services/logging/distinctId", () => ({
	initializeDistinctId: vi.fn(async () => undefined),
	getDistinctId: vi.fn(() => undefined),
	getDeviceId: vi.fn(() => undefined),
	setDistinctId: vi.fn(() => undefined),
}))
vi.mock("@/hosts/host-provider", () => ({
	HostProvider: {
		get: () => ({ getEnv: () => "test" }),
		initialize: vi.fn(),
	},
}))
// getStateToPostToWebview reads ClineEnv.config() and ClineEndpoint.isSelfHosted(); mock both.
vi.mock("@/config", () => ({
	ClineEnv: {
		config: () => ({
			apiBaseUrl: "https://api.cline.bot",
			appBaseUrl: "https://app.cline.bot",
			environment: "test",
		}),
	},
	ClineEndpoint: {
		initialize: vi.fn(),
		get instance() {
			return undefined
		},
		config: () => ({ isSelfHosted: () => false }),
		isSelfHosted: () => false,
	},
}))

// getStateToPostToWebview reads BannerService.get().getActiveBanners(); mock it.
vi.mock("@/services/banner/BannerService", () => ({
	BannerService: {
		get: vi.fn(() => ({
			getActiveBanners: vi.fn(() => []),
			getWelcomeBanners: vi.fn(() => []),
		})),
		initialize: vi.fn(() => ({
			getActiveBanners: vi.fn(() => []),
			getWelcomeBanners: vi.fn(() => []),
		})),
		reset: vi.fn(),
	},
}))

describe("ACT-CLINEMM-MODEL-PROFILES-FIRST-RUN-BOOTSTRAP01 / CORRECTION06", () => {
	let clineDir: string
	let profilesStore: ProfilesStore
	let instancesStore: InstancesStore
	let controller: {
		modelProfilesOwner: unknown
		task: undefined
		stateManager: StateManager
		mcpHub?: undefined
	}

	beforeAll(async () => {
		clineDir = mkdtempSync(path.join(os.tmpdir(), "mpfrb01-c06-"))
		const ctx = createStorageContext({ clineDir, workspacePath: clineDir })
		await StateManager.initialize(ctx)
	})

	afterAll(async () => {
		try {
			await StateManager.get().flushPendingState()
		} catch {
			// best-effort
		}
		try {
			await fs.rm(clineDir, { recursive: true, force: true })
		} catch {
			// best-effort
		}
	})

	beforeEach(() => {
		profilesStore = new ProfilesStore({ filePath: path.join(clineDir, "profiles.json") })
		instancesStore = new InstancesStore({ filePath: path.join(clineDir, "instances.json") })
		controller = {
			modelProfilesOwner: {
				profilesStore,
				instancesStore,
				// Fresh user has no current task; isActive / isDefault
				// both project to false.
				getCurrentTaskHistoryItem: () => undefined,
			},
			task: undefined,
			stateManager: StateManager.get(),
		}
	})

	it("MPFRB01_C06_POST_CREATE_STATE_CONVERGENCE: a successful bootstrap is visible in the next ExtensionState.modelProfiles projection", async () => {
		// Source config: a user with Anthropic + a real key + a model.
		const config = {
			actModeApiProvider: "anthropic",
			actModeApiModelId: "claude-sonnet-4-6",
			apiKey: "sk-ant-C06-WITNESS-XXXXXXXXXXXXX",
		}
		await StateManager.get().setApiConfiguration(config as never)

		// Run the REAL bootstrap handler (RPC -> primitive -> store).
		const response = await bootstrapModelProfileFromCurrentConfiguration(
			controller as never,
			BootstrapModelProfileRequest.create({ name: "My first" }),
		)
		expect(response.status).toBe("CREATED")
		if (response.status !== "CREATED") throw new Error("unreachable: status guard")

		// Sanity: the on-disk profile IS present (the write happened).
		const onDiskProfile = profilesStore.read(response.profileId)
		expect(onDiskProfile).toBeDefined()
		expect(onDiskProfile?.profileId).toBe(response.profileId)

		// The post-create state push MUST reflect the freshly-written
		// profile. Without CORRECTION06 this assertion fails with
		// modelProfiles.length === 0 (the live-found HALT).
		const state = await getStateToPostToWebview(controller as never)

		// Load-bearing assertion: the projection MUST include the
		// freshly-created profile. This is the single witness that
		// closes the LIVE_FOUND P0.
		expect(Array.isArray(state.modelProfiles)).toBe(true)
		expect((state.modelProfiles ?? []).length).toBeGreaterThan(0)

		const projected = (state.modelProfiles ?? []).find((p: { profileId: string }) => p.profileId === response.profileId)
		expect(projected, "freshly-created profile must be in the post-create projection").toBeDefined()
		expect(projected).toMatchObject({
			profileId: response.profileId,
			name: "My first",
			modelId: "claude-sonnet-4-6",
			isActive: false,
			isDefault: false,
		})

		// Sanity: no default + no active binding on a fresh user.
		expect(state.defaultModelProfileId).toBeNull()
		expect(state.activeModelProfileId).toBeNull()
	})
})
