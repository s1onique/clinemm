// ACT-CLINEMM-COMMAND-RISK-V2-PIPELINE-LEAF-COMPOSITION01-CORRECTION04
// REAL_PRODUCTION_SEAM qualification harness.
//
// Reviewer disposition of CORRECTION03 closure:
//   HALT_PATH_EVIDENCE_CONTEXT_NOT_BOUND (P0)
//
// CORRECTION03 closed the missing-operand binding case but
// left a residual binding hole: the evidence's `roots` set
// and `cwd` were NOT bound to the current host
// authorization's `workspaceRoots` and `cwd`. Concretely:
//
//   CURRENT authorization: workspaceRoots=[/project], cwd=/project
//   EVIDENCE (stale):      roots=[/], cwd=/,
//                          operand=/outside,
//                          resolvedRealPath=/outside,
//                          contained=true   (per its OWN roots)
//
// Pre-CORRECTION04:
//   operand identity matches ✓
//   resolvedRealPath != null  ✓
//   contained == true         ✓
//   -> ALLOW (capability reuse across root sets)
//
// CORRECTION04 PRODUCTION FIX:
//   `pathBearingOperandsBound(pathBearingOperands, evidence,
//    currentRoots, currentCwd)` now requires:
//     - `canonicalRootsEqual(currentRoots, evidence.roots)`
//     - `currentCwd === evidence.cwd`
//   as preconditions BEFORE any per-operand binding
//   consideration.
//
// 6-way adversarial discriminator (the load-bearing RED
// matrix the reviewer demanded):
//   (A) correct operand + same roots/cwd + valid evidence  -> ALLOW
//   (B) correct operand + evidence from BROADER roots     -> ASK (HALT_PATH_EVIDENCE_CONTEXT_NOT_BOUND)
//   (C) correct operand + evidence from DIFFERENT cwd     -> ASK
//   (D) wrong operand + valid evidence                    -> ASK   (CORRECTION03)
//   (E) matching symlink operand + contained=false        -> ASK
//   (F) no evidence                                       -> ASK
//
// Pathless compositions remain conservation ALLOW:
//   - echo hello | head -30
//   - pwd && head -30
//   - head -30
//
// All 9 cases must pass with the production
// `pathBearingOperandsBound` + canonical-form set-equality
// gate. Pre-CORRECTION04 cases (B) and (C) ALLOW'd; the
// section L RED tests built into the pipeline-leaf-
// composition suite prove the discriminator.

import { MvdanShHelper } from "../../../sdk/packages/core/src/runtime/command-policy/parser-helper/runtime"
import { evaluateCommandRiskWithParser } from "../../../sdk/packages/core/src/runtime/command-policy/command-risk-internal"
import { commandHostAuthorization } from "../../../sdk/packages/core/src/runtime/command-policy/command-policy-types"
import { DEFAULT_COMMAND_HOST_ALLOW_RULES } from "../../../sdk/packages/core/src/runtime/command-policy/command-safe-rules"
import { buildPathAuthorityEvidence } from "../../../sdk/packages/core/src/runtime/command-policy/path-authority-evidence-builder"
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const TMP_ROOT = mkdtempSync(join(tmpdir(), "cline-correction04-"))
const PROJECT_DIR = join(TMP_ROOT, "project")
const FOREIGN_CWD_PARENT = mkdtempSync(join(tmpdir(), "cline-correction04-foreign-"))
const OUTSIDE_DIR = join(TMP_ROOT, "outside")
mkdirSync(PROJECT_DIR, { recursive: true })
mkdirSync(join(PROJECT_DIR, "inside"), { recursive: true })
mkdirSync(OUTSIDE_DIR, { recursive: true })

let INSIDE_FILE = join(PROJECT_DIR, "inside", "ok.ts")
let SYMLINK_INSIDE_PROJECT = join(PROJECT_DIR, "escape-link")
writeFileSync(INSIDE_FILE, "// inside\n")
writeFileSync(join(OUTSIDE_DIR, "secret.txt"), "// outside\n")
symlinkSync(OUTSIDE_DIR, SYMLINK_INSIDE_PROJECT, "dir")

// Canonicalize at the fixture boundary (mirrors what a real host does
// before passing values to `commandHostAuthorization`). The policy
// compares roots + cwd by canonical-form set-equality against the
// evidence's already-canonicalized roots + cwd.
const CANONICAL_PROJECT_DIR = realpathSync(PROJECT_DIR)
const CANONICAL_INSIDE_FILE = realpathSync(INSIDE_FILE)
const CANONICAL_SYMLINK_INSIDE_PROJECT = realpathSync(SYMLINK_INSIDE_PROJECT)
const CANONICAL_FOREIGN_CWD = realpathSync(FOREIGN_CWD_PARENT)

const HELPER_PATH = "/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/sdk/packages/core/bin/parser-helper/darwin-arm64/cline-parser-helper"
const helper = new MvdanShHelper({
	platform: "darwin-arm64",
	binaryPath: () => HELPER_PATH,
})

function makeEvidenceFor(cmd: string, opts: { roots?: ReadonlyArray<string>; cwd?: string } = {}) {
	const r = buildPathAuthorityEvidence({
		workspaceRoots: opts.roots ?? [CANONICAL_PROJECT_DIR],
		cwd: opts.cwd ?? CANONICAL_PROJECT_DIR,
		command: { command: cmd },
	})
	if (!r.ok) throw new Error(`buildPathAuthorityEvidence failed: ${r.reason}`)
	return r.evidence
}

function makeAuth(opts: {
	roots?: ReadonlyArray<string>;
	cwd?: string;
	evidence?: any;
} = {}) {
	return commandHostAuthorization({
		mode: "safe-only",
		explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
		workspaceRoots: opts.roots ?? [CANONICAL_PROJECT_DIR],
		cwd: opts.cwd ?? CANONICAL_PROJECT_DIR,
		pathAuthorityEvidence: opts.evidence,
	})
}

async function evaluate(cmd: string, opts: Parameters<typeof makeAuth>[0]) {
	const auth = makeAuth(opts)
	const parsed = await helper.invoke({ command: cmd })
	return evaluateCommandRiskWithParser({ toolInput: cmd, hostAuthorization: auth, parserResult: parsed ?? undefined })
}

type Case = {
	cmd: string
	decision: "allow" | "ask"
	opts: Parameters<typeof makeAuth>[0]
	note: string
}

const CASES: Case[] = [
	// Conservation (no path authority dependency)
	{ cmd: "echo hello | head -30", decision: "allow", opts: {}, note: "pathless composition" },
	{ cmd: "pwd && head -30", decision: "allow", opts: {}, note: "pathless composition with &&" },
	{ cmd: "head -30", decision: "allow", opts: {}, note: "standalone stdin-only reader" },

	// (A) GREEN: correct operand + same roots/cwd + valid evidence -> ALLOW
	{
		cmd: `ls ${CANONICAL_INSIDE_FILE} | head -30`,
		decision: "allow",
		opts: { evidence: makeEvidenceFor(`ls ${CANONICAL_INSIDE_FILE} | head -30`) },
		note: "(A) correct operand + same authority context -> ALLOW",
	},

	// (B) THE HALT CASE: correct operand + evidence from BROADER roots -> ASK
	//     Capability reuse across root sets. Pre-CORRECTION04 this
	//     ALLOW'd because the binder only checked operand identity.
	{
		cmd: `ls ${CANONICAL_INSIDE_FILE} | head -30`,
		decision: "ask",
		opts: {
			// CURRENT (narrower) authorization: ONLY [PROJECT_DIR].
			roots: [CANONICAL_PROJECT_DIR],
			cwd: CANONICAL_PROJECT_DIR,
			// EVIDENCE constructed under broader roots
			// ([tmpdir(), PROJECT_DIR]); operand is contained
			// per the broader set, but evidence.roots does not
			// match the current auth's roots.
			evidence: makeEvidenceFor(`ls ${CANONICAL_INSIDE_FILE} | head -30`, {
				roots: [tmpdir(), CANONICAL_PROJECT_DIR].sort(),
			}),
		},
		note: "(B) CORRECTION04 HALT: stale-roots reuse -> ASK",
	},

	// (C) THE HALT CASE: correct operand + evidence from DIFFERENT cwd -> ASK
	//     Capability reuse across cwd. Pre-CORRECTION04 this
	//     ALLOW'd because the binder only checked operand identity.
	{
		cmd: `ls ${CANONICAL_INSIDE_FILE} | head -30`,
		decision: "ask",
		opts: {
			roots: [CANONICAL_PROJECT_DIR],
			cwd: CANONICAL_PROJECT_DIR,
			// EVIDENCE constructed against a foreign cwd.
			evidence: makeEvidenceFor(`ls ${CANONICAL_INSIDE_FILE} | head -30`, {
				cwd: CANONICAL_FOREIGN_CWD,
			}),
		},
		note: "(C) CORRECTION04 HALT: stale-cwd reuse -> ASK",
	},

	// (D) CORRECTION03 RED: wrong operand + valid evidence -> ASK
	{
		cmd: `ls /etc/passwd | head -30`,
		decision: "ask",
		opts: { evidence: makeEvidenceFor(`ls ${CANONICAL_INSIDE_FILE}`) },
		note: "(D) CORRECTION03 RED: pipe operand != evidence operand -> ASK",
	},

	// (E) symlink escape pipe + matching (uncontained) evidence -> ASK
	{
		cmd: `ls ${CANONICAL_SYMLINK_INSIDE_PROJECT} | head -30`,
		decision: "ask",
		opts: { evidence: makeEvidenceFor(`ls ${CANONICAL_SYMLINK_INSIDE_PROJECT} | head -30`) },
		note: "(E) symlink escape pipe + matching (uncontained) evidence -> ASK",
	},

	// (F) no evidence -> ASK
	{
		cmd: `ls ${CANONICAL_INSIDE_FILE} | head -30`,
		decision: "ask",
		opts: {},
		note: "(F) no evidence -> ASK",
	},
]

console.log("=== REAL_PRODUCTION_SEAM qualification (CORRECTION04) ===")
console.log(`TMP_ROOT: ${TMP_ROOT}`)
console.log(`PROJECT_DIR: ${PROJECT_DIR}`)
console.log()

let pass = 0
let fail = 0
for (const c of CASES) {
	const r = await evaluate(c.cmd, c.opts)
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
if (existsSync(FOREIGN_CWD_PARENT)) {
	try { rmSync(FOREIGN_CWD_PARENT, { recursive: true, force: true }) } catch { /* ignore */ }
}

process.exit(fail === 0 ? 0 : 1)
