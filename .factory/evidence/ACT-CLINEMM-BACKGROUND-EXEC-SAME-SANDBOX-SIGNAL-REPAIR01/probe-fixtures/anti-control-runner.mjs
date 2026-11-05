#!/usr/bin/env node
/**
 * Process-free anti-control runner for
 * ACT-CLINEMM-BACKGROUND-EXEC-SAME-SANDBOX-SIGNAL-REPAIR01.
 * Marker: CLINEMM_REPAIR01_ANTI_CONTROL_RUNNER
 *
 * WHAT THIS PROVES
 * ----------------
 * For every unsafe signal-target shape named by the review — stale PID,
 * missing identity, expired target, changed argv, unreadable process
 * metadata (plus changed start identity, changed uid, changed pgid and an
 * EPERM target) — the qualification fixtures MUST NOT issue a destructive
 * signal.  This runner executes the REAL fixture code paths in their
 * `--anti-control` mode and asserts:
 *
 *   1. `destructiveSignalsIssued` is EMPTY for every unsafe scenario;
 *   2. the fixture reports `HALT_UNSAFE_FIXTURE`;
 *   3. the gate refused for the documented reason.
 *
 * It also runs a `healthy` CONTROL scenario that MUST deliver a signal, so
 * the anti-controls cannot pass vacuously.
 *
 * The runner spawns ONLY its own `node` child processes running the
 * fixtures in anti-control mode.  Those children observe and signal NO real
 * process.
 *
 * Output:
 *   ANTI_CONTROL_RESULT_JSON=<json>   (authoritative)
 */
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { ANTI_CONTROL_SCENARIOS, ANTI_CONTROL_MARKER } from "./anti-control-scenarios.mjs"

const MARKER = "CLINEMM_REPAIR01_ANTI_CONTROL_RUNNER"
const HERE = dirname(fileURLToPath(import.meta.url))
const FOREIGN_FIXTURE = join(HERE, "foreign-signal-attempt.mjs")
const PGID_FIXTURE = join(HERE, "pgid-cancellation-fixture.mjs")
const CHILD_TIMEOUT_MS = 15_000

function runFixture(script, args) {
	return new Promise((resolve) => {
		const child = spawn(process.execPath, [script, ...args], {
			stdio: ["ignore", "pipe", "pipe"],
		})
		let stdout = ""
		let stderr = ""
		let timedOut = false
		const timer = setTimeout(() => {
			timedOut = true
			child.kill("SIGKILL")
		}, CHILD_TIMEOUT_MS)
		child.stdout.on("data", (d) => {
			stdout += d.toString()
		})
		child.stderr.on("data", (d) => {
			stderr += d.toString()
		})
		child.once("exit", (code) => {
			clearTimeout(timer)
			resolve({ code, stdout, stderr, timedOut })
		})
	})
}

function parseResultLine(stdout, prefix) {
	const line = stdout.split("\n").find((l) => l.startsWith(prefix))
	if (!line) return null
	try {
		return JSON.parse(line.slice(prefix.length))
	} catch {
		return null
	}
}

const scenarios = Object.keys(ANTI_CONTROL_SCENARIOS)
const cases = []

for (const name of scenarios) {
	const expectation = ANTI_CONTROL_SCENARIOS[name].expect

	const foreignRun = await runFixture(FOREIGN_FIXTURE, ["0", "--anti-control", name])
	const foreign = parseResultLine(foreignRun.stdout, "FOREIGN_SIGNAL_RESULT_JSON=")

	const pgidRun = await runFixture(PGID_FIXTURE, ["--anti-control", name])
	const pgid = parseResultLine(pgidRun.stdout, "PGID_RESULT_JSON=")

	const failures = []
	for (const [label, payload] of [
		["foreign", foreign],
		["pgid", pgid],
	]) {
		if (!payload) {
			failures.push(`${label}:no-result (exit=${payload ? "?" : foreignRun.code}/${pgidRun.code})`)
			continue
		}
		const issued = payload.destructiveSignalsIssued ?? []
		if (!expectation.expectSignal) {
			if (issued.length !== 0) {
				failures.push(`${label}:DESTRUCTIVE-SIGNAL-ISSUED ${JSON.stringify(issued)}`)
			}
			if (payload.halt !== "HALT_UNSAFE_FIXTURE") {
				failures.push(`${label}:expected HALT_UNSAFE_FIXTURE, got ${payload.halt}`)
			}
			if (payload.signalAttempt?.skipped !== true) {
				failures.push(`${label}:expected signalAttempt.skipped=true`)
			}
		} else {
			if (issued.length !== 1) {
				failures.push(`${label}:control expected exactly 1 recorded signal, got ${issued.length}`)
			}
			if (payload.halt !== null && payload.halt !== undefined) {
				failures.push(`${label}:control expected no halt, got ${payload.halt}`)
			}
		}
		// The refusal reason must match the documented expectation.
		const reason = payload.haltReason ?? ""
		if (!expectation.expectSignal && typeof expectation.reasonContains === "string" && expectation.reasonContains.length > 0) {
			if (!reason.includes(expectation.reasonContains)) {
				failures.push(
					`${label}:expected reason to contain "${expectation.reasonContains}", got "${reason}"`,
				)
			}
		}

		// P1 CONTRACT ADJUSTMENT (bounded, 2026-11-05) — machine-checked.
		//
		// When the gate refuses because the signal-zero authorization probe
		// returned EPERM, NO signal was attempted.  The result must therefore
		// carry the separately labelled NON-DELIVERY authorization denial and
		// must NOT claim that a SIGTERM was attempted and returned EPERM.
		//
		// Asserting this here prevents the qualification from being able to
		// satisfy its success criterion by misreporting the outcome.
		if (reason.includes("target-unsignalable")) {
			const denial = payload.authorizationDenial
			if (!denial) {
				failures.push(`${label}:expected a separately labelled authorizationDenial`)
			} else {
				if (denial.outcome !== "AUTHORIZATION_DENIED_EPERM") {
					failures.push(`${label}:authorizationDenial.outcome != AUTHORIZATION_DENIED_EPERM`)
				}
				if (denial.deliversSignal !== false) {
					failures.push(`${label}:authorizationDenial.deliversSignal must be false`)
				}
				if (denial.signalAttempted !== false) {
					failures.push(`${label}:authorizationDenial.signalAttempted must be false`)
				}
				if (denial.errnoCode !== "EPERM") {
					failures.push(`${label}:authorizationDenial.errnoCode != EPERM`)
				}
			}
			// The misrepresented shape — an "attempted SIGTERM" with errno EPERM
			// — must be ABSENT, because no signal was attempted.
			if (payload.signalAttempt?.skipped !== true) {
				failures.push(`${label}:expected signalAttempt.skipped=true (no signal attempted)`)
			}
			if (payload.signalAttempt?.errnoCode !== undefined && payload.signalAttempt?.errnoCode !== null) {
				failures.push(
					`${label}:signalAttempt.errnoCode must be null when no signal was attempted, got ${payload.signalAttempt?.errnoCode}`,
				)
			}
		}
	}

	cases.push({
		scenario: name,
		description: ANTI_CONTROL_SCENARIOS[name].description,
		expectation,
		foreign: foreign
			? { halt: foreign.halt, haltReason: foreign.haltReason, signals: foreign.destructiveSignalsIssued }
			: null,
		pgid: pgid
			? { halt: pgid.halt, haltReason: pgid.haltReason, signals: pgid.destructiveSignalsIssued }
			: null,
		pass: failures.length === 0,
		failures,
	})
}

const failed = cases.filter((c) => !c.pass)
const summary = {
	marker: MARKER,
	scenarioModule: ANTI_CONTROL_MARKER,
	total: cases.length,
	passed: cases.length - failed.length,
	failed: failed.length,
	processFree: true,
	cases,
	verdict: failed.length === 0 ? "PASS_ANTI_CONTROLS" : "FAIL_ANTI_CONTROLS",
}

console.log(`ANTI_CONTROL_RESULT_JSON=${JSON.stringify(summary)}`)
for (const c of cases) {
	console.log(
		`[anti-control] ${c.pass ? "PASS" : "FAIL"} ${c.scenario} — foreign=${
			c.foreign?.halt ?? "none"
		} pgid=${c.pgid?.halt ?? "none"}${c.failures.length ? ` :: ${c.failures.join("; ")}` : ""}`,
	)
}
process.exit(failed.length === 0 ? 0 : 1)
