/**
 * ACT-CLINEMM-SETTINGS-SANDBOX-CAPABILITIES-IMPLEMENTATION01
 *
 * Persistence tests for the two new sandbox-capability settings:
 *   - clinemmSafeYoloAllowNetwork   (boolean; default false)
 *   - clinemmSafeYoloAllowSshAgent  (boolean; default false)
 *
 * These tests exercise the REAL persistence seam (ClineFileStorage)
 * so they prove the field round-trips through the production handler.
 * Red-state: the new keys are not yet in USER_SETTINGS_FIELDS, so the
 * production write path does not persist them and reload returns undefined.
 *
 * The legacy test covers the §14 backward-compatibility contract: a
 * pre-ACT state file that lacks the new keys must hydrate with
 * undefined values (no exception, no spurious defaults, no
 * silent authority creep).
 */

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { UpdateSettingsRequest } from "@shared/proto/cline/state"
import { ClineFileStorage } from "@shared/storage/ClineFileStorage"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Controller } from ".."
import { updateSettings } from "./updateSettings"

function makeTempDir(): string {
	const dir = path.join(os.tmpdir(), `cline-sandboxcap-${Date.now()}-${Math.random().toString(36).slice(2)}`)
	fs.mkdirSync(dir, { recursive: true })
	return dir
}

function makeControllerWithBackingStore(filePath: string) {
	const storage = new ClineFileStorage(filePath)
	const setGlobalState = vi.fn(async (key: string, value: any) => {
		await storage.update(key, value)
	})
	const setGlobalStateBatch = vi.fn()
	const controller = {
		postStateToWebview: vi.fn(async () => undefined),
		stateManager: { setGlobalState, setGlobalStateBatch },
	}
	return { controller: controller as any, storage }
}

describe("ACT-CLINEMM-SETTINGS-SANDBOX-CAPABILITIES-IMPLEMENTATION01 — capability round-trip", () => {
	let tempDir: string
	let filePath: string

	beforeEach(() => {
		tempDir = makeTempDir()
		filePath = path.join(tempDir, "globalState.json")
	})

	afterEach(() => {
		if (tempDir && fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true, force: true })
		}
	})

	it("persists clinemmSafeYoloAllowNetwork=true on disk and reloads it", async () => {
		const { controller, storage } = makeControllerWithBackingStore(filePath)
		await updateSettings(controller, UpdateSettingsRequest.create({ clinemmSafeYoloAllowNetwork: true }))
		expect(storage.get("clinemmSafeYoloAllowNetwork")).toBe(true)
		const reloaded = new ClineFileStorage(filePath)
		expect(reloaded.get("clinemmSafeYoloAllowNetwork")).toBe(true)
	})

	it("persists clinemmSafeYoloAllowSshAgent=true on disk and reloads it", async () => {
		const { controller, storage } = makeControllerWithBackingStore(filePath)
		await updateSettings(controller, UpdateSettingsRequest.create({ clinemmSafeYoloAllowSshAgent: true }))
		expect(storage.get("clinemmSafeYoloAllowSshAgent")).toBe(true)
		const reloaded = new ClineFileStorage(filePath)
		expect(reloaded.get("clinemmSafeYoloAllowSshAgent")).toBe(true)
	})

	it("changing one capability does not mutate the other (independence)", async () => {
		const { controller, storage } = makeControllerWithBackingStore(filePath)
		await updateSettings(controller, UpdateSettingsRequest.create({ clinemmSafeYoloAllowNetwork: true }))
		expect(storage.get("clinemmSafeYoloAllowNetwork")).toBe(true)
		expect(storage.get("clinemmSafeYoloAllowSshAgent")).toBeUndefined()
		await updateSettings(controller, UpdateSettingsRequest.create({ clinemmSafeYoloAllowSshAgent: true }))
		expect(storage.get("clinemmSafeYoloAllowNetwork")).toBe(true)
		expect(storage.get("clinemmSafeYoloAllowSshAgent")).toBe(true)
		const reloaded = new ClineFileStorage(filePath)
		expect(reloaded.get("clinemmSafeYoloAllowNetwork")).toBe(true)
		expect(reloaded.get("clinemmSafeYoloAllowSshAgent")).toBe(true)
	})

	it("legacy settings object missing the new keys loads with undefined values (no exception, conservative defaults)", () => {
		const storage = new ClineFileStorage(filePath)
		storage.set("someUnrelatedKey", "preserved")
		storage.set("autoApprovalSettings", { version: 1, actions: { read_files: true } })
		const reloaded = new ClineFileStorage(filePath)
		expect(reloaded.get("clinemmSafeYoloAllowNetwork")).toBeUndefined()
		expect(reloaded.get("clinemmSafeYoloAllowSshAgent")).toBeUndefined()
		expect(reloaded.get("someUnrelatedKey")).toBe("preserved")
	})

	it("persists flipping back to false (explicit disable survives reload)", async () => {
		const { controller, storage } = makeControllerWithBackingStore(filePath)
		await updateSettings(controller, UpdateSettingsRequest.create({ clinemmSafeYoloAllowNetwork: true }))
		expect(storage.get("clinemmSafeYoloAllowNetwork")).toBe(true)
		await updateSettings(controller, UpdateSettingsRequest.create({ clinemmSafeYoloAllowNetwork: false }))
		expect(storage.get("clinemmSafeYoloAllowNetwork")).toBe(false)
		const reloaded = new ClineFileStorage(filePath)
		expect(reloaded.get("clinemmSafeYoloAllowNetwork")).toBe(false)
	})
})
