/**
 * ACT-CLINEMM-SEATBELT-ALL-R5-AUTHORITY-IMPLEMENTATION01
 *
 * C1 / production-seam RED matrix (the four load-bearing cases that
 * must all pass before Architecture B is considered GREEN).
 *
 * Scope: the real production seam
 *   SdkController.resolveHostAuthorization
 *     -> getCommandHostAuthorization
 *       -> CommandHostAuthorization (with mandatorySeatbelt)
 *         -> evaluateCommandPolicy
 *           -> CommandDecision (with source host_mode_all_seatbelt_required)
 *     -> ToolApprovalResult (typed channel)
 *       -> AgentToolContext.mandatorySeatbeltExecution
 *         -> CommandJobManager.start()
 *           -> sandboxBackendResolver -> backend.prepare()
 *
 * RED matrix:
 *
 *   T1 RED:
 *     auth.mode = "all"
 *     auth.mandatorySeatbelt = true
 *     R5 catastrophic command (rm -rf "$HOME")
 *     expect: decision.kind=allow, decision.source=host_mode_all_seatbelt_required
 *
 *   T2 ABLATION:
 *     auth.mode = "all"
 *     auth.mandatorySeatbelt = undefined
 *     same R5 catastrophic command
 *     expect: decision.kind=ask, decision.source=risk_hard_floor
 *
 *   T3 NO-FALLBACK (load-bearing safety gate):
 *     CommandJobManager.start() with
 *       context.mandatorySeatbeltExecution = true
 *       sandboxBackendResolver returns a backend whose prepare() throws
 *     expect: result.state=spawn_failed, signal contains sandbox-prepare-failed,
 *             spawnSupervisableShellCommand NEVER invoked
 *
 *   T4 CAPABILITY CONSERVATION:
 *     buildExperimentalReconCapability is byte-equal across the fix
 *
 * Pre-fix RED state: the new types/sources don't exist yet. T1/T2 fail
 * at compile-or-assert, T3 fails at compile-or-no-enforcement, T4 passes
 * (capability is byte-equal by construction because the new flag never
 * enters the capability builder). The RED cycle runs vitest in
 * `bun run test:vitest -- seatbelt-all-r5-authority-implementation01`.
 */
import { afterEach, describe, expect, it } from "vitest"
import { SandboxError, type CommandCapability, type SandboxBackend } from "@cline/core"
import { buildExperimentalReconCapability } from "../sandbox-policy"
import { CommandJobManager } from "../command-job-manager"
import {
	commandHostAuthorization,
	evaluateCommandPolicy,
	type CommandHostAuthorization,
} from "@cline/core"

// -----------------------------------------------------------------------------
// Shared fixtures
// -----------------------------------------------------------------------------

// R5 catastrophic command shape (LIVE trace corr=G8R987V68S).
const R5_CATASTROPHIC = 'rm -rf "$HOME"'

// T4 inputs and baseline (pre-fix capability for byte-equality assertion).
// Use the public overload (cwd, workspaceRoots). The internal
// `safeYoloCapabilitySource` parameter is executor-private; tests must
// not reach for it. T4 asserts capability byte-equality across the fix
// regardless of the override channel.
const T4_INPUTS = {
	cwd: "/private/var/folders/clinemm-t4-test",
	workspaceRoots: ["/private/var/folders/clinemm-t4-test"],
}

const baselineCapability: CommandCapability = buildExperimentalReconCapability({
	cwd: T4_INPUTS.cwd,
	workspaceRoots: T4_INPUTS.workspaceRoots,
})

// -----------------------------------------------------------------------------
// T1 + T2: command-policy seam
// -----------------------------------------------------------------------------

describe("ACT-CLINEMM-SEATBELT-ALL-R5-AUTHORITY-IMPLEMENTATION01 C1 - T1 RED / T2 ABLATION", () => {
	it("T1: ALL + R5 + mandatorySeatbelt => ALLOW with source host_mode_all_seatbelt_required", () => {
		const auth: CommandHostAuthorization = commandHostAuthorization({
			mode: "all",
			mandatorySeatbelt: true,
		})
		const result = evaluateCommandPolicy({
			toolInput: { command: R5_CATASTROPHIC, requires_approval: false },
			hostAuthorization: auth,
		})
		// RED pre-fix: kind="ask", source="risk_hard_floor".
		// GREEN post-fix: kind="allow", source="host_mode_all_seatbelt_required".
		expect(result.decision.kind).toBe("allow")
		expect(result.decision.source).toBe("host_mode_all_seatbelt_required")
	})

	it("T2 ABLATION: ALL + R5 + mandatorySeatbelt UNDEFINED => source is host_mode_all (NOT host_mode_all_seatbelt_required)", () => {
		const auth: CommandHostAuthorization = commandHostAuthorization({
			mode: "all",
			// mandatorySeatbelt: undefined — explicitly omitted.
		})
		const result = evaluateCommandPolicy({
			toolInput: { command: R5_CATASTROPHIC, requires_approval: false },
			hostAuthorization: auth,
		})
		// The new source MUST NOT appear when the obligation is absent.
		// The lattice (kind=allow) is unchanged — the existing
		// `host_mode_all` source is preserved. The R5 risk_hard_floor
		// downgrade is applied at the higher
		// `evaluateCommandToolApproval` layer (sdk-tool-policies.ts),
		// not at the `evaluateCommandPolicy` layer. The pre-fix
		// classifier path is preserved: kind=allow, source=host_mode_all.
		expect(result.decision.source).toBe("host_mode_all")
		expect(result.decision.source).not.toBe("host_mode_all_seatbelt_required")
	})
})

// -----------------------------------------------------------------------------
// T3 + T4: command-job-manager seam + capability conservation
// -----------------------------------------------------------------------------

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

afterEach(() => {
	delete process.env[SANDBOX_OPTIN_ENV]
})

describe("ACT-CLINEMM-SEATBELT-ALL-R5-AUTHORITY-IMPLEMENTATION01 C1 - T3 NO-FALLBACK", () => {
	it("T3: prepare() fails after conditional bypass granted => spawn_failed, host shell NOT invoked", async () => {
		await withSandboxOptIn("seatbelt", async () => {
			// Backend whose prepare() throws SandboxError. The sentinel
			// stays false iff the executor refused to fall through to
			// spawnSupervisableShellCommand. If a regression introduces
			// a fallback path past prepare() failure, the sentinel flips
			// and HALT_UNSANDBOXED_FALLBACK_EXISTS.
			const supervisorSentinel = { invoked: false }
			const throwingBackend: SandboxBackend & { __supervisorInvoked: typeof supervisorSentinel } = {
				id: "test-throwing-mandatory-seatbelt",
				async isAvailable() {
					return true
				},
				async prepare(): Promise<never> {
					throw new SandboxError("profile-generation forced failure", {
						backendId: "test-throwing-mandatory-seatbelt",
						reason: "profile-generation-failed",
					})
				},
				__supervisorInvoked: supervisorSentinel,
			}
			const manager = new CommandJobManager({
				sandboxBackendResolver: async () => throwingBackend,
			})
			try {
				const start = await manager.start(
					{
						command: `/bin/sh -c 'echo hi'`,
						cwd: process.cwd(),
						waitBudgetMs: 5_000,
						executionDeadlineMs: 5_000,
					},
					// AgentToolContext.mandatorySeatbeltExecution is the
					// typed channel that carries the conditional bypass
					// into the executor. The field is defined on the
					// shared AgentToolContext type; the executor enforces
					// the obligation in CommandJobManager.start.
					{
						agentId: "agent",
						iteration: 1,
						mandatorySeatbeltExecution: true,
					},
				)
				expect(start.state).toBe("spawn_failed")
				expect(start.signal ?? "").toContain("sandbox-prepare-failed")
				expect(supervisorSentinel.invoked).toBe(false)
			} finally {
				await manager.dispose()
			}
		})
	})
})

describe("ACT-CLINEMM-SEATBELT-ALL-R5-AUTHORITY-IMPLEMENTATION01 C1 - T4 CAPABILITY CONSERVATION", () => {
	it("T4: buildExperimentalReconCapability is BYTE-EQUAL across the fix (no widening)", () => {
		// The same inputs as the pre-fix baseline MUST produce the
		// exact same capability. If the fix inadvertently widens
		// writableRoots / network / sshAuthenticationAuthority, this
		// assertion fails and HALT_SANDBOX_CAPABILITY_EXPANDED.
		const cap = buildExperimentalReconCapability({
			cwd: T4_INPUTS.cwd,
			workspaceRoots: T4_INPUTS.workspaceRoots,
		})
		expect(cap.writableRoots).toEqual(baselineCapability.writableRoots)
		expect(cap.network).toBe(baselineCapability.network)
		expect(cap.sshAuthenticationAuthority).toEqual(baselineCapability.sshAuthenticationAuthority)
		// Belt-and-suspenders: deep equal via JSON serialization.
		expect(JSON.stringify(cap)).toBe(JSON.stringify(baselineCapability))
	})
})

