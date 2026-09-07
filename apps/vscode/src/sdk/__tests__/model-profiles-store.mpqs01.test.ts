/**
 * ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-IMPLEMENTATION01 / Phase A
 *
 * RED -> GREEN witness for MP-R1, MP-R6, MP-R10, MP-R17 store-level
 * invariants.
 *
 * Production seams driven (this file):
 *   ProfilesStore                 = REAL_PRODUCTION_SEAM
 *   ProfilesFile / parseProfilesFile = REAL_PRODUCTION_SEAM
 *   parseModelProfile             = REAL_PRODUCTION_SEAM
 *
 * No external collaborators — these tests are pure local-fs units.
 */

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
	emptyProfilesFile,
	type ModelProfile,
	ProfilesContractError,
	parseModelProfile,
	parseProfilesFile,
} from "../profile-store/contracts"
import { ProfilesStore, ProfilesStoreError } from "../profile-store/profiles-store"

function tmpDataDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "mpqs-profiles-store-"))
}

function makeProfile(overrides: Partial<ModelProfile> = {}): ModelProfile {
	return {
		profileId: "prof-A",
		name: "Corporate MiniMax",
		providerInstanceId: "inst-A",
		modelId: "MiniMax-M3",
		...overrides,
	}
}

describe("ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-IMPLEMENTATION01 / Phase A", () => {
	let dataDir: string
	let storeFile: string

	beforeEach(() => {
		dataDir = tmpDataDir()
		storeFile = path.join(dataDir, "profiles.json")
	})

	afterEach(() => {
		try {
			fs.rmSync(dataDir, { recursive: true, force: true })
		} catch {
			// ignore
		}
	})

	// -------------------------------------------------------------------------
	// MP-R10 (secrets never enter profile storage) — characterization
	// -------------------------------------------------------------------------
	describe("MP-R10: profile serialization contains no raw secret", () => {
		it("MPQS01_PROFILES_HAVE_NO_SECRET_FIELDS_AT_CONTRACT_LEVEL: parseModelProfile rejects fields like apiKey, headers, credentialRef", () => {
			expect(() =>
				parseModelProfile({
					profileId: "prof-X",
					name: "leaky",
					providerInstanceId: "inst-X",
					modelId: "model-X",
					apiKey: "sk-leaked",
				}),
			).toThrow(ProfilesContractError)

			expect(() =>
				parseModelProfile({
					profileId: "prof-X",
					name: "leaky",
					providerInstanceId: "inst-X",
					modelId: "model-X",
					headers: { Authorization: "Bearer leaked" },
				}),
			).toThrow(ProfilesContractError)

			expect(() =>
				parseModelProfile({
					profileId: "prof-X",
					name: "leaky",
					providerInstanceId: "inst-X",
					modelId: "model-X",
					credentialRef: { kind: "secret", name: "instance:inst-X" },
				}),
			).toThrow(ProfilesContractError)
		})

		it("MPQS01_PROFILES_STORE_NEVER_WRITES_APIKEY_LITERAL: serialized profiles.json never contains the substring 'apiKey'", () => {
			const store = new ProfilesStore({ filePath: storeFile })
			store.upsert(makeProfile({ profileId: "prof-A", name: "A" }))
			store.upsert(makeProfile({ profileId: "prof-B", name: "B" }))
			store.flush()

			const onDisk = fs.readFileSync(storeFile, "utf-8")
			expect(onDisk.toLowerCase()).not.toContain('"apikey"')
			expect(onDisk.toLowerCase()).not.toContain("apikey")
		})
	})

	// -------------------------------------------------------------------------
	// MP-R6 (zero-delta: missing file = empty state)
	// -------------------------------------------------------------------------
	describe("MP-R6: zero-delta missing file = valid empty state", () => {
		it("MPQS01_ZERO_DELTA_MISSING_FILE_OK: constructing store with no file on disk yields an empty profiles map", () => {
			const store = new ProfilesStore({ filePath: storeFile })
			expect(store.list()).toEqual({})
			expect(store.read("any-id")).toBeUndefined()
			expect(store.snapshot()).toEqual(emptyProfilesFile())
		})

		it("MPQS01_ZERO_DELTA_EMPTY_MAP_KEYMATCH: an empty profiles.json is valid even though it has no map keys", () => {
			const empty = parseProfilesFile({ version: 1, profiles: {} })
			expect(empty.profiles).toEqual({})
		})
	})

	// -------------------------------------------------------------------------
	// MP-R1 (two same-provider profiles coexist durably)
	// -------------------------------------------------------------------------
	describe("MP-R1: save two same-provider profiles durably", () => {
		it("MPQS01_TWO_PROFILES_SAME_PROVIDER_COEXIST: prof-A and prof-B (different instances, same providerId) both persist", () => {
			const store = new ProfilesStore({ filePath: storeFile })
			store.upsert(
				makeProfile({ profileId: "prof-A", name: "Corporate", modelId: "model-A" }),
			)
			store.upsert(
				makeProfile({
					profileId: "prof-B",
					name: "Local Qwen",
					providerInstanceId: "inst-B",
					modelId: "qwen3-coder",
				}),
			)
			store.flush()

			const reopened = new ProfilesStore({ filePath: storeFile })
			expect(Object.keys(reopened.list()).sort()).toEqual(["prof-A", "prof-B"])
			expect(reopened.read("prof-A")?.name).toBe("Corporate")
			expect(reopened.read("prof-B")?.name).toBe("Local Qwen")
		})
	})

	// -------------------------------------------------------------------------
	// map key == body.profileId invariant
	// -------------------------------------------------------------------------
	describe("map key == body.profileId invariant", () => {
		it("MPQS01_KEYMATCH_TAMPER_FAILS_CLOSED: parseProfilesFile rejects mismatched key vs body.profileId", () => {
			expect(() =>
				parseProfilesFile({
					version: 1,
					profiles: {
						"prof-A": {
							profileId: "prof-OTHER",
							name: "tampered",
							providerInstanceId: "inst-X",
							modelId: "model-X",
						},
					},
				}),
			).toThrow(ProfilesContractError)
		})

		it("MPQS01_KEYMATCH_HAPPY_PATH: matching key and body.profileId accepted", () => {
			const parsed = parseProfilesFile({
				version: 1,
				profiles: {
					"prof-A": {
						profileId: "prof-A",
						name: "ok",
						providerInstanceId: "inst-A",
						modelId: "model-A",
					},
				},
			})
			expect(parsed.profiles["prof-A"].profileId).toBe("prof-A")
		})
	})

	// -------------------------------------------------------------------------
	// corruption fail-closed invariant
	// -------------------------------------------------------------------------
	describe("corruption fail-closed invariant", () => {
		it("MPQS01_CORRUPT_FILE_FAILS_CLOSED: a profiles.json that parses but is invalid throws ProfilesStoreError", () => {
			fs.writeFileSync(
				storeFile,
				JSON.stringify({ version: 1, profiles: { "prof-A": { profileId: "WRONG" } } }),
			)
			expect(() => new ProfilesStore({ filePath: storeFile })).toThrow(ProfilesStoreError)
		})

		it("MPQS01_MALFORMED_JSON_FAILS_CLOSED: a profiles.json that does not parse throws ProfilesStoreError", () => {
			fs.writeFileSync(storeFile, "{ not valid json")
			expect(() => new ProfilesStore({ filePath: storeFile })).toThrow(ProfilesStoreError)
		})
	})

	// -------------------------------------------------------------------------
	// rename + delete CRUD
	// -------------------------------------------------------------------------
	describe("rename / delete CRUD", () => {
		it("MPQS01_RENAME_CHANGES_NAME_NOT_ID: rename keeps profileId stable; only name changes", () => {
			const store = new ProfilesStore({ filePath: storeFile })
			store.upsert(makeProfile())
			store.rename("prof-A", "New Name")
			store.flush()

			const reopened = new ProfilesStore({ filePath: storeFile })
			const p = reopened.read("prof-A")
			expect(p).toBeDefined()
			expect(p?.name).toBe("New Name")
			expect(p?.profileId).toBe("prof-A")
			expect(p?.providerInstanceId).toBe("inst-A")
			expect(p?.modelId).toBe("MiniMax-M3")
		})

		it("MPQS01_DELETE_REMOVES_PROFILE: delete removes from in-memory + disk; reopen shows absence", () => {
			const store = new ProfilesStore({ filePath: storeFile })
			store.upsert(makeProfile())
			store.delete("prof-A")
			store.flush()

			const reopened = new ProfilesStore({ filePath: storeFile })
			expect(reopened.read("prof-A")).toBeUndefined()
			expect(Object.keys(reopened.list())).toEqual([])
		})
	})
})
