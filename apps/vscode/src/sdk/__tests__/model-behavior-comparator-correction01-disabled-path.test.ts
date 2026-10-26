/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-COMPARATOR-CORRECTION01 (C4)
 *
 * RED witness + GREEN gate for the DISABLED-PATH OVERHEAD correction.
 *
 * The requirement:
 *
 *   - With the model behavior trace DISABLED, the production configuration
 *     builder does NOT invoke `resolveInstalledBundleIdentity()` and
 *     performs NO synchronous Git discovery and NO synchronous bundle
 *     hashing.
 *   - With the trace ENABLED, the verified installed bundle identity is
 *     CACHED, and the recorder's source/build evidence is EXACTLY what the
 *     uncached resolver produced (the correction changes only WHEN the work
 *     happens, never WHAT is recorded).
 *
 * The witness drives the REAL production seams: the REAL
 * `buildSessionConfig()` and the REAL bundle identity resolver. The
 * resolver is observed through a spy that counts the underlying work, so
 * the assertion is about the ACTUAL synchronous git/hash work and not
 * about a re-implementation of it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { buildSessionConfig } from "../cline-session-factory"
import {
	_resetInstalledBundleIdentityCache,
	getInstalledBundleIdentityResolutionCount,
	resolveInstalledBundleIdentity,
} from "../extension-host-allocation-profiler-runtime"
import {
	_resetModelBehaviorTrace,
	getModelBehaviorTraceRecords,
	setModelBehaviorTraceEnabled,
} from "../model-behavior-trace-runtime"

const mocks = vi.hoisted(() => {
	return {
		stateManager: {
			getApiConfiguration: vi.fn(() => ({
				actModeApiProvider: "anthropic",
				actModeApiModelId: "claude-sonnet-4-6",
				apiKey: "test-key",
			})),
			getGlobalSettingsKey: vi.fn((key: string): boolean | undefined => {
				if (key === "subagentsEnabled" || key === "useAutoCondense") {
					return false
				}
				return undefined
			}),
			setGlobalStateBatch: vi.fn(),
			setGlobalState: vi.fn(),
			setSecret: vi.fn(),
		},
	}
})

vi.mock("@/core/storage/StateManager", () => ({
	StateManager: {
		get: () => mocks.stateManager,
	},
}))

vi.mock("@/services/logging/distinctId", () => ({
	getDistinctId: vi.fn(() => "test-distinct-id"),
}))

vi.mock("../provider-migration", () => ({
	getProviderSettingsManager: vi.fn(() => ({
		getFilePath: vi.fn(() => "/tmp/unused-provider-settings.json"),
		getLastUsedProviderSettings: vi.fn(() => undefined),
		getProviderSettings: vi.fn(() => undefined),
		saveProviderSettings: vi.fn(),
	})),
}))

vi.mock("@shared/services/Logger", () => ({
	Logger: {
		debug: vi.fn(),
		log: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}))

/**
 * The observed number of underlying bundle-identity resolutions.
 *
 * It is a counter rather than a function spy: the production code path
 * calls the local resolver directly, so an exported-function spy would not
 * observe it. The counter is incremented at the single place where the
 * SYNCHRONOUS git discovery and bundle hashing actually happen, so it
 * observes the REAL work.
 */
function resolutions(): number {
	return getInstalledBundleIdentityResolutionCount()
}

describe("model behavior comparator correction 01 — disabled path", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		_resetModelBehaviorTrace()
		_resetInstalledBundleIdentityCache()
	})

	afterEach(() => {
		_resetModelBehaviorTrace()
		_resetInstalledBundleIdentityCache()
		setModelBehaviorTraceEnabled(false)
	})

	it("C4a: with the trace DISABLED, the installed bundle identity is NEVER resolved", async () => {
		setModelBehaviorTraceEnabled(false)

		await buildSessionConfig({ cwd: "/tmp/workspace" })

		// The synchronous git discovery / bundle hashing must not have run.
		expect(resolutions()).toBe(0)
	})

	it("C4b: with the trace DISABLED, repeated session builds NEVER resolve the bundle identity", async () => {
		setModelBehaviorTraceEnabled(false)

		await buildSessionConfig({ cwd: "/tmp/workspace" })
		await buildSessionConfig({ cwd: "/tmp/workspace" })
		await buildSessionConfig({ cwd: "/tmp/workspace" })

		expect(resolutions()).toBe(0)
	})

	it("C4c: with the trace ENABLED, the installed bundle identity is resolved AT MOST ONCE (cached)", async () => {
		setModelBehaviorTraceEnabled(true)

		await buildSessionConfig({ cwd: "/tmp/workspace" })
		await buildSessionConfig({ cwd: "/tmp/workspace" })
		await buildSessionConfig({ cwd: "/tmp/workspace" })

		// The work happens — but only once for the whole process.
		expect(resolutions()).toBe(1)
	})

	it("C4d: the ENABLED recorder's source/build evidence is unchanged by the caching", async () => {
		setModelBehaviorTraceEnabled(true)

		await buildSessionConfig({ cwd: "/tmp/workspace" })

		const records = getModelBehaviorTraceRecords()
		const configRecord = records.find((record) => record.event === "model_config")
		expect(configRecord).toBeDefined()

		// The recorded evidence is EXACTLY what the canonical resolver
		// produces for the same bundle directory.
		const identity = resolveInstalledBundleIdentity(__dirname)
		expect(configRecord?.payload.sourceHead).toBe(
			identity.sourceHead === "unknown" ? "UNAVAILABLE_FROM_TRACE" : identity.sourceHead,
		)
		expect(configRecord?.payload.extensionBundleSha256).toBe(
			identity.extensionBundleSha256 === "unknown" ? "UNAVAILABLE_FROM_TRACE" : identity.extensionBundleSha256,
		)
	})

	it("C4e: with the trace DISABLED, NO configuration record is produced at all", async () => {
		setModelBehaviorTraceEnabled(false)

		await buildSessionConfig({ cwd: "/tmp/workspace" })

		expect(getModelBehaviorTraceRecords().some((record) => record.event === "model_config")).toBe(false)
	})
})
