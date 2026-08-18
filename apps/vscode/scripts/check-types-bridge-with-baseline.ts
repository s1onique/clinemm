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

function runTsc(): readonly Diagnostic[] {
	const result = spawnSync("bunx", ["tsc", "--project", TSCONFIG, "--noEmit", "--pretty", "false"], {
		cwd: REPO_ROOT,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	})
	// `tsc --noEmit` exits with the count of errors as the exit code
	// when there are errors. Output goes to stdout when --pretty false.
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

function main(): void {
	const observed = runTsc()
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
	const observedSet = new Set(observedCanonical.split("\n"))
	const baselineSet = new Set(baselineCanonical.split("\n"))
	const added = [...observedSet].filter((l) => !baselineSet.has(l))
	const removed = [...baselineSet].filter((l) => !observedSet.has(l))
	if (added.length) {
		console.error("\nADDED (not in baseline):")
		for (const l of added) console.error("  " + l)
	}
	if (removed.length) {
		console.error("\nREMOVED (in baseline, not observed):")
		for (const l of removed) console.error("  " + l)
	}
	console.error("\nIf the change is intentional, refresh the baseline:")
	console.error("  BRIDGE_BASELINE_UPDATE=1 bun run check-types-bridge-with-baseline")
	process.exit(1)
}

main()
