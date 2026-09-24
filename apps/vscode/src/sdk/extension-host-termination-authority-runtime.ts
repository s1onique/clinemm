/**
 * ACT-CLINEMM-EXTENSION-HOST-TERMINATION-AUTHORITY01
 *
 * Production wiring for the Extension Host termination witness. This
 * module owns the production-only seams that the pure module
 * (`./extension-host-termination-authority.ts`) does NOT want to know
 * about:
 *
 *   - `node:fs/promises` filesystem seam (real disk IO for the
 *     in-process host-self event append)
 *   - The Cline data root resolver (`resolveDataDirFromEnv`)
 *   - Parent-side lifecycle observer entrypoint (writes operator-composed
 *     parent JSON into the capture dir)
 *   - The macOS crash-report summarizer (collapses a fresh macOS
 *     DiagnosticReport into a bounded JSON summary inside the capture dir)
 *
 * The wiring is invoked exactly ONCE at the extension-host
 * activation seam, sibling to the ALLOCAUTH01 / CPUCAP01 helpers.
 *
 * RETAIN_AS_DIAGNOSTIC: per the operator's directive accompanying
 * this ACT, this runtime module + the pure module + the env knob +
 * the focused tests + the analyzer script MAY stay in the tree as a
 * labeled diagnostic substrate once termination authority is
 * classified TA1..TA4.
 */

import { createRequire } from "node:module"
import { ExtensionRegistryInfo } from "@/registry"
import { resolveDataDirFromEnv } from "@/shared/storage/storage-context"
import {
	setTerminationAuthorityDataRootResolver,
	setTerminationAuthorityWriter,
	type TerminationAuthorityDataRootResolver,
	type TerminationAuthorityWriter,
} from "./extension-host-termination-authority"

/**
 * Default filesystem seam for the in-process witness. Production =
 * `node:fs/promises` `appendFile` (line-oriented JSONL).
 */
const defaultWriter: TerminationAuthorityWriter = async (target, line) => {
	const fsPromises = await import("node:fs/promises")
	await fsPromises.appendFile(target, line, "utf8")
}

/**
 * Default data-root resolver: `resolveDataDirFromEnv` is the
 * production authority for the Cline data directory.
 */
const defaultDataRootResolver: TerminationAuthorityDataRootResolver = () => resolveDataDirFromEnv()

/**
 * Read the install path / SHA of the extension bundle. We re-use
 * the resolver from the CPU profiler / allocation profiler runtime.
 */
function installIdentityHint(): { extensionPath: string; extensionBundleSha256: string } {
	try {
		// Resolve relative to our bundled __dirname. The CPU profiler
		// runtime exposes this; we import lazily to avoid a circular
		// dependency at module-evaluation time.
		const requireFromHere = createRequire(__dirname)
		const mod = requireFromHere("./extension-host-allocation-profiler-runtime") as {
			resolveInstalledBundleIdentity: (bundleDirname: string) => {
				extensionPath: string
				extensionBundleSha256: string
			}
		}
		const id = mod.resolveInstalledBundleIdentity(__dirname)
		return { extensionPath: id.extensionPath, extensionBundleSha256: id.extensionBundleSha256 }
	} catch {
		return { extensionPath: __dirname, extensionBundleSha256: "unknown" }
	}
}

export function getExtensionHostTerminationAuthorityVersion(): string {
	return ExtensionRegistryInfo.version
}

export function getExtensionHostTerminationAuthorityBundleDir(): string {
	return installIdentityHint().extensionPath
}

export function getExtensionHostTerminationAuthorityBundleSha256(): string {
	return installIdentityHint().extensionBundleSha256
}

/**
 * THE single production wiring call. Invoked exactly once at
 * extension-host activation IF AND ONLY IF the witness policy
 * flipped to "armed" (dogfood + CLINEMM_DIAG_TERMINATION_AUTHORITY=1).
 *
 * Idempotent: subsequent calls are no-ops because the resolver
 * mutators simply overwrite the seams with the same factories.
 */
export function installExtensionHostTerminationAuthorityRuntime(): void {
	setTerminationAuthorityDataRootResolver(defaultDataRootResolver)
	setTerminationAuthorityWriter(defaultWriter)
}

/**
 * Best-effort parent-side lifecycle writer. We do NOT poll the host
 * PID from inside this module -- polling is intentionally external
 * so the in-process host can never perturb the witness (Node's
 * `process.cpuUsage()`/`process.memoryUsage()` are synchronous and
 * would be observable from the witness itself).
 *
 * The operator runs a parent-process-observation script externally
 * before/after the workload (e.g. via `ps` / `proc_pidinfo`-style
 * sampling on macOS, or via `/proc/<pid>/status` on Linux). The
 * sampled JSON is fed into this function which writes it into the
 * capture dir for the analyzer to merge with the host-self events.
 *
 * Default captureDir convention (mirrors the in-process witness):
 *
 *   <dataRoot>/diagnostics/termination-authority/capture-<id>/
 *       meta.json
 *       host-self-events.jsonl
 *       parent-lifecycle.json     <-- written by this function
 *       macos-crash-report-summary.json  <-- written by writeCrashReportSummary
 *       verdict.json
 */
export async function writeParentLifecycle(captureId: string, parentLifecycle: unknown): Promise<{ captureDir: string }> {
	const fsPromises = await import("node:fs/promises")
	const captureDir = `${defaultDataRootResolver()}/diagnostics/termination-authority/capture-${captureId}`
	await fsPromises.mkdir(captureDir, { recursive: true })
	await fsPromises.writeFile(`${captureDir}/parent-lifecycle.json`, JSON.stringify(parentLifecycle, null, 2), "utf8")
	return { captureDir }
}

/**
 * Best-effort macOS crash report summarizer entrypoint. We do NOT
 * copy the full report into the capture dir (too large); we
 * collapse to a bounded JSON summary (process_name, pid,
 * exception_type, termination_reason, termination_namespace,
 * signal, crashed_thread, top_native_frames[]).
 *
 * If parsing fails (e.g. the report is truncated or non-IPS), we
 * still write a bounded error summary to the capture dir so the
 * analyzer can record WHY we couldn't classify.
 */
export async function writeCrashReportSummary(
	captureId: string,
	reportPath: string,
): Promise<{ ok: boolean; reason?: string; captureDir: string }> {
	const fsPromises = await import("node:fs/promises")
	const captureDir = `${defaultDataRootResolver()}/diagnostics/termination-authority/capture-${captureId}`
	try {
		await fsPromises.mkdir(captureDir, { recursive: true })
		const buf = await fsPromises.readFile(reportPath, "utf8")
		const summary = summarizeMacosDiagnosticReport(buf)
		await fsPromises.writeFile(`${captureDir}/macos-crash-report-summary.json`, JSON.stringify(summary, null, 2), "utf8")
		return { ok: true, captureDir }
	} catch (err) {
		const reason = err instanceof Error ? err.message : String(err)
		try {
			await fsPromises.mkdir(captureDir, { recursive: true })
			await fsPromises.writeFile(
				`${captureDir}/macos-crash-report-summary.json`,
				JSON.stringify(
					{
						ok: false,
						report_path: reportPath,
						reason,
						parsed_at: new Date().toISOString(),
					},
					null,
					2,
				),
				"utf8",
			)
		} catch {
			/* no-op */
		}
		return { ok: false, reason, captureDir }
	}
}

/**
 * Bounded collapse of a macOS DiagnosticReport (Apple's IPS / Crash
 * format) into a structured summary. The format is loosely:
 *
 *   Process:              <name> [<pid>]
 *   Path:                 <path>
 *   Identifier:           <bundle id>
 *   Version:              <version>
 *   Code Type:            <arch>
 *   Date/Time:            <timestamp>
 *   OS Version:           <macOS version>
 *   Exception Type:       EXC_BAD_ACCESS / EXC_CRASH / SIGSEGV ...
 *   Exception Codes:      <hex>
 *   Termination Reason:   Namespace <NS>, Code <N> ...
 *   ...
 *   Thread N Crashed:
 *     N   <lib>   <offset> <symbol>
 *
 * We only retain the load-bearing fields; the rest is discarded.
 * Pure function -- fully exercised by tests.
 */
export function summarizeMacosDiagnosticReport(raw: string): {
	ok: boolean
	report_bytes_read: number
	summary_bytes_written: number
	process_name: string | null
	pid: number | null
	identifier: string | null
	exception_type: string | null
	termination_reason: string | null
	termination_namespace: string | null
	signal: string | null
	crashed_thread_index: number | null
	top_native_frames: string[]
	parsed_at: string
} {
	const lines = raw.split("\n").slice(0, 500) // cap lines
	const summary = {
		ok: true,
		report_bytes_read: raw.length,
		summary_bytes_written: 0,
		process_name: null as string | null,
		pid: null as number | null,
		identifier: null as string | null,
		exception_type: null as string | null,
		termination_reason: null as string | null,
		termination_namespace: null as string | null,
		signal: null as string | null,
		crashed_thread_index: null as number | null,
		top_native_frames: [] as string[],
		parsed_at: new Date().toISOString(),
	}

	let inStack = false
	let framesLeft = 8
	for (const line of lines) {
		// Process:    name [pid]
		const processMatch = /^Process:\s+(\S+)\s+\[(\d+)\]/.exec(line)
		if (processMatch) {
			summary.process_name = processMatch[1]
			summary.pid = Number(processMatch[2])
		}
		// Identifier:  bundleId
		const identMatch = /^Identifier:\s+(.*)$/.exec(line)
		if (identMatch) {
			summary.identifier = identMatch[1].trim()
		}
		// Exception Type:  EXC_BAD_ACCESS (code)
		const excMatch = /^Exception Type:\s+(.*)$/.exec(line)
		if (excMatch) {
			summary.exception_type = excMatch[1].trim()
		}
		// Termination Reason: Namespace <NS>, Code <N> <rest>
		const termMatch = /^Termination Reason:\s+(.*)$/.exec(line)
		if (termMatch) {
			summary.termination_reason = termMatch[1].trim()
			const nsMatch = /Namespace\s+(\S+)/.exec(summary.termination_reason)
			if (nsMatch) summary.termination_namespace = nsMatch[1]
			const codeMatch = /Code\s+(\d+)/.exec(summary.termination_reason)
			if (codeMatch) summary.signal = `code_${codeMatch[1]}`
		}
		// Thread N Crashed:
		const threadMatch = /^Thread\s+(\d+)\s+Crashed:/.exec(line)
		if (threadMatch) {
			summary.crashed_thread_index = Number(threadMatch[1])
			inStack = true
			framesLeft = 8
			continue
		}
		// End of stack: empty line or new section heading
		if (inStack && /^\s*$/.test(line)) {
			inStack = false
		} else if (inStack && framesLeft > 0) {
			const trimmed = line.trim()
			if (trimmed.length > 0) {
				summary.top_native_frames.push(trimmed)
				framesLeft -= 1
			}
		}
	}
	const serialized = JSON.stringify(summary, null, 2)
	summary.summary_bytes_written = serialized.length
	return summary
}

/**
 * Atomic helper: write a JSON file by temp-then-rename. Used by the
 * in-process witness's exit-flush path. Pure wrapper around the
 * node:fs/promises primitives so tests can stub it if needed.
 */
export async function writeJsonAtomic(target: string, payload: unknown): Promise<void> {
	const fsPromises = await import("node:fs/promises")
	const tmp = `${target}.tmp`
	await fsPromises.writeFile(tmp, JSON.stringify(payload, null, 2), "utf8")
	await fsPromises.rename(tmp, target)
}
