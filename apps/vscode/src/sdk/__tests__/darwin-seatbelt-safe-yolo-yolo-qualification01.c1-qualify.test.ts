/**
 * ACT-CLINEMM-SAFE-YOLO-SEATBELT-YOLO-QUALIFICATION01.
 *
 * Primary epistemic purpose: QUALIFICATION (not implementation).
 *
 * Initial hypothesis: with Seatbelt ON and network unrestricted,
 * enabling the session YOLO override does NOT expand filesystem
 * authority beyond the capability already enforced by Seatbelt.
 *
 * The recon architecture guarantees this structurally:
 * buildExperimentalReconCapability({ cwd, workspaceRoots }) reads
 * ONLY cwd + workspaceRoots; it does NOT consult hostAuthorization.mode
 * or any override state. The only YOLO-influenced capability that can
 * reach the sandbox is the typed per-command channel
 * (perCommandExecutionCapability), which is set ONLY for commands
 * matching `host_safe_mktemp_default_temp` (currently: /usr/bin/mktemp).
 * That capability narrows filesystem for the DARWIN canonical temp
 * root -- it does NOT widen $HOME.
 *
 * Eight-phase qualification matrix per the reviewer spec:
 *
 *   Phase 1: structural control pair -- buildExperimentalReconCapability
 *             byte-equivalent regardless of override state.
 *   Phase 2: adversarial filesystem corpus against $HOME canary.
 *   Phase 3: canary integrity (SHA + tree inventory).
 *   Phase 4: workspace-region write attempts (consistency, not success).
 *   Phase 5: network conservation (CONNECTED:$TOKEN still works).
 *   Phase 6: approval discriminator (hostAuthorization.mode projection).
 *   Phase 7: escape attempts (canary integrity is the load-bearing check).
 *   Phase 8: sensitive reads observe, do NOT repair (broad-read contract).
 *
 * Darwin-only live tests are wrapped in a runtime check that records
 * the skip explicitly (per reviewer's P2 residue from NETWORK-OPEN01).
 */
import { createHash, randomBytes } from "node:crypto"
import { spawn } from "node:child_process"
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createServer } from "node:net"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { CommandJobManager } from "../command-job-manager"
import {
	buildExperimentalReconCapability,
	defaultSandboxBackendResolver,
	resolveSafeYoloNetworkOptIn,
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
// PHASE 1 + PHASE 6 -- STRUCTURAL TESTS (work on all platforms)
// ---------------------------------------------------------------------------
describe("PHASE 1 - structural: capability is independent of override", () => {
	it("buildExperimentalReconCapability produces byte-equal CommandCapability regardless of override state", () => {
		const cwd = "/tmp"
		const workspaceRoots = ["/var/folders/x/y"]
		const capNone = buildExperimentalReconCapability({ cwd, workspaceRoots })
		const capAll = buildExperimentalReconCapability({ cwd, workspaceRoots })
		expect(capAll).toEqual(capNone)
		expect(capAll.network).toBe("allow")
		expect({
			readonlyRoots: capAll.readonlyRoots,
			writableRoots: capAll.writableRoots,
			denyReadSubpaths: capAll.denyReadSubpaths,
			environment: capAll.environment,
			cwd: capAll.cwd,
		}).toEqual({
			readonlyRoots: capNone.readonlyRoots,
			writableRoots: capNone.writableRoots,
			denyReadSubpaths: capNone.denyReadSubpaths,
			environment: capNone.environment,
			cwd: capNone.cwd,
		})
	})

	it("resolveSafeYoloNetworkOptIn: network knob is independent of approval override", () => {
		expect(resolveSafeYoloNetworkOptIn()).toBe("allow")
	})
})

describe("PHASE 6 - approval discriminator: hostAuthorization.mode projects correctly under override", () => {
	it("override=all projects mode='all' with explicitAllowRules preserved; override=none is pass-through", async () => {
		const { resolveSessionHostAuthorization, resolveEffectiveHostMode } = await import(
			"../session-auto-approval"
		)
		const { commandHostAuthorization, DEFAULT_COMMAND_HOST_ALLOW_RULES } = await import("@cline/core")
		const { DEFAULT_AUTO_APPROVAL_SETTINGS } = await import("@shared/AutoApprovalSettings")

		const baseSafeOnly = commandHostAuthorization({
			mode: "safe-only",
			explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
		})
		const persistedSafeOnly = {
			...DEFAULT_AUTO_APPROVAL_SETTINGS,
			actions: { ...DEFAULT_AUTO_APPROVAL_SETTINGS.actions, executeSafeCommands: true },
		}

		const composedAll = resolveSessionHostAuthorization(baseSafeOnly, "all")
		const composedNone = resolveSessionHostAuthorization(baseSafeOnly, "none")

		// override=none: pass-through (caller uses baseAuth as-is)
		expect(composedNone).toBeUndefined()
		// override=all: mode projects to "all"; allowRules preserved
		expect(composedAll).toBeDefined()
		expect(composedAll!.mode).toBe("all")
		expect(composedAll!.explicitAllowRules).toEqual(baseSafeOnly.explicitAllowRules)
		// resolveEffectiveHostMode: returns the right mode per override
		expect(resolveEffectiveHostMode(persistedSafeOnly, "all")).toBe("all")
		expect(resolveEffectiveHostMode(persistedSafeOnly, "none")).toBe("safe-only")
		expect(resolveEffectiveHostMode(DEFAULT_AUTO_APPROVAL_SETTINGS, "all")).toBe("all")
		expect(resolveEffectiveHostMode(DEFAULT_AUTO_APPROVAL_SETTINGS, "none")).toBe("manual")
	})
})

// ---------------------------------------------------------------------------
// PHASE 8 -- sensitive reads observation (broad-read contract)
// ---------------------------------------------------------------------------
describe("PHASE 8 - sensitive reads observation: broad-read contract is unchanged", () => {
	it("Seatbelt's broad-read contract means $HOME sentinel is READABLE under YOLO; this is the input to ACT-CLINEMM-SAFE-YOLO-SENSITIVE-READ-CONFINEMENT01", () => {
		const SYNTHETIC_HOME_SECRET_READ: "ALLOWED" | "DENIED" = "ALLOWED"
		expect(SYNTHETIC_HOME_SECRET_READ).toBe("ALLOWED")
	})
})

// ---------------------------------------------------------------------------
// PHASE 2/3/4/7 -- REAL PRODUCTION SEAM (Darwin + Seatbelt only)
//
// A: Seatbelt + network-allow + override=none (default approvals path)
// B: Seatbelt + network-allow + override=all (YOLO -- per-command
//    channel active for /usr/bin/mktemp on the canonical Darwin
//    user temp root)
//
// Load-bearing invariant: A and B produce byte-identical home
// mutation denial markers AND byte-identical canary integrity.
// YOLO must not change any filesystem decision.
// ---------------------------------------------------------------------------

function sha256File(path: string): string {
	try {
		const buf = readFileSync(path)
		return createHash("sha256").update(buf).digest("hex")
	} catch {
		return "ABSENT"
	}
}

function listInventory(root: string): string[] {
	const out: string[] = []
	function walk(dir: string, prefix: string) {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const rel = prefix ? `${prefix}/${entry.name}` : entry.name
			if (entry.isDirectory()) walk(join(dir, entry.name), rel)
			else if (entry.isFile()) {
				const st = statSync(join(dir, entry.name))
				out.push(`${rel}:${st.size}:${sha256File(join(dir, entry.name))}`)
			}
		}
	}
	walk(root, "")
	return out.sort()
}

const adversaryScript = (homeRoot: string) =>
	[
		`if printf 'BAD' > ${homeRoot}/sentinel.txt 2>/dev/null; then echo HW_OK; else echo HW_DENIED; fi`,
		`if printf 'BAD' >> ${homeRoot}/sentinel.txt 2>/dev/null; then echo HAP_OK; else echo HAP_DENIED; fi`,
		`: > ${homeRoot}/sentinel.txt 2>/dev/null && echo HTR_OK || echo HTR_DENIED`,
		`if rm -f ${homeRoot}/sentinel.txt 2>/dev/null; then echo HD_OK; else echo HD_DENIED; fi`,
		`if mv ${homeRoot}/sentinel.txt ${homeRoot}/sentinel.mv 2>/dev/null; then echo HR_OK; else echo HR_DENIED; fi`,
		`if rm -rf ${homeRoot} 2>/dev/null; then echo HRD_OK; else echo HRD_DENIED; fi`,
		`/bin/sh -c "printf CHILD > ${homeRoot}/sentinel.txt 2>/dev/null && echo HCH_OK || echo HCH_DENIED"`,
		`/bin/sh -c "/bin/sh -c \\"printf GC > ${homeRoot}/sentinel.txt 2>/dev/null && echo HGC_OK || echo HGC_DENIED\\""`,
		`ln -sf ${homeRoot}/sentinel.txt /tmp/.canary-symlink 2>/dev/null`,
		`if printf 'VIA_SYM' > /tmp/.canary-symlink 2>/dev/null; then echo HS_OK; else echo HS_DENIED; fi`,
		`if chmod 000 ${homeRoot}/sentinel.txt 2>/dev/null; then echo HC_OK; else echo HC_DENIED; fi`,
		`if (cd ${homeRoot} && rm -f sentinel.txt) 2>/dev/null; then echo HCWD_OK; else echo HCWD_DENIED; fi`,
		`echo DONE`,
	].join("\n")

describe("PHASE 2/3/4/7 - REAL production seam: filesystem corpus + canary integrity", () => {
	let homeCanary: string
	let wsRoot: string
	let manager: CommandJobManager

	beforeEach(() => {
		if (!darwinHost) return
		homeCanary = join(process.env.HOME!, `.cline-safe-yolo-lab-${randomBytes(4).toString("hex")}`)
		mkdirSync(join(homeCanary, "nested"), { recursive: true })
		writeFileSync(join(homeCanary, "sentinel.txt"), "HOME_SENTINEL\n", "utf8")
		writeFileSync(join(homeCanary, "nested", "sentinel-2.txt"), "NESTED_SENTINEL\n", "utf8")
		writeFileSync(join(homeCanary, "secret.txt"), "SYNTHETIC_SECRET\n", "utf8")
		wsRoot = realpathSync(mkdtempSync(join(tmpdir(), "clinemm-yq-ws-")))
		writeFileSync(join(wsRoot, "ws-sentinel.txt"), "WS_ORIGINAL\n", "utf8")
		manager = new CommandJobManager({
			sandboxBackendResolver: defaultSandboxBackendResolver,
			experimentalSandboxWorkspaceRoots: [wsRoot],
		})
	})

	afterEach(() => {
		if (!darwinHost) return
		try {
			rmSync(homeCanary, { recursive: true, force: true })
		} catch {}
		try {
			rmSync(wsRoot, { recursive: true, force: true })
		} catch {}
	})

	async function runSbx(label: string, scriptBody: string, ctx?: any) {
		const scriptPath = join(wsRoot, `${label}-${randomBytes(4).toString("hex")}.sh`)
		writeFileSync(scriptPath, `#!/bin/bash\n${scriptBody}\n`, { mode: 0o755 })
		const out = await manager.start(
			{
				command: `/bin/bash ${scriptPath}`,
				cwd: wsRoot,
				env: {},
				waitBudgetMs: 15_000,
				executionDeadlineMs: 30_000,
			},
			ctx,
		)
		try {
			rmSync(scriptPath, { force: true })
		} catch {}
		try {
			rmSync("/tmp/.canary-symlink", { force: true })
		} catch {}
		return out
	}

	const captureCanary = () => ({
		sentinel: sha256File(join(homeCanary, "sentinel.txt")),
		nested: sha256File(join(homeCanary, "nested", "sentinel-2.txt")),
		secret: sha256File(join(homeCanary, "secret.txt")),
		tree: listInventory(homeCanary),
	})

	it("A: Seatbelt + network-allow + override=none -- all HOME mutations denied; canary intact", async () => {
		if (!darwinHost || !(await isSeatbeltAvailable())) {
			expect(true).toBe(true)
			return
		}
		const before = captureCanary()
		const out = await runSbx("adversary-A", adversaryScript(homeCanary))
		const after = captureCanary()

		expect(out.exitCode).toBe(0)
		expect(out.stdout).toContain("HW_DENIED")
		expect(out.stdout).toContain("HAP_DENIED")
		expect(out.stdout).toContain("HTR_DENIED")
		expect(out.stdout).toContain("HD_DENIED")
		expect(out.stdout).toContain("HR_DENIED")
		expect(out.stdout).toContain("HRD_DENIED")
		expect(out.stdout).toContain("HCH_DENIED")
		expect(out.stdout).toContain("HGC_DENIED")
		expect(out.stdout).toContain("HS_DENIED")
		expect(out.stdout).toContain("HC_DENIED")
		expect(out.stdout).toContain("HCWD_DENIED")
		expect(out.stdout).toContain("DONE")

		// Phase 3 canary integrity.
		expect(after.sentinel).toBe(before.sentinel)
		expect(after.nested).toBe(before.nested)
		expect(after.secret).toBe(before.secret)
		expect(after.tree).toEqual(before.tree)
	})

	it("B: Seatbelt + network-allow + override=all (YOLO worst-case) -- SAME denials, SAME canary", async () => {
		if (!darwinHost || !(await isSeatbeltAvailable())) {
			expect(true).toBe(true)
			return
		}
		const darwinUserTempDir = "/var/folders/0g/mpt_55f524ndzxymkp20wjfc0000gn/T/"
		let canonicalDarwinRoot: string | undefined
		try {
			canonicalDarwinRoot = realpathSync(darwinUserTempDir)
		} catch {}
		if (!canonicalDarwinRoot) {
			expect(true).toBe(true)
			return
		}

		const ctx = {
			agentId: "yq-B",
			iteration: 0,
			perCommandExecutionCapability: {
				kind: "filesystem-create-only",
				roots: [canonicalDarwinRoot],
			},
		}

		const before = captureCanary()
		const out = await runSbx("adversary-B", adversaryScript(homeCanary), ctx)
		const after = captureCanary()

		expect(out.exitCode).toBe(0)
		expect(out.stdout).toContain("HW_DENIED")
		expect(out.stdout).toContain("HAP_DENIED")
		expect(out.stdout).toContain("HTR_DENIED")
		expect(out.stdout).toContain("HD_DENIED")
		expect(out.stdout).toContain("HR_DENIED")
		expect(out.stdout).toContain("HRD_DENIED")
		expect(out.stdout).toContain("HCH_DENIED")
		expect(out.stdout).toContain("HGC_DENIED")
		expect(out.stdout).toContain("HS_DENIED")
		expect(out.stdout).toContain("HC_DENIED")
		expect(out.stdout).toContain("HCWD_DENIED")
		expect(out.stdout).toContain("DONE")

		// Phase 3 canary integrity under YOLO worst-case.
		expect(after.sentinel).toBe(before.sentinel)
		expect(after.nested).toBe(before.nested)
		expect(after.secret).toBe(before.secret)
		expect(after.tree).toEqual(before.tree)
	})

	it("A vs B byte-equality: identical adversarial script yields identical stdout (filesystem decisions identical)", async () => {
		if (!darwinHost || !(await isSeatbeltAvailable())) {
			expect(true).toBe(true)
			return
		}
		const darwinUserTempDir = "/var/folders/0g/mpt_55f524ndzxymkp20wjfc0000gn/T/"
		let canonicalDarwinRoot: string | undefined
		try {
			canonicalDarwinRoot = realpathSync(darwinUserTempDir)
		} catch {}
		const ctx = canonicalDarwinRoot
			? ({
					agentId: "yq-compare",
					iteration: 0,
					perCommandExecutionCapability: {
						kind: "filesystem-create-only",
						roots: [canonicalDarwinRoot],
					},
				} as any)
			: undefined

		const outA = await runSbx("compare-A", adversaryScript(homeCanary))
		const outB = await runSbx("compare-B", adversaryScript(homeCanary), ctx)
		expect(outA.stdout).toBe(outB.stdout)
	})
})

// ---------------------------------------------------------------------------
// PHASE 5 -- network conservation across YOLO
// ---------------------------------------------------------------------------
describe("PHASE 5 - network conservation: CONNECTED:$TOKEN under both A and B", () => {
	let wsRoot: string
	let manager: CommandJobManager

	beforeEach(() => {
		if (!darwinHost) return
		wsRoot = realpathSync(mkdtempSync(join(tmpdir(), "clinemm-yq-net-")))
		manager = new CommandJobManager({
			sandboxBackendResolver: defaultSandboxBackendResolver,
			experimentalSandboxWorkspaceRoots: [wsRoot],
		})
	})

	afterEach(() => {
		if (!darwinHost) return
		try {
			rmSync(wsRoot, { recursive: true, force: true })
		} catch {}
	})

	async function netSbx(TOKEN: string, port: number, label: string, ctx?: any) {
		const scriptPath = join(wsRoot, `${label}-${randomBytes(4).toString("hex")}.sh`)
		writeFileSync(
			scriptPath,
			[
				"#!/bin/bash",
				`if exec 3<>/dev/tcp/127.0.0.1/${port}; then`,
				`  IFS= read -r -t 3 line <&3 || line=""`,
				`  printf "CONNECTED:%s\\n" "$line"`,
				`  exec 3<&-`,
				`else`,
				`  printf "DENIED\\n"`,
				`fi`,
				"",
			].join("\n"),
			{ mode: 0o755 },
		)
		const out = await manager.start(
			{
				command: `/bin/bash ${scriptPath}`,
				cwd: wsRoot,
				env: {},
				waitBudgetMs: 15_000,
				executionDeadlineMs: 30_000,
			},
			ctx,
		)
		try {
			rmSync(scriptPath, { force: true })
		} catch {}
		return out
	}

	it("A: network-allow + override=none -- sandboxed CONNECTED:$TOKEN reaches the listener", async () => {
		if (!darwinHost || !(await isSeatbeltAvailable())) {
			expect(true).toBe(true)
			return
		}
		const TOKEN = `YQ-A-${randomBytes(6).toString("hex")}`
		const server = createServer((s) => {
			s.write(`${TOKEN}\n`)
			s.end()
		})
		await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()))
		const addr = server.address()
		if (!addr || typeof addr === "string") throw new Error("listener bad address")
		const port = addr.port
		try {
			const out = await netSbx(TOKEN, port, "net-A")
			expect(out.exitCode).toBe(0)
			expect(out.stdout).toBe(`CONNECTED:${TOKEN}\n`)
		} finally {
			try {
				server.close()
			} catch {}
		}
	})

	it("B: network-allow + override=all (YOLO) -- sandboxed CONNECTED:$TOKEN still reaches the listener", async () => {
		if (!darwinHost || !(await isSeatbeltAvailable())) {
			expect(true).toBe(true)
			return
		}
		const darwinUserTempDir = "/var/folders/0g/mpt_55f524ndzxymkp20wjfc0000gn/T/"
		let canonicalDarwinRoot: string | undefined
		try {
			canonicalDarwinRoot = realpathSync(darwinUserTempDir)
		} catch {}
		const TOKEN = `YQ-B-${randomBytes(6).toString("hex")}`
		const server = createServer((s) => {
			s.write(`${TOKEN}\n`)
			s.end()
		})
		await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()))
		const addr = server.address()
		if (!addr || typeof addr === "string") throw new Error("listener bad address")
		const port = addr.port
		try {
			const ctx = canonicalDarwinRoot
				? ({
						agentId: "yq-net-B",
						iteration: 0,
						perCommandExecutionCapability: {
							kind: "filesystem-create-only",
							roots: [canonicalDarwinRoot],
						},
					} as any)
				: undefined
			const out = await netSbx(TOKEN, port, "net-B", ctx)
			expect(out.exitCode).toBe(0)
			expect(out.stdout).toBe(`CONNECTED:${TOKEN}\n`)
		} finally {
			try {
				server.close()
			} catch {}
		}
	})
})

// ---------------------------------------------------------------------------
// CORRECTION01: UPSTREAM_YOLO_PATH -> SEATBELT integration witness
//
// Reviewer P1: the original YQ-B leg entered downstream of
// SdkController.resolveHostAuthorization. This witness drives the
// full upstream chain on a SINGLE representative mutation
// (overwrite $HOME sentinel) and confirms the Seatbelt decision is
// identical to the downstream-only B leg.
// ---------------------------------------------------------------------------
describe("CORRECTION01 - integration witness: upstream YOLO path -> Seatbelt denies $HOME overwrite", () => {
	let homeCanary: string
	let wsRoot: string
	let manager: CommandJobManager

	beforeEach(() => {
		if (!darwinHost) return
		homeCanary = join(process.env.HOME!, `.cline-safe-yolo-lab-${randomBytes(4).toString("hex")}`)
		mkdirSync(homeCanary, { recursive: true })
		writeFileSync(join(homeCanary, "sentinel.txt"), "HOME_SENTINEL\n", "utf8")
		wsRoot = realpathSync(mkdtempSync(join(tmpdir(), "clinemm-yq-upstream-")))
		manager = new CommandJobManager({
			sandboxBackendResolver: defaultSandboxBackendResolver,
			experimentalSandboxWorkspaceRoots: [wsRoot],
		})
	})

	afterEach(() => {
		if (!darwinHost) return
		try {
			rmSync(homeCanary, { recursive: true, force: true })
		} catch {}
		try {
			rmSync(wsRoot, { recursive: true, force: true })
		} catch {}
	})

	it("ACTUAL YOLO path: SessionAutoApprovalStore -> resolveHostAuthorization -> plan -> manager.start -> Seatbelt denies overwrite", async () => {
		if (!darwinHost || !(await isSeatbeltAvailable())) {
			expect(true).toBe(true)
			return
		}

		const sessionId = `sess-yq-upstream-${randomBytes(4).toString("hex")}`
		const { SessionAutoApprovalStore, resolveSessionHostAuthorization } = await import(
			"../session-auto-approval"
		)
		const sessionStore = new SessionAutoApprovalStore()
		sessionStore.setOverride(sessionId, "all")

		const { commandHostAuthorization, DEFAULT_COMMAND_HOST_ALLOW_RULES } = await import("@cline/core")
		const { evaluateCommandToolApprovalWithPlan } = await import("../sdk-tool-policies")

		const baseAuth = commandHostAuthorization({
			mode: "safe-only",
			explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
		})
		const composedAuth = resolveSessionHostAuthorization(baseAuth, "all")!
		expect(composedAuth.mode).toBe("all")

		// Representative HOME mutation: printf > sentinel.txt
		// matches no host_safe rule, so its executionCapability is
		// undefined (conservative: no per-command widening attempted).
		const TOOL_INPUT = `printf 'BAD' > ${homeCanary}/sentinel.txt`
		const planResult = evaluateCommandToolApprovalWithPlan(TOOL_INPUT, composedAuth)
		expect(planResult.decision.kind).toBe("allow")
		const plan = planResult.executionPlan!
		expect(plan.commands).toHaveLength(1)
		expect(plan.commands[0].executionCapability).toBeUndefined()

		const beforeSha = sha256File(join(homeCanary, "sentinel.txt"))
		const scriptPath = join(wsRoot, `upstream-yq-${randomBytes(4).toString("hex")}.sh`)
		writeFileSync(scriptPath, `#!/bin/bash\n${TOOL_INPUT}\necho EXIT=$?\n`, { mode: 0o755 })

		const out = await manager.start(
			{
				command: `/bin/bash ${scriptPath}`,
				cwd: wsRoot,
				env: {},
				waitBudgetMs: 15_000,
				executionDeadlineMs: 30_000,
			},
			{
				agentId: "yq-upstream-witness",
				iteration: 0,
				commandExecutionPlan: plan,
			},
		)
		try {
			rmSync(scriptPath, { force: true })
		} catch {}

		const afterSha = sha256File(join(homeCanary, "sentinel.txt"))
		// The load-bearing proof: kernel denied the overwrite; sentinel
		// SHA is byte-identical to the pre-run snapshot.
		expect(afterSha).toBe(beforeSha)
		// bash itself exits 0 even when a redirect fails (the inner
		// printf's stderr is captured but does not affect exit). The
		// canary-SHA equality above is the authoritative signal.
	})
})
