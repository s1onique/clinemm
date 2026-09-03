/**
 * ACT-CLINEMM-TEMPORARY-EXTERNAL-PATH-AUTHORITY01
 *
 * Conservation matrix for the temporary external path authority
 * extension to R0 workspace path authority.
 *
 * Contract (see ACT §4):
 *   - The policy's R0 path-bearing gate widens its containment
 *     set to:
 *         effectiveRoots = workspaceRoots
 *                        ∪ temporaryExternalCanonicalRoots
 *   - All other behavior is unchanged:
 *       * hard DENY still DENY
 *       * the safe-rule engine is the gate to ALLOW; the
 *         temporary roots do NOT authorize commands
 *       * operand-identity binding, realpath verification,
 *         Seatbelt, sensitive-file protections, and model
 *         escalation are unchanged
 */
import {
	existsSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { buildPathAuthorityEvidence } from "./path-authority-evidence-builder"
import {
	commandHostAuthorization,
	DEFAULT_COMMAND_HOST_ALLOW_RULES,
	evaluateCommandPolicy,
	evaluateCommandRealpathConformance,
} from "./index"
import type { WorkspacePathAuthorityEvidence } from "./path-authority-evidence"

let TMP_ROOT: string
let PROJECT_DIR: string
let TEMP_DIR: string
let TEMP_FILE: string
let SECRET_FILE: string
let PROJECT_FILE: string
let CANONICAL_PROJECT_DIR: string
let CANONICAL_TEMP_DIR: string

beforeAll(() => {
	TMP_ROOT = mkdtempSync(join(tmpdir(), "cline-temp-ext-authority-"))
	PROJECT_DIR = join(TMP_ROOT, "project")
	TEMP_DIR = join(TMP_ROOT, "external-temp")
	SECRET_FILE = join(TMP_ROOT, "secret.txt")

	mkdirSync(PROJECT_DIR, { recursive: true })
	mkdirSync(TEMP_DIR, { recursive: true })

	PROJECT_FILE = join(PROJECT_DIR, "ok.ts")
	TEMP_FILE = join(TEMP_DIR, "iCW.out")
	writeFileSync(PROJECT_FILE, "// project\n")
	writeFileSync(TEMP_FILE, "// temp\n")
	writeFileSync(SECRET_FILE, "// secret\n")

	// Adversarial: a symlink at the temp directory pointing to
	// the secret file. Any "containment in temp root" check that
	// uses the LEXICAL path would let this through; the realpath
	// gate MUST reject.
	symlinkSync(SECRET_FILE, join(TEMP_DIR, "leak.out"), "file")

	CANONICAL_PROJECT_DIR = realpathSync(PROJECT_DIR)
	CANONICAL_TEMP_DIR = realpathSync(TEMP_DIR)
})

afterAll(() => {
	if (TMP_ROOT && existsSync(TMP_ROOT)) {
		rmSync(TMP_ROOT, { recursive: true, force: true })
	}
})

function buildEvidence(opts: {
	command: unknown
	workspaceRoots?: ReadonlyArray<string>
	temporaryExternalCanonicalRoots?: ReadonlyArray<string>
}): WorkspacePathAuthorityEvidence | undefined {
	const result = buildPathAuthorityEvidence({
		workspaceRoots: opts.workspaceRoots ?? [CANONICAL_PROJECT_DIR],
		cwd: CANONICAL_PROJECT_DIR,
		command: opts.command,
		temporaryExternalCanonicalRoots: opts.temporaryExternalCanonicalRoots,
	})
	if (!result.ok) return undefined
	return result.evidence
}

describe("ACT-CLINEMM-TEMPORARY-EXTERNAL-PATH-AUTHORITY01 — RED/GREEN matrix", () => {
	it("RED→GREEN: temp root active covers the operand → contained: true", () => {
		const evidence = buildEvidence({
			command: `/usr/bin/cat ${TEMP_FILE}`,
			temporaryExternalCanonicalRoots: [CANONICAL_TEMP_DIR],
		})
		expect(evidence).toBeDefined()
		expect(evidence!.operands[0]!.contained).toBe(true)
		const conformance = evaluateCommandRealpathConformance(evidence!)
		expect(conformance.conforming).toBe(true)
	})

	it("R2: no exception set → operands outside workspace are NOT contained", () => {
		const evidence = buildEvidence({
			command: `/usr/bin/cat ${TEMP_FILE}`,
		})
		expect(evidence).toBeDefined()
		expect(evidence!.operands[0]!.contained).toBe(false)
	})

	it("R3: exception removed at the host boundary → operand NOT contained", () => {
		const evidence = buildEvidence({
			command: `/usr/bin/cat ${TEMP_FILE}`,
			temporaryExternalCanonicalRoots: [],
		})
		expect(evidence).toBeDefined()
		expect(evidence!.operands[0]!.contained).toBe(false)
	})

	it("R4: realpath collapses dot-segments; containment still holds", () => {
		const evidenceDotSegments = buildEvidence({
			command: `/usr/bin/cat ${join(TEMP_DIR, "subdir", "..", "iCW.out")}`,
			temporaryExternalCanonicalRoots: [CANONICAL_TEMP_DIR],
		})
		expect(evidenceDotSegments).toBeDefined()
		expect(evidenceDotSegments!.operands[0]!.resolvedRealPath).toBe(
			realpathSync(TEMP_FILE),
		)
		expect(evidenceDotSegments!.operands[0]!.contained).toBe(true)
	})

	it("R5: symlink at temp root → secret file is REJECTED (canonical escape)", () => {
		const leakTarget = join(TEMP_DIR, "leak.out")
		const evidence = buildEvidence({
			command: `/usr/bin/cat ${leakTarget}`,
			temporaryExternalCanonicalRoots: [CANONICAL_TEMP_DIR],
		})
		expect(evidence).toBeDefined()
		expect(evidence!.operands[0]!.resolvedRealPath).toBe(
			realpathSync(SECRET_FILE),
		)
		expect(evidence!.operands[0]!.contained).toBe(false)
	})

	it("R6: path outside workspace + temp roots → NOT contained", () => {
		const evidence = buildEvidence({
			command: `/usr/bin/cat /etc/passwd`,
			temporaryExternalCanonicalRoots: [CANONICAL_TEMP_DIR],
		})
		expect(evidence).toBeDefined()
		expect(evidence!.operands[0]!.contained).toBe(false)
	})

	it("R7: workspace path is unaffected by temporary roots", () => {
		const evidence = buildEvidence({
			command: `/usr/bin/cat ${PROJECT_FILE}`,
		})
		expect(evidence).toBeDefined()
		expect(evidence!.operands[0]!.contained).toBe(true)
	})

	it("R8: hard-DENY command inside temp root → not ALLOW (safe-rule gate)", () => {
		const auth = commandHostAuthorization({
			mode: "safe-only",
			explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
			workspaceRoots: [CANONICAL_PROJECT_DIR],
			cwd: CANONICAL_PROJECT_DIR,
			pathAuthorityEvidence: buildEvidence({
				command: `/usr/bin/rm -rf ${TEMP_DIR}`,
				temporaryExternalCanonicalRoots: [CANONICAL_TEMP_DIR],
			}),
			temporaryExternalCanonicalRoots: [CANONICAL_TEMP_DIR],
		})
		const r = evaluateCommandPolicy({
			toolInput: `/usr/bin/rm -rf ${TEMP_DIR}`,
			hostAuthorization: auth,
		})
		expect(r.decision.kind).not.toBe("allow")
	})

	it("R9: empty temporary roots list is structurally the pre-ACT behavior", () => {
		const evidence = buildEvidence({
			command: `/usr/bin/cat ${PROJECT_FILE}`,
			temporaryExternalCanonicalRoots: [],
		})
		expect(evidence).toBeDefined()
		expect(evidence!.temporaryExternalCanonicalRoots).toEqual([])
		expect(evidence!.roots).toEqual([CANONICAL_PROJECT_DIR])
	})

	it("R10: missing field (undefined) is structurally the pre-ACT behavior", () => {
		const evidence = buildEvidence({
			command: `/usr/bin/cat ${PROJECT_FILE}`,
		})
		expect(evidence).toBeDefined()
		expect(evidence!.temporaryExternalCanonicalRoots).toEqual([])
	})

	it("R11: authority-context binding (CORRECTION04) is preserved", () => {
		const evidence = buildEvidence({
			command: `/usr/bin/cat ${TEMP_FILE}`,
			temporaryExternalCanonicalRoots: [CANONICAL_TEMP_DIR],
		})
		expect(evidence).toBeDefined()
		// The temporary roots MUST NOT be mirrored into evidence.roots;
		// the V1 byte-equal authority-context binding must still hold.
		expect(evidence!.roots).toEqual([CANONICAL_PROJECT_DIR])
		expect(evidence!.temporaryExternalCanonicalRoots).toEqual([
			CANONICAL_TEMP_DIR,
		])
	})

	it("R12: full pipeline — temp root active → ALLOW", () => {
		const auth = commandHostAuthorization({
			mode: "safe-only",
			explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
			workspaceRoots: [CANONICAL_PROJECT_DIR],
			cwd: CANONICAL_PROJECT_DIR,
			pathAuthorityEvidence: buildEvidence({
				command: `cat ${TEMP_FILE}`,
				temporaryExternalCanonicalRoots: [CANONICAL_TEMP_DIR],
			}),
			temporaryExternalCanonicalRoots: [CANONICAL_TEMP_DIR],
		})
		const r = evaluateCommandPolicy({
			toolInput: `cat ${TEMP_FILE}`,
			hostAuthorization: auth,
		})
		expect(r.decision.kind).toBe("allow")
	})

	it("R13: full pipeline — same command WITHOUT temp root stays ASK", () => {
		const auth = commandHostAuthorization({
			mode: "safe-only",
			explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
			workspaceRoots: [CANONICAL_PROJECT_DIR],
			cwd: CANONICAL_PROJECT_DIR,
			pathAuthorityEvidence: buildEvidence({
				command: `cat ${TEMP_FILE}`,
			}),
		})
		const r = evaluateCommandPolicy({
			toolInput: `cat ${TEMP_FILE}`,
			hostAuthorization: auth,
		})
		expect(r.decision.kind).toBe("ask")
		expect(r.decision.source).toBe("host_workspace_realpath_authority")
	})

	it("R14: policy re-test — contained: true operand passes via the union", () => {
		const evidence: WorkspacePathAuthorityEvidence = {
			roots: [CANONICAL_PROJECT_DIR],
			cwd: CANONICAL_PROJECT_DIR,
			operands: [
				{
					operand: TEMP_FILE,
					resolvedRealPath: realpathSync(TEMP_FILE),
					contained: true,
					reason: "resolved-and-contained",
				},
			],
			temporaryExternalCanonicalRoots: [CANONICAL_TEMP_DIR],
		}
		const conformance = evaluateCommandRealpathConformance(evidence)
		expect(conformance.conforming).toBe(true)
	})

	it("R15: policy re-test — operand outside UNION still ASK (tamper-resistant)", () => {
		const evidence: WorkspacePathAuthorityEvidence = {
			roots: [CANONICAL_PROJECT_DIR],
			cwd: CANONICAL_PROJECT_DIR,
			operands: [
				{
					operand: "/etc/passwd",
					resolvedRealPath: "/etc/passwd",
					contained: true, // tampered — must still be caught
					reason: "resolved-and-contained",
				},
			],
			temporaryExternalCanonicalRoots: [CANONICAL_TEMP_DIR],
		}
		const conformance = evaluateCommandRealpathConformance(evidence)
		expect(conformance.conforming).toBe(false)
	})
})
