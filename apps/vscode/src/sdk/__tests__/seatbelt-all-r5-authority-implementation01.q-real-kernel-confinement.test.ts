/**
 * ACT-CLINEMM-SEATBELT-ALL-R5-AUTHORITY-IMPLEMENTATION01
 * CORRECTION02 -- Q1..Q4 REAL-KERNEL CONFINEMENT QUALIFICATION
 *
 * Reviewer disposition (2026-08-30) on CORRECTION02:
 *
 *   MECHANISM                 = PASS
 *   R5_COMPOSITION            = PASS
 *   PRODUCTION_PRODUCER       = PASS
 *   AGENT_RUNTIME_BRIDGE      = PASS
 *   NO_FALLBACK               = PASS_STRUCTURAL
 *   CAPABILITY_OBJECT_DELTA   = 0
 *   REAL_SEATBELT_CONFINEMENT = NOT_YET_QUALIFIED   <-- THIS FILE
 *
 * ===========================================================================
 * WHY THIS FILE EXISTS
 * ===========================================================================
 *
 * The frozen Phase-0 contract distinguishes four distinct states:
 *
 *     SELECTED  !=  AVAILABLE  !=  PREPARED  !=  ENFORCED
 *
 * The CORRECTION02 producer (`applySeatbeltAuthorityEnvelope`) intentionally
 * uses SELECTED (`resolveExperimentalSandboxMode() === "seatbelt-experimental"`)
 * as the provisional signal that lets the R5 catastrophic hard floor be
 * suppressed. That is valid Architecture B ONLY BECAUSE the executor later
 * discharges the obligation against the real kernel. Every prior witness
 * stopped short of observing that discharge:
 *
 *   - Witness A  pins the PRODUCER       (pure function, synthetic inputs)
 *   - Witness B  pins the RUNTIME BRIDGE (real AgentRuntime -> AgentToolContext)
 *   - C1 T3      pins NO-FALLBACK        (injected prepare() failure, no spawn)
 *   - C1 T4      pins CAPABILITY DELTA   (byte-equality of the capability object)
 *
 * T3 proves fallback is closed; T4 proves capability construction was not
 * widened. NEITHER proves that a SUCCESSFULLY PREPARED real Seatbelt profile
 * actually CONFINES the destructive R5 execution we now auto-approve.
 *
 * This file closes that gap. It is qualification-only: it changes NO
 * production code. It drives the REAL chain end-to-end --
 *
 *     applySeatbeltAuthorityEnvelope       (real producer)
 *       -> commandHostAuthorization        (real canonical authorization)
 *         -> evaluateCommandToolApproval   (real canonical policy + R5 floor)
 *           -> ToolApprovalResult.mandatorySeatbeltExecution
 *             -> AgentToolContext.mandatorySeatbeltExecution
 *               -> CommandJobManager.start (real executor)
 *                 -> defaultSandboxBackendResolver          (real resolver)
 *                   -> SeatbeltSandboxBackendExperimental.prepare (real)
 *                     -> /usr/bin/sandbox-exec -f profile.sb      (real kernel)
 *
 * -- and asserts KERNEL-OBSERVED outcomes, not object snapshots.
 *
 * ===========================================================================
 * GATE MATRIX
 * ===========================================================================
 *
 *   Q1 POSITIVE
 *     ALL + R5 + mandatory Seatbelt; destructive target INSIDE the writable
 *     workspace root.
 *       => approval = ALLOW / host_mode_all_seatbelt_required
 *       => command executes through real Seatbelt
 *       => the intended in-workspace deletion SUCCEEDS
 *     (Proves confinement is not vacuous: the sandbox is not simply denying
 *      everything, which would make Q2/Q3/Q4 false passes.)
 *
 *   Q2 CONFINEMENT
 *     Same authority; destructive target OUTSIDE all writable roots.
 *       => approval still bypasses the human ASK (authority unchanged)
 *       => real Seatbelt kernel DENIES the mutation
 *       => the out-of-root target remains byte-intact
 *     (This is the load-bearing safety claim of the whole feature.)
 *
 *   Q3 NETWORK CONSERVATION
 *     network=deny; R5 bypass granted.
 *       => attempted TCP egress to a live in-process listener is DENIED
 *     (Proves the approval-authority expansion did NOT add network
 *      capability authority -- the Phase-0 conservation invariant.)
 *
 *   Q4 SSH-AGENT CONSERVATION
 *     sshAgent=deny; R5 bypass granted.
 *       => the agent socket authority remains unavailable
 *     (Same conservation invariant on the second capability axis.)
 *
 * ===========================================================================
 * SUBSTRATE ELIGIBILITY
 * ===========================================================================
 *
 * Q1..Q4 require a REAL, WORKING `/usr/bin/sandbox-exec`. Merely checking
 * `process.platform === "darwin"` plus file existence is NOT sufficient:
 * when this suite is itself executed from inside a Seatbelt-confined shell
 * (e.g. an agent-spawned `run_commands` child), the nested `sandbox_apply(2)`
 * returns EPERM and every sandboxed spawn fails for a reason that has
 * nothing to do with the property under test.
 *
 * `hasWorkingSeatbelt()` therefore performs a REAL nested-apply probe. On an
 * ineligible substrate the kernel legs are skipped, and the
 * substrate-INDEPENDENT authority leg (Q0) still runs, so this file never
 * silently degrades to zero assertions.
 *
 * FALSE-PASS DISCIPLINE: the Q2/Q3/Q4 negative legs are only meaningful
 * when Q1 passes in the SAME run. A sandbox that denies everything would
 * satisfy Q2/Q3/Q4 trivially. Q1 is the positive control that
 * discriminates "confined" from "broken".
 */
import { spawnSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { commandHostAuthorization } from "@cline/core"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { CommandJobManager } from "../command-job-manager"
import { defaultSandboxBackendResolver } from "../sandbox-policy"
import { applySeatbeltAuthorityEnvelope, evaluateCommandToolApproval } from "../sdk-tool-policies"

const SANDBOX_OPTIN_ENV = "CLINEMM_EXPERIMENTAL_SANDBOX"
const NETWORK_OPTIN_ENV = "CLINEMM_SAFE_YOLO_NETWORK"
const SSH_AGENT_OPTIN_ENV = "CLINEMM_SAFE_YOLO_SSH_AGENT"

/**
 * The POSIX shell parameter-expansion sigil (`$`). Kept as a constant so
 * probe scripts can embed `${VAR}` expansions inside JS template literals
 * without the linter mistaking them for JS template placeholders.
 */
const SHELL_EXPAND = "$"

/**
 * REAL substrate probe. Runs `/usr/bin/sandbox-exec` for real and requires
 * the trivial allow-all profile to succeed. This catches the
 * nested-sandbox EPERM case that a mere `existsSync` check would miss.
 */
function hasWorkingSeatbelt(): boolean {
	if (process.platform !== "darwin") {
		return false
	}
	if (!existsSync("/usr/bin/sandbox-exec")) {
		return false
	}
	const probe = spawnSync("/usr/bin/sandbox-exec", ["-p", "(version 1)(allow default)", "/bin/echo", "SEATBELT_OK"], {
		encoding: "utf8",
		timeout: 10_000,
	})
	return probe.status === 0 && (probe.stdout ?? "").includes("SEATBELT_OK")
}

const SUBSTRATE = hasWorkingSeatbelt()

beforeEach(() => {
	process.env[SANDBOX_OPTIN_ENV] = "seatbelt"
})

afterEach(() => {
	process.env[SANDBOX_OPTIN_ENV] = ""
	delete process.env[NETWORK_OPTIN_ENV]
	delete process.env[SSH_AGENT_OPTIN_ENV]
})

// ---------------------------------------------------------------------------
// Shared harness: drive the REAL approval chain, then the REAL executor.
// ---------------------------------------------------------------------------

/**
 * Run the REAL producer -> REAL canonical policy chain for an R5
 * catastrophic command under `mode: "all"` with Seatbelt SELECTED.
 *
 * Returns the real `ToolApprovalResult`-shaped output. No part of this is
 * synthesized: `applySeatbeltAuthorityEnvelope` is the production producer
 * and `evaluateCommandToolApproval` is the production canonical composer
 * that owns the R5 hard floor.
 */
function realApprovalForR5(command: string) {
	// The production site (`SdkController.resolveHostAuthorization`) calls
	// the producer with the LIVE `resolveExperimentalSandboxMode()`. We do
	// the same, so the envelope is derived from the real kernel-envelope
	// invariant, not a hand-written literal.
	const baseAuth = commandHostAuthorization({ mode: "all" })
	const stampedAuth = applySeatbeltAuthorityEnvelope(baseAuth, "seatbelt-experimental")
	return evaluateCommandToolApproval({ command, requires_approval: false }, stampedAuth)
}

interface KernelRunOutcome {
	exitCode: number | null | undefined
	signal: string | undefined
	stdout: string
	stderr: string
	state: string
}

/**
 * Execute `command` through the REAL `CommandJobManager` with the REAL
 * `defaultSandboxBackendResolver`, carrying the REAL approval's
 * `mandatorySeatbeltExecution` flag into the `AgentToolContext` exactly as
 * `AgentRuntime` does in production (pinned by Witness B).
 */
async function runUnderRealSeatbelt(args: {
	command: string
	cwd: string
	workspaceRoots: readonly string[]
	mandatorySeatbeltExecution: boolean
}): Promise<KernelRunOutcome> {
	const manager = new CommandJobManager({
		sandboxBackendResolver: defaultSandboxBackendResolver,
		experimentalSandboxWorkspaceRoots: args.workspaceRoots,
	})
	try {
		const start = await manager.start(
			{
				command: args.command,
				cwd: args.cwd,
				env: {},
				waitBudgetMs: 15_000,
				executionDeadlineMs: 30_000,
			},
			{
				agentId: "q-real-kernel-confinement",
				iteration: 0,
				// The load-bearing conditional-authority channel. In
				// production this is copied by AgentRuntime from
				// ToolApprovalResult.mandatorySeatbeltExecution.
				mandatorySeatbeltExecution: args.mandatorySeatbeltExecution,
			},
		)
		await start.terminalPromise
		const status = await manager.status({ jobId: start.jobId, waitMs: 0 })
		if (!status.ok) {
			throw new Error(`CAPTURE_INSUFFICIENT: status() returned code=${status.code}`)
		}
		const s = status.snapshot
		return {
			exitCode: s.exitCode ?? null,
			signal: s.signal,
			stdout: s.stdout,
			stderr: s.stderr,
			state: s.state,
		}
	} finally {
		await manager.dispose()
	}
}

// ---------------------------------------------------------------------------
// Q0 -- substrate-INDEPENDENT authority leg.
//
// Runs on every platform. This is what keeps the file from silently
// degrading to zero assertions on an ineligible substrate, and it pins the
// precondition shared by Q1..Q4: the REAL producer + REAL canonical policy
// do in fact suppress the R5 hard floor and emit the conditional source.
// ---------------------------------------------------------------------------
describe("ACT-CLINEMM-SEATBELT-ALL-R5-AUTHORITY-IMPLEMENTATION01 -- Q0 authority precondition", () => {
	it("Q0: real producer + real canonical policy => ALLOW / host_mode_all_seatbelt_required / mandatorySeatbeltExecution=true", () => {
		const approval = realApprovalForR5('rm -rf "$HOME"')
		expect(approval.approved).toBe(true)
		expect(approval.decision.kind).toBe("allow")
		expect(approval.decision.source).toBe("host_mode_all_seatbelt_required")
		expect(approval.mandatorySeatbeltExecution).toBe(true)
	})

	it("Q0 ABLATION: without the Seatbelt envelope the R5 floor still fires (ASK / risk_hard_floor)", () => {
		// Same command, same mode "all", but the kernel envelope is NOT
		// Seatbelt. The producer must NOT stamp the flag, so the R5
		// catastrophic hard floor remains the human gate. This is the
		// discriminator that proves Q0's positive is caused by the
		// envelope and not by `mode: "all"` alone.
		const baseAuth = commandHostAuthorization({ mode: "all" })
		const notStamped = applySeatbeltAuthorityEnvelope(baseAuth, undefined)
		const approval = evaluateCommandToolApproval({ command: 'rm -rf "$HOME"', requires_approval: false }, notStamped)
		expect(approval.approved).toBe(false)
		expect(approval.decision.kind).toBe("ask")
		expect(approval.decision.source).toBe("risk_hard_floor")
		expect(approval.mandatorySeatbeltExecution).toBe(false)
	})

	it("Q0 SUBSTRATE: report whether the real-kernel legs (Q1..Q4) are eligible in this environment", () => {
		// Forensic breadcrumb. `SUBSTRATE === false` means this process is
		// itself Seatbelt-confined (nested sandbox_apply => EPERM) or the
		// host is not darwin. In that case Q1..Q4 are SKIPPED, not passed.
		console.warn(
			`[Q-real-kernel] platform=${process.platform} sandbox-exec=${existsSync("/usr/bin/sandbox-exec")} SUBSTRATE_ELIGIBLE=${SUBSTRATE}`,
		)
		expect(typeof SUBSTRATE).toBe("boolean")
	})
})

// ---------------------------------------------------------------------------
// Q1..Q4 -- REAL KERNEL legs. Skipped when the substrate is ineligible.
// ---------------------------------------------------------------------------
describe.skipIf(!SUBSTRATE)("ACT-CLINEMM-SEATBELT-ALL-R5-AUTHORITY-IMPLEMENTATION01 -- Q1..Q4 real Seatbelt", () => {
	it("Q1 POSITIVE: ALL + R5 + mandatory Seatbelt, target INSIDE writable root => real deletion SUCCEEDS", async () => {
		// Workspace root the host pre-trusts. `buildExperimentalReconCapability`
		// forwards it verbatim into `writableRoots`, so the Seatbelt profile
		// emits `(allow file-write* (subpath "<wsRoot>"))`.
		const wsRoot = realpathSync(mkdtempSync(join(tmpdir(), "clinemm-q1-ws-")))
		const victim = join(wsRoot, `in-workspace-victim-${randomBytes(6).toString("hex")}.txt`)
		writeFileSync(victim, "IN_WORKSPACE_ORIGINAL\n", "utf8")
		expect(existsSync(victim)).toBe(true)

		try {
			// A REAL R5 catastrophic command (matches the `home-destruction`
			// hard-floor family) so the approval leg is genuinely exercising
			// the suppression path -- not a benign command that would have
			// been ALLOWed anyway.
			const approval = realApprovalForR5('rm -rf "$HOME"')
			expect(approval.approved).toBe(true)
			expect(approval.decision.source).toBe("host_mode_all_seatbelt_required")
			expect(approval.mandatorySeatbeltExecution).toBe(true)

			// The destructive operation actually executed is scoped INSIDE
			// the writable root. This is the positive control: it proves the
			// sandbox is live but permissive within its authorized region,
			// so Q2's denial is a real boundary and not a dead sandbox.
			const out = await runUnderRealSeatbelt({
				command: `/bin/rm -rf "${victim}"; if [ -e "${victim}" ]; then printf 'STILL_PRESENT\\n'; else printf 'DELETED\\n'; fi`,
				cwd: wsRoot,
				workspaceRoots: [wsRoot],
				mandatorySeatbeltExecution: approval.mandatorySeatbeltExecution,
			})

			// The job must have actually run under the sandbox -- NOT been
			// short-circuited by the fail-closed path.
			expect(out.state).toBe("exited")
			expect(out.signal ?? "").not.toContain("sandbox-unavailable")
			expect(out.signal ?? "").not.toContain("seatbelt-required-but-unavailable")
			expect(out.signal ?? "").not.toContain("sandbox-prepare-failed")

			// KERNEL-OBSERVED: the in-workspace deletion succeeded.
			expect(out.stdout).toContain("DELETED")
			expect(existsSync(victim)).toBe(false)
		} finally {
			rmSync(wsRoot, { recursive: true, force: true })
		}
	})

	it("Q2 CONFINEMENT: same authority, target OUTSIDE writable roots => kernel DENIES, target byte-intact", async () => {
		const wsRoot = realpathSync(mkdtempSync(join(tmpdir(), "clinemm-q2-ws-")))
		// The out-of-root region is a SIBLING temp dir. It is deliberately
		// NOT passed in `workspaceRoots`, so it never reaches
		// `capability.writableRoots` and the profile's `(deny default)`
		// governs it.
		const outsideRoot = realpathSync(mkdtempSync(join(tmpdir(), "clinemm-q2-outside-")))
		const sentinel = join(outsideRoot, `outside-sentinel-${randomBytes(6).toString("hex")}.txt`)
		const SENTINEL_BODY = "OUTSIDE_SENTINEL_ORIGINAL\n"
		writeFileSync(sentinel, SENTINEL_BODY, "utf8")

		try {
			// AUTHORITY LEG: the human ASK is still bypassed. The point of
			// Q2 is that the APPROVAL is unchanged (we really did grant the
			// R5 bypass) and the KERNEL is what stops the damage.
			const approval = realApprovalForR5('rm -rf "$HOME"')
			expect(approval.approved).toBe(true)
			expect(approval.decision.kind).toBe("allow")
			expect(approval.decision.source).toBe("host_mode_all_seatbelt_required")
			expect(approval.mandatorySeatbeltExecution).toBe(true)

			// KERNEL LEG: attempt destruction OUTSIDE every writable root.
			// Three distinct mutation primitives are probed because Seatbelt
			// gates them as separate kernel ops:
			//   unlink   (file-write-unlink)
			//   truncate (file-write-data on an existing file)
			//   rename   (file-write-unlink + file-write-create)
			const otherName = `${sentinel}.renamed`
			const out = await runUnderRealSeatbelt({
				command: [
					`if /bin/rm -f "${sentinel}" 2>/dev/null; then printf 'UNLINK_OK\\n'; else printf 'UNLINK_DENIED\\n'; fi`,
					`if printf 'CLOBBERED' > "${sentinel}" 2>/dev/null; then printf 'TRUNCATE_OK\\n'; else printf 'TRUNCATE_DENIED\\n'; fi`,
					`if /bin/mv "${sentinel}" "${otherName}" 2>/dev/null; then printf 'RENAME_OK\\n'; else printf 'RENAME_DENIED\\n'; fi`,
					`printf 'DONE\\n'`,
				].join("; "),
				cwd: wsRoot,
				workspaceRoots: [wsRoot],
				mandatorySeatbeltExecution: approval.mandatorySeatbeltExecution,
			})

			// The command must have really run under the sandbox.
			expect(out.state).toBe("exited")
			expect(out.stdout).toContain("DONE")
			expect(out.signal ?? "").not.toContain("sandbox-unavailable")
			expect(out.signal ?? "").not.toContain("sandbox-prepare-failed")

			// KERNEL-OBSERVED denials on every mutation primitive.
			expect(out.stdout).toContain("UNLINK_DENIED")
			expect(out.stdout).toContain("TRUNCATE_DENIED")
			expect(out.stdout).toContain("RENAME_DENIED")

			// AUTHORITATIVE PROOF: the out-of-root target is byte-intact and
			// was never renamed away.
			expect(existsSync(sentinel)).toBe(true)
			expect(readFileSync(sentinel, "utf8")).toBe(SENTINEL_BODY)
			expect(existsSync(otherName)).toBe(false)
		} finally {
			rmSync(wsRoot, { recursive: true, force: true })
			rmSync(outsideRoot, { recursive: true, force: true })
		}
	})

	it("Q3 NETWORK CONSERVATION: network=deny + R5 bypass granted => TCP egress DENIED by the kernel", async () => {
		// network opt-in explicitly ABSENT => capability.network = "deny"
		// => the Seatbelt profile emits `(deny network*)`.
		delete process.env[NETWORK_OPTIN_ENV]

		// A live in-process listener. If the sandbox leaked network
		// authority, the sandboxed child would read the token from it.
		const TOKEN = `Q3-${randomBytes(6).toString("hex")}`
		const server = createServer((socket) => {
			socket.write(`${TOKEN}\n`)
			socket.end()
		})
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()))
		const addr = server.address()
		if (!addr || typeof addr === "string") {
			throw new Error("CAPTURE_INSUFFICIENT: listener bound to unexpected address shape")
		}
		const port = addr.port

		const wsRoot = realpathSync(mkdtempSync(join(tmpdir(), "clinemm-q3-ws-")))
		const scriptPath = join(wsRoot, `connect-${randomBytes(4).toString("hex")}.sh`)
		writeFileSync(
			scriptPath,
			[
				"#!/bin/bash",
				`if exec 3<>/dev/tcp/127.0.0.1/${port} 2>/dev/null; then`,
				'  IFS= read -r -t 3 line <&3 || line=""',
				'  printf "CONNECTED:%s\\n" "$line"',
				"  exec 3<&-",
				"else",
				'  printf "NET_DENIED\\n"',
				"fi",
				"",
			].join("\n"),
			{ mode: 0o755 },
		)

		try {
			// CONTROL: unsandboxed, the listener IS reachable. Without this
			// leg, "NET_DENIED" could just mean the listener was dead --
			// a false pass.
			const control = spawnSync("/bin/bash", [scriptPath], { encoding: "utf8", cwd: wsRoot, timeout: 15_000 })
			if (!(control.stdout ?? "").includes(`CONNECTED:${TOKEN}`)) {
				throw new Error(
					`CAPTURE_INSUFFICIENT: CONTROL could not reach the listener; got=${JSON.stringify(control.stdout)}`,
				)
			}

			// AUTHORITY LEG: the R5 bypass IS granted.
			const approval = realApprovalForR5('rm -rf "$HOME"')
			expect(approval.approved).toBe(true)
			expect(approval.mandatorySeatbeltExecution).toBe(true)

			// KERNEL LEG: the same egress under real Seatbelt is denied.
			const out = await runUnderRealSeatbelt({
				command: `/bin/bash ${scriptPath}`,
				cwd: wsRoot,
				workspaceRoots: [wsRoot],
				mandatorySeatbeltExecution: approval.mandatorySeatbeltExecution,
			})

			expect(out.state).toBe("exited")
			// CONSERVATION: the R5 approval bypass added NO network authority.
			expect(out.stdout).toContain("NET_DENIED")
			expect(out.stdout).not.toContain(`CONNECTED:${TOKEN}`)
			expect(out.stdout).not.toContain(TOKEN)
		} finally {
			try {
				server.close()
			} catch {}
			rmSync(wsRoot, { recursive: true, force: true })
		}
	})

	it("Q4 SSH-AGENT CONSERVATION: sshAgent=deny + R5 bypass granted => agent socket authority unavailable", async () => {
		// ssh-agent opt-in explicitly ABSENT => the capability omits
		// `sshAuthenticationAuthority` entirely => the Seatbelt profile
		// emits NO AF_UNIX / unix-socket rule for the agent endpoint, and
		// the sanitized env does not forward SSH_AUTH_SOCK.
		delete process.env[SSH_AGENT_OPTIN_ENV]

		const wsRoot = realpathSync(mkdtempSync(join(tmpdir(), "clinemm-q4-ws-")))
		// A REAL AF_UNIX socket standing in for the agent endpoint, created
		// OUTSIDE the writable roots. `ssh-add` is not assumed present; the
		// property under test is authority over the socket, which we probe
		// directly.
		const agentRoot = realpathSync(mkdtempSync(join(tmpdir(), "clinemm-q4-agent-")))
		const agentSocketPath = join(agentRoot, "agent.sock")
		const agentServer = createServer((socket) => {
			socket.write("AGENT_SPEAKING\n")
			socket.end()
		})
		await new Promise<void>((resolve) => agentServer.listen(agentSocketPath, () => resolve()))

		const scriptPath = join(wsRoot, `agent-probe-${randomBytes(4).toString("hex")}.sh`)
		writeFileSync(
			scriptPath,
			[
				"#!/bin/bash",
				// (a) The sanitized env must not carry SSH_AUTH_SOCK.
				//     `SHELL_EXPAND` splits the shell expansion sigil from
				//     the brace so the linter does not read it as a JS
				//     template placeholder. The emitted script text is
				//     exactly: printf "SSH_AUTH_SOCK=[%s]\n" "<expansion>"
				`printf "SSH_AUTH_SOCK=[%s]\\n" "${SHELL_EXPAND}{SSH_AUTH_SOCK:-}"`,
				// (b) Direct connect to the agent endpoint must fail.
				`if /usr/bin/nc -U "${agentSocketPath}" -w 2 </dev/null 2>/dev/null | grep -q AGENT_SPEAKING; then`,
				'  printf "AGENT_REACHED\\n"',
				"else",
				'  printf "AGENT_DENIED\\n"',
				"fi",
				"",
			].join("\n"),
			{ mode: 0o755 },
		)

		try {
			// CONTROL: unsandboxed, the agent endpoint IS reachable, so
			// "AGENT_DENIED" cannot be explained by a dead socket.
			const control = spawnSync("/bin/bash", [scriptPath], {
				encoding: "utf8",
				cwd: wsRoot,
				timeout: 15_000,
				env: { ...process.env, SSH_AUTH_SOCK: agentSocketPath },
			})
			if (!(control.stdout ?? "").includes("AGENT_REACHED")) {
				throw new Error(
					`CAPTURE_INSUFFICIENT: CONTROL could not reach the agent socket; got=${JSON.stringify(control.stdout)}`,
				)
			}

			// AUTHORITY LEG: the R5 bypass IS granted.
			const approval = realApprovalForR5('rm -rf "$HOME"')
			expect(approval.approved).toBe(true)
			expect(approval.mandatorySeatbeltExecution).toBe(true)

			// KERNEL LEG.
			const out = await runUnderRealSeatbelt({
				command: `/bin/bash ${scriptPath}`,
				cwd: wsRoot,
				workspaceRoots: [wsRoot],
				mandatorySeatbeltExecution: approval.mandatorySeatbeltExecution,
			})

			expect(out.state).toBe("exited")
			// CONSERVATION (a): the socket path never reaches the child env.
			expect(out.stdout).toContain("SSH_AUTH_SOCK=[]")
			expect(out.stdout).not.toContain(agentSocketPath)
			// CONSERVATION (b): the agent endpoint is not reachable.
			expect(out.stdout).toContain("AGENT_DENIED")
			expect(out.stdout).not.toContain("AGENT_REACHED")
		} finally {
			try {
				agentServer.close()
			} catch {}
			rmSync(wsRoot, { recursive: true, force: true })
			rmSync(agentRoot, { recursive: true, force: true })
		}
	})
})
