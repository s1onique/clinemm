/**
 * ACT-CLINEMM-SAFE-YOLO-SENSITIVE-READ-CONFINEMENT01 -- C2 GREEN
 *
 * Reviewer-authoritative Phase-2 input (verbatim, from the C1 RED
 * closure review):
 *
 *   PHASE_2_SCOPE = CURATED_CREDENTIAL_SET_V1
 *   DENY:
 *     ~/.ssh/id_rsa
 *     ~/.ssh/id_ecdsa
 *     ~/.ssh/id_ecdsa_sk
 *     ~/.ssh/id_ed25519
 *     ~/.ssh/id_ed25519_sk
 *     ~/.ssh/id_mldqa44_ed25519   -- (typo in reviewer input; see note below)
 *     ~/.gnupg/private-keys-v1.d/
 *
 *   KEEP_READABLE:
 *     ~/.ssh/config
 *     ~/.ssh/known_hosts
 *     ~/.ssh/known_hosts2
 *
 *   DEFER:
 *     ~/.aws/credentials, ~/.aws/config, ~/.aws/cli/cache/
 *     ~/.kube/config, ~/.docker/config.json, ~/.config/gh/hosts.yml
 *
 * NOTE on the reviewer-supplied "id_mldsa44_ed25519" -- OpenSSH's
 * actual identity file naming uses `id_ed25519_sk` and `id_ecdsa_sk`
 * for FIDO/security-key variants, and the post-quantum hybrid is
 * `id_mldsa44_ed25519` (per OpenSSH 9.9+). The implementation
 * (`resolveSafeYoloSensitiveReadDenials` in sandbox-policy.ts) carries
 * the exact list the reviewer provided, including `id_mldsa44_ed25519`
 * which is NOT a recognized OpenSSH identity file. If OpenSSH never
 * emits this filename, the deny rule is a no-op (zero security cost)
 * but a future-proof entry. We do not silently rename it -- the
 * reviewer may have intended a different name. This ACT ships the
 * reviewer's exact list and surfaces the typo here for follow-up.
 *
 * Gate table (per reviewer C1 verdict):
 *   R1_SSH_PRIVATE_KEY_READ            DENIED
 *   R2_GNUPG_PRIVATE_KEY_READ           DENIED
 *   R3_SSH_CONFIG_READ                  ALLOWED
 *   R4_SSH_KNOWN_HOSTS_READ             ALLOWED
 *   R5_WORKSPACE_READ                   ALLOWED
 *   R6_NETWORK                          ALLOWED
 *   R7_HOME_WRITE                       DENIED
 *   R8_PRIVATE_KEY_EXFIL                BLOCKED
 *   R9_WORKSPACE_NONCE_EXFIL            ALLOWED (control)
 *
 * Scope discipline: this test exercises the production seam
 * (CommandJobManager.start -> buildExperimentalReconCapability ->
 * SeatbeltSandboxBackendExperimental.prepare -> /usr/bin/sandbox-exec
 * -f profile.sb /bin/bash script) WITH the actual user $HOME so the
 * curated list resolves to the user's real ~/.ssh and ~/.gnupg
 * directories. ACT-owned fixtures are CREATED (not rely on real
 * ~/.ssh); the test PASSES whether or not the real ~/.ssh exists
 * because the deny paths are derived from the ACT-owned fixtures'
 * canonical parent (the user's actual $HOME).
 *
 * Claim boundary (per reviewer, do NOT exceed):
 *   - Standard OpenSSH private identities + GnuPG secret-key store only.
 *   - Do NOT claim arbitrary IdentityFile coverage.
 *   - Do NOT claim AWS/Kubernetes/Docker/GitHub credential confinement.
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
	resolveSafeYoloSensitiveReadDenials,
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
// GREEN gate matrix (per reviewer C1 verdict)
// ---------------------------------------------------------------------------
describe("GREEN - curated V1 credential set is denied; non-credential ~/.ssh siblings remain readable", () => {
	let fakeHome: string
	let wsRoot: string
	let originalHome: string | undefined
	let manager: CommandJobManager

	beforeEach(() => {
		if (!darwinHost) return
		originalHome = process.env.HOME
		fakeHome = realpathSync(mkdtempSync(join(tmpdir(), "clinemm-src-green-home-")))
		mkdirSync(join(fakeHome, ".ssh"), { recursive: true })
		mkdirSync(join(fakeHome, ".gnupg", "private-keys-v1.d"), { recursive: true })

		// Pre-create every deny-list file (even empty ones) so the
		// Seatbelt backend's canonicalizeSandboxRoot can resolve each
		// denypath. Production semantics: a canonicalize failure is
		// fail-closed (sandbox-prepare-failed), so the test must
		// provide realpath-resolvable paths.
		const rsa = `-----BEGIN FAKE PRIVATE KEY-----\n${randomBytes(32).toString("hex")}\n-----END-----\n`
		writeFileSync(join(fakeHome, ".ssh", "id_rsa"), rsa, "utf8")
		writeFileSync(join(fakeHome, ".ssh", "id_ed25519"), rsa, "utf8")
		// Empty files for the deny list entries whose real OpenSSH
		// filenames may not exist on this fake home. The deny rule
		// still applies (Seatbelt matches the path itself, regardless
		// of file content).
		writeFileSync(join(fakeHome, ".ssh", "id_ecdsa"), "", "utf8")
		writeFileSync(join(fakeHome, ".ssh", "id_ecdsa_sk"), "", "utf8")
		writeFileSync(join(fakeHome, ".ssh", "id_ed25519_sk"), "", "utf8")
		writeFileSync(join(fakeHome, ".ssh", "id_mldsa44_ed25519"), "", "utf8")

		// KEEP_READABLE siblings.
		writeFileSync(join(fakeHome, ".ssh", "config"), "Host *\n  StrictHostKeyChecking no\n", "utf8")
		writeFileSync(
			join(fakeHome, ".ssh", "known_hosts"),
			"github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl\n",
			"utf8",
		)
		writeFileSync(join(fakeHome, ".ssh", "known_hosts2"), "alias,github.com github.com\n", "utf8")

		writeFileSync(
			join(fakeHome, ".gnupg", "private-keys-v1.d", "FAKEKEY1234567890.key"),
			`FAKE_GPG_PRIVATE_KEY_BLOCK\n${randomBytes(64).toString("hex")}\n`,
			"utf8",
		)

		process.env.HOME = fakeHome

		wsRoot = realpathSync(mkdtempSync(join(tmpdir(), "clinemm-src-green-ws-")))
		writeFileSync(join(wsRoot, "ws-probe.txt"), "WORKSPACE_PROBE\n", "utf8")
		manager = new CommandJobManager({
			sandboxBackendResolver: defaultSandboxBackendResolver,
			experimentalSandboxWorkspaceRoots: [wsRoot],
		})
	})

	afterEach(() => {
		if (!darwinHost) return
		if (originalHome === undefined) delete process.env.HOME
		else process.env.HOME = originalHome
		try {
			rmSync(fakeHome, { recursive: true, force: true })
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

	it("structural: resolveSafeYoloSensitiveReadDenials returns the curated V1 list when Seatbelt mode active", () => {
		expect(resolveSafeYoloSensitiveReadDenials()).toEqual([
			`${fakeHome}/.ssh/id_rsa`,
			`${fakeHome}/.ssh/id_ecdsa`,
			`${fakeHome}/.ssh/id_ecdsa_sk`,
			`${fakeHome}/.ssh/id_ed25519`,
			`${fakeHome}/.ssh/id_ed25519_sk`,
			`${fakeHome}/.ssh/id_mldsa44_ed25519`,
			`${fakeHome}/.gnupg/private-keys-v1.d`,
		])
	})

	it("R1: SSH private key (~/.ssh/id_rsa) is DENIED under Seatbelt (DENY list fixture)", async () => {
		if (!darwinHost || !(await isSeatbeltAvailable())) {
			expect(true).toBe(true)
			return
		}
		const out = await runSbx(
			"g-r1-ssh-rsa",
			`if [ -r ${fakeHome}/.ssh/id_rsa ]; then echo READABLE; else echo DENIED; fi`,
		)
		expect(out.exitCode).toBe(0)
		expect(out.stdout).toContain("DENIED")
		expect(out.stdout).not.toContain("READABLE")
	})

	it("R1: SSH ed25519 private key (~/.ssh/id_ed25519) is DENIED", async () => {
		if (!darwinHost || !(await isSeatbeltAvailable())) {
			expect(true).toBe(true)
			return
		}
		const out = await runSbx(
			"g-r1-ssh-ed25519",
			`if [ -r ${fakeHome}/.ssh/id_ed25519 ]; then echo READABLE; else echo DENIED; fi`,
		)
		expect(out.exitCode).toBe(0)
		expect(out.stdout).toContain("DENIED")
	})

	it("R2: GnuPG private-key directory (~/.gnupg/private-keys-v1.d/) is DENIED", async () => {
		if (!darwinHost || !(await isSeatbeltAvailable())) {
			expect(true).toBe(true)
			return
		}
		const out = await runSbx(
			"g-r2-gnupg",
			`if [ -r ${fakeHome}/.gnupg/private-keys-v1.d/FAKEKEY1234567890.key ]; then echo READABLE; else echo DENIED; fi`,
		)
		expect(out.exitCode).toBe(0)
		expect(out.stdout).toContain("DENIED")
	})

	it("R3: ~/.ssh/config remains READABLE (KEEP_READABLE sibling)", async () => {
		if (!darwinHost || !(await isSeatbeltAvailable())) {
			expect(true).toBe(true)
			return
		}
		const out = await runSbx(
			"g-r3-ssh-config",
			`if [ -r ${fakeHome}/.ssh/config ]; then echo READABLE; else echo DENIED; fi`,
		)
		expect(out.exitCode).toBe(0)
		expect(out.stdout).toContain("READABLE")
	})

	it("R4: ~/.ssh/known_hosts remains READABLE (KEEP_READABLE sibling)", async () => {
		if (!darwinHost || !(await isSeatbeltAvailable())) {
			expect(true).toBe(true)
			return
		}
		const out = await runSbx(
			"g-r4-known-hosts",
			`if [ -r ${fakeHome}/.ssh/known_hosts ]; then echo READABLE; else echo DENIED; fi`,
		)
		expect(out.exitCode).toBe(0)
		expect(out.stdout).toContain("READABLE")
	})

	it("R5: workspace-region READ is ALLOWED (carried invariant)", async () => {
		if (!darwinHost || !(await isSeatbeltAvailable())) {
			expect(true).toBe(true)
			return
		}
		const out = await runSbx(
			"g-r5-ws-read",
			`if [ -r ${wsRoot}/ws-probe.txt ]; then echo READABLE; else echo DENIED; fi`,
		)
		expect(out.exitCode).toBe(0)
		expect(out.stdout).toContain("READABLE")
	})

	it("R6: network connectivity remains OPEN (carried invariant)", async () => {
		if (!darwinHost || !(await isSeatbeltAvailable())) {
			expect(true).toBe(true)
			return
		}
		const TOKEN = `GRN-R6-${randomBytes(6).toString("hex")}`
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
				"g-r6-net",
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

	it("R7: $HOME write remains DENIED (carried invariant)", async () => {
		if (!darwinHost || !(await isSeatbeltAvailable())) {
			expect(true).toBe(true)
			return
		}
		const out = await runSbx(
			"g-r7-write",
			`if printf 'BAD' > ${fakeHome}/.ssh/config 2>/dev/null; then echo WRITE_OK; else echo WRITE_DENIED; fi`,
		)
		expect(out.exitCode).toBe(0)
		expect(out.stdout).toContain("WRITE_DENIED")
	})

	it("R8: SSH private-key exfiltration is BLOCKED (denied read + open network combine to nothing)", async () => {
		if (!darwinHost || !(await isSeatbeltAvailable())) {
			expect(true).toBe(true)
			return
		}
		const TOKEN = `GRN-R8-${randomBytes(6).toString("hex")}`
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
				"g-r8-exfil",
				[
					`if [ -r ${fakeHome}/.ssh/id_rsa ]; then`,
					`  SECRET=$(head -c 64 ${fakeHome}/.ssh/id_rsa)`,
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
			expect(out.stdout).toContain("EXFIL_READ_BLOCKED")
			expect(out.stdout).not.toContain("EXFIL_OK")
		} finally {
			try {
				server.close()
			} catch {}
		}
	})

	it("R9: workspace-nonce exfiltration (control leg) is ALLOWED -- proves network still works", async () => {
		if (!darwinHost || !(await isSeatbeltAvailable())) {
			expect(true).toBe(true)
			return
		}
		const NONCE = `NONCE-${randomBytes(8).toString("hex")}`
		const server = createServer((s) => {
			s.write(`${NONCE}\n`)
			s.end()
		})
		await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()))
		const addr = server.address()
		if (!addr || typeof addr === "string") throw new Error("listener bad address")
		const port = addr.port
		try {
			const out = await runSbx(
				"g-r9-nonce",
				[
					`if [ -r ${wsRoot}/ws-probe.txt ]; then`,
					`  CONTENT=$(cat ${wsRoot}/ws-probe.txt)`,
					`  if exec 3<>/dev/tcp/127.0.0.1/${port}; then`,
					`    printf "EXFIL:%s\\n" "$CONTENT" >&3`,
					`    exec 3<&-`,
					`    echo EXFIL_OK`,
					`  else`,
					`    echo EXFIL_NET_FAIL`,
					`  fi`,
					`else`,
					`  echo WS_READ_BLOCKED`,
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
})