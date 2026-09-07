// ACT-CLINEMM-MODEL-PROFILES-FIRST-RUN-BOOTSTRAP01 / B3
//
// MP-B3 RED -> GREEN witness: the bootstrap RPC is "visible to the
// user" in every status. Every status the typed
// BootstrapModelProfileResult can return reaches the webview as a
// faithful BootstrapModelProfileResponse - no status is silently
// swallowed, no message is suppressed, no profileId/instanceId is
// lost, and `CREATED_BINDING_FAILED` is visibly a success-with-warning
// (profileId+instanceId populated, message contains the binding
// failure detail) rather than a generic failure.
//
// B3 is the "transport-to-user semantics" closure that the
// B2+CORRECTION02 stack was missing. Previous ACT chunks proved the
// BACKEND returns the correct typed envelope; this witness proves
// the HANDLER translates that envelope into a
// `BootstrapModelProfileResponse` the webview can render without
// losing information.
//
// Production seams driven:
//   bootstrapModelProfileFromCurrentConfiguration (primitive) = REAL
//   bootstrapModelProfileFromCurrentConfiguration (handler)   = REAL
//   BootstrapModelProfileResponse (proto envelope)            = REAL
//   resolveApiKey / resolveModelId / resolveBaseUrl          = REAL
//   InstancesStore.upsert / ProfilesStore.upsert             = REAL
//   StateManager (initialized) = REAL (for the durability path)
//
// Collaborators stubbed:
//   modelProfilesOwner       = SYNTHETIC (in-memory stubs)
//   getCurrentTaskHistoryItem / writeTaskHistoryItem / postStateToWebview = SYNTHETIC
//
// Run via:
//   cd apps/vscode && bunx vitest run --config vitest.config.ts \
//     src/core/controller/state/bootstrap-failure-visible.mpfrb01.test.ts

import { mkdtempSync } from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { StateManager } from "@/core/storage/StateManager"
import { InstancesStore } from "@/sdk/instance-store/instances-store"
import { ProfilesStore } from "@/sdk/profile-store/profiles-store"
import { BootstrapModelProfileRequest } from "@/shared/proto/cline/state"
import { nameFor } from "@/shared/storage/instance-secret"
import { createStorageContext } from "@/shared/storage/storage-context"
import { bootstrapModelProfileFromCurrentConfiguration } from "./bootstrapModelProfileFromCurrentConfiguration"

// StateManager.initialize() calls initializeDistinctId(), which
// reads HostProvider.get(). Mock both the distinctId module and
// HostProvider so initialization succeeds without a real VS Code
// host (this test runs in vitest, not in the extension host).
vi.mock("@/services/logging/distinctId", () => ({
	initializeDistinctId: vi.fn(async () => undefined),
	getDistinctId: vi.fn(() => undefined),
	getDeviceId: vi.fn(() => undefined),
	setDistinctId: vi.fn(() => undefined),
}))
vi.mock("@/hosts/host-provider", () => ({
	HostProvider: {
		get: () => ({
			getEnv: () => "test",
		}),
		initialize: vi.fn(),
	},
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface FakeOwnerOpts {
	getCurrentTaskHistoryItem?: () => unknown
	writeTaskHistoryItem?: (item: unknown) => Promise<void>
	postStateToWebview?: () => Promise<void>
	profilesStore?: ProfilesStore
	instancesStore?: InstancesStore
}

interface FakeControllerOpts extends FakeOwnerOpts {
	ownerMissing?: boolean
}

function makeFakeController(
	dataDir: string,
	opts: FakeControllerOpts = {},
): {
	controller: { modelProfilesOwner: unknown }
	instancesStore: InstancesStore
	profilesStore: ProfilesStore
} {
	// Each call gets its OWN subdirectory so stores are isolated
	// per test. The primitive commits to instancesStore / profilesStore
	// (which live on the controller), so cross-test state would
	// otherwise pollute the conservation assertions.
	const testDataDir = mkdtempSync(path.join(dataDir, "t-"))
	const instancesStore = opts.instancesStore ?? new InstancesStore({ filePath: path.join(testDataDir, "instances.json") })
	const profilesStore = opts.profilesStore ?? new ProfilesStore({ filePath: path.join(testDataDir, "profiles.json") })

	const owner = opts.ownerMissing
		? undefined
		: {
				instancesStore,
				profilesStore,
				getMode: () => "act" as const,
				getCurrentTaskHistoryItem: opts.getCurrentTaskHistoryItem ?? (() => undefined),
				writeTaskHistoryItem: opts.writeTaskHistoryItem ?? (async () => undefined),
				postStateToWebview: opts.postStateToWebview ?? (async () => undefined),
			}

	const controller = { modelProfilesOwner: owner }
	return { controller, instancesStore, profilesStore }
}

function makeCurrentAnthropicConfig(): Record<string, unknown> {
	return {
		actModeApiProvider: "anthropic",
		actModeApiModelId: "claude-sonnet-4-6",
		apiKey: "sk-ant-physical-key-b3-XXXXXXXXXXXX",
	}
}

function makeCurrentOpenAiConfig(headers: unknown): Record<string, unknown> {
	return {
		actModeApiProvider: "openai",
		// Per PROVIDER_MODEL_ID_MAP in cline-session-factory.ts,
		// the OpenAI-Compatible provider's act-mode model id
		// field is `actModeOpenAiModelId` (NOT `actModeApiModelId`).
		actModeOpenAiModelId: "gpt-4o",
		apiKey: "sk-openai-XXXXX",
		openAiApiKey: "sk-openai-XXXXX",
		openAiHeaders: headers,
	}
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

/**
 * Every ApiConfiguration field the bootstrap primitive reads.
 * Setting each to `undefined` in `setApiConfiguration` is a no-op
 * (the function skips undefined entries), so we explicitly null
 * each one through `setGlobalStateBatch` / `setSecretsBatch` to
 * guarantee a clean baseline between tests.
 */
const ALL_BOOTSTRAP_FIELDS = [
	// settings fields (read via getApiConfiguration)
	"planModeApiProvider",
	"actModeApiProvider",
	"planModeApiModelId",
	"actModeApiModelId",
	"planModeOpenRouterModelId",
	"actModeOpenRouterModelId",
	"planModeOpenAiModelId",
	"actModeOpenAiModelId",
	"planModeOpenAiNativeModelId",
	"actModeOpenAiNativeModelId",
	"planModeOllamaModelId",
	"actModeOllamaModelId",
	"planModeLmStudioModelId",
	"actModeLmStudioModelId",
	"planModeLiteLlmModelId",
	"actModeLiteLlmModelId",
	"planModeRequestyModelId",
	"actModeRequestyModelId",
	"planModeClineModelId",
	"actModeClineModelId",
	"planModeClinePassModelId",
	"actModeClinePassModelId",
	"openAiBaseUrl",
	"anthropicBaseUrl",
	"lmStudioBaseUrl",
	"ollamaBaseUrl",
	"geminiBaseUrl",
	"requestyBaseUrl",
	"liteLlmBaseUrl",
	"ocaBaseUrl",
	"aihubmixBaseUrl",
	"difyBaseUrl",
	"asksageApiUrl",
	// settings field for openai headers (string-serialized)
	"openAiHeaders",
] as const

const ALL_BOOTSTRAP_SECRET_FIELDS = [
	"apiKey",
	"openRouterApiKey",
	"openAiApiKey",
	"openAiNativeApiKey",
	"awsBedrockApiKey",
	"geminiApiKey",
	"deepSeekApiKey",
	"clineApiKey",
	"ollamaApiKey",
	"requestyApiKey",
	"togetherApiKey",
	"fireworksApiKey",
	"qwenApiKey",
	"doubaoApiKey",
	"mistralApiKey",
	"liteLlmApiKey",
	"asksageApiKey",
	"xaiApiKey",
	"moonshotApiKey",
	"zaiApiKey",
	"huggingFaceApiKey",
	"nebiusApiKey",
	"sambanovaApiKey",
	"cerebrasApiKey",
	"groqApiKey",
	"basetenApiKey",
	"difyApiKey",
	"aihubmixApiKey",
	"ocaApiKey",
] as const

function clearBootstrapConfig(): void {
	const sm = StateManager.get()
	// Settings: clear via setGlobalStateBatch (the underlying
	// cache update writes `undefined` to the cache, which the
	// subsequent setApiConfiguration sees as "not present").
	const settingsClear = Object.fromEntries(ALL_BOOTSTRAP_FIELDS.map((k) => [k, undefined]))
	;(sm as unknown as { setGlobalStateBatch: (u: object) => void }).setGlobalStateBatch(settingsClear)
	// Secrets: clear via setSecretsBatch. `apiKey` is a known
	// secret key in the legacy ApiConfiguration; it lives in the
	// secrets store.
	const secretsClear = Object.fromEntries(ALL_BOOTSTRAP_SECRET_FIELDS.map((k) => [k, undefined]))
	;(sm as unknown as { setSecretsBatch: (u: object) => void }).setSecretsBatch(secretsClear)
}

describe("ACT-CLINEMM-MODEL-PROFILES-FIRST-RUN-BOOTSTRAP01 / B3 transport-to-user semantics", () => {
	let parentDir: string
	let clineDir: string
	let originalClineDir: string | undefined

	beforeAll(async () => {
		parentDir = await fs.mkdtemp(path.join(os.tmpdir(), "mpfrb01-b3-"))
		originalClineDir = process.env.CLINE_DIR
	})

	beforeEach(async () => {
		// Fresh clineDir + a fresh StateManager singleton per
		// test. We clear the singleton by reassigning the static
		// `instance` field (StateManager.dispose() doesn't expose
		// a public path to fully reset for re-initialization).
		clineDir = await fs.mkdtemp(path.join(parentDir, "test-"))
		process.env.CLINE_DIR = clineDir
		;(StateManager as unknown as { instance: unknown }).instance = null
		await StateManager.initialize(createStorageContext({ clineDir, workspacePath: clineDir }))
	})

	afterEach(async () => {
		await StateManager.get().flushPendingState()
	})

	afterAll(async () => {
		if (originalClineDir === undefined) {
			delete process.env.CLINE_DIR
		} else {
			process.env.CLINE_DIR = originalClineDir
		}
		await fs.rm(parentDir, { recursive: true, force: true })
	})

	// -------------------------------------------------------------------------
	// 1. CREATED -> handler success envelope (no message, populated ids)
	// -------------------------------------------------------------------------

	it("MPFRB01_B3_CREATED: success returns status=CREATED, populated ids, EMPTY message", async () => {
		await StateManager.get().setApiConfiguration(makeCurrentAnthropicConfig() as never)
		const { controller } = makeFakeController(clineDir)

		const response = await bootstrapModelProfileFromCurrentConfiguration(
			controller as never,
			BootstrapModelProfileRequest.create({ name: "My first" }),
		)

		expect(response.status).toBe("CREATED")
		expect(response.profileId).toMatch(/^prof-/)
		expect(response.instanceId).toMatch(/^inst-/)
		// CRITICAL B3 invariant: CREATED has NO message - the
		// webview should render a clean success toast, not a
		// warning banner. If this assertion fails, the handler
		// is leaking diagnostic text into success envelopes.
		expect(response.message).toBe("")
	})

	// -------------------------------------------------------------------------
	// 2. CREATED_BINDING_FAILED -> success-with-warning (ids + message)
	// -------------------------------------------------------------------------

	it("MPFRB01_B3_CREATED_BINDING_FAILED: post-commit binding failure is visibly a success-with-warning", async () => {
		await StateManager.get().setApiConfiguration(makeCurrentAnthropicConfig() as never)

		// Pre-existing task that will fail the post-commit binding write.
		const taskHistoryItem = { id: "task-b3-cbf", activeProfileId: undefined }
		const writeTaskHistoryItem = vi.fn(async () => {
			throw new Error("simulated binding write failure")
		})

		const { controller } = makeFakeController(clineDir, {
			getCurrentTaskHistoryItem: () => taskHistoryItem,
			writeTaskHistoryItem,
		})

		const response = await bootstrapModelProfileFromCurrentConfiguration(
			controller as never,
			BootstrapModelProfileRequest.create({ name: "My first" }),
		)

		expect(response.status).toBe("CREATED_BINDING_FAILED")
		expect(response.profileId).toMatch(/^prof-/)
		expect(response.instanceId).toMatch(/^inst-/)
		expect(response.message).toMatch(/active task could not be bound/i)
		expect(response.message).toContain("simulated binding write failure")
		expect(writeTaskHistoryItem).toHaveBeenCalledTimes(1)
	})

	// -------------------------------------------------------------------------
	// 3. NO_CURRENT_CONFIGURATION -> empty ids, mode-specific message
	// -------------------------------------------------------------------------

	it("MPFRB01_B3_NO_CURRENT_CONFIGURATION: empty providerId in active mode -> empty ids, mode-tagged message", async () => {
		// To exercise the NO_CURRENT_CONFIGURATION branch we must
		// bypass the StateManager default layer (which defaults
		// actModeApiProvider to "openrouter"). We do that by
		// directly nullifying the cache values after the
		// StateManager has been initialized.
		const sm = StateManager.get() as unknown as {
			globalStateCache: Record<string, unknown>
			remoteConfigCache: Record<string, unknown>
			sessionOverrideCache: Record<string, unknown>
			taskStateCache: Record<string, unknown>
		}
		sm.globalStateCache.actModeApiProvider = undefined
		sm.globalStateCache.planModeApiProvider = undefined
		sm.remoteConfigCache.actModeApiProvider = undefined
		sm.remoteConfigCache.planModeApiProvider = undefined
		sm.sessionOverrideCache.actModeApiProvider = undefined
		sm.sessionOverrideCache.planModeApiProvider = undefined
		sm.taskStateCache.actModeApiProvider = undefined
		sm.taskStateCache.planModeApiProvider = undefined
		const { controller } = makeFakeController(clineDir)

		const response = await bootstrapModelProfileFromCurrentConfiguration(
			controller as never,
			BootstrapModelProfileRequest.create({ name: "My first" }),
		)

		expect(response.status).toBe("NO_CURRENT_CONFIGURATION")
		expect(response.profileId).toBe("")
		expect(response.instanceId).toBe("")
		expect(response.message).toMatch(/No provider configured for act mode/)
		expect(response.message).toMatch(/Set one in Settings/i)
	})

	// -------------------------------------------------------------------------
	// 4. CURRENT_CONFIGURATION_UNSUPPORTED -> provider-named message
	// -------------------------------------------------------------------------

	it("MPFRB01_B3_CURRENT_CONFIGURATION_UNSUPPORTED: provider outside BOOTSTRAP_COVERAGE -> empty ids, named message", async () => {
		// "openrouter" is in PROVIDER_API_KEY_MAP but NOT in
		// BOOTSTRAP_COVERAGE - perfect test of the unsupported branch.
		await StateManager.get().setApiConfiguration({
			actModeApiProvider: "openrouter",
			actModeOpenRouterModelId: "anthropic/claude-3.5-sonnet",
			openRouterApiKey: "sk-or-XXXX",
		} as never)
		const { controller } = makeFakeController(clineDir)

		const response = await bootstrapModelProfileFromCurrentConfiguration(
			controller as never,
			BootstrapModelProfileRequest.create({ name: "My first" }),
		)

		expect(response.status).toBe("CURRENT_CONFIGURATION_UNSUPPORTED")
		expect(response.profileId).toBe("")
		expect(response.instanceId).toBe("")
		expect(response.message).toMatch(/'openrouter'/)
		expect(response.message).toMatch(/not covered by the bootstrap path/i)
	})

	// -------------------------------------------------------------------------
	// 5. MISSING_CREDENTIAL -> empty ids, credential-named message
	// -------------------------------------------------------------------------

	it("MPFRB01_B3_MISSING_CREDENTIAL: provider present but no apiKey -> empty ids, credential-named message", async () => {
		await StateManager.get().setApiConfiguration({
			actModeApiProvider: "anthropic",
			actModeApiModelId: "claude-sonnet-4-6",
			// apiKey INTENTIONALLY UNSET
		} as never)
		const { controller } = makeFakeController(clineDir)

		const response = await bootstrapModelProfileFromCurrentConfiguration(
			controller as never,
			BootstrapModelProfileRequest.create({ name: "My first" }),
		)

		expect(response.status).toBe("MISSING_CREDENTIAL")
		expect(response.profileId).toBe("")
		expect(response.instanceId).toBe("")
		expect(response.message).toMatch(/No API key is configured for 'anthropic'/)
		expect(response.message).toMatch(/Add one in Settings/i)
	})

	// -------------------------------------------------------------------------
	// 6. MISSING_MODEL -> empty ids, model-named message (NOT credential)
	// -------------------------------------------------------------------------

	it("MPFRB01_B3_MISSING_MODEL: provider + credential present but no model -> empty ids, MODEL-named message (regression guard)", async () => {
		await StateManager.get().setApiConfiguration({
			actModeApiProvider: "anthropic",
			// actModeApiModelId INTENTIONALLY UNSET
			apiKey: "sk-ant-XXXX",
		} as never)
		const { controller } = makeFakeController(clineDir)

		const response = await bootstrapModelProfileFromCurrentConfiguration(
			controller as never,
			BootstrapModelProfileRequest.create({ name: "My first" }),
		)

		expect(response.status).toBe("MISSING_MODEL")
		expect(response.profileId).toBe("")
		expect(response.instanceId).toBe("")
		expect(response.message).toMatch(/No model id is configured for 'anthropic'/i)
		// And the message MUST NOT leak the credential framing.
		expect(response.message).not.toMatch(/No API key/)
	})

	// -------------------------------------------------------------------------
	// 7. INSTANCE_WRITE_FAILED via flushInstanceSecrets throw
	// -------------------------------------------------------------------------

	it("MPFRB01_B3_INSTANCE_WRITE_FAILED: flushInstanceSecrets throws -> empty ids, message names the flush error", async () => {
		await StateManager.get().setApiConfiguration(makeCurrentAnthropicConfig() as never)

		// Inject a flushInstanceSecrets that throws by overriding
		// flushPendingState on the real StateManager for this test.
		const flushSpy = vi.spyOn(StateManager.get(), "flushPendingState").mockRejectedValueOnce(new Error("disk full"))

		const { controller } = makeFakeController(clineDir)

		const response = await bootstrapModelProfileFromCurrentConfiguration(
			controller as never,
			BootstrapModelProfileRequest.create({ name: "My first" }),
		)

		expect(flushSpy).toHaveBeenCalled()
		expect(response.status).toBe("INSTANCE_WRITE_FAILED")
		expect(response.profileId).toBe("")
		expect(response.instanceId).toBe("")
		expect(response.message).toMatch(/flush the instance secret to disk/i)
		expect(response.message).toContain("disk full")
	})

	// -------------------------------------------------------------------------
	// 8. PROFILE_WRITE_FAILED via ProfilesStore.upsert throw
	// -------------------------------------------------------------------------

	it("MPFRB01_B3_PROFILE_WRITE_FAILED: ProfilesStore.upsert throws -> empty ids, message names the upsert error", async () => {
		await StateManager.get().setApiConfiguration(makeCurrentAnthropicConfig() as never)

		const dataDir = path.join(clineDir, "profile-write-failed")
		await fs.mkdir(dataDir, { recursive: true })
		const realInstancesStore = new InstancesStore({
			filePath: path.join(dataDir, "instances.json"),
		})
		const realProfilesStore = new ProfilesStore({
			filePath: path.join(dataDir, "profiles.json"),
		})
		const failingProfilesStore = new Proxy(realProfilesStore, {
			get(target, prop, receiver) {
				if (prop === "upsert") {
					return () => {
						throw new Error("simulated profiles.json write failure")
					}
				}
				return Reflect.get(target, prop, receiver)
			},
		})

		const { controller } = makeFakeController(clineDir, {
			instancesStore: realInstancesStore,
			profilesStore: failingProfilesStore as unknown as ProfilesStore,
		})

		const response = await bootstrapModelProfileFromCurrentConfiguration(
			controller as never,
			BootstrapModelProfileRequest.create({ name: "My first" }),
		)

		expect(response.status).toBe("PROFILE_WRITE_FAILED")
		expect(response.profileId).toBe("")
		expect(response.instanceId).toBe("")
		expect(response.message).toContain("simulated profiles.json write failure")
	})

	// -------------------------------------------------------------------------
	// 9. Handler-level guard: empty name in request
	// -------------------------------------------------------------------------

	it("MPFRB01_B3_GUARD_EMPTY_NAME: handler refuses empty name with PROFILE_WRITE_FAILED + bound message", async () => {
		await StateManager.get().setApiConfiguration(makeCurrentAnthropicConfig() as never)
		const { controller } = makeFakeController(clineDir)

		const response = await bootstrapModelProfileFromCurrentConfiguration(
			controller as never,
			BootstrapModelProfileRequest.create({ name: "   " }),
		)

		expect(response.status).toBe("PROFILE_WRITE_FAILED")
		expect(response.profileId).toBe("")
		expect(response.instanceId).toBe("")
		expect(response.message).toMatch(/name must be a non-empty string/i)
	})

	// -------------------------------------------------------------------------
	// 10. Handler-level guard: modelProfilesOwner undefined
	// -------------------------------------------------------------------------

	it("MPFRB01_B3_GUARD_OWNER_MISSING: handler reports production owner not wired when controller lacks modelProfilesOwner", async () => {
		await StateManager.get().setApiConfiguration(makeCurrentAnthropicConfig() as never)
		const { controller } = makeFakeController(clineDir, { ownerMissing: true })

		const response = await bootstrapModelProfileFromCurrentConfiguration(
			controller as never,
			BootstrapModelProfileRequest.create({ name: "My first" }),
		)

		expect(response.status).toBe("PROFILE_WRITE_FAILED")
		expect(response.profileId).toBe("")
		expect(response.instanceId).toBe("")
		expect(response.message).toMatch(/production owner not wired/i)
	})

	// -------------------------------------------------------------------------
	// 11. B3 bounded P1 absorb: malformed openAiHeaders refuses
	//     (freeze MALFORMED_HEADERS_POLICY)
	// -------------------------------------------------------------------------

	it("MPFRB01_B3_MALFORMED_HEADERS_POLICY: malformed JSON openAiHeaders refuses with CURRENT_CONFIGURATION_UNSUPPORTED + actionable message", async () => {
		await StateManager.get().setApiConfiguration(makeCurrentOpenAiConfig("{not valid json at all") as never)
		const { controller, instancesStore, profilesStore } = makeFakeController(clineDir)

		const response = await bootstrapModelProfileFromCurrentConfiguration(
			controller as never,
			BootstrapModelProfileRequest.create({ name: "My first" }),
		)

		expect(response.status).toBe("CURRENT_CONFIGURATION_UNSUPPORTED")
		expect(response.profileId).toBe("")
		expect(response.instanceId).toBe("")
		expect(response.message).toMatch(/openAiHeaders are malformed/i)
		expect(response.message).toMatch(/Fix the headers/i)

		// Conservation: nothing was committed.
		expect(Object.keys(instancesStore.list())).toHaveLength(0)
		expect(Object.keys(profilesStore.list())).toHaveLength(0)
	})

	it("MPFRB01_B3_MALFORMED_HEADERS_OBJECT: non-object openAiHeaders refuses (array, primitive)", async () => {
		await StateManager.get().setApiConfiguration(makeCurrentOpenAiConfig([1, 2, 3]) as never)
		const { controller } = makeFakeController(clineDir)

		const response = await bootstrapModelProfileFromCurrentConfiguration(
			controller as never,
			BootstrapModelProfileRequest.create({ name: "My first" }),
		)

		expect(response.status).toBe("CURRENT_CONFIGURATION_UNSUPPORTED")
		expect(response.message).toMatch(/openAiHeaders are malformed/i)
	})

	it("MPFRB01_B3_ABSENT_HEADERS_OK: openAiHeaders absent -> CREATED, headers absent on connection", async () => {
		// Per freeze #4: absent headers => commit normally with
		// connection.headers absent. MALFORMED_HEADERS_POLICY only
		// fires on PRESENT-but-malformed.
		await StateManager.get().setApiConfiguration(makeCurrentOpenAiConfig(undefined) as never)
		const { controller, instancesStore } = makeFakeController(clineDir)

		const response = await bootstrapModelProfileFromCurrentConfiguration(
			controller as never,
			BootstrapModelProfileRequest.create({ name: "My first" }),
		)

		expect(response.status).toBe("CREATED")
		expect(response.profileId).toMatch(/^prof-/)
		expect(response.instanceId).toMatch(/^inst-/)
		const instances = instancesStore.list()
		expect(Object.keys(instances)).toHaveLength(1)
		const inst = Object.values(instances)[0]
		expect(Object.hasOwn(inst.connection, "headers")).toBe(false)
	})

	// -------------------------------------------------------------------------
	// 12. B3 bounded P1 absorb: assertBootstrapCoverageIsWellFormed
	// -------------------------------------------------------------------------

	it("MPFRB01_B3_COVERAGE_INVARIANT: assertBootstrapCoverageIsWellFormed reports ok=true for the current BOOTSTRAP_COVERAGE set", async () => {
		const { assertBootstrapCoverageIsWellFormed } = await import("@/sdk/profile-store/bootstrap")
		const result = assertBootstrapCoverageIsWellFormed()
		if (!result.ok) {
			console.error(
				"BOOTSTRAP_COVERAGE invariant failed. Per-provider diagnostics:",
				JSON.stringify(result.diagnostics, null, 2),
			)
		}
		expect(result.ok).toBe(true)
		expect(result.diagnostics.length).toBeGreaterThanOrEqual(11)
		for (const d of result.diagnostics) {
			expect(d.credentialResolved).toBe(true)
			expect(d.modelIdResolvedFor.length).toBeGreaterThan(0)
		}
	})

	// -------------------------------------------------------------------------
	// B3 conservation: handler MUST NOT throw across the gRPC boundary.
	// -------------------------------------------------------------------------

	it("MPFRB01_B3_NO_THROW: handler never throws across the gRPC boundary; every status is a typed envelope", async () => {
		const scenarios: Array<{
			label: string
			config: Record<string, unknown>
			expectedStatus: string
		}> = [
			{
				// Cache-clear above resets globalStateCache to
				// undefined. The bootstrap reads the raw value and
				// returns NO_CURRENT_CONFIGURATION. (The
				// "openrouter" default is only applied once, at
				// StateManager.initialize time; subsequent cache
				// mutations are honored as-is.)
				label: "empty provider",
				config: { actModeApiProvider: undefined },
				expectedStatus: "NO_CURRENT_CONFIGURATION",
			},
			{
				label: "unsupported provider",
				config: {
					actModeApiProvider: "openrouter",
					actModeOpenRouterModelId: "anthropic/claude-3.5-sonnet",
					openRouterApiKey: "sk-or-XXXX",
				},
				expectedStatus: "CURRENT_CONFIGURATION_UNSUPPORTED",
			},
			{
				label: "missing credential",
				config: { actModeApiProvider: "anthropic", actModeApiModelId: "claude-sonnet-4-6" },
				expectedStatus: "MISSING_CREDENTIAL",
			},
			{
				label: "missing model",
				config: { actModeApiProvider: "anthropic", apiKey: "sk-ant-XXXX" },
				expectedStatus: "MISSING_MODEL",
			},
		]

		const { controller } = makeFakeController(clineDir)
		for (const scenario of scenarios) {
			// Each scenario starts from a fully-clean ApiConfiguration:
			// null out every cache that participates in
			// `getApiConfiguration` (which walks remoteConfigCache,
			// sessionOverrideCache, taskStateCache, globalStateCache
			// in precedence order). Then apply the scenario's
			// config on top of that clean slate.
			const sm = StateManager.get() as unknown as {
				globalStateCache: Record<string, unknown>
				secretsCache: Record<string, unknown>
				remoteConfigCache: Record<string, unknown>
				sessionOverrideCache: Record<string, unknown>
				taskStateCache: Record<string, unknown>
				pendingGlobalState: Set<string>
				pendingSecrets: Set<string>
			}
			for (const k of Object.keys(sm.globalStateCache)) {
				if (sm.globalStateCache[k] !== undefined) sm.globalStateCache[k] = undefined
			}
			for (const k of Object.keys(sm.secretsCache)) {
				if (sm.secretsCache[k] !== undefined) sm.secretsCache[k] = undefined
			}
			for (const k of Object.keys(sm.remoteConfigCache)) {
				if (sm.remoteConfigCache[k] !== undefined) sm.remoteConfigCache[k] = undefined
			}
			for (const k of Object.keys(sm.sessionOverrideCache)) {
				if (sm.sessionOverrideCache[k] !== undefined) sm.sessionOverrideCache[k] = undefined
			}
			for (const k of Object.keys(sm.taskStateCache)) {
				if ((sm.taskStateCache as Record<string, unknown>)[k] !== undefined) {
					;(sm.taskStateCache as Record<string, unknown>)[k] = undefined
				}
			}
			sm.pendingGlobalState.clear()
			sm.pendingSecrets.clear()
			await StateManager.get().setApiConfiguration(scenario.config as never)
			const response = await bootstrapModelProfileFromCurrentConfiguration(
				controller as never,
				BootstrapModelProfileRequest.create({ name: "My first" }),
			)
			expect(response.status, `scenario: ${scenario.label}`).toBe(scenario.expectedStatus)
			expect(typeof response.message, `scenario: ${scenario.label}`).toBe("string")
			expect(response.message.length, `scenario: ${scenario.label}`).toBeGreaterThan(0)
		}

		// Smoke: nameFor is still functional.
		const instanceId = "inst-smoke-b3"
		const n = nameFor(instanceId)
		expect(n).toBe(`instance:${instanceId}`)
	})
})
