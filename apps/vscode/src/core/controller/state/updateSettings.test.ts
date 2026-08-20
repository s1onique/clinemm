/**
 * ACT-CLINEMM-USER-CONTEXT-CEILING01-CORRECTION01
 *
 * Backend persistence tests for the user-context ceiling wire contract.
 *
 * The webview blur handler emits `updateSetting("clearUserContextCeiling",
 * true)` when the user clears the input, and `updateSetting(
 * "userContextCeiling", parsed)` when the user types a positive integer.
 * Both pathways must round-trip through the real persistence seam in
 * `updateSettings.ts`. The UI-to-wire test in
 * `FeatureSettingsSection.spec.tsx` only proves the React component
 * calls `updateSetting` with the right intent; this test proves the
 * BACKEND translates that intent into a real on-disk mutation through
 * the canonical `ClineFileStorage` backing store.
 *
 * The previous design sent `userContextCeiling = undefined` through the
 * single-value field, which is indistinguishable from "field absent"
 * on the proto3 wire (because `UpdateSettingsRequest.create()`
 * initializes every field to undefined). The handler's existing
 * `request.userContextCeiling !== undefined` branch would then skip
 * persistence entirely, leaving the previously-stored value on disk.
 * The fix uses a sibling `clearUserContextCeiling` boolean so the
 * explicit Auto intent is distinguishable from "not set".
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
	const dir = path.join(os.tmpdir(), `cline-updatesettings-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
	fs.mkdirSync(dir, { recursive: true })
	return dir
}

function makeControllerWithBackingStore(filePath: string): {
	controller: Controller & {
		stateManager: {
			setGlobalState: ReturnType<typeof vi.fn>
			setGlobalStateBatch: ReturnType<typeof vi.fn>
		}
	}
	storage: ClineFileStorage
} {
	const storage = new ClineFileStorage(filePath)

	// Forward `setGlobalState(key, value)` to the real backing store. The
	// handler's branch under test is a direct call to
	// `controller.stateManager.setGlobalState(key, value)`; routing through
	// a real `ClineFileStorage` proves the wire-up reaches the file. The
	// store deletes the key when value === undefined (see `setBatch`).
	const setGlobalState = vi.fn(async (key: string, value: any) => {
		await storage.update(key, value)
	})
	const setGlobalStateBatch = vi.fn()

	const controller = {
		postStateToWebview: vi.fn(async () => undefined),
		stateManager: {
			setGlobalState,
			setGlobalStateBatch,
		},
	} as unknown as Controller & {
		stateManager: {
			setGlobalState: ReturnType<typeof vi.fn>
			setGlobalStateBatch: ReturnType<typeof vi.fn>
		}
	}

	return { controller, storage }
}

describe("updateSettings — user context ceiling wire/persistence", () => {
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

	it("persists an explicit positive integer ceiling on disk", async () => {
		const { controller, storage } = makeControllerWithBackingStore(filePath)

		await updateSettings(controller, UpdateSettingsRequest.create({ userContextCeiling: 512_000 }))

		// The handler must have invoked the StateManager with the integer
		// value, and the file-backed store must hold the value verbatim.
		expect(controller.stateManager.setGlobalState).toHaveBeenCalledWith("userContextCeiling", 512_000)
		expect(storage.get("userContextCeiling")).toBe(512_000)

		// Reload witness: a fresh ClineFileStorage pointed at the same
		// file reads the persisted value.
		const reloaded = new ClineFileStorage(filePath)
		expect(reloaded.get("userContextCeiling")).toBe(512_000)
	})

	it("clears the persisted ceiling when clearUserContextCeiling === true (Auto reset)", async () => {
		const { controller, storage } = makeControllerWithBackingStore(filePath)

		// Pre-condition: 512_000 is already on disk (simulating a
		// previous explicit-ceiling session).
		await storage.update("userContextCeiling", 512_000)
		expect(storage.get("userContextCeiling")).toBe(512_000)

		// The webview blur handler emits a sibling `clearUserContextCeiling`
		// boolean on the wire. The backend must translate that into a real
		// delete on disk so the user-context ceiling key is gone after the
		// request — the Auto reset contract.
		await updateSettings(controller, UpdateSettingsRequest.create({ clearUserContextCeiling: true }))

		expect(controller.stateManager.setGlobalState).toHaveBeenCalledWith("userContextCeiling", undefined)
		// The real backing store must reflect the cleared key, not the
		// previously-stored integer.
		expect(storage.get("userContextCeiling")).toBeUndefined()
		// Reload witness: a fresh ClineFileStorage pointed at the same
		// file confirms the deletion survived the durability boundary.
		const reloaded = new ClineFileStorage(filePath)
		expect(reloaded.get("userContextCeiling")).toBeUndefined()
	})

	it("does not touch the persisted ceiling when neither field is set", async () => {
		const { controller, storage } = makeControllerWithBackingStore(filePath)

		await storage.update("userContextCeiling", 256_000)

		// A request that carries no ceiling-related field at all must not
		// disturb the previously-persisted value. The empty
		// UpdateSettingsRequest.create() payload is the canonical "no-op"
		// shape from the webview when only an unrelated setting is being
		// changed.
		await updateSettings(controller, UpdateSettingsRequest.create({}))

		expect(storage.get("userContextCeiling")).toBe(256_000)
	})

	it("rejects a non-positive integer ceiling and leaves disk untouched", async () => {
		const { controller, storage } = makeControllerWithBackingStore(filePath)

		await expect(updateSettings(controller, UpdateSettingsRequest.create({ userContextCeiling: 0 }))).rejects.toThrow(
			/Invalid user context ceiling value/,
		)

		// The bad value must not have reached the backing store. The
		// handler is required to short-circuit before `setGlobalState` is
		// called for an invalid value.
		expect(storage.get("userContextCeiling")).toBeUndefined()
	})

	it("rejects a non-integer ceiling and leaves disk untouched", async () => {
		const { controller, storage } = makeControllerWithBackingStore(filePath)

		await expect(updateSettings(controller, UpdateSettingsRequest.create({ userContextCeiling: 512_000.5 }))).rejects.toThrow(
			/Invalid user context ceiling value/,
		)

		expect(storage.get("userContextCeiling")).toBeUndefined()
	})

	it("round-trip: explicit 512k → persisted; clear → disk cleared; reload → Auto", async () => {
		const { controller, storage } = makeControllerWithBackingStore(filePath)

		// 1. User sets a 512k ceiling. The webview blur handler emits
		// `userContextCeiling: 512000` on the wire.
		await updateSettings(controller, UpdateSettingsRequest.create({ userContextCeiling: 512_000 }))
		expect(storage.get("userContextCeiling")).toBe(512_000)

		// 2. User clears the field. The webview blur handler emits
		// `clearUserContextCeiling: true` on the wire (the explicit
		// Auto/reset signal). The backend must translate that into a real
		// delete on disk.
		await updateSettings(controller, UpdateSettingsRequest.create({ clearUserContextCeiling: true }))
		expect(storage.get("userContextCeiling")).toBeUndefined()

		// 3. Reload witness: a fresh ClineFileStorage pointed at the same
		// file confirms the cleared key has not been quietly reintroduced.
		const reloaded = new ClineFileStorage(filePath)
		expect(reloaded.get("userContextCeiling")).toBeUndefined()

		// 4. Sanity: a small follow-up write survives the round-trip.
		await updateSettings(controller, UpdateSettingsRequest.create({ userContextCeiling: 1024 }))
		expect(storage.get("userContextCeiling")).toBe(1024)
	})

	// ACT-CLINEMM-USER-CONTEXT-CEILING01-CORRECTION01 P1: a request that
	// carries BOTH a positive integer AND clearUserContextCeiling=true is
	// a contradictory command. The proto contract says "may carry one or
	// neither; carrying both is invalid", and the persistence handler
	// enforces it. Silently picking one (clear wins in the current branch
	// order) would be an avoidable ambiguity in a public wire contract.
	// The handler throws a typed error and the on-disk value is preserved
	// unchanged — no partial mutation, no silent data loss.
	it("rejects a request that carries both userContextCeiling and clearUserContextCeiling=true and leaves disk untouched", async () => {
		const { controller, storage } = makeControllerWithBackingStore(filePath)

		// Pre-condition: 512_000 is already on disk (simulating a session
		// that has an explicit ceiling in place).
		await storage.update("userContextCeiling", 512_000)
		expect(storage.get("userContextCeiling")).toBe(512_000)

		await expect(
			updateSettings(
				controller,
				UpdateSettingsRequest.create({
					userContextCeiling: 1024,
					clearUserContextCeiling: true,
				}),
			),
		).rejects.toThrow(/Cannot set and clear user context ceiling in the same request/)

		// The contradictory request must not have reached the backing
		// store. The handler is required to short-circuit BEFORE either
		// branch executes, so the previously-persisted 512_000 is
		// preserved exactly as it was.
		expect(storage.get("userContextCeiling")).toBe(512_000)
		// Reload witness: a fresh ClineFileStorage pointed at the same
		// file confirms the rejection survived the durability boundary.
		const reloaded = new ClineFileStorage(filePath)
		expect(reloaded.get("userContextCeiling")).toBe(512_000)
	})

	// ACT-CLINEMM-USER-CONTEXT-CEILING01-CORRECTION01 P1: the guard fires
	// only when both value AND clear=true are present. A request that
	// carries clear=true with NO value (i.e. `userContextCeiling` is
	// absent/undefined) is the canonical Auto/reset intent and must
	// still work. This is regression coverage for the guard so any
	// future tightening doesn't accidentally reject the Auto intent.
	it("still clears when clearUserContextCeiling=true is carried alone (no value)", async () => {
		const { controller, storage } = makeControllerWithBackingStore(filePath)

		await storage.update("userContextCeiling", 512_000)
		expect(storage.get("userContextCeiling")).toBe(512_000)

		// Clear-only: `userContextCeiling` is left undefined (the
		// normal Auto/reset webview emit).
		await updateSettings(controller, UpdateSettingsRequest.create({ clearUserContextCeiling: true }))

		expect(storage.get("userContextCeiling")).toBeUndefined()
	})
})
