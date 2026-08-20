/**
 * ACT-CLINEMM-USER-CONTEXT-CEILING01-CORRECTION01
 *
 * CLI-side persistence tests for the user-context ceiling wire contract.
 *
 * Mirrors the backend persistence tests in `updateSettings.test.ts`, but
 * targets the CLI handler `updateSettingsCli.ts` (which serves the
 * JetBrains / CLI clients and ingests `UpdateSettingsRequestCli`). The
 * CLI handler shares the same two-field wire contract and the same
 * mutually-exclusive invariant:
 *
 *   - request.settings.userContextCeiling: positive integer → persist.
 *   - request.settings.clearUserContextCeiling: explicitly true → clear.
 *   - carrying BOTH is invalid → typed error, no partial mutation.
 *
 * The CLI handler is more complex than the vSCode handler (it has many
 * branches for unrelated settings), so the test setup is focused: only
 * the ceiling-related fields are set, and the unused controller
 * properties are stubbed enough to keep the handler from blowing up on
 * other branches. The persistence seam under test is the same real
 * `ClineFileStorage` used by the backend tests.
 */

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { UpdateSettingsRequestCli } from "@shared/proto/cline/state"
import { ClineFileStorage } from "@shared/storage/ClineFileStorage"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Controller } from ".."
import { updateSettingsCli } from "./updateSettingsCli"

function makeTempDir(): string {
	const dir = path.join(os.tmpdir(), `cline-updatesettingscli-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
	fs.mkdirSync(dir, { recursive: true })
	return dir
}

function makeControllerWithBackingStore(filePath: string): {
	controller: Controller
	storage: ClineFileStorage
} {
	const storage = new ClineFileStorage(filePath)

	// The CLI handler has many branches that read unrelated state. To
	// keep the test focused on the ceiling pathway, we route every
	// `setGlobalState` / `setGlobalStateBatch` / `getGlobalSettingsKey`
	// call through the same real backing store. The handler iterates
	// over `request.settings` after destructuring named fields, so any
	// value not explicitly destructured lands in `simpleSettings` and
	// is forwarded to `setGlobalStateBatch`. Because the test only
	// sets the ceiling-related fields, the iteration is small and the
	// backing store receives only the keys we care about.
	const setGlobalState = vi.fn(async (key: string, value: any) => {
		await storage.update(key, value)
	})
	const setGlobalStateBatch = vi.fn(async (updates: Record<string, any>) => {
		for (const [key, value] of Object.entries(updates)) {
			await storage.update(key, value)
		}
	})
	const getGlobalSettingsKey = vi.fn((key: string) => storage.get(key))
	const getApiConfiguration = vi.fn(() => ({}))

	const controller = {
		postStateToWebview: vi.fn(async () => undefined),
		task: undefined,
		stateManager: {
			setGlobalState,
			setGlobalStateBatch,
			getGlobalSettingsKey,
			setApiConfiguration: vi.fn(),
			getApiConfiguration,
		},
		terminalManager: undefined,
		handleApiConfigurationChanged: vi.fn(),
		handleTerminalExecutionModeChanged: vi.fn(),
		updateTelemetrySetting: vi.fn(),
	} as unknown as Controller

	return { controller, storage }
}

describe("updateSettingsCli — user context ceiling wire/persistence", () => {
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

	// ACT-CLINEMM-USER-CONTEXT-CEILING01-CORRECTION01 P1: a CLI request
	// that carries BOTH a positive integer AND clearUserContextCeiling=true
	// is a contradictory command, mirroring the vSCode handler's guard.
	// The on-disk value is preserved unchanged.
	it("rejects a CLI request that carries both userContextCeiling and clearUserContextCeiling=true and leaves disk untouched", async () => {
		const { controller, storage } = makeControllerWithBackingStore(filePath)

		// Pre-condition: 512_000 is already on disk.
		await storage.update("userContextCeiling", 512_000)
		expect(storage.get("userContextCeiling")).toBe(512_000)

		await expect(
			updateSettingsCli(
				controller,
				UpdateSettingsRequestCli.create({
					settings: {
						userContextCeiling: 1024,
						clearUserContextCeiling: true,
					},
				}),
			),
		).rejects.toThrow(/Cannot set and clear user context ceiling in the same request/)

		// The contradictory request must not have reached the backing
		// store. The previously-persisted 512_000 is preserved exactly
		// as it was.
		expect(storage.get("userContextCeiling")).toBe(512_000)
	})

	// ACT-CLINEMM-USER-CONTEXT-CEILING01-CORRECTION01 P1: the guard fires
	// only when both value AND clear=true are present. The Auto/reset
	// intent (clear=true alone) must still work through the CLI path.
	it("CLI: still clears when clearUserContextCeiling=true is carried alone (no value)", async () => {
		const { controller, storage } = makeControllerWithBackingStore(filePath)

		await storage.update("userContextCeiling", 512_000)
		expect(storage.get("userContextCeiling")).toBe(512_000)

		await updateSettingsCli(
			controller,
			UpdateSettingsRequestCli.create({
				settings: {
					clearUserContextCeiling: true,
				},
			}),
		)

		expect(storage.get("userContextCeiling")).toBeUndefined()
	})

	// ACT-CLINEMM-USER-CONTEXT-CEILING01-CORRECTION01 P1 (FACTORY): the
	// contradiction guard must fire BEFORE any persistence side effect,
	// not just before ceiling persistence. A request that carries a
	// contradictory ceiling AND an unrelated setting (e.g.
	// `preferredLanguage`) cannot be allowed to partially mutate the
	// unrelated setting before the throw. The guard was moved to the
	// top of the `if (request.settings)` block specifically to enforce
	// this atomicity contract. This test pins the contract: BOTH the
	// ceiling AND the unrelated setting must remain at their pre-request
	// values after a rejected request.
	it("CLI: contradictory ceiling + unrelated setting is atomic (no partial mutation)", async () => {
		const { controller, storage } = makeControllerWithBackingStore(filePath)

		// Pre-conditions: the user has an explicit ceiling AND a
		// previously-persisted preferredLanguage. Both must survive
		// the rejected request unchanged.
		await storage.update("userContextCeiling", 512_000)
		await storage.update("preferredLanguage", "English")
		expect(storage.get("userContextCeiling")).toBe(512_000)
		expect(storage.get("preferredLanguage")).toBe("English")

		await expect(
			updateSettingsCli(
				controller,
				UpdateSettingsRequestCli.create({
					settings: {
						// Contradictory: explicit value AND clear=true.
						userContextCeiling: 1024,
						clearUserContextCeiling: true,
						// Unrelated setting that would otherwise flow
						// through `setGlobalStateBatch(filteredSettings)`.
						// If the guard lived further down, this would
						// partially mutate the disk before the throw.
						preferredLanguage: "Spanish",
					},
				}),
			),
		).rejects.toThrow(/Cannot set and clear user context ceiling in the same request/)

		// Both the ceiling AND the unrelated setting must be preserved
		// exactly as they were before the rejected request arrived.
		// The atomicity contract is enforced at the persistence seam:
		// no partial mutation under any condition.
		expect(storage.get("userContextCeiling")).toBe(512_000)
		expect(storage.get("preferredLanguage")).toBe("English")
	})
})
