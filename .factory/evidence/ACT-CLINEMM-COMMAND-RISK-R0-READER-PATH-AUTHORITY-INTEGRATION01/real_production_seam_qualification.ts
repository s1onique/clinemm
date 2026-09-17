// ACT-CLINEMM-COMMAND-RISK-R0-READER-PATH-AUTHORITY-INTEGRATION01
// REAL_PRODUCTION_SEAM qualification harness.
//
// Drives the canonical `evaluateCommandPolicy` (V1 path-bearing
// authority gate + V2 structured-command-risk classifier) against
// the read/write discriminator the reviewer demanded.
//
// 14 cases:
//   GREEN (path-bearing readers with valid evidence):
//     (1) cat FILE inside project + matching evidence        -> ALLOW
//     (2) cat FILE1 FILE2 + matching evidence               -> ALLOW
//     (3) head -30 FILE + matching evidence                  -> ALLOW
//     (4) head -n 30 FILE + matching evidence                 -> ALLOW
//     (5) tail -20 FILE + matching evidence                  -> ALLOW
//     (6) tail -n 20 FILE + matching evidence                 -> ALLOW
//
//   RED (negative controls):
//     (7) cat FILE without evidence                          -> ASK
//     (8) cat /outside/file even with matching evidence     -> ASK
//     (9) head -30 /outside/file + matching evidence         -> ASK
//    (10) tail -20 /outside/file + matching evidence         -> ASK
//    (11) cat FILE + evidence from BROADER roots             -> ASK (CORRECTION04 invariant)
//    (12) cat FILE + evidence from FOREIGN cwd               -> ASK (CORRECTION04 invariant)
//    (13) cat <inside-symlink> + matching evidence           -> ASK (symlink escape)
//    (14) cat FILE | sh                                      -> ASK (dangerous-sink composition)

import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { commandHostAuthorization } from "../../../sdk/packages/core/src/runtime/command-policy/command-policy-types"
import { DEFAULT_COMMAND_HOST_ALLOW_RULES } from "../../../sdk/packages/core/src/runtime/command-policy/command-safe-rules"
import { buildPathAuthorityEvidence } from "../../../sdk/packages/core/src/runtime/command-policy/path-authority-evidence-builder"
import { evaluateCommandPolicy } from "../../../sdk/packages/core/src/runtime/command-policy/index"

const TMP_ROOT = mkdtempSync(join(tmpdir(), "cline-reader-path-authority-"))
const PROJECT_DIR = join(TMP_ROOT, "project")
const OUTSIDE_DIR = join(TMP_ROOT, "outside")
mkdirSync(PROJECT_DIR, { recursive: true })
mkdirSync(join(PROJECT_DIR, "logs"), { recursive: true })
mkdirSync(OUTSIDE_DIR, { recursive: true })

const INSIDE_FILE = join(PROJECT_DIR, "logs", "app.log")
const INSIDE_FILE2 = join(PROJECT_DIR, "README.md")
const OUTSIDE_FILE = join(OUTSIDE_DIR, "secret.txt")
const SYMLINK_INSIDE_PROJECT = join(PROJECT_DIR, "escape-link")
writeFileSync(INSIDE_FILE, "log line\n")
writeFileSync(INSIDE_FILE2, "# README\n")
writeFileSync(OUTSIDE_FILE, "outside\n")
symlinkSync(OUTSIDE_DIR, SYMLINK_INSIDE_PROJECT, "dir")

const CANONICAL_PROJECT_DIR = realpathSync(PROJECT_DIR)
const CANONICAL_INSIDE_FILE = realpathSync(INSIDE_FILE)
const CANONICAL_INSIDE_FILE2 = realpathSync(INSIDE_FILE2)
const CANONICAL_OUTSIDE_FILE = realpathSync(OUTSIDE_FILE)
const CANONICAL_SYMLINK_INSIDE_PROJECT = realpathSync(SYMLINK_INSIDE_PROJECT)

function makeEvidence(command: string, opts: { roots?: string[]; cwd?: string } = {}) {
	const roots = (opts.roots ?? [CANONICAL_PROJECT_DIR]).slice().sort()
	const cwd = opts.cwd ?? CANONICAL_PROJECT_DIR
	const result = buildPathAuthorityEvidence({
		workspaceRoots: roots,
		cwd,
		command: { command },
	})
	if (!result.ok) throw new Error(`buildPathAuthorityEvidence failed: ${result.reason}`)
	return result.evidence
}

function evaluate(cmd: string, opts: { evidence?: ReturnType<typeof makeEvidence>; roots?: string[]; cwd?: string } = {}) {
	const auth = commandHostAuthorization({
		mode: "safe-only",
		explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
		workspaceRoots: (opts.roots ?? [CANONICAL_PROJECT_DIR]).slice().sort(),
		cwd: opts.cwd ?? CANONICAL_PROJECT_DIR,
		pathAuthorityEvidence: opts.evidence,
	})
	return evaluateCommandPolicy({ toolInput: { command: cmd }, hostAuthorization: auth })
}

type Case = { cmd: string; decision: "allow" | "ask"; opts?: Parameters<typeof evaluate>[1]; note: string }

const CASES: Case[] = [
	{ cmd: `cat ${CANONICAL_INSIDE_FILE}`, decision: "allow", opts: { evidence: makeEvidence(`cat ${CANONICAL_INSIDE_FILE}`) }, note: "(1) cat FILE + matching evidence -> ALLOW" },
	{ cmd: `cat ${CANONICAL_INSIDE_FILE2} ${CANONICAL_INSIDE_FILE}`, decision: "allow", opts: { evidence: makeEvidence(`cat ${CANONICAL_INSIDE_FILE2} ${CANONICAL_INSIDE_FILE}`) }, note: "(2) cat FILE1 FILE2 + matching evidence -> ALLOW" },
	{ cmd: `head -30 ${CANONICAL_INSIDE_FILE}`, decision: "allow", opts: { evidence: makeEvidence(`head -30 ${CANONICAL_INSIDE_FILE}`) }, note: "(3) head -30 FILE + matching evidence -> ALLOW" },
	{ cmd: `head -n 30 ${CANONICAL_INSIDE_FILE}`, decision: "allow", opts: { evidence: makeEvidence(`head -n 30 ${CANONICAL_INSIDE_FILE}`) }, note: "(4) head -n 30 FILE + matching evidence -> ALLOW" },
	{ cmd: `tail -20 ${CANONICAL_INSIDE_FILE}`, decision: "allow", opts: { evidence: makeEvidence(`tail -20 ${CANONICAL_INSIDE_FILE}`) }, note: "(5) tail -20 FILE + matching evidence -> ALLOW" },
	{ cmd: `tail -n 20 ${CANONICAL_INSIDE_FILE}`, decision: "allow", opts: { evidence: makeEvidence(`tail -n 20 ${CANONICAL_INSIDE_FILE}`) }, note: "(6) tail -n 20 FILE + matching evidence -> ALLOW" },
	{ cmd: `cat ${CANONICAL_INSIDE_FILE}`, decision: "ask", note: "(7) cat FILE without evidence -> ASK" },
	{ cmd: `cat ${CANONICAL_OUTSIDE_FILE}`, decision: "ask", opts: { evidence: makeEvidence(`cat ${CANONICAL_OUTSIDE_FILE}`) }, note: "(8) cat /outside/file + matching evidence -> ASK (out of roots)" },
	{ cmd: `head -30 ${CANONICAL_OUTSIDE_FILE}`, decision: "ask", opts: { evidence: makeEvidence(`head -30 ${CANONICAL_OUTSIDE_FILE}`) }, note: "(9) head -30 /outside/file + matching evidence -> ASK (out of roots)" },
	{ cmd: `tail -20 ${CANONICAL_OUTSIDE_FILE}`, decision: "ask", opts: { evidence: makeEvidence(`tail -20 ${CANONICAL_OUTSIDE_FILE}`) }, note: "(10) tail -20 /outside/file + matching evidence -> ASK (out of roots)" },
	{ cmd: `cat ${CANONICAL_INSIDE_FILE}`, decision: "ask", opts: { evidence: makeEvidence(`cat ${CANONICAL_INSIDE_FILE}`, { roots: [tmpdir(), CANONICAL_PROJECT_DIR] }) }, note: "(11) cat FILE + evidence from BROADER roots -> ASK (CORRECTION04 invariant)" },
	{ cmd: `cat ${CANONICAL_INSIDE_FILE}`, decision: "ask", opts: { evidence: makeEvidence(`cat ${CANONICAL_INSIDE_FILE}`, { cwd: "/tmp" }) }, note: "(12) cat FILE + evidence from FOREIGN cwd -> ASK (CORRECTION04 invariant)" },
	{ cmd: `cat ${CANONICAL_SYMLINK_INSIDE_PROJECT}`, decision: "ask", opts: { evidence: makeEvidence(`cat ${CANONICAL_SYMLINK_INSIDE_PROJECT}`) }, note: "(13) cat <symlink-to-outside> + matching evidence -> ASK (symlink escape)" },
	{ cmd: `cat ${CANONICAL_INSIDE_FILE} | sh`, decision: "ask", opts: { evidence: makeEvidence(`cat ${CANONICAL_INSIDE_FILE} | sh`) }, note: "(14) cat FILE | sh -> ASK (dangerous-sink)" },
]

console.log("=== REAL_PRODUCTION_SEAM qualification (READER-PATH-AUTHORITY-INTEGRATION01) ===")
console.log(`TMP_ROOT: ${TMP_ROOT}`)
console.log(`PROJECT_DIR: ${PROJECT_DIR}`)
console.log()

let pass = 0
let fail = 0
for (const c of CASES) {
	const r = evaluate(c.cmd, c.opts)
	const kind = r.decision.kind
	const ok = kind === c.decision
	const tag = ok ? "PASS" : "FAIL"
	console.log(`${tag}  ${kind.padEnd(5)}  source=${r.decision.source.padEnd(45)} ${c.cmd}`)
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
