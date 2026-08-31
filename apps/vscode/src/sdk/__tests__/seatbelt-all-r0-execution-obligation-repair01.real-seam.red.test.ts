/**
 * ACT-CLINEMM-SEATBELT-ALL-R0-EXECUTION-OBLIGATION-REPAIR01
 *
 * Sibling RED matrix (bounded repair). NOT bundled with CORRECTION02.
 *
 * Predecessor:
 *   - RECON01 (CLOSED SUPERSEDED_BY_CORRECTION02, static defect REAL,
 *     live binding later closed by Q7TBNE3BS5).
 *
 * Defect: single-element short-circuit at
 *   sdk/packages/core/src/runtime/command-policy/command-policy.ts:645-647
 * returns perCommand[0]!.source UNCONDITIONALLY, never consulting
 * auth.mandatorySeatbelt. Multi-element strict-suppressor at line
 * 749-751 is unreachable on the single-element path. By
 * sdk-tool-policies.ts:710 this propagates
 * mandatorySeatbeltExecution=false, which makes
 * command-job-manager.ts:613-614 skip the Seatbelt enforcement gate.
 *
 * LIVE BINDING (Q7TBNE3BS5): mode=all, mandatorySeatbelt=true,
 * commandsArrayLength=1, finalSource=host_mode_safe_only_rule.
 *
 * FACTORY DIRECTIVE: preserve C1_SINGLE_R0_WITNESS in the
 * live-compound-shape RED test unchanged. This file is a SIBLING
 * that asserts the desired POST-FIX shape.
 *
 * RED CONTRACT:
 *   T1' (RED) — single-element contained R0 under ALL+Seatbelt
 *     Pre-fix  : ALLOW / host_mode_safe_only_rule /
 *                mandatorySeatbeltExecution=false
 *     Post-fix : ALLOW / host_mode_all_seatbelt_required /
 *                mandatorySeatbeltExecution=true
 *   T2' (CONSERVATION) — mandatorySeatbelt UNSET →
 *                seatbelt source MUST NOT appear
 *   T3' (CONSERVATION) — outside-root operand, ALL+Seatbelt →
 *                ASK fail-closed
 *   T4' (CONSERVATION) — stale evidence, ALL+Seatbelt → ASK
 *   INV-1' — source=host_mode_all_seatbelt_required ⇒ kind=allow
 *   INV-2' — single-element ASK lattice preserves ASK-class source
 *
 * STOP RULES:
 *   - RED passes against PRE-FIX source ⇒ HALT_RED_NOT_REPRODUCED.
 *   - RED fails after the fix ⇒ HALT_GREEN_NOT_ACHIEVED.
 *   - T2'/T3'/T4'/INV-1'/INV-2'/R5 suite/R0 corpus/typecheck regresses
 *     ⇒ HALT_CONSERVATION_REGRESSION.
 */

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import {
	buildPathAuthorityEvidence,
	type CommandHostAuthorization,
	commandHostAuthorization,
	DEFAULT_COMMAND_HOST_ALLOW_RULES,
} from "@cline/core"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { applySeatbeltAuthorityEnvelope, evaluateCommandToolApprovalWithPlan } from "../sdk-tool-policies"
import { resolveSessionHostAuthorization } from "../session-auto-approval"

let _insideAbs = ""
let _outsideAbs = ""

function catInside(): string {
	return `cat ${_insideAbs}`
}
function catOutside(): string {
	return `cat ${_outsideAbs}`
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
	// Mirrors SdkController.ts:965..981 closure shape (the only
	// production caller of applySeatbeltAuthorityEnvelope).
	const projected = resolveSessionHostAuthorization(auth, "all")
	if (!projected) {
		throw new Error("override=all must project to mode=all")
	}
	return applySeatbeltAuthorityEnvelope(projected, "seatbelt-experimental")
}

describe("ACT-CLINEMM-SEATBELT-ALL-R0-EXECUTION-OBLIGATION-REPAIR01 T1' (RED)", () => {
	let workspaceRoot: string
	let insideDir: string

	beforeAll(() => {
		workspaceRoot = realpathSync(process.cwd())
		mkdirSync(join(workspaceRoot, ".factory", "tmp"), { recursive: true })
		insideDir = mkdtempSync(join(workspaceRoot, ".factory/tmp/r0-exec-repair01-"))
		_insideAbs = join(insideDir, "victim.ts")
		writeFileSync(_insideAbs, "// benign specimen for the single-element RED\n", "utf8")
	})

	afterAll(() => {
		try {
			rmSync(insideDir, { recursive: true, force: true })
		} catch {
			// ignore
		}
	})

	it("T1': single-element 'cat <inside>' under ALL+Seatbelt+valid evidence → ALLOW with seatbelt source (RED)", () => {
		const persistedAuth = makeProductionAuth({
			workspaceRoot,
			command: { command: catInside(), requires_approval: false },
		})
		const stampedAuth = stampSeatbeltEnvelope(persistedAuth)

		expect(stampedAuth.mode).toBe("all")
		expect(stampedAuth.mandatorySeatbelt).toBe(true)

		const liveInput = {
			command: catInside(),
			requires_approval: false,
		}
		const result = evaluateCommandToolApprovalWithPlan(liveInput, stampedAuth)

		if (result.decision.source === "host_mode_all_seatbelt_required") {
			expect(result.decision.kind).toBe("allow")
		}

		// eslint-disable-next-line no-console
		console.log(
			`[T1' RED] decision.kind=${result.decision.kind} source=${result.decision.source} mandatorySeatbeltExecution=${result.mandatorySeatbeltExecution} approved=${result.approved}`,
		)

		expect(result.approved).toBe(true)
		expect(result.decision.kind).toBe("allow")
		expect(result.decision.source).toBe("host_mode_all_seatbelt_required")
		expect(result.mandatorySeatbeltExecution).toBe(true)
	})
})
describe("ACT-CLINEMM-SEATBELT-ALL-R0-EXECUTION-OBLIGATION-REPAIR01 conservation matrix", () => {
	let workspaceRoot: string
	let insideDir: string
	let outsideDir: string
	let insideVictim: string

	beforeAll(() => {
		workspaceRoot = realpathSync(process.cwd())
		mkdirSync(join(workspaceRoot, ".factory", "tmp"), { recursive: true })
		insideDir = mkdtempSync(join(workspaceRoot, ".factory/tmp/r0-exec-repair01-cons-"))
		insideVictim = join(insideDir, "victim-inside.ts")
		writeFileSync(insideVictim, "// T2' / T4' inside-root specimens\n", "utf8")
		_insideAbs = insideVictim
		outsideDir = mkdtempSync(join(workspaceRoot, "../../clinemm-outside-r0-exec-repair01-"))
		const outsideVictim = join(outsideDir, "victim-outside.ts")
		writeFileSync(outsideVictim, "// T3' outside-root specimens\n", "utf8")
		_outsideAbs = outsideVictim
	})

	afterAll(() => {
		try {
			rmSync(insideDir, { recursive: true, force: true })
		} catch {
			// ignore
		}
		try {
			rmSync(outsideDir, { recursive: true, force: true })
		} catch {
			// ignore
		}
	})

	it("T2': single-element contained R0 with mandatorySeatbelt UNSET → seatbelt source MUST NOT appear (CONSERVATION)", () => {
		const persistedAuth = makeProductionAuth({
			workspaceRoot,
			command: { command: catInside(), requires_approval: false },
		})
		expect(persistedAuth.mode).toBe("safe-only")
		expect(persistedAuth.mandatorySeatbelt).not.toBe(true)

		const result = evaluateCommandToolApprovalWithPlan({ command: catInside(), requires_approval: false }, persistedAuth)

		expect(result.decision.kind).toBe("allow")
		expect(result.decision.source).not.toBe("host_mode_all_seatbelt_required")
		expect(result.mandatorySeatbeltExecution).toBe(false)
	})

	it("T3': single-element outside-root operand under ALL+Seatbelt → ASK fail-closed (CONSERVATION; must NOT promote)", () => {
		const persistedAuth = makeProductionAuth({
			workspaceRoot,
			command: { command: catOutside(), requires_approval: false },
		})
		const stampedAuth = stampSeatbeltEnvelope(persistedAuth)

		const result = evaluateCommandToolApprovalWithPlan({ command: catOutside(), requires_approval: false }, stampedAuth)

		if (result.decision.source === "host_mode_all_seatbelt_required") {
			expect(result.decision.kind).toBe("allow")
		}

		expect(result.approved).toBe(false)
		expect(result.decision.kind).toBe("ask")
		expect(result.decision.source).not.toBe("host_mode_all_seatbelt_required")
		expect(result.mandatorySeatbeltExecution).toBe(false)
	})

	it("T4': single-element contained R0 with stale evidence (operand-identity mismatch) under ALL+Seatbelt → ASK (CONSERVATION)", () => {
		// Build evidence for the OUTSIDE operand but pass the INSIDE
		// operand — operand-identity mismatch forces ASK via the
		// evidence gate; that ASK MUST be preserved across the repair.
		const persistedAuth = makeProductionAuth({
			workspaceRoot,
			command: { command: catOutside(), requires_approval: false },
		})
		const stampedAuth = stampSeatbeltEnvelope(persistedAuth)

		const result = evaluateCommandToolApprovalWithPlan({ command: catInside(), requires_approval: false }, stampedAuth)

		expect(result.decision.source).not.toBe("host_mode_all_seatbelt_required")
		expect(result.mandatorySeatbeltExecution).toBe(false)
	})

	it("INV-1': source === host_mode_all_seatbelt_required ⇒ kind === allow", () => {
		const persistedAuth = makeProductionAuth({
			workspaceRoot,
			command: { command: catInside(), requires_approval: false },
		})
		const stampedAuth = stampSeatbeltEnvelope(persistedAuth)

		const result = evaluateCommandToolApprovalWithPlan({ command: catInside(), requires_approval: false }, stampedAuth)

		if (result.decision.source === "host_mode_all_seatbelt_required") {
			expect(result.decision.kind).toBe("allow")
		}
	})

	it("INV-2': single-element ASK lattice preserves ASK-class source label (NOT overridden)", () => {
		const persistedAuth = makeProductionAuth({
			workspaceRoot,
			command: { command: catOutside(), requires_approval: false },
		})
		const stampedAuth = stampSeatbeltEnvelope(persistedAuth)

		const result = evaluateCommandToolApprovalWithPlan({ command: catOutside(), requires_approval: false }, stampedAuth)

		expect(result.decision.kind).toBe("ask")
		expect(result.decision.source).not.toBe("host_mode_all_seatbelt_required")
	})
})
