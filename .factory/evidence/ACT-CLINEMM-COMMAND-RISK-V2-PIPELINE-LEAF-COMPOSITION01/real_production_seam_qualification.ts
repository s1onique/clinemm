// ACT-CLINEMM-COMMAND-RISK-V2-PIPELINE-LEAF-COMPOSITION01
// REAL_PRODUCTION_SEAM qualification harness.
//
// Mirrors qualify-correction01.ts but for THIS ACT's bounded
// scope: stdin-only reader extension to the parser-proven
// allowlist (echo + head + tail stdin-only).
//
// Real v4 helper + production classifier. Honest evidence-level
// label per CORRECTION01's reviewer directive: this is
// REAL_PRODUCTION_SEAM, NOT LIVE. LIVE requires installed-
// extension-UI user evidence, which is not produced here.
//
// Run: bun .factory/evidence/.../real_production_seam_qualification.ts

import { MvdanShHelper } from "../../../sdk/packages/core/src/runtime/command-policy/parser-helper/runtime"
import { evaluateCommandRiskWithParser } from "../../../sdk/packages/core/src/runtime/command-policy/command-risk-internal"
import { commandHostAuthorization } from "../../../sdk/packages/core/src/runtime/command-policy/command-policy-types"
import { DEFAULT_COMMAND_HOST_ALLOW_RULES } from "../../../sdk/packages/core/src/runtime/command-policy/command-safe-rules"

const SAFE = commandHostAuthorization({
	mode: "safe-only",
	explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
})

const helper = new MvdanShHelper({
	platform: "darwin-arm64",
	binaryPath: () => "/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/sdk/packages/core/bin/parser-helper/darwin-arm64/cline-parser-helper",
})

type Case = {
	cmd: string
	expect: string
	note: string
}

const CASES: Case[] = [
	// === POSITIVE: stdin-only readers (THIS ACT) ===
	{
		cmd: "head -30",
		expect: "allow/auto-approve-eligible",
		note: "POST-REPAIR: stdin-only reader parser-proven safe.",
	},
	{
		cmd: "head",
		expect: "allow/auto-approve-eligible",
		note: "POST-REPAIR: bare head, stdin-only.",
	},
	{
		cmd: "head -n 30",
		expect: "allow/auto-approve-eligible",
		note: "POST-REPAIR: head with -n value.",
	},
	{
		cmd: "head --",
		expect: "allow/auto-approve-eligible",
		note: "POST-REPAIR: head with explicit end-of-options.",
	},
	{
		cmd: "tail -20",
		expect: "allow/auto-approve-eligible",
		note: "POST-REPAIR: tail stdin-only.",
	},
	{
		cmd: "echo hello | head -30",
		expect: "allow/auto-approve-eligible",
		note: "POST-REPAIR: pipe composition (echo is V1-safe; head is parser-proven).",
	},
	{
		cmd: "pwd && head -30",
		expect: "allow/auto-approve-eligible",
		note: "POST-REPAIR: chain composition (pwd is V1-safe; head is parser-proven).",
	},

	// === CONSERVATION: path-bearing (must remain ASK) ===
	{
		cmd: "head some-file",
		expect: "ask",
		note: "CONSERVATION: path-bearing, V1 ASK (out of scope per reviewer P0).",
	},
	{
		cmd: "cat some-file",
		expect: "ask",
		note: "CONSERVATION: cat has no V1 rule; path-bearing not promoted.",
	},
	{
		cmd: "head --help",
		expect: "ask",
		note: "CONSERVATION: argv-shape reject.",
	},
	{
		cmd: "head --version",
		expect: "ask",
		note: "CONSERVATION: argv-shape reject.",
	},
	{
		cmd: "head -c 100",
		expect: "ask",
		note: "CONSERVATION: -c reads bytes, not in stdin-only profile.",
	},
	{
		cmd: "head \"$HOME\"",
		expect: "ask",
		note: "CONSERVATION: dynamic arg, fail-closed.",
	},

	// === CONSERVATION: dangerous sinks ===
	{
		cmd: "head -30 | sh",
		expect: "ask",
		note: "CONSERVATION: pipe-to-shell dangerous sink.",
	},

	// === EXISTING safe leaves (conservation) ===
	{
		cmd: "pwd",
		expect: "allow/auto-approve-eligible",
		note: "CONSERVATION: existing V1 host_safe_pwd.",
	},
	{
		cmd: "git status",
		expect: "allow/auto-approve-eligible",
		note: "CONSERVATION: existing V1 host_safe_git_status.",
	},
	{
		cmd: "echo hello",
		expect: "allow/auto-approve-eligible",
		note: "CONSERVATION: existing echo parser-proven branch.",
	},
]

async function main() {
	console.log("=== REAL_PRODUCTION_SEAM qualification ===")
	console.log(`helper     : sdk/packages/core/bin/parser-helper/darwin-arm64/cline-parser-helper`)
	console.log(`protocol   : v4 (post-CORRECTION01 rebind)`)
	console.log(`classifier : production evaluateCommandRiskWithParser`)
	console.log(`auth       : safe-only, no path-evidence (so V1 path authority gate inert)`)
	console.log()

	let pass = 0
	let fail = 0
	for (const c of CASES) {
		const parsed = await helper.invoke({ command: c.cmd })
		if (!parsed) {
			console.log(`FAIL: NULL parse for "${c.cmd}"`)
			fail++
			continue
		}
		const r = evaluateCommandRiskWithParser({
			toolInput: c.cmd,
			hostAuthorization: SAFE,
			parserResult: parsed,
		})
		const actual = `${r.decision}/${r.disposition}`
		const ok = actual === c.expect || (c.expect === "ask" && r.decision === "ask") || (c.expect.startsWith("allow") && r.decision === "allow")
		const tag = ok ? "PASS" : "FAIL"
		console.log(`${tag}  ${actual.padEnd(30)}  expected ${c.expect.padEnd(30)}  ${c.cmd}`)
		console.log(`        note: ${c.note}`)
		if (ok) pass++
		else fail++
	}
	console.log()
	console.log(`=== RESULT: ${pass}/${CASES.length} pass, ${fail} fail ===`)
	process.exit(fail === 0 ? 0 : 1)
}

main().catch((err) => {
	console.error("FATAL:", err)
	process.exit(2)
})
