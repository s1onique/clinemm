// Verify: can the ACT §12 chain reach ALLOW with ONLY a pathless-stdin
// `head -30` (no FILE arg) added to the parser-proven allowlist?
//
// V1 will still ASK `head -30` (no rule). V2's parser-proven branch
// must promote ONLY when the helper confirms `head` has zero path
// operands (i.e. reading stdin).
import { MvdanShHelper } from "../../../sdk/packages/core/src/runtime/command-policy/parser-helper/runtime"
import { evaluateStructuredCommandRisk } from "../../../sdk/packages/core/src/runtime/command-policy/structured-command-risk"

const helper = new MvdanShHelper({
	platform: "darwin-arm64",
	binaryPath: () => "/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/sdk/packages/core/bin/parser-helper/darwin-arm64/cline-parser-helper",
})

const stdinCases = [
	// Stdin-only: zero path operands
	"head",
	"head -30",
	"head -n 30",
	"head -c 100",
	"head --",
	"head -n 30 --",
	"tail -20",
	"tail -n 20",
	// Path-bearing forms (must remain ASK even after this ACT)
	"head some-file",
	"head -30 some-file",
	"head -n 30 some-file other-file",
	"tail -20 some-file",
	"cat some-file",
	"sort some-file",
	"uniq some-file",
	"wc -l some-file",
]

for (const cmd of stdinCases) {
	const parsed = await helper.invoke({ command: cmd })
	if (!parsed || !parsed.program) { console.log(`NULL: ${cmd}`); continue }
	const stmt = parsed.program.stmts[0]
	if (stmt.kind !== "cmd") { console.log(`NOT-CMD: ${cmd}`); continue }
	const c = stmt.cmd
	// How many positional args after option parsing? Path args are
	// positional args. We don't have a strict "is option" map, but
	// the helper emits args in argv order. We can detect by argv shape:
	// for `head -n 30 some-file other-file`, the path operands are
	// the trailing non-option words.
	const pathOperandCount = countPathOperands(c.name, c.args)
	console.log(`${cmd}`)
	console.log(`  args=${JSON.stringify(c.args)} argProvenance=${JSON.stringify(c.argProvenance)} pathOperandCount=${pathOperandCount}`)
}

function countPathOperands(name: string, args: ReadonlyArray<string>): number {
	// Simple heuristic: for head/tail/wc/sort/uniq/cat, skip leading
	// option flags, count remaining positional args as paths.
	if (!["head", "tail", "wc", "sort", "uniq", "cat"].includes(name)) {
		return args.filter((a) => !a.startsWith("-")).length
	}
	let i = 0
	let seenDashDash = false
	let pathCount = 0
	// skip options
	while (i < args.length) {
		const a = args[i]!
		if (seenDashDash) {
			pathCount++
			i++
		} else if (a === "--") {
			seenDashDash = true
			i++
		} else if (a.startsWith("-")) {
			// skip this option, and any value-takes-arg option
			// (simple: -n/-c take a value, -30 is the value baked in)
			i++
			if (["-n", "-c"].includes(a) && i < args.length && !args[i]!.startsWith("-")) {
				i++ // consumed the value
			}
		} else {
			pathCount++
			i++
		}
	}
	return pathCount
}
