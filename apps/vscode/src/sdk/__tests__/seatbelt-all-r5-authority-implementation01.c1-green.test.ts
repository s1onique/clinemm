/**
 * ACT-CLINEMM-SEATBELT-ALL-R5-AUTHORITY-IMPLEMENTATION01
 *
 * C1 / production-seam RED matrix. Exercises the REAL production
 * seam -- the canonical policy composer (which includes the R5
 * catastrophic hard floor) -> ToolApprovalResult -> AgentToolContext
 * -> CommandJobManager.start() -- not isolated layers. Each case
 * consumes the previous case's output (where appropriate) so the
 * chain is end-to-end.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CommandJobManager } from "../command-job-manager"
import { evaluateCommandToolApproval, evaluateCommandToolApprovalWithPlan } from "../sdk-tool-policies"
import { commandHostAuthorization } from "@cline/core"
import { buildExperimentalReconCapability } from "../sandbox-policy"

const R5_CATASTROPHIC = 'rm -rf "$HOME"'
const R5_INPUT = { command: R5_CATASTROPHIC, requires_approval: false }

// Sentinel for the host-shell path. The supervisor mock throws on
// any call; if CommandJobManager.start() ever reaches the supervisor
// when mandatorySeatbeltExecution is true, the sentinel flips and
// the mock throws, surfacing HALT_UNSANDBOXED_FALLBACK_EXISTS.
let supervisorCallCount = 0

vi.mock("@cline/core", async () => {
	const actual = await vi.importActual<typeof import("@cline/core")>("@cline/core")
	return {
		...actual,
		spawnSupervisableShellCommand: () => {
			supervisorCallCount++
			throw new Error(
				"HOST_SHELL_FALLBACK_INVOKED: CommandJobManager.start() reached spawnSupervisableShellCommand; the executor must refuse this path when mandatorySeatbeltExecution is true."
			)
		},
	}
})

const SANDBOX_OPTIN_ENV = "CLINEMM_EXPERIMENTAL_SANDBOX"

function withSandboxOptIn<T>(value: string | undefined, fn: () => Promise<T> | T): Promise<T> | T {
	const prev = process.env[SANDBOX_OPTIN_ENV]
	if (value === undefined) {
		delete process.env[SANDBOX_OPTIN_ENV]
	} else {
		process.env[SANDBOX_OPTIN_ENV] = value
	}
	try {
		return fn()
	} finally {
		if (prev === undefined) {
			delete process.env[SANDBOX_OPTIN_ENV]
		} else {
			process.env[SANDBOX_OPTIN_ENV] = prev
		}
	}
}

beforeEach(() => {
	supervisorCallCount = 0
})

afterEach(() => {
	delete process.env[SANDBOX_OPTIN_ENV]
})
describe("ACT-CLINEMM-SEATBELT-ALL-R5-AUTHORITY-IMPLEMENTATION01 C1 - T1/T2/T2b through the R5 composer", () => {
	it("T1: ALL + R5 + mandatorySeatbelt => ALLOW with source host_mode_all_seatbelt_required AND mandatorySeatbeltExecution=true", () => {
		const auth = commandHostAuthorization({ mode: "all", mandatorySeatbelt: true })
		const result = evaluateCommandToolApproval(R5_INPUT, auth)
		expect(result.approved).toBe(true)
		expect(result.decision.kind).toBe("allow")
		expect(result.decision.source).toBe("host_mode_all_seatbelt_required")
		expect(result.mandatorySeatbeltExecution).toBe(true)
	})

	it("T2 ABLATION: ALL + R5 + mandatorySeatbelt UNDEFINED => ask/risk_hard_floor AND mandatorySeatbeltExecution=false", () => {
		const auth = commandHostAuthorization({ mode: "all" })
		const result = evaluateCommandToolApproval(R5_INPUT, auth)
		expect(result.approved).toBe(false)
		expect(result.decision.kind).toBe("ask")
		expect(result.decision.source).toBe("risk_hard_floor")
		expect(result.mandatorySeatbeltExecution).toBe(false)
	})

	it("T2b DENY: ALL + mandatorySeatbelt + explicit deny rule => deny/host_hard_deny AND mandatorySeatbeltExecution=false", () => {
		const auth = commandHostAuthorization({
			mode: "all",
			mandatorySeatbelt: true,
			explicitDenyRules: [{ source: "unit_test_deny", pattern: /^\s*rm\s+-rf/u }],
		})
		const result = evaluateCommandToolApproval(R5_INPUT, auth)
		expect(result.approved).toBe(false)
		expect(result.decision.kind).toBe("deny")
		expect(result.decision.source).toBe("host_hard_deny")
		expect(result.mandatorySeatbeltExecution).toBe(false)
	})

	it("T1 (WithPlan variant): the per-command plan path also returns mandatorySeatbeltExecution=true", () => {
		const auth = commandHostAuthorization({ mode: "all", mandatorySeatbelt: true })
		const result = evaluateCommandToolApprovalWithPlan(R5_INPUT, auth)
		expect(result.approved).toBe(true)
		expect(result.decision.kind).toBe("allow")
		expect(result.decision.source).toBe("host_mode_all_seatbelt_required")
		expect(result.mandatorySeatbeltExecution).toBe(true)
		expect(result.executionPlan).toBeDefined()
	})
})

describe("ACT-CLINEMM-SEATBELT-ALL-R5-AUTHORITY-IMPLEMENTATION01 C1 - T3 NO-FALLBACK end-to-end", () => {
	it("T3: real approve -> real context -> prepare() throws -> spawn_failed, supervisor NEVER called", async () => {
		await withSandboxOptIn("seatbelt", async () => {
			const auth = commandHostAuthorization({ mode: "all", mandatorySeatbelt: true })
			const approval = evaluateCommandToolApproval(R5_INPUT, auth)
			expect(approval.approved).toBe(true)
			expect(approval.mandatorySeatbeltExecution).toBe(true)

			const throwingBackend = {
				id: "test-throwing-mandatory-seatbelt",
				async isAvailable() { return true },
				async prepare(): Promise<never> { throw new Error("profile-generation forced failure") },
			}

			const manager = new CommandJobManager({
				sandboxBackendResolver: async () => throwingBackend,
			})
			try {
				const start = await manager.start(
					{ command: `/bin/sh -c 'echo hi'`, cwd: process.cwd(), waitBudgetMs: 5_000, executionDeadlineMs: 5_000 },
					{ agentId: "agent", iteration: 1, mandatorySeatbeltExecution: approval.mandatorySeatbeltExecution },
				)
				expect(start.state).toBe("spawn_failed")
				expect(start.signal ?? "").toContain("sandbox-prepare-failed")
				expect(supervisorCallCount).toBe(0)
			} finally {
				await manager.dispose()
			}
		})
	})
})

describe("ACT-CLINEMM-SEATBELT-ALL-R5-AUTHORITY-IMPLEMENTATION01 C1 - T4 CAPABILITY CONSERVATION", () => {
	it("T4: buildExperimentalReconCapability is byte-equal across the fix (no widening)", () => {
		const cap = buildExperimentalReconCapability({
			cwd: "/private/var/folders/clinemm-t4-test",
			workspaceRoots: ["/private/var/folders/clinemm-t4-test"],
			networkOverride: "deny",
			sshAgentOverride: "deny",
		})
		// v1 baseline (frozen pre-fix snapshot of the canonical
		// capability for these inputs). If you change the capability
		// builder, you MUST update this baseline and explicitly note
		// why in the change. The contract is the byte-equal JSON.
		const v1Baseline = JSON.stringify({
			readonlyRoots: [],
			writableRoots: ["/private/var/folders/clinemm-t4-test"],
			denyReadSubpaths: [],
			network: "deny",
			environment: {
				mode: "sanitized",
				allow: [
					"CLICOLOR",
					"FORCE_COLOR",
					"GIT_PAGER",
					"GIT_TERMINAL_PROGRESS",
					"LANG",
					"LANGUAGE",
					"LC_ALL",
					"LSCOLORS",
					"NO_COLOR",
					"PAGER",
					"PATH",
					"TERM",
				],
			},
			cwd: "/private/var/folders/clinemm-t4-test",
		})
		expect(JSON.stringify(cap)).toBe(v1Baseline)
	})
})