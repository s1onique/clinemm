#!/usr/bin/env bun
/**
 * BENCHMARK-M3-M31-CAUSAL-LEDGER-01 — CLI
 *
 * Reads a JSON file containing an array of terminal-ledger events and prints
 * the deterministic JSON analysis report on stdout.
 *
 * Usage:
 *   bun src/cli.ts <events.json>
 *   bun src/cli.ts <events.json> --pretty
 *
 * Exit codes:
 *   0 — the report was produced (see `report.valid` / `report.ok`)
 *   1 — usage error or unreadable/invalid JSON input
 */

import { readFileSync } from "node:fs"
import { analyzeTerminalLedger } from "./terminal-ledger.ts"

function fail(message: string): never {
	process.stderr.write(`${message}\n`)
	process.exit(1)
}

const args = process.argv.slice(2)
const filePath = args.find((arg) => !arg.startsWith("--"))
const pretty = args.includes("--pretty")

if (!filePath) {
	fail("usage: bun src/cli.ts <events.json> [--pretty]")
}

let raw: string
try {
	raw = readFileSync(filePath, "utf8")
} catch (error) {
	fail(`unable to read ${filePath}: ${(error as Error).message}`)
}

let parsed: unknown
try {
	parsed = JSON.parse(raw)
} catch (error) {
	fail(`unable to parse ${filePath} as JSON: ${(error as Error).message}`)
}

const report = analyzeTerminalLedger(Array.isArray(parsed) ? parsed : [parsed])

process.stdout.write(`${JSON.stringify(report, null, pretty ? 2 : 0)}\n`)
