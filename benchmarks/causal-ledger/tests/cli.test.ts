/**
 * BENCHMARK-M3-M31-CAUSAL-LEDGER-01 — CLI test
 *
 * Drives the CLI as a real subprocess against a real JSON file. No mocks.
 */

import { describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const CLI = join(import.meta.dir, "..", "src", "cli.ts")

const OWNER = { sessionId: "s1", taskId: "t1", epoch: 7 }

function writeEvents(events: unknown[]): string {
	const dir = mkdtempSync(join(tmpdir(), "causal-ledger-"))
	const file = join(dir, "events.json")
	writeFileSync(file, JSON.stringify(events, null, 2))
	return file
}

async function runCli(args: string[]) {
	const proc = Bun.spawn(["bun", CLI, ...args], {
		stdout: "pipe",
		stderr: "pipe",
	})
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	])
	return { stdout, stderr, exitCode }
}

describe("causal-ledger CLI", () => {
	test("prints the analysis report for a JSON file", async () => {
		const file = writeEvents([
			{ type: "job_registered", seq: 1, eventId: "e1", jobId: "j1", owner: OWNER },
			{ type: "job_terminal", seq: 2, eventId: "e2", jobId: "j1", containment: "gone", owner: OWNER },
			{ type: "terminal_observed", seq: 3, eventId: "e3", jobId: "j1", owner: OWNER },
			{ type: "completion_requested", seq: 4, eventId: "e4", decisionId: "d1", owner: OWNER },
		])
		const { stdout, stderr, exitCode } = await runCli([file])
		expect(exitCode).toBe(0)
		expect(stderr).toBe("")
		const report = JSON.parse(stdout)
		expect(report.valid).toBe(true)
		expect(report.decisions[0].decisionId).toBe("d1")
		expect(report.decisions[0].decision).toBe("ALLOW")
	})

	test("the CLI output is deterministic across runs", async () => {
		const file = writeEvents([
			{ type: "job_registered", seq: 1, eventId: "e1", jobId: "j1", owner: OWNER },
			{ type: "completion_requested", seq: 2, eventId: "e2", decisionId: "d1", owner: OWNER },
		])
		const first = await runCli([file])
		const second = await runCli([file])
		expect(first.stdout).toBe(second.stdout)
	})

	test("exits non-zero with a usage error when no file is given", async () => {
		const { stderr, exitCode } = await runCli([])
		expect(exitCode).toBe(1)
		expect(stderr).toContain("usage:")
	})

	test("exits non-zero when the file cannot be read", async () => {
		const { stderr, exitCode } = await runCli([join(tmpdir(), "definitely-not-here.json")])
		expect(exitCode).toBe(1)
		expect(stderr).toContain("unable to read")
	})

	test("exits non-zero on malformed JSON", async () => {
		const dir = mkdtempSync(join(tmpdir(), "causal-ledger-"))
		const file = join(dir, "broken.json")
		writeFileSync(file, "{not json")
		const { stderr, exitCode } = await runCli([file])
		expect(exitCode).toBe(1)
		expect(stderr).toContain("unable to parse")
	})

	test("--pretty emits indented JSON", async () => {
		const file = writeEvents([{ type: "job_registered", seq: 1, eventId: "e1", jobId: "j1", owner: OWNER }])
		const { stdout, exitCode } = await runCli([file, "--pretty"])
		expect(exitCode).toBe(0)
		expect(stdout).toContain("\n  ")
	})
})
