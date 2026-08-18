#!/usr/bin/env bun
/**
 * Machine-enforced baseline wrapper for the C2.4-C bridge typecheck.
 *
 * Runs `bunx tsc --project tsconfig.c2-4-c-bridge.json --noEmit`,
 * canonicalizes the resulting diagnostic set, and verifies it
 * exactly matches the frozen baseline encoded in
 * `apps/vscode/baselines/c2-4-c-bridge-ts-baseline.json`.
 *
 * Exits 0 if and only if the observed diagnostic set equals the
 * baseline (no more, no fewer, no different). Any change in
 * `task-state-shadow.ts(169)` (or any other transitive production
 * error introduced by pulling in the SDK source) is flagged.
 *
 * The baseline file is a JSON list of entries:
 *
 *   { file: string; line: number; col: number; code: number; message: string }
 *
 * where `code` is the TS error code (e.g. 2304) and `message` is the
 * canonical text. The combination (file,line,col,code,message)
 * identifies a diagnostic uniquely.
 *
 * To add a new error to the baseline (e.g. after a legitimate fix
 * to production wiring):
 *
 *   1. Edit the production code.
 *   2. Re-run this script with BRIDGE_BASELINE_UPDATE=1 to refresh
 *      the baseline file:
 *
 *        BRIDGE_BASELINE_UPDATE=1 bun run check-types-bridge-with-baseline
 *
 *   3. Commit the updated baseline alongside the production change
 *      with an explicit justification in the commit message.
 */
import { spawnSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

interface Diagnostic {
	file: string
	line: number
	col: number
	code: number
	message: string
}

const REPO_ROOT = resolve(import.meta.dir, "..")
const TSCONFIG = resolve(REPO_ROOT, "tsconfig.c2-4-c-bridge.json")
const BASELINE_PATH = resolve(REPO_ROOT, "baselines", "c2-4-c-bridge-ts-baseline.json")

/**
 * Runs `tsc` and returns the parsed diagnostics together with
 * execution metadata. Validates that the compiler invocation itself
 * succeeded as a TypeScript process; a spawn failure, signal
 * termination, or any non-parseable failure MUST throw rather than
 * returning an empty diagnostic set. Without this, an infrastructure
 * failure could overwrite a baseline to `[]` and then pass a future
 * identical failure as `[] == []` (false-pass hazard).
 *
 * Acceptable outcomes:
 *   - status === 0  and  diagnostics.length === 0
 *   - nonzero status with one or more parsed diagnostics
 *
 * Rejected (throw):
 *   - result.error (spawn failure, ENOENT, etc.)
 *   - signal !== null (terminated by signal)
 *   - nonzero status with zero parsed diagnostics
 *     (compiler exited non-cleanly without a recognized diagnostic)
 */
function runTsc(): readonly Diagnostic[] {
	const result = spawnSync("bunx", ["tsc", "--project", TSCONFIG, "--noEmit", "--pretty", "false"], {
		cwd: REPO_ROOT,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	})

	if (result.error) {
		throw new Error(`tsc spawn failed: ${result.error.message}`)
	}
	if (result.signal !== null) {
		throw new Error(`tsc terminated by signal ${result.signal}`)
	}

	const out = (result.stdout ?? "") + (result.stderr ?? "")
	const diagnostics: Diagnostic[] = []
	const re = /^(.+)\((\d+),(\d+)\): error TS(\d+): (.+)$/
	for (const line of out.split("\n")) {
		const m = re.exec(line.trim())
		if (!m) continue
		const [, file, lineStr, colStr, codeStr, message] = m
		diagnostics.push({
			file,
			line: Number(lineStr),
			col: Number(colStr),
			code: Number(codeStr),
			message: message.trim(),
		})
	}

	if (result.status !== 0 && diagnostics.length === 0) {
		throw new Error(
			`tsc exited with status ${result.status} but no parseable diagnostics were emitted.\n` +
				`--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`,
		)
	}

	return diagnostics
}

function canonicalize(diagnostics: readonly Diagnostic[]): string {
	// Sort for stable comparison: file, line, col, code, message.
	const sorted = [...diagnostics].sort((a, b) => {
		if (a.file !== b.file) return a.file.localeCompare(b.file)
		if (a.line !== b.line) return a.line - b.line
		if (a.col !== b.col) return a.col - b.col
		if (a.code !== b.code) return a.code - b.code
		return a.message.localeCompare(b.message)
	})
	return JSON.stringify(sorted, null, 2) + "\n"
}

function diagnosticKey(d: Diagnostic): string {
	// Identifies a diagnostic uniquely. Using a single canonical JSON
	// encoding for the tuple makes set comparisons and reports
	// coherent — comparing JSON lines of an array can fragment a
	// single record across multiple lines.
	return JSON.stringify([d.file, d.line, d.col, d.code, d.message])
}

function main(): void {
	let observed: readonly Diagnostic[]
	try {
		observed = runTsc()
	} catch (e) {
		console.error("[check-types-bridge-with-baseline] FAIL — tsc invocation did not complete cleanly.")
		console.error(e instanceof Error ? e.message : String(e))
		process.exit(2)
	}
	const observedCanonical = canonicalize(observed)

	if (process.env.BRIDGE_BASELINE_UPDATE === "1") {
		writeFileSync(BASELINE_PATH, observedCanonical)
		console.log(`[check-types-bridge-with-baseline] wrote ${observed.length} diagnostic(s) to ${BASELINE_PATH}`)
		return
	}

	const baselineRaw = readFileSync(BASELINE_PATH, "utf8")
	const baseline = JSON.parse(baselineRaw) as readonly Diagnostic[]
	const baselineCanonical = canonicalize(baseline)

	if (observedCanonical === baselineCanonical) {
		console.log(`[check-types-bridge-with-baseline] OK — ${observed.length} diagnostic(s) match the frozen baseline.`)
		process.exit(0)
	}

	console.error("[check-types-bridge-with-baseline] FAIL")
	console.error(`Observed: ${observed.length} diagnostic(s)`)
	console.error(`Baseline: ${baseline.length} diagnostic(s)`)
	const observedKeys = new Set(observed.map(diagnosticKey))
	const baselineKeys = new Set(baseline.map(diagnosticKey))
	const added = observed.filter((d) => !baselineKeys.has(diagnosticKey(d)))
	const removed = baseline.filter((d) => !observedKeys.has(diagnosticKey(d)))
	if (added.length) {
		console.error("\nADDED (not in baseline):")
		for (const d of added) console.error("  " + diagnosticKey(d))
	}
	if (removed.length) {
		console.error("\nREMOVED (in baseline, not observed):")
		for (const d of removed) console.error("  " + diagnosticKey(d))
	}
	console.error("\nIf the change is intentional, refresh the baseline:")
	console.error("  BRIDGE_BASELINE_UPDATE=1 bun run check-types-bridge-with-baseline")
	process.exit(1)
}

main()
