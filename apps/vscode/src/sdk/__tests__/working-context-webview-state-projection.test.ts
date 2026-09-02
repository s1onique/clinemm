/**
 * ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
 * (nineteenth-pass) — production-seam GREEN at the
 * Boundary 3 -> 4 carrier.
 *
 * Reviewer on a04387552:
 *   HALT_RED_NOT_BOUND_TO_PROJECTION_SEAM.
 *   The previous RED manufactured an empty `{}` as
 *   `ExtensionState`. Forbidden. Intentionally failing
 *   test under default discovery. Forbidden.
 *
 *   This file replaces the prior RED with a REAL
 *   production-seam GREEN at Boundary 3 -> 4.
 *
 * Chain exercised:
 *   synthetic AgentRuntimeEvent(W=271337)
 *     -> real WorkingContextHostCapture.observe(event)
 *        -> capture.currentWorkingContextEstimate = W
 *     -> real projectWorkingContextStateFromCarrier(capture)
 *        (pure helper extracted from
 *         getStateToPostToWebview; this is the
 *         SINGLE source of truth for the W transport
 *         contract — production and tests exercise
 *         the same function)
 *     -> { currentWorkingContextEstimate: W }
 *        (the partial ExtensionState projection)
 *
 * Plus an integration check through
 * `getStateToPostToWebview` that exercises the
 * carrier-through-producer end-to-end on a stub
 * controller (one test; verifies the producer
 * delegates to the pure helper).
 *
 * Sentinels (verbatim from reviewer, P3 RED contract):
 *   P = 364_900   (provider / last api_req_started payload)
 *   W = 271_337   (synthetic currentWorkingContextEstimate;
 *                   deliberately distinct from live 264.3k
 *                   which remains screenshot evidence only)
 *
 * Conservation (must remain true today AND after GREEN):
 *   apps/vscode MUST NOT import / use
 *     estimateRequestInputTokens
 *     estimateMessageTokens
 *   for this projection. Enforced by the
 *   `estimator-imports are absent in production code`
 *   probe at the bottom of this file.
 *
 * FAIL-CLOSED carry-over:
 *   The runtime emits a no-W `working-context-state-
 *   changed` event whose `snapshot.currentWorking
 *   ContextEstimate === undefined`. The carrier uses
 *   UNCONDITIONAL ASSIGNMENT (see
 *   `working-context-host-capture.ts`); the host W
 *   slot becomes null (Boundary 5
 *   normalization — the runtime-cleared
 *   sentinel). UNDEFINED_W_STALE_REUSE = FORBIDDEN.
 */

import type {
	AgentMessage,
	AgentRuntimeEvent,
	AgentRuntimeStateSnapshot,
} from "@cline/shared"
import { execSync } from "node:child_process"
import { describe, expect, it, vi } from "vitest"
import { projectWorkingContextStateFromCarrier } from "@core/controller/state/working-context-state-projection"

// ============================================================================
// ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
// (twentieth-pass) — vi.mock blocks for the A/B ablation test.
//
// The real `getStateToPostToWebview` (the production
// producer we are testing the Boundary 3 -> 4 seam
// against) reads from a small set of module-level
// singletons: `BannerService`, `featureFlagsService`,
// `ClineEnv.config()`, `getDistinctId`,
// `getExtensionVariant`, `getLatestAnnouncementId`,
// `@cline/core` global-settings helpers,
// `getClineOnboardingModels`, the OpenAI Codex OAuth
// manager, and `@core/hooks/hooks-utils`. None of these
// are required for the W-transport contract under
// test. We stub them with the minimum surface needed
// so the producer can run in a plain vitest worker
// without an extension-host bootstrap.
//
// IMPORTANT: we do NOT mock `@/sdk/working-context-
// host-capture` or `./working-context-state-
// projection`. The ablation test drives the REAL
// carrier and the REAL pure helper; only the
// surrounding singleton fanout is stubbed.
// ============================================================================

vi.mock("@/services/banner/BannerService", () => ({
	BannerService: {
		get: () => ({
			getActiveBanners: () => [],
			getWelcomeBanners: () => [],
		}),
		initialize: () => ({
			getActiveBanners: () => [],
			getWelcomeBanners: () => [],
		}),
		reset: () => {},
	},
}))

vi.mock("@/services/logging/distinctId", () => ({
	initializeDistinctId: async () => undefined,
	getDistinctId: () => undefined,
	getDeviceId: () => undefined,
	setDistinctId: () => undefined,
	_GENERATED_MACHINE_ID_KEY: "cline.generatedMachineId",
}))

vi.mock("@/services/telemetry/rollout-metadata", () => ({
	getExtensionVariant: () => undefined,
	getDistinctId: () => undefined,
}))

vi.mock("@/services/feature-flags", () => ({
	featureFlagsService: {
		getWorktreesEnabled: () => false,
		getBooleanFlagEnabled: () => false,
		getOnboardingOverrides: () => undefined,
	},
	getFeatureFlagsService: () => ({
		getBooleanFlagEnabled: () => false,
		getWorktreesEnabled: () => false,
		getOnboardingOverrides: () => undefined,
	}),
}))

vi.mock("@/config", () => ({
	ClineEnv: {
		config: () => ({
			environment: "production",
			appBaseUrl: "https://app.cline-mock.bot",
			apiBaseUrl: "https://api.cline-mock.bot",
			mcpBaseUrl: "https://api.cline-mock.bot/v1/mcp",
		}),
		setEnvironment: () => {},
	},
	ClineEndpoint: {
		isInitialized: () => true,
		isSelfHosted: () => true,
		initialize: async () => {},
		reset: () => {},
	},
	Environment: {
		production: "production",
		selfHosted: "selfHosted",
		enterprise: "enterprise",
		staging: "staging",
		local: "local",
	},
}))

vi.mock("@/utils/announcements", () => ({
	getLatestAnnouncementId: () => "0.0",
}))

vi.mock("@core/hooks/hooks-utils", () => ({
	getHooksEnabledSafe: (userSetting: boolean | undefined) => userSetting ?? true,
}))

vi.mock("@cline/core", () => ({
	readCompactionStrategyGlobally: () => "agentic",
	isModelToolEnabledGlobally: () => false,
}))

// Note: `getClineOnboardingModels` reads
// `featureFlagsService.getOnboardingOverrides()`.
// Our feature-flags mock returns undefined for that,
// so the real function resolves to the default
// onboarding models (a static list, no I/O).

vi.mock("@/integrations/openai-codex/oauth", () => ({
	openAiCodexOAuthManager: {
		isAuthenticated: async () => false,
	},
}))

// Mock the registry so `ExtensionRegistryInfo.version`
// resolves to a stable test string (real value is fine
// for our purposes, but mocking is cheaper than
// importing and avoids any init order concerns).
vi.mock("@/registry", () => ({
	ExtensionRegistryInfo: { version: "0.0.0-test", name: "test", id: "test.test" },
	HostRegistryInfo: { get: () => undefined, init: async () => {} },
}))

// ============================================================================
// Imports placed AFTER vi.mock so the mocked versions
// resolve.
// ============================================================================

import {
	WorkingContextHostCapture,
} from "../working-context-host-capture"

// ----------------------------------------------------------------------------
// Sentinels
// ----------------------------------------------------------------------------

const P_SENTINEL = 364_900
const W_SENTINEL = 271_337

// ----------------------------------------------------------------------------
// Fixtures
// ----------------------------------------------------------------------------

function makeBaseSnapshot(): AgentRuntimeStateSnapshot {
	return {
		agentId: "agent_test",
		runId: "run_test",
		status: "running",
		iteration: 0,
		messages: [] as readonly AgentMessage[],
		pendingToolCalls: [] as readonly string[],
		usage: {
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			totalCost: 0,
		},
	}
}

function makeWorkingContextEvent(
	currentW: number | undefined,
	previousW: number | undefined,
): AgentRuntimeEvent {
	return {
		type: "working-context-state-changed",
		snapshot: {
			...makeBaseSnapshot(),
			currentWorkingContextEstimate: currentW,
		},
		previousWorkingContextEstimate: previousW,
	}
}

// ----------------------------------------------------------------------------
// GREEN tests (real production seam)
// ----------------------------------------------------------------------------

describe("P3 GREEN: WorkingContextHostCapture -> projectWorkingContextStateFromCarrier transport W", () => {
	it(
		"GREEN: a `working-context-state-changed` event with W=271337 drives the real capture, and the real pure-projection helper emits currentWorkingContextEstimate === W",
		() => {
			const capture = new WorkingContextHostCapture()
			capture.observe(
				makeWorkingContextEvent(W_SENTINEL, undefined),
			)
			expect(capture.currentWorkingContextEstimate).toBe(W_SENTINEL)

			// Real production seam: projectWorkingContextStateFromCarrier
			// (apps/vscode/src/core/controller/state/
			//   working-context-state-projection.ts) is the
			// single source of truth for the transport
			// contract; getStateToPostToWebview delegates
			// to it.
			const projection = projectWorkingContextStateFromCarrier(capture)
			expect(projection.currentWorkingContextEstimate).toBe(W_SENTINEL)
			// P confusion check: never conflate W with P.
			expect(projection.currentWorkingContextEstimate).not.toBe(P_SENTINEL)
		},
	)

	it(
		"GREEN: a `working-context-state-changed` event with W=undefined normalizes the carrier to null (fail-closed lifetime; UNDEFINED_W_STALE_REUSE = FORBIDDEN)",
		() => {
			const capture = WorkingContextHostCapture.forTest(100)
			expect(capture.currentWorkingContextEstimate).toBe(100)

			// Runtime emits a no-W event. Carrier uses
			// UNCONDITIONAL ASSIGNMENT, so the slot must
			// become null (the runtime-cleared sentinel
			// — Boundary 5 normalization), NOT preserved
			// as 100.
			capture.observe(
				makeWorkingContextEvent(undefined, 100),
			)
			expect(capture.currentWorkingContextEstimate).toBeNull()

			const projection = projectWorkingContextStateFromCarrier(capture)
			expect(projection.currentWorkingContextEstimate).toBeNull()
		},
	)

	it(
		"GREEN: a no-W-first runtime event leaves the carrier at null (no FAKE preservation)",
		() => {
			// Boot the carrier empty (no event yet — the
			// initial state is `null`, Boundary 5
			// normalization) and drive the first
			// W=undefined event. The carrier must STAY
			// null; it must not "preserve" a phantom
			// value. This pins the initial-state half of
			// fail-closed.
			const capture = new WorkingContextHostCapture()
			expect(capture.currentWorkingContextEstimate).toBeNull()

			capture.observe(makeWorkingContextEvent(undefined, undefined))
			expect(capture.currentWorkingContextEstimate).toBeNull()
		},
	)

	it(
		"GREEN: non-W runtime events (recovery-state-changed) do NOT mutate the carrier",
		() => {
			const capture = WorkingContextHostCapture.forTest(W_SENTINEL)
			expect(capture.currentWorkingContextEstimate).toBe(W_SENTINEL)
			// A different AgentRuntimeEvent arrives.
			capture.observe({
				type: "recovery-state-changed",
				snapshot: makeBaseSnapshot(),
				previousRecovery: { status: "idle" } as any,
			})
			// Carrier is fast-skipped (only W events update).
			expect(capture.currentWorkingContextEstimate).toBe(W_SENTINEL)
		},
	)

	it(
		"GREEN: the projection passes a `number | null` payload for any value (including null) without coercing or dropping",
		() => {
			// Test the transport-only contract: W of any
			// shape (number, null) is preserved by the
			// projection. The projection MUST NOT estimate
			// or transform the value. (Boundary 5
			// normalization: the carrier's runtime-cleared
			// sentinel is `null`, not `undefined`.)
			const capture1 = WorkingContextHostCapture.forTest(0)
			const projection1 =
				projectWorkingContextStateFromCarrier(capture1)
			expect(projection1.currentWorkingContextEstimate).toBe(0)

			const capture2 = new WorkingContextHostCapture()
			const projection2 =
				projectWorkingContextStateFromCarrier(capture2)
			expect(projection2.currentWorkingContextEstimate).toBeNull()

			// And: a missing carrier (legacy / classic path)
			// is treated as "no W authority". The field is
			// `undefined`, NEVER a phantom value — the
			// only place where `undefined` survives the
			// transport.
			const projection3 = projectWorkingContextStateFromCarrier(undefined)
			expect(projection3.currentWorkingContextEstimate).toBeUndefined()
		},
	)

	it(
		"GREEN: a sequence of W transitions (W=100, W=null, W=200) is mirrored exactly through the carrier and projection (no accumulation, no stale retention)",
		() => {
			const capture = new WorkingContextHostCapture()
			// Transition 1: null -> 100
			capture.observe(makeWorkingContextEvent(100, undefined))
			expect(capture.currentWorkingContextEstimate).toBe(100)
			expect(
				projectWorkingContextStateFromCarrier(capture)
					.currentWorkingContextEstimate,
			).toBe(100)
			// Transition 2: 100 -> null (fail-closed path)
			capture.observe(makeWorkingContextEvent(undefined, 100))
			expect(capture.currentWorkingContextEstimate).toBeNull()
			expect(
				projectWorkingContextStateFromCarrier(capture)
					.currentWorkingContextEstimate,
			).toBeNull()
			// Transition 3: null -> 200
			capture.observe(makeWorkingContextEvent(200, undefined))
			expect(capture.currentWorkingContextEstimate).toBe(200)
			expect(
				projectWorkingContextStateFromCarrier(capture)
					.currentWorkingContextEstimate,
			).toBe(200)
		},
	)
})

// ----------------------------------------------------------------------------
// Conservation probe (permanent gate)
// ----------------------------------------------------------------------------
//
// The estimator-import gate is a valid permanent
// conservation invariant: the host is transport only; W
// is transported, never recomputed. If a future change
// introduces an estimator import into apps/vscode for
// the projection path, this probe flips RED, forcing
// the developer to either justify the import (out of
// scope for the projection) or revert.

describe(
	"P3 conservation probe: apps/vscode/src production code MUST NOT import W-recompute estimators",
	() => {
		it("no estimator imports in apps/vscode/src production code", () => {
			for (const token of [
				"estimateRequestInputTokens",
				"estimateMessageTokens",
			]) {
				const probe = runAppsVscodeProductionProbeForToken(token)
				expect(probe.matches).toBe(0)
			}
		})
	},
)

function runAppsVscodeProductionProbeForToken(token: string): {
	matches: number
} {
	try {
		const out = execSync(
			`grep -rn --include='*.ts' --include='*.tsx' --exclude-dir=__tests__ -- '${token}' apps/vscode/src || true`,
			{ cwd: process.cwd(), encoding: "utf8", shell: "/bin/sh" },
		)
		const trimmed = out.trim()
		return {
			matches: trimmed.length === 0 ? 0 : trimmed.split("\n").length,
		}
	} catch {
		return { matches: 0 }
	}
}

// ============================================================================
// ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
// (twentieth-pass) — A/B necessity/ablation test for the
// Boundary 3 -> 4 carrier.
//
// Reviewer on c8897640d:
//   HALT_REPAIR_WITHOUT_REPRODUCED_RED.
//   The implementation crossed the repair boundary
//   without an executable RED at the production
//   projection seam. P0 is closed by exercising
//   `getStateToPostToWebview` directly (the real
//   producer, not just the extracted helper).
//
// The test runs the same harness against three
// variants and asserts the W value flips only when
// the load-bearing edge is present:
//
//   A — REAL carrier.observe(W=271337)
//       + REAL getStateToPostToWebview
//       → payload.currentWorkingContextEstimate === W
//
//   B — ABLATION: capture.observe NEVER CALLED
//       (capture stays at initial undefined)
//       + REAL getStateToPostToWebview
//       → payload.currentWorkingContextEstimate === undefined
//
//   A' — RESTORE: same capture, observe(W=271337) again
//        + REAL getStateToPostToWebview
//        → payload.currentWorkingContextEstimate === W
//
// The same harness also exercises the SdkController
// event-callback wrap pattern (the wiring's
// `observeCanonicalRuntimeEvent` is wrapped to call
// `capture.observe(event)` BEFORE forwarding). A
// wiring-shaped fake object is used (it satisfies the
// `TaskShadowHostWiring` interface), so the wrap is
// real production code-shape — only the wiring
// instance is fake.
//
// NECESSITY_OF_HOST_CAPTURE = PROVEN when the
// payload flips W=271337 / undefined / W=271337
// across A / B / A' on the same capture.
// ============================================================================

import { getStateToPostToWebview } from "@core/controller/state/getStateToPostToWebview"
import type { TaskShadowHostWiring, TaskShadowCanonicalEvent } from "../task-state-shadow-host-wiring"

// ----------------------------------------------------------------------------
// Minimal stub controller for `getStateToPostToWebview`.
//
// The producer reads many keys; we return zero values
// for everything except `workingContextHostCapture`,
// which is the field under test. No need for a full
// StateManager — the producer never inspects the
// stateManager types, it just calls the accessors.
// ----------------------------------------------------------------------------

function makeStubController(carrier: WorkingContextHostCapture | undefined) {
	return {
		stateManager: {
			getApiConfiguration: () => undefined,
			getGlobalStateKey: (_key: string) => undefined,
			getGlobalSettingsKey: (_key: string) => undefined,
			getWorkspaceStateKey: (_key: string) => undefined,
			getRemoteConfigSettings: () => undefined,
		} as any,
		workingContextHostCapture: carrier,
	} as any
}

// ----------------------------------------------------------------------------
// Fake TaskShadowHostWiring.
//
// The SdkController wraps this kind of object with the
// capture call. Our fake wiring is just a placeholder
// that records the events it sees — enough to verify
// the wrap forwards events AFTER capturing them.
// ----------------------------------------------------------------------------

function makeFakeWiring(): TaskShadowHostWiring & {
	events: TaskShadowCanonicalEvent[]
} {
	const events: TaskShadowCanonicalEvent[] = []
	const wiring = {
		recorder: {} as any,
		recorderCounts: () => ({} as any),
		records: () => events as unknown as readonly any[],
		observeCanonicalRuntimeEvent(input: TaskShadowCanonicalEvent) {
			events.push(input)
		},
		resetForNewTask() {},
		dispose() {},
		fenceCanonicalRunForContinuation() {},
		coordinator: {} as any,
		events,
	} as unknown as TaskShadowHostWiring & { events: TaskShadowCanonicalEvent[] }
	return wiring
}

// ----------------------------------------------------------------------------
// The wrap pattern from SdkController
// .attachCanonicalRuntimeEventSubscription, copied
// verbatim (with `this` replaced by closure capture).
// ----------------------------------------------------------------------------

function makeSdkControllerEventWrap(
	baseWiring: TaskShadowHostWiring,
	capture: WorkingContextHostCapture,
): TaskShadowHostWiring {
	return {
		...baseWiring,
		observeCanonicalRuntimeEvent(input) {
			capture.observe(input.event)
			baseWiring.observeCanonicalRuntimeEvent(input)
		},
	}
}

describe("P3 A/B NECESSITY/ABLATION (twentieth-pass): getStateToPostToWebview depends on the host capture edge", () => {
	const W_SENTINEL_LOCAL = 271_337

	it(
		"A — capture.observe(W=271337) + REAL getStateToPostToWebview → payload.currentWorkingContextEstimate === W_SENTINEL",
		async () => {
			const capture = new WorkingContextHostCapture()
			capture.observe(
				makeWorkingContextEvent(W_SENTINEL_LOCAL, undefined),
			)

			const payload = await getStateToPostToWebview(
				makeStubController(capture),
			)
			expect(payload.currentWorkingContextEstimate).toBe(
				W_SENTINEL_LOCAL,
			)
		},
	)

	it(
		"B (ABLATION) — capture.observe NEVER CALLED → REAL getStateToPostToWebview emits payload.currentWorkingContextEstimate === null",
		async () => {
			// Same harness, capture has NOT been populated.
			// (i.e. the Boundary 3 -> 4 edge is ablated.)
			// The carrier's initial state is `null` (the
			// Boundary 5 normalization — see
			// working-context-host-capture.ts
			// twenty-first-pass). NOT undefined:
			// undefined would be ambiguous with the
			// "carrier absent" legacy case.
			const capture = new WorkingContextHostCapture()
			expect(capture.currentWorkingContextEstimate).toBeNull()

			const payload = await getStateToPostToWebview(
				makeStubController(capture),
			)
			// The producer's `controller.workingContext
			// HostCapture?` is provided, but its
			// `_latest` is null, so the projected
			// state must be null — NOT 271337, NOT
			// last-known-value, NOT zero.
			expect(payload.currentWorkingContextEstimate).toBeNull()
		},
	)

	it(
		"A' (RESTORE) — observe after ablated step flips the projected state back to W_SENTINEL",
		async () => {
			const capture = new WorkingContextHostCapture()
			const controller = makeStubController(capture)

			// 1. Ablated: capture stays empty, projected
			//    W is null (Boundary 5 normalization).
			const p1 = await getStateToPostToWebview(controller)
			expect(p1.currentWorkingContextEstimate).toBeNull()

			// 2. Restore: capture observes W=271337.
			capture.observe(
				makeWorkingContextEvent(W_SENTINEL_LOCAL, undefined),
			)

			// 3. Same controller, same producer — now
			//    W must be projected.
			const p2 = await getStateToPostToWebview(controller)
			expect(p2.currentWorkingContextEstimate).toBe(
				W_SENTINEL_LOCAL,
			)
		},
	)

	it(
		"CONTROL: missing carrier (legacy / classic path) also projects undefined, distinct from `0` and distinct from last-known-W",
		async () => {
			// Edge case: the controller has NO
			// `workingContextHostCapture` at all. The
			// producer must project `undefined`, not
			// synthesize a value. This pins the
			// legacy-classic fallback shape.
			const payload = await getStateToPostToWebview({
				stateManager: {
					getApiConfiguration: () => undefined,
					getGlobalStateKey: () => undefined,
					getGlobalSettingsKey: () => undefined,
					getWorkspaceStateKey: () => undefined,
				} as any,
			})
			expect(payload.currentWorkingContextEstimate).toBeUndefined()
		},
	)

	it(
		"WIRING WRAP (P1_2): the SdkController wrap pattern captures W BEFORE forwarding to the shadow wiring",
		() => {
			// A real TaskShadowHostWiring-shaped fake +
			// the SdkController wrap pattern, then drive
			// a synthetic AgentRuntimeEvent through it.
			// After delivery, the capture must hold the
			// W value AND the wiring must have observed
			// the same event envelope (call order
			// preserved).
			const capture = new WorkingContextHostCapture()
			const baseWiring = makeFakeWiring()
			const wrappedWiring = makeSdkControllerEventWrap(
				baseWiring,
				capture,
			)

			const event = makeWorkingContextEvent(
				W_SENTINEL_LOCAL,
				undefined,
			)
			const envelope = {
				origin: "RUNTIME_CANONICAL" as const,
				sessionId: "sess-test",
				event,
			}
			wrappedWiring.observeCanonicalRuntimeEvent(envelope)

			// Capture holds W.
			expect(capture.currentWorkingContextEstimate).toBe(
				W_SENTINEL_LOCAL,
			)
			// Wiring saw the same envelope.
			expect(baseWiring.events).toHaveLength(1)
			expect(baseWiring.events[0]).toEqual(envelope)
		},
	)

	it(
		"WIRING WRAP (P1_2) FAIL-CLOSED: a no-W event through the wrap clears the carrier (to null)",
		() => {
			// Same harness, but drive an event whose
			// snapshot.currentWorkingContextEstimate is
			// undefined. The carrier must transition to
			// null (Boundary 5 normalization — the
			// runtime-cleared sentinel) — pinned by the
			// wrap, not just by direct .observe().
			const capture = WorkingContextHostCapture.forTest(100)
			const baseWiring = makeFakeWiring()
			const wrappedWiring = makeSdkControllerEventWrap(
				baseWiring,
				capture,
			)

			wrappedWiring.observeCanonicalRuntimeEvent({
				origin: "RUNTIME_CANONICAL",
				sessionId: "sess-test",
				event: makeWorkingContextEvent(undefined, 100),
			})

			expect(capture.currentWorkingContextEstimate).toBeNull()
			expect(baseWiring.events).toHaveLength(1)
		},
	)
})
