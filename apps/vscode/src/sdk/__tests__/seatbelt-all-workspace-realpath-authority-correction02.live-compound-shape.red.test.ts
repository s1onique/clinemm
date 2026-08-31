/**
 * ACT-CLINEMM-SEATBELT-ALL-WORKSPACE-REALPATH-AUTHORITY-CORRECTION02
 *
 * SYNTHETIC production-seam diagnostic suite (NOT a captured-live-fact).
 *
 * The original observation is from a live `codium-factory` run:
 *
 *   operator-prompt: wc -l <path1> && cat <path2> (both paths inside
 *                    the workspace root)
 *   auth composition: Auto-approve = ALL, seatbelt-experimental selected,
 *                     mandatorySeatbelt: true, pathAuthorityEvidenceOk: true
 *   finalDecision   = ask
 *   finalSource     = host_workspace_realpath_authority
 *
 * Predecessor `seatbelt-all-workspace-realpath-authority-correction01.test.ts`
 * covered the multi-element ARRAY shape and a few compound-string cases.
 * It did NOT cover the live specimen exactly. This file pins synthetic-
 * seam observations for each shape under the same auth composition.
 *
 * -------------------------------------------------------------------------
 * SUITE POSTURE: PASSING DIAGNOSTIC WITNESSES (current behavior pinned)
 * -------------------------------------------------------------------------
 *
 * Every test in this file asserts the CURRENT production-seam observation
 * under a synthetic toolInput shape. The suite is intentionally GREEN in
 * CI — the Factory test rule forbids leaving intentionally-failing tests
 * in the default Vitest discovery surface (the `src/sdk/[star][star]/[star].test.ts`
 * glob in `apps/vscode/vitest.config.ts`).
 *
 * Each witness classifies the observed state against the candidate-
 * defect taxonomy the causal review named:
 *
 *   SIBLING_DEFECT_CANDIDATE_NOT_BUNDLED
 *     - C1_SINGLE_R0_WITNESS (single-R0 ALLOW under ALL+Seatbelt)
 *     - P1 candidate: SEATBELT_EXECUTION_OBLIGATION_NOT_PROPAGATED_ON_
 *       SINGLE_R0_ALLOW (separate bounded ACT only; do not bundle into
 *       the array-evidence repair)
 *
 *   OPERAND_FLATTENING_HYPOTHESIS (STRONG / NOT_LIVE_CAUSAL)
 *     - WITNESS_SINGLE_STRING_COMPOUND (single-string `wc ... && cat`)
 *     - ABL_ARRAY_WITNESS               (multi-element array `["wc","cat"]`)
 *     The operand-count binding at `command-policy.ts:378-384` is the
 *     candidate locus; the live toolInput shape is UNBOUND.
 *
 *   CONSERVATION (must hold across any future repair)
 *     - C2_STALE_EVIDENCE_WITNESS
 *     - C3_OUTSIDE_ROOT_WITNESS
 *
 * -------------------------------------------------------------------------
 * WHY WITNESSES (NOT a failing RED)
 * -------------------------------------------------------------------------
 *
 * A failing RED would assert the DESIRED POST-FIX state and observe
 * production disagree. We do not have a production repair to green yet,
 * and the live causal path is UNBOUND. Shipping a permanently-fail-first
 * test violates the Factory test rule and biases future maintainers
 * toward any plausible fix without distinguishing live causation.
 *
 * Decision rule for the next ACT (per causal reviewer):
 *
 *   LIVE S2 + true RED reproduces flattened-evidence ASK
 *     ⇒ CAUSAL_BOUND ⇒ repair operand-to-command binding
 *     ⇒ GREEN ⇒ dogfood
 *   LIVE S1 (or S3)
 *     ⇒ S2 defect is independent ⇒ preserve finding
 *     ⇒ do NOT use it to explain the live approval card
 *   No live capture
 *     ⇒ CAPTURE_INSUFFICIENT ⇒ no production repair
 *
 * Once a fresh codium-factory reproduction with
 * `CLINEMM_DIAG_INPUT_SHAPE_V2=1` lands and the live shape is resolved:
 *
 *   - If live S2: create a real failing RED that asserts the desired
 *     ALLOW seatbelt source under the array shape, observe it fail,
 *     implement the bounded operand-to-command binding fix in the same
 *     ACT, observe it GREEN.
 *
 *   - If live S1 (or S3): preserve these synthetic witnesses; do NOT use
 *     the array-shape finding to explain the live approval card. The P1
 *     sibling candidate remains a separate bounded ACT.
 *
 * -------------------------------------------------------------------------
 * CLASSIFIER VS LIVE FACT (load-bearing epistemic distinction)
 * -------------------------------------------------------------------------
 *
 * This file is a CLASSIFIER + DIAGNOSTIC WITNESS, not a captured-live-
 * fact. The synthetic production seam exercises the policy layer in
 * isolation, but the live `codium-factory` request is shaped by the
 * model's tool-call adapter and the SdkInteractionCoordinator wrapper
 * before it reaches the SDK callback. Until the committed
 * `approval.sdk-controller.input-shape.v2` probe
 * (`CLINEMM_DIAG_INPUT_SHAPE_V2=1`, default-off) records a real
 * production request, the live `toolInput` shape is UNBOUND and these
 * witnesses are evidence-of-contract only.
 *
 * -------------------------------------------------------------------------
 * HALT CONDITIONS (local to this suite)
 * -------------------------------------------------------------------------
 *
 *   HALT_LIVE_INPUT_SHAPE_UNBOUND  (current)
 *   HALT_REALPATH_EVIDENCE_SEMANTICS_WEAKENED
 *     C2 / C3 witnesses stop holding (fail-closed stops fail-closing).
 *   HALT_SOURCE_KIND_COHERENCE_BROKEN
 *     Any source label in {host_mode_all_seatbelt_required, ...} is
 *     emitted with a non-allow kind (caught by the inline guards below).
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

// Inside-root victim for the synthetic-seam witnesses. Both operands
// resolve into this directory so the realpath evidence builder can
// resolve both operands.
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

describe("ACT-CLINEMM-SEATBELT-ALL-WORKSPACE-REALPATH-AUTHORITY-CORRECTION02 / synthetic production-seam witnesses", () => {
	let workspaceRoot: string
	let insideDir: string
	let outsideDir: string

	beforeAll(() => {
		workspaceRoot = realpathSync(process.cwd())
		mkdirSync(join(workspaceRoot, ".factory", "tmp"), { recursive: true })

		// Inside-root victim. Both operands resolve into this directory
		// so the realpath evidence builder can resolve both operands.
		insideDir = mkdtempSync(join(workspaceRoot, ".factory/tmp/ws-realpath-c02-"))
		_wcAbs = join(insideDir, "supervisor-builder.ts")
		_catAbs = join(insideDir, CAT_OPERAND_SUFFIX)
		writeFileSync(_wcAbs, "// benign specimen for the live compound witness\n", "utf8")
		writeFileSync(_catAbs, '{ "name": "long-horizon-harness" }\n', "utf8")

		// Outside-root victim for the C3 conservation witness.
		outsideDir = mkdtempSync(join(workspaceRoot, "../../clinemm-outside-c02-"))
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
	// C1_SINGLE_R0_WITNESS — synthetic production-seam observation
	// -------------------------------------------------------------------
	//
	// CLASSIFICATION:
	//   SIBLING_DEFECT_CANDIDATE_NOT_BUNDLED
	//     P1 candidate: SEATBELT_EXECUTION_OBLIGATION_NOT_PROPAGATED_ON_
	//     SINGLE_R0_ALLOW. Separate bounded ACT only.
	//
	// OBSERVED (current HEAD):
	//   decision.kind = allow
	//   decision.source = host_mode_safe_only_rule
	//   mandatorySeatbeltExecution = false
	//
	// DESIRED POST-FIX (preserved in comment, NOT asserted):
	//   decision.source = host_mode_all_seatbelt_required
	//   mandatorySeatbeltExecution = true
	//
	// DO NOT add a `expect(...).toBe("host_mode_all_seatbelt_required")`
	// assertion here until the P1 sibling ACT is opened and the bounded
	// per-command Seatbelt-execution-obligation propagation fix is
	// landed. Adding it now would re-create the
	// INTENTIONALLY_FAILING_CLASSIFIER_IN_DEFAULT_TEST_SURFACE defect
	// the causal reviewer flagged.
	it("C1_SINGLE_R0_WITNESS: single-R0 'cat <inside>' under ALL+Seatbelt+valid evidence — current source=host_mode_safe_only_rule, mandatorySeatbeltExecution=false (SIBLING_DEFECT_CANDIDATE_NOT_BUNDLED)", () => {
		const persistedAuth = makeProductionAuth({
			workspaceRoot,
			command: { command: catCmd(), requires_approval: false },
		})
		const stampedAuth = stampSeatbeltEnvelope(persistedAuth)

		const result = evaluateCommandToolApprovalWithPlan(
			{ command: catCmd(), requires_approval: false },
			stampedAuth,
		)

		// Source-kind coherence guard: source labels in
		// {host_mode_all_seatbelt_required, ...} MUST be emitted with
		// an allow kind. If the policy ever labels a non-allow kind
		// with an allow-class source, this assertion MUST catch it.
		if (result.decision.source === "host_mode_all_seatbelt_required") {
			expect(result.decision.kind).toBe("allow")
		}

		// Pin the CURRENT observation (not the desired post-fix).
		// eslint-disable-next-line no-console
		console.log(
			`[C1_SINGLE_R0_WITNESS] decision.kind=${result.decision.kind} source=${result.decision.source} mandatorySeatbeltExecution=${result.mandatorySeatbeltExecution} approved=${result.approved}`,
		)
		expect(result.approved).toBe(true)
		expect(result.decision.kind).toBe("allow")
		expect(result.decision.source).toBe("host_mode_safe_only_rule")
		expect(result.mandatorySeatbeltExecution).toBe(false)
	})

	// -------------------------------------------------------------------
	// WITNESS_SINGLE_STRING_COMPOUND — synthetic production-seam witness
	// -------------------------------------------------------------------
	//
	// CLASSIFICATION:
	//   OPERAND_FLATTENING_HYPOTHESIS (STRONG / NOT_LIVE_CAUSAL).
	//   The single-string `wc -l A && cat B` compound does NOT exhibit
	//   the live failure mode on the synthetic production seam: the
	//   `isOpaqueShellRendered` short-circuit on `&&` makes
	//   `findSafeRuleMatch` return undefined, so the path-bearing gate
	//   does not fire and the mode branch emits the conditional
	//   seatbelt source directly. The live shape being single-string
	//   is therefore unlikely under S1.
	//
	// OBSERVED (current HEAD):
	//   decision.kind = allow
	//   decision.source = host_mode_all_seatbelt_required
	//   mandatorySeatbeltExecution = true
	it("WITNESS_SINGLE_STRING_COMPOUND: 'wc -l <inside> && cat <inside>' under ALL+Seatbelt+valid evidence — synthetic witness; current source=host_mode_all_seatbelt_required (NOT on live causal path under S1)", () => {
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

		// Source-kind coherence guard.
		if (result.decision.source === "host_mode_all_seatbelt_required") {
			expect(result.decision.kind).toBe("allow")
		}

		// eslint-disable-next-line no-console
		console.log(
			`[WITNESS_SINGLE_STRING_COMPOUND] decision.kind=${result.decision.kind} source=${result.decision.source} mandatorySeatbeltExecution=${result.mandatorySeatbeltExecution} approved=${result.approved}`,
		)
		expect(result.approved).toBe(true)
		expect(result.decision.kind).toBe("allow")
		expect(result.decision.source).toBe("host_mode_all_seatbelt_required")
		expect(result.mandatorySeatbeltExecution).toBe(true)
	})

	// -------------------------------------------------------------------
	// ABL_ARRAY_WITNESS — synthetic production-seam observation
	// -------------------------------------------------------------------
	//
	// CLASSIFICATION:
	//   OPERAND_FLATTENING_HYPOTHESIS (STRONG / NOT_LIVE_CAUSAL).
	//   The same operands as the live compound, represented as the
	//   multi-element array shape. The canonical normalizer preserves
	//   the array verbatim. The evidence builder flattens operands
	//   across siblings (`path-authority-evidence-builder.ts:357-380`).
	//   The per-command `extractR0PathOperands(cat-element, ...)`
	//   returns only the cat operand (single-command-scoped). Card-
	//   inality mismatch at `command-policy.ts:378-384` → ASK /
	//   host_workspace_realpath_authority. This is a STRONG HYPOTHESIS
	//   for the array-shape path but is NOT_LIVE_CAUSAL until the live
	//   capture shows `inputForm=commands, normalizedCommandsLength=2`.
	//
	// OBSERVED (current HEAD):
	//   decision.kind = ask
	//   decision.source = host_workspace_realpath_authority
	//   mandatorySeatbeltExecution = false
	//   approved = false
	//
	// DESIRED POST-FIX (preserved in comment, NOT asserted):
	//   decision.kind = allow
	//   decision.source = host_mode_all_seatbelt_required
	//   mandatorySeatbeltExecution = true
	//
	// DO NOT add the post-fix assertions here until the live capture
	// confirms the live shape is S2 AND a bounded repair is landed in
	// the same ACT. The repair's failing-RED must be created from
	// scratch at that point.
	it("ABL_ARRAY_WITNESS: commands=['wc -l <inside>', 'cat <inside>'] under ALL+Seatbelt+valid evidence — current kind=ask, source=host_workspace_realpath_authority (OPERAND_FLATTENING_HYPOTHESIS / NOT_LIVE_CAUSAL)", () => {
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

		// Source-kind coherence guard.
		if (result.decision.source === "host_mode_all_seatbelt_required") {
			expect(result.decision.kind).toBe("allow")
		}

		// eslint-disable-next-line no-console
		console.log(
			`[ABL_ARRAY_WITNESS] decision.kind=${result.decision.kind} source=${result.decision.source} mandatorySeatbeltExecution=${result.mandatorySeatbeltExecution} approved=${result.approved}`,
		)
		expect(result.approved).toBe(false)
		expect(result.decision.kind).toBe("ask")
		expect(result.decision.source).toBe("host_workspace_realpath_authority")
		expect(result.mandatorySeatbeltExecution).toBe(false)
	})

	// -------------------------------------------------------------------
	// C2_STALE_EVIDENCE_WITNESS — conservation: operand-identity mismatch
	// -------------------------------------------------------------------
	//
	// Single-string cat (no `&&`) so the safe-rule matcher fires and
	// the path-bearing gate is engaged. Build evidence for `cat <A>`,
	// then evaluate `cat <package.json>` (a different operand). This
	// forces operand-identity mismatch in the path-bearing gate.
	//
	// Any future repair MUST keep this fail-closed. The bounded fix on
	// the array-shape operand-count binding MUST NOT widen to ignore
	// operand-identity mismatches.
	it("C2_STALE_EVIDENCE_WITNESS: single-string operand-identity mismatch under ALL+Seatbelt → ASK / host_workspace_realpath_authority (CONSERVATION; must NOT promote)", () => {
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

		// Source-kind coherence guard.
		if (result.decision.source === "host_mode_all_seatbelt_required") {
			expect(result.decision.kind).toBe("allow")
		}

		// eslint-disable-next-line no-console
		console.log(
			`[C2_STALE_EVIDENCE_WITNESS] decision.kind=${result.decision.kind} source=${result.decision.source} mandatorySeatbeltExecution=${result.mandatorySeatbeltExecution} approved=${result.approved}`,
		)
		expect(result.approved).toBe(false)
		expect(result.decision.kind).toBe("ask")
		expect(result.decision.source).toBe("host_workspace_realpath_authority")
		expect(result.mandatorySeatbeltExecution).toBe(false)
	})

	// -------------------------------------------------------------------
	// C3_OUTSIDE_ROOT_WITNESS — conservation: outside-root containment
	// -------------------------------------------------------------------
	//
	// Single-string cat (no `&&`) so the safe-rule matcher fires and
	// the path-bearing gate is engaged. The operand resolves outside
	// the workspace root. Any future repair MUST keep this fail-closed;
	// the seatbelt-allow label MUST NOT appear.
	it("C3_OUTSIDE_ROOT_WITNESS: single-string outside-root operand under ALL+Seatbelt → ASK fail-closed (CONSERVATION; must NOT promote)", () => {
		const outsideFile = join(outsideDir, "outside.ts")
		writeFileSync(outsideFile, "// outside-root C3 conservation witness\n", "utf8")

		const persistedAuth = makeProductionAuth({
			workspaceRoot,
			command: { command: catCmd(), requires_approval: false },
		})
		const stampedAuth = stampSeatbeltEnvelope(persistedAuth)

		const result = evaluateCommandToolApprovalWithPlan(
			{ command: `cat ${outsideFile}`, requires_approval: false },
			stampedAuth,
		)

		// Source-kind coherence guard.
		if (result.decision.source === "host_mode_all_seatbelt_required") {
			expect(result.decision.kind).toBe("allow")
		}

		// eslint-disable-next-line no-console
		console.log(
			`[C3_OUTSIDE_ROOT_WITNESS] decision.kind=${result.decision.kind} source=${result.decision.source} mandatorySeatbeltExecution=${result.mandatorySeatbeltExecution} approved=${result.approved}`,
		)
		expect(result.approved).toBe(false)
		expect(result.decision.kind).toBe("ask")
		expect(result.decision.source).not.toBe("host_mode_all_seatbelt_required")
	})
})