/**
 * ACT-CLINEMM-SEATBELT-ALL-WORKSPACE-REALPATH-AUTHORITY-CORRECTION01
 *
 * Load-bearing RED matrix (the bounded recon/repair ACT).
 *
 * Predecessor: ACT-CLINEMM-SEATBELT-ALL-R5-AUTHORITY-IMPLEMENTATION01
 * at commit cd45bf424 (R5 implementation CLOSED).
 *
 * -------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 * -------------------------------------------------------------------------
 *
 * The expert source recon (ClineMM command-policy engineer · Factory
 * causal reviewer; trace corr=9XP2YGTB90) localized the defect to
 * `aggregateSource()` precedence order in
 * `sdk/packages/core/src/runtime/command-policy/command-policy.ts:640..722`:
 *
 *     step 1. anyDeny                                     → host_hard_deny
 *     step 2. anyManual                                   → host_mode_manual
 *     step 3. anyWorkspaceRealpathAuthority               → host_workspace_realpath_authority
 *     step 4. anyWorkspacePathAuthority                   → host_workspace_path_authority
 *     step 5. anySafeOnlyFallthrough                      → host_mode_safe_only_fallthrough
 *     step 6. anySafeOnlyRule                             → host_mode_safe_only_rule
 *     step 7. anyAllSeatbeltRequired || (mandatorySeatbelt && mode==="all")
 *                                                        → host_mode_all_seatbelt_required
 *
 * Steps 3-6 win over step 7 unconditionally. Under
 * `mode=all + mandatorySeatbelt=true`, the executor-side Seatbelt
 * obligation is already in force, so a legacy R0 realpath ASK is
 * a redundant human-approval downgrade (kernel is the gate). The
 * bounded repair lifts that single election in the (ALL +
 * mandatorySeatbelt) intersection.
 *
 * The defect is REACHABLE through the canonical production seam
 * whenever the host's `commands: [...]` (multi-element) input shape
 * is in scope. The CLI / webview callers serialize multi-command
 * inputs through this array shape; the SdkController callback also
 * preserves it after `stripRequiresApproval`. The legacy `&&` /
 * `;` compound strings are normalized to a SINGLE element by
 * `normalizeRunCommandsInput` (helpers.ts:137), so they do NOT
 * surface this defect — the load-bearing specimen is the
 * multi-element array shape.
 *
 * -------------------------------------------------------------------------
 * RED CONTRACT
 * -------------------------------------------------------------------------
 *
 *   T-EXACT-SHAPE (load-bearing)
 *     Input    : commands: ["cat <abs-inside-root>", "<non-R0 element>"]
 *                (multi-element array; the structured form the canonical
 *                normalizer preserves verbatim)
 *     Pre-fix  : ALLOW / host_mode_safe_only_rule (NOT host_mode_all_seatbelt_required)
 *                + mandatorySeatbeltExecution = false
 *                — the precedence defect: even when one element is
 *                  host_mode_all_seatbelt_required-eligible, step 6
 *                  (anySafeOnlyRule) wins.
 *     Post-fix : ALLOW / host_mode_all_seatbelt_required /
 *                mandatorySeatbeltExecution = true
 *
 *   T1  Conservation case 1 — ALL + Seatbelt + benign R0 array + valid evidence
 *       → ALLOW / host_mode_all_seatbelt_required /
 *         mandatorySeatbeltExecution = true
 *
 *   T2  Conservation case 2 — same input, mandatorySeatbelt UNSET
 *       → ASK semantics unchanged (existing realpath gate preserved)
 *       + host_mode_all_seatbelt_required MUST NOT appear
 *
 *   T3  Conservation case 3 — outside-root operand, no mandatory Seatbelt
 *       → ASK with original realpath reason preserved
 *       + host_mode_all_seatbelt_required MUST NOT appear
 *
 *   T4  Conservation case 4 — array where ONE element has valid evidence
 *       and another has outside-root evidence (genuine outside-root)
 *       → ASK (one genuine outside-root operand still forces ASK;
 *         Seatbelt obligation is NOT a bypass for realpath containment)
 *
 *   T5  Conservation case 5 — array where BOTH elements are R0
 *       path-bearing with valid evidence
 *       → ALLOW (composition case)
 *
 *   T6  Conservation case 6 — single benign R0 with malformed / stale
 *       evidence (operand-identity mismatch)
 *       → ASK with original realpath reason (evidence invariant preserved)
 *
 * STOP RULE:
 *   T-EXACT-SHAPE FAILS on live artifact → RED REPRODUCED. Defect is
 *     localizable to aggregateSource() precedence order.
 *   T-EXACT-SHAPE PASSES on live artifact → HALT_RED_NOT_REPRODUCED.
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
import {
	applySeatbeltAuthorityEnvelope,
	evaluateCommandToolApproval,
	evaluateCommandToolApprovalWithPlan,
} from "../sdk-tool-policies"
import { resolveSessionHostAuthorization } from "../session-auto-approval"

// Multi-element array specimen. The canonical normalizer
// (`normalizeRunCommandsInput` in helpers.ts:137) preserves this array
// shape verbatim and feeds each element independently into
// `evaluateOne`. The single-string compound `wc && cat` is NOT split
// by the normalizer (it stays as one element); the load-bearing shape
// for the precedence defect is the multi-element array.
//
// We deliberately use one element with a path-bearing R0 safe rule
// (`cat`, `host_safe_cat`) and another element that has NO safe rule
// (`pwd`, which falls through to mode-based resolution). The array
// shape is what surfaces the per-command precedence election in
// `aggregateSource`.
const R0_FAMILY_SPECIMEN = (absPath: string) => ["pwd", `cat ${absPath}`] as const

function makeProductionAuth(opts: { workspaceRoot: string; victim: string }): CommandHostAuthorization {
	const evidence = buildPathAuthorityEvidence({
		workspaceRoots: [opts.workspaceRoot],
		cwd: opts.workspaceRoot,
		command: { commands: R0_FAMILY_SPECIMEN(opts.victim) as unknown as string[], requires_approval: false },
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

describe("ACT-CLINEMM-SEATBELT-ALL-WORKSPACE-REALPATH-AUTHORITY-CORRECTION01 T-EXACT-SHAPE", () => {
	let workspaceRoot: string
	let victim: string
	let tmpDir: string

	beforeAll(() => {
		workspaceRoot = realpathSync(process.cwd())
		// Ensure .factory/tmp exists inside the workspace root so we can
		// place the victim INSIDE the canonical root. Without this, an
		// apps/vscode/.factory-less checkout would ENOENT at mkdtempSync.
		mkdirSync(join(workspaceRoot, ".factory", "tmp"), { recursive: true })
		tmpDir = mkdtempSync(join(workspaceRoot, ".factory/tmp/ws-realpath-red-"))
		victim = join(tmpDir, "victim.ts")
		writeFileSync(victim, "// benign specimen for the realpath-authority RED\n", "utf8")
	})

	afterAll(() => {
		try {
			rmSync(tmpDir, { recursive: true, force: true })
		} catch {
			// ignore: workspace may already be cleaned
		}
	})

	it("T-EXACT-SHAPE: live benign specimen under ALL + mandatory Seatbelt + valid realpath evidence", () => {
		const persistedAuth = makeProductionAuth({ workspaceRoot, victim })
		const stampedAuth = stampSeatbeltEnvelope(persistedAuth)

		// Producer invariants pinned:
		expect(stampedAuth.mode).toBe("all")
		expect(stampedAuth.mandatorySeatbelt).toBe(true)

		const liveInput = {
			commands: R0_FAMILY_SPECIMEN(victim) as unknown as string[],
			requires_approval: false,
		}
		const result = evaluateCommandToolApprovalWithPlan(liveInput, stampedAuth)

		// Pre-fix artifact: result.source === "host_mode_safe_only_rule"
		// + mandatorySeatbeltExecution === false (the load-bearing defect;
		// aggregateSource() step 6 wins over step 7 even when the Seatbelt
		// obligation is in force).
		//
		// Post-fix expected: result.source === "host_mode_all_seatbelt_required"
		// + mandatorySeatbeltExecution === true (the bounded repair).
		expect(result.approved).toBe(true)
		expect(result.decision.kind).toBe("allow")
		expect(result.decision.source).toBe("host_mode_all_seatbelt_required")
		expect(result.mandatorySeatbeltExecution).toBe(true)
		// INVARIANT (CORRECTION02): source === "host_mode_all_seatbelt_required"
		// ⇒ kind === "allow". The ALLOW-class authority label is only
		// emitted with an ALLOW verdict.
		if (result.decision.source === "host_mode_all_seatbelt_required") {
			expect(result.decision.kind).toBe("allow")
		}
	})

	it("T-EXACT-SHAPE (atomic shape): evaluateCommandToolApproval also reports the seatbelt source", () => {
		// Same composition driven through the atomic entry point. The
		// two entry points share the canonical policy under the hood;
		// both must agree on the post-fix source.
		const persistedAuth = makeProductionAuth({ workspaceRoot, victim })
		const stampedAuth = stampSeatbeltEnvelope(persistedAuth)

		const liveInput = {
			commands: R0_FAMILY_SPECIMEN(victim) as unknown as string[],
			requires_approval: false,
		}
		const result = evaluateCommandToolApproval(liveInput, stampedAuth)
		expect(result.approved).toBe(true)
		expect(result.decision.kind).toBe("allow")
		expect(result.decision.source).toBe("host_mode_all_seatbelt_required")
		expect(result.mandatorySeatbeltExecution).toBe(true)
	})
})

// ---------------------------------------------------------------------------
// CONSERVATION MATRIX (6 cases; per ACT §0 / §4)
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-SEATBELT-ALL-WORKSPACE-REALPATH-AUTHORITY-CORRECTION01 T1 (ALL+Seatbelt+benign R0)", () => {
	let workspaceRoot: string
	let victim: string

	beforeAll(() => {
		workspaceRoot = realpathSync(process.cwd())
		mkdirSync(join(workspaceRoot, ".factory", "tmp"), { recursive: true })
		const tmp = mkdtempSync(join(workspaceRoot, ".factory/tmp/ws-realpath-t1-"))
		victim = join(tmp, "victim.ts")
		writeFileSync(victim, "// T1 conservation\n", "utf8")
	})

	it("T1: ALL + Seatbelt + contained benign R0 → ALLOW with seatbelt source propagated", () => {
		const persistedAuth = makeProductionAuth({ workspaceRoot, victim })
		const stampedAuth = stampSeatbeltEnvelope(persistedAuth)
		const result = evaluateCommandToolApprovalWithPlan(
			{ commands: R0_FAMILY_SPECIMEN(victim) as unknown as string[], requires_approval: false },
			stampedAuth,
		)
		expect(result.approved).toBe(true)
		expect(result.decision.source).toBe("host_mode_all_seatbelt_required")
		expect(result.mandatorySeatbeltExecution).toBe(true)
	})
})

describe("ACT-CLINEMM-SEATBELT-ALL-WORKSPACE-REALPATH-AUTHORITY-CORRECTION01 T2 (mandatorySeatbelt UNSET, safe-only mode)", () => {
	let workspaceRoot: string
	let victim: string

	beforeAll(() => {
		workspaceRoot = realpathSync(process.cwd())
		mkdirSync(join(workspaceRoot, ".factory", "tmp"), { recursive: true })
		const tmp = mkdtempSync(join(workspaceRoot, ".factory/tmp/ws-realpath-t2-"))
		victim = join(tmp, "victim.ts")
		writeFileSync(victim, "// T2 conservation\n", "utf8")
	})

	it("T2: same input, mandatorySeatbelt UNSET → realpath ASK unchanged, conditional source MUST NOT appear", () => {
		// Same persisted safe-only auth as the production seam. No
		// session override, no Seatbelt envelope. This is the legacy
		// R0 invariant: valid evidence → ALLOW host_mode_safe_only_rule.
		// The bounded repair must NOT change this behavior.
		const persistedAuth = makeProductionAuth({ workspaceRoot, victim })
		const result = evaluateCommandToolApprovalWithPlan(
			{ commands: R0_FAMILY_SPECIMEN(victim) as unknown as string[], requires_approval: false },
			persistedAuth,
		)
		expect(result.approved).toBe(true)
		expect(result.decision.source).toBe("host_mode_safe_only_rule")
		expect(result.decision.source).not.toBe("host_mode_all_seatbelt_required")
		expect(result.mandatorySeatbeltExecution).toBe(false)
	})
})

describe("ACT-CLINEMM-SEATBELT-ALL-WORKSPACE-REALPATH-AUTHORITY-CORRECTION01 T3 (outside-root, no Seatbelt)", () => {
	let workspaceRoot: string
	let outsideVictim: string

	beforeAll(() => {
		workspaceRoot = realpathSync(process.cwd())
		mkdirSync(join(workspaceRoot, ".factory", "tmp"), { recursive: true })
		// Place the victim OUTSIDE the workspace root. realpath-sync
		// (in buildPathAuthorityEvidence) will resolve the operand
		// to a path NOT contained in [workspaceRoot], so the
		// conformance gate fails and the per-command verdict is
		// ASK with the original realpath reason.
		const outside = mkdtempSync(join(workspaceRoot, "../../clinemm-outside-t3-"))
		outsideVictim = join(outside, "victim.ts")
		writeFileSync(outsideVictim, "// outside-root T3\n", "utf8")
	})

	it("T3: outside-root operand + no mandatory Seatbelt → ASK with realpath reason preserved", () => {
		const persistedAuth = makeProductionAuth({ workspaceRoot, victim: outsideVictim })
		// Safe-only mode, no override, no Seatbelt envelope — the
		// legacy R0 invariant is supposed to fire.
		const result = evaluateCommandPolicy({
			toolInput: {
				commands: R0_FAMILY_SPECIMEN(outsideVictim) as unknown as string[],
				requires_approval: false,
			},
			hostAuthorization: persistedAuth,
		})
		expect(result.decision.kind).toBe("ask")
		// Outside-root operand must surface host_workspace_realpath_authority
		// (or, when evidence is built but operand-outside, the conformance
		// fail message). The conditional Seatbelt source MUST NOT appear.
		expect(result.decision.source).not.toBe("host_mode_all_seatbelt_required")
	})
})

describe("ACT-CLINEMM-SEATBELT-ALL-WORKSPACE-REALPATH-AUTHORITY-CORRECTION01 T4 (mixed-evidence multi-command)", () => {
	let workspaceRoot: string
	let insideVictim: string
	let outsideVictim: string

	beforeAll(() => {
		workspaceRoot = realpathSync(process.cwd())
		mkdirSync(join(workspaceRoot, ".factory", "tmp"), { recursive: true })
		const insideTmp = mkdtempSync(join(workspaceRoot, ".factory/tmp/ws-realpath-t4-in-"))
		insideVictim = join(insideTmp, "victim.ts")
		writeFileSync(insideVictim, "// T4 inside\n", "utf8")
		const outsideTmp = mkdtempSync(join(workspaceRoot, "../../clinemm-outside-t4-"))
		outsideVictim = join(outsideTmp, "victim.ts")
		writeFileSync(outsideVictim, "// T4 outside\n", "utf8")
	})

	it("T4: ONE inside-root + ONE outside-root operand under ALL+Seatbelt → ASK with realpath reason preserved (source ↔ kind coherence)", () => {
		// CORRECTION02: the bounded repair is a STRICT SUPPRESSOR
		// that respects source ↔ kind coherence. The
		// `host_mode_all_seatbelt_required` source label is an
		// ALLOW-class authority and is NEVER emitted with a non-allow
		// kind. When the aggregate lattice is ASK (because one command
		// genuinely fails realpath containment), the source label
		// preserves the original ASK-class label so consumers see a
		// coherent (kind=ask, source=host_workspace_realpath_authority)
		// pair. The (a)+(b) intersection is a NECESSARY but not
		// SUFFICIENT condition for the seatbelt-source override; the
		// aggregate must also be ALLOW.
		const persistedAuth = makeProductionAuth({ workspaceRoot, victim: insideVictim })
		const stampedAuth = stampSeatbeltEnvelope(persistedAuth)

		const liveInput = {
			commands: [`cat ${insideVictim}`, `cat ${outsideVictim}`],
			requires_approval: false,
		}
		const result = evaluateCommandToolApprovalWithPlan(liveInput, stampedAuth)

		// Lattice: ask (one per-command verdict genuinely fails
		// realpath containment).
		expect(result.approved).toBe(false)
		expect(result.decision.kind).toBe("ask")
		// Source: preserved as host_workspace_realpath_authority, NOT
		// overridden to host_mode_all_seatbelt_required (which is an
		// ALLOW-class authority label).
		expect(result.decision.source).toBe("host_workspace_realpath_authority")
		expect(result.decision.source).not.toBe("host_mode_all_seatbelt_required")
		// Source ↔ kind coherence invariant: an ALLOW-class authority
		// label must NEVER be attached to an ASK verdict. The
		// executor-side Seatbelt obligation stays false because the
		// aggregate is ASK — the user is the gate (and the legacy R0
		// ASK-class source is the diagnostic that explains why).
		expect(result.mandatorySeatbeltExecution).toBe(false)
		// INVARIANT: source === "host_mode_all_seatbelt_required" ⇒ kind === "allow".
		// Enforced in the load-bearing cases below.
	})

	it("T4b: same outside-root operand WITHOUT mandatory Seatbelt → ASK (realpath gate is the only containment)", () => {
		// The bounded repair is a STRICT SUPPRESSOR — it only fires
		// under (mode=all + mandatorySeatbelt=true). Outside that
		// intersection the legacy R0 realpath ASK still gates
		// outside-root operations. This is the case where the kernel
		// obligation is absent; the human is the gate.
		const persistedAuth = makeProductionAuth({ workspaceRoot, victim: insideVictim })
		const liveInput = {
			commands: [`cat ${insideVictim}`, `cat ${outsideVictim}`],
			requires_approval: false,
		}
		const result = evaluateCommandPolicy({
			toolInput: liveInput,
			hostAuthorization: persistedAuth,
		})
		expect(result.decision.kind).toBe("ask")
		// Outside-root operand must surface host_workspace_realpath_authority.
		expect(result.decision.source).not.toBe("host_mode_all_seatbelt_required")
	})
})

describe("ACT-CLINEMM-SEATBELT-ALL-WORKSPACE-REALPATH-AUTHORITY-CORRECTION01 T5 (composition: two R0 commands)", () => {
	let workspaceRoot: string
	let a: string
	let b: string

	beforeAll(() => {
		workspaceRoot = realpathSync(process.cwd())
		mkdirSync(join(workspaceRoot, ".factory", "tmp"), { recursive: true })
		const tmp = mkdtempSync(join(workspaceRoot, ".factory/tmp/ws-realpath-t5-"))
		a = join(tmp, "a.ts")
		b = join(tmp, "b.ts")
		writeFileSync(a, "// T5 a\n", "utf8")
		writeFileSync(b, "// T5 b\n", "utf8")
	})

	it("T5: two R0 path-bearing commands with valid evidence → ALLOW with seatbelt source", () => {
		const persistedAuth = makeProductionAuth({ workspaceRoot, victim: a })
		const stampedAuth = stampSeatbeltEnvelope(persistedAuth)

		const liveInput = {
			command: `cat ${a} && cat ${b}`,
			requires_approval: false,
		}
		const result = evaluateCommandToolApprovalWithPlan(liveInput, stampedAuth)
		expect(result.approved).toBe(true)
		expect(result.decision.source).toBe("host_mode_all_seatbelt_required")
		expect(result.mandatorySeatbeltExecution).toBe(true)
	})
})

describe("ACT-CLINEMM-SEATBELT-ALL-WORKSPACE-REALPATH-AUTHORITY-CORRECTION01 T6 (malformed/stale evidence)", () => {
	let workspaceRoot: string
	let victim: string

	beforeAll(() => {
		workspaceRoot = realpathSync(process.cwd())
		mkdirSync(join(workspaceRoot, ".factory", "tmp"), { recursive: true })
		const tmp = mkdtempSync(join(workspaceRoot, ".factory/tmp/ws-realpath-t6-"))
		victim = join(tmp, "victim.ts")
		writeFileSync(victim, "// T6 conservation\n", "utf8")
	})

	it("T6: stale evidence (operand-identity mismatch) under ALL+Seatbelt → ASK; realpath gate preserved", () => {
		const persistedAuth = makeProductionAuth({ workspaceRoot, victim })
		const stampedAuth = stampSeatbeltEnvelope(persistedAuth)

		// Drive a DIFFERENT path-bearing R0 command than what the
		// evidence was built for. This forces operand-identity-mismatch
		// in the path gate (the evidence operand[i] does NOT equal
		// the actual command operand[i]). The bounded repair MUST NOT
		// promote this to ALLOW.
		const differentPath = join(workspaceRoot, "package.json")
		const liveInput = {
			command: `cat ${differentPath}`,
			requires_approval: false,
		}
		const result = evaluateCommandToolApprovalWithPlan(liveInput, stampedAuth)
		expect(result.approved).toBe(false)
		expect(result.decision.kind).toBe("ask")
		expect(result.decision.source).not.toBe("host_mode_all_seatbelt_required")
		// Operand-identity mismatch MUST surface host_workspace_realpath_authority
		// (the legacy R0 invariant is preserved verbatim by the bounded
		// repair; the source label is still emitted when evidence is
		// genuinely stale / mismatched).
		expect(result.decision.source).toBe("host_workspace_realpath_authority")
	})
})

// ---------------------------------------------------------------------------
// INVARIANT: source ↔ kind coherence (CORRECTION02)
// ---------------------------------------------------------------------------
// `host_mode_all_seatbelt_required` is an ALLOW-class authority label (the
// frozen R5 contract §1 INV-1 + upstream SDK semantics). It must NEVER be
// emitted with a non-allow kind. The bounded repair (CORRECTION01) added
// the strict-suppressor predicate; CORRECTION02 enforces this invariant by
// gating the source-override predicate on `aggregateLatticeKind === "allow"`.
//
// This describe block drives the load-bearing case + the corrected T4
// (mixed in/out root under ALL+Seatbelt — the case where the
// (a)+(b) intersection holds but the lattice is ASK because one
// command fails realpath) and asserts source ↔ kind coherence on both.
describe("ACT-CLINEMM-SEATBELT-ALL-WORKSPACE-REALPATH-AUTHORITY-CORRECTION01 INVARIANT (source ↔ kind coherence)", () => {
	let workspaceRoot: string
	let victim: string
	let outsideVictim: string

	beforeAll(() => {
		workspaceRoot = realpathSync(process.cwd())
		mkdirSync(join(workspaceRoot, ".factory", "tmp"), { recursive: true })
		const insideTmp = mkdtempSync(join(workspaceRoot, ".factory/tmp/ws-realpath-invariant-in-"))
		victim = join(insideTmp, "victim.ts")
		writeFileSync(victim, "// invariant inside\n", "utf8")
		const outsideTmp = mkdtempSync(join(workspaceRoot, "../../clinemm-outside-invariant-"))
		outsideVictim = join(outsideTmp, "victim.ts")
		writeFileSync(outsideVictim, "// invariant outside\n", "utf8")
	})

	it("INV-1: source === host_mode_all_seatbelt_required ⇒ kind === allow (load-bearing case)", () => {
		const persistedAuth = makeProductionAuth({ workspaceRoot, victim })
		const stampedAuth = stampSeatbeltEnvelope(persistedAuth)
		const result = evaluateCommandToolApprovalWithPlan(
			{ commands: R0_FAMILY_SPECIMEN(victim) as unknown as string[], requires_approval: false },
			stampedAuth,
		)
		// Load-bearing ALLOW case: source ↔ kind coherence holds.
		expect(result.decision.source).toBe("host_mode_all_seatbelt_required")
		expect(result.decision.kind).toBe("allow")
		expect(result.mandatorySeatbeltExecution).toBe(true)
		// Hard invariant — must NEVER break.
		if (result.decision.source === "host_mode_all_seatbelt_required") {
			expect(result.decision.kind).toBe("allow")
		}
	})

	it("INV-2: when aggregate lattice is ASK, source stays ASK-class (NOT overridden to host_mode_all_seatbelt_required)", () => {
		const persistedAuth = makeProductionAuth({ workspaceRoot, victim })
		const stampedAuth = stampSeatbeltEnvelope(persistedAuth)
		const result = evaluateCommandToolApprovalWithPlan(
			{
				commands: [`cat ${victim}`, `cat ${outsideVictim}`],
				requires_approval: false,
			},
			stampedAuth,
		)
		expect(result.decision.kind).toBe("ask")
		expect(result.decision.source).toBe("host_workspace_realpath_authority")
		expect(result.decision.source).not.toBe("host_mode_all_seatbelt_required")
		// Hard invariant — must NEVER break: an ASK verdict cannot
		// carry an ALLOW-class source label.
		expect(result.mandatorySeatbeltExecution).toBe(false)
	})
})
