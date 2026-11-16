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
 *   1. `acquireControlSeamOwnership()` succeeds ONLY when it can take the
 *      EXCLUSIVE ownership claim. The claim is an ATOMIC, EXCLUSIVE
 *      filesystem operation: the owner record is written to a private
 *      temporary file and then HARD-LINKED into place (`link(2)`), which
 *      fails with `EEXIST` when the name is already taken. A
 *      read-check followed by a rename-to-overwrite is NOT an exclusive
 *      claim — two contenders that both observed an unowned endpoint
 *      would both "win" it, and the second would silently replace the
 *      first one's token and socket.
 *   2. A LIVE owner causes a fail-closed error: the second instance must
 *      not take the endpoint.
 *   3. A DEAD owner is a STALE endpoint. Reclaiming it is serialized by a
 *      transient, exclusively-created reclaim token, so two reclaimers can
 *      never both remove the stale record and both "win" the endpoint.
 *      The reclaimer re-reads the record inside the critical section and
 *      only removes the record it positively identified as stale.
 *   4. `releaseControlSeamOwnership()` removes the record ONLY when the
 *      on-disk record still carries THIS instance's id. Cleanup never
 *      removes another instance's artifacts.
 *   5. The record is written with mode 0600 and the directory is 0700.
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
 * explicit, operator-authored act, and which is LOUD — it never
 * silently bypasses a live owner's protection).
 */

import { createHash, randomBytes } from "node:crypto"
import { existsSync, linkSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { Logger } from "@shared/services/Logger"

import { CONTROL_SEAM_FILE_MODE } from "./control-seam-paths"

/** The owner-record file name inside the control-seam directory. */
export const CONTROL_SEAM_OWNER_FILE_NAME = "owner.json"

/**
 * The transient reclaim-token file name inside the control-seam directory.
 *
 * The reclaim token serializes the STALE-reclaim critical section: only
 * the holder of this token may remove a stale owner record. It is created
 * with an EXCLUSIVE create (`O_CREAT | O_EXCL`), so exactly one process
 * can hold it. It is removed as soon as the critical section ends, and it
 * is NOT reclaimed automatically — a crashed token holder leaves the
 * endpoint fail-closed until the operator forces it away.
 */
export const CONTROL_SEAM_OWNER_RECLAIM_FILE_NAME = "owner.json.reclaim"

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

/** The path of the transient reclaim token inside the control-seam directory. */
export function resolveControlSeamOwnerReclaimPath(dirPath: string): string {
	return join(dirPath, CONTROL_SEAM_OWNER_RECLAIM_FILE_NAME)
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

/**
 * Take the EXCLUSIVE ownership claim for an owner record.
 *
 * Returns `true` when this process took the claim and `false` when the
 * name was already taken.
 *
 * The claim is a single ATOMIC filesystem operation:
 *
 *   1. The record is written to a private temporary file in the SAME
 *      directory, with mode 0600. The content is therefore COMPLETE
 *      before the claim becomes visible.
 *   2. `link(2)` creates the owner-record name as a hard link to that
 *      temporary file. `link` fails with `EEXIST` when the destination
 *      name already exists — it is an EXCLUSIVE create (`O_CREAT |
 *      O_EXCL` semantics) that the kernel serializes across processes.
 *
 * The claim is therefore atomic, exclusive and content-complete. A
 * read-check followed by a rename-to-overwrite is NOT an exclusive
 * claim: two contenders that both observed an unowned endpoint would
 * both "win" it, and the second would silently replace the first one's
 * token and socket.
 */
function claimControlSeamOwnerRecord(ownerPath: string, record: ControlSeamOwnerRecord): boolean {
	const temporaryPath = `${ownerPath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`
	try {
		writeFileSync(temporaryPath, `${JSON.stringify(record, null, 2)}\n`, { mode: CONTROL_SEAM_FILE_MODE })
		linkSync(temporaryPath, ownerPath)
		return true
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") {
			return false
		}
		throw error
	} finally {
		try {
			unlinkSync(temporaryPath)
		} catch {
			// Best effort: a leftover temporary file is inert.
		}
	}
}

/**
 * Acquire the EXCLUSIVE reclaim token for the stale-reclaim critical
 * section.
 *
 * Returns `true` when this process holds the token. The token is created
 * with an EXCLUSIVE create (`O_CREAT | O_EXCL`), so exactly one process
 * can hold it at a time.
 */
function acquireControlSeamReclaimToken(reclaimPath: string): boolean {
	try {
		writeFileSync(reclaimPath, `${process.pid}\n`, { flag: "wx", mode: CONTROL_SEAM_FILE_MODE })
		return true
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") {
			return false
		}
		throw error
	}
}

/**
 * Acquire ownership of the control endpoint.
 *
 * Succeeds only when this process can take the EXCLUSIVE ownership
 * claim:
 *
 *   - the endpoint is unowned (no owner record at all), OR
 *   - the recorded owner is provably DEAD (its pid is gone) and the
 *     stale record can be reclaimed under the exclusive reclaim token.
 *
 * A LIVE owner raises a `ControlSeamOwnershipError` with reason
 * `live-owner`. The caller must NOT bind in that case.
 *
 * The claim itself is an exclusive filesystem create, so two processes
 * racing for the SAME unowned endpoint can never both succeed: exactly
 * one takes the claim, the other observes the taken claim and fails
 * closed.
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
	const reclaimPath = resolveControlSeamOwnerReclaimPath(options.dirPath)
	const pid = options.pid ?? process.pid
	const instanceId = options.instanceId ?? createControlSeamInstanceId(pid)
	const force = env[CONTROL_SEAM_FORCE_ENV_VAR]?.trim().toLowerCase() === "1"

	const record: ControlSeamOwnerRecord = {
		v: CONTROL_SEAM_OWNER_RECORD_VERSION,
		instanceId,
		pid,
		startedAt: Date.now(),
		tokenFingerprint: fingerprintControlSeamToken(options.token),
	}

	// The bounded retry budget covers the contention paths only: a
	// concurrent reclaim (whose exclusive token we lost) and a record
	// that vanished between the read and the claim.
	const maxAttempts = 8
	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		// 1. Take the EXCLUSIVE claim.
		if (claimControlSeamOwnerRecord(ownerPath, record)) {
			return record
		}

		// 2. The claim is taken. Find out by whom.
		let existing: ControlSeamOwnerRecord | undefined
		// The record exists (the exclusive claim failed) but it cannot be
		// trusted. Without the FORCE escape hatch this is a fail-closed
		// error: an unreadable owner record means the endpoint's
		// ownership is UNKNOWN.
		let recordIsUntrusted = false
		try {
			existing = readControlSeamOwnerRecord(ownerPath)
		} catch (error) {
			if (!force) {
				throw error
			}
			// The operator explicitly asked to break a stale/unknown lock.
			// The untrusted record is reclaimed below — but only inside the
			// exclusive reclaim critical section, and only if it is STILL
			// the untrusted record we observed.
			recordIsUntrusted = true
			existing = undefined
		}
		if (!existing && !recordIsUntrusted) {
			// The record vanished between the failed claim and the read.
			// Retry the exclusive claim.
			continue
		}

		const ownerIsAlive = existing !== undefined && isControlSeamPidAlive(existing.pid)
		if (ownerIsAlive && !force) {
			throw ownershipError(
				"live-owner",
				`[ControlSeam] the control endpoint is already owned by a live instance (pid ${existing?.pid}, instance ${existing?.instanceId}); refusing to replace it`,
				existing,
			)
		}
		if (ownerIsAlive && force) {
			// The FORCE escape hatch is an explicit, operator-authored act.
			// It is NOT silent: the operator is told, in the log, that a
			// LIVE owner was displaced.
			Logger.warn(
				`[ControlSeam] ${CONTROL_SEAM_FORCE_ENV_VAR}=1 is displacing a LIVE owner (pid ${existing?.pid}, instance ${existing?.instanceId}); the displaced instance will lose its endpoint`,
			)
		}
		if (recordIsUntrusted && force) {
			Logger.warn(`[ControlSeam] ${CONTROL_SEAM_FORCE_ENV_VAR}=1 is breaking an UNREADABLE owner record at ${ownerPath}`)
		}

		// 3. Reclaim: remove the stale (or forced) record under the
		// EXCLUSIVE reclaim token, so two reclaimers can never both
		// remove it and both "win" the endpoint.
		if (!acquireControlSeamReclaimToken(reclaimPath)) {
			// Another process is inside the reclaim critical section.
			// Wait for it and re-evaluate.
			continue
		}
		try {
			// Re-read INSIDE the critical section: the record may have
			// changed while we waited for the token. Only the record we
			// positively identified as stale is removed.
			let current: ControlSeamOwnerRecord | undefined
			let currentIsUntrusted = false
			try {
				current = readControlSeamOwnerRecord(ownerPath)
			} catch {
				current = undefined
				currentIsUntrusted = true
			}
			// The record is removed ONLY when it is still the record we
			// observed: either the same stale instance, or still the
			// untrusted record the operator asked us to break.
			const stillTheSameRecord = recordIsUntrusted
				? currentIsUntrusted
				: current !== undefined && current.instanceId === existing?.instanceId
			if (stillTheSameRecord) {
				try {
					unlinkSync(ownerPath)
				} catch {
					// Best effort.
				}
			}
		} finally {
			try {
				unlinkSync(reclaimPath)
			} catch {
				// Best effort.
			}
		}
		// 4. Retry the EXCLUSIVE claim. Exactly one contender wins it.
	}

	throw ownershipError(
		"live-owner",
		`[ControlSeam] could not take the exclusive ownership claim for the control endpoint after ${maxAttempts} attempts; refusing to replace it`,
	)
}

/**
 * Whether the on-disk owner record still carries THIS instance's id.
 *
 * The cleanup path uses this to decide whether it may remove the socket
 * and the token. It is checked IMMEDIATELY BEFORE the removal, while the
 * exclusive ownership claim is still held.
 */
export function ownsControlSeamOwnership(options: { readonly ownerPath: string; readonly instanceId: string }): boolean {
	let existing: ControlSeamOwnerRecord | undefined
	try {
		existing = readControlSeamOwnerRecord(options.ownerPath)
	} catch {
		// An unreadable record is NOT ours.
		return false
	}
	return existing !== undefined && existing.instanceId === options.instanceId
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
	if (!ownsControlSeamOwnership(options)) {
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
