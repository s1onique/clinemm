/**
 * ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-IMPLEMENTATION01 / Phase A
 *
 * Durable definition store for ModelProfile.
 *
 *   STORAGE_GEOMETRY  = dedicated profiles.json under
 *                       <dataDir>/profiles.json
 *                       (default ~/.cline/data/profiles.json)
 *
 *   Zero-delta invariant: a missing profiles.json is a valid empty state.
 *   No profile definitions means legacy behavior; no eager synthesis.
 *
 * The store:
 *   - reads/writes a single JSON file
 *   - validates the file against ProfilesFile at the boundary
 *   - on corruption, THROWS (fail closed)
 *   - uses atomic-rename writes (same discipline as instances.json,
 *     globalState.json, secrets.json)
 *   - is the only writer; concurrent writers are out of scope for V1
 *
 * This store owns definitions only (profileId, name, providerInstanceId,
 * modelId). It does NOT own activeProfileId or defaultProfileId.
 */

import * as fs from "node:fs"
import * as path from "node:path"
import {
	emptyProfilesFile,
	type ModelProfile,
	type ProfilesFile,
	ProfilesContractError,
	parseModelProfile,
	parseProfilesFile,
} from "./contracts"

export interface ProfilesStoreOptions {
	/** Absolute path to profiles.json. */
	filePath: string
}

/**
 * Errors thrown by the store. Fail-closed invariant means the store
 * does NOT catch parse / validation errors and silently proceed.
 */
export class ProfilesStoreError extends Error {
	override readonly name = "ProfilesStoreError"
	override readonly cause?: unknown
	constructor(message: string, cause?: unknown) {
		super(message)
		this.cause = cause
	}
}

/**
 * The ModelProfile definition store.
 *
 * Lifecycle:
 *   1. constructor reads profiles.json from disk (or seeds an empty
 *      file if missing — zero-delta invariant)
 *   2. upsert / delete / rename mutate in-memory state immediately
 *      and schedule an atomic-rename write to disk
 *   3. flush() forces any pending write to disk NOW (used by tests)
 */
export class ProfilesStore {
	private cache: ProfilesFile

	constructor(private readonly options: ProfilesStoreOptions) {
		fs.mkdirSync(path.dirname(options.filePath), { recursive: true })
		this.cache = this.readFromDisk()
	}

	private readFromDisk(): ProfilesFile {
		const raw = this.readRawFromDisk()
		if (raw === undefined) {
			// Zero-delta invariant: missing file = valid empty state
			return emptyProfilesFile()
		}
		try {
			return parseProfilesFile(raw)
		} catch (err) {
			if (err instanceof ProfilesContractError) {
				throw new ProfilesStoreError(
					`profiles.json at ${this.options.filePath} failed validation (fail closed): ${err.message}`,
					err,
				)
			}
			throw err
		}
	}

	private readRawFromDisk(): unknown {
		try {
			const buf = fs.readFileSync(this.options.filePath, "utf-8")
			return JSON.parse(buf)
		} catch (err) {
			if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
				return undefined
			}
			throw new ProfilesStoreError(
				`profiles.json at ${this.options.filePath} is unreadable / malformed (fail closed)`,
				err,
			)
		}
	}

	/** Read a single profile by id; returns undefined if absent. */
	read(profileId: string): ModelProfile | undefined {
		return this.cache.profiles[profileId]
	}

	/** List all profiles, keyed by profileId. */
	list(): Record<string, ModelProfile> {
		return { ...this.cache.profiles }
	}

	/** Insert or replace a profile by profileId. Atomic-rename write. */
	upsert(profile: ModelProfile): void {
		let parsed: ModelProfile
		try {
			parsed = parseModelProfile(profile)
		} catch (err) {
			throw new ProfilesStoreError(
				`ModelProfile failed validation (fail closed): ${err instanceof Error ? err.message : String(err)}`,
				err,
			)
		}
		const next: ProfilesFile = {
			version: 1,
			profiles: {
				...this.cache.profiles,
				[parsed.profileId]: parsed,
			},
		}
		this.cache = next
		this.persist(next)
	}

	/**
	 * Rename a profile. ONLY the user-facing `name` field changes;
	 * profileId, providerInstanceId, modelId, and the underlying
	 * credential remain untouched.
	 */
	rename(profileId: string, newName: string): void {
		const existing = this.cache.profiles[profileId]
		if (!existing) {
			throw new ProfilesStoreError(
				`Cannot rename: profile '${profileId}' does not exist`,
			)
		}
		if (typeof newName !== "string" || newName.length === 0) {
			throw new ProfilesStoreError(`Cannot rename: newName must be a non-empty string`)
		}
		const renamed: ModelProfile = { ...existing, name: newName }
		this.upsert(renamed)
	}

	/** Remove a profile by id. No-op if absent. */
	delete(profileId: string): void {
		if (!(profileId in this.cache.profiles)) {
			return
		}
		const next: ProfilesFile = {
			version: 1,
			profiles: { ...this.cache.profiles },
		}
		delete next.profiles[profileId]
		this.cache = next
		this.persist(next)
	}

	snapshot(): ProfilesFile {
		return JSON.parse(JSON.stringify(this.cache)) as ProfilesFile
	}

	flush(): void {
		this.persist(this.cache)
	}

	private persist(next: ProfilesFile): void {
		const serialized = JSON.stringify(next, null, 2)
		const dir = path.dirname(this.options.filePath)
		fs.mkdirSync(dir, { recursive: true })
		const tmpPath = `${this.options.filePath}.tmp.${Date.now()}.${Math.random().toString(36).substring(7)}.json`
		try {
			fs.writeFileSync(tmpPath, serialized, { flag: "wx", encoding: "utf-8" })
			fs.renameSync(tmpPath, this.options.filePath)
		} catch (err) {
			try {
				fs.unlinkSync(tmpPath)
			} catch {
				// ignore: best-effort cleanup
			}
			throw err
		}
	}
}
