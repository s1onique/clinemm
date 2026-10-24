/**
 * ACT-CLINEMM-MYC-REAL-WORKFLOW-AUTOCAPTURE01 — production wiring for the
 * automatic myc evaluation capture.
 *
 * This module owns the production-only seams that the pure recorder
 * (`myc-evaluation-capture.ts`) does NOT want to know about:
 *
 *   - `node:fs/promises` filesystem seam (real disk IO for the per-session
 *     JSONL event log, the summary, and the evaluation report),
 *   - the Cline data root resolver (`resolveDataDirFromEnv`),
 *   - the retention pruner (bounded number of session bundles).
 *
 * The wiring is invoked exactly ONCE at the extension-host activation
 * seam, SIBLING to the existing
 * `installMycPrimeLiveDiagReadoutRuntime` / BJLA / BOCOR / CCARD
 * activations.
 *
 * Path layout:
 *
 *   <dataRoot>/diagnostics/myc-evaluation/<session-id>/
 *       events.jsonl
 *       summary.json
 *       evaluation.md
 *
 * The subdirectory is created by the production writer on first use
 * (mkdir recursive, then appendFile); this module does NOT eagerly mkdir
 * at install time (the capture is dogfood-only, so eagerly materializing
 * an empty directory in a public install would be an invariant violation).
 *
 * WRITE FAILURE DISCIPLINE
 * ------------------------
 * A writer failure NEVER blocks execution and NEVER poisons the write
 * chain: every op is advanced through `.catch(() => undefined)`.
 */

import path from "node:path"
import { resolveDataDirFromEnv } from "@/shared/storage/storage-context"
import {
	isMycEvaluationCaptureEnabled,
	MYC_EVALUATION_CAPTURE_SUBDIR,
	MYC_EVALUATION_MAX_SESSION_BUNDLES,
	type MycEvaluationDataRootResolver,
	type MycEvaluationDirectoryLister,
	type MycEvaluationDirectoryPruner,
	type MycEvaluationFileWriter,
	type MycEvaluationWriter,
	resolveMycEvaluationReportPath,
	resolveMycEvaluationSummaryPath,
	setMycEvaluationDataRootResolver,
	setMycEvaluationDirectoryLister,
	setMycEvaluationDirectoryPruner,
	setMycEvaluationFileWriter,
	setMycEvaluationWriter,
} from "./myc-evaluation-capture"

/**
 * Serialized write chain. The pure module owns its own chain for the JSONL
 * event log; this chain is for the WHOLE-FILE writes (summary.json /
 * evaluation.md), which are checkpoints and must not interleave with each
 * other either.
 */
let fileWriteTail: Promise<void> = Promise.resolve()

/**
 * Default filesystem seam for the JSONL event sink. Production =
 * `node:fs/promises` `mkdir(parent, {recursive:true})` followed by
 * `appendFile(target, line)` (line-oriented JSONL).
 *
 * The writer is intentionally Promise-returning so the pure module can
 * dispatch it detached; the call site in the pure module does not await.
 * The Promise returned here is the actual op (so the caller's `.catch()`
 * still reports THIS write's failure); the module-level chain is advanced
 * to `op.catch(() => undefined)` so a single failure does not break the
 * chain for subsequent writes.
 *
 * mkdir is required because Node's appendFile does NOT create the parent
 * directory. Without it, a clean dogfood profile would silently produce
 * no evidence.
 */
const defaultWriter: MycEvaluationWriter = (target, line) => {
	const op = fileWriteTail
		.catch(() => undefined)
		.then(async () => {
			const fsPromises = await import("node:fs/promises")
			await fsPromises.mkdir(path.dirname(target), { recursive: true })
			await fsPromises.appendFile(target, line, "utf8")
		})
	fileWriteTail = op.catch(() => undefined)
	return op
}

/**
 * Default whole-file writer seam (summary.json / evaluation.md).
 *
 * Also serialized through `fileWriteTail` so two checkpoints for the same
 * session cannot interleave. mkdir -p first: the file writer may be the
 * FIRST thing that touches the session directory (e.g. a session whose
 * events were all dropped).
 */
const defaultFileWriter: MycEvaluationFileWriter = (target, contents) => {
	const op = fileWriteTail
		.catch(() => undefined)
		.then(async () => {
			const fsPromises = await import("node:fs/promises")
			await fsPromises.mkdir(path.dirname(target), { recursive: true })
			await fsPromises.writeFile(target, contents, "utf8")
		})
	fileWriteTail = op.catch(() => undefined)
	return op
}

/** Default retention pruner: `node:fs/promises#rm(dir, {recursive:true})`. */
const defaultDirectoryPruner: MycEvaluationDirectoryPruner = async (target) => {
	const fsPromises = await import("node:fs/promises")
	await fsPromises.rm(target, { recursive: true, force: true })
}

/**
 * Default retention lister: `node:fs/promises#readdir(dir, {withFileTypes})`
 * filtered to directories.
 */
const defaultDirectoryLister: MycEvaluationDirectoryLister = async (target) => {
	const fsPromises = await import("node:fs/promises")
	try {
		const entries = await fsPromises.readdir(target, { withFileTypes: true })
		return entries.filter((e) => e.isDirectory()).map((e) => e.name)
	} catch {
		return []
	}
}

/**
 * Default data-root resolver: `resolveDataDirFromEnv` is the production
 * authority for the Cline data directory. The pure module never imports
 * the resolver directly; it consumes the function via the seam setter.
 */
const defaultDataRootResolver: MycEvaluationDataRootResolver = () => resolveDataDirFromEnv()

/**
 * THE single production wiring call. Invoked exactly once at
 * extension-host activation, SIBLING to the existing
 * `installMycPrimeLiveDiagReadoutRuntime` activation.
 *
 * Idempotent: subsequent calls are no-ops because the resolver mutators
 * simply overwrite the seams with the same factories.
 *
 * NOTE: This function does NOT enable the capture. The host runtime is
 * responsible for calling `applyMycEvaluationCaptureProfile(...)` BEFORE
 * this function.
 */
export function installMycEvaluationCaptureRuntime(): void {
	setMycEvaluationDataRootResolver(defaultDataRootResolver)
	setMycEvaluationWriter(defaultWriter)
	setMycEvaluationFileWriter(defaultFileWriter)
	setMycEvaluationDirectoryPruner(defaultDirectoryPruner)
	setMycEvaluationDirectoryLister(defaultDirectoryLister)
}

/**
 * Prune the retained session bundles to the bounded maximum.
 *
 * Pruning is best-effort: a failure NEVER blocks execution and NEVER
 * removes evidence that is already written. The OLDEST bundles (by
 * modification time, falling back to lexicographic name order) are pruned
 * first.
 *
 * Returns the number of pruned bundle directories.
 */
export async function pruneMycEvaluationSessionBundles(
	dataRoot: string,
	maxBundles: number = MYC_EVALUATION_MAX_SESSION_BUNDLES,
): Promise<number> {
	if (!isMycEvaluationCaptureEnabled()) return 0
	if (maxBundles <= 0) return 0
	const fsPromises = await import("node:fs/promises")
	const root = path.join(dataRoot, MYC_EVALUATION_CAPTURE_SUBDIR)
	let names: string[]
	try {
		const entries = await fsPromises.readdir(root, { withFileTypes: true })
		names = entries.filter((e) => e.isDirectory()).map((e) => e.name)
	} catch {
		return 0
	}
	if (names.length <= maxBundles) return 0
	const stats = await Promise.all(
		names.map(async (name) => {
			try {
				const stat = await fsPromises.stat(path.join(root, name))
				return { name, mtime: stat.mtimeMs }
			} catch {
				return { name, mtime: 0 }
			}
		}),
	)
	stats.sort((a, b) => (a.mtime === b.mtime ? (a.name < b.name ? -1 : 1) : a.mtime - b.mtime))
	const excess = stats.slice(0, stats.length - maxBundles)
	let pruned = 0
	for (const entry of excess) {
		try {
			await fsPromises.rm(path.join(root, entry.name), { recursive: true, force: true })
			pruned++
		} catch {
			// Best-effort: a failed prune NEVER blocks execution.
		}
	}
	return pruned
}

/**
 * Resolve the absolute path of the per-session bundle directory.
 */
export function resolveMycEvaluationBundleDir(dataRoot: string, sessionId: string): string {
	return path.join(dataRoot, MYC_EVALUATION_CAPTURE_SUBDIR, sanitizeDirName(sessionId))
}

/**
 * Resolve the absolute path of the per-session summary file.
 */
export function resolveMycEvaluationSummaryFile(dataRoot: string, sessionId: string): string {
	return path.join(resolveMycEvaluationBundleDir(dataRoot, sessionId), "summary.json")
}

/**
 * Resolve the absolute path of the per-session evaluation report.
 */
export function resolveMycEvaluationReportFile(dataRoot: string, sessionId: string): string {
	return path.join(resolveMycEvaluationBundleDir(dataRoot, sessionId), "evaluation.md")
}

/**
 * Sanitize a session id for use as a directory name (mirrors the pure
 * module's sanitizer; kept local so the runtime module does not depend on
 * the pure module's internals beyond the public API).
 */
function sanitizeDirName(sessionId: string): string {
	const cleaned = sessionId.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "_")
	return cleaned.length > 0 ? cleaned.slice(0, 128) : "_"
}

/**
 * Resolve the summary/report paths through the PURE module (so the seam
 * resolver is honored consistently).
 */
export function resolveMycEvaluationCheckpointPaths(sessionId: string): {
	summaryPath?: string
	reportPath?: string
} {
	return {
		summaryPath: resolveMycEvaluationSummaryPath(sessionId),
		reportPath: resolveMycEvaluationReportPath(sessionId),
	}
}
