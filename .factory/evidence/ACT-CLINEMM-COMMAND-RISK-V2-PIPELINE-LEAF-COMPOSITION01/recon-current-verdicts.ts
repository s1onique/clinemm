// ACT-CLINEMM-COMMAND-RISK-V2-PIPELINE-LEAF-COMPOSITION01
// Recon: CURRENT verdicts via real vendored helper + production classifier.
//
// Goal: enumerate the boundaries that prevent the original ACT §12 recon
// chain from reaching auto-approve, and classify each boundary as either
// (a) correct policy (must NOT change) or (b) ACT scope (this ACT will fix).
//
// Driven by:
//   bun .factory/evidence/ACT-CLINEMM-COMMAND-RISK-V2-PIPELINE-LEAF-COMPOSITION01/recon-current-verdicts.ts

import { MvdanShHelper } from "../../../sdk/packages/core/src/runtime/command-policy/parser-helper/runtime"
import { evaluateCommandRiskWithParser } from "../../../sdk/packages/core/src/runtime/command-policy/command-risk-internal"
import { evaluateStructuredCommandRisk } from "../../../sdk/packages/core/src/runtime/command-policy/structured-command-risk"
import {
	commandHostAuthorization,
} from "../../../sdk/packages/core/src/runtime/command-policy/command-policy-types"
import { DEFAULT_COMMAND_HOST_ALLOW_RULES } from "../../../sdk/packages/core/src/runtime/command-policy/command-safe-rules"

const SAFE = commandHostAuthorization({
	mode: "safe-only",
	explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
})

const helper = new MvdanShHelper({
	platform: "darwin-arm64",
	binaryPath: () => "sdk/packages/core/bin/parser-helper/darwin-arm64/cline-parser-helper",
})

type Case = {
	cmd: string
	category: string
	expected: string
	note: string
}

const CASES: Case[] = [
	// --- The original ACT §12 recon chain (must ASK) ---
	{
		cmd: "pwd && git status && git log --oneline -5 origin/main && ls -la .factory/ 2>/dev/null | head -30",
		category: "ACT-§12-recon-chain",
		expected: "ask (mixed-risk: git log with positional ref, head not safe)",
		note: "Multipoint defect: git log --oneline -5 origin/main has positional ref; head isn't safe; ls needs path authority.",
	},
	// --- leaf-by-leaf breakdown ---
	{
		cmd: "pwd",
		category: "leaf",
		expected: "allow + auto-approve-eligible",
		note: "Already V1-safe (host_safe_pwd).",
	},
	{
		cmd: "git status",
		category: "leaf",
		expected: "allow + auto-approve-eligible",
		note: "Already V1-safe (host_safe_git_status).",
	},
	{
		cmd: "git log --oneline -5 origin/main",
		category: "leaf",
		expected: "ask (host_safe_git_log rejects positional refs)",
		note: "V1 safe rule doesn't allow positional ref args. V2 parser-proven path could fix this (all args are static literals).",
	},
	{
		cmd: "ls -la .factory/ 2>/dev/null",
		category: "leaf",
		expected: "ask (path authority requires host evidence)",
		note: "V2 says promoteToAllow=true. V1 ASK is from path authority, NOT from V2's promotable surface. NOT this ACT's scope; needs host-adapter evidence.",
	},
	{
		cmd: "head -30 some-file",
		category: "leaf",
		expected: "ask (no V1 rule, no V2 parser-proven branch for head)",
		note: "head has no V1 rule. ALL args are static (parser-proven). V2 could promote via parser-proven path.",
	},
	{
		cmd: "cat some-file",
		category: "leaf",
		expected: "ask (no V1 rule)",
		note: "cat has no V1 rule. Could be parser-proven static (literal path).",
	},

	// --- Compositional controls ---
	{
		cmd: "ls -la .factory/evidence/ 2>/dev/null | head -30",
		category: "composition-pipe",
		expected: "ask (right leaf head)",
		note: "Pipe aggregation: max(ls auto-approve, head ask) = ask. ACT scope if head gets parser-proven.",
	},
	{
		cmd: "git log --oneline -5 origin/main | head",
		category: "composition-pipe",
		expected: "ask (both leaves need repair)",
		note: "Pipe aggregation. Either leaf fixed independently could move this to ALLOW (both must be safe).",
	},
	{
		cmd: "echo hello | head",
		category: "composition-pipe",
		expected: "ask (head not safe; echo is V1-safe)",
		note: "Pipe aggregation: max(echo auto-approve, head ask) = ask. ACT scope if head gets parser-proven.",
	},
	{
		cmd: "echo hello | cat",
		category: "composition-pipe",
		expected: "ask (cat not safe; echo is V1-safe)",
		note: "Same composition boundary as echo|head.",
	},

	// --- Conservation controls (must NOT auto-approve) ---
	{
		cmd: "head -30 /etc/passwd",
		category: "conservation-negative",
		expected: "ask (path authority)",
		note: "head on a sensitive path: V1 path authority must block even if V2 says parser-proven. ACT scope must include this conservation.",
	},
	{
		cmd: "head -30 $(rm -rf foo)",
		category: "conservation-negative",
		expected: "ask (dynamic arg)",
		note: "Command substitution in head's arg: V2 parser-proven branch must reject (argProvenance=dynamic).",
	},
	{
		cmd: "head --help",
		category: "conservation-negative",
		expected: "ask (unknown option)",
		note: "head --help: even if --help is 'safe', it's not in the reviewed whitelist. V2 parser-proven path must reject unknown options.",
	},
	{
		cmd: "head -30 some-file | sh",
		category: "conservation-negative",
		expected: "ask (dangerous sink sh)",
		note: "head piped to sh. The dangerous-sink boundary is OUT of this ACT's scope (downstream pipe-to-shell is the predicate; see reformulation-classifier.test.ts).",
	},
]

async function main() {
	console.log(`=== RECON: CURRENT VERDICTS (V4 helper + production classifier) ===`)
	console.log(`helper     : sdk/packages/core/bin/parser-helper/darwin-arm64/cline-parser-helper`)
	console.log(`cwd        : ${process.cwd()}`)
	console.log(`Date       : ${new Date().toISOString()}`)
	console.log()
	console.log("per-stmt V2 source labels reveal which leaf is failing.")
	console.log()

	for (const c of CASES) {
		const parsed = await helper.invoke({ command: c.cmd })
		if (!parsed) {
			console.log(`NULL parse: ${c.cmd}`)
			continue
		}
		const r = evaluateCommandRiskWithParser({
			toolInput: c.cmd,
			hostAuthorization: SAFE,
			parserResult: parsed,
		})
		const v2 = evaluateStructuredCommandRisk({
			toolInput: c.cmd,
			parserResult: parsed,
		})
		const perStmt = v2.perStatement
			.map((s, i) => `  stmt[${i}]: kind=${s.kind} risk=${s.risk} source=${s.source}`)
			.join("\n")
		console.log(`[${c.category}] ${c.cmd}`)
		console.log(`  expected        : ${c.expected}`)
		console.log(`  actual verdict  : ${r.decision}/${r.disposition}`)
		console.log(`  V2 promoteAllow : ${v2.promoteToAllow}`)
		console.log(`  V2 reasons      : ${JSON.stringify(v2.reasons)}`)
		console.log(`  V2 perStmt      :`)
		console.log(perStmt)
		console.log(`  note            : ${c.note}`)
		console.log()
	}
}

main().catch((err) => {
	console.error("FATAL:", err)
	process.exit(2)
})
