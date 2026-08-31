/**
 * ACT-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE-AND-APPROVAL-LIVE-CAPTURE01:
 *
 * Closed-runtime auto-resolution of the V2 capture path used by the
 * dogfood diagnostic profile. When the operator's launcher exports
 * `CLINEMM_RUNTIME_PROFILE=dogfood` but does NOT export
 * `CLINEMM_CAPTURE_V2_PATH=<path>`, the V knob of the diagnostic
 * profile would otherwise sit at "OFF" because the existing capture
 * path resolver only honors the user-set env var. This module fills
 * that gap by composing a deterministic per-extension-host path under
 * the existing `<clineDir>/data/runtime-diag/<runtimeInstanceId>.jsonl`
 * layout.
 *
 * Contract (frozen):
 *
 *   - Identity gate: this module only contributes a path when
 *     `isDogfoodRuntime(env)` is `true`. Public installs get `null`
 *     and the V knob stays OFF (matching the diagnostic-profile
 *     resolver's C2 invariant: public must NOT silently activate).
 *   - Single source for `<clineDir>` resolution:
 *     `resolveDataDirFromEnv()` from `@shared/storage/storage-context.ts`,
 *     which already honors `CLINE_DATA_DIR` / `~/.cline` precedence
 *     for VSCode / CLI / JetBrains. This is the same root the file-
 *     backed `ClineFileStorage` writes to, so the new directory sits
 *     next to the existing `data/` subfolders.
 *   - `<runtimeInstanceId>` is a short, non-secret ULID minted once
 *     per extension-host startup (mirrors the
 *     `capture.attach.v1` record's runtimeInstanceId convention so
 *     the two paths in this artifact can be correlated).
 *   - Pure with respect to its inputs (env + now); the directory
 *     creation is a single side effect via `fs.mkdirSync(..., { recursive: true })`,
 *     best-effort and never throws. If creation fails the function
 *     still returns the path so the caller can decide whether to
 *     surface a sink-availability warning.
 */

import { randomUUID } from "node:crypto"
import { mkdirSync } from "node:fs"
import { resolveDataDirFromEnv } from "@shared/storage/storage-context"
import { isDogfoodRuntime } from "./dogfood-runtime-profile"

const RUNTIME_DIAG_SUBDIR = "runtime-diag"
const FILE_NAME_PREFIX = "clinemm-v2-"
const FILE_NAME_SUFFIX = ".jsonl"

// Three-state cache: `undefined` = uninitialized (resolve on next
// call); `null` = resolved to null (public install or no env); a
// string = the resolved auto-path. The empty-string sentinel is
// avoided so a real empty path would not collide with the cache
// state.
let cachedAutoPath: string | null | undefined
let cachedRuntimeInstanceId: string | undefined

/**
 * Resolve (and lazily create) the auto V2 capture path for the
 * current extension host. Returns `null` when the profile is not
 * dogfood (i.e. public), so the V knob of the diagnostic profile
 * stays OFF (matching the diagnostic-profile resolver's C2
 * invariant: public must NOT silently activate).
 *
 * The path is memoized per process so repeated
 * `getStateToPostToWebview` calls do not re-mint the runtime
 * instance id and do not re-create the directory.
 */
export function resolveAutoV2CapturePath(env: NodeJS.ProcessEnv = process.env): string | null {
	if (cachedAutoPath !== undefined) {
		return cachedAutoPath
	}
	if (!isDogfoodRuntime(env)) {
		cachedAutoPath = null
		return null
	}
	const id = cachedRuntimeInstanceId ?? randomUUID().slice(0, 8) + "-" + Date.now().toString(36)
	cachedRuntimeInstanceId = id
	const dataDir = resolveDataDirFromEnv()
	const runtimeDiagDir = `${dataDir}/${RUNTIME_DIAG_SUBDIR}`
	try {
		mkdirSync(runtimeDiagDir, { recursive: true })
	} catch {
		// best-effort; preserve path so callers can still inspect
		// the intended location in error reports.
	}
	const path = `${runtimeDiagDir}/${FILE_NAME_PREFIX}${id}${FILE_NAME_SUFFIX}`
	cachedAutoPath = path
	return path
}

/**
 * Test seam: reset the memoized auto-path cache. Production code
 * MUST NOT call this. Tests that flip the env var between cases
 * use it to observe a fresh resolution.
 */
export function __resetAutoV2CapturePathForTests(): void {
	cachedAutoPath = undefined
	cachedRuntimeInstanceId = undefined
}
