// ACT-CLINEMM-COMMAND-RISK-V2-PIPELINE-LEAF-COMPOSITION01-CORRECTION03
// REAL_PRODUCTION_SEAM qualification harness.
//
// Reviewer disposition HALT_PIPELINE_PATH_EVIDENCE_NOT_BOUND_TO_OPERAND:
// CORRECTION02 closed the missing-evidence case but left a
// residual bypass: an unrelated valid evidence record could
// satisfy the presence check and unlock promotion for a pipe
// whose actual operand was unattested.
//
// CORRECTION03 closes this by replacing the presence check with
// per-operand identity + canonical containment binding. The V2
// walker now extracts the actual R0 leaf operands from the
// structured AST (NOT the V1-rendered text), and the binder
// requires each structured operand to have a matching
// `evidence.operands[i]` entry by VERBATIM identity whose
// `contained: true` AND `resolvedRealPath !== null`.
//
// 4-way discriminator (the load-bearing RED matrix the reviewer
// demanded):
//   (a) correct operand + valid evidence   -> ALLOW
//   (b) correct operand + missing evidence -> ASK
//   (c) wrong operand + valid evidence     -> ASK   <- THE HALT CASE
//   (d) symlink escape + matching evidence -> ASK
//
// Pathless compositions remain conservation ALLOW:
//   - echo hello | head -30
//   - pwd && head -30
//   - head -30

import { MvdanShHelper } from "../../../sdk/packages/core/src/runtime/command-policy/parser-helper/runtime"
import { evaluateCommandRiskWithParser } from "../../../sdk/packages/core/src/runtime/command-policy/command-risk-internal"
import { commandHostAuthorization } from "../../../sdk/packages/core/src/runtime/command-policy/command-policy-types"
import { DEFAULT_COMMAND_HOST_ALLOW_RULES } from "../../../sdk/packages/core/src/runtime/command-policy/command-safe-rules"
import { buildPathAuthorityEvidence } from "../../../sdk/packages/core/src/runtime/command-policy/path-authority-evidence-builder"
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const TMP_ROOT = mkdtempSync(join(tmpdir(), "cline-correction03-"))
const PROJECT_DIR = join(TMP_ROOT, "project")
const OUTSIDE_DIR = join(TMP_ROOT, "outside")
mkdirSync(PROJECT_DIR, { recursive: true })
mkdirSync(join(PROJECT_DIR, "inside"), { recursive: true })
mkdirSync(OUTSIDE_DIR, { recursive: true })

let INSIDE_FILE = join(PROJECT_DIR, "inside", "ok.ts")
let SYMLINK_INSIDE_PROJECT = join(PROJECT_DIR, "escape-link")
writeFileSync(INSIDE_FILE, "// inside\n")
writeFileSync(join(OUTSIDE_DIR, "secret.txt"), "// outside\n")
symlinkSync(OUTSIDE_DIR, SYMLINK_INSIDE_PROJECT, "dir")

// Canonicalize at the fixture boundary (mirrors what a real host does).
const CANONICAL_PROJECT_DIR = realpathSync(PROJECT_DIR)
const CANONICAL_INSIDE_FILE = realpathSync(INSIDE_FILE)
const CANONICAL_SYMLINK_INSIDE_PROJECT = realpathSync(SYMLINK_INSIDE_PROJECT)

const HELPER_PATH = "/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/sdk/packages/core/bin/parser-helper/darwin-arm64/cline-parser-helper"
const helper = new MvdanShHelper({
	platform: "darwin-arm64",
	binaryPath: () => HELPER_PATH,
})

function makeEvidence(cmd: string) {
	const r = buildPathAuthorityEvidence({
		workspaceRoots: [CANONICAL_PROJECT_DIR],
		cwd: CANONICAL_PROJECT_DIR,
		command: { command: cmd },
	})
	if (!r.ok) throw new Error(`buildPathAuthorityEvidence failed: ${r.reason}`)
	return r.evidence
}

function makeAuth(evidence?: any) {
	return commandHostAuthorization({
		mode: "safe-only",
		explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
		workspaceRoots: [CANONICAL_PROJECT_DIR],
		cwd: CANONICAL_PROJECT_DIR,
		pathAuthorityEvidence: evidence,
	})
}

async function evaluate(cmd: string, evidence?: any) {
	const auth = makeAuth(evidence)
	const parsed = await helper.invoke({ command: cmd })
	return evaluateCommandRiskWithParser({ toolInput: cmd, hostAuthorization: auth, parserResult: parsed ?? undefined })
}

type Case = {
	cmd: string
	decision: "allow" | "ask"
	evidence?: any
	note: string
}

const CASES: Case[] = [
	// Conservation (no path authority dependency)
	{ cmd: "echo hello | head -30", decision: "allow", note: "pathless composition" },
	{ cmd: "pwd && head -30", decision: "allow", note: "pathless composition with &&" },
	{ cmd: "head -30", decision: "allow", note: "standalone stdin-only reader" },

	// (a) GREEN: correct operand + valid evidence -> ALLOW
	{ cmd: `ls ${CANONICAL_INSIDE_FILE} | head -30`, decision: "allow", evidence: makeEvidence(`ls ${CANONICAL_INSIDE_FILE} | head -30`), note: "inside-workspace + operand-bound realpath evidence" },

	// (b) RED: correct operand + missing evidence -> ASK
	{ cmd: `ls ${CANONICAL_INSIDE_FILE} | head -30`, decision: "ask", note: "no evidence" },

	// (c) THE HALT CASE: wrong operand + valid evidence -> ASK
	//     The pipe is for /etc/passwd; the host supplied evidence
	//     for the inside file. CORRECTION03 must identify the
	//     operand mismatch and refuse promotion.
	{ cmd: `ls /etc/passwd | head -30`, decision: "ask", evidence: makeEvidence(`ls ${CANONICAL_INSIDE_FILE}`), note: "CORRECTION03 HALT: pipe operand != evidence operand" },

	// (d) RED: symlink escape + matching evidence -> ASK
	//     The pipe operand is a symlink to /outside. The matching
	//     evidence entry's realpath resolves outside workspace
	//     roots and MUST be `contained: false`.
	{ cmd: `ls ${CANONICAL_SYMLINK_INSIDE_PROJECT} | head -30`, decision: "ask", evidence: makeEvidence(`ls ${CANONICAL_SYMLINK_INSIDE_PROJECT} | head -30`), note: "symlink escape pipe + matching (uncontained) evidence" },
]

console.log("=== REAL_PRODUCTION_SEAM qualification (CORRECTION03) ===")
console.log(`TMP_ROOT: ${TMP_ROOT}`)
console.log(`PROJECT_DIR: ${PROJECT_DIR}`)
console.log()

let pass = 0
let fail = 0
for (const c of CASES) {
	const r = await evaluate(c.cmd, c.evidence)
	const decisionOk = r.decision === c.decision
	const ok = decisionOk
	const tag = ok ? "PASS" : "FAIL"
	console.log(`${tag}  ${r.decision.padEnd(5)}  source=${r.source.padEnd(45)} ${c.cmd}`)
	console.log(`        expected: ${c.decision}`)
	console.log(`        note: ${c.note}`)
	if (ok) pass++
	else fail++
}

console.log()
console.log(`=== RESULT: ${pass}/${CASES.length} pass, ${fail} fail ===`)

if (existsSync(TMP_ROOT)) {
	try { rmSync(TMP_ROOT, { recursive: true, force: true }) } catch { /* ignore */ }
}

process.exit(fail === 0 ? 0 : 1)
