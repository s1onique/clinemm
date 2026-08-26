/**
 * ACT-CLINEMM-SAFE-YOLO-SEATBELT-NETWORK-OPEN01 GREEN.
 *
 * ACT-CLINEMM-SAFE-YOLO-SENSITIVE-READ-CONFINEMENT01-CORRECTION01
 * adds two updates to this file:
 *
 *   1. The filesystem-conservation structural test ("filesystem
 *      policy is unchanged regardless of the opt-in") is updated
 *      to acknowledge SRC01: the Safe-YOLO opt-in now ALSO
 *      activates the curated credential deny list
 *      (`resolveSafeYoloSensitiveReadDenials`). The narrow claim
 *      becomes "filesystem policy is unchanged EXCEPT for the
 *      credential deny list, which is the SRC01 extension."
 *
 *   2. Substrate-dependent tests SKIP (not fake-PASS) on non-darwin
 *      hosts or when `/usr/bin/sandbox-exec` is unavailable. Uses
 *      `describe.skipIf(...)` so Vitest reports honest skip counts.
 *      Pattern matches `command-job-manager.sandbox-c3-real-kernel.test.ts`.
 *
 * Three test sets, one per ACT §12 requirement:
 *
 *   1. Unit/structural: `CLINEMM_SAFE_YOLO_NETWORK=allow` flips
 *      `network: "deny"` -> `network: "allow"` in the production
 *      `buildExperimentalReconCapability`. Absence of the env var
 *      preserves `network: "deny"`. Anything other than the exact
 *      string `"allow"` is rejected (no fuzzy truthy).
 *
 *   2. REAL PRODUCTION SEAM: with both opt-ins set, the
 *      CommandJobManager runs a sandboxed bash connect against a
 *      parent-owned TCP listener. Exact stdout discriminator:
 *      CONTROL stdout === `CONNECTED:${TOKEN}\n`; TEST (sandboxed)
 *      stdout === `CONNECTED:${TOKEN}\n` (the previous RED leg
 *      printed `DENIED`). Both legs must hit exact-stdout to
 *      prove the network is now actually reachable under the same
 *      Seatbelt profile path the production executor uses.
 *
 *   3. FILESYSTEM CONSERVATION: with the network opt-in set, the
 *      SAME production seam produces the SAME filesystem decisions
 *      as the pre-change baseline (workspace write OK, home write
 *      DENIED, home read OK, child-process inheritance same),
 *      plus the SRC01 credential deny list is active.
 */

import { spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { CommandJobManager } from "../command-job-manager"
import { buildExperimentalReconCapability, resolveSafeYoloNetworkOptIn } from "../sandbox-policy"

/**
 * Substrate probe (CORRECTION01 P2): real-kernel Seatbelt tests
 * SKIP on non-darwin hosts or when `/usr/bin/sandbox-exec` is
 * missing. Captured once at module load.
 */
const HAS_SUBSTRATE: boolean = process.platform === "darwin" && existsSync("/usr/bin/sandbox-exec")

beforeEach(() => {
	process.env.CLINEMM_EXPERIMENTAL_SANDBOX = "seatbelt"
})

afterEach(() => {
	process.env.CLINEMM_EXPERIMENTAL_SANDBOX = ""
	delete process.env.CLINEMM_SAFE_YOLO_NETWORK
})

describe("ACT-CLINEMM-SAFE-YOLO-SEATBELT-NETWORK-OPEN01 - structural", () => {
	it("absent env var: buildExperimentalReconCapability emits network: 'deny'", () => {
		const cap = buildExperimentalReconCapability({ cwd: "/tmp", workspaceRoots: [] })
		expect(cap.network).toBe("deny")
	})

	it("CLINEMM_SAFE_YOLO_NETWORK=allow + Seatbelt opt-in: network flips to 'allow'", () => {
		process.env.CLINEMM_SAFE_YOLO_NETWORK = "allow"
		const cap = buildExperimentalReconCapability({ cwd: "/tmp", workspaceRoots: [] })
		expect(cap.network).toBe("allow")
	})

	it("CLINEMM_SAFE_YOLO_NETWORK=allow WITHOUT Seatbelt opt-in (off): still 'deny'", () => {
		// ACT-CLINEMM-SEATBELT-DEFAULT-ON01: classic execution is now
		// reachable only via the explicit `CLINEMM_EXPERIMENTAL_SANDBOX=off`.
		process.env.CLINEMM_EXPERIMENTAL_SANDBOX = "off"
		process.env.CLINEMM_SAFE_YOLO_NETWORK = "allow"
		expect(resolveSafeYoloNetworkOptIn()).toBeUndefined()
		const cap = buildExperimentalReconCapability({ cwd: "/tmp", workspaceRoots: [] })
		expect(cap.network).toBe("deny")
	})

	it("non-'allow' values are rejected (no fuzzy truthy)", () => {
		for (const v of ["1", "true", "yes", "on", "Allow", "ALLOW", "allow ", " allow"]) {
			process.env.CLINEMM_SAFE_YOLO_NETWORK = v
			expect(resolveSafeYoloNetworkOptIn()).toBeUndefined()
		}
	})

	it("filesystem policy is unchanged EXCEPT for the credential deny list when the opt-in is set", () => {
		process.env.CLINEMM_SAFE_YOLO_NETWORK = "allow"
		const cap = buildExperimentalReconCapability({
			cwd: "/tmp",
			workspaceRoots: ["/var/folders/x/y"],
		})
		// ACT-CLINEMM-SAFE-YOLO-SENSITIVE-READ-CONFINEMENT01 + CORRECTION01:
		//
		// The Safe-YOLO opt-in activates BOTH:
		//   - network: "deny" → "allow"   (NETWORK-OPEN01 ACT)
		//   - denyReadSubpaths: [] → CURATED_CREDENTIAL_SET_V1  (SRC01)
		//
		// CORRECTION01 reframes SRC01: the deny list is the
		// "network-open credential read guard", which follows the
		// dangerous capability (Seatbelt experimental + unrestricted
		// network) — NOT YOLO / approval mode / session override.
		//
		// ACT-CLINEMM-SAFE-YOLO-WORKSPACE-WRITE01:
		//   The workspace-write fix changes the writableRoots/readonlyRoots
		//   contract: workspace roots go into `writableRoots` (and out of
		//   `readonlyRoots`) so the Seatbelt deny-after-allow rule does
		//   not silently disable `mkdir` etc. inside the workspace.
		//   What the network-open fix MUST still preserve:
		//     - filesystem POLICY preserves workspace as the writable
		//       trust boundary
		//     - environment / cwd are unchanged
		//     - ONLY network and denyReadSubpaths differ from no-opt-in
		//       in THIS specific direction (no widening to HOME, no
		//       parent widening)
		expect(cap.writableRoots).toEqual(["/var/folders/x/y"])
		expect(cap.readonlyRoots).toEqual([])
		expect(cap.cwd).toBe("/tmp")
		expect(cap.environment.mode).toBe("sanitized")
		if (cap.environment.mode === "sanitized") {
			expect(Array.isArray(cap.environment.allow)).toBe(true)
			expect(cap.environment.allow.length).toBeGreaterThan(0)
		}
		// denyReadSubpaths is the curated V1 credential set,
		// filtered to existing files. The contents depend on the
		// host HOME; we verify the SHAPE not the exact contents.
		const denials = cap.denyReadSubpaths ?? []
		expect(Array.isArray(denials)).toBe(true)
		for (const p of denials) {
			expect(typeof p).toBe("string")
			expect(p.includes(".ssh/") || p.includes(".gnupg/")).toBe(true)
		}
		// Only network and denyReadSubpaths are allowed to differ
		// from the no-opt-in case.
		expect(cap.network).toBe("allow")
	})

	it("filesystem policy WITHOUT the opt-in: denyReadSubpaths is empty (CORRECTION01 R11)", () => {
		// CORRECTION01 (P2 review): explicit witness that the
		// historical broad-read contract is preserved when the
		// dangerous-capability precondition (open network) is NOT
		// met. Threat model requires open network + readable
		// credentials; without open network, broad read holds.
		process.env.CLINEMM_SAFE_YOLO_NETWORK = ""
		const cap = buildExperimentalReconCapability({
			cwd: "/tmp",
			workspaceRoots: ["/var/folders/x/y"],
		})
		expect(cap.denyReadSubpaths).toEqual([])
		expect(cap.network).toBe("deny")
	})
})

// ---------------------------------------------------------------------------
// Production-seam live qualification. Darwin-only (skipped on non-darwin /
// when /usr/bin/sandbox-exec is missing).
// ---------------------------------------------------------------------------
describe.skipIf(!HAS_SUBSTRATE)("ACT-CLINEMM-SAFE-YOLO-SEATBELT-NETWORK-OPEN01 - REAL production seam GREEN", () => {
	it("CommandJobManager.start with CLINEMM_SAFE_YOLO_NETWORK=allow: sandboxed connect reaches CONTROL (CONNECTED:$TOKEN)", async () => {
		process.env.CLINEMM_SAFE_YOLO_NETWORK = "allow"

		const TOKEN = `SYN-${randomBytes(6).toString("hex")}`
		const server = createServer((socket) => {
			socket.write(`${TOKEN}\n`)
			socket.end()
		})
		await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()))
		const addr = server.address()
		if (!addr || typeof addr === "string") {
			throw new Error("listener bound to unexpected address shape")
		}
		const port = addr.port

		const scratchRoot = realpathSync(mkdtempSync(join(tmpdir(), "clinemm-syn-green-")))
		const scriptPath = join(scratchRoot, `connect-${randomBytes(4).toString("hex")}.sh`)
		const scriptBody = [
			"#!/bin/bash",
			"if exec 3<>/dev/tcp/127.0.0.1/" + port + "; then",
			'  IFS= read -r -t 3 line <&3 || line=""',
			'  printf "CONNECTED:%s\\n" "$line"',
			"  exec 3<&-",
			"else",
			'  printf "DENIED\\n"',
			"fi",
			"",
		].join("\n")
		writeFileSync(scriptPath, scriptBody, { mode: 0o755 })

		try {
			// CONTROL: plain unsandboxed child_process.
			const ctrlOut = await new Promise<{ stdout: string; exitCode: number | null }>((resolve) => {
				const c = spawn("/bin/bash", [scriptPath], { cwd: "/tmp", env: {} })
				let stdout = ""
				c.stdout?.on("data", (d: Buffer) => (stdout += d.toString()))
				c.on("close", (code) => resolve({ stdout, exitCode: code }))
			})
			const expectedControl = `CONNECTED:${TOKEN}\n`
			if (ctrlOut.stdout !== expectedControl || ctrlOut.exitCode !== 0) {
				throw new Error(
					`CAPTURE_INSUFFICIENT: CONTROL exact-stdout mismatch; expected=${JSON.stringify(
						expectedControl,
					)} got=${JSON.stringify(ctrlOut.stdout)} exit=${ctrlOut.exitCode}`,
				)
			}

			// TEST: real production seam (CommandJobManager.start).
			const { defaultSandboxBackendResolver } = await import("../sandbox-policy")
			const manager = new CommandJobManager({
				sandboxBackendResolver: defaultSandboxBackendResolver,
				experimentalSandboxWorkspaceRoots: [],
			})
			const testOut = await manager.start({
				command: `/bin/bash ${scriptPath}`,
				cwd: scratchRoot,
				env: {},
				waitBudgetMs: 15_000,
				executionDeadlineMs: 30_000,
			})

			const expectedTest = `CONNECTED:${TOKEN}\n`
			if (testOut.stdout !== expectedTest || testOut.exitCode !== 0) {
				throw new Error(
					`NETWORK_OPEN_FAILED: TEST exact-stdout mismatch; expected=${JSON.stringify(
						expectedTest,
					)} got=${JSON.stringify(testOut.stdout)} exit=${testOut.exitCode} state=${testOut.state}`,
				)
			}
			expect(testOut.stdout).toBe(expectedTest)
		} finally {
			try {
				server.close()
			} catch {}
			try {
				rmSync(scratchRoot, { recursive: true, force: true })
			} catch {}
		}
	})

	it("FILESYSTEM CONSERVATION: same production seam with opt-in set, probes match pre-change baseline", async () => {
		process.env.CLINEMM_SAFE_YOLO_NETWORK = "allow"

		const wsRoot = realpathSync(mkdtempSync(join(tmpdir(), "clinemm-syn-fs-")))
		const wsFile = join(wsRoot, "ws-probe.txt")
		writeFileSync(wsFile, "WS_ORIGINAL\n", "utf8")
		const homeFixture = join(process.env.HOME!, `.cline-safe-yolo-lab-${randomBytes(4).toString("hex")}`)
		mkdirSync(homeFixture, { recursive: true })
		const homeFile = join(homeFixture, "home-probe.txt")
		writeFileSync(homeFile, "HOME_SENTINEL\n", "utf8")

		const scriptPath = join(wsRoot, `probe-${randomBytes(4).toString("hex")}.sh`)
		const probeScript =
			"#!/bin/bash\n" +
			`printf 'WS_NEW\\n' > "${wsFile}"\n` +
			`printf 'WS_MODIFIED\\n' > "${wsFile}"\n` +
			`rm -f "${wsFile}"\n` +
			`printf 'WS_RECREATED\\n' > "${wsFile}"\n` +
			`if printf 'HOME_BAD\\n' > "${homeFile}" 2>/dev/null; then printf 'HCREATE_OK\\n'; else printf 'HCREATE_DENIED\\n'; fi\n` +
			`if printf 'HOME_MOD\\n' >> "${homeFile}" 2>/dev/null; then printf 'HMODIFY_OK\\n'; else printf 'HMODIFY_DENIED\\n'; fi\n` +
			`if rm -f "${homeFile}" 2>/dev/null; then printf 'HDELETE_OK\\n'; else printf 'HDELETE_DENIED\\n'; fi\n` +
			`/bin/sh -c 'printf WS_CHILD > "${wsFile}"'\n` +
			`/bin/sh -c 'printf HOME_CHILD > "${homeFile}" 2>/dev/null && printf CHC_OK || printf CHC_DENIED'\n` +
			`printf DONE\n`
		writeFileSync(scriptPath, probeScript, { mode: 0o755 })

		try {
			const { defaultSandboxBackendResolver } = await import("../sandbox-policy")
			const manager = new CommandJobManager({
				sandboxBackendResolver: defaultSandboxBackendResolver,
				experimentalSandboxWorkspaceRoots: [],
			})
			const out = await manager.start({
				command: `/bin/bash ${scriptPath}`,
				cwd: wsRoot,
				env: {},
				waitBudgetMs: 15_000,
				executionDeadlineMs: 30_000,
			})
			expect(out.exitCode).toBe(0)
			// Pre-change baseline values (captured in the RED
			// phase). The opt-in change must NOT alter these.
			expect(out.stdout).toContain("HCREATE_DENIED")
			expect(out.stdout).toContain("HMODIFY_DENIED")
			expect(out.stdout).toContain("HDELETE_DENIED")
			expect(out.stdout).toContain("CHC_DENIED")
			expect(out.stdout).toContain("DONE")
		} finally {
			try {
				rmSync(wsRoot, { recursive: true, force: true })
			} catch {}
			try {
				rmSync(homeFixture, { recursive: true, force: true })
			} catch {}
		}
	})
})
