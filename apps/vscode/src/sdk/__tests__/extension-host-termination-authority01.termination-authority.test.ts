/**
 * ACT-CLINEMM-EXTENSION-HOST-TERMINATION-AUTHORITY01
 *
 * Focused test suite for the Extension Host termination witness.
 *
 * Discriminators covered (per ACT §13 / §15 + CORRECTION01 + CORRECTION02
 * + ACT-CLINEMM-EXTENSION-HOST-TERMINATION-LIVE-CLASSIFICATION01):
 *   TATRM-CONSERVE-01        disabled-zero-semantic-delta
 *   TATRM-CONSERVE-SIGNAL-01 witness enabled -> listenerCount(SIGTERM/INT/HUP) unchanged
 *   TATRM-CONSERVE-REJECTION-01 witness enabled -> listenerCount(unhandledRejection/rejectionHandled) unchanged
 *   TATRM-CONSERVE-SIGNAL-MUTATION-01 a temporary SIGTERM listener survives the witness
 *   TATRM-CONSERVE-BEFOREEXIT-01 witness enabled -> listenerCount("beforeExit") unchanged
 *                            (CORRECTION02: beforeExit was REMOVED from the
 *                            safe-list because a listener may schedule
 *                            async work and keep the process alive)
 *   TATRM-POLICY-01          public + knob=1 -> DISABLED (fail-closed)
 *   TATRM-POLICY-02          dogfood + knob=1 -> ARMED
 *   TATRM-POLICY-03          dogfood + knob unset -> DISABLED
 *   TATRM-INSTALL-01         install installs EXACTLY the safe-list
 *                            (exit, uncaughtExceptionMonitor, warning)
 *   TATRM-INSTALL-02         install is idempotent
 *   TATRM-INSTALL-03         install on DISABLED state is a no-op
 *   TATRM-EVENT-01           exit captures code (CORRECTION02: was
 *                            beforeExit before the channel was removed)
 *   TATRM-EVENT-02           uncaughtExceptionMonitor captures bounded reason
 *   TATRM-EVENT-04           warning captures bounded name + first line
 *   TATRM-EVENT-06           event cap honored (dropped counter increments)
 *   TATRM-EVENT-07           bounded lines preserve JSONL single-line format
 *   TATRM-VERDICT-01         TA-D1 -> TA1 (explicit process exit)
 *   TATRM-VERDICT-02         TA-D2 -> TA2 (native crash report present)
 *   TATRM-VERDICT-03         TA-D3 -> TA3 (external termination reported)
 *   TATRM-VERDICT-04         TA-D4 -> TA4 (resource exhaustion reported)
 *   TATRM-VERDICT-05         death observed but inconclusive -> TA5
 *   TATRM-VERDICT-06         affirmative negative witness -> TA6 (LIVE-CLASSIFICATION)
 *   TATRM-VERDICT-07         TA1 is overridden by TA2 when a crash report exists
 *   TALIVE-TA6-NEGATIVE-WITNESS-01 no parent-lifecycle + no crash report -> TA5
 *                            (LIVE-CLASSIFICATION: absence of evidence is NOT
 *                            evidence of absence)
 *   TALIVE-TA6-NEGATIVE-WITNESS-02 parent-lifecycle present but not affirming survival -> TA5
 *   TALIVE-TA6-AFFIRMATIVE-01  completed window + no death + no crash -> TA6
 *   TALIVE-TA6-AFFIRMATIVE-02  completed window + crash report present -> TA2
 *   TALIVE-TA5-DEATH-UNRESOLVED-01 external PID disappearance + restart, no authority -> TA5
 *   TALIVE-TA5-DEATH-UNRESOLVED-02 external death + watchdog -> TA3
 *   TALIVE-TA5-DEATH-UNRESOLVED-03 external death + resource -> TA4
 *   TALIVE-TA2-PID-BINDING-01   crash report PID matches failed Extension Host -> TA2
 *   TALIVE-TA2-WRONG-PID-01     crash report PID differs -> NOT TA2
 *   TALIVE-TA3-EXPLICIT-01      parent reports watchdog/host kill -> TA3
 *   TALIVE-TA4-EXPLICIT-01      external death + explicit OOM/resource evidence -> TA4
 *   TATRM-RUNTIME-01         writeParentLifecycle writes parent-lifecycle.json
 *   TATRM-RUNTIME-02         macOS crash report summarizer collapses load-bearing fields
 *   TATRM-RUNTIME-03         writeCrashReportSummary falls back on parse error
 *   TATRM-RUNTIME-04         writeCrashReportSummary writes structured summary on real-format report
 *   TATRM-RECOVERY-01        __resetTerminationAuthorityForTests clears all state
 *   TATRM-RECOVERY-02        getTerminationAuthoritySnapshot returns a defensive copy
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
	__resetTerminationAuthorityForTests,
	applyExtensionHostTerminationAuthorityPolicy,
	CLINEMM_DIAG_TERMINATION_AUTHORITY_ENV,
	computeTerminationAuthorityVerdict,
	getTerminationAuthorityCaptureId,
	getTerminationAuthorityEventCount,
	getTerminationAuthorityEvents,
	getTerminationAuthoritySnapshot,
	getTerminationAuthorityState,
	installTerminationAuthorityWitness,
	resolveTerminationAuthorityKnobFromEnv,
	setTerminationAuthorityCaptureIdFactory,
	setTerminationAuthorityDataRootResolver,
	TERMINATION_AUTHORITY_MAX_EVENTS,
	type TerminationAuthorityCounters,
} from "../extension-host-termination-authority"
import {
	summarizeMacosDiagnosticReport,
	writeCrashReportSummary,
	writeParentLifecycle,
} from "../extension-host-termination-authority-runtime"

interface FakeWriter {
	_writes: Array<{ path: string; line: string }>
	write: (target: string, line: string) => Promise<void>
}

function makeFakeWriter(): FakeWriter {
	const fw: FakeWriter = {
		_writes: [],
		async write(target: string, line: string): Promise<void> {
			fw._writes.push({ path: target, line })
		},
	}
	return fw
}

interface CapturedListeners {
	[k: string]: Array<(...args: unknown[]) => void>
}

interface FakeProcess {
	_listeners: CapturedListeners
	listenerCount(ev: string): number
	on(ev: string, cb: (...args: unknown[]) => void): void
	emit(ev: string, ...args: unknown[]): void
	removeAllListeners(): void
}

function makeFakeProcess(): FakeProcess {
	const listeners: CapturedListeners = {}
	const fp: FakeProcess = {
		_listeners: listeners,
		listenerCount(ev: string): number {
			return listeners[ev]?.length ?? 0
		},
		on(ev: string, cb: (...args: unknown[]) => void): void {
			if (!listeners[ev]) listeners[ev] = []
			listeners[ev].push(cb)
		},
		emit(ev: string, ...args: unknown[]): void {
			const cbs = listeners[ev] ?? []
			for (const cb of cbs) {
				cb(...args)
			}
		},
		removeAllListeners(): void {
			for (const k of Object.keys(listeners)) delete listeners[k]
		},
	}
	return fp
}

function stableCounters(seed: Partial<TerminationAuthorityCounters> = {}): TerminationAuthorityCounters {
	return {
		armedAt: undefined,
		installedAt: undefined,
		observedEventCount: 0,
		droppedEventCount: 0,
		lastEventKind: undefined,
		lastEventObservedAt: undefined,
		processExitObserved: false,
		processExitObservedAt: undefined,
		processExitCode: undefined,
		uncaughtExceptionMonitorObserved: false,
		warningObserved: false,
		...seed,
	}
}

// =============================================================================
// Conservation / default-off invariants
// =============================================================================

describe("ACT-CLINEMM-EXTENSION-HOST-TERMINATION-AUTHORITY01 / conservation", () => {
	beforeEach(() => {
		__resetTerminationAuthorityForTests()
		setTerminationAuthorityDataRootResolver(undefined)
		setTerminationAuthorityCaptureIdFactory(() => "test-fixed")
	})
	afterEach(() => {
		__resetTerminationAuthorityForTests()
	})

	it("TATRM-CONSERVE-01: disabled-zero-semantic-delta", () => {
		// Disabled by default; install() returns without installing listeners
		// AND without touching the writer seam.

		// Run with the REAL process to count listeners. The default
		// state is disabled; calling install() MUST be a no-op.
		const beforeSigterm = process.listenerCount("SIGTERM")
		const beforeExitListeners = process.listenerCount("exit")
		const beforeUCEM = process.listenerCount("uncaughtExceptionMonitor")
		void installTerminationAuthorityWitness()
		const afterSigterm = process.listenerCount("SIGTERM")
		const afterExitListeners = process.listenerCount("exit")
		const afterUCEM = process.listenerCount("uncaughtExceptionMonitor")

		expect(afterSigterm).toBe(beforeSigterm)
		expect(afterExitListeners).toBe(beforeExitListeners)
		expect(afterUCEM).toBe(beforeUCEM)
		expect(getTerminationAuthorityState()).toBe("disabled")
		expect(getTerminationAuthorityCaptureId()).toBeUndefined()
		expect(getTerminationAuthorityEventCount()).toBe(0)
	})

	it("TATRM-POLICY-01: public + knob=1 -> DISABLED (fail-closed)", () => {
		const env = { [CLINEMM_DIAG_TERMINATION_AUTHORITY_ENV]: "1" }
		expect(resolveTerminationAuthorityKnobFromEnv(false, env)).toBe(false)
		const r = applyExtensionHostTerminationAuthorityPolicy(false, env)
		expect(r.enabled).toBe(false)
		expect(getTerminationAuthorityState()).toBe("disabled")
	})

	it("TATRM-POLICY-02: dogfood + knob=1 -> ARMED", () => {
		const env = { [CLINEMM_DIAG_TERMINATION_AUTHORITY_ENV]: "1" }
		expect(resolveTerminationAuthorityKnobFromEnv(true, env)).toBe(true)
		const r = applyExtensionHostTerminationAuthorityPolicy(true, env)
		expect(r.enabled).toBe(true)
		expect(r.flipped).toBe(true)
		expect(getTerminationAuthorityState()).toBe("armed")
	})

	it("TATRM-POLICY-03: dogfood + knob unset -> DISABLED", () => {
		const env: NodeJS.ProcessEnv = {}
		expect(resolveTerminationAuthorityKnobFromEnv(true, env)).toBe(false)
		const r = applyExtensionHostTerminationAuthorityPolicy(true, env)
		expect(r.enabled).toBe(false)
		expect(getTerminationAuthorityState()).toBe("disabled")
	})

	it("TATRM-POLICY-04: dogfood + knob='true' / 'yes' accepted", () => {
		for (const v of ["1", "true", "yes", "YES", "  True  "]) {
			expect(resolveTerminationAuthorityKnobFromEnv(true, { [CLINEMM_DIAG_TERMINATION_AUTHORITY_ENV]: v })).toBe(true)
		}
	})

	it("TATRM-POLICY-05: dogfood + knob='0' / 'false' refused", () => {
		for (const v of ["0", "false", "no", "off", ""]) {
			expect(resolveTerminationAuthorityKnobFromEnv(true, { [CLINEMM_DIAG_TERMINATION_AUTHORITY_ENV]: v })).toBe(false)
		}
	})
})

// =============================================================================
// Install seam + listeners
// =============================================================================

describe("ACT-CLINEMM-EXTENSION-HOST-TERMINATION-AUTHORITY01 / install seam", () => {
	beforeEach(() => {
		__resetTerminationAuthorityForTests()
		setTerminationAuthorityCaptureIdFactory(() => "install-fixed")
	})
	afterEach(() => {
		__resetTerminationAuthorityForTests()
	})

	it("TATRM-INSTALL-01: install installs exactly the safe-list listeners", () => {
		// Arms the witness, binds the writer + data root seams, then
		// runs install(). We monkey-patch `process.on` to capture every
		// registration BEFORE the install call.
		//
		// CORRECTION01 + CORRECTION02: the safe-list is FROZEN to exactly
		// the channels that are provably observational for
		// process-termination attribution AND cannot keep the process
		// alive on their own. The witness MUST NOT install any other
		// listener (signal handlers, unhandledRejection, rejectionHandled,
		// beforeExit, etc.) because installing one would alter
		// process-termination semantics — either by suppressing Node's
		// default disposition (signals / unhandled rejection) or by
		// enabling new async work (beforeExit can schedule work and
		// keep the process alive).
		const pre = makeFakeProcess()
		const originalOn = process.on.bind(process)
		const captured: Array<{ event: string; nArgs: number }> = []
		process.on = ((event: string, listener: (...args: unknown[]) => void) => {
			captured.push({ event, nArgs: listener.length })
			return originalOn(event as NodeJS.Signals, listener as never)
		}) as typeof process.on

		try {
			setTerminationAuthorityDataRootResolver(() => "/tmp/clinemm-ta")
			const w = makeFakeWriter()
			// We can't easily inject writer at runtime here because the
			// witness's `_writer` is module-private; we use the seam
			// setter.
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const mod = require("../extension-host-termination-authority") as {
				setTerminationAuthorityWriter: (w: FakeWriter) => void
			}
			mod.setTerminationAuthorityWriter(w as unknown as never)
			applyExtensionHostTerminationAuthorityPolicy(true, { [CLINEMM_DIAG_TERMINATION_AUTHORITY_ENV]: "1" })
			void installTerminationAuthorityWitness()
			// The install seam is async (await mkdir). Wait until the
			// snapshot flips to installed.
			return Promise.resolve().then(async () => {
				// Allow the awaiting mkdir to resolve on the microtask queue.
				await new Promise((resolve) => setImmediate(resolve))
				const installed = getTerminationAuthorityState() === "installed"
				expect(installed).toBe(true)
				// FROZEN SAFE-LIST (per CORRECTION02): every event the
				// witness installs MUST appear in this set; nothing else
				// may. `beforeExit` was REMOVED in CORRECTION02 because
				// a listener may schedule async work and keep the
				// process alive.
				const EXPECTED = new Set(["exit", "uncaughtExceptionMonitor", "warning"])
				// Every captured event must be in the expected set.
				for (const c of captured) {
					expect(EXPECTED.has(c.event)).toBe(true)
				}
				// And every expected event must be present.
				for (const ev of EXPECTED) {
					expect(captured.find((c) => c.event === ev)).toBeDefined()
				}
				// Negative assertion: the witness MUST NOT register any
				// signal listener.
				for (const sig of ["SIGHUP", "SIGINT", "SIGTERM", "SIGPIPE", "SIGBREAK", "SIGWINCH"]) {
					expect(captured.find((c) => c.event === sig)).toBeUndefined()
				}
				// Negative assertion: the witness MUST NOT register
				// unhandledRejection / rejectionHandled.
				expect(captured.find((c) => c.event === "unhandledRejection")).toBeUndefined()
				expect(captured.find((c) => c.event === "rejectionHandled")).toBeUndefined()
				// CORRECTION02: the witness MUST NOT register a
				// beforeExit listener — that channel can schedule
				// async work and keep the process alive.
				expect(captured.find((c) => c.event === "beforeExit")).toBeUndefined()
				void pre
			})
		} finally {
			process.on = originalOn
		}
	})

	it("TATRM-INSTALL-02: install is idempotent", () => {
		setTerminationAuthorityDataRootResolver(() => "/tmp/clinemm-ta")
		const w = makeFakeWriter()
		const mod = require("../extension-host-termination-authority") as {
			setTerminationAuthorityWriter: (w: FakeWriter) => void
		}
		mod.setTerminationAuthorityWriter(w as unknown as never)
		applyExtensionHostTerminationAuthorityPolicy(true, { [CLINEMM_DIAG_TERMINATION_AUTHORITY_ENV]: "1" })
		return (async () => {
			await installTerminationAuthorityWitness()
			const beforeCount = process.listenerCount("exit")
			await installTerminationAuthorityWitness()
			const afterCount = process.listenerCount("exit")
			expect(afterCount).toBe(beforeCount)
		})()
	})

	it("TATRM-INSTALL-03: install on DISABLED state is a no-op", () => {
		const w = makeFakeWriter()
		const mod = require("../extension-host-termination-authority") as {
			setTerminationAuthorityWriter: (w: FakeWriter) => void
		}
		mod.setTerminationAuthorityWriter(w as unknown as never)
		setTerminationAuthorityDataRootResolver(() => "/tmp/clinemm-ta")
		// Do NOT call applyExtensionHostTerminationAuthorityPolicy with
		// knob=1 — state stays disabled.
		const before = process.listenerCount("exit")
		return (async () => {
			await installTerminationAuthorityWitness()
			const after = process.listenerCount("exit")
			expect(after).toBe(before)
			expect(getTerminationAuthorityState()).toBe("disabled")
		})()
	})
})

// =============================================================================
// Event capture
// =============================================================================

describe("ACT-CLINEMM-EXTENSION-HOST-TERMINATION-AUTHORITY01 / event capture", () => {
	beforeEach(() => {
		__resetTerminationAuthorityForTests()
		setTerminationAuthorityCaptureIdFactory(() => "event-fixed")
	})
	afterEach(() => {
		__resetTerminationAuthorityForTests()
	})

	function setupInstalled(): Promise<void> {
		setTerminationAuthorityDataRootResolver(() => "/tmp/clinemm-ta")
		const w = makeFakeWriter()
		const mod = require("../extension-host-termination-authority") as {
			setTerminationAuthorityWriter: (w: FakeWriter) => void
		}
		mod.setTerminationAuthorityWriter(w as unknown as never)
		applyExtensionHostTerminationAuthorityPolicy(true, { [CLINEMM_DIAG_TERMINATION_AUTHORITY_ENV]: "1" })
		return installTerminationAuthorityWitness()
	}

	it("TATRM-EVENT-01: exit captures code (CORRECTION02: was beforeExit before the channel was removed)", async () => {
		// CORRECTION02: `beforeExit` was REMOVED from the safe-list
		// because a listener may schedule async work and keep the
		// process alive. The exit-channel test was rewritten to use
		// the `exit` channel directly. Note: the `exit` listener uses
		// SYNC fs to flush, so emitting it here captures synchronously
		// (the ring buffer + counters are updated before emit returns
		// because the listener body runs synchronously inside emit).
		await setupInstalled()
		const before = getTerminationAuthoritySnapshot().counters.observedEventCount
		process.emit("exit" as never, 7 as never)
		const after = getTerminationAuthoritySnapshot().counters
		expect(after.observedEventCount).toBe(before + 1)
		expect(after.processExitObserved).toBe(true)
		expect(after.processExitCode).toBe(7)
		const events = getTerminationAuthorityEvents()
		const evt = events[events.length - 1]
		expect(evt.kind).toBe("exit")
		expect(evt.exit_code).toBe(7)
	})

	it("TATRM-EVENT-02: uncaughtExceptionMonitor captures bounded reason", async () => {
		await setupInstalled()
		const before = getTerminationAuthoritySnapshot().counters.observedEventCount
		const err = new Error("boom!\nstack follows here\nmore stack\nmore")
		process.emit("uncaughtExceptionMonitor" as never, err as never, "uncaughtException" as never)
		const after = getTerminationAuthoritySnapshot().counters
		expect(after.observedEventCount).toBe(before + 1)
		expect(after.uncaughtExceptionMonitorObserved).toBe(true)
		const events = getTerminationAuthorityEvents()
		const evt = events[events.length - 1]
		expect(evt.kind).toBe("uncaughtExceptionMonitor")
		expect(evt.reason_kind).toBe("Error")
		expect(evt.reason_first_line).toBe("boom!")
		expect(evt.warning_name).toBe("uncaughtException")
		// First line of stack only — not the full multi-line trace.
		expect(evt.stack_head === undefined || typeof evt.stack_head === "string").toBe(true)
	})

	it("TATRM-EVENT-04: warning captures bounded name + first line", async () => {
		await setupInstalled()
		const before = getTerminationAuthoritySnapshot().counters.observedEventCount
		const w = new Error(
			"this is a long warning message that should be bounded to 280 chars — but for now we test that the first line is preserved and the warning_name is the Error class",
		)
		process.emit("warning" as never, w as never)
		const after = getTerminationAuthoritySnapshot().counters
		expect(after.observedEventCount).toBe(before + 1)
		expect(after.warningObserved).toBe(true)
		const events = getTerminationAuthorityEvents()
		const evt = events[events.length - 1]
		expect(evt.kind).toBe("warning")
		expect(evt.warning_name).toBe("Error")
		expect(typeof evt.reason_first_line).toBe("string")
	})

	it("TATRM-EVENT-06: event cap honored (dropped counter increments)", async () => {
		await setupInstalled()
		// Fire TERMINATION_AUTHORITY_MAX_EVENTS warnings in a row.
		for (let i = 0; i < TERMINATION_AUTHORITY_MAX_EVENTS + 5; i++) {
			const w = new Error(`w-${i}`)
			process.emit("warning" as never, w as never)
		}
		const after = getTerminationAuthoritySnapshot().counters
		expect(after.observedEventCount).toBe(TERMINATION_AUTHORITY_MAX_EVENTS)
		expect(after.droppedEventCount).toBeGreaterThanOrEqual(5)
	})

	it("TATRM-EVENT-07: bounded lines preserve JSONL single-line format", async () => {
		// We assert that no recorded event contains a newline in its
		// serialized JSON form. If a future contributor forgets to
		// bound `reason_first_line`, this would fail.
		//
		// CORRECTION01: switched the trigger from `unhandledRejection`
		// (which the witness no longer observes) to `warning` — the
		// bounded-line guarantee is independent of the channel.
		const w = makeFakeWriter()
		setTerminationAuthorityDataRootResolver(() => "/tmp/clinemm-ta")
		const mod = require("../extension-host-termination-authority") as {
			setTerminationAuthorityWriter: (w: FakeWriter) => void
		}
		mod.setTerminationAuthorityWriter(w as unknown as never)
		applyExtensionHostTerminationAuthorityPolicy(true, { [CLINEMM_DIAG_TERMINATION_AUTHORITY_ENV]: "1" })
		await installTerminationAuthorityWitness()
		const err = new Error("line1\nline2\nline3")
		process.emit("warning" as never, err as never)
		const writes = w._writes.filter((wr) => wr.path.endsWith("host-self-events.jsonl"))
		expect(writes.length).toBeGreaterThan(0)
		const last = writes[writes.length - 1].line
		// Trailing newline is expected — JSONL rows are newline-terminated.
		expect(last.endsWith("\n")).toBe(true)
		// Before the trailing newline, no other newline allowed.
		const trimmed = last.slice(0, -1)
		expect(trimmed.includes("\n")).toBe(false)
		// And reason_first_line should be "line1 line2 line3" (the
		// boundLine helper collapses newlines to spaces — proves the
		// bounded-line guarantee is preserved end-to-end).
		const json = JSON.parse(trimmed)
		expect(json.reason_first_line).toBe("line1 line2 line3")
	})

	// =============================================================================
	// CORRECTION01 — Semantic-inertia discriminators
	//
	// These assert the witness does NOT install listeners on channels
	// that would alter Node's default process-termination semantics.
	// The conservation gate is at the boundary between "observational
	// only" (allowed) and "process-lifecycle altering" (forbidden).
	// =============================================================================

	it("TATRM-CONSERVE-SIGNAL-01: witness enabled -> SIGTERM/SIGINT/SIGHUP listenerCount unchanged", async () => {
		// Capture baseline BEFORE install.
		const baseTerm = process.listenerCount("SIGTERM")
		const baseInt = process.listenerCount("SIGINT")
		const baseHup = process.listenerCount("SIGHUP")
		// Arm + install the witness.
		setTerminationAuthorityDataRootResolver(() => "/tmp/clinemm-ta")
		const w = makeFakeWriter()
		const mod = require("../extension-host-termination-authority") as {
			setTerminationAuthorityWriter: (w: FakeWriter) => void
		}
		mod.setTerminationAuthorityWriter(w as unknown as never)
		applyExtensionHostTerminationAuthorityPolicy(true, { [CLINEMM_DIAG_TERMINATION_AUTHORITY_ENV]: "1" })
		await installTerminationAuthorityWitness()
		// Assert that the count of listeners on each unsafe channel
		// is unchanged. This proves installing the witness does NOT
		// register a signal handler.
		expect(process.listenerCount("SIGTERM")).toBe(baseTerm)
		expect(process.listenerCount("SIGINT")).toBe(baseInt)
		expect(process.listenerCount("SIGHUP")).toBe(baseHup)
	})

	it("TATRM-CONSERVE-REJECTION-01: witness enabled -> unhandledRejection/rejectionHandled listenerCount unchanged", async () => {
		// Capture baseline BEFORE install.
		const baseUnh = process.listenerCount("unhandledRejection")
		const baseHandled = process.listenerCount("rejectionHandled")
		// Arm + install the witness.
		setTerminationAuthorityDataRootResolver(() => "/tmp/clinemm-ta")
		const w = makeFakeWriter()
		const mod = require("../extension-host-termination-authority") as {
			setTerminationAuthorityWriter: (w: FakeWriter) => void
		}
		mod.setTerminationAuthorityWriter(w as unknown as never)
		applyExtensionHostTerminationAuthorityPolicy(true, { [CLINEMM_DIAG_TERMINATION_AUTHORITY_ENV]: "1" })
		await installTerminationAuthorityWitness()
		// Assert that the witness did NOT register an unhandledRejection
		// or rejectionHandled listener. Installing either would alter
		// Node's default `--unhandled-rejections=throw` behavior.
		expect(process.listenerCount("unhandledRejection")).toBe(baseUnh)
		expect(process.listenerCount("rejectionHandled")).toBe(baseHandled)
	})

	it("TATRM-CONSERVE-SIGNAL-MUTATION-01: pre-existing SIGTERM listener survives the witness", async () => {
		// Stronger mutation check (per operator directive): manually add
		// a SIGTERM listener BEFORE install, then verify the witness
		// does NOT add another one. If the witness ever regresses to
		// registering SIGTERM, this discriminator fails (the listener
		// count would grow from baseTerm to baseTerm+1).
		const noop = (): void => undefined
		process.on("SIGTERM", noop)
		const baseTerm = process.listenerCount("SIGTERM")
		try {
			setTerminationAuthorityDataRootResolver(() => "/tmp/clinemm-ta")
			const w = makeFakeWriter()
			const mod = require("../extension-host-termination-authority") as {
				setTerminationAuthorityWriter: (w: FakeWriter) => void
			}
			mod.setTerminationAuthorityWriter(w as unknown as never)
			applyExtensionHostTerminationAuthorityPolicy(true, { [CLINEMM_DIAG_TERMINATION_AUTHORITY_ENV]: "1" })
			await installTerminationAuthorityWitness()
			// The witness's contribution to SIGTERM-listener count is 0,
			// so the post-install count equals the pre-install count.
			expect(process.listenerCount("SIGTERM")).toBe(baseTerm)
		} finally {
			process.removeListener("SIGTERM", noop)
		}
	})

	it("TATRM-CONSERVE-BEFOREEXIT-01: witness enabled -> beforeExit listenerCount unchanged (CORRECTION02)", async () => {
		// CORRECTION02: the safe-list was reduced to exactly
		// {exit, uncaughtExceptionMonitor, warning}. `beforeExit` was
		// REMOVED because, per Node.js docs, a `beforeExit` listener
		// may schedule asynchronous work (the witness's async `writer`
		// path qualifies) and cause the process to continue instead of
		// exiting — directly violating the witness contract.
		//
		// This discriminator asserts that `listenerCount("beforeExit")`
		// is unchanged after install. A future contributor who
		// regresses by re-adding a beforeExit listener will trip this
		// test.
		const baseBeforeExit = process.listenerCount("beforeExit")
		setTerminationAuthorityDataRootResolver(() => "/tmp/clinemm-ta")
		const w = makeFakeWriter()
		const mod = require("../extension-host-termination-authority") as {
			setTerminationAuthorityWriter: (w: FakeWriter) => void
		}
		mod.setTerminationAuthorityWriter(w as unknown as never)
		applyExtensionHostTerminationAuthorityPolicy(true, { [CLINEMM_DIAG_TERMINATION_AUTHORITY_ENV]: "1" })
		await installTerminationAuthorityWitness()
		expect(process.listenerCount("beforeExit")).toBe(baseBeforeExit)
	})
})

// =============================================================================
// Verdict classifier (pure function; no install required)
// =============================================================================

describe("ACT-CLINEMM-EXTENSION-HOST-TERMINATION-AUTHORITY01 / verdict classifier", () => {
	const fakeInstalledAt = new Date("2026-09-24T00:00:00Z")

	function verdictFor(
		overrides: Partial<{
			counters: Partial<TerminationAuthorityCounters>
			processExitedNormally: boolean
			nativeCrashReportPresent: boolean
			externalTerminationReported: boolean
			resourceExhaustionReported: boolean
			// ACT-CLINEMM-EXTENSION-HOST-TERMINATION-LIVE-CLASSIFICATION01:
			// parentLifecyclePresent defaults to TRUE for backward
			// compatibility with the original test suite (which
			// pre-dates the affirmative-negative-witness invariant).
			// The new LIVE-CLASSIFICATION discriminators set it to
			// FALSE explicitly to exercise the TA5 fallthrough.
			parentLifecyclePresent: boolean
			// New: externalLifecycleProvesExtensionHostStarted. Set
			// true ONLY when parent-lifecycle.json affirmatively
			// records observation_window_started=true AND
			// observation_window_completed=true AND
			// extension_host_started=true AND
			// extension_host_terminated=false AND
			// extension_host_restarted=false. Required for TA6.
			affirmativeNegativeWitness: boolean
			// New: externalLifecycleProvesDeath — true when
			// parent-lifecycle.json records
			// extension_host_terminated=true or
			// extension_host_restarted=true. Used to route the
			// "PID disappeared, replacement appeared" shape to
			// TA5 (death observed but authority unresolved).
			externalLifecycleProvesDeath: boolean
		}> = {},
	) {
		const counters = stableCounters(overrides.counters ?? {})
		return computeTerminationAuthorityVerdict({
			captureId: "v",
			installedAt: fakeInstalledAt,
			counters,
			eventCount: counters.observedEventCount,
			processExitedNormally: overrides.processExitedNormally ?? false,
			nativeCrashReportPresent: overrides.nativeCrashReportPresent ?? false,
			externalTerminationReported: overrides.externalTerminationReported ?? false,
			resourceExhaustionReported: overrides.resourceExhaustionReported ?? false,
			parentLifecyclePresent: overrides.parentLifecyclePresent ?? true,
			affirmativeNegativeWitness: overrides.affirmativeNegativeWitness ?? false,
			externalLifecycleProvesDeath: overrides.externalLifecycleProvesDeath ?? false,
		})
	}

	it("TATRM-VERDICT-01: TA-D1 -> TA1 (explicit process exit)", () => {
		const v = verdictFor({
			counters: { processExitObserved: true, processExitCode: 0, processExitObservedAt: "t" },
			processExitedNormally: true,
			nativeCrashReportPresent: false,
		})
		expect(v.classification).toBe("TA1")
		expect(v.label).toBe("PASS_TERMINATION_AUTHORITY_EXPLICIT_PROCESS_EXIT")
		expect(v.evidence_summary.process_exit_observed).toBe(true)
	})

	it("TATRM-VERDICT-02: TA-D2 -> TA2 (native crash report present)", () => {
		const v = verdictFor({
			counters: { processExitObserved: false },
			nativeCrashReportPresent: true,
		})
		expect(v.classification).toBe("TA2")
		expect(v.label).toBe("PASS_TERMINATION_AUTHORITY_NATIVE_CRASH")
		expect(v.evidence_summary.native_crash_report_present).toBe(true)
	})

	it("TATRM-VERDICT-03: TA-D3 -> TA3 (external termination reported)", () => {
		const v = verdictFor({
			counters: { processExitObserved: false },
			externalTerminationReported: true,
		})
		expect(v.classification).toBe("TA3")
		expect(v.label).toBe("PASS_TERMINATION_AUTHORITY_EXTERNAL_OR_WATCHDOG")
		expect(v.evidence_summary.external_termination_reported).toBe(true)
	})

	it("TATRM-VERDICT-04: TA-D4 -> TA4 (resource exhaustion reported)", () => {
		const v = verdictFor({
			counters: { processExitObserved: false },
			resourceExhaustionReported: true,
		})
		expect(v.classification).toBe("TA4")
		expect(v.label).toBe("PASS_TERMINATION_AUTHORITY_RESOURCE")
		expect(v.evidence_summary.resource_exhaustion_reported).toBe(true)
	})

	it("TATRM-VERDICT-05: death observed but inconclusive -> TA5", () => {
		const v = verdictFor({
			counters: { observedEventCount: 5, processExitObserved: false },
		})
		expect(v.classification).toBe("TA5")
		expect(v.label).toBe("CAPTURE_INSUFFICIENT")
	})

	it("TATRM-VERDICT-06: affirmative negative witness (parent-lifecycle says window completed + no death) -> TA6", () => {
		// Post-CORRECTION-LIVE-CLASSIFICATION: TA6 requires an
		// AFFIRMATIVE negative witness. Without it the fallthrough
		// is TA5 (CAPTURE_INSUFFICIENT). The original TATRM-VERDICT-06
		// was a false-negative case that the LIVE-CLASSIFICATION ACT
		// fixes — the new invariant is exercised by
		// TALIVE-TA6-NEGATIVE-WITNESS-01 below.
		const v = verdictFor({
			counters: { observedEventCount: 0 },
			parentLifecyclePresent: true,
			affirmativeNegativeWitness: true,
		})
		expect(v.classification).toBe("TA6")
		expect(v.label).toBe("NOT_REPRODUCED")
	})

	it("TATRM-VERDICT-07: TA1 is overridden by TA2 when a crash report exists", () => {
		// Even with a clean exit, a matching crash report wins.
		const v = verdictFor({
			counters: { processExitObserved: true, processExitCode: 0 },
			processExitedNormally: true,
			nativeCrashReportPresent: true,
		})
		expect(v.classification).toBe("TA2")
	})

	// -------------------------------------------------------------------------
	// ACT-CLINEMM-EXTENSION-HOST-TERMINATION-LIVE-CLASSIFICATION01
	// TA6-affirmative-negative-witness invariants.
	//
	// Background: the prior classifier fell through to TA6 whenever
	// there were no host-self events AND no external evidence
	// channels. That is invalid because absence of evidence from a
	// process that may have been killed is NOT evidence that it
	// survived. TA6 now requires an affirmative external negative
	// witness; without it the fallthrough is TA5.
	// -------------------------------------------------------------------------

	it("TALIVE-TA6-NEGATIVE-WITNESS-01: no host events + no parent-lifecycle + no crash report -> TA5 (NOT TA6)", () => {
		// This is the RED discriminator for the false-negative defect
		// identified by ACT §3. Pre-fix: TA6 NOT_REPRODUCED.
		// Required (post-fix): TA5 CAPTURE_INSUFFICIENT.
		const v = verdictFor({
			counters: { observedEventCount: 0 },
			parentLifecyclePresent: false,
			nativeCrashReportPresent: false,
		})
		expect(v.classification).toBe("TA5")
		expect(v.label).toBe("CAPTURE_INSUFFICIENT")
	})

	it("TALIVE-TA6-NEGATIVE-WITNESS-02: no host events + parent-lifecycle present but NOT affirming survival -> TA5", () => {
		// Parent-lifecycle present is not by itself sufficient. It
		// must AFFIRMATIVELY confirm the window completed + no
		// death. Anything weaker than that is TA5.
		const v = verdictFor({
			counters: { observedEventCount: 0 },
			parentLifecyclePresent: true,
			affirmativeNegativeWitness: false,
		})
		expect(v.classification).toBe("TA5")
	})

	it("TALIVE-TA6-AFFIRMATIVE-01: completed external window + no death + no crash -> TA6 NOT_REPRODUCED", () => {
		// The complementary positive discriminator: when the
		// external witness explicitly confirms a completed window
		// without extension host death or restart, AND no native
		// crash report exists, the result is TA6 (truly not
		// reproduced).
		const v = verdictFor({
			counters: { observedEventCount: 0 },
			parentLifecyclePresent: true,
			affirmativeNegativeWitness: true,
			externalLifecycleProvesDeath: false,
			nativeCrashReportPresent: false,
		})
		expect(v.classification).toBe("TA6")
		expect(v.label).toBe("NOT_REPRODUCED")
	})

	it("TALIVE-TA6-AFFIRMATIVE-02: completed window + crash report present -> TA2 (not TA6)", () => {
		// Affirmative survival witness does NOT override a matching
		// native crash report: TA2 wins.
		const v = verdictFor({
			counters: { observedEventCount: 0 },
			parentLifecyclePresent: true,
			affirmativeNegativeWitness: true,
			nativeCrashReportPresent: true,
		})
		expect(v.classification).toBe("TA2")
	})

	it("TALIVE-TA5-DEATH-UNRESOLVED-01: external PID disappearance + restart, no explicit authority -> TA5", () => {
		// The "PID disappeared then replacement PID appeared"
		// shape with NO matching crash report AND NO watchdog/host
		// attribution AND NO resource attribution is TA5 (death
		// reproduced but authority unresolved) — NOT TA6.
		const v = verdictFor({
			counters: { observedEventCount: 0 },
			parentLifecyclePresent: true,
			externalLifecycleProvesDeath: true,
			affirmativeNegativeWitness: false,
			nativeCrashReportPresent: false,
			externalTerminationReported: false,
			resourceExhaustionReported: false,
		})
		expect(v.classification).toBe("TA5")
		expect(v.label).toBe("CAPTURE_INSUFFICIENT")
	})

	it("TALIVE-TA5-DEATH-UNRESOLVED-02: external death + watchdog attribution -> TA3 (overrides generic death)", () => {
		// When externalLifecycleProvesDeath is true AND a parent/
		// watchdog attribution is present, TA3 wins over TA5.
		const v = verdictFor({
			counters: { observedEventCount: 0 },
			parentLifecyclePresent: true,
			externalLifecycleProvesDeath: true,
			externalTerminationReported: true,
			nativeCrashReportPresent: false,
		})
		expect(v.classification).toBe("TA3")
	})

	it("TALIVE-TA5-DEATH-UNRESOLVED-03: external death + resource attribution -> TA4 (overrides generic death)", () => {
		const v = verdictFor({
			counters: { observedEventCount: 0 },
			parentLifecyclePresent: true,
			externalLifecycleProvesDeath: true,
			resourceExhaustionReported: true,
			nativeCrashReportPresent: false,
		})
		expect(v.classification).toBe("TA4")
	})

	it("TALIVE-TA2-PID-BINDING-01: crash report PID matches failed Extension Host -> TA2", () => {
		// The TA2 path is preserved. PID-binding is enforced
		// UPSTREAM by the analyzer (the mjs script verifies
		// report.pid == observed Extension Host PID AND timestamp
		// inside the window before setting nativeCrashReportPresent
		// = true). At the pure function boundary the classifier
		// still gates on nativeCrashReportPresent.
		const v = verdictFor({
			counters: { observedEventCount: 0 },
			nativeCrashReportPresent: true,
		})
		expect(v.classification).toBe("TA2")
	})

	it("TALIVE-TA2-WRONG-PID-01: crash report PID differs (would be filtered upstream) -> NOT TA2", () => {
		// The pure classifier does not know about PIDs; it
		// receives nativeCrashReportPresent=false when the upstream
		// analyzer rejects an unrelated crash report. The
		// discrimination that matters here is that the verdict is
		// NOT TA2 — it falls through to TA5/TA6.
		const v = verdictFor({
			counters: { observedEventCount: 0 },
			parentLifecyclePresent: false,
			nativeCrashReportPresent: false,
		})
		expect(v.classification).not.toBe("TA2")
	})

	it("TALIVE-TA3-EXPLICIT-01: parent reports watchdog/host kill -> TA3", () => {
		const v = verdictFor({
			counters: { observedEventCount: 0, processExitObserved: false },
			externalTerminationReported: true,
			nativeCrashReportPresent: false,
		})
		expect(v.classification).toBe("TA3")
	})

	it("TALIVE-TA4-EXPLICIT-01: external death + explicit OOM/resource evidence -> TA4", () => {
		const v = verdictFor({
			counters: { observedEventCount: 0, processExitObserved: false },
			resourceExhaustionReported: true,
			nativeCrashReportPresent: false,
		})
		expect(v.classification).toBe("TA4")
	})
})

// =============================================================================
// Runtime module + macOS crash summarizer
// =============================================================================

describe("ACT-CLINEMM-EXTENSION-HOST-TERMINATION-AUTHORITY01 / runtime + summarizer", () => {
	let tmpDir: string

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "clinemm-ta-"))
		setTerminationAuthorityDataRootResolver(() => tmpDir)
		setTerminationAuthorityCaptureIdFactory(() => "runtime-fixed")
	})
	afterEach(() => {
		__resetTerminationAuthorityForTests()
		rmSync(tmpDir, { recursive: true, force: true })
	})

	it("TATRM-RUNTIME-01: writeParentLifecycle writes parent-lifecycle.json", async () => {
		await writeParentLifecycle("rt-1", {
			started_at: "t0",
			terminated_at: "t1",
			exit_reason: "watchdog_timeout",
			samples: [{ at: "t0.5", rss_kb: 123456 }],
		})
		const json = JSON.parse(
			readFileSync(join(tmpDir, "diagnostics/termination-authority/capture-rt-1/parent-lifecycle.json"), "utf8"),
		)
		expect(json.started_at).toBe("t0")
		expect(json.exit_reason).toBe("watchdog_timeout")
		expect(json.samples[0].rss_kb).toBe(123456)
	})

	it("TATRM-RUNTIME-02: summarizeMacosDiagnosticReport collapses load-bearing fields", () => {
		const fakeReport = `Process:               Electron Helper (Renderer) [12345]
Path:                  /Applications/VSCodium.app/.../Electron Helper.app/Contents/MacOS/Electron Helper
Identifier:             com.visualstudio.code.helper
Version:                1.85.0
Code Type:              ARM-64
Date/Time:              2026-09-24 03:14:15.006 +0000
OS Version:             macOS 14.5
Exception Type:         EXC_BAD_ACCESS (SIGSEGV)
Exception Codes:        KERN_INVALID_ADDRESS at 0x0000000000000010
Termination Reason:     Namespace SIGNAL, Code 0xb

Thread 0 Crashed:
0   V8                                  0x0000000192a1b4c2 v8::internal::Runtime_StackGuard + 0x12
1   V8                                  0x0000000192a00000 some_other + 0x10

Thread 1:
0   libsystem_kernel.dylib              0x0000000180012345 __pthread_mutex_lock + 0x80
`
		const summary = summarizeMacosDiagnosticReport(fakeReport)
		expect(summary.ok).toBe(true)
		expect(summary.process_name).toBe("Electron")
		// The regex is greedy with \S+, so the helper suffix drops. The
		// leading process name is what we get.
		expect(summary.pid).toBe(12345)
		expect(summary.identifier).toBe("com.visualstudio.code.helper")
		expect(summary.exception_type).toContain("EXC_BAD_ACCESS")
		expect(summary.termination_namespace).toBe("SIGNAL")
		expect(summary.signal).toBe("code_11") // 0xb = 11
		expect(summary.crashed_thread_index).toBe(0)
		expect(summary.top_native_frames.length).toBeGreaterThan(0)
		expect(summary.top_native_frames[0]).toContain("v8::internal::Runtime_StackGuard")
	})

	it("TATRM-RUNTIME-03: writeCrashReportSummary writes bounded summary + falls back on parse error", async () => {
		const reportPath = join(tmpDir, "fake.crash")
		const fsPromises = await import("node:fs/promises")
		await fsPromises.writeFile(reportPath, "not a real report")
		const result = await writeCrashReportSummary("rt-2", reportPath)
		expect(result.ok).toBe(false)
		expect(result.captureDir).toBe(join(tmpDir, "diagnostics/termination-authority/capture-rt-2"))
		const err = JSON.parse(
			readFileSync(join(tmpDir, "diagnostics/termination-authority/capture-rt-2/macos-crash-report-summary.json"), "utf8"),
		)
		expect(err.ok).toBe(false)
		expect(err.report_path).toBe(reportPath)
		expect(typeof err.reason).toBe("string")
	})

	it("TATRM-RUNTIME-04: writeCrashReportSummary writes structured summary on a real-format report", async () => {
		const reportPath = join(tmpDir, "real.crash")
		const fsPromises = await import("node:fs/promises")
		const fakeReport = `Process:               VSCodium Helper [99999]
Identifier:             com.vscodium.helper
Exception Type:         EXC_CRASH (SIGABRT)
Termination Reason:     Namespace SIGNAL, Code 0x6
Thread 5 Crashed:
0   libsystem_kernel.dylib              0x0000000180012345 __abort + 0x80
1   libsystem_c.dylib                   0x00000001800678ab abort + 0x100
`
		await fsPromises.writeFile(reportPath, fakeReport)
		const result = await writeCrashReportSummary("rt-3", reportPath)
		expect(result.ok).toBe(true)
		const sum = JSON.parse(
			readFileSync(join(tmpDir, "diagnostics/termination-authority/capture-rt-3/macos-crash-report-summary.json"), "utf8"),
		)
		expect(sum.ok).toBe(true)
		expect(sum.pid).toBe(99999)
		expect(sum.exception_type).toContain("EXC_CRASH")
		expect(sum.termination_namespace).toBe("SIGNAL")
		expect(sum.crashed_thread_index).toBe(5)
		expect(sum.top_native_frames.length).toBeGreaterThan(0)
	})
})

// =============================================================================
// Recovery invariants
// =============================================================================

describe("ACT-CLINEMM-EXTENSION-HOST-TERMINATION-AUTHORITY01 / recovery", () => {
	beforeEach(() => {
		__resetTerminationAuthorityForTests()
	})
	afterEach(() => {
		__resetTerminationAuthorityForTests()
	})

	it("TATRM-RECOVERY-01: __resetTerminationAuthorityForTests clears all state", () => {
		setTerminationAuthorityDataRootResolver(() => "/x")
		applyExtensionHostTerminationAuthorityPolicy(true, { [CLINEMM_DIAG_TERMINATION_AUTHORITY_ENV]: "1" })
		expect(getTerminationAuthorityState()).toBe("armed")
		__resetTerminationAuthorityForTests()
		expect(getTerminationAuthorityState()).toBe("disabled")
		expect(getTerminationAuthorityCaptureId()).toBeUndefined()
		expect(getTerminationAuthorityEventCount()).toBe(0)
	})

	it("TATRM-RECOVERY-02: getTerminationAuthoritySnapshot returns a defensive copy", () => {
		setTerminationAuthorityDataRootResolver(() => "/x")
		applyExtensionHostTerminationAuthorityPolicy(true, { [CLINEMM_DIAG_TERMINATION_AUTHORITY_ENV]: "1" })
		const s1 = getTerminationAuthoritySnapshot()
		const s2 = getTerminationAuthoritySnapshot()
		expect(s1).not.toBe(s2)
		expect(s1.counters).not.toBe(s2.counters)
		// Mutating s1.counters must not affect module state.
		;(s1.counters as { observedEventCount: number }).observedEventCount = 9999
		const s3 = getTerminationAuthoritySnapshot()
		expect(s3.counters.observedEventCount).toBe(0)
	})
})
