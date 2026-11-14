/**
 * ACT-CLINEMM-EMBEDDED-MCP-CONTROL-SEAM-RECON01
 *
 * Canonical filesystem layout for the embedded MCP control seam.
 *
 * Everything the seam writes lives under ONE private directory:
 *
 *   <clineDir>/data/control-seam/
 *     control.sock        AF_UNIX listener (0600)
 *     token               bearer token (0600)
 *     enabled.json        explicit opt-in record
 *
 * The directory is created with mode 0700 and the files with 0600, so
 * only the owning user can reach the listener. There is NO TCP
 * exposure: the seam never binds an INET socket, so it is unreachable
 * from the network by construction.
 *
 * The path resolution mirrors `sdk/packages/shared/src/storage/paths.ts`
 * (`resolveClineDir()` -> `resolveClineDataDir()`), expressed locally
 * so this ACT does not widen the `@cline/shared` public barrel.
 */

import { homedir } from "node:os"
import { join } from "node:path"

/**
 * The maximum AF_UNIX socket path length.
 *
 * `sock_path` in `struct sockaddr_un` is 108 bytes on macOS (104
 * usable bytes after the NUL). Linux allows 108 too. A path longer
 * than that fails with `EINVAL` from `listen()` — which is exactly
 * what a long `TMPDIR` produces on macOS.
 *
 * The seam therefore REJECTS an over-long path up front with a clear
 * message instead of failing deep inside `listen()` with an opaque
 * `EINVAL`.
 */
export const CONTROL_SEAM_MAX_SOCKET_PATH_LENGTH = 100

/** The directory name under the data dir that holds the seam. */
export const CONTROL_SEAM_DIR_NAME = "control-seam"

/** The AF_UNIX socket file name. */
export const CONTROL_SEAM_SOCKET_FILE_NAME = "control.sock"

/** The bearer token file name. */
export const CONTROL_SEAM_TOKEN_FILE_NAME = "token"

/** The explicit opt-in record file name. */
export const CONTROL_SEAM_OPT_IN_FILE_NAME = "enabled.json"

/** Directory mode: owner-only. */
export const CONTROL_SEAM_DIR_MODE = 0o700

/** File mode: owner-only read/write. */
export const CONTROL_SEAM_FILE_MODE = 0o600

/**
 * Resolve the ClineMM data directory.
 *
 * Mirrors `resolveClineDataDir()` in `@cline/shared`: an explicit
 * `CLINE_DATA_DIR` wins, else `<clineDir>/data`, where `clineDir` is
 * `CLINE_DIR` if set else `~/.cline`.
 */
export function resolveControlSeamDataDir(env: NodeJS.ProcessEnv = process.env): string {
	const explicitDataDir = env.CLINE_DATA_DIR?.trim()
	if (explicitDataDir) {
		return explicitDataDir
	}
	const explicitClineDir = env.CLINE_DIR?.trim()
	const clineDir = explicitClineDir ? explicitClineDir : join(env.HOME?.trim() || homedir(), ".cline")
	return join(clineDir, "data")
}

/** The private control-seam directory. */
export function resolveControlSeamDir(env: NodeJS.ProcessEnv = process.env): string {
	return join(resolveControlSeamDataDir(env), CONTROL_SEAM_DIR_NAME)
}

/** The AF_UNIX socket path. */
export function resolveControlSeamSocketPath(env: NodeJS.ProcessEnv = process.env): string {
	return join(resolveControlSeamDir(env), CONTROL_SEAM_SOCKET_FILE_NAME)
}

/** The bearer token path. */
export function resolveControlSeamTokenPath(env: NodeJS.ProcessEnv = process.env): string {
	return join(resolveControlSeamDir(env), CONTROL_SEAM_TOKEN_FILE_NAME)
}

/** The explicit opt-in record path. */
export function resolveControlSeamOptInPath(env: NodeJS.ProcessEnv = process.env): string {
	return join(resolveControlSeamDir(env), CONTROL_SEAM_OPT_IN_FILE_NAME)
}

/**
 * Whether an AF_UNIX socket path fits the platform's `sock_path`.
 *
 * Used by the server to fail closed with an actionable message rather
 * than letting `listen()` raise an opaque `EINVAL`.
 */
export function isControlSeamSocketPathUsable(socketPath: string): boolean {
	return Buffer.byteLength(socketPath, "utf8") <= CONTROL_SEAM_MAX_SOCKET_PATH_LENGTH
}
