/**
 * ACT-CLINEMM-TEMPORARY-EXTERNAL-PATH-AUTHORITY01
 *
 * Authoritative validator for the persisted temporary external path
 * authorities Settings list.
 *
 * This module is the SINGLE host-side source of truth for the 24h
 * hard ceiling. Both the UI write path (updateSettings.ts) and the
 * CLI write path (updateSettingsCli.ts) MUST call
 * `validateTemporaryExternalPathAuthorities` before persisting. The
 * runtime filter (`filterActiveTemporaryExternalPathEntries`, used
 * by the CORRECTION03 fresh-read pipeline
 * `resolveActiveTemporaryExternalCanonicalRootsFromBackingFile`) is
 * defense-in-depth — it ALSO rejects any persisted entry whose
 * expiry exceeds now + 24h, even if the write-time validator was
 * bypassed by an old or tampered client.
 *
 * CORRECTION03 cross-instance visibility: the consumer pipeline
 * `resolveActiveTemporaryExternalCanonicalRootsFromBackingFile`
 * reads the persisted value DIRECTLY from the backing JSON file at
 * the policy decision boundary, bypassing the StateManager cache and
 * the ClineFileStorage in-memory cache. Every Codium instance sees
 * the same authoritative value on every evaluation without depending
 * on a cache-coherence subsystem, a watcher, a debounce, or a
 * timestamp-based self-write heuristic.
 *
 * CORRECTION04 path-shape defense-in-depth: the validator and the
 * runtime filter share the structural predicate
 * `classifyTemporaryExternalPathShape` so that tampered persisted
 * state of `"/"` (filesystem root) or `"../tmp"` (relative path)
 * cannot widen R0 authority via the realpath-canonicalization step
 * downstream of the filter. Without this, a manually-edited
 * `globalState.json` could survive the filter and become an
 * effective temporary root, defeating the bounded contract.
 *
 * Why reject (not clamp):
 *   A security setting that silently changes the requested authority
 *   is less auditable than a typed-error rejection. The user / CLI
 *   operator gets explicit feedback that their requested duration
 *   exceeds the policy.
 */

import { isAbsolute, parse } from "node:path"
import type { TemporaryExternalPathAuthority } from "@cline/core"

export const MAX_TEMPORARY_EXTERNAL_PATH_HOURS = 24
export const MS_PER_HOUR = 60 * 60 * 1000

/**
 * ACT-CLINEMM-TEMPORARY-EXTERNAL-PATH-AUTHORITY01-CORRECTION04:
 *
 * Pure structural predicate that classifies a persisted
 * `path` value against the same shape contract the write-time
 * validator enforces. The runtime filter
 * (`filterActiveTemporaryExternalPathEntries`) and the write
 * validator (`validateEntry`) MUST agree on which paths are
 * structurally admissible — otherwise tampered persisted state
 * can slip past the validator (e.g. an old client from before
 * CORRECTION02, or a manually-edited `globalState.json`) and
 * widen R0 authority beyond the bounded contract at the
 * consumption-time fresh-read.
 *
 * Returns:
 *   - "valid"           — absolute, non-root, non-empty string
 *   - "not-string"      — value is not a string at all
 *   - "empty"           — empty string
 *   - "not-absolute"    — relative path (e.g. "tmp", "../tmp", ".")
 *   - "filesystem-root" — exactly "/"
 *
 * CORRECTION04 (P0): the runtime filter previously accepted
 * tampered "/" (filesystem root) and relative paths because the
 * realpath-canonicalization step that follows would happily
 * resolve `realpath("/")` → "/" and `realpath("../tmp")` →
 * whatever the extension host's process CWD turns it into. Both
 * outcomes defeat the bounded "narrow escape hatch" contract:
 *
 *   workspaceRoots ∪ ["/"]        trivially contains every
 *                                 canonical path (R0 gateway is
 *                                 silently disabled)
 *
 *   workspaceRoots ∪ [realpath("../tmp")]
 *                                reintroduces the CWD-dependent
 *                                 authority identity that
 *                                 CORRECTION02 explicitly closed
 *
 * Sharing the shape predicate keeps the two enforcement points
 * (validator and runtime filter) defined against the SAME
 * authoritative source-of-truth for "what is a structurally
 * admissible temporary path", with no risk of drift between
 * them.
 */
export type TemporaryExternalPathShapeClassification = "valid" | "not-string" | "empty" | "not-absolute" | "filesystem-root"

/**
 * ACT-CLINEMM-TEMPORARY-EXTERNAL-PATH-AUTHORITY01-CORRECTION05:
 * Cross-platform filesystem-root detection. POSIX uses `/` as
 * the single root; Windows uses drive roots like `C:\` and UNC
 * roots like `\\server\share`. We use `path.parse(path).root`,
 * which is platform-aware (`/` on POSIX, `C:\` etc. on Windows),
 * and compare it against the platform-normalized absolute path.
 *
 * Trailing separators are stripped before comparison so the
 * classification is consistent regardless of how the user
 * writes the path (`C:\` vs `C:` vs `C:\Users`). On POSIX the
 * `path.parse` root is always `/` for absolute paths; on Windows
 * it is `C:\` for `C:\...` and `\\?\` for extended-length paths.
 */
function isFilesystemRoot(path: string): boolean {
	// `parse` is platform-aware: on POSIX it returns root === "/"
	// for any absolute path; on Windows it returns root === "C:\"
	// for `C:\...` and root === "\\" for UNC `\\server\share`.
	const parsed = parse(path)
	if (parsed.root.length === 0) {
		// parse() returned no root — should not happen for absolute
		// paths, but treat conservatively as filesystem-root if the
		// full path equals the platform root.
		return false
	}
	// Trailing-separator-tolerant equality: `C:\` and `C:` are
	// the same logical drive root.
	return path === parsed.root || path === parsed.root.replace(/[\\/]+$/, "")
}

export function classifyTemporaryExternalPathShape(path: unknown): TemporaryExternalPathShapeClassification {
	if (typeof path !== "string") return "not-string"
	if (path.length === 0) return "empty"
	if (!isAbsolute(path)) return "not-absolute"
	if (isFilesystemRoot(path)) return "filesystem-root"
	return "valid"
}

/**
 * Reasons the validator can reject an entry. All errors are typed so
 * the caller can surface them to the user / CLI operator with a
 * specific actionable message.
 */
export type TemporaryExternalPathValidationErrorReason =
	| "path-empty"
	| "path-not-string"
	| "path-not-absolute"
	| "path-filesystem-root-forbidden"
	| "expiresAt-empty"
	| "expiresAt-not-string"
	| "expiresAt-unparseable"
	| "expiresAt-not-finite"
	| "expiresAt-not-positive"
	| "expiresAt-exceeds-24h-ceiling"

export interface TemporaryExternalPathValidationError {
	readonly index: number
	readonly reason: TemporaryExternalPathValidationErrorReason
	readonly message: string
	readonly received?: unknown
}

export interface TemporaryExternalPathValidationResult {
	readonly valid: ReadonlyArray<TemporaryExternalPathAuthority>
	readonly errors: ReadonlyArray<TemporaryExternalPathValidationError>
}

/**
 * Validate a single `TemporaryExternalPathAuthority` entry. Pure,
 * side-effect-free.
 *
 * Returns `null` if the entry is valid; otherwise a typed error
 * describing the failure (with the entry's index for diagnostics).
 */
function validateEntry(entry: unknown, index: number, now: number): TemporaryExternalPathValidationError | null {
	if (entry === null || typeof entry !== "object") {
		return {
			index,
			reason: "expiresAt-unparseable",
			message: `entry[${index}]: not an object`,
		}
	}
	const e = entry as Record<string, unknown>
	// ACT-CLINEMM-TEMPORARY-EXTERNAL-PATH-AUTHORITY01-CORRECTION04:
	// The structural shape check (`classifyTemporaryExternalPathShape`)
	// is shared between the write-time validator (here) and the
	// runtime filter (`filterActiveTemporaryExternalPathEntries`).
	// Two enforcement points, one predicate — guarantees the
	// validator and the consumption-time filter cannot drift on
	// what counts as a structurally admissible temporary path.
	//
	// CORRECTION02 closed:
	//   - relative paths (e.g. `../tmp`, `tmp`, `.`)
	//     — `realpathSync` would resolve against the host process
	//       CWD, which the user did NOT intend to authorize.
	//   - the filesystem root "/"
	//     — `workspaceRoots ∪ ["/"]` trivially contains every
	//       canonical path, silently disabling the R0 gateway.
	const shape = classifyTemporaryExternalPathShape(e.path)
	if (shape === "not-string") {
		return {
			index,
			reason: "path-not-string",
			message: `entry[${index}]: path must be a string`,
			received: e.path,
		}
	}
	if (shape === "empty") {
		return {
			index,
			reason: "path-empty",
			message: `entry[${index}]: path must be a non-empty string`,
		}
	}
	if (shape === "not-absolute") {
		return {
			index,
			reason: "path-not-absolute",
			message: `entry[${index}]: path "${e.path}" must be an absolute path (e.g. "/private/tmp")`,
			received: e.path,
		}
	}
	if (shape === "filesystem-root") {
		return {
			index,
			reason: "path-filesystem-root-forbidden",
			message: `entry[${index}]: path "/" is the filesystem root and ` + `would defeat the bounded escape-hatch contract`,
		}
	}
	if (typeof e.expiresAt !== "string") {
		return {
			index,
			reason: "expiresAt-not-string",
			message: `entry[${index}]: expiresAt must be an ISO-8601 string`,
			received: e.expiresAt,
		}
	}
	if (e.expiresAt.length === 0) {
		return {
			index,
			reason: "expiresAt-empty",
			message: `entry[${index}]: expiresAt must be a non-empty ISO-8601 string`,
		}
	}
	const expiryMs = Date.parse(e.expiresAt)
	if (!Number.isFinite(expiryMs)) {
		return {
			index,
			reason: "expiresAt-unparseable",
			message: `entry[${index}]: expiresAt "${e.expiresAt}" is not parseable as ISO-8601`,
		}
	}
	if (expiryMs <= now) {
		return {
			index,
			reason: "expiresAt-not-positive",
			message: `entry[${index}]: expiresAt "${e.expiresAt}" is in the past or now`,
		}
	}
	const ceilingMs = now + MAX_TEMPORARY_EXTERNAL_PATH_HOURS * MS_PER_HOUR
	if (expiryMs > ceilingMs) {
		return {
			index,
			reason: "expiresAt-exceeds-24h-ceiling",
			message:
				`entry[${index}]: expiresAt "${e.expiresAt}" exceeds the 24h hard ceiling ` +
				`(max allowed: now + ${MAX_TEMPORARY_EXTERNAL_PATH_HOURS}h)`,
		}
	}
	return null
}

/**
 * Validate an array of `TemporaryExternalPathAuthority` entries
 * (typically received from the wire as JSON-parsed values).
 *
 * Returns the validated entries (rejected entries dropped) and the
 * list of typed errors. The caller MAY choose to fail-closed on any
 * error (reject the whole write) or accept the valid subset; both
 * call sites in this repo choose the strict posture (fail-closed).
 *
 * `now` is an injected clock to keep this function pure / unit-testable.
 */
export function validateTemporaryExternalPathAuthorities(
	raw: unknown,
	now: number = Date.now(),
): TemporaryExternalPathValidationResult {
	if (!Array.isArray(raw)) {
		return {
			valid: [],
			errors: [
				{
					index: -1,
					reason: "expiresAt-unparseable",
					message: "expected an array of { path, expiresAt } entries",
				},
			],
		}
	}
	const valid: TemporaryExternalPathAuthority[] = []
	const errors: TemporaryExternalPathValidationError[] = []
	for (let i = 0; i < raw.length; i++) {
		const err = validateEntry(raw[i], i, now)
		if (err) {
			errors.push(err)
			continue
		}
		const e = raw[i] as TemporaryExternalPathAuthority
		valid.push({ path: e.path, expiresAt: e.expiresAt })
	}
	return { valid, errors }
}

/**
 * Defense-in-depth runtime check used at consumption time. Even if a
 * stale or tampered persisted entry slipped past the write-time
 * validator (e.g. an old client from before CORRECTION01, or a
 * manually-edited globalState.json), the host filter MUST treat it as
 * INACTIVE.
 *
 * Returns true iff `expiryMs` represents a finite future timestamp
 * within the 24h hard ceiling from `now`. Used by
 * SdkController.resolveActiveTemporaryExternalCanonicalRoots.
 */
export function isWithinTwentyFourHourCeiling(expiryMs: number, now: number = Date.now()): boolean {
	if (!Number.isFinite(expiryMs)) return false
	if (expiryMs <= now) return false
	if (expiryMs > now + MAX_TEMPORARY_EXTERNAL_PATH_HOURS * MS_PER_HOUR) return false
	return true
}

/**
 * ACT-CLINEMM-TEMPORARY-EXTERNAL-PATH-AUTHORITY01-CORRECTION02 +
 * ACT-CLINEMM-TEMPORARY-EXTERNAL-PATH-AUTHORITY01-CORRECTION04:
 *
 * Pure, side-effect-free filter applied at consumption time
 * (`SdkController.resolveActiveTemporaryExternalCanonicalRoots`
 * AND the tests both call THIS function — no mirror duplication).
 *
 * The filter pipeline:
 *   1. Read the persisted list (or empty if absent / non-array).
 *   2. CORRECTION04: drop entries whose `path` is not an
 *      absolute, non-root, non-empty string. Same structural
 *      shape predicate the write-time validator enforces — see
 *      `classifyTemporaryExternalPathShape`. This closes the
 *      post-CORRECTION03 P0: without it, tampered persisted
 *      state of `"/"` (filesystem root) or `"../tmp"`
 *      (relative) would survive this filter, get realpath-
 *      canonicalized in the next step, and widen R0 authority
 *      beyond the bounded contract.
 *   3. Drop entries where `now >= expiresAt`.
 *   4. Drop entries where `expiresAt > now + 24h` (defense-in-depth
 *      runtime backstop; the write-time validator already rejects
 *      this, but the runtime check holds even for tampered / stale
 *      persisted state).
 *   5. Forward the surviving canonical paths as-is — the host
 *      (SdkController) realpath-canonicalizes them when it threads
 *      them into `buildPathAuthorityEvidence`. This keeps the
 *      validator dependency-free (no `node:fs` import) so it can be
 *      called from both the extension and the test process.
 */
export function filterActiveTemporaryExternalPathEntries(
	persisted: ReadonlyArray<TemporaryExternalPathAuthority> | undefined,
	now: number = Date.now(),
): ReadonlyArray<TemporaryExternalPathAuthority> {
	if (!Array.isArray(persisted) || persisted.length === 0) {
		return []
	}
	const ceilingMs = now + MAX_TEMPORARY_EXTERNAL_PATH_HOURS * MS_PER_HOUR
	const active: TemporaryExternalPathAuthority[] = []
	for (const entry of persisted) {
		if (!entry) continue
		// CORRECTION04 (P0): apply the SAME structural path-shape
		// predicate as the write-time validator. Anything other than
		// an absolute, non-root, non-empty string is INACTIVE here.
		// This is the load-bearing fix for tampered-persisted-state
		// causing R0 widening via `realpath("/")` → "/" or
		// `realpath("../tmp")` → CWD-relative.
		if (classifyTemporaryExternalPathShape(entry.path) !== "valid") {
			continue
		}
		if (typeof entry.expiresAt !== "string" || entry.expiresAt.length === 0) {
			continue
		}
		const expiryMs = Date.parse(entry.expiresAt)
		if (!Number.isFinite(expiryMs)) continue
		if (now >= expiryMs) continue
		// Defense-in-depth: tampered persisted state that bypassed
		// the write-time validator (e.g. an old client from before
		// CORRECTION01, or a manually-edited `globalState.json`) MUST
		// be INACTIVE here.
		if (expiryMs > ceilingMs) continue
		active.push({ path: entry.path, expiresAt: entry.expiresAt })
	}
	return active
}

/**
 * ACT-CLINEMM-TEMPORARY-EXTERNAL-PATH-AUTHORITY01-CORRECTION03:
 *
 * ONE-SHOT cross-instance-safe consumer pipeline. Reads the
 * `clinemmTemporaryExternalPathAuthorities` key DIRECTLY from the
 * backing JSON file on disk (bypassing both the StateManager cache
 * and the ClineFileStorage in-memory cache), runs the persisted
 * entries through `filterActiveTemporaryExternalPathEntries`, then
 * realpath-canonicalizes the survivors — exactly the pipeline the
 * host runs at the command-policy decision boundary.
 *
 * Why this exists (and replaces the CORRECTION02 watcher):
 *
 *   The StateManager cache is per-instance, populated once at
 *   startup. When a different Codium window writes a new value to
 *   `~/.cline/data/globalState.json`, this instance's cache is
 *   unaware of it. The CORRECTION02 attempt to fix that with a
 *   chokidar filesystem watcher was structurally unsound:
 *
 *     P0-1  The cross-instance test wrote the file directly and then
 *           called the explicit reload helper, never exercising the
 *           watcher path. The "external-write → chokidar event →
 *           debounce → reload → cache updated" chain was unproven.
 *
 *     P0-2  The watcher's self-write suppression used a 1-second
 *           timestamp window. A timestamp window is chronology, not
 *           causal identity — chokidar cannot tell us "this event was
 *           MY write". An external write that arrived within the
 *           suppression window (e.g. 300ms after our own persist)
 *           would be DROPPED, and instance A would retain stale
 *           authority until some unrelated filesystem event.
 *
 *     P0-3  The watcher only listened for `change` events. The
 *           persistence primitive is atomic (tmp + rename), which
 *           chokidar's `awaitWriteFinish` does normalize — but only
 *           under specific timing windows, which is fragile.
 *
 *   CORRECTION03 removes the watcher entirely. Cross-instance
 *   authority visibility is now a property of the evaluation seam:
 *   the host reads the authoritative key DIRECTLY from disk when it
 *   is about to make a decision. Whatever is on disk at that moment
 *   is what the policy sees — regardless of which instance wrote
 *   it, when, or whether anyone flushed a cache.
 *
 * Returns canonical paths ready to be threaded into
 * `buildPathAuthorityEvidence(..., temporaryExternalCanonicalRoots)`.
 * Failures (read, parse, realpath) drop entries; the function NEVER
 * throws.
 */
export interface ResolveActiveTemporaryExternalCanonicalRootsOptions {
	/** Absolute path to the backing JSON file. */
	readonly backingFilePath: string
	/** Optional realpath implementation. Defaults to `fs.realpathSync`. */
	readonly realpathSync?: (path: string) => string
	/** Optional `now` for deterministic tests. */
	readonly now?: number
	/** Optional logger for realpath failures; receives (entry, error). */
	readonly onRealpathFailure?: (entry: TemporaryExternalPathAuthority, error: unknown) => void
}

/**
 * Public entry-point. Production callers (SdkController) call THIS.
 * The fs-touching implementation lives in the `*Impl` sibling so the
 * `node:fs` import is local to this module rather than pulled in at
 * the top level (the validator module is shared with browser / bundler
 * contexts that have no `node:fs`).
 */
export function resolveActiveTemporaryExternalCanonicalRootsFromBackingFile(
	opts: ResolveActiveTemporaryExternalCanonicalRootsOptions,
): string[] {
	return resolveActiveTemporaryExternalCanonicalRootsFromBackingFileImpl(opts)
}

function resolveActiveTemporaryExternalCanonicalRootsFromBackingFileImpl({
	backingFilePath,
	realpathSync: realpathOverride,
	now,
	onRealpathFailure,
}: ResolveActiveTemporaryExternalCanonicalRootsOptions): string[] {
	// `node:fs` is required lazily so this module remains usable from
	// browser / bundler contexts. The production VSCode host always
	// has node, so the import is a no-op at runtime.
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const { readFileSync, realpathSync: fsRealpathSync } = require("node:fs") as typeof import("node:fs")
	const resolvedRealpath = realpathOverride ?? fsRealpathSync

	let persisted: unknown
	try {
		const raw = readFileSync(backingFilePath, "utf-8")
		// Skip empty / whitespace-only files (the persist primitive
		// never writes that, but a manually-edited file could).
		if (raw.trim().length > 0) {
			const parsed = JSON.parse(raw)
			persisted = parsed?.clinemmTemporaryExternalPathAuthorities
		}
	} catch {
		// Missing or corrupt file → treat as absent authority, never
		// throw. The caller falls back to "no temp roots" and the
		// policy layer falls back to the V1 lexical-only check.
		return []
	}

	const active = filterActiveTemporaryExternalPathEntries(
		persisted as ReadonlyArray<TemporaryExternalPathAuthority> | undefined,
		now,
	)
	if (active.length === 0) {
		return []
	}

	const canonicalRoots: string[] = []
	for (const entry of active) {
		try {
			const canonical = resolvedRealpath(entry.path)
			if (typeof canonical === "string" && canonical.length > 0) {
				canonicalRoots.push(canonical)
			}
		} catch (err) {
			if (onRealpathFailure) {
				onRealpathFailure(entry, err)
			}
			// Drop entries whose realpath fails (ENOENT / EACCES / ELOOP).
		}
	}
	return canonicalRoots
}

/**
 * Read JUST the raw `clinemmTemporaryExternalPathAuthorities` value
 * from the backing JSON file, with no filtering or canonicalization.
 * Used by callers that need to surface the persisted list to the UI
 * (the UI shows "Expired (no authority)" entries so the user can see
 * and remove them).
 *
 * Returns `undefined` when the file is missing or the key is absent.
 * Returns the raw value (NOT validated; the runtime filter is the
 * authoritative gate at the decision boundary).
 */
export function readTemporaryExternalPathAuthoritiesRawFromBackingFile(backingFilePath: string): unknown {
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const { readFileSync } = require("node:fs") as typeof import("node:fs")
	try {
		const raw = readFileSync(backingFilePath, "utf-8")
		if (raw.trim().length === 0) return undefined
		const parsed = JSON.parse(raw)
		return parsed?.clinemmTemporaryExternalPathAuthorities
	} catch {
		return undefined
	}
}
