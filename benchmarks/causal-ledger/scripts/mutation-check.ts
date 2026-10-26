#!/usr/bin/env bun
/**
 * BENCHMARK-M3-M31-CAUSAL-LEDGER-01 — mutation harness
 *
 * Demonstrates that the test suite genuinely detects a defective
 * implementation (RED) and that the corrected implementation passes (GREEN).
 *
 * The harness:
 *   1. snapshots `src/terminal-ledger.ts`,
 *   2. applies a named mutation that breaks a load-bearing invariant,
 *   3. runs the test suite and REQUIRES it to FAIL (RED),
 *   4. restores the snapshot and runs the suite again, REQUIRES it to PASS
 *      (GREEN),
 *   5. restores the snapshot no matter what.
 *
 * Usage:
 *   bun scripts/mutation-check.ts
 *
 * Exit codes:
 *   0 — the mutation was caught (RED) and the pristine code passed (GREEN)
 *   1 — the mutation was NOT caught, or the pristine code failed
 *   2 — harness error (missing files, etc.)
 */

import { copyFileSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(import.meta.dir, "..")
const TARGET = join(ROOT, "src", "terminal-ledger.ts")
const SNAPSHOT = join(ROOT, ".mutation-snapshot.ts")

interface Mutation {
	readonly name: string
	/** The exact text to find. Must occur exactly once. */
	readonly find: string
	/** The replacement text. */
	readonly replace: string
	/** The test that must fail under this mutation. */
	readonly expectedFailingTest: string
}

const MUTATIONS: readonly Mutation[] = [
	{
		name: "drop-the-after-terminal-conjunct",
		find: "const consumedAfterTerminal = state.observationSeqs.some((seq) => seq > terminalSeq)",
		replace: "const consumedAfterTerminal = state.observationSeqs.length > 0",
		expectedFailingTest: "an observation BEFORE the terminal confirmation does not discharge the obligation",
	},
	{
		name: "ignore-the-containment-classification",
		find: 'if (state.containment !== "gone") {',
		replace: "if (false) {",
		expectedFailingTest: "a `failed` containment blocks completion even when an observation exists",
	},
	{
		name: "correlate-on-job-id-only",
		find: "if (ownerKey(state.owner) !== ownerKey(event.owner)) {",
		replace: "if (false) {",
		expectedFailingTest: "a foreign session registering the same job ID cannot discharge the owner's obligation",
	},
]

async function runTests(): Promise<{ exitCode: number; output: string }> {
	const proc = Bun.spawn(["bun", "test", "tests/"], {
		cwd: ROOT,
		stdout: "pipe",
		stderr: "pipe",
	})
	const [output, errors, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	])
	return { exitCode, output: `${output}\n${errors}` }
}

function fail(message: string, code: number): never {
	process.stderr.write(`${message}\n`)
	process.exit(code)
}

const pristine = readFileSync(TARGET, "utf8")

async function main(): Promise<void> {
	for (const mutation of MUTATIONS) {
		const occurrences = pristine.split(mutation.find).length - 1
		if (occurrences !== 1) {
			fail(`mutation "${mutation.name}": expected exactly one match for the anchor, found ${occurrences}`, 2)
		}

		// --- RED: apply the mutation and require the suite to FAIL -----------
		const mutated = pristine.replace(mutation.find, mutation.replace)
		writeFileSync(SNAPSHOT, pristine)
		writeFileSync(TARGET, mutated)
		const red = await runTests()
		copyFileSync(SNAPSHOT, TARGET)

		const redCaught = red.exitCode !== 0
		const namedTestFailed = red.output.includes(mutation.expectedFailingTest) && red.output.includes("✗")
		process.stdout.write(
			`RED  ${mutation.name}: exit=${red.exitCode} caught=${redCaught} namedTestFailed=${namedTestFailed}\n`,
		)
		if (!redCaught) {
			fail(`mutation "${mutation.name}" was NOT caught by the test suite (expected RED)`, 1)
		}
		if (!namedTestFailed) {
			fail(`mutation "${mutation.name}" did not fail the expected test "${mutation.expectedFailingTest}"`, 1)
		}

		// --- GREEN: restore and require the suite to PASS --------------------
		const green = await runTests()
		process.stdout.write(`GREEN ${mutation.name}: exit=${green.exitCode}\n`)
		if (green.exitCode !== 0) {
			fail(`pristine implementation FAILED after restoring (expected GREEN)`, 1)
		}
	}

	process.stdout.write(
		`\nAll ${MUTATIONS.length} mutations were caught (RED) and the pristine implementation passed (GREEN).\n`,
	)
}

try {
	await main()
} finally {
	// Always leave the pristine implementation in place.
	writeFileSync(TARGET, pristine)
}
