#!/usr/bin/env node
/**
 * ACT-CLINEMM-EXTENSION-HOST-TERMINATION-LIVE-CLASSIFICATION01
 *
 * External lifecycle observer for the VS Code / VSCodium Extension
 * Host process. Runs OUTSIDE the Extension Host (Node process, not
 * bound to the host) and writes the load-bearing external witness
 * for the termination-authority classifier.
 *
 * ACT §6 mandates that the witness be EXTERNAL — polling a PID
 * from inside the host cannot survive a SIGKILL or any hard-death
 * mode (Node docs: an external monitor is recommended when reliable
 * detection of process failure is required). The witness is also
 * the only way to obtain the affirmative negative witness
 * (parent-lifecycle.json schema_version=1, with
 * observation_window_started/completed and
 * extension_host_started/terminated/restarted) required for a TA6
 * classification.
 *
 * USAGE
 *
 *   node scripts/capture-extension-host-lifecycle.mjs \
 *        --capture-id <id> \
 *        [--cadence-ms 400] \
 *        [--duration-ms 60000] \
 *        [--pid <hostPid>]
 *
 *   # --capture-id selects the capture dir under
 *   #   <CLINE_DATA_DIR>/diagnostics/termination-authority/capture-<id>/
 *   # The output file is `parent-lifecycle.json` (schema_version=1).
 *
 *   # When the original Extension Host PID disappears AND a new
 *   # helper PID with the same role appears, the script records
 *   # extension_host_terminated=true + extension_host_restarted=true
 *   # + restart_pid + restart_at. Without an explicit authority
 *   # (parent or watchdog), the analyzer will classify this as TA5
 *   # CAPTURE_INSUFFICIENT — the correct conservative outcome.
 *
 *   # When the observation window completes WITHOUT a death, the
 *   # script records extension_host_terminated=false,
 *   # extension_host_restarted=false — the affirmative negative
 *   # witness required for TA6 NOT_REPRODUCED.
 *
 * OUTPUT (parent-lifecycle.json) — schema_version 1.
 *
 *   {
 *     schema_version: 1,
 *     observation_window_started_at: ISO timestamp,
 *     observation_window_completed_at: ISO timestamp | null,
 *     observation_window_completed: boolean,
 *     extension_host_pid: number,
 *     extension_host_started_at: ISO timestamp | null,
 *     unresponsive_observed: boolean,
 *     unresponsive_at: ISO timestamp | null,
 *     extension_host_terminated: boolean,
 *     terminated_at: ISO timestamp | null,
 *     exit_code: number | null,
 *     signal: string | null,
 *     process_gone_reason: string | null,
 *     extension_host_restarted: boolean,
 *     restart_pid: number | null,
 *     restart_at: ISO timestamp | null,
 *     samples: [ ... ],
 *   }
 *
 * Unknown fields remain null. Signal is NOT inferred from exit
 * code (Node + POSIX semantics forbid that mapping; the analyzer
 * preserves this discipline).
 *
 * This script NEVER inspects the in-process witness's files. It
 * never opens the Extension Host. It never modifies the host. It
 * only reads the kernel's process table.
 */

import { execFile } from "node:child_process"
import { mkdir, writeFile, rename } from "node:fs/promises"
import { promisify } from "node:util"
import { join, resolve } from "node:path"

const execFileP = promisify(execFile)

const SCHEMA_VERSION = 1
const DEFAULT_CADENCE_MS = 400
const DEFAULT_DURATION_MS = 60_000
const MAX_SAMPLES = 2048

// ---------- arg parsing ----------

function parseArgs(argv) {
	const out = {
		captureId: undefined,
		cadenceMs: DEFAULT_CADENCE_MS,
		durationMs: DEFAULT_DURATION_MS,
		pid: undefined,
		dataDir: process.env.CLINE_DATA_DIR || undefined,
		help: false,
	}
	const args = argv.slice(2)
	for (let i = 0; i < args.length; i++) {
		const a = args[i]
		switch (a) {
			case "--capture-id":
				out.captureId = args[++i]
				break
			case "--cadence-ms":
				out.cadenceMs = Number(args[++i]) || DEFAULT_CADENCE_MS
				break
			case "--duration-ms":
				out.durationMs = Number(args[++i]) || DEFAULT_DURATION_MS
				break
			case "--pid":
				out.pid = Number(args[++i])
				break
			case "--data-dir":
				out.dataDir = args[++i]
				break
			case "--help":
			case "-h":
				out.help = true
				break
			default:
				process.stderr.write(`unknown arg: ${a}\n`)
				process.exit(4)
		}
	}
	return out
}

function usage() {
	process.stderr.write(
		"usage: capture-extension-host-lifecycle.mjs --capture-id <id> [options]\n" +
			"  --capture-id <id>      REQUIRED capture id (the dir under <dataDir>/diagnostics/termination-authority/capture-<id>/)\n" +
			"  --pid <pid>            Extension Host PID to observe (default: locate by ps)\n" +
			"  --cadence-ms <ms>      polling cadence (default 400)\n" +
			"  --duration-ms <ms>     observation window length (default 60000)\n" +
			"  --data-dir <path>      CLINE_DATA_DIR override (default: env CLINE_DATA_DIR)\n",
	)
}


// ---------- platform-specific sampler ----------

async function sampleProcess(pid) {
	// Returns { alive, rss_bytes, cpu_pct, thread_count, ppid, command }
	// OR null if ps failed for a non-ENOENT reason. Caller treats
	// null as "unknown" — the PID is then assumed DEAD on the next
	// sample (we never claim unknown).
	try {
		if (process.platform === "darwin") {
			// macOS: `ps -p <pid> -o pid,ppid,pcpu,command`
			// Note: `rss` requires an entitlement that sandboxed
			// shells lack; we omit it on macOS and accept rss=null.
			const { stdout } = await execFileP("ps", [
				"-p",
				String(pid),
				"-o",
				"pid=,ppid=,pcpu=,command=",
			])
			const line = stdout.trim()
			if (line.length === 0) {
				return { alive: false, rss_bytes: null, cpu_pct: null, thread_count: null, ppid: null, command: null }
			}
			// Parse: leading pid, then fields separated by spaces. The
			// command is the rest of the line (may include spaces).
			const m = /^(\d+)\s+(\d+)\s+([\d.]+)\s+(.*)$/.exec(line)
			if (!m) {
				return { alive: true, rss_bytes: null, cpu_pct: null, thread_count: null, ppid: null, command: line }
			}
			return {
				alive: true,
				rss_bytes: null, // unavailable without entitlement on macOS
				cpu_pct: Number(m[3]),
				thread_count: null,
				ppid: Number(m[2]),
				command: m[4],
			}
		}
		if (process.platform === "linux") {
			const { stdout } = await execFileP("ps", [
				"-p",
				String(pid),
				"-o",
				"pid=,ppid=,rss=,pcpu=,nthread=,comm=",
			])
			const line = stdout.trim()
			if (line.length === 0) {
				return { alive: false, rss_bytes: null, cpu_pct: null, thread_count: null, ppid: null, command: null }
			}
			const m = /^(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(.*)$/.exec(line)
			if (!m) {
				return { alive: true, rss_bytes: null, cpu_pct: null, thread_count: null, ppid: null, command: line }
			}
			return {
				alive: true,
				rss_bytes: Number(m[3]) * 1024,
				cpu_pct: Number(m[4]),
				thread_count: Number(m[5]),
				ppid: Number(m[2]),
				command: m[6],
			}
		}
		// Fallback: try the same ps invocation but treat loosely.
		const { stdout } = await execFileP("ps", ["-p", String(pid)])
		const line = stdout.trim()
		if (line.length === 0) {
			return { alive: false, rss_bytes: null, cpu_pct: null, thread_count: null, ppid: null, command: null }
		}
		return { alive: true, rss_bytes: null, cpu_pct: null, thread_count: null, ppid: null, command: line }
	} catch (err) {
		// ps exits 1 for missing PIDs. execFile rejects on non-zero
		// exit; treat exit-code-1 as "process gone". Other errors
		// return null (caller treats unknown as dead on next sample).
		const code = err && typeof err === "object" && "code" in err ? err.code : null
		if (code === 1) {
			return { alive: false, rss_bytes: null, cpu_pct: null, thread_count: null, ppid: null, command: null }
		}
		return null
	}
}

async function locateExtensionHostPid() {
	// Returns { pid, command } for the most-recently started process
	// whose command line mentions "extension" / "extensionHost" /
	// "Extension Host".
	if (process.platform === "darwin") {
		try {
			const { stdout } = await execFileP("ps", ["-A", "-o", "pid=,command="])
			const candidates = stdout
				.split("\n")
				.map((l) => l.trim())
				.filter((l) => l.length > 0)
				.map((l) => {
					const m = /^(\d+)\s+(.*)$/.exec(l)
					return m ? { pid: Number(m[1]), command: m[2] } : null
				})
				.filter((x) => x && /(extension[ _-]?host|extensionhost)/i.test(x.command))
			if (candidates.length > 0) {
				// Highest PID is the most-recently-spawned (monotonic).
				candidates.sort((a, b) => b.pid - a.pid)
				return candidates[0]
			}
		} catch {
			/* fallthrough */
		}
	}
	// Fallback: child of current process whose command mentions "extension".
	try {
		const ourPid = process.pid
		const { stdout } = await execFileP("pgrep", ["-P", String(ourPid), "-l"])
		const lines = stdout.split("\n").map((l) => l.trim()).filter((l) => l.length > 0)
		for (const line of lines.reverse()) {
			if (/extension/i.test(line)) {
				const m = /^(\d+)\s+(.*)$/.exec(line)
				if (m) return { pid: Number(m[1]), command: m[2] }
			}
		}
	} catch {
		/* fallthrough */
	}
	return null
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

async function writePayloadAtomic(target, payload) {
	const tmp = `${target}.tmp`
	await writeFile(tmp, JSON.stringify(payload, null, 2), "utf8")
	await rename(tmp, target)
}

async function resolveCaptureDir(opts) {
	const dataDir = opts.dataDir
	if (!dataDir) {
		throw new Error(
			"CLINE_DATA_DIR (or --data-dir) is required to locate the capture dir.\n" +
				"Default on dogfood is ~/.cline/data or the value of CLINE_DATA_DIR.",
		)
	}
	if (!opts.captureId) {
		throw new Error("--capture-id <id> is required")
	}
	return resolve(join(dataDir, "diagnostics", "termination-authority", `capture-${opts.captureId}`))
}

async function main() {
	const opts = parseArgs(process.argv)
	if (opts.help) {
		usage()
		process.exit(0)
	}

	let originalPid = opts.pid
	if (!originalPid) {
		const located = await locateExtensionHostPid()
		if (!located) {
			process.stderr.write("could not locate Extension Host PID; pass --pid explicitly\n")
			process.exit(4)
		}
		originalPid = located.pid
		process.stderr.write(`located Extension Host PID=${originalPid} command=${JSON.stringify(located.command)}\n`)
	}
	if (!originalPid) {
		process.stderr.write("no PID resolved; aborting\n")
		process.exit(4)
	}

	const captureDir = await resolveCaptureDir(opts)
	await mkdir(captureDir, { recursive: true })

	const observationWindowStartedAt = new Date().toISOString()
	const samples = []
	const seenReplacementPid = { value: undefined }

	// Initial sample.
	const initial = await sampleProcess(originalPid)
	if (initial) {
		samples.push({
			at: new Date().toISOString(),
			pid: originalPid,
			alive: initial.alive,
			rss_bytes: initial.rss_bytes,
			cpu_pct: initial.cpu_pct,
			thread_count: initial.thread_count,
			ppid: initial.ppid,
			command: initial.command,
		})
	}

	let observedTerminated = false
	let terminatedAt = null
	let observedRestarted = false
	let restartPid = null
	let restartAt = null
	let unresponsiveObserved = false
	let unresponsiveAt = null
	let lastAlive = initial?.alive ?? false

	const startMs = Date.now()
	const endMs = startMs + opts.durationMs

	while (Date.now() < endMs) {
		await sleep(opts.cadenceMs)
		const sample = await sampleProcess(originalPid)
		const nowIso = new Date().toISOString()
		if (sample) {
			samples.push({
				at: nowIso,
				pid: originalPid,
				alive: sample.alive,
				rss_bytes: sample.rss_bytes,
				cpu_pct: sample.cpu_pct,
				thread_count: sample.thread_count,
				ppid: sample.ppid,
				command: sample.command,
			})
			if (samples.length > MAX_SAMPLES) {
				samples.splice(0, samples.length - MAX_SAMPLES)
			}
			if (sample.alive) {
				lastAlive = true
			} else if (lastAlive) {
				// First sample showing the original PID as gone.
				observedTerminated = true
				terminatedAt = nowIso
				lastAlive = false
				// Look for a replacement PID (the highest PID whose
				// command mentions "extension host" / "extensionhost"
				// other than originalPid).
				const replacement = await locateExtensionHostPid()
				if (replacement && replacement.pid !== originalPid) {
					seenReplacementPid.value = replacement.pid
					observedRestarted = true
					restartPid = replacement.pid
					restartAt = nowIso
				}
			}
		}
		// Bounded loop exit on definitive termination.
		if (observedTerminated && observedRestarted) {
			const r = await sampleProcess(seenReplacementPid.value)
			if (r) {
				samples.push({
					at: new Date().toISOString(),
					pid: seenReplacementPid.value,
					alive: r.alive,
					rss_bytes: r.rss_bytes,
					cpu_pct: r.cpu_pct,
					thread_count: r.thread_count,
					ppid: r.ppid,
					command: r.command,
				})
			}
			break
		}
	}

	const observationWindowCompletedAt = new Date().toISOString()
	const observationWindowCompleted = true

	const payload = {
		schema_version: SCHEMA_VERSION,
		observation_window_started_at: observationWindowStartedAt,
		observation_window_completed_at: observationWindowCompletedAt,
		observation_window_completed: observationWindowCompleted,
		extension_host_pid: originalPid,
		extension_host_started_at: samples[0]?.at ?? null,
		unresponsive_observed: unresponsiveObserved,
		unresponsive_at: unresponsiveAt,
		extension_host_terminated: observedTerminated,
		terminated_at: terminatedAt,
		exit_code: null,
		signal: null,
		process_gone_reason: observedTerminated
			? observedRestarted
				? "pid_disappeared_and_replacement_observed"
				: "pid_disappeared_no_replacement"
			: null,
		extension_host_restarted: observedRestarted,
		restart_pid: restartPid,
		restart_at: restartAt,
		samples,
	}

	await writePayloadAtomic(join(captureDir, "parent-lifecycle.json"), payload)
	process.stdout.write(
		`parent-lifecycle.json written: pid=${originalPid} terminated=${observedTerminated} restarted=${observedRestarted} samples=${samples.length}\n`,
	)
}

main().catch((err) => {
	process.stderr.write(`fatal: ${err && err.message ? err.message : String(err)}\n`)
	process.exit(4)
})
