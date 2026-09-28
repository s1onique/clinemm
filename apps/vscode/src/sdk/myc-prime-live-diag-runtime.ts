/**
 * ACT-MYC-CLINEMM-PRIME-LIVE-DIAG-READOUT01
 *
 * Production wiring for the default-off JSONL readout sink added to
 * `myc-prime-live-diag.ts`. This module owns the production-only
 * seams that the pure module does NOT want to know about:
 *
 *   - `node:fs/promises` filesystem seam (real disk IO for the
 *     append-only JSONL events file).
 *   - The Cline data root resolver (`resolveDataDirFromEnv`).
 *
 * The wiring is invoked exactly ONCE at the extension-host
 * activation seam, SIBLING to the existing
 * `installExtensionHostTerminationAuthorityRuntime` / BJLA / BOCOR
 * / CCARD / M-runtime activations, and ONLY when the diagnostic is
 * enabled (see `applyMycPrimeLiveDiagDiagnosticProfile`).
 *
 * The path layout (mirrors the termination-authority convention):
 *
 *   <dataRoot>/diagnostics/myc-prime-live-diag/events.jsonl
 *
 * Where `<dataRoot>` is `resolveDataDirFromEnv()`. The subdir is
 * created lazily by the first `appendFile` call; this module does
 * NOT eagerly mkdir (the diagnostic is default-off, so eagerly
 * materializing an empty directory in production would be an
 * invariant violation).
 *
 * REMOVAL TRIGGER (per ACT removal rules): the readout sink is a
 * bounded forensic scaffolding. When telemetry later wants any of
 * these counters, redesign them under ACT-MYC-CLINEMM-TELEMETRY01
 * — do NOT silently promote this sink into product telemetry.
 */

import { resolveDataDirFromEnv } from "@/shared/storage/storage-context"
import {
	type MycPrimeLiveDiagReadoutDataRootResolver,
	type MycPrimeLiveDiagReadoutWriter,
	setMycPrimeLiveDiagReadoutDataRootResolver,
	setMycPrimeLiveDiagReadoutWriter,
} from "./myc-prime-live-diag"

/**
 * Default filesystem seam for the readout JSONL sink. Production =
 * `node:fs/promises` `appendFile` (line-oriented JSONL). The writer
 * is intentionally Promise-returning so the pure module can dispatch
 * it detached; the call site in `myc-prime-live-diag.ts` does not
 * await the Promise.
 */
const defaultWriter: MycPrimeLiveDiagReadoutWriter = async (target, line) => {
	const fsPromises = await import("node:fs/promises")
	await fsPromises.appendFile(target, line, "utf8")
}

/**
 * Default data-root resolver: `resolveDataDirFromEnv` is the
 * production authority for the Cline data directory. The pure
 * module never imports the resolver directly; it consumes the
 * function via the seam setter.
 */
const defaultDataRootResolver: MycPrimeLiveDiagReadoutDataRootResolver = () => resolveDataDirFromEnv()

/**
 * THE single production wiring call. Invoked exactly once at
 * extension-host activation, SIBLING to the existing
 * `installExtensionHostTerminationAuthorityRuntime` activation,
 * AND ONLY when the diagnostic is enabled (the host runtime
 * reads `isMycPrimeLiveDiagEnabled()` first to gate the call).
 *
 * Idempotent: subsequent calls are no-ops because the resolver
 * mutators simply overwrite the seams with the same factories.
 *
 * NOTE: This function does NOT enable the diagnostic. The host
 * runtime is responsible for calling
 * `applyMycPrimeLiveDiagDiagnosticProfile(...)` BEFORE this
 * function. If the diagnostic is OFF when the recorders fire,
 * the readout seams are bound but `appendReadoutLine(...)` will
 * short-circuit on `isMycPrimeLiveDiagEnabled()` regardless.
 *
 * In production the two helpers are always called back-to-back
 * from `extension.ts:activate` so the readout seams are present
 * exactly when needed. The single-use gate is the diagnostic
 * enablement boolean, NOT this wiring call.
 */
export function installMycPrimeLiveDiagReadoutRuntime(): void {
	setMycPrimeLiveDiagReadoutDataRootResolver(defaultDataRootResolver)
	setMycPrimeLiveDiagReadoutWriter(defaultWriter)
}
