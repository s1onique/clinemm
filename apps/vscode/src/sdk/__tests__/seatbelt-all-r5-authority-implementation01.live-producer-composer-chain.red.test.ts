/**
 * ACT-CLINEMM-SEATBELT-ALL-R5-AUTHORITY-IMPLEMENTATION01
 * LIVE_PRODUCER_COMPOSER_CHAIN RED (Phase 2 RED, post-CORRECTION02).
 *
 * Existing coverage:
 *   c1-green.test.ts: crafts hostAuthorization with mandatorySeatbelt:true
 *     directly; does NOT exercise the envelope producer.
 *   c2-runtime-bridge Witness A: exercises applySeatbeltAuthorityEnvelope
 *     in isolation; does NOT exercise the canonical composer downstream.
 *   q-real-kernel-confinement Q0: producer + composer on a single-command
 *     R5 catastrophic stimulus (`rm -rf "$HOME"`); no override projection,
 *     no realpath evidence, no multi-command shape.
 *
 * The live bug (corr=9XP2YGTB90 / ASK / risk_hard_floor with auto-approve
 * ALL + Seatbelt envelope demonstrably active for OTHER requests in the
 * same runtime) lives in a code path none of the above pin.
 *
 * LIVE specimen (operator evidence, s1onique.clinemm@4.1.16-2fa94d162):
 *   rm /absolute/path/inside/workspace/file &&
 *   ls /absolute/path/inside/workspace/file 2>&1 | head -2
 *
 * RED contract:
 *   T-CHAIN-1/2/3: producer/composer chain on a simple R5 stimulus.
 *     PASSED on live artifact. The defect is NOT in the simple chain.
 *   T-EXACT-SHAPE: persisted safe-only + realpath evidence + override
 *     "all" + Seatbelt envelope + LIVE stimulus. This is the only test
 *     that reproduces the LIVE specimen end-to-end through the production
 *     composer.
 *
 * Stop rule:
 *   T-EXACT-SHAPE FAILS on live artifact => RED REPRODUCED. The defect
 *     is localizable to the multi-command / realpath / R5 composition path.
 *   T-EXACT-SHAPE PASSES on live artifact => HALT_RED_NOT_REPRODUCED
 *     legitimately authorized. The defect is upstream of this chain in
 *     the live process.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { CommandHostAuthorization } from "@cline/core"
import { buildPathAuthorityEvidence, commandHostAuthorization, DEFAULT_COMMAND_HOST_ALLOW_RULES } from "@cline/core"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { applySeatbeltAuthorityEnvelope, evaluateCommandToolApprovalWithPlan } from "../sdk-tool-policies"
import { resolveSessionHostAuthorization } from "../session-auto-approval"

const R5_INPUT = { command: 'rm -rf "$HOME"', requires_approval: false }

describe("LIVE_PRODUCER_COMPOSER_CHAIN RED - simple chain", () => {
	it("T-CHAIN-1: producer-stamped auth yields ALLOW / host_mode_all_seatbelt_required / mandatorySeatbeltExecution=true", () => {
		// Live producer shape. Mirrors SdkController.ts:899-929 closure.
		const baseAuth: CommandHostAuthorization = commandHostAuthorization({ mode: "all" })
		const stampedAuth = applySeatbeltAuthorityEnvelope(baseAuth, "seatbelt-experimental")
		expect(stampedAuth.mode).toBe("all")
		expect(stampedAuth.mandatorySeatbelt).toBe(true)

		const result = evaluateCommandToolApprovalWithPlan(R5_INPUT, stampedAuth)
		expect(result.approved).toBe(true)
		expect(result.decision.kind).toBe("allow")
		expect(result.decision.source).toBe("host_mode_all_seatbelt_required")
		expect(result.mandatorySeatbeltExecution).toBe(true)
	})

	it("T-CHAIN-2 (ablation): non-stamped mode=all yields ASK / risk_hard_floor / mandatorySeatbeltExecution=false", () => {
		const baseAuth: CommandHostAuthorization = commandHostAuthorization({ mode: "all" })
		const result = evaluateCommandToolApprovalWithPlan(R5_INPUT, baseAuth)
		expect(result.approved).toBe(false)
		expect(result.decision.kind).toBe("ask")
		expect(result.decision.source).toBe("risk_hard_floor")
		expect(result.mandatorySeatbeltExecution).toBe(false)
	})

	it("T-CHAIN-3: override-projected base + envelope stamp yields ALLOW / host_mode_all_seatbelt_required", () => {
		const persistedAuth: CommandHostAuthorization = commandHostAuthorization({
			mode: "safe-only",
			explicitAllowRules: [],
		})
		const projectedAuth = resolveSessionHostAuthorization(persistedAuth, "all")
		expect(projectedAuth).toBeDefined()
		expect(projectedAuth?.mode).toBe("all")
		const stampedAuth = applySeatbeltAuthorityEnvelope(projectedAuth!, "seatbelt-experimental")
		expect(stampedAuth.mandatorySeatbelt).toBe(true)

		const result = evaluateCommandToolApprovalWithPlan(R5_INPUT, stampedAuth)
		expect(result.approved).toBe(true)
		expect(result.decision.kind).toBe("allow")
		expect(result.decision.source).toBe("host_mode_all_seatbelt_required")
		expect(result.mandatorySeatbeltExecution).toBe(true)
	})
})

// T-EXACT-SHAPE: reproduce the LIVE specimen from corr=9XP2YGTB90.
// Live failing command (operator evidence, 2fa94d162):
//   rm <workspace-absolute> && ls <workspace-absolute> 2>&1 | head -2
// Composition mirrors SdkController.ts:861..929 verbatim:
//   persisted safe-only + realpath evidence -> override "all" ->
//   envelope seatbelt-experimental -> evaluateCommandToolApprovalWithPlan.
// Expected by ClineMM contract:
//   approved = true
//   decision.source = "host_mode_all_seatbelt_required"
//   mandatorySeatbeltExecution = true
// FAILS on live artifact => RED REPRODUCED.
// PASSES on live artifact => HALT_RED_NOT_REPRODUCED legitimately authorized.
describe("LIVE_PRODUCER_COMPOSER_CHAIN RED - exact-shape", () => {
	let workspaceRoot: string
	let victim: string
	let tmpDir: string

	beforeAll(() => {
		workspaceRoot = realpathSync(process.cwd())
		// Ensure .factory/tmp exists inside the workspace root so we can
		// place the victim INSIDE the canonical root. Without this, an
		// apps/vscode/.factory-less checkout would ENOENT at mkdtempSync.
		mkdirSync(join(workspaceRoot, ".factory", "tmp"), { recursive: true })
		tmpDir = mkdtempSync(join(workspaceRoot, ".factory/tmp/red-exact-shape-"))
		victim = join(tmpDir, "victim.txt")
		writeFileSync(victim, "fixture for the live-specimen RED\n", "utf8")
	})

	afterAll(() => {
		try {
			rmSync(tmpDir, { recursive: true, force: true })
		} catch {
			// ignore: workspace may already be cleaned
		}
	})

	it("T-EXACT-SHAPE: persisted safe-only + override=all + seatbelt envelope => ALLOW / host_mode_all_seatbelt_required", () => {
		const liveInput = {
			command: `rm ${victim} && ls ${victim} 2>&1 | head -2`,
			requires_approval: false,
		}

		const evidence = buildPathAuthorityEvidence({
			workspaceRoots: [workspaceRoot],
			cwd: workspaceRoot,
			command: liveInput,
		})
		expect(evidence.ok).toBe(true)
		if (!evidence.ok) {
			throw new Error(`evidence builder failed: ${evidence.reason}`)
		}

		const persistedAuth: CommandHostAuthorization = commandHostAuthorization({
			mode: "safe-only",
			explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
			workspaceRoots: [workspaceRoot],
			cwd: workspaceRoot,
			pathAuthorityEvidence: evidence.evidence,
		})

		const projectedAuth = resolveSessionHostAuthorization(persistedAuth, "all")
		expect(projectedAuth).toBeDefined()
		expect(projectedAuth?.mode).toBe("all")

		const stampedAuth = applySeatbeltAuthorityEnvelope(projectedAuth!, "seatbelt-experimental")
		expect(stampedAuth.mode).toBe("all")
		expect(stampedAuth.mandatorySeatbelt).toBe(true)

		const result = evaluateCommandToolApprovalWithPlan(liveInput, stampedAuth)

		expect(result.approved).toBe(true)
		expect(result.decision.kind).toBe("allow")
		expect(result.decision.source).toBe("host_mode_all_seatbelt_required")
		expect(result.mandatorySeatbeltExecution).toBe(true)
	})
})
