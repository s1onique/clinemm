/**
 * ACT-CLINEMM-SEATBELT-YOLO-COMPLETION-AUTHORITY-IMPLEMENTATION01
 *
 * Production-seam integration test for the four-fact completion-authority
 * derivation. Drives `buildSessionConfig` end-to-end with mocked Seatbelt
 * helpers AND verifies the resulting CoreSessionConfig carries
 * `enableSubmitAndExit` matching the derivation:
 *
 *   explicitCompletionAuthority =
 *     interactive && isYoloSessionRequested(persisted, override)
 *                && SEATBELT_SELECTED && SEATBELT_AVAILABLE
 *
 * The override value is passed as `input.sessionAutoApprovalOverride`
 * (dependency injection — see SessionConfigInput). Per the frozen
 * contract:
 *   - persisted 5-gate-AND is sufficient (CAI-01A)
 *   - override === "all" alone is sufficient (CAI-01B)
 *   - mixed persisted + override !== "all" → OFF (CAI-02)
 *
 * The integration file's `.red.test.ts` suffix is historical evidence
 * that the suite was authored under TDD-RED discipline and that the
 * GREEN implementation landed in the same commit as the tests. The
 * file no longer contains failing tests; the suffix is kept for
 * forensic traceability of the bounded RED→GREEN correction cycle.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { AutoApprovalSettings } from "@shared/AutoApprovalSettings"
import { getSandboxBackend } from "@cline/core"

// vi.hoisted runs BEFORE module imports, so we cannot use the imported
// DEFAULT_AUTO_APPROVAL_SETTINGS here. We replicate the canonical default
// shape verbatim — mirrors apps/vscode/src/shared/AutoApprovalSettings.ts.
const hoisted = vi.hoisted(() => {
	const YOLO_PERSISTED_AUTO_APPROVAL: AutoApprovalSettings = {
		version: 1,
		enabled: true,
		favorites: [],
		maxRequests: 20,
		actions: {
			readFiles: true,
			readFilesExternally: true,
			editFiles: true,
			editFilesExternally: true,
			executeSafeCommands: true,
			executeAllCommands: true,
			useBrowser: true,
			useMcp: true,
		},
		enableNotifications: false,
	}
	const MANUAL_PERSISTED_AUTO_APPROVAL: AutoApprovalSettings = {
		version: 1,
		enabled: true,
		favorites: [],
		maxRequests: 20,
		actions: {
			readFiles: false,
			readFilesExternally: false,
			editFiles: false,
			editFilesExternally: false,
			executeSafeCommands: false,
			executeAllCommands: false,
			useBrowser: false,
			useMcp: false,
		},
		enableNotifications: false,
	}
	// MIXED_PERSISTED_AUTO_APPROVAL: persisted with editFiles=false so
	// isYoloSessionRequested(persisted, "none") returns false. This makes
	// the override="all" path the ONLY way to flip authority on — which
	// is the exact discriminator the CAI-01B production-seam test exercises.
	const MIXED_PERSISTED_AUTO_APPROVAL: AutoApprovalSettings = {
		version: 1,
		enabled: true,
		favorites: [],
		maxRequests: 20,
		actions: {
			readFiles: true,
			readFilesExternally: false,
			editFiles: false, // <- the one missing canonical gate
			editFilesExternally: false,
			executeSafeCommands: true,
			executeAllCommands: false,
			useBrowser: true,
			useMcp: true,
		},
		enableNotifications: false,
	}
	const FAKE_BACKEND = {
		id: "seatbelt-experimental",
		isAvailable: async () => true,
		prepare: async () => ({ profile: "(version 1) (allow default)" }),
	}
	const stateManagerMock = {
		getApiConfiguration: vi.fn(() => ({
			actModeApiProvider: "anthropic",
			actModeApiModelId: "claude-sonnet-4-6",
			apiKey: "test-key",
		})),
		getGlobalSettingsKey: vi.fn((key: string): unknown => {
			if (key === "subagentsEnabled" || key === "useAutoCondense") {
				return false
			}
			if (key === "autoApprovalSettings") {
				return YOLO_PERSISTED_AUTO_APPROVAL
			}
			return undefined
		}),
		setGlobalStateBatch: vi.fn(),
		setGlobalState: vi.fn(),
		setSecret: vi.fn(),
	}
	return {
		YOLO_PERSISTED_AUTO_APPROVAL,
		MIXED_PERSISTED_AUTO_APPROVAL,
		MANUAL_PERSISTED_AUTO_APPROVAL,
		FAKE_BACKEND,
		stateManagerMock,
	}
})

vi.mock("../sandbox-policy", () => ({
	resolveExperimentalSandboxMode: vi.fn(),
}))

vi.mock("@cline/core", async () => {
	const actual = await vi.importActual<typeof import("@cline/core")>("@cline/core")
	return { ...actual, getSandboxBackend: vi.fn() }
})

vi.mock("@/core/storage/StateManager", () => ({
	StateManager: { get: () => hoisted.stateManagerMock },
}))

vi.mock("@/services/logging/distinctId", () => ({
	getDistinctId: () => "test-distinct-id",
}))

vi.mock("../provider-migration", () => ({
	getProviderSettingsManager: () => ({
		getFilePath: () => "/tmp/test/providers.json",
		getLastUsedProviderSettings: () => undefined,
		getProviderSettings: () => undefined,
	}),
}))

vi.mock("@shared/services/Logger", () => ({
	Logger: { debug: vi.fn(), log: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { buildSessionConfig } from "../cline-session-factory"
import { resolveExperimentalSandboxMode } from "../sandbox-policy"

const mockResolveMode = vi.mocked(resolveExperimentalSandboxMode)
const mockGetSandboxBackend = vi.mocked(getSandboxBackend)
const { YOLO_PERSISTED_AUTO_APPROVAL, MIXED_PERSISTED_AUTO_APPROVAL, MANUAL_PERSISTED_AUTO_APPROVAL, FAKE_BACKEND, stateManagerMock } = hoisted

beforeEach(() => {
	vi.clearAllMocks()
	stateManagerMock.getApiConfiguration.mockReturnValue({
		actModeApiProvider: "anthropic",
		actModeApiModelId: "claude-sonnet-4-6",
		apiKey: "test-key",
	})
	stateManagerMock.getGlobalSettingsKey.mockImplementation((key: string) => {
		if (key === "subagentsEnabled" || key === "useAutoCondense") {
			return false
		}
		if (key === "autoApprovalSettings") {
			return YOLO_PERSISTED_AUTO_APPROVAL
		}
		return undefined
	})
})

afterEach(() => {
	mockResolveMode.mockReset()
	mockGetSandboxBackend.mockReset()
})

describe("ACT-CLINEMM-SEATBELT-YOLO-COMPLETION-AUTHORITY-IMPLEMENTATION01 / buildSessionConfig integration", () => {
	it("CAI (c.1) CAI-01A: persisted YOLO + Seatbelt selected/available + mode=act → enableSubmitAndExit=true", async () => {
		mockResolveMode.mockReturnValue("seatbelt-experimental")
		mockGetSandboxBackend.mockResolvedValue(FAKE_BACKEND as unknown as Awaited<ReturnType<typeof getSandboxBackend>>)
		const config = await buildSessionConfig({ cwd: "/tmp/workspace", mode: "act" })
		expect(config.mode).toBe("act")
		expect(config.enableSubmitAndExit).toBe(true)
	})

	it("CAI (c.2) CAI-02: manual persisted + Seatbelt selected/available → enableSubmitAndExit=false (conservation)", async () => {
		mockResolveMode.mockReturnValue("seatbelt-experimental")
		mockGetSandboxBackend.mockResolvedValue(FAKE_BACKEND as unknown as Awaited<ReturnType<typeof getSandboxBackend>>)
		stateManagerMock.getGlobalSettingsKey.mockImplementation((key: string) => {
			if (key === "subagentsEnabled" || key === "useAutoCondense") {
				return false
			}
			if (key === "autoApprovalSettings") {
				return MANUAL_PERSISTED_AUTO_APPROVAL
			}
			return undefined
		})
		const config = await buildSessionConfig({ cwd: "/tmp/workspace", mode: "act" })
		expect(config.mode).toBe("act")
		expect(config.enableSubmitAndExit).toBe(false)
	})

	it("CAI (c.3) CAI-13A: persisted YOLO + Seatbelt NOT selected → enableSubmitAndExit=false", async () => {
		mockResolveMode.mockReturnValue(undefined)
		mockGetSandboxBackend.mockResolvedValue(undefined)
		const config = await buildSessionConfig({ cwd: "/tmp/workspace", mode: "act" })
		expect(config.mode).toBe("act")
		expect(config.enableSubmitAndExit).toBe(false)
	})

	it("CAI (c.4) CAI-13B (LOAD-BEARING): persisted YOLO + Seatbelt SELECTED + substrate broken → enableSubmitAndExit=false", async () => {
		mockResolveMode.mockReturnValue("seatbelt-experimental")
		// SEATBELT_SELECTED is true, but getSandboxBackend — the cached
		// availability probe — returns undefined. This is the substrate-broken
		// case the prior plan missed. Authority MUST be OFF.
		mockGetSandboxBackend.mockResolvedValue(undefined)
		const config = await buildSessionConfig({ cwd: "/tmp/workspace", mode: "act" })
		expect(config.mode).toBe("act")
		expect(config.enableSubmitAndExit).toBe(false)
	})

	it("CAI (c.5) CAI-11: explicit completion authority does NOT flip config.mode away from 'act'", async () => {
		// The plan forbids flipping config.mode to "yolo". The capability
		// is an independent axis on the CoreSessionConfig.
		mockResolveMode.mockReturnValue("seatbelt-experimental")
		mockGetSandboxBackend.mockResolvedValue(FAKE_BACKEND as unknown as Awaited<ReturnType<typeof getSandboxBackend>>)
		const config = await buildSessionConfig({ cwd: "/tmp/workspace", mode: "act" })
		expect(config.mode).toBe("act")
		expect(config.mode).not.toBe("yolo")
	})

	it("CAI (c.6) Plan-mode conservation: even with all Seatbelt facts true + YOLO persisted, mode=plan → enableSubmitAndExit=false", async () => {
		// The explicit completion authority is for autonomous Act runs
		// only. Plan mode keeps authority OFF regardless of Seatbelt facts.
		mockResolveMode.mockReturnValue("seatbelt-experimental")
		mockGetSandboxBackend.mockResolvedValue(FAKE_BACKEND as unknown as Awaited<ReturnType<typeof getSandboxBackend>>)
		const config = await buildSessionConfig({ cwd: "/tmp/workspace", mode: "plan" })
		expect(config.mode).toBe("plan")
		expect(config.enableSubmitAndExit).toBe(false)
	})

	it("CAI (c.7) CAI-01B PRODUCTION SEAM: mixed persisted + sessionAutoApprovalOverride='all' + Seatbelt → enableSubmitAndExit=true", async () => {
		// Mixed persisted (NOT all-5-true) — only the override path
		// can flip authority ON. This is the user's "ALL — this task"
		// button: the click sets the override in the canonical
		// SessionAutoApprovalStore, SdkTaskStartCoordinator.initTask
		// peeks it (consumePendingOverride happens later at session-id
		// allocation), and the buildSessionConfig seam receives it via
		// dependency injection as input.sessionAutoApprovalOverride.
		mockResolveMode.mockReturnValue("seatbelt-experimental")
		mockGetSandboxBackend.mockResolvedValue(FAKE_BACKEND as unknown as Awaited<ReturnType<typeof getSandboxBackend>>)
		stateManagerMock.getGlobalSettingsKey.mockImplementation((key: string) => {
			if (key === "subagentsEnabled" || key === "useAutoCondense") {
				return false
			}
			if (key === "autoApprovalSettings") {
				return MIXED_PERSISTED_AUTO_APPROVAL
			}
			return undefined
		})
		const config = await buildSessionConfig({
			cwd: "/tmp/workspace",
			mode: "act",
			sessionAutoApprovalOverride: "all",
		})
		expect(config.mode).toBe("act")
		expect(config.enableSubmitAndExit).toBe(true)
	})

	it("CAI (c.8) CAI-01B conservation pair: same mixed persisted + override='none' → enableSubmitAndExit=false", async () => {
		// Conservation pair: the same persisted shape that flips ON with
		// override='all' MUST stay OFF with override='none'. This pins
		// the override path's selectivity — no implicit carry-over.
		mockResolveMode.mockReturnValue("seatbelt-experimental")
		mockGetSandboxBackend.mockResolvedValue(FAKE_BACKEND as unknown as Awaited<ReturnType<typeof getSandboxBackend>>)
		stateManagerMock.getGlobalSettingsKey.mockImplementation((key: string) => {
			if (key === "subagentsEnabled" || key === "useAutoCondense") {
				return false
			}
			if (key === "autoApprovalSettings") {
				return MIXED_PERSISTED_AUTO_APPROVAL
			}
			return undefined
		})
		const config = await buildSessionConfig({
			cwd: "/tmp/workspace",
			mode: "act",
			sessionAutoApprovalOverride: "none",
		})
		expect(config.mode).toBe("act")
		expect(config.enableSubmitAndExit).toBe(false)
	})
})

// ---------------------------------------------------------------------------
// ACT-CLINEMM-SEATBELT-YOLO-COMPLETION-AUTHORITY-IMPLEMENTATION01
//
// Production-seam load-bearing integration at the full VS Code → runtime seam.
//
// Drives:
//   buildSessionConfig → CoreSessionConfig (with enableSubmitAndExit set)
//   new DefaultRuntimeBuilder().build({ config, toolExecutors: { submit } })
//     → BuiltRuntime (final tools + completionPolicy)
//
// Asserts the load-bearing RED/GREEN contract:
//   submit_and_exit is in finalTools
//   completionPolicy.requireCompletionTool === true
//
// This is the proof that the VS Code host's enableSubmitAndExit flag
// actually flows into runtime tool registration + completion policy —
// not just config-only wiring.
//
// IMPLEMENTATION01 §2 P1 (reviewer): the integration RED must reproduce
// the full VS Code → runtime registration composition, not stop at
// config.enableSubmitAndExit alone.
// ---------------------------------------------------------------------------

import { DefaultRuntimeBuilder } from "@cline/core"

describe("ACT-CLINEMM-SEATBELT-YOLO-COMPLETION-AUTHORITY-IMPLEMENTATION01 / load-bearing real-runtime seam", () => {
	const STUB_SUBMIT_EXECUTOR = async () => "stubbed submit result"

	it("CAI (d.1) CAI-13C load-bearing: buildSessionConfig → DefaultRuntimeBuilder → submit_and_exit registered + completionPolicy.requireCompletionTool=true", async () => {
		mockResolveMode.mockReturnValue("seatbelt-experimental")
		mockGetSandboxBackend.mockResolvedValue(FAKE_BACKEND as unknown as Awaited<ReturnType<typeof getSandboxBackend>>)

		// Step 1: buildSessionConfig produces config.enableSubmitAndExit=true.
		const config = await buildSessionConfig({ cwd: "/tmp/workspace", mode: "act" })
		expect(config.enableSubmitAndExit).toBe(true)

		// Step 2: DefaultRuntimeBuilder is the real production seam that
		// turns the config into the actual tool array + completionPolicy.
		// We supply a stub submit executor (PASSIVE — no real side effects).
		const runtime = await new DefaultRuntimeBuilder().build({
			config,
			toolExecutors: { submit: STUB_SUBMIT_EXECUTOR },
		})

		const finalToolNames = runtime.tools.map((tool) => tool.name)
		expect(finalToolNames).toContain("submit_and_exit")
		expect(runtime.completionPolicy?.requireCompletionTool).toBe(true)

		// The submit_and_exit tool must carry lifecycle.completesRun=true
		// (intrinsic to the SDK's tool definition, but asserted here to
		// pin the contract end-to-end).
		const submitTool = runtime.tools.find((tool) => tool.name === "submit_and_exit")
		expect(submitTool?.lifecycle?.completesRun).toBe(true)
	})

	it("CAI (d.2) CAI-13B conservation: substrate broken → submit_and_exit NOT registered + completionPolicy undefined", async () => {
		mockResolveMode.mockReturnValue("seatbelt-experimental")
		mockGetSandboxBackend.mockResolvedValue(undefined)

		const config = await buildSessionConfig({ cwd: "/tmp/workspace", mode: "act" })
		expect(config.enableSubmitAndExit).toBe(false)

		const runtime = await new DefaultRuntimeBuilder().build({
			config,
			toolExecutors: { submit: STUB_SUBMIT_EXECUTOR },
		})

		const finalToolNames = runtime.tools.map((tool) => tool.name)
		expect(finalToolNames).not.toContain("submit_and_exit")
		expect(runtime.completionPolicy?.requireCompletionTool).toBeFalsy()
	})

	it("CAI (d.3) manual persisted → submit_and_exit NOT registered even when Seatbelt selected/available", async () => {
		// Conservation: ordinary manual Act users do not suddenly gain
		// completion authority when Seatbelt is configured.
		mockResolveMode.mockReturnValue("seatbelt-experimental")
		mockGetSandboxBackend.mockResolvedValue(FAKE_BACKEND as unknown as Awaited<ReturnType<typeof getSandboxBackend>>)
		stateManagerMock.getGlobalSettingsKey.mockImplementation((key: string) => {
			if (key === "subagentsEnabled" || key === "useAutoCondense") {
				return false
			}
			if (key === "autoApprovalSettings") {
				return MANUAL_PERSISTED_AUTO_APPROVAL
			}
			return undefined
		})

		const config = await buildSessionConfig({ cwd: "/tmp/workspace", mode: "act" })
		expect(config.enableSubmitAndExit).toBe(false)

		const runtime = await new DefaultRuntimeBuilder().build({
			config,
			toolExecutors: { submit: STUB_SUBMIT_EXECUTOR },
		})

		const finalToolNames = runtime.tools.map((tool) => tool.name)
		expect(finalToolNames).not.toContain("submit_and_exit")
		expect(runtime.completionPolicy?.requireCompletionTool).toBeFalsy()
	})

	it("CAI (d.4) CAI-01B production seam (load-bearing): mixed persisted + override='all' → submit_and_exit registered + requireCompletionTool=true", async () => {
		// Production-seam proof that the user's "ALL — this task" path
		// (mixed persisted + override='all') reaches the full runtime
		// registration, NOT just config-only wiring. Persisted alone is
		// insufficient here (editFiles=false in MIXED), so this test
		// cannot pass via the persisted path.
		mockResolveMode.mockReturnValue("seatbelt-experimental")
		mockGetSandboxBackend.mockResolvedValue(FAKE_BACKEND as unknown as Awaited<ReturnType<typeof getSandboxBackend>>)
		stateManagerMock.getGlobalSettingsKey.mockImplementation((key: string) => {
			if (key === "subagentsEnabled" || key === "useAutoCondense") {
				return false
			}
			if (key === "autoApprovalSettings") {
				return MIXED_PERSISTED_AUTO_APPROVAL
			}
			return undefined
		})

		const config = await buildSessionConfig({
			cwd: "/tmp/workspace",
			mode: "act",
			sessionAutoApprovalOverride: "all",
		})
		expect(config.enableSubmitAndExit).toBe(true)

		const runtime = await new DefaultRuntimeBuilder().build({
			config,
			toolExecutors: { submit: STUB_SUBMIT_EXECUTOR },
		})

		const finalToolNames = runtime.tools.map((tool) => tool.name)
		expect(finalToolNames).toContain("submit_and_exit")
		expect(runtime.completionPolicy?.requireCompletionTool).toBe(true)
	})

	it("CAI (d.5) CAI-01B conservation pair (load-bearing): same mixed persisted + override='none' → submit_and_exit NOT registered", async () => {
		// Conservation pair: same persisted shape that flips ON with
		// override='all' (d.4) MUST stay OFF with override='none'.
		mockResolveMode.mockReturnValue("seatbelt-experimental")
		mockGetSandboxBackend.mockResolvedValue(FAKE_BACKEND as unknown as Awaited<ReturnType<typeof getSandboxBackend>>)
		stateManagerMock.getGlobalSettingsKey.mockImplementation((key: string) => {
			if (key === "subagentsEnabled" || key === "useAutoCondense") {
				return false
			}
			if (key === "autoApprovalSettings") {
				return MIXED_PERSISTED_AUTO_APPROVAL
			}
			return undefined
		})

		const config = await buildSessionConfig({
			cwd: "/tmp/workspace",
			mode: "act",
			sessionAutoApprovalOverride: "none",
		})
		expect(config.enableSubmitAndExit).toBe(false)

		const runtime = await new DefaultRuntimeBuilder().build({
			config,
			toolExecutors: { submit: STUB_SUBMIT_EXECUTOR },
		})

		const finalToolNames = runtime.tools.map((tool) => tool.name)
		expect(finalToolNames).not.toContain("submit_and_exit")
		expect(runtime.completionPolicy?.requireCompletionTool).toBeFalsy()
	})
})
