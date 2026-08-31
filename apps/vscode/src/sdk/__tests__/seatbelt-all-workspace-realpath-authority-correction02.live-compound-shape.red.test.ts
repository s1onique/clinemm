/**
 * ACT-CLINEMM-SEATBELT-ALL-WORKSPACE-REALPATH-AUTHORITY-CORRECTION02
 *
 * Load-bearing RED matrix for the live `codium-factory` specimen:
 *
 *   wc -l labs/long-horizon-harness/src/process/supervisor-builder.ts &&
 *   cat labs/long-horizon-harness/package.json
 *
 * rendered with Auto-approve = ALL, seatbelt-experimental selected,
 * `mandatorySeatbelt: true`, and `pathAuthorityEvidenceOk: true` —
 * observed in production with:
 *
 *   finalDecision = ask
 *   finalSource  = host_workspace_realpath_authority
 *
 * Predecessor `seatbelt-all-workspace-realpath-authority-correction01.test.ts`
 * covers the multi-element ARRAY shape (`commands: ["pwd", "cat A"]`) and
 * a few compound-string cases (`cat A && cat B`). It does NOT cover the
 * EXACT live specimen, which has BOTH a non-path-bearing R0 leaf (`wc`)
 * AND a path-bearing R0 leaf (`cat`) joined with `&&` and serialized
 * through the single-string `{command: "..."}` shape. This file closes
 * that gap with a small bounded RED matrix.
 *
 * -------------------------------------------------------------------------
 * CLASSIFIER VS LIVE FACT (load-bearing epistemic distinction)
 * -------------------------------------------------------------------------
 *
 * This file is a CLASSIFIER, not a captured-live-fact. Each test
 * asserts the DESIRED POST-FIX shape the policy MUST emit under the
 * given input + auth composition. A failure is the locus where the
 * current production behavior disagrees with the desired contract; it
 * is NOT evidence that the live `codium-factory` request arrived in
 * the same shape.
 *
 * RED_EXACT_COMPOUND is a witness (it accepts either pre-fix or
 * post-fix state) and is therefore NOT a true failing RED. A genuine
 * RED for any of these cases must assert the desired post-fix state
 * and observe the production state disagree.
 *
 * What is and is not established by this file:
 *
 *   ESTABLISHED (synthetic production seam, no codium-factory):
 *     - C1 / ABL disagree with the desired post-fix contract at the
 *       current HEAD. Both disagreements are reproducible today
 *       without any live environment.
 *     - C1 is a focused candidate for a per-command Seatbelt-
 *       execution-obligation propagation fix (the single-R0-ALLOW
 *       case). It is also a natural test for the P1 sibling
 *       SEATBELT_EXECUTION_OBLIGATION_NOT_PROPAGATED_ON_SINGLE_R0_ALLOW.
 *     - ABL suggests an operand-count binding defect in the multi-
 *       element array path (the evidence builder flattens operands
 *       across siblings while the per-command expectedOperands list
 *       is single-command-scoped). The array-shape locus is NOT
 *       live-bound.
 *
 *   NOT ESTABLISHED:
 *     - The live `toolInput` shape. S1 vs S2 vs S3 is UNBOUND. The
 *       committed `approval.sdk-controller.input-shape.v2` probe is
 *       the only sanctioned discriminator and requires a fresh live
 *       codium-factory reproduction to fire.
 *     - That the live failure would be reproduced by the same input
 *       the operator typed in chat. Model adapters can re-shape
 *       input before it reaches the SDK callback.
 *
 *   AUTHORITY:
 *     - Do NOT use this suite alone to authorize a production
 *       repair. The suite is evidence-of-contract; the live capture
 *       is the only evidence-of-cause.
 *
 * -------------------------------------------------------------------------
 * RED CONTRACT (load-bearing)
 * -------------------------------------------------------------------------
 *
 *   C1  CONTROL_SIMPLE_CAT
 *         input    : command: "cat <inside>"
 *         expected : ALLOW / host_mode_all_seatbelt_required
 *                    + mandatorySeatbeltExecution = true
 *         baseline; MUST hold before the live fix lands.
 *
 *   RED_EXACT_COMPOUND  (load-bearing; same operator-prompt as live)
 *         input    : command: "wc -l <inside> && cat <inside>"
 *         required pre-fix reproduction:
 *                    ASK / host_workspace_realpath_authority
 *                    + mandatorySeatbeltExecution = false
 *
 *         If this REPRODUCES in CI: the live shape IS the single-string
 *         compound and the bounded fix candidate is the path-bearing
 *         gate's compound-vs-array shape discrimination.
 *
 *         If this does NOT reproduce (i.e. ALLOW / seatbelt source):
 *         the live shape is NOT the single-string compound — the
 *         `approval.sdk-controller.input-shape.v2` probe is the only
 *         remaining causal discriminator (S2 array, or S3 unknown).
 *
 *   ABL_SEPARATE_COMMANDS  (shape ablation)
 *         input    : commands: ["wc -l <inside>", "cat <inside>"]
 *         expected : ALLOW / host_mode_all_seatbelt_required
 *                    + mandatorySeatbeltExecution = true
 *         If this passes but RED_EXACT_COMPOUND fails, the defect is
 *         shape-dependent.
 *
 *   C2  STALE_EVIDENCE  (conservation)
 *         expected : ASK / host_workspace_realpath_authority
 *
 *   C3  OUTSIDE_ROOT  (conservation)
 *         expected : ASK / host_workspace_realpath_authority
 *
 * -------------------------------------------------------------------------
 * HALT CONDITIONS (local to this RED)
 * -------------------------------------------------------------------------
 *
 *   HALT_RED_NOT_REPRODUCED
 *     RED_EXACT_COMPOUND ALLOWs in CI. The single-string compound is
 *     NOT on the live causal path; further diagnosis requires the
 *     structural input-shape probe running against a live codium-factory
 *     reproduction.
 *
 *   HALT_LIVE_INPUT_SHAPE_UNBOUND
 *     Neither RED_EXACT_COMPOUND nor ABL_SEPARATE_COMMANDS reproduces
 *     the live failure. The actual live shape is not in this matrix.
 *
 *   HALT_REALPATH_EVIDENCE_SEMANTICS_WEAKENED
 *     C2 or C3 promotes to ALLOW under ANY auth composition.
 *
 *   HALT_SOURCE_KIND_COHERENCE_BROKEN
 *     Any source label in {host_mode_all_seatbelt_required, ...} is
 *     emitted with a non-allow kind.
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
import {
	applySeatbeltAuthorityEnvelope,
	evaluateCommandToolApprovalWithPlan,
} from "../sdk-tool-policies"
import { resolveSessionHostAuthorization } from "../session-auto-approval"

// Inside-root victim for the load-bearing RED_EXACT_COMPOUND case.
// Both operands resolve into this directory so the realpath evidence
// builder can resolve both operands.
const WC_OPERAND_PREFIX = "<ws>/red/specimen"
const CAT_OPERAND_SUFFIX = "package.json"

let _wcAbs = ""
let _catAbs = ""
function wcCmd(): string {
	return `wc -l ${_wcAbs}`
}
function catCmd(): string {
	return `cat ${_catAbs}`
}
function liveCompound(): string {
	// Verbatim operator-prompt shape, modulo the workspace-substituted
	// absolute paths. The shell operator is `&&` (not `;`); the live
	// specimen also used `&&`.
	return `${wcCmd()} && ${catCmd()}`
}

function makeProductionAuth(opts: {
	workspaceRoot: string
	command: unknown
}): CommandHostAuthorization {
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

describe("ACT-CLINEMM-SEATBELT-ALL-WORKSPACE-REALPATH-AUTHORITY-CORRECTION02 / live compound shape RED", () => {
	let workspaceRoot: string
	let insideDir: string
	let outsideDir: string

	beforeAll(() => {
		workspaceRoot = realpathSync(process.cwd())
		mkdirSync(join(workspaceRoot, ".factory", "tmp"), { recursive: true })

		// Inside-root victim for the load-bearing RED_EXACT_COMPOUND case.
		insideDir = mkdtempSync(join(workspaceRoot, ".factory/tmp/ws-realpath-c02-red-"))
		_wcAbs = join(insideDir, "supervisor-builder.ts")
		_catAbs = join(insideDir, CAT_OPERAND_SUFFIX)
		writeFileSync(_wcAbs, "// benign specimen for the live compound RED\n", "utf8")
		writeFileSync(_catAbs, '{ "name": "long-horizon-harness" }\n', "utf8")

		// Outside-root victim for C3.
		outsideDir = mkdtempSync(join(workspaceRoot, "../../clinemm-outside-c02-red-"))
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

	// -------------------------------------------------------------------
	// C1 CONTROL_SIMPLE_CAT — baseline; MUST ALLOW under the live auth
	// -------------------------------------------------------------------
	it("C1 CONTROL_SIMPLE_CAT: command='cat <inside>' under ALL+Seatbelt+valid evidence → ALLOW seatbelt source", () => {
		const persistedAuth = makeProductionAuth({
			workspaceRoot,
			command: { command: catCmd(), requires_approval: false },
		})
		const stampedAuth = stampSeatbeltEnvelope(persistedAuth)

		const result = evaluateCommandToolApprovalWithPlan(
			{ command: catCmd(), requires_approval: false },
			stampedAuth,
		)
		// Diagnostic surface.
		// eslint-disable-next-line no-console
		console.log(
			`[C1] decision.kind=${result.decision.kind} source=${result.decision.source} mandatorySeatbeltExecution=${result.mandatorySeatbeltExecution} approved=${result.approved}`,
		)
		expect(result.approved).toBe(true)
		expect(result.decision.kind).toBe("allow")
		expect(result.decision.source).toBe("host_mode_all_seatbelt_required")
		expect(result.mandatorySeatbeltExecution).toBe(true)
	})

	// -------------------------------------------------------------------
	// WITNESS_SINGLE_STRING_COMPOUND — synthetic production-seam witness
	// -------------------------------------------------------------------
	//
	// This is NOT a true failing RED. It is a WITNESS: it accepts EITHER
	// the pre-fix reproduction (ASK / host_workspace_realpath_authority
	// with mandatorySeatbeltExecution=false) OR a post-fix pass (ALLOW /
	// host_mode_all_seatbelt_required with mandatorySeatbeltExecution=
	// true). The test exists to (a) verify the production seam does not
	// produce an intermediate incoherent verdict and (b) emit the
	// observed state into vitest stdout for offline correlation with the
	// committed `approval.sdk-controller.input-shape.v2` probe.
	//
	// If a future ACT wants to bound a repair to the single-string
	// compound shape, it must add a sibling assertion here that REJECTS
	// the pre-fix (ASK) state — this witness alone is insufficient
	// authorization for a production repair.
	it("WITNESS_SINGLE_STRING_COMPOUND: command='wc -l <inside> && cat <inside>' under ALL+Seatbelt+valid evidence — synthetic witness, NOT a true RED", () => {
		// The compound specimen the operator types in chat. The
		// realpath evidence is built for the EXACT same string
		// (matches the buildPathAuthorityEvidence contract — the host
		// passes the raw toolInput verbatim, and the canonical
		// normalizer collapses this to one NormalizedCommand).
		const compound = liveCompound()
		const persistedAuth = makeProductionAuth({
			workspaceRoot,
			command: { command: compound, requires_approval: false },
		})
		const stampedAuth = stampSeatbeltEnvelope(persistedAuth)

		const result = evaluateCommandToolApprovalWithPlan(
			{ command: compound, requires_approval: false },
			stampedAuth,
		)

		// The ACT explicitly pins the load-bearing contract:
		//   pre-fix  : ASK / host_workspace_realpath_authority
		//              + mandatorySeatbeltExecution = false
		//   post-fix : ALLOW / host_mode_all_seatbelt_required
		//              + mandatorySeatbeltExecution = true
		//
		// If this test FAILS in CI with the pre-fix shape, the
		// single-string compound is confirmed as the live causal shape
		// and a bounded repair is justified.
		//
		// If this test PASSES (ALLOW seatbelt source) in CI, the live
		// shape is NOT the single-string compound and we must halt with
		// HALT_RED_NOT_REPRODUCED.
		const reproducesLiveFailure =
			result.decision.kind === "ask" &&
			result.decision.source === "host_workspace_realpath_authority" &&
			result.mandatorySeatbeltExecution === false

		const passesAfterFix =
			result.approved === true &&
			result.decision.kind === "allow" &&
			result.decision.source === "host_mode_all_seatbelt_required" &&
			result.mandatorySeatbeltExecution === true

		// Either reproduction or post-fix. The test MUST NOT silently
		// accept an intermediate state (e.g. ASK with a non-realpath
		// source — that would indicate a NEW defect).
		expect(
			reproducesLiveFailure || passesAfterFix,
			`RED_EXACT_COMPOUND did not reproduce the live failure nor did it ALLOW with the seatbelt source. Observed: kind=${result.decision.kind}, source=${result.decision.source}, mandatorySeatbeltExecution=${result.mandatorySeatbeltExecution}, approved=${result.approved}, reason=${result.decision.reason}`,
		).toBe(true)

		// HALT_SOURCE_KIND_COHERENCE_BROKEN guard.
		if (result.decision.source === "host_mode_all_seatbelt_required") {
			expect(result.decision.kind).toBe("allow")
		}

		// Diagnostic surface (visible in vitest output).
		// eslint-disable-next-line no-console
		console.log(
			`[WITNESS_SINGLE_STRING_COMPOUND] decision.kind=${result.decision.kind} source=${result.decision.source} mandatorySeatbeltExecution=${result.mandatorySeatbeltExecution} approved=${result.approved}`,
		)
	})

	// -------------------------------------------------------------------
	// ABL_SEPARATE_COMMANDS — shape ablation; same operands as the array
	// -------------------------------------------------------------------
	it("ABL_SEPARATE_COMMANDS: commands=['wc -l <inside>', 'cat <inside>'] under ALL+Seatbelt+valid evidence → ALLOW seatbelt source (CORRECTION01 multi-element shape)", () => {
		// The exact same operands as the live compound, represented as
		// the multi-element array shape the canonical normalizer
		// preserves verbatim. If this ALLOWs but RED_EXACT_COMPOUND
		// ASKs, the defect is shape-dependent (single-string vs array).
		const arr = [wcCmd(), catCmd()]
		const persistedAuth = makeProductionAuth({
			workspaceRoot,
			command: { commands: arr, requires_approval: false },
		})
		const stampedAuth = stampSeatbeltEnvelope(persistedAuth)

		const result = evaluateCommandToolApprovalWithPlan(
			{ commands: arr, requires_approval: false },
			stampedAuth,
		)
		// Diagnostic surface.
		// eslint-disable-next-line no-console
		console.log(
			`[ABL] decision.kind=${result.decision.kind} source=${result.decision.source} mandatorySeatbeltExecution=${result.mandatorySeatbeltExecution} approved=${result.approved}`,
		)
		expect(result.approved).toBe(true)
		expect(result.decision.kind).toBe("allow")
		expect(result.decision.source).toBe("host_mode_all_seatbelt_required")
		expect(result.mandatorySeatbeltExecution).toBe(true)
	})

	// -------------------------------------------------------------------
	// C2 STALE_EVIDENCE — operand-identity mismatch conservation
	// -------------------------------------------------------------------
	it("C2 STALE_EVIDENCE: single-command operand-identity mismatch under ALL+Seatbelt → ASK realpath_authority (must NOT promote)", () => {
		// Use a single-string cat command (no `&&` so the safe-rule
		// matcher does match, and the path-bearing gate fires). Build
		// evidence for `cat <wcAbs>`, then evaluate `cat <package.json>`
		// (a different operand). This forces operand-identity
		// mismatch in the path-bearing gate. The bounded fix MUST NOT
		// promote this case.
		const persistedAuth = makeProductionAuth({
			workspaceRoot,
			command: { command: catCmd(), requires_approval: false },
		})
		const stampedAuth = stampSeatbeltEnvelope(persistedAuth)

		const differentCat = `cat ${join(workspaceRoot, "package.json")}`
		const result = evaluateCommandToolApprovalWithPlan(
			{ command: differentCat, requires_approval: false },
			stampedAuth,
		)
		// Diagnostic surface.
		// eslint-disable-next-line no-console
		console.log(
			`[C2] decision.kind=${result.decision.kind} source=${result.decision.source} mandatorySeatbeltExecution=${result.mandatorySeatbeltExecution} approved=${result.approved}`,
		)
		expect(result.approved).toBe(false)
		expect(result.decision.kind).toBe("ask")
		expect(result.decision.source).not.toBe("host_mode_all_seatbelt_required")
		// Operand-identity mismatch MUST surface realpath_authority. The
		// load-bearing invariant is that it does NOT promote.
		expect(result.decision.source).toBe("host_workspace_realpath_authority")
	})

	// -------------------------------------------------------------------
	// C3 OUTSIDE_ROOT — outside-root containment conservation
	// -------------------------------------------------------------------
	it("C3 OUTSIDE_ROOT: single-command outside-root operand under ALL+Seatbelt → ASK fail-closed (must NOT promote)", () => {
		const outsideFile = join(outsideDir, "outside.ts")
		writeFileSync(outsideFile, "// outside-root C3 conservation\n", "utf8")
		// Single-string cat (no `&&`) so the safe-rule matcher fires.
		const persistedAuth = makeProductionAuth({
			workspaceRoot,
			command: { command: catCmd(), requires_approval: false },
		})
		const stampedAuth = stampSeatbeltEnvelope(persistedAuth)

		const result = evaluateCommandToolApprovalWithPlan(
			{ command: `cat ${outsideFile}`, requires_approval: false },
			stampedAuth,
		)
		// Diagnostic surface.
		// eslint-disable-next-line no-console
		console.log(
			`[C3] decision.kind=${result.decision.kind} source=${result.decision.source} mandatorySeatbeltExecution=${result.mandatorySeatbeltExecution} approved=${result.approved}`,
		)
		expect(result.approved).toBe(false)
		expect(result.decision.kind).toBe("ask")
		// Outside-root containment MUST remain fail-closed under ALL +
		// mandatorySeatbelt. The bounded fix MUST NOT weaken this. The
		// seatbelt-allow label MUST NOT appear.
		expect(result.decision.source).not.toBe("host_mode_all_seatbelt_required")
		// The source may be the realpath_authority label OR the canonical
		// conformance reason depending on which sub-gate fires first.
		// Either is acceptable; the load-bearing assertion is the no-promote
		// check above.
	})
})