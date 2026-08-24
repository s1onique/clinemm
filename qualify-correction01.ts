// ACT-CLINEMM-COMMAND-RISK-V2-STDERR-DEVNULL-NEUTRAL01-CORRECTION01
// LIVE qualification harness for the rebuilt v4 helper.
//
// Drives `evaluateCommandRiskWithParser` against the seven test cases
// from the previous ACT closure report (positive 2, negative 5) and
// emits the full decision / disposition / pipelineSummary for each.
//
// This is a REAL_PRODUCTION_SEAM harness -- the vendored helper at
// sdk/packages/core/bin/parser-helper/darwin-arm64/cline-parser-helper
// is the source authority. The TS classifier is the production code.
//
// Per Factory review: this is "installed-extension-UI LIVE" only
// when the bundle produced from these tests has been packaged into
// an exact-head VSIX that the user has installed in their editor.
// Until then, this is REAL_PRODUCTION_SEAM, not LIVE. We label it
// that way in the closure report.
//
// Re-run:
//   bun qualify-correction01.ts

import { MvdanShHelper } from "./sdk/packages/core/src/runtime/command-policy/parser-helper/runtime"
import { evaluateCommandRiskWithParser } from "./sdk/packages/core/src/runtime/command-policy/command-risk-internal"
import type { CommandHostAuthorization } from "./sdk/packages/core/src/runtime/command-policy/command-policy-types"

const HELPER_PATH = "sdk/packages/core/bin/parser-helper/darwin-arm64/cline-parser-helper"

const SAFE: CommandHostAuthorization = {
	mode: "safe-only",
	autoApproveSafe: true,
	autoApproveAll: false,
}

type Case = {
	label: string
	cmd: string
	check: (r: ReturnType<typeof evaluateCommandRiskWithParser>) => boolean
	expect: string
}

const CASES: Case[] = [
	// POSITIVE discriminators -- must be auto-approve-eligible.
	{ label: "P1: ls -la .factory/evidence/ 2>/dev/null",
		cmd:  "ls -la .factory/evidence/ 2>/dev/null",
		expect: "allow + auto-approve-eligible",
		check: (r) => r.decision === "allow" && r.disposition === "auto-approve-eligible" },
	{ label: "P2: git status 2>/dev/null",
		cmd:  "git status 2>/dev/null",
		expect: "allow + auto-approve-eligible",
		check: (r) => r.decision === "allow" && r.disposition === "auto-approve-eligible" },

	// NEGATIVE controls -- must be ASK or never-auto-approve.
	{ label: "N1: persistent stderr 2>errors.txt",
		cmd:  "ls -la .factory/evidence/ 2>errors.txt",
		expect: "ask",
		check: (r) => r.decision === "ask" },
	{ label: "N2: dynamic target 2>\"$NULL_PATH\"",
		cmd:  'ls -la .factory/evidence/ 2>"$NULL_PATH"',
		expect: "ask",
		check: (r) => r.decision === "ask" },
	{ label: "N3: dangerous pipeline sibling | sh",
		cmd:  "ls -la .factory/evidence/ 2>/dev/null | sh",
		expect: "ask",
		check: (r) => r.decision === "ask" },
	{ label: "N4: mutating git sibling && git branch -D",
		cmd:  'git status 2>/dev/null && git branch -D __CLINEMM_SENTINEL__',
		expect: "ask",
		check: (r) => r.decision === "ask" },
	{ label: "N5: R5 hard floor rm -rf \"$HOME\"",
		cmd:  'rm -rf "$HOME" 2>/dev/null',
		expect: "ask + never-auto-approve",
		check: (r) => r.decision === "ask" && r.disposition === "never-auto-approve" },
]

async function main() {
	const helper = new MvdanShHelper({
		platform: "darwin-arm64",
		binaryPath: () => HELPER_PATH,
	})
	const cwd = process.cwd()
	console.log(`=== REAL_PRODUCTION_SEAM QUALIFICATION (CORRECTION01, ${new Date().toISOString()}) ===`)
	console.log(`helper         : ${HELPER_PATH}`)
	console.log(`cwd            : ${cwd}`)
	console.log("")

	let failed = 0
	for (const c of CASES) {
		const parsed = await helper.invoke({ command: c.cmd })
		if (!parsed) {
			console.log(`x ${c.label}`)
			console.log(`    helper returned null parse`)
			failed++
			continue
		}

		const r = evaluateCommandRiskWithParser({
			toolInput: c.cmd,
			hostAuthorization: SAFE,
			parserResult: parsed,
		})

		const ok = c.check(r)
		const tag = ok ? "OK" : "FAIL"
		if (!ok) failed++
		console.log(`${tag} ${c.label}`)
		console.log(`    cmd       : ${c.cmd}`)
		console.log(`    expect    : ${c.expect}`)
		console.log(`    protocolV : ${parsed.protocolVersion}`)
		console.log(`    decision  : ${r.decision}`)
		console.log(`    dispos.   : ${r.disposition}`)
		console.log("")
	}

	console.log("")
	console.log(`=== SUMMARY: ${CASES.length - failed}/${CASES.length} PASS ===`)
	if (failed > 0) {
		console.log(`FAILED: ${failed}`)
		process.exit(1)
	}
	process.exit(0)
}

main().catch((err) => {
	console.error("FATAL:", err)
	process.exit(2)
})
