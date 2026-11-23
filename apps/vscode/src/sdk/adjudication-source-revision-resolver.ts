/**
 * ACT-CLINEMM-ADJUDICATION-VSCODE-ACTIVATION-01
 *
 * The VS Code HOST ADAPTER for the SDK's `SourceRevisionResolver`.
 *
 * WHAT IT ESTABLISHES
 * -------------------
 *
 * The resolver is the runtime's INDEPENDENT source-identity authority. The
 * model can neither author nor override it: the published adjudication
 * envelope carries no revision field, and this resolver's answer is read at
 * ACQUISITION time and STORED with the tool result.
 *
 * It establishes the five facts the SDK's `SourceRevision` requires:
 *
 *   repositoryIdentity     - the remote URL when there is one, otherwise a
 *                            stable digest of the resolved workspace root;
 *   workspaceRootIdentity  - a stable digest of the workspace root. The
 *                            ABSOLUTE PATH is deliberately NOT carried: it
 *                            would disclose the operator's home directory;
 *   revision               - the git HEAD commit sha;
 *   contentIdentity        - a digest of the file's CURRENT bytes (the
 *                            resolver's own view of the workspace, which the
 *                            runtime combines with the TOOL-RETURNED bytes);
 *   clean                  - whether the working tree was clean.
 *
 * THE SOURCE BOUNDARY
 * -------------------
 *
 * Every one of these rules fails CLOSED, i.e. returns `undefined` so the
 * candidate is `source_revision_bound: false`:
 *
 *   - the source path must resolve INSIDE the authorized workspace root;
 *   - a path that escapes the workspace (via `..` or a symlink) is rejected;
 *   - a path that does not exist is rejected;
 *   - a non-file (directory, device) is rejected;
 *   - a workspace that is not a git repository has no revision, so it is
 *     rejected;
 *   - a source path whose tool is not a source-observing tool is rejected.
 *
 * THE TOOL GATE
 * -------------
 *
 * The SDK's acquisition seam already restricts source authority to
 * `read_files`. This adapter mirrors that gate so a resolver call for an
 * unsupported tool can never establish a source identity. It does NOT widen
 * the evidence-authority contract to generic command stdout: doing so is
 * explicitly out of scope for this ACT.
 */

import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { realpathSync } from "node:fs"
import { readFile, realpath, stat } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

/**
 * The closed set of tools whose results may carry source authority.
 *
 * This mirrors the SDK's `SOURCE_OBSERVING_TOOL_NAMES` exactly. It is
 * duplicated here deliberately: the adapter is a HOST adapter that must not
 * depend on the SDK's internal (non-exported) constant, and a closed
 * duplicated set is safer than an open one. If the SDK widens its set, this
 * adapter must be widened in the same change.
 */
const SOURCE_OBSERVING_TOOL_NAMES: ReadonlySet<string> = new Set(["read_files"])

/**
 * The SDK's `SourceRevision` shape.
 *
 * Declared structurally so this adapter does not need the SDK's internal
 * module (which is not exported through the `@cline/core` barrel under the
 * minifier-safe name).
 */
export interface HostSourceRevision {
	readonly repositoryIdentity: string
	readonly workspaceRootIdentity: string
	readonly revision: string
	readonly contentIdentity: string
	readonly clean: boolean
}

/**
 * The SDK's `SourceRevisionResolver` shape.
 */
export interface HostSourceRevisionResolver {
	resolve(input: {
		sourcePath: string
		toolName: string
	}): Promise<HostSourceRevision | undefined> | HostSourceRevision | undefined
}

function sha256Hex(value: string): string {
	return createHash("sha256").update(value).digest("hex")
}

/**
 * The host adapter's configuration.
 */
export interface CreateVscodeSourceRevisionResolverOptions {
	/**
	 * The authorized workspace root.
	 *
	 * Every source path is validated against this root. A path outside it is
	 * rejected.
	 */
	readonly workspaceRoot: string
}

/**
 * Resolve the git HEAD sha, or `undefined` when the workspace is not a
 * repository with a commit.
 */
async function resolveHeadRevision(cwd: string): Promise<string | undefined> {
	try {
		const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd })
		const revision = stdout.trim()
		return revision.length > 0 ? revision : undefined
	} catch {
		return undefined
	}
}

/**
 * Resolve the repository identity.
 *
 * The remote URL when there is one, otherwise a stable digest of the
 * resolved workspace root. The URL is normalized (credentials stripped)
 * because a remote URL can embed a token.
 */
async function resolveRepositoryIdentity(cwd: string, workspaceRootIdentity: string): Promise<string | undefined> {
	try {
		const { stdout } = await execFileAsync("git", ["remote", "get-url", "origin"], { cwd })
		const raw = stdout.trim()
		if (raw.length > 0) {
			// Strip any embedded credentials: `https://user:token@host/...`.
			const sanitized = raw.replace(/\/\/[^/@]*@/, "//")
			return sha256Hex(sanitized)
		}
	} catch {
		// No `origin` remote. Fall through to the workspace-root identity.
	}
	// A repository with no remote still has an identity: the workspace root.
	return sha256Hex(`workspace:${workspaceRootIdentity}`)
}

/**
 * Whether the working tree is clean.
 *
 * `git status --porcelain` prints one line per changed path, so an empty
 * output means clean. Untracked files count as dirty: they are content the
 * repository does not vouch for.
 */
async function resolveWorkingTreeClean(cwd: string): Promise<boolean> {
	try {
		const { stdout } = await execFileAsync("git", ["status", "--porcelain"], { cwd })
		return stdout.trim().length === 0
	} catch {
		// Cannot establish cleanliness: report dirty (fail closed on the
		// "trustworthy revision" axis).
		return false
	}
}

/**
 * Resolve the content identity of a file, by reading its bytes.
 *
 * The resolver's own view of the file. The runtime's acquisition record
 * combines it with the TOOL-RETURNED bytes, so a file edited after the read
 * cannot silently rebind the evidence.
 */
async function resolveContentIdentity(absolutePath: string): Promise<string | undefined> {
	try {
		const bytes = await readFile(absolutePath)
		return sha256Hex(bytes.toString("base64"))
	} catch {
		return undefined
	}
}

/**
 * Resolve a source path to an absolute path INSIDE the workspace root.
 *
 * Returns `undefined` when the path escapes the root, does not exist, or is
 * not a regular file.
 */
async function resolveContainedSourcePath(workspaceRoot: string, sourcePath: string): Promise<string | undefined> {
	const trimmed = sourcePath?.trim()
	if (!trimmed) {
		return undefined
	}
	// A path containing a NUL byte is never a real path.
	if (trimmed.includes("\0")) {
		return undefined
	}
	const root = path.resolve(workspaceRoot)
	const candidate = path.isAbsolute(trimmed) ? path.resolve(trimmed) : path.resolve(root, trimmed)
	// Lexical containment: the candidate must be the root itself or under it.
	const relative = path.relative(root, candidate)
	if (relative.startsWith("..") || path.isAbsolute(relative)) {
		return undefined
	}
	let realRoot: string
	let realCandidate: string
	try {
		realRoot = await realpath(root)
		realCandidate = await realpath(candidate)
	} catch {
		// The root or the candidate does not exist.
		return undefined
	}
	// Symlink containment: the RESOLVED candidate must still be under the
	// RESOLVED root. This is what closes the symlink-escape hole.
	const realRelative = path.relative(realRoot, realCandidate)
	if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
		return undefined
	}
	try {
		const stats = await stat(realCandidate)
		if (!stats.isFile()) {
			return undefined
		}
	} catch {
		return undefined
	}
	return realCandidate
}

/**
 * `realpath` that never throws: an unresolvable root falls back to its
 * resolved path so the identity is still stable and non-disclosing.
 */
function realpathSafe(target: string): string {
	try {
		return realpathSync(target)
	} catch {
		return path.resolve(target)
	}
}

/**
 * Create the VS Code host adapter for the SDK's `SourceRevisionResolver`.
 *
 * The adapter is BOUND to one workspace root. It is created per session, at
 * the producer seam, so the workspace it authorizes is the workspace the
 * session actually runs in.
 */
export function createVscodeSourceRevisionResolver(
	options: CreateVscodeSourceRevisionResolverOptions,
): HostSourceRevisionResolver {
	const workspaceRoot = path.resolve(options.workspaceRoot)
	const workspaceRootIdentity = sha256Hex(realpathSafe(workspaceRoot))
	return {
		async resolve(input: { sourcePath: string; toolName: string }): Promise<HostSourceRevision | undefined> {
			// The tool gate: only a source-observing tool may establish a
			// source identity. A shell command's stdout is NOT promoted.
			if (!SOURCE_OBSERVING_TOOL_NAMES.has(input.toolName)) {
				return undefined
			}
			const absolutePath = await resolveContainedSourcePath(workspaceRoot, input.sourcePath)
			if (!absolutePath) {
				return undefined
			}
			const revision = await resolveHeadRevision(workspaceRoot)
			if (!revision) {
				// Not a repository (or no commit): no trustworthy revision.
				return undefined
			}
			const contentIdentity = await resolveContentIdentity(absolutePath)
			if (!contentIdentity) {
				return undefined
			}
			const repositoryIdentity = await resolveRepositoryIdentity(workspaceRoot, workspaceRootIdentity)
			if (!repositoryIdentity) {
				return undefined
			}
			const clean = await resolveWorkingTreeClean(workspaceRoot)
			return {
				repositoryIdentity,
				workspaceRootIdentity,
				revision,
				contentIdentity,
				clean,
			}
		},
	}
}
