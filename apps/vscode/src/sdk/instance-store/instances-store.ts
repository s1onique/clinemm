/**
 * ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-IMPLEMENTATION01 / R3
 *
 * Durable definition store for ProviderConfigurationInstance.
 *
 * Recon freeze (commit 191dd639b, evidence 06 sections 2 + 2b):
 *
 *   STORAGE_GEOMETRY  = dedicated instances.json under
 *                       <dataDir>/instances.json
 *                       (default ~/.cline/data/instances.json)
 *   NO: activeInstanceId, profile pointer, global default.
 *
 * The store:
 *
 *   - reads/writes a single JSON file
 *   - validates the file against InstancesFile at the boundary
 *   - on corruption, THROWS (fail closed) -- this is the recon 6b
 *     invariant: a corrupt instance file must never silently pick
 *     another instance
 *   - uses atomic-rename writes (same discipline as globalState.json
 *     and secrets.json)
 *   - is the only writer; concurrent writers are out of scope for
 *     this phase (no multi-tab / multi-process race conditions
 *     were claimed in recon)
 */

import * as fs from "node:fs"
import * as path from "node:path"
import {
	emptyInstancesFile,
	type InstancesFile,
	InstancesContractError,
	type ProviderConfigurationInstance,
	parseInstancesFile,
	parseProviderConfigurationInstance,
} from "./contracts"

export interface InstancesStoreOptions {
	/** Absolute path to instances.json. */
	filePath: string
}

/**
 * Errors thrown by the store. The fail-closed invariant means the
 * store does NOT catch parse / validation errors and silently
 * proceed; callers that want to surface this to the user should
 * try/catch and report the underlying message.
 */
export class InstancesStoreError extends Error {
	override readonly name = "InstancesStoreError"
	override readonly cause?: unknown
	constructor(message: string, cause?: unknown) {
		super(message)
		this.cause = cause
	}
}

/**
 * The instance definition store.
 *
 * Lifecycle:
 *   1. constructor reads instances.json from disk (or seeds an
 *      empty file if missing).
 *   2. upsert / delete mutate in-memory state immediately and
 *      schedule an atomic-rename write to disk.
 *   3. flush() forces any pending write to disk NOW (used by
 *      tests; production relies on the synchronous atomic-rename
 *      path already used in upsert / delete).
 */
export class InstancesStore {
	private cache: InstancesFile

	constructor(private readonly options: InstancesStoreOptions) {
		// Ensure the parent directory exists. Same discipline as
		// the global state / secrets storage.
		fs.mkdirSync(path.dirname(options.filePath), { recursive: true })

		this.cache = this.readFromDisk()
	}

	/**
	 * Read the entire instances.json from disk, validate against
	 * the contract parser, and return the parsed shape. Throws on
	 * corruption or schema mismatch (fail closed).
	 */
	private readFromDisk(): InstancesFile {
		const raw = this.readRawFromDisk()
		if (raw === undefined) {
			return emptyInstancesFile()
		}
		try {
			return parseInstancesFile(raw)
		} catch (err) {
			if (err instanceof InstancesContractError) {
				throw new InstancesStoreError(
					`instances.json at ${this.options.filePath} failed validation (fail closed): ${err.message}`,
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
			throw new InstancesStoreError(
				`instances.json at ${this.options.filePath} is unreadable / malformed (fail closed)`,
				err,
			)
		}
	}

	/** Read a single instance by id; returns undefined if absent. */
	read(instanceId: string): ProviderConfigurationInstance | undefined {
		return this.cache.instances[instanceId]
	}

	/** List all instances, keyed by instanceId. */
	list(): Record<string, ProviderConfigurationInstance> {
		return { ...this.cache.instances }
	}

	/**
	 * Insert or replace an instance by instanceId. The on-disk
	 * write is atomic-rename; call flush() to force.
	 */
	upsert(instance: ProviderConfigurationInstance): void {
		// Validate the incoming record against the schema before
		// committing -- a malformed instance must NEVER make it
		// into the cache (and from there to disk).
		let parsed: ProviderConfigurationInstance
		try {
			parsed = parseProviderConfigurationInstance(instance)
		} catch (err) {
			throw new InstancesStoreError(
				`ProviderConfigurationInstance failed validation (fail closed): ${err instanceof Error ? err.message : String(err)}`,
				err,
			)
		}
		const next: InstancesFile = {
			version: 1,
			instances: {
				...this.cache.instances,
				[parsed.instanceId]: parsed,
			},
		}
		this.cache = next
		this.persist(next)
	}

	/** Remove an instance by id. No-op if absent. */
	delete(instanceId: string): void {
		if (!(instanceId in this.cache.instances)) {
			return
		}
		const next: InstancesFile = {
			version: 1,
			instances: { ...this.cache.instances },
		}
		delete next.instances[instanceId]
		this.cache = next
		this.persist(next)
	}

	/**
	 * Full in-memory snapshot. Useful for tests; production callers
	 * should prefer read(id) / list().
	 */
	snapshot(): InstancesFile {
		return JSON.parse(JSON.stringify(this.cache)) as InstancesFile
	}

	/**
	 * Force any pending write to disk. Used by tests to make
	 * restart assertions deterministic; production relies on
	 * the synchronous atomic-rename path already used in upsert /
	 * delete.
	 */
	flush(): void {
		this.persist(this.cache)
	}

	private persist(next: InstancesFile): void {
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
