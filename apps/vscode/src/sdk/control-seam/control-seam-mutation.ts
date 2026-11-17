/**
 * ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01
 *
 * The SEPARATE, EXPLICIT mutation grant for the embedded MCP control
 * seam.
 *
 * WHY A SEPARATE GRANT
 *
 * The RECON01 seam has ONE credential: the read bearer token, published
 * in `<clineDir>/data/control-seam/token` (mode 0600). It authorizes
 * `clinemm_capabilities` and `clinemm_get_run`. It is a READ credential.
 *
 * This ACT adds the FIRST mutation. The read token MUST NOT become
 * write authority: a client that can read the run state must not be
 * able to start a task. So the mutation grant is:
 *
 *   - DEFAULT OFF. The seam's existing behavior is UNCHANGED when the
 *     mutation control is off: the read token still authorizes exactly
 *     the two read operations, and the write operations are refused.
 *   - A SEPARATE opt-in record, written by the operator, in the SAME
 *     private 0700 directory. Its mere presence does NOT enable the
 *     seam; it enables MUTATION on an ALREADY-enabled seam.
 *   - A SEPARATE, DISTINCT, RANDOMLY GENERATED write credential, in its
 *     OWN file, never derived from and never equal to the read token.
 *   - BOUND to the CURRENT extension-host instance: the write token is
 *     minted per start and dies with the host. After a host restart the
 *     old write token is invalid (a new one is minted, or mutation is
 *     off until the operator re-enables it).
 *   - BOUND to the INTENDED WORKSPACE: the write grant records the
 *     workspace the extension host resolved from its OWN installed
 *     workspace owner. A `clinemm_start_act` whose
 *     `expectedWorkspace` does not match is rejected. The client can
 *     never SELECT a workspace.
 *   - The CONTENT-READ grant (task message text) is a SEPARATE,
 *     explicit sub-grant. `clinemm_read_events` returns event METADATA
 *     without it and event TEXT with it.
 *
 * AUTHORIZATION IS NEVER ANNOTATION
 *
 * The MCP tool annotations (`readOnlyHint`, `destructiveHint`, ...) are
 * DISCOVERY hints for the client. They are NEVER treated as
 * authorization. The extension-host server performs the credential
 * comparison itself, per request, on an open connection.
 */

import { randomBytes } from "node:crypto"
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

import { CONTROL_SEAM_DIR_MODE, CONTROL_SEAM_FILE_MODE } from "./control-seam-paths"
import { constantTimeEquals } from "./control-seam-protocol"

/**
 * The mutation opt-in record file name inside the control-seam
 * directory. It is DISTINCT from the seam's own `enabled.json` so the
 * two decisions cannot be confused: `enabled.json` turns the READ
 * seam on, `mutation.json` turns MUTATION on.
 */
export const CONTROL_SEAM_MUTATION_OPT_IN_FILE_NAME = "mutation.json"

/**
 * The write credential file name inside the control-seam directory.
 * It is DISTINCT from the read token file (`token`) and is never the
 * same value.
 */
export const CONTROL_SEAM_WRITE_TOKEN_FILE_NAME = "write-token"

/**
 * The schema version of the mutation opt-in record.
 */
export const CONTROL_SEAM_MUTATION_OPT_IN_VERSION = 1

/**
 * The mutation opt-in record.
 *
 * The operator writes this file to grant mutation. It is EXPLICIT:
 *
 *   {
 *     "v": 1,
 *     "enabled": true,
 *     "allowContentRead": false
 *   }
 *
 * `allowContentRead` is a SEPARATE, explicit opt-in for exposing task
 * message TEXT. It defaults to `false`: without it, `clinemm_read_events`
 * returns event metadata (kind, ordering, timestamp) but no message
 * text.
 */
export interface ControlSeamMutationOptInRecord {
	readonly v: 1
	readonly enabled: true
	readonly allowContentRead: boolean
}

/**
 * Parse + validate the mutation opt-in record's CONTENTS.
 *
 * Returns the validated record, or `undefined` when the contents are
 * not a well-formed, unambiguous grant. The caller treats `undefined`
 * as "mutation is NOT granted" — mutation control stays OFF.
 *
 * This function does NO I/O.
 */
export function parseControlSeamMutationOptInRecord(rawContents: string): ControlSeamMutationOptInRecord | undefined {
	const trimmed = rawContents.trim()
	if (trimmed.length === 0) {
		return undefined
	}
	let parsed: unknown
	try {
		parsed = JSON.parse(trimmed)
	} catch {
		return undefined
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		return undefined
	}
	const record = parsed as Record<string, unknown>
	if (record.v !== CONTROL_SEAM_MUTATION_OPT_IN_VERSION) {
		return undefined
	}
	if (record.enabled !== true) {
		return undefined
	}
	// `allowContentRead` is OPTIONAL and defaults to FALSE. An absent
	// field therefore grants mutation WITHOUT the content-read sub-
	// grant — the conservative default.
	const allowContentRead = record.allowContentRead === true
	return { v: 1, enabled: true, allowContentRead }
}

/**
 * Read + validate the mutation opt-in record from disk.
 *
 * Returns `undefined` when the record is absent, unreadable, or
 * malformed — mutation control stays OFF.
 */
export function readControlSeamMutationOptInRecord(optInPath: string): ControlSeamMutationOptInRecord | undefined {
	let raw: string
	try {
		raw = readFileSync(optInPath, "utf8")
	} catch {
		return undefined
	}
	return parseControlSeamMutationOptInRecord(raw)
}

/**
 * Write the explicit mutation opt-in record.
 *
 * The operator (or an installer) calls this to grant mutation. It is a
 * SEPARATE, EXPLICIT act: the seam's own `enabled.json` is untouched,
 * and the two grants are independent.
 */
export function writeControlSeamMutationOptIn(optInPath: string, options: { readonly allowContentRead?: boolean } = {}): void {
	const dir = dirname(optInPath)
	mkdirSync(dir, { recursive: true, mode: CONTROL_SEAM_DIR_MODE })
	chmodSync(dir, CONTROL_SEAM_DIR_MODE)
	const contents = `${JSON.stringify({ v: 1, enabled: true, allowContentRead: options.allowContentRead === true }, null, 2)}\n`
	writeFileSync(optInPath, contents, { mode: CONTROL_SEAM_FILE_MODE })
	chmodSync(optInPath, CONTROL_SEAM_FILE_MODE)
}

/**
 * The resolved, IN-MEMORY mutation grant for THIS extension-host
 * instance.
 *
 * The grant is created ONCE per control-seam start and is destroyed on
 * dispose. It carries the write credential IN MEMORY ONLY (the
 * credential is also published to the private 0600 file so a local
 * operator / the stdio proxy can read it).
 */
export interface ControlSeamMutationGrant {
	/**
	 * The DISTINCT write credential. Never equal to the read token and
	 * never derived from it.
	 */
	readonly writeToken: string
	/**
	 * The extension-host instance id this grant is bound to. A grant
	 * from a DIFFERENT instance is not valid here.
	 */
	readonly instanceId: string
	/**
	 * The workspace the grant is bound to. Resolved by the extension
	 * host from its OWN installed-workspace owner.
	 */
	readonly workspace: string
	/**
	 * Whether the explicit content-read sub-grant is present. When
	 * false, `clinemm_read_events` returns NO message text.
	 */
	readonly allowContentRead: boolean
}

/**
 * The result of evaluating a mutation request's authorization.
 *
 * `authorized` is true ONLY when:
 *   - mutation control is ON for this instance,
 *   - the request carried a write credential,
 *   - the credential matched THIS instance's write credential in
 *     constant time,
 *   - the grant's workspace matches the request's asserted workspace.
 */
export type ControlSeamMutationAuthorization =
	| { readonly authorized: true; readonly grant: ControlSeamMutationGrant }
	| {
			readonly authorized: false
			readonly reason: "mutation-disabled" | "missing-credential" | "invalid-credential" | "workspace-mismatch"
	  }

/**
 * Mint a fresh write credential.
 *
 * 32 random bytes, hex-encoded — the same shape as the read token, but
 * an INDEPENDENT random value. It is NEVER derived from the read
 * token.
 */
export function mintControlSeamWriteToken(): string {
	return randomBytes(32).toString("hex")
}

/**
 * Build the instance-local mutation grant.
 *
 * The grant is bound to `instanceId` and `workspace`. It is created
 * ONLY when the operator's mutation opt-in record is valid; otherwise
 * mutation control is OFF and the caller MUST NOT create a grant.
 */
export function createControlSeamMutationGrant(options: {
	readonly instanceId: string
	readonly workspace: string
	readonly allowContentRead: boolean
}): ControlSeamMutationGrant {
	return {
		writeToken: mintControlSeamWriteToken(),
		instanceId: options.instanceId,
		workspace: options.workspace,
		allowContentRead: options.allowContentRead,
	}
}

/**
 * Publish the write credential to the private 0600 file.
 *
 * The file is DISTINCT from the read token file. It is removed on
 * dispose, so a dead extension host leaves NO mutation credential
 * behind.
 */
export function writeControlSeamWriteTokenFile(writeTokenPath: string, writeToken: string): void {
	const dir = dirname(writeTokenPath)
	mkdirSync(dir, { recursive: true, mode: CONTROL_SEAM_DIR_MODE })
	chmodSync(dir, CONTROL_SEAM_DIR_MODE)
	writeFileSync(writeTokenPath, `${writeToken}\n`, { mode: CONTROL_SEAM_FILE_MODE })
	chmodSync(writeTokenPath, CONTROL_SEAM_FILE_MODE)
}

/**
 * Read the write credential a local client needs.
 *
 * Returns `undefined` when the file is absent or unreadable — the
 * "mutation control is off / no instance" case.
 */
export function loadControlSeamWriteToken(writeTokenPath: string): string | undefined {
	try {
		const raw = readFileSync(writeTokenPath, "utf8").trim()
		return raw.length > 0 ? raw : undefined
	} catch {
		return undefined
	}
}

/**
 * Remove the write credential file. Best effort — the credential is
 * invalid in memory regardless once the grant is dropped.
 */
export function removeControlSeamWriteTokenFile(writeTokenPath: string): void {
	try {
		if (existsSync(writeTokenPath)) {
			rmSync(writeTokenPath, { force: true })
		}
	} catch {
		// Best effort.
	}
}

/**
 * Evaluate a mutation request's authorization.
 *
 * The comparison is CONSTANT TIME. The grant is checked for EVERY
 * request — including on a connection that stays open — so a client
 * that loses authorization mid-stream cannot keep mutating.
 *
 * `expectedWorkspace` is the client's ASSERTION. When the grant is
 * present and the assertion does not match the grant's workspace, the
 * request is refused with `workspace-mismatch`.
 */
export function authorizeControlSeamMutation(options: {
	readonly grant: ControlSeamMutationGrant | undefined
	readonly writeToken: string | undefined
	readonly expectedWorkspace?: string
}): ControlSeamMutationAuthorization {
	const grant = options.grant
	if (!grant) {
		return { authorized: false, reason: "mutation-disabled" }
	}
	if (!options.writeToken) {
		return { authorized: false, reason: "missing-credential" }
	}
	if (!constantTimeEquals(options.writeToken, grant.writeToken)) {
		return { authorized: false, reason: "invalid-credential" }
	}
	if (options.expectedWorkspace !== undefined && options.expectedWorkspace !== grant.workspace) {
		return { authorized: false, reason: "workspace-mismatch" }
	}
	return { authorized: true, grant }
}

/**
 * The path of the mutation opt-in record inside the control-seam
 * directory.
 */
export function resolveControlSeamMutationOptInPath(dirPath: string): string {
	return join(dirPath, CONTROL_SEAM_MUTATION_OPT_IN_FILE_NAME)
}

/**
 * The path of the write credential file inside the control-seam
 * directory.
 */
export function resolveControlSeamWriteTokenPath(dirPath: string): string {
	return join(dirPath, CONTROL_SEAM_WRITE_TOKEN_FILE_NAME)
}
