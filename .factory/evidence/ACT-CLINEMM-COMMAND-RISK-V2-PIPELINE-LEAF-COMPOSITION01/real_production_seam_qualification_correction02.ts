// ACT-CLINEMM-COMMAND-RISK-V2-PIPELINE-LEAF-COMPOSITION01-CORRECTION02
// REAL_PRODUCTION_SEAM qualification harness.
//
// Reviewer disposition HALT_PIPELINE_PATH_AUTHORITY_BYPASS:
// Pre-CORRECTION02 a pipe such as `ls <path> | head -30` (no
// path evidence) ALLOW'd via parser-proven promotion of the
// `head` leaf. CORRECTION02 closes the bypass at the V2
// promotion gate: when any reachable leaf in the structured
// program is from the R0 read-only path-bearing source set
// (`host_safe_ls`, `host_safe_find`) AND the host has not
// supplied path authority evidence, the V2 promotion gate
// refuses to promote.
//
// RED matrix locked in:
//   - `ls <inside> | head -30` (no evidence)         -> ASK
//   - `ls <outside> | head -30` (no evidence)        -> ASK
//   - `ls <inside-symlink> | head -30` (no evidence)  -> ASK
// GREEN case (proves the gate is NOT a regression):
//   - `ls <inside> | head -30` (valid evidence)       -> ALLOW
// CONSERVATION (no path authority dependency):
//   - `echo hello | head -30`                         -> ALLOW
//   - `pwd && head -30`                               -> ALLOW
//   - `head -30`                                      -> ALLOW

import { MvdanShHelper } from "../../../sdk/packages/core/src/runtime/command-policy/parser-helper/runtime"
import { evaluateCommandRiskWithParser } from "../../../sdk/packages/core/src/runtime/command-policy/command-risk-internal"
import { commandHostAuthorization } from "../../../sdk/packages/core/src/runtime/command-policy/command-policy-types"
import { DEFAULT_COMMAND_HOST_ALLOW_RULES } from "../../../sdk/packages/core/src/runtime/command-policy/command-safe-rules"
import { buildPathAuthorityEvidence } from "../../../sdk/packages/core/src/runtime/command-policy/path-authority-evidence-builder"
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const TMP_ROOT = mkdtempSync(join(tmpdir(), "cline-correction02-"))
const PROJECT_DIR = join(TMP_ROOT, "project")
const OUTSIDE_DIR = join(TMP_ROOT, "outside")
mkdirSync(PROJECT_DIR, { recursive: true })
mkdirSync(join(PROJECT_DIR, "inside"), { recursive: true })
mkdirSync(OUTSIDE_DIR, { recursive: true })

const PROJECT_INSIDE_FILE = join(PROJECT_DIR, "inside", "ok.ts")
const SYMLINK_INSIDE_PROJECT = join(PROJECT_DIR, "escape-link")
writeFileSync(PROJECT_INSIDE_FILE, "// inside\n")
writeFileSync(join(OUTSIDE_DIR, "secret.txt"), "// outside\n")
symlinkSync(OUTSIDE_DIR, SYMLINK_INSIDE_PROJECT, "dir")

// CORRECTION04 hygiene: canonicalize at the fixture boundary
// (mirrors what a real host does).
const CANONICAL_PROJECT_DIR = realpathSync(PROJECT_DIR)
const CANONICAL_INSIDE_FILE = realpathSync(PROJECT_INSIDE_FILE)
const CANONICAL_SYMLINK_INSIDE_PROJECT = realpathSync(SYMLINK_INSIDE_PROJECT)

const HELPER_PATH = "/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/sdk/packages/core/bin/parser-helper/darwin-arm64/cline-parser-helper"
const helper = new MvdanShHelper({
	platform: "darwin-arm64",
	binaryPath: () => HELPER_PATH,
})

async function withEvidence(cmd: string) {
	const result = buildPathAuthorityEvidence({
		workspaceRoots: [CANONICAL_PROJECT_DIR],
		cwd: CANONICAL_PROJECT_DIR,
		command: { command: cmd },
	})
	if (!result.ok) throw new Error(`buildPathAuthorityEvidence failed: ${result.reason}`)
	const auth = commandHostAuthorization({
		mode: "safe-only",
		explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
		workspaceRoots: [CANONICAL_PROJECT_DIR],
		cwd: CANONICAL_PROJECT_DIR,
		pathAuthorityEvidence: result.evidence,
	})
	const parsed = await helper.invoke({ command: cmd })
	return evaluateCommandRiskWithParser({ toolInput: cmd, hostAuthorization: auth, parserResult: parsed ?? undefined })
}

async function withoutEvidence(cmd: string) {
	const auth = commandHostAuthorization({
		mode: "safe-only",
		explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
		workspaceRoots: [CANONICAL_PROJECT_DIR],
		cwd: CANONICAL_PROJECT_DIR,
	})
	const parsed = await helper.invoke({ command: cmd })
	return evaluateCommandRiskWithParser({ toolInput: cmd, hostAuthorization: auth, parserResult: parsed ?? undefined })
}

type Case = {
	cmd: string
	decision: "allow" | "ask"
	expectedSource?: string
	mustNotBePromoted?: boolean
	note: string
	runner: "with" | "without"
}

const CASES: Case[] = [
	// CONSERVATION (no path authority)
	{ cmd: "echo hello | head -30", decision: "allow", note: "pathless composition", runner: "with" },
	{ cmd: "pwd && head -30", decision: "allow", note: "pathless composition with &&", runner: "with" },
	{ cmd: "head -30", decision: "allow", note: "standalone stdin-only reader", runner: "with" },

	// GREEN: pipe + path-bearing leaf + valid evidence -> ALLOW
	{ cmd: `ls ${CANONICAL_INSIDE_FILE} | head -30`, decision: "allow", note: "inside-workspace + valid realpath evidence", runner: "with" },

	// RED: pipe + path-bearing leaf + no evidence -> ASK
	{ cmd: `ls ${CANONICAL_INSIDE_FILE} | head -30`, decision: "ask", mustNotBePromoted: true, note: "CORRECTION02 invariant: no evidence = no promotion", runner: "without" },

	// RED: pipe + path-bearing leaf + outside operand (no evidence) -> ASK
	{ cmd: `ls ${OUTSIDE_DIR}`, decision: "ask", expectedSource: "host_workspace_realpath_authority", note: "per-command outside operand, no evidence", runner: "without" },
	{ cmd: `ls /etc/passwd | head -30`, decision: "ask", mustNotBePromoted: true, note: "well-known outside path, no evidence", runner: "without" },

	// RED: pipe + symlink escape -> ASK
	{ cmd: `ls ${CANONICAL_SYMLINK_INSIDE_PROJECT} | head -30`, decision: "ask", mustNotBePromoted: true, note: "project-internal symlink => outside, no evidence", runner: "without" },
]

console.log("=== REAL_PRODUCTION_SEAM qualification (CORRECTION02) ===")
console.log(`TMP_ROOT: ${TMP_ROOT}`)
console.log(`PROJECT_DIR: ${PROJECT_DIR}`)
console.log()

let pass = 0
let fail = 0
for (const c of CASES) {
	const r = c.runner === "with" ? await withEvidence(c.cmd) : await withoutEvidence(c.cmd)
	const decisionOk = r.decision === c.decision
	const sourceOk = c.expectedSource === undefined || r.source === c.expectedSource
	const notPromotedOk = !c.mustNotBePromoted || r.source !== "risk_v2_structured_promotion"
	const ok = decisionOk && sourceOk && notPromotedOk
	const tag = ok ? "PASS" : "FAIL"
	console.log(`${tag}  ${r.decision}/${r.disposition.padEnd(22)} source=${r.source.padEnd(45)} ${c.cmd}`)
	console.log(`        expected: ${c.decision}${c.expectedSource ? "/" + c.expectedSource : ""}`)
	console.log(`        note: ${c.note}`)
	if (ok) pass++
	else fail++
}

console.log()
console.log(`=== RESULT: ${pass}/${CASES.length} pass, ${fail} fail ===`)

if (existsSync(TMP_ROOT)) {
	try {
		rmSync(TMP_ROOT, { recursive: true, force: true })
	} catch { /* ignore */ }
}

process.exit(fail === 0 ? 0 : 1)
