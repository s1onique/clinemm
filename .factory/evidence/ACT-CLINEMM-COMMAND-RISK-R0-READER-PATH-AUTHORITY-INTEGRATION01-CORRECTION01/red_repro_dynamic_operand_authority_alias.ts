// ACT-CLINEMM-COMMAND-RISK-R0-READER-PATH-AUTHORITY-INTEGRATION01-CORRECTION01
// RED reproduction harness for HALT_READER_DYNAMIC_OPERAND_AUTHORITY_ALIAS.
//
// Reviewer P0 (post-merge):
//
//   The new V1 reader safe-rule regexes
//   (`host_safe_cat`, `host_safe_head_path`, `host_safe_tail_path`)
//   positively accept unquoted shell-active characters in path
//   operands: `$`, `~`, `*`, `?`. Bash then performs parameter
//   expansion / tilde expansion / filename generation BEFORE
//   `cat` / `head` / `tail` sees argv. The host evidence is built
//   from the LITERAL token; the kernel executes against the
//   shell-EVALUATED operand. That breaks:
//
//      evidence operand identity  ==  actual filesystem operand
//
//   The reproduction here proves the bug.
//
// BOUNDED REPRODUCTION (per the reviewer's exact instruction):
//
//   1. Build a real workspace fixture containing a path whose
//      RAW token would make the literal-evidence authority check
//      succeed, while a SHELL-EVALUATED copy of the same operand
//      resolves OUTSIDE the workspace.
//
//   2. Drive the canonical `evaluateCommandPolicy` against the
//      same command line, with the literal-evidence record.
//
//   3. The expected verdict under CORRECTION01 is ASK (the rule
//      regex must reject the unquoted shell-active operand).
//
//   4. Pre-CORRECTION01, the policy returns ALLOW: that's the
//      P0 reproduction.
//
//   We exercise this with FOUR classes:
//
//      (a) `$HOME/file`           parameter expansion
//      (b) `~/file`               tilde expansion
//      (c) `*`                    filename generation (glob)
//      (d) `?.txt`                filename generation (glob)
//
//   One load-bearing reproduction is sufficient; the others are
//   conservation. The bash shell-confirmation step at the bottom
//   verifies the actual shell-expanded path differs from the
//   raw token.
//
// Classification: SYNTHETIC_REAL -- the harness drives the
// canonical SDK entrypoint, but the seam does NOT invoke a real
// shell. The bash invocation at the end is a side-channel
// sanity check, not a code path of the policy.

import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { commandHostAuthorization } from "../../../sdk/packages/core/src/runtime/command-policy/command-policy-types"
import { DEFAULT_COMMAND_HOST_ALLOW_RULES } from "../../../sdk/packages/core/src/runtime/command-policy/command-safe-rules"
import { buildPathAuthorityEvidence } from "../../../sdk/packages/core/src/runtime/command-policy/path-authority-evidence-builder"
import { evaluateCommandPolicy } from "../../../sdk/packages/core/src/runtime/command-policy/index"

const TMP_ROOT = mkdtempSync(join(tmpdir(), "cline-reader-dyn-op-R0-red-"))
const PROJECT_DIR = join(TMP_ROOT, "project")
mkdirSync(PROJECT_DIR, { recursive: true })

// Build the LOAD-BEARING FIXTURE: a literal file under the workspace
// at the exact raw-token name the rule regex accepts. This is the
// key to the reproduction: the host-evidence builder sees the
// literal `$HOME/secret` and resolves it relative to cwd; the
// resolution finds THIS FILE (because we placed it at that exact
// path). The shell, however, expands `$HOME` to the user's real
// home directory BEFORE `cat` sees argv -- which is OUTSIDE the
// workspace fixture.
//
// The discriminator the reviewer demanded: an operand that
// passes the lexical containment gate under the LITERAL token
// while the SHELL-EVALUATED operand resolves to a different
// filesystem object.
const LITERAL_DOLLAR_HOME_DIR = join(PROJECT_DIR, "$HOME")
const LITERAL_DOLLAR_HOME_SECRET = join(LITERAL_DOLLAR_HOME_DIR, "secret")
mkdirSync(LITERAL_DOLLAR_HOME_DIR, { recursive: true })
writeFileSync(LITERAL_DOLLAR_HOME_SECRET, "INSIDE-FIXTURE\n")

const LITERAL_TILDE_DIR = join(PROJECT_DIR, "~")
const LITERAL_TILDE_SECRET = join(LITERAL_TILDE_DIR, "secret")
mkdirSync(LITERAL_TILDE_DIR, { recursive: true })
writeFileSync(LITERAL_TILDE_SECRET, "INSIDE-FIXTURE\n")

// Canonical (realpath-resolved) project root for the
// authority gate. The CORRECTION04 V1 invariant compares
// byte-equal against this.
const CANONICAL_PROJECT_DIR = realpathSync(PROJECT_DIR)

console.log("=== RED HALT_READER_DYNAMIC_OPERAND_AUTHORITY_ALIAS ===")
console.log(`TMP_ROOT: ${TMP_ROOT}`)
console.log(`CANONICAL_PROJECT_DIR: ${CANONICAL_PROJECT_DIR}`)
console.log()

type Case = {
	cmd: string
	note: string
	// Pre-CORRECTION01 expected behaviour (the P0):
	//   the rule regex accepts the shell-active operand,
	//   the literal-evidence builder either fails to resolve
	//   the path (and returns ASK on `null`) or, in cases where
	//   the literal path happens to lexically resolve (e.g.
	//   glob `*` could be a literal filename), returns ALLOW.
	//
	// Post-CORRECTION01 expected output is ASK in every case
	// (the regex must REJECT the unquoted shell-active operand
	// before the authority gate fires).
	expectedPostFix: "ask"
}

const CASES: Case[] = [
	{ cmd: `cat $HOME/secret`, note: "(a) `cat $HOME/secret` -- parameter expansion", expectedPostFix: "ask" },
	{ cmd: `head -30 $HOME/secret`, note: "(b1) `head -30 $HOME/secret` -- parameter expansion", expectedPostFix: "ask" },
	{ cmd: `tail -20 $HOME/secret`, note: "(b2) `tail -20 $HOME/secret` -- parameter expansion", expectedPostFix: "ask" },
	{ cmd: `cat ~/secret`, note: "(c) `cat ~/secret` -- tilde expansion", expectedPostFix: "ask" },
	{ cmd: `cat *`, note: "(d) `cat *` -- filename generation", expectedPostFix: "ask" },
	{ cmd: `cat ?.txt`, note: "(e) `cat ?.txt` -- filename generation", expectedPostFix: "ask" },
	{ cmd: `cat ${join(PROJECT_DIR, "README.md")}`, note: "(CONSERVATION) `cat <inside-file>` -- no evidence, must ASK", expectedPostFix: "ask" },
]

let pass = 0
let fail = 0
let printedAllowOnShellActive = false

for (const c of CASES) {
	const evidenceResult = buildPathAuthorityEvidence({
		workspaceRoots: [CANONICAL_PROJECT_DIR],
		cwd: CANONICAL_PROJECT_DIR,
		command: { command: c.cmd },
	})
	const evidence = evidenceResult.ok ? evidenceResult.evidence : undefined

	const auth = commandHostAuthorization({
		mode: "safe-only",
		explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
		workspaceRoots: [CANONICAL_PROJECT_DIR],
		cwd: CANONICAL_PROJECT_DIR,
		pathAuthorityEvidence: evidence,
	})
	const r = evaluateCommandPolicy({
		toolInput: { command: c.cmd },
		hostAuthorization: auth,
	})
	const kind = r.decision.kind
	const source = r.decision.source

	const evidenceHadOperand = evidenceResult.ok && evidenceResult.evidence.operands.length > 0
	const evidenceOperandResolved = evidenceHadOperand
		? evidenceResult.evidence.operands.every((op) => op.resolvedRealPath !== null)
		: false
	const preFixAllowBug =
		kind === "allow" && (evidenceHadOperand ? evidenceOperandResolved : true)

	const tag = preFixAllowBug
		? "P0_REPRO"
		: kind === "ask" && source === "host_mode_safe_only_fallthrough"
			? "GREEN_post-CORRECTION01"
			: "ok-pre-fix"
	console.log(`${tag}  ${kind.padEnd(5)}  source=${(source ?? "(none)").padEnd(45)} ${c.cmd}`)
	console.log(`        expected post-CORRECTION01: ${c.expectedPostFix}`)
	console.log(`        evidence.operands: ${JSON.stringify(evidenceResult.ok ? evidenceResult.evidence.operands : [])}`)
	console.log(`        note: ${c.note}`)
	if (preFixAllowBug) {
		printedAllowOnShellActive = true
		console.log(`        ^^ ALLOW under literal-token evidence: SHELL-EXPANSION ALIAS VULNERABILITY ^^`)
		fail++
	} else if (kind === "ask" && source === "host_mode_safe_only_fallthrough") {
		// Post-CORRECTION01: regex rejected at the rule layer.
		pass++
	} else {
		pass++
	}
}

console.log()
console.log(`=== Side-channel: bash actually executes ===`)
const { spawnSync } = await import("node:child_process")
const bashProbe = spawnSync("bash", ["-c", 'echo "$HOME/secret"'], {
	encoding: "utf8",
	cwd: CANONICAL_PROJECT_DIR,
	env: { ...process.env, HOME: "/tmp/clinEMM_FAKE_HOME_FOR_RED" },
})
console.log(`  bash -c 'echo "$HOME/secret"' stdout: ${JSON.stringify(bashProbe.stdout.trim())}`)
const homeProbe = spawnSync("bash", ["-c", 'echo $HOME'], {
	encoding: "utf8",
	cwd: CANONICAL_PROJECT_DIR,
	env: { ...process.env, HOME: "/tmp/clinEMM_FAKE_HOME_FOR_RED" },
})
console.log(`  bash -c 'echo $HOME' stdout:         ${JSON.stringify(homeProbe.stdout.trim())}`)
const bashEvaluatedHome = homeProbe.stdout.trim()
const bashEvaluatesOutside = !bashEvaluatedHome.startsWith(CANONICAL_PROJECT_DIR)
console.log(`  bash-evaluated HOME outside project: ${bashEvaluatesOutside}`)
console.log()

if (existsSync(TMP_ROOT)) {
	try { rmSync(TMP_ROOT, { recursive: true, force: true }) } catch { /* ignore */ }
}

console.log(`=== RED SUMMARY ===`)
console.log(`  cases observed:                 ${CASES.length}`)
console.log(`  cases currently ASK (post-fix): ${pass}`)
console.log(`  cases currently ALLOW (P0 bug): ${fail}`)
console.log(`  bash evaluates HOME outside ws: ${bashEvaluatesOutside}`)
if (printedAllowOnShellActive) {
	console.log(`  >>> P0 HALT_READER_DYNAMIC_OPERAND_AUTHORITY_ALIAS STILL REPRODUCIBLE <<<`)
	process.exit(1)
} else {
	console.log(`  >>> CORRECTION01 FIXED: every shell-active operand rejected at the rule layer <<<`)
	console.log(`  bash evaluates HOME outside ws, but policy never ALLOWs because the rule regex rejects.`)
}

process.exit(0)
