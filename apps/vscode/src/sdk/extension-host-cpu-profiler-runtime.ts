/**
 * ACT-CLINEMM-EXTENSION-HOST-CONTINUOUS-CPU-SAMPLING01
 *
 * Production wiring for the rolling V8 CPU profiler. This module
 * owns the production-only seams that the pure module
 * (`./extension-host-cpu-profiler.ts`) does NOT want to know about:
 *
 *   - `node:inspector` Session factory (the real Inspector backend)
 *   - `node:fs/promises` filesystem seam (real disk IO)
 *   - The Cline data root resolver (`resolveDataDirFromEnv`)
 *   - The identity-binding resolver (git HEAD + extension bundle SHA-256)
 *
 * The wiring is invoked exactly once at the extension-host activation
 * seam (sibling to the ALLOCAUTH01 activation helper), and ONLY when
 * the profiler policy flipped to "armed".
 *
 * REMOVAL_TRIGGER (SUPERSEDED per ACT-CLINEMM-EXTENSION-HOST-TERMINATION-AUTHORITY01
 * operator directive, 2026-09-24): The original REMOVAL_TRIGGER said
 * the CPU profiler would be removed once CP1..CP5 was classified.
 * The operator has now overridden that policy: the CPU profiler is
 * RETAINED as a diagnostic substrate even after CP5 classification,
 * because re-arming it on demand is cheaper than re-deriving its
 * production seams. The runtime module MAY stay in the tree as a
 * labeled diagnostic substrate once CPU authority is classified
 * CP1..CP4, OR CAPTURE_INSUFFICIENT, OR
 * HALT_CPU_PROFILER_PERTURBATION_TOO_HIGH. Removal now requires an
 * explicit bounded-removal ACT. The other seams (inspector session,
 * fs/promises, data-root resolver, identity binding) remain bound.
 */

import { mkdir, rename, writeFile } from "node:fs/promises"
import * as inspector from "node:inspector"
import { ExtensionRegistryInfo } from "@/registry"
import { resolveDataDirFromEnv } from "@/shared/storage/storage-context"
import { resolveInstalledBundleIdentity } from "./extension-host-allocation-profiler-runtime"
import {
	type CpuProfilerFilesystem,
	type CpuProfilerIdentityBinding,
	type CpuProfilerInspectorSession,
	setCpuProfilerDataRootResolver,
	setCpuProfilerFilesystem,
	setCpuProfilerIdentityResolver,
	setCpuProfilerInspectorSessionFactory,
} from "./extension-host-cpu-profiler"

/**
 * Default inspector session factory: returns a thin adapter around
 * `node:inspector.Session`. The adapter narrows the public surface so
 * the capture loop can call `connect/disconnect/post` without depending
 * on the broader Inspector types.
 */
function defaultInspectorSessionFactory(): CpuProfilerInspectorSession {
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
	}
}

/**
 * Default filesystem seam: real `node:fs/promises` operations.
 * Captured as a thin structural adapter so test code can stub it via
 * `setCpuProfilerFilesystem`.
 */
const defaultFilesystem: CpuProfilerFilesystem = {
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
 * Default data-root resolver: `resolveDataDirFromEnv` is the production
 * authority for the Cline data directory.
 */
const defaultDataRootResolver = (): string => resolveDataDirFromEnv()

function defaultIdentityResolver(): CpuProfilerIdentityBinding {
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
 * extension-host activation IF AND ONLY IF the profiler policy flipped
 * to "armed" (dogfood + CLINEMM_DIAG_CPU_PROFILE=1).
 *
 * Idempotent: subsequent calls are no-ops because the resolver
 * mutators simply overwrite the seams with the same factories.
 */
export function installExtensionHostCpuProfilerRuntime(): void {
	setCpuProfilerInspectorSessionFactory(defaultInspectorSessionFactory)
	setCpuProfilerFilesystem(defaultFilesystem)
	setCpuProfilerDataRootResolver(defaultDataRootResolver)
	setCpuProfilerIdentityResolver(defaultIdentityResolver)
}
