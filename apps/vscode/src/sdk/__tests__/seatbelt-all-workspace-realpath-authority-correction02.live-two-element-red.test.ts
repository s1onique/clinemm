/**
 * ACT-CLINEMM-SEATBELT-ALL-WORKSPACE-REALPATH-AUTHORITY-CORRECTION02
 * Multi-element evidence-cardinality defect RED + POST-FIX GREEN.
 *
 * =================================================================
 * EPISTEMIC CLASSIFICATION (corrected by Factory reviewer)
 * =================================================================
 *
 * This suite does NOT reproduce the live specimen `54T24A8CE5`.
 * The live specimen was an OUTSIDE + INSIDE read; this suite is a
 * synthetic-real production-seam RED for a SAME-SHAPE-CATEGORY
 * SIBLING defect (BOTH-INSIDE commands[2]).
 *
 * Why this matters:
 *   - LIVE_CATEGORY_A (both-inside) proves a separate all-contained
 *     commands[2] request incorrectly ASKs because flat evidence
 *     is compared against per-command cardinality. Earns a
 *     bounded repair. But it does NOT prove the actual
 *     `54T24A8CE5` ASK was erroneous.
 *   - LIVE_CATEGORY_B (outside+inside) and ABL_REVERSED are
 *     CONSERVATION cases: the repair does NOT change outside+inside
 *     behavior. They still ASK. The `54T24A8CE5` outside+inside
 *     approval remains policy-expected under these tests.
 *
 * Correct disposition:
 *   MULTI_ELEMENT_EVIDENCE_CARDINALITY_DEFECT = REPAIRED
 *   LIVE_SHAPE_FAMILY                        = BOUND (commands[2])
 *   54T24A8CE5_CAUSAL_BINDING                = NOT PROVEN
 *   R5_MANUAL_APPROVAL_LANE                  = STILL OPEN
 *
 * =================================================================
 * DEFECT CLASS
 * =================================================================
 *
 * Per-command cardinality binding defect at
 * sdk/packages/core/src/runtime/command-policy/command-policy.ts
 * (the OLD line 378-384; shifted after this ACT).
 *
 * The host evidence builder flattens operands across commands
 * (path-authority-evidence-builder.ts:380-439), but the policy
 * checks cardinality per-command. For multi-element inputs,
 * commands past index 0 saw the wrong operand slice.
 *
 * Bounded repair: resolvePerCommand now computes per-command
 * offsets upfront and threads them into evaluateOne, which
 * slices auth.pathAuthorityEvidence.operands element-wise
 * before the cardinality, identity, and conformance checks.
 * Public API unchanged.
 *
 * =================================================================
 * LIVE CAPTURE REFERENCE (corr 54T24A8CE5, NOT reproduced here)
 * =================================================================
 *
 *   inputForm               = commands
 *   commandsArrayLength     = 2
 *   normalizedCommandsLength= 2
 *   normalizedKinds         = ["string","string"]
 *   resolvedMode            = all
 *   mandatorySeatbelt       = true
 *   pathAuthorityEvidenceOk = true
 *   finalDecision           = ask
 *   finalSource             = host_workspace_realpath_authority
 *
 * Visible command operands:
 *   outside workspace: /etc/profiles/per-user/chistyakov/bin/codium-clinemm
 *   inside workspace:  .../clinemm/.factory/evidence/.../live/
 *
 * The live category is LIVE_CATEGORY_B (outside+inside). The
 * tests in this file for LIVE_CATEGORY_B / ABL_REVERSED assert
 * POST-FIX behavior, which is ASK with
 * host_workspace_realpath_authority (legitimate fail-closed
 * for the outside operand).
 */

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import {
	buildPathAuthorityEvidence,
	type CommandHostAuthorization,
	commandHostAuthorization,
	DEFAULT_COMMAND_HOST_ALLOW_RULES,
	evaluateCommandPolicy,
} from "@cline/core"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { applySeatbeltAuthorityEnvelope, evaluateCommandToolApprovalWithPlan } from "../sdk-tool-policies"
import { resolveSessionHostAuthorization } from "../session-auto-approval"

// Both inside-workspace victims for the LIVE_CATEGORY_A test.
let _wcAbs = ""
let _catAbs = ""

function wcCmd(operand: string): string {
	return `wc -l ${operand}`
}
function catCmd(operand: string): string {
	return `cat ${operand}`
}

function makeProductionAuth(opts: { workspaceRoot: string; command: unknown }): CommandHostAuthorization {
	const evidence = buildPathAuthorityEvidence({
		workspaceRoots: [opts.workspaceRoot],
		cwd: opts.workspaceRoot,
		command: opts.command,
	})
	if (!evidence.ok) {
		throw new Error(`evidence builder failed: ${evidence.reason}`)
	}
	return commandHostAuthorization({
		mode: "safe-only",
		explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
		workspaceRoots: [opts.workspaceRoot],
		cwd: opts.workspaceRoot,
		pathAuthorityEvidence: evidence.evidence,
	})
}

function stampSeatbeltEnvelope(auth: CommandHostAuthorization): CommandHostAuthorization {
	// Mirrors SdkController.ts:965..981 closure shape.
	const projected = resolveSessionHostAuthorization(auth, "all")
	if (!projected) {
		throw new Error("override=all must project to mode=all")
	}
	return applySeatbeltAuthorityEnvelope(projected, "seatbelt-experimental")
}

function fmtPerCommand(perCommand: ReadonlyArray<{ index: number; matchedRuleSource?: string }>): string {
	return perCommand.map((c) => `[${c.index}].matchedRuleSource=${c.matchedRuleSource ?? "<none>"}`).join(", ")
}

describe("ACT-CLINEMM-SEATBELT-ALL-WORKSPACE-REALPATH-AUTHORITY-CORRECTION02 / live two-element real-seam RED + POST-FIX GREEN", () => {
	let workspaceRoot: string
	let insideDir: string
	let outsideDir: string
	let outsideFile: string

	beforeAll(() => {
		workspaceRoot = realpathSync(process.cwd())
		mkdirSync(join(workspaceRoot, ".factory", "tmp"), { recursive: true })

		insideDir = mkdtempSync(join(workspaceRoot, ".factory/tmp/ws-realpath-c02-live2-in-"))
		_wcAbs = join(insideDir, "supervisor-builder.ts")
		_catAbs = join(insideDir, "package.json")
		writeFileSync(_wcAbs, "// benign specimen for live two-element RED\n", "utf8")
		writeFileSync(_catAbs, '{ "name": "long-horizon-harness" }\n', "utf8")

		outsideDir = mkdtempSync(join(workspaceRoot, "../../clinemm-outside-c02-live2-"))
		outsideFile = join(outsideDir, "outside.ts")
		writeFileSync(outsideFile, "// outside-root live two-element RED\n", "utf8")
	})

	afterAll(() => {
		try {
			rmSync(insideDir, { recursive: true, force: true })
		} catch {
			/* ignore */
		}
		try {
			rmSync(outsideDir, { recursive: true, force: true })
		} catch {
			/* ignore */
		}
	})

	// ------------------------------------------------------------------
	// LIVE_CATEGORY_A — both operands inside workspace (POST-FIX GREEN)
	// ------------------------------------------------------------------
	// This is a SYNTHETIC-REAL PRODUCTION-SEAM RED for the
	// same-shape-category SIBLING defect. It is NOT a reproduction
	// of `54T24A8CE5` (which was outside+inside; see file header).
	//
	// What this witness DOES prove:
	//   - a separate all-contained commands[2] request incorrectly
	//     ASKed because flat evidence was compared against
	//     per-command cardinality (PRE-FIX).
	//   - POST-FIX the same request ALLOWs with seatbelt-required.
	//
	// What this witness does NOT prove:
	//   - that the live `54T24A8CE5` outside+inside approval prompt
	//     was erroneous. (See LIVE_CATEGORY_B + ABL_REVERSED below
	//     for the outside+inside CONSERVATION cases; they still ASK
	//     POST-FIX — the live prompt remains policy-expected under
	//     the tests committed here.)
	it("LIVE_CATEGORY_A (SYNTHETIC-REAL PRODUCTION-SEAM RED; SAME-SHAPE-CATEGORY SIBLING, NOT 54T24A8CE5): commands=['wc -l <inside>','cat <inside>'] under ALL+Seatbelt+valid evidence -> ALLOW / host_mode_all_seatbelt_required / mandatorySeatbeltExecution=true (POST-FIX GREEN)", () => {
		const arr = [wcCmd(_wcAbs), catCmd(_catAbs)]
		const persistedAuth = makeProductionAuth({
			workspaceRoot,
			command: { commands: arr, requires_approval: false },
		})
		const stampedAuth = stampSeatbeltEnvelope(persistedAuth)

		const result = evaluateCommandToolApprovalWithPlan({ commands: arr, requires_approval: false }, stampedAuth)
		const policy = evaluateCommandPolicy({
			toolInput: { commands: arr, requires_approval: false },
			hostAuthorization: stampedAuth,
		})
		// eslint-disable-next-line no-console
		console.log(
			`[LIVE_CATEGORY_A] aggregate.kind=${result.decision.kind} source=${result.decision.source} approved=${result.approved}; perCommand: ${fmtPerCommand(policy.commands)}`,
		)

		// POST-FIX: the per-command cardinality repair lets cat
		// pass the gate; aggregate is ALLOW with seatbelt-required.
		expect(result.approved).toBe(true)
		expect(result.decision.kind).toBe("allow")
		expect(result.decision.source).toBe("host_mode_all_seatbelt_required")
		expect(result.mandatorySeatbeltExecution).toBe(true)

		// Per-command shape post-fix: wc no matchedRuleSource,
		// cat has matchedRuleSource="host_safe_cat" (gate passed).
		expect(policy.commands.length).toBe(2)
		expect(policy.commands[0]?.matchedRuleSource).toBeUndefined()
		expect(policy.commands[1]?.matchedRuleSource).toBe("host_safe_cat")

		// Source-kind coherence guard (CORRECTION02 invariant).
		if (result.decision.source === "host_mode_all_seatbelt_required") {
			expect(result.decision.kind).toBe("allow")
		}
	})

	// ------------------------------------------------------------------
	// LIVE_CATEGORY_B — one operand inside, one operand outside
	// ------------------------------------------------------------------
	// Mirrors the LIVE categories exactly: one OUTSIDE candidate
	// + one INSIDE candidate. Post-fix this remains ASK because
	// the outside operand legitimately fails the realpath gate.
	it("LIVE_CATEGORY_B (MIRRORS 54T24A8CE5 LIVE CATEGORY — OUTSIDE+INSIDE): commands=['wc -l <inside>','cat <outside>'] under ALL+Seatbelt+valid evidence -> ASK / host_workspace_realpath_authority (CONSERVATION: outside operand legitimately fails realpath gate; ASK expected post-fix; live prompt remains policy-expected under the repair)", () => {
		const arr = [wcCmd(_wcAbs), catCmd(outsideFile)]
		const persistedAuth = makeProductionAuth({
			workspaceRoot,
			command: { commands: arr, requires_approval: false },
		})
		const stampedAuth = stampSeatbeltEnvelope(persistedAuth)

		const result = evaluateCommandToolApprovalWithPlan({ commands: arr, requires_approval: false }, stampedAuth)
		const policy = evaluateCommandPolicy({
			toolInput: { commands: arr, requires_approval: false },
			hostAuthorization: stampedAuth,
		})

		// eslint-disable-next-line no-console
		console.log(
			`[LIVE_CATEGORY_A] aggregate.kind=${result.decision.kind} source=${result.decision.source} approved=${result.approved}; perCommand: ${fmtPerCommand(policy.commands)}`,
		)

		// CONSERVATION — the outside operand legitimately fails
		// the per-command realpath gate post-fix. ASK is correct.
		expect(result.approved).toBe(false)
		expect(result.decision.kind).toBe("ask")
		expect(result.decision.source).toBe("host_workspace_realpath_authority")
		expect(result.mandatorySeatbeltExecution).toBe(false)
	})

	// ------------------------------------------------------------------
	// ABL_REVERSED — outside operand at index 0 (order-independent)
	// ------------------------------------------------------------------
	it("ABL_REVERSED (MIRRORS 54T24A8CE5 LIVE CATEGORY — OUTSIDE+INSIDE, reversed order): commands=['cat <outside>','wc -l <inside>'] under ALL+Seatbelt+valid evidence -> ASK / host_workspace_realpath_authority (CONSERVATION: order-independent; live prompt remains policy-expected)", () => {
		const arr = [catCmd(outsideFile), wcCmd(_wcAbs)]
		const persistedAuth = makeProductionAuth({
			workspaceRoot,
			command: { commands: arr, requires_approval: false },
		})
		const stampedAuth = stampSeatbeltEnvelope(persistedAuth)

		const result = evaluateCommandToolApprovalWithPlan({ commands: arr, requires_approval: false }, stampedAuth)

		expect(result.approved).toBe(false)
		expect(result.decision.kind).toBe("ask")
		expect(result.decision.source).toBe("host_workspace_realpath_authority")
		expect(result.mandatorySeatbeltExecution).toBe(false)
	})

	// ------------------------------------------------------------------
	// CONSERVATION_BOTH_OUTSIDE — kernel-containment invariant
	// ------------------------------------------------------------------
	it("CONSERVATION_BOTH_OUTSIDE: commands=['cat <outsideA>','cat <outsideB>'] under ALL+Seatbelt -> ASK fail-closed (CONSERVATION; kernel containment invariant)", () => {
		const outsideB = join(outsideDir, "outsideB.ts")
		writeFileSync(outsideB, "// outsideB\n", "utf8")
		const arr = [catCmd(outsideFile), catCmd(outsideB)]
		const persistedAuth = makeProductionAuth({
			workspaceRoot,
			command: { commands: arr, requires_approval: false },
		})
		const stampedAuth = stampSeatbeltEnvelope(persistedAuth)

		const result = evaluateCommandToolApprovalWithPlan({ commands: arr, requires_approval: false }, stampedAuth)

		expect(result.approved).toBe(false)
		expect(result.decision.kind).toBe("ask")
		expect(result.decision.source).not.toBe("host_mode_all_seatbelt_required")
		expect(result.mandatorySeatbeltExecution).toBe(false)
	})
})
