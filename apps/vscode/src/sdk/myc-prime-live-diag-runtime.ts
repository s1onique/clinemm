/**
 * ACT-MYC-CLINEMM-PRIME-LIVE-DIAG-READOUT01 (CORRECTION01, CORRECTION02)
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
 * Where `<dataRoot>` is `resolveDataDirFromEnv()`. The diagnostic
 * subdirectory `diagnostics/myc-prime-live-diag/` is created by the
 * production writer on first use (mkdir recursive, then appendFile);
 * this module does NOT eagerly mkdir at install time (the diagnostic
 * is default-off, so eagerly materializing an empty directory in
 * production would be an invariant violation).
 *
 * CORRECTION01 (P0 readout-parent-dir): the original writer was
 * `appendFile(target, line)` only. Node's `appendFile` creates the
 * FILE if missing but does NOT create the parent directory; on a
 * clean dogfood profile where the subdir does not exist yet, the
 * first append would reject with ENOENT. The detached `.catch`
 * correctly prevented semantic damage, but the sink would silently
 * produce no evidence — straight back to CAPTURE_INSUFFICIENT.
 * The fix: mkdir(parent, {recursive: true}) BEFORE appendFile. The
 * call site in `myc-prime-live-diag.ts` does not await the writer
 * Promise either before or after this fix, so `beforeModel` is
 * never blocked; the failure mode is identical (rejected Promise
 * reaches the warn seam).
 *
 * CORRECTION02 (P0 concurrent-append): the detached dispatch
 * pattern means six recorders (BIND, ENTER, ACQUISITION, LOOKUP,
 * INJECTION, CAPTURE) can fire in the same microtask burst and
 * each invoke `appendFile` against the same `events.jsonl`. Node's
 * `fs/promises` operations run on the libuv thread pool and are
 * NOT synchronized/threadsafe; concurrent appends can interleave
 * or produce torn JSONL lines. The diagnostic is supposed to be
 * load-bearing causal evidence for the §17 boundary classifier,
 * so this is a real integrity problem. The fix: serialize the
 * production writer through a module-level `writeTail: Promise<void>`
 * chain. Each new op is enqueued via `.then`; the chain is
 * advanced through `.catch(() => undefined)` so a single failed
 * write does NOT poison subsequent evidence. The Promise returned
 * by the writer is the actual op, so the call site's existing
 * `.catch()` still reports this write's failure to the warn seam.
 * The call site itself is unchanged: `void writer(target, line).catch(...)`,
 * the call site does not await, and `beforeModel` is never blocked.
 *
 * REMOVAL TRIGGER (per ACT removal rules): the readout sink is a
 * bounded forensic scaffolding. When telemetry later wants any of
 * these counters, redesign them under ACT-MYC-CLINEMM-TELEMETRY01
 * — do NOT silently promote this sink into product telemetry.
 */

import path from "node:path"
import { resolveDataDirFromEnv } from "@/shared/storage/storage-context"
import {
	type MycPrimeLiveDiagReadoutDataRootResolver,
	type MycPrimeLiveDiagReadoutWriter,
	setMycPrimeLiveDiagReadoutDataRootResolver,
	setMycPrimeLiveDiagReadoutWriter,
} from "./myc-prime-live-diag"

/**
 * Module-level FIFO chain that serializes all defaultWriter
 * invocations. The diagnostic is load-bearing causal evidence
 * for the §17 boundary classifier, so the six recorders'
 * detached writes must appear in the JSONL in exactly the
 * order they were dispatched, with no interleaved bytes.
 *
 * Node's `fs/promises` operations run on the libuv thread
 * pool and are NOT synchronized/threadsafe; two concurrent
 * `appendFile` calls against the same path can interleave or
 * produce torn lines. We chain them via a `then` tail so each
 * operation only begins after the previous one has settled.
 *
 * The chain is advanced through `.catch(() => undefined)` so a
 * single failed write does NOT poison all later evidence —
 * DLR-07.b proves this.
 *
 * CORRECTION02: this queue lives ONLY in the production
 * runtime file. The pure module's `appendReadoutLine` is
 * unchanged: it still calls `void writer(target, line).catch(...)`,
 * the call site still does not await, and `beforeModel` is
 * never blocked.
 */
let writeTail: Promise<void> = Promise.resolve()

/**
 * Default filesystem seam for the readout JSONL sink. Production =
 * `node:fs/promises` `mkdir(parent, {recursive:true})` followed by
 * `appendFile(target, line)` (line-oriented JSONL).
 *
 * The writer is intentionally Promise-returning so the pure module
 * can dispatch it detached; the call site in `myc-prime-live-diag.ts`
 * does not await the Promise. The Promise returned here is the
 * actual op (so the caller's `.catch()` still reports THIS write's
 * failure through the warn seam); the module-level `writeTail` is
 * advanced to `op.catch(() => undefined)` so a single failure does
 * not break the chain for subsequent writes.
 *
 * CORRECTION01: mkdir is required because Node's appendFile does
 * NOT create the parent directory. Without it, a clean dogfood
 * profile would silently produce no evidence.
 *
 * CORRECTION02: appendFile calls are serialized through `writeTail`.
 * Without this, six concurrent appendFile calls against the same
 * path can interleave on the libuv thread pool and produce torn
 * JSONL lines — DLR-07.a proves the serialized case holds; DLR-07.b
 * proves a failed write does not poison the chain.
 */
const defaultWriter: MycPrimeLiveDiagReadoutWriter = (target, line) => {
	const op = writeTail
		.catch(() => undefined)
		.then(async () => {
			const fsPromises = await import("node:fs/promises")
			await fsPromises.mkdir(path.dirname(target), { recursive: true })
			await fsPromises.appendFile(target, line, "utf8")
		})
	// Advance the chain through `.catch(() => undefined)` so a
	// single failed op does not poison subsequent evidence.
	writeTail = op.catch(() => undefined)
	// Return the actual op so the call site's existing
	// `.catch((err) => _readoutWarn(...))` still reports this
	// write's failure through the warn seam.
	return op
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
