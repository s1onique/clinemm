// ACT-CLINEMM-COMMAND-RISK-V2-PIPELINE-LEAF-COMPOSITION01-CORRECTION01
// REAL_PRODUCTION_SEAM qualification harness (CORRECTION01 edition).
//
// Reviewer-flagged P0 HALT_PARSER_PROVEN_PROMOTION_BYPASSES_PATH_AUTHORITY:
// The C2 parser-proven promotion gate generalized from hard-coded echo
// source label to isParserProvenSource(s.source) but did NOT also gate on
// isStructureOnlyPromotableAsk(finalSource). The CORRECTION01 fix adds
// that gate; this harness drives the per-command authority-preservation
// discriminator end-to-end with a real temp filesystem.
//
// Evidence classification: REAL_PRODUCTION_SEAM (NOT LIVE).

import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	realpathSync,
	symlinkSync,
	writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { MvdanShHelper } from "../../../sdk/packages/core/src/runtime/command-policy/parser-helper/runtime"
import { evaluateCommandRiskWithParser } from "../../../sdk/packages/core/src/runtime/command-policy/command-risk-internal"
import { commandHostAuthorization } from "../../../sdk/packages/core/src/runtime/command-policy/command-policy-types"
import { DEFAULT_COMMAND_HOST_ALLOW_RULES } from "../../../sdk/packages/core/src/runtime/command-policy/command-safe-rules"
import { buildPathAuthorityEvidence } from "../../../sdk/packages/core/src/runtime/command-policy/path-authority-evidence-builder"

const TMP_ROOT = mkdtempSync(join(tmpdir(), "cline-pipeline-leaf-correction01-"))
const PROJECT_DIR = join(TMP_ROOT, "project")
const OUTSIDE_DIR = join(TMP_ROOT, "outside")
mkdirSync(PROJECT_DIR, { recursive: true })
mkdirSync(join(PROJECT_DIR, "inside"), { recursive: true })
mkdirSync(OUTSIDE_DIR, { recursive: true })

const PROJECT_INSIDE_FILE = join(PROJECT_DIR, "inside", "ok.ts")
const SYMLINK_INSIDE_PROJECT = join(PROJECT_DIR, "outside-link")
writeFileSync(PROJECT_INSIDE_FILE, "// inside\n")
writeFileSync(join(OUTSIDE_DIR, "secret.txt"), "// outside\n")
symlinkSync(OUTSIDE_DIR, SYMLINK_INSIDE_PROJECT, "dir")

// CORRECTION04 hygiene: canonicalize at the fixture boundary.
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

type Case = { cmd: string; decision: string; source?: string; note: string; runner: "with" | "without" }

const CASES: Case[] = [
	// ALLOW: no filesystem authority
	{ cmd: "echo hello | head -30", decision: "allow", note: "no path authority (composition with echo + parser-proven head)", runner: "with" },
	{ cmd: "pwd && head -30", decision: "allow", note: "no path authority (pwd + parser-proven head chain)", runner: "with" },
	{ cmd: "head -30", decision: "allow", note: "no path authority (standalone stdin-only reader)", runner: "with" },

	// ALLOW: inside-workspace + valid evidence
	{ cmd: `ls ${CANONICAL_INSIDE_FILE} | head -30`, decision: "allow", note: "inside-workspace + valid realpath evidence", runner: "with" },

	// ASK: missing evidence (per-command) -- this is the
	// CORRECTION01 discriminator. V1 source must be
	// host_workspace_realpath_authority (NOT risk_v2_structured_promotion)
	{ cmd: `ls ${CANONICAL_INSIDE_FILE}`, decision: "ask", source: "host_workspace_realpath_authority", note: "per-command host_workspace_realpath_authority (no evidence supplied) -- V2 must NOT override", runner: "without" },

	// ASK: outside-workspace operand (real evidence)
	{ cmd: `ls ${OUTSIDE_DIR}`, decision: "ask", source: "host_workspace_realpath_authority", note: "operand realpath outside workspace roots", runner: "with" },

	// ASK: symlink escape (project-internal symlink => outside)
	{ cmd: `ls ${CANONICAL_SYMLINK_INSIDE_PROJECT}`, decision: "ask", source: "host_workspace_realpath_authority", note: "symlink realpath escapes workspace", runner: "with" },

	// ASK: obviously outside (no evidence even needed)
	{ cmd: `ls /etc/passwd`, decision: "ask", source: "host_workspace_realpath_authority", note: "operand under /etc, outside configured roots", runner: "with" },
]

console.log("=== REAL_PRODUCTION_SEAM qualification (CORRECTION01) ===")
console.log(`TMP_ROOT: ${TMP_ROOT}`)
console.log(`PROJECT_DIR: ${PROJECT_DIR}`)
console.log()

let pass = 0
let fail = 0
for (const c of CASES) {
	const r = c.runner === "with" ? await withEvidence(c.cmd) : await withoutEvidence(c.cmd)
	const decisionOk = r.decision === c.decision
	const sourceOk = c.source === undefined || r.source === c.source
	const allowed = c.decision === "ask" ? r.source !== "risk_v2_structured_promotion" : true
	const ok = decisionOk && sourceOk && allowed
	const tag = ok ? "PASS" : "FAIL"
	console.log(`${tag}  ${r.decision}/${r.disposition.padEnd(22)} source=${r.source.padEnd(45)} ${c.cmd}`)
	console.log(`        expected: ${c.decision}${c.source ? "/" + c.source : ""}`)
	console.log(`        note: ${c.note}`)
	if (ok) pass++; else fail++
}

console.log()
console.log(`=== RESULT: ${pass}/${CASES.length} pass, ${fail} fail ===`)

if (existsSync(TMP_ROOT)) {
	// best-effort cleanup
	try {
		const { rmSync } = await import("node:fs")
		rmSync(TMP_ROOT, { recursive: true, force: true })
	} catch { /* ignore */ }
}

process.exit(fail === 0 ? 0 : 1)
