/**
 * ACT-CLINEMM-MCP-READONLY-LIVE-QUAL01
 *
 * EXPLICIT INSTANCE OWNERSHIP for the embedded MCP control seam.
 *
 * The RECON01 seam had a defect: `ControlSeamServer.start()` removed
 * any pre-existing socket file unconditionally, so a SECOND extension
 * host (or a second window) silently REPLACED a live instance's
 * socket and token. The replacement then bound its own listener at the
 * same path and wrote a NEW token — the first instance was still
 * running but had become unreachable, and the token on disk no longer
 * matched any live listener's bearer.
 *
 * The symmetric defect was in `dispose()`: it removed the socket and
 * token files unconditionally, so an instance that never owned them
 * (or that had already lost ownership) DELETED another instance's
 * live artifacts.
 *
 * This module establishes explicit ownership with an on-disk owner
 * record:
 *
 *   <control-seam-dir>/owner.json
 *     { v, instanceId, pid, startedAt, tokenFingerprint }
 *
 * Rules:
 *
 *   1. `acquireControlSeamOwnership()` succeeds ONLY when there is no
 *      owner record, or when the recorded owner is provably DEAD
 *      (its pid no longer exists). A live owner causes a fail-closed
 *      error: the second instance must not take the endpoint.
 *   2. `releaseControlSeamOwnership()` removes the record ONLY when
 *      the on-disk record still carries THIS instance's id. Cleanup
 *      never removes another instance's artifacts.
 *   3. The record is written ATOMICALLY (write-then-rename) with mode
 *      0600, and the directory is 0700.
 *
 * Liveness is decided by `process.kill(pid, 0)`:
 *   - no throw               -> the pid EXISTS -> the owner is LIVE.
 *   - `ESRCH`                -> the pid is gone  -> the owner is DEAD.
 *   - `EPERM`                -> the pid exists but belongs to another
 *                               user -> treat as LIVE (fail closed).
 *
 * A pid-only liveness probe cannot distinguish a recycled pid from the
 * original owner. That is acceptable here because the endpoint is
 * user-local (0700 directory) and the worst case is a fail-closed
 * "the endpoint is busy" that the operator can clear with the explicit
 * `CLINEMM_CONTROL_SEAM_FORCE=1` escape hatch (which is itself an
 * explicit, operator-authored act).
 */

import { createHash, randomBytes } from "node:crypto"
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { CONTROL_SEAM_FILE_MODE } from "./control-seam-paths"

/** The owner-record file name inside the control-seam directory. */
export const CONTROL_SEAM_OWNER_FILE_NAME = "owner.json"

/** The schema version of the owner record. */
export const CONTROL_SEAM_OWNER_RECORD_VERSION = 1

/** The environment variable that lets an operator break a stale lock. */
export const CONTROL_SEAM_FORCE_ENV_VAR = "CLINEMM_CONTROL_SEAM_FORCE"

/** The on-disk owner record. */
export interface ControlSeamOwnerRecord {
	/** The schema version. */
	readonly v: number
	/** The unique id of the owning instance. */
	readonly instanceId: string
	/** The pid of the owning extension-host process. */
	readonly pid: number
	/** The epoch millis the owner record was written. */
	readonly startedAt: number
	/**
	 * A non-reversible fingerprint of the bearer token. It lets an
	 * operator confirm that the token file on disk belongs to the
	 * recorded owner WITHOUT disclosing the token itself.
	 */
	readonly tokenFingerprint: string
}

/** Why an ownership acquisition failed. */
export type ControlSeamOwnershipFailure = "live-owner" | "unreadable-owner-record" | "malformed-owner-record" | "force"

export interface ControlSeamOwnershipError extends Error {
	readonly reason: ControlSeamOwnershipFailure
	readonly owner?: ControlSeamOwnerRecord
}

/**
 * The mutable shape used while constructing the error.
 *
 * `Error`'s own properties are not readonly, but the INTERFACE above
 * declares them readonly — so the assignment has to happen through a
 * mutable view of the same object.
 */
interface MutableOwnershipError extends Error {
	reason: ControlSeamOwnershipFailure
	owner?: ControlSeamOwnerRecord
}

function ownershipError(
	reason: ControlSeamOwnershipFailure,
	message: string,
	owner?: ControlSeamOwnerRecord,
): ControlSeamOwnershipError {
	const error = new Error(message) as MutableOwnershipError
	error.name = "ControlSeamOwnershipError"
	error.reason = reason
	if (owner) {
		error.owner = owner
	}
	return error
}

/** The path of the owner record inside the control-seam directory. */
export function resolveControlSeamOwnerPath(dirPath: string): string {
	return join(dirPath, CONTROL_SEAM_OWNER_FILE_NAME)
}

/**
 * Mint a fresh, unique instance id.
 *
 * The id combines the pid with 16 random bytes, so two instances in
 * the same process (two controllers in one extension host) still get
 * distinct ids.
 */
export function createControlSeamInstanceId(pid: number = process.pid): string {
	return `${pid}-${randomBytes(16).toString("hex")}`
}

/**
 * A non-reversible fingerprint of the bearer token.
 *
 * `sha256` over the token, truncated to 16 hex characters. It is a
 * correlation aid, not a credential: it cannot be replayed.
 */
export function fingerprintControlSeamToken(token: string): string {
	return createHash("sha256").update(token, "utf8").digest("hex").slice(0, 16)
}

/**
 * Whether a pid is still alive.
 *
 * `EPERM` (the pid exists but belongs to another user) counts as
 * ALIVE — fail closed.
 */
export function isControlSeamPidAlive(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 0) {
		return false
	}
	try {
		process.kill(pid, 0)
		return true
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code
		if (code === "ESRCH") {
			return false
		}
		// EPERM and anything unexpected: treat as alive (fail closed).
		return true
	}
}

/**
 * Read and validate the owner record.
 *
 * Returns `undefined` when no record exists. Throws when a record
 * exists but cannot be trusted — the caller MUST fail closed in that
 * case, because an unreadable owner record means the endpoint's
 * ownership is unknown.
 */
export function readControlSeamOwnerRecord(ownerPath: string): ControlSeamOwnerRecord | undefined {
	if (!existsSync(ownerPath)) {
		return undefined
	}
	let parsed: unknown
	try {
		parsed = JSON.parse(readFileSync(ownerPath, "utf8"))
	} catch {
		throw ownershipError(
			"unreadable-owner-record",
			`[ControlSeam] the owner record at ${ownerPath} could not be read; refusing to take the endpoint (set ${CONTROL_SEAM_FORCE_ENV_VAR}=1 to override)`,
		)
	}
	if (typeof parsed !== "object" || parsed === null) {
		throw ownershipError(
			"malformed-owner-record",
			`[ControlSeam] the owner record at ${ownerPath} is malformed; refusing to take the endpoint`,
		)
	}
	const record = parsed as Record<string, unknown>
	if (
		record.v !== CONTROL_SEAM_OWNER_RECORD_VERSION ||
		typeof record.instanceId !== "string" ||
		record.instanceId.length === 0 ||
		typeof record.pid !== "number" ||
		!Number.isInteger(record.pid) ||
		typeof record.startedAt !== "number" ||
		typeof record.tokenFingerprint !== "string"
	) {
		throw ownershipError(
			"malformed-owner-record",
			`[ControlSeam] the owner record at ${ownerPath} is malformed; refusing to take the endpoint`,
		)
	}
	return {
		v: CONTROL_SEAM_OWNER_RECORD_VERSION,
		instanceId: record.instanceId,
		pid: record.pid,
		startedAt: record.startedAt,
		tokenFingerprint: record.tokenFingerprint,
	}
}

/** Write the owner record atomically (write-then-rename) with mode 0600. */
export function writeControlSeamOwnerRecordAtomic(ownerPath: string, record: ControlSeamOwnerRecord): void {
	const temporaryPath = `${ownerPath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`
	writeFileSync(temporaryPath, `${JSON.stringify(record, null, 2)}\n`, { mode: CONTROL_SEAM_FILE_MODE })
	renameSync(temporaryPath, ownerPath)
}

/**
 * Acquire ownership of the control endpoint.
 *
 * Succeeds only when the endpoint is genuinely free:
 *
 *   - no owner record at all, OR
 *   - the recorded owner is provably dead (its pid is gone).
 *
 * A LIVE owner raises a `ControlSeamOwnershipError` with reason
 * `live-owner`. The caller must NOT bind in that case.
 *
 * The record is written atomically so a concurrent reader never sees
 * a half-written file.
 */
export function acquireControlSeamOwnership(options: {
	readonly dirPath: string
	readonly ownerPath?: string
	readonly token: string
	readonly instanceId?: string
	readonly pid?: number
	readonly env?: NodeJS.ProcessEnv
}): ControlSeamOwnerRecord {
	const env = options.env ?? process.env
	const ownerPath = options.ownerPath ?? resolveControlSeamOwnerPath(options.dirPath)
	const pid = options.pid ?? process.pid
	const instanceId = options.instanceId ?? createControlSeamInstanceId(pid)
	const force = env[CONTROL_SEAM_FORCE_ENV_VAR]?.trim().toLowerCase() === "1"

	let existing: ControlSeamOwnerRecord | undefined
	try {
		existing = readControlSeamOwnerRecord(ownerPath)
	} catch (error) {
		if (!force) {
			throw error
		}
		// The operator explicitly asked to break a stale/unknown lock.
		existing = undefined
	}

	if (existing && !force && isControlSeamPidAlive(existing.pid)) {
		throw ownershipError(
			"live-owner",
			`[ControlSeam] the control endpoint is already owned by a live instance (pid ${existing.pid}, instance ${existing.instanceId}); refusing to replace it`,
			existing,
		)
	}
	// Either there was no record, or the recorded owner is dead and the
	// endpoint is stale and may be reclaimed. The stale record is
	// overwritten below.

	const record: ControlSeamOwnerRecord = {
		v: CONTROL_SEAM_OWNER_RECORD_VERSION,
		instanceId,
		pid,
		startedAt: Date.now(),
		tokenFingerprint: fingerprintControlSeamToken(options.token),
	}
	writeControlSeamOwnerRecordAtomic(ownerPath, record)
	return record
}

/**
 * Release ownership — but ONLY if this instance still owns it.
 *
 * Returns `true` when the record was released (this instance was the
 * recorded owner) and `false` when the on-disk record belongs to
 * somebody else. In the latter case the caller MUST NOT remove the
 * socket or the token file.
 */
export function releaseControlSeamOwnership(options: { readonly ownerPath: string; readonly instanceId: string }): boolean {
	let existing: ControlSeamOwnerRecord | undefined
	try {
		existing = readControlSeamOwnerRecord(options.ownerPath)
	} catch {
		// An unreadable record is NOT ours to remove.
		return false
	}
	if (!existing || existing.instanceId !== options.instanceId) {
		return false
	}
	try {
		rmSync(options.ownerPath, { force: true })
	} catch {
		// Best effort: a leftover owner record only causes a
		// fail-closed busy endpoint, never a correctness breach.
	}
	return true
}
