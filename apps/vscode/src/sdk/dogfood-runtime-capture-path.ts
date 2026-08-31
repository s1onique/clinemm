/**
 * ACT-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE-AND-APPROVAL-LIVE-CAPTURE01
 * (CORRECTION02 — globalStorageUri migration)
 *
 * Closed-runtime auto-resolution of the V2 capture path used by the
 * dogfood diagnostic profile. When the operator's launcher exports
 * `CLINEMM_RUNTIME_PROFILE=dogfood` but does NOT export
 * `CLINEMM_CAPTURE_V2_PATH=<path>`, the V knob of the diagnostic
 * profile would otherwise sit at "OFF" because the existing capture
 * path resolver only honors the user-set env var. This module fills
 * that gap by composing a deterministic per-extension-host path under
 * an injected, extension-owned storage root:
 *
 *     <globalStorageFsPath>/runtime-diag/<runtimeInstanceId>.jsonl
 *
 * Contract (frozen, with CORRECTION02):
 *
 *   - Identity gate: this module only contributes a path when
 *     `isDogfoodRuntime(env)` is `true`. Public installs get `null`
 *     and the V knob stays OFF (matching the diagnostic-profile
 *     resolver's C2 invariant: public must NOT silently activate).
 *   - Storage root: the path is rooted at the EXTENSION-OWNED
 *     writable directory (`ExtensionContext.globalStorageUri.fsPath`
 *     in VS Code, `HostProvider.get().globalStorageFsPath` across
 *     all hosts). The root is supplied at activation time via
 *     `configureDogfoodCaptureStorage(root)` from the host boundary
 *     (`apps/vscode/src/extension.ts:activate` for VS Code,
 *     `apps/vscode/src/standalone/vscode-context.ts:initializeContext`
 *     for the standalone host). The low-level capture code does
 *     NOT import `vscode`; it merely consumes an opaque root path.
 *     This is the durable answer to the EPERM-on-`~/.cline` failure
 *     mode discovered in the CORRECTION02 live investigation.
 *   - Truthful return: the function returns `null` when the
 *     injected root is missing OR when `mkdirSync` fails. The
 *     diagnostic-profile resolver observes `null` and flips `V`
 *     OFF (the `V` knob now represents "automatic sink initialized
 *     successfully" rather than the weaker "intended path exists").
 *     This is the contract upgrade R4 demands.
 *   - `<runtimeInstanceId>` is a short, non-secret ULID minted once
 *     per extension-host startup (mirrors the
 *     `capture.attach.v1` record's runtimeInstanceId convention so
 *     the two paths in this artifact can be correlated).
 *   - The directory creation is a single side effect via
 *     `fs.mkdirSync(..., { recursive: true })`. On failure we
 *     cache `null` and surface the failure through the resolver
 *     (V=false) — there is no silent-failure mode anymore.
 *
 * Precedence (mirrors `v2-capture.ts:resolveCapturePath`):
 *
 *   1. operator-set `CLINEMM_CAPTURE_V2_PATH`   -> the existing
 *      emitter honors this directly; this module is not consulted
 *      for explicit paths.
 *   2. identity-gated dogfood + injected
 *      `globalStorageFsPath` root + `mkdirSync` OK
 *                                           -> `<root>/runtime-diag/<id>.jsonl`
 *   3. otherwise                            -> `null`.
 *
 * REMOVED in CORRECTION02:
 *
 *   - The `<clineDir>/data/runtime-diag` fallback (via
 *     `resolveDataDirFromEnv()`) was REMOVED. Live evidence showed
 *     `/Volumes/UserData/Users/chistyakov/.cline/data/runtime-diag`
 *     returning `EPERM` from `mkdirSync` under the sandboxed
 *     `codium-clinemm` launcher (the home directory tree under
 *     `/Volumes/UserData` is sealed against writes for that user in
 *     that environment). VS Code's `globalStorageUri` is the
 *     canonical, platform-managed writable location for exactly
 *     this class of extension-owned diagnostic artifacts. Trying
 *     `~/.cline` first would only preserve one silent failure per
 *     process and complicate the truthfulness contract.
 */

import { randomUUID } from "node:crypto"
import { mkdirSync } from "node:fs"
import { isDogfoodRuntime } from "./dogfood-runtime-profile"

const RUNTIME_DIAG_SUBDIR = "runtime-diag"
const FILE_NAME_PREFIX = "clinemm-v2-"
const FILE_NAME_SUFFIX = ".jsonl"

// ACT-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE-AND-APPROVAL-LIVE-CAPTURE01
// (CORRECTION02):
//
// Injected storage root, bound at activation by the host boundary
// (VS Code's `extension.ts:activate` and the standalone
// `vscode-context.ts:initializeContext`). The root is the
// extension-owned writable directory for the active host:
// `ExtensionContext.globalStorageUri.fsPath` (VS Code) or the
// `DATA_DIR` used by `initializeContext` (standalone). Three-state:
// `undefined` = not-yet-bound, `string` = bound root. Once set,
// this is the SOLE root considered by `resolveAutoV2CapturePath`;
// there is no fallback to `~/.cline` (see file-level docstring).
let configuredStorageRoot: string | undefined

// Three-state cache for `resolveAutoV2CapturePath`:
//   `undefined`       -> uninitialized (resolve on next call)
//   `null`            -> resolved null (no path available)
//   `<string>`        -> resolved path under the configured root
// The empty-string sentinel is avoided so a real empty path would
// not collide with the cache state.
let cachedAutoPath: string | null | undefined
let cachedRuntimeInstanceId: string | undefined

/**
 * ACT-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE-AND-APPROVAL-LIVE-CAPTURE01
 * (CORRECTION02):
 *
 * Bind the extension-owned storage root for the dogfood auto
 * capture sink. Called ONCE at activation by the host boundary
 * (VS Code's `extension.ts:activate` and the standalone
 * `vscode-context.ts:initializeContext`). After this call,
 * `resolveAutoV2CapturePath` will use `<root>/runtime-diag/` as
 * its parent directory when the runtime profile is `dogfood`.
 *
 * Production invariants:
 *
 *   - MUST be called with a non-empty, writable directory path.
 *     `activate` supplies `context.globalStorageUri.fsPath`; the
 *     standalone host supplies its `DATA_DIR`.
 *   - MUST be called BEFORE the first capture sink query. The
 *     capture-sink resolver is memoized, so a late bind only
 *     takes effect after an explicit cache reset (which
 *     production code never does).
 *   - Re-binding during a session invalidates the memoized path
 *     (`cachedAutoPath` is reset) so the next query re-resolves
 *     against the new root.
 *
 * Idempotent: calling with the same path twice is a no-op.
 *
 * Public-only surface: this function is imported by the host
 * boundary modules, NOT by the low-level capture code. The
 * capture modules receive the resulting path through
 * `resolveAutoV2CapturePath`, never through this API directly,
 * so `vscode` is never imported into the SDK capture modules.
 */
export function configureDogfoodCaptureStorage(root: string): void {
	const trimmed = typeof root === "string" ? root.trim() : ""
	if (trimmed.length === 0) {
		return
	}
	if (configuredStorageRoot === trimmed) {
		return
	}
	configuredStorageRoot = trimmed
	// Re-binding invalidates the memoized auto-path so the next
	// call re-resolves against the new root.
	cachedAutoPath = undefined
}

/**
 * Resolve (and lazily create) the auto V2 capture path for the
 * current extension host. Returns `null` when:
 *
 *   - the runtime profile is not dogfood (public installs stay
 *     OFF per the diagnostic-profile resolver's C2 invariant), OR
 *   - no storage root has been configured
 *     (`configureDogfoodCaptureStorage()` was never called), OR
 *   - `mkdirSync` failed when materializing the `runtime-diag/`
 *     subdirectory under the configured root (the CORRECTION02
 *     R4 truthful-return contract: V now reflects "sink
 *     initialized successfully", not "intended path exists").
 *
 * The path is memoized per process so repeated
 * `getStateToPostToWebview` calls do not re-mint the runtime
 * instance id and do not re-attempt the directory creation.
 */
export function resolveAutoV2CapturePath(env: NodeJS.ProcessEnv = process.env): string | null {
	if (cachedAutoPath !== undefined) {
		return cachedAutoPath
	}
	if (!isDogfoodRuntime(env)) {
		cachedAutoPath = null
		return null
	}
	const root = configuredStorageRoot
	if (typeof root !== "string" || root.length === 0) {
		// CORRECTION02: the host boundary did not bind a storage
		// root. We do NOT silently fall back to `~/.cline` (that
		// root proved untrustworthy under the dogfood launcher);
		// instead we return null so the diagnostic-profile resolver
		// reflects "no initialized sink" via V=false.
		cachedAutoPath = null
		return null
	}
	const id = cachedRuntimeInstanceId ?? randomUUID().slice(0, 8) + "-" + Date.now().toString(36)
	cachedRuntimeInstanceId = id
	const runtimeDiagDir = `${root}/${RUNTIME_DIAG_SUBDIR}`
	try {
		mkdirSync(runtimeDiagDir, { recursive: true })
	} catch {
		// CORRECTION02 R4: do NOT silently keep the intended path.
		// Cache null so subsequent calls short-circuit and the V
		// knob in the diagnostic-profile resolver flips OFF. This
		// is the truthful return path: if the sink could not be
		// initialized, the header MUST NOT advertise it as active.
		cachedAutoPath = null
		return null
	}
	const path = `${runtimeDiagDir}/${FILE_NAME_PREFIX}${id}${FILE_NAME_SUFFIX}`
	cachedAutoPath = path
	return path
}

/**
 * Test seam: reset the memoized auto-path cache and the
 * configured storage root. Production code MUST NOT call this.
 * Tests that flip the env var, the storage root, or both between
 * cases use it to observe a fresh resolution.
 */
export function __resetAutoV2CapturePathForTests(): void {
	cachedAutoPath = undefined
	cachedRuntimeInstanceId = undefined
	configuredStorageRoot = undefined
}
