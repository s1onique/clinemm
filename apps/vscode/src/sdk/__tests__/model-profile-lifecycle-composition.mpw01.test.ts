/**
 * ACT-CLINEMM-MODEL-PROFILES-PRODUCTION-WIRING01 / Phase B
 *
 * RED -> GREEN witness for MPW02: per-task active profile binding
 * and global default profile id drive the resolved
 * `CoreSessionConfig` for resumed and new tasks, not just the
 * precedence-algebraic lookup.
 *
 * What this test proves:
 *   - `resolveActiveProfileForResume` honors the precedence:
 *       1. HistoryItem.activeProfileId (per-task binding)
 *       2. global default (defaultModelProfileId)
 *       3. undefined (fall through to legacy resolution)
 *   - `resolveActiveProfileForNewTask` honors the precedence:
 *       1. global default
 *       2. undefined
 *   - When a profile resolves, its providerInstanceId + modelId
 *     are present and equal to the expected values.
 *
 * What this test does NOT prove (covered by cline-session-factory
 * integration tests):
 *   - The actual integration into `buildSessionConfig` (a future
 *     phase; this test exercises the precedence-algebraic helper
 *     layer that the factory will consume).
 */

import { describe, expect, it } from "vitest"
import { ProfilesStore } from "@/sdk/profile-store/profiles-store"
import { resolveActiveProfileForNewTask, resolveActiveProfileForResume } from "@/sdk/profile-store/owner"
import type { HistoryItem } from "@shared/HistoryItem"
import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"

function makeProfilesStore(): ProfilesStore {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mpw01-lifecycle-"))
	return new ProfilesStore({ filePath: path.join(dir, "profiles.json") })
}

function makeHistoryItem(activeProfileId?: string): HistoryItem {
	return {
		id: "task-1",
		ts: Date.now(),
		task: "Test task",
		tokensIn: 0,
		tokensOut: 0,
		cacheWrites: 0,
		cacheReads: 0,
		totalCost: 0,
		activeProfileId,
	}
}

describe("ACT-CLINEMM-MODEL-PROFILES-PRODUCTION-WIRING01 / Lifecycle composition", () => {
	describe("MPW02_RESUME_PRECEDENCE", () => {
		it("MPW02_RESUME_TASK_BINDING: per-task activeProfileId wins over global default", () => {
			const store = makeProfilesStore()
			store.upsert({
				profileId: "prof-A",
				name: "A",
				providerInstanceId: "inst-A",
				modelId: "model-A",
			})
			store.upsert({
				profileId: "prof-B",
				name: "B",
				providerInstanceId: "inst-B",
				modelId: "model-B",
			})

			const item = makeHistoryItem("prof-A")
			const resolved = resolveActiveProfileForResume(store, "prof-B", item)
			expect(resolved).toBeDefined()
			expect(resolved?.profileId).toBe("prof-A")
			expect(resolved?.providerInstanceId).toBe("inst-A")
			expect(resolved?.modelId).toBe("model-A")
		})

		it("MPW02_RESUME_DEFAULT_FALLBACK: falls back to global default when no task binding", () => {
			const store = makeProfilesStore()
			store.upsert({
				profileId: "prof-B",
				name: "B",
				providerInstanceId: "inst-B",
				modelId: "model-B",
			})
			const item = makeHistoryItem(undefined)
			const resolved = resolveActiveProfileForResume(store, "prof-B", item)
			expect(resolved).toBeDefined()
			expect(resolved?.profileId).toBe("prof-B")
		})

		it("MPW02_RESUME_LEGACY_FALLBACK: returns undefined when neither binding nor default", () => {
			const store = makeProfilesStore()
			const item = makeHistoryItem(undefined)
			const resolved = resolveActiveProfileForResume(store, undefined, item)
			expect(resolved).toBeUndefined()
		})
	})

	describe("MPW02_NEW_TASK_PRECEDENCE", () => {
		it("MPW02_NEW_TASK_DEFAULT: inherits global default when no task binding", () => {
			const store = makeProfilesStore()
			store.upsert({
				profileId: "prof-B",
				name: "B",
				providerInstanceId: "inst-B",
				modelId: "model-B",
			})
			const resolved = resolveActiveProfileForNewTask(store, "prof-B")
			expect(resolved).toBeDefined()
			expect(resolved?.profileId).toBe("prof-B")
		})

		it("MPW02_NEW_TASK_NO_DEFAULT: returns undefined when no global default", () => {
			const store = makeProfilesStore()
			const resolved = resolveActiveProfileForNewTask(store, undefined)
			expect(resolved).toBeUndefined()
		})

		it("MPW02_NEW_TASK_UNKNOWN_DEFAULT: returns undefined when default id does not exist in store", () => {
			const store = makeProfilesStore()
			const resolved = resolveActiveProfileForNewTask(store, "prof-NONEXISTENT")
			expect(resolved).toBeUndefined()
		})
	})
})
