import { realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { commandHostAuthorization, DEFAULT_COMMAND_HOST_ALLOW_RULES } from "@cline/core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CommandJobManager } from "../command-job-manager"
import { defaultSandboxBackendResolver } from "../sandbox-policy"
import { evaluateCommandToolApprovalWithPlan } from "../sdk-tool-policies"
import { createVscodeRunCommandsTool } from "../vscode-run-commands-tool"

const mocks = vi.hoisted(() => ({
	getGlobalSettingsKey: vi.fn(() => "default"),
}))

vi.mock("@/core/storage/StateManager", () => ({
	StateManager: {
		get: () => ({ getGlobalSettingsKey: mocks.getGlobalSettingsKey }),
	},
}))

vi.mock("@services/telemetry", () => ({
	TerminalUserInterventionAction: { PROCESS_WHILE_RUNNING: "process_while_running" },
	telemetryService: {
		captureTerminalUserIntervention: () => {},
		captureTerminalExecution: () => {},
	},
}))

const mktempPath = "/usr/bin/mktemp"
const darwinUserTempDir = "/var/folders/0g/mpt_55f524ndzxymkp20wjfc0000gn/T/"

const darwinHost = process.platform === "darwin"
const canonicalDarwinRoot = (() => {
	try {
		return realpathSync(darwinUserTempDir)
	} catch {
		return undefined
	}
})()

beforeEach(() => {
	process.env.CLINEMM_EXPERIMENTAL_SANDBOX = "seatbelt"
})

afterEach(() => {
	process.env.CLINEMM_EXPERIMENTAL_SANDBOX = ""
})

async function isSeatbeltAvailable(): Promise<boolean> {
	const backend = await defaultSandboxBackendResolver("seatbelt-experimental")
	return backend !== undefined
}

function darwinHostAuthorization() {
	return commandHostAuthorization({
		mode: "safe-only",
		explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
		workspaceRoots: [],
		tempAuthorityEvidence: {
			platform: "darwin",
			executablePath: mktempPath,
			executableRealpath: mktempPath,
			darwinUserTempRoot: darwinUserTempDir,
			canonicalDarwinUserTempRoot: canonicalDarwinRoot!,
		},
	})
}

describe("ACT-CLINEMM-MACOS-SEATBELT-DARWIN-MKTEMP-CAPABILITY01-C2 real upstream GREEN", () => {
	it("real authorization -> real plan entry -> tool.execute -> Seatbelt -> /usr/bin/mktemp -> exit 0", async () => {
		if (!darwinHost || !canonicalDarwinRoot) {
			console.warn("[c2-green] skipping outside darwin")
			expect(true).toBe(true)
			return
		}
		if (!(await isSeatbeltAvailable())) {
			console.warn("[c2-green] skipping: Seatbelt unavailable")
			expect(true).toBe(true)
			return
		}

		// Step 1: REAL authorization. The host authorization
		// carries the darwin mktemp evidence. The plan builder
		// (CORRECTION03 production grant seam) must attach
		// FilesystemCreateOnlyCapability to the matching entry.
		const hostAuth = darwinHostAuthorization()
		const approval = evaluateCommandToolApprovalWithPlan(mktempPath, hostAuth)
		expect(approval.decision.kind).toBe("allow")
		expect(approval.executionPlan).toBeDefined()
		expect(approval.executionPlan?.commands[0]?.executionCapability).toEqual({
			kind: "filesystem-create-only",
			roots: [canonicalDarwinRoot],
		})

		// Step 2: REAL tool.execute. This drives the
		// executor-boundary stamping (which carries the
		// capability forward) and then manager.start which
		// routes it to the Seatbelt backend.
		const manager = new CommandJobManager({
			sandboxBackendResolver: defaultSandboxBackendResolver,
			experimentalSandboxWorkspaceRoots: [],
		})
		const tool = createVscodeRunCommandsTool({
			cwd: realpathSync(tmpdir()),
			getTerminalManager: () => {
				throw new Error("foreground path not used in c2-green")
			},
			commandJobManager: manager,
			vscodeTerminalExecutionMode: "backgroundExec",
			backgroundWaitBudgetMs: 5_000,
			backgroundExecutionDeadlineMs: 10_000,
		}) as unknown as { execute: (i: unknown, c: unknown) => Promise<unknown> }

		const results = (await tool.execute(
			{ commands: [mktempPath] },
			// The real production call site attaches the
			// authorization's executionPlan to the context.
			// The SdkController stamps it via the policy
			// callback; we do the same here.
			{
				agentId: "c2-green-real",
				iteration: 0,
				commandExecutionPlan: approval.executionPlan,
			},
		)) as Array<{
			success?: boolean
			result?: string
			error?: string
		}>

		expect(results.length).toBe(1)
		const out = results[0]!
		expect(out.success).toBe(true)
		const stdout = (out.result ?? "").trim()
		expect(stdout).toMatch(/^\/var\/folders\//)
		const real = realpathSync(stdout)
		expect(real.startsWith(canonicalDarwinRoot)).toBe(true)
		try {
			rmSync(stdout, { force: true })
		} catch {}
	})

	it("real mixed [mktemp, pwd] authorization -> entry[0] gets cap, entry[1] does NOT", async () => {
		if (!darwinHost || !canonicalDarwinRoot) {
			expect(true).toBe(true)
			return
		}
		if (!(await isSeatbeltAvailable())) {
			expect(true).toBe(true)
			return
		}

		// Real authorization for the mixed input.
		const hostAuth = darwinHostAuthorization()
		const approval = evaluateCommandToolApprovalWithPlan([mktempPath, "pwd"], hostAuth)
		expect(approval.executionPlan?.commands[0]?.executionCapability).toEqual({
			kind: "filesystem-create-only",
			roots: [canonicalDarwinRoot],
		})
		expect(approval.executionPlan?.commands[1]?.executionCapability).toBeUndefined()
	})
})
