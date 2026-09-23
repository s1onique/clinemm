/**
 * ACT-CLINEMM-EXTENSION-HOST-ALLOCATION-AUTHORITY01
 *
 * Production wiring for the V8 allocation sampler. This module owns
 * the production-only seams that the pure module
 * (`./extension-host-allocation-profiler.ts`) does NOT want to know
 * about:
 *
 *   - `node:inspector` Session factory (the real Inspector backend)
 *   - `node:fs/promises` filesystem seam (real disk IO)
 *   - The Cline data root resolver (`resolveDataDirFromEnv`)
 *   - The identity-binding resolver (git HEAD + extension bundle SHA-256)
 *
 * The wiring is invoked exactly once at the extension-host activation
 * seam (sibling to the EHLOOP01 activation helper), and ONLY when
 * the profiler policy flipped to "armed".
 *
 * REMOVAL_TRIGGER: same as the policy module — once allocation
 * authority is classified A/B/C, this module + the profiler module
 * + the trigger call site + the focused tests + the analyzer script
 * MUST be removed TOGETHER.
 */

import { createHash } from "node:crypto"
import { mkdir, rename, writeFile } from "node:fs/promises"
import * as inspector from "node:inspector"
import * as path from "node:path"
import { ExtensionRegistryInfo } from "@/registry"
import { resolveDataDirFromEnv } from "@/shared/storage/storage-context"
import {
	type AllocationProfilerIdentityBinding,
	type AllocationProfilerInspectorSession,
	setAllocationProfilerDataRootResolver,
	setAllocationProfilerFilesystem,
	setAllocationProfilerIdentityResolver,
	setAllocationProfilerInspectorSessionFactory,
} from "./extension-host-allocation-profiler"

/**
 * Default inspector session factory: returns a thin adapter around
 * `node:inspector.Session`. The adapter narrows the public surface so
 * the capture loop can call `connect/disconnect/post/on` without
 * depending on the broader Inspector types.
 */
function defaultInspectorSessionFactory(): AllocationProfilerInspectorSession {
	const inner = new inspector.Session()
	return {
		connect(): void {
			inner.connect()
		},
		disconnect(): void {
			try {
				inner.disconnect()
			} catch {
				/* best-effort */
			}
		},
		post(method: string, params?: Record<string, unknown>): Promise<unknown> {
			return new Promise((resolve, reject) => {
				try {
					inner.post(method, params ?? {}, (error, result) => {
						if (error) {
							reject(error)
							return
						}
						resolve(result)
					})
				} catch (error) {
					reject(error)
				}
			})
		},
		on(event: "HeapProfiler.addHeapSnapshotChunk", listener: (chunk: unknown) => void): void {
			inner.on(event, listener)
		},
	}
}

/**
 * Default filesystem seam: real `node:fs/promises` operations.
 * Captured as a thin structural adapter so test code can stub it via
 * `setAllocationProfilerFilesystem`.
 */
const defaultFilesystem = {
	async mkdir(target: string, options: { recursive: boolean }): Promise<void> {
		await mkdir(target, options)
	},
	async rename(from: string, to: string): Promise<void> {
		await rename(from, to)
	},
	async writeFile(target: string, data: string): Promise<void> {
		await writeFile(target, data, "utf8")
	},
}

/**
 * Default data-root resolver: delegates to the shared
 * `resolveDataDirFromEnv()` (CLINE_DATA_DIR > CLINE_DIR+"/data" > ~/.cline/data).
 * The artifacts land at `<dataRoot>/diagnostics/allocation-authority/`.
 */
function defaultDataRootResolver(): string {
	return resolveDataDirFromEnv()
}

/**
 * Default identity resolver: hashes the installed `extension.js` to
 * produce a SHA-256 fingerprint that is bound to the capture artifact.
 *
 * IDENTITY POLICY (per HALT_ALLOCATION_FINALIZATION_BROKEN review P1c
 * and HALT_ALLOCATION_INSTALLED_BUNDLE_IDENTITY_PATH_UNPROVEN review):
 *   - `extensionBundleSha256` is the LOAD-BEARING identity. It is the
 *     authoritative fingerprint of the actual installed code that ran
 *     the host. Even when `source_head` is "unknown" (an installed
 *     VSIX has no `.git`), the capture is still qualifiable against
 *     the externally-recorded bundle SHA-256 binding.
 *   - `sourceHead` is INFORMATIONAL only. It is read from
 *     `git rev-parse HEAD` at wiring time. In an installed VSIX (no
 *     .git in extension dir) it WILL commonly be "unknown". Operators
 *     must record the build-time SOURCE_HEAD -> bundle SHA-256 binding
 *     externally (in build logs / the VSIX release manifest) before
 *     deploying.
 *
 * INSTALLED-LAYOUT CONTRACT (per HALT_ALLOCATION_INSTALLED_BUNDLE_IDENTITY_PATH_UNPROVEN):
 *   The bundle runtime `__dirname` is the directory that holds
 *   `extension.js`. In every supported layout (DEV
 *   `extensionDevelopmentPath` and installed VSIX), the bundle lives
 *   one level below the extension ROOT:
 *       <extension-root>/dist/extension.js     <- bundle
 *       <extension-root>/package.json
 *   So a SINGLE `..` ascent from `__dirname` lands on the extension
 *   root, which is where `dist/extension.js` must be read from.
 *
 *   The previous code's `path.resolve(__dirname, "..", "..")` walked
 *   TWO levels, which in a typical VSIX layout landed ABOVE the
 *   extension root and silently produced `installed_bundle_sha256 =
 *   "unknown"` — defeating the load-bearing invariant. The single
 *   ascent is correct for both DEV and VSIX layouts (verified
 *   mechanically — see ALLOCAUTH-IDENTITY-PATH-01).
 */
export function resolveInstalledBundleIdentity(bundleDirname: string): {
	sourceHead: string
	extensionPath: string
	extensionBundleSha256: string
} {
	let sourceHead = "unknown"
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const cp = require("node:child_process") as typeof import("node:child_process")
		sourceHead = cp
			.execSync("git rev-parse HEAD", {
				cwd: bundleDirname,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
			})
			.trim()
	} catch {
		sourceHead = "unknown"
	}

	// ONE ascent: <extension-root>/dist -> <extension-root>.
	const extensionPath = path.resolve(bundleDirname, "..")
	let extensionBundleSha256 = "unknown"
	try {
		const bundlePath = path.join(extensionPath, "dist", "extension.js")
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const fsSync = require("node:fs") as typeof import("node:fs")
		const buf = fsSync.readFileSync(bundlePath)
		extensionBundleSha256 = createHash("sha256").update(buf).digest("hex")
	} catch {
		extensionBundleSha256 = "unknown"
	}

	return {
		sourceHead,
		extensionPath,
		extensionBundleSha256,
	}
}

function defaultIdentityResolver(): AllocationProfilerIdentityBinding {
	const { sourceHead, extensionPath, extensionBundleSha256 } = resolveInstalledBundleIdentity(__dirname)
	return {
		sourceHead,
		version: ExtensionRegistryInfo.version,
		extensionPath,
		extensionBundleSha256,
	}
}

/**
 * THE single production wiring call. Invoked exactly once at
 * extension-host activation IF AND ONLY IF the profiler policy
 * flipped to "armed" (dogfood + CLINEMM_DIAG_ALLOCATION_PROFILE=1).
 *
 * Idempotent: subsequent calls are no-ops because the resolver
 * mutators simply overwrite the seams with the same factories.
 */
export function installExtensionHostAllocationProfilerRuntime(): void {
	setAllocationProfilerInspectorSessionFactory(defaultInspectorSessionFactory)
	setAllocationProfilerFilesystem(defaultFilesystem)
	setAllocationProfilerDataRootResolver(defaultDataRootResolver)
	setAllocationProfilerIdentityResolver(defaultIdentityResolver)
}
