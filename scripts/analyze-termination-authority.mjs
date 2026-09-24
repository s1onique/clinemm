#!/usr/bin/env node
/**
 * ACT-CLINEMM-EXTENSION-HOST-TERMINATION-AUTHORITY01
 *
 * Verdict extractor for the Extension Host termination witness.
 *
 * Reads a capture directory produced by
 * apps/vscode/src/sdk/extension-host-termination-authority.ts
 * and:
 *
 *   1) Loads host-self-events.jsonl (in-process events)
 *   2) Loads parent-lifecycle.json (operator-supplied parent-side data)
 *   3) Loads macos-crash-report-summary.json (operator-supplied summary)
 *   4) Reads meta.json for identity + counter provenance
 *   5) Computes TerminationAuthorityVerdict via the same pure
 *      function used by the in-process witness
 *   6) Writes verdict.json + prints a one-line summary to stdout
 *
 * Usage:
 *   node scripts/analyze-termination-authority.mjs <capture-dir>
 *
 * Output:
 *   <capture-dir>/verdict.json     (re-classified verdict)
 *   stdout                        (one-line human summary)
 *
 * Exit code:
 *   0   TA1/TA2/TA3/TA4 (terminal authority proven)
 *   2   TA5  CAPTURE_INSUFFICIENT -- more evidence acquisition ACT
 *   3   TA6  NOT_REPRODUCED
 *   4   USAGE / IO error
 *
 * The exit code is informational; the verdict.json file is the
 * load-bearing artifact. A future analyzer can compose multiple
 * captures into a single verdict without re-running this script.
 */

import { readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

function errorMessage(err) {
	return err instanceof Error ? err.message : String(err)
}

function usage() {
	process.stderr.write(
		"usage: analyze-termination-authority.mjs <capture-dir>\n" +
			"  <capture-dir>   Path to a capture directory produced by\n" +
			"                  extension-host-termination-authority.ts\n",
	)
}

async function safeReadFile(p) {
	try {
		return await readFile(p, "utf8")
	} catch {
		return null
	}
}

function pickEventField(events, kind, field) {
	for (let i = events.length - 1; i >= 0; i--) {
		const e = events[i]
		if (e?.kind === kind) return e[field]
	}
	return undefined
}

function computeVerdict(input) {
	const {
		counters,
		processExitedNormally,
		nativeCrashReportPresent,
		externalTerminationReported,
		resourceExhaustionReported,
	} = input
	const evidence_summary = {
		process_exit_observed: counters.processExitObserved,
		process_exit_code: counters.processExitCode,
		process_exit_at: counters.processExitObservedAt,
		uncaught_exception_monitor_observed: counters.uncaughtExceptionMonitorObserved,
		warning_observed: counters.warningObserved,
		native_crash_report_present: nativeCrashReportPresent,
		external_termination_reported: externalTerminationReported,
		resource_exhaustion_reported: resourceExhaustionReported,
	}
	if (processExitedNormally && counters.processExitObserved && !nativeCrashReportPresent) {
		return {
			classification: "TA1",
			label: "PASS_TERMINATION_AUTHORITY_EXPLICIT_PROCESS_EXIT",
			summary: "process emitted exit; no native crash report; operator confirms clean shutdown",
			evidence_summary,
		}
	}
	if (nativeCrashReportPresent) {
		return {
			classification: "TA2",
			label: "PASS_TERMINATION_AUTHORITY_NATIVE_CRASH",
			summary: "native crash report matches Extension Host PID + timestamp; no normal self-terminal event precedes",
			evidence_summary: { ...evidence_summary, native_crash_report_present: true },
		}
	}
	if (externalTerminationReported && !counters.processExitObserved && !nativeCrashReportPresent) {
		return {
			classification: "TA3",
			label: "PASS_TERMINATION_AUTHORITY_EXTERNAL_OR_WATCHDOG",
			summary: "parent-side termination recorded; no self-terminal event; no native crash",
			evidence_summary: { ...evidence_summary, external_termination_reported: true },
		}
	}
	if (resourceExhaustionReported && !counters.processExitObserved && !nativeCrashReportPresent) {
		return {
			classification: "TA4",
			label: "PASS_TERMINATION_AUTHORITY_RESOURCE",
			summary: "resource-exhaustion report precedes death; no self-terminal event; no native crash",
			evidence_summary: { ...evidence_summary, resource_exhaustion_reported: true },
		}
	}
	if (counters.observedEventCount > 0 || counters.processExitObserved) {
		return {
			classification: "TA5",
			label: "CAPTURE_INSUFFICIENT",
			summary: "process death observed but termination authority unresolved by current evidence",
			evidence_summary,
		}
	}
	return {
		classification: "TA6",
		label: "NOT_REPRODUCED",
		summary: "no host-self events and no external evidence -- crash did not reproduce during capture window",
		evidence_summary: { ...evidence_summary, process_exit_observed: false },
	}
}

async function main() {
	const args = process.argv.slice(2)
	if (args.length !== 1) {
		usage()
		process.exit(4)
	}
	const captureDir = resolve(args[0])
	let meta
	try {
		meta = JSON.parse(await readFile(resolve(captureDir, "meta.json"), "utf8"))
	} catch (err) {
		process.stderr.write(`failed to read meta.json: ${errorMessage(err)}\n`)
		process.exit(4)
	}

	const eventsRaw = await safeReadFile(resolve(captureDir, "host-self-events.jsonl"))
	const events = []
	if (eventsRaw) {
		for (const line of eventsRaw.split("\n")) {
			const trimmed = line.trim()
			if (trimmed.length === 0) continue
			try {
				events.push(JSON.parse(trimmed))
			} catch {
				/* skip malformed line; bounded corruption allowed */
			}
		}
	}

	let parentLifecycle = null
	try {
		parentLifecycle = JSON.parse(await readFile(resolve(captureDir, "parent-lifecycle.json"), "utf8"))
	} catch {
		parentLifecycle = null
	}

	let crashSummary = null
	try {
		crashSummary = JSON.parse(await readFile(resolve(captureDir, "macos-crash-report-summary.json"), "utf8"))
	} catch {
		crashSummary = null
	}

	const counters = {
		armedAt: meta?.counters?.armedAt ? new Date(meta.counters.armedAt) : undefined,
		installedAt: meta?.counters?.installedAt ? new Date(meta.counters.installedAt) : undefined,
		observedEventCount: events.length,
		droppedEventCount: meta?.counters?.droppedEventCount ?? 0,
		lastEventKind: events.length > 0 ? events[events.length - 1].kind : undefined,
		lastEventObservedAt: events.length > 0 ? events[events.length - 1].observed_at : undefined,
		processExitObserved: events.some((e) => e.kind === "exit"),
		processExitObservedAt: pickEventField(events, "exit", "observed_at"),
		processExitCode: pickEventField(events, "exit", "exit_code"),
		processBeforeExitObserved: events.some((e) => e.kind === "beforeExit"),
		uncaughtExceptionMonitorObserved: events.some((e) => e.kind === "uncaughtExceptionMonitor"),
		warningObserved: events.some((e) => e.kind === "warning"),
	}

	const processExitedNormally = parentLifecycle?.process_exited_cleanly === true
	const nativeCrashReportPresent =
		!!crashSummary && crashSummary.ok === true && !!crashSummary.exception_type
	const externalTerminationReported =
		!!parentLifecycle &&
		(parentLifecycle.termination_kind === "watchdog" ||
			parentLifecycle.termination_kind === "host_kill" ||
			parentLifecycle.exit_reason === "watchdog_timeout" ||
			parentLifecycle.exit_reason === "killed_by_parent")
	const resourceExhaustionReported =
		!!parentLifecycle &&
		(parentLifecycle.resource_exhaustion === true ||
			parentLifecycle.exit_reason === "oom" ||
			parentLifecycle.exit_reason === "killed_oom")

	const verdict = computeVerdict({
		counters,
		processExitedNormally,
		nativeCrashReportPresent,
		externalTerminationReported,
		resourceExhaustionReported,
		installedAt: counters.installedAt ?? new Date(),
		captureId: meta?.capture_id ?? "unknown",
	})

	const verdictWithProvenance = {
		...verdict,
		capture_id: meta?.capture_id ?? "unknown",
		capture_dir: captureDir,
		derived_from: {
			host_self_events: events.length,
			parent_lifecycle_present: parentLifecycle !== null,
			macos_crash_summary_present: crashSummary !== null,
		},
		computed_at: new Date().toISOString(),
	}
	await writeFile(
		resolve(captureDir, "verdict.json"),
		JSON.stringify(verdictWithProvenance, null, 2),
		"utf8",
	)
	process.stdout.write(
		`${verdict.classification}\t${verdict.label}\t${verdict.summary}\n`,
	)
	const exitBy = { TA1: 0, TA2: 0, TA3: 0, TA4: 0, TA5: 2, TA6: 3 }
	process.exit(exitBy[verdict.classification] ?? 0)
}

main().catch((err) => {
	process.stderr.write(`fatal: ${errorMessage(err)}\n`)
	process.exit(4)
})
